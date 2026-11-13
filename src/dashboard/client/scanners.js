import { h } from './html.js'

export function scannerSummary(scan) {
  if (!scan) return ''
  return (
    '<h2>Scanners</h2><div class="card"><p>' +
    (scan.complete ? 'Selected scanners completed.' : 'Scanner coverage is partial.') +
    ' ' +
    h(scan.candidates.length) +
    ' changed-line candidates; candidates need model verification.</p><ul>' +
    scan.scanners
      .map(
        (s) =>
          '<li><b>' +
          h(s.name) +
          '</b>: ' +
          h(s.status) +
          (s.reason ? ' (' + h(s.reason) + ')' : '') +
          (s.omitted ? ' · ' + h(s.omitted) + ' locations omitted' : '') +
          '</li>'
      )
      .join('') +
    '</ul>' +
    (scan.omitted.length
      ? '<p>Omitted: ' +
        h(scan.omitted.map((o) => o.file + ' (' + o.reason + ')').join(', ')) +
        '</p>'
      : '') +
    '<details><summary>Outside-change advisories (' +
    h(scan.advisories.length) +
    ')</summary>' +
    '<p>These locations are outside changed lines. They are excluded from review findings and model verification.</p><ul>' +
    scan.advisories
      .map(
        (f) =>
          '<li><span class="mono">' +
          h(f.file) +
          ':' +
          h(f.line) +
          '</span> · ' +
          h(f.scanner) +
          '/' +
          h(f.ruleId) +
          ': ' +
          h(f.detail) +
          '</li>'
      )
      .join('') +
    '</ul></details></div>'
  )
}
