# Affected CI checks

Ordinary pull requests that change only `apps/website` or `apps/playground` use the
existing pnpm workspace filters. The selected application runs its build, strict
types, unit tests, and browser tests. Both applications still build their shared
package prerequisites; repository formatting, zero-warning lint, spelling,
unused-code checks, selector regressions, and the production audit always run.

Authentication packages, package manifests, shared configuration, unknown paths,
and uncertain Git history retain the complete `pnpm verify` gate. Release heads,
pushes, and manual workflows also run the complete gate and Node compatibility
matrix. Package publication continues to run full verification. No authentication
consumer or production migration is part of this CI change.

The comparison uses the pull request's actual base, its merge base, and committed,
staged, unstaged, and untracked changes. Deleted files and both sides of renames
are included. Git environment overrides inherited from hooks are removed during
comparison. The runner supports both native pnpm executables and JavaScript
entrypoints.

```sh
pnpm run ci:plan --base origin/main
pnpm run ci:check --base origin/main
pnpm run ci:check --full
```

For recovery, switch the CI command back to `pnpm verify` and install the browser
unconditionally. Keep the dependency security fixes. The full local `pnpm check`
and pre-push gates are unchanged. `PORT` can isolate the website browser server
from another local checkout; its default remains 4393.

## Benchmark

Measured on 2026-10-25 using macOS arm64, Node 22.23.1, and pnpm 12.6.0. A temporary
Git fixture contained the proposed changes on release base `3ddaea4`, with
generated metadata normalized before measuring. One inert, formatted source
comment represented each application change. The planner selected exactly that
application. Every measured command passed.

| Change     | Full median | Affected median | Reduction |
| ---------- | ----------: | --------------: | --------: |
| Website    |     37.98 s |         25.08 s |     34.0% |
| Playground |     38.35 s |         18.22 s |     52.5% |

Each result is the median of two runs, alternating affected/full then full/affected
after a complete warmup. These are complete `ci:check` timings, including browser
tests and the live production audit, excluding dependency installation. There is
no task-result cache; compiler and filesystem caches were warm. This small local
sample does not predict hosted runner or installation time. Package changes retain
full validation and make no speedup claim.

The website samples were 37.94/38.02 s full and 24.98/25.17 s affected. Playground
samples were 38.23/38.47 s full and 18.14/18.29 s affected. The frozen lockfile,
packed npm consumer tests, full verification, and release metadata checks also
passed. Compatible Hono and Better Auth patches remove audit findings and a clean
npm consumer resolver loop; no public API migration is required.
