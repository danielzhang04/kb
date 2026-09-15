# Checkpoint quality decision: retain evidence, leave unselected

Decision by `codex-worker/root`, 2026-09-09, under standing user delegation for bounded fictional-adult research. No user impersonation or production acceptance.

The 1250-step training run and five-image tester succeeded operationally. They have verified receipts, artifact hashes and pod termination. They do not establish the required canonical identity and about-21 presentation. No checkpoint is selected for normal generation.

Root's original-resolution review rejected steps 250/500/750 and initially found 1000/final increasingly plausible against g01. A fresh independent reviewer, without those notes, culled all five. The independent reviewer sees a different face, with the last two internally consistent but still insufficiently matching the canonical reference and target age. Root re-inspected g01 and final; the final remains a promising diagnostic candidate, while identity acceptance is unresolved. Both observations remain intact. This is a conservative selection decision, not a fabricated unanimous visual finding.

Evidence:

- Original root notes: `MAIN/_private/figment-builtin-tester-root-visual-notes-20260909-v1.json`, hash-bound to all five PNGs and g01.
- [Independent visual review](2026-09-09-builtin-tester-independent-visual-review.md): six originals covered, all five outputs culled.
- Actual immutable v2 plan SHA `920125ce7e543c95b62d3d808675ebbc5b419fcb2da4e55d6f853518b8343ec3`; final tester receipt SHA `8ba38ab34ccb2452bdde2c887b25b3a80fce04a76014bf4afc5caaba9f342120`.
- Local-research evaluation subject SHA `e471aa29b8ec9898341e77e74c3e0dbe1a2219471ac39e00b3651bfe3500fdac`. All five automatic gates are false, with no external image-judge invocation. The face-size floor fails all five; early checkpoints also fail the local identity threshold.
- Final checkpoint SHA `070b0e639e68babaf7a650c0ac7e1b460a53ef8aca1fda7bfd73057e680cb9a0`, 228587800 bytes. This is the diagnostic candidate, not an accepted checkpoint.

Age-classifier output cannot settle the dispute: the canonical reference itself scores about 30 while the user intends about 21. Apparent age is uncertain. Adult-read safety and compatibility with the requested age presentation are separate judgments. Hands are outside these frames, so this set establishes no hand-generation performance.

## Next discriminating experiment

Use the existing frozen held-out diagnostic protocol: final checkpoint versus no LoRA, five fixed seeds, the current tester prompt, the same pinned Turbo base and graph. The control bypasses the LoRA node for both model and text-conditioning paths. Ten cells, non-promotable, maximum $2.50 / 115 minutes after actual-source review and budget/inventory preflight. Four seeds extend beyond the single checkpoint-test seed; this does not test different poses or scenes. The first pair also checks reproducibility of the final tester condition.

If both arms are similar, investigate whether the learned weights have meaningful effect before retraining. If the LoRA changes identity consistently but remains off-reference, examine the training dataset and train/serve differences. Preserve negative controls and all failures. Normal gen and video require supported source lineage; the diagnostic does not manufacture it.

## Train/serve audit and unresolved hypotheses

A separate read-only Sol audit inspected actual training config/captions/logs, checkpoint headers and PNG-embedded executed graph. It found no manifest-versus-executed-graph substitution error. Final metadata records the intended checkpoint, LoRA strength 1.0, current prompt, seed 1595, 1448x2176, four steps, res_2s/beta. All five headers report expected Krea2 steps; final has 256 A plus 256 B BF16 diffusion tensors at rank 32, with no CLIP tensors.

Training uses pinned Krea2 Raw BF16 with internal qfloat8 quantization; serving uses the pinned Turbo FP8 artifact. Raw-to-Turbo is an intentional current recipe, but its causal effect is unproven. Training dynamically loaded Qwen3-VL-4B-Instruct and Qwen-Image VAE without exact revisions recorded; serving uses pinned converted artifacts. Equivalence is not established by this audit.

All 20 training captions start with the trigger plus `woman` and omit age wording. The tester adds repeated age/adult-anatomy wording, a fixed black-top close-up and a different aspect ratio. After the LoRA/base control, a matched shorter prompt and, if technically compatible, matched Raw/Turbo serving can isolate those hypotheses. Do not change all variables together. The displayed clip strength is unlikely causal because no trained CLIP delta exists in the checkpoint.

## State at writing

The actual local review board is complete. Rejection-persistence and diagnostic-compiler code are under final independent review. No all-cull rulings have been applied yet and no paid diagnostic has launched. Later actual receipts/rulings supersede this dated preparation snapshot.

At 23:50 UTC the reviewed CLI applied all five root-attributed culls successfully. Rejection lineage SHA da60f6bef193f8be8bd31af63af3712e021ad729b03bcbf0d5d44371fa56261a binds the same evaluation subject. No approval files or checkpoint selection exist. Final compiler/code review is READY; V3 actual offline preparation and dry run passed. Paid diagnostic launch is still pending fresh preflight at this timestamp.
