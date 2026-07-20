"""Wave B — trust derivation (scripts/trust.py).

Pure projection over the grade ledger: rolling pass^k per subject, streak, floor
status, and regression detection. Reuses promotion.py's window/floor constants
(imported, never copied). All hermetic on a tmp repo_root; never the real ledger.
"""
from pathlib import Path

import grade
import promotion
import trust


def _seed(root: Path, *, worker, task_type, tier, scores, capability=None):
    """Write a chronological run of grade rows to a tmp grades ledger."""
    tt = task_type
    for i, (score, passed) in enumerate(scores):
        grade.record_grade(
            root,
            worker=worker,
            project="kb",
            task_type=tt,
            tier=tier,
            card_id=f"{worker}-{i}",
            score=score,
            rubric_version="1",
            inspector_id="inspector@agents.local",
            ts=f"2026-07-19T00:00:{i:02d}+00:00",
            **{"pass": passed},
        )


def test_all_pass_window_reports_pass_hat_k_one(tmp_path):
    root = tmp_path / "repo"
    # 10 clean T1 passes (window=10) for a canary capability.
    _seed(root, worker="canary-suite", task_type="canary:card-parse", tier="T1",
          scores=[(100, True)] * 10)
    rows = trust.compute_trust(root, write=False)
    assert len(rows) == 1
    r = rows[0]
    assert r["subject"] == "canary-suite"
    assert r["capability"] == "card-parse"
    assert r["tier"] == "T1"
    assert r["runs"] == 10 and r["passes"] == 10
    assert r["pass_hat_k"] == 1.0
    assert r["streak"] == 10
    assert r["floor_status"] == "ok"
    assert r["demote"] is False


def test_below_floor_last_run_flags_demote(tmp_path):
    root = tmp_path / "repo"
    # A strong history then a below-floor final run (T1 floor < 80).
    _seed(root, worker="w", task_type="canary:routing-resolution", tier="T1",
          scores=[(100, True)] * 5 + [(50, False)])
    rows = trust.compute_trust(root, write=False)
    r = rows[0]
    assert r["demote"] is True
    assert r["floor_status"] == "below-floor"
    assert r["streak"] == 0  # the below-floor run reset the streak


def test_below_bar_but_above_floor_is_not_pass_hat_k(tmp_path):
    root = tmp_path / "repo"
    # Scores between floor(80) and bar(90): count toward streak but not as passes.
    _seed(root, worker="w", task_type="canary:ledger-shard", tier="T1",
          scores=[(85, True)] * 3)
    r = trust.compute_trust(root, write=False)[0]
    assert r["demote"] is False           # never below floor
    assert r["passes"] < r["runs"]        # but below the bar
    assert r["pass_hat_k"] == 0.0


def test_check_regressions_finds_demotes(tmp_path):
    root = tmp_path / "repo"
    _seed(root, worker="good", task_type="canary:preamble-gate", tier="T1",
          scores=[(100, True)] * 3)
    _seed(root, worker="bad", task_type="canary:preamble-gate", tier="T1",
          scores=[(100, True), (10, False)])
    demoted = trust.check_regressions(root)
    subjects = {r["subject"] for r in demoted}
    assert subjects == {"bad"}


def test_compute_trust_writes_dashboard(tmp_path):
    root = tmp_path / "repo"
    _seed(root, worker="w", task_type="canary:grade-schema", tier="T2",
          scores=[(99, True)] * 4)
    rows = trust.compute_trust(root, write=True)
    dash = root / "dashboards" / "trust.md"
    assert dash.exists()
    text = dash.read_text(encoding="utf-8")
    assert "grade-schema" in text
    assert "window pass^k" in text
    assert rows[0]["tier"] == "T2"


def test_no_grades_yields_empty_and_placeholder_dashboard(tmp_path):
    root = tmp_path / "repo"
    (root).mkdir()
    rows = trust.compute_trust(root, write=True)
    assert rows == []
    assert trust.check_regressions(root) == []
    text = (root / "dashboards" / "trust.md").read_text(encoding="utf-8")
    assert "no grade rows yet" in text


def test_cli_check_regressions_exit_codes(tmp_path, capsys):
    root = tmp_path / "repo"
    _seed(root, worker="w", task_type="canary:card-parse", tier="T1",
          scores=[(100, True)] * 3)
    # Clean -> exit 0.
    assert trust.main(["--repo", str(root), "--check-regressions"]) == 0
    # Add a regression -> exit 1.
    _seed(root, worker="w2", task_type="canary:card-parse", tier="T1",
          scores=[(20, False)])
    assert trust.main(["--repo", str(root), "--check-regressions"]) == 1


def test_uses_promotion_window_constants():
    # Guard the "import, don't copy" contract: trust reads promotion's tiers.
    assert trust.promotion is promotion
    assert "T1" in promotion._TIERS and promotion._TIERS["T1"]["window"] == 10


# --------------------------------------------------------------------------- #
# Wave F delta 2 -- per-(risk-)tier outcome columns (pass + escalation rates)  #
# --------------------------------------------------------------------------- #

def _card(root: Path, *, risk_tier="T1", retry_count=None):
    import cards
    extra = {"state": "inbox"}
    if retry_count is not None:
        extra["retry_count"] = retry_count
    c = cards.new_card(project="kb", action="a", target="t", risk_tier=risk_tier,
                       body="## Work order\n\nx\n", **extra)
    cards.save(c, root / "queue")
    return c


def test_tier_outcomes_with_escalation_data(tmp_path):
    root = tmp_path / "repo"
    # Grades at T1: 3 at/above bar(90), 1 below -> pass rate 3/4.
    _seed(root, worker="w", task_type="canary:card-parse", tier="T1",
          scores=[(100, True), (95, True), (92, True), (50, False)])
    # Queue cards at T1: one escalated (retry_count=1), three not -> 1/4.
    _card(root, retry_count=1)
    _card(root)
    _card(root)
    _card(root)

    outcomes = trust.compute_tier_outcomes(root)
    t1 = next(o for o in outcomes if o["tier"] == "T1")
    assert t1["pass_rate"] == 0.75
    assert t1["escalation_rate"] == 0.25

    trust.compute_trust(root, write=True)
    text = (root / "dashboards" / "trust.md").read_text(encoding="utf-8")
    assert "Per-tier outcomes" in text
    assert "75% (3/4)" in text          # pass rate
    assert "25% (1/4)" in text          # escalation rate


def test_tier_outcomes_without_escalation_data_renders_na(tmp_path):
    root = tmp_path / "repo"
    _seed(root, worker="w", task_type="canary:card-parse", tier="T1",
          scores=[(100, True)] * 3)
    # No queue/ cards at all -> escalation rate is not derivable for any tier.
    outcomes = trust.compute_tier_outcomes(root)
    t1 = next(o for o in outcomes if o["tier"] == "T1")
    assert t1["pass_rate"] == 1.0
    assert t1["escalation_rate"] is None

    trust.compute_trust(root, write=True)
    text = (root / "dashboards" / "trust.md").read_text(encoding="utf-8")
    assert "n/a (no escalation data)" in text
