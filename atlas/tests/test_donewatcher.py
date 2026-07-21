"""Card-completion callbacks (Task 11, design §8).

`DoneWatcher` persists the ids of cards Atlas filed by voice into a small JSON sidecar
(restart-safe), and on each `poll()` pull-rebases the ops worktree, scans the queue state dirs
for those ids, and returns a spoken `Announcement` for any that reached a terminal state —
`done` (success) or a failure state (`rejected`/`halted`, verified against scripts/cards.py's
STATES/LEGAL). Announced ids are dropped from the sidecar.

The queue is built with the REAL card schema (`cards.new_card/save/claim/transition`) — no
hand-guessed frontmatter. The git pull is exercised through the injected `git_runner` seam: the
scan reads the local ops worktree AFTER a (fake, no-network) pull, so a returncode-0 runner is a
no-op pull and a raising/non-zero runner is a pull failure. The sidecar path is ALWAYS injected
to a tmp file — a test never touches the real `%USERPROFILE%\\.atlas\\watched.json`.
"""
import json
import subprocess

import cards

from worker.donewatcher import Announcement, DoneWatcher, MISS_LIMIT


# --- git-runner seams ------------------------------------------------------------------------
def _ok_runner(args, cwd):
    """A no-op pull: returncode 0, no network. The scan reads the on-disk queue we built."""
    return subprocess.CompletedProcess(args, 0, "", "")


def _raising_runner(args, cwd):
    raise OSError("simulated ops unreachable")


def _nonzero_runner(args, cwd):
    return subprocess.CompletedProcess(args, 1, "", "fatal: could not read from remote")


# --- queue builders (real schema) ------------------------------------------------------------
def _queue(ops_root):
    return ops_root / "queue"


def _file_inbox(ops_root, action="check the renderer", project="atlas"):
    """Land a fresh card in queue/inbox; return its id."""
    c = cards.new_card(project, action, "orgs/x/", "T2", body="## Work order\nx\n")
    cards.save(c, _queue(ops_root))
    return c.meta["id"]


def _move(ops_root, card_id, *states):
    """Walk a card through `states` with the real transition rules (claim before working)."""
    path = _queue(ops_root) / "inbox" / f"{card_id}.md"
    card = cards.parse(path)
    cards.claim(card, "some-agent")
    for s in states:
        cards.transition(card, s, _queue(ops_root))


# --------------------------------------------------------------------------------------------
def test_watch_round_trip_survives_a_new_instance(tmp_path):
    sidecar = tmp_path / "watched.json"
    w1 = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_ok_runner)
    w1.watch("card-1", "check the faceless renderer")

    # A brand-new instance (simulating a worker restart) sees the persisted watch.
    w2 = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_ok_runner)
    assert w2.has_watches()

    persisted = json.loads(sidecar.read_text(encoding="utf-8"))
    assert "card-1" in persisted
    assert persisted["card-1"]["spoken_label"] == "check the faceless renderer"


def test_poll_watched_card_reaching_done_announces_success_and_empties_sidecar(tmp_path):
    sidecar = tmp_path / "watched.json"
    watched = _file_inbox(tmp_path, action="check the renderer")
    _move(tmp_path, watched, "working", "done")
    # An UNWATCHED card also sitting in done/ must not be announced (filter by watched id).
    other = _file_inbox(tmp_path, action="something else")
    _move(tmp_path, other, "working", "done")

    w = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_ok_runner)
    w.watch(watched, "check the renderer")

    anns = w.poll()

    assert len(anns) == 1
    assert anns[0].card_id == watched
    assert anns[0].outcome == "success"
    assert not w.has_watches(), "an announced card is removed from the sidecar"
    assert json.loads(sidecar.read_text(encoding="utf-8")) == {}


def test_poll_failure_state_card_announces_failure(tmp_path):
    sidecar = tmp_path / "watched.json"
    rejected = _file_inbox(tmp_path)
    _move(tmp_path, rejected, "working", "approvals", "rejected")

    w = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_ok_runner)
    w.watch(rejected, "ship the branch")

    anns = w.poll()

    assert len(anns) == 1
    assert anns[0].outcome == "failure"
    assert not w.has_watches()


def test_poll_halted_card_announces_failure(tmp_path):
    """`halted` (the terminal stop-ladder state) is a failure outcome, not success."""
    sidecar = tmp_path / "watched.json"
    halted = _file_inbox(tmp_path)
    _move(tmp_path, halted, "working", "stop-requested", "halting", "halted")

    w = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_ok_runner)
    w.watch(halted, "run the pipeline")

    anns = w.poll()

    assert len(anns) == 1
    assert anns[0].outcome == "failure"


def test_poll_unmoved_card_announces_nothing_and_retains_watch(tmp_path):
    sidecar = tmp_path / "watched.json"
    pending = _file_inbox(tmp_path)   # stays in inbox

    w = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_ok_runner)
    w.watch(pending, "check the renderer")

    assert w.poll() == []
    assert w.has_watches(), "a still-pending card keeps its watch"


def test_poll_working_card_is_pending_not_terminal(tmp_path):
    sidecar = tmp_path / "watched.json"
    working = _file_inbox(tmp_path)
    _move(tmp_path, working, "working")

    w = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_ok_runner)
    w.watch(working, "check the renderer")

    assert w.poll() == []
    assert w.has_watches()


def test_poll_pull_failure_raising_returns_empty_and_retains_watches(tmp_path):
    sidecar = tmp_path / "watched.json"
    done = _file_inbox(tmp_path)
    _move(tmp_path, done, "working", "done")  # would announce if the pull had succeeded

    w = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_raising_runner)
    w.watch(done, "check the renderer")

    assert w.poll() == [], "a pull failure yields no announcements"
    assert w.has_watches(), "watches are retained across a pull failure"


def test_poll_pull_failure_nonzero_returns_empty_and_retains_watches(tmp_path):
    sidecar = tmp_path / "watched.json"
    done = _file_inbox(tmp_path)
    _move(tmp_path, done, "working", "done")

    w = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_nonzero_runner)
    w.watch(done, "check the renderer")

    assert w.poll() == []
    assert w.has_watches()


def test_announcement_text_contains_the_spoken_label(tmp_path):
    sidecar = tmp_path / "watched.json"
    done = _file_inbox(tmp_path)
    _move(tmp_path, done, "working", "done")

    w = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_ok_runner)
    w.watch(done, "check the faceless renderer")

    anns = w.poll()
    assert len(anns) == 1
    assert "check the faceless renderer" in anns[0].text
    assert isinstance(anns[0], Announcement)


def test_unknown_id_nowhere_in_queue_is_retained_not_announced(tmp_path):
    """A watched id that is nowhere in the queue is neither announced nor dropped on a single
    poll — it is retained (bounded: dropped only after MISS_LIMIT consecutive misses)."""
    sidecar = tmp_path / "watched.json"
    (tmp_path / "queue" / "inbox").mkdir(parents=True)  # empty queue

    w = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_ok_runner)
    w.watch("ghost-card", "a card that vanished")

    assert w.poll() == []
    assert w.has_watches(), "a single miss retains the watch"


def test_permanently_missing_id_is_dropped_after_miss_limit(tmp_path):
    """Bounded missing-id policy: after MISS_LIMIT consecutive misses the ghost is dropped
    SILENTLY (no announcement) so it can't keep the poll timer alive forever."""
    sidecar = tmp_path / "watched.json"
    (tmp_path / "queue" / "inbox").mkdir(parents=True)

    w = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_ok_runner)
    w.watch("ghost-card", "a card that vanished")

    for _ in range(MISS_LIMIT):
        assert w.poll() == []  # never announced
    assert not w.has_watches(), "a permanently-missing card is eventually dropped"


def test_found_then_missing_resets_the_miss_counter(tmp_path):
    """A card that reappears (was found pending) resets its miss counter, so a legitimately slow
    card is never dropped by the missing-id bound."""
    sidecar = tmp_path / "watched.json"
    card_id = _file_inbox(tmp_path)  # present in inbox

    w = DoneWatcher(tmp_path, sidecar_path=sidecar, git_runner=_ok_runner)
    w.watch(card_id, "check the renderer")

    # Poll many more times than MISS_LIMIT while the card stays pending: never dropped.
    for _ in range(MISS_LIMIT + 5):
        assert w.poll() == []
    assert w.has_watches()
