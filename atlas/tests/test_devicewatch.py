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
        def __init__(self, probe, on_change, period_s, initial_delay_s=0.0):
            self.on_change = on_change
            self.initial_delay_s = initial_delay_s
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
        watcher_cls=None, follower_cls=None, probe=lambda: ("id-A", "Realtek"))
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


def test_first_swap_open_failure_falls_back_to_boot_seed():
    """Review finding #2: initial_idx seeds the reopen-previous net for the very first swap."""
    console = FakeConsole(fail_speaker_on={4})
    sd = FakeSd()
    f = devicewatch.OutputFollower(
        console, wake_input_substring="Intel",
        resolve_output=lambda s, devices=None: 4,
        resolve_input=lambda s, devices=None: 7,
        sd_module=sd, initial_idx=5)
    status = f.swap_to("Px7 S2e")
    assert console.calls[-1] == ("spk", True, 5)   # boot device reopened
    assert status["resolved"] == "dev-5"


def test_watcher_initial_delay_defers_first_poll():
    """Review finding #1: no poll (hence no swap) before initial_delay_s elapses."""
    polls = []
    w = devicewatch.DeviceWatcher(
        probe=lambda: (polls.append(1), ("id-A", "Realtek"))[1],
        on_change=lambda n: None, period_s=0.01, initial_delay_s=0.2)
    w.start()
    time.sleep(0.05)
    early = len(polls)
    time.sleep(0.4)
    w.stop()
    assert early == 0          # nothing polled inside the grace window
    assert len(polls) > 0      # polling began after it
