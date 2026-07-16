"""Dispatcher approval-PR pre-staging helper (plan Task 1.4).

When a card is routed to the ``approvals`` boundary, ``stage()`` computes its
canonical I3 ``payload_hash`` (so Daniel never types a 64-char hash), writes the
``approvals/<card-id>.yaml`` record, commits it on branch ``approval/<card-id>``,
and then hands off to an **injected** ``opener`` callable.

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

import yaml

import approvals
import cards


def _now() -> datetime.datetime:
    """Current UTC time — a seam so tests can pin 'now' deterministically."""
    return datetime.datetime.now(datetime.timezone.utc)


def _git_runner(args, cwd=None):
    """Default git runner: real subprocess, used only outside tests."""
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True, errors="replace")


# --- injectable per-tier openers (the `opener` argument to stage) ------------

def open_pr(branch, repo_root, runner, *, pr_opener):
    """Cloud/app opener: push ``branch`` then open a PR via the injected
    ``pr_opener`` (claude.ai GitHub-App integration). NEVER merges, NEVER uses a
    REST token in the VM env. Returns the PR ref produced by ``pr_opener``."""
    runner(["push", "origin", branch], cwd=repo_root)
    return pr_opener(branch)


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

    Writes ``approvals/<card-id>.yaml`` (``approval == payload_hash(card)``,
    ``assurance: signed``, ``expires``), commits it on ``approval/<card-id>``,
    then invokes the injected ``opener(branch, repo_root, runner)``. Returns the
    ref the opener yields (a PR ref for the cloud leg, the branch ref for the
    desktop leg). Never merges; never hard-codes a transport.
    """
    runner = runner or _git_runner
    repo_root = Path(repo_root)
    card = cards.parse(card_path)
    card_id = card.meta["id"]
    branch = f"approval/{card_id}"

    now = now or _now()
    record = {
        "id": card_id,
        "project": card.meta.get("project"),
        "action": card.meta.get("action"),
        "target": card.meta.get("target"),
        "risk-tier": card.meta.get("risk-tier"),
        "state": "approved",
        "assurance": "signed",
        "approval": approvals.payload_hash(card),
        "expires": (now + expires_delta).isoformat(),
    }

    # Isolate the record on its own branch off the current ref.
    runner(["checkout", "-b", branch], cwd=repo_root)

    rec_dir = repo_root / "approvals"
    rec_dir.mkdir(parents=True, exist_ok=True)
    rec_path = rec_dir / f"{card_id}.yaml"
    rec_path.write_text(
        yaml.safe_dump(record, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )

    rel = str(rec_path.relative_to(repo_root)).replace("\\", "/")
    runner(["add", "--", rel], cwd=repo_root)
    runner(["commit", "-m", f"stage approval {card_id}"], cwd=repo_root)

    # Hand off to the injected transport. NEVER a merge.
    return opener(branch, repo_root, runner)
