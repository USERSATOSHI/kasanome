import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const help = `Usage: kasanome install --target <claude|codex|all> [--force]

Installs a self-contained user skill:
  claude  ~/.claude/skills/kasanome
  codex   ~/.agents/skills/kasanome
  all     both

--force updates the packaged files of an existing skill.
Restart your agent session if the skill does not appear.
`

function parseInstallArgs(args) {
  let target,
    force = false
  for (let i = 0; i < args.length; i++) {
    if (['--help', '-h'].includes(args[i])) return { help: true }
    if (args[i] === '--force') force = true
    else if (args[i] === '--target') target = args[++i]
    else throw new Error(`Unknown install argument: ${args[i]}`)
  }
  if (!['claude', 'codex', 'all'].includes(target)) throw new Error(help)
  return { target, force }
}

function assertNoSymlinks(path) {
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) throw new Error(`Refusing to overwrite symlink: ${path}`)
  if (stat.isDirectory()) for (const name of readdirSync(path)) assertNoSymlinks(join(path, name))
}

function preflight(dest, force) {
  assertNoSymlinks(dest)
  if (existsSync(dest) && !force)
    throw new Error(`Skill already exists: ${dest}. Use --force to update.`)
}

function installSkill(agent, dest) {
  mkdirSync(dest, { recursive: true })
  cpSync(join(root, 'skills', 'kasanome'), dest, { recursive: true })
  const runtime = join(dest, 'runtime')
  mkdirSync(runtime, { recursive: true })
  for (const path of [
    'bin',
    'scripts',
    'src',
    'dist',
    'skills',
    'package.json',
    'LICENSE',
    'NOTICE',
  ]) {
    cpSync(join(root, path), join(runtime, path), { recursive: true })
  }
  for (const file of ['LICENSE', 'NOTICE']) cpSync(join(root, file), join(dest, file))
  const version = JSON.parse(readFileSync(join(root, 'package.json'))).version
  writeFileSync(join(dest, 'scripts', 'install.json'), JSON.stringify({ version, agent }) + '\n')
  writeFileSync(
    join(dest, 'scripts', 'run.mjs'),
    `#!/usr/bin/env node\nimport { launch } from '../runtime/src/cli/skill.mjs'\nawait launch('${agent}')\n`
  )
  console.log(`Installed ${agent}: ${dest}`)
}

export function install(args) {
  const options = parseInstallArgs(args)
  if (options.help) {
    console.log(help)
    return
  }
  const destinations = {
    claude: join(homedir(), '.claude', 'skills', 'kasanome'),
    codex: join(homedir(), '.agents', 'skills', 'kasanome'),
  }
  const agents = options.target === 'all' ? Object.keys(destinations) : [options.target]
  for (const agent of agents) preflight(destinations[agent], options.force)
  for (const agent of agents) installSkill(agent, destinations[agent])
}
