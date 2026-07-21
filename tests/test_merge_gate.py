"""T1 — scripts/merge_gate.py: file/close a merge-gate card, dedup on PARSED state.

The load-bearing invariant here is the branch_hygiene N1 lesson: dedup keys on a
card's parsed ``state`` field, NEVER on which directory the file happens to live
in (the approvals/ dir hosts both live and resolved states). These tests prove
parsed state wins over directory membership.
"""
import yaml

import cards
import merge_gate


# --------------------------------------------------------------------------- #
# fixtures (mirror tests/test_brief.py::_repo)                                 #
# --------------------------------------------------------------------------- #

def _repo(tmp_path):
    repo = tmp_path / "repo"
    for state in ("inbox", "working", "approvals", "done"):
        (repo / "queue" / state).mkdir(parents=True)
    return repo


def _write_raw(path, meta, body="## Work order\n"):
    """Hand-write a card's frontmatter+body into an ARBITRARY dir (may disagree
    with cards.STATE_DIR) to prove find_live keys on parsed state, not dir."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fm = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True)
    path.write_text(f"---\n{fm}---\n\n{body}", encoding="utf-8")


# --------------------------------------------------------------------------- #
# file(): mints a gate card                                                    #
# --------------------------------------------------------------------------- #

def test_file_creates_gate_card(tmp_path):
    qr = _repo(tmp_path) / "queue"
    card = merge_gate.file(
        qr, target="42", repo="kb", branch="codex/foo",
        pr_url="https://github.com/o/kb/pull/42", unblocks="merge of codex/foo",
    )
    assert card.meta["action"] == "approve:merge:42"
    assert card.meta["target"] == "42"
    assert card.meta["owner"] == "human-operator"
    assert card.meta["state"] == "inbox"
    # one card, landed in queue/inbox
    assert (qr / "inbox" / f"{card.meta['id']}.md").exists()
    assert len(list(qr.glob("**/*.md"))) == 1
    # body names repo / branch / pr / unblocks
    body = card.body
    assert "kb" in body and "codex/foo" in body
    assert "pull/42" in body and "merge of codex/foo" in body


# --------------------------------------------------------------------------- #
# file(): dedups on a live state                                               #
# --------------------------------------------------------------------------- #

def test_file_dedups_on_live_state(tmp_path):
    qr = _repo(tmp_path) / "queue"
    first = merge_gate.file(qr, target="42", repo="kb", branch="b", unblocks="u")
    second = merge_gate.file(qr, target="42", repo="kb", branch="b", unblocks="u")
    assert second.meta["id"] == first.meta["id"]      # same card returned
    assert len(list(qr.glob("**/*.md"))) == 1         # no second file written


# --------------------------------------------------------------------------- #
# dedup keys on PARSED state, not directory (branch_hygiene N1)                #
# --------------------------------------------------------------------------- #

def test_dedup_keys_on_parsed_state_not_dir(tmp_path):
    qr = _repo(tmp_path) / "queue"

    # (a) a prior gate whose PARSED state is terminal (done) must NOT block a new
    #     file, even though a same-target card exists on disk.
    done_gate = cards.new_card("kb", "approve:merge:99", "99", "T2",
                               body="## Work order\n", owner="human-operator",
                               state="done")
    cards.save(done_gate, qr)  # lands in queue/done
    fresh = merge_gate.file(qr, target="99", repo="kb", branch="b", unblocks="u")
    assert fresh.meta["id"] != done_gate.meta["id"]
    assert fresh.meta["state"] == "inbox"

    # (b) a LIVE gate (parsed state 'working') hand-written into an UNEXPECTED dir
    #     (approvals/) MUST dedup — parsed state wins over directory membership.
    live = cards.new_card("kb", "approve:merge:77", "77", "T2",
                          body="## Work order\n", owner="human-operator")
    live.meta["state"] = "working"
    _write_raw(qr / "approvals" / f"{live.meta['id']}.md", live.meta)
    got = merge_gate.file(qr, target="77", repo="kb", branch="b", unblocks="u")
    assert got.meta["id"] == live.meta["id"]           # deduped despite wrong dir


# --------------------------------------------------------------------------- #
# close(): walks a live gate to done; None when absent                         #
# --------------------------------------------------------------------------- #

def test_close_walks_gate_to_done(tmp_path):
    qr = _repo(tmp_path) / "queue"
    filed = merge_gate.file(qr, target="42", repo="kb", branch="b", unblocks="u")
    closed = merge_gate.close(qr, target="42", result="PR #42 merged into ops")
    assert closed is not None
    assert closed.meta["state"] == "done"
    assert (qr / "done" / f"{filed.meta['id']}.md").exists()
    assert not (qr / "inbox" / f"{filed.meta['id']}.md").exists()
    reparsed = cards.parse(qr / "done" / f"{filed.meta['id']}.md")
    assert "## Result" in reparsed.body and "PR #42 merged into ops" in reparsed.body

    # close on an absent target returns None
    assert merge_gate.close(qr, target="does-not-exist", result="x") is None


# --------------------------------------------------------------------------- #
# target may be a PR number OR a branch name                                    #
# --------------------------------------------------------------------------- #

def test_file_target_can_be_branch_or_pr_number(tmp_path):
    qr = _repo(tmp_path) / "queue"
    c1 = merge_gate.file(qr, target="123", repo="kb", branch="b", unblocks="u")
    c2 = merge_gate.file(qr, target="codex/foo-bar", repo="kb",
                         branch="codex/foo-bar", unblocks="u")
    assert c1.meta["action"] == "approve:merge:123"
    assert c2.meta["action"] == "approve:merge:codex/foo-bar"
    assert c2.meta["target"] == "codex/foo-bar"


# --------------------------------------------------------------------------- #
# CLI: file + close subcommands                                                #
# --------------------------------------------------------------------------- #

def test_cli_file_then_close(tmp_path, capsys):
    qr = _repo(tmp_path) / "queue"
    rc = merge_gate.main([
        "file", "--queue-root", str(qr), "--target", "55",
        "--repo", "kb", "--branch", "codex/x", "--unblocks", "merge x",
    ])
    assert rc == 0
    out = capsys.readouterr().out
    assert "id=" in out and "target=55" in out
    assert merge_gate.find_live(qr, "55") is not None

    rc = merge_gate.main([
        "close", "--queue-root", str(qr), "--target", "55", "--result", "done via cli",
    ])
    assert rc == 0
    assert merge_gate.find_live(qr, "55") is None       # no live gate remains

    # close on an absent target -> nonzero exit
    rc = merge_gate.main([
        "close", "--queue-root", str(qr), "--target", "nope", "--result", "x",
    ])
    assert rc == 1


# --------------------------------------------------------------------------- #
# LIVE_STATES excludes the terminal states                                     #
# --------------------------------------------------------------------------- #

def test_live_states_exclude_terminal(tmp_path):
    for terminal in ("done", "rejected", "halted"):
        assert terminal not in merge_gate.LIVE_STATES
    for live in ("inbox", "working", "blocked", "approvals"):
        assert live in merge_gate.LIVE_STATES
