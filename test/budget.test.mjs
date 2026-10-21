import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRunner } from '../src/agents/runner.mjs'

test('hard call cap includes retries and concurrent queued work', async () => {
  const out = mkdtempSync(tmpdir() + '/kasanome-budget-')
  const runner = createRunner({
    repo: out,
    out,
    opt: { agent: 'custom', agentCmd: 'exit 1', maxCalls: 2, retries: 3, concurrency: 2 },
    log: () => {},
  })
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => runner.agent('call' + i, 'Review ' + i))
    )
    assert.deepEqual(results, Array(5).fill(null))
    assert.equal(runner.usage.calls, 2)
    assert.equal(runner.usage.attempts.length, 2)
    assert.equal(runner.usage.tokensKnown, false)
    assert.equal(runner.remaining(), 0)
  } finally {
    runner.dispose()
    rmSync(out, { recursive: true, force: true })
  }
})

test('Codex, Claude, and OpenCode usage envelopes are counted without invoking providers', async () => {
  const out = mkdtempSync(tmpdir() + '/kasanome-usage-')
  const originalPath = process.env.PATH
  writeFileSync(
    out + '/fixture.mjs',
    `
import { readFileSync, writeFileSync, fstatSync } from 'node:fs'
readFileSync(0, 'utf8')
if (process.env.PWD !== process.cwd()) throw new Error('PWD differs from review repository')
const args = process.argv.slice(2)
if (args.includes('exec')) {
 writeFileSync(args[args.indexOf('-o') + 1], 'answer')
 console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 20 } }))
} else if (args.includes('run')) {
 if (!fstatSync(0).isFile()) throw new Error('OpenCode requires prompt-file stdin')
 if (!args.includes('--standalone') || args.indexOf('-m') > args.length - 2 || args.includes('-f')) throw new Error('Unexpected OpenCode arguments')
 console.log(JSON.stringify({ type: 'text', part: { messageID: 'old', text: 'interim text' } }))
 console.log(JSON.stringify({ type: 'text', part: { messageID: 'final', text: 'answer' } }))
 console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 30, write: 40 } } } }))
} else console.log(JSON.stringify({ result: 'answer', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 } }))
`
  )
  for (const name of ['codex', 'claude', 'opencode'])
    writeFileSync(out + '/' + name, '#!/bin/sh\nexec node "$(dirname "$0")/fixture.mjs" "$@"\n', {
      mode: 0o755,
    })
  process.env.PATH = out + ':' + originalPath
  try {
    for (const agent of ['codex', 'claude', 'opencode']) {
      const runner = createRunner({
        repo: out,
        out,
        opt: { agent, maxCalls: 2, model: 'test/free', opencodeStandalone: true },
        log: () => {},
      })
      try {
        assert.equal(await runner.agent('test', 'Return answer'), 'answer')
        assert.equal(
          runner.usage.totalTokens,
          agent === 'codex' ? 120 : agent === 'opencode' ? 105 : 100
        )
        assert.equal(runner.usage.tokensKnown, true)
        assert.equal(await runner.agent('test', 'Return answer'), 'answer')
        assert.equal(runner.usage.calls, 1)
        assert.equal(runner.usage.cacheHits, 1)
      } finally {
        runner.dispose()
      }
    }
  } finally {
    process.env.PATH = originalPath
    rmSync(out, { recursive: true, force: true })
  }
})
