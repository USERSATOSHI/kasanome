import { D, anchorLine, ui } from './model.js'
import { h, codeRoute } from './html.js'
import { findingCard } from './findings.js'
import { codeRows } from './diff.js'
import { syntax } from './highlight.js'

function editorLink(file, line) {
  if (!D.repo) return ''
  const url = 'vscode://file/' + encodeURI(D.repo + '/' + file) + (line ? ':' + line : '')
  return `<a class="pill" href="${h(url)}">Open in editor ↗</a>`
}

function fileHeader(file, findings, line) {
  const modeButton = (mode, label) =>
    `<button data-code-mode="${mode}" class="${ui.mode === mode ? 'on' : ''}">${label}</button>`
  return `<div class="code-file-head"><div><strong class="mono">${h(file.path)}</strong><div class="muted">${findings.length} findings · ${file.changed ? 'changed file' : 'reference file'}</div></div><div class="code-actions">${editorLink(file.path, line)}${modeButton('diff', 'Diff')}${modeButton('full', 'Full file')}</div></div>`
}

function lineRow(file, row, anchored, targetLine) {
  const classes = ['code-row', row.kind]
  if (anchored.length) classes.push('has-finding')
  if (row.line === Number(targetLine)) classes.push('selected-line')
  const id = row.line ? ` id="line-${row.line}"` : ''
  const number = row.line
    ? `<a class="line-new" href="${codeRoute(file.path, row.line)}">${row.line}</a>`
    : '<span class="line-new"></span>'
  const sign = { add: '+', remove: '−' }[row.kind] || (anchored.length ? '●' : '')
  return `<div class="${classes.join(' ')}"${id}><span class="line-old">${row.old || ''}</span>${number}<span class="line-sign">${sign}</span><code>${syntax(row.text)}</code></div>`
}

function inlineFinding(finding, selected) {
  const active = finding.id === selected?.id ? ' selected-comment' : ''
  return `<div class="inline-comment${active}">${findingCard(finding)}</div>`
}

function unanchoredFinding(finding) {
  const message =
    finding.anchor?.status === 'unresolved'
      ? 'Location needs checking; this comment is not attached to a source line.'
      : `Line ${finding.line} is unavailable in this head snapshot. This finding may refer to an earlier revision.`
  return `<div class="unanchored"><p class="muted">${h(message)}</p>${findingCard(finding)}</div>`
}

function notices(file) {
  const messages = []
  if (file.error) messages.push(file.error)
  if (file.diffError && ui.mode === 'diff')
    messages.push(file.diffError + ' Showing available source.')
  return messages.map((text) => `<div class="code-notice">${h(text)}</div>`).join('')
}

export function codeFile(file, findings, selected, targetLine) {
  if (!file)
    return `<div class="code-empty"><h2>No source snapshot</h2><p>${h(D.source?.error || 'Rebuild this report with the updated CLI to embed its source files.')}</p></div>`
  const rows = codeRows(file, findings)
  const shown = new Set(rows.map((row) => row.line).filter(Boolean))
  const lines = rows
    .map((row) => {
      if (row.kind === 'hunk') return `<div class="code-hunk mono">${h(row.text)}</div>`
      const anchored = findings.filter((f) => row.line && anchorLine(f) === row.line)
      return (
        lineRow(file, row, anchored, targetLine) +
        anchored.map((f) => inlineFinding(f, selected)).join('')
      )
    })
    .join('')
  const missing = findings
    .filter((f) => !anchorLine(f) || !shown.has(anchorLine(f)))
    .map(unanchoredFinding)
    .join('')
  return `${fileHeader(file, findings, targetLine)}<div class="code-scroll">${notices(file)}<div class="code-lines">${lines}</div>${missing}</div>`
}
