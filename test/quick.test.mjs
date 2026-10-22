import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../bin/kasanome.mjs', import.meta.url))
const original =
  'export function reserve(stock, quantity) {\n  if (quantity < 0 || quantity > stock) throw new Error("Invalid quantity");\n  return stock - quantity;\n}\n'
const broken = original.replace('quantity < 0 || ', '')

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'kasanome-quick-'))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-qb', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  writeFileSync(join(repo, 'inventory.mjs'), original)
  writeFileSync(join(repo, 'README.md'), 'Negative quantities must be rejected.\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feature')
  const agent = join(repo, 'fake-agent.mjs'),
    log = join(repo, 'calls.jsonl')
  writeFileSync(
    agent,
    `
import { readFileSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const prompt = readFileSync(0, 'utf8')
const schema = JSON.parse(readFileSync(process.env.KASANOME_SCHEMA_FILE))
appendFileSync(process.env.TEST_LOG, JSON.stringify({ prompt, schema }) + '\\n')
const head = prompt.match(/"headCommit":"([a-f0-9]+)"/)?.[1]
let result
if (schema.properties.layers) {
 result = { overview: 'Architectural fixture', layers: [{ id: 'core', name: 'Core', purpose: 'Example', paths: ['inventory.mjs'], approxLines: 1, contracts: [], dependsOn: [], backEdges: [] }], seams: [], tests: '' }
} else {
 if (!head) throw new Error('Quick context must be pinned')
 const source = execFileSync('git', ['show', head + ':inventory.mjs'], { encoding: 'utf8' })
 const bad = !source.includes('quantity < 0')
 if (schema.properties.findings) result = { findings: bad ? [{ title: 'Negative quantity accepted', category: 'correctness', severity: 'high', file: 'inventory.mjs', line: 2, detail: 'Negative reservations increase stock.', evidence: 'The diff removes the negative quantity guard.', sourceExcerpt: '  if (quantity > stock) throw new Error("Invalid quantity");' }] : [] }
 else if (schema.properties.verdicts) result = { verdicts: [...prompt.matchAll(/^\\[(\\d+)\\]/gm)].map(m => ({ index: Number(m[1]), real: bad, severity: 'high', reason: bad ? 'The negative guard was removed.' : 'The negative guard is restored.', resolution: bad ? 'present' : 'resolved' })) }
 else throw new Error('Unexpected phase')
}
console.log(JSON.stringify(result))
`
  )
  git('add', 'fake-agent.mjs')
  git('commit', '-qm', 'test harness')
  // Keep the fixture harness outside the reviewed range.
  git('branch', '-f', 'main')
  const run = (...extra) =>
    execFileSync(
      process.execPath,
      [
        cli,
        '--repo',
        repo,
        '--base',
        'main',
        '--prs',
        'none',
        '--agent',
        'custom',
        '--agent-cmd',
        'node "$TEST_AGENT"',
        ...extra,
      ],
      {
        env: { ...process.env, TEST_AGENT: agent, TEST_LOG: log },
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )
  const data = () => JSON.parse(readFileSync(join(repo, 'kasanome', 'data.json')))
  const state = () => JSON.parse(readFileSync(join(repo, 'kasanome', 'state.json')))
  const calls = () => {
    try {
      return readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    } catch {
      return []
    }
  }
  const commit = (message) => {
    git('add', 'inventory.mjs')
    git('commit', '-qm', message)
  }
  return {
    repo,
    git,
    run,
    data,
    state,
    calls,
    commit,
    dispose: () => rmSync(repo, { recursive: true, force: true }),
  }
}

test('auto quick review uses pinned context, no map, and verifies a finding; fixes keep the same ID', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.repo, 'inventory.mjs'), broken)
    f.commit('regression')
    writeFileSync(join(f.repo, 'inventory.mjs'), 'UNCOMMITTED_SENTINEL\n')
    f.run()
    assert.equal(f.data().coverage.style, 'quick')
    assert.equal(f.data().usage.calls, 2)
    assert.equal(f.data().coverage.complete, true)
    assert.equal(f.data().findings.length, 1)
    assert.equal(f.data().findings[0].lifecycle, 'open')
    const id = f.data().findings[0].id
    assert.equal(
      f.calls().some((c) => c.schema.properties.layers),
      false
    )
    assert.ok(f.calls().every((c) => !c.prompt.includes('UNCOMMITTED_SENTINEL')))
    assert.ok(f.calls().every((c) => c.prompt.includes('Do not use tools')))
    assert.ok(f.calls()[0].prompt.includes('-  if (quantity < 0'))
    assert.ok(f.data().coverage.contextChars <= 16000)
    f.run()
    assert.equal(f.data().usage.calls, 0)
    assert.equal(f.calls().length, 2)
    writeFileSync(join(f.repo, 'inventory.mjs'), original)
    f.commit('fix')
    f.run()
    assert.equal(f.data().usage.calls, 2)
    assert.equal(f.data().coverage.mode, 'incremental')
    assert.equal(f.data().findings.length, 0)
    assert.equal(f.state().findings[0].id, id)
    assert.equal(f.state().findings[0].lifecycle, 'resolved')
    f.run()
    assert.equal(f.data().usage.calls, 0)
  } finally {
    f.dispose()
  }
})

test('one-call budget preserves unverified findings and resumes verification without rediscovery', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.repo, 'inventory.mjs'), broken)
    f.commit('regression')
    f.run('--mode', 'quick', '--max-calls', '1')
    assert.equal(f.data().usage.calls, 1)
    assert.equal(f.data().findings[0].lifecycle, 'unverified')
    assert.equal(f.data().coverage.verificationIncomplete, true)
    const id = f.data().findings[0].id
    f.run('--mode', 'quick', '--max-calls', '1')
    assert.equal(f.data().usage.calls, 1)
    assert.equal(f.data().findings[0].id, id)
    assert.equal(f.data().findings[0].lifecycle, 'open')
    assert.equal(f.data().coverage.complete, true)
    assert.equal(f.calls().filter((c) => c.schema.properties.findings).length, 1)
  } finally {
    f.dispose()
  }
})

test('quick review uses one call with no findings and continues skipped files against their full diff', () => {
  const f = fixture()
  try {
    for (const file of ['a.mjs', 'b.mjs', 'c.mjs'])
      writeFileSync(join(f.repo, file), 'export const value = 1\n')
    f.git('add', 'a.mjs', 'b.mjs', 'c.mjs')
    f.git('commit', '-qm', 'small additions')
    for (const remaining of [2, 1, 0]) {
      f.run('--quick-max-files', '1')
      assert.equal(f.data().usage.calls, 1)
      assert.equal(f.state().quick.pendingFiles.length, remaining)
      assert.ok(f.calls().at(-1).prompt.includes('+export const value = 1'))
    }
    f.run('--quick-max-files', '1')
    assert.equal(f.data().usage.calls, 0)
    assert.equal(f.data().coverage.complete, true)
  } finally {
    f.dispose()
  }
})

test('oversized and binary patches are explicitly skipped with zero model calls', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.repo, 'large.mjs'), 'export const text = "' + 'x'.repeat(6000) + '"\n')
    writeFileSync(join(f.repo, 'image.bin'), Buffer.from([0, 1, 2]))
    f.git('add', 'large.mjs', 'image.bin')
    f.git('commit', '-qm', 'large and binary')
    f.run('--mode', 'quick', '--quick-max-chars', '1000')
    assert.equal(f.data().usage.calls, 0)
    assert.equal(f.data().coverage.complete, false)
    assert.deepEqual(f.state().quick.pendingFiles.sort(), ['image.bin', 'large.mjs'])
    assert.ok(f.data().coverage.skippedFiles.some((x) => x.reason === 'context character limit'))
    assert.ok(f.data().coverage.skippedFiles.some((x) => x.reason === 'binary diff'))
    f.run('--mode', 'quick', '--quick-max-chars', '1000')
    assert.equal(f.data().usage.calls, 0)
    f.run('--mode', 'quick', '--quick-max-chars', '12000')
    assert.equal(f.data().usage.calls, 1)
    assert.deepEqual(f.state().quick.pendingFiles, ['image.bin'])
  } finally {
    f.dispose()
  }
})

test('quick context includes pinned direct contracts and preserves whitespace in changed paths', () => {
  const f = fixture()
  try {
    writeFileSync(
      join(f.repo, 'inventory.mjs'),
      "import { maximum } from './limits.js'\n" + original
    )
    writeFileSync(
      join(f.repo, 'limits.js'),
      'export const maximum = "RELEVANT_CONTRACT_SENTINEL"\n'
    )
    writeFileSync(join(f.repo, ' spaced.mjs'), 'export const x = 1\n')
    f.git('add', 'inventory.mjs', 'limits.js', ' spaced.mjs')
    f.git('commit', '-qm', 'contract fixture')
    f.git('branch', '-f', 'main')
    writeFileSync(
      join(f.repo, 'inventory.mjs'),
      "import { maximum } from './limits.js'\n" + original + '// Uses a local contract.\n'
    )
    f.commit('small change')
    f.run()
    assert.ok(f.calls()[0].prompt.includes('RELEVANT_CONTRACT_SENTINEL'))
    assert.ok(f.data().coverage.contextFiles.includes('limits.js'))
    const context = JSON.parse(f.calls()[0].prompt.split('Git context: ')[1].split('\n\n---')[0])
    assert.equal(JSON.stringify(context).length, f.data().coverage.contextChars)
    writeFileSync(join(f.repo, ' spaced.mjs'), 'export const x = 2\n')
    f.git('add', ' spaced.mjs')
    f.git('commit', '-qm', 'whitespace filename')
    f.run()
    assert.ok(f.data().coverage.reviewedFiles.includes(' spaced.mjs'))
    assert.ok(f.calls().at(-1).prompt.includes('+export const x = 2'))
  } finally {
    f.dispose()
  }
})

test('auto selects layered review for larger diffs, and incremental explicitly keeps architectural mode', () => {
  const f = fixture()
  try {
    for (let i = 0; i < 6; i++) writeFileSync(join(f.repo, `part-${i}.mjs`), 'export const n = 1\n')
    f.git('add', ...Array.from({ length: 6 }, (_, i) => `part-${i}.mjs`))
    f.git('commit', '-qm', 'larger scope')
    // The fake harness deliberately cannot review architectural prompts; assert the planner
    // selected mapping before the later review fails, rather than silently choosing quick.
    f.run('--max-calls', '1')
    assert.equal(f.data().coverage.style, 'layered')
    assert.ok(f.calls()[0].schema.properties.layers)
    f.run('--mode', 'quick')
    assert.equal(f.data().coverage.style, 'quick')
    f.run('--mode', 'incremental', '--max-calls', '1')
    assert.equal(f.data().coverage.style, 'layered')
  } finally {
    f.dispose()
  }
})
