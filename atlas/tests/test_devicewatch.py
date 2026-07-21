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
