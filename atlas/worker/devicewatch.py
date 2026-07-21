"""TTS output-follow watcher (design docs/specs/2026-07-21-atlas-output-follow-design.md).

Polls the Windows default OUTPUT endpoint via pycaw/COM every ~1.5s and fires a callback
with the new endpoint's FriendlyName when the endpoint ID changes. Polling (not
IMMNotificationClient callbacks) is deliberate: COM apartment threading + asyncio callback
plumbing is fragile, and a 1.5s cadence is imperceptible for a human plugging in headphones.

The watcher knows nothing about livekit or sounddevice — it produces NAMES; the swap
orchestration (Task 2) turns names into stream moves. decide() is the pure decision seam."""
from __future__ import annotations

import logging
import threading

logger = logging.getLogger("atlas.devicewatch")


def decide(prev_id: str | None, current_id: str | None) -> str:
    """'baseline' on first sighting, 'swap' on an id CHANGE after baseline, else 'none'.

    A None current_id means the probe failed (COM hiccup, no endpoint) — never a change.
    The first real sighting is a baseline, not a swap: livekit already opened the output
    stream on the boot-time default, so the boot device is correct by construction."""
    if current_id is None:
        return "none"
    if prev_id is None:
        return "baseline"
    return "swap" if current_id != prev_id else "none"


def current_default_output():
    """(endpoint_id, friendly_name) of the Windows default render endpoint, or None.

    pycaw's GetSpeakers() returns the default eRender/eMultimedia IMMDevice — the exact
    endpoint Windows moves when Bluetooth headphones connect. Endpoint IDs are stable and
    unique; FriendlyName matches PortAudio's device-name strings closely enough for the
    existing substring resolver. Any COM failure -> None (the watcher treats it as a
    failed poll, never a change)."""
    try:
        from pycaw.utils import AudioUtilities
        device = AudioUtilities.GetSpeakers()
        wrapped = AudioUtilities.CreateDevice(device)
        if wrapped is None or not wrapped.id:
            return None
        return wrapped.id, (wrapped.FriendlyName or "")
    except Exception:
        logger.debug("default-output probe failed", exc_info=True)
        return None


class DeviceWatcher:
    """Daemon thread: poll `probe`, run decide(), fire `on_change(name)` on swaps.

    `probe` returns (endpoint_id, name) or None/raises; both count as a failed poll.
    COM must be initialized per-thread, so the thread body CoInitializes when comtypes is
    present (tests inject pure-python probes and never touch COM)."""

    def __init__(self, probe, on_change, period_s: float = 1.5):
        self._probe = probe
        self._on_change = on_change
        self._period_s = period_s
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="atlas-devicewatch", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5.0)

    def _run(self) -> None:
        try:
            import comtypes
            comtypes.CoInitialize()
        except Exception:
            pass  # pure-python probes (tests) need no COM
        prev_id: str | None = None
        while not self._stop.is_set():
            current = None
            try:
                current = self._probe()
            except Exception:
                logger.debug("device probe raised", exc_info=True)
            cur_id, cur_name = current if current else (None, None)
            action = decide(prev_id, cur_id)
            if action == "baseline":
                prev_id = cur_id
            elif action == "swap":
                prev_id = cur_id
                try:
                    self._on_change(cur_name)
                except Exception:
                    # The swap layer logs its own CRITICALs; this guard only keeps the
                    # watcher alive if it raised unexpectedly.
                    logger.exception("on_change callback raised")
            self._stop.wait(self._period_s)
