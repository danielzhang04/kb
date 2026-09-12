"""Counts-only desktop commands for manually advancing prospecting gates."""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import sqlite3
import sys
import uuid
from collections.abc import Callable, Mapping, Sequence

from scripts.prospecting import bakeoff, capture, lanes as lanes_registry, list_builder
from scripts.prospecting.executor import Executor
from scripts.prospecting.manager.compile_ask import compile_ask
from scripts.prospecting.p2_store import compile_target_policy
from scripts.prospecting.personalizer.sender_profile import SenderProfile, load_sender_profile
from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.store import open_store, resolve_store_path

from .vendors import DesktopVendorAdapter, attach_vendors, finder_defaults, selected_provider_names
from .fill import FillSummary, fill_campaign


_BUILT_IN_LANES = frozenset({"manual", "pitchbook"})
_P6_DISCOVERY_LANES = frozenset({"snov_domain"})
_KNOWN_REFUSAL_REASONS = frozenset({
    "campaign_not_draft", "fill_requires_snov_domain", "invalid_ask_file",
    "invalid_bakeoff_selection", "invalid_campaign_policy", "invalid_capture_file",
    "invalid_contacts", "invalid_fill_limits", "invalid_fill_page_limit", "invalid_lane_plan",
    "invalid_per_firm", "invalid_snov_account_credit_ceiling", "invalid_vendor_config",
    "invalid_vendor_selection", "unknown_campaign",
})


def _refusal_reason(error: ValueError) -> str:
    """Return only a fixed, approved code string for counts-only CLI output."""
    message = str(error)
    return message if message in _KNOWN_REFUSAL_REASONS else "unexpected"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _emit(fields: Mapping[str, int | str]) -> None:
    """Emit stable non-PII summaries only."""
    output = dict(fields)
    assert_vm_safe({"kind": "stdout", "fields": output}, "stdout")
    print(json.dumps(output, sort_keys=True, separators=(",", ":")))


def _desktop_ask_path(campaign_id: str) -> Path:
    # resolve_store_path is the P1 owner of the fixed LOCALAPPDATA root.
    path = resolve_store_path().parent / "asks" / f"{campaign_id}.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _vendor_config_path() -> Path:
    """The credential-free, desktop-local selection shared by operator processes."""
    return resolve_store_path().parent / "operator-vendors.json"


def _write_vendor_config(
    providers: Sequence[str], per_firm: int | None = None,
    snov_account_credit_ceiling: int | None = None, title_function_exclusions: Sequence[str] | None = None,
) -> tuple[str, ...]:
    selected = selected_provider_names(providers)
    if per_firm is not None and per_firm < 1:
        raise ValueError("invalid_per_firm")
    if snov_account_credit_ceiling is not None and snov_account_credit_ceiling < 0:
        raise ValueError("invalid_snov_account_credit_ceiling")
    aliases = dict(zip(("A", "B"), selected, strict=False)) if len(selected) == 2 else {}
    path = _vendor_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        existing = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        existing = {}
    if not isinstance(existing, dict):
        raise ValueError("invalid_vendor_config")
    payload = dict(existing)
    payload.update({"providers": list(selected), "bakeoff_aliases": aliases})
    if per_firm is not None:
        payload["per_firm"] = per_firm
    if snov_account_credit_ceiling is not None:
        payload["snov_account_credit_ceiling"] = snov_account_credit_ceiling
    if title_function_exclusions is not None:
        payload["title_function_exclusions"] = list(title_function_exclusions)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(payload, sort_keys=True, separators=(",", ":")), encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return selected


class _VendorsNotAttached(ValueError):
    pass


def _vendor_config() -> tuple[tuple[str, ...], dict[str, str], int | None]:
    try:
        payload = json.loads(_vendor_config_path().read_text(encoding="utf-8"))
        providers = selected_provider_names(tuple(payload["providers"]))
        aliases = payload["bakeoff_aliases"]
        per_firm = payload.get("per_firm")
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise _VendorsNotAttached("vendors_not_attached") from error
    if not isinstance(aliases, dict) or any(not isinstance(key, str) or not isinstance(value, str) for key, value in aliases.items()):
        raise _VendorsNotAttached("vendors_not_attached")
    if per_firm is not None and (type(per_firm) is not int or per_firm < 1):
        raise _VendorsNotAttached("vendors_not_attached")
    return providers, dict(aliases), per_firm


def _attached_providers() -> tuple[str, ...]:
    providers, _aliases, _per_firm = _vendor_config()
    return providers


class _OpaqueBakeoffAdapter:
    """Expose only an A/B participant and its aliased results to the frozen scorer."""

    def __init__(self, alias: str, adapter: DesktopVendorAdapter) -> None:
        self.provider = alias
        self._token = _opaque("bake")
        _BAKEOFF_ADAPTERS[self._token] = adapter

    @property
    def _results(self) -> dict[str, bakeoff.VendorResult]:
        return _BAKEOFF_ADAPTERS[self._token]._results

    def queue(self, *args: object, **kwargs: object) -> str:
        return _BAKEOFF_ADAPTERS[self._token].queue(*args, **kwargs)

    def close(self) -> None:
        del _BAKEOFF_ADAPTERS[self._token]


_BAKEOFF_ADAPTERS: dict[str, DesktopVendorAdapter] = {}


def _profile(path: Path | None) -> SenderProfile:
    if path is not None:
        return load_sender_profile(path)
    return SenderProfile(
        "Local operator", "", "manual prospecting", "desktop-local profile",
        "operator supplied", (),
    )


def _opaque(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def _validate_lane_plan(lanes: Sequence[str]) -> tuple[str, ...]:
    plan = tuple(lanes)
    supported = _BUILT_IN_LANES | lanes_registry.registered_lanes() | _P6_DISCOVERY_LANES
    if not plan or len(plan) != len(set(plan)) or any(lane not in supported for lane in plan):
        raise ValueError("invalid_lane_plan")
    return plan


def _lane_plan(value: str) -> tuple[str, ...]:
    plan = tuple(item.strip() for item in value.split(",") if item.strip())
    try:
        return _validate_lane_plan(plan)
    except ValueError as error:
        raise argparse.ArgumentTypeError("invalid lane plan") from error


def _resolve_company(connection: sqlite3.Connection, value: str) -> str | None:
    matches = tuple(row[0] for row in connection.execute("SELECT company_id FROM company WHERE name=?", (value,)))
    return str(matches[0]) if len(matches) == 1 else None


def _insert_campaign(connection: sqlite3.Connection, *, ask: str, sender_profile_path: Path | None, name: str | None, lanes: Sequence[str]) -> tuple[str, int, int]:
    """Compile the ask then create only a draft campaign in the migrated P1 store."""
    del name  # The immutable campaign schema has no display-name column.
    campaign_id = _opaque("camp")
    compile_campaign_id = str(uuid.uuid4())
    sender_profile_id = str(uuid.uuid4())
    mailbox_id = _opaque("pol")
    profile = _profile(sender_profile_path)
    connection.execute(
        """INSERT INTO sender_profile(
               sender_profile_id,sender_name,sender_school,sender_focus,sender_background,
               sender_operating_proof,approved_metrics
           ) VALUES(?,?,?,?,?,?,?)""",
        (
            sender_profile_id, profile.sender_name, profile.sender_school or None,
            profile.sender_focus, profile.sender_background, profile.sender_operating_proof,
            json.dumps([{"text": item.text, "evidence_id": item.evidence_id} for item in profile.approved_metrics], separators=(",", ":")),
        ),
    )

    compiled = compile_ask(
        ask, lambda value: tuple(row[0] for row in connection.execute("SELECT company_id FROM company WHERE name=?", (value,))), compile_campaign_id, sender_profile_id, mailbox_id,
        {"manual": {key: ("exact", "v1") for key in (
            "industry", "company_type", "company_stage", "company_location", "person_location",
            "title", "seniority", "school", "platform", "company_list",
        )}}, set(),
    )
    target_policy = dict(compiled.target_policy)
    target_policy["lane_plan"] = list(_validate_lane_plan(lanes))
    target = compile_target_policy(target_policy, lambda value: _resolve_company(connection, value))
    policy = dict(compiled.campaign_policy)
    policy["campaign_id"] = campaign_id
    policy["policy_hash"] = target.policy_hash
    connection.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
               template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
               firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            campaign_id, policy["intent"], sender_profile_id,
            json.dumps(target_policy, sort_keys=True, separators=(",", ":")),
            policy["ask_type"], policy["ask_minutes"], policy["tone"], policy["template_family"],
            json.dumps(policy["cadence"], separators=(",", ":")), policy["send_window"], policy["timezone"],
            policy["daily_cap"], policy["hourly_cap"], policy["firm_collision_cap"], policy["approval_tier"],
            mailbox_id, json.dumps(policy["evidence_rules"], separators=(",", ":")),
            policy["credit_budget"], policy["status"], target.policy_hash,
        ),
    )
    _desktop_ask_path(campaign_id).write_text(ask, encoding="utf-8")
    return campaign_id, 1, 1


def campaign_new(ask: str, sender_profile_path: Path | None = None, name: str | None = None, lanes: Sequence[str] = ("manual",), *, open_store_fn: Callable[[], sqlite3.Connection] = open_store) -> dict[str, int | str]:
    connection = open_store_fn()
    try:
        with connection:
            campaign_id, campaigns, policies = _insert_campaign(connection, ask=ask, sender_profile_path=sender_profile_path, name=name, lanes=lanes)
        return {"campaign_id": campaign_id, "campaigns": campaigns, "policies": policies}
    finally:
        connection.close()


def campaign_lanes(campaign_id: str, lanes: Sequence[str], *, open_store_fn: Callable[[], sqlite3.Connection] = open_store) -> dict[str, int]:
    """Replace a draft campaign's canonical target-policy lane plan."""
    plan = _validate_lane_plan(lanes)
    connection = open_store_fn()
    try:
        with connection:
            campaign = connection.execute(
                "SELECT policy_json,status FROM campaign WHERE campaign_id=?", (campaign_id,),
            ).fetchone()
            if campaign is None:
                raise ValueError("unknown_campaign")
            if campaign["status"] != "draft":
                raise ValueError("campaign_not_draft")
            target_policy = json.loads(str(campaign["policy_json"]))
            if not isinstance(target_policy, dict):
                raise ValueError("invalid_campaign_policy")
            target_policy["lane_plan"] = list(plan)
            target = compile_target_policy(
                target_policy, lambda value: _resolve_company(connection, value),
            )
            connection.execute(
                "UPDATE campaign SET policy_json=?,policy_hash=? WHERE campaign_id=?",
                (json.dumps(target_policy, sort_keys=True, separators=(",", ":")), target.policy_hash, campaign_id),
            )
        return {"campaigns": 1, "policies": 1}
    finally:
        connection.close()


def capture_add(campaign_id: str, file_path: Path, *, open_store_fn: Callable[[], sqlite3.Connection] = open_store) -> dict[str, int]:
    connection = open_store_fn()
    try:
        if connection.execute("SELECT 1 FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone() is None:
            raise ValueError("unknown_campaign")
        with file_path.open("r", encoding="utf-8", newline="") as source:
            reader = csv.DictReader(source)
            fieldnames = reader.fieldnames
            if not fieldnames:
                raise ValueError("invalid_capture_file")
            inserted = duplicates = captured = 0
            for row in reader:
                kind = str(row.get("kind", "")).strip().lower()
                prefix = "per" if kind == "person" else "cmp" if kind == "company" else "invalid"
                identifiers = iter((_opaque(prefix), _opaque("obs")))
                one = io.StringIO()
                writer = csv.DictWriter(one, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerow(row)
                one.seek(0)
                result = capture.capture_csv(connection, one, _now(), lambda: next(identifiers))
                inserted += result.inserted
                duplicates += result.duplicates
                captured += len(result.entity_ids)
        return {"captured": captured, "duplicates": duplicates, "inserted": inserted}
    finally:
        connection.close()


def bakeoff_run(campaign_id: str, contacts: int, *, open_store_fn: Callable[[], sqlite3.Connection] = open_store) -> tuple[bakeoff.BakeoffMetric, ...]:
    connection = open_store_fn()
    try:
        campaign = connection.execute("SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()
        if campaign is None:
            raise ValueError("unknown_campaign")
        rows = connection.execute(
            """SELECT p.person_id,COALESCE(e.company_id,p.person_id),cp.email
               FROM eligibility_decision ed JOIN person p ON p.person_id=ed.person_id
               LEFT JOIN employment e ON e.person_id=p.person_id AND e.valid_to IS NULL
               LEFT JOIN contact_point cp ON cp.person_id=p.person_id AND cp.state='valid'
               WHERE ed.campaign_id=? AND ed.outcome='eligible'
               ORDER BY p.person_id LIMIT ?""", (campaign_id, contacts)
        ).fetchall()
        cases = tuple(
            bakeoff.BakeoffCase(str(row[0]), str(row[1]), hashlib.sha256(str(row[2] or "").encode()).hexdigest(), "unknown")
            for row in rows
        )
        executor = Executor(connection)
        providers, aliases, _per_firm = _vendor_config()
        if len(providers) != 2 or set(aliases) != {"A", "B"} or tuple(aliases[label] for label in ("A", "B")) != providers:
            raise ValueError("invalid_bakeoff_selection")
        adapters = attach_vendors(executor, now=_now(), providers=providers)
        participants = tuple(_OpaqueBakeoffAdapter(label, adapters[aliases[label]]) for label in ("A", "B"))
        try:
            return bakeoff.run_bakeoff(
                cases, participants, executor, campaign_id=campaign_id, policy_hash=str(campaign[0]), seed=0, now=_now(),
            )
        finally:
            for participant in participants:
                participant.close()
    finally:
        connection.close()


def bakeoff_report(campaign_id: str, *, open_store_fn: Callable[[], sqlite3.Connection] = open_store) -> dict[str, int]:
    connection = open_store_fn()
    try:
        _providers, aliases, _per_firm = _vendor_config()
        if set(aliases) != {"A", "B"} or len(set(aliases.values())) != 2:
            raise ValueError("invalid_bakeoff_selection")
        rows = connection.execute(
            """SELECT pa.provider,pa.result,COUNT(*) FROM provider_attempt AS pa
               JOIN exec_request AS er ON er.request_id=pa.attempt_id
               WHERE pa.provider IN (?,?)
                 AND json_extract(er.payload,'$.campaign_id')=?
               GROUP BY pa.provider,pa.result""", (*aliases.values(), campaign_id),
        ).fetchall()
        table = {f"{provider}_attempts": 0 for provider in aliases.values()}
        alias_by_provider = {provider: alias for alias, provider in aliases.items()}
        for provider, result, count in rows:
            unmasked = aliases[alias_by_provider[str(provider)]]
            table[f"{unmasked}_{result}"] = int(count)
            table[f"{unmasked}_attempts"] += int(count)
        return table
    finally:
        connection.close()


def executor_run(*, once: bool, open_store_fn: Callable[[], sqlite3.Connection] = open_store) -> dict[str, int]:
    connection = open_store_fn()
    try:
        executor = Executor(connection)
        providers, _aliases, per_firm = _vendor_config()
        attach_vendors(executor, now=_now(), providers=providers, per_firm=per_firm)
        processed = 0
        while executor.process_one():
            processed += 1
            if once:
                break
        succeeded = int(connection.execute("SELECT COUNT(*) FROM exec_request WHERE state='succeeded'").fetchone()[0])
        rejected = int(connection.execute("SELECT COUNT(*) FROM exec_request WHERE state='rejected'").fetchone()[0])
        return {"processed": processed, "rejected": rejected, "succeeded": succeeded}
    finally:
        connection.close()


def fill_run(
    campaign_id: str, *, target_per_firm: int, max_candidates_per_firm: int = 6,
    reserve_firms: Path | None = None, min_confidence: float = 0.7, max_rounds: int = 3,
    max_pages_per_firm: int = 4,
    open_store_fn: Callable[[], sqlite3.Connection] = open_store,
) -> FillSummary:
    """Advance the email-first P6 selection loop using attached desktop adapters."""
    connection = open_store_fn()
    try:
        reserve_ids: tuple[str, ...] = ()
        if reserve_firms is not None:
            with reserve_firms.open("r", encoding="utf-8", newline="") as source:
                reserve_ids = capture.capture_csv(
                    connection, source, _now(), id_factory=lambda: "cmp_" + uuid.uuid4().hex[:16],
                ).entity_ids
        providers, _aliases, per_firm = _vendor_config()
        if "snov" not in providers:
            raise ValueError("fill_requires_snov_domain")

        def execute() -> None:
            executor = Executor(connection)
            attach_vendors(executor, now=_now(), providers=providers, per_firm=per_firm)
            while executor.process_one():
                pass

        email_adapter = DesktopVendorAdapter("snov", connection)

        def queue_email(campaign: str, person: str, policy_hash: str, request_id: str) -> None:
            email_adapter.queue(
                connection, campaign_id=campaign, person_id=person,
                policy_hash=policy_hash, request_id=request_id, now=_now(),
            )

        return fill_campaign(
            connection, campaign_id, target_per_firm=target_per_firm,
            max_candidates_per_firm=max_candidates_per_firm, min_confidence=min_confidence,
            max_rounds=max_rounds, max_pages_per_firm=max_pages_per_firm,
            reserve_company_ids=reserve_ids, execute=execute,
            queue_email=queue_email,
        )
    finally:
        connection.close()


class _SafeArgumentParser(argparse.ArgumentParser):
    """Never let argparse render user-provided values to stderr."""

    def __init__(self, *args: object, **kwargs: object) -> None:
        kwargs.setdefault("exit_on_error", False)
        super().__init__(*args, **kwargs)

    def error(self, message: str) -> None:
        match = re.search(r"(?<!\S)(--?[A-Za-z][A-Za-z0-9-]*)", message)
        raise argparse.ArgumentError(None, match.group(1) if match else "command")


def _campaign_id(value: str) -> str:
    if re.fullmatch(r"^camp_[0-9a-f]{16}$", value) is None:
        raise argparse.ArgumentTypeError("invalid campaign")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = _SafeArgumentParser(prog="py -3 -m scripts.prospecting.operator", exit_on_error=False)
    commands = parser.add_subparsers(dest="command", required=True, parser_class=_SafeArgumentParser)
    campaign = commands.add_parser("campaign").add_subparsers(dest="action", required=True, parser_class=_SafeArgumentParser)
    new = campaign.add_parser("new")
    new.add_argument("--ask-file", required=True, type=Path)
    new.add_argument("--sender-profile", type=Path)
    new.add_argument("--lanes", default=("manual",), type=_lane_plan)
    lanes = campaign.add_parser("lanes")
    lanes.add_argument("--campaign", required=True, type=_campaign_id)
    lanes.add_argument("--lanes", required=True, type=_lane_plan)
    capture_command = commands.add_parser("capture").add_subparsers(dest="action", required=True)
    add = capture_command.add_parser("add")
    add.add_argument("--campaign", required=True, type=_campaign_id)
    add.add_argument("--file", required=True, type=Path)
    vendors = commands.add_parser("vendors").add_subparsers(dest="action", required=True)
    attach = vendors.add_parser("attach")
    attach.add_argument("--providers", default="hunter,snov")
    attach.add_argument("--per-firm", type=int)
    attach.add_argument("--snov-account-credit-ceiling", type=int)
    attach.add_argument("--title-exclusions")
    bake = commands.add_parser("bakeoff").add_subparsers(dest="action", required=True)
    run = bake.add_parser("run")
    run.add_argument("--campaign", required=True, type=_campaign_id)
    run.add_argument("--contacts", required=True, type=int)
    report = bake.add_parser("report")
    report.add_argument("--campaign", required=True, type=_campaign_id)
    executor = commands.add_parser("executor").add_subparsers(dest="action", required=True)
    executor.add_parser("run").add_argument("--once", action="store_true")
    fill = commands.add_parser("fill")
    fill.add_argument("--campaign", required=True, type=_campaign_id)
    fill.add_argument("--target-per-firm", required=True, type=int)
    fill.add_argument("--max-candidates-per-firm", default=6, type=int)
    fill.add_argument("--reserve-firms", type=Path)
    fill.add_argument("--min-confidence", default=0.7, type=float)
    fill.add_argument("--max-rounds", default=3, type=int)
    fill.add_argument("--max-pages-per-firm", default=4, type=int)
    commands.add_parser("list")
    return parser


def _ask_from_file(path: Path) -> str:
    root = resolve_store_path().parent.resolve()
    candidate = path.resolve(strict=True)
    if candidate.parent != root:
        raise ValueError("invalid_ask_file")
    return candidate.read_text(encoding="utf-8")


def _option_strings(parser: argparse.ArgumentParser) -> set[str]:
    names = set(parser._option_string_actions)
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            for subparser in action.choices.values():
                names.update(_option_strings(subparser))
    return names


def _argument_name(parser: argparse.ArgumentParser, values: Sequence[str]) -> str:
    known = _option_strings(parser)
    for value in values:
        if not value.startswith("-"):
            continue
        candidate = value.split("=", 1)[0]
        matches = [name for name in known if candidate.startswith(name)]
        if matches:
            return max(matches, key=len)
    return "unknown-argument"


def _list_parser() -> argparse.ArgumentParser:
    parser = _SafeArgumentParser(prog="py -3 -m scripts.prospecting.operator list", exit_on_error=False)
    parser.add_argument("--campaign", required=True, type=_campaign_id)
    parser.add_argument("--lanes", required=True)
    parser.add_argument("--max-people", type=int)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--pitchbook-csv")
    parser.add_argument("--at")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    values = list(sys.argv[1:] if argv is None else argv)
    if values and values[0] == "list":
        # This is deliberately a direct P2 CLI pass-through; the store location is
        # resolved by the P1 owner and cannot be supplied by the operator argv.
        list_parser = _list_parser()
        try:
            list_parser.parse_args(values[1:])
        except SystemExit as error:
            if error.code == 0:
                raise
            print(f"operator: invalid arguments ({_argument_name(list_parser, values[1:])})", file=sys.stderr)
            return 2
        except argparse.ArgumentError:
            print(f"operator: invalid arguments ({_argument_name(list_parser, values[1:])})", file=sys.stderr)
            return 2
        connection = open_store()
        try:
            providers, _aliases, per_firm = _vendor_config()
            adapters = attach_vendors(Executor(connection), now=_now(), providers=providers, per_firm=per_firm)
        except _VendorsNotAttached:
            _emit({"error": "vendors_not_attached", "command": "vendors attach --providers hunter,snov"})
            return 2
        finally:
            connection.close()
        provider = providers[0]
        operation, unit_cost = finder_defaults(adapters[provider])
        return list_builder.main([
            "run", *values[1:], "--store", str(resolve_store_path()),
            "--finder-provider", provider,
            "--finder-operation", operation,
            "--finder-cost", str(unit_cost),
        ])
    parser = _parser()
    try:
        args = parser.parse_args(values)
    except SystemExit as error:
        if error.code == 0:
            raise
        print(f"operator: invalid arguments ({_argument_name(parser, values)})", file=sys.stderr)
        return 2
    except argparse.ArgumentError:
        print(f"operator: invalid arguments ({_argument_name(parser, values)})", file=sys.stderr)
        return 2
    try:
        if args.command == "fill":
            _emit(fill_run(
                args.campaign, target_per_firm=args.target_per_firm,
                max_candidates_per_firm=args.max_candidates_per_firm,
                reserve_firms=args.reserve_firms, min_confidence=args.min_confidence,
                max_rounds=args.max_rounds, max_pages_per_firm=args.max_pages_per_firm,
            ).counts())
        elif (args.command, args.action) == ("campaign", "new"):
            _emit(campaign_new(_ask_from_file(args.ask_file), args.sender_profile, lanes=args.lanes))
        elif (args.command, args.action) == ("campaign", "lanes"):
            _emit(campaign_lanes(args.campaign, args.lanes))
        elif (args.command, args.action) == ("capture", "add"):
            _emit(capture_add(args.campaign, args.file))
        elif (args.command, args.action) == ("vendors", "attach"):
            # Registration is credential-free.  Missing keys fail only when the
            # reserved executor request reaches its transport call.
            providers = _write_vendor_config(
                tuple(value.strip() for value in args.providers.split(",") if value.strip()), args.per_firm,
                args.snov_account_credit_ceiling,
                None if args.title_exclusions is None else tuple(
                    value.strip() for value in args.title_exclusions.split(",") if value.strip()
                ),
            )
            _emit({"adapters": 1, "providers": len(providers)})
        elif (args.command, args.action) == ("bakeoff", "run"):
            if args.contacts < 1:
                raise ValueError("invalid_contacts")
            metrics = bakeoff_run(args.campaign, args.contacts)
            _emit({f"{label}_attempts": metric.attempts for label, metric in zip(("A", "B"), metrics, strict=True)})
        elif (args.command, args.action) == ("bakeoff", "report"):
            _emit(bakeoff_report(args.campaign))
        elif (args.command, args.action) == ("executor", "run"):
            _emit(executor_run(once=args.once))
        else:
            raise AssertionError("unreachable_command")
    except _VendorsNotAttached:
        _emit({"error": "vendors_not_attached", "command": "vendors attach --providers hunter,snov"})
        return 2
    except ValueError as error:
        _emit({"error": "operator_refused", "reason": _refusal_reason(error)})
        return 2
    except (OSError, sqlite3.Error):
        _emit({"error": "operator_refused", "reason": "unexpected"})
        return 2
    return 0
