from __future__ import annotations

from dataclasses import dataclass
import contextlib
import http.client
import json
from pathlib import Path
from queue import Queue
import re
import socket
import sqlite3
import threading
import time

import pytest

import scripts.prospecting.review_app as review_app
from scripts.prospecting.control_desktop import ControlError
from scripts.prospecting.control_review import (
    ControlReviewAdapter,
    ControlReviewError,
    ControlReviewStatus,
)
from scripts.prospecting.feedback_service import FeedbackView, FulfillFeedbackRequest
from scripts.prospecting.feedback_service import FeedbackService
from scripts.prospecting.affinity.evidence_bridge import CurrentRoleProof
from scripts.prospecting.affinity.source_review import verify_snapshot
from scripts.prospecting.affinity.templates_v2 import draft_step_zero_proof_pending
from scripts.prospecting.pipeline_stage_service import (
    AcceptanceResult,
    ItemProjection,
    PipelineStageError,
    PipelineStageService,
    RejectionResult,
    ReviewProjection,
)
from scripts.prospecting.review_app import (
    MAX_JSON_BYTES,
    MAX_CONTENT_LENGTH_DIGITS,
    MAX_REFUSAL_DRAIN_SECONDS,
    MAX_SOURCE_BYTES,
    MAX_SOURCE_UPLOAD_JSON_BYTES,
    SESSION_SECONDS,
    _draft_preparer,
    _selected_store_context,
    create_server,
)
from scripts.prospecting.review_service import (
    ActivityView,
    CampaignView,
    DraftView,
    FeedbackRequest,
    FundingBatchView,
    FundingCompanyView,
    FundingSourceView,
    ImportIdentitySourceRequest,
    PersonView,
    PrepareDraftsResult,
    ScheduleView,
    SenderProfileView,
    ReviewService,
)
from scripts.prospecting.manager.campaigns import (
    CampaignCreationStatus,
    CampaignError,
    CampaignService,
    SelectedDraftFormatStatus,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.p6_support import migrated_t1_store


CAMPAIGN = "camp_1111111111111111"
PROFILE = "22222222-2222-4222-8222-222222222222"
SAVED_REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ABSENT_REQUEST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
TAMPERED_REQUEST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
_CANONICAL_UUID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
)
REVIEW_FIXTURE = json.loads(
    (Path(__file__).parents[3] / "orgs" / "prospecting" / "fixtures" / "review-synthetic.json")
    .read_text(encoding="utf-8")
)["review_app"]


@dataclass(frozen=True)
class Result:
    campaign_id: str = CAMPAIGN
    created: bool = True
    state: str = "recorded"


class FakeReview:
    def __init__(self) -> None:
        self.seen: list[tuple[str, object]] = []
        self.fail = False
        self.funding = FundingBatchView(
            "awaiting_qualification_factcheck", batch_id="batch_aaaaaaaaaaaaaaaa",
            batch_hash="a" * 64, desired_companies=2, candidate_count=1,
            provisional_match_count=1, provisional_shortfall=1,
            companies=(FundingCompanyView(
                "Synthetic Systems", "provisional_match",
                ("latest_event_eligible_with_current_coverage",),
                "series_b", "2025-05-01",
                (FundingSourceView(
                    "https://funding.example.test/announcement", "issuer",
                    "funding_event", "2026-09-09T04:00:00Z",
                ),),
            ),),
        )

    def _record(self, name: str, value: object = None) -> None:
        if self.fail:
            raise RuntimeError(REVIEW_FIXTURE["private_error_email"])
        self.seen.append((name, value))

    def list_sender_profiles(self):
        self._record("profiles")
        return (SenderProfileView(PROFILE, "Synthetic Sender"),)

    def list_mailboxes(self):
        self._record("mailboxes")
        return ("mailbox-001",)

    def list_campaigns(self):
        self._record("campaigns")
        return (CampaignView(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", CAMPAIGN, "networking",
            "draft", PROFILE, "Synthetic Sender", "mailbox-001",
            "2026-09-09T04:00:00Z", 1, 1, 0, 1, 1, "review_drafts",
        ),)

    def get_campaign(self, campaign_id):
        self._record("campaign", campaign_id)
        return self.list_campaigns()[0]

    def get_funding_review(self, campaign_id):
        self._record("funding", campaign_id)
        return self.funding

    def list_people(self, campaign_id):
        self._record("people", campaign_id)
        return (PersonView(
            "per_1111111111111111", "Taylor Example", "Principal", "Example Co",
            "https://example.test/profile", 88, "eligible", "cp_1111111111111111",
            REVIEW_FIXTURE["contact_email"], "valid", True, "selected",
        ),)

    def list_drafts(self, campaign_id):
        self._record("drafts", campaign_id)
        return (DraftView(
            "per_1111111111111111", "Taylor Example", "rev_1111111111111111",
            "a" * 64, 0, "A short hello", "Synthetic body", (), None, None, None,
            None, (), (), "review_required", "missing", None, None,
        ),)

    def list_schedule(self, campaign_id):
        self._record("schedule", campaign_id)
        return (ScheduleView(
            "del_1111111111111111", "per_1111111111111111", "Taylor Example",
            "rev_1111111111111111", "a" * 64, 0, None, "scheduled", "reserved",
            "mailbox-001", ({"step": 1},), "09:00-17:00", "America/New_York",
            25, 6, 2, "missing", None,
        ),)

    def list_feedback(self, campaign_id):
        self._record("feedback_list", campaign_id)
        return (FeedbackView(
            "fb_1111111111111111", campaign_id, "per_1111111111111111", "Taylor Example",
            "rev_original_11111111", "Original subject", "Original synthetic body", "tone",
            ("warmer",), "Please soften this.", "2026-09-09T04:00:00Z", "ready_to_record",
            "unavailable", "rev_1111111111111111", "A short hello", "Synthetic body", None,
        ),)

    def list_activity(self, campaign_id):
        self._record("activity", campaign_id)
        return (ActivityView("evt_1111111111111111", "2026-09-09T04:00:00Z",
                             "review.edit", "draft_review", "cand_1", "pending_qa"),)

    def edit_draft(self, request):
        self._record("edit", request)
        return Result(state="pending_qa")

    def prepare_drafts(self, campaign_id, step):
        self._record("prepare", (campaign_id, step))
        return PrepareDraftsResult(campaign_id, step, 3, 2, 0, 1, 1, (("evidence_missing", 1),))

    def verify_current_role_source(self, request):
        self._record("verify_source", request)
        return Result(state="source_confirmed")

    def import_current_role_source(self, request):
        self._record("import_source", request)
        return Result(state="source_available")

    def request_feedback(self, request):
        self._record("feedback", request)
        return Result(state="pending")

    def fulfill(self, request):
        self._record("fulfill_feedback", request)
        return Result(state="fulfilled")

    def set_editorial_ready(self, request):
        self._record("ready", request)
        return Result(state="ready")


class FakeCampaigns:
    def __init__(self) -> None:
        self.seen: list[dict[str, object]] = []
        self.creation_seen: list[str] = []

    def create(self, **value):
        self.seen.append(value)
        return Result()

    def creation_status(self, request_id):
        self.creation_seen.append(request_id)
        if _CANONICAL_UUID.fullmatch(request_id) is None:
            raise CampaignError("invalid_request_id")
        if request_id == SAVED_REQUEST:
            return CampaignCreationStatus(request_id, "saved", CAMPAIGN)
        if request_id == TAMPERED_REQUEST:
            raise CampaignError("campaign_state_invalid")
        return CampaignCreationStatus(request_id, "not_found", None)

    def selected_draft_format_status(self, campaign_id):
        if campaign_id != CAMPAIGN:
            raise CampaignError("campaign_missing")
        return SelectedDraftFormatStatus(
            campaign_id, "a" * 64, "b" * 64, "missing", False,
        )

    def configure_selected_draft_format(self, campaign_id, expected_policy_state_hash):
        if campaign_id != CAMPAIGN:
            raise CampaignError("campaign_missing")
        if expected_policy_state_hash != "b" * 64:
            raise CampaignError("policy_state_stale")
        return SelectedDraftFormatStatus(
            campaign_id, "a" * 64, "c" * 64, "configured", True,
        )


class FakeControl:
    def __init__(self) -> None:
        self.seen: list[tuple[str, str]] = []
        self.status_error: Exception | None = None
        self.process_error: Exception | None = None

    def status(self, campaign_id):
        if self.status_error is not None:
            raise self.status_error
        return ControlReviewStatus(
            True, campaign_id, "ctlreq_" + "4" * 32, "ctl_" + "1" * 32,
            "status", "active", None, "not_applicable", "ready", {},
        )

    def process(self, campaign_id, configured_request_id):
        if self.process_error is not None:
            raise self.process_error
        self.seen.append((campaign_id, configured_request_id))
        return ControlReviewStatus(
            True, campaign_id, configured_request_id, "ctl_" + "1" * 32,
            "status", "active", "succeeded", "confirmed", "status",
            {"due": 2, "paused": 0},
        )


class FakeEditorialPipeline:
    def __init__(self) -> None:
        self.seen: list[tuple[str, tuple[object, ...]]] = []
        self.projection_error: PipelineStageError | None = None

    @staticmethod
    def projection(*, state: str = "human_review", decision: str | None = None):
        item = ItemProjection(
            "item_aaaaaaaaaaaaaaaa", CAMPAIGN, "per_1111111111111111",
            "rev_1111111111111111", state,
            None if state == "human_review" else "humanizer", 0,
        )
        proof = CurrentRoleProof(
            CAMPAIGN, "per_1111111111111111", "company_aaaaaaaaaaaaaaaa",
            "employment_aaaaaaaaaaaa", "observation_aaaaaaaaaaa",
            "snapshot_aaaaaaaaaaaaaa", "https://profile.example.test/source",
            "Taylor Example is Principal at Example Co.",
            "2026-09-09T04:00:00+00:00", "2099-09-09T04:00:00+00:00", False,
        )
        return ReviewProjection(
            item, proof, "suggestion_aaaaaaaaaaaa", "Suggested subject",
            "Suggested synthetic body", "a" * 64, decision,
        )

    def get_latest_review_projection(self, campaign_id, revision_id):
        self.seen.append(("latest", (campaign_id, revision_id)))
        if self.projection_error is not None:
            raise self.projection_error
        return self.projection()

    def get_review_projection(self, item_id):
        self.seen.append(("projection", (item_id,)))
        return self.projection()

    def get_item(self, item_id):
        self.seen.append(("item", (item_id,)))
        return self.projection().item

    def start_from_saved_revision(self, campaign_id, revision_id, request_id):
        self.seen.append(("start", (campaign_id, revision_id, request_id)))
        return self.projection(state="awaiting_humanizer_adapter").item

    def accept_suggestion(self, item_id, request_id, revision_id, actor):
        self.seen.append(("accept", (item_id, request_id, revision_id, actor)))
        return AcceptanceResult(
            "decision_aaaaaaaaaaaa", "revision_bbbbbbbbbbbb", "b" * 64, False,
        )

    def reject_suggestion(self, item_id, request_id, revision_id, actor):
        self.seen.append(("reject", (item_id, request_id, revision_id, actor)))
        return RejectionResult("decision_bbbbbbbbbbbb", item_id)

@pytest.fixture
def app():
    clock = [100.0]
    review, campaigns = FakeReview(), FakeCampaigns()
    server = create_server(review, campaigns, port=0, monotonic=lambda: clock[0])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, review, campaigns, clock
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def request(server, method: str, path: str, *, body: bytes | None = None, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=2)
    values = {"Host": server.authority, **(headers or {})}
    connection.request(method, path, body=body, headers=values)
    response = connection.getresponse()
    result = response.status, dict(response.getheaders()), response.read()
    connection.close()
    return result


def bootstrap(server):
    status, bootstrap_headers, bootstrap_body = request(server, "GET", "/bootstrap")
    assert status == 303
    assert bootstrap_headers["Location"] == "/"
    assert bootstrap_body == b""
    cookie = bootstrap_headers["Set-Cookie"].split(";", 1)[0]
    status, _headers, body = request(server, "GET", "/", headers={"Cookie": cookie})
    assert status == 200
    csrf = re.search(rb'<meta name="csrf-token" content="([^"]+)">', body).group(1).decode()
    return cookie, csrf, bootstrap_headers, body


def test_bootstrap_is_one_use_and_session_expires(app) -> None:
    server, _review, _campaigns, clock = app
    status, headers, _body = request(server, "GET", "/")
    assert (status, headers["Location"]) == (303, "/bootstrap")
    cookie, _csrf, headers, body = bootstrap(server)
    assert "HttpOnly" in headers["Set-Cookie"] and "SameSite=Strict" in headers["Set-Cookie"]
    assert headers["Cache-Control"] == "no-store"
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    assert b"Prospecting Review" in body
    assert request(server, "GET", "/bootstrap")[0] == 410
    status, headers, body = request(server, "GET", "/bootstrap", headers={"Cookie": cookie})
    assert (status, headers["Location"], body) == (303, "/", b"")
    assert request(server, "GET", "/", headers={"Cookie": cookie})[0] == 200
    assert request(server, "GET", "/", headers={"Cookie": cookie})[0] == 200
    clock[0] += SESSION_SECONDS + 1
    status, _headers, expired = request(server, "GET", "/", headers={"Cookie": cookie})
    assert status == 401 and b"Restart Prospecting Review" in expired


def test_parallel_loopback_servers_use_port_scoped_cookie_names() -> None:
    first = create_server(FakeReview(), FakeCampaigns(), port=0)
    second = create_server(FakeReview(), FakeCampaigns(), port=0)
    threads = [
        threading.Thread(target=server.serve_forever, daemon=True)
        for server in (first, second)
    ]
    for thread in threads:
        thread.start()
    try:
        first_cookie, _csrf1, _headers1, _body1 = bootstrap(first)
        second_cookie, _csrf2, _headers2, _body2 = bootstrap(second)
        assert first.cookie_name != second.cookie_name
        combined = f"{first_cookie}; {second_cookie}"
        assert request(first, "GET", "/", headers={"Cookie": combined})[0] == 200
        assert request(second, "GET", "/", headers={"Cookie": combined})[0] == 200
    finally:
        for server in (first, second):
            server.shutdown()
            server.server_close()
        for thread in threads:
            thread.join(timeout=2)


def test_snapshot_is_campaign_scoped_and_calls_all_read_owners(app) -> None:
    server, review, _campaigns, _clock = app
    cookie, _csrf, _headers, _body = bootstrap(server)
    status, _headers, raw = request(
        server, "GET", f"/api/review?campaign_id={CAMPAIGN}", headers={"Cookie": cookie}
    )
    value = json.loads(raw)
    assert status == 200
    assert value["campaign"]["campaign_id"] == CAMPAIGN
    assert value["people"][0]["state"] == "selected"
    assert value["drafts"][0]["subject"] == "A short hello"
    assert value["drafts"][0]["evidence"] == []
    assert value["drafts"][0]["candidate_history"] == []
    assert value["feedback"][0]["state"] == "ready_to_record"
    assert value["schedule"][0]["approval_state"] == "missing"
    assert value["activity"][0]["reason"] == "pending_qa"
    assert value["funding"]["state"] == "awaiting_qualification_factcheck"
    assert value["funding"]["companies"][0]["name"] == "Synthetic Systems"
    assert value["funding"]["companies"][0]["sources"][0]["source_kind"] == "issuer"
    assert value["next_action"]["title"] == "Waiting for humanizer and independent review"
    assert value["control"]["code"] == "disabled"
    assert value["mailboxes"] == ["mailbox-001"]
    for method in (
        "campaign", "funding", "people", "drafts", "feedback_list", "schedule", "activity",
    ):
        assert (method, CAMPAIGN) in review.seen


def test_snapshot_keeps_funding_hidden_when_review_service_has_no_pipeline(app) -> None:
    server, review, _campaigns, _clock = app
    review.funding = None
    cookie, _csrf, _headers, _body = bootstrap(server)
    status, _headers, raw = request(
        server, "GET", f"/api/review?campaign_id={CAMPAIGN}", headers={"Cookie": cookie},
    )
    assert status == 200
    assert json.loads(raw)["funding"] is None


def test_funding_banner_acknowledges_capture_without_overriding_draft_work() -> None:
    snapshot = {
        "campaigns": [{"campaign_id": CAMPAIGN}],
        "campaign": {"campaign_id": CAMPAIGN},
        "people": [],
        "drafts": [],
        "pipeline": {"state": "awaiting_research_adapter"},
        "funding": {
            "state": "awaiting_qualification_factcheck", "candidate_count": 2,
        },
    }
    assert review_app._next_action(snapshot) == {
        "title": "Funding evidence captured; factcheck pending",
        "detail": "Captured funding sources are saved. Factual review and person research are still pending.",
        "label": "2 candidates",
    }

    snapshot["drafts"] = [{
        "candidate_state": None, "editorial_state": "review_required",
        "editorial_gate_code": None,
    }]
    assert review_app._next_action(snapshot)["title"] == "Review saved drafts"


def test_funding_banner_is_returned_by_authenticated_snapshot() -> None:
    class FundingOnlyReview(FakeReview):
        def list_people(self, campaign_id):
            self._record("people", campaign_id)
            return ()

        def list_drafts(self, campaign_id):
            self._record("drafts", campaign_id)
            return ()

    review = FundingOnlyReview()
    server = create_server(review, FakeCampaigns(), port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, _csrf, _headers, _body = bootstrap(server)
        status, _headers, raw = request(
            server, "GET", f"/api/review?campaign_id={CAMPAIGN}",
            headers={"Cookie": cookie},
        )
        value = json.loads(raw)
        assert status == 200
        assert value["funding"]["state"] == "awaiting_qualification_factcheck"
        assert value["next_action"] == {
            "title": "Funding evidence captured; factcheck pending",
            "detail": "Captured funding sources are saved. Factual review and person research are still pending.",
            "label": "1 candidate",
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_editorial_projection_and_human_actions_are_scoped_typed_and_csrf_guarded() -> None:
    review, campaigns, editorial = FakeReview(), FakeCampaigns(), FakeEditorialPipeline()
    server = create_server(
        review, campaigns, port=0, editorial_pipeline=editorial,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, csrf, _headers, _body = bootstrap(server)
        status, _headers, raw = request(
            server, "GET", f"/api/review?campaign_id={CAMPAIGN}",
            headers={"Cookie": cookie},
        )
        value = json.loads(raw)
        assert status == 200
        projection = value["editorial_pipeline"][0]
        assert projection["revision_id"] == "rev_1111111111111111"
        assert projection["item"]["campaign_id"] == CAMPAIGN
        assert projection["suggestion_subject"] == "Suggested subject"
        assert projection["source_proof"]["attested"] is False

        headers = {
            "Cookie": cookie, "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
        }
        request_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab"
        start = {
            "request_id": request_id, "campaign_id": CAMPAIGN,
            "revision_id": "rev_1111111111111111",
        }
        status, _headers, raw = request(
            server, "POST", "/api/editorial/start", body=json.dumps(start).encode(),
            headers=headers,
        )
        assert status == 201
        assert json.loads(raw)["state"] == "awaiting_humanizer_adapter"

        action = {
            "request_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "campaign_id": CAMPAIGN, "item_id": "item_aaaaaaaaaaaaaaaa",
            "expected_parent_revision_id": "rev_1111111111111111",
        }
        status, _headers, raw = request(
            server, "POST", "/api/editorial/accept",
            body=json.dumps(action).encode(), headers=headers,
        )
        assert status == 200 and json.loads(raw)["revision_id"] == "revision_bbbbbbbbbbbb"
        action["request_id"] = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        status, _headers, raw = request(
            server, "POST", "/api/editorial/reject",
            body=json.dumps(action).encode(), headers=headers,
        )
        assert status == 200 and json.loads(raw)["item_id"] == "item_aaaaaaaaaaaaaaaa"
        assert ("start", (CAMPAIGN, "rev_1111111111111111", request_id)) in editorial.seen
        assert ("accept", (
            "item_aaaaaaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "rev_1111111111111111", "human:local-review",
        )) in editorial.seen
        assert ("reject", (
            "item_aaaaaaaaaaaaaaaa", "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "rev_1111111111111111", "human:local-review",
        )) in editorial.seen

        action["request_id"] = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        action["campaign_id"] = "camp_bbbbbbbbbbbbbbbb"
        before = len([name for name, _args in editorial.seen if name == "accept"])
        status, _headers, raw = request(
            server, "POST", "/api/editorial/accept",
            body=json.dumps(action).encode(), headers=headers,
        )
        assert status == 409 and json.loads(raw) == {"error": "revision_conflict"}
        assert len([name for name, _args in editorial.seen if name == "accept"]) == before
        action["actor"] = "human:browser-supplied"
        status, _headers, raw = request(
            server, "POST", "/api/editorial/accept",
            body=json.dumps(action).encode(), headers=headers,
        )
        assert status == 422 and json.loads(raw) == {"error": "request_schema"}
        assert len([name for name, _args in editorial.seen if name == "accept"]) == before
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_editorial_projection_failure_is_fixed_and_does_not_hide_local_draft() -> None:
    review, campaigns, editorial = FakeReview(), FakeCampaigns(), FakeEditorialPipeline()
    editorial.projection_error = PipelineStageError("store_state_invalid")
    server = create_server(
        review, campaigns, port=0, editorial_pipeline=editorial,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, _csrf, _headers, _body = bootstrap(server)
        status, _headers, raw = request(
            server, "GET", f"/api/review?campaign_id={CAMPAIGN}",
            headers={"Cookie": cookie},
        )
        value = json.loads(raw)
        assert status == 200 and value["drafts"][0]["subject"] == "A short hello"
        assert value["editorial_pipeline"] == [{
            "revision_id": "rev_1111111111111111",
            "state": "unavailable", "code": "store_state_invalid",
        }]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_editorial_http_exact_retry_does_not_revalidate_expired_source_before_replay() -> None:
    replay_id = "ffffffff-ffff-4fff-8fff-ffffffffffff"

    class ReplayEditorial(FakeEditorialPipeline):
        def get_review_projection(self, _item_id):
            raise AssertionError("live_projection_must_not_precede_action_replay")

        def accept_suggestion(self, item_id, request_id, revision_id, actor):
            self.seen.append(("accept", (item_id, request_id, revision_id, actor)))
            if request_id != replay_id:
                raise PipelineStageError("current_role_proof_invalid")
            return AcceptanceResult(
                "decision_aaaaaaaaaaaa", "revision_bbbbbbbbbbbb", "b" * 64,
                False, True,
            )

    editorial = ReplayEditorial()
    server = create_server(
        FakeReview(), FakeCampaigns(), port=0, editorial_pipeline=editorial,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, csrf, _headers, _body = bootstrap(server)
        headers = {
            "Cookie": cookie, "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
        }
        payload = {
            "request_id": replay_id, "campaign_id": CAMPAIGN,
            "item_id": "item_aaaaaaaaaaaaaaaa",
            "expected_parent_revision_id": "rev_1111111111111111",
        }
        status, _headers, raw = request(
            server, "POST", "/api/editorial/accept",
            body=json.dumps(payload).encode(), headers=headers,
        )
        assert status == 200
        assert json.loads(raw)["replayed"] is True
        payload["request_id"] = "abababab-abab-4aba-8aba-abababababab"
        status, _headers, raw = request(
            server, "POST", "/api/editorial/accept",
            body=json.dumps(payload).encode(), headers=headers,
        )
        assert status == 422
        assert json.loads(raw) == {"error": "current_role_proof_invalid"}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_actual_http_restart_from_changed_human_edit_after_exhaustion(tmp_path) -> None:
    from scripts.prospecting.tests.test_pipeline_stage_service import (
        _adapters, _clock, _exhaust, _seed,
    )
    from scripts.prospecting.tests.test_review_service import ASK, NOW, POINT

    seeded, revision = _seed(tmp_path)
    stage = PipelineStageService(seeded, adapters=_adapters(critic="repair"), now=_clock)
    exhausted = stage.start_from_saved_revision(
        "campaign-a", revision.revision_id, "start-request",
    )
    _exhaust(stage, exhausted.item_id, "http")
    seeded.close()
    database = tmp_path / "pipeline-stage.sqlite"
    ready: Queue[object] = Queue()

    def run() -> None:
        connection = open_store(database)
        server = create_server(
            ReviewService(connection, now=lambda: NOW), CampaignService(connection), port=0,
            editorial_pipeline=PipelineStageService(connection, now=_clock),
        )
        ready.put(server)
        try:
            server.serve_forever()
        finally:
            server.server_close()
            connection.close()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    server = ready.get(timeout=5)
    try:
        cookie, csrf, _headers, _body = bootstrap(server)
        headers = {
            "Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf,
        }

        def post(path: str, value: dict[str, object]):
            status, _headers, raw = request(
                server, "POST", path, body=json.dumps(value).encode(), headers=headers,
            )
            return status, json.loads(raw)

        def editorial_for(revision_id: str) -> list[object]:
            status, _headers, raw = request(
                server, "GET", "/api/review?campaign_id=campaign-a",
                headers={"Cookie": cookie},
            )
            assert status == 200
            return [
                value for value in json.loads(raw)["editorial_pipeline"]
                if value["revision_id"] == revision_id
            ]

        status, edited = post("/api/drafts/edit", {
            "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21", "campaign_id": "campaign-a",
            "expected_revision_id": revision.revision_id,
            "subject": "Revised synthetic subject",
            "body": f"Hello. {POINT}. This human edit reframes the synthetic evidence. {ASK}",
        })
        assert status == 200 and edited["state"] == "revision_created"
        assert editorial_for(edited["revision_id"]) == [{
            "revision_id": edited["revision_id"], "exhausted_item_id": exhausted.item_id,
            "state": "restart_available", "code": None,
        }]

        start = {
            "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22", "campaign_id": "campaign-a",
            "revision_id": edited["revision_id"], "exhausted_item_id": exhausted.item_id,
        }
        status, created = post("/api/editorial/start", start)
        assert status == 201
        assert (created["base_revision_id"], created["state"], created["repair_cycle"]) == (
            edited["revision_id"], "awaiting_humanizer_adapter", 0,
        )
        assert post("/api/editorial/start", start) == (201, created)
        assert post("/api/editorial/start", {
            **start, "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa23",
            "actor": "human:browser-supplied",
        }) == (422, {"error": "request_schema"})
        assert post("/api/editorial/start", {
            **start, "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa24",
        }) == (409, {"error": "pipeline_work_conflict"})
        assert post("/api/editorial/start", {
            **start, "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa25",
            "revision_id": revision.revision_id,
        }) == (422, {"error": "revision_not_current"})
        projection = editorial_for(edited["revision_id"])
        assert [value["item"]["item_id"] for value in projection] == [created["item_id"]]
    finally:
        server.shutdown()
        thread.join(timeout=5)

    verify = open_store(database)
    try:
        assert [tuple(row) for row in verify.execute(
            "SELECT actor,exhausted_item_id,edited_revision_id FROM prospecting_pipeline_reset"
        )] == [("human:local-review", exhausted.item_id, edited["revision_id"])]
        assert verify.execute("SELECT count(*) FROM draft_editorial_event").fetchone()[0] == 0
        assert verify.execute("SELECT count(*) FROM approval").fetchone()[0] == 0
    finally:
        verify.close()


def test_control_status_and_process_are_scoped_typed_and_csrf_guarded() -> None:
    review, campaigns, control = FakeReview(), FakeCampaigns(), FakeControl()
    server = create_server(review, campaigns, port=0, control=control)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, csrf, _headers, _body = bootstrap(server)
        status, _headers, raw = request(
            server, "GET", f"/api/review?campaign_id={CAMPAIGN}",
            headers={"Cookie": cookie},
        )
        value = json.loads(raw)
        assert status == 200
        assert value["control"]["configured_request_id"] == "ctlreq_" + "4" * 32
        assert value["control"]["code"] == "ready"

        payload = json.dumps({
            "campaign_id": CAMPAIGN,
            "configured_request_id": "ctlreq_" + "4" * 32,
        }).encode()
        assert request(
            server, "POST", "/api/control/process", body=payload,
            headers={"Cookie": cookie, "Content-Type": "application/json"},
        )[0] == 403
        status, _headers, raw = request(
            server, "POST", "/api/control/process", body=payload,
            headers={
                "Cookie": cookie, "Content-Type": "application/json",
                "X-CSRF-Token": csrf,
            },
        )
        assert status == 200
        assert json.loads(raw)["remote_acknowledgement"] == "confirmed"
        assert control.seen == [(CAMPAIGN, "ctlreq_" + "4" * 32)]

        invalid = json.dumps({
            "campaign_id": CAMPAIGN,
            "configured_request_id": "ctlreq_" + "4" * 32,
            "host": "forbidden",
        }).encode()
        assert request(
            server, "POST", "/api/control/process", body=invalid,
            headers={
                "Cookie": cookie, "Content-Type": "application/json",
                "X-CSRF-Token": csrf,
            },
        )[0] == 422
        assert len(control.seen) == 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_control_failures_stay_inside_control_surface() -> None:
    review, campaigns, control = FakeReview(), FakeCampaigns(), FakeControl()
    control.status_error = RuntimeError("private transport detail")
    server = create_server(review, campaigns, port=0, control=control)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, csrf, _headers, _body = bootstrap(server)
        status, _headers, raw = request(
            server, "GET", f"/api/review?campaign_id={CAMPAIGN}",
            headers={"Cookie": cookie},
        )
        value = json.loads(raw)
        assert status == 200 and value["campaign"]["campaign_id"] == CAMPAIGN
        assert value["control"] == {
            "enabled": False, "campaign_id": CAMPAIGN,
            "code": "control_status_unavailable",
        }

        control.process_error = ControlError("transport_failed")
        payload = json.dumps({
            "campaign_id": CAMPAIGN,
            "configured_request_id": "ctlreq_" + "4" * 32,
        }).encode()
        status, _headers, raw = request(
            server, "POST", "/api/control/process", body=payload,
            headers={
                "Cookie": cookie, "Content-Type": "application/json",
                "X-CSRF-Token": csrf,
            },
        )
        assert status == 422 and json.loads(raw) == {"error": "transport_failed"}
        assert b"private transport detail" not in raw
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_real_composed_services_must_share_the_selected_store(tmp_path) -> None:
    selected = migrated_t1_store(tmp_path / "selected.sqlite", tier="T0")
    other = migrated_t1_store(tmp_path / "other.sqlite", tier="T0")
    review = ReviewService(selected.connection)

    with pytest.raises(ValueError, match="^feedback_store_mismatch$"):
        create_server(
            review, FakeCampaigns(), feedback=FeedbackService(other.connection),
        )
    with pytest.raises(ValueError, match="^control_store_mismatch$"):
        create_server(
            review, FakeCampaigns(), control=ControlReviewAdapter(other.connection),
        )
    with pytest.raises(ValueError, match="^editorial_pipeline_store_mismatch$"):
        create_server(
            review, FakeCampaigns(),
            editorial_pipeline=PipelineStageService(other.connection),
        )


def test_exact_host_session_csrf_and_body_bound_precede_mutation(app) -> None:
    server, _review, campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    payload = json.dumps({
        "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "brief_text": "intent:networking",
        "sender_profile_id": PROFILE,
        "mailbox_id": "mailbox-001",
    }).encode()
    assert request(server, "GET", "/api/review", headers={"Host": "evil.test", "Cookie": cookie})[0] == 400
    assert request(server, "POST", "/api/campaigns", body=payload, headers={
        "Cookie": cookie, "Content-Type": "application/json",
    })[0] == 403
    assert not campaigns.seen
    status, _headers, _body = request(server, "POST", "/api/campaigns", body=payload, headers={
        "Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf,
        "Origin": f"http://{server.authority}",
    })
    assert status == 201 and campaigns.seen[0]["brief_text"] == "intent:networking"
    assert campaigns.seen[0]["require_first_draft_compatible"] is True
    status, _headers, raw = request(server, "POST", "/api/campaigns", body=b"", headers={
        "Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf,
        "Content-Length": str(MAX_JSON_BYTES + 1),
    })
    assert status == 413 and json.loads(raw) == {"error": "request_too_large"}


def test_campaign_http_refuses_duplicate_brief_fields_and_allows_corrected_retry(
    tmp_path: Path,
) -> None:
    from scripts.prospecting.tests.test_campaigns import MAILBOX_ID, REQUEST_ONE, _profile

    database = tmp_path / "duplicate-brief.sqlite"
    seeded = open_store(database)
    _profile(seeded, PROFILE)
    seeded.commit()
    seeded.close()
    connection = sqlite3.connect(database, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    server = create_server(
        ReviewService(connection),
        CampaignService(connection, campaign_id_factory=lambda: CAMPAIGN),
        port=0,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, csrf, _headers, _body = bootstrap(server)
        headers = {
            "Cookie": cookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
        }

        def post(brief_text: str) -> tuple[int, dict[str, object]]:
            payload = json.dumps({
                "request_id": REQUEST_ONE,
                "brief_text": brief_text,
                "sender_profile_id": PROFILE,
                "mailbox_id": MAILBOX_ID,
            }).encode()
            status, _response_headers, raw = request(
                server, "POST", "/api/campaigns", body=payload, headers=headers,
            )
            return status, json.loads(raw)

        assert post(
            "intent:networking people-count:20 people-count:8 "
            "ask:informational_call minutes:15"
        ) == (422, {"error": "duplicate_brief_field"})
        assert connection.execute("SELECT count(*) FROM campaign").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM campaign_brief").fetchone()[0] == 0
        assert connection.in_transaction is False

        status, body = post(
            "intent:networking people-count:8 ask:informational_call minutes:15\n"
            "path: synthetic operations work\n"
            "must: synthetic operating experience"
        )
        assert status == 201
        assert body == {"campaign_id": CAMPAIGN, "created": True}
        assert connection.execute("SELECT count(*) FROM campaign").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM campaign_brief").fetchone()[0] == 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        connection.close()


def test_feedback_converts_json_tags_to_typed_tuple(app) -> None:
    server, review, _campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    payload = json.dumps({
        "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "campaign_id": CAMPAIGN,
        "expected_revision_id": "rev_1111111111111111",
        "disposition": "tone", "tags": ["warmer"], "text": "Please soften this.",
    }).encode()
    status, _headers, _body = request(server, "POST", "/api/drafts/feedback", body=payload, headers={
        "Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf,
    })
    assert status == 202
    sent = next(value for name, value in review.seen if name == "feedback")
    assert isinstance(sent, FeedbackRequest) and sent.tags == ("warmer",)


def test_feedback_fulfillment_is_explicit_typed_and_csrf_guarded(app) -> None:
    server, review, _campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    payload = json.dumps({
        "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "campaign_id": CAMPAIGN,
        "feedback_id": "fb_1111111111111111",
        "expected_child_revision_id": "rev_1111111111111111",
    }).encode()
    assert request(server, "POST", "/api/feedback/fulfill", body=payload, headers={
        "Cookie": cookie, "Content-Type": "application/json",
    })[0] == 403
    status, _headers, _body = request(
        server, "POST", "/api/feedback/fulfill", body=payload,
        headers={"Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf},
    )
    assert status == 200
    sent = next(value for name, value in review.seen if name == "fulfill_feedback")
    assert isinstance(sent, FulfillFeedbackRequest)
    assert sent.expected_child_revision_id == "rev_1111111111111111"


def test_source_upload_has_closed_shape_csrf_and_route_only_body_cap(app) -> None:
    server, review, _campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    headers = {
        "Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf,
    }
    body = "\n" * MAX_SOURCE_BYTES
    payload = json.dumps({
        "campaign_id": CAMPAIGN, "person_id": "per_1111111111111111",
        "source_url": "https://profile.example.test/source", "body": body,
    }).encode()
    status, _headers, _body = request(
        server, "POST", "/api/people/import-source", body=payload, headers=headers,
    )
    assert status == 200
    assert len(payload) > 2 * MAX_SOURCE_BYTES
    sent = next(value for name, value in review.seen if name == "import_source")
    assert isinstance(sent, ImportIdentitySourceRequest) and sent.body == body
    assert request(
        server, "POST", "/api/people/import-source", body=b"",
        headers={**headers, "Content-Length": str(MAX_SOURCE_UPLOAD_JSON_BYTES + 1)},
    )[0] == 413


def test_edit_forwards_the_expected_candidate_token(app) -> None:
    server, review, _campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    payload = json.dumps({
        "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "campaign_id": CAMPAIGN,
        "expected_revision_id": "rev_1111111111111111",
        "expected_candidate_id": "cand_1111111111111111",
        "subject": "Updated subject", "body": "Updated synthetic body",
    }).encode()
    status, _headers, _body = request(server, "POST", "/api/drafts/edit", body=payload, headers={
        "Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf,
    })
    assert status == 200
    sent = next(value for name, value in review.seen if name == "edit")
    assert sent.expected_candidate_id == "cand_1111111111111111"


def test_prepare_drafts_accepts_only_campaign_and_literal_step_zero(app) -> None:
    server, review, _campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    payload = {"campaign_id": CAMPAIGN, "step": 0}

    status, _headers, raw = request(server, "POST", "/api/drafts/prepare", body=json.dumps(payload).encode(), headers={
        "Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf,
    })
    assert status == 200
    assert json.loads(raw)["revisions_created"] == 2
    assert ("prepare", (CAMPAIGN, 0)) in review.seen

    for invalid in ({"campaign_id": CAMPAIGN, "step": True}, {"campaign_id": CAMPAIGN, "step": 1}):
        status, _headers, raw = request(server, "POST", "/api/drafts/prepare", body=json.dumps(invalid).encode(), headers={
            "Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf,
        })
        assert status == 422 and json.loads(raw) == {"error": "request_schema"}
    assert [name for name, _value in review.seen].count("prepare") == 1


def test_actual_prepare_http_creates_proof_pending_draft_without_contact_then_attests(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from scripts.prospecting.tests.test_affinity_templates_v2 import (
        NOW as TEMPLATE_NOW,
        _draft_ready_fixture,
        _import_current_role_proof,
    )

    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    _import_current_role_proof(connection, person_id)
    connection.execute("DELETE FROM contact_point WHERE person_id=?", (person_id,))
    connection.execute(
        "UPDATE fill_firm SET status='no_confident_email' WHERE campaign_id=?",
        (campaign_id,),
    )
    connection.commit()
    database_path = Path(connection.execute("PRAGMA database_list").fetchone()[2])
    connection.close()
    connection = sqlite3.connect(database_path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    service = ReviewService(
        connection, now=lambda: TEMPLATE_NOW.isoformat(),
        prepare_adapter=lambda selected, step: draft_step_zero_proof_pending(
            connection, selected, anchors=object(), now=TEMPLATE_NOW,
        ),
        source_verifier=lambda proof: verify_snapshot(
            tmp_path / "snapshots", proof, now=TEMPLATE_NOW,
        ),
    )
    server = create_server(
        service, FakeCampaigns(), port=0,
        pipeline=object(), editorial_pipeline=object(),
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, csrf, _headers, _body = bootstrap(server)
        headers = {
            "Cookie": cookie, "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
        }
        status, _headers, raw = request(
            server, "POST", "/api/drafts/prepare",
            body=json.dumps({"campaign_id": campaign_id, "step": 0}).encode(),
            headers=headers,
        )
        assert status == 200 and json.loads(raw)["revisions_created"] == 1
        pending = service.list_drafts(campaign_id)[0]
        assert pending.identity_source_state == "confirmation_required"
        assert pending.contact_state == "missing"
        assert pending.identity_source is not None
        before = (pending.revision_id, pending.revision_hash, pending.subject, pending.body)
        payload = {
            "request_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            "campaign_id": campaign_id, "person_id": person_id,
            "expected_observation_id": pending.current_observation_id,
            "observation_id": pending.identity_source.observation_id,
            "attested": True,
        }
        status, _headers, raw = request(
            server, "POST", "/api/people/verify-source",
            body=json.dumps(payload).encode(), headers=headers,
        )
        assert status == 200 and json.loads(raw)["state"] == "source_confirmed"
        confirmed = service.list_drafts(campaign_id)[0]
        assert (confirmed.revision_id, confirmed.revision_hash,
                confirmed.subject, confirmed.body) == before
        assert confirmed.identity_source_state == "source_ready"
        assert confirmed.contact_state == "missing"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_current_role_source_post_requires_closed_attestation_shape(app) -> None:
    server, review, _campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    payload = {
        "request_id": "00000000-0000-4000-8000-000000000011",
        "campaign_id": CAMPAIGN, "person_id": "per_1111111111111111",
        "expected_observation_id": "obs_old", "observation_id": "obs_new", "attested": True,
    }
    status, _headers, raw = request(
        server, "POST", "/api/people/verify-source", body=json.dumps(payload).encode(),
        headers={"Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf},
    )
    assert status == 200 and json.loads(raw)["state"] == "source_confirmed"
    sent = next(value for name, value in review.seen if name == "verify_source")
    assert sent.attested is True and sent.observation_id == "obs_new"
    payload["path"] = "forbidden"
    status, _headers, raw = request(
        server, "POST", "/api/people/verify-source", body=json.dumps(payload).encode(),
        headers={"Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf},
    )
    assert status == 422 and json.loads(raw) == {"error": "request_schema"}


def test_raw_service_failures_are_replaced_by_a_fixed_error(app) -> None:
    server, review, _campaigns, _clock = app
    cookie, _csrf, _headers, _body = bootstrap(server)
    review.fail = True
    status, _headers, raw = request(server, "GET", "/api/review", headers={"Cookie": cookie})
    assert status == 500
    assert json.loads(raw) == {"error": "internal_error"}
    assert REVIEW_FIXTURE["private_error_email"].encode() not in raw


def test_bundled_interface_has_five_views_and_no_external_assets() -> None:
    html = Path(__file__).parents[1].joinpath("review_app.html").read_text(encoding="utf-8")
    for label in ("Campaigns", "People", "Drafts", "Schedule", "Activity"):
        assert f'data-view="{label.lower()}"' in html
    assert not re.search(r"(?:src|href)=[\"']https?://", html)
    assert re.search(
        r'<input\b(?=[^>]*\bid="requestId")(?=[^>]*\bname="request_id")'
        r'(?=[^>]*\btype="hidden")[^>]*>',
        html,
    )
    assert "/api/people/select" not in html
    assert "No messages are scheduled" in html
    assert "Saved edit history" in html
    ask = re.search(
        r'<select\b(?=[^>]*\bid="conversationAsk")[^>]*>(.*?)</select>',
        html,
        re.DOTALL,
    )
    assert ask is not None
    assert re.fullmatch(
        r'\s*<option\b(?=[^>]*\bvalue="informational_call")[^>]*>'
        r'\s*Informational call\s*</option>\s*',
        ask.group(1),
        re.DOTALL,
    )
    assert re.search(
        r'<input\b(?=[^>]*\bid="minutes")(?=[^>]*\btype="number")'
        r'(?=[^>]*\bmin="10")(?=[^>]*\bmax="20")'
        r'(?=[^>]*\bvalue="15")(?=[^>]*\brequired\b)[^>]*>',
        html,
    )
    assert "ask_type_unsupported" in html and "ask_minutes_unsupported" in html
    assert "I confirm this source shows" in html
    assert "/api/people/verify-source" in html


def test_custom_store_context_never_uses_ambient_anchor_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    ambient = tmp_path / "ambient"
    custom = tmp_path / "synthetic" / "review.sqlite"
    monkeypatch.setenv("LOCALAPPDATA", str(ambient))

    database, anchors = _selected_store_context(custom)
    assert database == custom.absolute()
    assert anchors == custom.parent.absolute() / "sender-anchors.json"
    assert ambient not in anchors.parents

    default_database, default_anchors = _selected_store_context(None)
    assert default_database == (ambient / "kb-prospecting" / "store.sqlite").absolute()
    assert default_anchors == default_database.parent / "sender-anchors.json"


def test_draft_preparer_loads_only_selected_sibling_anchors_with_aware_utc(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = object()
    anchors_file = tmp_path / "selected" / "sender-anchors.json"
    anchors = object()
    summary = object()
    captured = {}
    monkeypatch.setattr(review_app, "load_anchors", lambda path: anchors if path == anchors_file else None)

    def draft(owner, campaign_id, *, anchors: object, now):
        captured.update(owner=owner, campaign_id=campaign_id, anchors=anchors, now=now)
        return summary

    monkeypatch.setattr(review_app, "draft_step_zero_proof_pending", draft)
    assert _draft_preparer(connection, anchors_file)(CAMPAIGN, 0) is summary
    assert captured == {
        "owner": connection, "campaign_id": CAMPAIGN,
        "anchors": anchors, "now": captured["now"],
    }
    assert captured["now"].tzinfo is not None and captured["now"].utcoffset().total_seconds() == 0


def test_draft_preparer_maps_anchor_details_to_a_fixed_blocker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(_path):
        raise ValueError("C:/private/sender-anchors.json")

    monkeypatch.setattr(review_app, "load_anchors", fail)
    with pytest.raises(ValueError, match="^sender_anchors_missing$"):
        _draft_preparer(object(), tmp_path / "sender-anchors.json")(CAMPAIGN, 0)


def test_selected_draft_format_http_is_csrf_bound_and_metadata_only(app) -> None:
    server, _review, _campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    headers = {"Cookie": cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf}
    status, _headers, raw = request(
        server, "GET", f"/api/campaigns/{CAMPAIGN}/selected-draft-format",
        headers={"Cookie": cookie},
    )
    assert status == 200
    assert json.loads(raw) == {
        "campaign_id": CAMPAIGN, "policy_hash": "a" * 64,
        "policy_state_hash": "b" * 64, "state": "missing", "changed": False,
    }
    payload = {"campaign_id": CAMPAIGN, "expected_policy_state_hash": "b" * 64}
    status, _headers, raw = request(
        server, "POST", f"/api/campaigns/{CAMPAIGN}/selected-draft-format",
        body=json.dumps(payload).encode(), headers={"Cookie": cookie, "Content-Type": "application/json"},
    )
    assert (status, json.loads(raw)) == (403, {"error": "csrf_invalid"})
    status, _headers, raw = request(
        server, "POST", f"/api/campaigns/{CAMPAIGN}/selected-draft-format",
        body=json.dumps(payload).encode(), headers=headers,
    )
    assert (status, json.loads(raw)["state"], json.loads(raw)["changed"]) == (200, "configured", True)
    status, _headers, raw = request(
        server, "POST", f"/api/campaigns/{CAMPAIGN}/selected-draft-format",
        body=json.dumps({**payload, "expected_policy_state_hash": "d" * 64}).encode(), headers=headers,
    )
    assert (status, json.loads(raw)) == (422, {"error": "policy_state_stale"})


def test_review_snapshot_isolates_legacy_selected_format_unavailability(tmp_path: Path) -> None:
    seeded = migrated_t1_store(tmp_path / "legacy.sqlite", tier="T0")
    database = Path(seeded.connection.execute("PRAGMA database_list").fetchone()[2])
    seeded.connection.close()
    connection = sqlite3.connect(database, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    server = create_server(ReviewService(connection), CampaignService(connection), port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, _csrf, _headers, _body = bootstrap(server)
        status, _headers, raw = request(
            server, "GET", "/api/review?campaign_id=camp_0000000000000001",
            headers={"Cookie": cookie},
        )
        snapshot = json.loads(raw)
        assert status == 200
        assert snapshot["campaign"]["campaign_id"] == "camp_0000000000000001"
        assert snapshot["selected_draft_format"] == {
            "campaign_id": "camp_0000000000000001",
            "state": "unavailable", "code": "campaign_missing",
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        connection.close()


def test_review_snapshot_exposes_malformed_selected_format_as_unavailable(tmp_path: Path) -> None:
    from scripts.prospecting.tests.test_campaigns import BRIEF, MAILBOX_ID, _profile

    database = tmp_path / "malformed.sqlite"
    seeded = open_store(database)
    _profile(seeded, PROFILE)
    CampaignService(
        seeded, campaign_id_factory=lambda: CAMPAIGN,
    ).create(
        request_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", brief_text=BRIEF,
        sender_profile_id=PROFILE, mailbox_id=MAILBOX_ID,
        require_first_draft_compatible=True,
    )
    policy = json.loads(seeded.execute(
        "SELECT policy_json FROM campaign WHERE campaign_id=?", (CAMPAIGN,),
    ).fetchone()[0])
    policy["copy_profile"] = {"body_words": [75.0, 125], "subject_chars": [36, 50]}
    seeded.execute(
        "UPDATE campaign SET policy_json=? WHERE campaign_id=?",
        (json.dumps(policy, sort_keys=True, separators=(",", ":")), CAMPAIGN),
    )
    seeded.commit()
    seeded.close()
    connection = sqlite3.connect(database, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    server = create_server(ReviewService(connection), CampaignService(connection), port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, _csrf, _headers, _body = bootstrap(server)
        status, _headers, raw = request(
            server, "GET", f"/api/review?campaign_id={CAMPAIGN}", headers={"Cookie": cookie},
        )
        snapshot = json.loads(raw)
        assert status == 200 and snapshot["campaign"]["campaign_id"] == CAMPAIGN
        assert snapshot["selected_draft_format"] == {
            "campaign_id": CAMPAIGN, "state": "unavailable", "code": "campaign_state_invalid",
        }
        assert "people" in snapshot and "drafts" in snapshot
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        connection.close()


def test_review_snapshot_hides_synthetic_sqlite_driver_detail_on_selected_draft_format_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    seeded = migrated_t1_store(tmp_path / "driver-error.sqlite", tier="T0")
    database = Path(seeded.connection.execute("PRAGMA database_list").fetchone()[2])
    seeded.connection.close()
    connection = sqlite3.connect(database, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    campaigns = CampaignService(connection)
    sentinel = "synthetic-private-looking-sqlite-detail-9f3c2a"

    def _raise(_campaign_id):
        raise sqlite3.OperationalError(sentinel)

    monkeypatch.setattr(campaigns, "selected_draft_format_status", _raise)
    server = create_server(ReviewService(connection), campaigns, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, _csrf, _headers, _body = bootstrap(server)
        status, _headers, raw = request(
            server, "GET", "/api/review?campaign_id=camp_0000000000000001",
            headers={"Cookie": cookie},
        )
        assert status == 200
        assert sentinel.encode() not in raw
        snapshot = json.loads(raw)
        assert snapshot["campaign"]["campaign_id"] == "camp_0000000000000001"
        assert snapshot["selected_draft_format"] == {
            "campaign_id": "camp_0000000000000001",
            "state": "unavailable", "code": "selected_draft_format_unavailable",
        }
        assert "people" in snapshot and "drafts" in snapshot and "schedule" in snapshot
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        connection.close()


_DRAIN_SLACK_SECONDS = 2.0


def _open_raw(server) -> socket.socket:
    sock = socket.create_connection(("127.0.0.1", server.server_address[1]), timeout=5)
    sock.settimeout(5)
    return sock


def _send_request_head(server, sock, path: str, headers: list[tuple[str, str]]) -> None:
    """Send the request line and headers only, deliberately withholding the body."""
    lines = [f"POST {path} HTTP/1.1", f"Host: {server.authority}"]
    lines += [f"{key}: {value}" for key, value in headers]
    sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("ascii"))


def _read_response(sock) -> tuple[int, dict[str, str], bytes]:
    buffer = b""
    while b"\r\n\r\n" not in buffer:
        chunk = sock.recv(4096)
        assert chunk, "connection ended before the refusal headers were readable"
        buffer += chunk
    head, _, body = buffer.partition(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    status = int(lines[0].split(" ")[1])
    headers = {}
    for line in lines[1:]:
        key, _, value = line.partition(":")
        headers[key.strip().lower()] = value.strip()
    length = int(headers.get("content-length", "0"))
    while len(body) < length:
        chunk = sock.recv(4096)
        assert chunk, "connection ended before the refusal body was readable"
        body += chunk
    # Anything already buffered past the declared length is a second response
    # appended to this one -- coalesced by the transport, or by a future
    # regression -- and must never be silently discarded by truncation.
    assert body[length:] == b"", "trailing bytes after the declared refusal body"
    return status, headers, body[:length]


def _read_to_eof(sock) -> bytes:
    # A clean end of stream is the point of the repair: a connection reset here
    # (ConnectionResetError / WinError 10053) is exactly the failure being fixed.
    trailing = b""
    while True:
        chunk = sock.recv(4096)
        if not chunk:
            return trailing
        trailing += chunk


def _campaign_payload() -> bytes:
    return json.dumps({
        "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "brief_text": "intent:networking",
        "sender_profile_id": PROFILE,
        "mailbox_id": "mailbox-001",
    }).encode()


def test_refused_post_takes_its_declared_body_after_the_response_and_closes_cleanly(app) -> None:
    """The body is released only after the whole refusal has been read.

    This is the deterministic form of the race: no sleep is used, the client
    simply withholds the body until the entire 403 has arrived.  The server must
    still consume that body before closing, because closing with unread bytes
    queued can abort the connection and destroy a response the peer has not read.
    """
    server, _review, campaigns, _clock = app
    cookie, _csrf, _headers, _body = bootstrap(server)
    payload = _campaign_payload()
    sock = _open_raw(server)
    try:
        _send_request_head(server, sock, "/api/campaigns", [
            ("Cookie", cookie),
            ("Content-Type", "application/json"),
            ("X-CSRF-Token", "not-the-issued-token"),
            ("Content-Length", str(len(payload))),
        ])
        status, headers, body = _read_response(sock)
        assert (status, json.loads(body)) == (403, {"error": "csrf_invalid"})
        assert headers["connection"] == "close"
        sock.sendall(payload)
        assert _read_to_eof(sock) == b""
    finally:
        sock.close()
    assert campaigns.seen == []


def test_refused_post_with_a_partial_body_stays_inside_the_drain_deadline(app) -> None:
    server, _review, campaigns, _clock = app
    cookie, _csrf, _headers, _body = bootstrap(server)
    payload = _campaign_payload()
    sock = _open_raw(server)
    try:
        _send_request_head(server, sock, "/api/campaigns", [
            ("Cookie", cookie),
            ("Content-Type", "application/json"),
            ("X-CSRF-Token", "not-the-issued-token"),
            ("Content-Length", str(len(payload))),
        ])
        # Within the route cap, but the remainder never arrives.
        sock.sendall(payload[: len(payload) // 2])
        status, _headers, body = _read_response(sock)
        assert (status, json.loads(body)) == (403, {"error": "csrf_invalid"})
        started = time.monotonic()
        assert _read_to_eof(sock) == b""
        # One absolute deadline that is never extended: the wait for the missing
        # remainder ends far inside the five-second per-request socket timeout.
        assert time.monotonic() - started < _DRAIN_SLACK_SECONDS
        assert MAX_REFUSAL_DRAIN_SECONDS <= 0.25
    finally:
        sock.close()
    assert campaigns.seen == []


def test_oversized_declared_body_is_refused_immediately_and_never_drained(app) -> None:
    server, _review, campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    sock = _open_raw(server)
    try:
        _send_request_head(server, sock, "/api/campaigns", [
            ("Cookie", cookie),
            ("Content-Type", "application/json"),
            ("X-CSRF-Token", csrf),
            ("Content-Length", str(MAX_JSON_BYTES + 1)),
        ])
        started = time.monotonic()
        status, _headers, body = _read_response(sock)
        assert (status, json.loads(body)) == (413, {"error": "request_too_large"})
        # No body byte is ever sent, and none is waited for.
        assert _read_to_eof(sock) == b""
        assert time.monotonic() - started < _DRAIN_SLACK_SECONDS
    finally:
        sock.close()
    assert campaigns.seen == []


def test_ambiguous_or_unsupported_framing_refusals_never_wait_for_a_body(app) -> None:
    server, _review, campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    cases = (
        ([("X-CSRF-Token", csrf), ("Transfer-Encoding", "chunked"),
          ("Content-Length", "24")], (400, {"error": "request_framing"})),
        ([("X-CSRF-Token", "not-the-issued-token"),
          ("Transfer-Encoding", "chunked"), ("Content-Length", "24")],
         (403, {"error": "csrf_invalid"})),
        ([("X-CSRF-Token", "not-the-issued-token"), ("Content-Length", "24"),
          ("Content-Length", "25")], (403, {"error": "csrf_invalid"})),
        ([("X-CSRF-Token", csrf), ("Content-Length", "24"),
          ("Expect", "100-continue")], (417, {"error": "request_framing"})),
    )
    for extra, expected in cases:
        sock = _open_raw(server)
        try:
            _send_request_head(server, sock, "/api/campaigns", [
                ("Cookie", cookie), ("Content-Type", "application/json"), *extra,
            ])
            started = time.monotonic()
            status, _response_headers, body = _read_response(sock)
            assert (status, json.loads(body)) == expected
            # Framing this boundary does not interpret is never drained, so the
            # refusal is not held waiting for bytes that may never arrive.
            assert _read_to_eof(sock) == b""
            assert time.monotonic() - started < _DRAIN_SLACK_SECONDS
        finally:
            sock.close()
    assert campaigns.seen == []


# Longer than CPython's integer string conversion limit, and far longer than any
# length this boundary accepts, while still a legal header line.
_UNCONVERTIBLE_CONTENT_LENGTH = "9" * 4400


def test_refused_post_with_an_oversized_content_length_header_sends_one_fixed_refusal(app) -> None:
    """One refusal, with a fixed code, for a length that cannot be converted.

    The drain runs after the refusal has been written, so a failure to interpret
    the declared length there would append a second response to a connection that
    has already been framed by ``Content-Length``.  The declared length is also
    never converted before it is bounded, so no interpreter diagnostic can be
    returned in place of this boundary's fixed codes.
    """
    server, _review, campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    assert len(_UNCONVERTIBLE_CONTENT_LENGTH) > MAX_CONTENT_LENGTH_DIGITS
    cases = (
        ("not-the-issued-token", (403, {"error": "csrf_invalid"})),
        (csrf, (400, {"error": "request_framing"})),
    )
    for token, expected in cases:
        sock = _open_raw(server)
        try:
            _send_request_head(server, sock, "/api/campaigns", [
                ("Cookie", cookie),
                ("Content-Type", "application/json"),
                ("X-CSRF-Token", token),
                ("Content-Length", _UNCONVERTIBLE_CONTENT_LENGTH),
            ])
            started = time.monotonic()
            status, _response_headers, body = _read_response(sock)
            assert (status, json.loads(body)) == expected
            assert b"digit" not in body and b"4300" not in body
            # Nothing follows the declared refusal body: a second response would
            # be readable here.  No body byte is sent, and none is waited for.
            assert _read_to_eof(sock) == b""
            assert time.monotonic() - started < _DRAIN_SLACK_SECONDS
        finally:
            sock.close()
    assert campaigns.seen == []


# Larger than the handler's buffered header read, so the remainder cannot have
# been absorbed into user space while the request line and headers were parsed.
_QUEUED_BODY_BYTES = 64 * 1024


def test_refused_post_drains_a_body_already_queued_on_the_socket(app) -> None:
    """The whole refusal survives a close with body bytes still queued.

    The body is sent immediately after the headers and is far larger than the
    buffered header read, so unread bytes are certainly still queued on the
    connection when the refusal is written.  Closing in exactly that state is
    what lets the transport abort the connection instead of sending an ordinary
    FIN, so the complete refusal must still be readable and the stream must then
    end cleanly.  No sleep and no retry is used.
    """
    server, _review, campaigns, _clock = app
    cookie, _csrf, _headers, _body = bootstrap(server)
    payload = json.dumps({
        "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "brief_text": "x" * _QUEUED_BODY_BYTES,
        "sender_profile_id": PROFILE,
        "mailbox_id": "mailbox-001",
    }).encode()
    assert _QUEUED_BODY_BYTES < len(payload) < MAX_JSON_BYTES
    sock = _open_raw(server)
    try:
        _send_request_head(server, sock, "/api/campaigns", [
            ("Cookie", cookie),
            ("Content-Type", "application/json"),
            ("X-CSRF-Token", "not-the-issued-token"),
            ("Content-Length", str(len(payload))),
        ])
        sock.sendall(payload)
        started = time.monotonic()
        status, headers, body = _read_response(sock)
        assert (status, json.loads(body)) == (403, {"error": "csrf_invalid"})
        assert headers["connection"] == "close"
        assert _read_to_eof(sock) == b""
        assert time.monotonic() - started < _DRAIN_SLACK_SECONDS
    finally:
        sock.close()
    assert campaigns.seen == []


class _CountingReader:
    """Delegates to the handler's real ``BufferedReader``, counting ``read1``.

    Both call count and byte count are tracked: it is the exact call the
    refusal drain issues
    (``getattr(reader, "read1", reader.read)``), so this proves bytes were
    actually pulled off the wire by the drain rather than merely that some
    drain method was invoked.  Every other attribute -- including ``read``,
    used by ``_read_json`` for an accepted body -- is delegated untouched, so
    ordinary request handling is unaffected.
    """

    def __init__(self, wrapped: object) -> None:
        self._wrapped = wrapped
        self.read1_bytes = 0
        self.read1_calls = 0

    def read1(self, size: int = -1) -> bytes:
        self.read1_calls += 1
        chunk = self._wrapped.read1(size)
        self.read1_bytes += len(chunk)
        return chunk

    def __getattr__(self, name: str) -> object:
        return getattr(self._wrapped, name)


@contextlib.contextmanager
def _counting_rfile(counters: list):
    """Wrap each handled connection's ``rfile`` with ``_CountingReader``.

    This patches only ``ReviewHandler.setup`` -- never a built-in
    ``BufferedReader`` attribute -- and always restores the original method,
    so no production behaviour or class state survives the test.
    """
    original_setup = review_app.ReviewHandler.setup

    def setup(self) -> None:
        original_setup(self)
        counter = _CountingReader(self.rfile)
        self.rfile = counter
        counters.append(counter)

    review_app.ReviewHandler.setup = setup
    try:
        yield counters
    finally:
        review_app.ReviewHandler.setup = original_setup


def test_refusal_drain_actually_consumes_the_declared_body_bytes(app) -> None:
    """The drain must pull every declared body byte off the wire.

    A mutant that sends the refusal and closes without draining -- proven on
    root to still pass the response-shape assertions alone -- leaves this
    counter at zero.  Counting real ``read1`` calls on the handler's own
    ``rfile`` proves the requirement (bytes actually consumed), not merely
    that some drain method was called.
    """
    server, _review, campaigns, _clock = app
    cookie, _csrf, _headers, _body = bootstrap(server)
    payload = _campaign_payload()
    counters: list = []
    with _counting_rfile(counters):
        sock = _open_raw(server)
        try:
            _send_request_head(server, sock, "/api/campaigns", [
                ("Cookie", cookie),
                ("Content-Type", "application/json"),
                ("X-CSRF-Token", "not-the-issued-token"),
                ("Content-Length", str(len(payload))),
            ])
            status, headers, body = _read_response(sock)
            assert (status, json.loads(body)) == (403, {"error": "csrf_invalid"})
            sock.sendall(payload)
            assert _read_to_eof(sock) == b""
        finally:
            sock.close()
    assert campaigns.seen == []
    assert len(counters) == 1
    assert counters[0].read1_bytes == len(payload)


_ZERO_READ_FRAMING_CASES = (
    pytest.param(
        "oversized_content_length", "valid_csrf",
        [("Content-Length", str(MAX_JSON_BYTES + 1))],
        (413, {"error": "request_too_large"}),
        id="oversized_content_length",
    ),
    pytest.param(
        "duplicate_content_length", "invalid_csrf",
        [("Content-Length", "24"), ("Content-Length", "25")],
        (403, {"error": "csrf_invalid"}),
        id="duplicate_content_length",
    ),
    pytest.param(
        "transfer_encoding_and_content_length", "valid_csrf",
        [("Transfer-Encoding", "chunked"), ("Content-Length", "24")],
        (400, {"error": "request_framing"}),
        id="transfer_encoding_and_content_length",
    ),
    pytest.param(
        "expect_100_continue", "valid_csrf",
        [("Content-Length", "24"), ("Expect", "100-continue")],
        (417, {"error": "request_framing"}),
        id="expect_100_continue",
    ),
)


@pytest.mark.parametrize("_label,csrf_choice,extra_headers,expected", _ZERO_READ_FRAMING_CASES)
def test_zero_read_framing_refusals_read_zero_additional_body_bytes(
    app, _label, csrf_choice, extra_headers, expected,
) -> None:
    """Each declared framing refusal reads zero additional body bytes.

    This counts actual bytes read rather than relying on a wall-clock slack
    window, and also counts read1 attempts directly: a timed-out read attempt
    can return zero bytes without having read nothing, so byte counts alone
    do not prove zero read attempts occurred.
    """
    server, _review, campaigns, _clock = app
    cookie, csrf, _headers, _body = bootstrap(server)
    token = csrf if csrf_choice == "valid_csrf" else "not-the-issued-token"
    counters: list = []
    with _counting_rfile(counters):
        sock = _open_raw(server)
        try:
            _send_request_head(server, sock, "/api/campaigns", [
                ("Cookie", cookie),
                ("Content-Type", "application/json"),
                ("X-CSRF-Token", token),
                *extra_headers,
            ])
            status, _headers, body = _read_response(sock)
            assert (status, json.loads(body)) == expected
            assert _read_to_eof(sock) == b""
        finally:
            sock.close()
    assert campaigns.seen == []
    assert len(counters) == 1
    assert counters[0].read1_bytes == 0
    assert counters[0].read1_calls == 0


def test_read_response_helper_detects_a_coalesced_second_response() -> None:
    """Synthetic proof that ``_read_response`` never swallows a coalesced reply.

    This does not exercise the real server: it feeds the test helper two
    responses written back to back on one synthetic socket pair, the same
    shape a no-drain mutant (or any future regression) could produce by
    letting the transport append a second reply.  Before this repair the
    helper's ``body[:length]`` slice silently discarded exactly this case.
    """

    class _CoalescedFakeSocket:
        def __init__(self, payload: bytes) -> None:
            self._payload = payload
            self._delivered = False

        def recv(self, _size: int) -> bytes:
            if self._delivered:
                return b""
            self._delivered = True
            return self._payload

    body = b'{"error":"csrf_invalid"}'
    first = (
        b"HTTP/1.1 403 Forbidden\r\n"
        b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n"
        b"Connection: close\r\n\r\n" + body
    )
    second = b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n"
    fake_socket = _CoalescedFakeSocket(first + second)
    with pytest.raises(AssertionError, match="trailing bytes"):
        _read_response(fake_socket)


def test_creation_status_route_is_closed_authorized_and_host_bound(app) -> None:
    """The lookup answers one closed question and refuses everything else.

    Unauthenticated and wrong-Host requests never reach the service at all, so
    the existing authorization and Host checks continue to protect this read.
    """
    server, _review, campaigns, _clock = app
    cookie, _csrf, _headers, _body = bootstrap(server)
    route = "/api/campaigns/creation-status"

    status, _headers, raw = request(
        server, "GET", f"{route}?request_id={SAVED_REQUEST}",
        headers={"Cookie": cookie},
    )
    assert (status, json.loads(raw)) == (200, {
        "state": "saved", "request_id": SAVED_REQUEST, "campaign_id": CAMPAIGN,
    })
    status, _headers, raw = request(
        server, "GET", f"{route}?request_id={ABSENT_REQUEST}",
        headers={"Cookie": cookie},
    )
    assert (status, json.loads(raw)) == (200, {
        "state": "not_found", "request_id": ABSENT_REQUEST, "campaign_id": None,
    })
    status, _headers, raw = request(
        server, "GET", f"{route}?request_id={TAMPERED_REQUEST}",
        headers={"Cookie": cookie},
    )
    assert (status, json.loads(raw)) == (422, {"error": "campaign_state_invalid"})
    assert CAMPAIGN.encode() not in raw
    status, _headers, raw = request(
        server, "GET", f"{route}?request_id=not-a-uuid", headers={"Cookie": cookie},
    )
    assert (status, json.loads(raw)) == (422, {"error": "invalid_request_id"})

    seen_before = list(campaigns.creation_seen)
    # Duplicated, extra, and missing parameters are all refused outright.
    for path in (
        f"{route}?request_id={SAVED_REQUEST}&request_id={ABSENT_REQUEST}",
        f"{route}?request_id={SAVED_REQUEST}&campaign_id={CAMPAIGN}",
        f"{route}?campaign_id={CAMPAIGN}",
        route,
    ):
        assert request(server, "GET", path, headers={"Cookie": cookie})[0] == 400
    assert campaigns.creation_seen == seen_before

    status, _headers, raw = request(
        server, "GET", f"{route}?request_id={SAVED_REQUEST}",
    )
    assert (status, json.loads(raw)) == (401, {"error": "session_required"})
    status, _headers, raw = request(
        server, "GET", f"{route}?request_id={SAVED_REQUEST}",
        headers={"Host": "evil.test", "Cookie": cookie},
    )
    assert (status, json.loads(raw)) == (400, {"error": "request_invalid"})
    assert campaigns.creation_seen == seen_before
    # A read never reaches campaign creation.
    assert campaigns.seen == []


def test_creation_status_http_uses_the_real_service_and_leaks_no_private_fields(
    tmp_path: Path,
) -> None:
    from scripts.prospecting.tests.test_campaigns import (
        BRIEF, MAILBOX_ID, REQUEST_ONE, REQUEST_TWO, _profile,
    )

    database = tmp_path / "creation-status.sqlite"
    seeded = open_store(database)
    _profile(seeded, PROFILE)
    CampaignService(seeded, campaign_id_factory=lambda: CAMPAIGN).create(
        request_id=REQUEST_ONE, brief_text=BRIEF, sender_profile_id=PROFILE,
        mailbox_id=MAILBOX_ID, require_first_draft_compatible=True,
    )
    seeded.commit()
    seeded.close()
    connection = sqlite3.connect(database, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")

    def counts() -> tuple[int, int]:
        return (
            connection.execute("SELECT count(*) FROM campaign").fetchone()[0],
            connection.execute("SELECT count(*) FROM campaign_brief").fetchone()[0],
        )

    server = create_server(ReviewService(connection), CampaignService(connection), port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        cookie, _csrf, _headers, _body = bootstrap(server)
        route = "/api/campaigns/creation-status"
        before = counts()

        status, _headers, raw = request(
            server, "GET", f"{route}?request_id={REQUEST_ONE}",
            headers={"Cookie": cookie},
        )
        assert (status, json.loads(raw)) == (200, {
            "state": "saved", "request_id": REQUEST_ONE, "campaign_id": CAMPAIGN,
        })
        for secret in (b"synthetic operations work", MAILBOX_ID.encode(), PROFILE.encode()):
            assert secret not in raw

        # Repeating the exact lookup changes nothing and answers identically.
        assert request(
            server, "GET", f"{route}?request_id={REQUEST_ONE}",
            headers={"Cookie": cookie},
        )[2] == raw
        assert counts() == before

        status, _headers, raw = request(
            server, "GET", f"{route}?request_id={REQUEST_TWO}",
            headers={"Cookie": cookie},
        )
        assert (status, json.loads(raw)) == (200, {
            "state": "not_found", "request_id": REQUEST_TWO, "campaign_id": None,
        })
        assert counts() == before

        connection.execute(
            "UPDATE campaign SET policy_json=json_set(policy_json, '$.timezone', ?) "
            "WHERE campaign_id=?",
            ("UTC", CAMPAIGN),
        )
        connection.commit()
        status, _headers, raw = request(
            server, "GET", f"{route}?request_id={REQUEST_ONE}",
            headers={"Cookie": cookie},
        )
        assert (status, json.loads(raw)) == (422, {"error": "campaign_state_invalid"})
        assert CAMPAIGN.encode() not in raw
        assert b"synthetic operations work" not in raw
        assert counts() == before
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        connection.close()
