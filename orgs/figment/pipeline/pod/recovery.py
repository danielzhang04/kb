"""Durable, one-shot recovery journal for a bounded Figment pod attempt.

This module deliberately has no RunPod client dependency.  The runner supplies its
authenticated API and existing ``PodLease`` implementation so recovery cannot grow a
second, less-tested teardown path.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable


SCHEMA = "figment/pod-recovery@1"
NAME_RE = re.compile(r"figment-bakeoff-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}")
ID_RE = re.compile(r"[A-Za-z0-9-]+")
# A provider may accept a request shortly after a caller loses the response.  Wider
# than that is not ownership evidence, even if the generated name happens to match.
CREATE_WINDOW = timedelta(minutes=30)
CLOCK_SKEW = timedelta(minutes=5)
ERROR_CODE_RE = re.compile(r"[a-z0-9-]{1,80}")
RUN_DIRECTORY_LOCK_NAME = ".figment-recovery-run.lock"
WINDOWS_TRANSIENT_REPLACE_ERRORS = {32, 33}
ATOMIC_REPLACE_ATTEMPTS = 3


class RecoveryError(RuntimeError):
    """A recovery refusal which leaves the provider untouched."""


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _intent_digest(document: dict[str, Any]) -> str:
    payload = {
        key: document.get(key)
        for key in (
            "schema", "attempt_id", "pod_name", "manifest_path", "manifest_sha256",
            "max_minutes", "max_usd", "created_utc", "receipt_path",
        )
    }
    return hashlib.sha256(_canonical(payload)).hexdigest()


def _replace_atomic(source: Path, target: Path) -> None:
    """Retry only Windows sharing/lock violations, with a short fixed bound."""
    for attempt in range(1, ATOMIC_REPLACE_ATTEMPTS + 1):
        try:
            os.replace(source, target)
            return
        except OSError as exc:
            if (getattr(exc, "winerror", None) not in WINDOWS_TRANSIENT_REPLACE_ERRORS
                    or attempt == ATOMIC_REPLACE_ATTEMPTS):
                raise
            time.sleep(0.01 * attempt)


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    """Replace a journal as one file-system operation; never expose a partial JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent), text=True,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, indent=2, sort_keys=True, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        _replace_atomic(temporary, path)
        # NTFS does not guarantee that opening a directory is supported.  On systems
        # that do support it, flush the rename too; on Windows the atomic replacement
        # remains the available durability boundary.
        try:
            directory = os.open(path.parent, os.O_RDONLY)
        except OSError:
            directory = None
        if directory is not None:
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    except BaseException:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _parse_utc(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise RecoveryError(f"recovery journal has no valid {label}")
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise RecoveryError(f"recovery journal has invalid {label}") from exc
    if parsed.tzinfo is None:
        raise RecoveryError(f"recovery journal {label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def manifest_sha256(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as exc:
        raise RecoveryError("recovery manifest cannot be read for ownership verification") from exc


def _journal_path_for_receipt(receipt_path: Path) -> Path:
    return receipt_path.parent


def _journal_filename(pod_name: str) -> str:
    return f"recovery-{pod_name}.json"


class RunDirectoryLock:
    """Exclusive run-directory guard held through create and finalization."""

    def __init__(self, path: Path, descriptor: int):
        self.path = path
        self.descriptor = descriptor
        self._released = False

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        try:
            os.close(self.descriptor)
        finally:
            try:
                self.path.unlink()
            except OSError as exc:
                raise RecoveryError("could not release recovery run-directory lock") from exc


def acquire_run_directory_lock(receipt_path: Path) -> RunDirectoryLock:
    """Refuse any reused receipt directory before a new create can be attempted."""
    run_dir = receipt_path.parent
    run_dir.mkdir(parents=True, exist_ok=True)
    lock_path = run_dir / RUN_DIRECTORY_LOCK_NAME
    try:
        descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise RecoveryError("recovery run directory is already active or was interrupted") from exc
    lock = RunDirectoryLock(lock_path, descriptor)
    try:
        if receipt_path.exists():
            raise RecoveryError("run directory already contains run.json; use a new --out directory")
        legacy = run_dir / "recovery.json"
        journals = sorted(run_dir.glob("recovery-*.json"))
        if legacy.exists() or journals:
            raise RecoveryError("run directory already contains recovery evidence; use a new --out directory")
    except BaseException:
        lock.release()
        raise
    return lock


def _exclusive_journal_lock(path: Path) -> int:
    lock_path = path.with_suffix(path.suffix + ".create-lock")
    try:
        return os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise RecoveryError("recovery journal creation is already in progress or was interrupted") from exc


def _release_journal_lock(path: Path, descriptor: int) -> None:
    lock_path = path.with_suffix(path.suffix + ".create-lock")
    try:
        os.close(descriptor)
    finally:
        try:
            lock_path.unlink()
        except OSError as exc:
            raise RecoveryError("could not release recovery journal creation lock") from exc


def create_intent(
    *, receipt_path: Path, manifest_path: Path, manifest_digest: str, pod_name: str,
    max_minutes: float, max_usd: float | None, created_utc: datetime,
) -> Path:
    """Persist the narrow ownership claim before the create POST is attempted."""
    if created_utc.tzinfo is None:
        created_utc = created_utc.replace(tzinfo=timezone.utc)
    document: dict[str, Any] = {
        "schema": SCHEMA,
        "state": "intent",
        "attempt_id": pod_name,
        "pod_name": pod_name,
        "manifest_path": str(manifest_path.resolve()),
        "manifest_sha256": manifest_digest,
        "max_minutes": max_minutes,
        "max_usd": max_usd,
        "created_utc": created_utc.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "receipt_path": str(receipt_path.resolve()),
        "pod_id": None,
        "absence_verified": False,
    }
    document["intent_sha256"] = _intent_digest(document)
    journal_dir = _journal_path_for_receipt(receipt_path)
    path = journal_dir / _journal_filename(pod_name)
    journal_dir.mkdir(parents=True, exist_ok=True)
    descriptor = _exclusive_journal_lock(path)
    try:
        if path.exists():
            # Preserve every state, including a verified terminal journal: a reused
            # output directory must never erase evidence of an earlier attempt.
            raise RecoveryError("recovery journal already exists for this attempt")
        atomic_write_json(path, document)
    finally:
        _release_journal_lock(path, descriptor)
    return path


def load_journal(
    path: Path, *, now: datetime | None = None, verify_manifest: bool = True,
) -> dict[str, Any]:
    """Load and strictly bind an intent to its adjacent run directory and manifest."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RecoveryError("recovery journal is missing or malformed") from exc
    if not isinstance(raw, dict):
        raise RecoveryError("recovery journal must be an object")
    required = {
        "schema", "state", "attempt_id", "pod_name", "manifest_path", "manifest_sha256",
        "max_minutes", "max_usd", "created_utc", "receipt_path", "pod_id",
        "absence_verified", "intent_sha256",
    }
    if set(raw) - (required | {"provider_last_started_utc", "recovery_status", "recovery_error_code", "recovered_utc"}):
        raise RecoveryError("recovery journal has unexpected fields")
    if not required.issubset(raw):
        raise RecoveryError("recovery journal is incomplete")
    if raw.get("schema") != SCHEMA or raw.get("state") not in {"intent", "acquired", "uncertain", "terminated"}:
        raise RecoveryError("recovery journal has an unsupported state")
    if not all(isinstance(raw.get(key), str) for key in ("attempt_id", "pod_name", "manifest_path", "manifest_sha256", "receipt_path", "intent_sha256")):
        raise RecoveryError("recovery journal has invalid ownership fields")
    if raw["attempt_id"] != raw["pod_name"] or not NAME_RE.fullmatch(raw["pod_name"]):
        raise RecoveryError("recovery journal pod name is outside Figment ownership scope")
    if not re.fullmatch(r"[0-9a-f]{64}", raw["manifest_sha256"]):
        raise RecoveryError("recovery journal manifest digest is invalid")
    if raw["intent_sha256"] != _intent_digest(raw):
        raise RecoveryError("recovery journal integrity digest does not match")
    if isinstance(raw["max_minutes"], bool) or not isinstance(raw["max_minutes"], (int, float)) or not 0 < raw["max_minutes"] <= 840:
        raise RecoveryError("recovery journal has an invalid maximum duration")
    if raw["max_usd"] is not None and (isinstance(raw["max_usd"], bool) or not isinstance(raw["max_usd"], (int, float)) or raw["max_usd"] < 0):
        raise RecoveryError("recovery journal has an invalid maximum spend")
    if raw["pod_id"] is not None and (not isinstance(raw["pod_id"], str) or not ID_RE.fullmatch(raw["pod_id"])):
        raise RecoveryError("recovery journal pod id is invalid")
    if not isinstance(raw["absence_verified"], bool):
        raise RecoveryError("recovery journal absence state is invalid")
    created = _parse_utc(raw["created_utc"], "created_utc")
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    if created > current.astimezone(timezone.utc) + CLOCK_SKEW:
        raise RecoveryError("recovery journal creation time is implausibly in the future")
    receipt = Path(raw["receipt_path"])
    if (not receipt.is_absolute() or receipt.name != "run.json"
            or receipt.parent.resolve() != path.parent.resolve()):
        raise RecoveryError("recovery receipt path is outside the journal run directory")
    if verify_manifest:
        manifest = Path(raw["manifest_path"])
        if not manifest.is_absolute() or manifest_sha256(manifest) != raw["manifest_sha256"]:
            raise RecoveryError("recovery manifest does not match the original intent")
    return raw


def update_journal(path: Path, document: dict[str, Any], **changes: Any) -> dict[str, Any]:
    updated = dict(document)
    updated.update(changes)
    # The intent digest covers immutable scope only.  State transitions may change.
    updated["intent_sha256"] = document["intent_sha256"]
    atomic_write_json(path, updated)
    return updated


def record_acquired(path: Path, pod_id: str, pod: dict[str, Any] | None = None) -> dict[str, Any]:
    document = load_journal(path, verify_manifest=False)
    if not ID_RE.fullmatch(str(pod_id)):
        raise RecoveryError("provider returned an unsafe pod id")
    provider_last_started = _provider_last_started_utc(pod) if isinstance(pod, dict) else None
    changes: dict[str, Any] = {"state": "acquired", "pod_id": str(pod_id)}
    if provider_last_started is not None:
        changes["provider_last_started_utc"] = provider_last_started.isoformat(timespec="seconds")
    return update_journal(path, document, **changes)


def record_terminal(
    path: Path, *, absence_verified: bool, status: str,
    error_code: str | None = None,
) -> dict[str, Any]:
    document = load_journal(path, verify_manifest=False)
    changes: dict[str, Any] = {
        "state": "terminated" if absence_verified else "uncertain",
        "absence_verified": absence_verified,
        "recovery_status": status,
        "recovered_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    if error_code:
        if not ERROR_CODE_RE.fullmatch(error_code):
            raise RecoveryError("recovery error code is invalid")
        changes["recovery_error_code"] = error_code
    return update_journal(path, document, **changes)


def _provider_last_started_utc(pod: dict[str, Any]) -> datetime | None:
    """Return RunPod's documented lastStartedAt; it is not a creation timestamp."""
    value = pod.get("lastStartedAt")
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        seconds = float(value) / (1000.0 if abs(float(value)) >= 100_000_000_000 else 1.0)
        return datetime.fromtimestamp(seconds, timezone.utc)
    if isinstance(value, str):
        text = value[:-1] + "+00:00" if value.endswith("Z") else value
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            raise ValueError("provider timestamp lacks timezone")
        return parsed.astimezone(timezone.utc)
    raise ValueError("provider timestamp has unsupported type")


def verify_name_and_last_start(document: dict[str, Any], pod: dict[str, Any]) -> str:
    """Validate non-destructive exact-name discovery against documented Pod fields."""
    if not isinstance(pod, dict):
        raise RecoveryError("provider returned an invalid pod object")
    pod_id = pod.get("id")
    if not isinstance(pod_id, str) or not ID_RE.fullmatch(pod_id):
        raise RecoveryError("provider pod has no safe id")
    if pod.get("name") != document["pod_name"]:
        raise RecoveryError("provider pod name does not match recovery intent")
    try:
        last_started = _provider_last_started_utc(pod)
    except (TypeError, ValueError, OverflowError) as exc:
        raise RecoveryError("provider pod last start time cannot verify ownership") from exc
    if last_started is None:
        raise RecoveryError("provider pod has no last start time for ownership verification")
    intended = _parse_utc(document["created_utc"], "created_utc")
    max_minutes = float(document["max_minutes"])
    if not intended - CLOCK_SKEW <= last_started <= intended + timedelta(minutes=max_minutes):
        raise RecoveryError("provider pod last start time is stale or outside recovery scope")
    return pod_id


def verify_owned_pod(document: dict[str, Any], pod: dict[str, Any], *, expected_id: str | None = None) -> None:
    """Require recorded ID, exact name, and bounded last-start evidence before DELETE."""
    pod_id = verify_name_and_last_start(document, pod)
    if expected_id is None:
        raise RecoveryError("recovery has no recorded pod id; name discovery cannot authorize deletion")
    if pod_id != expected_id:
        raise RecoveryError("provider pod id does not match recovery intent")


def reconcile(
    path: Path, api: Any, logger: Any,
    lease_factory: Callable[..., Any], *, sleep: Callable[[float], None],
) -> dict[str, Any]:
    """Terminate exactly one journaled attempt, or fail before any DELETE.

    It intentionally never calls ``create_pod`` and never modifies the run receipt or
    cost ledger.  Those records remain evidence for a human billing reconciliation.
    """
    document = load_journal(path)
    if document["state"] == "terminated" and document["absence_verified"]:
        return document
    pod_id = document.get("pod_id")
    if pod_id:
        candidate = api.get_pod(pod_id)
        if candidate is None:
            return record_terminal(path, absence_verified=True, status="already-absent")
        try:
            verify_owned_pod(document, candidate, expected_id=pod_id)
        except RecoveryError:
            record_terminal(
                path, absence_verified=False, status="refused",
                error_code="ownership-refused",
            )
            raise
    else:
        candidates = [
            pod for pod in api.list_pods()
            if isinstance(pod, dict) and pod.get("name") == document["pod_name"]
        ]
        verified: list[dict[str, Any]] = []
        for candidate in candidates:
            try:
                verify_name_and_last_start(document, candidate)
            except RecoveryError:
                continue
            verified.append(candidate)
        if len(verified) != 1:
            error = "no exact owned pod found" if not verified else "ambiguous exact owned pods found"
            record_terminal(
                path, absence_verified=False, status="uncertain",
                error_code=("no-owned-pod" if not verified else "ambiguous-owned-pods"),
            )
            raise RecoveryError(error)
        record_terminal(
            path, absence_verified=False, status="uncertain",
            error_code="unrecorded-pod-id",
        )
        raise RecoveryError("recovery discovered one exact-name pod but has no recorded pod id")
    lease = lease_factory(api, None, logger, pod_id=pod_id, sleep=sleep)
    lease._remember_pod(candidate)
    try:
        lease.close()
    except BaseException:
        record_terminal(
            path, absence_verified=False, status="termination-unverified",
            error_code="termination-unverified",
        )
        raise
    _id, _name, verified_absent = lease.snapshot()
    return record_terminal(
        path, absence_verified=verified_absent,
        status="terminated" if verified_absent else "termination-unverified",
    )
