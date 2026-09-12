"""tests/test_usage_ledger.py — scripts/usage_ledger.py.

Pure-function tests import the module directly (conftest.py puts scripts/ on sys.path, same
pattern as tests/test_handoffs_sweep.py's `from scripts import handoffs_sweep`). CLI-level tests
drive the script as a subprocess with KB_CLAUDE_PROJECTS_DIR/KB_CODEX_SESSIONS_DIR pointed at a
throwaway fixture tree, and --no-publish so no test ever touches a real git remote.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from scripts import usage_ledger as ul  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "usage_ledger.py"


# ── pure-function tests ──────────────────────────────────────────────────────────────────────

def test_classify_claude_model():
    assert ul.classify_claude_model("claude-opus-5") == "opus"
    assert ul.classify_claude_model("claude-fable-5-1") == "fable"
    assert ul.classify_claude_model("claude-sonnet-5") == "sonnet"
    assert ul.classify_claude_model("claude-haiku-4-5") == "haiku"
    assert ul.classify_claude_model("something-else") == "default"
    assert ul.classify_claude_model(None) == "default"


def test_claude_cost_is_positive_and_scales_with_cache_read():
    base = ul.claude_cost("opus", 1_000_000, 0, 0, 0)
    with_cache_read = ul.claude_cost("opus", 0, 0, 1_000_000, 0)
    assert base > 0
    assert with_cache_read == round(base * ul.CACHE_READ_MULT, 10)


def test_codex_cost_treats_cached_as_subset_of_input():
    cost = ul.codex_cost(1_000_000, 1_000_000, 0)  # fully cached
    assert cost == round((1_000_000 / 1e6) * ul.CODEX_INPUT_PRICE * ul.CODEX_CACHE_MULT, 10)


# ── streaming / partial-line handling ────────────────────────────────────────────────────────

def _claude_line(model, day, inp=100, cc=0, cr=0, out=50):
    return json.dumps({
        "type": "assistant", "timestamp": f"{day}T12:00:00Z",
        "message": {"model": model, "usage": {
            "input_tokens": inp, "cache_creation_input_tokens": cc,
            "cache_read_input_tokens": cr, "output_tokens": out,
        }},
    })


def test_process_claude_file_skips_a_partial_last_line(tmp_path):
    day = "2026-09-10"
    path = tmp_path / "s1.jsonl"
    # Two complete lines, then a truncated (no trailing newline) third line.
    path.write_text(
        _claude_line("claude-sonnet-5", day) + "\n"
        + _claude_line("claude-sonnet-5", day) + "\n"
        + '{"type": "assistant", "timestamp": "' + day + 'T12:00:01Z", "message": {"mo',
        encoding="utf-8",
    )
    rows = ul.process_claude_file(path, "top", "s1", "kb", day)
    assert len(rows) == 1
    assert rows[0]["turns"] == 2  # the truncated third record never counted


def test_process_claude_file_filters_by_target_day(tmp_path):
    path = tmp_path / "s2.jsonl"
    path.write_text(
        _claude_line("claude-opus-5", "2026-09-09") + "\n"
        + _claude_line("claude-opus-5", "2026-09-10") + "\n",
        encoding="utf-8",
    )
    rows = ul.process_claude_file(path, "top", "s2", "kb", "2026-09-10")
    assert len(rows) == 1
    assert rows[0]["turns"] == 1


def _codex_line(rec):
    return json.dumps(rec)


def test_process_codex_file_takes_max_total_usage_per_file(tmp_path):
    day = "2026-09-10"
    path = tmp_path / "rollout-1.jsonl"
    lines = [
        _codex_line({"type": "session_meta", "payload": {"session_id": "abc", "timestamp": f"{day}T01:00:00Z"}}),
        _codex_line({"type": "turn_context", "payload": {"model": "gpt-5.6-terra"}}),
        _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 100, "cached_input_tokens": 50, "output_tokens": 10, "total_tokens": 110},
        }}}),
        _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 500, "cached_input_tokens": 400, "output_tokens": 40, "total_tokens": 540},
        }}}),
        _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 300, "cached_input_tokens": 250, "output_tokens": 20, "total_tokens": 320},
        }}}),  # a SMALLER later reading must not override the max
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    row = ul.process_codex_file(path, day)
    assert row is not None
    assert row["max_ctx_tokens"] == 540
    assert row["input_tokens"] == 500
    assert row["cache_read_tokens"] == 400
    assert row["model"] == "gpt-5.6-terra"
    assert row["session"] == "abc"


def test_process_codex_file_attributes_to_session_start_day_only(tmp_path):
    path = tmp_path / "rollout-2.jsonl"
    lines = [
        _codex_line({"type": "session_meta", "payload": {"session_id": "xyz", "timestamp": "2026-09-09T23:59:00Z"}}),
        _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 10, "cached_input_tokens": 0, "output_tokens": 1, "total_tokens": 11},
        }}}),
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert ul.process_codex_file(path, "2026-09-10") is None  # session started the PRIOR day
    assert ul.process_codex_file(path, "2026-09-09") is not None


# ── CLI-level tests ───────────────────────────────────────────────────────────────────────────

def _make_fixture_tree(tmp_path, day):
    claude_root = tmp_path / "claude_projects" / "C--Users-danie-kb"
    claude_root.mkdir(parents=True)
    (claude_root / "sess1.jsonl").write_text(_claude_line("claude-sonnet-5", day) + "\n", encoding="utf-8")
    sub_dir = claude_root / "sess1" / "subagents"
    sub_dir.mkdir(parents=True)
    (sub_dir / "agent-1.jsonl").write_text(_claude_line("claude-haiku-4-5", day) + "\n", encoding="utf-8")
    codex_root = tmp_path / "codex_sessions" / "2026" / "09" / day[-2:]
    codex_root.mkdir(parents=True)
    (codex_root / "rollout-1.jsonl").write_text(
        "\n".join([
            _codex_line({"type": "session_meta", "payload": {"session_id": "c1", "timestamp": f"{day}T01:00:00Z"}}),
            _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
                "total_token_usage": {"input_tokens": 10, "cached_input_tokens": 5, "output_tokens": 2, "total_tokens": 12},
            }}}),
        ]) + "\n",
        encoding="utf-8",
    )
    return claude_root.parent.parent, codex_root.parent.parent.parent


def _run(env_extra, *args):
    env = {**os.environ, **env_extra}
    return subprocess.run(["python", str(SCRIPT), *args], capture_output=True, text=True, env=env)


def test_cli_writes_ledger_and_summary(tmp_path):
    day = "2026-09-10"
    claude_dir, codex_dir = _make_fixture_tree(tmp_path, day)
    repo_root = tmp_path / "repo"
    (repo_root / "ledgers").mkdir(parents=True)
    r = _run({
        "KB_CLAUDE_PROJECTS_DIR": str(claude_dir), "KB_CODEX_SESSIONS_DIR": str(codex_dir),
    }, "--date", day, "--root", str(repo_root), "--no-publish")
    assert r.returncode == 0, r.stderr
    out_path = repo_root / "ledgers" / "usage" / f"{day}.tsv"
    assert out_path.exists()
    text = out_path.read_text(encoding="utf-8")
    assert text.startswith("#")  # rate-table header
    assert "_totals" in text
    assert "est_usd" in text.splitlines()[1]  # header row


def test_cli_is_idempotent_per_day(tmp_path):
    day = "2026-09-10"
    claude_dir, codex_dir = _make_fixture_tree(tmp_path, day)
    repo_root = tmp_path / "repo"
    (repo_root / "ledgers").mkdir(parents=True)
    env = {"KB_CLAUDE_PROJECTS_DIR": str(claude_dir), "KB_CODEX_SESSIONS_DIR": str(codex_dir)}
    r1 = _run(env, "--date", day, "--root", str(repo_root), "--no-publish")
    out_path = repo_root / "ledgers" / "usage" / f"{day}.tsv"
    first_mtime = out_path.stat().st_mtime_ns
    # Second run: even with an EMPTY fixture tree, the existing file must be left alone
    # (re-read, not recomputed) -- idempotent per day.
    r2 = _run({"KB_CLAUDE_PROJECTS_DIR": str(tmp_path / "empty"), "KB_CODEX_SESSIONS_DIR": str(tmp_path / "empty2")},
              "--date", day, "--root", str(repo_root), "--no-publish", "--summary")
    assert r1.returncode == 0 and r2.returncode == 0
    assert out_path.stat().st_mtime_ns == first_mtime
    assert len(r2.stdout.strip().splitlines()[-1]) <= 200


def test_cli_summary_line_is_at_most_200_chars(tmp_path):
    day = "2026-09-10"
    claude_dir, codex_dir = _make_fixture_tree(tmp_path, day)
    repo_root = tmp_path / "repo"
    (repo_root / "ledgers").mkdir(parents=True)
    r = _run({"KB_CLAUDE_PROJECTS_DIR": str(claude_dir), "KB_CODEX_SESSIONS_DIR": str(codex_dir)},
             "--date", day, "--root", str(repo_root), "--no-publish", "--summary")
    assert r.returncode == 0, r.stderr
    line = r.stdout.strip().splitlines()[-1]
    assert len(line) <= 200
    assert day in line


def test_refuses_inside_a_codex_worker(tmp_path):
    r = _run({"KB_INSIDE_CODEX_WORKER": "1"}, "--date", "2026-09-10", "--root", str(tmp_path), "--no-publish")
    assert r.returncode == 3
    assert "codex worker" in r.stderr
    assert not (tmp_path / "ledgers").exists()


def test_bad_date_argument_is_rejected(tmp_path):
    r = _run({}, "--date", "not-a-date", "--root", str(tmp_path), "--no-publish")
    assert r.returncode == 2
