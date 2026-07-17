"""Task 3.2 — weekly grades <-> Inspector-activity cross-check (fail closed).

The reconcile integrity check attributes every grade row's introducing git
commit (approvals-style pickaxe) and cross-checks it against
Inspector-identity activity rows only. Any grade authored by a non-Inspector
identity, or lacking matching Inspector activity evidence, quarantines and
FREEZES the promotion loop (writes ``ledgers/grades/FROZEN`` + a wake-me card).
A FROZEN sentinel cleared without an authenticated clear-record is re-asserted.

These tests build throwaway git repos (``-c commit.gpgsign=false``, per-commit
author identities) so the git-attribution path is exercised for real without
needing gpg. Desktop-tier only.
"""
import datetime
import os
import subprocess

import pytest

import reconcile

INSPECTOR = "inspector@agents.local"
WORKER = "worker@agents.local"
HUMAN = "daniel@example.com"


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True,
                   capture_output=True, text=True)


def _commit(repo, author_email, msg):
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "x", "GIT_AUTHOR_EMAIL": author_email,
        "GIT_COMMITTER_NAME": "x", "GIT_COMMITTER_EMAIL": author_email,
    }
    subprocess.run(["git", "-C", str(repo), "commit", "-q", "-m", msg],
                   check=True, capture_output=True, text=True, env=env)


def _init_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "core.autocrlf", "false")
    _git(repo, "config", "commit.gpgsign", "false")
    (repo / "governance").mkdir()
    (repo / "governance" / "humans.yaml").write_text(
        'humans:\n  - "Daniel Zhang"\nemails:\n  - "daniel@example.com"\n',
        encoding="utf-8")
    (repo / "queue").mkdir()
    _git(repo, "add", "-A")
    _commit(repo, HUMAN, "init")
    return repo


def _grade_row(card_id, *, inspector_id="inspector", worker="w1", project="proj",
               task_type="deploy", tier="T1", score=95, passed=True,
               rubric_version="v1", ts=None):
    return {
        "worker": worker, "project": project, "task_type": task_type,
        "tier": tier, "card_id": card_id, "score": str(score),
        "pass": str(passed), "rubric_version": rubric_version,
        "inspector_id": inspector_id, "ts": ts or _now_iso(),
    }


def _activity_row(card_id, *, inspector_id="inspector", worker="w1",
                  project="proj", task_type="deploy", tier="T1", ts=None):
    return {
        "ts": ts or _now_iso(), "inspector_id": inspector_id, "card_id": card_id,
        "worker": worker, "project": project, "task_type": task_type,
        "tier": tier, "kind": "grade",
    }


def _write(repo, author_email, msg, *, grades=(), activity=()):
    import ledger
    for row in grades:
        ledger.append(repo, "grades", row["inspector_id"], row)
    for row in activity:
        ledger.append(repo, "activity", row["inspector_id"], row)
    _git(repo, "add", "-A")
    _commit(repo, author_email, msg)


def test_clean_pairs_no_freeze(tmp_path):
    repo = _init_repo(tmp_path)
    _write(repo, INSPECTOR, "clean grades",
           grades=[_grade_row("A"), _grade_row("B")],
           activity=[_activity_row("A"), _activity_row("B")])

    res = reconcile.reconcile(repo, tier="desktop")

    assert not res.frozen
    assert not (repo / "ledgers" / "grades" / "FROZEN").exists()
    assert res.wake_card is None
    assert res.quarantined == []


def test_fabricated_grade_no_activity_freezes(tmp_path):
    repo = _init_repo(tmp_path)
    # A grade row with NO paired Inspector activity row = fabricated.
    _write(repo, INSPECTOR, "grade only", grades=[_grade_row("A")])

    res = reconcile.reconcile(repo, tier="desktop")

    assert res.frozen
    assert (repo / "ledgers" / "grades" / "FROZEN").exists()
    assert res.wake_card is not None and res.wake_card.exists()
    assert any("no matching Inspector activity" in q["_reason"]
               for q in res.quarantined)


def test_wrong_grader_identity_freezes(tmp_path):
    repo = _init_repo(tmp_path)
    # Inspector legitimately records the activity evidence for card A ...
    _write(repo, INSPECTOR, "inspector activity", activity=[_activity_row("A")])
    # ... but the GRADE row for A is committed under a WORKER identity
    # (self-grading). Evidence exists, yet the grader identity is wrong -> freeze.
    _write(repo, WORKER, "grade by worker", grades=[_grade_row("A")])

    res = reconcile.reconcile(repo, tier="desktop")

    assert res.frozen
    assert (repo / "ledgers" / "grades" / "FROZEN").exists()
    assert res.wake_card is not None and res.wake_card.exists()
    assert any("not authored by the Inspector" in q["_reason"]
               for q in res.quarantined)


def test_ignores_non_inspector_activity_rows(tmp_path):
    repo = _init_repo(tmp_path)
    # A legit-looking grade authored by the Inspector ...
    _write(repo, INSPECTOR, "inspector grade", grades=[_grade_row("A")])
    # ... whose ONLY activity "evidence" was committed by a WORKER (a spoofed
    # inspector_id in the row content does not help). Non-Inspector activity must
    # be ignored, so card A ends up with no valid evidence -> freeze.
    _write(repo, WORKER, "worker-forged activity", activity=[_activity_row("A")])

    res = reconcile.reconcile(repo, tier="desktop")

    assert res.frozen
    assert res.wake_card is not None and res.wake_card.exists()
    assert any("no matching Inspector activity" in q["_reason"]
               for q in res.quarantined)


def test_reasserts_frozen_if_sentinel_cleared_without_record(tmp_path):
    repo = _init_repo(tmp_path)
    grades = repo / "ledgers" / "grades"
    grades.mkdir(parents=True)
    (grades / "FROZEN").write_text("frozen: earlier integrity failure\n",
                                   encoding="utf-8")
    _git(repo, "add", "-A")
    _commit(repo, INSPECTOR, "freeze")

    # Someone clears the sentinel with NO authenticated clear-record: just a
    # working-tree deletion, no FROZEN.cleared committed by a human.
    (grades / "FROZEN").unlink()

    res = reconcile.reconcile(repo, tier="desktop")

    assert res.frozen
    assert (grades / "FROZEN").exists()  # re-asserted
    assert res.wake_card is not None and res.wake_card.exists()
    assert "clear" in res.reason.lower()


def test_authenticated_clear_is_not_reasserted(tmp_path):
    repo = _init_repo(tmp_path)
    grades = repo / "ledgers" / "grades"
    grades.mkdir(parents=True)
    (grades / "FROZEN").write_text("frozen\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _commit(repo, INSPECTOR, "freeze")

    # A human clears it properly: delete the sentinel AND commit an authenticated
    # clear-record (git-authored by an allow-listed human).
    (grades / "FROZEN").unlink()
    (grades / "FROZEN.cleared").write_text(
        "cleared after review\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _commit(repo, HUMAN, "human clears freeze")

    res = reconcile.reconcile(repo, tier="desktop")

    assert not res.frozen
    assert not (grades / "FROZEN").exists()
    assert res.wake_card is None


def test_refuses_non_desktop_tier(tmp_path):
    repo = _init_repo(tmp_path)
    with pytest.raises(ValueError):
        reconcile.reconcile(repo, tier="cloud")
