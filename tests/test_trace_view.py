"""Wave E — Flight Recorder viewer tests (scripts/trace_view.py).

Hermetic: writes a normalized trace jsonl in tmp_path, then asserts on the
static HTML render and the fork-seed emission.
"""
import json
from pathlib import Path

import trace_view as tv


def _trace(tmp_path, spans, card="card-1", run="run-a") -> Path:
    d = tmp_path / "traces" / card
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{run}.jsonl"
    path.write_text("\n".join(json.dumps(s) for s in spans) + "\n", encoding="utf-8")
    return path


def _spans():
    return [
        {"span_id": "stage-1", "parent_span_id": None, "name": "Build",
         "kind": "stage", "start": "2026-07-20T10:00:00+00:00",
         "end": "2026-07-20T10:03:00+00:00", "attrs": {"state": "succeeded"},
         "truncated": False},
        {"span_id": "att-1", "parent_span_id": "stage-1", "name": "claude/opus",
         "kind": "model", "start": "2026-07-20T10:00:10+00:00",
         "end": "2026-07-20T10:02:50+00:00",
         "attrs": {"model": "opus", "state": "succeeded"}, "truncated": False},
        {"span_id": "event-1", "parent_span_id": "att-1", "name": "Read",
         "kind": "tool", "start": "2026-07-20T10:01:00+00:00",
         "end": "2026-07-20T10:01:00+00:00",
         "attrs": {"state": "success"}, "truncated": False},
    ]


# --------------------------------------------------------------------------- #
# HTML render                                                                   #
# --------------------------------------------------------------------------- #
def test_html_contains_spans_and_is_self_contained(tmp_path):
    html = tv.render_html(_spans(), "card-1", "run-a")
    assert "Build" in html and "claude/opus" in html and "Read" in html
    assert "<style>" in html and "<script" not in html
    assert "http://" not in html and "https://" not in html  # no external assets
    assert "state=succeeded" in html  # attrs rendered


def test_html_escapes_content(tmp_path):
    spans = [{"span_id": "s1", "parent_span_id": None,
              "name": "<img src=x onerror=alert(1)>", "kind": "tool",
              "start": None, "end": None, "attrs": {}, "truncated": False}]
    html = tv.render_html(spans, "c", "r")
    assert "<img src=x" not in html
    assert "&lt;img" in html


def test_write_html_names_by_card_and_run(tmp_path):
    trace = _trace(tmp_path, _spans())
    out = tmp_path / "dashboards" / "traces"
    path = tv.write_html(trace, out)
    assert path == out / "card-1-run-a.html"
    assert "Flight Recorder" in path.read_text(encoding="utf-8")


def test_empty_trace_renders(tmp_path):
    trace = _trace(tmp_path, [])
    html = tv.render_html(tv.load_trace(trace), "card-1", "run-a")
    assert "empty trace" in html


# --------------------------------------------------------------------------- #
# fork-from-step-N                                                              #
# --------------------------------------------------------------------------- #
def test_fork_summarizes_up_to_step(tmp_path):
    md = tv.render_fork(_spans(), "card-1", "run-a", 2)
    assert "RECONSTRUCTION, NOT RESTORE" in md
    assert "step 2" in md
    assert "Build" in md and "claude/opus" in md
    assert "Read" not in md  # step 3 excluded


def test_fork_step_beyond_length_keeps_all(tmp_path):
    md = tv.render_fork(_spans(), "c", "r", 99)
    assert "Read" in md  # all three kept, no crash


def test_write_fork_names_file(tmp_path):
    trace = _trace(tmp_path, _spans())
    out = tmp_path / "dashboards" / "traces"
    path = tv.write_fork(trace, 2, out)
    assert path == out / "card-1-run-a-fork-2.md"
    assert path.exists()


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #
def test_cli_renders_html(tmp_path, capsys):
    trace = _trace(tmp_path, _spans())
    out = tmp_path / "dash"
    rc = tv.main(["--repo", str(tmp_path), str(trace), "--out", str(out)])
    assert rc == 0
    assert (out / "card-1-run-a.html").exists()


def test_cli_fork_mode(tmp_path, capsys):
    trace = _trace(tmp_path, _spans())
    out = tmp_path / "dash"
    rc = tv.main(["--repo", str(tmp_path), str(trace), "--fork", "2", "--out", str(out)])
    assert rc == 0
    assert (out / "card-1-run-a-fork-2.md").exists()


def test_cli_preamble_blocks_on_stop(tmp_path, capsys):
    (tmp_path / "STOP").write_text("frozen\n", encoding="utf-8")
    trace = _trace(tmp_path, _spans())
    rc = tv.main(["--repo", str(tmp_path), str(trace)])
    assert rc == 1
    assert "PREAMBLE FAIL" in capsys.readouterr().err


def test_cli_missing_trace_errors(tmp_path, capsys):
    rc = tv.main(["--repo", str(tmp_path), str(tmp_path / "nope.jsonl")])
    assert rc == 1
    assert "trace not found" in capsys.readouterr().err
