"""Loopback-only HTTP shell for the local prospecting review service."""

from __future__ import annotations

import argparse
from collections.abc import Mapping
from dataclasses import fields, is_dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, HTTPServer
import hmac
import json
from pathlib import Path
import re
import secrets
import sqlite3
import time
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

from scripts.prospecting.affinity.anchors import load_anchors
from scripts.prospecting.affinity.templates_v2 import DraftError, draft_step_zero_proof_pending
from scripts.prospecting.affinity.source_review import (
    MAX_SOURCE_BYTES,
    import_operator_page,
    verify_snapshot,
)
from scripts.prospecting.control_desktop import ControlError
from scripts.prospecting.control_review import (
    ControlReviewAdapter,
    ControlReviewError,
    ControlReviewStatus,
)
from scripts.prospecting.feedback_service import (
    FeedbackError,
    FeedbackService,
    FulfillFeedbackRequest,
)
from scripts.prospecting.manager.campaigns import (
    CampaignError,
    CampaignService,
    DraftingSettings,
)
from scripts.prospecting.pipeline_service import (
    PipelineError,
    PipelineService,
    PipelineStartRequest,
    ScopeSpec,
)
from scripts.prospecting.pipeline_stage_service import (
    PipelineStageError,
    PipelineStageService,
)
from scripts.prospecting.review_service import (
    EditDraftRequest,
    EditorialRequest,
    FeedbackRequest,
    ImportIdentitySourceRequest,
    ReviewError,
    ReviewService,
    VerifyIdentitySourceRequest,
)
from scripts.prospecting.selected_draft_service import SelectedDraftRequest
from scripts.prospecting.selected_source_review import SelectedSourceAttestationRequest
from scripts.prospecting.store import open_store, resolve_store_path


HOST = "127.0.0.1"
MAX_JSON_BYTES = 72 * 1024
MAX_SOURCE_UPLOAD_JSON_BYTES = 6 * MAX_SOURCE_BYTES + 64 * 1024
SESSION_SECONDS = 8 * 60 * 60
BOOTSTRAP_SECONDS = 60
REQUEST_SECONDS = 5
# Refusing a POST before its body is read leaves unread bytes queued on the
# socket.  Closing then lets the transport abort the connection instead of
# sending an ordinary FIN, which can discard the refusal the peer has not read
# yet.  Discarding the already-declared body first avoids that, under one
# absolute wall-clock bound so a stalled peer cannot hold this single-threaded
# loopback server.  The value is intentionally small: it only has to cover bytes
# already in flight on loopback, never a slow network sender.
MAX_REFUSAL_DRAIN_SECONDS = 0.25
REFUSAL_DRAIN_CHUNK_BYTES = 16 * 1024
# ``int()`` refuses to convert a decimal string longer than CPython's integer
# string conversion limit and raises ``ValueError``.  A ``Content-Length`` header
# can carry thousands of digits, so every declared length is bounded as a string
# before it is converted: a byte-cap comparison performed after ``int()`` is too
# late.  Twenty digits is above any 64-bit octet count and far above either
# route cap, so no ordinary valid length is affected.
MAX_CONTENT_LENGTH_DIGITS = 20
HTML_PATH = Path(__file__).with_name("review_app.html")
_ENTITY_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
_LOCAL_REVIEW_ACTOR = "human:local-review"
# Root refusals from the selected projection that mean the local pipeline is
# legitimately not ranked yet, rather than that an existing selected ranking is
# stale or malformed.  ``qualification_missing`` is the exact code
# ``RankingService`` raises when a run simply has no qualification batch to rank.
# ``RankingService._scope`` resolves the qualification scope first, though, and
# that path reaches ``QualificationService._context`` before any qualification
# batch is looked up: a run with no funding or person research batch yet refuses
# earlier with ``funding_batch_missing`` / ``person_batch_missing``, which
# ``_scope`` re-raises verbatim.  All three name the same fact -- the research
# prerequisite has not run, so nothing can have been selected yet.  Every other
# unavailable code (stale context, changed or expired source, invalid stored
# state, unsupported policy, or the generic fallback) keeps its own visible
# refusal below, and none of them is ever suppressed here.
_SELECTED_NOT_RANKED_CODES = frozenset({
    "funding_batch_missing", "person_batch_missing", "qualification_missing",
})
_SELECTED_DRAFT_FORMAT_CODES = frozenset({
    "campaign_missing", "campaign_state_invalid", "invalid_campaign_id",
    "invalid_policy_state_hash", "policy_state_stale", "policy_hash_changed",
    "selected_draft_format_locked", "ask_type_unsupported",
    "ask_minutes_unsupported", "store_busy", "transaction_active",
})
# The only refusal codes the read-only creation-status lookup forwards verbatim.
# Anything else is reported as one fixed, non-descriptive code so no driver,
# path, brief or policy text can reach the browser through this route.
_CREATION_STATUS_CODES = frozenset({"invalid_request_id", "campaign_state_invalid"})
# The only local pipeline states that precede research entirely.
_PRE_RESEARCH_PIPELINE_STATES = frozenset({"awaiting_research_adapter", "input_pending"})
_SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": (
        "default-src 'self'; base-uri 'none'; connect-src 'self'; "
        "font-src 'self'; form-action 'self'; frame-ancestors 'none'; "
        "img-src 'self' data:; object-src 'none'; script-src 'unsafe-inline'; "
        "style-src 'unsafe-inline'"
    ),
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}
_EXPIRED_HTML = b"""<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Session ended</title>
<style>body{margin:0;background:#f7f7f2;color:#172018;font:16px/1.5 system-ui;display:grid;place-items:center;min-height:100vh}main{max-width:34rem;background:white;border:1px solid #dfe3da;border-radius:12px;padding:32px;box-shadow:0 18px 60px rgba(24,43,32,.09)}h1{font-family:Georgia,serif;margin-top:0}code{color:#173f31}</style></head>
<body><main><h1>Your review session ended</h1><p>Restart Prospecting Review, then open its local link again. Unsaved form text in this browser page is no longer available.</p></main></body></html>"""


def _selected_store_context(requested: Path | None) -> tuple[Path, Path]:
    """Bind sibling local inputs to the same explicit store selection."""
    database = (resolve_store_path() if requested is None else Path(requested)).absolute()
    return database, database.parent / "sender-anchors.json"


def _draft_preparer(connection: object, anchors_file: Path) -> Callable[[str, int], object]:
    def prepare(campaign_id: str, step: int) -> object:
        try:
            anchors = load_anchors(anchors_file)
        except ValueError:
            raise DraftError("sender_anchors_missing") from None
        if step != 0:
            raise DraftError("step_invalid")
        return draft_step_zero_proof_pending(
            connection, campaign_id,
            anchors=anchors, now=datetime.now(timezone.utc),
        )

    return prepare


def _source_importer(connection: object) -> Callable[[str, str, str, bytes], str]:
    def import_source(person_id: str, company_id: str, source_url: str, body: bytes) -> str:
        return import_operator_page(
            connection, person_id=person_id, company_id=company_id,
            source_url=source_url, body=body, now=datetime.now(timezone.utc),
        )

    return import_source


def _jsonable(value: object) -> object:
    # ``asdict`` deep-copies every field, which fails outright on the immutable
    # ``MappingProxyType`` counts the selected projection exposes.  The dataclass's
    # own declared fields are traversed instead, so no arbitrary ``__dict__`` is
    # read and the primitive-only response schema is preserved.
    if is_dataclass(value) and not isinstance(value, type):
        return {
            field.name: _jsonable(getattr(value, field.name))
            for field in fields(value)
        }
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError("response_schema")


def _require_object(value: object, keys: set[str], optional: set[str] = set()) -> dict[str, Any]:
    if not isinstance(value, dict) or not set(value) <= keys | optional or not keys <= set(value):
        raise ValueError("request_schema")
    return value


def _next_action(snapshot: dict[str, object]) -> dict[str, str]:
    campaigns = snapshot["campaigns"]
    if not campaigns:
        return {"title": "Create your first campaign", "detail": "Save a local brief to establish its durable identity.", "label": "Campaign setup"}
    if "campaign" not in snapshot:
        return {"title": "Choose a campaign", "detail": "Every count and review state is scoped to one campaign.", "label": "Campaign required"}
    drafts = snapshot["drafts"]
    people = snapshot["people"]
    pending = [item for item in drafts if item.get("candidate_state") in {"pending_qa", "qa_failed"}]
    review = [item for item in drafts if item.get("editorial_state") != "ready"]
    selected = snapshot.get("selected_pipeline")
    selected_state = selected.get("state") if isinstance(selected, dict) else None
    selected_code = selected.get("error_code") if isinstance(selected, dict) else None
    selected_counts = selected.get("counts") if isinstance(selected, dict) else None
    selected_counts = selected_counts if isinstance(selected_counts, dict) else {}
    available = selected_counts.get("available_people")
    unavailable = selected_counts.get("unavailable_people")
    available = available if type(available) is int else 0
    unavailable = unavailable if type(unavailable) is int else 0
    pipeline = snapshot.get("pipeline")
    pipeline_state = pipeline.get("state") if isinstance(pipeline, dict) else None
    # A run that has not reached qualification has nothing to rank: that is a
    # prerequisite, not a stale or malformed selected ranking.  The allowance is
    # deliberately narrow and needs all of an explicit not-yet-ranked code, a
    # pre-research local pipeline, and nothing reviewed yet.  It never widens to
    # an older ranking, never suppresses another code, and never relaxes any
    # owning-service guard.
    not_ranked_yet = (
        type(selected_code) is str
        and selected_code in _SELECTED_NOT_RANKED_CODES
        and pipeline_state in _PRE_RESEARCH_PIPELINE_STATES
        and not people
        and not drafts
    )
    if pending:
        return {"title": "Resolve the pending draft review", "detail": "The edited candidate has not produced a validated revision.", "label": f"{len(pending)} blocked"}
    if any(item.get("editorial_gate_code") for item in drafts):
        return {"title": "Waiting for humanizer and independent review", "detail": "Required review stages are not connected yet. You can keep editing saved drafts.", "label": "Readiness blocked"}
    if review:
        return {"title": "Review saved drafts", "detail": "Editorial readiness never grants sending authority.", "label": f"{len(review)} to review"}
    if selected_state == "unavailable" and not not_ranked_yet:
        # The current selected ranking could not be read.  It is reported as such;
        # no earlier ranking is shown in its place.
        return {
            "title": "Selected ranking is unavailable",
            "detail": "The current selected ranking could not be read. No earlier ranking is shown in its place.",
            "label": selected_code if type(selected_code) is str else "Needs attention",
        }
    if not people:
        if pipeline_state == "input_pending":
            missing = pipeline.get("pending_fields") or []
            return {"title": "Complete the research brief", "detail": "Research has not started. Complete the remaining inputs before an adapter can be considered.", "label": f"{len(missing)} inputs needed"}
        funding = snapshot.get("funding")
        if isinstance(funding, dict) and funding.get("state") == "awaiting_qualification_factcheck":
            candidate_count = funding.get("candidate_count")
            count = candidate_count if type(candidate_count) is int else 0
            return {
                "title": "Funding evidence captured; factcheck pending",
                "detail": "Captured funding sources are saved. Factual review and person research are still pending.",
                "label": f"{count} candidate{'' if count == 1 else 's'}",
            }
        if pipeline_state == "awaiting_research_adapter":
            return {"title": "Brief saved; research is not connected yet", "detail": "The local intake is durable. No research is running.", "label": "Awaiting adapter"}
        if pipeline_state == "unavailable":
            return {"title": "Pipeline status unavailable", "detail": "Campaign review remains available. Refresh after the local pipeline record is repaired.", "label": "Needs attention"}
        return {"title": "Run the existing candidate workflow", "detail": "No discovery is launched by this review app.", "label": "People empty"}
    if not drafts:
        if available:
            return {
                "title": "Prepare the selected drafts",
                "detail": "Preparing a draft binds that exact selected person. Source confirmation stays pending until you confirm it.",
                "label": f"{available} selected",
            }
        if unavailable:
            return {
                "title": "Selected people are missing current proof",
                "detail": "The exact source behind every selected person is unavailable. No earlier ranking or unrelated record is shown in its place.",
                "label": f"{unavailable} unavailable",
            }
        campaign = snapshot.get("campaign")
        if isinstance(campaign, dict) and campaign.get("next_action") == "review_sources":
            return {"title": "Add a current-role source", "detail": "A saved source page is required before a proof-pending local draft can be prepared.", "label": "Source needed"}
        return {"title": "Prepare local email drafts", "detail": "Source confirmation and a contact address may remain visibly pending after drafting.", "label": "Draft locally"}
    return {"title": "Inspect the sending plan", "detail": "Schedule and approval state remain read-only here.", "label": "Review plan"}


class _DisabledControl:
    def status(self, campaign_id: str) -> ControlReviewStatus:
        return ControlReviewStatus(
            False, campaign_id, None, None, None, None, None,
            "not_applicable", "disabled", {},
        )

    def process(self, _campaign_id: str, _request_id: str) -> ControlReviewStatus:
        raise ControlReviewError("control_unavailable")


class ReviewHTTPServer(HTTPServer):
    """One-process server with a one-use bootstrap and one expiring session."""

    def __init__(
        self,
        address: tuple[str, int],
        review: ReviewService,
        campaigns: CampaignService,
        html: str,
        *,
        pipeline: object | None = None,
        editorial_pipeline: object | None = None,
        feedback: object | None = None,
        control: object | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        if address[0] != HOST:
            raise ValueError("loopback_required")
        self.review = review
        self.feedback = review if feedback is None else feedback
        self.control = _DisabledControl() if control is None else control
        self.campaigns = campaigns
        self.pipeline = pipeline
        self.editorial_pipeline = editorial_pipeline
        self.html_template = html
        self.monotonic = monotonic
        self.bootstrap_deadline = monotonic() + BOOTSTRAP_SECONDS
        self.bootstrap_used = False
        self.session_token: str | None = None
        self.csrf_token: str | None = None
        self.session_deadline = 0.0
        super().__init__(address, ReviewHandler)

    @property
    def authority(self) -> str:
        return f"{HOST}:{self.server_address[1]}"

    @property
    def cookie_name(self) -> str:
        return f"review_session_{self.server_address[1]}"

    def get_request(self) -> tuple[Any, Any]:
        connection, address = super().get_request()
        connection.settimeout(REQUEST_SECONDS)
        return connection, address

    def handle_error(self, _request: object, _client_address: object) -> None:
        return

    def bootstrap(self) -> tuple[str, str] | None:
        if self.bootstrap_used or self.monotonic() > self.bootstrap_deadline:
            return None
        self.bootstrap_used = True
        self.session_token = secrets.token_urlsafe(32)
        self.csrf_token = secrets.token_urlsafe(32)
        self.session_deadline = self.monotonic() + SESSION_SECONDS
        return self.session_token, self.csrf_token

    def session_valid(self, token: str | None) -> bool:
        return bool(
            token
            and self.session_token
            and self.monotonic() <= self.session_deadline
            and hmac.compare_digest(token, self.session_token)
        )


class ReviewHandler(BaseHTTPRequestHandler):
    server: ReviewHTTPServer
    protocol_version = "HTTP/1.1"
    server_version = "ReviewLocal/1"
    sys_version = ""

    def log_message(self, _format: str, *_args: object) -> None:
        return

    # ``BaseHTTPRequestHandler`` reuses one handler instance for the lifetime of
    # a connection, so per-request state is initialised in ``handle_one_request``
    # rather than only in ``__init__``.  The class default is the conservative
    # one: a body is treated as already consumed, so nothing is ever discarded
    # unless this request explicitly declared an unread, safely framed body.
    _body_consumed: bool = True

    def handle_one_request(self) -> None:
        self._body_consumed = False
        super().handle_one_request()

    def send_error(
        self,
        code: int,
        _message: str | None = None,
        _explain: str | None = None,
    ) -> None:
        self._error(code, "request_invalid")

    def handle_expect_100(self) -> bool:
        self._error(HTTPStatus.EXPECTATION_FAILED, "request_framing")
        return False

    def _headers(self, status: int, content_type: str, length: int, extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Connection", "close")
        for key, value in _SECURITY_HEADERS.items():
            self.send_header(key, value)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def _bytes(self, status: int, body: bytes, content_type: str, extra: dict[str, str] | None = None) -> None:
        self._headers(status, content_type, len(body), extra)
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, value: object) -> None:
        body = json.dumps(_jsonable(value), sort_keys=True, separators=(",", ":")).encode("utf-8")
        self._bytes(status, body, "application/json; charset=utf-8")

    def _error(self, status: int, code: str) -> None:
        self._json(status, {"error": code})

    def _valid_host(self) -> bool:
        values = self.headers.get_all("Host", failobj=[])
        return len(values) == 1 and hmac.compare_digest(values[0], self.server.authority)

    def _valid_get_framing(self) -> bool:
        return not self.headers.get_all("Transfer-Encoding", failobj=[]) and not self.headers.get_all("Content-Length", failobj=[])

    def _session_cookie(self) -> str | None:
        values = self.headers.get_all("Cookie", failobj=[])
        if len(values) != 1:
            return None
        try:
            cookie = SimpleCookie(values[0])
            name = self.server.cookie_name
            return cookie[name].value if name in cookie else None
        except Exception:
            return None

    def _authorized(self) -> bool:
        return self.server.session_valid(self._session_cookie())

    def _path(self) -> tuple[str, dict[str, list[str]]] | None:
        try:
            parsed = urlsplit(self.path)
            if parsed.scheme or parsed.netloc or parsed.fragment:
                return None
            return parsed.path, parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
        except ValueError:
            return None

    def do_GET(self) -> None:  # noqa: N802 -- stdlib handler API
        try:
            if not self._valid_host() or not self._valid_get_framing():
                self._error(HTTPStatus.BAD_REQUEST, "request_invalid")
                return
            target = self._path()
            if target is None:
                self._error(HTTPStatus.BAD_REQUEST, "request_invalid")
                return
            path, query = target
            if path == "/bootstrap":
                if query:
                    self._error(HTTPStatus.BAD_REQUEST, "request_invalid")
                    return
                if self._authorized():
                    self._bytes(
                        HTTPStatus.SEE_OTHER,
                        b"",
                        "text/plain; charset=utf-8",
                        {"Location": "/"},
                    )
                    return
                issued = self.server.bootstrap()
                if issued is None:
                    self._error(HTTPStatus.GONE, "bootstrap_unavailable")
                    return
                session, _csrf = issued
                cookie = f"{self.server.cookie_name}={session}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}"
                self._bytes(
                    HTTPStatus.SEE_OTHER,
                    b"",
                    "text/plain; charset=utf-8",
                    {"Set-Cookie": cookie, "Location": "/"},
                )
                return
            if path == "/" and not query:
                if not self._authorized():
                    if self.server.bootstrap_used:
                        self._bytes(HTTPStatus.UNAUTHORIZED, _EXPIRED_HTML, "text/html; charset=utf-8")
                    else:
                        self._bytes(HTTPStatus.SEE_OTHER, b"", "text/plain; charset=utf-8", {"Location": "/bootstrap"})
                    return
                csrf = self.server.csrf_token or ""
                body = self.server.html_template.replace("{{CSRF_TOKEN}}", csrf).encode("utf-8")
                self._bytes(HTTPStatus.OK, body, "text/html; charset=utf-8")
                return
            if path == "/api/review" and self._authorized():
                self._review_snapshot(query)
                return
            if path == "/api/campaigns/creation-status" and self._authorized():
                # Read-only: the existing Host and session checks above already
                # protect it, and it reaches no mutable campaign operation.
                self._creation_status(query)
                return
            format_prefix = "/api/campaigns/"
            format_suffix = "/selected-draft-format"
            if (
                path.startswith(format_prefix) and path.endswith(format_suffix)
                and self._authorized()
            ):
                campaign_id = path[len(format_prefix):-len(format_suffix)]
                if query or "/" in campaign_id:
                    self._error(HTTPStatus.BAD_REQUEST, "request_invalid")
                    return
                self._json(
                    HTTPStatus.OK,
                    self.server.campaigns.selected_draft_format_status(campaign_id),
                )
                return
            if path == "/favicon.ico" and not query:
                self._bytes(HTTPStatus.NO_CONTENT, b"", "image/x-icon")
                return
            self._error(HTTPStatus.UNAUTHORIZED if not self._authorized() else HTTPStatus.NOT_FOUND, "session_required" if not self._authorized() else "route_missing")
        except CampaignError as error:
            code = str(error)
            self._error(
                HTTPStatus.NOT_FOUND if code == "campaign_missing" else HTTPStatus.UNPROCESSABLE_ENTITY,
                code if code in _SELECTED_DRAFT_FORMAT_CODES else "selected_draft_format_unavailable",
            )
        except ReviewError as error:
            code = str(error)
            status = HTTPStatus.NOT_FOUND if code.endswith("_missing") else HTTPStatus.UNPROCESSABLE_ENTITY
            self._error(status, code)
        except Exception:
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, "internal_error")

    def _review_snapshot(self, query: dict[str, list[str]]) -> None:
        if set(query) - {"campaign_id"} or len(query.get("campaign_id", [])) > 1:
            self._error(HTTPStatus.BAD_REQUEST, "request_schema")
            return
        campaigns = [_jsonable(item) for item in self.server.review.list_campaigns()]
        snapshot: dict[str, object] = {
            "campaigns": campaigns,
            "sender_profiles": [_jsonable(item) for item in self.server.review.list_sender_profiles()],
            "mailboxes": list(self.server.review.list_mailboxes()),
            "people": [], "drafts": [], "feedback": [], "schedule": [], "activity": [],
            "control": None,
            "pipeline": None,
            "funding": None,
            "selected_pipeline": None,
            "selected_draft_format": None,
            "editorial_pipeline": [],
            "unmet_inputs": [],
        }
        campaign_id = query.get("campaign_id", [""])[0]
        if campaign_id:
            if _ENTITY_ID.fullmatch(campaign_id) is None:
                self._error(HTTPStatus.BAD_REQUEST, "invalid_campaign_id")
                return
            drafts = [_jsonable(item) for item in self.server.review.list_drafts(campaign_id)]
            snapshot.update(
                campaign=_jsonable(self.server.review.get_campaign(campaign_id)),
                funding=_jsonable(self.server.review.get_funding_review(campaign_id)),
                people=[_jsonable(item) for item in self.server.review.list_people(campaign_id)],
                drafts=drafts,
                feedback=[_jsonable(item) for item in self.server.feedback.list_feedback(campaign_id)],
                schedule=[_jsonable(item) for item in self.server.review.list_schedule(campaign_id)],
                activity=[_jsonable(item) for item in self.server.review.list_activity(campaign_id)],
            )
            if isinstance(self.server.review, ReviewService):
                # The exact typed selected projection for the chosen campaign.  An
                # unavailable ranking or a shortfall stays visible in its own state
                # and is never replaced by an older ranking.
                snapshot["selected_pipeline"] = _jsonable(
                    self.server.review.get_selected_pipeline(campaign_id),
                )
            if isinstance(self.server.campaigns, CampaignService):
                try:
                    snapshot["selected_draft_format"] = _jsonable(
                        self.server.campaigns.selected_draft_format_status(campaign_id),
                    )
                except CampaignError as error:
                    code = str(error)
                    snapshot["selected_draft_format"] = {
                        "campaign_id": campaign_id,
                        "state": "unavailable",
                        "code": (
                            code if code in _SELECTED_DRAFT_FORMAT_CODES
                            else "selected_draft_format_unavailable"
                        ),
                    }
                except sqlite3.Error:
                    # A driver-level failure (e.g. a legacy schema missing the
                    # selected-draft-format tables, or a failed lookup) is never
                    # stringified or forwarded: it carries no owning-service
                    # fixed code and may include raw driver/path text.  Every
                    # other review section stays visible below.
                    snapshot["selected_draft_format"] = {
                        "campaign_id": campaign_id,
                        "state": "unavailable",
                        "code": "selected_draft_format_unavailable",
                    }
            try:
                snapshot["control"] = _jsonable(self.server.control.status(campaign_id))
            except (ControlReviewError, ControlError) as error:
                snapshot["control"] = {
                    "enabled": False, "campaign_id": campaign_id,
                    "code": str(error) or "control_status_unavailable",
                }
            except Exception:
                snapshot["control"] = {
                    "enabled": False, "campaign_id": campaign_id,
                    "code": "control_status_unavailable",
                }
            if self.server.pipeline is not None:
                try:
                    pipeline = self.server.pipeline.get_latest_projection(campaign_id)
                except PipelineError as error:
                    pipeline = None
                    if str(error) != "invalid_campaign_id":
                        snapshot["pipeline"] = {
                            "state": "unavailable", "code": str(error),
                            "pending_fields": [],
                        }
                if pipeline is not None:
                    safe_pipeline = _jsonable(pipeline)
                    snapshot["pipeline"] = safe_pipeline
                    snapshot["unmet_inputs"] = safe_pipeline.get("pending_fields", [])
            if self.server.editorial_pipeline is not None:
                editorial: list[object] = []
                for draft in drafts:
                    revision_id = str(draft["revision_id"])
                    try:
                        projection = self.server.editorial_pipeline.get_latest_review_projection(
                            campaign_id, revision_id,
                        )
                        offer = None if projection is not None else (
                            self.server.editorial_pipeline.get_restart_offer(campaign_id, revision_id)
                        )
                    except PipelineStageError as error:
                        editorial.append({
                            "revision_id": revision_id,
                            "state": "unavailable",
                            "code": str(error) or "editorial_projection_unavailable",
                        })
                    else:
                        if projection is not None:
                            value = _jsonable(projection)
                            if not isinstance(value, dict):
                                raise TypeError("response_schema")
                            value["revision_id"] = revision_id
                            editorial.append(value)
                        elif offer is not None:
                            editorial.append(_jsonable(offer))
                snapshot["editorial_pipeline"] = editorial
        snapshot["next_action"] = _next_action(snapshot)
        self._json(HTTPStatus.OK, snapshot)

    def _creation_status(self, query: dict[str, list[str]]) -> None:
        """Answer one opaque creation-status question for a saved request key.

        Closed query shape: exactly one ``request_id`` parameter and nothing
        else, so an extra or repeated parameter is refused rather than silently
        ignored.  The response carries only the fixed state plus the opaque
        request and campaign identifiers -- never brief, fit, sender profile,
        mailbox, policy, model or exception text.  A key with no saved campaign
        is an ordinary successful ``not_found`` answer, not a refusal.
        """
        values = query.get("request_id", [])
        if set(query) != {"request_id"} or len(values) != 1:
            self._error(HTTPStatus.BAD_REQUEST, "request_schema")
            return
        try:
            status = self.server.campaigns.creation_status(values[0])
        except CampaignError as error:
            code = str(error)
            # A saved request key pointing at no campaign row is corruption, not
            # a clean not-found answer, so it is never reported as one.
            if code == "campaign_missing":
                code = "campaign_state_invalid"
            self._error(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                code if code in _CREATION_STATUS_CODES else "creation_status_unavailable",
            )
            return
        except sqlite3.Error:
            # Driver-level text may carry a local path; it is never forwarded.
            self._error(HTTPStatus.UNPROCESSABLE_ENTITY, "creation_status_unavailable")
            return
        self._json(HTTPStatus.OK, {
            "state": status.state,
            "request_id": status.request_id,
            "campaign_id": status.campaign_id,
        })

    def _read_json(self, *, max_bytes: int = MAX_JSON_BYTES) -> object:
        lengths = self.headers.get_all("Content-Length", failobj=[])
        transfers = self.headers.get_all("Transfer-Encoding", failobj=[])
        expects = self.headers.get_all("Expect", failobj=[])
        content_types = self.headers.get_all("Content-Type", failobj=[])
        if transfers or expects or len(lengths) != 1 or len(content_types) != 1 or content_types[0].casefold() != "application/json":
            raise ValueError("request_framing")
        if (
            not lengths[0].isascii()
            or not lengths[0].isdigit()
            or len(lengths[0]) > MAX_CONTENT_LENGTH_DIGITS
        ):
            # Rejected as framing before conversion, so no interpreter-generated
            # conversion message can reach the caller as an error code.
            raise ValueError("request_framing")
        length = int(lengths[0])
        if length <= 0:
            raise ValueError("request_framing")
        if length > max_bytes:
            raise OverflowError("request_too_large")
        # Past this point the body is (at least partly) consumed, so a later
        # refusal on this same request must not attempt to discard it again.
        self._body_consumed = True
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise ValueError("request_framing")
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("request_json") from None

    def _csrf_valid(self) -> bool:
        values = self.headers.get_all("X-CSRF-Token", failobj=[])
        origin = self.headers.get_all("Origin", failobj=[])
        expected = self.server.csrf_token
        return bool(
            expected and len(values) == 1 and hmac.compare_digest(values[0], expected)
            and (not origin or (len(origin) == 1 and hmac.compare_digest(origin[0], f"http://{self.server.authority}")))
        )

    def _refusal_length(self, max_bytes: int) -> int | None:
        """Exact unread body length that is safe to discard after a refusal.

        ``None`` means "read nothing".  That covers a request with no body, a
        body this request already consumed, and any framing this boundary does
        not interpret: chunked transfer coding, ``Expect``, or a missing,
        duplicated, over-long or malformed ``Content-Length``.  The declared
        length is bounded as a string first: this runs after the refusal has
        been sent, so it must not raise.  No unbounded header-derived
        value is ever used: a declared length above the route's existing cap is
        refused rather than drained.
        """
        if self._body_consumed or self.command != "POST":
            return None
        lengths = self.headers.get_all("Content-Length", failobj=[])
        if (
            self.headers.get_all("Transfer-Encoding", failobj=[])
            or self.headers.get_all("Expect", failobj=[])
            or len(lengths) != 1
            or not lengths[0].isascii()
            or not lengths[0].isdigit()
            or len(lengths[0]) > MAX_CONTENT_LENGTH_DIGITS
        ):
            return None
        length = int(lengths[0])
        return length if 0 < length <= max_bytes else None

    def _drain_refused_body(self, max_bytes: int) -> None:
        """Discard an unread, safely framed body after the refusal was sent.

        A peer may still be writing the body when the refusal is flushed.
        Closing with unread bytes queued lets the transport abort the connection
        instead of sending an ordinary FIN, which can destroy the response the
        peer has not read yet.  Reading the declared body back first keeps the
        close orderly.  That is a consequence of closing mid-request, not
        OS-specific noise, so it is applied uniformly rather than conditionally.

        The read is bounded twice: by the route's existing byte cap, and by one
        absolute wall-clock deadline that is never extended by newly arriving
        data.  Nothing read here is decoded, parsed, forwarded to any service,
        or allowed to change the refusal that was already sent.
        """
        length = self._refusal_length(max_bytes)
        if length is None:
            return
        self._body_consumed = True
        deadline = time.monotonic() + MAX_REFUSAL_DRAIN_SECONDS
        connection = self.connection
        try:
            previous = connection.gettimeout()
        except OSError:
            return
        reader = self.rfile
        # ``read1`` hands back whatever the BufferedReader already holds without
        # demanding another syscall, so a small body that arrived while the
        # request headers were being parsed is consumed immediately.
        read_some = getattr(reader, "read1", reader.read)
        remaining = length
        try:
            while remaining > 0:
                budget = deadline - time.monotonic()
                if budget <= 0:
                    return
                connection.settimeout(budget)
                chunk = read_some(min(remaining, REFUSAL_DRAIN_CHUNK_BYTES))
                if not chunk:
                    return
                remaining -= len(chunk)
        except (OSError, ValueError):
            # Only the expected peer-side outcomes: a timeout, a reset or abort,
            # or an already-closed stream.  The refusal has been sent, nothing is
            # retried, and no other failure is suppressed here.
            return
        finally:
            try:
                connection.settimeout(previous)
            except OSError:
                pass

    def _refuse(self, status: int, code: str, max_bytes: int = MAX_JSON_BYTES) -> None:
        """Send a refusal, then discard only a safely framed unread body.

        The ordering is deliberate: the response is written and flushed before a
        single body byte is read, so a client that never sends its body still
        receives the complete refusal.  Host, session and CSRF ordering is
        unchanged -- this runs strictly after the refusal has been decided and
        emitted, and never parses or acts on the discarded bytes.
        """
        self._error(status, code)
        try:
            self.wfile.flush()
        except OSError:
            return
        self._drain_refused_body(max_bytes)

    def do_POST(self) -> None:  # noqa: N802 -- stdlib handler API
        try:
            if not self._valid_host():
                self._refuse(HTTPStatus.BAD_REQUEST, "request_invalid")
                return
            if not self._authorized():
                self._refuse(HTTPStatus.UNAUTHORIZED, "session_required")
                return
            if not self._csrf_valid():
                self._refuse(HTTPStatus.FORBIDDEN, "csrf_invalid")
                return
            target = self._path()
            if target is None or target[1]:
                self._refuse(HTTPStatus.BAD_REQUEST, "request_invalid")
                return
            limit = (
                MAX_SOURCE_UPLOAD_JSON_BYTES
                if target[0] == "/api/people/import-source" else MAX_JSON_BYTES
            )
            try:
                payload = self._read_json(max_bytes=limit)
            except OverflowError:
                # An oversized declared length keeps its immediate 413 and is
                # never drained: the cap exists so that body is never read.
                self._refuse(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "request_too_large", limit,
                )
                return
            except ValueError as error:
                self._refuse(HTTPStatus.BAD_REQUEST, str(error), limit)
                return
            path = target[0]
            if path == "/api/campaigns":
                value = _require_object(payload, {"request_id", "brief_text", "sender_profile_id", "mailbox_id"}, {"drafting"})
                drafting = value.get("drafting")
                settings = None
                if drafting is not None:
                    draft_value = _require_object(drafting, {"step", "minimum_confidence", "model_version"})
                    settings = DraftingSettings(**draft_value)
                result = self.server.campaigns.create(
                    request_id=value["request_id"], brief_text=value["brief_text"],
                    sender_profile_id=value["sender_profile_id"], mailbox_id=value["mailbox_id"], drafting=settings,
                    require_first_draft_compatible=True,
                )
                self._json(
                    HTTPStatus.CREATED if result.created else HTTPStatus.OK,
                    {"campaign_id": result.campaign_id, "created": result.created},
                )
                return
            if path == "/api/drafts/prepare":
                value = _require_object(payload, {"campaign_id", "step"})
                if type(value["step"]) is not int or value["step"] != 0:
                    raise ValueError("request_schema")
                self._json(
                    HTTPStatus.OK,
                    self.server.review.prepare_drafts(value["campaign_id"], value["step"]),
                )
                return
            if path == "/api/pipeline/start":
                value = _require_object(
                    payload,
                    {
                        "request_id", "campaign_id", "as_of_date", "funding_stage_min",
                        "funding_stage_max", "funding_window_years",
                        "funding_stage_interpretation", "geography", "sector",
                        "requested_companies", "requested_people_per_company", "role_families",
                    },
                    {"original_specification", "outreach_goal"},
                )
                if self.server.pipeline is None or not isinstance(value["role_families"], list):
                    raise ValueError("request_schema")
                scopes: dict[str, ScopeSpec] = {}
                for field in ("geography", "sector"):
                    scope = _require_object(value[field], {"mode"}, {"values"})
                    if "values" in scope and not isinstance(scope["values"], list):
                        raise ValueError("request_schema")
                    scopes[field] = ScopeSpec(scope["mode"], tuple(scope.get("values", [])))
                request = PipelineStartRequest(
                    request_id=value["request_id"], campaign_id=value["campaign_id"],
                    as_of_date=value["as_of_date"], funding_stage_min=value["funding_stage_min"],
                    funding_stage_max=value["funding_stage_max"],
                    funding_window_years=value["funding_window_years"],
                    funding_stage_interpretation=value["funding_stage_interpretation"],
                    geography=scopes["geography"], sector=scopes["sector"],
                    requested_companies=value["requested_companies"],
                    requested_people_per_company=value["requested_people_per_company"],
                    role_families=tuple(value["role_families"]),
                    original_specification=value.get("original_specification", ""),
                    outreach_goal=value.get("outreach_goal", ""),
                )
                result = self.server.pipeline.start_or_resume(request)
                self._json(HTTPStatus.OK if result.replayed else HTTPStatus.CREATED, result)
                return
            if path == "/api/people/verify-source":
                value = _require_object(payload, {
                    "request_id", "campaign_id", "person_id", "expected_observation_id",
                    "observation_id", "attested",
                })
                self._json(
                    HTTPStatus.OK,
                    self.server.review.verify_current_role_source(VerifyIdentitySourceRequest(**value)),
                )
                return
            format_prefix = "/api/campaigns/"
            format_suffix = "/selected-draft-format"
            if path.startswith(format_prefix) and path.endswith(format_suffix):
                campaign_id = path[len(format_prefix):-len(format_suffix)]
                value = _require_object(
                    payload, {"campaign_id", "expected_policy_state_hash"},
                )
                if campaign_id != value["campaign_id"] or "/" in campaign_id:
                    raise ValueError("request_schema")
                try:
                    result = self.server.campaigns.configure_selected_draft_format(
                        campaign_id, value["expected_policy_state_hash"],
                    )
                except CampaignError as error:
                    code = str(error)
                    raise CampaignError(
                        code if code in _SELECTED_DRAFT_FORMAT_CODES
                        else "selected_draft_format_unavailable"
                    ) from None
                self._json(HTTPStatus.OK, result)
                return
            if path == "/api/selected-drafts/materialize":
                value = _require_object(
                    payload,
                    {
                        "request_id", "campaign_id", "run_id", "person_rank_id",
                        "expected_ranking_batch_hash",
                    },
                    {"expected_revision_id", "expected_predecessor_binding_hash"},
                )
                if (
                    ("expected_revision_id" in value)
                    != ("expected_predecessor_binding_hash" in value)
                ):
                    # The owning service requires both regeneration pins or neither.
                    # This boundary supplies no expectation and defaults none.
                    raise ValueError("request_schema")
                result = self.server.review.materialize_selected_draft(
                    SelectedDraftRequest(**value),
                )
                self._json(
                    HTTPStatus.CREATED
                    if not result.replayed and result.state in {"bound", "regenerated"}
                    else HTTPStatus.OK,
                    result,
                )
                return
            if path == "/api/selected-sources/attest":
                value = _require_object(payload, {
                    "request_id", "campaign_id", "person_id", "expected_revision_id",
                    "expected_source_context_digest",
                    "expected_candidate_observation_id", "attested",
                })
                # ``attested`` is required and explicit here: it is never defaulted to
                # True, and no actor is supplied by this API.
                if type(value["attested"]) is not bool:
                    raise ValueError("request_schema")
                self._json(
                    HTTPStatus.OK,
                    self.server.review.attest_selected_source(
                        SelectedSourceAttestationRequest(**value),
                    ),
                )
                return
            if path == "/api/editorial/start":
                value = _require_object(
                    payload, {"request_id", "campaign_id", "revision_id"},
                    {"exhausted_item_id"},
                )
                if self.server.editorial_pipeline is None:
                    raise ValueError("request_schema")
                if "exhausted_item_id" in value:
                    result = self.server.editorial_pipeline.start_from_human_edit(
                        value["campaign_id"], value["revision_id"],
                        value["exhausted_item_id"], value["request_id"], _LOCAL_REVIEW_ACTOR,
                    )
                else:
                    result = self.server.editorial_pipeline.start_from_saved_revision(
                        value["campaign_id"], value["revision_id"], value["request_id"],
                    )
                self._json(HTTPStatus.CREATED, result)
                return
            if path in {"/api/editorial/accept", "/api/editorial/reject"}:
                value = _require_object(
                    payload,
                    {"request_id", "campaign_id", "item_id", "expected_parent_revision_id"},
                )
                if self.server.editorial_pipeline is None:
                    raise ValueError("request_schema")
                item = self.server.editorial_pipeline.get_item(value["item_id"])
                if (
                    item.campaign_id != value["campaign_id"]
                    or item.base_revision_id != value["expected_parent_revision_id"]
                ):
                    raise PipelineStageError("revision_conflict")
                action = (
                    self.server.editorial_pipeline.accept_suggestion
                    if path.endswith("/accept")
                    else self.server.editorial_pipeline.reject_suggestion
                )
                self._json(
                    HTTPStatus.OK,
                    action(
                        value["item_id"], value["request_id"],
                        value["expected_parent_revision_id"], _LOCAL_REVIEW_ACTOR,
                    ),
                )
                return
            if path == "/api/people/import-source":
                value = _require_object(
                    payload, {"campaign_id", "person_id", "source_url", "body"},
                )
                self._json(
                    HTTPStatus.OK,
                    self.server.review.import_current_role_source(ImportIdentitySourceRequest(**value)),
                )
                return
            if path == "/api/drafts/edit":
                value = _require_object(
                    payload,
                    {"request_id", "campaign_id", "expected_revision_id", "subject", "body"},
                    {"expected_candidate_id"},
                )
                self._json(HTTPStatus.OK, self.server.review.edit_draft(EditDraftRequest(**value)))
                return
            if path == "/api/drafts/feedback":
                value = _require_object(payload, {"request_id", "campaign_id", "expected_revision_id", "disposition", "tags", "text"})
                tags = value["tags"]
                if not isinstance(tags, list):
                    raise ValueError("request_schema")
                request = FeedbackRequest(
                    request_id=value["request_id"], campaign_id=value["campaign_id"],
                    expected_revision_id=value["expected_revision_id"],
                    disposition=value["disposition"], tags=tuple(tags), text=value["text"],
                )
                self._json(HTTPStatus.ACCEPTED, self.server.review.request_feedback(request))
                return
            if path == "/api/feedback/fulfill":
                value = _require_object(
                    payload,
                    {"request_id", "campaign_id", "feedback_id", "expected_child_revision_id"},
                )
                self._json(
                    HTTPStatus.OK,
                    self.server.feedback.fulfill(FulfillFeedbackRequest(**value)),
                )
                return
            if path == "/api/control/process":
                value = _require_object(
                    payload, {"campaign_id", "configured_request_id"},
                )
                self._json(
                    HTTPStatus.OK,
                    self.server.control.process(
                        value["campaign_id"], value["configured_request_id"],
                    ),
                )
                return
            if path == "/api/drafts/ready":
                value = _require_object(payload, {"request_id", "campaign_id", "expected_revision_id", "ready"})
                self._json(HTTPStatus.OK, self.server.review.set_editorial_ready(EditorialRequest(**value)))
                return
            self._error(HTTPStatus.NOT_FOUND, "route_missing")
        except (CampaignError, ControlError, ControlReviewError, FeedbackError, PipelineError, PipelineStageError, ReviewError) as error:
            code = str(error) if str(error) else "request_invalid"
            status = HTTPStatus.CONFLICT if code in {"request_conflict", "revision_conflict", "candidate_conflict", "candidate_pending", "editorial_receipts_missing", "feedback_already_requested", "feedback_already_fulfilled", "feedback_revision_conflict", "transaction_active", "source_conflict", "suggestion_already_decided", "pipeline_item_exists", "pipeline_work_conflict"} else HTTPStatus.NOT_FOUND if code.endswith("_missing") else HTTPStatus.UNPROCESSABLE_ENTITY
            self._error(status, code)
        except (ValueError, TypeError):
            self._error(HTTPStatus.UNPROCESSABLE_ENTITY, "request_schema")
        except Exception:
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, "internal_error")


def create_server(
    review: ReviewService,
    campaigns: CampaignService,
    *,
    port: int = 0,
    html_path: Path = HTML_PATH,
    feedback: object | None = None,
    control: object | None = None,
    pipeline: object | None = None,
    editorial_pipeline: object | None = None,
    monotonic: Callable[[], float] = time.monotonic,
) -> ReviewHTTPServer:
    html = html_path.read_text(encoding="utf-8")
    if "{{CSRF_TOKEN}}" not in html:
        raise ValueError("html_csrf_marker_missing")
    if isinstance(review, ReviewService):
        if isinstance(feedback, FeedbackService) and feedback.connection is not review.connection:
            raise ValueError("feedback_store_mismatch")
        if isinstance(control, ControlReviewAdapter) and control.connection is not review.connection:
            raise ValueError("control_store_mismatch")
        if isinstance(pipeline, PipelineService) and pipeline.connection is not review.connection:
            raise ValueError("pipeline_store_mismatch")
        if isinstance(editorial_pipeline, PipelineStageService) and editorial_pipeline.connection is not review.connection:
            raise ValueError("editorial_pipeline_store_mismatch")
    feedback_owner = FeedbackService(review.connection) if feedback is None and isinstance(
        review, ReviewService
    ) else review if feedback is None else feedback
    control_owner = ControlReviewAdapter(review.connection) if control is None and isinstance(
        review, ReviewService
    ) else control
    pipeline_owner = PipelineService(review.connection) if pipeline is None and isinstance(
        review, ReviewService
    ) else pipeline
    editorial_pipeline_owner = PipelineStageService(review.connection) if editorial_pipeline is None and isinstance(
        review, ReviewService
    ) else editorial_pipeline
    return ReviewHTTPServer(
        (HOST, port), review, campaigns, html, feedback=feedback_owner,
        control=control_owner, pipeline=pipeline_owner,
        editorial_pipeline=editorial_pipeline_owner, monotonic=monotonic,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="prospecting-review")
    parser.add_argument("--store", type=Path)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    database, anchors_file = _selected_store_context(args.store)
    connection = open_store(database)
    try:
        server = create_server(
            ReviewService(
                connection,
                prepare_adapter=_draft_preparer(connection, anchors_file),
                source_verifier=lambda proof: verify_snapshot(
                    database.parent / "snapshots", proof, now=datetime.now(timezone.utc),
                ),
                source_importer=_source_importer(connection),
            ),
            CampaignService(connection),
            port=args.port,
            feedback=FeedbackService(connection),
        )
    except OSError:
        connection.close()
        parser.exit(2, "review server could not start\n")
    try:
        print(f"Prospecting review is available at http://{server.authority}/")
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
