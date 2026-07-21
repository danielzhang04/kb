from worker.engagement import Engagement

def test_wake_engages_and_silence_timeout_sleeps():
    t = [0.0]
    e = Engagement(timeout_s=15, clock=lambda: t[0])
    assert e.state == "ASLEEP"
    e.wake();            assert e.state == "ENGAGED"
    t[0] = 10; e.interacted()                 # a directed interaction resets the silence clock
    t[0] = 24; assert e.tick() == "ENGAGED"   # only 14s of silence
    t[0] = 26; assert e.tick() == "ASLEEP"    # 16s of silence -> timeout

def test_ambient_speech_does_not_reopen_the_window():
    # Regression (Bug, 2026-07-21): while ENGAGED the mic streams the whole room to STT, so
    # background chatter is transcribed continuously. Those transcripts must NOT re-open the
    # silence window — only a directed interaction (interacted()) does. With no interacted()
    # calls after wake (the room is talking but Atlas is not part of it), Atlas MUST sleep exactly
    # timeout_s after wake, no matter how much ambient speech was transcribed.
    t = [0.0]
    e = Engagement(timeout_s=120, clock=lambda: t[0])
    e.wake()
    t[0] = 119; assert e.tick() == "ENGAGED"  # still within the 2-min window from wake
    t[0] = 121; assert e.tick() == "ASLEEP"   # slept 2 min after wake despite the noisy room

def test_atlas_reply_reopens_the_window():
    # Counterpart: Atlas actually speaking (wired to SPEAKING onset -> interacted()) is a real
    # interaction and DOES re-open the window, so an active back-and-forth stays awake.
    t = [0.0]
    e = Engagement(timeout_s=120, clock=lambda: t[0])
    e.wake()
    t[0] = 110; e.interacted()                 # Atlas replied at t=110s
    t[0] = 200; assert e.tick() == "ENGAGED"   # 90s since the reply < 120s window
    t[0] = 231; assert e.tick() == "ASLEEP"    # 121s since the last reply -> timeout

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


def test_resolve_output_device_pins_by_substring():
    # Bug 2 (2026-07-21): the speaker analogue of resolve_input_device — matches OUTPUT devices only.
    from worker.wakeword import resolve_output_device
    devices = [
        {"name": "Speakers (Realtek High Definition Audio)", "max_output_channels": 2},
        {"name": "Microphone Array (Intel Smart Sound)", "max_output_channels": 0},
        {"name": "Headset Earphone (AirPods Hands-Free)", "max_output_channels": 2},
    ]
    assert resolve_output_device("speakers", devices) == 0
    assert resolve_output_device("airpods", devices) == 2
    assert resolve_output_device("Intel", devices) is None   # input-only never matches
    assert resolve_output_device(None, devices) is None
    assert resolve_output_device("nope", devices) is None


def test_console_output_args_pins_configured_speaker():
    # Bug 2: with tts_output_device set and an audio console running without an explicit
    # --output-device, the worker injects `--output-device <idx>` so TTS does not ride the
    # drifting system default. resolve is injected so the test needs no real audio hardware.
    from worker.app import _console_output_args
    cfg = {"tts_output_device": "Speakers"}
    assert _console_output_args(["app", "console"], cfg, resolve=lambda s: 3) == ["--output-device", "3"]


def test_console_output_args_respects_explicit_and_text_and_missing_config():
    from worker.app import _console_output_args
    cfg = {"tts_output_device": "Speakers"}
    boom = lambda s: (_ for _ in ()).throw(AssertionError("resolve must not be called"))
    # explicit --output-device already present -> leave it
    assert _console_output_args(["app", "console", "--output-device", "5"], cfg, resolve=boom) == []
    assert _console_output_args(["app", "console", "--output-device=5"], cfg, resolve=boom) == []
    # text mode / list-devices / non-console -> no audio to pin
    assert _console_output_args(["app", "console", "--text"], cfg, resolve=boom) == []
    assert _console_output_args(["app", "console", "--list-devices"], cfg, resolve=boom) == []
    assert _console_output_args(["app", "start"], cfg, resolve=boom) == []
    # no config key -> unchanged (system default)
    assert _console_output_args(["app", "console"], {}, resolve=boom) == []


def test_console_output_args_falls_back_loud_when_device_missing():
    # Configured device not found -> [] (system default) rather than a crash; resolve returns None
    # exactly as resolve_output_device does on no-match (which also logs a warning).
    from worker.app import _console_output_args
    cfg = {"tts_output_device": "NonexistentSpeaker"}
    assert _console_output_args(["app", "console"], cfg, resolve=lambda s: None) == []


# --- M3: wiring-level tests for the silence-clock re-stamp (2026-07-21) ---------------------------

def _engaged(timeout=120):
    """A woken Engagement plus its controllable clock list, for wiring assertions."""
    from worker.engagement import Engagement
    t = [0.0]
    e = Engagement(timeout_s=timeout, clock=lambda: t[0])
    e.wake()
    return e, t


def test_apply_agent_state_restamps_only_on_speaking():
    # The actual wiring (_on_agent_state body): SPEAKING re-opens the window; THINKING, LISTENING and
    # idle do NOT. "listening"/"idle" are the states a finished USER turn drives the agent into, so
    # this also proves raw user transcripts do not re-stamp. "speaking" is exactly the path a reflex
    # reply ("repeat that") takes, so the reflex-lane->SPEAKING->re-stamp path is covered too.
    from worker.app import _apply_agent_state
    from worker import state
    for agent_state, restamps in [("speaking", True), ("thinking", False),
                                  ("listening", False), ("idle", False)]:
        e, t = _engaged()
        pub = state.StatePublisher()
        t[0] = 50
        _apply_agent_state(e, pub, agent_state)
        t[0] = 170
        # re-stamped at 50 -> silence is 120s (== timeout, not >) -> ENGAGED; else 170s -> ASLEEP.
        assert (e.tick() == "ENGAGED") is restamps, agent_state


def test_apply_agent_state_is_noop_while_asleep():
    # Guard: agent chatter while ASLEEP (warm-up, the "Going to sleep." ack) must not re-stamp/wake.
    from worker.app import _apply_agent_state
    from worker.engagement import Engagement
    from worker import state
    e = Engagement(timeout_s=120, clock=lambda: 0.0)   # never woken -> ASLEEP
    _apply_agent_state(e, state.StatePublisher(), "speaking")
    assert e.state == "ASLEEP"


# --- M2: never sleep out from under an in-flight turn --------------------------------------------

def test_silence_decision_matrix():
    from worker.app import _silence_decision
    from worker import state
    assert _silence_decision(state.SPEAKING) == "restamp"
    assert _silence_decision(state.THINKING) == "defer"
    assert _silence_decision(state.LISTENING) == "check"
    assert _silence_decision(state.ASLEEP) == "check"


def _simulate_watcher(e, t, timeline):
    """Drive the _silence_watcher decision loop over [(time, orb_state), ...]; return True if a
    sleep would have fired."""
    from worker.app import _silence_decision
    slept = False
    for now, orb in timeline:
        t[0] = now
        d = _silence_decision(orb)
        if d == "restamp":
            e.interacted()
        elif d == "defer":
            continue
        elif e.tick() == "ASLEEP":
            slept = True
    return slept


def test_no_midturn_sleep_when_followup_lands_at_timeout():
    # Regression (M2): a follow-up question asked at t≈118s -> THINKING at the 120s tick. The watcher
    # must DEFER (not speak "Going to sleep." over the in-flight answer). Then Atlas answers ->
    # SPEAKING re-stamps.
    e, t = _engaged()
    e.interacted()  # Atlas's wake ack at t=0
    timeline = [(s, "LISTENING") for s in range(1, 118)]
    timeline += [(s, "THINKING") for s in range(118, 122)]   # user asked ~118s; LLM generating
    timeline += [(s, "SPEAKING") for s in range(122, 125)]   # Atlas answering
    assert _simulate_watcher(e, t, timeline) is False        # never slept mid-turn
    # sanity: WITHOUT the defer (old behavior) the 120/121s LISTENING ticks would have slept.
    assert e.state == "ENGAGED"


def test_no_sleep_during_long_utterance_and_full_window_after():
    # Regression (M2): a >120s TTS utterance must not sleep mid-speech (SPEAKING stamps at onset
    # only), and the window is measured from the END of the utterance.
    e, t = _engaged()
    timeline = [(s, "SPEAKING") for s in range(1, 131)]      # 130s utterance
    timeline += [(131, "LISTENING")]
    assert _simulate_watcher(e, t, timeline) is False        # never slept during the utterance
    t[0] = 249; assert e.tick() == "ENGAGED"                 # 249-130 = 119 < 120 -> still awake
    t[0] = 251; assert e.tick() == "ASLEEP"                  # 251-130 = 121 > 120 -> sleeps after end


# --- M4: output-device pin status surfaced in /state --------------------------------------------

def test_output_device_status_reports_configured_and_resolution():
    from worker.app import _output_device_status
    # no config -> both null
    assert _output_device_status({}, resolve=lambda s: None) == {"configured": None, "resolved": None}
    # configured but unresolved -> visible bad pin (resolved null)
    assert _output_device_status({"tts_output_device": "Ghost"},
                                 resolve=lambda s: None) == {"configured": "Ghost", "resolved": None}
    # configured + resolved -> configured echoed, resolved is a device name (idx 0 here)
    st = _output_device_status({"tts_output_device": "Speakers"}, resolve=lambda s: 0)
    assert st["configured"] == "Speakers" and st["resolved"] is not None


def test_resolve_model_custom_path_loads_by_file_and_stem_key():
    # config/hey_atlas.onnx exists in the repo -> load by full path, predict-key = file stem.
    # openwakeword keys a path-loaded single-output model by os.path.splitext(basename)[0].
    from worker.wakeword import _resolve_model, ATLAS
    arg, key = _resolve_model("hey_atlas")
    assert arg == str(ATLAS / "config" / "hey_atlas.onnx")
    assert (ATLAS / "config" / "hey_atlas.onnx").exists()   # the arg is a real file, so oww loads it as a path
    assert key == "hey_atlas"                                # == wake_model, so listen()'s lookup fires


def test_resolve_model_pretrained_name_passes_through():
    # No config/hey_jarvis.onnx -> treated as a pretrained NAME, keyed by that bare name.
    from worker.wakeword import _resolve_model, ATLAS
    assert not (ATLAS / "config" / "hey_jarvis.onnx").exists()
    arg, key = _resolve_model("hey_jarvis")
    assert arg == "hey_jarvis"
    assert key == "hey_jarvis"


def test_ensure_models_custom_needs_only_feature_models(monkeypatch):
    # A path-loaded custom model must NOT require a pretrained <name>_v0.1.onnx; only the shared
    # feature models. Since those are already cached, ensure_models() must early-return (no download).
    import worker.wakeword as ww
    called = []
    monkeypatch.setattr(ww, "download_models",
                        lambda names: called.append(names), raising=False)
    import openwakeword.utils as owwu
    monkeypatch.setattr(owwu, "download_models", lambda names: called.append(names))
    ww.ensure_models("hey_atlas")
    assert called == []          # feature models present -> no fetch attempted for the custom model


def test_dismiss_phrases_route_reflex():
    # Task 10: _is_dismiss + the hardcoded dismiss list were MIGRATED into the reflex lane; dismiss
    # detection is now router.route against the `dismiss` intent (config/intents.yaml).
    from worker import router
    intents = {"dismiss": {"phrases": ["that's all", "go to sleep", "thanks atlas", "thank you atlas"]}}
    assert router.route("That's all.", intents) == ("reflex", "dismiss")
    assert router.route("thats all", intents) == ("reflex", "dismiss")   # Deepgram may drop the apostrophe
    assert router.route("Thanks, Atlas!", intents) == ("reflex", "dismiss")
    assert router.route("Go to sleep", intents) == ("reflex", "dismiss")
    assert router.route("that's all I know about it", intents) == ("fast", None)
    assert router.route("what's in the queue?", intents) == ("fast", None)


def test_build_tts_voice_toggle_config():
    from worker.app import _build_tts
    import worker.app as app
    # config selects matilda (elevenlabs) — verify vendor routing without constructing plugins
    cfg = {"active_voice": "x", "voices": {"x": {"vendor": "nope"}}}
    try:
        _build_tts(cfg)
        assert False, "unknown vendor should raise"
    except ValueError as e:
        assert "unknown voice vendor" in str(e)
