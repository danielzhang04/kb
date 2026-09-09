"""P6 command-line entrypoint for staging approval batches."""
from __future__ import annotations

import argparse
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import secrets
import sqlite3
import sys

from scripts.prospecting import store
from scripts.prospecting.approval import batch


ApprovalPrOpener = Callable[[str, Path, Callable[..., object]], str]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_datetime(value: str) -> datetime:
    """Parse an ISO-8601 instant and require an explicit UTC offset."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("now_must_be_iso8601_utc") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise argparse.ArgumentTypeError("now_must_be_iso8601_utc")
    return parsed.astimezone(timezone.utc)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _staged_scope_hash(card_path: Path) -> str:
    """Extract the displayed hash without importing dashboard-only modules at startup."""
    scripts_dir = _repo_root() / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    import approvals
    import cards

    scope_json = json.loads(approvals.work_order_of(cards.parse(card_path).body))
    expected_hash = scope_json.get("approval_hash")
    if not isinstance(expected_hash, str):
        raise ValueError("scope_hash_missing")
    return expected_hash


def _approved_card_path(repo_root: Path, card_ref: str) -> Path:
    """Return the staged-card record addressed by the approval branch ref.

    ``stage_approval.stage`` creates ``approval/<card-id>`` and commits the
    canonical record at ``queue/approvals/<card-id>.md``.  Keep that mapping in
    one place so materialization verifies the committed card, never the mutable
    pre-stage draft.
    """
    prefix = "approval/"
    if not card_ref.startswith(prefix):
        raise ValueError("card_ref_invalid")
    card_id = card_ref.removeprefix(prefix)
    if not card_id or not card_id.replace("-", "").replace("_", "").isalnum():
        raise ValueError("card_ref_invalid")
    return repo_root / "queue" / "approvals" / f"{card_id}.md"


def _local_stage_opener(branch: str, _repo_root: Path, _runner: Callable[..., object]) -> str:
    """Return the branch ref after the staging primitive has committed the card.

    Publishing or opening a dashboard PR remains outside this desktop command;
    the emitted local ref is the pinned object that the dashboard later reviews.
    """
    return branch


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    approve = commands.add_parser("approve-batch")
    approve.add_argument("--store", type=Path, required=True)
    approve.add_argument("--campaign", required=True)
    approve.add_argument("--mailbox", required=True)
    approve.add_argument(
        "--now",
        type=_utc_datetime,
        help="ISO-8601 UTC time used to assemble the approval scope",
    )
    approve.add_argument("--stage-root", type=Path)
    materialize = commands.add_parser("materialize")
    materialize.add_argument("--store", type=Path, required=True)
    materialize.add_argument("--card-ref", required=True)
    materialize.add_argument("--stage-root", type=Path, required=True)
    materialize.add_argument(
        "--now", type=_utc_datetime, help="ISO-8601 UTC time used to materialize the approval"
    )
    return parser


def main(
    argv: list[str] | None = None,
    *,
    approval_pr_opener: ApprovalPrOpener | None = None,
    open_store_fn: Callable[[Path], sqlite3.Connection] = store.open_store,
    now: Callable[[], datetime] = _now,
    nonce_factory: Callable[[int], str] = secrets.token_urlsafe,
    repo_root: Path | None = None,
    emit: Callable[[str], None] = print,
) -> int:
    """Build one T1 scope, stage it, and emit only hashes plus its item count.

    Approval transport is dashboard-owned.  This command only stages a card or
    materializes a card the dashboard has pinned and signed.
    """
    args = _parser().parse_args(argv)
    current_now = args.now if args.now is not None else now()
    connection = open_store_fn(args.store)
    if args.command == "materialize":
        card_path = _approved_card_path(args.stage_root, args.card_ref)
        if not card_path.is_file():
            raise ValueError("card_not_staged")
        expected_hash = _staged_scope_hash(card_path)
        result = batch.apply_batch(
            connection, args.card_ref, card_path, args.stage_root,
            expected_hash, current_now,
        )
        emit(json.dumps({"count": len(result.ids), "scope_hash": expected_hash, "state": result.state}, sort_keys=True, separators=(",", ":")))
        return 0

    scope = batch.build_batch(
        connection,
        args.campaign,
        args.mailbox,
        now=current_now,
        nonce=nonce_factory(32),
    )
    public_summary = batch.summarize(scope)
    staged = batch.stage_scope(
        scope,
        args.stage_root or repo_root or _repo_root(),
        approval_pr_opener or _local_stage_opener,
    )
    emit(json.dumps(
        {key: public_summary[key] for key in ("count", "batch_hash", "scope_hash")}
        | {"card_ref": staged.ref, "next": "approve_in_kb_dashboard"},
        sort_keys=True,
        separators=(",", ":"),
    ))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError):
        print('{"error":"approval_failed"}')
        raise SystemExit(1) from None
