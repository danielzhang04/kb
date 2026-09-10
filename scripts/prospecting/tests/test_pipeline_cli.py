from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

import pytest

from scripts.prospecting.pipeline_cli import MAX_INPUT_BYTES, MAX_JSON_DEPTH
from scripts.prospecting.pipeline_service import PipelineService
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_pipeline_service import CAMPAIGN_ID, _seed_campaign
from scripts.prospecting.tests.test_review_app_integration import (
    _bootstrap, _request as _http_request, _start,
)


ROOT = Path(__file__).parents[3]
CANARY = "PRIVATE-CANARY-SENTINEL"
OUTPUT_FIELDS = {
    "run_id", "intake_id", "intake_revision", "intake_hash", "campaign_id",
    "campaign_policy_hash", "workflow_id", "workflow_version", "workflow_hash",
    "state", "next_stage", "pending_fields", "counts", "replayed",
}


def _paths(tmp_path: Path) -> tuple[Path, Path, dict[str, str]]:
    root = tmp_path / "local" / "kb-prospecting"
    snapshots = root / "snapshots"
    snapshots.mkdir(parents=True)
    store = root / "store.sqlite"
    connection = open_store(store)
    _seed_campaign(connection)
    assert connection.execute(
        "SELECT 1 FROM schema_migrations WHERE name='schema_p15.sql'"
    ).fetchone() is not None
    connection.close()
    environment = dict(os.environ, LOCALAPPDATA=str(tmp_path / "local"))
    return store, snapshots, environment


def _payload(
    *, request_id: str | None = None, geography: dict[str, object] | None = None,
    sector: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "request_id": request_id or str(uuid.uuid4()),
        "campaign_id": CAMPAIGN_ID,
        "as_of_date": "2026-09-09",
        "funding_stage_min": "series_a",
        "funding_stage_max": "series_c",
        "funding_window_years": 3,
        "funding_stage_interpretation": "latest_known",
        "geography": geography or {"mode": "any", "values": []},
        "sector": sector or {"mode": "any", "values": []},
        "requested_companies": 20,
        "requested_people_per_company": 2,
        "role_families": ["operations", "strategy"],
        "original_specification": f"{CANARY} original request",
        "outreach_goal": f"{CANARY} coffee chat",
    }


def _run(
    store: Path, source: Path, environment: dict[str, str], *extra: str,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable, "-B", "-m", "scripts.prospecting.pipeline_cli",
            "--store", str(store), "--input", str(source), *extra,
        ],
        cwd=ROOT, env=environment, text=True, capture_output=True, check=False,
    )


def _write(snapshots: Path, value: object, name: str = "intake.json") -> Path:
    path = snapshots / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def _write_raw(snapshots: Path, raw: bytes, name: str) -> Path:
    path = snapshots / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return path


def _assert_private_failure(result: subprocess.CompletedProcess[str], source: Path) -> str:
    assert result.returncode == 2
    assert result.stdout == ""
    assert result.stderr.startswith("pipeline_cli_error:")
    assert result.stderr.count("\n") == 1
    assert CANARY not in result.stderr
    assert str(source) not in result.stderr
    return result.stderr.removeprefix("pipeline_cli_error:").strip()


def _shared_private_root() -> Path:
    marker = ROOT / ".git"
    if marker.is_dir():
        common = marker
    else:
        pointer = marker.read_text(encoding="utf-8").strip()
        assert pointer.startswith("gitdir: ")
        git_dir = Path(pointer.removeprefix("gitdir: "))
        common_marker = git_dir / "commondir"
        common = (git_dir / common_marker.read_text(encoding="utf-8").strip()).resolve()
    return common.parent / "_private"


def test_subprocess_replay_safe_projection_and_review_ui_share_the_p15_store(
    tmp_path: Path,
) -> None:
    store, snapshots, environment = _paths(tmp_path)
    source = _write(snapshots, _payload(), "nested/intake.json")

    first = _run(store, source, environment)
    replay = _run(store, source, environment)

    assert first.returncode == replay.returncode == 0
    assert first.stderr == replay.stderr == ""
    value = json.loads(first.stdout)
    replayed = json.loads(replay.stdout)
    assert set(value) == OUTPUT_FIELDS
    assert value["replayed"] is False and replayed["replayed"] is True
    assert {**value, "replayed": True} == replayed
    assert CANARY not in first.stdout + first.stderr + replay.stdout + replay.stderr

    connection = open_store(store)
    safe = PipelineService(connection).get_safe_projection(value["run_id"])
    assert value["state"] == safe.state
    assert value["pending_fields"] == list(safe.pending_fields)
    assert value["counts"] == dict(safe.counts)
    assert value["intake_hash"] == safe.intake_hash
    connection.close()

    app = _start(store)
    cookie, _csrf = _bootstrap(app)
    try:
        status, _headers, raw = _http_request(
            app, "GET", f"/api/review?campaign_id={CAMPAIGN_ID}", cookie=cookie,
        )
        snapshot = json.loads(raw)
        assert status == 200
        assert snapshot["pipeline"]["run_id"] == value["run_id"]
        assert snapshot["pipeline"]["intake_hash"] == value["intake_hash"]
        assert snapshot["pipeline"]["state"] == value["state"]
        assert snapshot["pipeline"]["pending_fields"] == value["pending_fields"]
        assert snapshot["pipeline"]["requested_companies"] == value["counts"]["requested_companies"]
        assert snapshot["pipeline"]["requested_people_per_company"] == value["counts"]["requested_people_per_company"]
    finally:
        app.stop()


def test_unknown_any_conflict_and_fresh_process_resume(tmp_path: Path) -> None:
    store, snapshots, environment = _paths(tmp_path)
    request_id = str(uuid.uuid4())
    pending = _write(
        snapshots,
        _payload(request_id=request_id, geography={"mode": "unknown", "values": []}),
        "pending.json",
    )
    first = _run(store, pending, environment)
    resumed = _run(store, pending, environment)
    assert json.loads(first.stdout)["state"] == "input_pending"
    assert json.loads(resumed.stdout)["replayed"] is True

    conflict = _write(snapshots, _payload(request_id=request_id), "conflict.json")
    refused = _run(store, conflict, environment)
    assert _assert_private_failure(refused, conflict) == "request_conflict"

    any_scope = _write(
        snapshots,
        _payload(
            geography={"mode": "any", "values": []},
            sector={"mode": "any", "values": []},
        ),
        "any.json",
    )
    assert json.loads(_run(store, any_scope, environment).stdout)["state"] == "awaiting_research_adapter"


@pytest.mark.parametrize(
    ("name", "raw", "code"),
    [
        ("malformed", b'{"original_specification":"PRIVATE-CANARY-SENTINEL"', "input_json_invalid"),
        ("duplicate-top", b'{"PRIVATE-CANARY-SENTINEL":1,"PRIVATE-CANARY-SENTINEL":2}', "input_duplicate_key"),
        (
            "duplicate-nested",
            b'{"geography":{"mode":"any","mode":"unknown"},"canary":"PRIVATE-CANARY-SENTINEL"}',
            "input_duplicate_key",
        ),
        ("nonfinite-name", b'{"canary":"PRIVATE-CANARY-SENTINEL","value":NaN}', "input_json_invalid"),
        ("nonfinite-number", b'{"canary":"PRIVATE-CANARY-SENTINEL","value":1e999}', "input_json_invalid"),
        ("extra-top", b'{"canary":"PRIVATE-CANARY-SENTINEL"}', "input_schema_invalid"),
        (
            "extra-scope",
            json.dumps({
                **_payload(), "geography": {"mode": "any", "values": [], "extra": CANARY},
            }).encode(),
            "input_schema_invalid",
        ),
    ],
)
def test_malformed_duplicate_nonfinite_and_exact_schema_fail_privately(
    tmp_path: Path, name: str, raw: bytes, code: str,
) -> None:
    store, snapshots, environment = _paths(tmp_path)
    source = _write_raw(snapshots, raw, f"{name}.json")
    assert _assert_private_failure(_run(store, source, environment), source) == code


def test_oversized_and_excessively_deep_inputs_are_bounded_and_private(tmp_path: Path) -> None:
    store, snapshots, environment = _paths(tmp_path)
    oversized = _write_raw(
        snapshots,
        (f'{{"canary":"{CANARY}","padding":"'.encode() + b"x" * MAX_INPUT_BYTES),
        "oversized.json",
    )
    assert _assert_private_failure(_run(store, oversized, environment), oversized) == "input_too_large"

    deep_raw = b"[" * (MAX_JSON_DEPTH + 1) + json.dumps(CANARY).encode() + b"]" * (MAX_JSON_DEPTH + 1)
    deep = _write_raw(snapshots, deep_raw, "deep.json")
    assert _assert_private_failure(_run(store, deep, environment), deep) == "input_json_too_deep"


def test_invalid_input_is_validated_before_store_migration(tmp_path: Path) -> None:
    root = tmp_path / "local" / "kb-prospecting"
    snapshots = root / "snapshots"
    snapshots.mkdir(parents=True)
    store = root / "uninitialized.sqlite"
    store.write_bytes(b"")
    source = _write_raw(snapshots, f'{{"canary":"{CANARY}"'.encode(), "bad.json")
    environment = dict(os.environ, LOCALAPPDATA=str(tmp_path / "local"))

    assert _assert_private_failure(_run(store, source, environment), source) == "input_json_invalid"
    assert store.read_bytes() == b""
    assert not Path(f"{store}-wal").exists()
    assert not Path(f"{store}-shm").exists()


def test_invalid_argv_never_echoes_the_argument_canary(tmp_path: Path) -> None:
    _store, _snapshots, environment = _paths(tmp_path)
    result = subprocess.run(
        [sys.executable, "-B", "-m", "scripts.prospecting.pipeline_cli", f"--bad={CANARY}"],
        cwd=ROOT, env=environment, text=True, capture_output=True, check=False,
    )
    assert result.returncode == 2 and result.stdout == ""
    assert result.stderr == "pipeline_cli_error:invalid_arguments\n"
    assert CANARY not in result.stderr


def test_input_must_be_below_the_selected_store_snapshots_directory(tmp_path: Path) -> None:
    store, snapshots, environment = _paths(tmp_path)
    outside = _write(tmp_path, _payload(), "outside.json")
    assert _assert_private_failure(_run(store, outside, environment), outside) == "input_snapshot_required"

    nested = _write(snapshots, _payload(), "one/two/intake.json")
    assert _run(store, nested, environment).returncode == 0


def test_hardlinked_input_is_rejected(tmp_path: Path) -> None:
    store, snapshots, environment = _paths(tmp_path)
    target = _write(snapshots, _payload(), "target.json")
    hardlink = snapshots / "hardlink.json"
    try:
        os.link(target, hardlink)
    except OSError:
        pytest.skip("hardlinks unavailable")
    assert _assert_private_failure(_run(store, hardlink, environment), hardlink) == "input_invalid"


def test_symlink_or_reparse_input_is_rejected_when_supported(tmp_path: Path) -> None:
    store, snapshots, environment = _paths(tmp_path)
    target = _write(snapshots, _payload(), "target.json")
    link = snapshots / "link.json"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("file symlinks unavailable")
    assert _assert_private_failure(_run(store, link, environment), link) == "input_invalid"


def test_shared_private_store_is_allowed_but_nested_checkout_store_is_rejected(
    tmp_path: Path,
) -> None:
    shared_private = _shared_private_root()
    scratch = shared_private / "prospecting-session-delivery-20260909" / f"cli-{uuid.uuid4().hex}"
    snapshots = scratch / "snapshots"
    snapshots.mkdir(parents=True)
    store = scratch / "store.sqlite"
    connection = open_store(store)
    _seed_campaign(connection)
    connection.close()
    source = _write(snapshots, _payload())
    other_local = tmp_path / "unrelated-local"
    (other_local / "kb-prospecting").mkdir(parents=True)
    environment = dict(os.environ, LOCALAPPDATA=str(other_local))
    assert _run(store, source, environment).returncode == 0

    checkout = shared_private / "prospecting-session-delivery-20260909" / f"checkout-{uuid.uuid4().hex}"
    checkout_snapshots = checkout / "snapshots"
    checkout_snapshots.mkdir(parents=True)
    (checkout / ".git").mkdir()
    checkout_store = checkout / "store.sqlite"
    connection = open_store(checkout_store)
    _seed_campaign(connection)
    connection.close()
    checkout_source = _write(checkout_snapshots, _payload())
    result = _run(checkout_store, checkout_source, environment)
    assert _assert_private_failure(result, checkout_source) == "store_private_root_required"


def test_source_file_and_missing_store_are_rejected_without_opening(tmp_path: Path) -> None:
    _store, snapshots, environment = _paths(tmp_path)
    source = _write(snapshots, _payload())
    tracked_source = ROOT / "scripts" / "prospecting" / "schema_p15.sql"
    result = _run(tracked_source, source, environment)
    assert _assert_private_failure(result, source) == "store_invalid"

    missing = tmp_path / "local" / "kb-prospecting" / "missing.sqlite"
    result = _run(missing, source, environment)
    assert _assert_private_failure(result, source) == "store_invalid"
    assert not missing.exists()
