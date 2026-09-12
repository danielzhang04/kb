"""Blind, hash-only email-finder bake-off metrics through the executor path."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
import random
from collections.abc import Mapping, Sequence


@dataclass(frozen=True)
class BakeoffCase:
    person_id: str
    company_id: str
    known_email_hash: str
    observed_bounce_class: str


@dataclass(frozen=True)
class BakeoffMetric:
    provider: str
    attempts: int
    matches: int
    wrong_person: int
    not_found: int
    bounce_confusion: Mapping[str, int]
    credits: int
    cost_per_match: float | None
    match_interval: tuple[float, float]
    wrong_person_interval: tuple[float, float]


def wilson_interval(successes: int, total: int) -> tuple[float, float]:
    if total == 0:
        return (0.0, 0.0)
    z = 1.959963984540054
    proportion = successes / total
    denominator = 1 + z * z / total
    center = (proportion + z * z / (2 * total)) / denominator
    margin = z * math.sqrt((proportion * (1 - proportion) + z * z / (4 * total)) / total) / denominator
    return (center - margin, center + margin)


def _request_id(seed: int, provider: str, person_id: str) -> str:
    digest = hashlib.sha256(f"{seed}:{provider}:{person_id}".encode("ascii")).hexdigest()
    return f"req_{digest[:16]}"


def _completed_result(provider, request_id: str):
    completed = getattr(provider, "_completed", None)
    if isinstance(completed, Mapping):
        return completed[request_id]
    return provider._results[request_id]


def run_bakeoff(
    cases: Sequence[BakeoffCase], providers: Sequence[object], executor, *,
    campaign_id: str, policy_hash: str, seed: int, now: str = "2026-09-03T00:00:00Z",
):
    """Queue and claim every lookup; transports are reached only by ``process_one``."""
    ordered = list(cases)
    random.Random(seed).shuffle(ordered)
    output = []
    for provider in providers:
        matches = wrong = missing = credits = 0
        confusion: dict[str, int] = {}
        for case in ordered:
            request_id = _request_id(seed, provider.provider, case.person_id)
            provider.queue(
                executor.connection, campaign_id=campaign_id, person_id=case.person_id,
                policy_hash=policy_hash, request_id=request_id, now=now,
            )
            assert executor.process_one()
            result = _completed_result(provider, request_id)
            credits += result.credits
            record = result.records[0] if result.records else {}
            email_ref = record.get("email_ref") if isinstance(record, Mapping) else None
            if not isinstance(email_ref, str):
                missing += 1
                continue
            if hashlib.sha256(email_ref.encode()).hexdigest() == case.known_email_hash:
                matches += 1
            else:
                wrong += 1
            label = f"{case.observed_bounce_class}->{result.state}"
            confusion[label] = confusion.get(label, 0) + 1
        total = len(ordered)
        output.append(BakeoffMetric(
            provider.provider, total, matches, wrong, missing, confusion, credits,
            None if matches == 0 else credits / matches, wilson_interval(matches, total),
            wilson_interval(wrong, total),
        ))
    return tuple(output)
