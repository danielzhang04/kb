"""Real loopback HTTP acceptance for the authenticated selected review seam.

Every row these tests read or write belongs to a real table: the selection comes
from the genuine P15-P20 fixture pipeline, the draft from the real P22 binding
service through :class:`ReviewService`, and the confirmation from the real P24
service.  No selected service is monkeypatched and no fill / contact / affinity /
approval row is created anywhere.

The store is opened on the single thread that owns it: the fixture pipeline runs
on the test thread and closes its connection before the server thread opens its
own connection to the same file.  Startup failures inside that thread propagate to
the test rather than hanging, and the server and its connection are always closed.
"""

from __future__ import annotations

from dataclasses import dataclass
import http.client
import json
from pathlib import Path
from queue import Queue
import re
import threading
from types import MappingProxyType

import pytest

from scripts.prospecting.manager.campaigns import CampaignService
from scripts.prospecting.review_app import _jsonable, create_server
from scripts.prospecting.review_service import ReviewService
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_selected_draft_service import FIRST, SECOND, THIRD
from scripts.prospecting.tests.test_selected_person_render import (
    LEGACY_TABLES,
    _counts,
    _render_ready,
)
from scripts.prospecting.tests.test_selected_person_source import NOW


SELECTED_TABLES = (
    "selected_draft_binding", "selected_draft_request",
    "selected_source_attestation", "selected_source_attestation_request",
)
RECEIPT_KEYS = {
    "request_id", "binding_id", "binding_hash", "revision_id", "revision_hash",
    "prompt_version", "source_context_digest", "render_context_digest",
    "predecessor_binding_hash", "state", "replayed", "superseded_revision_id",
}
ATTESTATION_KEYS = {
    "request_id", "attestation_id", "revision_id", "binding_hash",
    "source_context_digest", "candidate_observation_id", "snapshot_id",
    "expires_at", "attested", "state", "replayed",
}
COUNT_KEYS = {
    "companies", "selected_people", "available_people", "unavailable_people",
    "people_shortfall", "companies_with_shortfall",
}
# Synthetic-only local inputs for a campaign that owns an intake and nothing
# else: no research, no qualification and therefore no ranking.
PROFILE = "22222222-2222-4222-8222-222222222222"
BRIEF = "intent:networking lane:manual industry:software people-count:2"
PRE_RESEARCH_STATES = {"awaiting_research_adapter", "input_pending"}
# Written into the exact bound snapshot body to invalidate it; it must never
# surface anywhere in a projected refusal or snapshot response.
STALE_SENTINEL = "PRIVATE SENTINEL"


def _clock() -> str:
    return NOW.strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class RunningApp:
    server: object
    thread: threading.Thread
    path: Path

    def stop(self) -> None:
        self.server.shutdown()
        self.thread.join(timeout=5)
        assert not self.thread.is_alive()


def _start(path: Path) -> RunningApp:
    """Run the real review app over a connection owned by the server thread."""
    ready: "Queue[object]" = Queue()

    def run() -> None:
        connection = None
        try:
            connection = open_store(path)
            server = create_server(
                ReviewService(connection, now=_clock), CampaignService(connection),
            )
        except BaseException as error:  # surfaced to the test thread, never swallowed
            if connection is not None:
                connection.close()
            ready.put(error)
            return
        ready.put(server)
        try:
            server.serve_forever()
        finally:
            server.server_close()
            connection.close()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    started = ready.get(timeout=10)
    if isinstance(started, BaseException):
        thread.join(timeout=5)
        raise started
    return RunningApp(started, thread, path)


def _http(
    app: RunningApp, method: str, path: str, payload: object | None = None, *,
    cookie: str | None = None, csrf: str | None = None, host: str | None = None,
    origin: str | None = None,
):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Host": app.server.authority if host is None else host}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if cookie is not None:
        headers["Cookie"] = cookie
    if csrf is not None:
        headers["X-CSRF-Token"] = csrf
    if origin is not None:
        headers["Origin"] = origin
    connection = http.client.HTTPConnection(
        "127.0.0.1", app.server.server_address[1], timeout=5,
    )
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def _session(app: RunningApp) -> tuple[str, str]:
    """Complete the one-use bootstrap and return the session cookie and token."""
    connection = http.client.HTTPConnection(
        "127.0.0.1", app.server.server_address[1], timeout=5,
    )
    try:
        connection.request("GET", "/bootstrap", headers={"Host": app.server.authority})
        response = connection.getresponse()
        status = response.status
        headers = dict(response.getheaders())
        response.read()
    finally:
        connection.close()
    assert status == 303 and headers["Location"] == "/"
    cookie = headers["Set-Cookie"].split(";", 1)[0]
    status, body = _http(app, "GET", "/", cookie=cookie)
    assert status == 200
    match = re.search(rb'<meta name="csrf-token" content="([^"]+)">', body)
    assert match is not None
    return cookie, match.group(1).decode("ascii")


def _get(app: RunningApp, path: str, cookie: str):
    status, raw = _http(app, "GET", path, cookie=cookie)
    return status, json.loads(raw)


def _post(app: RunningApp, path: str, payload: object, cookie: str, csrf: str):
    status, raw = _http(app, "POST", path, payload, cookie=cookie, csrf=csrf)
    return status, json.loads(raw)


def _rows(path: Path, *tables: str) -> tuple[int, ...]:
    reader = open_store(path)
    try:
        return _counts(reader, *tables)
    finally:
        reader.close()


def _seed_sender_profile(path: Path) -> None:
    """Insert the one synthetic sender profile a local brief needs."""
    connection = open_store(path)
    try:
        connection.execute(
            "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
            (PROFILE, "Synthetic Sender", None, "Synthetic focus",
             "Synthetic background", "Synthetic proof", "[]"),
        )
        connection.commit()
    finally:
        connection.close()


def _materialize_payload(source, **overrides) -> dict[str, object]:
    values = {
        "request_id": FIRST,
        "campaign_id": source.campaign_id,
        "run_id": source.run_id,
        "person_rank_id": source.person_rank_id,
        "expected_ranking_batch_hash": source.ranking_batch_hash,
    }
    values.update(overrides)
    return values


def _attest_payload(source, receipt, **overrides) -> dict[str, object]:
    values = {
        "request_id": FIRST,
        "campaign_id": source.campaign_id,
        "person_id": source.person_id,
        "expected_revision_id": receipt["revision_id"],
        "expected_source_context_digest": receipt["source_context_digest"],
        "expected_candidate_observation_id": source.candidate_observation_id,
        "attested": True,
    }
    values.update(overrides)
    return values


@pytest.fixture
def selected(tmp_path: Path):
    connection, _seeded, source = _render_ready(tmp_path)
    connection.close()
    app = _start(tmp_path / "store.sqlite")
    try:
        cookie, csrf = _session(app)
        yield app, source, cookie, csrf
    finally:
        app.stop()


def _materialize(app, source, cookie, csrf) -> dict[str, object]:
    status, receipt = _post(
        app, "/api/selected-drafts/materialize", _materialize_payload(source),
        cookie, csrf,
    )
    assert status == 201 and receipt["state"] == "bound"
    return receipt


def test_fresh_intake_next_action_keeps_the_research_prerequisite(tmp_path: Path) -> None:
    """A never-ranked intake reports its prerequisite, not a ranking failure.

    The exact refusal is ``funding_batch_missing``: ``RankingService._scope``
    resolves the qualification scope first, and ``QualificationService._context``
    refuses on the absent funding research batch before ``qualification_missing``
    can ever be reached on a brief this fresh.
    """
    path = tmp_path / "fresh-intake.sqlite"
    _seed_sender_profile(path)
    app = _start(path)
    try:
        cookie, csrf = _session(app)
        status, created = _post(app, "/api/campaigns", {
            "request_id": FIRST, "brief_text": BRIEF,
            "sender_profile_id": PROFILE, "mailbox_id": "mailbox-001",
        }, cookie, csrf)
        assert status == 201 and created["created"] is True
        campaign_id = created["campaign_id"]
        status, saved = _post(app, "/api/pipeline/start", {
            "request_id": SECOND, "campaign_id": campaign_id,
            "as_of_date": "2026-09-09", "funding_stage_min": "series_a",
            "funding_stage_max": "series_c", "funding_window_years": 3,
            "funding_stage_interpretation": "latest_known",
            "geography": {"mode": "specific", "values": ["new_york"]},
            "sector": {"mode": "any", "values": []},
            "requested_companies": 20, "requested_people_per_company": 2,
            "role_families": ["operations", "strategy"],
        }, cookie, csrf)
        assert status == 201 and saved["state"] == "awaiting_research_adapter"

        status, snapshot = _get(app, f"/api/review?campaign_id={campaign_id}", cookie)

        assert status == 200
        assert snapshot["pipeline"]["state"] == "awaiting_research_adapter"
        assert snapshot["people"] == [] and snapshot["drafts"] == []
        selected = snapshot["selected_pipeline"]
        # The unavailable selected state and its exact code stay visible in the
        # projection; only the next action prefers the real prerequisite.
        assert selected["state"] == "unavailable"
        assert selected["error_code"] == "funding_batch_missing"
        assert selected["ranking_batch_id"] is None
        assert selected["counts"]["selected_people"] == 0
        assert snapshot["next_action"] == {
            "title": "Brief saved; research is not connected yet",
            "detail": "The local intake is durable. No research is running.",
            "label": "Awaiting adapter",
        }
        assert _rows(path, *SELECTED_TABLES) == (0, 0, 0, 0)
    finally:
        app.stop()


def test_selected_snapshot_is_projected_before_any_draft_or_legacy_row(selected) -> None:
    app, source, cookie, _csrf = selected

    status, snapshot = _get(
        app, f"/api/review?campaign_id={source.campaign_id}", cookie,
    )

    assert status == 200
    pipeline = snapshot["selected_pipeline"]
    assert pipeline["state"] == "ready" and pipeline["error_code"] is None
    assert pipeline["campaign_id"] == source.campaign_id
    assert pipeline["run_id"] == source.run_id
    assert pipeline["ranking_batch_hash"] == source.ranking_batch_hash
    assert pipeline["counts"]["selected_people"] == 1
    assert pipeline["counts"]["available_people"] == 1
    assert pipeline["counts"]["unavailable_people"] == 0
    person = pipeline["companies"][0]["people"][0]
    assert person["person_id"] == source.person_id
    assert person["person_rank_id"] == source.person_rank_id
    assert person["state"] == "available" and person["error_code"] is None
    # No binding exists yet, so no expectation is offered as a pin.
    assert person["has_prior_binding"] is False
    assert person["bound_revision_id"] is None
    assert person["expected_revision_id"] is None
    assert person["expected_predecessor_binding_hash"] is None
    assert snapshot["drafts"] == []
    assert [item["person_id"] for item in snapshot["people"]] == [source.person_id]
    assert snapshot["people"][0]["selected"] is True
    assert snapshot["people"][0]["identity_source_state"] == "confirmation_required"
    assert snapshot["next_action"]["title"] == "Prepare the selected drafts"
    assert snapshot["next_action"]["label"] == "1 selected"
    assert _rows(app.path, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    assert _rows(app.path, *SELECTED_TABLES) == (0, 0, 0, 0)


def test_stale_actual_selected_snapshot_keeps_its_unavailable_next_action(selected) -> None:
    """A real bound snapshot whose stored body no longer verifies stays reported.

    The immutable ranking batch is never edited and no guard is removed: the exact
    ``body_ref`` file of the bound ``source.snapshot_id`` is tampered instead --
    the same technique the selected projection tests already use -- and the store
    itself is only ever read with a SELECT.  The qualification scope behind
    ``RankingService.get_projection`` verifies that bound snapshot, so the refusal
    is the exact fixed code ``source_changed``.
    """
    app, source, cookie, _csrf = selected
    reader = open_store(app.path)
    try:
        body_ref = reader.execute(
            "SELECT body_ref FROM source_snapshot WHERE snapshot_id=?",
            (source.snapshot_id,),
        ).fetchone()[0]
    finally:
        reader.close()
    (app.path.parent / "snapshots" / str(body_ref)).write_text(
        STALE_SENTINEL, encoding="utf-8",
    )

    status, snapshot = _get(
        app, f"/api/review?campaign_id={source.campaign_id}", cookie,
    )

    assert status == 200
    # The local pipeline is pre-research here too, so the refusal code alone --
    # never the pipeline state -- decides that this stays visible.  ``source_changed``
    # is not a missing prerequisite, so it is never excluded from the next action.
    assert snapshot["pipeline"]["state"] in PRE_RESEARCH_STATES
    assert snapshot["drafts"] == []
    assert snapshot["selected_pipeline"]["state"] == "unavailable"
    assert snapshot["selected_pipeline"]["error_code"] == "source_changed"
    assert snapshot["selected_pipeline"]["companies"] == []
    assert snapshot["next_action"] == {
        "title": "Selected ranking is unavailable",
        "detail": (
            "The current selected ranking could not be read. "
            "No earlier ranking is shown in its place."
        ),
        "label": "source_changed",
    }
    assert STALE_SENTINEL not in json.dumps(snapshot)
    assert _rows(app.path, *SELECTED_TABLES) == (0, 0, 0, 0)


def test_materialize_creates_then_replays_and_refuses_a_changed_payload(selected) -> None:
    app, source, cookie, csrf = selected
    payload = _materialize_payload(source)

    status, receipt = _post(app, "/api/selected-drafts/materialize", payload, cookie, csrf)

    assert status == 201
    assert set(receipt) == RECEIPT_KEYS
    assert (receipt["state"], receipt["replayed"]) == ("bound", False)
    assert receipt["predecessor_binding_hash"] is None
    assert receipt["superseded_revision_id"] is None
    assert receipt["source_context_digest"] == source.source_context_digest

    status, replay = _post(app, "/api/selected-drafts/materialize", payload, cookie, csrf)
    assert status == 200 and replay == {**receipt, "replayed": True}

    status, unchanged = _post(
        app, "/api/selected-drafts/materialize",
        _materialize_payload(source, request_id=SECOND), cookie, csrf,
    )
    assert status == 200
    assert (unchanged["state"], unchanged["replayed"]) == ("unchanged", False)
    assert unchanged["binding_id"] == receipt["binding_id"]

    status, conflict = _post(
        app, "/api/selected-drafts/materialize",
        {**payload, "expected_ranking_batch_hash": "b" * 64}, cookie, csrf,
    )
    assert (status, conflict) == (409, {"error": "request_conflict"})

    for invalid in (
        {**payload, "request_id": THIRD, "actor": "human:browser-supplied"},
        {**payload, "request_id": THIRD, "attested_by": "human:browser-supplied"},
        {**payload, "request_id": THIRD, "expected_revision_id": receipt["revision_id"]},
        {**payload, "request_id": THIRD,
         "expected_predecessor_binding_hash": receipt["binding_hash"]},
    ):
        status, refused = _post(
            app, "/api/selected-drafts/materialize", invalid, cookie, csrf,
        )
        assert (status, refused) == (422, {"error": "request_schema"})

    assert _rows(app.path, "selected_draft_binding") == (1,)


def test_materialized_draft_is_projected_with_a_pending_unconfirmed_proof(selected) -> None:
    app, source, cookie, csrf = selected
    receipt = _materialize(app, source, cookie, csrf)

    status, snapshot = _get(
        app, f"/api/review?campaign_id={source.campaign_id}", cookie,
    )

    assert status == 200
    draft = snapshot["drafts"][0]
    assert draft["revision_id"] == receipt["revision_id"]
    assert draft["source_revision_id"] == receipt["revision_id"]
    assert draft["identity_source_state"] == "confirmation_required"
    assert draft["source_error_code"] is None
    assert draft["identity_source"]["observation_id"] == source.candidate_observation_id
    assert draft["identity_source"]["snapshot_id"] == source.snapshot_id
    # A pending proof is never current and never grants approval.
    assert draft["identity_source"]["is_current"] is False
    assert draft["approval_state"] == "missing"
    person = snapshot["selected_pipeline"]["companies"][0]["people"][0]
    assert person["has_prior_binding"] is True
    assert person["bound_revision_id"] == receipt["revision_id"]
    assert person["expected_revision_id"] == receipt["revision_id"]
    assert person["expected_predecessor_binding_hash"] == receipt["binding_hash"]
    assert _rows(app.path, "selected_source_attestation") == (0,)


def test_false_missing_or_actor_bearing_attestation_is_denied(selected) -> None:
    app, source, cookie, csrf = selected
    receipt = _materialize(app, source, cookie, csrf)
    base = _attest_payload(source, receipt)
    missing = {key: value for key, value in base.items() if key != "attested"}

    status, refused = _post(
        app, "/api/selected-sources/attest", {**base, "attested": False}, cookie, csrf,
    )
    assert (status, refused) == (422, {"error": "source_attestation_required"})

    for invalid in (
        missing,
        {**base, "attested": "true"},
        {**base, "attested_by": "human:browser-supplied"},
        {**base, "actor": "human:browser-supplied"},
    ):
        status, refused = _post(app, "/api/selected-sources/attest", invalid, cookie, csrf)
        assert (status, refused) == (422, {"error": "request_schema"})

    status, snapshot = _get(
        app, f"/api/review?campaign_id={source.campaign_id}", cookie,
    )
    assert status == 200
    assert snapshot["drafts"][0]["identity_source_state"] == "confirmation_required"
    assert _rows(
        app.path, "selected_source_attestation", "selected_source_attestation_request",
    ) == (0, 0)


def test_explicit_confirmation_records_once_and_replays_exactly(selected) -> None:
    app, source, cookie, csrf = selected
    receipt = _materialize(app, source, cookie, csrf)
    payload = _attest_payload(source, receipt)

    status, first = _post(app, "/api/selected-sources/attest", payload, cookie, csrf)

    assert status == 200
    assert set(first) == ATTESTATION_KEYS
    assert (first["state"], first["attested"], first["replayed"]) == ("attested", True, False)
    assert first["revision_id"] == receipt["revision_id"]
    assert first["source_context_digest"] == receipt["source_context_digest"]
    assert first["candidate_observation_id"] == source.candidate_observation_id

    status, replay = _post(app, "/api/selected-sources/attest", payload, cookie, csrf)
    assert status == 200 and replay == {**first, "replayed": True}

    status, snapshot = _get(
        app, f"/api/review?campaign_id={source.campaign_id}", cookie,
    )
    draft = snapshot["drafts"][0]
    assert status == 200
    assert draft["identity_source_state"] == "source_ready"
    assert draft["identity_source"]["is_current"] is True
    # Confirmation is not readiness and not sending authority.
    assert draft["approval_state"] == "missing"
    assert snapshot["schedule"] == []
    assert _rows(app.path, "selected_source_attestation") == (1,)


def test_stale_expected_head_or_digest_confirms_nothing(selected) -> None:
    app, source, cookie, csrf = selected
    receipt = _materialize(app, source, cookie, csrf)
    before = _rows(app.path, *SELECTED_TABLES)

    status, stale_head = _post(
        app, "/api/selected-sources/attest",
        _attest_payload(source, receipt, expected_revision_id="rev-not-current"),
        cookie, csrf,
    )
    assert (status, stale_head) == (422, {"error": "stale_expected_revision"})

    status, stale_digest = _post(
        app, "/api/selected-sources/attest",
        _attest_payload(
            source, receipt, request_id=SECOND,
            expected_source_context_digest="b" * 64,
        ),
        cookie, csrf,
    )
    assert (status, stale_digest) == (422, {"error": "source_context_conflict"})

    status, stale_predecessor = _post(
        app, "/api/selected-drafts/materialize",
        _materialize_payload(
            source, request_id=THIRD, expected_revision_id=receipt["revision_id"],
            expected_predecessor_binding_hash="b" * 64,
        ),
        cookie, csrf,
    )
    assert (status, stale_predecessor) == (422, {"error": "predecessor_binding_stale"})

    assert _rows(app.path, *SELECTED_TABLES) == before
    status, snapshot = _get(
        app, f"/api/review?campaign_id={source.campaign_id}", cookie,
    )
    assert status == 200
    assert snapshot["drafts"][0]["revision_id"] == receipt["revision_id"]
    assert snapshot["drafts"][0]["identity_source_state"] == "confirmation_required"


def test_new_routes_require_session_csrf_exact_host_and_matching_origin(selected) -> None:
    app, source, cookie, csrf = selected
    materialize = _materialize_payload(source)

    status, raw = _http(app, "POST", "/api/selected-drafts/materialize", materialize)
    assert (status, json.loads(raw)) == (401, {"error": "session_required"})

    status, raw = _http(
        app, "POST", "/api/selected-drafts/materialize", materialize, cookie=cookie,
    )
    assert (status, json.loads(raw)) == (403, {"error": "csrf_invalid"})

    status, raw = _http(
        app, "POST", "/api/selected-drafts/materialize", materialize,
        cookie=cookie, csrf=csrf, host="evil.test",
    )
    assert (status, json.loads(raw)) == (400, {"error": "request_invalid"})

    status, raw = _http(
        app, "POST", "/api/selected-drafts/materialize", materialize,
        cookie=cookie, csrf=csrf, origin="http://evil.test",
    )
    assert (status, json.loads(raw)) == (403, {"error": "csrf_invalid"})

    attest = {
        "request_id": FIRST, "campaign_id": source.campaign_id,
        "person_id": source.person_id, "expected_revision_id": "rev-absent-head",
        "expected_source_context_digest": source.source_context_digest,
        "expected_candidate_observation_id": source.candidate_observation_id,
        "attested": True,
    }
    status, raw = _http(app, "POST", "/api/selected-sources/attest", attest)
    assert (status, json.loads(raw)) == (401, {"error": "session_required"})
    status, raw = _http(
        app, "POST", "/api/selected-sources/attest", attest, cookie=cookie,
    )
    assert (status, json.loads(raw)) == (403, {"error": "csrf_invalid"})
    status, raw = _http(
        app, "POST", "/api/selected-sources/attest", attest,
        cookie=cookie, csrf=csrf, origin="http://evil.test",
    )
    assert (status, json.loads(raw)) == (403, {"error": "csrf_invalid"})
    status, raw = _http(
        app, "POST", "/api/selected-sources/attest", attest,
        cookie=cookie, csrf=csrf, host="evil.test",
    )
    assert (status, json.loads(raw)) == (400, {"error": "request_invalid"})

    status, raw = _http(app, "GET", f"/api/review?campaign_id={source.campaign_id}")
    assert (status, json.loads(raw)) == (401, {"error": "session_required"})
    assert _rows(app.path, *SELECTED_TABLES) == (0, 0, 0, 0)


def test_serializer_traverses_the_nested_immutable_projection_counts(selected) -> None:
    app, source, cookie, _csrf = selected
    reader = open_store(app.path)
    try:
        projection = ReviewService(reader, now=_clock).get_selected_pipeline(
            source.campaign_id,
        )
    finally:
        reader.close()

    value = _jsonable(projection)

    assert isinstance(projection.counts, MappingProxyType)
    assert isinstance(value["counts"], dict)
    assert set(value["counts"]) == COUNT_KEYS
    assert all(type(item) is int for item in value["counts"].values())
    assert value["counts"] == dict(projection.counts)
    assert isinstance(value["companies"], list)
    assert isinstance(value["companies"][0]["reason_codes"], list)
    assert isinstance(value["companies"][0]["people"], list)
    # The same projection must survive the real response encoder unchanged.
    status, snapshot = _get(
        app, f"/api/review?campaign_id={source.campaign_id}", cookie,
    )
    assert status == 200 and snapshot["selected_pipeline"] == value


def test_existing_routes_are_preserved_alongside_the_selected_seam(selected) -> None:
    app, source, cookie, csrf = selected

    status, snapshot = _get(app, "/api/review", cookie)
    assert status == 200
    assert snapshot["selected_pipeline"] is None
    assert [item["campaign_id"] for item in snapshot["campaigns"]] == [source.campaign_id]
    assert snapshot["next_action"]["title"] == "Choose a campaign"

    status, _body = _http(app, "GET", "/favicon.ico", cookie=cookie)
    assert status == 204

    status, raw = _http(app, "GET", "/api/not-a-route", cookie=cookie)
    assert (status, json.loads(raw)) == (404, {"error": "route_missing"})

    status, prepare = _post(
        app, "/api/drafts/prepare", {"campaign_id": source.campaign_id, "step": 0},
        cookie, csrf,
    )
    assert (status, prepare) == (422, {"error": "prepare_unavailable"})

    status, ready = _post(
        app, "/api/drafts/ready",
        {
            "request_id": FIRST, "campaign_id": source.campaign_id,
            "expected_revision_id": "rev-absent-head", "ready": True,
        },
        cookie, csrf,
    )
    assert (status, ready) == (404, {"error": "draft_missing"})
    assert _rows(app.path, "revision", "draft_editorial_event", "approval") == (0, 0, 0)
