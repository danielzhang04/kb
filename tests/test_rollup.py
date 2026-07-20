"""Wave A — Chief-of-Staff EOD rollup renderer (scripts/rollup.py).

Covers: empty repo, completions-by-mtime, unfinished listing with
deferred_count, 3+-deferral flagging, propose-only PROPOSALS section,
increment_deferral (in-place frontmatter edit), idempotent writes, and the CLI
preamble-failure path."""
import datetime
import os
from pathlib import Path

import cards
import rollup

DATE = "2026-07-19"


def _repo(tmp_path) -> Path:
    repo = tmp_path / "repo"
    for state in ("inbox", "working", "approvals", "done"):
        (repo / "queue" / state).mkdir(parents=True)
    (repo / "dashboards").mkdir(parents=True)
    return repo


def _card(repo, state, *, tier="T2", action="do-thing", target="svc-a",
          cid=None, deferred=None):
    card = cards.new_card("kb-ops", action, target, tier,
                          body="## Work order\ndo it\n", state=state)
    if cid is not None:
        card.meta["id"] = cid
    if deferred is not None:
        card.meta["deferred_count"] = deferred
    return cards.save(card, repo / "queue")


def _set_mtime_day(path: Path, day: str):
    ts = datetime.datetime.fromisoformat(f"{day}T12:00:00").timestamp()
    os.utime(path, (ts, ts))


# --------------------------------------------------------------------------- #
# empty repo                                                                   #
# --------------------------------------------------------------------------- #

def test_empty_repo(tmp_path):
    repo = _repo(tmp_path)
    text = rollup.render_rollup(repo, DATE)
    assert f"# EOD rollup — {DATE}" in text
    assert "No cards completed today." in text
    assert "Nothing in flight" in text
    assert "No proposals" in text
    assert "propose-only" in text


# --------------------------------------------------------------------------- #
# completions today (by done-card mtime) + archive proposals                   #
# --------------------------------------------------------------------------- #

def test_completed_today_and_archive_proposal(tmp_path):
    repo = _repo(tmp_path)
    done_today = _card(repo, "done", tier="T1", action="finished-today", cid="0000000a-11111111")
    done_old = _card(repo, "done", tier="T1", action="finished-yesterday", cid="0000000b-22222222")
    _set_mtime_day(done_today, DATE)
    _set_mtime_day(done_old, "2026-07-17")

    text = rollup.render_rollup(repo, DATE)
    completed = text.split("## Completed today", 1)[1].split("## Unfinished", 1)[0]
    assert "finished-today" in completed
    assert "finished-yesterday" not in completed

    proposals = text.split("## Proposals", 1)[1]
    assert f"archive completed card `{done_today.stem}`" in proposals


# --------------------------------------------------------------------------- #
# unfinished listing + 3+ deferral flag + re-queue proposal                    #
# --------------------------------------------------------------------------- #

def test_unfinished_deferrals_and_requeue_proposal(tmp_path):
    repo = _repo(tmp_path)
    stuck = _card(repo, "working", tier="T2", action="stuck-work", deferred=4, cid="0000000a-aaaaaaaa")
    _card(repo, "inbox", tier="T1", action="fresh-work", deferred=0, cid="0000000b-bbbbbbbb")

    text = rollup.render_rollup(repo, DATE)

    unfinished = text.split("## Unfinished", 1)[1].split("## 3+ deferrals", 1)[0]
    assert "stuck-work" in unfinished and "4 deferral(s)" in unfinished
    assert "[3+ DEFERRALS]" in unfinished
    assert "fresh-work" in unfinished

    stuck_section = text.split("## 3+ deferrals", 1)[1].split("## Proposals", 1)[0]
    assert "stuck-work" in stuck_section

    proposals = text.split("## Proposals", 1)[1]
    assert f"re-queue or escalate `{stuck.stem}`" in proposals
    # rollup is propose-only: it must NOT have mutated the card's counter
    assert cards.parse(stuck).meta["deferred_count"] == 4


# --------------------------------------------------------------------------- #
# increment_deferral — in-place frontmatter edit, state/location unchanged      #
# --------------------------------------------------------------------------- #

def test_increment_deferral_edits_in_place(tmp_path):
    repo = _repo(tmp_path)
    path = _card(repo, "working", tier="T2", action="w", cid="0000000a-cccccccc")

    assert rollup.increment_deferral(path) == 1
    assert rollup.increment_deferral(path) == 2

    reparsed = cards.parse(path)
    assert reparsed.meta["deferred_count"] == 2
    # state (hence on-disk location) is unchanged — still under working/
    assert reparsed.meta["state"] == "working"
    assert path.exists()
    assert path.parent.name == "working"


def test_increment_deferral_from_missing_counter(tmp_path):
    repo = _repo(tmp_path)
    path = _card(repo, "inbox", tier="T1", action="w", cid="0000000a-dddddddd")
    # no deferred_count frontmatter at all -> first increment yields 1
    assert "deferred_count" not in cards.parse(path).meta
    assert rollup.increment_deferral(path) == 1


# --------------------------------------------------------------------------- #
# idempotent writes                                                            #
# --------------------------------------------------------------------------- #

def test_write_rollup_idempotent(tmp_path):
    repo = _repo(tmp_path)
    p1 = rollup.write_rollup(repo, DATE)
    mtime1 = p1.stat().st_mtime_ns
    p2 = rollup.write_rollup(repo, DATE)
    assert p2 == p1
    assert p2.stat().st_mtime_ns == mtime1

    _card(repo, "working", tier="T3", action="new-inflight", cid="0000000f-99998888")
    p3 = rollup.write_rollup(repo, DATE)
    assert "new-inflight" in p3.read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# CLI preamble-failure path                                                     #
# --------------------------------------------------------------------------- #

def test_cli_stops_on_preamble_failure(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(rollup.preamble, "check",
                        lambda *a, **k: ["STOP file present — fleet is frozen"])

    rc = rollup.main(["--date", DATE, "--dry-run"])
    out = capsys.readouterr().out
    assert rc == 1
    assert "PREAMBLE FAIL" in out
    assert not rollup.rollup_path(repo, DATE).exists()
