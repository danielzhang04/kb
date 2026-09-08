# Identity and data

Identity begins with a stable reference contract, not a prompt adjective. The frozen persona says early twenties, about twenty-one, and the current tester derives its age text from that frozen `identity.look.age_stage`. The historical five-checkpoint receipt used a literal mid-twenties prompt; that earlier mismatch is preserved as historical evidence, not established as the cause of any age or identity observation. The paired LoRA/control diagnostic used the corrected prompt in both arms, so it cannot isolate wording effects.

The reference set should contain several views with consistent lighting, expression, and adult presentation, plus a small set of deliberately different poses. Store hashes and provenance beside every file. For the next experiment, use `g01` alone as the canonical seed because it is the established primary frontal reference; retain `g02` and `g07` as labeled comparators, since visible similarity does not prove full identity agreement and they may already be present in prior training inputs. A generated passport can be a useful package pattern, but it is not evidence of identity. The 10sorLabs package generates its own anchor and keeps later stages in one model lineage; Figment's anchor crosses model families, which is a structural difficulty identified in [r25](../r25-why-they-can-and-we-cant.md).

The accepted [canonical-seed adequacy audit](../../../../docs/figment/2026-09-08-canonical-seed-adequacy.md)
at `83c00054` leaves that provisional `g01` choice unchanged. Under one fixed
detector setup, `g07` had more face-pixel coverage than `g01`, while `g02` had
less. That measurement does not select an identity source: crop, pose,
lighting, styling, and background also vary. Any source replacement needs a
separately frozen comparison, with one declared reference per condition and
all other generation and review inputs held fixed.

Dataset preparation follows a narrow loop: inspect, remove duplicates and identity-breaking frames, caption observable facts, and record exclusions. Low-denoise fanout is a package-derived idea from [r14](../r14-10sorlabs-package.md), not a guaranteed recipe. Captions should name the trigger and scene facts while avoiding claims that the image cannot support. Full-body and difficult-angle samples deserve separate review because face and clothing errors can be hidden at dataset scale.

| Evidence/status | What it establishes | Limitation |
|---|---|---|
| Package evidence | Passport → fanout → cull → captions → LoRA is a coherent sequence, with settings documented in the derived r15b analysis. | Settings are package-specific and do not prove output quality. |
| Current code | Manifests and approval lineage can freeze inputs and invalidate stale decisions. | Tests do not establish visual identity. |
| Live proof | Five fixed LoRA/control seed pairs completed under one corrected prompt. | Independent and parent resemblance observations disagree; neither is a promotion result. |
| Hypothesis | Cross-model transfer and intervention choice may affect identity drift. | Historical causal suggestions require a new held-out comparison; current code has a FaceDetailer path. |

Decisions: retain the reference contract, keep age text persona-derived, and keep identity review separate from safety review. `g01` is the comparison anchor; `g02` and `g07` remain contextual references. The completed diagnostic used seed 1595 from the prior ladder plus four new-to-that-record seeds, so it is not evidence that every seed or reference is unseen. Measure reference identity, within-batch identity, realism, and apparent adult age independently; do not collapse them into one score. The frontal black-tee and wardrobe-only black-tee images are separately labeled single-input experiments, not replacement anchors or resemblance passes; the observed geometry disagreement is recorded in the [input review](../../../../docs/figment/2026-09-08-input-and-book-review.md). The next pending image comparison is the frozen [age-only versus full-look prompt diagnostic](../../../../docs/figment/2026-09-08-full-persona-look-prompt-diagnostic.md), not a claim that prompt text alone explains identity.

The first admitted local observer run (native V1) is recorded in the [raw reference observations](../../../../docs/figment/2026-09-08-raw-reference-observations.md). It preserves raw detector/recognizer outputs for the declared controls, three single-input images, ten paired files, and three V2 frames without storing feature vectors or a threshold, pass, or approval. Its detector required exactly one face: `g02` was unavailable because multiple faces were detected, and all ten paired files were unavailable because no face was detected. Those nulls limit what can be compared; they do not establish identity, realism, age presentation, or a difference between the paired arms.

The separately reviewed fixed640 observer mode then produced a fresh V2 receipt set for those same 19 inputs and all three references. It applies one detector-only, no-upscale max-edge-640 resize and maps detector landmarks back to original pixels for SFace; every input had exactly one detector face in that run. The V2 raw table is uncalibrated and not comparable with V1 values. It does not reverse the visually rejected frontal-image finding, prove resemblance, rank quality, or alter a gate, threshold, pass, or approval.

The accepted single-seed curation compiler now freezes an input request, the full original `g01` bytes, every derivative image, and every derivative provenance record into a dataset draft. It accepts only a declared first-generation output of that exact `g01` with `training_eligible: true`; that assertion is evidence to be separately reviewed, never an operator approval. Captions are trigger-prefixed, bounded, and copied into numbered sidecars. The curation record binds each train entry's caption, variation, split, source hash, provenance snapshot, and numbered sidecar; it rejects duplicate derivative hashes across train and eval. Derived eval images share `g01` ancestry, so they are within-identity diagnostics rather than independent reference validation. Changes before or during capture that make the frozen request/source evidence inconsistent prevent publication. Later external staging changes are allowed and cannot rewrite the retained snapshots from which the dataset is built.

The historical four original generated candidates remain unavailable as training data. The offline private refusal probe copied their bytes and provenance without edits: wardrobe-only, small-head-turn, and E01 were rejected because `training_eligible` is false. The frontal black-tee record also says false, but failed an earlier first-generation-role check. The current gallery now contains six candidates after two rejected local-Comfy diagnostics; that visibility does not change either local-Comfy image's rejected status or create training eligibility. None produced a dataset, approval, or plan. This establishes a refusal path, not positive data quality: there is still no accepted multi-view, independently reviewed, visually identity-consistent training set.

The accepted experimental compiler at `f6b5096d` and executor at `af7b07bc`
preserve this boundary. They require an exact current curation, 20 or more
reviewed rows including `g01` and 19 distinct first-generation derivatives,
and evidence that remains explicitly non-promotable. The executor defaults to
private offline preparation or a harness dry-run; its explicit live path also
needs a separately fixed parent admission, current cost revalidation, and
staged-inventory verification. There is no eligible 20-row dataset, admission,
or live experimental training. Neither component writes an operator dataset
acceptance, production training plan, checkpoint decision, or LoRA export.
