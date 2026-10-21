import { execFileSync } from 'node:child_process'
import { readFileSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRunner } from '../agents/runner.mjs'
import { createPrompts } from './prompts.mjs'
import { MAP_SCHEMA, REVIEW_SCHEMA, VERDICT_SCHEMA, ATTRIB_SCHEMA } from './schemas.mjs'
import { writeDashboard } from '../report/data.mjs'
import { prepareOutput } from '../report/output.mjs'

import {
  pinScope,
  loadState,
  saveState,
  planReview,
  affectedUnits,
  mergeFindings,
  policy,
} from './state.mjs'
import { publishSummary } from './publication.mjs'

function reviewContext(scope) {
  return {
    range: `${scope.baseCommit}...${scope.headCommit}`,
    readHint: `Read the pinned head with git show ${scope.headCommit}:<path>. Do not read working-tree files or check anything out.`,
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

async function reviewUnit(unit, agent) {
  const review = await agent(`review:${unit.id}`, unit.prompt, { schema: REVIEW_SCHEMA })
  return { ...unit, review, findings: [] }
}

async function attributeFindings(scope, findings, agent, prompts) {
  if (!scope.prs.length || !findings.length) return findings
  const result = await agent(
    'attribute',
    prompts.attribPrompt(scope.prs, findings, scope.headCommit),
    {
      schema: ATTRIB_SCHEMA,
    }
  )
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

function collectPrs(repo, scope, opt, log) {
  const read = (ref) => {
    const pr = JSON.parse(
      execFileSync(
        'gh',
        [
          'pr',
          'view',
          ...(ref ? [String(ref)] : []),
          '--json',
          'number,title,headRefName,baseRefName,additions,deletions,url',
        ],
        { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      )
    )
    return { ...pr, headRef: pr.headRefName, baseRef: pr.baseRefName }
  }
  try {
    if (opt.prs && opt.prs !== 'auto') return opt.prs.split(',').map(read)
    const prs = [],
      seen = new Set()
    let ref = opt.publish || (scope.head === 'HEAD' ? '' : scope.head)
    while (prs.length < 20) {
      const pr = read(ref)
      if (seen.has(pr.number)) break
      seen.add(pr.number)
      prs.unshift(pr)
      if (pr.baseRef === scope.base.replace(/^origin\//, '')) break
      ref = pr.baseRef
    }
    return prs
  } catch (error) {
    if (opt.publish) throw error
    log('PR metadata unavailable; guides skipped')
    return []
  }
}

async function review(opt, reportOptions, log) {
  const scope = pinScope(reportOptions.repo, opt)
  if ((opt.guides || opt.publish) && opt.prs !== 'none')
    scope.prs = collectPrs(reportOptions.repo, scope, opt, log)
  const previous = loadState(reportOptions.out, { ...scope, repo: reportOptions.repo })
  const plan = planReview(reportOptions.repo, scope, previous, opt)
  log(`${plan.incremental ? 'incremental' : 'baseline'} review: ${plan.reason}`)
  const runner = createRunner({
    ...reportOptions,
    opt,
    log,
    identity: `${scope.baseCommit}|${scope.headCommit}|${opt.agentCmd || ''}`,
  })
  const { agent } = runner
  const prompts = createPrompts({ ...opt, knownFindings: previous?.findings || [] })
  try {
    const context = { ...reviewContext(scope), range: plan.range }
    const map = plan.incremental
      ? previous.map
      : await agent('map', prompts.mapPrompt(scope, context), { schema: MAP_SCHEMA })
    if (!map) throw new Error('Map failed or call budget exhausted; no review state was advanced')
    const selected = selectUnits(map, opt, prompts, context, log)
    const affected = affectedUnits(map, plan, previous)
    for (const unit of selected.units) {
      if (plan.incremental && previous.pending.includes(unit.id)) {
        const fullContext = { ...context, range: `${scope.baseCommit}...${scope.headCommit}` }
        if (unit.kind === 'layer')
          unit.prompt = prompts.layerPrompt(
            map.layers.find((l) => l.id === unit.id),
            map,
            fullContext
          )
        else
          unit.prompt = prompts.seamPrompt(
            map.seams.find((s) => `${s.from}->${s.to}` === unit.id),
            map,
            fullContext
          )
      }
    }
    const candidates = selected.units.filter((u) => !affected || affected.has(u.id))
    // Reserve one call for verification. Queued work also checks the budget before launching.
    const available = Math.max(0, runner.remaining() - 1)
    const scheduled = candidates.slice(0, available)
    const units = await Promise.all(scheduled.map((unit) => reviewUnit(unit, agent)))
    const skipped = candidates.slice(available).map((u) => u.id)
    const failed = units.filter((u) => !u.review).map((u) => u.id)
    const allIds = [...map.layers.map((l) => l.id), ...map.seams.map((s) => `${s.from}->${s.to}`)]
    const omitted = allIds.filter((id) => !selected.units.some((u) => u.id === id))
    const history =
      previous?.repo === reportOptions.repo && previous.headRef === scope.headRef
        ? previous.findings || []
        : []
    const known = history.filter((f) => !['resolved', 'refuted'].includes(f.lifecycle))
    const raw = units.flatMap((u) =>
      (u.review?.findings || []).map((f) => ({ ...f, unit: u.name, unitId: u.id }))
    )
    const merged = mergeFindings([...known, ...raw])
    const rawKeys = new Set(mergeFindings(raw).map((f) => f.fingerprint))
    const eligible = merged.filter(
      (f) =>
        !plan.incremental ||
        f.lifecycle === 'unverified' ||
        rawKeys.has(f.fingerprint) ||
        (plan.files.length && (plan.files.includes(f.file) || affected.has(f.unitId)))
    )
    const needsCheck = eligible
      .sort((a, b) => Number(b.lifecycle === 'unverified') - Number(a.lifecycle === 'unverified'))
      .slice(0, Number(opt.maxFindings ?? 12))
    const verification = needsCheck.length
      ? await agent(
          'verify:merged',
          prompts.verifyPrompt('all affected layers and known findings', needsCheck, context),
          { schema: VERDICT_SCHEMA }
        )
      : null
    let nextId = Math.max(0, ...history.map((f) => Number(f.id?.replace(/^F/, '')) || 0))
    const now = new Date().toISOString()
    const updated = merged.map((f) => {
      const old = history.find((h) => h.fingerprint === f.fingerprint)
      const index = needsCheck.indexOf(f)
      const verdicts = (verification?.verdicts || []).filter((v) => v.index === index)
      const verdict = index >= 0 && verdicts.length === 1 ? verdicts[0] : null
      const deferred = eligible.includes(f) && index < 0
      const lifecycle = verdict
        ? verdict.real
          ? 'open'
          : old
            ? verdict.resolution === 'resolved'
              ? 'resolved'
              : 'unverified'
            : 'refuted'
        : index >= 0 || deferred
          ? 'unverified'
          : f.lifecycle
      return {
        ...f,
        id: old?.id || `F${++nextId}`,
        lifecycle,
        severity: verdict?.severity || f.severity,
        verifyNote: verdict?.reason || f.verifyNote,
        firstSeen: old?.firstSeen || scope.headCommit,
        lastChecked: verdict ? scope.headCommit : old?.lastChecked,
        history: [
          ...(old?.history || []),
          ...(verdict
            ? [{ commit: scope.headCommit, lifecycle, reason: verdict.reason, at: now }]
            : []),
        ],
      }
    })
    const preserved = history.filter((f) => !updated.some((u) => u.id === f.id))
    // Absence from a fresh review is not proof that an old finding was fixed.
    const records = [
      ...preserved.map((f) => ({
        ...f,
        lifecycle:
          plan.incremental || ['resolved', 'refuted'].includes(f.lifecycle)
            ? f.lifecycle
            : 'unverified',
      })),
      ...updated,
    ]
    let findings = records.filter((f) => !['resolved', 'refuted'].includes(f.lifecycle))
    if (opt.guides) findings = await attributeFindings(scope, findings, agent, prompts)
    const prGuides = opt.guides
      ? await createGuides(
          scope,
          selected.layers,
          findings,
          agent,
          prompts,
          Number(opt.prGuideMin ?? 1500)
        )
      : []
    const verificationIncomplete =
      records.some((f) => f.lifecycle === 'unverified') ||
      eligible.length > needsCheck.length ||
      needsCheck.some(
        (_, i) => (verification?.verdicts || []).filter((v) => v.index === i).length !== 1
      )
    const pending = [...new Set([...skipped, ...failed, ...omitted])]
    const coverage = {
      mode: plan.incremental ? 'incremental' : 'baseline',
      reason: plan.reason,
      range: plan.range,
      reviewed: units.filter((u) => u.review).map((u) => u.id),
      skipped: pending,
      unaffected: selected.units.filter((u) => affected && !affected.has(u.id)).map((u) => u.id),
      verificationIncomplete,
      complete: !pending.length && !omitted.length && !verificationIncomplete,
    }
    const usage = runner.usage
    const savedUnits = new Map(
      (previous?.units || []).filter((u) => allIds.includes(u.id)).map((u) => [u.id, u])
    )
    for (const { prompt, ...unit } of units)
      if (unit.review) savedUnits.set(unit.id, { ...unit, reviewedCommit: scope.headCommit })
    const reportUnits = [...savedUnits.values()]
    const state = {
      version: 1,
      repo: reportOptions.repo,
      baseCommit: scope.baseCommit,
      headCommit: scope.headCommit,
      headRef: scope.headRef,
      baseRef: scope.base,
      policy: policy(opt),
      map,
      findings: records,
      units: reportUnits,
      pending,
      coverage,
      usage,
      runs: [
        ...(previous?.runs || []),
        { baseCommit: scope.baseCommit, headCommit: scope.headCommit, at: now, coverage, usage },
      ],
      publication: previous?.publication,
    }
    const file = writeDashboard(
      {
        range: context.range,
        repo: reportOptions.repo,
        agent: `${reportOptions.agent}${opt.model ? ` (${opt.model})` : ''}`,
        scope,
        map,
        units: reportUnits,
        findings,
        prGuides,
        failed,
        coverage,
        usage,
        findingHistory: records,
      },
      reportOptions
    )
    saveState(reportOptions.out, state)
    if (opt.publish) {
      state.publication = publishSummary(reportOptions.repo, opt.publish, state)
      saveState(reportOptions.out, state)
    }
    log(
      `done: ${findings.length} active findings; ${usage.calls}/${usage.maxCalls} calls; ${coverage.skipped.length} skipped units; token accounting: ${usage.tokensKnown ? usage.totalTokens : 'unavailable'}`
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
  const lockPath = resolve(out, '.review.lock')
  let lock
  try {
    lock = openSync(lockPath, 'wx')
  } catch {
    throw new Error(
      `Review output is locked: ${lockPath}. Wait for the active run; remove a stale lock only after confirming it has stopped.`
    )
  }
  try {
    console.log(await review(opt, options, log))
  } finally {
    closeSync(lock)
    unlinkSync(lockPath)
  }
}
