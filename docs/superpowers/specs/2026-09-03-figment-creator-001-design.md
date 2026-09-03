# figment creator-001 — end-to-end design (stages 1–9, voice, explicit-tier machine, dashboard)

**v2, 2026-09-03** — folds all 26 findings of `REVIEW-2026-09-03-creator-001-design.md` under the operator rulings of the same date, and reconciles S2/S3/S5/S6 with `research/r15b-training.md` and `research/r15b-generation.md`. v1's verdict was REJECT; §11 lists what moved.

Written 2026-09-03 on branch `claude/figment`. Derives from `orgs/figment/MANDATE.md`; binds under `orgs/figment/pipeline/GUARDRAILS.md`; obeys `CLAUDE.md` (branches, cards, memory), `governance/risk-tiers.md`, `governance/card-schema.md`, `governance/model-routing.yaml`.

Creator 001 is both the first influencer and the pipeline proof (FYT's first-channel pattern): research → infrastructure → tests/reviews → her expansion and LoRA **through** the finished pipeline, never ahead of it (identity-spec §Ordering).

## 0. Evidence base and its claim-check status

Every file this spec rests on. **claim-checked** = a second pass verified each load-bearing claim against a primary source. **pending** = the report exists and carries its own evidence-honesty section, but has not had that second pass.

| Source | Claim-check | Used for |
|---|---|---|
| `research/r10`–`r13` | checked | prior art, reference-cohort and operator-site audits |
| `research/r11` §1 §7, `r12` §1 §10 | checked | base-model arms, klein-native reference path, ranked test plan, per-arm BOM |
| `research/r14`, `r15` | checked | 10sorlabs module map; workflow settings, dataset-tester, SOP rules, compliance rejections |
| `research/r15b-training.md` | **pending** | modules 11/10/05/04 recovered settings: rank↔LR pairing, 250-step cadence, 12 checkpoints, Qwen3-VL caption doctrine, 2-photo→~30-image fan-out at denoise 0.23 |
| `research/r15b-generation.md` | **pending** | modules 09/06/03/02 recovered settings: FaceDetailer band 0.15–0.35, two-pass refine at 0.35, persona-LoRA strength band 0.65–0.80, turbo-recipe warning |
| `research/r15b-edit-motion.md` | **ABSENT — in flight** | modules 07/08/14 (editing, motion control). S6's motion block and S5's edit-pass row are marked *pending r15b-edit-motion* |
| `research/10sorlabs-package/<module>/transcript.txt` | 2 of 9 produced (`10_dataset_generator_v2`, `11_lora_training_krea`) | faster-whisper transcripts of modules 02/04/05/06/07/08/09/10/11; a follow-up claim-check folds them and may amend the rows marked *r15b* |
| `research/r16` | checked | stage-5 pass chain, QA scorer shortlist, licence verdicts |
| `research/r17` | checked | stage-6 video chain, video gates, reel manifest schema, voice chain |
| `research/r18` | checked | content taxonomy, carousel/reel templates, cadence, KPIs, Graph API fields |
| `research/r19` | checked | API-first N-account operating model, provisioning, capability matrix, risk register |
| `pipeline/pod/README.md`, `runpod_run.py`, `REVIEW-e-2026-09-03.md` | code + review | manifest schema, spend guards, exit-path guarantee, 21 open defects |
| `personas/creator-001/batches/composite-0{1,2,3}/*/run.json` | checked | measured (not estimated) per-cell and first-job timing on a 4090, the source of S2's pod-shard sizing |
| `pipeline/train/*`, `pipeline/calibrate/`, `pipeline/qa_stamp.py`, `pipeline/reuse-from-fyt.md` | code | training scaffolding, identity scoring, grid driver, review stamp, FYT reuse map |
| `agents/fyt-runner.md`, `agents/fyt-checker.md`, FYT `.claude/skills/README.md` | code | gates-first conductor shape, single-writer rule, three-state stamp, spend law |
| `docs/superpowers/specs/2026-08-04-dashboard-ux-overhaul-design.md` | spec | the five kb dashboard surfaces this spec extends |

**The research gate (finding 1).** MANDATE §Operating principles requires the package pass — module 11 training and module 10 dataset generation especially — folded into this spec **before any expansion or LoRA pod runs**. v1 recorded the gap and then wrongly narrowed its blast radius to S3/S6. **That claim is withdrawn**: the gap also reached S2's fan-out doctrine, S3's caption doctrine, S5's face-repair and refine bands, and S6's motion block. Two of the three reports now exist and are folded below (rows marked *r15b*); `r15b-edit-motion.md` does not.

> **P3 (the first live create) is GATE-BLOCKED on all three r15b reports being present,
> claim-checked, and S2/S3/S6 reconciled in this document.** Two of three conditions are met for
> S2/S3/S5; the S6 motion block and the S5 edit-pass row stay *pending r15b-edit-motion*. §11
> records every v2 change made under r15b.

## 1. Goal and success conditions

**Goal.** One reference image of a fictional adult woman becomes a disclosed AI Instagram creator whose content is generated, QA'd, approved, posted, measured and re-mixed by the kb fleet, unattended between operator gates — and the machinery that does it is reusable for creator 002…N from one dashboard.

### 1a. creator-001 (testable)

| # | Success condition | How it is proven |
|---|---|---|
| C1 | An identity set of ≥40 curated cells reads as one woman, with **every one of the 40 angle×distance×light strata represented at least once** | `identity_check.py` anchor cosine ≥ the persona floor on every cell; DINO cohesion reported; the curation invariant refuses `approved` while any stratum is empty; operator eye-gate `verified` on the board with all six rulings axes filled |
| C2 | A persona LoRA holds that identity on held-out prompts it never trained on. **LoRA v1 is a provisional clothed close/half-body proof**; the production Instagram LoRA additionally requires the S2c full-body set | dataset-tester grid (fixed seed/prompt/sampler, LoRA the only variable) + 6 held-out prompts × 2 seeds; operator picks a checkpoint; the two-tier acceptance test in S2c/SX-T |
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
| P2 | Every stage is resumable from disk, not from conversation | kill a stage mid-run; re-enter; state is derived from `run.json`, `batch.json` (with `pod_runs[]`), `scores.json` and `gate.json` alone — no conversational memory, and a gate record whose `subject_sha256` no longer matches is treated as reopened |
| P3 | Every gate has an honest "not yet" | `qa_stamp.py` is the only writer of `review_status`; `expand/batch_state.py` is the only writer of lifecycle `state`; `parked` reachable at every gate and never converted to `verified` |
| P4 | Every spend-controlling, identity-scoring or posting unit has a different-model adversarial review plus tests before it runs live | review file per unit under `pipeline/<stage>/REVIEW-*.md`; test count recorded |
| P5 | N accounts run on one Meta app with per-account grants; a failure on one pauses only that one | fault-injection: expire one account's grant, assert only that account's queue pauses and one operator task is filed |

## 2. Architecture

### 2.1 Components

| Component | Path | Kind | Status |
|---|---|---|---|
| Pod harness (lease, spend, transport, artifacts) | `pipeline/pod/runpod_run.py` | existing, 21 open defects | extend |
| Expansion builder | `pipeline/expand/build_expansion_set.py` | new (generalises `train/build_identity_set.py`) | new |
| Lifecycle reducer (sole writer of cell `state`) | `pipeline/expand/batch_state.py` | new | new |
| Gate records (sole writer of `gate.json`) | `pipeline/gates.py` | new | new |
| Pass-manifest compiler | `pipeline/passes/build_pass_manifest.py` | new | new |
| Identity/register scorer | `pipeline/train/identity_check.py` | existing | extend (register axis) |
| Training scaffolding | `pipeline/train/` (templates, start script, manifest) | existing | correct + test |
| Dataset tester | `pipeline/train/workflows/dataset_tester_api.json` + `rank_checkpoints.py` | new (port of r15 §3g) | new |
| Register lock | `pipeline/register/` (absorbs `pipeline/calibrate/`) | existing driver, parked | revive |
| Stage-5 pass chain | `pipeline/passes/` | new | new |
| Video chain | `pipeline/video/` | new | new |
| Content planner | `pipeline/content/` (taxonomy, templates, `plan_week.py`) | new | new |
| Publisher | `pipeline/publish/` (`post.py`, `accounts.yaml`, `quota.py`) | new | new |
| Insights + optimiser | `pipeline/insights/` (`pull_insights.py`, `warehouse/`, `optimise.py`) | new | new |
| Review surfaces | `pipeline/qa_stamp.py`, `blind_pool.py`, `build_grading_board.py` | existing (FYT port) | **extend** — the FYT rulings schema has only `identity/realism/hands/lighting`; three safety axes are added (§2.4a) |
| Voice | `pipeline/voice/` | spec only this arc | later |
| Explicit-tier machine | `pipeline/explicit/` | grammar + adapters only, clothed fixtures | new |

**Runner rule.** Every stage is `manifest (data) + thin runner (code)`. GPU stages (2, 2b, 3, 4, 5, 6) express their manifest in the **pod harness schema** and are executed by `runpod_run.py`. Non-GPU stages (7, 8, 9) are **not** pod work and do not inherit the pod-lease keys; they use the same dependency-free YAML/JSON loader (`runpod_run.load_document`) over their own schemas. Forcing a posting job into a pod-lease manifest would import GPU, readiness and teardown semantics that have no meaning there.

### 2.2 Data model

`persona.yaml` is the **machine** source of truth — the only file a runner reads. `identity-spec.md` and `look-spec-v2.md` remain the human rationale and are referenced by path + sha from `persona.yaml`, so there is exactly one authority per consumer and drift is detectable.

```yaml
# personas/creator-001/persona.yaml
id: creator-001
disclosure: {is_ai_generated: true, bio_line: <operator-authored>, profile_label: required}
identity:
  references: [anchors/g01.jpg, anchors/g02.jpg, anchors/g07.jpg]   # order = canvas (identity-spec)
  spec: {path: identity-spec.md, sha256: <sha>}
  # every learned threshold is a lifecycle object, never a bare number (finding 24)
  floor:
    anchor_cosine_p5: {status: uncalibrated, value: <provisional>, calibration_set_sha: null, locked_by_gate: null}
    min_face_px:      {status: locked, value: 600, calibration_set_sha: null, locked_by_gate: deterministic}
body_target: {source: identity-spec#body, exemplars: [g02, g07]}
grammar:                       # finding 8 — build_expansion_set.py GENERATES the allocation from this
  angles:    [front, three-quarter-l, three-quarter-r, profile-l, near-back]
  distances: [close, half]
  lights:    [flat-white, window-day, lamp-night, on-camera-flash]
  wardrobe_families: [corset-bustier, cami-chains, oversized-tee, knit-cardigan, going-out-mini]
  allocation: {strata: 40, replicates: 20, replicate_policy: rotate-wardrobe-over-strata, seed_policy: fixed-per-cell}
register:
  spec: {path: ../../pipeline/look-spec-v2.md, sha256: <sha>, section: "0"}
  settings: {makeup: abg-glam-v1, skin: texture-visible, light: [flat-white, window-day, lamp-night, on-camera-flash], wardrobe_families: <grammar.wardrobe_families>}
lora: {persona: null, register: null, trigger: <token>, base: flux2-klein-base-4b, tier: provisional-clothed-v1}
voice: {manifest: null}
accounts: [{platform: instagram, handle: <operator>, account_ref: <opaque>, tier: instagram}]
tiers:
  instagram: {store: batches/, ceiling: swimwear, compute: pod|local}
  explicit:  {store: <operator-local path, never in repo>, compute: operator-hardware-only}
```

**Cell-grammar arithmetic (finding 8).** 5 angles × 2 distances × 4 lights = **40 strata**, one cell each. The remaining **20 cells are named replicates**: `build_expansion_set.py` walks a fixed subset of the 40 strata in a fixed order, rotating the five wardrobe families, and emits 20 replicate rows with fixed per-cell seeds. 40 + 20 = 60, sharded 10/10/10/10/10/10 across **6 ephemeral pods** (§S2 Run shape — sizing is measured, not estimated). The allocation is generated, never hand-typed, and the emitted table is committed beside the manifests so a re-run is byte-reproducible. Wardrobe families for expansion-02 are **clothed only** (corset/bustier top, cami + layered chains, oversized tee, knit cardigan, going-out mini dress) — swimwear is S2b's batch, not this one.

| Record | File | Key fields | Written by |
|---|---|---|---|
| persona | `personas/<id>/persona.yaml` | above | operator + `figment-runner` (never a generating stage) |
| batch | `personas/<id>/batches/<batch-id>/batch.json` | `batch_id`, `stage`, `pod_runs[]`, `cells[]`, `cost_usd` (derived = Σ `pod_runs[].cost_usd`) | the stage runner |
| **pod run** (finding 9) | `batch.json → pod_runs[]` | `shard_id`, `manifest_sha`, `run_json_path`, `ledger_key`, `cell_ids[]`, `status`, `cost_usd` — one row per shard, never overwritten | the stage runner, append-only |
| cell | inside `batch.json` | `cell_id`, `tag` (angle×distance×light×wardrobe), `stratum_id`, `is_replicate`, `seed`, `prompt_sha`, `path`, `state`, `review_status`, `parked_reasons[]` | `expand/batch_state.py` alone writes `state`; `qa_stamp.py` alone writes `review_status` + `parked_reasons` |
| score | `.../scores.json` | `cell_id`, `anchor_cosine`, `dino_cohesion`, `face_px`, `laplacian`, `local_variance`, `clipped_frac`, `ocr_text`, `garment_class`, `face_detected` | scorer runner (raw values only — no routing) |
| **gate** (finding 7) | `.../gate.json`, one per gate id | `gate_id`, `subject_path`, `subject_sha256`, `decision: verified\|parked`, `decided_by`, `decided_at`, `approval_token_ref?`, `reasons[]` | `pipeline/gates.py`, atomic write before the run stops |
| account | `pipeline/publish/accounts.yaml` | `account_ref`, `platform`, `login_route`, `scopes[]`, `token_health`, `quota_seen_at`, `paused_reason`, **`profile_ai_label_status`, `profile_ai_label_verified_at`, `bio_disclosure_sha256`, `bio_disclosure_verified_at`, `readiness_record`** — **no secret material** | operator (creation, disclosure and readiness fields) + `figment-poster` (health and quota only) |
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

Tracked: manifests, `batch.json`, `scores.json`, `run.json`, review rulings, code, docs. Gitignored bulk (append to root `.gitignore` beside the existing figment rules): `personas/*/anchors/`, `personas/*/batches/*/images/`, `personas/*/batches/*/rejected/`, `pipeline/*/runs/*/out/`, `*/board.html`.

Anchor bulk currently sits at `personas/anchors/gemini-batch-01/` (identity-spec) and is staged for pod upload under `pipeline/train/runs/_uploads/` (the path the existing gitignore rule covers is `pipeline/train/runs/anchors/`). P1 moves it to `personas/creator-001/anchors/`, updates the gitignore rule, and makes `persona.yaml` the single place any runner resolves a reference path from — the current three-location spread is how the `g04` vs `g01` reference-set drift (REVIEW-e condition 3) survived to a committed manifest.

### 2.4 Cell lifecycle — two orthogonal axes, one writer each (findings 6, 7)

v1 conflated the lifecycle `state` with the FYT three-state review stamp, mapped the honest "not yet" (`parked`) into terminal `quarantined`, and named no writer. Corrected:

**Axis 1 — lifecycle `state`.** Sole writer: `pipeline/expand/batch_state.py`, a pure deterministic reducer `(current_state, scores_row, rulings_row) → next_state`. It is a function of files on disk, never of a conversation, so a resumed run recomputes the same answer.

**Axis 2 — `review_status` ∈ {`unreviewed`, `verified`, `parked`}.** Sole writer: `qa_stamp.py`, from an operator rulings file. **`parked` never changes `state`** — it records reasons and leaves the cell where it is, which is exactly what makes "not yet" honest.

| From | Trigger (all machine-decidable) | To | Writer |
|---|---|---|---|
| `generated` | scorer emitted a row for the cell | `scored` | reducer |
| `scored` | `face_detected == false` (deterministic no-face) | `quarantined` (moved to `rejected/`) | reducer |
| `scored` | rulings `adult_read != pass` **or** `garment_integrity != pass` **or** `real_person_resemblance == flag` | `quarantined` | reducer |
| `scored` | `review_status == verified` **and** selected by the curation invariant | `curated` | reducer |
| `scored` | `review_status == verified` **and** surplus to the invariant | `culled` (re-curatable, never shipped) | reducer |
| `curated` | gate record `GATE-A.decision == verified` and `subject_sha256` matches | `approved` | reducer, on `gate.json` |
| `culled` | a later curation pass needs its stratum | `curated` | reducer |
| `approved` | scheduler claimed it | `scheduled` → `posted` → `measured` | stage runner |
| **illegal** | `parked` → any `state` change; `quarantined` → anything (terminal); `scored` → `approved` without a matching gate record; any `state` write by a generating stage | — | rejected by the reducer, with a test per edge |

`quarantined` stays separate from `culled`: GUARDRAIL 4 requires quarantine-and-regenerate for render failures, while curation surplus is merely unused, and collapsing them loses the failure signal. Exactly one writer owns each axis; a stage never writes a transition its own output is judged by.

### 2.4a Review rulings schema — three safety axes are required (finding 4)

The FYT rulings schema carries `identity`, `realism`, `hands`, `lighting` only. That cannot persist the verdicts GUARDRAILS 1, 2 and 4 demand, so three axes are added and made **required**:

| Axis | Values | Effect |
|---|---|---|
| `adult_read` | `pass` \| `ambiguous` \| `fail` | anything but `pass` ⇒ **quarantine** |
| `garment_integrity` | `pass` \| `fail` | anything but `pass` ⇒ **quarantine** |
| `real_person_resemblance` | `clear` \| `flag` | `flag` ⇒ **quarantine** |

A NudeNet or garment-classifier score is triage input only (r16 §2) and never substitutes for the visual verdict. `build_grading_board.py` displays all seven axes per cell; `qa_stamp.py` **rejects a rulings file with a missing, misspelled or out-of-enum safety axis** rather than defaulting it. Tests prove that a malformed or omitted safety ruling fails closed. The schema change lands in **P1** and is independently reviewed in **P2R** before any live create.

### 2.5 Credential boundary

Ambient environment only, never objects (GUARDRAIL 5). `RUNPOD_API_KEY` is read once into the REST session header and never reaches the pod, `run.json`, logs or the proxy (verified in REVIEW-e §Checked and found sound). Meta tokens live in the controlled runtime; `accounts.yaml` stores an opaque `account_ref` and a health state, never a token, cookie or refresh secret. Playwright profile directories live outside the repo. No agent opens a credential store, and no agent creates, verifies or warms an account — those are operator gates (r19 §3).

### 2.6 Tier separation

| | Instagram tier | Explicit tier |
|---|---|---|
| Compute | RunPod pods **or** operator hardware | operator hardware only |
| Who generates | agents | the operator, by hand |
| Who authors prompts | agents (clothed vocabulary) | the operator (agents ship an **empty** vocabulary) |
| Who judges | `figment-checker` + operator | operator, or a local model against the operator's rubric |
| Store | `personas/<id>/batches/` (gitignored bulk) | operator-local path, never referenced by a repo file beyond a name |
| Accounts | `accounts.yaml`, tier `instagram` | separate records, separate app, never in this file |

Agents build, test and review the explicit machine **on clothed fixtures**. The wardrobe ceiling for anything an agent generates is swimwear/lingerie (Instagram tier); anything unclothed is out of bounds even as a prompt string. r15 §3f records that module 10's clothing-removal branch exists; it is not ported.

### 2.7 Spend controls (layered, all fail-closed)

0. **An approved T2 spend card exists on `ops` before the first create** (finding 2). Every live pod
is T2 under `contract.md`; a gate that arrives after the money is spent is not a gate. §6 gives the exact card payload.
1. `--max-usd` required on every live pod run; the manifest rate is distrusted after create and the
   real `adjustedCostPerHr` is re-checked against it (`pod/README.md` §Spend ceilings).
2. Daily guard: `governance/budget.yaml` `daily_usd_limit: 10.00` vs today's cost ledger. A day
carrying both an expansion run and a training pod breaches it — the operator raises it for the run (MANDATE §Budget) or the runs are split across days.
3. Arc cap: `--arc-cap-usd 50` summing every `ledgers/cost/figment-*.tsv` row; refuses a create that
   would exceed.
4. Wall-clock: `max_minutes` ≤ the hard `DEFAULT_MAX_MINUTES` 60. **See S3 — this ceiling cannot
   contain a real LoRA run and is amended there, for the training path only.**
5. Zero platform spend, always: no boosts, subscriptions, PPV, tips or "free trials" (GUARDRAILS
   §research browsing). r15 §5b's boost ladder is recorded as an operator playbook, never built.
6. **No billed storage outside the pod lease** (finding 3). No `network_volume_id`, no persistent
volume, no object store: every arc guard sums pod-hour ledger rows, and a recurring storage charge the harness neither creates, deletes nor ledgers would make the $50 proof false. If caching later proves necessary it arrives as a separately approved lifecycle (`create/attach/detach/delete/ verify-absent`), accrual rows in the arc ledger, and a finally-path deletion test — not before.

Per-stage ceilings and the planned arc total are in §9.

## 3. Stages

Common to every row: **reuse** = pod harness lease/spend/teardown, `qa_stamp.py`, `blind_pool.py`, `build_grading_board.py`, FYT's single-writer and three-state discipline. **Adversarial review** = a different model/session than the author, before the unit runs live, per MANDATE §Operating principles.

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
| Outputs | 60 generated cells → `batch.json` (6 `pod_runs[]` rows) + `scores.json` + board; curated set of 40 |
| Base | FLUX.2 klein 4B **Base** (Apache-2.0), `Comfy-Org/flux2-klein-4B` diffusion model + `qwen_3_4b` encoder + `flux2-vae` (r11 §7 arm B, sizes confirmed) |
| Cell grammar | 5 angles × 2 distances (close, half-body) × 4 lights = **40 strata, one cell each**, plus **20 named replicates** rotating the five clothed wardrobe families over those strata at fixed seeds = 60. Generated by `build_expansion_set.py` from `persona.grammar` (§2.2), never hand-typed. **Full-body cells are S2c**, never a single full-frame swap (identity-spec §Rule for expansion: face-pixel density governs swap quality) |
| Prompt doctrine | one prompt per cell with an explicit *do-not-alter* identity clause (r15 §3b; corroborated as the package's standing guard by **r15b-training** module 04/10 — an identity-lock clause is appended to every fan-out prompt), face angle stated explicitly, 80–250 words, exclusions inside the positive prompt, braced-alternative template as the generator (r15 §6b) |
| **r15b reconciliation** | module 10 (the *current* dataset path) fans 2 reference photos out to ~30 images by **identity-preserving edit at denoise 0.23**, not fresh generation, over two fixed 15-prompt angle/pose templates. Our expansion is the same shape at wider coverage (3 references, 60 cells) on a different base. Adopted: the low-denoise identity-preserving edit band and the identity-lock clause. **Not adopted:** module 10's FLUX.2-klein-**9B** + Qwen3-8B stack and its `euler/beta`, 4-step, cfg-1 recipe — that is a distilled-turbo signature and must never be copied onto klein 4B **Base** (r15b-generation §What maps) |
| Manifest keys | pod schema: `models[]`, `workflow`, `seed_fields:[noise_seed]`, `uploads[]`, `jobs[]{seed,output_name,expected_images,substitutions[]}`, `job_timeout_seconds`, `readiness_timeout_seconds`, `max_minutes`, `avoid_machine_hosts`. **No `network_volume_id`** |
| **Run shape (load-bearing, measured not estimated)** | expansion-01's shape (24 jobs × `job_timeout_seconds: 900`, readiness 1200, `max_minutes: 30`) **cannot finish** (REVIEW-e finding 5). `composite-01/02/03` `run.json` on a 4090 measure the real cost: a 3-reference klein 4B Base multi-ref cell at 1024×1280/50 steps takes **157–165 s steady state**, and **the first job of a pod takes 215–260 s** (cold model warm-up inside the job, distinct from pod readiness). Under the corrected preflight — `max_minutes×60 ≥ readiness + N×job_timeout + 300 s teardown` — and the hard 60-minute cap: `job_timeout_seconds: 240` (clears the measured first-job band with headroom), `readiness_timeout_seconds: 900`, `max_minutes: 60` → 900 + 10×240 + 300 = **3 600 s = the full 60-minute cap**, so **10 cells is the most one pod can hold**. expansion-02 runs as **6 fresh ephemeral pods × 10 cells = 60 cells** |
| **Cold start, every pod** (finding 3) | all six pods download the three model files cold. **900 s is the budgeted cold-readiness allowance**; if a pod's real readiness exceeds it the harness already fails closed (readiness timeout → terminate-and-verify), which is the intended behaviour, not a regression. The download costs **time inside the lease, not storage money** — that is the whole reason no persistent volume is used |
| QA / scoring | `identity_check.py` (FaceNet anchor cosine, DINO cohesion, **fail-closed on no face**) + crop Laplacian, clipped fraction, garment classifier, OCR gate. **During expansion-02 the scorers emit raw values only** (finding 24): no learned threshold routes a cell. The only automatic quarantine routes are the deterministic no-face check and the three operator-ruled safety axes (§2.4a). Thresholds leave `status: uncalibrated` until 60 labelled outputs lock them and a different-model review approves the scorer |
| Human gate | **GATE A. STOP.** Blind board (`build_grading_board.py --blind` over `blind_pool.py`), operator rulings across all seven axes → `qa_stamp.py` → `gate.json`. Nothing proceeds to S3 without `verified` on ≥40 cells **and** every one of the 40 strata represented |
| Cost | `--max-usd 0.90` per pod; 6 pods; planned ≈ $3.30 at $0.80/h, ceiling $5.40. Approved T2 spend card on `ops` before the first create (§6) |
| Tests | manifest preflight refuses a job budget that cannot fit `max_minutes`; **60 unique cell ids; exactly 10 jobs per shard; all 40 strata covered; replicate seeds fixed and reproducible; the curation invariant refuses approval while any stratum is empty**; every job's substitutions resolve; interruption tests after shards 1, 3 and 5 prove resume launches only the missing shards and never reuses a stale gate record; `--dry-run` produces the full prompt set at zero cost |
| Review | **P2R** — different-model review of `build_expansion_set.py`, the safety-axis schema and every scorer change, at the SHA that will execute, before the first live run |
| New vs reuse | new: expansion builder, grammar table, reducer, gate records, safety axes, board wiring. reuse: harness, scorer core, stamp, board generator |

### S2b — Swimwear/lingerie tier extension (separate batch)

MANDATE §3 puts minimally-clothed body in the LoRA's scope, so this is built — but as its **own batch, its own eye-gate (GATE A2), and excluded from LoRA v1**. Reason: GUARDRAIL 4 records three recurrences of silent clothing-render failure; isolating the highest-risk wardrobe family keeps LoRA v1 to one variable and makes the failure rate measurable. 12–16 cells, same grammar with a swimwear wardrobe family. The garment classifier's `unsafe >= 0.10` is a **triage flag that routes to the board, not an automatic quarantine** — it is an uncalibrated threshold (finding 24); the quarantine authority is `garment_integrity != pass` on the operator's ruling. Folded into LoRA v2 only after v1 passes its held-out test. Cost `--max-usd 0.60`.

### S2c — Full-body second pass (the coverage LoRA v1 does not have)

| | |
|---|---|
| Why | MANDATE §3 scopes the LoRA to "every camera angle and distance … body shape and proportions". S2 and S2b are close/half-body only, so **LoRA v1 is explicitly a provisional clothed close/half-body proof** and is labelled that way in `persona.lora.tier`. A production Instagram LoRA needs this batch |
| Shape | 16–20 full-body cells: the same 5 angles × 4 lights at `distance: full`, clothed wardrobe families only, generated **from an approved LoRA-v1 or S2-curated cell as the reference**, never as a single full-frame identity swap (identity-spec: face-pixel density governs swap quality) |
| Extra QA | face-pixel floor is the binding scorer here — a full-body frame that falls under `min_face_px` is quarantined deterministically, not argued about |
| Human gate | **GATE A3.** Own blind board, own rulings, own `gate.json`. LoRA v2 (production) trains on S2 ∪ S2b ∪ S2c |
| Cost | `--max-usd 0.90`, one pod run |
| Acceptance (two-tier, with SX-T) | the identity holds across **clothed close, clothed half, clothed full** on held-out prompts (this spec's scope), and — on operator hardware only — across the explicit-tier set via SX-T. The two halves are never trained, stored or judged in the same place |

### S3 — Persona LoRA

| | |
|---|---|
| Inputs | 40 curated `approved` cells + captions; `diffusion-pipe-klein4b.toml.template`; `dataset.toml.template` |
| Outputs | checkpoints every 250 steps + final `<trigger>.safetensors`, `adapter.json`, run config copy |
| Trainer | diffusion-pipe on klein 4B **Base** — upstream states the distilled variant will not train well (r11 §7) |
| **Caption doctrine (r15b — v1 was wrong)** | **full-sentence auto-captions, prefixed with the trigger token.** v1 ruled `<trigger> woman` on r15 §4's reading that the package captions class-token-only. r15b-training resolves it: the single-word `woman` caption is **module 04, the package's own documented legacy mistake**; the current module 11 captions the dataset with a local VLM (**Qwen3-VL-8B-Instruct**, float8, max res 512, 128 new tokens) producing full descriptive sentences per image, and r15b lists "do not adopt single-word captioning" among its adoptions. Our doctrine: Qwen3-VL-class auto-caption per image, trigger token prepended (diffusion-pipe inference needs the handle), operator spot-check of 5 captions before the run |
| **Step / checkpoint / rank reconciliation (r15b)** | committed template says `max_steps 1600 / save_every_n_steps 200 / rank 32 / lr 5e-5`. r15b-training reads module 11's live UI: **rank 32, LR 1e-4, AdamW8Bit, batch 1, grad-accum 1, 3000 steps, save every 250, buckets 512/768/1024, "max saves to keep" bumped to 15** → the 12 checkpoints (250…2750 + final) that the ranking harness compares. Module 05's cheap arm pairs **rank 16 with LR 2.5e-4** on a single 512 bucket. Adopt for our run: `max_steps 3000`, `save_every_n_steps 250`, **keep all 12 checkpoints** ("max saves to keep" ≥ 12 is the easy operational miss r15b flags — a lower cap silently discards early checkpoints the ranking harness needs), rank 32 / LR 1e-4 / bs 1, buckets 512/768/1024. These are a different trainer's numbers on a different base, so they are the *starting* recipe and **the dataset-tester remains the arbiter**; the rank-16/LR-2.5e-4 single-bucket arm is the documented cheap fallback if the run does not fit its budget |
| **Wall-clock defect (findings 13, 20)** | 3 000 steps at rank 32, multi-bucket, bs 1 on a 4090 is 50–100 min (module 05 measured 1.20 it/s at rank 16/512 on an A100, so this band is the honest one). Raising `max_minutes` alone is **not** enough: the shipped manifest also polls the completion marker for `job_timeout_seconds: 2700` (45 min) and would kill a healthy run first. The full fix, all four values together: `job_timeout_seconds: 6000`, `readiness_timeout_seconds: 1200`, `max_minutes: 180`, and CLI `--max-minutes 180`, with a preflight that proves `1200 + 6000 + 300 = 7500 ≤ 10800`. `TRAINING_MAX_MINUTES: 180` applies **only** when `training` is present in the manifest; `DEFAULT_MAX_MINUTES` stays 60 for image runs; `--max-usd` is re-derived from the approved READY rate and the arc cap still binds. Nothing silently extends any bound — a breach stops the run. **Corroboration:** the template was edited to `max_minutes: 70` during v1's drafting, but the harness takes the **minimum** of CLI, manifest and `DEFAULT_MAX_MINUTES`, so 70 clamps to 60; the template edit is necessary and not sufficient, the constant must move too. **This is gated on Q4** (§10) plus an approved T2 code card |
| Dataset tester (r15b) | port of module 11's ranking harness: **fixed seed, fixed prompt, fixed sampler, fixed resolution; the LoRA checkpoint is the only free variable.** One ComfyUI graph, **12 parallel** `UNETLoader→LoraLoader→KSampler` branches joined by `BatchImages`, `expected_images` = branch count, one job per held-out prompt. Their own harness pins seed 1595 and one fully-written prompt — the pattern transfers; their `res_2s`/`beta`, 4-step, cfg-1 sampler pairing does **not** (turbo-specific, r15b-generation) |
| Held-out test | 6 prompts × 2 seeds never present in training; identity floor + adult-read + register adherence scored separately (r12 §10) |
| Human gate | **GATE B. STOP.** Operator picks the checkpoint from the ranked grid; the pick is written as a `gate.json` record bound to the checkpoint's sha256 |
| Cost | training `--max-usd 2.40`; tester `--max-usd 0.40` |
| Tests | REVIEW-e's named tests 3, 4, 5, **8**, 7, 9, 10, 12, 14 (all training-path); a `TRAINING_MAX_MINUTES` preflight test; the shell-injection regression for finding 8; and a separately approved **throwaway-pod upload contract test** proving ComfyUI's `/upload/image` accepts `.txt`, `.toml` and `_dataset.ready`, with its run and ledger evidence recorded before the training verdict flips |
| Review | **blocking.** REVIEW-e's verdict is "SAFE TO RUN LIVE for a training pod: **NO**" until findings 3 (truncated artifact accepted), 4 (one proxy blip kills the run), 5 (impossible max_minutes) and 8 (unquoted placeholders interpolated into a root-run shell script) are fixed and re-reviewed by a different model. No training pod runs before that |
| New vs reuse | new: dataset tester + `rank_checkpoints.py`, training-path harness fixes. reuse: templates, start script, upload/artifact transport |

### S4 — Register lock

| | |
|---|---|
| Inputs | picked LoRA checkpoint; `look-spec-v2.md` §0 operator taste anchor; `persona.register.settings` |
| Outputs | `register.yaml` — makeup / skin finish / body / lighting families / wardrobe families as generation settings on top of the LoRA; calibration grid contact sheets |
| Runner | revive `pipeline/calibrate/grid_run.py` (single-axis grids, already tested) under `pipeline/register/` |
| Axes | the existing `axes/{age,body,makeup,posture,prettiness}.yaml` plus a `light` axis; one axis varied per grid, everything else pinned |
| QA | identity floor must hold at every grid point (a register that moves face geometry is rejected — r12 §1.8); register adherence scored by the new axis in `identity_check.py` |
| Human gate | **GATE C. STOP.** register-proof: 12 cells at locked settings, operator `verified` |
| Cost | `--max-usd 0.80` total across 2 grid runs |
| Decision | settings-first. A **separate register style LoRA** (r12 §1.7, rank 6 of §10) is a later, gated option — it costs 180–300 pod-minutes, a large fraction of the $50 arc, and r12 §11 records no published measurement of persona+register LoRA interference |
| Tests | existing `calibrate/tests/test_grid_run.py` extended for the light axis and for identity-floor enforcement |

### S5 — Image generation with passes

Ordered chain (r16 §1), each stage a switchable manifest branch retaining every intermediate:

| Order | Pass | Choice and why |
|---|---|---|
| 0 | Base render | klein 4B Base + persona LoRA + register settings; native graph. **Persona-LoRA strength band 0.65–0.80** (r15b-generation: their persona band is 0.65–0.80, style/detail LoRAs 0.65–1.50, on independent per-LoRA sliders); klein 4B Base is a full-diffusion model, so its own step/cfg values apply — **never** the 4-step/cfg-1 turbo recipe |
| 1 | Conditional face repair *(band corroborated; node choice pending r15b-edit-motion)* | **native klein 4B Base edit template via `ReferenceLatent`**, 0.20–0.35 intervention, only when the face crop is small or the detector flags it. r15b-generation measures the package's FaceDetailer across modules 06/09 at **denoise 0.15–0.35, bbox_threshold 0.40–0.50, sam_threshold 0.80–0.93** — our 0.20–0.35 sits inside that band, which is the corroboration v1 lacked. Impact FaceDetailer stays *not* the default: r16 records the Subpack repo is **AGPL-3.0**, and the only FLUX.2 evidence targets klein **9B**. The editing modules (07/08) are unread — revisit this row when `r15b-edit-motion.md` lands |
| 2 | Identity/register gate | `identity_check.py`; fail closed on no face; log crop and score **before** any upscale |
| 3 | Pixel upscale | Real-ESRGAN x4plus (BSD-3), **2× then downsample** to delivery size. NMKD and 4x-UltraSharp rejected (unverified / CC-BY-NC-SA-4.0, r16 §3) |
| 4 | Refine pass *(r15b, new in v2)* | second low-denoise sampler pass at **denoise 0.35** immediately after the upscale-and-normalize step. r15b-generation records this two-pass structure (base at denoise 1.0 → model upscale → scale-down normalize → refine at 0.15–0.35) as the package's standard shape across modules 06 and 09; v1 had no refine pass at all |
| 5 | Texture add | **Detail Daemon (MIT, pinned `3394e44`)**, one pass, conservative schedule. The 10sorlabs "skin enhancer" is `ClownOptions_DetailBoost_Beta` from RES4LYF (r15 §3f) — same mechanism (a sampler-schedule option over a step window, not a post filter), but RES4LYF's licence is unchecked in r15/r15b and absent from r16. RES4LYF is a **hold**, admissible only after a licence check |
| 6 | Grain / sensor character | ProPost "Film Grain" (MIT, pinned `df6a6d1`), 0.003–0.008 normalised, **last** so the upscaler cannot erase it |
| 7 | QA scorers + route | identity, MagFace quality, Laplacian/clipping/local-variance, OCR gate, garment classifier, human eye gate over all seven rulings axes. Deterministic hard fail or a failed safety axis → quarantine; everything else → review; **never auto-publish** |
| — | De-gloss | separate from the texture pass: conservative Detail Daemon first, deterministic fine grain + local highlight compression second. "Realistic skin" community LoRAs rejected by default (SDXL-targeted or licence-blank). The package's anti-"AI look" negative-prompt shape (reject perfect symmetry, studio-flawless lighting, airbrushed/editorial polish, "overly refined rendering") is the same direction and is **re-written in our own words**, never copied — it is licensed text (r15b-generation) |

| | |
|---|---|
| Promotion rule | a pass is adopted only if the 12-cell A/B (r16 §4: 2 base arms × 2 face-repair × 3 detail chains, same seed/prompt/reference) shows identity above floor, crop texture up without clipping/halo, no QA hard failure, **and** a blinded eye-gate prefers it. Keep a rejected-pass contact sheet as evidence for the does-not-smooth rule |
| **`chain[]` is builder input, not a harness key** (finding 18) | `chain[]` of `{pass, enabled, node_group, params}` lives in the **builder's** input file. `passes/build_pass_manifest.py` compiles each enabled chain into a concrete API workflow plus standard per-job `substitutions`, and emits **only keys the pod README documents**. Nothing invents a harness key: an undocumented `chain[]` sitting in a manifest would be silently ignored by `runpod_run.py`, which would execute the unchanged workflow and produce a false pass-chain proof. Test: every toggle changes the emitted workflow SHA and node set |
| Human gate | **GATE D** — blinded A/B eye-gate before promotion, recorded in `gate.json` against the compiled workflow SHA; batch approval per output batch |
| Cost | `--max-usd 1.10` for the A/B |
| Licence law | every external node enters as a **pinned commit**; every model as `{repo_id, filename, destination_dir}` with a recorded licence. Unpinned `git clone` + `pip install -r requirements.txt` is the eromify-mcp shape at one remove (r15 §2d) and is refused |

### S6 — Video with passes  ·  **motion block pending `r15b-edit-motion.md`**

The three rows marked *pending* below rest on r14/r17's chapter-level reading of modules 07/08/14, not on the module videos themselves. `r15b-edit-motion.md` is the missing third report; **P10 does not run until it lands and is claim-checked**, and this block is re-reconciled at that point.

| | |
|---|---|
| Base | Wan 2.2 **TI2V-5B** on a 4090 for the proof (Apache-2.0, official 24-GB offload path); **Animate-14B** on 48 GB for driver-clip shots; A14B only after 5B establishes the QA path |
| Start-frame doctrine *(pending r15b-edit-motion)* | persona-swap the first frame from the driver, then animate (r14 §08/§14 via r17 §1). Driver requirements: one visible adult, stable light/background, continuous 5–8 s motion, unobscured face/hands, no cuts/whip-pans |
| Gates (all four, in order) | (1) decode frames, record count/fps/seed/workflow/model SHA; (2) per-frame ArcFace anchor cosine — median, minimum, slope, worst-frame thumbnails, thresholds locked only after a 20-clip labelled set; (3) adjacent-frame embedding delta + optical-flow residual, inspect the top five spikes for flicker/identity jump/hands/teeth/gloss; (4) only then RIFE (if needed) and SeedVR2, then repeat 1–3 plus an eye gate. **Quarantine, never "repair until pass."** |
| Not a video pass | FaceDetailer — its own docs say it is not a video detailing node; per-frame repainting creates flicker |
| Reel template *(pending r15b-edit-motion for the motion-control fields)* | the r17 §2 YAML schema as an editable manifest (`id, tier, aspect_ratio, duration_s, hook, beats[], driver, identity, generation, cuts[], loop, overlay, audio, qa`) |
| Human gate | eye-gate on every clip, recorded in `gate.json`; no auto-publish |
| **Cost — correct notation** (finding 19) | **invocation:** `--max-usd 0.50 --max-minutes <derived>` per proof run (both are CLI flags; `max_usd` is *not* a manifest field). **Manifest:** `price_usd_per_hour`, `max_minutes`, `readiness_timeout_seconds`, `job_timeout_seconds`. The exact values go on the T2 card and into the dry-run transcript before the create. Planned $0.70 across the two proofs |
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
| Human gate | **GATE E.** week-plan approval before generation spend |
| Tests | template schema validation; mix arithmetic; per-surface aspect derivation |

### S8 — Post and measure

| | |
|---|---|
| Route | **Instagram API with Instagram Login**, one Meta app, one OAuth grant + account record per creator, Graph API as the sole unattended executor (r19 §1). No Facebook Page required on this route |
| Publish | image / Reel / mixed carousel (≤10 children); create the container close to schedule time; poll video status; publish idempotently on an `idempotency_key` |
| Disclosure invariant | `is_ai_generated: true` at **container creation** — carousel **parent only**, children excluded; cannot be added or removed after publishing. `persona.disclosure.is_ai_generated` makes it a property of the persona, not a per-call decision. Publisher **fails closed** if absent |
| **Publisher disclosure preflight** (finding 16) | there are four mandatory placements, not one, and three of them are account-level operator (T3) changes. Before **post 1** on any account the publisher checks `profile_ai_label_status == verified`, `profile_ai_label_verified_at` within the freshness window, `bio_disclosure_sha256` matching the persona's authored bio line, and `bio_disclosure_verified_at` fresh — **and refuses to create a container if any is missing, stale or mismatched**. Tests cover missing, stale and mismatched cases plus the container flag |
| Quota | query `GET /content_publishing_limit` per account per run; never hard-code a shared allowance (100 API posts / rolling 24 h, carousel counts once) |
| API-supported, therefore built | Collab posts (`collaborators`, Reels only) and **Trial Reels** (`trial_params`, `graduation_strategy`) — r19's claim-check corrected these from "not established" to documented. r15 §5b names Trial Reels the single biggest reach lever, so the poster supports `trial_params` from day one |
| Browser residual (narrowed) | only **library/trending audio and Story stickers/interactivity** remain genuinely unsupported. A standard Playwright persistent context per account, launched **only** for a queued operator-approved native task, stops on any challenge, and never performs engagement, account creation, verification, follows or DMs. Headless is not a guarantee Instagram accepts automated browsing; it is not a stealth layer |
| Never | anti-detect browsers, fingerprint spoofing, proxy rotation, `instagrapi`, automated likes/follows/bulk comments, cold DMs, device/IP churn. The 10sorlabs SOPs' evasion spine (device resets, disposable SMS, hotspot IP rotation, delete-and-recreate-on-shadowban) is **rejected**; what survives is the no-link-until-day-7 rule, the intra-day posting order, feed→Story reposting, Highlights structure, Trial Reels, and the constant hashtag set |
| **Readiness, not "warm-up"** (finding 12) | agents may never warm, verify or exercise an account (contract T4), so there is no warm-up automation and no warm-up phase. What replaces it is an **operator-owned readiness record** on the account: the operator declares the account ready (`readiness_record: {declared_by, declared_at, notes}`), and the publisher refuses to schedule anything until it is present. r18 §4's days 1–14 schedule is retained only as **operator guidance** — it is a conservative operating choice, not a platform rule; Instagram publishes no warm-up schedule and no daily action limits (r18 C15). After readiness, **every post still passes the ordinary T3 publish gate** |
| Metrics | nightly at +24 h, +48 h, +7 d. Field set per r18 §6. **`impressions`, `plays`, `video_views`, `clips_replays_count`, `ig_reels_aggregated_all_plays_count` are dead — `views` is the successor.** Never grade a post before +48 h (data lags) |
| Attribution | one first-party short link per door with UTMs; click series from the shortener API; the persona/media-id/batch join stays in figment. `profile_links_taps` is a denominator only (no destination detail). Instagram's in-app browser drops `Referer`, so UTMs are the only reliable mechanism |
| Human gate | **GATE F** batch approval, then **GATE G** — operator holds the T3 publish approval token per `governance/risk-tiers.md` (T3 → dashboard/WebAuthn channel only) |
| Tests | publisher dry-run against recorded fixtures (never live); disclosure-invariant test; quota-exhaustion test; idempotency replay test; carousel-parent-flag test |
| Review | **mandatory adversarial review** — this is the posting unit |

### S9 — Optimise

| | |
|---|---|
| KPIs | sends/reach, saves/reach, follows/reach, watch-through, skip rate, non-follower reach share (the AI-label / recommendation-eligibility canary), profile→link rate, AI-suspicion rate (classified from the raw comment stream — sentiment is not an API field) |
| What it adjusts, in order | (1) the weekly mix, by format sends-per-reach and follows-per-reach; (2) template ranking, retiring the bottom template monthly; (3) posting windows from the account's own reach-by-hour; (4) reel length band from watch-through; (5) slot-1 selection policy |
| Rule | the optimiser **proposes** a diff to `content/taxonomy.yaml` and the template ranking; the operator approves it at **GATE H**. It never edits the live mix unattended |
| Cold start | published best-time windows are a seed only; from day 14 the account's own Insights govern. Cohort like-counts are hidden on 13 of 15 accounts, so no external performance data is load-bearing |
| Tests | KPI formulas over fixture warehouses; proposal determinism; refusal to grade a post younger than 48 h |

### SV — Voice (spec level this arc)

Chain, one phase per link (P14a–g, §9): persona voice brief (fictional adult, language/accent, warmth, pace, breath restraint, explicit prohibition on real-person resemblance) → 20 **synthetic** candidates by a non-cloning route → ear-gate 3 → 10–20 s clean mono reference with exact transcript → clone into **CosyVoice 3 0.5B** (Apache-2.0 code; weight card verified separately) and **Chatterbox** (MIT) → blind ABX against 20 matched, consented, CC-licensed adult phone clips, ≥5 raters, UTMOS/NISQA + WER as triage only → **LatentSync 1.6** (Apache-2.0, 18 GB) lip-sync onto an already-approved clip → re-run identity/flicker QA. Persist `voice_id`, reference SHA, model SHA, seed, language, transcript, WAV, word timings, QA scores. Rejected for revenue use: F5-TTS (CC-BY-NC weights), Fish Speech (research licence); IndexTTS is an audition arm only (conditional licence, unconfirmed Cantonese). FYT's voice contract transfers (dry-run before spend, punctuation-first cadence, breath padding only to a *measured* shortfall, word onsets preserved); its paid ElevenLabs route does not. **Never clone a real person's voice.**

### SX — Explicit-tier machine (built on clothed data, run by the operator)

| Component | Built by agents | Boundary |
|---|---|---|
| Template grammar | yes — slots, ordering, variable types | ships with an **empty** vocabulary; the operator authors slot values |
| Taxonomy engine | yes | clothed fixtures only |
| Local-model adapter interface | yes — a stable call contract for an operator-run local model | agents never invoke it against explicit content. **The adapter returns opaque gate metadata only** (finding 17): `{gate_id, decision: verified\|parked, decided_by: operator, decided_at, subject_sha256}`. No agent and no card ever receives an explicit prompt, asset, thumbnail, caption, classifier output that reveals content, or a judgment task |
| QA scorers (identity, register, compliance classifier, age gate) | yes, calibrated on clothed data | the age gate is the hard one: an ambiguous face is unrecoverable here (GUARDRAIL 2) |
| Poster / scheduler | yes | separate accounts, separate app, separate store |
| Generation and judgment | **no** | operator hardware, operator eye, or a local model against the operator's rubric |

### SX-T — Explicit-tier adapter training (operator-only, owned hardware)

MANDATE §3 scopes the LoRA to unclothed coverage too, and the tier constraint puts that entirely on operator hardware. v1 had no stage for it, so the two-tier identity promise had no build path. SX-T closes it, deliberately **opaque to agents**.

| | |
|---|---|
| Who runs it | the operator, on owned hardware, by hand. No pod, no card carrying content, no agent invocation |
| What agents build | the dataset-manifest schema, the training config template, the ranking harness and the acceptance-test runner — all exercised **on clothed fixtures only** |
| Store | an operator-local path, never referenced by a repo file beyond an opaque name. The explicit adapter's weights, dataset and samples never enter this repo, any batch store, any ledger row, or any card |
| What kb learns | a single opaque record: `{adapter_ref, trained_at, acceptance: pass\|fail, gate_id}`. Nothing else crosses the boundary |
| Acceptance test | the operator runs the same held-out protocol used for LoRA v1/v2 — 6 held-out prompts × 2 seeds, identity floor, adult-read, register adherence — against the explicit adapter on owned hardware, and records only the pass/fail plus the gate id. Combined with S2c's clothed acceptance, that is the two-tier acceptance test C2 refers to |
| Never | an agent generating, prompting for, scoring, viewing or judging any part of this stage (contract T4) |

## 4. Research streams as cadences

`orgs/figment/HEARTBEAT.md`. Every cadence's goal is decidable — it either produced its named artefact row or it recorded "evidence unavailable". **v1 declared all seven T1, which was wrong on three counts** (finding 12): a signed-in browser session is T3 under `contract.md`, live Graph API calls against a real account are not fixture runs, and a follow is T4-never. Corrected per row:

| Cadence | Owner | Tier | Schedule | Decidable goal | Evidence rule |
|---|---|---|---|---|---|
| `figment-cohort-scan` | `figment-researcher` | **T3 per run** (authenticated) | weekly | append a dated row per reference account: grid mix, cadence, format facts — or "evidence unavailable" | a signed-in browser session is a live-platform browser action: **one operator-approved task per run**, own tab, first grid page only, no login/interaction/download, never open a Story highlight (leaves a seen-receipt), stop on any challenge. The unauthenticated variant (public profile pages only) may run T1 |
| `figment-platform-trends` | `figment-researcher` | **T1** | weekly | append dated rows for audios, formats, policy changes; flag any change to the AI-label enforcement state | public web sources only, read-only, **no follows anywhere**; Explore/Reels tab is **not** browsed (it trains the operator's recommendation profile) |
| `figment-tooling-watch` | `figment-researcher` | **T1** | fortnightly | re-verify every pinned dependency's licence and pin; file a card on any drift | a claim without a primary source and a date is not recorded |
| `figment-fanvue-economics` | `figment-researcher` | **T1** | monthly | append public pricing/cadence/funnel observations | public and read-only; **no follows, no engagement of any kind** (contract T4 — v1's "free follows allowed" was a straight contract violation), zero spend, no payment method, no messaging |
| `figment-insights-pull` | `figment-analyst` | **T2 — queues-for-me** | daily | one warehouse file per account per day, with API version and fetch time | a live authenticated Graph API read against a real account, not a fixture run. Stays carded until the contract explicitly promotes it; raw response persisted; no post graded before +48 h |
| `figment-token-health` | `figment-analyst` | **T2 — queues-for-me** | daily | every account record's `token_health` is fresh, or that account is paused with an operator task filed | live account call, same rule as above; never reads or writes a token; health state only |
| `figment-optimise` | `figment-analyst` | **T1** | weekly | one proposal diff, or a no-change report | reads the local warehouse only; proposes only; the operator's gate applies it |

## 5. Dashboard — decision

**DECISION: one new project-scoped `Studio` destination inside the kb dashboard** — figment's stage graph as ordinary workflows, its gates as ordinary Inbox items, nothing bypassing the platform. The trade-off: figment needs agents, cards, ledgers, approvals and a WebAuthn T3 channel, all of which exist only in the kb dashboard, and the T3 publish token is *defined* as that channel (`risk-tiers.md`) — a standalone app could not mint a valid one and would reimplement a second auth story, deploy, naming layer and inbox against a MANDATE that forbids speculative abstractions. The honest cost the other way: figment's boards, curation sheets and calendars are more visual than anything the dashboard renders today, so this is real UI work, not a tab.

**This is a decision, not a question** (finding 22). v1 published it as a "Decision" and simultaneously carried it as open question Q10, so it had not decided. **Q10 is removed** — and the decision does not block the arc on UI work:

- **The first eye-gates — GATE A, A2, A3, B — run on the local blind HTML board**
(`build_grading_board.py --blind`) with the operator's rulings file, surfaced as ordinary **kb Inbox cards** deep-linked to the run. No new UI is needed to reach the first checkpoint.
- **The Studio surface is phase P16**, GATE-BLOCKED on the operator prioritising dashboard UI work
  against the rest of the kb backlog — sequenced honestly rather than assumed.

### Views (P16 scope; each row's acceptance test is the phase's exit condition)

| View | Route | Shows | Writes | Acceptance test |
|---|---|---|---|---|
| Creators | `/studio/creators` | one row per persona: identity status, LoRA checkpoint + tier, register lock, live batches, this week's plan, per-account health | none (read projection of `persona.yaml` + `accounts.yaml`) | renders creator-001 and the persona-002 fixture from data files alone, with no figment-specific server code path |
| Generate | `/studio/creators/:id/generate` | edit a batch manifest's inputs (prompt variables, grammar table, chain toggles), dry-run preview at zero cost, launch as a workflow | files a stage card | a dry-run from the UI produces the identical prompt set to `--dry-run` on the CLI, and launching files a schema-valid card |
| QA board | `/studio/batches/:batchId/board` | the blinded contact sheet with per-cell scores, three-state badge, **all seven rulings axes**, parked reasons | rulings file → `qa_stamp.py` (the only stamp writer) | a rulings submission missing a safety axis is rejected in the UI and by `qa_stamp.py`; a `parked` cell does not change lifecycle `state` |
| Calendar | `/studio/accounts/:ref/calendar` | the week plan per account: unit, template, slot cells, scheduled time, disclosure flag | schedules an approved batch | refuses to schedule an account whose disclosure preflight or readiness record is not verified |
| Accounts | `/studio/accounts` | per account: token health, quota seen, paused reason, disclosure label state + verified-at, readiness record, publish audit | operator actions only | expiring one fixture account's grant pauses only that row (the P11b proof, surfaced) |
| Analytics | `/studio/analytics` | per account and per template: the 8 KPIs, non-follower reach share, link funnel, AI-suspicion rate; the optimiser's pending proposal | none (proposal approval is an Inbox gate) | a post younger than 48 h renders as "not gradable", never as a score |

Existing surfaces absorb the rest: gates are Inbox items deep-linked to the run; the stage graph is a Workflow; figment's agents appear in Agents; cost rows land in the same ledgers.

## 6. Agents, workflows, cards

**Declaration matrix** (finding 21). One declaration file per agent under `agents/`, matching the frontmatter that `governance/card-schema.md` and the profile registry actually consume. `role` is from the card enum — **risk tier lives on the card, never in the role field**, which is what v1 got wrong with "work T2" / "work T3". All nine share one skill set; each file carries only what changes behaviour.

| Agent | `role` | `model` | `default-profile` (+ `allowed-profiles`) | Executes | Owns / never |
|---|---|---|---|---|---|
| `figment-runner` | `manage` | `claude-opus-5` | `manager:claude:claude-opus-5` (+ `…:claude-fable-5`) | — conducts | launch, sequencing, gate spine, work-order withholding, targeted repairs / never craft, verdicts, spend decisions, publishing |
| `figment-checker` | `inspect` | `claude-opus-5` | `worker:claude:claude-opus-5` (+ `…:claude-fable-5`) | — grades | **every Instagram-tier** verdict: identity gate, register proof, pass A/B, video gates, compliance, the `qa_stamp.py` write / never authors what it grades, and never touches **anything explicit-tier** (finding 17) |
| `figment-expand` | `work` | `claude-sonnet-5` | `worker:claude:claude-sonnet-5` (+ `…:claude-opus-5`) | **S2, S2b, S2c** | builds and runs its manifests / never stamps a gate that unblocks its own work |
| `figment-train` | `work` | `claude-sonnet-5` | `worker:claude:claude-sonnet-5` (+ `…:claude-opus-5`) | **S3, S4** | same |
| `figment-render` | `work` | `claude-sonnet-5` | `worker:claude:claude-sonnet-5` (+ `…:claude-opus-5`) | **S5, S6** | same |
| `figment-content` | `work` | `claude-sonnet-5` | `worker:claude:claude-sonnet-5` (+ `…:claude-opus-5`) | **S7** + templates | same |
| `figment-poster` | `work` | `claude-opus-5` | `worker:claude:claude-opus-5` (no downgrade) | **S8** | container creation, quota query, publish, audit, disclosure preflight / never publishes without a T3 token, touches credentials, or warms an account |
| `figment-analyst` | `work` | `claude-sonnet-5` | `worker:claude:claude-sonnet-5` (+ `…:claude-opus-5`) | **S9** + insights/token-health cadences | pull, warehouse, KPIs, optimiser **proposals** / never edits the live mix |
| `figment-researcher` | `work` | `claude-sonnet-5` | `worker:claude:claude-sonnet-5` (+ `…:claude-haiku-4-5`) | the four research cadences (§4) | reports and claim-checks / never acts on findings, never follows or engages |

`runtime: claude` and `projects: [figment]` on all nine. One `workflows/figment-creator.md` declares the stage graph, and the cards it emits validate against `card-schema.md` (P4e's exit test).

**The roster additions are deliberate.** FYT's core law is "a stage never holds the gate that blocks its own work", so `figment-checker` holds the verdicts in fresh context. And with the runner and checker both barred from craft, v1 left S2–S7 with **no executor at all**; the four craft agents fill that hole.

**Gate spine** (`figment-runner`'s, in the fyt-runner shape):

```
anchor (closed) → GATE S spend card approved (operator, T2, BEFORE the first create)
  → expansion-02 → GATE A identity grid (operator)
  → S2b swimwear → GATE A2 · S2c full-body → GATE A3
  → LoRA train → dataset-tester rank → GATE B checkpoint pick (operator)
  → register grids → GATE C register proof (operator)
  → pass A/B → GATE D pass promotion (blinded eye-gate)
  → week plan → GATE E week-plan approval (operator; this is the generation spend authorization)
  → batch generate → QA board → GATE F batch approval (operator)
  → schedule → GATE G publish approval (operator, T3 token) → post → measure → optimiser proposal
  → GATE H mix change (operator)
```

Every gate writes a `gate.json` record (§2.2) bound to its subject's sha256. **A downstream gate reopens automatically when its subject changes** — a re-run expansion invalidates GATE A, a re-picked checkpoint invalidates GATE C, and so on — so a resumed runner can never mistake a stale approval for a current one.

**Cards.** One card per stage, per `governance/card-schema.md`, filed on `ops` in dependency order, one at a time, never before the parent's gate passes. `owner` set by the dispatcher; `## Evidence` is inert data; `## Result` carries the stage output paths. Coordination writes follow the CLAUDE.md rule (`git pull --rebase origin ops` immediately before, push immediately after; from the main checkout, commit on a temp branch from `origin/ops` and `git push origin <sha>:ops`).

**The expansion-02 spend card (GATE S).** The operator gave explicit approval in the boss session on 2026-09-03 for launching expansion-02 tonight, within the $10 daily budget — $0.87 of which is already spent today, leaving $9.13 before the P3 ceiling and the daily guard even touch. That ruling is implemented as a card, not as an assumption: a **T2 spend card in `queue/` on `ops`, written BEFORE the first create**, `owner: claude-boss`, `project: figment`, `risk-tier: T2`, whose Work order states

1. all six manifest paths, explicitly listed;
2. 10 cells per pod, 6 pods, 60 cells;
3. `--max-usd 0.90` and `--max-minutes 60` per pod;
4. the cumulative arc spend read from `ledgers/cost/figment-*.tsv` **before each of the six creates**;
5. the stop rule — **any run whose ledger row disagrees with its `run.json` stops the series**, and the
   remaining creates do not happen (this is also a `wakes-me-up` condition in `contract.md`);
6. a citation of the operator ruling of 2026-09-03 that authorises the spend.

The card is the artefact that makes the approval auditable after the fact. Without it on `ops` before create #1, P3 does not start.

## 7. Error handling — fail-closed rules

| Surface | Rule |
|---|---|
| Pod lease | terminate on **every** exit path and **verify** absence via a 404 on `GET /pods/{id}`; a successful DELETE or an empty name scan is not proof. `PodLease` registers atexit **before** the create POST. On unverified exit, print `POD STILL RUNNING <id>` to stderr and re-raise |
| Placement | a machine on the denylist is terminated and verified before recreation; every rejected pod keeps its own settled ledger row (REVIEW-e finding 2 must be fixed — the current code rewrites it to $0.00, under-counting both guards) |
| Spend | manifest rate distrusted after create; missing/zero/over-budget READY rate → immediate terminate-and-verify. Ledger path captured once at create so a UTC-midnight crossing cannot double-count — this is REVIEW-e **finding 18**, and P0 both fixes it and adds `test_ledger_row_settles_in_the_file_it_was_created_in_across_utc_midnight`. A ledger row that disagrees with `run.json` stops the series and wakes the operator |
| Readiness | a pod that does not reach READY inside `readiness_timeout_seconds` is terminated and verified absent. Every expansion pod is cold, so 900 s is a **budget, not a promise**: exceeding it is a fail-closed stop, which is the intended behaviour |
| Uploads | preflight rejects traversal, absolute subfolders, directories, duplicate names, empty globs, and (new) files over a size cap and 0-byte files except `_dataset.ready`. Retry 3× with 15 s/30 s backoff, matching the bootstrap's own hardening |
| Artifacts | verify `bytes_written == Content-Length`; fail closed when the header is absent for a `.safetensors`. Clear `_training.complete` / `_training.failed` at pod start so a reused volume cannot return the previous run's LoRA |
| Marker polling | tolerate N consecutive transient non-{200,404} statuses before failing; a 200 on the failed-marker stays instantly fatal |
| Generation | any hard QA failure quarantines to `rejected/` and regenerates; near-threshold routes to human review; nothing auto-publishes. "Perfect or culled," never "good enough" |
| Posting | idempotency key per post; quota queried per account per run; disclosure invariant checked before the publish call; a failure isolates to one account's queue |
| Tokens | expiry or challenge pauses **that account only** and files an operator task. Never retry a challenge; never automate verification |
| Browser | stop on any challenge, no retries, escalate. One named profile per account, no cross-account context |
| Gates | a gate that did not happen is never stamped. `parked` is always legal, and never changes lifecycle `state`. A `gate.json` whose `subject_sha256` no longer matches its subject is treated as **reopened**, not as approval |
| Writers | one writer per axis, enforced in code: `qa_stamp.py` → `review_status`; `expand/batch_state.py` → lifecycle `state`; `pipeline/gates.py` → `gate.json`. Any other writer is a bug with a test against it |
| Training bounds | `job_timeout_seconds`, `readiness_timeout_seconds` and `max_minutes` are proved consistent by preflight before the create; a breach **stops** the run and is never silently extended |

## 8. Testing strategy

| Layer | What | Where |
|---|---|---|
| Unit | pure functions: manifest preflight, cell-grammar expansion (60 ids, 10/shard, 40-stratum coverage, fixed replicate seeds), KPI formulas, caption/hashtag rules, quota arithmetic, disclosure preflight, **every legal and illegal reducer transition**, safety-axis rejection, gate-record hash matching, threshold-lifecycle refusal to route while `uncalibrated` | `pipeline/*/tests/` |
| Regression | the 21 REVIEW-e findings, each with the named test from its row — including **finding 18** (ledger row settles in the file it was created in across UTC midnight) and **finding 8** (shell-injection regression on rendered training placeholders) | `pipeline/pod/tests/` |
| Contract | a separately approved throwaway-pod test proving ComfyUI's `/upload/image` accepts `.txt`, `.toml` and `_dataset.ready`; shard-interruption tests after shards 1, 3 and 5; two-account isolation with an expired grant | `pipeline/pod/tests/`, `pipeline/publish/tests/` |
| Dry run | `runpod_run.py --dry-run` (full local flow, no network, no billable compute) before every live pod; publisher dry-run against recorded fixtures, never against a live account | per stage |
| Live proof | one bounded run per stage with `--max-usd`, `--max-minutes`, and post-run ledger reconciliation against `run.json` | §9 |
| Visual QA | mandatory on every generated image (GUARDRAIL 4); blinded board for every promotion decision | `blind_pool.py` + `build_grading_board.py` |
| Adversarial review | different model/session, before live, for every spend-controlling, identity-scoring or posting unit; research claim-checked. **The review must be of the fix, at the SHA that will execute** — v1 leaned on REVIEW-e, which reviewed the *old defects*, not their fixes or the identity scorer. Hence the explicit **P0R** and **P2R** phases, and the rule that **P3 consumes only review files whose verdict is live-safe and whose reviewed SHA equals the executed files' SHA** | `pipeline/<stage>/REVIEW-*.md` |
| Baseline hygiene | pytest basetemp must resolve outside the working tree — the documented command currently reads 38 passed / 81 errors purely from an ACL-locked in-repo `pytest-of-danie/` (REVIEW-e finding 1). A red baseline is what gets waved through before a spend run; fix it before anything else |

## 9. Build order

Each phase is one plan task, with an exact target list and its own acceptance criteria. **GATE-INDEPENDENT** phases need no operator decision. **GATE-BLOCKED** phases wait on a named gate.

| # | Phase (one plan task each) | Gate status | Tonight? | Ceiling |
|---|---|---|---|---|
| P0 | Harness baseline + expansion-blast-radius fixes: REVIEW-e findings 1, 2, 6, 11, 13, 15, 16, 17, **18**, 19 + the finding-5 preflight arithmetic; green suite with basetemp outside the tree | GATE-INDEPENDENT | **yes** | $0 |
| **P0R** | Different-model review of the P0 diff **at its SHA** + the green focused suite; verdict file under `pipeline/pod/REVIEW-*.md` | GATE-BLOCKED (P0) | **yes** | $0 |
| P1 | `persona.yaml` schema (grammar table, threshold lifecycle objects, disclosure + readiness fields) + creator-001 record + `batch.json`/`pod_runs[]`/cell/score/`gate.json` writers + `expand/batch_state.py` reducer + **§2.4a safety-axis rulings schema and `qa_stamp.py` rejection** + gitignore extension | GATE-INDEPENDENT | **yes** | $0 |
| **P2R** | Different-model review of every scorer and QA-schema change at its SHA + focused tests. Gates both P2 and P3; re-runs if P2 touches any scorer file | GATE-BLOCKED (P1) | **yes** | $0 |
| P2 | `expand/build_expansion_set.py` + the generated 60-cell allocation + **6 ephemeral-pod manifests** (10 cells each, `job_timeout_seconds: 240`, readiness 900, ruled reference set `g01/g02/g07`, `_uploads/` created, **no network volume**) + board wiring + `--dry-run` transcript. Must not modify a scorer file | GATE-BLOCKED (P0R, P1, P2R) | **yes** | $0 |
| P3 | expansion-02 live runs → score → blind board → **GATE A** | **GATE-BLOCKED** — (a) all three r15b reports present + claim-checked + §0 reconciliation done, (b) the approved **T2 spend card on `ops`**, (c) P0R and P2R verdicts live-safe at the executed SHA | **yes, only after its gates** | $5.40 |
| P4a | Stage-5 pass manifests, pinned node/model list with licences, `passes/build_pass_manifest.py` (**no scorer file**) | GATE-INDEPENDENT | no | $0 |
| P4b | Stage-7 `content/taxonomy.yaml` + CT-1…7 / RT-1…6 templates as data | GATE-INDEPENDENT | **yes** | $0 |
| P4c | Account + post schemas and fixtures, including the four disclosure fields and the readiness record | GATE-BLOCKED (P1) | no | $0 |
| P4d | Insight schema + warehouse fixtures | GATE-BLOCKED (P4c) | no | $0 |
| P4e | The nine agent declarations + `workflows/figment-creator.md`; emitted cards validate against `card-schema.md` | GATE-INDEPENDENT | **yes** | $0 |
| P4f | `orgs/figment/HEARTBEAT.md` cadences at their corrected tiers + org-file consistency | GATE-INDEPENDENT | **yes** | $0 |
| P5 | Training-path harness fixes (REVIEW-e findings 3, 4, 5, **8**, 7, 9, 10, 12, 14) + `TRAINING_MAX_MINUTES` + the four training bounds + throwaway-pod upload contract test + dataset tester + different-model re-review flipping REVIEW-e's training verdict | **GATE-BLOCKED (Q4 operator decision + approved T2 code card)** | no | $0 |
| P6 | S2b swimwear batch → **GATE A2** | GATE-BLOCKED (GATE A) | no | $0.60 |
| P6b | S2c full-body second pass → **GATE A3** | GATE-BLOCKED (GATE A) | no | $0.90 |
| P7 | LoRA v1 train + checkpoint rank → **GATE B** | GATE-BLOCKED (GATE A, GATE A3, P5) | no | $2.80 |
| P8 | Register grids → **GATE C** | GATE-BLOCKED (GATE B) | no | $0.80 |
| P9 | Pass A/B 12 cells → **GATE D** | GATE-BLOCKED (GATE C) | no | $1.10 |
| P10 | Video V1 + V2 proofs → eye-gate | GATE-BLOCKED (GATE D, **`r15b-edit-motion.md` claim-checked**) | no | $0.70 |
| P11 | Test 0: operator-provisioned IG account, Meta app, OAuth grant; prove container + AI label + quota + publish + one insights snapshot | GATE-BLOCKED (operator provisioning, Q2) | no | $0 |
| **P11b** | Two-account isolation proof: fixture persona 002 + fixture account, dry-run the whole DAG with data-only differences, two isolated queues, expire one grant, assert only that account pauses and exactly one operator task is filed while the other keeps running. **This is the acceptance gate for calling the platform N-account-ready** | GATE-BLOCKED (P11) | no | $0 |
| P12 | Week plan → **GATE E** → batch generate → QA board → **GATE F** → schedule → **GATE G** → post → measure | GATE-BLOCKED (GATE D, P11) | no | $2.00 |
| P13 | Optimiser + weekly cadence → **GATE H** | GATE-BLOCKED (P12, +7 d data) | no | $0 |
| P14a | Voice manifest/schema + persona voice brief | GATE-BLOCKED (Q8) | no | $0 |
| P14b | Non-cloning synthetic-candidate generator: selection + licence review | GATE-BLOCKED (P14a) | no | $0 |
| P14c | Generate the 20 synthetic candidates | GATE-BLOCKED (P14b) | no | $0.20 |
| P14d | Ear-gate 3 + reference-clip capture with exact transcript | GATE-BLOCKED (P14c) | no | $0 |
| P14e | Clone into CosyVoice 3 and Chatterbox, A/B | GATE-BLOCKED (P14d) | no | $0.20 |
| P14f | Blind ABX against 20 consented CC-licensed clips, ≥5 raters | GATE-BLOCKED (P14e) | no | $0 |
| P14g | LatentSync lip-sync proof onto an approved clip + identity/flicker re-QA | GATE-BLOCKED (P14f, GATE D) | no | $0.20 |
| P15a | Explicit-tier template grammar + taxonomy engine on **clothed fixtures**, empty vocabulary | GATE-INDEPENDENT | no | $0 |
| P15b | Sealed local-adapter call contract returning opaque gate metadata only, with its fixtures and tests | GATE-BLOCKED (P15a) | no | $0 |
| P15c | Operator gate-record path + separate store naming; no content crosses into the repo | GATE-BLOCKED (P15b) | no | $0 |
| P15d | Paid-platform adapter — **only after written platform confirmation** (Q9) | GATE-BLOCKED (Q9) | no | $0 |
| P15e | **SX-T**: operator-only owned-hardware explicit adapter training + its acceptance test + separate store | GATE-BLOCKED (Q7, operator hardware) | no | $0 |
| P16 | `Studio` dashboard surface: the six views in §5 at their exact routes, each with its acceptance test | GATE-BLOCKED (operator prioritising dashboard UI work) | no | $0 |

**Safe parallel set for tonight:** `P0 ∥ P1 ∥ P4b ∥ P4e ∥ P4f`. Then **P0R** on P0's diff and **P2R** on P1's schema; **P2** after P0 + P1 + P2R; **P3 last**, and only after all three of its gates. Any task touching `identity_check.py`, a shared schema, or an org coordination file is serialized — never run beside another task that touches the same file.

**Planned arc ceiling ≈ $14.90 against the $50 cap** (expected spend roughly half that, since ceilings budget the full `max_minutes` and runs finish sooner), leaving wide headroom for re-runs. Tonight's spend is capped at $5.40 (P3 only); with $0.87 already spent today that is $6.27 against the $10 daily guard. Every run passes `--max-usd`, and the arc guard sums `ledgers/cost/figment-*.tsv` before every create. **No line item in this table carries recurring storage** — that is the point of finding 3's ephemeral-pod ruling.

## 10. Open questions for the operator

Only the ones research cannot settle. Q10 (the dashboard) is **removed** — §5 decides it.

| # | Question | Recommendation | Blocks |
|---|---|---|---|
| 1 | Persona name, handle, home city, the bio disclosure line, and the link-in-bio door | — (operator's authorship) | S7 templates, S8 profile setup |
| 2 | Which Instagram professional account is Test 0, and when | — | P11, P11b, and therefore all of S8/S9 |
| 3 | Raise `governance/budget.yaml` `daily_usd_limit` (currently 10.00) for run days, or split expansion and training across days? | tonight's $5.40 (plus $0.87 already spent = $6.27) fits inside the current $10; a raise is only needed on a day carrying both an expansion and a training pod | P3, P7 |
| 4 | Training wall clock: approve `TRAINING_MAX_MINUTES: 180` (with `job_timeout_seconds: 6000`, readiness 1200, `--max-minutes 180`) for the training path only, or require checkpoint-resume across 60-minute pods? | **180-minute single-pod training.** Checkpoint-resume is rejected: it requires uploading artifacts back into a pod and doubles exactly the transport surface REVIEW-e findings 3/4/6 already indict | P5, P7 |
| 5 | Register: settings-only for v1, or spend 180–300 pod-minutes on a separate register LoRA (r12 §10 rank 6)? | settings-only for v1 — the LoRA option costs a large fraction of the arc and r12 §11 records no published measurement of persona+register interference | P8 |
| 6 | Do swimwear/lingerie cells enter LoRA v1, or v2 after the clothed identity test passes? | v2 — keeps LoRA v1 to one variable against three recorded clothing-render failures | P6, P7 |
| 7 | Explicit tier: which owned GPU, and when | — | P15e |
| 8 | Voice language and accent for creator-001 — CosyVoice 3 ranks first partly for Cantonese coverage; for English-only, Chatterbox may win the ABX | decide language first; the model choice follows from it | P14a–g |
| 9 | Fanvue written confirmation (still open in MANDATE §What exists today) | — | P15d, the paid-tier arc |

## 11. What v2 changed

### 11a. Changed by the r15b reports (the research reconciliation)

| Spec block | v1 said | v2 says | Source |
|---|---|---|---|
| S3 caption doctrine | `<trigger> woman`, class-token-only | **full-sentence VLM auto-captions (Qwen3-VL class), trigger prepended**; single-word captioning is the package's own documented legacy mistake (module 04), superseded by module 11 | r15b-training §11, §04, adopt-list 3 and 9 |
| S3 rank / LR | rank 32 / lr 5e-5, "video-only, provisional" | **rank 32 @ LR 1e-4, AdamW8Bit, bs 1, buckets 512/768/1024**, with rank 16 @ 2.5e-4 single-bucket as the cheap fallback arm | r15b-training §11, §05, adopt-list 7 |
| S3 steps / checkpoints | `max_steps 2000`, save 250 → 8 checkpoints | **`max_steps 3000`, save 250 → 12 checkpoints (250…2750 + final), keep all 12** | r15b-training §11, adopt-list 4 |
| S3 dataset tester | "8–12 parallel branches" | **12 parallel branches, one fixed prompt + fixed seed**, their sampler pairing explicitly not adopted | r15b-training §11 |
| S2 fan-out doctrine | unstated | the current package path is a **low-denoise (~0.23) identity-preserving edit** over fixed angle/pose templates, with an identity-lock clause on every prompt — adopted; its klein-**9B**/turbo stack is not | r15b-training §10 |
| S5 pass 0 | no LoRA strength band | **persona-LoRA strength 0.65–0.80** on independent per-LoRA sliders; never copy turbo step/cfg onto a Base model | r15b-generation §06, §09 |
| S5 pass 1 | 0.20–0.35 asserted without corroboration | same band, now **corroborated** by the measured FaceDetailer band 0.15–0.35 (bbox 0.40–0.50, sam 0.80–0.93) | r15b-generation §06, §09 |
| S5 pass 4 | no refine pass existed | **new refine pass at denoise 0.35 after upscale-and-normalize** — the package's standard two-pass structure | r15b-generation adopt-list 3 |
| S5 de-gloss | direction only | the anti-"AI look" negative-prompt shape, **re-written in our own words** (licensed text) | r15b-generation §06 |
| S6 motion block | rested on r14/r17 chapter reading | **explicitly marked pending `r15b-edit-motion.md`**; P10 gated on it | §0 |

### 11b. Deviations from the seeded decisions (carried forward from v1, amended)

| Seeded | Ruling | Reason |
|---|---|---|
| Every stage is a pod-harness manifest | **Modified** — GPU stages only; stages 7–9 reuse the loader, not the pod-lease schema | a posting job has no GPU, readiness or teardown semantics |
| `generated → scored → curated\|rejected → approved → …` | **Modified** — `quarantined` split from `culled`, and `review_status` made orthogonal to `state` with one named writer each | GUARDRAIL 4 requires quarantine-and-regenerate; curation surplus is not a failure; and mapping `parked` into a terminal state destroys the honest "not yet" |
| Swimwear/lingerie inside expansion-02 | **Modified** — own batch S2b, own gate, out of LoRA v1 | three recurrences of silent clothing-render failure; keeps LoRA v1 to one variable |
| LoRA covers every distance and both tiers | **Split** — LoRA v1 is a provisional clothed close/half proof; **S2c** adds full-body before a production LoRA; **SX-T** owns the explicit-tier adapter on operator hardware | v1 had no phase producing the mandated full-body or unclothed coverage, so its LoRA was not the two-tier identity the mandate asks for |
| Checkpoints every 250 steps | **Adopted, template corrected** — `max_steps 3000`, `save_every_n_steps 250`, keep all 12 | the committed template says 200/1600; module 11's live UI shows 3000 steps at a 250 cadence producing 12 checkpoints |
| Single-word/trigger caption doctrine | **Reversed in v2** — full-sentence VLM auto-captions with the trigger prepended | see §11a: single-word captioning is the package's superseded legacy path, not its doctrine |
| Model cache on a `network_volume_id` | **Deleted** — six fresh ephemeral pods, 900 s budgeted cold readiness | recurring billed storage the harness neither provisions, deletes nor ledgers would make the $50 arc proof false |
| P3 runs tonight, gate-independent | **Reversed** — P3 is gate-blocked on the r15b research gate, an approved T2 spend card, and SHA-matched P0R/P2R verdicts | MANDATE's research-before-expansion rule and `contract.md`'s T2 rule both bind before the money is spent |
| One P4 covering six subsystems | **Split** into P4a–P4f with exact files and dependency edges | a >400-line multi-subsystem diff is itself T2, and it collided with P1's and P3's files |
| All seven cadences T1 | **Re-tiered** — authenticated cohort scan T3 per run, live account reads T2, public scans T1 with no follows anywhere | a signed-in browser session, a live Graph API call and a follow are three different tiers, and one of them is never |
| Warm-up schedule as pipeline behaviour | **Replaced** by an operator-owned readiness record | agents may never warm, verify or exercise an account (contract T4) |
| Studio surface as both a decision and an open question | **Decided** — Studio is the target, Q10 removed; first eye-gates run on the local blind board + Inbox; the surface is phase P16 | a spec that publishes a decision and an open question about the same thing has not decided |
| Stage-5 "skin enhancer = DetailBoost-style sampler option" | **Modified** — Detail Daemon (MIT) is the default; RES4LYF DetailBoost is a licence-gated hold | r15 identifies DetailBoost as the package's enhancer but does not licence-check RES4LYF; r16 does not cover it |
| Stage-5 "conditional face repair" | **Specified** — native klein 4B Base `ReferenceLatent` edit, not FaceDetailer | Impact Subpack is AGPL-3.0 and the only FLUX.2 evidence targets klein 9B |
| Browser residual for the native gap | **Narrowed** — library/trending audio and Story stickers only | r19's claim-check: Collab posts and Trial Reels are API-supported (`collaborators`, `trial_params`) |
| Agents: runner, researcher, poster, analyst | **Extended** — `figment-checker` plus four craft agents (`-expand`, `-train`, `-render`, `-content`), with a declaration matrix and risk tier moved off the role field onto the card | FYT's core law: a stage never holds the gate that blocks its own work, and neither does its dispatcher — which left S2–S7 with no executor until the craft agents existed |
| Pod cost ceiling stated per stage | **Adopted, plus two hard findings** — expansion-02 must split across 6 pods of 10 cells (measured job time, not estimated) to fit the 60-minute cap; a real LoRA run cannot fit it at all, and needs all four bounds moved together, not just `max_minutes` | REVIEW-e finding 5 arithmetic against `DEFAULT_MAX_MINUTES`; `composite-01/02/03` `run.json` timing; the marker-poll timeout would kill a healthy run first |
| `chain[]` as a pod-manifest key | **Corrected** — builder input compiled by `passes/build_pass_manifest.py` into README-supported keys | an undocumented manifest key is silently ignored, which would produce a false pass-chain proof |
| `max_usd` written as a manifest field (S6) | **Corrected** — `--max-usd` and `--max-minutes` are CLI; the manifest carries `price_usd_per_hour`, `max_minutes` and the timeouts | copying the research notation into a manifest establishes no spend guard at all |
| N-account readiness proven by prose | **Corrected** — P11b is an executable acceptance gate (fixture persona 002, two queues, expired-grant fault injection) | success condition P5 had no phase producing it |
| Everything else | **Adopted** | — |
