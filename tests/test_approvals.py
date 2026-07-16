import datetime
import shutil
import subprocess
from pathlib import Path

import pytest

import approvals
import cards

HAS_GPG = shutil.which("gpg") is not None
skip_no_gpg = pytest.mark.skipif(not HAS_GPG, reason="gpg not installed")


# --- shared fixtures/helpers (used by the 1.3 wrapper + 1.2 chain tests) ---
#
# gpg SIGNING/keygen needs a working gpg-agent, which will not start under a
# Windows-style GNUPGHOME on this box (MSYS gpg). Signature VERIFICATION needs
# no agent, so instead of signing at test time we ship a pre-signed fixture repo
# (tests/fixtures/signed-approval/) generated where the agent works, and drive
# every real-signature assertion off it. Fail-closed / author-trust cases use
# UNSIGNED repos built here (no gpg needed) so they run everywhere.

import json

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "signed-approval"


def _load_signed_fixture(tmp_path, human_emails=None, keyring=True):
    """Clone the pre-signed fixture repo into tmp_path, check out its work tree,
    optionally rewrite the humans.yaml allow-list or drop the keyring. Returns
    (repo_path, meta_dict)."""
    meta = json.loads((_FIXTURE / "meta.json").read_text(encoding="utf-8"))
    repo = tmp_path / "signed"
    subprocess.run(["git", "clone", "-q", str(_FIXTURE / "repo.bundle"), str(repo)],
                   check=True, capture_output=True, text=True)
    subprocess.run(["git", "-C", str(repo), "checkout", "-q", "main"],
                   capture_output=True, text=True)
    if human_emails is not None:
        emails = "".join(f'  - "{e}"\n' for e in human_emails)
        (repo / "governance" / "humans.yaml").write_text(
            'humans:\n  - "Daniel Zhang"\nemails:\n' + emails, encoding="utf-8")
    if not keyring:
        (repo / "governance" / "web-flow.gpg").unlink()
    return repo, meta


def _make_unsigned_repo(tmp_path, author_email="daniel@example.com",
                        human_emails=("daniel@example.com",), assurance="signed",
                        with_keyring=True, state="approved",
                        expires_delta=datetime.timedelta(hours=1)):
    """A repo whose HEAD commit is UNSIGNED (needs no gpg) — for fail-closed,
    author-trust, and possession tests. Copies the fixture's real web-flow key
    when ``with_keyring`` so the only defect is the missing signature."""
    repo = tmp_path / "unsigned"
    (repo / "governance").mkdir(parents=True)
    (repo / "queue" / "approvals").mkdir(parents=True)
    if with_keyring:
        shutil.copyfile(_FIXTURE / "web-flow.gpg", repo / "governance" / "web-flow.gpg")
    emails = "".join(f'  - "{e}"\n' for e in human_emails)
    (repo / "governance" / "humans.yaml").write_text(
        'humans:\n  - "Daniel Zhang"\nemails:\n' + emails, encoding="utf-8")
    body = "## Work order\ndo the approved thing\n"
    card = cards.new_card("proj", "deploy", "svc-a", "T3", body=body,
                          state=state, assurance=assurance)
    card.meta["approval"] = approvals.payload_hash(card)
    now = datetime.datetime.now(datetime.timezone.utc)
    card.meta["expires"] = (now + expires_delta).isoformat()
    path = cards.save(card, repo / "queue")
    rel = str(path.relative_to(repo)).replace("\\", "/")

    def g(*args):
        subprocess.run(["git", *args], cwd=repo, check=True,
                       capture_output=True, text=True)

    g("init")
    g("config", "user.name", "Daniel Zhang")
    g("config", "user.email", author_email)
    g("config", "core.autocrlf", "false")
    g("config", "commit.gpgsign", "false")
    g("add", "-A")
    g("commit", "-m", "approve card")
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo,
                         capture_output=True, text=True).stdout.strip()
    return repo, sha, rel, path


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


# --- 1.1: approval_payload / payload_hash canonical serializer ---

def test_payload_binds_action_and_target():
    body = "## Work order\ndo the thing\n"
    c1 = cards.new_card("proj", "deploy", "svc-a", "T3", body=body)
    c2 = cards.new_card("proj", "delete", "svc-a", "T3", body=body)  # diff action
    c3 = cards.new_card("proj", "deploy", "svc-b", "T3", body=body)  # diff target
    assert approvals.payload_hash(c1) != approvals.payload_hash(c2)
    assert approvals.payload_hash(c1) != approvals.payload_hash(c3)
    # The old content_hash(work_order_of(body)) collides across all three,
    # proving the action+target fold-in is what distinguishes them.
    wo = approvals.content_hash(approvals.work_order_of(body))
    assert wo == approvals.content_hash(approvals.work_order_of(c2.body))
    assert wo == approvals.content_hash(approvals.work_order_of(c3.body))


def test_payload_is_order_stable():
    body = "## Work order\nstuff\n"
    c1 = cards.new_card("proj", "act", "tgt", "T3", body=body)
    assert approvals.payload_hash(c1) == approvals.payload_hash(c1)
    # Same three canonical fields but extra frontmatter / different key order
    # must not change the hash (payload is built from the three fields only).
    c2 = cards.new_card("proj", "act", "tgt", "T3", body=body,
                        owner="worker-x", workflow="wf", role="work")
    assert approvals.payload_hash(c1) == approvals.payload_hash(c2)


def test_payload_list_vs_scalar_target_distinct():
    body = "## Work order\nstuff\n"
    scalar = cards.new_card("proj", "act", "a,b", "T3", body=body)
    listed = cards.new_card("proj", "act", ["a", "b"], "T3", body=body)
    # A naive "join list with ," would collide these; JSON-encoding the target
    # keeps the scalar string and the list distinct.
    assert approvals.payload_hash(scalar) != approvals.payload_hash(listed)


# --- 1.2: two entry points — signed-ref gate + possession gate ---
# (approved_by_human() and its _git/_make_repo/_approved_card end-to-end test
#  were removed with the local-author trust model; the laundering assertion is
#  re-expressed by the T10 topology tests and the legit-approval assertion by
#  test_verify_signed_approval_offline_ok below.)

def _pin_now_to_fixture(monkeypatch, meta, minutes=1):
    pinned = (datetime.datetime.fromisoformat(meta["commit_date"])
              + datetime.timedelta(minutes=minutes))
    monkeypatch.setattr(approvals, "_now", lambda: pinned)


@skip_no_gpg
def test_verify_signed_approval_offline_ok(tmp_path, monkeypatch):
    repo, meta = _load_signed_fixture(tmp_path)
    _pin_now_to_fixture(monkeypatch, meta)
    ok, reason = approvals.verify_signed_approval(repo / meta["card_rel"], repo)
    assert ok and reason == "ok"


def test_unsigned_or_agent_pushed_rejected(tmp_path):
    # An ordinary (unsigned) commit introducing the record -> reject. Runs
    # everywhere: with gpg the unsigned commit yields no VALIDSIG; without gpg
    # the wrapper fails closed. Either way, a signature-failure rejection.
    repo, sha, rel, path = _make_unsigned_repo(tmp_path)
    ok, reason = approvals.verify_signed_approval(path, repo)
    assert not ok


def test_keyring_missing_fails_closed(tmp_path):
    # The pinned keyring is absent but everything else about the record is
    # valid -> must still REJECT (never "skip -> pass").
    repo, meta = _load_signed_fixture(tmp_path, keyring=False)
    ok, reason = approvals.verify_signed_approval(repo / meta["card_rel"], repo)
    assert not ok


@skip_no_gpg
def test_valid_signature_wrong_author_rejected(tmp_path, monkeypatch):
    # GOOD web-flow signature, but the merge-commit author-email is NOT in the
    # humans allow-list ("anyone with merge access" case) -> reject.
    repo, meta = _load_signed_fixture(tmp_path, human_emails=["nobody@else.test"])
    _pin_now_to_fixture(monkeypatch, meta)
    ok, reason = approvals.verify_signed_approval(repo / meta["card_rel"], repo)
    assert not ok and "author" in reason.lower()


def test_forged_author_without_signature_rejected(tmp_path):
    # Author string matches an allow-listed human but there is no valid
    # signature -> reject (proves author.login/%an trust is gone).
    repo, sha, rel, path = _make_unsigned_repo(
        tmp_path, author_email="daniel@example.com",
        human_emails=("daniel@example.com",))
    ok, reason = approvals.verify_signed_approval(path, repo)
    assert not ok


def test_assurance_field_roundtrip(tmp_path):
    # A possession-class record is rejected by the signed verifier, and the
    # telegram verifier accepts a valid possession record.
    repo, sha, rel, path = _make_unsigned_repo(tmp_path, assurance="possession")
    ok, reason = approvals.verify_signed_approval(path, repo)
    assert not ok and "signed" in reason.lower()

    ok2, reason2 = approvals.verify_telegram_approval(path, repo)
    assert ok2 and reason2 == "ok"
    assert cards.parse(path).meta.get("assurance") == "possession"


def test_approved_by_human_is_removed():
    # The local-author trust function is gone (its trust model was replaced).
    assert not hasattr(approvals, "approved_by_human")


# --- 1.3: offline gpg verify wrapper + hardened status parser ---

def test_verify_wrapper_no_gpg(tmp_path, monkeypatch):
    monkeypatch.setattr(approvals.shutil, "which", lambda _n: None)
    ok, reason, email = approvals._verify_commit_signature("deadbeef", tmp_path)
    assert ok is False and reason == "gpg unavailable" and email is None


@skip_no_gpg
def test_verify_wrapper_ok(tmp_path):
    repo, meta = _load_signed_fixture(tmp_path)
    ok, signer, email = approvals._verify_commit_signature(meta["sha"], repo)
    assert ok is True
    assert signer and "noreply@github.com" in signer
    assert email == meta["author_email"]


@skip_no_gpg
def test_verify_wrapper_bad_sig(tmp_path):
    repo, meta = _load_signed_fixture(tmp_path)
    # Swap in a DIFFERENT (valid) key as the pinned keyring: import succeeds but
    # the commit's real web-flow signature can't be verified under it -> no
    # VALIDSIG -> fail closed.
    shutil.copyfile(_FIXTURE / "other-key.gpg", repo / "governance" / "web-flow.gpg")
    ok, detail, email = approvals._verify_commit_signature(meta["sha"], repo)
    assert ok is False


def test_revoked_key_rejected_despite_validsig():
    status = (
        "[GNUPG:] NEWSIG\n"
        "[GNUPG:] GOODSIG DEADBEEF GitHub <noreply@github.com>\n"
        "[GNUPG:] VALIDSIG AAAA 2026-01-01 1700000000 0 4 0 1 8 00 AAAA\n"
        "[GNUPG:] REVKEYSIG DEADBEEF GitHub <noreply@github.com>\n"
    )
    ok, detail = approvals._evaluate_status(status)
    assert ok is False and "REVKEYSIG" in detail


def test_expired_key_rejected_despite_validsig():
    for tok in ("EXPKEYSIG", "EXPSIG"):
        status = (
            "[GNUPG:] VALIDSIG AAAA 2026-01-01 1700000000 0 4 0 1 8 00 AAAA\n"
            f"[GNUPG:] {tok} DEADBEEF GitHub <noreply@github.com>\n"
        )
        ok, detail = approvals._evaluate_status(status)
        assert ok is False and tok in detail


def test_status_tokens_anchored_to_gnupg_prefix():
    # (a) bogus GOOD: the substring VALIDSIG appears only in a human-readable
    #     line and inside a UID, never as a real [GNUPG:] status token -> reject.
    bogus_good = (
        'gpg: Good signature from "VALIDSIG faker <x@y>"\n'
        "[GNUPG:] GOODSIG DEAD VALIDSIG-lookalike <x@y>\n"
        "[GNUPG:] NO_PUBKEY DEAD\n"
    )
    ok, _ = approvals._evaluate_status(bogus_good)
    assert ok is False
    # (b) bogus reject: REVKEYSIG appears only inside a UID string; the real
    #     status token stream is a clean VALIDSIG -> good, not falsely rejected.
    bogus_reject = (
        "[GNUPG:] GOODSIG DEAD REVKEYSIG-in-name <x@y>\n"
        "[GNUPG:] VALIDSIG AAAA 2026-01-01 1700000000 0 4 0 1 8 00 AAAA\n"
    )
    ok2, _ = approvals._evaluate_status(bogus_reject)
    assert ok2 is True
