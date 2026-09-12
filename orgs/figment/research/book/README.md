# Figment research book

This book is a decision record for a fictional adult creator system: a clothed adult
persona whose identity, realism, age presentation, and provenance can be reviewed
independently. Instagram/accounts/posting/optimization remain deferred.

## Current status — 2026-09-11

- **Nonpersona native-source binding**: root accepted v3 at `bb9b8db2` after the final
  mixed-flow fixture repair and a real producer/binder-to-collector/UI join. The accepted
  source binds only an externally attributed `accept-native` ruling to the exact current
  nonpersona C/D/E brief slot and creator, then projects a private-safe native-source snapshot.
  It records planning evidence, not media approval: no authenticated human, real ruling,
  transform, delivery-quality verdict, or delivery exists. The UI says `Recorded plan; scene
  images still need delivery review`. Evidence includes 68 UI tests plus typecheck/build, 53
  distinct Python passing nodes across the relevant receipts, preserved v1/v2 output bytes, and
  a 1/1 isolated cross-language Vitest join. A final independent code/security evidence delta is
  READY for the committed source with no open concrete finding (report SHA
  `ce6d14295effa7d048cfd08ee4f32a09b3f5a4964f5e54035e000928697fa8cc`). See the
  [native-source binding review](../../../../docs/figment/2026-09-11-nonpersona-binding-review.md).
  Root then accepted the direct-NVR still-delivery producer and test at `a0074da8` after independent
  review and repaired-node execution. V1 recorded 36 passes and one fixture-collision skip; V2 was a
  zero-test selector error; V3 passed the repaired node, for 37 distinct passing nodes across v1+v3,
  not one fresh full-suite run. Direct script revalidation passed over the unchanged 32-file fixture.
  The resulting receipt remains `materialized-not-reviewed`, `not_promotable`, and `not-assessed`.
  The next dispatched slice was accepted after one real inherited Windows path-boundary repair:
  root accepted the ruling and tests at `57590274`. The fresh combined V2 run passed 107/107
  (35 content-brief and 72 ruling tests), with all 13 pins and the paid ledger unchanged. The
  read-only ruling binds an external assertion to the current delivery receipt/output/brief/creator/
  slot/full transform and six fresh criteria, but always returns `not_promotable`. It does not
  authenticate a human, approve real media quality, or create a delivery. The old helper pin makes
  derived native records stale; fresh preparation is required before retained/NVR/delivery reuse.
  See the [delivery-ruling acceptance checkpoint](../../../../docs/figment/2026-09-11-nonpersona-delivery-ruling-review.md).
- **Repair diff `150978d8..ec58decf`** (Studio, video terminal authority, motion-source
  binding, HTTP surface): reviewed **READY**, full video suite 187 passed in 392.98s. See
  the [repair checkpoint review](../../../../docs/figment/2026-09-11-repair-checkpoint-review.md).
- **Studio stored-plan inventory/scope server slice**: reviewed **READY**, landed locally
  at `749abdca`. See the [inventory server review](../../../../docs/figment/2026-09-11-studio-inventory-server-review.md).
- **Studio UI (`StudioGenPlans`)**: 41 component tests, 33 workspace tests, a real
  planner/API/UI join pass, and typecheck/build all passing, reviewed READY. See the
  [Studio resume UI review](../../../../docs/figment/2026-09-11-studio-resume-ui-review.md).
  This bounded slice is complete; full Studio input/launch/review remains incomplete.
- **Identity/coverage diagnostic (V4, ten clothed images, original checkpoint)**: completed
  with independently verified pod teardown; estimated cost $0.247567. Root and an
  independent Opus review agree the LoRA condition shows stronger resemblance cues to
  `g01` than the no-LoRA control, but every output still misses shoulders-up framing and
  facial proportions still differ from the reference. See the [held-out diagnostic review](../../../../docs/figment/2026-09-11-heldout-diagnostic-review.md)
  for the full visual assessment and for two rejected reviewer batches (image/label
  misbinding, not counted as votes). Do not infer a precise age from this evidence.
- **Face-coverage/drift audit**: run and reviewed (33/33 records; two independent
  `claude-opus-5` visual reviews of the rendered QA sheets). It supports further
  investigation of face coverage but rejects blanket crop-based training on this set, given
  a recurring proportion drift (fuller lips, wider lower face) and the canonical reference's
  own limited detail. A low-concern shortlist (`pilot-05`, `expansion-07/11/15/18`, `g01`)
  was flagged for further full-image inspection; at that audit stage this was not yet a
  training selection or retrain decision. The subsequent five-row selective crop/caption
  intervention described next drew on this shortlist, and `g01` itself remained uncropped.
  See the [face-coverage review](../../../../docs/figment/2026-09-11-face-coverage-review.md).
- **Selective crop/caption/seed dataset change and new checkpoint**: five of the twenty
  accepted training rows received matching 512-square selective crops and revised
  captions, motivated by the face-coverage audit; the other fifteen rows and both
  eval-only rows (`pilot-03`/`pilot-06`) are unchanged. The crop/caption source plus an
  optional pinned `process.training_seed` field landed locally at `dca886ec` (94 tests
  passing in 55.66s), with independent Opus review READY WITH COMMENTS and no blockers.
  See the [selective crop source review](../../../../docs/figment/2026-09-11-selective-crop-source-review.md).
  A predeclared 1250-step training run using that dataset change completed at 09:31:54 UTC;
  all five resulting checkpoints were downloaded and hash-verified, and an independent
  provider query returned no active pods at 19:11 UTC, for an estimated cost of $2.387633.
  This is a combined crop/caption/seed intervention against an unseeded historical
  baseline, not an isolated crop causal claim, and it reused the existing diagnostic set
  rather than establishing fresh generalization evidence. A further ten-image LoRA/base
  diagnostic against this new checkpoint, using the identical V4 manifest, seeds, prompt,
  and tester pins, ran on pod `h4sqcy2ewe3g8p` and completed at 19:27:40 UTC, pod removed,
  for an estimated $0.224635; an independent provider query returned no active pods around
  19:30 UTC. Root reviewed all ten new images plus the five historical LoRA images: all ten
  new images miss shoulders-up framing, are adult and clothed, and show no obvious gross
  garment or anatomy failure at displayed resolution, with no material identity improvement
  over the historical checkpoint. Three blinded `claude-opus-5` reviews were mixed and weak
  (the first two lean historical, the third leans new/tie on image `271828`); root rejects
  the framing-pass claim for the base-model control at seed 271828, since it shows
  torso to elbows. Neither LoRA image at that seed passes framing. The technical image-binding audit passed all 252 of 252 checks at 19:53 UTC; see
  `MAIN/_private/figment-selective-crop-heldout-control-20260911-v1/diagnostic/audit-review-v3.json`.
  Today's three paid rows (training plus both diagnostics) total an estimated $2.859835,
  bringing the arc to about $33.489565/$50. Root has stopped this experiment without
  promoting any media or automatically sweeping other checkpoints, prompts, or training
  recipes; a new discriminating question and bounded plan are required before further
  compute. No checkpoint, still, or video is selected or accepted.
- **Nonpersona content preparation**: an image-free nonpersona preparation slice landed
  locally at `e1ceac49` with reviewed acceptance; see the
  [nonpersona preparation review](../../../../docs/figment/2026-09-11-nonpersona-preparation-review.md).
  No image generation, native rendering, review, slot binding, or delivery approval has
  happened; independent review and the native compiler/tests are in progress and not yet
  complete or accepted.
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
