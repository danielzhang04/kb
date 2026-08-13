#!/usr/bin/env python3
"""Plain assertions for P10's production-shaped composer and fake-only runner."""
import hashlib
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _tmp():
    return Path(tempfile.mkdtemp(prefix="p10-matched-"))


def _derived(p10):
    root = _tmp()
    return p10.derive_corpus(fake_seed_dir=root), p10.load_contracts()


def _prompt(p10, derived, contracts, shot, deltas=None):
    return p10.compose_matched(derived["items"][shot], {}, (1376, 768), "16:9", shot=shot,
                               contracts=contracts, deltas=deltas)


def test_l28_golden_bytes_and_section_order():
    import p10_matched as p10

    derived, contracts = _derived(p10)
    prompt = _prompt(p10, derived, contracts, "L28")
    assert hashlib.sha256(prompt.encode("utf-8")).hexdigest() == "4f2033a32cad400fc8720d1ac65c4081a1252a23beef1af3d54350e5ef353459"
    head = p10._style_head()
    stills, suffix = p10._video_shots()
    assert prompt.startswith(head + "\nImage 1:")
    assert prompt.index(stills["L28"]["still_prompt"]) > prompt.index("Image 2:")
    assert prompt.index(suffix) > prompt.index(stills["L28"]["still_prompt"])
    assert prompt.index(p10.AVOID_PREFIX) > prompt.index(suffix)


def test_style_head_is_read_from_the_bible_at_compose_time():
    import p10_matched as p10

    derived, contracts = _derived(p10)
    root, original = _tmp(), p10.STYLE_BIBLE
    bible = root / "style-bible.md"
    bible.write_text(original.read_text(encoding="utf-8").replace("Draw in the SAME art style", "P10 MUTATED STYLE HEAD", 1),
                     encoding="utf-8", newline="\n")
    p10.STYLE_BIBLE = bible
    try:
        assert "P10 MUTATED STYLE HEAD" in _prompt(p10, derived, contracts, "L27")
    finally:
        p10.STYLE_BIBLE = original


def test_seed_base_edit_language_only_for_the_chain_parent():
    import p10_matched as p10

    derived, contracts = _derived(p10)
    chained, root = _prompt(p10, derived, contracts, "L33"), _prompt(p10, derived, contracts, "L28")
    assert "the established assembly-floor room — reproduce this frame's room EXACTLY" in chained
    assert "change ONLY by adding two figures and handshake" in chained
    assert "reproduce this frame's room EXACTLY" not in root


def test_still_prompts_survive_verbatim_and_only_money_shots_have_surfaces():
    import p10_matched as p10

    derived, contracts = _derived(p10)
    stills, _ = p10._video_shots()
    for shot in p10.TARGET_SHOTS:
        prompt = _prompt(p10, derived, contracts, shot)
        assert stills[shot]["still_prompt"] in prompt
        surfaces = [line for line in prompt.splitlines() if line.startswith("Surface colors: ")]
        assert bool(surfaces) is (shot in p10.P10_SURFACE_SHOTS)
        assert len(surfaces) <= 1


def test_prompt_char_band_and_replace_only_deltas_are_deterministic():
    import p10_matched as p10

    derived, contracts = _derived(p10)
    for shot in p10.TARGET_SHOTS:
        prompt = _prompt(p10, derived, contracts, shot)
        assert 1300 <= len(prompt) < 2600
    baseline = p10.compose_sections(derived["items"]["L36"], shot="L36", contracts=contracts)
    deltas = {"L36": {"still_prompt": "REPLACED STILL PROMPT."}}
    changed = p10.compose_sections(derived["items"]["L36"], shot="L36", contracts=contracts, deltas=deltas)
    assert changed["still_prompt"] == "REPLACED STILL PROMPT."
    assert {key: changed[key] for key in changed if key != "still_prompt"} == {
        key: baseline[key] for key in baseline if key != "still_prompt"}
    assert _prompt(p10, derived, contracts, "L36", deltas) == _prompt(p10, derived, contracts, "L36", deltas)


def test_extra_delta_is_refused_and_mojibake_is_a_hard_error():
    import p10_matched as p10

    root, derived, contracts = _tmp(), *_derived(p10)
    delta_path = root / "bad-deltas.json"
    delta_path.write_text(json.dumps({"L36": {"extra": "append me"}}), encoding="utf-8", newline="\n")
    try:
        p10._load_deltas(delta_path)
    except RuntimeError as exc:
        assert "REPLACE law" in str(exc) and "extra" in str(exc)
    else:
        raise AssertionError("P10 accepted an append delta")
    try:
        _prompt(p10, derived, contracts, "L27", {"L27": {"style_head": "poison Ã¢â‚¬ text"}})
    except RuntimeError as exc:
        assert "mojibake" in str(exc)
    else:
        raise AssertionError("P10 accepted mojibake")


def test_lettering_except_comes_from_forge_slate():
    import p10_matched as p10

    derived, contracts = _derived(p10)
    assert "EXCEPT the exact string(s): 125 MILLION." in _prompt(p10, derived, contracts, "L36")
    assert "EXCEPT the exact string(s): 20 MILLION." in _prompt(p10, derived, contracts, "L50")
    assert "EXCEPT the exact string(s)" not in _prompt(p10, derived, contracts, "L33")


def test_fake_eight_resume_and_real_gate():
    import p10_matched as p10

    root = _tmp()
    first = p10.run_driver(results_dir=root, mode="fake")
    assert first["shots"] == list(p10.TARGET_SHOTS)
    assert first["this_run"]["subprocess_generations"] == 8
    assert all(Path(row["png"]).name == f"{row['shot']}-p10-match-r1.png" for row in first["results"])
    resumed = p10.run_driver(results_dir=root, mode="fake")
    assert resumed["this_run"]["run_item_calls"] == 0 and resumed["this_run"]["skipped"] == 8
    assert p10.main(["--results-dir", str(_tmp())]) == 2


ALL_TESTS = [value for name, value in sorted(globals().items()) if name.startswith("test_")]


if __name__ == "__main__":
    for function in ALL_TESTS:
        function()
        print(f"  ok  {function.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
