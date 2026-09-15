# One-source LoRA quality diagnostic

## Purpose and boundary

This is a proposed experiment for **after** the admitted ten-step local fit
probe completes successfully. It concerns one observed identity source only:
the current `creator-001/anchors/g01.jpg`, SHA-256
`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`.
It does not authorize a fit, sample generation, checkpoint adoption, export,
or a change to the existing 20-row experimental or production routes.

The completed CPU preflight established that the frozen one-image layout parses
with one 896 x 512 bucket under an offline CUDA mask. It did not establish that
a GPU fit will finish, that a checkpoint is useful, or that its output resembles
the reference. The existing 23-image Krea run is useful context, but is not a
control for this study: it used 23 visually related images and the uniform
caption `creator001krea2 woman`, whereas this proposal deliberately studies one
source and a different pinned runtime. [Local training preflight audit](2026-09-08-local-training-preflight-audit.md)
[Paired diagnostic review](2026-09-08-paired-diagnostic-review.md)

`g01` has useful upper-body scene context, but its fixed640 mapped face rectangle
has about 24,630 original pixels; `g07` has about 26% more area. That limits
the facial detail available to any one-source fit. It is a reason to keep the
experiment small and descriptive, not a reason to replace the provisional
canonical source. [Canonical seed adequacy audit](2026-09-08-canonical-seed-adequacy.md)

## Conditions

Begin with the original g01 JPEG only. A later optional condition may add the
already specified 384 x 384 deterministic crop of that same JPEG, with its
source hash, box `(512, 17, 896, 401)`, encoder settings, and crop hash frozen
in its own plan. It can be an additional training file or row, but remains a
second rendering of one observation rather than an independent view; it cannot
count toward the 20 first-generation requirements or become a new reference. Do not combine the crop
branch with a caption change in its first comparison. [One-observation local
LoRA fit probe](2026-09-08-local-single-observation-lora.md) [Local crop diagnostic review](2026-09-08-local-crop-diagnostic-review.md)

The first controlled question is whether the current age-heavy caption obscures
the small amount of reference-specific description that one image can supply.
It compares the current frozen 331-byte caption with this concise candidate,
while keeping trigger, image bytes, model, recipe, crop choice, steps, learning
rate, and evaluation prompts fixed:

```text
figmentlocalg01probe, fictional adult woman around twenty-one, long center-parted jet-black hair, dark brown eyes, narrow eyelids with lifted asymmetry, dark arched brows, tapered jaw, natural skin texture, opaque black strapped top, bedroom photograph
```

This is a caption hypothesis, not a claim that one wording is correct or that a
result identifies the cause of any earlier Krea output. The old paired study
isolated LoRA versus base for one prompt family; it did not isolate age wording.
[Training / inference conditioning audit](2026-09-08-training-inference-conditioning-audit.md)

## Small diagnostic ladder

After a ten-step fit proves local availability, use a separately admitted,
freshly pinned **100-step** run with the existing one-image recipe: batch one,
U-Net-only rank 32/alpha 16 LoRA, `AdamW8bit`, `1e-4` learning rate, and no
samples during training. Save its checkpoints at **20, 50, and 100 steps**.
Every caption or source condition uses this same 100-step scheduler horizon, so
the predeclared 50-step checkpoint comparison does not confound a 50-step
training trajectory with a 100-step one. The checkpoints are a small increasing
ladder; the fixed `1e-4` is reused from the existing recipe. Neither is proposed
as an optimum. [Frozen local recipe](../../orgs/figment/pipeline/train/local_single_observation.toml)

Run the full-original/current-caption branch first. If it completes, run exactly
one next branch: concise caption at the predeclared **50-step** point, holding
the full original fixed. Consider the face-crop branch only after that caption
comparison, at the same 50-step point and with one already chosen caption.
Each comparison therefore changes one stated factor. A new plan and explicit
admission are required for every branch; a checkpoint remains non-promotable.

## Evaluation set and records

For every retained checkpoint, render a matched base-model and LoRA pair at the
same two seeds (`481516234`, `90210`) for this one fixed evaluation prompt:

```text
Photographic waist-up portrait of a fictional adult woman around twenty-one,
turned slightly toward her own right with eyes to camera, wearing a plain opaque
black top, in soft daylight against a plain warm off-white wall,
figmentlocalg01probe.
```

The background and three-quarter pose are deliberately absent from g01's
canonical landscape composition. They test whether the adapter can follow a
new scene request without treating g01's bedroom framing as a required output.
The base/LoRA pair, seed, checkpoint hash, prompt hash, model/runtime pins, and
source or crop provenance must be recorded together. The matched base is a
diagnostic comparator, not a quality baseline or an identity control.

Review every PNG at original resolution with four separate non-numeric labels:

| Dimension | Record as |
| --- | --- |
| Reference resemblance | tracks g01 cues / uncertain / drifts, with specific eyelid, brow, nose, lip, jaw, hair, and jewellery observations |
| Realism | plausible / artifact present, naming hands, hair, skin, fabric, lighting, geometry, or duplicate-subject defects |
| Adult presentation | adult-presenting / uncertain; never an exact-age finding |
| Clothing | specified opaque garment intact / missing or defective |

This preserves the existing distinction between raw observer values and visual
judgment. The fixed640 observer made all 19 earlier inputs available but is not
calibrated for this persona and cannot select a checkpoint or settle the current
review disagreement. [Raw reference observations](2026-09-08-raw-reference-observations.md)

## Stop conditions and limits

Stop the ladder and retain failure evidence if the fit does not complete within
its admitted bounds, no exactly valid final checkpoint is produced, an output
cannot be tied to its source/model/prompt/seed, or the run reports unverified
teardown. Do not retry automatically or rename a later output as the same run.

After the fixed 100-step run completes, stop higher-checkpoint renders and any
future branch when both matched-seed LoRA outputs show a material defect (for
example duplicate people, broken anatomy, missing opaque clothing, or an
adult-presentation concern), or repeatedly ignore the requested pose/background.
Record the observed reason; do not turn it into a score threshold. A branch can
also stop because the LoRA merely recreates g01's bedroom crop, collapses to one
pose across both seeds, or shows facial drift relative to the stated g01 cues.
These are overfitting warnings in a one-source study, not proof of a
generalization rate. Runtime failures stop the actual training run.

No surviving checkpoint is accepted, trained into the 20-row dataset, or used
as a generated reference. The strongest possible result is a bounded local
observation that one fixed recipe did or did not produce reviewable paired
outputs under the stated conditions.
