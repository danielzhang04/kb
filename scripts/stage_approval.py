"""Dispatcher approval-PR pre-staging helper (plan Task 1.4).

When a card is routed to the ``approvals`` boundary, ``stage()`` computes its
canonical I3 ``payload_hash`` (so Daniel never types a 64-char hash), writes the
``queue/approvals/<card-id>.md`` record, commits it on branch
``approval/<card-id>``, and then hands off to an **injected** ``opener`` callable.

The record is the **full card itself**, re-stamped for the signed channel — NOT
a flat YAML dict. This is the load-bearing interop contract with the consumer,
``approvals.verify_signed_approval``: it parses the committed record with
``cards.parse`` (requires frontmatter + body) and recomputes ``payload_hash``
over action + target + the ``## Work order`` prose, comparing to the record's
``approval`` frontmatter field. A flat dict (the earlier bug) can never parse as a
card nor carry a work order, so nothing it produced could ever verify. The record
path is ``queue/approvals/<id>.md`` because ``cards.STATE_DIR['approved']`` maps
there and that is exactly where the verifier + ``routines/nightly.md`` step 4b
read the ``approved`` record.

Two hard invariants (ordering-law 4):

* The helper **NEVER merges** — the merge is Daniel's web-flow-signed action on
  the protected ``approvals`` ref, and that merge is the gate itself.
* The helper **NEVER hard-codes a transport**. The PR-open leg is injected:

  - ``open_pr``  — the **cloud/app** path: push the branch and open the PR
    through the claude.ai GitHub-App integration (an injected ``pr_opener``);
    the credential lives in the claude.ai platform, never in the VM env.
  - ``push_branch_and_notify`` — the **desktop** path: push the branch over the
    SSH deploy key and DELEGATE the PR-open by notifying a human / the cloud leg.
    The desktop env holds only a deploy key and must never run ``gh``/REST.

All git flows through an injectable ``runner`` so unit tests stay hermetic —
no network, no real tokens, no real repository state.
"""
from __future__ import annotations

import datetime
import subprocess
from pathlib import Path

import approvals
import cards
import merge_gate


def _now() -> datetime.datetime:
    """Current UTC time — a seam so tests can pin 'now' deterministically."""
    return datetime.datetime.now(datetime.timezone.utc)


def _git_runner(args, cwd=None):
    """Default git runner: real subprocess, used only outside tests."""
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True, errors="replace")


# --- injectable per-tier openers (the `opener` argument to stage) ------------

def _default_gate_filer(repo_root):
    """Bind ``merge_gate.file`` to this repo's ``queue/``. Resolved at call time
    (via the ``merge_gate`` module attribute) so a monkeypatch of
    ``merge_gate.file`` is honoured."""
    def _file(*, target, repo, branch, pr_url, unblocks):
        return merge_gate.file(Path(repo_root) / "queue", target=target, repo=repo,
                               branch=branch, pr_url=pr_url, unblocks=unblocks)
    return _file


def open_pr(branch, repo_root, runner, *, pr_opener, gate_filer=None):
    """Cloud/app opener: push ``branch`` then open a PR via the injected
    ``pr_opener`` (claude.ai GitHub-App integration). NEVER merges, NEVER uses a
    REST token in the VM env. Returns the PR ref produced by ``pr_opener``.

    After the PR is opened, files a merge-gate card for the PR ref via T1's
    ``merge_gate.file`` (injectable ``gate_filer`` keeps tests hermetic) so the
    handoff surfaces in the dashboard Inbox. Gate filing is best-effort: a
    failure NEVER undoes an opened PR — the PR exists and the gate can be filed
    by hand.
    """
    runner(["push", "origin", branch], cwd=repo_root)
    ref = pr_opener(branch)
    filer = gate_filer or _default_gate_filer(repo_root)
    try:
        filer(target=ref, repo=Path(repo_root).name, branch=branch, pr_url=ref,
              unblocks=f"merge of {branch} into ops")
    except Exception:
        # Surfacing is best-effort — never fail an opened PR on a gate write.
        pass
    return ref


def push_branch_and_notify(branch, repo_root, runner, *, notifier):
    """Desktop opener: push ``branch`` over the SSH deploy key and DELEGATE the
    PR-open by calling ``notifier(branch)``. NEVER opens a PR, NEVER runs
    ``gh``/REST (the deploy key cannot, and a token would break ordering-law 4).
    Returns the branch ref for the notify formatter."""
    runner(["push", "origin", branch], cwd=repo_root)
    notifier(branch)
    return branch


# --- the staging helper ------------------------------------------------------

def stage(card_path, repo_root, opener, runner=None, now=None,
          expires_delta=approvals.MAX_AGE):
    """Stage a signed-channel approval PR for ``card_path``.

    Writes ``queue/approvals/<card-id>.md`` as the **full card**, re-stamped with
    ``state: approved``, ``assurance: signed``, ``approval == payload_hash(card)``
    and ``expires``, while preserving the original body (including the exact
    ``## Work order`` section). Commits it on ``approval/<card-id>``, then invokes
    the injected ``opener(branch, repo_root, runner)``. Returns the ref the opener
    yields (a PR ref for the cloud leg, the branch ref for the desktop leg). Never
    merges; never hard-codes a transport.

    The record MUST be a card the consumer can parse and re-hash: ``approval`` is
    computed by the same ``approvals.payload_hash`` the verifier recomputes over
    action + target + work-order, so a genuine web-flow-signed merge of this record
    passes ``approvals.verify_signed_approval`` byte-for-byte.
    """
    runner = runner or _git_runner
    repo_root = Path(repo_root)
    card = cards.parse(card_path)
    card_id = card.meta["id"]
    branch = f"approval/{card_id}"

    now = now or _now()
    # Re-stamp the card in place for the signed channel. payload_hash reads only
    # action/target/work-order, so setting state/assurance first does not perturb
    # it; the original body (incl. '## Work order') is carried through untouched.
    card.meta["state"] = "approved"
    card.meta["assurance"] = "signed"
    card.meta["approval"] = approvals.payload_hash(card)
    card.meta["expires"] = (now + expires_delta).isoformat()

    # Isolate the record on its own branch off the current ref.
    runner(["checkout", "-b", branch], cwd=repo_root)

    # cards.save routes an ``approved`` card to queue/approvals/<id>.md — the
    # single location the verifier and routines/nightly.md step 4b both read.
    rec_path = cards.save(card, repo_root / "queue")

    rel = str(rec_path.relative_to(repo_root)).replace("\\", "/")
    runner(["add", "--", rel], cwd=repo_root)
    runner(["commit", "-m", f"stage approval {card_id}"], cwd=repo_root)

    # Hand off to the injected transport. NEVER a merge.
    return opener(branch, repo_root, runner)
