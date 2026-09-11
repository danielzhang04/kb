"""Offline preparation tests for the manual P19 qualification trial harness.

Nothing here runs, or claims to have run, the manual desktop trial.  No model,
native adapter, private runtime, network, browser, credential or real store is
touched: only the harness's own fixture preparation through the genuine shared
P15-P18 helpers, and a real ``QualificationService`` with no adapters at all,
entirely inside ``tmp_path``.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit

import pytest

import scripts.prospecting.tests.manual_qualification_acceptance as harness
from scripts.prospecting.qualification_service import (
    QualificationError,
    QualificationService,
)
from scripts.prospecting.tests.test_qualification_service import (
    NOW,
    _qualification_request,
)

SOURCE = Path(harness.__file__).read_text(encoding="utf-8")
HEADER = SOURCE.split("\ndef ", 1)[0]


@pytest.fixture
def prepared(tmp_path: Path):
    connection, fixture = harness._prepare_fixture(tmp_path / "run")
    try:
        yield connection, fixture
    finally:
        connection.close()


def test_default_main_is_a_no_op_with_no_filesystem_or_model(
    tmp_path: Path, capsys, monkeypatch,
) -> None:
    def _boom(*_args, **_kwargs):
        raise AssertionError("the default invocation must do nothing")

    private_root = tmp_path / "private-root"
    monkeypatch.setattr(harness, "PRIVATE_ROOT", private_root)
    monkeypatch.setattr(harness, "_run", _boom)
    monkeypatch.setattr(harness, "_new_run_root", _boom)
    monkeypatch.setattr(harness, "_prepare_fixture", _boom)

    assert harness.main([]) == 0

    report = json.loads(capsys.readouterr().out)
    assert report["mode"] == "default"
    assert report["status"] == "not_attempted"
    assert report["code"] == "manual_opt_in_required"
    assert report["qualification_calls"] == 0
    assert not private_root.exists()
    assert list(tmp_path.iterdir()) == []


def test_run_flag_opts_in_to_exactly_one_trial(capsys, monkeypatch) -> None:
    calls = []

    def _record() -> int:
        calls.append(True)
        return 7

    monkeypatch.setattr(harness, "_run", _record)

    assert harness.main(["--run"]) == 7
    assert calls == [True]
    assert capsys.readouterr().out == ""
    assert harness.QUALIFICATION_CALLS == 1


def test_harness_imports_are_lazy_and_never_pin_the_runtime() -> None:
    """Prove laziness by inspecting the harness's own top-level AST, not its
    docstring: the genuine fixture-helper module name
    ``test_qualification_service`` legitimately appears in prose, so a plain
    substring check on the header wrongly rejects it.  This test never
    imports the native runtime module itself, since whether a bundle pin has
    since been legitimately accepted after an actual trial is none of this
    offline test's business; it only confirms the harness performs no such
    assignment.
    """
    banned_modules = frozenset({
        "private_runtime", "private_stage_adapter", "qualification_service",
        "test_qualification_service",
    })

    tree = ast.parse(SOURCE, filename=harness.__file__)

    def top_level_import_names(body: list) -> list[str]:
        names: list[str] = []
        for node in body:
            if isinstance(node, ast.Import):
                names.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    names.append(node.module)
                names.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ClassDef):
                # Descend into class bodies: a class-level import still runs
                # at module execution time.
                names.extend(top_level_import_names(node.body))
            # ast.FunctionDef / ast.AsyncFunctionDef bodies are deliberately
            # not descended into: imports inside a function body are
            # genuinely lazy and only run when that function is called.
        return names

    imported_at_module_execution = top_level_import_names(tree.body)
    imported_components = {
        component
        for dotted in imported_at_module_execution
        for component in dotted.split(".")
    }

    assert imported_components.isdisjoint(banned_modules)
    for module in banned_modules:
        # Each name is genuinely referenced somewhere (inside a lazy import
        # nested in a function body), just never at module top level.
        assert module in SOURCE

    def assigns_accepted_pin(body: list) -> bool:
        for node in body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if (
                        isinstance(target, ast.Name)
                        and target.id == "ACCEPTED_RUNTIME_BUNDLE_SHA256"
                    ):
                        return True
            elif isinstance(node, ast.AnnAssign):
                if (
                    isinstance(node.target, ast.Name)
                    and node.target.id == "ACCEPTED_RUNTIME_BUNDLE_SHA256"
                ):
                    return True
            elif isinstance(node, ast.ClassDef):
                if assigns_accepted_pin(node.body):
                    return True
        return False

    # The harness must never itself pin ACCEPTED_RUNTIME_BUNDLE_SHA256; this
    # is an AST fact about this harness only, and says nothing about whether
    # a genuine pin may later be accepted elsewhere after an actual trial.
    assert not assigns_accepted_pin(tree.body)
    assert harness.__test__ is False


def test_harness_reuses_the_genuine_fixture_helpers_without_a_fake_adapter() -> None:
    for reused in ("_ready_store", "_qualification_request"):
        assert reused in SOURCE
    for forbidden in (
        "class _Adapter", "_supported_payload", "StageResult(", "def _seed(",
        "def _person(", "def _write(", "monkeypatch",
    ):
        assert forbidden not in SOURCE
    # No captured page text, note, or model prose may reach stdout.
    for prose in ("payload_json", "derived_json", '"source_url"', "observed_title"):
        assert prose not in SOURCE


def test_prepare_fixture_is_genuine_p15_p18_with_no_qualification_rows(prepared) -> None:
    connection, fixture = prepared

    assert harness._counts(connection, *harness.ZERO_QUALIFICATION_TABLES) == (0,) * len(
        harness.ZERO_QUALIFICATION_TABLES
    )
    assert harness._counts(connection, "person", "employment") == (1, 1)
    assert fixture.candidate_count == 1
    assert fixture.run_id.startswith("prun_")
    assert len(fixture.funding_batch_hash) == 64 and len(fixture.person_batch_hash) == 64
    assert fixture.now == NOW


def test_prepare_fixture_sources_are_synthetic_test_urls_on_the_allowlist(prepared) -> None:
    connection, fixture = prepared

    rows = connection.execute(
        "SELECT source_url,allowlist_version FROM source_snapshot",
    ).fetchall()
    assert rows and len(rows) == fixture.source_count
    for row in rows:
        assert (urlsplit(str(row[0])).hostname or "").endswith(".test")
        assert str(row[1]) in harness.ALLOWED_ALLOWLISTS


def test_prepare_fixture_writes_no_contact_fill_or_approval_rows(prepared) -> None:
    connection, _fixture = prepared

    assert harness.ZERO_TABLES == (
        "fill_person", "fill_firm", "contact_point", "approval", "revision",
    )
    assert harness._counts(connection, *harness.ZERO_TABLES) == (0,) * len(harness.ZERO_TABLES)


def test_supplemental_fixture_uses_real_import_history_and_binds_all_source_kinds(
    tmp_path: Path,
) -> None:
    connection, fixture = harness._prepare_fixture(tmp_path / "supplemental", supplemental=True)
    try:
        assert fixture.supplemental is True
        assert fixture.candidate_count == 2
        assert harness._counts(connection, *harness.ZERO_QUALIFICATION_TABLES) == (0,) * len(
            harness.ZERO_QUALIFICATION_TABLES
        )
        assert harness._counts(connection, "person", "employment", "prospecting_person_candidate") == (2, 2, 3)
        service = QualificationService(connection, adapters={}, now=lambda: NOW)
        batch = service.start_or_resume(_qualification_request(
            fixture.started, fixture.funding, fixture.people,
            request_id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        ))
        assert batch.state == "awaiting_qualification_adapter"
        item = service.get_projection(fixture.run_id).items[0]
        assert item.candidate_count == 2
        rows = connection.execute(
            """SELECT origin_kind,context_relation,source_kind,binding_kind,count(*)
                 FROM prospecting_qualification_source WHERE item_id=?
                 GROUP BY origin_kind,context_relation,source_kind,binding_kind
                 ORDER BY origin_kind,context_relation,source_kind,binding_kind""",
            (item.item_id,),
        ).fetchall()
        assert {
            tuple(row) for row in rows
        } == {
            ("funding", "current", "issuer", "company_identity", 1),
            ("funding", "current", "issuer", "funding_event", 1),
            ("funding", "current", "search_coverage", "coverage", 1),
            ("person", "current", None, None, 2),
            ("person", "potential_conflict", None, None, 1),
        }
        assert harness._counts(
            connection, "prospecting_qualification_attempt", "prospecting_qualification_artifact",
        ) == (0, 0)
    finally:
        connection.close()


def test_stage_start_without_adapter_waits_with_fixed_code_and_no_attempts(prepared) -> None:
    """No adapter exists at all, so no model is reachable from pytest."""
    connection, fixture = prepared
    service = QualificationService(connection, adapters={}, now=lambda: NOW)

    batch = service.start_or_resume(_qualification_request(
        fixture.started, fixture.funding, fixture.people,
        request_id=harness.START_REQUEST_ID,
    ))
    items = service.get_projection(fixture.run_id).items

    assert batch.state == "awaiting_qualification_adapter"
    assert batch.counts["machine_reviewed"] == 0
    assert len(items) == 1
    assert items[0].state == "awaiting_qualification_adapter"
    assert items[0].candidate_count == 1
    assert items[0].company_outcome is None
    with pytest.raises(QualificationError) as refused:
        service.run_next(items[0].item_id, harness.RUN_REQUEST_ID)
    assert str(refused.value) == "qualification_adapter_unavailable"
    assert str(refused.value) in harness.FIXED_CODES
    assert harness._counts(
        connection, "prospecting_qualification_attempt",
        "prospecting_qualification_artifact",
    ) == (0, 0)


def test_prepare_fixture_closes_its_connection_on_scope_failure(tmp_path: Path, monkeypatch) -> None:
    seen = []

    def _refusing(connection, _people):
        seen.append(connection)
        raise harness._HarnessError("fixture_row_scope_invalid")

    monkeypatch.setattr(harness, "_verify_scope", _refusing)

    with pytest.raises(harness._HarnessError) as refused:
        harness._prepare_fixture(tmp_path / "run")

    assert refused.value.code == "fixture_row_scope_invalid"
    assert refused.value.code in harness.FIXED_CODES
    assert len(seen) == 1
    with pytest.raises(sqlite3.ProgrammingError):
        seen[0].execute("SELECT 1")


def test_path_budget_keeps_fixture_paths_under_the_demonstrated_windows_limit() -> None:
    run_root = harness.PRIVATE_ROOT / ("0" * 32)

    # Compare structured path components (and the platform-independent POSIX
    # form) rather than the native string representation, which uses
    # backslashes on Windows and would never match a forward-slash suffix.
    assert harness.PRIVATE_ROOT.parts[-2:] == ("_private", "p19-native")
    assert harness.PRIVATE_ROOT.as_posix().endswith("_private/p19-native")
    assert harness._path_budget_ok(run_root)
    assert len(str(run_root)) + harness.RUNTIME_PATH_RESERVE_CHARS <= 252
    assert harness.MAX_RUNTIME_PATH_CHARS == 252
    assert not harness._path_budget_ok(Path("C:/" + "d" * 250))


def test_fixed_codes_cover_the_controller_and_runtime_refusals() -> None:
    for code in (
        "qualification_adapter_unavailable", "qualification_output_invalid",
        "qualification_adapter_failed", "source_changed", "source_stale",
        "stage_runtime_failed", "stage_runtime_cleanup_failed", "provider_unavailable",
        "live_runtime_not_accepted", "manual_opt_in_required",
    ):
        assert code in harness.FIXED_CODES
    assert harness._fixed("definitely-not-a-code") == "unrecognized_fixed_code"
    assert harness._fixed(None) == "unrecognized_fixed_code"
    assert harness._error_code(RuntimeError("boom")) == "harness_unexpected_error"
    assert harness._error_code(
        QualificationError("source_changed"),
    ) == "source_changed"


def test_single_trial_request_identities_are_distinct_uuid4() -> None:
    import uuid

    identities = (harness.START_REQUEST_ID, harness.RUN_REQUEST_ID)

    assert len(set(identities)) == 2
    for value in identities:
        parsed = uuid.UUID(value)
        assert parsed.version == 4 and str(parsed) == value


class _ProbeStageError(Exception):
    """Stand-in for the native fixed-code refusal; never a real adapter."""

    def __init__(self, code: object) -> None:
        self.code = code
        super().__init__("suppressed")


class _ProbeRuntimeError(Exception):
    """Stand-in for the private runtime fixed-code refusal."""

    def __init__(self, code: object) -> None:
        self.code = code
        super().__init__("suppressed")


class _ProbeModule:
    """Exposes only the attributes the probe is permitted to touch."""

    def __init__(self, **values: object) -> None:
        self.__dict__.update(values)


class _ProbeEventObserver:
    """Stand-in observer whose ``_line`` is the exact original callable.

    It records the line it was given and raises a fixed-code refusal, so a
    test can prove the original still runs and still refuses identically.
    """

    def __init__(self) -> None:
        self.seen: list[object] = []

    def _line(self, line: object) -> None:
        self.seen.append(line)
        raise _ProbeRuntimeError("provider_unavailable")


def _strict(value: bytes) -> object:
    """Stand-in for the adapter's existing strict parser."""
    return json.loads(value)


def _event(payload: object) -> bytes:
    return json.dumps(payload, separators=(",", ":")).encode()


def _probe(original):
    native = _ProbeModule(
        _execute_stage=original, PrivateStageRuntimeError=_ProbeStageError,
        REQUESTED_MODEL="synthetic-model", ACCEPTED_RUNTIME_BUNDLE_SHA256=None,
        _EventObserver=_ProbeEventObserver, _strict_json=_strict,
        _EVENT_LINE_BYTES=256 * 1024,
    )
    runtime = _ProbeModule(PrivateRuntimeError=_ProbeRuntimeError)
    return harness._NativeCodeProbe(native, runtime), native, runtime


def test_native_failure_allowlist_is_a_bounded_inner_subset() -> None:
    assert harness.NATIVE_FAILURE_CODES <= harness.FIXED_CODES
    for inner in (
        "provider_unavailable", "event_stream_invalid", "event_stream_incomplete",
        "tool_event_rejected", "stage_output_invalid", "stage_job_invalid",
        "runtime_timeout", "runtime_bundle_changed", "prohibited_content_logged",
        "qualification_skill_mismatch", "stage_runtime_failed",
    ):
        assert inner in harness.NATIVE_FAILURE_CODES
    for outer_only in (
        "qualification_adapter_failed", "qualification_output_invalid",
        "manual_opt_in_required", "machine_review_completed",
        "stage_runtime_tool_rejected", "unrecognized_fixed_code",
    ):
        assert outer_only not in harness.NATIVE_FAILURE_CODES


def test_probe_delegates_the_exact_callable_and_restores_it() -> None:
    seen = []

    def original(capability, job, asset):
        seen.append((capability, job, asset))
        return "delegated"

    probe, native, _runtime = _probe(original)
    probe.install()

    assert native._execute_stage is not original
    assert native._execute_stage("c", "j", "a") == "delegated"
    assert seen == [("c", "j", "a")]
    assert probe.code is None
    assert probe.restore() is True
    assert native._execute_stage is original
    # Restoring twice is safe and still reports the original binding.
    assert probe.restore() is True
    assert native._execute_stage is original


def test_probe_records_allowlisted_code_and_rethrows_the_same_exception() -> None:
    error = _ProbeStageError("provider_unavailable")

    def original(*_args, **_kwargs):
        raise error

    probe, native, _runtime = _probe(original)
    probe.install()
    try:
        with pytest.raises(_ProbeStageError) as caught:
            native._execute_stage("c", "j", "a")
    finally:
        assert probe.restore() is True

    assert caught.value is error
    assert probe.code == "provider_unavailable"
    assert probe.code in harness.NATIVE_FAILURE_CODES


def test_probe_records_private_runtime_fixed_code_as_well() -> None:
    def original(*_args, **_kwargs):
        raise _ProbeRuntimeError("stdout_read_failed")

    probe, native, _runtime = _probe(original)
    probe.install()
    try:
        with pytest.raises(_ProbeRuntimeError):
            native._execute_stage("c", "j", "a")
    finally:
        probe.restore()

    assert probe.code == "stdout_read_failed"


@pytest.mark.parametrize(
    "code", ["definitely-not-a-code", None, 7, "qualification_adapter_failed"],
)
def test_probe_never_records_unknown_or_outer_only_codes(code) -> None:
    def original(*_args, **_kwargs):
        raise _ProbeStageError(code)

    probe, native, _runtime = _probe(original)
    probe.install()
    try:
        with pytest.raises(_ProbeStageError):
            native._execute_stage("c", "j", "a")
    finally:
        probe.restore()

    assert probe.code is None


def test_probe_keeps_only_the_first_allowlisted_code() -> None:
    codes = iter(("runtime_timeout", "provider_unavailable"))

    def original(*_args, **_kwargs):
        raise _ProbeStageError(next(codes))

    probe, native, _runtime = _probe(original)
    probe.install()
    try:
        for _ in range(2):
            with pytest.raises(_ProbeStageError):
                native._execute_stage("c", "j", "a")
    finally:
        probe.restore()

    assert probe.code == "runtime_timeout"


def test_probe_passes_through_other_exception_types_without_recording() -> None:
    def original(*_args, **_kwargs):
        raise RuntimeError("provider_unavailable")

    probe, native, _runtime = _probe(original)
    probe.install()
    try:
        with pytest.raises(RuntimeError):
            native._execute_stage("c", "j", "a")
    finally:
        probe.restore()

    assert probe.code is None


def test_probe_touches_only_the_execute_stage_binding() -> None:
    def original(*_args, **_kwargs):
        return None

    probe, native, runtime = _probe(original)
    before_native = dict(native.__dict__)
    before_runtime = dict(runtime.__dict__)
    before_line = vars(_ProbeEventObserver)["_line"]

    probe.install()
    changed = {
        key for key, value in native.__dict__.items() if before_native[key] is not value
    }
    assert changed == {"_execute_stage"}
    assert runtime.__dict__ == before_runtime
    # The only other touched binding is the observer's own ``_line``.
    assert vars(_ProbeEventObserver)["_line"] is not before_line

    assert probe.restore() is True
    assert native.__dict__ == before_native
    assert runtime.__dict__ == before_runtime
    assert vars(_ProbeEventObserver)["_line"] is before_line


def test_report_contract_defaults_and_pin_equality_are_source_bound() -> None:
    # Default reported category is None; only probe-recorded fixed codes appear.
    assert '"native_failure_code": None' in SOURCE
    assert 'report["native_failure_code"] = probe.code' in SOURCE
    # The provider category also defaults to None and is only ever the probe's
    # own closed enum value; no raw text or event dump is reported.
    assert '"provider_failure_category": None' in SOURCE
    assert (
        'report["provider_failure_category"] = probe.provider_failure_category'
        in SOURCE
    )
    # The pin is reported by before/after equality, not by an is-None claim.
    assert "native.ACCEPTED_RUNTIME_BUNDLE_SHA256 == pin_before" in SOURCE
    assert "ACCEPTED_RUNTIME_BUNDLE_SHA256 is None" not in SOURCE
    # Installed once, restored in the harness cleanup path.
    assert SOURCE.count("probe.install()") == 1
    assert 'report["cleanup"]["native_probe_restored"] = probe.restore()' in SOURCE
    # Still exactly one qualification call and one declared trial.
    assert SOURCE.count("service.run_next(") == 1
    assert harness.QUALIFICATION_CALLS == 1


def test_provider_failure_categories_are_a_closed_enum() -> None:
    assert harness.PROVIDER_FAILURE_CATEGORIES == frozenset({
        "unsupported_schema_unique_items", "invalid_json_schema",
        "authentication_failed", "rate_limited", "provider_error_unspecified",
    })
    # Categories are diagnostic evidence, not controller/runtime fixed codes.
    assert harness.PROVIDER_FAILURE_CATEGORIES.isdisjoint(harness.FIXED_CODES)
    assert harness.PROVIDER_FAILURE_CATEGORIES.isdisjoint(
        harness.NATIVE_FAILURE_CODES,
    )


@pytest.mark.parametrize(
    "event,expected",
    [
        (
            {
                "type": "error",
                "message": "Invalid schema: 'uniqueItems' is not supported.",
            },
            "unsupported_schema_unique_items",
        ),
        (
            {
                "type": "turn.failed",
                "error": {"message": "The key uniqueItems is unsupported here."},
            },
            "unsupported_schema_unique_items",
        ),
        (
            {
                "type": "item.completed",
                "item": {
                    "type": "error",
                    "error": {"message": "uniqueItems is not permitted."},
                },
            },
            "unsupported_schema_unique_items",
        ),
        (
            {"type": "error", "error": {"code": "invalid_json_schema"}},
            "invalid_json_schema",
        ),
        (
            {"type": "turn.failed", "error": {"message": "Invalid schema supplied."}},
            "invalid_json_schema",
        ),
        (
            {"type": "error", "error": {"code": 401, "message": "no credentials"}},
            "authentication_failed",
        ),
        (
            {"type": "error", "error": {"code": "invalid_api_key"}},
            "authentication_failed",
        ),
        (
            {"type": "turn.failed", "error": {"code": "rate_limit_exceeded"}},
            "rate_limited",
        ),
        (
            {
                "type": "item.completed",
                "item": {"type": "error", "error": {"status": 429}},
            },
            "rate_limited",
        ),
        (
            {"type": "turn.failed", "error": {"message": "upstream reset"}},
            "provider_error_unspecified",
        ),
        ({"type": "error"}, "provider_error_unspecified"),
    ],
)
def test_classifier_maps_explicit_error_events(event, expected) -> None:
    fields = harness._explicit_error_fields(event)

    assert fields is not None
    assert harness._classify_provider_error(*fields) == expected
    assert expected in harness.PROVIDER_FAILURE_CATEGORIES


def test_bare_unique_items_occurrence_is_never_a_rejection_claim() -> None:
    """Occurrence alone is not evidence; an unsupported predicate is required."""
    for message in (
        "uniqueItems was applied to 3 arrays",
        "schema contains uniqueItems",
        "uniqueItems true",
    ):
        fields = harness._explicit_error_fields(
            {"type": "turn.failed", "error": {"message": message}},
        )
        assert harness._classify_provider_error(*fields) == "provider_error_unspecified"


@pytest.mark.parametrize(
    "event",
    [
        {"type": "item.completed", "item": {"type": "agent_message"}},
        {"type": "item.updated", "item": {"type": "reasoning"}},
        {"type": "item.started", "item": {"type": "agent_message"}},
        {"type": "turn.completed"},
        {"type": "thread.started"},
        {"type": "turn.started"},
        {"item": {"type": "error"}},
        ["error"],
    ],
)
def test_non_error_shapes_are_never_inspected(event) -> None:
    assert harness._explicit_error_fields(event) is None


def test_probe_classifies_error_line_and_still_runs_the_original_line() -> None:
    def original(*_args, **_kwargs):
        return None

    probe, native, _runtime = _probe(original)
    original_line = vars(_ProbeEventObserver)["_line"]
    observer = native._EventObserver()
    line = _event({
        "type": "turn.failed",
        "error": {"code": "invalid_json_schema", "message": "Invalid schema."},
    })

    probe.install()
    try:
        with pytest.raises(_ProbeRuntimeError) as refused:
            native._EventObserver._line(observer, line)
    finally:
        assert probe.restore() is True

    # The original observer refusal object and its fixed code are unchanged.
    assert refused.value.code == "provider_unavailable"
    assert refused.value.code in harness.NATIVE_FAILURE_CODES
    assert observer.seen == [line]
    assert probe.provider_failure_category == "invalid_json_schema"
    assert vars(_ProbeEventObserver)["_line"] is original_line


def test_probe_default_category_is_none_and_ignores_private_agent_messages() -> None:
    def original(*_args, **_kwargs):
        return None

    probe, native, _runtime = _probe(original)
    observer = native._EventObserver()
    assert probe.provider_failure_category is None

    probe.install()
    try:
        for payload in (
            {"type": "item.completed", "item": {"type": "agent_message"}},
            {"type": "item.updated", "item": {"type": "reasoning"}},
            {"type": "turn.completed"},
        ):
            with pytest.raises(_ProbeRuntimeError):
                native._EventObserver._line(observer, _event(payload))
    finally:
        assert probe.restore() is True

    assert probe.provider_failure_category is None


def test_probe_keeps_only_the_first_classified_category() -> None:
    def original(*_args, **_kwargs):
        return None

    probe, native, _runtime = _probe(original)
    observer = native._EventObserver()

    probe.install()
    try:
        for payload in (
            {"type": "error", "error": {"code": 429}},
            {"type": "error", "error": {"code": "invalid_json_schema"}},
        ):
            with pytest.raises(_ProbeRuntimeError):
                native._EventObserver._line(observer, _event(payload))
    finally:
        probe.restore()

    assert probe.provider_failure_category == "rate_limited"


def test_probe_swallows_unparsable_lines_while_the_original_still_refuses() -> None:
    def original(*_args, **_kwargs):
        return None

    probe, native, _runtime = _probe(original)
    observer = native._EventObserver()

    probe.install()
    try:
        for line in (b"{not json", b"", b"[]", b"null", "not-bytes"):
            with pytest.raises(_ProbeRuntimeError):
                native._EventObserver._line(observer, line)
    finally:
        assert probe.restore() is True

    assert probe.provider_failure_category is None
    assert len(observer.seen) == 5


def test_probe_retains_no_raw_provider_text() -> None:
    def original(*_args, **_kwargs):
        return None

    probe, native, _runtime = _probe(original)
    observer = native._EventObserver()
    secret = "uniqueItems is not supported for https://example.invalid/x"

    probe.install()
    try:
        with pytest.raises(_ProbeRuntimeError):
            native._EventObserver._line(
                observer, _event({"type": "error", "error": {"message": secret}}),
            )
    finally:
        probe.restore()

    assert probe.provider_failure_category == "unsupported_schema_unique_items"
    for value in vars(probe).values():
        assert not isinstance(value, (bytes, bytearray))
        if isinstance(value, str):
            assert value in harness.PROVIDER_FAILURE_CATEGORIES | harness.FIXED_CODES


def test_probe_still_records_the_inner_fixed_code_alongside_the_category() -> None:
    def original(*_args, **_kwargs):
        raise _ProbeStageError("provider_unavailable")

    probe, native, _runtime = _probe(original)
    observer = native._EventObserver()

    probe.install()
    try:
        with pytest.raises(_ProbeRuntimeError):
            native._EventObserver._line(
                observer, _event({"type": "error", "error": {"code": "unmapped_code"}}),
            )
        with pytest.raises(_ProbeStageError):
            native._execute_stage("c", "j", "a")
    finally:
        assert probe.restore() is True

    assert probe.code == "provider_unavailable"
    # An unmatched private provider error yields only the fixed default.
    assert probe.provider_failure_category == "provider_error_unspecified"
