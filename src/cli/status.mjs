import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { summarizeReport, formatSummary } from '../report/terminal.mjs'

export function showStatus(options) {
  for (const key of Object.keys(options))
    if (!['repo', 'out', 'json', 'quiet'].includes(key))
      throw new Error(
        `status does not accept --${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}; use kasanome review for review options`
      )
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: resolve(options.repo || '.'),
    encoding: 'utf8',
  }).trim()
  const out = resolve(repo, options.out || 'kasanome')
  if (!existsSync(join(out, 'data.json'))) {
    const message =
      'No saved review found. Start with kasanome review --base origin/main or kasanome review --pr 123.'
    console.log(options.json ? JSON.stringify({ report: null, message }) : message)
    return
  }
  const data = JSON.parse(readFileSync(join(out, 'data.json'), 'utf8'))
  const summary = summarizeReport(data, join(out, 'index.html'))
  console.log(options.json ? JSON.stringify(summary) : formatSummary(summary))
}
