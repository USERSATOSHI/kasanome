export const D = JSON.parse(document.getElementById('data').textContent)
const KEY = 'kasanome:' + D.range
// localStorage can throw (file:// in some browsers, private mode); progress then lasts for the session only.
export let state = { read: {}, triage: {} }
try {
  state =
    JSON.parse(localStorage.getItem(KEY) || localStorage.getItem('structural-review:' + D.range)) ||
    state
} catch {}
export const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {}
}
export const layers = D.layers
export const seams = D.seams
export const findings = D.findings
export const unitOf = (id) => D.units.find((u) => u.id === id)
export const layerName = (id) => (D.map.layers.find((l) => l.id === id) || {}).name || id

export const anchorLine = (f) => (f.anchor ? f.anchor.line : f.line)
export const triage = (id) => state.triage[id] || ''
export const forUnit = (name) => findings.filter((f) => f.unit === name)
export const forPr = (n) => findings.filter((f) => f.introducedIn === n)
export const ui = {
  mode: 'diff',
  query: '',
  layer: '',
  filters: { sev: '', unit: '', pr: '', status: '', triage: '', q: '' },
}

export const sourceFiles = D.source?.files || []
export const fileFindings = (path) =>
  findings
    .filter((f) => f.file === path)
    .sort((a, b) => (anchorLine(a) || a.line) - (anchorLine(b) || b.line))
