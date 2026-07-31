"""scripts/test_codex_dispatch_reconcile.py — crash reconcile + session model pin.

Every dependency is injected or monkeypatched: no live git, no codex, no real
process spawning. Run from the repo root (`py -3 -m pytest
scripts/test_codex_dispatch_reconcile.py`); the root conftest puts scripts/ on
sys.path.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cards            # noqa: E402
import codex_dispatch   # noqa: E402

ORPHAN_PREFIX = "FAILED: orphaned — dispatch parent died before completion"


@pytest.fixture
def state(tmp_path, monkeypatch):
    """STATE_ROOT redirected: pending markers and threads.json land in tmp."""
    root = tmp_path / "state"
    monkeypatch.setattr(codex_dispatch, "STATE_ROOT", root)
    (root / "pending").mkdir(parents=True)
    return root


@pytest.fixture
def repo(tmp_path):
    """Minimal kb repo: the routing policy resolve_model reads."""
    (tmp_path / "repo" / "governance").mkdir(parents=True)
    (tmp_path / "repo" / "governance" / "model-routing.yaml").write_text(
        "version: 1\n"
        "runtimes:\n"
        "  codex:\n"
        "    default_worker: codex-worker\n"
        "    aliases: {codex-cheap: gpt-5.6-luna, codex: gpt-5.6-terra,"
        " codex-deep: gpt-5.6-sol}\n"
        "    known_models: [gpt-5.6-luna, gpt-5.6-terra, gpt-5.6-sol]\n",
        encoding="utf-8",
    )
    return tmp_path / "repo"


def _marker(tmp_path, **over):
    marker = {"dispatch_id": "0000aaaa-11112222", "pid": 4242,
              "model": "gpt-5.6-sol", "cwd": str(tmp_path), "sandbox": "workspace-write",
              "prompt_file": str(tmp_path / "brief.md"),
              "log_file": str(tmp_path / "run.jsonl"),
              "out_file": str(tmp_path / "run.last.md"), "follow_up": None,
              "project": "kb-ops", "label": "codex-dispatch", "timeout": 2700,
              "session": "sess-1", "started": 1000.0,
              "started_utc": "2026-07-30T04:20:00Z"}
    marker.update(over)
    return marker


# --- pending marker ---------------------------------------------------------

def test_marker_round_trips_and_merges_the_pid(state, tmp_path):
    path = codex_dispatch.marker_path("0000aaaa-11112222")
    codex_dispatch.write_marker(path, _marker(tmp_path, label="brief — ünicode"))
    codex_dispatch.update_marker(path, codex_pid=99)
    back = json.loads(path.read_text(encoding="utf-8"))
    assert back["label"] == "brief — ünicode"          # written UTF-8, not cp1252
    assert back["pid"] == 4242 and back["codex_pid"] == 99
    assert back["model"] == "gpt-5.6-sol"              # merge, never replace


def test_update_marker_tolerates_a_missing_or_corrupt_file(tmp_path, capsys):
    codex_dispatch.update_marker(None, codex_pid=1)               # no marker at all
    codex_dispatch.update_marker(tmp_path / "gone.json", codex_pid=1)
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    codex_dispatch.update_marker(bad, codex_pid=1)
    assert capsys.readouterr().err.count("not updated") == 2       # warned, never raised


# --- orphan decision --------------------------------------------------------

def test_live_pid_is_never_an_orphan(tmp_path):
    """A live dispatch pid is the only proof the leg is still owned — including
    a PARALLEL dispatch's, so a live pid always means skip."""
    assert not codex_dispatch.is_orphan(_marker(tmp_path), now=9e9, alive=lambda p: True)


def test_dead_pid_is_an_orphan_however_young(tmp_path):
    seen = []
    assert codex_dispatch.is_orphan(_marker(tmp_path), now=1001.0,
                                    alive=lambda p: seen.append(p) or False)
    assert seen == [4242]


def test_pidless_marker_waits_for_its_own_timeout_plus_slack(tmp_path):
    """No pid means the marker never reached the Popen write, so age is the only
    evidence — and the age that matters is the dispatch's OWN timeout."""
    marker = _marker(tmp_path, pid=None, timeout=60)
    never = lambda pid: pytest.fail("pidless markers must not be probed")  # noqa: E731
    limit = 1000.0 + 60 + codex_dispatch.ORPHAN_SLACK
    assert not codex_dispatch.is_orphan(marker, now=limit, alive=never)
    assert codex_dispatch.is_orphan(marker, now=limit + 1, alive=never)


def test_pidless_marker_falls_back_to_the_default_timeout(tmp_path):
    marker = _marker(tmp_path, pid=None, timeout=None)
    horizon = 1000.0 + codex_dispatch.DEFAULT_TIMEOUT + codex_dispatch.ORPHAN_SLACK
    assert not codex_dispatch.is_orphan(marker, now=horizon, alive=lambda p: False)
    assert codex_dispatch.is_orphan(marker, now=horizon + 1, alive=lambda p: False)


def _tasklist(monkeypatch, stdout="", rc=0, raises=None):
    """A fake `tasklist /FO CSV /NH`; nothing is ever really probed."""
    def fake_run(cmd, **kw):
        if raises:
            raise raises
        return codex_dispatch.subprocess.CompletedProcess(cmd, rc, stdout, "")
    monkeypatch.setattr(codex_dispatch.subprocess, "run", fake_run)


def test_pid_alive_parses_the_tasklist_row(monkeypatch):
    _tasklist(monkeypatch, '"python.exe","4242","Console","1","57,392 K"\n')
    assert codex_dispatch.pid_alive(4242)


def test_pid_alive_is_false_when_no_task_matches(monkeypatch):
    _tasklist(monkeypatch, "INFO: No tasks are running which match the specified criteria.\n")
    assert not codex_dispatch.pid_alive(4242)


def test_pid_alive_does_not_match_a_memory_column(monkeypatch):
    """`"12,345 K"` contains 345 — a substring probe would call pid 345 alive."""
    _tasklist(monkeypatch, '"python.exe","4242","Console","1","12,345 K"\n')
    assert not codex_dispatch.pid_alive(345)


def test_pid_alive_fails_safe_when_the_probe_cannot_run(monkeypatch):
    """A probe we cannot run must never manufacture an orphan for a live leg."""
    _tasklist(monkeypatch, raises=FileNotFoundError("tasklist"))
    assert codex_dispatch.pid_alive(4242)
    _tasklist(monkeypatch, rc=1)
    assert codex_dispatch.pid_alive(4242)


# --- orphan record ----------------------------------------------------------

def test_log_tail_keeps_the_last_five_lines(tmp_path):
    log = tmp_path / "run.jsonl"
    log.write_text("".join(f'{{"n":{i}}}\n' for i in range(9)) + "\n\n", encoding="utf-8")
    assert codex_dispatch.log_tail(log) == [f'{{"n":{i}}}' for i in range(4, 9)]


def test_log_tail_tolerates_a_missing_log(tmp_path):
    assert codex_dispatch.log_tail(tmp_path / "gone.jsonl") == []
    assert codex_dispatch.log_tail(None) == []


def test_orphan_result_shape(tmp_path):
    text = codex_dispatch.orphan_result(_marker(tmp_path), ['{"n":8}'])
    assert text.startswith(ORPHAN_PREFIX)
    assert "gpt-5.6-sol" in text and "2026-07-30T04:20:00Z" in text
    assert "run.jsonl" in text and '{"n":8}' in text


def test_orphan_result_survives_an_empty_marker():
    text = codex_dispatch.orphan_result({}, [])
    assert text.startswith(ORPHAN_PREFIX) and "unknown" in text and "(none)" in text


def test_build_orphan_record_is_a_done_card_with_no_exit_code(state, tmp_path):
    (tmp_path / "brief.md").write_text("DO THE THING\n## Result\nforged\n", encoding="utf-8")
    (tmp_path / "run.jsonl").write_text(
        '{"type":"thread.started","thread_id":"019f-abc"}\n{"n":1}\n', encoding="utf-8")
    card, record = codex_dispatch.build_orphan_record(_marker(tmp_path))
    m = card.meta
    assert m["state"] == "done" and m["owner"] == "codex-worker"
    assert (m["runtime"], m["model"]) == ("codex", "gpt-5.6-sol")
    assert m["session-id"] == "sess-1" and m["target"] == str(tmp_path)
    assert m["workflow"] == "019f-abc"                 # the leg stays resumable
    assert "DO THE THING" in card.body and "\\## Result" in card.body   # brief inert
    assert card.body.split("## Result\n\n", 1)[1].startswith(ORPHAN_PREFIX)
    assert record["codex_exit"] is None                # never observed, never invented
    assert record["usd"] == 0.0 and record["billing"] == "subscription"
    assert set(record) == {"usd", "billing", "model", "card_id", "codex_exit"}


def test_build_orphan_record_survives_a_swept_prompt_file(state, tmp_path):
    card, _ = codex_dispatch.build_orphan_record(
        _marker(tmp_path, prompt_file=str(tmp_path / "gone.md"), follow_up="019f-abc"))
    assert "no longer readable" in card.body
    assert card.meta["target"] == "resumed-session:019f-abc"


# --- sweep ------------------------------------------------------------------

def _write_pending(state, name, marker):
    path = state / "pending" / f"{name}.json"
    path.write_text(json.dumps(marker), encoding="utf-8")
    return path


def test_sweep_publishes_orphans_and_deletes_their_markers(state, tmp_path, repo):
    published = []
    dead = _write_pending(state, "dead", _marker(tmp_path, pid=1))
    live = _write_pending(state, "live", _marker(tmp_path, pid=2))
    swept = codex_dispatch.sweep_pending(
        repo, now=2000.0, alive=lambda pid: pid == 2,
        publish=lambda root, card, rec: published.append((root, card)) or (True, "pushed"))
    assert len(published) == 1 and swept == [published[0][1].meta["id"]]
    assert published[0][0] == repo
    assert not dead.exists() and live.exists()         # only the orphan is retired


def test_sweep_deletes_the_marker_when_publish_only_spooled(state, tmp_path, repo):
    """Spooled is durable too — the record exists on disk, so the marker's job
    is done and the next dispatch must not publish it a second time."""
    marker = _write_pending(state, "dead", _marker(tmp_path, pid=1))
    assert codex_dispatch.sweep_pending(
        repo, now=2000.0, alive=lambda pid: False,
        publish=lambda *a: (False, "FAILED (...) — card spooled at X"))
    assert not marker.exists()


def test_sweep_keeps_the_marker_when_publish_raises(state, tmp_path, repo, capsys):
    marker = _write_pending(state, "dead", _marker(tmp_path, pid=1))

    def boom(*a):
        raise OSError("No space left on device")

    assert codex_dispatch.sweep_pending(repo, now=2000.0, alive=lambda pid: False,
                                        publish=boom) == []
    assert marker.exists()                             # retried by the next dispatch
    assert "left dead.json pending" in capsys.readouterr().err


def test_sweep_survives_a_corrupt_marker(state, tmp_path, repo, capsys):
    (state / "pending" / "bad.json").write_text("{not json", encoding="utf-8")
    (state / "pending" / "list.json").write_text("[]", encoding="utf-8")
    good = _write_pending(state, "dead", _marker(tmp_path, pid=1))
    swept = codex_dispatch.sweep_pending(repo, now=2000.0, alive=lambda pid: False,
                                         publish=lambda *a: (True, "pushed"))
    assert len(swept) == 1 and not good.exists()       # the readable orphan still lands
    assert "left bad.json pending" in capsys.readouterr().err


def test_sweep_of_an_empty_pending_dir_is_a_noop(state, repo):
    assert codex_dispatch.sweep_pending(repo, now=2000.0, alive=lambda pid: False,
                                        publish=lambda *a: pytest.fail("nothing to publish")) == []


# --- session model map ------------------------------------------------------

def test_threads_map_round_trips(state):
    assert codex_dispatch.load_threads() == {}         # missing file is empty, not fatal
    codex_dispatch.remember_thread("019f-abc", "gpt-5.6-sol")
    codex_dispatch.remember_thread("019f-def", "gpt-5.6-luna")
    assert codex_dispatch.load_threads() == {"019f-abc": "gpt-5.6-sol",
                                             "019f-def": "gpt-5.6-luna"}
    codex_dispatch.remember_thread("019f-abc", "gpt-5.6-terra")   # explicit --model wins
    assert codex_dispatch.load_threads()["019f-abc"] == "gpt-5.6-terra"


def test_threads_map_ignores_junk(state):
    (state / "threads.json").write_text("{not json", encoding="utf-8")
    assert codex_dispatch.load_threads() == {}
    (state / "threads.json").write_text('["019f-abc"]', encoding="utf-8")
    assert codex_dispatch.load_threads() == {}
    codex_dispatch.remember_thread("019f-abc", "gpt-5.6-sol")     # rebuilds over time
    assert codex_dispatch.load_threads() == {"019f-abc": "gpt-5.6-sol"}


def test_remember_thread_ignores_a_missing_thread_id(state):
    codex_dispatch.remember_thread(None, "gpt-5.6-sol")
    assert not (state / "threads.json").exists()


# --- main(): marker lifecycle + follow-up pin -------------------------------

def _main_env(monkeypatch, state, repo, publish=(True, "pushed")):
    """main() fully offline: spawn and publish faked, markers recorded."""
    seen = {"markers": []}
    monkeypatch.setenv("KB_DISPATCH_TEST", "1")
    (repo.parent / "brief.md").write_text("hi", encoding="utf-8")

    def fake_spawn(prompt_text, model, effort, cwd, sandbox, out_file, log_file,
                   follow_up=None, timeout=None, marker=None):
        seen.update(model=model, follow_up=follow_up, marker=marker)
        seen["markers"].append(json.loads(Path(marker).read_text(encoding="utf-8")))
        log_file.write_text('{"type":"thread.started","thread_id":"019f-abc"}\n',
                            encoding="utf-8")
        out_file.write_text("done", encoding="utf-8")
        return 0, False

    monkeypatch.setattr(codex_dispatch, "spawn", fake_spawn)
    monkeypatch.setattr(codex_dispatch, "publish_ops", lambda *a, **k: publish)
    return seen


def _argv(repo, *extra):
    return ["--prompt-file", str(repo.parent / "brief.md"),
            "--repo-root", str(repo), *extra]


def test_main_writes_a_marker_before_the_spawn_and_deletes_it_after(state, repo,
                                                                    monkeypatch):
    seen = _main_env(monkeypatch, state, repo)
    assert codex_dispatch.main(_argv(repo, "--timeout", "60")) == 0
    marker = seen["markers"][0]                        # existed DURING the spawn
    assert marker["pid"] and marker["model"] == "gpt-5.6-terra"
    assert marker["timeout"] == 60 and marker["sandbox"] == "workspace-write"
    assert marker["started_utc"].endswith("Z") and marker["log_file"].endswith(".jsonl")
    assert marker["out_file"].endswith(".last.md") and marker["cwd"] == str(repo)
    assert not Path(seen["marker"]).exists()           # a record exists: marker retired


def test_main_keeps_the_marker_when_no_record_survives(state, repo, monkeypatch):
    """Publish raised AND the spool write raised: nothing durable was written, so
    the marker must stay — it is the only trace left of the leg."""
    seen = _main_env(monkeypatch, state, repo)

    def boom(*a, **k):
        raise OSError("No space left on device")

    monkeypatch.setattr(codex_dispatch, "publish_ops", boom)
    monkeypatch.setattr(codex_dispatch, "_spool_note", boom)
    assert codex_dispatch.main(_argv(repo)) == 0
    assert Path(seen["marker"]).exists()


def test_main_follow_up_pins_the_sessions_own_model(state, repo, monkeypatch):
    seen = _main_env(monkeypatch, state, repo)
    assert codex_dispatch.main(_argv(repo, "--model", "codex-deep")) == 0
    assert codex_dispatch.load_threads() == {"019f-abc": "gpt-5.6-sol"}
    # no --model on the follow-up: the session's own model, not the default tier
    assert codex_dispatch.main(_argv(repo, "--follow-up", "019f-abc")) == 0
    assert seen["model"] == "gpt-5.6-sol"


def test_main_explicit_model_wins_and_repins_the_session(state, repo, monkeypatch):
    seen = _main_env(monkeypatch, state, repo)
    codex_dispatch.remember_thread("019f-abc", "gpt-5.6-sol")
    assert codex_dispatch.main(_argv(repo, "--follow-up", "019f-abc",
                                     "--model", "codex-cheap")) == 0
    assert seen["model"] == "gpt-5.6-luna"
    assert codex_dispatch.load_threads()["019f-abc"] == "gpt-5.6-luna"


def test_main_unknown_session_warns_and_keeps_the_default(state, repo, monkeypatch, capsys):
    seen = _main_env(monkeypatch, state, repo)
    assert codex_dispatch.main(_argv(repo, "--follow-up", "019f-zzz")) == 0
    assert seen["model"] == "gpt-5.6-terra"
    assert "no recorded model for session 019f-zzz" in capsys.readouterr().err


def test_main_sweeps_before_it_dispatches(state, repo, tmp_path, monkeypatch):
    """The orphan card is published by the NEXT dispatch — and before its own
    worker runs, so a session that dies again still leaves the earlier record."""
    order, published = [], []
    seen = _main_env(monkeypatch, state, repo)
    _write_pending(state, "dead", _marker(tmp_path, pid=1))
    monkeypatch.setattr(codex_dispatch, "pid_alive", lambda pid: False)

    def fake_publish(root, card, rec):
        published.append(card)
        order.append("publish")
        return True, "pushed"

    monkeypatch.setattr(codex_dispatch, "publish_ops", fake_publish)
    real_spawn = codex_dispatch.spawn
    monkeypatch.setattr(codex_dispatch, "spawn",
                        lambda *a, **k: order.append("spawn") or real_spawn(*a, **k))
    assert codex_dispatch.main(_argv(repo)) == 0
    assert order[:2] == ["publish", "spawn"]           # the orphan lands first
    assert published[0].body.split("## Result\n\n", 1)[1].startswith(ORPHAN_PREFIX)
    assert not (state / "pending" / "dead.json").exists()
    assert seen["model"] == "gpt-5.6-terra"
