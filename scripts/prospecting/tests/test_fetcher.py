from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import socket
import subprocess
import sys
import urllib.request
from types import SimpleNamespace

import pytest

from scripts.prospecting.fetcher import FetchPolicy, fetch_snapshot, purge_expired
from scripts.prospecting.store import open_store


@pytest.fixture
def injection_fixture():
    return Path("orgs/prospecting/fixtures/fetch-snapshot-injection.html").read_bytes()


def seed_entity(db, entity_id="company-1", url="https://synthetic.test/about"):
    db.execute(
        "INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        (entity_id, "Synthetic", url, "manual", entity_id + "-key"),
    )
    db.commit()


@pytest.fixture
def deny_external(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("external_side_effect")

    monkeypatch.setattr(socket, "getaddrinfo", blocked)
    monkeypatch.setattr(socket, "socket", blocked)
    monkeypatch.setattr(urllib.request, "urlopen", blocked)
    monkeypatch.setattr(subprocess, "run", blocked)
    monkeypatch.setattr(subprocess, "Popen", blocked)
    monkeypatch.setattr(os, "system", blocked)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", SimpleNamespace(sync_playwright=blocked))


def test_snapshot_metadata_and_exact_30_day_retention(tmp_path):
    db = open_store(tmp_path / "snap.sqlite")
    seed_entity(db)
    now = datetime(2026, 9, 3, tzinfo=timezone.utc)
    response = type("R", (), {"body": b"<html>synthetic</html>", "content_type": "text/html", "final_url": "https://synthetic.test/about"})()
    meta = fetch_snapshot(db, "company-1", FetchPolicy(("synthetic.test",), "allow-v1", tmp_path / "bodies"), now, lambda _: response)
    assert meta.retention_delete_at - now == timedelta(days=30)
    assert (tmp_path / "bodies" / meta.body_ref).read_bytes() == response.body


def test_redirect_outside_allowlist_fails_closed(tmp_path):
    db = open_store(tmp_path / "redirect.sqlite")
    seed_entity(db)
    now = datetime(2026, 9, 3, tzinfo=timezone.utc)
    response = type("R", (), {"body": b"x", "content_type": "text/plain", "final_url": "https://blocked.test/x"})()
    with pytest.raises(ValueError, match="fetch_domain_blocked"):
        fetch_snapshot(db, "company-1", FetchPolicy(("synthetic.test",), "allow-v1", tmp_path / "bodies"), now, lambda _: response)
    assert db.execute("SELECT COUNT(*) FROM source_snapshot").fetchone()[0] == 0
    assert list((tmp_path / "bodies").glob("*")) == []


def test_default_transport_never_opens_a_socket(tmp_path, monkeypatch, deny_external):
    monkeypatch.delenv("KB_PROSPECTING_NO_NETWORK", raising=False)
    db = open_store(tmp_path / "offline.sqlite")
    seed_entity(db)
    meta = fetch_snapshot(db, "company-1", FetchPolicy(("synthetic.test",), "allow-v1", tmp_path), datetime(2026, 9, 3, tzinfo=timezone.utc))
    assert len(meta.content_sha256) == 64


def test_default_fixture_lookup_is_independent_of_current_directory(tmp_path, monkeypatch, deny_external):
    monkeypatch.chdir(tmp_path)
    db = open_store(tmp_path / "cwd.sqlite")
    seed_entity(db)
    meta = fetch_snapshot(
        db,
        "company-1",
        FetchPolicy(("synthetic.test",), "allow-v1", tmp_path / "bodies"),
        datetime(2026, 9, 3, tzinfo=timezone.utc),
    )
    assert (tmp_path / "bodies" / meta.body_ref).exists()


def test_caller_supplied_url_is_not_an_api_parameter():
    import inspect

    assert tuple(inspect.signature(fetch_snapshot).parameters) == ("connection", "entity_id", "policy", "retrieved_at", "transport")


def test_metadata_failure_cleans_staged_and_final_bodies(tmp_path):
    db = open_store(tmp_path / "atomic.sqlite")
    seed_entity(db)
    db.execute("CREATE TRIGGER reject_snapshot BEFORE INSERT ON source_snapshot BEGIN SELECT RAISE(ABORT,'fixture_reject'); END")
    db.commit()
    response = type("R", (), {"body": b"fixture", "content_type": "text/plain", "final_url": "https://synthetic.test/about"})()
    body_dir = tmp_path / "bodies"
    with pytest.raises(Exception, match="fixture_reject"):
        fetch_snapshot(db, "company-1", FetchPolicy(("synthetic.test",), "allow-v1", body_dir), datetime(2026, 9, 3, tzinfo=timezone.utc), lambda _: response)
    assert db.execute("SELECT COUNT(*) FROM source_snapshot").fetchone()[0] == 0
    assert list(body_dir.glob("*")) == []


def test_failed_fetch_preserves_callers_open_transaction(tmp_path):
    db = open_store(tmp_path / "transaction.sqlite")
    seed_entity(db)
    db.execute("BEGIN")
    db.execute(
        "INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ("caller-row", "Caller", "https://synthetic.test/caller", "manual", "caller-key"),
    )
    db.execute(
        "CREATE TRIGGER reject_snapshot BEFORE INSERT ON source_snapshot "
        "BEGIN SELECT RAISE(ABORT,'fixture_reject'); END"
    )
    response = type("R", (), {"body": b"fixture", "content_type": "text/plain", "final_url": "https://synthetic.test/about"})()
    with pytest.raises(Exception, match="fixture_reject"):
        fetch_snapshot(
            db,
            "company-1",
            FetchPolicy(("synthetic.test",), "allow-v1", tmp_path / "bodies"),
            datetime(2026, 9, 3, tzinfo=timezone.utc),
            lambda _: response,
        )
    assert db.in_transaction
    assert db.execute("SELECT name FROM company WHERE company_id='caller-row'").fetchone()["name"] == "Caller"


def test_injection_body_produces_only_snapshot_row_and_body(tmp_path, injection_fixture, deny_external):
    db = open_store(tmp_path / "inert.sqlite")
    seed_entity(db)
    now = datetime(2026, 9, 3, tzinfo=timezone.utc)
    response = type("R", (), {"body": injection_fixture, "content_type": "text/html", "final_url": "https://synthetic.test/about"})()
    before = db.total_changes
    meta = fetch_snapshot(db, "company-1", FetchPolicy(("synthetic.test",), "allow-v1", tmp_path / "bodies"), now, lambda _: response)
    assert db.total_changes - before == 1
    assert (tmp_path / "bodies" / meta.body_ref).read_bytes() == injection_fixture
    assert sorted(path.name for path in (tmp_path / "bodies").iterdir()) == [meta.body_ref]


def test_purge_deletes_expired_body_but_retains_audit_row(tmp_path):
    db = open_store(tmp_path / "purge.sqlite")
    seed_entity(db)
    now = datetime(2026, 9, 3, tzinfo=timezone.utc)
    response = type("R", (), {"body": b"synthetic", "content_type": "text/plain", "final_url": "https://synthetic.test/about"})()
    meta = fetch_snapshot(db, "company-1", FetchPolicy(("synthetic.test",), "allow-v1", tmp_path), now, lambda _: response)
    assert purge_expired(db, tmp_path, now + timedelta(days=30)) == 1
    assert not (tmp_path / meta.body_ref).exists()
    assert db.execute("SELECT content_sha256 FROM source_snapshot WHERE snapshot_id=?", (meta.snapshot_id,)).fetchone()[0] == meta.content_sha256
