# figment — STATE

_Updated: 2026-09-16_

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
- **One prompt composer per era.** `_compose_triggered_prompt` is the single place the
  persona's trigger is prepended, for every prompt that reaches a pod once a LoRA exists
  to invoke (`tester`, `gen`, `detail`, the caption trigger clause) — the trigger-word
  defect of 2026-09-07 (tester prompts carried no trigger while the LoRA was trained with
  one) was exactly the failure mode multiple independent composers produce. `anchor` and
  `dataset` generate the training material itself, before any LoRA exists, so they
  deliberately do NOT route through it — they compose from `persona.identity.look` via
  `_compose_look_clause` instead, a categorically different clause, not a fourth
  independent trigger composer (see `_compose_triggered_prompt`'s own docstring).
- **A plan-time budget preflight** (M2) sums every run a `plan`/`pipeline` call is about to
  write against the arc cap remaining before writing `plan.json`, and refuses unless
  `--accept-budget` is passed; the live per-run guards (`enforce_daily_budget`,
  `enforce_arc_cap`) are unchanged and still the actual authority at launch time.
- **One ledger, resolved by precedence.** `configured_ledger_dir` (E3) is the single
  resolver every plan/run goes through: an explicit `--ledger-dir` wins first; then
  `KB_LEDGER_DIR`; then the managed OPS worktree if present on this machine
  (`dashboard-ops/ledgers/cost`); the repo's own `ledgers/cost/` is the last-resort
  fallback only. Per CLAUDE.md's branch rules, real cost rows are a coordination write and
  live on branch `ops` — this repo checkout carries none of its own.
- Pins repaired (F7): `flux2-klein-4B`'s HF rename is resolved in `tensor-pins.yaml`;
  `verify_pins.py` (no `--stage`) reports all 9 stages clean, video pins included (E5).
  Train profile at target (F5): `training.yaml` reads `steps: 3000` (DOP on, a deliberate
  deviation from module 11's own recipe), matching `train/TENSOR-TRAINING.md`'s current
  ruling; the checkpoint ladder is 12 (11 intermediates + final), screened by the tester,
  never defaulted to the final step.
- Qwen3-VL auto-captioning (F4) is now live-proven, not just implemented: 09-16 pod
  `symlq3jynb83a8` ($0.12) produced `captions.json` (32 captions) in <2 min after three
  earlier live failures were each found and fixed in order (zero-byte `_images.ready`
  sentinel rejected by upload preflight; pod had no python deps and no fetchable log;
  `dtype=float8` passed to `from_pretrained` — module 11's setting is quantize-time only,
  fixed to load bf16). The skin-texture style LoRA (F3) is wired as a per-plan
  `--style-lora`/`--style-lora-strength` flag on `gen` (M3 — not a persona fork), so an A/B
  is two `gen` plans on the same persona.
- New driver capabilities (2026-09-16, RUNBOOK): `--retry-failed` (verified-teardown
  zero-output transport/placement failures; never-created capacity 500s bounded separately
  at 8 attempts), `--retry-caption-after-fix <reason>` (job-class caption failures after a
  committed fix, cap 4), a `refused` state for pre-launch budget/arc refusals (never consumes
  an attempt), and the harness diagnostics dir allow-listed as bookkeeping (`_harness/`,
  `_training.log`, heartbeat).

- Spend as of 2026-09-16: today's work ≈ $8.1 of the operator's $20 session approval; arc
  total ≈ $44.2 of the $60 `ARC_CAP_USD`.

## Next

1. **Studio: G1 before G2** (per `docs/figment/AUDIT-2026-09-15.md` §G). G1 — a route that
   renders an existing `grade/<stage>/` board and writes the same rulings JSON
   `apply-rulings` already consumes (`decided_by` from the verified session, `decided_at`
   from the server clock, keep/cull + all seven axes) — needs no new execution authority
   and unblocks Studio recording a real ruling. G2 — launching a prepared plan's own
   recorded argv — stays deferred behind the four preconditions
   `2026-09-12-overall-plan-review.md` names (owned host/environment, spend bound,
   sole-launcher operation, real passkey admission).
2. Operator raises `governance/budget.yaml`'s daily limit (≥ 22 today) so the ceiled 3000-step
   train ($15.73, $6.20 already spent today) can launch against `live-20260916b`'s 32-cell
   accepted dataset — the preflight refused it (recorded as `refused`, no attempt consumed).
   Once trained: smoke-train precedent (pod `bwdhqfvt72a0d9`, $0.27, 50-step checkpoint +
   final) already proves the launch path; then tester → gen → detail → video completes the
   first live end-to-end chain against the 3000-step/DOP profile.
3. Rule the `full`-framing face-px floor (`identity.floor.min_face_px.by_framing` has no
   `full` entry today; 10 `live-20260916` full cells failed only the 600px default floor).
4. Resolve the three placeholder `gate.yaml` thresholds (`identity_gate.age_delta_max_years`
   / `gloss_max`; `judge.skin_realism_min` / `gloss_max` / `artifacts_max`) — calibration
   already ran and reported honestly that these do not separate any evidence set.

## Blocked / open gaps

- **No trained checkpoint yet for creator-001's current dataset.** A 32-cell accepted
  training set now exists (`live-20260916b`, gate 32/60, captioned via the live qwen3vl pod)
  and a 50-step smoke train completed clean (pod `bwdhqfvt72a0d9`, $0.27), but the full
  3000-step train was REFUSED at the plan-time budget preflight (ceiling $15.73 vs $6.20
  already spent + $10.00 daily limit) — see "Next" item 2. Earlier candidates all superseded:
  Track-1 2000-step, train-first 1250-step, and two 2026-09-15/16 dataset attempts —
  `live-20260915` imported-ladder tester (5 candidates, gate 0/5, $0.3346); `live-20260915b`
  klein-multiref dataset (30 cells, gate 0/30, identity_own median 0.61 vs floor 0.7907 —
  root cause was the composer's text description overriding the reference latents, fixed but
  not re-run live); `live-20260916` first qwen-edit dataset pass (60 cells, gate 18/60, all
  16 close-framing misses and all 10 full-framing misses were face-px floor issues, not
  identity) — superseded by `live-20260916b` above after tightening the loose face-framing
  prompt rows.
- **Studio still cannot launch a run or record a ruling** (`docs/figment/
  AUDIT-2026-09-15.md` §G) — it prepares plans and reads evidence, nothing more. See "Next"
  item 1.
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
