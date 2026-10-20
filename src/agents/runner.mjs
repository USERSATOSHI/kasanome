import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdapter } from './adapters.mjs'
import { validate, extractJson, strictSchema } from './structured.mjs'

export function createRunner({ repo: repo, out: out, opt, log }) {
  const agentName = opt.agent || 'claude'
  const concurrency = Number(opt.concurrency || 4)
  const timeoutMs = Number(opt.timeout || 30) * 60_000
  const adapter = createAdapter(opt)
  let active = 0
  const queue = []
  async function limit(fn) {
    if (active >= concurrency) await new Promise((r) => queue.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      queue.shift()?.()
    }
  }

  const cache = join(out, '.cache')
  let work
  function initWorkDirs() {
    mkdirSync(cache, { recursive: true })
    work = mkdtempSync(join(tmpdir(), 'kasanome-'))
    process.once('exit', dispose)
  }

  function exec({ cmd, args, stdin, env }) {
    return new Promise((res, rej) => {
      const p = spawn(cmd, args, {
        cwd: repo,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let out = '',
        err = ''
      const timer = setTimeout(() => {
        p.kill('SIGTERM')
        rej(new Error(`timed out after ${timeoutMs / 60000} min`))
      }, timeoutMs)
      p.stdout.on('data', (d) => {
        out += d
      })
      p.stderr.on('data', (d) => {
        err += d
      })
      p.on('error', (e) => {
        clearTimeout(timer)
        rej(e)
      })
      p.on('close', (code) => {
        clearTimeout(timer)
        code === 0 ? res(out) : rej(new Error(`${cmd} exited ${code}: ${err.slice(-2000)}`))
      })
      p.stdin.end(stdin)
    })
  }
  async function agent(label, prompt, { schema } = {}) {
    const full = schema
      ? `${prompt}\n\n---\nOUTPUT FORMAT: Your final answer must be ONLY one JSON object matching this JSON Schema, inside a single \`\`\`json fenced block. No prose after it.\n\`\`\`json\n${JSON.stringify(schema)}\n\`\`\``
      : prompt
    const key = createHash('sha256')
      .update(`${agentName}|${opt.model || ''}|${full}`)
      .digest('hex')
      .slice(0, 16)
    const cacheFile = join(cache, `${key}.json`)
    if (!opt.fresh && existsSync(cacheFile)) {
      log(`${label}: cached`)
      return JSON.parse(readFileSync(cacheFile, 'utf8'))
    }

    return limit(async () => {
      let attemptPrompt = full
      for (let attempt = 1; attempt <= 3; attempt++) {
        const id = `${key}-${attempt}`
        const promptFile = join(work, `${id}.prompt.md`)
        const outFile = join(work, `${id}.out.txt`)
        let schemaFile
        writeFileSync(promptFile, attemptPrompt)
        if (schema && agentName === 'codex') {
          schemaFile = join(work, `${id}.schema.json`)
          writeFileSync(schemaFile, JSON.stringify(strictSchema(schema)))
        }
        if (schema && agentName === 'custom') {
          schemaFile = join(work, `${id}.schema.json`)
          writeFileSync(schemaFile, JSON.stringify(schema))
        }
        log(`${label}: running${attempt > 1 ? ` (retry ${attempt - 1})` : ''}`)
        try {
          const spec = adapter({ prompt: attemptPrompt, promptFile, outFile, schemaFile })
          const stdout = await exec(spec)
          const text = (
            spec.outFile && existsSync(spec.outFile) ? readFileSync(spec.outFile, 'utf8') : stdout
          ).trim()
          let result = text
          if (schema) {
            result = extractJson(text)
            const err = validate(schema, result)
            if (err) throw new Error(`schema violation: ${err}`)
          }
          writeFileSync(cacheFile, JSON.stringify(result))
          log(`${label}: done`)
          return result
        } catch (e) {
          log(`${label}: attempt ${attempt} failed: ${e.message.split('\n')[0]}`)
          if (attempt === 3) {
            log(`${label}: giving up`)
            return null
          }
          attemptPrompt = `${full}\n\nYour previous answer was rejected: ${e.message.slice(0, 500)}. Answer again following the output format exactly.`
        }
      }
    })
  }
  function dispose() {
    if (work) rmSync(work, { recursive: true, force: true })
    process.removeListener('exit', dispose)
  }
  initWorkDirs()
  return { agent, dispose }
}
