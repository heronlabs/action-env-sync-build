# 🥁 action-env-sync-build — Synchronize all branches/environments.

[![CI](https://github.com/heronlabs/action-env-sync-build/actions/workflows/continuous-integration.yml/badge.svg)](https://github.com/heronlabs/action-env-sync-build/actions/workflows/continuous-integration.yml)

> Fan a source branch out into long-lived environment branches — push if clean, open a PR if it conflicts.

When a PR merges to `main`, this keeps every environment branch (e.g. `staging`, `development`) in sync. Targets are synced independently: one target's conflict never blocks another, and a conflict keeps the run green — the PR is the signal. Branch names are arbitrary (`main`/`staging`/`development`, `master`/`stg`/`dev`, whatever your repo uses).

## Contents

- [Usage](#usage)
- [Inputs](#inputs)
- [Outputs](#outputs)
- [Permissions](#permissions)
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
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          token: ${{ secrets.SYNC_TOKEN }}

      - uses: heronlabs/action-env-sync-build@v3
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
| `github-token` | Token with `contents: write` (push to targets) and `pull-requests: write` (open PRs). Pass the same token to `actions/checkout`. | Yes | — |
| `merge-message` | Merge-commit subject template; `{source}` and `{target}` are substituted. | No | `Merge {source} into {target}` |

## Outputs

| Name | Description |
|---|---|
| `synced` | Targets cleanly merged and pushed (newline list). |
| `conflicts` | Targets that received a resolution PR (newline list). |
| `pr-urls` | URLs of opened/updated PRs (newline list). |

## Permissions

```yaml
permissions:
  contents: write
  pull-requests: write
```

## Behavior

| Situation | Outcome |
|---|---|
| Target merges cleanly | Merge commit pushed to target; run green. |
| Target conflicts | Resolution PR opened (or reused if already open); run green. |
| Push to target refused | Retried once, then a resolution PR is opened; run green. |
| Target already contains source | No-op. |
| Target branch doesn't exist | Skipped, noted in the job summary; run green. |
| `source` listed among targets | Skipped. |
| Clean push after a prior conflict PR | The now-stale PR is closed automatically. |
| Missing/invalid `target-branches`, unresolvable source, auth failure | Run fails (red). |

## How it works

Composite action with a single shell script (`core/sync-branches.sh`):

1. **Validate inputs** — `target-branches` must be non-empty; `source-branch` defaults to `github.ref_name`.
2. **Sync each target** — for every target branch, the script merges the source into it. A clean merge is pushed directly; a conflict opens (or reuses) a resolution PR.
3. **Conflict recovery** — when a prior conflict PR exists and the merge is now clean, the stale PR is closed automatically after the push.

## Notes

- Requires `fetch-depth: 0` on `actions/checkout`; a shallow clone fails fast with a clear error.
- The default `GITHUB_TOKEN` is usually blocked by branch protection and won't trigger downstream workflows. Use a PAT or GitHub App token allowed to push to the protected targets, and pass it to **both** `actions/checkout` (`token:`) and this action (`github-token:`): checkout's token authenticates the `git push`, the action's token opens PRs.
- Conflicts and refused pushes degrade to a resolution PR and keep the run green; only auth/plumbing errors (bad inputs, unresolvable source) fail it.

## License

MIT
