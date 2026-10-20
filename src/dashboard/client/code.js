import { D, findings, anchorLine, sourceFiles, fileFindings } from './model.js'
import { h, codeRoute } from './html.js'
import { codeFile } from './code-file.js'
import { fileBrowser } from './file-browser.js'

function findingLink(finding, label) {
  if (!finding) return `<span class="pill muted">${label}</span>`
  return `<a class="pill" href="${codeRoute(finding.file, anchorLine(finding), finding.id)}">${label}</a>`
}

function reviewHeader(selected) {
  const index = selected ? findings.indexOf(selected) : -1
  const snapshot = D.source?.head ? ' · snapshot ' + h(D.source.head.slice(0, 8)) : ''
  return `<div class="review-top"><div><div class="eyebrow">KASANOME / CODE</div><h1>Read the code. Review in context.</h1><div class="muted mono">${h(D.range)}${snapshot}</div></div><div class="code-actions">${findingLink(findings[index - 1], '← Previous')}<span class="muted">${index >= 0 ? index + 1 : 0} / ${findings.length}</span>${findingLink(findings[index + 1], 'Next →')}</div></div>`
}

export function viewCode(path, targetLine, findingId) {
  const first = sourceFiles.find((file) => fileFindings(file.path).length) || sourceFiles[0]
  const file = path ? sourceFiles.find((file) => file.path === path) : first
  const local = file ? fileFindings(file.path) : []
  const selected =
    findings.find((f) => f.id === findingId) ||
    local.find((f) => anchorLine(f) === Number(targetLine)) ||
    local[0]
  return `${reviewHeader(selected)}<div class="review-workspace">${fileBrowser(file)}<section class="code-panel">${codeFile(file, local, selected, targetLine)}</section></div>`
}
