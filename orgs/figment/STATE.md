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
