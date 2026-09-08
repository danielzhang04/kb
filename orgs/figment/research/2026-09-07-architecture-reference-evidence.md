# Figment architecture, reference evidence, and research history

Date: 2026-09-07

Scope: the intended 10sorLabs-style architecture, the evidence behind it, and the decisions that turned the purchased toolkit into Figment. This report does not inspect or reproduce purchased media. It relies on the committed derived reports, JSON/config findings already recorded there, the design and implementation plans, and measured Figment run history.

The repository preamble reported that the daily budget was already exceeded. The user explicitly authorized this research-only audit to continue. This report used no network service, browser account, credential, pod, or paid action.

## Finding

Figment is not a clone of a 10sorLabs hosted studio. The evidence shows that 10sorLabs sells a local or cloud ComfyUI toolkit: workflow files, tutorials, model installers, prompt material, and two growth playbooks. The purchased panel is a lesson and download interface. Neither the public site nor the purchased package establishes a production controller that manages creators, approvals, schedules, accounts, publishing, or analytics.

Figment borrows the reference toolkit's image-production sequence and wraps it in a larger operating system that the reference does not supply. The durable Figment architecture is:

1. An operator-selected fictional adult identity remains the source of truth.
2. A staged image pipeline expands that identity, trains a LoRA, ranks checkpoints, generates output, and applies quality gates.
3. Every stage is resumable from files, uses immutable inputs, stops at a human gate, and records spend and provenance.
4. Register, video, content planning, publishing, measurement, and optimisation extend the image pipeline into a creator business loop.
5. A Studio view inside the kb dashboard projects and controls that loop without owning a second execution system.

The model stack is replaceable. Z-Image Turbo, Qwen-Image-Edit, FLUX.2 klein, Krea-2, Wan, captioners, detailers, and their exact sampler values are dated implementation choices. The persona contract, stage boundaries, checkpoint ranking, full-resolution curation, gate records, tier separation, and dashboard role are the architecture.

## Evidence hierarchy

| Evidence class | What it can establish | Sources and locators | Limits |
|---|---|---|---|
| Public primary source, checked by the parent session on 2026-09-07 | Current advertised offer: 7 ComfyUI workflows, 13 tutorials, 2 growth playbooks, and use on a local or cloud GPU | [10sorLabs public site](https://10sorlabs.com/) and [toolkit panel](https://webpanel.10sorlabs.com/) | Product claims and inventory, not proof of output quality or a hosted controller |
| Purchased package structure | Module inventory, download routes, workflow roles, lesson order, and absence of scheduling/analytics/dashboard material | `orgs/figment/research/r14-10sorlabs-package.md:9-14`, `:255-270`, `:299-315`; `orgs/figment/research/r15-10sorlabs-artefacts.md:176-180` | Licensed material is represented by derived notes only |
| Purchased workflow JSON/config | Node graphs, model names, sampler values, LoRA weights, detail passes, checkpoint tester shape | `r15-10sorlabs-artefacts.md:182-337` | Establishes shipped defaults, not that those defaults are optimal |
| Purchased lesson video analysis and transcripts | Taught procedure, UI values, curation, warnings, and operator commentary | `r15b-training.md:25-76`, `:80-110`, `:182-257`; `r15b-generation.md:51-75`, `:138-202`; `r15b-edit-motion.md:21-111` | Vendor demonstration and narration, not an independent benchmark |
| Figment measured runs | What the local ports actually executed, cost, timing, scores, operator rulings, and failure modes | `orgs/figment/STATE.md:75-296`; `pipeline/expand/bakeoff/m1-RESULTS.md:1-26` | Small, evolving experiments on creator-001; causal conclusions need controls |
| Secondary research | Candidate methods, licenses, and reported behavior | `r21-better-methods-2026.md:1-180`; `r22-clean-assets.md:1-113`; `r24-identity-transfer-bakeoff-candidates.md:1-74` | Much of the quality guidance is vendor or community evidence and must be tested locally |
| Local synthesis and inference | Ranked explanations for observed failures | `r20-fidelity-audit.md:14-67`; `r25-why-they-can-and-we-cant.md:49-129` | Useful hypotheses. Several claims overreach the experiments, discussed below |

The public count of 7 workflows is consistent with the package evidence once duplicate roles are separated from distinct files. The package exposes 8 workflow roles across modules 03 through 11, but modules 03 and 06 use an identical image-generator file (`r15-10sorlabs-artefacts.md:182-202`). That yields 7 distinct workflows.

## Goal layers

### 1. Identity proof for creator-001

One operator-supplied image of a fictional adult woman must survive pose, distance, lighting, generation, and motion changes while retaining apparent age and skin texture. The image is the identity source of record. The mandate states this directly at `orgs/figment/MANDATE.md:9-24`. The design turns it into measurable conditions for the expansion set, held-out LoRA prompts, pass comparison, and video (`docs/superpowers/specs/2026-09-03-figment-creator-001-design.md:40-56`).

This layer remains unresolved. Figment has proved the training and tester machinery, but not a production-quality identity result for creator-001. The 2026-09-04 operator verdict was "kind of close, glossy, reads a lot older, some inconsistent" (`STATE.md:210-228`). The train-first LoRA built on 2026-09-07 has not yet received a valid tester result because the first tester omitted the trigger token and later retries were interrupted by a network outage (`STATE.md:264-295`).

### 2. Reusable persona factory

Creator-001 is an acceptance fixture for a reusable pipeline. A new creator should require persona data and operator-provisioned account data, with no code changes. Runs must resume from stored artifacts rather than conversation state (`creator-001-design.md:58-66`). The Track-2 plan makes `figment_train.py` the only planner and runner for `anchor`, `dataset`, `smoke`, `train`, `tester`, and `gen`, with `creator-002` used to detect creator-001 residue (`2026-09-06-figment-track2-faithful-pipeline.md:18-24`, `:32-36`, `:1097-1133`).

### 3. Quality-controlled media pipeline

The mandate extends the identity proof into register lock, image passes, and video passes (`MANDATE.md:25-40`). Figment adds automated annotations, mandatory full-resolution review, quarantine, regeneration, and separate operator gates. The package supplies useful production primitives, but not this full control system.

### 4. Creator operations loop

Content research chooses formats and mixes. Official APIs publish disclosed content. Metrics feed the next plan (`MANDATE.md:41-47`). The design specifies templates, weekly plans, disclosure preflight, account-level isolation, warehouse snapshots, and optimiser proposals (`creator-001-design.md:362-403`). These capabilities are Figment requirements. They are not evidenced 10sorLabs package capabilities.

### 5. Multi-creator Studio

The dashboard must generate, edit inputs, run flows, present QA boards, approve, schedule, publish, and show analytics across accounts (`MANDATE.md:49-56`). The design chose one `Studio` destination inside the existing kb dashboard because cards, ledgers, approvals, and the T3 publishing channel already live there (`creator-001-design.md:446-468`). The UI is a projection and control surface over the same files and workflows, not another backend.

### 6. Safety and tier boundary

The Instagram pipeline may use rented compute. Any unclothed or explicit generation and the training that includes it remain on operator-owned hardware, run by the operator, with separate stores and accounts (`MANDATE.md:141-148`; `pipeline/GUARDRAILS.md:7-36`). This boundary changes where stages execute, but should not create a second orchestration model.

## Reference module to Figment mapping

| Reference module or capability | Figment equivalent | Required behavior | Current fidelity and gaps |
|---|---|---|---|
| Module 02, ComfyUI basics | Pinned workflow and model layer under the pod harness | Load the correct model family, keep model-specific sampler recipes with that family, record seeds, and fail on missing nodes or models | Figment preserves the workflow concept and pins. Early specs copied some package settings across different bases, then explicitly reversed that practice. Turbo values such as 4 to 8 steps and CFG 1 are not general architecture (`creator-001-design.md:263-266`, `:653-668`) |
| Module 03, character passport | Mandate S1 anchor and Track-2 `anchor` stage | Present candidates, promote exactly one fictional adult identity, bind future work to its hash, and never rerun a promoted anchor silently | The package generates its own passport with Z-Image Turbo, a realism LoRA, and candidate comparison (`r15:182-202`). Figment's mandate instead says the operator supplies the identity (`MANDATE.md:17-18`). Track-2 tried a faithful generated passport plus an edit arm, but the operator rejected it as a category error because creator-001 was already g01 (`STATE.md:210-223`). Keep candidate generation as an optional pre-anchor tool, not an automatic identity replacement |
| Module 10, dataset generator 2.0 | `dataset` stage, `tensor_dataset_v2_api.json`, and full-body variant | Transform face and body references into a varied raw set through identity-preserving edits, then cull every cell at full resolution before training | The package uses two inputs, fixed angle and pose lists, low-denoise edit, face crop, and about 30 outputs (`r15b-training.md:80-107`). Figment ported the graph shape, but replaced the AIO checkpoint, dropped unlicensed LoRAs, used klein 4B, changed the encoder and upscaler, moved prompt fan-out into the harness, and removed the explicit branch (`TENSOR-REPLICATION.md:24-79`). The first Track-1 dataset used all 31 raw cells despite its own cull doctrine (`r20-fidelity-audit.md:19-21`). Track-2 adds half-body framing and a full-body face-crop pass, which is a Figment adaptation rather than a package feature (`TENSOR-REPLICATION.md:203-225`; Track-2 plan `:451-490`, `:1149-1150`) |
| Module 11, Qwen3-VL captions | Dataset sidecars and training caption mode | Produce attributable captions before training and preserve the chosen doctrine in the persona training state | The current package uses full descriptive Qwen3-VL captions and explicitly retires the legacy single-word `woman` captions (`r15b-training.md:187-200`, `:245-255`). Track-1 knowingly used `woman`, while the Qwen3-VL path remained unverified (`TENSOR-TRAINING.md:69-88`). Track-2 changes to short captions containing the trigger plus one clause (`Track-2 plan:32-34`). Secondary research argues short captions may outperform narratives (`r21:16-20`, `:166-180`). The architecture should support either; the choice needs a controlled local comparison |
| Module 11, LoRA training | `train` stage using pinned Ostris ai-toolkit and Krea-2 Raw | Train the raw model, save every checkpoint needed by the tester, cache expensive encodings, disable samples when speed matters, and keep all training parameters in data | Package settings are rank 32, LR 1e-4, batch 1, 3000 steps, save every 250, multi-resolution buckets, cache text embeddings, and sampling off (`r15b-training.md:35-61`). Track-1 matched most values but used 2000 steps on an L40S because of then-current budget and timeout reasoning (`TENSOR-TRAINING.md:48-67`, `:227-241`). Measured cached throughput later showed 3000 steps was affordable, so Track-2 restored 3000 (`Track-2 plan:5-17`, `:733-743`). DOP is a later A/B, not part of reference fidelity (`Track-2 plan:32-35`, `:1149`) |
| Module 11, dataset tester | `tester` stage and checkpoint gate | Hold prompt, seed, sampler, resolution, and model constant while checkpoint is the only changing variable; operator chooses the winner and records its digest | This is the strongest direct transfer. The package runs 12 parallel branches and eye-picks a non-final checkpoint (`r15:317-337`; `r15b-training.md:201-208`). Track-1 used 8 sequential jobs due its shorter ladder, but preserved the controlled variable (`TENSOR-TRAINING.md:255-259`). Its scores peaked at step 1500, yet downstream work did not first bind the chosen checkpoint (`r20:22-24`). Track-2 restores a 12-checkpoint ladder and requires the chosen step for generation (`Track-2 plan:733-760`, `:983-998`) |
| Module 09, Krea-2 generation | `gen` stage | Load only the chosen identity checkpoint, render a stable base, upscale and normalize, refine at low denoise, run a face-only detail pass, retain intermediates, and gate the final output beside the anchor | The package chain is base render, x4 upscale, scale down, refine at denoise 0.35, then FaceDetailer at 0.15, with style LoRAs (`r15:261-281`; `r15b-generation.md:51-75`). Track-1 preserved base/upscale/refine but dropped FaceDetailer and style LoRAs for pickle and license reasons (`TENSOR-TRAINING.md:260-269`). R22 and R23 found a clean MediaPipe mask plus base Impact-Pack path (`r22:38-64`; `r23:7-80`). Current code now contains `LoadMediaPipeFaceLandmarker -> MediaPipeFaceLandmarker -> MediaPipeFaceMask -> MaskToSEGS -> DetailerForEach` in `pipeline/train/workflows/krea2_gen_api.json:20-25`, style-LoRA pins in `pipeline/train/tensor-pins.yaml:195`, and a detail-only manifest path in `pipeline/figment_train.py:917-1108`, `:1262-1381`. The remaining gap is a valid live result and operator promotion, not missing implementation |
| Module 07, targeted image edit | Conditional repair or edit workflow in S5 | Change one bounded property while holding identity, framing, light, and environment; use isolated reference crops and preserve the original as evidence | The package uses FLUX.2 klein 9B, reference latents, and short edit instructions (`r15b-edit-motion.md:21-62`). The 9B base and several LoRAs are not acceptable under Figment's commercial and provenance rules. The original design used a native klein 4B edit as face repair (`creator-001-design.md:322-344`). Later Qwen and klein experiments had poor median identity and skin results, but the tested set is too small to declare every edit approach exhausted |
| Module 08, self-hosted motion | S6 video stage | Build a matching first frame from the driver clip, use one-person simple motion, keep the motion prompt terse, test cheaply at low frame count, then run frame-level identity and flicker gates | The reference uses Wan 2.1 SCAIL-2 plus SAM3 tracking at 512x896, 81 frames, 16 fps (`r15b-edit-motion.md:66-111`). Figment chose Wan 2.2 TI2V-5B first, then Animate-14B as a later arm. It adopts the start-frame and driver-selection doctrine while treating sampler and node settings as model-specific challenger data (`creator-001-design.md:346-360`). No production video proof exists yet |
| Module 14, Kling motion | Optional Instagram-tier SaaS challenger where terms permit | Preserve the same start-frame discipline and operator gate | The package's SaaS lesson corroborates the start-frame constraint but does not belong in the self-hosted core (`r15b-edit-motion.md:115-137`). It cannot support the explicit tier under Figment's compute boundary |
| Module 06, legacy generation | Earlier reference for checkpoint comparison and face repair | Fixed-seed checkpoint comparison and conditional face repair | It corroborates checkpoint ranking and FaceDetailer ranges. It is not a separate production stage after module 09 (`r15b-generation.md:77-125`, `:184-202`) |
| Modules 04 and 05, legacy dataset and training | Baseline and fallback recipes only | Preserve historical controls without confusing them with the current reference method | The legacy route used 40 images, single-word captions, rank 16, higher LR, and an informal checkpoint comparison. Module 11 explicitly supersedes the caption doctrine (`r15b-training.md:114-180`, `:224-257`) |
| Modules 12 and 13, legacy SaaS model/content | Prompt schema and throughput patterns | Reimplement useful structures in native templates after safety review | The generated 12-angle identity, structured prompt schema, 2x2 batching, and grid slicer are transferable patterns. Higgsfield, named-person examples, and any evasion-oriented practices are rejected (`r14:170-215`; `r15:499-611`; `r15b-edit-motion.md:141-186`) |
| Module 15, growth SOPs | S7 templates, cadence research, S8 publishing, and S9 measurement | Extract lawful cadence and funnel hypotheses, then validate them with official account data | Figment rejects device resets, proxy/IP rotation, disposable verification, account farms, and engagement actions. The package has growth playbooks but no API publisher, scheduler, analytics warehouse, or optimisation controller (`r15:391-495`; `r14:299-315`) |
| Module 16, prompt guide | Persona and content prompt templates | Keep format, candour, camera, texture, and positive-exclusion structure in editable data, while removing real-person and unsafe examples | Useful prompt structure is evidence for templates, not evidence for identity preservation. The shipped prompt images cover many different women and do not test the package LoRA pipeline (`r15:499-611`; `r25:7-28`) |
| Public "local or cloud GPU" capability | Pod harness plus operator-owned local path | Run the same stage contract on an allowed execution target, with immutable pins, spend bounds, and verified teardown | Figment adds lease, timeout, ledger, failure capture, and teardown guarantees that the public offer does not evidence (`MANDATE.md:89-109`; `Track-2 plan:38-67`) |
| No reference equivalent | Register lock, research cadences, official publishing, account isolation, analytics, optimiser, explicit-tier boundary, and kb Studio | Complete the creator operations loop and keep every external action gated | These are Figment inventions required by its mandate. R14 explicitly found no package support for register lock, continuous research, optimisation, analytics, scheduling, dashboard, or paid-platform operations (`r14:299-315`) |

## Chronological decisions and pivots

### 2026-09-03: the mandate defines a studio, not only an image recipe

The operator defined one fixed reference identity, a nine-stage pipeline, continuous research, multiple creators, two tiers, and one dashboard (`MANDATE.md:7-56`). The package was named as a source of methods and structure, never a dependency (`MANDATE.md:58-87`). The governing rule was to research first, then build and train (`MANDATE.md:89-112`).

The first end-to-end design translated that into data contracts, stages, gates, agent roles, content operations, and Studio views. Its initial image doctrine used FLUX.2 klein 4B Base for expansion and diffusion-pipe for LoRA training. It treated 10sorLabs values as adaptable evidence across different models (`creator-001-design.md:242-344`). This was an understandable attempt to preserve commercial licensing, but it weakened fidelity to the purchased method.

### 2026-09-03 evening: custom expansion fails twice

Expansion-02 generated from empty latents with long prompts and references on the side. Identity failed badly (`STATE.md:92-102`). Expansion-03 switched to an edit graph with short prompts and obtained encouraging similarity scores, but the full-resolution operator review rejected the visual quality. A thumbnail-based preliminary keep decision was withdrawn (`STATE.md:104-126`).

This established two durable rules: operator review must use full-resolution images beside the anchor, and a high embedding score does not establish identity by itself. It did not establish that all edit methods were incapable of the task.

### 2026-09-03 to 2026-09-04: Track 1 replicates the package core

The operator reset the work to module 10 dataset, module 11 training and tester, then module 09 generation (`STATE.md:120-144`). Figment ported the reference settings into its harness, removed the explicit branch, and substituted assets that failed safety, license, provenance, or pickle requirements.

The dataset path and training path ran end to end. The full training run produced 8 checkpoints in 99 minutes for $1.80, and the tester produced one output per checkpoint (`STATE.md:176-204`). The result proved infrastructure and checkpoint ranking. It did not prove acceptable identity. The test curve was non-monotonic, with the best recorded embedding at step 1500 rather than the final step (`STATE.md:188-197`).

Track 1 also departed from the current package in four meaningful ways:

* It trained on all 31 raw images despite the documented cull step.
* It used the legacy single-word caption instead of current Qwen3-VL descriptions.
* It stopped at 2000 steps and therefore tested 8 checkpoints rather than 12.
* It omitted the package's style LoRAs and final FaceDetailer pass.

These departures are documented at `r20-fidelity-audit.md:16-25` and `TENSOR-TRAINING.md:48-88`, `:227-269`. Each had a stated reason, but "faithful" here means a faithful stage protocol with declared substitutions, not identical behavior.

### 2026-09-06: fidelity audit becomes Track 2

R20 separated the chain into anchor, dataset, cull, captions, training, checkpoint selection, generation, and output passes. It ranked missing curation, checkpoint selection, style priors, and face detail as possible contributors (`r20:27-67`). R21 surveyed current methods. R22 found clean replacements for skin LoRAs, face detection, detailer plumbing, age scoring, and captioning. R23 confirmed the MediaPipe node interface on the pinned ComfyUI version (`r22:1-113`; `r23:1-80`).

The approved Track-2 plan rebuilt modules 03, 10, 11, and 09 under the existing `plan -> run -> grade -> apply-rulings` contract, with one gate after each stage and creator-002 residue tests (`Track-2 plan:18-47`). Review found real execution defects: wrong cost basis, possible anchor rerun, missing `gen` grading, unused Impact-Subpack exposure, unsafe stage fallthrough, an artifact deadline ambiguity, and dead caption-mode configuration (`Track-2 review:11-153`). Version 2 folded those fixes into the plan (`Track-2 plan:5-17`).

### 2026-09-06: faithful module 03 conflicts with the mandate anchor

Track-2 generated 12 passport candidates plus 6 edits of g01. The operator rejected the board because creator-001 already was g01. Replacing her with a new face generated inside the reference stack would solve an easier problem by changing the identity (`STATE.md:210-223`).

This is the central architectural correction. The module 03 method can help create a new persona before identity promotion. It cannot replace a promoted external identity without an explicit operator decision. The mandate's source-of-record rule wins over procedural fidelity to module 03.

### 2026-09-07: edit ablation underperforms, train-first remains open

The m1 bakeoff tested Qwen-Image-Edit-2511 without Lightning across three arms. Median VLM identity scores were 61, 59, and 58.5, with waxy skin comments. Age drift improved to zero (`pipeline/expand/bakeoff/m1-RESULTS.md:1-20`). This rejects those exact recipes as a production batch.

The report's sentence that no best cell reached the anchor band is internally inconsistent. It defines the anchor self-score band as 78 to 88, then reports a03 at 85 and b02 at 78 (`m1-RESULTS.md:3-5`, `:13-14`). Its broader claim that the edit-model path is exhausted also exceeds a six-cell-per-arm ablation (`:21-24`). The evidence supports "these tested recipes have poor median fidelity and skin," not "the model family cannot work."

Figment then trained a 1250-step DOP LoRA from 23 images. The first tester omitted the trigger token, so its stranger-level scores diagnose the tester prompt, not the LoRA. Later retries were interrupted before a valid result (`STATE.md:252-295`). Train-first therefore remains an ungraded candidate, not the chosen future architecture.

## Dated model doctrine versus lasting architecture

| Dated doctrine | Date and locator | What remains after the model changes |
|---|---|---|
| FLUX.2 klein 4B Base expansion, diffusion-pipe training, Wan 2.2 video | Mandate and first design, `MANDATE.md:19-40`, `creator-001-design.md:255-360` | Dataset expansion, checkpointed training, held-out evaluation, and frame-level video gates |
| Package Krea-2 Raw training, Krea-2 Turbo inference, Qwen/FLUX edit, 4-step CFG-1 sampling | r15/r15b on 2026-09-03 | Raw model for training, model-matched inference recipe, fixed checkpoint test, and controlled low-denoise refinement |
| Track-1 2000-step and 8-checkpoint compromise | `TENSOR-TRAINING.md:227-241` | Derive bounds from measured throughput and preserve every checkpoint needed by the tester |
| Track-2 3000-step and 12-checkpoint recipe | `Track-2 plan:28-35`, `:733-760` | Tester determines the useful checkpoint; final step is not automatically best |
| Qwen edit without Lightning, skin LoRA, and three reference arms | `m1-RESULTS.md:1-24` | Compare methods on fixed cells and judge identity, age, skin, and artifacts separately |
| Train-first with DOP | `STATE.md:248-272` | Training and testing remain separate gates; invalid tester inputs cannot grade a model |

The lasting architecture should never encode a model name in a stage contract. A workflow manifest may select a model and its specific recipe. `persona.yaml`, stage state, gate records, and dashboard routes should refer to capabilities and artifacts: anchor, dataset, checkpoint set, chosen checkpoint, generated batch, detailed output, and ruling.

## Claims that need tighter causal discipline

### Genuine package evidence

The following are well supported by the purchased JSON, settings, and lessons:

* The core current sequence is module 03 passport, module 10 dataset, module 11 training and checkpoint tester, then module 09 generation (`r14:138-168`, `r15:261-337`).
* Module 10 uses two references, low-denoise editing, fixed prompt lists, face cropping, and a cull step (`r15b-training.md:80-110`, `:213-223`).
* Module 11 uses Krea-2 Raw, descriptive VLM captions, rank 32, LR 1e-4, 3000 steps, 250-step saves, and checkpoint eye-selection (`r15b-training.md:25-61`, `:187-208`).
* Module 09 includes base render, upscale, refine, and a final face-only detail pass (`r15:261-281`).
* Module 08 relies on a matched start frame and simple driving motion (`r15b-edit-motion.md:66-111`).
* The package admits plastic skin and imperfect identity. It does not claim one-to-one fidelity (`r25:30-47`).

### Vendor or community claims that remain unproven locally

* Krea's low-image LoRA quality, Qwen 2511 identity gains, skin-LoRA benefits, PuLID quality, and Z-Image edit consistency are candidate evidence, not Figment results (`r21:10-180`; `r24:16-74`).
* Exact quality effects from sampler choices and caption length remain model and dataset dependent.
* Clean license status does not establish compatibility or quality. R22 marks the Qwen skin LoRA clean but unverified on 2511, and the MediaPipe detail chain clean but not yet run end to end (`r22:25-48`, `:100-113`).

### Local inferences that should not be promoted to fact

1. R25 says the reference chain stays in "one model family's" output distribution (`r25:80-87`). The actual chain combines Z-Image Turbo for the passport, Qwen-Image-Edit and FLUX.2 in dataset/edit paths, and Krea-2 for training and generation. That is not one model family. The defensible distinction is narrower: the reference begins with a synthetic portrait created for editability and allows the downstream stack to reinterpret it, while Figment asks that stack to preserve an already fixed identity created elsewhere. The package does not demonstrate that external-identity task.
2. R20's missing FaceDetailer theory is credible for final production gloss, because the package uses it after generation (`r20:24-32`). It cannot explain defects in the raw checkpoint tester, because both the reference tester and Figment tester intentionally omit the detail pass (`r20:22-24`). Tester identity and skin failures originate earlier in dataset, caption, training, checkpoint, or base-generation behavior.
3. R20 attributes apparent age partly to the missing reference style lineage (`r20:33-38`). That is plausible, but no controlled same-anchor A/B isolates the effect.
4. M1 establishes poor median performance for three exact recipes. It does not establish that Qwen/klein editing as a category is exhausted. Two of its own best cells fall within the stated anchor self-score band.
5. Facenet cosine is useful for gross rejection but not a visual identity verdict. In the Track-2 calibration, edited cells scored around 0.92 while the operator and VLM saw drift (`STATE.md:223-228`). The system must retain separate metric and human/VLM axes.

## Minimal coherent future architecture

No new framework is needed. The smallest coherent architecture is the one already latent in the mandate, the stage runner, and the Studio decision.

### Control plane

`persona.yaml` and `training.yaml` remain the machine inputs. `figment_train.py plan|run|grade|apply-rulings|train-first` remains the only stage interface. Plans bind model pins, prompts, seeds, references, and expected artifacts. Runs write state and outputs. Grades produce boards and advisory scores. Rulings promote one artifact by hash and reopen downstream gates when that hash changes. The Track-2 plan describes this contract at `:18-24`, and the first design describes hash-bound gates and resumability at `:58-66`, `:490-515`.

### Identity and image path

1. Promote an operator-selected fictional adult anchor. Candidate generation may precede promotion for a new persona, but a generated candidate cannot silently replace an existing identity.
2. Generate a raw dataset from the promoted anchor through a model-specific workflow adapter. Keep face and full-body handling explicit.
3. Cull every raw cell at full resolution beside the anchor before any training dataset is assembled. Automated metrics annotate; they do not keep cells.
4. Train a checkpoint ladder from the curated cells. Caption mode, regularization, model, and recipe are data fields.
5. Test checkpoints under fixed prompts, seeds, model, sampler, and resolution. Bind the operator's chosen checkpoint to its digest.
6. Generate from that checkpoint using a model-matched base, upscale, refine, and clean face-detail path. Retain intermediates so the effect of each pass can be judged.
7. Run identity, adult-read, garment-integrity, real-person resemblance, skin, and artifact review. Quarantine failures. Never publish from a raw tester or ungraded generation batch.

### Creator operations path

Register settings, video, content plans, publishing, analytics, and optimisation remain downstream consumers of approved identity artifacts. They should not block proving the image core. They should also not be redefined by whichever image model wins. The design's existing gate spine already provides the sequence (`creator-001-design.md:490-513`).

### Studio

Build the six existing Studio views when the operator prioritizes UI work: Creators, Generate, QA board, Calendar, Accounts, and Analytics (`creator-001-design.md:457-468`). Each view reads or writes through the control-plane contracts. The local blind board and Inbox remain sufficient for early identity gates (`:450-455`).

## Settled constraints and remaining decisions

| Decision | Evidence already available | What would close it |
|---|---|---|
| Settled constraint: creator-001's anchor is immutable unless the operator explicitly creates a different persona | Mandate says operator-supplied source of record; the 2026-09-06 ruling rejected replacing g01 (`MANDATE.md:17-18`; `STATE.md:219-223`) | No new approval is needed. Enforce the existing S1 rule in planning and use module 03 only before a persona has a promoted anchor |
| Which identity-transfer path wins? | Exact Qwen m1 recipes have poor medians; train-first DOP tester is invalid and pending (`m1-RESULTS.md:7-24`; `STATE.md:264-295`) | Run the corrected tester with trigger and class text, grade all checkpoints, then compare the chosen train-first output against the best m1 cells on the same prompts |
| Which caption doctrine should train the production LoRA? | Package current path uses descriptions; secondary evidence and Track-2 favor short trigger plus one clause; Track-1 used legacy `woman` (`r15b-training.md:197-200`; `r21:16-20`; `Track-2 plan:32-34`; `TENSOR-TRAINING.md:79-88`) | Controlled training comparison or a clear operator ruling after one valid train-first result. Do not call either doctrine universally correct |
| Is Krea-2 acceptable for production? | Cached source reports describe a conditional community license with a revenue threshold (`TENSOR-TRAINING.md:15-46`; `r22:15-23`). This audit did not freshly verify legal or commercial clearance | Recheck the current license text at the decision point. The operator then accepts its terms or selects an Apache alternative after equivalent quality evidence |
| Which clean detail/style combination is adopted? | MediaPipe plus base Impact-Pack and the style slot are implemented in the current generation workflow, and two Krea realism LoRAs have stated licenses. No combined live result has passed the operator gate (`pipeline/train/workflows/krea2_gen_api.json:20-25`; `pipeline/train/tensor-pins.yaml:195`; `pipeline/figment_train.py:917-1108`; `r22:15-64`) | Fixed-seed base/refine/detail A/B on already generated cells, full-resolution operator gate, and pin verification |
| What is the production identity judge? | Facenet misses visually obvious drift; VLM judge separates it but depends on calibration (`STATE.md:223-228`; `m1-RESULTS.md:3-20`) | Freeze a labelled calibration set and thresholds, retain human review, and prevent any single proxy score from promoting a cell |
| When does Studio UI land? | Architecture and routes are decided; early gates work through local boards and Inbox (`creator-001-design.md:446-468`) | Operator prioritizes P16 after the image core produces an accepted creator-001 batch |
| When do publishing and optimisation activate? | Official API design exists, but account provisioning and live proof remain blocked (`creator-001-design.md:375-403`, `:635-649`) | Operator provisions the Instagram test account and grants; complete Test 0 and two-account isolation before scheduling real content |
| When does video become production-capable? | Reference doctrine is understood; Figment's Wan 2.2 plan is specified but unproved (`r15b-edit-motion.md:66-111`; `creator-001-design.md:346-360`) | One approved start frame, a 5 to 8 second proof, frame-level identity/flicker review, and GATE D2 |

## Source locator index

* Goal, stages, Studio, research, tier boundary: `orgs/figment/MANDATE.md:7-157`
* Hard safety and execution boundaries: `orgs/figment/pipeline/GUARDRAILS.md:1-36`
* Creator and platform success conditions: `docs/superpowers/specs/2026-09-03-figment-creator-001-design.md:40-66`
* Original architecture and stage contracts: same spec `:68-470`
* Studio decision and gate spine: same spec `:446-515`
* Spec deviations and r15b reconciliation: same spec `:651-699`
* Purchased package module map and its limits: `orgs/figment/research/r14-10sorlabs-package.md:33-344`
* Package workflow settings and checkpoint tester: `orgs/figment/research/r15-10sorlabs-artefacts.md:176-390`
* Package evidence honesty and independent claim-check: same report `:615-659`
* Training and dataset lesson evidence: `orgs/figment/research/r15b-training.md:25-298`
* Generation lesson evidence: `orgs/figment/research/r15b-generation.md:30-242`
* Edit and motion lesson evidence: `orgs/figment/research/r15b-edit-motion.md:21-242`
* Stage-level fidelity audit: `orgs/figment/research/r20-fidelity-audit.md:14-67`
* 2026 method survey and evidence grades: `orgs/figment/research/r21-better-methods-2026.md:1-180`
* Clean asset and license findings: `orgs/figment/research/r22-clean-assets.md:1-113`
* MediaPipe node verification: `orgs/figment/research/r23-mediapipe-node-spike.md:1-80`
* Identity method candidates and license constraints: `orgs/figment/research/r24-identity-transfer-bakeoff-candidates.md:1-74`
* Reference comparison and local causal hypotheses: `orgs/figment/research/r25-why-they-can-and-we-cant.md:1-129`
* Dataset port mappings and deviations: `orgs/figment/pipeline/expand/TENSOR-REPLICATION.md:1-333`
* Training, tester, and generation port mappings and deviations: `orgs/figment/pipeline/train/TENSOR-TRAINING.md:1-378`
* Track-2 approved design, implementation plan, and open risks: `docs/superpowers/plans/2026-09-06-figment-track2-faithful-pipeline.md:1-1153`
* Independent Track-2 plan review: `docs/superpowers/plans/2026-09-06-figment-track2-faithful-pipeline.REVIEW.md:1-153`
* Measured project history and operator rulings: `orgs/figment/STATE.md:75-296`
* M1 bakeoff results and internal contradiction: `orgs/figment/pipeline/expand/bakeoff/m1-RESULTS.md:1-26`
