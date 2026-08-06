"""merge_gate.py — one authority for registering/closing a merge-gate card.

Every path that hands a branch/PR to a human for merging files a card that the
dashboard Inbox already surfaces (predicate #4: ``action: approve:merge:<target>``,
``owner: human-operator``). This module is that single producer so the runner
(``scripts/agent_runner.py``), the dispatcher (``stage_approval.open_pr``), terminals,
and skills all register/close gates through ONE dedup-safe implementation.

Dedup invariant (branch_hygiene N1 lesson): a gate is "live" per its PARSED
``state`` field, NEVER per the directory its file sits in — the approvals/ dir
hosts both live and resolved states, so directory membership is not the truth.

This module only writes/moves cards via ``cards.save`` / ``cards.transition``;
it never touches git. The CALLER commits the resulting queue write to ops through
whatever transaction discipline it already uses.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cards

# A gate card is LIVE until it is resolved (done), rejected, or halted. Dedup and
# close operate on live gates only.
LIVE_STATES = tuple(s for s in cards.STATES if s not in {"done", "rejected", "halted"})

# The only live states from which close() can legally walk a gate to `done` via
# the (working -> done) path cards.transition enforces: `inbox` (inbox -> working
# -> done) and `working` (working -> done). A live gate parked in any OTHER state
# (e.g. blocked / approvals / stop-requested) has no legal walk to done, so close()
# refuses with a clear message instead of surfacing cards.py's raw "illegal
# transition" ValidationError that never names the card.
_CLOSEABLE_STATES = frozenset({"inbox", "working"})


def _action_for(target: str) -> str:
    """The exact action string the dashboard ``isHumanGate`` / brief gate test
    match on. Must stay byte-identical to those predicates."""
    return f"approve:merge:{target}"


def _work_order(repo, branch, pr_url, unblocks) -> str:
    return "\n".join([
        "## Work order",
        "",
        f"- repo: {repo}",
        f"- branch: {branch}",
        f"- pr_url: {pr_url if pr_url else '(none — branch-only gate)'}",
        f"- unblocks: {unblocks}",
        "",
        "A human merges the PR/branch above into `ops`, then this gate is closed "
        "(`merge_gate.py close`, or the dashboard daemon reconciler for PR-number "
        "targets).",
        "",
    ])


def _append_section(body: str, section: str, block: str) -> str:
    """Append ``block`` under ``## <section>``, creating the section if absent —
    mirrors cardRespond's section-append semantics."""
    header = f"## {section}"
    text = body.rstrip("\n")
    if header in text:
        return f"{text}\n\n{block}\n"
    return f"{text}\n\n{header}\n\n{block}\n"


def find_live(queue_root, target):
    """Return the live merge-gate Card for ``target``, else ``None``.

    Globs ``queue/**/*.md``, parses each card (unparseable files skipped), and
    matches ``action == approve:merge:<target>`` AND ``state in LIVE_STATES``.
    Keys on parsed state, never directory (branch_hygiene N1).
    """
    queue_root = Path(queue_root)
    if not queue_root.exists():
        return None
    action = _action_for(target)
    for path in sorted(queue_root.glob("**/*.md")):
        try:
            card = cards.parse(path)
        except Exception:
            continue  # not a card / malformed frontmatter — ignore
        if card.meta.get("action") == action and card.meta.get("state") in LIVE_STATES:
            return card
    return None


def file(queue_root, *, target, repo, branch, pr_url=None, unblocks,
         risk_tier="T2", owner="human-operator", now=None):
    """Register a merge-gate card for ``target`` (a PR number or a branch name).

    Returns the EXISTING live gate if one is already open (writes no new file),
    else mints + saves a new card. Dedup is on action+target over parsed state.

    ``now`` is accepted for signature symmetry with the dashboard-side seams and
    is currently unused (the card id already carries an epoch prefix via
    ``cards.new_id``); kept so callers can pass an injected clock without change.
    """
    del now  # reserved; see docstring
    queue_root = Path(queue_root)
    existing = find_live(queue_root, target)
    if existing is not None:
        return existing
    card = cards.new_card(
        project="kb",
        action=_action_for(target),
        target=target,
        risk_tier=risk_tier,
        body=_work_order(repo, branch, pr_url, unblocks),
        owner=owner,
    )
    cards.save(card, queue_root)
    return card


def close(queue_root, *, target, result):
    """Find the live gate for ``target``, append a ``## Result`` note, and walk it
    to ``done``. Returns the Card, or ``None`` if there is no live gate.

    The gate is owned by ``human-operator``, so the working transition is legal
    (the dispatchers-assign rule is about *starting work an unowned card*; owner
    is already set here).
    """
    queue_root = Path(queue_root)
    card = find_live(queue_root, target)
    if card is None:
        return None
    state = card.meta["state"]
    if state not in _CLOSEABLE_STATES:
        raise cards.ValidationError(
            f"cannot close merge gate {card.meta['id']} (target {target!r}): live "
            f"state {state!r} has no legal walk to done — only a gate in "
            f"{sorted(_CLOSEABLE_STATES)} can be closed"
        )
    card.body = _append_section(card.body, "Result", result)
    if state != "working":
        cards.transition(card, "working", queue_root)
    cards.transition(card, "done", queue_root)
    return card


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="merge_gate.py",
        description="Register/close a merge-gate card (inbox-gates G1).",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    pf = sub.add_parser("file", help="register a merge gate (dedup-safe)")
    pf.add_argument("--queue-root", required=True)
    pf.add_argument("--target", required=True,
                    help="PR number or branch name being handed to a human")
    pf.add_argument("--repo", required=True)
    pf.add_argument("--branch", required=True)
    pf.add_argument("--pr-url", default=None)
    pf.add_argument("--unblocks", required=True)
    pf.add_argument("--risk-tier", default="T2")
    pf.add_argument("--owner", default="human-operator")

    pc = sub.add_parser("close", help="close the live gate for a target")
    pc.add_argument("--queue-root", required=True)
    pc.add_argument("--target", required=True)
    pc.add_argument("--result", required=True)

    args = parser.parse_args(argv)

    if args.cmd == "file":
        card = file(args.queue_root, target=args.target, repo=args.repo,
                    branch=args.branch, pr_url=args.pr_url, unblocks=args.unblocks,
                    risk_tier=args.risk_tier, owner=args.owner)
        print(f"merge-gate filed id={card.meta['id']} target={args.target} "
              f"state={card.meta['state']}")
        return 0

    if args.cmd == "close":
        card = close(args.queue_root, target=args.target, result=args.result)
        if card is None:
            print(f"merge-gate close: no live gate for target={args.target}")
            return 1
        print(f"merge-gate closed id={card.meta['id']} target={args.target}")
        return 0

    return 2  # unreachable: subparser is required


if __name__ == "__main__":
    raise SystemExit(main())
