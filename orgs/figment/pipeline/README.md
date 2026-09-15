# figment pipeline — operator entry point

One persona (`persona.yaml`) plus a fixed set of reference anchors runs through eight stages
under a fail-closed identity/quality gate, driven by one script:
`orgs/figment/pipeline/figment_train.py`. This file is the pipeline's current, real state —
not a design aspiration. For the project's mandate/guardrails/state, start at
`orgs/figment/_index.md`; this file is the pipeline's own map.

## Shape

```
persona.yaml (+ training.yaml sidecar) + anchors/*.jpg
        |
   figment_train.py plan --creator <id> --stage <stage|all>
        |
  anchor -> dataset -> smoke -> train -> tester -> gen -> detail -> video
        |                                      |       |       |
        `---- grade / gate / apply-rulings (per gradeable stage) ----'
        |
        `---- --stage all plans/runs only through tester; gen/detail/video are
              NEVER included in "all" (build_plan) -- always planned by name,
              each against its own already-ruled upstream stage ----'
```

`anchor`, `dataset`, `tester`, `gen`, `detail` are gradeable — an operator eye-gate board
plus written rulings; `smoke` and `train` are not (no per-cell ruling makes sense for
either — see `figment_train.py`'s `GRADEABLE_STAGES`). `video` is a valid `--stage`/grade
target (STAGES/GRADEABLE_STAGES both carry it) but `figment_train.py`'s own `build_plan`
does not yet know how to plan one — see "Video" below. Only `run` ever spends money or
touches a pod; `plan`, `grade`, `gate`, and `apply-rulings` are local and free.

## `pipeline` — one resumable driver (F1)

`figment_train.py pipeline` walks anchor → dataset → smoke → train → tester → gen → detail
in one call, dispatching to the same `run`/`grade`/`apply-rulings`-equivalent functions the
manual chain below uses. It stores no cursor/state file of its own — every invocation
derives "what's next" from `stage.json`/`run.json` receipts and `grade/<stage>/{gate,
approval-lineage,rejection-lineage}.json` already on disk, so killing and re-invoking it is
always safe and never re-plans, re-runs, or re-grades a stage that already has current
evidence.

```powershell
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001 --out C:/tmp/creator-001-plan
# GATE dataset: awaiting ruling -- fill grade/dataset/rulings.template.json, apply-rulings, then:
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001 --plan C:/tmp/creator-001-plan/plan.json
# ... repeats through tester (pass --checkpoint-step on that one apply-rulings), gen, detail ...
```

`gen` and `detail` are each planned automatically into a deterministic
`<plan_root>/downstream/<gen|detail>/` directory the moment their upstream ruling exists —
`detail` always against `gen`'s own kept outputs (F2; see "Stage: detail" below), never an
operator-supplied glob. `pipeline` halts and prints the board path, the rulings template
path, and the exact `apply-rulings` command at every gradeable stage lacking a ruling (a
`GATE <stage>: awaiting ruling` line — exit 0, not an error). It recognizes anchor's own
promotion (persona references change) and instructs a fresh `--out` rather than trying to
continue a plan that cannot honestly continue. Once `detail` is ruled it writes
`<plan_root>/deliverable/manifest.json` (see "The deliverable" below) and reports
`video` as not yet automated (F6 is a manifest builder and a template-fitting derivative,
not a `pipeline`-driven stage — see "Video" below); `--dry-run` previews the next action
without calling the harness or any local build/grade function.

`--from-stage` resumes the walk from a specific stage instead of the beginning (useful once
you already know earlier stages are settled); `--max-usd` is accepted for interface
symmetry with `plan`/`run` but, like `--dry-run` on those two, is not consumed by any
dispatched command today — every manifest's own ceiling is still derived at plan time
(`manifest_ceiling`/`_apply_train_budget`), never overridden at run time.

## The manual chain

For the current train-first operator path, its real output-relative locations,
fresh external-source `gen` plan, and approved-still video handoff, see the
[operator runbook](../../../docs/figment/2026-09-09-operator-runbook.md).

Full chain for creator-001 (matches `figment_train.py`'s own `build_parser`, and
`train/FIGMENT-TRAIN.md`):

```powershell
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage all --out C:/tmp/creator-001-plan
py -3 orgs/figment/pipeline/figment_train.py run --creator creator-001 --stage dataset --plan C:/tmp/creator-001-plan/plan.json
py -3 orgs/figment/pipeline/figment_train.py grade --creator creator-001 --stage dataset --plan C:/tmp/creator-001-plan/plan.json
# fill grade/dataset/rulings.template.json (decided_by/decided_at + keep/cull + all seven axes)
py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator creator-001 --stage dataset --plan C:/tmp/creator-001-plan/plan.json --rulings C:/tmp/creator-001-plan/grade/dataset/filled.json
py -3 orgs/figment/pipeline/figment_train.py gate --creator creator-001 --stage dataset --plan C:/tmp/creator-001-plan/plan.json
py -3 orgs/figment/pipeline/figment_train.py run --creator creator-001 --stage all --plan C:/tmp/creator-001-plan/plan.json
```

`run --stage all` stops after `anchor` (when present) and after `dataset` for mandatory
operator review. Anchor promotion changes the persona references, so its old all-stage plan
cannot plan the next dataset honestly: apply the ruling, then create a fresh `--stage all`
plan. Repeating the old plan refuses without launching another pod. After a dataset ruling,
the same plan resumes at `smoke`. `--skip-pin-verify` skips the live HF pin preflight
(offline/test only, never on a real run). The current live path is Path-A **train-first**
(r24 method 4 + r21 DOP: trains directly off an already-graded, already-captioned dataset
dir, skipping the `dataset` stage):

```powershell
py -3 orgs/figment/pipeline/figment_train.py train-first --creator creator-001 --dataset-dir <graded-cells-dir> --out C:/tmp/creator-001-train-first
```

A train-first directory needs more than `_dataset.ready`. Its `dataset_manifest.json` must
exactly describe every image, image hash, caption sidecar and count, and
`dataset-approval.json` must bind those current bytes to an operator identity and time. To
migrate an existing historical directory, inspect the images and captions at full resolution,
then record that decision explicitly:

```powershell
py -3 orgs/figment/pipeline/figment_train.py accept-dataset --creator creator-001 --dataset-dir <graded-cells-dir> --decided-by <operator> --decided-at <ISO-8601>
```

This validates and records the supplied decision. It does not infer or fabricate an approval
for the historical 23-image train-first candidate.

**creator-002 differs by nothing but data.** `figment_train.py` names no creator in code
(`train/FIGMENT-TRAIN.md` — "nothing remains creator-specific in code or manifests"); a new
persona is `orgs/figment/personas/<id>/persona.yaml` + `training.yaml` + `anchors/*.jpg`, then
every command above with `--creator <id>`. `persona.py` validates the base schema before any
stage plans.

## The gate

Two stages, both fail-closed (`gate.yaml`'s own header: a metric that can't be computed FAILS,
never passes silently):

1. `identity_gate.py` — facenet own-anchor cosine, ViT age delta, from-scratch NIQE, a YCbCr
   gloss proxy, min face px.
2. `vlm_judge.py` — a headless Claude vision judge (`claude -p`, subscription-billed, not an
   API spend) scoring same_person / age_delta / skin_realism / gloss / artifacts.

`grade` writes two different records. `grade/<stage>/gate.json` is the cached per-cell
numeric `figment/gate@1` score table — written by ONE function,
`identity_gate.write_gate_document`, shared by `figment_train.py build_grade` (a
plan-driven grading stage) and `identity_gate.py`'s own plan-independent `run` CLI, so
every `gate.json` on disk is byte-identical regardless of caller. `apply-rulings` writes
the human `figment/approval-lineage@1` record after requiring `decided_by`, `decided_at`,
keep/cull, and all seven axes. The human record binds the ordered image bytes, anchors,
persona/training inputs, stage manifests, plan, numeric score document, and `gate.yaml`.
Changing any of them makes the review stale. `gate` only displays the cached score table
after checking those inputs and says that no recalculation occurred. Run `grade` to
recalculate scores.

(`gates.py` is unrelated to the above — a small `sha256_file` helper `persona.py` and
`expand/build_expansion_set.py` load by path. It used to also define a second,
incompatible `write_gate`/`gate_is_current` pair with its own SHA-bound human-decision
schema; that pair had zero non-test callers and was deleted rather than kept alongside
the real writer above.)

Tester rulings may be applied as ordinary QA without selecting a model. To promote one
operator-chosen candidate, pass its produced step explicitly:

```powershell
py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator creator-001 --stage tester --plan <plan.json> --rulings <filled.json> --checkpoint-step 750
```

The selected tester cell must be kept. Immediately before tester launch, the driver records
the path, size, and SHA-256 of every candidate and checks that inventory again after the
successful tester receipt. Promotion requires that completed tester evidence, rejects dry-run
train/tester receipts, verifies that the step was produced by the same completed train run,
and requires the selected bytes to still match the tester inventory. It stores that provenance
with `chosen_checkpoint_step`. Generation revalidates the source plan, current tester
approval, training inputs, receipt and checkpoint bytes, then copies only that accepted
checkpoint into the new generation plan. Provider receipts carry byte counts rather than a
signed digest, so this proves continuity from the local source hashed at upload time; it does
not cryptographically attest the bytes consumed inside the provider pod.

Fresh gen plans also capture a `gen_authority` snapshot. Before each base or
detail launch, the driver revalidates the current persona, selected checkpoint,
upstream approval and source bytes, then rechecks the staged copy. If those
inputs change after the base run, the base stays complete, no detail attempt
is created, and the stage records `stopped:gen`. Older gen plans without this
snapshot must be recompiled; never add the field to an immutable plan by hand.
See the [freshness review](../../../docs/figment/archive/2026-09-10-gen-authority-freshness-review.md).

`identity_gate.py` alone does **not** separate the operator's actual verdicts — Track-1 cells
the operator called "glossy, older" score facenet ~0.92, indistinguishable from the anchors'
own 0.89-0.93 pairwise cosine (STATE.md 2026-09-06). `vlm_judge.py` does: it read g01 vs the
tester's step-1500 checkpoint as `same_person 58, age 23->30, skin_realism 55`, matching the
operator's own read (same source).

creator-001 thresholds (`pipeline/gate.yaml`, calibrated 2026-09-06/07 on 95 real images
across 6 evidence sets — full distributions in
`personas/creator-001/calibration/{calibration,judge-calibration}.md`):

| Stage | Key | Value | Status |
|---|---|---|---|
| identity_gate | `identity_own_min` | 0.7907 | evidence-backed, clean separation |
| identity_gate | `niqe_max` | 6.5 | judgment call, not a clean separator |
| identity_gate | `age_delta_max_years` / `gloss_max` | 5.0 / 0.08 | **not validated** — placeholders |
| identity_gate | `face_px_min` | 600 | from persona.yaml; "uncalibrated" status there too |
| judge | `same_person_min` | 70.2 | evidence-backed |
| judge | `age_delta_max` | 1.5 | evidence-backed |
| judge | `skin_realism_min` / `gloss_max` / `artifacts_max` | 31.5 / 67.5 / 45.0 | **not validated** — anchors score worse than these on raw flash photos |

Combined `judge_gate` at these thresholds (`gate.yaml`): anchors 3/3, track1-dataset 22/31,
lora-tester 0/8, qwen-anchor-edits 4/6, passport-candidates 0/12, expansion-03 23/35.

## Stage: detail (F2)

`detail` is a `STAGES`/`GRADEABLE_STAGES` entry that always re-detailts a specific `gen`
plan's own KEPT stills at the package's own denoise band (r25 cause #2) — never an
operator-chosen glob. Plan it explicitly against an already-ruled `gen` plan:

```powershell
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage detail --out <detail-plan-dir> --approved-gen-plan <gen-plan-dir>
```

Every image in `<gen-plan-dir>/grade/gen/approved-list.json` is re-validated through the
existing `validate_approved_gen_still` (never trusted from the approved list's bytes
alone), staged, and re-detailed with the same accepted checkpoint `gen` uses (two
denoise-variant jobs — 0.15 and 0.27 — per kept image, an A/B pair). `detail` is re-checked
at every launch boundary exactly like `gen`'s own checkpoint freshness check
(`_validate_detail_source_inputs`): a gen image rejected or changed after detail planning
refuses rather than silently re-detailing stale pixels. `--detail-images` (a local glob,
meaningful only with `--stage gen`) is the older, still-available side mode for re-detailing
an arbitrary operator-chosen set of existing cells — unrelated to this stage, kept for that
ad hoc use.

## Video

`video/video_manifest.py`, `video/frame_extract.py`, `video/frame_assemble.py`, and
`video/video_review.py` already form a working Wan 2.2 I2V pipeline from an approved gen
still through a graded review candidate — run today as four independent CLIs, documented in
the [operator runbook](../../../docs/figment/2026-09-09-operator-runbook.md). `video` is a
valid `STAGES`/`GRADEABLE_STAGES` value (a `--stage video` grade/gate/apply-rulings target),
but `figment_train.py build_plan`/`pipeline` do not yet know how to plan or drive one —
`video_manifest.build_manifest`'s own `CANDIDATE_MODE` binds a review candidate's authority
to the REAL, in-repo `persona.yaml` under its own `--root`, which means a `video` plan built
by `build_plan` would need its own output directory and the `gen` plan it points at to both
live under this repo's root, a constraint `gen`/`detail` plans do not share today (their
`--out` is commonly a scratch directory outside the repo, e.g. the runbook's own
`C:/tmp/creator-001-plan`). Wiring that cleanly is unstarted follow-on work, not silently
narrowed here.

`frame_assemble.py` does have the one delivery-fitting transformation F6 asks for:
`frame_assemble.py reel --root <root> --assembly-receipt <frame-assembly.json> --out <dir>`
(or `build_reel_derivative(...)` in-process) takes an already-assembled native diagnostic or
candidate movie (`assemble_frames`' own 81-frame, native-resolution MP4) and renders the
`content/reel-templates.yaml` delivery spec (1080×1920 @30fps, `scale,pad,fps` filter graph)
as `reel.mp4`, writing `reel-derivative.json` beside it with the native↔derivative
correspondence: both movies' own sha256, the exact filter graph, and the native and
derivative durations (preserved; frame count differs by design — 81 @16fps ≈ 152 @30fps
for the same ~5.06s).

A real, reproducible drift was investigated and diagnosed, not fixed here:
`content/tests/test_motion_asset_binding.py::test_real_video_producer_to_content_cli_then_stale_movie_refuses`
fails on this machine, but not because of a caller/CLI argv mismatch (`video_review.py`'s
argv already matches its own `main()`). The actual cause is a Windows MAX_PATH (260-char)
failure inside `video_review.py`'s content-addressed review-store writes/re-reads
(`_exclusive_file`, `_read_json`) and, deeper, inside `frame_extract.py`'s shared
`_within` path-containment walk (`Path.exists()`/`os.lstat()` per path component are not
long-path-safe on Windows) — triggered once a review-store path (a 64-hex-char plan-sha
directory plus an `attempt-<id>.json`/terminal filename) crosses 260 characters under a
sufficiently deep repo/worktree/`--basetemp` root. `_within` is a shared, adversarially
reviewed containment primitive across the whole `video/` subsystem; making it long-path-safe
without weakening the symlink/reparse-point checks it exists to enforce needs its own
independent review, per this project's own standing rule for security-relevant code — not a
unilateral patch bundled into F6.

## The deliverable

Once `detail` is ruled, `pipeline` writes `<plan_root>/deliverable/`: `stills/<image_id>.ext`
(every kept `gen` still), `detail/<image_id>.ext` (every kept `detail` image), and
`manifest.json` — lineage the receipts already carry, not a new schema: the `gen`/`detail`
plan paths and hashes, the chosen checkpoint step and digest, and per kept cell its gate row
and ruling attribution (`decided_by`/`decided_at`/`why`/`gate_override`). Idempotent: a
deliverable already bound to the current `detail` approval-lineage is left alone rather than
rebuilt on every `pipeline` call.

## Pins

Every model/custom-node pin lives in `train/tensor-pins.yaml`, keyed by stage. `train/
verify_pins.py` HEADs each pin's `revision`/`sha256` live against Hugging Face and fails
closed on any mismatch or redirect (never follows a 302) — wired as a `plan`/`train-first`
preflight unless `--skip-pin-verify` is passed. Full substitution log, licences, and open pin
risks: `expand/TENSOR-REPLICATION.md`, `train/TENSOR-TRAINING.md`.

n13: `verify_pins.py`'s HEAD/sha256 check covers `models` only. `detail`'s
`custom_nodes` (RES4LYF, ComfyUI-Impact-Pack) clone at a *recorded* commit
(`installer_pin`) that is never re-verified the way a model's sha256 is — the pin
records what commit was reviewed, it does not enforce that the pod actually gets
that commit, and cloning still runs `pip install -r requirements.txt` on the pod with
no pickle-format check at all (GUARDRAILS #7's own carve-out: the pickle ban covers
`manifest["models"]` only, never `custom_nodes`). `pipeline` now reaches `detail` as
part of its own default anchor→detail path (F1/F2) rather than an operator-invoked
side mode, so this open surface is exercised by default, not opt-in — read GUARDRAILS
#7 before promoting `detail` (or any other custom-node-bearing stage) further.

## Spend guards

- Daily: `governance/budget.yaml` `daily_usd_limit: 10.00` (subscription-billed steps, e.g.
  `vlm_judge`, log $0.00 against this).
- Arc: `ARC_CAP_USD = "50.00"` in `figment_train.py`, checked against every `figment-*.tsv`
  ledger row before a live `run`.
- Per-stage ceilings (`--max-usd`; `train/TENSOR-TRAINING.md`'s cost table): train-smoke
  $2.28, tester $2.82 (F5: `max_minutes` raised 115 -> 130 to cover the 12-job ladder a
  3000-step/save_every-250 checkpoint schedule now tests), gen $3.58; dataset shard
  $2.71/pod, ~$8.13 for 3 shards, dependency smoke $1.41 (`expand/TENSOR-REPLICATION.md`).
  Bake-off ablation $2.65, Path-B diagnostic $3.70 (STATE.md 2026-09-06). **train is not a
  fixed number** — `_apply_train_budget` derives the ceiling from steps x the per-step rate
  (plus `runpod_run.minimum_runtime_minutes`'s floor), so it moves with the plan's own
  `steps`/DOP: a real `plan` run on 2026-09-15 (F5: `steps: 1250 -> 3000`, DOP still on)
  printed `steps=3000 per_step_s=9.0 max_minutes=726 ceiling_usd=$15.73` — up from the
  earlier `steps=1250` plan's `$7.61`. Read the ceiling off your own `plan.json`, never
  quote a fixed figure for train. **This now exceeds `governance/budget.yaml`'s $10.00
  daily limit on its own**, even on a day with zero prior Figment spend — DOP's ~3.6x
  per-step rate (9.0s vs 2.5s, r21) times 3000 steps is the real cost of training-to-3000
  screened-by-tester rather than defaulting to a shorter run (F5 ruling, r25 causes #4/#6);
  train's OWN ceiling clears the $50.00 arc cap by itself (`ledgers/cost/` totalled
  $33.7234 as of E3, leaving $16.2766 against train's $15.73) but a live `run --stage
  train` still needs its own calendar day with no other Figment spend, checked at
  plan/run time by `enforce_daily_budget` (fails closed otherwise) — same "spend its own
  day" constraint the arc cap and per-stage ceilings above already impose on `gen`.
  **The FULL `--stage all` chain does NOT clear the arc with the same margin**: summed
  ceilings at these numbers (anchor $4.90 + dataset $10.47 + smoke $2.28 + train $15.73 +
  tester $2.82 = $36.20) exceed the $16.2766 remaining more than twofold — `enforce_arc_cap`
  only ever compares ONE run's ceiling at RUN time, so a chain like this used to be
  accepted for planning and only fail mid-chain, after anchor+dataset already spent (M2).
  `build_plan`/`pipeline` now run a plan-time budget preflight before writing `plan.json`:
  it sums every run the call is about to plan against the arc cap remaining (same ledger
  reader the harness uses) and refuses unless `--accept-budget` is passed, which records
  the acceptance and the numbers in `plan.json`'s `budget_preflight`. It also names, per
  run, any single ceiling bigger than the daily limit (train always is, by the DOP
  arithmetic above) — informational only, never a second blocker on top of
  `enforce_daily_budget`.
- Every manifest carries its own `max_minutes`/`max_placement_attempts: 1` (no automatic
  retry on a live run) and is `--dry-run` green before it ever spends.

## Harness contract

`run` never talks to a pod directly — it delegates to `pod/runpod_run.py` with the exact argv
recorded in `plan.json`. Credential boundary, `--dry-run` semantics, the terminate-and-verify
guarantee, and the `HF_TOKEN` secret-reference mechanism are documented once, in
`pod/README.md` — read that before touching anything pod-shaped.

## Live-proven runs to date

| Date | Stage | Pod | Cost | Verdict |
|---|---|---|---|---|
| 09-03 | dependency smoke | xxviaztv52cxl0 | $0.22 (STATE 23:50) | PASS — first output that reads as the g01/g07 woman |
| 09-04 | dataset: smoke + 3 shards, 31 cells | — | $1.07 (STATE 17:40) | operator: "a lot closer," not exact — GO to LoRA grid |
| 09-04 | training smokes #1-#5 | — | ~$1.90 (STATE 19:40) | #1-#2 FAILED (ComfyUI health, then 502 mid-load); #4/#5 proved torch/CUDA + state-dict + publish path |
| 09-04 | full train, 2000 steps | igvqxqcrmltsig | $1.80 (STATE 23:55) | 8 checkpoints; own-anchor identity 0.83-0.89 @ steps 1500-1750 |
| 09-04 | tester, 8 checkpoints | iw12lyi84um2b9 | $0.33 (STATE 23:55) | operator: "kind of close, glossy, reads older, inconsistent" |
| **09-04 day total** | — | — | $6.32 (STATE 23:55); $6.3161 summed live (`ledgers/cost/figment-2026-09-04.tsv`) | consistent |
| 09-06 | Track-2 anchor stage, 12 passport + 6 edits | — | $0.61 (STATE) | operator: "absolutely not even close" — passport path SHELVED |
| 09-07 | bake-off m1, 18-cell ablation | jm67txnsqfj662 | $1.99 + $0.23 = $2.22 (STATE 00:40) | arm B (no skin LoRA) best, facenet 0.87-0.93; skin LoRA HURTS identity |

Sources: `orgs/figment/STATE.md` 2026-09-03 23:50 through 2026-09-07 00:40, cross-checked
against `ledgers/cost/figment-2026-09-0{3,4,6,7}.tsv` where a row is identifiable. See Open
defects below for where these two sources disagree past 09-04.

## Open defects / risks

- **Ledger-vs-narrative reconciliation gap** (`REVIEW-2026-09-03-track1.md` findings 1-2,
  still open): `ledgers/cost/figment-2026-09-06.tsv` sums to $2.822, against STATE.md's stated
  "$0.61" for that day; `figment-2026-09-07.tsv` carries an unnarrated $5.85 row
  (`fn938tol6mgbtp`). Do not trust a single day's total from either source alone.
- ~~**`flux2-klein-4B` renamed on Hugging Face**~~ — RESOLVED (`expand/TENSOR-REPLICATION.md`
  open risk 5, F7): `pins.dataset`/`pins.anchor_edit` already repoint to the current repo id
  `Comfy-Org/vae-text-encorder-for-flux-klein-4b` (`tensor-pins.yaml:117-119,135-137`, landed
  commit `9ffec37a`). Re-verified live 2026-09-15: `verify_pins.py` (no `--stage` — every stage)
  reports `verified 9 stage(s) clean: anchor, anchor_edit, dataset, detail, gen, skin_loras,
  style_loras, tester, train`; the repo's own HF API record (`api/models/Comfy-Org/vae-text-
  encorder-for-flux-klein-4b`) confirms `modelId` == `id` (no further redirect) and
  `license: apache-2.0`.
- **Three of gate.yaml's eight thresholds are unvalidated placeholders** (identity_gate's
  `age_delta_max_years`/`gloss_max`; judge's `skin_realism_min`/`gloss_max`/`artifacts_max`) —
  calibration ran and reported honestly that these do not separate any evidence set (`gate.yaml`
  carries the full reasoning inline).
- **Path-B diagnostic** (`expand/bakeoff/m3diag_manifest.yaml`) is built and dry-run green but
  its launch was BLOCKED by the session permission classifier — operator must launch by hand
  (command in `m3diag_README.md`); not yet run as of STATE.md 2026-09-07 00:40.
- ~~`personas/creator-001/training.yaml` reads `steps: 1250`, not yet reflected in
  `train/TENSOR-TRAINING.md`'s ruling~~ — RESOLVED (F5, 2026-09-15): `training.yaml` now reads
  `steps: 3000` (`dop_enabled` stays `true`), matching `train/TENSOR-TRAINING.md`'s current
  "Step count: 3000, screened by the tester" ruling and `render_aitoolkit_config.py`'s
  `MODULE_11["steps"]`/`check_module_11` default (also raised to 3000). The checkpoint ladder
  is 11 intermediates + final (12, matching module 11's own count, not the earlier 8); the
  tester's pinned `max_minutes` (`tensor-pins.yaml`) was raised 115 -> 130 to cover the extra
  jobs. The derived train ceiling (`$15.73`) now exceeds the $10.00 daily cap on its own — see
  "Spend guards" above — so a live `train` run needs its own day, same as `gen`.
- **`video_review.py` review-store writes can exceed Windows MAX_PATH** under a deep enough
  repo/worktree/`--basetemp` root — see "Video" above for the diagnosis
  (`content/tests/test_motion_asset_binding.py::test_real_video_producer_to_content_cli_then_stale_movie_refuses`).
  Needs an independent review of `frame_extract.py`'s shared `_within` containment walk before
  a fix, not a unilateral patch.
- **`build_plan`/`pipeline` do not yet plan a `video` stage** (F6) — see "Video" above for why
  (the review-candidate authority binding needs the `gen` and `video` plans to share a root
  that also contains this repo's own `persona.yaml`, a constraint no other stage's `--out`
  shares today).

## How to iterate

- **Add a persona.** New `orgs/figment/personas/<id>/{persona.yaml, training.yaml, anchors/}`;
  run the same CLI with `--creator <id>`. No code change.
- **Change a threshold.** Edit `pipeline/gate.yaml` (top-level keys for `identity_gate.py`, the
  `judge:` block for `vlm_judge.py`); re-run `figment_train.py grade --creator <id> --stage
  <gradeable-stage> --plan <plan.json>` to recalculate, then obtain and apply fresh rulings.
  The `gate` command only displays the cached table after verifying its inputs. No code change.
- **Add a stage.** Widen `STAGES`/`GRADEABLE_STAGES` in `figment_train.py` and wire a manifest
  builder for it — a code change; `GRADEABLE_STAGES`'s own comment names the three functions
  (`build_grade`, `apply_rulings`, `command_gate`) that must all agree. `detail` (F2) is the
  worked example: `STAGE_PIN_PROFILES["detail"]`, a `build_plan` branch sourcing an upstream
  stage's approved images, an `_install_stage_config`/`run_planned_stage` freshness re-check,
  and a `pipeline` (F1) entry that plans it automatically once its upstream ruling exists.
- **Swap a model pin.** Edit `train/tensor-pins.yaml`; `verify_pins.py --stage <name>` checks it
  live before you spend a plan run on a stale digest.
