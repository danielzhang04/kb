"""Integration tests for the private ``--locate`` span-locator CLI mode.

These drive the real ``capture_import_cli.main`` against a real private store,
real P23 captures produced by the genuine capture lifecycle, and the real
compiler.  Located spans are fed straight back into a real compile and a real
P17 import, so the offsets are checked by the production consumer rather than
only restated here.  Fixture text is synthetic.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.prospecting.capture_import_compiler import (
    COMPILER_VERSION,
    MAX_MATCHES_PER_NEEDLE,
    MAX_NEEDLES,
    MAX_NEEDLE_BYTES,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_capture_import_cli import (
    FUNDING_URL,
    QUERY,
    _capture_json,
    _cli,
    _exports,
    _funding_input,
    _import_funding,
    _ok,
    _prepare,
    _refused,
    _write,
)
from scripts.prospecting.tests.test_capture_import_compiler import (
    SEARCH_TEXT,
    _capture,
    _table_counts,
)


# One leading astral codepoint, so a byte-offset reading of any later span
# would disagree with the codepoint-offset reading the compiler requires.
LOCATE_TEXT = (
    "\U0001F680 Nimbus Systems announced series_b on 2025-05-01. "
    "ааа series_b."
)
PHRASE = "announced series_b on 2025-05-01."
OVERLAPPING = "аа"
NEEDLES = ("series_b", OVERLAPPING, "Zeta Corp", PHRASE)


def _locate_input(started, session, ref, needles=NEEDLES) -> dict:
    return {
        "session_id": session.session_id,
        "run_id": started.run_id,
        "expected_intake_hash": started.intake_hash,
        "capture": _capture_json(ref),
        "needles": list(needles),
    }


def _pair(captures, session, ids, root: Path, text: str = LOCATE_TEXT, suffix: str = "loc"):
    event_ref = _capture(
        captures, session, ids, root, name=f"event-{suffix}", text=text, url=FUNDING_URL,
    )
    search_ref = _capture(
        captures, session, ids, root, name=f"search-{suffix}", text=SEARCH_TEXT, query=QUERY,
    )
    return event_ref, search_ref


def _artefact(root: Path, output: dict) -> dict:
    path = root / "snapshots" / output["artefact_ref"]
    return json.loads(path.read_text(encoding="utf-8"))


def test_locate_reports_exact_codepoint_spans_and_feeds_a_real_compile(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(tmp_path, monkeypatch)
    event_ref, search_ref = _pair(captures, session, ids, root)
    before = _table_counts(connection)
    connection.close()

    source = _write(
        root / "snapshots", _locate_input(started, session, event_ref), "locate/one.json",
    )
    output = _ok(store, "--locate", source, capsys)
    assert set(output) == {
        "status", "kind", "exported", "artefact_ref", "artefact_sha256", "counts",
    }
    assert (output["status"], output["kind"], output["exported"]) == ("located", "locate", True)
    assert output["counts"] == {
        "needles": 4, "no_match": 1, "single_match": 1,
        "multiple_matches": 2, "matches": 5,
    }

    artefact = _artefact(root, output)
    assert artefact["kind"] == "capture-locate-report"
    assert artefact["compiler_version"] == COMPILER_VERSION
    assert artefact["text_codepoints"] == len(LOCATE_TEXT)
    assert artefact["capture"]["task_id"] == event_ref.task_id
    assert artefact["capture"]["receipt_id"] == event_ref.expected_receipt_id
    assert artefact["capture"]["content_sha256"] == event_ref.expected_content_sha256
    assert artefact["capture"]["expires_at"] and artefact["capture"]["body_ref"]

    entries = artefact["needles"]
    assert [entry["ordinal"] for entry in entries] == [0, 1, 2, 3]
    assert [entry["state"] for entry in entries] == [
        "multiple_matches", "multiple_matches", "no_match", "single_match",
    ]
    for entry, needle in zip(entries, NEEDLES):
        spans = entry["spans"]
        assert entry["match_count"] == len(spans)
        assert [span["start"] for span in spans] == sorted(
            span["start"] for span in spans
        )
        for span in spans:
            # The span is an exact half-open Unicode codepoint slice.
            assert LOCATE_TEXT[span["start"]:span["end"]] == needle
    # Overlapping occurrences are both reported, not collapsed.
    assert [span["start"] for span in entries[1]["spans"]] == [
        LOCATE_TEXT.index(OVERLAPPING), LOCATE_TEXT.index(OVERLAPPING) + 1,
    ]
    # A byte-oriented reading of the same offsets would not agree.
    phrase_span = entries[3]["spans"][0]
    assert (
        LOCATE_TEXT.encode("utf-8")[phrase_span["start"]:phrase_span["end"]]
        != PHRASE.encode("utf-8")
    )
    # Neither the needles nor the captured text travel in the artefact.
    rendered = json.dumps(artefact, ensure_ascii=False)
    for value in (*NEEDLES, LOCATE_TEXT, FUNDING_URL):
        assert value not in rendered

    # The located span is accepted verbatim by the real compiler and importer.
    payload = _funding_input(started, session, ids, event_ref, search_ref)
    payload["companies"][0]["events"][0]["excerpt"] = {
        "start": phrase_span["start"], "end": phrase_span["end"],
    }
    compile_source = _write(root / "snapshots", payload, "locate/funding.json")
    compiled = _ok(store, "--compile-funding", compile_source, capsys)
    exported = root / "snapshots" / compiled["request_ref"]
    request = json.loads(exported.read_text(encoding="utf-8"))
    assert request["candidates"][0]["events"][0]["excerpt"] == PHRASE
    _parsed, result, selected = _import_funding(store, exported)
    assert result.counts["provisional_matches"] == 1
    assert selected.rule_outcome == "provisional_match"

    probe = open_store(store)
    try:
        after = _table_counts(probe)
    finally:
        probe.close()
    # Locating wrote no row of its own; only the later import did.
    assert after["prospecting_capture_receipt"] == before["prospecting_capture_receipt"]
    assert after["prospecting_capture_task"] == before["prospecting_capture_task"]


def test_locate_writes_no_row_and_exactly_one_fresh_artefact_per_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(tmp_path, monkeypatch)
    event_ref, _search_ref = _pair(captures, session, ids, root, suffix="rows")
    before = _table_counts(connection)
    connection.close()
    source = _write(
        root / "snapshots", _locate_input(started, session, event_ref), "locate/rows.json",
    )

    first = _ok(store, "--locate", source, capsys)
    second = _ok(store, "--locate", source, capsys)
    assert first["artefact_ref"] != second["artefact_ref"]
    assert _artefact(root, first)["needles"] == _artefact(root, second)["needles"]
    assert len(_exports(root)) == 2

    probe = open_store(store)
    try:
        assert _table_counts(probe) == before
    finally:
        probe.close()


def test_wrong_scope_stale_hash_and_wrong_receipt_are_refused_with_no_artefact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(tmp_path, monkeypatch)
    event_ref, _search_ref = _pair(captures, session, ids, root, suffix="scope")
    from scripts.prospecting.research_capture_service import CaptureSessionRequest

    other = captures.start_session(CaptureSessionRequest(
        ids.next(), started.run_id, started.intake_hash, "c" * 64,
    ))
    connection.close()
    snapshots = root / "snapshots"

    wrong_session = _locate_input(started, session, event_ref)
    wrong_session["session_id"] = other.session_id
    assert _refused(
        store, "--locate", _write(snapshots, wrong_session, "locate/session.json"), capsys,
    ) == "capture_scope_mismatch"

    stale_intake = _locate_input(started, session, event_ref)
    stale_intake["expected_intake_hash"] = "b" * 64
    assert _refused(
        store, "--locate", _write(snapshots, stale_intake, "locate/intake.json"), capsys,
    ) == "capture_scope_mismatch"

    wrong_run = _locate_input(started, session, event_ref)
    wrong_run["run_id"] = "prun_" + "0" * 32
    assert _refused(
        store, "--locate", _write(snapshots, wrong_run, "locate/run.json"), capsys,
    ) == "capture_scope_mismatch"

    wrong_receipt = _locate_input(started, session, event_ref)
    wrong_receipt["capture"]["expected_receipt_id"] = "pcr_" + "0" * 32
    assert _refused(
        store, "--locate", _write(snapshots, wrong_receipt, "locate/receipt.json"), capsys,
    ) == "receipt_mismatch"

    wrong_hash = _locate_input(started, session, event_ref)
    wrong_hash["capture"]["expected_content_sha256"] = "0" * 64
    assert _refused(
        store, "--locate", _write(snapshots, wrong_hash, "locate/hash.json"), capsys,
    ) == "content_sha256_mismatch"

    assert _exports(root) == []


def test_needle_shape_and_count_limits_are_refused_before_the_store_opens(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(tmp_path, monkeypatch)
    event_ref, _search_ref = _pair(captures, session, ids, root, suffix="limits")
    connection.close()
    snapshots = root / "snapshots"

    for name, needles in (
        ("empty-list", []),
        ("too-many", [f"n{index}" for index in range(MAX_NEEDLES + 1)]),
        ("too-long", ["a" * (MAX_NEEDLE_BYTES + 1)]),
        ("blank", [""]),
        ("untrimmed", [" series_b"]),
        ("control", ["series\x01b"]),
        ("duplicate", ["series_b", "series_b"]),
        ("not-a-string", [7]),
    ):
        payload = _locate_input(started, session, event_ref, needles)
        assert _refused(
            store, "--locate", _write(snapshots, payload, f"locate/{name}.json"), capsys,
        ) == "locate_input_schema_invalid"

    extra = _locate_input(started, session, event_ref)
    extra["note"] = "unexpected"
    assert _refused(
        store, "--locate", _write(snapshots, extra, "locate/extra.json"), capsys,
    ) == "locate_input_schema_invalid"

    nested = _locate_input(started, session, event_ref)
    nested["capture"]["source_url"] = FUNDING_URL
    assert _refused(
        store, "--locate", _write(snapshots, nested, "locate/nested.json"), capsys,
    ) == "locate_input_schema_invalid"

    outside = _write(tmp_path, _locate_input(started, session, event_ref), "outside.json")
    assert _refused(
        store, "--locate", outside, capsys,
    ) == "locate_input_snapshot_required"
    assert _exports(root) == []


def test_match_budget_overflow_refuses_instead_of_truncating(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    """An over-wide result is refused, never silently cut down to the cap."""
    root, store, started, ids, captures, session, connection = _prepare(tmp_path, monkeypatch)
    dense = "a" * (MAX_MATCHES_PER_NEEDLE + 8) + " tail"
    per_needle_ref = _capture(
        captures, session, ids, root, name="dense", text=dense, url=FUNDING_URL,
    )
    spread = " ".join(letter * 60 for letter in "abcde")
    total_ref = _capture(
        captures, session, ids, root, name="spread", text=spread,
        url="https://nimbus.test/spread",
    )
    connection.close()
    snapshots = root / "snapshots"

    assert _refused(
        store, "--locate",
        _write(
            snapshots, _locate_input(started, session, per_needle_ref, ["a"]),
            "locate/dense.json",
        ),
        capsys,
    ) == "match_budget_exceeded"

    assert _refused(
        store, "--locate",
        _write(
            snapshots,
            _locate_input(started, session, total_ref, list("abcde")),
            "locate/spread.json",
        ),
        capsys,
    ) == "match_budget_exceeded"
    assert _exports(root) == []


def test_needles_and_captured_text_never_reach_stdout_or_stderr(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    root, store, started, ids, captures, session, connection = _prepare(tmp_path, monkeypatch)
    event_ref, _search_ref = _pair(captures, session, ids, root, suffix="leak")
    connection.close()
    good = _write(
        root / "snapshots", _locate_input(started, session, event_ref), "locate/leak.json",
    )
    bad = _locate_input(started, session, event_ref)
    bad["capture"]["expected_receipt_id"] = "pcr_" + "0" * 32
    broken = _write(root / "snapshots", bad, "locate/leak-bad.json")

    for option_value in (good, broken):
        _code, out, err = _cli(store, "--locate", option_value, capsys)
        for value in (*NEEDLES, LOCATE_TEXT, FUNDING_URL, QUERY, str(option_value)):
            assert value not in out
            assert value not in err
        assert "Traceback" not in err
