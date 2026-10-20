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
- Run `--help` for options. Respect requested models and limits. The default reviews at most six layers and three boundaries; report skipped coverage. Use `--max-seams` to expand coverage when requested.
- The selected agent CLI must be installed and authenticated. `gh` is optional for PR attribution; use `--prs none` for diff-only review. If a required CLI/login is unavailable, explain the prerequisite; do not switch to API billing or another provider silently.
- Let the command finish using the environment's background execution facilities and share progress. Repeating the same command resumes cached work; use `--fresh` only when a new review is wanted.
- Read the generated `data.json`, including `failed`, and report findings, coverage gaps, and the path to `index.html`. Its Code review view opens findings inline against their cited source lines; file links open the embedded diff/full-file workspace. Automated findings still require human triage. Do not equate an empty findings list with approval.
- Reviews do not authorize fixes, commits, pushes, or GitHub comments. Keep those as separate user-directed work.

Outputs default to `kasanome/index.html` and `kasanome/data.json` in the target repo. The CLI adds the output directory to git's local exclude file. Render existing results without agent calls with `--render path/to/data.json` from a git repo. The layout is fixed; inferred layers and review content vary by project.
