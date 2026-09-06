# Identity-transfer bake-off (R24 candidates)

Answers `research/r24-identity-transfer-bakeoff-candidates.md`'s shortlist: for each
candidate method, take anchor g01 (plus g02/g07 where the method accepts multiple
references) and produce the same 6 fixed-seed target cells, so results are directly
comparable. Of the four candidates, only **M1 is runnable clean**. M2 has no published
weights. M3 is rejected on a mandatory pickle dependency. M4 is out of scope by the task
brief (a training stage already exists elsewhere in this pipeline).

Since M1 is the only runnable method, `m1.yaml` was turned into a proper **ablation**
rather than a single arm, so a scorer can tell what actually moves identity/age/gloss
instead of just producing 6 more pictures: **18 jobs, one bootstrap, 6 cells x 3 arms**,
identical seed and prompt text shared across a cell's 3 arms.

| Arm | What it is | What it isolates |
|---|---|---|
| **arm A** | as built: no Lightning, 26 steps, skin LoRA @1.0, refs g01+g02+g07 | the baseline recipe |
| **arm B** | arm A, skin LoRA `strength_model` substituted to 0.0 | the skin LoRA's own effect (0.0 is mathematically "LoRA absent" on the same node/graph, not a second model load) |
| **arm C** | arm A's LoRA setting, but only g01 wired into the edit-conditioning node | the multi-reference (g01+g02+g07 vs g01-only) effect |

| Method | Verdict | Why |
|---|---|---|
| **M1** — Qwen-Image-Edit-2511, Lightning removed, + `tlennon-ie/qwen-edit-skin` | **RUNNABLE** | Fully Apache-2.0 chain, zero custom nodes (core ComfyUI only), all four model pins verified live. See below. |
| **M2** — Z-Image-Edit / Z-Image-Omni (Tongyi-MAI) | **NOT RUNNABLE** | No such repo exists. Tongyi-MAI publishes only `Z-Image` and `Z-Image-Turbo` (both Apache-2.0, text-to-image, no reference-image input) as of the live check below. |
| **M3** — PuLID (FaceNet loader) on FLUX.1-schnell | **REJECT** | Every documented configuration of the node — including the "commercial-clean" FaceNet path — requires two mandatory pickle-format (`.pt`) weight downloads. |
| **M4** — train-first (Krea-2 LoRA) | **OUT OF SCOPE** | Per the task brief: a training stage already exists elsewhere in this pipeline. |

## M1 — Qwen-Image-Edit-2511, Lightning removed, + qwen-edit-skin (RUNNABLE)

r24 candidate 1: the three prior 2511 failures (free multi-ref, edit-as-canvas,
Qwen-Image-Edit-2511+Lightning) all ran the Lightning LoRA at 4 steps, which is
independently documented to cause plastic-skin/reddish artifacts (r24, Patreon BFS LoRA
notes, tlennon-ie model card). This arm removes Lightning entirely, raises steps to the
model's own non-distilled range, and adds the one Apache-2.0 skin-texture LoRA found for
this base (r22 §3).

**Recipe** (`m1_api.json`, 17 core-ComfyUI nodes across the two tracks, zero custom
nodes — one graph, three arms, per-job substitution picks the track and the LoRA
strength):

Shared: `UNETLoader(qwen_image_edit_2511_fp8mixed)` → `LoraLoaderModelOnly(qwen-edit-skin,
strength_model=<job-substituted: 1.0 for arm A/C, 0.0 for arm B>)` →
`ModelSamplingAuraFlow(shift 3.1)`, plus three `LoadImage` (g01, g02, g07).

Track AB (node ids 10-14, rendered by arm A and arm B jobs):
`TextEncodeQwenImageEditPlus(image1=g01, image2=g02, image3=g07, prompt=<job-substituted>)`
→ `ConditioningZeroOut` → `EmptyLatentImage(1448x2176)` →
`KSampler(26 steps, cfg 3.0, euler/simple, denoise 1.0)` → `VAEDecode`.

Track C (node ids 20-24, rendered by arm C jobs): the identical chain, but
`TextEncodeQwenImageEditPlus` wires only `image1=g01` — no `image2`/`image3` key exists
on that node at all, so there is nothing to "turn off" per job, only a genuinely
different static node.

Final: one `SaveImage` whose `images` input a per-job substitution points at `["14", 0]`
(arm A/B) or `["24", 0]` (arm C). ComfyUI only executes the ancestors of whichever output
a submitted prompt actually asks for, so for any given job the *other* track's nodes
never run — ComfyUI compute cost per job is the same one-sampler-pass magnitude
regardless of arm, matching the pipeline's existing "one graph, output selected per job"
pattern (`tensor_dataset_v2_api.json`'s single `SaveImage` selecting between its face and
body branches, `TENSOR-REPLICATION.md` D10).

No Lightning LoRA anywhere in the graph (checked by test). No LoRA on the CLIP side — the
skin LoRA is model-only (`LoraLoaderModelOnly`), same pattern the existing pipeline
already uses for Lightning. No face-crop/bounding-box preprocessing (no
`FaceAnalysisModels`/`FaceBoundingBox`, no InsightFace, no KJNodes) —
`TextEncodeQwenImageEditPlus` internally scales each reference itself (384x384 for the VL
path, ~1MP for VAE encode), so the raw anchor JPEGs are fed straight in. This is a real
simplification versus the existing `tensor_dataset_v2_api.json` port: **zero custom node
repos**, which also sidesteps the insightface/dlib compile risk
`TENSOR-REPLICATION.md`'s dependency-smoke section flags as "open risk 1" for that graph.

Steps/cfg: 26 steps (task's 24-28 range), cfg 3.0 (r24's "CFG ~2-3" recipe note, model
card's documented workable band is roughly 1.5-4) — identical on both tracks. Resolution:
1448x2176 on both tracks, matching the existing generation manifest's canvas so a human
grader can eyeball M1 output next to the existing `creator-001-tensor-gen` cells without a
scale mismatch.

### The 6 fixed-seed cells, x3 arms = 18 jobs

| Cell | Angle | Distance | Light | Seed (shared by all 3 arms) |
|---|---|---|---|---|
| 01-close-front-flatwhite | front | close | flat, even white, no directional shadow | 424101 |
| 02-close-front-lampnight | front | close | warm lamp light at night | 424102 |
| 03-threequarterl-half-windowday | three-quarter-left | half-body | natural window daylight | 424103 |
| 04-threequarterr-half-flash | three-quarter-right | half-body | on-camera flash | 424104 |
| 05-profilel-close-flatwhite | left profile | close | flat, even white, no directional shadow | 424105 |
| 06-front-half-windowlight | front | half-body | window daylight | 424106 |

2 close frontal (01, 02) + 2 three-quarter half-body (03, 04) + 1 profile (05) + 1
half-body window-light (06) = 6 cells, exactly the distribution the task brief asks for,
each rendered once per arm (a/b/c) with the identical seed and identical prompt text
across its 3 arms — so any difference between `c001-bo-a-01-...`, `c001-bo-b-01-...`,
and `c001-bo-c-01-...` is attributable to the arm's own ablation, not to a different seed
or a reworded prompt. Output names follow `c001-bo-<arm>-<cell>`.

### Prompt construction

Every prompt is `<per-cell framing/angle/light clause>` + `persona.yaml`'s
`identity.look` fields concatenated verbatim (age_stage, hair, eyes, skin, brows, makeup,
build, clothing — the clothing clause is what carries the required literal `"fully opaque
and intact"`) + an identity-lock instruction + the skin-texture clause the task specifies:

> Do not alter facial features, do not change her identity: keep the exact same face, bone
> structure, and skin tone as the reference photos. visible pores, natural skin texture,
> no retouching, matte skin.

Every prompt is checked (test) against `test_build_expansion_set.py`'s existing
`BANNED_PHRASES`/`UNSAFE_TERMS`/age-4c-token lists — the same look-spec-v2 §4a/§4c
vocabulary guard the rest of the pipeline runs prompts through — plus a hand check for
`"studio lighting"` (one draft revision hit this ban; the light clause now reads "flat
even white light with no directional shadow" instead).

### Pins — verified live

`pipeline/expand/bakeoff/pins.yaml` carries all four M1 model pins (revision + sha256 +
licence) plus a documented evidence block for why M2/M3 are not built. Verified live
against Hugging Face via the harness's own preflight checker, reused as-is (`--pins` was
already a supported flag — no copy script needed):

```powershell
python pipeline/train/verify_pins.py --pins pipeline/expand/bakeoff/pins.yaml
```

```
verified 1 stage(s) clean: m1
```

(Run 2026-09-06.) This is the same live HEAD-request-against-`x-linked-etag` check
`figment_train.py plan` runs as a preflight — it re-confirmed the base Qwen-Image-Edit-2511
stack (already pinned in `train/tensor-pins.yaml`, reused verbatim here) and gave the
**first live confirmation of the skin LoRA specifically**, which the task called out by
name: `tlennon-ie/qwen-edit-skin` resolves at revision `60fb653d46045074449f45068d91ce27f11eb1ca`
with sha256 `e4efd5ee1e5555eb438c214aa0ee6009f0215f13dbe817128615909871eed4b1`, licence
`apache-2.0` stated on the model card header. It did **not** fail, so M1 ships with the
skin LoRA (the task's fallback — ship M1 without it — was not needed).

One caveat carried over from r22 §3, unverifiable by a HEAD request: the LoRA's own model
card demonstrates it against Qwen-Image-Edit-**2509**, not 2511. Format and licence are
now live-confirmed; runtime compatibility with 2511 can only be settled on an actual pod
run, which this bake-off's `--dry-run` cannot exercise.

| File | Source | Revision | Licence |
|---|---|---|---|
| `qwen_image_edit_2511_fp8mixed.safetensors` | `Comfy-Org/Qwen-Image-Edit_ComfyUI` | `4c7c4ea2...` | apache-2.0 |
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `Comfy-Org/Qwen-Image_ComfyUI` | `25608066...` | apache-2.0 |
| `qwen_image_vae.safetensors` | `Comfy-Org/Qwen-Image_ComfyUI` | `dfe60a0d...` | apache-2.0 |
| `qwen-edit-skin.safetensors` | `tlennon-ie/qwen-edit-skin` | `60fb653d...` | apache-2.0 (2511 compat unverified) |

### Cost ceiling and job count

Computed with the harness's own helpers (`pod.minimum_runtime_minutes`,
`figment_train.manifest_ceiling`) rather than by hand:

- **18 jobs** (6 cells x 3 arms), one bootstrap, one L40S SECURE placement,
  `price_usd_per_hour` 1.30.
- `readiness_timeout_seconds`: 2700 (task ceiling, matches the existing dataset/anchor_edit
  stages' proven readiness budget for this same model stack).
- `job_timeout_seconds`: **240**. Reasoning: a 26-step Qwen-Image-Edit sampler pass at
  1448x2176 on an L40S is estimated at roughly 90-150s (fp8 stack, single sampler branch
  per job regardless of arm, per the backward-reachability point above). 900s per job
  (this bake-off's original single-arm sizing) x 18 jobs would blow the whole point of
  running an ablation cheaply, and is far more slack than the actual sampler work needs.
  240s keeps a real margin above the 150s upper end of that estimate — covering the
  multi-image VL encode + VAE encode of up to 3 references, the final VAE decode, and
  ComfyUI history-poll/proxy round trips around the sampler — without reverting to a
  90-150s-tight budget that a single slow placement could blow. This number was sized
  from the stated per-step expectation, not measured against a live pod (none was run).
- `minimum_runtime_minutes` = 2700/60 + 240\*18/60 + 5 = **122 minutes** exactly —
  `max_minutes` is set to that computed minimum (no slack wasted on an arbitrary round
  number).
- `manifest_ceiling` at 122 minutes = **$2.65** (preflight estimate printed by a live run
  is $2.6433, rounded up to the cent per the harness's own `ROUND_CEILING` convention).

Dry-run confirms the shape end-to-end (18/18 jobs verified):

```powershell
python pipeline/pod/runpod_run.py run --manifest pipeline/expand/bakeoff/m1.yaml --dry-run --out <out-dir>
```

```
preflight cost estimate: $2.6433 for 122.00 minute(s)
job c001-bo-a-01-close-front-flatwhite complete: 1 verified file(s)
job c001-bo-b-01-close-front-flatwhite complete: 1 verified file(s)
job c001-bo-c-01-close-front-flatwhite complete: 1 verified file(s)
... (15 more, one per remaining cell x arm combination) ...
job c001-bo-c-06-front-half-windowlight complete: 1 verified file(s)
exit path complete: terminate + absence verification succeeded
```

A live run (never executed by this task — dry-run only, per the brief):

```powershell
$env:RUNPOD_API_KEY = (Get-Content -Raw 'C:\secure\runpod-api-key.txt').Trim()
try {
  python pipeline/pod/runpod_run.py run --manifest pipeline/expand/bakeoff/m1.yaml `
    --out .\bakeoff-m1-run --max-usd 2.70 --ledger-dir <reconciled ledgers/cost dir>
} finally {
  Remove-Item Env:RUNPOD_API_KEY -ErrorAction SilentlyContinue
}
```

### Scoring the ablation: `summarize.py`

`identity_gate.py` (built in parallel to this task) is expected to score every rendered
image and write a `gate.json` with per-image `identity_own`, `age_delta`, `gloss`,
`niqe`, and a boolean `pass`. `summarize.py` takes that plus the run's `run.json` and
prints one row per arm — how many of its 6 images exist, how many the scorer actually
reached, the median of each numeric field, and the pass count:

```powershell
python pipeline/expand/bakeoff/summarize.py --run <out-dir>/run.json --gate <path-to>/gate.json
```

```
arm  n  scored  pass  med_identity_own  med_age_delta  med_gloss  med_niqe
a    6  6       6/6   0.905             2.120          0.385      4.575
b    6  6       6/6   0.753             1.670          0.375      4.875
c    6  6       0/6   0.589             2.140          0.350      4.575

  a = A (as built: no Lightning, skin LoRA @1.0, g01+g02+g07)
  b = B (skin LoRA -> 0, isolates the LoRA)
  c = C (g01 only, isolates multi-ref)
```

(That specific table is from a synthetic `gate.json` used to smoke-test the script — see
`test_bakeoff.py`'s `summarize.py` tests — not a real scored run.) `--strict` exits
non-zero and lists any bake-off image with no gate row at all, instead of silently
under-counting. Schema tolerance: `identity_gate.py`'s exact `gate.json` shape was not
final when this was written, so the reader accepts either `{"rows": [...]}` (the
`score_cells.py` "advisory.json" shape) or a bare `[...]` list, and identifies each row by
`image_id` (falling back to a `path`/`filename` stem) — matching the `image_id` convention
`runpod_run.py` and `score_cells.py` already use for a single-image job's output name.

## M2 — Z-Image-Edit / Z-Image-Omni (NOT RUNNABLE)

r24 flagged this as the "zero prior failed attempts" candidate, worth a same-cost probe.
Checked live against the Tongyi-MAI Hugging Face org: it publishes exactly four repos —
`Tongyi-MAI/Z-Image-Turbo`, `Tongyi-MAI/Z-Image`, `Tongyi-MAI/MAI-UI-8B`,
`Tongyi-MAI/MAI-UI-2B` — and the two Z-Image repos are text-to-image only (Apache-2.0, no
reference-image conditioning). No `Z-Image-Edit` or `Z-Image-Omni` repo exists. The org's
own community discussion threads on `Z-Image-Turbo` (e.g. "GIVE A RELEASE DATE FOR
Z-IMAGE-EDIT, OR JUST DROP IT!", "Is an open-source release for z-image-edit still a
possibility?") confirm this is a known, still-unreleased gap as of this check — not a
naming mismatch or a repo I failed to find. There is therefore nothing to pin, no
ComfyUI-node question to answer (moot without weights), and no workflow to build.
**Marked NOT RUNNABLE, not attempted with a substitute model** — swapping in a different
base would no longer be testing the candidate r24 named.

## M3 — PuLID (FaceNet loader) on FLUX.1-schnell (REJECT)

r24 called `lldacing/ComfyUI_PuLID_Flux_ll`'s `PulidFluxFaceNetLoader` "the only fully
commercial-clean PuLID variant" because it swaps InsightFace's non-commercial
antelopev2/ArcFace weights for facenet-pytorch's MIT-licensed VGGFace2 weights. Checked
live against the node's own README and GitHub repo (HEAD commit
`7c7362b806c2c0f4bde8742ada9e7cb05b44d249`, 2025-11-07): that swap is real, but it only
replaces **one** of the pipeline's non-safetensors dependencies. The pipeline as a whole
requires two mandatory pickle-format (`.pt`, loaded via `torch.load`) weight downloads
regardless of which face-recognition loader is selected:

| Model | Repo | File | Format | Licence | Verdict |
|---|---|---|---|---|---|
| PuLID-FLUX weights | `guozinan/PuLID` | `pulid_flux_v0.9.1.safetensors` | safetensors | apache-2.0 | CLEAN on its own |
| EVA-CLIP (EVA02-CLIP-L-14-336) | `QuanSun/EVA-CLIP` | `EVA02_CLIP_L_336_psz14_s6B.pt` | **pickle (.pt)** — no safetensors alternative offered by this node | not stated on the card | **REJECT** — mandatory for every PuLID-Flux configuration, not swappable by the FaceNet loader |
| FaceNet (VGGFace2) | `facenet-pytorch` package, auto-downloaded | `20180402-114759-vggface2.pt` | **pickle (.pt)**, auto-downloaded to `~/.cache/torch/checkpoints/` | MIT (code) | **REJECT** — required, not optional, per the node's own docs |
| InsightFace antelopev2 (only if FaceNet loader is *not* used) | community re-host | `.onnx` + `.pth` mix | mixed | non-commercial research-only | REJECT (this is the path r24 already ruled out; listed for completeness) |

A pickle file executes arbitrary code on load — this is why `face_yolov8m.pt` and
`sam_vit_b_01ec64.pth` were already dropped from the existing pipeline's own generation
graph (`TENSOR-REPLICATION.md`, "Steps in the package we could not replicate
licence-clean") and why `research/r22-clean-assets.md` §4 independently rejected
facenet-pytorch's own MTCNN weights on the identical format ground. That is an established
project precedent, not a new bar invented for this bake-off: **REJECT applies regardless
of the PuLID code's own Apache-2.0 licence**, because the EVA-CLIP encoder is load-bearing
for the identity-conditioning pathway itself, not an optional face-detection swap-in the
way InsightFace-vs-FaceNet is.

Secondary, non-dispositive note: the node's own docs list FLUX.1-dev (non-commercial) as
the documented base and mention FLUX.1-schnell only for its VAE, not as a validated
inference base for the PuLID adapter — schnell compatibility for identity transfer itself
remains unconfirmed. This did not need resolving once the pickle dependency above already
rejects the method outright.

**No `m3_api.json` or `m3.yaml` was built** — a manifest for a method already rejected on
licence/format grounds would just be dead weight, and the brief's own instruction is to
reject the method, not to still exercise it.

## M4 — train-first (OUT OF SCOPE)

Per the task brief: a training stage already exists elsewhere in this pipeline
(`figment_train.py`, `train/tensor-pins.yaml`, the `train`/`tester` pod-class stages) —
train-first is explicitly out of scope for this bake-off.

## Verification

```powershell
$env:PYTEST_DEBUG_TEMPROOT = "C:/Users/danie/AppData/Local/Temp/kbfp-bo"
python -m pytest orgs/figment/pipeline/expand/tests/test_bakeoff.py -p no:cacheprovider -q
```

Covers: the manifest dry-runs green (all 18 jobs); the manifest has exactly 18 jobs (6
cells x 3 arms), each cell sharing one seed and one prompt text across its 3 arms; arm B's
LoRA-strength substitution is exactly 0.0 while arm A/C stay in the 1.0-1.5 recipe band;
arm A/B jobs render track AB (`SaveImage.images == ["14", 0]`, prompt substituted on node
`10`) and arm C jobs render track C (`["24", 0]`, node `20`); track C's node wires only
`image1`; every job prompt carries the required `"fully opaque and intact"` literal, the
identity-lock clause, and the skin-texture clause; every prompt clears the existing
look-spec-v2 banned-phrase/age-token guards; every model pin has a 64-hex sha256, a 40-hex
revision, and an allowlisted licence; the manifest's `models` list matches `pins.yaml`
exactly; the pins verify live against Hugging Face (both via the library function and the
actual CLI); the manifest's `readiness_timeout_seconds`/`job_timeout_seconds`/
`max_minutes` stay within the task's bounds and match the harness's own
`minimum_runtime_minutes` computation exactly; the six cells match the required 2/2/1/1
distribution; no Lightning LoRA appears anywhere in M1; `summarize.py` builds the correct
per-arm table (including tolerating missing gate rows, non-numeric fields, and both
`gate.json` shapes) against both synthetic fixtures and a real dry-run's `run.json`; and
the README documents all four methods' verdicts, and the ablation's three arms, with the
evidence this file states above.
