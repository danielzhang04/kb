"""Unit tests for shots.motion.json validation (plain-assert; repo has no pytest)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from menu import load_menu
from motion_plan import validate_plan


def _passthrough():
    return {"shots": [{"id": "L01", "background": {"mode": "plate", "plate": "scenes/L01.png"}, "layers": []}]}


def test_passthrough_is_valid():
    assert validate_plan(_passthrough(), load_menu()) == []


def test_layer_with_offmenu_animation_errors():
    plan = {"shots": [{"id": "L03", "background": {"mode": "plate", "plate_prompt": "map, no ship"},
            "layers": [{"id": "ship", "source": "cutout", "cutout_prompt": "a ship",
                        "animation": {"type": "teleport"}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("teleport" in e for e in errs), errs


def test_missing_background_errors():
    plan = {"shots": [{"id": "L01", "layers": []}]}
    errs = validate_plan(plan, load_menu())
    assert any("background" in e for e in errs), errs


def test_device_layer_missing_content_errors():
    plan = {"shots": [{"id": "L14", "background": {"mode": "plate", "plate_prompt": "desk"},
            "layers": [{"id": "raised", "source": "engine", "kind": "counter",
                        "content": {"from": 0}}]}]}  # missing 'to'
    errs = validate_plan(plan, load_menu())
    assert any("to" in e and "counter" in e for e in errs), errs


def test_valid_device_layer_ok():
    plan = {"shots": [{"id": "L14", "background": {"mode": "plate", "plate_prompt": "desk"},
            "layers": [{"id": "raised", "source": "engine", "kind": "stat-card",
                        "content": {"text": "£1.3M", "sub": "in bonds"}}]}]}
    assert validate_plan(plan, load_menu()) == []


def test_slide_to_must_be_coord():
    plan = {"shots": [{"id": "L01", "background": {"mode": "plate", "plate_prompt": "x"},
            "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "x",
                        "animation": {"type": "slide", "to": "center", "dur_s": 1.8}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("param" in e and "to" in e for e in errs), errs


def test_slide_needs_positive_dur():
    plan = {"shots": [{"id": "L01", "background": {"mode": "plate", "plate_prompt": "x"},
            "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "x",
                        "animation": {"type": "slide", "to": [0.5, 0.9], "dur_s": 0}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("param" in e and "dur_s" in e for e in errs), errs


def test_path_needs_exactly_three_points():
    plan = {"shots": [{"id": "L03", "background": {"mode": "plate", "plate_prompt": "map"},
            "layers": [{"id": "ship", "source": "cutout", "cutout_prompt": "ship",
                        "animation": {"type": "path", "points": [[0, 0], [1, 1]], "dur_s": 3}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("param" in e and "points" in e for e in errs), errs


def test_appear_style_enum_and_anchor_type():
    plan = {"shots": [{"id": "L07", "background": {"mode": "delta-chain", "plate": "scenes/L06.png"},
            "layers": [{"id": "stamp", "source": "cutout", "cutout_prompt": "stamp",
                        "animation": {"type": "appear", "style": "explode", "anchor": ""}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("param" in e and "style" in e for e in errs), errs
    assert any("param" in e and "anchor" in e for e in errs), errs


def test_valid_cutout_params_ok():
    plan = {"shots": [{"id": "L13", "background": {"mode": "plate", "plate_prompt": "stage"},
            "layers": [{"id": "mac", "source": "cutout", "cutout_prompt": "man",
                        "animation": {"type": "slide", "from_edge": "left", "to": [0.5, 0.9],
                                      "dur_s": 1.8, "anchor": "MacGregor stepped forward"}}]}]}
    assert validate_plan(plan, load_menu()) == []


def main():
    for fn in [test_passthrough_is_valid, test_layer_with_offmenu_animation_errors, test_missing_background_errors,
               test_device_layer_missing_content_errors, test_valid_device_layer_ok,
               test_slide_to_must_be_coord, test_slide_needs_positive_dur, test_path_needs_exactly_three_points,
               test_appear_style_enum_and_anchor_type, test_valid_cutout_params_ok]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
