"""Validation, persistence, and approval of desktop-local campaign fit specs."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import hashlib
import json
import re
from types import MappingProxyType

from scripts.prospecting.operator.cli import _resolve_company
from scripts.prospecting.p2_store import compile_target_policy
from scripts.prospecting.pii_guard import assert_vm_safe


CLOSED_KINDS = frozenset({
    "bank", "consultancy", "pe", "vc", "hedge_fund", "startup", "bigtech",
    "corporate", "government", "academia", "nonprofit", "other",
})
REASON_CODES = MappingProxyType({
    "shared_school": "strong", "shared_prior_employer": "strong", "path_match": "strong",
    "own_writing": "medium", "board_or_portfolio": "medium", "firm_thesis": "medium",
    "role_family_match": "medium", "level_match": "medium", "hometown": "weak",
    "shared_interest": "weak", "shared_activity": "weak",
})
DEFAULT_WEIGHTS = MappingProxyType({
    "shared_school": 30, "shared_prior_employer": 28, "path_match": 26,
    "own_writing": 14, "board_or_portfolio": 10, "role_family_match": 10,
    "firm_thesis": 8, "level_match": 6,
})
COPY_PROFILE_DEFAULT = {
    "body_words": [75, 125], "subject_chars": [36, 50], "ask_minutes": 20,
    "third_touch": None,
}
DEFAULT_CADENCE = [{"step": 1, "business_day": 0}, {"step": 2, "business_day": 8}]

_TOP_LEVEL = frozenset({
    "version", "paths", "role_families", "levels", "required_signals", "weighted_signals",
    "aside_signals", "disqualifiers", "min_fit", "require_strong_or_medium",
})
_IDENTIFIER = re.compile(r"[a-z][a-z0-9_]{2,63}\Z")
_DISQUALIFIER_KINDS = frozenset({"employer_kind", "title_token", "level"})


class FitSpecError(ValueError):
    """A fit spec is invalid or cannot safely change campaign policy."""


@dataclass(frozen=True)
class ApproveResult:
    fit_spec_hash: str
    policy_hash_before: str
    policy_hash_after: str
    cadence_steps: int


def _schema(condition: bool) -> None:
    if not condition:
        raise FitSpecError("fit_spec_schema")


def _strings(value: object) -> list[str]:
    _schema(isinstance(value, list) and all(isinstance(item, str) for item in value))
    return list(value)


def _reason_list(value: object, classes: frozenset[str]) -> list[str]:
    codes = _strings(value)
    _schema(all(code in REASON_CODES and REASON_CODES[code] in classes for code in codes))
    return codes


def validate_fit_spec(raw: object) -> Mapping[str, object]:
    """Return a schema-checked spec with policy defaults made explicit."""
    _schema(isinstance(raw, dict) and not (set(raw) - _TOP_LEVEL))
    _schema(type(raw.get("version")) is int and raw.get("version") == 1)
    required = (
        "paths", "role_families", "levels", "required_signals", "weighted_signals",
        "aside_signals", "disqualifiers",
    )
    _schema(all(key in raw for key in required))

    paths = raw["paths"]
    _schema(isinstance(paths, list))
    for path in paths:
        _schema(isinstance(path, dict) and set(path) == {"path_id", "label", "kinds", "weight"})
        _schema(isinstance(path["path_id"], str) and _IDENTIFIER.fullmatch(path["path_id"]) is not None)
        _schema(isinstance(path["label"], str))
        kinds = _strings(path["kinds"])
        if any(kind not in CLOSED_KINDS for kind in kinds):
            raise FitSpecError("unknown_kind")
        _schema(bool(kinds) and type(path["weight"]) is int and 1 <= path["weight"] <= 60)

    families = raw["role_families"]
    _schema(isinstance(families, list))
    for family in families:
        _schema(isinstance(family, dict) and set(family) == {"family_id", "label", "title_tokens", "required"})
        _schema(isinstance(family["family_id"], str) and _IDENTIFIER.fullmatch(family["family_id"]) is not None)
        _schema(isinstance(family["label"], str) and bool(_strings(family["title_tokens"])))
        _schema(type(family["required"]) is bool)

    levels = _strings(raw["levels"])
    _schema(all(level == level.lower() for level in levels))
    _reason_list(raw["required_signals"], frozenset({"strong", "medium"}))
    _reason_list(raw["aside_signals"], frozenset({"weak"}))

    weights = raw["weighted_signals"]
    _schema(isinstance(weights, dict))
    for code, weight in weights.items():
        _schema(isinstance(code, str) and code in REASON_CODES and REASON_CODES[code] in {"strong", "medium"})
        _schema(type(weight) is int and 0 <= weight <= 60)

    disqualifiers = raw["disqualifiers"]
    _schema(isinstance(disqualifiers, list))
    for item in disqualifiers:
        _schema(isinstance(item, dict) and set(item) == {"kind", "value"})
        _schema(item["kind"] in _DISQUALIFIER_KINDS and isinstance(item["value"], str))

    min_fit = raw.get("min_fit", 25)
    required_signal = raw.get("require_strong_or_medium", True)
    _schema(type(min_fit) is int and 0 <= min_fit <= 100 and type(required_signal) is bool)
    result = dict(raw)
    result["min_fit"] = min_fit
    result["require_strong_or_medium"] = required_signal
    return result


def canonical_bytes(spec: Mapping[str, object]) -> bytes:
    """Encode fit-spec JSON in its deterministic boundary representation."""
    return json.dumps(spec, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def fit_spec_hash(spec: Mapping[str, object]) -> str:
    """Return the SHA-256 digest of canonical fit-spec JSON."""
    return hashlib.sha256(canonical_bytes(spec)).hexdigest()


def render_fit_table(spec: Mapping[str, object]) -> Mapping[str, int | str]:
    """Return only fixed tokens and counts suitable for a VM-bound display."""
    table: dict[str, int | str] = {
        "paths": len(spec["paths"]), "role_families": len(spec["role_families"]),
        "levels": len(spec["levels"]),
        "required_signals": ",".join(sorted(spec["required_signals"])),
        "disqualifiers": len(spec["disqualifiers"]), "min_fit": int(spec["min_fit"]),
        "require_strong_or_medium": int(bool(spec["require_strong_or_medium"])),
    }
    assert_vm_safe({"kind": "stdout", "fields": table}, "stdout")
    return MappingProxyType(table)


def store_proposed(connection, campaign_id: str, spec, now: str) -> str:
    """Validate and persist a desktop-local proposed fit spec."""
    checked = validate_fit_spec(spec)
    digest = fit_spec_hash(checked)
    connection.execute(
        """INSERT INTO campaign_fit_spec(
               campaign_id,fit_spec_hash,fit_spec_json,compiled_at,approved_at,approver,state
           ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(campaign_id,fit_spec_hash) DO NOTHING""",
        (campaign_id, digest, canonical_bytes(checked).decode("utf-8"), now, None, None, "proposed"),
    )
    return digest


def has_executed_work(connection, campaign_id: str) -> bool:
    """Return whether this campaign has any work that prevents fit-spec changes."""
    row = connection.execute(
        """SELECT 1 WHERE EXISTS (
               SELECT 1 FROM credit_reservation WHERE campaign_id=?
           ) OR EXISTS (
               SELECT 1 FROM fill_firm WHERE campaign_id=?
           ) OR EXISTS (
               SELECT 1 FROM fill_discovery WHERE campaign_id=?
           ) OR EXISTS (
               SELECT 1 FROM person_affinity WHERE campaign_id=?
           ) OR EXISTS (
               SELECT 1 FROM exec_request
               WHERE json_extract(payload, '$.campaign_id')=?
           ) LIMIT 1""",
        (campaign_id, campaign_id, campaign_id, campaign_id, campaign_id),
    ).fetchone()
    return row is not None


def approve_fit_spec(connection, campaign_id: str, fit_hash: str, approver: str, now: str) -> ApproveResult:
    """Apply the two P8 policy keys only while the draft remains unexecuted."""
    row = connection.execute(
        "SELECT policy_json,policy_hash,status FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    if row is None:
        raise FitSpecError("unknown_campaign")
    if row["status"] != "draft" or has_executed_work(connection, campaign_id):
        raise FitSpecError("fit_spec_locked")
    policy = json.loads(row["policy_json"])
    policy["fit_spec_hash"] = fit_hash
    policy["copy_profile"] = dict(COPY_PROFILE_DEFAULT)
    recomputed = compile_target_policy(policy, lambda name: _resolve_company(connection, name)).policy_hash
    if recomputed != str(row["policy_hash"]):
        raise FitSpecError("policy_hash_changed")
    assert_vm_safe({"kind": "vm_policy", "fields": policy}, "vm_policy")
    connection.execute(
        "UPDATE campaign SET policy_json=?,cadence=? WHERE campaign_id=?",
        (json.dumps(policy, sort_keys=True, separators=(",", ":")),
         json.dumps(DEFAULT_CADENCE, separators=(",", ":")), campaign_id),
    )
    connection.execute(
        """UPDATE campaign_fit_spec SET state='superseded'
           WHERE campaign_id=? AND state='approved' AND fit_spec_hash<>?""", (campaign_id, fit_hash),
    )
    connection.execute(
        """UPDATE campaign_fit_spec SET state='approved',approved_at=?,approver=?
           WHERE campaign_id=? AND fit_spec_hash=?""", (now, approver, campaign_id, fit_hash),
    )
    return ApproveResult(fit_hash, str(row["policy_hash"]), str(row["policy_hash"]), len(DEFAULT_CADENCE))
