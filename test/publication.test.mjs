import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishSummary } from '../src/review/publication.mjs'

test('publication creates then updates the same owned comment and rejects a changed head', () => {
  const repo = mkdtempSync(join(tmpdir(), 'kasanome-publication-'))
  const originalPath = process.env.PATH
  const store = join(repo, 'comments.json')
  writeFileSync(store, '[]')
  writeFileSync(
    join(repo, 'gh-fixture.mjs'),
    `
import { readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const store = ${JSON.stringify(store)}
let result
if (args[0] === 'pr') result = { url: 'https://github.com/test/repo/pull/1', headRefOid: 'abc' }
else if (args.includes('user')) result = { login: 'owner' }
else if (args.includes('--method')) {
 const comments = JSON.parse(readFileSync(store))
 const body = JSON.parse(readFileSync(0, 'utf8')).body
 if (args.includes('PATCH')) comments[0].body = body
 else comments.push({ id: 42, html_url: 'https://github.com/test/repo/pull/1#issuecomment-42', body, user: { login: 'owner' } })
 writeFileSync(store, JSON.stringify(comments))
 result = comments[0]
} else result = [JSON.parse(readFileSync(store))]
console.log(JSON.stringify(result))
`,
    { mode: 0o755 }
  )
  writeFileSync(join(repo, 'gh'), '#!/bin/sh\nexec node "$(dirname "$0")/gh-fixture.mjs" "$@"\n', {
    mode: 0o755,
  })
  process.env.PATH = repo + ':' + originalPath
  const state = {
    headCommit: 'abc',
    findings: [],
    coverage: { complete: false, skipped: ['core'], verificationIncomplete: true },
    usage: { calls: 4, maxCalls: 4, tokensKnown: false },
  }
  try {
    assert.equal(publishSummary(repo, 1, state).commentId, 42)
    state.findings.push({
      id: 'F1',
      severity: 'high',
      lifecycle: 'open',
      title: 'Bug',
      file: 'core.js',
      line: 1,
      detail: 'Fails',
    })
    assert.equal(publishSummary(repo, 1, state).commentId, 42)
    const comments = JSON.parse(readFileSync(store))
    assert.equal(comments.length, 1)
    assert.match(comments[0].body, /F1/)
    assert.match(comments[0].body, /partial; not approval/)
    assert.throws(
      () => publishSummary(repo, 1, { ...state, headCommit: 'changed' }),
      /PR head changed/
    )
    assert.equal(readFileSync(store, 'utf8'), JSON.stringify(comments))
  } finally {
    process.env.PATH = originalPath
    rmSync(repo, { recursive: true, force: true })
  }
})
