"""Task 1.5 — T10 adversarial / git-topology suite for the signed-approval gate.

These are the security-critical integration tests that need *real* git topology
(merge/laundering shapes, `git show <sha>:<path>` frontmatter binding, unsigned
vs. signed introducing commits). Per the gpg-guard note:

* Real-signature cases are `@pytest.mark.skipif` when the `gpg` binary is absent
  AND are backstopped by the committed pre-signed fixture repo
  (`tests/fixtures/signed-approval/`) — gpg-agent cannot SIGN under a Windows
  GNUPGHOME here, so we reuse that bundle rather than generating signatures.
* Fail-closed / author-trust / frontmatter-binding assertions build UNSIGNED
  repos (or tamper the fixture working tree) at test time and run everywhere.
"""
import datetime
import json
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

import approvals
import cards

HAS_GPG = shutil.which("gpg") is not None
skip_no_gpg = pytest.mark.skipif(not HAS_GPG, reason="gpg not installed")

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "signed-approval"


def _git(repo, *args):
    subprocess.run(["git", *args], cwd=repo, check=True,
                   capture_output=True, text=True)


def _load_signed_fixture(tmp_path, name="signed", human_emails=None, keyring=True):
    """Clone the pre-signed fixture repo, check out its work tree, optionally
    rewrite the humans.yaml allow-list or drop the pinned keyring. Returns
    (repo_path, meta_dict)."""
    meta = json.loads((_FIXTURE / "meta.json").read_text(encoding="utf-8"))
    repo = tmp_path / name
    subprocess.run(["git", "clone", "-q", str(_FIXTURE / "repo.bundle"), str(repo)],
                   check=True, capture_output=True, text=True)
    # HEAD is the protected `approvals` ref (real GitHub PR-merge topology).
    subprocess.run(["git", "-C", str(repo), "checkout", "-q", "approvals"],
                   capture_output=True, text=True)
    if human_emails is not None:
        emails = "".join(f'  - "{e}"\n' for e in human_emails)
        (repo / "governance" / "humans.yaml").write_text(
            'humans:\n  - "Daniel Zhang"\nemails:\n' + emails, encoding="utf-8")
    if not keyring:
        (repo / "governance" / "web-flow.gpg").unlink()
    return repo, meta


def _pin_now_to_fixture(monkeypatch, meta, delta=datetime.timedelta(minutes=1)):
    pinned = datetime.datetime.fromisoformat(meta["commit_date"]) + delta
    monkeypatch.setattr(approvals, "_now", lambda: pinned)


def _make_unsigned_repo(tmp_path, name="unsigned", author_email="daniel@example.com",
                        human_emails=("daniel@example.com",), with_keyring=True,
                        expires_delta=datetime.timedelta(hours=1)):
    """A repo whose HEAD commit that introduces the record is UNSIGNED (needs no
    gpg). Copies the fixture's real web-flow key so the ONLY defect is the
    missing signature."""
    repo = tmp_path / name
    (repo / "governance").mkdir(parents=True)
    (repo / "queue" / "approvals").mkdir(parents=True)
    if with_keyring:
        shutil.copyfile(_FIXTURE / "web-flow.gpg", repo / "governance" / "web-flow.gpg")
    emails = "".join(f'  - "{e}"\n' for e in human_emails)
    (repo / "governance" / "humans.yaml").write_text(
        'humans:\n  - "Daniel Zhang"\nemails:\n' + emails, encoding="utf-8")
    body = "## Work order\ndo the approved thing\n"
    card = cards.new_card("proj", "deploy", "svc-a", "T3", body=body,
                          state="approved", assurance="signed")
    card.meta["approval"] = approvals.payload_hash(card)
    now = datetime.datetime.now(datetime.timezone.utc)
    card.meta["expires"] = (now + expires_delta).isoformat()
    path = cards.save(card, repo / "queue")

    _git(repo, "init")
    _git(repo, "config", "user.name", "Daniel Zhang")
    _git(repo, "config", "user.email", author_email)
    _git(repo, "config", "core.autocrlf", "false")
    _git(repo, "config", "commit.gpgsign", "false")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "approve card")
    return repo, path


def _pin(meta):
    """The fixture's own web-flow fingerprint — the test's pinned trust anchor
    (production pins the real GitHub fingerprint via WEB_FLOW_FINGERPRINTS)."""
    return {meta["fingerprint"]}


# --- T10 merge-topology: bind to the TRUE signing (merge) commit --------------

@skip_no_gpg
def test_merge_topology_binds_to_true_signing_commit(tmp_path, monkeypatch):
    # The fixture mirrors real GitHub PR-merge topology: an UNSIGNED agent commit
    # on approval/<id> introduces the record file; a web-flow-SIGNED, no-ff merge
    # commit brings it onto the protected `approvals` ref. `git log -1 -- <path>`
    # (history simplification) points at the UNSIGNED agent commit — verifying
    # THAT would reject every genuine approval (the F2 blocker). The gate must
    # instead bind to the merge commit along the ref's first-parent history.
    repo, meta = _load_signed_fixture(tmp_path)
    _pin_now_to_fixture(monkeypatch, meta)
    card_path = repo / meta["card_rel"]

    # sanity: the buggy `git log -1` and the correct first-parent lookup disagree,
    # and the correct one is the signed merge commit.
    naive = subprocess.run(["git", "log", "-1", "--format=%H", "--", meta["card_rel"]],
                           cwd=repo, capture_output=True, text=True).stdout.strip()
    assert naive == meta["agent_sha"], "expected git log -1 to pick the unsigned PR commit"
    assert naive != meta["sha"]

    ok, reason = approvals.verify_signed_approval(
        card_path, repo, pinned_fingerprints=_pin(meta))
    assert ok, reason

    # Laundering attempt: a LATER, UNSIGNED commit rewrites the record file on the
    # protected ref. The old signed merge still exists in history, but it is no
    # longer the commit that introduced the current record along first-parent.
    # The `approval` hash is preserved (the tamper appends a NEW '## ' section, so
    # work_order_of is unchanged), so the ONLY thing that changes is the
    # introducing commit's signature status. The gate must bind to the tampering
    # commit and REJECT — never launder the old signature onto the new content.
    card_path.write_text(card_path.read_text(encoding="utf-8")
                         + "\n## Note\nlaundered by a later unsigned commit\n",
                         encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "later unsigned touch")
    # The tamper is on the PROTECTED ref (per this test's premise), so advance
    # refs/remotes/origin/approvals to it — otherwise the gate binds to the stale
    # signed state and would reject on working-tree divergence instead of on the
    # unsigned introducing commit (N1 now prefers the protected remote ref).
    _git(repo, "update-ref", "refs/remotes/origin/approvals", "HEAD")

    # sanity: the hash still matches, proving the rejection is topological, not
    # a content-hash mismatch
    assert approvals.payload_hash(cards.parse(card_path)) == cards.parse(card_path).meta["approval"]

    ok2, reason2 = approvals.verify_signed_approval(
        card_path, repo, pinned_fingerprints=_pin(meta))
    assert not ok2
    assert "signature" in reason2.lower(), reason2


# --- F1 working-tree/committed-blob binding via git show <sha>:<path> ---------

def test_frontmatter_change_after_signing_fails(tmp_path, monkeypatch):
    # The signed blob binds action+target (I3). Changing a frontmatter field in
    # the working tree after signing makes the working tree diverge from the
    # signed object — the gate binds to `git show <sha>:<rel>`, not the mutable
    # working tree, and rejects. (Runs without gpg: the divergence is caught
    # before the signature stage, so this backstops the fixture everywhere.)
    repo, meta = _load_signed_fixture(tmp_path)
    _pin_now_to_fixture(monkeypatch, meta)
    card_path = repo / meta["card_rel"]

    # The committed/signed blob still carries the ORIGINAL action.
    signed_blob = subprocess.run(
        ["git", "show", f"{meta['sha']}:{meta['card_rel']}"],
        cwd=repo, capture_output=True, text=True, check=True).stdout
    assert "action: deploy" in signed_blob

    # Tamper: flip `action` (target of the approval) after signing.
    card = cards.parse(card_path)
    card.meta["action"] = "delete"
    fm = yaml.safe_dump(card.meta, sort_keys=False, allow_unicode=True)
    card_path.write_text(f"---\n{fm}---\n\n{card.body}", encoding="utf-8")

    ok, reason = approvals.verify_signed_approval(
        card_path, repo, pinned_fingerprints=_pin(meta))
    assert not ok and "working tree" in reason.lower(), reason


def test_worktree_tamper_with_matching_hash_rejected(tmp_path, monkeypatch):
    # F1 PoC (the BLOCKER): take a legitimately signed approval, overwrite the
    # WORKING-TREE file with a hostile action/target AND a self-computed matching
    # hash (do NOT commit). The naive hash check passes (the attacker re-hashed),
    # but verification must bind to the committed signed bytes and REJECT — the
    # bytes we authorise must be the bytes we authenticated.
    repo, meta = _load_signed_fixture(tmp_path)
    _pin_now_to_fixture(monkeypatch, meta)
    card_path = repo / meta["card_rel"]

    card = cards.parse(card_path)
    card.meta["action"] = "rm-rf"
    card.meta["target"] = "prod-db"
    card.meta["approval"] = approvals.payload_hash(card)  # attacker self-hashes
    assert approvals.payload_hash(card) == card.meta["approval"]  # internally consistent
    fm = yaml.safe_dump(card.meta, sort_keys=False, allow_unicode=True)
    card_path.write_text(f"---\n{fm}---\n\n{card.body}", encoding="utf-8")

    ok, reason = approvals.verify_signed_approval(
        card_path, repo, pinned_fingerprints=_pin(meta))
    assert not ok, "hostile working-tree overwrite must never verify"
    assert "working tree" in reason.lower() or "signed record" in reason.lower(), reason


# --- valid signature + non-allowlisted author -> reject ----------------------

@skip_no_gpg
def test_valid_signature_wrong_author_rejected(tmp_path, monkeypatch):
    # GOOD web-flow signature, but the merge-commit author-email is NOT in the
    # humans allow-list ("anyone with merge access" case) -> reject.
    repo, meta = _load_signed_fixture(tmp_path, human_emails=["nobody@else.test"])
    _pin_now_to_fixture(monkeypatch, meta)
    ok, reason = approvals.verify_signed_approval(
        repo / meta["card_rel"], repo, pinned_fingerprints=_pin(meta))
    assert not ok and "author" in reason.lower(), reason


# --- unsigned / agent-pushed -> reject (runs everywhere) ---------------------

def test_unsigned_agent_pushed_rejected(tmp_path):
    repo, path = _make_unsigned_repo(tmp_path)
    ok, reason = approvals.verify_signed_approval(path, repo)
    assert not ok


# --- expiry + future-date -> reject (signature must pass first, so gpg) -------

@skip_no_gpg
def test_expiry_rejected(tmp_path, monkeypatch):
    repo, meta = _load_signed_fixture(tmp_path, name="stale")
    # pin now well past MAX_AGE from the signing commit -> stale
    _pin_now_to_fixture(monkeypatch, meta, delta=datetime.timedelta(hours=25))
    ok, reason = approvals.verify_signed_approval(
        repo / meta["card_rel"], repo, pinned_fingerprints=_pin(meta))
    assert not ok and "stale" in reason.lower(), reason


@skip_no_gpg
def test_future_dated_rejected(tmp_path, monkeypatch):
    repo, meta = _load_signed_fixture(tmp_path, name="future")
    # pin now BEFORE the signing commit -> negative age (clock skew / forgery)
    _pin_now_to_fixture(monkeypatch, meta, delta=datetime.timedelta(hours=-2))
    ok, reason = approvals.verify_signed_approval(
        repo / meta["card_rel"], repo, pinned_fingerprints=_pin(meta))
    assert not ok and "future" in reason.lower(), reason


# --- forged author without signature -> reject (runs everywhere) -------------

def test_forged_author_without_signature_rejected(tmp_path):
    # Author string matches an allow-listed human, but there is no valid
    # signature -> reject (proves %an / author.login trust is gone).
    repo, path = _make_unsigned_repo(tmp_path, author_email="daniel@example.com",
                                     human_emails=("daniel@example.com",))
    ok, reason = approvals.verify_signed_approval(path, repo)
    assert not ok


# --- keyring-missing -> fail-closed, NEVER skip->pass (runs everywhere) -------

def test_keyring_missing_fails_closed(tmp_path):
    repo, meta = _load_signed_fixture(tmp_path, keyring=False)
    ok, reason = approvals.verify_signed_approval(repo / meta["card_rel"], repo)
    assert not ok


# --- N1: prefer the protected remote ref over the agent-writable local branch -

def _repo_with_both_approvals_refs(tmp_path):
    """A repo where BOTH refs/heads/approvals (agent-writable in-clone) and
    refs/remotes/origin/approvals (the protected ref only Daniel can merge into)
    exist, pointing at DIFFERENT commits."""
    repo = tmp_path / "both-refs"
    (repo / "governance").mkdir(parents=True)
    (repo / "a.txt").parent.mkdir(parents=True, exist_ok=True)
    _git(repo, "init")
    _git(repo, "config", "user.name", "Daniel Zhang")
    _git(repo, "config", "user.email", "daniel@example.com")
    _git(repo, "config", "core.autocrlf", "false")
    _git(repo, "config", "commit.gpgsign", "false")
    (repo / "a.txt").write_text("remote\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "remote-side commit")
    remote_sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo,
                                capture_output=True, text=True).stdout.strip()
    # The protected ref lives as a remote-tracking ref.
    _git(repo, "update-ref", "refs/remotes/origin/approvals", remote_sha)
    # A DIFFERENT, agent-writable local branch of the same name.
    (repo / "a.txt").write_text("local-agent-writable\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "local-side commit (agent-writable)")
    local_sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo,
                               capture_output=True, text=True).stdout.strip()
    _git(repo, "update-ref", "refs/heads/approvals", local_sha)
    assert remote_sha != local_sha
    return repo


def test_resolve_prefers_protected_remote_ref_over_local(tmp_path):
    # N1: when both exist, the protected refs/remotes/origin/approvals must win
    # the fallback over the agent-writable refs/heads/approvals. Otherwise a
    # misbehaving ops-tier agent could point a local `approvals` branch at an
    # older genuinely-signed approval and control which is treated as current
    # (bounded replay/suppression within MAX_AGE).
    repo = _repo_with_both_approvals_refs(tmp_path)
    assert approvals._resolve_approvals_ref(repo) == "refs/remotes/origin/approvals"


def test_resolve_explicit_arg_wins_over_both(tmp_path):
    # An explicit approvals_ref argument still takes precedence over both refs.
    repo = _repo_with_both_approvals_refs(tmp_path)
    assert approvals._resolve_approvals_ref(repo, "refs/heads/main") == "refs/heads/main"
