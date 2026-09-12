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
    # fix round 1, C4: the Codex signal lives in codex_cumulative_total; max_ctx_tokens is
    # Claude-only and must be empty (None) on a Codex row.
    assert row["codex_cumulative_total"] == 540
    assert row["max_ctx_tokens"] is None
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


# ── C1a: date-partitioned codex directory scan (no full-tree rglob) ─────────────────────────────

def test_collect_codex_rows_ignores_files_outside_the_two_day_window(tmp_path):
    """Regression guard against a re-introduced full-tree rglob: a rollout file sitting in a
    completely unrelated date directory must never even be discovered, let alone processed."""
    day = "2026-09-10"
    codex_root = tmp_path / "codex_sessions"
    stale_dir = codex_root / "2026" / "01" / "01"
    stale_dir.mkdir(parents=True)
    (stale_dir / "rollout-old.jsonl").write_text(
        "\n".join([
            _codex_line({"type": "session_meta", "payload": {"session_id": "old", "timestamp": "2026-01-01T00:00:00Z"}}),
            _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
                "total_token_usage": {"input_tokens": 1, "cached_input_tokens": 0, "output_tokens": 1, "total_tokens": 2},
            }}}),
        ]) + "\n",
        encoding="utf-8",
    )
    env = {"KB_CODEX_SESSIONS_DIR": str(codex_root)}
    assert ul.collect_codex_rows(env, day) == []


def test_collect_codex_rows_finds_session_filed_under_previous_day_dir(tmp_path):
    """_codex_day_dirs' documented (and EMPIRICALLY VERIFIED, see the function's own docstring)
    drift case: a local clock BEHIND UTC (this machine: UTC-4) files a session created late in
    local day D-1 under directory D-1, even though its UTC start_day is already D. Still found
    and correctly attributed here, because attribution reads the file's OWN content, not its
    directory. (fix round 1 correction: the first version of this test/function scanned day+1
    instead of day-1 -- backwards for this machine's timezone; see the live-run wall time in
    task-1-report.md, "Fix round 1", for how that was caught.)"""
    day = "2026-09-10"
    codex_root = tmp_path / "codex_sessions"
    prev_dir = codex_root / "2026" / "09" / "09"
    prev_dir.mkdir(parents=True)
    (prev_dir / "rollout-late.jsonl").write_text(
        "\n".join([
            _codex_line({"type": "session_meta", "payload": {"session_id": "late", "timestamp": f"{day}T00:30:00Z"}}),
            _codex_line({"type": "event_msg", "payload": {"type": "token_count", "info": {
                "total_token_usage": {"input_tokens": 5, "cached_input_tokens": 0, "output_tokens": 1, "total_tokens": 6},
            }}}),
        ]) + "\n",
        encoding="utf-8",
    )
    env = {"KB_CODEX_SESSIONS_DIR": str(codex_root)}
    rows = ul.collect_codex_rows(env, day)
    assert len(rows) == 1
    assert rows[0]["session"] == "late"


# ── C1b: bounded mtime window + oversized-file skip for Claude transcripts ──────────────────────

class _FakeStat:
    """Wraps a real os.stat_result, overriding only st_size -- every other attribute (st_mtime
    included) forwards to the real value, so this cannot silently break unrelated stat() callers."""
    def __init__(self, real, size):
        self._real = real
        self.st_size = size

    def __getattr__(self, name):
        return getattr(self._real, name)


def test_collect_claude_rows_skips_oversized_file_by_default(tmp_path, monkeypatch, capsys):
    day = "2026-09-10"
    claude_root = tmp_path / "claude_projects" / "proj1"
    claude_root.mkdir(parents=True)
    big = claude_root / "big.jsonl"
    big.write_text(_claude_line("claude-sonnet-5", day) + "\n", encoding="utf-8")
    in_window = ul._day_start_epoch(day) + 3600  # 1h into target_day -- independent of real "now"
    os.utime(big, (in_window, in_window))
    real_stat = Path.stat

    def fake_stat(self, *a, **k):
        st = real_stat(self, *a, **k)
        return _FakeStat(st, ul.MAX_TRANSCRIPT_BYTES + 1) if self == big else st

    monkeypatch.setattr(Path, "stat", fake_stat)
    env = {"KB_CLAUDE_PROJECTS_DIR": str(claude_root.parent)}
    assert ul.collect_claude_rows(env, day) == []
    assert "skipping" in capsys.readouterr().err


def test_collect_claude_rows_includes_oversized_file_with_full(tmp_path, monkeypatch):
    day = "2026-09-10"
    claude_root = tmp_path / "claude_projects" / "proj1"
    claude_root.mkdir(parents=True)
    big = claude_root / "big.jsonl"
    big.write_text(_claude_line("claude-sonnet-5", day) + "\n", encoding="utf-8")
    in_window = ul._day_start_epoch(day) + 3600  # 1h into target_day -- independent of real "now"
    os.utime(big, (in_window, in_window))
    real_stat = Path.stat

    def fake_stat(self, *a, **k):
        st = real_stat(self, *a, **k)
        return _FakeStat(st, ul.MAX_TRANSCRIPT_BYTES + 1) if self == big else st

    monkeypatch.setattr(Path, "stat", fake_stat)
    env = {"KB_CLAUDE_PROJECTS_DIR": str(claude_root.parent)}
    rows = ul.collect_claude_rows(env, day, full=True)
    assert len(rows) == 1


def test_collect_claude_rows_ignores_mtime_far_past_the_two_day_window(tmp_path):
    """A still-growing transcript touched long after target_day's 2-day window must not be
    rescanned every run (a live boss terminal's mtime is always "now")."""
    day = "2026-09-10"
    claude_root = tmp_path / "claude_projects" / "proj1"
    claude_root.mkdir(parents=True)
    stale = claude_root / "still_growing.jsonl"
    stale.write_text(_claude_line("claude-sonnet-5", day) + "\n", encoding="utf-8")
    far_future = ul._day_start_epoch(day) + 30 * 86400
    os.utime(stale, (far_future, far_future))
    env = {"KB_CLAUDE_PROJECTS_DIR": str(claude_root.parent)}
    assert ul.collect_claude_rows(env, day) == []


# ── Minor: a bad-header ledger file is regenerated, not silently treated as empty ───────────────

def test_read_existing_rows_returns_none_for_bad_header(tmp_path):
    path = tmp_path / "bad.tsv"
    path.write_text("not a header\nrow1\n", encoding="utf-8")
    assert ul.read_existing_rows(path) is None


# ── C2: publish_to_ops treats identical content as success without an empty commit ──────────────

def _init_ops_remote(tmp_path):
    """A minimal local bare 'origin' with an `ops` branch already pushed -- stands in for the real
    remote so publish_to_ops's fetch/worktree/push machinery runs for real against local disk."""
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "--bare", "-q", str(origin)], check=True, capture_output=True)
    work = tmp_path / "seed"
    subprocess.run(["git", "init", "-q", str(work)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "remote", "add", "origin", str(origin)],
                    check=True, capture_output=True)
    (work / "README.md").write_text("seed\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(work), "add", "README.md"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "-c", "user.email=t@t", "-c", "user.name=t",
                    "commit", "-q", "-m", "seed"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "branch", "-M", "ops"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "push", "-q", "origin", "ops"], check=True, capture_output=True)
    return work


def test_publish_to_ops_reports_success_without_recommitting_identical_content(tmp_path):
    repo_root = _init_ops_remote(tmp_path)
    out_path = tmp_path / "2026-09-10.tsv"
    out_path.write_text("stub ledger content\n", encoding="utf-8")
    rel = "ledgers/usage/2026-09-10.tsv"

    ok1, msg1 = ul.publish_to_ops(repo_root, out_path, rel)
    assert ok1 and msg1 == "pushed"

    # Same content, second call: must succeed WITHOUT creating a second commit.
    ok2, msg2 = ul.publish_to_ops(repo_root, out_path, rel)
    assert ok2 and msg2 == "already on ops (identical content)"

    log = subprocess.run(["git", "log", "--oneline", "origin/ops"], cwd=repo_root,
                          capture_output=True, text=True, check=True)
    assert log.stdout.count("chore(usage-ledger)") == 1


# ── C3: a failed publish is retried on the next run for that date ───────────────────────────────

def test_publish_and_track_writes_pending_marker_on_failure(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "appdata"))
    monkeypatch.setattr(ul, "publish_to_ops", lambda root, out_path, rel_path: (False, "boom"))
    out_path = tmp_path / "ledgers" / "usage" / "2026-09-10.tsv"
    out_path.parent.mkdir(parents=True)
    out_path.write_text("x", encoding="utf-8")
    ul._publish_and_track(tmp_path, out_path, "ledgers/usage/2026-09-10.tsv", "2026-09-10")
    marker = ul._pending_marker("2026-09-10")
    assert marker.exists()
    assert marker.read_text(encoding="utf-8") == "boom"


def test_publish_and_track_clears_pending_marker_on_success(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "appdata"))
    marker = ul._pending_marker("2026-09-10")
    marker.parent.mkdir(parents=True)
    marker.write_text("previous failure", encoding="utf-8")
    monkeypatch.setattr(ul, "publish_to_ops", lambda root, out_path, rel_path: (True, "pushed"))
    out_path = tmp_path / "ledgers" / "usage" / "2026-09-10.tsv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("x", encoding="utf-8")
    ul._publish_and_track(tmp_path, out_path, "ledgers/usage/2026-09-10.tsv", "2026-09-10")
    assert not marker.exists()


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
    # fix round 1, Important: sys.executable, not bare "python" -- guarantees the interpreter
    # actually running these tests is the one that runs the subprocess.
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, env=env)


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


def test_cli_regenerates_a_bad_header_file(tmp_path):
    """Minor fix: a ledger file without the expected header is regenerated (one stderr note),
    not silently treated as an empty/zero-usage day."""
    day = "2026-09-10"
    claude_dir, codex_dir = _make_fixture_tree(tmp_path, day)
    repo_root = tmp_path / "repo"
    out_path = repo_root / "ledgers" / "usage" / f"{day}.tsv"
    out_path.parent.mkdir(parents=True)
    out_path.write_text("not a valid ledger file\n", encoding="utf-8")
    r = _run({"KB_CLAUDE_PROJECTS_DIR": str(claude_dir), "KB_CODEX_SESSIONS_DIR": str(codex_dir)},
              "--date", day, "--root", str(repo_root), "--no-publish")
    assert r.returncode == 0, r.stderr
    assert "missing the expected header" in r.stderr
    assert out_path.read_text(encoding="utf-8").startswith("#")


def test_cli_retries_publish_when_pending_marker_exists(tmp_path):
    """C3: even though the day's TSV already exists (normally an idempotent no-publish-touch
    read), a leftover `.pending` marker from a prior failed publish forces a retry -- which fails
    again here (repo_root has no .git at all) and leaves the marker in place."""
    day = "2026-09-10"
    claude_dir, codex_dir = _make_fixture_tree(tmp_path, day)
    repo_root = tmp_path / "repo"
    (repo_root / "ledgers").mkdir(parents=True)
    appdata = tmp_path / "appdata"
    env = {
        "KB_CLAUDE_PROJECTS_DIR": str(claude_dir), "KB_CODEX_SESSIONS_DIR": str(codex_dir),
        "LOCALAPPDATA": str(appdata),
    }
    r1 = _run(env, "--date", day, "--root", str(repo_root))
    assert r1.returncode == 0
    marker = appdata / "kb-usage-ledger" / f"{day}.pending"
    assert marker.exists()
    assert "publish failed" in r1.stderr

    r2 = _run(env, "--date", day, "--root", str(repo_root))
    assert r2.returncode == 0
    assert marker.exists()  # still failing (no real git remote) -- retried, not silently dropped
    assert "publish failed" in r2.stderr
