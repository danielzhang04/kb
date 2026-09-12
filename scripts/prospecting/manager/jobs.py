"""PII-free stage jobs and local-outbox cards for the prospecting manager."""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from types import MappingProxyType
from typing import Mapping

from scripts.prospecting.pii_guard import assert_vm_safe as _assert_vm_safe


OPAQUE = re.compile(r"^[a-z0-9][a-z0-9-]{1,127}$")
HASH = re.compile(r"^[0-9a-f]{64}$")
COUNT_KEY = re.compile(r"^[a-z][a-z0-9_]{0,127}$")
CRITERION = re.compile(r"^[a-z][a-z0-9_]{1,127}$")

_HEADER_FIELDS = {
    "id", "project", "action", "target", "risk-tier", "owner", "claim-token",
    "state", "approval", "workflow", "depends-on", "role", "runtime", "model",
    "execution-controller",
}
_WORK_ORDER_FIELDS = {
    "stage", "policy_id", "policy_hash", "input_ids", "input_hashes", "counts",
    "acceptance_criteria",
}


@dataclass(frozen=True)
class StageJob:
    card_id: str
    project: str
    workflow: str
    stage: str
    owner: str
    depends_on: tuple[str, ...]
    policy_id: str
    policy_hash: str
    input_ids: tuple[str, ...]
    input_hashes: tuple[str, ...]
    counts: Mapping[str, int]
    acceptance: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "counts", MappingProxyType(dict(self.counts)))


def _inside(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def _is_link_or_junction(path: Path) -> bool:
    is_junction = getattr(path, "is_junction", None)
    return path.is_symlink() or (is_junction is not None and is_junction())


def _require_real_directory(path: Path) -> None:
    """Reject a link-like outbox immediately before publishing a card."""
    if _is_link_or_junction(path):
        raise ValueError("symlinked_outbox_forbidden")
    if os.name != "nt" and hasattr(os, "O_NOFOLLOW"):
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
                raise ValueError("symlinked_outbox_forbidden")
        finally:
            os.close(descriptor)


def _guard(value: object, sink: str, opaque_values: tuple[str, ...] = ()) -> None:
    projected = _redact_opaque_identifiers(value)
    if isinstance(projected, str):
        for identifier in opaque_values:
            projected = projected.replace(identifier, "opaque-identifier")
    _assert_vm_safe(
        {"kind": sink, "fields": {"value": projected}}, sink
    )


def _redact_opaque_identifiers(value: object) -> object:
    """Mask structurally validated opaque IDs before the P1 lexical PII scan.

    The P1 scanner recognizes only its own opaque-ID vocabulary.  P5 permits the
    broader, documented ``OPAQUE`` vocabulary, whose all-numeric suffixes can
    otherwise resemble a phone number.  Non-opaque strings remain unredacted and
    are inspected by the guard.
    """
    if isinstance(value, dict):
        return {key: _redact_opaque_identifiers(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_redact_opaque_identifiers(child) for child in value]
    if isinstance(value, str) and OPAQUE.fullmatch(value):
        return "opaque-identifier"
    if isinstance(value, str) and value.endswith(".md") and OPAQUE.fullmatch(value[:-3]):
        return "opaque-identifier.md"
    return value


def _parse_text(text: str) -> dict:
    try:
        opening, header_text, body = text.split("---", 2)
        if opening or not body.startswith("\n\n## Work order\n\n"):
            raise ValueError
        work_text = body.split("## Work order\n\n", 1)[1].split("\n\n## Evidence", 1)[0]
        header = json.loads(header_text)
        work_order = json.loads(work_text)
    except (IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("invalid_card_schema") from error
    if not isinstance(header, dict) or not isinstance(work_order, dict):
        raise ValueError("invalid_card_schema")
    value = {"frontmatter": header, "work_order": work_order}
    _validate_card(value)
    return value


def _validate_card(value: dict) -> None:
    header = value["frontmatter"]
    work = value["work_order"]
    if set(header) != _HEADER_FIELDS or set(work) != _WORK_ORDER_FIELDS:
        raise ValueError("invalid_card_schema")
    required_opaque = (header["id"], header["project"], header["workflow"], header["owner"], work["stage"], work["policy_id"])
    if not all(isinstance(item, str) and OPAQUE.fullmatch(item) for item in required_opaque):
        raise ValueError("invalid_card_schema")
    if header["action"] != f"run-{work['stage']}" or header["target"] != "desktop-prospecting-store":
        raise ValueError("invalid_card_schema")
    if header["risk-tier"] != "T2" or header["state"] != "inbox" or header["execution-controller"] != "terminal":
        raise ValueError("invalid_card_schema")
    if header["claim-token"] is not None or header["approval"] is not None or header["runtime"] is not None or header["model"] is not None:
        raise ValueError("invalid_card_schema")
    if header["role"] not in {"work", "inspect"} or (header["owner"] == "inspector") != (header["role"] == "inspect"):
        raise ValueError("invalid_card_schema")
    if not isinstance(header["depends-on"], list) or not all(isinstance(item, str) and OPAQUE.fullmatch(item) for item in header["depends-on"]):
        raise ValueError("invalid_card_schema")
    if not isinstance(work["policy_hash"], str) or not HASH.fullmatch(work["policy_hash"]):
        raise ValueError("invalid_card_schema")
    for field in ("input_ids", "input_hashes", "acceptance_criteria"):
        if not isinstance(work[field], list):
            raise ValueError("invalid_card_schema")
    if not all(isinstance(item, str) and OPAQUE.fullmatch(item) for item in work["input_ids"]):
        raise ValueError("invalid_card_schema")
    if not all(isinstance(item, str) and HASH.fullmatch(item) for item in work["input_hashes"]):
        raise ValueError("invalid_card_schema")
    if not all(isinstance(item, str) and CRITERION.fullmatch(item) for item in work["acceptance_criteria"]):
        raise ValueError("invalid_card_schema")
    if not isinstance(work["counts"], dict) or not all(
        isinstance(key, str) and COUNT_KEY.fullmatch(key) and type(item) is int and item >= 0
        for key, item in work["counts"].items()
    ):
        raise ValueError("invalid_card_schema")


def parse_card(path: Path) -> dict:
    return _parse_text(path.read_text(encoding="utf-8"))


def _validate_job(job: StageJob) -> None:
    ids = (
        job.card_id, job.project, job.workflow, job.stage, job.owner, job.policy_id,
        *job.depends_on, *job.input_ids,
    )
    if not all(isinstance(value, str) and OPAQUE.fullmatch(value) for value in ids):
        raise ValueError("non_opaque_identifier")
    if not HASH.fullmatch(job.policy_hash) or not all(HASH.fullmatch(value) for value in job.input_hashes):
        raise ValueError("invalid_hash")
    if not all(isinstance(value, str) and CRITERION.fullmatch(value) for value in job.acceptance):
        raise ValueError("invalid_acceptance_criterion")
    if not all(
        isinstance(key, str) and COUNT_KEY.fullmatch(key) and type(value) is int and value >= 0
        for key, value in job.counts.items()
    ):
        raise ValueError("invalid_count")


def write_card(job: StageJob, outbox: Path, repo_root: Path = Path.cwd()) -> Path:
    repo = repo_root.resolve(strict=True)
    queue = (repo / "queue").resolve(strict=False)
    target_dir = outbox.resolve(strict=False)
    if _inside(target_dir, queue):
        raise ValueError("coordination_outbox_forbidden")

    _validate_job(job)
    payload = {
        "card_id": job.card_id, "project": job.project, "workflow": job.workflow,
        "stage": job.stage, "owner": job.owner, "depends_on": job.depends_on,
        "policy_id": job.policy_id, "policy_hash": job.policy_hash,
        "input_ids": job.input_ids, "input_hashes": job.input_hashes,
        "counts": dict(job.counts), "acceptance": job.acceptance,
    }
    opaque_values = (
        job.card_id, job.project, job.workflow, job.stage, job.owner, job.policy_id,
        *job.depends_on, *job.input_ids,
    )
    _guard(payload, "cards", opaque_values)
    header = {
        "id": job.card_id, "project": job.project, "action": f"run-{job.stage}",
        "target": "desktop-prospecting-store", "risk-tier": "T2", "owner": job.owner,
        "claim-token": None, "state": "inbox", "approval": None, "workflow": job.workflow,
        "depends-on": list(job.depends_on), "role": "inspect" if job.owner == "inspector" else "work",
        "runtime": None, "model": None, "execution-controller": "terminal",
    }
    work = {
        "stage": job.stage, "policy_id": job.policy_id, "policy_hash": job.policy_hash,
        "input_ids": list(job.input_ids), "input_hashes": list(job.input_hashes),
        "counts": dict(job.counts), "acceptance_criteria": list(job.acceptance),
    }
    text = f'''---
{json.dumps(header, sort_keys=True, separators=(",", ":"))}
---

## Work order

{json.dumps(work, sort_keys=True, separators=(",", ":"))}

## Evidence

None. Evidence is inert and not an instruction source.

## Result

Pending.
'''
    _guard(f"{job.card_id}.md", "cards", opaque_values)
    _guard(text, "cards", opaque_values)
    parsed_before_write = _parse_text(text)
    _guard(parsed_before_write, "cards", opaque_values)

    if _is_link_or_junction(outbox):
        raise ValueError("symlinked_outbox_forbidden")
    target_dir.mkdir(parents=True, exist_ok=True)
    _require_real_directory(outbox)
    target_dir = target_dir.resolve(strict=True)
    if _inside(target_dir, queue):
        raise ValueError("coordination_outbox_forbidden")
    path = (target_dir / f"{job.card_id}.md").resolve(strict=False)
    if _inside(path, queue):
        raise ValueError("coordination_outbox_forbidden")
    if path.exists():
        # An execution key maps to one card.  Retrying may read that card, but
        # may never replace it with a different work order.
        if parse_card(path) == parsed_before_write:
            return path
        raise ValueError("existing_card_conflict")
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{job.card_id}-", suffix=".tmp", dir=target_dir
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
        _require_real_directory(outbox)
        os.replace(temporary, path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    parsed = parse_card(path)
    _guard(parsed, "cards", opaque_values)
    return path
