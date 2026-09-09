# Built-in training bootstrap failure — 2026-09-09

## Result

The first built-in train-first attempt did not start a container or training process.
RunPod acquired pod `iu3uzm2swvup3l`, named
`figment-bakeoff-20260909-183826-e7284e`, on machine host/id
`wx25nhzztsdt` at 18:38:26 UTC. The retained provider observations show image layers
remaining in `Downloading`, followed by repeated `failed to pull image: unexpected EOF`
and `error creating container: failed to pull image: unexpected EOF` messages from
19:21:59 through 19:23:36 UTC. The strongest source is
`MAIN/_private/figment-builtin-training-observations-20260909-v1/192343-020732.json`;
the earlier files in that directory preserve the preceding layer-download state.

Root used the journal-bound recovery command after reviewing its exact ID, name,
manifest, and start-time checks. Absence was verified at 19:26:44 UTC. The original
child then exited normally and finalized
`MAIN/_private/figment-builtin-train-first-20260909-v1/train/runs/out/creator-001-tensor-train-first/run.json`
at 19:26:47 UTC. It records `termination_verified: true`, no uploads, no jobs, and no
artifacts. Its final `pod ... disappeared before becoming ready` error is the expected
result of the deliberate recovery teardown, not the underlying bootstrap diagnosis.
No dataset or model bytes reached the container because no container started.

The attempt consumed a ceiling-rate estimate of **$1.047831**. The reconciled arc is
**$39.826760 / $50**, and the September 9 daily estimate is **$2.026375**. The final
receipt, recovery journal, observations, and launcher logs remain the evidence; they
must not be overwritten or reused for another run.

## Comparison and hypothesis

The manifest used
`runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04`. The historical
successful Figment train at
`C:/Users/danie/kb-worktrees/figment/orgs/figment/runs/c001-tf2/train/runs/creator-001-tensor-train-first.yaml`
used the same image and bootstrap prerequisites; its adjacent completed receipt is
`out/creator-001-tensor-train-first/run.json`. That receipt proves this exact image and
recipe completed once, although it does not record a separate container-readiness
duration and does not prove current registry or host-cache conditions.

The next bounded hypothesis is a truncated registry/image-layer transfer or host-local
cache condition on `wx25nhzztsdt`, rather than a dataset, training configuration, or
model-download failure. The evidence supports excluding that host for one otherwise
unchanged attempt. It does not yet support changing the container image, model pins,
dataset, trainer settings, readiness cap, or budget.

## Supported fresh attempt

The harness supports two host-avoidance inputs. It unions the manifest's
`avoid_machine_hosts` / `avoid_machine_ids` with the 24-hour session cache at
`%LOCALAPPDATA%/kb-figment-pod/bad_hosts.json`
(`pod/runpod_run.py:757-817`, `:1585-1600`, `:3730-3734`). Placement is inspected before
bootstrap and an avoided host is terminated and verified absent (`:3864-3941`). The
current session file contains only an expired September 5 entry and does not contain
`wx25nhzztsdt`. This failure was observed in provider system logs and ended as a
missing-pod error after recovery, so it did not enter the harness's automatic
`BootstrapFailed` bad-host learning path (`:4239-4299`).

For a reproducible fresh plan, use the existing static manifest route: in a separately
reviewed pins-only change, add `wx25nhzztsdt` to the train stage's
`avoid_machine_hosts` in `orgs/figment/pipeline/train/tensor-pins.yaml`. `_pod_base()`
copies that stage field into newly generated manifests (`figment_train.py:319-340`).
Keep `max_placement_attempts: 1`; if RunPod selects the excluded host again, the harness
will terminate it and stop rather than create an unreviewed retry. There is no current
`train-first` CLI flag for a host override, and neither the failed plan nor its manifest
should be hand-edited.

After the pending Codex grading integration is reviewed and the pins change is accepted,
generate a new plan in a fresh directory with the same accepted dataset and canonical
ledger:

```powershell
& 'C:\Users\danie\AppData\Local\Programs\Python\Python313\python.exe' -I -B `
  'C:\Users\danie\kb\_private\codex-worktrees\figment-studio-20260908\orgs\figment\pipeline\figment_train.py' `
  train-first --creator creator-001 `
  --dataset-dir 'C:\Users\danie\kb\_private\figment-builtin-dataset-20260909-v1\dataset-v1' `
  --out 'C:\Users\danie\kb\_private\figment-builtin-train-first-20260909-v2' `
  --ledger-dir 'C:\Users\danie\kb\_private\codex-worktrees\figment-analysis-ops-2026-09-07\ledgers\cost'
```

Do not use `--skip-pin-verify`. Review the new plan, manifest, exact host exclusion,
fresh output paths, hashes, current ledger headroom, and a zero-pod inventory before any
new launcher is prepared. This document does not authorize or execute a new plan, pod,
retry, or provider call.
