import {
  D,
  layers,
  seams,
  findings,
  forUnit,
  forPr,
  unitOf,
  state,
  save,
  ui,
  anchorLine,
} from './model.js'
import { $, h, counts } from './html.js'
import { unitProgress } from './reading.js'
import { viewCode } from './code.js'
import { viewUnit } from './unit.js'
import { viewOverview, viewPr, viewFindings, viewFinding } from './views.js'
function nav(route) {
  const item = (href, label, right, prog) =>
    '<a class="nav-item' +
    (route === href ||
    (href === '#/code' && (route.startsWith('#/code/') || route.startsWith('#/finding/')))
      ? ' active'
      : '') +
    '" href="' +
    href +
    '"><span class="grow">' +
    label +
    '</span>' +
    (right || '') +
    '</a>' +
    (prog != null
      ? '<div class="progress" style="margin-top:-2px;margin-bottom:4px"><div style="width:' +
        Math.round(prog * 100) +
        '%"></div></div>'
      : '')
  const unitItem = (u, label) =>
    item(
      '#/unit/' + encodeURIComponent(u.id),
      h(label),
      counts(forUnit(u.name)),
      unitProgress(u.id, u.review && u.review.readingOrder)
    )
  $('#nav').innerHTML =
    '<div class="nav-title">Kasanome</div><div class="nav-sub mono">' +
    h(D.range) +
    '</div>' +
    item('#/', 'Overview') +
    item('#/code', 'Code review', counts(findings)) +
    item('#/findings', 'All findings', counts(findings)) +
    '<div class="nav-group">Layers, bottom-up</div>' +
    layers
      .map((l, i) => unitItem(unitOf(l.id) || { id: l.id, name: l.name }, i + 1 + '. ' + l.name))
      .join('') +
    (seams.length
      ? '<div class="nav-group">Boundaries</div>' +
        D.units
          .filter((u) => u.kind === 'seam')
          .map((u) => unitItem(u, u.name.replace(/^Seam /, '')))
          .join('')
      : '') +
    (D.scope.prs.length
      ? '<div class="nav-group">PRs, bottom-up</div>' +
        D.scope.prs
          .map((p) =>
            item(
              '#/pr/' + p.number,
              '#' + p.number + ' ' + h(p.title),
              counts(forPr(p.number).filter((f) => f.status !== 'fixed-later'))
            )
          )
          .join('')
      : '')
}

function renderView(kind, arg, line, findingId) {
  const views = {
    code: () => viewCode(arg ? decodeURIComponent(arg) : '', line, findingId),
    unit: () => viewUnit(decodeURIComponent(arg)),
    pr: () => viewPr(Number(arg)),
    findings: viewFindings,
    finding: () => viewFinding(arg),
  }
  return (views[kind] || viewOverview)()
}

function focusAnchor(kind, arg, line, findingId) {
  if (!['code', 'finding'].includes(kind)) return
  const id = kind === 'finding' ? arg : findingId
  const finding = findings.find((item) => item.id === id)
  const target =
    document.getElementById('line-' + (finding ? anchorLine(finding) : line)) ||
    document.getElementById('f-' + id)
  if (!target) return
  target.scrollIntoView({ block: 'start' })
  const scroller = $('.code-scroll')
  if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop - 120)
}

function render() {
  const route = location.hash || '#/'
  const [, kind, arg, line, findingId] = route.split('/')
  const main = $('#main')
  const positions = ['.code-scroll', '.file-tree'].map((selector) => [
    selector,
    $(selector)?.scrollTop || 0,
  ])
  document.body.classList.toggle('review-mode', ['code', 'finding'].includes(kind))
  main.innerHTML = renderView(kind, arg, line, findingId)
  nav(route)
  if (render.keepScroll) {
    for (const [selector, top] of positions) if ($(selector)) $(selector).scrollTop = top
  } else {
    main.scrollTop = 0
    focusAnchor(kind, arg, line, findingId)
  }
  render.keepScroll = false
}

document.addEventListener('change', (e) => {
  const t = e.target
  if (t.hasAttribute('data-code-layer')) {
    ui.layer = t.value
    render.keepScroll = true
    render()
    return
  }
  if (t.dataset.read) {
    state.read[t.dataset.read] = t.checked
    save()
    render.keepScroll = true
    render()
  }
  if (t.dataset.f) {
    ui.filters[t.dataset.f] = t.value
    render.keepScroll = true
    render()
  }
})
document.addEventListener('input', (e) => {
  if (e.target.hasAttribute('data-file-query')) {
    ui.query = e.target.value
    const pos = e.target.selectionStart
    render.keepScroll = true
    render()
    const input = $('[data-file-query]')
    input.focus()
    input.setSelectionRange(pos, pos)
    return
  }
  if (e.target.dataset.f === 'q') {
    ui.filters.q = e.target.value
    const pos = e.target.selectionStart
    render.keepScroll = true
    render()
    const s = $('input[data-f=q]')
    s.focus()
    s.setSelectionRange(pos, pos)
  }
})
document.addEventListener('click', (e) => {
  const mode = e.target.closest('[data-code-mode]')
  if (mode) {
    ui.mode = mode.dataset.codeMode
    render()
    return
  }

  const b = e.target.closest('[data-triage]')
  if (b) {
    const id = b.dataset.triage
    state.triage[id] = state.triage[id] === b.dataset.v ? '' : b.dataset.v
    save()
    render.keepScroll = true
    render()
    return
  }
  const row = e.target.closest('[data-go]')
  if (row && !e.target.closest('a')) location.hash = row.dataset.go
})
let gPending = false
document.addEventListener('keydown', (e) => {
  if (/input|select|textarea/i.test(document.activeElement.tagName)) return
  if (gPending) {
    gPending = false
    if (e.key === 'o') location.hash = '#/'
    if (e.key === 'f') location.hash = '#/findings'
    return
  }
  if (e.key === 'g') {
    gPending = true
    return
  }
  if (e.key === 'j' || e.key === 'k') {
    const items = [...document.querySelectorAll('#nav .nav-item')],
      i = items.findIndex((a) => a.classList.contains('active'))
    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'j' ? 1 : -1)))]
    if (next) location.hash = next.getAttribute('href')
  }
})
window.addEventListener('hashchange', render)
try {
  render()
} catch (e) {
  $('#main').innerHTML = '<h1>Dashboard failed to render</h1><pre>' + h(e.stack || e) + '</pre>'
  throw e
}
