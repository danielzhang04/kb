"""Synthetic HTTP acceptance through the real campaign and review services."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import http.client
import json
from pathlib import Path
from queue import Queue
import re
import shutil
import threading
import uuid

from scripts.prospecting.manager.campaigns import CampaignService
from scripts.prospecting.personalizer.qa import QaResult
from scripts.prospecting.personalizer.revision import RevisionInput, build_revision
from scripts.prospecting.review_app import _draft_preparer, _source_importer, create_server
from scripts.prospecting.affinity.source_review import verify_snapshot
from scripts.prospecting.review_service import ReviewService
from scripts.prospecting.store import open_store


NOW = "2026-09-09T12:00:00Z"
PROFILE = "22222222-2222-4222-8222-222222222222"
CAMPAIGNS = ("camp_1111111111111111", "camp_2222222222222222")
BRIEF = "intent:networking lane:manual industry:software people-count:2"
SOURCE_REVIEW = json.loads(
    (Path(__file__).parents[3] / "orgs" / "prospecting" / "fixtures" / "source-review-synthetic.json")
    .read_text(encoding="utf-8")
)


@dataclass
class RunningApp:
    server: object
    thread: threading.Thread
    errors: list[BaseException]

    def stop(self) -> None:
        self.server.shutdown()
        self.thread.join(timeout=5)
        assert not self.thread.is_alive()
        assert not self.errors


def _start(
    path: Path, campaign_ids: tuple[str, ...] = (), *, production_prepare: bool = False,
) -> RunningApp:
    ready: Queue[object] = Queue()
    errors: list[BaseException] = []

    def run() -> None:
        connection = open_store(path)
        values = iter(campaign_ids)
        campaigns = CampaignService(
            connection, campaign_id_factory=lambda: next(values), now=lambda: NOW
        )
        prepare = _draft_preparer(connection, path.parent / "sender-anchors.json") if production_prepare else None
        verifier = (
            (lambda proof: verify_snapshot(
                path.parent / "snapshots", proof,
                now=datetime.fromisoformat(NOW.replace("Z", "+00:00")),
            )) if production_prepare else None
        )
        server = create_server(
            ReviewService(connection, now=lambda: NOW, prepare_adapter=prepare,
                          source_verifier=verifier,
                          source_importer=_source_importer(connection) if production_prepare else None),
            campaigns,
        )
        ready.put(server)
        try:
            server.serve_forever()
        except BaseException as error:  # surfaced to the test thread
            errors.append(error)
        finally:
            server.server_close()
            connection.close()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    server = ready.get(timeout=5)
    return RunningApp(server, thread, errors)


def _request(app: RunningApp, method: str, path: str, payload: object | None = None,
             *, cookie: str | None = None, csrf: str | None = None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Host": app.server.authority}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if cookie is not None:
        headers["Cookie"] = cookie
    if csrf is not None:
        headers["X-CSRF-Token"] = csrf
    connection = http.client.HTTPConnection("127.0.0.1", app.server.server_address[1], timeout=3)
    connection.request(method, path, body=body, headers=headers)
    response = connection.getresponse()
    raw = response.read()
    result = response.status, dict(response.getheaders()), raw
    connection.close()
    return result


def _bootstrap(app: RunningApp) -> tuple[str, str]:
    status, headers, body = _request(app, "GET", "/bootstrap")
    assert status == 303
    assert headers["Location"] == "/"
    assert body == b""
    cookie = headers["Set-Cookie"].split(";", 1)[0]
    status, _headers, body = _request(app, "GET", "/", cookie=cookie)
    assert status == 200
    match = re.search(rb'<meta name="csrf-token" content="([^"]+)">', body)
    assert match is not None
    return cookie, match.group(1).decode("ascii")


def _post(app: RunningApp, path: str, payload: object, cookie: str, csrf: str):
    status, _headers, raw = _request(app, "POST", path, payload, cookie=cookie, csrf=csrf)
    return status, json.loads(raw)


def _seed_profile(path: Path) -> None:
    connection = open_store(path)
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        (PROFILE, "Synthetic Sender", None, "Synthetic focus", "Synthetic background",
         "Synthetic proof", "[]"),
    )
    connection.close()


def _seed_draft(path: Path, campaign_id: str, suffix: str) -> str:
    connection = open_store(path)
    person_id = f"person-{suffix}"
    connection.execute(
        "INSERT INTO person VALUES(?,?,?,?,?,?,?,?)",
        (person_id, "Synthetic", f"Synthetic Person {suffix.upper()}",
         f"https://profile.example.test/{suffix}", "Example", "Synthetic fixture",
         "manual", f"person-{suffix}"),
    )
    record = build_revision(connection, RevisionInput(
        person_id, campaign_id, 0, f"Synthetic subject {suffix}",
        f"Synthetic body {suffix}", "why_them", "bespoke", None,
        "Would you have 15 minutes for an informational conversation?", (), (), (),
        "networking", 1, "fixture-prompt", "fixture-model",
        QaResult(True, 100, {"fixture": True}, ()),
    ))
    connection.commit()
    connection.close()
    return record.revision_id


def test_real_http_flow_is_scoped_idempotent_and_persists_across_restart(tmp_path: Path) -> None:
    path = tmp_path / "review.sqlite"
    _seed_profile(path)
    app = _start(path, CAMPAIGNS)
    cookie, csrf = _bootstrap(app)
    try:
        for index, expected in enumerate(CAMPAIGNS, 1):
            status, result = _post(app, "/api/campaigns", {
                "request_id": str(uuid.UUID(int=index)), "brief_text": BRIEF,
                "sender_profile_id": PROFILE, "mailbox_id": "mailbox-001",
            }, cookie, csrf)
            assert (status, result) == (201, {"campaign_id": expected, "created": True})
        for campaign_id in CAMPAIGNS:
            status, _headers, raw = _request(
                app, "GET", f"/api/review?campaign_id={campaign_id}", cookie=cookie
            )
            snapshot = json.loads(raw)
            assert status == 200 and snapshot["campaign"]["campaign_id"] == campaign_id
            assert snapshot["people"] == [] and snapshot["drafts"] == []
    finally:
        app.stop()

    revision_a = _seed_draft(path, CAMPAIGNS[0], "a")
    revision_b = _seed_draft(path, CAMPAIGNS[1], "b")
    app = _start(path)
    cookie, csrf = _bootstrap(app)
    edit_one = {
        "request_id": str(uuid.UUID(int=11)), "campaign_id": CAMPAIGNS[0],
        "expected_revision_id": revision_a, "subject": "First saved edit",
        "body": "First synthetic edit body",
    }
    feedback = {
        "request_id": str(uuid.UUID(int=13)), "campaign_id": CAMPAIGNS[1],
        "expected_revision_id": revision_b, "disposition": "tone",
        "tags": ["warmer"], "text": "Use a warmer synthetic opening.",
    }
    try:
        status, first = _post(app, "/api/drafts/edit", edit_one, cookie, csrf)
        assert status == 200 and first["state"] == "pending_qa" and first["replayed"] is False
        status, replay = _post(app, "/api/drafts/edit", edit_one, cookie, csrf)
        assert status == 200 and replay["replayed"] is True
        assert replay["candidate_id"] == first["candidate_id"]
        edit_two = {
            **edit_one, "request_id": str(uuid.UUID(int=12)),
            "expected_candidate_id": first["candidate_id"],
            "subject": "Second saved edit", "body": "Second synthetic edit body",
        }
        status, second = _post(app, "/api/drafts/edit", edit_two, cookie, csrf)
        assert status == 200 and second["state"] == "pending_qa"
        status, saved_feedback = _post(app, "/api/drafts/feedback", feedback, cookie, csrf)
        assert status == 202 and saved_feedback["state"] == "pending"

        snapshots = {}
        for campaign_id in CAMPAIGNS:
            status, _headers, raw = _request(
                app, "GET", f"/api/review?campaign_id={campaign_id}", cookie=cookie
            )
            assert status == 200
            snapshots[campaign_id] = json.loads(raw)
        assert snapshots[CAMPAIGNS[0]]["drafts"][0]["candidate_id"] == second["candidate_id"]
        assert snapshots[CAMPAIGNS[0]]["drafts"][0]["feedback_state"] is None
        assert snapshots[CAMPAIGNS[1]]["drafts"][0]["candidate_id"] is None
        assert snapshots[CAMPAIGNS[1]]["drafts"][0]["feedback_state"] == "pending"
        assert {item["campaign_id"] for item in snapshots[CAMPAIGNS[0]]["campaigns"]} == set(CAMPAIGNS)
        assert {item["action"] for item in snapshots[CAMPAIGNS[0]]["activity"]} == {"review.edit"}
        assert {item["action"] for item in snapshots[CAMPAIGNS[1]]["activity"]} == {"review.feedback"}
    finally:
        app.stop()

    app = _start(path)
    cookie, csrf = _bootstrap(app)
    try:
        status, _headers, raw = _request(
            app, "GET", f"/api/review?campaign_id={CAMPAIGNS[0]}", cookie=cookie
        )
        persisted = json.loads(raw)
        assert status == 200
        assert persisted["drafts"][0]["candidate_body"] == "Second synthetic edit body"
        assert _post(app, "/api/drafts/edit", edit_two, cookie, csrf)[1]["replayed"] is True
        assert _post(app, "/api/drafts/feedback", feedback, cookie, csrf)[1]["replayed"] is True
    finally:
        app.stop()

    connection = open_store(path)
    assert connection.execute("SELECT count(*) FROM campaign").fetchone()[0] == 2
    assert connection.execute("SELECT count(*) FROM review_candidate").fetchone()[0] == 2
    assert connection.execute("SELECT count(*) FROM draft_feedback").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM review_request").fetchone()[0] == 3
    connection.close()


def test_prepare_drafts_http_runs_the_real_p8_owner_in_the_selected_store(
    tmp_path: Path, monkeypatch,
) -> None:
    import scripts.prospecting.review_app as review_app
    from scripts.prospecting.tests.test_affinity_templates_v2 import NOW as P8_NOW, _draft_ready_fixture

    connection, _person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    scope = connection.execute(
        """SELECT fp.person_id,fp.company_id,p.full_name,c.name,e.title,e.employment_id,
                  e.source_observation_id
             FROM fill_person AS fp JOIN person AS p ON p.person_id=fp.person_id
             JOIN company AS c ON c.company_id=fp.company_id
             JOIN employment AS e ON e.person_id=fp.person_id AND e.company_id=fp.company_id
                AND e.valid_to IS NULL
            WHERE fp.campaign_id=? AND fp.substituted=0""", (campaign_id,),
    ).fetchone()
    body = " ".join((scope["full_name"], "is", scope["title"], "at", scope["name"])).encode()
    connection.commit()
    connection.close()
    fixture = Path(__file__).parents[3] / "orgs/prospecting/fixtures/affinity/sender-anchors-synthetic.json"
    shutil.copyfile(fixture, tmp_path / "sender-anchors.json")

    class FrozenDateTime:
        @classmethod
        def now(cls, _zone):
            return P8_NOW

    monkeypatch.setattr(review_app, "datetime", FrozenDateTime)
    app = _start(tmp_path / "store.sqlite", production_prepare=True)
    cookie, csrf = _bootstrap(app)
    try:
        status, imported = _post(
            app, "/api/people/import-source", {
                "campaign_id": campaign_id, "person_id": scope["person_id"],
                "source_url": SOURCE_REVIEW["source_url"], "body": body.decode(),
            }, cookie, csrf,
        )
        assert status == 200 and imported["state"] == "source_available"
        status, _headers, raw = _request(
            app, "GET", f"/api/review?campaign_id={campaign_id}", cookie=cookie,
        )
        before_confirmation = json.loads(raw)
        assert status == 200
        person = before_confirmation["people"][0]
        assert person["identity_source_state"] == "confirmation_required"
        assert person["current_observation_id"] == scope["source_observation_id"]
        assert len(person["identity_sources"]) == 1
        candidate_observation_id = person["identity_sources"][0]["observation_id"]
        status, result = _post(
            app, "/api/people/verify-source", {
                "request_id": str(uuid.UUID(int=900)), "campaign_id": campaign_id,
                "person_id": scope["person_id"],
                "expected_observation_id": scope["source_observation_id"],
                "observation_id": candidate_observation_id, "attested": True,
            }, cookie, csrf,
        )
        assert status == 200 and result["state"] == "source_confirmed"
        status, result = _post(
            app, "/api/drafts/prepare", {"campaign_id": campaign_id, "step": 0}, cookie, csrf
        )
        assert status == 200
        assert result["candidates"] == 1 and result["revisions_created"] == 1, result
        status, _headers, raw = _request(
            app, "GET", f"/api/review?campaign_id={campaign_id}", cookie=cookie
        )
        snapshot = json.loads(raw)
        assert status == 200 and len(snapshot["drafts"]) == 1
        assert snapshot["drafts"][0]["evidence"]
        assert all(item["url"].startswith("https://") for item in snapshot["drafts"][0]["evidence"])
    finally:
        app.stop()

    connection = open_store(tmp_path / "store.sqlite")
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM revision_qa_context").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM identity_source_review").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM exec_request").fetchone()[0] == 0
    connection.close()


def test_pipeline_brief_is_saved_locally_without_launching_research(tmp_path: Path) -> None:
    path = tmp_path / "pipeline-review.sqlite"
    _seed_profile(path)
    app = _start(path, (CAMPAIGNS[0],))
    cookie, csrf = _bootstrap(app)
    try:
        status, result = _post(app, "/api/campaigns", {
            "request_id": str(uuid.UUID(int=3001)), "brief_text": BRIEF,
            "sender_profile_id": PROFILE, "mailbox_id": "mailbox-001",
        }, cookie, csrf)
        assert (status, result) == (201, {"campaign_id": CAMPAIGNS[0], "created": True})
        intake = {
            "request_id": str(uuid.UUID(int=3002)), "campaign_id": CAMPAIGNS[0],
            "as_of_date": "2026-09-09", "funding_stage_min": "series_a",
            "funding_stage_max": "series_c", "funding_window_years": 3,
            "funding_stage_interpretation": "latest_known",
            "geography": {"mode": "specific", "values": ["new_york"]},
            "sector": {"mode": "any", "values": []}, "requested_companies": 20,
            "requested_people_per_company": 2, "role_families": ["operations", "investing"],
            "original_specification": "Keep this user-provided context private.",
            "outreach_goal": "Discuss an AI-related coffee chat.",
        }
        status, _headers, raw = _request(
            app, "POST", "/api/pipeline/start", intake, cookie=cookie,
        )
        assert status == 403 and json.loads(raw) == {"error": "csrf_invalid"}
        status, saved = _post(app, "/api/pipeline/start", intake, cookie, csrf)
        assert status == 201
        assert saved["state"] == "awaiting_research_adapter"
        assert saved["next_stage"] == "research"
        status, replayed = _post(app, "/api/pipeline/start", intake, cookie, csrf)
        assert status == 200 and replayed["replayed"] is True
        status, _headers, raw = _request(
            app, "GET", f"/api/review?campaign_id={CAMPAIGNS[0]}", cookie=cookie,
        )
        snapshot = json.loads(raw)
        assert status == 200
        assert snapshot["pipeline"]["state"] == "awaiting_research_adapter"
        assert snapshot["unmet_inputs"] == []
        assert snapshot["next_action"]["title"] == "Brief saved; research is not connected yet"
        assert snapshot["pipeline"]["requested_companies"] == 20
        assert snapshot["pipeline"]["requested_people_per_company"] == 2
        assert snapshot["pipeline"]["outreach_goal"] == intake["outreach_goal"]
    finally:
        app.stop()


def test_feedback_http_links_only_the_authentic_human_edit_and_persists(tmp_path: Path) -> None:
    from scripts.prospecting.tests.test_feedback_service import _database

    path = tmp_path / "feedback-http.sqlite"
    connection, original, _other = _database(path)
    connection.close()
    feedback_request = {
        "request_id": str(uuid.UUID(int=1000)), "campaign_id": "campaign-a",
        "expected_revision_id": original, "disposition": "tone", "tags": ["warmer"],
        "text": "Use a warmer opening.",
    }
    app = _start(path)
    cookie, csrf = _bootstrap(app)
    try:
        status, feedback = _post(app, "/api/drafts/feedback", feedback_request, cookie, csrf)
        assert status == 202 and feedback["state"] == "pending"
        status, edit = _post(app, "/api/drafts/edit", {
            "request_id": str(uuid.UUID(int=1001)), "campaign_id": "campaign-a",
            "expected_revision_id": original, "subject": "Revised synthetic subject",
            "body": (
                "Hello. Built Example Product. This human edit keeps the same synthetic evidence. "
                "Would you have 15 minutes for an informational conversation?"
            ),
        }, cookie, csrf)
        assert status == 200 and edit["state"] == "revision_created"
        status, _headers, raw = _request(
            app, "GET", "/api/review?campaign_id=campaign-a", cookie=cookie,
        )
        snapshot = json.loads(raw)
        assert status == 200 and snapshot["feedback"][0]["state"] == "ready_to_record"
        assert snapshot["feedback"][0]["original_revision_id"] == original
        assert snapshot["feedback"][0]["eligible_revision_id"] == edit["revision_id"]
        status, result = _post(app, "/api/feedback/fulfill", {
            "request_id": str(uuid.UUID(int=1002)), "campaign_id": "campaign-a",
            "feedback_id": feedback["feedback_id"],
            "expected_child_revision_id": edit["revision_id"],
        }, cookie, csrf)
        assert status == 200 and result["state"] == "fulfilled"
    finally:
        app.stop()

    app = _start(path)
    cookie, _csrf = _bootstrap(app)
    try:
        status, _headers, raw = _request(
            app, "GET", "/api/review?campaign_id=campaign-a", cookie=cookie,
        )
        assert status == 200 and json.loads(raw)["feedback"][0]["state"] == "fulfilled"
    finally:
        app.stop()
    connection = open_store(path)
    assert connection.execute("SELECT count(*) FROM draft_feedback_outcome").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM approval").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM delivery").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM exec_request").fetchone()[0] == 0
    connection.close()
