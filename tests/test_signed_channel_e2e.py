"""Signed-approval channel end-to-end interoperability (the missing integration test).

This is the test whose absence let the PRODUCER/CONSUMER format defect ship:

* PRODUCER — ``stage_approval.stage()`` (plan task 1.4) writes the approval record.
* CONSUMER — ``approvals.verify_signed_approval`` (plan task 1.2) verifies it.

They MUST agree on record FORMAT (a full card, parseable by ``cards.parse``), PATH
(``queue/approvals/<id>.md`` — where ``cards.STATE_DIR['approved']`` lands it and
where ``routines/nightly.md`` step 4b / the verify fixture read it), ASSURANCE
(``signed``), and the ``payload_hash`` binding over action+target+work-order.

Per the repo's gpg-guard convention (gpg-agent cannot SIGN under a Windows
GNUPGHOME here; real-signature cases ride the committed pre-signed fixture), we
mock ONLY the offline web-flow signature leg (``approvals._verify_commit_signature``).
Every format / path / hash / worktree-binding assertion runs everywhere — those
are exactly the checks the shipped defect broke.
"""
import datetime
import functools
import subprocess
from pathlib import Path

import yaml

import approvals
import cards
import stage_approval

# A GOOD-signature stand-in for the offline web-flow verify leg. Returns
# (good, signer, author_email); the email is allow-listed in the scratch repo's
# humans.yaml so only the gpg leg is bypassed, nothing else in the trust chain.
_ALLOWED_EMAIL = "daniel@example.com"


def _mock_good_signature(*_a, **_k):
    return True, "web-flow (mocked)", _ALLOWED_EMAIL


def _git(repo, *args):
    subprocess.run(["git", *args], cwd=repo, check=True,
                   capture_output=True, text=True)


def _init_repo(tmp_path):
    """A real git repo carrying the pinned governance the verifier needs
    (humans.yaml emails allow-list), seeded with one commit."""
    repo = tmp_path / "repo"
    (repo / "governance").mkdir(parents=True)
    (repo / "governance" / "humans.yaml").write_text(
        'humans:\n  - "Daniel Zhang"\nemails:\n  - "%s"\n' % _ALLOWED_EMAIL,
        encoding="utf-8")
    _git(repo, "init")
    _git(repo, "config", "user.name", "Daniel Zhang")
    _git(repo, "config", "user.email", _ALLOWED_EMAIL)
    _git(repo, "config", "core.autocrlf", "false")
    _git(repo, "config", "commit.gpgsign", "false")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "seed governance")
    return repo


def _real_runner(repo):
    """A hermetic git runner (real subprocess, no network) for ``stage``."""
    def run(args, cwd=None):
        subprocess.run(["git", *args], cwd=cwd or repo, check=True,
                       capture_output=True, text=True)
    return run


def _make_source_card(repo, action="deploy", target="svc-a",
                      body="## Work order\ndo the approved thing\n"):
    card = cards.new_card("proj", action, target, "T3", body=body)
    path = cards.save(card, repo / "queue")
    _git(repo, "add", "-A")          # clean tree before stage's checkout -b
    _git(repo, "commit", "-m", "queue source card")
    return card, path


def _stage(repo, path):
    """Stage onto ``repo`` with a hermetic runner and a no-transport opener
    (the per-tier opener seam is exercised in test_stage_approval; here we only
    care that the committed record interoperates with the verifier)."""
    runner = _real_runner(repo)
    return stage_approval.stage(path, repo, opener=lambda b, r, run: b, runner=runner)


# --- the interop proof: stage -> verify agree on format/path/assurance/hash ---

def test_staged_record_verifies_end_to_end(tmp_path, monkeypatch):
    repo = _init_repo(tmp_path)
    card, path = _make_source_card(repo)

    ref = _stage(repo, path)
    assert ref == f"approval/{card.meta['id']}"

    # PATH: exactly where the verifier + routine read it.
    record_path = repo / "queue" / "approvals" / f"{card.meta['id']}.md"
    assert record_path.exists()

    # FORMAT: the record is a full, parseable card — not a flat YAML dict.
    staged = cards.parse(record_path)
    assert staged.meta["state"] == "approved"
    assert staged.meta["assurance"] == "signed"
    assert "## Work order" in staged.body
    # HASH: producer's approval == consumer's recompute over the SAME card.
    assert staged.meta["approval"] == approvals.payload_hash(staged)
    assert staged.meta["approval"] == approvals.payload_hash(card)

    # The consumer's committed-bytes parse also succeeds (the exact check the
    # shipped defect failed: "approval record is not a committed card").
    rel = approvals._rel_in_repo(record_path, repo)
    assert rel == f"queue/approvals/{card.meta['id']}.md"
    sha = approvals._introducing_commit(rel, repo, "HEAD")
    assert sha and approvals._committed_card(sha, rel, repo) is not None

    # Full verify passes with ONLY the offline gpg leg mocked.
    monkeypatch.setattr(approvals, "_verify_commit_signature", _mock_good_signature)
    res = approvals.verify_signed_approval(record_path, repo)
    assert res.ok, res.reason
    assert res.card is not None and res.card.meta["action"] == "deploy"
    assert res.payload == approvals.approval_payload(card)


def test_staged_record_binds_action_and_target(tmp_path, monkeypatch):
    # The verified payload is over action+target+work-order (I3), so a record
    # staged for a DIFFERENT action carries a different, still-self-consistent hash.
    repo = _init_repo(tmp_path)
    card, path = _make_source_card(repo, action="delete", target="prod-db")
    _stage(repo, path)
    record_path = repo / "queue" / "approvals" / f"{card.meta['id']}.md"

    monkeypatch.setattr(approvals, "_verify_commit_signature", _mock_good_signature)
    res = approvals.verify_signed_approval(record_path, repo)
    assert res.ok, res.reason
    assert res.card.meta["action"] == "delete"
    assert res.card.meta["target"] == "prod-db"


# --- negatives: the hash binding + TOCTOU worktree binding catch tampering ----

def test_committed_work_order_tamper_recomputes_and_rejects(tmp_path, monkeypatch):
    # Tamper the COMMITTED work order but keep the stale ``approval`` hash, and
    # commit so the working tree matches the object (isolates the hash-binding
    # check from the F1 worktree check). The consumer recomputes payload_hash over
    # the new work order, finds it != the stored approval, and REJECTS.
    repo = _init_repo(tmp_path)
    card, path = _make_source_card(repo)
    _stage(repo, path)
    record_path = repo / "queue" / "approvals" / f"{card.meta['id']}.md"

    staged = cards.parse(record_path)
    original_hash = staged.meta["approval"]
    tampered_body = "## Work order\nsomething the human never approved\n"
    fm = yaml.safe_dump(staged.meta, sort_keys=False, allow_unicode=True)
    record_path.write_text(f"---\n{fm}---\n\n{tampered_body}", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "tamper the work order, keep stale hash")

    monkeypatch.setattr(approvals, "_verify_commit_signature", _mock_good_signature)
    res = approvals.verify_signed_approval(record_path, repo)
    assert not res.ok
    assert "hash" in res.reason.lower() and "work order" in res.reason.lower(), res.reason
    # the recompute genuinely diverged (rejection is a real hash change)
    assert approvals.payload_hash(cards.parse(record_path)) != original_hash


def test_uncommitted_worktree_tamper_rejected(tmp_path, monkeypatch):
    # F1 TOCTOU: edit the WORKING-TREE record after staging without committing.
    # The committed (signed) bytes still hash-match, but the executor would read a
    # divergent working tree, so verification binds to the object and REJECTS.
    repo = _init_repo(tmp_path)
    card, path = _make_source_card(repo)
    _stage(repo, path)
    record_path = repo / "queue" / "approvals" / f"{card.meta['id']}.md"

    record_path.write_text(
        record_path.read_text(encoding="utf-8") + "\n## Note\nsneaky post-sign edit\n",
        encoding="utf-8")

    monkeypatch.setattr(approvals, "_verify_commit_signature", _mock_good_signature)
    res = approvals.verify_signed_approval(record_path, repo)
    assert not res.ok and "working tree" in res.reason.lower(), res.reason
