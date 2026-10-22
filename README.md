# Kasanome

**AI code review that follows your changes.**

Review a branch or GitHub pull request with your existing coding agent. Read findings beside the code, track what gets fixed, and continue the review as new commits arrive.

Kasanome works with **Claude Code, Codex, OpenCode, and custom agent CLIs**. It runs on your machine, uses the selected CLI's login, and produces a report you can open in any browser.

## Why Kasanome?

- **Match the review to the change.** Small diffs get a focused review. Larger changes are examined by architectural layer and boundary.
- **Keep the review history.** Findings retain their IDs and verification history as fixes arrive. Completed work can be reused on later runs.
- **Check the findings.** Duplicate findings are merged before a skeptical verification pass. Uncertain checks stay unverified.
- **Control usage.** Set a cap on agent launches and see reported token usage, cached context, and skipped coverage.
- **Review in context.** Browse diffs and source, inspect evidence, and triage findings in a self-contained HTML dashboard.

## Get started

You need **Node.js 18+**, **Git**, and one supported agent CLI installed and authenticated. Reviewing GitHub PRs also requires authenticated `gh` and Git access to the repository.

```sh
npm install --global --install-links git+https://github.com/USERSATOSHI/kasanome.git
```

Inside the repository you want to review:

```sh
git fetch origin
kasanome review --base origin/main --agent codex
```

`--base` is the existing branch your changes target. Replace `origin/main` if needed. Kasanome reviews committed code at `HEAD`; commit your changes before running a review.

When the review finishes, open **`kasanome/index.html`**. The dashboard includes the reviewed source, findings, usage, and coverage. No web server is needed.

## Review a GitHub PR

```sh
kasanome review --pr 123 --agent codex
```

Kasanome fetches the PR's base and head commits and reviews that snapshot. Your checked-out branch and local file changes stay in place. You can also pass a full GitHub PR URL.

The report stays local. To create or update one summary comment on the PR:

```sh
kasanome review --pr 123 --agent codex --publish 123
```

Publication is explicit. This updates Kasanome's summary comment, rather than submitting an approving review.

## Recheck after fixes

Rerun the same command when new commits arrive. Kasanome checks affected code, rechecks known findings, and continues pending coverage. An unchanged, completed review can use **zero agent calls**.

See the latest saved result at any time:

```sh
kasanome status
```

The status command shows open and unverified findings, coverage, usage, and the report path. It makes no model calls.

## Choose your agent and model

```sh
kasanome review --base origin/main --agent claude
kasanome review --base origin/main --agent codex
kasanome review --base origin/main --agent opencode
```

Pass a model ID supported by your chosen CLI:

```sh
kasanome review --base origin/main --agent opencode --model "provider/model"
```

Replace `provider/model` with an entry from your configured OpenCode model list. One model is used throughout each run. Claude is the default agent when `--agent` is omitted.

Kasanome adds no model API integration or billing account. Model requests and usage follow your selected CLI and provider.

## Choose how much to review

The default **auto** mode uses a focused quick review for diffs of at most **five files and 200 added/deleted lines**. Larger diffs use architectural layers with incremental reuse.

```sh
# Focus on the supplied diff and nearby code.
kasanome review --base main --agent codex --mode quick

# Use architectural layers and reuse previous work.
kasanome review --base main --agent codex --mode incremental

# Start a broader architectural pass with a larger call allowance.
kasanome review --base main --agent codex --mode full --max-calls 20
```

Quick mode usually uses one reviewer call, plus verification when findings need checking. Git supplies bounded diff context and related contract excerpts; no architecture mapping call is needed.

Architectural mode examines contracts, dependencies, and the boundaries between layers. Optional `--guides` adds PR attribution and reading guides.

Every report shows skipped coverage and incomplete verification. **Findings still need human judgment; an empty report is not approval.**

## Keep usage bounded

```sh
kasanome review --pr 123 --agent codex --max-calls 2
```

The default limit is **four agent launches per run**. Failed attempts and enabled retries count; cached answers do not. When work cannot fit, it stays pending for a later run.

A call limit is **not a token limit**. Agent instructions, tools, reasoning, and repeated cached context can add substantial usage. Kasanome reports available usage and marks incomplete accounting clearly. Quick mode also bounds supplied Git context; see the [usage reference](docs/usage.md) for those limits.

Reports and review history are saved locally in the Git-excluded `kasanome/` directory. They can contain source code. Model requests are handled by your selected provider, so local reports do not imply local inference.

## Use it from your coding agent

Install the bundled skills:

```sh
kasanome install --target all
```

Then invoke `/kasanome review main...HEAD` in Claude Code or `$kasanome review main...HEAD` in Codex. Each skill includes its own runtime. The chosen backend CLI still needs to be installed and authenticated.

## More

- Run `kasanome --help` for everyday commands, or `kasanome --help-all` for every option.
- Read the [usage reference](docs/usage.md) for configuration, custom agents, state, and troubleshooting.
- See [Contributing](CONTRIBUTING.md) to develop or install from a source checkout.

## License

[Apache License 2.0](LICENSE). Copyright 2026 USERSATOSHI. See [NOTICE](NOTICE).
