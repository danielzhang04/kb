"""Wave A — Chief-of-Staff morning brief renderer (scripts/brief.py).

Covers: empty repo, populated overnight shards, T3>T2>T1 (then oldest-first)
ranking, wake-me inclusion / non-wake-me exclusion, deferral flags, the #1-win
pick, graceful Google-gate placeholders, idempotent writes, and the CLI
preamble-failure path (monkeypatched)."""
import csv
from pathlib import Path

import cards
import brief

DATE = "2026-07-19"
OVERNIGHT = "2026-07-18"  # brief.render_brief summarizes the trailing day


# --------------------------------------------------------------------------- #
# fixtures                                                                     #
# --------------------------------------------------------------------------- #

def _repo(tmp_path) -> Path:
    repo = tmp_path / "repo"
    for state in ("inbox", "working", "approvals", "done"):
        (repo / "queue" / state).mkdir(parents=True)
    (repo / "dashboards").mkdir(parents=True)
    return repo


def _card(repo, state, *, tier="T2", action="do-thing", target="svc-a",
          cid=None, wake=False, deferred=None):
    if wake:
        action = "wake-me:" + action
    card = cards.new_card("kb-ops", action, target, tier,
                          body="## Work order\ndo it\n", state=state)
    if cid is not None:
        card.meta["id"] = cid
    if deferred is not None:
        card.meta["deferred_count"] = deferred
    return cards.save(card, repo / "queue")


def _write_shard(repo, kind, agent, day, rows):
    d = repo / "ledgers" / kind
    d.mkdir(parents=True, exist_ok=True)
    fields = sorted(rows[0])
    with (d / f"{agent}-{day}.tsv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, delimiter="\t")
        w.writeheader()
        for r in rows:
            w.writerow(r)


# --------------------------------------------------------------------------- #
# empty repo — degrades gracefully, never crashes                             #
# --------------------------------------------------------------------------- #

def test_empty_repo_renders_all_sections(tmp_path):
    repo = _repo(tmp_path)
    text = brief.render_brief(repo, DATE)

    assert f"# Morning brief — {DATE}" in text
    assert "No actionable item pending" in text
    assert f"No overnight activity recorded for {OVERNIGHT}" in text
    assert "Nothing pending" in text
    assert "No deferred cards." in text
    # Google gates degrade gracefully to placeholders (brainstorm-doc rule).
    assert "## Calendar" in text and "G1" in text
    assert "## Inbox" in text and "G2" in text


# --------------------------------------------------------------------------- #
# overnight activity from the trailing-day ledger shards                      #
# --------------------------------------------------------------------------- #

def test_overnight_summarizes_trailing_day_shards(tmp_path):
    repo = _repo(tmp_path)
    _write_shard(repo, "dispatch", "dispatcher-cloud", OVERNIGHT, [
        {"cadence": "self-lint-report", "card": "c1", "date": OVERNIGHT, "project": "kb-ops"},
        {"cadence": "self-lint-report", "card": "c2", "date": OVERNIGHT, "project": "kb-ops"},
    ])
    _write_shard(repo, "grades", "inspector@agents.local", OVERNIGHT, [
        {"worker": "w", "project": "kb-ops", "task_type": "t", "tier": "T1",
         "card_id": "c1", "score": "96", "pass": "True", "rubric_version": "1",
         "inspector_id": "inspector@agents.local", "ts": f"{OVERNIGHT}T02:00:00Z"},
        {"worker": "w", "project": "kb-ops", "task_type": "t", "tier": "T1",
         "card_id": "c2", "score": "80", "pass": "False", "rubric_version": "1",
         "inspector_id": "inspector@agents.local", "ts": f"{OVERNIGHT}T03:00:00Z"},
    ])
    _write_shard(repo, "activity", "inspector@agents.local", OVERNIGHT, [
        {"ts": f"{OVERNIGHT}T02:00:00Z", "inspector_id": "i", "card_id": "c1",
         "worker": "w", "project": "kb-ops", "task_type": "t", "tier": "T1", "kind": "grade"},
    ])
    _write_shard(repo, "cost", "dispatcher-cloud", OVERNIGHT, [
        {"model": "claude-sonnet-5", "step": "run", "usd": "0"},
    ])

    text = brief.render_brief(repo, DATE)
    assert "Dispatched: 2 card(s)" in text
    assert "self-lint-report x2" in text
    assert "Grades: 2 (1 pass / 1 fail, avg 88.0)" in text
    assert "Activity: 1 row(s) (grade x1)" in text
    assert "Cost: $0.00 over 1 logged step(s)" in text


# --------------------------------------------------------------------------- #
# ranking: T3 > T2 > T1, then oldest-first within a tier                      #
# --------------------------------------------------------------------------- #

def test_pending_ranked_by_tier_then_age(tmp_path):
    repo = _repo(tmp_path)
    # Two T2 approvals with controlled id-timestamp prefixes: 0x0a < 0x0b so
    # the first is OLDER and must rank ahead of the second.
    _card(repo, "approvals", tier="T1", cid="0000000c-11111111", action="t1-item")
    _card(repo, "approvals", tier="T3", cid="0000000d-22222222", action="t3-item")
    _card(repo, "approvals", tier="T2", cid="0000000b-33333333", action="t2-new")
    _card(repo, "approvals", tier="T2", cid="0000000a-44444444", action="t2-old")

    text = brief.render_brief(repo, DATE)
    order = [ln for ln in text.splitlines() if ln[:2] in ("1.", "2.", "3.", "4.")]
    assert "t3-item" in order[0]        # T3 first
    assert "t2-old" in order[1]         # older T2 before newer T2
    assert "t2-new" in order[2]
    assert "t1-item" in order[3]        # T1 last

    # #1 win is the top-ranked item.
    win = text.split("## #1 win\n", 1)[1].splitlines()[0]
    assert "t3-item" in win and "T3" in win


# --------------------------------------------------------------------------- #
# wake-me cards count as actionable; ordinary inbox cards do not              #
# --------------------------------------------------------------------------- #

def test_wake_me_included_ordinary_inbox_excluded(tmp_path):
    repo = _repo(tmp_path)
    _card(repo, "inbox", tier="T1", action="wakeup", wake=True, cid="0000000a-aaaaaaaa")
    _card(repo, "inbox", tier="T2", action="ordinary-work", cid="0000000b-bbbbbbbb")

    text = brief.render_brief(repo, DATE)
    pending = text.split("## Pending", 1)[1].split("## Deferrals", 1)[0]
    assert "wake-me:wakeup" in pending
    assert "ordinary-work" not in pending


# --------------------------------------------------------------------------- #
# human-gate inbox cards (human-operator-owned or approve:*) are actionable   #
# --------------------------------------------------------------------------- #

def test_human_gate_inbox_cards_included(tmp_path):
    repo = _repo(tmp_path)
    gate = cards.new_card("kb-ops", "approve:oauth-gate-g1", "console.cloud.google.com",
                          "T3", body="## Work order\nclick through\n", state="inbox")
    gate.meta["owner"] = "human-operator"
    cards.save(gate, repo / "queue")
    owned = cards.new_card("kb-ops", "setup-something", "svc-b",
                           "T2", body="## Work order\nhuman does this\n", state="inbox")
    owned.meta["owner"] = "human-operator"
    cards.save(owned, repo / "queue")
    _card(repo, "inbox", tier="T2", action="ordinary-work", cid="0000000c-cccccccc")

    text = brief.render_brief(repo, DATE)
    pending = text.split("## Pending", 1)[1].split("## Deferrals", 1)[0]
    assert "human-gate" in pending
    assert "approve:oauth-gate-g1" in pending      # approve:* action counts
    assert "setup-something" in pending            # human-operator owner counts
    assert "ordinary-work" not in pending
    # T3 gate outranks everything else → it is the #1 win.
    win = text.split("## #1 win", 1)[1].split("## Overnight", 1)[0]
    assert "approve:oauth-gate-g1" in win and "one-time human gate" in win


# --------------------------------------------------------------------------- #
# deferral flags                                                               #
# --------------------------------------------------------------------------- #

def test_deferral_flags(tmp_path):
    repo = _repo(tmp_path)
    _card(repo, "working", tier="T2", action="stuck", deferred=3, cid="0000000a-eeeeeeee")
    _card(repo, "working", tier="T2", action="once", deferred=1, cid="0000000b-ffffffff")
    _card(repo, "working", tier="T2", action="fresh", deferred=0, cid="0000000c-11112222")

    text = brief.render_brief(repo, DATE)
    deferrals = text.split("## Deferrals", 1)[1].split("## Calendar", 1)[0]
    assert "3 deferral(s)" in deferrals
    assert "[3+ DEFERRALS" in deferrals
    assert "1 deferral(s)" in deferrals
    # the 0-deferral card is not listed
    assert deferrals.count("deferral(s)") == 2


# --------------------------------------------------------------------------- #
# idempotent writes                                                           #
# --------------------------------------------------------------------------- #

def test_write_brief_idempotent(tmp_path):
    repo = _repo(tmp_path)
    p1 = brief.write_brief(repo, DATE)
    mtime1 = p1.stat().st_mtime_ns

    p2 = brief.write_brief(repo, DATE)
    assert p2 == p1
    # identical content => not rewritten => mtime unchanged
    assert p2.stat().st_mtime_ns == mtime1

    # a real change forces a rewrite
    _card(repo, "approvals", tier="T3", action="new-approval", cid="0000000f-99998888")
    p3 = brief.write_brief(repo, DATE)
    assert "new-approval" in p3.read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# CLI preamble-failure path (STOP-file supremacy)                             #
# --------------------------------------------------------------------------- #

def test_cli_stops_on_preamble_failure(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(brief.preamble, "check",
                        lambda *a, **k: ["STOP file present — fleet is frozen"])

    rc = brief.main(["--date", DATE, "--dry-run"])
    out = capsys.readouterr().out
    assert rc == 1
    assert "PREAMBLE FAIL" in out
    assert "STOP file present" in out
    # nothing was written
    assert not brief.brief_path(repo, DATE).exists()


def test_cli_writes_when_preamble_clean(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(brief.preamble, "check", lambda *a, **k: [])

    rc = brief.main(["--date", DATE])
    out = capsys.readouterr().out
    assert rc == 0
    path = brief.brief_path(repo, DATE)
    assert path.exists()
    assert str(path) in out
