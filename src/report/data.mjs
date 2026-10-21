import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectSource } from './source.mjs'
import { resolveAnchors } from './anchors.mjs'
import { renderDashboard } from '../dashboard/render.mjs'
function buildData(raw, { repo: repo, agent: agentName }) {
  const source = raw.source || collectSource(raw.repo || repo, raw.scope, raw.findings, raw.units)
  const units = raw.units.map(({ prompt, findings, ...u }) => u)
  const unitIdByName = Object.fromEntries(units.map((u) => [u.name, u.id]))
  const reviewed = new Set(units.map((u) => u.id))
  return {
    range: raw.range || `${raw.scope.base}...${raw.scope.head}`,
    repo: raw.repo || repo,
    agent: raw.agent || agentName,
    scope: raw.scope,
    map: raw.map,
    layers: raw.map.layers.filter((l) => reviewed.has(l.id)),
    seams: raw.map.seams.filter((s) => reviewed.has(`${s.from}->${s.to}`)),
    units,
    findings: resolveAnchors(
      source,
      raw.findings.map((f) => ({ ...f, unitId: f.unitId || unitIdByName[f.unit] }))
    ),
    prGuides: raw.prGuides || [],
    failed: raw.failed || [],
    coverage: raw.coverage,
    usage: raw.usage,
    findingHistory: raw.findingHistory,
    source,
  }
}

export function writeDashboard(raw, options) {
  const data = buildData(raw, options)
  const out = options.out
  writeFileSync(join(out, 'data.json'), JSON.stringify(data, null, 2))
  const file = join(out, 'index.html')
  writeFileSync(file, renderDashboard(data))
  return file
}
