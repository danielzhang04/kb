#!/usr/bin/env python3
"""Plain-assert tests for the P7 composer and its safety interlocks."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _tmp():
    return Path(tempfile.mkdtemp(prefix="p7-matched-"))


def _register():
    return {"ink_hex": "#0f0f0c", "palette": [
        {"hex": "#697c7d", "coverage": .2, "is_accent": False},
        {"hex": "#b0bbb7", "coverage": .2, "is_accent": False},
        {"hex": "#ede9cf", "coverage": .2, "is_accent": False},
        {"hex": "#839191", "coverage": .15, "is_accent": False},
        {"hex": "#9ea9a5", "coverage": .15, "is_accent": False},
        {"hex": "#678c99", "coverage": .1, "is_accent": True},
    ]}


def test_l28_composer_preserves_verbatim_contract_and_lettering_exception():
    import p7_matched as p7

    prompt = p7.compose_matched({"payload": "A placeholder scene.", "seed_roles": []}, {}, (1376, 768), "16:9", register=_register(), shot="L28", style_path="anchor.png")
    assert p7.SHOT_SPEC["L28"]["composition"] in prompt
    assert p7.SHOT_SPEC["L28"]["dressing"] in prompt
    assert p7.SHOT_SPEC["L28"]["lettering"] in prompt
    assert "words, letters, numerals or signage other than the exact string(s) specified in the Lettering line" in prompt
    assert "vivid steel-blue #678c99 — the bench work mats" in prompt


def test_expression_geometry_and_non_lettering_no_words_ban_are_explicit():
    import p7_matched as p7

    prompt = p7.compose_matched({"payload": "A placeholder scene.", "seed_roles": []}, {}, (1376, 768), "16:9", register=_register(), shot="L27", style_path="anchor.png")
    assert "Expression geometry: deadpan — half-lidded flat eyes, tiny straight mouth, no smile." in prompt
    assert "any words, letters, numerals or signage" in prompt
    assert "other than the exact string(s) specified in the Lettering line" not in prompt


def test_ref_cap_trims_the_place_reference_before_the_style_anchor():
    import p7_matched as p7

    roles = [{"role": "figure", "path": "figure-a.png"}, {"role": "figure", "path": "figure-b.png"},
             {"role": "environment", "path": "lettering-marker-italic.png"}, {"role": "place", "path": "place.png"},
             {"role": "style-anchor", "path": "anchor.png"}, {"role": "figure", "path": "figure-c.png"}]
    kept_roles, kept_paths, trims = p7.trim_references(roles, [role["path"] for role in roles], cap=5)
    assert len(kept_roles) == len(kept_paths) == 5
    assert trims == [{"role": "place", "path": "place.png", "reason": "P7 ref cap"}]
    assert kept_paths[-2] == "anchor.png" or "anchor.png" in kept_paths


def test_results_dir_is_required_and_real_mode_refuses_before_driver_work():
    import p7_matched as p7

    try:
        p7.main(["--fake"])
    except SystemExit as exc:
        assert exc.code == 2
    else:
        raise AssertionError("missing --results-dir was accepted")
    saved, called = p7.run_driver, []
    p7.run_driver = lambda **kwargs: called.append(kwargs)
    try:
        assert p7.main(["--results-dir", str(_tmp())]) == 2
    finally:
        p7.run_driver = saved
    assert called == []


ALL_TESTS = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

if __name__ == "__main__":
    for function in ALL_TESTS:
        function()
        print(f"  ok  {function.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
