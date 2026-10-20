import { execFileSync } from 'node:child_process'

// Embed committed blobs, never files from an unrelated checkout or a symlink target.
export function collectSource(repo, scope, findings, units) {
  const git = (args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  let base, head, mergeBase
  try {
    base = git([
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${scope.baseCommit || scope.base}^{commit}`,
    ]).trim()
    head = git([
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${scope.headCommit || scope.head}^{commit}`,
    ]).trim()
    mergeBase = git(['merge-base', base, head]).trim()
  } catch {
    return { files: [], error: 'Source unavailable: the reviewed Git refs could not be resolved.' }
  }
  const changed = git(['diff', '--name-only', '-z', '--no-ext-diff', mergeBase, head])
    .split('\0')
    .filter(Boolean)
  const wanted = [
    ...new Set([
      ...findings.map((f) => f.file),
      ...units.flatMap((u) => u.review?.readingOrder?.map((r) => r.path) || []),
      ...changed,
    ]),
  ]
  const files = []
  let total = 0
  for (const path of wanted) {
    if (
      typeof path !== 'string' ||
      !path ||
      path.includes('\0') ||
      path.startsWith('/') ||
      path.split('/').includes('..')
    )
      continue
    const record = { path, changed: changed.includes(path) }
    try {
      const size = Number(git(['cat-file', '-s', `${head}:${path}`]).trim())
      if (size > 300_000 || total + size > 12_000_000)
        record.error = 'Source omitted: file or report size limit reached.'
      else {
        const content = git(['show', `${head}:${path}`])
        if (content.includes('\0')) record.error = 'Binary file: source preview unavailable.'
        else {
          record.content = content
          total += size
        }
      }
    } catch {
      record.error = 'File is absent at this head revision (it may have been deleted or renamed).'
    }
    try {
      const diff = git([
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--unified=6',
        mergeBase,
        head,
        '--',
        path,
      ])
      if (diff.length < 500_000 && total + diff.length < 16_000_000) {
        record.diff = diff
        total += diff.length
      } else record.diffError = 'Diff omitted: size limit reached.'
    } catch {
      record.diffError = 'Diff unavailable.'
    }
    files.push(record)
  }
  return { base, head, mergeBase, files }
}
