from __future__ import annotations

import json
import os
import re
import shlex
import struct
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import shutil
import hashlib
from contextlib import redirect_stdout
from io import StringIO

import pytest

from scripts.prospecting.p6_contracts import (
    validate_pre_commit_hook,
    validate_runtime_contracts,
    validate_schema,
    verify_prerequisites,
)
from scripts.prospecting.store import open_store
from scripts.prospecting import executor_campaigner
from scripts.prospecting.tests.p6_support import (
    LocalCampaignerTransport,
    build_p6_refire_store,
)
from scripts.prospecting.deploy_preflight import Environment, check, production
from scripts.prospecting.manager.bridge import DesktopBridge
from scripts.prospecting import run_workflow
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_deployment")


def test_authoritative_p1_schema_contract(tmp_path: Path) -> None:
    db = open_store(tmp_path / "p1-contract.sqlite")
    assert validate_schema(db) == ()
    assert db.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert {row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='trigger'"
    )} >= {"audit_append_only", "audit_delete_append_only"}

    db.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender-1", "Synthetic", None, "focus", "background", "proof", "{}"),
    )
    db.execute(
        """INSERT INTO campaign(
           campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
           template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
           firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            "camp_0000000000000001", "networking", "sender-1", "{}", "informational_call",
            15, "direct", "networking-v1", "[]", "09:00-17:00", "America/New_York",
            25, 6, 2, "T1", "pol_0000000000000001", "{}", 0, "draft", "a" * 64,
        ),
    )
    db.execute(
        """INSERT INTO approval(
           approval_id,assertion_ref,campaign_id,policy_hash,content_kind,revision_hash,
           contact_id,mailbox_id,approver,approved_at,expires_at,tier,send_window,nonce,
           permitted_action,consumed_at,scope_hash,invalidation_reason
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            "apr_0000000000000001", "assertion-1", "camp_0000000000000001", "a" * 64,
            "campaign_policy", None, None, None,
            "human:reviewer", "2099-05-31T00:00:00Z", "2099-06-01T00:00:00Z", "T1",
            '{"end":"2099-06-01T00:00:00Z","start":"2099-05-31T00:00:00Z"}',
            "nonce-1", "activate_campaign", "2099-05-31T01:00:00Z", "c" * 64, None,
        ),
    )
    db.execute(
        "INSERT INTO audit VALUES(?,?,?,?,?,?,?,?,?)",
        ("audit-1", "tester", "test", "test", "entity-1", "2026-09-03T00:00:00Z", None, None, "test"),
    )
    with pytest.raises(sqlite3.IntegrityError, match="audit_is_append_only"):
        db.execute("UPDATE audit SET reason='changed' WHERE event_id='audit-1'")
    with pytest.raises(sqlite3.IntegrityError, match="audit_is_append_only"):
        db.execute("DELETE FROM audit WHERE event_id='audit-1'")


def test_recorded_gates_are_required() -> None:
    calls: list[list[str]] = []

    def run(argv, **kwargs):
        calls.append(argv)
        phase = argv[argv.index("--phase") + 1]
        return type("R", (), {
            "returncode": 0,
            "stdout": json.dumps({"phase": phase, "recorded": "matched", "passed": True}),
        })()

    facts = verify_prerequisites(Path.cwd(), run)
    assert calls == [
        ["py", "-3", "-m", "scripts.prospecting.gate", "--phase", phase, "--verify-recorded"]
        for phase in ("P1", "P2", "P3", "P4", "P5")
    ]
    assert facts["phases"] == ["P1", "P2", "P3", "P4", "P5"]


def test_recorded_gate_mismatch_never_passes() -> None:
    count = 0

    def mismatch(argv, **kwargs):
        nonlocal count
        count += 1
        phase = argv[argv.index("--phase") + 1]
        matched = count < 3
        return type("R", (), {
            "returncode": 0 if matched else 1,
            "stdout": json.dumps({
                "phase": phase,
                "recorded": "matched" if matched else "mismatch",
                "passed": matched,
            }),
        })()

    with pytest.raises(RuntimeError, match="recorded_gate_failed:P3"):
        verify_prerequisites(Path.cwd(), mismatch)


def test_pending_ok_is_dry_run_only() -> None:
    def absent_after_p1(argv, **kwargs):
        phase = argv[argv.index("--phase") + 1]
        present = phase == "P1"
        return type("R", (), {
            "returncode": 0 if present else 3,
            "stdout": json.dumps({
                "phase": phase,
                "recorded": "matched" if present else "absent",
                "passed": present,
            }),
        })()

    facts = verify_prerequisites(Path.cwd(), absent_after_p1, pending_ok=True)
    assert facts["pending"] == ["P2", "P3", "P4", "P5"]
    with pytest.raises(RuntimeError, match="recorded_gate_absent:P2"):
        verify_prerequisites(Path.cwd(), absent_after_p1)


def test_pre_commit_hook_contract_is_retained() -> None:
    assert validate_pre_commit_hook(Path.cwd()) == ()


def test_schema_contract_reports_each_missing_constraint_category(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite"
    db = open_store(source)
    db.close()

    mutations = {
        "foreign_key": (
            "source_observation",
            "snapshot_id TEXT REFERENCES source_snapshot(snapshot_id)",
            "snapshot_id TEXT",
        ),
        "check": (
            "company",
            "CHECK (website_url IS NULL OR website_url LIKE 'https://%')",
            "CHECK (website_url IS NULL OR website_url LIKE 'http://%')",
        ),
        "unique": ("company", "dedupe_key TEXT NOT NULL UNIQUE", "dedupe_key TEXT NOT NULL"),
    }
    for category, (table, old, new) in mutations.items():
        scratch = tmp_path / f"missing-{category}.sqlite"
        source_copy = sqlite3.connect(source)
        destination_copy = sqlite3.connect(scratch)
        source_copy.backup(destination_copy)
        destination_copy.close()
        source_copy.close()
        altered = sqlite3.connect(scratch)
        altered.execute("PRAGMA writable_schema = ON")
        unique_index = next(
            (row[1] for row in altered.execute(f"PRAGMA index_list('{table}')") if row[2] and row[3] == "u"),
            None,
        )
        ddl = altered.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()[0]
        altered.execute(
            "UPDATE sqlite_master SET sql=? WHERE type='table' AND name=?", (ddl.replace(old, new), table)
        )
        if category == "unique":
            assert unique_index is not None
            altered.execute("DELETE FROM sqlite_master WHERE type='index' AND name=?", (unique_index,))
        version = altered.execute("PRAGMA schema_version").fetchone()[0]
        altered.execute(f"PRAGMA schema_version = {version + 1}")
        altered.execute("PRAGMA writable_schema = OFF")
        altered.commit()
        altered.close()

        checked = sqlite3.connect(scratch)
        checked.execute("PRAGMA foreign_keys = ON")
        assert any(finding.startswith(f"{category}:") for finding in validate_schema(checked))
        checked.close()


def test_schema_contract_reports_each_missing_p6_trigger(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite"
    db = open_store(source)
    db.close()
    for trigger in ("audit_append_only", "audit_delete_append_only"):
        scratch = tmp_path / f"missing-{trigger}.sqlite"
        source_copy = sqlite3.connect(source)
        destination_copy = sqlite3.connect(scratch)
        source_copy.backup(destination_copy)
        destination_copy.close()
        source_copy.close()
        altered = sqlite3.connect(scratch)
        altered.execute(f"DROP TRIGGER {trigger}")
        altered.commit()
        altered.close()

        checked = sqlite3.connect(scratch)
        checked.execute("PRAGMA foreign_keys = ON")
        assert f"trigger:{trigger}" in validate_schema(checked)
        checked.close()


def test_schema_contract_reports_altered_p6_trigger_body(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite"
    db = open_store(source)
    db.close()
    for trigger in ("audit_append_only", "audit_delete_append_only"):
        scratch = tmp_path / f"altered-{trigger}.sqlite"
        source_copy = sqlite3.connect(source)
        destination_copy = sqlite3.connect(scratch)
        source_copy.backup(destination_copy)
        destination_copy.close()
        source_copy.close()
        altered = sqlite3.connect(scratch)
        altered.execute("PRAGMA writable_schema = ON")
        sql = altered.execute(
            "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?", (trigger,)
        ).fetchone()[0]
        altered.execute(
            "UPDATE sqlite_master SET sql=? WHERE type='trigger' AND name=?",
            (sql.replace("END", "SELECT 1; END"), trigger),
        )
        version = altered.execute("PRAGMA schema_version").fetchone()[0]
        altered.execute(f"PRAGMA schema_version = {version + 1}")
        altered.execute("PRAGMA writable_schema = OFF")
        altered.commit()
        altered.close()

        checked = sqlite3.connect(scratch)
        checked.execute("PRAGMA foreign_keys = ON")
        assert f"trigger:{trigger}:body" in validate_schema(checked)
        checked.close()


def test_pre_commit_hook_requires_exact_pii_guard_line(tmp_path: Path) -> None:
    hook = Path.cwd() / ".githooks/pre-commit"
    destination = tmp_path / ".githooks"
    destination.mkdir()
    copied = destination / "pre-commit"
    shutil.copy2(hook, copied)
    copied.write_text(
        copied.read_text(encoding="utf-8").replace(
            "py -3 -m scripts.prospecting.pii_guard --staged || exit 1",
            "py -3 -m scripts.prospecting.pii_guard --staged --verbose || exit 1",
        ),
        encoding="utf-8",
    )
    assert "hook:pii_guard" in validate_pre_commit_hook(tmp_path)


def test_pre_commit_hook_requires_pii_guard_line(tmp_path: Path) -> None:
    hook = Path.cwd() / ".githooks/pre-commit"
    destination = tmp_path / ".githooks"
    destination.mkdir()
    copied = destination / "pre-commit"
    shutil.copy2(hook, copied)
    copied.write_text(
        copied.read_text(encoding="utf-8").replace(
            "py -3 -m scripts.prospecting.pii_guard --staged || exit 1\n", ""),
        encoding="utf-8",
    )
    assert "hook:pii_guard" in validate_pre_commit_hook(tmp_path)


def test_inherited_runtime_signatures() -> None:
    assert validate_runtime_contracts() == ()


def _table_fingerprints(connection: sqlite3.Connection) -> dict[str, tuple[int, str]]:
    tables = tuple(
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    )
    result: dict[str, tuple[int, str]] = {}
    for table in tables:
        rows = [tuple(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY rowid")]
        content = json.dumps(rows, default=str, separators=(",", ":"), ensure_ascii=True)
        result[table] = (len(rows), hashlib.sha256(content.encode("ascii")).hexdigest())
    return result


def _proposed_cadences(document: str | None = None) -> dict[str, dict[str, object]]:
    if document is None:
        document = (Path.cwd() / "orgs/prospecting/cadences-proposed.md").read_text(encoding="utf-8")
    result: dict[str, dict[str, object]] = {}
    workflows = {"outreach-sweep": "enroll-only", "reply-scan": "reply-triage"}
    for section in document.split("\n## ")[1:]:
        lines = section.splitlines()
        cadence_id = lines[0]
        workflow = workflows[cadence_id]
        local_start = next(
            line.removeprefix("- local start: ")
            for line in lines if line.startswith("- local start: ")
        )
        local_resume = next(
            line.removeprefix("- local resume: ")
            for line in lines if line.startswith("- local resume: ")
        )
        bridge = next(
            line.removeprefix("- bridge: ")
            for line in lines if line.startswith("- bridge: ")
        )
        writes = next(line.removeprefix("- writes: ") for line in lines if line.startswith("- writes: "))
        environment = [line for line in lines if line.startswith("- env:")]
        assert environment == []
        assert not any(line.startswith("- command: ") for line in lines)
        assert "SSH is refused" in bridge
        assert "ssh_saved_request_resolver_unavailable" in bridge
        for declaration in (local_start, local_resume):
            flags = {
                match.group(0).split("=", 1)[0]
                for match in re.finditer(
                    r"(?<![0-9A-Za-z_-])--[a-z][a-z0-9-]*(?:=[^\s`]+)?",
                    declaration,
                )
            }
            assert "--ssh" not in flags
            assert "--ask" not in flags
        assert "--campaign-id" in local_resume
        if cadence_id == "outreach-sweep":
            assert "--store" in local_resume
            assert "model-response" in local_resume
            assert "prepared-output" in local_resume
            assert "outbox" in local_resume
            command = local_start.strip("`")
            argv = shlex.split(command)
            assert argv[:5] == [
                "py", "-3", "-m", "scripts.prospecting.run_workflow", "--workflow",
            ]
            assert argv[5:7] == [workflow, "--local"]
            for flag in (
                "--ask-file", "--store", "--create-request",
                "--sender-profile-id", "--mailbox-id", "--model-response-file",
                "--prepared-output-file", "--outbox",
            ):
                assert flag in argv
            assert "--ask" not in argv and "--ssh" not in argv
        else:
            assert f"`--workflow {workflow} --local`" in local_start
            assert "saved store and required output paths" in local_resume
        result[cadence_id] = {
            "workflow": workflow,
            "env": {},
            "writes": set(filter(None, writes.split(","))),
        }
    return result


@pytest.mark.parametrize(
    ("field", "forbidden"),
    (
        ("local start", "--ssh"),
        ("local start", "--ask=unsafe"),
        ("local resume", "--ssh"),
        ("local resume", "--ask=unsafe"),
    ),
)
def test_reply_cadence_declarations_reject_forbidden_source_flags(
    field: str, forbidden: str,
) -> None:
    document = (Path.cwd() / "orgs/prospecting/cadences-proposed.md").read_text(
        encoding="utf-8"
    )
    before, reply = document.split("\n## reply-scan\n", 1)
    lines = reply.splitlines()
    index = next(
        index for index, line in enumerate(lines)
        if line.startswith(f"- {field}: ")
    )
    lines[index] += " " + forbidden
    mutated = before + "\n## reply-scan\n" + "\n".join(lines)
    with pytest.raises(AssertionError):
        _proposed_cadences(mutated)


def _assert_counts_only(output: list[str]) -> None:
    assert len(output) == 1
    counts = json.loads(output[0])
    assert isinstance(counts, dict)
    assert counts and all(isinstance(key, str) and isinstance(value, int) for key, value in counts.items())


def _run_cadence(
    bridge: DesktopBridge, workflow: str, attempt: int, outbox: Path,
) -> dict[str, int]:
    class LocalBridge:
        def __init__(self) -> None:
            self.calls: list[tuple[str, str, str | None]] = []

        def invoke(self, entrypoint, job, mode, host=None):
            self.calls.append((entrypoint, mode, host))
            assert mode == "local" and host is None
            return bridge.invoke(entrypoint, job, mode, host=host)

    assert attempt in {1, 2}
    local_bridge = LocalBridge()
    assert bridge.store_path is not None
    desktop_root = bridge.store_path.parent
    campaign_id = "camp_0000000000000001"
    compiled = {
        "campaign_id": campaign_id,
        "policy_id": "policy-" + "a" * 16,
        "policy_hash": "a" * 64,
        "sender_profile_id": "pol_0000000000000001",
        "mailbox_id": "pol_0000000000000001",
        "drafting_configured": False,
        "target_policy": {"requested_people": 0, "lane_plan": ["manual"]},
    }
    argv = [
        "--workflow", workflow,
        "--local",
        "--campaign-id", campaign_id,
        "--store", str(bridge.store_path),
        "--model-response-file", str(desktop_root / "model-response.json"),
        "--prepared-output-file", str(desktop_root / "prepared-output.json"),
        "--outbox", str(outbox),
    ]

    def compile_saved(reference: str) -> dict[str, object]:
        assert reference == campaign_id
        return compiled

    output = StringIO()
    with redirect_stdout(output):
        assert run_workflow.main(
            argv,
            compile_ref=compile_saved,
            bridge=local_bridge,
            prerequisites=lambda _pending_ok: {
                phase: "passed" for phase in ("P1", "P2", "P3", "P4")
            },
        ) == 0
    assert local_bridge.calls and all(
        mode == "local" and host is None
        for _, mode, host in local_bridge.calls
    )
    outcome = json.loads(output.getvalue())
    assert outcome["state"] in {"complete", "parked"}
    counts = outcome["counts"]
    assert isinstance(counts, dict)
    return {key: value for key, value in counts.items() if type(value) is int}


def _row_count(connection: sqlite3.Connection, statement: str) -> int:
    return int(connection.execute(statement).fetchone()[0])


def test_scheduler_refire_is_a_noop(tmp_path: Path, record_property, monkeypatch) -> None:
    from scripts.prospecting.campaigner.fake_gmail import ArrivalPoint

    monkeypatch.setattr("scripts.prospecting.executor_campaigner.ZoneInfo", lambda _name: timezone.utc)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    fixture = build_p6_refire_store(tmp_path)
    transport = LocalCampaignerTransport(fixture.service)
    bridge = DesktopBridge(
        fixture.desktop_root / "jobs",
        launch=transport,
        local_app_data=fixture.desktop_root.parent,
        store_path=fixture.desktop_root / "store.sqlite",
        repo_root=Path(__file__).parents[3],
    )
    cadences = _proposed_cadences()
    assert set(cadences) == {"outreach-sweep", "reply-scan"}

    observed_writes: dict[str, set[str]] = {}
    for cadence_id in ("outreach-sweep", "reply-scan"):
        if cadence_id == "reply-scan":
            fixture.gmail.queue_inbound(
                ArrivalPoint.BEFORE_REFRESH, fixture.inbound_thread_id,
                "Synthetic", {"From": SYNTHETIC["from_email"]}, "No thanks",
            )
            fixture.gmail.arrive(ArrivalPoint.BEFORE_REFRESH)
        before = _table_fingerprints(fixture.connection)
        before_drafts = _row_count(
            fixture.connection, "SELECT count(*) FROM audit WHERE action='gmail_draft'",
        )
        before_labels = _row_count(
            fixture.connection, "SELECT count(*) FROM exec_request WHERE operation='gmail_label'",
        )
        before_due = _row_count(
            fixture.connection,
            "SELECT count(*) FROM delivery WHERE state='reserved'",
        )
        before_stopped = _row_count(
            fixture.connection, "SELECT count(*) FROM enrollment WHERE status='stopped'",
        )
        before_blocked = _row_count(
            fixture.connection, "SELECT count(*) FROM enrollment WHERE status='blocked'",
        )
        first = _run_cadence(bridge, cadences[cadence_id]["workflow"], 1, tmp_path / f"{cadence_id}-first")
        after_first = _table_fingerprints(fixture.connection)
        observed_writes[cadence_id] = {table for table in before if before[table] != after_first[table]}
        assert first and all(type(value) is int for value in first.values())
        second = _run_cadence(bridge, cadences[cadence_id]["workflow"], 2, tmp_path / f"{cadence_id}-refire")
        assert second == first
        assert _table_fingerprints(fixture.connection) == after_first

    assert {cadence_id: cadences[cadence_id]["writes"] for cadence_id in cadences} == observed_writes
    assert len(transport.calls) == 8
    record_property("refire_noop_runs", 2)


def test_scheduler_wake_does_not_catch_up_past_caps(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("scripts.prospecting.executor_campaigner.ZoneInfo", lambda _name: timezone.utc)
    # Legacy scheduler-wake cadence predates the P16 editorial-readiness
    # gate; this narrow per-test patch exercises cap-bounded draft
    # mechanics only and does not exercise or assert P16 revision-readiness.
    monkeypatch.setattr(executor_campaigner, "_revision_ready", lambda *_args: True)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    fixture = build_p6_refire_store(tmp_path)
    fixture.connection.execute("UPDATE campaign SET daily_cap=1,hourly_cap=1")
    fixture.connection.commit()
    initial = datetime.fromisoformat(fixture.service.now())
    fixture.service.now = lambda: (initial + timedelta(hours=6)).isoformat()
    bridge = DesktopBridge(
        fixture.desktop_root / "jobs",
        launch=LocalCampaignerTransport(fixture.service),
        local_app_data=fixture.desktop_root.parent,
        store_path=fixture.desktop_root / "store.sqlite",
        repo_root=Path(__file__).parents[3],
    )
    before_drafts = _row_count(
        fixture.connection, "SELECT count(*) FROM audit WHERE action='gmail_draft'",
    )

    result = _run_cadence(
        bridge, _proposed_cadences()["outreach-sweep"]["workflow"], 1, tmp_path / "wake",
    )

    drafted = _row_count(
        fixture.connection, "SELECT count(*) FROM audit WHERE action='gmail_draft'",
    ) - before_drafts
    assert result["considered"] == 2
    assert result["drafted"] == drafted == 1


def test_preflight_uses_exact_local_and_single_ssh_argv(tmp_path: Path) -> None:
    calls = []
    responses = {
        ("git", "branch", "--show-current"): (0, "ops"),
        ("git", "rev-parse", "HEAD"): (0, "abc123"),
        ("git", "merge-base", "--is-ancestor", "abc123", "HEAD"): (0, ""),
        ("py", "-3", "--version"): (0, "Python 3.13.7"),
        ("datasette", "--version"): (0, "0.65.1"),
        ("py", "-3", "-m", "playwright", "--version"): (0, "Version 1.55.0"),
        ("tailscale", "status", "--json"): (
            0, json.dumps({"Peer": {"node": {"HostName": "desktop", "Online": True}}})
        ),
        ("ssh", "--", "desktop", "py", "-3", "-c", "raise SystemExit(0)"): (0, ""),
    }
    for phase in ("P1", "P2", "P3", "P4", "P5"):
        responses[(
            "py", "-3", "-m", "scripts.prospecting.gate", "--phase", phase,
            "--verify-recorded",
        )] = (0, json.dumps({"phase": phase, "status": "passed"}))

    def runner(argv, **kwargs):
        calls.append(tuple(argv))
        if argv[:2] == ["git", "grep"]:
            return type("R", (), {"returncode": 1, "stdout": "", "stderr": ""})()
        code, out = responses[tuple(argv)]
        return type("R", (), {"returncode": code, "stdout": out, "stderr": ""})()

    results = check(production(tmp_path, "desktop", "abc123", runner=runner))
    assert all(item.ok for item in results)
    scan = next(argv for argv in calls if argv[:2] == ("git", "grep"))
    assert scan[:4] == ("git", "grep", "-Iil", "-E")
    assert all(marker in scan[4] for marker in ("BEGIN", "OPENSSH", "token=", "api_key", "secret"))
    assert len([argv for argv in calls if argv[0] == "ssh"]) == 1
    assert not any(argv[:2] == ("git", "fetch") for argv in calls)
    assert not any("resolve_store_path" in part for argv in calls for part in argv)


def test_tailscale_json_and_redaction_fail_closed(tmp_path: Path) -> None:
    def runner(argv, **kwargs):
        if argv[:3] == ["tailscale", "status", "--json"]:
            return type("R", (), {"returncode": 0, "stdout": '{"Peer":{}}', "stderr": ""})()
        return type("R", (), {"returncode": 1, "stdout": "", "stderr": "redacted"})()

    results = check(production(tmp_path, "desktop", "abc123", runner=runner))
    assert next(item for item in results if item.name == "tailscale").ok is False
    rendered = json.dumps([item.__dict__ for item in results])
    assert "credential" not in rendered.lower() and "token" not in rendered.lower()


@pytest.mark.parametrize(
    ("exit_code", "stdout", "ok", "code"),
    [
        (0, "scripts/example.py", False, "secret_paths_found"),
        (1, "", True, "paths_only_scan"),
        (128, "", False, "scan_error"),
    ],
)
def test_preflight_tracked_secret_scan_exit_codes(
    tmp_path: Path, exit_code: int, stdout: str, ok: bool, code: str,
) -> None:
    def runner(argv, **kwargs):
        if argv[:2] == ["git", "grep"]:
            return type("R", (), {"returncode": exit_code, "stdout": stdout, "stderr": ""})()
        if "--verify-recorded" in argv:
            phase = argv[argv.index("--phase") + 1]
            output = json.dumps({"phase": phase, "status": "passed"})
            return type("R", (), {"returncode": 0, "stdout": output, "stderr": ""})()
        outputs = {
            ("git", "branch", "--show-current"): "ops",
            ("git", "rev-parse", "HEAD"): "abc123",
            ("py", "-3", "--version"): "Python 3.13.7",
            ("datasette", "--version"): "0.65.1",
            ("py", "-3", "-m", "playwright", "--version"): "Version 1.55.0",
            ("tailscale", "status", "--json"): json.dumps({"Peer": {"node": {"HostName": "desktop", "Online": True}}}),
        }
        return type("R", (), {"returncode": 0, "stdout": outputs.get(tuple(argv), ""), "stderr": ""})()

    result = next(item for item in check(production(tmp_path, "desktop", "abc123", runner=runner)) if item.name == "tracked_secrets")
    assert (result.ok, result.code) == (ok, code)


@pytest.mark.parametrize(
    ("failure", "expected_code"),
    [
        ("version", "version_parse_error"),
        ("tailscale", "tailscale_json_error"),
        ("record", "record_verify_error"),
        ("nonzero", "subprocess_exit_23"),
        ("oserror", "subprocess_error"),
    ],
)
def test_preflight_probe_failures_are_reported_and_do_not_abort(
    tmp_path: Path, failure: str, expected_code: str,
) -> None:
    def runner(argv, **kwargs):
        if failure == "oserror" and argv == ["py", "-3", "--version"]:
            raise OSError("synthetic")
        if failure == "nonzero" and argv == ["datasette", "--version"]:
            return type("R", (), {"returncode": 23, "stdout": "", "stderr": ""})()
        if "--verify-recorded" in argv:
            phase = argv[argv.index("--phase") + 1]
            output = "{" if failure == "record" and phase == "P1" else json.dumps(
                {"phase": phase, "status": "passed"},
            )
            return type("R", (), {"returncode": 0, "stdout": output, "stderr": ""})()
        outputs = {
            ("git", "branch", "--show-current"): "ops",
            ("git", "rev-parse", "HEAD"): "abc123",
            ("py", "-3", "--version"): "unknown" if failure == "version" else "Python 3.13.7",
            ("datasette", "--version"): "0.65.1",
            ("py", "-3", "-m", "playwright", "--version"): "Version 1.55.0",
            ("tailscale", "status", "--json"): "{" if failure == "tailscale" else json.dumps(
                {"Peer": {"node": {"HostName": "desktop", "Online": True}}},
            ),
        }
        return type("R", (), {"returncode": 1 if argv[:2] == ["git", "grep"] else 0, "stdout": outputs.get(tuple(argv), ""), "stderr": ""})()

    results = check(production(tmp_path, "desktop", "abc123", runner=runner))
    assert not all(item.ok for item in results)
    assert any(item.code == expected_code and not item.ok for item in results)
    assert len(results) == 8


def test_preflight_unexpected_probe_exception_is_reported_and_does_not_abort(tmp_path: Path) -> None:
    def explode():
        raise RuntimeError("synthetic")

    environment = Environment(
        tmp_path, explode, lambda: ("P1", "P2", "P3", "P4", "P5"),
        lambda _name: "3.13.7", lambda: True, lambda: True, lambda: (1, ""),
    )
    results = check(environment)
    assert not all(item.ok for item in results)
    assert next(item for item in results if item.name == "merged").code == "probe_error"
    assert len(results) == 8


def _minimal_timezone_file() -> bytes:
    """Provide collection-only zone data on minimal Windows Python installs."""
    return (
        b"TZif" + bytes(16) + struct.pack(">6l", 0, 0, 0, 0, 1, 4)
        + struct.pack(">lbb", 0, 0, 0) + b"UTC" + bytes(1)
    )


def _live_p6_nodes(root: Path) -> set[str]:
    with tempfile.TemporaryDirectory() as temporary:
        zoneinfo = Path(temporary)
        eastern = zoneinfo / "America"
        eastern.mkdir()
        (eastern / "New_York").write_bytes(_minimal_timezone_file())
        collected = subprocess.run(
            [
                sys.executable, "-m", "pytest", "--collect-only", "-q",
                "scripts/prospecting/tests", "--basetemp", ".pytest-tmp-pc6",
                "-p", "no:cacheprovider",
            ],
            cwd=root, text=True, capture_output=True, check=False,
            env={**os.environ, "PYTHONTZPATH": str(zoneinfo)},
        )
    assert collected.returncode == 0, collected.stderr
    return {
        line for line in collected.stdout.splitlines()
        if line.startswith("scripts/prospecting/tests/") and "::" in line
        and not line.startswith("scripts/prospecting/tests/test_gate.py::")
        and "datasette" not in line and "launcher" not in line
    }


def _manifest_complete(value: dict[str, object], live_nodes: set[str]) -> bool:
    manifest_nodes = set(value["tests"])
    manifest_files = {node.split("::", 1)[0] for node in manifest_nodes}
    return (
        value["criteria"]["minimum_enumerated_tests"] == len(value["tests"])
        and manifest_nodes <= live_nodes
        and {
            node for node in live_nodes
            if node.split("::", 1)[0] in manifest_files
        } <= manifest_nodes
    )


def test_p6_manifest_is_numeric_and_complete() -> None:
    root = Path(__file__).parents[3]
    value = json.loads((root / "scripts/prospecting/gate_manifest_p6.json").read_text())
    assert value["phase"] == "P6"
    live_nodes = _live_p6_nodes(root)
    assert _manifest_complete(value, live_nodes)
    synthetic_value = {
        "tests": ["scripts/prospecting/tests/test_p6.py::test_manifest"],
        "criteria": {"minimum_enumerated_tests": 1},
    }
    future_node = "scripts/prospecting/tests/test_zz_future.py::test_x"
    assert _manifest_complete(synthetic_value, {*synthetic_value["tests"], future_node})
    assert not _manifest_complete(synthetic_value, {future_node})
    assert {
        "test_approval_integration.py", "test_deployment.py", "test_end_to_end_live_guard.py",
        "test_t1_release.py",
    } <= {Path(node.split("::", 1)[0]).name for node in value["tests"]}
    assert set(value["artifacts"]) == {
        "scripts/prospecting/gate_manifest_p6.json",
        "scripts/prospecting/schema_p6.sql",
        "scripts/prospecting/p6_contracts.py",
        "scripts/prospecting/deploy_preflight.py",
        "scripts/prospecting/approval/__init__.py",
        "scripts/prospecting/approval/batch.py",
        "scripts/prospecting/operator/__init__.py",
        "scripts/prospecting/operator/__main__.py",
        "scripts/prospecting/operator/cli.py",
        "scripts/prospecting/operator/fill.py",
        "scripts/prospecting/operator/vendors.py",
        "scripts/prospecting/discovery/__init__.py",
        "scripts/prospecting/discovery/snov_domain.py",
        "scripts/prospecting/tests/test_operator.py",
        "scripts/prospecting/tests/test_operator_fill.py",
        "scripts/prospecting/tests/test_snov_domain_lane.py",
        "scripts/prospecting/approval/cli.py",
        "scripts/prospecting/approval/followups_t1.py",
        "scripts/prospecting/approval/release_t1.py",
        "scripts/prospecting/approval/schedule_t1.py",
        "scripts/prospecting/approval/scope.py",
        "scripts/prospecting/approval/verify.py",
        "scripts/prospecting/tests/p6_support.py",
        "scripts/prospecting/tests/test_approval_integration.py",
        "scripts/prospecting/tests/test_deployment.py",
        "scripts/prospecting/tests/test_end_to_end_live_guard.py",
        "scripts/prospecting/tests/test_t1_release.py",
        "orgs/prospecting/cadences-proposed.md",
        "orgs/prospecting/deployment.md",
        "orgs/prospecting/runbook.md",
        "orgs/prospecting/fixtures/t1-synthetic-10.json",
        "orgs/prospecting/fixtures/fill-firms.json",
        "orgs/prospecting/fixtures/vendor/snov/email-search-complete.json",
        "orgs/prospecting/fixtures/vendor/snov/email-search-in-progress.json",
        "orgs/prospecting/fixtures/vendor/snov/email-search-start.json",
        "orgs/prospecting/fixtures/vendor/snov/v2-prospects-16.json",
        "orgs/prospecting/fixtures/vendor/snov/v2-prospects-in-progress.json",
        "orgs/prospecting/fixtures/vendor/snov/v2-prospects-page-1.json",
        "orgs/prospecting/fixtures/vendor/snov/v2-prospects-page-2.json",
        "orgs/prospecting/fixtures/vendor/snov/v2-prospects-start.json",
    }
    assert value["fixtures"] == [
        "fill-firms.json",
        "t1-synthetic-10.json",
        "vendor/snov/email-search-complete.json",
        "vendor/snov/email-search-in-progress.json",
        "vendor/snov/email-search-start.json",
        "vendor/snov/v2-prospects-16.json",
        "vendor/snov/v2-prospects-in-progress.json",
        "vendor/snov/v2-prospects-page-1.json",
        "vendor/snov/v2-prospects-page-2.json",
        "vendor/snov/v2-prospects-start.json",
    ]
    assert value["criteria"] == {
        "minimum_enumerated_tests": len(value["tests"]),
        "failures": 0,
        "skips": 0,
        "xfails": 0,
        "warnings": 0,
        "external_network_calls": 0,
        "child_processes_without_guard": 0,
        "inspector_minimum": 90,
        "t1_sends": 3,
        "t1_rejections": 11,
        "duplicate_sends": 0,
        "breaker_trips": 3,
        "race_runs": 2,
        "refire_noop_runs": 2,
    }
