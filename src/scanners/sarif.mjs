import { isAbsolute, relative, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

function sourcePath(uri, root) {
  if (typeof uri !== 'string') return null
  try {
    const path = uri.startsWith('file:') ? fileURLToPath(uri) : decodeURIComponent(uri)
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) return null
    const local = isAbsolute(path) ? relative(root, path) : posix.normalize(path)
    return local && local !== '..' && !local.startsWith('../') && !isAbsolute(local) ? local : null
  } catch {
    return null
  }
}

export function parseSarif(document, root, scanner) {
  if (document.version !== '2.1.0' || !Array.isArray(document.runs))
    throw new Error('Expected SARIF 2.1.0 with a runs array')
  const candidates = []
  let omitted = 0
  for (const run of document.runs) {
    if (run.results !== undefined && !Array.isArray(run.results))
      throw new Error('SARIF results must be an array')
    if (run.invocations?.some((invocation) => invocation.executionSuccessful === false))
      throw new Error('SARIF reports an unsuccessful scanner invocation')
    const rules = run.tool?.driver?.rules || []
    for (const result of run.results || []) {
      if (result.suppressions?.some((s) => !s.status || s.status === 'accepted')) continue
      if (result.kind && ['pass', 'notApplicable', 'informational'].includes(result.kind)) continue
      const location = result.locations?.[0]?.physicalLocation
      const artifact = location?.artifactLocation
      const indexed = run.artifacts?.[artifact?.index]?.location
      const uri = artifact?.uri || indexed?.uri
      const base = run.originalUriBaseIds?.[artifact?.uriBaseId || indexed?.uriBaseId]?.uri
      let file = sourcePath(uri, root)
      if (base && uri) {
        try {
          file = sourcePath(new URL(uri, base).href, root)
        } catch {
          file = null
        }
      }
      const line = location?.region?.startLine
      if (!file || !Number.isInteger(line) || line < 1) {
        omitted++
        continue
      }
      const rule = rules.find((r) => r.id === result.ruleId) || rules[result.ruleIndex] || {}
      const score = Number(rule.properties?.['security-severity'])
      const level = result.level || rule.defaultConfiguration?.level || 'warning'
      candidates.push({
        scanner: scanner || run.tool?.driver?.name || 'sarif',
        ruleId: result.ruleId || rule.id || 'unknown',
        file,
        line,
        endLine: location.region.endLine || line,
        severity: score >= 7 || level === 'error' ? 'high' : level === 'warning' ? 'medium' : 'low',
        detail: String(
          result.message?.text ||
            result.message?.markdown ||
            rule.shortDescription?.text ||
            'Scanner finding'
        ),
      })
    }
  }
  return { candidates, omitted }
}

export function toSarif(scan) {
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: { name: 'kasanome', informationUri: 'https://github.com/USERSATOSHI/kasanome' },
        },
        invocations: [{ executionSuccessful: scan.complete }],
        properties: {
          headCommit: scan.headCommit,
          baseCommit: scan.baseCommit,
          scanners: scan.scanners,
          verification: 'unchecked scanner candidates',
        },
        results: [...scan.candidates, ...scan.advisories].map((f) => ({
          ruleId: `${f.scanner}/${f.ruleId}`,
          level: { high: 'error', medium: 'warning', low: 'note' }[f.severity],
          message: { text: f.detail },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file.split('/').map(encodeURIComponent).join('/') },
                region: { startLine: f.line, endLine: f.endLine },
              },
            },
          ],
          properties: { verification: 'unverified', inChangedLines: !scan.advisories.includes(f) },
        })),
      },
    ],
  }
}
