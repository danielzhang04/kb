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

The accepted curation path now provides a train-first-compatible draft boundary without selecting data or running training. It materializes only retained snapshots, validates the finished draft before its atomic publication, and requires the existing explicit dataset acceptance before train-first staging. Staging carries the curation record and exact snapshot inventory beside the numbered images and captions, so a changed retained source, provenance, caption, or mapping makes a later acceptance stale. Final acceptance verification reported 37 curation/freshness tests and nine train-first tests after the boundary repairs. The earlier 109-test Python curation, builder, lineage and train-first regression predates those final curation repairs; both results establish integrity and refusal behavior, not image quality or an eligible dataset.

The accepted one-observation local planner now has completed CPU and tokenizer
readiness receipts. The CPU parser resolved the frozen one-image staged dataset,
caption, and 896×512 effective bucket under a no-device CUDA mask; the separate
local-only tokenizer load resolved both SDXL CLIP tokenizers to 19 tokens for
the fixed availability-probe `CAPTION_PROBE`, not the 330-byte training-caption
content. The [local training preflight audit](../../../../docs/figment/2026-09-08-local-training-preflight-audit.md)
records hashes and the preserved V1/V2 failures. These are readiness checks
only: no GPU fit, model-weight load, checkpoint, sample, or export occurred.

The separately accepted `f6b5096d` compiler and `af7b07bc` executor keep the
same lineage boundary outside production `load_plan`. The executor defaults to
offline preparation; a harness dry-run uses the existing manifest contract,
while an explicit live call needs a fixed parent admission, fresh accounting,
exact staged inventory, and verified artifact receipt. Its 23 focused tests
passed independently and in the parent review, but those fixtures used
synthetic 20-row evidence. No current input set satisfies the 20-row
requirement, and no live experimental training has occurred. Any future
execution remains diagnostic and non-promotable, not a production acceptance
or authorization to export a LoRA.

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
planner and its CPU/tokenizer checks are implemented, but the GPU fit diagnostic
remains unrun. This does not relax the accepted 20-row compiler or executor.

For evaluation, a held-out derivative of `g01` can test consistency within this single fictional identity lineage, but it cannot establish independence from the training seed. A separate accepted reference set is still required for independent identity evaluation. The historical four original generated candidates are retained as failed or unreviewed experiment evidence only. The current gallery contains six candidates after two rejected local-Comfy diagnostics; none is eligible training data, and no current training output follows from the compiler or its positive synthetic fixtures.
