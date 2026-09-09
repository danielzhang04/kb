"""Desktop-only, PII-safe adapter for the prospecting workflow stages.

The VM supplies opaque IDs and counts only.  This module is the sole place that
turns those IDs into desktop-local paths and real CLI argv.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from typing import Any

from scripts.prospecting.manager.jobs import OPAQUE
from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.store import resolve_store_path


JOB_FIELDS = {
    "operation", "stage_id", "attempt", "run_id", "execution_key", "policy_id",
    "policy_hash", "campaign_id", "sender_profile_id", "lanes", "model_response",
    "output", "ids", "hashes", "counts",
}
HEX64 = __import__("re").compile(r"^[0-9a-f]{64}$")


def _root() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if not local or local.startswith(("\\\\", "//")):
        raise ValueError("desktop_local_path_required")
    return (Path(local) / "kb-prospecting").resolve()


def _under_root(path: Path) -> Path:
    resolved = path.resolve()
    root = _root()
    if resolved != root and root not in resolved.parents:
        raise ValueError("desktop_local_path_required")
    return resolved


def _job(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(_under_root(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("job_invalid") from error
    if not isinstance(value, dict) or set(value) != JOB_FIELDS:
        raise ValueError("job_invalid")
    opaque = ("stage_id", "run_id", "policy_id")
    if any(not isinstance(value[key], str) or OPAQUE.fullmatch(value[key]) is None for key in opaque):
        raise ValueError("job_invalid")
    if not isinstance(value["campaign_id"], str) or not value["campaign_id"]:
        raise ValueError("job_invalid")
    if not isinstance(value["sender_profile_id"], str) or not value["sender_profile_id"]:
        raise ValueError("job_invalid")
    if not isinstance(value["operation"], str) or not isinstance(value["attempt"], int):
        raise ValueError("job_invalid")
    if any(not isinstance(value[key], str) or HEX64.fullmatch(value[key]) is None for key in ("execution_key", "policy_hash")):
        raise ValueError("job_invalid")
    if not isinstance(value["lanes"], list) or not all(item in {"manual", "pitchbook"} for item in value["lanes"]):
        raise ValueError("job_invalid")
    if not isinstance(value["ids"], list) or not isinstance(value["hashes"], list) or not isinstance(value["counts"], dict):
        raise ValueError("job_invalid")
    assert_vm_safe({"kind": "process_arguments", "fields": value}, "process_arguments")
    return value


def _store() -> Path:
    path = resolve_store_path({
        "LOCALAPPDATA": os.environ.get("LOCALAPPDATA", ""),
        "KB_PROSPECTING_STORE": os.environ.get("KB_PROSPECTING_STORE", ""),
    })
    path = _under_root(path)
    if not path.is_file():
        raise ValueError("store_missing")
    return path


def _sender_profile(job: dict[str, Any], store: Path, job_dir: Path) -> Path:
    """Materialize the profile projection from SQLite in the desktop job directory."""
    connection = sqlite3.connect(store)
    try:
        row = connection.execute(
            "SELECT sender_name,sender_school,sender_focus,sender_background,"
            "sender_operating_proof,approved_metrics FROM sender_profile WHERE sender_profile_id=?",
            (job["sender_profile_id"],),
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        raise ValueError("sender_profile_missing")
    profile = {
        "sender_name": row[0], "sender_school": row[1] or "",
        "sender_focus": row[2], "sender_background": row[3],
        "sender_operating_proof": row[4], "approved_metrics": json.loads(row[5]),
    }
    target = _under_root(job_dir / f"profile-{job['execution_key']}.json")
    target.write_text(json.dumps(profile, sort_keys=True), encoding="utf-8")
    return target


def build_argv(job: dict[str, Any], store: Path, job_dir: Path) -> list[str]:
    """Return the exact, local argv for a stage; no raw data enters it."""
    operation = job["operation"]
    if operation == "build":
        return [sys.executable, "-m", "scripts.prospecting.list_builder", "run", "--campaign", job["campaign_id"], "--lanes", ",".join(job["lanes"]), "--store", str(store)]
    if operation in {"prepare", "personalize"}:
        profile = _sender_profile(job, store, job_dir)
        flag = "--output" if operation == "prepare" else "--model-response"
        value = job["output"] if operation == "prepare" else job["model_response"]
        value_path = _under_root(Path(value))
        return [sys.executable, "-m", "scripts.prospecting.personalizer.cli", operation, "--campaign", job["campaign_id"], "--sender-profile", str(profile), flag, str(value_path), "--store", str(store)]
    if operation in {"sweep", "scan", "reconcile", "status"}:
        return [sys.executable, "-m", "scripts.prospecting.campaigner.cli", "scan" if operation == "reconcile" else operation]
    raise ValueError("operation_not_allowed")


def _inspect(job: dict[str, Any], store: Path) -> dict[str, int]:
    # Row counts and producer-owned QA data are not independent grades.  Until
    # an independent inspector adapter is configured, the workflow must park.
    raise ValueError("inspector_unavailable")


def _envelope(job: dict[str, Any], state: str, counts: dict[str, int], failures: dict[str, int] | None = None) -> dict[str, Any]:
    value = {
        "stage_id": job["stage_id"], "state": state, "ids": [job["stage_id"] + "-result"],
        "counts": {key: int(number) for key, number in counts.items() if type(number) is int and number >= 0},
        "hashes": [hashlib.sha256(json.dumps(counts, sort_keys=True).encode()).hexdigest()],
        "failure_codes": failures or {}, "attempt": job["attempt"],
    }
    assert_vm_safe({"kind": "process_results", "fields": value}, "process_results")
    return value


def _cached(job_path: Path, key: str) -> Path:
    return job_path.with_name(f"result-{key}.json")


def run(job_path: Path) -> dict[str, Any]:
    job = _job(job_path)
    cache = _cached(job_path, job["execution_key"])
    if cache.exists():
        value = json.loads(cache.read_text(encoding="utf-8"))
        assert_vm_safe({"kind": "process_results", "fields": value}, "process_results")
        return value
    try:
        store = _store()
        if job["operation"] == "grade":
            result = _envelope(job, "complete", _inspect(job, store))
        else:
            argv = build_argv(job, store, job_path.parent)
            child = subprocess.run(argv, text=True, capture_output=True, check=False, env={**os.environ, "KB_PROSPECTING_NO_NETWORK": "1"})
            assert_vm_safe({"kind": "process_results", "fields": {"stdout": child.stdout, "stderr": child.stderr}}, "process_results")
            if child.returncode:
                result = _envelope(job, "failed", {}, {"adapter_failed": 1})
            else:
                raw = json.loads(child.stdout)
                if not isinstance(raw, dict):
                    raise ValueError("summary_invalid")
                result = _envelope(job, "complete", {key: value for key, value in raw.items() if type(value) is int})
    except Exception as error:
        failure = (
            "inspector_unavailable"
            if str(error) == "inspector_unavailable"
            else "adapter_failed"
        )
        result = _envelope(job, "failed", {}, {failure: 1})
    cache.write_text(json.dumps(result, sort_keys=True, separators=(",", ":")), encoding="utf-8")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True, type=Path)
    args = parser.parse_args(argv)
    print(json.dumps(run(args.job), sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    main()
