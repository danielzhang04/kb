"""Unified worker state (design §2/§3).

A small in-process publisher owning the Atlas state machine, the transcript ring, and one
event stream. Everything downstream — the HTTP `/state` snapshot (Task 5), the transcript
ledger (Task 6), the done-watcher (Task 11) — consumes this ONE stream; nothing taps
`AgentSession` twice.

States: ASLEEP | LISTENING | THINKING | SPEAKING. OFFLINE is NOT a worker state — it is what
the dashboard derives when the `/state` endpoint is unreachable (design §2).

Pure by contract: no I/O, no asyncio import, no locks. Subscribers are synchronous callbacks
invoked on the event loop only (single-threaded by construction, so no locking is needed).
Events are `("state", <new_state>)` and `("line", {"t","role","text"})`. A subscriber that
raises is logged and skipped — it never breaks the publisher or the other subscribers.
"""
import logging
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Callable

logger = logging.getLogger("atlas.state")

ASLEEP = "ASLEEP"
LISTENING = "LISTENING"
THINKING = "THINKING"
SPEAKING = "SPEAKING"

SNAPSHOT_VERSION = 1
DEFAULT_RING = 50

# livekit-agents 1.6.6 AgentState (voice/events.py:312 —
# Literal["initializing","idle","listening","thinking","speaking"]) mapped to Atlas states.
# "thinking" is set at LLM-generation start (voice/agent_activity.py:3082/3303/3944) and
# "speaking" at TTS-playout start (agent_activity.py:2685/3146), so the session's own state
# machine gives us THINKING/SPEAKING directly — no derivation from raw turn events needed.
# "initializing" is deliberately absent: the wiring ignores warm-up while ASLEEP.
STATE_FROM_AGENT = {
    "thinking": THINKING,
    "speaking": SPEAKING,
    "listening": LISTENING,
    "idle": LISTENING,
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class StatePublisher:
    """Owns the Atlas state, transcript ring, and subscriber list. An observer of the voice
    loop, never a controller — the wiring in app.py calls into it; it calls nothing back."""

    def __init__(
        self,
        clock: Callable[[], datetime] = _utcnow,
        ring_size: int = DEFAULT_RING,
        voice: str | None = None,
    ) -> None:
        self._clock = clock
        self.voice = voice  # set by the wiring from config active_voice; settable any time
        self._state = ASLEEP
        self._since = clock()
        self._session_id: str | None = None
        self._ring: deque[dict] = deque(maxlen=ring_size)
        self._subs: list[Callable] = []

    @property
    def state(self) -> str:
        return self._state

    @property
    def session_id(self) -> str | None:
        return self._session_id

    def start_session(self) -> str:
        """Mint a fresh wake-session id (one per wake). Returns the new id."""
        self._session_id = str(uuid.uuid4())
        return self._session_id

    def set_state(self, s: str) -> None:
        """Set the state; stamps `since` and emits ("state", s) only on a real change."""
        if s == self._state:
            return
        self._state = s
        self._since = self._clock()
        self._emit(("state", s))

    def add_line(self, role: str, text: str) -> None:
        """Append a final transcript line to the ring and emit ("line", {...})."""
        line = {"t": self._clock().isoformat(), "role": role, "text": text}
        self._ring.append(line)
        self._emit(("line", line))

    def subscribe(self, fn: Callable) -> None:
        self._subs.append(fn)

    def unsubscribe(self, fn: Callable) -> None:
        try:
            self._subs.remove(fn)
        except ValueError:
            pass

    def snapshot(self) -> dict:
        """The design §3 snapshot MINUS `heartbeat` (the HTTP layer stamps it at request
        time) and MINUS `filed_cards` (Task 9 adds it)."""
        return {
            "version": SNAPSHOT_VERSION,
            "state": self._state,
            "since": self._since.isoformat(),
            "session_id": self._session_id,
            "voice": self.voice,
            "transcript": list(self._ring),
        }

    def _emit(self, event: tuple) -> None:
        # Iterate a copy so a subscriber that (un)subscribes during delivery can't corrupt
        # the walk. A raising subscriber is logged and skipped — the publisher and the other
        # subscribers are unaffected.
        for fn in list(self._subs):
            try:
                fn(event)
            except Exception:
                logger.exception("atlas state subscriber raised; skipping")
