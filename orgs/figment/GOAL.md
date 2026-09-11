# figment — GOAL
_Ruled: 2026-09-06_

## North star
Disclosed AI creator personas, built as a reusable pipeline for the operator: one reference
image -> identity expansion -> persona LoRA -> register lock -> gated images/video -> research-
driven content -> post and measure -> optimise. Deliverable is the pipeline + its tests, driven
entirely by `persona.yaml`; creator-001 is the test fixture, never the thing hand-refined.

## Success conditions
- Track-1 (faithful 10sorlabs replication, Krea-2 LoRA) — PASSED technically (identity-holding
  LoRA, cosine 0.89 at step 1500) but FAILED Daniel's eye-gate 2026-09-06: "kind of close, glossy,
  reads older, inconsistent."
- Automated gate before any board reaches Daniel (`identity_gate.py` facenet floor +
  `vlm_judge.py` headless Claude-vision judge) — PASSED: built, calibrated on 95 images, opus-
  reviewed and folded.
- Bake-off (scored comparison of identity-transfer methods, not chosen by eye) — PASSED as a
  process; the edit-model path itself (Qwen-Image-Edit variants) is EXHAUSTED for identity per
  `pipeline/expand/bakeoff/m1-RESULTS.md` (judge same_person 55-78, waxy skin on every arm).
- Train-first LoRA (anchors + judge-passing cells, DOP) — trained ($2.57) but UNTESTED with a
  correct trigger word as of the last handoff; OPEN.
- creator-002 acceptance fixture (proves the pipeline is not creator-001-specific) — PASSED:
  8/8, on-disk fixture, found and fixed 2 real defects.
- Generalised single-command pipeline (`figment_train.py plan|run|grade|gate|apply-rulings|
  train-first`) — PASSED: hand-written manifests retired, creator-002 differs from creator-001
  by data only.

## Invariants
- creator-001 IS g01 (Daniel's ruling 2026-09-06): the job is identity reproduction, never
  character invention; never swap the identity source without an explicit ruling.
- No board reaches Daniel without clearing the automated identity/age/realism gate first.
- Identity-transfer method choice comes from a scored bake-off, never from eye judgment alone.
- Rented compute prohibits adult content; everything unclothed is generated/trained on operator
  hardware by the operator only. Agents build/test on clothed data.
- Every pod terminated AND verified absent on every exit path; every live run carries `--max-usd`.
- $50 hard cap on the creator-001 arc; zero spend on any platform, ever.
- Never re-run a known-failing recipe "for evidence" — costs real money for no new information.
- T3 human-only: every publish, every account-level change, every live-platform browser session.

## Governing docs
- `orgs/figment/MANDATE.md`, `orgs/figment/pipeline/GUARDRAILS.md`, `orgs/figment/contract.md`
  (figment worktree, branch `claude/figment`)
- `docs/superpowers/specs/2026-09-03-figment-creator-001-design.md`
- `docs/superpowers/plans/2026-09-06-figment-track2-faithful-pipeline.md` (v2, review folded)
- `orgs/figment/pipeline/README.md` — pipeline's own map/state (not aspirational)
- ops `handoffs/2026-09-07-figment-track2-overnight-orphan.md`
