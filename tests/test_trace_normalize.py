"""Wave E — Flight Recorder normalizer tests (scripts/trace_normalize.py).

Hermetic: synthetic control-plane store documents in tmp_path exercise the
normalizer against the discovered store FORMAT. The real engine has never run,
so these fixtures stand in for stored executions.
"""
import json
from pathlib import Path

import trace_normalize as tn


def _store(tmp_path, document) -> Path:
    root = tmp_path / "state"
    (root / "control").mkdir(parents=True, exist_ok=True)
    path = root / "control" / "control-plane.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


def _doc(**over) -> dict:
    base = {
        "version": 1, "nextEventCursor": 10, "proposals": [],
        "runs": [{"subject": "card-1", "runRef": "run-a", "title": "Do work",
                  "state": "succeeded", "createdAt": "2026-07-20T10:00:00+00:00",
                  "updatedAt": "2026-07-20T10:05:00+00:00"}],
        "stages": [{"subject": "card-1", "runRef": "run-a", "stageRef": "stage-1",
                    "stageId": "s1", "title": "Build", "state": "succeeded",
                    "createdAt": "2026-07-20T10:00:00+00:00",
                    "updatedAt": "2026-07-20T10:03:00+00:00"}],
        "attempts": [{"subject": "card-1", "runRef": "run-a", "attemptRef": "att-1",
                      "stageRef": "stage-1", "runtime": "claude",
                      "model": "opus-4-8", "state": "succeeded",
                      "createdAt": "2026-07-20T10:00:10+00:00",
                      "updatedAt": "2026-07-20T10:02:50+00:00"}],
        "sessions": [],
        "humanRequests": [],
        "events": [{"subject": "card-1", "runRef": "run-a", "cursor": 1,
                    "kind": "tool", "source": "worker", "stageRef": "stage-1",
                    "attemptRef": "att-1", "sessionRef": None, "status": "success",
                    "summary": None, "command": None, "toolName": "Read",
                    "path": "scripts/x.py", "diff": None, "checkpoint": None,
                    "createdAt": "2026-07-20T10:01:00+00:00"}],
        "quarantine": [],
    }
    base.update(over)
    return base


# --------------------------------------------------------------------------- #
# store location + loading                                                     #
# --------------------------------------------------------------------------- #
def test_resolve_store_path_precedence(tmp_path):
    assert tn.resolve_store_path({"DASHBOARD_STATE_ROOT": "D:/s"}) == \
        Path("D:/s") / "control" / "control-plane.json"
    p = tn.resolve_store_path({"LOCALAPPDATA": "C:/Local"})
    assert p.parts[-3:] == ("dashboard", "control", "control-plane.json")


def test_missing_store_returns_none(tmp_path):
    assert tn.load_store(tmp_path / "nope.json") is None


def test_garbage_store_file_not_fatal(tmp_path):
    path = tmp_path / "control-plane.json"
    path.write_text("{ this is not json", encoding="utf-8")
    assert tn.load_store(path) is None


# --------------------------------------------------------------------------- #
# happy-path normalization                                                     #
# --------------------------------------------------------------------------- #
def test_normalize_run_shapes_spans(tmp_path):
    doc = _doc()
    spans = tn.normalize_run(doc, doc["runs"][0])
    by_kind = {s["kind"] for s in spans}
    assert by_kind == {"stage", "model", "tool"}
    # required GenAI-semconv fields present on every span
    for s in spans:
        assert set(s) >= {"span_id", "parent_span_id", "name", "kind",
                          "start", "end", "attrs", "truncated"}
    stage = next(s for s in spans if s["kind"] == "stage")
    model = next(s for s in spans if s["kind"] == "model")
    tool = next(s for s in spans if s["kind"] == "tool")
    assert stage["parent_span_id"] is None
    assert model["parent_span_id"] == "stage-1"
    assert model["attrs"]["model"] == "opus-4-8"
    assert tool["parent_span_id"] == "att-1"       # parented to attempt
    assert tool["name"] == "Read"
    # No tokens fabricated (public boundary carries none).
    assert "tokens" not in model["attrs"]


def test_spans_are_chronological(tmp_path):
    spans = tn.normalize_run(_doc(), _doc()["runs"][0])
    starts = [s["start"] for s in spans]
    assert starts == sorted(starts)


def test_write_and_reload_jsonl(tmp_path):
    doc = _doc()
    paths = tn.normalize(doc, tmp_path / "traces")
    assert len(paths) == 1
    assert paths[0] == tmp_path / "traces" / "card-1" / "run-a.jsonl"
    lines = paths[0].read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 3
    assert all(json.loads(ln)["span_id"] for ln in lines)


# --------------------------------------------------------------------------- #
# truncation + no raw content                                                  #
# --------------------------------------------------------------------------- #
def test_summary_truncated_at_2kb(tmp_path):
    big = "x" * 5000
    ev = {"subject": "card-1", "runRef": "run-a", "cursor": 2, "kind": "message",
          "source": "worker", "stageRef": None, "attemptRef": None,
          "sessionRef": None, "status": None, "summary": big, "command": None,
          "toolName": None, "path": None, "diff": None, "checkpoint": None,
          "createdAt": "2026-07-20T10:01:30+00:00"}
    doc = _doc(events=[ev])
    span = next(s for s in tn.normalize_run(doc, doc["runs"][0]) if s["kind"] == "tool")
    assert len(span["name"]) == tn.TRUNCATE_LIMIT
    assert span["truncated"] is True


def test_summary_truncated_at_2kb_bytes_not_codepoints_emoji(tmp_path):
    # 4-byte-per-codepoint emoji: 5000 codepoints would be 20000 bytes if the
    # cap were codepoint-based. It must be capped at <=2048 BYTES instead.
    big = "\U0001F600" * 5000  # U+1F600 GRINNING FACE, 4 bytes each in UTF-8
    ev = {"subject": "card-1", "runRef": "run-a", "cursor": 2, "kind": "message",
          "source": "worker", "stageRef": None, "attemptRef": None,
          "sessionRef": None, "status": None, "summary": big, "command": None,
          "toolName": None, "path": None, "diff": None, "checkpoint": None,
          "createdAt": "2026-07-20T10:01:30+00:00"}
    doc = _doc(events=[ev])
    span = next(s for s in tn.normalize_run(doc, doc["runs"][0]) if s["kind"] == "tool")
    name = span["name"]
    assert span["truncated"] is True
    encoded = name.encode("utf-8")
    assert len(encoded) <= tn.TRUNCATE_LIMIT
    # Valid UTF-8 that round-trips (no split/invalid codepoint at the cut).
    assert encoded.decode("utf-8") == name


def test_diff_content_never_emitted_only_bytes(tmp_path):
    diff = "SECRET FILE CONTENTS\n" * 100
    ev = {"subject": "card-1", "runRef": "run-a", "cursor": 3, "kind": "diff",
          "source": "worker", "stageRef": None, "attemptRef": None,
          "sessionRef": None, "status": None, "summary": None, "command": None,
          "toolName": None, "path": "secret.py", "diff": diff,
          "checkpoint": None, "createdAt": "2026-07-20T10:01:40+00:00"}
    doc = _doc(events=[ev])
    span = next(s for s in tn.normalize_run(doc, doc["runs"][0]) if s["kind"] == "tool")
    blob = json.dumps(span)
    assert "SECRET FILE CONTENTS" not in blob
    assert span["attrs"]["diff_bytes"] == len(diff.encode("utf-8"))


# --------------------------------------------------------------------------- #
# robustness: garbage rows skipped, filters, empty                             #
# --------------------------------------------------------------------------- #
def test_garbage_rows_skipped_not_fatal(tmp_path):
    doc = _doc()
    doc["stages"].append("not-a-dict")
    doc["attempts"].append({"subject": "card-1", "runRef": "run-a"})  # no attemptRef
    doc["events"].append({"subject": "card-1", "runRef": "run-a"})    # no cursor
    spans = tn.normalize_run(doc, doc["runs"][0])
    # Only the one valid stage / attempt / event survive.
    assert sum(1 for s in spans if s["kind"] == "stage") == 1
    assert sum(1 for s in spans if s["kind"] == "model") == 1
    assert sum(1 for s in spans if s["kind"] == "tool") == 1


def test_subject_and_run_filters(tmp_path):
    doc = _doc()
    doc["runs"].append({"subject": "card-2", "runRef": "run-b", "title": "Other",
                        "state": "failed", "createdAt": "2026-07-20T09:00:00+00:00",
                        "updatedAt": "2026-07-20T09:01:00+00:00"})
    assert len(tn.list_runs(doc)) == 2
    assert len(tn.list_runs(doc, subject="card-2")) == 1
    assert len(tn.list_runs(doc, run="run-a")) == 1


def test_no_runs_writes_nothing(tmp_path):
    doc = _doc(runs=[])
    assert tn.normalize(doc, tmp_path / "traces") == []


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #
def test_cli_no_store_clean_exit(tmp_path, capsys):
    rc = tn.main(["--repo", str(tmp_path), "--store", str(tmp_path / "missing.json")])
    assert rc == 0
    assert "no executions found" in capsys.readouterr().out


def test_cli_preamble_blocks_on_stop(tmp_path, capsys):
    (tmp_path / "STOP").write_text("frozen\n", encoding="utf-8")
    store = _store(tmp_path, _doc())
    rc = tn.main(["--repo", str(tmp_path), "--store", str(store)])
    assert rc == 1
    assert "PREAMBLE FAIL" in capsys.readouterr().err


def test_cli_writes_traces(tmp_path, capsys):
    store = _store(tmp_path, _doc())
    out = tmp_path / "traces"
    rc = tn.main(["--repo", str(tmp_path), "--store", str(store), "--out", str(out)])
    assert rc == 0
    assert (out / "card-1" / "run-a.jsonl").exists()
