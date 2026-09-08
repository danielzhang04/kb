# Existing 1,250-step tester preparation

## Scope

Prepared only; no live pod, recovery action, or training job was launched.  This
is the first diagnostic ladder for the existing five `creator001krea2`
checkpoints.  It tests corrected trigger invocation and preserves raw outputs;
it is not a held-out acceptance study and does not select a checkpoint.

The isolated attempt tree is:

`C:/Users/danie/kb/_private/figment-live-tester-20260908`

Its live output path is deliberately absent:

`C:/Users/danie/kb/_private/figment-live-tester-20260908/live-output`

The completed local-only verification receipt is under `dry-run-output/` and
must never be used for a live run.

## Manifest and inputs

Prepared manifest:

`C:/Users/danie/kb/_private/figment-live-tester-20260908/creator-001-existing1250-tester.yaml`

SHA-256: `35f23c56b249bca2b93d0719da6d87f6eb4e96f709d4aecb7a2c7968e6ab0e91`

It retains the historical, approved Krea-2 model pins, custom node pin,
five-cell workflow, seed `1595`, `max_placement_attempts: 1`, 115-minute
bound, and $2.50 CLI ceiling.  No model or node was added.  The only local
path changes are the upload glob `checkpoints/*.safetensors` and the relative
support script `support/start-comfy-lorapath.sh.template`.

The runner rejects absolute upload paths and resolved paths outside the
manifest directory.  The five required input files are therefore NTFS hard
links below the isolated attempt tree, rather than copies.  They reference the
exact source files in
`C:/Users/danie/kb-worktrees/figment/orgs/figment/runs/c001-tf2/train/runs/out/creator-001-tensor-train-first`;
there is no additional 1.1 GB checkpoint copy.

| Cell | Input file | Bytes | SHA-256 | Expected raw output |
| --- | --- | ---: | --- | --- |
| 250 | `creator001krea2_000000250.safetensors` | 228587792 | `f07c7e4d01637c20992997ca1ab745aaed7ed504e815ca11452c23c9c48e18f1` | `c001-tensor-tester-000000250.png` |
| 500 | `creator001krea2_000000500.safetensors` | 228587792 | `c9e0c41960fbffea027772bb09555ad4ea636f699e16c68316d772d53f2ebb8c` | `c001-tensor-tester-000000500.png` |
| 750 | `creator001krea2_000000750.safetensors` | 228587792 | `1c37a1fd02b15fe687c07aefc598b4cdd7a00a1372c3838adde7c3156d4038ee` | `c001-tensor-tester-000000750.png` |
| 1000 | `creator001krea2_000001000.safetensors` | 228587800 | `b33301b32121bee5711b9b20fb1bcb72851da03e02c4e9d75fc18cea9b1d6b68` | `c001-tensor-tester-000001000.png` |
| 1250 | `creator001krea2.safetensors` | 228587800 | `e1da52fbec917794d5dfccc99dbd7bdc48921efd955e9f4be6da065df54596b0` | `c001-tensor-tester-final.png` |

All five effective workflows have the same fixed seed (`1595`) and their
effective positive prompt includes `creator001krea2`.

The copied startup support script has SHA-256
`f4e742ed7bd864d545148fac4c796eed30e2ec1290eb5cbdab8cd9eb827927ca`,
matching the source script exactly.

## Bounded cost position

The verified historical shard set totals $35.690251.  The manifest estimate is
$2.491667 at 115 minutes, below the $2.50 CLI ceiling.  The capped arc total is
$38.190251, below the approved $50 cap.  The configured upload plan is five
files, 1,142,938,976 bytes total, chunked into 14 parts per file.

## Local verification

Using `C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe`:

- Initial preparation recovery-harness suite: `7 passed`; this predates the
  recovery review fixes. Final local builder checks are 24 focused plus 287 pod
  tests; independent acceptance remains pending after two failed reviews.
- Manifest preflight accepted all five hard-linked uploads and its relative
  startup script.
- The no-network dry run completed five simulated uploads and five one-image
  jobs.  Its `run.json` records `dry_run: true`, five expected raw filenames,
  one placement attempt, zero estimated cost, a recovery journal, and
  `termination_verified: true`.
- The recovery journal in that dry-run directory records terminal state with
  `absence_verified: true`.

During preparation, passing the historical ledger directory caused the
initial runner to append a zero-cost `dry-run-pod` row. That exact untracked
59-byte file was removed immediately; no coordination ledger change remains.
The review fixes now isolate all dry-run writes under the output's
`dry-run-ledger` even when an explicit shared ledger is supplied. The live command
below intentionally supplies the verified ledger
directory because a live attempt must ledger its real lifecycle.

After review fixes, each placement retains its own
`recovery-<generated-pod-name>.json`. The initial preparation dry run predates
that filename change. Its old journal is historical test evidence; live recovery
must use the exact filename reported by the new run, not assume `recovery.json`.

## Runnable live command — do not launch before recovery review

```powershell
& 'C:\Users\danie\AppData\Local\Programs\Python\Python313\python.exe' `
  'C:\Users\danie\kb\_private\codex-worktrees\figment-foundation-20260908\orgs\figment\pipeline\pod\runpod_run.py' run `
  --manifest 'C:\Users\danie\kb\_private\figment-live-tester-20260908\creator-001-existing1250-tester.yaml' `
  --out 'C:\Users\danie\kb\_private\figment-live-tester-20260908\live-output' `
  --max-usd 2.50 --max-minutes 115 `
  --ledger-dir 'C:\Users\danie\kb\_private\codex-worktrees\figment-analysis-ops-2026-09-07\ledgers\cost' `
  --arc-cap-usd 50.00 --arc-ledger-glob 'figment-*.tsv'
```

Immediately before a reviewed launch, rerun the preamble and recheck the daily
and whole-arc guards against the current authoritative ledger.  Launch remains
blocked on the parent-reviewed recovery build.  Do not reuse `dry-run-output/`
or any failed live output directory.

This standalone run is a diagnostic comparison of the existing ladder. It does
not write the driver's completed tester state or bind checkpoint input hashes
into its review subject. A checkpoint cannot be promoted from this diagnostic
alone under the new lineage contract; a driver-bound tester run is required.
