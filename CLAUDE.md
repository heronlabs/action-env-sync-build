<!-- supera:guardrails -->
## Working with this repo (managed by /init — edits between these markers are overwritten on re-init)

- **Edit, don't rewrite.** Change only the needed entry in a config/generated file (`package.json`, lockfiles, manifests, CI yaml); preserve the rest. Never regenerate a whole file to add one line.
- **No scope creep.** Build only what was asked; no speculative abstractions, layers, or options. Prefer the simplest working solution.
- **Ambiguous literals: flag, don't guess.** Config keys, IDs, and env names can be literal values, not mappings. State which reading you took.
- **Scope a change to where it belongs** — most changes are localized to one area; touch other repos only when the change genuinely cuts across, and then update the related repos too.
<!-- /supera:guardrails -->

## Stack
- **Runtime**: Node.js 20 (JavaScript GitHub Action), bundled with [@vercel/ncc](https://github.com/vercel/ncc) into `dist/index.js` (committed)
- **Package manager**: pnpm
- **Test framework**: [Vitest](https://vitest.dev/) — `tests/unit/action.test.js` (mocked Octokit via dependency injection)
- **Linter**: [ESLint](https://eslint.org/) flat config — `eslint.config.mjs`
- **Entry point**: `src/index.js` → `src/action.js` — bundled to `dist/index.js`, run by `action.yml` (`using: node20`)

## Commands
| Command | Description |
|---------|-------------|
| `pnpm build` | Bundle `src/` into `dist/index.js` with ncc (dist must be committed) |
| `pnpm lint:check` | Run ESLint |
| `pnpm test:unit` | Run Vitest unit tests |

## Key files
| File | Purpose |
|------|---------|
| `action.yml` | Action definition (inputs, outputs, node20 runtime) |
| `src/action.js` | Branch syncing logic (merges API, conflict PRs) |
| `src/index.js` | ncc entry point — calls `action()` |
| `dist/index.js` | ncc bundle — committed, executed by the runner |
| `tests/unit/action.test.js` | Vitest unit tests (injected fake core/github/Octokit) |
| `version.txt` | Current semver version |
| `CHANGELOG.md` | Release history |
