import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../src/cli/options.mjs'

const cli = fileURLToPath(new URL('../bin/kasanome.mjs', import.meta.url))

test('CLI rejects unknown options and supports aliases, equals syntax, and actionable help', () => {
  assert.deepEqual(
    parseArgs(['-a', 'codex', '-m', 'example/model', '--mode=quick', '-q', '--json']),
    { agent: 'codex', model: 'example/model', mode: 'quick', quiet: true, json: true }
  )
  assert.throws(() => parseArgs(['--max-call', '99']), /Unknown option: --max-call/)
  assert.throws(() => parseArgs(['--pr', '123', '--base', 'main']), /resolves its own base/)
  assert.throws(() => parseArgs(['--pr', '0']), /positive PR number/)
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /review --pr 123/)
  assert.match(result.stdout, /kasanome status/)
  assert.doesNotMatch(result.stdout, /agent-cmd/)
  assert.match(
    execFileSync(process.execPath, [cli, '--help-all'], { encoding: 'utf8' }),
    /--agent-cmd/
  )
})

test('PR shortcut fetches pinned refs without checkout, and status/JSON do not launch agents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kasanome-cli-'))
  const source = join(dir, 'source'),
    remote = join(dir, 'remote.git'),
    checkout = join(dir, 'checkout'),
    bin = join(dir, 'bin')
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    mkdirSync(source)
    mkdirSync(bin)
    git(source, 'init', '-qb', 'main')
    git(source, 'config', 'user.name', 'Test')
    git(source, 'config', 'user.email', 'test@example.invalid')
    writeFileSync(join(source, 'index.mjs'), 'export const n = 1\n')
    git(source, 'add', '.')
    git(source, 'commit', '-qm', 'base')
    const base = git(source, 'rev-parse', 'HEAD')
    writeFileSync(join(source, 'index.mjs'), 'export const n = 2\n')
    git(source, 'add', '.')
    git(source, 'commit', '-qm', 'PR change')
    const head = git(source, 'rev-parse', 'HEAD')
    git(dir, 'init', '--bare', remote)
    git(source, 'push', remote, `${base}:refs/heads/main`, `${head}:refs/pull/123/head`)
    git(dir, 'clone', '-q', '-b', 'main', remote, checkout)
    git(checkout, 'config', `url.${remote}.insteadOf`, 'https://github.com/test/repo.git')
    const dirty = 'export const n = 1\n// LOCAL_UNCOMMITTED_SENTINEL\n'
    writeFileSync(join(checkout, 'index.mjs'), dirty)
    const info = join(dir, 'pr.json'),
      calls = join(dir, 'calls.jsonl'),
      agent = join(dir, 'agent.mjs')
    writeFileSync(
      info,
      JSON.stringify({
        number: 123,
        url: 'https://github.com/test/repo/pull/123',
        title: 'Change n',
        baseRefName: 'main',
        headRefName: 'feature',
        additions: 1,
        deletions: 1,
        baseRefOid: base,
        headRefOid: head,
      })
    )
    writeFileSync(
      join(bin, 'gh.mjs'),
      `
import { readFileSync } from 'node:fs'
const info = JSON.parse(readFileSync(process.env.PR_INFO))
if (process.env.PR_MOVED && process.argv.includes(info.url)) info.headRefOid = 'f'.repeat(40)
console.log(JSON.stringify(info))
`
    )
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexec node "$(dirname "$0")/gh.mjs" "$@"\n', {
      mode: 0o755,
    })
    writeFileSync(
      agent,
      `
import { readFileSync, appendFileSync } from 'node:fs'
const prompt = readFileSync(0, 'utf8')
if (prompt.includes('LOCAL_UNCOMMITTED_SENTINEL')) throw new Error('Dirty working-tree content reached the reviewer')
if (!prompt.includes('+export const n = 2')) throw new Error('PR head patch missing')
appendFileSync(process.env.CALL_LOG, JSON.stringify({ prompt }) + '\\n')
console.log(JSON.stringify({ findings: [] }))
`
    )
    const env = {
      ...process.env,
      PATH: bin + ':' + process.env.PATH,
      PR_INFO: info,
      CALL_LOG: calls,
      TEST_AGENT: agent,
    }
    const run = (...args) =>
      spawnSync(process.execPath, [cli, ...args], { cwd: checkout, env, encoding: 'utf8' })
    const empty = run('status', '--json')
    assert.equal(empty.status, 0)
    assert.equal(JSON.parse(empty.stdout).report, null)
    const result = run(
      'review',
      '--pr',
      '123',
      '--agent',
      'custom',
      '--agent-cmd',
      'node "$TEST_AGENT"',
      '--json',
      '--quiet'
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.usage.calls, 1)
    assert.equal(summary.coverage.style, 'quick')
    assert.equal(git(checkout, 'rev-parse', 'HEAD'), base)
    assert.equal(git(checkout, 'branch', '--show-current'), 'main')
    assert.equal(readFileSync(join(checkout, 'index.mjs'), 'utf8'), dirty)
    assert.equal(git(checkout, 'rev-parse', 'refs/kasanome/pr/123/head'), head)
    const data = JSON.parse(readFileSync(join(checkout, 'kasanome', 'data.json')))
    assert.equal(data.scope.prs[0].number, 123)
    assert.equal(data.scope.headCommit, head)
    const before = readFileSync(calls, 'utf8')
    const status = run('status')
    assert.match(status.stdout, /Findings: 0 open/)
    assert.match(status.stdout, /Scope: supplied diff context/)
    assert.equal(JSON.parse(run('status', '--json').stdout).report, summary.report)
    assert.equal(readFileSync(calls, 'utf8'), before)
    assert.equal(run('status', '--agent', 'codex').status, 1)
    env.PR_MOVED = '1'
    const moved = run('review', '--pr', '123', '--out', 'moved-report')
    assert.equal(moved.status, 1)
    assert.match(moved.stderr, /PR changed during fetch/)
    assert.equal(existsSync(join(checkout, 'moved-report', 'data.json')), false)
    assert.equal(readFileSync(calls, 'utf8'), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
