import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { collectSource } from '../src/report/source.mjs'
import { resolveAnchors } from '../src/report/anchors.mjs'
import { renderDashboard } from '../src/dashboard/render.mjs'

test('source uses the pinned Git tree, handles deletion/binary/size limits, and shows diffs', () => {
  const repo = mkdtempSync(join(tmpdir(), 'kasanome-source-'))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    writeFileSync(join(repo, 'a.ts'), 'const n = 1\n')
    writeFileSync(join(repo, 'deleted.txt'), 'old\n')
    git('add', '.')
    git('commit', '-qm', 'base')
    git('checkout', '-qb', 'feature')
    writeFileSync(join(repo, 'a.ts'), 'const n = 2\n')
    writeFileSync(join(repo, 'new file.ts'), 'const html = "</script><script>alert(1)</script>"\n')
    writeFileSync(join(repo, 'binary.bin'), Buffer.from([0, 1, 2]))
    writeFileSync(join(repo, 'large.txt'), 'x'.repeat(300001))
    rmSync(join(repo, 'deleted.txt'))
    symlinkSync('/etc/passwd', join(repo, 'link'))
    git('add', '.')
    git('commit', '-qm', 'head')
    const commit = git('rev-parse', 'HEAD').trim()
    writeFileSync(join(repo, 'a.ts'), 'uncommitted changes')
    const source = collectSource(repo, { base: 'main', head: 'feature' }, [], [])
    assert.equal(source.head, commit)
    const file = (path) => source.files.find((f) => f.path === path)
    assert.equal(file('a.ts').content, 'const n = 2\n')
    assert.match(file('a.ts').diff, /-const n = 1\n\+const n = 2/)
    assert.match(file('deleted.txt').error, /absent/)
    assert.match(file('deleted.txt').diff, /-old/)
    assert.match(file('binary.bin').error, /Binary/)
    assert.match(file('large.txt').error, /size limit/)
    assert.equal(file('link').content, '/etc/passwd')
    assert.equal(file('new file.ts').path, 'new file.ts')
    const pinned = collectSource(
      repo,
      { base: 'missing', head: 'missing', baseCommit: source.base, headCommit: commit },
      [],
      []
    )
    assert.equal(pinned.head, commit)
    assert.match(
      collectSource(repo, { base: 'missing', head: 'feature' }, [], []).error,
      /could not be resolved/
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

function client(data) {
  const html = renderDashboard(data)
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  const main = { innerHTML: '', scrollTop: 0 },
    nav = { innerHTML: '' },
    listeners = {}
  const document = {
    getElementById: (id) => (id === 'data' ? { textContent: JSON.stringify(data) } : null),
    querySelector: (s) => (s === '#main' ? main : s === '#nav' ? nav : null),
    addEventListener: (event, handler) => {
      listeners[event] = handler
    },
    body: { classList: { toggle: () => {} } },
  }
  const location = { hash: '#/code/a.ts/20/F1' }
  const sandbox = {
    document,
    location,
    localStorage: { getItem: () => null, setItem: () => {} },
    window: {
      addEventListener: (event, handler) => {
        listeners[event] = handler
      },
    },
  }
  runInNewContext(script, sandbox)
  return {
    html,
    main,
    mode: (value) =>
      listeners.click({
        target: {
          closest: (selector) =>
            selector === '[data-code-mode]' ? { dataset: { codeMode: value } } : null,
        },
      }),
    triage: (id, value) =>
      listeners.click({
        target: {
          closest: (selector) =>
            selector === '[data-triage]' ? { dataset: { triage: id, v: value } } : null,
        },
      }),
    navigate: (hash) => {
      location.hash = hash
      listeners.hashchange()
    },
  }
}

test('editor anchors multiple findings outside diff hunks and escapes source HTML', () => {
  const content = Array.from({ length: 30 }, (_, i) =>
    i === 19 ? '</script><img src=x onerror=alert(1)>' : 'line ' + (i + 1)
  ).join('\n')
  const finding = {
    id: 'F1',
    file: 'a.ts',
    line: 20,
    title: 'Issue',
    detail: 'Consequence',
    severity: 'medium',
    category: 'correctness',
    evidence: 'Proof',
    unit: 'Core',
    unitId: 'core',
  }
  const data = {
    range: 'main...HEAD',
    repo: '/repo',
    scope: { prs: [] },
    map: { layers: [] },
    layers: [],
    seams: [],
    units: [],
    findings: [finding, { ...finding, id: 'F2' }],
    source: {
      head: 'abc12345',
      files: [{ path: 'a.ts', content, diff: '@@ -1 +1 @@\n-old\n+new\n', changed: true }],
    },
  }
  const c = client(data)
  assert.doesNotMatch(c.html, /<img src=x onerror/)
  assert.match(c.main.innerHTML, /Unchanged context · finding at line 20/)
  assert.match(c.main.innerHTML, /id="line-20"/)
  assert.match(c.main.innerHTML, /id="f-F1"/)
  assert.match(c.main.innerHTML, /id="f-F2"/)
  assert.equal((c.main.innerHTML.match(/id="line-20"/g) || []).length, 1)
  assert.match(c.main.innerHTML, /&lt;\/script&gt;&lt;img/)
  c.mode('full')
  assert.equal((c.main.innerHTML.match(/class="code-row /g) || []).length, 30)
  c.triage('F1', 'raise')
  assert.match(c.main.innerHTML, /data-triage="F1" data-v="raise" class="on"/)
  c.navigate('#/findings')
  assert.match(c.main.innerHTML, /Findings/)
  c.navigate('#/finding/F1')
  assert.match(c.main.innerHTML, /selected-comment/)
  data.findings[0].line = 999
  const missing = client(data)
  assert.match(missing.main.innerHTML, /Line 999 is unavailable/)
  data.findings[0].anchor = { line: 1, status: 'evidence-match', reportedLine: 999 }
  const corrected = client(data)
  corrected.mode('full')
  const row1 = corrected.main.innerHTML.indexOf('id="line-1"')
  const comment = corrected.main.innerHTML.indexOf('id="f-F1"')
  const row2 = corrected.main.innerHTML.indexOf('id="line-2"')
  assert.ok(row1 < comment && comment < row2)
  assert.match(corrected.main.innerHTML, /reported L999 → source L1/)
  data.findings[0].anchor = {
    line: null,
    status: 'unresolved',
    reportedLine: 999,
    reason: 'Ambiguous evidence',
  }
  const unresolved = client(data)
  assert.match(unresolved.main.innerHTML, /Location needs checking/)
  assert.ok(
    unresolved.main.innerHTML.indexOf('id="f-F1"') >
      unresolved.main.innerHTML.indexOf('id="line-25"')
  )
})

test('finding locations use exact source evidence rather than an approximate agent line', () => {
  const source = {
    files: [
      {
        path: 'db.ts',
        content: [
          'interface Options {',
          '  /** Pool size. Default 10. */',
          '  max?: number;',
          '}',
          'export function createPool(url: string, opts: Options): Pool {',
          '  return new pg.Pool({',
          '    connectionString: url,',
          '  });',
          '}',
          'void recordSocketState(ctx, reason === undefined ? { state, at } : { state, at, reason });',
          'await sameCall(ctx);',
          'await sameCall(ctx);',
        ].join('\n'),
      },
    ],
  }
  const finding = {
    file: 'db.ts',
    line: 2,
    evidence:
      'export function createPool(url, opts) { return new pg.Pool({ connectionString: url, max: ... }); }',
  }
  const [matched] = resolveAnchors(source, [finding])
  assert.equal(matched.line, 2) // Retain the original report, independently of display location.
  assert.equal(matched.anchor.line, 6)
  assert.equal(matched.anchor.status, 'evidence-match')
  const [exact] = resolveAnchors(source, [{ ...finding, sourceExcerpt: 'return new pg.Pool({' }])
  assert.equal(exact.anchor.line, 6)
  assert.equal(exact.anchor.status, 'exact-excerpt')
  const [missing] = resolveAnchors(source, [
    { ...finding, sourceExcerpt: "pool.on('error', handler)" },
  ])
  assert.equal(missing.anchor.line, null)
  const [ambiguous] = resolveAnchors(source, [{ ...finding, evidence: 'await sameCall(ctx);' }])
  assert.equal(ambiguous.anchor.line, null)
  const [kept] = resolveAnchors(source, [
    { ...finding, line: 10, evidence: 'void recordSocketState(ctx, ...);' },
  ])
  assert.equal(kept.anchor.line, 10)
})
