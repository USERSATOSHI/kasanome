import { layers, layerName } from './model.js'
import { h, inl, fileLink } from './html.js'
// "buildX and buildY in src/a.ts and src/b.ts" -> { what, files }
const PATH = '[\\w@./-]+\\.[a-z]{1,5}'
function parseContract(c) {
  const m = String(c).match(
    new RegExp(
      '^(.*?)\\s+(?:in|from|at)\\s+(' + PATH + '(?:(?:,\\s*|\\s+and\\s+)' + PATH + ')*)\\s*\\.?$'
    )
  )
  return m ? { what: m[1], files: m[2].split(/,\s*|\s+and\s+/) } : { what: c, files: [] }
}
const layerChip = (id) =>
  '<a class="chip-layer" href="#/unit/' + encodeURIComponent(id) + '">' + h(layerName(id)) + '</a>'
function sideBlock(title, body) {
  return '<div class="side-block"><h4>' + title + '</h4>' + body + '</div>'
}

export function unitSidebar(l, sm, r) {
  const usedBy = l ? layers.filter((x) => x.dependsOn.includes(l.id)) : []
  let side = ''
  if (l) {
    const contracts = l.contracts.map(parseContract)
    side += sideBlock(
      'Exposes',
      contracts.length
        ? '<ul class="contracts">' +
            contracts
              .map(
                (c) =>
                  '<li><div>' +
                  inl(c.what) +
                  '</div>' +
                  (c.files.length
                    ? '<div class="cfiles">' + c.files.map((f) => fileLink(f)).join('') + '</div>'
                    : '') +
                  '</li>'
              )
              .join('') +
            '</ul>'
        : '<p class="muted">Nothing listed.</p>'
    )
    side += sideBlock(
      'Depends on',
      l.dependsOn.length
        ? '<div class="chips">' + l.dependsOn.map(layerChip).join('') + '</div>'
        : '<p class="muted">Nothing. This is a base layer.</p>'
    )
    side += sideBlock(
      'Used by',
      usedBy.length
        ? '<div class="chips">' + usedBy.map((x) => layerChip(x.id)).join('') + '</div>'
        : '<p class="muted">Nothing. This is a top layer.</p>'
    )
    if (l.backEdges.length)
      side += sideBlock(
        '<span class="warn-text">Upward imports</span>',
        '<p class="muted small">A lower layer importing a higher one.</p><ul class="edges">' +
          l.backEdges
            .map((b) => {
              const [from, to] = String(b).split(/\s*->\s*/)
              return (
                '<li class="mono">' +
                (to
                  ? '<div>' +
                    h(from) +
                    '</div><div class="edge-to"><span class="arrow">imports </span>' +
                    h(to) +
                    '</div>'
                  : h(b)) +
                '</li>'
              )
            })
            .join('') +
          '</ul>'
      )
  }
  if (sm) {
    side += sideBlock(
      'Between',
      '<div class="chips">' +
        layerChip(sm.from) +
        '<span class="arrow">→</span>' +
        layerChip(sm.to) +
        '</div>'
    )
    side += sideBlock(
      'Files on the boundary',
      '<ul class="flist">' + sm.files.map((f) => '<li>' + fileLink(f) + '</li>').join('') + '</ul>'
    )
  }
  if (r && r.strengths.length)
    side +=
      '<details class="side-block strengths"><summary><h4>What is solid (' +
      r.strengths.length +
      ')</h4></summary><ul>' +
      r.strengths.map((s) => '<li>' + inl(s) + '</li>').join('') +
      '</ul></details>'

  return side
}
