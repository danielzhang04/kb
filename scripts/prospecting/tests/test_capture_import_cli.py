"""Integration tests for the private capture-import export CLI.

These tests drive the real ``capture_import_cli.main`` against a real private
store built by the genuine P15 seed fixture and real P23 captures produced by
the actual capture lifecycle.  The only substitutions are deterministic clocks
on the real services and two clearly-labelled bounded injections: a recorder
that wraps (and still calls) the real ``copy_owned`` to observe write order,
and a wrapper that fails the *second* real write to exercise cleanup.  No
capture, compile, parse or import result is faked.

Exported requests are re-read with the *existing* ``pipeline_cli`` import
parsers and then handed to the real funding/person import services, so schema
compatibility is checked against the production parser rather than restated.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import scripts.prospecting.capture_import_cli as capture_import_cli
import scripts.prospecting.pipeline_cli as pipeline_cli
from scripts.prospecting.affinity.source_review import _owned_snapshot_usage
from scripts.prospecting.capture_import_cli import (
    EXPORT_NAMESPACE,
    MAX_COMPILE_INPUT_BYTES,
)
from scripts.prospecting.capture_import_compiler import (
    COMPILER_VERSION,
    CaptureImportCompiler,
)
from scripts.prospecting.funding_research_service import FundingResearchService
from scripts.prospecting.person_research_service import PersonResearchService
from scripts.prospecting.pipeline_cli import (
    MAX_JSON_DEPTH,
    _read_funding_import,
    _read_person_import,
)
from scripts.prospecting.research_capture_service import (
    CaptureService,
    CaptureSessionRequest,
)
from scripts.prospecting.source_capture import SourceCaptureError, copy_owned
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_capture_import_compiler import (
    EVENT_TEXT,
    SEARCH_TEXT,
    SKILL_HASH,
    STAMP,
    TEAM_TEXT,
    _Clock,
    _capture,
    _Ids,
    _seed,
    _table_counts,
)


FUNDING_URL = "https://nimbus.test/funding"
TEAM_URL = "https://nimbus.test/team"
QUERY = "Nimbus Systems funding"
PRIVATE_VALUES = (
    "Nimbus", "nimbus.test", QUERY, EVENT_TEXT, SEARCH_TEXT, TEAM_TEXT,
    "Avery", "Head of Operations", "Blake",
)


class _ClockedCompiler(CaptureImportCompiler):
    """The real compiler bound to one deterministic capture clock."""

    def __init__(self, connection, *, now=None) -> None:
        super().__init__(connection, now=now or _Clock())


class _RecordingWriter:
    """Observe write order while still performing the real owned writes."""

    def __init__(self) -> None:
        self.prefixes: list[str] = []

    def __call__(self, root, *, namespace, snapshot_id, contents, maximum, created):
        self.prefixes.append(snapshot_id[:4])
        return copy_owned(
            root, namespace=namespace, snapshot_id=snapshot_id, contents=contents,
            maximum=maximum, created=created,
        )


class _SecondWriteFails:
    """Perform the first real write, then fail the second one."""

    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, root, *, namespace, snapshot_id, contents, maximum, created):
        self.calls += 1
        if self.calls >= 2:
            raise SourceCaptureError("source_changed")
        return copy_owned(
            root, namespace=namespace, snapshot_id=snapshot_id, contents=contents,
            maximum=maximum, created=created,
        )


def _prepare(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "local" / "kb-prospecting"
    (root / "snapshots").mkdir(parents=True)
    store = root / "store.sqlite"
    connection = open_store(store)
    started = _seed(connection)
    ids = _Ids()
    captures = CaptureService(connection, now=_Clock())
    session = captures.start_session(CaptureSessionRequest(
        ids.next(), started.run_id, started.intake_hash, SKILL_HASH,
    ))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setattr(capture_import_cli, "CaptureImportCompiler", _ClockedCompiler)
    return root, store, started, ids, captures, session, connection


def _rebind(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Restore the environment bindings after a ``monkeypatch.undo``."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setattr(capture_import_cli, "CaptureImportCompiler", _ClockedCompiler)


def _synthetic_checkout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Point ``_approved_store``'s repo-root discovery at a disposable, real
    checkout under ``tmp_path``, so an ambient ``_private`` root can never
    make ``tmp_path / "outside.sqlite"`` spuriously approved."""
    synthetic_repo = tmp_path / "synthetic-checkout"
    (synthetic_repo / "scripts" / "prospecting").mkdir(parents=True)
    (synthetic_repo / ".git").mkdir()
    (synthetic_repo / "_private").mkdir()
    monkeypatch.setattr(
        pipeline_cli, "__file__",
        str(synthetic_repo / "scripts" / "prospecting" / "pipeline_cli.py"),
    )


def _forbid_open_store(*_args, **_kwargs):
    raise AssertionError("open_store must not be called for a refused store")


def _write(snapshots: Path, value: object, name: str) -> Path:
    path = snapshots / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def _write_raw(snapshots: Path, raw: bytes, name: str) -> Path:
    path = snapshots / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return path


def _exports(root: Path) -> list[str]:
    folder = root / "snapshots" / EXPORT_NAMESPACE
    return sorted(item.name for item in folder.iterdir()) if folder.exists() else []


def _assert_private_absent(text: str) -> None:
    for value in PRIVATE_VALUES:
        assert value not in text


def _cli(store: Path, option: str, value: object, capsys):
    code = capture_import_cli.main(["--store", str(store), option, str(value)])
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def _ok(store: Path, option: str, value: object, capsys) -> dict:
    code, out, err = _cli(store, option, value, capsys)
    assert (code, err) == (0, "")
    _assert_private_absent(out)
    assert str(value) not in out
    return json.loads(out)


def _refused(store: Path, option: str, value: object, capsys) -> str:
    code, out, err = _cli(store, option, value, capsys)
    assert (code, out) == (2, "")
    assert err.startswith("capture_import_cli_error:") and err.count("\n") == 1
    assert "Traceback" not in err
    _assert_private_absent(err)
    assert str(value) not in err
    return err.removeprefix("capture_import_cli_error:").strip()


def _capture_json(ref) -> dict:
    return {
        "task_id": ref.task_id,
        "expected_receipt_id": ref.expected_receipt_id,
        "expected_content_sha256": ref.expected_content_sha256,
    }


def _funding_pair(captures, session, ids, root: Path, suffix: str = "one"):
    event_ref = _capture(
        captures, session, ids, root, name=f"event-{suffix}", text=EVENT_TEXT,
        url=FUNDING_URL,
    )
    search_ref = _capture(
        captures, session, ids, root, name=f"search-{suffix}", text=SEARCH_TEXT,
        query=QUERY,
    )
    return event_ref, search_ref


def _funding_input(started, session, ids, event_ref, search_ref, *, request_id=None) -> dict:
    return {
        "request_id": request_id if request_id is not None else ids.next(),
        "session_id": session.session_id,
        "run_id": started.run_id,
        "expected_intake_hash": started.intake_hash,
        "predecessor_batch_id": None,
        "predecessor_hash": None,
        "companies": [{
            "name": "Nimbus Systems",
            "website_url": "https://nimbus.test/",
            "location": "United States",
            "sector": "software",
            "pages": [
                {
                    "capture": _capture_json(event_ref),
                    "source_kind": "issuer",
                    "coverage": None,
                },
                {
                    "capture": _capture_json(search_ref),
                    "source_kind": "search_coverage",
                    "coverage": {"status": "found", "result_count": 1, "result_cap": 20},
                },
            ],
            "events": [{
                "page_ordinal": 0,
                "stage": "series_b",
                "announced_at": "2025-05-01",
                "excerpt": {"start": 0, "end": len(EVENT_TEXT)},
            }],
        }],
    }


def _span_json(value: str) -> dict:
    start = TEAM_TEXT.index(value)
    return {"start": start, "end": start + len(value)}


def _people_input(started, session, ids, team_ref, funding, selected) -> dict:
    return {
        "request_id": ids.next(),
        "session_id": session.session_id,
        "run_id": started.run_id,
        "expected_intake_hash": started.intake_hash,
        "funding_batch_id": funding.batch_id,
        "funding_batch_hash": funding.batch_hash,
        "predecessor_batch_id": None,
        "predecessor_hash": None,
        "research_result_ids": [selected.result_id],
        "people": [
            {
                "capture": _capture_json(team_ref),
                "funding_result_id": selected.result_id,
                "company_id": selected.company_id,
                "first_name": "Avery",
                "full_name": _span_json("Avery Alpha"),
                "title": _span_json("Head of Operations"),
                "profile_url": "https://profile.test/avery-alpha",
            },
            {
                "capture": _capture_json(team_ref),
                "funding_result_id": selected.result_id,
                "company_id": selected.company_id,
                "first_name": "Blake",
                "full_name": _span_json("Blake Beta"),
                "title": _span_json("VP Strategy"),
                "profile_url": None,
            },
        ],
    }


def _import_funding(store: Path, exported: Path):
    connection = open_store(store)
    try:
        parsed = _read_funding_import(store, exported)
        service = FundingResearchService(connection, now=lambda: STAMP)
        result = service.import_and_classify(parsed)
        selected = service.get_projection(result.run_id).companies[0]
        return parsed, result, selected
    finally:
        connection.close()


def _import_people(store: Path, exported: Path):
    connection = open_store(store)
    try:
        parsed = _read_person_import(store, exported)
        return PersonResearchService(connection, now=lambda: STAMP).import_current_people(
            parsed,
        )
    finally:
        connection.close()


def _operator_usage(store: Path) -> tuple[int, int]:
    """The exact P18 operator-snapshot usage the person importer enforces."""
    connection = open_store(store)
    try:
        return _owned_snapshot_usage(connection, store.parent / "snapshots")
    finally:
        connection.close()


def test_funding_export_round_trips_through_the_pipeline_import_parser(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    before = _table_counts(connection)
    connection.close()

    source = _write(
        root / "snapshots",
        _funding_input(started, session, ids, event_ref, search_ref),
        "compile/funding.json",
    )
    output = _ok(store, "--compile-funding", source, capsys)
    assert set(output) == {
        "status", "kind", "exported", "request_ref", "request_sha256",
        "manifest_ref", "manifest_sha256", "counts",
    }
    assert (output["status"], output["kind"], output["exported"]) == (
        "exported", "funding", True,
    )
    assert output["counts"] == {"candidates": 1, "pages": 2, "captures": 2}
    assert output["request_ref"].startswith(f"{EXPORT_NAMESPACE}/req_")
    assert output["manifest_ref"].startswith(f"{EXPORT_NAMESPACE}/man_")

    exported = root / "snapshots" / output["request_ref"]
    payload = json.loads(exported.read_text(encoding="utf-8"))
    assert set(payload) == {
        "request_id", "run_id", "expected_intake_hash", "predecessor_batch_id",
        "predecessor_hash", "candidates",
    }
    pages = payload["candidates"][0]["pages"]
    assert "coverage" not in pages[0]
    assert pages[0]["expected_content_sha256"] == event_ref.expected_content_sha256
    assert pages[1]["coverage"]["query"] == QUERY
    assert pages[1]["expected_content_sha256"] == search_ref.expected_content_sha256

    # The production import parser must accept the exported bytes unchanged.
    parsed, result, selected = _import_funding(store, exported)
    assert parsed.request_id == payload["request_id"]
    assert result.counts["provisional_matches"] == 1
    assert selected.rule_outcome == "provisional_match"

    # Compiling wrote no row of its own; only the later import did.
    probe = open_store(store)
    try:
        after = _table_counts(probe)
    finally:
        probe.close()
    assert after["prospecting_capture_receipt"] == before["prospecting_capture_receipt"]
    assert after["prospecting_capture_attempt"] == before["prospecting_capture_attempt"]


def test_compile_writes_no_row_and_the_manifest_names_every_occurrence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    before = _table_counts(connection)
    rows = {
        ref.task_id: connection.execute(
            """SELECT s.body_ref,s.expires_at,s.snapshot_id FROM source_snapshot AS s
                 JOIN prospecting_capture_receipt AS r ON r.snapshot_id=s.snapshot_id
                WHERE r.task_id=?""", (ref.task_id,),
        ).fetchone()
        for ref in (event_ref, search_ref)
    }
    connection.close()

    source = _write(
        root / "snapshots",
        _funding_input(started, session, ids, event_ref, search_ref),
        "compile/funding.json",
    )
    output = _ok(store, "--compile-funding", source, capsys)

    manifest_path = root / "snapshots" / output["manifest_ref"]
    request_path = root / "snapshots" / output["request_ref"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["kind"] == "capture-import-manifest"
    assert manifest["export_kind"] == "funding"
    assert manifest["compiler_version"] == COMPILER_VERSION
    assert manifest["session_id"] == session.session_id
    assert manifest["run_id"] == started.run_id
    assert manifest["expected_intake_hash"] == started.intake_hash
    # The manifest names the exact request file, by ref, digest and byte count.
    assert manifest["request_ref"] == output["request_ref"]
    assert manifest["request_sha256"] == output["request_sha256"]
    assert manifest["request_byte_count"] == request_path.stat().st_size
    assert manifest["counts"] == output["counts"]

    entries = manifest["captures"]
    assert [
        (entry["candidate_ordinal"], entry["page_ordinal"]) for entry in entries
    ] == [(0, 0), (0, 1)]
    for entry, ref in zip(entries, (event_ref, search_ref)):
        row = rows[ref.task_id]
        assert entry["task_id"] == ref.task_id
        assert entry["receipt_id"] == ref.expected_receipt_id
        assert entry["content_sha256"] == ref.expected_content_sha256
        assert entry["body_ref"] == str(row[0])
        assert entry["expires_at"] == str(row[1])
        assert entry["snapshot_id"] == str(row[2])
    # No private query, URL or captured text travels in the manifest.
    rendered = json.dumps(manifest)
    for value in (QUERY, FUNDING_URL, EVENT_TEXT, SEARCH_TEXT):
        assert value not in rendered

    probe = open_store(store)
    try:
        assert _table_counts(probe) == before
    finally:
        probe.close()


def test_the_request_file_is_written_before_the_manifest_completion_record(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    """Ordering is observed from the real write calls, not from mtimes.

    ``mtime`` comparison is meaningless when both files land inside one
    filesystem timestamp tick, so this records the order in which the real
    ``copy_owned`` is actually invoked; the recorder still performs both
    genuine writes.
    """
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    connection.close()
    source = _write(
        root / "snapshots",
        _funding_input(started, session, ids, event_ref, search_ref),
        "compile/funding.json",
    )
    recorder = _RecordingWriter()
    monkeypatch.setattr(capture_import_cli, "copy_owned", recorder)

    output = _ok(store, "--compile-funding", source, capsys)
    assert recorder.prefixes == ["req_", "man_"]
    assert sorted(_exports(root)) == sorted(
        Path(output[name]).name for name in ("request_ref", "manifest_ref")
    )


def test_people_export_keeps_one_shared_capture_at_two_ordinals_and_imports(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    team_ref = _capture(
        captures, session, ids, root, name="team", text=TEAM_TEXT, url=TEAM_URL,
    )
    connection.close()

    funding_source = _write(
        root / "snapshots",
        _funding_input(started, session, ids, event_ref, search_ref),
        "compile/funding.json",
    )
    funding_output = _ok(store, "--compile-funding", funding_source, capsys)
    _parsed, funding, selected = _import_funding(
        store, root / "snapshots" / funding_output["request_ref"],
    )

    people_source = _write(
        root / "snapshots",
        _people_input(started, session, ids, team_ref, funding, selected),
        "compile/people.json",
    )
    output = _ok(store, "--compile-people", people_source, capsys)
    assert output["kind"] == "people"
    assert output["counts"] == {"candidates": 2, "pages": 2, "captures": 2}

    exported = root / "snapshots" / output["request_ref"]
    payload = json.loads(exported.read_text(encoding="utf-8"))
    assert set(payload) == {
        "request_id", "run_id", "expected_intake_hash", "funding_batch_id",
        "funding_batch_hash", "predecessor_batch_id", "predecessor_hash",
        "research_result_ids", "candidates",
    }
    first, second = payload["candidates"]
    assert (first["full_name"], first["title"]) == ("Avery Alpha", "Head of Operations")
    assert (second["full_name"], second["title"]) == ("Blake Beta", "VP Strategy")
    assert first["body_ref"] == second["body_ref"]
    assert first["expected_content_sha256"] == team_ref.expected_content_sha256

    manifest = json.loads(
        (root / "snapshots" / output["manifest_ref"]).read_text(encoding="utf-8"),
    )
    assert manifest["export_kind"] == "people"
    entries = manifest["captures"]
    # One shared capture, two occurrences: never deduplicated, never re-joined.
    assert [
        (entry["candidate_ordinal"], entry["page_ordinal"]) for entry in entries
    ] == [(0, 0), (1, 0)]
    assert entries[0]["task_id"] == entries[1]["task_id"] == team_ref.task_id
    assert entries[0]["receipt_id"] == entries[1]["receipt_id"]
    assert entries[0]["snapshot_id"] == entries[1]["snapshot_id"]
    assert entries[0]["body_ref"] == entries[1]["body_ref"]

    assert _import_people(store, exported).counts["imported"] == 2


def test_repeated_exports_never_consume_the_operator_snapshot_quota(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    """Exports are rowless, so the row-driven P18 cap cannot be starved.

    ``_owned_snapshot_usage`` counts and measures only ``source_snapshot`` rows
    whose ``allowlist_version`` is ``operator-local-v1``; it does not walk the
    snapshots tree.  Repeated exports write files but no rows, so the usage the
    person importer enforces is unchanged, and a real P18 import still runs
    afterwards.  The artefacts are retained, not swept.
    """
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    team_ref = _capture(
        captures, session, ids, root, name="team-quota", text=TEAM_TEXT, url=TEAM_URL,
    )
    connection.close()

    funding_source = _write(
        root / "snapshots",
        _funding_input(started, session, ids, event_ref, search_ref),
        "compile/funding.json",
    )
    funding_output = _ok(store, "--compile-funding", funding_source, capsys)
    _parsed, funding, selected = _import_funding(
        store, root / "snapshots" / funding_output["request_ref"],
    )

    before = _operator_usage(store)
    for _replay in range(3):
        replayed = _ok(store, "--compile-funding", funding_source, capsys)
        assert replayed["exported"] is True
    after = _operator_usage(store)
    assert after == before
    # Two files per invocation, all retained: four exports, eight artefacts.
    assert len(_exports(root)) == 8

    people_source = _write(
        root / "snapshots",
        _people_input(started, session, ids, team_ref, funding, selected),
        "compile/people.json",
    )
    people_output = _ok(store, "--compile-people", people_source, capsys)
    result = _import_people(
        store, root / "snapshots" / people_output["request_ref"],
    )
    assert result.counts["imported"] == 2
    # The import moved the cap; the exports before it did not.
    assert _operator_usage(store)[0] > before[0]


def test_replaying_one_input_writes_fresh_files_and_never_mutates_earlier_ones(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    connection.close()
    source = _write(
        root / "snapshots",
        _funding_input(started, session, ids, event_ref, search_ref),
        "compile/funding.json",
    )

    first = _ok(store, "--compile-funding", source, capsys)
    first_bytes = (root / "snapshots" / first["request_ref"]).read_bytes()
    second = _ok(store, "--compile-funding", source, capsys)

    # Artefact identity is fresh per export; request identity is stable.
    assert first["request_ref"] != second["request_ref"]
    assert first["manifest_ref"] != second["manifest_ref"]
    assert first["request_sha256"] == second["request_sha256"]
    assert (root / "snapshots" / first["request_ref"]).read_bytes() == first_bytes
    assert (root / "snapshots" / second["request_ref"]).read_bytes() == first_bytes
    assert len(_exports(root)) == 4

    first_request = json.loads(first_bytes.decode("utf-8"))
    second_request = json.loads(
        (root / "snapshots" / second["request_ref"]).read_text(encoding="utf-8"),
    )
    assert first_request["request_id"] == second_request["request_id"]


def test_manifest_write_failure_removes_the_request_file_and_claims_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    """A post-request write failure must leave no half-claimed pair behind.

    The failure is injected only in the *second* call: the first call performs
    the real owned write of the request file, so the identity-checked
    ``cleanup_owned`` path is genuinely exercised against a file that really
    exists on disk.
    """
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    connection.close()
    source = _write(
        root / "snapshots",
        _funding_input(started, session, ids, event_ref, search_ref),
        "compile/funding.json",
    )
    failing = _SecondWriteFails()
    monkeypatch.setattr(capture_import_cli, "copy_owned", failing)

    assert _refused(store, "--compile-funding", source, capsys) == "export_failed"
    assert failing.calls == 2
    assert _exports(root) == []

    monkeypatch.undo()
    _rebind(tmp_path, monkeypatch)
    recovered = _ok(store, "--compile-funding", source, capsys)
    assert sorted(_exports(root)) == sorted(
        Path(recovered[name]).name for name in ("request_ref", "manifest_ref")
    )


def test_export_size_bounds_are_checked_before_either_file_is_created(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    """Both caps are exercised at their exact boundary, and refuse atomically.

    One real export measures the exact serialized sizes (the manifest length is
    stable because the request artefact name is a fixed-width opaque token).
    Each cap is then set to exactly that size, which must still export, and to
    one byte below it, which must refuse with ``export_too_large`` having
    written neither file.
    """
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    connection.close()
    source = _write(
        root / "snapshots",
        _funding_input(started, session, ids, event_ref, search_ref),
        "compile/funding.json",
    )

    measured = _ok(store, "--compile-funding", source, capsys)
    request_bytes = (root / "snapshots" / measured["request_ref"]).stat().st_size
    manifest_bytes = (root / "snapshots" / measured["manifest_ref"]).stat().st_size
    baseline = len(_exports(root))
    assert baseline == 2

    monkeypatch.setattr(capture_import_cli, "MAX_FUNDING_REQUEST_BYTES", request_bytes)
    at_request_limit = _ok(store, "--compile-funding", source, capsys)
    assert at_request_limit["request_sha256"] == measured["request_sha256"]
    assert len(_exports(root)) == baseline + 2

    monkeypatch.setattr(
        capture_import_cli, "MAX_FUNDING_REQUEST_BYTES", request_bytes - 1,
    )
    assert _refused(store, "--compile-funding", source, capsys) == "export_too_large"
    assert len(_exports(root)) == baseline + 2

    monkeypatch.undo()
    _rebind(tmp_path, monkeypatch)
    monkeypatch.setattr(capture_import_cli, "MAX_MANIFEST_BYTES", manifest_bytes)
    at_manifest_limit = _ok(store, "--compile-funding", source, capsys)
    assert at_manifest_limit["request_sha256"] == measured["request_sha256"]
    assert len(_exports(root)) == baseline + 4

    monkeypatch.setattr(capture_import_cli, "MAX_MANIFEST_BYTES", manifest_bytes - 1)
    assert _refused(store, "--compile-funding", source, capsys) == "export_too_large"
    # The request file is never created for an over-large manifest.
    assert len(_exports(root)) == baseline + 4


def test_the_request_cap_is_the_downstream_import_parser_bound(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """This CLI never emits a request larger than the importer can read."""
    from scripts.prospecting import pipeline_cli

    assert (
        capture_import_cli.MAX_FUNDING_REQUEST_BYTES
        == pipeline_cli.MAX_FUNDING_IMPORT_BYTES
    )
    assert (
        capture_import_cli.MAX_PERSON_REQUEST_BYTES
        == pipeline_cli.MAX_PERSON_IMPORT_BYTES
    )
    # The manifest bound is derived from the occurrences it can ever hold.
    assert capture_import_cli.MAX_MANIFEST_BYTES >= (
        capture_import_cli.MAX_MANIFEST_OCCURRENCES
        * capture_import_cli.MAX_MANIFEST_ENTRY_BYTES
    )


@pytest.mark.parametrize(
    "request_id",
    (
        "not-a-uuid",
        "",
        "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        "{aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa}",
        "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa",
    ),
)
def test_non_canonical_request_ids_are_refused_before_anything_is_exported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
    request_id: str,
) -> None:
    """The importers require a canonical UUID, so this CLI requires one too."""
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    connection.close()
    source = _write(
        root / "snapshots",
        _funding_input(
            started, session, ids, event_ref, search_ref, request_id=request_id,
        ),
        "compile/bad-request-id.json",
    )
    assert _refused(
        store, "--compile-funding", source, capsys,
    ) == "compile_input_schema_invalid"
    assert _exports(root) == []


@pytest.mark.parametrize(
    ("name", "raw", "code"),
    (
        (
            "duplicate",
            b'{"request_id":"a","request_id":"b"}',
            "compile_input_duplicate_key",
        ),
        (
            "malformed",
            b'{"request_id":"a"',
            "compile_input_json_invalid",
        ),
        (
            "deep",
            b"[" * (MAX_JSON_DEPTH + 1) + b'"x"' + b"]" * (MAX_JSON_DEPTH + 1),
            "compile_input_json_too_deep",
        ),
        (
            "oversized",
            b'{"request_id":"' + b"x" * MAX_COMPILE_INPUT_BYTES,
            "compile_input_too_large",
        ),
    ),
    # Name the cases explicitly: without ids pytest derives each parameter id
    # from the value itself, so the oversized case would put a 256 KiB literal
    # into the node id (and into every report line and the tmp_path name).
    ids=("duplicate", "malformed", "deep", "oversized"),
)
def test_bounded_strict_json_refusals_are_fixed_and_export_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
    name: str, raw: bytes, code: str,
) -> None:
    root, store, _started, _ids, _captures, _session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    connection.close()
    source = _write_raw(root / "snapshots", raw, f"compile/{name}.json")
    assert _refused(store, "--compile-funding", source, capsys) == code
    assert _exports(root) == []


def test_unknown_fields_and_boolean_spans_are_refused_by_shape(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    connection.close()
    snapshots = root / "snapshots"

    extra = _funding_input(started, session, ids, event_ref, search_ref)
    extra["note"] = "unexpected"
    assert _refused(
        store, "--compile-funding", _write(snapshots, extra, "compile/extra.json"), capsys,
    ) == "compile_input_schema_invalid"

    nested_extra = _funding_input(started, session, ids, event_ref, search_ref)
    nested_extra["companies"][0]["pages"][0]["capture"]["source_url"] = FUNDING_URL
    assert _refused(
        store, "--compile-funding",
        _write(snapshots, nested_extra, "compile/nested.json"), capsys,
    ) == "compile_input_schema_invalid"

    boolean_span = _funding_input(started, session, ids, event_ref, search_ref)
    boolean_span["companies"][0]["events"][0]["excerpt"] = {"start": True, "end": 4}
    assert _refused(
        store, "--compile-funding",
        _write(snapshots, boolean_span, "compile/bool-span.json"), capsys,
    ) == "compile_input_schema_invalid"

    text_span = _funding_input(started, session, ids, event_ref, search_ref)
    text_span["companies"][0]["events"][0]["excerpt"] = {"start": "0", "end": 4}
    assert _refused(
        store, "--compile-funding",
        _write(snapshots, text_span, "compile/text-span.json"), capsys,
    ) == "compile_input_schema_invalid"
    assert _exports(root) == []


def test_inputs_outside_the_store_or_behind_links_are_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    connection.close()
    payload = _funding_input(started, session, ids, event_ref, search_ref)

    outside = _write(tmp_path, payload, "outside.json")
    assert _refused(
        store, "--compile-funding", outside, capsys,
    ) == "compile_input_snapshot_required"

    target = _write(root / "snapshots", payload, "compile/funding.json")
    link = root / "snapshots" / "compile" / "link.json"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("file symlinks unavailable")
    assert _refused(store, "--compile-funding", link, capsys) == "compile_input_invalid"

    hard = root / "snapshots" / "compile" / "hard.json"
    try:
        os.link(target, hard)
    except OSError:
        pytest.skip("hardlinks unavailable")
    assert _refused(store, "--compile-funding", hard, capsys) == "compile_input_invalid"
    assert _exports(root) == []


def test_tampered_capture_body_refuses_at_compile_time_without_exporting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    body_ref = connection.execute(
        """SELECT s.body_ref FROM source_snapshot AS s
             JOIN prospecting_capture_receipt AS r ON r.snapshot_id=s.snapshot_id
            WHERE r.task_id=?""", (event_ref.task_id,),
    ).fetchone()[0]
    connection.close()
    (root / "snapshots" / str(body_ref)).write_text("tampered", encoding="utf-8")

    source = _write(
        root / "snapshots",
        _funding_input(started, session, ids, event_ref, search_ref),
        "compile/funding.json",
    )
    assert _refused(store, "--compile-funding", source, capsys) == "source_changed"
    assert _exports(root) == []


def test_unresolvable_capture_reference_keeps_one_fixed_code(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    connection.close()
    payload = _funding_input(started, session, ids, event_ref, search_ref)
    payload["companies"][0]["pages"][0]["capture"]["expected_receipt_id"] = (
        "pcr_" + "0" * 32
    )
    source = _write(root / "snapshots", payload, "compile/wrong-receipt.json")
    assert _refused(store, "--compile-funding", source, capsys) == "receipt_mismatch"
    assert _exports(root) == []


def test_store_selection_is_validated_before_the_store_is_opened(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    event_ref, search_ref = _funding_pair(captures, session, ids, root)
    connection.close()
    source = _write(
        root / "snapshots",
        _funding_input(started, session, ids, event_ref, search_ref),
        "compile/funding.json",
    )

    missing = store.parent / "missing.sqlite"
    assert _refused(missing, "--compile-funding", source, capsys) == "store_invalid"
    assert not missing.exists()

    wrong_suffix = store.parent / "store.db"
    wrong_suffix.write_bytes(b"")
    assert _refused(
        wrong_suffix, "--compile-funding", source, capsys,
    ) == "store_invalid"

    _synthetic_checkout(tmp_path, monkeypatch)
    outside = tmp_path / "outside.sqlite"
    outside.write_bytes(b"")
    with monkeypatch.context() as isolated:
        isolated.setattr(capture_import_cli, "open_store", _forbid_open_store)
        assert _refused(
            outside, "--compile-funding", source, capsys,
        ) == "store_private_root_required"
    assert outside.read_bytes() == b""
    assert _exports(root) == []

    assert _ok(store, "--compile-funding", source, capsys)["exported"] is True

def test_invalid_arguments_never_echo_private_values(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, _started, _ids, _captures, _session, connection = _prepare(
        tmp_path, monkeypatch,
    )
    connection.close()
    for argv in (
        ["--store", str(store), f"--unknown={QUERY}"],
        ["--store", str(store), "--compile-funding", "a", "--compile-people", "b"],
        ["--store", str(store)],
    ):
        code = capture_import_cli.main(argv)
        captured = capsys.readouterr()
        assert (code, captured.out) == (2, "")
        assert captured.err == "capture_import_cli_error:invalid_arguments\n"
        _assert_private_absent(captured.err)
    assert _exports(root) == []
