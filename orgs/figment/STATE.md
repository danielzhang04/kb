# figment — STATE

_Updated: 2026-09-03_

## Now

- **Design spec written** and awaiting operator review:
  `docs/superpowers/specs/2026-09-03-figment-creator-001-design.md` — creator-001 end to end
  (stages 1–9, voice, explicit-tier machine, dashboard decision), with a 16-phase build order.
- Anchor closed. Reference set of record is `g01, g02, g07`, in that order (identity-spec §Reference
  set of record, operator 2026-09-03 07:05). No composites — all composite cells were judged off on
  second look and scrapped; composite runs 01–03 stay on disk only as evidence of the klein
  reference-order and face-pixel-density findings.
- Research r1–r19 complete and claim-checked in `research/`, including the 10sorlabs package audit
  (r14/r15: workflows, settings, caption doctrine, dataset-tester, SOP compliance rejections).
- Infrastructure in place on `claude/figment`: pod harness with spend guards, HTTP transport, upload
  and artifact paths, calibration grid driver, training scaffolding, `identity_check.py`, and the
  FYT-ported review trio (`qa_stamp.py`, `blind_pool.py`, `build_grading_board.py`).
- Model decisions: FLUX.2 klein 4B **Base** for identity (Apache-2.0), Z-Image Base as the aesthetic
  challenger, Wan 2.2 TI2V-5B for the video proof, diffusion-pipe as the trainer.

## Next

1. P0 — clear the harness baseline and the expansion-blast-radius defects from
   `pipeline/pod/REVIEW-e-2026-09-03.md` (findings 1, 2, 6, 11, 13, 15, 16, 17, 19 plus the
   finding-5 preflight arithmetic).
2. P1/P2 — `persona.yaml` record schema; expansion-02 manifests, split into 4 pod runs of 18 cells
   (72 total, curated to 40) with `job_timeout_seconds: 120` so the work fits the 60-minute hard cap.
3. P3 — expansion-02 live runs → score → blind board → **GATE A** (operator eye-gate). The run stops
   there. Spend ceiling $3.60 (`--max-usd 0.90` × 4).
4. In parallel and gate-independent: stage-5 pass-chain manifests, stage-7 taxonomy and templates,
   publisher/insights schemas with dry-run fixtures, agent declarations, cadences.

## Blocked

- **Training pod: NOT SAFE TO RUN.** REVIEW-e's verdict stands until findings 3 (a truncated
  `.safetensors` is accepted as success), 4 (one transient proxy error aborts the poll and kills the
  pod), and 5 (the shipped template cannot finish inside its own `max_minutes`) are fixed and
  re-reviewed.
- Stages 8–9 blocked on operator provisioning: an Instagram professional test account, the Meta app,
  and the OAuth grant (Test 0).
- Explicit tier blocked on an owned GPU.
- Fanvue written confirmation still outstanding.

## Open decisions for the operator

The ten questions in §10 of the design spec. The four that gate near-term work:

- Raise `governance/budget.yaml` `daily_usd_limit` (currently 10.00) for run days, or split expansion
  and training across days.
- Approve `TRAINING_MAX_MINUTES: 180` for the training path only, or require checkpoint-resume across
  60-minute pods — a 2 000-step LoRA run does not fit the current 60-minute hard ceiling.
- Whether swimwear/lingerie cells enter LoRA v1 or v2 (spec recommends v2).
- Persona name, handle, home city, bio disclosure line, and link-in-bio door.

## Known gap in the evidence base

`research/r15b-training.md`, `r15b-generation.md` and `r15b-edit-motion.md` (the module-video reports)
did not exist when the spec was written. The spec's training block rests on r15's artefact-derived
numbers instead; LoRA rank, learning rate, batch size and training resolution remain video-only and
are treated as provisional values the dataset-tester arbitrates. Re-check the spec's S3 and S6 blocks
when those reports land.
