"""Immutable P3 QA context and authentic local review revalidation.

This module rechecks recorded slot bindings. It does not discover or verify
new factual claims added outside those bindings.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from types import MappingProxyType
import re
import sqlite3
from typing import Protocol

from scripts.prospecting.personalizer.evidence import EvidenceRecord
from scripts.prospecting.personalizer.qa import QaPolicy, QaResult, SlotBinding, validate_revision


CONTEXT_VERSION = 1
MAX_CONTEXT_BYTES = 256 * 1024
_SLOT = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")
_POLICY_KEYS = {
    "intent", "step", "ask_type", "minimum_words", "maximum_words",
    "minimum_confidence", "prior_evidence_ids",
}
_BINDING_KEYS = {"value", "source_kind", "source_ref"}


class RevisionQaContextError(ValueError):
    """Fixed-code invalid or conflicting local QA metadata."""


class ReviewQaUnavailable(RevisionQaContextError):
    """The parent has no authentic recorded context to rerun."""


class CandidateForReview(Protocol):
    campaign_id: str
    person_id: str
    parent_revision_id: str
    step: int
    subject: str
    body: str
    ask: str


@dataclass(frozen=True)
class RevisionQaContext:
    revision_id: str
    bindings: Mapping[str, SlotBinding]
    policy: QaPolicy
    context_sha256: str
    inherited_from_revision_id: str | None
    created_at: str


@dataclass(frozen=True)
class ReviewQaDecision:
    qa: QaResult
    context: RevisionQaContext
    coverage: str = "stored_bindings_only"


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _bounded_text(value: object, code: str, *, maximum: int = 65_536) -> str:
    if type(value) is not str or not value or "\x00" in value:
        raise RevisionQaContextError(code)
    try:
        if len(value.encode("utf-8")) > maximum:
            raise RevisionQaContextError(code)
    except UnicodeError:
        raise RevisionQaContextError(code) from None
    return value


def _stamp(value: object) -> str:
    value = _bounded_text(value, "invalid_context_time", maximum=64)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
    except ValueError:
        raise RevisionQaContextError("invalid_context_time") from None
    return value


def _bindings_payload(value: Mapping[str, SlotBinding]) -> dict[str, dict[str, str]]:
    if not isinstance(value, Mapping) or not value:
        raise RevisionQaContextError("invalid_bindings")
    result: dict[str, dict[str, str]] = {}
    for name, binding in value.items():
        if type(name) is not str or _SLOT.fullmatch(name) is None or not isinstance(binding, SlotBinding):
            raise RevisionQaContextError("invalid_bindings")
        source_kind = _bounded_text(binding.source_kind, "invalid_bindings", maximum=32)
        if source_kind not in {"evidence", "sender", "policy"}:
            raise RevisionQaContextError("invalid_bindings")
        result[name] = {
            "value": _bounded_text(binding.value, "invalid_bindings"),
            "source_kind": source_kind,
            "source_ref": _bounded_text(binding.source_ref, "invalid_bindings", maximum=256),
        }
    return result


def _policy_payload(value: QaPolicy) -> dict[str, object]:
    if not isinstance(value, QaPolicy) or (
        type(value.intent) is not str or not value.intent
        or type(value.step) is not int or value.step not in {0, 1, 2}
        or type(value.ask_type) is not str or not value.ask_type
        or type(value.minimum_words) is not int or value.minimum_words < 0
        or type(value.maximum_words) is not int or value.maximum_words < value.minimum_words
        or isinstance(value.minimum_confidence, bool)
        or not isinstance(value.minimum_confidence, (int, float))
        or not 0 <= value.minimum_confidence <= 1
        or not isinstance(value.prior_evidence_ids, frozenset)
        or any(type(item) is not str or not item for item in value.prior_evidence_ids)
    ):
        raise RevisionQaContextError("invalid_qa_policy")
    return {
        "intent": value.intent,
        "step": value.step,
        "ask_type": value.ask_type,
        "minimum_words": value.minimum_words,
        "maximum_words": value.maximum_words,
        "minimum_confidence": float(value.minimum_confidence),
        "prior_evidence_ids": sorted(value.prior_evidence_ids),
    }


def _payload(bindings: Mapping[str, SlotBinding], policy: QaPolicy) -> tuple[str, str, str]:
    bindings_json = _canonical(_bindings_payload(bindings))
    policy_json = _canonical(_policy_payload(policy))
    canonical = _canonical({
        "context_version": CONTEXT_VERSION,
        "bindings": json.loads(bindings_json),
        "qa_policy": json.loads(policy_json),
    })
    if len(canonical.encode("utf-8")) > MAX_CONTEXT_BYTES:
        raise RevisionQaContextError("context_too_large")
    return bindings_json, policy_json, hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _revision(connection: sqlite3.Connection, revision_id: str) -> sqlite3.Row:
    row = connection.execute(
        """SELECT r.revision_id,r.person_id,r.campaign_id,r.step,r.subject,r.body,r.ask,r.evidence_ids,
                  c.intent,c.ask_type
             FROM revision AS r JOIN campaign AS c ON c.campaign_id=r.campaign_id
            WHERE r.revision_id=?""",
        (revision_id,),
    ).fetchone()
    if row is None:
        raise RevisionQaContextError("revision_missing")
    return row


def _decode_bindings(value: object) -> Mapping[str, SlotBinding]:
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError):
        raise RevisionQaContextError("context_invalid") from None
    if not isinstance(parsed, dict):
        raise RevisionQaContextError("context_invalid")
    bindings: dict[str, SlotBinding] = {}
    for name, item in parsed.items():
        if type(name) is not str or _SLOT.fullmatch(name) is None or not isinstance(item, dict) or set(item) != _BINDING_KEYS:
            raise RevisionQaContextError("context_invalid")
        bindings[name] = SlotBinding(item["value"], item["source_kind"], item["source_ref"])
    if _canonical(parsed) != str(value):
        raise RevisionQaContextError("context_noncanonical")
    _bindings_payload(bindings)
    return MappingProxyType(bindings)


def _decode_policy(value: object) -> QaPolicy:
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError):
        raise RevisionQaContextError("context_invalid") from None
    if not isinstance(parsed, dict) or set(parsed) != _POLICY_KEYS or _canonical(parsed) != str(value):
        raise RevisionQaContextError("context_noncanonical")
    prior = parsed["prior_evidence_ids"]
    if not isinstance(prior, list) or any(type(item) is not str for item in prior) or len(prior) != len(set(prior)):
        raise RevisionQaContextError("context_invalid")
    policy = QaPolicy(
        parsed["intent"], parsed["step"], parsed["ask_type"], parsed["minimum_words"],
        parsed["maximum_words"], parsed["minimum_confidence"], frozenset(prior),
    )
    _policy_payload(policy)
    return policy


def _validate_scope(
    connection: sqlite3.Connection,
    revision: sqlite3.Row,
    bindings: Mapping[str, SlotBinding],
    policy: QaPolicy,
) -> None:
    try:
        evidence_ids = json.loads(str(revision["evidence_ids"]))
    except (TypeError, ValueError):
        raise RevisionQaContextError("revision_state_invalid") from None
    if (
        not isinstance(evidence_ids, list)
        or any(type(item) is not str for item in evidence_ids)
        or len(evidence_ids) != len(set(evidence_ids))
        or policy.step != revision["step"]
        or "ask" not in bindings
        or bindings["ask"].source_kind != "policy"
        or bindings["ask"].value != revision["ask"]
        or any(binding.value not in str(revision["subject"]) + "\n" + str(revision["body"])
               for binding in bindings.values())
    ):
        raise RevisionQaContextError("context_scope_mismatch")
    evidence_refs = {item.source_ref for item in bindings.values() if item.source_kind == "evidence"}
    if evidence_refs != set(evidence_ids):
        raise RevisionQaContextError("context_evidence_mismatch")
    all_refs = evidence_refs | set(policy.prior_evidence_ids)
    if all_refs:
        placeholders = ",".join("?" for _ in all_refs)
        count = connection.execute(
            f"SELECT count(*) FROM evidence WHERE person_id=? AND evidence_id IN ({placeholders})",
            (revision["person_id"], *sorted(all_refs)),
        ).fetchone()[0]
        if count != len(all_refs):
            raise RevisionQaContextError("context_evidence_mismatch")


def load_revision_qa_context(
    connection: sqlite3.Connection, revision_id: str
) -> RevisionQaContext:
    connection.row_factory = sqlite3.Row
    row = connection.execute(
        "SELECT * FROM revision_qa_context WHERE revision_id=?", (revision_id,)
    ).fetchone()
    if row is None:
        raise ReviewQaUnavailable("qa_context_missing")
    if row["context_version"] != CONTEXT_VERSION or type(row["context_sha256"]) is not str or len(row["context_sha256"]) != 64:
        raise RevisionQaContextError("context_invalid")
    bindings = _decode_bindings(row["bindings_json"])
    policy = _decode_policy(row["qa_policy_json"])
    bindings_json, policy_json, digest = _payload(bindings, policy)
    if bindings_json != row["bindings_json"] or policy_json != row["qa_policy_json"] or digest != row["context_sha256"]:
        raise RevisionQaContextError("context_hash_mismatch")
    revision = _revision(connection, revision_id)
    _validate_scope(connection, revision, bindings, policy)
    inherited = row["inherited_from_revision_id"]
    if inherited is not None:
        parent = load_revision_qa_context(connection, str(inherited))
        if parent.context_sha256 != digest:
            raise RevisionQaContextError("context_parent_mismatch")
    return RevisionQaContext(
        revision_id, bindings, policy, digest,
        None if inherited is None else str(inherited), _stamp(row["created_at"]),
    )


def record_revision_qa_context(
    connection: sqlite3.Connection,
    revision_id: str,
    bindings: Mapping[str, SlotBinding],
    policy: QaPolicy,
    *,
    inherited_from_revision_id: str | None,
    created_at: str,
) -> RevisionQaContext:
    connection.row_factory = sqlite3.Row
    revision = _revision(connection, revision_id)
    bindings_json, policy_json, digest = _payload(bindings, policy)
    _validate_scope(connection, revision, bindings, policy)
    created_at = _stamp(created_at)
    if inherited_from_revision_id is not None:
        parent = load_revision_qa_context(connection, inherited_from_revision_id)
        parent_row = _revision(connection, inherited_from_revision_id)
        if (
            parent.context_sha256 != digest
            or (parent_row["campaign_id"], parent_row["person_id"], parent_row["step"])
            != (revision["campaign_id"], revision["person_id"], revision["step"])
        ):
            raise RevisionQaContextError("context_parent_mismatch")
    existing = connection.execute(
        "SELECT 1 FROM revision_qa_context WHERE revision_id=?", (revision_id,)
    ).fetchone()
    if existing is None:
        connection.execute(
            "INSERT INTO revision_qa_context VALUES(?,?,?,?,?,?,?)",
            (revision_id, CONTEXT_VERSION, bindings_json, policy_json, digest,
             inherited_from_revision_id, created_at),
        )
    loaded = load_revision_qa_context(connection, revision_id)
    if (
        loaded.context_sha256 != digest
        or loaded.inherited_from_revision_id != inherited_from_revision_id
    ):
        raise RevisionQaContextError("context_conflict")
    return loaded


def require_revision_qa_context(
    connection: sqlite3.Connection,
    revision_id: str,
    bindings: Mapping[str, SlotBinding],
    policy: QaPolicy,
    *,
    inherited_from_revision_id: str | None,
) -> RevisionQaContext:
    """Verify an existing context without ever attaching metadata to an old revision."""
    connection.row_factory = sqlite3.Row
    revision = _revision(connection, revision_id)
    _bindings_json, _policy_json, digest = _payload(bindings, policy)
    _validate_scope(connection, revision, bindings, policy)
    loaded = load_revision_qa_context(connection, revision_id)
    if (
        loaded.context_sha256 != digest
        or loaded.inherited_from_revision_id != inherited_from_revision_id
    ):
        raise RevisionQaContextError("context_conflict")
    return loaded


def propagate_revision_qa_context(
    connection: sqlite3.Connection,
    decision: ReviewQaDecision,
    child_revision_id: str,
    parent_revision_id: str,
    *,
    created_at: str,
) -> RevisionQaContext:
    if decision.context.revision_id != parent_revision_id:
        raise RevisionQaContextError("context_parent_mismatch")
    return record_revision_qa_context(
        connection, child_revision_id, decision.context.bindings, decision.context.policy,
        inherited_from_revision_id=parent_revision_id, created_at=created_at,
    )


class StoredReviewQa:
    """Rerun existing QA against a parent's exact recorded local context."""

    def __init__(self, connection: sqlite3.Connection, *, now: Callable[[], datetime]) -> None:
        self.connection = connection
        self.now = now

    def __call__(self, candidate: CandidateForReview) -> ReviewQaDecision:
        context = load_revision_qa_context(self.connection, candidate.parent_revision_id)
        revision = _revision(self.connection, candidate.parent_revision_id)
        if (
            candidate.campaign_id != revision["campaign_id"]
            or candidate.person_id != revision["person_id"]
            or candidate.step != revision["step"]
            or candidate.ask != revision["ask"]
        ):
            raise RevisionQaContextError("candidate_scope_mismatch")
        evidence_refs = sorted({
            binding.source_ref for binding in context.bindings.values()
            if binding.source_kind == "evidence"
        })
        rows = self.connection.execute(
            """SELECT evidence_id,person_id,claim,url,observed_at,retrieved_at,excerpt,
                      confidence,expires_at,allowed_for_copy
                 FROM evidence WHERE person_id=? AND evidence_id IN ({})
                ORDER BY evidence_id""".format(",".join("?" for _ in evidence_refs)),
            (candidate.person_id, *evidence_refs),
        ).fetchall()
        if len(rows) != len(evidence_refs):
            raise RevisionQaContextError("context_evidence_mismatch")
        evidence = tuple(EvidenceRecord(
            str(row["evidence_id"]), str(row["person_id"]), str(row["claim"]), str(row["url"]),
            None if row["observed_at"] is None else str(row["observed_at"]),
            str(row["retrieved_at"]), str(row["excerpt"]), float(row["confidence"]),
            str(row["expires_at"]), bool(row["allowed_for_copy"]),
        ) for row in rows)
        now = self.now()
        if not isinstance(now, datetime) or now.tzinfo is None:
            raise RevisionQaContextError("invalid_qa_time")
        result = validate_revision(
            candidate.subject, candidate.body, candidate.ask, context.bindings, evidence,
            context.policy, candidate.person_id, candidate.campaign_id,
            now.astimezone(timezone.utc),
        )
        return ReviewQaDecision(result, context)
