export function summarizeReport(data, file) {
  return {
    report: file,
    range: data.range,
    agent: data.agent,
    findings: {
      open: data.findings.filter(
        (f) =>
          !['unverified', 'resolved', 'refuted'].includes(f.lifecycle) && f.status !== 'fixed-later'
      ).length,
      unverified: data.findings.filter((f) => f.lifecycle === 'unverified').length,
      resolved: (data.findingHistory || []).filter((f) => f.lifecycle === 'resolved').length,
    },
    coverage: data.coverage || null,
    usage: data.usage || null,
  }
}

export function formatSummary(summary) {
  const { coverage, findings, usage } = summary
  const lines = [
    `Kasanome · ${coverage?.style || 'layered'} review`,
    `Findings: ${findings.open} open · ${findings.unverified} unverified · ${findings.resolved} resolved`,
    `Coverage: ${coverage ? (coverage.complete ? 'complete within selected scope' : 'partial') : 'not recorded'}${coverage?.skipped?.length ? ` · ${coverage.skipped.length} pending units` : ''}`,
  ]
  if (coverage?.style === 'quick')
    lines.push('Scope: supplied diff context; no architectural audit.')
  if (usage)
    lines.push(
      `Usage: ${usage.calls}/${usage.maxCalls} agent calls · ${usage.cacheHits} cached answers · ${usage.tokensKnown ? usage.totalTokens + ' reported tokens' : 'tokens unavailable (partial: ' + usage.totalTokens + ')'}`
    )
  lines.push(`Report: ${summary.report}`)
  return lines.join('\n')
}
