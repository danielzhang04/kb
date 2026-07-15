"""build_motion.apply_motion_plan merges cutout layers by id (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from build_motion import apply_motion_plan


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


def test_routes_engine_counter_to_overlay():
    shots = [{"id": "L14", "start_s": 88.2, "duration_s": 4.0, "overlays": []}]
    plan = {"shots": [{"id": "L14", "background": {"mode": "plate", "plate_prompt": "desk"},
            "layers": [{"id": "raised", "source": "engine", "kind": "counter",
                        "content": {"from": 0, "to": 8000000, "suffix": " acres", "duration_s": 1.6}}]}]}
    out = apply_motion_plan(shots, plan)
    ov = out[0]["overlays"]
    assert len(ov) == 1 and ov[0]["type"] == "counter", ov
    assert ov[0]["to"] == 8000000 and ov[0]["suffix"] == " acres"
    assert ov[0]["at_s"] == 88.2, ov
    assert "layers" not in out[0] and "plate" not in out[0], out[0]  # no cutouts -> no plate


def test_reveal_items_stagger_across_shot():
    shots = [{"id": "L20", "start_s": 10.0, "duration_s": 6.0, "overlays": []}]
    plan = {"shots": [{"id": "L20", "background": {"mode": "plate", "plate_prompt": "poster"},
            "layers": [{"id": "amenities", "source": "engine", "kind": "reveal",
                        "content": {"items": [{"text": "Opera house"}, {"text": "National bank"},
                                              {"text": "Boulevards"}], "mark": "x"}}]}]}
    out = apply_motion_plan(shots, plan)
    ov = out[0]["overlays"][0]
    assert ov["type"] == "progressive-reveal" and ov["mark"] == "x", ov
    ats = [it["at_s"] for it in ov["items"]]
    assert ats == [10.0, 12.0, 14.0], ats  # 3 items across 6s from t=10


def test_diegetic_text_layer_is_skipped():
    shots = [{"id": "L03", "start_s": 5.0, "duration_s": 3.0, "overlays": []}]
    plan = {"shots": [{"id": "L03", "background": {"mode": "plate", "plate_prompt": "map"},
            "layers": [{"id": "acres", "source": "engine", "kind": "text",
                        "content": {"text": "8M acres"}, "at_scene": {"x": 0.4, "y": 0.5}}]}]}
    out = apply_motion_plan(shots, plan)
    assert out[0]["overlays"] == [], out[0]  # deferred: skipped, no crash


def test_device_card_pins_to_anchor():
    wt = [["By", 185.0], ["early", 185.4], ["five", 186.7], ["hundred", 187.0],
          ["people", 187.3], ["had", 187.6]]
    plan = {"shots": [{"id": "L52", "background": {"mode": "plate", "plate_prompt": "office"},
            "layers": [{"id": "signed", "source": "engine", "kind": "counter",
                        "anchor": "five hundred people had",
                        "content": {"from": 0, "to": 500, "suffix": " signed up"}}]}]}
    # anchored: at_s = the spoken word (186.7), NOT the shot cut (184.6)
    out = apply_motion_plan([{"id": "L52", "start_s": 184.6, "duration_s": 5.0, "overlays": []}],
                            plan, word_timings=wt)
    assert out[0]["overlays"][0]["at_s"] == 186.7, out[0]["overlays"][0]
    # no anchor -> falls back to the shot start (backward compatible)
    plan2 = {"shots": [{"id": "L52", "background": {"mode": "plate", "plate_prompt": "office"},
             "layers": [{"id": "s", "source": "engine", "kind": "stat-card",
                         "content": {"text": "£200,000"}}]}]}
    out2 = apply_motion_plan([{"id": "L52", "start_s": 184.6, "duration_s": 5.0, "overlays": []}],
                             plan2, word_timings=wt)
    assert out2[0]["overlays"][0]["at_s"] == 184.6, out2[0]["overlays"][0]


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


if __name__ == "__main__":
    test_merges_cutout_layers_and_leaves_others()
    test_routes_engine_counter_to_overlay()
    test_reveal_items_stagger_across_shot()
    test_diegetic_text_layer_is_skipped()
    test_device_card_pins_to_anchor()
    test_hybrid_overlay_reuses_prior_scene_as_plate()
    test_cutout_anchor_resolves_to_shot_relative_start()
    test_cutout_without_anchor_has_no_start_s()
    print("OK")
