"""Counts-only, desktop-local command line interface for P8 affinity work."""

from __future__ import annotations

import argparse
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
import sys
import time

from scripts.prospecting.executor import Executor
from scripts.prospecting.operator.vendors import DesktopVendorAdapter, attach_vendors
from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.store import open_store, resolve_store_path

from . import as_stamp
from .anchors import anchors_path, load_anchors
from .ask_compile import compile_fit_spec
from .fill_fit import fill_campaign_fit
from .fitspec import approve_fit_spec, has_executed_work
from .research import research_run
from .score import score_campaign
from .templates_v2 import draft_campaign


_CAMPAIGN_RE = re.compile(r"camp_[0-9a-f]{16}\Z")
_FIT_HASH_RE = re.compile(r"[0-9a-f]{64}\Z")
_KNOWN_REFUSAL_REASONS = frozenset({
    "approved_fit_spec_missing", "anchors_schema", "copy_profile_missing",
    "fit_spec_locked", "fit_spec_schema", "invalid_ask_file", "invalid_fit_hash",
    "invalid_response_file", "invalid_fill_limits", "invalid_limits", "invalid_step", "invalid_arguments",
    "step_invalid", "unknown_campaign",
    "foreign_requests_queued", "policy_hash_changed", "untyped_id",
})
_REASON_CODES = (
    "shared_school", "shared_prior_employer", "path_match", "own_writing",
    "board_or_portfolio", "firm_thesis", "role_family_match", "level_match",
)


class _SafeArgumentParser(argparse.ArgumentParser):
    """Raise a fixed parse error instead of echoing operator input."""

    def __init__(self, *args, **kwargs) -> None:
        kwargs.setdefault("exit_on_error", False)
        kwargs.setdefault("add_help", False)
        super().__init__(*args, **kwargs)

    def error(self, _message: str) -> None:
        raise argparse.ArgumentError(None, "invalid_arguments")


def _campaign_id(value: str) -> str:
    if _CAMPAIGN_RE.fullmatch(value) is None:
        raise argparse.ArgumentTypeError("invalid_campaign")
    return value


def _fit_hash(value: str) -> str:
    if _FIT_HASH_RE.fullmatch(value) is None:
        raise argparse.ArgumentTypeError("invalid_fit_hash")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = _SafeArgumentParser(prog="py -3 -m scripts.prospecting.affinity")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=_SafeArgumentParser)

    ask = commands.add_parser("ask").add_subparsers(dest="action", required=True, parser_class=_SafeArgumentParser)
    compile_parser = ask.add_parser("compile")
    compile_parser.add_argument("--campaign", required=True, type=_campaign_id)
    compile_parser.add_argument("--ask-file", required=True, type=Path)
    compile_parser.add_argument("--response-file", type=Path)
    approve_parser = ask.add_parser("approve")
    approve_parser.add_argument("--campaign", required=True, type=_campaign_id)
    approve_parser.add_argument("--fit-hash", required=True, type=_fit_hash)

    research = commands.add_parser("research").add_subparsers(dest="action", required=True, parser_class=_SafeArgumentParser)
    run = research.add_parser("run")
    run.add_argument("--campaign", required=True, type=_campaign_id)
    run.add_argument("--max-linkedin", default=0, type=int)
    run.add_argument("--max-bio-pages", type=int)
    run.add_argument("--linkedin-pages-dir", type=Path)

    score = commands.add_parser("score")
    score.add_argument("--campaign", required=True, type=_campaign_id)

    fill = commands.add_parser("fill-fit")
    fill.add_argument("--campaign", required=True, type=_campaign_id)
    fill.add_argument("--target-per-firm", required=True, type=int)
    fill.add_argument("--slack", default=1, type=int)
    fill.add_argument("--min-fit", default=25, type=int)

    draft = commands.add_parser("draft")
    draft.add_argument("--campaign", required=True, type=_campaign_id)
    draft.add_argument("--step", required=True, type=int)

    listing = commands.add_parser("list")
    listing.add_argument("--fit", action="store_true", required=True)
    listing.add_argument("--campaign", required=True, type=_campaign_id)
    return parser


def _emit(fields: Mapping[str, int | str]) -> None:
    """Emit stable, PII-checked machine-readable summaries only."""
    output = dict(fields)
    assert_vm_safe({"kind": "stdout", "fields": output}, "stdout")
    print(json.dumps(output, sort_keys=True, separators=(",", ":")))


def _refusal_reason(error: ValueError) -> str:
    message = str(error)
    return message if message in _KNOWN_REFUSAL_REASONS else "value_error"


def _refusal_fields(error: ValueError) -> dict[str, str]:
    reason = _refusal_reason(error)
    if reason != "value_error":
        return {"reason": reason}
    code = str(error)[:40]
    try:
        assert_vm_safe({"kind": "stdout", "fields": {"code": code}}, "stdout")
    except ValueError:
        code = "redacted"
    return {"reason": reason, "code": code}


def _now() -> datetime:
    """Return the CLI's one UTC clock; tests replace this boundary."""
    return datetime.fromtimestamp(time.time(), timezone.utc)


def _desktop_file(path: Path, reason: str) -> Path:
    root = resolve_store_path().parent.resolve()
    try:
        candidate = path.resolve(strict=True)
    except OSError as error:
        raise ValueError(reason) from error
    if candidate.parent != root:
        raise ValueError(reason)
    return candidate


def _require_mutable(connection: sqlite3.Connection, campaign_id: str) -> None:
    row = connection.execute(
        "SELECT status FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    if row is None:
        raise ValueError("unknown_campaign")
    if row["status"] != "draft" or has_executed_work(connection, campaign_id):
        raise ValueError("fit_spec_locked")


def _list_fit(connection: sqlite3.Connection, campaign_id: str) -> dict[str, int | str]:
    bands = connection.execute(
        """SELECT
             COALESCE(SUM(score BETWEEN 0 AND 24), 0), COALESCE(SUM(score BETWEEN 25 AND 49), 0),
             COALESCE(SUM(score BETWEEN 50 AND 74), 0), COALESCE(SUM(score BETWEEN 75 AND 100), 0)
           FROM person_affinity WHERE campaign_id=?""", (campaign_id,),
    ).fetchone()
    unscored = connection.execute(
        """SELECT count(*) FROM fill_person AS fill
           WHERE fill.campaign_id=? AND NOT EXISTS (
               SELECT 1 FROM person_affinity AS affinity
               WHERE affinity.campaign_id=fill.campaign_id AND affinity.person_id=fill.person_id)""",
        (campaign_id,),
    ).fetchone()[0]
    counts = {f"reason_{code}": 0 for code in _REASON_CODES}
    for row in connection.execute(
        """SELECT json_extract(signal.value, '$.code') AS code, count(*) AS total
           FROM person_affinity AS affinity, json_each(affinity.signals_json) AS signal
           WHERE affinity.campaign_id=? GROUP BY code""", (campaign_id,)
    ):
        code = str(row["code"])
        if code in _REASON_CODES:
            counts[f"reason_{code}"] = int(row["total"])
    return {
        "campaign": campaign_id,
        "band_0_24": int(bands[0]), "band_25_49": int(bands[1]),
        "band_50_74": int(bands[2]), "band_75_100": int(bands[3]),
        "unscored": int(unscored), **counts,
    }


def main(argv: Sequence[str] | None = None) -> int:
    """Run a bounded P8 operator action and print only safe summary fields."""
    values = list(sys.argv[1:] if argv is None else argv)
    parser = _parser()
    try:
        args = parser.parse_args(values)
    except (argparse.ArgumentError, SystemExit):
        _emit({"error": "affinity_refused", "reason": "invalid_arguments"})
        return 1

    connection: sqlite3.Connection | None = None
    try:
        connection = open_store()
        now = _now()
        if (args.command, getattr(args, "action", None)) == ("ask", "compile"):
            _require_mutable(connection, args.campaign)
            ask_file = _desktop_file(args.ask_file, "invalid_ask_file")
            response = None if args.response_file is None else _desktop_file(args.response_file, "invalid_response_file")
            outcome = compile_fit_spec(connection, args.campaign, ask_file, response, as_stamp(now))
            if outcome.table is None:
                _emit({"campaign": args.campaign, "state": outcome.state, "job_written": 1})
            else:
                _emit({"campaign": args.campaign, "state": outcome.state,
                       "fit_spec_hash": str(outcome.fit_spec_hash), **dict(outcome.table)})
        elif (args.command, getattr(args, "action", None)) == ("ask", "approve"):
            _require_mutable(connection, args.campaign)
            result = approve_fit_spec(connection, args.campaign, args.fit_hash, "human:operator", as_stamp(now))
            _emit({"campaign": args.campaign, "fit_spec_hash": result.fit_spec_hash,
                   "cadence_steps": result.cadence_steps,
                   "policy_hash_unchanged": int(result.policy_hash_before == result.policy_hash_after)})
        elif (args.command, getattr(args, "action", None)) == ("research", "run"):
            linkedin_pages_dir = None
            if args.linkedin_pages_dir is not None:
                linkedin_pages_dir = _desktop_file(args.linkedin_pages_dir, "invalid_arguments")
                if not linkedin_pages_dir.is_dir():
                    raise ValueError("invalid_arguments")
            summary = research_run(connection, args.campaign, anchors=load_anchors(anchors_path()),
                                   max_bio_pages=args.max_bio_pages, max_linkedin=args.max_linkedin,
                                   now=now, executor_factory=Executor, linkedin_pages_dir=linkedin_pages_dir)
            _emit({"campaign": args.campaign, "candidates": summary.candidates,
                   "bio_pages_fetched": summary.bio_pages_fetched,
                   "linkedin_loads_used": summary.linkedin_loads_used,
                   "linkedin_operator_pages": summary.linkedin_operator_pages,
                   "researched": summary.researched, "unresearched": summary.unresearched,
                   "skipped_untyped": summary.skipped_untyped})
        elif args.command == "score":
            summary = score_campaign(connection, args.campaign, anchors=load_anchors(anchors_path()), now=as_stamp(now))
            _emit({"campaign": args.campaign, "scored": summary.scored,
                   "rewritten": summary.rewritten, "above_fit": summary.above_fit, "zeroed": summary.zeroed})
        elif args.command == "fill-fit":
            known_request_ids = {
                str(row[0]) for row in connection.execute("SELECT request_id FROM exec_request")
            }

            def execute() -> None:
                executor = Executor(connection)
                attach_vendors(executor, now=as_stamp(now))
                owned_request_ids: set[str] = set()
                while True:
                    owned_request_ids.update(
                        str(row[0]) for row in connection.execute("SELECT request_id FROM exec_request")
                        if str(row[0]) not in known_request_ids
                    )
                    queued = connection.execute(
                        "SELECT request_id FROM exec_request WHERE state='queued' ORDER BY created_at,request_id LIMIT 1"
                    ).fetchone()
                    if queued is None or str(queued["request_id"]) not in owned_request_ids:
                        return
                    executor.process_one()

            email_adapter = DesktopVendorAdapter("snov", connection)

            def queue_email(campaign: str, person: str, policy_hash: str, request_id: str) -> None:
                email_adapter.queue(
                    connection, campaign_id=campaign, person_id=person,
                    policy_hash=policy_hash, request_id=request_id, now=as_stamp(now),
                )

            summary = fill_campaign_fit(connection, args.campaign, target_per_firm=args.target_per_firm,
                                        slack=args.slack, min_fit=args.min_fit,
                                        anchors=load_anchors(anchors_path()), at=as_stamp(now),
                                        execute=execute, queue_email=queue_email)
            _emit({"campaign": args.campaign, **summary.counts()})
        elif args.command == "draft":
            summary = draft_campaign(connection, args.campaign, args.step,
                                     anchors=load_anchors(anchors_path()), now=now)
            _emit({"campaign": args.campaign, "candidates": summary.candidates,
                   "revisions_created": summary.revisions_created, "out_of_band": summary.out_of_band,
                   "qa_failed": summary.qa_failed,
                   **{f"failure_{code}": count for code, count in summary.failure_codes.items()}})
        elif args.command == "list":
            _emit(_list_fit(connection, args.campaign))
        else:
            raise ValueError("invalid_arguments")
    except ValueError as error:
        _emit({"error": "affinity_refused", **_refusal_fields(error)})
        return 1
    except (OSError, sqlite3.Error):
        _emit({"error": "affinity_refused", "reason": "unexpected"})
        return 1
    finally:
        if connection is not None:
            connection.close()
    return 0
