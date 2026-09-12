from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
from datetime import datetime, timezone

import pytest

import scripts.prospecting.pipeline_cli as pipeline_cli
from scripts.prospecting.funding_research_service import FundingResearchError
from scripts.prospecting.pipeline_cli import (
    MAX_FUNDING_IMPORT_BYTES, MAX_INPUT_BYTES, MAX_JSON_DEPTH,
    MAX_PERSON_IMPORT_BYTES, MAX_QUALIFICATION_START_BYTES, MAX_RANK_START_BYTES,
)
from scripts.prospecting.pipeline_service import PipelineService
from scripts.prospecting.person_research_service import PersonResearchService
from scripts.prospecting.qualification_service import QualificationService
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_pipeline_service import CAMPAIGN_ID, _seed_campaign
from scripts.prospecting.tests.test_review_app_integration import (
    _bootstrap, _request as _http_request, _start,
)
from scripts.prospecting.tests.test_person_research_service import (
    NOW as RESEARCH_NOW,
    STAMP as RESEARCH_STAMP,
    _person as _captured_person,
    _request as _person_service_request,
    _seed as _seed_research,
)
from scripts.prospecting.tests.test_qualification_service import (
    _Adapter as _QualificationAdapter,
    _supported_payload,
)


ROOT = Path(__file__).parents[3]
CANARY = "PRIVATE-CANARY-SENTINEL"
OUTPUT_FIELDS = {
    "run_id", "intake_id", "intake_revision", "intake_hash", "campaign_id",
    "campaign_policy_hash", "workflow_id", "workflow_version", "workflow_hash",
    "state", "next_stage", "pending_fields", "counts", "replayed",
}
FUNDING_OUTPUT_FIELDS = {
    "batch_id", "batch_hash", "run_id", "intake_hash", "state", "counts", "replayed",
}
FUNDING_PROJECTION_FIELDS = FUNDING_OUTPUT_FIELDS - {"replayed"}
PERSON_OUTPUT_FIELDS = {
    "batch_id", "batch_hash", "run_id", "intake_hash", "funding_batch_id",
    "funding_batch_hash", "state", "counts", "replayed",
}
PERSON_PROJECTION_FIELDS = PERSON_OUTPUT_FIELDS - {"replayed"}
PERSON_SCOPE_FIELDS = {
    "run_id", "intake_hash", "funding_batch_id", "funding_batch_hash",
    "state", "requested_company_cap", "companies",
}
QUALIFICATION_SCOPE_FIELDS = {
    "run_id", "intake_hash", "campaign_policy_hash", "funding_batch_id",
    "funding_batch_hash", "person_batch_id", "person_batch_hash",
    "predecessor_batch_id", "predecessor_hash", "state",
}
QUALIFICATION_OUTPUT_FIELDS = {
    "batch_id", "batch_hash", "run_id", "intake_hash", "funding_batch_id",
    "funding_batch_hash", "person_batch_id", "person_batch_hash", "state",
    "counts", "replayed",
}
QUALIFICATION_PROJECTION_FIELDS = (
    QUALIFICATION_OUTPUT_FIELDS - {"replayed"}
) | {"items"}
RANK_OUTPUT_FIELDS = {
    "batch_id", "batch_hash", "run_id", "intake_hash",
    "qualification_batch_id", "qualification_batch_hash", "state", "counts",
    "replayed",
}
RANK_PROJECTION_FIELDS = RANK_OUTPUT_FIELDS - {"replayed"}
RANK_SCOPE_FIELDS = {
    "run_id", "intake_hash", "qualification_batch_id",
    "qualification_batch_hash", "predecessor_batch_id", "predecessor_hash", "state",
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


def _run_funding(
    store: Path, source: Path, environment: dict[str, str], *extra: str,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable, "-B", "-m", "scripts.prospecting.pipeline_cli",
            "--store", str(store), "--funding-import", str(source), *extra,
        ],
        cwd=ROOT, env=environment, text=True, capture_output=True, check=False,
    )


def _run_funding_project(
    store: Path, run_id: str, environment: dict[str, str], *extra: str,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable, "-B", "-m", "scripts.prospecting.pipeline_cli",
            "--store", str(store), "--funding-project", run_id, *extra,
        ],
        cwd=ROOT, env=environment, text=True, capture_output=True, check=False,
    )


def _run_person(
    store: Path, source: Path, environment: dict[str, str], *extra: str,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable, "-B", "-m", "scripts.prospecting.pipeline_cli",
            "--store", str(store), "--person-import", str(source), *extra,
        ],
        cwd=ROOT, env=environment, text=True, capture_output=True, check=False,
    )


def _run_person_project(
    store: Path, run_id: str, environment: dict[str, str], *extra: str,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable, "-B", "-m", "scripts.prospecting.pipeline_cli",
            "--store", str(store), "--person-project", run_id, *extra,
        ],
        cwd=ROOT, env=environment, text=True, capture_output=True, check=False,
    )


def _run_person_scope(
    store: Path, run_id: str, environment: dict[str, str], *extra: str,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable, "-B", "-m", "scripts.prospecting.pipeline_cli",
            "--store", str(store), "--person-scope", run_id, *extra,
        ],
        cwd=ROOT, env=environment, text=True, capture_output=True, check=False,
    )


def _run_mode(
    store: Path, option: str, value: str | Path, environment: dict[str, str],
    *extra: str,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable, "-B", "-m", "scripts.prospecting.pipeline_cli",
            "--store", str(store), option, str(value), *extra,
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


def _funding_manifest(
    snapshots: Path, run: dict[str, object], *, request_id: str | None = None,
) -> dict[str, object]:
    captured_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    body_root = snapshots / "captures" / "public"
    body_root.mkdir(parents=True, exist_ok=True)
    (body_root / "issuer.txt").write_text(
        f"{CANARY} Example Systems announced its Series B round on March 1, 2025.",
        encoding="utf-8",
    )
    (body_root / "coverage.txt").write_text(
        f"{CANARY} bounded public news-index results for Example Systems.",
        encoding="utf-8",
    )
    return {
        "request_id": request_id or str(uuid.uuid4()),
        "run_id": run["run_id"],
        "expected_intake_hash": run["intake_hash"],
        "predecessor_batch_id": None,
        "predecessor_hash": None,
        "candidates": [{
            "name": "Example Systems",
            "website_url": "https://example.test/",
            "location": "North America",
            "sector": "Software",
            "pages": [
                {
                    "body_ref": "captures/public/issuer.txt",
                    "source_url": "https://example.test/funding",
                    "source_kind": "issuer",
                    "captured_at": captured_at,
                },
                {
                    "body_ref": "captures/public/coverage.txt",
                    "source_url": "https://news-index.test/search/example-systems",
                    "source_kind": "search_coverage",
                    "captured_at": captured_at,
                    "coverage": {
                        "query": "Example Systems latest funding",
                        "searched_at": captured_at,
                        "status": "found",
                        "result_count": 1,
                        "result_cap": 10,
                    },
                },
            ],
            "events": [{
                "page_ordinal": 0,
                "stage": "series_b",
                "announced_at": "2025-03-01",
                "excerpt": "Example Systems announced its Series B round on March 1, 2025.",
            }],
        }],
    }


def _person_manifest(
    snapshots: Path, scope: dict[str, object], *, request_id: str | None = None,
    predecessor: dict[str, object] | None = None,
) -> dict[str, object]:
    captured_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    body_root = snapshots / "captures" / "people"
    body_root.mkdir(parents=True, exist_ok=True)
    body = f"{CANARY} Avery Example is Head of Operations at Example Systems."
    (body_root / "avery.txt").write_text(body, encoding="utf-8")
    company = scope["companies"][0]
    return {
        "request_id": request_id or str(uuid.uuid4()),
        "run_id": scope["run_id"],
        "expected_intake_hash": scope["intake_hash"],
        "funding_batch_id": scope["funding_batch_id"],
        "funding_batch_hash": scope["funding_batch_hash"],
        "predecessor_batch_id": None if predecessor is None else predecessor["batch_id"],
        "predecessor_hash": None if predecessor is None else predecessor["batch_hash"],
        "research_result_ids": [company["funding_result_id"]],
        "candidates": [{
            "funding_result_id": company["funding_result_id"],
            "company_id": company["company_id"],
            "first_name": "Avery",
            "full_name": "Avery Example",
            "title": "Head of Operations",
            "profile_url": "https://profile.test/avery",
            "source_url": "https://example.test/team/avery",
            "body_ref": "captures/people/avery.txt",
            "captured_at": captured_at,
        }],
    }


def _person_cli_setup(tmp_path: Path):
    store, snapshots, environment = _paths(tmp_path)
    intake = json.loads(_run(
        store, _write(snapshots, _payload(), "people/intake.json"), environment,
    ).stdout)
    funding = _run_funding(
        store,
        _write(snapshots, _funding_manifest(snapshots, intake), "people/funding.json"),
        environment,
    )
    assert funding.returncode == 0 and funding.stderr == ""
    scoped = _run_person_scope(store, str(intake["run_id"]), environment)
    assert scoped.returncode == 0 and scoped.stderr == ""
    return store, snapshots, environment, intake, json.loads(funding.stdout), json.loads(scoped.stdout)


def _qualification_cli_setup(tmp_path: Path):
    root = tmp_path / "local" / "kb-prospecting"
    root.mkdir(parents=True)
    store = root / "store.sqlite"
    connection = open_store(store)
    started, funding, selected = _seed_research(connection, root)
    people = PersonResearchService(
        connection, now=lambda: RESEARCH_STAMP,
    ).import_current_people(_person_service_request(
        started, funding, selected, (_captured_person(root, selected),),
    ))
    connection.close()
    environment = dict(os.environ, LOCALAPPDATA=str(tmp_path / "local"))
    return store, root / "snapshots", environment, started, funding, selected, people


def _qualification_manifest(scope: dict[str, object], request_id: str | None = None):
    return {
        "request_id": request_id or str(uuid.uuid4()),
        "run_id": scope["run_id"],
        "expected_intake_hash": scope["intake_hash"],
        "funding_batch_id": scope["funding_batch_id"],
        "funding_batch_hash": scope["funding_batch_hash"],
        "person_batch_id": scope["person_batch_id"],
        "person_batch_hash": scope["person_batch_hash"],
        "predecessor_batch_id": scope["predecessor_batch_id"],
        "predecessor_hash": scope["predecessor_hash"],
    }


def _rank_manifest(
    qualification: dict[str, object], request_id: str | None = None,
    predecessor: dict[str, object] | None = None,
):
    return {
        "request_id": request_id or str(uuid.uuid4()),
        "run_id": qualification["run_id"],
        "expected_intake_hash": qualification["intake_hash"],
        "qualification_batch_id": qualification.get(
            "qualification_batch_id", qualification.get("batch_id"),
        ),
        "qualification_batch_hash": qualification.get(
            "qualification_batch_hash", qualification.get("batch_hash"),
        ),
        "predecessor_batch_id": (
            qualification.get("predecessor_batch_id")
            if predecessor is None else predecessor["batch_id"]
        ),
        "predecessor_hash": (
            qualification.get("predecessor_hash")
            if predecessor is None else predecessor["batch_hash"]
        ),
    }


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


def test_funding_import_replay_and_fresh_projection_are_safe(tmp_path: Path) -> None:
    store, snapshots, environment = _paths(tmp_path)
    intake_source = _write(snapshots, _payload(), "funding/intake.json")
    intake = json.loads(_run(store, intake_source, environment).stdout)
    manifest = _funding_manifest(snapshots, intake)
    source = _write(snapshots, manifest, "funding/import.json")

    first = _run_funding(store, source, environment)
    replay = _run_funding(store, source, environment)
    first_value = json.loads(first.stdout)

    replacement_manifest = json.loads(json.dumps(manifest))
    replacement_manifest["request_id"] = str(uuid.uuid4())
    replacement_manifest["predecessor_batch_id"] = first_value["batch_id"]
    replacement_manifest["predecessor_hash"] = first_value["batch_hash"]
    replacement_manifest["candidates"][0]["sector"] = "Infrastructure Software"
    replacement_source = _write(
        snapshots, replacement_manifest, "funding/replacement.json",
    )
    replacement = _run_funding(store, replacement_source, environment)
    late_replay = _run_funding(store, source, environment)
    projected = _run_funding_project(store, str(intake["run_id"]), environment)

    assert all(
        result.returncode == 0
        for result in (first, replay, replacement, late_replay, projected)
    )
    assert all(
        result.stderr == ""
        for result in (first, replay, replacement, late_replay, projected)
    )
    value = first_value
    replayed = json.loads(replay.stdout)
    replaced = json.loads(replacement.stdout)
    replayed_after_replacement = json.loads(late_replay.stdout)
    projection = json.loads(projected.stdout)
    assert set(value) == FUNDING_OUTPUT_FIELDS
    assert set(projection) == FUNDING_PROJECTION_FIELDS
    assert value["state"] == "awaiting_qualification_factcheck"
    assert value["counts"]["candidates"] == 1
    assert value["counts"]["provisional_matches"] == 1
    assert value["replayed"] is False and replayed["replayed"] is True
    assert {**value, "replayed": True} == replayed
    assert replayed_after_replacement == replayed
    assert replaced["batch_id"] != value["batch_id"]
    assert replaced["batch_hash"] != value["batch_hash"]
    assert projection["batch_id"] == replaced["batch_id"]
    assert projection["batch_hash"] == replaced["batch_hash"]
    assert projection["counts"] == {
        "desired_companies": intake["counts"]["requested_companies"],
        **replaced["counts"],
    }
    private_values = (
        CANARY, "Example Systems", "example.test", "Series B", "latest funding",
    )
    public_output = "".join(
        result.stdout
        for result in (first, replay, replacement, late_replay, projected)
    )
    assert all(item not in public_output for item in private_values)

    changed = json.loads(json.dumps(manifest))
    changed["candidates"][0]["sector"] = "Other"
    changed_source = _write(snapshots, changed, "funding/changed.json")
    refused = _run_funding(store, changed_source, environment)
    assert _assert_private_failure(refused, changed_source) == "request_conflict"


@pytest.mark.parametrize(
    ("name", "raw", "code"),
    [
        (
            "duplicate",
            b'{"request_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",'
            b'"request_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}',
            "funding_import_duplicate_key",
        ),
        ("nonfinite", b'{"sentinel":"PRIVATE-CANARY-SENTINEL","value":NaN}', "funding_import_json_invalid"),
        ("unknown-field", b'{"sentinel":"PRIVATE-CANARY-SENTINEL"}', "funding_import_schema_invalid"),
    ],
)
def test_funding_manifest_json_and_exact_schema_fail_privately(
    tmp_path: Path, name: str, raw: bytes, code: str,
) -> None:
    store, snapshots, environment = _paths(tmp_path)
    source = _write_raw(snapshots, raw, f"funding/{name}.json")
    assert _assert_private_failure(_run_funding(store, source, environment), source) == code


def test_funding_manifest_rejects_unknown_nested_fields(tmp_path: Path) -> None:
    store, snapshots, environment = _paths(tmp_path)
    intake = json.loads(_run(store, _write(snapshots, _payload()), environment).stdout)
    manifest = _funding_manifest(snapshots, intake)
    manifest["candidates"][0]["pages"][1]["coverage"]["sentinel"] = CANARY
    source = _write(snapshots, manifest, "funding/nested-extra.json")
    assert _assert_private_failure(
        _run_funding(store, source, environment), source,
    ) == "funding_import_schema_invalid"


def test_funding_manifest_is_bounded_and_validated_before_migration(tmp_path: Path) -> None:
    root = tmp_path / "local" / "kb-prospecting"
    snapshots = root / "snapshots"
    snapshots.mkdir(parents=True)
    store = root / "uninitialized.sqlite"
    store.write_bytes(b"")
    oversized = _write_raw(
        snapshots,
        b'{"sentinel":"PRIVATE-CANARY-SENTINEL","padding":"'
        + b"x" * MAX_FUNDING_IMPORT_BYTES,
        "funding/oversized.json",
    )
    environment = dict(os.environ, LOCALAPPDATA=str(tmp_path / "local"))

    result = _run_funding(store, oversized, environment)
    assert _assert_private_failure(result, oversized) == "funding_import_too_large"
    assert store.read_bytes() == b""
    assert not Path(f"{store}-wal").exists()
    assert not Path(f"{store}-shm").exists()


def test_funding_manifest_must_be_below_selected_store_snapshots(tmp_path: Path) -> None:
    store, snapshots, environment = _paths(tmp_path)
    intake_source = _write(snapshots, _payload(), "funding/intake.json")
    intake = json.loads(_run(store, intake_source, environment).stdout)
    manifest = _funding_manifest(snapshots, intake)

    outside = _write(tmp_path, manifest, "outside-funding.json")
    assert _assert_private_failure(
        _run_funding(store, outside, environment), outside,
    ) == "funding_import_snapshot_required"


def test_funding_referenced_body_hardlink_refusal_is_private(tmp_path: Path) -> None:
    store, snapshots, environment = _paths(tmp_path)
    intake_source = _write(snapshots, _payload(), "funding/intake.json")
    intake = json.loads(_run(store, intake_source, environment).stdout)
    manifest = _funding_manifest(snapshots, intake)
    original = snapshots / "captures" / "public" / "issuer.txt"
    linked = snapshots / "captures" / "public" / "issuer-linked.txt"
    try:
        os.link(original, linked)
    except OSError:
        pytest.skip("hardlinks unavailable")
    linked_manifest = json.loads(json.dumps(manifest))
    linked_manifest["candidates"][0]["pages"][0]["body_ref"] = (
        "captures/public/issuer-linked.txt"
    )
    source = _write(snapshots, linked_manifest, "funding/linked.json")
    assert _assert_private_failure(_run_funding(store, source, environment), source) == "source_changed"


def test_funding_project_missing_invalid_and_mutually_exclusive_modes_are_private(
    tmp_path: Path,
) -> None:
    store, snapshots, environment = _paths(tmp_path)
    invalid = _run_funding_project(store, CANARY, environment)
    assert _assert_private_failure(invalid, store) == "invalid_run_id"

    missing_run = "prun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    missing = _run_funding_project(store, missing_run, environment)
    assert _assert_private_failure(missing, store) == "run_missing"

    source = _write(snapshots, _payload(), "funding/intake.json")
    run = json.loads(_run(store, source, environment).stdout)
    no_batch = _run_funding_project(store, str(run["run_id"]), environment)
    assert _assert_private_failure(no_batch, store) == "funding_projection_missing"

    conflicting = _run(
        store, source, environment, "--funding-project", missing_run,
    )
    assert _assert_private_failure(conflicting, source) == "invalid_arguments"


def test_person_scope_import_replay_and_latest_projection_are_aggregate_safe(
    tmp_path: Path,
) -> None:
    store, snapshots, environment, intake, funding, scope = _person_cli_setup(tmp_path)
    assert set(scope) == PERSON_SCOPE_FIELDS
    assert scope["run_id"] == intake["run_id"]
    assert scope["funding_batch_id"] == funding["batch_id"]
    assert scope["funding_batch_hash"] == funding["batch_hash"]
    assert scope["state"] == "provisional_person_research_scope"
    assert scope["requested_company_cap"] == intake["counts"]["requested_companies"]
    assert len(scope["companies"]) == 1
    assert set(scope["companies"][0]) == {"ordinal", "funding_result_id", "company_id"}

    manifest = _person_manifest(snapshots, scope)
    source = _write(snapshots, manifest, "people/import.json")
    first = _run_person(store, source, environment)
    replay = _run_person(store, source, environment)
    first_value = json.loads(first.stdout)

    replacement_manifest = _person_manifest(
        snapshots, scope, request_id=str(uuid.uuid4()), predecessor=first_value,
    )
    replacement_source = _write(
        snapshots, replacement_manifest, "people/replacement.json",
    )
    replacement = _run_person(store, replacement_source, environment)
    late_replay = _run_person(store, source, environment)
    projected = _run_person_project(store, str(intake["run_id"]), environment)

    assert all(
        result.returncode == 0
        for result in (first, replay, replacement, late_replay, projected)
    )
    assert all(
        result.stderr == ""
        for result in (first, replay, replacement, late_replay, projected)
    )
    replayed = json.loads(replay.stdout)
    replaced = json.loads(replacement.stdout)
    replayed_after_replacement = json.loads(late_replay.stdout)
    projection = json.loads(projected.stdout)
    assert set(first_value) == PERSON_OUTPUT_FIELDS
    assert set(projection) == PERSON_PROJECTION_FIELDS
    assert first_value["state"] == "awaiting_person_qualification_factcheck"
    assert first_value["counts"]["imported"] == 1
    assert first_value["replayed"] is False and replayed["replayed"] is True
    assert {**first_value, "replayed": True} == replayed
    assert replayed_after_replacement == replayed
    assert replaced["batch_id"] != first_value["batch_id"]
    assert replaced["batch_hash"] != first_value["batch_hash"]
    assert projection["batch_id"] == replaced["batch_id"]
    assert projection["batch_hash"] == replaced["batch_hash"]
    assert projection["counts"] == replaced["counts"]
    private_values = (
        CANARY, "Example Systems", "Avery Example", "Head of Operations",
        "profile.test", "example.test/team", "captures/people",
    )
    public_output = json.dumps(scope) + "".join(
        result.stdout
        for result in (first, replay, replacement, late_replay, projected)
    )
    assert all(item not in public_output for item in private_values)

    changed = json.loads(json.dumps(manifest))
    changed["candidates"][0]["title"] = "Other private title"
    refused_source = _write(snapshots, changed, "people/changed.json")
    assert _assert_private_failure(
        _run_person(store, refused_source, environment), refused_source,
    ) == "request_conflict"


def test_person_scope_uses_latest_validated_funding_batch(tmp_path: Path) -> None:
    store, snapshots, environment = _paths(tmp_path)
    intake = json.loads(_run(
        store, _write(snapshots, _payload(), "people/intake.json"), environment,
    ).stdout)
    manifest = _funding_manifest(snapshots, intake)
    first = json.loads(_run_funding(
        store, _write(snapshots, manifest, "people/funding-a.json"), environment,
    ).stdout)
    replacement = json.loads(json.dumps(manifest))
    replacement["request_id"] = str(uuid.uuid4())
    replacement["predecessor_batch_id"] = first["batch_id"]
    replacement["predecessor_hash"] = first["batch_hash"]
    replacement["candidates"][0]["sector"] = "Infrastructure Software"
    second_result = _run_funding(
        store, _write(snapshots, replacement, "people/funding-b.json"), environment,
    )
    assert second_result.returncode == 0 and second_result.stderr == ""
    second = json.loads(second_result.stdout)

    scoped = _run_person_scope(store, str(intake["run_id"]), environment)
    assert scoped.returncode == 0 and scoped.stderr == ""
    value = json.loads(scoped.stdout)
    assert value["funding_batch_id"] == second["batch_id"]
    assert value["funding_batch_hash"] == second["batch_hash"]
    assert value["funding_batch_id"] != first["batch_id"]
    assert CANARY not in scoped.stdout


@pytest.mark.parametrize(
    ("name", "raw", "code"),
    (
        (
            "duplicate",
            b'{"request_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",'
            b'"request_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}',
            "person_import_duplicate_key",
        ),
        (
            "nonfinite", b'{"sentinel":"PRIVATE-CANARY-SENTINEL","value":NaN}',
            "person_import_json_invalid",
        ),
        (
            "unknown", b'{"sentinel":"PRIVATE-CANARY-SENTINEL"}',
            "person_import_schema_invalid",
        ),
    ),
)
def test_person_manifest_json_and_exact_schema_fail_privately(
    tmp_path: Path, name: str, raw: bytes, code: str,
) -> None:
    store, snapshots, environment = _paths(tmp_path)
    source = _write_raw(snapshots, raw, f"people/{name}.json")
    assert _assert_private_failure(_run_person(store, source, environment), source) == code


def test_person_manifest_nested_schema_depth_and_size_are_bounded_before_open(
    tmp_path: Path,
) -> None:
    root = tmp_path / "local" / "kb-prospecting"
    snapshots = root / "snapshots"
    snapshots.mkdir(parents=True)
    store = root / "uninitialized.sqlite"
    store.write_bytes(b"")
    environment = dict(os.environ, LOCALAPPDATA=str(tmp_path / "local"))

    oversized = _write_raw(
        snapshots,
        b'{"sentinel":"PRIVATE-CANARY-SENTINEL","padding":"'
        + b"x" * MAX_PERSON_IMPORT_BYTES,
        "people/oversized.json",
    )
    assert _assert_private_failure(
        _run_person(store, oversized, environment), oversized,
    ) == "person_import_too_large"
    assert store.read_bytes() == b""

    deep_raw = (
        b"[" * (MAX_JSON_DEPTH + 1)
        + json.dumps(CANARY).encode()
        + b"]" * (MAX_JSON_DEPTH + 1)
    )
    deep = _write_raw(snapshots, deep_raw, "people/deep.json")
    assert _assert_private_failure(
        _run_person(store, deep, environment), deep,
    ) == "person_import_json_too_deep"
    assert store.read_bytes() == b""
    assert not Path(f"{store}-wal").exists()
    assert not Path(f"{store}-shm").exists()


def test_person_manifest_requires_snapshot_containment_and_exact_nested_schema(
    tmp_path: Path,
) -> None:
    store, snapshots, environment, _intake, _funding, scope = _person_cli_setup(tmp_path)
    manifest = _person_manifest(snapshots, scope)
    manifest["candidates"][0]["sentinel"] = CANARY
    nested = _write(snapshots, manifest, "people/nested-extra.json")
    assert _assert_private_failure(
        _run_person(store, nested, environment), nested,
    ) == "person_import_schema_invalid"

    clean = _person_manifest(snapshots, scope)
    outside = _write(tmp_path, clean, "outside-person.json")
    assert _assert_private_failure(
        _run_person(store, outside, environment), outside,
    ) == "person_import_snapshot_required"


def test_person_referenced_body_hardlink_refusal_is_private(tmp_path: Path) -> None:
    store, snapshots, environment, _intake, _funding, scope = _person_cli_setup(tmp_path)
    manifest = _person_manifest(snapshots, scope)
    original = snapshots / "captures" / "people" / "avery.txt"
    linked = snapshots / "captures" / "people" / "avery-linked.txt"
    try:
        os.link(original, linked)
    except OSError:
        pytest.skip("hardlinks unavailable")
    manifest["candidates"][0]["body_ref"] = "captures/people/avery-linked.txt"
    source = _write(snapshots, manifest, "people/linked.json")
    assert _assert_private_failure(
        _run_person(store, source, environment), source,
    ) == "source_changed"


def test_person_scope_and_project_missing_invalid_and_conflicting_modes_are_private(
    tmp_path: Path,
) -> None:
    store, snapshots, environment = _paths(tmp_path)
    invalid_scope = _run_person_scope(store, CANARY, environment)
    assert _assert_private_failure(invalid_scope, store) == "invalid_run_id"
    missing_run = "prun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    missing_scope = _run_person_scope(store, missing_run, environment)
    assert _assert_private_failure(missing_scope, store) == "run_missing"

    intake = json.loads(_run(
        store, _write(snapshots, _payload(), "people/intake.json"), environment,
    ).stdout)
    no_scope = _run_person_scope(store, str(intake["run_id"]), environment)
    assert _assert_private_failure(no_scope, store) == "person_scope_missing"
    no_people = _run_person_project(store, str(intake["run_id"]), environment)
    assert _assert_private_failure(no_people, store) == "person_projection_missing"

    conflict = _run(
        store, _write(snapshots, _payload(), "people/conflict.json"), environment,
        "--person-project", str(intake["run_id"]),
    )
    assert _assert_private_failure(conflict, store) == "invalid_arguments"


def test_person_scope_translates_stale_source_without_private_projection(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, _snapshots, _environment = _paths(tmp_path)

    def stale(_service, _run_id):
        raise FundingResearchError("source_stale")

    monkeypatch.setattr(
        pipeline_cli.FundingResearchService, "get_projection", stale,
    )
    result = pipeline_cli.main([
        "--store", str(store),
        "--person-scope", "prun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ])
    captured = capsys.readouterr()
    assert result == 2
    assert captured.out == ""
    assert captured.err == "pipeline_cli_error:source_stale\n"
    assert CANARY not in captured.err


def test_qualification_scope_start_project_replay_and_source_replacement_are_safe(
    tmp_path: Path,
) -> None:
    (
        store, snapshots, environment, started, funding, selected, people,
    ) = _qualification_cli_setup(tmp_path)
    scoped = _run_mode(store, "--qualification-scope", started.run_id, environment)
    assert scoped.returncode == 0 and scoped.stderr == ""
    scope = json.loads(scoped.stdout)
    assert set(scope) == QUALIFICATION_SCOPE_FIELDS
    assert scope == {
        "run_id": started.run_id,
        "intake_hash": started.intake_hash,
        "campaign_policy_hash": started.campaign_policy_hash,
        "funding_batch_id": funding.batch_id,
        "funding_batch_hash": funding.batch_hash,
        "person_batch_id": people.batch_id,
        "person_batch_hash": people.batch_hash,
        "predecessor_batch_id": None,
        "predecessor_hash": None,
        "state": "qualification_scope_ready",
    }
    manifest = _qualification_manifest(scope)
    source = _write(snapshots, manifest, "qualification/start.json")
    first = _run_mode(store, "--qualification-start", source, environment)
    replay = _run_mode(store, "--qualification-start", source, environment)
    project = _run_mode(store, "--qualification-project", started.run_id, environment)
    assert all(value.returncode == 0 for value in (first, replay, project))
    assert all(value.stderr == "" for value in (first, replay, project))
    first_value = json.loads(first.stdout)
    replay_value = json.loads(replay.stdout)
    projected = json.loads(project.stdout)
    assert set(first_value) == QUALIFICATION_OUTPUT_FIELDS
    assert set(projected) == QUALIFICATION_PROJECTION_FIELDS
    assert first_value["state"] == "awaiting_qualification_adapter"
    assert first_value["counts"]["items"] == 1
    assert first_value["replayed"] is False
    assert replay_value == {**first_value, "replayed": True}
    assert projected["batch_id"] == first_value["batch_id"]
    assert projected["batch_hash"] == first_value["batch_hash"]
    assert len(projected["items"]) == 1
    assert set(projected["items"][0]) == {
        "item_id", "state", "candidate_count", "context_codes",
    }
    assert projected["items"][0]["item_id"].startswith("pqit_")

    connection = open_store(store)
    replacement = PersonResearchService(
        connection, now=lambda: RESEARCH_STAMP,
    ).import_current_people(_person_service_request(
        started, funding, selected,
        (_captured_person(root=store.parent, selected=selected, slug="replacement"),),
        request_id="fefefefe-fefe-4efe-8efe-fefefefefefe",
        predecessor=people,
    ))
    connection.close()
    stale = _run_mode(store, "--qualification-project", started.run_id, environment)
    assert _assert_private_failure(stale, store) == "pipeline_context_stale"
    late_replay = _run_mode(store, "--qualification-start", source, environment)
    assert late_replay.returncode == 0 and late_replay.stderr == ""
    assert json.loads(late_replay.stdout) == replay_value
    latest_scope_result = _run_mode(
        store, "--qualification-scope", started.run_id, environment,
    )
    latest_scope = json.loads(latest_scope_result.stdout)
    assert latest_scope_result.returncode == 0 and latest_scope_result.stderr == ""
    assert latest_scope["person_batch_id"] == replacement.batch_id
    assert latest_scope["person_batch_hash"] == replacement.batch_hash
    assert latest_scope["predecessor_batch_id"] == first_value["batch_id"]
    assert latest_scope["predecessor_hash"] == first_value["batch_hash"]
    private_values = (
        CANARY, "Nimbus Systems", "Avery Example", "Head of Operations",
        "profile.test", "captures/",
    )
    public = scoped.stdout + first.stdout + replay.stdout + project.stdout + late_replay.stdout
    assert all(value not in public for value in private_values)

    changed = dict(manifest)
    changed["person_batch_hash"] = "b" * 64
    refused_source = _write(snapshots, changed, "qualification/changed.json")
    refused = _run_mode(store, "--qualification-start", refused_source, environment)
    assert _assert_private_failure(refused, refused_source) == "request_conflict"


def test_completed_qualification_rank_start_project_and_exact_late_replay_are_safe(
    tmp_path: Path,
) -> None:
    (
        store, snapshots, environment, started, funding, selected, people,
    ) = _qualification_cli_setup(tmp_path)
    scope = json.loads(_run_mode(
        store, "--qualification-scope", started.run_id, environment,
    ).stdout)
    qualification_source = _write(
        snapshots, _qualification_manifest(scope), "ranking/qualification.json",
    )
    qualification_start = _run_mode(
        store, "--qualification-start", qualification_source, environment,
    )
    assert qualification_start.returncode == 0 and qualification_start.stderr == ""

    connection = open_store(store)
    qualification_service = QualificationService(
        connection,
        adapters={"qualification_factcheck": _QualificationAdapter(_supported_payload)},
        now=lambda: RESEARCH_NOW,
    )
    qualification = qualification_service.get_projection(started.run_id)
    assert qualification is not None
    for index, item in enumerate(qualification.items):
        qualification_service.run_next(
            item.item_id, f"eeeeeeee-eeee-4eee-8eee-{index:012x}",
        )
    connection.close()

    qualification_project = _run_mode(
        store, "--qualification-project", started.run_id, environment,
    )
    assert qualification_project.returncode == 0 and qualification_project.stderr == ""
    qualification_value = json.loads(qualification_project.stdout)
    assert qualification_value["state"] == "machine_reviewed"
    assert qualification_value["counts"]["machine_reviewed"] == 1

    initial_rank_scope_result = _run_mode(
        store, "--rank-scope", started.run_id, environment,
    )
    assert initial_rank_scope_result.returncode == 0
    initial_rank_scope = json.loads(initial_rank_scope_result.stdout)
    assert set(initial_rank_scope) == RANK_SCOPE_FIELDS
    assert initial_rank_scope["qualification_batch_id"] == qualification_value["batch_id"]
    assert initial_rank_scope["qualification_batch_hash"] == qualification_value["batch_hash"]
    assert initial_rank_scope["predecessor_batch_id"] is None
    assert initial_rank_scope["predecessor_hash"] is None
    rank_manifest = _rank_manifest(initial_rank_scope)
    rank_source = _write(snapshots, rank_manifest, "ranking/start.json")
    first = _run_mode(store, "--rank-start", rank_source, environment)
    replay = _run_mode(store, "--rank-start", rank_source, environment)
    project = _run_mode(store, "--rank-project", started.run_id, environment)
    assert all(value.returncode == 0 for value in (first, replay, project))
    assert all(value.stderr == "" for value in (first, replay, project))
    first_value = json.loads(first.stdout)
    replay_value = json.loads(replay.stdout)
    projected = json.loads(project.stdout)
    assert set(first_value) == RANK_OUTPUT_FIELDS
    assert set(projected) == RANK_PROJECTION_FIELDS
    assert first_value["state"] == "deterministic_role_ordered"
    assert first_value["counts"] == {
        "companies": 1, "eligible_people": 1, "selected_people": 1,
        "people_shortfall": 1, "companies_with_shortfall": 1,
    }
    assert replay_value == {**first_value, "replayed": True}
    assert projected == {key: value for key, value in first_value.items() if key != "replayed"}

    connection = open_store(store)
    replacement = PersonResearchService(
        connection, now=lambda: RESEARCH_STAMP,
    ).import_current_people(_person_service_request(
        started, funding, selected,
        (_captured_person(root=store.parent, selected=selected, slug="rank-replacement"),),
        request_id="abababab-abab-4bab-8bab-abababababab",
        predecessor=people,
    ))
    connection.close()
    stale = _run_mode(store, "--rank-project", started.run_id, environment)
    assert _assert_private_failure(stale, store) == "pipeline_context_stale"
    late_replay = _run_mode(store, "--rank-start", rank_source, environment)
    assert late_replay.returncode == 0 and late_replay.stderr == ""
    assert json.loads(late_replay.stdout) == replay_value

    qualification_scope_b_result = _run_mode(
        store, "--qualification-scope", started.run_id, environment,
    )
    assert qualification_scope_b_result.returncode == 0
    qualification_scope_b = json.loads(qualification_scope_b_result.stdout)
    assert qualification_scope_b["person_batch_id"] == replacement.batch_id
    qualification_b_source = _write(
        snapshots, _qualification_manifest(qualification_scope_b),
        "ranking/qualification-b.json",
    )
    qualification_b_start = _run_mode(
        store, "--qualification-start", qualification_b_source, environment,
    )
    assert qualification_b_start.returncode == 0 and qualification_b_start.stderr == ""
    connection = open_store(store)
    qualification_service = QualificationService(
        connection,
        adapters={"qualification_factcheck": _QualificationAdapter(_supported_payload)},
        now=lambda: RESEARCH_NOW,
    )
    qualification_b = qualification_service.get_projection(started.run_id)
    assert qualification_b is not None
    for index, item in enumerate(qualification_b.items):
        qualification_service.run_next(
            item.item_id, f"dddddddd-dddd-4ddd-8ddd-{index:012x}",
        )
    connection.close()

    rank_scope_result = _run_mode(store, "--rank-scope", started.run_id, environment)
    assert rank_scope_result.returncode == 0 and rank_scope_result.stderr == ""
    rank_scope = json.loads(rank_scope_result.stdout)
    assert set(rank_scope) == RANK_SCOPE_FIELDS
    assert rank_scope["qualification_batch_id"] == qualification_b.batch_id
    assert rank_scope["qualification_batch_hash"] == qualification_b.batch_hash
    assert rank_scope["predecessor_batch_id"] == first_value["batch_id"]
    assert rank_scope["predecessor_hash"] == first_value["batch_hash"]
    assert rank_scope["state"] == "ranking_scope_ready"
    rank_b_source = _write(
        snapshots, _rank_manifest(rank_scope), "ranking/replacement.json",
    )
    rank_b_result = _run_mode(store, "--rank-start", rank_b_source, environment)
    current_b_result = _run_mode(store, "--rank-project", started.run_id, environment)
    replay_a_again = _run_mode(store, "--rank-start", rank_source, environment)
    assert all(value.returncode == 0 for value in (
        rank_b_result, current_b_result, replay_a_again,
    ))
    rank_b = json.loads(rank_b_result.stdout)
    current_b = json.loads(current_b_result.stdout)
    assert rank_b["batch_id"] != first_value["batch_id"]
    assert current_b == {
        key: value for key, value in rank_b.items() if key != "replayed"
    }
    assert json.loads(replay_a_again.stdout) == replay_value

    connection = open_store(store)
    body_ref = connection.execute(
        """SELECT source_snapshot.body_ref
             FROM prospecting_person_candidate
             JOIN source_snapshot USING(snapshot_id)
            WHERE prospecting_person_candidate.batch_id=?""",
        (replacement.batch_id,),
    ).fetchone()[0]
    connection.close()
    (snapshots / str(body_ref)).write_text(
        f"{CANARY} changed after qualification", encoding="utf-8",
    )
    stale_scope = _run_mode(store, "--rank-scope", started.run_id, environment)
    assert _assert_private_failure(stale_scope, store) == "source_changed"

    public = (
        first.stdout + replay.stdout + project.stdout + late_replay.stdout
        + rank_scope_result.stdout + rank_b_result.stdout + current_b_result.stdout
        + replay_a_again.stdout
    )
    assert all(value not in public for value in (
        CANARY, "Nimbus Systems", "Avery Example", "Head of Operations", "profile.test",
    ))


@pytest.mark.parametrize(
    ("option", "folder", "raw", "code"),
    (
        (
            "--qualification-start", "qualification",
            b'{"request_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",'
            b'"request_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}',
            "qualification_start_duplicate_key",
        ),
        (
            "--qualification-start", "qualification",
            b'{"sentinel":"PRIVATE-CANARY-SENTINEL"}',
            "qualification_start_schema_invalid",
        ),
        (
            "--rank-start", "ranking",
            b'{"request_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",'
            b'"request_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}',
            "rank_start_duplicate_key",
        ),
        (
            "--rank-start", "ranking",
            b'{"sentinel":"PRIVATE-CANARY-SENTINEL"}',
            "rank_start_schema_invalid",
        ),
    ),
)
def test_qualification_and_rank_manifests_reject_duplicates_and_unknown_fields_privately(
    tmp_path: Path, option: str, folder: str, raw: bytes, code: str,
) -> None:
    store, snapshots, environment = _paths(tmp_path)
    source = _write_raw(snapshots, raw, f"{folder}/invalid.json")
    assert _assert_private_failure(
        _run_mode(store, option, source, environment), source,
    ) == code


@pytest.mark.parametrize(
    ("option", "limit", "code"),
    (
        ("--qualification-start", MAX_QUALIFICATION_START_BYTES, "qualification_start_too_large"),
        ("--rank-start", MAX_RANK_START_BYTES, "rank_start_too_large"),
    ),
)
def test_qualification_and_rank_manifests_are_bounded_before_store_migration(
    tmp_path: Path, option: str, limit: int, code: str,
) -> None:
    root = tmp_path / "local" / "kb-prospecting"
    snapshots = root / "snapshots"
    snapshots.mkdir(parents=True)
    store = root / "uninitialized.sqlite"
    store.write_bytes(b"")
    source = _write_raw(
        snapshots,
        b'{"sentinel":"PRIVATE-CANARY-SENTINEL","padding":"' + b"x" * limit,
        f"{option.removeprefix('--')}/oversized.json",
    )
    environment = dict(os.environ, LOCALAPPDATA=str(tmp_path / "local"))
    assert _assert_private_failure(
        _run_mode(store, option, source, environment), source,
    ) == code
    assert store.read_bytes() == b""
    assert not Path(f"{store}-wal").exists()
    assert not Path(f"{store}-shm").exists()


@pytest.mark.parametrize(
    ("option", "folder", "depth_code", "snapshot_code"),
    (
        (
            "--qualification-start", "qualification",
            "qualification_start_json_too_deep", "qualification_start_snapshot_required",
        ),
        (
            "--rank-start", "ranking",
            "rank_start_json_too_deep", "rank_start_snapshot_required",
        ),
    ),
)
def test_qualification_and_rank_manifests_enforce_depth_and_snapshot_containment(
    tmp_path: Path, option: str, folder: str, depth_code: str, snapshot_code: str,
) -> None:
    store, snapshots, environment = _paths(tmp_path)
    deep_raw = (
        b"[" * (MAX_JSON_DEPTH + 1) + json.dumps(CANARY).encode()
        + b"]" * (MAX_JSON_DEPTH + 1)
    )
    deep = _write_raw(snapshots, deep_raw, f"{folder}/deep.json")
    assert _assert_private_failure(
        _run_mode(store, option, deep, environment), deep,
    ) == depth_code
    outside = _write_raw(tmp_path, b"{}", f"outside-{folder}.json")
    assert _assert_private_failure(
        _run_mode(store, option, outside, environment), outside,
    ) == snapshot_code


def test_qualification_and_rank_modes_are_mutually_exclusive_and_missing_is_fixed(
    tmp_path: Path,
) -> None:
    store, snapshots, environment, started, _funding, _selected, _people = (
        _qualification_cli_setup(tmp_path)
    )
    missing_qualification = _run_mode(
        store, "--qualification-project", started.run_id, environment,
    )
    assert _assert_private_failure(
        missing_qualification, store,
    ) == "qualification_projection_missing"
    missing_rank = _run_mode(store, "--rank-project", started.run_id, environment)
    assert _assert_private_failure(missing_rank, store) == "qualification_missing"
    missing_rank_scope = _run_mode(store, "--rank-scope", started.run_id, environment)
    assert _assert_private_failure(missing_rank_scope, store) == "rank_scope_missing"
    source = _write(
        snapshots,
        _qualification_manifest(json.loads(_run_mode(
            store, "--qualification-scope", started.run_id, environment,
        ).stdout)),
        "qualification/conflicting.json",
    )
    conflict = _run_mode(
        store, "--qualification-start", source, environment,
        "--rank-project", started.run_id,
    )
    assert _assert_private_failure(conflict, source) == "invalid_arguments"
