"""Persisted exact-revision Humanizer pipeline and shared readiness gate."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import json
import secrets
import sqlite3
from types import MappingProxyType
from typing import Callable, Mapping, Protocol
from uuid import uuid4

from scripts.prospecting.affinity.evidence_bridge import (
    CurrentRoleProof,
    attested_current_role_source,
    current_role_source_proof,
)
from scripts.prospecting.personalizer.evidence import EvidenceRecord
from scripts.prospecting.personalizer.qa import (
    RECIPIENT_SLOTS,
    QaPolicy,
    QaResult,
    SlotBinding,
    validate_revision,
)
from scripts.prospecting.personalizer.revision import RevisionInput, build_revision, revision_hash
from scripts.prospecting.review_qa import load_revision_qa_context, record_revision_qa_context


STAGES = ("humanizer", "post_humanization_factcheck", "independent_critic")
ROLE_FOR_STAGE = MappingProxyType({
    "humanizer": "humanizer",
    "post_humanization_factcheck": "post_factchecker",
    "independent_critic": "independent_critic",
})
WAITING_FOR_STAGE = MappingProxyType({
    "humanizer": "awaiting_humanizer_adapter",
    "post_humanization_factcheck": "awaiting_post_factcheck_adapter",
    "independent_critic": "awaiting_critic_adapter",
})
RUNNING_FOR_STAGE = MappingProxyType({
    "humanizer": "humanizer_running",
    "post_humanization_factcheck": "post_factcheck_running",
    "independent_critic": "critic_running",
})
MAX_TEXT = 65_536
MAX_LIST = 32
MAX_STAGE_INPUT_BYTES = 1024 * 1024
MAX_STAGE_OUTPUT_BYTES = 256 * 1024


class PipelineStageError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class StageBinding:
    executor_identity: str
    runtime_id: str
    runtime_version: str
    runtime_hash: str
    schema_hash: str
    skill_name: str
    skill_version: str
    skill_content_hash: str
    skill_manifest_hash: str


@dataclass(frozen=True)
class StageJob:
    item_id: str
    attempt_id: str
    worker_job_id: str
    stage: str
    cycle: int
    input_hash: str
    input_json: bytes = field(repr=False)


@dataclass(frozen=True)
class StageResult:
    payload: Mapping[str, object] = field(repr=False)


class StageAdapter(Protocol):
    binding: StageBinding

    def execute(self, job: StageJob) -> StageResult: ...


@dataclass(frozen=True)
class ItemProjection:
    item_id: str
    campaign_id: str
    person_id: str
    base_revision_id: str
    state: str
    next_stage: str | None
    repair_cycle: int


@dataclass(frozen=True)
class AcceptanceResult:
    decision_id: str
    revision_id: str
    revision_hash: str
    unchanged: bool
    replayed: bool = False


@dataclass(frozen=True)
class RejectionResult:
    decision_id: str
    item_id: str
    replayed: bool = False


@dataclass(frozen=True)
class ReviewProjection:
    item: ItemProjection
    source_proof: CurrentRoleProof | None
    suggestion_id: str | None
    suggestion_subject: str | None
    suggestion_body: str | None
    proposed_revision_hash: str | None
    decision: str | None


def _canonical(value: object) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        allow_nan=False,
    )


def _bounded_json_object(value: object, code: str) -> dict[str, object]:
    """Copy an adapter result through strict JSON before inspecting or storing it."""
    if type(value) is not dict:
        raise PipelineStageError(code)
    try:
        encoded = _canonical(value).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise PipelineStageError(code) from None
    if len(encoded) > MAX_STAGE_OUTPUT_BYTES:
        raise PipelineStageError(code)
    decoded = json.loads(encoded)
    if type(decoded) is not dict:
        raise PipelineStageError(code)
    return decoded


def _bounded_stage_input(value: object) -> bytes:
    try:
        encoded = _canonical(value).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise PipelineStageError("stage_input_invalid") from None
    if len(encoded) > MAX_STAGE_INPUT_BYTES:
        raise PipelineStageError("stage_input_too_large")
    return encoded


def _bounded_stage_output(value: object, code: str) -> str:
    try:
        encoded = _canonical(value).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise PipelineStageError(code) from None
    if len(encoded) > MAX_STAGE_OUTPUT_BYTES:
        raise PipelineStageError(code)
    return encoded.decode("utf-8")


def _digest(*parts: object) -> str:
    return hashlib.sha256(_canonical(parts).encode()).hexdigest()


def _text(value: object, code: str, *, maximum: int = MAX_TEXT) -> str:
    if type(value) is not str or not value or "\x00" in value:
        raise PipelineStageError(code)
    try:
        if len(value.encode()) > maximum:
            raise PipelineStageError(code)
    except UnicodeError:
        raise PipelineStageError(code) from None
    return value


def _sha(value: object, code: str) -> str:
    value = _text(value, code, maximum=64)
    if len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
        raise PipelineStageError(code)
    return value


def _now(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise PipelineStageError("invalid_time")
    return value.astimezone(timezone.utc)


def _timestamp(value: object, code: str) -> datetime:
    value = _text(value, code, maximum=64)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise PipelineStageError(code) from None
    return _now(parsed)


def _string_list(value: object, code: str) -> list[str]:
    if not isinstance(value, (list, tuple)) or len(value) > MAX_LIST:
        raise PipelineStageError(code)
    return [_text(item, code, maximum=2048) for item in value]


def _validate_binding(value: object) -> StageBinding:
    if not isinstance(value, StageBinding):
        raise PipelineStageError("invalid_stage_binding")
    for item in (
        value.executor_identity, value.runtime_id, value.runtime_version,
        value.skill_name, value.skill_version
    ):
        _text(item, "invalid_stage_binding", maximum=128)
    for digest in (
        value.runtime_hash, value.schema_hash, value.skill_content_hash,
        value.skill_manifest_hash,
    ):
        _sha(digest, "invalid_stage_binding")
    return value


def _query(
    connection: sqlite3.Connection, sql: str, parameters: tuple[object, ...] = (),
) -> sqlite3.Cursor:
    cursor = connection.cursor()
    cursor.row_factory = sqlite3.Row
    return cursor.execute(sql, parameters)


def _revision(connection: sqlite3.Connection, revision_id: str) -> sqlite3.Row:
    row = _query(connection, "SELECT * FROM revision WHERE revision_id=?", (revision_id,)).fetchone()
    if row is None:
        raise PipelineStageError("revision_missing")
    return row


def _current_revision(connection: sqlite3.Connection, revision: sqlite3.Row) -> bool:
    latest = _query(connection,
        "SELECT revision_id FROM revision WHERE campaign_id=? AND person_id=? AND step=? ORDER BY rowid DESC LIMIT 1",
        (revision["campaign_id"], revision["person_id"], revision["step"]),
    ).fetchone()
    return latest is not None and latest[0] == revision["revision_id"]


def _assert_no_unresolved_candidate(
    connection: sqlite3.Connection, campaign_id: str, revision_id: str,
) -> None:
    candidate = _query(
        connection,
        """SELECT qa_state FROM review_candidate
            WHERE campaign_id=? AND parent_revision_id=?
            ORDER BY rowid DESC LIMIT 1""",
        (campaign_id, revision_id),
    ).fetchone()
    if candidate is not None and candidate["qa_state"] in {"pending_qa", "qa_failed"}:
        raise PipelineStageError("human_edit_unresolved")


def _evidence_rows(connection: sqlite3.Connection, revision: sqlite3.Row) -> tuple[sqlite3.Row, ...]:
    try:
        ids = json.loads(str(revision["evidence_ids"]))
    except (TypeError, json.JSONDecodeError):
        raise PipelineStageError("revision_evidence_invalid") from None
    if not isinstance(ids, list) or not ids or len(ids) != len(set(ids)) or any(type(x) is not str for x in ids):
        raise PipelineStageError("revision_evidence_invalid")
    marks = ",".join("?" for _ in ids)
    rows = _query(connection,
        f"SELECT * FROM evidence WHERE person_id=? AND evidence_id IN ({marks}) ORDER BY evidence_id",
        (revision["person_id"], *ids),
    ).fetchall()
    if len(rows) != len(ids):
        raise PipelineStageError("revision_evidence_invalid")
    return tuple(rows)


def evidence_manifest_hash(connection: sqlite3.Connection, revision: sqlite3.Row) -> str:
    rows = _evidence_rows(connection, revision)
    return _digest([dict(row) for row in rows])


def _qa_context_payload(connection: sqlite3.Connection, revision_id: str) -> dict[str, object]:
    context = load_revision_qa_context(connection, revision_id)
    return {
        "bindings": {
            name: {
                "value": binding.value,
                "source_kind": binding.source_kind,
                "source_ref": binding.source_ref,
            }
            for name, binding in context.bindings.items()
        },
        "policy": {
            "intent": context.policy.intent,
            "step": context.policy.step,
            "ask_type": context.policy.ask_type,
            "minimum_words": context.policy.minimum_words,
            "maximum_words": context.policy.maximum_words,
            "minimum_confidence": context.policy.minimum_confidence,
            "prior_evidence_ids": sorted(context.policy.prior_evidence_ids),
        },
    }


def _source_context(
    connection: sqlite3.Connection, item: sqlite3.Row, revision: sqlite3.Row,
    now: datetime,
) -> dict[str, object]:
    sender = _query(
        connection,
        """SELECT sender.* FROM campaign
             JOIN sender_profile AS sender
               ON sender.sender_profile_id=campaign.sender_profile_id
            WHERE campaign.campaign_id=?""",
        (item["campaign_id"],),
    ).fetchone()
    brief = _query(
        connection,
        "SELECT brief_text,fit_text,compiler_version,policy_hash FROM campaign_brief WHERE campaign_id=?",
        (item["campaign_id"],),
    ).fetchone()
    intake = _query(
        connection,
        """SELECT intake.original_specification,intake.outreach_goal,intake.as_of_date,
                  intake.funding_stage_min,intake.funding_stage_max,intake.funding_window_years,
                  intake.funding_stage_interpretation,intake.geography_mode,intake.geography_json,
                  intake.sector_mode,intake.sector_json,intake.role_families_json
             FROM prospecting_pipeline_run AS run
             JOIN prospecting_pipeline_intake AS intake ON intake.intake_id=run.intake_id
            WHERE run.run_id=?""",
        (item["run_id"],),
    ).fetchone()
    if sender is None or intake is None:
        raise PipelineStageError("pipeline_context_stale")
    proof = _model_identity_proof(
        connection, revision, _now(now),
    )
    return {
        "revision_hash": revision["hash"],
        "evidence_manifest_hash": item["evidence_manifest_hash"],
        "qa_context": _qa_context_payload(connection, str(revision["revision_id"])),
        "sender_profile": dict(sender),
        "campaign_brief": None if brief is None else dict(brief),
        "intake": dict(intake),
        "current_role_proof": None if proof is None else {
            "campaign_id": proof.campaign_id,
            "person_id": proof.person_id,
            "company_id": proof.company_id,
            "employment_id": proof.employment_id,
            "candidate_observation_id": proof.candidate_observation_id,
            "snapshot_id": proof.snapshot_id,
            "source_url": proof.source_url,
            "excerpt": proof.excerpt,
            "retrieved_at": proof.retrieved_at,
            "expires_at": proof.expires_at,
        },
    }


def _source_context_hash(
    connection: sqlite3.Connection, item: sqlite3.Row, revision: sqlite3.Row,
    now: datetime,
) -> str:
    return _digest(_source_context(connection, item, revision, now))


def current_role_source_binding(
    connection: sqlite3.Connection,
    campaign_id: str,
    person_id: str,
    now: datetime,
) -> tuple[sqlite3.Row, sqlite3.Row]:
    """Resolve the same current identity facts used by ReviewService and bind P13."""
    previous_row_factory = connection.row_factory
    connection.row_factory = sqlite3.Row
    try:
        try:
            binding = attested_current_role_source(
                connection, campaign_id, person_id,
            )
        except ValueError:
            raise PipelineStageError("identity_source_review_missing")
        snapshot = connection.execute(
            "SELECT * FROM source_snapshot WHERE snapshot_id=?", (binding.snapshot_id,),
        ).fetchone()
        if (
            snapshot is None
            or _timestamp(snapshot["expires_at"], "identity_source_review_missing") < _now(now)
        ):
            raise PipelineStageError("identity_source_review_missing")
        if snapshot["allowlist_version"] == "operator-local-v1":
            try:
                proof = current_role_source_proof(
                    connection, campaign_id, person_id, _now(now),
                )
            except ValueError:
                raise PipelineStageError("identity_source_review_missing") from None
            if not proof.attested or proof.snapshot_id != str(snapshot["snapshot_id"]):
                raise PipelineStageError("identity_source_review_missing")
        return snapshot, snapshot
    except PipelineStageError:
        raise
    except (sqlite3.Error, KeyError, IndexError, TypeError, ValueError):
        raise PipelineStageError("identity_source_review_missing") from None
    finally:
        connection.row_factory = previous_row_factory


def _identity_current(
    connection: sqlite3.Connection, revision: sqlite3.Row, now: datetime,
) -> bool:
    try:
        current_role_source_binding(
            connection, str(revision["campaign_id"]), str(revision["person_id"]), now,
        )
    except PipelineStageError:
        return False
    return True


def _model_identity_proof(
    connection: sqlite3.Connection, revision: sqlite3.Row, now: datetime,
) -> CurrentRoleProof | None:
    try:
        return current_role_source_proof(
            connection, str(revision["campaign_id"]), str(revision["person_id"]), now,
        )
    except ValueError:
        if _identity_current(connection, revision, now):
            return None
        raise PipelineStageError("identity_source_proof_missing") from None


def _assert_item_context_current(
    connection: sqlite3.Connection, item: sqlite3.Row, now: datetime,
) -> sqlite3.Row:
    revision = _revision(connection, str(item["base_revision_id"]))
    if (
        revision["campaign_id"] != item["campaign_id"]
        or revision["person_id"] != item["person_id"]
        or revision["step"] != item["step"]
        or revision["hash"] != item["base_revision_hash"]
        or not _current_revision(connection, revision)
    ):
        raise PipelineStageError("revision_not_current")
    policy = _query(
        connection, "SELECT policy_hash FROM campaign WHERE campaign_id=?",
        (item["campaign_id"],),
    ).fetchone()
    intake = _query(
        connection,
        """SELECT intake_hash,campaign_policy_hash FROM prospecting_pipeline_intake
            WHERE campaign_id=? ORDER BY intake_revision DESC,intake_id DESC LIMIT 1""",
        (item["campaign_id"],),
    ).fetchone()
    if (
        policy is None or intake is None
        or policy["policy_hash"] != item["campaign_policy_hash"]
        or intake["intake_hash"] != item["intake_hash"]
        or intake["campaign_policy_hash"] != item["campaign_policy_hash"]
    ):
        raise PipelineStageError("pipeline_context_stale")
    checked_at = _now(now)
    rows = _evidence_rows(connection, revision)
    if (
        evidence_manifest_hash(connection, revision) != item["evidence_manifest_hash"]
        or any(
            not bool(row["allowed_for_copy"])
            or _timestamp(row["expires_at"], "revision_evidence_invalid") < checked_at
            for row in rows
        )
    ):
        raise PipelineStageError("revision_evidence_invalid")
    _model_identity_proof(connection, revision, checked_at)
    context_hash = _source_context_hash(connection, item, revision, checked_at)
    if item["request_hash"] != _digest(
        "start", item["campaign_id"], item["base_revision_id"], context_hash,
    ):
        raise PipelineStageError("pipeline_context_stale")
    artifact_rows = _query(
        connection,
        "SELECT payload_json FROM prospecting_stage_artifact WHERE item_id=?",
        (item["item_id"],),
    ).fetchall()
    for artifact in artifact_rows:
        try:
            stored_context_hash = json.loads(str(artifact["payload_json"]))[
                "approved_context_hash"
            ]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            raise PipelineStageError("pipeline_context_stale") from None
        if stored_context_hash != context_hash:
            raise PipelineStageError("pipeline_context_stale")
    return revision


def _candidate_value_and_qa(
    connection: sqlite3.Connection,
    item: sqlite3.Row,
    humanizer: sqlite3.Row,
    bindings: Mapping[str, SlotBinding],
    now: datetime,
) -> tuple[RevisionInput, QaResult]:
    try:
        human_payload = json.loads(str(humanizer["payload_json"]))
        candidate = human_payload["candidate"]
        if type(candidate) is not dict:
            raise ValueError
        parent_context = load_revision_qa_context(
            connection, str(item["base_revision_id"]),
        )
        evidence = tuple(
            EvidenceRecord(
                str(row["evidence_id"]), str(row["person_id"]), str(row["claim"]),
                str(row["url"]), None if row["observed_at"] is None else str(row["observed_at"]),
                str(row["retrieved_at"]), str(row["excerpt"]), float(row["confidence"]),
                str(row["expires_at"]), bool(row["allowed_for_copy"]),
            )
            for row in _evidence_rows(connection, _revision(connection, str(item["base_revision_id"])))
        )
        qa = validate_revision(
            str(human_payload["final_subject"]), str(human_payload["final_body"]),
            str(candidate["ask"]), bindings, evidence, parent_context.policy,
            str(candidate["person_id"]), str(candidate["campaign_id"]), _now(now),
        )
        value = RevisionInput(
            str(candidate["person_id"]), str(candidate["campaign_id"]), int(candidate["step"]),
            str(human_payload["final_subject"]), str(human_payload["final_body"]),
            str(candidate["angle"]), str(candidate["generation_mode"]),
            None if candidate["purpose"] is None else str(candidate["purpose"]),
            str(candidate["ask"]), tuple(json.loads(str(candidate["evidence_ids"]))),
            tuple(json.loads(str(candidate["recipient_relevance_points"]))),
            tuple(json.loads(str(candidate["sender_proof_points"]))),
            str(candidate["template_id"]), int(candidate["template_version"]),
            str(candidate["prompt_version"]), str(candidate["model_version"]), qa,
        )
    except PipelineStageError:
        raise
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, UnicodeError):
        raise PipelineStageError("candidate_context_invalid") from None
    if revision_hash(value) != humanizer["proposed_revision_hash"]:
        raise PipelineStageError("proposed_revision_hash_mismatch")
    return value, qa


def _require_revision_review_chain(
    connection: sqlite3.Connection,
    campaign_id: str,
    revision_hash_value: str,
    now: datetime | str,
) -> sqlite3.Row:
    """Fail closed unless the exact current revision has the complete accepted chain."""
    if isinstance(now, str):
        try:
            checked_at = datetime.fromisoformat(now.replace("Z", "+00:00"))
        except ValueError:
            raise PipelineStageError("invalid_time") from None
    else:
        checked_at = now
    checked_at = _now(checked_at)
    revision_hash_value = _sha(revision_hash_value, "invalid_revision_hash")
    revision = _query(connection,
        "SELECT * FROM revision WHERE campaign_id=? AND hash=?", (campaign_id, revision_hash_value)
    ).fetchone()
    if revision is None or not _current_revision(connection, revision):
        raise PipelineStageError("revision_not_current")
    _assert_no_unresolved_candidate(
        connection, str(revision["campaign_id"]), str(revision["revision_id"]),
    )
    try:
        load_revision_qa_context(connection, str(revision["revision_id"]))
    except Exception:
        raise PipelineStageError("revision_qa_context_invalid") from None
    rows = _evidence_rows(connection, revision)
    if any(
        not bool(row["allowed_for_copy"])
        or _timestamp(row["expires_at"], "revision_evidence_invalid") < checked_at
        for row in rows
    ):
        raise PipelineStageError("revision_evidence_invalid")
    if not _identity_current(connection, revision, checked_at):
        raise PipelineStageError("identity_source_review_missing")
    manifest = evidence_manifest_hash(connection, revision)
    decision = _query(connection,
        """SELECT d.*,s.item_id,s.proposed_revision_hash,s.subject_body_hash,i.repair_cycle,i.state
             FROM prospecting_suggestion_decision d
             JOIN prospecting_pipeline_suggestion s ON s.suggestion_id=d.suggestion_id
             JOIN prospecting_pipeline_item i ON i.item_id=s.item_id
            WHERE d.decision='accepted' AND d.accepted_revision_id=? AND d.accepted_revision_hash=?
            ORDER BY d.created_at DESC,d.decision_id DESC LIMIT 1""",
        (revision["revision_id"], revision_hash_value),
    ).fetchone()
    if decision is None or decision["state"] != "accepted" or decision["repair_cycle"] > 2:
        raise PipelineStageError("editorial_receipts_missing")
    policy = _query(connection,
        "SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    latest_intake = _query(connection,
        "SELECT intake_hash,campaign_policy_hash FROM prospecting_pipeline_intake WHERE campaign_id=? ORDER BY intake_revision DESC,intake_id DESC LIMIT 1",
        (campaign_id,),
    ).fetchone()
    item_binding = _query(connection,
        "SELECT * FROM prospecting_pipeline_item WHERE item_id=?",
        (decision["item_id"],),
    ).fetchone()
    if (
        policy is None or latest_intake is None or item_binding is None
        or item_binding["campaign_policy_hash"] != policy[0]
        or item_binding["intake_hash"] != latest_intake["intake_hash"]
        or item_binding["campaign_policy_hash"] != latest_intake["campaign_policy_hash"]
    ):
        raise PipelineStageError("pipeline_context_stale")
    artifacts = _query(connection,
        "SELECT * FROM prospecting_stage_artifact WHERE item_id=? AND cycle=? ORDER BY stage",
        (decision["item_id"], decision["repair_cycle"]),
    ).fetchall()
    by_stage = {str(row["stage"]): row for row in artifacts}
    required = {
        "humanizer": {"proposed", "no_change"},
        "post_humanization_factcheck": {"pass"},
        "independent_critic": {"pass"},
    }
    if set(by_stage) != set(required):
        raise PipelineStageError("editorial_receipts_missing")
    base_revision = _revision(connection, str(item_binding["base_revision_id"]))
    current_context_hash = _source_context_hash(
        connection, item_binding, base_revision, checked_at,
    )
    for stage, decisions in required.items():
        artifact = by_stage[stage]
        try:
            artifact_context_hash = json.loads(str(artifact["payload_json"]))[
                "approved_context_hash"
            ]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            raise PipelineStageError("editorial_receipts_stale") from None
        if (
            artifact["decision"] not in decisions
            or artifact["proposed_revision_hash"] != revision_hash_value
            or artifact["evidence_manifest_hash"] != manifest
            or artifact_context_hash != current_context_hash
        ):
            raise PipelineStageError("editorial_receipts_stale")
    producer_ids = {by_stage[stage]["producer_job_id"] for stage in required}
    producer_identities = {by_stage[stage]["producer_identity"] for stage in required}
    if len(producer_ids) != 3 or len(producer_identities) != 3:
        raise PipelineStageError("critic_not_independent")
    return revision


def require_revision_review_chain(
    connection: sqlite3.Connection,
    campaign_id: str,
    revision_hash_value: str,
    now: datetime | str,
) -> sqlite3.Row:
    """Validate the accepted automation chain before a human ready decision."""
    previous_row_factory = connection.row_factory
    connection.row_factory = sqlite3.Row
    try:
        return _require_revision_review_chain(connection, campaign_id, revision_hash_value, now)
    except PipelineStageError:
        raise
    except (sqlite3.Error, KeyError, IndexError, TypeError, ValueError, UnicodeError):
        raise PipelineStageError("store_state_invalid") from None
    finally:
        connection.row_factory = previous_row_factory


def require_revision_ready(
    connection: sqlite3.Connection,
    campaign_id: str,
    revision_hash_value: str,
    now: datetime | str,
) -> sqlite3.Row:
    """Require both the accepted chain and the latest exact human ready event."""
    revision = require_revision_review_chain(
        connection, campaign_id, revision_hash_value, now,
    )
    try:
        event = _query(
            connection,
            """SELECT state FROM draft_editorial_event
                WHERE campaign_id=? AND person_id=? AND revision_id=?
                ORDER BY sequence DESC LIMIT 1""",
            (campaign_id, revision["person_id"], revision["revision_id"]),
        ).fetchone()
    except (sqlite3.Error, KeyError, IndexError, TypeError):
        raise PipelineStageError("store_state_invalid") from None
    if event is None or event["state"] != "ready":
        raise PipelineStageError("human_editorial_ready_missing")
    return revision


class PipelineStageService:
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

    def _begin(self) -> None:
        if self.connection.in_transaction:
            raise PipelineStageError("transaction_active")
        self.connection.execute("BEGIN IMMEDIATE")

    def _project(self, row: sqlite3.Row) -> ItemProjection:
        return ItemProjection(row["item_id"], row["campaign_id"], row["person_id"], row["base_revision_id"], row["state"], row["next_stage"], row["repair_cycle"])

    def _lineage_root(self, revision_id: str) -> str:
        current = revision_id
        seen: set[str] = set()
        while current not in seen:
            seen.add(current)
            parents = self.connection.execute(
                """SELECT parent_revision_id FROM review_revision_lineage WHERE child_revision_id=?
                   UNION ALL
                   SELECT parent_revision_id FROM prospecting_agent_revision_lineage WHERE child_revision_id=?""",
                (current,current),
            ).fetchall()
            if not parents:
                return current
            if len(parents) != 1:
                raise PipelineStageError("revision_lineage_ambiguous")
            current = str(parents[0][0])
        raise PipelineStageError("revision_lineage_cycle")

    def start_from_saved_revision(self, campaign_id: str, revision_id: str, request_id: str) -> ItemProjection:
        campaign_id = _text(campaign_id, "invalid_campaign_id", maximum=128)
        revision_id = _text(revision_id, "invalid_revision_id", maximum=128)
        request_id = _text(request_id, "invalid_request_id", maximum=128)
        self._begin()
        try:
            replay = self.connection.execute("SELECT * FROM prospecting_pipeline_item WHERE request_id=?", (request_id,)).fetchone()
            if replay is not None:
                if replay["campaign_id"] != campaign_id or replay["base_revision_id"] != revision_id:
                    raise PipelineStageError("request_conflict")
                _assert_item_context_current(self.connection, replay, _now(self.now()))
                self.connection.commit()
                return self._project(replay)
            revision = _revision(self.connection, revision_id)
            if revision["campaign_id"] != campaign_id or not _current_revision(self.connection, revision):
                raise PipelineStageError("revision_not_current")
            load_revision_qa_context(self.connection, revision_id)
            checked_at = _now(self.now())
            if any(
                not bool(row["allowed_for_copy"])
                or _timestamp(row["expires_at"], "revision_evidence_invalid") < checked_at
                for row in _evidence_rows(self.connection, revision)
            ):
                raise PipelineStageError("revision_evidence_invalid")
            _model_identity_proof(self.connection, revision, checked_at)
            run = self.connection.execute(
                """SELECT run.run_id,run.intake_hash,run.campaign_policy_hash
                     FROM prospecting_pipeline_run AS run
                     JOIN prospecting_pipeline_intake AS intake ON intake.intake_id=run.intake_id
                    WHERE run.campaign_id=?
                    ORDER BY intake.intake_revision DESC,intake.intake_id DESC LIMIT 1""",
                (campaign_id,),
            ).fetchone()
            if run is None:
                raise PipelineStageError("pipeline_run_missing")
            existing = self.connection.execute(
                "SELECT * FROM prospecting_pipeline_item WHERE run_id=? AND base_revision_id=?",
                (run["run_id"], revision_id),
            ).fetchone()
            if existing is not None:
                raise PipelineStageError("pipeline_item_exists")
            item_id = "item-" + uuid4().hex
            timestamp = _now(self.now()).isoformat()
            manifest = evidence_manifest_hash(self.connection, revision)
            lineage_root = self._lineage_root(revision_id)
            exhausted = self.connection.execute(
                """SELECT 1 FROM prospecting_pipeline_item
                    WHERE campaign_id=? AND person_id=? AND step=?
                      AND lineage_root_revision_id=? AND state='parked'
                      AND repair_cycle>=max_repair_cycles
                    LIMIT 1""",
                (campaign_id,revision["person_id"],revision["step"],lineage_root),
            ).fetchone()
            if exhausted is not None:
                raise PipelineStageError("repair_budget_exhausted")
            pending_item = {
                "item_id": item_id, "request_hash": "", "run_id": run["run_id"],
                "campaign_id": campaign_id, "intake_hash": run["intake_hash"],
                "campaign_policy_hash": run["campaign_policy_hash"],
                "person_id": revision["person_id"], "step": revision["step"],
                "base_revision_id": revision_id, "base_revision_hash": revision["hash"],
                "evidence_manifest_hash": manifest,
            }
            request_hash = _digest(
                "start", campaign_id, revision_id,
                _source_context_hash(self.connection, pending_item, revision, checked_at),
            )
            used = self.connection.execute(
                "SELECT COALESCE(MAX(repair_cycle),0) FROM prospecting_pipeline_item WHERE campaign_id=? AND person_id=? AND step=? AND lineage_root_revision_id=?",
                (campaign_id,revision["person_id"],revision["step"],lineage_root),
            ).fetchone()[0]
            self.connection.execute(
                """INSERT INTO prospecting_pipeline_item(
                       item_id,request_id,request_hash,run_id,campaign_id,intake_hash,
                       campaign_policy_hash,person_id,step,base_revision_id,base_revision_hash,
                       lineage_root_revision_id,evidence_manifest_hash,state,next_stage,
                       repair_cycle,max_repair_cycles,claim_epoch,created_at,updated_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (item_id,request_id,request_hash,run[0],campaign_id,run[1],run[2],revision["person_id"],revision["step"],revision_id,revision["hash"],lineage_root,manifest,"awaiting_humanizer_adapter","humanizer",int(used),2,0,timestamp,timestamp),
            )
            self.connection.commit()
            return self._project(self.connection.execute("SELECT * FROM prospecting_pipeline_item WHERE item_id=?", (item_id,)).fetchone())
        except BaseException:
            self.connection.rollback()
            raise

    def get_item(self, item_id: str) -> ItemProjection:
        row = self.connection.execute("SELECT * FROM prospecting_pipeline_item WHERE item_id=?", (item_id,)).fetchone()
        if row is None:
            raise PipelineStageError("pipeline_item_missing")
        return self._project(row)

    def get_review_projection(self, item_id: str) -> ReviewProjection:
        item_id = _text(item_id, "invalid_item_id", maximum=128)
        item = self.connection.execute(
            "SELECT * FROM prospecting_pipeline_item WHERE item_id=?", (item_id,),
        ).fetchone()
        if item is None:
            raise PipelineStageError("pipeline_item_missing")
        revision = _revision(self.connection, str(item["base_revision_id"]))
        proof = _model_identity_proof(self.connection, revision, _now(self.now()))
        suggestion = self.connection.execute(
            """SELECT * FROM prospecting_pipeline_suggestion
                WHERE item_id=? ORDER BY cycle DESC,created_at DESC LIMIT 1""",
            (item_id,),
        ).fetchone()
        decision = None
        if suggestion is not None:
            decision_row = self.connection.execute(
                "SELECT decision FROM prospecting_suggestion_decision WHERE suggestion_id=?",
                (suggestion["suggestion_id"],),
            ).fetchone()
            decision = None if decision_row is None else str(decision_row["decision"])
        return ReviewProjection(
            self._project(item), proof,
            None if suggestion is None else str(suggestion["suggestion_id"]),
            None if suggestion is None else str(suggestion["subject"]),
            None if suggestion is None else str(suggestion["body"]),
            None if suggestion is None else str(suggestion["proposed_revision_hash"]),
            decision,
        )

    def get_latest_review_projection(
        self, campaign_id: str, revision_id: str,
    ) -> ReviewProjection | None:
        campaign_id = _text(campaign_id, "invalid_campaign_id", maximum=128)
        revision_id = _text(revision_id, "invalid_revision_id", maximum=128)
        item = self.connection.execute(
            """SELECT item.item_id FROM prospecting_pipeline_item AS item
                LEFT JOIN prospecting_pipeline_suggestion AS suggestion
                  ON suggestion.item_id=item.item_id
                LEFT JOIN prospecting_suggestion_decision AS decision
                  ON decision.suggestion_id=suggestion.suggestion_id
                 AND decision.decision='accepted'
                WHERE item.campaign_id=? AND (
                  item.base_revision_id=? OR decision.accepted_revision_id=?
                )
                ORDER BY item.created_at DESC,item.rowid DESC LIMIT 1""",
            (campaign_id, revision_id, revision_id),
        ).fetchone()
        return None if item is None else self.get_review_projection(str(item["item_id"]))

    def _stage_input(self, item: sqlite3.Row, stage: str) -> bytes:
        revision = _revision(self.connection, item["base_revision_id"])
        evidence = [dict(row) for row in _evidence_rows(self.connection, revision)]
        source_context = _source_context(
            self.connection, item, revision, _now(self.now()),
        )
        value: dict[str, object] = {
            "item_id": item["item_id"], "stage": stage, "cycle": item["repair_cycle"],
            "revision": dict(revision), "evidence": evidence,
            "evidence_manifest_hash": item["evidence_manifest_hash"],
            "approved_context": source_context,
            "approved_context_hash": _digest(source_context),
        }
        if stage == "post_humanization_factcheck":
            human = self.connection.execute(
                "SELECT output_hash,payload_json,proposed_revision_hash FROM prospecting_stage_artifact WHERE item_id=? AND cycle=? AND stage='humanizer'",
                (item["item_id"],item["repair_cycle"]),
            ).fetchone()
            value["candidate"] = None if human is None else {
                "artifact_hash":human["output_hash"],"proposed_revision_hash":human["proposed_revision_hash"],
                "final_subject":json.loads(human["payload_json"])["final_subject"],
                "final_body":json.loads(human["payload_json"])["final_body"],
            }
        elif stage == "independent_critic":
            human = self.connection.execute(
                "SELECT payload_json,proposed_revision_hash FROM prospecting_stage_artifact WHERE item_id=? AND cycle=? AND stage='humanizer'",
                (item["item_id"],item["repair_cycle"]),
            ).fetchone()
            fact = self.connection.execute(
                "SELECT output_hash,payload_json FROM prospecting_stage_artifact WHERE item_id=? AND cycle=? AND stage='post_humanization_factcheck'",
                (item["item_id"],item["repair_cycle"]),
            ).fetchone()
            value["candidate"] = None if human is None else {
                "proposed_revision_hash":human["proposed_revision_hash"],
                "final_subject":json.loads(human["payload_json"])["final_subject"],
                "final_body":json.loads(human["payload_json"])["final_body"],
            }
            value["factcheck"] = None if fact is None else {"artifact_hash":fact["output_hash"],"payload":json.loads(fact["payload_json"])}
        if item["repair_cycle"]:
            repair = self.connection.execute(
                "SELECT stage,output_hash,payload_json FROM prospecting_stage_artifact WHERE item_id=? AND cycle=? AND decision IN ('repair','fail') ORDER BY created_at DESC LIMIT 1",
                (item["item_id"], item["repair_cycle"] - 1),
            ).fetchone()
            value["repair_from"] = None if repair is None else {"stage": repair[0], "output_hash": repair[1], "payload": json.loads(repair[2])}
        return _bounded_stage_input(value)

    def run_next(self, item_id: str, request_id: str) -> ItemProjection:
        item_id = _text(item_id, "invalid_item_id", maximum=128)
        request_id = _text(request_id, "invalid_request_id", maximum=128)
        prior = self.connection.execute(
            "SELECT * FROM prospecting_stage_attempt WHERE request_id=?", (request_id,)
        ).fetchone()
        if prior is not None:
            if prior["item_id"] != item_id:
                raise PipelineStageError("request_conflict")
            if prior["state"] == "succeeded":
                current_item = self.connection.execute(
                    "SELECT * FROM prospecting_pipeline_item WHERE item_id=?", (item_id,)
                ).fetchone()
                if current_item is None:
                    raise PipelineStageError("pipeline_item_missing")
                _assert_item_context_current(
                    self.connection, current_item, _now(self.now()),
                )
                return self._project(current_item)
            if prior["state"] == "claimed":
                if _now(self.now()) > _timestamp(prior["lease_until"], "invalid_lease"):
                    self.recover_expired(item_id)
                    raise PipelineStageError("lease_expired")
                raise PipelineStageError("stage_in_progress")
            raise PipelineStageError(str(prior["failure_code"] or "attempt_failed"))
        item = self.connection.execute("SELECT * FROM prospecting_pipeline_item WHERE item_id=?", (item_id,)).fetchone()
        if item is None:
            raise PipelineStageError("pipeline_item_missing")
        stage = item["next_stage"]
        if stage not in STAGES or item["state"] != WAITING_FOR_STAGE[stage]:
            raise PipelineStageError("stage_not_runnable")
        _assert_item_context_current(self.connection, item, _now(self.now()))
        adapter = self.adapters.get(stage)
        if adapter is None:
            raise PipelineStageError("stage_adapter_unavailable")
        binding = _validate_binding(adapter.binding)
        prior_identities = {
            str(row[0]) for row in self.connection.execute(
                """SELECT producer_identity FROM prospecting_stage_artifact
                    WHERE item_id=? AND cycle=?""",
                (item_id, item["repair_cycle"]),
            ).fetchall()
        }
        if binding.executor_identity in prior_identities:
            raise PipelineStageError("critic_not_independent")
        input_json = self._stage_input(item, stage)
        input_hash = hashlib.sha256(input_json).hexdigest()
        token = secrets.token_urlsafe(32)
        attempt_id, worker_job_id = "attempt-" + uuid4().hex, "worker-" + uuid4().hex
        epoch = int(item["claim_epoch"]) + 1
        timestamp = _now(self.now())
        lease = timestamp + timedelta(minutes=5)
        request_hash = _digest("run", item_id, stage, input_hash, epoch)
        self._begin()
        try:
            current = self.connection.execute("SELECT * FROM prospecting_pipeline_item WHERE item_id=?", (item_id,)).fetchone()
            if current["claim_epoch"] != item["claim_epoch"] or current["state"] != item["state"]:
                raise PipelineStageError("stage_conflict")
            self.connection.execute(
                """INSERT INTO prospecting_stage_attempt(
                       attempt_id,request_id,request_hash,item_id,stage,cycle,claim_epoch,
                       input_hash,worker_role,worker_identity,worker_job_id,attempt_token_hash,
                       runtime_id,runtime_version,runtime_hash,schema_hash,skill_name,skill_version,
                       skill_content_hash,skill_manifest_hash,state,lease_until,failure_code,
                       created_at,finished_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (attempt_id,request_id,request_hash,item_id,stage,item["repair_cycle"],epoch,input_hash,ROLE_FOR_STAGE[stage],binding.executor_identity,worker_job_id,hashlib.sha256(token.encode()).hexdigest(),binding.runtime_id,binding.runtime_version,binding.runtime_hash,binding.schema_hash,binding.skill_name,binding.skill_version,binding.skill_content_hash,binding.skill_manifest_hash,"claimed",lease.isoformat(),None,timestamp.isoformat(),None),
            )
            self.connection.execute("UPDATE prospecting_pipeline_item SET state=?,claim_epoch=?,updated_at=? WHERE item_id=?", (RUNNING_FOR_STAGE[stage],epoch,timestamp.isoformat(),item_id))
            self.connection.commit()
        except BaseException:
            self.connection.rollback()
            raise
        job = StageJob(item_id,attempt_id,worker_job_id,stage,item["repair_cycle"],input_hash,input_json)
        try:
            result = adapter.execute(job)
            if not isinstance(result, StageResult):
                raise PipelineStageError("adapter_result_invalid")
            self._submit(attempt_id, token, result)
        except BaseException as error:
            self._fail_attempt(
                attempt_id,
                error.code if isinstance(error, PipelineStageError) else "adapter_failed",
            )
            if isinstance(error, PipelineStageError):
                raise
            raise PipelineStageError("adapter_failed") from None
        return self.get_item(item_id)

    def recover_expired(self, item_id: str) -> ItemProjection:
        self._begin()
        try:
            item = self.connection.execute(
                "SELECT * FROM prospecting_pipeline_item WHERE item_id=?", (item_id,)
            ).fetchone()
            if item is None:
                raise PipelineStageError("pipeline_item_missing")
            attempt = self.connection.execute(
                "SELECT * FROM prospecting_stage_attempt WHERE item_id=? AND claim_epoch=? AND state='claimed'",
                (item_id,item["claim_epoch"]),
            ).fetchone()
            if attempt is None:
                raise PipelineStageError("claimed_attempt_missing")
            current_time = _now(self.now())
            timestamp = current_time.isoformat()
            if current_time <= _timestamp(attempt["lease_until"], "invalid_lease"):
                raise PipelineStageError("lease_active")
            self.connection.execute(
                "UPDATE prospecting_stage_attempt SET state='expired',failure_code='lease_expired',finished_at=? WHERE attempt_id=? AND state='claimed'",
                (timestamp,attempt["attempt_id"]),
            )
            self.connection.execute(
                "UPDATE prospecting_pipeline_item SET state=?,updated_at=? WHERE item_id=? AND claim_epoch=?",
                (WAITING_FOR_STAGE[attempt["stage"]],timestamp,item_id,attempt["claim_epoch"]),
            )
            self.connection.commit()
            return self.get_item(item_id)
        except BaseException:
            self.connection.rollback()
            raise

    def _attempt_for_submit(self, attempt_id: str, token: str) -> sqlite3.Row:
        attempt = self.connection.execute("SELECT * FROM prospecting_stage_attempt WHERE attempt_id=?", (attempt_id,)).fetchone()
        if attempt is None or attempt["state"] != "claimed" or not secrets.compare_digest(attempt["attempt_token_hash"], hashlib.sha256(token.encode()).hexdigest()):
            raise PipelineStageError("lease_lost")
        if _now(self.now()) > _timestamp(attempt["lease_until"], "invalid_lease"):
            raise PipelineStageError("lease_expired")
        return attempt

    def _humanizer_payload(self, item: sqlite3.Row, attempt: sqlite3.Row, payload: Mapping[str, object]) -> tuple[dict[str, object], str, str, str, str]:
        if set(payload) != {"draft","audit","final_subject","final_body"}:
            raise PipelineStageError("humanizer_output_invalid")
        draft = _text(payload["draft"], "humanizer_output_invalid")
        audit = _text(payload["audit"], "humanizer_output_invalid")
        subject = _text(payload["final_subject"], "humanizer_output_invalid", maximum=998)
        body = _text(payload["final_body"], "humanizer_output_invalid")
        parent = _revision(self.connection, item["base_revision_id"])
        candidate = {
            key: parent[key] for key in (
                "person_id","campaign_id","step","angle","generation_mode","purpose","ask",
                "evidence_ids","recipient_relevance_points","sender_proof_points","template_id","template_version",
            )
        }
        unchanged = subject == parent["subject"] and body == parent["body"]
        candidate.update({
            "subject": subject,"body": body,
            "prompt_version": parent["prompt_version"] if unchanged else f"{attempt['skill_name']}@{attempt['skill_version']}",
            "model_version": parent["model_version"] if unchanged else f"unverified-model-via:{attempt['runtime_id']}@{attempt['runtime_version']}",
        })
        value = RevisionInput(
            candidate["person_id"],candidate["campaign_id"],candidate["step"],subject,body,candidate["angle"],candidate["generation_mode"],candidate["purpose"],candidate["ask"],
            tuple(json.loads(candidate["evidence_ids"])),tuple(json.loads(candidate["recipient_relevance_points"])),tuple(json.loads(candidate["sender_proof_points"])),candidate["template_id"],candidate["template_version"],candidate["prompt_version"],candidate["model_version"],QaResult(True,100,{},(),""),
        )
        proposed = revision_hash(value)
        normalized = {
            "draft": draft, "audit": audit, "final_subject": subject,
            "final_body": body, "candidate": candidate,
            "approved_context_hash": _source_context_hash(
                self.connection, item, parent, _now(self.now()),
            ),
        }
        decision = "no_change" if unchanged else "proposed"
        return normalized,decision,_digest(subject,body),proposed,_canonical(candidate)

    def _factcheck_payload(self, item: sqlite3.Row, payload: Mapping[str, object]) -> tuple[dict[str, object], str, str, str, str]:
        if set(payload) != {"decision","bindings","uncertainty","shortfalls"} or payload["decision"] not in {"pass","fail"}:
            raise PipelineStageError("factcheck_output_invalid")
        humanizer = self.connection.execute("SELECT * FROM prospecting_stage_artifact WHERE item_id=? AND cycle=? AND stage='humanizer'", (item["item_id"],item["repair_cycle"])).fetchone()
        if humanizer is None:
            raise PipelineStageError("stage_input_missing")
        bindings = payload["bindings"]
        if not isinstance(bindings,list):
            raise PipelineStageError("factcheck_output_invalid")
        decoded: dict[str, dict[str,str]] = {}
        for row in bindings:
            if not isinstance(row,dict) or set(row) != {"slot","value","source_kind","source_ref"}:
                raise PipelineStageError("factcheck_output_invalid")
            slot = _text(row["slot"],"factcheck_output_invalid",maximum=64)
            if slot in decoded:
                raise PipelineStageError("factcheck_output_invalid")
            decoded[slot] = {key:_text(row[key],"factcheck_output_invalid",maximum=MAX_TEXT if key=="value" else 256) for key in ("value","source_kind","source_ref")}
            if decoded[slot]["source_kind"] not in {"evidence","sender","policy"}:
                raise PipelineStageError("factcheck_output_invalid")
        if payload["decision"] == "pass" and "ask" not in decoded:
            raise PipelineStageError("factcheck_output_invalid")
        try:
            human_payload = json.loads(str(humanizer["payload_json"]))
            rendered = (
                str(human_payload["final_subject"])
                + "\n"
                + str(human_payload["final_body"])
            )
            parent_context = load_revision_qa_context(
                self.connection, str(item["base_revision_id"]),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError, UnicodeError):
            raise PipelineStageError("candidate_context_invalid") from None
        # A reviewer cannot make an already-known claim disappear from P11 merely
        # by omitting its binding. Preserve approved parent bindings whose exact
        # values survive in the proposed copy, then run the ordinary P11 checks.
        binding_context_conflict = False
        for name, binding in parent_context.bindings.items():
            if binding.value not in rendered:
                continue
            approved_binding = {
                "value": binding.value,
                "source_kind": binding.source_kind,
                "source_ref": binding.source_ref,
            }
            if name in decoded and decoded[name] != approved_binding:
                binding_context_conflict = True
            decoded[name] = approved_binding
        recipient_values: set[str] = set()
        recipient_spans: list[tuple[int, int]] = []
        recipient_binding_alias = False
        for name, row in decoded.items():
            if name not in RECIPIENT_SLOTS or row["source_kind"] != "evidence":
                continue
            normalized_value = " ".join(row["value"].casefold().split())
            if normalized_value in recipient_values:
                recipient_binding_alias = True
            recipient_values.add(normalized_value)
            start = rendered.find(row["value"])
            if start >= 0:
                span = (start, start + len(row["value"]))
                if any(
                    max(span[0], prior[0]) < min(span[1], prior[1])
                    for prior in recipient_spans
                ):
                    recipient_binding_alias = True
                recipient_spans.append(span)
        typed_bindings = {
            name: SlotBinding(row["value"], row["source_kind"], row["source_ref"])
            for name, row in decoded.items()
        }
        parent = _revision(self.connection, item["base_revision_id"])
        approved = _source_context(
            self.connection, item, parent, _now(self.now()),
        )
        authoritative: dict[tuple[str, str], str] = {}
        for row in approved["qa_context"]["bindings"].values():
            if row["source_kind"] in {"sender", "policy"}:
                authoritative[(str(row["source_kind"]), str(row["source_ref"]))] = str(row["value"])
        for name, value in approved["sender_profile"].items():
            if value is not None:
                authoritative[("sender", f"sender_profile.{name}")] = str(value)
        source_mismatch = any(
            row["source_kind"] in {"sender", "policy"}
            and authoritative.get((row["source_kind"], row["source_ref"])) != row["value"]
            for row in decoded.values()
        )
        _value, qa = _candidate_value_and_qa(
            self.connection, item, humanizer, typed_bindings, _now(self.now()),
        )
        extra_failures = set()
        if source_mismatch:
            extra_failures.add("binding_source_mismatch")
        if binding_context_conflict:
            extra_failures.add("binding_context_conflict")
        if recipient_binding_alias:
            extra_failures.add("recipient_binding_alias")
        qa_failures = tuple(sorted(set(qa.failure_codes) | extra_failures))
        decision = (
            "pass"
            if payload["decision"] == "pass" and qa.passed and not extra_failures
            else "fail"
        )
        normalized = {
            "decision": decision, "reported_decision": payload["decision"], "bindings": decoded,
            "uncertainty":_string_list(payload["uncertainty"],"factcheck_output_invalid"),
            "shortfalls":_string_list(payload["shortfalls"],"factcheck_output_invalid"),
            "qa_failure_codes": list(qa_failures), "qa_score": qa.qa_score,
            "approved_context_hash": _source_context_hash(
                self.connection, item,
                _revision(self.connection, item["base_revision_id"]),
                _now(self.now()),
            ),
        }
        return normalized,decision,humanizer["subject_body_hash"],humanizer["proposed_revision_hash"],_canonical(decoded)

    def _critic_payload(self, item: sqlite3.Row, payload: Mapping[str, object]) -> tuple[dict[str, object], str, str, str, str]:
        if set(payload) != {"decision","reasons","repair_instructions"} or payload["decision"] not in {"pass","repair"}:
            raise PipelineStageError("critic_output_invalid")
        fact = self.connection.execute("SELECT * FROM prospecting_stage_artifact WHERE item_id=? AND cycle=? AND stage='post_humanization_factcheck'", (item["item_id"],item["repair_cycle"])).fetchone()
        if fact is None or fact["decision"] != "pass":
            raise PipelineStageError("stage_input_missing")
        instructions = payload["repair_instructions"]
        if type(instructions) is not str or "\x00" in instructions:
            raise PipelineStageError("critic_output_invalid")
        try:
            if len(instructions.encode("utf-8")) > 8192:
                raise PipelineStageError("critic_output_invalid")
        except UnicodeError:
            raise PipelineStageError("critic_output_invalid") from None
        normalized = {
            "decision":payload["decision"],
            "reasons":_string_list(payload["reasons"],"critic_output_invalid"),
            "repair_instructions":instructions,
            "approved_context_hash": _source_context_hash(
                self.connection, item,
                _revision(self.connection, item["base_revision_id"]),
                _now(self.now()),
            ),
        }
        return normalized,str(payload["decision"]),fact["subject_body_hash"],fact["proposed_revision_hash"],""

    def _submit(self, attempt_id: str, token: str, result: StageResult) -> None:
        self._begin()
        try:
            attempt = self._attempt_for_submit(attempt_id, token)
            item = self.connection.execute("SELECT * FROM prospecting_pipeline_item WHERE item_id=?", (attempt["item_id"],)).fetchone()
            if item is None or item["claim_epoch"] != attempt["claim_epoch"] or item["state"] != RUNNING_FOR_STAGE[attempt["stage"]] or item["repair_cycle"] != attempt["cycle"]:
                raise PipelineStageError("lease_lost")
            _assert_item_context_current(self.connection, item, _now(self.now()))
            if hashlib.sha256(self._stage_input(item,attempt["stage"])).hexdigest() != attempt["input_hash"]:
                raise PipelineStageError("stage_input_stale")
            payload = _bounded_json_object(result.payload, "adapter_result_invalid")
            if attempt["stage"] == "humanizer":
                normalized,decision,body_hash,proposed,candidate = self._humanizer_payload(item,attempt,payload)
            elif attempt["stage"] == "post_humanization_factcheck":
                normalized,decision,body_hash,proposed,context = self._factcheck_payload(item,payload)
                candidate = ""
            else:
                normalized,decision,body_hash,proposed,_ = self._critic_payload(item,payload)
                candidate = ""
            output = _bounded_stage_output(
                normalized,
                {
                    "humanizer": "humanizer_output_invalid",
                    "post_humanization_factcheck": "factcheck_output_invalid",
                    "independent_critic": "critic_output_invalid",
                }[attempt["stage"]],
            )
            timestamp = _now(self.now()).isoformat()
            self.connection.execute("UPDATE prospecting_stage_attempt SET state='succeeded',finished_at=? WHERE attempt_id=? AND state='claimed'", (timestamp,attempt_id))
            artifact_id = "artifact-" + uuid4().hex
            self.connection.execute(
                """INSERT INTO prospecting_stage_artifact(
                       artifact_id,attempt_id,item_id,stage,cycle,input_hash,output_hash,
                       subject_body_hash,proposed_revision_hash,evidence_manifest_hash,
                       decision,payload_json,producer_role,producer_identity,producer_job_id,
                       runtime_id,runtime_hash,schema_hash,skill_name,skill_version,
                       skill_content_hash,skill_manifest_hash,created_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (artifact_id,attempt_id,item["item_id"],attempt["stage"],item["repair_cycle"],attempt["input_hash"],hashlib.sha256(output.encode()).hexdigest(),body_hash,proposed,item["evidence_manifest_hash"],decision,output,attempt["worker_role"],attempt["worker_identity"],attempt["worker_job_id"],attempt["runtime_id"],attempt["runtime_hash"],attempt["schema_hash"],attempt["skill_name"],attempt["skill_version"],attempt["skill_content_hash"],attempt["skill_manifest_hash"],timestamp),
            )
            if attempt["stage"] == "humanizer":
                next_state,next_stage = "awaiting_post_factcheck_adapter","post_humanization_factcheck"
            elif attempt["stage"] == "post_humanization_factcheck" and decision == "pass":
                human = self.connection.execute("SELECT * FROM prospecting_stage_artifact WHERE item_id=? AND cycle=? AND stage='humanizer'",(item["item_id"],item["repair_cycle"])).fetchone()
                suggestion_id = "suggestion-" + uuid4().hex
                self.connection.execute(
                    """INSERT INTO prospecting_pipeline_suggestion(
                           suggestion_id,item_id,cycle,humanizer_artifact_id,parent_revision_id,
                           parent_revision_hash,subject,body,subject_body_hash,
                           proposed_revision_hash,candidate_payload_json,candidate_context_json,
                           created_at
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (suggestion_id,item["item_id"],item["repair_cycle"],human["artifact_id"],item["base_revision_id"],item["base_revision_hash"],json.loads(human["payload_json"])["final_subject"],json.loads(human["payload_json"])["final_body"],body_hash,proposed,candidate or _canonical(json.loads(human["payload_json"])["candidate"]),context,timestamp),
                )
                next_state,next_stage = "awaiting_critic_adapter","independent_critic"
            elif attempt["stage"] == "independent_critic" and decision == "pass":
                next_state,next_stage = "human_review","human_review"
            else:
                cycle = int(item["repair_cycle"])
                if cycle >= int(item["max_repair_cycles"]):
                    next_state,next_stage = "parked",None
                else:
                    self.connection.execute("UPDATE prospecting_pipeline_item SET repair_cycle=repair_cycle+1 WHERE item_id=?",(item["item_id"],))
                    next_state,next_stage = "awaiting_humanizer_adapter","humanizer"
            self.connection.execute("UPDATE prospecting_pipeline_item SET state=?,next_stage=?,updated_at=? WHERE item_id=?",(next_state,next_stage,timestamp,item["item_id"]))
            self.connection.commit()
        except BaseException:
            self.connection.rollback()
            raise

    def _fail_attempt(self, attempt_id: str, code: str) -> None:
        if self.connection.in_transaction:
            self.connection.rollback()
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            row = self.connection.execute("SELECT * FROM prospecting_stage_attempt WHERE attempt_id=? AND state='claimed'",(attempt_id,)).fetchone()
            if row is not None:
                timestamp = _now(self.now()).isoformat()
                state = "expired" if code == "lease_expired" else "failed"
                self.connection.execute(
                    """UPDATE prospecting_stage_attempt
                          SET state=?,failure_code=?,finished_at=?
                        WHERE attempt_id=? AND state='claimed'""",
                    (state,code,timestamp,attempt_id),
                )
                self.connection.execute("UPDATE prospecting_pipeline_item SET state=?,updated_at=? WHERE item_id=? AND claim_epoch=?",(WAITING_FOR_STAGE[row["stage"]],timestamp,row["item_id"],row["claim_epoch"]))
            self.connection.commit()
        except BaseException:
            self.connection.rollback()
            raise

    def reject_suggestion(
        self, item_id: str, request_id: str,
        expected_parent_revision_id: str, actor: str,
    ) -> RejectionResult:
        item_id = _text(item_id, "invalid_item_id", maximum=128)
        request_id = _text(request_id, "invalid_request_id", maximum=128)
        expected_parent_revision_id = _text(
            expected_parent_revision_id, "invalid_revision_id", maximum=128,
        )
        if type(actor) is not str or not actor.startswith("human:") or actor == "human:":
            raise PipelineStageError("human_actor_required")
        _text(actor, "human_actor_required", maximum=128)
        request_hash = _digest("reject", item_id, expected_parent_revision_id, actor)
        self._begin()
        try:
            replay = self.connection.execute(
                "SELECT * FROM prospecting_suggestion_decision WHERE request_id=?",
                (request_id,),
            ).fetchone()
            if replay is not None:
                if replay["request_hash"] != request_hash or replay["decision"] != "rejected":
                    raise PipelineStageError("request_conflict")
                self.connection.commit()
                return RejectionResult(str(replay["decision_id"]), item_id, True)
            item = self.connection.execute(
                "SELECT * FROM prospecting_pipeline_item WHERE item_id=?", (item_id,),
            ).fetchone()
            if item is None or item["state"] != "human_review":
                raise PipelineStageError("suggestion_not_reviewable")
            parent = _revision(self.connection, expected_parent_revision_id)
            if expected_parent_revision_id != item["base_revision_id"] or not _current_revision(
                self.connection, parent,
            ):
                raise PipelineStageError("revision_conflict")
            _assert_item_context_current(self.connection, item, _now(self.now()))
            suggestion = self.connection.execute(
                "SELECT * FROM prospecting_pipeline_suggestion WHERE item_id=? AND cycle=?",
                (item_id, item["repair_cycle"]),
            ).fetchone()
            if suggestion is None:
                raise PipelineStageError("suggestion_missing")
            if self.connection.execute(
                "SELECT 1 FROM prospecting_suggestion_decision WHERE suggestion_id=?",
                (suggestion["suggestion_id"],),
            ).fetchone() is not None:
                raise PipelineStageError("suggestion_already_decided")
            decision_id = "decision-" + uuid4().hex
            self.connection.execute(
                """INSERT INTO prospecting_suggestion_decision(
                       decision_id,request_id,request_hash,suggestion_id,item_id,
                       expected_parent_revision_id,decision,actor,accepted_revision_id,
                       accepted_revision_hash,created_at
                   ) VALUES(?,?,?,?,?,?,'rejected',?,NULL,NULL,?)""",
                (
                    decision_id, request_id, request_hash, suggestion["suggestion_id"],
                    item_id, expected_parent_revision_id, actor,
                    _now(self.now()).isoformat(),
                ),
            )
            self.connection.commit()
            return RejectionResult(decision_id, item_id)
        except BaseException:
            self.connection.rollback()
            raise

    def accept_suggestion(self, item_id: str, request_id: str, expected_parent_revision_id: str, actor: str) -> AcceptanceResult:
        item_id = _text(item_id, "invalid_item_id", maximum=128)
        request_id = _text(request_id, "invalid_request_id", maximum=128)
        expected_parent_revision_id = _text(
            expected_parent_revision_id, "invalid_revision_id", maximum=128,
        )
        if type(actor) is not str or not actor.startswith("human:") or actor == "human:":
            raise PipelineStageError("human_actor_required")
        _text(actor, "human_actor_required", maximum=128)
        request_hash = _digest("accept",item_id,expected_parent_revision_id,actor)
        self._begin()
        try:
            replay = self.connection.execute("SELECT * FROM prospecting_suggestion_decision WHERE request_id=?",(request_id,)).fetchone()
            if replay is not None:
                if replay["request_hash"] != request_hash:
                    raise PipelineStageError("request_conflict")
                self.connection.commit()
                return AcceptanceResult(replay["decision_id"],replay["accepted_revision_id"],replay["accepted_revision_hash"],replay["accepted_revision_id"]==expected_parent_revision_id,True)
            item = self.connection.execute("SELECT * FROM prospecting_pipeline_item WHERE item_id=?",(item_id,)).fetchone()
            if item is None or item["state"] != "human_review":
                raise PipelineStageError("suggestion_not_reviewable")
            parent = _revision(self.connection,expected_parent_revision_id)
            if expected_parent_revision_id != item["base_revision_id"] or not _current_revision(self.connection,parent):
                raise PipelineStageError("revision_conflict")
            _assert_no_unresolved_candidate(
                self.connection, str(item["campaign_id"]), expected_parent_revision_id,
            )
            _assert_item_context_current(self.connection, item, _now(self.now()))
            suggestion = self.connection.execute("SELECT * FROM prospecting_pipeline_suggestion WHERE item_id=? AND cycle=?",(item_id,item["repair_cycle"])).fetchone()
            if suggestion is None:
                raise PipelineStageError("suggestion_missing")
            if self.connection.execute(
                "SELECT 1 FROM prospecting_suggestion_decision WHERE suggestion_id=?",
                (suggestion["suggestion_id"],),
            ).fetchone() is not None:
                raise PipelineStageError("suggestion_already_decided")
            fact = self.connection.execute("SELECT * FROM prospecting_stage_artifact WHERE item_id=? AND cycle=? AND stage='post_humanization_factcheck' AND decision='pass'",(item_id,item["repair_cycle"])).fetchone()
            critic = self.connection.execute("SELECT * FROM prospecting_stage_artifact WHERE item_id=? AND cycle=? AND stage='independent_critic' AND decision='pass'",(item_id,item["repair_cycle"])).fetchone()
            human = self.connection.execute("SELECT * FROM prospecting_stage_artifact WHERE artifact_id=?",(suggestion["humanizer_artifact_id"],)).fetchone()
            if (
                fact is None or critic is None or human is None
                or len({human["producer_job_id"],fact["producer_job_id"],critic["producer_job_id"]}) != 3
                or len({human["producer_identity"],fact["producer_identity"],critic["producer_identity"]}) != 3
            ):
                raise PipelineStageError("editorial_receipts_missing")
            context_hash = _source_context_hash(
                self.connection, item, parent, _now(self.now()),
            )
            try:
                artifact_contexts = {
                    json.loads(str(row["payload_json"]))["approved_context_hash"]
                    for row in (human, fact, critic)
                }
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                raise PipelineStageError("editorial_receipts_stale") from None
            if artifact_contexts != {context_hash}:
                raise PipelineStageError("editorial_receipts_stale")
            context_data = json.loads(suggestion["candidate_context_json"])
            bindings = {name:SlotBinding(row["value"],row["source_kind"],row["source_ref"]) for name,row in context_data.items()}
            parent_context = load_revision_qa_context(
                self.connection, expected_parent_revision_id,
            )
            value, qa = _candidate_value_and_qa(
                self.connection, item, human, bindings, _now(self.now()),
            )
            if not qa.passed:
                raise PipelineStageError("candidate_qa_failed")
            computed = revision_hash(value)
            if computed != suggestion["proposed_revision_hash"]:
                raise PipelineStageError("proposed_revision_hash_mismatch")
            unchanged = suggestion["subject"] == parent["subject"] and suggestion["body"] == parent["body"]
            if unchanged:
                revision_id,final_hash = parent["revision_id"],parent["hash"]
                if computed != final_hash:
                    raise PipelineStageError("unchanged_revision_metadata_mismatch")
            else:
                record = build_revision(self.connection,value)
                if not record.created:
                    raise PipelineStageError("revision_duplicate")
                record_revision_qa_context(self.connection,record.revision_id,bindings,parent_context.policy,inherited_from_revision_id=None,created_at=_now(self.now()).isoformat())
                revision_id,final_hash = record.revision_id,record.revision_hash
            decision_id = "decision-" + uuid4().hex
            timestamp = _now(self.now()).isoformat()
            self.connection.execute(
                """INSERT INTO prospecting_suggestion_decision(
                       decision_id,request_id,request_hash,suggestion_id,item_id,
                       expected_parent_revision_id,decision,actor,accepted_revision_id,
                       accepted_revision_hash,created_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (decision_id,request_id,request_hash,suggestion["suggestion_id"],item_id,expected_parent_revision_id,"accepted",actor,revision_id,final_hash,timestamp),
            )
            if not unchanged:
                self.connection.execute(
                    """INSERT INTO prospecting_agent_revision_lineage(
                           child_revision_id,parent_revision_id,suggestion_id,decision_id,origin,created_at
                       ) VALUES(?,?,?,?,?,?)""",
                    (revision_id,expected_parent_revision_id,suggestion["suggestion_id"],decision_id,"accepted_agent_suggestion",timestamp),
                )
            self.connection.execute("UPDATE prospecting_pipeline_item SET state='accepted',next_stage=NULL,updated_at=? WHERE item_id=?",(timestamp,item_id))
            self.connection.commit()
            return AcceptanceResult(decision_id,revision_id,final_hash,unchanged)
        except BaseException:
            self.connection.rollback()
            raise
