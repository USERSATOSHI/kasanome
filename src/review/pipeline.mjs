import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRunner } from '../agents/runner.mjs'
import { createPrompts } from './prompts.mjs'
import {
  SCOPE_SCHEMA,
  MAP_SCHEMA,
  REVIEW_SCHEMA,
  VERDICT_SCHEMA,
  ATTRIB_SCHEMA,
} from './schemas.mjs'
import { writeDashboard } from '../report/data.mjs'
import { prepareOutput } from '../report/output.mjs'

async function resolveScope(agent, prompts, repo) {
  const scope = await agent('scope', prompts.scopePrompt(), { schema: SCOPE_SCHEMA })
  if (!scope) throw new Error('scope failed')
  for (const ref of ['base', 'head']) {
    try {
      scope[ref + 'Commit'] = execFileSync(
        'git',
        ['rev-parse', '--verify', '--end-of-options', scope[ref] + '^{commit}'],
        { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      ).trim()
    } catch {
      /* A partial scope is still renderable when refs are unavailable. */
    }
  }
  return scope
}

function reviewContext(scope) {
  return {
    range: `${scope.base}...${scope.head}`,
    readHint: scope.headIsCheckedOut
      ? 'The head is checked out: read files from the working tree.'
      : `The head is NOT checked out: read files with \`git show ${scope.headCommit || scope.head}:<path>\` and list them with \`git ls-tree -r ${scope.headCommit || scope.head}\`. Do not check anything out.`,
    spec: scope.specDocs.length
      ? `Spec/design docs to check behaviour against: ${scope.specDocs.join(', ')}.`
      : "No spec docs found; judge against the code's stated intent.",
  }
}

function selectUnits(map, opt, prompts, context, log) {
  const layers = map.layers.slice(0, Number(opt.maxLayers || 6))
  const seams = map.seams.slice(0, Number(opt.maxSeams ?? 3))
  if (map.layers.length > layers.length)
    log(
      `skipped layers: ${map.layers
        .slice(layers.length)
        .map((l) => l.id)
        .join(', ')}`
    )
  if (map.seams.length > seams.length)
    log(
      `skipped boundaries: ${map.seams
        .slice(seams.length)
        .map((s) => `${s.from}->${s.to}`)
        .join(', ')}`
    )
  const name = (id) => map.layers.find((l) => l.id === id)?.name || id
  const units = [
    ...layers.map((layer) => ({
      kind: 'layer',
      id: layer.id,
      name: layer.name,
      prompt: prompts.layerPrompt(layer, map, context),
    })),
    ...seams.map((seam) => ({
      kind: 'seam',
      id: `${seam.from}->${seam.to}`,
      name: `Seam ${name(seam.from)} -> ${name(seam.to)}`,
      prompt: prompts.seamPrompt(seam, map, context),
    })),
  ]
  return { layers, units }
}

async function reviewUnit(unit, agent, prompts, context, log) {
  const review = await agent(`review:${unit.id}`, unit.prompt, { schema: REVIEW_SCHEMA })
  if (!review) return { ...unit, review: null, findings: [] }
  if (!review.findings.length) return { ...unit, review, findings: [] }
  const verification = await agent(
    `verify:${unit.id}`,
    prompts.verifyPrompt(unit.name, review.findings, context),
    { schema: VERDICT_SCHEMA }
  )
  const accepted = new Map(
    (verification?.verdicts || []).filter((v) => v.real).map((v) => [v.index, v])
  )
  const findings = review.findings.flatMap((finding, index) => {
    const verdict = accepted.get(index)
    return verdict
      ? [{ ...finding, severity: verdict.severity || finding.severity, verifyNote: verdict.reason }]
      : []
  })
  log(`${unit.name}: ${findings.length}/${review.findings.length} findings survived verification`)
  return { ...unit, review, findings }
}

async function attributeFindings(scope, findings, agent, prompts) {
  if (!scope.prs.length || !findings.length) return findings
  const result = await agent('attribute', prompts.attribPrompt(scope.prs, findings, scope.head), {
    schema: ATTRIB_SCHEMA,
  })
  const byId = new Map((result?.attributions || []).map((item) => [item.id, item]))
  return findings.map((finding) => ({ ...finding, ...byId.get(finding.id) }))
}

async function createGuides(scope, layers, findings, agent, prompts, minLines) {
  const large = scope.prs.filter((pr) => pr.additions + pr.deletions >= minLines)
  const guides = await Promise.all(
    large.map(async (pr) => {
      const mine = findings.filter((f) => f.introducedIn === pr.number)
      const guide = await agent(
        `pr:#${pr.number}`,
        prompts.prGuidePrompt(pr, scope.prs, layers, mine)
      )
      return guide ? { number: pr.number, title: pr.title, guide } : null
    })
  )
  return guides.filter(Boolean)
}

async function review(opt, reportOptions, log) {
  const runner = createRunner({ ...reportOptions, opt, log })
  const { agent } = runner
  const prompts = createPrompts(opt)
  try {
    const scope = await resolveScope(agent, prompts, reportOptions.repo)
    const context = reviewContext(scope)
    log(
      `range ${context.range}: ${scope.filesChanged} files, +${scope.additions}/-${scope.deletions}, ${scope.prs.length} PR(s)`
    )
    const map = await agent('map', prompts.mapPrompt(scope, context), { schema: MAP_SCHEMA })
    if (!map) throw new Error('map failed')
    const selected = selectUnits(map, opt, prompts, context, log)
    const units = await Promise.all(
      selected.units.map((unit) => reviewUnit(unit, agent, prompts, context, log))
    )
    let number = 0
    const findings = await attributeFindings(
      scope,
      units.flatMap((unit) =>
        unit.findings.map((f) => ({ ...f, id: `F${++number}`, unit: unit.name }))
      ),
      agent,
      prompts
    )
    const prGuides = await createGuides(
      scope,
      selected.layers,
      findings,
      agent,
      prompts,
      Number(opt.prGuideMin ?? 1500)
    )
    const failed = units.filter((unit) => !unit.review).map((unit) => unit.id)
    const file = writeDashboard(
      {
        range: context.range,
        repo: reportOptions.repo,
        agent: `${reportOptions.agent}${opt.model ? ` (${opt.model})` : ''}`,
        scope,
        map,
        units,
        findings,
        prGuides,
        failed,
      },
      reportOptions
    )
    log(
      `done: ${findings.length} findings, ${prGuides.length} PR guides, ${failed.length} failed units`
    )
    return file
  } finally {
    runner.dispose()
  }
}

export async function runReview(opt) {
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: resolve(opt.repo || '.'),
    encoding: 'utf8',
  }).trim()
  const out = resolve(repo, opt.out || 'kasanome')
  const options = { repo, out, agent: opt.agent || 'claude' }
  prepareOutput(repo, out)
  if (opt.render) {
    console.log(writeDashboard(JSON.parse(readFileSync(resolve(opt.render), 'utf8')), options))
    return
  }
  const started = Date.now()
  const log = (message) =>
    process.stderr.write(`[${Math.round((Date.now() - started) / 1000)}s] ${message}\n`)
  console.log(await review(opt, options, log))
}
