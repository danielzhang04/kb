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


def test_engine_source_is_now_invalid():
    # Device/engine layers left the pipeline — `engine` is no longer an allowed source.
    plan = {"shots": [{"id": "L14", "background": {"mode": "plate", "plate_prompt": "desk"},
            "layers": [{"id": "raised", "source": "engine", "kind": "counter",
                        "content": {"from": 0, "to": 8000000}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("source must be cutout" in e for e in errs), errs


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


def test_anchor_origin_valid_on_every_type():
    # anchor_origin (center|bottom) is accepted on appear/slide/bob/path — the M16 origin override.
    for anim in [{"type": "appear", "at": [0.5, 0.5], "anchor_origin": "center"},
                 {"type": "slide", "to": [0.5, 0.5], "dur_s": 1.0, "anchor_origin": "center"},
                 {"type": "bob", "at": [0.5, 0.5], "anchor_origin": "bottom"},
                 {"type": "path", "points": [[.4, .3], [.5, .4], [.6, .5]], "dur_s": 1.6, "anchor_origin": "center"}]:
        plan = {"shots": [{"id": "L1", "background": {"mode": "plate", "plate_prompt": "x"},
                "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "x", "animation": anim}]}]}
        assert validate_plan(plan, load_menu()) == [], anim


def test_anchor_origin_bad_value_errors():
    plan = {"shots": [{"id": "L1", "background": {"mode": "plate", "plate_prompt": "x"},
            "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "x",
                        "animation": {"type": "appear", "anchor_origin": "top"}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("param" in e and "anchor_origin" in e for e in errs), errs


def test_dot_fields_valid_with_draw_line():
    plan = {"shots": [{"id": "L112", "background": {"mode": "plate", "plate": "plates/L112.png"},
            "layers": [{"id": "route", "source": "cutout", "cutout_prompt": "coach",
                        "animation": {"type": "path", "points": [[.4, .32], [.44, .41], [.47, .49]],
                                      "dur_s": 1.6, "draw_line": True, "dot_count": 14, "dot_r": 4}}]}]}
    assert validate_plan(plan, load_menu()) == []


def test_dot_fields_require_draw_line_and_positive():
    for anim, key in [({"type": "path", "points": [[.4, .3], [.5, .4], [.6, .5]], "dur_s": 1.6, "dot_count": 14}, "dot_count"),
                      ({"type": "path", "points": [[.4, .3], [.5, .4], [.6, .5]], "dur_s": 1.6, "draw_line": True, "dot_count": 0}, "dot_count"),
                      ({"type": "path", "points": [[.4, .3], [.5, .4], [.6, .5]], "dur_s": 1.6, "draw_line": True, "dot_r": -1}, "dot_r")]:
        plan = {"shots": [{"id": "L1", "background": {"mode": "plate", "plate_prompt": "x"},
                "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "x", "animation": anim}]}]}
        errs = validate_plan(plan, load_menu())
        assert any("param" in e and key in e for e in errs), (anim, errs)


def test_chapter_cards_valid():
    # P03: a well-formed cards[] + post_vo_hold_s passes.
    plan = {"post_vo_hold_s": 4.0,
            "cards": [{"text": "How to Invent a Country", "anchor": "It all started with a soldier",
                       "hold_s": 2.2, "fade_s": 0.3},
                      {"text": "Thanks for Watching", "anchor": "Thanks for watching", "end_card": True}],
            "shots": [{"id": "L01", "background": {"mode": "plate", "plate": "scenes/L01.png"}, "layers": []}]}
    assert validate_plan(plan, load_menu()) == [], validate_plan(plan, load_menu())


def test_card_missing_text_and_anchor_error():
    plan = {"cards": [{"hold_s": 2.2}]}   # no text, no anchor, not an end card
    errs = validate_plan(plan, load_menu())
    assert any("card" in e and "text" in e for e in errs), errs
    assert any("card" in e and "anchor" in e for e in errs), errs


def test_card_bad_hold_and_post_vo_hold_error():
    plan = {"post_vo_hold_s": -1,
            "cards": [{"text": "x", "anchor": "some words", "hold_s": 0}]}
    errs = validate_plan(plan, load_menu())
    assert any("post_vo_hold_s" in e for e in errs), errs
    assert any("hold_s" in e for e in errs), errs


def test_end_card_may_omit_anchor():
    plan = {"cards": [{"text": "Thanks for Watching", "end_card": True}]}
    assert validate_plan(plan, load_menu()) == [], validate_plan(plan, load_menu())


def main():
    for fn in [test_passthrough_is_valid, test_layer_with_offmenu_animation_errors, test_missing_background_errors,
               test_engine_source_is_now_invalid,
               test_slide_to_must_be_coord, test_slide_needs_positive_dur, test_path_needs_exactly_three_points,
               test_appear_style_enum_and_anchor_type, test_valid_cutout_params_ok,
               test_anchor_origin_valid_on_every_type, test_anchor_origin_bad_value_errors,
               test_dot_fields_valid_with_draw_line, test_dot_fields_require_draw_line_and_positive,
               test_chapter_cards_valid, test_card_missing_text_and_anchor_error,
               test_card_bad_hold_and_post_vo_hold_error, test_end_card_may_omit_anchor]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
