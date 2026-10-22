import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

function git(repo, ...args) {
  const result = execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return args.includes('-z') ? result : result.trim()
}

export function pinScope(repo, opt) {
  let base = opt.base
  if (!base) {
    for (const candidate of ['origin/HEAD', 'main', 'master']) {
      try {
        git(repo, 'rev-parse', '--verify', candidate + '^{commit}')
        base = candidate
        break
      } catch {
        /* try next */
      }
    }
  }
  if (!base) throw new Error('Cannot find a base commit; pass --base')
  const head = opt.head || 'HEAD'
  let headRef = head
  if (head === 'HEAD') {
    try {
      headRef = git(repo, 'symbolic-ref', '--short', 'HEAD')
    } catch {
      /* detached review */
    }
  }
  const baseCommit = git(repo, 'rev-parse', '--verify', '--end-of-options', base + '^{commit}')
  const headCommit = git(repo, 'rev-parse', '--verify', '--end-of-options', head + '^{commit}')
  const lines = git(repo, 'diff', '--numstat', baseCommit + '...' + headCommit)
    .split('\n')
    .filter(Boolean)
  let additions = 0,
    deletions = 0
  const topDirs = lines
    .map((line) => {
      const [a, d, ...parts] = line.split('\t')
      additions += Number(a) || 0
      deletions += Number(d) || 0
      return { path: parts.join('\t'), files: 1, lines: (Number(a) || 0) + (Number(d) || 0) }
    })
    .sort((a, b) => b.lines - a.lines)
  const areas = new Map()
  for (const item of topDirs) {
    const path = item.path.split('/').slice(0, 2).join('/')
    const area = areas.get(path) || { path, files: 0, lines: 0 }
    area.files++
    area.lines += item.lines
    areas.set(path, area)
  }
  const files = git(repo, 'ls-tree', '-r', '--name-only', headCommit).split('\n')
  return {
    base,
    head,
    headRef,
    baseCommit,
    headCommit,
    headIsCheckedOut: false,
    filesChanged: lines.length,
    additions,
    deletions,
    languages: [],
    topDirs: [...areas.values()].sort((a, b) => b.lines - a.lines).slice(0, 80),
    specDocs: opt.spec
      ? opt.spec.split(',')
      : files.filter((f) => /(^|\/)(README|ARCHITECTURE|spec|ADR)/i.test(f)).slice(0, 8),
    prs: [],
  }
}

function statePath(out, scope) {
  const key = createHash('sha256')
    .update(JSON.stringify([scope.repo, scope.baseRef || scope.base, scope.headRef]))
    .digest('hex')
    .slice(0, 24)
  return join(out, '.state', key + '.json')
}

export function loadState(out, scope) {
  const file = statePath(out, scope)
  if (!existsSync(file)) return null
  const state = JSON.parse(readFileSync(file, 'utf8'))
  if (state.version !== 1)
    throw new Error('Unsupported review state version; use another --out directory')
  return state
}

export function saveState(out, state) {
  mkdirSync(join(out, '.state'), { recursive: true })
  for (const file of [statePath(out, state), join(out, 'state.json')]) {
    const temp = file + '.tmp'
    writeFileSync(temp, JSON.stringify(state, null, 2))
    renameSync(temp, file)
  }
}

export function planReview(repo, scope, previous, opt) {
  let reason = 'first review'
  if (
    previous &&
    previous.repo === repo &&
    previous.headRef === scope.headRef &&
    previous.baseCommit === scope.baseCommit &&
    previous.policy === policy(opt) &&
    opt.mode !== 'full'
  ) {
    if (previous.headCommit === scope.headCommit)
      return {
        incremental: true,
        files: [],
        range: previous.headCommit + '..' + scope.headCommit,
        reason: 'no new commits since the last review',
      }
    try {
      git(repo, 'merge-base', '--is-ancestor', previous.headCommit, scope.headCommit)
      const files = git(repo, 'diff', '--name-only', '-z', previous.headCommit, scope.headCommit)
        .split('\0')
        .filter(Boolean)
      if (opt.reviewStyle === 'quick')
        return {
          incremental: true,
          files,
          range: previous.headCommit + '..' + scope.headCommit,
          reason: 'new commits for a focused diff review',
        }
      const unknown = files.some(
        (file) => !previous.map.layers.some((l) => l.paths.some((p) => matches(file, p)))
      )
      if (
        !unknown &&
        !files.some((f) =>
          /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|.*lock|ARCHITECTURE.*)$/.test(f)
        )
      )
        return {
          incremental: true,
          files,
          range: previous.headCommit + '..' + scope.headCommit,
          reason: 'descendant commits with mapped paths',
        }
      reason = 'new paths require a map refresh'
    } catch {
      reason = 'history diverged or previous commit unavailable'
    }
  } else if (previous)
    reason =
      opt.mode === 'full'
        ? 'full mode requested'
        : 'base, branch, repository, or review policy changed'
  return {
    incremental: false,
    files: [],
    range: scope.baseCommit + '...' + scope.headCommit,
    reason,
  }
}

export function policy(opt) {
  return JSON.stringify([
    opt.focus || '',
    opt.spec || '',
    opt.maxLayers || 6,
    opt.maxSeams ?? 3,
    opt.reviewStyle || 'layered',
    ...(opt.reviewStyle === 'quick' ? [opt.quickMaxChars ?? 16000, opt.quickMaxFiles ?? 5] : []),
  ])
}

function matches(file, path) {
  const prefix = path.replace(/\*.*$/, '').replace(/\/$/, '')
  return (
    file === prefix ||
    file.startsWith(prefix + '/') ||
    (path.includes('*') && file.startsWith(prefix))
  )
}

export function affectedUnits(map, plan, previous) {
  if (!plan.incremental) return null
  const affected = new Set(
    map.layers
      .filter((l) => plan.files.some((f) => l.paths.some((p) => matches(f, p))))
      .map((l) => l.id)
  )
  // Include direct consumers: changes to a producer can break its callers.
  const expanded = new Set([
    ...affected,
    ...map.layers.filter((l) => l.dependsOn.some((id) => affected.has(id))).map((l) => l.id),
  ])
  const ids = new Set(expanded)
  for (const seam of map.seams)
    if (expanded.has(seam.from) || expanded.has(seam.to)) ids.add(seam.from + '->' + seam.to)
  for (const id of previous?.pending || []) ids.add(id)
  return ids
}

export function mergeFindings(findings) {
  const merged = new Map()
  for (const finding of findings) {
    // Conservative identity: do not collapse different issues merely because they share a line.
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          finding.file,
          finding.category,
          finding.title
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim(),
          (finding.sourceExcerpt || finding.evidence || '').replace(/\s+/g, ' ').trim(),
        ])
      )
      .digest('hex')
      .slice(0, 16)
    const old = merged.get(key)
    if (old) {
      const origins = [...new Set([...old.origins, finding.unit].filter(Boolean))]
      const supportingEvidence = [
        ...new Set(
          [...(old.supportingEvidence || []), old.evidence, finding.evidence].filter(Boolean)
        ),
      ]
      Object.assign(old, finding, { fingerprint: key, origins, supportingEvidence })
    } else
      merged.set(key, {
        ...finding,
        fingerprint: key,
        origins: finding.origins || [finding.unit].filter(Boolean),
      })
  }
  return [...merged.values()]
}
