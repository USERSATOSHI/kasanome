import { execFileSync } from 'node:child_process'

export function publishSummary(repo, pr, state) {
  const gh = (...args) =>
    execFileSync('gh', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  const info = JSON.parse(gh('pr', 'view', String(pr), '--json', 'url,headRefOid'))
  if (info.headRefOid !== state.headCommit)
    throw new Error('PR head changed or differs from reviewed commit; summary was not published')
  const match = info.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/)
  if (!match) throw new Error('Only github.com PR publication is supported')
  const path = `repos/${match[1]}/issues/${match[2]}/comments`
  const marker = '<!-- kasanome:review-summary:v1 -->'
  const comments = JSON.parse(gh('api', '--paginate', '--slurp', path)).flat()
  const login = JSON.parse(gh('api', 'user')).login
  const existing = comments.filter((c) => c.user?.login === login && c.body?.startsWith(marker))
  if (existing.length > 1)
    throw new Error('Multiple Kasanome summaries found; choose one manually before publication')
  const active = state.findings.filter((f) => !['resolved', 'refuted'].includes(f.lifecycle))
  const clean = (text) =>
    String(text)
      .replace(/[\r\n]/g, ' ')
      .replace(/</g, '&lt;')
  const body = `${marker}\n## Kasanome review\n\nCommit: ${state.headCommit}\n\nCoverage: ${state.coverage.complete ? 'selected scope complete' : 'partial; not approval'}. Skipped: ${state.coverage.skipped.join(', ') || 'none'}. Verification incomplete: ${state.coverage.verificationIncomplete}.\n\nAgent calls: ${state.usage.calls}/${state.usage.maxCalls}. Reported tokens: ${state.usage.tokensKnown ? state.usage.totalTokens : 'unavailable'}.\n\n${active.map((f) => `- **${f.id} [${f.severity}; ${f.lifecycle}]** ${clean(f.title)} — ${clean(f.file)}:${f.line}\n  ${clean(f.detail)}`).join('\n') || 'No active findings. This does not constitute approval.'}\n\nResolved findings: ${state.findings.filter((f) => f.lifecycle === 'resolved').length}.`
  const endpoint = existing.length ? `repos/${match[1]}/issues/comments/${existing[0].id}` : path
  const result = JSON.parse(
    execFileSync(
      'gh',
      ['api', '--method', existing.length ? 'PATCH' : 'POST', endpoint, '--input', '-'],
      {
        cwd: repo,
        encoding: 'utf8',
        input: JSON.stringify({ body }),
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )
  )
  return { prUrl: info.url, commentId: result.id, url: result.html_url }
}
