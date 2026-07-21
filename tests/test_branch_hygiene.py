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
    # Committed on main and inherited by every branch/worktree, so has_tracked_changes
    # (which now keeps git's default .gitignore-honouring untracked handling) treats
    # node_modules/ as ignored noise while a real untracked file still counts as work.
    (work / ".gitignore").write_text("node_modules/\n")
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

    def test_untracked_real_file_is_a_tracked_change(self, repo: Path, tmp_path: Path) -> None:
        # A genuinely new, unignored file is work-in-progress and MUST block a prune --
        # only gitignored output (node_modules/) is allowed to be invisible.
        wt = tmp_path / "wt-newfile"
        _git(repo, "worktree", "add", "-q", str(wt), "merged-branch")
        (wt / "brand-new.txt").write_text("unsaved work")
        assert bh.Git(repo).has_tracked_changes(wt) is True

    def test_unreadable_worktree_fails_closed(self, repo: Path, tmp_path: Path) -> None:
        # If `git status` cannot report (path is not a git worktree at all), the state is
        # unknown and must be treated as dirty so a --force removal never proceeds.
        not_a_worktree = tmp_path / "plain-dir"
        not_a_worktree.mkdir()
        assert bh.Git(repo).has_tracked_changes(not_a_worktree) is True


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

    def test_untracked_real_file_in_worktree_blocks_prune(
        self, repo: Path, tmp_path: Path
    ) -> None:
        # A worktree carrying an unsaved, unignored file must be reported, never pruned --
        # the same protection tracked modifications get.
        wt = tmp_path / "wt-newfile"
        _git(repo, "worktree", "add", "-q", str(wt), "merged-branch")
        (wt / "brand-new.txt").write_text("unsaved work")
        g = bh.Git(repo)
        plan = bh.build_plan(g)
        bh.apply(g, plan)
        assert "merged-branch" in g.branches()
        assert plan.blocked and plan.blocked[0][0] == "merged-branch"
        assert plan.prune_then_delete == []

    def test_toctou_dirty_worktree_is_not_force_removed(
        self, repo: Path, tmp_path: Path
    ) -> None:
        # classify() saw a clean worktree; a tracked file is then modified before apply.
        # The last-moment re-check must reclassify it as blocked, not force-remove it.
        wt = tmp_path / "wt-clean"
        _git(repo, "worktree", "add", "-q", str(wt), "merged-branch")
        g = bh.Git(repo)
        plan = bh.build_plan(g)
        assert plan.prune_then_delete and plan.prune_then_delete[0][0] == "merged-branch"
        (wt / "a.txt").write_text("became dirty after planning")
        bh.apply(g, plan)
        assert "merged-branch" in g.branches()
        assert "merged-branch" in g.worktrees()
        assert any(b == "merged-branch" for b, _ in plan.blocked)

    def test_fast_forward_reports_missing_local_main(self, repo: Path) -> None:
        # With no local main, the check must say so plainly instead of inventing a
        # "diverged" verdict from an empty rev-parse.
        _git(repo, "checkout", "-q", "unmerged-branch")
        _git(repo, "branch", "-D", "main")
        moved, reason = bh.fast_forward_main(bh.Git(repo))
        assert moved is False
        assert reason == "local main not found"

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
        # True divergence needs BOTH sides to gain commits the other lacks. The remote
        # branch must therefore fork from BEFORE the local-only commit -- forking after it
        # would carry it along and leave origin/main a plain fast-forward.
        _git(repo, "checkout", "-q", "main")
        base = _git(repo, "rev-parse", "main")

        _git(repo, "checkout", "-q", "-b", "other", base)
        (repo / "e.txt").write_text("e")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-qm", "e")
        _git(repo, "push", "-q", "origin", "other:main")

        _git(repo, "checkout", "-q", "main")
        (repo / "local-only.txt").write_text("x")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-qm", "local only")
        head_before = _git(repo, "rev-parse", "main")

        _git(repo, "fetch", "-q", "origin")
        # Sanity-check the fixture itself: neither side may contain the other.
        g = bh.Git(repo)
        assert g.is_ancestor("main", "origin/main") is False
        assert g.is_ancestor("origin/main", "main") is False

        moved, reason = bh.fast_forward_main(g)
        assert moved is False
        assert "diverged" in reason
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

    def test_detached_head_exits_two(self, repo: Path) -> None:
        # No branch name to protect -> hard stop, no deletion attempted.
        _git(repo, "checkout", "-q", "--detach", "HEAD")
        assert bh.main(["--repo", str(repo), "--no-card"]) == 2

    def test_unexpected_exception_exits_two(self, repo: Path, monkeypatch) -> None:
        # A fail-closed git query raising mid-run must surface as exit 2 (no card), never
        # as an uncaught traceback or a plan built on missing data.
        def boom(*_a, **_k):
            raise RuntimeError("git blew up")

        monkeypatch.setattr(bh, "build_plan", boom)
        assert bh.main(["--repo", str(repo), "--no-card"]) == 2


class TestWakeMeDedup:
    def _plan(self):
        p = bh.Plan()
        p.blocked.append(("feature", "/wt/feature"))
        return p

    def test_resolved_card_in_done_does_not_suppress(self, tmp_path: Path) -> None:
        # A handled card sitting in queue/done/ must NOT silence a fresh alarm forever.
        import cards  # noqa: PLC0415

        done_card = cards.new_card(
            project="kb", action="wake-me", target="branch-hygiene:needs-human",
            risk_tier="T1", body="resolved earlier", state="done",
        )
        cards.save(done_card, tmp_path / "queue")

        card_id = bh.file_wake_me(tmp_path, self._plan(), "")
        assert card_id is not None
        assert list((tmp_path / "queue" / "inbox").glob("*.md"))

    def test_approved_card_in_approvals_does_not_suppress(self, tmp_path: Path) -> None:
        # "approved" is a resolved state but shares queue/approvals/ with the live
        # "approvals" state -- directory scanning alone would wrongly dedup against it.
        import cards  # noqa: PLC0415

        approved = cards.new_card(
            project="kb", action="wake-me", target="branch-hygiene:needs-human",
            risk_tier="T1", body="approved earlier", state="approved",
        )
        cards.save(approved, tmp_path / "queue")

        assert bh.file_wake_me(tmp_path, self._plan(), "") is not None

    def test_live_card_in_inbox_suppresses(self, tmp_path: Path) -> None:
        # A still-open card in a live state DOES dedup, so a persistent blocker files one
        # card rather than one per week.
        assert bh.file_wake_me(tmp_path, self._plan(), "") is not None
        assert bh.file_wake_me(tmp_path, self._plan(), "") is None
