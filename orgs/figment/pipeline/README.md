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

`anchor`, `dataset`, `tester`, `gen`, `detail`, `video` are gradeable — an operator
eye-gate board plus written rulings; `smoke` and `train` are not (no per-cell ruling makes
sense for either — see `figment_train.py`'s `GRADEABLE_STAGES`). Only `run` ever spends
money or touches a pod; `plan`, `grade`, `gate`, and `apply-rulings` are local and free.

## `pipeline` — one resumable driver (F1)

`figment_train.py pipeline` walks anchor → dataset → smoke → train → tester → gen → detail
in one call, dispatching to the same `run`/`grade`/`apply-rulings`-equivalent functions the
manual chain below uses. It stores no cursor/state file of its own — every invocation
derives "what's next" from `stage.json`/`run.json` receipts and `grade/<stage>/{gate,
approval-lineage,rejection-lineage}.json` already on disk, so killing and re-invoking it is
always safe and never re-plans, re-runs, or re-grades a stage that already has current
evidence.

```powershell
# --out defaults to orgs/figment/runs/<creator>/<YYYYMMDD-HHMMSS>/ -- the in-repo run root
# the video stage requires (see "Video" below); pass --out yourself only to override it.
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001
# pipeline: new run root C:\...\orgs\figment\runs\creator-001\20260915-081500
# GATE dataset: awaiting ruling -- fill grade/dataset/rulings.template.json, apply-rulings, then:
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001 --plan <that run root>/plan.json
# ... repeats through tester (pass --checkpoint-step on that one apply-rulings), gen, detail, video ...
```

`gen`, `detail` and `video` are each planned automatically into a deterministic
`<plan_root>/downstream/<gen|detail|video>/` directory the moment their upstream ruling
exists — `detail` always against `gen`'s own kept outputs (F2; see "Stage: detail" below),
never an operator-supplied glob, and `video` always against one of `gen`'s own kept stills
(F6a; see "Video"). `pipeline` halts and prints the board path, the rulings template path,
and the exact `apply-rulings` command at every gradeable stage lacking a ruling (a
`GATE <stage>: awaiting ruling` line — exit 0, not an error). It recognizes anchor's own
promotion (persona references change) and instructs a fresh `--out` rather than trying to
continue a plan that cannot honestly continue. Once `detail` is ruled it writes
`<plan_root>/deliverable/manifest.json` (see "The deliverable" below), and once `video` is
ruled that manifest gains the delivered reel; the run then reports `complete:video`.
`--dry-run` previews the next action without calling the harness or any local build/grade
function.

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

### Importing a checkpoint ladder

The tester stage above only screens checkpoints its own in-plan `train` stage produced.
MANDATE.md's tier constraint puts the explicit-tier LoRA on operator-controlled hardware,
outside any pod-planned `train` run, so it must enter tester as loose files instead:

```powershell
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage tester `
  --out <plan-dir> --import-checkpoints <dir-of-*.safetensors> `
  [--import-training-config <training.yaml>]
# or, driven end to end (plans tester as the primary plan's only stage -- anchor,
# dataset, smoke, and train are never planned or run):
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001 --out <run-root> `
  --import-checkpoints <dir-of-*.safetensors>
```

`--import-checkpoints <dir>` discovers every `<trigger>[_<9-digit step>].safetensors` file
in `<dir>` matching the persona's own derived checkpoint stem (the un-suffixed file is the
final step, i.e. `training.steps` of the RECORDED training config); refuses any other
extension, any symlink/reparse point, any file under 1 MiB, a duplicate step, or an empty
ladder. Each file is staged into the plan's own upload tree (`train/runs/_uploads/<persona>/`,
`_copy_detail_images`'s own convention) and sha-bound in
`plan["stages"]["tester"]["imported_checkpoints"]`, re-validated the same way at every
launch boundary — a file swapped after planning is refused with the same "staged checkpoint
changed after planning" class of error gen/detail's own checkpoint upload gives. `tester`
builds the exact same ladder-job manifest shape it builds for an in-plan train, just against
the discovered steps.

Training provenance for an imported ladder has no in-plan `train` receipt to derive it from:
`--import-training-config <training.yaml>` names the config the ladder was actually trained
with (default: the persona's own current `training.yaml`), and its sha256 is recorded as
`plan["imported_training_config"]`. `apply-rulings --stage tester --checkpoint-step <N>`
promotes an imported candidate exactly like an in-plan one — same evidence class, same
"kept by the rulings" requirement — but the resulting `accepted-checkpoint.json` carries
`"origin": "imported"`, which gen, detail, video, and the deliverable manifest's own
`checkpoint` block all carry forward so a reader can always tell an operator-trained
checkpoint from one this pipeline trained itself.

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

`video` is a real `build_plan`/`pipeline` stage (F6a). It reuses the four video CLIs
rather than reimplementing any of them: `video/video_manifest.py` compiles the
review-candidate manifest, the ordinary pod harness renders it, and
`video/frame_assemble.py` (assemble, then `reel`) plus `video/frame_extract.py` turn the
result into local evidence. The manual four-CLI chain is still documented in the
[operator runbook](../../../docs/figment/2026-09-09-operator-runbook.md); `pipeline` now
drives the same chain end to end.

```powershell
# planned by name against an already-ruled gen plan (pipeline does this for you)
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage video `
  --out orgs/figment/runs/creator-001/<stamp>/downstream/video `
  --approved-gen-plan orgs/figment/runs/creator-001/<stamp>/downstream/gen `
  [--approved-gen-image-id <kept gen image>] [--video-action "<short clothed motion>"]
```

**Run roots live inside the repository.** `video_manifest.build_manifest`'s
`review-candidate-v1` mode binds a candidate to the REAL, in-repo `persona.yaml` the
approved `gen` plan itself names, and requires that persona, the plan, its six
`grade/gen/*.json` evidence documents, the approved still and the output manifest to all
sit below one common `--root`. That root is this repository, so a `video` plan's `--out`
must be too: `_video_authority_root` refuses anything else by name, and `pipeline --out`
defaults to `orgs/figment/runs/<creator>/<YYYYMMDD-HHMMSS>/` for exactly this reason
(gitignored except its README). `gen` and `detail` plans are unaffected — they may still
be built in a scratch directory outside the repo, and a `pipeline` run rooted there simply
stops with `stopped:video-out-of-tree` after writing everything it honestly can.

What the stage does, in order:

1. **Plan** — picks the kept `gen` still (`--approved-gen-image-id`, default the first kept
   id in sorted order), re-validates it through the one still-lineage authority
   `validate_approved_gen_still`, and calls `video_manifest.write_manifest(...,
   mode=review-candidate-v1)`. The manifest is written BESIDE that still, inside the `gen`
   plan's own output tree, because APPROVED_GEN_ADAPTER.md requires it ("--out must be
   beside the selected frame so the existing harness can stage both without widening its
   upload boundary") — which is why the planned run records it with a `../`-relative path
   (`_relative`'s `walk_up`). `plan["video_source"]` records the gen plan, image id, bytes,
   sha256, candidate id and motion action.
2. **Run** — the ordinary bounded pod harness command, 81 native frames at 1280×704 @16fps.
3. **Evidence** (local, free, idempotent — `_build_video_evidence`) — `frame_assemble`
   writes `<video plan>/video/assembled/candidate.mp4` + `frame-assembly.json`,
   `frame_assemble reel` writes `<video plan>/video/reel/reel.mp4` +
   `reel-derivative.json` (the `content/reel-templates.yaml` delivery spec: 1080×1920
   @30fps via a `scale,pad,fps` filter graph, recording both movies' sha256, the filter
   graph and both durations — preserved; the frame COUNT necessarily differs, 81 @16fps ≈
   152 @30fps for the same ~5.06 s), and `frame_extract` writes
   `<video plan>/video/samples/` (first/middle/last + `frame-extraction.json`).
4. **GATE video** — `grade --stage video` grades every 8th of the 81 native frames
   (1, 9, … 81 → 11 cells) through the existing machinery: `identity_gate` scores identity,
   age and realism on each sampled frame, so `gate.json` carries identity-under-motion rows
   written by the single writer `identity_gate.write_gate_document`, and the operator rules
   the same seven axes per frame — where `identity` on each sampled frame IS "the face holds
   here". No temporal axis was added: `video/video_review.py` already owns the richer
   temporal vocabulary (`SEQUENCE_AXES` — `identity_stability`, `anatomy_stability`,
   `background_stability`, … — and `PLAYBACK_AXES`) for its own attributed accepted-video
   authority, and a second, weaker copy inside the still axes is exactly the divergence
   APPROVED_GEN_ADAPTER.md warns against.
5. **Ruling** — `apply-rulings --stage video` runs through the unchanged seven-axis path,
   and the deliverable gains `deliverable/video/<candidate id>.mp4` (the reel) plus the
   native↔derivative correspondence hashes (see "The deliverable").

Known narrowing: the first frame is the approved **gen** still, not the approved **detail**
image. `validate_approved_gen_still`, `video_manifest._candidate_preflight`,
`video_review._rebuild_candidate` and `content/content_asset_binding.py`'s slot join all
bind the literal stage `"gen"` (grade directory, approval stage, approved-list stage), so a
detail-sourced candidate needs a stage threaded through four independently reviewed
authorities plus a widened on-disk candidate-manifest schema — a design change with its own
review, not part of this wiring.

## The deliverable

Once `detail` is ruled, `pipeline` writes `<plan_root>/deliverable/`: `stills/<image_id>.ext`
(every kept `gen` still), `detail/<image_id>.ext` (every kept `detail` image), and
`manifest.json` — lineage the receipts already carry, not a new schema: the `gen`/`detail`
plan paths and hashes, the chosen checkpoint step and digest, and per kept cell its gate row
and ruling attribution (`decided_by`/`decided_at`/`why`/`gate_override`).

Once `video` is ruled it also gains `video/<candidate id>.mp4` — the reel derivative itself —
and a `video` block carrying the delivered file's own sha256, the delivery profile, the exact
native↔derivative correspondence `frame_assemble` recorded, the native movie's record, the
extraction receipt, and per graded frame its native-frame digest beside its gate row and
ruling attribution. A reader can therefore prove the delivered mp4 is this run's own native
movie re-rendered, and that the frames the identity gate scored are the frames that movie was
built from, without trusting any one receipt alone; `_deliverable_video` refuses to publish if
either link fails.

Idempotent: a deliverable already bound to the current `detail` AND `video` approval-lineage
digests is left alone rather than rebuilt on every `pipeline` call.

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
- **FFmpeg/FFprobe are pinned to two absolute paths** in `video/frame_extract.py`
  (`FFMPEG_PATH`/`FFPROBE_PATH`, one developer's Python `Scripts/` directory). Every video
  assembly, probe and extraction refuses on a machine without them at exactly those paths.
- **`video/` addresses long paths via the extended-length (`\\?\`) spelling** (F6b), which is
  Windows-only; on any other platform `_os_path` is a plain `abspath` and the OS's own limits
  apply. `figment_train.py` itself has NOT been audited for MAX_PATH — a run root deep enough
  to push a `grade/<stage>/*.json` path past 260 characters would still fail there.
- **A rare residual "directory identity changed" / `FigmentTrainError` flake remains in the
  `*_observed_reads.py` test family** (`tests/conftest.py`) even after rooting `tmp_path` under
  a private, worktree-namespaced folder off `%TEMP%`/`kb-worktrees\`. Observed at roughly 1 in
  20-40 file runs under heavy concurrent load (other kb workers/processes actively running on
  the same machine), vs. near-certain, different-test-every-time failure before that fix.
  `observed_reads.py`'s ancestor-chain fingerprint intentionally walks to the drive root
  (a real TOCTOU defense, not touched here), so *some* nonzero exposure to ambient filesystem
  activity is architecturally unavoidable on a shared, live Windows machine without either
  weakening that check (out of scope) or running on an otherwise-idle box. If this becomes
  disruptive, the next lever is CI/dispatch scheduling (don't run this family concurrently with
  other suites), not further test-location changes.
- **`calibrate/grid_run.py`'s `probe-a-zimage.yaml` fixture is stale against the live harness**
  (xfail, not fixed: `calibrate/tests/test_grid_run.py::test_two_fixed_seeds_and_manifest_passes_harness_dry_run`,
  `::test_grid01_is_40_single_axis_cells_with_probe_configuration`) — the probe pins
  `max_minutes: 40`, but `pod/runpod_run.py:require_manifest` now requires `max_minutes` to
  cover `readiness_timeout_seconds` plus `job_timeout_seconds` for every job (minimum 625 for
  this probe's 40-job grid). `grid_run.py` is NO-STAGE / CLI-orphan per
  `docs/figment/AUDIT-2026-09-15.md` §B.6 (no non-test caller, referenced only by
  `calibrate/runs/grid-01-README.md`), so the fixture was left as-is rather than bumped —
  a magic-number patch on dead code would just re-drift the next time the harness rule
  changes, with nothing live to catch it.

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
  `video` (F6a) is the second: same shape, plus an existing compiler imported rather than
  re-implemented, a post-run local evidence step (`_build_video_evidence`), and its own
  `_grading_images` branch choosing which cells the board shows.
- **Swap a model pin.** Edit `train/tensor-pins.yaml`; `verify_pins.py --stage <name>` checks it
  live before you spend a plan run on a stale digest.
