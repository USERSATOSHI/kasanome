// Old findings often contain paraphrased evidence and approximate line numbers.
// Anchor only when actual source text supports the location; preserve the reported line.
export function resolveAnchors(source, findings) {
  const files = new Map((source?.files || []).map((f) => [f.path, f]))
  const tokens = (text) => [...text.matchAll(/[A-Za-z_$][\w$]*|\d+|[^\s]/g)].map((m) => m[0])
  const scoreLine = (line, evidence) => {
    const a = tokens(line)
    let best = { score: 0, text: '' }
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < evidence.length; j++) {
        let n = 0
        while (i + n < a.length && j + n < evidence.length && a[i + n] === evidence[j + n]) n++
        const part = a.slice(i, i + n)
        if (
          n > best.score &&
          part.join('').length >= 18 &&
          part.filter((t) => /^[A-Za-z_$]/.test(t)).length >= 2
        )
          best = { score: n, text: part.join(' ') }
      }
    return best
  }
  return findings.map((f) => {
    const content = files.get(f.file)?.content
    const unresolved = (reason) => ({
      ...f,
      anchor: { status: 'unresolved', line: null, reportedLine: f.line, reason },
    })
    if (typeof content !== 'string')
      return unresolved('Source is unavailable; the reported line could not be checked.')
    if (f.sourceExcerpt?.trim()) {
      const excerpt = f.sourceExcerpt.replace(/\r\n/g, '\n').trim(),
        text = content.replace(/\r\n/g, '\n')
      const at = text.indexOf(excerpt)
      if (at < 0 || text.indexOf(excerpt, at + 1) >= 0)
        return unresolved(
          'The source excerpt is absent or appears more than once in this snapshot.'
        )
      const line = text.slice(0, at).split('\n').length
      return {
        ...f,
        anchor: {
          status: 'exact-excerpt',
          line,
          endLine: line + excerpt.split('\n').length - 1,
          reportedLine: f.line,
          reason: 'Located by a unique verbatim source excerpt.',
        },
      }
    }
    const evidence = tokens(String(f.evidence || ''))
    const lines = content.split('\n'),
      scores = lines.map((line) => scoreLine(line, evidence))
    const reported = scores[f.line - 1]
    if (reported?.score >= 5 && !/^\s*(\/\/|\/\*|\*|#)/.test(lines[f.line - 1]))
      return {
        ...f,
        anchor: {
          status: 'evidence-match',
          line: f.line,
          reportedLine: f.line,
          reason: 'Reported line matches a contiguous token sequence in the evidence.',
        },
      }
    const best = Math.max(0, ...scores.map((s) => s.score))
    const candidates = scores.flatMap((s, i) =>
      s.score === best && best >= 6 && !/^\s*(\/\/|\/\*|\*|#)/.test(lines[i]) ? [i + 1] : []
    )
    if (candidates.length !== 1)
      return unresolved(
        'Evidence does not identify a unique source line. The agent-reported location is approximate.'
      )
    return {
      ...f,
      anchor: {
        status: 'evidence-match',
        line: candidates[0],
        reportedLine: f.line,
        reason: 'Relocated to the unique strongest contiguous source match in the evidence.',
      },
    }
  })
}
