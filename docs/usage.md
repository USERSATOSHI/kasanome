# Usage and configuration

[Back to Kasanome](../README.md)

## Commands

`kasanome review` reviews committed code. The previous `kasanome [options]` form remains supported. Running `kasanome` with no arguments shows help instead of launching a review.

```sh
kasanome review --pr 123 --agent codex
kasanome review --pr https://github.com/owner/repo/pull/123 --agent codex
kasanome review --base origin/main --head feature/example --agent claude
kasanome review --repo /path/to/repo --base main --agent opencode
kasanome --help-all
```

`--pr` requires authenticated `gh` and Git access. It reads the PR's base/head commits, fetches them into `refs/kasanome/pr/<number>/base` and `head`, and reviews that snapshot. It preserves the checked-out branch and working-tree changes. A PR that moves during fetch is rejected so you can retry. Use `--pr` without `--base`, `--head`, or `--render`. This shortcut currently supports github.com.

`--prs` is separate: it selects PR metadata for optional attribution and guides. It does not fetch or select the code range; use `--pr` for that.

## Saved results and automation

```sh
kasanome status
kasanome status --repo /path/to/repo --out review-results
kasanome status --json
kasanome review --base main --agent codex --json --quiet
```

`status` reads the latest `data.json` in the report directory and makes no model calls. It describes the saved review, not a new assessment of the current working tree. `--json` emits a structured summary on stdout; review progress remains on stderr unless `--quiet` is supplied. Normal review stdout remains the HTML report path for compatibility.

Unknown options fail before a review starts. Short aliases are `-a` / `--agent`, `-m` / `--model`, `-b` / `--base`, and `-q` / `--quiet`. Long options also accept `--name=value`.

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
kasanome --agent opencode --opencode-standalone --model "provider/model" --base origin/main
```

The OpenCode adapter sends the prompt through stdin and reads structured JSON events. It sets the subprocess working directory and `PWD` to the reviewed repository. It does not restart the shared service. When the event stream omits final-answer usage, kasanome reads completed session totals using `opencode session export`. This is a local metadata command, not another model call. If export is unavailable, stream totals remain explicitly partial.

Custom commands receive the prompt on stdin, plus `KASANOME_PROMPT_FILE`, `KASANOME_OUT_FILE` (optional answer file), and `KASANOME_SCHEMA_FILE`. JSON output is parsed and validated. Retries are disabled by default; `--retries` enables them within the call budget.

## Incremental reviews and usage

Automatic mode is the default, and both quick and architectural reviews retain incremental state. Start with your authenticated Codex CLI:

```sh
kasanome --agent codex --base main --prs none
# Run the same command after fixes, or to continue skipped coverage.
kasanome --agent codex --base main --prs none
```

**Small diffs skip architecture mapping, including on the first run.** Auto mode selects quick for the complete PR range when it contains at most five changed files and 200 added/deleted lines; it selects layered incremental review for larger ranges. Run `--mode quick` to force a focused review, `--mode incremental` to force architectural mapping with reuse, or `--mode full` for a complete architectural pass within the call cap.

Quick mode uses one reviewer session, then one shared verifier session only when new or affected known findings need checking. It requests at most three concrete regressions and omits strengths and reading guides. Pre-existing test gaps, style, and speculative hardening are outside its scope. An unchanged completed review uses zero agent calls.

Git supplies complete patches with twelve surrounding lines, up to two spec-document excerpts, and up to two directly imported local module excerpts. Context defaults to 16,000 characters (`--quick-max-chars`) and five complete file patches (`--quick-max-files`). Contract excerpts are capped at 2,000 characters each. Files that cannot fit, binary diffs, and unavailable patches are explicitly skipped and remain pending. Later runs continue pending files against the full PR diff, rather than an empty same-commit diff. Increase the context bound or use architectural mode for oversized patches. Known-finding checks receive current pinned source excerpts; insufficient evidence leaves them unverified.

```sh
kasanome --agent codex --base main --mode quick
kasanome --agent opencode --opencode-standalone --model "provider/model" --base main --mode quick
# A one-call cap can save new findings as unverified; rerun to verify them.
kasanome --agent codex --base main --mode quick --max-calls 1
```

The context bound applies to supplied Git context, not the entire model prompt or its token usage. Quick prompts instruct the harness to use no tools or repository exploration; this is an instruction, not an enforced tool-read limit. Harness system/tool definitions still add overhead. The reduction in sessions and exploratory rounds should reduce usage, but no fixed token saving is guaranteed. No new paid API integration is used.

**Larger first reviews still build a baseline map.** The default hard cap is four agent launches including retries: typically one map, two layer reviews, and shared verification. Subsequent runs reuse the map, select affected areas, and continue pending coverage. Scope collection and dashboard rendering use no model calls.

Defaults favor low usage: concurrency one, no automatic retries, no PR guides, at most three finding checks per quick run or twelve per architectural run. Known findings in unaffected areas are retained without rechecking. Additional findings stay unverified for a later run. These settings reduce repeated work; **four calls can still consume substantial tokens** if the repository or agent tool reads are large.

```sh
# Two-call cap: map first, then continue bounded reviews on subsequent runs.
kasanome --agent codex --base main --mode incremental --max-calls 2
# Broader architectural audit, still bounded by an explicit call cap.
kasanome --agent codex --base main --mode full --max-calls 20
# Optional expensive extras; they share the same launch budget.
kasanome --agent codex --base main --guides --max-calls 12
```

`--max-calls` limits launched CLI processes, including failed attempts and `--retries`. Cached answers consume no calls. It is not a hard token limit: the supported CLIs do not provide a uniform per-call token ceiling, so `--token-budget` is rejected instead of claiming enforcement. Codex and OpenCode JSON events and Claude JSON results provide reported token totals when available; unsupported or failed accounting is marked unavailable, with a partial total retained. Tokens are provider-reported usage, not subscription quota percentages or actual charges. No API billing is introduced.

OpenCode reports cumulative usage across every model step in a session. Even a tiny diff can require several steps, each carrying harness instructions, tool definitions, and prior tool results. The dashboard separates new input, cached reads/writes, output, and reasoning. These are provider-reported categories, not unique source-code tokens. A three-session review can therefore report many more tokens than the changed file contains. Session exports can report additional usage beyond the visible event stream; historical reports retain their original partial totals.

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

## Dashboard and source snapshots

Findings open beside their cited code. The code workspace supports unified diffs and full files, path search, layer filters, evidence details, and previous/next findings. The source snapshot records the reviewed head commit and is embedded in the report, so opening the HTML needs no web server.

Source excerpts anchor comments when a unique exact match exists. Ambiguous or missing locations remain explicitly unresolved rather than being placed on an unrelated line. Binary files and oversized source/diffs have unavailable messages; source embedding is capped at 300 KB per file with a bounded total snapshot size.

Browser reading progress and raise/dismiss/later triage live in localStorage, separately from verified finding resolution. If storage is unavailable, progress lasts for the session.

Older reports can be rebuilt with `--render`. Reports without pinned commit IDs resolve their stored refs on the first rebuild; embedded snapshots are preserved on later rebuilds.

## Installation and updates

Install directly from GitHub:

```sh
npm install --global --install-links git+https://github.com/USERSATOSHI/kasanome.git
```

Repeat that command to update a Git install. For a cloned install, pull the source and reinstall:

```sh
git pull --ff-only
npm install --global --install-links .
kasanome install --target all --force
```

`--force` updates bundled skill files and preserves unrelated files. Each skill contains its own runtime, so reinstall skills after updating the CLI. Restart your agent session if the updated skill is not visible.

## Updating from structural-review

The CLI and skill are named `kasanome`, and reports default to `kasanome/`. Older report files can still be rendered:

```sh
kasanome --render structural-review/data.json --out structural-review
kasanome install --target all --force
```

Browser progress from older reports is used when no Kasanome progress exists. Custom-agent environment variables are `KASANOME_PROMPT_FILE`, `KASANOME_OUT_FILE`, and `KASANOME_SCHEMA_FILE`.

## Static scanners

```sh
kasanome review --base main --agent codex --scanners auto
kasanome review --pr 123 --agent codex --scanners gitleaks,semgrep,osv-scanner
kasanome scan --base main --scanners auto --json
kasanome review --base main --agent codex --sarif reports/codeql.sarif,reports/custom.sarif
```

Review scanning is opt-in (`--scanners none` by default). The scanner-only `scan` command defaults to `auto` and makes no model calls. Select comma-separated names; `auto` can be combined with explicit names, such as `auto,semgrep,osv-scanner`. `auto` selects the four local adapters below, rather than enabling network scanners implicitly.

| Name                                                                | Checks                           | Scope                                                                | Network                                                           |
| ------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`gitleaks`](https://github.com/gitleaks/gitleaks#installing)       | Potential secrets                | Pinned head files; reports filtered to changed lines                 | No network required                                               |
| [`shellcheck`](https://github.com/koalaman/shellcheck#installing)   | Shell mistakes                   | Changed `.sh`, `.bash`, `.ksh` files                                 | No network required                                               |
| [`hadolint`](https://github.com/hadolint/hadolint#install)          | Dockerfile problems              | Changed Dockerfiles                                                  | No network required                                               |
| [`actionlint`](https://github.com/rhysd/actionlint#install)         | GitHub Actions workflows         | Changed workflow YAML; nested ShellCheck/Pyflakes disabled           | No network required                                               |
| [`semgrep`](https://semgrep.dev/docs/getting-started)               | Security patterns                | Pinned head; findings filtered to changed lines                      | Downloads `p/security-audit`; metrics and version checks disabled |
| [`osv-scanner`](https://google.github.io/osv-scanner/installation/) | Known dependency vulnerabilities | All supported lockfiles in the pinned head, including unchanged ones | Queries vulnerability services; requires v2 CLI                   |

Install the binaries on `PATH` using their official installation instructions. No scanner account or key is added by Kasanome. It does not download binaries, execute project build scripts, or install project dependencies. Scanner executables themselves run with your user's permissions. Repository scanner configuration can affect their results.

`--offline` skips Semgrep and OSV-Scanner, even if Semgrep uses a local rules file. Those skips are visible and make selected scanner coverage partial. It does not make the model backend offline. Use `--semgrep-config <ruleset-or-path>` to choose other rules explicitly; the path is interpreted from the scanner snapshot, or may be absolute. It does not affect `auto` selection.

Each scanner has a 120-second timeout; change it with `--scanner-timeout <seconds>`. Failure, timeout, invalid output, unavailable binaries, and unsupported locations remain visible. Applicable selected scanners that do not finish make overall review coverage partial. Tools with no matching files are reported as not applicable. A snapshot is limited to 10,000 regular files, 16 MB per blob and 128 MB total; exceeding a limit stops scanning. Symlinks and submodules are omitted and make coverage partial. Files are copied directly from Git blobs without checkout hooks or filters; uncommitted files and Git LFS object contents are not materialized.

Candidates overlap added/modified lines in the full base-to-head diff, or the lines next to a pure deletion. Outside-change results are advisories, excluded from model verification and active findings. Dependency advisories often cite unchanged lockfile lines and therefore remain advisories, even when another part of the lockfile changed. Scanner-only results are always unchecked; a successful scan is not a verified code review.

During a review, scanner candidates share the existing finding-check and agent-call limits. Excess candidates remain unverified for later runs. Verification involving scanner candidates may read pinned source and callers even in quick mode; it is not restricted to quick mode's supplied-context character limit. A scan of an unchanged snapshot with identical normalized results does not trigger model rechecks of already checked findings. Scanner absence on a later run is not proof of a fix; known findings require verification to resolve.

`--sarif <paths>` imports SARIF 2.1.0 from other tools without running their commands. Paths are comma-separated and relative to the reviewed repository, or absolute. Reports must use repository-relative artifact paths or absolute paths inside that repository. Standard artifact indexes and URI base IDs are supported. Accepted suppressions are honored. Results without usable source locations are counted as omissions. External reports may be stale: imported findings are candidates, and the verifier checks the pinned source before confirming them.

Review reports add scanner status and outside-change advisories to the dashboard and JSON summary. `<out>/scanners.json` and `<out>/scanners.sarif` contain normalized **unchecked** scanner results, including advisories. Their SARIF properties identify verification status, changed-line membership and reviewed commits. `kasanome scan` defaults to `kasanome/scan/`, separate from review state; it exits 0 when selected scanners finish and 2 when coverage is partial, regardless of candidate count. Ordinary review exit behavior remains unchanged; inspect `coverage.scannersIncomplete` and verification status in JSON automation.

Gitleaks runs with full redaction, and its candidate message/excerpt is replaced with a location and rule. Raw scanner stdout/stderr is not saved. This is not complete source redaction: ordinary review dashboards and caches can include the original source, and the model verifier may read it. Treat saved reports as source code.
