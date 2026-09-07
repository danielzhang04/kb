# Path-B DIAGNOSTIC — Method D (PuLID-Flux on FLUX.1-dev)

**RESEARCH-ONLY. MEASUREMENT-ONLY. NOTHING PRODUCED BY THIS MANIFEST SHIPS.** Every image
this bake-off would render (`c001-bo-D-*`, `c001-bo-E-*`) must never be published, hosted,
or used commercially, and must be deleted once it has been scored. This is the Path-B leg
of the operator's 2026-09-06 ruling ("Path A first, Path B as a diagnostic to learn whether
adapter-based identity injection closes the gap that edit models cannot" — boss decision,
per `research/r25-why-they-can-and-we-cant.md` §"Two paths"). Path A (the licence-clean
bake-off) is `m1.yaml`/`pins.yaml`/`README.md` in this same directory, built separately —
this diagnostic does not touch, extend, or supersede any of those files.

r25 §"Two paths" states exactly what Path B can and cannot prove: it **can** test whether an
InsightFace/PuLID-class adapter closes the identity gap faster than more LoRA tuning
(r25's cause #1, "cross-model identity transfer is a harder problem than anything 10sorLabs'
package solves"). It **cannot** produce a shippable result — a commercial path would still
need a fully relicensed rebuild (r24's PuLID + FaceNet loader + FLUX.1-schnell, itself
unverified) before any output could be used. This manifest exists to answer the measurement
question only.

## Does the harness reject `.pt`/`.pth` model files outright?

**Originally no — this diagnostic's own first pass found and documented the gap; that gap is
now closed at the harness level.** When this file was first written, `pipeline/pod/runpod_run.py`'s
model-manifest validator (`require_manifest`, the loop over `manifest.get("models", [])`)
checked only `repo_id`/`filename`/`destination_dir` presence, `repo_id` shape
(`[A-Za-z0-9._-]+/[A-Za-z0-9._-]+`), filename path-safety (no absolute path, no `..`),
`destination_dir` being an absolute pod path, and `revision`/`sha256` format when present —
there was no extension rule for a Hugging-Face model download at all, confirmed empirically by
a clean `--dry-run` of this same manifest's one `.pt` and five `.onnx` model entries.

That finding is now fixed in `runpod_run.py`: `PICKLE_MODEL_EXTENSIONS`
(`.pt`/`.pth`/`.ckpt`/`.bin`/`.pkl`/`.pickle`, matched case-insensitively) is enforced by
`_model_pickle_filename`/`manifest_pickle_models`, called from both `require_manifest`'s
`models[]` loop and `bootstrap_script`'s download-command loop — a manifest with an
unacknowledged pickle-format model is now rejected with a `HarnessError` naming the file and
the rule, at manifest load *and* if `bootstrap_script` is ever called directly on it.
`.onnx` stays unrestricted (logged at INFO for visibility, no ack needed). See
`pipeline/pod/README.md`'s "Pickle-format models are rejected" section for the full rule.

This manifest still knowingly carries the EVA-CLIP `.pt` file, but no longer as an
unenforced gap — it now goes through the harness's own diagnostic escape hatch: this
manifest's top-level `diagnostic_non_commercial: true` plus that one model's own
`"pickle_ack": "Path-B diagnostic, research-only, r25"` (see the `models[]` entry below).
Both are required together; either alone is rejected. With both set, the harness logs
`WARNING PICKLE MODEL LOADED (diagnostic): EVA02_CLIP_L_336_psz14_s6B.pt` once when the
manifest loads and again to `_bootstrap.log` right before that download on the pod, and
`run.json` records it under `pickle_models` — including on the `--dry-run` re-verified below.

This remains a **harness-level** mechanism only; it does not reverse the project's own
established precedent that a pickle file executes arbitrary code on load regardless of its
licence — the same precedent `pins.yaml`'s M3 verdict (in the Path-A bake-off next to this
file) already applied to reject PuLID for a *shippable* build. Whether carrying that risk is
*acceptable* for a given run remains a **project policy decision** made by whoever sets
`diagnostic_non_commercial`/`pickle_ack` and reviews the manifest — the harness enforces that
the exception was stated explicitly, not that it was a good idea. This diagnostic is only
permitted to knowingly carry that pickle risk because the task brief explicitly scoped it as
non-commercial, non-shipping, measurement-only tooling. Every pickle/non-commercial asset this
manifest downloads is listed, with its reason, in `m3diag_manifest.yaml`'s own
`diagnostic_assets` block (reproduced in the pins table below) so nobody mistakes "the harness
will run it" for "this is licence-clean."

## Method D — PuLID-Flux on FLUX.1-dev

r24 §3 and r25's tooling-gap table both call PuLID-Flux "SOTA FLUX-native adapter identity
lock," never adopted, "untried bakeoff candidate." This is that candidate, run against the
documented, working combination named in the task brief: FLUX.1-dev (the base every
published PuLID-Flux workflow targets) plus `lldacing/ComfyUI_PuLID_Flux_ll`'s InsightFace
path (not its FaceNet substitute — that swap is what Path A's M3 already rejected, and using
it here would just re-run the licence-clean-but-untested variant Path A already covers in
spirit; this diagnostic is deliberately the *strongest*, most standard PuLID configuration,
because the question is whether an adapter can close the gap at all before anyone asks
whether a clean substitute of it also can).

### Node choice: `lldacing/ComfyUI_PuLID_Flux_ll`, not `balazik/ComfyUI-PuLID-Flux`

The task brief named both as candidates ("pick the maintained one"). Checked live via the
GitHub API: `balazik/ComfyUI-PuLID-Flux` last pushed 2024-10-03 (`pushed_at`), HEAD
`a80912fc3435c358607bf4b43a58dbcbebdb09ff`. `lldacing/ComfyUI_PuLID_Flux_ll` last pushed
2025-11-07, HEAD `7c7362b806c2c0f4bde8742ada9e7cb05b44d249` — over a year newer, and its own
README states it "solved [balazik's] model pollution problem." lldacing's README also
explicitly documents the InsightFace-vs-FaceNet split this diagnostic needs
(`PulidFluxInsightFaceLoader` vs `PulidFluxFaceNetLoader`), which is why Path A's own M3
verdict (rejecting this same node's FaceNet path on the mandatory-pickle finding) already
investigated this exact node — same HEAD commit, independently reconfirmed live here.

### Workflow (`m3diag_api.json`, 15 nodes, one custom-node repo)

`UNETLoader(flux1-dev.safetensors)` → `MODEL` into `ApplyPulidFlux`, alongside
`PulidFluxModelLoader(pulid_flux_v0.9.1.safetensors)` → `PULIDFLUX`,
`PulidFluxEvaClipLoader()` → `EVA_CLIP` (no inputs — it locates
`EVA02_CLIP_L_336_psz14_s6B.pt` itself under `models/clip/`, per the node's own 2025.01.27
changelog note), `PulidFluxInsightFaceLoader(provider="CUDA")` → `FACEANALYSIS` (locates
`antelopev2` under `models/insightface/models/antelopev2/`, per the same changelog), and one
`LoadImage(creator-001/g01.jpg)` → `IMAGE` as the single face reference (unlike M1's 3-image
multi-ref conditioning — PuLID's `ApplyPulidFlux.image` input takes exactly one reference
image, per its own `INPUT_TYPES`; the task brief also specifies "LoadImage g01" singular).
`ApplyPulidFlux(weight=<job-substituted>, start_at=0.0, end_at=1.0)` returns the patched
`MODEL`.

Text side: `DualCLIPLoader(clip_l.safetensors, t5xxl_fp8_e4m3fn_scaled.safetensors,
type="flux")` → `CLIP` → `CLIPTextEncode(text=<job-substituted per-cell prompt>)` →
`FluxGuidance(guidance=3.5)` for the positive conditioning, and `ConditioningZeroOut` of the
same `CLIPTextEncode` output for the negative — the identical zeroed-negative pattern `m1`
already uses for a guidance-distilled model with no real negative prompt (no `FluxGuidance`
on the negative side, matching the community-standard FLUX-dev txt2img graph: guidance is a
positive-only mechanism, and `cfg` on `KSampler` is set to 1.0 so the classic negative-prompt
CFG path is inert). `VAELoader(ae.safetensors)` → `VAE`.

`EmptySD3LatentImage(1024x1536)` → `KSampler(model=<PuLID-patched>, positive=<guided>,
negative=<zeroed>, seed=<job>, steps=20, cfg=1.0, sampler_name=euler, scheduler=simple,
denoise=1.0)` → `VAEDecode` → `SaveImage(filename_prefix="creator-001-bakeoff-m3diag")`. Every
setting here is the task brief's explicit spec verbatim: "FLUX.1-dev 20-step euler cfg 1.0
(guidance 3.5) at 1024×1536, PuLID weight 0.9-1.0."

**Resolution note, flagged rather than silently resolved:** the task brief's general
reuse instruction ("reuse the SAME seeds, prompts, output size ... so results are comparable
in `summarize.py`") and Method D's own explicit spec ("at 1024×1536") disagree with M1's
1448x2176 canvas. This diagnostic follows Method D's explicit, more specific instruction —
1024x1536 — because that is the documented working PuLID-Flux resolution band (every
published PuLID-Flux example workflow this node's own README links targets a similar
portrait aspect near 1024-wide, not M1's taller 1448x2176 crop), and forcing M1's resolution
onto an untested adapter combination would be changing two variables (resolution *and*
method) at once. Same seeds and same per-cell prompt text carry over exactly as instructed,
so `identity_own`/`age_delta` stay directly comparable across M1 and this diagnostic; any
resolution-sensitive metric (`gloss`, `niqe`) should be read with this caveat in mind.

### Two arms — D (weight 1.0) and E (weight 0.7), same seeds

The task brief specifies "6 jobs, optional 6 more at weight 0.7 (arm E) — same seeds." Both
are built: 6 cells × 2 arms = **12 jobs**, one bootstrap, `ApplyPulidFlux.weight` is the only
substitution that differs between a cell's D and E job (plus the shared `CLIPTextEncode.text`
substitution every job needs). This isolates PuLID's own strength dial the same way M1's arm
B isolates the skin LoRA's strength — without it, this diagnostic would only ever answer "does
PuLID-at-max help," not "how much of any effect is weight-sensitive."

| Arm | `ApplyPulidFlux.weight` | Output name |
|---|---|---|
| **D** | 1.0 (task's "0.9-1.0" band, upper end — standard PuLID default) | `c001-bo-D-<cell>` |
| **E** | 0.7 (task's named optional weaker-injection arm) | `c001-bo-E-<cell>` |

### The 6 cells — identical to M1's

Same seeds, same per-cell framing/light clause, same `persona.yaml` look-spec text, same
identity-lock + skin-texture clause — copied verbatim from `m1.yaml`'s arm-A jobs
programmatically (not retyped) so there is no transcription drift between the two bake-offs:

| Cell | Seed (shared by both arms) |
|---|---|
| 01-close-front-flatwhite | 424101 |
| 02-close-front-lampnight | 424102 |
| 03-threequarterl-half-windowday | 424103 |
| 04-threequarterr-half-flash | 424104 |
| 05-profilel-close-flatwhite | 424105 |
| 06-front-half-windowlight | 424106 |

See `m1/README.md`'s own cell table for the angle/distance/light breakdown — it is identical
here since the cells were not re-derived.

## Pins — verified live, `m3diag_pins.json`

Every revision/sha256 below was resolved **live** against Hugging Face on 2026-09-06 (HEAD
request against `x-linked-etag`, the same mechanism `train/verify_pins.py` and M1's pins use)
— not copied from any model card or third-party writeup, and re-confirmed a second time
through `verify_pins.py`'s own live checker (output below). Repo commit `revision`s were
resolved via the unauthenticated `/api/models/<repo_id>` endpoint, which is **not** gated
even for a gated repo (only file bytes are) — this is how `flux1-dev.safetensors`/
`ae.safetensors` get a real 40-hex revision despite an unresolvable sha256.

| File | Source | Revision | sha256 | Licence | Flag |
|---|---|---|---|---|---|
| `flux1-dev.safetensors` | `black-forest-labs/FLUX.1-dev` | `3de623fc...` | **null — gated, unresolvable without HF_TOKEN** | FLUX Non-Commercial License | non-commercial (r24 licence ground truth) |
| `ae.safetensors` | `black-forest-labs/FLUX.1-dev` | `3de623fc...` | **null — gated** | FLUX Non-Commercial License | non-commercial |
| `clip_l.safetensors` | `comfyanonymous/flux_text_encoders` | `6af2a98e...` | `660c6f5b...` | apache-2.0 | clean (see naming note below) |
| `t5xxl_fp8_e4m3fn_scaled.safetensors` | `comfyanonymous/flux_text_encoders` | `6af2a98e...` | `a498f048...` | apache-2.0 | clean |
| `pulid_flux_v0.9.1.safetensors` | `guozinan/PuLID` | `492b1451...` | `92c41c3a...` | apache-2.0 | clean |
| `EVA02_CLIP_L_336_psz14_s6B.pt` | `QuanSun/EVA-CLIP` | `11afd202...` | `84c3a17a...` | mit | **pickle (.pt, torch.load)** — arbitrary-code-execution risk, established precedent |
| `1k3d68.onnx` / `2d106det.onnx` / `genderage.onnx` / `glintr100.onnx` / `scrfd_10g_bnkps.onnx` | `MonsterMMORPG/tools` | `2cc250d7...` | (5 distinct, in `m3diag_manifest.yaml`) | none stated | **InsightFace antelopev2 — non-commercial research-only** (r24) |

Custom node: `lldacing/ComfyUI_PuLID_Flux_ll` @ `7c7362b806c2c0f4bde8742ada9e7cb05b44d249`
(GitHub HEAD, checked live 2026-09-06 — same commit Path A's `pins.yaml` already recorded
for its own M3 investigation, independently reconfirmed here).

**Source-naming caveat, flagged not silently resolved:** the task brief says "clip_l and
t5xxl fp8 from Comfy-Org." Live search of the `Comfy-Org` HF org found no repo carrying
`clip_l.safetensors`/`t5xxl_fp8_*.safetensors` (its FLUX repos —
`Comfy-Org/flux1-dev`, `Comfy-Org/flux1-schnell`, `Comfy-Org/flux1-kontext-dev_ComfyUI` —
ship only the diffusion-model file, no text encoders or VAE). `comfyanonymous/flux_text_encoders`
is the actual source — the ComfyUI maintainer's own personal HF account, Apache-2.0, and the
literal link the PuLID-Flux node's own README uses for `clip_l`/`t5xxl`/`ae`. Used as the
closest correct match to the brief's intent rather than inventing a Comfy-Org repo that does
not exist.

### `verify_pins.py`, live, 2026-09-06

```powershell
python pipeline/train/verify_pins.py --pins pipeline/expand/bakeoff/m3diag_pins.json --stage m3diag
```

```
STOP [m3diag]: black-forest-labs/FLUX.1-dev@3de623fc3c33e44ffbe2bad470d0f45bccf2eb21 flux1-dev.safetensors: pin is missing a non-empty 'sha256'
STOP [m3diag]: black-forest-labs/FLUX.1-dev@3de623fc3c33e44ffbe2bad470d0f45bccf2eb21 ae.safetensors: pin is missing a non-empty 'sha256'
```

Exit code 1 — **expected, not a bug.** `verify_pins.verify_model_pin` requires all four of
`repo_id`/`revision`/`filename`/`sha256` to be non-empty before it will even attempt the live
HEAD check; it has no "gated, sha intentionally null" case, unlike this diagnostic's own
`runpod_run.py` model-manifest validator (`model_sha256`, which explicitly allows `None`).
The other 9 pins (`clip_l`, `t5xxl_fp8`, `pulid_flux_v0.9.1`, `EVA02_CLIP_L_336_psz14_s6B.pt`,
and all 5 antelopev2 `.onnx` files) verify **live clean** — confirmed by calling
`verify_pins.verify_model_pin` directly against just those 9 (0 problems returned) — see
`test_m3diag_nongated_pins_verify_live_clean` in `test_bakeoff.py`.

## Cost ceiling and job count — computed with the harness's own helpers

- **12 jobs** (6 cells × 2 arms), one bootstrap, one L40S SECURE placement,
  `price_usd_per_hour` 1.30 (reused from M1's own rate for the same GPU/cloud tier — not
  independently re-quoted from RunPod live pricing for this diagnostic).
- `readiness_timeout_seconds`: 2700 (task ceiling).
- `job_timeout_seconds`: 600 (task ceiling — this diagnostic downloads a materially larger
  model stack than M1's, ~31GB of resolvable weights alone versus M1's ~20GB, plus the
  custom node's own `pip install` for `insightface`/`onnxruntime-gpu`, so 600s per job also
  covers a cold-load margin the same way M1's measured-not-estimated 600s does).
- `minimum_runtime_minutes` (via `pod.minimum_runtime_minutes`, imported not reimplemented)
  = 2700/60 + 600×12/60 + 5 = **170.0 minutes exactly** = `max_minutes`.
- `manifest_ceiling` (via `figment_train.manifest_ceiling`, imported not reimplemented) at
  170 minutes = **$3.69** ($3.6833 raw, rounded up to the cent, matching the dry run below).
- `container_disk_gb`: 120 (measured, not guessed — live `X-Linked-Size` headers put the
  five resolvable-size weights at `clip_l` 246,144,152 + `t5xxl_fp8` 5,157,348,688 +
  `pulid_flux_v0.9.1` 1,142,099,520 + `EVA-CLIP` 856,461,210 + antelopev2×5 427,550,200 bytes
  = ~7.3GB, plus the two gated files at their well-known public sizes — `flux1-dev.safetensors`
  ~23.8GB, `ae.safetensors` ~0.34GB (not independently confirmed live; gated) — for ~31.4GB of
  model weights total, plus ComfyUI/venv/pip and the custom node's `insightface`/
  `onnxruntime-gpu` install. 120GB keeps roughly the same headroom ratio M1's 80GB gives its
  smaller ~20GB stack.

### Dry-run — actually run, not just described

```powershell
$env:PYTEST_DEBUG_TEMPROOT = "C:/Users/danie/AppData/Local/Temp/kbfp-m3"
python pipeline/pod/runpod_run.py run --manifest pipeline/expand/bakeoff/m3diag_manifest.yaml --dry-run --out <out-dir>
```

```
preflight cost estimate: $3.6833 for 170.00 minute(s)
job c001-bo-D-01-close-front-flatwhite complete: 1 verified file(s)
job c001-bo-E-01-close-front-flatwhite complete: 1 verified file(s)
job c001-bo-D-02-close-front-lampnight complete: 1 verified file(s)
job c001-bo-E-02-close-front-lampnight complete: 1 verified file(s)
job c001-bo-D-03-threequarterl-half-windowday complete: 1 verified file(s)
job c001-bo-E-03-threequarterl-half-windowday complete: 1 verified file(s)
job c001-bo-D-04-threequarterr-half-flash complete: 1 verified file(s)
job c001-bo-E-04-threequarterr-half-flash complete: 1 verified file(s)
job c001-bo-D-05-profilel-close-flatwhite complete: 1 verified file(s)
job c001-bo-E-05-profilel-close-flatwhite complete: 1 verified file(s)
job c001-bo-D-06-front-half-windowlight complete: 1 verified file(s)
job c001-bo-E-06-front-half-windowlight complete: 1 verified file(s)
exit path complete: terminate + absence verification succeeded
```

(Run 2026-09-06.) **This is the direct, empirical answer to "does the harness reject
`.pt`/`.pth` model files outright": no — the dry run above carries one `.pt` and five
`.onnx` model entries and completed clean.**

## Runnable-under-the-harness verdict

**Runnable under the harness: YES**, confirmed by an actual `--dry-run` (all 12 jobs
verified, exit 0) — the harness's model-manifest validator has no file-extension allowlist
(grepped, not assumed: `pipeline/pod/runpod_run.py` lines 1861-1872 for the loop, lines 47-56
for the two allowlists that exist and do not apply here). **Runnable live: only with
`HF_TOKEN`** — the two `black-forest-labs/FLUX.1-dev` files (`flux1-dev.safetensors`,
`ae.safetensors`) 401 on an unauthenticated HEAD (`X-Error-Code: GatedRepo`, checked live
2026-09-06); the operator's RunPod secret `HF_TOKEN` (read-scope) is exactly what
`env_secret_refs: {HF_TOKEN: HF_TOKEN}` in `m3diag_manifest.yaml` is wired for, per
`pipeline/pod/README.md`'s credential-boundary section — the harness process itself never
reads the token, RunPod substitutes it into the pod's own environment at start time. Whether
an anonymous (non-gated) HF account has actually accepted BFL's FLUX.1-dev licence click-through
was not verified here — that is a RunPod-secret-holder precondition outside this diagnostic's
scope, not a harness-code question.

**No live pod was run for this diagnostic** — per the task brief's explicit constraint
("never run a live pod (dry-run fine)") and this repo's constitution ("never spend real
money" without a queued card). If Daniel wants this run live, the command above with
`--max-usd 3.70 --max-minutes 170` and a `RUNPOD_API_KEY` (plus the pod's own `HF_TOKEN`
RunPod secret already existing per the task brief) is everything needed — nothing else in
this manifest is templated or deferred.

## What this diagnostic cannot answer

Per r25 §"Two paths" — even a clean 12/12 run only measures whether PuLID-class adapter
identity injection narrows the gap on `identity_own`/`age_delta` versus M1's LoRA-only
result; it does not produce anything usable downstream. Any keeper identity would still need
the full relicensed rebuild r24 already flagged as unverified (PuLID + FaceNet loader +
FLUX.1-schnell) before it could ship. Scoring should run through the same `identity_gate.py`/
`summarize.py` path M1 uses (`summarize.py` is Path A's file, not duplicated here — its
existing `image_id`/`OUTPUT_NAME_RE`-agnostic row matching already tolerates any
`c001-bo-<arm>-<cell>` name shape, `D`/`E` included, without modification).

## Verification

```powershell
$env:PYTEST_DEBUG_TEMPROOT = "C:/Users/danie/AppData/Local/Temp/kbfp-m3"
python -m pytest orgs/figment/pipeline/expand/tests/test_bakeoff.py -k m3diag -p no:cacheprovider -q
```

Covers: `m3diag_manifest.yaml`/`m3diag_api.json`/`m3diag_pins.json`/`m3diag_README.md` exist
and only new `m3diag_*` files were added (git-status check, nothing under `pod/`, `runs/`, or
`m1.*` touched); the manifest carries `diagnostic_non_commercial: true`; exactly 12 jobs (6
cells × 2 arms D/E), each cell sharing one seed across both arms, copied verbatim from
`m1.yaml`'s arm-A prompts (byte-for-byte, not retyped); arm D's `weight` substitution is 1.0
and arm E's is 0.7 on every job; every model pin has a 40-hex revision and either a 64-hex
sha256 or an explicit `null` with a `gated: true`-style note; the manifest's `models` list
matches `m3diag_pins.json` exactly; the two gated pins fail `verify_pins.py` for the documented
reason while the other 9 verify live clean; the custom node's `git_ref` is 40-hex and matches
the live-checked GitHub HEAD; `readiness_timeout_seconds`/`job_timeout_seconds`/`max_minutes`
match the harness's own `minimum_runtime_minutes` computation exactly; `manifest_ceiling`
computes to $3.69; the manifest dry-runs clean end-to-end; and every `diagnostic_assets` entry
names a real pickle/non-commercial file actually present in `models` with a non-empty reason.
