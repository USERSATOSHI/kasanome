import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  openSync,
  closeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdapter } from './adapters.mjs'
import { validate, extractJson, strictSchema } from './structured.mjs'

function opencodeBreakdown(tokens) {
  if (!tokens || typeof tokens.input !== 'number' || typeof tokens.output !== 'number') return null
  const result = {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning ?? 0,
    cacheRead: tokens.cache?.read ?? 0,
    cacheWrite: tokens.cache?.write ?? 0,
  }
  return Object.values(result).every((n) => Number.isFinite(n) && n >= 0) ? result : null
}

function tokenTotal(breakdown) {
  return Object.values(breakdown).reduce((sum, value) => sum + value, 0)
}

export function createRunner({ repo: repo, out: out, opt, log, identity = '' }) {
  const agentName = opt.agent || 'claude'
  const concurrency = Number(opt.concurrency || 1)
  const timeoutMs = Number(opt.timeout || 30) * 60_000
  const adapter = createAdapter(opt)
  const usage = {
    calls: 0,
    maxCalls: Number(opt.maxCalls ?? 4),
    cacheHits: 0,
    totalTokens: 0,
    tokensKnown: true,
    attempts: [],
    skipped: [],
  }
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

  // OpenCode does not emit a final step_finish event, so the stream total omits the
  // answer step. Ask the CLI for the completed session totals instead. This is a
  // local process, not another model call.
  function opencodeSessionTokens(sessionID) {
    if (!sessionID) return null
    try {
      const args = [
        'session',
        'export',
        ...(opt.opencodeStandalone ? ['--standalone'] : []),
        sessionID,
      ]
      const raw = execFileSync('opencode', args, {
        cwd: repo,
        env: { ...process.env, PWD: repo },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
      })
      const info = JSON.parse(raw).info
      if (info?.id && info.id !== sessionID) return null
      return opencodeBreakdown(info?.tokens)
    } catch {
      return null
    }
  }

  function exec({ cmd, args, stdin, stdinFile, env }) {
    return new Promise((res, rej) => {
      const inputFd = stdinFile ? openSync(stdinFile, 'r') : null
      let p
      try {
        p = spawn(cmd, args, {
          cwd: repo,
          env: { ...process.env, PWD: repo, ...env },
          stdio: [inputFd ?? 'pipe', 'pipe', 'pipe'],
        })
      } finally {
        if (inputFd !== null) closeSync(inputFd)
      }
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
      p.stdin?.on('error', (error) => {
        if (error.code !== 'EPIPE') rej(error)
      })
      p.stdin?.end(stdin)
    })
  }
  async function agent(label, prompt, { schema } = {}) {
    const full = schema
      ? `${prompt}\n\n---\nOUTPUT FORMAT: Your final answer must be ONLY one JSON object matching this JSON Schema, inside a single \`\`\`json fenced block. No prose after it.\n\`\`\`json\n${JSON.stringify(schema)}\n\`\`\``
      : prompt
    const key = createHash('sha256')
      .update(`${identity}|${agentName}|${opt.model || ''}|${full}`)
      .digest('hex')
      .slice(0, 16)
    const cacheFile = join(cache, `${key}.json`)
    if (!opt.fresh && existsSync(cacheFile)) {
      usage.cacheHits++
      log(`${label}: cached`)
      return JSON.parse(readFileSync(cacheFile, 'utf8'))
    }

    return limit(async () => {
      let attemptPrompt = full
      for (let attempt = 1; attempt <= Number(opt.retries ?? 0) + 1; attempt++) {
        if (usage.calls >= usage.maxCalls) {
          usage.skipped.push(label)
          log(`${label}: skipped (call budget exhausted)`)
          return null
        }
        usage.calls++
        const record = { label, attempt, tokens: null, status: 'failed' }
        usage.attempts.push(record)
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
          let answer = stdout
          if (agentName === 'codex') {
            const events = stdout.split('\n').flatMap((line) => {
              try {
                return [JSON.parse(line)]
              } catch {
                return []
              }
            })
            const totals = events
              .filter((e) => e.type === 'turn.completed' && e.usage)
              .map((e) => e.usage)
            if (totals.length)
              record.tokens = totals.reduce(
                (n, u) => n + (u.input_tokens || 0) + (u.output_tokens || 0),
                0
              )
          } else if (agentName === 'opencode') {
            const events = stdout.split('\n').flatMap((line) => {
              try {
                return [JSON.parse(line)]
              } catch {
                return []
              }
            })
            const texts = events.filter(
              (e) => e.type === 'text' && typeof e.part?.text === 'string'
            )
            const lastId = texts.at(-1)?.part.messageID
            answer = texts
              .filter((e) => e.part.messageID === lastId)
              .map((e) => e.part.text)
              .join('\n')
            const steps = events.filter((e) => e.type === 'step_finish')
            const streamed = steps.map((e) => opencodeBreakdown(e.part?.tokens))
            const valid = streamed.filter(Boolean)
            if (valid.length) {
              record.tokenBreakdown = Object.fromEntries(
                Object.keys(valid[0]).map((key) => [key, valid.reduce((sum, t) => sum + t[key], 0)])
              )
              record.tokens = tokenTotal(record.tokenBreakdown)
            }
            record.tokensComplete =
              steps.at(-1)?.part?.reason === 'stop' &&
              valid.length === streamed.length &&
              valid.length > 0
            const sessionID = events.find((e) => e.sessionID)?.sessionID
            if (sessionID) record.sessionID = sessionID
            const completed = record.tokensComplete ? null : opencodeSessionTokens(sessionID)
            if (completed) {
              record.tokenBreakdown = completed
              record.tokens = tokenTotal(completed)
              record.tokensComplete = true
              record.usageSource = 'session-export'
            } else record.usageSource = 'event-stream'
            if (record.tokenBreakdown) {
              usage.tokenBreakdown ||= {
                input: 0,
                output: 0,
                reasoning: 0,
                cacheRead: 0,
                cacheWrite: 0,
              }
              for (const [key, value] of Object.entries(record.tokenBreakdown))
                usage.tokenBreakdown[key] += value
            }
          } else if (agentName === 'claude') {
            const envelope = JSON.parse(stdout)
            answer = envelope.result || ''
            if (envelope.usage)
              record.tokens = [
                'input_tokens',
                'output_tokens',
                'cache_creation_input_tokens',
                'cache_read_input_tokens',
              ].reduce((n, k) => n + (envelope.usage[k] || 0), 0)
          }
          usage.tokensKnown =
            usage.tokensKnown && record.tokens !== null && record.tokensComplete !== false
          usage.totalTokens += record.tokens || 0
          const text = (
            spec.outFile && existsSync(spec.outFile) ? readFileSync(spec.outFile, 'utf8') : answer
          ).trim()
          let result = text
          if (schema) {
            result = extractJson(text)
            const err = validate(schema, result)
            if (err) throw new Error(`schema violation: ${err}`)
          }
          writeFileSync(cacheFile, JSON.stringify(result))
          record.status = 'completed'
          log(`${label}: done`)
          return result
        } catch (e) {
          log(`${label}: attempt ${attempt} failed: ${e.message.split('\n')[0]}`)
          usage.tokensKnown = false
          if (attempt === Number(opt.retries ?? 0) + 1) {
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
  return { agent, dispose, usage, remaining: () => Math.max(0, usage.maxCalls - usage.calls) }
}
