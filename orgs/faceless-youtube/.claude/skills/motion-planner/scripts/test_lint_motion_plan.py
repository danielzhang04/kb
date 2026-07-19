"""Mechanical lint for shots.motion.json (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from lint_motion_plan import lint


def test_clean_plan_passes():
    plan = {"shots": [{"id": "L01", "background": {"mode": "plate", "plate": "scenes/L01.png"}, "layers": []}]}
    assert lint(plan, {"L01"}) == []


def test_unknown_shot_id_fails():
    plan = {"shots": [{"id": "LZZ", "background": {"mode": "plate", "plate": "x"}, "layers": []}]}
    errs = lint(plan, {"L01"})
    assert any("LZZ" in e for e in errs), errs


def test_cutout_without_prompt_fails():
    plan = {"shots": [{"id": "L01", "background": {"mode": "plate", "plate_prompt": "stage, no figure"},
            "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "",
                        "animation": {"type": "slide", "to": [0.5, 0.8], "dur_s": 1.5}}]}]}
    errs = lint(plan, {"L01"})
    assert any("cutout_prompt" in e for e in errs), errs


def test_cutout_with_reuse_and_no_prompt_ok():
    # A `reuse` layer points at an already-materialized cutout PNG, so it carries no cutout_prompt.
    plan = {"shots": [{"id": "L17", "background": {"mode": "delta-chain", "plate": "plates/L15.png"},
            "layers": [{"id": "macgregor", "source": "cutout", "reuse": "cutouts/L16-macgregor.png",
                        "animation": {"type": "appear", "style": "pop"}}]}]}
    errs = lint(plan, {"L17"})
    assert not any("cutout_prompt" in e for e in errs), errs


IDS = {"L05", "L06", "L07"}


def _hybrid(sid, base):
    return {"id": sid, "background": {"mode": "delta-chain", "plate": f"scenes/{base}.png"},
            "layers": [{"id": "stamp", "source": "cutout", "cutout_prompt": "a stamp",
                        "animation": {"type": "appear", "style": "slam"}}]}


def test_hybrid_seeding_from_baked_base_is_ok():
    # L07 (hybrid) reuses L06, a normal baked scene -> fine.
    plan = {"shots": [
        {"id": "L06", "background": {"mode": "plate", "plate": "scenes/L06.png"}, "layers": []},
        _hybrid("L07", "L06")]}
    assert [e for e in lint(plan, IDS) if "hybrid" in e] == [], lint(plan, IDS)


def test_hybrid_seeding_from_a_hybrid_base_errors():
    # L06 is itself a hybrid (no baked composite); L07 reuses it -> must flag.
    plan = {"shots": [_hybrid("L06", "L05"), _hybrid("L07", "L06")]}
    errs = lint(plan, IDS)
    assert any("L07" in e and "hybrid" in e for e in errs), errs


# --------------------------------------------------------------------------------------------------
# Phase-4 delta-vs-layer lint backstops. These need the ORDERED shots.json stage metadata (the third
# `lint` arg): a list of {"id", "stage"} rows in shot order. Without it (2-arg calls above) the
# lineage checks are skipped, so the pre-existing tests are untouched.
# --------------------------------------------------------------------------------------------------
def _meta(*rows):
    """rows = (id, stage) tuples in shot order (stage None = standalone)."""
    return [{"id": i, "stage": s} for i, s in rows]


def _passthrough(sid, base):
    return {"id": sid, "background": {"mode": "delta-chain", "plate": f"scenes/{base}.png"}, "layers": []}


# A1 — a passthrough delta-chain (layers []) with NO stage has no lineage to chain from.
def test_delta_chain_passthrough_without_stage_fails():
    plan = {"shots": [_passthrough("L06", "L05")]}
    meta = _meta(("L05", "para"), ("L06", None))
    errs = lint(plan, {"L05", "L06"}, meta)
    assert any("L06" in e and "stage" in e for e in errs), errs


# A1 — a passthrough delta-chain that is the FIRST frame of its stage has no earlier in-stage frame
# to chain from (the two-swamps re-base shape: a fresh stage base marked delta-chain).
def test_delta_chain_passthrough_first_in_stage_fails():
    plan = {"shots": [_passthrough("L24", "L22")]}
    meta = _meta(("L22", "empty-swamp"), ("L24", "swamp-con"))
    errs = lint(plan, {"L22", "L24"}, meta)
    assert any("L24" in e for e in errs), errs


# A1 — a passthrough delta-chain with a prior same-stage frame is fine.
def test_delta_chain_passthrough_with_prior_in_stage_ok():
    plan = {"shots": [
        {"id": "L05", "background": {"mode": "plate", "plate": "scenes/L05.png"}, "layers": []},
        _passthrough("L06", "L05")]}
    meta = _meta(("L05", "para"), ("L06", "para"))
    assert lint(plan, {"L05", "L06"}, meta) == []


# A2 — a scenes/<ref>.png plate that reuses ANOTHER shot's baked scene across a stage boundary is the
# mechanical shadow of the re-base rule (no chaining across stages). Hybrid here so A1 is skipped.
def test_plate_reuse_across_stages_fails():
    plan = {"shots": [{"id": "L24", "background": {"mode": "delta-chain", "plate": "scenes/L22.png"},
            "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "x",
                        "animation": {"type": "appear", "style": "pop"}}]}]}
    meta = _meta(("L22", "empty-swamp"), ("L24", "swamp-con"))
    errs = lint(plan, {"L22", "L24"}, meta)
    assert any("L24" in e and "stage" in e for e in errs), errs


# A2 — same stage, earlier ref -> the legit hybrid plate reuse, no flag.
def test_plate_reuse_same_stage_ok():
    plan = {"shots": [{"id": "L23", "background": {"mode": "delta-chain", "plate": "scenes/L22.png"},
            "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "x",
                        "animation": {"type": "appear", "style": "pop"}}]}]}
    meta = _meta(("L22", "swamp"), ("L23", "swamp"))
    assert lint(plan, {"L22", "L23"}, meta) == []


# A2 — a plates/<id>.png plate (a freshly generated plate, not a scene reuse) is exempt.
def test_plates_dir_plate_is_exempt_from_reuse_check():
    plan = {"shots": [{"id": "L16", "background": {"mode": "delta-chain", "plate": "plates/L15.png"},
            "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "x",
                        "animation": {"type": "appear", "style": "pop"}}]}]}
    meta = _meta(("L15", "map"), ("L16", "map"))
    assert lint(plan, {"L15", "L16"}, meta) == []


# A2 — a plate referencing the shot's OWN baked scene (scenes/<self>.png) is always fine.
def test_self_scene_reference_ok():
    plan = {"shots": [{"id": "L01", "background": {"mode": "plate", "plate": "scenes/L01.png"}, "layers": []}]}
    meta = _meta(("L01", None))
    assert lint(plan, {"L01"}, meta) == []


# A2 — a scenes/<ref>.png plate pointing FORWARD (ref not earlier) cannot be a seed source.
def test_forward_scene_reference_fails():
    plan = {"shots": [{"id": "L05", "background": {"mode": "plate", "plate": "scenes/L09.png"}, "layers": []}]}
    meta = _meta(("L05", "s"), ("L09", "s"))
    errs = lint(plan, {"L05", "L09"}, meta)
    assert any("L05" in e for e in errs), errs


# A3 — a non-cutout layer source (the retired engine device family) surfaces through lint_motion_plan
# (via validate_plan), not just the raw validator.
def test_engine_layer_source_surfaces_through_lint():
    plan = {"shots": [{"id": "L01", "background": {"mode": "plate", "plate": "scenes/L01.png"},
            "layers": [{"id": "card", "source": "engine", "kind": "stat-card", "content": {"text": "8M"}}]}]}
    errs = lint(plan, {"L01"})
    assert any("L01" in e and "cutout" in e for e in errs), errs


def main():
    for fn in [test_clean_plan_passes, test_unknown_shot_id_fails, test_cutout_without_prompt_fails,
               test_cutout_with_reuse_and_no_prompt_ok,
               test_hybrid_seeding_from_baked_base_is_ok, test_hybrid_seeding_from_a_hybrid_base_errors,
               test_delta_chain_passthrough_without_stage_fails,
               test_delta_chain_passthrough_first_in_stage_fails,
               test_delta_chain_passthrough_with_prior_in_stage_ok,
               test_plate_reuse_across_stages_fails, test_plate_reuse_same_stage_ok,
               test_plates_dir_plate_is_exempt_from_reuse_check, test_self_scene_reference_ok,
               test_forward_scene_reference_fails, test_engine_layer_source_surfaces_through_lint]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
