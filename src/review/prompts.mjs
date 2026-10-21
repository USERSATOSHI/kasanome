export function createPrompts(opt) {
  const maxSeams = Number(opt.maxSeams ?? 3)
  const maxLayers = Number(opt.maxLayers || 6)
  const focus = opt.focus ? `\nThe reviewer especially cares about: ${opt.focus}\n` : ''
  const NO_WRITE =
    'Read-only task: do not modify files, commit, push, or post comments. Use git, gh (read commands), and file reads only.'

  const knownFor = (paths) => {
    const known = (opt.knownFindings || [])
      .filter(
        (f) =>
          !['resolved', 'refuted'].includes(f.lifecycle) &&
          paths.some(
            (p) =>
              f.file === p || f.file.startsWith(p.replace(/\*.*$/, '').replace(/\/$/, '') + '/')
          )
      )
      .slice(0, Number(opt.maxFindings ?? 12))
    return known.length
      ? `Already tracked findings (do not rediscover or repeat these; the shared verifier rechecks them):\n${known.map((f) => `${f.id} ${f.file}:${f.line} ${f.title}`).join('\n')}`
      : ''
  }

  const mapPrompt = (
    scope,
    ctx
  ) => `Build an architectural layer map of the code changed in ${ctx.range}. ${NO_WRITE}
${ctx.readHint}

Changed areas (by lines): ${JSON.stringify(scope.topDirs)}
Languages: ${scope.languages.join(', ')}
${ctx.spec}

Review the FINAL state at head, not the history.
1. Read the import/dependency graph of the changed source. Skim entry points and the most-imported modules.
2. Group the changed code into 1-${maxLayers} layers ordered bottom-up by dependency (foundation/types/config/storage first, entry points last). Infer from how THIS codebase is wired, not a textbook template. Tests get their own layer only if large; otherwise describe them under "tests".
3. For each layer: purpose, paths, approximate changed lines, contracts other layers depend on (name + file), layers it depends on, back-edges.
4. List the riskiest seams between layers (at most ${maxSeams + 2}) with files on both sides: where data shape, error semantics, or ownership changes hands.
Every changed source path should belong to exactly one layer. Seam from/to must be existing layer IDs; omit seams for a single-layer repository.`

  const contractsOf = (map, ids) =>
    ids
      .map((id) => map.layers.find((l) => l.id === id))
      .filter(Boolean)
      .map((l) => `- ${l.name}: ${l.contracts.join('; ')}`)
      .join('\n') || '(none)'

  const layerPrompt = (
    l,
    map,
    ctx
  ) => `Review the "${l.name}" layer of the code changed in ${ctx.range}. ${NO_WRITE}
${ctx.readHint}

System overview: ${map.overview}
This layer's purpose: ${l.purpose}
Paths: ${l.paths.join(', ')}
Its contracts: ${l.contracts.join('; ')}
Known back-edges: ${l.backEdges.join('; ') || 'none'}
${knownFor(l.paths)}
Contracts of layers it depends on (treat as given, do not review them):
${contractsOf(map, l.dependsOn)}
${ctx.spec}${focus}
Review the final code at head; use \`git diff ${ctx.range} -- <paths>\` to see what is new. Focus on new/changed code.
Bound context to the named paths and contracts. Expand only to direct callers needed to prove an issue. Do not remap the repository.\nStructure first, then correctness:
- One clear job? Contracts small, well-named, hard to misuse?
- Leaky abstractions, layering violations, hidden coupling, global state.
- Duplication (including reimplementing what a lower layer offers), dead code, speculative generality.
- Correctness bugs, unhandled errors, edge cases, concurrency, resource leaks.
- Behaviour that disagrees with the spec docs.
- Test gaps for the riskiest logic.
Report only issues with file, line, and a concrete consequence. No linter-level nits. Prefer 3 solid findings over 15 speculative ones.
Also give the reading order (3-10 files) a human should follow for this layer.`

  const seamPrompt = (s, map, ctx) => {
    const name = (id) => map.layers.find((l) => l.id === id)?.name || id
    return `Review the boundary between "${name(s.from)}" and "${name(s.to)}" in ${ctx.range}. ${NO_WRITE}
${ctx.readHint}

System overview: ${map.overview}
Why this seam is risky: ${s.why}
Files on both sides: ${s.files.join(', ')}
${knownFor(s.files)}
Contracts involved:
${contractsOf(map, [s.from, s.to])}
${focus}
Stay within the named files and contracts; expand only to direct callers needed to prove an issue. Do not review either layer internally. Only what crosses the boundary:
- Type/shape drift between producer and consumer (optional vs required, units, ids, enums).
- Error semantics: thrown vs returned, swallowed errors, retries on both sides, partial failure.
- Ownership: who validates, logs, owns lifecycle/cleanup; double handling or nobody handling.
- Config/constants read on both sides with different defaults.
- Ordering/timing assumptions.
Report only issues with file and line on at least one side and a concrete consequence. Give a short reading order.`
  }

  const verifyPrompt = (
    unitName,
    findings,
    ctx
  ) => `You are a skeptical senior reviewer. Try to REFUTE each finding below from a review of "${unitName}" in ${ctx.range}. ${NO_WRITE}
${ctx.readHint}

Open the cited code and its callers/callees. Check that sourceExcerpt is verbatim from the cited file at head and the line number refers to that excerpt; do not treat a plausible line number as checked evidence. Mark real=false if the code does not say what the finding claims, the case is handled elsewhere, the consequence cannot happen in practice, it is pure style, or it is speculative. If uncertain, real=false. If real, correct the severity when over- or understated. Return one verdict per index. Existing findings have an id and lifecycle below: do not rediscover them. For an existing finding, real=false does NOT prove a fix. Set resolution="resolved" only when you inspected the current code and confirmed the defect was removed or fixed; otherwise use resolution="unknown". Use resolution="present" when real=true. A missing excerpt, moved lines, or uncertainty requires unknown, not resolved.

${findings.map((f, i) => `[${i}] (${f.severity}, ${f.category}) ${f.title}${f.id ? ` [existing ${f.id}, ${f.lifecycle}]` : ''}\n    ${f.file}:${f.line}\n    ${f.detail}\n    evidence: ${f.evidence}\n    additional reviewer evidence: ${JSON.stringify(f.supportingEvidence || [])}\n    source excerpt: ${f.sourceExcerpt || '(not provided in this older finding)'}`).join('\n\n')}`

  const attribPrompt = (
    prs,
    findings,
    head
  ) => `Map each review finding to the stacked PR that introduced it. ${NO_WRITE}

PR stack, bottom to top:
${prs.map((p) => `#${p.number} ${p.headRef} -> ${p.baseRef}: ${p.title}`).join('\n')}

For each finding, use git log -L / git log -S / git blame on the PR head branches (origin/<branch> or fetch via gh if needed) to find the lowest PR whose diff introduced the cited code. Then check whether the problem still exists at ${head} (present-at-head) or was removed/fixed by a later PR (fixed-later, fixedIn = that PR). Use 0 / unknown when you cannot tell.

Findings:
${findings.map((f) => `${f.id}: ${f.file}:${f.line} ${f.title}`).join('\n')}`

  const prGuidePrompt = (
    p,
    prs,
    layers,
    mine
  ) => `Write a reading guide for PR #${p.number} "${p.title}" (${p.headRef} -> ${p.baseRef}, +${p.additions}/-${p.deletions}). ${NO_WRITE}
The reviewer already read a layer-by-layer guide of the whole system. Help them review THIS PR's diff (git diff ${p.baseRef}...${p.headRef}; use origin/ refs or fetch if needed) in layer order.

Layers:
${layers.map((l) => `- ${l.id} (${l.name}): ${l.paths.join(', ')}`).join('\n')}

Later PRs in the stack: ${
    prs
      .slice(prs.indexOf(p) + 1)
      .map((x) => `#${x.number} ${x.title}`)
      .join('; ') || 'none'
  }

Output Markdown, plain text, no emojis, under 80 lines, with sections:
1. "Shape": one paragraph, then this PR's changed lines per layer (approximate %).
2. "Contracts introduced or changed": interfaces later layers or PRs depend on. This is where attention should go.
3. "Reading order": per layer bottom-up, the 3-8 files that matter, one line each. Name files safe to skim (generated, fixtures, mechanical).
4. "Superseded later": code in this PR that a later PR rewrites or deletes, so the reviewer does not comment on it here. Check by diffing this PR head against later heads.
5. "Findings to raise on this PR": ${mine.length ? mine.map((f) => `${f.id} ${f.file}:${f.line} ${f.title} [${f.status || 'unknown'}${f.fixedIn ? `, fixed in #${f.fixedIn}` : ''}]`).join('; ') : 'none attributed'}. Present-at-head ones as "raise"; fixed-later ones as "skip, fixed in #N".`
  return {
    mapPrompt,
    layerPrompt,
    seamPrompt,
    verifyPrompt,
    attribPrompt,
    prGuidePrompt,
  }
}
