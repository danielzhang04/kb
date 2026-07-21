# Atlas TTS Output-Follow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atlas TTS output hot-follows the Windows default output device (headphones/AirPods/speakers) with no worker reboot; wake input stays pinned.

**Architecture:** A COM-polling watcher thread (`worker/devicewatch.py`) detects default-endpoint changes by endpoint ID and hands the new endpoint's FriendlyName to a swap function that pre-validates, then calls livekit's own `AgentsConsole.get_instance().set_speaker_enabled(True, device=idx)` hot-reopen primitive. `app.py` wires it behind a `tts_output_device: follow` config sentinel and mirrors every move into `/state`.

**Tech Stack:** Python 3.12, pytest, sounddevice, pycaw+comtypes (new deps), livekit-agents console internals (`livekit.agents.cli._legacy.AgentsConsole` — private module, import-guarded).

**Spec:** `docs/specs/2026-07-21-atlas-output-follow-design.md` (approved). Read it first.

## Global Constraints

- Worktree: `C:/Users/danie/kb-worktrees/atlas`, branch `claude/atlas-voice-rules`. All commands from `C:/Users/danie/kb-worktrees/atlas/atlas`. Test runner: `.venv/Scripts/python -m pytest -q`.
- Baseline suite is **165 passed** — it must never drop below that; new tests only add.
- The running pm2 `atlas-worker` is STOPPED or running old code — NEVER touch pm2 or any process.
- Follow style of existing seams (`_apply_agent_state`, `_silence_decision`): pure functions/classes with injected collaborators, tested without real audio/COM.
- `tts_output_device: follow` is the sentinel (exact lowercase string). Any other non-empty string = existing static-pin behavior, byte-identical.
- Never a silent wrong-device swap: every failure path logs CRITICAL and `/state` reflects the stream's actual device.
- Commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Do NOT push until the final task says so.

---

### Task 1: Change detection — `decide()` + endpoint probe + watcher thread

**Files:**
- Create: `atlas/worker/devicewatch.py`
- Test: `atlas/tests/test_devicewatch.py`

**Interfaces:**
- Produces: `decide(prev_id, current_id) -> str` returning one of `"baseline" | "none" | "swap"`; `current_default_output() -> tuple[str, str] | None` (endpoint_id, friendly_name); `DeviceWatcher(probe, on_change, period_s=1.5)` thread class with `.start()`/`.stop()`; module logger named `"atlas.devicewatch"`.

- [x] **Step 1: Write the failing tests for `decide()` and the watcher shell**

```python
# atlas/tests/test_devicewatch.py
"""Output-follow watcher (design docs/specs/2026-07-21-atlas-output-follow-design.md).

decide() is the pure seam: first observation is a baseline (never a swap — the boot
device is already correct because livekit opened on the boot-time default); only a
CHANGE of endpoint id after baseline triggers a swap. COM errors are absorbed by the
probe returning None — the watcher counts and continues, it never dies."""
import threading
import time

from worker import devicewatch


def test_decide_first_observation_is_baseline_not_swap():
    assert devicewatch.decide(None, "id-A") == "baseline"


def test_decide_same_id_is_no_action():
    assert devicewatch.decide("id-A", "id-A") == "none"


def test_decide_changed_id_is_swap():
    assert devicewatch.decide("id-A", "id-B") == "swap"


def test_decide_probe_failure_is_no_action():
    # Probe returned nothing (COM error) — never treat as a change.
    assert devicewatch.decide("id-A", None) == "none"
    assert devicewatch.decide(None, None) == "none"


def test_watcher_fires_on_change_only_with_name():
    """Thread shell: injected probe sequence A, A, B -> exactly one on_change('Px7')."""
    seq = [("id-A", "Realtek"), ("id-A", "Realtek"), ("id-B", "Px7")]
    calls = []
    fired = threading.Event()

    def probe():
        return seq.pop(0) if seq else ("id-B", "Px7")

    def on_change(name):
        calls.append(name)
        fired.set()

    w = devicewatch.DeviceWatcher(probe=probe, on_change=on_change, period_s=0.01)
    w.start()
    assert fired.wait(timeout=2.0)
    w.stop()
    assert calls == ["Px7"]


def test_watcher_survives_probe_exception():
    """A probe that raises must not kill the thread; the next good poll still works."""
    seq = ["boom", ("id-A", "Realtek"), ("id-B", "Px7")]
    calls = []
    fired = threading.Event()

    def probe():
        item = seq.pop(0) if seq else ("id-B", "Px7")
        if item == "boom":
            raise OSError("COM says no")
        return item

    w = devicewatch.DeviceWatcher(probe=probe, on_change=lambda n: (calls.append(n), fired.set()), period_s=0.01)
    w.start()
    assert fired.wait(timeout=2.0)
    w.stop()
    assert calls == ["Px7"]
```

- [x] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_devicewatch.py -q`
Expected: FAIL / ERROR with `ModuleNotFoundError: No module named 'worker.devicewatch'` (or ImportError).

- [x] **Step 3: Implement `devicewatch.py`**

```python
# atlas/worker/devicewatch.py
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
```

- [x] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest tests/test_devicewatch.py -q`
Expected: `6 passed`

- [x] **Step 5: Commit**

```bash
git add worker/devicewatch.py tests/test_devicewatch.py
git commit -m "feat(atlas): devicewatch — default-output change detection seam + watcher thread

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Swap orchestration — pre-validated hot-swap with reopen-previous fallback

**Files:**
- Modify: `atlas/worker/devicewatch.py` (append)
- Test: `atlas/tests/test_devicewatch.py` (append)

**Interfaces:**
- Consumes: `wakeword.resolve_output_device(substring, devices=None) -> int | None`, `wakeword.resolve_input_device(substring, devices=None) -> int | None` (existing).
- Produces: `class OutputFollower` with `swap_to(name) -> dict` returning the new `/state`-shaped status `{"configured": "follow", "resolved": <name or None>, "following": True}`; constructor `OutputFollower(console, *, wake_input_substring, resolve_output, resolve_input, sd_module, lock=None)`. `console` needs `.set_speaker_enabled(enable, *, device)` and `.set_microphone_enabled(enable, *, device)`. Task 4 constructs it with the real livekit singleton.

- [x] **Step 1: Write the failing tests**

```python
# append to atlas/tests/test_devicewatch.py
class FakeConsole:
    def __init__(self, fail_speaker_on=None):
        self.calls = []                     # ("spk"|"mic", enable, device)
        self.fail_speaker_on = fail_speaker_on or set()

    def set_speaker_enabled(self, enable, *, device=None):
        self.calls.append(("spk", enable, device))
        if enable and device in self.fail_speaker_on:
            raise RuntimeError(f"cannot open {device}")

    def set_microphone_enabled(self, enable, *, device=None):
        self.calls.append(("mic", enable, device))


class FakeSd:
    """query_devices(idx, kind=...) raises for indices in `bad`; _terminate/_initialize counted."""
    def __init__(self, bad=None):
        self.bad = bad or set()
        self.reinits = 0

    def query_devices(self, idx=None, kind=None):
        if idx in self.bad:
            raise ValueError(f"no device {idx}")
        return {"name": f"dev-{idx}"}

    def _terminate(self):
        self.reinits += 1

    def _initialize(self):
        pass


def _follower(console, sd, resolve_out, resolve_in=lambda s, devices=None: 7):
    return devicewatch.OutputFollower(
        console, wake_input_substring="Intel",
        resolve_output=resolve_out, resolve_input=resolve_in, sd_module=sd)


def test_swap_common_path_opens_new_device():
    console, sd = FakeConsole(), FakeSd()
    f = _follower(console, sd, resolve_out=lambda s, devices=None: 5)
    status = f.swap_to("Speakers (Realtek(R) Audio)")
    assert ("spk", True, 5) in console.calls
    assert sd.reinits == 0
    assert status == {"configured": "follow", "resolved": "dev-5", "following": True}


def test_swap_unmatched_name_triggers_rare_path_reinit():
    """Name not in the PA snapshot -> full audio reinit, then resolve again and open."""
    console, sd = FakeConsole(), FakeSd()
    attempts = {"n": 0}

    def resolve_out(s, devices=None):
        attempts["n"] += 1
        return None if attempts["n"] == 1 else 9   # found only after reinit

    f = _follower(console, sd, resolve_out=resolve_out)
    status = f.swap_to("Px7 S2e")
    assert sd.reinits == 1
    # ordering: streams closed, reinit, mic reopened on pin, speaker opened on new device
    assert console.calls == [
        ("mic", False, None), ("spk", False, None),
        ("mic", True, 7), ("spk", True, 9),
    ]
    assert status["resolved"] == "dev-9"


def test_swap_still_unmatched_after_reinit_keeps_previous_and_reports_null():
    console, sd = FakeConsole(), FakeSd()
    f = _follower(console, sd, resolve_out=lambda s, devices=None: None)
    f._last_idx = 5                                  # a previous device is open
    status = f.swap_to("Ghost Device")
    assert sd.reinits == 1
    # after failed reinit-resolve: mic re-pinned, previous speaker reopened — never deaf
    assert ("spk", True, 5) in console.calls
    assert status["resolved"] is None


def test_swap_open_failure_reopens_previous_device():
    console = FakeConsole(fail_speaker_on={4})
    sd = FakeSd()
    f = _follower(console, sd, resolve_out=lambda s, devices=None: 4)
    f._last_idx = 5
    status = f.swap_to("Px7 S2e")
    assert ("spk", True, 4) in console.calls        # attempted
    assert console.calls[-1] == ("spk", True, 5)    # recovered
    assert status["resolved"] == "dev-5"


def test_swap_prevalidation_failure_keeps_current_stream_untouched():
    console = FakeConsole()
    sd = FakeSd(bad={4})
    f = _follower(console, sd, resolve_out=lambda s, devices=None: 4)
    f._last_idx = 5
    status = f.swap_to("Px7 S2e")
    assert console.calls == []                      # stream never touched
    assert status["resolved"] == "dev-5"
```

- [x] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_devicewatch.py -q`
Expected: FAIL with `AttributeError: ... has no attribute 'OutputFollower'`

- [x] **Step 3: Implement `OutputFollower` (append to `devicewatch.py`)**

```python
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
```

The tests are the contract — if code and tests disagree, fix the code, never weaken the tests.

- [x] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest tests/test_devicewatch.py -q`
Expected: `11 passed`

- [x] **Step 5: Commit**

```bash
git add worker/devicewatch.py tests/test_devicewatch.py
git commit -m "feat(atlas): OutputFollower — pre-validated hot-swap with reopen-previous fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Config sentinel + `/state` `following` field

**Files:**
- Modify: `atlas/worker/app.py:162-178` (`_output_device_status`)
- Modify: `atlas/worker/app.py` (`_console_output_args`, ~line 578)
- Modify: `atlas/config/atlas.yaml` (the `tts_output_device` block)
- Test: `atlas/tests/test_state.py` (append), `atlas/tests/test_engagement.py` untouched

**Interfaces:**
- Consumes: nothing new.
- Produces: `_output_device_status(cfg, resolve=...)` now returns a third key `following: bool`; in follow mode `{"configured": "follow", "resolved": <boot default name or None>, "following": True}`. `_console_output_args` returns `[]` in follow mode (livekit opens on the boot default — correct by construction). `FOLLOW_SENTINEL = "follow"` module constant in `app.py`.

- [x] **Step 1: Write the failing tests (append to `atlas/tests/test_state.py`)**

```python
def test_output_device_status_follow_mode_reports_following():
    from worker import app
    status = app._output_device_status(
        {"tts_output_device": "follow"},
        resolve=lambda s, devices=None: (_ for _ in ()).throw(AssertionError("must not resolve in follow mode")),
        boot_default=lambda: "Headphones (Px7 S2e)")
    assert status == {"configured": "follow", "resolved": "Headphones (Px7 S2e)", "following": True}


def test_output_device_status_pin_mode_reports_not_following():
    from worker import app
    status = app._output_device_status(
        {"tts_output_device": "Speakers (Realtek"}, resolve=lambda s, devices=None: 5)
    assert status["following"] is False
    assert status["configured"] == "Speakers (Realtek"


def test_console_output_args_follow_mode_passes_no_flag():
    from worker import app
    out = app._console_output_args(["worker.app", "console"], {"tts_output_device": "follow"},
                                   resolve=lambda s, devices=None: 5)
    assert out == []
```

- [x] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_state.py -q`
Expected: new tests FAIL (`boot_default` unexpected keyword / missing `following` key). Pre-existing tests in the file must still pass.

- [x] **Step 3: Implement**

In `app.py`, add near the top-level constants: `FOLLOW_SENTINEL = "follow"`. Replace `_output_device_status`:

```python
def _boot_default_output_name() -> str | None:
    """Name of the output device livekit opened at boot (PortAudio's boot-time default)."""
    try:
        import sounddevice as sd
        return sd.query_devices(sd.default.device[1])["name"]
    except Exception:
        return None


def _output_device_status(cfg: dict, resolve=wakeword.resolve_output_device,
                          boot_default=_boot_default_output_name) -> dict:
    """{'configured', 'resolved', 'following'} for the TTS output, surfaced in GET /state (M4).

    Three modes: absent (system default, not following), a name substring (static pin,
    unchanged since 2026-07-21), or the sentinel 'follow' (output-follow design: the
    watcher moves the stream when the Windows default endpoint changes; `resolved` is
    updated live by the follower and starts as the boot default)."""
    configured = cfg.get("tts_output_device")
    if not configured:
        return {"configured": None, "resolved": None, "following": False}
    if configured == FOLLOW_SENTINEL:
        return {"configured": FOLLOW_SENTINEL, "resolved": boot_default(), "following": True}
    idx = resolve(configured)
    if idx is None:
        return {"configured": configured, "resolved": None, "following": False}
    try:
        import sounddevice as sd
        name = sd.query_devices(idx)["name"]
    except Exception:
        name = str(idx)
    return {"configured": configured, "resolved": name, "following": False}
```

In `_console_output_args`, after the `substring = cfg.get("tts_output_device")` / `if not substring: return []` lines, add:

```python
    if substring == FOLLOW_SENTINEL:
        # Output-follow mode: pass no flag. livekit opens on the boot-time default, which
        # IS the current Windows default at start; the devicewatch follower moves the
        # stream afterward (docs/specs/2026-07-21-atlas-output-follow-design.md).
        return []
```

In `atlas/config/atlas.yaml`, replace the `tts_output_device: Speakers (Realtek` line (keep the comment block above it, append to it):

```yaml
# 2026-07-21 (late): `follow` = output-follow mode (docs/specs/2026-07-21-atlas-output-follow-design.md):
# TTS hot-follows the Windows default output (headphones connect -> TTS moves there, disconnect ->
# back to speakers) with no worker restart. Any other string = static substring pin as before
# (e.g. `Speakers (Realtek`). The wake INPUT stays pinned regardless — BT hands-free mics are unusable.
tts_output_device: follow
```

- [x] **Step 4: Run the full suite**

Run: `.venv/Scripts/python -m pytest -q`
Expected: `168 passed` (165 baseline − 0 broken + 3 new here; Tasks 1-2 added 11 more → running total 179 if run after them — the number that matters: **0 failed**). If any pre-existing `_output_device_status` test asserts the two-key shape, update it to expect `following: False` — that is a legitimate contract change, note it in the commit.

- [x] **Step 5: Commit**

```bash
git add worker/app.py config/atlas.yaml tests/test_state.py
git commit -m "feat(atlas): tts_output_device 'follow' sentinel + /state following field

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the watcher into the worker (`app.py` entrypoint + main)

**Files:**
- Modify: `atlas/worker/app.py` (entrypoint, after `publisher.set_output_device(...)` at ~line 261; and imports)
- Test: `atlas/tests/test_devicewatch.py` (append)

**Interfaces:**
- Consumes: Task 1 `DeviceWatcher`, `current_default_output`; Task 2 `OutputFollower`; Task 3 `FOLLOW_SENTINEL`, `_output_device_status`.
- Produces: `_start_output_follow(cfg, publisher, *, console_factory, watcher_cls, follower_cls, probe) -> DeviceWatcher | None` — a pure wiring seam in `app.py` that returns the started watcher in follow mode, `None` otherwise.

- [ ] **Step 1: Write the failing tests (append to `atlas/tests/test_devicewatch.py`)**

```python
def test_start_output_follow_not_in_follow_mode_returns_none():
    from worker import app

    class NoPublisher:
        def set_output_device(self, s):
            raise AssertionError("must not publish when not following")

    got = app._start_output_follow(
        {"tts_output_device": "Speakers (Realtek"}, NoPublisher(),
        console_factory=lambda: (_ for _ in ()).throw(AssertionError("no console needed")),
        watcher_cls=None, follower_cls=None, probe=None)
    assert got is None


def test_start_output_follow_wires_swap_to_publisher():
    from worker import app

    published = []

    class Publisher:
        def set_output_device(self, s):
            published.append(s)

    class FakeWatcher:
        def __init__(self, probe, on_change, period_s):
            self.on_change = on_change
            self.started = False

        def start(self):
            self.started = True

    class FakeFollower:
        def __init__(self, console, **kw):
            pass

        def swap_to(self, name):
            return {"configured": "follow", "resolved": name, "following": True}

    w = app._start_output_follow(
        {"tts_output_device": "follow", "wake_input_device": "Intel"}, Publisher(),
        console_factory=lambda: object(),
        watcher_cls=FakeWatcher, follower_cls=FakeFollower,
        probe=lambda: ("id-A", "Realtek"))   # healthy probe: passes the startup self-check
    assert w is not None and w.started
    w.on_change("Px7 S2e")               # simulate a detected change
    assert published[-1] == {"configured": "follow", "resolved": "Px7 S2e", "following": True}


def test_start_output_follow_console_unavailable_degrades_loudly():
    from worker import app

    published = []

    class Publisher:
        def set_output_device(self, s):
            published.append(s)

    got = app._start_output_follow(
        {"tts_output_device": "follow"}, Publisher(),
        console_factory=lambda: (_ for _ in ()).throw(ImportError("no _legacy console")),
        watcher_cls=None, follower_cls=None, probe=None)
    assert got is None
    assert published and published[-1]["following"] is False   # /state tells the truth


def test_start_output_follow_dead_probe_degrades_loudly():
    """Spec: pycaw missing/broken with follow configured -> CRITICAL + following:false.
    A probe that can't see the default endpoint at STARTUP means the watcher would silently
    never fire while /state claims following:true — the startup self-check prevents that lie."""
    from worker import app

    published = []

    class Publisher:
        def set_output_device(self, s):
            published.append(s)

    got = app._start_output_follow(
        {"tts_output_device": "follow"}, Publisher(),
        console_factory=lambda: object(),
        watcher_cls=None, follower_cls=None, probe=lambda: None)
    assert got is None
    assert published and published[-1]["following"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_devicewatch.py -q`
Expected: FAIL with `AttributeError: module 'worker.app' has no attribute '_start_output_follow'`

- [ ] **Step 3: Implement in `app.py`**

Add import near the other worker imports: `from worker import devicewatch`.

Add the wiring seam (place it next to `_output_device_status`):

```python
def _console_singleton():
    """The live console object whose set_speaker_enabled hot-reopens the output stream.

    livekit.agents.cli._legacy is a PRIVATE module (import-guarded here): AgentsConsole is a
    singleton (get_instance, _legacy.py:285-293) and set_speaker_enabled (:597) is the same
    close-and-reopen primitive livekit's own console UI calls (:1441). If a livekit upgrade
    moves it, _start_output_follow degrades loudly instead of crashing the worker."""
    from livekit.agents.cli._legacy import AgentsConsole
    return AgentsConsole.get_instance()


def _start_output_follow(cfg: dict, publisher, *,
                         console_factory=_console_singleton,
                         watcher_cls=devicewatch.DeviceWatcher,
                         follower_cls=devicewatch.OutputFollower,
                         probe=devicewatch.current_default_output):
    """Start the output-follow watcher when configured; returns it, or None (pin/absent mode).

    Failure to reach the console (livekit internals moved, pycaw missing) is loud-but-running:
    CRITICAL log + /state shows following:false with the boot default — design 'fail loud,
    run anyway'."""
    if cfg.get("tts_output_device") != FOLLOW_SENTINEL:
        return None
    # Startup self-check (spec 'Dependencies'): a dead probe (pycaw missing, COM broken)
    # means the watcher would silently never fire — refuse to claim following:true.
    probe_ok = False
    try:
        probe_ok = probe() is not None
    except Exception:
        pass
    if not probe_ok:
        logger.critical(
            "output-follow configured but the default-endpoint probe returned nothing "
            "(pycaw/comtypes missing or COM failure) — TTS stays on the boot default and "
            "will NOT follow device changes. `pip install pycaw comtypes` into the worker venv.")
        publisher.set_output_device(
            {"configured": FOLLOW_SENTINEL, "resolved": _boot_default_output_name(),
             "following": False})
        return None
    try:
        console = console_factory()
    except Exception:
        logger.critical(
            "output-follow configured but the console audio object is unavailable — TTS stays "
            "on the boot default and will NOT follow device changes", exc_info=True)
        publisher.set_output_device(
            {"configured": FOLLOW_SENTINEL, "resolved": _boot_default_output_name(),
             "following": False})
        return None
    import sounddevice as sd
    follower = follower_cls(
        console,
        wake_input_substring=cfg.get("wake_input_device"),
        resolve_output=wakeword.resolve_output_device,
        resolve_input=wakeword.resolve_input_device,
        sd_module=sd)

    def _on_change(name: str) -> None:
        publisher.set_output_device(follower.swap_to(name))

    watcher = watcher_cls(probe=probe, on_change=_on_change, period_s=1.5)
    watcher.start()
    logger.info("TTS output-follow active: tracking the Windows default output device")
    return watcher
```

In `entrypoint`, immediately after `publisher.set_output_device(_output_device_status(cfg))` (~line 261), add:

```python
    # Output-follow (design 2026-07-21): when tts_output_device is 'follow', a watcher thread
    # tracks the Windows default output endpoint and hot-moves the TTS stream — headphones
    # connect, Atlas speaks there; disconnect, back to the speakers. No restart.
    _start_output_follow(cfg, publisher)
```

- [ ] **Step 4: Run the full suite**

Run: `.venv/Scripts/python -m pytest -q`
Expected: **0 failed** (running total ~182 passed).

- [ ] **Step 5: Commit**

```bash
git add worker/app.py tests/test_devicewatch.py
git commit -m "feat(atlas): wire output-follow watcher into the worker entrypoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Dependencies, venv install, final gate, push

**Files:**
- Modify: `atlas/requirements.txt`

**Interfaces:** none new.

- [ ] **Step 1: Add the dependencies**

Append to `atlas/requirements.txt`:

```
comtypes>=1.4      # COM plumbing for pycaw (output-follow watcher, 2026-07-21 design)
pycaw>=20240210    # Windows Core Audio default-endpoint probe (devicewatch.current_default_output)
```

- [ ] **Step 2: Install into the worker venv**

Run: `.venv/Scripts/python -m pip install pycaw comtypes`
Expected: both install cleanly (pure-Python wheels).

- [ ] **Step 3: Prove the real probe works on this machine**

Run: `.venv/Scripts/python -c "from worker.devicewatch import current_default_output; print(current_default_output())"`
Expected: a tuple like `('{0.0.0.00000000}...', 'Headphones (Px7 S2e)')` or the Realtek speakers — NOT None. If None, debug before proceeding (the watcher would silently never fire).

- [ ] **Step 4: Full suite, one last time**

Run: `.venv/Scripts/python -m pytest -q`
Expected: **0 failed**, total ≥ 180.

- [ ] **Step 5: Commit and push**

```bash
git add requirements.txt
git commit -m "chore(atlas): pycaw + comtypes for the output-follow watcher

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

## Manual verification (Daniel, after worker restart — NOT part of this plan's execution)

1. `pm2 restart atlas-worker` (Daniel only).
2. `/state` shows `output_device: {configured: "follow", resolved: <current device>, following: true}`.
3. Connect Px7/AirPods → within ~3s TTS moves there (`/state` `resolved` updates). Disconnect → back to speakers.
4. Wake word still works throughout (mic stayed pinned to Intel).
