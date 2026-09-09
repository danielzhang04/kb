from __future__ import annotations

from dataclasses import dataclass
import http.client
import json
from pathlib import Path
import re
import threading

import pytest

import scripts.prospecting.review_app as review_app
from scripts.prospecting.review_app import (
    MAX_JSON_BYTES,
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
    PersonView,
    PrepareDraftsResult,
    ScheduleView,
    SenderProfileView,
)


CAMPAIGN = "camp_1111111111111111"
PROFILE = "22222222-2222-4222-8222-222222222222"
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

    def request_feedback(self, request):
        self._record("feedback", request)
        return Result(state="pending")

    def set_editorial_ready(self, request):
        self._record("ready", request)
        return Result(state="ready")


class FakeCampaigns:
    def __init__(self) -> None:
        self.seen: list[dict[str, object]] = []

    def create(self, **value):
        self.seen.append(value)
        return Result()


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
    status, headers, body = request(server, "GET", "/bootstrap")
    assert status == 200
    cookie = headers["Set-Cookie"].split(";", 1)[0]
    csrf = re.search(rb'<meta name="csrf-token" content="([^"]+)">', body).group(1).decode()
    return cookie, csrf, headers, body


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
    assert request(server, "GET", "/", headers={"Cookie": cookie})[0] == 200
    clock[0] += SESSION_SECONDS + 1
    status, _headers, expired = request(server, "GET", "/", headers={"Cookie": cookie})
    assert status == 401 and b"Restart Prospecting Review" in expired


def test_snapshot_is_campaign_scoped_and_calls_all_five_read_owners(app) -> None:
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
    assert value["schedule"][0]["approval_state"] == "missing"
    assert value["activity"][0]["reason"] == "pending_qa"
    assert value["mailboxes"] == ["mailbox-001"]
    for method in ("campaign", "people", "drafts", "schedule", "activity"):
        assert (method, CAMPAIGN) in review.seen


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
    assert 'id="requestId" name="request_id" type="hidden"' in html
    assert "/api/people/select" not in html
    assert "No messages are scheduled" in html
    assert "Saved edit history" in html
    assert '<select id="conversationAsk"><option value="informational_call">Informational call</option></select>' in html
    assert '<input id="minutes" type="number" min="10" max="20" value="15" required>' in html
    assert "ask_type_unsupported" in html and "ask_minutes_unsupported" in html


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

    def draft(owner, campaign_id, step, *, anchors: object, now):
        captured.update(owner=owner, campaign_id=campaign_id, step=step, anchors=anchors, now=now)
        return summary

    monkeypatch.setattr(review_app, "draft_campaign", draft)
    assert _draft_preparer(connection, anchors_file)(CAMPAIGN, 0) is summary
    assert captured == {
        "owner": connection, "campaign_id": CAMPAIGN, "step": 0,
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
