# Contributing

Use Bun 1.4.0 for dependency installation, matching CI and the committed lockfile. The installed CLI runs on Node.js 18+ and has no runtime package dependencies.

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

## Install a source checkout

```sh
git clone https://github.com/USERSATOSHI/kasanome.git
cd kasanome
bun install
bun run build
npm install --global --install-links .
```

To run without a global install, use `node bin/kasanome.mjs review --base main --agent codex`. The skill launcher uses the same CLI dispatch. Keep user-facing examples aligned with `kasanome --help` and `kasanome --help-all`.
