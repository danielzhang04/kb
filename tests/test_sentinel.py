"""Wave D — Sentinel tests (scripts/sentinel.py).

Fully hermetic: every reconcile/usage test builds a throwaway repo under tmp_path
and asserts on functions/exit-codes. Nothing touches the real queue/, ledgers/, or
STOP.
"""
import datetime
from pathlib import Path

import pytest

import cards
import sentinel

# Fixed clock so audit-shard filenames (UTC-dated) are deterministic regardless
# of the wall-clock date the suite runs on.
NOW = datetime.datetime(2026, 7, 19, 12, 0, 0, tzinfo=datetime.timezone.utc)
DAY = "2026-07-19"


# --------------------------------------------------------------------------- #
# fixtures / builders                                                          #
# --------------------------------------------------------------------------- #
def _repo(tmp_path) -> Path:
    repo = tmp_path / "repo"
    for sub in ("queue/done", "queue/working", "ledgers/dispatch",
                "ledgers/activity", "ledgers/audit", "governance"):
        (repo / sub).mkdir(parents=True, exist_ok=True)
    return repo


def _done(repo: Path, result_body: str, *, dispatched: bool = False,
          session_id=None, action="edit", target="scripts/x.py") -> str:
    body = f"## Work order\n\ndo the thing.\n\n## Result\n\n{result_body}\n"
    card = cards.new_card(project="kb", action=action, target=target,
                          risk_tier="T1", body=body, state="done")
    if session_id:
        cards.stamp_session(card, session_id)
    cards.save(card, repo / "queue")
    cid = card.meta["id"]
    if dispatched:
        shard = repo / "ledgers" / "dispatch" / f"dispatcher-cloud-{DAY}.tsv"
        if not shard.exists():
            shard.write_text("cadence\tcard\tdate\tproject\n", encoding="utf-8")
        with shard.open("a", encoding="utf-8") as f:
            f.write(f"some-cadence\t{cid}\t{DAY}\tkb\n")
    return cid


def _working(repo: Path, owner: str) -> str:
    card = cards.new_card(project="kb", action="edit", target="scripts/y.py",
                          risk_tier="T1", body="## Work order\n\ngo.\n",
                          state="working", owner=owner)
    cards.save(card, repo / "queue")
    return card.meta["id"]


def _clean_result(repo: Path) -> str:
    # A non-trivial Result naming an artifact that actually exists (non-empty).
    (repo / "dashboards").mkdir(exist_ok=True)
    (repo / "dashboards" / "out.md").write_text("content here\n", encoding="utf-8")
    return ("Reconciled the state and updated dashboards/out.md with the refreshed "
            "figures after review by the team lead.")


# --------------------------------------------------------------------------- #
# reconcile: clean + each drift class                                          #
# --------------------------------------------------------------------------- #
def test_clean_repo_reports_nothing(tmp_path):
    repo = _repo(tmp_path)
    _done(repo, _clean_result(repo))
    rep = sentinel.reconcile(repo, now=NOW)
    assert not rep.has_new, [(f.card, f.cls, f.detail) for f in rep.new_findings]


def test_empty_result_detected(tmp_path):
    repo = _repo(tmp_path)
    _done(repo, "done.")  # < 40 chars of content
    rep = sentinel.reconcile(repo, write=False, now=NOW)
    classes = {f.cls for f in rep.new_findings}
    assert "empty-result" in classes


def test_missing_artifact_detected(tmp_path):
    repo = _repo(tmp_path)
    _done(repo, "The write references data/report.csv for the downstream table used later.")
    rep = sentinel.reconcile(repo, write=False, now=NOW)
    assert any(f.cls == "missing-artifact" for f in rep.new_findings), \
        [(f.cls, f.detail) for f in rep.new_findings]


def test_fail_plausible_detected(tmp_path):
    repo = _repo(tmp_path)
    _done(repo, "Created and committed the changes. Wrote dashboards/missing-out.md cleanly.")
    rep = sentinel.reconcile(repo, write=False, now=NOW)
    assert any(f.cls == "fail-plausible" for f in rep.new_findings), \
        [(f.cls, f.detail) for f in rep.new_findings]
    # ... and NOT the neutral missing-artifact (success claim upgrades it).
    assert not any(f.cls == "missing-artifact" for f in rep.new_findings)


def test_sandbox_denial_detected(tmp_path):
    repo = _repo(tmp_path)
    _done(repo, "The step failed: permission denied when writing to the protected tree above.")
    rep = sentinel.reconcile(repo, write=False, now=NOW)
    assert any(f.cls == "sandbox-denial" for f in rep.new_findings)


def test_orphan_claim_working_card(tmp_path):
    repo = _repo(tmp_path)
    _working(repo, owner="ghost-agent")  # no ledger shard for ghost-agent
    rep = sentinel.reconcile(repo, write=False, now=NOW)
    assert any(f.cls == "orphan-claim" for f in rep.new_findings)


def test_working_card_with_recent_ledger_is_not_orphan(tmp_path):
    repo = _repo(tmp_path)
    _working(repo, owner="busy-agent")
    (repo / "ledgers" / "activity" / f"busy-agent-{DAY}.tsv").write_text(
        "ts\tkind\n2026-07-19\twork\n", encoding="utf-8")
    rep = sentinel.reconcile(repo, write=False, now=NOW)
    assert not any(f.cls == "orphan-claim" for f in rep.new_findings)


def test_dispatched_done_card_without_session_is_orphan(tmp_path):
    repo = _repo(tmp_path)
    _done(repo, _clean_result(repo), dispatched=True, session_id=None)
    rep = sentinel.reconcile(repo, write=False, now=NOW)
    assert any(f.cls == "orphan-claim" for f in rep.new_findings)


def test_dispatched_done_card_with_session_is_clean(tmp_path):
    repo = _repo(tmp_path)
    _done(repo, _clean_result(repo), dispatched=True, session_id="sess-abc123")
    rep = sentinel.reconcile(repo, write=False, now=NOW)
    assert not rep.has_new, [(f.cls, f.detail) for f in rep.new_findings]


# --------------------------------------------------------------------------- #
# reconcile: cursor + dedup idempotency                                        #
# --------------------------------------------------------------------------- #
def test_cursor_advances_second_run_clean(tmp_path):
    repo = _repo(tmp_path)
    _done(repo, "done.")  # empty-result drift
    first = sentinel.reconcile(repo, now=NOW)
    assert first.has_new
    # Cursor now past the done card; nothing new on a second unchanged run.
    second = sentinel.reconcile(repo, now=NOW)
    assert not second.has_new


def test_rows_not_duplicated_across_runs(tmp_path):
    repo = _repo(tmp_path)
    _working(repo, owner="ghost-agent")  # re-scanned every run (no cursor)
    sentinel.reconcile(repo, now=NOW)
    sentinel.reconcile(repo, now=NOW)  # second run must dedup against today's shard
    shard = repo / "ledgers" / "audit" / f"sentinel-{DAY}.tsv"
    rows = [ln for ln in shard.read_text(encoding="utf-8").splitlines() if ln.strip()]
    # 1 header + exactly 1 data row (not 2).
    assert len(rows) == 2, rows


def test_reconcile_writes_expected_columns(tmp_path):
    repo = _repo(tmp_path)
    _done(repo, "done.")
    sentinel.reconcile(repo, now=NOW)
    shard = repo / "ledgers" / "audit" / f"sentinel-{DAY}.tsv"
    header = shard.read_text(encoding="utf-8").splitlines()[0]
    assert header.split("\t") == ["ts", "card", "class", "detail"]


# --------------------------------------------------------------------------- #
# usage reservations                                                           #
# --------------------------------------------------------------------------- #
def _budget(repo: Path, **caps):
    lines = ["daily_usd_limit: 5.00"]
    for k, v in caps.items():
        lines.append(f"{k}: {v}")
    (repo / "governance" / "budget.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_reservation_roundtrip_settle(tmp_path):
    repo = _repo(tmp_path)
    rid = sentinel.reserve(repo, "worker-1", "build", "steps", 100)
    sentinel.settle(repo, "worker-1", "build", "steps", 80, rid)
    totals = sentinel.usage_by_unit(repo)
    assert totals["steps"] == 80  # settled amount wins over held


def test_reservation_release_does_not_count(tmp_path):
    repo = _repo(tmp_path)
    r1 = sentinel.reserve(repo, "w", "a", "steps", 100)
    sentinel.settle(repo, "w", "a", "steps", 80, r1)
    r2 = sentinel.reserve(repo, "w", "b", "steps", 50)
    sentinel.release(repo, "w", "b", "steps", r2)
    assert sentinel.usage_by_unit(repo)["steps"] == 80


def test_still_held_counts_pessimistically(tmp_path):
    repo = _repo(tmp_path)
    sentinel.reserve(repo, "w", "a", "steps", 30)
    assert sentinel.usage_by_unit(repo)["steps"] == 30


def test_cap_breach_exits_2_and_enforce_writes_stop(tmp_path):
    repo = _repo(tmp_path)
    _budget(repo, daily_step_limit=100)
    sentinel.reserve(repo, "w", "a", "steps", 150)
    rep = sentinel.usage_check(repo, enforce=False)
    assert rep.breached
    assert rep.stop_written is None
    assert not (repo / "STOP").exists()
    # --enforce writes STOP in the tmp repo only.
    rep2 = sentinel.usage_check(repo, enforce=True)
    assert rep2.breached
    assert (repo / "STOP").exists()


def test_absent_cap_never_breaches(tmp_path):
    repo = _repo(tmp_path)
    _budget(repo)  # no step/wallclock caps present
    sentinel.reserve(repo, "w", "a", "steps", 10_000)
    assert not sentinel.usage_check(repo).breached


def test_wallclock_cap(tmp_path):
    repo = _repo(tmp_path)
    _budget(repo, daily_wallclock_limit_s=60)
    sentinel.reserve(repo, "w", "run", "wall-clock-s", 90)
    rep = sentinel.usage_check(repo)
    assert rep.breached and rep.breaches[0][0] == "wall-clock-s"


def test_reserve_rejects_bad_unit(tmp_path):
    repo = _repo(tmp_path)
    with pytest.raises(ValueError):
        sentinel.reserve(repo, "w", "a", "furlongs", 1)


# --------------------------------------------------------------------------- #
# loop circuit-breaker                                                         #
# --------------------------------------------------------------------------- #
def test_loop_positive_same_tool_args(tmp_path):
    events = [{"ts": i, "agent": "a", "tool": "search",
               "args": {"q": "same"}} for i in range(3)]
    fps = sentinel.detect_loops(events, n=3)
    assert len(fps) == 1 and fps[0].count == 3


def test_loop_negative_different_args_is_progress(tmp_path):
    events = [{"ts": i, "agent": "a", "tool": "search",
               "args": {"q": f"page-{i}"}} for i in range(5)]
    assert sentinel.detect_loops(events, n=3) == []


def test_loop_ignores_volatile_keys(tmp_path):
    events = [
        {"ts": "t1", "agent": "a", "tool": "get",
         "args": {"url": "x", "nonce": "n1", "request_id": "r1"}},
        {"ts": "t2", "agent": "a", "tool": "get",
         "args": {"url": "x", "nonce": "n2", "request_id": "r2"}},
        {"ts": "t3", "agent": "a", "tool": "get",
         "args": {"url": "x", "nonce": "n3", "request_id": "r3"}},
    ]
    fps = sentinel.detect_loops(events, n=3)
    assert len(fps) == 1  # volatile fields differ but the real arg (url) is identical


def test_loop_intervening_action_breaks_run(tmp_path):
    events = [
        {"tool": "t", "args": {"x": 1}}, {"tool": "t", "args": {"x": 1}},
        {"tool": "t", "args": {"x": 2}},  # distinct action resets the run
        {"tool": "t", "args": {"x": 1}}, {"tool": "t", "args": {"x": 1}},
    ]
    assert sentinel.detect_loops(events, n=3) == []


def test_canonical_hash_stable_regardless_of_key_order():
    a = sentinel.canonical_args_hash({"a": 1, "b": 2})
    b = sentinel.canonical_args_hash({"b": 2, "a": 1})
    assert a == b


# --------------------------------------------------------------------------- #
# Wave F delta 3 -- reservations `id` column joins held/settled/released rows  #
# --------------------------------------------------------------------------- #

def test_reservations_id_column_joins_lifecycle_rows(tmp_path):
    repo = _repo(tmp_path)
    rid = sentinel.reserve(repo, "w", "build", "steps", 100, now=NOW)
    sentinel.settle(repo, "w", "build", "steps", 80, rid, now=NOW)
    sentinel.release(repo, "w", "build", "steps", rid, now=NOW)
    shard = repo / "ledgers" / "audit" / f"reservations-w-{DAY}.tsv"
    rows = [ln.split("\t") for ln in shard.read_text(encoding="utf-8").splitlines()
            if ln.strip()]
    header, data = rows[0], rows[1:]
    assert "id" in header                       # the join column exists
    id_col = header.index("id")
    # All three lifecycle rows carry the SAME id -> held/settled/released joinable.
    assert len(data) == 3
    assert {r[id_col] for r in data} == {rid}


def test_reservations_distinct_ids_even_for_same_agent_step(tmp_path):
    repo = _repo(tmp_path)
    r1 = sentinel.reserve(repo, "w", "a", "steps", 10, now=NOW)
    r2 = sentinel.reserve(repo, "w", "a", "steps", 10, now=NOW)
    # Identical agent+step, yet distinct ids -> the two reservations never collide.
    assert r1 != r2


# --------------------------------------------------------------------------- #
# preamble gate                                                                #
# --------------------------------------------------------------------------- #
def test_cli_gate_blocks_when_stop_present(tmp_path):
    repo = _repo(tmp_path)
    (repo / "STOP").write_text("frozen\n", encoding="utf-8")
    problems = sentinel._preamble_blocked(repo, env={})
    assert any("STOP" in p for p in problems)


def test_cli_reconcile_exit_codes(tmp_path, monkeypatch):
    repo = _repo(tmp_path)
    _done(repo, "done.")  # a drift
    monkeypatch.setattr(sentinel, "_preamble_blocked", lambda *a, **k: [])
    assert sentinel.main(["--repo", str(repo), "reconcile"]) == sentinel.EXIT_FINDINGS
    # second run: cursor advanced -> clean -> exit 0
    assert sentinel.main(["--repo", str(repo), "reconcile"]) == sentinel.EXIT_CLEAN


def test_cli_usage_breach_exit_code(tmp_path, monkeypatch):
    repo = _repo(tmp_path)
    _budget(repo, daily_step_limit=10)
    sentinel.reserve(repo, "w", "a", "steps", 99)
    monkeypatch.setattr(sentinel, "_preamble_blocked", lambda *a, **k: [])
    assert sentinel.main(["--repo", str(repo), "usage", "check"]) == sentinel.EXIT_BREACH
