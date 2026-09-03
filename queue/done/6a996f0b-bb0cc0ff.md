---
schema-version: 1
id: 6a996f0b-bb0cc0ff
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p2
risk-tier: T1
owner: codex-worker
claim-token: ae7c4fc3ebcd929a
state: done
approval: null
workflow: 01a06755-67f0-7ae1-9029-91863be3f4e6
depends-on: []
variant-group: null
role: work
session-id: 6a996dce-f4e63d19
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 0d9b93ef1435fcc7092e1a4fd902a941f5a6d3e9
---

## Work order

You are a codex BUILDER in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p2` (branch `claude/prospecting-p2`).
Run `python scripts/preamble.py` once (expect PREAMBLE OK). Host facts: `py -3` =
C:\Users\danie\AppData\Local\Programs\Python\Python313\python.exe (3.13.7), SQLite 3.50.4,
Datasette 0.65.1 preinstalled. NEVER commit, never touch git refs, never pip install, never
run repo-wide grep, never read memory/, queue/, ledgers/, orgs/faceless-youtube/, dashboard/.
Stop at 50 minutes and report what is done and what is not. First edit by command 8.

\# Build brief — Task 0

\## READ BUDGET (closed list)
- This brief (the task is reproduced in full below; the plan file is NOT to be re-read).
- Spec §Data and "### P1" of `docs/superpowers/specs/2026-09-02-prospecting-design.md` ONLY if
  the task text references a spec field you need to check; ≤150 lines.
- Files produced by earlier tasks that this task's **Consumes** block names (read those files only).
- `pytest.ini`.

\## Interfaces produced by earlier tasks (authoritative names/signatures)
(first task — none)

\## Plan header and global constraints (binding)
\# Prospecting P2 Implementation Plan
> **For agentic workers:** execute task-by-task; each task ends with a reviewable, tested deliverable.
  Workers NEVER commit — they report; the boss commits after review. Steps use `- [ ]` checkboxes.

**Goal:** Build P2's desktop-local list builder: five bounded finder lanes, deterministic capability planning and eligibility, immutable provenance, guarded enrichment and snapshot fetching, resumable list assembly, and a fail-closed phase gate (at least 58 P2 tests enumerated in the manifest plus exactly 10 draft eval cards). P2 extends the immutable P1 inventory; it never replaces it.

**Architecture:** `scripts/prospecting/` remains the single owning subsystem. P2 adds lane, provider, cleaning, scoring, browser-guard, fetcher, bake-off, and orchestration modules around P1's SQLite store and executor boundary. All live browser and vendor work is requested through the executor; tests inject fixture transports and clocks. The list-builder writes desktop-local list tables and returns only opaque IDs, typed result codes, and counts. The requested component names live beside the spec-owned `finder_*` entry points: `capture.py` contains intake primitives used by `finder_manual.py`, `linkedin_lane.py` contains the assisted-lane engine used by `finder_linkedin.py`, and `lanes/__init__.py` owns the protocol and registry used by `finder_base.py`; no behavior is duplicated.

**Tech Stack:** Python 3.13.7 via `py -3`; SQLite 3.50.4; pytest 9.1.1; Python standard-library modules; and Playwright for Python `playwright==1.49.1` with installed real Chrome `channel="chrome"`. Before Task 0, the boss—not a worker—installs only the pinned Python package with `py -3 -m pip install playwright==1.49.1`; P2 does not install bundled Chromium because its live path launches installed Chrome. Tasks perform no package installation.

**Spec:** `docs/superpowers/specs/2026-09-02-prospecting-design.md` (§Finder lanes, §Enrichment, §P2)

\## Global Constraints

> **PII law:** names, emails, phones, profile URLs, person notes, source excerpts, and message bodies never enter git or any VM sink, including process arguments, stdout/stderr, logs, cards, ledgers, or exception text. They may exist only in enumerated desktop-local stores: SQLite, the dedicated Chrome user-data-dir, and the snapshot directory. Cards carry opaque IDs, counts, typed policy, and result codes. Desktop logs redact these classes. The repo pre-commit hook rejects email, phone, and LinkedIn profile-URL patterns outside explicit synthetic fixtures; structured runtime guards reject/redact all seven classes before any VM sink.

> No live vendor or LinkedIn calls in any test: every adapter has a recorded-fixture mode (`KB_PROSPECTING_NO_NETWORK=1` → adapters read from `orgs/prospecting/fixtures/vendor/<provider>/*.json`); the LinkedIn lane is tested against a local static HTML fixture served from disk (`file://`), never linkedin.com.

> One non-agent `executor` process is the only process that holds Gmail send/draft credentials and vendor credentials. Agents have no raw Gmail or vendor operation in their tool declarations. They insert a typed `exec_request` row; the executor validates its schema, caller permission, policy, approval, caps, suppression, idempotency, credit, current external state, and every other executable hook applicable to the operation before acting. Requests cannot carry credentials or arbitrary commands.

> Self-owned assisted LinkedIn: 40 **successful profile loads per rolling 24 h**, sequential only, independently sampled 45–120 s between loads, session ≤30 min; hard stop on any checkpoint; no automatic increase.

> Apollo and Crunchbase are not adapters. Dealroom/Harmonic are not initial lanes. No class-B cookie-custody service may connect.

> Adapters implement timeouts, bounded retry, idempotency, normalized error codes, declared integer `max_cost`, credit reporting, and the common attempt ledger. Agents enqueue opaque typed requests; only the executor imports or calls adapters. It atomically reserves `max_cost`, settles actual cost, or releases the reservation.

> The runner fails unless it collects the phase's minimum inventory enumerated in `scripts/prospecting/gate_manifest.json`, runs every manifest entry successfully, runs with zero skips/xfails, observes the exact fixture set, detects no modified/untracked path outside that phase's artifact allowlist, and meets every numeric criterion. A missing or failing manifest test, or any skip/xfail, fails the gate. It emits one PII-free JSON summary and exits 0 only on full pass; unknown tests, fixtures, artifacts, or warnings are failures.

The LinkedIn action set is read-only: search results, profile pages, and company pages only; never connect, message, follow, like, react, post, download, export, change account settings, access cookies/tokens, or solve/bypass a checkpoint. The dedicated user-data-dir is `%LOCALAPPDATA%\kb-outreach-chrome`. `policy.lanes` must explicitly contain `linkedin_assisted`; the feature is off by default. `KB_PROSPECTING_NO_NETWORK=1` is fail-closed: no socket, DNS, HTTP, vendor, or LinkedIn call may occur. PDL is capped at 100 records per rolling calendar month and its Pro path is disabled. Every vendor operation reserves declared `max_cost` before the call and settles actual cost or releases on no-charge failure. Approximate predicates require Daniel's bound override; unsupported predicates reject; no lane may relax a predicate or raise a cap. Summaries contain counts and opaque identifiers only and pass P1 `assert_vm_safe`.

\## File Structure

- `scripts/prospecting/lanes/__init__.py` — `Lane` protocol, plans/batches, registry, capability matrix, cursor persistence, yields, and shortfall selection.
- `scripts/prospecting/finder_base.py` — stable spec-owned imports for the lane primitives.
- `scripts/prospecting/capture.py` and `finder_manual.py` — URL/CSV normalization and the manual lane entry point.
- `scripts/prospecting/finder_pitchbook.py` — documented PitchBook export mapping and quarantined import.
- `scripts/prospecting/providers/base.py` — common vendor and email-finder result contracts plus executor-only budget transaction.
- `scripts/prospecting/finder_pdl.py` — PDL spot adapter and monthly free-tier limiter.
- `scripts/prospecting/finder_apify_public.py` — cookieless Apify `atomus/linkedin-profile-scraper` class-C adapter for preselected URLs.
- `scripts/prospecting/providers/hunter.py` and `providers/snov.py` — recorded-fixture email find/verify adapters.
- `scripts/prospecting/bakeoff.py` — blind, hash-only Hunter/Snov comparison.
- `scripts/prospecting/scorer.py` — cleaning, dedupe/conflict review, staleness, fit score v1, and eligibility writes.
- `scripts/prospecting/browser_guard.py`, `linkedin_parsers.py`, `linkedin_lane.py`, and `finder_linkedin.py` — read-only headed persistent-context lane and its pure parsers.
- `scripts/prospecting/fetcher.py` — deterministic allow-listed public-page snapshots with exact 30-day retention.
- `scripts/prospecting/list_builder.py` — resumable lane→enrich→clean→score→list job and counts-only summary.
- `scripts/prospecting/tests/test_finder_lanes.py`, `test_provider_budget.py`, `test_bakeoff.py`, `test_browser_guard.py`, `test_fetcher.py`, `test_list_builder.py`, `test_capability_surface.py`, and `test_p2_prerequisite.py` — at least 58 P2 tests, with every collected node ID enumerated in the manifest.
- `scripts/prospecting/p2_p1_contract.py` and `p2_schema.py` — checked P1 contract and bounded P2 provider-enum migration.
- `orgs/prospecting/fixtures/finder-pages.json`, `linkedin-checkpoint.html`, `snapshot-injection.html`, and `bakeoff-50.json` — P2 synthetic fixtures actually opened by tests; every opened nested vendor fixture under `fixtures/vendor/{pdl,apify,hunter,snov}/` is also enumerated.
- `agents/prospecting-list-builder.md`, `skills/imported/prospecting-list-builder/SKILL.md`, and `evals/agents/prospecting-list-builder/` — least-privilege declaration, imported skill, and exactly ten factory-owned draft eval cards.
- `scripts/prospecting/gate_manifest.json` — preserved P1 phase inventory plus the P2 artifact allowlist, exact opened-fixture inventory, every collected P2 node ID, ten eval cards, and independently recomputed criteria. P1's `gate.py` is unchanged.

\## YOUR TASK (execute every step in order; TDD; run the exact commands)
\### Task 0: Prove the immutable P1 prerequisite

**V2 inventory rule:** P2 adds `scripts/prospecting/p2_p1_contract.py` and `scripts/prospecting/tests/test_p2_prerequisite.py`; the eight P2 test files contribute at least 58 tests, all enumerated. The exact fixture inventory contains only fixtures opened by those tests, including every nested vendor JSON file. P1's phase entry and hashes remain present byte-for-byte in the multi-phase manifest.

**Files:** Read only `scripts/prospecting/gate_manifest.json` and the public P1 modules named by the Interfaces blocks; create `scripts/prospecting/p2_p1_contract.py` and `scripts/prospecting/tests/test_p2_prerequisite.py`; modify no P1 artifact.

**Interfaces:** Consumes P1 `load_manifest(path)`, `main(argv)`, and the manifest's phase-scoped inventory / Produces a fail-closed prerequisite result and a checked snapshot of every P1 signature and schema column consumed by Tasks 1-11.

- [ ] **Step 1 - Write the failing prerequisite tests (full file).**

```python
\# scripts/prospecting/tests/test_p2_prerequisite.py
import inspect
from pathlib import Path

from scripts.prospecting import store
from scripts.prospecting.gate import load_manifest

ROOT = Path(__file__).resolve().parents[3]

EXPECTED_SIGNATURES = {
    "open_store": "(path: pathlib.Path | None = None) -> sqlite3.Connection",
    "reserve_credit": "(connection: sqlite3.Connection, reservation: scripts.prospecting.store.CreditReservation) -> bool",
    "settle_credit": "(connection: sqlite3.Connection, reservation_id: str, actual_cost: int, settled_at: str) -> str",
    "release_credit": "(connection: sqlite3.Connection, reservation_id: str, released_at: str) -> None",
    "select_lanes": "(policy, capabilities, overrides, campaign_id: str, policy_hash: str) -> tuple[str, ...]",
    "insert_exec_request": "(connection, request, campaign_tier: str) -> None",
}

EXPECTED_COLUMNS = {
    "finder_cursor": ("finder_run_id", "lane", "cursor", "processed", "yielded", "capability_version", "updated_at"),
    "credit_reservation": ("reservation_id", "campaign_id", "provider", "exec_request_id", "max_cost", "actual_cost", "state", "created_at", "settled_at"),
    "provider_attempt": ("attempt_id", "person_id", "provider", "call", "input_hash", "priority", "credits", "result", "started_at", "finished_at", "raw_response_ref"),
    "source_snapshot": ("snapshot_id", "entity_id", "source_url", "source_domain", "retrieved_at", "content_type", "content_sha256", "allowlist_version", "body_ref", "expires_at", "retention_delete_at"),
    "exec_request": ("request_id", "caller", "operation", "payload", "policy_hash", "approval_id", "created_at", "claimed_at", "state", "reason"),
}

def p1_phase(manifest):
    return manifest["phases"]["P1"] if "phases" in manifest else manifest

def test_p1_manifest_inventory_is_enumerated_and_not_hard_coded():
    p1 = p1_phase(load_manifest(ROOT / "scripts/prospecting/gate_manifest.json"))
    assert p1["tests"]
    assert len(p1["tests"]) >= int(p1["criteria"]["tests"])
    assert len(p1["tests"]) == len(set(p1["tests"]))

def test_p1_manifest_proves_every_consumed_safety_invariant():
    p1=p1_phase(load_manifest(ROOT / "scripts/prospecting/gate_manifest.json"))
    names="\n".join(p1["tests"]).casefold()
    required=("wal_two_writer","datasette_reads","datasette_rejects_writes","export_no_reimport",
        "override_cli_audit","shared_policy_hash","approval_hash_resolution","audit_append_only",
        "pii_class_sink_matrix","precommit_encoded_pii","executor_rejects_raw_capability")
    assert all(fragment in names for fragment in required)
    fixture_names={Path(path).name for path in p1["fixtures"]}
    assert {"synthetic.json","pii-cases.json","conflicting-providers.json","job-change.json"} <= fixture_names

def test_p1_public_signatures_consumed_by_p2_are_exact():
    actual = {name: str(inspect.signature(getattr(store, name))) for name in EXPECTED_SIGNATURES}
    assert actual == EXPECTED_SIGNATURES

def test_p1_schema_columns_consumed_by_p2_are_exact(tmp_path):
    db = store.open_store(tmp_path / "p1-contract.sqlite")
    actual = {
        table: tuple(row[1] for row in db.execute(f"PRAGMA table_info({table})"))
        for table in EXPECTED_COLUMNS
    }
    assert actual == EXPECTED_COLUMNS
```

- [ ] **Step 2 - Run the immutable P1 gate and prerequisite tests.** Run `py -3 -m scripts.prospecting.gate --phase P1` and then `py -3 -m pytest scripts/prospecting/tests/test_p2_prerequisite.py -q`. Expected: the gate exits `0`, reports the current manifest-enumerated P1 test total with zero skips/xfails/warnings and the exact P1 artifact hashes; the tests initially fail until the asserted signature strings exactly match the built P1 annotations. Never hard-code an old P1 test count.

- [ ] **Step 3 - Record the checked P1 contract without modifying P1 (full file).**

```python
\# scripts/prospecting/p2_p1_contract.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

@dataclass(frozen=True)
class P1Contract:
    signatures: Mapping[str, str]
    columns: Mapping[str, tuple[str, ...]]

P1_CONTRACT = P1Contract(
    signatures={
        "open_store": "(path: pathlib.Path | None = None) -> sqlite3.Connection",
        "reserve_credit": "(connection: sqlite3.Connection, reservation: scripts.prospecting.store.CreditReservation) -> bool",
        "settle_credit": "(connection: sqlite3.Connection, reservation_id: str, actual_cost: int, settled_at: str) -> str",
        "release_credit": "(connection: sqlite3.Connection, reservation_id: str, released_at: str) -> None",
        "select_lanes": "(policy, capabilities, overrides, campaign_id: str, policy_hash: str) -> tuple[str, ...]",
        "insert_exec_request": "(connection, request, campaign_tier: str) -> None",
    },
    columns={
        "finder_cursor": ("finder_run_id", "lane", "cursor", "processed", "yielded", "capability_version", "updated_at"),
        "credit_reservation": ("reservation_id", "campaign_id", "provider", "exec_request_id", "max_cost", "actual_cost", "state", "created_at", "settled_at"),
        "provider_attempt": ("attempt_id", "person_id", "provider", "call", "input_hash", "priority", "credits", "result", "started_at", "finished_at", "raw_response_ref"),
        "source_snapshot": ("snapshot_id", "entity_id", "source_url", "source_domain", "retrieved_at", "content_type", "content_sha256", "allowlist_version", "body_ref", "expires_at", "retention_delete_at"),
        "exec_request": ("request_id", "caller", "operation", "payload", "policy_hash", "approval_id", "created_at", "claimed_at", "state", "reason"),
    },
)

def assert_p1_contract(actual_signatures, actual_columns) -> None:
    if dict(actual_signatures) != dict(P1_CONTRACT.signatures):
        raise RuntimeError("p1_signature_mismatch")
    if dict(actual_columns) != dict(P1_CONTRACT.columns):
        raise RuntimeError("p1_schema_mismatch")
```

- [ ] **Step 4 - Re-run and confirm PASS.** Run `py -3 -m scripts.prospecting.gate --phase P1` and `py -3 -m pytest scripts/prospecting/tests/test_p2_prerequisite.py -q`. Expected: both exit `0`; the gate reports the current enumerated P1 total, exact artifact hashes, and zero skips/xfails/warnings.

- [ ] **Step 5 - Report, NO commit.** Report the P1 gate JSON keys, manifest-derived test count, artifact hash count, checked signature names, checked table/column tuples, and captured empty test streams. Stop immediately on any mismatch and do not modify a P1 artifact.

\## Report format (final message)
1. Files created/modified (paths). 2. Test command run + exact pass/fail counts. 3. Manifest
entries added. 4. Deviations from the task text and why (none is the expected answer).
5. Anything you could not finish. No prose beyond that.

## Result

1. Files created/modified: `scripts/prospecting/tests/test_p2_prerequisite.py`.

2. Test command run + exact pass/fail counts:
   - `py -3 -m scripts.prospecting.gate --phase P1` — failed (`passed=0`, `failed=1`, `skipped=0`, `xfailed=0`, `warnings=0`).
   - Prerequisite pytest command not run; stopped on gate mismatch. Test streams: none.

3. Manifest entries added: none. Manifest-derived P1 tests: 96; artifact hashes: 24. Gate JSON keys: `child_processes_without_guard`, `error_codes`, `errors`, `external_network_calls`, `failed`, `failed_nodes`, `inspector_score`, `interpreter_path_sha256`, `passed`, `phase`, `skipped`, `status`, `warnings`, `xfailed`.

4. Deviations from the task text and why: stopped before creating `p2_p1_contract.py` because P1 gate reported missing inspector score, runtime prerequisite mismatch, and changed path outside P1 allowlist.

5. Anything you could not finish: contract module, prerequisite pytest, and passing re-run.
