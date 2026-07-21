"""Shared git-runner seam for Atlas's ops writes (design §5/§6).

Both the transcript ledger (Task 6) and voice card filing (Task 9) commit to the ops worktree
under the constitution's pull-rebase-before-write rule with a bounded rejected-push -> reconcile
-> retry loop. Rather than duplicate that logic, both consume this one seam:

  - `default_git_runner(args, cwd)` — the production runner (plain git CLI, capture, no check).
  - `run(runner, cwd, args, check=True)` — one git call; check=True raises `GitError` on non-zero.
  - `push_with_retry(runner, cwd, remote, branch, retries)` — push, rebase-on-reject, retry.
  - `ATLAS_IDENTITY` — the inline commit identity, passed per-command with `git -c user.name=...`
    (NEVER `git config`, so a stale identity in shared config can't attach to an Atlas commit).

`git_runner(args: list, cwd) -> CompletedProcess-like` is injectable everywhere so tests run
against a throwaway repo + local bare remote with no network. No voice-stack imports here — this
module is reachable from `kbmcp.kb_tools`, which must stay importable without livekit.
"""
import logging
import subprocess
from typing import Callable

logger = logging.getLogger("atlas.gitseam")

# Inline commit identity (never `git config`) — see module docstring.
ATLAS_IDENTITY = ["-c", "user.name=atlas-worker", "-c", "user.email=atlas-worker@agents.local"]


def default_git_runner(args: list, cwd) -> "subprocess.CompletedProcess":
    """Production seam: run the plain git CLI in `cwd`, capturing output, WITHOUT check=True —
    the caller inspects `returncode` (a push rejection is a normal, expected non-zero)."""
    return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True)


class GitError(RuntimeError):
    """A git invocation that was expected to succeed returned non-zero (or the runner raised)."""


def run(git_runner: Callable, cwd, args: list, check: bool = True):
    """Run one git command through the injected runner. With check=True (default) a non-zero exit
    raises `GitError`; the runner itself raising propagates to the caller. Push/diff pass
    check=False and inspect `returncode` directly."""
    result = git_runner(args, cwd)
    if check and getattr(result, "returncode", 1) != 0:
        raise GitError(
            f"git {' '.join(args)} -> {getattr(result, 'returncode', '?')}: "
            f"{getattr(result, 'stderr', '')}"
        )
    return result


def push_with_retry(git_runner: Callable, cwd, remote: str, branch: str, retries: int) -> bool:
    """Push to `remote`/`branch`; on a rejected (non-fast-forward) push, pull-rebase and retry,
    bounded. Returns True once a push reports success, False after exhausting `retries`."""
    for _ in range(retries):
        if run(git_runner, cwd, ["push", remote, branch], check=False).returncode == 0:
            return True
        run(git_runner, cwd, ["pull", "--rebase", remote, branch])  # reconcile, then retry
    logger.error("atlas git push rejected after %d attempts", retries)
    return False
