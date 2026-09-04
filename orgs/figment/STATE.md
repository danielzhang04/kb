# figment — STATE

_Updated: 2026-09-03_

## Now

- **Design spec v2 twice-reviewed and rulings-folded** (in place — still v2):
  `docs/superpowers/specs/2026-09-03-figment-creator-001-design.md` — creator-001 end to end
  (stages 1–9, voice, explicit-tier machine, dashboard decision), 37-phase build order (P0–P16,
  including new P7b/GATE B2 for the production LoRA). Both `REVIEW-*` and `REVIEW2-*` findings and
  partial closures are folded under the operator's rulings of 2026-09-03.
- Anchor closed. Reference set of record is `g01, g02, g07`, in that order (identity-spec §Reference
  set of record, operator 2026-09-03 07:05). No composites — all composite cells were judged off on
  second look and scrapped; composite runs 01–03 stay on disk (`orgs/figment/personas/creator-001/
  composite-0{1,2,3}/run.json`) only as evidence of the klein reference-order, face-pixel-density,
  and pod-timing findings; P1 migrates this evidence into the `batches/<id>/` layout.
- Research r1–r19 complete and claim-checked in `research/`, including the 10sorlabs package audit
  (r14/r15: workflows, settings, caption doctrine, dataset-tester, SOP compliance rejections) and
  **all three r15b module-video reports** (`r15b-training.md`, `r15b-generation.md`,
  `r15b-edit-motion.md`), claim-checked at commit `57221caf` and reconciled into S2/S3/S5/S6.
- Harness at HEAD: fixes committed `4efea0de`/`f5ba643b`; 152 pod+train tests green; REVIEW-e
  findings 1–17 and 20 fixed, **18/19/21 deferred to the remaining P0**. `DEFAULT_MAX_MINUTES` is
  **840** — there is no hard 60-minute global and no `TRAINING_MAX_MINUTES` constant; every manifest
  carries its own bound (expansion-02: 72 min; training: 180 min).
- Infrastructure in place on `claude/figment`: pod harness with spend guards, HTTP transport, upload
  and artifact paths, calibration grid driver, training scaffolding, `identity_check.py`, and the
  FYT-ported review trio (`qa_stamp.py`, `blind_pool.py`, `build_grading_board.py`).
- Model decisions: FLUX.2 klein 4B **Base** for identity (Apache-2.0), Z-Image Base as the aesthetic
  challenger, Wan 2.2 TI2V-5B for the video proof, diffusion-pipe as the trainer.

## Next

1. P0 (T2 build card) — remaining scope only: REVIEW-e findings 18, 19, 21 (1–17/20 already fixed).
2. P1 → P2 → P2R → P3, each under its own T2 build card, in that order (P2R reviews the union of
   P1+P2 at their SHAs and gates only P3). P1: `persona.yaml` schema, reducer, gate writers, safety
   axes. P2: `build_expansion_set.py` + 6 ephemeral-pod manifests (10 cells each,
   `job_timeout_seconds: 300`, readiness 900, `max_minutes: 72`).
3. P3 — expansion-02 live runs → score → blind board → **GATE A** (operator eye-gate). The run stops
   there. Spend ceiling **$6.00** (`--max-usd 1.00` × 6 pods); with $0.87 already spent today, worst
   case is $6.87 against the $10 daily guard.
4. In parallel tonight, each under its own T2 build card: P4b (taxonomy/templates), P4e (agent
   declarations + `orgs/figment/workflows/figment-creator.md`), P4f (`HEARTBEAT.md` cadence rows only).

## Blocked

- **Training pod: conditional.** P0R's sonnet pass now reads training pod **YES with conditions**
  (findings 3/4/5/8 fixed, harness at 152 green). **An opus P0R pass is still owed before any training
  pod runs.**
- Stages 8–9 blocked on operator provisioning: an Instagram professional test account, the Meta app,
  and the OAuth grant (Test 0).
- Explicit tier blocked on an owned GPU.
- Fanvue written confirmation still outstanding.

## Open decisions for the operator

The ten questions in §10 of the design spec. The four that gate near-term work:

- Raise `governance/budget.yaml` `daily_usd_limit` (currently 10.00) for run days, or split expansion
  and training across days — tonight's worst case ($6.87) fits inside the current $10 without a raise.
- Approve the training manifest's own bound (`job_timeout_seconds: 6000`, readiness 1200,
  `max_minutes: 180`) or require checkpoint-resume — there is no global 60-minute ceiling to except
  from (`DEFAULT_MAX_MINUTES` is 840), so no new constant is needed either way.
- Whether swimwear/lingerie cells enter LoRA v1 or v2 (spec recommends v2 — now phase P7b, gated by
  GATE B2).
- Persona name, handle, home city, bio disclosure line, and link-in-bio door.

## Known gap in the evidence base

Closed. All three r15b module-video reports (`r15b-training.md`, `r15b-generation.md`,
`r15b-edit-motion.md`) now exist, are claim-checked at commit `57221caf`, and are reconciled into the
design spec's S2/S3/S5/S6 blocks. LoRA rank, learning rate, batch size, checkpoint cadence, and the
video motion block are no longer video-only estimates; the dataset-tester remains the arbiter of the
final values.

## Current state — 2026-09-03 18:05 (overnight build terminal close)

- **Parked at GATE A (expansion-02 eye-gate).** Batch `orgs/figment/personas/creator-001/batches/expansion-02/`
  stage `awaiting-eye-gate-a`: 60 cells over 6 ephemeral 4090 pods ($2.28, 31 min each), 56 scored raw
  (anchor cosine median 0.68, min 0.09), 4 deterministic no-face quarantined (s034, s035, s040, r020). Blind board
  `board.html` (56 images, local, gitignored) + `blind-key.json` (never shown to the grader). Nothing curated,
  approved, stamped, or trained. Spend card 044ea509 (ops) covers the run; build card b618941b covers P1-P2R.
- **Built and committed on `claude/figment` (HEAD 2d329cb3, unmerged):** research r15/r15b/r16/r17/r18/r19 all
  claim-checked; spec v3 (`docs/superpowers/specs/2026-09-03-figment-creator-001-design.md`, two adversarial
  rounds); plan v2 (`docs/superpowers/plans/2026-09-03-figment-creator-001-p1.md`); harness fixes (REVIEW-e 1-17,20;
  P0R YES); P1 persona contract/lifecycle/gates/7-axis safety rulings; P2 deterministic expansion builder + 6
  manifests (P2R LIVE-SAFE YES); P4b taxonomy + templates; P4e nine agent declarations + workflow DAG; P4f seven
  cadences (armed: false). Suite: 270+ tests green.
- **Spend:** arc $5.13 of $52.85; today $3.16 of $10.00 daily (budget.yaml raised to 10 on this branch by ruling).
- **Next:** operator rules the board (seven axes; adult_read / garment_integrity / real_person_resemblance fail
  closed) → `qa_stamp.py` → `gate.json` GATE A → curated 40 → P5 (opus P0R pass owed) → P7 LoRA v1.

## Update — 2026-09-03 19:20 (operator viewed the GATE A board)

- **expansion-02 FAILED its purpose: identity did not hold across cells** (operator: "90% wrong"; boss sampled six:
  four different women). Root cause: free generation from an empty latent with 180-word scene prompts and the
  three references as side input, plus no register words and profile/back angles with no reference information.
  The package's proven dataset step is anchor img2img at denoise ≈0.23 with short angle/pose templates (r15b
  module 10). Batch kept as evidence only; NOT to be graded or curated. GATE A card 65d8f246 stays open but its
  subject is superseded by expansion-03.
- **Next: expansion-03** — port of the module-10 method to klein 4B Base (anchor as initial latent + reference,
  denoise 0.20-0.35, ≤40-word prompts with register words, small head/gaze/crop/light/wardrobe variations, no new
  rooms, no profiles), 6-cell pilot first, then 30-36 cells, then GATE A on that board.

## Update — 2026-09-03 21:05 — expansion-03 parked at GATE A (supersedes expansion-02's board)

- **Method that worked: Mechanism A** = the verified klein multi-ref EDIT graph (target anchor first as canvas, empty
  latent, full denoise) with ≤25-word edit-grammar prompts ("the same woman as the reference, identical face; <one
  change>; same room, same light"). Pilot A/B: arm B (anchor as initial latent, denoise 0.28-0.35) returned near-copies
  with the requested change ignored; arm A made true edits with identity held. Rotation wording matters: "thirty
  degrees" rendered a full profile; "a quarter turn, face toward camera, both eyes visible" works.
- **Batch `expansion-03`** (`orgs/figment/personas/creator-001/batches/expansion-03/`): 36 arm-A cells (12 templates
  × g01/g02/g07), 5 pods, $1.44 (+$0.16 pilot-B); 35 scored, own-anchor cosine median 0.864 (min 0.673), 19 ≥ 0.836
  (calibrated floor; anchors pairwise 0.886-0.926), 1 no-face quarantined (g01-t09). Blind board 35 cards; stage
  `awaiting-eye-gate-a`. Spend card 57c33efe (ops). Head-turn cells score 0.78-0.83 while reading as the same woman;
  the eye-gate, not the floor, decides them.
- **expansion-02** stays quarantined evidence. Arc spend $8.74 of $52.85; today $5.38 of $10.
- **Next:** operator rules the expansion-03 board (7 axes) → qa_stamp → GATE A → curated set (≥30 target; regenerate
  the culled templates with new seeds if short) → P5 → LoRA v1 with checkpoint ranking.

## Reset — 2026-09-03 22:10 (operator ruling)

- **Operator verdict on expansion-03 at full resolution: mostly trash.** The boss's 24/35 keep grading was done on
  460-px thumbnails and is withdrawn. expansion-02 AND expansion-03 are shelved as datasets (evidence only).
- **Root failure (boss):** the mandate was research → replicate the package's process → trial on our anchors → adapt.
  We read the process, then built our own klein multi-ref variant and spent on it twice; we never ran their pipeline
  once and never ran a LoRA training at all.
- **Track 1 now (faithful replication):** module 10 dataset generator (Z-Image Turbo + Qwen-Image-Edit-2511 +
  Lightning LoRA, their templates, denoise 0.23 refine, face bbox; removal branch excluded) → module 11 training
  (Ostris ai-toolkit headless, Krea-2 RAW if licence/gating allow, rank 32, LR 1e-4, 250-step saves, Qwen3-VL
  captions) → dataset tester (12 branches) → module 09 generation (FaceDetailer 0.15-0.35 + refine). Every stage graded
  by the operator at FULL resolution beside the anchors. Track 2 (Apache port: Qwen-Image / Qwen-Image-Edit) only after
  Track 1 sets the reference.
- Krea-2 is gated on HF: the operator adds a RunPod Secret `HF_TOKEN`; the harness references it by name only.

## Update — 2026-09-03 23:50 — Track-1 ports reviewed and fixed; awaiting delta re-review before the first paid pod

- Ports committed: dataset (e629617e), training (b2c679b9); harness secret refs (52ab87db), ladder budget (fda03ba2).
- Review (codex sol, dbc868c6): LIVE-SAFE NO on all stages, 18 findings. Fix wave: manifests/scripts/bridge/smoke
  (1dc406e9, sonnet) + harness/ledgers (794668c0, codex sol). 458 tests green; smoke, shard-01, train, tester, gen all
  dry-run green. FaceDetailer removed from module-09 generation (no verifiable non-pickle face detector); rest faithful.
- Ledgers reconciled: 09-02 $1.97, 09-03 $4.68, arc $6.65 (midnight provisional duplicate removed). Arc cap enforced
  at $50.00 (contract text) from here.
- Next: delta re-review (in flight) → dependency-smoke pod (1 job, L40S, ceiling $1.41) → dataset shard-01 (10 cells,
  ceiling $2.75) → operator full-res grade → shards 02-03 → training next ledger day.

## 2026-09-03 23:50 — Track-1 dependency smoke PASSED; shard-01 running

- Smoke pod xxviaztv52cxl0 (L40S): readiness 11 min (all node-deps rc=0, all pinned model digests verified), one real
  cell in 36 s, terminate verified, $0.22. Output `runs/out/creator-001-tensor-smoke/c001-tensor-smoke-f01.png`
  1728×2416: front-on dataset portrait with real skin texture, register intact, reads as the g01/g07 woman — the
  first output of this project that looks like the package's. Shard-01 (10 cells, ceiling $2.75) launched 23:49
  under card d126c410 stage 1; operator grades all 11 at full resolution before anything trains.

## 2026-09-04 17:40 — dataset complete; training smoke failed twice; diagnosis in flight

- Dataset (module-10 port): smoke + shards 01-03 = 31 cells on L40S, $0.22 + $0.28 + $0.29 + $0.28; operator graded
  the face cells at full res: "a lot closer", identity not exact, faces glossy, GO to judge at the LoRA test grid.
- Training smoke (50 steps, module-11 port): attempt 1 failed at ComfyUI health (ai-toolkit downgraded PyAV under
  ComfyUI v0.34.0) — fixed: transport = v0.20.1 + requirement floors restored (591e98da, 7fbda213), ~$0.30. Attempt 2
  reached readiness and uploaded the dataset, then every /view poll returned 502 for the whole 40-min window (transport
  server dead during the Krea-2 load), ~$0.90, no training log recovered. Terminate verified both times.
- No third blind run: codex-deep diagnosis + hardening dispatched (ComfyUI --cpu transport, continuous training log +
  heartbeat via /view, cgroup/RAM/VRAM logging, RunPod pod-log capture on failure, ai-toolkit krea2 config check vs the
  pinned commit, pod-class verdict). Today's spend $2.35; arc ≈ $9.0 of $50.

## 2026-09-04 19:05 — first LoRA steps ever taken; publish naming fix; 2000-step ruling

- Smoke #3: failed on a Git-Bash-mangled dataset path (our render bug; guard added bd55b223). Smoke #4: environment OK,
  Krea-2 raw loaded + quantized, 50 steps at 3.85 s/step, loss 4.5e-2 → 7e-2 range, checkpoint saved as the bare
  `creator001krea2.safetensors` — our publish step expected `_000000050` and failed closed (~$0.45). Naming rule
  (matches the package's tester list): intermediates `<trigger>_<step:09d>`, final = bare trigger name.
- Ruling: full run at 2000 steps / 250-step saves (8 checkpoints) tonight — 3000 steps at 3.85 s/step is ~3.2 h on an
  L40S, over the 180-min marker window and the daily budget; revisit 3000 on a fresh budget. Smoke #5 (100 steps)
  proves the publish path before the full run. Today's spend ≈ $2.9.

## 2026-09-04 19:40 — training path PROVEN (smoke #5); full 2000-step run + tester launched

- Smoke #5 (pod 9dd4nur6in3hqa, $0.30): 100 steps at 3.8 s/step, intermediate `creator001krea2_000000050` + final bare
  `creator001krea2.safetensors` published and downloaded (228 MB each), log retrieved, terminate verified. Five smokes
  total (~$1.9) bought a proven, instrumented training path: transport v0.20.1 --cpu, requirement floors restored,
  POSIX path guard, streamed log + heartbeat, real checkpoint names.
- Full run launched 19:36 via the chain driver (smoke skipped): 2000 steps / 250-step saves = 8 checkpoints,
  --max-usd 5.85 / 270 min, then the 8-branch tester (--max-usd 2.28). Today $3.18 before the full run.
- Operator rule (memory: figment-pipeline-not-influencer): the deliverable is the pipeline; after this loop closes,
  generalise the chain into `figment train --creator <id>` from persona.yaml, then re-run creator-001 as the
  acceptance test, then fixture persona 002 (task T1-G).
