from dataclasses import dataclass
import json
from pathlib import Path
import re
from types import MappingProxyType
from typing import Mapping


EXPECTED_KEYS = {
    "sender_name", "sender_school", "sender_focus", "sender_background",
    "sender_operating_proof", "approved_metrics",
}
UNSAFE = re.compile(
    r"https?://|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|(?:\+?\d[\d .()-]{7,}\d)",
    re.I,
)
EVIDENCE_ID = re.compile(r"^sender\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$")


class SenderProfileError(ValueError):
    pass


@dataclass(frozen=True)
class ApprovedMetric:
    text: str
    evidence_id: str


@dataclass(frozen=True)
class SenderProfile:
    sender_name: str
    sender_school: str
    sender_focus: str
    sender_background: str
    sender_operating_proof: str
    approved_metrics: tuple[ApprovedMetric, ...]


def load_sender_profile(path: Path) -> SenderProfile:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SenderProfileError("invalid_json") from error
    if not isinstance(value, dict) or set(value) != EXPECTED_KEYS:
        raise SenderProfileError("keys")
    for key in (
        "sender_name", "sender_school", "sender_focus", "sender_background",
        "sender_operating_proof",
    ):
        if not isinstance(value[key], str):
            raise SenderProfileError(key)
    for key in ("sender_name", "sender_focus", "sender_background", "sender_operating_proof"):
        if not value[key].strip():
            raise SenderProfileError(key)
    raw_metrics = value["approved_metrics"]
    if not isinstance(raw_metrics, list):
        raise SenderProfileError("approved_metrics")
    metrics: list[ApprovedMetric] = []
    for item in raw_metrics:
        if (
            not isinstance(item, dict) or set(item) != {"text", "evidence_id"}
            or not isinstance(item["text"], str) or not item["text"].strip()
            or not isinstance(item["evidence_id"], str)
            or EVIDENCE_ID.fullmatch(item["evidence_id"]) is None
        ):
            raise SenderProfileError("approved_metrics")
        metrics.append(ApprovedMetric(item["text"].strip(), item["evidence_id"]))
    texts = [
        value["sender_name"], value["sender_school"], value["sender_focus"],
        value["sender_background"], value["sender_operating_proof"],
        *(metric.text for metric in metrics),
    ]
    if any(UNSAFE.search(text) for text in texts):
        raise SenderProfileError("unsafe_text")
    return SenderProfile(
        value["sender_name"], value["sender_school"], value["sender_focus"],
        value["sender_background"], value["sender_operating_proof"], tuple(metrics),
    )


def sender_fields(profile: SenderProfile) -> Mapping[str, str]:
    values = {
        "sender_name": profile.sender_name,
        "sender_school": profile.sender_school,
        "sender_focus": profile.sender_focus,
        "sender_background": profile.sender_background,
        "sender_proof": profile.sender_operating_proof,
        "signature": profile.sender_name,
    }
    for index, metric in enumerate(profile.approved_metrics):
        values[f"approved_metric_{index}"] = metric.text
        values[f"approved_metric_{index}_evidence_id"] = metric.evidence_id
    return MappingProxyType({key: value for key, value in values.items() if value.strip()})
