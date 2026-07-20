"""Delete local branches already merged into origin/main, prune the worktrees pinning
them, and keep local main from drifting.

Design: docs/specs/2026-07-20-branch-hygiene-cadence-design.md

The safety property this file exists to preserve: a branch is only ever deleted when every
one of its commits is reachable from origin/main, so nothing unique can be lost. That is
checked with `git merge-base --is-ancestor`, and `git branch -d` (never -D) refuses
unmerged branches independently -- two guards that must BOTH fail before work disappears.

Local only, by design. Branches on origin are deleted by GitHub's own "automatically
delete head branches" setting at merge time, which is strictly better than anything on a
schedule; this script therefore needs no remote-delete capability at all, which is what
keeps its blast radius to this machine.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

PROTECTED = frozenset({"main", "ops"})
STALE_DAYS = 14


@dataclass
class Plan:
    """What a run intends to do. Produced without touching anything."""

    delete: list[str] = field(default_factory=list)
    prune_then_delete: list[tuple[str, str]] = field(default_factory=list)
    blocked: list[tuple[str, str]] = field(default_factory=list)
    stale_unmerged: list[tuple[str, int]] = field(default_factory=list)
    protected: list[str] = field(default_factory=list)

    @property
    def needs_human(self) -> bool:
        return bool(self.blocked or self.stale_unmerged)


def classify(
    branches,
    current,
    worktrees,
    is_ancestor,
    has_tracked_changes,
    last_commit_at,
    now,
    stale_days: int = STALE_DAYS,
) -> Plan:
    """Decide what to do, without doing any of it.

    Pure by construction: every git fact arrives as an injected callable, so the entire
    policy is exercisable with plain values and no repository.
    """
    plan = Plan()
    for branch in branches:
        # Name-based exclusions come FIRST, ahead of any merge reasoning. Deleting the
        # branch you are standing on, or ops, must not depend on ancestry being computed
        # correctly.
        if branch in PROTECTED or branch == current:
            plan.protected.append(branch)
            continue

        if not is_ancestor(branch):
            age = (now - last_commit_at(branch)).days
            if age >= stale_days:
                plan.stale_unmerged.append((branch, age))
            continue

        worktree = worktrees.get(branch)
        if worktree is None:
            plan.delete.append(branch)
        elif has_tracked_changes(worktree):
            plan.blocked.append((branch, worktree))
        else:
            plan.prune_then_delete.append((branch, worktree))
    return plan


class Git:
    """Every git call goes through here, so tests can swap the whole seam out."""

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)

    def run(self, *args: str) -> tuple[int, str, str]:
        p = subprocess.run(
            ["git", *args], cwd=self.root, capture_output=True, text=True
        )
        return p.returncode, p.stdout.strip(), p.stderr.strip()

    def fetch_prune(self) -> bool:
        code, _, _ = self.run("fetch", "origin", "--prune")
        return code == 0

    def branches(self) -> list[str]:
        _, out, _ = self.run("branch", "--format=%(refname:short)")
        return [line.strip() for line in out.splitlines() if line.strip()]

    def current_branch(self) -> str:
        _, out, _ = self.run("rev-parse", "--abbrev-ref", "HEAD")
        return out

    def is_ancestor(self, ref: str, of: str) -> bool:
        code, _, _ = self.run("merge-base", "--is-ancestor", ref, of)
        return code == 0

    def last_commit_at(self, ref: str) -> datetime:
        _, out, _ = self.run("log", "-1", "--format=%cI", ref)
        return datetime.fromisoformat(out)

    def worktrees(self) -> dict[str, str]:
        """branch name -> worktree path, for worktrees that have a branch checked out."""
        _, out, _ = self.run("worktree", "list", "--porcelain")
        result: dict[str, str] = {}
        path = None
        for line in out.splitlines():
            if line.startswith("worktree "):
                path = line[len("worktree ") :].strip()
            elif line.startswith("branch ") and path:
                branch = line[len("branch ") :].strip()
                if branch.startswith("refs/heads/"):
                    result[branch[len("refs/heads/") :]] = path
        return result

    def has_tracked_changes(self, path: Path | str) -> bool:
        """True if any TRACKED file is modified or staged.

        Untracked files are deliberately ignored: every dashboard worktree carries a
        node_modules/, and treating that as "work in progress" would make the prune step
        a no-op in practice.
        """
        p = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no"],
            cwd=Path(path), capture_output=True, text=True,
        )
        return bool(p.stdout.strip())


def fast_forward_main(git: Git) -> tuple[bool, str]:
    """Advance local main to origin/main when that is a pure fast-forward.

    Never resets and never forces. A diverged main is a fact a human needs to see, not a
    situation to resolve automatically -- and local main silently drifting 260 commits
    behind origin/main is what made an ordinary pile of merged branches look like a crisis
    in the first place.
    """
    code, _, _ = git.run("rev-parse", "--verify", "origin/main")
    if code != 0:
        return False, "origin/main not found"
    _, local, _ = git.run("rev-parse", "main")
    _, remote, _ = git.run("rev-parse", "origin/main")
    if local == remote:
        return False, ""
    if not git.is_ancestor("main", "origin/main"):
        return False, f"local main has diverged from origin/main ({local[:7]} vs {remote[:7]})"
    if git.current_branch() == "main":
        code, _, err = git.run("merge", "--ff-only", "origin/main")
    else:
        code, _, err = git.run("fetch", ".", "origin/main:main")
    return (code == 0), ("" if code == 0 else err)


def build_plan(git: Git, now=None) -> Plan:
    return classify(
        branches=git.branches(),
        current=git.current_branch(),
        worktrees=git.worktrees(),
        is_ancestor=lambda b: git.is_ancestor(b, "origin/main"),
        has_tracked_changes=git.has_tracked_changes,
        last_commit_at=git.last_commit_at,
        now=now or datetime.now(timezone.utc),
    )


def apply(git: Git, plan: Plan) -> list[str]:
    """Execute a plan. Returns human-readable lines describing what happened."""
    done: list[str] = []
    for branch, path in plan.prune_then_delete:
        code, _, err = git.run("worktree", "remove", "--force", path)
        if code != 0:
            done.append(f"worktree-remove-failed {branch} ({path}): {err}")
            continue
        done.append(f"removed worktree {branch} ({path})")
        done.extend(_delete(git, branch))
    for branch in plan.delete:
        done.extend(_delete(git, branch))
    git.run("worktree", "prune")
    return done


def _delete(git: Git, branch: str) -> list[str]:
    # -d, never -D. classify() already proved this branch is an ancestor of origin/main;
    # git's own refusal to delete unmerged branches is the second, independent guard.
    code, _, err = git.run("branch", "-d", branch)
    return [f"deleted {branch}"] if code == 0 else [f"delete-failed {branch}: {err}"]


def _card_body(plan: Plan, ff_problem: str) -> str:
    lines = ["## Work order", "", "Branch hygiene found something needing a human.", ""]
    if ff_problem:
        lines += [f"- local `main` could not fast-forward: {ff_problem}", ""]
    for branch, path in plan.blocked:
        lines.append(f"- `{branch}` is merged but its worktree has uncommitted tracked "
                     f"changes: `{path}` — review, then delete both by hand.")
    for branch, age in plan.stale_unmerged:
        lines.append(f"- `{branch}` is unmerged and untouched for {age} days — merge it "
                     f"or delete it deliberately. This cadence will never delete it.")
    return "\n".join(lines) + "\n"


def file_wake_me(repo_root: Path, plan: Plan, ff_problem: str) -> str | None:
    """File one deduped wake-me card. Returns the card id, or None if one already exists."""
    sys.path.insert(0, str(Path(repo_root) / "scripts"))
    import cards  # noqa: PLC0415

    target = "branch-hygiene:needs-human"
    queue_root = Path(repo_root) / "queue"
    if queue_root.exists():
        for path in queue_root.glob("*/*.md"):
            try:
                existing = cards.parse(path)
            except Exception:
                continue
            if (existing.meta.get("action") == "wake-me"
                    and existing.meta.get("target") == target):
                return None
    card = cards.new_card(project="kb", action="wake-me", target=target,
                          risk_tier="T1", body=_card_body(plan, ff_problem))
    cards.save(card, queue_root)
    return card.meta["id"]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Branch hygiene: delete merged local branches.")
    ap.add_argument("--repo", default=".", help="repository root")
    ap.add_argument("--check", action="store_true",
                    help="dry run: report the plan, mutate nothing")
    ap.add_argument("--no-card", action="store_true",
                    help="skip filing a wake-me card (for tests)")
    args = ap.parse_args(argv)

    root = Path(args.repo)
    git = Git(root)
    code, _, _ = git.run("rev-parse", "--git-dir")
    if code != 0:
        print(f"branch-hygiene: not a git repository: {root}", file=sys.stderr)
        return 2

    if not args.check and not git.fetch_prune():
        print("branch-hygiene: git fetch origin failed", file=sys.stderr)
        return 2

    ff_problem = ""
    if not args.check:
        moved, problem = fast_forward_main(git)
        ff_problem = problem
        if moved:
            print("fast-forwarded local main to origin/main")

    plan = build_plan(git)

    if args.check:
        for branch in plan.delete:
            print(f"would delete  {branch}")
        for branch, path in plan.prune_then_delete:
            print(f"would prune   {branch}  ({path})")
        # Say so explicitly. A tool that prints nothing reads as broken rather than clean,
        # and this one is meant to be trusted enough to run unattended.
        if not plan.delete and not plan.prune_then_delete:
            print(f"nothing to delete ({len(plan.protected)} protected, "
                  f"{len(plan.stale_unmerged)} stale unmerged)")
    else:
        for line in apply(git, plan):
            print(line)

    for branch, path in plan.blocked:
        print(f"BLOCKED  {branch}: worktree has uncommitted work ({path})")
    for branch, age in plan.stale_unmerged:
        print(f"STALE    {branch}: unmerged, {age} days untouched")
    if ff_problem:
        print(f"MAIN     {ff_problem}")

    if plan.needs_human or ff_problem:
        if not args.check and not args.no_card:
            card_id = file_wake_me(root, plan, ff_problem)
            print(f"filed wake-me card {card_id}" if card_id
                  else "wake-me card already open (deduped)")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
