"""Transcript ledger on ops (Task 6, design §5).

`SessionLedger` subscribes to a `StatePublisher`, buckets each `("line", {...})` event by the
publisher's active `session_id`, and on `flush(session_id)` writes the wake-session's turns as
JSONL to `orgs/atlas/output/transcripts/YYYY-MM-DD-<session_id>.jsonl` in the ops worktree, then
commits + pushes under the pull-rebase-before-write rule with a bounded rejected-push retry.

Tests drive a REAL `git` CLI through the injected runner seam against a THROWAWAY repo with a
local BARE 'origin' on an `ops` branch — no network, no touching the real ops worktree. Author
identity is set per-command with `git -c user.name=... -c user.email=...` (NEVER `git config`).
Each test is synchronous (the flush itself is sync; app.py runs it in an executor).
"""
import json
import subprocess
from datetime import datetime, timezone

from worker.ledgerwriter import SessionLedger
from worker.state import StatePublisher

ID = ["-c", "user.name=seed", "-c", "user.email=seed@agents.local"]
TRANSCRIPTS = "orgs/atlas/output/transcripts"


def _dt(sec: int) -> datetime:
    return datetime(2026, 7, 20, 12, 0, sec, tzinfo=timezone.utc)


def _git(args, cwd, check=True):
    r = subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True)
    if check and r.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed in {cwd}:\n{r.stdout}\n{r.stderr}")
    return r


def _real_runner(args, cwd):
    """The production seam shape: fn(args, cwd) -> CompletedProcess (never check=True)."""
    return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True)


def _seed_origin(tmp_path):
    """Bare 'origin' with an `ops` branch carrying one initial commit; return its path."""
    origin = tmp_path / "origin.git"
    _git(["init", "--bare", "-b", "ops", str(origin)], tmp_path)
    seed = tmp_path / "seed"
    _git(["clone", str(origin), str(seed)], tmp_path)
    _git(["checkout", "-b", "ops"], seed, check=False)  # tolerate already-on-ops
    (seed / "README.md").write_text("kb ops\n", encoding="utf-8")
    _git(["add", "README.md"], seed)
    _git([*ID, "commit", "-m", "seed ops"], seed)
    _git(["push", "-u", "origin", "ops"], seed)
    return origin


def _clone(origin, dest):
    """A working clone checked out on ops."""
    _git(["clone", str(origin), str(dest)], dest.parent)
    _git(["checkout", "ops"], dest, check=False)
    return dest


def _origin_file(origin, tmp_path, relpath):
    """Read a file's content from the bare origin's ops branch directly (no clone/checkout, so
    deep transcript paths under a long tmp dir can't trip Windows MAX_PATH)."""
    r = subprocess.run(["git", "--git-dir", str(origin), "show", f"ops:{relpath}"],
                       capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def _ops_commit_count(origin, tmp_path):
    r = subprocess.run(["git", "--git-dir", str(origin), "rev-list", "--count", "ops"],
                       capture_output=True, text=True)
    return int(r.stdout.strip())


def _ledger_with_session(work, lines, clock=None):
    """A publisher + subscribed ledger with `lines` [(role, text), ...] buffered under a fresh
    session; returns (ledger, session_id)."""
    pub = StatePublisher(clock=clock or (lambda: _dt(0)))
    ledger = SessionLedger(work, git_runner=_real_runner, clock=clock or (lambda: _dt(0)))
    ledger.subscribe_to(pub)
    sid = pub.start_session()
    for role, text in lines:
        pub.add_line(role, text)
    return ledger, sid


# --------------------------------------------------------------------------------------------
def test_happy_path_writes_jsonl_and_pushes(tmp_path):
    origin = _seed_origin(tmp_path)
    work = _clone(origin, tmp_path / "work")
    ledger, sid = _ledger_with_session(
        work, [("user", "what's in the queue"), ("atlas", "Three cards in flight.")]
    )

    ledger.flush(sid)

    rel = f"{TRANSCRIPTS}/2026-07-20-{sid}.jsonl"
    content = _origin_file(origin, tmp_path, rel)
    assert content is not None, "transcript file must be pushed to origin"
    rows = [json.loads(ln) for ln in content.splitlines() if ln.strip()]
    assert rows == [
        {"t": _dt(0).isoformat(), "role": "user", "text": "what's in the queue"},
        {"t": _dt(0).isoformat(), "role": "atlas", "text": "Three cards in flight."},
    ]


def test_jsonl_rows_have_exactly_t_role_text(tmp_path):
    origin = _seed_origin(tmp_path)
    work = _clone(origin, tmp_path / "work")
    ledger, sid = _ledger_with_session(work, [("user", "hi"), ("atlas", "Yes?")])

    ledger.flush(sid)

    content = _origin_file(origin, tmp_path, f"{TRANSCRIPTS}/2026-07-20-{sid}.jsonl")
    for ln in content.splitlines():
        if not ln.strip():
            continue
        assert set(json.loads(ln).keys()) == {"t", "role", "text"}


def test_commit_message_names_the_session(tmp_path):
    origin = _seed_origin(tmp_path)
    work = _clone(origin, tmp_path / "work")
    ledger, sid = _ledger_with_session(work, [("user", "hi")])

    ledger.flush(sid)

    log = _git(["log", "-1", "--pretty=%s", "ops"], work).stdout.strip()
    assert log == f"atlas: session transcript {sid}"


def test_commit_uses_atlas_worker_identity_not_git_config(tmp_path):
    origin = _seed_origin(tmp_path)
    work = _clone(origin, tmp_path / "work")
    ledger, sid = _ledger_with_session(work, [("user", "hi")])

    ledger.flush(sid)

    author = _git(["log", "-1", "--pretty=%an <%ae>", "ops"], work).stdout.strip()
    assert author == "atlas-worker <atlas-worker@agents.local>"


def test_empty_session_writes_no_file_and_no_commit(tmp_path):
    origin = _seed_origin(tmp_path)
    work = _clone(origin, tmp_path / "work")
    pub = StatePublisher(clock=lambda: _dt(0))
    ledger = SessionLedger(work, git_runner=_real_runner, clock=lambda: _dt(0))
    ledger.subscribe_to(pub)
    sid = pub.start_session()  # no lines added

    before = _ops_commit_count(origin, tmp_path)
    ledger.flush(sid)
    after = _ops_commit_count(origin, tmp_path)

    assert before == after, "empty session must not create a commit"
    assert _origin_file(origin, tmp_path, f"{TRANSCRIPTS}/2026-07-20-{sid}.jsonl") is None


def test_rejected_push_rebases_and_retries(tmp_path):
    origin = _seed_origin(tmp_path)
    work = _clone(origin, tmp_path / "work")
    other = _clone(origin, tmp_path / "other")

    # A runner that, on the FIRST push, injects a competing commit into origin (from `other`)
    # so our push is rejected non-fast-forward, forcing the ledger's rebase+retry path.
    state = {"competed": False}

    def racing_runner(args, cwd):
        if args and args[0] == "push" and not state["competed"]:
            state["competed"] = True
            (other / "rival.txt").write_text("rival\n", encoding="utf-8")
            _git(["add", "rival.txt"], other)
            _git([*ID, "commit", "-m", "rival commit"], other)
            _git(["push", "origin", "ops"], other)
        return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True)

    pub = StatePublisher(clock=lambda: _dt(0))
    ledger = SessionLedger(work, git_runner=racing_runner, clock=lambda: _dt(0))
    ledger.subscribe_to(pub)
    sid = pub.start_session()
    pub.add_line("user", "queue please")

    ledger.flush(sid)

    assert state["competed"], "the racing runner must have injected a competing push"
    # Both commits landed on origin ops.
    assert _origin_file(origin, tmp_path, "rival.txt") == "rival\n"
    ours = _origin_file(origin, tmp_path, f"{TRANSCRIPTS}/2026-07-20-{sid}.jsonl")
    assert ours is not None and "queue please" in ours


def test_git_failure_retains_lines_and_next_flush_succeeds(tmp_path):
    origin = _seed_origin(tmp_path)
    work = _clone(origin, tmp_path / "work")

    mode = {"fail": True}

    def flaky_runner(args, cwd):
        if mode["fail"]:
            raise OSError("simulated network down")
        return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True)

    pub = StatePublisher(clock=lambda: _dt(0))
    ledger = SessionLedger(work, git_runner=flaky_runner, clock=lambda: _dt(0))
    ledger.subscribe_to(pub)
    sid = pub.start_session()
    pub.add_line("user", "durable line")

    ledger.flush(sid)  # must NOT raise despite the runner blowing up
    rel = f"{TRANSCRIPTS}/2026-07-20-{sid}.jsonl"
    assert _origin_file(origin, tmp_path, rel) is None, "nothing pushed on failure"

    mode["fail"] = False
    ledger.flush(sid)  # lines were retained -> this flush succeeds

    content = _origin_file(origin, tmp_path, rel)
    assert content is not None and "durable line" in content


def test_lines_are_bucketed_per_session(tmp_path):
    origin = _seed_origin(tmp_path)
    work = _clone(origin, tmp_path / "work")
    pub = StatePublisher(clock=lambda: _dt(0))
    ledger = SessionLedger(work, git_runner=_real_runner, clock=lambda: _dt(0))
    ledger.subscribe_to(pub)

    sid_a = pub.start_session()
    pub.add_line("user", "alpha line")
    sid_b = pub.start_session()  # a new wake re-mints the id
    pub.add_line("user", "bravo line")

    ledger.flush(sid_a)

    a = _origin_file(origin, tmp_path, f"{TRANSCRIPTS}/2026-07-20-{sid_a}.jsonl")
    assert a is not None and "alpha line" in a and "bravo line" not in a
    # session B's file is not written by flush(A)
    assert _origin_file(origin, tmp_path, f"{TRANSCRIPTS}/2026-07-20-{sid_b}.jsonl") is None


def test_non_line_events_are_ignored(tmp_path):
    """State-change events must not become transcript rows."""
    origin = _seed_origin(tmp_path)
    work = _clone(origin, tmp_path / "work")
    from worker import state as state_mod

    pub = StatePublisher(clock=lambda: _dt(0))
    ledger = SessionLedger(work, git_runner=_real_runner, clock=lambda: _dt(0))
    ledger.subscribe_to(pub)
    sid = pub.start_session()
    pub.set_state(state_mod.LISTENING)   # ("state", ...) event
    pub.add_line("user", "only line")
    pub.set_state(state_mod.THINKING)    # ("state", ...) event

    ledger.flush(sid)

    content = _origin_file(origin, tmp_path, f"{TRANSCRIPTS}/2026-07-20-{sid}.jsonl")
    rows = [json.loads(ln) for ln in content.splitlines() if ln.strip()]
    assert rows == [{"t": _dt(0).isoformat(), "role": "user", "text": "only line"}]
