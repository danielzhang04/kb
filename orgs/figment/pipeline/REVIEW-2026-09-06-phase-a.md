# REVIEW — Phase A (module 03 anchor stage), commit `b28ab9ac`

Adversarial pre-spend review against plan tasks A1–A3 (`docs/superpowers/plans/2026-09-06-figment-track2-faithful-pipeline.md`), `GUARDRAILS.md`,
`look-spec-v2.md` §0/§4, `r15-10sorlabs-artefacts.md` §3a, the package graph
(`research/10sorlabs-package/03_generating_your_character/10sorlabs_image_generator.json`), `r22-clean-assets.md`, and `pod/README.md`. Read-only; no
pod run. Evidence: a real `plan --creator creator-001 --stage anchor` into scratch, `pytest tests/test_anchor_stage.py -q` (7 passed), live `curl -sI`
HEADs against huggingface.co.

## Verdict: **APPROVE WITH FIXES** — 4 HIGH (1–3 blocking), 5 MED, 6 LOW
Do not launch either pod until 1, 2 and 3 are fixed. The port is faithful and the promotion lock is well built; the
defects are local and cheap.

## HIGH
### 1. All four `pins.anchor` sha256 digests are wrong — every model download fails (BLOCKING)

`train/tensor-pins.yaml:71-74`. HF sets `x-linked-etag` to the LFS sha256; method cross-validated on two *existing* pins, which match byte-for-byte
(`Phips/4xNomosWebPhoto_RealPLKSR` → `9be0228f…`, `flux2-klein-4B/flux2-vae` → `868fe7b3…`).

| file | pinned | actual (`x-linked-etag`) |
|---|---|---|
| `z_image_turbo_bf16.safetensors` | `108e591e…a39be` | **`2407613050b809ffdff18a4ac99af83ea6b95443ecebdf80e064a79c825574a6`** |
| `qwen_3_4b.safetensors` | `f459cd74…c9995` | **`6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a`** |
| `ae.safetensors` | `f744f169…f827e` | **`afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38`** |
| `pytorch_lora_weights.safetensors` | `20fa0725…8dd6c` | **`b38b074964f1f6564c22fee42125accd7a218a916966b5d0f0b2f63d4939c2f7`** |

Bootstrap enforces them (`pod/runpod_run.py:2550,2556` → `MODEL sha256 mismatch`), so the passport pod dies in readiness after retrying 12 GB / 8 GB /
0.3 GB / 85 MB of downloads — the full $1.54 ceiling for zero images, and `max_placement_attempts: 1` makes the planned run dead. `qwen_3_4b`'s true
digest is *already in the file* at `:96` under `pins.dataset` — both repos ship the identical 8 044 982 048-byte file, which is how the mismatch is
self-evident. **Fix:** replace the four values with the bold column. Revisions and licences are correct: `Comfy-Org/z_image_turbo` @ `08d04455…` and
`suayptalha/Z-Image-Turbo-Realism-LoRA` @ `8dc179cb…` both resolve 200, both `cardData.license` = `apache-2.0`.

### 2. Persona rule broken — creator-001's look is hardcoded in the shared template (BLOCKING)

`expand/templates/anchor-prompts.yaml:12,29` carries the literal *"jet-black hair parted in the middle…, dark brown eyes, fair skin with visible pores
and texture, a thin brown line drawn close to the upper lash…"*. `_generalized_anchor_prompts` (`figment_train.py:247-256`) substitutes **nothing**
from the persona — it sets `prompts["persona"] = persona["id"]` and appends the camera clause. A creator-002 with a different description gets
creator-001's face verbatim, and `persona.yaml` has no field her look could come from (the only free text is `identity.spec.path` →
`identity-spec.md`). This breaks the plan's Global Constraint *"would this run unchanged for creator-002 from her `persona.yaml`?"* (plan:38). The
guarding test is a **false negative**: `test_anchor_prompts_are_persona_derived_and_carry_the_camera_clause` (`tests/test_anchor_stage.py:170-190`)
asserts only `p["persona"] == "creator-002"` and that the literals `creator-001`/`g01`/`g02`/`g07` are absent — none of which the hardcoded look
clause contains. Its name claims a property it never tests; the plan's Step-1 text has the same hole. **Fix:** add `identity.look` to `persona.yaml`
with `passport_clause` and `edit_clause` (creator-001's two current strings move there verbatim); set the template's two `identity` values to
`"{look}"`; in `_generalized_anchor_prompts` do `prompts[arm]["identity"] = persona["identity"]["look"][f"{arm}_clause"]` for `arm in
("passport","edit")`, raising `FigmentTrainError` when absent. Then build two personas with different look strings in test and assert the prompts
differ.

### 3. Not one of the 18 rendered prompts states clothing (BLOCKING)

Read from the generated manifests: all 12 passport and all 6 edit jobs render `<identity clause> + <row> + <camera clause>` with no garment anywhere.
The rows put her *"on the edge of a bed"*, *"at a bathroom vanity"*, *"a mirror selfie in a bedroom"*. GUARDRAILS #3 binds agents to the clothed
Instagram register; #4 records that silent clothing failures have already happened three times here. Three aggravating facts. (a) The negative prompt
cannot save it: at `cfg: 1.0` there is no classifier-free guidance, and this repo already wrote that down — `bakeoff/trial-03-brief.md:13`, *"Z-Image
Turbo distilled variants ignore negatives at CFG 1, so the positive prose is the operative control."* Node `5` is decorative. (b) The pipeline's own
precedent states it: `expand/templates/tensor-dataset-prompts.yaml` body identity says *"wearing a fitted black corset top and high-waisted black
shorts, both fully opaque and intact"*. (c) **The package we replicate dresses her** — node 4 reads *"wearing a fitted olive-green knit cardigan with
a deep V-neck"*. Dropping that sentence is an undocumented deviation covered by no D-number. **Fix — append to both `identity` values in
`anchor-prompts.yaml`, verbatim** (§4a-clean, matches the dataset register and `grammar.wardrobe_families`):

> ` wearing a fitted black corset top and high-waisted black shorts, both garments fully opaque and intact, covering her chest, torso and hips completely,`

Add a test asserting `"fully opaque and intact"` appears in every job's substituted prompt on both manifests.

### 4. The passport arm specifies no framing, so its faces land under the persona's own floor

All 12 passport rows are full-scene standing/sitting descriptions with no distance instruction, at 1536×2048, and D17 correctly drops both
`FaceDetailer` passes and the upscaler. `identity.floor.min_face_px` is **600**; a standing full-scene 3:4 frame puts the face nearer 200–400 px.
`personas/creator-001/identity-spec.md` ("Rule for expansion") already ruled on exactly this: *"generate the identity set at half-body/close framing
where the face is large… rather than a single full-frame swap."* The edit arm's 6 rows do carry close/half framings; the 12-job arm — the costlier
half of the $3.60 — risks an unusable board, and the picked cell becomes creator-001's identity of record for the LoRA. **Fix:** prefix passport rows
1–8 with `"Half-body framing from the waist up. "` and rows 9–12 with `"Close framing of her face and shoulders. "`; assert every passport row
contains `"framing"`.
## MED

5. **`ComfyUI-Impact-Subpack` is pinned into `pins.anchor_edit`** (`tensor-pins.yaml:107`) and reaches the live manifest. Plan H4 (`plan:10,493,1144`)
   says *"never re-add it"*, and the Global Constraint *"a node that no workflow's `class_type` list references is not pinned either"* applies: the
   only Impact class in the edit graph is `ImpactImageBatchToImageList`, base-pack (verified — 25 class types, no Subpack node). Plan:246 authorised
   the deep copy "after Task B1's Subpack removal", but B1 has not run, so Phase A ships the exposure a phase early. **It will not pull a `.pt` at
   bootstrap** — `runpod_run.py:2582-2584` installs only `requirements.txt`, never a node's `install.py`, so no YOLO weight is fetched. The real cost
   is `pip install ultralytics` and its dep tree inside the 2700 s readiness window, plus the licence surface r22 §5 tells us to avoid. **Fix:**
   delete the Subpack entry from `pins.anchor_edit.custom_nodes` now and record D23 here rather than in B1.
6. **The edit arm renders two contradictory look registers in one job.** Node `174` (Qwen-edit) gets the anchor clause with *"Do not alter facial
   features, skin tone, eye color, hair color, or hair texture"*, but stage B's `800` `CLIPTextEncode` still carries the *dataset* face identity — *"a
   sharp black liner line… flicked out past the corner, long defined lashes, soft blush high on the cheek, a soft pink lip with a wet shine"* — and
   `788` re-samples at denoise 0.23. The edit clause itself omits makeup entirely. So the 6 edit cells and 12 passport cells are graded at GATE 1
   under different makeup registers, and the winner's makeup comes from a template nobody meant to apply. **Fix:** substitute node `800`'s `text` per
   job with `prompts["edit"]["identity"]` in `_anchor_manifests`.
7. **`job_timeout_seconds: 180` for the passport arm is unproven and single-shot.** `exponential/res_8s` is an 8-stage RES sampler: 8 steps ≈ 64 model
   evaluations at 3.1 MP, plus VAE decode. Z-Image **Turbo** and `ClownsharKSampler_Beta` have never run live here (only Z-Image *Base*,
   `bakeoff/MANIFESTS.md`), there is no anchor smoke — contradicting `TENSOR-REPLICATION.md`'s own "Dependency smoke — required before shard-01"
   doctrine — and `max_placement_attempts: 1` means a first-job timeout kills the run. **Fix:** raise `anchor.job_timeout_seconds` to 300
   (`max_minutes` → 95, ceiling $2.06, arc $4.12), or plan a 1-job anchor smoke first. The smoke is the cheaper insurance.
8. **`plan["assets"]["persona_dir"]` is an absolute Windows path** (`figment_train.py:687`) while every other asset is `out`-relative. `apply_rulings`
   writes the promoted anchor and rewrites `persona.yaml` at that baked path, so a plan moved between checkouts silently promotes into the wrong tree.
   **Fix:** store it repo-relative, resolve against `ROOT`.
9. **Post-promotion staleness is silent.** After `apply-rulings --stage anchor`, `identity.references` = `[the one anchor]` but
   `body_target.exemplars` still says `["g02","g07"]`; `_generalized_dataset_workflow:262-266` then falls through to `references[-1]` with no warning,
   and `identity.calibration.anchor_pairwise` keeps describing the retired g-set. **Fix:** move `body_target.exemplars` and `identity.calibration`
   into `identity.history` on promotion, or raise when an exemplar stem resolves to nothing.

## LOW

10. `anchor-prompts.yaml` is not copied into the plan bundle (`_copy_support_files:609-622` copies only the dataset template), so `plan.json` is not a
    self-contained reproduction of the anchor prompts.
11. `workflow["832"]["inputs"]["filename_prefix"]` is a no-op — the harness overwrites it with `output_name` (`runpod_run.py:3272-3273`). Harmless,
    but it reads as load-bearing.
12. `pins.anchor` omits `avoid_machine_hosts: ["qvf79yutw3t2"]`, which `dataset` and `anchor_edit` both carry. Add it.
13. `apply_rulings` writes `anchors/{image_id}.png` regardless of source suffix; safe today because `SaveImage` emits PNG, but take the extension from
    `source.suffix`.
14. D20 understates what was dropped from package node 4: besides *"zero film grain"* and *"smooth skin"* the port also drops the CJK quality tokens,
    *"Sharp subject and background"*, and the `8k / max details / makeup on face / detailed face` tail. Defensible under §4a — but record it; the
    deviation log is the audit trail.
15. No test binds a pin's `sha256` to HF (only `len == 64`, `tests/test_anchor_stage.py:203-206`) — exactly why finding 1 shipped green. Add a
    network-marked pin-verification test or a pre-spend `verify-pins` step.

## What is correct — verified, not assumed

- **Fidelity to module 03 (r15 §3a) is exact.** `47 ClownsharKSampler_Beta`: eta 0.45, `exponential/res_8s`, `simple`, steps 8, `steps_to_run -1`,
  denoise 0.95, cfg 1.0, seed 148, `standard`, `bongmath true` — every value matches the package's `widgets_values`. `11 EmptyFlux2LatentImage`
  1536×2048. LoRA 0.66/0.66 (package `strengthTwo: null` → clip follows model). Node `5`'s negative is byte-identical to the package's. Node ids
  preserved. D19's seed fan-out renders exactly `148…159`. D20's camera clause is the package's own phrasing minus the r15b contradiction. D15–D18 are
  each justified and each removes a pickle or an unlicensed weight.
- **Licences.** All four anchor models Apache-2.0. The realism LoRA has no `LICENSE` file — the repo holds only `README.md`, the weights and sample
  images — so the claim rests on the card header (`cardData.license: apache-2.0`) plus the `license:apache-2.0` tag. Under "Licence before pin" that
  is a *stated* licence and r22 §4's caveat is recorded verbatim at `TENSOR-REPLICATION.md:164`: **sufficient**, but archive the card at the pinned
  revision so the claim survives an upstream edit.
- **Safety text.** No §4a banned literal appears in any rendered prompt (checked across every family incl. `luminous`, `full lips`, `winged eyeliner`,
  `defined jawline` as a beauty claim, `18`/`19`, `girl`, `youthful`). Age is §4c-compliant: *"a woman in her early twenties, about twenty-one"* plus
  three listed adult markers, never a bare numeral. No real-person name or likeness. Only the clothing gap (finding 3) breaks safety.
- **Promotion lock is real, not decorative.** Exactly-one-keep guard (`figment_train.py:1217-1221`, test `:260`); `identity.references` rewritten only
  inside `apply_rulings` and only for the approved row, with the pre-promotion list appended to `identity.history` (`persona.py:263-273` tolerates it
  without asset-checking); `build_plan` refuses to replan a promoted anchor and drops it from `--stage all` (`:686-695`, test `:276`);
  `run_planned_stage` treats a stage with `grade/<stage>/rulings.json` as settled and never reruns it (`:946-958`, test `:285`);
  `destination.exists()` blocks a second promotion to the same id.
- **Harness/spend.** Both manifests dry-run green through `runpod_run.py`. `minimum_runtime_minutes` is satisfied exactly: anchor `1800 + 180×12 + 300
  = 4260 s = 71 min`; anchor_edit `2700 + 450×6 + 300 = 5700 s = 95 min`. Ceilings $1.54 + $2.06 = **$3.60**, inside the $10/day guard and the $50 arc
  cap. `max_placement_attempts: 1` on both.
- **Board.** One `grade --stage anchor` board carries all 18 cells (`c001-anchor-p01…p12`, `c001-anchor-e01…e06`, unique) beside g01/g02/g07 at full
  resolution — correct pairing for the edit arm, which is seeded from g01 at node `836`.
