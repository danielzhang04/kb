# W6 — parallel-safe generation harness design (DRAFT; no build authorized)

Status: plan only, 2026-08-13. This document authorizes no API call, implementation, stamp, promotion, or spend.

## 0. Decision

Build a coordinator that derives one canonical Forge slate, partitions it into dependency-safe worker assignments, and launches the proven one-item driver loop with worker-scoped files. Keep Forge as the only slate builder/generator. Keep review, stamp, promotion, and the review-store write path outside generation workers.

Initial ceiling: **2 concurrent workers / 2 provider calls in flight**, configurable downward to 1. Do not raise it until a controlled paid-tier probe demonstrates a higher safe limit.

Source shorthands used below:

- `forge.py` = `orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py`
- `SKILL.md` = `orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md`
- `t15_gen.py` and genlogs = this directory unless otherwise stated
- `task-15-report.md` = `.superpowers/sdd/2026-08-11-bricks-taste-forensics/task-15-report.md`

## 1. Proven boundary: Forge safe, current driver unsafe

| Surface | Evidence | Design consequence |
|---|---|---|
| Output path | Forge resolves every generation target to the direct staging child `<name>.png` and rejects escaping names (`forge.py:1048-1060`). | Output `name` is the global collision key. The partition validator MUST prove names are unique before launch. |
| Reservation | Forge atomically creates `<name>.png.lock` with `O_EXCL`, records PID/token, and skips a live concurrent reservation (`forge.py:1158-1184`). | A duplicate launch cannot clobber, but a duplicate is still a planner defect and MUST fail the wave rather than be accepted as a skip. |
| Publication | Forge writes a unique `.<name>.*.png.tmp`; without `--force`, an atomic hard link refuses an already-published survivor (`forge.py:1187-1209`). Locks are released in `finally` (`forge.py:1307-1330`). | Workers MUST NOT use `--force`. Complete PNGs publish atomically; failed calls leave no intended survivor. |
| Review store | Forge fresh-reads `_staging/review.json` (`forge.py:1711-1721`). `stamp_review.py` is the only verdict writer; Forge only reads (`forge.py:1741-1747`; `SKILL.md:376-378`). | Generation waves are **read-only review-store windows**. No board/stamp process may overlap them. |
| Current driver | `t15_gen.py` writes fixed `_t15_one.json` and `t15-round{n}-results.json` (`t15_gen.py:63-69,138-141`). | Two current drivers can overwrite a one-item spec before Forge reads it and can clobber results. `t18-tranche-plan.md:104-116` therefore correctly rules the current form unsafe. |

The Forge locks are a last defence, not the partition mechanism. A correct plan contains no same-name contention.

## 2. Run layout and per-worker isolation

For run id `<run>`, wave `<Wnn>`, and zero-padded worker `<wNN>`:

```text
<scratch>/runs/<run>/
  <run>.<Wnn>.plan.json
  <run>.<Wnn>.review-store.sha256
  <run>.<Wnn>.<wNN>.spec.json
  <run>.<Wnn>.<wNN>.item-<0001>-<output-name>.spec.json
  <run>.<Wnn>.<wNN>.results.json
  <run>.<Wnn>.<wNN>.genlog.jsonl
  <run>.<Wnn>.results.merged.json
  <run>.<Wnn>.genlog.merged.jsonl
```

Rules:

1. `worker_id` is immutable within the wave and is present in every filename and every record.
2. The coordinator writes each worker spec once, computes its SHA-256, and dispatches that digest. Workers never edit the parent spec.
3. A worker writes only its own item specs, result, and log. Item specs use `CREATE_NEW`; an existing path is a hard collision.
4. Each assigned output has exactly one hard staging slot: `<kit>/_staging/<output-name>.png`. The corresponding eventual promotion slot is recorded but is not writable by the worker.
5. Worker logs are JSONL, one flushed record per attempt. There is no shared append file.
6. No worker receives stamp/register/promote authority. No worker edits `shots.json`, manifests, registry, or `_staging/review.json`.

### Review-store read mode

Before dispatch, the coordinator:

- completes all required prior stamps;
- records SHA-256 of `<kit>/_staging/review.json` in `<run>.<Wnn>.review-store.sha256`;
- closes the stamp phase and opens the generation read window.

Every worker records that expected digest. The coordinator re-hashes the store before merge. A changed digest is `HALT-INTEGRITY`; results remain staged but are not reviewed or promoted until the race is reconciled. This is required because Forge fresh-reads rather than holding a reader snapshot (`forge.py:1711-1721`).

### Genlog merge

After all workers return, the coordinator validates every JSONL line, rejects duplicate `(output_name, attempt_no)` keys, and merges deterministically by:

```text
(wave_ordinal, dependency_depth, partition_ordinal, item_ordinal, attempt_no)
```

Timestamps remain fields but never determine semantic order. The merged spend is the sum of validated per-attempt records; worker summaries are not trusted as the only accounting source. A worker log is never rewritten during merge.

## 3. Partitioning law

### 3.1 Authoritative input

1. Build the full or explicitly scoped slate only with `forge.py batch --batch <shots.json> --out <spec>`; this path is $0 and cannot load a key or URL (`forge.py:3112-3115`). Hand-built scene specs are forbidden (`SKILL.md:192-208`).
2. Run `forge.py gen --dry-run --batch <spec>` and retain the assembled-prompt/preflight evidence (`SKILL.md:188-190`).
3. Refuse partitioning if the builder reports any in-scope asset/review/seed blocker. Forge deliberately collects the whole blocker list before spec write (`forge.py:2037-2052,2429-2439`).
4. Freeze the canonical spec by SHA-256. Worker specs are ordered subsets; item bytes are copied, not re-derived.

### 3.2 Dependency graph

Create a graph whose node is one spec `name` and whose edges are generated seed dependencies. Annotate each node with shot/card id, place, stage, stage role, parent depth, lineage, seed roles, output slot, and expected reference digests.

Partition units are connected **stage-chain components**, not individual shots:

- a standalone/root/card is a one-node component;
- a stage base plus all of its deltas is one component for ownership purposes;
- a delta chain is never split across workers, even across later waves;
- the same component retains one `worker_id` for its lifetime;
- a stage boundary is the only legal partition boundary, matching the skill law that a held stage never splits (`SKILL.md:323-335`).

Forge caps a stage at one base plus at most two deltas (`forge.py:2020-2026`; `SKILL.md:246-261`). A graph that exceeds that limit is an authoring blocker, not a scheduling problem.

### 3.3 Pre-approved-seed frontier

Partition only nodes whose external dependencies are already approved and digest-current:

- cast canonical, crowd exemplar, pose/expression/interaction primitive, prop, place plate, lettering/stamp/style exemplar: approved W1 asset;
- STEP-1 figure card: approved W2 asset;
- chain parent or same-place anchor: approved and promoted in an earlier scene wave.

No worker may mint a substitute, change a reference, or fall back to a different plate. Forge itself requires roughly one board/stamp round per chain depth (`forge.py:1268-1275`), and the skill refuses missing, failed, or stale review records (`SKILL.md:357-362,380-400`). Therefore a node whose parent is generated in the current wave moves to the next wave; it does not run later in the same worker process.

Place/root prerequisites are scheduled before dependants. The dependency evidence in `t18-tranche-plan.md:74-102` demonstrates why: L112, L198, L84/L86 and other roots block multiple later tranches. Cross-place image seeding remains a hard refusal (`SKILL.md:137-148`; `forge.py:2100-2116`).

### 3.4 Deterministic split

Given ceiling `K`:

1. Sort ready components by descending request count, then first canonical shot order, then component id.
2. Greedily assign each whole component to the currently lightest worker; ties go to lowest worker id.
3. Load is provider-request count, not shot count; STEP-1 cards count separately.
4. Validate global uniqueness of `output_name`, staging slot, and promotion slot.
5. Validate that every internal delta edge stays inside one worker and every external edge points to a prior approved digest.
6. Emit the plan only if all nodes are assigned exactly once and the sum of worker budgets is within the remaining global hard stop.

This balances wall time without interleaving delta lineage or trading precision for throughput.

## 4. Worker failure and spend semantics

The worker processes items serially and invokes one-item Forge batches, preserving the isolation rationale in `t15_gen.py:8-23` and `task-15-report.md:33-38`.

### 4.1 Exact laws

| Event | Required behavior | Final item status |
|---|---|---|
| Success | Validate complete staged PNG; record SHA-256 and elapsed time. | `OK` |
| Existing/reserved output | Treat as assignment collision unless the plan explicitly marks approved reuse. Never silently claim it. | `HALT-COLLISION` |
| Stall | At 240 s, terminate that Forge process; issue **one unchanged re-issue**. A second stall parks the item. (`t15_gen.py:40,73-76,116-122`; observed in `remint-genlog.md:23-25`.) | `PARK-STALL` |
| HTTP 503 / `UNAVAILABLE` | Forge has already exhausted its internal retries. Track consecutive 503 outcomes per worker. At the second consecutive 503, park that item; later items may continue, exactly as the serial law states (`t15_gen.py:91-92,123-129`). No prompt mutation. | first `503`; second+ `PARK-503` |
| Other mechanical no-image | One unchanged re-issue only when its assigned attempt allowance includes it; never a content rewrite. | `PARK-MECHANICAL` if exhausted |
| Seed/review/integrity refusal | No API retry. Stop that worker: the immutable preflight or review frontier has changed. | `HALT-INTEGRITY` |
| Billing/quota 429 | If the body identifies `RESOURCE_EXHAUSTED`, plan/billing, free-tier, or `limit: 0`, do not re-issue and stop launching new work globally. In-flight calls may finish and report. | `HALT-BILLING` |
| Budget lease exhausted | Make no call. | `HALT-BUDGET` |

The billing halt closes a gap in the task-15 driver: it classified the response only as `FAIL`, so all seven cards reached the same permanent refusal. The report and genlog prove the condition was plan-level, not transient: `limit: 0`, 6/6 identical 429s, and $0 billable (`task-15-report.md:42-66,95-98`; `tranche-genlog.md:84-108`). The worker must never attempt to repair billing or inspect/print credentials (`task-15-report.md:68-73`).

### 4.2 Global spend guard under parallelism

Before launch, the coordinator assigns each worker an immutable `budget_usd` and `max_provider_attempts`, including allowed mechanical re-issues. The sum of leases MUST be `<= remaining_hard_stop`. A worker checks its lease before every provider call. Unused lease returns only after the result is accepted.

Record both `provider_calls` and `billable_outputs`. Use the run's approved per-resolution rate; 4K is never implicit and requires a Pass-1 spend ruling (`SKILL.md:150-161`). Dry build/preflight remains $0. This converts the printed-but-not-enforced task-15 hard stop (`t15_gen.py:40-42,107-110,138-141`) into an actual parallel-safe ceiling.

### 4.3 Structured result schema

Each worker returns exactly:

```json
{
  "schema": "image-gen-worker-result@1",
  "run_id": "...",
  "wave_id": "W03",
  "worker_id": "w01",
  "status": "complete|partial|halted",
  "worktree": "...",
  "input_spec": {"path": "...", "sha256": "..."},
  "review_store_sha256": "...",
  "started_at": "ISO-8601",
  "finished_at": "ISO-8601",
  "budget": {
    "rate_usd": 0.039,
    "hard_cap_usd": 0.0,
    "max_provider_attempts": 0,
    "provider_calls": 0,
    "billable_outputs": 0,
    "estimated_spend_usd": 0.0
  },
  "items": [{
    "item_ordinal": 1,
    "shot_id": "L01",
    "card_id": null,
    "output_name": "L01",
    "staging_slot": "<kit>/_staging/L01.png",
    "promotion_slot": "<video>/assets/scenes/L01.png",
    "chain_id": "place/stage",
    "dependency_depth": 0,
    "references": [{"role": "figure|canonical|pose|expression|place|crowd|prop|style-anchor", "path": "...", "sha256": "..."}],
    "attempts": [{"attempt_no": 1, "elapsed_s": 0.0, "outcome": "OK|STALL|503|429|ERR", "provider_code": null, "billable": false}],
    "final_status": "OK|PARK-STALL|PARK-503|PARK-MECHANICAL|HALT-BILLING|HALT-BUDGET|HALT-INTEGRITY|HALT-COLLISION",
    "staged_sha256": null,
    "suspected_mechanism_layer": null,
    "deviation_flags": []
  }],
  "genlog_segment": "<run>.<W03>.<w01>.genlog.jsonl",
  "worker_deviation_flags": []
}
```

`deviation_flags` is non-empty for any assignment/reference/output/status mismatch. Error text is sanitized: no request URL, key, environment value, or credential-bearing payload.

## 5. Concurrency ceiling

Recommendation: **2**, with one provider call at a time per worker.

Evidence and limits:

- Two chunk processes overlapped from 16:45; together they produced 21/24 outputs, with three isolated `no image` failures that each cleared on one re-issue (`../sweep-genlog.md:94-116`). This is evidence for two-way concurrency, not four-way concurrency.
- A separate serial probe saw 7/8 attempts return 503 high-demand responses (`../probe-genlog.md:218-235`). Provider availability can collapse without concurrency being the cause, so 503s require parking rather than more fan-out.
- Task 15 saw `429 RESOURCE_EXHAUSTED`, free-tier daily `limit: 0`, 6/6 over six minutes (`task-15-report.md:42-66`; `tranche-genlog.md:87-108`). That is a **zero-capacity billing state**, not an RPM concurrency limit; the only correct ceiling then is zero.
- No checked evidence states the paid project's formal RPM/TPM limit. Do not invent one.

Promotion rule: after a controlled run completes two full waves at ceiling 2 with no systemic 429/503 wall and no staging/store race, the boss may authorize a measured 3/4-worker probe. Until then, `K=2` is the hard maximum.

## 6. Minimal implementation footprint after approval

### `t15_gen.py`: minimal, backward-compatible parameterization

Do not rewrite its sequencing or stop laws. Add only injectable paths/metadata:

- `--spec`, `--worker-id`, `--item-spec-dir`, `--results`, `--genlog`, `--budget-usd`, `--max-attempts`;
- an entry point that accepts an already-partitioned ordered item list instead of the act-1-only `DELTAS` split;
- machine-readable classification for 429/billing and integrity/collision outcomes;
- enforce the assigned budget lease before each call.

Its current act-1 CLI/default filenames remain valid for reproduction.

### New files

- `parallel_gen.py`: $0 coordinator only — build/freeze spec, derive dependencies, partition, allocate budget, spawn workers, issue global billing stop, validate/merge returns. It never calls the image provider itself and never stamps/promotes.
- `parallel_gen_worker.py`: thin adapter around the parameterized `t15_gen.py` item loop. It validates the dispatch envelope and writes only worker-scoped files; no seed selection or prompt authoring lives here.

Do **not** fork or rewrite Forge. It remains the sole builder, preflight, reservation, provider-call, and atomic-publication mechanism (`SKILL.md:8-12,192-208`; `forge.py:1212-1215,1307-1330`).

## 7. Boss rulings required before build

1. Ratify `K=2` as the initial hard ceiling, or authorize a separately budgeted 3/4-worker probe.
2. Ratify global first-429 billing halt (recommended) rather than reproducing task 15's seven identical failures.
3. Choose the canonical merged-log home: run-local scratch only, or a later durable video genlog after the design is proven.
4. Confirm whether budget leases reserve all allowed re-issues up front (safest) or use a coordinator-granted retry lease (less idle reserve, more synchronization).
