"""Preamble-gated POSIX runner scaffold for owned, non-dashboard Codex cards.

Linux runner activation and publication are intentionally deferred. The
dashboard keeps ``runnerTrigger`` disabled on Linux; direct invocation repeats
the ownership, preamble, and subscription-auth guards, then fails closed before
executing a card.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

from kb_paths import resolve_dashboard_state_root


def log_path(env: dict[str, str] | None = None) -> Path:
    values = os.environ if env is None else env
    fallback = Path(
        values.get("XDG_STATE_HOME") or Path.home() / ".local" / "state"
    ) / "kb-dashboard"
    root = resolve_dashboard_state_root(values, fallback=fallback)
    assert root is not None
    root.mkdir(parents=True, exist_ok=True)
    return root / "agent-runner.log"


def log(message: str) -> None:
    log_path().open("a", encoding="utf-8").write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}  {message}\n")


def run(args: list[str], repo: Path, *, input_text: str | None = None, stdout=None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=repo, input=input_text, text=True, stdout=stdout,
                          stderr=subprocess.STDOUT if stdout else subprocess.PIPE, check=False)


def wake_me(repo: Path, target: str, reason: str) -> str | None:
    """Best-effort, deduplicated human escalation; a failed wake never bypasses a gate."""
    sys.path.insert(0, str(repo / "scripts"))
    import cards  # noqa: PLC0415
    queue = repo / "queue"
    try:
        for path in queue.glob("*/*.md"):
            try:
                current = cards.parse(path)
            except Exception:
                continue
            if current.meta.get("action") == "wake-me" and current.meta.get("target") == target:
                return str(current.meta.get("id"))
        card = cards.new_card(project="kb", action="wake-me", target=target, risk_tier="T1",
                              body=f"## Work order\n\n{reason}\n")
        cards.save(card, queue)
        return str(card.meta["id"])
    except Exception as err:  # wake-me must not turn a bounded refusal into a crash
        log(f"wake-me-failed target={target}: {err}")
        return None


def owned_cards(repo: Path, agent: str) -> list[dict[str, str]]:
    sys.path.insert(0, str(repo / "scripts"))
    import cards  # noqa: PLC0415
    owned: list[dict[str, str]] = []
    for state in ("inbox", "working"):
        for path in sorted((repo / "queue" / state).glob("*.md")):
            try:
                card = cards.parse(path)
            except Exception:
                continue
            # Exact ownership arbitration: dashboard and terminal-controlled cards
            # must never be executed a second time by this legacy-compatible runner.
            if (not card.meta.get("execution-controller")
                    and card.meta.get("owner") == agent
                    and card.meta.get("state") in ("inbox", "working")):
                owned.append({"id": str(card.meta["id"]), "path": str(path.relative_to(repo))})
    return owned


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent", required=True)
    parser.add_argument("--repo-root", required=True)
    args = parser.parse_args()
    repo = Path(args.repo_root).resolve()
    os.chdir(repo)
    if (repo / "STOP").exists():
        log(f"stop-file-present agent={args.agent}")
        return 0
    preamble = run([sys.executable, "scripts/preamble.py"], repo)
    if preamble.returncode:
        wake_me(repo, f"agent_runner:{args.agent}:preamble", f"scripts/preamble.py exited {preamble.returncode}; runner refused to start.")
        return 1
    if os.environ.get("OPENAI_API_KEY") or os.environ.get("CODEX_API_KEY") or run(["codex", "login", "status"], repo).returncode:
        wake_me(repo, f"agent_runner:{args.agent}:billing-guard", "Codex subscription auth/environment guard failed; runner refused metered fallback.")
        return 1
    owned = owned_cards(repo, args.agent)
    if not owned:
        log(f"no-owned-cards agent={args.agent}")
        return 0
    log(f"runner-activation-deferred agent={args.agent} owned={len(owned)}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
