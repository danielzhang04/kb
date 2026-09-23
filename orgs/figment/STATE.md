# figment — STATE

_Updated: 2026-09-23_

## Now

- **The full chain is now live-proven end to end, anchor through video.** As of 2026-09-23 every
  stage in `anchor → dataset → train → tester → gen → detail → video` has produced real evidence
  against creator-001's accepted step-2000 checkpoint. `gen` cleared the gate for the first time
  (run1, see below); `detail` and `video` ran live for the first time ever. The gate is proven
  mechanically end to end; content/gate defects remain open on `gen` framing, `detail` skin
  realism, and `video` aspect/motion/detection (see "Next").
- **`gen` default recipe (look-clause prompt, refine denoise 0.35, detailer denoise 0.15) scored
  0/12** (`live-20260916b/downstream/gen/grade/gen/gate.json`, pod `x0lwu992xprg95`, $0.38):
  `identity_own` median ~0.89 (0.769–0.919, fine), but 9/12 rows fail `face_px` (475–592 px
  against the 600 floor — a "waist up" framing problem, not identity) and the 3 rows that pass
  `face_px` fail the judge's `same_person` floor (45, 58, 68 vs 70.2). Three earlier 2026-09-21
  attempts at this stage spent $5.30 across 4 pods for zero output (MediaPipe `regions` DynamicCombo
  encoding bug hit twice, a DNS poll drop, and an upload hang during a Windows host suspend that
  alone cost $4.58 — see "Harness hardening" below).
- **A/B `gen_prompt_style: "trigger-scene"` scored 0/12 and WORSE**
  (`ab-20260922-trigger-scene-2/grade/gen/gate.json`, $0.41): judge `same_person` 30–60 and judge
  `age_delta` 4–10, both worse than the look-clause default above — confirms 10sorlabs' "prompt
  and LoRA must agree": dropping the identity.look clause from the prompt does not help once a
  LoRA already carries that identity.
- **run1 (`gen_prompt_style: "look-clause-close"`, `gen_refine_denoise: 0`,
  `gen_detailer_denoise: 0.20`) scored 3/12 PASS** — the first gen stills ever to clear the full
  gate (`run1-20260923-close-norefine/grade/gen/gate.json`, $0.61). Judge `same_person` median 72
  (35–78 across the 8 rows that reached judge), `identity_own` median ~0.87, `face_px` 548–719.
  4/12 still fail `face_px` (548–588), 3/12 fail judge `same_person` (35–58), 4/12 fail judge
  `age_delta` (judge-reported delta 2–3, over the 1.5 ceiling). The SAME checkpoint's tester pass
  (single 4-step render, no refine/detail) scores judge 88 — the refine+detail passes together
  cost roughly 25–40 judge points versus the tester's own single-pass render.
- **`detail` ran live for the first time: 1/6 pass** (`detail1-20260923/grade/detail/gate.json`,
  pods `w20n3wtn30cceg` ReadinessTimeout dead host $0.87 — now a learned-bad-host per commit
  `c3d0dec6` — and `n93u1vkssd448s` $0.23 for the real run). `d0.15` (denoise 0.15) is the passer
  at judge same_person 78; the `d0.27` variants score worse (same_person 55–62, `skin_realism`
  18–28) — confirms the same "less denoise is safer" direction run1 already found for refine/gen.
- **`video` ran live for the first time: 0/11, "no face detected" on every sampled frame**
  (`video1-20260923/grade/video/gate.json`, pod `x925o3140m34lv`, $0.18, first live Wan 2.2 TI2V
  render — 81 frames at 1280×704, `candidate.mp4` + `reel.mp4` both built). The mechanical chain
  is proven (manifest → render → assemble → reel → extract → grade all ran without error);
  content/gate defects are the open item: the portrait still was rendered landscape, the camera
  tilts so the face drifts toward the top ~25–30% of frame height, the motion instruction ("stands
  still, turns head") was not honoured, the reel crop to 1080×1920 compounds the framing problem,
  and MTCNN (the gate's face detector) misses a face that small/off-center.
- **Training-set drift confirmed** (haiku read of 4 approved `live-20260916b` dataset cells vs
  g01): all four show fuller lips, sharper arched brows, more prominent cheekbones, and smoothed
  skin relative to the anchor — the qwen-edit dataset source's own edit-model signature, which the
  LoRA then learned and gen/detail inherit downstream.
- **Harness hardening (2026-09-22, commits `b2087175`, `e8226acf`, `62ca6f3b`, `30ab4eba`):**
  sliced dual-clock deadlines, a KeepAwake guard, a pod dead-man switch, and socket-level upload
  unblocking — root-caused by the Windows power log to a Modern Standby suspend 19:53→20:05 and
  resume 00:01 on 2026-09-21 that let a stalled upload POST and the harness's own Watchdog both
  silently stretch together (see README's "Open defects" for the full diagnosis).
- **New gen-time flags** (`training_config.py`, `figment_train.py`): `--gen-prompt-style
  {look-clause,look-clause-close,trigger-scene}`, `--gen-refine-denoise`,
  `--gen-detailer-denoise` (0.0 removes the pass from `_gen_workflow` entirely).
  `_revalidate_planned_gen_authority` now also compares `training_input_projection`, fixing a
  pre-existing gap where a `--style-lora` change after planning was not re-checked.

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
- **First creator-001 ladder to clear the full gate** (2026-09-17, run root
  `creator-001/live-20260916b`). 3000-step train (pod `g82uvbgep3ov9q`, L40S, 2h25m, $2.90
  actual vs $15.73 ceiling) produced 12 checkpoints (250…2750 + final, 228 MB each), launched
  after the operator raised `governance/budget.yaml`'s daily limit to 20 on a fresh ledger
  day. Tester (pod `mqhofpqmdvn12x`, $0.43) gated **2/12 pass**: step 2000 (identity_own
  0.895, face_px 689, judge same_person 88) and final/3000 (0.900, 663, 74) — prior best was
  the 1250-step train-first ladder at 0.78. `apply-rulings --checkpoint-step 2000` chosen
  (equal identity to final, stronger judge score); `accepted-checkpoint.json` written,
  `training.yaml` carries `chosen_checkpoint_step: 2000` + sha256 (commit `ee6ce232`).
  Gotcha for any future `governance/budget.yaml` edit: a UTF-8 BOM (from PowerShell
  `-Encoding utf8`) makes the harness's hand-rolled YAML reader refuse with "could not parse
  the complete manifest" — write the file BOM-free.

- Spend as of 2026-09-23: work spend this arc ≈ $19.1; true arc total ≈ $54.3 of the $60
  `ARC_CAP_USD`. The 2026-09-17 lost-ledger-row incident (see prior revisions of this file) is
  no longer blocking — `gen`, `detail`, and `video` have since all run live past the plan-time
  budget preflight.
- `refused` covers any harness exit with no `run.json` and no recovery journal (nothing ran,
  nothing spent), not only budget refusals — e.g. the BOM parse refusal; bounded at 8
  (`MAX_NEVER_CREATED_RETRIES`).

## Next

Recommended angles, in order:

1. **Adopt `gen`'s proven-better recipe as the default**: refine denoise off (0), detailer
   denoise ≤0.20, `gen_prompt_style: "look-clause-close"`. Live-proven by run1 (3/12 PASS, the
   first gen stills ever to clear the full gate) and detail1 (`d0.15` beats `d0.27`: same_person
   78 vs 55–62). This is a config/default change, not new code — the flags already exist.
2. **Fix the dataset source's edit-model bias before the next train.** Haiku's read of 4
   approved `live-20260916b` cells vs g01 shows fuller lips, sharper arched brows, more
   prominent cheekbones, and smoothed skin on every cell — the qwen-edit source's own signature,
   which the LoRA learns and gen/detail then inherit. Two candidate fixes: (a) the
   klein-multiref reference-lock dataset source, already fixed to drop `_compose_look_clause`
   from its prompts (`train/TENSOR-TRAINING.md` P2 table) but not yet live-validated, or (b) a
   module-10 face-crop-conditioned source. Either way, add a dataset-judge axis that scores
   lip/brow drift specifically, so this defect gates instead of passing silently.
3. **Video: three open defects to close before a usable reel.** (a) give the stage a portrait
   resolution profile (e.g. 704×1280) for reels instead of the current 1280×704 landscape
   render; (b) get the motion instruction ("stands still, turns head") actually honoured — the
   camera currently tilts the face to the top ~25–30% of frame height; (c) raise the gate's
   face-detector min-size or feed it upscaled frames — MTCNN missed the face on all 11/11 sampled
   frames of video1 even though the render itself was mechanically clean.
4. **Rulings owed from the operator**: (a) a `full`-framing face-px floor
   (`identity.floor.min_face_px.by_framing` still has no `full` entry — 10 `live-20260916` full
   cells failed only the 600px default floor); (b) whether the judge's `same_person_min: 70.2`
   floor is the right bar for "usable creator" output — run1's 3 passers cluster at 72–78, not
   far above it.
5. **Studio: G1 before G2** (per `docs/figment/AUDIT-2026-09-15.md` §G). G1 — a route that
   renders an existing `grade/<stage>/` board and writes the same rulings JSON
   `apply-rulings` already consumes (`decided_by` from the verified session, `decided_at`
   from the server clock, keep/cull + all seven axes) — needs no new execution authority
   and unblocks Studio recording a real ruling. G2 — launching a prepared plan's own
   recorded argv — stays deferred behind the four preconditions
   `2026-09-12-overall-plan-review.md` names (owned host/environment, spend bound,
   sole-launcher operation, real passkey admission).
6. Resolve the three placeholder `gate.yaml` thresholds (`identity_gate.age_delta_max_years`
   / `gloss_max`; `judge.skin_realism_min` / `gloss_max` / `artifacts_max`) — calibration
   already ran and reported honestly that these do not separate any evidence set.

## Blocked / open gaps

- **`gen` framing/refine defect — mitigated, not yet the default.** The default recipe
  (look-clause, refine 0.35, detailer 0.15) still scores 0/12 live; the proven fix (refine off,
  detailer ≤0.20, look-clause-close prompts) is validated by run1 (3/12 PASS) but not yet made
  the persona/CLI default. See "Next" item 1.
- **`detail` skin realism on the `d0.27` denoise variant** — `skin_realism` 18–28 (floor 31.5)
  on 2 of 3 `d0.27` cells in detail1; `d0.15` is the safer variant pending a broader sample.
- **`video` aspect/motion/gate defects** — see "Next" item 3: landscape render vs. portrait
  reel target, motion instruction not honoured, face detector misses the resulting off-center
  small face. Mechanically proven (video1 rendered, assembled, and graded end to end) but 0/11
  on content.
- **Dataset source carries an edit-model bias** (fuller lips, sharper brows, more prominent
  cheekbones, smoothed skin vs. g01) that the LoRA learns and `gen`/`detail` inherit — see
  "Next" item 2.
- **Checkpoint now selected — trained and gated, not blocked.** Superseded 2026-09-17: the
  32-cell accepted training set (`live-20260916b`, gate 32/60) trained clean at 3000 steps
  (pod `g82uvbgep3ov9q`, $2.90) and the tester ladder gated 2/12 pass; step 2000 is the
  accepted checkpoint (`chosen_checkpoint_step: 2000`, commit `ee6ce232`). Earlier candidates
  all superseded:
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
- **Video ran live for the first time 2026-09-23** (`video1-20260923`, pod `x925o3140m34lv`,
  $0.18) — mechanically clean (81 frames rendered, assembled, extracted, graded) but 0/11 on
  content; see "Blocked" above and "Next" item 3.
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
