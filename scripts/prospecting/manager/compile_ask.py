from __future__ import annotations

from dataclasses import dataclass
import argparse
import hashlib
import json
from pathlib import Path
import re
import uuid
from typing import Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from scripts.prospecting.pii_guard import assert_vm_safe


class CompileError(ValueError):
    pass


INTENTS = {
    "networking": "networking-v1",
    "recruiting_live": "recruiting-live-v1",
    "curiosity": "curiosity-v1",
    "alumni": "alumni-v1",
}
PREDICATES = {
    "industry": "industry",
    "company-type": "company_type",
    "company-stage": "company_stage",
    "company-location": "company_location",
    "person-location": "person_location",
    "title": "title",
    "seniority": "seniority",
    "school": "school",
    "platform": "platform",
    "company-list": "company_list",
}
ENUMS = {
    "lane": {"manual", "pitchbook", "pdl", "class_c_public_profile", "linkedin_assisted"},
    "tone": {"direct", "warm", "formal"},
    "ask": {"informational_call", "role_conversation", "relationship", "feedback"},
}
KNOWN = {
    "intent",
    *PREDICATES,
    "lane",
    "companies-count",
    "people-count",
    "ask",
    "minutes",
    "tone",
    "credits",
    "send-window",
    "timezone",
}
FIT_PREFIXES = ("path:", "must:", "prefer:")
URL = re.compile(r"(?:https?://|www\.|linkedin\.com/)", re.I)
TOKEN = re.compile(r"([a-z][a-z-]*):([^\s]+)")
SEND_WINDOW = re.compile(r"([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d")
ASK_REF = re.compile(r"^ask-[a-z0-9-]{3,80}$")
ASK_DIRECTORY = Path("C:/kb/prospecting/asks")


@dataclass(frozen=True)
class CompiledAsk:
    target_policy: dict
    campaign_policy: dict
    vm_payload: dict
    fit_text: str = ""


def _split_fit_lines(text: str) -> tuple[str, str]:
    """Peel fit-text lines off before tokenisation; they are never key:value tokens."""
    tokens: list[str] = []
    fit: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        (fit if stripped.lower().startswith(FIT_PREFIXES) else tokens).append(stripped)
    return "\n".join(tokens), "\n".join(line for line in fit if line)


def _tokens(text: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for raw_token in text.split():
        match = TOKEN.fullmatch(raw_token.lower())
        if match is None:
            raise CompileError("free_text_rejected")
        key, value = match.groups()
        if key not in KNOWN:
            raise CompileError("unsupported_predicate")
        found[key] = value if key == "timezone" else value.lower()
    return found


def _integer(value: str, low: int, high: int, field: str) -> int:
    if not value.isdigit() or not low <= int(value) <= high:
        raise CompileError(f"invalid_{field}")
    return int(value)


def _timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError as error:
        raise CompileError("invalid_timezone") from error
    return value


def _send_window(value: str) -> str:
    match = SEND_WINDOW.fullmatch(value)
    if match is None or match.group(1) >= match.group(2):
        raise CompileError("invalid_send_window")
    return value


def compile_ask(
    text: str,
    resolve_company: Callable[[str], tuple[str, ...]],
    campaign_id: str,
    sender_profile_id: str,
    mailbox_id: str,
    capabilities: dict,
    overrides: set[tuple[str, str, str, str, str]],
) -> CompiledAsk:
    for value, field in ((campaign_id, "campaign_id"), (sender_profile_id, "sender_profile_id")):
        try:
            uuid.UUID(value)
        except ValueError as error:
            raise CompileError(f"invalid_{field}") from error

    if URL.search(text):
        raise CompileError("url_rejected")
    token_text, fit_text = _split_fit_lines(text)
    values = _tokens(token_text)
    intent = values.get("intent")
    if intent not in INTENTS:
        raise CompileError("unsupported_intent")
    lane = values.get("lane", "manual")
    if lane not in ENUMS["lane"]:
        raise CompileError("unsupported_lane")

    predicates: list[dict] = []
    for index, (key, predicate_type) in enumerate(PREDICATES.items(), 1):
        if key not in values:
            continue
        raw_value = values[key]
        if URL.search(raw_value):
            raise CompileError("url_forbidden")
        value: str | list[str] = sorted(set(raw_value.split(",")))
        if predicate_type == "company_list":
            ordered_ids = []
            for name in raw_value.replace("_", " ").split(","):
                matches = resolve_company(name)
                if len(matches) != 1:
                    raise CompileError("company_resolution_ambiguous_or_missing")
                ordered_ids.append(matches[0])
            value = ordered_ids
        capability, _version = capabilities.get(lane, {}).get(predicate_type, ("unsupported", "missing"))
        predicate_id = f"p{index:02d}-{predicate_type.replace('_', '-')}"
        if capability == "unsupported":
            raise CompileError(f"unsupported:{predicate_id}")
        predicates.append({"predicate_id": predicate_id, "type": predicate_type, "value": value})

    tone = values.get("tone", "warm")
    ask_type = values.get("ask", "informational_call")
    if tone not in ENUMS["tone"] or ask_type not in ENUMS["ask"]:
        raise CompileError("unsupported_enum")
    target = {
        "predicates": predicates,
        "requested_companies": _integer(values.get("companies-count", "20"), 1, 200, "companies_count"),
        "requested_people": _integer(values.get("people-count", "20"), 1, 400, "people_count"),
        "extra_fields": [],
        "lane_plan": [lane],
        "scorer_version": "fit-v1",
    }
    cadence = [{"step": 1, "business_day": 0}, {"step": 2, "business_day": 5}]
    policy = {
        "campaign_id": campaign_id,
        "intent": intent,
        "sender_profile_id": sender_profile_id,
        "target_policy": target,
        "ask_type": ask_type,
        "ask_minutes": _integer(values.get("minutes", "15"), 1, 20, "minutes"),
        "tone": tone,
        "template_family": INTENTS[intent],
        "cadence": cadence,
        "send_window": _send_window(values.get("send-window", "09:00-17:00")),
        "timezone": (
            _timezone(values["timezone"])
            if "timezone" in values
            else "America/New_York"
        ),
        "daily_cap": 25,
        "hourly_cap": 6,
        "firm_collision_cap": 2,
        "approval_tier": "T0",
        "mailbox_id": mailbox_id,
        "evidence_rules": {
            "allowed_kinds": ["public_professional"],
            "max_age_days": 30,
            "copy_permission": True,
            "prohibited_claims": ["sensitive_trait", "uncited_fact"],
        },
        "credit_budget": _integer(values.get("credits", "0"), 0, 100000, "credits"),
        "status": "draft",
    }
    policy["policy_hash"] = hashlib.sha256(
        json.dumps(policy, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()

    for item in predicates:
        capability, version = capabilities[lane][item["type"]]
        binding = (campaign_id, policy["policy_hash"], item["predicate_id"], lane, version)
        if capability == "approximate" and binding not in overrides:
            raise CompileError(f"human_override_required:{item['predicate_id']}")
        if capability not in {"exact", "approximate"}:
            raise CompileError("invalid_capability")

    vm = {"campaign_id": campaign_id, "target_policy": target, "campaign_policy": policy}
    assert_vm_safe({"kind": "vm_policy", "fields": vm}, "vm_policy")
    return CompiledAsk(target, policy, vm, fit_text)


def _default_capabilities() -> dict[str, dict[str, tuple[str, str]]]:
    fields = tuple(PREDICATES.values())
    return {"manual": {field: ("exact", "v1") for field in fields}}


def _runner_policy(compiled: CompiledAsk) -> dict:
    policy = compiled.campaign_policy
    return {
        "campaign_id": policy["campaign_id"],
        "policy_id": "policy-" + policy["policy_hash"][:16],
        "policy_hash": policy["policy_hash"],
        "sender_profile_id": policy["sender_profile_id"],
        "model_response": "C:/kb/prospecting/model-response.json",
        "output": "C:/kb/prospecting/prepared.json",
        "target_policy": compiled.target_policy,
    }


def _resolve_ask_ref(ask_ref: str) -> str:
    if not ASK_REF.fullmatch(ask_ref):
        raise CompileError("invalid_ask_ref")
    path = ASK_DIRECTORY / f"{ask_ref}.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CompileError("ask_ref_unresolved") from error
    if set(value) != {"ask"} or not isinstance(value["ask"], str):
        raise CompileError("ask_ref_unresolved")
    return value["ask"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ask-ref", required=True)
    parser.add_argument("--emit", choices=("vm-policy",), required=True)
    args = parser.parse_args(argv)
    ask = _resolve_ask_ref(args.ask_ref)
    campaign_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"kb:{args.ask_ref}:campaign"))
    sender_profile_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"kb:{args.ask_ref}:sender"))
    compiled = compile_ask(
        ask,
        resolve_company=lambda _name: (),
        campaign_id=campaign_id,
        sender_profile_id=sender_profile_id,
        mailbox_id="mailbox-001",
        capabilities=_default_capabilities(),
        overrides=set(),
    )
    value = _runner_policy(compiled)
    assert_vm_safe({"kind": "vm_policy", "fields": value}, "vm_policy")
    print(json.dumps(value, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
