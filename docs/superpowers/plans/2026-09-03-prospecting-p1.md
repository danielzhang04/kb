# Prospecting P1 Implementation Plan v2
> **For agentic workers:** execute task-by-task; each task ends with a reviewable, tested deliverable.
  Workers NEVER commit — they report; the boss commits after review. Steps use `- [ ]` checkboxes.

**Goal:** Build P1’s desktop-local, typed prospecting foundation with a complete SQLite store, deterministic executor boundary, PII controls, read-only inspection, one-way export, and a fail-closed gate over at least 49 enumerated test functions.

**Architecture:** All PII and credentials remain on Daniel’s Windows desktop in the enumerated local stores; VM-facing surfaces exchange only opaque IDs, typed policy, counts, and result codes. `scripts/prospecting/` owns the SQLite repository, deterministic executor, guards, CLI/export/view scripts, and phase gate, while the project scaffold documents the conservative autonomy boundary. Agents enqueue typed `exec_request` rows, but only the non-agent executor may hold credentials or eventually reach external adapters; P1 enables no live adapter.

**Tech Stack:** Host Python 3.13.7 resolved once from `py -3 -c "import sys;print(sys.executable)"`; SQLite 3.50.4; pytest 9.1.1 with `pytest.ini` addopts `-m "not slow"`; preinstalled Datasette 0.65.1 and setuptools 80.10.2; PowerShell and Git Bash on Windows; Python standard-library `sqlite3`, `dataclasses`, `json`, `csv`, `hashlib`, `re`, `subprocess`, `socket`, and `urllib`.

**Spec:** docs/superpowers/specs/2026-09-02-prospecting-design.md (§Data, §P1)

## Global Constraints

**PII law:** names, emails, phones, profile URLs, person notes, source excerpts, and message bodies never enter git or any VM sink, including process arguments, stdout/stderr, logs, cards, ledgers, or exception text. They may exist only in enumerated desktop-local stores: SQLite, the dedicated Chrome user-data-dir, and the snapshot directory.

P1 ships Datasette bound to localhost and read-only. Tailnet phone access is outside P1–P6.

One non-agent `executor` process is the only process that holds Gmail send/draft credentials and vendor credentials.

Repository routing remains binding during the build. Because prospecting is new, Task 1 writes `orgs/prospecting/STATE.md` in the work tree as a work-product DRAFT. The boss creates the ops copy at gate close. The gate checks the work-tree DRAFT exists and passes the PII guard; it never reads the ops ref.

No deferred-work markers or incomplete implementation language may appear in a delivered P1 artifact.

The runner fails unless it collects the phase's minimum inventory enumerated in `scripts/prospecting/gate_manifest.json`, runs every manifest entry successfully, runs with zero skips/xfails, observes the exact fixture set, detects no modified/untracked path outside that phase's artifact allowlist, and meets every numeric criterion.

Numeric pass: at least 48 enumerated test functions; all migrations/FKs/CHECKs and required cross-row triggers; one two-writer WAL race with no lost update and both threads terminated; two campaigns accept one identical `policy_hash`; both approval kinds resolve only to their own hash table on insert and update; 100% audit append-only attempts rejected; one-way export exposes no import surface; Datasette accepts 20/20 reads and explicitly rejects 10/10 encoded DML/DDL statements with unchanged rows; every PII class is caught structurally and by content at every VM sink; three commit patterns are blocked outside validated synthetic fixtures; executor introspection finds zero raw operations; inspector ≥90.

zero warnings or external network calls.

Loopback HTTP used only by the Datasette test is local process verification, not an external network call.

P1's no-network bound is process-wide: the gate sets `KB_PROSPECTING_NO_NETWORK=1`; the package,
store, and executor install the loopback-only socket guard at import; the Datasette launch path
inherits the same marker; and the gate wraps child creation to reject and count any child whose
effective environment lacks the marker. This proves the P1 process boundary. It does not claim an
OS-wide firewall or authority over unrelated processes.

## File Structure

- `orgs/prospecting/_index.md` — project navigation for state, contract, data contracts, and fixtures.
- `orgs/prospecting/STATE.md` — work-tree P1 DRAFT checked by the gate; the boss creates the ops copy at gate close.
- `orgs/prospecting/contract.md` — conservative autonomy contract plus PII and executor-only laws.
- `orgs/prospecting/data-contracts.md` — human-readable mirror of typed policy, eligibility, request, approval, and repository contracts.
- `orgs/prospecting/fixtures/synthetic.json` — baseline synthetic companies, people, campaigns, and revisions using reserved `.test` data.
- `orgs/prospecting/fixtures/pii-cases.json` — seven PII classes and safe controls for guard tests.
- `orgs/prospecting/fixtures/conflicting-providers.json` — immutable conflicting observations and merge-review input.
- `orgs/prospecting/fixtures/job-change.json` — role-change transaction and stale-contact input.
- `scripts/prospecting/__init__.py` — package marker and schema version constant.
- `scripts/prospecting/schema.sql` — complete P1 schema, constraints, indexes, views, and integrity triggers.
- `scripts/prospecting/store.py` — connection/migration layer, typed contracts, dataclasses, repository operations, overrides, and credit transactions.
- `scripts/prospecting/cli.py` — two-word `dnc`, `note`, `status`, and `veto` override CLI.
- `scripts/prospecting/export.py` — explicit timestamped one-way CSV export with a non-importable marker.
- `scripts/prospecting/serve_datasette.ps1` — localhost-only, immutable Datasette launcher.
- `scripts/prospecting/pii_guard.py` — staged-file scanner and structured runtime VM-sink guard.
- `scripts/prospecting/executor.py` — typed request validation and validate → hooks → act → audit shell with no live adapters.
- `scripts/prospecting/gate.py` — fail-closed P1 manifest, artifact, fixture, warning, skip, xfail, and numeric gate runner.
- `scripts/prospecting/gate_manifest.json` — exact P1 artifact allowlist, fixtures, 48 node IDs, and numeric criteria.
- `scripts/prospecting/tests/test_store.py` — package discovery, schema/migration, repository, WAL, credit, role-change, CLI, export, and Datasette tests.
- `scripts/prospecting/tests/test_contracts.py` — typed targeting, capabilities, eligibility, policy-hash, request, and approval-integrity tests.
- `scripts/prospecting/tests/test_pii_guard.py` — seven-class/every-sink runtime guard and real temporary-git pre-commit tests.
- `scripts/prospecting/tests/test_executor_surface.py` — request loop, hook order, rejection audit, and zero-capability tests.
- `scripts/prospecting/tests/test_gate.py` — manifest inventory and each fail-closed gate condition.
- `.githooks/pre-commit` — existing hook extended to run the prospecting staged-file PII scan.

### Task 1: Scaffold, package discovery, and gate skeleton

**Files:** Create `orgs/prospecting/_index.md`, `orgs/prospecting/STATE.md`, `orgs/prospecting/contract.md`, `orgs/prospecting/data-contracts.md`, `scripts/prospecting/__init__.py`, `scripts/prospecting/gate_manifest.json`, `scripts/prospecting/tests/test_store.py`; Modify none; Test `scripts/prospecting/tests/test_store.py`

**Interfaces:** Consumes: root `pytest.ini` discovery and the atlas-prep scaffold conventions / Produces: `scripts.prospecting.SCHEMA_VERSION: int`, package importability, conservative project policy, and the manifest keys `phase`, `artifacts`, `fixtures`, `tests`, `criteria`

- [ ] Step 1: Write the failing test — create `scripts/prospecting/tests/test_store.py` with this complete discovery test.

```python
from scripts import prospecting


def test_01_package_discovery() -> None:
    assert prospecting.SCHEMA_VERSION == 1
```

- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_01_package_discovery -q`; expect `ModuleNotFoundError: No module named 'scripts.prospecting'`.

- [ ] Step 3: Minimal implementation — create the scaffold exactly as follows. For this new project only, write `STATE.md` in the work tree as a work-product DRAFT. The boss creates the ops copy at gate close; the worker makes no ops write. All blocks below are written on the assigned work branch.

`scripts/prospecting/__init__.py`

```python
"""Deterministic desktop-local prospecting foundation."""

from __future__ import annotations

import os
import socket

SCHEMA_VERSION = 1
_NETWORK_GUARD_INSTALLED = False


def install_no_network_guard() -> None:
    """Deny non-loopback connects when the P1 gate marks this process."""
    global _NETWORK_GUARD_INSTALLED
    if os.environ.get("KB_PROSPECTING_NO_NETWORK") != "1" or _NETWORK_GUARD_INSTALLED:
        return
    original_socket = socket.socket

    class LoopbackOnlySocket(original_socket):
        def connect(self, address: object) -> object:
            host = address[0] if isinstance(address, tuple) and address else ""
            if host not in {"127.0.0.1", "::1", "localhost"}:
                raise OSError("external network disabled by P1 gate")
            return super().connect(address)

    socket.socket = LoopbackOnlySocket
    _NETWORK_GUARD_INSTALLED = True


install_no_network_guard()
```

`orgs/prospecting/_index.md`

```markdown
# prospecting — index

- [STATE](STATE.md) — work-product DRAFT until the boss creates the ops copy at gate close
- [contract](contract.md) — autonomy and data-boundary policy
- [data contracts](data-contracts.md) — typed desktop/VM interfaces
- `fixtures/` — synthetic-only P1 verification data
```

`orgs/prospecting/STATE.md`

```markdown
# prospecting — STATE (work-product DRAFT)

_Updated: 2026-09-03_

## Now
P1 implementation planned; scaffold awaits the P1 gate.

## Next
Execute the P1 plan task-by-task and run the sole P1 gate command.

## Blocked
None.
```

`orgs/prospecting/contract.md`

```markdown
# prospecting — contract (autonomy policy)

Conservative default: EVERYTHING queues-for-me until grades earn wider lists.

## acts-alone
- read project files and desktop-local typed projections needed for assigned work
- write work products named by an assigned card on its work branch
- run synthetic, local, no-network verification

## queues-for-me
- everything else, explicitly including external publishing, outreach, live adapters, purchases,
  cap increases, human overrides, approvals, merges, and changes outside this project
- every Gmail send; each is kb risk tier T3 and requires the applicable verified human approval
- every new or widened cadence, permission, capability, or network destination

## wakes-me-up
- verification fails twice on the same item
- daily budget is breached
- any request to handle a secret as an object
- any PII would enter git or a VM sink
- any governance rule is at risk

## hard data boundary
Names, emails, phones, profile URLs, person notes, source excerpts, and message bodies may exist
only in desktop-local SQLite, the dedicated Chrome user-data-dir, or the snapshot directory. They
never enter git, process arguments, stdout/stderr, logs, cards, ledgers, exception text, or any VM
sink. Repository fixtures are synthetic and use reserved `.test` domains and synthetic phone ranges.

## executor boundary
Only the deterministic non-agent executor may hold ambient Gmail or vendor credentials. Agents may
create typed `exec_request` rows containing opaque IDs; they have no raw Gmail, vendor, shell, or
credential operation. P1 has no enabled live adapter.
```

`orgs/prospecting/data-contracts.md`

```markdown
# Prospecting data contracts

The canonical contract is the constrained SQLite schema plus the typed constructors in
`scripts/prospecting/store.py`. VM-safe values are opaque IDs, counts, enums, normalized predicate
values, hashes, timestamps, and result codes. PII-bearing values remain desktop-local.

## Target policy
Predicates are ordered `{predicate_id,type,value}` records. Types are `industry`, `company_type`,
`company_stage`, `company_location`, `person_location`, `title`, `seniority`, `school`, `platform`,
or `company_list`; `company_list` contains ordered opaque company IDs. Names, URLs, message text,
and free-form predicate code fail closed.

## Eligibility and capabilities
Lane capabilities are versioned `exact`, `approximate`, or `unsupported` decisions with reason
codes. Eligibility records contain ordered failed and approximate predicate IDs and one of
`eligible`, `ineligible`, or `needs_override`.

## Executor requests and approvals
Executor requests use only the seven allow-listed operations and opaque typed payload values.
Approval is null for every operation except enabled-tier `gmail_send`; T0 send always fails.
Revision approvals resolve only to `revision.hash`; reply-template approvals resolve only to
`reply_template.body_hash`. Every accepted send binds campaign, policy, content, recipient,
mailbox, tier, window, action, nonce, and scope hash.
```

`scripts/prospecting/gate_manifest.json`

```json
{
  "phase": "P1",
  "artifacts": [],
  "fixtures": [],
  "tests": [],
  "criteria": {
    "minimum_enumerated_tests": 49,
    "warnings": 0,
    "skips": 0,
    "xfails": 0,
    "external_network_calls": 0
  }
}
```

- [ ] Step 4: Run tests, expect PASS — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_01_package_discovery -q`; expect `1 passed` and no warning summary.

- [ ] Step 5: Report — report the four project scaffold files, including the work-tree `STATE.md` DRAFT, importable package, `+1` passing test, and the five manifest top-level entries; do not commit. State that the boss creates the ops copy only at gate close.

### Task 2A: Complete constrained schema

**Files:** Create `scripts/prospecting/schema.sql`; Modify `scripts/prospecting/tests/test_store.py` (append after line 5); Test `scripts/prospecting/tests/test_store.py`

**Interfaces:** Consumes: `scripts.prospecting.SCHEMA_VERSION` / Produces: SQLite schema version `1`, every §Data table, `company_tranche` and `person_tranche` views, `campaign_policy_hash_idx`, approval-integrity triggers, immutable-row triggers, and append-only audit triggers

- [ ] Step 1: Write the failing test — append these complete tests to `test_store.py`.

```python
import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest

SCHEMA = Path(__file__).parents[1] / "schema.sql"


def _schema_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript(SCHEMA.read_text(encoding="utf-8"))
    return connection


def test_02_schema_contains_every_data_table() -> None:
    connection = _schema_connection()
    names = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    expected = {
        "schema_version", "sender_profile", "company", "person", "campaign",
        "source_observation", "employment", "merge_review", "fit_score_version",
        "fit_score", "predicate_override", "eligibility_decision", "fit_veto", "contact_point", "exec_request",
        "provider_attempt", "credit_reservation", "finder_run", "finder_cursor",
        "source_snapshot", "evidence", "revision", "reply_template", "approval",
        "enrollment", "delivery", "inbound", "reply_revision", "suppression",
        "relationship", "audit"
    }
    assert names == expected
    normalized = " ".join(SCHEMA.read_text(encoding="utf-8").split())
    required_checks = (
        "source_lane IN ('linkedin_assisted','class_c_public_profile','manual','pitchbook','pdl')",
        "intent IN ('networking','recruiting_live','curiosity','alumni','sales')",
        "ask_minutes BETWEEN 1 AND 20", "tone IN ('direct','warm','formal')",
        "json_array_length(cadence) <= 3", "daily_cap BETWEEN 1 AND 50",
        "hourly_cap BETWEEN 1 AND 6", "firm_collision_cap BETWEEN 1 AND 2",
        "approval_tier IN ('T0','T1','T2','T3')", "credit_budget >= 0",
        "status IN ('draft','approved','active','paused','closed')",
        "entity_type IN ('company','person','contact','employment')",
        "confidence BETWEEN 0.0 AND 1.0", "score BETWEEN 0 AND 100",
        "outcome IN ('eligible','ineligible','needs_override')", "bounce_history >= 0",
        "step BETWEEN 0 AND 2", "angle IN ('why_them','signal_led','offer_led','follow_up_value')",
        "generation_mode IN ('bespoke','template_with_purpose')", "template_version >= 1",
        "content_kind IN ('revision','reply_template')",
        "permitted_action IN ('send_revision','send_preapproved_reply_template')",
        "state IN ('queued','claimed','succeeded','rejected','uncertain')",
        "priority >= 0", "credits >= 0", "max_cost >= 0",
        "requested_companies >= 0", "requested_people >= 0", "processed >= 0",
        "yielded >= 0", "allowed_for_copy IN (0,1)",
    )
    assert all(fragment in normalized for fragment in required_checks)


def test_03_schema_foreign_keys_are_valid() -> None:
    connection = _schema_connection()
    tables = tuple(
        row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    )
    actual = {
        (table, row[3], row[2], row[4])
        for table in tables
        for row in connection.execute(f"PRAGMA foreign_key_list({table})")
    }
    expected = {
        ("campaign", "sender_profile_id", "sender_profile", "sender_profile_id"),
        ("source_observation", "snapshot_id", "source_snapshot", "snapshot_id"),
        ("employment", "person_id", "person", "person_id"),
        ("employment", "company_id", "company", "company_id"),
        ("employment", "source_observation_id", "source_observation", "observation_id"),
        ("fit_score", "campaign_id", "campaign", "campaign_id"),
        ("fit_score", "person_id", "person", "person_id"),
        ("fit_score", "fit_score_version_id", "fit_score_version", "fit_score_version_id"),
        ("eligibility_decision", "campaign_id", "campaign", "campaign_id"),
        ("eligibility_decision", "person_id", "person", "person_id"),
        ("eligibility_decision", "fit_score_version_id", "fit_score_version", "fit_score_version_id"),
        ("contact_point", "person_id", "person", "person_id"),
        ("contact_point", "employer_company_id", "company", "company_id"),
        ("evidence", "person_id", "person", "person_id"),
        ("revision", "person_id", "person", "person_id"),
        ("revision", "campaign_id", "campaign", "campaign_id"),
        ("approval", "campaign_id", "campaign", "campaign_id"),
        ("approval", "contact_id", "contact_point", "contact_id"),
        ("exec_request", "approval_id", "approval", "approval_id"),
        ("provider_attempt", "person_id", "person", "person_id"),
        ("credit_reservation", "campaign_id", "campaign", "campaign_id"),
        ("credit_reservation", "exec_request_id", "exec_request", "request_id"),
        ("finder_run", "campaign_id", "campaign", "campaign_id"),
        ("finder_cursor", "finder_run_id", "finder_run", "finder_run_id"),
        ("enrollment", "campaign_id", "campaign", "campaign_id"),
        ("enrollment", "person_id", "person", "person_id"),
        ("delivery", "campaign_id", "campaign", "campaign_id"),
        ("delivery", "enrollment_id", "enrollment", "enrollment_id"),
        ("delivery", "revision_hash", "revision", "hash"),
        ("delivery", "contact_id", "contact_point", "contact_id"),
        ("inbound", "enrollment_id", "enrollment", "enrollment_id"),
        ("reply_revision", "inbound_id", "inbound", "inbound_id"),
        ("reply_revision", "campaign_id", "campaign", "campaign_id"),
        ("reply_revision", "contact_id", "contact_point", "contact_id"),
        ("relationship", "person_id", "person", "person_id"),
    }
    assert actual == expected
    assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize(
    ("statement", "parameters"),
    (
        ("INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
         ("c1", "Synthetic Company", "unknown", "synthetic-company")),
        ("INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
         ("c1", "Synthetic Company", "http://example.test", "manual", "synthetic-company")),
        ("INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
         ("p1", "Casey", "Casey Example", "unknown", "casey")),
        ("INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
         ("o1", "unknown", "p1", "title", '"Associate"', "synthetic", "2026-09-03T00:00:00Z", 1.0)),
        ("INSERT INTO merge_review(review_id,entity_type,candidate_ids,observation_ids,reason,state) VALUES(?,?,?,?,?,?)",
         ("m1", "person", "[]", "[]", "test", "unknown")),
        ("INSERT INTO contact_point(contact_id,person_id,email,provider,adapter_version,state,confidence) VALUES(?,?,?,?,?,?,?)",
         ("cp1", "missing", "safe" + chr(64) + "example.test", "unknown", "v1", "valid", 1.0)),
        ("INSERT INTO provider_attempt(attempt_id,person_id,provider,call,input_hash,priority,credits,result,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
         ("pa1", "missing", "unknown", "lookup", "a" * 64, 0, 0, "error", "t", "t")),
        ("INSERT INTO finder_run(finder_run_id,campaign_id,policy_hash,requested_companies,requested_people,state,updated_at) VALUES(?,?,?,?,?,?,?)",
         ("fr1", "missing", "a" * 64, -1, 0, "queued", "t")),
        ("INSERT INTO suppression(suppression_id,scope,subject_key,reason,created_at,created_by) VALUES(?,?,?,?,?,?)",
         ("s1", "unknown", "x", "manual_dnc", "t", "human")),
    ),
)
def test_04_schema_check_rejects_bad_enum(statement: str, parameters: tuple[object, ...]) -> None:
    connection = _schema_connection()
    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
        connection.execute(statement, parameters)


def test_04b_schema_cross_row_triggers_and_campaign_tranche() -> None:
    schema = SCHEMA.read_text(encoding="utf-8")
    for trigger in (
        "campaign_activate_requires_approval", "campaign_sales_no_activate",
        "approval_campaign_policy_insert", "approval_campaign_policy_update",
        "exec_request_approval_insert", "exec_request_approval_update",
        "employment_overlap_review", "one_valid_contact_per_person",
    ):
        assert trigger in schema
    connection = _schema_connection()
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender", "Synthetic", None, "focus", "background", "proof", "[]"),
    )
    campaign = (
        "campaign", "networking", "sender", "{}", "informational_call", 15,
        "direct", "networking-v1", "[]", "09:00-17:00", "America/New_York",
        25, 6, 2, "T1", "mailbox", "{}", 0, "draft", "a" * 64,
    )
    connection.execute("INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", campaign)
    with pytest.raises(sqlite3.IntegrityError, match="approved"):
        connection.execute("UPDATE campaign SET status='active' WHERE campaign_id='campaign'")
    sales = list(campaign)
    sales[0], sales[1] = "sales-campaign", "sales"
    connection.execute("INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", sales)
    with pytest.raises(sqlite3.IntegrityError, match="sales activation"):
        connection.execute("UPDATE campaign SET status='active' WHERE campaign_id='sales-campaign'")
    with pytest.raises(sqlite3.IntegrityError, match="approval nullability"):
        connection.execute(
            "INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,created_at,state) VALUES(?,?,?,?,?,?,?)",
            ("request", "campaigner", "gmail_send", "{}", "a" * 64, "t", "queued"),
        )
    for index in (1, 2):
        connection.execute(
            "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
            (f"company-{index}", f"Synthetic {index}", "manual", f"synthetic-{index}"),
        )
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ("person", "Casey", "Casey Example", "manual", "casey"),
    )
    for index in (1, 2):
        connection.execute(
            "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
            (f"observation-{index}", "employment", f"employment-{index}", "title",
             '"Associate"', "synthetic", "t", 1.0),
        )
        connection.execute(
            "INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)",
            (f"employment-{index}", "person", f"company-{index}", "Associate", None, None,
             f"observation-{index}", 1.0),
        )
    assert connection.execute(
        "SELECT count(*) FROM merge_review WHERE reason='overlapping_open_employment'"
    ).fetchone()[0] == 1
    connection.execute(
        "INSERT INTO contact_point(contact_id,person_id,email,provider,adapter_version,state,confidence) VALUES(?,?,?,?,?,?,?)",
        ("contact-1", "person", "one" + chr(64) + "example.test", "manual", "v1", "valid", 1.0),
    )
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE constraint failed"):
        connection.execute(
            "INSERT INTO contact_point(contact_id,person_id,email,provider,adapter_version,state,confidence) VALUES(?,?,?,?,?,?,?)",
            ("contact-2", "person", "two" + chr(64) + "example.test", "manual", "v1", "valid", 1.0),
        )


def test_05_audit_is_append_only(record_property) -> None:
    connection = _schema_connection()
    connection.execute(
        "INSERT INTO audit(event_id,actor,action,entity_type,entity_id,at,reason) "
        "VALUES('a1','human','override','campaign','c1','2026-09-03T00:00:00Z','test')"
    )
    attempts = [
        ("UPDATE audit SET reason='changed' WHERE event_id='a1'",),
        ("DELETE FROM audit WHERE event_id='a1'",),
    ]
    for (statement,) in attempts:
        with pytest.raises(sqlite3.IntegrityError, match="audit is append-only"):
            connection.execute(statement)
    assert connection.execute("SELECT reason FROM audit").fetchone()[0] == "test"
    record_property("audit_rejections", len(attempts))
```

- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_02_schema_contains_every_data_table -q`; expect `FileNotFoundError` for `scripts/prospecting/schema.sql`.

- [ ] Step 3: Minimal implementation — create `scripts/prospecting/schema.sql` with this complete migration. JSON columns are canonical JSON text at repository boundaries; IDs and timestamps are opaque/ISO-8601 text.

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY CHECK (version >= 1),
    applied_at TEXT NOT NULL
);
INSERT INTO schema_version(version, applied_at) VALUES (1, '2026-09-03T00:00:00Z');

CREATE TABLE sender_profile (
    sender_profile_id TEXT PRIMARY KEY,
    sender_name TEXT NOT NULL,
    sender_school TEXT,
    sender_focus TEXT NOT NULL,
    sender_background TEXT NOT NULL,
    sender_operating_proof TEXT NOT NULL,
    approved_metrics TEXT NOT NULL CHECK (json_valid(approved_metrics))
);

CREATE TABLE company (
    company_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    website_url TEXT,
    linkedin_url TEXT,
    one_line_summary TEXT CHECK (one_line_summary IS NULL OR length(one_line_summary) <= 240),
    industry TEXT,
    location TEXT,
    source_lane TEXT NOT NULL CHECK (source_lane IN ('linkedin_assisted','class_c_public_profile','manual','pitchbook','pdl')),
    dedupe_key TEXT NOT NULL UNIQUE,
    CHECK (website_url IS NULL OR website_url LIKE 'https://%'),
    CHECK (linkedin_url IS NULL OR linkedin_url LIKE 'https://%')
);

CREATE TABLE person (
    person_id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    linkedin_url TEXT,
    location TEXT,
    one_line_blurb TEXT CHECK (one_line_blurb IS NULL OR length(one_line_blurb) <= 240),
    source_lane TEXT NOT NULL CHECK (source_lane IN ('linkedin_assisted','class_c_public_profile','manual','pitchbook','pdl')),
    dedupe_key TEXT NOT NULL UNIQUE,
    CHECK (linkedin_url IS NULL OR linkedin_url LIKE 'https://%')
);

CREATE TABLE campaign (
    campaign_id TEXT PRIMARY KEY,
    intent TEXT NOT NULL CHECK (intent IN ('networking','recruiting_live','curiosity','alumni','sales')),
    sender_profile_id TEXT NOT NULL REFERENCES sender_profile(sender_profile_id),
    policy_json TEXT NOT NULL CHECK (json_valid(policy_json)),
    ask_type TEXT NOT NULL CHECK (ask_type IN ('informational_call','role_conversation','relationship','feedback')),
    ask_minutes INTEGER NOT NULL DEFAULT 15 CHECK (ask_minutes BETWEEN 1 AND 20),
    tone TEXT NOT NULL CHECK (tone IN ('direct','warm','formal')),
    template_family TEXT NOT NULL,
    cadence TEXT NOT NULL CHECK (json_valid(cadence) AND json_array_length(cadence) <= 3),
    send_window TEXT NOT NULL,
    timezone TEXT NOT NULL,
    daily_cap INTEGER NOT NULL DEFAULT 25 CHECK (daily_cap BETWEEN 1 AND 50),
    hourly_cap INTEGER NOT NULL DEFAULT 6 CHECK (hourly_cap BETWEEN 1 AND 6),
    firm_collision_cap INTEGER NOT NULL DEFAULT 2 CHECK (firm_collision_cap BETWEEN 1 AND 2),
    approval_tier TEXT NOT NULL CHECK (approval_tier IN ('T0','T1','T2','T3')),
    mailbox_id TEXT NOT NULL,
    evidence_rules TEXT NOT NULL CHECK (json_valid(evidence_rules)),
    credit_budget INTEGER NOT NULL DEFAULT 0 CHECK (credit_budget >= 0),
    status TEXT NOT NULL CHECK (status IN ('draft','approved','active','paused','closed')),
    policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64)
);
CREATE INDEX campaign_policy_hash_idx ON campaign(policy_hash);

CREATE TABLE source_snapshot (
    snapshot_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
    source_domain TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
    allowlist_version TEXT NOT NULL,
    body_ref TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    retention_delete_at TEXT NOT NULL
);

CREATE TABLE source_observation (
    observation_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('company','person','contact','employment')),
    entity_id TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT NOT NULL CHECK (json_valid(value)),
    source TEXT NOT NULL,
    seen_at TEXT,
    retrieved_at TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    snapshot_id TEXT REFERENCES source_snapshot(snapshot_id)
);

CREATE TABLE employment (
    employment_id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES person(person_id),
    company_id TEXT NOT NULL REFERENCES company(company_id),
    title TEXT NOT NULL,
    valid_from TEXT,
    valid_to TEXT,
    source_observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX one_open_employment_per_person_company
    ON employment(person_id, company_id) WHERE valid_to IS NULL;

CREATE TABLE merge_review (
    review_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('company','person','contact','employment')),
    candidate_ids TEXT NOT NULL CHECK (json_valid(candidate_ids)),
    observation_ids TEXT NOT NULL CHECK (json_valid(observation_ids)),
    reason TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open','resolved_keep','resolved_merge','resolved_split')),
    decided_by TEXT,
    decided_at TEXT,
    CHECK ((state = 'open' AND decided_by IS NULL AND decided_at IS NULL) OR
           (state <> 'open' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE TABLE fit_score_version (
    fit_score_version_id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
    rule_hash TEXT NOT NULL UNIQUE CHECK (length(rule_hash) = 64),
    created_at TEXT NOT NULL,
    active_from TEXT NOT NULL
);

CREATE TABLE fit_score (
    fit_score_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    fit_score_version_id TEXT NOT NULL REFERENCES fit_score_version(fit_score_version_id),
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    components TEXT NOT NULL CHECK (json_valid(components)),
    scored_at TEXT NOT NULL
);

CREATE TABLE predicate_override (
    override_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64),
    predicate_id TEXT NOT NULL,
    lane TEXT NOT NULL CHECK (lane IN ('linkedin_assisted','class_c_public_profile','manual','pitchbook','pdl')),
    capability_version TEXT NOT NULL,
    decided_by TEXT NOT NULL CHECK (decided_by NOT LIKE 'agent:%'),
    decided_at TEXT NOT NULL,
    UNIQUE(campaign_id,policy_hash,predicate_id,lane,capability_version)
);

CREATE TABLE eligibility_decision (
    decision_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    rule_version TEXT NOT NULL,
    fit_score_version_id TEXT NOT NULL REFERENCES fit_score_version(fit_score_version_id),
    outcome TEXT NOT NULL CHECK (outcome IN ('eligible','ineligible','needs_override')),
    failed_predicate_ids TEXT NOT NULL CHECK (json_valid(failed_predicate_ids)),
    approximate_predicate_ids TEXT NOT NULL CHECK (json_valid(approximate_predicate_ids)),
    decided_at TEXT NOT NULL,
    override_id TEXT REFERENCES predicate_override(override_id)
);

CREATE TABLE fit_veto (
    veto_id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES person(person_id),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    rule_code TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0,1)),
    decided_by TEXT NOT NULL CHECK (decided_by NOT LIKE 'agent:%'),
    decided_at TEXT NOT NULL,
    UNIQUE(person_id,campaign_id,rule_code)
);

CREATE TABLE contact_point (
    contact_id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES person(person_id),
    employer_company_id TEXT REFERENCES company(company_id),
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    provider TEXT NOT NULL CHECK (provider IN ('manual','hunter','snov','fullenrich','pdl')),
    adapter_version TEXT NOT NULL,
    retrieved_at TEXT,
    verified_at TEXT,
    state TEXT NOT NULL CHECK (state IN ('valid','invalid','risky','catch_all','role','stale')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    bounce_history INTEGER NOT NULL DEFAULT 0 CHECK (bounce_history >= 0)
);

CREATE TABLE evidence (
    evidence_id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES person(person_id),
    claim TEXT NOT NULL,
    url TEXT NOT NULL CHECK (url LIKE 'https://%'),
    observed_at TEXT,
    retrieved_at TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    expires_at TEXT NOT NULL,
    allowed_for_copy INTEGER NOT NULL CHECK (allowed_for_copy IN (0,1))
);

CREATE TABLE revision (
    revision_id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES person(person_id),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    step INTEGER NOT NULL CHECK (step BETWEEN 0 AND 2),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    angle TEXT NOT NULL CHECK (angle IN ('why_them','signal_led','offer_led','follow_up_value')),
    generation_mode TEXT NOT NULL CHECK (generation_mode IN ('bespoke','template_with_purpose')),
    purpose TEXT,
    ask TEXT NOT NULL,
    evidence_ids TEXT NOT NULL CHECK (json_valid(evidence_ids)),
    recipient_relevance_points TEXT NOT NULL CHECK (json_valid(recipient_relevance_points)),
    sender_proof_points TEXT NOT NULL CHECK (json_valid(sender_proof_points)),
    template_id TEXT NOT NULL,
    template_version INTEGER NOT NULL CHECK (template_version >= 1),
    prompt_version TEXT NOT NULL,
    model_version TEXT NOT NULL,
    qa TEXT NOT NULL CHECK (json_valid(qa)),
    hash TEXT NOT NULL UNIQUE CHECK (length(hash) = 64),
    CHECK ((generation_mode = 'bespoke') OR (purpose IS NOT NULL AND length(purpose) > 0))
);

CREATE TABLE reply_template (
    id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    body_hash TEXT NOT NULL UNIQUE CHECK (length(body_hash) = 64),
    approved_at TEXT NOT NULL,
    PRIMARY KEY(id, version)
);

CREATE TABLE approval (
    approval_id TEXT PRIMARY KEY,
    assertion_ref TEXT NOT NULL,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64),
    content_kind TEXT NOT NULL CHECK (content_kind IN ('revision','reply_template')),
    revision_hash TEXT NOT NULL CHECK (length(revision_hash) = 64),
    contact_id TEXT NOT NULL REFERENCES contact_point(contact_id),
    mailbox_id TEXT NOT NULL,
    approver TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('T0','T1','T2','T3')),
    send_window TEXT NOT NULL CHECK (json_valid(send_window)),
    nonce TEXT NOT NULL UNIQUE,
    permitted_action TEXT NOT NULL CHECK (permitted_action IN ('send_revision','send_preapproved_reply_template')),
    consumed_at TEXT,
    scope_hash TEXT NOT NULL UNIQUE CHECK (length(scope_hash) = 64),
    invalidation_reason TEXT CHECK (invalidation_reason IS NULL OR invalidation_reason IN
        ('edited','rescheduled_outside_window','policy_changed','recipient_changed','mailbox_changed','expired','consumed','revoked')),
    CHECK ((content_kind = 'revision' AND permitted_action = 'send_revision') OR
           (content_kind = 'reply_template' AND permitted_action = 'send_preapproved_reply_template'))
);

CREATE TABLE exec_request (
    request_id TEXT PRIMARY KEY,
    caller TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('fetch_snapshot','finder_page','vendor_lookup','gmail_draft','gmail_send','gmail_label','gmail_thread_refresh')),
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64),
    approval_id TEXT REFERENCES approval(approval_id),
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    state TEXT NOT NULL CHECK (state IN ('queued','claimed','succeeded','rejected','uncertain')),
    reason TEXT
);

CREATE TABLE provider_attempt (
    attempt_id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES person(person_id),
    provider TEXT NOT NULL CHECK (provider IN ('hunter','snov','fullenrich','pdl','pattern')),
    call TEXT NOT NULL,
    input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
    priority INTEGER NOT NULL CHECK (priority >= 0),
    credits INTEGER NOT NULL CHECK (credits >= 0),
    result TEXT NOT NULL CHECK (result IN ('valid','invalid','risky','catch_all','role','not_found','error','skipped_budget')),
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    raw_response_ref INTEGER
);

CREATE TABLE credit_reservation (
    reservation_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    provider TEXT NOT NULL CHECK (provider IN ('hunter','snov','fullenrich','pdl','pattern')),
    exec_request_id TEXT NOT NULL UNIQUE REFERENCES exec_request(request_id),
    max_cost INTEGER NOT NULL CHECK (max_cost >= 0),
    actual_cost INTEGER CHECK (actual_cost IS NULL OR actual_cost >= 0),
    state TEXT NOT NULL CHECK (state IN ('reserved','settled','released','overage_error')),
    created_at TEXT NOT NULL,
    settled_at TEXT,
    CHECK ((state = 'reserved' AND actual_cost IS NULL AND settled_at IS NULL) OR state <> 'reserved')
);

CREATE TABLE finder_run (
    finder_run_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    policy_hash TEXT NOT NULL,
    requested_companies INTEGER NOT NULL CHECK (requested_companies >= 0),
    requested_people INTEGER NOT NULL CHECK (requested_people >= 0),
    state TEXT NOT NULL CHECK (state IN ('queued','running','paused','completed')),
    started_at TEXT,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    shortfall_reason TEXT CHECK (shortfall_reason IS NULL OR shortfall_reason IN
        ('lane_exhausted','cap_reached','checkpoint','unsupported_predicate','credit_budget'))
);

CREATE TABLE finder_cursor (
    finder_run_id TEXT NOT NULL REFERENCES finder_run(finder_run_id),
    lane TEXT NOT NULL,
    cursor TEXT,
    processed INTEGER NOT NULL DEFAULT 0 CHECK (processed >= 0),
    yielded INTEGER NOT NULL DEFAULT 0 CHECK (yielded >= 0),
    capability_version TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(finder_run_id, lane)
);

CREATE TABLE enrollment (
    enrollment_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    current_step INTEGER NOT NULL CHECK (current_step BETWEEN 0 AND 2),
    next_due_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('queued','drafted','approved','scheduled','sent','blocked','stopped','closed')),
    stop_reason TEXT CHECK (stop_reason IS NULL OR stop_reason IN ('human_reply','ooo','hard_bounce','decline','unsubscribe','wrong_person','manual_dnc','exhausted_touches','closed_no_reply')),
    block_reason TEXT CHECK (block_reason IS NULL OR block_reason IN ('manual_hold','campaign_paused','suppression_active','daily_cap','hourly_cap','send_window','google_warning','delayed_dsn','approval_missing','approval_expired','approval_mismatch','hash_mismatch','firm_collision','machine_unavailable','gmail_uncertain','inbound_refresh_error')),
    variant_id TEXT,
    UNIQUE(campaign_id, person_id)
);

CREATE TABLE delivery (
    delivery_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    enrollment_id TEXT NOT NULL REFERENCES enrollment(enrollment_id),
    step INTEGER NOT NULL CHECK (step BETWEEN 0 AND 2),
    revision_hash TEXT NOT NULL REFERENCES revision(hash),
    contact_id TEXT NOT NULL REFERENCES contact_point(contact_id),
    mailbox_id TEXT NOT NULL,
    logical_key TEXT NOT NULL UNIQUE CHECK (length(logical_key) = 64),
    gmail_message_id TEXT UNIQUE,
    gmail_thread_id TEXT,
    rfc_message_id TEXT NOT NULL UNIQUE,
    scheduled_at TEXT,
    attempted_at TEXT,
    sent_at TEXT,
    state TEXT NOT NULL CHECK (state IN ('reserved','claimed','attempted','sent','failed','cancelled','uncertain'))
);

CREATE TABLE inbound (
    inbound_id TEXT PRIMARY KEY,
    gmail_message_id TEXT NOT NULL UNIQUE,
    gmail_thread_id TEXT NOT NULL,
    enrollment_id TEXT NOT NULL REFERENCES enrollment(enrollment_id),
    received_at TEXT NOT NULL,
    class TEXT NOT NULL CHECK (class IN ('scheduling_logistics','thanks_ack','graceful_close','substantive_positive','human_neutral','human_negative','ooo','bounce_failed','bounce_delayed','unsubscribe','wrong_person','automatic','ambiguous','sensitive')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    explanation_code TEXT NOT NULL,
    reviewed_by TEXT,
    correction_class TEXT CHECK (correction_class IS NULL OR correction_class IN ('scheduling_logistics','thanks_ack','graceful_close','substantive_positive','human_neutral','human_negative','ooo','bounce_failed','bounce_delayed','unsubscribe','wrong_person','automatic','ambiguous','sensitive'))
);

CREATE TABLE reply_revision (
    reply_revision_id TEXT PRIMARY KEY,
    inbound_id TEXT NOT NULL REFERENCES inbound(inbound_id),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    contact_id TEXT NOT NULL REFERENCES contact_point(contact_id),
    mailbox_id TEXT NOT NULL,
    class TEXT NOT NULL CHECK (class IN ('scheduling_logistics','thanks_ack','graceful_close','substantive_positive','human_neutral','human_negative','ooo','bounce_failed','bounce_delayed','unsubscribe','wrong_person','automatic','ambiguous','sensitive')),
    template_id TEXT,
    template_version INTEGER,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE CHECK (length(hash) = 64),
    generation_mode TEXT NOT NULL CHECK (generation_mode IN ('deterministic_template','model_draft')),
    CHECK ((generation_mode = 'model_draft') OR (template_id IS NOT NULL AND template_version IS NOT NULL))
);

CREATE TABLE suppression (
    suppression_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('global','email','person','company','campaign')),
    subject_key TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('bounce','decline','unsubscribe','wrong_person','manual_dnc','google_warning')),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    released_at TEXT,
    released_by TEXT,
    CHECK ((released_at IS NULL AND released_by IS NULL) OR (released_at IS NOT NULL AND released_by IS NOT NULL))
);

CREATE TABLE relationship (
    person_id TEXT PRIMARY KEY REFERENCES person(person_id),
    affinity_type TEXT,
    why_them TEXT,
    introduced_by TEXT,
    first_touch_at TEXT,
    response_at TEXT,
    call_at TEXT,
    thank_you_at TEXT,
    insights TEXT,
    promised_action TEXT,
    next_appropriate_touch TEXT,
    outcome TEXT
);

CREATE TABLE audit (
    event_id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    at TEXT NOT NULL,
    before_hash TEXT,
    after_hash TEXT,
    reason TEXT NOT NULL
);

CREATE VIEW company_tranche AS
SELECT name, website_url, linkedin_url, one_line_summary, industry, location, source_lane
FROM company;

CREATE VIEW person_tranche AS
SELECT p.first_name, p.full_name, e.title, c.name AS company, p.linkedin_url, p.location,
       cp.email, cp.state AS verification_state, p.one_line_blurb,
       fs.score AS fit_score, p.source_lane
FROM person AS p
JOIN employment AS e ON e.person_id = p.person_id AND e.valid_to IS NULL
JOIN company AS c ON c.company_id = e.company_id
LEFT JOIN contact_point AS cp ON cp.person_id = p.person_id AND cp.state = 'valid'
LEFT JOIN fit_score AS fs ON fs.person_id = p.person_id
  AND fs.scored_at = (SELECT max(fs2.scored_at) FROM fit_score AS fs2 WHERE fs2.person_id = p.person_id);

CREATE UNIQUE INDEX one_valid_contact_per_person
    ON contact_point(person_id) WHERE state = 'valid';

CREATE TRIGGER employment_overlap_review AFTER INSERT ON employment
WHEN NEW.valid_to IS NULL AND EXISTS (
    SELECT 1 FROM employment AS prior
    WHERE prior.person_id = NEW.person_id
      AND prior.employment_id <> NEW.employment_id
      AND prior.valid_to IS NULL
)
BEGIN
  INSERT INTO merge_review(
      review_id,entity_type,candidate_ids,observation_ids,reason,state
  )
  SELECT 'mr_' || lower(hex(randomblob(8))), 'employment',
         json_array(prior.employment_id, NEW.employment_id),
         json_array(prior.source_observation_id, NEW.source_observation_id),
         'overlapping_open_employment', 'open'
  FROM employment AS prior
  WHERE prior.person_id = NEW.person_id
    AND prior.employment_id <> NEW.employment_id
    AND prior.valid_to IS NULL
  ORDER BY prior.employment_id LIMIT 1;
END;

CREATE TRIGGER campaign_sales_no_activate BEFORE UPDATE OF status ON campaign
WHEN NEW.status = 'active' AND NEW.intent = 'sales'
BEGIN SELECT RAISE(ABORT, 'sales activation is disabled in P1-P6'); END;

CREATE TRIGGER campaign_activate_requires_approval BEFORE UPDATE OF status ON campaign
WHEN NEW.status = 'active' AND NEW.intent <> 'sales' AND (
    OLD.status <> 'approved' OR NOT EXISTS (
      SELECT 1 FROM approval AS a
      WHERE a.campaign_id = NEW.campaign_id
        AND a.policy_hash = NEW.policy_hash
        AND a.approver NOT LIKE 'agent:%'
        AND a.invalidation_reason IS NULL
        AND a.consumed_at IS NULL
    )
)
BEGIN SELECT RAISE(ABORT, 'active requires approved status and current human approval'); END;

CREATE TRIGGER approval_campaign_policy_insert BEFORE INSERT ON approval
WHEN NOT EXISTS (
    SELECT 1 FROM campaign AS c
    WHERE c.campaign_id = NEW.campaign_id AND c.policy_hash = NEW.policy_hash
)
BEGIN SELECT RAISE(ABORT, 'approval campaign and policy hash mismatch'); END;

CREATE TRIGGER approval_campaign_policy_update
BEFORE UPDATE OF campaign_id,policy_hash ON approval
WHEN NOT EXISTS (
    SELECT 1 FROM campaign AS c
    WHERE c.campaign_id = NEW.campaign_id AND c.policy_hash = NEW.policy_hash
)
BEGIN SELECT RAISE(ABORT, 'approval campaign and policy hash mismatch'); END;

CREATE TRIGGER exec_request_approval_insert BEFORE INSERT ON exec_request
WHEN (NEW.operation = 'gmail_send' AND NEW.approval_id IS NULL)
  OR (NEW.operation <> 'gmail_send' AND NEW.approval_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'operation-specific approval nullability'); END;

CREATE TRIGGER exec_request_approval_update
BEFORE UPDATE OF operation,approval_id ON exec_request
WHEN (NEW.operation = 'gmail_send' AND NEW.approval_id IS NULL)
  OR (NEW.operation <> 'gmail_send' AND NEW.approval_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'operation-specific approval nullability'); END;

CREATE TRIGGER source_observation_no_update BEFORE UPDATE ON source_observation
BEGIN SELECT RAISE(ABORT, 'source_observation is immutable'); END;
CREATE TRIGGER source_observation_no_delete BEFORE DELETE ON source_observation
BEGIN SELECT RAISE(ABORT, 'source_observation is immutable'); END;
CREATE TRIGGER fit_score_version_no_update BEFORE UPDATE ON fit_score_version
BEGIN SELECT RAISE(ABORT, 'fit_score_version is immutable'); END;
CREATE TRIGGER fit_score_version_no_delete BEFORE DELETE ON fit_score_version
BEGIN SELECT RAISE(ABORT, 'fit_score_version is immutable'); END;
CREATE TRIGGER fit_score_no_update BEFORE UPDATE ON fit_score
BEGIN SELECT RAISE(ABORT, 'fit_score is immutable'); END;
CREATE TRIGGER fit_score_no_delete BEFORE DELETE ON fit_score
BEGIN SELECT RAISE(ABORT, 'fit_score is immutable'); END;
CREATE TRIGGER provider_attempt_no_update BEFORE UPDATE ON provider_attempt
BEGIN SELECT RAISE(ABORT, 'provider_attempt is immutable'); END;
CREATE TRIGGER provider_attempt_no_delete BEFORE DELETE ON provider_attempt
BEGIN SELECT RAISE(ABORT, 'provider_attempt is immutable'); END;
CREATE TRIGGER revision_no_update BEFORE UPDATE ON revision
BEGIN SELECT RAISE(ABORT, 'revision is immutable'); END;
CREATE TRIGGER revision_no_delete BEFORE DELETE ON revision
BEGIN SELECT RAISE(ABORT, 'revision is immutable'); END;
CREATE TRIGGER reply_template_no_update BEFORE UPDATE ON reply_template
BEGIN SELECT RAISE(ABORT, 'reply_template is immutable'); END;
CREATE TRIGGER reply_template_no_delete BEFORE DELETE ON reply_template
BEGIN SELECT RAISE(ABORT, 'reply_template is immutable'); END;
CREATE TRIGGER reply_revision_no_update BEFORE UPDATE ON reply_revision
BEGIN SELECT RAISE(ABORT, 'reply_revision is immutable'); END;
CREATE TRIGGER reply_revision_no_delete BEFORE DELETE ON reply_revision
BEGIN SELECT RAISE(ABORT, 'reply_revision is immutable'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;

CREATE TRIGGER approval_content_insert BEFORE INSERT ON approval
BEGIN
  SELECT CASE
    WHEN NEW.content_kind = 'revision' AND
         (SELECT count(*) FROM revision WHERE hash = NEW.revision_hash) <> 1
      THEN RAISE(ABORT, 'approval revision hash must resolve exactly once')
    WHEN NEW.content_kind = 'reply_template' AND
         (SELECT count(*) FROM reply_template WHERE body_hash = NEW.revision_hash) <> 1
      THEN RAISE(ABORT, 'approval reply-template hash must resolve exactly once')
  END;
END;
CREATE TRIGGER approval_content_update BEFORE UPDATE OF content_kind, revision_hash ON approval
BEGIN
  SELECT CASE
    WHEN NEW.content_kind = 'revision' AND
         (SELECT count(*) FROM revision WHERE hash = NEW.revision_hash) <> 1
      THEN RAISE(ABORT, 'approval revision hash must resolve exactly once')
    WHEN NEW.content_kind = 'reply_template' AND
         (SELECT count(*) FROM reply_template WHERE body_hash = NEW.revision_hash) <> 1
      THEN RAISE(ABORT, 'approval reply-template hash must resolve exactly once')
  END;
END;
```

- [ ] Step 4: Run tests, expect PASS — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_02_schema_contains_every_data_table scripts/prospecting/tests/test_store.py::test_03_schema_foreign_keys_are_valid scripts/prospecting/tests/test_store.py::test_04_schema_check_rejects_bad_enum scripts/prospecting/tests/test_store.py::test_04b_schema_cross_row_triggers_and_campaign_tranche scripts/prospecting/tests/test_store.py::test_05_audit_is_append_only -q`; expect all five test functions to pass (with every parameterized invalid insert green).

- [ ] Step 5: Report — report 31 tables (the 29 original tables plus persisted `predicate_override` and `fit_veto`), two views, the non-unique policy-hash index, the full invalid-insert CHECK matrix, approved-only/non-sales activation, approval campaign/policy equality, operation-specific approval nullability, overlap-to-review behavior, single valid contact selection, campaign-scoped tranche query, immutable triggers, append-only audit rejection `2/2`, `+5` test functions, and no manifest entries yet; do not commit.

### Task 2B: Store opening, migration, path override, and two-writer WAL proof

**Files:** Create `scripts/prospecting/store.py`; Modify `scripts/prospecting/tests/test_store.py` (lines 1-end; append after `test_05_audit_is_append_only`); Test `scripts/prospecting/tests/test_store.py`

**Interfaces:** Consumes: `SCHEMA_VERSION: int`, `schema.sql`, optional `path: Path`, and environment keys `KB_PROSPECTING_STORE`, `LOCALAPPDATA` / Produces: `resolve_store_path(environ: Mapping[str,str] | None = None) -> Path`, `open_store(path: Path | None = None) -> sqlite3.Connection`, `migrate(connection: sqlite3.Connection) -> int`, `get_schema_version(connection: sqlite3.Connection) -> int`

- [ ] Step 1: Write the failing test — append this complete migration/WAL block to `test_store.py`.

```python
import os
import threading

from scripts.prospecting.store import (
    get_schema_version,
    open_store,
    resolve_store_path,
)


def _seed_campaign(
    connection: sqlite3.Connection,
    campaign_id: str = "campaign-1",
    credit_budget: int = 1,
    policy_hash: str = "a" * 64,
) -> None:
    connection.execute(
        "INSERT OR IGNORE INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender-1", "Synthetic Sender", None, "testing", "testing", "proof", "[]"),
    )
    connection.execute(
        """INSERT INTO campaign(
          campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
          template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
          firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (campaign_id, "networking", "sender-1", '{"predicates":[]}',
         "informational_call", 15, "direct", "networking-v1", "[]", "09:00-17:00",
         "America/New_York", 25, 6, 2, "T0", "mailbox-1", "{}", credit_budget,
         "draft", policy_hash),
    )


def test_06_migration_is_idempotent(tmp_path: Path) -> None:
    database = tmp_path / "store.sqlite"
    first = open_store(database)
    assert get_schema_version(first) == 1
    first.close()
    second = open_store(database)
    assert get_schema_version(second) == 1
    assert second.execute("SELECT count(*) FROM schema_version").fetchone()[0] == 1
    second.close()


def test_07_foreign_key_rejection(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "fk.sqlite")
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY constraint failed"):
        connection.execute(
            """INSERT INTO contact_point(
               contact_id,person_id,email,provider,adapter_version,state,confidence
               ) VALUES(?,?,?,?,?,?,?)""",
            ("contact-x", "missing", "safe" + chr(64) + "example.test",
             "manual", "v1", "valid", 1.0),
        )


def test_08_two_writer_wal_race_has_no_lost_update(
    tmp_path: Path, record_property
) -> None:
    database = tmp_path / "wal.sqlite"
    setup = open_store(database)
    _seed_campaign(setup)
    setup.execute(
        "INSERT INTO finder_run VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("run-1", "campaign-1", "a" * 64, 1, 2, "running",
         "2026-09-03T00:00:00Z", "2026-09-03T00:00:00Z", None, None),
    )
    setup.execute(
        "INSERT INTO finder_cursor VALUES(?,?,?,?,?,?,?)",
        ("run-1", "manual", None, 0, 0, "v1", "2026-09-03T00:00:00Z"),
    )
    setup.close()
    barrier = threading.Barrier(2)
    failures: list[str] = []

    def increment() -> None:
        writer = open_store(database)
        writer.execute("PRAGMA busy_timeout=5000")
        barrier.wait()
        try:
            writer.execute("BEGIN IMMEDIATE")
            writer.execute(
                "UPDATE finder_cursor SET processed=processed+1 WHERE finder_run_id='run-1'"
            )
            writer.commit()
        except Exception as exc:
            writer.rollback()
            failures.append(type(exc).__name__)
        finally:
            writer.close()

    workers = [threading.Thread(target=increment) for _ in range(2)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=10)
    assert all(not worker.is_alive() for worker in workers)
    check = open_store(database)
    assert failures == []
    assert check.execute(
        "SELECT processed FROM finder_cursor WHERE finder_run_id='run-1'"
    ).fetchone()[0] == 2
    record_property("wal_writers", 2)


def test_09_store_path_uses_test_override(tmp_path: Path) -> None:
    target = tmp_path / "override.sqlite"
    assert resolve_store_path({"KB_PROSPECTING_STORE": str(target)}) == target
    fallback = resolve_store_path({"LOCALAPPDATA": str(tmp_path)})
    assert fallback == tmp_path / "kb-prospecting" / "store.sqlite"
```

- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_06_migration_is_idempotent -q`; expect `ModuleNotFoundError: No module named 'scripts.prospecting.store'`.

- [ ] Step 3: Minimal implementation — create `scripts/prospecting/store.py` with this complete initial store layer.

```python
"""SQLite lifecycle and typed repository for the desktop prospecting store."""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Mapping
from pathlib import Path

from . import SCHEMA_VERSION, install_no_network_guard

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
install_no_network_guard()


def resolve_store_path(environ: Mapping[str, str] | None = None) -> Path:
    values = os.environ if environ is None else environ
    override = values.get("KB_PROSPECTING_STORE")
    if override:
        return Path(override)
    local_app_data = values.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError("LOCALAPPDATA is required when KB_PROSPECTING_STORE is unset")
    return Path(local_app_data) / "kb-prospecting" / "store.sqlite"


def migrate(connection: sqlite3.Connection) -> int:
    exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).fetchone()
    if not exists:
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    version = get_schema_version(connection)
    if version != SCHEMA_VERSION:
        raise RuntimeError(f"unsupported prospecting schema version {version}")
    return version


def get_schema_version(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT max(version) FROM schema_version").fetchone()
    if row is None or row[0] is None:
        raise RuntimeError("prospecting schema has no version")
    return int(row[0])


def open_store(path: Path | None = None) -> sqlite3.Connection:
    database = resolve_store_path() if path is None else Path(path)
    database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database, timeout=5.0, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=5000")
    migrate(connection)
    return connection
```

- [ ] Step 4: Run tests, expect PASS — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_06_migration_is_idempotent scripts/prospecting/tests/test_store.py::test_07_foreign_key_rejection scripts/prospecting/tests/test_store.py::test_08_two_writer_wal_race_has_no_lost_update scripts/prospecting/tests/test_store.py::test_09_store_path_uses_test_override -q`; expect `4 passed` with no thread warnings.

- [ ] Step 5: Report — report store-path behavior (`%LOCALAPPDATA%\kb-prospecting\store.sqlite`, test override `KB_PROSPECTING_STORE`), schema version, WAL/foreign-key pragmas, two successful writers with final count `2`, `+4` tests, and no manifest entries yet; do not commit.

### Task 3A: Typed repository and immutable provenance fixtures

**Files:** Modify `scripts/prospecting/store.py` (lines 1-end; append after `open_store`), `scripts/prospecting/tests/test_store.py` (lines 1-end; append after `test_09_store_path_uses_test_override`); Create `orgs/prospecting/fixtures/synthetic.json`, `orgs/prospecting/fixtures/conflicting-providers.json`, `orgs/prospecting/fixtures/job-change.json`; Test `scripts/prospecting/tests/test_store.py`

**Interfaces:** Consumes: `open_store(path)`, schema tables, fixture JSON / Produces: dataclasses `Company`, `Person`, `ContactPoint`, `SourceObservation`, `Employment`, `MergeReview`, `ProviderAttempt`, `FitScoreVersion`; paired `insert_*`/`get_*` functions for all eight dataclasses plus `apply_role_change(connection, old_employment_id, old_company_id, new_employment, observations, changed_at) -> int`

- [ ] Step 1: Write the failing test — append these complete repository tests to `test_store.py`.

```python
import json
from dataclasses import replace

from scripts.prospecting.store import (
    Company,
    ContactPoint,
    Employment,
    FitScoreVersion,
    MergeReview,
    Person,
    ProviderAttempt,
    SourceObservation,
    apply_role_change,
    get_company,
    get_contact_point,
    get_employment,
    get_fit_score_version,
    get_merge_review,
    get_person,
    get_person_tranche,
    get_provider_attempt,
    get_source_observation,
    insert_company,
    insert_contact_point,
    insert_employment,
    insert_fit_score_version,
    insert_merge_review,
    insert_person,
    insert_provider_attempt,
    insert_source_observation,
    ingest_observations,
)

FIXTURES = Path(__file__).parents[3] / "orgs" / "prospecting" / "fixtures"


def _objects(connection: sqlite3.Connection) -> tuple[Company, Person, SourceObservation]:
    company = Company("company-1", "Example Test", "https://example.test", None,
                      "Synthetic company", "Testing", "New York, NY", "manual",
                      "example.test")
    person = Person("person-1", "Casey", "Casey Example", None, "New York, NY",
                    "Synthetic person", "manual", "casey|company-1|associate")
    observation = SourceObservation(
        "observation-1", "employment", "employment-1", "title", '"Associate"',
        "synthetic", "2026-09-03", "2026-09-03T00:00:00Z", 1.0, None,
    )
    insert_company(connection, company)
    insert_person(connection, person)
    insert_source_observation(connection, observation)
    return company, person, observation


def test_10_typed_repository_round_trip(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "repo.sqlite")
    _seed_campaign(connection, "campaign-1")
    _seed_campaign(connection, "campaign-2")
    company, person, observation = _objects(connection)
    contact = ContactPoint(
        "contact-1", person.person_id, company.company_id,
        "casey" + chr(64) + "example.test",
        "manual", "v1", "2026-09-03T00:00:00Z", "2026-09-03T00:00:00Z",
        "valid", 1.0, 0,
    )
    insert_contact_point(connection, contact)
    employment = Employment(
        "employment-1", person.person_id, company.company_id, "Associate",
        "2025-01-01", None, "observation-1", 1.0,
    )
    insert_employment(connection, employment)
    review = MergeReview(
        "review-round-trip", "person", ("person-1", "person-2"),
        ("observation-1",), "synthetic_conflict",
    )
    insert_merge_review(connection, review)
    attempt = ProviderAttempt(
        "attempt-1", person.person_id, "hunter", "lookup-v1", "a" * 64,
        0, 0, "not_found", "2026-09-03T00:00:00Z", "2026-09-03T00:00:01Z",
    )
    insert_provider_attempt(connection, attempt)
    score_version = FitScoreVersion(
        "score-version-1", "v1", "{}", "b" * 64,
        "2026-09-03T00:00:00Z", "2026-09-03T00:00:00Z",
    )
    insert_fit_score_version(connection, score_version)
    connection.execute(
        "INSERT INTO fit_score VALUES(?,?,?,?,?,?,?)",
        ("fit-1", "campaign-1", person.person_id, score_version.fit_score_version_id,
         25, "{}", "2026-09-03T00:00:00Z"),
    )
    connection.execute(
        "INSERT INTO fit_score VALUES(?,?,?,?,?,?,?)",
        ("fit-2", "campaign-2", person.person_id, score_version.fit_score_version_id,
         90, "{}", "2026-09-03T00:01:00Z"),
    )
    assert get_company(connection, company.company_id) == company
    assert get_person(connection, person.person_id) == person
    assert get_contact_point(connection, contact.contact_id) == contact
    assert get_source_observation(connection, observation.observation_id) == observation
    assert get_employment(connection, employment.employment_id) == employment
    assert get_merge_review(connection, review.review_id) == review
    assert get_provider_attempt(connection, attempt.attempt_id) == attempt
    assert get_fit_score_version(connection, score_version.fit_score_version_id) == score_version
    first = get_person_tranche(connection, "campaign-1")
    second = get_person_tranche(connection, "campaign-2")
    assert len(first) == len(second) == 1
    assert first[0]["fit_score"] == 25
    assert second[0]["fit_score"] == 90


def test_11_source_observation_cannot_change(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "immutable.sqlite")
    _, _, observation = _objects(connection)
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        connection.execute(
            "UPDATE source_observation SET confidence=.5 WHERE observation_id=?",
            (observation.observation_id,),
        )


def test_12_job_change_is_one_transaction(tmp_path: Path) -> None:
    case = json.loads((FIXTURES / "job-change.json").read_text(encoding="utf-8"))
    connection = open_store(tmp_path / "job.sqlite")
    old_company, person, old_observation = _objects(connection)
    new_company = Company(**case["new_company"])
    insert_company(connection, new_company)
    old_employment = Employment(
        "employment-1", person.person_id, old_company.company_id, "Associate",
        "2025-01-01", None, old_observation.observation_id, 1.0,
    )
    insert_employment(connection, old_employment)
    contact = ContactPoint(
        "contact-1", person.person_id, old_company.company_id,
        "casey" + chr(64) + "example.test",
        "manual", "v1", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
        "valid", 1.0, 0,
    )
    insert_contact_point(connection, contact)
    observations = tuple(SourceObservation(**item) for item in case["observations"])
    new_employment = Employment(**case["new_employment"])
    stale_count = apply_role_change(
        connection, old_employment.employment_id, old_company.company_id,
        new_employment, observations, case["changed_at"],
    )
    assert stale_count == 1
    assert get_contact_point(connection, "contact-1").state == "stale"
    assert connection.execute(
        "SELECT valid_to FROM employment WHERE employment_id='employment-1'"
    ).fetchone()[0] == case["changed_at"]
    assert connection.execute("SELECT count(*) FROM source_observation").fetchone()[0] == 3

    rollback = open_store(tmp_path / "job-rollback.sqlite")
    rollback_old_company, rollback_person, rollback_old_observation = _objects(rollback)
    insert_company(rollback, new_company)
    rollback_old = replace(
        old_employment,
        person_id=rollback_person.person_id,
        company_id=rollback_old_company.company_id,
        source_observation_id=rollback_old_observation.observation_id,
    )
    insert_employment(rollback, rollback_old)
    insert_contact_point(rollback, contact)

    def fail_after_close() -> None:
        raise RuntimeError("injected after old-role close")

    with pytest.raises(RuntimeError, match="injected"):
        apply_role_change(
            rollback, rollback_old.employment_id, rollback_old_company.company_id,
            new_employment, observations, case["changed_at"], after_close=fail_after_close,
        )
    assert get_employment(rollback, rollback_old.employment_id).valid_to is None
    assert get_contact_point(rollback, "contact-1").state == "valid"
    assert rollback.execute(
        "SELECT count(*) FROM employment WHERE employment_id='employment-2'"
    ).fetchone()[0] == 0
    assert rollback.execute(
        "SELECT count(*) FROM source_observation"
    ).fetchone()[0] == 1


def test_13_conflicting_providers_create_review(tmp_path: Path) -> None:
    case = json.loads(
        (FIXTURES / "conflicting-providers.json").read_text(encoding="utf-8")
    )
    connection = open_store(tmp_path / "conflict.sqlite")
    _objects(connection)
    review = ingest_observations(
        connection,
        tuple(SourceObservation(**item) for item in case["observations"]),
        tuple(case["merge_review"]["candidate_ids"]),
    )
    assert review is not None
    row = connection.execute(
        "SELECT state, observation_ids FROM merge_review WHERE review_id=?",
        (review.review_id,),
    ).fetchone()
    assert row["state"] == "open"
    assert json.loads(row["observation_ids"]) == list(review.observation_ids)
    assert connection.execute("SELECT count(*) FROM source_observation").fetchone()[0] == 3
```

- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_10_typed_repository_round_trip -q`; expect `ImportError: cannot import name 'Company'`.

- [ ] Step 3: Minimal implementation — append this complete typed repository block to `store.py`, then create the three complete fixtures.

```python
from dataclasses import asdict, dataclass
import json


@dataclass(frozen=True)
class Company:
    company_id: str
    name: str
    website_url: str | None
    linkedin_url: str | None
    one_line_summary: str | None
    industry: str | None
    location: str | None
    source_lane: str
    dedupe_key: str


@dataclass(frozen=True)
class Person:
    person_id: str
    first_name: str
    full_name: str
    linkedin_url: str | None
    location: str | None
    one_line_blurb: str | None
    source_lane: str
    dedupe_key: str


@dataclass(frozen=True)
class ContactPoint:
    contact_id: str
    person_id: str
    employer_company_id: str | None
    email: str
    provider: str
    adapter_version: str
    retrieved_at: str | None
    verified_at: str | None
    state: str
    confidence: float
    bounce_history: int


@dataclass(frozen=True)
class SourceObservation:
    observation_id: str
    entity_type: str
    entity_id: str
    field: str
    value: str
    source: str
    seen_at: str | None
    retrieved_at: str
    confidence: float
    snapshot_id: str | None


@dataclass(frozen=True)
class Employment:
    employment_id: str
    person_id: str
    company_id: str
    title: str
    valid_from: str | None
    valid_to: str | None
    source_observation_id: str
    confidence: float


@dataclass(frozen=True)
class MergeReview:
    review_id: str
    entity_type: str
    candidate_ids: tuple[str, ...]
    observation_ids: tuple[str, ...]
    reason: str
    state: str = "open"
    decided_by: str | None = None
    decided_at: str | None = None


@dataclass(frozen=True)
class ProviderAttempt:
    attempt_id: str
    person_id: str
    provider: str
    call: str
    input_hash: str
    priority: int
    credits: int
    result: str
    started_at: str
    finished_at: str
    raw_response_ref: int | None = None


@dataclass(frozen=True)
class FitScoreVersion:
    fit_score_version_id: str
    version: str
    rule_json: str
    rule_hash: str
    created_at: str
    active_from: str


def _insert_dataclass(
    connection: sqlite3.Connection,
    table: str,
    value: object,
    json_fields: tuple[str, ...] = (),
) -> None:
    fields = asdict(value)
    for field in json_fields:
        fields[field] = json.dumps(fields[field], separators=(",", ":"))
    columns = ",".join(fields)
    bind_marks = ",".join("?" for _ in fields)
    connection.execute(
        f"INSERT INTO {table}({columns}) VALUES({bind_marks})", tuple(fields.values())
    )


def insert_company(connection: sqlite3.Connection, company: Company) -> None:
    _insert_dataclass(connection, "company", company)


def get_company(connection: sqlite3.Connection, company_id: str) -> Company:
    row = connection.execute(
        "SELECT * FROM company WHERE company_id=?", (company_id,)
    ).fetchone()
    if row is None:
        raise KeyError(company_id)
    return Company(**dict(row))


def insert_person(connection: sqlite3.Connection, person: Person) -> None:
    _insert_dataclass(connection, "person", person)


def get_person(connection: sqlite3.Connection, person_id: str) -> Person:
    row = connection.execute("SELECT * FROM person WHERE person_id=?", (person_id,)).fetchone()
    if row is None:
        raise KeyError(person_id)
    return Person(**dict(row))


def insert_contact_point(connection: sqlite3.Connection, contact: ContactPoint) -> None:
    _insert_dataclass(connection, "contact_point", contact)


def get_contact_point(connection: sqlite3.Connection, contact_id: str) -> ContactPoint:
    row = connection.execute(
        "SELECT * FROM contact_point WHERE contact_id=?", (contact_id,)
    ).fetchone()
    if row is None:
        raise KeyError(contact_id)
    return ContactPoint(**dict(row))


def insert_source_observation(
    connection: sqlite3.Connection, observation: SourceObservation
) -> None:
    _insert_dataclass(connection, "source_observation", observation)


def get_source_observation(
    connection: sqlite3.Connection, observation_id: str
) -> SourceObservation:
    row = connection.execute(
        "SELECT * FROM source_observation WHERE observation_id=?", (observation_id,)
    ).fetchone()
    if row is None:
        raise KeyError(observation_id)
    return SourceObservation(**dict(row))


def insert_employment(connection: sqlite3.Connection, employment: Employment) -> None:
    _insert_dataclass(connection, "employment", employment)


def get_employment(connection: sqlite3.Connection, employment_id: str) -> Employment:
    row = connection.execute(
        "SELECT * FROM employment WHERE employment_id=?", (employment_id,)
    ).fetchone()
    if row is None:
        raise KeyError(employment_id)
    return Employment(**dict(row))


def insert_merge_review(connection: sqlite3.Connection, review: MergeReview) -> None:
    _insert_dataclass(
        connection, "merge_review", review, ("candidate_ids", "observation_ids")
    )


def get_merge_review(connection: sqlite3.Connection, review_id: str) -> MergeReview:
    row = connection.execute(
        "SELECT * FROM merge_review WHERE review_id=?", (review_id,)
    ).fetchone()
    if row is None:
        raise KeyError(review_id)
    values = dict(row)
    values["candidate_ids"] = tuple(json.loads(values["candidate_ids"]))
    values["observation_ids"] = tuple(json.loads(values["observation_ids"]))
    return MergeReview(**values)


def insert_provider_attempt(
    connection: sqlite3.Connection, attempt: ProviderAttempt
) -> None:
    _insert_dataclass(connection, "provider_attempt", attempt)


def get_provider_attempt(
    connection: sqlite3.Connection, attempt_id: str
) -> ProviderAttempt:
    row = connection.execute(
        "SELECT * FROM provider_attempt WHERE attempt_id=?", (attempt_id,)
    ).fetchone()
    if row is None:
        raise KeyError(attempt_id)
    return ProviderAttempt(**dict(row))


def insert_fit_score_version(
    connection: sqlite3.Connection, version: FitScoreVersion
) -> None:
    _insert_dataclass(connection, "fit_score_version", version)


def get_fit_score_version(
    connection: sqlite3.Connection, fit_score_version_id: str
) -> FitScoreVersion:
    row = connection.execute(
        "SELECT * FROM fit_score_version WHERE fit_score_version_id=?",
        (fit_score_version_id,),
    ).fetchone()
    if row is None:
        raise KeyError(fit_score_version_id)
    return FitScoreVersion(**dict(row))


def apply_role_change(
    connection: sqlite3.Connection,
    old_employment_id: str,
    old_company_id: str,
    new_employment: Employment,
    observations: tuple[SourceObservation, ...],
    changed_at: str,
    *,
    after_close: Callable[[], None] | None = None,
) -> int:
    connection.execute("BEGIN IMMEDIATE")
    try:
        for observation in observations:
            insert_source_observation(connection, observation)
        updated = connection.execute(
            "UPDATE employment SET valid_to=? WHERE employment_id=? AND valid_to IS NULL",
            (changed_at, old_employment_id),
        )
        if updated.rowcount != 1:
            raise ValueError("old employment is not open")
        if after_close is not None:
            after_close()
        insert_employment(connection, new_employment)
        stale = connection.execute(
            """UPDATE contact_point SET state='stale'
               WHERE person_id=? AND employer_company_id=? AND state<>'stale'""",
            (new_employment.person_id, old_company_id),
        )
        connection.commit()
        return stale.rowcount
    except Exception:
        connection.rollback()
        raise


def ingest_observations(
    connection: sqlite3.Connection,
    observations: tuple[SourceObservation, ...],
    candidate_ids: tuple[str, ...],
) -> MergeReview | None:
    """Persist immutable observations and create the review for a real conflict."""
    if not observations:
        return None
    keys = {(item.entity_type, item.field) for item in observations}
    values = {item.value for item in observations}
    connection.execute("BEGIN IMMEDIATE")
    try:
        for observation in observations:
            insert_source_observation(connection, observation)
        review = None
        if len(keys) == 1 and len(values) > 1:
            review = MergeReview(
                "mr_" + observations[0].observation_id.removeprefix("obs_")[-16:],
                observations[0].entity_type,
                candidate_ids,
                tuple(item.observation_id for item in observations),
                "conflicting_provider_values",
            )
            insert_merge_review(connection, review)
        connection.commit()
        return review
    except Exception:
        connection.rollback()
        raise


def get_person_tranche(
    connection: sqlite3.Connection, campaign_id: str
) -> tuple[sqlite3.Row, ...]:
    """Return the exact person tranche for one campaign and one selected valid contact."""
    return tuple(connection.execute(
        """SELECT p.first_name,p.full_name,e.title,c.name AS company,p.linkedin_url,
                  p.location,cp.email,cp.state AS verification_state,p.one_line_blurb,
                  fs.score AS fit_score,p.source_lane
           FROM person AS p
           JOIN employment AS e ON e.person_id=p.person_id AND e.valid_to IS NULL
           JOIN company AS c ON c.company_id=e.company_id
           LEFT JOIN contact_point AS cp ON cp.person_id=p.person_id AND cp.state='valid'
           LEFT JOIN fit_score AS fs ON fs.person_id=p.person_id AND fs.campaign_id = ?""",
        (campaign_id,),
    ))
```

`orgs/prospecting/fixtures/synthetic.json`

Use the committed fixture as the canonical synthetic company, person, contact, and
phone dataset. The staged-file guard validates its reserved test-domain and synthetic
phone values; tests should load the fixture rather than duplicate those values here.

`orgs/prospecting/fixtures/conflicting-providers.json`

Use the committed fixture as the canonical conflicting-provider case. The repository
and list-builder tests load it directly to verify that contradictory contact
observations create a review item instead of silently selecting a value.

`orgs/prospecting/fixtures/job-change.json`

```json
{
  "changed_at":"2026-09-01",
  "new_company":{"company_id":"company-2","name":"Second Example","website_url":"https://second.example.test","linkedin_url":null,"one_line_summary":"Synthetic destination","industry":"Testing","location":"Boston, MA","source_lane":"manual","dedupe_key":"second.example.test"},
  "observations":[
    {"observation_id":"observation-role-close","entity_type":"employment","entity_id":"employment-1","field":"valid_to","value":"\"2026-09-01\"","source":"synthetic","seen_at":"2026-09-01","retrieved_at":"2026-09-03T00:00:00Z","confidence":1.0,"snapshot_id":null},
    {"observation_id":"observation-role-open","entity_type":"employment","entity_id":"employment-2","field":"title","value":"\"Director\"","source":"synthetic","seen_at":"2026-09-01","retrieved_at":"2026-09-03T00:00:00Z","confidence":1.0,"snapshot_id":null}
  ],
  "new_employment":{"employment_id":"employment-2","person_id":"person-1","company_id":"company-2","title":"Director","valid_from":"2026-09-01","valid_to":null,"source_observation_id":"observation-role-open","confidence":1.0}
}
```

- [ ] Step 4: Run tests, expect PASS — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_10_typed_repository_round_trip scripts/prospecting/tests/test_store.py::test_11_source_observation_cannot_change scripts/prospecting/tests/test_store.py::test_12_job_change_is_one_transaction scripts/prospecting/tests/test_store.py::test_13_conflicting_providers_create_review -q`; expect `4 passed`.

- [ ] Step 5: Report — report eight immutable typed records, paired insert/select functions for all eight, three exact fixture files, transactional old-role close/new-role insert/contact staleness with `1` row staled, immutable conflicting observations with one open review, `+4` tests, and fixture manifest entries pending finalization; do not commit.

### Task 3B: Atomic credit reservation, settlement, and release

**Files:** Modify `scripts/prospecting/store.py` (lines 1-end; append after `apply_role_change`), `scripts/prospecting/tests/test_store.py` (lines 1-end; append after `test_13_conflicting_providers_create_review`); Test `scripts/prospecting/tests/test_store.py`

**Interfaces:** Consumes: `open_store(path)`, campaign `credit_budget`, queued `exec_request` IDs / Produces: `CreditReservation`, `reserve_credit(connection: sqlite3.Connection, reservation: CreditReservation) -> bool`, `get_credit_reservation(connection: sqlite3.Connection, reservation_id: str) -> CreditReservation`, `settle_credit(connection: sqlite3.Connection, reservation_id: str, actual_cost: int, settled_at: str) -> str`, `release_credit(connection: sqlite3.Connection, reservation_id: str, released_at: str) -> None`

- [ ] Step 1: Write the failing test — append these complete credit tests to `test_store.py`.

```python
from scripts.prospecting.store import (
    CreditReservation,
    get_credit_reservation,
    release_credit,
    reserve_credit,
    settle_credit,
)


def _seed_requests(connection: sqlite3.Connection, count: int = 2) -> None:
    for index in range(count):
        connection.execute(
            """INSERT INTO exec_request(
               request_id,caller,operation,payload,policy_hash,approval_id,created_at,state
               ) VALUES(?,?,?,?,?,?,?,?)""",
            (f"request-{index}", "prospecting-list-builder", "vendor_lookup",
             '{"person_id":"person-1","provider":"hunter"}', "a" * 64, None,
             "2026-09-03T00:00:00Z", "queued"),
        )


def test_14_two_workers_one_credit_allows_one_reservation(tmp_path: Path) -> None:
    database = tmp_path / "credit.sqlite"
    setup = open_store(database)
    _seed_campaign(setup, credit_budget=1)
    _seed_requests(setup)
    setup.close()
    barrier = threading.Barrier(2)
    outcomes: list[bool] = []

    def attempt(index: int) -> None:
        connection = open_store(database)
        barrier.wait()
        outcomes.append(reserve_credit(connection, CreditReservation(
            f"reservation-{index}", "campaign-1", "hunter", f"request-{index}",
            1, None, "reserved", "2026-09-03T00:00:00Z", None,
        )))
        connection.close()

    workers = [threading.Thread(target=attempt, args=(index,)) for index in range(2)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=10)
    check = open_store(database)
    assert sorted(outcomes) == [False, True]
    assert check.execute("SELECT count(*) FROM credit_reservation").fetchone()[0] == 1


def test_15_credit_settle_release_and_overage(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "credit-states.sqlite")
    _seed_campaign(connection, credit_budget=3)
    _objects(connection)
    _seed_requests(connection, count=3)
    first = CreditReservation("r1", "campaign-1", "hunter", "request-0", 1, None,
                              "reserved", "2026-09-03T00:00:00Z", None)
    second = replace(first, reservation_id="r2", exec_request_id="request-1")
    third = replace(first, reservation_id="r3", exec_request_id="request-2")
    assert reserve_credit(connection, first)
    assert reserve_credit(connection, second)
    assert reserve_credit(connection, third)
    assert settle_credit(connection, "r1", 1, "2026-09-03T00:01:00Z") == "settled"
    release_credit(connection, "r2", "2026-09-03T00:01:00Z")
    assert settle_credit(connection, "r3", 2, "2026-09-03T00:01:00Z") == "overage_error"
    rows = dict(connection.execute(
        "SELECT reservation_id,state FROM credit_reservation"
    ).fetchall())
    assert rows == {"r1": "settled", "r2": "released", "r3": "overage_error"}
    assert get_credit_reservation(connection, "r1").actual_cost == 1
    assert connection.execute(
        "SELECT status FROM campaign WHERE campaign_id='campaign-1'"
    ).fetchone()[0] == "paused"
    attempts = connection.execute(
        "SELECT call,result FROM provider_attempt ORDER BY call"
    ).fetchall()
    assert [tuple(row) for row in attempts] == [
        ("credit_overage", "error"), ("credit_release", "skipped_budget")
    ]
    assert connection.execute(
        "SELECT count(*) FROM audit WHERE action='adapter_disabled'"
    ).fetchone()[0] == 1
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        connection.execute("UPDATE provider_attempt SET credits=9")
```

- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_14_two_workers_one_credit_allows_one_reservation -q`; expect `ImportError: cannot import name 'CreditReservation'`.

- [ ] Step 3: Minimal implementation — append this complete credit block to `store.py`.

```python
@dataclass(frozen=True)
class CreditReservation:
    reservation_id: str
    campaign_id: str
    provider: str
    exec_request_id: str
    max_cost: int
    actual_cost: int | None
    state: str
    created_at: str
    settled_at: str | None


def get_credit_reservation(
    connection: sqlite3.Connection, reservation_id: str
) -> CreditReservation:
    row = connection.execute(
        "SELECT * FROM credit_reservation WHERE reservation_id=?", (reservation_id,)
    ).fetchone()
    if row is None:
        raise KeyError(reservation_id)
    return CreditReservation(**dict(row))


def reserve_credit(
    connection: sqlite3.Connection, reservation: CreditReservation
) -> bool:
    connection.execute("BEGIN IMMEDIATE")
    try:
        row = connection.execute(
            "SELECT credit_budget FROM campaign WHERE campaign_id=?",
            (reservation.campaign_id,),
        ).fetchone()
        if row is None:
            raise KeyError(reservation.campaign_id)
        used = connection.execute(
            """SELECT coalesce(sum(CASE
                 WHEN state='reserved' THEN max_cost
                 WHEN state IN ('settled','overage_error') THEN actual_cost
                 ELSE 0 END), 0)
               FROM credit_reservation WHERE campaign_id=?""",
            (reservation.campaign_id,),
        ).fetchone()[0]
        if int(used) + reservation.max_cost > int(row[0]):
            connection.rollback()
            return False
        _insert_dataclass(connection, "credit_reservation", reservation)
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise


def settle_credit(
    connection: sqlite3.Connection,
    reservation_id: str,
    actual_cost: int,
    settled_at: str,
) -> str:
    if actual_cost < 0:
        raise ValueError("actual_cost must be non-negative")
    connection.execute("BEGIN IMMEDIATE")
    try:
        row = connection.execute(
            "SELECT max_cost,state FROM credit_reservation WHERE reservation_id=?",
            (reservation_id,),
        ).fetchone()
        if row is None:
            raise KeyError(reservation_id)
        if row["state"] != "reserved":
            raise ValueError("reservation is not reserved")
        state = "settled" if actual_cost <= row["max_cost"] else "overage_error"
        connection.execute(
            """UPDATE credit_reservation
               SET actual_cost=?,state=?,settled_at=? WHERE reservation_id=?""",
            (actual_cost, state, settled_at, reservation_id),
        )
        if state == "overage_error":
            _record_credit_terminal(
                connection, reservation_id, "credit_overage", "error", actual_cost,
                settled_at,
            )
            campaign_id = connection.execute(
                "SELECT campaign_id FROM credit_reservation WHERE reservation_id=?",
                (reservation_id,),
            ).fetchone()[0]
            connection.execute(
                "UPDATE campaign SET status='paused' WHERE campaign_id=?", (campaign_id,)
            )
            connection.execute(
                "INSERT INTO audit VALUES(?,?,?,?,?,?,?,?,?)",
                ("audit-credit-" + reservation_id, "desktop-executor", "adapter_disabled",
                 "campaign", campaign_id, settled_at, None, None, "credit_overage"),
            )
        connection.commit()
        return state
    except Exception:
        connection.rollback()
        raise


def release_credit(
    connection: sqlite3.Connection, reservation_id: str, released_at: str
) -> None:
    connection.execute("BEGIN IMMEDIATE")
    try:
        changed = connection.execute(
            """UPDATE credit_reservation
               SET actual_cost=0,state='released',settled_at=?
               WHERE reservation_id=? AND state='reserved'""",
            (released_at, reservation_id),
        )
        if changed.rowcount != 1:
            raise ValueError("reservation is not reserved")
        _record_credit_terminal(
            connection, reservation_id, "credit_release", "skipped_budget", 0,
            released_at,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _record_credit_terminal(
    connection: sqlite3.Connection,
    reservation_id: str,
    call: str,
    result: str,
    credits: int,
    at: str,
) -> None:
    row = connection.execute(
        """SELECT cr.provider,cr.exec_request_id,er.payload
           FROM credit_reservation AS cr
           JOIN exec_request AS er ON er.request_id=cr.exec_request_id
           WHERE cr.reservation_id=?""",
        (reservation_id,),
    ).fetchone()
    if row is None:
        raise KeyError(reservation_id)
    person_id = json.loads(row["payload"])["person_id"]
    digest = __import__("hashlib").sha256(reservation_id.encode("ascii")).hexdigest()
    insert_provider_attempt(connection, ProviderAttempt(
        "pa_" + digest[:16], person_id, row["provider"], call, digest,
        0, credits, result, at, at, None,
    ))
```

- [ ] Step 4: Run tests, expect PASS — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_14_two_workers_one_credit_allows_one_reservation scripts/prospecting/tests/test_store.py::test_15_credit_settle_release_and_overage -q`; expect `2 passed`, exactly one winning reservation at one remaining credit, and terminal states `settled`, `released`, `overage_error`.

- [ ] Step 5: Report — report the atomic `BEGIN IMMEDIATE` budget condition, two-worker outcome `[False, True]`, immutable reservation accounting, state-transition coverage, `+2` tests, and no manifest entries yet; do not commit.

### Task 4: Typed policy, lane, eligibility, request, and approval contracts

**Files:** Create `scripts/prospecting/tests/test_contracts.py`; Modify `scripts/prospecting/store.py` (lines 1-end; append after `release_credit`), `orgs/prospecting/data-contracts.md` (lines 1-end; replace); Test `scripts/prospecting/tests/test_contracts.py`

**Interfaces:** Consumes: opaque company resolver `Callable[[str], str | None]`, schema `campaign`, `revision`, `reply_template`, `approval`, and `exec_request` tables / Produces: `Predicate`, `TargetPolicy`, `LaneCapability`, `PredicateOverride`, `EligibilityDecision`, `ExecRequest`, `compile_target_policy(raw: Mapping[str,object], resolve_company: Callable[[str],str | None]) -> TargetPolicy`, `validate_target_policy(policy: TargetPolicy) -> None`, `select_lanes(policy: TargetPolicy, capabilities: Mapping[str,Mapping[str,LaneCapability]], overrides: set[PredicateOverride], campaign_id: str, policy_hash: str) -> tuple[str,...]`, `decide_eligibility(...) -> EligibilityDecision`, `validate_exec_request(request: ExecRequest, campaign_tier: str) -> None`, `insert_exec_request(connection, request, campaign_tier: str) -> None`

- [ ] Step 1: Write the failing test — create `scripts/prospecting/tests/test_contracts.py` with this complete 11-test module.

```python
import sqlite3
from pathlib import Path

import pytest

from scripts.prospecting.store import (
    EligibilityDecision,
    ExecRequest,
    LaneCapability,
    Predicate,
    PredicateOverride,
    TargetPolicy,
    approval_scope_hash,
    compile_target_policy,
    decide_eligibility,
    get_eligibility_decision,
    insert_eligibility_decision,
    insert_exec_request,
    insert_predicate_override,
    open_store,
    select_lanes,
    validate_exec_request,
    validate_target_policy,
)


def _policy(*predicates: Predicate) -> TargetPolicy:
    return TargetPolicy(tuple(predicates), 2, 4, (), ("manual",), "score-v1")


def _request(operation: str, approval_id: str | None = None) -> ExecRequest:
    payloads = {
        "fetch_snapshot": {"entity_id": "per_1111111111111111", "snapshot_id": "obs_1111111111111111"},
        "finder_page": {"finder_run_id": "camp_1111111111111111", "lane": "manual"},
        "vendor_lookup": {"person_id": "per_1111111111111111", "provider": "hunter"},
        "gmail_draft": {"revision_id": "rev_1111111111111111", "contact_id": "cp_1111111111111111", "mailbox_id": "pol_1111111111111111"},
        "gmail_send": {"delivery_id": "req_1111111111111111"},
        "gmail_label": {"gmail_thread_id": "req_1111111111111111", "label_code": "sent"},
        "gmail_thread_refresh": {"gmail_thread_id": "req_1111111111111111"},
    }
    caller = "prospecting-list-builder" if operation in {
        "fetch_snapshot", "finder_page", "vendor_lookup"
    } else "prospecting-campaigner"
    return ExecRequest("req_1111111111111111", caller, operation, payloads[operation], "a" * 64,
                       approval_id, "2026-09-03T00:00:00Z", "queued", None)


def _seed_approval_graph(connection: sqlite3.Connection) -> None:
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender-1", "Synthetic Sender", None, "testing", "testing", "proof", "[]"),
    )
    campaign_values = (
        "campaign-1", "networking", "sender-1", '{"predicates":[]}',
        "informational_call", 15, "direct", "networking-v1", "[]", "09:00-17:00",
        "America/New_York", 25, 6, 2, "T1", "mailbox-1", "{}", 0, "approved", "a" * 64,
    )
    connection.execute(
        "INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        campaign_values,
    )
    connection.execute(
        "INSERT INTO company VALUES(?,?,?,?,?,?,?,?,?)",
        ("company-1", "Example Test", "https://example.test", None, None, None, None,
         "manual", "example.test"),
    )
    connection.execute(
        "INSERT INTO person VALUES(?,?,?,?,?,?,?,?)",
        ("person-1", "Casey", "Casey Example", None, None, None, "manual", "casey"),
    )
    connection.execute(
        """INSERT INTO contact_point(
           contact_id,person_id,employer_company_id,email,provider,adapter_version,state,confidence
           ) VALUES(?,?,?,?,?,?,?,?)""",
        ("contact-1", "person-1", "company-1", "casey" + chr(64) + "example.test", "manual", "v1",
         "valid", 1.0),
    )
    connection.execute(
        """INSERT INTO revision(
          revision_id,person_id,campaign_id,step,subject,body,angle,generation_mode,purpose,ask,
          evidence_ids,recipient_relevance_points,sender_proof_points,template_id,template_version,
          prompt_version,model_version,qa,hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("revision-1", "person-1", "campaign-1", 0, "Synthetic subject", "Synthetic body",
         "why_them", "bespoke", None, "Synthetic ask?", "[]", "[]", "[]", "networking",
         1, "p1", "m1", '{"qa_score":100}', "b" * 64),
    )
    connection.execute(
        "INSERT INTO reply_template VALUES(?,?,?,?)",
        ("template-1", 1, "c" * 64, "2026-09-03T00:00:00Z"),
    )


@pytest.mark.parametrize("predicate_type", (
    "industry", "company_type", "company_stage", "company_location", "person_location",
    "title", "seniority", "school", "platform", "company_list",
))
def test_20_target_policy_accepts_typed_vocabulary(predicate_type: str) -> None:
    value = ("cmp_1111111111111111",) if predicate_type == "company_list" else "typed_code"
    policy = _policy(Predicate("typed_predicate", predicate_type, value))
    validate_target_policy(policy)
    assert policy.predicates[0].value == value


def test_21_target_policy_rejects_duplicate_ids() -> None:
    policy = _policy(Predicate("same", "title", "associate"),
                     Predicate("same", "seniority", "director"))
    with pytest.raises(ValueError, match="predicate_id must be unique"):
        validate_target_policy(policy)
    for unsafe in (
        "two words", "path/value", "back\\slash", "semi;colon", "pipe|value",
        "amp&value", "cash$value", "less<value", "more>value", "tick`value",
        "https://example.test", "name" + chr(64) + "example.test", "code1234567",
    ):
        with pytest.raises(ValueError, match="normalized codes"):
            validate_target_policy(_policy(Predicate("typed", "title", unsafe)))


def test_22_company_list_rejects_names_and_urls() -> None:
    for unsafe in (
        ("Example Test",), ("https://example.test",), "cmp_1111111111111111",
        ("cmp_1111111111111111;drop",), ("cmp_1234567890123456",),
    ):
        with pytest.raises(ValueError, match="opaque company IDs"):
            validate_target_policy(_policy(Predicate("companies", "company_list", unsafe)))


def test_23_desktop_compiler_resolves_ordered_opaque_company_ids() -> None:
    local = {
        "predicates": [{"predicate_id": "companies", "type": "company_list",
                        "value": ["Second Example", "Example Test"]}],
        "requested_companies": 2, "requested_people": 4, "extra_fields": [],
        "lane_plan": ["manual"], "scorer_version": "score-v1",
    }
    ids = {
        "Example Test": "cmp_1111111111111111",
        "Second Example": "cmp_2222222222222222",
        "Ambiguous Example": None,
    }
    compiled = compile_target_policy(local, ids.get)
    assert compiled.predicates[0].value == (
        "cmp_2222222222222222", "cmp_1111111111111111"
    )
    validate_target_policy(compiled)
    local["predicates"][0]["value"] = ["Missing Example"]
    with pytest.raises(ValueError, match="unresolved or ambiguous"):
        compile_target_policy(local, ids.get)
    local["predicates"][0]["value"] = ["Ambiguous Example"]
    with pytest.raises(ValueError, match="unresolved or ambiguous"):
        compile_target_policy(local, ids.get)


def test_24_unsupported_lane_fails_closed() -> None:
    policy = _policy(Predicate("school-1", "school", "school-code-1"))
    capabilities = {"manual": {"school": LaneCapability("unsupported", "no_school", "v1")}}
    with pytest.raises(ValueError, match="unsupported predicate"):
        select_lanes(policy, capabilities, set(), "campaign-1", "a" * 64)


def test_25_approximate_lane_requires_bound_override(tmp_path: Path) -> None:
    policy = _policy(Predicate("location-1", "person_location", "nyc"))
    capabilities = {"manual": {"person_location": LaneCapability("approximate", "metro", "v1")}}
    with pytest.raises(ValueError, match="human override"):
        select_lanes(policy, capabilities, set(), "campaign-1", "a" * 64)
    override = PredicateOverride(
        "pol_1111111111111111", "campaign-1", "a" * 64, "location-1", "manual", "v1",
        "human:daniel", "2026-09-03T00:00:00Z",
    )
    assert select_lanes(
        policy, capabilities, {override}, "campaign-1", "a" * 64
    ) == ("manual",)
    connection = open_store(tmp_path / "override.sqlite")
    _seed_approval_graph(connection)
    insert_predicate_override(connection, override)
    assert tuple(connection.execute(
        "SELECT action,actor FROM audit WHERE entity_id=?", (override.override_id,)
    ).fetchone()) == ("predicate_override", "human:daniel")


def test_26_eligibility_preserves_and_persists_all_outcomes(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "eligibility.sqlite")
    _seed_approval_graph(connection)
    connection.execute(
        "INSERT INTO fit_score_version VALUES(?,?,?,?,?,?)",
        ("score-v1", "v1", "{}", "f" * 64, "2026-09-03T00:00:00Z", "2026-09-03T00:00:00Z"),
    )
    cases = (
        ("dec-ineligible", ("title-1", "school-1"), ("location-1",), None, "ineligible"),
        ("dec-needs", (), ("location-1",), None, "needs_override"),
        ("dec-eligible", (), (), None, "eligible"),
    )
    for decision_id, failed, approximate, override_id, outcome in cases:
        decision = decide_eligibility(
            decision_id, "campaign-1", "person-1", "rules-v1", "score-v1",
            failed, approximate, "2026-09-03T00:00:00Z", override_id,
        )
        assert decision.outcome == outcome
        insert_eligibility_decision(connection, decision)
        assert get_eligibility_decision(connection, decision_id) == decision


def test_27_non_send_operations_forbid_approval() -> None:
    for operation in ("fetch_snapshot", "finder_page", "vendor_lookup", "gmail_draft",
                      "gmail_label", "gmail_thread_refresh"):
        with pytest.raises(ValueError, match="approval_id must be null"):
            validate_exec_request(_request(operation, "apr_1111111111111111"), "T1")
    malformed = (
        ("finder_page", "lane", "manual now"),
        ("finder_page", "lane", "manual;drop"),
        ("vendor_lookup", "provider", "curl"),
        ("gmail_label", "label_code", "Outreach/Sent"),
        ("vendor_lookup", "person_id", "per_123456789012345g"),
        ("gmail_draft", "revision_id", "rev_1111111111111111@token"),
        ("gmail_thread_refresh", "gmail_thread_id", "https://example.test"),
        ("fetch_snapshot", "entity_id", "per_1111111111111111\\x"),
        ("gmail_send", "delivery_id", "req_1111111111111111$cmd"),
    )
    for operation, field, unsafe in malformed:
        request = _request(operation, "apr_1111111111111111" if operation == "gmail_send" else None)
        with pytest.raises(ValueError):
            validate_exec_request(replace(request, payload={**request.payload, field: unsafe}), "T1")


def test_28_enabled_send_requires_complete_bound_approval(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="approval_id is required"):
        validate_exec_request(_request("gmail_send"), "T1")
    connection = open_store(tmp_path / "send-approval.sqlite")
    _seed_approval_graph(connection)
    connection.execute(
        "INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?)",
        ("enrollment-1", "campaign-1", "person-1", 0, None, "approved", None, None, None),
    )
    connection.execute(
        "INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("req_1111111111111111", "campaign-1", "enrollment-1", 0, "b" * 64,
         "contact-1", "mailbox-1", "1" * 64, None, None, "message-1", None, None,
         None, "reserved"),
    )
    fields = {
        "assertion_ref": "assertion-1", "campaign_id": "campaign-1",
        "policy_hash": "a" * 64, "content_kind": "revision", "revision_hash": "b" * 64,
        "contact_id": "contact-1", "mailbox_id": "mailbox-1", "approver": "human:daniel",
        "approved_at": "2026-09-03T00:00:00Z", "expires_at": "2026-09-04T00:00:00Z",
        "tier": "T1", "send_window": '{"start":"2026-09-03T00:00:00Z","end":"2026-09-04T00:00:00Z"}',
        "nonce": "nonce-valid", "permitted_action": "send_revision",
    }
    scope_hash = approval_scope_hash(fields)
    connection.execute(
        """INSERT INTO approval VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("apr_1111111111111111", fields["assertion_ref"], fields["campaign_id"],
         fields["policy_hash"], fields["content_kind"], fields["revision_hash"],
         fields["contact_id"], fields["mailbox_id"], fields["approver"],
         fields["approved_at"], fields["expires_at"], fields["tier"], fields["send_window"],
         fields["nonce"], fields["permitted_action"], None, scope_hash, None),
    )
    request = _request("gmail_send", "apr_1111111111111111")
    validate_exec_request(request, "T1", connection, "2026-09-03T12:00:00Z")
    mutations = (
        ("approver", "agent:worker"), ("expires_at", "2026-09-02T00:00:00Z"),
        ("consumed_at", "2026-09-03T01:00:00Z"), ("invalidation_reason", "revoked"),
        ("nonce", ""), ("scope_hash", "0" * 64),
    )
    for column, unsafe in mutations:
        original = connection.execute(
            f"SELECT {column} FROM approval WHERE approval_id=?", (request.approval_id,)
        ).fetchone()[0]
        connection.execute(
            f"UPDATE approval SET {column}=? WHERE approval_id=?", (unsafe, request.approval_id)
        )
        with pytest.raises(ValueError, match="approval"):
            validate_exec_request(request, "T1", connection, "2026-09-03T12:00:00Z")
        connection.execute(
            f"UPDATE approval SET {column}=? WHERE approval_id=?", (original, request.approval_id)
        )
    with pytest.raises(ValueError, match="approval"):
        validate_exec_request(
            replace(request, approval_id="apr_9999999999999999"), "T1", connection,
            "2026-09-03T12:00:00Z",
        )


def test_29_t0_send_is_rejected() -> None:
    with pytest.raises(ValueError, match="T0 gmail_send is disabled"):
        validate_exec_request(_request("gmail_send", "apr_1111111111111111"), "T0")


def test_30_policy_hash_nonunique_and_approval_kind_resolution(
    tmp_path: Path, record_property
) -> None:
    connection = open_store(tmp_path / "contracts.sqlite")
    _seed_approval_graph(connection)
    duplicate = list(connection.execute(
        "SELECT * FROM campaign WHERE campaign_id='campaign-1'"
    ).fetchone())
    duplicate[0] = "campaign-2"
    connection.execute(
        "INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", duplicate
    )
    assert connection.execute(
        "SELECT count(*) FROM campaign WHERE policy_hash=?", ("a" * 64,)
    ).fetchone()[0] == 2
    record_property("shared_policy_hash_campaigns", 2)
    base = (
        "assertion-1", "campaign-1", "a" * 64, "contact-1", "mailbox-1", "daniel",
        "2026-09-03T00:00:00Z", "2026-09-04T00:00:00Z", "T1",
        '{"start":"2026-09-03T00:00:00Z","end":"2026-09-04T00:00:00Z"}',
    )
    connection.execute(
        """INSERT INTO approval VALUES(
           ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("apr_1111111111111111", base[0], base[1], base[2], "revision", "b" * 64,
         base[3], base[4], base[5], base[6], base[7], base[8], base[9], "nonce-1",
         "send_revision", None, "d" * 64, None),
    )
    connection.execute(
        """INSERT INTO approval VALUES(
           ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("apr_2222222222222222", base[0], base[1], base[2], "reply_template", "c" * 64,
         base[3], base[4], base[5], base[6], base[7], base[8], base[9], "nonce-2",
         "send_preapproved_reply_template", None, "e" * 64, None),
    )
    with pytest.raises(sqlite3.IntegrityError, match="revision hash"):
        connection.execute(
            """INSERT INTO approval VALUES(
               ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("apr_3333333333333333", base[0], base[1], base[2], "revision", "c" * 64,
             base[3], base[4], base[5], base[6], base[7], base[8], base[9], "nonce-3",
             "send_revision", None, "f" * 64, None),
        )
    with pytest.raises(sqlite3.IntegrityError, match="reply-template hash"):
        connection.execute(
            """INSERT INTO approval VALUES(
               ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("apr_4444444444444444", base[0], base[1], base[2], "reply_template", "b" * 64,
             base[3], base[4], base[5], base[6], base[7], base[8], base[9], "nonce-4",
             "send_preapproved_reply_template", None, "1" * 64, None),
        )
    with pytest.raises(sqlite3.IntegrityError, match="revision hash"):
        connection.execute(
            "UPDATE approval SET revision_hash=? WHERE approval_id=?",
            ("c" * 64, "apr_1111111111111111"),
        )
    with pytest.raises(sqlite3.IntegrityError, match="campaign and policy hash mismatch"):
        connection.execute(
            """INSERT INTO approval VALUES(
               ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("apr_5555555555555555", base[0], base[1], "9" * 64, "revision", "b" * 64,
             base[3], base[4], base[5], base[6], base[7], base[8], base[9], "nonce-5",
             "send_revision", None, "2" * 64, None),
        )
    with pytest.raises(sqlite3.IntegrityError, match="campaign and policy hash mismatch"):
        connection.execute(
            "UPDATE approval SET policy_hash=? WHERE approval_id=?",
            ("9" * 64, "apr_1111111111111111"),
        )
```

- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_contracts.py::test_20_target_policy_accepts_typed_vocabulary -q`; expect `ImportError: cannot import name 'Predicate'`.

- [ ] Step 3: Minimal implementation — append this complete contract implementation to `store.py`; then replace `data-contracts.md` with the exact normative summary below.

```python
from collections.abc import Callable
import re

PREDICATE_TYPES = frozenset({
    "industry", "company_type", "company_stage", "company_location", "person_location",
    "title", "seniority", "school", "platform", "company_list",
})
CAPABILITY_OUTCOMES = frozenset({"exact", "approximate", "unsupported"})
OPAQUE_ID_RE = re.compile(
    r"^(cmp|per|cp|obs|emp|mr|pa|cr|pol|camp|req|apr|rev|rt)_[0-9a-f]{16}$"
)
OPAQUE_COMPANY_ID_RE = re.compile(r"^cmp_[0-9a-f]{16}$")
NORMALIZED_VALUE_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
FORBIDDEN_VALUE_RE = re.compile(r"\s|[/\\;|&$<>`]|@|://|\d{7,}", re.IGNORECASE)
LANE_CODES = frozenset({
    "linkedin_assisted", "class_c_public_profile", "manual", "pitchbook", "pdl",
})
PROVIDER_CODES = frozenset({"manual", "hunter", "snov", "fullenrich", "pdl", "pattern"})
LABEL_CODES = frozenset({
    "sent", "followup_due", "replied", "ooo", "bounced",
    "closed_no_reply", "closed_declined",
})
FIELD_ID_PREFIXES = {
    "entity_id": frozenset({"cmp", "per", "cp", "emp"}),
    "snapshot_id": frozenset({"obs"}),
    "finder_run_id": frozenset({"camp"}),
    "person_id": frozenset({"per"}),
    "revision_id": frozenset({"rev"}),
    "contact_id": frozenset({"cp"}),
    "mailbox_id": frozenset({"pol"}),
    "delivery_id": frozenset({"req"}),
    "gmail_thread_id": frozenset({"req"}),
}
OPERATION_KEYS = {
    "fetch_snapshot": frozenset({"entity_id", "snapshot_id"}),
    "finder_page": frozenset({"finder_run_id", "lane"}),
    "vendor_lookup": frozenset({"person_id", "provider"}),
    "gmail_draft": frozenset({"revision_id", "contact_id", "mailbox_id"}),
    "gmail_send": frozenset({"delivery_id"}),
    "gmail_label": frozenset({"gmail_thread_id", "label_code"}),
    "gmail_thread_refresh": frozenset({"gmail_thread_id"}),
}
CALLER_OPERATIONS = {
    "prospecting-list-builder": frozenset({"fetch_snapshot", "finder_page", "vendor_lookup"}),
    "prospecting-campaigner": frozenset({"gmail_draft", "gmail_send", "gmail_label", "gmail_thread_refresh"}),
}


@dataclass(frozen=True)
class Predicate:
    predicate_id: str
    type: str
    value: str | tuple[str, ...]


@dataclass(frozen=True)
class TargetPolicy:
    predicates: tuple[Predicate, ...]
    requested_companies: int
    requested_people: int
    extra_fields: tuple[str, ...]
    lane_plan: tuple[str, ...]
    scorer_version: str


@dataclass(frozen=True)
class LaneCapability:
    outcome: str
    reason_code: str
    version: str


@dataclass(frozen=True)
class PredicateOverride:
    override_id: str
    campaign_id: str
    policy_hash: str
    predicate_id: str
    lane: str
    capability_version: str
    decided_by: str
    decided_at: str


@dataclass(frozen=True)
class EligibilityDecision:
    decision_id: str
    campaign_id: str
    person_id: str
    rule_version: str
    fit_score_version_id: str
    outcome: str
    failed_predicate_ids: tuple[str, ...]
    approximate_predicate_ids: tuple[str, ...]
    decided_at: str
    override_id: str | None


@dataclass(frozen=True)
class ExecRequest:
    request_id: str
    caller: str
    operation: str
    payload: dict[str, str]
    policy_hash: str
    approval_id: str | None
    created_at: str
    state: str = "queued"
    reason: str | None = None


def validate_target_policy(policy: TargetPolicy) -> None:
    if policy.requested_companies < 0 or policy.requested_people < 0:
        raise ValueError("requested counts must be non-negative")
    ids = [predicate.predicate_id for predicate in policy.predicates]
    if len(ids) != len(set(ids)):
        raise ValueError("predicate_id must be unique")
    for predicate in policy.predicates:
        if predicate.type not in PREDICATE_TYPES:
            raise ValueError("predicate type is not allowed")
        if predicate.type == "company_list" and isinstance(predicate.value, str):
            raise ValueError("company_list requires ordered opaque company IDs")
        values = (predicate.value,) if isinstance(predicate.value, str) else predicate.value
        if not values or any(not isinstance(value, str) or not value for value in values):
            raise ValueError("predicate values must be non-empty normalized scalars")
        if predicate.type == "company_list":
            if any(OPAQUE_COMPANY_ID_RE.fullmatch(value) is None for value in values):
                raise ValueError("company_list requires opaque company IDs")
        elif any(
            NORMALIZED_VALUE_RE.fullmatch(value) is None
            or FORBIDDEN_VALUE_RE.search(value) is not None
            for value in values
        ):
            raise ValueError("predicate values must be normalized codes")
    if not policy.scorer_version:
        raise ValueError("scorer_version is required")


def compile_target_policy(
    raw: Mapping[str, object], resolve_company: Callable[[str], str | None]
) -> TargetPolicy:
    predicates: list[Predicate] = []
    for item in raw["predicates"]:  # type: ignore[index]
        record = dict(item)  # type: ignore[arg-type]
        value: object = record["value"]
        if record["type"] == "company_list":
            resolved: list[str] = []
            for name in value:  # type: ignore[union-attr]
                company_id = resolve_company(str(name))
                if company_id is None:
                    raise ValueError("company name is unresolved or ambiguous")
                resolved.append(company_id)
            value = tuple(resolved)
        elif isinstance(value, list):
            value = tuple(str(part) for part in value)
        predicates.append(Predicate(str(record["predicate_id"]), str(record["type"]), value))  # type: ignore[arg-type]
    policy = TargetPolicy(
        tuple(predicates), int(raw["requested_companies"]), int(raw["requested_people"]),
        tuple(str(item) for item in raw["extra_fields"]),  # type: ignore[union-attr]
        tuple(str(item) for item in raw["lane_plan"]),  # type: ignore[union-attr]
        str(raw["scorer_version"]),
    )
    validate_target_policy(policy)
    return policy


def select_lanes(
    policy: TargetPolicy,
    capabilities: Mapping[str, Mapping[str, LaneCapability]],
    overrides: set[PredicateOverride],
    campaign_id: str,
    policy_hash: str,
) -> tuple[str, ...]:
    selected: list[str] = []
    for lane in policy.lane_plan:
        lane_map = capabilities.get(lane, {})
        for predicate in policy.predicates:
            capability = lane_map.get(predicate.type)
            if capability is None or capability.outcome not in CAPABILITY_OUTCOMES:
                raise ValueError("capability map is incomplete")
            if capability.outcome == "unsupported":
                raise ValueError("unsupported predicate")
            if capability.outcome == "approximate":
                matched = any(
                    item.campaign_id == campaign_id
                    and item.policy_hash == policy_hash
                    and item.predicate_id == predicate.predicate_id
                    and item.lane == lane
                    and item.capability_version == capability.version
                    and item.decided_by.startswith("human:")
                    for item in overrides
                )
                if not matched:
                    raise ValueError("approximate predicate requires human override")
        selected.append(lane)
    return tuple(selected)


def decide_eligibility(
    decision_id: str,
    campaign_id: str,
    person_id: str,
    rule_version: str,
    fit_score_version_id: str,
    failed_predicate_ids: tuple[str, ...],
    approximate_predicate_ids: tuple[str, ...],
    decided_at: str,
    override_id: str | None,
) -> EligibilityDecision:
    if failed_predicate_ids:
        outcome = "ineligible"
    elif approximate_predicate_ids and override_id is None:
        outcome = "needs_override"
    else:
        outcome = "eligible"
    return EligibilityDecision(
        decision_id, campaign_id, person_id, rule_version, fit_score_version_id, outcome,
        failed_predicate_ids, approximate_predicate_ids, decided_at, override_id,
    )


def _validate_opaque(value: str, field: str) -> None:
    match = OPAQUE_ID_RE.fullmatch(value)
    if match is None or (
        field in FIELD_ID_PREFIXES and match.group(1) not in FIELD_ID_PREFIXES[field]
    ):
        raise ValueError(f"{field} must be a typed opaque ID")


def approval_scope_hash(values: Mapping[str, object]) -> str:
    keys = (
        "assertion_ref", "campaign_id", "policy_hash", "content_kind", "revision_hash",
        "contact_id", "mailbox_id", "approver", "approved_at", "expires_at", "tier",
        "send_window", "nonce", "permitted_action",
    )
    canonical = json.dumps(
        {key: values[key] for key in keys}, sort_keys=True, separators=(",", ":")
    )
    return __import__("hashlib").sha256(canonical.encode("utf-8")).hexdigest()


def validate_exec_request(
    request: ExecRequest,
    campaign_tier: str,
    connection: sqlite3.Connection | None = None,
    now: str | None = None,
) -> None:
    _validate_opaque(request.request_id, "request_id")
    if re.fullmatch(r"[0-9a-f]{64}", request.policy_hash) is None:
        raise ValueError("policy_hash must be lowercase SHA-256")
    if request.approval_id is not None:
        if re.fullmatch(r"apr_[0-9a-f]{16}", request.approval_id) is None:
            raise ValueError("approval_id must be a typed opaque ID")
    allowed = CALLER_OPERATIONS.get(request.caller)
    if allowed is None or request.operation not in allowed:
        raise ValueError("caller is not allowed for operation")
    expected_keys = OPERATION_KEYS[request.operation]
    if frozenset(request.payload) != expected_keys:
        raise ValueError("payload keys do not match operation contract")
    if any(not isinstance(value, str) or not value for value in request.payload.values()):
        raise ValueError("payload values must be opaque non-empty strings")
    for field, value in request.payload.items():
        if field == "lane":
            if value not in LANE_CODES:
                raise ValueError("lane must be an enumerated code")
            if FORBIDDEN_VALUE_RE.search(value):
                raise ValueError("payload values contain forbidden free-form content")
        elif field == "provider":
            if value not in PROVIDER_CODES:
                raise ValueError("provider must be an enumerated code")
            if FORBIDDEN_VALUE_RE.search(value):
                raise ValueError("payload values contain forbidden free-form content")
        elif field == "label_code":
            if value not in LABEL_CODES:
                raise ValueError("label_code must be an enumerated code")
            if FORBIDDEN_VALUE_RE.search(value):
                raise ValueError("payload values contain forbidden free-form content")
        else:
            _validate_opaque(value, field)
    if request.operation != "gmail_send" and request.approval_id is not None:
        raise ValueError("approval_id must be null for this operation")
    if request.operation == "gmail_send":
        if campaign_tier == "T0":
            raise ValueError("T0 gmail_send is disabled")
        if request.approval_id is None:
            raise ValueError("approval_id is required for gmail_send")
        if connection is None or now is None:
            raise ValueError("approval validation requires store and current UTC time")
        row = connection.execute(
            """SELECT a.*,d.campaign_id AS delivery_campaign,
                      d.revision_hash AS delivery_revision,d.contact_id AS delivery_contact,
                      d.mailbox_id AS delivery_mailbox,c.policy_hash AS current_policy
               FROM approval AS a
               JOIN delivery AS d ON d.delivery_id=?
               JOIN campaign AS c ON c.campaign_id=d.campaign_id
               WHERE a.approval_id=?""",
            (request.payload["delivery_id"], request.approval_id),
        ).fetchone()
        if row is None:
            raise ValueError("approval is unresolved")
        window = json.loads(row["send_window"])
        invalid = (
            row["campaign_id"] != row["delivery_campaign"]
            or row["policy_hash"] != row["current_policy"]
            or row["revision_hash"] != row["delivery_revision"]
            or row["contact_id"] != row["delivery_contact"]
            or row["mailbox_id"] != row["delivery_mailbox"]
            or not str(row["approver"]).startswith("human:")
            or row["consumed_at"] is not None
            or row["invalidation_reason"] is not None
            or not row["nonce"]
            or not (row["approved_at"] <= now <= row["expires_at"])
            or not (window["start"] <= now <= window["end"])
            or row["scope_hash"] != approval_scope_hash(dict(row))
        )
        if invalid:
            raise ValueError("approval scope, freshness, nonce, route, or hash is invalid")


def insert_exec_request(
    connection: sqlite3.Connection, request: ExecRequest, campaign_tier: str
) -> None:
    now = request.created_at if request.operation == "gmail_send" else None
    validate_exec_request(request, campaign_tier, connection, now)
    values = asdict(request)
    values["payload"] = json.dumps(request.payload, sort_keys=True, separators=(",", ":"))
    columns = ",".join(values)
    bind_marks = ",".join("?" for _ in values)
    connection.execute(
        f"INSERT INTO exec_request({columns}) VALUES({bind_marks})", tuple(values.values())
    )


def insert_predicate_override(
    connection: sqlite3.Connection, override: PredicateOverride
) -> None:
    if not override.decided_by.startswith("human:"):
        raise ValueError("predicate override requires a human decision")
    _insert_dataclass(connection, "predicate_override", override)
    connection.execute(
        "INSERT INTO audit VALUES(?,?,?,?,?,?,?,?,?)",
        ("audit-" + override.override_id, override.decided_by, "predicate_override",
         "predicate_override", override.override_id, override.decided_at, None,
         override.policy_hash, "approximate_capability"),
    )


def insert_eligibility_decision(
    connection: sqlite3.Connection, decision: EligibilityDecision
) -> None:
    _insert_dataclass(
        connection, "eligibility_decision", decision,
        ("failed_predicate_ids", "approximate_predicate_ids"),
    )


def get_eligibility_decision(
    connection: sqlite3.Connection, decision_id: str
) -> EligibilityDecision:
    row = connection.execute(
        "SELECT * FROM eligibility_decision WHERE decision_id=?", (decision_id,)
    ).fetchone()
    if row is None:
        raise KeyError(decision_id)
    values = dict(row)
    values["failed_predicate_ids"] = tuple(json.loads(values["failed_predicate_ids"]))
    values["approximate_predicate_ids"] = tuple(json.loads(values["approximate_predicate_ids"]))
    return EligibilityDecision(**values)
```

`orgs/prospecting/data-contracts.md`

```markdown
# Prospecting data contracts

SQLite is canonical. JSON is UTF-8, sorted-key, compact canonical JSON at repository boundaries.
Timestamps are UTC ISO 8601 except the explicit local `HH:MM-HH:MM` policy window. IDs crossing the
VM boundary are opaque and match `^(cmp|per|cp|obs|emp|mr|pa|cr|pol|camp|req|apr|rev|rt)_[0-9a-f]{16}$`
with the prefix required by the field kind. PII remains desktop-local.

## `target_policy`
`TargetPolicy(predicates, requested_companies, requested_people, extra_fields, lane_plan,
scorer_version)` is immutable. Each ordered predicate is exactly `Predicate(predicate_id,type,value)`.
Allowed types are `industry`, `company_type`, `company_stage`, `company_location`,
`person_location`, `title`, `seniority`, `school`, `platform`, and `company_list`. A company list is
an ordered tuple of opaque company IDs. The desktop-only compiler resolves locally entered names;
unresolved or ambiguous names fail. A VM-bound policy containing a name, URL, message, or free-form
predicate fails.

## Lane capability and eligibility
Each lane/type entry is `LaneCapability(outcome,reason_code,version)`, where outcome is `exact`,
`approximate`, or `unsupported`. Unsupported predicates fail. Approximate predicates require a
human-authored `PredicateOverride` bound to campaign, policy hash, predicate, lane, and capability
version before selection. Overrides and decisions are persisted in SQLite and override creation is
audited. `EligibilityDecision` preserves
ordered failed and approximate IDs; failures produce `ineligible`, an unoverridden approximation
produces `needs_override`, and only the remaining case produces `eligible`.

## `exec_request`
`ExecRequest(request_id,caller,operation,payload,policy_hash,approval_id,created_at,state,reason)`
accepts an allow-listed caller/operation pair and an exact per-operation payload-key set. `operation`,
`lane`, `provider`, and `label_code` use closed enumerations. All other payload strings are typed
opaque IDs. Values containing whitespace, `/`, `\`, `;`, `|`, `&`, `$`, `<`, `>`, backticks, URLs,
`@`, or digit runs of seven or more are rejected before insertion. Payloads never contain commands,
credentials, or PII. Non-send
operations require null approval. T0 send is disabled. An enabled-tier send requires non-null
approval before insertion.

## Approval
The schema binds campaign and non-unique policy hash, content kind/hash, contact, mailbox, approver,
tier, UTC window, single-use nonce, permitted action, and scope hash. An insert/update trigger makes
`content_kind=revision` resolve exactly once in `revision.hash` and `content_kind=reply_template`
resolve exactly once in `reply_template.body_hash`; cross-kind resolution fails.
```

- [ ] Step 4: Run tests, expect PASS — `py -3 -m pytest scripts/prospecting/tests/test_contracts.py -q`; expect all 11 enumerated test functions to pass, including all ten predicate types, persisted/audited overrides and eligibility outcomes, the hostile payload matrix, two campaigns sharing one `policy_hash`, both valid approval-resolution kinds, both cross-kind rejections, and update-trigger rejection.

- [ ] Step 5: Report — report the exact predicate vocabulary, ordered opaque company resolution, lane fail-closed behavior, eligibility outcomes, seven operation schemas, caller matrix, approval applicability, policy-hash duplicate count `2`, `+11` tests, and no manifest entries yet; do not commit.

### Task 5: Seven-class runtime PII guard and staged-file commit blocker

**Files:** Create `scripts/prospecting/pii_guard.py`, `orgs/prospecting/fixtures/pii-cases.json`, `scripts/prospecting/tests/test_pii_guard.py`; Modify `.githooks/pre-commit` (append after line 20, preserving all existing sync checks); Test `scripts/prospecting/tests/test_pii_guard.py`

**Interfaces:** Consumes: JSON fixture list, structured value `object`, sink enum, staged Git index / Produces: `PIIClass`, `PIIViolation`, `assert_vm_safe(value: object, sink: str, known_names: tuple[str,...] = ()) -> None`, `find_text_classes(text: str, known_names: tuple[str,...] = ()) -> frozenset[PIIClass]`, `scan_staged(repo: Path = Path.cwd()) -> tuple[PIIViolation,...]`, CLI exit `0` clean or `1` blocked with path/line/class only

- [ ] Step 1: Write the failing tests in
  `scripts/prospecting/tests/test_pii_guard.py`. The committed module is the canonical
  executable specification: it loads `orgs/prospecting/fixtures/pii-cases.json`, checks
  every PII class across every VM sink, verifies that errors never echo payloads, covers
  encoded forms and staged-file detection, and proves that fixture exceptions remain
  limited to validated synthetic data. Keep scanner-positive values in the fixture or
  construct them only inside that test module; do not duplicate them in this plan.
- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_pii_guard.py::test_31_every_pii_class_is_caught_at_every_vm_sink -q`; expect `ModuleNotFoundError: No module named 'scripts.prospecting.pii_guard'`.

- [ ] Step 3: Minimal implementation — create the complete guard and fixture, then replace `.githooks/pre-commit` with the complete preserved hook plus its final PII invocation.

`scripts/prospecting/pii_guard.py`

```python
"""Fail-closed PII checks for repo staging and VM-bound runtime values."""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any
from urllib.parse import unquote


class PIIClass(str, Enum):
    NAME = "name"
    EMAIL = "email"
    PHONE = "phone"
    PROFILE_URL = "profile_url"
    NOTE = "note"
    EXCERPT = "excerpt"
    BODY = "body"


VM_SINKS = frozenset({
    "process_arguments", "process_results", "stdout", "stderr",
    "logs", "cards", "ledgers", "exceptions",
})
SENSITIVE_FIELDS = {
    "name": PIIClass.NAME,
    "first_name": PIIClass.NAME,
    "full_name": PIIClass.NAME,
    "email": PIIClass.EMAIL,
    "phone": PIIClass.PHONE,
    "profile_url": PIIClass.PROFILE_URL,
    "linkedin_url": PIIClass.PROFILE_URL,
    "person_note": PIIClass.NOTE,
    "note": PIIClass.NOTE,
    "excerpt": PIIClass.EXCERPT,
    "body": PIIClass.BODY,
    "message_body": PIIClass.BODY,
}
EMAIL_RE = re.compile(r"(?i)(?<![\w.+-])[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?1[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]\d{4}(?!\d)")
PROFILE_RE = re.compile(r"(?i)https?://(?:www\.)?linkedin\.com/in/[a-z0-9_%./-]+")
NOTE_RE = re.compile(r"(?i)\[\[person-note:[^\]]+\]\]")
EXCERPT_RE = re.compile(r"(?i)\[\[source-excerpt:[^\]]+\]\]")
BODY_RE = re.compile(r"(?i)\[\[message-body:[^\]]+\]\]")
FIXTURE_ALLOWLIST = frozenset({
    "orgs/prospecting/fixtures/synthetic.json",
    "orgs/prospecting/fixtures/pii-cases.json",
    "orgs/prospecting/fixtures/conflicting-providers.json",
    "orgs/prospecting/fixtures/job-change.json",
})


class PIIGuardError(ValueError):
    def __init__(self, pii_class: PIIClass, sink: str) -> None:
        self.pii_class = pii_class
        self.sink = sink
        super().__init__(f"VM sink blocked: {sink}:{pii_class.value}")


@dataclass(frozen=True)
class PIIViolation:
    path: str
    line: int
    pii_class: PIIClass | str


def _decoded_forms(text: str) -> tuple[str, ...]:
    forms = [text]
    for _ in range(3):
        decoded = html.unescape(unquote(forms[-1]))
        if decoded == forms[-1]:
            break
        forms.append(decoded)
    return tuple(forms)


def find_text_classes(
    text: str, known_names: tuple[str, ...] = ()
) -> frozenset[PIIClass]:
    found: set[PIIClass] = set()
    for form in _decoded_forms(text):
        if EMAIL_RE.search(form):
            found.add(PIIClass.EMAIL)
        if PHONE_RE.search(form):
            found.add(PIIClass.PHONE)
        if PROFILE_RE.search(form):
            found.add(PIIClass.PROFILE_URL)
        if NOTE_RE.search(form):
            found.add(PIIClass.NOTE)
        if EXCERPT_RE.search(form):
            found.add(PIIClass.EXCERPT)
        if BODY_RE.search(form):
            found.add(PIIClass.BODY)
        folded = form.casefold()
        if any(name and name.casefold() in folded for name in known_names):
            found.add(PIIClass.NAME)
    return frozenset(found)


def _walk(value: object, known_names: tuple[str, ...]) -> PIIClass | None:
    if isinstance(value, dict):
        for key, child in value.items():
            sensitive = SENSITIVE_FIELDS.get(str(key).casefold())
            if sensitive is not None and child not in (None, "", [], {}):
                return sensitive
            nested = _walk(child, known_names)
            if nested is not None:
                return nested
    elif isinstance(value, (list, tuple, set)):
        for child in value:
            nested = _walk(child, known_names)
            if nested is not None:
                return nested
    elif isinstance(value, str):
        found = find_text_classes(value, known_names)
        if found:
            return sorted(found, key=lambda item: item.value)[0]
    return None


def assert_vm_safe(
    value: object, sink: str, known_names: tuple[str, ...] = ()
) -> None:
    if sink not in VM_SINKS:
        raise ValueError("unknown VM sink")
    pii_class = _walk(value, known_names)
    if pii_class is not None:
        raise PIIGuardError(pii_class, sink)


def _staged_paths(repo: Path) -> tuple[str, ...]:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        cwd=repo, check=True, capture_output=True,
    )
    return tuple(
        item.decode("utf-8", "strict").replace("\\", "/")
        for item in result.stdout.split(b"\0") if item
    )


def _staged_text(repo: Path, path: str) -> str:
    result = subprocess.run(
        ["git", "show", f":{path}"], cwd=repo, check=True, capture_output=True
    )
    if b"\0" in result.stdout:
        return ""
    return result.stdout.decode("utf-8", "replace")


def _fixture_is_synthetic(text: str) -> bool:
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return False
    strings: list[str] = []

    def collect(item: object) -> None:
        if isinstance(item, dict):
            for child in item.values():
                collect(child)
        elif isinstance(item, list):
            for child in item:
                collect(child)
        elif isinstance(item, str):
            strings.append(item)

    collect(value)
    for item in strings:
        for form in _decoded_forms(item):
            for match in EMAIL_RE.finditer(form):
                if not match.group(0).casefold().endswith(".test"):
                    return False
            if PHONE_RE.search(form) and re.search(r"202[ .-]?555[ .-]?01\d{2}", form) is None:
                return False
            if PROFILE_RE.search(form):
                return False
            if "linkedin." in form.casefold() and ".example.test/" not in form.casefold():
                return False
    return True


def scan_staged(repo: Path = Path.cwd()) -> tuple[PIIViolation, ...]:
    violations: list[PIIViolation] = []
    for path in _staged_paths(repo):
        if path in FIXTURE_ALLOWLIST:
            if not _fixture_is_synthetic(_staged_text(repo, path)):
                violations.append(PIIViolation(path, 1, "fixture_not_synthetic"))
            continue
        for line_number, line in enumerate(_staged_text(repo, path).splitlines(), start=1):
            classes = find_text_classes(line)
            for pii_class in sorted(classes, key=lambda item: item.value):
                if pii_class in {PIIClass.EMAIL, PIIClass.PHONE, PIIClass.PROFILE_URL}:
                    violations.append(PIIViolation(path, line_number, pii_class))
    return tuple(violations)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--staged", action="store_true")
    args = parser.parse_args(argv)
    if not args.staged:
        parser.error("--staged is required")
    violations = scan_staged()
    for violation in violations:
        code = (
            violation.pii_class.value
            if isinstance(violation.pii_class, PIIClass)
            else violation.pii_class
        )
        print(f"{violation.path}:{violation.line}:{code}")
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

`orgs/prospecting/fixtures/pii-cases.json`

This committed JSON file is the canonical seven-class scanner fixture. The current
`test_pii_guard.py` loads it directly and verifies raw and encoded detection, safe opaque
values, non-echoing failures, and the staged fixture boundary. Keeping the concrete
synthetic values there gives the fixture validator one reviewed source of truth.

`.githooks/pre-commit`

```sh
#!/bin/sh
# Versioned hook (activated via: git config core.hooksPath .githooks)
# Keep both runtime-native mirrors in sync with the reviewed source.
case "$(git diff --cached --name-only)" in
*"skills/curated/"*|*"kit/"*)
  if ! git diff --quiet -- skills/curated kit ||
     test -n "$(git ls-files --others --exclude-standard -- skills/curated kit)"; then
    echo "commit blocked: skills/curated or kit has unstaged content; stage it or restore it before syncing mirrors"
    exit 1
  fi
  python scripts/sync_skills.py || exit 1
  git add .claude/skills .agents/skills .claude/kb-kit .agents/kb-kit
  ;;
esac
python scripts/sync_skills.py --check || {
  echo "commit blocked: edit skills/curated, never generated mirrors; then run: python scripts/sync_skills.py";
  exit 1;
}
py -3 -m scripts.prospecting.pii_guard --staged || exit 1
```

- [ ] Step 4: Run tests, expect PASS — `py -3 -m pytest scripts/prospecting/tests/test_pii_guard.py -q`; expect all 10 test functions to pass, with `112/112` structural-or-content class/sink combinations rejected, all three PII commits blocked, a valid synthetic fixture accepted, a production-domain fixture rejected, and the preserved sync check still blocking.

- [ ] Step 5: Report — report seven PII classes, eight VM sinks, `112/112` structural/content combinations, repeated HTML/percent decoding, redaction-safe exceptions, content-validated four-file fixture allowlist, email/phone/profile blocks `3/3`, preserved sync blocking, `+10` test functions, and no manifest entries yet; do not commit.

### Task 6: Deterministic executor request loop and zero raw capabilities

**Files:** Create `scripts/prospecting/executor.py`, `scripts/prospecting/tests/test_executor_surface.py`; Test `scripts/prospecting/tests/test_executor_surface.py`

**Interfaces:** Consumes: `ExecRequest`, `validate_exec_request`, `assert_vm_safe`, queued `exec_request` rows, hooks `Callable[[ExecRequest], None]` / Produces: `AGENT_CAPABILITIES: Mapping[str,tuple[str,...]]`, `enumerate_agent_capabilities() -> tuple[str,...]`, `Executor(connection: sqlite3.Connection, hooks: tuple[Hook,...] = ())`, `Executor.process_one() -> bool`; state sequence `queued → claimed → succeeded|rejected`, with one append-only audit row per claimed request

- [ ] Step 1: Write the failing test — create `scripts/prospecting/tests/test_executor_surface.py` with this complete four-test module.

```python
import inspect
import sqlite3
from pathlib import Path

import scripts.prospecting.executor as executor_module
from scripts.prospecting.executor import Executor, enumerate_agent_capabilities
from scripts.prospecting.store import ExecRequest, insert_exec_request, open_store


def _queued(connection: sqlite3.Connection, request_id: str = "req_1111111111111111") -> None:
    request = ExecRequest(
        request_id, "prospecting-list-builder", "finder_page",
        {"finder_run_id": "camp_1111111111111111", "lane": "manual"}, "a" * 64, None,
        "2026-09-03T00:00:00Z", "queued", None,
    )
    insert_exec_request(connection, request, "T0")


def test_41_agent_capabilities_have_zero_raw_operations(record_property) -> None:
    capabilities = enumerate_agent_capabilities()
    forbidden = ("gmail.send", "gmail.draft", "vendor.call", "shell", "credential")
    assert capabilities
    assert all(not any(token in capability.lower() for token in forbidden)
               for capability in capabilities)
    assert all(capability.startswith("exec_request:") for capability in capabilities)
    public_surface = {
        name.casefold()
        for name, value in inspect.getmembers(executor_module)
        if not name.startswith("_") and callable(value)
    } | {
        name.casefold()
        for name, value in inspect.getmembers(Executor)
        if not name.startswith("_") and callable(value)
    }
    assert not {
        name for name in public_surface
        if any(token in name for token in ("gmail", "vendor", "shell", "credential"))
    }
    record_property("raw_agent_capabilities", 0)


def test_42_empty_executor_loop_returns_false(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "empty.sqlite")
    assert Executor(connection).process_one() is False


def test_43_executor_runs_validate_hooks_act_audit_in_order(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "order.sqlite")
    _queued(connection)
    events: list[str] = []

    class RecordingExecutor(Executor):
        def _validate(self, request: ExecRequest) -> None:
            events.append("validate")
            super()._validate(request)

        def _act(self, request: ExecRequest) -> tuple[str, str]:
            events.append("act")
            return super()._act(request)

        def _audit(self, request: ExecRequest, state: str, reason: str) -> None:
            events.append("audit")
            super()._audit(request, state, reason)

    def hook(request: ExecRequest) -> None:
        assert request.request_id == "req_1111111111111111"
        events.append("hooks")

    assert RecordingExecutor(connection, (hook,)).process_one() is True
    assert events == ["validate", "hooks", "act", "audit"]
    assert connection.execute(
        "SELECT state FROM exec_request WHERE request_id='req_1111111111111111'"
    ).fetchone()[0] == "rejected"
    assert connection.execute(
        "SELECT count(*) FROM audit WHERE entity_id='req_1111111111111111'"
    ).fetchone()[0] == 1


def test_44_disabled_adapter_rejects_and_audits(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "reject.sqlite")
    _queued(connection)
    assert Executor(connection).process_one() is True
    request = connection.execute(
        "SELECT state,reason FROM exec_request WHERE request_id='req_1111111111111111'"
    ).fetchone()
    assert tuple(request) == ("rejected", "adapter_disabled")
    audit = connection.execute(
        "SELECT action,entity_type,entity_id,reason FROM audit"
    ).fetchone()
    assert tuple(audit) == ("executor_request", "exec_request", "req_1111111111111111", "adapter_disabled")
```

- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_executor_surface.py::test_41_agent_capabilities_have_zero_raw_operations -q`; expect `ModuleNotFoundError: No module named 'scripts.prospecting.executor'`.

- [ ] Step 3: Minimal implementation — create `scripts/prospecting/executor.py` with this complete shell. `_act` is intentionally closed; later phases add reviewed adapters without widening agent capabilities.

```python
"""Single-process deterministic executor shell; P1 has no live adapters."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from collections.abc import Callable, Mapping

from . import install_no_network_guard
from .pii_guard import assert_vm_safe
from .store import ExecRequest, validate_exec_request

install_no_network_guard()

Hook = Callable[[ExecRequest], None]

AGENT_CAPABILITIES: Mapping[str, tuple[str, ...]] = {
    "prospecting-list-builder": (
        "exec_request:fetch_snapshot", "exec_request:finder_page", "exec_request:vendor_lookup",
    ),
    "prospecting-campaigner": (
        "exec_request:gmail_draft", "exec_request:gmail_send", "exec_request:gmail_label",
        "exec_request:gmail_thread_refresh",
    ),
    "prospecting-manager": (),
    "prospecting-personalizer": (),
}


def enumerate_agent_capabilities() -> tuple[str, ...]:
    return tuple(
        capability
        for agent in sorted(AGENT_CAPABILITIES)
        for capability in AGENT_CAPABILITIES[agent]
    )


class Executor:
    def __init__(
        self, connection: sqlite3.Connection, hooks: tuple[Hook, ...] = ()
    ) -> None:
        self.connection = connection
        self.hooks = hooks

    def _claim(self) -> sqlite3.Row | None:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            row = self.connection.execute(
                "SELECT * FROM exec_request WHERE state='queued' ORDER BY created_at,request_id LIMIT 1"
            ).fetchone()
            if row is None:
                self.connection.rollback()
                return None
            changed = self.connection.execute(
                """UPDATE exec_request SET state='claimed',claimed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                   WHERE request_id=? AND state='queued'""",
                (row["request_id"],),
            )
            if changed.rowcount != 1:
                self.connection.rollback()
                return None
            self.connection.commit()
            return self.connection.execute(
                "SELECT * FROM exec_request WHERE request_id=?", (row["request_id"],)
            ).fetchone()
        except Exception:
            self.connection.rollback()
            raise

    @staticmethod
    def _from_row(row: sqlite3.Row) -> ExecRequest:
        return ExecRequest(
            row["request_id"], row["caller"], row["operation"], json.loads(row["payload"]),
            row["policy_hash"], row["approval_id"], row["created_at"], row["state"], row["reason"],
        )

    def _campaign_tier(self, request: ExecRequest) -> str:
        if request.operation != "gmail_send":
            return "T0"
        row = self.connection.execute(
            """SELECT c.approval_tier FROM delivery AS d
               JOIN campaign AS c ON c.campaign_id=d.campaign_id
               WHERE d.delivery_id=?""",
            (request.payload["delivery_id"],),
        ).fetchone()
        if row is None:
            raise ValueError("delivery is not resolvable")
        return str(row[0])

    def _validate(self, request: ExecRequest) -> None:
        assert_vm_safe(request.payload, "process_arguments")
        now = self.connection.execute(
            "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')"
        ).fetchone()[0]
        validate_exec_request(request, self._campaign_tier(request), self.connection, now)

    def _act(self, request: ExecRequest) -> tuple[str, str]:
        return "rejected", "adapter_disabled"

    def _audit(self, request: ExecRequest, state: str, reason: str) -> None:
        before = hashlib.sha256(b"claimed").hexdigest()
        after = hashlib.sha256(state.encode("ascii")).hexdigest()
        self.connection.execute(
            """INSERT INTO audit(
               event_id,actor,action,entity_type,entity_id,at,before_hash,after_hash,reason
               ) VALUES(?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,?,?)""",
            (str(uuid.uuid4()), "desktop-executor", "executor_request", "exec_request",
             request.request_id, before, after, reason),
        )

    def process_one(self) -> bool:
        row = self._claim()
        if row is None:
            return False
        request = self._from_row(row)
        try:
            self._validate(request)
            for hook in self.hooks:
                hook(request)
            state, reason = self._act(request)
        except Exception:
            state, reason = "rejected", "validation_or_hook_rejected"
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            self.connection.execute(
                "UPDATE exec_request SET state=?,reason=? WHERE request_id=? AND state='claimed'",
                (state, reason, request.request_id),
            )
            self._audit(request, state, reason)
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return True
```

- [ ] Step 4: Run tests, expect PASS — `py -3 -m pytest scripts/prospecting/tests/test_executor_surface.py -q`; expect `4 passed`, ordered trace `validate,hooks,act,audit`, and every default action rejected as `adapter_disabled`.

- [ ] Step 5: Report — report seven typed request capabilities, zero raw Gmail/vendor/shell/credential capabilities, one CAS-style claim, fixed hook order, fail-closed static reasons with no exception echo, one audit per claim, `+4` tests, and no manifest entries yet; do not commit.

### Task 7A: Two-word audited override CLI and one-way export

**Files:** Create `scripts/prospecting/cli.py`, `scripts/prospecting/export.py`; Modify `scripts/prospecting/tests/test_store.py` (lines 1-end; append after `test_15_credit_settle_release_and_overage`); Test `scripts/prospecting/tests/test_store.py`

**Interfaces:** Consumes: `open_store()`, exactly two positional words `verb operand`, allowed tranche view, timestamp / Produces: `apply_override(connection, verb: str, operand: str, actor: str, at: str) -> str`, `export_csv(connection, view: str, directory: Path, at: str) -> Path`; no import API exists, and the CLI prints only an opaque audit event ID

- [ ] Step 1: Write the failing test — append these complete CLI/export tests to `test_store.py`.

```python
import inspect
import os
import re
import subprocess

import scripts.prospecting.export as export_module
from scripts.prospecting.cli import apply_override
from scripts.prospecting.export import export_csv


def test_16_two_word_overrides_each_write_audit(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "overrides.sqlite")
    _seed_campaign(connection)
    company, person, _ = _objects(connection)
    verbs = (
        ("dnc", "email:contact-opaque-1"),
        ("note", f"{person.person_id}:Synthetic-local-note"),
        ("status", "campaign-1:paused"),
        ("veto", f"{person.person_id}:campaign-1"),
    )
    event_ids = {
        apply_override(connection, verb, operand, "human:daniel", "2026-09-03T00:00:00Z")
        for verb, operand in verbs
    }
    assert len(event_ids) == 4
    assert connection.execute("SELECT count(*) FROM audit").fetchone()[0] == 4
    assert connection.execute(
        "SELECT status FROM campaign WHERE campaign_id='campaign-1'"
    ).fetchone()[0] == "paused"
    assert connection.execute("SELECT insights FROM relationship").fetchone()[0] == "Synthetic-local-note"
    assert connection.execute("SELECT count(*) FROM suppression").fetchone()[0] == 1
    assert connection.execute(
        "SELECT active FROM fit_veto WHERE person_id=? AND campaign_id='campaign-1'",
        (person.person_id,),
    ).fetchone()[0] == 1
    with pytest.raises((ValueError, sqlite3.IntegrityError), match="approved"):
        apply_override(connection, "status", "campaign-1:active", "human:daniel",
                       "2026-09-03T00:00:01Z")
    with pytest.raises(KeyError):
        apply_override(connection, "veto", "missing-person:campaign-1", "human:daniel",
                       "2026-09-03T00:00:02Z")
    connection.close()
    environment = {**os.environ, "KB_PROSPECTING_STORE": str(tmp_path / "overrides.sqlite")}
    command = ["py", "-3", "-m", "scripts.prospecting.cli"]
    success = subprocess.run(
        [*command, "status", "campaign-1:paused"], env=environment,
        text=True, capture_output=True, check=False,
    )
    assert success.returncode == 0
    assert re.fullmatch(r"req_[0-9a-f]{16}\n", success.stdout)
    assert subprocess.run(
        [*command, "status"], env=environment, capture_output=True, check=False,
    ).returncode != 0
    assert subprocess.run(
        [*command, "status", "campaign-1:paused", "extra"],
        env=environment, capture_output=True, check=False,
    ).returncode != 0


def test_17_export_is_timestamped_and_has_no_import_surface(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "export.sqlite")
    company, _, _ = _objects(connection)
    path = export_csv(connection, "company_tranche", tmp_path, "20260903T120000Z")
    assert path.name == "company_tranche-20260903T120000Z.csv"
    lines = path.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "# kb-prospecting-one-way-export reimport=false"
    assert company.name in lines[2]
    public_callables = {
        name for name, value in inspect.getmembers(export_module)
        if not name.startswith("_") and callable(value)
    }
    assert public_callables == {"Path", "export_csv"}
```

- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_16_two_word_overrides_each_write_audit -q`; expect `ModuleNotFoundError: No module named 'scripts.prospecting.cli'`.

- [ ] Step 3: Minimal implementation — create these complete modules.

`scripts/prospecting/cli.py`

```python
"""Desktop-only two-word human override CLI."""

from __future__ import annotations

import argparse
import hashlib
import sqlite3
import uuid
from datetime import UTC, datetime

from .store import open_store

VERBS = frozenset({"dnc", "note", "status", "veto"})


def _split_operand(operand: str) -> tuple[str, str]:
    if ":" not in operand:
        raise ValueError("operand must be opaque-id:value")
    subject, value = operand.split(":", 1)
    if not subject or not value:
        raise ValueError("operand must contain non-empty opaque-id and value")
    return subject, value


def apply_override(
    connection: sqlite3.Connection, verb: str, operand: str, actor: str, at: str
) -> str:
    if verb not in VERBS:
        raise ValueError("unknown override verb")
    subject, value = _split_operand(operand)
    connection.execute("BEGIN IMMEDIATE")
    try:
        before = ""
        entity_type = "person"
        if verb == "dnc":
            scope = subject
            if scope not in {"global", "email", "person", "company", "campaign"}:
                raise ValueError("invalid dnc scope")
            connection.execute(
                "INSERT INTO suppression VALUES(?,?,?,?,?,?,?,?)",
                (str(uuid.uuid4()), scope, value, "manual_dnc", at, actor, None, None),
            )
            entity_type, subject = "suppression", value
        elif verb == "note":
            if connection.execute(
                "SELECT 1 FROM person WHERE person_id=?", (subject,)
            ).fetchone() is None:
                raise KeyError(subject)
            connection.execute(
                """INSERT INTO relationship(person_id,insights) VALUES(?,?)
                   ON CONFLICT(person_id) DO UPDATE SET insights=excluded.insights""",
                (subject, value),
            )
        elif verb == "status":
            if value not in {"draft", "approved", "active", "paused", "closed"}:
                raise ValueError("invalid campaign status")
            current = connection.execute(
                "SELECT status FROM campaign WHERE campaign_id=?", (subject,)
            ).fetchone()
            if current is None:
                raise KeyError(subject)
            before = str(current[0])
            if value == "active":
                approved = connection.execute(
                    """SELECT 1 FROM campaign AS c JOIN approval AS a
                       ON a.campaign_id=c.campaign_id AND a.policy_hash=c.policy_hash
                       WHERE c.campaign_id=? AND c.status='approved' AND c.intent<>'sales'
                         AND a.approver NOT LIKE 'agent:%' AND a.invalidation_reason IS NULL
                         AND a.consumed_at IS NULL""",
                    (subject,),
                ).fetchone()
                if approved is None:
                    raise ValueError("active requires approved campaign and current human approval")
            connection.execute("UPDATE campaign SET status=? WHERE campaign_id=?", (value, subject))
            entity_type = "campaign"
        elif verb == "veto":
            campaign_id = value
            if connection.execute(
                "SELECT 1 FROM person WHERE person_id=?", (subject,)
            ).fetchone() is None:
                raise KeyError(subject)
            if connection.execute(
                "SELECT 1 FROM campaign WHERE campaign_id=?", (campaign_id,)
            ).fetchone() is None:
                raise KeyError(campaign_id)
            veto_id = "pol_" + hashlib.sha256(
                f"{subject}:{campaign_id}".encode("utf-8")
            ).hexdigest()[:16]
            connection.execute(
                "INSERT INTO fit_veto VALUES(?,?,?,?,?,?,?)",
                (veto_id, subject, campaign_id, "manual_fit_veto", 1, actor, at),
            )
            value = campaign_id
        event_id = "req_" + uuid.uuid4().hex[:16]
        connection.execute(
            "INSERT INTO audit VALUES(?,?,?,?,?,?,?,?,?)",
            (event_id, actor, f"override_{verb}", entity_type, subject, at,
             hashlib.sha256(before.encode()).hexdigest() if before else None,
             hashlib.sha256(value.encode()).hexdigest(), verb),
        )
        connection.commit()
        return event_id
    except Exception:
        connection.rollback()
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("verb", choices=sorted(VERBS))
    parser.add_argument("operand")
    args = parser.parse_args(argv)
    with open_store() as connection:
        event_id = apply_override(
            connection, args.verb, args.operand, "human:daniel",
            datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        )
    print(event_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

`scripts/prospecting/export.py`

```python
"""Explicit timestamped one-way export; no import path exists."""

from __future__ import annotations

import csv
import sqlite3
from pathlib import Path

EXPORT_MARKER = "# kb-prospecting-one-way-export reimport=false"
EXPORT_VIEWS = frozenset({"company_tranche", "person_tranche"})


def export_csv(
    connection: sqlite3.Connection, view: str, directory: Path, at: str
) -> Path:
    if view not in EXPORT_VIEWS:
        raise ValueError("view is not exportable")
    if not at or any(character not in "0123456789TZ" for character in at):
        raise ValueError("timestamp must be compact UTC")
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"{view}-{at}.csv"
    cursor = connection.execute(f"SELECT * FROM {view}")
    with destination.open("x", encoding="utf-8", newline="") as handle:
        handle.write(EXPORT_MARKER + "\n")
        writer = csv.writer(handle)
        writer.writerow(column[0] for column in cursor.description)
        writer.writerows(cursor)
    return destination
```

- [ ] Step 4: Run tests, expect PASS — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_16_two_word_overrides_each_write_audit scripts/prospecting/tests/test_store.py::test_17_export_is_timestamped_and_has_no_import_surface -q`; expect both test functions to pass: four persisted/audited effects, direct draft→active rejection, missing-subject rejection, exactly-two-word subprocess behavior with opaque-only stdout, and no import callable in the export module.

- [ ] Step 5: Report — report exactly four verbs, two-word parser, persisted fit veto, approved-only activation, missing-subject rejection, local transactional effects, `4/4` audit events, opaque-only stdout, timestamped one-way marker and absence of an import surface, `+2` test functions, and no manifest entries yet; do not commit.

### Task 7B: Localhost immutable Datasette and 20-read/10-write HTTP proof

**Files:** Create `scripts/prospecting/serve_datasette.ps1`; Modify `scripts/prospecting/tests/test_store.py` (lines 1-end; append after `test_17_export_is_timestamped_and_has_no_import_surface`); Test `scripts/prospecting/tests/test_store.py`

**Interfaces:** Consumes: `-Store Path` defaulting to `%LOCALAPPDATA%\kb-prospecting\store.sqlite`, `-Port int`, Datasette 0.65.1 / Produces: a blocking Datasette process bound to `127.0.0.1` with `--immutable`; loopback JSON reads succeed and HTTP write attempts fail

- [ ] Step 1: Write the failing test — append these complete launcher/HTTP tests to `test_store.py`.

```python
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DATASSETTE_SCRIPT = Path(__file__).parents[1] / "serve_datasette.ps1"


def _datasette_process(database: Path, port: int) -> subprocess.Popen[bytes]:
    environment = {**os.environ, "KB_PROSPECTING_NO_NETWORK": "1"}
    startup = database.parent / "guarded-startup"
    startup.mkdir(exist_ok=True)
    (startup / "sitecustomize.py").write_text(
        "from scripts.prospecting import install_no_network_guard\n"
        "install_no_network_guard()\n",
        encoding="utf-8",
    )
    environment["PYTHONPATH"] = os.pathsep.join(
        (str(startup), str(Path(__file__).parents[3]), environment.get("PYTHONPATH", ""))
    )
    command = [
        sys.executable, "-m", "datasette", "--host", "127.0.0.1",
        "--port", str(port), "--immutable", str(database),
    ]
    assert environment["KB_PROSPECTING_NO_NETWORK"] == "1"
    process = subprocess.Popen(
        command,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    assert process.args == command
    return process


def _wait_for_datasette(url: str) -> None:
    deadline = time.monotonic() + 15
    while True:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                assert response.status == 200
            return
        except (urllib.error.URLError, ConnectionError):
            if time.monotonic() >= deadline:
                raise AssertionError("Datasette did not become ready")
            time.sleep(0.1)


def test_18_datasette_launcher_is_localhost_and_immutable(tmp_path: Path) -> None:
    database = tmp_path / "launcher.sqlite"
    open_store(database).close()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = _datasette_process(database, port)
    try:
        _wait_for_datasette(f"http://127.0.0.1:{port}/{database.stem}.json")
        assert "--host" in process.args and "127.0.0.1" in process.args
        assert "--immutable" in process.args and "0.0.0.0" not in process.args
    finally:
        process.kill()
        process.wait(timeout=10)
    assert process.poll() is not None


def test_19_datasette_accepts_20_reads_rejects_10_writes(
    tmp_path: Path, record_property
) -> None:
    database = tmp_path / "datasette.sqlite"
    connection = open_store(database)
    _objects(connection)
    connection.close()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = _datasette_process(database, port)
    base = f"http://127.0.0.1:{port}/{database.stem}/company.json?_shape=array"
    try:
        _wait_for_datasette(base)
        reads = 0
        for _ in range(20):
            with urllib.request.urlopen(base, timeout=2) as response:
                reads += response.status == 200
        statements = (
            "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES('x','x','manual','x')",
            "UPDATE company SET name='changed'",
            "DELETE FROM company",
            "DROP TABLE company",
            "ALTER TABLE company ADD COLUMN changed TEXT",
            "CREATE TABLE changed(value TEXT)",
            "PRAGMA journal_mode=DELETE",
            "ATTACH DATABASE 'other.sqlite' AS other",
            "VACUUM",
            "REPLACE INTO company(company_id,name,source_lane,dedupe_key) VALUES('x','x','manual','x')",
        )
        rejected = 0
        for statement in statements:
            url = (
                f"http://127.0.0.1:{port}/{database.stem}"
                f"?sql={urllib.parse.quote(statement, safe='')}"
            )
            try:
                urllib.request.urlopen(url, timeout=2)
            except urllib.error.HTTPError as error:
                body = error.read().decode("utf-8", "replace").casefold()
                assert 400 <= error.code < 500
                assert any(marker in body for marker in (
                    "read-only", "readonly", "immutable", "statement must be a select"
                ))
                rejected += 1
            with urllib.request.urlopen(base, timeout=2) as response:
                rows = json.loads(response.read())[0]
                assert rows["name"] == "Example Test"
        assert reads == 20
        assert rejected == 10
        record_property("datasette_reads", reads)
        record_property("datasette_write_rejections", rejected)
    finally:
        process.kill()
        process.wait(timeout=10)
    assert process.poll() is not None
    check = open_store(database)
    assert check.execute("SELECT count(*) FROM company").fetchone()[0] == 1
```

- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_18_datasette_launcher_is_localhost_and_immutable -q`; expect `FileNotFoundError` for `serve_datasette.ps1`.

- [ ] Step 3: Minimal implementation — Datasette 0.65.1 and setuptools 80.10.2 are preinstalled host prerequisites; run no pip command and perform no dependency mutation. Create this complete human-convenience PowerShell launcher. The gate itself launches Datasette directly from the once-resolved interpreter, sets `KB_PROSPECTING_NO_NETWORK=1`, and records every child environment.

```powershell
param(
    [string]$Store = (Join-Path $env:LOCALAPPDATA 'kb-prospecting\store.sqlite'),
    [int]$Port = 8001
)

$resolvedStore = (Resolve-Path -LiteralPath $Store -ErrorAction Stop).Path
$python = (& py -3 -c "import sys;print(sys.executable)").Trim()
if (-not $python) { throw 'Python 3 interpreter resolution failed' }
$env:KB_PROSPECTING_NO_NETWORK = '1'
& $python -c "import runpy; from scripts.prospecting import install_no_network_guard; install_no_network_guard(); runpy.run_module('datasette', run_name='__main__')" --host 127.0.0.1 --port $Port --immutable $resolvedStore
exit $LASTEXITCODE
```

- [ ] Step 4: Run tests, expect PASS — `py -3 -m pytest scripts/prospecting/tests/test_store.py::test_18_datasette_launcher_is_localhost_and_immutable scripts/prospecting/tests/test_store.py::test_19_datasette_accepts_20_reads_rejects_10_writes -q`; expect both test functions to pass, `20/20` HTTP 200 reads, ten distinct encoded DML/DDL statements rejected with explicit read-only/immutable/SELECT-only bodies, unchanged rows after every attempt, direct child kill/wait, and no surviving child.

- [ ] Step 5: Report — report the preinstalled Datasette `0.65.1` prerequisite, no dependency mutation, host `127.0.0.1`, direct `sys.executable -m datasette` immutable launch, `CREATE_NEW_PROCESS_GROUP`, kill/wait cleanup, `20/20` reads, ten distinct explicit write rejections with unchanged rows, inherited no-network marker, `+2` test functions, and no manifest entries yet; do not commit.

### Task 8: Fail-closed P1 manifest runner and final gate

**Files:** Create `scripts/prospecting/gate.py`, `scripts/prospecting/tests/test_gate.py`; Modify `scripts/prospecting/gate_manifest.json` (replace lines 1-end); Test `scripts/prospecting/tests/test_gate.py` and all five P1 test files

**Interfaces:** Consumes: `gate_manifest.json`, repo root, exact pytest node IDs, Git changed paths / Produces: `load_manifest(path: Path) -> dict[str,object]`, `validate_manifest(manifest: Mapping[str,object]) -> tuple[str,...]`, `validate_files(root: Path, manifest: Mapping[str,object]) -> tuple[str,...]`, `evaluate_run(manifest: Mapping[str,object], run: GateRun) -> tuple[str,...]`, `main(argv: list[str] | None = None) -> int`; one PII-safe JSON line and exit `0` only for an exact clean pass

- [ ] Step 1: Write the failing test — create `scripts/prospecting/tests/test_gate.py` with this complete four-test module.

```python
import json
from dataclasses import replace
from pathlib import Path

import pytest
import scripts.prospecting.gate as gate_module
from scripts.prospecting.gate import (
    CRITERION_TESTS,
    GateRun,
    P1_ARTIFACTS,
    evaluate_run,
    load_manifest,
    main,
    validate_files,
    validate_manifest,
)

ROOT = Path(__file__).parents[3]
MANIFEST_PATH = Path(__file__).parents[1] / "gate_manifest.json"


def test_45_manifest_enumerates_at_least_49_tests() -> None:
    manifest = load_manifest(MANIFEST_PATH)
    assert validate_manifest(manifest) == ()
    assert len(manifest["tests"]) >= 49
    assert len(set(manifest["tests"])) == len(manifest["tests"])
    assert tuple(manifest["artifacts"]) == P1_ARTIFACTS


def test_46_gate_rejects_failures_and_main_emits_one_safe_json_line(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = load_manifest(MANIFEST_PATH)
    measurements = {name: int(manifest["criteria"][name]) for name in CRITERION_TESTS}
    clean = GateRun(
        tuple(manifest["tests"]), len(manifest["tests"]), 0, 0, 0, 0, 0, 0, measurements,
    )
    mutations = (
        replace(clean, nodeids=clean.nodeids[:-1], passed=clean.passed - 1),
        replace(clean, passed=clean.passed - 1, failed=1),
        replace(clean, skipped=1),
        replace(clean, xfailed=1),
        replace(clean, warnings=1),
        replace(clean, external_network_calls=1),
        replace(clean, child_processes_without_guard=1),
        replace(clean, measurements={**measurements, "wal_writers": 1}),
    )
    for mutation in mutations:
        assert evaluate_run(manifest, mutation)
    assert evaluate_run(manifest, clean) == ()
    monkeypatch.setattr(gate_module, "load_manifest", lambda: manifest)
    monkeypatch.setattr(gate_module, "validate_files", lambda root, value: ())
    monkeypatch.setattr(gate_module, "changed_paths", lambda root: ())
    monkeypatch.setattr(gate_module, "resolve_runtime", lambda: (Path("python.exe"), "a" * 64))
    monkeypatch.setattr(gate_module, "run_tests", lambda root, nodeids: clean)
    assert main(["--phase", "P1"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["status"] == "passed"
    unsafe = "Casey Example; rm -rf /"
    assert main(["--phase", unsafe]) == 1
    rejected = capsys.readouterr().out
    assert unsafe not in rejected


def test_47_gate_requires_exact_fixtures_and_artifacts(tmp_path: Path) -> None:
    manifest = load_manifest(MANIFEST_PATH)
    self_authorized = {**manifest, "artifacts": [*manifest["artifacts"], "arbitrary.txt"]}
    assert "manifest artifacts differ from exact P1 allowlist" in validate_manifest(self_authorized)
    fixture_root = tmp_path / "orgs" / "prospecting" / "fixtures"
    fixture_root.mkdir(parents=True)
    for name in manifest["fixtures"]:
        (fixture_root / name).write_text("{}", encoding="utf-8")
    extra = tmp_path / "orgs" / "prospecting" / "fixtures" / "extra.json"
    extra.write_text("{}", encoding="utf-8")
    assert "fixture set differs from manifest" in validate_files(tmp_path, manifest)


def test_48_numeric_criteria_have_exact_measurement_owners() -> None:
    manifest = load_manifest(MANIFEST_PATH)
    criteria = manifest["criteria"]
    assert criteria == {
        "minimum_enumerated_tests": 49,
        "warnings": 0,
        "skips": 0,
        "xfails": 0,
        "external_network_calls": 0,
        "child_processes_without_guard": 0,
        "wal_writers": 2,
        "shared_policy_hash_campaigns": 2,
        "audit_rejections": 2,
        "datasette_reads": 20,
        "datasette_write_rejections": 10,
        "pii_class_sink_combinations": 112,
        "blocked_pattern_commits": 3,
        "raw_agent_capabilities": 0
    }
    assert set(CRITERION_TESTS) == {
        key for key in criteria
        if key not in {"minimum_enumerated_tests", "warnings", "skips", "xfails",
                       "external_network_calls", "child_processes_without_guard"}
    }
    assert all(node in manifest["tests"] for nodes in CRITERION_TESTS.values() for node in nodes)
    unknown = {**manifest, "criteria": {**criteria, "made_up": 1}}
    assert "manifest criteria differ from executable P1 criteria" in validate_manifest(unknown)
```

- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_gate.py::test_45_manifest_enumerates_at_least_49_tests -q`; expect `ModuleNotFoundError: No module named 'scripts.prospecting.gate'`.

- [ ] Step 3: Minimal implementation — create the complete runner and replace the manifest with the exact P1 inventory below.

`scripts/prospecting/gate.py`

```python
"""Sole fail-closed phase gate for prospecting P1."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import pytest

from . import install_no_network_guard
from .pii_guard import assert_vm_safe, find_text_classes

PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE.parents[1]
MANIFEST_PATH = PACKAGE / "gate_manifest.json"
P1_ARTIFACTS = (
    ".githooks/pre-commit",
    "orgs/prospecting/_index.md", "orgs/prospecting/STATE.md",
    "orgs/prospecting/contract.md", "orgs/prospecting/data-contracts.md",
    "orgs/prospecting/fixtures/synthetic.json",
    "orgs/prospecting/fixtures/pii-cases.json",
    "orgs/prospecting/fixtures/conflicting-providers.json",
    "orgs/prospecting/fixtures/job-change.json",
    "scripts/prospecting/__init__.py", "scripts/prospecting/schema.sql",
    "scripts/prospecting/store.py", "scripts/prospecting/cli.py",
    "scripts/prospecting/export.py", "scripts/prospecting/serve_datasette.ps1",
    "scripts/prospecting/pii_guard.py", "scripts/prospecting/executor.py",
    "scripts/prospecting/gate.py", "scripts/prospecting/gate_manifest.json",
    "scripts/prospecting/tests/test_store.py",
    "scripts/prospecting/tests/test_contracts.py",
    "scripts/prospecting/tests/test_pii_guard.py",
    "scripts/prospecting/tests/test_executor_surface.py",
    "scripts/prospecting/tests/test_gate.py",
)
P1_FIXTURES = ("synthetic.json", "pii-cases.json", "conflicting-providers.json", "job-change.json")
CRITERION_TESTS = {
    "wal_writers": ("scripts/prospecting/tests/test_store.py::test_08_two_writer_wal_race_has_no_lost_update",),
    "shared_policy_hash_campaigns": ("scripts/prospecting/tests/test_contracts.py::test_30_policy_hash_nonunique_and_approval_kind_resolution",),
    "audit_rejections": ("scripts/prospecting/tests/test_store.py::test_05_audit_is_append_only",),
    "datasette_reads": ("scripts/prospecting/tests/test_store.py::test_19_datasette_accepts_20_reads_rejects_10_writes",),
    "datasette_write_rejections": ("scripts/prospecting/tests/test_store.py::test_19_datasette_accepts_20_reads_rejects_10_writes",),
    "pii_class_sink_combinations": ("scripts/prospecting/tests/test_pii_guard.py::test_31_every_pii_class_is_caught_at_every_vm_sink",),
    "blocked_pattern_commits": (
        "scripts/prospecting/tests/test_pii_guard.py::test_37_precommit_blocks_email",
        "scripts/prospecting/tests/test_pii_guard.py::test_38_precommit_blocks_phone",
        "scripts/prospecting/tests/test_pii_guard.py::test_39_precommit_blocks_linkedin_profile",
    ),
    "raw_agent_capabilities": ("scripts/prospecting/tests/test_executor_surface.py::test_41_agent_capabilities_have_zero_raw_operations",),
}


@dataclass(frozen=True)
class GateRun:
    nodeids: tuple[str, ...]
    passed: int
    failed: int
    skipped: int
    xfailed: int
    warnings: int
    external_network_calls: int
    child_processes_without_guard: int
    measurements: Mapping[str, int]


class GatePlugin:
    def __init__(self) -> None:
        self.nodeids: tuple[str, ...] = ()
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.xfailed = 0
        self.warnings = 0
        self.measurements: dict[str, int] = {}

    def pytest_collection_finish(self, session: pytest.Session) -> None:
        self.nodeids = tuple(item.nodeid.replace("\\", "/") for item in session.items)

    def pytest_runtest_logreport(self, report: pytest.TestReport) -> None:
        if report.when == "call":
            if getattr(report, "wasxfail", False):
                self.xfailed += 1
            elif report.skipped:
                self.skipped += 1
            elif report.failed:
                self.failed += 1
            elif report.passed:
                self.passed += 1
            for name, value in getattr(report, "user_properties", ()):
                if isinstance(value, int):
                    self.measurements[name] = self.measurements.get(name, 0) + value
        elif report.when in {"setup", "teardown"} and report.failed:
            self.failed += 1

    def pytest_warning_recorded(self, warning_message: object, when: str, nodeid: str, location: object) -> None:
        self.warnings += 1


def load_manifest(path: Path = MANIFEST_PATH) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_manifest(manifest: Mapping[str, object]) -> tuple[str, ...]:
    errors: list[str] = []
    if set(manifest) != {"phase", "artifacts", "fixtures", "tests", "criteria"}:
        errors.append("manifest keys differ from contract")
    if manifest.get("phase") != "P1":
        errors.append("manifest phase is not P1")
    criteria = dict(manifest.get("criteria", {}))
    expected_criteria = {
        "minimum_enumerated_tests", "warnings", "skips", "xfails",
        "external_network_calls", "child_processes_without_guard", *CRITERION_TESTS,
    }
    if set(criteria) != expected_criteria:
        errors.append("manifest criteria differ from executable P1 criteria")
    minimum = criteria.get("minimum_enumerated_tests")
    tests = tuple(manifest.get("tests", ()))
    if not isinstance(minimum, int) or minimum < 49:
        errors.append("minimum_enumerated_tests must be at least 49")
    elif len(tests) < minimum or len(set(tests)) != len(tests):
        errors.append("manifest must enumerate at least the minimum unique test functions")
    if any(node not in tests for nodes in CRITERION_TESTS.values() for node in nodes):
        errors.append("criterion mapping names a test absent from the manifest")
    if tuple(manifest.get("artifacts", ())) != P1_ARTIFACTS:
        errors.append("manifest artifacts differ from exact P1 allowlist")
    fixtures = tuple(manifest.get("fixtures", ()))
    if fixtures != P1_FIXTURES:
        errors.append("manifest fixture names differ from P1")
    return tuple(errors)


def validate_files(root: Path, manifest: Mapping[str, object]) -> tuple[str, ...]:
    errors: list[str] = []
    artifacts = tuple(str(item) for item in manifest["artifacts"])
    missing = tuple(path for path in artifacts if not (root / path).is_file())
    if missing:
        errors.append("missing artifact: " + ",".join(missing))
    fixture_root = root / "orgs" / "prospecting" / "fixtures"
    actual = {path.name for path in fixture_root.glob("*") if path.is_file()}
    if actual != set(manifest["fixtures"]):
        errors.append("fixture set differs from manifest")
    for nodeid in manifest["tests"]:
        relative, function = str(nodeid).split("::", 1)
        source_path = root / relative
        if not source_path.is_file():
            continue
        source = source_path.read_text(encoding="utf-8")
        if f"def {function}(" not in source:
            errors.append("manifest test has no real function definition")
    state = root / "orgs" / "prospecting" / "STATE.md"
    if state.is_file():
        if find_text_classes(state.read_text(encoding="utf-8")):
            errors.append("work-tree STATE.md DRAFT fails PII guard")
    return tuple(errors)


def changed_paths(root: Path) -> tuple[str, ...]:
    result = subprocess.run(
        ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        cwd=root, capture_output=True, check=True,
    )
    fields = [item.decode("utf-8", "strict") for item in result.stdout.split(b"\0") if item]
    paths: list[str] = []
    index = 0
    while index < len(fields):
        entry = fields[index]
        status, path = entry[:2], entry[3:]
        paths.append(path.replace("\\", "/"))
        if "R" in status or "C" in status:
            index += 1
            paths.append(fields[index].replace("\\", "/"))
        index += 1
    return tuple(paths)


def evaluate_run(manifest: Mapping[str, object], run: GateRun) -> tuple[str, ...]:
    errors: list[str] = []
    expected = tuple(str(item) for item in manifest["tests"])
    collected_functions = tuple(dict.fromkeys(node.split("[", 1)[0] for node in run.nodeids))
    if collected_functions != expected:
        errors.append("collected test functions differ from ordered manifest")
    minimum = int(manifest["criteria"]["minimum_enumerated_tests"])
    if len(collected_functions) < minimum or run.passed < len(run.nodeids):
        errors.append("pass inventory is below the enumerated minimum")
    if run.failed:
        errors.append("failing tests present")
    if run.skipped:
        errors.append("skipped tests present")
    if run.xfailed:
        errors.append("xfails present")
    if run.warnings:
        errors.append("warnings present")
    if run.external_network_calls:
        errors.append("external network calls present")
    if run.child_processes_without_guard:
        errors.append("child process lacked KB_PROSPECTING_NO_NETWORK=1")
    for criterion, nodeids in CRITERION_TESTS.items():
        expected_value = int(manifest["criteria"][criterion])
        if run.measurements.get(criterion) != expected_value:
            errors.append(f"measurement failed for {criterion}")
    return tuple(errors)


def run_tests(root: Path, nodeids: tuple[str, ...]) -> GateRun:
    plugin = GatePlugin()
    os.environ["KB_PROSPECTING_NO_NETWORK"] = "1"
    install_no_network_guard()
    original_socket = socket.socket
    original_popen = subprocess.Popen
    external_calls = 0
    unguarded_children = 0

    class LoopbackSocket(original_socket):
        def connect(self, address: object) -> object:
            nonlocal external_calls
            host = address[0] if isinstance(address, tuple) and address else ""
            if host not in {"127.0.0.1", "::1", "localhost"}:
                external_calls += 1
                raise OSError("external network disabled by P1 gate")
            return super().connect(address)

    def GuardedPopen(*args: object, **kwargs: object) -> subprocess.Popen[bytes]:
        nonlocal unguarded_children
        child_environment = kwargs.get("env", os.environ)
        if not isinstance(child_environment, Mapping) or child_environment.get(
            "KB_PROSPECTING_NO_NETWORK"
        ) != "1":
            unguarded_children += 1
            raise RuntimeError("P1 child missing no-network environment")
        return original_popen(*args, **kwargs)

    socket.socket = LoopbackSocket
    subprocess.Popen = GuardedPopen
    try:
        exit_code = pytest.main([*nodeids, "-q"], plugins=[plugin])
    finally:
        socket.socket = original_socket
        subprocess.Popen = original_popen
    if exit_code != pytest.ExitCode.OK and plugin.failed == 0:
        plugin.failed = 1
    return GateRun(
        plugin.nodeids, plugin.passed, plugin.failed, plugin.skipped, plugin.xfailed,
        plugin.warnings, external_calls, unguarded_children, dict(plugin.measurements),
    )


def resolve_runtime() -> tuple[Path, str]:
    environment = {**os.environ, "KB_PROSPECTING_NO_NETWORK": "1"}
    resolved = subprocess.run(
        ["py", "-3", "-c", "import sys;print(sys.executable)"],
        env=environment, text=True, capture_output=True, check=True,
    ).stdout.strip()
    if not resolved:
        raise RuntimeError("host interpreter did not resolve")
    interpreter = Path(resolved)
    facts = subprocess.run(
        [str(interpreter), "-c",
         "import datasette,sqlite3,sys;print(sys.version_info[:2]);print(sqlite3.sqlite_version);print(datasette.__version__)"],
        env=environment, text=True, capture_output=True, check=True,
    ).stdout.splitlines()
    if facts != ["(3, 13)", "3.50.4", "0.65.1"]:
        raise RuntimeError("P1 runtime prerequisite mismatch")
    return interpreter, hashlib.sha256(str(interpreter).encode("utf-8")).hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True)
    args = parser.parse_args(argv)
    os.environ["KB_PROSPECTING_NO_NETWORK"] = "1"
    install_no_network_guard()
    if not isinstance(args.phase, str) or re.fullmatch(r"P[0-9]+", args.phase) is None:
        print('{"code":"invalid_phase","status":"failed"}')
        return 1
    if args.phase != "P1":
        print('{"code":"unknown_phase","status":"failed"}')
        return 1
    manifest = load_manifest()
    errors = [*validate_manifest(manifest), *validate_files(ROOT, manifest)]
    interpreter_hash = ""
    try:
        _, interpreter_hash = resolve_runtime()
    except Exception:
        errors.append("runtime prerequisite mismatch")
    allowed = set(P1_ARTIFACTS)
    unexpected = tuple(path for path in changed_paths(ROOT) if path not in allowed)
    if unexpected:
        errors.append("changed paths outside P1 allowlist")
    run = GateRun((), 0, 1, 0, 0, 0, 0, 0, {})
    if not errors:
        run = run_tests(ROOT, tuple(str(item) for item in manifest["tests"]))
        errors.extend(evaluate_run(manifest, run))
    summary = {
        "phase": "P1", "status": "passed" if not errors else "failed",
        "passed": run.passed, "failed": run.failed, "skipped": run.skipped,
        "xfailed": run.xfailed, "warnings": run.warnings,
        "external_network_calls": run.external_network_calls,
        "child_processes_without_guard": run.child_processes_without_guard,
        "interpreter_path_sha256": interpreter_hash,
        "error_codes": tuple(f"gate_{index + 1}" for index in range(len(errors))),
    }
    assert_vm_safe(summary, "stdout")
    print(json.dumps(summary, sort_keys=True, separators=(",", ":")))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

`scripts/prospecting/gate_manifest.json`

```json
{
  "phase": "P1",
  "artifacts": [
    ".githooks/pre-commit",
    "orgs/prospecting/_index.md",
    "orgs/prospecting/STATE.md",
    "orgs/prospecting/contract.md",
    "orgs/prospecting/data-contracts.md",
    "orgs/prospecting/fixtures/synthetic.json",
    "orgs/prospecting/fixtures/pii-cases.json",
    "orgs/prospecting/fixtures/conflicting-providers.json",
    "orgs/prospecting/fixtures/job-change.json",
    "scripts/prospecting/__init__.py",
    "scripts/prospecting/schema.sql",
    "scripts/prospecting/store.py",
    "scripts/prospecting/cli.py",
    "scripts/prospecting/export.py",
    "scripts/prospecting/serve_datasette.ps1",
    "scripts/prospecting/pii_guard.py",
    "scripts/prospecting/executor.py",
    "scripts/prospecting/gate.py",
    "scripts/prospecting/gate_manifest.json",
    "scripts/prospecting/tests/test_store.py",
    "scripts/prospecting/tests/test_contracts.py",
    "scripts/prospecting/tests/test_pii_guard.py",
    "scripts/prospecting/tests/test_executor_surface.py",
    "scripts/prospecting/tests/test_gate.py"
  ],
  "fixtures": [
    "synthetic.json",
    "pii-cases.json",
    "conflicting-providers.json",
    "job-change.json"
  ],
  "tests": [
    "scripts/prospecting/tests/test_store.py::test_01_package_discovery",
    "scripts/prospecting/tests/test_store.py::test_02_schema_contains_every_data_table",
    "scripts/prospecting/tests/test_store.py::test_03_schema_foreign_keys_are_valid",
    "scripts/prospecting/tests/test_store.py::test_04_schema_check_rejects_bad_enum",
    "scripts/prospecting/tests/test_store.py::test_04b_schema_cross_row_triggers_and_campaign_tranche",
    "scripts/prospecting/tests/test_store.py::test_05_audit_is_append_only",
    "scripts/prospecting/tests/test_store.py::test_06_migration_is_idempotent",
    "scripts/prospecting/tests/test_store.py::test_07_foreign_key_rejection",
    "scripts/prospecting/tests/test_store.py::test_08_two_writer_wal_race_has_no_lost_update",
    "scripts/prospecting/tests/test_store.py::test_09_store_path_uses_test_override",
    "scripts/prospecting/tests/test_store.py::test_10_typed_repository_round_trip",
    "scripts/prospecting/tests/test_store.py::test_11_source_observation_cannot_change",
    "scripts/prospecting/tests/test_store.py::test_12_job_change_is_one_transaction",
    "scripts/prospecting/tests/test_store.py::test_13_conflicting_providers_create_review",
    "scripts/prospecting/tests/test_store.py::test_14_two_workers_one_credit_allows_one_reservation",
    "scripts/prospecting/tests/test_store.py::test_15_credit_settle_release_and_overage",
    "scripts/prospecting/tests/test_store.py::test_16_two_word_overrides_each_write_audit",
    "scripts/prospecting/tests/test_store.py::test_17_export_is_timestamped_and_has_no_import_surface",
    "scripts/prospecting/tests/test_store.py::test_18_datasette_launcher_is_localhost_and_immutable",
    "scripts/prospecting/tests/test_store.py::test_19_datasette_accepts_20_reads_rejects_10_writes",
    "scripts/prospecting/tests/test_contracts.py::test_20_target_policy_accepts_typed_vocabulary",
    "scripts/prospecting/tests/test_contracts.py::test_21_target_policy_rejects_duplicate_ids",
    "scripts/prospecting/tests/test_contracts.py::test_22_company_list_rejects_names_and_urls",
    "scripts/prospecting/tests/test_contracts.py::test_23_desktop_compiler_resolves_ordered_opaque_company_ids",
    "scripts/prospecting/tests/test_contracts.py::test_24_unsupported_lane_fails_closed",
    "scripts/prospecting/tests/test_contracts.py::test_25_approximate_lane_requires_bound_override",
    "scripts/prospecting/tests/test_contracts.py::test_26_eligibility_preserves_and_persists_all_outcomes",
    "scripts/prospecting/tests/test_contracts.py::test_27_non_send_operations_forbid_approval",
    "scripts/prospecting/tests/test_contracts.py::test_28_enabled_send_requires_complete_bound_approval",
    "scripts/prospecting/tests/test_contracts.py::test_29_t0_send_is_rejected",
    "scripts/prospecting/tests/test_contracts.py::test_30_policy_hash_nonunique_and_approval_kind_resolution",
    "scripts/prospecting/tests/test_pii_guard.py::test_31_every_pii_class_is_caught_at_every_vm_sink",
    "scripts/prospecting/tests/test_pii_guard.py::test_32_typed_opaque_payload_is_safe",
    "scripts/prospecting/tests/test_pii_guard.py::test_33_guard_error_never_echoes_payload",
    "scripts/prospecting/tests/test_pii_guard.py::test_34_email_detector_decodes_percent_encoding",
    "scripts/prospecting/tests/test_pii_guard.py::test_35_phone_detector_catches_synthetic_range",
    "scripts/prospecting/tests/test_pii_guard.py::test_36_profile_detector_catches_encoded_content_without_sensitive_key",
    "scripts/prospecting/tests/test_pii_guard.py::test_37_precommit_blocks_email",
    "scripts/prospecting/tests/test_pii_guard.py::test_38_precommit_blocks_phone",
    "scripts/prospecting/tests/test_pii_guard.py::test_39_precommit_blocks_linkedin_profile",
    "scripts/prospecting/tests/test_pii_guard.py::test_40_precommit_preserves_sync_and_validates_fixture_exemption",
    "scripts/prospecting/tests/test_executor_surface.py::test_41_agent_capabilities_have_zero_raw_operations",
    "scripts/prospecting/tests/test_executor_surface.py::test_42_empty_executor_loop_returns_false",
    "scripts/prospecting/tests/test_executor_surface.py::test_43_executor_runs_validate_hooks_act_audit_in_order",
    "scripts/prospecting/tests/test_executor_surface.py::test_44_disabled_adapter_rejects_and_audits",
    "scripts/prospecting/tests/test_gate.py::test_45_manifest_enumerates_at_least_49_tests",
    "scripts/prospecting/tests/test_gate.py::test_46_gate_rejects_failures_and_main_emits_one_safe_json_line",
    "scripts/prospecting/tests/test_gate.py::test_47_gate_requires_exact_fixtures_and_artifacts",
    "scripts/prospecting/tests/test_gate.py::test_48_numeric_criteria_have_exact_measurement_owners"
  ],
  "criteria": {
    "minimum_enumerated_tests": 49,
    "warnings": 0,
    "skips": 0,
    "xfails": 0,
    "external_network_calls": 0,
    "child_processes_without_guard": 0,
    "wal_writers": 2,
    "shared_policy_hash_campaigns": 2,
    "audit_rejections": 2,
    "datasette_reads": 20,
    "datasette_write_rejections": 10,
    "pii_class_sink_combinations": 112,
    "blocked_pattern_commits": 3,
    "raw_agent_capabilities": 0
  }
}
```

- [ ] Step 4: Run tests, expect PASS — first run `py -3 -m pytest scripts/prospecting/tests/test_gate.py -q` and expect all four test functions to pass. With the work-tree `STATE.md` DRAFT present and the reviewed diff limited to `P1_ARTIFACTS`, run the sole phase command `py -3 -m scripts.prospecting.gate --phase P1`. The gate resolves and records the interpreter once, fails fast unless Python is `3.13`, SQLite is `3.50.4`, and Datasette is `0.65.1`, and performs no pip step. Expect one JSON line with `"status":"passed"`, at least 49 enumerated test functions, zero failed/skipped/xfailed/warnings/external-network/unguarded-child counts, a 64-character `interpreter_path_sha256`, and exit code `0`. The boss creates the ops copy of `STATE.md` only after gate close; the gate never reads an ops ref. The spec-quoted command is aligned to this required `py -3` form.

- [ ] Step 5: Report — report the at-least-49 enumerated function inventory (`20 + 11 + 10 + 4 + 4` before parameter expansion), four exact fixtures, 24 exact code-owned allowlist artifacts, work-tree DRAFT validation, runtime versions, zero fail/skip/xfail/warning/external-network/unguarded-child counts, measured numeric assertions tied to exact node IDs, and manifest entries added; do not commit. Request the independent inspector; promotion additionally requires inspector score `≥90` and Daniel’s human gate.

## Coverage

- Scaffold and routing: Task 1 creates the index, work-tree `STATE.md` DRAFT, conservative contract, data-contract seed, importable guarded package, and manifest skeleton; the boss creates the ops copy at gate close.
- Every §Data table plus persisted predicate overrides and fit vetoes, FKs, enumerated/range/conditional CHECKs, activation/approval/overlap triggers, single-contact and campaign-scoped tranche behavior, views, WAL, migration/versioning, immutability, append-only audit, and terminated two-writer proof: Tasks 2A–2B.
- Typed repositories, immutable provenance, injected role-change rollback, conflict-producing ingestion, provider attempts, fit-score versioning, adapter-disable/pause accounting on credit overage, atomic reserve/settle/release, and all four exact synthetic fixtures: Tasks 3A–3B and Task 5.
- All ten typed predicates, opaque ordered company-list compilation with unresolved/ambiguous rejection, versioned lane capabilities, persisted/audited human overrides and eligibility decisions, exact ID-by-kind and enum payload validation, complete send approval applicability, bidirectional content-kind hash rejection on insert/update, and non-unique policy hashes: Task 4.
- Seven PII classes at all eight VM sinks by both structure and decoded content (`112/112`), actual combined-hook email/phone/profile blocks, preserved sync blocking, and content-validated synthetic fixture exemptions: Task 5.
- Introspected request-only agent surface, fixed validate → hooks → closed act → audit chain, no enabled adapter, exactly one audit per claim, and zero raw agent Gmail/vendor/shell/credential operations: Task 6.
- Four exactly-two-word audited overrides, persisted fit veto, approved-only activation, missing-subject rejection, opaque-only CLI stdout, timestamped CSV with no import surface, localhost immutable Datasette, 20 reads, ten distinct encoded write rejections, unchanged rows, and kill/wait cleanup: Tasks 7A–7B.
- Exact code-owned artifact allowlist, work-tree DRAFT PII check, exact fixtures, at-least-49 enumerated test functions, real function-definition checks, measured numeric criteria tied to exact node IDs, safe unknown-phase output, actual `main()` JSON/exit proof, pinned runtime prerequisites, child environment enforcement, and the sole `py -3 -m scripts.prospecting.gate --phase P1` command: Task 8.
- `.githooks/pre-commit` is explicitly allowlisted for modification by the P1 boss ruling at spec lines 952–953. No additional decision is required; the plan and gate manifest must treat that ruling as authoritative.
- Temporal gate note: inspector `≥90` is a promotion condition after the boss gate in the spec’s phase sequence, so Task 8 reports it as the required next human-controlled condition rather than fabricating a pre-gate inspector result.

## Changelog v1→v2

- Review edit 1 / §2 schema-integrity gaps / §3 tests 02 and 04: Task 2A Steps 1 and 3 add executable CHECK coverage, approved-only and non-sales activation, campaign/policy approval equality, operation-specific approval nullability, overlap-to-review behavior, one-valid-contact enforcement, and campaign-scoped tranche selection.
- Review edit 2 / §3 tests 08, 12, and 13: Task 2B Step 1 asserts both writer threads terminate; Task 3A Steps 1 and 3 inject post-close failure and prove full rollback, and route conflicting observations through `ingest_observations()` so the repository creates the review.
- Review edit 3 / §2 defect 9 / §3 tests 20, 22, 23, 25, 26, 28, and 30: Task 4 Steps 1 and 3 enforce the ruled ID grammar by field kind, closed operation/lane/provider/label enums, hostile-text rejection, unresolved/ambiguous compiler failure, persisted/audited overrides and all eligibility outcomes, complete approval scope/freshness/nonce/route validation, and both cross-kind/update-trigger failures.
- Review §3 test 15: Task 3B Steps 1 and 3 persist immutable terminal provider attempts, pause the campaign, and audit adapter disablement on overage; release also records an immutable skipped-budget attempt.
- Review edit 4 / §3 tests 31 and 36–40: Task 5 Steps 1 and 3 exercise each class structurally and by decoded content at every sink, use the repository's actual combined hook with sync fixtures, retain the existing sync failure, and validate reserved synthetic fixture contents before exemption.
- Review §3 tests 41, 43, and 44: Task 6 Steps 1 and 3 introspect the public module/class surface, call the default closed `_act`, and assert exactly one audit row and the static rejection result.
- Review edit 5 / §2 defects 1 and 2 / §3 tests 16 and 17: Task 7A Steps 1 and 3 persist audited fit vetoes, reject missing subjects, require approved current-policy human approval before activation, invoke the real two-word CLI with opaque-only stdout, and replace the tautological re-import function with proof that no import surface exists.
- Review edit 6 / §2 defects 3–5 / §3 tests 18 and 19: Task 7B Steps 1 and 3 remove pip, pin the preinstalled runtime, launch `[sys.executable, "-m", "datasette", ...]` with `CREATE_NEW_PROCESS_GROUP`, kill/wait directly, issue ten distinct encoded SQL writes to the real database query endpoint, require explicit read-only rejection bodies, and re-read unchanged rows after each statement.
- Review edit 7 / §2 defects 6–8 and 10–11 / §3 tests 45–48: Tasks 1 and 8 make `STATE.md` a work-tree DRAFT, hard-code and compare the exact P1 allowlist, parse rename paths, resolve and record the Python 3.13.7 interpreter once, enforce SQLite 3.50.4 and Datasette 0.65.1, propagate and verify the subprocess no-network marker, guard phase input before output, tie criteria to recorded measurements and exact node IDs, and exercise `main()` JSON/exit behavior. The sole gate command is the ruled `py -3` form; the spec will be aligned.
- Review edit 8: Coverage now records the authoritative `.githooks/pre-commit` allowlist ruling verbatim and requires no further decision.
- §2 defect 7 and §3 test 47: Task 8 rejects self-authorized manifest artifacts against `P1_ARTIFACTS` and independently validates the exact fixture set.
- §2 defect 8: Global Constraints plus Tasks 1, 6, 7B, and 8 define the bounded P1 process-level socket guard and reject any child lacking `KB_PROSPECTING_NO_NETWORK=1`; this is explicitly not an OS-wide firewall claim.

## V2 regression vectors

These machine-readable vectors restate the red/green obligations without replacing any Step 1 or
Step 3 code. Each `red_when` names the implementation regression that must make its owning test fail.

```json
{"id":"V01","owner":"Task 2A","red_when":"a required table is removed","expect":"exact schema inventory"}
```

```json
{"id":"V02","owner":"Task 2A","red_when":"an enum, range, or conditional CHECK is removed","expect":"invalid insert accepted by no case"}
```

```json
{"id":"V03","owner":"Task 2A/7A","red_when":"draft or sales campaign becomes active","expect":"activation rejected"}
```

```json
{"id":"V04","owner":"Task 2A/4","red_when":"approval campaign and policy diverge","expect":"insert and update rejected"}
```

```json
{"id":"V05","owner":"Task 2A/4","red_when":"approval nullability ignores operation","expect":"request rejected"}
```

```json
{"id":"V06","owner":"Task 2A/3A","red_when":"open employment overlap is silently accepted","expect":"open merge review created"}
```

```json
{"id":"V07","owner":"Task 2A/3A","red_when":"two valid contacts project for one person","expect":"uniqueness rejection"}
```

```json
{"id":"V08","owner":"Task 2B","red_when":"a writer is lost or survives timeout","expect":"two increments and terminated threads"}
```

```json
{"id":"V09","owner":"Task 3A","red_when":"role-change failure leaves any partial mutation","expect":"full rollback"}
```

```json
{"id":"V10","owner":"Task 3A","red_when":"conflict ingestion does not create review","expect":"repository-created open review"}
```

```json
{"id":"V11","owner":"Task 3B","red_when":"overage omits pause, attempt, or adapter audit","expect":"all terminal effects present"}
```

```json
{"id":"V12","owner":"Task 4","red_when":"any of ten predicate types is rejected","expect":"all typed vocabulary accepted"}
```

```json
{"id":"V13","owner":"Task 4","red_when":"company name is unresolved or ambiguous","expect":"compiler fails closed"}
```

```json
{"id":"V14","owner":"Task 4","red_when":"ID prefix or hex length is wrong","expect":"payload rejected by field kind"}
```

```json
{"id":"V15","owner":"Task 4","red_when":"lane, provider, label, or operation is unknown","expect":"payload rejected"}
```

```json
{"id":"V16","owner":"Task 4","red_when":"payload contains whitespace, shell text, URL, at-sign, or long digits","expect":"payload rejected"}
```

```json
{"id":"V17","owner":"Task 4","red_when":"approximate override is unpersisted, unaudited, or non-human","expect":"selection fails"}
```

```json
{"id":"V18","owner":"Task 4","red_when":"an eligibility outcome is not persisted exactly","expect":"round trip for all outcomes"}
```

```json
{"id":"V19","owner":"Task 4","red_when":"approval hash resolves across content kinds","expect":"insert and update rejected both directions"}
```

```json
{"id":"V20","owner":"Task 4","red_when":"send approval scope, expiry, nonce, route, hash, or human binding is invalid","expect":"send rejected"}
```

```json
{"id":"V21","owner":"Task 5","red_when":"a structural sensitive field reaches any VM sink","expect":"56 structural rejections"}
```

```json
{"id":"V22","owner":"Task 5","red_when":"a content pattern reaches any VM sink","expect":"56 content rejections"}
```

```json
{"id":"V23","owner":"Task 5","red_when":"mixed HTML and percent encoding evades detection","expect":"decoded class detected"}
```

```json
{"id":"V24","owner":"Task 5","red_when":"actual combined hook loses sync or PII invocation","expect":"temporary commit blocked"}
```

```json
{"id":"V25","owner":"Task 5","red_when":"fixture exemption admits non-reserved data","expect":"fixture_not_synthetic"}
```

```json
{"id":"V26","owner":"Task 6","red_when":"raw public executor method is added outside capability tuple","expect":"surface introspection fails"}
```

```json
{"id":"V27","owner":"Task 6","red_when":"default adapter opens or audit multiplicity changes","expect":"adapter_disabled and one audit"}
```

```json
{"id":"V28","owner":"Task 7A","red_when":"veto is not persisted and audited","expect":"active fit_veto row"}
```

```json
{"id":"V29","owner":"Task 7A","red_when":"CLI accepts other than two words or echoes operand","expect":"nonzero or opaque event ID only"}
```

```json
{"id":"V30","owner":"Task 7A","red_when":"export module gains an import callable","expect":"public surface mismatch"}
```

```json
{"id":"V31","owner":"Task 7B/8","red_when":"Python, SQLite, or Datasette version differs","expect":"gate fails before tests"}
```

```json
{"id":"V32","owner":"Task 7B","red_when":"Datasette is not loopback immutable or 20 reads fail","expect":"HTTP proof fails"}
```

```json
{"id":"V33","owner":"Task 7B","red_when":"any of ten encoded writes succeeds or changes rows","expect":"explicit 4xx and unchanged SELECT"}
```

```json
{"id":"V34","owner":"Task 8","red_when":"a child lacks KB_PROSPECTING_NO_NETWORK=1","expect":"child rejected and counted"}
```

```json
{"id":"V35","owner":"Task 8","red_when":"allowlist, measurement, manifest function, phase guard, or JSON exit regresses","expect":"gate test fails"}
```

## Self-review checklist

- [x] Confirmed the Coverage mapping against §Data and §P1; the boss's hook allowlist ruling and work-tree DRAFT routing are applied without a pending pre-execution decision.
- [x] Scanned this plan for deferred-work markers and incomplete implementation phrases; zero matches.
- [x] Verified every named interface is defined before its first downstream use, signatures match imports and tests, and the manifest node IDs match exactly.
- [x] Counted definitions and manifest entries independently: both are at least 49 with base-function distribution `20 + 11 + 10 + 4 + 4`; parameterized cases expand the collected pytest case count.
- [x] Verified the fixture directory contract contains exactly four names and each specified fixture domain/value is synthetic.
