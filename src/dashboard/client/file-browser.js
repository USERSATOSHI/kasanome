import { D, ui, fileFindings, sourceFiles } from './model.js'
import { h, codeRoute, counts } from './html.js'

function matchesLayer(file, layer) {
  if (!layer) return true
  if (
    layer.paths.some(
      (path) => file.path === path || file.path.startsWith(path.replace(/\/$/, '') + '/')
    )
  )
    return true
  return fileFindings(file.path).some((finding) => finding.unitId === layer.id)
}

function visibleFiles() {
  const layer = D.map.layers.find((item) => item.id === ui.layer)
  const query = ui.query.toLowerCase()
  return sourceFiles
    .filter((file) => file.path.toLowerCase().includes(query) && matchesLayer(file, layer))
    .sort(
      (a, b) =>
        Number(!!fileFindings(b.path).length) - Number(!!fileFindings(a.path).length) ||
        a.path.localeCompare(b.path)
    )
}

export function fileBrowser(selected) {
  const files = visibleFiles()
  const options = D.map.layers
    .map(
      (layer) =>
        `<option value="${h(layer.id)}"${layer.id === ui.layer ? ' selected' : ''}>${h(layer.name)}</option>`
    )
    .join('')
  const tree = files
    .map(
      (file) =>
        `<a class="file-entry${file.path === selected?.path ? ' active' : ''}" href="${codeRoute(file.path)}"><span class="file-path mono">${h(file.path)}</span>${counts(fileFindings(file.path))}</a>`
    )
    .join('')
  return `<aside class="file-browser"><div class="file-browser-tools"><strong>Files <span class="pill">${files.length}</span></strong><input type="search" data-file-query placeholder="Find a file…" aria-label="Find a file" value="${h(ui.query)}"><select data-code-layer aria-label="Filter files by layer"><option value="">All layers</option>${options}</select></div><div class="file-tree">${tree || '<p class="muted">No matching files.</p>'}</div></aside>`
}
