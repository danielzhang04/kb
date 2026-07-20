from worker.engagement import Engagement

def test_wake_engages_and_silence_timeout_sleeps():
    t = [0.0]
    e = Engagement(timeout_s=15, clock=lambda: t[0])
    assert e.state == "ASLEEP"
    e.wake();            assert e.state == "ENGAGED"
    t[0] = 10; e.heard_speech()               # speech resets the silence clock
    t[0] = 24; assert e.tick() == "ENGAGED"   # only 14s of silence
    t[0] = 26; assert e.tick() == "ASLEEP"    # 16s of silence -> timeout

def test_dismiss_is_immediate():
    e = Engagement(timeout_s=15, clock=lambda: 0.0)
    e.wake(); e.dismiss()
    assert e.state == "ASLEEP"

def test_tick_while_asleep_stays_asleep():
    e = Engagement(timeout_s=15, clock=lambda: 99.0)
    assert e.tick() == "ASLEEP"


def test_resolve_input_device_pins_by_substring():
    from worker.wakeword import resolve_input_device
    devices = [
        {"name": "Headset (AirPods)", "max_input_channels": 1},
        {"name": "Speakers (out only)", "max_input_channels": 0},
        {"name": "Microphone Array (Intel Smart Sound)", "max_input_channels": 4},
    ]
    assert resolve_input_device("intel", devices) == 2
    assert resolve_input_device("Speakers", devices) is None  # output-only never matches
    assert resolve_input_device(None, devices) is None
    assert resolve_input_device("nope", devices) is None


def test_is_dismiss_phrases():
    from worker.app import _is_dismiss
    phrases = ["that's all", "go to sleep", "thanks atlas", "thank you atlas"]
    assert _is_dismiss("That's all.", phrases)
    assert _is_dismiss("thats all", phrases)          # Deepgram may drop the apostrophe
    assert _is_dismiss("Thanks, Atlas!", phrases)
    assert _is_dismiss("Go to sleep", phrases)
    assert not _is_dismiss("that's all I know about it", phrases)
    assert not _is_dismiss("what's in the queue?", phrases)
