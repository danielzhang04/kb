# figment creator-001 — end-to-end design (stages 1–9, voice, explicit-tier machine, dashboard)

Written 2026-09-03 on branch `claude/figment`. Derives from `orgs/figment/MANDATE.md`; binds under
`orgs/figment/pipeline/GUARDRAILS.md`; obeys `CLAUDE.md` (branches, cards, memory),
`governance/risk-tiers.md`, `governance/card-schema.md`, `governance/model-routing.yaml`.

Creator 001 is both the first influencer and the pipeline proof (FYT's first-channel pattern):
research → infrastructure → tests/reviews → her expansion and LoRA **through** the finished pipeline,
never ahead of it (identity-spec §Ordering).

## 0. Evidence base, and one gap

| Source | Used for |
|---|---|
| `research/r11` §1 §7, `r12` §1 §10 | base-model arms, klein-native reference path, ranked test plan, per-arm BOM |
| `research/r14`, `r15` | 10sorlabs module map; workflow settings, caption doctrine, dataset-tester, SOP rules, compliance rejections |
| `research/r16` | stage-5 pass chain, QA scorer shortlist, licence verdicts |
| `research/r17` | stage-6 video chain, video gates, reel manifest schema, voice chain |
| `research/r18` | content taxonomy, carousel/reel templates, cadence, KPIs, Graph API fields |
| `research/r19` | API-first N-account operating model, provisioning, capability matrix, risk register |
| `pipeline/pod/README.md`, `runpod_run.py`, `REVIEW-e-2026-09-03.md` | manifest schema, spend guards, exit-path guarantee, 21 open defects |
| `pipeline/train/*`, `pipeline/calibrate/`, `pipeline/qa_stamp.py`, `pipeline/reuse-from-fyt.md` | training scaffolding, identity scoring, grid driver, review stamp, FYT reuse map |
| `agents/fyt-runner.md`, FYT `.claude/skills/README.md` | gates-first conductor shape, single-writer rule, three-state stamp, spend law |
| `docs/superpowers/specs/2026-08-04-dashboard-ux-overhaul-design.md` | the five kb dashboard surfaces this spec extends |

**Gap (recorded, not worked around).** `research/r15b-training.md`, `r15b-generation.md` and
`r15b-edit-motion.md` — the module-video reports — **did not exist when this spec was written**
(`research/` listing, 2026-09-03). Everything below that would have depended on them rests on the
artefact-derived numbers in r15 §3–§4 instead, which r15 itself states are recoverable from files
rather than audio. The three values still video-only are **LoRA rank, learning rate, batch size and
training resolution** (r15 §7). §3 S3 below fixes provisional values and makes the dataset-tester,
not the video, the arbiter. When the r15b reports land, re-check S3's training block and S6's motion
block against them; nothing else in this spec is exposed to that gap.

## 1. Goal and success conditions

**Goal.** One reference image of a fictional adult woman becomes a disclosed AI Instagram creator
whose content is generated, QA'd, approved, posted, measured and re-mixed by the kb fleet, unattended
between operator gates — and the machinery that does it is reusable for creator 002…N from one
dashboard.

### 1a. creator-001 (testable)

| # | Success condition | How it is proven |
|---|---|---|
| C1 | An identity set of ≥40 curated cells reads as one woman across 5 angles × 2 distances × 4 lighting families | `identity_check.py` anchor cosine ≥ the persona floor on every cell; DINO cohesion reported; operator eye-gate `verified` on the board |
| C2 | A persona LoRA holds that identity on held-out prompts it never trained on | dataset-tester grid (fixed seed/prompt/sampler, LoRA the only variable) + 6 held-out prompts × 2 seeds; operator picks a checkpoint |
| C3 | Register lock reproduces the operator taste anchor on demand | register-proof grid: 12 cells at locked settings, operator `verified` |
| C4 | Stage-5 passes add texture without smoothing, relighting or drifting identity | 12-cell A/B (r16 §4): identity above floor, crop Laplacian/local-variance up, no clipping, blinded eye-gate prefers the passed cell |
| C5 | A 5–8 s clip holds the face under motion | r17 gates 1–4: decode, per-frame ArcFace median/min/slope, flicker spikes, eye-gate |
| C6 | One week of content is produced, approved and published through the Graph API with disclosure intact | 7 units published; every container carried `is_ai_generated: true`; publish audit rows exist; `content_publishing_limit` respected |
| C7 | Measurement closes the loop | +24 h/+48 h/+7 d insight snapshots stored with API version; the 8 KPIs in r18 §6 computed; an optimiser proposal produced for the next week's mix |
| C8 | Zero guardrail breach across the arc | no real-person likeness prompt, no ambiguous-age cell shipped, no explicit generation on rented compute, every pod terminated **and verified**, no credential handled as an object, no platform spend |
| C9 | The arc cost ≤ $50 | sum of `ledgers/cost/figment-*.tsv` at arc close; every pod ran with `--max-usd` |

### 1b. platform (testable)

| # | Success condition | How it is proven |
|---|---|---|
| P1 | Adding creator 002 needs one new `persona.yaml` + one operator-provisioned account record, and no code change | dry-run the full stage graph for a second persona fixture; diff = data files only |
| P2 | Every stage is resumable from disk, not from conversation | kill a stage mid-run; re-enter; state is derived from `run.json`, `batch.json` and `scores.json` alone |
| P3 | Every gate has an honest "not yet" | `qa_stamp.py` is the only writer of `review_status`; `parked` reachable at every gate |
| P4 | Every spend-controlling, identity-scoring or posting unit has a different-model adversarial review plus tests before it runs live | review file per unit under `pipeline/<stage>/REVIEW-*.md`; test count recorded |
| P5 | N accounts run on one Meta app with per-account grants; a failure on one pauses only that one | fault-injection: expire one account's grant, assert only that account's queue pauses and one operator task is filed |

## 2. Architecture

### 2.1 Components

| Component | Path | Kind | Status |
|---|---|---|---|
| Pod harness (lease, spend, transport, artifacts) | `pipeline/pod/runpod_run.py` | existing, 21 open defects | extend |
| Expansion builder | `pipeline/expand/build_expansion_set.py` | new (generalises `train/build_identity_set.py`) | new |
| Identity/register scorer | `pipeline/train/identity_check.py` | existing | extend (register axis) |
| Training scaffolding | `pipeline/train/` (templates, start script, manifest) | existing | correct + test |
| Dataset tester | `pipeline/train/workflows/dataset_tester_api.json` + `rank_checkpoints.py` | new (port of r15 §3g) | new |
| Register lock | `pipeline/register/` (absorbs `pipeline/calibrate/`) | existing driver, parked | revive |
| Stage-5 pass chain | `pipeline/passes/` | new | new |
| Video chain | `pipeline/video/` | new | new |
| Content planner | `pipeline/content/` (taxonomy, templates, `plan_week.py`) | new | new |
| Publisher | `pipeline/publish/` (`post.py`, `accounts.yaml`, `quota.py`) | new | new |
| Insights + optimiser | `pipeline/insights/` (`pull_insights.py`, `warehouse/`, `optimise.py`) | new | new |
| Review surfaces | `pipeline/qa_stamp.py`, `blind_pool.py`, `build_grading_board.py` | existing (FYT port) | reuse as-is |
| Voice | `pipeline/voice/` | spec only this arc | later |
| Explicit-tier machine | `pipeline/explicit/` | grammar + adapters only, clothed fixtures | new |

**Runner rule.** Every stage is `manifest (data) + thin runner (code)`. GPU stages (2, 2b, 3, 4, 5, 6)
express their manifest in the **pod harness schema** and are executed by `runpod_run.py`. Non-GPU
stages (7, 8, 9) are **not** pod work and do not inherit the pod-lease keys; they use the same
dependency-free YAML/JSON loader (`runpod_run.load_document`) over their own schemas. Forcing a
posting job into a pod-lease manifest would import GPU, readiness and teardown semantics that have no
meaning there.

### 2.2 Data model

`persona.yaml` is the **machine** source of truth — the only file a runner reads. `identity-spec.md`
and `look-spec-v2.md` remain the human rationale and are referenced by path + sha from `persona.yaml`,
so there is exactly one authority per consumer and drift is detectable.

```yaml
# personas/creator-001/persona.yaml
id: creator-001
disclosure: {is_ai_generated: true, bio_line: <operator-authored>, profile_label: required}
identity:
  references: [anchors/g01.jpg, anchors/g02.jpg, anchors/g07.jpg]   # order = canvas (identity-spec)
  spec: {path: identity-spec.md, sha256: <sha>}
  floor: {anchor_cosine_p5: <derived>, min_face_px: 600}
body_target: {source: identity-spec#body, exemplars: [g02, g07]}
register:
  spec: {path: ../../pipeline/look-spec-v2.md, sha256: <sha>, section: "0"}
  settings: {makeup: abg-glam-v1, skin: texture-visible, light: [flat-white, window-day, lamp-night, on-camera-flash], wardrobe_families: [cami, corset, baby-tee, skirt, shorts]}
lora: {persona: null, register: null, trigger: <token>, base: flux2-klein-base-4b}
voice: {manifest: null}
accounts: [{platform: instagram, handle: <operator>, account_ref: <opaque>, tier: instagram}]
tiers:
  instagram: {store: batches/, ceiling: swimwear, compute: pod|local}
  explicit:  {store: <operator-local path, never in repo>, compute: operator-hardware-only}
```

| Record | File | Key fields | Written by |
|---|---|---|---|
| persona | `personas/<id>/persona.yaml` | above | operator + `figment-runner` (never a generating stage) |
| batch | `personas/<id>/batches/<batch-id>/batch.json` | `batch_id`, `stage`, `manifest_sha`, `pod_run_json`, `cells[]`, `cost_usd` | the stage runner |
| cell | inside `batch.json` | `cell_id`, `tag` (angle×distance×light×wardrobe), `seed`, `prompt_sha`, `path`, `state`, `review_status`, `parked_reasons[]` | generator writes through `state: scored`; `qa_stamp.py` alone writes `review_status` |
| score | `.../scores.json` | `cell_id`, `anchor_cosine`, `dino_cohesion`, `face_px`, `laplacian`, `local_variance`, `clipped_frac`, `ocr_text`, `garment_class` | scorer runner |
| account | `pipeline/publish/accounts.yaml` | `account_ref`, `platform`, `login_route`, `scopes[]`, `token_health`, `quota_seen_at`, `paused_reason` — **no secret material** | operator (creation) + `figment-poster` (health only) |
| post | `pipeline/publish/posts/<account>/<post-id>.json` | `media_id`, `container_id`, `idempotency_key`, `cells[]`, `template_id`, `is_ai_generated`, `published_at`, `api_version` | `figment-poster` |
| insight | `pipeline/insights/warehouse/<account>/<date>.tsv` | `media_id`, `metric`, `value`, `period`, `api_version`, `fetched_at`, `offset` (24h/48h/7d) | `figment-analyst` |

### 2.3 File layout

```
orgs/figment/
  _index.md STATE.md contract.md HEARTBEAT.md MANDATE.md README.md
  personas/creator-001/{persona.yaml, identity-spec.md, anchors/*, batches/<id>/*}
  pipeline/{pod,expand,train,register,passes,video,content,publish,insights,voice,explicit}/
  pipeline/{qa_stamp.py,blind_pool.py,build_grading_board.py,GUARDRAILS.md,look-spec-v2.md,reuse-from-fyt.md}
  research/
```

Tracked: manifests, `batch.json`, `scores.json`, `run.json`, review rulings, code, docs.
Gitignored bulk (append to root `.gitignore` beside the existing figment rules): `personas/*/anchors/`,
`personas/*/batches/*/images/`, `personas/*/batches/*/rejected/`, `pipeline/*/runs/*/out/`, `*/board.html`.

Anchor bulk currently sits at `personas/anchors/gemini-batch-01/` (identity-spec) and is staged for
pod upload under `pipeline/train/runs/_uploads/` (the path the existing gitignore rule covers is
`pipeline/train/runs/anchors/`). P1 moves it to `personas/creator-001/anchors/`, updates the gitignore
rule, and makes `persona.yaml` the single place any runner resolves a reference path from — the
current three-location spread is how the `g04` vs `g01` reference-set drift (REVIEW-e condition 3)
survived to a committed manifest.

### 2.4 Cell state machine (one card, one state)

```
generated ──score──> scored ──┬─ hard QA fail ─> quarantined   (file moved to rejected/, terminal)
                              ├─ pass + selected -> curated ──eye-gate verified──> approved
                              └─ pass + surplus  -> culled     (re-curatable, never shipped)
approved ──> scheduled ──> posted ──> measured
```

Rules. `quarantined` exists separately from `culled` because GUARDRAIL 4 requires quarantine-and-
regenerate for render failures while curation surplus is merely unused — collapsing them loses the
failure signal. The FYT three-state stamp rides orthogonally: every cell is `unreviewed` until
`qa_stamp.py` writes `verified` (→ `approved`) or `parked` (→ back to `quarantined` with reasons).
Nothing converts an inconclusive review into `verified`. Exactly one writer owns each transition; a
stage never writes a transition its own output is judged by.

### 2.5 Credential boundary

Ambient environment only, never objects (GUARDRAIL 5). `RUNPOD_API_KEY` is read once into the REST
session header and never reaches the pod, `run.json`, logs or the proxy (verified in REVIEW-e §Checked
and found sound). Meta tokens live in the controlled runtime; `accounts.yaml` stores an opaque
`account_ref` and a health state, never a token, cookie or refresh secret. Playwright profile
directories live outside the repo. No agent opens a credential store, and no agent creates, verifies
or warms an account — those are operator gates (r19 §3).

### 2.6 Tier separation

| | Instagram tier | Explicit tier |
|---|---|---|
| Compute | RunPod pods **or** operator hardware | operator hardware only |
| Who generates | agents | the operator, by hand |
| Who authors prompts | agents (clothed vocabulary) | the operator (agents ship an **empty** vocabulary) |
| Who judges | `figment-checker` + operator | operator, or a local model against the operator's rubric |
| Store | `personas/<id>/batches/` (gitignored bulk) | operator-local path, never referenced by a repo file beyond a name |
| Accounts | `accounts.yaml`, tier `instagram` | separate records, separate app, never in this file |

Agents build, test and review the explicit machine **on clothed fixtures**. The wardrobe ceiling for
anything an agent generates is swimwear/lingerie (Instagram tier); anything unclothed is out of bounds
even as a prompt string. r15 §3f records that module 10's clothing-removal branch exists; it is not
ported.

### 2.7 Spend controls (layered, all fail-closed)

1. `--max-usd` required on every live pod run; the manifest rate is distrusted after create and the
   real `adjustedCostPerHr` is re-checked against it (`pod/README.md` §Spend ceilings).
2. Daily guard: `governance/budget.yaml` `daily_usd_limit: 10.00` vs today's cost ledger. A day
   carrying both an expansion run and a training pod breaches it — the operator raises it for the run
   (MANDATE §Budget) or the runs are split across days.
3. Arc cap: `--arc-cap-usd 50` summing every `ledgers/cost/figment-*.tsv` row; refuses a create that
   would exceed.
4. Wall-clock: `max_minutes` ≤ the hard `DEFAULT_MAX_MINUTES` 60. **See S3 — this ceiling cannot
   contain a real LoRA run and is amended there, for the training path only.**
5. Zero platform spend, always: no boosts, subscriptions, PPV, tips or "free trials" (GUARDRAILS
   §research browsing). r15 §5b's boost ladder is recorded as an operator playbook, never built.

Per-stage ceilings and the planned arc total are in §9.

## 3. Stages

Common to every row: **reuse** = pod harness lease/spend/teardown, `qa_stamp.py`, `blind_pool.py`,
`build_grading_board.py`, FYT's single-writer and three-state discipline. **Adversarial review** = a
different model/session than the author, before the unit runs live, per MANDATE §Operating principles.

### S1 — Anchor (done)

| | |
|---|---|
| In / out | operator's `gemini-batch-01`; out = the reference set of record `g01, g02, g07` in that order |
| Manifest keys | `persona.identity.references[]` (order is load-bearing: reference order = canvas, identity-spec §Composite findings) |
| Gate | closed by the operator 2026-09-03 07:05 |
| Open defect | the committed `train/runs/creator-001-expansion-01.yaml` uploads `g04/g01/g07`; the ruling is `g01/g02/g07` (REVIEW-e condition 3). expansion-02 must carry the ruled set and `_uploads/` must be created |

### S2 — Identity expansion (expansion-02)

| | |
|---|---|
| Inputs | 3 reference JPEGs; `pipeline/train/workflows/klein4b_multiref_api.json`; persona register settings |
| Outputs | 72 generated cells → `batch.json` + `scores.json` + board; curated set of 40 |
| Base | FLUX.2 klein 4B **Base** (Apache-2.0), `Comfy-Org/flux2-klein-4B` diffusion model + `qwen_3_4b` encoder + `flux2-vae` (r11 §7 arm B, sizes confirmed) |
| Cell grammar | `angle(5) × distance(2: close, half-body) × lighting(4) × wardrobe-family` — a unique `cell_id` tag per cell. **Full-body cells are a second pass**, never a single full-frame swap (identity-spec §Rule for expansion: face-pixel density governs swap quality) |
| Prompt doctrine | one prompt per cell with an explicit *do-not-alter* identity clause (r15 §3b), face angle stated explicitly, 80–250 words, exclusions inside the positive prompt (r15 §6b), braced-alternative template as the generator (r15 §6b) |
| Manifest keys | pod schema: `models[]`, `workflow`, `seed_fields:[noise_seed]`, `uploads[]`, `jobs[]{seed,output_name,expected_images,substitutions[]}`, `job_timeout_seconds`, `readiness_timeout_seconds`, `max_minutes`, `avoid_machine_hosts` |
| **Run shape (load-bearing)** | expansion-01's shape (24 jobs × `job_timeout_seconds: 900`, readiness 1200, `max_minutes: 30`) **cannot finish** (REVIEW-e finding 5). A klein 4B cell at 1024×1280 is seconds, not 15 minutes. Under finding 5's corrected preflight — `max_minutes×60 ≥ readiness + len(jobs)×job_timeout + 300 s teardown` — and the hard 60-minute cap, the budget is `readiness + N×job_timeout ≤ 3300 s`. expansion-02 therefore runs as **4 pod runs × 18 cells = 72 cells**, `job_timeout_seconds: 120`, `readiness_timeout_seconds: 900`, `max_minutes: 60` → 900 + 18×120 + 300 = 3 360 s ≤ 3 600 s. Cache the three model files on a `network_volume_id` so runs 2–4 skip the download and their real readiness falls well under the budgeted 900 s |
| QA / scoring | `identity_check.py` (FaceNet anchor cosine, DINO cohesion, fail-closed on no face) + crop Laplacian, clipped fraction, garment classifier, OCR gate (r16 §2 thresholds are *triage starts*, calibrated on 60 labelled outputs before any route is automated) |
| Human gate | **STOP.** Blind board (`build_grading_board.py --blind` over `blind_pool.py`), operator rulings → `qa_stamp.py`. Nothing proceeds to S3 without `verified` on ≥40 cells |
| Cost | `--max-usd 0.90` per run; 4 runs; planned ≈ $2.15 at $0.80/h, ceiling $3.60 |
| Tests | manifest preflight refuses a job budget that cannot fit `max_minutes`; cell-tag uniqueness; every job's substitutions resolve; `--dry-run` produces the full prompt set at zero cost |
| Review | adversarial review of `build_expansion_set.py` + the manifest before the first live run (spend-controlling) |
| New vs reuse | new: expansion builder, cell grammar, board wiring. reuse: harness, scorer, stamp, board generator |

### S2b — Swimwear/lingerie tier extension (separate batch)

MANDATE §3 puts minimally-clothed body in the LoRA's scope, so this is built — but as its **own
batch, its own eye-gate, and excluded from LoRA v1**. Reason: GUARDRAIL 4 records three recurrences of
silent clothing-render failure; isolating the highest-risk wardrobe family keeps LoRA v1 to one
variable and makes the failure rate measurable. 12–16 cells, same grammar, `unsafe >= 0.10` on the
garment classifier quarantines. Folded into LoRA v2 only after v1 passes its held-out test.
Cost `--max-usd 0.60`.

### S3 — Persona LoRA

| | |
|---|---|
| Inputs | 40 curated `approved` cells + captions; `diffusion-pipe-klein4b.toml.template`; `dataset.toml.template` |
| Outputs | checkpoints every 250 steps + final `<trigger>.safetensors`, `adapter.json`, run config copy |
| Trainer | diffusion-pipe on klein 4B **Base** — upstream states the distilled variant will not train well (r11 §7) |
| **Caption doctrine** | `<trigger> woman` — trigger token + class token, nothing else. r15 §4 establishes the package's doctrine is class-token-only (`woman`, 40 files) with **no** trigger; our committed `dataset.toml.template` says captions begin with the trigger. They conflict because the package trains Krea2 in Ostris AI Toolkit while we train klein in diffusion-pipe, where inference needs a handle. The resolution keeps the package's *no per-image description* finding and adds the one token the different stack requires |
| **Step/checkpoint reconciliation** | the committed template says `max_steps 1600 / save_every_n_steps 200`; the package infers ≈2 750–3 000 steps at a 250 cadence (r15 §3g/§4). Set `max_steps 2000`, `save_every_n_steps 250` → 8 checkpoints, and let the dataset-tester pick. rank 32 / lr 5e-5 / bs 1 / 1024 px stay as the template's declared *starting* values — r15 §7 records rank/LR/batch/resolution as the numbers still only in the unwatched module-11 video |
| **Wall-clock defect** | 2 000 steps at rank 32, 1024 px, bs 1 on a 4090 is 50–100 min. The harness hard cap is 60. Fix: a `TRAINING_MAX_MINUTES` of 180 that applies **only** when `training` is present in the manifest; `DEFAULT_MAX_MINUTES` stays 60 for image runs; `--max-usd` and the arc cap are unchanged and still bind. Alternative (checkpoint-resume across pods) is rejected for this arc: it needs artifact upload back to a pod and doubles the transport surface that REVIEW-e findings 3/4/6 already indict. **Corroboration:** `train-pod.manifest.template.yaml` was edited to `max_minutes: 70` during this spec's drafting, making readiness 1200 + job 2700 + 300 teardown internally consistent at exactly 70 min — but the harness takes the **minimum** of the CLI value, the manifest value and `DEFAULT_MAX_MINUTES`, so 70 is silently clamped to 60 and the run still cannot finish. The template edit is necessary and not sufficient; the constant must move too |
| Dataset tester | port of r15 §3g: **fixed seed, fixed prompt, fixed sampler, fixed resolution; the LoRA checkpoint is the only free variable.** One ComfyUI graph, 8–12 parallel `UNETLoader→LoraLoader→KSampler` branches joined by `BatchImages`, `expected_images` = branch count, one job per held-out prompt |
| Held-out test | 6 prompts × 2 seeds never present in training; identity floor + adult-read + register adherence scored separately (r12 §10) |
| Human gate | **STOP.** Operator picks the checkpoint from the ranked grid |
| Cost | training `--max-usd 2.40`; tester `--max-usd 0.40` |
| Tests | REVIEW-e's named tests 3, 4, 5, 7, 9, 10, 12, 14 (all training-path) plus a `TRAINING_MAX_MINUTES` preflight test |
| Review | **blocking.** REVIEW-e verdict is "SAFE TO RUN LIVE for a training pod: **NO**" until findings 3 (truncated artifact accepted), 4 (one proxy blip kills the run), 5 (impossible max_minutes) are fixed. No training pod runs before that |
| New vs reuse | new: dataset tester + `rank_checkpoints.py`, training-path harness fixes. reuse: templates, start script, upload/artifact transport |

### S4 — Register lock

| | |
|---|---|
| Inputs | picked LoRA checkpoint; `look-spec-v2.md` §0 operator taste anchor; `persona.register.settings` |
| Outputs | `register.yaml` — makeup / skin finish / body / lighting families / wardrobe families as generation settings on top of the LoRA; calibration grid contact sheets |
| Runner | revive `pipeline/calibrate/grid_run.py` (single-axis grids, already tested) under `pipeline/register/` |
| Axes | the existing `axes/{age,body,makeup,posture,prettiness}.yaml` plus a `light` axis; one axis varied per grid, everything else pinned |
| QA | identity floor must hold at every grid point (a register that moves face geometry is rejected — r12 §1.8); register adherence scored by the new axis in `identity_check.py` |
| Human gate | **STOP.** register-proof: 12 cells at locked settings, operator `verified` |
| Cost | `--max-usd 0.80` total across 2 grid runs |
| Decision | settings-first. A **separate register style LoRA** (r12 §1.7, rank 6 of §10) is a later, gated option — it costs 180–300 pod-minutes, a large fraction of the $50 arc, and r12 §11 records no published measurement of persona+register LoRA interference |
| Tests | existing `calibrate/tests/test_grid_run.py` extended for the light axis and for identity-floor enforcement |

### S5 — Image generation with passes

Ordered chain (r16 §1), each stage a switchable manifest branch retaining every intermediate:

| Order | Pass | Choice and why |
|---|---|---|
| 0 | Base render | klein 4B Base + persona LoRA + register settings; native graph |
| 1 | Conditional face repair | **native klein 4B Base edit template via `ReferenceLatent`**, 0.20–0.35 intervention, only when the face crop is small or the detector flags it. Impact FaceDetailer is *not* the default: r16 records the Subpack repo itself is **AGPL-3.0**, and the only FLUX.2 evidence targets klein **9B**, not the 4B Base this stack uses |
| 2 | Identity/register gate | `identity_check.py`; fail closed on no face; log crop and score **before** any upscale |
| 3 | Pixel upscale | Real-ESRGAN x4plus (BSD-3), **2× then downsample** to delivery size. NMKD and 4x-UltraSharp rejected (unverified / CC-BY-NC-SA-4.0, r16 §3) |
| 4 | Texture add | **Detail Daemon (MIT, pinned `3394e44`)**, one pass, conservative schedule. The 10sorlabs "skin enhancer" is `ClownOptions_DetailBoost_Beta` from RES4LYF (r15 §3f) — same mechanism (a sampler-schedule option over a step window, not a post filter), but RES4LYF's licence is unchecked in r15 and absent from r16. RES4LYF is a **hold**, admissible only after a licence check |
| 5 | Grain / sensor character | ProPost "Film Grain" (MIT, pinned `df6a6d1`), 0.003–0.008 normalised, **last** so the upscaler cannot erase it |
| 6 | QA scorers + route | identity, MagFace quality, Laplacian/clipping/local-variance, OCR gate, garment classifier, human eye gate. Hard fail → quarantine; near-threshold → review; **never auto-publish** |
| — | De-gloss | separate from the texture pass: conservative Detail Daemon first, deterministic fine grain + local highlight compression second. "Realistic skin" community LoRAs rejected by default (SDXL-targeted or licence-blank) |

| | |
|---|---|
| Promotion rule | a pass is adopted only if the 12-cell A/B (r16 §4: 2 base arms × 2 face-repair × 3 detail chains, same seed/prompt/reference) shows identity above floor, crop texture up without clipping/halo, no QA hard failure, **and** a blinded eye-gate prefers it. Keep a rejected-pass contact sheet as evidence for the does-not-smooth rule |
| Manifest keys | `chain[]` of `{pass, enabled, node_group, params}` over the pod schema's `workflow` + `substitutions` |
| Human gate | blinded A/B eye-gate before promotion; batch approval per output batch |
| Cost | `--max-usd 1.10` for the A/B |
| Licence law | every external node enters as a **pinned commit**; every model as `{repo_id, filename, destination_dir}` with a recorded licence. Unpinned `git clone` + `pip install -r requirements.txt` is the eromify-mcp shape at one remove (r15 §2d) and is refused |

### S6 — Video with passes

| | |
|---|---|
| Base | Wan 2.2 **TI2V-5B** on a 4090 for the proof (Apache-2.0, official 24-GB offload path); **Animate-14B** on 48 GB for driver-clip shots; A14B only after 5B establishes the QA path |
| Start-frame doctrine | persona-swap the first frame from the driver, then animate (r14 §08/§14 via r17 §1). Driver requirements: one visible adult, stable light/background, continuous 5–8 s motion, unobscured face/hands, no cuts/whip-pans |
| Gates (all four, in order) | (1) decode frames, record count/fps/seed/workflow/model SHA; (2) per-frame ArcFace anchor cosine — median, minimum, slope, worst-frame thumbnails, thresholds locked only after a 20-clip labelled set; (3) adjacent-frame embedding delta + optical-flow residual, inspect the top five spikes for flicker/identity jump/hands/teeth/gloss; (4) only then RIFE (if needed) and SeedVR2, then repeat 1–3 plus an eye gate. **Quarantine, never "repair until pass."** |
| Not a video pass | FaceDetailer — its own docs say it is not a video detailing node; per-frame repainting creates flicker |
| Reel template | the r17 §2 YAML schema as an editable manifest (`id, tier, aspect_ratio, duration_s, hook, beats[], driver, identity, generation, cuts[], loop, overlay, audio, qa`) |
| Human gate | eye-gate on every clip; no auto-publish |
| Cost | r17's two proof runs, `max_usd: 0.50` each; planned $0.70 |
| Tests | frame-QA scorer unit tests on synthetic frame sequences; manifest schema validation; dry-run |
| Review | adversarial review of the frame-QA scorer (identity-scoring unit) before live |

### S7 — Content strategy

| | |
|---|---|
| Taxonomy | r18 §1 categories A–G as `content/taxonomy.yaml`; the weekly mix **3 reels + 3 carousels + 1 single** = 14 stills + 3 short videos; category split A 36 / B 21 / C 21 / D 14 / E 7, F as substitution stock. The cheap non-persona half (C/D/E/F ≈ 43%) carries no identity risk and is what makes a 7-post week affordable |
| Templates | carousel CT-1…CT-7 and reel RT-1…RT-6 (r18 §2/§3) as editable manifests: **roles + variables**, not fixed scenes (the theme × variable-slot shape, r18 §2/C28). Slot 1 is the frame you would have posted alone; cap 5 slides (the cohort never exceeded it) |
| Aspect | feed 3:4 1080×1440 (measured 0.750 on every sampled tile); reel/story 9:16 1080×1920 |
| Caption/hashtag/audio/CTA | 1–6 words lowercase no terminal period; one question caption/week; **0 hashtags on stills and carousels, 3–5 niche tags on reels only**; alt text on every still; location tag every feed post; licensed track for RT-1/2/3/6, original audio for RT-4/5; funnel is bio + highlights, at most one caption CTA/week |
| Explicitly not adopted | the marketing carousel archetype (Hook → N value → CTA, 7 slides) — no cohort account does it; the 7–10-slide "optimal" figure, contradicted by our own 2–5 measurement |
| Runner | `content/plan_week.py` → a week plan enumerating cells to generate per template slot; feeds S5 |
| Human gate | week-plan approval before generation spend |
| Tests | template schema validation; mix arithmetic; per-surface aspect derivation |

### S8 — Post and measure

| | |
|---|---|
| Route | **Instagram API with Instagram Login**, one Meta app, one OAuth grant + account record per creator, Graph API as the sole unattended executor (r19 §1). No Facebook Page required on this route |
| Publish | image / Reel / mixed carousel (≤10 children); create the container close to schedule time; poll video status; publish idempotently on an `idempotency_key` |
| Disclosure invariant | `is_ai_generated: true` at **container creation** — carousel **parent only**, children excluded; cannot be added or removed after publishing. `persona.disclosure.is_ai_generated` makes it a property of the persona, not a per-call decision. Publisher **fails closed** if absent. Plus the account-level "AI-generated profile" label and a bio line before post 1 |
| Quota | query `GET /content_publishing_limit` per account per run; never hard-code a shared allowance (100 API posts / rolling 24 h, carousel counts once) |
| API-supported, therefore built | Collab posts (`collaborators`, Reels only) and **Trial Reels** (`trial_params`, `graduation_strategy`) — r19's claim-check corrected these from "not established" to documented. r15 §5b names Trial Reels the single biggest reach lever, so the poster supports `trial_params` from day one |
| Browser residual (narrowed) | only **library/trending audio and Story stickers/interactivity** remain genuinely unsupported. A standard Playwright persistent context per account, launched **only** for a queued operator-approved native task, stops on any challenge, and never performs engagement, account creation, verification, follows or DMs. Headless is not a guarantee Instagram accepts automated browsing; it is not a stealth layer |
| Never | anti-detect browsers, fingerprint spoofing, proxy rotation, `instagrapi`, automated likes/follows/bulk comments, cold DMs, device/IP churn. The 10sorlabs SOPs' evasion spine (device resets, disposable SMS, hotspot IP rotation, delete-and-recreate-on-shadowban) is **rejected**; what survives is the 7-day warm-up, the no-link-until-day-7 rule, the intra-day posting order, feed→Story reposting, Highlights structure, Trial Reels, and the constant hashtag set |
| Warm-up | r18 §4's days 1–14 schedule, explicitly labelled a conservative operating choice, not a platform rule — Instagram publishes no warm-up schedule and no daily action limits (r18 C15) |
| Metrics | nightly at +24 h, +48 h, +7 d. Field set per r18 §6. **`impressions`, `plays`, `video_views`, `clips_replays_count`, `ig_reels_aggregated_all_plays_count` are dead — `views` is the successor.** Never grade a post before +48 h (data lags) |
| Attribution | one first-party short link per door with UTMs; click series from the shortener API; the persona/media-id/batch join stays in figment. `profile_links_taps` is a denominator only (no destination detail). Instagram's in-app browser drops `Referer`, so UTMs are the only reliable mechanism |
| Human gate | operator approves the batch **and** holds the T3 publish approval token per `governance/risk-tiers.md` (T3 → dashboard/WebAuthn channel only) |
| Tests | publisher dry-run against recorded fixtures (never live); disclosure-invariant test; quota-exhaustion test; idempotency replay test; carousel-parent-flag test |
| Review | **mandatory adversarial review** — this is the posting unit |

### S9 — Optimise

| | |
|---|---|
| KPIs | sends/reach, saves/reach, follows/reach, watch-through, skip rate, non-follower reach share (the AI-label / recommendation-eligibility canary), profile→link rate, AI-suspicion rate (classified from the raw comment stream — sentiment is not an API field) |
| What it adjusts, in order | (1) the weekly mix, by format sends-per-reach and follows-per-reach; (2) template ranking, retiring the bottom template monthly; (3) posting windows from the account's own reach-by-hour; (4) reel length band from watch-through; (5) slot-1 selection policy |
| Rule | the optimiser **proposes** a diff to `content/taxonomy.yaml` and the template ranking; the operator approves it at the weekly gate. It never edits the live mix unattended |
| Cold start | published best-time windows are a seed only; from day 14 the account's own Insights govern. Cohort like-counts are hidden on 13 of 15 accounts, so no external performance data is load-bearing |
| Tests | KPI formulas over fixture warehouses; proposal determinism; refusal to grade a post younger than 48 h |

### SV — Voice (spec level this arc)

Chain: persona voice brief (fictional adult, language/accent, warmth, pace, breath restraint, explicit
prohibition on real-person resemblance) → 20 **synthetic** candidates by a non-cloning route → ear-gate
3 → 10–20 s clean mono reference with exact transcript → clone into **CosyVoice 3 0.5B** (Apache-2.0
code; weight card verified separately) and **Chatterbox** (MIT) → blind ABX against 20 matched,
consented, CC-licensed adult phone clips, ≥5 raters, UTMOS/NISQA + WER as triage only → **LatentSync
1.6** (Apache-2.0, 18 GB) lip-sync onto an already-approved clip → re-run identity/flicker QA.
Persist `voice_id`, reference SHA, model SHA, seed, language, transcript, WAV, word timings, QA scores.
Rejected for revenue use: F5-TTS (CC-BY-NC weights), Fish Speech (research licence). IndexTTS is an
audition arm only — conditional licence **and** unconfirmed Cantonese. FYT's voice contract transfers:
dry-run before spend, punctuation-first cadence, breath padding only to a *measured* shortfall, word
onsets preserved for captions/cuts; FYT's paid ElevenLabs route does not transfer.
Never clone a real person's voice.

### SX — Explicit-tier machine (built on clothed data, run by the operator)

| Component | Built by agents | Boundary |
|---|---|---|
| Template grammar | yes — slots, ordering, variable types | ships with an **empty** vocabulary; the operator authors slot values |
| Taxonomy engine | yes | clothed fixtures only |
| Local-model adapter interface | yes — a stable call contract for an operator-run local model | agents never invoke it against explicit content |
| QA scorers (identity, register, compliance classifier, age gate) | yes, calibrated on clothed data | the age gate is the hard one: an ambiguous face is unrecoverable here (GUARDRAIL 2) |
| Poster / scheduler | yes | separate accounts, separate app, separate store |
| Generation and judgment | **no** | operator hardware, operator eye, or a local model against the operator's rubric |

## 4. Research streams as cadences

`orgs/figment/HEARTBEAT.md`, all `risk-tier: T1`, all read-only, evidence dated, agent
`figment-researcher` (`figment-analyst` for the insights rows). Every cadence's goal is decidable —
it either produced its named artefact row or it recorded "evidence unavailable".

| Cadence | Schedule | Decidable goal | Evidence rule |
|---|---|---|---|
| `figment-cohort-scan` | weekly | append a dated row per reference account: grid mix, cadence, format facts — or "evidence unavailable" | operator's signed-in Chrome, own tab, first grid page only, no login/interaction/download; never open a Story highlight (leaves a seen-receipt) |
| `figment-platform-trends` | weekly | append dated rows for audios, formats, policy changes; flag any change to the AI-label enforcement state | public web sources only; Explore/Reels tab is **not** browsed (it trains the operator's recommendation profile) |
| `figment-tooling-watch` | fortnightly | re-verify every pinned dependency's licence and pin; file a card on any drift | a claim without a primary source and a date is not recorded |
| `figment-fanvue-economics` | monthly | append public pricing/cadence/funnel observations | public and read-only; free follows allowed, **zero spend**, no payment method, no messaging |
| `figment-insights-pull` | daily | one warehouse file per account per day, with API version and fetch time | raw response persisted; no post graded before +48 h |
| `figment-token-health` | daily | every account record's `token_health` is fresh, or that account is paused with an operator task filed | never reads or writes a token; health state only |
| `figment-optimise` | weekly | one proposal diff, or a no-change report | proposes only; the operator's gate applies it |

## 5. Dashboard — decision

**Decision: a figment surface inside the kb dashboard.** Trade-off, in full:

1. figment needs agents, cards, ledgers, approvals and a WebAuthn T3 channel — all of which exist
   only in the kb dashboard; a standalone app would reimplement every one of them.
2. The T3 publish approval token is *defined* as the dashboard/WebAuthn channel (`risk-tiers.md`);
   a standalone app could not mint a valid one.
3. The kb dashboard's five surfaces (Home, Workflows, Agents, Tasks, Inbox) already carry run state,
   live streams and two-way operator messaging that figment's gates need.
4. Cost of the standalone: a second auth story, a second deploy, a second naming layer, a second
   inbox — against a project whose MANDATE explicitly forbids speculative abstractions.
5. Cost of the surface: figment's studio views (image boards, curation sheets, calendars) are more
   visual than anything the dashboard renders today, so the surface is real UI work, not a tab.
6. Verdict: **one new project-scoped `Studio` destination**, with figment's stage graph expressed as
   ordinary workflows and its gates as ordinary Inbox items. Nothing bypasses the platform.

### Views

| View | Shows | Writes |
|---|---|---|
| Studio → Creators | one row per persona: identity status, LoRA checkpoint, register lock, live batches, this week's plan, per-account health | none (read projection of `persona.yaml` + `accounts.yaml`) |
| Studio → Generate | edit a batch manifest's inputs (prompt variables, cell grammar, chain toggles), dry-run preview at zero cost, launch as a workflow | files a stage card |
| Studio → QA board | the blinded contact sheet with per-cell scores, three-state badge, parked reasons; approve/park per cell | rulings file → `qa_stamp.py` (the only stamp writer) |
| Studio → Calendar | the week plan per account: unit, template, slot cells, scheduled time, disclosure flag | schedules an approved batch |
| Studio → Accounts | per account: token health, quota seen, paused reason, disclosure label state, publish audit | operator actions only |
| Studio → Analytics | per account and per template: the 8 KPIs, non-follower reach share, link funnel, AI-suspicion rate; the optimiser's pending proposal | none (proposal approval is an Inbox gate) |

Existing surfaces absorb the rest: gates are Inbox items deep-linked to the run; the stage graph is a
Workflow; figment's agents appear in Agents; cost rows land in the same ledgers.

## 6. Agents, workflows, cards

| Agent | Role | Runtime/model (per `model-routing.yaml`) | Owns | Never |
|---|---|---|---|---|
| `figment-runner` | manage | claude / opus | launch, sequencing, gate spine, work-order withholding, targeted repairs | craft, review verdicts, spend decisions, publishing |
| `figment-checker` | inspect | claude / opus, fresh context | **every** review verdict: identity gate, register proof, pass A/B, video gates, compliance, and the `qa_stamp.py` write | authoring anything it grades |
| `figment-researcher` | work T2 | claude / sonnet | the six research cadences, claim-checks | acting on findings |
| `figment-poster` | work **T3** | claude / opus | container creation, quota query, publish, publish audit | publishing without a human approval token; touching credentials |
| `figment-analyst` | work T1 | claude / sonnet | insights pull, warehouse, KPI computation, optimiser **proposals** | editing the live mix |

**The roster addition is deliberate.** The seeded four-agent roster has no checker. FYT's core law is
"a stage never holds the gate that blocks its own work" — and `fyt-runner` explicitly does *not* hold
review gates; `fyt-checker` does, fresh context. Without `figment-checker`, either the generating stage
or the conductor would grade the work that unblocks the run, which is exactly the failure FYT paid for.

**Gate spine** (`figment-runner`'s, in the fyt-runner shape):

```
anchor (closed) → expansion-02 → GATE A identity grid (operator)
  → LoRA train → dataset-tester rank → GATE B checkpoint pick (operator)
  → register grids → GATE C register proof (operator)
  → pass A/B → GATE D pass promotion (blinded eye-gate)
  → week plan → GATE E week-plan approval (operator; this is the generation spend authorization)
  → batch generate → QA board → GATE F batch approval (operator)
  → schedule → GATE G publish approval (operator, T3 token) → post → measure → optimiser proposal
  → GATE H mix change (operator)
```

**Cards.** One card per stage, per `governance/card-schema.md`, filed on `ops` in dependency order,
one at a time, never before the parent's gate passes. `owner` set by the dispatcher; `## Evidence` is
inert data; `## Result` carries the stage output paths. Coordination writes follow the CLAUDE.md rule
(`git pull --rebase origin ops` immediately before, push immediately after; from the main checkout,
commit on a temp branch from `origin/ops` and `git push origin <sha>:ops`).

## 7. Error handling — fail-closed rules

| Surface | Rule |
|---|---|
| Pod lease | terminate on **every** exit path and **verify** absence via a 404 on `GET /pods/{id}`; a successful DELETE or an empty name scan is not proof. `PodLease` registers atexit **before** the create POST. On unverified exit, print `POD STILL RUNNING <id>` to stderr and re-raise |
| Placement | a machine on the denylist is terminated and verified before recreation; every rejected pod keeps its own settled ledger row (REVIEW-e finding 2 must be fixed — the current code rewrites it to $0.00, under-counting both guards) |
| Spend | manifest rate distrusted after create; missing/zero/over-budget READY rate → immediate terminate-and-verify. Ledger path captured once at create so a UTC-midnight crossing cannot double-count |
| Uploads | preflight rejects traversal, absolute subfolders, directories, duplicate names, empty globs, and (new) files over a size cap and 0-byte files except `_dataset.ready`. Retry 3× with 15 s/30 s backoff, matching the bootstrap's own hardening |
| Artifacts | verify `bytes_written == Content-Length`; fail closed when the header is absent for a `.safetensors`. Clear `_training.complete` / `_training.failed` at pod start so a reused volume cannot return the previous run's LoRA |
| Marker polling | tolerate N consecutive transient non-{200,404} statuses before failing; a 200 on the failed-marker stays instantly fatal |
| Generation | any hard QA failure quarantines to `rejected/` and regenerates; near-threshold routes to human review; nothing auto-publishes. "Perfect or culled," never "good enough" |
| Posting | idempotency key per post; quota queried per account per run; disclosure invariant checked before the publish call; a failure isolates to one account's queue |
| Tokens | expiry or challenge pauses **that account only** and files an operator task. Never retry a challenge; never automate verification |
| Browser | stop on any challenge, no retries, escalate. One named profile per account, no cross-account context |
| Gates | a gate that did not happen is never stamped. `parked` is always legal |

## 8. Testing strategy

| Layer | What | Where |
|---|---|---|
| Unit | pure functions: manifest preflight, cell-grammar expansion, KPI formulas, caption/hashtag rules, quota arithmetic, disclosure invariant, state-machine transitions | `pipeline/*/tests/` |
| Regression | the 21 REVIEW-e findings, each with the named test from its row | `pipeline/pod/tests/` |
| Dry run | `runpod_run.py --dry-run` (full local flow, no network, no billable compute) before every live pod; publisher dry-run against recorded fixtures, never against a live account | per stage |
| Live proof | one bounded run per stage with `--max-usd`, `--max-minutes`, and post-run ledger reconciliation against `run.json` | §9 |
| Visual QA | mandatory on every generated image (GUARDRAIL 4); blinded board for every promotion decision | `blind_pool.py` + `build_grading_board.py` |
| Adversarial review | different model/session, before live, for every spend-controlling, identity-scoring or posting unit; research claim-checked | `pipeline/<stage>/REVIEW-*.md` |
| Baseline hygiene | pytest basetemp must resolve outside the working tree — the documented command currently reads 38 passed / 81 errors purely from an ACL-locked in-repo `pytest-of-danie/` (REVIEW-e finding 1). A red baseline is what gets waved through before a spend run; fix it before anything else |

## 9. Build order

Each phase is one plan task. **GATE-INDEPENDENT** phases need no operator decision and may run in
parallel (MANDATE §parallelise). **GATE-BLOCKED** phases wait on a named gate.

| # | Phase | Gate status | Tonight? | Planned ceiling |
|---|---|---|---|---|
| P0 | Harness baseline + expansion-blast-radius fixes: findings 1, 2, 6, 11, 13, 15, 16, 17, 19 + the finding-5 preflight arithmetic; green suite outside the tree | GATE-INDEPENDENT | **yes** | $0 |
| P1 | `persona.yaml` schema + creator-001 record + batch/cell/score record writers + state machine + gitignore extension | GATE-INDEPENDENT | **yes** | $0 |
| P2 | `expand/build_expansion_set.py` + expansion-02 manifests (4 runs × 18 cells, `job_timeout_seconds: 120`, ruled reference set `g01/g02/g07`, `_uploads/` created, network volume) + adversarial review + dry-run | GATE-INDEPENDENT | **yes** | $0 |
| P3 | expansion-02 live runs → score → blind board → **GATE A** | GATE-INDEPENDENT to run, then STOPS | **yes, ends at the gate** | $3.60 |
| P4 | Stage-5 pass-chain manifests, scorer runner, licence-pinned node list; stage-7 taxonomy + CT/RT templates as data; publisher + insights schemas and dry-run fixtures; agent declarations; `HEARTBEAT.md` cadences; org files | GATE-INDEPENDENT | **yes, in parallel** | $0 |
| P5 | Training-path harness fixes (findings 3, 4, 5, 7, 9, 10, 12, 14) + `TRAINING_MAX_MINUTES` + dataset tester + adversarial re-review flipping REVIEW-e's training verdict to YES | GATE-INDEPENDENT | no | $0 |
| P6 | S2b swimwear batch → GATE A2 | GATE-BLOCKED (GATE A) | no | $0.60 |
| P7 | LoRA train + checkpoint rank → **GATE B** | GATE-BLOCKED (GATE A, P5) | no | $2.80 |
| P8 | Register grids → **GATE C** | GATE-BLOCKED (GATE B) | no | $0.80 |
| P9 | Pass A/B 12 cells → **GATE D** | GATE-BLOCKED (GATE C) | no | $1.10 |
| P10 | Video V1 + V2 proofs → eye-gate | GATE-BLOCKED (GATE D) | no | $0.70 |
| P11 | Test 0: operator-provisioned IG account, Meta app, OAuth grant; prove container + AI label + quota + publish + one insights snapshot | GATE-BLOCKED (operator provisioning) | no | $0 |
| P12 | Week plan → batch generate → QA board → **GATE F** → schedule → **GATE G** → post → measure | GATE-BLOCKED (GATE D, P11) | no | $2.00 |
| P13 | Optimiser + weekly cadence → **GATE H** | GATE-BLOCKED (P12, +7 d data) | no | $0 |
| P14 | Voice: brief, synthetic candidates, clone A/B, ABX | GATE-BLOCKED (operator language ruling) | no | $0.60 |
| P15 | Explicit-tier machine on clothed fixtures | GATE-BLOCKED (operator hardware) | no | $0 |

**Planned arc ceiling ≈ $12.20 against the $50 cap** (expected spend roughly half that, since ceilings
budget the full `max_minutes` and runs finish sooner), leaving wide headroom for re-runs. Tonight's
spend is capped at $3.60 (P3 only). Every run passes `--max-usd`, and the arc guard sums
`ledgers/cost/figment-*.tsv` before every create.

## 10. Open questions for the operator

Only the ones research cannot settle.

| # | Question | Blocks |
|---|---|---|
| 1 | Persona name, handle, home city, the bio disclosure line, and the link-in-bio door | S7 templates, S8 profile setup |
| 2 | Which Instagram professional account is Test 0, and when | P11, and therefore all of S8/S9 |
| 3 | Raise `governance/budget.yaml` `daily_usd_limit` (currently 10.00) for run days, or split expansion and training across days? | P3, P7 |
| 4 | Training wall clock: approve `TRAINING_MAX_MINUTES: 180` for the training path only, or require checkpoint-resume across 60-minute pods? | P5, P7 |
| 5 | Register: settings-only for v1, or spend 180–300 pod-minutes on a separate register LoRA (r12 §10 rank 6)? | P8 |
| 6 | Do swimwear/lingerie cells enter LoRA v1, or v2 after the clothed identity test passes (this spec's recommendation)? | P6, P7 |
| 7 | Explicit tier: which owned GPU, and when | P15 |
| 8 | Voice language and accent for creator-001 — CosyVoice 3 ranks first partly for Cantonese coverage; for English-only, Chatterbox may win the ABX | P14 |
| 9 | Fanvue written confirmation (still open in MANDATE §What exists today) | the paid-tier arc |
| 10 | Is the `Studio` destination acceptable as new dashboard UI work, or should the first version reuse Workflows + Inbox with no new surface? | the dashboard build phase |

## 11. Deviations from the seeded decisions

| Seeded | Ruling | Reason |
|---|---|---|
| Every stage is a pod-harness manifest | **Modified** — GPU stages only; stages 7–9 reuse the loader, not the pod-lease schema | a posting job has no GPU, readiness or teardown semantics |
| `generated → scored → curated\|rejected → approved → …` | **Modified** — `quarantined` split from `culled` | GUARDRAIL 4 requires quarantine-and-regenerate; curation surplus is not a failure |
| Swimwear/lingerie inside expansion-02 | **Modified** — own batch S2b, own gate, out of LoRA v1 | three recurrences of silent clothing-render failure; keeps LoRA v1 to one variable |
| Checkpoints every 250 steps | **Adopted, with the template corrected** — `max_steps 2000`, `save_every_n_steps 250` | the committed template says 200/1600; the package infers ≈2 750–3 000 at a 250 cadence |
| Single-word/trigger caption doctrine | **Modified** — `<trigger> woman` | r15 §4's finding is class-token-only with *no* trigger, on a different trainer; diffusion-pipe inference needs a handle |
| Stage-5 "skin enhancer = DetailBoost-style sampler option" | **Modified** — Detail Daemon (MIT) is the default; RES4LYF DetailBoost is a licence-gated hold | r15 identifies DetailBoost as the package's enhancer but does not licence-check RES4LYF; r16 does not cover it |
| Stage-5 "conditional face repair" | **Specified** — native klein 4B Base `ReferenceLatent` edit, not FaceDetailer | Impact Subpack is AGPL-3.0 and the only FLUX.2 evidence targets klein 9B |
| Browser residual for the native gap | **Narrowed** — library/trending audio and Story stickers only | r19's claim-check: Collab posts and Trial Reels are API-supported (`collaborators`, `trial_params`) |
| Agents: runner, researcher, poster, analyst | **Extended** — `figment-checker` added | FYT's core law: a stage never holds the gate that blocks its own work, and neither does its dispatcher |
| Pod cost ceiling stated per stage | **Adopted, plus two hard findings** — expansion-02 must split across 4 pods of 18 cells to fit the 60-minute cap; a real LoRA run cannot fit it at all | REVIEW-e finding 5 arithmetic against `DEFAULT_MAX_MINUTES` |
| Everything else | **Adopted** | — |
