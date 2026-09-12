"""Tests for scripts.prospecting.tests.ui_acceptance_fixture.

Covers the human-edit restart path, malformed-metadata refusals, the read-only
connection helper, the symlink/junction checks and the ``_serve`` timer wiring.
"""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import threading
import time
import uuid

import pytest

from scripts.prospecting.pipeline_stage_service import PipelineStageService
from scripts.prospecting.review_service import EditDraftRequest, ReviewService
from scripts.prospecting.store import open_store
from scripts.prospecting.tests import ui_acceptance_fixture as uaf
from scripts.prospecting.tests.test_selected_person_source import NOW, STAMP


# Static metadata that _load_metadata accepts; bad cases are derived from it.
VALID_METADATA: dict[str, object] = {
    "marker": uaf.MARKER_CONTENT,
    "campaign_id": "cmp_static",
    "revision_id": "rev_static",
    "exhausted_item_id": "item_static",
    "repair_cycle": uaf.EXPECTED_PARKED_CYCLE,
    "pipeline_state": "parked",
    "cycles_run": uaf.EXPECTED_CYCLES,
    "adapter_calls": uaf.EXPECTED_ADAPTER_CALLS,
}

# Name fragments of tables whose rows would mean a downstream side effect ran.
SIDE_EFFECT_TOKENS = ("attestation", "approval", "execution", "outbox", "delivery")


def _write_fixture_files(root: Path, metadata, marker: str = uaf.MARKER_CONTENT) -> Path:
    """Write marker and metadata files; ``metadata`` may be raw JSON text."""
    root.mkdir(parents=True, exist_ok=True)
    text = (
        metadata
        if isinstance(metadata, str)
        else json.dumps(metadata, sort_keys=True, separators=(",", ":"))
    )
    (root / uaf.METADATA_FILENAME).write_text(text, encoding="utf-8")
    (root / uaf.MARKER_FILENAME).write_text(marker, encoding="utf-8")
    return root


def test_human_edit_reset_keeps_old_item_parked_and_starts_new_cycle(tmp_path):
    root = tmp_path / "fixture"
    result = uaf._prepare(root)
    # The only real preparation run: pin the counts it advertises.
    assert result["cycles_run"] == 3
    assert result["adapter_calls"] == 9
    assert result["repair_cycle"] == 2
    assert result["pipeline_state"] == "parked"
    connection = open_store(root / uaf.STORE_FILENAME)
    try:
        row = connection.execute(
            "SELECT subject,body FROM revision WHERE revision_id=?",
            (result["revision_id"],),
        ).fetchone()
        words = row["subject"].split()
        assert len(words) >= 2
        subject = " ".join([*words[:-2], words[-1], words[-2]])
        edited = ReviewService(connection, now=lambda: STAMP).edit_draft(
            EditDraftRequest(
                str(uuid.uuid4()), result["campaign_id"], result["revision_id"],
                subject, row["body"],
            )
        )
        assert edited.state == "revision_created"

        service = PipelineStageService(connection, now=lambda: NOW)
        reset = service.start_from_human_edit(
            result["campaign_id"], edited.revision_id, result["exhausted_item_id"],
            "restart-request", "human:local-review",
        )

        old_item = connection.execute(
            "SELECT state,repair_cycle FROM prospecting_pipeline_item WHERE item_id=?",
            (result["exhausted_item_id"],),
        ).fetchone()
        assert old_item["state"] == "parked"
        assert old_item["repair_cycle"] == 2

        new_item = connection.execute(
            "SELECT state,repair_cycle FROM prospecting_pipeline_item WHERE item_id=?",
            (reset.item_id,),
        ).fetchone()
        assert new_item is not None
        assert new_item["repair_cycle"] == 0

        # Trip-wire, not a proof: vacuous if this schema has no such table, but
        # a future attestation/approval/execution/send table must stay empty.
        names = [
            str(entry[0])
            for entry in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        ]
        for name in names:
            if any(token in name.lower() for token in SIDE_EFFECT_TOKENS):
                count = connection.execute(
                    f"SELECT COUNT(*) FROM {name}"  # name comes from sqlite_master
                ).fetchone()[0]
                assert count == 0, name

        metadata = uaf._load_metadata(root)
        uaf._validate_store_identity(connection, metadata)
    finally:
        connection.close()


def test_load_metadata_accepts_static_valid_files(tmp_path):
    root = _write_fixture_files(tmp_path / "valid", VALID_METADATA)
    assert uaf._load_metadata(root) == VALID_METADATA


@pytest.mark.parametrize(
    "overrides,dropped,code",
    [
        ({"marker": "OTHER_MARKER_V0"}, None, "fixture_metadata_invalid"),
        ({"pipeline_state": "running"}, None, "fixture_metadata_invalid"),
        ({"repair_cycle": uaf.EXPECTED_PARKED_CYCLE + 1}, None, "fixture_metadata_invalid"),
        ({"cycles_run": uaf.EXPECTED_CYCLES + 1}, None, "fixture_metadata_invalid"),
        ({"adapter_calls": uaf.EXPECTED_ADAPTER_CALLS - 1}, None, "fixture_metadata_invalid"),
        ({"repair_cycle": "2"}, None, "fixture_metadata_invalid"),
        ({"cycles_run": True}, None, "fixture_metadata_invalid"),
        ({"campaign_id": 17}, None, "fixture_metadata_invalid"),
        ({"revision_id": None}, None, "fixture_metadata_invalid"),
        ({}, "exhausted_item_id", "fixture_metadata_invalid"),
        ({}, "adapter_calls", "fixture_metadata_invalid"),
    ],
)
def test_load_metadata_rejects_malformed_metadata(tmp_path, overrides, dropped, code):
    metadata = {**VALID_METADATA, **overrides}
    if dropped is not None:
        del metadata[dropped]
    root = _write_fixture_files(tmp_path / "malformed", metadata)
    with pytest.raises(uaf.FixtureError, match=code):
        uaf._load_metadata(root)


@pytest.mark.parametrize("text", ["[1, 2]", '"parked"', "{not json", ""])
def test_load_metadata_rejects_non_object_or_unparsable_json(tmp_path, text):
    root = _write_fixture_files(tmp_path / "json", text)
    with pytest.raises(uaf.FixtureError, match="fixture_metadata_invalid"):
        uaf._load_metadata(root)


def test_load_metadata_rejects_wrong_marker_text(tmp_path):
    root = _write_fixture_files(
        tmp_path / "marker", VALID_METADATA, marker="NOT_THE_MARKER",
    )
    with pytest.raises(uaf.FixtureError, match="fixture_marker_invalid"):
        uaf._load_metadata(root)


def test_load_metadata_rejects_missing_metadata_file(tmp_path):
    root = _write_fixture_files(tmp_path / "missing", VALID_METADATA)
    (root / uaf.METADATA_FILENAME).unlink()
    with pytest.raises(uaf.FixtureError, match="fixture_marker_missing"):
        uaf._load_metadata(root)


def test_read_only_connection_opens_special_character_path_read_only(tmp_path):
    root = tmp_path / "space dir #1 café"
    root.mkdir()
    database = root / uaf.STORE_FILENAME
    writer = sqlite3.connect(database)
    writer.execute("CREATE TABLE probe(value INTEGER)")
    writer.execute("INSERT INTO probe(value) VALUES (4242)")
    writer.commit()
    writer.close()
    before = database.read_bytes()
    assert "%23" in database.as_uri()

    connection = uaf._read_only_connection(database)
    try:
        assert connection.execute("SELECT value FROM probe").fetchone()[0] == 4242
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            connection.execute("INSERT INTO probe(value) VALUES (1)")
    finally:
        connection.close()

    assert database.read_bytes() == before
    assert not (root / (uaf.STORE_FILENAME + "-wal")).exists()
    assert not (root / (uaf.STORE_FILENAME + "-journal")).exists()


def test_unrelated_store_rejected_without_wal_or_mutation(tmp_path):
    root = tmp_path / "unrelated"
    root.mkdir()
    database = root / uaf.STORE_FILENAME
    plain = sqlite3.connect(database)
    plain.execute("CREATE TABLE unrelated(x INTEGER)")
    plain.commit()
    plain.close()
    before = database.read_bytes()
    _write_fixture_files(root, {**VALID_METADATA, "campaign_id": "cmp_unrelated"})

    with pytest.raises(uaf.FixtureError, match="fixture_identity_mismatch"):
        uaf._serve(root, 8766)

    assert database.read_bytes() == before
    assert not (root / (uaf.STORE_FILENAME + "-wal")).exists()


def test_trusted_root_rejects_symlink(tmp_path):
    target = tmp_path / "real_root"
    target.mkdir()
    link = tmp_path / "link_root"
    link.symlink_to(target)
    with pytest.raises(uaf.FixtureError, match="fixture_path_untrusted"):
        uaf._trusted_root(link)


def test_trusted_file_rejects_symlink(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    real_file = tmp_path / "real_store.sqlite"
    real_file.write_bytes(b"")
    (root / uaf.STORE_FILENAME).symlink_to(real_file)
    with pytest.raises(uaf.FixtureError, match="fixture_path_untrusted"):
        uaf._trusted_file(root, uaf.STORE_FILENAME, "fixture_store_missing")


def test_trusted_root_rejects_junction_mock(tmp_path, monkeypatch):
    root = tmp_path / "junction_root"
    root.mkdir()
    monkeypatch.setattr(Path, "is_junction", lambda self: True, raising=False)
    with pytest.raises(uaf.FixtureError, match="fixture_path_untrusted"):
        uaf._trusted_root(root)


def test_trusted_file_rejects_junction_mock(tmp_path, monkeypatch):
    root = tmp_path / "junction_file_root"
    root.mkdir()
    (root / uaf.STORE_FILENAME).write_bytes(b"")
    monkeypatch.setattr(Path, "is_junction", lambda self: True, raising=False)
    with pytest.raises(uaf.FixtureError, match="fixture_path_untrusted"):
        uaf._trusted_file(root, uaf.STORE_FILENAME, "fixture_store_missing")


def test_serve_timer_shuts_down_and_closes_server_exactly_once(tmp_path, monkeypatch):
    # Lifecycle only: a fake stands in for create_server, so this covers the
    # timer/shutdown/close wiring and makes no HTTP request.
    root = tmp_path / "fixture"
    uaf._prepare(root)
    monkeypatch.setattr(uaf, "SERVE_SECONDS", 0.05)

    class FakeServer:
        def __init__(self) -> None:
            self.shutdown_calls = 0
            self.server_close_calls = 0
            self.authority = "127.0.0.1:0"
            self._event = threading.Event()

        def serve_forever(self) -> None:
            self._event.wait(timeout=2)

        def shutdown(self) -> None:
            self.shutdown_calls += 1
            self._event.set()

        def server_close(self) -> None:
            self.server_close_calls += 1

    fake = FakeServer()
    monkeypatch.setattr(uaf, "create_server", lambda *args, **kwargs: fake)

    started = time.perf_counter()
    uaf._serve(root, 8766)
    elapsed = time.perf_counter() - started

    assert fake.shutdown_calls == 1
    assert fake.server_close_calls == 1
    assert elapsed < 1.0
