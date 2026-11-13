import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { pinScope } from '../review/state.mjs'
import { prepareOutput } from '../report/output.mjs'
import { runScanners, writeScan } from '../scanners/run.mjs'

export async function runScan(opt) {
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: resolve(opt.repo || '.'),
    encoding: 'utf8',
  }).trim()
  const scope = pinScope(repo, opt)
  const out = resolve(repo, opt.out || 'kasanome/scan')
  const scan = await runScanners(
    repo,
    scope,
    { ...opt, scanners: opt.scanners || 'auto' },
    (message) => !opt.quiet && process.stderr.write(message + '\n')
  )
  if (!scan) throw new Error('No scanners selected; use --scanners auto or --sarif <file>')
  prepareOutput(repo, out)
  writeScan(out, scan)
  const result = {
    report: join(out, 'scanners.json'),
    sarif: join(out, 'scanners.sarif'),
    baseCommit: scan.baseCommit,
    headCommit: scan.headCommit,
    complete: scan.complete,
    verification: 'unchecked scanner candidates; no model calls',
    candidates: scan.candidates.length,
    advisories: scan.advisories.length,
    scanners: scan.scanners,
  }
  console.log(
    opt.json
      ? JSON.stringify(result)
      : [
          `Kasanome scan: ${scan.complete ? 'complete' : 'partial'} · ${result.candidates} unchecked candidates · ${result.advisories} outside-change advisories`,
          ...scan.scanners.map(
            (s) => `${s.name}: ${s.status}${s.reason ? ' (' + s.reason + ')' : ''}`
          ),
          `Report: ${result.report}`,
          `SARIF: ${result.sarif}`,
        ].join('\n')
  )
  if (!scan.complete) process.exitCode = 2
}
