"""One public-CLI P15 -> P23 -> compile -> P17/P18 lifecycle.

This deliberately crosses only public ``main`` functions.  It does not replace
the capture controller, compiler, importer, packet, or output with a stub.
"""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path

import pytest

import scripts.prospecting.capture_import_cli as capture_import_cli
import scripts.prospecting.pipeline_cli as pipeline_cli
import scripts.prospecting.research_capture_cli as research_capture_cli
from scripts.prospecting.capture_import_compiler import CaptureImportCompiler
from scripts.prospecting.funding_research_service import FundingResearchService
from scripts.prospecting.person_research_service import PersonResearchService
from scripts.prospecting.research_capture_service import (
    OPEN_KIND,
    SEARCH_KIND,
    CaptureService,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_capture_import_compiler import (
    EVENT_TEXT,
    SEARCH_TEXT,
    SKILL_HASH,
    STAMP,
    TEAM_TEXT,
    _Clock,
    _seed,
)


FUNDING_URL = "https://nimbus.test/funding"
TEAM_URL = "https://nimbus.test/team"
SEARCH_URL = "https://search.test/nimbus"
QUERY = "Nimbus Systems funding"
PRIVATE_VALUES = (
    "Nimbus", "nimbus.test", "search.test", QUERY, FUNDING_URL, TEAM_URL,
    SEARCH_URL, EVENT_TEXT, SEARCH_TEXT, TEAM_TEXT, "Avery", "Blake",
)
SESSION_FIELDS = {
    "session_id", "session_hash", "run_id", "intake_hash", "state", "counts",
    "replayed",
}
TASK_FIELDS = {"task_id", "session_id", "ordinal", "task_kind", "state", "replayed"}
CLAIM_FIELDS = {
    "task_id", "attempt_id", "attempt_no", "lease_epoch", "task_kind",
    "expires_at", "packet_ref", "claimed", "state",
}
RECEIPT_FIELDS = {
    "receipt_id", "task_id", "attempt_id", "snapshot_id", "content_sha256",
    "retrieved_at", "byte_count", "state",
}
EXPORT_FIELDS = {
    "status", "kind", "exported", "request_ref", "request_sha256",
    "manifest_ref", "manifest_sha256", "counts",
}
FUNDING_FIELDS = {
    "batch_id", "batch_hash", "run_id", "intake_hash", "state", "counts", "replayed",
}
PERSON_FIELDS = {
    "batch_id", "batch_hash", "run_id", "intake_hash", "funding_batch_id",
    "funding_batch_hash", "state", "counts", "replayed",
}


class _ClockedCaptureService(CaptureService):
    def __init__(self, connection, *, now=None) -> None:
        super().__init__(connection, now=now or _Clock())


class _ClockedCompiler(CaptureImportCompiler):
    def __init__(self, connection, *, now=None) -> None:
        super().__init__(connection, now=now or _Clock())


class _ClockedFundingService(FundingResearchService):
    def __init__(self, connection, *, now=None) -> None:
        super().__init__(connection, now=now or _Clock())


class _ClockedPersonService(PersonResearchService):
    def __init__(self, connection, *, now=None) -> None:
        super().__init__(connection, now=now or _Clock())


def _write(snapshots: Path, value: object, name: str) -> Path:
    path = snapshots / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def _incoming(snapshots: Path, name: str, contents: str) -> str:
    path = snapshots / "incoming" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding="utf-8")
    return f"incoming/{name}"


def _assert_private_absent(value: str) -> None:
    for private in PRIVATE_VALUES:
        assert private not in value


def _main(module, store: Path, option: str, value: object, capsys) -> dict:
    code = module.main(["--store", str(store), option, str(value)])
    captured = capsys.readouterr()
    assert (code, captured.err) == (0, "")
    _assert_private_absent(captured.out)
    return json.loads(captured.out)


def _refused(module, store: Path, option: str, value: object, capsys) -> str:
    code = module.main(["--store", str(store), option, str(value)])
    captured = capsys.readouterr()
    assert (code, captured.out) == (2, "")
    _assert_private_absent(captured.err)
    return captured.err.strip().split(":", 1)[1]


def _capture(
    store: Path, snapshots: Path, session_id: str, *, request_id: str,
    task_kind: str, body: str, body_name: str, source_url: str,
    url: str | None = None, query: str | None = None, capsys,
) -> dict:
    task = _main(research_capture_cli, store, "--enqueue", _write(snapshots, {
        "request_id": request_id, "session_id": session_id, "task_kind": task_kind,
        "query": query, "url": url,
    }, f"public/{body_name}-enqueue.json"), capsys)
    assert set(task) == TASK_FIELDS
    assert task["replayed"] is False

    claim = _main(research_capture_cli, store, "--claim", session_id, capsys)
    assert set(claim) == CLAIM_FIELDS
    assert (claim["claimed"], claim["state"], claim["task_id"]) == (
        True, "leased", task["task_id"],
    )

    submitted = _main(research_capture_cli, store, "--submit-packet", _write(snapshots, {
        "packet_ref": claim["packet_ref"],
        "body_ref": _incoming(snapshots, f"{body_name}.txt", body),
        "source_url": source_url,
        "retrieved_at": STAMP,
    }, f"public/{body_name}-submit-packet.json"), capsys)
    assert set(submitted) == RECEIPT_FIELDS
    assert (submitted["task_id"], submitted["attempt_id"], submitted["state"]) == (
        claim["task_id"], claim["attempt_id"], "captured",
    )
    assert submitted["content_sha256"] == sha256(body.encode("utf-8")).hexdigest()
    return submitted


def _capture_ref(receipt: dict) -> dict[str, str]:
    return {
        "task_id": receipt["task_id"],
        "expected_receipt_id": receipt["receipt_id"],
        "expected_content_sha256": receipt["content_sha256"],
    }


def _request_path(snapshots: Path, exported: dict) -> Path:
    request = snapshots / exported["request_ref"]
    contents = request.read_bytes()
    assert sha256(contents).hexdigest() == exported["request_sha256"]
    return request


def _assert_no_authority_or_delivery_rows(store: Path) -> None:
    connection = open_store(store)
    try:
        for table in ("approval", "exec_request", "t1_send_attempt", "t1_send_fence"):
            assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    finally:
        connection.close()


def test_public_cli_capture_compile_and_import_chain_replays_exact_request_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root = tmp_path / "local" / "kb-prospecting"
    snapshots = root / "snapshots"
    snapshots.mkdir(parents=True)
    store = root / "store.sqlite"
    connection = open_store(store)
    started = _seed(connection)
    connection.close()
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setattr(research_capture_cli, "CaptureService", _ClockedCaptureService)
    monkeypatch.setattr(capture_import_cli, "CaptureImportCompiler", _ClockedCompiler)
    monkeypatch.setattr(pipeline_cli, "FundingResearchService", _ClockedFundingService)
    monkeypatch.setattr(pipeline_cli, "PersonResearchService", _ClockedPersonService)

    session = _main(research_capture_cli, store, "--session-start", _write(snapshots, {
        "request_id": "11111111-1111-4111-8111-111111111111",
        "run_id": started.run_id, "expected_intake_hash": started.intake_hash,
        "acquisition_skill_hash": SKILL_HASH, "task_cap": 3,
    }, "public/session-start.json"), capsys)
    assert set(session) == SESSION_FIELDS
    assert (session["state"], session["replayed"]) == ("accepting_capture_tasks", False)

    event = _capture(
        store, snapshots, session["session_id"],
        request_id="22222222-2222-4222-8222-222222222222", task_kind=OPEN_KIND,
        body=EVENT_TEXT, body_name="event", source_url=FUNDING_URL, url=FUNDING_URL,
        capsys=capsys,
    )
    search = _capture(
        store, snapshots, session["session_id"],
        request_id="33333333-3333-4333-8333-333333333333", task_kind=SEARCH_KIND,
        body=SEARCH_TEXT, body_name="search", source_url=SEARCH_URL, query=QUERY,
        capsys=capsys,
    )
    team = _capture(
        store, snapshots, session["session_id"],
        request_id="44444444-4444-4444-8444-444444444444", task_kind=OPEN_KIND,
        body=TEAM_TEXT, body_name="team", source_url=TEAM_URL, url=TEAM_URL,
        capsys=capsys,
    )

    funding_annotation = _write(snapshots, {
        "request_id": "55555555-5555-4555-8555-555555555555",
        "session_id": session["session_id"], "run_id": started.run_id,
        "expected_intake_hash": started.intake_hash,
        "predecessor_batch_id": None, "predecessor_hash": None,
        "companies": [{
            "name": "Nimbus Systems", "website_url": "https://nimbus.test/",
            "location": "United States", "sector": "software",
            "pages": [
                {"capture": _capture_ref(event), "source_kind": "issuer", "coverage": None},
                {"capture": _capture_ref(search), "source_kind": "search_coverage",
                 "coverage": {"status": "found", "result_count": 1, "result_cap": 20}},
            ],
            "events": [{"page_ordinal": 0, "stage": "series_b", "announced_at": "2025-05-01",
                        "excerpt": {"start": 0, "end": len(EVENT_TEXT)}}],
        }],
    }, "public/funding-annotation.json")
    funding_export = _main(
        capture_import_cli, store, "--compile-funding", funding_annotation, capsys,
    )
    assert set(funding_export) == EXPORT_FIELDS
    assert funding_export["counts"] == {"candidates": 1, "pages": 2, "captures": 2}
    funding_request = _request_path(snapshots, funding_export)
    funding_payload = json.loads(funding_request.read_text(encoding="utf-8"))
    assert [page["expected_content_sha256"] for page in funding_payload["candidates"][0]["pages"]] == [
        event["content_sha256"], search["content_sha256"],
    ]

    funding_first = _main(pipeline_cli, store, "--funding-import", funding_request, capsys)
    funding_replay = _main(pipeline_cli, store, "--funding-import", funding_request, capsys)
    assert set(funding_first) == set(funding_replay) == FUNDING_FIELDS
    assert funding_first["replayed"] is False and funding_replay["replayed"] is True
    assert {**funding_first, "replayed": True} == funding_replay
    assert sha256(funding_request.read_bytes()).hexdigest() == funding_export["request_sha256"]

    scope = _main(pipeline_cli, store, "--person-scope", started.run_id, capsys)
    assert scope["state"] == "provisional_person_research_scope"
    assert len(scope["companies"]) == 1
    selected = scope["companies"][0]
    people_annotation = _write(snapshots, {
        "request_id": "66666666-6666-4666-8666-666666666666",
        "session_id": session["session_id"], "run_id": started.run_id,
        "expected_intake_hash": started.intake_hash,
        "funding_batch_id": scope["funding_batch_id"],
        "funding_batch_hash": scope["funding_batch_hash"],
        "predecessor_batch_id": None, "predecessor_hash": None,
        "research_result_ids": [selected["funding_result_id"]],
        "people": [{
            "capture": _capture_ref(team), "funding_result_id": selected["funding_result_id"],
            "company_id": selected["company_id"], "first_name": "Avery",
            "full_name": {"start": 0, "end": len("Avery Alpha")},
            "title": {"start": TEAM_TEXT.index("Head of Operations"),
                      "end": TEAM_TEXT.index("Head of Operations") + len("Head of Operations")},
            "profile_url": "https://profile.test/avery-alpha",
        }],
    }, "public/people-annotation.json")
    people_export = _main(capture_import_cli, store, "--compile-people", people_annotation, capsys)
    assert set(people_export) == EXPORT_FIELDS
    assert people_export["counts"] == {"candidates": 1, "pages": 1, "captures": 1}
    people_request = _request_path(snapshots, people_export)
    people_payload = json.loads(people_request.read_text(encoding="utf-8"))
    assert people_payload["candidates"][0]["expected_content_sha256"] == team["content_sha256"]

    people_first = _main(pipeline_cli, store, "--person-import", people_request, capsys)
    people_replay = _main(pipeline_cli, store, "--person-import", people_request, capsys)
    assert set(people_first) == set(people_replay) == PERSON_FIELDS
    assert people_first["replayed"] is False and people_replay["replayed"] is True
    assert {**people_first, "replayed": True} == people_replay
    assert sha256(people_request.read_bytes()).hexdigest() == people_export["request_sha256"]

    # The compiler resolves and hashes the owned source bytes again.  A stale
    # capture cannot be silently re-exported after a successful import.
    connection = open_store(store)
    try:
        body_ref = connection.execute(
            """SELECT s.body_ref FROM source_snapshot AS s
                 JOIN prospecting_capture_receipt AS r ON r.snapshot_id=s.snapshot_id
                WHERE r.task_id=?""", (team["task_id"],),
        ).fetchone()[0]
    finally:
        connection.close()
    (snapshots / str(body_ref)).write_text("stale", encoding="utf-8")
    assert _refused(capture_import_cli, store, "--compile-people", people_annotation, capsys) == "source_changed"
    _assert_no_authority_or_delivery_rows(store)
