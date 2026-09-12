"""MANUAL, opt-in desktop diagnostic for the reproduced cache-prime scan failure.

This module is deliberately named ``manual_*`` so pytest never collects it, and
every dependency import happens lazily inside ``_run`` so the default invocation
has no data, filesystem, network, model, or credential side effects.

What it does, and only this:

* runs the **genuine** ``private_stage_adapter._bootstrap`` (real ``_prepare_root``,
  real ``_prime_cache`` against the code-owned loopback fixture) over a freshly
  created synthetic store beneath the approved diagnostic root;
* temporarily replaces ``_run_live_canary`` with a **synthetic observer** that
  performs no model, provider, auth, or network call at all;
* temporarily wraps ``runtime._require_plain_directory_tree``,
  ``runtime._is_link_or_reparse``, ``adapter._read_bounded_regular`` and
  ``adapter._scan_owned`` so that the exact failing bounded read / plain-tree /
  lstat / reparse operation is *observed*.  Every wrapper calls the preserved
  original and re-raises the original exception unchanged; no safety refusal is
  suppressed, weakened, retried, or turned green.

Recorded evidence is numeric and enumerated only: a fixed operation label, the
numeric ``errno``/``winerror``, a file-category enum, an integer path *length*,
and numeric ``st_size``/``st_nlink``.  No path, file name, directory listing,
file content, error string, environment value, or credential object is read into
the report or retained anywhere.

``--deep`` additionally probes a purely synthetic nested-directory chain beneath
the same approved diagnostic root, so that the path *length* at which the same
helpers begin to refuse can be compared with the real runtime-root length.  It
accepts no caller-provided path of any kind.

Nothing here makes an acceptance, readiness, approval, or send decision, and
nothing here rewrites the production ``ACCEPTED_RUNTIME_BUNDLE_SHA256`` pin.

    python -B -m scripts.prospecting.tests.manual_prime_diagnostic --run
    python -B -m scripts.prospecting.tests.manual_prime_diagnostic --run --deep
"""

from __future__ import annotations

import json
import os
import stat
import sys
import uuid
from pathlib import Path
from threading import Lock
from typing import Any, Mapping

__test__ = False

HARNESS = "manual_prime_diagnostic"
SCHEMA_VERSION = 1
PRIVATE_ROOT = Path(
    "C:/Users/danie/kb/_private/prospecting-prime-diagnostic-20260911"
)
STORE_NAME = "store.sqlite"

MAX_EVENTS = 64
MAX_INVENTORY_ENTRIES = 2048
DEEP_MAX_DEPTH = 24
DEEP_SEGMENT = "d" * 24
DEEP_PROBE_NAME = "probe.sqlite"
DEEP_PROBE_BYTES = b"diagnostic-only\n"

OPS = (
    "require_plain_directory_tree",
    "is_link_or_reparse",
    "read_bounded_regular",
    "scan_owned",
    "inventory_lstat",
)
CATEGORIES = ("sqlite", "db-wal", "db-shm", "json", "other")

FIXED_CODES = frozenset({
    # harness-owned outcomes
    "manual_opt_in_required", "invalid_arguments", "run_root_unavailable",
    "harness_unexpected_error", "unrecognized_fixed_code", "bootstrap_succeeded",
    # private stage adapter / private runtime fixed codes
    "sink_scan_incomplete", "sink_scan_failed", "prohibited_content_logged",
    "cache_prime_failed", "cache_prime_timeout", "cache_prime_missing",
    "runtime_io_failed", "runtime_cleanup_failed", "runtime_root_invalid",
    "private_store_invalid", "private_root_invalid", "desktop_context_missing",
    "codex_unavailable", "provider_unavailable", "tool_configuration_invalid",
    "tool_event_rejected", "event_stream_invalid", "event_stream_incomplete",
    "event_line_too_large", "stage_output_invalid", "stage_content_invalid",
    "preflight_output_invalid", "runtime_timeout", "runtime_bundle_changed",
    "runtime_capability_invalid", "runtime_manifest_invalid",
    "runtime_schema_invalid", "runtime_config_mismatch",
    "windows_job_unavailable", "process_start_failed", "process_wait_failed",
    "process_termination_failed", "job_assignment_failed", "stdin_path_invalid",
    "stdin_open_failed", "stdin_read_failed", "stdin_hash_mismatch",
    "stdin_cleanup_failed", "stdout_pipe_failed", "stdout_read_failed",
    "stdout_too_large", "stdout_limit_invalid", "stdout_observer_failed",
    "attempt_exists", "attempt_directory_invalid", "attempt_path_conflict",
    "attempt_write_failed", "live_runtime_not_accepted",
})


class _HarnessError(Exception):
    """Fixed-category harness refusal carrying no free-form detail."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _fixed(code: object) -> str:
    return code if isinstance(code, str) and code in FIXED_CODES else "unrecognized_fixed_code"


def _emit(report: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _category(path: object) -> str:
    """Return a fixed category enum derived only from the trailing name shape."""
    try:
        name = os.path.basename(os.fspath(path)).casefold()
    except (TypeError, ValueError):
        return "other"
    if name.endswith("-wal") or name.endswith(".db-wal"):
        return "db-wal"
    if name.endswith("-shm") or name.endswith(".db-shm"):
        return "db-shm"
    if name.endswith(".sqlite") or name.endswith(".db") or name.endswith(".sqlite3"):
        return "sqlite"
    if name.endswith(".json") or name.endswith(".jsonl"):
        return "json"
    return "other"


def _path_length(path: object) -> int:
    try:
        return len(os.fspath(path))
    except (TypeError, ValueError):
        return -1


def _numeric_error(error: BaseException) -> dict[str, Any]:
    """Numeric-only error identity: never a message, path, or strerror string."""
    errno_value = getattr(error, "errno", None)
    winerror_value = getattr(error, "winerror", None)
    if isinstance(error, OSError):
        kind = "OSError"
    elif isinstance(error, ValueError):
        kind = "ValueError"
    else:
        kind = "other"
    return {
        "kind": kind,
        "errno": int(errno_value) if isinstance(errno_value, int) else None,
        "winerror": int(winerror_value) if isinstance(winerror_value, int) else None,
    }


def _stat_facts(path: object) -> dict[str, Any]:
    """Best-effort numeric metadata for the failing entry; never any name."""
    facts: dict[str, Any] = {
        "size": None, "nlink": None, "is_regular": None,
        "reparse_bit": None, "lstat_errno": None, "lstat_winerror": None,
    }
    try:
        info = os.lstat(path)
    except OSError as error:
        numeric = _numeric_error(error)
        facts["lstat_errno"] = numeric["errno"]
        facts["lstat_winerror"] = numeric["winerror"]
        return facts
    except (TypeError, ValueError):
        return facts
    facts["size"] = int(info.st_size)
    facts["nlink"] = int(info.st_nlink)
    facts["is_regular"] = bool(stat.S_ISREG(info.st_mode))
    facts["reparse_bit"] = bool(getattr(info, "st_file_attributes", 0) & 0x400)
    return facts


class _Recorder:
    """Bounded, sanitized observation sink. Records numbers and enums only."""

    def __init__(self) -> None:
        self._lock = Lock()
        self.phase = "setup"
        self.events: list[dict[str, Any]] = []
        self.truncated = False
        self.ok_counts: dict[str, int] = {op: 0 for op in OPS}
        self.fail_counts: dict[str, int] = {op: 0 for op in OPS}
        self.max_path_length: dict[str, int] = {op: 0 for op in OPS}
        self.observation: dict[str, Any] = {}
        self.inventory: dict[str, Any] = {}

    def set_phase(self, phase: str) -> None:
        with self._lock:
            self.phase = phase

    def ok(self, op: str, path: object) -> None:
        length = _path_length(path)
        with self._lock:
            self.ok_counts[op] = self.ok_counts.get(op, 0) + 1
            if length > self.max_path_length.get(op, 0):
                self.max_path_length[op] = length

    def fail(
        self, op: str, error: BaseException, path: object,
        detail: Mapping[str, Any] | None = None,
    ) -> None:
        length = _path_length(path)
        entry = {
            "phase": self.phase,
            "op": op,
            "error": _numeric_error(error),
            "path_length": length,
            "category": _category(path),
            **_stat_facts(path),
        }
        if detail is not None:
            entry["detail"] = dict(detail)
        with self._lock:
            self.fail_counts[op] = self.fail_counts.get(op, 0) + 1
            if length > self.max_path_length.get(op, 0):
                self.max_path_length[op] = length
            if len(self.events) < MAX_EVENTS:
                self.events.append(entry)
            else:
                self.truncated = True


def _inventory(root: Path, recorder: _Recorder) -> dict[str, Any]:
    """Bounded numeric-only metadata census of an owned runtime root."""
    summary: dict[str, Any] = {
        "entries": 0, "regular_files": 0, "directories": 0, "other": 0,
        "total_size": 0, "max_file_size": 0, "max_path_length": 0,
        "nlink_not_one": 0, "reparse_entries": 0, "lstat_errors": 0,
        "truncated": False, "walk_error": None,
        "by_category": {name: 0 for name in CATEGORIES},
    }
    try:
        entries = sorted(root.rglob("*"))
    except (OSError, ValueError) as error:
        summary["walk_error"] = _numeric_error(error)
        return summary
    if len(entries) > MAX_INVENTORY_ENTRIES:
        entries = entries[:MAX_INVENTORY_ENTRIES]
        summary["truncated"] = True
    for path in entries:
        summary["entries"] += 1
        length = _path_length(path)
        if length > summary["max_path_length"]:
            summary["max_path_length"] = length
        try:
            info = os.lstat(path)
        except OSError as error:
            summary["lstat_errors"] += 1
            recorder.fail("inventory_lstat", error, path)
            continue
        if getattr(info, "st_file_attributes", 0) & 0x400:
            summary["reparse_entries"] += 1
        if stat.S_ISDIR(info.st_mode):
            summary["directories"] += 1
            continue
        if not stat.S_ISREG(info.st_mode):
            summary["other"] += 1
            continue
        summary["regular_files"] += 1
        summary["total_size"] += int(info.st_size)
        if int(info.st_size) > summary["max_file_size"]:
            summary["max_file_size"] = int(info.st_size)
        if int(info.st_nlink) != 1:
            summary["nlink_not_one"] += 1
        summary["by_category"][_category(path)] += 1
    return summary


def _install(recorder: _Recorder, runtime: Any, adapter: Any) -> list[tuple[Any, str, Any]]:
    """Install observing wrappers; every original is preserved and re-raised from."""
    originals: list[tuple[Any, str, Any]] = [
        (runtime, "_require_plain_directory_tree", runtime._require_plain_directory_tree),
        (runtime, "_is_link_or_reparse", runtime._is_link_or_reparse),
        (adapter, "_read_bounded_regular", adapter._read_bounded_regular),
        (adapter, "_scan_owned", adapter._scan_owned),
        (adapter, "_run_live_canary", adapter._run_live_canary),
    ]
    original_tree = runtime._require_plain_directory_tree
    original_link = runtime._is_link_or_reparse
    original_read = adapter._read_bounded_regular
    original_scan = adapter._scan_owned

    def require_plain_directory_tree(path, *args, **kwargs):
        try:
            result = original_tree(path, *args, **kwargs)
        except BaseException as error:
            try:
                recorder.fail("require_plain_directory_tree", error, path)
            except Exception:
                pass
            raise
        try:
            recorder.ok("require_plain_directory_tree", path)
        except Exception:
            pass
        return result

    def is_link_or_reparse(path, *args, **kwargs):
        try:
            result = original_link(path, *args, **kwargs)
        except BaseException as error:
            try:
                recorder.fail("is_link_or_reparse", error, path)
            except Exception:
                pass
            raise
        try:
            recorder.ok("is_link_or_reparse", path)
        except Exception:
            pass
        return result

    def read_bounded_regular(path, maximum, *args, **kwargs):
        try:
            data = original_read(path, maximum, *args, **kwargs)
        except BaseException as error:
            try:
                # A bare ``raise OSError`` from the helper's own pre/post checks
                # has ``errno is None``; a real syscall refusal does not.
                recorder.fail(
                    "read_bounded_regular", error, path,
                    {
                        "maximum": int(maximum) if isinstance(maximum, int) else None,
                        "bare_oserror": isinstance(error, OSError)
                        and getattr(error, "errno", None) is None,
                    },
                )
            except Exception:
                pass
            raise
        try:
            recorder.ok("read_bounded_regular", path)
        except Exception:
            pass
        return data

    def scan_owned(root, needles, *args, **kwargs):
        try:
            recorder.set_phase("scan_owned")
            recorder.inventory = _inventory(root, recorder)
            recorder.observation["scan_root_path_length"] = _path_length(root)
        except Exception:
            pass
        try:
            result = original_scan(root, needles, *args, **kwargs)
        except BaseException as error:
            try:
                recorder.fail(
                    "scan_owned", error, root,
                    {"code": _fixed(getattr(error, "code", None))},
                )
            except Exception:
                pass
            raise
        try:
            recorder.ok("scan_owned", root)
        except Exception:
            pass
        return result

    def synthetic_canary(capability, *args, **kwargs):
        """Synthetic observer only: no live model, provider, auth, or network."""
        try:
            recorder.set_phase("post_prime_synthetic_observer")
            state_files = 0
            state_bytes = 0
            try:
                for path in capability.state.rglob("*"):
                    info = os.lstat(path)
                    if stat.S_ISREG(info.st_mode):
                        state_files += 1
                        state_bytes += int(info.st_size)
            except OSError as error:
                recorder.fail("inventory_lstat", error, capability.state)
            recorder.observation.update({
                "prime_reached_live_canary": True,
                "state_regular_files": state_files,
                "state_total_bytes": state_bytes,
                "empty_home_exists": (capability.root / "empty-home").exists(),
                "prime_attempt_exists": (capability.root / "prime").exists(),
                "root_path_length": _path_length(capability.root),
                "state_path_length": _path_length(capability.state),
            })
        except Exception:
            pass
        return None

    runtime._require_plain_directory_tree = require_plain_directory_tree
    runtime._is_link_or_reparse = is_link_or_reparse
    adapter._read_bounded_regular = read_bounded_regular
    adapter._scan_owned = scan_owned
    adapter._run_live_canary = synthetic_canary
    return originals


def _restore(originals: list[tuple[Any, str, Any]]) -> bool:
    ok = True
    for module, name, value in originals:
        try:
            setattr(module, name, value)
        except BaseException:
            ok = False
    return ok


def _new_run_root(runtime: Any) -> Path:
    try:
        PRIVATE_ROOT.mkdir(parents=True, exist_ok=True)
        runtime._require_plain_directory_tree(PRIVATE_ROOT)
        run_root = PRIVATE_ROOT / uuid.uuid4().hex
        run_root.mkdir(mode=0o700)
        runtime._require_plain_directory_tree(run_root)
        return run_root
    except (OSError, ValueError):
        raise _HarnessError("run_root_unavailable") from None


def _extended(path: Path) -> str:
    value = os.fspath(path)
    if os.name == "nt" and not value.startswith("\\\\?\\"):
        return "\\\\?\\" + value.replace("/", "\\")
    return value


def _deep_probe(run_root: Path, recorder: _Recorder, runtime: Any, adapter: Any) -> dict[str, Any]:
    """Synthetic path-length probe: fixed segments only, no caller input."""
    recorder.set_phase("deep")
    deep_root = run_root / "deep"
    summary: dict[str, Any] = {
        "base_path_length": _path_length(deep_root),
        "max_depth": DEEP_MAX_DEPTH,
        "segment_length": len(DEEP_SEGMENT),
        "deepest_ok_depth": -1,
        "deepest_ok_path_length": -1,
        "first_failed_depth": None,
        "first_failed_path_length": None,
        "first_failed_op": None,
        "first_failed_error": None,
        "cleanup_complete": False,
    }
    created: list[Path] = []
    try:
        deep_root.mkdir(mode=0o700)
        created.append(deep_root)
        current = deep_root
        for depth in range(1, DEEP_MAX_DEPTH + 1):
            current = current / DEEP_SEGMENT
            probe = current / DEEP_PROBE_NAME
            op = "mkdir"
            try:
                current.mkdir(mode=0o700)
                created.append(current)
                probe.write_bytes(DEEP_PROBE_BYTES)
                op = "require_plain_directory_tree"
                runtime._require_plain_directory_tree(current)
                op = "is_link_or_reparse"
                runtime._is_link_or_reparse(probe)
                op = "read_bounded_regular"
                adapter._read_bounded_regular(probe, 4096)
            except (OSError, ValueError) as error:
                summary["first_failed_depth"] = depth
                summary["first_failed_path_length"] = _path_length(probe)
                summary["first_failed_op"] = op
                summary["first_failed_error"] = _numeric_error(error)
                break
            summary["deepest_ok_depth"] = depth
            summary["deepest_ok_path_length"] = _path_length(probe)
    except (OSError, ValueError) as error:
        summary.setdefault("first_failed_error", _numeric_error(error))
    finally:
        complete = True
        for path in reversed(created):
            try:
                probe = path / DEEP_PROBE_NAME
                try:
                    os.unlink(_extended(probe))
                except FileNotFoundError:
                    pass
                os.rmdir(_extended(path))
            except OSError:
                complete = False
        summary["cleanup_complete"] = complete and not deep_root.exists()
    return summary


def _run(deep: bool) -> int:
    from scripts.prospecting.personalizer import private_runtime as runtime
    from scripts.prospecting.personalizer import private_stage_adapter as adapter

    recorder = _Recorder()
    report: dict[str, Any] = {
        "harness": HARNESS, "schema_version": SCHEMA_VERSION,
        "mode": "run_deep" if deep else "run",
        "status": "failed", "code": "harness_unexpected_error",
        "phase_at_failure": None, "events": [], "events_truncated": False,
        "ok_counts": {}, "fail_counts": {}, "max_path_length": {},
        "observation": {}, "inventory": {},
        "requested_model": adapter.REQUESTED_MODEL,
        "responding_model_verified": False,
        "live_canary_replaced_with_synthetic_observer": True,
        "live_model_or_auth_call_attempted": False,
        "cleanup": {
            "wrappers_restored": False, "runtime_root": "not_started",
            "runtime_root_exists_after": None, "run_root_removed": None,
            "fixture_root_exists_after": None,
        },
    }
    originals: list[tuple[Any, str, Any]] = []
    run_root: Path | None = None
    parent = capability = None
    try:
        run_root = _new_run_root(runtime)
        report["run_root_id"] = run_root.name
        report["observation"]["run_root_path_length"] = _path_length(run_root)
        store = (run_root / STORE_NAME).resolve()
        store.touch(mode=0o600)
        report["observation"]["store_path_length"] = _path_length(store)
        selected = adapter._selected_environment(os.environ)
        report["observation"]["selected_env_key_count"] = len(selected)
        originals = _install(recorder, runtime, adapter)
        recorder.set_phase("bootstrap")
        try:
            parent, capability = adapter._bootstrap(store, selected)
            report["status"], report["code"] = "succeeded", "bootstrap_succeeded"
        except BaseException as error:
            report["status"] = "observed"
            report["code"] = _fixed(getattr(error, "code", None))
            report["phase_at_failure"] = recorder.phase
            report["observation"]["cleanup_code"] = _fixed(
                getattr(error, "cleanup_code", None),
            ) if getattr(error, "cleanup_code", None) is not None else None
        if deep:
            report["deep"] = _deep_probe(run_root, recorder, runtime, adapter)
    except _HarnessError as error:
        report["status"], report["code"] = "failed", _fixed(error.code)
    except BaseException:
        report["status"], report["code"] = "failed", "harness_unexpected_error"
    finally:
        report["cleanup"]["wrappers_restored"] = _restore(originals) if originals else True
        if capability is not None:
            try:
                capability.invalidated.set()
            except BaseException:
                pass
            if parent is not None:
                try:
                    report["cleanup"]["runtime_root"] = runtime._cleanup_attempt(
                        capability.root, parent,
                    )
                except BaseException:
                    report["cleanup"]["runtime_root"] = "failed"
            try:
                report["cleanup"]["runtime_root_exists_after"] = capability.root.exists()
            except BaseException:
                report["cleanup"]["runtime_root_exists_after"] = None
        if run_root is not None:
            try:
                report["cleanup"]["run_root_removed"] = runtime._cleanup_attempt(
                    run_root, PRIVATE_ROOT,
                ) == "deleted"
            except BaseException:
                report["cleanup"]["run_root_removed"] = False
            try:
                report["cleanup"]["fixture_root_exists_after"] = run_root.exists()
            except BaseException:
                report["cleanup"]["fixture_root_exists_after"] = None
        report["events"] = recorder.events
        report["events_truncated"] = recorder.truncated
        report["ok_counts"] = recorder.ok_counts
        report["fail_counts"] = recorder.fail_counts
        report["max_path_length"] = recorder.max_path_length
        report["inventory"] = recorder.inventory
        report["observation"].update(recorder.observation)
        # Discriminator: the explicit cap branch of ``_scan_owned`` raises the
        # same fixed code with no wrapped bounded-read/lstat/tree refusal.
        report["observation"]["wrapped_helper_failures"] = sum(
            recorder.fail_counts.get(op, 0)
            for op in ("require_plain_directory_tree", "is_link_or_reparse",
                       "read_bounded_regular", "inventory_lstat")
        )
    _emit(report)
    return 0 if report["status"] in {"observed", "succeeded"} else 1


def main(argv: list[str] | None = None) -> int:
    values = tuple(sys.argv[1:] if argv is None else argv)
    if values == ():
        _emit({
            "harness": HARNESS, "schema_version": SCHEMA_VERSION, "mode": "default",
            "status": "not_attempted", "code": "manual_opt_in_required",
            "events": [], "fail_counts": {},
        })
        return 0
    if values not in (("--run",), ("--run", "--deep"), ("--deep", "--run")):
        _emit({
            "harness": HARNESS, "schema_version": SCHEMA_VERSION, "mode": "rejected",
            "status": "not_attempted", "code": "invalid_arguments",
            "events": [], "fail_counts": {},
        })
        return 2
    return _run("--deep" in values)


if __name__ == "__main__":
    raise SystemExit(main())
