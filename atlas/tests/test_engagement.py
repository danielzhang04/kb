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


def test_is_dismiss_phrases():
    from worker.app import _is_dismiss
    phrases = ["that's all", "go to sleep", "thanks atlas", "thank you atlas"]
    assert _is_dismiss("That's all.", phrases)
    assert _is_dismiss("thats all", phrases)          # Deepgram may drop the apostrophe
    assert _is_dismiss("Thanks, Atlas!", phrases)
    assert _is_dismiss("Go to sleep", phrases)
    assert not _is_dismiss("that's all I know about it", phrases)
    assert not _is_dismiss("what's in the queue?", phrases)


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
