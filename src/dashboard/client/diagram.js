import { layers, seams, unitOf, forUnit } from './model.js'
import { h } from './html.js'
export function diagram() {
  const W = 1000,
    BH = 54,
    GAP = 26,
    LM = 90,
    RM = 120,
    BW = W - LM - RM
  const order = [...layers].reverse()
  const y = (id) => {
    const i = order.findIndex((l) => l.id === id)
    return i < 0 ? null : 20 + i * (BH + GAP)
  }
  const H = 20 + order.length * (BH + GAP)
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px">'
  s +=
    '<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>'
  let k = 0
  layers.forEach((l) =>
    l.dependsOn.forEach((d) => {
      const y1 = y(l.id),
        y2 = y(d)
      if (y1 == null || y2 == null) return
      const back = y2 < y1,
        x = LM - 12 - (k++ % 6) * 11
      const a = y1 + BH / 2,
        b = y2 + BH / 2
      s +=
        '<path class="edge' +
        (back ? ' back' : '') +
        '" style="color:var(--' +
        (back ? 'high' : 'muted') +
        ')" marker-end="url(#ar)" d="M' +
        LM +
        ',' +
        a +
        ' C' +
        x +
        ',' +
        a +
        ' ' +
        x +
        ',' +
        b +
        ' ' +
        LM +
        ',' +
        b +
        '"/>'
    })
  )
  seams.forEach((sm, i) => {
    const y1 = y(sm.from),
      y2 = y(sm.to)
    if (y1 == null || y2 == null) return
    const x = LM + BW + 18 + i * 22,
      a = y1 + BH / 2,
      b = y2 + BH / 2,
      u = unitOf(sm.from + '->' + sm.to)
    s +=
      '<a href="#/unit/' +
      encodeURIComponent(sm.from + '->' + sm.to) +
      '"><title>' +
      h(u ? u.name : '') +
      '</title><path class="seam" d="M' +
      (LM + BW) +
      ',' +
      a +
      ' C' +
      x +
      ',' +
      a +
      ' ' +
      x +
      ',' +
      b +
      ' ' +
      (LM + BW) +
      ',' +
      b +
      '"/></a>'
  })
  order.forEach((l) => {
    const yy = y(l.id),
      fs = forUnit(l.name)
    s +=
      '<a href="#/unit/' +
      encodeURIComponent(l.id) +
      '"><rect class="band" x="' +
      LM +
      '" y="' +
      yy +
      '" width="' +
      BW +
      '" height="' +
      BH +
      '" rx="8"/>' +
      '<text x="' +
      (LM + 14) +
      '" y="' +
      (yy + 22) +
      '" font-weight="600">' +
      h(l.name) +
      '</text>' +
      '<text class="sub" x="' +
      (LM + 14) +
      '" y="' +
      (yy + 40) +
      '">' +
      h(l.paths.slice(0, 3).join('  ')) +
      (l.paths.length > 3 ? '  +' + (l.paths.length - 3) : '') +
      '</text>' +
      ['high', 'medium', 'low']
        .map((sv, j) => {
          const n = fs.filter((f) => f.severity === sv).length
          return n
            ? '<g><rect x="' +
                (LM + BW - 90 + j * 28) +
                '" y="' +
                (yy + 16) +
                '" width="24" height="18" rx="9" fill="var(--' +
                sv +
                ')"/><text x="' +
                (LM + BW - 78 + j * 28) +
                '" y="' +
                (yy + 29) +
                '" text-anchor="middle" style="fill:#fff;font-size:11px">' +
                n +
                '</text></g>'
            : ''
        })
        .join('') +
      '</a>'
  })
  return (
    s +
    '</svg><div class="muted" style="font-size:12px">Entry points on top. Left: dependencies (dashed red = upward import). Right, blue: reviewed seams. Click a layer or seam to open it.</div>'
  )
}
