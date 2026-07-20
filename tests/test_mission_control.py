"""Wave E — Mission Control tests (scripts/mission_control.py).

Hermetic: every test builds a throwaway repo under tmp_path and asserts on the
pure render/scoring/metric functions. Nothing touches the real queue/, ledgers/,
STOP, or dashboards/. A fixed `NOW` keeps age-derived scores deterministic.
"""
import datetime
from pathlib import Path

import cards
import mission_control as mc

# Fixed clock so age-derived scores are deterministic regardless of run date.
NOW = datetime.datetime(2026, 7, 20, 12, 0, 0, tzinfo=datetime.timezone.utc)


# --------------------------------------------------------------------------- #
# builders                                                                     #
# --------------------------------------------------------------------------- #
def _repo(tmp_path) -> Path:
    repo = tmp_path / "repo"
    for sub in ("queue/approvals", "queue/inbox", "queue/blocked", "queue/working",
                "ledgers/activity", "ledgers/grades", "ledgers/approvals",
                "ledgers/audit", "governance", "dashboards"):
        (repo / sub).mkdir(parents=True, exist_ok=True)
    return repo


def _card(repo: Path, state: str, *, tier="T1", action="edit",
          target="scripts/x.py", cid=None, **extra) -> cards.Card:
    card = cards.new_card(project="kb", action=action, target=target,
                          risk_tier=tier, state=state,
                          body="## Work order\n\ndo it.\n", **extra)
    if cid:
        card.meta["id"] = cid
    cards.save(card, repo / "queue")
    return card


def _id_for_age(days_ago: float) -> str:
    """A card id whose embedded epoch is `days_ago` before NOW."""
    epoch = int(NOW.timestamp() - days_ago * 86400)
    return f"{epoch:08x}-deadbeef"


def _graders(repo: Path, ids=("inspector",)) -> None:
    body = "graders:\n" + "".join(f"  - {i}\n" for i in ids)
    (repo / "governance" / "graders.yaml").write_text(body, encoding="utf-8")


def _grade_row(repo: Path, *, worker, task_type, tier, score, passed,
               inspector="inspector", card_id="c1") -> None:
    shard = repo / "ledgers" / "grades" / f"{inspector}-2026-07-19.tsv"
    header = ("worker\tproject\ttask_type\ttier\tcard_id\tscore\tpass\t"
              "rubric_version\tinspector_id\tts\n")
    new = not shard.exists()
    with shard.open("a", encoding="utf-8") as f:
        if new:
            f.write(header)
        f.write(f"{worker}\tkb\t{task_type}\t{tier}\t{card_id}\t{score}\t"
                f"{passed}\tv1\t{inspector}\t2026-07-19T00:00:00+00:00\n")


# --------------------------------------------------------------------------- #
# section (a): ranked approvals                                                #
# --------------------------------------------------------------------------- #
def test_empty_repo_reports_nothing_pending(tmp_path):
    repo = _repo(tmp_path)
    text = mc.render_mission_control(repo, now=NOW)
    assert "Nothing pending" in text
    assert "# Mission Control" in text


def test_tier_outranks_age(tmp_path):
    repo = _repo(tmp_path)
    # A fresh T3 approval vs a very old T1 approval: tier must win.
    _card(repo, "approvals", tier="T3", cid=_id_for_age(0), action="approve:big")
    _card(repo, "approvals", tier="T1", cid=_id_for_age(100), action="approve:old")
    ranked = mc._ranked_approvals(repo, NOW, [])
    assert ranked[0]["tier"] == "T3"
    assert ranked[1]["tier"] == "T1"


def test_age_breaks_ties_within_tier(tmp_path):
    repo = _repo(tmp_path)
    _card(repo, "approvals", tier="T2", cid=_id_for_age(1), action="approve:new")
    _card(repo, "approvals", tier="T2", cid=_id_for_age(10), action="approve:old")
    ranked = mc._ranked_approvals(repo, NOW, [])
    # Same tier + both novel -> older (10 days) ranks first.
    assert ranked[0]["card"].meta["action"] == "approve:old"


def test_wake_me_and_human_gate_included_plain_inbox_excluded(tmp_path):
    repo = _repo(tmp_path)
    _card(repo, "inbox", action="wake-me", target="x")
    _card(repo, "inbox", action="approve:thing", owner="human-operator")
    _card(repo, "inbox", action="edit", target="y")  # plain inbox: excluded
    ranked = mc._ranked_approvals(repo, NOW, [])
    kinds = {e["kind"] for e in ranked}
    assert kinds == {"wake-me", "human-gate"}


def test_novelty_raises_score_and_established_lowers_it(tmp_path):
    repo = _repo(tmp_path)
    _graders(repo)
    # Establish trusted history for (worker=w, task_type=tt, tier=T2).
    _grade_row(repo, worker="w", task_type="tt", tier="T2", score=99, passed="true")
    trusted = __import__("promotion").trusted_grades(repo)
    novel_card = _card(repo, "approvals", tier="T2", action="approve:novel",
                       worker="w", task_type="other")
    established_card = _card(repo, "approvals", tier="T2", action="approve:known",
                             worker="w", task_type="tt")
    novel = mc.risk_score(novel_card, NOW, trusted)
    established = mc.risk_score(established_card, NOW, trusted)
    assert novel["novel"] is True
    assert established["novel"] is False
    assert novel["score"] > established["score"]
    assert established["assurance_class"] == "possession-eligible"


def test_planted_failing_grade_does_not_establish_history(tmp_path):
    repo = _repo(tmp_path)
    _graders(repo)
    # A failing (below-bar) row must NOT count as established history.
    _grade_row(repo, worker="w", task_type="tt", tier="T2", score=0, passed="false")
    trusted = __import__("promotion").trusted_grades(repo)
    card = _card(repo, "approvals", tier="T2", worker="w", task_type="tt")
    assert mc.risk_score(card, NOW, trusted)["novel"] is True


def test_unknown_tier_flagged_signed_only(tmp_path):
    repo = _repo(tmp_path)
    card = cards.new_card(project="kb", action="approve:x", target="t",
                          risk_tier="T3", state="approvals",
                          body="## Work order\n\ndo.\n")
    # Force an unknown tier post-validation (a corrupt/legacy card).
    card.meta["risk-tier"] = "T9"
    score = mc.risk_score(card, NOW, [])
    assert score["known_tier"] is False
    assert score["assurance_class"] == "signed-only"
    assert score["tier_weight"] == 0


# --------------------------------------------------------------------------- #
# section (b): quarantine                                                      #
# --------------------------------------------------------------------------- #
def test_quarantine_clean(tmp_path):
    repo = _repo(tmp_path)
    q = mc.quarantine_state(repo)
    assert not q["stop"] and not q["frozen"] and not q["by_class"]
    assert "Clean" in "\n".join(mc._quarantine_section(q))


def test_quarantine_stop_frozen_and_findings(tmp_path):
    repo = _repo(tmp_path)
    (repo / "STOP").write_text("frozen\n", encoding="utf-8")
    (repo / "ledgers" / "grades" / "FROZEN").write_text(
        "# FROZEN\nreason: fabricated grade\n", encoding="utf-8")
    shard = repo / "ledgers" / "audit" / "sentinel-2026-07-19.tsv"
    shard.write_text(
        "ts\tcard\tclass\tdetail\n"
        "2026-07-19T00:00:00+00:00\tc1\tempty-result\tno Result\n"
        "2026-07-19T00:00:00+00:00\tc2\tempty-result\tno Result\n"
        "2026-07-19T00:00:00+00:00\tc3\tfail-plausible\tclaim vs disk\n",
        encoding="utf-8")
    q = mc.quarantine_state(repo)
    assert q["stop"] and q["frozen"]
    assert q["frozen_reason"] == "fabricated grade"
    assert q["by_class"] == {"empty-result": 2, "fail-plausible": 1}
    section = "\n".join(mc._quarantine_section(q))
    assert "STOP present" in section and "FROZEN" in section
    assert "empty-result: 2" in section


# --------------------------------------------------------------------------- #
# section (c): digest                                                          #
# --------------------------------------------------------------------------- #
def test_digest_excludes_ranked_and_high_tier(tmp_path):
    repo = _repo(tmp_path)
    ranked_card = _card(repo, "inbox", action="wake-me", target="x", tier="T2")
    _card(repo, "inbox", action="edit", target="y", tier="T1")   # batchable
    _card(repo, "blocked", action="edit", target="z", tier="T2")  # batchable
    _card(repo, "inbox", action="edit", target="big", tier="T3")  # excluded: T3
    ranked = mc._ranked_approvals(repo, NOW, [])
    ranked_ids = {str(e["card"].meta["id"]) for e in ranked}
    assert str(ranked_card.meta["id"]) in ranked_ids
    digest = mc._digest_items(repo, ranked_ids)
    tiers = sorted(c.meta["risk-tier"] for c in digest)
    assert tiers == ["T1", "T2"]
    assert ranked_card.meta["id"] not in {c.meta["id"] for c in digest}


# --------------------------------------------------------------------------- #
# section (d): rubber-stamp metric                                            #
# --------------------------------------------------------------------------- #
def _activity(repo: Path, card_id: str, ts: str, kind="appear") -> None:
    shard = repo / "ledgers" / "activity" / "w-2026-07-19.tsv"
    new = not shard.exists()
    with shard.open("a", encoding="utf-8") as f:
        if new:
            f.write("ts\tcard_id\tkind\n")
        f.write(f"{ts}\t{card_id}\t{kind}\n")


def _approval_decision(repo: Path, card_id: str, ts: str) -> None:
    shard = repo / "ledgers" / "approvals" / "poller-2026-07-19.tsv"
    new = not shard.exists()
    with shard.open("a", encoding="utf-8") as f:
        if new:
            f.write("ts\tupdate_id\tcard_id\tdecision\tfrom_id\tresult\n")
        f.write(f"{ts}\t1\t{card_id}\tapprove\t42\tok\n")


def test_rubber_stamp_insufficient_data(tmp_path):
    repo = _repo(tmp_path)
    metric = mc.rubber_stamp_metric(repo)
    assert metric["n"] == 0 and metric["median"] is None and not metric["alarm"]
    assert "insufficient data (n=0)" in "\n".join(mc._rubber_stamp_section(metric))


def test_rubber_stamp_alarm_fires_on_fast_decisions(tmp_path):
    repo = _repo(tmp_path)
    base = datetime.datetime(2026, 7, 19, 10, 0, 0, tzinfo=datetime.timezone.utc)
    # 5 cards, each decided 10s after appearing -> median 10s < floor 120, n>=5.
    for i in range(5):
        appear = (base + datetime.timedelta(minutes=i)).isoformat()
        decide = (base + datetime.timedelta(minutes=i, seconds=10)).isoformat()
        _activity(repo, f"c{i}", appear)
        _approval_decision(repo, f"c{i}", decide)
    metric = mc.rubber_stamp_metric(repo, floor=120)
    assert metric["n"] == 5 and metric["median"] == 10.0 and metric["alarm"] is True
    assert "ALARM" in "\n".join(mc._rubber_stamp_section(metric))


def test_rubber_stamp_no_alarm_when_slow(tmp_path):
    repo = _repo(tmp_path)
    base = datetime.datetime(2026, 7, 19, 10, 0, 0, tzinfo=datetime.timezone.utc)
    for i in range(6):
        appear = (base + datetime.timedelta(hours=i)).isoformat()
        decide = (base + datetime.timedelta(hours=i, seconds=600)).isoformat()
        _activity(repo, f"c{i}", appear)
        _approval_decision(repo, f"c{i}", decide)
    metric = mc.rubber_stamp_metric(repo, floor=120)
    assert metric["n"] == 6 and metric["median"] == 600.0 and metric["alarm"] is False


def test_rubber_stamp_grade_row_counts_as_decision(tmp_path):
    repo = _repo(tmp_path)
    _activity(repo, "c1", "2026-07-19T10:00:00+00:00")
    _grade_row(repo, worker="w", task_type="tt", tier="T1", score=95,
               passed="true", card_id="c1")
    # grade row ts is 2026-07-19T00:00:00 which is BEFORE appearance -> not counted.
    metric = mc.rubber_stamp_metric(repo)
    assert metric["n"] == 0
    # Now a grade AFTER appearance is counted.
    shard = repo / "ledgers" / "grades" / "inspector-2026-07-19.tsv"
    with shard.open("a", encoding="utf-8") as f:
        f.write("w\tkb\ttt\tT1\tc2\t95\ttrue\tv1\tinspector\t"
                "2026-07-19T10:05:00+00:00\n")
    _activity(repo, "c2", "2026-07-19T10:00:00+00:00")
    metric = mc.rubber_stamp_metric(repo)
    assert metric["n"] == 1 and metric["median"] == 300.0


def test_date_only_ts_excluded(tmp_path):
    repo = _repo(tmp_path)
    _activity(repo, "c1", "2026-07-19")  # date-only, no time-of-day
    _approval_decision(repo, "c1", "2026-07-19T10:00:00+00:00")
    assert mc.rubber_stamp_metric(repo)["n"] == 0


# --------------------------------------------------------------------------- #
# write / idempotency / CLI                                                    #
# --------------------------------------------------------------------------- #
def test_write_is_idempotent(tmp_path):
    repo = _repo(tmp_path)
    _card(repo, "approvals", tier="T3", action="approve:x")
    p1 = mc.write_mission_control(repo, now=NOW)
    mtime1 = p1.stat().st_mtime_ns
    p2 = mc.write_mission_control(repo, now=NOW)
    assert p2 == p1 and p2.stat().st_mtime_ns == mtime1  # unchanged -> not rewritten


def test_render_has_all_four_sections(tmp_path):
    repo = _repo(tmp_path)
    text = mc.render_mission_control(repo, now=NOW)
    for heading in ("## Ranked approvals", "## Quarantine",
                    "## Digest", "## Rubber-stamp metric"):
        assert heading in text


def test_cli_preamble_blocks_on_stop(tmp_path, capsys):
    repo = _repo(tmp_path)
    (repo / "STOP").write_text("frozen\n", encoding="utf-8")
    rc = mc.main(["--repo", str(repo)])
    assert rc == 1
    assert "PREAMBLE FAIL" in capsys.readouterr().err
    assert not mc.mission_control_path(repo).exists()


def test_cli_writes_dashboard(tmp_path, capsys):
    repo = _repo(tmp_path)
    _card(repo, "approvals", tier="T2", action="approve:x")
    rc = mc.main(["--repo", str(repo)])
    assert rc == 0
    out = capsys.readouterr().out.strip()
    assert Path(out) == mc.mission_control_path(repo)
    assert mc.mission_control_path(repo).exists()
