---
name: kasanome
description: Review a large git diff or stacked pull requests by architectural layers and boundaries, verify findings, and generate a consistent HTML review dashboard. Use for structural or whole-stack reviews.
---

Run the bundled CLI from the target git repository. It maps architectural layers, launches agent CLI reviewers and skeptics, attributes findings to PRs, and writes a self-contained dashboard. This consumes usage from the selected CLI's authenticated account.

Use `scripts/run.mjs` relative to this skill folder, with an absolute path when running from the target repo:

```sh
node /absolute/path/to/this/skill/scripts/run.mjs --base main --head HEAD
```

The installer selects Claude for the Claude skill and Codex for the Codex skill. An explicit `--agent claude|codex|opencode|custom` overrides it. For a source checkout without installation, select `--agent` explicitly.

- Resolve the user's intended repo, base, head, and focus from their request and git state. Ask only when the range is ambiguous. Use `--repo /path/to/repo` if needed.
- Run `--help` for options. Respect requested models and limits. Auto mode uses quick review for up to five changed files and 200 added/deleted lines; larger scopes review at most six layers and three boundaries; report skipped coverage. Use `--max-seams` to expand coverage when requested.
- The selected agent CLI must be installed and authenticated. `gh` is optional for PR attribution; use `--prs none` for diff-only review. If a required CLI/login is unavailable, explain the prerequisite; do not switch to API billing or another provider silently.
- Let the command finish using the environment's background execution facilities and share progress. Auto mode is the default. Quick mode skips mapping and supplies bounded Git context, including on the first run: normally one reviewer call plus verification only for findings. `--mode quick` forces it; `--mode incremental` forces architectural mapping with reuse. Both preserve findings and pending coverage. Quick context defaults to 16000 characters and five complete patches; report skipped files and context limitations. Larger first runs build a map within a four-call cap; subsequent runs reuse it and continue pending coverage. Repeating an unchanged completed review can use zero agent calls. Use `--max-calls` for a hard launch cap; do not claim this enforces tokens or subscription quota. Use `--mode full --fresh` only when a fresh architectural audit is wanted.
- Read the generated `data.json`, including `failed`, `coverage`, `usage`, and unverified findings, and report findings, coverage gaps, and the path to `index.html`. Its Code review view opens findings inline against their cited source lines; file links open the embedded diff/full-file workspace. Automated findings still require human triage. Do not equate an empty findings list with approval.
- Reviews do not authorize fixes, commits, pushes, or GitHub comments. Use `--publish <PR-number>` only when the user requests publication; it updates one marked summary comment. `--guides` opts in to attribution and guide calls. Keep these as separate user-directed work.

Outputs default to `kasanome/index.html` and `kasanome/data.json` in the target repo. The CLI adds the output directory to git's local exclude file. Render existing results without agent calls with `--render path/to/data.json` from a git repo. The layout is fixed; inferred layers and review content vary by project.
