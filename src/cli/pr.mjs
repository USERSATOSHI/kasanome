import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

export function resolvePr(options) {
  const cwd = resolve(options.repo || '.')
  const run = (cmd, args) =>
    execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  let pr
  try {
    pr = JSON.parse(
      run('gh', [
        'pr',
        'view',
        options.pr,
        '--json',
        'number,url,title,baseRefName,headRefName,additions,deletions,baseRefOid,headRefOid',
      ])
    )
  } catch {
    throw new Error(
      `Could not read PR ${options.pr}. Install/authenticate gh and run from its repository.`
    )
  }
  const match = pr.url?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/)
  if (
    !match ||
    !Number.isInteger(pr.number) ||
    String(pr.number) !== match[2] ||
    ![pr.baseRefOid, pr.headRefOid].every((sha) => /^[a-f0-9]{40}$/.test(sha))
  )
    throw new Error('GitHub returned incomplete PR commit metadata')
  if (options.publish && Number(options.publish) !== pr.number)
    throw new Error('--publish must name the same PR as --pr')
  const prefix = `refs/kasanome/pr/${pr.number}`
  // Fetch objects without changing the checkout; verify the remote PR did not move mid-fetch.
  try {
    run('git', [
      'fetch',
      '--no-tags',
      `https://github.com/${match[1]}.git`,
      pr.baseRefOid,
      `refs/pull/${pr.number}/head`,
    ])
    // Resolve both pinned objects, then check for pushes made during the fetch.
    run('git', ['cat-file', '-e', `${pr.headRefOid}^{commit}`])
    run('git', ['cat-file', '-e', `${pr.baseRefOid}^{commit}`])
    const current = JSON.parse(run('gh', ['pr', 'view', pr.url, '--json', 'headRefOid,baseRefOid']))
    if (current.headRefOid !== pr.headRefOid || current.baseRefOid !== pr.baseRefOid)
      throw new Error('PR changed during fetch; rerun the review')
    run('git', ['update-ref', `${prefix}/base`, pr.baseRefOid])
    run('git', ['update-ref', `${prefix}/head`, pr.headRefOid])
  } catch (error) {
    throw new Error(
      `Could not fetch a stable snapshot of PR #${pr.number}: ${error.message.split('\n')[0]}`
    )
  }
  return {
    ...options,
    base: `${prefix}/base`,
    head: `${prefix}/head`,
    prs: options.prs || String(pr.number),
    prInfo: {
      number: pr.number,
      title: pr.title || `PR #${pr.number}`,
      url: pr.url,
      baseRef: pr.baseRefName || '',
      headRef: pr.headRefName || '',
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
    },
  }
}
