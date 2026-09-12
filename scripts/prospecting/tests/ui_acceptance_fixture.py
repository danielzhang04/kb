"""Bounded synthetic browser-acceptance fixture CLI (not a pytest module).

``prepare --root ABSENT_DIR``: build one fresh synthetic P15-P22 selection and
selected draft, then exhaust three real repair cycles (nine synthetic
stage-adapter calls) until the item is genuinely parked, base revision unedited.
``serve --root SAME_DIR [--port N]``: validate marker and store identity
read-only, then serve the real review app on loopback for at most 20 minutes.
Stage adapters are the synthetic doubles from ``test_selected_pipeline``; no
native or network adapter, no authority, and no secret or draft text is printed.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
import threading

from scripts.prospecting.manager.campaigns import CampaignService
from scripts.prospecting.pipeline_stage_service import PipelineStageService
from scripts.prospecting.review_app import create_server
from scripts.prospecting.review_service import ReviewService
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_selected_person_source import NOW, STAMP
from scripts.prospecting.tests.test_selected_pipeline import (
    _bound,
    _run_cycle,
    _service_for,
    _stage_adapters,
)


STORE_FILENAME = "store.sqlite"
MARKER_FILENAME = "ui_acceptance_fixture.marker"
METADATA_FILENAME = "ui_acceptance_fixture.json"
MARKER_CONTENT = "PROSPECTING_UI_ACCEPTANCE_FIXTURE_V1"
EXPECTED_CYCLES = 3
EXPECTED_ADAPTER_CALLS = 9
EXPECTED_PARKED_CYCLE = EXPECTED_CYCLES - 1
SERVE_SECONDS = 20 * 60


class FixtureError(ValueError):
    """A fixed-code refusal safe to print at this command boundary."""


def _fail(code: str) -> "FixtureError":
    return FixtureError(code)


def _emit_error(code: str) -> None:
    # Fixed code only: never the underlying exception text, str(e), or a
    # traceback, so no source/draft content or driver text can ever reach
    # stdout/stderr at this boundary.
    print(json.dumps({"error": code}, sort_keys=True), file=sys.stderr)


def _trusted_root(root: Path) -> Path:
    """Resolve the fixture root once, refusing a symlink/reparse point itself.

    Parent components are resolved (an ordinary desktop path may sit under a
    linked home directory); the root itself must be a real directory so that
    every child path below is checked against a stable base.

    ``Path.is_symlink`` does not see a Windows junction (a reparse point that is
    not a symlink), so ``Path.is_junction`` -- available on Python 3.12/3.13 -- is
    also rejected explicitly when the running interpreter exposes it.
    """
    if root.is_symlink():
        raise _fail("fixture_path_untrusted")
    is_junction = getattr(root, "is_junction", None)
    if is_junction is not None and is_junction():
        raise _fail("fixture_path_untrusted")
    resolved = Path(os.path.realpath(root))
    if not resolved.is_absolute():
        raise _fail("fixture_path_untrusted")
    return resolved


def _trusted_file(root: Path, name: str, missing_code: str) -> Path:
    """One regular file directly inside the validated root, never via a link.

    This is a misdirection interlock for a trusted-local harness: it keeps a
    mistyped root or a stray link from being opened as the fixture store.  It is
    not a boundary against a hostile process running as the same user.

    As with the root, a Windows junction is rejected explicitly where
    ``Path.is_junction`` is available, since ``is_symlink`` alone would miss it.
    """
    path = root / name
    if path.is_symlink():
        raise _fail("fixture_path_untrusted")
    is_junction = getattr(path, "is_junction", None)
    if is_junction is not None and is_junction():
        raise _fail("fixture_path_untrusted")
    if not path.is_file():
        raise _fail(missing_code)
    if Path(os.path.realpath(path)) != path:
        raise _fail("fixture_path_untrusted")
    return path


def _read_only_connection(database: Path) -> sqlite3.Connection:
    """Ordinary SQLite read-only handle: no PRAGMA writes and no migration.

    Used to establish fixture identity before ``open_store`` is allowed to touch
    the file at all (``open_store`` creates directories, switches the database to
    WAL and applies/records pending schema phases).

    ``Path.as_uri`` builds the correctly percent-encoded ``file:`` URI (including
    for a path containing a space, ``#`` or non-ASCII character), so no manual
    quoting of the raw path is needed here.
    """
    uri = database.as_uri() + "?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True, timeout=5.0, isolation_level=None)
    except sqlite3.Error:
        raise _fail("fixture_store_unreadable") from None
    connection.row_factory = sqlite3.Row
    return connection


def _prepare(root: Path) -> dict[str, object]:
    if os.path.lexists(root):
        raise _fail("fixture_root_exists")
    root.mkdir(parents=True, exist_ok=False)
    root = _trusted_root(root)
    connection, source, receipt = _bound(root)
    try:
        adapters = _stage_adapters(connection, receipt.revision_id, critic="repair")
        service = _service_for(connection, adapters)
        item = service.start_from_saved_revision(
            source.campaign_id, receipt.revision_id, "uiaf-start",
        )
        parked = None
        for cycle in range(EXPECTED_CYCLES):
            parked = _run_cycle(service, item.item_id, f"uiaf-{cycle}")
        if parked is None or parked.state != "parked":
            raise _fail("fixture_exhaustion_failed")
        if parked.repair_cycle != EXPECTED_PARKED_CYCLE:
            raise _fail("fixture_exhaustion_failed")
        total_calls = sum(adapter.calls for adapter in adapters.values())
        if total_calls != EXPECTED_ADAPTER_CALLS:
            raise _fail("fixture_cycle_count_unexpected")
        metadata: dict[str, object] = {
            "marker": MARKER_CONTENT,
            "campaign_id": source.campaign_id,
            "revision_id": receipt.revision_id,
            "exhausted_item_id": item.item_id,
            "repair_cycle": parked.repair_cycle,
            "pipeline_state": parked.state,
            "cycles_run": EXPECTED_CYCLES,
            "adapter_calls": total_calls,
        }
        if source.snapshot_id:
            metadata["snapshot_id"] = source.snapshot_id
        (root / METADATA_FILENAME).write_text(
            json.dumps(metadata, sort_keys=True, separators=(",", ":")),
            encoding="utf-8",
        )
        # The store filename this tool later serves is an assumption about the
        # fixture builder, so it is confirmed before the marker is written.
        _trusted_file(root, STORE_FILENAME, "fixture_store_missing")
        (root / MARKER_FILENAME).write_text(MARKER_CONTENT, encoding="utf-8")
    finally:
        connection.close()
    return {
        "code": "fixture_prepared",
        "campaign_id": metadata["campaign_id"],
        "revision_id": metadata["revision_id"],
        "exhausted_item_id": metadata["exhausted_item_id"],
        "repair_cycle": metadata["repair_cycle"],
        "pipeline_state": metadata["pipeline_state"],
        "cycles_run": metadata["cycles_run"],
        "adapter_calls": metadata["adapter_calls"],
        **({"snapshot_id": metadata["snapshot_id"]} if "snapshot_id" in metadata else {}),
    }


def _load_metadata(root: Path) -> dict[str, object]:
    marker_path = _trusted_file(root, MARKER_FILENAME, "fixture_marker_missing")
    metadata_path = _trusted_file(root, METADATA_FILENAME, "fixture_marker_missing")
    try:
        marker = marker_path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        raise _fail("fixture_marker_missing") from None
    if marker != MARKER_CONTENT:
        raise _fail("fixture_marker_invalid")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise _fail("fixture_metadata_invalid") from None
    required = {
        "marker", "campaign_id", "revision_id", "exhausted_item_id",
        "repair_cycle", "pipeline_state", "cycles_run", "adapter_calls",
    }
    if (
        not isinstance(metadata, dict)
        or not required <= set(metadata)
        or metadata["marker"] != MARKER_CONTENT
        or any(type(metadata[key]) is not str for key in (
            "campaign_id", "revision_id", "exhausted_item_id", "pipeline_state",
        ))
        or type(metadata["repair_cycle"]) is not int
        or type(metadata["cycles_run"]) is not int
        or type(metadata["adapter_calls"]) is not int
    ):
        raise _fail("fixture_metadata_invalid")
    if (
        metadata["pipeline_state"] != "parked"
        or metadata["repair_cycle"] != EXPECTED_PARKED_CYCLE
        or metadata["cycles_run"] != EXPECTED_CYCLES
        or metadata["adapter_calls"] != EXPECTED_ADAPTER_CALLS
    ):
        raise _fail("fixture_metadata_invalid")
    return metadata


def _validate_store_identity(connection, metadata: dict[str, object]) -> None:
    """Bind the saved metadata to this exact store, without mutating it.

    The original exhausted item must still be parked at the expected cycle on the
    unedited base revision of the same campaign.  A legitimate browser edit plus
    ``start_from_human_edit`` adds a *new* item and leaves this one untouched, so
    serving after a genuine restart keeps working.
    """
    try:
        campaign = connection.execute(
            "SELECT 1 FROM campaign WHERE campaign_id=?", (metadata["campaign_id"],),
        ).fetchone()
        revision = connection.execute(
            "SELECT 1 FROM revision WHERE revision_id=? AND campaign_id=?",
            (metadata["revision_id"], metadata["campaign_id"]),
        ).fetchone()
        item = connection.execute(
            """SELECT campaign_id,base_revision_id,state,repair_cycle
                 FROM prospecting_pipeline_item WHERE item_id=?""",
            (metadata["exhausted_item_id"],),
        ).fetchone()
    except sqlite3.Error:
        # A legacy or unrelated schema carries no fixture identity and its driver
        # text is never forwarded.
        raise _fail("fixture_identity_mismatch") from None
    if campaign is None or revision is None or item is None:
        raise _fail("fixture_identity_mismatch")
    state = item["state"]
    cycle = item["repair_cycle"]
    if type(state) is not str or type(cycle) is not int:
        raise _fail("fixture_identity_mismatch")
    if (
        item["campaign_id"] != metadata["campaign_id"]
        or item["base_revision_id"] != metadata["revision_id"]
        or state != metadata["pipeline_state"]
        or state != "parked"
        or cycle != metadata["repair_cycle"]
        or cycle != EXPECTED_PARKED_CYCLE
    ):
        raise _fail("fixture_identity_mismatch")


def _serve(root: Path, port: int) -> None:
    root = _trusted_root(root)
    if not root.is_dir():
        raise _fail("fixture_marker_missing")
    metadata = _load_metadata(root)
    database = _trusted_file(root, STORE_FILENAME, "fixture_store_missing")
    # Identity first, over a read-only handle, so nothing is created, migrated or
    # switched to WAL on a path that has not been shown to be this fixture.
    before = database.stat()
    probe = _read_only_connection(database)
    try:
        _validate_store_identity(probe, metadata)
    finally:
        probe.close()
    # Reopen only the same validated local identity.
    database = _trusted_file(root, STORE_FILENAME, "fixture_store_missing")
    after = database.stat()
    if (after.st_dev, after.st_ino) != (before.st_dev, before.st_ino):
        raise _fail("fixture_store_changed")
    connection = open_store(database)
    try:
        # Re-checked on the read-write handle: if the file were swapped between
        # the probe and this open, serving is refused before any request runs.
        _validate_store_identity(connection, metadata)
        review = ReviewService(connection, now=lambda: STAMP)
        campaigns = CampaignService(connection, now=lambda: STAMP)
        editorial_pipeline = PipelineStageService(connection, now=lambda: NOW)
        server = create_server(
            review, campaigns, port=port, editorial_pipeline=editorial_pipeline,
        )
    except BaseException:
        connection.close()
        raise
    timer = threading.Timer(SERVE_SECONDS, server.shutdown)
    timer.daemon = True
    timer.start()
    try:
        print(f"http://{server.authority}/")
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        timer.cancel()
        server.server_close()
        connection.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ui_acceptance_fixture")
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--root", type=Path, required=True)
    serve_parser = subparsers.add_parser("serve")
    serve_parser.add_argument("--root", type=Path, required=True)
    serve_parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args(argv)
    if args.command == "serve" and not 1024 <= args.port <= 65535:
        _emit_error("fixture_port_invalid")
        return 2
    try:
        if args.command == "prepare":
            result = _prepare(args.root.absolute())
            print(json.dumps(result, sort_keys=True, separators=(",", ":")))
            return 0
        _serve(args.root.absolute(), args.port)
        return 0
    except FixtureError as error:
        _emit_error(str(error))
        return 2
    except Exception:
        # Never forward an unexpected exception's text: it may carry driver
        # detail or (through a service refusal) draft content.
        _emit_error("fixture_internal_error")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
