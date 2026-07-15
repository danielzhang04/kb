import datetime
import subprocess

import pytest

import approvals
import cards


def test_content_hash_stable():
    assert approvals.content_hash("abc") == approvals.content_hash("abc")
    assert approvals.content_hash("abc") != approvals.content_hash("abd")


def test_verdict_requires_approved_state():
    ok, reason = approvals.verdict(
        state="approvals", author="Daniel Zhang", humans=["Daniel Zhang"],
        approval_field="x", work_order_hash="x",
        commit_age=datetime.timedelta(hours=1))
    assert not ok and "state" in reason


def test_verdict_rejects_agent_author():
    ok, reason = approvals.verdict(
        state="approved", author="claude-worker", humans=["Daniel Zhang"],
        approval_field="x", work_order_hash="x",
        commit_age=datetime.timedelta(hours=1))
    assert not ok and "human" in reason


def test_verdict_rejects_hash_mismatch_and_stale():
    ok, reason = approvals.verdict(
        state="approved", author="Daniel Zhang", humans=["Daniel Zhang"],
        approval_field="aaa", work_order_hash="bbb",
        commit_age=datetime.timedelta(hours=1))
    assert not ok and "hash" in reason
    ok, reason = approvals.verdict(
        state="approved", author="Daniel Zhang", humans=["Daniel Zhang"],
        approval_field="x", work_order_hash="x",
        commit_age=datetime.timedelta(hours=30))
    assert not ok and "stale" in reason


def test_verdict_accepts_valid():
    ok, reason = approvals.verdict(
        state="approved", author="Daniel Zhang", humans=["Daniel Zhang"],
        approval_field="x", work_order_hash="x",
        commit_age=datetime.timedelta(hours=1))
    assert ok


# --- work_order_of: fence-aware, first-occurrence, column-0 headings only ---

def test_work_order_ignores_fenced_and_indented_headings():
    body = (
        "## Work order\n"
        "real text\n"
        "## Evidence\n"
        "> quoted\n"
        "```\n"
        "## Work order\n"
        "fake\n"
        "```\n"
        "    ## Work order\n"
        "also not a heading"
    )
    result = approvals.work_order_of(body)
    assert result == "real text"
    assert "fake" not in result
    assert "also not a heading" not in result


def test_work_order_first_occurrence_only():
    body = (
        "## Work order\n"
        "first section\n"
        "## Other\n"
        "middle\n"
        "## Work order\n"
        "second section"
    )
    assert approvals.work_order_of(body) == "first section"


def test_work_order_missing_raises():
    with pytest.raises(ValueError):
        approvals.work_order_of("## Summary\nno work order heading here")


# --- verdict: defense-in-depth on future-dated author date ---

def test_verdict_rejects_future_dated():
    ok, reason = approvals.verdict(
        state="approved", author="Daniel Zhang", humans=["Daniel Zhang"],
        approval_field="x", work_order_hash="x",
        commit_age=datetime.timedelta(hours=-2))
    assert not ok and "future" in reason


# --- approved_by_human: end-to-end + laundering resistance ---

def _git(repo, *args, name="Test Human", email="human@example.com"):
    subprocess.run(
        ["git", "-c", f"user.name={name}", "-c", f"user.email={email}",
         "-c", "commit.gpgsign=false", *args],
        cwd=repo, check=True, capture_output=True, text=True)


def _make_repo(tmp_path):
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True, text=True)
    (tmp_path / "governance").mkdir()
    (tmp_path / "governance" / "humans.yaml").write_text(
        'humans:\n  - "Test Human"\n', encoding="utf-8")


def _approved_card(tmp_path, target, wo_text):
    body = f"## Work order\n{wo_text}\n"
    wo_hash = approvals.content_hash(approvals.work_order_of(body))
    card = cards.new_card("proj", "act", target, "T3", body=body,
                          state="approved", approval=wo_hash)
    return cards.save(card, tmp_path / "queue")


def test_approved_by_human_end_to_end(tmp_path):
    _make_repo(tmp_path)

    # Legit case: human commits an approved card whose hash it introduced.
    path = _approved_card(tmp_path, "tgt", "do the thing")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-m", "human approves")
    ok, reason = approvals.approved_by_human(path, tmp_path)
    assert ok and reason == "ok"

    # Laundering case: agent introduces the approval hash, then a human makes
    # an unrelated later edit to the same file. Binding to the -S setting
    # commit must still see the agent as the author -> reject.
    path2 = _approved_card(tmp_path, "tgt2", "laundered thing")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-m", "agent sets approval",
         name="agent-x", email="a@a")
    with open(path2, "a", encoding="utf-8") as fh:
        fh.write("\n")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-m", "human unrelated edit")
    ok2, reason2 = approvals.approved_by_human(path2, tmp_path)
    assert not ok2
