from dataclasses import dataclass
from datetime import datetime
import re
from typing import Mapping

from .evidence import EvidenceRecord, copy_eligible


ALLOWED_SOURCES = frozenset({"evidence", "sender", "policy"})
RECIPIENT_SLOTS = frozenset({"first_name", "company", "role", "topic", "school", "why_them", "recipient_hook"})
REFERRAL = re.compile(
    r"\b(?:refer(?:ral|s|red|ring)?|intro me|introduce me|put me in touch|introduc(?:e|tion)|resume review|job commitment)\b",
    re.I,
)
UNSAFE_COPY = re.compile(
    r"https?://|www\.|\blinks?\b|attach(?:ed|ments?)|tracking (?:pixel|redirect)|\bimage\b",
    re.I,
)
SENSITIVE = re.compile(r"\b(race|ethnicity|religion|disability|disabled|health condition|pregnan(?:t|cy)|sexual orientation|political affiliation|family status|marital status|age)\b", re.I)
ASK_TYPE = re.compile(r"\b(learn|hear|perspective|informational|understand|advice|conversation)\b", re.I)
FOLLOW_UP_EMPTY = re.compile(r"\b(?:just )?checking in\b", re.I)
SIGNIFICANT = re.compile(r"[A-Za-z0-9]+")
STOPWORDS = frozenset({"a", "an", "and", "at", "for", "from", "i", "in", "is", "my", "of", "on", "the", "to", "your"})


@dataclass(frozen=True)
class SlotBinding:
    value: str
    source_kind: str
    source_ref: str


@dataclass(frozen=True)
class QaPolicy:
    intent: str
    step: int
    ask_type: str
    minimum_words: int
    maximum_words: int
    minimum_confidence: float
    prior_evidence_ids: frozenset[str] = frozenset()


@dataclass(frozen=True)
class QaResult:
    passed: bool
    qa_score: int
    checks: Mapping[str, bool]
    failure_codes: tuple[str, ...]
    self_critique: str = ""


def _body_word_count(body: str) -> int:
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    core = " ".join(lines[1:-1] if len(lines) >= 3 else lines)
    return len(re.findall(r"\b[\w’'-]+\b", core))


def _normalized_text(value: str) -> str:
    return " ".join(value.casefold().split())


def _sentences(value: str) -> tuple[str, ...]:
    return tuple(match.group().strip() for match in re.finditer(r"[^.!?]+[.!?]+|[^.!?]+$", value, re.S))


def _entailed(value: str, claim: str) -> bool:
    value_terms = {term.lower() for term in SIGNIFICANT.findall(value)} - STOPWORDS
    claim_terms = {term.lower() for term in SIGNIFICANT.findall(claim)} - STOPWORDS
    required = min(2, len(value_terms))
    return required > 0 and len(value_terms & claim_terms) >= required


def validate_revision(
    subject: str,
    body: str,
    ask: str,
    bindings: Mapping[str, SlotBinding],
    evidence: tuple[EvidenceRecord, ...],
    policy: QaPolicy,
    person_id: str,
    campaign_id: str,
    now: datetime,
) -> QaResult:
    failures: set[str] = set()
    if policy.step not in {0, 1, 2}:
        failures.add("step_invalid")
    if not campaign_id.strip():
        failures.add("campaign_missing")
    evidence_by_id = {item.evidence_id: item for item in evidence}
    recipient_points = 0
    sender_points = 0
    person_specific = False
    used_evidence_ids: set[str] = set()
    rendered = subject + "\n" + body
    for name, binding in bindings.items():
        if binding.value not in rendered:
            failures.add("slot_value_missing")
        if binding.source_kind not in ALLOWED_SOURCES:
            failures.add("slot_source_invalid")
            continue
        if binding.source_kind == "sender" and name.startswith("sender"):
            sender_points += 1
        if binding.source_kind == "evidence":
            used_evidence_ids.add(binding.source_ref)
            item = evidence_by_id.get(binding.source_ref)
            if item is None:
                failures.add("evidence_missing")
                continue
            if item.person_id != person_id:
                failures.add("evidence_person_mismatch")
            if not item.allowed_for_copy:
                failures.add("evidence_copy_disallowed")
            if item.confidence < policy.minimum_confidence:
                failures.add("evidence_confidence_low")
            if not copy_eligible(item, now, policy.minimum_confidence):
                failures.add("evidence_expired")
            if not _entailed(binding.value, item.claim):
                failures.add("evidence_not_entailing")
            if name in RECIPIENT_SLOTS:
                recipient_points += 1
            person_specific = person_specific or (
                name in {"why_them", "recipient_hook"} and _entailed(binding.value, item.claim)
            )
        elif name in RECIPIENT_SLOTS and binding.source_kind != "evidence":
            failures.add("recipient_slot_unsourced")
    count = _body_word_count(body)
    if not policy.minimum_words <= count <= policy.maximum_words:
        failures.add("word_count")
    normalized_ask = _normalized_text(ask)
    ask_sentences = [
        sentence
        for sentence in _sentences(body)
        if normalized_ask in _normalized_text(sentence)
    ]
    if normalized_ask not in _normalized_text(body):
        failures.add("ask_mismatch")
    if len(ask_sentences) != 1 or not ask_sentences[0].endswith("?"):
        failures.add("ask_count")
    if any(
        sentence.endswith("?") and sentence not in ask_sentences
        for sentence in _sentences(body)
    ):
        failures.add("extra_question")
    if policy.ask_type != "informational_call" or not ASK_TYPE.search(ask):
        failures.add("ask_type")
    if not re.search(r"\b(?:1[0-9]|20)[ -]minutes?\b", ask, re.I):
        failures.add("ask_duration")
    if policy.step == 0 and REFERRAL.search(ask):
        failures.add("first_touch_referral")
    if UNSAFE_COPY.search(subject + "\n" + body):
        failures.add("plain_text_only")
    if SENSITIVE.search(subject + "\n" + body):
        failures.add("sensitive_inference")
    if not person_specific:
        failures.add("name_swap")
    if policy.step > 0 and (
        FOLLOW_UP_EMPTY.search(body)
        or not (used_evidence_ids - policy.prior_evidence_ids)
    ):
        failures.add("follow_up_value")
    if sender_points and recipient_points < 3 * sender_points:
        failures.add("recipient_sender_ratio")
    ordered = tuple(sorted(failures))
    score = max(0, 100 - 20 * len(ordered))
    checks = {
        "slots_sourced": not any(code.startswith("evidence_") or code.endswith("unsourced") or code in {"slot_source_invalid", "slot_value_missing"} for code in ordered),
        "content": not any(code in ordered for code in ("word_count", "ask_count", "ask_mismatch", "extra_question", "ask_type", "ask_duration", "first_touch_referral", "plain_text_only", "sensitive_inference")),
        "specificity": "name_swap" not in ordered,
        "ratio": "recipient_sender_ratio" not in ordered,
        "follow_up": "follow_up_value" not in ordered,
    }
    return QaResult(not ordered and score >= 80, score, checks, ordered)
