from dataclasses import dataclass
import re
from types import MappingProxyType
from typing import Mapping


FIELDS = {"angle", "why_them", "ask", "evidence_ids_used", "self_critique"}
ANGLES = {"why_them", "signal_led", "offer_led", "follow_up_value"}
UNSAFE = re.compile(r"https?://|www\.|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|(?:\+?\d[\d .()-]{7,}\d)", re.I)
INSTRUCTION = re.compile(r"(?:ignore|disregard|forget|override)(?: (?:all|the|previous|your|my|these|those|any|prior|above))* instructions?|(?:open|visit|browse|email|send|execute|run|download|click)\b", re.I)


class ModelResponseError(ValueError):
    pass


@dataclass(frozen=True)
class ModelDraft:
    angle: str
    why_them: str
    ask: str
    evidence_ids_used: Mapping[str, str]
    self_critique: str


@dataclass(frozen=True)
class SanitizedExcerpt:
    text: str
    flagged: bool
    removed_sentences: int


def sanitize_snapshot_excerpt(text: str) -> SanitizedExcerpt:
    kept: list[str] = []
    flagged = False
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if INSTRUCTION.search(sentence) or UNSAFE.search(sentence):
            flagged = True
        else:
            kept.append(sentence)
    return SanitizedExcerpt(" ".join(kept).strip(), flagged, sum(1 for sentence in re.split(r"(?<=[.!?])\s+", text) if INSTRUCTION.search(sentence) or UNSAFE.search(sentence)))


def validate_model_response(
    raw: Mapping[str, object],
    required_factual_slots: set[str],
    allowed_evidence_ids: set[str],
) -> ModelDraft:
    if not isinstance(raw, Mapping) or set(raw) != FIELDS:
        raise ModelResponseError("schema_keys")
    for field in ("angle", "why_them", "ask", "self_critique"):
        if not isinstance(raw[field], str) or not raw[field].strip():
            raise ModelResponseError(f"field_type:{field}")
        if UNSAFE.search(raw[field]):
            raise ModelResponseError("unsafe_field")
    if raw["angle"] not in ANGLES:
        raise ModelResponseError("invalid_angle")
    if len(raw["why_them"].split()) > 60 or len(raw["ask"].split()) > 25 or len(raw["self_critique"].split()) > 80:
        raise ModelResponseError("field_too_long")
    evidence_ids = raw["evidence_ids_used"]
    if not isinstance(evidence_ids, dict) or not evidence_ids:
        raise ModelResponseError("evidence_ids_required")
    if set(evidence_ids) != required_factual_slots:
        raise ModelResponseError("evidence_slot_keys")
    for item in evidence_ids.values():
        if not isinstance(item, str):
            raise ModelResponseError("evidence_ids_required")
        if not item.strip() or UNSAFE.search(item):
            raise ModelResponseError("unsafe_field")
    if not set(evidence_ids.values()) <= allowed_evidence_ids:
        raise ModelResponseError("evidence_id_not_allowed")
    return ModelDraft(
        raw["angle"], raw["why_them"].strip(), raw["ask"].strip(),
        MappingProxyType(dict(evidence_ids)), raw["self_critique"].strip(),
    )
