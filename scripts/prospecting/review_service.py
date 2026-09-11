"""Typed desktop-local projections and draft review mutations.

The service never schedules, sends, calls a model, or creates an approval. Human
edits remain review candidates until an injected deterministic QA adapter passes;
only then does the existing revision owner persist the canonical revision.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import re
import sqlite3
from typing import TYPE_CHECKING
import uuid

from scripts.prospecting.personalizer.qa import QaResult
from scripts.prospecting.funding_research_service import (
    FundingResearchError,
    FundingResearchService,
)
from scripts.prospecting.pipeline_service import PipelineError, PipelineService
from scripts.prospecting.affinity.evidence_bridge import (
    attested_current_role_source,
    current_role_source_proof,
    resolve_slot_facts,
)
from scripts.prospecting.affinity.score import Affinity
from scripts.prospecting.affinity.templates_v2 import DraftError, DraftSummary
from scripts.prospecting.affinity.source_review import (
    MAX_SOURCE_BYTES,
    SnapshotProof,
    contains_identity,
    identity_excerpt,
)
from scripts.prospecting.personalizer.revision import (
    RevisionInput,
    build_revision,
    revision_hash,
)
from scripts.prospecting.review_qa import (
    ReviewQaDecision,
    ReviewQaUnavailable,
    StoredReviewQa,
    propagate_revision_qa_context,
)
from scripts.prospecting.selected_review_projection import (
    SelectedPersonProjection,
    SelectedPipelineProjection,
    build_selected_pipeline_projection,
)
from scripts.prospecting.store import approval_scope_hash


if TYPE_CHECKING:  # pragma: no cover - typing only; runtime imports stay lazy.
    from scripts.prospecting.selected_draft_service import (
        SelectedDraftReceipt,
        SelectedDraftRequest,
    )
    from scripts.prospecting.selected_source_review import (
        SelectedSourceAttestationReceipt,
        SelectedSourceAttestationRequest,
    )


MAX_SUBJECT = 998
MAX_BODY = 65_536
MAX_FEEDBACK = 16_384
_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
_SAFE_TAG = re.compile(r"[a-z][a-z0-9_-]{0,31}\Z")
_DISPOSITIONS = frozenset({"tone", "length", "specificity", "accuracy", "ask", "other"})
_PREPARE_BLOCKERS = frozenset({
    "sender_anchors_missing", "sender_profile_invalid", "approved_fit_spec_missing",
    "approved_fit_spec_invalid", "campaign_not_draft", "copy_profile_missing",
    "copy_profile_invalid", "intent_unsupported", "ask_type_unsupported",
    "ask_minutes_unsupported", "evidence_identity_source_mismatch",
})
# The exact fixed refusal codes this boundary may forward unchanged from the two
# selected services.  Anything outside these sets collapses to one generic code, so
# no dynamic store or driver text can ever reach a local UI response.
_SELECTED_DRAFT_CODES = frozenset({
    "invalid_request", "invalid_request_id", "invalid_campaign_id", "invalid_run_id",
    "invalid_person_rank_id", "invalid_ranking_batch_hash", "invalid_revision_id",
    "invalid_binding_hash", "regeneration_expectations_incomplete",
    "regeneration_context_unchanged", "predecessor_binding_missing",
    "predecessor_binding_stale", "stale_expected_revision",
    "expected_revision_unrelated", "selected_draft_superseded",
    "selected_draft_regeneration_required", "selected_revision_already_bound",
    "unbound_revision_present", "human_edit_unresolved", "pipeline_work_active",
    "agent_suggestion_pending", "selected_binding_missing",
    "selected_binding_scope_mismatch", "selected_source_stale",
    "selected_render_context_stale", "render_context_stale", "source_changed",
    "source_stale", "revision_missing", "revision_lineage_unverified",
    "revision_lineage_ambiguous", "revision_lineage_cycle",
    "revision_lineage_scope_mismatch", "revision_lineage_too_deep",
    "binding_integrity_failed", "request_conflict", "transaction_active",
    "store_busy", "store_state_invalid", "selected_draft_cleanup_failed",
    "aware_now_required",
})
_SELECTED_ATTESTATION_CODES = frozenset({
    "invalid_request", "invalid_request_id", "invalid_campaign_id",
    "invalid_person_id", "invalid_revision_id", "invalid_source_context_digest",
    "invalid_observation_id", "source_attestation_required", "request_conflict",
    "attestation_integrity_failed", "selected_draft_missing",
    "stale_expected_revision", "selected_scope_mismatch", "source_context_conflict",
    "source_candidate_conflict", "selected_binding_missing", "selected_binding_stale",
    "selected_binding_scope_mismatch", "selected_source_identity_mismatch",
    "selected_source_invalid", "selected_source_stale", "source_changed",
    "source_stale", "selected_render_context_stale", "revision_missing",
    "revision_lineage_unverified", "revision_lineage_ambiguous",
    "revision_lineage_cycle", "revision_lineage_scope_mismatch",
    "revision_lineage_too_deep", "transaction_active", "store_busy",
    "store_state_invalid", "attestation_cleanup_failed", "aware_now_required",
})


class ReviewError(ValueError):
    """A fixed-code refusal safe for a local UI response."""


def _editorial_gate_code(
    connection: sqlite3.Connection,
    campaign_id: str,
    revision_hash_value: str,
    now: str,
) -> str | None:
    """Translate the shared exact-revision gate to the review API's fixed code."""
    from scripts.prospecting.pipeline_stage_service import (
        PipelineStageError,
        require_revision_review_chain,
    )

    try:
        require_revision_review_chain(
            connection, campaign_id, revision_hash_value, now,
        )
    except PipelineStageError:
        return "editorial_receipts_missing"
    return None


@dataclass(frozen=True)
class SenderProfileView:
    sender_profile_id: str
    sender_name: str


@dataclass(frozen=True, repr=False)
class CampaignView:
    request_id: str | None
    campaign_id: str
    intent: str
    status: str
    sender_profile_id: str
    sender_name: str
    mailbox_id: str
    created_at: str | None
    people_count: int
    draft_count: int
    ready_count: int
    scheduled_count: int
    blocker_count: int
    next_action: str


@dataclass(frozen=True)
class FundingSourceView:
    source_url: str
    source_kind: str
    binding_kind: str
    retrieved_at: str


@dataclass(frozen=True)
class FundingCompanyView:
    name: str
    provisional_state: str
    reason_codes: tuple[str, ...]
    latest_stage: str | None
    latest_announced_at: str | None
    sources: tuple[FundingSourceView, ...]


@dataclass(frozen=True)
class FundingBatchView:
    state: str
    code: str | None = None
    batch_id: str | None = None
    batch_hash: str | None = None
    desired_companies: int = 0
    candidate_count: int = 0
    provisional_match_count: int = 0
    provisional_excluded_count: int = 0
    unknown_count: int = 0
    collision_count: int = 0
    provisional_shortfall: int = 0
    companies: tuple[FundingCompanyView, ...] = ()


@dataclass(frozen=True, repr=False)
class PersonView:
    """One person row for the local review list.

    ``repr`` is disabled.  This record carries a full name, a LinkedIn URL, an
    email address and a title, none of which may leak into logs or assertion
    output through the default dataclass repr.  The suppression covers exactly
    this record's own fields; :class:`IdentitySourceView` suppresses its own repr
    separately and that nested suppression never covered the fields listed above.
    Equality and frozen value semantics are unchanged.
    """

    person_id: str
    full_name: str
    title: str | None
    company: str | None
    linkedin_url: str | None
    fit_score: int | None
    eligibility_state: str | None
    contact_id: str | None
    email: str | None
    contact_state: str | None
    selected: bool
    state: str
    identity_source_state: str = "not_selected"
    identity_sources: tuple["IdentitySourceView", ...] = ()
    current_observation_id: str | None = None
    # P25 forward-projection fields.  They are safe opaque identifiers for a local
    # UI to hand back to the selected services, never authority of their own: the
    # owning command revalidates every one of them.
    person_rank_id: str | None = None
    run_id: str | None = None
    ranking_batch_hash: str | None = None
    source_context_digest: str | None = None
    projection_error_code: str | None = None


@dataclass(frozen=True, repr=False)
class IdentitySourceView:
    """One source candidate row.

    ``repr`` is disabled: this record carries a raw source excerpt and the source
    URL, neither of which may leak into logs or assertion output through the default
    dataclass repr.  Equality and frozen value semantics are unchanged.
    """

    observation_id: str
    snapshot_id: str
    source_url: str
    excerpt: str
    retrieved_at: str
    expires_at: str
    is_current: bool


@dataclass(frozen=True, repr=False)
class CandidateHistoryView:
    """One prior review candidate.  ``repr`` is disabled: it carries draft copy."""

    candidate_id: str
    parent_revision_id: str
    subject: str
    body: str
    qa_state: str
    failure_codes: tuple[str, ...]
    created_at: str
    is_current_parent: bool


@dataclass(frozen=True, repr=False)
class EvidenceView:
    """One cited evidence row.  ``repr`` is disabled: it carries claim text/URL."""

    evidence_id: str
    claim: str
    url: str
    observed_at: str | None
    retrieved_at: str


@dataclass(frozen=True, repr=False)
class DraftView:
    """One draft projection.

    ``repr`` is disabled: this record carries the draft copy, any pending candidate
    copy and (through :class:`IdentitySourceView`) a raw source excerpt.
    """

    person_id: str
    full_name: str
    revision_id: str
    revision_hash: str
    step: int
    subject: str
    body: str
    evidence: tuple[EvidenceView, ...]
    candidate_id: str | None
    candidate_subject: str | None
    candidate_body: str | None
    candidate_state: str | None
    qa_failure_codes: tuple[str, ...]
    candidate_history: tuple[CandidateHistoryView, ...]
    editorial_state: str
    approval_state: str
    approval_id: str | None
    feedback_state: str | None
    editorial_gate_code: str = "editorial_receipts_missing"
    identity_source_state: str = "source_unavailable"
    identity_source: IdentitySourceView | None = None
    current_observation_id: str | None = None
    contact_state: str = "missing"
    source_error_code: str | None = None
    # The exact revision this projection resolved its source proof through.
    source_revision_id: str | None = None
    # The exact selected source context digest of that same single proof.  It is
    # None on the legacy path and on every stale/error return: an unavailable proof
    # never claims the digest of whatever selection happens to be latest.
    source_context_digest: str | None = None
    # True whenever this projection was produced by the selected seam at all --
    # for a resolved selected proof and for every selected refusal alike.  It is
    # False only on the genuinely legacy (proof-is-None) path, so a consumer can
    # tell "the selected source is unavailable" from "this draft is legacy" and
    # never offers legacy verification for an unavailable selected root.
    selected_source_scope: bool = False


@dataclass(frozen=True, repr=False)
class ScheduleView:
    delivery_id: str
    person_id: str
    full_name: str
    revision_id: str
    revision_hash: str
    step: int
    scheduled_at: str | None
    enrollment_status: str
    delivery_state: str
    mailbox_id: str
    cadence: tuple[object, ...]
    send_window: str
    timezone: str
    daily_cap: int
    hourly_cap: int
    firm_collision_cap: int
    approval_state: str
    approval_id: str | None


@dataclass(frozen=True)
class ActivityView:
    event_id: str
    at: str
    action: str
    entity_type: str
    entity_id: str
    reason: str


@dataclass(frozen=True)
class CandidateRevision:
    campaign_id: str
    person_id: str
    parent_revision_id: str
    step: int
    subject: str
    body: str
    angle: str
    generation_mode: str
    purpose: str | None
    ask: str
    evidence_ids: tuple[str, ...]
    recipient_relevance_points: tuple[str, ...]
    sender_proof_points: tuple[str, ...]
    template_id: str
    template_version: int
    prompt_version: str
    model_version: str


@dataclass(frozen=True)
class EditDraftRequest:
    request_id: str
    campaign_id: str
    expected_revision_id: str
    subject: str
    body: str
    expected_candidate_id: str | None = None


@dataclass(frozen=True)
class FeedbackRequest:
    request_id: str
    campaign_id: str
    expected_revision_id: str
    disposition: str
    tags: tuple[str, ...] = ()
    text: str | None = None


@dataclass(frozen=True)
class EditorialRequest:
    request_id: str
    campaign_id: str
    expected_revision_id: str
    ready: bool


@dataclass(frozen=True)
class EditResult:
    request_id: str
    candidate_id: str
    revision_id: str
    state: str
    failure_codes: tuple[str, ...]
    replayed: bool


@dataclass(frozen=True)
class FeedbackResult:
    request_id: str
    feedback_id: str
    revision_id: str
    state: str
    replayed: bool


@dataclass(frozen=True)
class EditorialResult:
    request_id: str
    event_id: str
    revision_id: str
    state: str
    replayed: bool


@dataclass(frozen=True)
class PrepareDraftsResult:
    campaign_id: str
    step: int
    candidates: int
    revisions_created: int
    out_of_band: int
    qa_failed: int
    slots_clamped: int
    failure_codes: tuple[tuple[str, int], ...]


@dataclass(frozen=True)
class VerifyIdentitySourceRequest:
    request_id: str
    campaign_id: str
    person_id: str
    expected_observation_id: str
    observation_id: str
    attested: bool


@dataclass(frozen=True)
class VerifyIdentitySourceResult:
    request_id: str
    person_id: str
    observation_id: str
    state: str
    replayed: bool


@dataclass(frozen=True)
class ImportIdentitySourceRequest:
    campaign_id: str
    person_id: str
    source_url: str
    body: str


@dataclass(frozen=True)
class ImportIdentitySourceResult:
    campaign_id: str
    person_id: str
    snapshot_id: str
    state: str


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _safe_id(value: object, code: str) -> str:
    if type(value) is not str or _SAFE_ID.fullmatch(value) is None:
        raise ReviewError(code)
    return value


def _request_id(value: object) -> str:
    if type(value) is not str:
        raise ReviewError("invalid_request_id")
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError):
        raise ReviewError("invalid_request_id") from None
    if str(parsed) != value:
        raise ReviewError("invalid_request_id")
    return value


def _text(value: object, *, limit: int, code: str, multiline: bool) -> str:
    if type(value) is not str or not value.strip() or "\x00" in value:
        raise ReviewError(code)
    try:
        if len(value.encode("utf-8")) > limit:
            raise ReviewError(code)
    except UnicodeError:
        raise ReviewError(code) from None
    if not multiline and any(character in value for character in "\r\n"):
        raise ReviewError(code)
    return value


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    return _text(value, limit=MAX_FEEDBACK, code="invalid_feedback_text", multiline=True)


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _digest(operation: str, value: Mapping[str, object]) -> str:
    return hashlib.sha256(_canonical({"operation": operation, **value}).encode("utf-8")).hexdigest()


def _derived_id(kind: str, request_id: str) -> str:
    return f"{kind}_" + uuid.uuid5(uuid.NAMESPACE_URL, f"kb:review:{kind}:{request_id}").hex


def _utc_time(value: object) -> datetime:
    if type(value) is not str:
        raise ReviewError("store_state_invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed.astimezone(timezone.utc)
    except ValueError:
        raise ReviewError("store_state_invalid") from None


def _json_tuple(value: object, code: str) -> tuple[str, ...]:
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError):
        raise ReviewError(code) from None
    if not isinstance(parsed, list) or any(type(item) is not str for item in parsed):
        raise ReviewError(code)
    return tuple(parsed)


def _qa_payload(result: QaResult) -> dict[str, object]:
    return {
        "passed": result.passed,
        "qa_score": result.qa_score,
        "checks": dict(result.checks),
        "failure_codes": list(result.failure_codes),
        "self_critique": result.self_critique,
    }


def _valid_qa(value: object) -> QaResult | None:
    try:
        critique_size = len(value.self_critique.encode("utf-8")) if isinstance(value, QaResult) else 0
    except UnicodeError:
        return None
    if not isinstance(value, QaResult):
        return None
    if (
        type(value.passed) is not bool
        or type(value.qa_score) is not int or not 0 <= value.qa_score <= 100
        or not isinstance(value.checks, Mapping)
        or any(type(key) is not str or type(result) is not bool for key, result in value.checks.items())
        or type(value.failure_codes) is not tuple
        or any(type(code) is not str or _SAFE_TAG.fullmatch(code) is None for code in value.failure_codes)
        or type(value.self_critique) is not str
        or critique_size > MAX_FEEDBACK
        or (value.passed and (value.qa_score < 80 or value.failure_codes))
        or (not value.passed and not value.failure_codes)
    ):
        return None
    return value


def _valid_decision(value: object, parent_revision_id: str) -> ReviewQaDecision | None:
    if (
        not isinstance(value, ReviewQaDecision)
        or value.coverage != "stored_bindings_only"
        or value.context.revision_id != parent_revision_id
        or _valid_qa(value.qa) is None
    ):
        return None
    return value


class ReviewService:
    """Campaign-scoped read model and review-only mutation boundary."""

    def __init__(
        self,
        connection: sqlite3.Connection,
        *,
        now: Callable[[], str] = utc_now,
        qa_adapter: Callable[[CandidateRevision], ReviewQaDecision] | None = None,
        prepare_adapter: Callable[[str, int], DraftSummary] | None = None,
        source_verifier: Callable[[SnapshotProof], None] | None = None,
        source_importer: Callable[[str, str, str, bytes], str] | None = None,
    ) -> None:
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.now = now
        self.qa_adapter = qa_adapter or StoredReviewQa(
            connection, now=lambda: _utc_time(self.now())
        )
        self.prepare_adapter = prepare_adapter
        self.source_verifier = source_verifier
        self.source_importer = source_importer

    def _identity_scope(self, campaign_id: str, person_id: str) -> sqlite3.Row:
        row = self.connection.execute(
            """SELECT fp.campaign_id,fp.person_id,fp.company_id,e.employment_id,e.title,e.source_observation_id,
                      p.first_name,p.full_name,c.name AS company_name
                 FROM fill_person AS fp
                 JOIN person AS p ON p.person_id=fp.person_id
                 JOIN company AS c ON c.company_id=fp.company_id
                 JOIN employment AS e ON e.person_id=fp.person_id
                    AND e.company_id=fp.company_id AND e.valid_to IS NULL
                WHERE fp.campaign_id=? AND fp.person_id=? AND fp.substituted=0
                ORDER BY e.employment_id""", (campaign_id, person_id),
        ).fetchall()
        if len(row) != 1:
            raise ReviewError("identity_scope_missing")
        return row[0]

    @staticmethod
    def _source_excerpt(value: object) -> str:
        try:
            parsed = json.loads(str(value))
        except (TypeError, json.JSONDecodeError):
            return ""
        if isinstance(parsed, Mapping) and type(parsed.get("excerpt")) is str:
            return " ".join(parsed["excerpt"].split())[:240]
        return " ".join(parsed.split())[:240] if type(parsed) is str else ""

    def _identity_sources(self, campaign_id: str, person_id: str) -> tuple[IdentitySourceView, ...]:
        scope = self._identity_scope(campaign_id, person_id)
        ready = self._identity_source_ready(scope)
        rows = self.connection.execute(
            """SELECT o.observation_id,o.value,o.entity_type,o.entity_id,o.field,o.snapshot_id,
                      s.entity_id AS snapshot_entity_id,s.source_url,s.retrieved_at,s.expires_at
                 FROM source_observation AS o JOIN source_snapshot AS s ON s.snapshot_id=o.snapshot_id
                WHERE o.field IN ('employment','employer','current_employer','source_review_candidate')
                  AND o.entity_type='person' AND o.entity_id=? AND s.entity_id=?
                ORDER BY s.retrieved_at DESC,o.observation_id""",
            (person_id, person_id),
        ).fetchall()
        result = []
        for row in rows:
            excerpt = self._source_excerpt(row["value"])
            if not contains_identity(
                excerpt, str(scope["full_name"]), str(scope["company_name"]), str(scope["title"]),
            ):
                continue
            result.append(IdentitySourceView(
                str(row["observation_id"]), str(row["snapshot_id"]), str(row["source_url"]),
                excerpt, str(row["retrieved_at"]), str(row["expires_at"]),
                ready and str(row["observation_id"]) == str(scope["source_observation_id"]),
            ))
        return tuple(result)

    def _usable_projection_source(self, source: object) -> bool:
        if self.source_verifier is None:
            return False
        snapshot = self.connection.execute(
            "SELECT * FROM source_snapshot WHERE snapshot_id=?", (source.snapshot_id,),
        ).fetchone()
        if snapshot is None:
            return False
        try:
            self.source_verifier(SnapshotProof(
                str(snapshot["snapshot_id"]), str(snapshot["body_ref"]),
                str(snapshot["content_sha256"]), str(snapshot["expires_at"]), source.excerpt,
            ))
        except Exception:
            return False
        return bool(source.excerpt)

    def _identity_source_ready(self, scope: sqlite3.Row) -> bool:
        if self.source_verifier is None:
            return False
        review = self.connection.execute(
            """SELECT 1 FROM identity_source_review
                WHERE campaign_id=? AND person_id=? AND company_id=? AND employment_id=?
                LIMIT 1""",
            (scope["campaign_id"], scope["person_id"], scope["company_id"],
             scope["employment_id"]),
        ).fetchone()
        if review is None:
            return self._legacy_identity_source_ready(scope)
        try:
            source = attested_current_role_source(
                self.connection, str(scope["campaign_id"]), str(scope["person_id"]),
            )
        except (KeyError, TypeError, ValueError):
            return False
        if (
            source.company_id != str(scope["company_id"])
            or source.employment_id != str(scope["employment_id"])
            or source.observation_id != str(scope["source_observation_id"])
        ):
            return False
        snapshot = self.connection.execute(
            "SELECT * FROM source_snapshot WHERE snapshot_id=?", (source.snapshot_id,),
        ).fetchone()
        if snapshot is None or snapshot["allowlist_version"] != "operator-local-v1":
            return False
        try:
            for excerpt in (source.role_excerpt, source.name_excerpt):
                self.source_verifier(SnapshotProof(
                    source.snapshot_id, str(snapshot["body_ref"]),
                    str(snapshot["content_sha256"]), str(snapshot["expires_at"]), excerpt,
                ))
        except Exception:
            return False
        return bool(source.role_excerpt and source.name_excerpt)

    def _legacy_identity_source_ready(self, scope: sqlite3.Row) -> bool:
        """Keep pre-P13 trusted proof readable; reviewed sources use exact P13 IDs."""
        try:
            facts = resolve_slot_facts(
                self.connection, str(scope["person_id"]),
                Affinity(str(scope["person_id"]), str(scope["campaign_id"]), 0, (), "projection"),
                str(scope["company_id"]), required_slots=("first_name", "company", "role"),
            )
            role = facts.sources["role"]
            name = facts.sources["first_name"]
        except (KeyError, ValueError):
            return False
        if role.observation_id != str(scope["source_observation_id"]):
            return False
        snapshot = self.connection.execute(
            "SELECT allowlist_version FROM source_snapshot WHERE snapshot_id=?",
            (role.snapshot_id,),
        ).fetchone()
        if snapshot is None or snapshot["allowlist_version"] == "operator-local-v1":
            return False
        return self._usable_projection_source(role) and self._usable_projection_source(name)

    def _aware_now(self) -> datetime:
        """This service's clock as an aware datetime for the selected services."""
        return _utc_time(self.now())

    @staticmethod
    def _fixed_code(error: BaseException, allowed: frozenset[str], fallback: str) -> str:
        """Forward one known fixed code only; never dynamic store or driver text."""
        code = error.args[0] if len(error.args) == 1 else None
        return code if type(code) is str and code in allowed else fallback

    def _selected_scope_active(self, campaign_id: str, person_id: str) -> bool:
        """True when P22 already binds a selected draft for this exact person.

        A plain existence read of the binding table: no lineage walk, no resolver
        call and no authority of any kind is created here.  A store that predates
        P22 entirely carries no binding table and is genuinely legacy.
        """
        try:
            if self.connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='selected_draft_binding'",
            ).fetchone() is None:
                return False
            return self.connection.execute(
                """SELECT 1 FROM selected_draft_binding
                    WHERE campaign_id=? AND person_id=? LIMIT 1""",
                (campaign_id, person_id),
            ).fetchone() is not None
        except sqlite3.Error:
            raise ReviewError("store_state_invalid") from None

    def materialize_selected_draft(
        self, request: "SelectedDraftRequest",
    ) -> "SelectedDraftReceipt":
        """Forward one exact selected-draft intent to the existing P22 service.

        This boundary adds no authority: it neither relaxes nor supplies any
        expectation, never confirms a source, and owns no table.  Refusals are
        mapped onto fixed :class:`ReviewError` codes.
        """
        from scripts.prospecting.selected_draft_service import (
            SelectedDraftError,
            SelectedDraftRequest,
            SelectedDraftService,
        )

        if not isinstance(request, SelectedDraftRequest):
            raise ReviewError("invalid_selected_draft_request")
        try:
            return SelectedDraftService(
                self.connection, now=self._aware_now,
            ).materialize(request)
        except SelectedDraftError as error:
            raise ReviewError(self._fixed_code(
                error, _SELECTED_DRAFT_CODES, "selected_draft_unavailable",
            )) from None
        except sqlite3.Error:
            raise ReviewError("store_state_invalid") from None

    def attest_selected_source(
        self, request: "SelectedSourceAttestationRequest",
    ) -> "SelectedSourceAttestationReceipt":
        """Forward one explicit human selected-source confirmation to P24.

        Confirmation is never automatic here: ``attested`` must already be exactly
        ``True`` in the caller's request, and this method never sets, defaults or
        infers it.  A rendered draft, a resolvable selection or a qualified person
        confer nothing.
        """
        from scripts.prospecting.selected_source_review import (
            SelectedSourceAttestationRequest,
            SelectedSourceReviewError,
            SelectedSourceReviewService,
        )

        if not isinstance(request, SelectedSourceAttestationRequest):
            raise ReviewError("invalid_source_attestation_request")
        if request.attested is not True:
            raise ReviewError("source_attestation_required")
        try:
            return SelectedSourceReviewService(
                self.connection, now=self._aware_now,
            ).attest(request)
        except SelectedSourceReviewError as error:
            raise ReviewError(self._fixed_code(
                error, _SELECTED_ATTESTATION_CODES, "source_attestation_unavailable",
            )) from None
        except sqlite3.Error:
            raise ReviewError("store_state_invalid") from None

    def verify_current_role_source(self, request: VerifyIdentitySourceRequest) -> VerifyIdentitySourceResult:
        request_id = _request_id(request.request_id)
        campaign_id = _safe_id(request.campaign_id, "invalid_campaign_id")
        person_id = _safe_id(request.person_id, "invalid_person_id")
        expected = _safe_id(request.expected_observation_id, "invalid_observation_id")
        observation_id = _safe_id(request.observation_id, "invalid_observation_id")
        if request.attested is not True:
            raise ReviewError("source_attestation_required")
        if self._selected_scope_active(campaign_id, person_id):
            # P22/P24 own this person's source context.  The legacy path must never
            # rewrite the employment row or mint replacement name/role observations
            # underneath a selected binding, so it fails closed before any write.
            raise ReviewError("selected_source_scope_active")
        payload = {"campaign_id": campaign_id, "person_id": person_id,
                   "expected_observation_id": expected, "observation_id": observation_id,
                   "attested": True}
        digest = _digest("identity_source", payload)
        replay = self.connection.execute(
            "SELECT request_hash,person_id,observation_id FROM identity_source_review WHERE request_id=?",
            (request_id,),
        ).fetchone()
        if replay is not None:
            if replay["request_hash"] != digest:
                raise ReviewError("request_conflict")
            return VerifyIdentitySourceResult(request_id, str(replay["person_id"]),
                                              str(replay["observation_id"]), "source_confirmed", True)
        if self.source_verifier is None:
            raise ReviewError("source_verification_unavailable")
        if self.connection.in_transaction:
            raise ReviewError("transaction_active")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            scope = self._identity_scope(campaign_id, person_id)
            if str(scope["source_observation_id"]) != expected:
                raise ReviewError("source_conflict")
            sources = {item.observation_id: item for item in self._identity_sources(campaign_id, person_id)}
            source = sources.get(observation_id)
            if source is None:
                raise ReviewError("source_candidate_missing")
            snapshot = self.connection.execute(
                "SELECT body_ref,content_sha256 FROM source_snapshot WHERE snapshot_id=?",
                (source.snapshot_id,),
            ).fetchone()
            if snapshot is None:
                raise ReviewError("source_candidate_missing")
            try:
                self.source_verifier(SnapshotProof(
                    source.snapshot_id, str(snapshot["body_ref"]), str(snapshot["content_sha256"]),
                    source.expires_at, source.excerpt,
                ))
            except Exception:
                raise ReviewError("source_verification_failed") from None
            role_observation_id = _derived_id("identity_role", request_id)
            name_observation_id = _derived_id("identity_name", request_id)
            observation_value = json.dumps(
                {"excerpt": source.excerpt}, sort_keys=True, separators=(",", ":"),
            )
            for new_id, field in (
                (role_observation_id, "current_employer"), (name_observation_id, "name"),
            ):
                self.connection.execute(
                    """INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,
                           source,seen_at,retrieved_at,confidence,snapshot_id)
                       VALUES(?,?,?,?,?,?,?,?,?,?)""",
                    (new_id, "person", person_id, field, observation_value, source.snapshot_id,
                     source.retrieved_at, self.now(), 1.0, source.snapshot_id),
                )
            changed = self.connection.execute(
                "UPDATE employment SET source_observation_id=? WHERE employment_id=? AND source_observation_id=?",
                (role_observation_id, scope["employment_id"], expected),
            ).rowcount
            if changed != 1:
                raise ReviewError("source_conflict")
            self.connection.execute(
                """INSERT INTO identity_source_review(request_id,request_hash,campaign_id,person_id,
                       company_id,employment_id,prior_observation_id,candidate_observation_id,
                       observation_id,name_observation_id,snapshot_id,attested,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (request_id, digest, campaign_id, person_id, scope["company_id"], scope["employment_id"],
                 expected, observation_id, role_observation_id, name_observation_id,
                 source.snapshot_id, 1, self.now()),
            )
            self.connection.commit()
        except BaseException:
            self.connection.rollback()
            raise
        return VerifyIdentitySourceResult(request_id, person_id, role_observation_id, "source_confirmed", False)

    def import_current_role_source(
        self, request: ImportIdentitySourceRequest,
    ) -> ImportIdentitySourceResult:
        if not isinstance(request, ImportIdentitySourceRequest):
            raise ReviewError("invalid_source_import_request")
        campaign_id = _safe_id(request.campaign_id, "invalid_campaign_id")
        person_id = _safe_id(request.person_id, "invalid_person_id")
        if type(request.source_url) is not str:
            raise ReviewError("invalid_source_url")
        try:
            request.source_url.encode("utf-8")
        except UnicodeError:
            raise ReviewError("invalid_source_url") from None
        if type(request.body) is not str or not request.body:
            raise ReviewError("invalid_source_body")
        try:
            body = request.body.encode("utf-8")
        except UnicodeError:
            raise ReviewError("invalid_source_body") from None
        if len(body) > MAX_SOURCE_BYTES:
            raise ReviewError("source_body_too_large")
        if self._selected_scope_active(campaign_id, person_id):
            # Fails closed before the importer runs: no snapshot may be added into a
            # selected context through the legacy path.
            raise ReviewError("selected_source_scope_active")
        scope = self._identity_scope(campaign_id, person_id)
        if identity_excerpt(
            request.body, str(scope["full_name"]), str(scope["company_name"]), str(scope["title"]),
        ) is None:
            raise ReviewError("source_identity_not_found")
        if self.source_importer is None:
            raise ReviewError("source_import_unavailable")
        try:
            snapshot_id = self.source_importer(
                person_id, str(scope["company_id"]), request.source_url, body,
            )
        except ValueError as error:
            code = error.args[0] if len(error.args) == 1 else None
            allowed = {
                "operator_source_invalid", "operator_source_transaction_active",
                "operator_source_busy", "operator_source_store_invalid",
                "operator_source_store_cap",
            }
            raise ReviewError(code if type(code) is str and code in allowed else "source_import_failed") from None
        except Exception:
            raise ReviewError("source_import_failed") from None
        if type(snapshot_id) is not str or _SAFE_ID.fullmatch(snapshot_id) is None:
            raise ReviewError("source_import_failed")
        return ImportIdentitySourceResult(campaign_id, person_id, snapshot_id, "source_available")

    def prepare_drafts(self, campaign_id: str, step: int = 0) -> PrepareDraftsResult:
        campaign_id = _safe_id(campaign_id, "invalid_campaign_id")
        if type(step) is not int:
            raise ReviewError("invalid_prepare_step")
        if step != 0:
            raise ReviewError("prepare_step_unsupported")
        self._campaign(campaign_id)
        if self.prepare_adapter is None:
            raise ReviewError("prepare_unavailable")
        try:
            summary = self.prepare_adapter(campaign_id, step)
            counts = (
                summary.candidates, summary.revisions_created, summary.out_of_band,
                summary.qa_failed, summary.slots_clamped,
            )
            if (
                not isinstance(summary, DraftSummary)
                or any(type(value) is not int or value < 0 for value in counts)
                or summary.revisions_created + summary.out_of_band + summary.qa_failed
                   > summary.candidates
                or not isinstance(summary.failure_codes, Mapping)
                or any(
                    type(code) is not str or _SAFE_TAG.fullmatch(code) is None
                    or type(count) is not int or count < 1
                    for code, count in summary.failure_codes.items()
                )
            ):
                raise ValueError
        except DraftError as error:
            code = error.args[0] if len(error.args) == 1 else None
            if type(code) is str and code in _PREPARE_BLOCKERS:
                raise ReviewError(code) from None
            raise ReviewError("prepare_failed") from None
        except Exception:
            raise ReviewError("prepare_failed") from None
        return PrepareDraftsResult(
            campaign_id, step, *counts,
            tuple(sorted(summary.failure_codes.items())),
        )

    def _campaign(self, campaign_id: object) -> sqlite3.Row:
        campaign_id = _safe_id(campaign_id, "invalid_campaign_id")
        row = self.connection.execute(
            """SELECT c.*,b.request_id,b.created_at,sp.sender_name
                 FROM campaign AS c
                 JOIN sender_profile AS sp ON sp.sender_profile_id=c.sender_profile_id
                 LEFT JOIN campaign_brief AS b ON b.campaign_id=c.campaign_id
                WHERE c.campaign_id=?""",
            (campaign_id,),
        ).fetchone()
        if row is None:
            raise ReviewError("campaign_missing")
        return row

    def list_sender_profiles(self) -> tuple[SenderProfileView, ...]:
        return tuple(
            SenderProfileView(str(row[0]), str(row[1]))
            for row in self.connection.execute(
                "SELECT sender_profile_id,sender_name FROM sender_profile ORDER BY sender_name,sender_profile_id"
            )
        )

    def list_mailboxes(self) -> tuple[str, ...]:
        """Return already saved campaign mailbox choices; an empty store has none."""
        return tuple(
            str(row[0]) for row in self.connection.execute(
                "SELECT DISTINCT mailbox_id FROM campaign ORDER BY mailbox_id"
            )
        )

    def list_campaigns(self) -> tuple[CampaignView, ...]:
        rows = self.connection.execute(
            """SELECT c.campaign_id
                 FROM campaign AS c
                 JOIN sender_profile AS sp ON sp.sender_profile_id=c.sender_profile_id
                ORDER BY c.campaign_id"""
        ).fetchall()
        return tuple(self.get_campaign(str(row[0])) for row in rows)

    def get_campaign(self, campaign_id: str) -> CampaignView:
        row = self._campaign(campaign_id)
        people = self.list_people(campaign_id)
        drafts = self.list_drafts(campaign_id)
        schedule = self.list_schedule(campaign_id)
        ready = sum(item.editorial_state == "ready" for item in drafts)
        blockers = sum(
            item.candidate_state in {"pending_qa", "qa_failed"}
            or item.approval_state != "approved"
            for item in drafts
        ) + sum(item.approval_state != "approved" for item in schedule) + sum(
            item.selected and item.identity_source_state != "source_ready" for item in people
        )
        if row["status"] == "paused":
            next_action = "resume_campaign"
        elif not people:
            next_action = "discover_people"
        elif not drafts and any(
            item.selected and item.identity_source_state == "source_missing" for item in people
        ):
            next_action = "review_sources"
        elif not drafts:
            next_action = "prepare_drafts"
        elif any(item.candidate_state in {"pending_qa", "qa_failed"} for item in drafts):
            next_action = "resolve_draft_qa"
        elif ready < len(drafts):
            next_action = "review_drafts"
        else:
            next_action = "inspect_schedule"
        return CampaignView(
            request_id=None if row["request_id"] is None else str(row["request_id"]),
            campaign_id=str(row["campaign_id"]), intent=str(row["intent"]),
            status=str(row["status"]), sender_profile_id=str(row["sender_profile_id"]),
            sender_name=str(row["sender_name"]), mailbox_id=str(row["mailbox_id"]),
            created_at=None if row["created_at"] is None else str(row["created_at"]),
            people_count=len(people), draft_count=len(drafts), ready_count=ready,
            scheduled_count=len(schedule), blocker_count=blockers, next_action=next_action,
        )

    def get_funding_review(self, campaign_id: str) -> FundingBatchView | None:
        """Project the latest validated P17 batch without adding review authority."""
        self._campaign(campaign_id)
        try:
            pipeline = PipelineService(
                self.connection, now=self.now,
            ).get_latest_projection(campaign_id)
        except PipelineError as error:
            if str(error) == "invalid_campaign_id":
                return None
            return FundingBatchView("unavailable", "pipeline_projection_unavailable")
        if pipeline is None:
            return None
        if pipeline.state == "input_pending":
            return FundingBatchView("input_pending", "pipeline_input_pending")
        try:
            projection = FundingResearchService(
                self.connection, now=self.now,
            ).get_projection(pipeline.run_id)
        except FundingResearchError as error:
            code = str(error)
            allowed = {
                "intake_stale", "pipeline_context_stale", "run_missing",
                "source_changed", "source_stale", "store_state_invalid",
            }
            if code == "source_stale":
                return FundingBatchView("source_stale", code)
            return FundingBatchView(
                "unavailable", code if code in allowed else "funding_projection_unavailable",
            )
        if projection is None:
            return FundingBatchView("awaiting_capture")
        companies = tuple(
            FundingCompanyView(
                name=company.name,
                provisional_state=company.rule_outcome,
                reason_codes=company.reason_codes,
                latest_stage=company.latest_stage,
                latest_announced_at=company.latest_announced_at,
                sources=tuple(
                    FundingSourceView(
                        source.source_url, source.source_kind,
                        source.binding_kind, source.retrieved_at,
                    )
                    for source in company.sources
                ),
            )
            for company in projection.companies
        )
        return FundingBatchView(
            state=projection.state,
            batch_id=projection.batch_id,
            batch_hash=projection.batch_hash,
            desired_companies=projection.desired_companies,
            candidate_count=projection.candidate_count,
            provisional_match_count=projection.provisional_match_count,
            provisional_excluded_count=projection.provisional_excluded_count,
            unknown_count=projection.unknown_count,
            collision_count=projection.collision_count,
            provisional_shortfall=projection.provisional_shortfall,
            companies=companies,
        )

    def _company_name(self, company_id: str) -> str | None:
        row = self.connection.execute(
            "SELECT name FROM company WHERE company_id=?", (company_id,),
        ).fetchone()
        return None if row is None else str(row[0])

    def _selected_pipeline_people(
        self, campaign_id: str,
    ) -> tuple[SelectedPipelineProjection, Mapping[str, SelectedPersonProjection]]:
        """Project the current selected ranking once, keyed by person.

        The projection only reads.  An unavailable pipeline, ranking, source or
        hint read is reported through the projection's own explicit ``error_code``
        rather than raised, so legacy campaigns and legacy rows keep listing
        exactly as before.
        """
        try:
            projection = build_selected_pipeline_projection(
                self.connection, campaign_id, now=self._aware_now(),
            )
        except sqlite3.Error:
            raise ReviewError("store_state_invalid") from None
        return projection, {
            person.person_id: person
            for company in projection.companies
            for person in company.people
        }

    def get_selected_pipeline(self, campaign_id: str) -> SelectedPipelineProjection:
        """Forward projection of the current selected ranking for one campaign.

        This adds no authority: it materializes nothing, confirms no source and
        writes nothing.  Its regeneration expectations are display hints only, and
        ``has_prior_binding`` states only that a binding already exists -- never
        that regeneration is required.  ``SelectedDraftService`` revalidates every
        pin and owns every refusal.
        """
        self._campaign(campaign_id)
        return self._selected_pipeline_people(campaign_id)[0]

    def _selected_pipeline_fields(
        self, person_id: str, pipeline: SelectedPersonProjection,
    ) -> tuple[str | None, str | None, str | None, str | None, str | None, str, str | None]:
        """Exact selected company/title/contact for one projected person.

        A person the current ranking selected but whose shared-resolver call (or
        hint read) failed is reported honestly as unavailable: no latest-employment
        title, no unrelated company and no unscoped contact is substituted for
        missing proof.
        """
        if pipeline.state != "available":
            return None, None, None, None, None, "source_unavailable", None
        contact = self.connection.execute(
            """SELECT contact_id,email,state FROM contact_point
                WHERE person_id=? AND employer_company_id=?
                ORDER BY COALESCE(verified_at,retrieved_at,'') DESC,contact_id DESC LIMIT 1""",
            (person_id, pipeline.company_id),
        ).fetchone()
        return (
            pipeline.title, self._company_name(pipeline.company_id),
            None if contact is None else str(contact["contact_id"]),
            None if contact is None else str(contact["email"]),
            None if contact is None else str(contact["state"]),
            # Selection alone never confers a confirmed source: only an explicit
            # human P24 attestation may ever read as ready.
            "confirmation_required",
            pipeline.employment_observation_id,
        )

    def list_people(self, campaign_id: str) -> tuple[PersonView, ...]:
        self._campaign(campaign_id)
        projection, selected_pipeline = self._selected_pipeline_people(campaign_id)
        extra_ids = tuple(sorted(selected_pipeline))
        extra_sql = "".join(" UNION SELECT ?" for _ in extra_ids)
        rows = self.connection.execute(
            """WITH ids(person_id) AS (
                   SELECT person_id FROM fit_score WHERE campaign_id=?
                   UNION SELECT person_id FROM eligibility_decision WHERE campaign_id=?
                   UNION SELECT person_id FROM fill_person WHERE campaign_id=?
                   UNION SELECT person_id FROM revision WHERE campaign_id=?
                   UNION SELECT person_id FROM enrollment WHERE campaign_id=?"""
            + extra_sql + """
               )
               SELECT p.person_id,p.full_name,p.linkedin_url,
                 (SELECT e.title FROM employment AS e WHERE e.person_id=p.person_id AND e.valid_to IS NULL
                   ORDER BY COALESCE(e.valid_from,'' ) DESC,e.employment_id DESC LIMIT 1) AS title,
                 (SELECT c.name FROM employment AS e JOIN company AS c ON c.company_id=e.company_id
                   WHERE e.person_id=p.person_id AND e.valid_to IS NULL
                   ORDER BY COALESCE(e.valid_from,'' ) DESC,e.employment_id DESC LIMIT 1) AS company,
                 (SELECT fs.score FROM fit_score AS fs WHERE fs.campaign_id=? AND fs.person_id=p.person_id
                   ORDER BY fs.scored_at DESC,fs.fit_score_id DESC LIMIT 1) AS fit_score,
                 (SELECT ed.outcome FROM eligibility_decision AS ed WHERE ed.campaign_id=? AND ed.person_id=p.person_id
                   ORDER BY ed.decided_at DESC,ed.decision_id DESC LIMIT 1) AS eligibility_state,
                 (SELECT cp.contact_id FROM contact_point AS cp WHERE cp.person_id=p.person_id
                   ORDER BY COALESCE(cp.verified_at,cp.retrieved_at,'') DESC,cp.contact_id DESC LIMIT 1) AS contact_id,
                 (SELECT cp.email FROM contact_point AS cp WHERE cp.person_id=p.person_id
                   ORDER BY COALESCE(cp.verified_at,cp.retrieved_at,'') DESC,cp.contact_id DESC LIMIT 1) AS email,
                 (SELECT cp.state FROM contact_point AS cp WHERE cp.person_id=p.person_id
                   ORDER BY COALESCE(cp.verified_at,cp.retrieved_at,'') DESC,cp.contact_id DESC LIMIT 1) AS contact_state,
                 EXISTS(SELECT 1 FROM fill_person AS fp WHERE fp.campaign_id=? AND fp.person_id=p.person_id AND fp.substituted=0) AS selected
               FROM ids JOIN person AS p ON p.person_id=ids.person_id
               ORDER BY p.full_name,p.person_id""",
            (campaign_id,) * 5 + extra_ids + (campaign_id,) * 3,
        ).fetchall()
        result = []
        for row in rows:
            person_id = str(row["person_id"])
            pipeline = selected_pipeline.get(person_id)
            legacy_selected = bool(row["selected"])
            # A person the current ranking selected is already selected for review,
            # before any materialization and without any fill/affinity/contact row.
            selected = legacy_selected or pipeline is not None
            title = None if row["title"] is None else str(row["title"])
            company = None if row["company"] is None else str(row["company"])
            sources: tuple[IdentitySourceView, ...] = ()
            current_observation_id = None
            identity_source_state = "not_selected"
            contact_id = None if row["contact_id"] is None else str(row["contact_id"])
            email = None if row["email"] is None else str(row["email"])
            contact_state = None if row["contact_state"] is None else str(row["contact_state"])
            legacy_bound = False
            if legacy_selected:
                try:
                    scope = self._identity_scope(campaign_id, person_id)
                    title, company = str(scope["title"]), str(scope["company_name"])
                    current_observation_id = str(scope["source_observation_id"])
                    contact = self.connection.execute(
                        """SELECT contact_id,email,state FROM contact_point
                            WHERE person_id=? AND employer_company_id=?
                            ORDER BY COALESCE(verified_at,retrieved_at,'') DESC,contact_id DESC LIMIT 1""",
                        (row["person_id"], scope["company_id"]),
                    ).fetchone()
                    contact_id = None if contact is None else str(contact["contact_id"])
                    email = None if contact is None else str(contact["email"])
                    contact_state = None if contact is None else str(contact["state"])
                    sources = self._identity_sources(campaign_id, person_id)
                    identity_source_state = (
                        "source_ready" if any(item.is_current for item in sources)
                        else "confirmation_required" if sources else "source_missing"
                    )
                    legacy_bound = True
                except ReviewError:
                    identity_source_state = "source_missing"
            if pipeline is not None and not legacy_bound:
                # Scoped to exactly this projected person: unrelated legacy rows are
                # never rewritten by the selected projection.
                (
                    title, company, contact_id, email, contact_state,
                    identity_source_state, current_observation_id,
                ) = self._selected_pipeline_fields(person_id, pipeline)
            if selected:
                state = "selected"
            elif contact_state == "valid" and row["eligibility_state"] != "ineligible":
                state = "contactable"
            elif row["eligibility_state"] == "eligible":
                state = "qualified"
            else:
                state = "discovered"
            result.append(PersonView(
                person_id=person_id, full_name=str(row["full_name"]),
                title=title, company=company,
                linkedin_url=None if row["linkedin_url"] is None else str(row["linkedin_url"]),
                fit_score=None if row["fit_score"] is None else int(row["fit_score"]),
                eligibility_state=None if row["eligibility_state"] is None else str(row["eligibility_state"]),
                contact_id=contact_id, email=email, contact_state=contact_state,
                selected=selected, state=state, identity_source_state=identity_source_state,
                identity_sources=sources, current_observation_id=current_observation_id,
                person_rank_id=None if pipeline is None else pipeline.person_rank_id,
                run_id=None if pipeline is None else projection.run_id,
                ranking_batch_hash=None if pipeline is None else projection.ranking_batch_hash,
                source_context_digest=(
                    None if pipeline is None else pipeline.source_context_digest
                ),
                projection_error_code=None if pipeline is None else pipeline.error_code,
            ))
        return tuple(result)

    def get_person(self, campaign_id: str, person_id: str) -> PersonView:
        person_id = _safe_id(person_id, "invalid_person_id")
        for person in self.list_people(campaign_id):
            if person.person_id == person_id:
                return person
        raise ReviewError("person_missing")

    def _current_revision_rows(self, campaign_id: str) -> tuple[sqlite3.Row, ...]:
        rows = self.connection.execute(
            """SELECT r.*
                 FROM revision AS r
                WHERE r.campaign_id=?
                ORDER BY r.person_id,r.step,r.rowid DESC,r.revision_id DESC""",
            (campaign_id,),
        ).fetchall()
        current: dict[tuple[str, int], sqlite3.Row] = {}
        for row in rows:
            current.setdefault((str(row["person_id"]), int(row["step"])), row)
        return tuple(current[key] for key in sorted(current))

    def _approval(self, campaign_id: str, person_id: str, digest: str, contact_id: str | None = None) -> tuple[str, str | None]:
        now = _utc_time(self.now())
        values: list[object] = [person_id, campaign_id, digest]
        contact_clause = ""
        if contact_id is not None:
            contact_clause = " AND a.contact_id=?"
            values.append(contact_id)
        query = """SELECT a.approval_id,a.assertion_ref,a.campaign_id,
                          a.approved_at,a.expires_at,
                          a.invalidation_reason,a.consumed_at,a.policy_hash,
                          c.policy_hash AS current_policy,a.mailbox_id,
                          c.mailbox_id AS current_mailbox,a.tier,c.approval_tier,
                          a.approver,a.content_kind,a.revision_hash,a.contact_id,
                          a.send_window,a.nonce,a.permitted_action,a.scope_hash,
                          cp.state AS contact_state
                     FROM approval AS a JOIN campaign AS c ON c.campaign_id=a.campaign_id
                     JOIN contact_point AS cp ON cp.contact_id=a.contact_id AND cp.person_id=?
                    WHERE a.campaign_id=? AND a.revision_hash=? AND a.content_kind='revision'
                      AND a.permitted_action='send_revision'""" + contact_clause + (
                          " ORDER BY a.approved_at DESC,a.approval_id DESC"
                      )
        rows = self.connection.execute(
            query, values,
        ).fetchall()
        expired = False
        for row in rows:
            scope_ok = (
                row["invalidation_reason"] is None and row["consumed_at"] is None
                and row["policy_hash"] == row["current_policy"]
                and row["mailbox_id"] == row["current_mailbox"]
                and row["tier"] == row["approval_tier"]
                and str(row["approver"]).startswith("human:")
                and str(row["approver"]) != "human:"
                and row["contact_state"] == "valid"
                and bool(row["nonce"])
            )
            try:
                approved_at = _utc_time(row["approved_at"])
                expires_at = _utc_time(row["expires_at"])
                window = json.loads(str(row["send_window"]))
                if not isinstance(window, dict) or set(window) != {"start", "end"}:
                    raise ValueError
                window_start = _utc_time(window["start"])
                window_end = _utc_time(window["end"])
                fields = {key: row[key] for key in (
                    "assertion_ref", "campaign_id", "policy_hash", "content_kind",
                    "revision_hash", "contact_id", "mailbox_id", "approver",
                    "approved_at", "expires_at", "tier", "send_window", "nonce",
                    "permitted_action",
                )}
                scope_ok = scope_ok and row["scope_hash"] == approval_scope_hash(fields)
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                scope_ok = False
                approved_at = expires_at = window_start = window_end = now
            if scope_ok and approved_at <= now <= expires_at and window_start <= now <= window_end:
                return "approved", str(row["approval_id"])
            if scope_ok and expires_at < now:
                expired = True
        return ("expired" if expired else "missing"), None

    def _candidate(self, campaign_id: str, revision_id: str) -> sqlite3.Row | None:
        return self.connection.execute(
            """SELECT * FROM review_candidate
                WHERE campaign_id=? AND parent_revision_id=?
                ORDER BY rowid DESC LIMIT 1""",
            (campaign_id, revision_id),
        ).fetchone()

    @staticmethod
    def _candidate_failures(candidate: sqlite3.Row) -> tuple[str, ...]:
        if candidate["qa_json"] is None:
            return ()
        try:
            qa_value = json.loads(str(candidate["qa_json"]))
            codes = qa_value.get("failure_codes", [])
            if not isinstance(codes, list) or any(type(code) is not str for code in codes):
                raise ValueError
            return tuple(codes)
        except (TypeError, ValueError, json.JSONDecodeError):
            raise ReviewError("store_state_invalid") from None

    def _candidate_history(
        self, campaign_id: str, person_id: str, step: int, current_revision_id: str
    ) -> tuple[CandidateHistoryView, ...]:
        rows = self.connection.execute(
            """SELECT candidate.candidate_id,candidate.parent_revision_id,
                      candidate.subject,candidate.body,candidate.qa_state,
                      candidate.qa_json,candidate.created_at
                 FROM review_candidate AS candidate
                 JOIN revision AS parent
                   ON parent.revision_id=candidate.parent_revision_id
                  AND parent.campaign_id=candidate.campaign_id
                  AND parent.person_id=candidate.person_id
                  AND parent.step=candidate.step
                WHERE parent.campaign_id=? AND parent.person_id=? AND parent.step=?
                ORDER BY candidate.rowid DESC,candidate.candidate_id DESC""",
            (campaign_id, person_id, step),
        ).fetchall()
        return tuple(CandidateHistoryView(
            candidate_id=str(item["candidate_id"]),
            parent_revision_id=str(item["parent_revision_id"]),
            subject=str(item["subject"]), body=str(item["body"]),
            qa_state=str(item["qa_state"]),
            failure_codes=self._candidate_failures(item),
            created_at=str(item["created_at"]),
            is_current_parent=item["parent_revision_id"] == current_revision_id,
        ) for item in rows)

    def _draft_view(self, row: sqlite3.Row) -> DraftView:
        campaign_id, person_id, revision_id = map(str, (
            row["campaign_id"], row["person_id"], row["revision_id"]
        ))
        person = self.connection.execute(
            "SELECT full_name FROM person WHERE person_id=?", (person_id,)
        ).fetchone()
        if person is None:
            raise ReviewError("store_state_invalid")
        evidence_ids = _json_tuple(row["evidence_ids"], "store_state_invalid")
        if (
            len(evidence_ids) != len(set(evidence_ids))
            or any(_SAFE_ID.fullmatch(item) is None for item in evidence_ids)
        ):
            raise ReviewError("store_state_invalid")
        evidence_rows = {
            str(item["evidence_id"]): item
            for item in self.connection.execute(
                """SELECT evidence_id,claim,url,observed_at,retrieved_at
                     FROM evidence WHERE person_id=? AND evidence_id IN ({})""".format(
                         ",".join("?" for _ in evidence_ids) or "NULL"
                     ),
                (person_id, *evidence_ids),
            ).fetchall()
        }
        if len(evidence_rows) != len(evidence_ids):
            raise ReviewError("store_state_invalid")
        evidence = tuple(EvidenceView(
            evidence_id=evidence_id,
            claim=str(evidence_rows[evidence_id]["claim"]),
            url=str(evidence_rows[evidence_id]["url"]),
            observed_at=(None if evidence_rows[evidence_id]["observed_at"] is None
                         else str(evidence_rows[evidence_id]["observed_at"])),
            retrieved_at=str(evidence_rows[evidence_id]["retrieved_at"]),
        ) for evidence_id in evidence_ids)
        candidate = self._candidate(campaign_id, revision_id)
        failure_codes = () if candidate is None else self._candidate_failures(candidate)
        candidate_history = self._candidate_history(
            campaign_id, person_id, int(row["step"]), revision_id
        )
        editorial = self.connection.execute(
            """SELECT state FROM draft_editorial_event
                WHERE campaign_id=? AND person_id=? AND revision_id=?
                ORDER BY sequence DESC LIMIT 1""",
            (campaign_id, person_id, revision_id),
        ).fetchone()
        feedback = self.connection.execute(
            "SELECT attempt_state FROM draft_feedback WHERE campaign_id=? AND revision_id=?",
            (campaign_id, revision_id),
        ).fetchone()
        approval_state, approval_id = self._approval(campaign_id, person_id, str(row["hash"]))
        if candidate is not None:
            approval_state, approval_id = "missing", None
        gate_code = _editorial_gate_code(
            self.connection, campaign_id, str(row["hash"]), self.now(),
        )
        editorial_state = "review_required" if candidate is not None or gate_code else (
            str(editorial[0]) if editorial is not None else "review_required"
        )
        (
            identity_state, identity_source, current_observation_id, contact_state,
            source_error, source_revision_id, source_context_digest,
            selected_source_scope,
        ) = self._draft_delivery_context(campaign_id, person_id, revision_id)
        return DraftView(
            person_id=person_id, full_name=str(person[0]), revision_id=revision_id,
            revision_hash=str(row["hash"]), step=int(row["step"]),
            subject=str(row["subject"]), body=str(row["body"]),
            evidence=evidence,
            candidate_id=None if candidate is None else str(candidate["candidate_id"]),
            candidate_subject=None if candidate is None else str(candidate["subject"]),
            candidate_body=None if candidate is None else str(candidate["body"]),
            candidate_state=None if candidate is None else str(candidate["qa_state"]),
            qa_failure_codes=failure_codes, candidate_history=candidate_history,
            editorial_state=editorial_state,
            approval_state=approval_state, approval_id=approval_id,
            feedback_state=None if feedback is None else str(feedback[0]),
            editorial_gate_code=gate_code,
            identity_source_state=identity_state,
            identity_source=identity_source,
            current_observation_id=current_observation_id,
            contact_state=contact_state,
            source_error_code=source_error,
            source_revision_id=source_revision_id,
            source_context_digest=source_context_digest,
            selected_source_scope=selected_source_scope,
        )

    def _selected_delivery_context(
        self, campaign_id: str, person_id: str, revision_id: str,
    ) -> tuple[
        str, IdentitySourceView | None, str | None, str, str | None, str | None,
        str | None, bool,
    ] | None:
        """Resolve the exact selected proof for one displayed revision.

        ``None`` means the shared seam reported a genuinely unselected (legacy)
        root, which is the only case where the legacy P13 proof may be consulted.
        No lineage is walked here: :func:`selected_revision_role_proof` is the single
        shared resolver, and nothing in this method writes or confirms anything.

        Every value below -- including the source context digest and the employment
        observation id -- comes from that one shared proof.  No independent
        latest-selection or latest-employment query runs here.  Every return from
        this method, success or refusal, reports ``True`` for the selected-scope
        marker: reaching this method at all means the displayed revision belongs to
        a selected root.
        """
        from scripts.prospecting.selected_source_review import (
            SelectedSourceReviewError,
            selected_revision_role_proof,
        )

        try:
            proof = selected_revision_role_proof(
                self.connection, revision_id, self._aware_now(),
            )
        except SelectedSourceReviewError as error:
            return (
                "source_unavailable", None, None, "missing",
                self._fixed_code(
                    error, _SELECTED_ATTESTATION_CODES, "selected_source_unavailable",
                ),
                revision_id,
                None,
                True,
            )
        except ReviewError as error:
            return (
                "source_unavailable", None, None, "missing", str(error), revision_id,
                None, True,
            )
        except (AttributeError, KeyError, sqlite3.Error, TypeError, ValueError):
            return (
                "source_unavailable", None, None, "missing",
                "selected_source_unavailable", revision_id,
                None,
                True,
            )
        if proof is None:
            return None
        if proof.campaign_id != campaign_id or proof.person_id != person_id:
            return (
                "source_unavailable", None, None, "missing",
                "selected_scope_mismatch", revision_id,
                None,
                True,
            )
        contact = self.connection.execute(
            """SELECT state FROM contact_point
                WHERE person_id=? AND employer_company_id=?
                ORDER BY COALESCE(verified_at,retrieved_at,'') DESC,contact_id DESC LIMIT 1""",
            (person_id, proof.company_id),
        ).fetchone()
        source = IdentitySourceView(
            proof.candidate_observation_id, proof.snapshot_id, proof.source_url,
            proof.excerpt, proof.retrieved_at, proof.expires_at, proof.attested,
        )
        # A pending selected proof stays visibly pending and is never current: only
        # an immutable P24 attestation makes ``attested``/``is_current`` true.
        #
        # ``current_observation_id`` and ``source_context_digest`` are read straight
        # off this exact proof record, never re-derived from an independent
        # employment or selection query.  ``getattr`` keeps a legacy-shaped proof
        # honest: it reports None rather than inventing metadata it does not carry.
        return (
            "source_ready" if proof.attested else "confirmation_required",
            source,
            getattr(proof, "employment_observation_id", None),
            "missing" if contact is None else str(contact["state"]),
            None,
            revision_id,
            getattr(proof, "source_context_digest", None),
            True,
        )

    def _draft_delivery_context(
        self, campaign_id: str, person_id: str, revision_id: str | None = None,
    ) -> tuple[
        str, IdentitySourceView | None, str | None, str, str | None, str | None,
        str | None, bool,
    ]:
        """Project exact source proof and contact state without changing either.

        ``revision_id`` is the exact revision the caller displays.  When given, the
        selected proof is resolved for that revision alone through the shared seam,
        and the legacy proof below is reached only for a genuinely unselected root.
        Selected staleness is surfaced as ``source_unavailable`` with its fixed code
        -- never silently replaced by whatever latest legacy employment exists.

        The legacy proof carries no selected source context, so this path always
        reports a ``None`` digest rather than borrowing an unrelated one, and it is
        the only path that reports ``False`` for the selected-scope marker.
        """
        if revision_id is not None:
            selected = self._selected_delivery_context(
                campaign_id, person_id, revision_id,
            )
            if selected is not None:
                return selected
        try:
            scope = self._identity_scope(campaign_id, person_id)
            proof = current_role_source_proof(
                self.connection, campaign_id, person_id, _utc_time(self.now()),
            )
            contact = self.connection.execute(
                """SELECT state FROM contact_point
                    WHERE person_id=? AND employer_company_id=?
                    ORDER BY COALESCE(verified_at,retrieved_at,'') DESC,contact_id DESC LIMIT 1""",
                (person_id, proof.company_id),
            ).fetchone()
            source = IdentitySourceView(
                proof.candidate_observation_id, proof.snapshot_id, proof.source_url,
                proof.excerpt, proof.retrieved_at, proof.expires_at, proof.attested,
            )
            return (
                "source_ready" if proof.attested else "confirmation_required",
                source,
                str(scope["source_observation_id"]),
                "missing" if contact is None else str(contact["state"]),
                None,
                revision_id,
                None,
                False,
            )
        except ReviewError as error:
            return (
                "source_unavailable", None, None, "missing", str(error), revision_id,
                None, False,
            )
        except (AttributeError, KeyError, sqlite3.Error, TypeError, ValueError) as error:
            code = str(error)
            allowed = {"current_role_proof_missing", "current_role_proof_invalid"}
            return (
                "source_unavailable", None, None, "missing",
                code if code in allowed else "source_proof_unavailable",
                revision_id,
                None,
                False,
            )

    def list_drafts(self, campaign_id: str) -> tuple[DraftView, ...]:
        self._campaign(campaign_id)
        return tuple(self._draft_view(row) for row in self._current_revision_rows(campaign_id))

    def get_draft(self, campaign_id: str, revision_id: str) -> DraftView:
        revision_id = _safe_id(revision_id, "invalid_revision_id")
        for draft in self.list_drafts(campaign_id):
            if draft.revision_id == revision_id:
                return draft
        raise ReviewError("draft_missing")

    def list_schedule(self, campaign_id: str) -> tuple[ScheduleView, ...]:
        campaign = self._campaign(campaign_id)
        try:
            cadence = json.loads(str(campaign["cadence"]))
        except (TypeError, ValueError, json.JSONDecodeError):
            raise ReviewError("store_state_invalid") from None
        if not isinstance(cadence, list):
            raise ReviewError("store_state_invalid")
        rows = self.connection.execute(
            """SELECT d.delivery_id,d.step,d.scheduled_at,d.state AS delivery_state,
                      d.mailbox_id,d.revision_hash,d.contact_id,e.person_id,
                      e.status AS enrollment_status,p.full_name,r.revision_id
                 FROM delivery AS d
                 JOIN enrollment AS e ON e.enrollment_id=d.enrollment_id AND e.campaign_id=d.campaign_id
                 JOIN person AS p ON p.person_id=e.person_id
                 JOIN revision AS r ON r.hash=d.revision_hash AND r.campaign_id=d.campaign_id
                   AND r.person_id=e.person_id AND r.step=d.step
                WHERE d.campaign_id=?
                ORDER BY COALESCE(d.scheduled_at,''),d.delivery_id""",
            (campaign_id,),
        ).fetchall()
        result = []
        for row in rows:
            approval_state, approval_id = self._approval(
                campaign_id, str(row["person_id"]), str(row["revision_hash"]), str(row["contact_id"])
            )
            result.append(ScheduleView(
                delivery_id=str(row["delivery_id"]), person_id=str(row["person_id"]),
                full_name=str(row["full_name"]), revision_id=str(row["revision_id"]),
                revision_hash=str(row["revision_hash"]), step=int(row["step"]),
                scheduled_at=None if row["scheduled_at"] is None else str(row["scheduled_at"]),
                enrollment_status=str(row["enrollment_status"]), delivery_state=str(row["delivery_state"]),
                mailbox_id=str(row["mailbox_id"]), cadence=tuple(cadence),
                send_window=str(campaign["send_window"]), timezone=str(campaign["timezone"]),
                daily_cap=int(campaign["daily_cap"]), hourly_cap=int(campaign["hourly_cap"]),
                firm_collision_cap=int(campaign["firm_collision_cap"]),
                approval_state=approval_state, approval_id=approval_id,
            ))
        return tuple(result)

    def list_activity(self, campaign_id: str) -> tuple[ActivityView, ...]:
        self._campaign(campaign_id)
        rows = self.connection.execute(
            """SELECT request_id AS event_id,created_at AS at,'review.' || operation AS action,
                      'draft_review' AS entity_type,result_id AS entity_id,result_state AS reason
                 FROM review_request WHERE campaign_id=?
               UNION ALL
               SELECT a.event_id,a.at,a.action,a.entity_type,a.entity_id,a.reason
                 FROM audit AS a
                WHERE (a.entity_type='campaign' AND a.entity_id=?)
                   OR (a.entity_type='revision' AND EXISTS(
                       SELECT 1 FROM revision r WHERE r.revision_id=a.entity_id AND r.campaign_id=?))
                   OR (a.entity_type='enrollment' AND EXISTS(
                       SELECT 1 FROM enrollment e WHERE e.enrollment_id=a.entity_id AND e.campaign_id=?))
                   OR (a.entity_type='delivery' AND EXISTS(
                       SELECT 1 FROM delivery d WHERE d.delivery_id=a.entity_id AND d.campaign_id=?))
                   OR (a.entity_type='inbound' AND EXISTS(
                       SELECT 1 FROM inbound i JOIN enrollment e ON e.enrollment_id=i.enrollment_id
                        WHERE i.inbound_id=a.entity_id AND e.campaign_id=?))
                   OR (a.entity_type='approval' AND EXISTS(
                       SELECT 1 FROM approval ap WHERE ap.approval_id=a.entity_id AND ap.campaign_id=?))
                ORDER BY at DESC,event_id DESC""",
            (campaign_id,) * 7,
        ).fetchall()
        return tuple(ActivityView(*(str(value) for value in row)) for row in rows)

    def _current(self, campaign_id: str, expected_revision_id: str) -> sqlite3.Row:
        expected_revision_id = _safe_id(expected_revision_id, "invalid_revision_id")
        expected = self.connection.execute(
            "SELECT person_id,step FROM revision WHERE campaign_id=? AND revision_id=?",
            (campaign_id, expected_revision_id),
        ).fetchone()
        if expected is None:
            raise ReviewError("draft_missing")
        key = (str(expected["person_id"]), int(expected["step"]))
        current = next((row for row in self._current_revision_rows(campaign_id)
                        if (str(row["person_id"]), int(row["step"])) == key), None)
        if current is None or current["revision_id"] != expected_revision_id:
            raise ReviewError("revision_conflict")
        return current

    def _begin(self) -> None:
        if self.connection.in_transaction:
            raise ReviewError("transaction_active")
        self.connection.execute("BEGIN IMMEDIATE")

    def _replay(self, request_id: str, operation: str, request_hash: str) -> sqlite3.Row | None:
        row = self.connection.execute(
            "SELECT * FROM review_request WHERE request_id=?", (request_id,)
        ).fetchone()
        if row is not None and (row["operation"] != operation or row["request_hash"] != request_hash):
            raise ReviewError("request_conflict")
        return row

    def _has_unresolved_candidate(self, campaign_id: str, revision_id: str) -> bool:
        candidate = self._candidate(campaign_id, revision_id)
        return candidate is not None and candidate["qa_state"] in {"pending_qa", "qa_failed"}

    def _candidate_value(self, row: sqlite3.Row, subject: str, body: str) -> CandidateRevision:
        return CandidateRevision(
            campaign_id=str(row["campaign_id"]), person_id=str(row["person_id"]),
            parent_revision_id=str(row["revision_id"]), step=int(row["step"]),
            subject=subject, body=body, angle=str(row["angle"]),
            generation_mode=str(row["generation_mode"]),
            purpose=None if row["purpose"] is None else str(row["purpose"]), ask=str(row["ask"]),
            evidence_ids=_json_tuple(row["evidence_ids"], "store_state_invalid"),
            recipient_relevance_points=_json_tuple(row["recipient_relevance_points"], "store_state_invalid"),
            sender_proof_points=_json_tuple(row["sender_proof_points"], "store_state_invalid"),
            template_id=str(row["template_id"]), template_version=int(row["template_version"]),
            prompt_version=str(row["prompt_version"]), model_version=str(row["model_version"]),
        )

    def _edit_replay(self, row: sqlite3.Row) -> EditResult:
        candidate = self.connection.execute(
            "SELECT qa_json,parent_revision_id FROM review_candidate WHERE candidate_id=?",
            (row["result_id"],),
        ).fetchone()
        if candidate is None:
            raise ReviewError("store_state_invalid")
        lineage = self.connection.execute(
            "SELECT child_revision_id FROM review_revision_lineage WHERE candidate_id=?",
            (row["result_id"],),
        ).fetchone()
        codes: tuple[str, ...] = ()
        if candidate["qa_json"] is not None:
            value = json.loads(str(candidate["qa_json"]))
            codes = tuple(value.get("failure_codes", ()))
        return EditResult(str(row["request_id"]), str(row["result_id"]),
                          str(lineage[0] if lineage else candidate["parent_revision_id"]),
                          str(row["result_state"]), codes, True)

    def edit_draft(self, request: EditDraftRequest) -> EditResult:
        if not isinstance(request, EditDraftRequest):
            raise ReviewError("invalid_edit_request")
        request_id = _request_id(request.request_id)
        campaign_id = _safe_id(request.campaign_id, "invalid_campaign_id")
        expected = _safe_id(request.expected_revision_id, "invalid_revision_id")
        expected_candidate = (
            None if request.expected_candidate_id is None else
            _safe_id(request.expected_candidate_id, "invalid_candidate_id")
        )
        subject = _text(request.subject, limit=MAX_SUBJECT, code="invalid_subject", multiline=False)
        body = _text(request.body, limit=MAX_BODY, code="invalid_body", multiline=True)
        request_hash = _digest("edit", {"campaign_id": campaign_id, "expected_revision_id": expected,
                                        "expected_candidate_id": expected_candidate,
                                        "subject": subject, "body": body})
        self._begin()
        try:
            replay = self._replay(request_id, "edit", request_hash)
            if replay is not None:
                result = self._edit_replay(replay)
                self.connection.commit()
                return result
            self._campaign(campaign_id)
            parent = self._current(campaign_id, expected)
            prior_candidate = self._candidate(campaign_id, expected)
            actual_candidate = None if prior_candidate is None else str(prior_candidate["candidate_id"])
            if expected_candidate != actual_candidate:
                raise ReviewError("candidate_conflict")
            prior_subject = parent["subject"] if prior_candidate is None else prior_candidate["subject"]
            prior_body = parent["body"] if prior_candidate is None else prior_candidate["body"]
            if subject == prior_subject and body == prior_body:
                raise ReviewError("unchanged_draft")
            candidate = self._candidate_value(parent, subject, body)
            candidate_id = _derived_id("cand", request_id)
            decision: ReviewQaDecision | None = None
            qa: QaResult | None = None
            adapter_failure: str | None = None
            try:
                decision = _valid_decision(self.qa_adapter(candidate), expected)
                if decision is None:
                    adapter_failure = "qa_adapter_invalid"
                else:
                    qa = decision.qa
            except ReviewQaUnavailable:
                pass
            except Exception:
                adapter_failure = "qa_adapter_error"
            result_state = "pending_qa"
            qa_json: str | None = None
            new_revision_id = expected
            if adapter_failure is not None:
                result_state = "qa_failed"
                qa_json = _canonical({"passed": False, "qa_score": 0, "checks": {},
                                      "failure_codes": [adapter_failure], "self_critique": ""})
            elif qa is not None:
                qa_json = _canonical(_qa_payload(qa))
                if not qa.passed:
                    result_state = "qa_failed"
                else:
                    value = RevisionInput(
                        candidate.person_id, candidate.campaign_id, candidate.step,
                        candidate.subject, candidate.body, candidate.angle,
                        candidate.generation_mode, candidate.purpose, candidate.ask,
                        candidate.evidence_ids, candidate.recipient_relevance_points,
                        candidate.sender_proof_points, candidate.template_id,
                        candidate.template_version, candidate.prompt_version,
                        candidate.model_version, qa,
                    )
                    digest = revision_hash(value)
                    if self.connection.execute("SELECT 1 FROM revision WHERE hash=?", (digest,)).fetchone():
                        result_state = "qa_failed"
                        qa_json = _canonical({**_qa_payload(qa), "passed": False,
                                              "failure_codes": ["revision_duplicate"]})
                    else:
                        record = build_revision(self.connection, value)
                        if not record.created:
                            raise ReviewError("store_state_invalid")
                        assert decision is not None
                        propagate_revision_qa_context(
                            self.connection, decision, record.revision_id, expected,
                            created_at=self.now(),
                        )
                        new_revision_id = record.revision_id
                        result_state = "revision_created"
            now = self.now()
            self.connection.execute(
                """INSERT INTO review_candidate(
                       candidate_id,request_id,campaign_id,person_id,step,parent_revision_id,
                       subject,body,qa_state,qa_json,created_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (candidate_id, request_id, campaign_id, candidate.person_id, candidate.step,
                 expected, subject, body, result_state, qa_json, now),
            )
            if result_state == "revision_created":
                self.connection.execute(
                    """INSERT INTO review_revision_lineage(
                           child_revision_id,parent_revision_id,candidate_id,request_id,
                           campaign_id,person_id,step,created_at
                       ) VALUES(?,?,?,?,?,?,?,?)""",
                    (new_revision_id, expected, candidate_id, request_id, campaign_id,
                     candidate.person_id, candidate.step, now),
                )
            self.connection.execute(
                "INSERT INTO review_request VALUES(?,?,?,?,?,?,?,?,?)",
                (request_id, "edit", campaign_id, candidate.person_id, expected,
                 request_hash, result_state, candidate_id, now),
            )
            self.connection.commit()
            codes = () if qa_json is None else tuple(json.loads(qa_json)["failure_codes"])
            return EditResult(request_id, candidate_id, new_revision_id, result_state, codes, False)
        except BaseException:
            self.connection.rollback()
            raise

    def request_feedback(self, request: FeedbackRequest) -> FeedbackResult:
        if not isinstance(request, FeedbackRequest):
            raise ReviewError("invalid_feedback_request")
        request_id = _request_id(request.request_id)
        campaign_id = _safe_id(request.campaign_id, "invalid_campaign_id")
        expected = _safe_id(request.expected_revision_id, "invalid_revision_id")
        if type(request.disposition) is not str or request.disposition not in _DISPOSITIONS:
            raise ReviewError("invalid_disposition")
        if type(request.tags) is not tuple or len(request.tags) > 8 or len(set(request.tags)) != len(request.tags) or any(
            type(tag) is not str or _SAFE_TAG.fullmatch(tag) is None for tag in request.tags
        ):
            raise ReviewError("invalid_feedback_tags")
        text = _optional_text(request.text)
        request_hash = _digest("feedback", {"campaign_id": campaign_id, "expected_revision_id": expected,
            "disposition": request.disposition, "tags": request.tags, "text": text})
        self._begin()
        try:
            replay = self._replay(request_id, "feedback", request_hash)
            if replay is not None:
                self.connection.commit()
                return FeedbackResult(request_id, str(replay["result_id"]), expected, "pending", True)
            self._campaign(campaign_id)
            revision = self._current(campaign_id, expected)
            if self._has_unresolved_candidate(campaign_id, expected):
                raise ReviewError("candidate_pending")
            if self.connection.execute(
                "SELECT 1 FROM draft_feedback WHERE campaign_id=? AND revision_id=?",
                (campaign_id, expected),
            ).fetchone():
                raise ReviewError("feedback_already_requested")
            feedback_id = _derived_id("fb", request_id)
            now = self.now()
            self.connection.execute(
                "INSERT INTO draft_feedback VALUES(?,?,?,?,?,?,?,?,?,?)",
                (feedback_id, request_id, campaign_id, revision["person_id"], expected,
                 request.disposition, _canonical(list(request.tags)), text, "pending", now),
            )
            self.connection.execute(
                "INSERT INTO review_request VALUES(?,?,?,?,?,?,?,?,?)",
                (request_id, "feedback", campaign_id, revision["person_id"], expected,
                 request_hash, "pending", feedback_id, now),
            )
            self.connection.commit()
            return FeedbackResult(request_id, feedback_id, expected, "pending", False)
        except sqlite3.IntegrityError as error:
            self.connection.rollback()
            duplicate = self.connection.execute(
                "SELECT 1 FROM draft_feedback WHERE campaign_id=? AND revision_id=?",
                (campaign_id, expected),
            ).fetchone()
            raise ReviewError(
                "feedback_already_requested" if duplicate is not None else "store_state_invalid"
            ) from error
        except BaseException:
            self.connection.rollback()
            raise

    def set_editorial_ready(self, request: EditorialRequest) -> EditorialResult:
        if not isinstance(request, EditorialRequest):
            raise ReviewError("invalid_editorial_request")
        request_id = _request_id(request.request_id)
        campaign_id = _safe_id(request.campaign_id, "invalid_campaign_id")
        expected = _safe_id(request.expected_revision_id, "invalid_revision_id")
        if type(request.ready) is not bool:
            raise ReviewError("invalid_ready")
        state = "ready" if request.ready else "review_required"
        request_hash = _digest("editorial", {"campaign_id": campaign_id,
                                              "expected_revision_id": expected, "ready": request.ready})
        self._begin()
        try:
            replay = self._replay(request_id, "editorial", request_hash)
            self._campaign(campaign_id)
            revision = self._current(campaign_id, expected)
            if self._has_unresolved_candidate(campaign_id, expected):
                raise ReviewError("candidate_pending")
            now = self.now()
            if request.ready:
                gate_code = _editorial_gate_code(
                    self.connection, campaign_id, str(revision["hash"]), now,
                )
                if gate_code:
                    raise ReviewError(gate_code)
            if replay is not None:
                self.connection.commit()
                return EditorialResult(request_id, str(replay["result_id"]), expected, state, True)
            event_id = _derived_id("ready", request_id)
            self.connection.execute(
                "INSERT INTO draft_editorial_event(event_id,request_id,campaign_id,person_id,revision_id,state,created_at) VALUES(?,?,?,?,?,?,?)",
                (event_id, request_id, campaign_id, revision["person_id"], expected, state, now),
            )
            self.connection.execute(
                "INSERT INTO review_request VALUES(?,?,?,?,?,?,?,?,?)",
                (request_id, "editorial", campaign_id, revision["person_id"], expected,
                 request_hash, state, event_id, now),
            )
            self.connection.commit()
            return EditorialResult(request_id, event_id, expected, state, False)
        except BaseException:
            self.connection.rollback()
            raise
