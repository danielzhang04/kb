"""Card-completion callbacks: watch voice-filed cards until they finish (design §8, Task 11).

When Atlas files a card by voice, app.py's post-file hook chains `DoneWatcher.watch(id, action)`.
`DoneWatcher` persists those ids to a small JSON sidecar (`%USERPROFILE%\\.atlas\\watched.json` by
default, resolved via `Path.home()`) so a worker restart doesn't orphan them. On each `poll()` it
pull-rebases the ops worktree, scans the queue state dirs for the watched ids, and returns a
spoken `Announcement` for any that reached a terminal state. Announced ids are removed from the
sidecar. app.py owns the timer (an event-loop task that polls only while the sidecar is non-empty)
and the speaking (ENGAGED -> inline `session.say`; ASLEEP + `announce_when_asleep` -> a one-shot
say WITHOUT opening STT).

Terminal-state facts, verified against `scripts/cards.py` (STATES + LEGAL, where a state whose
LEGAL target set is empty is terminal):
  - `done`     -> SUCCESS.
  - `rejected` -> FAILURE (an approval was rejected; physically lives in queue/done/).
  - `halted`   -> FAILURE (the stop-ladder terminal state; physically lives in queue/working/).
Every other state (`inbox`, `blocked`, `working`, `approvals`, `approved`, `stop-requested`,
`halting`) is still pending — the watch is retained, no announcement.

Pure logic + local file/git IO through the injected `gitseam` runner (tests: a fake no-network
runner + an on-disk queue built with the real card schema). No voice-stack imports here.
"""
import json
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

# The card parser/schema lives in scripts/ (same access pattern as kbmcp.kb_tools) so the watcher
# reads real card state, never hand-parsed frontmatter.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import cards as kb_cards  # noqa: E402

from worker import gitseam  # noqa: E402

logger = logging.getLogger("atlas.donewatcher")

OPS_REMOTE = "origin"
OPS_BRANCH = "ops"

# Terminal card states (see module docstring — verified against scripts/cards.py).
DONE_STATES = frozenset({"done"})
FAILURE_STATES = frozenset({"rejected", "halted"})

# A watched id that is NOWHERE in the queue is retained for a bounded number of CONSECUTIVE polls,
# then dropped SILENTLY (no announcement) so a permanently-missing card (deleted, or one that never
# landed) can't keep the poll timer alive forever. A card that IS found — even still pending —
# resets the miss counter, so a legitimately slow card is never dropped by this bound. At the
# default 30s watch period, MISS_LIMIT=40 is ~20 minutes of continuous absence.
MISS_LIMIT = 40

# Directories a card file can physically live in — the unique values of cards.STATE_DIR. A card's
# real state comes from its frontmatter (several states share a dir), so the scan parses the file.
_QUEUE_DIRS = ("inbox", "working", "done", "approvals")


@dataclass(frozen=True)
class Announcement:
    """A completion callback ready to speak. `outcome` is "success" | "failure"; `text` is a short
    speakable sentence built from the watch's spoken_label."""
    card_id: str
    outcome: str
    text: str


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DoneWatcher:
    def __init__(
        self,
        ops_root,
        sidecar_path=None,
        git_runner: Callable[[list, object], object] = gitseam.default_git_runner,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._ops_root = Path(ops_root)
        self._sidecar = (
            Path(sidecar_path) if sidecar_path is not None
            else Path.home() / ".atlas" / "watched.json"
        )
        self._git_runner = git_runner
        self._clock = clock  # kept for seam consistency; not used for time-of-day logic

    # --- sidecar persistence -----------------------------------------------------------------
    def _load(self) -> dict:
        """Read the sidecar as {card_id: {"spoken_label", "misses"}}. A missing or corrupt file
        reads as no watches (the watcher must never fail to start over a bad sidecar)."""
        try:
            data = json.loads(self._sidecar.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError, OSError):
            return {}
        return data if isinstance(data, dict) else {}

    def _save(self, watches: dict) -> None:
        self._sidecar.parent.mkdir(parents=True, exist_ok=True)
        self._sidecar.write_text(json.dumps(watches, ensure_ascii=False, indent=2), encoding="utf-8")

    def watch(self, card_id: str, spoken_label: str) -> None:
        """Persist a card to watch for completion (idempotent per id)."""
        watches = self._load()
        if card_id not in watches:
            watches[card_id] = {"spoken_label": spoken_label, "misses": 0}
            self._save(watches)

    def has_watches(self) -> bool:
        """Cheap check for the app.py timer: is there anything to poll? (a tiny local file read)."""
        return bool(self._load())

    # --- poll --------------------------------------------------------------------------------
    def poll(self) -> list["Announcement"]:
        """Pull-rebase the ops worktree, then scan the queue for each watched id. Returns an
        `Announcement` per card that reached a terminal state (and removes it from the sidecar);
        pending cards are retained. A pull failure yields NO announcements and retains every watch
        (design §8) — a transient git/network problem never loses a callback or fabricates one."""
        watches = self._load()
        if not watches:
            return []
        try:
            gitseam.run(self._git_runner, self._ops_root, ["pull", "--rebase", OPS_REMOTE, OPS_BRANCH])
        except Exception:
            logger.warning("donewatcher pull failed; retaining watches, no callbacks this cycle")
            return []

        announcements: list[Announcement] = []
        remaining: dict = {}
        for card_id, info in watches.items():
            label = info.get("spoken_label", card_id)
            card_state = self._card_state(card_id)
            if card_state in DONE_STATES:
                announcements.append(Announcement(
                    card_id, "success", f"The card to {label} is done."))
            elif card_state in FAILURE_STATES:
                announcements.append(Announcement(
                    card_id, "failure",
                    f"The card to {label} came back {card_state} — it didn't complete."))
            elif card_state is None:
                # Missing everywhere: retain, but bound so a permanent ghost can't poll forever.
                misses = int(info.get("misses", 0)) + 1
                if misses < MISS_LIMIT:
                    remaining[card_id] = {"spoken_label": label, "misses": misses}
                else:
                    logger.warning("donewatcher dropping card %s: not seen in queue after %d polls",
                                   card_id, misses)
            else:
                # Found but not terminal (pending) — retain and reset the miss counter.
                remaining[card_id] = {"spoken_label": label, "misses": 0}

        self._save(remaining)
        return announcements

    def _card_state(self, card_id: str) -> Optional[str]:
        """The card's real state from its frontmatter, or None if the id is nowhere in the queue.
        A found-but-unparseable card reads as pending (a sentinel), never as missing or terminal —
        a mid-write file must not fabricate a callback or be dropped as a ghost."""
        queue = self._ops_root / "queue"
        for d in _QUEUE_DIRS:
            path = queue / d / f"{card_id}.md"
            if path.is_file():
                try:
                    return kb_cards.parse(path).meta.get("state")
                except Exception:
                    logger.exception("donewatcher could not parse %s; treating as pending", path)
                    return "__unparseable__"
        return None
