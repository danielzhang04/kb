"""build_motion.apply_motion_plan merges cutout layers by id (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from build_motion import apply_motion_plan, apply_cards


def test_merges_cutout_layers_and_leaves_others():
    shots = [{"id": "L13"}, {"id": "L99"}]  # L99 not in the plan
    plan = {"shots": [{"id": "L13", "background": {"mode": "plate", "plate_prompt": "stage"},
             "layers": [{"id": "macgregor", "source": "cutout", "cutout_prompt": "x",
                         "animation": {"type": "slide", "to": [0.5, 0.82], "dur_s": 1.8}}]}]}
    out = apply_motion_plan(shots, plan)
    l13 = next(s for s in out if s["id"] == "L13")
    assert l13["plate"] == "plates/L13.png", l13
    assert l13["layers"][0]["src"] == "cutouts/L13-macgregor.png", l13
    assert l13["layers"][0]["animation"]["type"] == "slide"
    l99 = next(s for s in out if s["id"] == "L99")
    assert "layers" not in l99 and "plate" not in l99, l99


def test_hybrid_overlay_reuses_prior_scene_as_plate():
    # a delta-chain delta carrying a discrete-overlay cutout (a FICTION stamp): the plate REUSES the prior
    # in-stage scene (background.plate = scenes/L06.png), NOT a generated plates/L07.png.
    shots = [{"id": "L07"}]
    plan = {"shots": [{"id": "L07", "background": {"mode": "delta-chain", "plate": "scenes/L06.png"},
             "layers": [{"id": "stamp", "source": "cutout", "cutout_prompt": "a red FICTION marker stamp",
                         "animation": {"type": "appear"}}]}]}
    out = apply_motion_plan(shots, plan)
    assert out[0]["plate"] == "scenes/L06.png", out[0]            # prior scene reused, not plates/L07.png
    assert out[0]["layers"][0]["src"] == "cutouts/L07-stamp.png", out[0]
    assert out[0]["layers"][0]["animation"]["type"] == "appear"


def test_reuse_layer_composites_the_reused_cutout_not_the_derived_path():
    # A `reuse` layer holds an already-materialized cutout (one shared MacGregor across the map stage):
    # its src is the reuse path, NOT cutouts/<sid>-<layer>.png.
    shots = [{"id": "L16"}]
    plan = {"shots": [{"id": "L16", "background": {"mode": "delta-chain", "plate": "plates/L15.png"},
             "layers": [{"id": "macgregor", "source": "cutout", "reuse": "cutouts/L17-macgregor.png",
                         "animation": {"type": "path", "points": [[0.83, 0.3], [0.5, 0.22], [0.15, 0.6]],
                                       "dur_s": 2.6, "draw_line": True, "static": True}}]}]}
    out = apply_motion_plan(shots, plan)
    assert out[0]["layers"][0]["src"] == "cutouts/L17-macgregor.png", out[0]     # reused, not cutouts/L16-macgregor.png
    assert out[0]["layers"][0]["animation"]["static"] is True, out[0]


def test_cutout_anchor_resolves_to_shot_relative_start():
    wt = [["The", 100.0], ["ship", 100.4], ["left", 100.9], ["harbor", 101.3],
          ["that", 102.4], ["autumn", 102.7]]
    plan = {"shots": [{"id": "L03", "background": {"mode": "plate", "plate_prompt": "map"},
            "layers": [{"id": "ship", "source": "cutout", "cutout_prompt": "a ship",
                        "animation": {"type": "path", "points": [[0, 0.5], [0.5, 0.4], [1, 0.5]],
                                      "dur_s": 3.0, "anchor": "that autumn"}}]}]}
    out = apply_motion_plan([{"id": "L03", "start_s": 100.0, "duration_s": 5.0}],
                            plan, word_timings=wt)
    # "that autumn" starts at 102.4; shot starts at 100.0 -> start_s = 2.4
    assert out[0]["layers"][0]["animation"]["start_s"] == 2.4, out[0]["layers"][0]


def test_cutout_without_anchor_has_no_start_s():
    plan = {"shots": [{"id": "L13", "background": {"mode": "plate", "plate_prompt": "stage"},
            "layers": [{"id": "mac", "source": "cutout", "cutout_prompt": "man",
                        "animation": {"type": "slide", "to": [0.5, 0.9], "dur_s": 1.8}}]}]}
    out = apply_motion_plan([{"id": "L13", "start_s": 50.0, "duration_s": 4.0}],
                            plan, word_timings=[["x", 1.0]])
    assert "start_s" not in out[0]["layers"][0]["animation"], out[0]["layers"][0]


def test_p01_plate_only_keeps_own_scene_image():
    # P01 regression: a layerless delta shot with an OWN baked scene (image already resolved) must
    # DISPLAY its own frame — background.plate is a seed pointer, not a display override. (assets_dir
    # None → skip the disk-existence check.)
    shots = [{"id": "L07", "image": "scenes/L07.png", "placeholder": None}]
    plan = {"shots": [{"id": "L07", "background": {"mode": "delta-chain", "plate": "scenes/L06.png"},
                       "layers": []}]}
    apply_motion_plan(shots, plan)
    assert shots[0]["image"] == "scenes/L07.png", shots[0]   # own frame kept, NOT the prior plate


def test_p01_plate_only_held_reuse_falls_back_to_plate():
    # The genuine held-reuse (no own scene → image None) still correctly falls back to the held plate.
    shots = [{"id": "L79", "image": None, "placeholder": {"kind": "x", "label": "y"}}]
    plan = {"shots": [{"id": "L79", "background": {"mode": "plate", "plate": "scenes/L76.png"},
                       "layers": []}]}
    apply_motion_plan(shots, plan)
    assert shots[0]["image"] == "scenes/L76.png", shots[0]
    assert shots[0].get("placeholder") is None, shots[0]


def test_cards_align_to_pause_gap_and_post_vo_hold():
    # P03 (opaque cards): an in-video card fills exactly its co-located spliced pause SILENCE
    # ([render_anchor - gap_dur, render_anchor]); the end card runs to the post_vo_hold-extended shot.
    from breath import shift_timings
    orig = [["home.", 9.0], ["So", 10.0], ["what", 10.3], ["happened", 10.6],
            ["Thanks", 40.0], ["for", 40.3], ["watching", 40.6]]
    gaps = [{"at_s": 10.0, "dur_s": 2.5, "source": "cue"}]   # ~2s pause + 0.5s sentence, merged
    shifted = shift_timings(orig, gaps)                       # "So" 10.0 -> 12.5, etc.
    shots = [{"id": "L12", "start_s": 8.0, "duration_s": 6.0, "overlays": []},
             {"id": "L125", "start_s": 38.0, "duration_s": 5.0, "overlays": []}]
    plan = {"post_vo_hold_s": 4.0,
            "cards": [{"text": "How to Invent a Country", "anchor": "So what happened", "hold_s": 2.0, "fade_s": 0.15},
                      {"text": "Thanks for Watching", "anchor": "Thanks for watching", "end_card": True, "fade_s": 0.2}]}
    apply_cards(shots, plan, shifted, gaps=gaps, orig_word_timings=orig)
    # in-video card window = the silence [10.0, 12.5]; ends exactly on the anchor word (12.5)
    c1 = shots[0]["overlays"][0]
    assert c1 == {"type": "chapter-card", "text": "How to Invent a Country", "fade_s": 0.15,
                  "at_s": 10.0, "dur_s": 2.5}, c1
    # end card: no dur_s (runs to extended shot end), on the last shot
    ec = shots[1]["overlays"][0]
    assert ec["type"] == "chapter-card" and ec["text"] == "Thanks for Watching" and "dur_s" not in ec, ec
    # post_vo_hold_s extended the last shot 5.0 -> 9.0
    assert shots[1]["duration_s"] == 9.0, shots[1]


def test_card_without_pause_gap_hard_fails():
    # A normal opaque card may never cover VO: a missing same-anchor pause is a hard failure.
    orig = [["So", 10.0], ["what", 10.3], ["happened", 10.6]]
    shots = [{"id": "L12", "start_s": 5.0, "duration_s": 10.0, "overlays": []}]
    plan = {"cards": [{"text": "X", "anchor": "So what happened", "hold_s": 2.0, "fade_s": 0.15}]}
    try:
        apply_cards(shots, plan, orig, gaps=[], orig_word_timings=orig)
    except SystemExit as e:
        assert "co-located pause gap" in str(e), e
    else:
        raise AssertionError("normal card without a pause gap did not fail")


def test_cards_skipped_on_short():
    shots = [{"id": "L13", "start_s": 0.0, "duration_s": 6.0, "overlays": []}]
    plan = {"post_vo_hold_s": 4.0, "cards": [{"text": "x", "anchor": "whatever", "hold_s": 2.0}]}
    apply_cards(shots, plan, [["whatever", 1.0]], gaps=[], orig_word_timings=[["whatever", 1.0]], is_short=True)
    assert shots[0]["overlays"] == [] and shots[0]["duration_s"] == 6.0, shots[0]


def test_end_card_unresolved_anchor_falls_back_to_last_shot():
    shots = [{"id": "L125", "start_s": 38.0, "duration_s": 5.0, "overlays": []}]
    plan = {"cards": [{"text": "Thanks for Watching", "anchor": "not in the vo", "end_card": True}]}
    apply_cards(shots, plan, [["something", 1.0]], gaps=[], orig_word_timings=[["something", 1.0]])
    ec = shots[0]["overlays"][0]
    assert ec["text"] == "Thanks for Watching" and ec["at_s"] == 38.0, shots[0]


if __name__ == "__main__":
    test_merges_cutout_layers_and_leaves_others()
    test_hybrid_overlay_reuses_prior_scene_as_plate()
    test_reuse_layer_composites_the_reused_cutout_not_the_derived_path()
    test_cutout_anchor_resolves_to_shot_relative_start()
    test_cutout_without_anchor_has_no_start_s()
    test_p01_plate_only_keeps_own_scene_image()
    test_p01_plate_only_held_reuse_falls_back_to_plate()
    test_cards_align_to_pause_gap_and_post_vo_hold()
    test_card_without_pause_gap_hard_fails()
    test_cards_skipped_on_short()
    test_end_card_unresolved_anchor_falls_back_to_last_shot()
    print("OK")
