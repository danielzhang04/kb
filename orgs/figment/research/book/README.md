# Figment research book

This book is a decision record for a fictional adult creator system: a clothed adult
persona whose identity, realism, age presentation, and provenance can be reviewed
independently. Instagram/accounts/posting/optimization remain deferred.

## Current status — 2026-09-11

- **Repair diff `150978d8..ec58decf`** (Studio, video terminal authority, motion-source
  binding, HTTP surface): reviewed **READY**, full video suite 187 passed in 392.98s. See
  the [repair checkpoint review](../../../../docs/figment/2026-09-11-repair-checkpoint-review.md).
- **Studio stored-plan inventory/scope server slice**: reviewed **READY**, landed locally
  at `749abdca`. See the [inventory server review](../../../../docs/figment/2026-09-11-studio-inventory-server-review.md).
- **Studio UI (`StudioGenPlans`)**: 41 component tests, 33 workspace tests, a real
  planner/API/UI join pass, and typecheck/build all passing, reviewed READY. See the
  [Studio resume UI review](../../../../docs/figment/2026-09-11-studio-resume-ui-review.md).
  This bounded slice is complete; full Studio input/launch/review remains incomplete.
- **Identity/coverage diagnostic (V4, ten clothed images)**: completed with independently
  verified pod teardown; estimated cost $0.247567 (arc $30.877297/$50). Root and an
  independent Opus review agree the LoRA condition shows stronger resemblance cues to
  `g01` than the no-LoRA control, but every output still misses shoulders-up framing and
  facial proportions still differ from the reference. No checkpoint, still, or video is
  selected or accepted. See the [held-out diagnostic review](../../../../docs/figment/2026-09-11-heldout-diagnostic-review.md)
  for the full visual assessment and for two rejected reviewer batches (image/label
  misbinding, not counted as votes). Do not infer a precise age from this evidence.
- **Face-coverage/drift audit**: run and reviewed (33/33 records; two independent
  `claude-opus-5` visual reviews of the rendered QA sheets). It supports further
  investigation of face coverage but rejects blanket crop-based training on this set, given
  a recurring proportion drift (fuller lips, wider lower face) and the canonical reference's
  own limited detail. A low-concern shortlist (`pilot-05`, `expansion-07/11/15/18`, `g01`)
  is flagged for further full-image inspection — not a training selection or retrain
  decision. See the [face-coverage review](../../../../docs/figment/2026-09-11-face-coverage-review.md).
- **Brief text contract**: repaired and independently reviewed at `a3d87a8c`, with 29 Python
  tests, 11 collector tests and a real compiler-to-collector boundary check passing.
  See the [content input contract review](../../../../docs/figment/2026-09-11-content-input-contract-review.md).
  The Studio brief editor remains in design.
- The public sampler/wording comparison and the two-image alternate seed-B control are
  closed lines of inquiry, not reopened by the above.

All dated paragraphs elsewhere in this book, and every report linked under
"Historical evidence" below, describe state at the time they were written and are
superseded by this section wherever they conflict with it.

## Evidence discipline

| Label | Meaning | Weight |
|---|---|---|
| Package evidence | Structure inferred from the purchased 10sorLabs panel, read 2026-09-03. | Useful pattern; no redistribution and no unobserved lesson claims. |
| Current code | Behavior and tests in the implementation checkout. | Reproducible locally; not proof of output quality. |
| Live proof | Frozen manifest, receipt, hashes, and an observed run. | Proves that run's mechanics only. |
| Hypothesis | A proposed cause or next experiment. | Requires a held-out comparison. |

## Governing rules

1. Freeze persona, references, prompt, seed, model, node, and checkpoint in a manifest before a run.
2. Keep identity, realism, apparent age, clothing safety, and temporal consistency as separate review dimensions.
3. Treat costs as estimates until reconciled; unknown native telemetry is unknown, never zero.
4. Use only adult, clothed evaluation material in this pipeline. Explicit work is a separate operator-owned tier.
5. A diagnostic can inform a decision; it cannot silently become approval, publication, or promotion.

## Reading map

- [Identity and data](identity-and-data.md): reference contract, dataset, and identity controls.
- [Training and evaluation](training-and-evaluation.md): checkpoint ladders and held-out tests.
- [Image production](image-production.md): render, repair, and review stages.
- [Video production](video-production.md): start-frame and temporal identity doctrine.
- [Content research](content-research.md): evidence-led topics and measurable experiments.
- [Architecture and operations](architecture-and-operations.md): hub, manifests, ledgers, and gates.

The package map is documented in [r14](../r14-10sorlabs-package.md); its derived training,
generation, motion, and fidelity analyses are in [r15b training](../r15b-training.md),
[r15b generation](../r15b-generation.md), [r15b edit and motion](../r15b-edit-motion.md),
and [r25](../r25-why-they-can-and-we-cant.md). Package evidence does not prove output
quality or licensing for every asset.

## Historical evidence

Chronological detail and superseded test counts live in the dated reports below, not in
this README. Each entry is a pointer, not a retelling.

- **Identity/dataset**: [builtin dataset curation](../../../../docs/figment/2026-09-09-builtin-dataset-curation-result.md) (accepted 20-train/2-eval research rows); [canonical-seed adequacy](../../../../docs/figment/2026-09-08-canonical-seed-adequacy.md) (`g01` remains provisional).
- **Training/checkpoints**: [live tester report](../2026-09-08-live-tester.md) and [foundation plan](../2026-09-08-foundation-plan.md) (first checkpoint ladder, none selected); [paired diagnostic review](../../../../docs/figment/2026-09-08-paired-diagnostic-review.md) (LoRA vs no-LoRA split, left unresolved); [local research review](../../../../docs/figment/2026-09-09-local-research-review.md) and [v2 independent plan review](../../../../docs/figment/2026-09-09-builtin-train-plan-v2-independent-review.md) (V2 training, five checkpoints, root-attributed all-cull).
- **Reference-conditioned generation**: [OmniGen2 independent review](../../../../docs/figment/2026-09-09-omnigen2-pair-independent-review.md) (stopped before the six-row pilot); [Qwen reference cloud result](../../../../docs/figment/2026-09-09-qwen-reference-cloud-result.md) and [independent review](../../../../docs/figment/2026-09-09-qwen-reference-pair-independent-review.md) (stopped before expansion); [component licence evidence](../../../../docs/figment/2026-09-09-qwen-component-license-evidence.md) (metadata only, not clearance).
- **Local ComfyUI runtime**: [local capability record](../../../../docs/figment/2026-09-08-local-comfy-capability.md), [runtime audit](../../../../docs/figment/2026-09-08-local-comfy-runtime-audit.md), [crop review](../../../../docs/figment/2026-09-08-local-crop-diagnostic-review.md), [simple-portrait review](../../../../docs/figment/2026-09-08-local-simple-portrait-review.md) (local executor proven; all visual candidates rejected).
- **Studio/video infrastructure (pre-repair)**: [end-to-end delivery plan](../../../../docs/figment/2026-09-09-end-to-end-delivery-plan.md), [content-asset binding plan](../../../../docs/figment/2026-09-10-content-asset-binding-plan.md), [stage coverage audit](../../../../docs/figment/2026-09-10-stage-coverage-audit.md), [video candidate producer review](../../../../docs/figment/2026-09-10-video-candidate-producer-review.md), [video review preparation review](../../../../docs/figment/2026-09-10-video-review-preparation-review.md) — superseded operationally by the 2026-09-11 repair checkpoint above.
- **Sampling/official audit**: [official sampling audit](../../../../docs/figment/2026-09-10-official-sampling-audit.md) — public-only sampler comparison, closed after both visual reviews stopped it.
