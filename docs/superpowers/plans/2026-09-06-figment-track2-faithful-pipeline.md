# Figment Track-2: the faithful 10sorlabs pipeline (module 03 → 09) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild creator-001's image pipeline the way 10sorlabs actually builds it — anchor (module 03) → dataset (module 10) → training (module 11) → generation (module 09) — driven end to end by `figment_train.py` from `persona.yaml`, with every licence-clean 2026 improvement folded in and every unclean package asset substituted.

**Architecture:** Six stages hang off the existing immutable `plan → run → grade → apply-rulings` contract in `orgs/figment/pipeline/figment_train.py`. Planning and grading are local; `run` is the only path that touches a pod, always through `pod/runpod_run.py` with a hash-pinned argv and no retries. Each stage ends at an operator gate that STOPS the chain.

**Tech Stack:** Python 3.12 (stdlib + Pillow + numpy), pytest, ComfyUI API-format workflow JSON, RunPod L40S via `pod/runpod_run.py`, Ostris ai-toolkit (pinned), Z-Image Turbo / Qwen-Image-Edit-2511 / FLUX.2 klein 4B / Krea-2.

**Spec:** the "Spec — approved design" section below (operator ruling, 2026-09-06), argued from `orgs/figment/research/`: `r20-fidelity-audit.md` (stage gap table), `r21-better-methods-2026.md` (adopt table), `r22-clean-assets.md` (licence-clean pins), `r15-10sorlabs-artefacts.md` §3a/§3e/§3f/§3g, `r15b-generation.md`:95–125, `r16-detail-passes.md` §1. Executors read this plan **and** those six files.

---

## Spec — approved design (operator ruling, 2026-09-06)

> "Build out the pipeline pretty much the exact same way 10sorlabs has unless online research indicates better ways, then test using our model."

1. **Anchor (module 03).** Z-Image Turbo passport prompt with the camera clause, 1536×2048, `ClownsharKSampler_Beta` eta 0.45 / `exponential/res_8s` / `simple` / 8 steps / cfg 1.0 / denoise 0.95, realism LoRA @0.66. 12 seeds from creator-001's *text* description + 6 seeds seeded from the existing anchor `g01` via the Qwen-edit method. **GATE 1** — the operator picks one. From then the picked anchor *is* creator-001: `identity.references` becomes `[that anchor]`; g01/g02/g07 kept as history.
2. **Dataset (module 10).** The existing port, re-pointed at the new anchor. Half-body-first framing with a second face-crop pass for full-body cells (`identity-spec.md` mitigation); skin-texture prompt clause; the Qwen-edit skin LoRA **only** if licence *and* 2511 compatibility check out. 30 raw cells. Captions written on the same pod by `Qwen/Qwen3-VL-8B-Instruct` after the last cell while the GPU is idle — short: trigger + one clause. The board carries **advisory** identity cosine, age delta, and raw quality metrics; it never auto-culls. **GATE 2** — operator culls via `grade --stage dataset` + `apply-rulings`.
3. **Training (module 11).** 3000 steps, save every 250; package settings otherwise unchanged (rank 32, alpha 32, lr 1e-4, adamw8bit, qfloat8/qfloat8, buckets 512/768/1024, cache text embeddings, sampling off). **No** `diff_output_preservation` on the first run — DOP is A/B-only, if age drift survives. Tester renders all 12 checkpoints. **GATE 3** — the operator rules the checkpoint; the chosen step is recorded in the persona's training state and used downstream.
4. **Generation (module 09).** The ported base → upscale → refine chain plus a FaceDetailer-equivalent with **no pickle weights** (licence-clean face mask → `MaskToSEGS` → `DetailerForEach`, denoise 0.15, guide 512, package numbers), plus a licence-clean realism LoRA in the style slot. **GATE 4** — final full-resolution board against the anchor.
5. **Acceptance.** Every stage runs through `figment_train.py` from `persona.yaml` (+ `training.yaml`). The scratchpad driver and hand-written Track-1 manifests are retired. A synthetic `creator-002` fixture proves no residue.

## Global Constraints

- **Persona rule.** Judge every task by *"would this run unchanged for creator-002 from her `persona.yaml`?"* No creator-001 string in code, template, or generated manifest.
- **`GUARDRAILS.md` binds:** no real-person likeness; unambiguously adult output; explicit-tier generation is the operator's; mandatory visual QA; credentials never handled as objects; rented compute terminated and *verified* on every exit path.
- **No pickle weights.** Only `.safetensors` / `.onnx` in a manifest. `.pt`, `.pth`, `.pth.tar`, `.bin` refused.
- **Licence before pin.** A model or node enters `tensor-pins.yaml` only with a stated licence recorded in `expand/TENSOR-REPLICATION.md`. Unstated licence = not clean = not pinned.
- **Pins are the only source** for models, node refs, GPU, price, disk, and every timeout: `pipeline/train/tensor-pins.yaml`. No generator inlines one.
- **`max_placement_attempts: 1`** everywhere. A failed planned run is dead; only a reviewed *new* plan retries.
- **Three proofs before any stage runs live:** `--dry-run` green through the planned argv; bash-executed launcher tests green (conventions at `train/tests/test_tensor_track.py:251-292`, `_lorapath_git_bash()` / `_run_lorapath_script()`); a `max_minutes` satisfying `runpod_run.minimum_runtime_minutes`.
- **Spend:** `$10.00/day` (`governance/budget.yaml`) and a `$50.00` arc cap over `figment-*.tsv`, both enforced in-harness, fail closed.
- **Branch** `claude/figment` in `C:\Users\danie\kb-worktrees\figment`. Never push to `main` or `ops`. Tests run from the repo root: `py -3 -m pytest <path> -q`. Paths below are relative to `orgs/figment/`.

### Spend table (L40S at `$1.30/h`)

| Manifest | `max_minutes` | Ceiling | Expected |
|---|---:|---:|---:|
| `<id>-anchor-passport` (12 jobs) | 71 | $1.54 | ~$0.55 |
| `<id>-anchor-edit` (6 jobs) | 95 | $2.06 | ~$0.60 |
| `<id>-tensor-dataset-shard-{01,02,03}` | 133 ea | $2.89 ea | ~$0.95 ea |
| `<id>-tensor-dataset-fullbody` (5 jobs) | 108 | $2.34 | ~$0.70 |
| `<id>-tensor-train-smoke` | 105 | $2.28 | ~$0.90 |
| `<id>-tensor-train` (3000 steps) | 323 | $7.00 | ~$4.92 |
| `<id>-tensor-tester` (12 checkpoints) | 123 | $2.67 | ~$0.80 |
| `<id>-tensor-gen` | 185 | $4.01 | ~$1.10 |

Expected arc **≈ $12.50**, ceilings **≈ $27.55** — above the brief's "≈$6–7" (Risks #5). Split across three days: anchor+dataset, train+tester, gen.

## File Structure

**Created:** `expand/workflows/zimage_passport_api.json` (module 03, API format) · `expand/templates/anchor-prompts.yaml` · `expand/workflows/tensor_dataset_fullbody_api.json` · `expand/runs/start-comfy-captioner.sh.template` · `pipeline/score_cells.py` · `train/workflows/krea2_gen_api.json` · `expand/templates/gen-prompts.yaml` · tests `pipeline/tests/test_anchor_stage.py`, `test_score_cells.py`, `test_gen_stage.py`.

**Modified:** `pipeline/figment_train.py` (`STAGES` gains `anchor`+`gen`; new builders; `grade`/`apply-rulings` gain `anchor`/`gen` and the checkpoint ruling) · `pipeline/training_config.py` · `train/tensor-pins.yaml` (`anchor`, `anchor_edit`, `dataset_fullbody`, `gen` stages) · `train/ai-toolkit-krea2.yaml.template` + `train/render_aitoolkit_config.py` · `expand/templates/tensor-dataset-prompts.yaml` · `pod/runpod_run.py` (`artifacts_after_jobs`) · `personas/creator-001/training.yaml` · `expand/TENSOR-REPLICATION.md` (D15–D24).

**Shared test helpers** (define once in `pipeline/tests/test_anchor_stage.py`, import elsewhere via `importlib` — there is no package `__init__.py`): the `command` fixture and `_synthetic_persona` come from `pipeline/tests/test_figment_train.py:32-43,93-137`; `_axes()` returns `{"identity": "pass", "realism": "pass", "hands": "pass", "lighting": "pass", "adult_read": "pass", "garment_integrity": "pass", "real_person_resemblance": "pass"}`; `_fake_stage_outputs(out, plan, stage)` writes one 8×8 PNG per job at `<out>/<run.out>/<output_name>.png`.

---

# Phase A — anchor stage (module 03)

### Task A1: Port module 03 and its prompt template

**Files:** Create `expand/workflows/zimage_passport_api.json`, `expand/templates/anchor-prompts.yaml`; Modify `figment_train.py`, `expand/TENSOR-REPLICATION.md`; Test `pipeline/tests/test_anchor_stage.py`

**Interfaces:** Produces an API workflow keeping the package's node ids — `1` UNETLoader, `2` CLIPLoader, `3` VAELoader, `4` CLIPTextEncode (positive), `5` (negative), `11` EmptyFlux2LatentImage, `47` ClownsharKSampler_Beta, `7` VAEDecode, `94` SaveImage — plus new `103` LoraLoader; Task A2 substitutes node `4`'s `text` and node `47`'s `seed`. Produces `_generalized_anchor_prompts(persona) -> {"persona", "camera_clause", "passport": {"identity", "rows"}, "edit": {"identity", "rows"}}`. Source: `research/10sorlabs-package/03_generating_your_character/10sorlabs_image_generator.json` (UI, 20 nodes), settings cross-read against r15 §3a. The template is JSON-in-`.yaml` like `expand/templates/tensor-dataset-prompts.yaml` (loader is `_read_json`).

- [ ] **Step 1: Write the failing tests**

```python
# pipeline/tests/test_anchor_stage.py
import json, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[4]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"
POD_RUNNER = PIPELINE / "pod" / "runpod_run.py"
WORKFLOW = PIPELINE / "expand" / "workflows" / "zimage_passport_api.json"

def test_passport_workflow_matches_module_03_settings():
    g = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    s = g["47"]["inputs"]
    assert g["47"]["class_type"] == "ClownsharKSampler_Beta"
    assert (s["eta"], s["sampler_name"], s["scheduler"], s["steps"], s["cfg"],
            s["denoise"]) == (0.45, "exponential/res_8s", "simple", 8, 1.0, 0.95)
    assert (g["11"]["inputs"]["width"], g["11"]["inputs"]["height"]) == (1536, 2048)
    assert g["1"]["inputs"]["unet_name"] == "z_image_turbo_bf16.safetensors"
    assert g["103"]["inputs"]["strength_model"] == 0.66
    for banned in ('.pt"', ".pth", "FaceDetailer", "UltralyticsDetectorProvider",
                   "SAMLoader", "zit_upscaler", "gravedigga", "creator-001", "g01"):
        assert banned not in WORKFLOW.read_text(encoding="utf-8"), banned

def test_anchor_prompts_are_persona_derived_and_carry_the_camera_clause(command, tmp_path):
    personas = _synthetic_persona(tmp_path, creator_id="creator-002")
    persona = command._load_inputs("creator-002", personas)[0]
    p = command._generalized_anchor_prompts(persona)
    assert p["persona"] == "creator-002"
    assert "24mm" in p["camera_clause"] and "zero film grain" not in p["camera_clause"]
    assert (len(p["passport"]["rows"]), len(p["edit"]["rows"])) == (12, 6)
    assert all(p["camera_clause"] in row for row in p["passport"]["rows"])
    for banned in ("creator-001", "g01", "g02", "g07", "youthful"):
        assert banned not in json.dumps(p), banned
```

- [ ] **Step 2: Run and see them fail** — `py -3 -m pytest orgs/figment/pipeline/tests/test_anchor_stage.py -q` → `FileNotFoundError`, then `AttributeError: _generalized_anchor_prompts`.

- [ ] **Step 3: Write the workflow.** Read the package's widget order first:

```bash
py -3 -c "import json;d=json.load(open(r'orgs/figment/research/10sorlabs-package/03_generating_your_character/10sorlabs_image_generator.json',encoding='utf-8'));[print(n['id'],n['type'],n.get('widgets_values')) for n in d['nodes']]"
```

Then write nine nodes as 2-space JSON:

```json
{"1": {"class_type": "UNETLoader", "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": "default"}},
 "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "lumina2", "device": "default"}},
 "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
 "103": {"class_type": "LoraLoader", "inputs": {"lora_name": "pytorch_lora_weights.safetensors", "strength_model": 0.66, "strength_clip": 0.66, "model": ["1", 0], "clip": ["2", 0]}},
 "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "REPLACED PER JOB", "clip": ["103", 1]}},
 "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "<package node 5, verbatim>", "clip": ["103", 1]}},
 "11": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": 1536, "height": 2048, "batch_size": 1}},
 "47": {"class_type": "ClownsharKSampler_Beta", "inputs": {"eta": 0.45, "sampler_name": "exponential/res_8s", "scheduler": "simple", "steps": 8, "steps_to_run": -1, "denoise": 0.95, "cfg": 1.0, "seed": 148, "sampler_mode": "standard", "bongmath": true, "model": ["103", 0], "positive": ["4", 0], "negative": ["5", 0], "latent_image": ["11", 0]}},
 "7": {"class_type": "VAEDecode", "inputs": {"samples": ["47", 0], "vae": ["3", 0]}},
 "94": {"class_type": "SaveImage", "inputs": {"filename_prefix": "anchor-passport", "images": ["7", 0]}}}
```

Copy the negative prompt from package node `5` **verbatim** (the anti-"AI look" list, `perfect symmetry, … overly refined rendering`) — it is already a de-gloss instrument; do not paraphrase.

- [ ] **Step 4: Write the prompt template and loader.** Camera clause = the package's own minus the contradiction r15b-generation:106–115 flags (it asks for "zero film grain" and "smooth realistic skin" alongside pores): `Shot on iPhone 15 Pro, handheld portrait perspective, 24mm, f/1.8. Natural colour saturation.` 12 passport rows, one Instagram-style scene each (window at night, daylight kitchen, mirror selfie, car passenger seat, café, bathroom vanity, balcony, bedroom lamp, stairwell, hallway flash, sofa, elevator); 6 edit rows are close/half framings for the Qwen-edit arm. Register words come from `pipeline/look-spec-v2.md` §0 only, no §4a banned literal, age as a life stage and never a numeral — the rule `tensor-dataset-prompts.yaml` states under `structure.register_source`.

```python
# figment_train.py
ANCHOR_PROMPTS_PATH = EXPAND_DIR / "templates" / "anchor-prompts.yaml"

def _generalized_anchor_prompts(persona: dict) -> dict[str, Any]:
    prompts = _read_json(ANCHOR_PROMPTS_PATH)
    prompts["persona"] = persona["id"]
    clause = prompts["camera_clause"]
    for arm in ("passport", "edit"):
        prompts[arm]["rows"] = [
            row if clause in row else f"{row} {clause}" for row in prompts[arm]["rows"]
        ]
    return prompts
```

- [ ] **Step 5: Record the substitutions** in `expand/TENSOR-REPLICATION.md` under a new "Module 03 → anchor stage" heading, continuing the D-numbering:

- **D15** — `realistic_snapshot_lora.safetensors` (gravedigga, unlicensed) → `suayptalha/Z-Image-Turbo-Realism-LoRA` `pytorch_lora_weights.safetensors`, Apache-2.0, same 0.66 strength (r22 §1).
- **D16** — `Power Lora Loader (rgthree)` → core `LoraLoader`; rgthree supplies nothing else the graph needs.
- **D17** — both `FaceDetailer` passes, `UltralyticsDetectorProvider` (`face_yolov8m.pt`), `SAMLoader` (`sam_vit_b_01ec64.pth`) and `zit_upscaler.safetensors` dropped here: all pickles or unlicensed (r20 "could not replicate" table). The anchor is graded at native 1536×2048; the licence-clean detailer arrives in Phase D.
- **D18** — `Image Comparer (rgthree)`, `Fast Groups Bypasser` and the two extra `SaveImage` nodes dropped (UI-only; the grading board is our comparer).
- **D19** — seed fan-out moved into the harness: `control_after_generate: increment` from 148 becomes 12 explicit job seeds `148…159`, reproducible from `plan.json`.
- **D20** — camera clause keeps the phone/lens/aperture, drops "zero film grain" and "smooth skin".

- [ ] **Step 6: Run the tests** → PASS. **Commit:**

```bash
git add orgs/figment/pipeline/expand orgs/figment/pipeline/figment_train.py orgs/figment/pipeline/tests/test_anchor_stage.py
git commit -m "feat(figment): port module 03 passport graph and its persona-derived prompts"
```

---

### Task A2: Pin and plan the anchor stage

**Files:** Modify `train/tensor-pins.yaml`, `figment_train.py` (`STAGES:48`, `build_plan:614-693`, new `_anchor_manifests`); Test `pipeline/tests/test_anchor_stage.py`

**Interfaces:** Produces `pins["pod_classes"]["l40s"]["stages"]["anchor"|"anchor_edit"]`, `pins["pins"]["anchor"|"anchor_edit"]`, and `_anchor_manifests(persona, training, pins, prompts) -> list[dict]` (exactly two manifests, written to `expand/runs/<id>-anchor-{passport,edit}.yaml`). Consumes `_pod_base:169`, `_generalized_dataset_workflow:245`, `_generalized_prompts:229`. `STAGES` becomes `("anchor", "dataset", "smoke", "train", "tester")` so `--stage all` runs the anchor first and the dataset-gate STOP at `:940-949` still holds.

- [ ] **Step 1: Resolve real revisions, hashes and licences — never invent them**

```bash
py -3 -c "
import json,urllib.request,sys
repo,f=sys.argv[1],sys.argv[2]
i=json.load(urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}?files_metadata=true'))
print(i['sha'], [s['lfs']['sha256'] for s in i['siblings'] if s['rfilename']==f],
      i.get('cardData',{}).get('license'))
" Comfy-Org/z_image_turbo split_files/diffusion_models/z_image_turbo_bf16.safetensors
```

Repeat for `Comfy-Org/z_image_turbo` `split_files/text_encoders/qwen_3_4b.safetensors` and `split_files/vae/ae.safetensors`, and `suayptalha/Z-Image-Turbo-Realism-LoRA` `pytorch_lora_weights.safetensors`. **STOP and report** if any licence is not `apache-2.0`. This command is the standard way every later task resolves a pin.

- [ ] **Step 2: Write the failing test**

```python
def test_anchor_pins_and_manifests(command, tmp_path):
    pins = json.loads((PIPELINE / "train/tensor-pins.yaml").read_text("utf-8"))
    stage = pins["pod_classes"]["l40s"]["stages"]["anchor"]
    assert (stage["max_minutes"], stage["job_timeout_seconds"]) == (71, 180)
    for key in ("anchor", "anchor_edit"):
        for m in pins["pins"][key]["models"]:
            assert m["filename"].endswith(".safetensors") and "gravedigga" not in m["repo_id"]
            assert len(m["revision"]) == 40 and len(m["sha256"]) == 64, m
    personas = _synthetic_persona(tmp_path, creator_id="creator-002")
    out = tmp_path / "plan"
    plan = command.build_plan("creator-002", "anchor", out, personas_root=personas)
    runs = plan["stages"]["anchor"]["runs"]
    assert [Path(r["manifest"]).name for r in runs] == [
        "creator-002-anchor-passport.yaml", "creator-002-anchor-edit.yaml"]
    passport = load_json(out / runs[0]["manifest"])
    assert [j["seed"] for j in passport["jobs"]] == list(range(148, 160))
    assert passport["max_placement_attempts"] == 1
    assert passport["jobs"][0]["output_name"] == "c002-anchor-p01"
    assert len(load_json(out / runs[1]["manifest"])["jobs"]) == 6
    for run in runs:
        r = subprocess.run([sys.executable, str(POD_RUNNER), "run", "--manifest",
            str(out / run["manifest"]), "--out", str(tmp_path / Path(run["manifest"]).stem),
            "--dry-run", "--max-minutes", "1"], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
```

- [ ] **Step 3: Run and see it fail** — `KeyError: 'anchor'`.

- [ ] **Step 4: Add the pins.** Under `pod_classes.l40s.stages`, in the shape of the existing `dataset` entry:

```json
"anchor": {"max_minutes": 71, "container_disk_gb": 100, "volume_gb": 0,
  "readiness_timeout_seconds": 1800, "job_timeout_seconds": 180,
  "comfyui": {"root": "/workspace/ComfyUI", "git_ref": "v0.20.1", "port": 8188, "start_command": "python main.py"}},
"anchor_edit": {"max_minutes": 95, "container_disk_gb": 100, "volume_gb": 0,
  "avoid_machine_hosts": ["qvf79yutw3t2"],
  "readiness_timeout_seconds": 2700, "job_timeout_seconds": 450,
  "comfyui": {"root": "/workspace/ComfyUI", "git_ref": "v0.20.1", "port": 8188, "start_command": "python main.py"}}
```

`minimum_runtime_minutes`: anchor `1800 + 180×12 + 300 = 4260 s = 71 min` ✅; anchor_edit `2700 + 450×6 + 300 = 5700 s = 95 min` ✅. Add `pins.anchor` = the three Z-Image models (into `models/{diffusion_models,text_encoders,vae}`) plus the realism LoRA (into `models/loras`, downloaded under its repo filename, so the workflow's `lora_name` stays `pytorch_lora_weights.safetensors`), with Step 1's `revision`/`sha256`; `custom_nodes` = `[{"name": "RES4LYF", "git_url": "https://github.com/ClownsharkBatwing/RES4LYF.git", "installer_pin": "e716cd1cb2c5cff90131bf4914b75b75a0489d48"}]`. Add `pins.anchor_edit` = a deep copy of `pins.dataset`.

- [ ] **Step 5: Implement `_anchor_manifests`**

```python
def _anchor_manifests(persona, training, pins, prompts):
    short = _creator_output_code(persona["id"])
    passport = {
        **_pod_base(pins, training["pod_class"], "anchor"),
        "models": deepcopy(pins["pins"]["anchor"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["anchor"]["custom_nodes"]),
        "workflow": "../workflows/zimage_passport_api.json",
        "seed_fields": ["seed"],
        "jobs": [{"seed": 148 + i, "output_name": f"{short}-anchor-p{i + 1:02d}",
                  "expected_images": 1,
                  "substitutions": [{"node_id": "4", "field": "text",
                      "value": prompts["passport"]["identity"] + " " + row}]}
                 for i, row in enumerate(prompts["passport"]["rows"])],
    }
    names = [Path(v).name for v in persona["identity"]["references"]]
    workflow = _generalized_dataset_workflow(persona, _generalized_prompts(persona))
    workflow["832"]["inputs"]["filename_prefix"] = f"{persona['id']}-anchor-edit"
    edit = {
        **_pod_base(pins, training["pod_class"], "anchor_edit"),
        "models": deepcopy(pins["pins"]["anchor_edit"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["anchor_edit"]["custom_nodes"]),
        "workflow": workflow, "seed_fields": ["seed"],
        "uploads": [{"files": [f"_uploads/{persona['id']}/{n}" for n in names],
                     "subfolder": persona["id"], "type": "input", "overwrite": True}],
        "jobs": [{"seed": 241731167782064,
                  "output_name": f"{short}-anchor-e{i + 1:02d}", "expected_images": 1,
                  "substitutions": [
                      {"node_id": "832", "field": "images", "value": ["791", 0]},
                      {"node_id": "788", "field": "seed", "value": 1098688918602660 + i},
                      {"node_id": "174", "field": "prompt",
                       "value": prompts["edit"]["identity"] + " " + row}]}
                 for i, row in enumerate(prompts["edit"]["rows"])],
    }
    return [passport, edit]
```

In `build_plan`, before the `dataset` branch, add `if current == "anchor": manifests = _anchor_manifests(persona, training, pins, _generalized_anchor_prompts(persona)); paths = [out / "expand" / "runs" / f"{creator_id}-anchor-{arm}.yaml" for arm in ("passport", "edit")]`, make `run_root` use the `expand` tree for `current in ("anchor", "dataset")`, and store `plan["assets"]["persona_dir"] = str(Path(persona["_persona_path"]).parent)` (Task A3 needs it).

- [ ] **Step 6: Run everything** — `py -3 -m pytest orgs/figment/pipeline/tests -q` → PASS, including the existing Track-1 reproduction test. **Commit:**

```bash
git add orgs/figment/pipeline/train/tensor-pins.yaml orgs/figment/pipeline/figment_train.py orgs/figment/pipeline/tests/test_anchor_stage.py
git commit -m "feat(figment): pin and plan the anchor stage (passport + edit arms)"
```

---

### Task A3: Grade and promote the anchor

**Files:** Modify `figment_train.py` (`build_grade:1024`, `apply_rulings:1112`, parser choices `:1234-1244`), `persona.py`; Test `pipeline/tests/test_anchor_stage.py`

**Interfaces:** `apply-rulings --stage anchor` requires exactly one `keep` across all 18 cells (all seven axes still required on every row), writes `grade/anchor/chosen-anchor.json` `{"schema": "figment/chosen-anchor@1", "creator", "image_id", "path", "sha256"}`, copies the picked PNG to `personas/<id>/anchors/<image_id>.png`, sets `identity.references = ["anchors/<image_id>.png"]`, and appends the previous list to a new optional `identity.history` array that `persona.py` tolerates but does not asset-check.

- [ ] **Step 1: Write the failing tests**

```python
def test_apply_anchor_rulings_promotes_exactly_one_pick(command, tmp_path):
    personas = _synthetic_persona(tmp_path, creator_id="creator-002")
    out = tmp_path / "plan"
    plan = command.build_plan("creator-002", "anchor", out, personas_root=personas)
    _fake_stage_outputs(out, plan, "anchor")
    grade = command.build_grade("creator-002", "anchor", out / "plan.json")
    template = load_json(Path(grade["rulings_template"]))
    for i, row in enumerate(template["rulings"]):
        row.update(_axes(), decision="keep" if i == 3 else "cull", why="fixture")
    filled = out / "filled.json"; filled.write_text(json.dumps(template), "utf-8")
    command.apply_rulings("creator-002", "anchor", out / "plan.json", filled)
    chosen = load_json(out / "grade" / "anchor" / "chosen-anchor.json")
    assert chosen["image_id"] == template["rulings"][3]["image_id"]
    persona = load_json(personas / "creator-002" / "persona.yaml")
    assert persona["identity"]["references"] == [f"anchors/{chosen['image_id']}.png"]
    assert persona["identity"]["history"]
    assert (personas / "creator-002" / "anchors" / f"{chosen['image_id']}.png").is_file()

def test_apply_anchor_rulings_refuses_two_keeps(command, tmp_path):
    ...  # same setup, keep rows 3 and 4
    with pytest.raises(command.FigmentTrainError, match="exactly one"):
        command.apply_rulings("creator-002", "anchor", out / "plan.json", filled)
```

- [ ] **Step 2: Run and see them fail** — `FigmentTrainError: grade stage must be dataset or tester`.

- [ ] **Step 3: Implement.** Allow `"anchor"` in `build_grade`, `apply_rulings` and both parser `--stage` choice tuples (`("anchor", "dataset", "tester")`). `_grading_html` needs no change: the anchor strip shows the persona's current references, which is exactly what is being replaced. In `apply_rulings`, after `_normalize_rulings`:

```python
if stage == "anchor":
    keeps = [r for r in normalized["rulings"] if r["decision"] == "keep"]
    if len(keeps) != 1:
        raise FigmentTrainError(
            f"anchor rulings must keep exactly one candidate, got {len(keeps)}")
```

and after `approved_rows` is built, for `stage == "anchor"`: copy the one approved image into `Path(plan["assets"]["persona_dir"]) / "anchors"`, write `chosen-anchor.json`, then `_read_json` the persona, set `identity["history"] = identity.get("history", []) + identity["references"]` and `identity["references"] = [f"anchors/{image_id}.png"]`, and `_write_json` it back.

- [ ] **Step 4: Run everything** — `py -3 -m pytest orgs/figment/pipeline/tests orgs/figment/pipeline/train/tests -q` → PASS (including `test_persona.py`). **Commit:**

```bash
git add orgs/figment/pipeline/figment_train.py orgs/figment/pipeline/persona.py orgs/figment/pipeline/tests
git commit -m "feat(figment): anchor grading promotes one pick into persona identity.references"
```

---

### Task A4: GATE 1 — operator picks the anchor (STOP)

**Files:** none changed. **Interfaces:** consumes A1–A3; produces `persona.yaml` with a single new reference.

- [ ] **Step 1: Plan and dry-run both arms**

```powershell
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage anchor --out C:/tmp/c001-anchor
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest C:/tmp/c001-anchor/expand/runs/creator-001-anchor-passport.yaml --out C:/tmp/c001-anchor/dry-passport --dry-run --max-minutes 1
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest C:/tmp/c001-anchor/expand/runs/creator-001-anchor-edit.yaml --out C:/tmp/c001-anchor/dry-edit --dry-run --max-minutes 1
```

Both exit 0; `plan.json` must show `ceiling_usd` `1.54` and `2.06`.

- [ ] **Step 2: STOP.** Report both ceilings, the day's ledger total, and the 12+6 prompt rows. **Do not run live without an explicit go.** Then:

```powershell
py -3 orgs/figment/pipeline/figment_train.py run --creator creator-001 --stage anchor --plan C:/tmp/c001-anchor/plan.json
py -3 orgs/figment/pipeline/figment_train.py grade --creator creator-001 --stage anchor --plan C:/tmp/c001-anchor/plan.json
```

- [ ] **Step 3: STOP — GATE 1.** Hand the operator `grade/anchor/board.html`. He views all 18 at full resolution and picks exactly one. Fill `rulings.template.json` → `filled.json` from his decisions on all seven axes. Never pick on his behalf; never keep a cell by a score.

- [ ] **Step 4: Apply and commit**

```powershell
py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator creator-001 --stage anchor --plan C:/tmp/c001-anchor/plan.json --rulings C:/tmp/c001-anchor/grade/anchor/filled.json
```

```bash
git add orgs/figment/personas/creator-001
git commit -m "feat(figment): creator-001 anchor of record from the module-03 passport run"
```

---

# Phase B — dataset stage (module 10)

### Task B1: Half-body framing, the full-body second pass, and the skin clause

**Files:** Modify `expand/templates/tensor-dataset-prompts.yaml`, `figment_train.py` (`_dataset_jobs:261`, `_dataset_manifests:283`), `train/tensor-pins.yaml`, `training_config.py`; Create `expand/workflows/tensor_dataset_fullbody_api.json`; Test `expand/tests/test_tensor_dataset.py`

**Interfaces:** Each `body.rows` entry becomes `{"text": str, "framing": "half"|"full"}` (`face.rows` stay strings); `full` rows route to a fourth manifest on the new workflow. Produces `training.skin_lora` — `null` (default) or a key of `pins["pins"]["skin_loras"]`; when set, `_dataset_manifests` appends the model and inserts a `LoraLoader` between node `89` (the Lightning LoRA) and node `66` (`ModelSamplingAuraFlow`). Reason for the framing change: `identity-spec.md` §"Composite findings" — full-frame face swaps come out mask-like when the face is small. Reason for the clause: r21 Q2 (2511 "plastic skin" is a chronic, named complaint).

- [ ] **Step 1: Write the failing test**

```python
def test_framing_policy_and_skin_clause(command, tmp_path):
    prompts = json.loads(
        (PIPELINE / "expand/templates/tensor-dataset-prompts.yaml").read_text("utf-8"))
    clause = ("skin with visible pores, fine vellus hair, and natural micro-texture, "
              "no retouching")
    assert clause in prompts["face"]["identity"] and clause in prompts["body"]["identity"]
    personas = _synthetic_persona(tmp_path, creator_id="creator-002")
    out = tmp_path / "p"
    runs = command.build_plan("creator-002", "dataset", out,
                              personas_root=personas)["stages"]["dataset"]["runs"]
    assert Path(runs[-1]["manifest"]).name == "creator-002-tensor-dataset-fullbody.yaml"
    shards = [load_json(out / r["manifest"]) for r in runs]
    assert sum(len(s["jobs"]) for s in shards) == 30 and len(shards[-1]["jobs"]) == 5
    assert shards[-1]["workflow"] == "../workflows/tensor_dataset_fullbody_api.json"
    assert all(s["workflow"] == "../workflows/tensor_dataset_v2_api.json" for s in shards[:-1])
    assert not any("skin" in m["repo_id"].lower() for m in shards[0]["models"])
```

- [ ] **Step 2: Run and see it fail** — three shards, not four; clause absent.

- [ ] **Step 3: Reframe the rows and add the clause.** Convert `body.rows` to objects: rows 1–4, 6, 8, 10–12, 15 take `"framing": "half"`; rows 5, 7, 9, 13, 14 (wide, low-angle, walking) take `"framing": "full"`. Rewrite every `half` row so the subject is framed no wider than mid-thigh and the face reads large — replace "medium shot", "framing the hips and thighs", and "walking away" phrasings, and reword row 15 (lying on her side) to frame from the waist up. Append the skin clause verbatim to `face.identity` and `body.identity`, replacing the weaker existing fragments ("fair skin with visible pores and texture" / "fair skin with visible texture") so the strings do not double up.

- [ ] **Step 4: Build the full-body workflow.** Copy `tensor_dataset_v2_api.json` and append a face-repair tail to the **body** branch only (its refine output is node `776` `VAEDecode`). New ids `950`+ so they never collide with the package's:

| Node | class_type | Key inputs |
|---|---|---|
| `950` | `FaceBoundingBox` | `analysis_models: ["699", 0]`, `image: ["776", 0]`, `padding: 15`, `index: 0` |
| `951` | `ImageResizeKJv2` | crop from `950` → `1024×1024`, `nearest-exact`, divisible-by 2 |
| `952` | `TextEncodeQwenImageEditPlus` | `clip: ["902", 0]`, `vae: ["903", 0]`, `image1: ["951", 0]`, `image2: ["698", 0]` (anchor face crop), `prompt` per job |
| `953` | `ConditioningZeroOut` | `conditioning: ["952", 0]` |
| `955` | `VAEEncode` | `pixels: ["951", 0]`, `vae: ["903", 0]` |
| `954` | `KSampler` | `model: ["66", 0]`, `positive: ["952", 0]`, `negative: ["953", 0]`, `latent_image: ["955", 0]`, `steps: 4`, `cfg: 1.0`, `euler`/`beta`, **`denoise: 0.23`** |
| `956` | `VAEDecode` | `samples: ["954", 0]`, `vae: ["903", 0]` |
| `957` | `ImageScale` | `956` back to the crop's original pixel size, `lanczos` |
| `958` | `ImageCompositeMasked` | `destination: ["776", 0]`, `source: ["957", 0]`, `x`/`y` from `950`, `resize_source: false` |

Point `832` `SaveImage.images` at `["958", 0]`. `0.23` is the package's own edit-pass denoise (r15 §3f) — do not raise it; higher redraws the identity instead of repairing it.

- [ ] **Step 5: Split the manifests and add the optional skin pin.** `_dataset_jobs` tags each body job with its row's framing; `_dataset_manifests` partitions face + `half` jobs into three 10-job shards on the v2 workflow, and `full` jobs into one `fullbody` manifest on the new workflow using a new `dataset_fullbody` pin stage (`readiness 2700`, `job_timeout_seconds 600`, `max_minutes 108`; `2700 + 600×5 + 450 + 300 = 6450 s` ✅ — the extra 450 s is Task B2's caption artifact). Add `skin_lora` to `TRAINING_KEYS`/`DEFAULT_TRAINING` (`None`) and to `tensor-pins.yaml`:

```json
"skin_loras": {"qwen-edit-skin": {
  "model": {"repo_id": "tlennon-ie/qwen-edit-skin", "filename": "qwen-edit-skin.safetensors",
            "revision": "<resolve per A2 step 1>", "sha256": "<resolve>",
            "destination_dir": "/workspace/ComfyUI/models/loras"},
  "licence": "apache-2.0 (model card header, r22 §3)",
  "base_note": "card demonstrates Qwen-Image-Edit-2509 only; 2511 compat UNVERIFIED",
  "strength": 0.6}}
```

Leave `training.yaml`'s `skin_lora: null` for creator-001.

- [ ] **Step 6: Record D21 and D22** in `TENSOR-REPLICATION.md`. **D21:** *full-body cells get a module-04-style `do-not-alter` second pass in-graph, per `identity-spec.md`'s face-pixel-density finding; this is our mitigation, not a port — the package has no equivalent.* **D22:** *enabling `skin_lora` requires a single-cell live check first (face row 1, LoRA on vs off, same seed, compared at full resolution by the operator), because r22 could not confirm 2511 compatibility.*

- [ ] **Step 7: Run tests and commit** — `py -3 -m pytest orgs/figment/pipeline/expand/tests orgs/figment/pipeline/tests -q` → PASS.

```bash
git add orgs/figment/pipeline/expand orgs/figment/pipeline/figment_train.py orgs/figment/pipeline/train/tensor-pins.yaml orgs/figment/pipeline/training_config.py
git commit -m "feat(figment): half-body framing, full-body face repair, skin clause and LoRA slot"
```

---

### Task B2: On-pod Qwen3-VL captions

**Files:** Modify `pod/runpod_run.py` (`minimum_runtime_minutes:1715`, the `if artifacts:` branch at `:3885`), `figment_train.py`, `train/tensor-pins.yaml`; Create `expand/runs/start-comfy-captioner.sh.template`; Test `pod/tests/test_runpod_run.py`, `expand/tests/test_tensor_dataset.py`

**Interfaces:** New manifest key `artifacts_after_jobs: true` — jobs are submitted first, *then* the artifact loop runs (today they are mutually exclusive: `:3885` is `if artifacts: … else: <jobs>`). Each shard declares exactly **one** artifact, `_captions.json`, a `{output_name: caption}` object; ten `.txt` artifacts would add `9 × artifact_download_seconds` = 1620 s per shard. `apply_rulings` merges the bundles and calls `build_training_set(approved_cells=<generated JSON>, caption_mode="provided")` instead of today's `caption_mode="class"`.

- [ ] **Step 1: Write the failing harness test**

```python
def test_artifacts_after_jobs_budgets_both_loops(harness):
    manifest = dict(BASE_MANIFEST, artifacts_after_jobs=True)
    manifest["jobs"] = [dict(BASE_JOB), dict(BASE_JOB, output_name="cell-02")]
    manifest["training"] = {
        "failed_marker": "/workspace/output/_captions.failed",
        "complete_marker": "/workspace/output/_captions.complete",
        "start_script_path": "/workspace/start-comfy-captioner.sh",
        "start_script_file": "start-comfy-captioner.sh.template"}
    manifest["artifacts"] = [{"remote": "_captions.json", "type": "output",
                              "local": "_captions.json", "wait_for": "_captions.complete"}]
    expected = (manifest["readiness_timeout_seconds"]
                + manifest["job_timeout_seconds"] * 3) / 60.0 + 5.0
    assert harness.minimum_runtime_minutes(manifest) == pytest.approx(expected)
```

- [ ] **Step 2: Run and see it fail** — `py -3 -m pytest orgs/figment/pipeline/pod/tests/test_runpod_run.py -q -k artifacts_after_jobs` → artifact mode ignores `jobs` in the budget.

- [ ] **Step 3: Change the harness.** In `minimum_runtime_minutes`, when `artifacts_after_jobs` is truthy and `artifacts` is present, `work_seconds` = the existing jobs branch **plus** the existing artifacts branch; reject a non-boolean value and reject `artifacts_after_jobs: true` without `artifacts`. At `:3885`, change the guard to `if artifacts and not manifest.get("artifacts_after_jobs"):`, extract the jobs loop and the artifact loop into two local functions, and for the new path call jobs then artifacts. `artifact_marker_deadline = time.monotonic() + per_job_timeout` is unchanged code — it must simply be *reached* after the jobs finish.

- [ ] **Step 4: Write the captioner launcher.** `start-comfy-captioner.sh.template`, same `set -euo pipefail` / `log()` / `fail()` shape as `train/runs/start-training-aitoolkit.sh.template`:

1. `python /workspace/ComfyUI/main.py "$@" &`, record `comfy_pid`.
2. Background a loop that waits until `{{expected_cells}}` `*.png` files exist under `/workspace/output`.
3. Free the GPU **without killing ComfyUI** (the harness downloads through its `/view` endpoint): `curl -s -X POST -H 'Content-Type: application/json' -d '{"unload_models":true,"free_memory":true}' http://127.0.0.1:8188/free`.
4. Run the same heredoc Python the `auto` branch of `start-training-aitoolkit.sh.template` already contains (`AutoProcessor` / `AutoModelForImageTextToText`, `dtype=torch.bfloat16`, `device_map="auto"`) against `{{caption_model}}`, `max_new_tokens=32`, with this instruction: *"Reply with ONE short clause, at most twelve words, describing only the camera framing, the pose, and the lighting. Do not describe the person's appearance, age, clothing, or identity. No preamble, no full sentence, no trailing period."*
5. Write `/workspace/output/_captions.json` as `{stem: "{{trigger}}, " + clause}`, then `touch /workspace/output/_captions.complete`. Any failure writes the reason to `_captions.failed` and exits nonzero.
6. `wait "$comfy_pid"`.

Add a `FIGMENT_CAPTION_STUB=1` branch that emits `stub clause` per image so the script is testable without a GPU.

- [ ] **Step 5: Write the bash-executed launcher test** in `expand/tests/test_tensor_dataset.py`, copying `_lorapath_git_bash()` / `_run_lorapath_script()` from `train/tests/test_tensor_track.py:251-292`:

```python
def test_captioner_writes_a_bundle_and_completion_marker(tmp_path, monkeypatch):
    bash = _git_bash()
    if bash is None:
        pytest.skip("git bash not available")
    monkeypatch.setenv("FIGMENT_CAPTION_STUB", "1")
    script = _render(CAPTIONER_TEMPLATE, {"expected_cells": "2",
        "trigger": "creator002krea2", "caption_model": "stub"})
    out = _run_captioner(bash, script, tmp_path, cells=["cell-01", "cell-02"])
    assert json.loads((out / "_captions.json").read_text("utf-8")) == {
        "cell-01": "creator002krea2, stub clause",
        "cell-02": "creator002krea2, stub clause"}
    assert (out / "_captions.complete").is_file()
```

- [ ] **Step 6: Wire the manifests and `apply_rulings`.** Every dataset manifest (including `fullbody`) gains `artifacts_after_jobs: true`, the `training` block above with `{{expected_cells}}` = `len(jobs)`, `comfyui.start_command: "bash /workspace/start-comfy-captioner.sh"`, and the single `_captions.json` artifact; `stages.dataset.max_minutes` rises to `133` (`2700 + 450×10 + 450 + 300 = 7950 s`). `_copy_support_files:560` copies the captioner template alongside the two existing launchers with the same creator/trigger rebinding. In `apply_rulings` for `stage == "dataset"`, load each shard's `root / run["out"] / "_captions.json"`, merge, build `approved_cells.json` = `[{"image": <approved copy path>, "caption": bundle[image_id]}, …]`, and pass it to `build_training_set(approved_cells=…, caption_mode="provided", out_dir=temporary_dataset)`. Fail closed if any approved cell has no caption.

- [ ] **Step 7: Run everything and commit** — `py -3 -m pytest orgs/figment/pipeline -q` → PASS, all 152+ pod tests included.

```bash
git add orgs/figment/pipeline/pod orgs/figment/pipeline/expand orgs/figment/pipeline/figment_train.py orgs/figment/pipeline/train/tensor-pins.yaml
git commit -m "feat(figment): on-pod Qwen3-VL captions as a post-jobs artifact bundle"
```

---

### Task B3: Advisory scorers on the grading board

**Files:** Create `pipeline/score_cells.py`; Modify `figment_train.py` (`build_grade`, `_grading_html:990`); Test `pipeline/tests/test_score_cells.py`

**Interfaces:** Produces `score(images: list[dict], anchors: list[Path], out: Path) -> dict` writing `grade/<stage>/advisory.json` = `{"schema": "figment/advisory@1", "rows": [{"image_id", "anchor_cosine", "age_delta_years", "laplacian_variance", "clipped_highlight_fraction", "local_luminance_variance", "unavailable_reason"}]}`; every field may be `None`. **These numbers never keep or cull a cell** — `TENSOR-REPLICATION.md` "Grading protocol": *"Automated similarity numbers may annotate a card, never keep or cull one."*

- [ ] **Step 1: Write the failing tests**

```python
def test_advisory_scores_annotate_and_never_gate(tmp_path):
    scorer = load_module("score_cells", PIPELINE / "score_cells.py")
    doc = scorer.score(images=[{"image_id": "c002-tds-f01",
                                "path": str(_png(tmp_path, "a.png"))}],
                       anchors=[_png(tmp_path, "anchor.png")], out=tmp_path)
    row = doc["rows"][0]
    assert set(row) == {"image_id", "anchor_cosine", "age_delta_years",
                        "laplacian_variance", "clipped_highlight_fraction",
                        "local_luminance_variance", "unavailable_reason"}
    assert "decision" not in json.dumps(row) and "cull" not in json.dumps(row)

def test_scorer_failure_is_recorded_not_raised(tmp_path):
    scorer = load_module("score_cells", PIPELINE / "score_cells.py")
    doc = scorer.score(images=[{"image_id": "x", "path": str(tmp_path / "missing.png")}],
                       anchors=[], out=tmp_path)
    assert doc["rows"][0]["anchor_cosine"] is None
    assert doc["rows"][0]["unavailable_reason"]
```

- [ ] **Step 2: Run and see them fail** — module missing.

- [ ] **Step 3: Implement**

```python
"""Advisory-only scores for a grading board. Never keeps, never culls."""
from pathlib import Path
import json

HERE = Path(__file__).resolve().parent
IDENTITY = HERE / "train" / "identity_check.py"
AGE_MODEL = "dima806/facial_age_image_detection"   # Apache-2.0 safetensors, r22 §6
FIELDS = ("anchor_cosine", "age_delta_years", "laplacian_variance",
          "clipped_highlight_fraction", "local_luminance_variance")

def score(images, anchors, out):
    identity = _load_module(IDENTITY)
    embed = identity.FaceNetEmbedder()
    anchor_vec, anchor_age = _mean_embedding(identity, embed, anchors), _mean_age(anchors)
    rows = []
    for item in images:
        row = {"image_id": item["image_id"], "unavailable_reason": None}
        row.update(dict.fromkeys(FIELDS))
        try:
            path = Path(item["path"])
            if anchor_vec is not None:
                row["anchor_cosine"] = identity.cosine(
                    anchor_vec, identity.vector(embed(path)))
            row.update({k: v for k, v in
                        identity._raw_metrics_for_image(path).items() if k in row})
            if anchor_age is not None:
                row["age_delta_years"] = abs(_expected_age(path) - anchor_age)
        except Exception as exc:                    # advisory: never fatal
            row["unavailable_reason"] = f"{type(exc).__name__}: {exc}"
        rows.append(row)
    document = {"schema": "figment/advisory@1", "rows": rows}
    (Path(out) / "advisory.json").write_text(json.dumps(document, indent=2), "utf-8")
    return document
```

`_expected_age` lazily imports `transformers`, runs `pipeline("image-classification", model=AGE_MODEL)` and returns `sum(bucket_midpoint * score)`; the model lives in the local HF cache and never goes on a pod. `_mean_embedding`/`_mean_age` return `None` for an empty or unreadable anchor list. `build_grade` calls `score_cells.score(images, anchors, grade_dir)` inside `try/except Exception` that logs and continues — a scorer outage must never block a gate. `_grading_html` renders per cell `cos <x.xxx> · Δage <±y.y> · lap <n> · clip <p%>` and puts the literal line **"advisory only — never keeps or culls"** in the page header.

- [ ] **Step 4: Run tests and commit** — `py -3 -m pytest orgs/figment/pipeline/tests -q` → PASS.

```bash
git add orgs/figment/pipeline/score_cells.py orgs/figment/pipeline/figment_train.py orgs/figment/pipeline/tests/test_score_cells.py
git commit -m "feat(figment): advisory identity/age/quality annotations on grading boards"
```

---

### Task B4: GATE 2 — operator culls the dataset (STOP)

**Files:** none changed.

- [ ] **Step 1: Re-plan against the new anchor and dry-run all four shards**

```powershell
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage all --out C:/tmp/c001-t2
```

Confirm `plan.json` `assets.anchors` names only the GATE-1 anchor and that four dataset manifests exist; run each planned `cli` line with `--dry-run --max-minutes 1` appended — all four exit 0.

- [ ] **Step 2: STOP** — present the four ceilings and the day's ledger. Run live only after the go:

```powershell
py -3 orgs/figment/pipeline/figment_train.py run --creator creator-001 --stage dataset --plan C:/tmp/c001-t2/plan.json
py -3 orgs/figment/pipeline/figment_train.py grade --creator creator-001 --stage dataset --plan C:/tmp/c001-t2/plan.json
```

- [ ] **Step 3: STOP — GATE 2.** The operator views all 30 at full resolution beside the anchor, one pair at a time, never a contact sheet. He culls; advisory numbers annotate only. `apply-rulings` refuses fewer than 20 keeps.

- [ ] **Step 4: Apply and verify**

```powershell
py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator creator-001 --stage dataset --plan C:/tmp/c001-t2/plan.json --rulings C:/tmp/c001-t2/grade/dataset/filled.json
```

Confirm `train/runs/<id>-tensor-dataset/` holds one `NN.png` + `NN.txt` per keep, every caption starts with the trigger, and `_dataset.ready` is the last file written.

---

# Phase C — training (module 11)

### Task C1: 3000 steps, the 12-checkpoint ladder, and an optional DOP flag

**Files:** Modify `train/render_aitoolkit_config.py` (`MODULE_11:114`, `check_module_11:158`), `train/ai-toolkit-krea2.yaml.template`, `training_config.py`, `figment_train.py` (`_render_training_config:538`), `personas/creator-001/training.yaml`, `train/tensor-pins.yaml`; Test `train/tests/test_tensor_track.py`, `pipeline/tests/test_figment_train.py`

**Interfaces:** `_checkpoint_steps(3000, 250)` = `[250 … 2750]`, so the tester ladder becomes 12 branches — the package's own count (r15 §3g) — with **no code change**; it is derived from `training.steps`/`save_every`. Produces `training.diff_output_preservation` (bool, default `false`) and `training.diff_output_preservation_class` (str, default `"person"`), mapped by `_render_training_config` to template context `dop_enabled`/`dop_multiplier`/`dop_class`. r20 divergence #7 records 2000 as a budget deviation, not a quality decision; r21 adopt #3 puts the convergent range at 2500–3000 and adopt #1 is DOP (Ostris official). DOP stays **off**: ~3× train time (≈$15 on L40S, above the daily guard), needs a trigger word, incompatible with `train_text_encoder: true` (ours is `false`).

- [ ] **Step 1: Write the failing tests**

```python
def test_module_11_recipe_is_3000_steps_and_the_ladder_is_twelve(command, tmp_path):
    renderer = load_module("render", PIPELINE / "train/render_aitoolkit_config.py")
    assert renderer.MODULE_11["steps"] == 3000
    personas = _synthetic_persona(tmp_path, creator_id="creator-002", steps=3000)
    plan = command.build_plan("creator-002", "tester", tmp_path / "p", personas_root=personas)
    assert len(load_json(tmp_path / "p" /
        plan["stages"]["tester"]["runs"][0]["manifest"])["jobs"]) == 12
    stages = json.loads((PIPELINE / "train/tensor-pins.yaml").read_text("utf-8")
                        )["pod_classes"]["l40s"]["stages"]
    assert (stages["train"]["job_timeout_seconds"], stages["train"]["max_minutes"],
            stages["tester"]["max_minutes"]) == (13500, 323, 123)

@pytest.mark.parametrize("enabled", [False, True])
def test_dop_is_off_by_default_and_renders_when_asked(enabled):
    renderer = load_module("render", PIPELINE / "train/render_aitoolkit_config.py")
    context = dict(renderer.MODULE_11, trigger="c002krea2",
                   dataset_dir="/workspace/ComfyUI/input/c002krea2",
                   output_dir="/workspace/train-output",
                   base_model_path="/workspace/models/krea2/krea2_raw_bf16.safetensors",
                   dop_enabled=str(enabled).lower())
    config = renderer.yaml.safe_load(renderer.render(TEMPLATE.read_text("utf-8"), context))
    train = config["config"]["process"][0]["train"]
    assert train["diff_output_preservation"] is enabled
    assert train["diff_output_preservation_class"] == "person"
    assert train["train_text_encoder"] is False
    assert renderer.check_module_11(config) == (
        [] if not enabled else ["train.diff_output_preservation: True != False"])
```

- [ ] **Step 2: Run and see them fail** — `MODULE_11["steps"] == 2000`; then `KeyError: 'diff_output_preservation'`.

- [ ] **Step 3: Implement the step change.** `MODULE_11["steps"] = 3000`; `check_module_11`'s `("train.steps", train["steps"], 2000)` becomes `3000`. Replace the stale comment above `MODULE_11` (it argues for 2000 on budget grounds) with the 2026-09-06 ruling and the measured cost: 3000 × 3.85 s/step ≈ 3.2 h ≈ $4.92 on L40S. `training.yaml`: `"steps": 3000`. Pins: `stages.train.job_timeout_seconds = 13500` and `max_minutes = 323` (`3600 + 13500 + 11×180 + 300 = 19380 s` ✅); `stages.tester.max_minutes = 123` (`2400 + 300×12 + 900 + 180 + 300 = 7380 s` ✅).

- [ ] **Step 4: Implement DOP.** In the template, inside `train:` after `disable_sampling`:

```yaml
        # r21 adopt #1 (Ostris official). OFF by default: ~3x train time, and the
        # 2026-09-06 ruling makes DOP an A/B only if age drift survives.
        diff_output_preservation: {{dop_enabled}}
        diff_output_preservation_multiplier: {{dop_multiplier}}
        diff_output_preservation_class: "{{dop_class}}"
```

Add `"dop_enabled": "false"`, `"dop_multiplier": "1.0"`, `"dop_class": "person"` to `MODULE_11` so `build_context` resolves them and `--set` can override them; add `("train.diff_output_preservation", train["diff_output_preservation"], False)` to `check_module_11`; add both persona keys to `TRAINING_KEYS`/`DEFAULT_TRAINING` with type validation.

- [ ] **Step 5: Regenerate the reproduction fixtures.** `test_creator001_plan_reproduces_current_manifest_documents_exactly` will now fail — correctly: the committed manifests are the 2000-step ones. Regenerate them from `build_plan` and commit them so the test keeps its meaning. Run `py -3 -m pytest orgs/figment/pipeline -q` → PASS.

- [ ] **Step 6: Commit**

```bash
git add orgs/figment/pipeline/train orgs/figment/pipeline/expand/runs orgs/figment/pipeline/training_config.py orgs/figment/pipeline/figment_train.py orgs/figment/personas/creator-001/training.yaml orgs/figment/pipeline/tests
git commit -m "feat(figment): module-11 fidelity - 3000 steps, 12-checkpoint ladder, optional DOP"
```

---

### Task C2: GATE 3 — operator rules the checkpoint (STOP)

**Files:** Modify `figment_train.py` (`apply_rulings` tester branch), `training_config.py`; Test `pipeline/tests/test_figment_train.py`

**Interfaces:** `apply-rulings --stage tester` requires exactly one `keep`, writes `grade/tester/chosen-checkpoint.json` `{"schema": "figment/chosen-checkpoint@1", "creator", "step": int|null, "lora_name": str}`, and writes `training.chosen_checkpoint_step` back into `personas/<id>/training.yaml`; Phase D reads it from the persona. r20 divergence #4: the previous run used the final checkpoint although own-anchor cosine peaked at step 1500 and was declining by 2000 — this makes skipping the ruling impossible.

- [ ] **Step 1: Write the failing test**

```python
def test_tester_rulings_record_exactly_one_checkpoint_into_the_persona(command, tmp_path):
    personas = _synthetic_persona(tmp_path, creator_id="creator-002", steps=3000)
    out = tmp_path / "p"
    plan = command.build_plan("creator-002", "tester", out, personas_root=personas)
    _fake_stage_outputs(out, plan, "tester")
    template = load_json(Path(command.build_grade(
        "creator-002", "tester", out / "plan.json")["rulings_template"]))
    assert len(template["rulings"]) == 12
    for i, row in enumerate(template["rulings"]):
        row.update(_axes(), decision="keep" if i == 5 else "cull", why="fixture")
    filled = out / "f.json"; filled.write_text(json.dumps(template), "utf-8")
    command.apply_rulings("creator-002", "tester", out / "plan.json", filled,
                          personas_root=personas)
    chosen = load_json(out / "grade" / "tester" / "chosen-checkpoint.json")
    assert chosen["step"] == 1500
    assert chosen["lora_name"] == "creator002krea2_000001500.safetensors"
    assert load_json(personas / "creator-002" / "training.yaml"
                     )["training"]["chosen_checkpoint_step"] == 1500
```

- [ ] **Step 2: Run and see it fail** — no `chosen-checkpoint.json`.

- [ ] **Step 3: Implement.** Add `chosen_checkpoint_step` to `TRAINING_KEYS`/`DEFAULT_TRAINING` (`None`), validated as `None` or a positive `int` equal to `steps` or a multiple of `save_every` strictly below `steps`. In `apply_rulings` for `stage == "tester"`: require exactly one keep; derive the step from the kept `image_id` (tester job names end `-<step:09d>` or `-final`, per `_tester_manifest:499`); write `chosen-checkpoint.json` with `lora_name = _checkpoint_name(trigger, step)`; `_read_json` `personas/<creator>/training.yaml`, set `training.chosen_checkpoint_step`, `_write_json` it back. Give `apply_rulings` a `personas_root: Path = PERSONAS_ROOT` keyword so the test can redirect it. Run `py -3 -m pytest orgs/figment/pipeline -q` → PASS.

- [ ] **Step 4: Run the stage.** `--stage all` resumes at smoke, then train, then tester:

```powershell
py -3 orgs/figment/pipeline/figment_train.py run --creator creator-001 --stage all --plan C:/tmp/c001-t2/plan.json
py -3 orgs/figment/pipeline/figment_train.py grade --creator creator-001 --stage tester --plan C:/tmp/c001-t2/plan.json
```

Before the train pod, confirm the smoke pod's `_training.log` shows the Krea-2 state dict loading with no missing/unexpected keys — `run_planned_stage` already checks this and stops if it does not.

- [ ] **Step 5: STOP — GATE 3.** Hand the operator `grade/tester/board.html`: 12 checkpoints, one fixed seed/prompt/sampler/resolution, the checkpoint the only free variable. He picks one. Then apply and commit:

```powershell
py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator creator-001 --stage tester --plan C:/tmp/c001-t2/plan.json --rulings C:/tmp/c001-t2/grade/tester/filled.json
```

```bash
git add orgs/figment/pipeline/figment_train.py orgs/figment/pipeline/training_config.py orgs/figment/pipeline/tests orgs/figment/personas/creator-001/training.yaml
git commit -m "feat(figment): tester ruling records the chosen checkpoint in the persona"
```

---

# Phase D — generation (module 09)

### Task D1: Verify and pin the licence-clean face-mask path

**Files:** Modify `train/tensor-pins.yaml`, `expand/TENSOR-REPLICATION.md`; Test `pipeline/tests/test_gen_stage.py`

**Interfaces:** Produces `pins["pins"]["gen"]` and `pins["pod_classes"]["l40s"]["stages"]["gen"]`, both verified against real refs before anything downstream uses them. r22 §4/§5: ComfyUI's **native** MediaPipe face detector (PR #14009, `mediapipe_face_fp32.safetensors`, Apache-2.0) needs no third-party node; base Impact-Pack registers `MaskToSEGS` and `DetailerForEach` and from v8.0 pulls no ultralytics and no `.pt`. **Never add Impact-Subpack.**

- [ ] **Step 1: Verify against real checkouts, then record what you actually find**

```bash
git clone --depth 1 --branch v0.34.0 https://github.com/comfyanonymous/ComfyUI /tmp/comfy-verify
grep -rn "mediapipe" /tmp/comfy-verify/comfy_extras/ /tmp/comfy-verify/nodes.py
git clone https://github.com/ltdrdata/ComfyUI-Impact-Pack /tmp/impact
git -C /tmp/impact checkout 429d0159ad429e64d2b3916e6e7be9c22d025c3c
grep -in "ultralytics" /tmp/impact/requirements.txt /tmp/impact/install.py
grep -n "MaskToSEGS\|DetailerForEach" /tmp/impact/node_list.json
```

Record as **D23**: the exact `class_type` the MediaPipe detector registers, its model `repo_id`/`filename`/`destination_dir`, and the Impact-Pack ref whose `requirements.txt` has no `ultralytics`. **STOP and report if the mediapipe grep is empty** — the options are (a) bump `comfyui.git_ref` to the first release containing PR #14009, or (b) the YuNet ONNX fallback (MIT, r22 §4). Never guess a node name. If the pinned Impact-Pack ref *does* list `ultralytics`, bump it to the first tag at or after v8.0 and re-record the pin: the bootstrap `pip install -r requirements.txt`s each custom node, so an `ultralytics` line would be pulled silently.

- [ ] **Step 2: Write the failing test**

```python
def test_gen_pins_have_no_subpack_and_no_pickle():
    gen = json.loads((PIPELINE / "train/tensor-pins.yaml").read_text("utf-8"))["pins"]["gen"]
    blob = json.dumps(gen).lower()
    assert "impact-subpack" not in blob and "ultralytics" not in blob
    for m in gen["models"]:
        assert m["filename"].endswith((".safetensors", ".onnx")), m
    assert any(m["filename"].endswith("mediapipe_face_fp32.safetensors") for m in gen["models"])
```

- [ ] **Step 3: Run and see it fail, then add the pins** — `KeyError: 'gen'`. `pins.gen` = the existing `pins.tester` models (Krea-2 turbo, `qwen3vl_4b` encoder, `qwen_image_vae`) + `Phips/4xNomosWebPhoto_RealPLKSR` + the MediaPipe face model from Step 1; `custom_nodes` = `[RES4LYF @ e716cd1…, ComfyUI-Impact-Pack @ <verified ref>]`. `pod_classes.l40s.stages.gen` mirrors the committed `train/runs/creator-001-tensor-gen.yaml`: readiness 2400, `job_timeout_seconds` 600, `upload_allowance_seconds` 300, `job_wait_for_seconds` 180, `max_minutes` 185, disk 80 / volume 120, comfyui `v0.34.0`.

- [ ] **Step 4: Run the test and commit** → PASS.

```bash
git add orgs/figment/pipeline/train/tensor-pins.yaml orgs/figment/pipeline/expand/TENSOR-REPLICATION.md orgs/figment/pipeline/tests/test_gen_stage.py
git commit -m "feat(figment): pin a pickle-free face-mask and Impact-Pack path for generation"
```

---

### Task D2: The generation workflow and the `gen` stage

**Files:** Create `train/workflows/krea2_gen_api.json`, `expand/templates/gen-prompts.yaml`; Modify `train/tensor-pins.yaml`, `training_config.py`, `figment_train.py` (`STAGES`, `build_plan`, new `_gen_manifest`, `_find_job_image:950`, parser choices); Test `pipeline/tests/test_gen_stage.py`

**Interfaces:** The workflow's base chain is node-identical to the committed `train/runs/creator-001-tensor-gen.yaml` (nodes `1`–`21`), extended with `40` (style LoRA) and `30`–`34` (detailer). Produces `training.style_lora` — `null`, `"inline-skin"` or `"gokay-realism"`, against `pins["pins"]["style_loras"]`. `build_plan(..., stage="gen")` raises `FigmentTrainError("gen requires a chosen checkpoint; run apply-rulings --stage tester first")` when `training["chosen_checkpoint_step"]` is `None`; it produces one manifest uploading only the chosen `.safetensors` with `chunk_bytes: 16777216`, first job carrying `wait_for: "_loras.assembled"`. `gen` is planned **separately** after GATE 3, not as part of `--stage all`. Package numbers to match exactly (r15 §3e): guide_size 512, steps 4, cfg 1.0, `euler`/`normal`, **denoise 0.15**, feather 5, bbox_threshold 0.40, bbox_dilation 10, bbox_crop_factor 3.0, noise_mask_feather 100, cycle 1. Their LoRA discipline is identity above 1.0 with style well below (1.5 / 0.65); with our identity LoRA at 1.0 the style slot starts at **0.65**.

- [ ] **Step 1: Write the failing tests**

```python
def test_gen_workflow_matches_module_09_and_has_a_pickle_free_detailer():
    g = json.loads((PIPELINE / "train/workflows/krea2_gen_api.json").read_text("utf-8"))
    b = g["8"]["inputs"]
    assert (b["steps"], b["cfg"], b["sampler_name"], b["scheduler"], b["denoise"]) == (
        4, 1.0, "res_2s", "beta", 1.0)
    assert g["15"]["inputs"]["denoise"] == 0.35 and g["13"]["inputs"]["scale_by"] == 0.25
    assert g["4"]["inputs"]["strength_model"] == 1.0
    assert g["32"]["class_type"] == "MaskToSEGS" and g["33"]["class_type"] == "DetailerForEach"
    d = g["33"]["inputs"]
    assert (d["guide_size"], d["steps"], d["cfg"], d["sampler_name"], d["scheduler"],
            d["denoise"], d["feather"], d["cycle"]) == (512, 4, 1.0, "euler", "normal",
                                                        0.15, 5, 1)
    for banned in ("UltralyticsDetectorProvider", "SAMLoader", '.pt"', ".pth",
                   "creator-001", "creator001krea2", "pawg", "gravedigga"):
        assert banned not in json.dumps(g), banned

def test_gen_stage_requires_a_chosen_checkpoint_and_uploads_only_that_file(command, tmp_path):
    personas = _synthetic_persona(tmp_path, creator_id="creator-002", steps=3000)
    with pytest.raises(command.FigmentTrainError, match="chosen checkpoint"):
        command.build_plan("creator-002", "gen", tmp_path / "a", personas_root=personas)
    _set_training(personas / "creator-002", chosen_checkpoint_step=1500)
    out = tmp_path / "b"
    run = command.build_plan("creator-002", "gen", out,
                             personas_root=personas)["stages"]["gen"]["runs"][0]
    m = load_json(out / run["manifest"])
    assert m["uploads"][0]["files"] == [
        "out/creator-002-tensor-train/creator002krea2_000001500.safetensors"]
    assert m["uploads"][0]["chunk_bytes"] == 16777216
    assert m["jobs"][0]["wait_for"] == "_loras.assembled"
    assert all(j["expected_images"] == 3 for j in m["jobs"])
    r = subprocess.run([sys.executable, str(POD_RUNNER), "run", "--manifest",
        str(out / run["manifest"]), "--out", str(tmp_path / "dry"),
        "--dry-run", "--max-minutes", "1"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
```

- [ ] **Step 2: Run and see them fail** — file missing; then `unknown stage 'gen'`.

- [ ] **Step 3: Write the workflow.** Start from the committed workflow in `train/runs/creator-001-tensor-gen.yaml` (dump it with the one-liner in A1 Step 3) and change three things:

1. Node `4` `LoraLoader` strengths become `1.0`/`1.0` — our committed `0.8` was an unrecorded deviation; the package's tester and generation both use 1.0. Its `lora_name` is substituted per job by the planner.
2. New node `40` `LoraLoader` for the style slot after `4` (`model: ["4", 0]`, `clip: ["4", 1]`, strengths `0.65`). When `training.style_lora` is `null` the planner **removes** node `40` and rewires `5`/`8`/`15`/`33` back to `4` — no bypassed node ever ships in a manifest.
3. The detail tail on the refined image (node `16`):

| Node | class_type | Key inputs |
|---|---|---|
| `30` | *(the MediaPipe class recorded as D23)* | model name from `pins.gen`; `image: ["16", 0]`; `threshold: 0.40` |
| `31` | `GrowMask` | `mask: ["30", <mask slot>]`, `expand: 10` (the package's `bbox_dilation`) |
| `32` | `MaskToSEGS` | `mask: ["31", 0]`, `combined: false`, `crop_factor: 3.0`, `bbox_fill: false`, `drop_size: 10`, `contiguous: false` |
| `33` | `DetailerForEach` | `image: ["16", 0]`, `segs: ["32", 0]`, model/clip/vae from the loaders the base render uses, `positive: ["5", 0]`, `negative: ["6", 0]`, `guide_size: 512`, `guide_size_for: true`, `max_size: 1024`, `seed: 40`, `steps: 4`, `cfg: 1.0`, `euler`/`normal`, `denoise: 0.15`, `feather: 5`, `noise_mask: true`, `force_inpaint: true`, `cycle: 1`, `inpaint_model: false`, `noise_mask_feather: 100` |
| `34` | `SaveImage` | `filename_prefix` set by the planner; `images: ["33", 0]` |

Keep nodes `20`/`21` so each job saves base, refined **and** detailed — three outputs, the same count module 09 produces; jobs declare `expected_images: 3`.

- [ ] **Step 4: Add the style-LoRA pins.** `pins.style_loras` with both r22 §2 CLEAN candidates — `inlineresearch/skin-lora-krea-2-raw` → `inline-skin-lora-krea-2-raw.safetensors` and `gokaygokay/Krea-2-Realism-LoRA` → `krea2_realism_lora.safetensors` — each with `revision`/`sha256` resolved by A2 Step 1's command and `"licence": "krea-2-community-license (commercial free under $1M trailing-12-month revenue)"`. Add `style_lora` to `TRAINING_KEYS`/`DEFAULT_TRAINING` (`None`). Record **D24**: *`pawg_krea2` has no licence-clean substitute and is dropped outright.*

- [ ] **Step 5: Implement the stage.** Add `"gen"` to `STAGES` (last) and to both parser `--stage` choice tuples. `_gen_manifest` mirrors `_tester_manifest:499` — `_pod_base(pins, pod_class, "gen")`, `pins.gen` models/nodes, the `training` block for `start-comfy-lorapath.sh`, the chunked upload, `seed_fields: ["seed", "noise_seed"]` — and builds jobs from a new `expand/templates/gen-prompts.yaml` (`<distance> × <light>` rows derived from `persona["register"]["settings"]` and `persona["grammar"]["lights"]`, same shape as `anchor-prompts.yaml`), substituting node `5` `text` and, when a style LoRA is set, node `40` `lora_name`. `_grading_images` already generalises, but `_find_job_image` expects exactly one file per `output_name`: extend it to accept the `<output_name>_NN` suffixes `download_job_outputs` produces for multi-image jobs, and grade only the `_03` (detailed) output.

- [ ] **Step 6: Run everything and commit** — `py -3 -m pytest orgs/figment/pipeline -q` → PASS.

```bash
git add orgs/figment/pipeline/train orgs/figment/pipeline/expand orgs/figment/pipeline/training_config.py orgs/figment/pipeline/figment_train.py orgs/figment/pipeline/tests/test_gen_stage.py
git commit -m "feat(figment): module-09 generation graph and the gen stage"
```

---

### Task D3: GATE 4 — final board against the anchor (STOP)

**Files:** none changed.

- [ ] **Step 1: Plan and dry-run**

```powershell
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage gen --out C:/tmp/c001-gen
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest C:/tmp/c001-gen/train/runs/creator-001-tensor-gen.yaml --out C:/tmp/c001-gen/dry --dry-run --max-minutes 1
```

- [ ] **Step 2: STOP** — report the `$4.01` ceiling and the day's ledger; run live only after the go:

```powershell
py -3 orgs/figment/pipeline/figment_train.py run --creator creator-001 --stage gen --plan C:/tmp/c001-gen/plan.json
py -3 orgs/figment/pipeline/figment_train.py grade --creator creator-001 --stage gen --plan C:/tmp/c001-gen/plan.json
```

- [ ] **Step 3: STOP — GATE 4.** The operator views every detailed output at full resolution beside the anchor. The verdict to beat is Track-1's: *"kind of close, glossy, reads a lot older, some inconsistent."* Record his verdict against r20's four ranked divergences so the next iteration knows which lever moved.

- [ ] **Step 4: Optional style-LoRA A/B.** If wanted, re-plan `gen` twice into separate `--out` directories with `training.style_lora` set to `inline-skin` then `gokay-realism`, same seeds and prompts. Two extra pods, `$8.02` ceiling — present that cost before running.

---

# Phase E — acceptance and migration

### Task E1: Creator-002 residue proof, retirement, and docs

**Files:** Create `personas/creator-002/` (`persona.yaml`, `training.yaml`, `identity-spec.md`, one 8×8 anchor PNG); Delete `train/runs/creator-001-tensor-{train,train-smoke,tester,gen}.yaml` and `expand/runs/creator-001-tensor-{dataset-shard-01,dataset-shard-02,dataset-shard-03,smoke}.yaml`; Modify `pipeline/tests/test_figment_train.py`, `train/FIGMENT-TRAIN.md`, `expand/TENSOR-REPLICATION.md`, `STATE.md`

**Interfaces:** `test_creator001_plan_reproduces_current_manifest_documents_exactly` (which pins the generator to hand-written manifests) is replaced by a six-stage residue + dry-run test.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.parametrize("stage", ["anchor", "dataset", "smoke", "train", "tester", "gen"])
def test_creator002_plans_every_stage_token_clean_and_dry_runs(command, tmp_path, stage):
    personas = ROOT / "orgs" / "figment" / "personas"
    out = tmp_path / stage
    plan = command.build_plan("creator-002", stage, out, personas_root=personas)
    for run in plan["stages"][stage]["runs"]:
        text = (out / run["manifest"]).read_text("utf-8")
        for banned in ("creator-001", "creator001krea2", "g01", "g02", "g07",
                       "gravedigga", '.pt"', ".pth", "Impact-Subpack"):
            assert banned not in text, f"{banned} in {run['manifest']}"
        r = subprocess.run([sys.executable, str(POD_RUNNER), "run", "--manifest",
            str(out / run["manifest"]),
            "--out", str(out / "dry" / Path(run["manifest"]).stem),
            "--dry-run", "--max-minutes", "1"], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
```

- [ ] **Step 2: Run and see it fail** — no `creator-002` fixture.

- [ ] **Step 3: Build the fixture and retire the old manifests.** Write `personas/creator-002/` as the minimum valid persona with `steps: 3000` and `chosen_checkpoint_step: 1500`, a generated 8×8 PNG anchor, and a two-line `identity-spec.md`. Compute the persona's `sha256` fields from the generated files — never copy creator-001's. Delete the eight hand-written manifests and the old reproduction test.

- [ ] **Step 4: Update the docs.** `FIGMENT-TRAIN.md`: rewrite the PowerShell block to the six-stage sequence with all four gates in position; list the new persona fields (`skin_lora`, `style_lora`, `chosen_checkpoint_step`, `diff_output_preservation`, `diff_output_preservation_class`); replace "Defaults are tonight's module-11 port: 2000 steps" with the 3000-step ruling; replace "Reproduction and migration" with a statement that the hand-written manifests are retired and `figment_train.py` is the only producer. `TENSOR-REPLICATION.md`: confirm D15–D24 are present with reasons under three headings — "Module 03 → anchor", "Module 10 → dataset", "Module 09 → gen". `STATE.md`: replace "Now"/"Next" with the Track-2 state — gates passed, manifests that exist, arc ledger total, next gate.

- [ ] **Step 5: Run everything and commit** — `py -3 -m pytest orgs/figment/pipeline -q` → PASS, all six stages dry-running green.

```bash
git add -A orgs/figment
git commit -m "chore(figment): retire hand-written manifests; creator-002 proves no residue"
```

---

## Risks and unknowns

1. **Impact Pack pulling pickles by default.** The base pack's `requirements.txt` lists no `ultralytics` and no `.pt`, and `MaskToSEGS`/`DetailerForEach` are in the base pack (r22 §5) — but our pin `429d0159…` predates that read and may sit *below* v8.0, where Subpack was still auto-installed. Task D1 greps a real checkout and refuses to proceed on a hit. The bootstrap `pip install`s each node's `requirements.txt` (`pod/README.md`), so that grep is the only guard.
2. **The MediaPipe node's real class name and model path are unverified.** r22 cites PR #14009 and the weight filename; nothing in the repo names the ComfyUI `class_type` or `destination_dir`. Task D1 makes reading them off a real checkout a blocking step, with YuNet ONNX (MIT) as the fallback. **This is the most likely place Phase D stalls.**
3. **Qwen3-VL-8B VRAM next to the edit stack.** ~19 GB bf16 against a 48 GB L40S already holding Qwen-Image-Edit-2511 fp8mixed (20.5 GB) plus the 9.4 GB VL encoder; r22 §7 flags this as unverified. Mitigation: the launcher's `POST /free {"unload_models":true,"free_memory":true}`, which unloads models but leaves the server (and the harness's `/view` transport) alive. If it still OOMs: the FP8 captioner variant, then the already-implemented `auto` path on the *training* pod (`start-training-aitoolkit.sh.template`), ~2 min inside the training job window.
4. **Licences that must pass before a pin.** Every new model needs `revision`, `sha256`, and a stated licence resolved from the HF API (A2 Step 1). Three are conditional: `tlennon-ie/qwen-edit-skin` is Apache-2.0 but demonstrated only on Qwen-Image-Edit-**2509** (held behind D22's one-cell check); both Krea-2 style LoRAs carry the Krea 2 Community License, free commercially only **under $1M trailing-12-month revenue**; `suayptalha/Z-Image-Turbo-Realism-LoRA`'s Apache-2.0 is a card-header claim with no LICENSE file — re-read it at pin time.
5. **Budget.** Expected arc ≈ $12.50 against the brief's ≈$6–7; the 3000-step run is ~$4.92 alone at the measured 3.85 s/step. Split across three days so no day nears the $10 guard; the $50 arc cap holds regardless. If the operator wants the arc inside $7, the only real lever is 2000 steps — exactly the deviation r20 divergence #7 flags. Present the tradeoff; do not choose it.
6. **DOP triples training time** (~$15 on L40S, above the daily guard on its own). Task C1 ships it off; enabling it needs its own gate and probably a cheaper pod class.
7. **The full-body second pass is our invention, not a port** (D21); its numbers come from module 04's edit pass. If the repaired faces read pasted-on, the fallback is to drop full-body cells entirely and let the LoRA generalise from half-body — which is what `identity-spec.md`'s own rule says on its own.
8. **`artifacts_after_jobs` touches the harness's most safety-critical loop.** The change is small but sits next to the terminate-and-verify margin. Do not let the artifact deadline start before the jobs finish, and re-run the whole pod suite, not just the new case.
9. **NIQE / CLIP-IQA are not implemented.** pyiqa is PolyForm-Noncommercial (REJECT) and PerceptCLIP is pickle-with-no-licence (REJECT), per r22 §6. Task B3 ships the three raw metrics `identity_check.compute_raw_metrics` already computes locally — the same blur / plastic-skin / clipping signals r16 §2 lists — and leaves a standalone NIQE reimplementation as a follow-up.
