const shell = (f) => /\.(?:sh|bash|ksh)$/.test(f)
const docker = (f) => /(?:^|\/)(?:Dockerfile(?:\..*)?|[^/]+\.Dockerfile)$/.test(f)
const workflow = (f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)
const lockfile = (f) =>
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|requirements[^/]*\.txt)$/.test(
    f
  )
const code = (f) => /\.(?:[cm]?[jt]sx?|py|go|rb|java|rs|php|c|cpp|cs|ya?ml)$/.test(f)
const local = (files) => files.map((f) => './' + f)

export const SCANNERS = {
  gitleaks: {
    matches: () => true,
    format: 'sarif',
    args: (_, report) => [
      'dir',
      '.',
      '--no-banner',
      '--redact=100',
      '--report-format',
      'sarif',
      '--report-path',
      report,
      '--exit-code',
      '1',
    ],
  },
  shellcheck: {
    matches: shell,
    format: 'shellcheck',
    args: (files) => ['--format=json1', '--', ...local(files)],
  },
  hadolint: {
    matches: docker,
    format: 'hadolint',
    args: (files) => ['--format', 'json', '--', ...local(files)],
  },
  actionlint: {
    matches: workflow,
    format: 'actionlint',
    args: (files) => ['-shellcheck=', '-pyflakes=', '-format', '{{json .}}', '--', ...local(files)],
  },
  semgrep: {
    matches: code,
    network: true,
    format: 'sarif',
    args: (_, report, opt) => [
      'scan',
      '--config',
      opt.semgrepConfig || 'p/security-audit',
      '--metrics=off',
      '--disable-version-check',
      '--sarif',
      '--output',
      report,
      '--error',
      '.',
    ],
  },
  'osv-scanner': {
    matches: lockfile,
    network: true,
    format: 'sarif',
    // Explicit lockfiles avoid dependency resolution or executing project build commands.
    args: (files, report) => [
      'scan',
      'source',
      '--format',
      'sarif',
      '--output',
      report,
      ...files.flatMap((f) => ['--lockfile', './' + f]),
    ],
  },
}

export function scannerNames(value = 'none') {
  const names = [
    ...new Set(
      value
        .split(',')
        .flatMap((name) =>
          name === 'auto'
            ? Object.keys(SCANNERS).filter((key) => !SCANNERS[key].network)
            : name === 'none'
              ? []
              : [name]
        )
    ),
  ]
  for (const name of names)
    if (!SCANNERS[name])
      throw new Error(
        `Unknown scanner: ${name}. Use auto, none, or ${Object.keys(SCANNERS).join(', ')}`
      )
  return names
}

export function parseNative(name, data) {
  const rows = name === 'shellcheck' ? data.comments : data
  if (!Array.isArray(rows)) throw new Error(`Invalid ${name} JSON report`)
  if (
    rows.some(
      (row) =>
        !row ||
        typeof (row.file || row.filepath) !== 'string' ||
        !Number.isInteger(row.line) ||
        row.line < 1 ||
        typeof row.message !== 'string'
    )
  )
    throw new Error(`Invalid ${name} finding`)
  return rows.map((row) => ({
    scanner: name,
    ruleId: String(name === 'shellcheck' ? 'SC' + row.code : row.code || row.kind || 'unknown'),
    file: row.file || row.filepath,
    line: row.line,
    endLine: row.endLine || row.line,
    severity:
      row.level === 'error'
        ? 'high'
        : row.level === 'warning' || name === 'actionlint'
          ? 'medium'
          : 'low',
    detail: row.message,
  }))
}
