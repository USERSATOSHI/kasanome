export const $ = (s) => document.querySelector(s)
export const h = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
export const SEV = { high: 0, medium: 1, low: 2 }
export const codeRoute = (file, line, finding) =>
  '#/code/' +
  encodeURIComponent(file) +
  (line || finding ? '/' + (line ? Number(line) : 0) : '') +
  (finding ? '/' + encodeURIComponent(finding) : '')
export const fileLink = (file, line) =>
  '<a class="mono" href="' +
  codeRoute(file, line) +
  '" title="Review code in context">' +
  h(file) +
  (line ? ':' + h(line) : '') +
  '</a>'
export const counts = (list) =>
  '<span class="counts">' +
  ['high', 'medium', 'low']
    .map((s) => {
      const n = list.filter((f) => f.severity === s).length
      return n ? '<span class="dot ' + s + '">' + n + '</span>' : ''
    })
    .join('') +
  '</span>'
export const inl = (s) =>
  h(s)
    .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
