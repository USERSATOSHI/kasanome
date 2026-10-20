import { anchorLine, ui } from './model.js'

function parseDiff(diff) {
  const rows = []
  let line = 0,
    old = 0,
    inHunk = false
  for (const text of diff.split('\n')) {
    const match = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (match) {
      old = Number(match[1])
      line = Number(match[2])
      inHunk = true
      rows.push({ kind: 'hunk', text })
      continue
    }
    if (!inHunk) continue
    if (text.startsWith('+'))
      rows.push({ kind: 'add', text: text.slice(1), line: line++, old: null })
    else if (text.startsWith('-'))
      rows.push({ kind: 'remove', text: text.slice(1), line: null, old: old++ })
    else if (text.startsWith(' '))
      rows.push({ kind: 'context', text: text.slice(1), line: line++, old: old++ })
  }
  return rows
}

function addFindingContext(rows, lines, findings) {
  const visible = new Set(rows.filter((row) => row.line).map((row) => row.line))
  for (const finding of findings) {
    const line = anchorLine(finding)
    if (!line || visible.has(line) || line < 1 || line > lines.length) continue
    rows.push({ kind: 'hunk', text: 'Unchanged context · finding at line ' + line })
    for (let n = Math.max(1, line - 5); n <= Math.min(lines.length, line + 5); n++) {
      if (visible.has(n)) continue
      rows.push({ kind: 'context', text: lines[n - 1], line: n, old: null })
      visible.add(n)
    }
  }
}

export function codeRows(file, findings) {
  const lines = typeof file.content === 'string' ? file.content.split('\n') : []
  if (lines.at(-1) === '') lines.pop()
  if (ui.mode === 'full' || !file.diff)
    return lines.map((text, index) => ({ text, line: index + 1, old: null, kind: 'context' }))
  const rows = parseDiff(file.diff)
  addFindingContext(rows, lines, findings)
  return rows
}
