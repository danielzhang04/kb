# P2R — Independent reviewed-SHA live-safety gate for creator-001 expansion-02

**Verdict: `LIVE-SAFE`**

Reviewer: independent Claude session (Opus 5), not the author of Task 1 (P1) or Task 5 (P2).
Date: 2026-09-03. Worktree: `C:\Users\danie\kb-worktrees\figment`, branch `claude/figment`.

`LIVE-SAFE` enables a T2 spend request. **It is not spend approval.** The operator's own
T2 approval and the ops spend card remain required before any pod is created.

---

## 1. Reviewed tree

| What | SHA |
|---|---|
| Reviewed SHA (`git rev-parse HEAD`) | `28c8988dc12d07f414cbe145121482243173022e` |
| Task 5 / P2 commit | `28c8988d` (= HEAD) |
| Task 1 / P1 commit | `a1d78fdf` |
| Harness prerequisites (verified ancestors of HEAD) | `4efea0de`, `f5ba643b` |

`git diff --stat HEAD -- orgs/figment/pipeline orgs/figment/personas` → empty. The reviewed
implementation is identical to the committed tree; nothing was reviewed from a dirty worktree.

`git status --short` at review time shows only pre-existing, out-of-scope untracked paths:
`ledgers/cost/figment-2026-09-02.tsv`, `ledgers/cost/figment-2026-09-03.tsv`, `personas/`
(see finding 8). No image, anchor, blind key, board, or `_uploads` file appears.

### Plan-prescribed commit-message lookup does not resolve

Plan Step 6.2 pins P1 by `git log -1 --grep='^feat(figment): add creator lifecycle and safety
schemas$'`. That returns **empty** at this tree — both P1 and P2 landed under different
subjects than the plan prescribed. This review pinned P1 and P2 **by SHA** instead
(`a1d78fdf`, `28c8988d`), which is strictly stronger. Recorded as finding 9.

### P2 did not touch P1's reviewed surface

```
git diff --name-only a1d78fdf..28c8988d -- \
  orgs/figment/pipeline/train/identity_check.py orgs/figment/pipeline/qa_stamp.py \
  orgs/figment/pipeline/gates.py orgs/figment/pipeline/expand/batch_state.py \
  orgs/figment/pipeline/persona.py orgs/figment/pipeline/blind_pool.py \
  orgs/figment/pipeline/build_grading_board.py \
  orgs/figment/personas/creator-001/persona.yaml
```
→ empty. P2 folded no unreviewed scoring, QA, lifecycle, gate, or persona change into the
manifest commit.

### Harness and base artifacts untouched by P1/P2

```
git diff a1d78fdf~1 28c8988d --stat -- orgs/figment/pipeline/pod/ \
  orgs/figment/pipeline/train/runs orgs/figment/pipeline/train/workflows
```
→ empty. `runpod_run.py`, `pod/README.md`, `creator-001-composite-02.yaml`, and
`klein4b_multiref_api.json` are exactly the already-reviewed P0 artifacts. **The credential
boundary is therefore untouched by construction.**

---

## 2. Reviewed paths and SHA-256

### Tracked — P1 (`a1d78fdf`)

| sha256 | path |
|---|---|
| `70865573e94042c6b30514fc481fa31c296e85b42e0c87f94b0f3779252f4467` | `.gitignore` |
| `1a969804da8930a856a99de998337b50293aa6f95531dab1bcfe43c9592eacc0` | `orgs/figment/personas/creator-001/identity-spec.md` |
| `f9dc8ae6537371875965dc6b5cf31b5fb84e6edee852242ce04b39c32cd0d42c` | `orgs/figment/personas/creator-001/persona.yaml` |
| `e412dd13496b188e371db2eeffad1e968b9bd1c8f84d7ecb4bbcd3469b86b39d` | `orgs/figment/pipeline/blind_pool.py` |
| `ff43c65245734a95f95ea17159e3f7fec3fa11bae2e9848d4b0a2b82295afd5c` | `orgs/figment/pipeline/build_grading_board.py` |
| `a9c8991e5c7aaa18a6ac7d76c3bdfa04a167d47c07a5732426be5975c46cfa1b` | `orgs/figment/pipeline/expand/__init__.py` |
| `f5b75e06a7a0cec3d69f85b9069d879b910b354a01a607a124dcce5ab8bbc00d` | `orgs/figment/pipeline/expand/batch_state.py` |
| `6e9bc73016116d71383b32611c3f29830a1eb488ba09f4d52eb1ef84934874b6` | `orgs/figment/pipeline/expand/tests/test_batch_state.py` |
| `1451c889bdb245ee6862e449419488429074e7afac85e6ae0254d55a5e468cd5` | `orgs/figment/pipeline/gates.py` |
| `1d505beb4840e2e1017f60a3a790ca82e84e78b10871a6737d7ad00a78259d84` | `orgs/figment/pipeline/persona.py` |
| `501e836325c7b025c56452904316791fca73b66f85ec3c4d201aa61ddcd29501` | `orgs/figment/pipeline/qa_stamp.py` |
| `826b2db7aef64586a1e64297dc5c2a32a2e8b0c6ed9528437c27af58918390d8` | `orgs/figment/pipeline/tests/test_blind_pool.py` |
| `bf34db8581aceb0a35b818afacea0f1b4e1905ddcea0b207504c30da90e63f92` | `orgs/figment/pipeline/tests/test_build_grading_board.py` |
| `da30ea15f0ffa98bfa6baa96d0587c402bef2956d1f255cffa83f4f64d6e8def` | `orgs/figment/pipeline/tests/test_gates.py` |
| `c42a6ec99330b7bef9960d7b5f6896dad125e745b63ee527369ab06bcf0ac0ec` | `orgs/figment/pipeline/tests/test_persona.py` |
| `df76ef42aa658acebdfd5411637e6005757c7671bc32a3bd7cd92b76c9259a7b` | `orgs/figment/pipeline/tests/test_qa_stamp.py` |
| `5f4a7c0205f7124f4ff980ad9c93b2ac0f5b5c2bb3b38e25676c0c24004cdba4` | `orgs/figment/pipeline/train/identity_check.py` |
| `6f25f9dddfb3761186a89fc641cc8a7612e33e752acd23d12eb60e6b1fa5b11e` | `orgs/figment/pipeline/train/tests/test_training_tools.py` |

### Tracked — P2 (`28c8988d`)

| sha256 | path |
|---|---|
| `3a5a57aa8fef8f1dc4dc7f85add7f92c3b56fb18bb3824517c13fb3c4a8e5bd0` | `orgs/figment/pipeline/expand/build_expansion_set.py` |
| `cf1bf29f898be3b708fb87cc3436ff82c144d0aed70eac5227eaa6125fadc223` | `orgs/figment/pipeline/expand/tests/test_build_expansion_set.py` |
| `1d4621a3ebfebf8d530b06819256de4664712f5e16a3dc9df44fc8200c53c853` | `.../expand/runs/creator-001-expansion-02-allocation.json` |
| `d776124b4bbe547f653ac1af3536210cf337defea65458af952e0a786b696bb0` | `.../expand/runs/creator-001-expansion-02-dry-run.txt` |

### The six manifests (independently hashed; identical to the values the P2 dry-run transcript claims)

| shard | sha256 |
|---|---|
| 01 | `1b5661cb12a431b760b67b367eb1fafc85b89d715776c2c1fcdd2a224c0d6132` |
| 02 | `f8025a72c3cafda34b745e35032f697e2a2a1262365b2d22de62b1557c355213` |
| 03 | `0a88ca1aa27c1ec10cddefb6910dc7837dffdb5e451ed6020fbeea5821ce8f90` |
| 04 | `f1b9e7191c54e0029776d9cc0b0453b7b3b1b645ffc64533e53f3a9fc47fefaf` |
| 05 | `8d80592526dc2b13d0336abcdcdfb0530afde3c53a3225a1490230e0b6f41ae4` |
| 06 | `699e6cf99f1a02c7ea88400ed38e11ab9976e8cf0c03043644a3c2eaed185735` |

### Caption sidecars

60 files in `.../expand/runs/creator-001-expansion-02-captions/`, named exactly by cell id
(`exp02-s001`–`s040`, `exp02-r001`–`r020`). SHA-256 of the sorted `<sha256>  <name>` listing
(newline-terminated): `2b34163d1d2c2df6400929c88a9e4c634975338ae252b7c5782a92ebae21f5f4`.

### Ignored anchors — hashes only

These are gitignored binaries. **Hashes recorded; no visual review of the anchor images was
performed and none is claimed.** The staged upload copies are byte-identical to the persona
anchors.

| sha256 | path |
|---|---|
| `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed` | `personas/creator-001/anchors/g01.jpg` and `expand/runs/_uploads/creator-001/g01.jpg` |
| `d6ef8ec7a619162fb180727421b3c6f6ec05342544065c5f4a02e318ef4f12e6` | `.../anchors/g02.jpg` and `.../_uploads/creator-001/g02.jpg` |
| `f5457d845687aae1e23461560c2609a630b51bf2fc31cd21bc85ecbc7ed82d6a` | `.../anchors/g07.jpg` and `.../_uploads/creator-001/g07.jpg` |

`git check-ignore -v` confirms all six are ignored (`.gitignore:49`, `.gitignore:55`). The
repo-root source directory `personas/anchors/gemini-batch-01/` retains only g03–g06 and g08
(g01/g02/g07 were **moved**, not copied) and is ignored by `.gitignore:48`.

---

## 3. Commands run and exit codes

| # | Command | Exit |
|---|---|---|
| 1 | `PYTEST_DEBUG_TEMPROOT=C:/Users/danie/AppData/Local/Temp/kbfp-r6 py -3 -m pytest orgs/figment/pipeline/pod/tests orgs/figment/pipeline/tests orgs/figment/pipeline/train/tests orgs/figment/pipeline/expand/tests -q -p no:cacheprovider` | 0 — **270 passed in 16.13s** |
| 2–7 | `py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest .../creator-001-expansion-02-shard-NN.yaml --out <scratch>/shard-NN --max-usd 1.00 --max-minutes 72 --dry-run`, NN = 01…06 | 0 (all six) |
| 8 | `py -3 .../build_expansion_set.py build --persona ... --base-manifest ... --workflow ... --out <scratch>` (determinism re-build) | 0 |

All six dry runs ended with `termination verified: pod dry-run-pod is absent` and
`exit path complete: terminate + absence verification succeeded`. Cost rows landed under
`<out>/dry-run-ledger/` at $0.00 — no `--ledger-dir` was supplied, so no real ledger was
touched. No network call was made.

---

## 4. Manifest / dry-run table

Independently recomputed (not read from the P2 transcript):

| shard | `require_manifest` | keys ⊆ README | jobs | job ids | seeds | uploads | dry-run exit |
|---|---|---|---|---|---|---|---|
| 01 | PASS | yes | 10 | `c001-exp02-s001..s010` | 521010…530091 | g01,g02,g07 | 0 |
| 02 | PASS | yes | 10 | `c001-exp02-s011..s020` | 531100…540181 | g01,g02,g07 | 0 |
| 03 | PASS | yes | 10 | `c001-exp02-s021..s030` | 541190…550271 | g01,g02,g07 | 0 |
| 04 | PASS | yes | 10 | `c001-exp02-s031..s040` | 551280…560361 | g01,g02,g07 | 0 |
| 05 | PASS | yes | 10 | `c001-exp02-r001..r010` | 561370…570451 | g01,g02,g07 | 0 |
| 06 | PASS | yes | 10 | `c001-exp02-r011..r020` | 571460…580541 | g01,g02,g07 | 0 |

Verified identical across all six, and byte-identical to `creator-001-composite-02.yaml` for
every field the plan requires copied verbatim:

- `gpu` = `{"type": "NVIDIA GeForce RTX 4090", "count": 1, "cloud": "SECURE"}` ✔
- `image` = `runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04` ✔
- `price_usd_per_hour` = `0.8` ✔
- `models` (3 entries, `Comfy-Org/flux2-klein-4B`), `comfyui` (root `/workspace/ComfyUI`,
  `git_ref v0.20.1`, port 8188), `custom_nodes` = `[]`,
  `avoid_machine_hosts` = `["qvf79yutw3t2"]` ✔

Overridden fields: `job_timeout_seconds: 300`, `readiness_timeout_seconds: 900`,
`max_minutes: 72`, `container_disk_gb: 60`, `volume_gb: 0`.
Lease arithmetic: 900 + 10×300 + 300 = 4200 s ≤ 4320 s (72 min). ✔

Absent from every manifest: `network_volume_id`, `network_volume`, `training`, `artifacts`.
No unknown top-level key; no unknown job key (`seed`, `output_name`, `expected_images`,
`substitutions` only). No `identity_set`, caption, or stratum metadata leaked into a manifest.

**Uploads.** Exactly one upload group per manifest, `files` in the order
`_uploads/creator-001/g01.jpg`, `g02.jpg`, `g07.jpg`, `subfolder: creator-001`,
`type: input`, `overwrite: true`. All three resolve to existing non-empty files
(737 366 / 750 657 / 730 186 bytes as reported in each dry run's `run.json`).

**seed_fields** = `["noise_seed"]`; workflow node 22 (`RandomNoise`) carries `noise_seed`, so
`require_manifest`'s seed-field assertion is satisfied by a real node.

**Substitutions.** All 60 jobs carry exactly one substitution: node `"4"`, field `"text"`.
Node 4 exists in both the emitted manifest workflow and the reference
`klein4b_multiref_api.json` and has a `text` input. No substitution targets a non-existent
node or input.

**Graph contract**, verified per shard: `LoadImage` 6/7/8 = `creator-001/g01.jpg`,
`g02.jpg`, `g07.jpg` (the identity-spec order — the reference workflow had 6=g04, 7=g01,
8=g07, so the rebind is real and correct); `EmptyFlux2LatentImage` 1024×1280; `CFGGuider`
cfg 4.0; `Flux2Scheduler` 50 steps; `KSamplerSelect` `euler`; three `ReferenceLatent` chains
preserved. Diff against the reference workflow is exactly nodes `5`, `6`, `7` — the
rewritten negative prompt and two rebound `LoadImage` nodes. Node 4's static placeholder is
unchanged and is overridden per job. **No `denoise` input exists anywhere in any manifest**
— the verified no-denoise graph is preserved and nothing was invented.

**Determinism.** Re-running the builder into a clean scratch directory reproduced the
allocation, all six manifests, and all 60 caption sidecars **byte-for-byte (0 mismatches)**,
and emitted exactly 67 files — no extra artifact.

---

## 5. Allocation

Independently checked against `persona.yaml`'s grammar:

- 60 cells, 60 unique `cell_id`, 60 unique `seed`. ✔
- IDs are exactly `exp02-s001`–`s040` then `exp02-r001`–`r020`. ✔
- First 40 are 40 **unique** strata, enumerated angle-major → distance → light, matching
  `traversal_order`. ✔
- 20 half-body strata exist; the 20 replicates' `source_stratum_id` list equals the half
  strata's `stratum_id` list, in the same order. Every replicate has `distance == "half"`;
  **no close stratum is repeated**. ✔
- Every replicate uses a wardrobe family different from its source and a seed different from
  its source. 0 violations. ✔
- Wardrobe families balanced 12/12/12/12/12. ✔
- Seeds follow `520001 + ordinal*1009` for ordinal 1…60, in order, and every manifest job's
  seed equals its allocation cell's seed (0 mismatches). ✔
- 10 cells per shard × 6 shards. ✔

---

## 6. Prompt and caption safety

Checked programmatically over all 60 positive prompts plus the single shared
`NODE_5_NEGATIVE_PROMPT`, and over all 60 caption sidecars:

- Word count 181–210; all inside the 80–250 bound. ✔
- All 60 prompts unique. ✔
- Every prompt contains `adult woman`, `fully opaque`, and `intact`. ✔
- **Zero hits** against the full look-spec-v2 §4a banned list — all nine families (soft-glam,
  bronzer/contour, plastic-skin, lip, brow/lash, styling-signature, body, light, age),
  word-boundary matched, in both the positive prompts and the negative prompt. ✔
- **Zero hits** against an independently chosen unsafe-term list (nude/naked/topless/
  lingerie/bikini/see-through/sheer/cleavage/erotic/sexy/sexual/explicit/nsfw). ✔
- **Zero bare numerals** anywhere in any prompt (§4c's "never a bare age numeral" and the
  §4a `18`/`19` ban both hold). Age is carried as `"in her early twenties, about twenty-one"`
  plus two §4c adult markers ("an adult woman's proportions and an adult woman's frame",
  "her hands and neck read the same age as her face"). ✔
- **Zero mid-sentence capitalized tokens** across all 60 prompts — no real person's name,
  handle, brand, or institution appears. `persona.yaml`'s Instagram `handle` and
  `account_ref` are `null`; `disclosure_verification` and `readiness_record` are
  `unverified`. No operator data was invented. ✔
- Wardrobe is clothed-only across all 60 cells (corset-bustier, cami-chains, oversized-tee,
  knit-cardigan, going-out-mini), each rendered as "fully opaque, intact". ✔
- `NODE_5_NEGATIVE_PROMPT` is identical in all six manifests and reads:
  `"nudity, exposed breasts, exposed genitals, transparent clothing, broken clothing,
  unnatural body proportions, heavy visible makeup, plastic-looking skin, studio product
  photograph."` It keeps the safety-exclusion intent while naming **no** §4a family — the
  composite-02 wording ("childlike", bronzer/contour, "studio glamour photograph") is gone,
  as §4a's own negation rationale requires. ✔
- Captions are prefixed `provisional_generation_caption:`, describe visible clothed facts
  only, claim no safety verdict, and are clean of every banned/unsafe term. ✔

---

## 7. Safety schema, lifecycle, and gates

- `qa_stamp.py` requires all three safety axes on **every** ruling. A missing, `null`, or
  out-of-enum `adult_read` / `garment_integrity` / `real_person_resemblance` raises inside
  `_safety_states` **before** any atomic write; a legacy ruling with no safety axes fails
  closed. `classify` validates safety first, even when the quality outcome alone would
  already be `parked`. ✔
- `review_status` stays orthogonal to safety: a safety failure sets `safety_failed` /
  `safety_reasons` and never forces `parked`. A parked item remains scored. ✔
- Enums match design §2.4a exactly (`pass|ambiguous|fail`, `pass|fail`, `clear|flag`) and
  `_SAFETY_FAIL_VALUES` trips on anything but the named ok value. ✔
- A ruling naming an unknown `image_id` hard-errors instead of fabricating an entry. ✔
- `batch_state.next_state` never promotes, culls, or quarantines from a raw score. The
  **only** automated quarantine is `score["face_detected"] is False` from `scored`; every
  other quarantine requires a human ruling's `safety_failed`. `scored → approved` with
  `gate_current` raises. `quarantined` is terminal; `approved/scheduled/posted/measured`
  are refused by this reducer. `culled → curated` and `curated + gate_current → approved`
  are the only re-entry paths. All match the §2.4 table edge-for-edge. ✔
- `BATCH_STAGES = ("building","generated","scored","awaiting-eye-gate-a","gate-a-ruled")`
  exists; `mark_batch_stage` is strictly forward-only one step at a time and raises on skip,
  repeat, or backward move **before** any write. `new_batch` starts at `"building"`. ✔
- `record_pod_run` is append-only — a duplicate `shard_id` hard-errors, never overwrites. ✔
- `apply_batch` reads into a fresh object and only reaches `os.replace` after `transform`
  returns; a raising transform leaves the file untouched. ✔
- `gates.py::write_gate` accepts exactly `verified|parked`, requires a non-empty human
  `decided_by` and `decided_at`, hashes the subject at write time, and writes atomically.
  `gate_is_current` re-hashes the live subject and returns `False` when the subject has
  changed or is missing — **stale-gate rejection after subject mutation is real and
  tested**. `approval_token_ref` is an opaque pointer, never a secret. ✔
- `build_grading_board.py` renders a fixed, unconditional `ALL_SEVEN_AXES` legend on every
  card and writes no ruling. `blind_pool.py`'s reveal taxonomy now covers all seven axes and
  scans `safety_reasons` unconditionally (correct, since safety is orthogonal to
  `review_status`). ✔
- `identity_check.py --raw-only` writes observations only, never `rulings.json`, and its
  report carries `mode: "raw-only"` with no pass/fail verdict. Unavailable observations are
  explicit `null` + `unavailable_reason`, never an inferred pass or a dropped key. ✔

---

## 8. Spend

Measured live at review time via the harness's own functions, against the exact ledger
directory Task 7 will pass:

```
daily_budget_state(ledger_dir='C:/Users/danie/kb-worktrees/figment/ledgers/cost')
  -> limit $10.0000, spent today $0.8726
arc_budget_state(arc_cap_usd=52.85, same dir, glob 'figment-*.tsv')
  -> cap $52.8500, spent $2.8453
```

| Guard | Value |
|---|---|
| Per-pod preflight estimate | 72 min × $0.80/hr = **$0.9600** (< `--max-usd 1.00`) |
| Six-pod worst case at the CLI cap | **$6.00** |
| Daily: today + worst case | $0.87 + $6.00 = **$6.87 < $10.00** ✔ |
| Arc: spent + worst case | $2.85 + $6.00 = **$8.85 < $52.85** ✔ |
| Arc headroom implied by `--arc-cap-usd 52.85` | exactly $50.00 fresh |

Both `daily_budget_state` and `arc_budget_state` honour `--ledger-dir`, so the Task 7 CLI
reads the figment worktree's own ledgers, which is where its rows will be written.
`repo_root()` resolves to the figment worktree, so `governance/budget.yaml` ($10.00) is the
one read. No `figment-*.tsv` exists in `dashboard-ops`, so nothing is double-counted or
missed today. The manifest rate is not trusted after create: the harness re-checks the READY
`adjustedCostPerHr`/`costPerHr` against `--max-usd`, the daily limit, and the arc cap, and a
missing, zero, invalid, or over-budget rate triggers immediate terminate-and-verify. The
effective `max_minutes` is `min(CLI 72, manifest 72, DEFAULT 840) = 72`.

**The Task 7 CLI is consistent with the manifests.** `--max-usd 1.00` exceeds the $0.96
manifest estimate; `--max-minutes 72` equals the manifest ceiling; `--arc-cap-usd 52.85`
matches the live arc total plus $50.

---

## 9. Credential boundary

`orgs/figment/pipeline/pod/` is untouched by both P1 and P2 (§1). A grep for
`RUNPOD_API_KEY|api_key|token|secret|Authorization|password|credential` across every P1/P2
Python, JSON, and YAML file returns only unrelated hits: `_validate_tokens` /
"unsupported token" in `persona.py` (grammar vocabulary), and `approval_token_ref` in
`gates.py` (documented as an opaque card pointer, never a secret). **No P1/P2 code reads,
prints, persists, copies, or transmits a credential.** The six dry runs made no network call
and created no pod against any key.

---

## 10. Findings

| # | Severity | File:line | Defect | Fix |
|---|---|---|---|---|
| 1 | MEDIUM | `orgs/figment/pipeline/train/identity_check.py` (`_evaluate_raw_only`, `out_dir.mkdir(...)` / `identity_report.json`) vs plan Step 7.5 | `--out` is an output **directory**; raw-only writes `<out>/identity_report.json`. Plan Step 7.5 passes `--out .../scores.json`, which creates a *directory* named `scores.json`. The following `batch_state.py apply --scores .../scores.json` then fails (`IsADirectoryError` → exit 1). Occurs after spend; fails loudly, never silently. | Before P3, either point `--out` at the batch directory and rename/emit `scores.json`, or add a `--scores-file` output mode. Re-run Step 7.5's expected-output assertion. |
| 2 | MEDIUM | `orgs/figment/pipeline/expand/batch_state.py::_cli_apply` × `identity_check.py::_evaluate_raw_only` (`"image_id": path.stem`) | Join-key mismatch. Harvested images are named `c001-exp02-s001.png` (harness `output_name` = `c001-<cell_id>`), so raw-only rows get `image_id = "c001-exp02-s001"`, while `batch.json` cells use `cell_id = "exp02-s001"`. `by_id.get(cell["cell_id"])` matches **0 of 60**: no cell advances `generated → scored`, and the deterministic no-face quarantine never fires. Post-spend; the plan's own expected `scored 60` makes it visible. | Strip the `c001-` prefix when keying score rows (or key by `cell_id` from the allocation) and add a test asserting a 60/60 join against a harness-shaped `manifest.json`. |
| 3 | MEDIUM | all six manifests, `job_timeout_seconds: 300` | A 3× reduction from every prior live figment manifest (composite-01/02/03 and expansion-01 all used `900`) on an **identical** graph (1024×1280, 50 steps, euler). Observed live first-job times: **260.4 s** (composite-01), 214.7 s (composite-02), 163.9 s (composite-03) — a ~13% margin over the worst observed. Any job timeout raises out of the job loop and aborts the whole shard. Not a safety or spend risk (≤$1.00 and verified teardown hold), a run-reliability risk. The 300 s value is forced by the preflight worst-case arithmetic that keeps `max_minutes` at 72 and the pod under $1.00. | Accept with eyes open, or raise `--max-usd`/`max_minutes` deliberately under a fresh spend ruling. If shard 01 aborts on job 1, treat it as this finding and stop rather than blind-retrying. |
| 4 | MEDIUM | `orgs/figment/pipeline/persona.py:237`, `:309` | `identity.spec.sha256` and `register.spec.sha256` are validated only as non-empty strings — never compared to the files' actual digests — although the module docstring (line 6) and design §2.2 both claim drift is detectable. A stale `identity-spec.md` or `look-spec-v2.md` would pass validation silently. **No live drift today:** this review recomputed both and they match (`1a969804…` and `95c54f02…`). | Compare the declared sha256 against `gates.sha256_file()` when `require_assets=True`, with a failing test for a mutated spec. |
| 5 | LOW | all six manifests, `readiness_timeout_seconds: 900` | Lower than composite-02/expansion-01's `1200`. Observed non-job time (readiness + bootstrap + teardown) was 254.6–505.8 s across three live runs, so 900 s still holds ~78% margin. Bounded failure: readiness timeout terminates and verifies. | Monitor; raise to 1200 if a shard times out during bootstrap. |
| 6 | LOW | `identity_check.py::_evaluate_raw_only` vs design §2.2 score record | The spec's score row names `anchor_cosine`, `face_px`, `ocr_text`, `garment_class`; the emitted row uses `face_cosine`, `dinov2_cohesion`, and `metrics.{laplacian_variance, clipped_highlight_fraction, local_luminance_variance}` with no `face_px` / `ocr_text` / `garment_class`. Nothing routes on any of them and `min_face_px` is `uncalibrated`, so no gate is weakened. | Reconcile names before the calibration gate that will actually consume `face_px`. |
| 7 | LOW | `identity_check.py::_raw_metrics_for_image` | Plan Step 1.4 specifies the three raw metrics are computed "on the detected face crop"; they are computed on the whole RGB frame. Honestly documented in the function's own docstring as future work pending a crop extractor. Raw observations never route anything. | Wire a real face-crop extractor alongside the scorer calibration gate. |
| 8 | LOW | repo-root `personas/` vs `.gitignore:48` | Only `personas/anchors/` is ignored. `personas/creator-001/composite-01..03/`, `personas/trial-01/`, and `personas/calibration/` hold ~20 untracked generated PNGs plus `manifest.json`/`run.json` that no rule covers, so they show in `git status`. Task 7 commits by explicit path so nothing auto-stages, but a `git add -A` would commit images against the plan's global constraint. | Add `personas/*/composite-*/`, `personas/trial-*/`, `personas/calibration/` (or `personas/**/*.png`) to `.gitignore`. |
| 9 | LOW | plan Step 6.2's `--grep='^feat(figment): add creator lifecycle and safety schemas$'` | Returns empty — P1 and P2 both landed under subjects other than the plan's prescribed messages, so the plan's own P1-pinning guard would `throw 'P1 commit not found'`. | This review pinned by SHA instead (`a1d78fdf` / `28c8988d`). Update Step 6.2 (and Task 7's references) to pin by SHA, not by exact commit subject. |
| 10 | LOW | manifest workflow node 28, `SaveImage.filename_prefix: "creator-001-expansion-01"` | Stale prefix inherited from the reference workflow. Cosmetic only: the harness downloads through `/view` and names every local file from `output_name` — the six dry runs produced `c001-exp02-*.png` as expected. | Update the prefix on the next manifest rebuild; no live impact. |
| 11 | LOW | `orgs/figment/pipeline/pod/README.md` (manifest field list) | `container_disk_gb` and `volume_gb` are honoured by `runpod_run.py`'s create payload (`containerDiskInGb`, `volumeInGb`) but are not documented in the README's field list, so a literal "keys ⊆ README keys" reading flags them. Every other manifest key is documented. Not a P1/P2 defect — pre-existing harness-doc drift. | Document both keys in `pod/README.md`. |
| 12 | LOW | `runpod_run.py::daily_budget_state` with `--ledger-dir` | The daily guard sums only `*-<today>.tsv` in the directory given, so passing the figment worktree's ledger dir means a concurrent fleet cost row written to `dashboard-ops` today would not count against the shared $10 limit. No `*-2026-09-03.tsv` exists in `dashboard-ops` at review time, so there is no undercount now. | Note in the spend card; re-check `dashboard-ops/ledgers/cost` immediately before launch. |

**Counts:** 0 critical, 0 high, 4 medium, 8 low.

---

## 11. Verdict

Every live-safety invariant holds at `28c8988d`:

- 270/270 tests pass.
- All six manifests pass strict `require_manifest`, carry only README-documented keys, and
  reproduce composite-02's proven `gpu`/`image`/`price`/`models`/`comfyui`/`custom_nodes`/
  `avoid_machine_hosts` blocks verbatim.
- Six dry runs exit 0 with verified termination, zero network calls, and zero real spend.
- Allocation is 60 unique cells, 40 strata covered exactly once, 20 half-body replicates with
  a different wardrobe family and a new seed, 10 per shard, and byte-reproducible.
- All 60 prompts and the shared negative prompt are adult-framed, clothed-only, free of every
  look-spec-v2 §4a banned term and of any bare numeral, and name no real person.
- The seven-axis rubric is mandatory and fails closed; raw scores never route; the only
  automated quarantine is deterministic no-face; gates are SHA-bound and reject stale
  subjects.
- Worst-case spend is $6.00, leaving $6.87 against the $10 daily limit and $8.85 against the
  $52.85 arc cap.
- The credential boundary is untouched by construction.

No finding is material to spend, termination, credential handling, or output safety. The two
medium code defects (findings 1 and 2) sit **after** the money is spent, in the scoring and
state-marking steps, and both fail loudly rather than silently — they will break Task 7's
Step 7.5 assertions, not weaken a gate. Finding 3 is a bounded run-reliability risk that the
operator should carry knowingly. Findings 1, 2, and 4 should be fixed before P3 is run to
completion, but none of them can cause an unsafe image, an unbounded pod, an unverified
teardown, a leaked credential, or an unapproved approval.

```
LIVE-SAFE
```

Conditions attached to the human spend decision, not to this verdict:

1. Fix findings 1 and 2 (or accept that Step 7.5 will halt and require a mid-run repair)
   before Task 7 reaches the scoring step.
2. Carry finding 3 knowingly: if shard 01's first job times out at 300 s, stop and re-rule —
   never blind-retry a live pod.
3. Re-check `dashboard-ops/ledgers/cost` for a `*-2026-09-03.tsv` immediately before launch
   (finding 12).
4. Nothing in this file is spend approval. The operator's T2 card, with the approval field
   populated, remains required before pod 1.

## Boss-verified delta after this review (2026-09-03 14:05)

Medium finding 3 (job timeout margin) acted on: `job_timeout_seconds` 300 → 360, `max_minutes` 72 → 82 in
`build_expansion_set.py` (constants only), manifests regenerated by the deterministic builder, tests updated.
Diff = 8 files / 19 lines, the two keys per manifest and nothing else (`git diff --stat` at commit). Re-verified:
expand + pod suites 201 passed; six `--dry-run` runs exit 0 with termination verified; preflight
900 + 10×360 + 300 = 4800 s ≤ 4920 s. CLI bounds for P3 become `--max-usd 1.10 --max-minutes 82`
(82 min × $0.80/h = $1.093); ceiling $6.60; daily worst case $7.47 < $10. Medium findings 1, 2, 4 are being fixed
on the scoring side before step 7.5 and do not affect pod creation.
