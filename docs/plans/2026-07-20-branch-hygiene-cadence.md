# Branch Hygiene Cadence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly desktop cadence that deletes local branches already merged into `origin/main`, prunes the stale worktrees pinning them, keeps local `main` from drifting, and files a wake-me card only when something needs a human.

**Architecture:** One script, `scripts/branch_hygiene.py`, with all git interaction behind a single injectable `Git` seam so the decision logic is a pure function testable with plain values. A `classify()` function turns repo state into a `Plan`; `apply()` executes it; `--check` runs `classify()` and prints without applying. A cadence entry in `HEARTBEAT.md` invokes it.

**Tech Stack:** Python 3.13 (invoked as `py -3`, never bare `python` — that resolves to a pip-less msys build on this box), pytest, `scripts/cards.py` for wake-me cards.

**Spec:** `docs/specs/2026-07-20-branch-hygiene-cadence-design.md` (commit `7b4eda5`)

## Global Constraints

- **Deletion is gated on exactly one provable fact:** `git merge-base --is-ancestor <branch> origin/main`. No heuristics, no name matching, no age-based deletion.
- **Only `git branch -d`, never `-D`.** Git's own refusal to delete unmerged branches is the second independent guard.
- **`main`, `ops`, and the currently checked-out branch are excluded by name** before any other logic runs.
- **No remote mutation whatsoever.** No `git push`, no `--delete`, no contact with the `codex` remote. `git fetch origin --prune` is the only network call.
- **Worktree removal requires both** that the branch is merged **and** that `git status --porcelain` shows no *tracked* modifications. Untracked files (`node_modules/`) do not block.
- **`main` is only ever fast-forwarded**, never reset or forced. A non-fast-forwardable `main` is reported, not resolved.
- **Exit contract:** `0` = clean (no card). `1` = something needs a human, card already filed. `2` = could not run at all, no card.
- A clean run files **no** card.
- Python 3.13, stdlib plus `scripts/cards.py`. Branch: `claude/branch-hygiene`. Never push to `main` or `ops`.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/branch_hygiene.py` | `Git` seam, pure `classify()`, `apply()`, reporting, CLI |
| `tests/test_branch_hygiene.py` | pytest — pure logic against fakes, plus real-git tests for ancestry/worktrees |
| `HEARTBEAT.md` | one cadence entry (lives on `main`; lands via PR) |

---

### Task 1: Git seam and repo-state reader

**Files:**
- Create: `scripts/branch_hygiene.py`
- Test: `tests/test_branch_hygiene.py`

**Interfaces:**
- Consumes: nothing
- Produces: `Git` class with `run(*args) -> tuple[int, str, str]`, `branches() -> list[str]`, `current_branch() -> str`, `is_ancestor(ref, of) -> bool`, `last_commit_at(ref) -> datetime`, `worktrees() -> dict[str, str]`, `has_tracked_changes(path) -> bool`; and `PROTECTED = {"main", "ops"}`, `STALE_DAYS = 14`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_branch_hygiene.py`:

```python
"""Tests for scripts/branch_hygiene.py."""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import branch_hygiene as bh  # noqa: E402


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, check=True
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A real git repo with an origin/main, one merged branch and one unmerged branch."""
    origin = tmp_path / "origin"
    origin.mkdir()
    _git(origin, "init", "-q", "--bare")

    work = tmp_path / "work"
    work.mkdir()
    _git(work, "init", "-q", "-b", "main")
    _git(work, "config", "user.email", "t@t")
    _git(work, "config", "user.name", "t")
    (work / "a.txt").write_text("a")
    _git(work, "add", "-A")
    _git(work, "commit", "-qm", "init")

    # merged branch: committed, then folded into main
    _git(work, "checkout", "-q", "-b", "merged-branch")
    (work / "b.txt").write_text("b")
    _git(work, "add", "-A")
    _git(work, "commit", "-qm", "b")
    _git(work, "checkout", "-q", "main")
    _git(work, "merge", "-q", "--no-ff", "-m", "merge b", "merged-branch")

    # unmerged branch: has a commit main does not
    _git(work, "checkout", "-q", "-b", "unmerged-branch")
    (work / "c.txt").write_text("c")
    _git(work, "add", "-A")
    _git(work, "commit", "-qm", "c")
    _git(work, "checkout", "-q", "main")

    _git(work, "remote", "add", "origin", str(origin))
    _git(work, "push", "-q", "origin", "main")
    _git(work, "fetch", "-q", "origin")
    return work


class TestGitSeam:
    def test_lists_local_branches(self, repo: Path) -> None:
        names = bh.Git(repo).branches()
        assert set(names) >= {"main", "merged-branch", "unmerged-branch"}

    def test_reports_current_branch(self, repo: Path) -> None:
        assert bh.Git(repo).current_branch() == "main"

    def test_ancestry_distinguishes_merged_from_unmerged(self, repo: Path) -> None:
        g = bh.Git(repo)
        assert g.is_ancestor("merged-branch", "origin/main") is True
        assert g.is_ancestor("unmerged-branch", "origin/main") is False

    def test_last_commit_at_is_tz_aware_and_recent(self, repo: Path) -> None:
        when = bh.Git(repo).last_commit_at("main")
        assert when.tzinfo is not None
        assert datetime.now(timezone.utc) - when < timedelta(minutes=5)

    def test_worktrees_maps_branch_to_path(self, repo: Path, tmp_path: Path) -> None:
        wt = tmp_path / "wt-merged"
        _git(repo, "worktree", "add", "-q", str(wt), "merged-branch")
        assert "merged-branch" in bh.Git(repo).worktrees()

    def test_untracked_files_are_not_tracked_changes(self, repo: Path, tmp_path: Path) -> None:
        # node_modules-style noise must never block a prune.
        wt = tmp_path / "wt-clean"
        _git(repo, "worktree", "add", "-q", str(wt), "merged-branch")
        (wt / "node_modules").mkdir()
        (wt / "node_modules" / "x.js").write_text("x")
        assert bh.Git(repo).has_tracked_changes(wt) is False

    def test_modified_tracked_file_is_a_tracked_change(self, repo: Path, tmp_path: Path) -> None:
        wt = tmp_path / "wt-dirty"
        _git(repo, "worktree", "add", "-q", str(wt), "merged-branch")
        (wt / "a.txt").write_text("modified")
        assert bh.Git(repo).has_tracked_changes(wt) is True
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `py -3 -m pytest tests/test_branch_hygiene.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'branch_hygiene'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/branch_hygiene.py`:

```python
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

import subprocess
from datetime import datetime, timezone
from pathlib import Path

PROTECTED = frozenset({"main", "ops"})
STALE_DAYS = 14


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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `py -3 -m pytest tests/test_branch_hygiene.py -q`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/branch_hygiene.py tests/test_branch_hygiene.py
git commit -m "feat(hygiene): git seam and repo-state reader for branch hygiene"
```

---

### Task 2: Pure classification

**Files:**
- Modify: `scripts/branch_hygiene.py`
- Test: `tests/test_branch_hygiene.py`

**Interfaces:**
- Consumes: `PROTECTED`, `STALE_DAYS` (Task 1)
- Produces: `@dataclass Plan` with fields `delete: list[str]`, `prune_then_delete: list[tuple[str, str]]`, `blocked: list[tuple[str, str]]`, `stale_unmerged: list[tuple[str, int]]`, `protected: list[str]`; and `classify(branches, current, worktrees, is_ancestor, has_tracked_changes, last_commit_at, now, stale_days=STALE_DAYS) -> Plan`.

`classify` performs no I/O — every git fact arrives as an injected callable, so the whole policy is testable with plain values.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_branch_hygiene.py`:

```python
NOW = datetime(2026, 7, 20, 12, 0, 0, tzinfo=timezone.utc)


def _classify(branches, current="main", worktrees=None, merged=(), dirty=(), ages=None):
    """Drive classify() with plain values; no git, no filesystem."""
    worktrees = worktrees or {}
    ages = ages or {}
    return bh.classify(
        branches=branches,
        current=current,
        worktrees=worktrees,
        is_ancestor=lambda b: b in merged,
        has_tracked_changes=lambda p: p in dirty,
        last_commit_at=lambda b: NOW - timedelta(days=ages.get(b, 0)),
        now=NOW,
    )


class TestClassify:
    def test_merged_unpinned_branch_is_deleted(self) -> None:
        plan = _classify(["main", "feature"], merged=("feature",))
        assert plan.delete == ["feature"]

    def test_unmerged_branch_is_never_deleted(self) -> None:
        plan = _classify(["main", "feature"], merged=())
        assert plan.delete == []
        assert plan.prune_then_delete == []

    def test_unmerged_branch_is_never_deleted_however_old(self) -> None:
        # Age is a reporting signal only. It must never authorise deletion.
        plan = _classify(["main", "ancient"], merged=(), ages={"ancient": 3650})
        assert plan.delete == []
        assert ("ancient", 3650) in plan.stale_unmerged

    def test_protected_branches_are_never_deleted_even_when_merged(self) -> None:
        plan = _classify(["main", "ops"], merged=("main", "ops"))
        assert plan.delete == []
        assert set(plan.protected) == {"main", "ops"}

    def test_current_branch_is_never_deleted_even_when_merged(self) -> None:
        plan = _classify(["main", "checked-out"], current="checked-out",
                         merged=("checked-out",))
        assert plan.delete == []
        assert "checked-out" in plan.protected

    def test_merged_branch_in_clean_worktree_is_pruned_then_deleted(self) -> None:
        plan = _classify(["main", "feature"], worktrees={"feature": "/wt/feature"},
                         merged=("feature",))
        assert plan.prune_then_delete == [("feature", "/wt/feature")]
        assert plan.delete == []

    def test_merged_branch_in_dirty_worktree_is_blocked_not_deleted(self) -> None:
        plan = _classify(["main", "feature"], worktrees={"feature": "/wt/feature"},
                         merged=("feature",), dirty=("/wt/feature",))
        assert plan.blocked == [("feature", "/wt/feature")]
        assert plan.delete == []
        assert plan.prune_then_delete == []

    def test_fresh_unmerged_branch_is_not_reported_stale(self) -> None:
        plan = _classify(["main", "wip"], merged=(), ages={"wip": 3})
        assert plan.stale_unmerged == []

    def test_stale_threshold_is_inclusive_at_the_boundary(self) -> None:
        plan = _classify(["main", "edge"], merged=(), ages={"edge": bh.STALE_DAYS})
        assert ("edge", bh.STALE_DAYS) in plan.stale_unmerged
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `py -3 -m pytest tests/test_branch_hygiene.py -q`
Expected: FAIL — `AttributeError: module 'branch_hygiene' has no attribute 'classify'`.

- [ ] **Step 3: Write the implementation**

Insert into `scripts/branch_hygiene.py`, after the constants and before `class Git`:

```python
from dataclasses import dataclass, field


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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `py -3 -m pytest tests/test_branch_hygiene.py -q`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/branch_hygiene.py tests/test_branch_hygiene.py
git commit -m "feat(hygiene): pure branch classification"
```

---

### Task 3: Apply, fast-forward, reporting, CLI

**Files:**
- Modify: `scripts/branch_hygiene.py`
- Test: `tests/test_branch_hygiene.py`

**Interfaces:**
- Consumes: `Git`, `Plan`, `classify` (Tasks 1-2)
- Produces: `fast_forward_main(git) -> tuple[bool, str]`, `apply(git, plan) -> list[str]`, `build_plan(git, now=None) -> Plan`, `file_wake_me(repo_root, plan, ff_problem) -> str | None`, `main(argv=None) -> int`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_branch_hygiene.py`:

```python
class TestApply:
    def test_check_mode_mutates_nothing(self, repo: Path) -> None:
        before_branches = sorted(bh.Git(repo).branches())
        before_worktrees = sorted(bh.Git(repo).worktrees())
        rc = bh.main(["--check", "--repo", str(repo)])
        assert rc in (0, 1)
        assert sorted(bh.Git(repo).branches()) == before_branches
        assert sorted(bh.Git(repo).worktrees()) == before_worktrees

    def test_apply_deletes_the_merged_branch_and_keeps_the_unmerged_one(
        self, repo: Path
    ) -> None:
        g = bh.Git(repo)
        plan = bh.build_plan(g)
        bh.apply(g, plan)
        names = g.branches()
        assert "merged-branch" not in names
        assert "unmerged-branch" in names
        assert "main" in names

    def test_apply_removes_a_clean_worktree_then_deletes_its_branch(
        self, repo: Path, tmp_path: Path
    ) -> None:
        wt = tmp_path / "wt-merged"
        _git(repo, "worktree", "add", "-q", str(wt), "merged-branch")
        g = bh.Git(repo)
        bh.apply(g, bh.build_plan(g))
        assert "merged-branch" not in g.branches()
        assert "merged-branch" not in g.worktrees()

    def test_apply_leaves_a_dirty_worktree_and_its_branch_alone(
        self, repo: Path, tmp_path: Path
    ) -> None:
        wt = tmp_path / "wt-dirty"
        _git(repo, "worktree", "add", "-q", str(wt), "merged-branch")
        (wt / "a.txt").write_text("uncommitted work")
        g = bh.Git(repo)
        plan = bh.build_plan(g)
        bh.apply(g, plan)
        assert "merged-branch" in g.branches()
        assert plan.blocked and plan.blocked[0][0] == "merged-branch"

    def test_fast_forward_advances_a_behind_main(self, repo: Path) -> None:
        # Move origin/main ahead, leave local main behind, then reconcile.
        _git(repo, "checkout", "-q", "-b", "ahead")
        (repo / "d.txt").write_text("d")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-qm", "d")
        _git(repo, "push", "-q", "origin", "ahead:main")
        _git(repo, "checkout", "-q", "main")
        _git(repo, "fetch", "-q", "origin")
        g = bh.Git(repo)
        assert g.run("rev-parse", "main")[1] != g.run("rev-parse", "origin/main")[1]
        moved, _ = bh.fast_forward_main(g)
        assert moved is True
        assert g.run("rev-parse", "main")[1] == g.run("rev-parse", "origin/main")[1]

    def test_fast_forward_refuses_when_main_has_diverged(self, repo: Path) -> None:
        # A local-only commit on main makes it non-fast-forwardable. Report, never force.
        _git(repo, "checkout", "-q", "main")
        (repo / "local-only.txt").write_text("x")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-qm", "local only")
        head_before = _git(repo, "rev-parse", "main")
        _git(repo, "checkout", "-q", "-b", "other")
        (repo / "e.txt").write_text("e")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-qm", "e")
        _git(repo, "push", "-q", "origin", "other:main")
        _git(repo, "checkout", "-q", "main")
        _git(repo, "fetch", "-q", "origin")
        moved, reason = bh.fast_forward_main(bh.Git(repo))
        assert moved is False
        assert reason
        assert _git(repo, "rev-parse", "main") == head_before


class TestExitContract:
    def test_clean_run_exits_zero(self, repo: Path) -> None:
        # Only a merged branch to remove; nothing needs a human.
        assert bh.main(["--repo", str(repo), "--no-card"]) == 0

    def test_run_needing_a_human_exits_one(self, repo: Path, tmp_path: Path) -> None:
        wt = tmp_path / "wt-dirty"
        _git(repo, "worktree", "add", "-q", str(wt), "merged-branch")
        (wt / "a.txt").write_text("uncommitted work")
        assert bh.main(["--repo", str(repo), "--no-card"]) == 1

    def test_unusable_repo_exits_two(self, tmp_path: Path) -> None:
        assert bh.main(["--repo", str(tmp_path)]) == 2
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `py -3 -m pytest tests/test_branch_hygiene.py -q`
Expected: FAIL — `module 'branch_hygiene' has no attribute 'build_plan'`.

- [ ] **Step 3: Write the implementation**

Append to `scripts/branch_hygiene.py`:

```python
import argparse
import sys

# `datetime` and `timezone` are already imported at the top of this file (Task 1).
# Do not re-import them here under an alias — that shadows the existing names.


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
    ap = argparse.ArgumentParser(description=__doc__)
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `py -3 -m pytest tests/test_branch_hygiene.py -q`
Expected: PASS — 25 tests.

- [ ] **Step 5: Run `--check` against the real repo (read-only)**

Run: `py -3 scripts/branch_hygiene.py --check`
Expected: a list of `would delete` / `would prune` lines, or nothing. Confirm afterwards with `git branch` that the branch list is unchanged. **If `--check` changed anything, stop and report — the dry-run guarantee is load-bearing.**

- [ ] **Step 6: Commit**

```bash
git add scripts/branch_hygiene.py tests/test_branch_hygiene.py
git commit -m "feat(hygiene): apply, fast-forward, wake-me reporting and CLI"
```

---

### Task 4: Cadence entry and live verification

**Files:**
- Modify: `HEARTBEAT.md`

**Interfaces:**
- Consumes: `scripts/branch_hygiene.py` CLI (Task 3)
- Produces: no new interfaces

- [ ] **Step 1: Add the cadence**

Append inside the `cadences:` list in `HEARTBEAT.md`, matching the surrounding indentation exactly:

```yaml
  - name: branch-hygiene
    schedule: weekly:sun
    tier: desktop
    risk-tier: T1
    prompt: |
      1. Run: py -3 scripts/preamble.py  — if it fails, stop and write a wake-me card
         into queue/inbox/ explaining why.
      2. Run: py -3 scripts/branch_hygiene.py
      3. Exit 1 is NOT a failure: it means the run finished and found something a human
         must decide, and it already filed the wake-me card. Confirm the card exists,
         then stop — do not retry and do not delete anything by hand.
      4. Exit 2 means it could not run at all and filed no card; surface the stderr text
         in a wake-me card yourself.
      5. On exit 0, append a lessons line to memory/<agent-id>.md, then commit ONLY
         memory/ queue/ ledgers/ changes to ops and push.
```

- [ ] **Step 2: Verify the YAML still parses**

Run:
```
py -3 -c "import yaml,pathlib,re; t=pathlib.Path('HEARTBEAT.md').read_text(encoding='utf-8'); b=re.search(r'```yaml\n(.*?)```', t, re.S).group(1); d=yaml.safe_load(b); print('cadences:', [c['name'] for c in d['cadences']])"
```
Expected: a list ending with `'branch-hygiene'`.

- [ ] **Step 3: Confirm the tier is right**

`tier: desktop` is forced, not chosen — worktrees exist only on this machine, so a cloud runner cannot see them. Confirm no other cadence in the file claims `branch-hygiene` and that `weekly:sun` matches the `weekly:sat` format already used by `weekly-audit`.

- [ ] **Step 4: Full suite**

Run: `py -3 -m pytest tests/ -q`
Expected: the whole repo suite green. Note there are 3 pre-existing collection errors in `orgs/faceless-youtube` dev scripts misnamed `*_test.py` — those predate this work; use `--ignore` as needed and say so rather than "fixing" them here.

- [ ] **Step 5: Commit**

```bash
git add HEARTBEAT.md
git commit -m "feat(hygiene): register the weekly branch-hygiene cadence"
```

---

### Task 5: Enable GitHub's own branch deletion

**Files:** none — a repository setting.

- [ ] **Step 1: Check the current setting**

Run: `gh api repos/danielzhang04/kb --jq '.delete_branch_on_merge'`
Expected: `false` (that is why 105 remote branches accumulated).

- [ ] **Step 2: Enable it**

Run: `gh api -X PATCH repos/danielzhang04/kb -f delete_branch_on_merge=true --jq '.delete_branch_on_merge'`
Expected: `true`

This is the larger half of the fix: it deletes each branch on `origin` synchronously at PR-merge time, which nothing scheduled can match. It also means the script never needs remote-delete capability, which is what keeps its blast radius local.

- [ ] **Step 3: Report to Daniel**

This changes a shared repository setting rather than a local file, so state plainly that it was turned on and what it now does to every future PR merge.

---

## Notes for the implementing agent

- **Never use `git branch -D`.** The whole safety argument rests on `-d` refusing unmerged branches as an independent second guard.
- **Never push to `main` or `ops`**, and never add remote-delete capability to this script.
- Use `py -3`, never bare `python` — the latter is a pip-less msys build on this machine.
- If `--check` ever mutates state, stop immediately and report; the dry-run guarantee is load-bearing for trust in the cadence.
- `HEARTBEAT.md` lives on protected `main` and lands via PR, which is the human approval step for the cadence's declared risk tier.
