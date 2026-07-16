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
    subprocess.run(["git", "-C", str(repo), "checkout", "-q", "main"],
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


# --- T10 merge-topology: bind to the TRUE signing commit (anti-laundering) ---

@skip_no_gpg
def test_merge_topology_binds_to_true_signing_commit(tmp_path, monkeypatch):
    # Baseline: the fixture's record is introduced by a real web-flow-signed
    # commit -> the gate binds to THAT commit and accepts.
    repo, meta = _load_signed_fixture(tmp_path)
    _pin_now_to_fixture(monkeypatch, meta)
    card_path = repo / meta["card_rel"]
    ok, reason = approvals.verify_signed_approval(card_path, repo)
    assert ok, reason

    # Laundering attempt: a LATER, UNSIGNED commit rewrites the record file. The
    # old signed commit still exists in history, but it is no longer the commit
    # that introduced the current record. The `approval` hash is preserved (the
    # tamper appends a NEW '## ' section, so work_order_of is unchanged), so the
    # ONLY thing that changes is the introducing commit's signature status.
    # The gate must bind to the tampering commit and REJECT — never launder the
    # old signature onto the new content.
    card_path.write_text(card_path.read_text(encoding="utf-8")
                         + "\n## Note\nlaundered by a later unsigned commit\n",
                         encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "later unsigned touch")

    # sanity: the hash still matches, proving the rejection is topological, not
    # a content-hash mismatch
    assert approvals.payload_hash(cards.parse(card_path)) == cards.parse(card_path).meta["approval"]

    ok2, reason2 = approvals.verify_signed_approval(card_path, repo)
    assert not ok2
    assert "signature" in reason2.lower(), reason2


# --- T10 frontmatter binding via git show <sha>:<path> -----------------------

def test_frontmatter_change_after_signing_fails(tmp_path, monkeypatch):
    # The signed blob binds action+target (I3). Changing a frontmatter field in
    # the working tree after signing breaks the recomputed payload_hash.
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

    ok, reason = approvals.verify_signed_approval(card_path, repo)
    assert not ok and "hash" in reason.lower(), reason


# --- valid signature + non-allowlisted author -> reject ----------------------

@skip_no_gpg
def test_valid_signature_wrong_author_rejected(tmp_path, monkeypatch):
    # GOOD web-flow signature, but the merge-commit author-email is NOT in the
    # humans allow-list ("anyone with merge access" case) -> reject.
    repo, meta = _load_signed_fixture(tmp_path, human_emails=["nobody@else.test"])
    _pin_now_to_fixture(monkeypatch, meta)
    ok, reason = approvals.verify_signed_approval(repo / meta["card_rel"], repo)
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
    ok, reason = approvals.verify_signed_approval(repo / meta["card_rel"], repo)
    assert not ok and "stale" in reason.lower(), reason


@skip_no_gpg
def test_future_dated_rejected(tmp_path, monkeypatch):
    repo, meta = _load_signed_fixture(tmp_path, name="future")
    # pin now BEFORE the signing commit -> negative age (clock skew / forgery)
    _pin_now_to_fixture(monkeypatch, meta, delta=datetime.timedelta(hours=-2))
    ok, reason = approvals.verify_signed_approval(repo / meta["card_rel"], repo)
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
