# Tensor track — 10sorLabs module 11 on our harness

Detailed substitution/settings record for the `train`/`tester`/`gen` stages. Start at
`pipeline/README.md` for the operator-facing pipeline overview, CLI, gate, and spend guards —
this file is the setting-by-setting "why" behind the numbers that doc only lists.

Faithful replication of the package's current training path (Ostris AI Toolkit + Krea-2 Raw),
its checkpoint-ranking harness (module 11's dataset tester), and its generation pass
(module 09), ported to `pipeline/pod/runpod_run.py`. Every number below is either read off
their UI/JSON, read out of upstream source, a declared ceiling, or (torch/CUDA, state-dict
compatibility, per-step throughput) measured live by the training smoke — see "Step count:
3000, screened by the tester" below. Sources: `research/r15b-training.md` (module 11),
`research/r15-10sorlabs-artefacts.md` §3e and §3g, and the two package JSONs.

## P2 — module 10 dataset source, theirs vs. ours (both arms)

MANDATE.md stage 2 / handoff item 1: the `dataset` stage gains a second source,
`training.dataset_source: "klein-multiref"` (default stays `"qwen-edit"`, today's module-10
qwen-edit + klein-4b-edit two-stage replica, `_dataset_manifests`/`tensor_dataset_v2_api.json` —
unchanged, every existing test for it stays green). `klein-multiref` is FLUX.2 klein 4B **Base**,
`ReferenceLatent` × 3 off the persona's own three identity references (g01/g02/g07 for
creator-001) — the exact `klein4b_multiref_api.json` graph the bake-off m1 arm B already proved
(facenet 0.87–0.93, `pipeline/README.md` "Live-proven runs" 09-07), reused here as a fresh-render
dataset fan-out instead of a low-denoise *edit* of an existing photo. `_dataset_manifests_klein_multiref`
(`figment_train.py`) rebinds it via `expand/build_expansion_set.py`'s own `_rebind_workflow` (nodes
6/7/8 → `persona.identity.references` in order) — no second rebind implementation.

| Setting | 10sorLabs value (module, source) | ours today (`qwen-edit`, unchanged) | ours after this change (`klein-multiref`) | Deviation reason |
|---|---|---|---|---|
| Dataset source model + conditioning | Module 10: FLUX.2-klein-9B (UNET) + Qwen2-8B lumina2 CLIP, low-denoise (0.23) **edit** of 2 self-generated passport photos (r15b-training.md module 10 table) | Qwen-Image-Edit-2511 (lightning 4-step) → klein-4b-edit refine (denoise 0.23), edit of the anchor references (`tensor_dataset_v2_api.json`) | FLUX.2 **klein 4B Base** (Apache-2.0), fresh-render conditioned by `ReferenceLatent` × 3 off g01/g02/g07 — no edit/denoise pass at all | Licence: klein-9B is FLUX Non-Commercial (r14 §6, REJECT); klein-4B Base is Apache-2.0. Bake-off evidence: r24/r25's bake-off m1 already measured this exact 3-ref graph at facenet 0.87–0.93 against g01, the best arm tested — reusing a proven graph rather than a new one |
| Cell counts and structure | 15 face-angle + 15 body-pose = 30 cells from 2 source photos (module 10) | 30 half/close cells (3 shards) + a variable full-body-framed set (`dataset_fullbody`), from `persona.grammar`'s prompt-list rows | 30 cells: 15 face (angle × light, distance fixed "close") + 15 body (angle × wardrobe_family, distance fixed "half"), in 2 shards (face, body) | Matches module 10's own 15+15/30-cell shape exactly. Deviation from `qwen-edit`'s hand-authored 15+15 template rows (`tensor-dataset-prompts.yaml`): klein-multiref's 15+15 is DERIVED from `persona.grammar` (the same grammar `build_expansion_set.generate_allocation` already reads) rather than a second hand-written prompt list — cheaper to build/generalize per-persona, cost of losing module 10's exact per-row wording (documented trade-off, not hidden) |
| Seeds | Fixed per cell (module 10: two fixed outer seeds, 15 rows each) | Fixed per cell (`_dataset_jobs`: two fixed outer seeds) | Fixed per cell: `KLEIN_MULTIREF_SEED_BASE + ordinal`, ordinal 1..30 in a stable face-then-body order, recorded on each job | Matches module 10's "fixed seed per cell" rule; base+ordinal (not module 10's own two literal seeds) keeps the scheme legible and collision-free against every other hardcoded seed already in this file (anchor/edit/tester/gen) |
| Prompt template shape | 2× fixed 15-row prompt lists (`CR Prompt List` nodes), licensed content, not reproduced | 2× fixed 15-row hand-authored prompt lists (`tensor-dataset-prompts.yaml`), our own wording | ~~Grammar-derived: `_compose_look_clause(persona)` (identity) + one short angle/light or angle/wardrobe clause per cell~~ **SUPERSEDED 2026-09-16, see below** — angle/light/wardrobe phrase text itself still pulled from `build_expansion_set.ANGLE_PHRASES`/`LIGHT_PHRASES`/`WARDROBE_PHRASES`/`DISTANCE_PHRASES` — the SAME tables expansion-02's `build_prompt` reads, never a second near-duplicate table. `angles[:3] × lights` (3 angles × the shipped grammar's 4 lights = 12) falls short of the fixed 15 face cells, so `_klein_multiref_cells` pads 3 more (f13–f15), cycling back through the front angle and the same 4 lights (MEDIUM-3 fix, 2026-09-15: those pad cells now carry `crop: "tight"`, which `_klein_multiref_face_prompt` renders as a "framed tight head-and-shoulders portrait" clause instead of the wide "framed close from the chest up" one, so every one of the 15 face prompts is a distinct string even though f13–f15 repeat f01–f03's angle+light) | Same reason as "cell counts" above — avoids authoring a second 30-row prompt library by hand; documented deviation, not a hidden shortcut |
| Prompt template shape — **LIVE 0/30 RESULT + FIX (2026-09-16)** | — | — | LIVE EVIDENCE (`orgs/figment/runs/creator-001/live-20260915b`, `grade/dataset/gate.json`): the klein-multiref dataset source rendered 30 clean, self-consistent cells at 2048×2560 ($1.62 actual) but the gate passed **0/30**. `identity_own` vs g01: median ≈0.61, range 0.16–0.85 (floor 0.7907); `face_px` on `close` cells 452–613 (floor 600) and on `half` cells 343–638 (floor 300 → all half cells cleared face_px). Root cause: `_klein_multiref_face_prompt`/`_klein_multiref_body_prompt` PREPENDED `_compose_look_clause` (a long textual description of hair/eyes/brows/makeup/skin) ahead of the three `ReferenceLatent` inputs, and the text encoder followed that description over the references. The prior run of the SAME graph (`expansion-03`, `calibration.json` set `expansion-03`, n=35) used a minimal reference-lock prompt (`build_expansion_set.build_prompt` style — "…Keep her identity, face shape, and features exactly as shown in the reference images; do not alter, blend, or invent any facial feature…", exp-03's shard jobs even used "The same woman as the reference, identical face; face the camera front-on, eyes on the lens; same room, same light.") and scored `identity_own` median **0.842** (0.678–0.91). The qwen-edit module-10 replica (`tensor_dataset_v2`, calibration set `track1-dataset`, n=31) scored median **0.924** with close cells at 1035–1494 px and half cells 251–563 px. **Fix applied**: `_klein_multiref_face_prompt`/`_klein_multiref_body_prompt` no longer call `_compose_look_clause` at all — no `identity.look` value string (hair/eyes/brows/makeup/skin text) appears in either prompt anymore. New shape: the adult-framing sentence (now shared verbatim with `build_expansion_set.build_prompt` via the new `ADULT_FRAMING_SENTENCE` constant) → the reference-lock clause FIRST (`_KLEIN_MULTIREF_REFERENCE_LOCK_CLAUSE`: "The same woman as the reference images, identical face; keep her identity, face shape, and features exactly as shown; do not alter, blend, or invent any facial feature.") → angle + distance/crop phrase → (body cells only) one `wearing <wardrobe>` clause → light + plain background (face only; body cells carry no light field) → a phone-camera/no-retouch clause (`_KLEIN_MULTIREF_PHONE_CAMERA_CLAUSE`). Still 15 unique face prompts / 15 unique body prompts; still one `wearing` per body prompt; still no profile/near-back angle; still no bedroom+white-wall contradiction. **Fix applied, NOT yet live-validated** — no live dataset run has scored this new prompt shape against the identity gate yet; see the rollout decision below (module-10 qwen-edit replica runs first to isolate training variables, klein-multiref revisited as a scored A/B later). |
| Prompt template shape — **GEN-STAGE LIVE 0/12 RESULT + FIX (2026-09-22)** | — | — | LIVE EVIDENCE (`orgs/figment/runs/creator-001/live-20260916b`, `downstream/gen/gate.json`): the accepted step-2000 checkpoint's gen stage scored **0/12** — `identity_own` median 0.896 was fine, but judge `same_person` 45–68 (floor 70.2) and `face_px` 475–695 (floor 600), every still drifting to fuller lips/sharper arched brows — because the default gen prompt (`_generalized_gen_prompts`, `gen-prompts.yaml` `base_clause`) prepends the ENTIRE `identity.look` clause ahead of the scene, the same class of defect this table's dataset-stage row above already diagnosed. The SAME checkpoint's tester prompt (no look-feature words, close framing) scored judge 88. **Fix applied**: `training.gen_prompt_style: "trigger-scene"` (`training_config.py`, default stays `"look-clause"` — byte-identical to today) reuses the tester's own adult-framing/clothing/skin sentence plus a close-framed scene (`gen-prompts.yaml` `scenes_close`) with zero `identity.look` feature words, per 10sorlabs r15b-generation.md "Prompt-and-LoRA-must-agree." **NOT yet live-validated** — see `orgs/figment/runs/creator-001/ab-20260922-trigger-scene` for the local A/B plan. |
| Resolution | Module 10: `EmptyLatentImage` 1024×1440 (edit-pass latent) | Edit-pass latents per `tensor_dataset_v2_api.json` (module-10-shaped) | `EmptyFlux2LatentImage` 1024×1280 (klein4b_multiref_api.json's own verified graph) | Graph is reused as verified (bake-off m1); not re-tuned |
| Resolution/gate (UPSCALE TAIL, adopt) | N/A | `tensor_dataset_v2_api.json`'s own resolution-boost tail (`ImageUpscaleWithModel` 4xNomosWebPhoto_RealPLKSR + `ImageScaleBy 0.5`, net 2x) already sits ahead of its low-denoise refine pass | Same tail (`UpscaleModelLoader` + `ImageUpscaleWithModel` + `ImageScaleBy 0.5`) now grafted between `klein4b_multiref_api.json`'s `VAEDecode` and `SaveImage` (`_klein_multiref_dataset_workflow`, dataset-stage code path only — the committed graph itself, and expansion-02's own use of it, are untouched) | The dataset identity gate's `face_px_min: 600` (`gate.yaml`) is measured on the SAVED image. **MEDIUM-4 fix (opus review, 2026-09-15): the 535–885 / 150–335 px figures previously here had no in-repo source and are replaced with real measurements.** No native (pre-tail) measurement of THIS exact graph exists in-repo; the closest real pre-tail counter-datapoint is `personas/creator-001/calibration/calibration.json`'s own `expansion-03` set (35 klein-edit cells, native resolution, no upscale tail): **80–379 px**, well under the 600 floor at native res — consistent with needing an upscale tail at all, even if not this exact graph. Post-tail, that SAME `calibration.json`'s `track1-dataset` set (this graph's own dataset-stage output, already through the 2x tail) measures close-framed (face) cells at **1035–1494 px** across 16 cells — comfortably clears 600 — and half-framed (body) cells at **251–563 px** across 14 measured cells (2 of them under 300, one further half-adjacent cell's `face_px` could not be measured at all). A handful of body-cell failures at the 300 floor are therefore an EXPECTED outcome of this distribution, not a defect. **RESOLVED by operator ruling 2026-09-15**: half-framed dataset cells now gate at a lower **300px** floor (`persona.yaml identity.floor.min_face_px.by_framing.half`, overlaid by `identity_gate.load_thresholds` into `gate.yaml`'s `face_px_min_by_framing`); close-framed cells are unchanged at 600. Body cells' ~300–670px post-tail range clears this floor; `identity_floor_gate` picks the floor from each cell's own `framing` (carried from the plan's job record, never inferred), and the gate row it produced records which floor applied (`face_px_min_applied`) |
| Sampler/steps/cfg/denoise | Edit pass: seed fixed, steps 4, cfg 1, euler, beta, denoise 0.23 (identity-preserving edit) | Same edit-pass recipe (module-10 replica) | `Flux2Scheduler` 50 steps, `CFGGuider` cfg 4, `KSamplerSelect` euler, no denoise parameter (fresh generation, not an edit) — klein4b_multiref_api.json's own verified settings | Fresh-render graph has no analogous denoise knob; reused as bake-off-verified, not re-tuned here |
| Captioner + prompt + settings | Qwen3-VL-8B-Instruct, float8, max res 512, max new tokens 128; caption prompt "Caption this image as if you were going to try to generate it with an image generator..." (r15b-training.md module 11) | `caption_mode: "provided"` (dataset stage's own `.txt` sidecars); `qwen3vl` hook exists (`_live_qwen3vl_job_runner`, M4) but not the persona default | `caption_mode: "qwen3vl"` — **already implemented and already matches module 11 exactly**: `QWEN3VL_CAPTION_SETTINGS` (`train/build_training_set.py`) is `{"dtype": "float8", "max_resolution": 512, "max_new_tokens": 128}` and `start-qwen3vl-caption.sh.template`'s `instruction` string is byte-identical to r15b's quoted tool-default prompt — checked as part of this task, no fix needed (see `test_qwen3vl_caption_prompt_and_settings_match_module_11` below) | Settings/prompt match module 11 exactly; **live-observed deviation (2026-09-16, second caption pod 8bi3qae4icrz3t)**: `float8` is module 11's ai-toolkit quantize-time setting (qfloat8 via its own quantizer), not a `from_pretrained` load dtype — there is no quantizer on this pod, so the caption model loads **bf16** weights instead (`start-qwen3vl-caption.sh.template`'s dtype map), producing the same captions modulo quantization noise |
| Trigger/caption composition | N/A (module 11 auto-captions with no trigger token) | `"<trigger> <noun>"` pairing (`training_config.persona_trigger_clause`) prepended to every qwen3vl caption body | Unchanged — klein-multiref only changes which pod produced the underlying images, never how captions are composed downstream | DOP requires the trigger word in every caption regardless of dataset source (training_config.py's own DOP docstring); no reason to special-case it here |
| Trainer arch / rank / LR / optimizer / steps / save cadence / buckets / cache text embeddings / caption dropout / DOP / checkpoint screening | See "Settings — theirs → ours" table below (module 11) | Unchanged (Krea-2 raw, rank 32, LR 1e-4, AdamW8bit, 3000 steps/save 250, buckets 512/768/1024, cache-text-embeddings on, caption dropout 0.05, DOP on per creator-001's own deliberate deviation) | Unchanged — `training.dataset_source` only feeds the `dataset` stage; the `train` stage never reads it (it just uploads whatever `.png`/`.txt` pairs a dataset directory holds, `_train_manifest`) | Nothing downstream of the dataset stage needs to know or care which source produced the training images |

**Fixed during this pass (brief's "fix any cheap mismatch you find"):** none found. `QWEN3VL_CAPTION_SETTINGS` and the caption pod's instruction string already matched module 11's own tool-default settings/prompt byte-for-byte before this task started; the read-first pass above and a new regression test (`test_qwen3vl_caption_prompt_and_settings_match_module_11`) both confirm this rather than assume it.

**`lineage.TRAIN_TIME_KEYS` argument:** `dataset_source` is added. Precedent: `skin_lora` is already in `TRAIN_TIME_KEYS` despite being a *dataset*-stage input (module 04/05's full-body second pass), not a literal ai-toolkit training-config field — the frozenset's real boundary is "determines what pixels the LoRA trained on," not "is read by the trainer pod." `dataset_source` is exactly that: it picks the model family and conditioning mode that produced every training image, which is at least as identity-determining as `skin_lora`. `caption_mode` stays OUT of `TRAIN_TIME_KEYS` (unchanged) — it only changes caption *text*, never the pixels, and the ordinary (non-imported) checkpoint-promotion path already invalidates on ANY training-dict drift regardless of this frozenset (`figment_train.py`'s `current_projection != source_projection` check); the frozenset only matters for an `origin: "imported"` ladder, where the dataset was never produced by this pipeline's own `dataset` stage in the first place.

**Dataset ceiling (klein-multiref, 2 shards of 15 cells each):** `pins.pod_classes.l40s.stages.dataset_multiref` sets `readiness_timeout_seconds: 1800` (matches the `anchor` stage's own readiness budget for a comparable ~16 GB pull: klein-base-4b 7.75 GB + qwen_3_4b 8.04 GB + flux2-vae 0.34 GB, vs. `dataset`/`anchor_edit`'s heavier 2700 s for a 5-model, 4-custom-node pull) and `job_timeout_seconds: 480` per cell (HIGH-1 opus-review fix, 2026-09-15). Per-cell time estimate: this exact `klein4b_multiref_api.json` graph already ran live for creator-001 -- `personas/creator-001/batches/expansion-0{2,3}/pod-runs/*/run.json` record per-job times of **154.6-164.7 s on an RTX 4090** (Ada-class, same generation as the pinned L40S, no dedicated L40S benchmark found), all BEFORE the 4x upscale tail (`ImageUpscaleWithModel` + `ImageScaleBy 0.5`) this graph now appends per the UPSCALE TAIL ruling. `job_timeout_seconds: 480` is ~2.9× the measured 164.7 s ceiling before that tail, holding real margin for the added upscale pass instead of the old 300 s pin, which undercut the shipped 360 s shard precedent and left under 2x margin once the tail is counted. `minimum_runtime_minutes` (`pod/runpod_run.py`) then derives `max_minutes = 1800/60 + (480 × 15)/60 + 5 = 155` per shard; at `$1.30/h` that is **$3.3583/shard × 2 shards = $6.7167** (the operator's $20 covers dataset+captions+train+tester+gen+detail+video for the whole live chain).

**[SUPERSEDED — see the 2026-09-16 rollout paragraph below, which flips this back to
`dataset_source: "qwen-edit"`; `grade/tester/accepted-checkpoint.json`'s
`training_inputs.dataset_source` is `"qwen-edit"`.]**

**Rollout status — creator-001's live `training.yaml` now sets `dataset_source: "klein-multiref"`
(operator ruling 2026-09-15: the live chain must run the new source).** `expand/tests/
test_tensor_dataset.py` (31 tests) builds its ENTIRE fixture set by planning the `dataset` stage
against a persona/training config at collection time, per its own module docstring ("never a
synthetic one ... this file specifically replicates against the live config") — with creator-001
now on klein-multiref, that plan would otherwise produce the wrong graph entirely for this
qwen-edit-specific regression suite. Rather than add a second persona directory under `personas/`
or retire the file, `_creator001_qwen_edit_personas_root()` (top of that file) mirrors creator-001's
REAL persona.yaml/training.yaml/identity-spec.md/anchors (byte-for-byte, via `shutil.copytree`,
preserving the real `orgs/figment/{pipeline,personas}` sibling layout so `register.spec.path`'s
`"../../pipeline/look-spec-v2.md"` still resolves) into a `tempfile.mkdtemp()` root, with
`training.dataset_source` overridden back to `"qwen-edit"` in the copy only — loaded through the
exact same loader (`figment_train.build_plan` → `training_config.load_persona_with_training`), no
new machinery, no second checked-in persona. All 31 tests pass unchanged in intent.
`validate_training`/`_dataset_manifests_klein_multiref` are exercised end-to-end both by that live
creator-001 plan (dry-run clean, `verify_pins.py` clean) and by synthetic-persona unit/integration
tests in `tests/test_figment_train.py` (dry-run clean, gate-schema-identical to the qwen-edit path
by direct side-by-side comparison, ceiling-checked).

**Live 18/60 on the qwen-edit replica (2026-09-16, run `orgs/figment/runs/creator-001/live-20260916`,
`dataset_replicates: 2`, $2.9 actual over 8 pods incl. one DNS-blip retry):** identity_own median 0.898
(0.64–0.946) — identity is not the problem on this source. Gate losses were structural: 16 `close` cells
failed ONLY `face_px < 600` (rendered chest-up at ~400–510 px, identity 0.82–0.94), all 10 `full` cells
failed the 600 floor at 276–374 px (`full` framing has no `by_framing` override — operator ruling pending),
13 cells failed the judge's `same_person` (55–68 vs 70.2) and 9 `|age_delta|`. Row-level: face rows worded
"headshot" / "close-up" / "low-angle shot, looking up at her face" (f08, f09, f10, f12, f13, f14) rendered
at 750–970 px; rows worded "DSLR photograph … view of her face", "profile view of her face", "shot … over
her shoulder", "shot from behind the right shoulder", "Rembrandt lighting portrait", "portrait … showing the
face and shoulders" (f01–f07, f11, f15) rendered at ~480 px. Module 10's face branch is face-dominant by
construction (its input is the 1680² `FaceBoundingBox` crop of the reference). **Edit applied**: those nine
rows now carry an explicit tight-framing clause in the passing rows' register (angle/gaze/light/background
content unchanged, row order and seeds unchanged); pinned by
`expand/tests/test_tensor_dataset.py::test_every_face_row_carries_a_tight_framing_clause`. Expectation:
close cells ≥ ~750 px → ~26–30 approvals of 60. **Edited after live 18/60, NOT yet live-validated.**
The 18/60 run is left at its gate (`GATE dataset: awaiting ruling`) as evidence for the pending `full`
floor ruling; it is not the training set.

**Rollout status — SUPERSEDED 2026-09-16: creator-001's live `training.yaml` flips back to
`dataset_source: "qwen-edit"`, adding `dataset_replicates: 2`** (`caption_mode: "qwen3vl"`
unchanged). The klein-multiref live run above (`live-20260915b`) is the reason -- see the
"Prompt template shape — LIVE 0/30 RESULT + FIX" row above for the root cause and the fix applied
to its prompts. That fix is real but NOT yet live-validated, so this rollout runs the already-proven
qwen-edit/module-10 replica now instead of re-testing klein-multiref blind a second time in the same
pass.

Evidence (identity_own vs g01, median [range] where measured; judge pass rate from `gate.yaml`'s own
calibration block, `orgs/figment/personas/creator-001/calibration/calibration.json`):

| Source | identity_own median [range] | Judge pass rate | Note |
|---|---|---|---|
| klein-multiref (`live-20260915b`, live, n=30) | 0.61 [0.16–0.85] | 0/30 (0%) | New prompt shape, fix applied, not yet live-validated |
| expansion-03 (klein-edit graph, calibration set, n=35) | 0.842 [0.678–0.91] | 23/35 (66%) | Reference-lock-only prompt, same family as the fix above |
| track1-dataset (qwen-edit/module-10 replica, calibration set, n=31) | 0.924 [n/a] | 22/31 (71%) | THIS is the graph `dataset_source: "qwen-edit"` runs |

**Decision:** run the proven qwen-edit/module-10 replica now (3000 steps, `qwen3vl` captions,
module-11 trainer settings) to isolate the training-stage variables (LoRA rank/LR/steps/DOP) from
dataset-source risk entirely -- track1-dataset is the graph with the highest measured identity score
and the only one with a real (non-live-failed) pass rate for this exact conditioning path. Revisit
klein-multiref's fixed reference-lock-only prompts later as a scored A/B against this run, once the
training-stage question is answered, rather than gambling the training run on an unvalidated prompt
fix.

**Rollout note (2026-09-16, M4 caption pod):** the first live qwen3vl caption pod
(`creator-001/live-20260916b`, 08:41) bootstrapped and uploaded cleanly but died 14s into its
python block with no missing pip deps (`transformers`/`accelerate`) and no diagnostic reaching
the harness (it logged only to `_caption.log`, a name `pod/runpod_run.py` never fetches); fixed
offline by pinning those specs in `tensor-pins.yaml`, installing them before the python block,
renaming the log to `_training.log`, and adding a heartbeat — live-proven 2026-09-16 (pod
symlq3jynb83a8).

**Rollout note (2026-09-16, fourth attempt, third caption pod `d84dzamf8gccbu`, $0.084):** deps
installed and Qwen3-VL-8B loaded, and a caption was generated — then the pod's own validator
rejected it: the body was ~560 chars against a hardcoded 500-char cap, contradicting the pinned
`max_new_tokens: 128` setting (up to ~900 chars of English). Fixed offline by raising the bound to
`CAPTIONS_MAX_BODY_CHARS = 1200` (`train/build_training_set.py`), rendered into the template as
`{{caption_max_body_chars}}` instead of a hardcoded literal; still a hard failure past the bound,
never a silent truncation — live-proven 2026-09-16 (pod symlq3jynb83a8): pod symlq3jynb83a8
(run.json `termination_verified: true`, $0.1234) produced 32 captions with bodies 367–647 chars.

**Yield arithmetic:** the qwen-edit dataset produces 30 base cells per replicate — 15 face (`close`,
600px floor) + 10 half-body (`half`, 300px floor) + 5 full-body (`full`; `persona.yaml`
`identity.floor.min_face_px.by_framing` only overrides `"half"`, so `"full"` falls back to the
generic 600px floor, which its whole-body framing cannot clear structurally regardless of replicate
count — these 5 are an expected write-off, not a defect). That leaves 25 gateable cells (15 + 10) as
the real approval pool per replicate. At track1-dataset's own calibrated 71% judge pass rate (the
closest real precedent — this IS the same graph's prior calibration set), 25 cells yield an expected
~17.75 (~18) approvals: short of the ≥20 a training set needs. `dataset_replicates: 2` doubles the
gateable pool to 50 cells, for an expected ~35.5 approvals at 71% (or ~33 at expansion-03's more
conservative 66%) — comfortably above the 20 floor with real margin for a worse-than-calibration
live run. (`_dataset_jobs` replicates every row uniformly, including the 5 structurally-unclearable
full cells, for the sharding-simplicity reason `_dataset_manifests`'s own docstring gives — this
spends a little extra on cells that were never going to help the approval count, not a deliberate
yield optimization.)

## Model and licence

| Thing | What it is | Licence | Gated | Verdict |
|---|---|---|---|---|
| `krea/Krea-2-Raw` | 12–13 B MMDiT, `raw.safetensors`; the model module 11 selects | Krea 2 Community License | **Yes** — access request + AUP | Not usable: the harness sends no HF token and never will (GUARDRAIL 5) |
| `Comfy-Org/Krea-2` → `diffusion_models/krea2_raw_bf16.safetensors` | Same weights, repackaged | Same Krea 2 Community License (`LICENSE.pdf` in repo) | **No** (`"gated": false`) | **Track 1 base.** Same model, no credential |
| `Comfy-Org/Krea-2` → `krea2_turbo_fp8_scaled` / `qwen3vl_4b_fp8_scaled` / `qwen_image_vae` | Inference trio for tester + module 09 | as above | No | Used as-is |
| `Qwen/Qwen3-VL-4B-Instruct`, `Qwen/Qwen-Image` (vae) | ai-toolkit's hardcoded text encoder and VAE for `arch: krea2` | Apache-2.0 | No | Pre-warmed in the readiness window |
| ostris/ai-toolkit | the trainer | MIT | — | Pinned at `b36bb399…` (v0.13.5, 2026-09-03) |
| RES4LYF | supplies the `res_2s` sampler; **not** ComfyUI core | AGPL-3.0 + no-commercial-image-service rider | — | Fine for our own generation; do not build a hosted generator on it. Core `res_multistep` is the AGPL-free fallback |
| `Phips/4xNomosWebPhoto_RealPLKSR` → `4xNomosWebPhoto_RealPLKSR.safetensors` | mid-chain upscaler | CC-BY-4.0 | No | Track-1 review finding 16: replaces `JCTN/UPSCALER_JCTN` → `4xNMKDSuperscale_4xNMKDSuperscale.pt` (unstated licence, `.pt` pickle) — the same substitute already used by the module-10 dataset port |

**FaceDetailer removed (finding 16).** `face_yolov8s.pt` (`Bingsu/adetailer`, Apache-2.0) is a
`.pt` pickle, which the brief forbids in any pod regardless of source licence. No verifiable
Apache/MIT **non-pickle** face detector was found to replace it: `ComfyUI-Impact-Subpack`'s
`ONNXDetectorProvider` node exists, but `Bingsu/adetailer` ships only `.pt` weights, and the one
ONNX face-detector repo found (`deepghs/yolo-face`) is under a custom
"model-distribution-disclaimer-license", not Apache/MIT. Per the brief's fallback, the
`UltralyticsDetectorProvider`/`FaceDetailer` branch (module 09 nodes 1631/1611) is dropped from
`creator-001-tensor-gen.yaml` entirely, and `ComfyUI-Impact-Pack`/`-Subpack` are no longer a
generation-stage dependency. Re-adding it needs a human-sourced, licence-verified ONNX (or other
non-pickle) face bbox detector — an open item, not resolved here.

Krea 2 Community License obligations that bind us: commercial use is free under **$1 M
trailing-12-month revenue and 50 seats**; a **content filter is mandatory** (our mandatory
visual QA, GUARDRAIL 4, is that filter — say so); a **redistributed** derivative model must
be named starting with "Krea" (we do not redistribute); AI disclosure where law or platform
requires it (the persona already carries it). The AUP bans CSAM, NCII/deepfakes of real
people, impersonation, publicity-right violations, and passing output off as human-made —
all already inside GUARDRAILS 1–3. Track 2, if the licence ever becomes unworkable:
`Qwen/Qwen-Image` (Apache-2.0, `arch: qwen_image`) — same lineage, since Krea-2 borrows
Qwen-Image's VAE and a Qwen3-VL encoder. Z-Image Base / klein 4B Base remain the cheap arms.

## Settings — theirs → ours

| Module 11 | Theirs | Ours | Note |
|---|---|---|---|
| model | Krea 2 (raw), gated repo | `krea2_raw_bf16.safetensors` from the ungated repackage | same weights |
| "do not use the turbo with the training adapter" | raw only | raw only | turbo is inference-only for us too |
| target / rank | LoRA / 32 | `network.linear: 32`, `linear_alpha: 32` | |
| optimizer / lr / weight decay | AdamW8Bit / 1e-4 / 1e-4 | `adamw8bit` / `1.0e-4` / `optimizer_params.weight_decay` | `1e-4` unquoted is a YAML *string*; must be `1.0e-4` |
| steps / batch / grad accum | 3000 / 1 / 1 | identical (F5) | see "Step count: 3000, screened by the tester" below — DOP (off in module 11) is the real, deliberate deviation on top |
| save dtype / every / keep | BF16 / 250 / 15 | identical | 15 is what makes every save rankable |
| quantize transformer / TE | qfloat8 / qfloat8, Low VRAM on, offload off | identical | |
| timestep / bias / loss | Linear / Balanced / MSE | identical | |
| cache text embeddings | ON | ON | |
| sampling | disabled (2 h → 70–80 min) | `disable_sampling: true` | |
| resolution buckets | 512 / 768 / 1024 | identical | |
| caption dropout / ext / repeats | 0.05 / txt / 1 | identical | |
| captions | Qwen3-VL auto-caption in the toolkit UI | `caption_mode` = `provided` (default) / `auto` / `single_word` | see below |
| GPU / wall clock | RTX PRO 6000 Blackwell 96 GB, 1 h 17 m | L40S 48 GB, **unmeasured** | the one number we cannot inherit |
| tester | 12 branches, one graph, seed 1595, 4 steps, cfg 1, res_2s/beta, 1448×2176, LoRA 1.0/1.0 | 12 **jobs**, one graph, all of the above identical | harness counts images per job, not graph branches; 12 jobs because our run (F5: steps=3000/save_every=250) now saves the same 11 intermediate checkpoints plus the final that module 11's own 12 branches ranked |
| module 09 | base 4-step → NMKD ×4 → ×0.25 → re-encode → 4-step @ 0.35 → FaceDetailer @ 0.15 | base 4-step → RealPLKSR ×4 → ×0.25 → re-encode → 4-step @ 0.35 | style LoRAs and FaceDetailer dropped (finding 16 — see the model/licence table) |

Captioning: their captioner is `Qwen/Qwen3-VL-8B-Instruct` (float8, max res 512, 128 new
tokens) driven from the toolkit's web UI, which we do not run. **Structural constraint:** the
harness uploads the dataset *after* ComfyUI readiness, so on-pod captioning cannot happen in
the readiness window — it would run inside the training job window and cost the model
download plus ~2 min. Default is therefore `provided`: captions come off the module-10
dataset stage as `.txt` sidecars and upload with the images. `auto` implements their step on
the pod (transformers + their caption instruction) and is **unverified — no pod has run it**.
`single_word` writes module 04/05's legacy `woman`; module 11 explicitly retired it, so it is
a fallback for a caption-free dataset only.

**Tonight's run (finding 9 closure): `class` captions, not descriptive-caption equivalence.**
`build_training_set.py --mode class` (via the new `--images-from <dir>...` multi-directory
form below) writes the single word `woman` as every image's caption sidecar — module 04/05's
legacy scheme, the one that actually produced the package's 2250-step winner per
`research/r15b-training.md`. Module 11's Qwen3-VL descriptive captioning remains a documented
`qwen3vl` hook only (raises `DatasetBuildError`, never silently substitutes); nothing here
claims it is implemented or equivalent. Because the dataset build step already writes the
caption sidecars, the train manifest's `training.caption_mode` stays `"provided"` — the start
script only verifies every image already has a non-empty `.txt` sidecar, it does not re-caption,
so `class`-mode output and human-provided captions take the identical runtime path.

`build_training_set.py` now also accepts `--images-from <dir> [<dir> ...]` (an alternative to
the single-directory `--source-dir`, `--mode class` only) plus an optional `--exclude <name>
...`. Images are collected in argument order and sorted by filename within each directory, so
several run output directories become one dataset without a manual copy/merge step; `--exclude`
drops named source files (matched by full filename or bare stem, e.g. a bad frame) before
numbering. Tonight's dataset is built from the anchor-pair dependency smoke plus dataset shards
01–03 (`expand/runs/out/creator-001-tensor-smoke`,
`expand/runs/out/creator-001-tensor-dataset-shard-01/02/03`), 31 images total:

```text
py -3 build_training_set.py --mode class \
  --images-from ../expand/runs/out/creator-001-tensor-smoke \
                ../expand/runs/out/creator-001-tensor-dataset-shard-01 \
                ../expand/runs/out/creator-001-tensor-dataset-shard-02 \
                ../expand/runs/out/creator-001-tensor-dataset-shard-03 \
  --out runs/creator-001-tensor-dataset
```

## Step order

1. Dataset stage (module-10 replication, `expand/`) produces shard PNGs. The operator grades
   them per `expand/TENSOR-REPLICATION.md`'s grading protocol and records the approved subset
   as `[{"image": ..., "caption": ...}]` (or leaves them for `--mode class`).
2. `py -3 build_training_set.py --approved-cells <operator-graded.json> --out
   runs/creator-001-tensor-dataset` (or `--source-dir <dir> --mode class`, or the new
   `--images-from <dir> ... [--exclude <name> ...] --mode class` multi-directory form) — the
   dataset-to-training bridge (Track-1 review finding 9). Writes `NN.png` + same-basename
   `.txt` captions, `dataset_manifest.json` (count, per-file sha256, caption mode; **not**
   `training.json` — see below), verifies every image/sidecar pair is on disk, then
   `_dataset.ready` last. `caption_mode`: `provided` (from the JSON, the default here), `class`
   (the single word `woman` — tonight's choice, see "Captioning" above), or `qwen3vl`
   (documented hook for module 11's auto-captioner — **not implemented**, raises rather than
   silently writing garbage captions).
3. `py -3 render_aitoolkit_config.py --template ai-toolkit-krea2.yaml.template --trigger
   creator001krea2 --dataset-dir /workspace/ComfyUI/input/creator001krea2 --out
   runs/creator-001-tensor-dataset/training.json`. This is the only writer of `training.json`
   in this directory — the ai-toolkit trainer config, uploaded and read by the pod as
   `training.config_name`. It refuses to write a config that has drifted off our numbers
   (module 11's, `steps` included since F5 restored 3000 as the default — see "Step count:
   3000, screened by the tester" below; `--allow-drift` to override, deliberately loud). The
   same command with `--set steps=100 --set save_every=50 --allow-drift` renders the
   reduced-step config the training smoke (next) uploads instead — same directory, same
   filename, run before the smoke and re-rendered back to our numbers (no `--set`, no
   `--allow-drift` needed) before the full run.

   **Checkpoint naming: the final step is bare, every other save is step-suffixed.** ai-toolkit
   writes every intermediate save (any step strictly below the run's `steps`) as
   `<trigger>_<step:09d>.safetensors`, but the save it writes AT the final step is named ONLY
   `<trigger>.safetensors` — there is no `<trigger>_<final step>.safetensors` file. Confirmed two
   ways: the package's own dataset tester names 11 intermediates `nikk_krea2_000000250` ...
   `_000002750` alongside a separately-named `nikk_krea2.safetensors`, and smoke #4 (steps=50,
   save_every=50 — one save point, which was also the final step) wrote only
   `creator001krea2.safetensors` plus `optimizer.pt`, no `creator001krea2_000000050.safetensors`.
   Smoke #4 aliased `training.checkpoint_steps` and `training.final_step` onto that same step, so
   the wrapper's publish stage looked for a step-suffixed final file that could never exist and
   failed closed (`missing checkpoint(s) before publish`) after training itself had succeeded.
   `start-training-aitoolkit.sh.template`'s publish stage now sources the final checkpoint from
   `${trigger}.safetensors` (never `${trigger}_${final_step}.safetensors`) and additionally
   filters `checkpoint_steps` to entries strictly below `final_step` before treating them as
   intermediates, so a manifest that repeats the aliasing mistake can't reproduce the failure.
3a. `runs/creator-001-tensor-train-smoke.yaml` — findings 13/14's gate. Same image, same
   `ai-toolkit` pin, same Krea-2 raw model pin, and the same `start-training-aitoolkit.sh.template`
   as the full run, but the uploaded `training.json` is the steps=100/save_every=50 render from
   step 3. It exercises the entire path — install, `torch.cuda.is_available()`, `ai-toolkit`
   import, the Krea raw `state_dict` load, 100 training steps, two saves, publish, completion
   marker — at a $2.28 ceiling instead of the full run's $5.85+. Its `training.checkpoint_steps`
   names the one step-50 intermediate save and `training.final_step` is 100 — deliberately a
   different step, not the same one smoke #4 used, so the intermediate and bare-final publish
   paths are genuinely exercised as distinct files (1+1) instead of the same step aliased twice.
   A third declared artifact, `_training.log`, downloads the full `ai-toolkit` stdout/stderr so
   it can be inspected locally. **The full training run in step 4 is gated on this smoke's
   `_training.log` showing the Krea raw checkpoint's `state_dict` loaded with no
   `missing_keys`/`unexpected_keys` lines** (PyTorch's default `load_state_dict` behavior surfaces
   any key mismatch there) — the state-dict compatibility this document previously listed as
   unproved (former "What blocks a live run" item 4) and the torch/CUDA install combination
   (former item 3) are exactly what this smoke is designed to catch before the full ceiling is
   spent, not something proved by reading a safetensors header offline. Smoke #4 already cleared
   both: it trained at 3.85 s/step on L40S and ai-toolkit loaded the Krea raw checkpoint cleanly.
4. `runs/creator-001-tensor-train.yaml` — bootstrap pulls the base; the start script installs
   ai-toolkit at the pin, restores ComfyUI's requirements, pre-warms the encoder/VAE, and then
   starts ComfyUI as a CPU-only, custom-node-free transport. No package install occurs after
   ComfyUI is live. The harness uploads the
   dataset (`NN.png`/`NN.txt`/`training.json`, then `_dataset.ready`); the script captions
   (module 04/05 `single_word` fallback only — `provided` is the default and already captioned
   by step 2), records resource limits, runs `run.py training.json` under `nohup` while
   streaming `_training.log` and a 30-second heartbeat, then verifies and copies **all 12**
   declared checkpoints (the 11 save-every-250 steps plus the exact step-3000 final under its
   bare trigger name, never an mtime-sorted guess) into `/workspace/output/`, writes a
   `_checkpoints.json` index, and only then touches `_training.complete` — failing closed with
   `_training.failed` if any of the 8 is missing or empty (finding 10).
5. `runs/creator-001-tensor-tester.yaml` — no network volume. It uploads the 8 checkpoints the
   training run downloaded locally (`uploads` glob on `out/creator-001-tensor-train/*.safetensors`,
   same shape as the dataset upload) into `ComfyUI/input/creator001krea2`, and the launcher
   symlinks that directory to `models/loras` (finding 12). Before the swap, ComfyUI's real
   `models/loras` (a shipped directory, never empty) is moved aside to `models/loras.stock`
   rather than deleted, since a harness model pin whose `destination_dir` is `models/loras`
   (e.g. `pins.style_loras`, `pins.gen`) downloads there before this launcher runs — the
   `gen` manifest's style-LoRA slot is exactly such a pin. `start-comfy-lorapath.sh.template`
   copies (never moves — `.stock` stays the record of what shipped/was pinned there) every
   `*.safetensors` out of `.stock` into the LoRA source directory after the symlink is in
   place, skipping any name already present there so an uploaded/assembled identity
   checkpoint is never overwritten; the shipped `put_loras_here` placeholder is not a
   `.safetensors` file and is left behind. Renders the same
   prompt/seed/sampler/resolution 8 times with only `lora_name` varying. Operator eye-picks
   the winner (theirs, on their 3000-step/12-checkpoint run, was step 1250).
6. Copy the winner into `runs/creator-001-tensor-winner/`, then
   `runs/creator-001-tensor-gen.yaml` — 6 prompts × 2 seeds of angles and scenes the dataset
   never contained, identity LoRA at 0.80. Two `SaveImage` outputs per job (base, refined) —
   the FaceDetailer "final" branch is gone (finding 16); see the model/licence table.
7. Grade: `identity_check.py` own-anchor cosine over the 12 outputs **and** a full-resolution
   operator pass. Module 11's rule stands — the checkpoint is chosen by eye on a fixed grid,
   the cosine only vetoes.

## Cost and time per stage

| Stage | GPU | readiness / job ceiling | `max_minutes` | rate | preflight estimate | expected actual |
|---|---|---|---|---|---|---|
| train-smoke (findings 13/14 gate) | L40S | 3600 s / 1800 s + 2 × 180 s artifact allowance | 105 | $1.30/h | **$2.2750** | ~45–60 min setup + a few min for 100 steps (measured: 3.85 s/step) |
| train | L40S | 3600 s / 10800 s + 7 × 180 s artifact allowance | 270 | $1.30/h | **$5.8500** | 45–60 min setup + ~2000 × 3.85 s ≈ 128 min train |
| tester | L40S | 2400 s / 300 s × 8 | 105 | $1.30/h | **$2.2750** | ~15 min setup + ~5 min render |
| gen | L40S | 2400 s / 600 s × 12 | 165 | $1.30/h | **$3.5750** | ~15 min setup + ~20 min render |

Rate is Track-1 review finding 15: `$0.89/h` was an underdeclared, unverified L40S price; use the
conservative `$1.30/h` the dataset port already uses everywhere until a live quote is recorded.
`max_minutes` for train is **270** (`readiness 3600 + job_timeout 10800 + artifact_download_seconds
180 × 8 + teardown 300 = 16140 s = 269 min` floor, rounded up for buffer; see
`HARNESS-CHANGES.md` and `pod/runpod_run.py::minimum_runtime_minutes` — one shared job-timeout
budget for the completion marker plus one `artifact_download_seconds` allowance per further
artifact, not `job_timeout × 8`). `max_minutes` for train-smoke is **105**
(`3600 + 1800 + 180 × 3 + 300 = 6240 s = 104 min` floor, rounded up). Ceiling = rate ×
`max_minutes` / 60 for each stage. All manifests are `--dry-run` green and network-free, and all
of them (plus the dataset shards) also set `max_placement_attempts: 1` (finding 15 — no
automatic multi-pod retry on a live run). Run each with `--max-usd` at roughly the estimate.
`governance/budget.yaml` caps the day at **$10.00**; train ($5.85) and tester ($2.28) together
are $8.13, so gen must run on its own day (or a day where nothing else has spent yet), and the
ledger reconciliation review findings 1-2 flag must be resolved before trusting any daily total —
not addressed by this pass, see `REVIEW-2026-09-03-track1.md`.

**This table predates `_apply_train_budget` and F5's step count.** `train`'s row above is a
static, pre-defect-fix number (fixed 270 `max_minutes` at the pod-class pin floor, no DOP);
`train`'s ceiling is now derived dynamically from `training.steps`/`training.dop_enabled`
(never a fixed figure — `pipeline/README.md` "Spend guards") and `tester`'s `max_minutes` was
raised 115 -> 130 for the 12-job ladder (F5). Read `train`'s and `tester`'s real current
ceilings off your own `plan.json`, not this table; see "Step count: 3000, screened by the
tester" above for the current numbers and why train alone now needs its own day.

## Step count: 3000, screened by the tester

**Current ruling (F5, supersedes the earlier "2000, not 3000" pass below the fold).**
`personas/creator-001/training.yaml` and `MODULE_11["steps"]`/`check_module_11` in
`render_aitoolkit_config.py` both read `3000` — module 11's own number, restored. The
step count was never the load-bearing variable: `research/r25-why-they-can-and-we-cant.md`'s
own ranked, evidence-graded causes for the identity/quality gap rank "checkpoint not screened
against its own ranking" (#4, **moderate**) ahead of "2000 vs 3000 training steps" (#6, weak,
explicitly "already shown secondary to #4"). Our own tester data made #4 concrete: a
step-2000 run's own tester ranked step 1500 best, not the final step — trained-to-2000 was
never the same claim as "screened-to-2000," and a checkpoint promoted by *training to a step
count* rather than by *the tester's own ranking* is exactly the failure mode #4 names.
`apply-rulings --stage tester --checkpoint-step <N>` already requires an explicit, operator-
chosen produced step (`pipeline/README.md` "The gate") — training to 3000 does not change
that contract; it only gives the tester's 11-intermediate-plus-final ladder (`250..2750` +
the bare final at `3000`, matching module 11's own 12) more candidates to rank, including ones
past 1500 that a 2000-step run never produced. **Never default the chosen checkpoint to the
final step** — the same tester-ranking discipline that picked 1500 out of a 2000-step run
applies unchanged to a 3000-step run's own 12.

DOP (Differential Output Preservation) stays **on** in creator-001's live training.yaml. This
is a **deliberate deviation from module 11's own recipe, not drift** — `check_module_11`
correctly flags `train.diff_output_preservation: True != False` because DOP genuinely is not
part of 10sorLabs' module 11 chain; the deviation is argued, not accidental. It is r21's own
regularization lead (`research/r21-better-methods-2026.md` §Differential Output Preservation,
an official ai-toolkit feature) layered onto the train-first path chosen from r24's ranked
bakeoff shortlist (`research/r24-identity-transfer-bakeoff-candidates.md` "Ranked shortlist
for the bakeoff", item **4**: "Train-first Krea-2 LoRA … bake identity into weights first"),
together the r24-method-4-plus-r21-DOP combination `pipeline/README.md` already calls
Path-A. r25's own causes list folds the step-count question into #4 rather than treating it
independently (#6: "none standalone — folds into #4; a from-scratch 3000-step run with DOP …
is the natural follow-up") — this ruling is that follow-up.

**Cost consequence, not a free change.** Smoke #4 measured this harness's actual L40S
throughput at **3.85 s/step with DOP off** (2026-09-04,
`runs/out/creator-001-tensor-train-smoke/_harness/_training.log`) — that measurement cleared
torch/CUDA and the state-dict load (see "What blocks a live run" below) but does not describe
the live DOP path, which re-runs every step's forward pass an extra time for the regularization
target. `_apply_train_budget`'s `TRAIN_STEP_RATE_DOP_S = 9.0` (`figment_train.py`, r21) is the
measured-with-margin DOP rate; at `steps=3000` it derives `job_timeout_seconds`/`max_minutes`
dynamically per persona (never a fixed, unrecomputed pod-class pin — see `_apply_train_budget`
and `pipeline/README.md` "Spend guards"), landing at `ceiling_usd=$15.73` — comfortably inside
the $60.00 arc cap (raised from $50.00, operator ruling 2026-09-15; read live off the
resolved ledger at plan time, M3) but **above** the $10.00/day
governance limit on its own, so a live `train` run needs its own calendar day with no other
Figment spend, exactly like `gen` already does. `save_every` stays module 11's `250`, so the
checkpoint ladder is 11 intermediates (`250..2750`) plus the bare final at `3000` — 12
checkpoints, matching module 11's own 12, not the 8 an earlier 2000-step pass produced.

## Deviations, and why

1. **All twelve artifacts publish, no network volume (findings 10, 12).**
   `minimum_runtime_minutes` reserves one shared `job_timeout_seconds` budget for the
   completion-marker wait plus `artifact_download_seconds` (180 s) for each further artifact,
   not `job_timeout × artifact_count` — see `HARNESS-CHANGES.md`'s addendum. The start script
   verifies and copies the 11 save-every-250 checkpoints plus the exact step-3000 final (under
   its bare trigger name — see "Checkpoint naming" under Step order 3) into `/workspace/output/`
   (never an mtime-sorted guess) and fails closed before touching `_training.complete` if any is
   missing. The tester then uploads those 12 files from the harness's own local download
   directory — no recurring network-volume charge, no `REPLACE-WITH-RUNPOD-NETWORK-VOLUME-ID`
   sentinel. (Before F5's step count restored 3000, this was 8 files from a shorter 2000-step
   ladder — same mechanism, fewer checkpoints.)
2. **Tester is 12 jobs, not 12 graph branches.** The dry-run client returns exactly one image
   per job, so `expected_images > 1` can never be dry-run green. Twelve one-image jobs keep
   every variable except the checkpoint fixed, which is the whole point of §3g — twelve because
   our run's checkpoint ladder (F5: steps=3000/save_every=250, see "Step count" above) now
   matches module 11's own (steps=3000/save_every=250) exactly, rather than the shorter
   2000-step/8-job ladder an earlier pass ran.
3. **Generation has two `SaveImage` outputs (base, refined), not the package's three
   (finding 16).** `expected_images: 2` is dry-run green now that multi-image dry-run support
   exists (commit `fda03ba2`). The third output — the package's FaceDetailer "final" — has no
   surviving branch: see the model/licence table above for why FaceDetailer was removed
   outright rather than kept with a `.pt` pickle.
4. **No style LoRAs.** Their final stack adds `RealisticSnapshotKrea2` 1.5 and `pawg_krea2`
   0.65 — third-party assets, one of them explicitly adult-tier. Out of bounds (GUARDRAIL 3).
5. **No FaceDetailer, no SAM (finding 16).** `face_yolov8s.pt` was a `.pt` pickle regardless of
   its Apache-2.0 licence; no verifiable Apache/MIT non-pickle replacement was found. `sam_model_opt`
   was already optional and dropped before this pass.
6. **Their fixed test prompt and their 12-branch graph are not reproduced** — licensed course
   content. Our ranking prompt holds the same variables fixed and is our own text.
7. **ComfyUI `v0.20.1` is transport only.** ai-toolkit's requirements downgraded PyAV and
   broke ComfyUI v0.34.0's `ColorPrimaries` import. Training does not need ComfyUI's Krea
   nodes: the pinned v0.20.1 server runs with `--cpu --disable-all-custom-nodes`, and its own
   requirements are restored after toolkit install and before launch.
8. **Start-script templates live in `runs/`** beside their manifests: the harness resolves
   `training.start_script_file` relative to the manifest directory and rejects `..`.

## What blocks a live run

1. **Dataset dependency closure is unproved (review finding 8).** Before shard-01 spends its
   full ceiling, `expand/runs/creator-001-tensor-smoke.yaml` — same custom nodes, models, and
   ComfyUI as the shards, one real job on the anchor pair — must show every
   `STEP node-deps-* rc=0` in `_bootstrap.log`, the model sha checks passing, and the job
   succeeding. See `expand/TENSOR-REPLICATION.md`.
2. **Daily budget.** `governance/budget.yaml` caps the day at $10.00; the ledger reconciliation
   review findings 1-2 flag (canonical ops ledger vs. this worktree's untracked rows, UTC vs.
   America/New_York day boundary) is unresolved and out of this pass's scope — do not trust a
   daily total from either ledger location until it lands.
3. **torch/CUDA pin — CLEARED by smoke #4 (findings 13/14).**
   Upstream installs `torch==2.13.0+cu130`; our proven image is cuda 12.8.1.
   `reinstall_torch` is `"0"` (use the image's torch) and that combination was untested
   against ai-toolkit's requirements before smoke #4. Rather than an install-only probe pod
   that never runs a step, the training smoke (Step order 3a) runs the entire path — install,
   `torch.cuda.is_available()`, `ai-toolkit` import, real training steps, save, publish — at
   ~$2.28. Smoke #4 (2026-09-04, steps=50/save_every=50) ran this combination and trained
   cleanly at 3.85 s/step on L40S; the publish-stage failure it hit afterward was the
   step-suffixed-final-filename defect this pass fixes (see "Checkpoint naming" under Step
   order 3), not a torch/CUDA problem.
4. **State-dict key compatibility — CLEARED by smoke #4.** ai-toolkit derives Krea-2's
   MMDiT keys from `krea/Krea-2-Raw`'s `raw.safetensors`; the Comfy-Org bf16 repackage was
   assumed key-for-key identical. A safetensors-header read only proves the tensor names on
   disk match — it does not prove ai-toolkit's own key-mapping/renaming code accepts them
   without silently dropping or defaulting parameters. Smoke #4's `_training.log` settles
   this: PyTorch's default `load_state_dict` prints `missing_keys`/`unexpected_keys` lines on
   any mismatch, and none appear anywhere in the log — the checkpoint loaded clean. See Step
   order 3a.
5. **Third-party node input names** (`res_2s`) are transcribed from the package graph and are
   not validated by dry-run.
6. **Throughput on 48 GB — measured by smoke #4: 3.85 s/step, DOP off.** Their 77 min was a
   96 GB Blackwell. This was the 50-step probe that cleared torch/CUDA and the state-dict load
   (items 3-4 above); it does not describe the live DOP path (see "Step count: 3000, screened
   by the tester" above), whose extra regularization forward-pass raises the real per-step cost
   — `_apply_train_budget`'s `TRAIN_STEP_RATE_DOP_S = 9.0` (r21, measured-with-margin) is what
   the harness actually budgets against for `training.yaml`'s live `steps=3000`/
   `dop_enabled=true`, deriving `job_timeout_seconds`/`max_minutes` dynamically per persona
   rather than comparing a fixed step count against the pod-class pin's static
   `job_timeout_seconds: 10800` floor. Smoke #4's 3.85 s/step remains the correct lower bound
   for a non-DOP run and is not extrapolated linearly beyond its own 50-step sample (fixed
   setup/caching costs do not repeat per step, but memory pressure or thermal throttling over a
   longer run are not ruled out by it).
7. **Model provenance — closed (review finding 5).** Every model entry across
   `creator-001-tensor-train.yaml`, `-train-smoke.yaml`, `-tester.yaml`, and `-gen.yaml` now
   carries an immutable `revision` (40-hex commit) and a verified `sha256`, fetched from the
   Hugging Face tree API and cross-checked against each file's own `lastCommit.id`/`lfs.oid` —
   the same field shapes and method the re-review used to pin the smoke/shard manifests. See
   "Model and node pins" below for the table.

## Pod failure hardening (2026-09-04 diagnosis, folded from TRAIN-DIAG)

Attempt 2 (pod `xzpb5t5a9afbar`, before smoke #3/#4) reached readiness and uploaded the
dataset, then every `/view` poll returned 502 for the rest of the window — no training log was
recovered, and the old wrapper's EXIT trap killed ComfyUI on any trainer failure, destroying
its own evidence channel. Root cause was never proved directly (candidates ranked: trainer
exception/OOM during Krea load > cgroup RAM OOM > container restart > Comfy/trainer VRAM
contention), but is superseded — smoke #4 subsequently trained cleanly at 3.85 s/step with no
`missing_keys`/`unexpected_keys` (see "What blocks a live run" items 3/4 above). What is still
true and load-bearing, carried forward into the harness rather than left as a diagnosis:

- **Process order**: bootstrap installs ComfyUI + downloads the checkpoint, starts the
  training wrapper as `comfyui.start_command`, the wrapper installs pinned ai-toolkit,
  restores ComfyUI's requirements, pre-warms, then starts ComfyUI (CPU-only transport) in the
  background — no live-process package swap after that point.
- **Hardening now in the wrapper**: cgroup/host/GPU/disk/ulimit snapshots at start and
  pre-train; continuous trainer stdout/stderr streaming; a 30-second heartbeat; rc plus the
  last 40 log lines recorded on failure; Comfy left alive after a failure for retrieval;
  `expandable_segments:True` (mitigates CUDA allocator fragmentation, not weight residency or
  host OOM).
- **Marker-poll timeout**: five continuous minutes of marker HTTP 502 now fail early and
  trigger verified teardown, instead of polling for the full window with no evidence.
- **No RunPod container-log endpoint exists** (checked against the live REST OpenAPI) — the
  harness cannot create a `pod.log` itself; RunPod's own console is the only log view outside
  what the wrapper captures above.

## Model and node pins

Finding 5 closure for this directory's four manifests. Fetched
`https://huggingface.co/api/models/<repo>/tree/<revision>?recursive=true&expand=true`, took each
file's own `lastCommit.id` as `revision` and its `lfs.oid` as `sha256` (both 8/8 present since
every file here is Git-LFS), and additionally fetched
`https://huggingface.co/api/models/Comfy-Org/Krea-2` to confirm the repo `sha` (its current
default-branch HEAD, `e5ea8b4dd7f38f348b138eb0fe29f92c0e367e96`) postdates every pinned
`lastCommit.id` below, i.e. each pin is reachable from the repo's current history. The
`Phips/4xNomosWebPhoto_RealPLKSR` row reuses the pin `expand/runs/creator-001-tensor-smoke.yaml`
already carries for the same file — same repo, same filename, same digest.

| repo / file | used by | revision (`lastCommit.id`) | sha256 (`lfs.oid`) |
| --- | --- | --- | --- |
| `Comfy-Org/Krea-2` / `diffusion_models/krea2_raw_bf16.safetensors` | train, train-smoke | `5ea0b6cb7e43749e5202aed076e8ecbe04d2deee` | `f99bb0ff8e362b77342bc4994e0c50906fe7ef7074864b181b7d48d2fa6d03d7` |
| `Comfy-Org/Krea-2` / `diffusion_models/krea2_turbo_fp8_scaled.safetensors` | tester, gen | `3da2809e72fa04ba266e3b51c2a366fd04500b5a` | `eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1` |
| `Comfy-Org/Krea-2` / `text_encoders/qwen3vl_4b_fp8_scaled.safetensors` | tester, gen | `4aa0eed112bd2780ceea37583edbdcd2df6c2c09` | `54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094` |
| `Comfy-Org/Krea-2` / `vae/qwen_image_vae.safetensors` | tester, gen | `a0a28f7e5b645c950ad56fc2e45bfd3e0044c06e` | `a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f` |
| `Phips/4xNomosWebPhoto_RealPLKSR` / `4xNomosWebPhoto_RealPLKSR.safetensors` | gen | `ee1791235ab82e639bf6fde5581a2440771a14c0` | `9be0228f98156a100d6636d99b373ed2785b999723f9adc4cca504329ab157f2` |

The `vae/qwen_image_vae.safetensors` digest is byte-identical to the one
`expand/runs/creator-001-tensor-smoke.yaml` already carries for
`Comfy-Org/Qwen-Image_ComfyUI`'s copy of the same file — consistent with Krea-2's package
repackaging the same Qwen-Image VAE, not a coincidence.

All 8/8 unique file pins across this directory's four manifests are now verified; 0/8 resolve
mutable `main`. `pod/tests/test_runpod_run.py`'s `model_revision`/`model_sha256` accept every
value above (exercised by `train/tests/test_tensor_track.py::
test_every_model_entry_is_pinned_with_revision_and_sha256`).
