# v1 premerge gate — runbook

Two artifacts back this gate:
- `.github/workflows/kb-platform-acceptance.yml` — runs on every PR (`pull_request` +
  `workflow_dispatch`) on `ubuntu-latest`, cancel-in-progress per ref.
- `orgs/kb-ops/workflows/v1-acceptance-demo.md` — the parameterized acceptance-demo workflow
  definition (two parallel researchers, a dependent writer, a bounded judge cycle, a human
  completion gate). Compiled and checked by
  `dashboard/server/workflows/compile.v1AcceptanceDemo.test.ts`.

## Pins

- Node **24.18.0** (matches `dashboard/package.json` `engines.node`), npm cache keyed on
  `dashboard/package-lock.json`.
- Python **3.12**.

## The five gate commands (CI, one per step, in this order)

Run from repo root unless noted; `dashboard/` steps need `npm ci` in `dashboard/` first.

1. `python -m pytest -q --ignore=atlas` (repo root — atlas's voice-stack deps don't install on
   Linux)
2. `npm run typecheck` (in `dashboard/`)
3. `npm run build` (in `dashboard/`)
4. `npm run build:pty-broker` (in `dashboard/` — must run on Linux; the archive packer refuses a
   broker built on a non-Linux host)
5. `npm test -- server/control server/placement server/api/v1 server/pty server/schema server/entities server/workflows server/index.test.ts src` (in `dashboard/`)

No `npm prune` anywhere in the gate: pruning devDependencies before step 5 would remove
`typescript`/`vitest`, which the build and test steps still need.

## Windows-side equivalents (PowerShell, this machine)

Run the same five commands locally before pushing, plus the full suite once:

```powershell
python -m pytest -q --ignore=atlas
cd dashboard
npm run typecheck
npm run build
npm run build:pty-broker
npm test                                                          # full suite
npm test -- server/control server/placement server/api/v1 server/pty server/schema server/entities server/workflows server/index.test.ts src   # the CI-gated slice
```

The full `npm test` is the broader local check; the focused `server/control server/placement
server/api/v1 server/pty` run is what the Linux CI gate actually enforces on every PR — the two
can diverge (e.g. a Windows-only or slow suite passing locally but not gated), so treat the
focused run, not the full one, as the merge-blocking signal.

## "Pinned to candidate SHA"

`kb-platform-acceptance.yml` checks out `${{ github.event.pull_request.head.sha }}` (falling back
to `github.sha` for `workflow_dispatch`), not a merge of the PR into its base branch. The gate
therefore tests the exact commit that will be merged — a later push to the base branch cannot
silently change what was validated, and a green run names one specific SHA as having passed.
Before merging, confirm the PR's current head SHA matches the SHA the last green gate run checked
out (`gh pr view --json headRefOid` vs. the run's checkout step) rather than trusting a run that
may have validated a now-stale tip.
