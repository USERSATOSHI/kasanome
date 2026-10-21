import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

test('packed CLI, portable skills, and complete cached review', { timeout: 60000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kasanome-test-'))
  const home = join(dir, 'home')
  const repo = join(dir, 'repo')
  const prefix = join(dir, 'prefix')
  const env = { ...process.env, HOME: home, USERPROFILE: home }
  const run = (cmd, args, options = {}) =>
    execFileSync(cmd, args, {
      cwd: dir,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    })
  try {
    mkdirSync(home)
    mkdirSync(repo)
    const packed = JSON.parse(
      run('npm', ['pack', '--json', '--pack-destination', dir], { cwd: root })
    )[0]
    assert.ok(packed.files.some((f) => f.path === 'skills/kasanome/SKILL.md'))
    for (const file of ['LICENSE', 'NOTICE']) assert.ok(packed.files.some((f) => f.path === file))
    assert.ok(!packed.files.some((f) => /data\.json|\.cache|\.env/.test(f.path)))
    run('npm', [
      'install',
      '--prefix',
      prefix,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(dir, packed.filename),
    ])
    const cli = join(prefix, 'node_modules', 'kasanome', 'bin', 'kasanome.mjs')
    assert.equal(run(process.execPath, [cli, '--version']).trim(), '0.3.2')
    assert.match(run(process.execPath, [cli, '--help']), /--max-seams/)
    run(process.execPath, [cli, 'install', '--target', 'all'])
    for (const [target, parent] of [
      ['claude', '.claude'],
      ['codex', '.agents'],
    ]) {
      const skill = join(home, parent, 'skills', 'kasanome')
      assert.equal(JSON.parse(readFileSync(join(skill, 'scripts', 'install.json'))).agent, target)
      assert.ok(existsSync(join(skill, 'runtime', 'dist', 'dashboard.js')))
      for (const file of ['LICENSE', 'NOTICE'])
        assert.equal(
          readFileSync(join(skill, file), 'utf8'),
          readFileSync(join(root, file), 'utf8')
        )
      assert.match(run(process.execPath, [join(skill, 'scripts', 'run.mjs'), '--help']), /Usage:/)
    }
    const collision = spawnSync(process.execPath, [cli, 'install', '--target', 'all'], {
      env,
      encoding: 'utf8',
    })
    assert.equal(collision.status, 1)
    assert.match(collision.stderr, /already exists/)
    const customFile = join(home, '.agents', 'skills', 'kasanome', 'notes.txt')
    writeFileSync(customFile, 'keep')
    run(process.execPath, [cli, 'install', '--target', 'all', '--force'])
    assert.equal(readFileSync(customFile, 'utf8'), 'keep')
    run('git', ['init', '-q', repo])
    writeFileSync(join(repo, 'example.js'), 'export const n = 1\n')
    run('git', ['config', 'user.name', 'Test'], { cwd: repo })
    run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo })
    run('git', ['add', '.'], { cwd: repo })
    run('git', ['commit', '-qm', 'baseline'], { cwd: repo })
    run('git', ['branch', '-f', 'main'], { cwd: repo })
    const agent = join(dir, 'fake-agent.mjs')
    const calls = join(dir, 'calls')
    writeFileSync(
      agent,
      `
import { readFileSync, appendFileSync } from 'node:fs'
const input = readFileSync(0, 'utf8')
const args = process.argv.slice(2)
const schemaPath = process.env.KASANOME_SCHEMA_FILE || (args.includes('--output-schema') ? args[args.indexOf('--output-schema') + 1] : '')
const schema = schemaPath ? JSON.parse(readFileSync(schemaPath)) : null
const props = schema?.properties || {}
appendFileSync(process.env.TEST_CALLS, 'call\\n')
let result
if ('base' in props) result = { base: 'main', head: 'HEAD', headIsCheckedOut: true, filesChanged: 1, additions: 1, deletions: 0, languages: ['JavaScript'], topDirs: [{path:'example.js',files:1,lines:1}], specDocs: [], prs:[{number:1,title:'Example',headRef:'HEAD',baseRef:'main',additions:2000,deletions:0,url:''}] }
else if ('layers' in props) result = {overview:'Example system',layers:[{id:'core',name:'Core',purpose:'Example',paths:['example.js'],approxLines:1,contracts:['n'],dependsOn:[],backEdges:[]}],seams:[],tests:'Fixture'}
else if ('findings' in props) result = {summary:'Reviewed',readingOrder:[{path:'example.js',why:'entry'}],strengths:[],findings:[0,1].map(i=>({title:'Finding '+i,severity:'medium',category:'correctness',file:'example.js',line:1,detail:'Fixture consequence',evidence:'Fixture evidence',sourceExcerpt:'export const n = 1'}))}
else if ('verdicts' in props) result = {verdicts:[{index:0,real:true,severity:'low',reason:'Confirmed'},{index:1,real:false,severity:'medium',reason:'Refuted'}]}
else if ('attributions' in props) result = {attributions:[{id:'F1',introducedIn:1,status:'present-at-head',fixedIn:0}]}
else result = 'Shape: example reading guide'
console.log(typeof result === 'string' ? result : JSON.stringify(result))
`
    )
    const ghBin = join(dir, 'gh-bin')
    mkdirSync(ghBin)
    writeFileSync(
      join(ghBin, 'gh'),
      '#!/bin/sh\nprintf \'%s\\n\' \'{"number":1,"title":"Example","headRefName":"HEAD","baseRefName":"main","additions":2000,"deletions":0,"url":""}\'\n',
      { mode: 0o755 }
    )
    env.PATH = ghBin + ':' + env.PATH
    env.TEST_CALLS = calls
    // No model CLI or network is used: the custom agent returns controlled answers.
    const args = [
      cli,
      '--repo',
      repo,
      '--agent',
      'custom',
      '--agent-cmd',
      'node "$TEST_AGENT"',
      '--base',
      'main',
      '--guides',
      '--max-calls',
      '8',
    ]
    env.TEST_AGENT = agent
    run(process.execPath, args)
    const out = join(repo, 'kasanome')
    const data = JSON.parse(readFileSync(join(out, 'data.json')))
    assert.equal(data.findings.length, 1)
    assert.equal(data.findings[0].severity, 'low')
    assert.equal(data.findings[0].introducedIn, 1)
    assert.equal(data.prGuides.length, 1)
    assert.deepEqual(data.failed, [])
    const html = readFileSync(join(out, 'index.html'), 'utf8')
    assert.match(html, /Example system/)
    assert.match(html, /Finding 0/)
    const count = readFileSync(calls, 'utf8')
    assert.equal(count.trim().split('\n').length, 5)
    run(process.execPath, args)
    assert.equal(readFileSync(calls, 'utf8'), count)
    run(process.execPath, [cli, '--repo', repo, '--render', join(out, 'data.json')])
    assert.equal(readFileSync(calls, 'utf8'), count)
    assert.match(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8'), /\/kasanome\//)
    // The installed runtime survives removal of the npm package.
    rmSync(prefix, { recursive: true })
    const launcher = join(home, '.agents', 'skills', 'kasanome', 'scripts', 'run.mjs')
    assert.match(run(process.execPath, [launcher, '--help']), /Usage:/)
    // Verify the Codex skill selects its own backend without --agent.
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'codex'), '#!/bin/sh\nexec node "$TEST_AGENT" "$@"\n', { mode: 0o755 })
    env.PATH = bin + ':' + env.PATH
    run(process.execPath, [launcher, '--repo', repo, '--out', 'codex-report', '--base', 'main'])
    assert.equal(JSON.parse(readFileSync(join(repo, 'codex-report', 'data.json'))).agent, 'codex')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
