# figment — operator runbook

The single operator document for the `pipeline` command. Start at
`orgs/figment/pipeline/README.md` for the pipeline's own map (stages, the gate, pins,
spend guards); this file is the command sequence an operator actually runs, checked
against `figment_train.py --help` and each subcommand's own `--help` on 2026-09-15.

## Prerequisites

- **Python 3.13**, the same executable every command below uses:
  `C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe` (invoked as `py -3`
  below for brevity — substitute the real path if `py -3` does not resolve to it on your
  machine).
- **No environment variable is required for a live run.** The pod harness reads
  `HF_TOKEN` as a RunPod Secret reference only (never a local env var the harness would
  have to hold); the ledger directory resolves on its own (see "Budget rules" below).
- **Anchors already exist for creator-001**: `orgs/figment/personas/creator-001/{persona.yaml,
  training.yaml}` + `anchors/*.jpg` (the reference set of record, g01/g02/g07). A new
  creator needs the same three things under `orgs/figment/personas/<id>/` — no code change
  (`pipeline/README.md` "How to iterate").
- **`verify_pins`** HEADs every model pin in `tensor-pins.yaml` (plus the video model-pins
  document) live against Hugging Face and fails closed on any digest/revision mismatch.
  It runs automatically as a `plan`/`train-first`/`pipeline` preflight — pass
  `--skip-pin-verify` only offline/in tests, never on a real run. To check pins by hand
  first:

  ```powershell
  py -3 orgs/figment/pipeline/train/verify_pins.py
  ```

## The run root

`pipeline --out` defaults to `orgs/figment/runs/<creator>/<YYYYMMDD-HHMMSS>/` — an in-repo
directory (gitignored except its own README) — and this default should almost always be
left alone: the `video` stage requires its run root to sit inside the repository
(`_video_authority_root`; `gen` and `detail` plans are unaffected by this and may still be
built in a scratch directory, but then a `pipeline` run rooted there stops with
`stopped:video-out-of-tree` once it reaches `video`, after writing everything it honestly
can — the stills/detail deliverable). Pass `--out` yourself only to override this, and only
somewhere under the repo if you want `video` to complete.

## Entry path 1 — fresh `--out`, full chain

Walks anchor → dataset → smoke → train → tester → gen → detail → video in one resumable
command, halting at every gate:

```powershell
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001
```

This is exactly `pipeline --creator creator-001 --out orgs/figment/runs/creator-001/<stamp>/`.
The very first thing it does is a plan-time **budget preflight**: it sums every run the
call is about to plan against the arc cap remaining and prints a table before writing
`plan.json`. `spent`/`remaining` are read live off the resolved ledger at plan time (M3:
`configured_ledger_dir`'s precedence — explicit `--ledger-dir` → `KB_LEDGER_DIR` → the OPS
worktree if present → this repo's own, normally-empty `ledgers/cost/` as a last resort) --
never a fixed figure quoted here. The shape of the table (`REFUSED` when planned + spent
would exceed the arc cap, `over_daily_limit` flagging any single run over
`governance/budget.yaml`'s daily cap) looks like this:

```text
BUDGET PREFLIGHT
  arc:   spent=$<live> + planned=$<sum of this plan's ceilings> vs cap=$<ARC_CAP_USD> (remaining=$<live>) -- REFUSED or clears
  daily: limit=$10.00 (today spent=$<live>, not summed against the plan -- each run is checked against the limit alone)
  stage      manifest                                                 ceiling_usd  over_daily_limit
  anchor     <manifest>                                                      4.90
  dataset    <manifest>                                                     10.47
  smoke      <manifest>                                                      2.28
  train      <manifest>                                                     15.73  YES
  tester     <manifest>                                                      2.82
```

If the table says `REFUSED`, either shrink the plan (fewer stages, a smaller ladder) or
re-run with `--accept-budget`, which records the acceptance and these exact numbers in
`plan.json`'s `budget_preflight` block:

```powershell
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001 --accept-budget
```

`--accept-budget` only clears the plan-time preflight above; it never overrides
`enforce_daily_budget`/`enforce_arc_cap` at launch time (`pod/runpod_run.py`) — those still
refuse a live `run` that would actually breach a cap, `--accept-budget` or not. A run whose
own ceiling is bigger than the daily limit (`train` always is at the current 3000-step/DOP
profile — see `pipeline/README.md` "Spend guards") is flagged `YES` in the `over_daily_limit`
column; that is informational, not a second blocker — `train` still needs its own calendar
day with no other Figment spend, checked at plan/run time.

## Entry path 2 — `--import-checkpoints <dir>`, an operator-trained ladder

MANDATE.md's tier constraint puts the explicit-tier LoRA on operator-controlled hardware,
outside any pod-planned `train` run. `--import-checkpoints` skips anchor/dataset/smoke/train
outright and plans `tester` as the primary plan's only stage, against a directory of loose
`*.safetensors` files instead:

```powershell
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001 `
  --out orgs/figment/runs/creator-001/<stamp> `
  --import-checkpoints <dir-of-*.safetensors> `
  [--import-training-config <training.yaml>]
```

`<dir>` must hold every `<trigger>[_<9-digit step>].safetensors` file matching the persona's
own derived checkpoint stem (the un-suffixed file is the final step, i.e.
`training.steps` of the config in `--import-training-config`, default the persona's own
current `training.yaml`); any other extension, symlink/reparse point, file under 1 MiB,
duplicate step, or an empty ladder refuses. From here the walk (tester → gen → detail →
video) and every gate below are identical to entry path 1.

## Resuming a run

`pipeline` stores no cursor of its own — it derives "what's next" from `stage.json`/
`run.json` receipts and `grade/<stage>/{gate,approval-lineage,rejection-lineage}.json`
already on disk, so re-invoking it is always safe:

```powershell
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001 --plan <run-root>/plan.json
```

`--dry-run` previews the next action (which stage would plan, run, or grade) without
calling the harness or any local build/grade function. `--from-stage <stage>` resumes the
walk from a specific stage instead of the beginning, useful once earlier stages are already
settled.

## The gates, in order

Six of the eight stages are gradeable (`anchor`, `dataset`, `tester`, `gen`, `detail`,
`video`) — `smoke` and `train` are not; no per-cell ruling makes sense for either. At each
gradeable stage lacking a ruling, `pipeline` halts, prints exactly this, and exits 0 (this
is normal operation, not an error):

```text
GATE <stage>: operator review required.
  Board:            <run-root>/grade/<stage>/board.html
  Rulings template: <run-root>/grade/<stage>/rulings.template.json
  Fill every cell's seven axes plus decided_by/decided_at, then run:
    py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator creator-001 --stage <stage> --plan <run-root>/plan.json --rulings <path to your filled rulings>
  Re-invoke `pipeline --creator creator-001 --plan <run-root>/plan.json` afterward to resume without replanning or rerunning this stage.
GATE <stage>: awaiting ruling
```

The board is a full-resolution HTML page, one card per cell; the rulings template lists
every cell with the seven axes to fill in: `identity`, `realism`, `hands`, `lighting`
(quality) plus `adult_read`, `garment_integrity`, `real_person_resemblance` (safety),
each `keep`/`cull`, plus `decided_by` and `decided_at` (ISO-8601) once at the document
level. `apply-rulings` requires all of it — a metric that can't be computed FAILS, never
passes silently (`gate.yaml`'s own header).

**GATE tester** is the one gate with an extra argument: promoting a candidate requires the
explicitly kept, actually-produced checkpoint step:

```powershell
py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator creator-001 --stage tester `
  --plan <run-root>/plan.json --rulings <filled.json> --checkpoint-step 750
```

Omit `--checkpoint-step` only if every tester candidate was culled — that records the
rejection with no accepted checkpoint and stops the chain there; it does not manufacture a
keep. **Never default the chosen checkpoint to the final step** — the ladder exists
precisely so the tester's own ranking, not the step count, picks the checkpoint
(`train/TENSOR-TRAINING.md` "Step count: 3000, screened by the tester").

**GATE gen** and **GATE detail** ruling is ordinary keep/cull per cell — `detail` is always
graded against its own `gen` plan's kept stills, never an operator-supplied glob.

**GATE video** grades every 8th of the 81 native frames (1, 9, … 81 → 11 cells): the
`identity` axis on each sampled frame IS "the face holds here under motion." Ruling it
through the same seven-axis path lets the deliverable gain `deliverable/video/<candidate
id>.mp4` (the reel derivative).

## `--style-lora` A/B

`gen` accepts a style LoRA as a per-plan flag, not a persona fork (M3) — it overrides
`persona.training.style_lora` for one plan only, so the same persona can be planned both
ways for a prospective A/B:

```powershell
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage gen --out <plan-A>
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage gen --out <plan-B> `
  --style-lora inline-skin --style-lora-strength 0.8
```

`--style-lora` names a `pins.style_loras` key from `tensor-pins.yaml` (e.g. `inline-skin`,
`gokay-realism`); `--style-lora-strength` (0 < x <= 1.5) defaults to
`persona.training.style_lora_strength` (0.8) when omitted. Compare the two gen plans' `gen`
gate tables (`skin_realism`/`gloss` should improve, `same_person` must not fall) before
choosing one for `detail`/`video` — the bake-off already found one style LoRA
(`qwen-edit-skin`) actively hurt identity, so this comparison is load-bearing, not a
formality. `pipeline`'s own automatic `gen` planning also accepts `--style-lora`/
`--style-lora-strength` when it plans `gen` for you (after tester is ruled).

## The deliverable

Once `detail` is ruled, `pipeline` writes `<run-root>/deliverable/`:

- `stills/<image_id>.ext` — every kept `gen` still.
- `detail/<image_id>.ext` — every kept `detail` image.
- `manifest.json` — the `gen`/`detail` plan paths and hashes, the chosen checkpoint step
  and digest (and its `origin`: `"in-plan"` or `"imported"`), and per kept cell its gate row
  and ruling attribution (`decided_by`/`decided_at`/`why`/`gate_override`).

Once `video` is ruled the deliverable also gains `video/<candidate id>.mp4` (the reel
derivative) and a `video` block: the delivered file's sha256, the delivery profile, the
native↔derivative correspondence, the native movie's record, the extraction receipt, and
per graded frame its native-frame digest beside its gate row and ruling attribution.

The deliverable is idempotent: already bound to the current `detail` AND `video` approval
digests, it is left alone rather than rebuilt on every `pipeline` call.

## Budget rules

- **Arc cap: $60.00** for the creator-001 arc (`ARC_CAP_USD` in `figment_train.py`, raised
  from $50.00 by operator ruling 2026-09-15), checked against every `ledgers/cost/
  figment-*.tsv` row before a live `run`.
- **Daily cap: $10.00** in this branch's governance (`governance/budget.yaml`
  `daily_usd_limit`) — raise it, or split stages across days, when a single stage's ceiling
  (train, at the current 3000-step/DOP profile: $15.73) exceeds it on its own.
- **Every pod carries its own `--max-usd`/`--max-minutes`** (`max_placement_attempts: 1` —
  no automatic retry on a live run); `train`'s ceiling is derived from `steps × per-step
  rate`, never a fixed quoted figure — read it off your own `plan.json`.
- **Teardown is verified, not assumed**, on every exit path — success, failure, or error —
  via the RunPod API. If a harness invocation fails outside the normal flow, confirm the
  true pod state by hand before retrying:

  ```powershell
  py -3 orgs/figment/pipeline/pod/runpod_run.py status
  py -3 orgs/figment/pipeline/pod/runpod_run.py terminate --pod-id <id>
  ```

## Resume/recovery: a run marked "running"

If a run's `stage.json` still reads `"running"` when you invoke `pipeline`/`run` on the same
plan, the error names the exact recovery path:

> planned run `<key>` is still marked running. If another `pipeline`/`run` invocation on
> this same plan is still active, this is expected — wait for it to exit, then re-run
> `pipeline` (or `run`) on this plan again; the run may already have succeeded there and
> this call will pick that up. If no other invocation is active, a prior one was likely
> interrupted before recording completion or failure: confirm the true pod state with
> `runpod_run.py status`/`probe` (and terminate it if still live) before retrying. Never
> launch a second pod for the same manifest, and never start a fresh plan over this one for
> that alone.

Never hand-edit `plan.json`, `stage.json`, receipts, manifests, grading records, or copied
media to work around this — the fix is always patience-and-retry or a verified-absent pod,
never a file edit.

## Command-shape evidence

Every command above was checked against `figment_train.py --help`, `pipeline --help`,
`plan --help`, `run --help`, `grade --help`, `apply-rulings --help`,
`train/verify_pins.py --help`, and `video/video_manifest.py --help` on 2026-09-15.
