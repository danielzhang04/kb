"""Aggregate-only desktop-local orchestration for prospecting personalizer jobs."""

from argparse import ArgumentParser, SUPPRESS
from collections import Counter
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
from typing import Mapping
from uuid import uuid4

from scripts.prospecting.store import open_store
from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.review_qa import (
    record_revision_qa_context,
    require_revision_qa_context,
)

from . import PROMPT_VERSION
from .evidence import EvidenceRecord, list_evidence
from .model_io import sanitize_snapshot_excerpt, validate_model_response
from .qa import QaPolicy, SlotBinding, validate_revision
from .revision import RevisionInput, build_revision
from .sender_profile import SenderProfile, load_sender_profile, sender_fields
from .templates import ACTIVE_INTENTS, Template, load_registry, render, slot_inventory


ROOT = Path(__file__).parents[3]
TEMPLATE_DIRECTORY = ROOT / "orgs/prospecting/templates"
ACTIVE_FIXTURE = ROOT / "orgs/prospecting/fixtures/active-intents-20.json"
FACTUAL_SLOTS = frozenset({"first_name", "company", "role", "topic", "why_them"})
SAFE_LABEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")


@dataclass(frozen=True)
class Summary:
    run_id: str
    candidates: int
    evidence_valid: int
    revisions_created: int
    qa_passed: int
    qa_failed: int
    failure_codes: dict[str, int]
    template_versions: dict[str, int]
    prompt_version: str
    model_version: str


@dataclass(frozen=True)
class Candidate:
    person_id: str
    campaign_id: str
    first_name: str
    company: str
    role: str
    topic: str
    intent: str
    step: int
    minimum_confidence: float
    prior_evidence_ids: frozenset[str]
    evidence: tuple[EvidenceRecord, ...]


def build_parser() -> ArgumentParser:
    parser = ArgumentParser(prog="prospecting-personalizer")
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--campaign", required=True, dest="campaign_id")
    prepare.add_argument("--sender-profile", required=True, type=Path)
    prepare.add_argument("--output", required=True, type=Path)
    prepare.add_argument("--store", type=Path)
    personalize = commands.add_parser("personalize")
    personalize.add_argument("--campaign", required=True, dest="campaign_id")
    personalize.add_argument("--sender-profile", required=True, type=Path)
    personalize.add_argument("--model-response", required=True, type=Path)
    personalize.add_argument("--store", type=Path)
    personalize.add_argument("--fixture", action="store_true", help=SUPPRESS)
    return parser


def _insert_fixture_campaign(connection: sqlite3.Connection) -> None:
    connection.execute(
        """INSERT OR IGNORE INTO sender_profile(
             sender_profile_id,sender_name,sender_school,sender_focus,sender_background,
             sender_operating_proof,approved_metrics
           ) VALUES(?,?,?,?,?,?,?)""",
        ("sender-synthetic", "Example Sender", "Example University", "synthetic focus",
         "synthetic background", "synthetic proof", "[]"),
    )
    connection.execute(
        """INSERT OR IGNORE INTO campaign(
             campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
             template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
             firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,
             policy_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("campaign-p3", "networking", "sender-synthetic",
         '{"intent":"networking","step":0,"minimum_confidence":0.8,"model_version":"fixture-v1"}',
         "informational_call", 15, "warm", "fixture", "[]", "{}", "UTC", 25, 6, 2,
         "T1", "mailbox-synthetic", "{}", 0, "draft", "b" * 64),
    )


def _fixture_connection(path: Path, rows: list[dict[str, object]]) -> sqlite3.Connection:
    connection = open_store(path)
    connection.row_factory = sqlite3.Row
    _insert_fixture_campaign(connection)
    for row in rows:
        connection.execute(
            """INSERT OR IGNORE INTO person(
                 person_id,first_name,full_name,linkedin_url,location,one_line_blurb,source_lane,dedupe_key
               ) VALUES(?,?,?,?,?,?,?,?)""",
            (row["person_id"], row["first_name"], f"{row['first_name']} Synthetic", None,
             "Example", "Synthetic fixture", "manual", row["person_id"]),
        )
        if "evidence_id" in row and "evidence_claim" in row:
            connection.execute(
                """INSERT OR IGNORE INTO evidence(
                       evidence_id,person_id,claim,url,observed_at,retrieved_at,excerpt,
                       confidence,expires_at,allowed_for_copy
                   ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (row["evidence_id"], row["person_id"], row["evidence_claim"],
                 "https://example.test/source", "2026-08-20", "2026-09-01T00:00:00Z",
                 row["evidence_claim"], 0.95, "2026-10-01T00:00:00Z", 1),
            )
    connection.commit()
    return connection


def _bindings(
    candidate: Candidate,
    draft_why_them: str,
    draft_ask: str,
    evidence_ids_by_slot: Mapping[str, str],
    template: Template,
    profile: SenderProfile,
) -> dict[str, SlotBinding]:
    profile_values = sender_fields(profile)
    recipient_values = {
        "first_name": candidate.first_name,
        "company": candidate.company,
        "role": candidate.role,
        "topic": candidate.topic,
        "why_them": draft_why_them,
    }
    values: dict[str, SlotBinding] = {}
    for name in slot_inventory(template):
        if name in recipient_values:
            value = recipient_values[name]
            if not value.strip():
                raise ValueError(f"recipient_slot_missing:{name}")
            values[name] = SlotBinding(value, "evidence", evidence_ids_by_slot[name])
        elif name == "ask":
            values[name] = SlotBinding(draft_ask, "policy", "policy.ask")
        elif name in {"sender_proof", "signature"}:
            values[name] = SlotBinding(profile_values[name], "sender", f"sender.{name}")
        else:
            raise ValueError(f"slot_binding_missing:{name}")
    return values


def _personalize_one(
    connection: sqlite3.Connection,
    candidate: Candidate,
    raw_response: Mapping[str, object],
    template: Template,
    profile: SenderProfile,
    model_version: str,
    now: datetime,
) -> tuple[bool, tuple[str, ...]]:
    allowed_ids = {item.evidence_id for item in candidate.evidence}
    required_slots = set(slot_inventory(template)) & FACTUAL_SLOTS
    draft = validate_model_response(raw_response, required_slots, allowed_ids)
    binding_map = _bindings(
        candidate, draft.why_them, draft.ask, draft.evidence_ids_used, template, profile
    )
    subject, body = render(template, {name: binding.value for name, binding in binding_map.items()})
    qa_policy = QaPolicy(
        candidate.intent, candidate.step, "informational_call", 60, 120,
        candidate.minimum_confidence, candidate.prior_evidence_ids,
    )
    qa = validate_revision(
        subject, body, draft.ask, binding_map, candidate.evidence,
        qa_policy,
        candidate.person_id, candidate.campaign_id, now,
    )
    qa = replace(qa, self_critique=draft.self_critique)
    if not qa.passed:
        return False, qa.failure_codes
    recipient_points = tuple(
        binding.value for binding in binding_map.values() if binding.source_kind == "evidence"
    )
    sender_points = tuple(
        binding.value for name, binding in binding_map.items()
        if binding.source_kind == "sender" and name.startswith("sender")
    )
    ordered_evidence_ids = tuple(
        dict.fromkeys(draft.evidence_ids_used[name] for name in sorted(required_slots))
    )
    connection.execute("SAVEPOINT p3_revision_context")
    try:
        record = build_revision(
            connection,
            RevisionInput(
                candidate.person_id, candidate.campaign_id, candidate.step, subject, body,
                draft.angle, "bespoke", None, draft.ask, ordered_evidence_ids, recipient_points,
                sender_points, template.template_id, template.template_version, PROMPT_VERSION,
                model_version, qa,
            ),
        )
        if record.created:
            record_revision_qa_context(
                connection, record.revision_id, binding_map, qa_policy,
                inherited_from_revision_id=None,
                created_at=now.astimezone(UTC).isoformat(),
            )
        else:
            require_revision_qa_context(
                connection, record.revision_id, binding_map, qa_policy,
                inherited_from_revision_id=None,
            )
    except BaseException:
        connection.execute("ROLLBACK TO p3_revision_context")
        connection.execute("RELEASE p3_revision_context")
        raise
    else:
        connection.execute("RELEASE p3_revision_context")
    return record.created, ()


def run_fixture(
    path: Path,
    store_path: Path,
    sender_profile_path: Path,
    requested_intent: str | None = None,
) -> Summary:
    if requested_intent == "sales":
        raise ValueError("intent_reserved")
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ValueError("fixture_schema")
    connection = _fixture_connection(store_path, rows)
    registry = load_registry(TEMPLATE_DIRECTORY)
    profile = load_sender_profile(sender_profile_path)
    created = 0
    versions: Counter[str] = Counter()
    try:
        with connection:
            for row in rows:
                intent = row["intent"]
                if intent not in ACTIVE_INTENTS:
                    raise ValueError("intent_reserved")
                item = EvidenceRecord(
                    row["evidence_id"], row["person_id"], row["evidence_claim"],
                    "https://example.test/source", "2026-08-20", "2026-09-01T00:00:00Z",
                    row["evidence_claim"], 0.95, "2026-10-01T00:00:00Z", True,
                )
                candidate = Candidate(
                    row["person_id"], row["campaign_id"], row["first_name"], row["company"],
                    row["title"], row["title"], intent, 0, 0.8, frozenset(), (item,),
                )
                was_created, failures = _personalize_one(
                    connection, candidate, row["model_response"], registry[intent], profile,
                    "fixture-v1", datetime(2026, 9, 3, tzinfo=UTC),
                )
                if failures:
                    raise ValueError(f"fixture_qa_failed:{','.join(failures)}")
                created += int(was_created)
                versions[intent] = registry[intent].template_version
        return Summary(str(uuid4()), len(rows), len(rows), created, len(rows), 0, {},
                       dict(sorted(versions.items())), PROMPT_VERSION, "fixture-v1")
    finally:
        connection.close()


def _load_response_bundle(path: Path) -> Mapping[str, Mapping[str, object]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or set(raw) != {"responses"} or not isinstance(raw["responses"], dict):
        raise ValueError("response_bundle_schema")
    if any(not isinstance(key, str) or not isinstance(value, dict) for key, value in raw["responses"].items()):
        raise ValueError("response_bundle_schema")
    return raw["responses"]


def _campaign_policy(connection: sqlite3.Connection, campaign_id: str) -> dict[str, object]:
    row = connection.execute(
        """SELECT campaign_id,intent,ask_type,policy_json,policy_hash,status
             FROM campaign WHERE campaign_id=?""",
        (campaign_id,),
    ).fetchone()
    if row is None:
        raise ValueError("campaign_not_found")
    policy = json.loads(row["policy_json"])
    required = {"intent", "step", "minimum_confidence", "model_version"}
    if not isinstance(policy, dict) or not required <= set(policy):
        raise ValueError("campaign_policy_schema")
    if policy["intent"] not in ACTIVE_INTENTS:
        raise ValueError("intent_reserved")
    if policy["intent"] != row["intent"] or row["ask_type"] != "informational_call":
        raise ValueError("campaign_policy_scope")
    if policy["step"] not in {0, 1, 2} or not isinstance(policy["minimum_confidence"], (int, float)):
        raise ValueError("campaign_policy_schema")
    if not isinstance(policy["model_version"], str) or SAFE_LABEL.fullmatch(policy["model_version"]) is None:
        raise ValueError("campaign_policy_schema")
    return policy


def _projection(connection: sqlite3.Connection, campaign_id: str) -> list[sqlite3.Row]:
    return connection.execute(
        """SELECT tranche.person_id,tranche.first_name,tranche.company,tranche.title
           FROM person_tranche AS tranche
           JOIN eligibility_decision AS decision
             ON decision.rowid = (
                 SELECT latest.rowid
                 FROM eligibility_decision AS latest
                 WHERE latest.person_id = tranche.person_id
                   AND latest.campaign_id = tranche.campaign_id
                 ORDER BY latest.decided_at DESC, latest.rowid DESC
                 LIMIT 1
             )
           WHERE tranche.campaign_id = ?
             AND decision.outcome = 'eligible'
           ORDER BY tranche.person_id""",
        (campaign_id,),
    ).fetchall()


def _desktop_root() -> Path:
    value = os.environ.get("LOCALAPPDATA")
    if not value:
        raise ValueError("localappdata_missing")
    if value.startswith(("\\\\", "//")):
        raise ValueError("desktop_local_path_required")
    return (Path(value) / "kb-prospecting").resolve()


def _require_desktop_path(path: Path) -> Path:
    if str(path).startswith(("\\\\", "//")):
        raise ValueError("desktop_local_path_required")
    resolved = path.resolve()
    root = _desktop_root()
    if resolved != root and root not in resolved.parents:
        raise ValueError("desktop_local_path_required")
    return resolved


def _require_cli_file(path: Path, missing_code: str, unreadable_code: str) -> Path:
    resolved = _require_desktop_path(path)
    if resolved == ROOT or ROOT in resolved.parents:
        raise ValueError("desktop_local_path_required")
    if not resolved.exists():
        raise ValueError(missing_code)
    if not resolved.is_file():
        raise ValueError(unreadable_code)
    return resolved


def _failure_code(error: BaseException) -> str:
    if isinstance(error, json.JSONDecodeError):
        return "invalid_json"
    if isinstance(error, FileNotFoundError):
        return "input_missing"
    if isinstance(error, PermissionError):
        return "input_unreadable"
    if isinstance(error, sqlite3.Error):
        return "store_invalid"
    if isinstance(error, ValueError):
        code = str(error).split(":", 1)[0]
        if code in {
            "desktop_local_path_required", "localappdata_missing", "sender_profile_missing",
            "sender_profile_unreadable", "store_missing", "store_unreadable",
        }:
            return code
        if code.endswith("_not_found") or code.endswith("_id"):
            return "invalid_id"
    return "input_error"


def prepare_database_job(
    connection: sqlite3.Connection,
    campaign_id: str,
    sender_profile_path: Path,
    output_path: Path,
) -> Summary:
    policy = _campaign_policy(connection, campaign_id)
    profile = load_sender_profile(_require_desktop_path(sender_profile_path))
    rows = _projection(connection, campaign_id)
    inputs: dict[str, object] = {}
    failures: Counter[str] = Counter()
    evidence_valid = 0
    for row in rows:
        items = list_evidence(connection, row["person_id"], datetime.now(UTC))
        if not items:
            failures["evidence_missing"] += 1
            continue
        prepared_evidence: list[dict[str, object]] = []
        for item in items:
            snapshot = connection.execute(
                """SELECT body_ref FROM source_snapshot
                   WHERE source_url=? AND entity_id=? ORDER BY retrieved_at DESC LIMIT 1""",
                (item.url, item.person_id),
            ).fetchone()
            if snapshot is None:
                failures["snapshot_missing"] += 1
                continue
            body_path = _require_desktop_path(Path(snapshot["body_ref"]))
            cleaned = sanitize_snapshot_excerpt(body_path.read_text(encoding="utf-8"))
            prepared_evidence.append({
                "evidence_id": item.evidence_id,
                "claim": item.claim,
                "observed_at": item.observed_at,
                "retrieved_at": item.retrieved_at,
                "confidence": item.confidence,
                "allowed_for_copy": item.allowed_for_copy,
                "excerpt": cleaned.text,
                "snapshot_instruction_removed": cleaned.flagged,
            })
        if not prepared_evidence:
            continue
        evidence_valid += 1
        inputs[row["person_id"]] = {
            "intent": policy["intent"], "step": policy["step"],
            "first_name": row["first_name"], "company": row["company"],
            "title": row["title"], "sender": dict(sender_fields(profile)),
            "evidence": prepared_evidence,
        }
    output = _require_desktop_path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"inputs": inputs}, sort_keys=True), encoding="utf-8")
    return Summary(str(uuid4()), len(rows), evidence_valid, 0, 0, len(rows) - evidence_valid,
                   dict(sorted(failures.items())), {}, PROMPT_VERSION, policy["model_version"])


def run_database_job(
    connection: sqlite3.Connection,
    campaign_id: str,
    sender_profile_path: Path,
    response_path: Path,
) -> Summary:
    policy = _campaign_policy(connection, campaign_id)
    rows = _projection(connection, campaign_id)
    responses = _load_response_bundle(_require_desktop_path(response_path))
    registry = load_registry(TEMPLATE_DIRECTORY)
    profile = load_sender_profile(_require_desktop_path(sender_profile_path))
    failures: Counter[str] = Counter()
    evidence_valid = qa_passed = created = 0
    for row in rows:
        items = list_evidence(connection, row["person_id"], datetime.now(UTC))
        if not items:
            failures["evidence_missing"] += 1
            continue
        evidence_valid += 1
        raw_response = responses.get(row["person_id"])
        if raw_response is None:
            failures["model_response_missing"] += 1
            continue
        prior_evidence_ids: set[str] = set()
        for prior in connection.execute(
            """SELECT evidence_ids FROM revision
               WHERE person_id=? AND campaign_id=? AND step<?""",
            (row["person_id"], campaign_id, policy["step"]),
        ).fetchall():
            prior_evidence_ids.update(json.loads(prior["evidence_ids"]))
        candidate = Candidate(
            row["person_id"], campaign_id, row["first_name"], row["company"], row["title"],
            row["title"], policy["intent"], policy["step"], policy["minimum_confidence"],
            frozenset(prior_evidence_ids), items,
        )
        try:
            was_created, codes = _personalize_one(
                connection, candidate, raw_response, registry[policy["intent"]], profile,
                policy["model_version"], datetime.now(UTC),
            )
        except ValueError as error:
            failures[str(error).split(":", 1)[0]] += 1
            continue
        if codes:
            failures.update(codes)
            continue
        qa_passed += 1
        created += int(was_created)
    return Summary(str(uuid4()), len(rows), evidence_valid, created, qa_passed,
                   len(rows) - qa_passed, dict(sorted(failures.items())),
                   {policy["intent"]: registry[policy["intent"]].template_version},
                   PROMPT_VERSION, policy["model_version"])


def run_name_swap_probe(path: Path, store_path: Path, sender_profile_path: Path) -> dict[str, tuple[str, ...]]:
    fixture = json.loads(path.read_text(encoding="utf-8"))
    rows = [fixture["left"], fixture["right"]]
    connection = _fixture_connection(store_path, rows)
    profile = load_sender_profile(sender_profile_path)
    template = load_registry(TEMPLATE_DIRECTORY)["networking"]
    failures: dict[str, tuple[str, ...]] = {}
    try:
        for row in rows:
            evidence_id = f"evidence-{row['person_id']}"
            claim = f"{row['first_name']} works in operations at {row['company']}."
            item = EvidenceRecord(evidence_id, row["person_id"], claim,
                                  "https://example.test/source", "2026-08-20",
                                  "2026-09-01T00:00:00Z", claim, 0.95,
                                  "2026-10-01T00:00:00Z", True)
            candidate = Candidate(row["person_id"], "campaign-p3", row["first_name"],
                                  row["company"], "operations", "operations", "networking",
                                  0, 0.8, frozenset(), (item,))
            response = {
                "angle": "why_them", "why_them": fixture["generic_why_them"],
                "ask": "Would you have 15 minutes for an informational conversation?",
                "evidence_ids_used": {"first_name": evidence_id, "company": evidence_id,
                                        "why_them": evidence_id},
                "self_critique": "Synthetic name-swap probe.",
            }
            _, failures[row["person_id"]] = _personalize_one(
                connection, candidate, response, template, profile, "fixture-v1",
                datetime(2026, 9, 3, tzinfo=UTC),
            )
        return failures
    finally:
        connection.close()


def emit_summary(summary: Summary) -> None:
    payload = asdict(summary)
    assert_vm_safe({"kind": "stdout", "fields": payload}, "stdout")
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.store is None:
            raise ValueError("store_missing")
        store_path = _require_cli_file(args.store, "store_missing", "store_unreadable")
        sender_profile_path = _require_cli_file(
            args.sender_profile, "sender_profile_missing", "sender_profile_unreadable"
        )
        if args.command == "personalize" and args.fixture:
            summary = run_fixture(args.model_response, store_path, sender_profile_path)
            emit_summary(summary)
            return 0 if summary.qa_failed == 0 else 1
        connection = open_store(store_path)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                if args.command == "prepare":
                    summary = prepare_database_job(
                        connection, args.campaign_id, sender_profile_path, args.output
                    )
                else:
                    summary = run_database_job(
                        connection, args.campaign_id, sender_profile_path, args.model_response
                    )
        finally:
            connection.close()
        emit_summary(summary)
        return 0 if summary.qa_failed == 0 else 1
    except (OSError, ValueError, sqlite3.Error) as error:
        print(_failure_code(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
