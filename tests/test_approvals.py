import datetime
import approvals


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
