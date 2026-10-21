import { D, layers, seams, unitOf, layerName, forUnit, state } from './model.js'
import { h, inl, counts } from './html.js'
import { readingSteps, readKey } from './reading.js'
import { findingRows } from './findings.js'
function sentences(text) {
  const out = []
  let cur = '',
    tick = false
  const t = String(text || '').trim()
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    cur += c
    if (c === '\x60') tick = !tick
    if (
      !tick &&
      /[.!?]/.test(c) &&
      /\s/.test(t[i + 1] || ' ') &&
      /[A-Z\x60(]/.test(t.slice(i + 1).trimStart()[0] || 'A') &&
      !/\b(e\.g|i\.e|etc|vs)\.$/i.test(cur)
    ) {
      out.push(cur.trim())
      cur = ''
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
function prose(text, perPara) {
  const ss = sentences(text),
    paras = []
  for (let i = 0; i < ss.length; i += perPara) paras.push(ss.slice(i, i + perPara).join(' '))
  return paras.map((p) => '<p>' + inl(p) + '</p>').join('')
}
function section(title, body, extra) {
  return '<section class="usec"><h2>' + title + (extra || '') + '</h2>' + body + '</section>'
}
import { unitSidebar } from './unit-sidebar.js'

function unitHeader(u, l, sm, fs, reading, readCount) {
  const kicker = l
    ? 'Layer ' + (layers.findIndex((x) => x.id === u.id) + 1) + ' of ' + layers.length
    : 'Boundary between layers'
  const title = sm
    ? h(layerName(sm.from)) + ' <span class="arrow">→</span> ' + h(layerName(sm.to))
    : h(u.name)
  const lead = l ? l.purpose : sm ? sm.why : ''

  const stat = (value, label, cls) =>
    '<div class="ustat' +
    (cls ? ' ' + cls : '') +
    '"><b>' +
    value +
    '</b><span>' +
    label +
    '</span></div>'
  const stats =
    '<div class="ustats">' +
    stat(
      fs.length,
      (fs.length === 1 ? 'finding' : 'findings') +
        (fs.length
          ? ': ' +
            ['high', 'medium', 'low']
              .map((v) => [v, fs.filter((f) => f.severity === v).length])
              .filter((x) => x[1])
              .map((x) => x[1] + ' ' + x[0])
              .join(', ')
          : ''),
      fs.some((f) => f.severity === 'high') ? 'warn' : ''
    ) +
    stat(readCount + '/' + reading.length, 'files read') +
    (l
      ? stat('~' + l.approxLines.toLocaleString(), 'changed lines') +
        stat(l.backEdges.length, 'upward imports', l.backEdges.length ? 'warn' : '')
      : stat(sm.files.length, 'files on the boundary')) +
    '</div>'

  return (
    '<header class="uhead"><div class="kicker">' +
    kicker +
    '</div><h1>' +
    title +
    '</h1>' +
    (lead ? '<p class="lead">' + inl(lead) + '</p>' : '') +
    (l
      ? '<div class="paths">' +
        l.paths.map((p) => '<span class="pill mono">' + h(p) + '</span>').join('') +
        '</div>'
      : '') +
    stats +
    (u.reviewedCommit
      ? '<p class="muted mono">Area assessment at commit ' +
        h(u.reviewedCommit.slice(0, 12)) +
        (D.source?.head && u.reviewedCommit !== D.source.head
          ? ' · reused from an earlier run; see coverage for current checks'
          : '') +
        '</p>'
      : '') +
    '</header>'
  )
}

export function viewUnit(id) {
  const u = unitOf(id)
  if (!u) return '<p>Unknown unit.</p>'
  const l = D.map.layers.find((x) => x.id === id),
    sm = seams.find((s) => s.from + '->' + s.to === id)
  const r = u.review,
    fs = forUnit(u.name)
  const reading = (r && r.readingOrder) || []
  const readCount = reading.filter((x) => state.read[readKey(u.id, x.path)]).length

  const headHtml = unitHeader(u, l, sm, fs, reading, readCount)
  if (!r)
    return (
      headHtml +
      '<div class="card" style="border-color:var(--high)">Review failed for this unit.</div>'
    )

  const ss = sentences(r.summary)
  const verdict =
    '<div class="verdict"><p class="verdict-lead">' +
    inl(ss[0] || '') +
    '</p>' +
    (ss.length > 1 ? prose(ss.slice(1).join(' '), 2) : '') +
    '</div>'

  return (
    headHtml +
    '<div class="ugrid"><div class="umain">' +
    section('Assessment', verdict) +
    section('Findings', findingRows(fs), ' ' + counts(fs)) +
    section(
      'Reading order',
      '<p class="muted small">Read in this order. Tick each file when done.</p>' +
        readingSteps(u.id, reading),
      ' <span class="muted small">' + readCount + ' of ' + reading.length + '</span>'
    ) +
    '</div><aside class="uside">' +
    unitSidebar(l, sm, r) +
    '</aside></div>'
  )
}
