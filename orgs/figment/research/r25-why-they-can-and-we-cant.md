# R25 — how 10sorLabs does it and we (seemingly) can't

Read-only research. Ties r20/r21/r22/r24, `gate.yaml`, `judge-calibration.md`, `r15/r15b-*`, and a
fresh pass over `research/10sorlabs-package/` (full file inventory, module 09/10/11 transcripts,
module-16 prompt-grid images) together to answer the operator's question directly, with evidence.

## 1. Scoring their outputs by our standard

**No character-passport, dataset, or tester-grid image ships as a file.** Full inventory of the
168-file package (`MANIFEST.tsv`, confirmed by directory walk) contains only ComfyUI workflow
JSONs, `.bat` installers, PDFs, and 15 lesson `.mp4`s for modules 03/09/10/11 — zero rendered PNGs
from their actual identity pipeline. `vlm_judge.py`'s `run_judge`/`run_calibrate` read reference
images **only** from a persona.yaml's `identity.references` (source, ~L845-866, ~L908-936) — there
is no `--references` flag, and building a fake persona.yaml would need an anchor image that does
not exist on disk, so the automated path is genuinely blocked, not just untried.

The 38 static images that **do** ship (`16_prompts/prompt_grid/`) are from module 16, an unrelated
paid-SaaS prompt-writing guide (Higgsfield + Nano Banana Pro) — text-to-image only, **no anchor
image, no LoRA**. Read all 38 prompt texts: they describe **30+ different women** (varying hair
colour/ethnicity/build) — a prompting-technique showcase, not an identity-consistency demo. Only
three images (01, 29, 30) share one prompt almost verbatim ("platinum blonde bob... earmuffs...
snowy forest," wardrobe clause swapped) — viewed directly, they plausibly read as the same person,
but this is a **same-text-prompt rerun on a base model with zero reference conditioning**, not a
reference-to-variation or LoRA test. Qualitatively by our rubric: same_person ~80-88 (hair/scarf/
pose/background match closely across independent draws), skin_realism materially higher than our
current stage-9 output (visible pores/tan-line detail, no waxy highlight), gloss low. This shows a
strong base model holds a *described* look across draws — it says nothing about whether 10sorLabs'
own LoRA pipeline holds a *referenced* identity, which is our actual problem.

**Their real pipeline's output is judged only by their own narration**, never a still image:
- Module 11 [0:18–0:31]: *"the results of this LoRA... aren't like exceptionally good because I'm
  not using a custom dataset... it is always better to use your own dataset."*
- Module 11 [1:59–2:07]: *"the skin texture is a little plastic. I might drop some updates for this
  in the future."*
- Module 11 [11:47–12:04]: *"the plastic skin texture from our dataset bleeds through into our
  regular image, and this is not... like well, of course, it's not what we want."* Tries LoRA
  strength 1.0 instead of 1.5: *"still a little plasticy."*
- Module 11 [12:13–12:22]: quoting viewer feedback — *"there's guys telling me like, oh, she has
  like a freckle on top of her right eyebrow, and in my images she doesn't have it"* — creator:
  *"you're not gonna get it like one to one precisely."*
- Module 11 closing line [12:32–12:37]: *"I will release an update for this plastic skin texture to
  fix it"* — the defect is stated as open and unresolved as shipped.

**Verdict:** on their own admission, their identity-lock output is "a little plasticy" and not
"one to one" — the same symptom class as ours (skin/gloss, minor drift), not a solved problem. The
package's only polished visual evidence is a decoy from a different, easier task (no-anchor,
no-LoRA, same-base-model text-to-image).

## 2. How they actually handle identity drift

| Stage | What they do | Evidence |
|---|---|---|
| Dataset fan-out | 2 **self-generated** source photos (face + body, both drawn from their own passport workflow, not external) → ~30 raw images (15 face-angle/15 body-pose) via low-denoise (0.23) identity-preserving *edit*, not fresh generation | module 10 JSON + [4:26–4:53] |
| Cull | Partial, narrated on camera: *"not every one of these is gonna be good... this makes no sense... we're gonna remove that... for the faces there's not really anything to remove"* — bad body-pose cells get dropped, face cells pass unfiltered. Legacy path (module 04): 52 raw renders culled to 40 via `renamer.bat` (~23% discard). | module 10 [4:44–4:57]; r15b-training.md:117-129 |
| Captions | **Regression they themselves reversed**: legacy = every caption the single literal word `"woman"` (confirmed in `lora_trainer_extracted/`, all 40 files). Current = Qwen3-VL-8B-Instruct full descriptive auto-caption. On camera: *"I used to have like an outdoor caption that put like the caption woman on every one of the images. That's no longer necessary."* | module 11 [2:10–2:19] |
| Training | Krea-2 **Raw**, not Turbo — explicit instruction: *"do not use the turbo with the training adapter... the results are way worse. Choose the raw."* Rank 32, lr 1e-4, 3000 steps, checkpoint every 250, save-slots bumped 4→15 specifically to keep all 12 test checkpoints, cache-text-embeddings ON, sampling **disabled** to cut wall time ~2h→70-80min. All regularization toggles (DOP, EMA, blank-prompt preservation) left **off**. 1h17m on a 96GB RTX PRO 6000. | module 11 [3:30–4:39]; r15b-training.md settings table |
| Checkpoint choice | Screened, not defaulted: 12-branch parallel tester, one fixed seed/prompt, eye-pick. *"This is bad... this is already pretty good... at some point it doesn't really change a lot... I would say this is 1250. This is good. So we're just gonna go with 1250"* — winner is **step 1250 of 3000** (42% through), not the final checkpoint. Mirrors our own tester's non-monotonic curve (own-anchor cosine peaks step 1500/0.894, declines by 2000/0.880 — r20 stage 6) — same pattern, same fix, on both sides. | module 11 [9:16–9:37] |
| "Locking" the face | Never fully automatic — LoRA strength and prompt wording are **jointly and continuously hand-tuned per generation**: *"our model had light gray eyes but we're getting like lightish brown eyes... you need to do both prompting and LoRA, because if your LoRA's a blonde girl and you have a prompt with a brunette girl, it's not gonna work."* LoRA strength itself gets live-tuned: face-swap LoRA tried at 0.6 → judged worse → reverted, *"keep it to one"*; identity LoRA tried "too low" → 1.2 → *"way more consistent"* → dialed back to 1.0 because higher strength baked the plastic skin in harder. | r15b-generation.md:96; module 07 [6:41–6:48]; module 11 [11:38–12:04] |
| Detail recovery | `FaceDetailer` (Impact-Pack: `face_yolov8m.pt` bbox + `sam_vit_b_01ec64.pth`) runs on **every** generation workflow (03/06/09) as a final low-denoise (0.15–0.40) face-only re-render. This is the mechanism that recovers texture after the LoRA/upscale chain — not an identity-lock step. Confirmed absent from our own `creator-001-tensor-gen.yaml` (r20 stage 7). | r15 §3a/3e |
| External photo | Only via the **separate** module-07 edit tool (face/head-swap using a face-swap LoRA of InsightFace-adjacent lineage), and even there the operator's own caveat is *"face-swap output still needs a face-detailer + skin pass downstream"* — not a solved problem, an input to more of the same repair pass. **The core passport→dataset→LoRA→generation loop (modules 03/09/10/11) never touches an external photo** — module 03 and module 06 share one identical workflow JSON, so their "anchor" is just a first draw from their own base model, never a cross-model reference. | module 07 [6:26–6:34]; r15 §0/§3a |

## 3. Tooling-gap table

| Tool | Contributes | Licence blocker (our rules) | 10sorLabs uses it? | Our status |
|---|---|---|---|---|
| PuLID-Flux | SOTA FLUX-native adapter identity lock | Stock config needs InsightFace antelopev2 (non-commercial). Only clean path: FaceNet loader (lldacing fork) + FLUX.1-schnell — unverified for skin/age | **No** — not in the package at all | Not adopted; untried bakeoff candidate (r24 shortlist #3) |
| InstantID | Adapter identity lock | SDXL-only; unstable community FLUX ports, weaker than PuLID per 2026 consensus | No | Not adopted, not pursued |
| InfiniteYou | Adapter identity lock | Apache-2.0 code but requires FLUX.1-dev (non-commercial) + InsightFace | No | REJECT, not pursued |
| IP-Adapter FaceID | Adapter identity lock | Weights Apache-2.0 but maintainer states "exclusively for research" (InsightFace dependency) | No | REJECT, not pursued |
| ReActor/inswapper_128 | Face swap | InsightFace pretrained weights, non-commercial | No (their module-07 tool uses a different, unaudited FLUX-LoRA face-swap, not inswapper) | REJECT, not pursued |
| FaceDetailer + face_yolov8 + SAM (Impact-Pack) | Per-face low-denoise detail recovery — **the actual mechanism they run on every generation** | `.pt`/`.pth` = pickle, arbitrary code execution, regardless of the weights' own licence | **Yes — on every one of modules 03/06/09** | Dropped (D7). Clean substitute exists (r22 §4/§5): MediaPipe native-ComfyUI detector (Apache-2.0, safetensors) + base Impact-Pack alone (GPL-3.0 code fine for SaaS; `MaskToSEGS`/`DetailerForEach` work without the pickle-dependent Subpack) — **not yet wired into `creator-001-tensor-gen.yaml`** |
| Vendor style/skin LoRAs (`RealisticSnapshotKrea2`, `pawg_krea2`, `realistic_snapshot_lora`) | Skin/texture prior stacked at passport + generation | Anonymous `gravedigga/loras` account, zero licence signal, zero downloads — REJECT under "anonymous = never clean" | **Yes — at every image stage** | Dropped (matches their own supply-chain risk, we just enforce it). Clean substitutes found (r22 §1/§2): `suayptalha/Z-Image-Turbo-Realism-LoRA` (Apache-2.0), `inlineresearch/skin-lora-krea-2-raw` / `gokaygokay/Krea-2-Realism-LoRA` (Krea-2 Community Licence, <$1M revenue) — **not yet wired in** |

**Which failures trace to which cause:**
- **Traces to our substitutions (fixable now, no new research needed):** no FaceDetailer/SAM pass
  (r20's #1 "glossy" cause) and no skin/texture LoRA anywhere in our chain (r20's #2/#6 "reads
  older") both have licence-clean substitutes already sourced (r22) and simply not yet integrated.
  Legacy single-word captioning (r20's #5) is not a licence issue at all — Qwen3-VL-8B-Instruct is
  Apache-2.0 and already a named hook — it is a build-order regression.
- **Traces to the harder problem (genuinely unsolved by either of us):** 10sorLabs' entire identity
  chain never leaves one model family's own output distribution — Z-Image-Turbo generates its own
  passport, Qwen/FLUX-family tools edit that same output, Krea-2 trains and generates from that same
  lineage. **No stage of their loop ever asks one model to reproduce another model's identity.** Our
  anchor (g01/g02/g07) comes from Gemini/Nano-Banana — a closed, architecturally different generator
  — and every downstream stage (Qwen-edit, Krea-2 training, Krea-2 generation) has to cross that
  boundary. This is a real, structural difference in task difficulty, not a tooling gap, and it is
  not something the package demonstrates a fix for — it never attempts the task at all.

## Ranked, evidence-graded causes + cheapest confirm/refute experiment (≤$3 each)

1. **[Strong — structural, r20/r24 + this pass]** Cross-model identity transfer is a harder problem
   than anything 10sorLabs' package solves. *Experiment:* run r24's top bakeoff candidate — Qwen-
   Image-Edit-2511 + `tlennon-ie/qwen-edit-skin` LoRA, Lightning removed, 24-28 steps — against our
   existing g01 anchor, judge same_person/skin_realism on 5-8 cells. Local/subscription-billed,
   ~$0. Tests whether a same-family skin LoRA narrows the gap even though the cross-model step stays.
2. **[Strong — mechanism confirmed present in theirs, absent in ours]** No FaceDetailer/SAM face-
   repair pass. *Experiment:* wire MediaPipe detector + base Impact-Pack (`MaskToSEGS`/
   `DetailerForEach`) at their denoise band (0.15–0.27) into 5-10 already-generated cells (no
   retrain), rejudge. $0 local + ~$1 judge calls.
3. **[Moderate-strong — mechanism real, our substitutes untested]** No skin/texture LoRA in our
   chain. *Experiment:* add `suayptalha/Z-Image-Turbo-Realism-LoRA` or `gokaygokay/Krea-2-Realism-
   LoRA` at 0.7-1.0 to the same 5-10 cells (regenerate, no retrain), rejudge gloss/skin_realism. $0
   local + ~$1-2 judge calls.
4. **[Moderate — our own tester data already shows this]** Checkpoint not screened against its own
   ranking (trained to step 2000, own tester peaked at 1500). *Experiment:* re-run the already-
   trained step-1500 checkpoint through the existing 5-10 fixed-prompt test cells, judge. Pure
   re-evaluation, ~$0.
5. **[Weak-moderate — our own identity-spec.md predicted this, untested]** Uncurated full-body cells
   with known mask-swap risk went into training. *Experiment:* run the 31-cell dataset's full-body
   subset through a face-crop second-pass edit (module 10's own low-denoise pattern), rejudge those
   cells against the half-body median. $0 local.
6. **[Weak]** 2000 vs 3000 training steps. Already shown secondary to #4. *Experiment:* none
   standalone — folds into #4; a from-scratch 3000-step run with DOP (r21's regularization lead) is
   the natural follow-up but is a full retrain, likely >$3, out of scope here.

## Two paths — what each can and cannot prove (no recommendation; licence posture is the operator's call)

- **Path A — strict-licence, train-first (r22/r24's charted substitutes).** Swap in the Apache-2.0 /
  Krea-2-Community-Licence assets now (MediaPipe detector, base Impact-Pack, clean skin LoRAs, DOP
  regularization); stays commercially clean today. **Can prove/disprove** causes #2, #3, #5, #6
  cheaply. **Cannot test** whether an InsightFace/PuLID-class adapter would close the identity gap
  faster than LoRA-only tuning, because no InsightFace-lineage tool is admissible on this path.
- **Path B — test-phase non-commercial tooling.** Temporarily run PuLID-Flux/InstantID/antelopev2-
  class adapters (research-only weights) purely to *measure* whether adapter-based identity
  injection beats LoRA-only on same_person/age_delta, without hosting or shipping any output
  commercially. **Can prove/disprove** whether cause #1 (domain transfer) responds better to an
  adapter than to more LoRA/skin-LoRA tuning. **Cannot ship** any keeper result as-is — a commercial
  path would still need a relicensed clean rebuild (e.g., PuLID + FaceNet loader + FLUX.1-schnell,
  itself unverified for this task) before any output could be used.
