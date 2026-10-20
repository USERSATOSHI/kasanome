const HELP = `Usage: kasanome [options]
       kasanome install --target <claude|codex|all> [--force]
       kasanome --version

Range
  --base <ref>            base ref (default: repo default branch)
  --head <ref>            head ref (default: HEAD)
  --prs <auto|none|N,N>   stacked PRs to map findings onto (default: auto via gh)

Review
  --focus <text>          what you care about most, e.g. "error handling, data model"
  --spec <paths>          comma-separated spec/design docs (default: auto-detect)
  --max-layers <n>        default 6
  --max-seams <n>         default 3
  --pr-guide-min <lines>  write PR guides only for PRs at least this big (default 1500)

Agent
  --agent <name>          claude | codex | opencode | custom (default: claude)
  --agent-cmd <cmd>       for --agent custom: shell command; prompt on stdin, answer on stdout.
                          Env: KASANOME_PROMPT_FILE, KASANOME_OUT_FILE (optional answer file), KASANOME_SCHEMA_FILE
  --model <id>            model passed to the agent CLI
  --concurrency <n>       parallel agents (default 4)
  --timeout <min>         per-agent timeout in minutes (default 30)

Output
  --repo <dir>            repository (default: cwd)
  --out <dir>             report dir (default: kasanome/ in repo, git-excluded)
  --fresh                 ignore cached agent results from a previous run
  --render <data.json>    only rebuild the dashboard from a previous run's data.json
  -h, --help
`

export function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP)
      process.exit(0)
    }
    if (a === '--fresh') {
      o.fresh = true
      continue
    }
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`)
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const val = argv[++i]
    if (val === undefined || val.startsWith('--')) throw new Error(`Missing value for ${a}`)
    o[key] = val
  }
  validateNumbers(o)
  return o
}

function validateNumbers(options) {
  for (const [key, min] of Object.entries({
    concurrency: 1,
    maxLayers: 1,
    maxSeams: 0,
    prGuideMin: 0,
    timeout: 0.001,
  })) {
    if (options[key] === undefined) continue
    const value = Number(options[key])
    if (!Number.isFinite(value) || value < min)
      throw new Error(`Invalid --${key}: expected a number >= ${min}`)
    if (key !== 'timeout' && !Number.isInteger(value))
      throw new Error(`Invalid --${key}: expected an integer`)
  }
}
