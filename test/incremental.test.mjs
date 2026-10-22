import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../bin/kasanome.mjs', import.meta.url))

test('bounded baseline, pending coverage, zero-call repeat, incremental fixes, and diverged history', () => {
  const repo = mkdtempSync(join(tmpdir(), 'kasanome-incremental-'))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  const fixture = join(repo, 'agent.mjs')
  try {
    git('init', '-qb', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    for (const path of ['core.js', 'ui.js', 'other.js']) writeFileSync(join(repo, path), 'safe\n')
    git('add', '.')
    git('commit', '-qm', 'base')
    git('checkout', '-qb', 'feature')
    writeFileSync(join(repo, 'core.js'), 'broken\n')
    git('add', '.')
    git('commit', '-qm', 'bug')
    const first = git('rev-parse', 'HEAD')
    writeFileSync(
      fixture,
      `
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const input = readFileSync(0, 'utf8')
const schema = JSON.parse(readFileSync(process.env.KASANOME_SCHEMA_FILE))
const broken = execFileSync('git', ['show', 'HEAD:core.js'], { encoding: 'utf8' }).includes('broken')
const finding = { title: 'Missing validation', severity: 'high', category: 'correctness', file: 'core.js', line: 1, sourceExcerpt: 'broken', evidence: 'broken', detail: 'Invalid input causes failure' }
let result
if (schema.properties.layers) result = { overview: 'Fixture', layers: ['core', 'ui', 'other'].map(id => ({ id, name: id, purpose: id, paths: [id + '.js'], approxLines: 1, contracts: [], dependsOn: id === 'ui' ? ['core'] : [], backEdges: [] })), seams: [{ from: 'core', to: 'ui', why: 'input', files: ['core.js', 'ui.js'] }], tests: '' }
else if (schema.properties.findings) result = { summary: 'Checked', readingOrder: [], strengths: [], findings: broken ? (process.env.TWO_FINDINGS ? ['First issue', 'Second issue'].map(title => ({ ...finding, title })) : [finding]) : [] }
else if (schema.properties.verdicts) result = { verdicts: [...input.matchAll(/^\\[(\\d+)\\]/gm)].map(m => ({ index: Number(m[1]), real: broken && !process.env.UNKNOWN, severity: 'high', reason: broken ? 'Confirmed' : 'Validation fixed', resolution: process.env.UNKNOWN ? 'unknown' : broken ? 'present' : 'resolved' })) }
else throw new Error('Unexpected phase')
console.log(JSON.stringify(result))
`
    )
    const args = [
      cli,
      '--repo',
      repo,
      '--mode',
      'incremental',
      '--base',
      'main',
      '--agent',
      'custom',
      '--agent-cmd',
      'node "$FIXTURE"',
    ]
    const env = { ...process.env, FIXTURE: fixture }
    const run = (...extra) =>
      execFileSync(process.execPath, [...args, ...extra], {
        env,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    const data = () => JSON.parse(readFileSync(join(repo, 'kasanome', 'data.json')))
    const state = () => JSON.parse(readFileSync(join(repo, 'kasanome', 'state.json')))
    run()
    assert.equal(data().usage.calls, 4)
    assert.equal(data().usage.tokensKnown, false)
    assert.equal(data().findings.length, 1)
    assert.equal(data().findings[0].origins.length, 2)
    assert.deepEqual(state().pending, ['other', 'core->ui'])
    const id = data().findings[0].id
    run()
    assert.equal(data().coverage.mode, 'incremental')
    assert.equal(data().usage.calls, 3)
    assert.deepEqual(data().coverage.skipped, [])
    assert.equal(data().findings[0].id, id)
    run()
    assert.equal(data().usage.calls, 0)
    assert.equal(data().coverage.reason, 'no new commits since the last review')
    writeFileSync(join(repo, 'core.js'), 'fixed\n')
    git('add', 'core.js')
    git('commit', '-qm', 'fix')
    run('--max-calls', '5')
    assert.equal(data().coverage.mode, 'incremental')
    assert.equal(data().usage.calls, 4)
    assert.equal(data().findings.length, 0)
    assert.equal(state().findings[0].id, id)
    assert.equal(state().findings[0].lifecycle, 'resolved')
    assert.equal(state().findings[0].lastChecked, git('rev-parse', 'HEAD'))
    assert.ok(state().findings[0].history.length >= 2)
    // A branch moving back invalidates incremental planning; the pinned commit also invalidates cache.
    git('reset', '--hard', first)
    run('--max-calls', '5')
    assert.equal(data().coverage.mode, 'baseline')
    assert.equal(data().findings[0].id, id)
    assert.equal(data().findings[0].lifecycle, 'open')
    assert.ok(data().usage.cacheHits > 0)
    env.TWO_FINDINGS = '1'
    run('--mode', 'full', '--max-calls', '6', '--max-findings', '1', '--fresh')
    assert.equal(data().findings.length, 3)
    assert.equal(data().findings.filter((f) => f.lifecycle === 'unverified').length, 2)
    assert.equal(data().coverage.verificationIncomplete, true)
    run('--max-calls', '2', '--max-findings', '1')
    assert.equal(data().findings.filter((f) => f.lifecycle === 'unverified').length, 1)
    run('--max-calls', '2', '--max-findings', '1')
    assert.equal(data().coverage.verificationIncomplete, false)
    env.UNKNOWN = '1'
    run('--mode', 'full', '--max-calls', '6', '--fresh')
    assert.ok(data().findings.every((f) => f.lifecycle === 'unverified'))
    assert.equal(state().findings.filter((f) => f.lifecycle === 'resolved').length, 0)
    assert.equal(data().coverage.verificationIncomplete, true)
    delete env.UNKNOWN
    run('--max-calls', '2')
    assert.ok(data().findings.every((f) => f.lifecycle === 'open'))
    git('checkout', '-qb', 'another', 'main')
    run()
    assert.equal(data().coverage.mode, 'baseline')
    // State is keyed per branch, so a different branch starts its own baseline.
    assert.equal(data().coverage.reason, 'first review')
    git('checkout', '-q', 'feature')
    run()
    assert.equal(data().usage.calls, 0)
    assert.equal(data().findings.length, 3)
    const invalid = spawnSync(process.execPath, [...args, '--token-budget', '1000'], {
      env,
      encoding: 'utf8',
    })
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /cannot enforce a hard token budget/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
