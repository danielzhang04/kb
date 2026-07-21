"""Delete local branches already merged into origin/main, prune the worktrees pinning
them, and keep local main from drifting.

Design: docs/specs/2026-07-20-branch-hygiene-cadence-design.md

The safety property this file exists to preserve: a branch is only ever deleted when every
one of its commits is reachable from origin/main, so nothing unique can be lost. That is
checked with `git merge-base --is-ancestor <branch> refs/remotes/origin/main`, and it is
the SOLE substantive gate. `git branch -d` (never -D) is only a weak backstop: it refuses
a branch that is unmerged relative to HEAD or the branch's OWN configured upstream, and it
never consults origin/main. Agent branches here are pushed, so their upstream makes them
trivially "merged" to `-d` even when they were never merged into origin/main -- so `-d`
cannot be counted on to catch a wrong deletion. Because the ancestry check stands alone,
it (and every other git query in this file) must fail CLOSED: any non-zero return code or
unreadable state is treated as "not safe to delete / not safe to remove", never silently
as "clean".

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


class GitError(RuntimeError):
    """A git query returned non-zero or unreadable output. Raised rather than swallowed:
    a query whose result is unknown must abort the run (exit 2, no card), never feed an
    empty/guessed value into a deletion decision."""


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
        return self._run_in(self.root, *args)

    def _run_in(self, cwd: Path | str, *args: str) -> tuple[int, str, str]:
        """Run git with an explicit working directory. The single subprocess entry point,
        so a worktree-scoped query (has_tracked_changes) stays on the seam instead of
        reaching for raw subprocess."""
        p = subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True
        )
        return p.returncode, p.stdout.strip(), p.stderr.strip()

    def fetch_prune(self) -> bool:
        code, _, _ = self.run("fetch", "origin", "--prune")
        return code == 0

    def branches(self) -> list[str]:
        code, out, err = self.run("branch", "--format=%(refname:short)")
        if code != 0:
            raise GitError(f"git branch failed: {err}")
        return [line.strip() for line in out.splitlines() if line.strip()]

    def current_branch(self) -> str:
        """Short name of the checked-out branch. Returns "HEAD" on a detached HEAD (git's
        own sentinel); raises on a failed query rather than returning an empty string that
        would silently disable the name-based protection of the current branch."""
        code, out, err = self.run("rev-parse", "--abbrev-ref", "HEAD")
        if code != 0:
            raise GitError(f"could not determine current branch: {err}")
        return out

    def is_ancestor(self, ref: str, of: str) -> bool:
        code, _, _ = self.run("merge-base", "--is-ancestor", ref, of)
        return code == 0

    def last_commit_at(self, ref: str) -> datetime:
        code, out, err = self.run("log", "-1", "--format=%cI", ref)
        if code != 0 or not out:
            raise GitError(f"could not read last-commit time for {ref}: {err or 'no output'}")
        return datetime.fromisoformat(out)

    def worktrees(self) -> dict[str, str]:
        """branch name -> worktree path, for worktrees that have a branch checked out.

        The MAIN working tree (whose path is the repo root) is deliberately excluded: it is
        never a prunable "stale worktree", and mapping its branch here would let a wrong
        current_branch steer the script toward `worktree remove --force <repo-root>`.
        """
        code, out, err = self.run("worktree", "list", "--porcelain")
        if code != 0:
            raise GitError(f"git worktree list failed: {err}")
        root_resolved = self.root.resolve()
        result: dict[str, str] = {}
        path = None
        for line in out.splitlines():
            if line.startswith("worktree "):
                path = line[len("worktree ") :].strip()
            elif line.startswith("branch ") and path:
                branch = line[len("branch ") :].strip()
                if branch.startswith("refs/heads/"):
                    if Path(path).resolve() == root_resolved:
                        continue
                    result[branch[len("refs/heads/") :]] = path
        return result

    def has_tracked_changes(self, path: Path | str) -> bool:
        """True if the worktree holds work worth preserving -- and True (fail CLOSED) when
        that cannot be determined, because a `worktree remove --force` must never proceed
        on an unknown state.

        `git status --porcelain` is run through the seam inside the worktree. Default
        untracked handling is kept on purpose: porcelain already honours .gitignore, so
        genuinely gitignored build output (the dashboard's `dashboard/node_modules/`) stays
        invisible, while a real, unignored, never-staged file DOES count as work and blocks
        removal. A non-zero return code means the state is unreadable -> treat as dirty.
        """
        code, out, _ = self._run_in(path, "status", "--porcelain")
        if code != 0:
            return True
        return bool(out)


def fast_forward_main(git: Git) -> tuple[bool, str]:
    """Advance local main to origin/main when that is a pure fast-forward.

    Never resets and never forces. A diverged main is a fact a human needs to see, not a
    situation to resolve automatically -- and local main silently drifting 260 commits
    behind origin/main is what made an ordinary pile of merged branches look like a crisis
    in the first place.
    """
    # Fully-qualified refs throughout: a local branch literally named "origin/main" would
    # otherwise shadow the remote-tracking ref (refs/heads/ is consulted before
    # refs/remotes/) and quietly turn every ancestry test trivially true.
    code, _, _ = git.run("rev-parse", "--verify", "refs/remotes/origin/main")
    if code != 0:
        return False, "origin/main not found"
    lcode, local, _ = git.run("rev-parse", "--verify", "refs/heads/main")
    if lcode != 0:
        return False, "local main not found"
    _, remote, _ = git.run("rev-parse", "refs/remotes/origin/main")
    if local == remote:
        return False, ""
    if not git.is_ancestor("refs/heads/main", "refs/remotes/origin/main"):
        return False, f"local main has diverged from origin/main ({local[:7]} vs {remote[:7]})"
    if git.current_branch() == "main":
        code, _, err = git.run("merge", "--ff-only", "refs/remotes/origin/main")
    else:
        code, _, err = git.run("fetch", ".", "refs/remotes/origin/main:refs/heads/main")
    return (code == 0), ("" if code == 0 else err)


def build_plan(git: Git, now=None, current: str | None = None) -> Plan:
    # Branch operands are qualified refs/heads/<b> and the target refs/remotes/origin/main
    # so a same-named local branch cannot shadow either side of the ancestry test (M1).
    return classify(
        branches=git.branches(),
        current=current if current is not None else git.current_branch(),
        worktrees=git.worktrees(),
        is_ancestor=lambda b: git.is_ancestor(f"refs/heads/{b}", "refs/remotes/origin/main"),
        has_tracked_changes=git.has_tracked_changes,
        last_commit_at=lambda b: git.last_commit_at(f"refs/heads/{b}"),
        now=now or datetime.now(timezone.utc),
    )


def apply(git: Git, plan: Plan) -> list[str]:
    """Execute a plan. Returns human-readable lines describing what happened."""
    done: list[str] = []
    for branch, path in plan.prune_then_delete:
        # Re-check immediately before the destructive step. classify() ran earlier and the
        # worktree may have gained uncommitted work since -- or become unreadable -- in
        # which case has_tracked_changes fails CLOSED to True. Either way, reclassify it as
        # blocked (so it prints and reaches a human) rather than force-removing it.
        if git.has_tracked_changes(path):
            plan.blocked.append((branch, path))
            done.append(f"kept worktree {branch} ({path}): became dirty before removal")
            continue
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
    # -d, never -D. The real guarantee is upstream: classify() already proved this branch
    # is an ancestor of origin/main. `-d` is only a weak backstop -- it checks reachability
    # from HEAD or the branch's configured upstream, NOT from origin/main, so a pushed
    # agent branch looks "merged" to it regardless. It is kept solely to reject the
    # pathological case where the ancestry gate was somehow bypassed; it is not a second
    # independent proof.
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
    scripts_dir = str(Path(repo_root) / "scripts")
    sys.path.insert(0, scripts_dir)
    try:
        import cards  # noqa: PLC0415
    finally:
        try:
            sys.path.remove(scripts_dir)
        except ValueError:
            pass

    target = "branch-hygiene:needs-human"
    queue_root = Path(repo_root) / "queue"
    # Dedup ONLY against cards still awaiting a human: a resolved card in done/ (or
    # rejected/approved) must never suppress a fresh alarm, or one handled card would
    # silence this cadence forever. The live directories are derived from cards.STATE_DIR
    # so this tracks the schema instead of hard-coding paths.
    resolved_states = {"done", "rejected", "approved"}
    live_dirs = {cards.STATE_DIR[s] for s in cards.STATES if s not in resolved_states}
    if queue_root.exists():
        for state_dir in sorted(live_dirs):
            for path in (queue_root / state_dir).glob("*.md"):
                try:
                    existing = cards.parse(path)
                except Exception:
                    continue
                # The approvals/ dir is shared by the live "approvals" state and the
                # resolved "approved" state, so directory membership alone is not
                # proof of liveness -- check the parsed state too.
                if (existing.meta.get("action") == "wake-me"
                        and existing.meta.get("target") == target
                        and existing.meta.get("state") not in resolved_states):
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
    try:
        return _run(args)
    except Exception as exc:  # noqa: BLE001
        # Exit 2 means "could not run", and files NO card -- the card machinery may itself
        # be what broke. Every git query is fail-closed (raises rather than returning an
        # empty/guessed value), so an unexpected failure lands here instead of silently
        # feeding a deletion decision. SystemExit from argparse is intentionally not caught.
        print(f"branch-hygiene: unexpected failure: {exc}", file=sys.stderr)
        return 2


def _run(args) -> int:
    root = Path(args.repo)
    git = Git(root)
    code, _, _ = git.run("rev-parse", "--git-dir")
    if code != 0:
        print(f"branch-hygiene: not a git repository: {root}", file=sys.stderr)
        return 2

    # The current branch is protected by NAME before any ancestry reasoning, so an unknown
    # or detached HEAD is a hard stop: there is no name to protect, and the main working
    # tree could otherwise be mistaken for a prunable worktree.
    current = git.current_branch()
    if current in ("", "HEAD"):
        print("branch-hygiene: HEAD is detached or unknown; refusing to run so the "
              "checked-out tree stays protected", file=sys.stderr)
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

    plan = build_plan(git, current=current)

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
