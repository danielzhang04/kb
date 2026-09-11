"""Recovery verification tests using real P23 captures and exported P17/P18 files."""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import sqlite3

import pytest

import scripts.prospecting.capture_import_cli as capture_import_cli
from scripts.prospecting.capture_export_verifier import (
    CaptureExportVerificationError,
    CaptureExportVerifier,
)
from scripts.prospecting.capture_import_compiler import COMPILER_VERSION
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_capture_import_cli import (
    _funding_input,
    _funding_pair,
    _import_funding,
    _ok,
    _people_input,
    _prepare,
    _refused,
    _write,
)
from scripts.prospecting.tests.test_capture_import_compiler import (
    _Clock, _capture, _table_counts, TEAM_TEXT,
)


STAMP = "2026-09-10T12:00:00Z"


def _funding_export(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys):
    root, store, started, ids, captures, session, connection = _prepare(tmp_path, monkeypatch)
    event, search = _funding_pair(captures, session, ids, root)
    source = _write(
        root / "snapshots", _funding_input(started, session, ids, event, search), "verify/funding.json",
    )
    exported = _ok(store, "--compile-funding", source, capsys)
    return root, store, started, ids, captures, session, connection, exported


def _rewrite(path: Path, value: object) -> None:
    path.write_bytes(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def _rehash_manifest(manifest_path: Path, request_path: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    contents = request_path.read_bytes()
    manifest["request_sha256"] = sha256(contents).hexdigest()
    manifest["request_byte_count"] = len(contents)
    _rewrite(manifest_path, manifest)


def _verify(connection, manifest_ref: str, *, now: str = STAMP):
    return CaptureExportVerifier(connection, now=_Clock(now)).verify(manifest_ref)


def test_verifies_real_funding_and_people_exports_without_row_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    root, store, started, ids, captures, session, connection, funding_export = _funding_export(
        tmp_path, monkeypatch, capsys,
    )
    before_funding = _table_counts(connection)
    funding = _verify(connection, funding_export["manifest_ref"])
    request = json.loads((root / "snapshots" / funding_export["request_ref"]).read_text("utf-8"))
    assert (funding.status, funding.kind, funding.request_id, funding.capture_count) == (
        "verified", "funding", request["request_id"], 2,
    )
    assert funding.request_sha256 == funding_export["request_sha256"]
    assert _table_counts(connection) == before_funding

    _parsed, imported, selected = _import_funding(
        store, root / "snapshots" / funding_export["request_ref"],
    )
    team = _capture(captures, session, ids, root, name="verify-team", text=TEAM_TEXT,
                    url="https://nimbus.test/team")
    people_source = _write(
        root / "snapshots", _people_input(started, session, ids, team, imported, selected),
        "verify/people.json",
    )
    people_export = _ok(store, "--compile-people", people_source, capsys)
    before_people = _table_counts(connection)
    people = _verify(connection, people_export["manifest_ref"])
    assert (people.status, people.kind, people.capture_count) == ("verified", "people", 2)
    assert people.request_sha256 == people_export["request_sha256"]
    assert _table_counts(connection) == before_people
    connection.close()


def test_refuses_changed_request_hash_identity_and_page_binding(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    root, _store, _started, _ids, _captures, _session, connection, exported = _funding_export(
        tmp_path, monkeypatch, capsys,
    )
    manifest_path = root / "snapshots" / exported["manifest_ref"]
    request_path = root / "snapshots" / exported["request_ref"]

    request = json.loads(request_path.read_text(encoding="utf-8"))
    request["request_id"] = "11111111-1111-4111-8111-111111111111"
    _rewrite(request_path, request)
    with pytest.raises(CaptureExportVerificationError, match="^request_hash_mismatch$"):
        _verify(connection, exported["manifest_ref"])

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    bytes_now = request_path.read_bytes()
    manifest["request_sha256"] = sha256(bytes_now).hexdigest()
    manifest["request_byte_count"] = len(bytes_now)
    _rewrite(manifest_path, manifest)
    with pytest.raises(CaptureExportVerificationError, match="^request_identity_mismatch$"):
        _verify(connection, exported["manifest_ref"])

    request["request_id"] = manifest["request_id"]
    request["candidates"][0]["pages"][0]["body_ref"] = "capture-imports/req_" + "0" * 32 + ".body"
    _rewrite(request_path, request)
    bytes_now = request_path.read_bytes()
    manifest["request_sha256"] = sha256(bytes_now).hexdigest()
    manifest["request_byte_count"] = len(bytes_now)
    _rewrite(manifest_path, manifest)
    with pytest.raises(CaptureExportVerificationError, match="^capture_mismatch$"):
        _verify(connection, exported["manifest_ref"])
    connection.close()


def test_refuses_corrupt_missing_cross_store_linked_expired_and_stale_pairs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    root, _store, _started, _ids, _captures, _session, connection, exported = _funding_export(
        tmp_path, monkeypatch, capsys,
    )
    manifest_path = root / "snapshots" / exported["manifest_ref"]
    manifest_path.write_bytes(b'{"kind":"capture-import-manifest"')
    with pytest.raises(CaptureExportVerificationError, match="^manifest_json_invalid$"):
        _verify(connection, exported["manifest_ref"])
    connection.close()

    # A second store has no authority over an artefact in the first store's root.
    second = open_store(tmp_path / "other" / "store.sqlite")
    try:
        with pytest.raises(CaptureExportVerificationError, match="^manifest_unavailable$"):
            _verify(second, exported["manifest_ref"])
    finally:
        second.close()

    # Restore a fresh valid pair for the file-identity and current-time checks.
    root, _store, _started, _ids, _captures, _session, connection, exported = _funding_export(
        tmp_path / "fresh", monkeypatch, capsys,
    )
    manifest_path = root / "snapshots" / exported["manifest_ref"]
    target = manifest_path.with_name("manifest-target.body")
    manifest_path.rename(target)
    try:
        manifest_path.symlink_to(target)
    except OSError:
        pytest.skip("file symlinks unavailable")
    with pytest.raises(CaptureExportVerificationError, match="^manifest_unavailable$"):
        _verify(connection, exported["manifest_ref"])
    manifest_path.unlink()
    target.rename(manifest_path)
    with pytest.raises(CaptureExportVerificationError, match="^capture_expired$"):
        _verify(connection, exported["manifest_ref"], now="2026-11-11T12:00:00Z")
    connection.execute("UPDATE campaign SET policy_hash=?", ("b" * 64,))
    connection.commit()
    with pytest.raises(CaptureExportVerificationError, match="^store_state_invalid$"):
        _verify(connection, exported["manifest_ref"])
    connection.close()


def test_refuses_duplicate_missing_or_extra_capture_occurrences(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    root, _store, _started, _ids, _captures, _session, connection, exported = _funding_export(
        tmp_path, monkeypatch, capsys,
    )
    manifest_path = root / "snapshots" / exported["manifest_ref"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["captures"][1]["page_ordinal"] = 0
    _rewrite(manifest_path, manifest)
    with pytest.raises(CaptureExportVerificationError, match="^capture_occurrences_mismatch$"):
        _verify(connection, exported["manifest_ref"])
    manifest["captures"] = manifest["captures"][:1]
    manifest["counts"]["captures"] = 1
    _rewrite(manifest_path, manifest)
    with pytest.raises(CaptureExportVerificationError, match="^capture_occurrences_mismatch$"):
        _verify(connection, exported["manifest_ref"])
    manifest["captures"].append(dict(manifest["captures"][0], candidate_ordinal=9, page_ordinal=9))
    manifest["counts"]["captures"] = 2
    _rewrite(manifest_path, manifest)
    with pytest.raises(CaptureExportVerificationError, match="^capture_occurrences_mismatch$"):
        _verify(connection, exported["manifest_ref"])
    connection.close()


def test_verify_export_cli_reports_only_metadata_for_real_funding_and_people(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    root, store, started, ids, captures, session, connection, funding_export = _funding_export(
        tmp_path, monkeypatch, capsys,
    )
    before_funding = _table_counts(connection)
    def forbidden_open_store(*_args, **_kwargs):
        raise AssertionError("verify-export must not call open_store")

    with monkeypatch.context() as isolated:
        isolated.setattr(capture_import_cli, "open_store", forbidden_open_store)
        funding = _ok(
            store, "--verify-export", root / "snapshots" / funding_export["manifest_ref"], capsys,
        )
    request = json.loads((root / "snapshots" / funding_export["request_ref"]).read_text("utf-8"))
    assert funding == {
        "status": "verified", "kind": "funding", "request_id": request["request_id"],
        "capture_count": 2, "request_sha256": funding_export["request_sha256"],
    }
    assert _table_counts(connection) == before_funding
    assert connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"

    _parsed, imported, selected = _import_funding(
        store, root / "snapshots" / funding_export["request_ref"],
    )
    team = _capture(captures, session, ids, root, name="cli-team", text=TEAM_TEXT,
                    url="https://nimbus.test/team")
    people_source = _write(
        root / "snapshots", _people_input(started, session, ids, team, imported, selected),
        "verify/cli-people.json",
    )
    people_export = _ok(store, "--compile-people", people_source, capsys)
    before_people = _table_counts(connection)
    people = _ok(
        store, "--verify-export", root / "snapshots" / people_export["manifest_ref"], capsys,
    )
    assert people == {
        "status": "verified", "kind": "people",
        "request_id": json.loads(
            (root / "snapshots" / people_export["request_ref"]).read_text("utf-8"),
        )["request_id"],
        "capture_count": 2, "request_sha256": people_export["request_sha256"],
    }
    assert _table_counts(connection) == before_people
    connection.close()


def test_verify_export_cli_refuses_bad_private_paths_and_mutated_pairs_without_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    root, store, _started, _ids, _captures, _session, connection, exported = _funding_export(
        tmp_path, monkeypatch, capsys,
    )
    manifest = root / "snapshots" / exported["manifest_ref"]
    request = root / "snapshots" / exported["request_ref"]
    before_rows = _table_counts(connection)
    before_files = sorted(item.name for item in (root / "snapshots" / "capture-imports").iterdir())

    request.write_bytes(b"{}")
    assert _refused(store, "--verify-export", manifest, capsys) == "request_hash_mismatch"
    manifest.write_bytes(b'{"kind":"capture-import-manifest"')
    assert _refused(store, "--verify-export", manifest, capsys) == "manifest_json_invalid"
    outside = _write(tmp_path, {"manifest": "synthetic"}, "outside.json")
    assert _refused(store, "--verify-export", outside, capsys) == "verify_export_snapshot_required"
    assert _table_counts(connection) == before_rows
    assert sorted(item.name for item in (root / "snapshots" / "capture-imports").iterdir()) == before_files
    connection.close()


def test_rehashed_pair_still_requires_capture_kind_query_and_event_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    root, _store, _started, _ids, _captures, _session, connection, exported = _funding_export(
        tmp_path, monkeypatch, capsys,
    )
    manifest_path = root / "snapshots" / exported["manifest_ref"]
    request_path = root / "snapshots" / exported["request_ref"]
    request = json.loads(request_path.read_text("utf-8"))

    request["candidates"][0]["pages"][0]["source_kind"] = "search_coverage"
    _rewrite(request_path, request)
    _rehash_manifest(manifest_path, request_path)
    with pytest.raises(CaptureExportVerificationError, match="^invalid_coverage$"):
        _verify(connection, exported["manifest_ref"])

    request["candidates"][0]["pages"][0]["source_kind"] = "issuer"
    request["candidates"][0]["pages"][1]["coverage"]["query"] = "wrong synthetic query"
    _rewrite(request_path, request)
    _rehash_manifest(manifest_path, request_path)
    with pytest.raises(CaptureExportVerificationError, match="^capture_mismatch$"):
        _verify(connection, exported["manifest_ref"])

    request["candidates"][0]["pages"][1]["coverage"]["query"] = "Nimbus Systems funding"
    request["candidates"][0]["events"][0]["excerpt"] = "absent excerpt"
    _rewrite(request_path, request)
    _rehash_manifest(manifest_path, request_path)
    with pytest.raises(CaptureExportVerificationError, match="^invalid_funding_event$"):
        _verify(connection, exported["manifest_ref"])
    connection.close()


def test_people_export_requires_current_funding_scope_and_structural_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    root, store, started, ids, captures, session, connection, funding_export = _funding_export(
        tmp_path, monkeypatch, capsys,
    )
    _parsed, funding, selected = _import_funding(store, root / "snapshots" / funding_export["request_ref"])
    team = _capture(captures, session, ids, root, name="semantic-team", text=TEAM_TEXT,
                    url="https://nimbus.test/team")
    source = _write(
        root / "snapshots", _people_input(started, session, ids, team, funding, selected),
        "verify/semantic-people.json",
    )
    exported = _ok(store, "--compile-people", source, capsys)
    manifest_path = root / "snapshots" / exported["manifest_ref"]
    request_path = root / "snapshots" / exported["request_ref"]
    request = json.loads(request_path.read_text("utf-8"))

    request["funding_batch_hash"] = "0" * 64
    _rewrite(request_path, request)
    _rehash_manifest(manifest_path, request_path)
    with pytest.raises(CaptureExportVerificationError, match="^funding_batch_stale$"):
        _verify(connection, exported["manifest_ref"])

    request["funding_batch_hash"] = funding.batch_hash
    request["candidates"][0]["title"] = "Absent Title"
    _rewrite(request_path, request)
    _rehash_manifest(manifest_path, request_path)
    with pytest.raises(CaptureExportVerificationError, match="^person_evidence_mismatch$"):
        _verify(connection, exported["manifest_ref"])
    connection.close()


def test_manifest_export_kind_must_be_a_string(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    root, _store, _started, _ids, _captures, _session, connection, exported = _funding_export(
        tmp_path, monkeypatch, capsys,
    )
    path = root / "snapshots" / exported["manifest_ref"]
    manifest = json.loads(path.read_text("utf-8"))
    manifest["export_kind"] = []
    _rewrite(path, manifest)
    with pytest.raises(CaptureExportVerificationError, match="^manifest_schema_invalid$"):
        _verify(connection, exported["manifest_ref"])
    connection.close()


def test_verify_export_uri_encodes_a_valid_hash_store_filename_without_a_sibling(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    root, store, _started, _ids, _captures, _session, connection, exported = _funding_export(
        tmp_path, monkeypatch, capsys,
    )
    connection.close()
    encoded_store = store.with_name("store#alt.sqlite")
    store.rename(encoded_store)
    closed = sqlite3.connect(encoded_store)
    try:
        assert closed.execute("PRAGMA journal_mode=DELETE").fetchone()[0].lower() == "delete"
    finally:
        closed.close()
    before = encoded_store.read_bytes()
    sidecars_before = [
        encoded_store.with_name(encoded_store.name + suffix).exists()
        for suffix in ("-journal", "-wal", "-shm")
    ]
    truncated_sibling = encoded_store.with_name("store")
    assert not truncated_sibling.exists()

    result = _ok(
        encoded_store, "--verify-export",
        root / "snapshots" / exported["manifest_ref"], capsys,
    )

    assert result["status"] == "verified"
    assert encoded_store.read_bytes() == before
    assert not truncated_sibling.exists()
    assert [
        encoded_store.with_name(encoded_store.name + suffix).exists()
        for suffix in ("-journal", "-wal", "-shm")
    ] == sidecars_before


@pytest.mark.parametrize("behind_schema", (False, True))
def test_verify_export_never_migrates_an_absent_or_behind_store_schema(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys, behind_schema: bool,
) -> None:
    root = tmp_path / "local" / "kb-prospecting"
    snapshots = root / "snapshots" / "capture-imports"
    snapshots.mkdir(parents=True)
    store = root / "old.sqlite"
    connection = sqlite3.connect(store)
    if behind_schema:
        connection.execute("CREATE TABLE schema_migrations(name TEXT PRIMARY KEY)")
        connection.commit()
    connection.close()
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    manifest_ref = "capture-imports/man_" + "a" * 32 + ".body"
    request_ref = "capture-imports/req_" + "b" * 32 + ".body"
    request = {
        "request_id": "11111111-1111-4111-8111-111111111111",
        "run_id": "prun_" + "a" * 32, "expected_intake_hash": "a" * 64,
        "predecessor_batch_id": None, "predecessor_hash": None,
        "candidates": [{
            "name": "Example Systems", "website_url": "https://example.test/",
            "location": "United States", "sector": "software",
            "pages": [{
                "body_ref": "captures/example.body", "source_url": "https://example.test/funding",
                "source_kind": "issuer", "captured_at": STAMP,
                "expected_content_sha256": "b" * 64,
            }],
            "events": [{"page_ordinal": 0, "stage": "series_b", "announced_at": "2025-05-01", "excerpt": "Example"}],
        }],
    }
    request_bytes = json.dumps(request, sort_keys=True, separators=(",", ":")).encode()
    manifest = {
        "kind": "capture-import-manifest", "export_kind": "funding",
        "compiler_version": COMPILER_VERSION,
        "request_id": request["request_id"], "session_id": "pcs_" + "a" * 32,
        "run_id": request["run_id"], "expected_intake_hash": request["expected_intake_hash"],
        "request_ref": request_ref, "request_sha256": sha256(request_bytes).hexdigest(),
        "request_byte_count": len(request_bytes), "counts": {"candidates": 1, "pages": 1, "captures": 1},
        "captures": [{
            "candidate_ordinal": 0, "page_ordinal": 0, "task_id": "pct_" + "a" * 32,
            "receipt_id": "pcr_" + "a" * 32, "snapshot_id": "snap_" + "a" * 32,
            "content_sha256": "b" * 64, "body_ref": "captures/example.body",
            "expires_at": "2026-09-11T12:00:00Z",
        }],
    }
    (root / "snapshots" / request_ref).write_bytes(request_bytes)
    (root / "snapshots" / manifest_ref).write_bytes(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode(),
    )
    before = store.read_bytes()
    schema_connection = sqlite3.connect(store)
    try:
        schema_before = schema_connection.execute(
            "SELECT name FROM sqlite_master ORDER BY name",
        ).fetchall()
    finally:
        schema_connection.close()
    capture_import_cli_open_store = capture_import_cli.open_store
    monkeypatch.setattr(capture_import_cli, "open_store", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError))
    assert _refused(store, "--verify-export", root / "snapshots" / manifest_ref, capsys) == "store_state_invalid"
    monkeypatch.setattr(capture_import_cli, "open_store", capture_import_cli_open_store)
    assert store.read_bytes() == before
    after_connection = sqlite3.connect(store)
    try:
        assert after_connection.execute("SELECT name FROM sqlite_master ORDER BY name").fetchall() == schema_before
    finally:
        after_connection.close()
    assert not any(store.with_name(store.name + suffix).exists() for suffix in ("-journal", "-wal", "-shm"))


def test_verify_export_reads_a_writer_commit_after_store_path_validation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    root, store, _started, _ids, _captures, _session, connection, exported = _funding_export(
        tmp_path, monkeypatch, capsys,
    )
    connection.close()
    original_connect = sqlite3.connect
    committed = False

    def connect_after_writer(database, *args, **kwargs):
        nonlocal committed
        if not committed and "mode=ro" in str(database):
            writer = original_connect(store)
            try:
                writer.execute("PRAGMA journal_mode=WAL")
                writer.execute("UPDATE campaign SET policy_hash=?", ("b" * 64,))
                writer.commit()
            finally:
                writer.close()
            committed = True
        return original_connect(database, *args, **kwargs)

    monkeypatch.setattr(capture_import_cli.sqlite3, "connect", connect_after_writer)
    assert _refused(
        store, "--verify-export", root / "snapshots" / exported["manifest_ref"], capsys,
    ) == "store_state_invalid"
    assert committed is True
