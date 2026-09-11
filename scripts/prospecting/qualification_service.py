"""Source-bound machine qualification controller for current P17/P18 research.

This module records qualification work and provenance only.  It deliberately does
not rank people, materialize fill rows, enrich contacts, create drafts, or grant
human/outbound approval.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import secrets
import sqlite3
from types import MappingProxyType
import uuid

from scripts.prospecting.funding_research_service import (
    FundingResearchError,
    FundingResearchService,
)
from scripts.prospecting.person_research_service import (
    PersonResearchError,
    PersonResearchService,
)
from scripts.prospecting.pipeline_service import PipelineError, PipelineService
from scripts.prospecting.pipeline_service import FUNDING_STAGES
from scripts.prospecting.pipeline_stage_service import (
    StageAdapter,
    StageBinding,
    StageJob,
    StageResult,
)
from scripts.prospecting.source_capture import SourceCaptureError, read_owned


CONTROLLER_POLICY_VERSION = "source-bound-qualification-policy-v2"
STAGE = "qualification_factcheck"
MAX_INPUT_BYTES = 1024 * 1024
MAX_OUTPUT_BYTES = 256 * 1024
MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_HISTORY_BATCHES = 20
MAX_ATTEMPTS = 2
MAX_LIST = 64
_RUN_ID = re.compile(r"prun_[0-9a-f]{32}\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_SAFE_ID = re.compile(r"[A-Za-z][A-Za-z0-9_-]{1,127}\Z")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_AUTHORITY = frozenset({"issuer", "participating_investor", "other", "unknown"})
_ENTAILMENT = frozenset({"supports_exact_stage_date", "contradicts", "ambiguous"})
_CONSISTENCY = frozenset({"consistent", "contradicted", "unknown"})
_COVERAGE = frozenset({"bounded_current_search", "stale", "ambiguous", "missing"})
_AGREEMENT = frozenset({"consistent", "conflict", "insufficient"})
_PAGE_KIND = frozenset({
    "current_individual_profile", "current_company_team",
    "dated_hiring_announcement", "other", "unknown",
})
_ROLE_STATEMENT = frozenset({"current", "historical", "ambiguous"})
_GRANULARITY = frozenset({"exact", "narrower", "broader", "different", "unknown"})
_CONTINUITY = frozenset({
    "current_statement", "historical_only", "unsupported", "contradicted",
})
_UNCERTAINTY_CODES = frozenset({
    "authority_unclear", "bounded_coverage_incomplete", "company_identity_unclear",
    "continuity_not_established", "current_statement_unclear",
    "event_entailment_ambiguous", "location_unclear", "role_context_ambiguous",
    "sector_unclear", "source_context_incomplete", "source_disagreement",
    "supplemental_source_binding_required", "title_granularity_mismatch",
})
_ATTEMPT_FAILURE_CODES = frozenset({
    "lease_expired", "lease_lost", "pipeline_context_stale",
    "qualification_adapter_failed", "qualification_context_stale",
    "qualification_output_invalid", "source_changed", "source_stale",
    "store_state_invalid",
})
_PAYLOAD_DIAGNOSTICS = frozenset({
    "payload_contract", "funding_source_binding", "funding_observation_binding",
    "candidate_binding", "person_source_binding",
})


class QualificationError(ValueError):
    """Stable-code refusal at the qualification boundary."""


def _payload_invalid(diagnostic: str | None = None) -> QualificationError:
    """Keep the durable refusal stable while attaching safe local diagnosis."""
    error = QualificationError("qualification_output_invalid")
    if diagnostic is not None:
        assert diagnostic in _PAYLOAD_DIAGNOSTICS
        setattr(error, "diagnostic_code", diagnostic)
    return error


@dataclass(frozen=True, repr=False)
class QualificationStartRequest:
    request_id: str
    run_id: str
    expected_intake_hash: str
    funding_batch_id: str
    funding_batch_hash: str
    person_batch_id: str
    person_batch_hash: str
    predecessor_batch_id: str | None
    predecessor_hash: str | None


@dataclass(frozen=True, repr=False)
class QualificationItemProjection:
    item_id: str
    funding_result_id: str
    company_id: str
    state: str
    candidate_count: int
    context_codes: tuple[str, ...]
    company_outcome: str | None
    person_counts: Mapping[str, int]


@dataclass(frozen=True, repr=False)
class QualificationBatchProjection:
    batch_id: str
    batch_hash: str
    run_id: str
    intake_hash: str
    funding_batch_id: str
    funding_batch_hash: str
    person_batch_id: str
    person_batch_hash: str
    predecessor_batch_id: str | None
    predecessor_hash: str | None
    state: str
    items: tuple[QualificationItemProjection, ...]


@dataclass(frozen=True)
class QualificationResult:
    batch_id: str
    batch_hash: str
    run_id: str
    state: str
    counts: Mapping[str, int]
    replayed: bool = False


@dataclass(frozen=True, repr=False)
class QualificationSupportedCandidate:
    candidate_id: str
    ordinal: int
    person_id: str
    employment_id: str
    candidate_observation_id: str
    employment_observation_id: str
    title: str
    title_hash: str
    outcome: str


@dataclass(frozen=True, repr=False)
class QualificationSupportedCompany:
    item_id: str
    artifact_id: str
    artifact_output_hash: str
    funding_result_id: str
    company_id: str
    company_outcome: str
    desired_people: int
    shortfall: int
    candidates: tuple[QualificationSupportedCandidate, ...]


@dataclass(frozen=True, repr=False)
class QualificationSupportedScope:
    batch_id: str
    batch_hash: str
    run_id: str
    intake_hash: str
    campaign_policy_hash: str
    funding_batch_id: str
    funding_batch_hash: str
    person_batch_id: str
    person_batch_hash: str
    controller_policy_version: str
    companies: tuple[QualificationSupportedCompany, ...]


@dataclass(frozen=True, repr=False)
class _SourceSpec:
    source_key: str
    origin_kind: str
    context_relation: str
    subject_candidate_id: str | None
    origin_batch_id: str
    origin_row_id: str
    snapshot_id: str
    observation_id: str | None
    source_kind: str | None
    binding_kind: str | None
    source_url: str
    retrieved_at: str
    expires_at: str
    content_sha256: str
    body_ref: str
    manifest_hash: str | None


def _canonical(value: object) -> str:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise QualificationError("invalid_request") from None


def _digest(value: object) -> str:
    return sha256(_canonical(value).encode()).hexdigest()


def _uuid(value: object, code: str) -> str:
    if type(value) is not str:
        raise QualificationError(code)
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError):
        raise QualificationError(code) from None
    if parsed.version != 4 or str(parsed) != value:
        raise QualificationError(code)
    return value


def _hash(value: object, code: str) -> str:
    if type(value) is not str or _HASH.fullmatch(value) is None:
        raise QualificationError(code)
    return value


def _id(value: object, code: str) -> str:
    if type(value) is not str or _SAFE_ID.fullmatch(value) is None:
        raise QualificationError(code)
    return value


def _timestamp(value: object, code: str) -> datetime:
    if type(value) is not str or len(value) > 64:
        raise QualificationError(code)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise QualificationError(code) from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise QualificationError(code)
    return parsed.astimezone(timezone.utc)


def _now(value: object) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise QualificationError("invalid_time")
    return value.astimezone(timezone.utc)


def _normal(value: object) -> str:
    return " ".join(
        "".join(character.casefold() if character.isalnum() else " " for character in str(value)).split()
    )


def _array(value: object, code: str = "store_state_invalid") -> tuple[str, ...]:
    try:
        parsed = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        raise QualificationError(code) from None
    if type(parsed) is not list or any(type(item) is not str for item in parsed):
        raise QualificationError(code)
    return tuple(parsed)


def _object(value: object, code: str = "store_state_invalid") -> dict[str, object]:
    try:
        parsed = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        raise QualificationError(code) from None
    if type(parsed) is not dict:
        raise QualificationError(code)
    return parsed


def _snapshot_root(connection: sqlite3.Connection) -> Path:
    database = next(
        (str(row[2]) for row in connection.execute("PRAGMA database_list") if row[1] == "main"),
        "",
    )
    if not database:
        raise QualificationError("snapshot_store_required")
    return Path(database).parent / "snapshots"


def _binding(value: object) -> StageBinding:
    if not isinstance(value, StageBinding):
        raise QualificationError("invalid_stage_binding")
    for text in (
        value.executor_identity, value.runtime_id, value.runtime_version,
        value.skill_name, value.skill_version,
    ):
        if type(text) is not str or not text or len(text) > 128 or _CONTROL.search(text):
            raise QualificationError("invalid_stage_binding")
    for value_hash in (
        value.runtime_hash, value.schema_hash, value.skill_content_hash,
        value.skill_manifest_hash,
    ):
        _hash(value_hash, "invalid_stage_binding")
    return value


def _derived_state(attempts: tuple[sqlite3.Row, ...], artifact: sqlite3.Row | None, maximum: int) -> str:
    if artifact is not None:
        return "machine_reviewed"
    if attempts and attempts[-1]["state"] == "claimed":
        return "qualification_running"
    if len(attempts) >= maximum:
        return "qualification_failed"
    return "awaiting_qualification_adapter"


class QualificationService:
    """Persist and fence source-bound qualification adapter work."""

    def __init__(
        self,
        connection: sqlite3.Connection,
        *,
        adapters: Mapping[str, StageAdapter] | None = None,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.adapters = MappingProxyType(dict(adapters or {}))
        self.now = now

    def _context(self, request: QualificationStartRequest | None = None, *, run_id: str | None = None):
        selected_run = request.run_id if request is not None else run_id
        assert selected_run is not None
        stamp = _now(self.now())
        now_text = stamp.isoformat()
        try:
            intake = PipelineService(self.connection, now=lambda: now_text).get_projection(selected_run)
            funding = FundingResearchService(self.connection, now=lambda: now_text).get_projection(selected_run)
            people = PersonResearchService(self.connection, now=lambda: now_text).get_projection(selected_run)
        except FundingResearchError as error:
            if str(error) in {"source_changed", "source_stale"}:
                raise QualificationError(str(error)) from None
            raise QualificationError("pipeline_context_stale") from None
        except PersonResearchError as error:
            if str(error) in {"source_changed", "source_stale"}:
                raise QualificationError(str(error)) from None
            raise QualificationError("pipeline_context_stale") from None
        except PipelineError:
            raise QualificationError("pipeline_context_stale") from None
        if funding is None:
            raise QualificationError("funding_batch_missing")
        if people is None:
            raise QualificationError("person_batch_missing")
        if request is not None and (
            intake.intake_hash != request.expected_intake_hash
            or funding.batch_id != request.funding_batch_id
            or funding.batch_hash != request.funding_batch_hash
            or people.batch_id != request.person_batch_id
            or people.batch_hash != request.person_batch_hash
            or people.funding_batch_id != funding.batch_id
            or people.funding_batch_hash != funding.batch_hash
        ):
            raise QualificationError("pipeline_context_stale")
        return intake, funding, people

    def _normalized_request(self, value: object) -> QualificationStartRequest:
        if not isinstance(value, QualificationStartRequest):
            raise QualificationError("invalid_request")
        request_id = _uuid(value.request_id, "invalid_request_id")
        if type(value.run_id) is not str or _RUN_ID.fullmatch(value.run_id) is None:
            raise QualificationError("invalid_run_id")
        intake_hash = _hash(value.expected_intake_hash, "invalid_intake_hash")
        funding_id = _id(value.funding_batch_id, "invalid_funding_batch")
        funding_hash = _hash(value.funding_batch_hash, "invalid_funding_batch")
        person_id = _id(value.person_batch_id, "invalid_person_batch")
        person_hash = _hash(value.person_batch_hash, "invalid_person_batch")
        if (value.predecessor_batch_id is None) != (value.predecessor_hash is None):
            raise QualificationError("invalid_predecessor")
        predecessor = None if value.predecessor_batch_id is None else _id(
            value.predecessor_batch_id, "invalid_predecessor",
        )
        predecessor_hash = None if value.predecessor_hash is None else _hash(
            value.predecessor_hash, "invalid_predecessor",
        )
        return QualificationStartRequest(
            request_id, value.run_id, intake_hash, funding_id, funding_hash,
            person_id, person_hash, predecessor, predecessor_hash,
        )

    def _person_history(self, current_batch_id: str) -> tuple[tuple[sqlite3.Row, ...], bool]:
        batches: list[sqlite3.Row] = []
        seen: set[str] = set()
        current = self.connection.execute(
            "SELECT * FROM prospecting_person_batch WHERE batch_id=?", (current_batch_id,),
        ).fetchone()
        while current is not None and current["predecessor_batch_id"] is not None:
            predecessor_id = str(current["predecessor_batch_id"])
            if predecessor_id in seen:
                raise QualificationError("person_history_ambiguous")
            if len(batches) >= MAX_HISTORY_BATCHES:
                return tuple(batches), True
            seen.add(predecessor_id)
            predecessor = self.connection.execute(
                "SELECT * FROM prospecting_person_batch WHERE batch_id=?", (predecessor_id,),
            ).fetchone()
            if (
                predecessor is None
                or str(predecessor["batch_hash"]) != str(current["predecessor_hash"])
                or str(predecessor["run_id"]) != str(current["run_id"])
            ):
                raise QualificationError("person_history_ambiguous")
            batches.append(predecessor)
            current = predecessor
        return tuple(batches), False

    def _person_source(self, candidate: sqlite3.Row, relation: str, subject: str) -> _SourceSpec:
        manifest = _object(candidate["source_manifest_json"])
        if _digest(manifest) != str(candidate["source_manifest_hash"]):
            raise QualificationError("store_state_invalid")
        snapshot = self.connection.execute(
            "SELECT * FROM source_snapshot WHERE snapshot_id=?", (candidate["snapshot_id"],),
        ).fetchone()
        required = {
            "snapshot_id", "observation_id", "source_url", "retrieved_at", "body_ref",
            "content_sha256", "excerpt_sha256", "entity_id",
        }
        if snapshot is None or not required <= set(manifest):
            raise QualificationError("store_state_invalid")
        if (
            str(snapshot["snapshot_id"]) != str(manifest["snapshot_id"])
            or str(snapshot["source_url"]) != str(manifest["source_url"])
            or str(snapshot["retrieved_at"]) != str(manifest["retrieved_at"])
            or str(snapshot["body_ref"]) != str(manifest["body_ref"])
            or str(snapshot["content_sha256"]) != str(manifest["content_sha256"])
        ):
            raise QualificationError("store_state_invalid")
        return _SourceSpec(
            "", "person", relation, subject, str(candidate["batch_id"]),
            str(candidate["candidate_id"]), str(snapshot["snapshot_id"]),
            None if candidate["observation_id"] is None else str(candidate["observation_id"]),
            None, None, str(snapshot["source_url"]), str(snapshot["retrieved_at"]),
            str(snapshot["expires_at"]), str(snapshot["content_sha256"]),
            str(snapshot["body_ref"]), str(candidate["source_manifest_hash"]),
        )

    @staticmethod
    def _same_identity(current: sqlite3.Row, prior: sqlite3.Row) -> tuple[bool, bool]:
        left = _object(current["candidate_identity_json"])
        right = _object(prior["candidate_identity_json"])
        exact_person = (
            current["person_id"] is not None and prior["person_id"] is not None
            and str(current["person_id"]) == str(prior["person_id"])
        )
        exact_profile = (
            left.get("profile_url") is not None
            and left.get("profile_url") == right.get("profile_url")
            and _normal(left.get("full_name")) == _normal(right.get("full_name"))
        )
        potential = (
            _normal(left.get("full_name")) == _normal(right.get("full_name"))
            and str(current["company_id"]) == str(prior["company_id"])
        )
        return exact_person or exact_profile, potential

    def _sources_for_item(
        self, funding_result_id: str, current_candidates: tuple[sqlite3.Row, ...],
        history: tuple[sqlite3.Row, ...], *, namespace: str,
        history_incomplete: bool = False,
    ) -> tuple[tuple[_SourceSpec, ...], tuple[str, ...]]:
        specs: list[_SourceSpec] = []
        codes: set[str] = {"person_history_incomplete"} if history_incomplete else set()
        funding_sources = self.connection.execute(
            "SELECT * FROM prospecting_funding_source WHERE result_id=? ORDER BY ordinal",
            (funding_result_id,),
        ).fetchall()
        for source in funding_sources:
            snapshot = self.connection.execute(
                "SELECT * FROM source_snapshot WHERE snapshot_id=?", (source["snapshot_id"],),
            ).fetchone()
            if snapshot is None:
                raise QualificationError("store_state_invalid")
            specs.append(_SourceSpec(
                "", "funding", "current", None,
                funding_result_id, f"{funding_result_id}:{source['ordinal']}",
                str(source["snapshot_id"]),
                None if source["observation_id"] is None else str(source["observation_id"]),
                str(source["source_kind"]), str(source["binding_kind"]),
                str(source["expected_source_url"]), str(source["expected_retrieved_at"]),
                str(snapshot["expires_at"]), str(source["expected_content_sha256"]),
                str(snapshot["body_ref"]), None,
            ))
        for current in current_candidates:
            current_id = str(current["candidate_id"])
            specs.append(self._person_source(current, "current", current_id))
            for batch in history:
                prior_rows = self.connection.execute(
                    "SELECT * FROM prospecting_person_candidate WHERE batch_id=? AND company_id=? ORDER BY ordinal",
                    (batch["batch_id"], current["company_id"]),
                ).fetchall()
                for prior in prior_rows:
                    exact, potential = self._same_identity(current, prior)
                    if not exact and not potential:
                        continue
                    current_identity = _object(current["candidate_identity_json"])
                    prior_identity = _object(prior["candidate_identity_json"])
                    relation = (
                        "predecessor_title_disagreement"
                        if exact and _normal(current_identity.get("title")) != _normal(prior_identity.get("title"))
                        else "predecessor" if exact else "potential_conflict"
                    )
                    if not exact:
                        codes.add("supplemental_source_binding_required")
                    specs.append(self._person_source(prior, relation, current_id))
        keyed = tuple(
            _SourceSpec(
                f"qsrc_{sha256(f'{namespace}:{funding_result_id}:{index}:{spec.origin_row_id}'.encode()).hexdigest()[:24]}",
                spec.origin_kind, spec.context_relation, spec.subject_candidate_id,
                spec.origin_batch_id, spec.origin_row_id, spec.snapshot_id,
                spec.observation_id, spec.source_kind, spec.binding_kind, spec.source_url,
                spec.retrieved_at, spec.expires_at, spec.content_sha256, spec.body_ref,
                spec.manifest_hash,
            )
            for index, spec in enumerate(specs)
        )
        return keyed, tuple(sorted(codes))

    @staticmethod
    def _source_hash(sources: tuple[_SourceSpec, ...]) -> str:
        return _digest([{
            "source_key": source.source_key, "origin_kind": source.origin_kind,
            "relation": source.context_relation, "subject": source.subject_candidate_id,
            "origin_batch": source.origin_batch_id, "origin_row": source.origin_row_id,
            "snapshot": source.snapshot_id, "observation": source.observation_id,
            "source_kind": source.source_kind, "binding_kind": source.binding_kind,
            "url": source.source_url, "retrieved_at": source.retrieved_at,
            "expires_at": source.expires_at, "content_sha256": source.content_sha256,
            "body_ref": source.body_ref, "manifest_hash": source.manifest_hash,
        } for source in sources])

    @staticmethod
    def _source_from_row(row: sqlite3.Row) -> _SourceSpec:
        return _SourceSpec(
            str(row["source_key"]), str(row["origin_kind"]),
            str(row["context_relation"]),
            None if row["subject_candidate_id"] is None else str(row["subject_candidate_id"]),
            str(row["origin_batch_id"]), str(row["origin_row_id"]),
            str(row["snapshot_id"]),
            None if row["observation_id"] is None else str(row["observation_id"]),
            None if row["source_kind"] is None else str(row["source_kind"]),
            None if row["binding_kind"] is None else str(row["binding_kind"]),
            str(row["expected_source_url"]), str(row["expected_retrieved_at"]),
            str(row["expected_expires_at"]), str(row["expected_content_sha256"]),
            str(row["expected_body_ref"]),
            None if row["expected_manifest_hash"] is None else str(row["expected_manifest_hash"]),
        )

    def _validate_item_identity(self, item: sqlite3.Row, *, read_sources: bool) -> None:
        candidate_ids = _array(item["candidate_ids_json"])
        if _digest(list(candidate_ids)) != str(item["candidate_set_hash"]):
            raise QualificationError("store_state_invalid")
        candidate_rows = tuple(self.connection.execute(
            "SELECT * FROM prospecting_person_candidate WHERE candidate_id IN (%s) ORDER BY candidate_id"
            % ",".join("?" for _ in candidate_ids), candidate_ids,
        ).fetchall()) if candidate_ids else ()
        if (
            len(candidate_rows) != len(candidate_ids)
            or any(
                str(row["batch_id"]) != str(self.connection.execute(
                    "SELECT person_batch_id FROM prospecting_qualification_batch WHERE batch_id=?",
                    (item["batch_id"],),
                ).fetchone()[0])
                or str(row["funding_result_id"]) != str(item["funding_result_id"])
                or str(row["company_id"]) != str(item["company_id"])
                or str(row["outcome"]) != "provisional_import"
                for row in candidate_rows
            )
        ):
            raise QualificationError("store_state_invalid")
        funding_row = self.connection.execute(
            "SELECT company_id,source_set_hash,rule_outcome FROM prospecting_funding_company WHERE result_id=?",
            (item["funding_result_id"],),
        ).fetchone()
        if (
            funding_row is None or str(funding_row["company_id"]) != str(item["company_id"])
            or str(funding_row["source_set_hash"]) != str(item["funding_source_set_hash"])
            or str(funding_row["rule_outcome"]) != "provisional_match"
        ):
            raise QualificationError("store_state_invalid")
        source_rows = tuple(self.connection.execute(
            "SELECT * FROM prospecting_qualification_source WHERE item_id=? ORDER BY ordinal",
            (item["item_id"],),
        ).fetchall())
        sources = tuple(self._source_from_row(row) for row in source_rows)
        if self._source_hash(sources) != str(item["source_binding_hash"]):
            raise QualificationError("store_state_invalid")
        if read_sources:
            stamp = _now(self.now())
            for row in source_rows:
                self._read_source(row, stamp)

    def _validate_batch_hash(self, batch: sqlite3.Row, item_rows: tuple[sqlite3.Row, ...]) -> None:
        expected = _digest({
            "batch_id": str(batch["batch_id"]), "request_hash": str(batch["request_hash"]),
            "run_id": str(batch["run_id"]), "intake_hash": str(batch["intake_hash"]),
            "funding": [str(batch["funding_batch_id"]), str(batch["funding_batch_hash"])],
            "people": [str(batch["person_batch_id"]), str(batch["person_batch_hash"])],
            "predecessor": [batch["predecessor_batch_id"], batch["predecessor_hash"]],
            "input_context_hash": str(batch["input_context_hash"]),
            "controller_policy_version": str(batch["controller_policy_version"]),
            "items": [{
                "item_id": str(item["item_id"]),
                "result_id": str(item["funding_result_id"]),
                "company_id": str(item["company_id"]),
                "candidate_set_hash": str(item["candidate_set_hash"]),
                "context_codes": _array(item["context_codes_json"]),
                "source_binding_hash": str(item["source_binding_hash"]),
            } for item in item_rows],
        })
        if expected != str(batch["batch_hash"]):
            raise QualificationError("store_state_invalid")

    def _input_context_hash(
        self, intake, item_values: list[dict[str, object]],
    ) -> str:
        """Hash semantic qualification inputs without request-generated identities."""
        items: list[dict[str, object]] = []
        for item in item_values:
            funding_identity = _object(self.connection.execute(
                "SELECT candidate_identity_json FROM prospecting_funding_company WHERE result_id=?",
                (item["result_id"],),
            ).fetchone()[0])
            candidates = []
            for candidate_id in item["candidate_ids"]:
                row = self.connection.execute(
                    "SELECT candidate_identity_json FROM prospecting_person_candidate WHERE candidate_id=?",
                    (candidate_id,),
                ).fetchone()
                if row is None:
                    raise QualificationError("store_state_invalid")
                candidates.append(_object(row[0]))
            sources = []
            for source in item["sources"]:
                observation_value = None
                if source.observation_id is not None:
                    observation = self.connection.execute(
                        "SELECT value FROM source_observation WHERE observation_id=?",
                        (source.observation_id,),
                    ).fetchone()
                    if observation is None:
                        raise QualificationError("store_state_invalid")
                    observation_value = _object(observation[0])
                sources.append({
                    "origin_kind": source.origin_kind,
                    "relation": source.context_relation,
                    "subject": None if source.subject_candidate_id is None else
                        candidates[tuple(item["candidate_ids"]).index(source.subject_candidate_id)],
                    "source_kind": source.source_kind,
                    "binding_kind": source.binding_kind,
                    "url": source.source_url,
                    "retrieved_at": source.retrieved_at,
                    "expires_at": source.expires_at,
                    "content_sha256": source.content_sha256,
                    "observation": observation_value,
                })
            items.append({
                "company": funding_identity,
                "candidates": candidates,
                "context_codes": list(item["context_codes"]),
                "sources": sources,
            })
        return _digest({
            "policy_version": CONTROLLER_POLICY_VERSION,
            "intake": {
                "as_of_date": intake.as_of_date,
                "cutoff_date": intake.cutoff_date,
                "funding_stage_min": intake.funding_stage_min,
                "funding_stage_max": intake.funding_stage_max,
                "funding_window_years": intake.funding_window_years,
                "funding_stage_interpretation": intake.funding_stage_interpretation,
                "geography": {"mode": intake.geography.mode, "values": list(intake.geography.values)},
                "sector": {"mode": intake.sector.mode, "values": list(intake.sector.values)},
                "requested_companies": intake.requested_companies,
                "requested_people_per_company": intake.requested_people_per_company,
                "role_families": list(intake.role_families),
            },
            "items": items,
        })

    def start_or_resume(self, value: QualificationStartRequest) -> QualificationResult:
        request = self._normalized_request(value)
        request_hash = _digest({
            "operation": "start_qualification", "request": request.__dict__,
            "controller_policy_version": CONTROLLER_POLICY_VERSION,
        })
        if self.connection.in_transaction:
            raise QualificationError("transaction_active")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            replay = self.connection.execute(
                "SELECT request_hash,batch_id FROM prospecting_qualification_batch WHERE request_id=?",
                (request.request_id,),
            ).fetchone()
            if replay is not None:
                if str(replay["request_hash"]) != request_hash:
                    raise QualificationError("request_conflict")
                projection = self._stored_projection(str(replay["batch_id"]))
                self.connection.commit()
                return self._result(projection, True)
            intake, funding, people = self._context(request)
            latest = self.connection.execute(
                "SELECT batch_id,batch_hash FROM prospecting_qualification_batch WHERE run_id=? ORDER BY rowid DESC LIMIT 1",
                (request.run_id,),
            ).fetchone()
            expected = None if latest is None else (str(latest[0]), str(latest[1]))
            supplied = None if request.predecessor_batch_id is None else (
                request.predecessor_batch_id, request.predecessor_hash,
            )
            if expected != supplied:
                raise QualificationError("predecessor_conflict")
            selected = {
                company.result_id: company for company in funding.companies
                if company.rule_outcome == "provisional_match"
            }
            person_scope_row = self.connection.execute(
                "SELECT research_result_ids_json FROM prospecting_person_batch WHERE batch_id=?",
                (people.batch_id,),
            ).fetchone()
            if person_scope_row is None:
                raise QualificationError("store_state_invalid")
            selected_ids = set(selected) & set(_array(person_scope_row[0]))
            person_rows = tuple(self.connection.execute(
                "SELECT * FROM prospecting_person_candidate WHERE batch_id=? ORDER BY ordinal",
                (people.batch_id,),
            ).fetchall())
            history, history_incomplete = self._person_history(people.batch_id)
            stamp = _now(self.now()).isoformat()
            batch_id = "pqba_" + uuid.uuid5(uuid.UUID(request.request_id), "qualification-batch").hex
            item_values: list[dict[str, object]] = []
            for ordinal, result_id in enumerate(
                item.result_id for item in funding.companies
                if item.result_id in selected_ids
            ):
                company = selected[result_id]
                if company.company_id is None:
                    raise QualificationError("store_state_invalid")
                candidates = tuple(
                    row for row in person_rows
                    if str(row["funding_result_id"]) == result_id
                    and str(row["outcome"]) == "provisional_import"
                )
                candidate_ids = tuple(str(row["candidate_id"]) for row in candidates)
                item_id = "pqit_" + uuid.uuid5(uuid.UUID(request.request_id), f"item:{ordinal}").hex
                sources, context_codes = self._sources_for_item(
                    result_id, candidates, history, namespace=item_id,
                    history_incomplete=history_incomplete,
                )
                source_hash = self._source_hash(sources)
                item_values.append({
                    "item_id": item_id, "ordinal": ordinal, "result_id": result_id,
                    "company_id": company.company_id,
                    "funding_source_set_hash": self.connection.execute(
                        "SELECT source_set_hash FROM prospecting_funding_company WHERE result_id=?",
                        (result_id,),
                    ).fetchone()[0],
                    "candidate_ids": candidate_ids,
                    "candidate_set_hash": _digest(list(candidate_ids)),
                    "context_codes": context_codes, "sources": sources,
                    "source_binding_hash": source_hash,
                })
            input_context_hash = self._input_context_hash(intake, item_values)
            if self.connection.execute(
                "SELECT 1 FROM prospecting_qualification_batch WHERE run_id=? AND input_context_hash=?",
                (request.run_id, input_context_hash),
            ).fetchone() is not None:
                raise QualificationError("qualification_context_unchanged")
            batch_hash = _digest({
                "batch_id": batch_id, "request_hash": request_hash, "run_id": request.run_id,
                "intake_hash": request.expected_intake_hash,
                "funding": [request.funding_batch_id, request.funding_batch_hash],
                "people": [request.person_batch_id, request.person_batch_hash],
                "predecessor": [request.predecessor_batch_id, request.predecessor_hash],
                "input_context_hash": input_context_hash,
                "controller_policy_version": CONTROLLER_POLICY_VERSION,
                "items": [{
                    "item_id": item["item_id"], "result_id": item["result_id"],
                    "company_id": item["company_id"], "candidate_set_hash": item["candidate_set_hash"],
                    "context_codes": item["context_codes"],
                    "source_binding_hash": item["source_binding_hash"],
                } for item in item_values],
            })
            self.connection.execute(
                """INSERT INTO prospecting_qualification_batch(
                       batch_id,request_id,request_hash,batch_hash,run_id,intake_hash,
                       campaign_policy_hash,funding_batch_id,funding_batch_hash,
                       person_batch_id,person_batch_hash,predecessor_batch_id,
                       predecessor_hash,input_context_hash,controller_policy_version,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (batch_id, request.request_id, request_hash, batch_hash, request.run_id,
                 request.expected_intake_hash, intake.campaign_policy_hash,
                 request.funding_batch_id, request.funding_batch_hash,
                 request.person_batch_id, request.person_batch_hash,
                 request.predecessor_batch_id, request.predecessor_hash,
                 input_context_hash, CONTROLLER_POLICY_VERSION, stamp),
            )
            for item in item_values:
                self.connection.execute(
                    """INSERT INTO prospecting_qualification_item(
                           item_id,batch_id,ordinal,funding_result_id,company_id,
                           funding_source_set_hash,candidate_ids_json,candidate_set_hash,
                           context_codes_json,source_binding_hash,max_attempts,created_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (item["item_id"], batch_id, item["ordinal"], item["result_id"],
                     item["company_id"], item["funding_source_set_hash"],
                     _canonical(list(item["candidate_ids"])), item["candidate_set_hash"],
                     _canonical(list(item["context_codes"])), item["source_binding_hash"],
                     MAX_ATTEMPTS, stamp),
                )
                for source_ordinal, source in enumerate(item["sources"]):
                    self.connection.execute(
                        """INSERT INTO prospecting_qualification_source(
                               source_key,item_id,ordinal,origin_kind,context_relation,
                               subject_candidate_id,origin_batch_id,origin_row_id,snapshot_id,
                               observation_id,source_kind,binding_kind,expected_source_url,
                               expected_retrieved_at,expected_expires_at,expected_content_sha256,
                               expected_body_ref,expected_manifest_hash,created_at)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (source.source_key, item["item_id"], source_ordinal,
                         source.origin_kind, source.context_relation,
                         source.subject_candidate_id, source.origin_batch_id,
                         source.origin_row_id, source.snapshot_id, source.observation_id,
                         source.source_kind, source.binding_kind, source.source_url,
                         source.retrieved_at, source.expires_at, source.content_sha256,
                         source.body_ref, source.manifest_hash, stamp),
                    )
            projection = self._projection(batch_id, intake, funding, people)
            self.connection.commit()
            return self._result(projection, False)
        except BaseException as error:
            self.connection.rollback()
            if isinstance(error, QualificationError):
                raise
            if isinstance(error, sqlite3.Error):
                raise QualificationError("store_state_invalid") from None
            raise

    def _read_source(self, row: sqlite3.Row, now: datetime) -> str:
        if row["origin_kind"] == "funding":
            source = self.connection.execute(
                """SELECT * FROM prospecting_funding_source
                    WHERE result_id=? AND snapshot_id=? AND observation_id IS ?""",
                (row["origin_batch_id"], row["snapshot_id"], row["observation_id"]),
            ).fetchone()
            if source is None or (
                str(source["source_kind"]) != str(row["source_kind"])
                or str(source["binding_kind"]) != str(row["binding_kind"])
                or str(source["expected_content_sha256"]) != str(row["expected_content_sha256"])
            ):
                raise QualificationError("store_state_invalid")
        elif row["origin_kind"] == "person":
            candidate = self.connection.execute(
                "SELECT * FROM prospecting_person_candidate WHERE candidate_id=?",
                (row["origin_row_id"],),
            ).fetchone()
            if candidate is None or (
                str(candidate["batch_id"]) != str(row["origin_batch_id"])
                or str(candidate["snapshot_id"]) != str(row["snapshot_id"])
                or candidate["observation_id"] != row["observation_id"]
                or str(candidate["source_manifest_hash"]) != str(row["expected_manifest_hash"])
            ):
                raise QualificationError("store_state_invalid")
            manifest = _object(candidate["source_manifest_json"])
            if _digest(manifest) != str(row["expected_manifest_hash"]):
                raise QualificationError("store_state_invalid")
        else:
            raise QualificationError("store_state_invalid")
        snapshot = self.connection.execute(
            "SELECT * FROM source_snapshot WHERE snapshot_id=?", (row["snapshot_id"],),
        ).fetchone()
        if snapshot is None or (
            str(snapshot["source_url"]) != str(row["expected_source_url"])
            or str(snapshot["retrieved_at"]) != str(row["expected_retrieved_at"])
            or str(snapshot["expires_at"]) != str(row["expected_expires_at"])
            or str(snapshot["content_sha256"]) != str(row["expected_content_sha256"])
            or str(snapshot["body_ref"]) != str(row["expected_body_ref"])
        ):
            raise QualificationError("store_state_invalid")
        if _timestamp(snapshot["expires_at"], "store_state_invalid") < now:
            raise QualificationError("source_stale")
        try:
            captured = read_owned(
                _snapshot_root(self.connection), str(row["expected_body_ref"]), maximum=MAX_SOURCE_BYTES,
            )
        except SourceCaptureError:
            raise QualificationError("source_changed") from None
        if sha256(captured.contents).hexdigest() != str(row["expected_content_sha256"]):
            raise QualificationError("source_changed")
        try:
            return captured.contents.decode("utf-8", errors="strict")
        except UnicodeError:
            raise QualificationError("store_state_invalid") from None

    def _job(self, item: sqlite3.Row) -> tuple[bytes, dict[str, object]]:
        batch = self.connection.execute(
            "SELECT * FROM prospecting_qualification_batch WHERE batch_id=?", (item["batch_id"],),
        ).fetchone()
        intake, funding, people = self._context(run_id=str(batch["run_id"]))
        if (
            funding.batch_id != batch["funding_batch_id"] or funding.batch_hash != batch["funding_batch_hash"]
            or people.batch_id != batch["person_batch_id"] or people.batch_hash != batch["person_batch_hash"]
            or intake.intake_hash != batch["intake_hash"]
        ):
            raise QualificationError("pipeline_context_stale")
        source_rows = tuple(self.connection.execute(
            "SELECT * FROM prospecting_qualification_source WHERE item_id=? ORDER BY ordinal",
            (item["item_id"],),
        ).fetchall())
        now = _now(self.now())
        sources = []
        for row in source_rows:
            observation = None
            if row["observation_id"] is not None:
                found = self.connection.execute(
                    "SELECT value FROM source_observation WHERE observation_id=? AND snapshot_id=?",
                    (row["observation_id"], row["snapshot_id"]),
                ).fetchone()
                if found is None:
                    raise QualificationError("store_state_invalid")
                observation = _object(found["value"])
            sources.append({
                "source_key": row["source_key"], "origin_kind": row["origin_kind"],
                "context_relation": row["context_relation"],
                "subject_candidate_id": row["subject_candidate_id"],
                "source_kind": row["source_kind"], "binding_kind": row["binding_kind"],
                "source_url": row["expected_source_url"],
                "retrieved_at": row["expected_retrieved_at"],
                "expires_at": row["expected_expires_at"],
                "content_sha256": row["expected_content_sha256"],
                "observation_id": row["observation_id"], "observation": observation,
                "body": self._read_source(row, now),
            })
        candidate_ids = _array(item["candidate_ids_json"])
        candidates = []
        for candidate_id in candidate_ids:
            candidate = self.connection.execute(
                "SELECT * FROM prospecting_person_candidate WHERE candidate_id=?", (candidate_id,),
            ).fetchone()
            if candidate is None:
                raise QualificationError("store_state_invalid")
            identity = _object(candidate["candidate_identity_json"])
            candidates.append({
                "candidate_id": candidate_id, "company_id": candidate["company_id"],
                "person_id": candidate["person_id"], "employment_id": candidate["employment_id"],
                "observation_id": candidate["observation_id"], "identity": identity,
            })
        company = self.connection.execute(
            "SELECT candidate_identity_json,latest_stage,latest_announced_at,reason_codes_json FROM prospecting_funding_company WHERE result_id=?",
            (item["funding_result_id"],),
        ).fetchone()
        if company is None:
            raise QualificationError("store_state_invalid")
        value = {
            "stage": STAGE, "qualification_item_id": item["item_id"],
            "context": {
                "run_id": batch["run_id"], "intake_hash": batch["intake_hash"],
                "campaign_policy_hash": batch["campaign_policy_hash"],
                "funding_batch_id": batch["funding_batch_id"],
                "funding_batch_hash": batch["funding_batch_hash"],
                "person_batch_id": batch["person_batch_id"],
                "person_batch_hash": batch["person_batch_hash"],
                "source_binding_hash": item["source_binding_hash"],
                "context_codes": list(_array(item["context_codes_json"])),
            },
            "criteria": {
                "as_of_date": intake.as_of_date, "cutoff_date": intake.cutoff_date,
                "funding_stage_min": intake.funding_stage_min,
                "funding_stage_max": intake.funding_stage_max,
                "funding_interpretation": intake.funding_stage_interpretation,
                "geography": {"mode": intake.geography.mode, "values": list(intake.geography.values)},
                "sector": {"mode": intake.sector.mode, "values": list(intake.sector.values)},
                "role_families": list(intake.role_families),
            },
            "company": {
                "funding_result_id": item["funding_result_id"], "company_id": item["company_id"],
                "identity": _object(company["candidate_identity_json"]),
                "latest_stage": company["latest_stage"],
                "latest_announced_at": company["latest_announced_at"],
                "provisional_reason_codes": list(_array(company["reason_codes_json"])),
            },
            "candidates": candidates, "sources": sources,
        }
        try:
            encoded = _canonical(value).encode("utf-8")
        except QualificationError:
            raise QualificationError("qualification_input_invalid") from None
        if len(encoded) > MAX_INPUT_BYTES:
            raise QualificationError("qualification_input_too_large")
        return encoded, value

    @staticmethod
    def _fixed_strings(value: object, code: str) -> tuple[str, ...]:
        if type(value) is not list or len(value) > MAX_LIST:
            raise QualificationError(code)
        result = []
        for item in value:
            if type(item) is not str or not item or len(item) > 80 or _CONTROL.search(item):
                raise QualificationError(code)
            result.append(item)
        if len(set(result)) != len(result):
            raise QualificationError(code)
        return tuple(result)

    @classmethod
    def _uncertainties(cls, value: object) -> tuple[str, ...]:
        result = cls._fixed_strings(value, "qualification_output_invalid")
        if any(item not in _UNCERTAINTY_CODES for item in result):
            raise QualificationError("qualification_output_invalid")
        return result

    @staticmethod
    def _enum(value: object, allowed: frozenset[str]) -> str:
        if type(value) is not str or value not in allowed:
            raise QualificationError("qualification_output_invalid")
        return value

    def _validate_payload(self, item: sqlite3.Row, payload: object) -> tuple[dict[str, object], dict[str, object]]:
        try:
            encoded = _canonical(payload).encode("utf-8")
        except QualificationError:
            raise _payload_invalid("payload_contract") from None
        if len(encoded) > MAX_OUTPUT_BYTES or type(payload) is not dict or set(payload) != {"company", "people"}:
            raise _payload_invalid("payload_contract")
        company = payload["company"]
        people = payload["people"]
        if type(company) is not dict or set(company) != {
            "identity_consistency", "location", "sector", "funding_events",
            "coverage_assessment", "source_agreement", "uncertainty_codes",
        } or type(people) is not list:
            raise _payload_invalid("payload_contract")
        self._enum(company["identity_consistency"], _CONSISTENCY)
        self._enum(company["coverage_assessment"], _COVERAGE)
        self._enum(company["source_agreement"], _AGREEMENT)
        for key in ("location", "sector"):
            if company[key] is not None and (type(company[key]) is not str or not company[key] or len(company[key]) > 240):
                raise QualificationError("qualification_output_invalid")
        company_uncertainty = self._uncertainties(company["uncertainty_codes"])
        source_rows = {
            str(row["source_key"]): row for row in self.connection.execute(
                "SELECT * FROM prospecting_qualification_source WHERE item_id=?", (item["item_id"],),
            )
        }
        event_findings = company["funding_events"]
        if type(event_findings) is not list or len(event_findings) > MAX_LIST:
            raise QualificationError("qualification_output_invalid")
        supports_required_event = False
        has_company_contradiction = company["identity_consistency"] == "contradicted" or company["source_agreement"] == "conflict"
        required_event_keys = {
            key for key, source in source_rows.items()
            if source["origin_kind"] == "funding" and source["binding_kind"] == "funding_event"
        }
        found_event_keys: set[str] = set()
        event_uncertainty: set[str] = set()
        batch = self.connection.execute(
            "SELECT run_id FROM prospecting_qualification_batch WHERE batch_id=?", (item["batch_id"],),
        ).fetchone()
        try:
            intake = PipelineService(
                self.connection, now=lambda: _now(self.now()).isoformat(),
            ).get_projection(str(batch["run_id"]))
        except PipelineError:
            raise QualificationError("pipeline_context_stale") from None
        for finding in event_findings:
            if type(finding) is not dict or set(finding) != {
                "source_key", "authority", "entailment", "stage", "announced_at", "uncertainty_codes",
            }:
                raise QualificationError("qualification_output_invalid")
            if type(finding["source_key"]) is not str:
                raise QualificationError("qualification_output_invalid")
            source = source_rows.get(finding["source_key"])
            if source is None or source["origin_kind"] != "funding" or source["binding_kind"] != "funding_event":
                raise _payload_invalid("funding_source_binding")
            if finding["source_key"] in found_event_keys:
                raise QualificationError("qualification_output_invalid")
            found_event_keys.add(str(finding["source_key"]))
            self._enum(finding["authority"], _AUTHORITY)
            self._enum(finding["entailment"], _ENTAILMENT)
            if type(finding["stage"]) is not str or type(finding["announced_at"]) is not str:
                raise QualificationError("qualification_output_invalid")
            finding_uncertainty = self._uncertainties(finding["uncertainty_codes"])
            event_uncertainty.update(finding_uncertainty)
            observation = self.connection.execute(
                "SELECT value FROM source_observation WHERE observation_id=?", (source["observation_id"],),
            ).fetchone()
            value = _object(observation["value"] if observation is not None else None)
            event = value.get("event")
            if type(event) is not dict or finding["stage"] != event.get("stage") or finding["announced_at"] != event.get("announced_at"):
                raise _payload_invalid("funding_observation_binding")
            if finding["entailment"] == "contradicts":
                has_company_contradiction = True
            if (
                finding["entailment"] == "supports_exact_stage_date"
                and finding["authority"] in {"issuer", "participating_investor"}
                and not finding_uncertainty
            ):
                company_row = self.connection.execute(
                    "SELECT latest_stage,latest_announced_at FROM prospecting_funding_company WHERE result_id=?",
                    (item["funding_result_id"],),
                ).fetchone()
                if intake.funding_stage_interpretation == "latest_known":
                    supports_required_event = supports_required_event or (
                        finding["stage"] == company_row["latest_stage"]
                        and finding["announced_at"] == company_row["latest_announced_at"]
                    )
                else:
                    event_date = datetime.fromisoformat(str(finding["announced_at"])).date()
                    supports_required_event = supports_required_event or (
                        datetime.fromisoformat(intake.cutoff_date).date() <= event_date
                        <= datetime.fromisoformat(intake.as_of_date).date()
                        and FUNDING_STAGES.index(str(intake.funding_stage_min))
                        <= FUNDING_STAGES.index(str(finding["stage"]))
                        <= FUNDING_STAGES.index(str(intake.funding_stage_max))
                    )
        if found_event_keys != required_event_keys:
            raise _payload_invalid("funding_source_binding")
        identity = _object(self.connection.execute(
            "SELECT candidate_identity_json FROM prospecting_funding_company WHERE result_id=?",
            (item["funding_result_id"],),
        ).fetchone()[0])
        company_supported = (
            company["identity_consistency"] == "consistent"
            and company["source_agreement"] == "consistent"
            and company["coverage_assessment"] == "bounded_current_search"
            and _normal(company["location"]) == _normal(identity.get("location"))
            and _normal(company["sector"]) == _normal(identity.get("sector"))
            and supports_required_event and not has_company_contradiction
            and not company_uncertainty and not event_uncertainty
        )
        company_outcome = "source_supported" if company_supported else (
            "contradicted" if has_company_contradiction else "unknown"
        )
        expected_ids = _array(item["candidate_ids_json"])
        if len(people) != len(expected_ids):
            raise _payload_invalid("candidate_binding")
        person_results: list[dict[str, object]] = []
        seen: set[str] = set()
        for finding in people:
            if type(finding) is not dict or set(finding) != {
                "candidate_id", "page_kind", "role_statement", "observed_name",
                "observed_company", "observed_title", "title_granularity",
                "continuity", "source_keys", "uncertainty_codes",
            }:
                raise QualificationError("qualification_output_invalid")
            candidate_id = finding["candidate_id"]
            if type(candidate_id) is not str or candidate_id not in expected_ids or candidate_id in seen:
                raise _payload_invalid("candidate_binding")
            seen.add(candidate_id)
            self._enum(finding["page_kind"], _PAGE_KIND)
            self._enum(finding["role_statement"], _ROLE_STATEMENT)
            self._enum(finding["title_granularity"], _GRANULARITY)
            self._enum(finding["continuity"], _CONTINUITY)
            for key in ("observed_name", "observed_company", "observed_title"):
                if finding[key] is not None and (type(finding[key]) is not str or not finding[key] or len(finding[key]) > 240):
                    raise QualificationError("qualification_output_invalid")
            source_keys = self._fixed_strings(finding["source_keys"], "qualification_output_invalid")
            uncertainty = self._uncertainties(finding["uncertainty_codes"])
            expected_source_keys = {
                key for key, source in source_rows.items()
                if source["origin_kind"] == "person"
                and source["subject_candidate_id"] == candidate_id
            }
            if set(source_keys) != expected_source_keys or not source_keys or any(
                key not in source_rows
                or source_rows[key]["origin_kind"] != "person"
                or source_rows[key]["subject_candidate_id"] != candidate_id
                for key in source_keys
            ):
                raise _payload_invalid("person_source_binding")
            candidate = self.connection.execute(
                "SELECT candidate_identity_json FROM prospecting_person_candidate WHERE candidate_id=?",
                (candidate_id,),
            ).fetchone()
            candidate_identity = _object(candidate[0])
            context_ambiguous = any(
                source_rows[key]["context_relation"] in {
                    "potential_conflict", "predecessor_title_disagreement",
                }
                for key in source_keys
            ) or "person_history_incomplete" in _array(item["context_codes_json"])
            exact = (
                _normal(finding["observed_name"]) == _normal(candidate_identity.get("full_name"))
                and _normal(finding["observed_company"]) == _normal(
                    _object(self.connection.execute(
                        "SELECT candidate_identity_json FROM prospecting_funding_company WHERE result_id=?",
                        (item["funding_result_id"],),
                    ).fetchone()[0]).get("name")
                )
                and _normal(finding["observed_title"]) == _normal(candidate_identity.get("title"))
            )
            if finding["title_granularity"] in {"narrower", "broader"}:
                uncertainty = tuple(sorted(set(uncertainty) | {"title_granularity_mismatch"}))
            contradicted = (
                finding["continuity"] == "contradicted"
                or finding["title_granularity"] == "different"
            )
            supported = (
                company_supported and not context_ambiguous
                and finding["page_kind"] in {"current_individual_profile", "current_company_team"}
                and finding["role_statement"] == "current"
                and finding["title_granularity"] == "exact"
                and finding["continuity"] == "current_statement"
                and exact and not uncertainty
            )
            outcome = "current_role_supported" if supported else (
                "contradicted" if contradicted else "unknown"
            )
            person_results.append({
                "candidate_id": candidate_id, "outcome": outcome,
                "source_keys": list(source_keys), "uncertainty_codes": list(uncertainty),
                "page_kind": finding["page_kind"], "role_statement": finding["role_statement"],
                "title_granularity": finding["title_granularity"], "continuity": finding["continuity"],
            })
        if seen != set(expected_ids):
            raise _payload_invalid("candidate_binding")
        derived = {
            "company_outcome": company_outcome,
            "company_uncertainty_codes": sorted(set(company_uncertainty) | event_uncertainty),
            "people": person_results,
        }
        return dict(payload), derived

    def _latest_attempts(self, item_id: str) -> tuple[sqlite3.Row, ...]:
        return tuple(self.connection.execute(
            "SELECT * FROM prospecting_qualification_attempt WHERE item_id=? ORDER BY claim_epoch",
            (item_id,),
        ).fetchall())

    def run_next(self, item_id: str, request_id: str) -> QualificationItemProjection:
        item_id = _id(item_id, "invalid_item_id")
        request_id = _uuid(request_id, "invalid_request_id")
        item = self.connection.execute(
            "SELECT * FROM prospecting_qualification_item WHERE item_id=?", (item_id,),
        ).fetchone()
        if item is None:
            raise QualificationError("qualification_item_missing")
        replay = self.connection.execute(
            "SELECT * FROM prospecting_qualification_attempt WHERE request_id=?", (request_id,),
        ).fetchone()
        if replay is not None:
            if replay["item_id"] != item_id:
                raise QualificationError("request_conflict")
            if replay["state"] == "succeeded":
                return self._item_projection(item)
            if replay["state"] == "claimed":
                if _now(self.now()) > _timestamp(replay["lease_until"], "store_state_invalid"):
                    self.recover_expired(item_id)
                    raise QualificationError("lease_expired")
                raise QualificationError("qualification_in_progress")
            raise QualificationError(str(replay["failure_code"] or "qualification_attempt_failed"))
        if self.connection.execute(
            "SELECT 1 FROM prospecting_qualification_artifact WHERE item_id=?", (item_id,),
        ).fetchone() is not None:
            raise QualificationError("qualification_already_complete")
        attempts = self._latest_attempts(item_id)
        if len(attempts) >= int(item["max_attempts"]):
            raise QualificationError("qualification_attempts_exhausted")
        if attempts and attempts[-1]["state"] == "claimed":
            raise QualificationError("qualification_in_progress")
        adapter = self.adapters.get(STAGE)
        if adapter is None:
            raise QualificationError("qualification_adapter_unavailable")
        binding = _binding(adapter.binding)
        input_json, _value = self._job(item)
        input_hash = sha256(input_json).hexdigest()
        epoch = len(attempts) + 1
        token = secrets.token_urlsafe(32)
        attempt_id = "pqat_" + uuid.uuid4().hex
        worker_job_id = "pqwj_" + uuid.uuid4().hex
        timestamp = _now(self.now())
        lease = timestamp + timedelta(minutes=5)
        request_hash = _digest({
            "operation": "run_qualification", "request_id": request_id,
            "item_id": item_id, "epoch": epoch, "input_hash": input_hash,
        })
        if self.connection.in_transaction:
            raise QualificationError("transaction_active")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            concurrent_replay = self.connection.execute(
                "SELECT * FROM prospecting_qualification_attempt WHERE request_id=?", (request_id,),
            ).fetchone()
            if concurrent_replay is not None:
                if (
                    concurrent_replay["item_id"] != item_id
                    or concurrent_replay["request_hash"] != request_hash
                ):
                    raise QualificationError("request_conflict")
                replay_state = str(concurrent_replay["state"])
                replay_failure = str(
                    concurrent_replay["failure_code"] or "qualification_attempt_failed"
                )
                replay_lease = str(concurrent_replay["lease_until"])
                self.connection.commit()
                if replay_state == "succeeded":
                    return self._item_projection(item)
                if replay_state == "claimed":
                    if _now(self.now()) > _timestamp(replay_lease, "store_state_invalid"):
                        self.recover_expired(item_id)
                        raise QualificationError("lease_expired")
                    raise QualificationError("qualification_in_progress")
                raise QualificationError(replay_failure)
            current_attempts = self._latest_attempts(item_id)
            if self.connection.execute(
                "SELECT 1 FROM prospecting_qualification_artifact WHERE item_id=?", (item_id,),
            ).fetchone() is not None:
                raise QualificationError("qualification_already_complete")
            if (
                len(current_attempts) != len(attempts)
                or len(current_attempts) >= int(item["max_attempts"])
                or current_attempts and current_attempts[-1]["state"] == "claimed"
            ):
                raise QualificationError("qualification_conflict")
            self.connection.execute(
                """INSERT INTO prospecting_qualification_attempt(
                       attempt_id,request_id,request_hash,item_id,claim_epoch,input_hash,
                       worker_role,worker_identity,worker_job_id,attempt_token_hash,
                       runtime_id,runtime_version,runtime_hash,schema_hash,skill_name,
                       skill_version,skill_content_hash,skill_manifest_hash,state,
                       lease_until,failure_code,created_at,finished_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (attempt_id, request_id, request_hash, item_id, epoch, input_hash,
                 "qualification_factchecker", binding.executor_identity, worker_job_id,
                 sha256(token.encode()).hexdigest(), binding.runtime_id,
                 binding.runtime_version, binding.runtime_hash, binding.schema_hash,
                 binding.skill_name, binding.skill_version, binding.skill_content_hash,
                 binding.skill_manifest_hash, "claimed", lease.isoformat(), None,
                 timestamp.isoformat(), None),
            )
            self.connection.commit()
        except BaseException as error:
            self.connection.rollback()
            if isinstance(error, QualificationError):
                raise
            if isinstance(error, sqlite3.Error):
                raise QualificationError("store_state_invalid") from None
            raise
        job = StageJob(item_id, attempt_id, worker_job_id, STAGE, 0, input_hash, input_json)
        try:
            result = adapter.execute(job)
        except BaseException:
            self._fail_attempt(attempt_id, "qualification_adapter_failed")
            raise QualificationError("qualification_adapter_failed") from None
        if not isinstance(result, StageResult):
            self._fail_attempt(attempt_id, "qualification_output_invalid")
            raise QualificationError("qualification_output_invalid")
        try:
            self._submit(attempt_id, token, result)
        except QualificationError as error:
            self._fail_attempt(
                attempt_id,
                str(error),
            )
            raise
        except BaseException:
            self._fail_attempt(attempt_id, "store_state_invalid")
            raise QualificationError("store_state_invalid") from None
        return self._item_projection(item)

    def _submit(self, attempt_id: str, token: str, result: StageResult) -> None:
        if self.connection.in_transaction:
            raise QualificationError("transaction_active")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            attempt = self.connection.execute(
                "SELECT * FROM prospecting_qualification_attempt WHERE attempt_id=?", (attempt_id,),
            ).fetchone()
            if (
                attempt is None or attempt["state"] != "claimed"
                or not secrets.compare_digest(
                    str(attempt["attempt_token_hash"]), sha256(token.encode()).hexdigest(),
                )
            ):
                raise QualificationError("lease_lost")
            if _now(self.now()) > _timestamp(attempt["lease_until"], "store_state_invalid"):
                raise QualificationError("lease_expired")
            item = self.connection.execute(
                "SELECT * FROM prospecting_qualification_item WHERE item_id=?", (attempt["item_id"],),
            ).fetchone()
            current_input, _value = self._job(item)
            if sha256(current_input).hexdigest() != attempt["input_hash"]:
                raise QualificationError("qualification_context_stale")
            try:
                payload, derived = self._validate_payload(item, result.payload)
            except QualificationError as error:
                if (
                    str(error) == "qualification_output_invalid"
                    and getattr(error, "diagnostic_code", None) is None
                ):
                    raise _payload_invalid("payload_contract") from None
                raise
            except (KeyError, TypeError, ValueError, UnicodeError, RecursionError):
                raise _payload_invalid("payload_contract") from None
            timestamp = _now(self.now()).isoformat()
            updated = self.connection.execute(
                """UPDATE prospecting_qualification_attempt
                      SET state='succeeded',finished_at=?
                    WHERE attempt_id=? AND state='claimed'""",
                (timestamp, attempt_id),
            )
            if updated.rowcount != 1:
                raise QualificationError("lease_lost")
            self.connection.execute(
                """INSERT INTO prospecting_qualification_artifact(
                       artifact_id,attempt_id,item_id,input_hash,output_hash,
                       source_binding_hash,payload_json,derived_json,producer_role,
                       producer_identity,producer_job_id,runtime_id,runtime_hash,
                       schema_hash,skill_name,skill_version,skill_content_hash,
                       skill_manifest_hash,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                ("pqaf_" + uuid.uuid4().hex, attempt_id, item["item_id"], attempt["input_hash"],
                 sha256(_canonical(payload).encode()).hexdigest(), item["source_binding_hash"],
                 _canonical(payload), _canonical(derived), "qualification_factchecker",
                 attempt["worker_identity"], attempt["worker_job_id"], attempt["runtime_id"],
                 attempt["runtime_hash"], attempt["schema_hash"], attempt["skill_name"],
                 attempt["skill_version"], attempt["skill_content_hash"],
                 attempt["skill_manifest_hash"], timestamp),
            )
            self.connection.commit()
        except BaseException:
            self.connection.rollback()
            raise

    def _fail_attempt(self, attempt_id: str, code: str) -> None:
        safe = code if code in _ATTEMPT_FAILURE_CODES else "qualification_adapter_failed"
        state = "expired" if safe == "lease_expired" else "failed"
        try:
            if self.connection.in_transaction:
                self.connection.rollback()
            self.connection.execute("BEGIN IMMEDIATE")
            self.connection.execute(
                """UPDATE prospecting_qualification_attempt
                      SET state=?,failure_code=?,finished_at=?
                    WHERE attempt_id=? AND state='claimed'""",
                (state, safe, _now(self.now()).isoformat(), attempt_id),
            )
            self.connection.commit()
        except sqlite3.Error:
            self.connection.rollback()

    def recover_expired(self, item_id: str) -> QualificationItemProjection:
        item_id = _id(item_id, "invalid_item_id")
        if self.connection.in_transaction:
            raise QualificationError("transaction_active")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            item = self.connection.execute(
                "SELECT * FROM prospecting_qualification_item WHERE item_id=?", (item_id,),
            ).fetchone()
            if item is None:
                raise QualificationError("qualification_item_missing")
            attempt = self.connection.execute(
                """SELECT * FROM prospecting_qualification_attempt
                    WHERE item_id=? AND state='claimed' ORDER BY claim_epoch DESC LIMIT 1""",
                (item_id,),
            ).fetchone()
            if attempt is None:
                raise QualificationError("claimed_attempt_missing")
            current = _now(self.now())
            if current <= _timestamp(attempt["lease_until"], "store_state_invalid"):
                raise QualificationError("lease_active")
            self.connection.execute(
                """UPDATE prospecting_qualification_attempt
                      SET state='expired',failure_code='lease_expired',finished_at=?
                    WHERE attempt_id=? AND state='claimed'""",
                (current.isoformat(), attempt["attempt_id"]),
            )
            self.connection.commit()
            return self._item_projection(item)
        except BaseException:
            self.connection.rollback()
            raise

    def _item_projection(self, item: sqlite3.Row) -> QualificationItemProjection:
        attempts = self._latest_attempts(str(item["item_id"]))
        if any(int(attempt["claim_epoch"]) != index for index, attempt in enumerate(attempts, 1)):
            raise QualificationError("store_state_invalid")
        artifact = self.connection.execute(
            "SELECT * FROM prospecting_qualification_artifact WHERE item_id=?", (item["item_id"],),
        ).fetchone()
        company_outcome = None
        counts = {"current_role_supported": 0, "contradicted": 0, "unknown": 0}
        if artifact is not None:
            attempt = next(
                (row for row in attempts if row["attempt_id"] == artifact["attempt_id"]), None,
            )
            if (
                attempt is None or attempt["state"] != "succeeded"
                or artifact["input_hash"] != attempt["input_hash"]
                or artifact["source_binding_hash"] != item["source_binding_hash"]
                or sha256(str(artifact["payload_json"]).encode()).hexdigest() != artifact["output_hash"]
            ):
                raise QualificationError("store_state_invalid")
            derived = _object(artifact["derived_json"])
            company_outcome = str(derived.get("company_outcome"))
            people = derived.get("people")
            if type(people) is not list:
                raise QualificationError("store_state_invalid")
            for person in people:
                if type(person) is not dict or person.get("outcome") not in counts:
                    raise QualificationError("store_state_invalid")
                counts[str(person["outcome"])] += 1
        return QualificationItemProjection(
            str(item["item_id"]), str(item["funding_result_id"]), str(item["company_id"]),
            _derived_state(attempts, artifact, int(item["max_attempts"])),
            len(_array(item["candidate_ids_json"])), _array(item["context_codes_json"]),
            company_outcome, MappingProxyType(counts),
        )

    def _stored_projection(self, batch_id: str) -> QualificationBatchProjection:
        batch = self.connection.execute(
            "SELECT * FROM prospecting_qualification_batch WHERE batch_id=?", (batch_id,),
        ).fetchone()
        if batch is None:
            raise QualificationError("store_state_invalid")
        item_rows = tuple(self.connection.execute(
            "SELECT * FROM prospecting_qualification_item WHERE batch_id=? ORDER BY ordinal", (batch_id,),
        ).fetchall())
        self._validate_batch_hash(batch, item_rows)
        for item in item_rows:
            self._validate_item_identity(item, read_sources=False)
        items = tuple(self._item_projection(item) for item in item_rows)
        states = {item.state for item in items}
        state = (
            "machine_reviewed" if items and states == {"machine_reviewed"} else
            "qualification_failed" if "qualification_failed" in states else
            "qualification_running" if "qualification_running" in states else
            "awaiting_qualification_adapter"
        )
        return QualificationBatchProjection(
            str(batch["batch_id"]), str(batch["batch_hash"]), str(batch["run_id"]),
            str(batch["intake_hash"]), str(batch["funding_batch_id"]),
            str(batch["funding_batch_hash"]), str(batch["person_batch_id"]),
            str(batch["person_batch_hash"]),
            None if batch["predecessor_batch_id"] is None else str(batch["predecessor_batch_id"]),
            None if batch["predecessor_hash"] is None else str(batch["predecessor_hash"]),
            state, items,
        )

    def _projection(self, batch_id: str, intake, funding, people) -> QualificationBatchProjection:
        batch = self.connection.execute(
            "SELECT * FROM prospecting_qualification_batch WHERE batch_id=?", (batch_id,),
        ).fetchone()
        if batch is None or (
            str(batch["run_id"]) != intake.run_id
            or str(batch["intake_hash"]) != intake.intake_hash
            or str(batch["campaign_policy_hash"]) != intake.campaign_policy_hash
            or str(batch["funding_batch_id"]) != funding.batch_id
            or str(batch["funding_batch_hash"]) != funding.batch_hash
            or str(batch["person_batch_id"]) != people.batch_id
            or str(batch["person_batch_hash"]) != people.batch_hash
            or str(batch["controller_policy_version"]) != CONTROLLER_POLICY_VERSION
        ):
            raise QualificationError("pipeline_context_stale")
        for item in self.connection.execute(
            "SELECT * FROM prospecting_qualification_item WHERE batch_id=? ORDER BY ordinal",
            (batch_id,),
        ).fetchall():
            self._validate_item_identity(item, read_sources=True)
        return self._stored_projection(batch_id)

    def get_projection(self, run_id: str) -> QualificationBatchProjection | None:
        if type(run_id) is not str or _RUN_ID.fullmatch(run_id) is None:
            raise QualificationError("invalid_run_id")
        intake, funding, people = self._context(run_id=run_id)
        row = self.connection.execute(
            "SELECT batch_id FROM prospecting_qualification_batch WHERE run_id=? ORDER BY rowid DESC LIMIT 1",
            (run_id,),
        ).fetchone()
        return None if row is None else self._projection(str(row[0]), intake, funding, people)

    def get_supported_scope(self, run_id: str) -> QualificationSupportedScope | None:
        """Return exact machine-reviewed bindings after rederiving stored outcomes."""
        projection = self.get_projection(run_id)
        if projection is None:
            return None
        if not projection.items or projection.state != "machine_reviewed":
            raise QualificationError("qualification_incomplete")
        batch = self.connection.execute(
            "SELECT * FROM prospecting_qualification_batch WHERE batch_id=?",
            (projection.batch_id,),
        ).fetchone()
        if batch is None:
            raise QualificationError("store_state_invalid")
        intake, _funding, _people = self._context(run_id=run_id)
        companies: list[QualificationSupportedCompany] = []
        for item_projection in projection.items:
            item = self.connection.execute(
                "SELECT * FROM prospecting_qualification_item WHERE item_id=?",
                (item_projection.item_id,),
            ).fetchone()
            artifact = self.connection.execute(
                "SELECT * FROM prospecting_qualification_artifact WHERE item_id=?",
                (item_projection.item_id,),
            ).fetchone()
            if item is None or artifact is None:
                raise QualificationError("store_state_invalid")
            attempt = self.connection.execute(
                "SELECT * FROM prospecting_qualification_attempt WHERE attempt_id=?",
                (artifact["attempt_id"],),
            ).fetchone()
            if attempt is None or attempt["state"] != "succeeded" or any(
                str(artifact[left]) != str(attempt[right])
                for left, right in (
                    ("item_id", "item_id"), ("input_hash", "input_hash"),
                    ("producer_identity", "worker_identity"),
                    ("producer_job_id", "worker_job_id"), ("runtime_id", "runtime_id"),
                    ("runtime_hash", "runtime_hash"), ("schema_hash", "schema_hash"),
                    ("skill_name", "skill_name"), ("skill_version", "skill_version"),
                    ("skill_content_hash", "skill_content_hash"),
                    ("skill_manifest_hash", "skill_manifest_hash"),
                )
            ):
                raise QualificationError("store_state_invalid")
            payload = _object(artifact["payload_json"])
            if (
                _canonical(payload) != str(artifact["payload_json"])
                or sha256(str(artifact["payload_json"]).encode()).hexdigest()
                != str(artifact["output_hash"])
            ):
                raise QualificationError("store_state_invalid")
            _payload, derived = self._validate_payload(item, payload)
            if _canonical(derived) != str(artifact["derived_json"]):
                raise QualificationError("store_state_invalid")
            derived_people = {
                str(value["candidate_id"]): str(value["outcome"])
                for value in derived["people"]
            }
            candidates: list[QualificationSupportedCandidate] = []
            for candidate_id in _array(item["candidate_ids_json"]):
                candidate = self.connection.execute(
                    "SELECT * FROM prospecting_person_candidate WHERE candidate_id=?",
                    (candidate_id,),
                ).fetchone()
                if candidate is None or any(
                    candidate[key] is None
                    for key in ("person_id", "employment_id", "observation_id")
                ):
                    raise QualificationError("store_state_invalid")
                identity = _object(candidate["candidate_identity_json"])
                title = identity.get("title")
                if type(title) is not str or not title:
                    raise QualificationError("store_state_invalid")
                employment = self.connection.execute(
                    "SELECT * FROM employment WHERE employment_id=?",
                    (candidate["employment_id"],),
                ).fetchone()
                if employment is None or (
                    str(employment["person_id"]) != str(candidate["person_id"])
                    or str(employment["company_id"]) != str(candidate["company_id"])
                    or employment["valid_to"] is not None
                    or _normal(employment["title"]) != _normal(title)
                ):
                    raise QualificationError("store_state_invalid")
                current_source = self.connection.execute(
                    """SELECT 1 FROM prospecting_qualification_source
                        WHERE item_id=? AND origin_kind='person'
                          AND context_relation='current' AND origin_row_id=?
                          AND observation_id=? AND snapshot_id=?""",
                    (
                        item["item_id"], candidate_id, candidate["observation_id"],
                        candidate["snapshot_id"],
                    ),
                ).fetchall()
                if len(current_source) != 1 or candidate_id not in derived_people:
                    raise QualificationError("store_state_invalid")
                candidates.append(QualificationSupportedCandidate(
                    candidate_id, int(candidate["ordinal"]), str(candidate["person_id"]),
                    str(candidate["employment_id"]), str(candidate["observation_id"]),
                    str(employment["source_observation_id"]), title,
                    sha256(title.encode()).hexdigest(), derived_people[candidate_id],
                ))
            supported_people = len({
                candidate.person_id for candidate in candidates
                if candidate.outcome == "current_role_supported"
            })
            desired = int(intake.requested_people_per_company)
            companies.append(QualificationSupportedCompany(
                str(item["item_id"]), str(artifact["artifact_id"]),
                str(artifact["output_hash"]), str(item["funding_result_id"]),
                str(item["company_id"]), str(derived["company_outcome"]), desired,
                max(0, desired - supported_people), tuple(candidates),
            ))
        return QualificationSupportedScope(
            projection.batch_id, projection.batch_hash, projection.run_id,
            projection.intake_hash, str(batch["campaign_policy_hash"]),
            projection.funding_batch_id, projection.funding_batch_hash,
            projection.person_batch_id, projection.person_batch_hash,
            str(batch["controller_policy_version"]), tuple(companies),
        )

    @staticmethod
    def _result(value: QualificationBatchProjection, replayed: bool) -> QualificationResult:
        counts = {
            "items": len(value.items),
            "machine_reviewed": sum(item.state == "machine_reviewed" for item in value.items),
            "source_supported_companies": sum(item.company_outcome == "source_supported" for item in value.items),
            "source_supported_people": sum(item.person_counts["current_role_supported"] for item in value.items),
        }
        return QualificationResult(
            value.batch_id, value.batch_hash, value.run_id, value.state,
            MappingProxyType(counts), replayed,
        )


__all__ = [
    "QualificationBatchProjection", "QualificationError", "QualificationItemProjection",
    "QualificationResult", "QualificationService", "QualificationStartRequest",
    "QualificationSupportedCandidate", "QualificationSupportedCompany",
    "QualificationSupportedScope",
]
