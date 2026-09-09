# Training and evaluation

Train only after the data contract is frozen. The package's useful governing idea is a checkpoint ladder: train, render a fixed tester set at multiple steps, and select from evidence. The recovered module-11 graph uses 12 checkpoint branches, fixed seed `1595`, 1448x2176 output, 4 steps, CFG 1, `res_2s`/`beta`, and denoise 1. These are KREA2 turbo tester settings, not universal defaults. [Hugging Face's current Diffusers LoRA guide](https://huggingface.co/docs/diffusers/en/training/lora) describes LoRA as adding small trainable matrices while keeping base weights frozen; its examples also show that rank, learning rate, steps, and scheduler remain experiment variables.

The current evidence exposes a raw-to-turbo lineage boundary. The live ladder compared existing checkpoints at 250, 500, 750, 1000 and final 1250 steps. The later paired final-LoRA/no-LoRA diagnostic used one corrected prompt and five seeds. Its independent review found a candidate/control identity split and candidate cues compatible with `g01`; the parent found reference resemblance and the intended about-21 appearance insufficient. This unresolved disagreement establishes neither a selected checkpoint nor a visual threshold. The results establish bounded execution and distinguishable conditions, not that 1,250 steps is best or that every learned adapter component worked as intended.

Evaluation needs three slates: training views, a held-out identity slate, and a driver-bound production slate. Keep seeds, prompts, dimensions, base model, adapter, and post-processing frozen within a comparison. Review source, output, and metadata together. A human can judge realism and identity, while automated checks can flag missing faces, dimensions, or provenance; neither replaces the other.

| Evidence/status | What it establishes | Limitation |
|---|---|---|
| Package evidence | Checkpoint comparison is a formal stage in the reference workflow; the recovered graph and r15b analysis provide concrete settings. | Settings are specific to KREA2 and the inspected graph, not portable defaults. |
| Primary documentation | LoRA is lightweight and its parameters need experimentation. | Diffusers examples target other model families and tasks. |
| Live proof | A five-pair final-LoRA/no-LoRA comparison completed under fixed seeds and prompt. | It does not isolate prompt wording, establish a visual threshold, or select a checkpoint. |
| Hypothesis | Full persona-look text may alter this candidate's outputs. | The frozen prompt comparison is pending; it cannot by itself prove a cause of identity or age. |

Decisions: preserve every checkpoint receipt and record a rejection or unresolved review as useful evidence. The final-LoRA/base comparison is complete; `g01` was a visual comparator only, so this text-to-image test did not condition generation on its pixels. One seed repeats the prior ladder and four are new to that record; references may overlap prior training. The pending full-look prompt experiment holds the same candidate checkpoint and five seeds fixed while changing only the prompt clause. No new model should be adopted solely because a citation mentions it; licensing, reproducibility, and measured benefit must all be established. Current implementation entry points include [`load_manifest`](../../pipeline/pod/runpod_run.py#L1112), [`expand_manifest_uploads`](../../pipeline/pod/runpod_run.py#L1217), and [`manifest_job_timeout_seconds`](../../pipeline/pod/runpod_run.py#L1694).

The legacy raw-only identity command has `torch`, `torchvision`, `facenet_pytorch`, and Pillow available in the local Python 3.13 runtime, but it is not an offline scorer: it initializes FaceNet's auto-downloaded VGGFace2 `.pt` weights and DINOv2 through `torch.hub`. Neither has a reviewed local immutable pin in this workflow, and raw-only results would remain observations rather than an approval. Do not run that legacy path against new evidence. The separately accepted [pinned observer](../../../../docs/figment/2026-09-08-raw-reference-observations.md) remains raw, unthresholded evidence rather than approval.

The accepted curation path provides a train-first-compatible boundary. It materialized the retained 20-train/2-eval direct-`g01` set only after the existing explicit bounded-research dataset decision. Staging carries the curation record and exact snapshot inventory beside numbered images and captions, so a changed retained source, provenance, caption, or mapping makes the acceptance stale. The 21 raw identity observations (six pilot and 15 expansion) remain unthresholded diagnostics, not image-quality proof or independent-reference identity generalization. Final acceptance verification reported 37 curation/freshness tests and nine train-first tests after the boundary repairs.

The accepted one-observation local planner now has completed CPU and tokenizer
readiness receipts. The CPU parser resolved the frozen one-image staged dataset,
caption, and 896x512 effective bucket under a no-device CUDA mask; the separate
local-only tokenizer load resolved both SDXL CLIP tokenizers to 19 tokens for
the fixed availability-probe `CAPTION_PROBE`, not the 330-byte training-caption
content. The [local training preflight audit](../../../../docs/figment/2026-09-08-local-training-preflight-audit.md)
records the readiness inputs. A separately admitted V2 availability probe then
completed the bounded ten-step GPU fit and saved one checkpoint; V1 remains
preserved as the prior CP1252 startup failure. The V2 record has no sample,
quality evaluation, acceptance, or export, and cannot select a checkpoint. See
the [local LoRA fit runtime audit](../../../../docs/figment/2026-09-08-local-lora-fit-runtime-audit.md).

The separate quality recipe completed branch-specific CPU preflights and the
current-caption 100-step fit. The first matched current step-20 pair also
completed with two fixed seeds. The root diagnostic review recorded `continue`
for one predeclared comparison; the independent diagnostic review recorded
`stop`, citing repeated eyes-away pose failure and no visible move from either
matched base face toward `g01`. These conflicting diagnostic observations are
preserved, and neither is human QA, quality acceptance, promotion, or an
eligibility decision. The higher current ladder is stopped pending protocol
analysis; no current-50/current-final or concise admission has been issued.
See the [training results hub review](../../../../docs/figment/2026-09-08-training-results-hub-review.md).

Current status, 2026-09-09: OmniGen2 V3 and Qwen each completed a two-image reference-conditioned pair, and both received STOP dispositions before expansion. OmniGen2's 3B Qwen-derived encoder remains research-only. Qwen's pinned 7B components have Apache-2.0 metadata, while production clearance remains separate. The Qwen pair is rejected research evidence, not a training input or identity result. The current bounded 20-train/2-eval dataset instead comes from direct-`g01` first-generation derivatives; its normal train-first run is bootstrapping, with no checkpoint, tester result, held-out still, or final cost. See the [curation result](../../../../docs/figment/2026-09-09-builtin-dataset-curation-result.md), [Qwen result](../../../../docs/figment/2026-09-09-qwen-reference-cloud-result.md), and [independent Omni review](../../../../docs/figment/2026-09-09-omnigen2-pair-independent-review.md).

## What the current state means for training

The completed 100-step current-caption fit and its finite checkpoints demonstrate historical runtime only. The offline CLI's dataset acceptance, train-first, tester selection, and `gen` joins passed 50 focused tests. The current bounded research dataset has 20 train rows and two eval-only rows, but its shared single-anchor ancestry does not establish a diverse identity set, independent-reference identity evidence, a production LoRA, or a consistent still set. Its train-first run is bootstrapping; no checkpoint, tester selection, held-out still, or video result exists. V3 remains rejected research evidence rather than a training row. See the [curation result](../../../../docs/figment/2026-09-09-builtin-dataset-curation-result.md) and [delivery plan](../../../../docs/figment/2026-09-09-end-to-end-delivery-plan.md).

Future dataset curation therefore has to state diversity and source overlap explicitly, per image, before any dataset acceptance. The stop protocol stays the same for the new route as for the ladders: one fixed probe, matched seeds, independent review at original resolution, persisted outcome, and no automatic retry, training or promotion from a single result.

The separately accepted `f6b5096d` compiler and `af7b07bc` executor keep the
same lineage boundary outside production `load_plan`. The executor defaults to
offline preparation; a harness dry-run uses the existing manifest contract,
while an explicit live call needs a fixed parent admission, fresh accounting,
exact staged inventory, and verified artifact receipt. Its 23 focused tests
passed independently and in the parent review, but those fixtures used
synthetic 20-row evidence. The current 20-train/2-eval set satisfies the bounded-research input count and its normal train bootstrap is active, but no training result, checkpoint, tester selection, or LoRA export exists. Execution remains non-promotable and is not production acceptance or authorization to export a LoRA.

### Future option: one-observation diagnostic

The current 20-row rule is a deliberately conservative Figment recipe, not a
claim that personalization scientifically requires 20 independent views.
[Diffusers' DreamBooth guide](https://huggingface.co/docs/diffusers/training/dreambooth)
describes subject adaptation from a few images and warns that it is easy to
overfit. Its prior-preservation class samples preserve class diversity; they
are not extra target-identity positives. A future, separately designed
one-observation LoRA diagnostic could therefore use only the canonical `g01`,
with a new schema, bounded training recipe, held-out review plan, and the same
non-promotable admission and receipt controls. It would not make crops or
repeats into independent views.

The [IP-Adapter best-practice note](https://github.com/tencent-ailab/IP-Adapter)
also says its default CLIP image processor center-crops non-square images and
describes a scale tradeoff between diversity and prompt consistency. That makes
the present non-square `g01` conditioning and any crop protocol part of the
experimental condition, not additional identity evidence. The one-observation
planner and its CPU/tokenizer checks are implemented, and one separately
admitted ten-step GPU availability fit has completed. This does not relax the
accepted 20-row compiler or executor, and it supplies no visual or
checkpoint-quality decision. The [runtime audit](../../../../docs/figment/2026-09-08-local-lora-fit-runtime-audit.md)
preserves the bounded evidence and its limits. The separate current-caption
quality fit completed its 100-step runtime schedule after current and concise
CPU preflights. Its first matched step-20 image pair is diagnostic-only and
has conflicting root `continue` and independent `stop` reviews; no higher
current stage or concise admission is active while the next protocol is
analyzed. It likewise does not relax the 20-row boundary.

For evaluation, a held-out derivative of `g01` can test consistency within this single fictional identity lineage, but it cannot establish independence from the training seed. A separate accepted reference set is still required for independent identity evaluation. The historical four original generated candidates are retained as failed or unreviewed experiment evidence only. The current gallery contains six candidates after two rejected local-Comfy diagnostics; none is eligible training data, and no current training output follows from the compiler or its positive synthetic fixtures.
