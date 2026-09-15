# figment — STATE

_Updated: 2026-09-15_

## Now

- **One resumable `pipeline` command drives the whole chain.** `figment_train.py pipeline
  --creator <id>` walks `anchor → dataset → smoke → train → tester → gen → detail → video`,
  halting with a printed `GATE <stage>: awaiting ruling` at every gradeable stage
  (`anchor`, `dataset`, `tester`, `gen`, `detail`, `video`) and resuming safely from
  `stage.json`/`grade/<stage>/*.json` receipts already on disk — no separate cursor file,
  never re-plans/re-runs/re-grades a stage with current evidence. `--import-checkpoints
  <dir>` is the second entry path: plans `tester` directly against an operator-trained
  checkpoint ladder (MANDATE.md's tier constraint — explicit-tier LoRA training happens on
  operator hardware, outside any pod), skipping anchor/dataset/smoke/train. Full detail:
  `orgs/figment/RUNBOOK.md` (the operator command sequence) and `pipeline/README.md` (the
  pipeline's own map).
- **`detail` and `video` are now real `STAGES`/`GRADEABLE_STAGES` entries**, not side CLIs:
  `detail` always re-detailts a ruled `gen` plan's own kept stills (never an operator glob);
  `video` compiles a Wan 2.2 review-candidate manifest from a ruled `gen` plan's kept still,
  runs it, builds local evidence (assembly, reel derivative, frame extraction), and grades
  every 8th of 81 native frames through the existing identity/judge gate. Run roots default
  to `orgs/figment/runs/<creator>/<stamp>/`, in-repo — `video` refuses to plan outside the
  repository (`_video_authority_root`).
- **One gate writer.** `identity_gate.write_gate_document` is the single writer of
  `gate.json`, shared by `figment_train.py build_grade` and `identity_gate.py`'s own
  plan-independent `run` — every `gate.json` on disk is byte-identical regardless of caller.
  The old SHA-bound `gates.py` `write_gate`/`gate_is_current` pair (a second, incompatible
  schema, zero non-test callers) was deleted; `gates.py` today is only `sha256_file`.
- **One prompt composer.** `_compose_triggered_prompt` is the single place the trigger +
  class clause is prepended, for every prompt that reaches a pod across every stage
  (anchor, dataset, tester, gen, detail, caption trigger clause) — the trigger-word defect
  of 2026-09-07 (tester prompts carried no trigger while the LoRA was trained with one) was
  exactly the failure mode multiple independent composers produce.
- **A plan-time budget preflight** (M2) sums every run a `plan`/`pipeline` call is about to
  write against the arc cap remaining before writing `plan.json`, and refuses unless
  `--accept-budget` is passed; the live per-run guards (`enforce_daily_budget`,
  `enforce_arc_cap`) are unchanged and still the actual authority at launch time.
- **One ledger.** The repo's own `ledgers/cost/` is the single reconciled arc-cap ledger
  (E3) — the runbook no longer points at a private worktree path.
- Pins repaired (F7): `flux2-klein-4B`'s HF rename is resolved in `tensor-pins.yaml`;
  `verify_pins.py` (no `--stage`) reports all 9 stages clean, video pins included (E5).
  Train profile at target (F5): `training.yaml` reads `steps: 3000` (DOP on, a deliberate
  deviation from module 11's own recipe), matching `train/TENSOR-TRAINING.md`'s current
  ruling; the checkpoint ladder is 12 (11 intermediates + final), screened by the tester,
  never defaulted to the final step.
- Qwen3-VL auto-captioning (F4) is implemented as a pinned pod job
  (`build_training_set.py`'s `qwen3vl_caption_job`) rather than the earlier
  `NotImplementedError` stub. The skin-texture style LoRA (F3) is wired as a per-plan
  `--style-lora`/`--style-lora-strength` flag on `gen` (M3 — not a persona fork), so an A/B
  is two `gen` plans on the same persona.

## Next

1. **Studio: G1 before G2** (per `docs/figment/AUDIT-2026-09-15.md` §G). G1 — a route that
   renders an existing `grade/<stage>/` board and writes the same rulings JSON
   `apply-rulings` already consumes (`decided_by` from the verified session, `decided_at`
   from the server clock, keep/cull + all seven axes) — needs no new execution authority
   and unblocks Studio recording a real ruling. G2 — launching a prepared plan's own
   recorded argv — stays deferred behind the four preconditions
   `2026-09-12-overall-plan-review.md` names (owned host/environment, spend bound,
   sole-launcher operation, real passkey admission).
2. Run creator-001 through a live `pipeline --creator creator-001` end to end at least once
   with real operator rulings at each gate, to prove the eight-stage chain (not just its
   fixture tests) against the current 3000-step/DOP train profile.
3. Resolve the three placeholder `gate.yaml` thresholds (`identity_gate.age_delta_max_years`
   / `gloss_max`; `judge.skin_realism_min` / `gloss_max` / `artifacts_max`) — calibration
   already ran and reported honestly that these do not separate any evidence set.

## Blocked / open gaps

- **No accepted checkpoint yet for creator-001.** Every historical tester candidate (Track-1
  2000-step run, train-first 1250-step run) was culled or superseded before this arc's
  3000-step/DOP profile landed; `grade/tester/accepted-checkpoint.json` does not exist for
  the current profile, so `gen`/`detail`/`video`/the deliverable have never run against it.
- **Studio still cannot launch a run or record a ruling** (`docs/figment/
  AUDIT-2026-09-15.md` §G) — it prepares plans and reads evidence, nothing more. See "Next"
  item 1.
- **The qwen3vl caption pod job has never run live** — implemented and unit-tested, no pod
  receipt exists yet.
- **Video has never run live** — `video_manifest.py`/`frame_assemble.py`/`frame_extract.py`
  are wired into `pipeline` and fixture-tested, but no real Wan 2.2 pod has rendered a
  candidate for creator-001 yet.
- **`figment_train.py` has not been audited for Windows MAX_PATH.** `video/`'s own
  extended-length (`\\?\`) path handling (F6b) does not extend to `figment_train.py` itself;
  a run root deep enough could still push a `grade/<stage>/*.json` path past 260 characters.
- **`ADMISSION_SHA256` in `expand/local_omnigen2_runtime.py` is dead in practice** — the
  OmniGen2 branch it belongs to is closed without a paid retry (`docs/figment/
  AUDIT-2026-09-15.md` §B.5); the constant still has an in-module caller so it was not
  pruned, but nothing upstream of it plans or runs.
- **Stages 8–9 (post & measure, optimise) blocked on operator provisioning**: an Instagram
  professional test account, the Meta app + OAuth grant (Test 0), and Fanvue written
  confirmation are all still outstanding. The explicit tier is additionally blocked on an
  owned GPU (MANDATE.md's tier constraint keeps unclothed generation/training off rented
  compute).
- Three `gate.yaml` thresholds remain unvalidated placeholders — see "Next" item 3.

## Reading order

`MANDATE.md` → `pipeline/GUARDRAILS.md` → `pipeline/README.md` → `RUNBOOK.md` → this file →
`contract.md`. See `_index.md` for the full map.

## History (2026-09-03 through 2026-09-07, pre-pipeline-command arc)

The detailed night-by-night log of the pre-`pipeline` arc — expansion-02/03 shelved,
Track-1 (module-for-module replication) trained and tested at 2000 steps, the "gate before
eyes" ruling, the bake-off, train-first (Path-A: r24 method 4 + r21 DOP) landing at 1250
steps with a trigger-word defect found and fixed — is preserved in git history for this
file (`git log -p -- orgs/figment/STATE.md`) and in `orgs/figment/pipeline/README.md`'s
"Live-proven runs to date" table, rather than duplicated here. Read that table for exact
pod IDs, costs, and verdicts through 2026-09-07; everything after 2026-09-07 up to this arc
(the `pipeline` command, `detail`/`video` as stages, the pin/train-profile/caption/style-LoRA
fixes, the one gate writer, the one ledger) is summarized in "Now" above and dated in
`git log --oneline 701abe22..HEAD`.
