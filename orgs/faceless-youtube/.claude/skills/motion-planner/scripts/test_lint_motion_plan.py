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


def main():
    for fn in [test_clean_plan_passes, test_unknown_shot_id_fails, test_cutout_without_prompt_fails,
               test_hybrid_seeding_from_baked_base_is_ok, test_hybrid_seeding_from_a_hybrid_base_errors]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
