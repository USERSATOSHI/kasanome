import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runScanners } from '../src/scanners/run.mjs'
import { parseSarif, toSarif } from '../src/scanners/sarif.mjs'
import { scannerNames } from '../src/scanners/adapters.mjs'
import { pinScope } from '../src/review/state.mjs'

const cli = fileURLToPath(new URL('../bin/kasanome.mjs', import.meta.url))
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'kasanome-scanner-test-'))
  const repo = join(dir, 'repo'),
    bin = join(dir, 'bin')
  mkdirSync(repo)
  mkdirSync(bin)
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  git('init', '-qb', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  writeFileSync(join(repo, 'run.sh'), '#!/bin/sh\necho old\necho unchanged\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feature')
  writeFileSync(join(repo, 'run.sh'), '#!/bin/sh\necho $value\necho unchanged\n')
  git('add', '.')
  git('commit', '-qm', 'change')
  const fake = (name, body) =>
    writeFileSync(join(bin, name), `#!${process.execPath}\n${body}\n`, { mode: 0o755 })
  const env = { ...process.env, PATH: bin + delimiter + process.env.PATH }
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [cli, ...args, '--repo', repo, '--base', 'main', '--json', '--quiet'],
      { env, encoding: 'utf8' }
    )
  return {
    dir,
    repo,
    bin,
    git,
    fake,
    env,
    run,
    scope: () => pinScope(repo, { base: 'main' }),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  }
}
function sarif(results, extra = {}) {
  return {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'example',
            rules: [{ id: 'R1', properties: { 'security-severity': '8.1' } }],
          },
        },
        results,
        ...extra,
      },
    ],
  }
}
function issue(file = 'run.sh', line = 2) {
  return {
    ruleId: 'R1',
    message: { text: 'Unsafe expansion' },
    locations: [
      { physicalLocation: { artifactLocation: { uri: file }, region: { startLine: line } } },
    ],
  }
}

test('SARIF normalizes severities and URI paths, rejects escapes, and honors suppressions', () => {
  const doc = sarif([
    issue('space%20name.sh'),
    issue('../outside.sh'),
    { ...issue(), suppressions: [{ kind: 'inSource' }] },
    issue('https://example.invalid/run.sh'),
  ])
  const parsed = parseSarif(doc, '/tmp/repo')
  assert.equal(parsed.candidates.length, 1)
  assert.equal(parsed.candidates[0].file, 'space name.sh')
  assert.equal(parsed.candidates[0].severity, 'high')
  assert.equal(parsed.omitted, 2)
  assert.throws(() => parseSarif({ runs: [] }, '/tmp/repo'), /SARIF 2.1.0/)
  assert.throws(
    () => parseSarif(sarif([], { invocations: [{ executionSuccessful: false }] }), '/tmp/repo'),
    /unsuccessful/
  )
  assert.throws(() => scannerNames('made-up'), /Unknown scanner/)
  assert.ok(!scannerNames('auto').includes('semgrep'))
})

test('scanner-only command scans the pinned commit, filters changed lines, and makes no model calls', () => {
  const f = fixture()
  try {
    f.fake(
      'shellcheck',
      `
const fs = require('node:fs')
if (!fs.readFileSync('./run.sh','utf8').includes('echo $value')) process.exit(9)
console.log(JSON.stringify({ comments: [
 {file:'./run.sh',line:2,endLine:2,level:'warning',code:2086,message:'Quote this expansion'},
 {file:'./run.sh',line:3,endLine:3,level:'warning',code:9999,message:'Outside changed lines'}
]})); process.exit(1)
`
    )
    writeFileSync(join(f.repo, 'run.sh'), 'DIRTY_WORKTREE_SENTINEL\n')
    const head = f.git('rev-parse', 'HEAD')
    const result = f.run('scan', '--scanners', 'shellcheck')
    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.candidates, 1)
    assert.equal(summary.advisories, 1)
    assert.match(summary.verification, /no model calls/)
    const data = JSON.parse(readFileSync(summary.report))
    assert.equal(data.candidates[0].sourceExcerpt, 'echo $value')
    assert.equal(data.candidates[0].lifecycle, 'unverified')
    assert.equal(f.git('rev-parse', 'HEAD'), head)
    assert.equal(readFileSync(join(f.repo, 'run.sh'), 'utf8'), 'DIRTY_WORKTREE_SENTINEL\n')
    assert.equal(existsSync(join(f.repo, 'kasanome', 'state.json')), false)
    const exported = toSarif(data)
    assert.equal(exported.runs[0].results.length, 2)
    assert.equal(exported.runs[0].results[1].properties.inChangedLines, false)
  } finally {
    f.dispose()
  }
})

test('scanner failures, timeout, offline skips, malformed imports, and snapshot omissions stay visible', async () => {
  const f = fixture()
  try {
    f.fake('shellcheck', 'console.log("not JSON")')
    let result = f.run('scan', '--scanners', 'shellcheck')
    assert.equal(result.status, 2)
    assert.equal(JSON.parse(result.stdout).scanners[0].status, 'failed')
    f.fake('shellcheck', 'setTimeout(() => {}, 10000)')
    result = f.run('scan', '--scanners', 'shellcheck', '--scanner-timeout', '1')
    assert.equal(result.status, 2)
    assert.equal(JSON.parse(result.stdout).scanners[0].reason, 'timeout')
    writeFileSync(join(f.repo, 'report.sarif'), 'invalid')
    const invalid = await runScanners(f.repo, f.scope(), { sarif: 'report.sarif' })
    assert.equal(invalid.complete, false)
    assert.equal(invalid.scanners[0].status, 'failed')
    writeFileSync(join(f.repo, 'app.js'), 'eval(input)\n')
    symlinkSync('/etc/passwd', join(f.repo, 'external'))
    f.git('add', 'app.js', 'external')
    f.git('commit', '-qm', 'code and link')
    const offline = await runScanners(f.repo, f.scope(), { scanners: 'semgrep', offline: true })
    assert.equal(offline.scanners[0].status, 'skipped')
    assert.equal(offline.omitted[0].file, 'external')
    assert.equal(offline.complete, false)
  } finally {
    f.dispose()
  }
})

test('SARIF candidates are verified, persist across runs, and retain IDs after a fix', () => {
  const f = fixture()
  try {
    const report = join(f.repo, 'external.sarif')
    writeFileSync(report, JSON.stringify(sarif([issue(), issue('run.sh', 3)])))
    const agent = join(f.dir, 'agent.mjs')
    writeFileSync(
      agent,
      `
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const p = readFileSync(0,'utf8')
const schema = JSON.parse(readFileSync(process.env.KASANOME_SCHEMA_FILE))
if (schema.properties.findings) console.log(JSON.stringify({findings:[]}))
else {
 const head = p.match(/git show ([a-f0-9]+):/)?.[1]
 if (!head) throw new Error('Scanner verification must read pinned source')
 const bad = execFileSync('git',['show',head+':run.sh'],{encoding:'utf8'}).includes('$value')
 console.log(JSON.stringify({verdicts:[...p.matchAll(/^\\[(\\d+)\\]/gm)].map(m=>({index:Number(m[1]),real:bad,severity:'medium',reason:bad?'Expansion is unquoted':'Expansion was removed',resolution:bad?'present':'resolved'}))}))
}
`
    )
    f.env.TEST_AGENT = agent
    const review = (...extra) =>
      f.run(
        'review',
        '--sarif',
        'external.sarif',
        '--agent',
        'custom',
        '--agent-cmd',
        'node "$TEST_AGENT"',
        ...extra
      )
    let result = review()
    assert.equal(result.status, 0, result.stderr)
    let data = JSON.parse(readFileSync(join(f.repo, 'kasanome', 'data.json')))
    assert.equal(data.findings.length, 1)
    assert.equal(data.findings[0].lifecycle, 'open')
    assert.equal(data.scan.advisories.length, 1)
    const id = data.findings[0].id
    result = review()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).usage.calls, 0)
    writeFileSync(join(f.repo, 'run.sh'), '#!/bin/sh\necho fixed\necho unchanged\n')
    f.git('add', 'run.sh')
    f.git('commit', '-qm', 'fix')
    writeFileSync(report, JSON.stringify(sarif([])))
    result = review()
    assert.equal(result.status, 0, result.stderr)
    data = JSON.parse(readFileSync(join(f.repo, 'kasanome', 'data.json')))
    assert.equal(data.findings.length, 0)
    assert.equal(data.findingHistory.find((x) => x.id === id).lifecycle, 'resolved')
  } finally {
    f.dispose()
  }
})

test('scanner candidates remain unverified when the agent budget cannot verify them', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.repo, 'external.sarif'), JSON.stringify(sarif([issue()])))
    const agent = join(f.dir, 'empty.mjs')
    writeFileSync(
      agent,
      `console.log(JSON.stringify({overview:'Fixture',layers:[{id:'core',name:'Core',purpose:'Shell',paths:['run.sh'],approxLines:1,contracts:[],dependsOn:[],backEdges:[]}],seams:[],tests:''}))\n`
    )
    f.env.TEST_AGENT = agent
    const result = f.run(
      'review',
      '--mode',
      'incremental',
      '--sarif',
      'external.sarif',
      '--max-calls',
      '1',
      '--agent',
      'custom',
      '--agent-cmd',
      'node "$TEST_AGENT"'
    )
    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.findings.open, 0)
    assert.equal(summary.findings.unverified, 1)
    assert.equal(summary.coverage.complete, false)
  } finally {
    f.dispose()
  }
})

test('network adapters use explicit rules and every lockfile; unavailable tools remain partial', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.repo, 'app.js'), 'eval(input)\n')
    writeFileSync(join(f.repo, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n')
    f.git('add', '.')
    f.git('commit', '-qm', 'lockfile baseline')
    f.git('branch', '-f', 'main')
    writeFileSync(join(f.repo, 'app.js'), 'eval(otherInput)\n')
    f.git('add', 'app.js')
    f.git('commit', '-qm', 'code change')
    const body = `
const fs = require('node:fs'), path = require('node:path')
const args = process.argv.slice(2), name = path.basename(process.argv[1])
if (name === 'semgrep' && (!args.includes('--metrics=off') || !args.includes('p/security-audit') || process.env.SEMGREP_SEND_METRICS !== 'off')) process.exit(9)
if (name === 'osv-scanner' && (!args.includes('./package-lock.json') || args[0] !== 'scan' || args[1] !== 'source')) process.exit(9)
const file = name === 'semgrep' ? 'app.js' : 'package-lock.json'
fs.writeFileSync(args[args.indexOf('--output')+1], JSON.stringify({version:'2.1.0',runs:[{tool:{driver:{name}},results:[{ruleId:'network-rule',message:{text:'Automated evidence'},locations:[{physicalLocation:{artifactLocation:{uri:file},region:{startLine:1}}}]}]}]}))
process.exit(1)
`
    f.fake('semgrep', body)
    f.fake('osv-scanner', body)
    let result = f.run('scan', '--scanners', 'semgrep,osv-scanner')
    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.candidates, 1)
    assert.equal(summary.advisories, 1)
    assert.ok(summary.scanners.every((s) => s.status === 'ran'))
    symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(f.bin, 'git'))
    f.env.PATH = f.bin
    result = f.run('scan', '--scanners', 'gitleaks')
    assert.equal(result.status, 2, result.stderr)
    assert.equal(JSON.parse(result.stdout).scanners[0].status, 'unavailable')
  } finally {
    f.dispose()
  }
})

test('SARIF supports artifact indexes, URI bases, omitted regions and empty runs', () => {
  const finding = issue()
  finding.locations[0].physicalLocation.artifactLocation = { index: 0 }
  const parsed = parseSarif(
    sarif([finding, { ruleId: 'no-location', message: { text: 'No region' } }], {
      artifacts: [{ location: { uri: 'run.sh', uriBaseId: 'ROOT' } }],
      originalUriBaseIds: { ROOT: { uri: 'file:///tmp/repo/' } },
    }),
    '/tmp/repo'
  )
  assert.equal(parsed.candidates[0].file, 'run.sh')
  assert.equal(parsed.omitted, 1)
  assert.deepEqual(
    parseSarif({ version: '2.1.0', runs: [{ tool: { driver: { name: 'empty' } } }] }, '/tmp/repo'),
    { candidates: [], omitted: 0 }
  )
})

test('a one-call quick scan verifies first and resumes the entire deferred diff on the next run', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.repo, 'external.sarif'), JSON.stringify(sarif([issue()])))
    const agent = join(f.dir, 'agent.mjs')
    writeFileSync(
      agent,
      `
import {readFileSync} from 'node:fs'
const prompt = readFileSync(0,'utf8'), schema = JSON.parse(readFileSync(process.env.KASANOME_SCHEMA_FILE))
if (schema.properties.findings) {
 if (!prompt.includes('+echo $value')) throw new Error('Deferred diff was lost')
 console.log(JSON.stringify({findings:[]}))
} else console.log(JSON.stringify({verdicts:[{index:0,real:true,severity:'medium',reason:'Unquoted expansion',resolution:'present'}]}))
`
    )
    f.env.TEST_AGENT = agent
    const run = () =>
      f.run(
        'review',
        '--sarif',
        'external.sarif',
        '--max-calls',
        '1',
        '--agent',
        'custom',
        '--agent-cmd',
        'node "$TEST_AGENT"'
      )
    let result = run()
    assert.equal(result.status, 0, result.stderr)
    let summary = JSON.parse(result.stdout)
    assert.equal(summary.findings.open, 1)
    assert.equal(summary.coverage.complete, false)
    const state = JSON.parse(readFileSync(join(f.repo, 'kasanome', 'state.json')))
    assert.deepEqual(state.quick.pendingFiles, ['run.sh'])
    result = run()
    assert.equal(result.status, 0, result.stderr)
    summary = JSON.parse(result.stdout)
    assert.equal(summary.usage.calls, 1)
    assert.equal(summary.coverage.complete, true)
    result = run()
    assert.equal(JSON.parse(result.stdout).usage.calls, 0)
  } finally {
    f.dispose()
  }
})
