from dataclasses import dataclass, field
import hashlib
import json
import sqlite3
from uuid import uuid4

from .qa import QaResult


class RevisionError(ValueError):
    pass


@dataclass(frozen=True)
class RevisionInput:
    person_id: str
    campaign_id: str
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
    qa: QaResult


@dataclass(frozen=True)
class RevisionRecord:
    revision_id: str
    revision_hash: str
    created: bool = field(compare=False)


def _json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_revision_payload(value: RevisionInput) -> dict[str, object]:
    return {
        "person_id": value.person_id,
        "campaign_id": value.campaign_id,
        "step": value.step,
        "subject": value.subject,
        "body": value.body,
        "angle": value.angle,
        "generation_mode": value.generation_mode,
        "purpose": value.purpose,
        "ask": value.ask,
        "evidence_ids": list(value.evidence_ids),
        "recipient_relevance_points": list(value.recipient_relevance_points),
        "sender_proof_points": list(value.sender_proof_points),
        "template_id": value.template_id,
        "template_version": value.template_version,
        "prompt_version": value.prompt_version,
        "model_version": value.model_version,
    }


def revision_hash(value: RevisionInput) -> str:
    return hashlib.sha256(
        _json(canonical_revision_payload(value)).encode("utf-8")
    ).hexdigest()


def _qa_json(qa: QaResult) -> str:
    return _json({
        "passed": qa.passed,
        "qa_score": qa.qa_score,
        "checks": dict(qa.checks),
        "failure_codes": list(qa.failure_codes),
        "self_critique": qa.self_critique,
    })


def build_revision(connection: sqlite3.Connection, value: RevisionInput) -> RevisionRecord:
    if not value.qa.passed:
        raise RevisionError("qa_failed")
    if value.step not in {0, 1, 2}:
        raise RevisionError("step")
    if value.generation_mode not in {"bespoke", "template_with_purpose"}:
        raise RevisionError("generation_mode")
    if value.generation_mode == "template_with_purpose" and not value.purpose:
        raise RevisionError("purpose_required")
    if value.generation_mode == "bespoke" and value.purpose is not None:
        raise RevisionError("purpose_forbidden")
    if value.angle not in {"why_them", "signal_led", "offer_led", "follow_up_value"}:
        raise RevisionError("invalid_angle")

    digest = revision_hash(value)
    revision_id = str(uuid4())
    insert = connection.execute(
        """INSERT INTO revision(
          revision_id,person_id,campaign_id,step,subject,body,angle,generation_mode,purpose,ask,
          evidence_ids,recipient_relevance_points,sender_proof_points,template_id,template_version,
          prompt_version,model_version,qa,hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(hash) DO NOTHING""",
        (
            revision_id,
            value.person_id,
            value.campaign_id,
            value.step,
            value.subject,
            value.body,
            value.angle,
            value.generation_mode,
            value.purpose,
            value.ask,
            _json(list(value.evidence_ids)),
            _json(list(value.recipient_relevance_points)),
            _json(list(value.sender_proof_points)),
            value.template_id,
            value.template_version,
            value.prompt_version,
            value.model_version,
            _qa_json(value.qa),
            digest,
        ),
    )
    if insert.rowcount:
        return RevisionRecord(revision_id, digest, True)

    existing = connection.execute(
        "SELECT revision_id FROM revision WHERE hash=?", (digest,)
    ).fetchone()
    return RevisionRecord(existing["revision_id"], digest, False)
