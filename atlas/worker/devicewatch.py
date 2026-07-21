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


class OutputFollower:
    """Turns a new default-device NAME into a live output-stream move (design 'Swap orchestration').

    All collaborators injected: `console` is livekit's AgentsConsole (or a test fake) whose
    set_speaker_enabled CLOSES the old stream before opening the new one — which is why we
    pre-validate the candidate first and reopen the previous index if an open still fails:
    a failed swap must cost a blip, never deafness. `swap_to` returns the /state-shaped
    status so the caller can publish it without re-deriving anything."""

    def __init__(self, console, *, wake_input_substring, resolve_output, resolve_input,
                 sd_module, lock=None):
        self._console = console
        self._wake_input = wake_input_substring
        self._resolve_output = resolve_output
        self._resolve_input = resolve_input
        self._sd = sd_module
        self._lock = lock or threading.Lock()
        self._last_idx: int | None = None

    def _status(self, idx: int | None) -> dict:
        if idx is None:
            return {"configured": "follow", "resolved": None, "following": True}
        try:
            name = self._sd.query_devices(idx)["name"]
        except Exception:
            name = str(idx)
        return {"configured": "follow", "resolved": name, "following": True}

    def _reinit_audio(self) -> None:
        """Rare path: device absent from the boot PortAudio snapshot (first-ever pairing
        mid-session). Close BOTH streams, cycle PortAudio so it re-enumerates, re-pin the
        mic. Costs <1s of mic downtime — accepted in the design."""
        self._console.set_microphone_enabled(False)
        self._console.set_speaker_enabled(False)
        self._sd._terminate()
        self._sd._initialize()
        mic_idx = self._resolve_input(self._wake_input)
        self._console.set_microphone_enabled(True, device=mic_idx)

    def _open(self, idx: int) -> bool:
        try:
            self._console.set_speaker_enabled(True, device=idx)
            return True
        except Exception:
            logger.critical(
                "output swap: opening device %d failed after validation — reopening previous", idx,
                exc_info=True)
            return False

    def swap_to(self, name: str) -> dict:
        with self._lock:
            idx = self._resolve_output(name)
            if idx is None:
                # Not in the current snapshot -> rare path: refresh the snapshot and retry.
                self._reinit_audio()
                idx = self._resolve_output(name)
                if idx is None:
                    logger.critical(
                        "output follow: Windows default moved to %r but no PortAudio device "
                        "matches even after re-enumeration — keeping the previous output", name)
                    if self._last_idx is not None:
                        self._open(self._last_idx)
                    return self._status(None)
                if self._open(idx):
                    self._last_idx = idx
                    return self._status(idx)
                if self._last_idx is not None and self._open(self._last_idx):
                    return self._status(self._last_idx)
                return self._status(None)
            # Common path: pre-validate (set_speaker_enabled tears down BEFORE opening).
            try:
                self._sd.query_devices(idx, kind="output")
            except Exception:
                logger.critical(
                    "output follow: candidate device %d (%r) failed validation — keeping the "
                    "previous output", idx, name)
                return self._status(self._last_idx)
            if self._open(idx):
                self._last_idx = idx
                return self._status(idx)
            if self._last_idx is not None and self._open(self._last_idx):
                return self._status(self._last_idx)
            logger.critical("output follow: could not reopen ANY output device — TTS is deaf")
            return self._status(None)
