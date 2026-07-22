#!/usr/bin/env python3
"""Unit tests for build_motion's camera path (plain-assert; repo has no pytest).

Camera is LOCKED by default; the motion plan may author a per-shot exception (L44's
human-authorized pull). Cases below: default lock, camera-less plan unchanged, authored
pull -> engine pull-back with intensity, unknown move hard-errors naming the shot."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_motion import (
    apply_motion_plan,
    authored_camera_ids,
    baseline_life_tokens,
    locked_camera,
    resolve_plan_camera,
)

LOCKED = {"move": "none", "pan": None, "intensity": 0.0}


def test_camera_default_locked():
    # The default (no authored plan entry) is always the locked camera.
    assert locked_camera(is_card=False) == LOCKED
    assert locked_camera(is_card=True) == LOCKED


def test_camera_less_plan_leaves_lock_untouched():
    # (a) A plan entry with NO `camera` key must not touch the shot's locked camera — byte-identical
    # to the pre-wiring behavior for every non-authored shot.
    plan = {"shots": [{"id": "L45", "background": {"mode": "plate"}, "layers": []}]}
    shot = {"id": "L45", "camera": locked_camera()}
    apply_motion_plan([shot], plan)
    assert shot["camera"] == LOCKED, shot
    assert authored_camera_ids(plan) == set()


def test_authored_pull_emits_pullback_with_intensity():
    # (b) L44-style authored pull -> the engine's pull-back token, carrying the intensity.
    plan = {"shots": [{"id": "L44", "background": {"mode": "plate"}, "layers": [],
                       "camera": {"move": "pull", "pan": None, "intensity": 1.0}}]}
    shot = {"id": "L44", "camera": locked_camera()}
    apply_motion_plan([shot], plan)
    assert shot["camera"] == {"move": "pull-back", "pan": None, "intensity": 1.0}, shot
    assert authored_camera_ids(plan) == {"L44"}


def test_authored_push_emits_pushin_with_intensity():
    plan = {"shots": [{"id": "L01", "background": {"mode": "plate"}, "layers": [],
                       "camera": {"move": "push", "pan": "left", "intensity": 0.5}}]}
    shot = {"id": "L01", "camera": locked_camera()}
    apply_motion_plan([shot], plan)
    assert shot["camera"] == {"move": "push-in", "pan": "left", "intensity": 0.5}, shot


def test_pull_intensity_scales_through():
    # (b') A non-unit intensity flows straight into the emitted token (engine scales pull by it).
    cam = resolve_plan_camera({"move": "pull", "pan": None, "intensity": 0.5}, "L44")
    assert cam == {"move": "pull-back", "pan": None, "intensity": 0.5}, cam
    # intensity defaults to 1.0 when the plan omits it.
    assert resolve_plan_camera({"move": "pull"}, "L44")["intensity"] == 1.0


def test_unknown_move_hard_errors_naming_shot():
    # (c) An unknown authored move must hard-error naming the shot — never silently lock over it.
    try:
        resolve_plan_camera({"move": "barrel-roll"}, "L44")
    except SystemExit as e:
        assert "L44" in str(e) and "barrel-roll" in str(e), e
    else:
        raise AssertionError("unknown camera move did not raise")


def test_baseline_life_is_opt_in_and_legacy_tokens_stay_identical():
    tokens = {"idle": {"bob_px": 0, "period_s": 2.4, "breathe_scale": 0},
              "baseline_life": {"bob_px": 2, "period_s": 6, "breathe_scale": 0.002}}
    assert baseline_life_tokens(tokens, None) is tokens
    assert baseline_life_tokens(tokens, {"baseline_life": False}) is tokens
    applied = baseline_life_tokens(tokens, {"baseline_life": True})
    assert applied["idle"] == tokens["baseline_life"]
    assert tokens["idle"]["bob_px"] == 0  # caller-visible legacy object is untouched


def test_baseline_life_marks_layered_tableau_live():
    # A layered shot has no resolved scene image, so this specifically proves the opt-in reaches the
    # plate-plus-cutout path rather than only the ordinary scene-backed Idle wrapper.
    plan = {"baseline_life": True,
            "shots": [{"id": "L02", "background": {"mode": "plate", "plate": "plates/L02.png"},
                       "layers": [{"id": "ship", "source": "cutout", "cutout_prompt": "ship",
                                   "animation": {"type": "appear"}}]}]}
    shot = {"id": "L02", "idle": "none"}
    apply_motion_plan([shot], plan)
    assert shot["idle"] == "bob" and shot["layers"], shot


if __name__ == "__main__":
    print("running")
    test_camera_default_locked()
    test_camera_less_plan_leaves_lock_untouched()
    test_authored_pull_emits_pullback_with_intensity()
    test_authored_push_emits_pushin_with_intensity()
    test_pull_intensity_scales_through()
    test_unknown_move_hard_errors_naming_shot()
    test_baseline_life_is_opt_in_and_legacy_tokens_stay_identical()
    test_baseline_life_marks_layered_tableau_live()
    print("PASS")
