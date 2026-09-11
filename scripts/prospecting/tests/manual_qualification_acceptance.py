"""MANUAL, opt-in desktop trial for ONE actual P19 qualification fact-check.

This module is named ``manual_*`` so pytest never collects it, and every
dependency import happens lazily inside ``_run``, so the default invocation has
no data, filesystem, network, or model side effects.  With ``--run`` it prepares
the genuine P15-P18 synthetic fixture through the real shared helper
``test_qualification_service._ready_store`` and then makes exactly one real
``QualificationService.run_next`` call against the real native
``qualification_factcheck`` adapter bootstrapped in this same process.

No synthetic qualification adapter is imported anywhere here, so the single
stage call is either a real model call or a fixed-code refusal.  Unknown and
contradicted findings are reported honestly, never repaired, retried, or
relabelled, and a completed machine review is never reported as source support.

Nothing here creates a contact, fill, affinity, approval, readiness or send
row, rewrites the production ``ACCEPTED_RUNTIME_BUNDLE_SHA256`` pin, accepts a
caller-supplied store, path, or prompt, or prints captured source text, notes,
or model prose.  Stdout is bounded metadata only.

For this bounded diagnosis only, a same-process wrapper temporarily replaces
``private_stage_adapter._execute_stage`` for the duration of ``--run``.  The
wrapper delegates to the exact original callable, records at most one
allowlisted fixed code observed on an inner ``PrivateStageRuntimeError`` (or
``PrivateRuntimeError``), re-raises every exception unchanged, and is restored
in ``finally`` even when bootstrap or fixture preparation fails.  It reads no
job, payload, exception text, stdout, stderr, path, or identifier, mutates no
other runtime binding, schema, attempt limit, copy or canary, and adds no
model call: the trial still makes exactly one qualification call.

The same probe also temporarily wraps
``private_stage_adapter._EventObserver._line`` to distinguish provider failure
categories.  The wrapper inspects only explicit error event shapes (``error``,
``turn.failed``, and ``item.*`` whose item type is ``error``), parses the
already-bounded line with the adapter's existing strict parser, and reads only
the documented ``code``/``status``/``message`` fields of that error object.  It
never traverses ``agent_message`` or ``reasoning`` items, never dumps events,
never retains, logs, or prints raw text, URLs, or paths, and always calls the
exact original ``_line`` afterwards, so every existing event-policy refusal is
preserved and the identical refusal object and fixed code are still raised.
Acceptance is therefore unchanged: the only added output is one member of
``PROVIDER_FAILURE_CATEGORIES`` (default ``None``), which is evidence about an
error category and never a claim that any particular schema keyword was
rejected.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, NamedTuple
from urllib.parse import urlsplit

__test__ = False

HARNESS = "manual_qualification_acceptance"
# Short approved MAIN root: Windows raised error 206 at 265 characters while a
# normal bootstrap path of 252 characters passed, so this harness keeps its own
# fixture paths far below the demonstrated limit.
PRIVATE_ROOT = Path("C:/Users/danie/kb/_private/p19-native")
STORE_NAME = "store.sqlite"
STAGE = "qualification_factcheck"
QUALIFICATION_CALLS = 1
MAX_RUNTIME_PATH_CHARS = 252
# Longest path the private runtime derives from the store directory:
# /snapshots/private-stage-runtime/controller-<32>/<attempt-id>/stdin.json
RUNTIME_PATH_RESERVE_CHARS = 125
START_REQUEST_ID = "5f2c9a71-3b64-4a0e-8d17-2c6b9f4e7a83"
RUN_REQUEST_ID = "7d4e1b08-92af-4c35-9e60-1ab3f58c2d47"
ALLOWED_ALLOWLISTS = frozenset({
    "fixture-v1", "operator-local-v1", "operator-public-capture-v1",
})
ZERO_TABLES = ("fill_person", "fill_firm", "contact_point", "approval", "revision")
ZERO_QUALIFICATION_TABLES = (
    "prospecting_qualification_batch", "prospecting_qualification_item",
    "prospecting_qualification_source", "prospecting_qualification_attempt",
    "prospecting_qualification_artifact",
)
EXPECTED_SCOPE = (("person", 1), ("employment", 1), ("prospecting_person_candidate", 1))

# Inner native fixed codes the diagnostic probe may report.  Nothing outside
# this bounded, source-derived allowlist is ever recorded or emitted.
NATIVE_FAILURE_CODES = frozenset({
    "private_store_invalid", "runtime_root_invalid", "runtime_bundle_changed",
    "runtime_capability_invalid", "runtime_cleanup_failed", "runtime_io_failed",
    "runtime_timeout", "runtime_manifest_invalid", "runtime_schema_invalid",
    "stage_job_invalid", "stage_input_too_large", "stage_output_invalid",
    "stage_content_invalid", "stage_runtime_failed", "prohibited_content_logged",
    "sink_scan_incomplete", "tool_event_rejected", "event_stream_invalid",
    "event_stream_incomplete", "event_line_too_large", "provider_unavailable",
    "codex_unavailable", "desktop_context_missing", "private_root_invalid",
    "attempt_exists", "attempt_directory_invalid", "attempt_path_conflict",
    "attempt_write_failed", "qualification_skill_unavailable",
    "qualification_skill_mismatch", "humanizer_skill_unavailable",
    "humanizer_skill_mismatch", "windows_job_unavailable", "process_start_failed",
    "process_wait_failed", "process_termination_failed", "job_assignment_failed",
    "stdin_path_invalid", "stdin_open_failed", "stdin_read_failed",
    "stdin_hash_mismatch", "stdin_cleanup_failed", "stdout_pipe_failed",
    "stdout_read_failed", "stdout_too_large", "stdout_limit_invalid",
    "stdout_observer_failed",
})

# Fixed provider-failure categories.  This closed enum is the only diagnostic
# derived from an explicit provider error event; no raw provider text, event
# payload, or private value is ever retained or emitted.
PROVIDER_FAILURE_CATEGORIES = frozenset({
    "unsupported_schema_unique_items", "invalid_json_schema",
    "authentication_failed", "rate_limited", "provider_error_unspecified",
})
# ``uniqueItems`` merely occurring in a message proves nothing; an explicit
# unsupported predicate must accompany it before the specific category is used.
UNIQUE_ITEMS_TOKEN = "uniqueitems"
UNSUPPORTED_PREDICATES = ("unsupported", "not supported", "not permitted")
INVALID_SCHEMA_CODES = frozenset({
    "invalid_json_schema", "invalid_schema", "schema_validation_failed",
})
INVALID_SCHEMA_PHRASES = (
    "invalid json schema", "invalid schema", "schema is invalid",
    "is not a valid json schema",
)
AUTHENTICATION_CODES = frozenset({
    "401", "invalid_api_key", "authentication_error", "unauthorized",
    "invalid_authentication",
})
RATE_LIMIT_CODES = frozenset({
    "429", "rate_limit_exceeded", "rate_limited", "rate_limit",
})
MAX_ERROR_CODE_CHARS = 128
MAX_ERROR_MESSAGE_CHARS = 2_048

FIXED_CODES = frozenset({
    # harness-owned outcomes
    "manual_opt_in_required", "run_root_unavailable", "run_root_path_too_long",
    "fixture_preparation_failed", "fixture_identity_mismatch", "fixture_sources_invalid",
    "fixture_row_scope_invalid", "fixture_qualification_not_empty",
    "machine_review_completed", "qualification_not_machine_reviewed",
    "post_run_scope_violation", "harness_unexpected_error", "unrecognized_fixed_code",
    # qualification controller codes
    "invalid_request", "invalid_request_id", "invalid_run_id", "invalid_intake_hash",
    "invalid_funding_batch", "invalid_person_batch", "invalid_predecessor",
    "invalid_item_id", "invalid_time", "invalid_stage_binding", "store_state_invalid",
    "pipeline_context_stale", "funding_batch_missing", "person_batch_missing",
    "person_history_ambiguous", "predecessor_conflict", "request_conflict",
    "transaction_active", "snapshot_store_required", "source_changed", "source_stale",
    "qualification_context_unchanged", "qualification_context_stale",
    "qualification_input_invalid", "qualification_input_too_large",
    "qualification_output_invalid", "qualification_adapter_failed",
    "qualification_adapter_unavailable", "qualification_already_complete",
    "qualification_attempts_exhausted", "qualification_attempt_failed",
    "qualification_in_progress", "qualification_conflict", "qualification_item_missing",
    "qualification_incomplete", "lease_expired", "lease_lost", "lease_active",
    "claimed_attempt_missing",
    # native adapter / private runtime codes
    "private_store_invalid", "runtime_root_invalid", "runtime_bundle_changed",
    "runtime_capability_invalid", "runtime_cleanup_failed", "runtime_io_failed",
    "runtime_timeout", "runtime_manifest_invalid", "runtime_schema_invalid",
    "stage_job_invalid", "stage_output_invalid", "stage_content_invalid",
    "stage_input_too_large", "preflight_output_invalid", "prohibited_content_logged",
    "sink_scan_incomplete", "tool_configuration_invalid", "tool_event_rejected",
    "event_stream_invalid", "event_stream_incomplete", "event_line_too_large",
    "provider_unavailable", "cache_prime_failed", "cache_prime_timeout",
    "cache_prime_missing", "codex_unavailable", "desktop_context_missing",
    "private_root_invalid", "attempt_exists", "attempt_directory_invalid",
    "attempt_path_conflict", "attempt_write_failed", "qualification_skill_unavailable",
    "qualification_skill_mismatch", "live_runtime_not_accepted",
    "windows_job_unavailable", "process_start_failed", "process_wait_failed",
    "process_termination_failed", "job_assignment_failed", "stdin_path_invalid",
    "stdin_open_failed", "stdin_read_failed", "stdin_hash_mismatch",
    "stdin_cleanup_failed", "stdout_pipe_failed", "stdout_read_failed",
    "stdout_too_large", "stage_runtime_failed", "stage_runtime_timeout",
    "stage_runtime_tool_rejected", "stage_runtime_output_invalid",
    "stage_runtime_cleanup_failed",
}) | NATIVE_FAILURE_CODES


class _Fixture(NamedTuple):
    """Opaque genuine-fixture identity: IDs, digests and counts only."""

    run_id: str
    intake_hash: str
    funding_batch_id: str
    funding_batch_hash: str
    person_batch_id: str
    person_batch_hash: str
    candidate_count: int
    source_count: int
    now: datetime
    started: Any
    funding: Any
    people: Any


class _HarnessError(Exception):
    """Fixed-category harness refusal carrying no free-form detail."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _bounded_code(value: object) -> str:
    """Return a short lowercased explicit error code, or the empty string."""
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return ""
    text = value if isinstance(value, str) else str(value)
    if not text or len(text) > MAX_ERROR_CODE_CHARS:
        return ""
    return text.strip().casefold()


def _bounded_message(value: object) -> str:
    """Return a bounded lowercased message prefix used only for matching."""
    if not isinstance(value, str) or not value:
        return ""
    return value[:MAX_ERROR_MESSAGE_CHARS].casefold()


def _explicit_error_fields(value: object) -> tuple[str, str] | None:
    """Read code/message from an explicit error event shape only.

    ``None`` is returned for every other event, so ``agent_message`` and
    ``reasoning`` items are never traversed and no other field is read.
    """
    if type(value) is not dict:
        return None
    event = value.get("type")
    if type(event) is not str:
        return None
    payload: object = None
    if event in {"error", "turn.failed"}:
        nested = value.get("error")
        payload = nested if type(nested) is dict else value
    elif event.startswith("item."):
        item = value.get("item")
        if type(item) is not dict or item.get("type") != "error":
            return None
        nested = item.get("error")
        payload = nested if type(nested) is dict else item
    if type(payload) is not dict:
        return None
    code = payload.get("code")
    if isinstance(code, bool) or not isinstance(code, (str, int)):
        code = payload.get("status")
    return _bounded_code(code), _bounded_message(payload.get("message"))


def _classify_provider_error(code: str, message: str) -> str:
    """Map one explicit provider error to a fixed category.

    The specific ``uniqueItems`` category requires both the keyword and an
    explicit unsupported predicate; a bare occurrence stays unspecified.
    """
    if UNIQUE_ITEMS_TOKEN in message and any(
        predicate in message for predicate in UNSUPPORTED_PREDICATES
    ):
        return "unsupported_schema_unique_items"
    if code in INVALID_SCHEMA_CODES or any(
        phrase in message for phrase in INVALID_SCHEMA_PHRASES
    ):
        return "invalid_json_schema"
    if code in AUTHENTICATION_CODES:
        return "authentication_failed"
    if code in RATE_LIMIT_CODES:
        return "rate_limited"
    return "provider_error_unspecified"


class _NativeCodeProbe:
    """Record one inner native fixed code and one provider category.

    The exact original ``_execute_stage`` callable is delegated to with the
    caller's arguments untouched, the raised exception object is re-raised
    unchanged, and only a fixed code already on ``NATIVE_FAILURE_CODES`` is
    kept.  No argument, result, message text, stream, or path is inspected.

    ``_EventObserver._line`` is wrapped the same way: the exact original
    callable still runs afterwards with the same arguments and raises the same
    refusal object, so acceptance cannot change.  Before delegating, only
    explicit error event shapes are classified into one closed enum member; any
    parse or inspection failure is swallowed so the original behavior remains
    authoritative.  Both bindings are restored together.
    """

    def __init__(self, native: Any, runtime: Any) -> None:
        self._native = native
        self._runtime = runtime
        self._original = native._execute_stage
        self._observer = native._EventObserver
        self._original_line = native._EventObserver._line
        self._line_limit = int(getattr(native, "_EVENT_LINE_BYTES", 256 * 1024))
        self._installed = False
        self.code: str | None = None
        self.provider_failure_category: str | None = None

    def _record(self, value: object) -> None:
        if self.code is None and isinstance(value, str) and value in NATIVE_FAILURE_CODES:
            self.code = value

    def _observe(self, line: object) -> None:
        """Classify one explicit error line; never alter observer behavior."""
        if self.provider_failure_category is not None:
            return
        try:
            if type(line) is not bytes or not line or len(line) > self._line_limit:
                return
            fields = _explicit_error_fields(self._native._strict_json(line))
            if fields is None:
                return
            category = _classify_provider_error(*fields)
        except BaseException:
            return
        if category in PROVIDER_FAILURE_CATEGORIES:
            self.provider_failure_category = category

    def install(self) -> None:
        native, runtime, original = self._native, self._runtime, self._original
        original_line = self._original_line

        def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return original(*args, **kwargs)
            except native.PrivateStageRuntimeError as error:
                self._record(getattr(error, "code", None))
                raise
            except runtime.PrivateRuntimeError as error:
                self._record(getattr(error, "code", None))
                raise

        def line_wrapper(observer: Any, line: Any) -> Any:
            self._observe(line)
            return original_line(observer, line)

        native._execute_stage = wrapper
        self._observer._line = line_wrapper
        self._installed = True

    def restore(self) -> bool:
        """Put both exact original callables back; safe to call repeatedly."""
        if self._installed:
            self._native._execute_stage = self._original
            self._observer._line = self._original_line
            self._installed = False
        return (
            self._native._execute_stage is self._original
            and self._observer._line is self._original_line
        )


def _fixed(code: object) -> str:
    return code if isinstance(code, str) and code in FIXED_CODES else "unrecognized_fixed_code"


def _error_code(error: BaseException) -> str:
    """Map any failure to one fixed code; never surface text or a traceback."""
    code = getattr(error, "code", None)
    if isinstance(code, str):
        return _fixed(code)
    text = str(error)
    return text if text in FIXED_CODES else "harness_unexpected_error"


def _emit(report: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _counts(connection: Any, *tables: str) -> tuple[int, ...]:
    return tuple(
        int(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0])
        for table in tables
    )


def _path_budget_ok(run_root: Path) -> bool:
    return len(str(run_root)) + RUNTIME_PATH_RESERVE_CHARS <= MAX_RUNTIME_PATH_CHARS


def _new_run_root() -> Path:
    from scripts.prospecting.personalizer import private_runtime as runtime

    try:
        PRIVATE_ROOT.mkdir(parents=True, exist_ok=True)
        runtime._require_plain_directory_tree(PRIVATE_ROOT)
        run_root = PRIVATE_ROOT / uuid.uuid4().hex
    except (OSError, ValueError):
        raise _HarnessError("run_root_unavailable") from None
    if not _path_budget_ok(run_root):
        raise _HarnessError("run_root_path_too_long")
    try:
        run_root.mkdir(mode=0o700)
        runtime._require_plain_directory_tree(run_root)
        return run_root
    except (OSError, ValueError):
        raise _HarnessError("run_root_unavailable") from None


def _verify_scope(connection: Any, people: Any) -> int:
    """Refuse before any model call unless the fixture is the exact empty scope."""
    rows = connection.execute(
        "SELECT source_url,allowlist_version FROM source_snapshot",
    ).fetchall()
    if not rows:
        raise _HarnessError("fixture_sources_invalid")
    for row in rows:
        host = urlsplit(str(row[0])).hostname or ""
        if not host.endswith(".test") or str(row[1]) not in ALLOWED_ALLOWLISTS:
            raise _HarnessError("fixture_sources_invalid")
    if _counts(connection, *ZERO_TABLES) != (0,) * len(ZERO_TABLES):
        raise _HarnessError("fixture_identity_mismatch")
    if _counts(connection, *ZERO_QUALIFICATION_TABLES) != (0,) * len(ZERO_QUALIFICATION_TABLES):
        raise _HarnessError("fixture_qualification_not_empty")
    if _counts(connection, *(table for table, _count in EXPECTED_SCOPE)) != tuple(
        count for _table, count in EXPECTED_SCOPE
    ):
        raise _HarnessError("fixture_row_scope_invalid")
    if int(people.counts["imported"]) != 1 or int(people.counts["source_unknown"]) != 0:
        raise _HarnessError("fixture_row_scope_invalid")
    return len(rows)


def _prepare_fixture(run_root: Path) -> tuple[Any, _Fixture]:
    """Build the genuine P15-P18 fixture with the real shared test helper."""
    from scripts.prospecting.tests.test_qualification_service import NOW, _ready_store

    connection = None
    try:
        try:
            run_root.mkdir(parents=True, exist_ok=True)
            connection, started, funding, _selected, people = _ready_store(run_root)
        except Exception:
            raise _HarnessError("fixture_preparation_failed") from None
        source_count = _verify_scope(connection, people)
        return connection, _Fixture(
            started.run_id, started.intake_hash, funding.batch_id, funding.batch_hash,
            people.batch_id, people.batch_hash, int(people.counts["imported"]),
            source_count, NOW, started, funding, people,
        )
    except BaseException:
        if connection is not None:
            try:
                connection.close()
            except BaseException:
                pass
        raise


def _run() -> int:
    try:
        from scripts.prospecting.personalizer import private_runtime as runtime
        from scripts.prospecting.personalizer import private_stage_adapter as native
        from scripts.prospecting.qualification_service import (
            QualificationError,
            QualificationService,
        )
        from scripts.prospecting.tests.test_qualification_service import (
            _qualification_request,
        )
    except BaseException:
        _emit({
            "harness": HARNESS, "schema_version": 1, "mode": "run",
            "status": "failed", "code": "harness_unexpected_error",
            "qualification_calls": 0, "native_failure_code": None,
            "provider_failure_category": None,
        })
        return 1

    probe = _NativeCodeProbe(native, runtime)
    pin_before = native.ACCEPTED_RUNTIME_BUNDLE_SHA256
    wall_started = datetime.now(timezone.utc)
    report: dict[str, Any] = {
        "harness": HARNESS, "schema_version": 1, "mode": "run",
        "status": "failed", "code": "harness_unexpected_error",
        "stage": STAGE, "requested_model": native.REQUESTED_MODEL,
        "responding_model_verified": False,
        "runtime_pin_unchanged": native.ACCEPTED_RUNTIME_BUNDLE_SHA256 == pin_before,
        "qualification_calls": 0, "stage_call": None, "native_failure_code": None,
        "provider_failure_category": None,
        "cleanup": {
            "capability_invalidated": False, "runtime_root": "not_started",
            "connection_closed": False, "adapter_cleanup_codes": [],
            "native_probe_restored": False,
        },
    }
    connection = capability = parent = stage_adapter = None
    try:
        probe.install()
        run_root = _new_run_root()
        report["run_root_id"] = run_root.name
        report["path_budget"] = {
            "run_root_chars": len(str(run_root)),
            "reserve_chars": RUNTIME_PATH_RESERVE_CHARS,
            "limit_chars": MAX_RUNTIME_PATH_CHARS,
        }
        connection, fixture = _prepare_fixture(run_root)
        report["fixture"] = {
            "run_id": fixture.run_id, "intake_hash": fixture.intake_hash,
            "funding_batch_id": fixture.funding_batch_id,
            "funding_batch_hash": fixture.funding_batch_hash,
            "person_batch_id": fixture.person_batch_id,
            "person_batch_hash": fixture.person_batch_hash,
            "candidate_count": fixture.candidate_count,
            "source_snapshot_count": fixture.source_count,
        }
        report["fixture_time_utc"] = fixture.now.isoformat()
        report["fixture_time_is_future"] = fixture.now > wall_started
        assets = native._stage_assets()
        selected = native._selected_environment(os.environ)
        executable = runtime._codex_executable(selected)
        expected_bundle = native._digest(native._bundle_manifest(
            runtime._sha_file(executable), runtime._cli_version(executable), assets,
        ))
        parent, capability = native._bootstrap(
            run_root / STORE_NAME, selected, assets=assets,
        )
        report["bundle_sha256"] = capability.bundle_sha256
        report["binary_sha256"] = capability.executable_sha256
        report["cli_version"] = capability.cli_version
        report["bundle_matches_precheck"] = capability.bundle_sha256 == expected_bundle
        if not report["bundle_matches_precheck"]:
            raise native.PrivateStageRuntimeError("runtime_bundle_changed")
        stage_adapter = native._adapters(capability, assets)[STAGE]
        binding = stage_adapter.binding
        report["stage_binding"] = {
            "executor_identity": binding.executor_identity,
            "runtime_id": binding.runtime_id,
            "schema_sha256": binding.schema_hash,
            "skill_name": binding.skill_name,
            "skill_version": binding.skill_version,
            "skill_sha256": binding.skill_content_hash,
            "skill_manifest_sha256": binding.skill_manifest_hash,
        }
        service = QualificationService(
            connection, adapters={STAGE: stage_adapter}, now=lambda: fixture.now,
        )
        batch = service.start_or_resume(_qualification_request(
            fixture.started, fixture.funding, fixture.people,
            request_id=START_REQUEST_ID,
        ))
        report["batch"] = {
            "batch_id": batch.batch_id, "batch_hash": batch.batch_hash,
            "state": batch.state, "counts": dict(batch.counts),
            "replayed": batch.replayed,
        }
        items = service.get_projection(fixture.run_id).items
        if len(items) != 1 or items[0].candidate_count != fixture.candidate_count:
            raise _HarnessError("fixture_row_scope_invalid")
        item = items[0]
        report["item_id"] = item.item_id
        if item.state != "awaiting_qualification_adapter":
            raise _HarnessError("fixture_qualification_not_empty")
        report["qualification_calls"] = QUALIFICATION_CALLS
        started_at = time.monotonic()
        try:
            result = service.run_next(item.item_id, RUN_REQUEST_ID)
        except QualificationError as error:
            report["stage_call"] = {
                "state": "failed", "code": _error_code(error),
                "elapsed_ms": round((time.monotonic() - started_at) * 1000),
            }
            report["status"] = "failed"
            report["code"] = report["stage_call"]["code"]
        else:
            report["stage_call"] = {
                "state": result.state, "code": "ok",
                "elapsed_ms": round((time.monotonic() - started_at) * 1000),
            }
            # A completed machine review is not a support claim: unknown and
            # contradicted counts stay separate, unrepaired, and unretried.
            report["result"] = {
                "item_state": result.state, "company_outcome": result.company_outcome,
                "person_counts": dict(result.person_counts),
                "context_codes": list(result.context_codes),
                "candidate_count": result.candidate_count,
            }
            report["source_supported"] = {
                "companies": int(result.company_outcome == "source_supported"),
                "people": int(result.person_counts["current_role_supported"]),
            }
            machine_reviewed = result.state == "machine_reviewed"
            report["status"] = "succeeded" if machine_reviewed else "failed"
            report["code"] = (
                "machine_review_completed" if machine_reviewed
                else "qualification_not_machine_reviewed"
            )
    except BaseException as error:
        report["status"] = "failed"
        report["code"] = _error_code(error)
    finally:
        cleanup_failed = False
        report["cleanup"]["native_probe_restored"] = probe.restore()
        report["native_failure_code"] = probe.code
        report["provider_failure_category"] = probe.provider_failure_category
        report["runtime_pin_unchanged"] = (
            native.ACCEPTED_RUNTIME_BUNDLE_SHA256 == pin_before
        )
        cleanup_failed |= not report["cleanup"]["native_probe_restored"]
        if stage_adapter is not None:
            adapter_code = native.take_adapter_cleanup_code(stage_adapter)
            report["cleanup"]["adapter_cleanup_codes"] = (
                [] if adapter_code is None else [adapter_code]
            )
        if capability is not None:
            capability.invalidated.set()
            report["cleanup"]["capability_invalidated"] = capability.invalidated.is_set()
            if parent is not None:
                try:
                    report["cleanup"]["runtime_root"] = runtime._cleanup_attempt(
                        capability.root, parent,
                    )
                except BaseException:
                    report["cleanup"]["runtime_root"] = "failed"
                    cleanup_failed = True
        if connection is not None:
            try:
                report["evidence"] = {
                    "attempts": _counts(connection, "prospecting_qualification_attempt")[0],
                    "artifacts": _counts(connection, "prospecting_qualification_artifact")[0],
                    "zero_tables_clean": _counts(connection, *ZERO_TABLES)
                    == (0,) * len(ZERO_TABLES),
                }
            except BaseException:
                report["evidence"] = {
                    "attempts": -1, "artifacts": -1, "zero_tables_clean": False,
                }
            if not report["evidence"]["zero_tables_clean"]:
                report["status"] = "failed"
                report["code"] = "post_run_scope_violation"
            try:
                connection.close()
                report["cleanup"]["connection_closed"] = True
            except BaseException:
                cleanup_failed = True
        cleanup_code = None
        if (
            cleanup_failed
            or report["cleanup"]["adapter_cleanup_codes"]
            or (capability is not None and report["cleanup"]["runtime_root"] != "deleted")
        ):
            cleanup_code = "stage_runtime_cleanup_failed"
            if report["status"] != "failed":
                report["code"] = cleanup_code
            report["status"] = "failed"
        report["cleanup_code"] = cleanup_code
    report["wall_time_started_utc"] = wall_started.isoformat()
    report["wall_time_finished_utc"] = datetime.now(timezone.utc).isoformat()
    report["elapsed_ms"] = round(
        (datetime.now(timezone.utc) - wall_started).total_seconds() * 1000
    )
    _emit(report)
    return 0 if report["status"] == "succeeded" else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog=HARNESS, description=__doc__)
    parser.add_argument(
        "--run", action="store_true",
        help="opt in to exactly one actual native qualification fact-check trial",
    )
    options = parser.parse_args(sys.argv[1:] if argv is None else argv)
    if not options.run:
        _emit({
            "harness": HARNESS, "schema_version": 1, "mode": "default",
            "status": "not_attempted", "code": "manual_opt_in_required",
            "qualification_calls": 0,
        })
        return 0
    return _run()


if __name__ == "__main__":
    raise SystemExit(main())
