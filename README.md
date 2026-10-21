# Kasanome

Review a large git diff or stacked PRs by architectural layer, using your existing Claude, Codex, OpenCode, or custom agent CLI. Produces the same self-contained HTML dashboard on every project. Zero runtime dependencies; Node.js 18+ and Git required.

## Install

Install from GitHub with Node.js 18+ and Git:

```sh
npm install --global --install-links git+https://github.com/USERSATOSHI/kasanome.git
kasanome --version
```

Or clone the source:

```sh
git clone https://github.com/USERSATOSHI/kasanome.git
cd kasanome
npm install
npm install --global --install-links .
```

Agent execution uses the chosen CLI's existing login and quota; the tool does not call model APIs itself. Install and authenticate at least one supported agent CLI separately. `gh` is optional for reviewing diffs, required for PR lookup/attribution.

To update a cloned install, run `git pull --ff-only`, then `npm install --global --install-links .`. For a direct Git install, repeat the install command. Reinstall skills with `--force` to update their bundled runtime.

## Use from the terminal

Run inside the repository you want reviewed:

```sh
kasanome --agent claude --base main --head HEAD
kasanome --agent codex --base main --head stack/top --prs 37,38,39
kasanome --agent codex --base main --prs none --focus "error handling, data model"
kasanome --agent opencode --base main --prs none
kasanome --agent custom --agent-cmd 'my-agent --read-only'
kasanome --help
```

Use `--repo /path/to/repo` to review a different directory. Claude is the CLI default. Pass `--model <id>` to select a model supported by your installed agent CLI.

The output is `kasanome/index.html` plus `data.json` inside the reviewed repo. Open the HTML in a browser; it needs JavaScript and does not need a web server. The report directory is added to Git's local exclude file. Nothing is committed. Posting requires explicit `--publish <PR-number>`.

## Use from Claude Code or Codex

Install the user skills after installing the CLI:

```sh
kasanome install --target all
# Or install only one:
kasanome install --target claude
kasanome install --target codex
```

- **Claude Code:** installs to `~/.claude/skills/kasanome`. Invoke `/kasanome review main...HEAD`.
- **Codex:** installs to `~/.agents/skills/kasanome`. Invoke `$kasanome review main...HEAD`.

Restart the agent session if the skill is not visible. The Claude installation defaults to Claude and the Codex installation defaults to Codex; you can request another backend explicitly. Each installed skill includes its own runtime and can run without a global CLI or the source checkout. The backend CLI still needs to be installed and authenticated. The installer refuses to replace an existing skill unless you pass `--force`; it preserves unrelated files.

For a checkout without global installation, run:

```sh
node bin/kasanome.mjs install --target all
node bin/kasanome.mjs --help
```

Other agent environments can use the CLI or the portable `skills/kasanome/SKILL.md` instructions. The included launcher also works in this source checkout. The installer is the supported way to get a self-contained copy of the skill.

Skill discovery follows [Claude Code skills](https://code.claude.com/docs/en/skills) and [Codex local skills](https://learn.chatgpt.com/docs/build-skills).

## What a review does

1. Pin base/head commits and collect scope with Git, without an agent call.
2. Build an architectural map on the first run. Reuse it on descendant commits; refresh it for unmapped paths, dependency manifests, changed review policy/base, or diverged history.
3. Review affected layers, direct consumers, and adjacent boundaries. Continue previously skipped units against the complete PR diff.
4. Merge findings with the same file, category, normalized title, and source excerpt before one shared skeptical verification call. Preserve reviewer origins. Differently worded duplicates may remain separate.
5. Keep stable finding IDs and commit-linked verification history. Recheck affected existing findings rather than treating them as new. Uncertain or deferred checks remain unverified; only explicit evidence of a fix resolves a known finding.
6. Save state and render the dashboard. PR attribution and reading guides require `--guides`; GitHub publication requires `--publish <number>`.

The dashboard has overview, architecture, layers, boundaries, PRs, findings, reading checkboxes, triage controls, filters, and light/dark mode.

**Code review:** click any finding or file reference to open a GitHub-style code workspace. Browse changed files, search paths, filter by architectural layer, switch between unified diff and full file, and triage findings directly beneath the cited lines. Previous/next finding links keep you moving through the review. Source uses lightweight token coloring; evidence and verification notes expand inside each comment. The explicit “Open in editor” link still opens VS Code.

Source and diffs are embedded from Git, with the head snapshot's commit displayed in the workspace. No server or live filesystem access is needed to read code. Unchanged lines outside diff hunks receive additional context when a finding cites them. New findings carry a verbatim source excerpt and are anchored only when it has a unique exact match. Older findings are checked against contiguous evidence tokens: matching reported lines are retained, uniquely strongest matches can relocate an approximate line, and ambiguous locations remain unanchored. Original reported lines and the matching method stay visible. Missing lines are reported rather than attached to an unrelated line. Binary files and oversized source/diffs have explicit unavailable messages (300 KB per source file, bounded total snapshot size).

Existing reports gain the code view by running `--render` with their repository available. The first rebuild resolves their stored ref names to the commits available now; earlier reports did not record commit IDs. Once a source snapshot exists in `data.json`, subsequent rebuilds preserve it even if branches move. New review runs pin source refs before the layer reviews start. Progress is stored in browser localStorage; if unavailable, progress lasts for the session. The layout comes from fixed renderer code; the model chooses the project-specific content.

This is a structural review, not exhaustive line-by-line coverage or automatic approval. Default limits are six layers and three boundaries. Increase `--max-layers` / `--max-seams` for wider coverage. Check the run log and `failed` in `data.json` for gaps. Findings need human triage before acting on them.

## Agents and execution

| Backend    | Command           | Review restrictions                               |
| ---------- | ----------------- | ------------------------------------------------- |
| `claude`   | `claude -p`       | Read-oriented tool permissions; Edit/Write denied |
| `codex`    | `codex exec -`    | `--sandbox read-only`; schema output              |
| `opencode` | `opencode run`    | Built-in `plan` agent                             |
| `custom`   | `sh -c <command>` | Your command controls its own permissions         |

All prompts instruct agents to read only. Tool permissions are not a universal OS sandbox: Claude's allowed Git/GitHub shell commands are broad, and custom commands are your responsibility. Inspect changes before running unfamiliar backends. The runner itself writes reports/cache and Git's local exclude file.

For OpenCode v2, `--opencode-standalone` runs each call with a private server instead of the shared background service:

```sh
kasanome --agent opencode --opencode-standalone --model <provider/model> --base origin/main
```

The OpenCode adapter sends the prompt through stdin and reads structured JSON events. It sets the subprocess working directory and `PWD` to the reviewed repository. It does not restart the shared service. Token accounting remains partial when the CLI omits a final usage event.

Custom commands receive the prompt on stdin, plus `KASANOME_PROMPT_FILE`, `KASANOME_OUT_FILE` (optional answer file), and `KASANOME_SCHEMA_FILE`. JSON output is parsed, validated, and retried up to twice after an invalid answer.

## Incremental reviews and usage

Incremental review is the default. Start with your authenticated Codex CLI:

```sh
kasanome --agent codex --base main --prs none
# Run the same command after fixes, or to continue skipped coverage.
kasanome --agent codex --base main --prs none
```

**The first run has no reusable context.** It builds a map once and reviews only what fits the budget. The default hard cap is **four agent launches**, including retries: typically one map, two layer reviews, and one shared verification call. A small repository may need fewer calls. Later runs reuse the map and review affected areas or continue pending coverage. Once coverage is complete, repeating an unchanged review can use zero agent calls. Scope collection and dashboard rendering use no model calls.

Defaults favor low usage: concurrency one, no automatic retries, no PR guides, at most twelve finding checks per run. Known findings in unaffected areas are retained without rechecking. Additional findings stay unverified for a later run. These settings reduce repeated work; **four calls can still consume substantial tokens** if the repository or agent tool reads are large.

```sh
# Two-call cap: map first, then continue bounded reviews on subsequent runs.
kasanome --agent codex --base main --max-calls 2
# Broader architectural audit, still bounded by an explicit call cap.
kasanome --agent codex --base main --mode full --max-calls 20
# Optional expensive extras; they share the same launch budget.
kasanome --agent codex --base main --guides --max-calls 12
```

`--max-calls` limits launched CLI processes, including failed attempts and `--retries`. Cached answers consume no calls. It is not a hard token limit: the supported CLIs do not provide a uniform per-call token ceiling, so `--token-budget` is rejected instead of claiming enforcement. Codex and OpenCode JSON events and Claude JSON results provide reported token totals when available; unsupported or failed accounting is marked unavailable, with a partial total retained. Tokens are provider-reported usage, not subscription quota percentages or actual charges. No API billing is introduced.

`data.json` and the dashboard show calls, cache hits, reported tokens, skipped units, and incomplete verification. Coverage is limited to mapped layers and boundaries; a green/empty report is not approval. The initial map uses changed-area summaries, and reviewer prompts bound attention to their paths and direct contracts; these are instructions, not an enforced tool-read or context-window limit.

Durable history lives under `<out>/.state/`, keyed by repository, base ref, and head branch/ref. `<out>/state.json` mirrors the latest run for inspection. It records reviewed commits, the reusable map, pending coverage, stable finding IDs, verification history, and per-run usage. Use stable ref names across runs; switching branches preserves each branch's state. Renames or substantially reworded findings can receive a new identity. Browser triage remains localStorage data and is separate from verified finding resolution.

Agent answers are cached under `<out>/.cache`, keyed by pinned commit IDs, backend, model, custom command, and prompt. Moving branch names no longer reuse answers for a different commit. `--fresh` ignores agent-answer caches; use `--mode full --fresh` to force a fresh architectural pass. Successful units and answers survive interruption, but an unfinished run does not advance durable state. One output directory is locked against concurrent reviews; after an abnormal termination, remove `.review.lock` only after confirming the previous run stopped.

### Updating one PR summary

```sh
kasanome --agent codex --base main --publish 123
```

This explicitly authorizes creating/updating a single marked GitHub **summary comment**, rather than posting a new formal review or inline comments on every run. Rerun with `--publish 123` after fixes. It uses your authenticated `gh` account, updates only that account's marked comment, and checks that the PR head matches the reviewed commit. Other comments and reviews remain untouched. No publication happens without this flag. GitHub Enterprise publication is not yet supported.

Rebuild a dashboard without invoking agents (from a Git repository):

```sh
kasanome --render kasanome/data.json
```

Reports, state, and caches contain code-related material; keep them local unless you intend to share them.

## Development

Use Bun for development. The installed CLI runs on Node.js 18+ and has no runtime package dependencies.

```sh
bun install
bun run build
bun run check               # Fallow: dead code, duplication, and complexity
bun run check:dead-code     # Fail on dead code and unresolved imports
bun run check:architecture  # Fail on import cycles and boundary violations
bun run format:check
npm test                    # Package, incremental-state, budget, and source regressions
```

The generated browser bundle is committed so GitHub installs can run without a build tool. CI rebuilds it and checks for drift. After changing browser code, run `bun run build` and commit the updated `dist/dashboard.js` alongside the source. Package archives also include this bundle.

The source is organized by responsibility:

| Directory          | Responsibility                                            |
| ------------------ | --------------------------------------------------------- |
| `bin/`             | CLI entry point                                           |
| `src/cli/`         | Options and skill installation                            |
| `src/agents/`      | Agent adapters, execution, caching, and output validation |
| `src/review/`      | Review phases, prompts, and response schemas              |
| `src/report/`      | Git snapshots, finding locations, and report data         |
| `src/dashboard/`   | HTML renderer, CSS, and browser modules                   |
| `skills/kasanome/` | Portable Claude Code and Codex skill                      |
| `scripts/`         | Dashboard build                                           |
| `test/`            | Existing package, source, and location checks             |

Fallow scans the CLI, browser, skill, build, and test entry points. Only the generated `dist/` bundle is excluded from analysis. Dead code and architecture checks gate CI; complexity findings remain visible in `bun run check` to guide refactoring.

## Updating from structural-review

The CLI command and skill are now `kasanome`. New reports default to `kasanome/`. Existing `data.json` files still work:

```sh
kasanome --render structural-review/data.json --out structural-review
kasanome install --target all --force
```

Browser progress from older reports is read when there is no Kasanome progress yet. The custom-agent environment variables are now `KASANOME_PROMPT_FILE`, `KASANOME_OUT_FILE`, and `KASANOME_SCHEMA_FILE`.

## License

Copyright 2026 USERSATOSHI. Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
