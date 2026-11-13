import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { SCANNERS, scannerNames, parseNative } from './adapters.mjs'
import { parseSarif, toSarif } from './sarif.mjs'

function git(repo, ...args) {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// Materialize blobs directly: no checkout hooks, filters, submodules, or symlink traversal.
function snapshot(repo, head, root) {
  const files = [],
    omitted = []
  let bytes = 0
  const entries = git(repo, 'ls-tree', '-r', '-z', '--full-tree', head).split('\0').filter(Boolean)
  for (const entry of entries) {
    const [meta, file] = [entry.slice(0, entry.indexOf('\t')), entry.slice(entry.indexOf('\t') + 1)]
    const [mode, , oid] = meta.split(' ')
    if (!['100644', '100755'].includes(mode)) {
      omitted.push({ file, reason: 'symlink or submodule' })
      continue
    }
    if (
      file.split('/').some((part) => part === '..' || part.toLowerCase() === '.git') ||
      isAbsolute(file)
    )
      throw new Error('Unsafe path in scanner snapshot')
    if (files.length >= 10000) throw new Error('Scanner snapshot exceeds 10000 files')
    const blob = execFileSync('git', ['cat-file', 'blob', oid], {
      cwd: repo,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    bytes += blob.length
    if (bytes > 128 * 1024 * 1024) throw new Error('Scanner snapshot exceeds 128 MB')
    const target = join(root, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, blob, { mode: 0o600 })
    files.push(file)
  }
  return { files, omitted }
}

function changedLines(repo, scope) {
  const range = `${scope.baseCommit}...${scope.headCommit}`
  const paths = git(repo, 'diff', '--no-renames', '--name-only', '-z', range)
    .split('\0')
    .filter(Boolean)
  const changed = new Map()
  for (const file of paths) {
    const patch = git(
      repo,
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--unified=0',
      range,
      '--',
      file
    )
    const ranges = [...patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => {
      const start = Number(m[1]),
        count = m[2] === undefined ? 1 : Number(m[2])
      return count ? [start, start + count - 1] : [Math.max(1, start), Math.max(1, start + 1)]
    })
    changed.set(file, ranges)
  }
  return changed
}

function reportJson(path) {
  if (statSync(path).size > 16 * 1024 * 1024) throw new Error('Scanner report exceeds 16 MB')
  return JSON.parse(readFileSync(path, 'utf8'))
}

export async function runScanners(repo, scope, opt = {}, log = () => {}) {
  const names = scannerNames(opt.scanners)
  const imports = opt.sarif ? opt.sarif.split(',').map((p) => resolve(repo, p)) : []
  if (!names.length && !imports.length) return null
  const temp = mkdtempSync(join(tmpdir(), 'kasanome-scan-'))
  const root = join(temp, 'source')
  mkdirSync(root)
  try {
    const { files, omitted } = snapshot(repo, scope.headCommit, root)
    const changed = changedLines(repo, scope)
    const scanners = [],
      all = []
    const accept = (parsed, status) => {
      all.push(...parsed.candidates)
      status.omitted = parsed.omitted || 0
      if (status.omitted) status.status = 'partial'
      scanners.push(status)
      log(`scanner ${status.name}: ${status.status} (${parsed.candidates.length} candidates)`)
    }
    for (const name of names) {
      const adapter = SCANNERS[name]
      // Dependency checks examine all supported lockfiles, even when unchanged.
      const targets = files.filter(
        (file) =>
          adapter.matches(file) &&
          (name === 'gitleaks' || name === 'osv-scanner' || changed.has(file))
      )
      if (!targets.length) {
        scanners.push({ name, status: 'not-applicable', reason: 'no matching files in scope' })
        continue
      }
      if (opt.offline && adapter.network) {
        scanners.push({ name, status: 'skipped', reason: 'disabled by --offline' })
        continue
      }
      const report = join(temp, name + '.json')
      const started = Date.now()
      const result = spawnSync(name, adapter.args(targets, report, opt), {
        cwd: root,
        encoding: 'utf8',
        timeout: Number(opt.scannerTimeout ?? 120) * 1000,
        maxBuffer: 16 * 1024 * 1024,
        killSignal: 'SIGKILL',
        env: { ...process.env, SEMGREP_SEND_METRICS: 'off', SEMGREP_ENABLE_VERSION_CHECK: '0' },
      })
      const status = { name, status: 'ran', durationMs: Date.now() - started }
      if (result.error || ![0, 1].includes(result.status)) {
        status.status = result.error?.code === 'ENOENT' ? 'unavailable' : 'failed'
        status.reason =
          result.error?.code === 'ETIMEDOUT'
            ? 'timeout'
            : result.error?.code || `exit ${result.status ?? result.signal}`
        scanners.push(status)
        log(`scanner ${name}: ${status.status} (${status.reason})`)
        continue
      }
      try {
        const parsed =
          adapter.format === 'sarif'
            ? parseSarif(reportJson(report), root, name)
            : { candidates: parseNative(name, JSON.parse(result.stdout || 'null')), omitted: 0 }
        accept(parsed, status)
      } catch {
        scanners.push({
          ...status,
          status: 'failed',
          reason: 'invalid or unsuccessful scanner report',
        })
      }
    }
    for (const path of imports) {
      const name = 'sarif:' + relative(repo, path)
      try {
        // External report paths must name this repository, rather than an unrelated checkout.
        accept(parseSarif(reportJson(path), repo), { name, status: 'imported' })
      } catch {
        scanners.push({ name, status: 'failed', reason: 'cannot read a valid SARIF 2.1.0 report' })
      }
    }
    const candidates = [],
      advisories = [],
      seen = new Set()
    for (const raw of all) {
      let file = raw.file
      if (typeof file !== 'string') continue
      if (isAbsolute(file)) file = relative(root, file)
      file = file.replace(/^\.\//, '')
      if (!files.includes(file) || !Number.isInteger(raw.line) || raw.line < 1) {
        omitted.push({ file, reason: 'scanner location is outside the pinned snapshot' })
        continue
      }
      const text = readFileSync(join(root, file), 'utf8').split('\n')
      const endLine =
        Number.isInteger(raw.endLine) && raw.endLine >= raw.line ? raw.endLine : raw.line
      if (raw.line > text.length || endLine > text.length) {
        omitted.push({ file, reason: 'scanner location exceeds pinned source' })
        continue
      }
      const key = JSON.stringify([raw.scanner, raw.ruleId, file, raw.line, raw.detail])
      if (seen.has(key)) continue
      seen.add(key)
      const secret = /gitleaks/i.test(raw.scanner)
      const finding = {
        ...raw,
        file,
        endLine,
        title: `${raw.scanner}: ${raw.ruleId}`,
        category: 'scanner',
        evidence: `${raw.scanner} rule ${raw.ruleId}${secret ? ' at line ' + raw.line : ''}; automated candidate, requires verification.`,
        sourceExcerpt: secret
          ? ''
          : text.slice(raw.line - 1, Math.min(raw.line + 2, endLine)).join('\n'),
        unit: `Scanner: ${raw.scanner}`,
        unitId: `scanner:${raw.scanner}`,
        lifecycle: 'unverified',
      }
      if (secret)
        finding.detail = `Potential secret detected by ${raw.ruleId}; inspect the pinned source locally.`
      const touched = changed.get(file)?.some(([start, end]) => raw.line <= end && endLine >= start)
      ;(touched ? candidates : advisories).push(finding)
    }
    const identity = createHash('sha256')
      .update(
        JSON.stringify([
          names,
          opt.offline || false,
          opt.semgrepConfig || '',
          scanners.map(({ durationMs, ...s }) => s),
          candidates,
          advisories,
        ])
      )
      .digest('hex')
    return {
      baseCommit: scope.baseCommit,
      headCommit: scope.headCommit,
      identity,
      scanners,
      candidates,
      advisories,
      omitted,
      complete:
        !omitted.length &&
        scanners.every((s) => ['ran', 'imported', 'not-applicable'].includes(s.status)),
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

export function writeScan(out, scan) {
  writeFileSync(join(out, 'scanners.json'), JSON.stringify(scan, null, 2))
  writeFileSync(join(out, 'scanners.sarif'), JSON.stringify(toSarif(scan), null, 2))
}
