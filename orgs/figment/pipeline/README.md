# figment pipeline — operator entry point

One persona (`persona.yaml`) plus a fixed set of reference anchors runs through six stages
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
  anchor -> dataset -> smoke -> train -> tester -> gen
        |                                      |
        `---- grade / gate / apply-rulings (per gradeable stage) ----'
        |
        `---- --stage all plans/runs only through tester; gen is NEVER
              included in "all" (build_plan) -- always run it by name ----'
```

`anchor`, `dataset`, `tester`, `gen` are gradeable — an operator eye-gate board plus written
rulings; `smoke` and `train` are not (no per-cell ruling makes sense for either — see
`figment_train.py`'s `GRADEABLE_STAGES`). Only `run` ever spends money or touches a pod;
`plan`, `grade`, `gate`, and `apply-rulings` are local and free.

## The one command

Full chain for creator-001 (matches `figment_train.py`'s own `build_parser`, and
`train/FIGMENT-TRAIN.md`):

```powershell
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage all --out C:/tmp/creator-001-plan
py -3 orgs/figment/pipeline/figment_train.py run --creator creator-001 --stage dataset --plan C:/tmp/creator-001-plan/plan.json
py -3 orgs/figment/pipeline/figment_train.py grade --creator creator-001 --stage dataset --plan C:/tmp/creator-001-plan/plan.json
# fill grade/dataset/rulings.template.json (keep/cull + all seven axes)
py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator creator-001 --stage dataset --plan C:/tmp/creator-001-plan/plan.json --rulings C:/tmp/creator-001-plan/grade/dataset/filled.json
py -3 orgs/figment/pipeline/figment_train.py gate --creator creator-001 --stage dataset --plan C:/tmp/creator-001-plan/plan.json
py -3 orgs/figment/pipeline/figment_train.py run --creator creator-001 --stage all --plan C:/tmp/creator-001-plan/plan.json
```

`run --stage all` stops after `dataset` for the mandatory operator gate; after `apply-rulings`
the same command resumes at `smoke`. `--skip-pin-verify` skips the live HF pin preflight
(offline/test only, never on a real run). The current live path is Path-A **train-first**
(r24 method 4 + r21 DOP: trains directly off an already-graded, already-captioned dataset
dir, skipping the `dataset` stage):

```powershell
py -3 orgs/figment/pipeline/figment_train.py train-first --creator creator-001 --dataset-dir <graded-cells-dir> --out C:/tmp/creator-001-train-first
```

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

## Pins

Every model/custom-node pin lives in `train/tensor-pins.yaml`, keyed by stage. `train/
verify_pins.py` HEADs each pin's `revision`/`sha256` live against Hugging Face and fails
closed on any mismatch or redirect (never follows a 302) — wired as a `plan`/`train-first`
preflight unless `--skip-pin-verify` is passed. Full substitution log, licences, and open pin
risks: `expand/TENSOR-REPLICATION.md`, `train/TENSOR-TRAINING.md`.

## Spend guards

- Daily: `governance/budget.yaml` `daily_usd_limit: 10.00` (subscription-billed steps, e.g.
  `vlm_judge`, log $0.00 against this).
- Arc: `ARC_CAP_USD = "50.00"` in `figment_train.py`, checked against every `figment-*.tsv`
  ledger row before a live `run`.
- Per-stage ceilings (`--max-usd`; `train/TENSOR-TRAINING.md`'s cost table): train-smoke
  $2.28, tester $2.28, gen $3.58; dataset shard $2.71/pod, ~$8.13 for 3 shards, dependency
  smoke $1.41 (`expand/TENSOR-REPLICATION.md`). Bake-off ablation $2.65, Path-B diagnostic
  $3.70 (STATE.md 2026-09-06). **train is not a fixed number** — `_apply_train_budget`
  derives the ceiling from steps x the per-step rate (plus `runpod_run.minimum_runtime_
  minutes`'s floor), so it moves with the plan's own `steps`/DOP: a real `plan` run on
  2026-09-07 printed `steps=1250 per_step_s=9.0 max_minutes=351 ceiling_usd=$7.61` — not the
  $5.85 an earlier plan produced. Read the ceiling off your own `plan.json`, never quote a
  fixed figure for train.
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
- **`flux2-klein-4B` renamed on Hugging Face** (`expand/TENSOR-REPLICATION.md` open risk 5):
  every `pins.dataset`/`pins.anchor_edit` pin now HEADs a 307; `verify_pins.py` fails closed on
  it until `repo_id` is updated to the new name.
- **Three of gate.yaml's eight thresholds are unvalidated placeholders** (identity_gate's
  `age_delta_max_years`/`gloss_max`; judge's `skin_realism_min`/`gloss_max`/`artifacts_max`) —
  calibration ran and reported honestly that these do not separate any evidence set (`gate.yaml`
  carries the full reasoning inline).
- **Path-B diagnostic** (`expand/bakeoff/m3diag_manifest.yaml`) is built and dry-run green but
  its launch was BLOCKED by the session permission classifier — operator must launch by hand
  (command in `m3diag_README.md`); not yet run as of STATE.md 2026-09-07 00:40.
- `personas/creator-001/training.yaml` in this worktree currently reads `steps: 1250`,
  `dop_enabled: true` (uncommitted, in-flight edit for the `train-first` build) — not yet
  reflected in `train/TENSOR-TRAINING.md`'s "2000, not 3000" ruling, which was written for the
  earlier module-11 port. Whichever value ships live is the number that matters.

## How to iterate

- **Add a persona.** New `orgs/figment/personas/<id>/{persona.yaml, training.yaml, anchors/}`;
  run the same CLI with `--creator <id>`. No code change.
- **Change a threshold.** Edit `pipeline/gate.yaml` (top-level keys for `identity_gate.py`, the
  `judge:` block for `vlm_judge.py`); re-run `figment_train.py gate --creator <id> --stage
  <gradeable-stage> --plan <plan.json>` to see the new pass/fail table. No code change.
- **Add a stage.** Widen `STAGES`/`GRADEABLE_STAGES` in `figment_train.py` and wire a manifest
  builder for it — a code change; `GRADEABLE_STAGES`'s own comment names the three functions
  (`build_grade`, `apply_rulings`, `command_gate`) that must all agree.
- **Swap a model pin.** Edit `train/tensor-pins.yaml`; `verify_pins.py --stage <name>` checks it
  live before you spend a plan run on a stale digest.
