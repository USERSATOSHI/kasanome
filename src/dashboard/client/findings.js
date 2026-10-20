import { triage, anchorLine } from './model.js'
import { h, fileLink, inl, SEV } from './html.js'
export function findingCard(f) {
  const t = triage(f.id)
  const pr = f.introducedIn
    ? '<a class="pill" href="#/pr/' + f.introducedIn + '">PR #' + f.introducedIn + '</a>'
    : ''
  const st =
    f.status === 'fixed-later'
      ? '<span class="pill">fixed in #' + f.fixedIn + '</span>'
      : f.status === 'present-at-head'
        ? '<span class="pill">present at head</span>'
        : ''
  return (
    '<div class="card finding ' +
    f.severity +
    '" id="f-' +
    f.id +
    '">' +
    '<div class="head"><span class="sev ' +
    f.severity +
    '">' +
    f.severity +
    '</span><span class="mono muted">' +
    f.id +
    '</span><span class="title">' +
    h(f.title) +
    '</span>' +
    pr +
    st +
    '</div>' +
    '<div style="margin:6px 0">' +
    fileLink(f.file, anchorLine(f)) +
    ' <span class="pill">' +
    h(f.category) +
    '</span> <a class="pill" href="#/unit/' +
    encodeURIComponent(f.unitId) +
    '">' +
    h(f.unit) +
    '</a></div>' +
    (f.anchor
      ? '<div class="anchor-note muted">' +
        (f.anchor.line
          ? (f.anchor.line !== f.line
              ? 'Location corrected: reported L' + f.line + ' → source L' + f.anchor.line + '. '
              : '') +
            (f.anchor.status === 'exact-excerpt'
              ? 'Exact excerpt match.'
              : 'Matched to source evidence.')
          : 'Approximate location: reported L' + f.line + '. ' + h(f.anchor.reason)) +
        '</div>'
      : '') +
    '<p>' +
    h(f.detail) +
    '</p>' +
    '<details class="finding-evidence"><summary>Evidence &amp; verification</summary><pre>' +
    h(f.evidence) +
    '</pre>' +
    (f.verifyNote ? '<div class="muted">Verifier: ' + h(f.verifyNote) + '</div>' : '') +
    '</details><div class="btns">' +
    ['raise', 'dismiss', 'later']
      .map(
        (a) =>
          '<button data-triage="' +
          f.id +
          '" data-v="' +
          a +
          '" class="' +
          (t === a ? 'on' : '') +
          '">' +
          a +
          '</button>'
      )
      .join('') +
    '</div></div>'
  )
}
export function findingRows(fs) {
  if (!fs.length) return '<p class="muted">None survived verification.</p>'
  return (
    '<div class="frows">' +
    [...fs]
      .sort((a, b) => SEV[a.severity] - SEV[b.severity])
      .map((f) => {
        const t = triage(f.id)
        return (
          '<a class="frow' +
          (t ? ' done' : '') +
          '" href="#/finding/' +
          encodeURIComponent(f.id) +
          '">' +
          '<span class="sev ' +
          f.severity +
          '">' +
          f.severity +
          '</span>' +
          '<span class="frow-main"><span class="frow-title">' +
          inl(f.title) +
          '</span>' +
          '<span class="frow-meta mono">' +
          h(f.file) +
          ':' +
          h(anchorLine(f) || f.line) +
          '</span></span>' +
          '<span class="frow-tags">' +
          (f.introducedIn ? '<span class="pill">#' + f.introducedIn + '</span>' : '') +
          (f.status === 'fixed-later'
            ? '<span class="pill">fixed in #' + f.fixedIn + '</span>'
            : '') +
          (t ? '<span class="pill tri-' + t + '">' + t + '</span>' : '') +
          '</span>' +
          '<span class="frow-go" aria-hidden="true">›</span></a>'
        )
      })
      .join('') +
    '</div>'
  )
}
