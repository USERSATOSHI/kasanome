const HELP = `Kasanome — code review that remembers what you reviewed.

Usage: kasanome review [options]
       kasanome status [--repo <dir>] [--out <dir>] [--json]
       kasanome install --target <claude|codex|all> [--force]
       kasanome [options]                 shorthand for review

Start here
  kasanome review --pr 123 --agent codex
  kasanome review --base origin/main --agent opencode
  kasanome review --base main --mode quick --max-calls 2
  kasanome status

Review
  --pr <number|url>       fetch a GitHub PR and resolve its base/head; requires gh
  -b, --base <ref>        target branch (default: repository default branch)
  --head <ref>           commit or branch to review (default: HEAD)
  -a, --agent <name>      claude | codex | opencode | custom (default: claude)
  -m, --model <id>        use a model supported by your chosen agent CLI
  --mode <mode>          auto | quick | incremental | full (default: auto)
  --max-calls <n>        hard cap on agent launches, including retries (default: 4)
  --focus <text>         prioritize an area, e.g. "recovery and error handling"
  --publish <PR-number>  create/update one GitHub summary comment; explicit opt-in

Results
  --repo <dir>           review another checkout (default: current repository)
  --out <dir>            report directory (default: kasanome/ inside repository)
  --json                 output a machine-readable summary
  -q, --quiet            hide progress; keep the result path or JSON
  -h, --help             show this help
  --help-all             show every review option
  -v, --version          print the installed version

Small diffs use focused context; larger diffs use architectural layers.
Reviews use committed code. Reports stay local unless --publish is supplied.
A call cap limits launches, not tokens. Open kasanome/index.html to read the report.
`
const ADVANCED = `
Advanced review options
  --prs <auto|none|N,N>   PR metadata for optional guides (default: auto)
  --guides               opt in to PR attribution and reading guides
  --spec <paths>         comma-separated design/spec documents
  --quick-max-chars <n>  maximum supplied Git context characters (default: 16000)
  --quick-max-files <n>  maximum complete patches per quick run (default: 5)
  --max-findings <n>     finding checks per run (default: 12; quick caps at 3)
  --max-layers <n>       architectural layers per run (default: 6)
  --max-seams <n>        architectural boundaries per run (default: 3)
  --pr-guide-min <n>     minimum changed lines for a PR guide (default: 1500)
  --concurrency <n>      parallel agent processes (default: 1)
  --retries <n>          retries per failed call; consume call budget (default: 0)
  --timeout <minutes>    per-agent timeout (default: 30)
  --fresh                ignore cached agent answers
  --render <data.json>   rebuild an existing dashboard with no model calls
  --opencode-standalone  use a private OpenCode v2 server for each call
  --agent-cmd <command>  custom agent command; prompt on stdin
                         Env: KASANOME_PROMPT_FILE, KASANOME_OUT_FILE,
                         KASANOME_SCHEMA_FILE
`
const VALUES = new Set([
  'pr',
  'base',
  'head',
  'prs',
  'focus',
  'spec',
  'max-layers',
  'max-seams',
  'pr-guide-min',
  'agent',
  'agent-cmd',
  'model',
  'concurrency',
  'timeout',
  'repo',
  'out',
  'render',
  'mode',
  'max-calls',
  'max-findings',
  'retries',
  'quick-max-chars',
  'quick-max-files',
])
const FLAGS = new Set(['fresh', 'guides', 'opencode-standalone', 'json', 'quiet'])
const ALIASES = {
  '-b': '--base',
  '-a': '--agent',
  '-m': '--model',
  '-q': '--quiet',
  '-h': '--help',
}
const keyOf = (key) => key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

export function printHelp(all = false) {
  process.stdout.write(HELP + (all ? ADVANCED : ''))
}

export function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const raw = ALIASES[argv[i]] || argv[i]
    const equals = raw.indexOf('=')
    const name = equals < 0 ? raw : raw.slice(0, equals)
    if (name === '--help' || name === '--help-all') {
      printHelp(name === '--help-all')
      return { help: true }
    }
    if (!name.startsWith('--'))
      throw new Error(`Unexpected argument: ${raw}. Run kasanome --help for examples.`)
    const key = name.slice(2)
    if (key === 'token-budget')
      throw new Error(
        'These agent CLIs cannot enforce a hard token budget. Use --max-calls to cap launches; reported tokens are shown when available.'
      )
    if (FLAGS.has(key)) {
      if (equals >= 0) throw new Error(`${name} is a flag and does not take a value`)
      options[keyOf(key)] = true
    } else if (VALUES.has(key)) {
      const value = equals < 0 ? argv[++i] : raw.slice(equals + 1)
      if (!value || value.startsWith('-')) throw new Error(`Missing value for ${name}`)
      options[keyOf(key)] = value
    } else
      throw new Error(`Unknown option: ${name}. Run kasanome --help-all for available options.`)
  }
  if (options.mode && !['auto', 'quick', 'incremental', 'full'].includes(options.mode))
    throw new Error('--mode must be auto, quick, incremental, or full')
  if (options.agent && !['claude', 'codex', 'opencode', 'custom'].includes(options.agent))
    throw new Error('--agent must be claude, codex, opencode, or custom')
  if (
    options.pr &&
    !/^(?:[1-9]\d*|https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9]\d*)$/.test(options.pr)
  )
    throw new Error('--pr expects a positive PR number or a github.com pull request URL')
  if (options.pr && (options.base || options.head || options.render))
    throw new Error('--pr resolves its own base/head; use it without --base, --head, or --render')
  validateNumbers(options)
  return options
}

function validateNumbers(options) {
  for (const [key, min] of Object.entries({
    concurrency: 1,
    maxCalls: 1,
    quickMaxChars: 1000,
    quickMaxFiles: 1,
    retries: 0,
    maxFindings: 1,
    publish: 1,
    maxLayers: 1,
    maxSeams: 0,
    prGuideMin: 0,
    timeout: 0.001,
  })) {
    if (options[key] === undefined) continue
    const value = Number(options[key])
    const flag = '--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
    if (!Number.isFinite(value) || value < min)
      throw new Error(`Invalid ${flag}: expected a number >= ${min}`)
    if (key !== 'timeout' && !Number.isInteger(value))
      throw new Error(`Invalid ${flag}: expected an integer`)
  }
}
