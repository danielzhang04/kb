"""Desktop-only, PII-safe adapter for the prospecting workflow stages.

The VM supplies opaque IDs and counts only.  This module is the sole place that
turns those IDs into desktop-local paths and real CLI argv.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
from typing import Any

from scripts.prospecting.manager.bindings import (
    DESKTOP_FAILURE_CODES,
    command_digest,
)
from scripts.prospecting.manager.bridge import (
    _link_or_reparse,
    _require_plain_directory_tree,
    read_bounded_output,
    terminate_windows_tree,
)
from scripts.prospecting.manager.jobs import OPAQUE
from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.store import resolve_store_path


JOB_FIELDS = {
    "operation", "stage_id", "attempt", "run_id", "execution_key", "policy_id",
    "policy_hash", "campaign_id", "sender_profile_id", "lanes", "model_response",
    "output", "ids", "hashes", "counts", "command_digest",
}
HEX64 = __import__("re").compile(r"^[0-9a-f]{64}$")
CHILD_TIMEOUT_SECONDS = 120


@dataclass(frozen=True)
class _OwnedProfile:
    path: Path
    identity: tuple[int, int, int, int]


class _ChildFailure(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _identity(info: os.stat_result) -> tuple[int, int, int, int]:
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


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
    if (
        not isinstance(value["operation"], str)
        or type(value["attempt"]) is not int
        or not 1 <= value["attempt"] <= 2
    ):
        raise ValueError("job_invalid")
    if any(not isinstance(value[key], str) or HEX64.fullmatch(value[key]) is None for key in ("execution_key", "command_digest", "policy_hash")):
        raise ValueError("job_invalid")
    if not isinstance(value["lanes"], list) or not all(item in {"manual", "pitchbook"} for item in value["lanes"]):
        raise ValueError("job_invalid")
    if (
        not isinstance(value["ids"], list)
        or not all(isinstance(item, str) and OPAQUE.fullmatch(item) for item in value["ids"])
        or not isinstance(value["hashes"], list)
        or not all(isinstance(item, str) and HEX64.fullmatch(item) for item in value["hashes"])
        or not isinstance(value["counts"], dict)
        or not all(
            isinstance(key, str) and type(item) is int and item >= 0
            for key, item in value["counts"].items()
        )
        or command_digest(value) != value["command_digest"]
    ):
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


def _verify_store_binding(job: dict[str, Any], store: Path) -> None:
    connection = sqlite3.connect(store)
    try:
        row = connection.execute(
            "SELECT policy_hash,sender_profile_id FROM campaign WHERE campaign_id=?",
            (job["campaign_id"],),
        ).fetchone()
    finally:
        connection.close()
    if row is None or row != (job["policy_hash"], job["sender_profile_id"]):
        raise ValueError("job_binding_conflict")


def _private_profile_directory(store: Path) -> Path:
    snapshots = _under_root(store.parent / "snapshots")
    private = _under_root(snapshots / "manager-private")
    _require_plain_directory_tree(store.parent)
    snapshots.mkdir(exist_ok=True)
    _require_plain_directory_tree(snapshots)
    private.mkdir(exist_ok=True)
    _require_plain_directory_tree(private)
    return private


def _sender_profile(job: dict[str, Any], store: Path) -> _OwnedProfile:
    """Materialize one owned profile inside the selected store's snapshots tree."""
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
    encoded = json.dumps(profile, sort_keys=True).encode("utf-8")
    directory = _private_profile_directory(store)
    target = _under_root(directory / f"profile-{job['execution_key']}.json")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(target, flags, 0o600)
    except FileExistsError:
        try:
            before = target.lstat()
            if (
                _link_or_reparse(before)
                or not stat.S_ISREG(before.st_mode)
                or before.st_nlink != 1
                or before.st_size != len(encoded)
            ):
                raise OSError
            with target.open("rb") as source:
                opened = os.fstat(source.fileno())
                existing = source.read(len(encoded) + 1)
                after = os.fstat(source.fileno())
            if (
                _identity(before) != _identity(opened)
                or _identity(opened) != _identity(after)
                or existing != encoded
            ):
                raise OSError
            return _OwnedProfile(target, _identity(after))
        except OSError:
            raise ValueError("sender_profile_conflict") from None
    created_identity: tuple[int, int, int, int] | None = None
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
            created_identity = _identity(os.fstat(handle.fileno()))
        info = target.lstat()
        if (
            _link_or_reparse(info)
            or not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or _identity(info) != created_identity
        ):
            raise ValueError("sender_profile_conflict")
        return _OwnedProfile(target, _identity(info))
    except BaseException:
        if created_identity is not None:
            try:
                _remove_owned_profile(_OwnedProfile(target, created_identity))
            except ValueError:
                pass
        raise


def _remove_owned_profile(profile: _OwnedProfile) -> None:
    try:
        info = profile.path.lstat()
    except FileNotFoundError:
        return
    if (
        _link_or_reparse(info)
        or not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or _identity(info) != profile.identity
    ):
        raise ValueError("sender_profile_cleanup_conflict")
    profile.path.unlink()


def build_argv(
    job: dict[str, Any], store: Path, profile: _OwnedProfile | None = None
) -> list[str]:
    """Return the exact, local argv for a stage; no raw data enters it."""
    operation = job["operation"]
    if operation == "build":
        return [sys.executable, "-m", "scripts.prospecting.list_builder", "run", "--campaign", job["campaign_id"], "--lanes", ",".join(job["lanes"]), "--store", str(store)]
    if operation in {"prepare", "personalize"}:
        if profile is None:
            raise ValueError("sender_profile_missing")
        flag = "--output" if operation == "prepare" else "--model-response"
        value = job["output"] if operation == "prepare" else job["model_response"]
        value_path = _under_root(Path(value))
        return [sys.executable, "-m", "scripts.prospecting.personalizer.cli", operation, "--campaign", job["campaign_id"], "--sender-profile", str(profile.path), flag, str(value_path), "--store", str(store)]
    if operation in {"sweep", "scan", "reconcile", "status"}:
        return [sys.executable, "-m", "scripts.prospecting.campaigner.cli", "scan" if operation == "reconcile" else operation]
    raise ValueError("operation_not_allowed")


def _run_child(argv: list[str]) -> dict[str, Any]:
    child = subprocess.Popen(
        argv,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "KB_PROSPECTING_NO_NETWORK": "1"},
        shell=False,
        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )
    output_rejected = False

    def guard_chunk(name: str, text: str) -> None:
        nonlocal output_rejected
        try:
            assert_vm_safe(
                {"kind": "process_results", "fields": {name: text}},
                "process_results",
            )
        except Exception:
            output_rejected = True

    try:
        output = read_bounded_output(
            child,
            CHILD_TIMEOUT_SECONDS,
            on_chunk=guard_chunk,
            cancel=lambda: terminate_windows_tree(child.pid),
        )
    except (subprocess.TimeoutExpired, TimeoutError):
        raise _ChildFailure("adapter_timeout") from None
    if output is None:
        raise _ChildFailure("adapter_output_overflow")
    if output_rejected:
        raise _ChildFailure("adapter_output_rejected")
    stdout, _stderr = output
    if child.returncode:
        raise _ChildFailure("adapter_failed")
    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError:
        raise _ChildFailure("adapter_failed") from None
    if not isinstance(raw, dict):
        raise _ChildFailure("adapter_failed")
    return raw


def _inspect(job: dict[str, Any], store: Path) -> dict[str, int]:
    # Row counts and producer-owned QA data are not independent grades.  Until
    # an independent inspector adapter is configured, the workflow must park.
    raise ValueError("inspector_unavailable")


def _envelope(job: dict[str, Any], state: str, counts: dict[str, int], failures: dict[str, int] | None = None) -> dict[str, Any]:
    value = {
        "stage_id": job["stage_id"], "state": state, "ids": [],
        "counts": {key: int(number) for key, number in counts.items() if type(number) is int and number >= 0},
        "hashes": [],
        "failure_codes": failures or {}, "attempt": job["attempt"],
        "execution_key": job["execution_key"],
        "command_digest": job["command_digest"],
    }
    assert_vm_safe({"kind": "process_results", "fields": value}, "process_results")
    return value


def _cached(job_path: Path, key: str) -> Path:
    return job_path.with_name(f"result-{key}.json")


def _claim(job_path: Path, key: str) -> Path:
    return job_path.with_name(f"claim-{key}.json")


def _encoded(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _validate_cached(value: object, job: dict[str, Any]) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or set(value) != {
            "stage_id", "state", "ids", "counts", "hashes", "failure_codes",
            "attempt", "execution_key", "command_digest",
        }
        or value.get("stage_id") != job["stage_id"]
        or value.get("attempt") != job["attempt"]
        or value.get("execution_key") != job["execution_key"]
        or value.get("command_digest") != job["command_digest"]
        or value.get("state") not in {"complete", "failed"}
        or not isinstance(value.get("ids"), list)
        or not all(isinstance(item, str) and OPAQUE.fullmatch(item) for item in value["ids"])
        or not isinstance(value.get("hashes"), list)
        or not all(isinstance(item, str) and HEX64.fullmatch(item) for item in value["hashes"])
        or not isinstance(value.get("counts"), dict)
        or not all(
            isinstance(key, str) and type(item) is int and item >= 0
            for key, item in value["counts"].items()
        )
        or not isinstance(value.get("failure_codes"), dict)
        or not all(
            key in DESKTOP_FAILURE_CODES | {"inspector_unavailable"}
            and type(item) is int and item >= 0
            for key, item in value["failure_codes"].items()
        )
    ):
        raise ValueError("cache_conflict")
    assert_vm_safe({"kind": "process_results", "fields": value}, "process_results")
    return value


def _read_cache(path: Path, job: dict[str, Any]) -> dict[str, Any]:
    try:
        return _validate_cached(json.loads(path.read_text(encoding="utf-8")), job)
    except (OSError, json.JSONDecodeError):
        raise ValueError("cache_invalid") from None


def _sync_directory(path: Path) -> bool:
    """Flush directory metadata where the platform exposes a supported handle."""
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except PermissionError:
        # Windows does not expose directory fsync through os.open. The claim/cache
        # file itself is still fsynced; sudden power loss retains a filesystem-
        # dependent metadata window that ordinary process-crash recovery closes.
        if os.name == "nt":
            return False
        raise
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return True


def _acquire_claim(path: Path, job: dict[str, Any]) -> None:
    payload = _encoded({
        "execution_key": job["execution_key"],
        "command_digest": job["command_digest"],
    })
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags, 0o600)
    except FileExistsError:
        try:
            existing = path.read_bytes()
        except OSError:
            raise ValueError("claim_invalid") from None
        if existing != payload:
            raise ValueError("execution_key_conflict")
        raise ValueError("execution_recovery_required")
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    _sync_directory(path.parent)


def _publish_cache(path: Path, value: dict[str, Any]) -> None:
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}-", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(_encoded(value))
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            raise ValueError("cache_conflict") from None
        _sync_directory(path.parent)
        temporary.unlink()
        _sync_directory(path.parent)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def run(job_path: Path) -> dict[str, Any]:
    job = _job(job_path)
    cache = _cached(job_path, job["execution_key"])
    store = _store()
    _verify_store_binding(job, store)
    if cache.exists():
        return _read_cache(cache, job)
    claim = _claim(job_path, job["execution_key"])
    try:
        _acquire_claim(claim, job)
    except ValueError as error:
        if str(error) == "execution_recovery_required":
            return _envelope(
                job, "failed", {}, {"adapter_recovery_required": 1}
            )
        raise
    owned_profile: _OwnedProfile | None = None
    try:
        if job["operation"] == "grade":
            result = _envelope(job, "complete", _inspect(job, store))
        else:
            if job["operation"] in {"prepare", "personalize"}:
                owned_profile = _sender_profile(job, store)
            argv = build_argv(job, store, owned_profile)
            raw = _run_child(argv)
            result = _envelope(
                job, "complete",
                {key: value for key, value in raw.items() if type(value) is int},
            )
    except _ChildFailure as error:
        result = _envelope(job, "failed", {}, {error.code: 1})
    except Exception as error:
        failure = (
            "inspector_unavailable"
            if str(error) == "inspector_unavailable"
            else "adapter_failed"
        )
        result = _envelope(job, "failed", {}, {failure: 1})
    finally:
        if owned_profile is not None:
            try:
                _remove_owned_profile(owned_profile)
            except Exception:
                result = _envelope(job, "failed", {}, {"adapter_cleanup_failed": 1})
    _publish_cache(cache, result)
    claim.unlink()
    _sync_directory(claim.parent)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True, type=Path)
    args = parser.parse_args(argv)
    print(json.dumps(run(args.job), sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    main()
