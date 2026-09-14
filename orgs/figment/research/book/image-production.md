# Image production

## Current status — 2026-09-14

The public-base prompt-span diagnostic is terminal: all four images failed tight
shoulders-up framing, with no clear paired improvement at either fixed seed. All
four appeared adult and clothed, but that safety observation does not establish
identity, realism or delivery quality. The earlier RTX square diagnostic also
failed both framing cases. Its hardware change limits a height-only comparison;
the later within-run span test used fresh baseline/treatment pairs. Removing the
span also shortened the prompt and reduced repeated age wording, so even a positive
result would not isolate body semantics alone. No retry or promoted setting follows.
See the [terminal diagnostic](../../../../docs/figment/2026-09-13-prompt-framing-diagnostic-plan.md).

The accepted manual **Check current source** action can observe the configured
source behind an exact prepared plan. It does not render, launch, select a
checkpoint or write a ruling, and all three launch/quality/atomic-snapshot claims
remain false. This local Windows capability closes a software journey while actual
creator-media quality remains open; see the
[source-check guide](../../../../docs/figment/2026-09-13-current-source-reader-guide.md).

### September 11–12 identity and framing findings

The September 11 selective-crop/caption/seed training run and paired ten-image diagnostic completed with
verified technical bindings. All ten new images missed shoulders-up framing, and root found no
material identity improvement over the historical checkpoint; blinded reviews were mixed and weak.
No checkpoint or held-out creator still is accepted. Because the intervention changed crop, caption
and seed together and reused the existing diagnostic lineage, it does not isolate a causal image-
production improvement. Technical binding, process success and Studio display tests do not resolve
identity, realism, apparent age, framing or production acceptance. See the
[September 12 plan review](../../../../docs/figment/2026-09-12-overall-plan-review.md).

### Historical September 9 launch checkpoint

V2 training and the five-image tester completed with verified receipts and teardown. Root found the final two checkpoints promising; independent review culled all five. The root-attributed all-cull disposition is now recorded, all automatic gates remain false, and no checkpoint, generation source or current video is accepted. Age-classifier estimates do not settle apparent age.

The ten-cell LoRA/base compiler is independently READY and its final V3 native dry run passed. Automatic approval review then blocked the private checkpoint upload before any process or pod started; exact transfer consent was pending at that checkpoint. This is a historical blocker, not the current source-check or media work queue. The public-base-only control's current state is recorded in the [book README](README.md); it exports no private weights or images. See the [quality decision](../../../../docs/figment/2026-09-09-checkpoint-quality-decision.md), [code review](../../../../docs/figment/2026-09-09-control-rejection-review.md), and [transfer status](../../../../docs/figment/2026-09-09-runpod-checkpoint-transfer-status.md). Earlier experiment descriptions below are historical evidence, not results of this unlaunched V3 diagnostic.

### Production doctrine

Image production is a chain of bounded transformations: choose the frozen identity condition, render a scene, optionally repair localized defects, then review the output at original resolution. The package describes a passport prompt with pose, face inventory, skin texture, wardrobe, camera, and lighting clauses. Its later prompt guide adds pores and imperfections but also beauty-smoothing language. Figment should retain concrete texture and wardrobe descriptions while treating gloss reduction as an experiment rather than a cosmetic default.

The proposed path is anchor → base render → identity/detail pass → provenance and safety checks. Any repair must preserve the original beside the derivative and record which region changed. Current code already contains a MediaPipe/FaceDetailer path, so the live result cannot be attributed to a missing repair pass: the five tester images were raw outputs before downstream generation passes. The inspected dataset graph used a low-denoise edit pass at `0.23` and retained DetailBoost; the generation graph used the trained identity LoRA at strength `1.0`. These settings describe the current graph lineage, not a quality guarantee. A face detector or landmark pass can locate review regions; [Google's MediaPipe Face Detector API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/FaceDetector) documents detection as a task, not an identity verifier. It can support routing and crop checks, while the identity decision remains human and comparison-based.

ComfyUI workflows should be treated as versioned data. The [official ComfyUI OpenAPI schema](https://github.com/Comfy-Org/ComfyUI/blob/master/openapi.yaml) shows workflow JSON as an explicit request object, which supports storing node graph, inputs, and output metadata together. The schema does not prove that a graph produces a good face.

| Evidence/status | What it establishes | Limitation |
|---|---|---|
| Package evidence | Prompt structure, edit pass, and face-repair concepts recovered from the package analysis and inspected graphs. | No package quality proof; licensing remains asset-specific. |
| Current code | Trigger, LoRA strength, checkpoint steps, receipts, and hashes are inspectable. | Wiring correctness is not visual quality. |
| Live proof | The paired final-LoRA/no-LoRA run produced ten original-resolution, clothed adult portraits. | The independent review saw candidate resemblance cues; the parent found resemblance and target-age evidence insufficient. No arm was promoted. |
| Hypothesis | A localized repair or skin-texture intervention could improve realism. | This remains a historical hypothesis from r20/r25, not a current causal finding; test it on the same cells with a control. |

Decisions: keep raw outputs immutable, preserve derivatives, and require full-resolution review. The paired LoRA/no-LoRA diagnostic is complete and remains non-promotable; it supplies a bounded condition comparison, not a consensus resemblance decision. The historical full-persona-look proposal changed node 5's prompt while holding the candidate checkpoint and five seeds fixed; its recorded export blocker belongs to that earlier checkpoint, not the current work queue. Separately, the local-Comfy V3 availability diagnostic and later simple-portrait diagnostic completed one image each and were rejected as same-person candidates; the intervening crop output is preserved with its failed-closed teardown state. See the [crop review](../../../../docs/figment/2026-09-08-local-crop-diagnostic-review.md) and [simple-portrait review](../../../../docs/figment/2026-09-08-local-simple-portrait-review.md). A repair or texture intervention would need a separate matched comparison, with identity, realism, apparent age, and artifacts logged separately. Do not treat a polished single image as a promotion case.

Historical status, 2026-09-08: the C3 prompt-profile calibration stopped after its two-image `profile-base` stage. Both reviews found framing, turn, identity, age, and garment misses; no profile-current-20 pair was rendered. See the [profile-base runtime audit](../../../../docs/figment/2026-09-08-local-profile-base-runtime-audit.md).

## Historical reference-conditioned route — September 8–9

That proposed image route conditioned generation on `g01` pixels instead of text alone. Its fixed planner bound a local OmniGen2 research comparator to one experiment: two seeds, 481516234 and 90210, 768-square output, `g01` as the sole reference. OmniGen2's Qwen component had unclear commercial rights, so this was a research comparator; even a good result would not establish commercial clearance. The three public weights were downloaded and fully hash-verified, and the shared engine hooks, observer, admission validator and controller described in [architecture and operations](architecture-and-operations.md) were root-accepted against the named models, reference, template and installed ComfyUI state. This is historical route evidence, not the next queued experiment.

Historical status, 2026-09-09: the local RAM waits ended with zero executions. OmniGen2 V1 failed in archive bootstrap; V2 reached model download and `g01` upload before HTTP 400. Its response body was lost, so pinned-source identification of node 17's missing `resolution_steps` is a separate diagnosis. V3 completed two files and was terminated; both original-resolution reviews recorded STOP before the six-row pilot. Its files are rejected research evidence, not training inputs. See the [independent review](../../../../docs/figment/2026-09-09-omnigen2-pair-independent-review.md).

The Qwen-Image-Edit-2511 one-reference adapter was independently checked against pinned native source and then completed its authorized two-image pair. It uses Apache-2.0 metadata for the pinned Qwen 7B encoder and model components, unlike OmniGen2's 3B Qwen-derived research-only encoder; production licence clearance remains separate for both routes. Root and independent review stopped the Qwen pair before expansion, so it remains rejected research evidence, never a training input or accepted identity evidence. See the [Qwen result](../../../../docs/figment/2026-09-09-qwen-reference-cloud-result.md) and [independent review](../../../../docs/figment/2026-09-09-qwen-reference-pair-independent-review.md).

Historical status, 2026-09-09 22:42 UTC: the accepted bounded research dataset had completed its train-first run and verified teardown. Its tester subsequently completed at 23:03:12 UTC with five PNGs and verified teardown; the root-attributed all-cull was applied at 23:50 UTC, leaving no selected checkpoint. The reviewed [local research board](../../../../docs/figment/2026-09-09-local-research-review.md) prepares diagnostics without an external image judge; every automatic gate row remains false and `unavailable: judge`. An attributed research ruling with an explicit override is a separate candidate-selection decision and does not change the numeric gate. That is a review mechanism, not image-quality or production acceptance.
