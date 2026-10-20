import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs'
import { relative, isAbsolute, resolve, join } from 'node:path'

export function prepareOutput(repo, out) {
  mkdirSync(out, { recursive: true })
  const rel = relative(repo, out)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim()
  const info = join(resolve(repo, common), 'info')
  const exclude = join(info, 'exclude')
  const pattern = `/${rel}/`
  if (existsSync(exclude) && readFileSync(exclude, 'utf8').split('\n').includes(pattern)) return
  mkdirSync(info, { recursive: true })
  appendFileSync(exclude, `\n${pattern}\n`)
}
