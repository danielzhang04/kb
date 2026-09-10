# Figment research book

## Current status — 2026-09-09, after final launch review

V2 training and the five-image tester completed with verified receipts and teardown. Root found the final two checkpoints promising; independent review culled all five. The root-attributed all-cull disposition is now recorded, all automatic gates remain false, and no checkpoint, generation source or current video is accepted. Age-classifier estimates do not settle apparent age.

The ten-cell LoRA/base compiler is independently READY and its final V3 native dry run passed. Automatic approval review then blocked the private checkpoint upload before any process or pod started; exact transfer consent is pending. A public-base-only control launched at00:30:40UTC on September10: one seed1595 image, $1.30/60-minute ceiling, no reference image or checkpoint export. The native harness owns its recovery and teardown; no output or final cost is claimed yet. See the [quality decision](../../../../docs/figment/2026-09-09-checkpoint-quality-decision.md), [code review](../../../../docs/figment/2026-09-09-control-rejection-review.md), and [transfer status](../../../../docs/figment/2026-09-09-runpod-checkpoint-transfer-status.md). Earlier experiment descriptions below are historical evidence, not results of this unlaunched V3 diagnostic.

This book is a decision record for a fictional adult creator system. It turns the package review, current implementation, and the completed checkpoint diagnostic into a build order. The target is a clothed adult persona whose identity, realism, age presentation, and provenance can be reviewed independently. Instagram operations remain deferred.

## Evidence discipline

| Label | Meaning | Weight |
|---|---|---|
| Package evidence | Structure inferred from the purchased 10sorLabs panel, read 2026-09-03. | Useful pattern; no redistribution and no unobserved lesson claims. |
| Current code | Behavior and tests in the implementation checkout. | Reproducible locally; not proof of output quality. |
| Live proof | Frozen manifest, receipt, hashes, and observed run on 2026-09-08. | Proves this run's mechanics only. |
| Hypothesis | A proposed cause or next experiment. | Requires a held-out comparison. |

The live checkpoint ladder completed five jobs at 250, 500, 750, 1000, and final 1250. It produced five 1448x2176 PNGs. The historical operator review found them mostly semi-real, inconsistent with the references and each other, and older than the stated target; no candidate was selected or promoted. See [live tester report](../2026-09-08-live-tester.md) and [foundation plan](../2026-09-08-foundation-plan.md).

The later paired final-LoRA versus no-LoRA diagnostic completed five fixed seed pairs under one corrected prompt. One independent visual audit found a clear arm-level identity split and candidate resemblance cues to `g01`; the parent review found `g01` resemblance insufficient and the intended about-21 presentation unestablished. That disagreement is preserved as unresolved, not converted into a pass. The pair is evidence about this LoRA condition and prompt family only; it did not promote a checkpoint or isolate prompt wording. See the [paired diagnostic review](../../../../docs/figment/2026-09-08-paired-diagnostic-review.md).

## Current implementation status — 2026-09-09

As of 2026-09-09, the verified delivery path is persona/curation → accepted 20+ row dataset → train-first → tester ruling and accepted checkpoint → held-out `gen` stills. The built-in direct-`g01` expansion completed all 21 derivatives; root accepted 20 train rows and two retained eval rows for bounded research at 18:14:35 UTC, and materialization verification passed. The first train-first attempt ended before container creation after repeated provider image-pull `unexpected EOF` errors; that dated V1 failure retains its journal-bound teardown and zero-output receipt. V2 plan `920125ce…` excluded the failed host and completed training at 22:37:53 UTC with five checkpoint hashes, final receipt, and verified termination. The original tester subsequently completed at23:03:12UTC with five original PNGs and verified teardown for a $0.379449 estimate. Local-research grading and five attributed cull rulings are recorded; no checkpoint is selected. See the current quality decision above. See the [curation result](../../../../docs/figment/2026-09-09-builtin-dataset-curation-result.md), [v2 independent plan review](../../../../docs/figment/2026-09-09-builtin-train-plan-v2-independent-review.md), [local research review](../../../../docs/figment/2026-09-09-local-research-review.md), [hub lifecycle review](../../../../docs/figment/2026-09-09-train-first-hub-lifecycle-review.md), and [historical v1 bootstrap failure report](../../../../docs/figment/2026-09-09-builtin-training-bootstrap-failure.md). These mechanics do not establish an accepted production LoRA or consistent still set.

Commit `930f2436` adds `grade --judge-backend local-research` to the existing plan-bound board: it runs stage 1 but invokes no external image judge, and every automatic gate result remains false/`unavailable: judge`. A separate attributed research ruling with an explicit override can select a candidate under the existing lineage controls; it does not alter the numeric gate. Commit `2f18495f` adds the reviewed train/tester lifecycle projection to the local hub; neither commit proves visual quality or deploys the hub. The explicit Codex path remains a separate diagnostic, and its exact private-`g01` transport was rejected by approval review; it has not run or been rerouted.

The historical experimental compiler at `f6b5096d` and executor at `af7b07bc`
can prepare a private, non-promotable diagnostic only after a current,
single-`g01` curation and evidence for at least 20 exact training rows. The
executor defaults to local preparation or a harness dry-run; live execution
also needs a fixed parent admission and current revalidation. Neither component
writes an operator acceptance, checkpoint selection, QA stamp, or production
plan; production loaders reject the separate schema. A separately admitted,
one-observation V2 availability probe has now completed ten local fit steps
and written one non-promotable checkpoint. It had no samples, quality review,
checkpoint acceptance, or promotion, and does not change the 20-row gate or
make the current gallery eligible. The accepted 20-row built-in set is bounded research evidence, not production training. See the [local LoRA fit runtime audit](../../../../docs/figment/2026-09-08-local-lora-fit-runtime-audit.md).

Separate branch-specific CPU preflights completed for the current and concise
quality recipes, and the current-caption quality fit completed its fixed
100-step horizon. The first matched current step-20 pair then completed with
two fixed seeds. Its root diagnostic review recorded `continue`; the
independent diagnostic review recorded `stop` because both outputs remained
closer to their matched base faces than `g01` and repeated the eyes-away pose
miss. Neither is human QA, acceptance, promotion, or a quality pass. The
predeclared higher current ladder is stopped while the disagreement and next
protocol are analyzed; no higher current-stage or concise admission has been
issued. See the [training results hub review](../../../../docs/figment/2026-09-08-training-results-hub-review.md).

The [canonical-seed audit](../../../../docs/figment/2026-09-08-canonical-seed-adequacy.md), accepted at
`83c00054`, leaves `g01` provisional. It found that `g07` has more detected
face-pixel coverage, but its other visual differences are confounders; it does
not select a replacement seed. A source-selection comparison would need a
separately frozen, controlled protocol.

An existing local ComfyUI installation and selected pins are inventoried in the
[local capability record](../../../../docs/figment/2026-09-08-local-comfy-capability.md). The repaired local
executor at `41449404` completed one bounded V3 loopback diagnostic after the
earlier startup failures: it wrote one hash-bound 1024-square PNG and verified
all owned processes stopped. The result was visually rejected as a same-person
candidate, so runtime completion did not create a training input, approval, or
export. A later crop diagnostic preserved an output but failed closed at
teardown; a subsequent simple-portrait diagnostic completed and was also
rejected. See the [crop review](../../../../docs/figment/2026-09-08-local-crop-diagnostic-review.md),
[simple-portrait review](../../../../docs/figment/2026-09-08-local-simple-portrait-review.md),
and [runtime audit](../../../../docs/figment/2026-09-08-local-comfy-runtime-audit.md).
Exact Google/g01 export and LoRA export remain blocked, production acceptance
remains an operator decision, and Instagram work remains deferred.

The generated-input gallery is complete at `adcf4591` and independently READY: its 124 affected tests, typecheck, and an actual original-route probe passed. The dashboard production build also passed. These are local implementation checks, with no screenshot, deployment, or quality-acceptance claim. The existing operator runbook's train-first-to-fresh-`gen` bridge is correct and tested at `ea5d2038`; no new bridge is needed. The later ledger-plan binding review covers the explicit canonical-ledger path used by both planning entry points ([review](../../../../docs/figment/2026-09-09-ledger-plan-binding-review.md): 73 tests in 167.86 seconds).

## Reference-conditioned infrastructure checkpoint

The C3 prompt-profile study stopped after both base-image reviews rejected its framing, turn, and identity fit. The OmniGen2 planner, shared runtime, resource observer, admission validator, and controller remain reviewed research infrastructure. The earlier local RAM-floor watches are closed historical readiness evidence with zero executions. Cloud V1 failed during archive bootstrap. V2 completed bootstrap, model download, and `g01` upload before HTTP 400; its body was lost, while pinned-source inspection separately identified missing `resolution_steps`. Both pods were terminated. V3 completed at 08:16:25 UTC with two files, verified termination, and a $0.325452 estimate under the $1.30/60-minute bound. Root and independent original-resolution reviews both stopped before the six-row pilot: smoothing and geometry drift persisted, neither image delivered the requested turn, crops were tight, and seed 481516234 missed the crew-neck. Both remained clothed adult images without quarantine failure, but neither is training-eligible. See the [independent review](../../../../docs/figment/2026-09-09-omnigen2-pair-independent-review.md) and [launch packet](../../../../docs/figment/2026-09-09-reference-pair-launch-packet.md).

| Capability | Current evidence | Remaining condition |
|---|---|---|
| Reference-conditioned execution | Reviewed controller, fixed graphs, verified weights, and one completed two-file cloud run | Both reviews stopped before the six-row pilot; no training-eligible image |
| Consistent training inputs | Accepted bounded 20-train/2-eval first-generation set and verified materialization | Production dependency clearance and broader identity evidence |
| Training and still production | V1 pull failure reconciled; fresh v2 research run has started training under plan `920125ce…` | Final receipt, accepted checkpoint, tester, identity, and intended-age evidence |
| Consistent video | Earlier coherent clip diagnostics | Accepted still identity, requested motion and cross-shot checks |

See [runtime validation](../../../../docs/figment/2026-09-08-local-omnigen2-admission-review.md), [cloud preparation](../../../../docs/figment/2026-09-09-omnigen2-cloud-preparation.md), and the [image-production chapter](image-production.md). OmniGen2's 3B Qwen-derived encoder remains a research-only comparator with no production clearance. The Qwen-Image-Edit-2511 candidate instead records Apache-2.0 component metadata for its pinned 7B encoder and model stack; that metadata is not production licence clearance.

The Qwen single-reference official-conditioning experiment completed two 1392×752 outputs at 16:48:42 UTC for an estimated $0.530662. Termination was verified and root's read-only inventory returned zero pods at 16:50:06 UTC; the reconciled arc is $38.778929/$50 and the daily provider estimate is $0.978544. Root and independent reviews both recorded STOP before expansion. See the [root result](../../../../docs/figment/2026-09-09-qwen-reference-cloud-result.md) and [independent review](../../../../docs/figment/2026-09-09-qwen-reference-pair-independent-review.md).

The built-in direct-`g01` expansion completed all 21 first-generation derivatives; no generated output is chained as an input. Its accepted bounded research curation has 20 train rows and pilot 03/06 retained as eval-only rows. The 21 raw YuNet/SFace identity observations (six pilot and 15 expansion) remain unthresholded diagnostics, not an identity verdict, ranking, or production approval. V1 failed during provider image pull and terminated cleanly as historical evidence. V2 training completed with five verified checkpoints and teardown; the current tester is active, with no tester originals, selected checkpoint, or quality result yet. See the [curation result](../../../../docs/figment/2026-09-09-builtin-dataset-curation-result.md), [v2 independent plan review](../../../../docs/figment/2026-09-09-builtin-train-plan-v2-independent-review.md), [local research review](../../../../docs/figment/2026-09-09-local-research-review.md), and [historical v1 bootstrap failure report](../../../../docs/figment/2026-09-09-builtin-training-bootstrap-failure.md).

The Qwen component metadata is collected in the [component licence evidence](../../../../docs/figment/2026-09-09-qwen-component-license-evidence.md); production dependency clearance remains separate.

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

The package map is documented in [r14](../r14-10sorlabs-package.md); its derived training, generation, motion, and fidelity analyses are in [r15b training](../r15b-training.md), [r15b generation](../r15b-generation.md), [r15b edit and motion](../r15b-edit-motion.md), and [r25](../r25-why-they-can-and-we-cant.md). Those reports include locally inspected graph JSONs and recovered chapter evidence. Current status is dated 2026-09-09; package evidence still does not prove output quality or licensing for every asset.

Final verification at Studio `b7100774`: the two real producer/consumer joins (train-first to fresh generation, and approved generation to video upload) also passed after the ledger fix: **2 tests in 34.20 seconds**. These are local fixture-based integration checks, not accepted image-quality evidence.
