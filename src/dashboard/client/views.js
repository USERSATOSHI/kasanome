import { md } from './markdown.js'
import { D, layers, seams, findings, triage, state, forPr, ui } from './model.js'
import { h, counts, SEV } from './html.js'
import { findingCard } from './findings.js'
import { diagram } from './diagram.js'
import { viewCode } from './code.js'
import { anchorLine } from './model.js'
import { readKey } from './reading.js'
export function viewOverview() {
  const open = findings.filter((f) => f.status !== 'fixed-later')
  const triaged = findings.filter((f) => triage(f.id)).length
  const allRead = D.units.flatMap((u) =>
    ((u.review && u.review.readingOrder) || []).map((r) => readKey(u.id, r.path))
  )
  return (
    '<h1>Kasanome</h1><div class="muted mono">' +
    h(D.range) +
    ' | agent: ' +
    h(D.agent || '-') +
    '</div>' +
    '<div class="stats">' +
    '<div class="stat"><b>' +
    D.scope.filesChanged +
    '</b><span>files changed</span></div>' +
    '<div class="stat"><b>+' +
    D.scope.additions +
    '</b><span>-' +
    D.scope.deletions +
    ' lines</span></div>' +
    '<div class="stat"><b>' +
    layers.length +
    ' / ' +
    seams.length +
    '</b><span>layers / seams</span></div>' +
    '<div class="stat"><b>' +
    findings.length +
    '</b><span>' +
    open.length +
    ' open at head</span></div>' +
    '<div class="stat"><b>' +
    triaged +
    '/' +
    findings.length +
    '</b><span>findings triaged</span></div>' +
    '<div class="stat"><b>' +
    allRead.filter((k) => state.read[k]).length +
    '/' +
    allRead.length +
    '</b><span>files read</span></div>' +
    '</div>' +
    (D.failed && D.failed.length
      ? '<div class="card" style="border-color:var(--high)">Not covered (review failed): ' +
        h(D.failed.join(', ')) +
        '</div>'
      : '') +
    '<h2>Architecture</h2><div class="card">' +
    diagram() +
    '</div><div class="grid2"><div><h2>System</h2><div class="card">' +
    h(D.map.overview).replace(/\n\n/g, '<br><br>') +
    '</div>' +
    '</div><div><h2>How to review</h2><div class="card"><ol style="margin:0;padding-left:18px"><li>Read layers bottom-up (sidebar order). Tick files as you read them.</li><li>Read seams: where layers disagree.</li><li>Review PRs bottom-up with their guides. Raise only findings that are present at head, on the PR that introduced them.</li><li>Triage each finding: raise, dismiss, or later.</li></ol><p class="muted" style="margin-bottom:0">Keys: <span class="kbd">g o</span> overview, <span class="kbd">g f</span> findings, <span class="kbd">j</span>/<span class="kbd">k</span> next/prev in sidebar.</p></div></div></div>' +
    '<h2>Highest severity</h2>' +
    (findings
      .filter((f) => f.severity === 'high')
      .map(findingCard)
      .join('') || '<p class="muted">No high-severity findings.</p>')
  )
}
export function viewPr(n) {
  const p = D.scope.prs.find((x) => x.number === n)
  if (!p) return '<p>Unknown PR.</p>'
  const g = (D.prGuides || []).find((x) => x.number === n),
    fs = forPr(n)
  const raise = fs.filter((f) => f.status !== 'fixed-later'),
    skip = fs.filter((f) => f.status === 'fixed-later')
  return (
    '<div class="muted">PR ' +
    (D.scope.prs.indexOf(p) + 1) +
    ' of ' +
    D.scope.prs.length +
    ' in the stack</div><h1>#' +
    n +
    ' ' +
    h(p.title) +
    '</h1>' +
    '<div><span class="pill mono">' +
    h(p.headRef) +
    ' -> ' +
    h(p.baseRef) +
    '</span> <span class="pill">+' +
    p.additions +
    ' / -' +
    p.deletions +
    '</span> ' +
    (p.url ? '<a class="pill" href="' + h(p.url) + '" target="_blank">open on GitHub</a>' : '') +
    '</div>' +
    '<h2>Raise on this PR ' +
    counts(raise) +
    '</h2>' +
    (raise.map(findingCard).join('') || '<p class="muted">Nothing to raise.</p>') +
    (skip.length
      ? '<h2>Introduced here, fixed later</h2><p class="muted">Do not comment on these here.</p>' +
        skip.map(findingCard).join('')
      : '') +
    '<h2>Reading guide</h2>' +
    (g
      ? '<div class="card">' + md(g.guide) + '</div>'
      : '<p class="muted">Small PR: read the diff directly.</p>')
  )
}

const filt = ui.filters
export function viewFindings() {
  const opt = (k, vals, label) =>
    '<select data-f="' +
    k +
    '"><option value="">' +
    label +
    '</option>' +
    vals
      .map(
        (v) =>
          '<option value="' +
          h(v[0]) +
          '"' +
          (String(filt[k]) === String(v[0]) ? ' selected' : '') +
          '>' +
          h(v[1]) +
          '</option>'
      )
      .join('') +
    '</select>'
  const rows = findings
    .filter(
      (f) =>
        (!filt.sev || f.severity === filt.sev) &&
        (!filt.unit || f.unitId === filt.unit) &&
        (!filt.pr || String(f.introducedIn) === filt.pr) &&
        (!filt.status || f.status === filt.status) &&
        (!filt.triage || (filt.triage === 'none' ? !triage(f.id) : triage(f.id) === filt.triage)) &&
        (!filt.q ||
          (f.title + ' ' + f.file + ' ' + f.detail).toLowerCase().includes(filt.q.toLowerCase()))
    )
    .sort((a, b) => SEV[a.severity] - SEV[b.severity])
  return (
    '<h1>Findings</h1><div class="filters">' +
    opt(
      'sev',
      [
        ['high', 'high'],
        ['medium', 'medium'],
        ['low', 'low'],
      ],
      'Any severity'
    ) +
    opt(
      'unit',
      D.units.map((u) => [u.id, u.name]),
      'Any layer or seam'
    ) +
    opt(
      'pr',
      D.scope.prs.map((p) => [String(p.number), '#' + p.number]),
      'Any PR'
    ) +
    opt(
      'status',
      [
        ['present-at-head', 'present at head'],
        ['fixed-later', 'fixed later'],
        ['unknown', 'unknown'],
      ],
      'Any status'
    ) +
    opt(
      'triage',
      [
        ['none', 'untriaged'],
        ['raise', 'raise'],
        ['dismiss', 'dismiss'],
        ['later', 'later'],
      ],
      'Any triage'
    ) +
    '<input type="search" data-f="q" placeholder="Search" value="' +
    h(filt.q) +
    '"><span class="muted">' +
    rows.length +
    ' shown</span></div>' +
    '<table><tr><th>ID</th><th>Sev</th><th>Title</th><th>Location</th><th>Area</th><th>PR</th><th>Status</th><th>Triage</th></tr>' +
    rows
      .map(
        (f) =>
          '<tr class="click' +
          (triage(f.id) ? ' done' : '') +
          '" data-go="#/finding/' +
          f.id +
          '"><td class="mono">' +
          f.id +
          '</td><td><span class="sev ' +
          f.severity +
          '">' +
          f.severity +
          '</span></td><td>' +
          h(f.title) +
          '</td><td class="mono">' +
          h(f.file) +
          ':' +
          f.line +
          '</td><td>' +
          h(f.unit) +
          '</td><td>' +
          (f.introducedIn ? '#' + f.introducedIn : '-') +
          '</td><td>' +
          h(f.status === 'fixed-later' ? 'fixed in #' + f.fixedIn : f.status || '-') +
          '</td><td>' +
          h(triage(f.id) || '-') +
          '</td></tr>'
      )
      .join('') +
    '</table>'
  )
}

export function viewFinding(id) {
  const f = findings.find((x) => x.id === id)
  if (!f) return '<p>Unknown finding.</p>'
  return viewCode(f.file, anchorLine(f), f.id)
}
