#!/usr/bin/env python3
"""Unit tests for study_run.py (plain asserts, no pytest). NO GENERATIONS: generate_fn is a stub.
Run: py -3 test_study_run.py"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


def _results():
    return str(Path(tempfile.mkdtemp(prefix="study-")) / "p5-study-results.jsonl")


def test_ladder_shape_and_gen_counts_match_the_spec_budget():
    import study_run as sr
    l0 = sr.ladder(("L0",))
    assert len(l0) == 8 and sum(c["gens"] for c in l0) == 8
    assert sorted({c["shot"] for c in l0}) == sorted(sr.CORPUS)
    assert sorted({c["rep"] for c in l0}) == [1, 2]
    assert sum(c["gens"] for c in sr.ladder(("L1",))) <= 16
    assert sum(c["gens"] for c in sr.ladder(("L2",))) == 8
    assert sum(c["gens"] for c in sr.ladder(("L3",))) == 0
    assert sum(c["gens"] for c in sr.ladder()) <= sr.GEN_BUDGET


def test_budget_is_hard_and_refuses_the_forty_first_generation():
    import study_run as sr
    b = sr.Budget(sr.GEN_BUDGET)
    b.spend(39)
    assert b.remaining == 1
    b.spend(1)
    raised = None
    try:
        b.spend(1)
    except sr.BudgetExceeded as e:
        raised = str(e)
    assert raised is not None and "40" in raised


def test_run_study_writes_results_incrementally_and_is_resumable():
    import study_run as sr
    path = _results()
    calls = []

    def gen(cell):
        calls.append(cell["shot"])
        return f"/fake/{cell['lever']}-{cell['shot']}-{cell['rep']}.png"

    def meas(_png):
        return {"m1": 2.0, "m2": 0.70, "m3": 8, "m4": 0.01}

    out = sr.run_study(cells=sr.ladder(("L0",)), generate_fn=gen, measure_fn=meas,
                       results_path=path, budget=sr.Budget(sr.GEN_BUDGET))
    assert out["gens_used"] == 8 and len(calls) == 8
    rows = sr.load_results(path)
    assert len(rows) == 8 and all("m1" in r for r in rows)

    calls.clear()
    out2 = sr.run_study(cells=sr.ladder(("L0",)), generate_fn=gen, measure_fn=meas,
                        results_path=path, budget=sr.Budget(sr.GEN_BUDGET))
    assert calls == [] and out2["gens_used"] == 0 and out2["skipped"] == 8


def test_run_study_stops_a_lever_that_worsens_m1_by_more_than_three():
    import study_run as sr
    path = _results()
    seen = []

    def gen(cell):
        seen.append(cell)
        return "/fake/x.png"

    def meas(_png):
        # every L1 cell is 4.0 worse than the best-so-far seeded below
        return {"m1": 9.0, "m2": 0.70, "m3": 8, "m4": 0.01}

    sr.append_result(path, {"lever": "L0", "shot": "L26", "variant": "base", "rep": 1,
                            "png": "/fake/base.png", "m1": 1.0, "m2": 0.7, "m3": 8, "m4": 0.01,
                            "d_m1": 1.0})
    out = sr.run_study(cells=sr.ladder(("L1",)), generate_fn=gen, measure_fn=meas,
                       results_path=path, budget=sr.Budget(sr.GEN_BUDGET),
                       baseline_m1={"L26": 0.0, "L44": 0.0, "L33": 0.0, "L29": 0.0})
    assert out["stopped_levers"] == ["L1"]
    assert out["gens_used"] < 16, "the lever must be abandoned, never rescued with more wordings"


def test_run_study_refuses_to_exceed_the_budget_mid_ladder():
    import study_run as sr
    path = _results()
    out = None
    raised = None
    try:
        out = sr.run_study(cells=sr.ladder(("L0",)), generate_fn=lambda c: "/fake/x.png",
                           measure_fn=lambda p: {"m1": 1.0, "m2": 0.7, "m3": 8, "m4": 0.01},
                           results_path=path, budget=sr.Budget(3))
    except sr.BudgetExceeded as e:
        raised = str(e)
    assert raised is not None and out is None
    assert len(sr.load_results(path)) == 3, "everything spent before the stop is banked"


ALL_TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]

if __name__ == "__main__":
    for fn in ALL_TESTS:
        fn()
        print(f"  ok  {fn.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
