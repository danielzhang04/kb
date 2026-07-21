"""Durable session transcript ledger on ops (design §5, Task 6).

`SessionLedger` is a subscriber of `state.StatePublisher`: it taps the ONE canonical event
stream (the same stream `/state` and the done-watcher consume — nothing taps `AgentSession`
twice), buckets each `("line", {"t","role","text"})` event under the publisher's active
`session_id`, and on `flush(session_id)` durably records that wake-session's turns to the ops
worktree as JSONL — then commits and pushes under the constitution's pull-rebase-before-write
rule with the standard rejected-push -> reconcile -> retry loop.

Seam choice — SUBSCRIBE, not fed: `state.add_line` already emits exactly `{"t","role","text"}`
events, which is byte-for-byte the JSONL row the dashboard's `readTranscriptHistory` reads. So
the ledger subscribes and buffers the event payloads verbatim — zero duplicate wiring in app.py,
and the persisted transcript is identical to what `/state` shows. Bucketing reads
`publisher.session_id` at line-arrival time, so the flush of a session captured at sleep drains
exactly that wake's lines even if a new wake has since re-minted the id.

Never raises into the voice loop: ANY failure (git error, `git_runner` raising, unreachable ops
worktree, exhausted push retries) is logged and the buffered lines are RETAINED for the next
flush — lines are dropped only after a fully-successful commit+push. Empty session -> no file,
no commit. `git_runner(args, cwd) -> CompletedProcess-like` is injected (subprocess default) so
tests run against a throwaway repo + bare remote with no network.

Author identity is passed inline per commit (`git -c user.name=... -c user.email=...`) — NEVER
`git config`, so a stale identity in shared config can't attach to a transcript commit.

The git plumbing (default runner, per-call check, rejected-push retry, inline identity) lives in
`worker.gitseam`, shared with voice card filing (Task 9) so the ops-write pattern has one home.
"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from worker import gitseam

logger = logging.getLogger("atlas.ledger")

# The ops-relative directory the dashboard's readTranscriptHistory scans; filenames are
# YYYY-MM-DD-<session_id>.jsonl (design §5). Posix separators: git accepts them on Windows.
TRANSCRIPTS_DIR = "orgs/atlas/output/transcripts"
OPS_REMOTE = "origin"
OPS_BRANCH = "ops"
DEFAULT_PUSH_RETRIES = 3


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SessionLedger:
    """Buffers transcript lines per wake-session and flushes them to the ops worktree as JSONL.

    An observer of the publisher, never a controller: it only receives events and only ever
    reads/writes the transcript files + git state in `ops_root`.
    """

    def __init__(
        self,
        ops_root,
        git_runner: Callable[[list, object], object] = gitseam.default_git_runner,
        clock: Callable[[], datetime] = _utcnow,
        push_retries: int = DEFAULT_PUSH_RETRIES,
    ) -> None:
        self._ops_root = Path(ops_root)
        self._git_runner = git_runner
        self._clock = clock
        self._push_retries = push_retries
        self._buffers: dict[str, list[dict]] = {}
        self._failed: set[str] = set()  # sessions whose flush failed — retried at the next sleep
        self._publisher = None

    # --- subscription seam -------------------------------------------------------------------
    def subscribe_to(self, publisher) -> None:
        """Subscribe to the publisher's event stream; retain it to read the active session_id
        when bucketing incoming lines."""
        self._publisher = publisher
        publisher.subscribe(self._on_event)

    def _on_event(self, event: tuple) -> None:
        kind, payload = event
        if kind != "line":
            return  # state changes and any future event kinds are not transcript rows
        sid = self._publisher.session_id if self._publisher is not None else None
        if sid is None:
            return  # a line with no active session (shouldn't happen) has nowhere to belong
        self._buffers.setdefault(sid, []).append(
            {"t": payload["t"], "role": payload["role"], "text": payload["text"]}
        )

    # --- flush -------------------------------------------------------------------------------
    def flush(self, session_id: str | None) -> None:
        """Durably record + push the wake-session `session_id` that just ended, THEN re-attempt
        any sessions retained from prior failed flushes (retry-at-next-sleep, design §5). Only
        the target session and previously-FAILED sessions are touched — a still-open session
        that has not been asked to flush is left alone. Never raises: a failed session keeps its
        buffer and is remembered for the next flush; lines are dropped only after a fully
        successful commit+push. Empty session -> no file, no commit."""
        if session_id is not None:
            self._attempt(session_id)
        for sid in list(self._failed):
            if sid != session_id:
                self._attempt(sid)

    def _attempt(self, session_id: str) -> None:
        """Flush one session's buffer; update the retained/failed bookkeeping. Never raises."""
        lines = self._buffers.get(session_id)
        if not lines:  # empty (or already-drained) session -> nothing to commit
            self._buffers.pop(session_id, None)
            self._failed.discard(session_id)
            return
        if self._flush_session(session_id, lines):
            self._buffers.pop(session_id, None)  # drop only after a fully-successful commit+push
            self._failed.discard(session_id)
        else:
            self._failed.add(session_id)  # retain the buffer; retry at the next flush

    def _flush_session(self, session_id: str, lines: list[dict]) -> bool:
        """Pull-rebase, write the full JSONL, commit under the atlas-worker identity, and push
        with a bounded rejected-push -> rebase -> retry loop. Returns True on success; logs and
        returns False on any failure (the caller retains the buffer). Never raises."""
        try:
            date = self._clock().date().isoformat()
            rel = f"{TRANSCRIPTS_DIR}/{date}-{session_id}.jsonl"

            self._git(["pull", "--rebase", OPS_REMOTE, OPS_BRANCH])

            path = self._ops_root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            # Overwrite with the full buffer: the buffer holds every line of the session, so a
            # re-flush after a partially-completed prior attempt is idempotent (no dup rows).
            body = "".join(
                json.dumps({"t": ln["t"], "role": ln["role"], "text": ln["text"]},
                           ensure_ascii=False) + "\n"
                for ln in lines
            )
            path.write_text(body, encoding="utf-8")

            self._git(["add", rel])
            # Only commit when there is a staged change — a re-flush of an already-committed
            # (but unpushed) session finds nothing staged and falls through to push.
            if self._git(["diff", "--cached", "--quiet"], check=False).returncode != 0:
                self._git([*gitseam.ATLAS_IDENTITY, "commit", "-m",
                           f"atlas: session transcript {session_id}"])

            return gitseam.push_with_retry(self._git_runner, self._ops_root,
                                           OPS_REMOTE, OPS_BRANCH, self._push_retries)
        except Exception:
            logger.exception("atlas transcript flush failed for session %s; retaining lines", session_id)
            return False

    def _git(self, args: list[str], check: bool = True):
        """Run one git command through the shared seam. check=True raises `gitseam.GitError`
        (caught by `_flush_session`); push/diff pass check=False and inspect `returncode`."""
        return gitseam.run(self._git_runner, self._ops_root, args, check=check)
