# 🥁 action-env-sync-build — Sync environment branches

[![CI][ci-badge]][ci-url]
[![License: MIT][license-badge]][license-url]
[![GitHub Marketplace][marketplace-badge]][marketplace-url]

> **GitHub Action** to fan a source branch out into long-lived environment branches — merge if clean, open a PR if it conflicts.

When a PR merges to `main`, this keeps every environment branch (e.g. `staging`, `development`) in sync. Targets are synced independently: one target's conflict never blocks another, and a conflict keeps the run green — the PR is the signal. Branch names are arbitrary (`main`/`staging`/`development`, `master`/`stg`/`dev`, whatever your repo uses). Everything happens through the GitHub API — no checkout required.

## Contents

- [Usage](#usage)
- [Inputs](#inputs)
- [Outputs](#outputs)
- [Permissions](#permissions)
- [Architecture](#architecture)
- [Behavior](#behavior)
- [How it works](#how-it-works)
- [Notes](#notes)
- [License](#license)

## Usage

```yaml
name: Sync environments
on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-24.04
    steps:
      - uses: heronlabs/action-env-sync-build@v4
        with:
          target-branches: |
            staging
            development
          github-token: ${{ secrets.SYNC_TOKEN }}
```

## Inputs

| Name | Description | Required | Default |
|---|---|---|---|
| `source-branch` | Branch to sync from. | No | `${{ github.ref_name }}` |
| `target-branches` | Newline- or comma-separated list of branches to sync to (e.g. `staging`, `development`). | Yes | — |
| `github-token` | Token with `contents: write` (merge into targets) and `pull-requests: write` (open PRs). | Yes | — |
| `merge-message` | Merge-commit subject template; `{source}` and `{target}` are substituted. | No | `Merge {source} into {target}` |

## Outputs

| Name | Description |
|---|---|
| `synced` | Targets cleanly merged (newline list). |
| `conflicts` | Targets that received a resolution PR (newline list). |
| `pr-urls` | URLs of opened/reused PRs (newline list). |

## Permissions

```yaml
permissions:
  contents: write
  pull-requests: write
```

## Architecture

Node.js 20 GitHub Action bundled with [@vercel/ncc](https://github.com/vercel/ncc).

```
├── action.yml                    # Action definition (node20 runtime)
├── src/
│   ├── action.js                 # Branch syncing logic (merges API, conflict PRs)
│   └── index.js                  # ncc entry point
├── dist/
│   └── index.js                  # Committed ncc bundle — what the runner executes
├── tests/
│   └── unit/
│       └── action.test.js        # Vitest unit tests (mocked Octokit)
└── version.txt                   # Current version
```

## Behavior

| Situation | Outcome |
|---|---|
| Target merges cleanly | Merge commit created on target via the GitHub merges API; run green. |
| Target conflicts | Resolution PR opened from a `merge/{source}-into-{target}` branch (or reused if already open); run green. |
| Target already contains source | No-op. |
| Target branch doesn't exist | Skipped with a warning; run green. |
| `source` listed among targets | Skipped. |
| Missing/invalid `target-branches`, unresolvable source, auth failure | Run fails (red). |

## How it works

1. **Validate inputs** — `target-branches` must be non-empty; `source-branch` defaults to `github.ref_name` and must exist.
2. **Sync each target** — for every target branch, the source is merged into it via `POST /repos/{owner}/{repo}/merges`. `204` means the target already contains the source (no-op); `409` means conflict.
3. **Conflict → PR** — on conflict, a `merge/{source}-into-{target}` branch is created at the source head (or refreshed with the latest source when it already exists — in-progress resolutions are never force-pushed away), and a PR into the target is opened. An already-open PR for the pair is reused, never duplicated.

Every commit merged into the source ends up on each target or is represented by an open conflict PR — a target behind the source with no open PR never persists.

## Notes

- No `actions/checkout` needed — the action talks to the GitHub API only.
- The default `GITHUB_TOKEN` is usually blocked by branch protection and won't trigger downstream workflows on the target branches. Use a PAT or GitHub App token allowed to update the protected targets.
- Conflicts degrade to a resolution PR and keep the run green; only auth/plumbing errors (bad inputs, unresolvable source) fail it.

## License

MIT

[ci-badge]: https://github.com/heronlabs/action-env-sync-build/actions/workflows/continuous-integration.yml/badge.svg
[ci-url]: https://github.com/heronlabs/action-env-sync-build/actions/workflows/continuous-integration.yml
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg
[license-url]: ./LICENSE
[marketplace-badge]: https://img.shields.io/badge/GitHub-Marketplace-green.svg
[marketplace-url]: https://github.com/marketplace/actions/action-env-sync-build
