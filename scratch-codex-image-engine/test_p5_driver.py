#!/usr/bin/env python3
"""Plain-assert acceptance tests for p5_driver.  Every generation uses _fake_codex.py."""
import json
import sys
import tempfile
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _tmp(prefix="p5driver-"):
    return Path(tempfile.mkdtemp(prefix=prefix))


def test_driver_filters_duplicate_l1_variant_to_40_cells_and_24_generations():
    import p5_driver as p5

    cells = p5.driver_cells()
    assert len(cells) == 40
    assert sum(cell["gens"] for cell in cells) == 24
    assert not any(cell["lever"] == "L1" and
                   cell["variant"] == "tile-on-short-label" for cell in cells)
    assert sum(cell["gens"] for cell in cells if cell["lever"] == "L0") == 8
    assert sum(cell["gens"] for cell in cells if cell["lever"] == "L1") == 8
    assert sum(cell["gens"] for cell in cells if cell["lever"] == "L2") == 8


def test_cell_to_runoptions_mapping_pins_both_l1_names_and_both_l2_formats():
    import p5_driver as p5

    tile = str(p5.CANONICAL_TILE.resolve())
    base = p5.options_for_cell({"lever": "L0", "variant": "base"})
    assert base == p5.fc.RunOptions()
    l1a = p5.options_for_cell({"lever": "L1", "variant": "tile-on"})
    l1b = p5.options_for_cell({"lever": "L1", "variant": "tile-on-short-label"})
    assert l1a == l1b == p5.fc.RunOptions(register_seed_tile=tile)
    labeled = p5.options_for_cell({"lever": "L2", "variant": "format2-labeled"})
    minimal = p5.options_for_cell({"lever": "L2", "variant": "format3-minimal"})
    assert labeled == p5.fc.RunOptions(fmt="labeled")
    assert minimal == p5.fc.RunOptions(fmt="minimal")
    assert all(not opts.force for opts in (base, l1a, l1b, labeled, minimal))


def test_staging_names_are_collision_free_for_every_source_ladder_cell():
    import p5_driver as p5

    cells = p5.sr.ladder()
    fake_names = [p5.staged_name(cell, run_id="pin", fake=True) for cell in cells
                  if cell["lever"] != "L3"]
    real_names = [p5.staged_name(cell, run_id="pin", fake=False) for cell in cells
                  if cell["lever"] != "L3"]
    assert len(fake_names) == len(set(fake_names)) == 32
    assert len(real_names) == len(set(real_names)) == 32
    assert set(fake_names).isdisjoint(real_names)
    assert all(Path(name).name == name and "/" not in name and "\\" not in name
               for name in fake_names + real_names)


def test_corpus_is_forge_derived_with_canonical_request_seeds():
    import p5_driver as p5

    got = p5.derive_corpus()
    assert set(got["items"]) == set(p5.sm.CORPUS)
    roles = {shot: [entry["role"] for entry in got["items"][shot]["seed_roles"]]
             for shot in p5.sm.CORPUS}
    assert roles == {
        "L26": ["style-anchor"],
        "L44": ["figure"],
        "L33": ["figure", "figure", "interaction"],
        "L29": ["figure", "environment"],
    }
    assert Path(got["seeds"]["L26"][0]).resolve() == p5.CANONICAL_TILE.resolve()
    assert all(Path(seed).is_file() for seeds in got["seeds"].values() for seed in seeds)


def test_generate_fn_calls_run_item_against_fake_and_stages_a_real_png():
    import p5_driver as p5

    tmp = _tmp("p5driver-fake-")
    derived = p5.derive_corpus()
    derived["kit"].staging = str(tmp / "staging")
    Path(derived["kit"].staging).mkdir()
    saved = (p5.fc.CODEX_ARGV_PREFIX, p5.fc.IMAGE_ROOT, p5.fc.SESSIONS_ROOT, p5.fc.TIMEOUT_S)
    try:
        p5.configure_fake(tmp, "ok")
        stats = {"run_item_calls": 0, "subprocess_generations": 0}
        generate = p5.make_generate_fn(derived, run_id="unit", fake=True, stats=stats)
        cell = {"lever": "L2", "shot": "L29", "variant": "format3-minimal",
                "rep": 1, "gens": 1}
        out = Path(generate(cell))
        assert out.is_file() and Image.open(out).size == p5.fc.resolve_canvas("16:9", "1K")
        assert stats == {"run_item_calls": 1, "subprocess_generations": 1}
        prompt = Path(derived["kit"].staging) / "_codex" / "prompts" / (out.stem + ".txt")
        assert prompt.is_file() and "Avoid:" in prompt.read_text(encoding="utf-8")
    finally:
        (p5.fc.CODEX_ARGV_PREFIX, p5.fc.IMAGE_ROOT,
         p5.fc.SESSIONS_ROOT, p5.fc.TIMEOUT_S) = saved


def test_l3_normalize_fn_uses_both_forge_canvases_without_generation():
    import p5_driver as p5

    tmp = _tmp("p5driver-normalize-")
    source = tmp / "source.png"
    Image.new("RGB", (1672, 941), (36, 26, 18)).save(source)
    normalize = p5.make_normalize_fn(tmp)
    one = Path(normalize(source, "1K"))
    two = Path(normalize(source, "2K"))
    assert Image.open(one).size == p5.fc.resolve_canvas("16:9", "1K")
    assert Image.open(two).size == p5.fc.resolve_canvas("16:9", "2K")
    assert source.is_file()


def test_real_mode_refuses_without_boss_go_before_any_driver_work():
    import p5_driver as p5

    saved = p5.run_driver
    called = []
    p5.run_driver = lambda **kwargs: called.append(kwargs)
    try:
        rc = p5.main(["--results-dir", str(_tmp("p5driver-refusal-"))])
    finally:
        p5.run_driver = saved
    assert rc == 2 and called == []


def test_report_computes_pairing_spread_and_executes_floor():
    import p5_driver as p5

    cells = p5.driver_cells()
    rows = []
    for index, cell in enumerate(cells):
        rows.append(dict(cell, png=f"/fake/{index}.png", m1=2.0 + cell["rep"],
                         m2=0.7, m3=8, m4=0.01))
    baselines = {shot: {"m1": 1.0, "m2": 0.7, "m3": 8, "m4": 0.01}
                 for shot in p5.sm.CORPUS}
    bands = {"m1": 10.0, "m2": 0.1, "m3": 2.0, "m4": 0.01}
    items = {shot: {"name": shot, "aspect": "16:9", "seed_roles": []}
             for shot in p5.sm.CORPUS}
    seeds = {shot: [] for shot in p5.sm.CORPUS}
    report = p5.build_report(
        cells=cells, result_rows=rows, baselines=baselines, bands=bands,
        run_summary={"gens_used": 24, "skipped": 0, "stopped_levers": [],
                     "budget_remaining": 16, "results_path": "/fake/results.jsonl"},
        stats={"run_item_calls": 24, "subprocess_generations": 24},
        fake=True, fake_mode="ok", run_id="unit", root_overridden=True,
        derived_items=items, derived_seeds=seeds)
    assert len(report["paired_rows"]) == 40
    assert all(report["l0_within_cell_spread"][shot]["m1"] == 1.0
               for shot in p5.sm.CORPUS)
    assert report["l0_floor"]["verdict"]["pass"] is True
    assert set(report["l0_floor"]["per_rep"]) == {"1", "2"}
    assert "| L0 | base | L26 | 1 |" in p5.report_markdown(report)


ALL_TESTS = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

if __name__ == "__main__":
    for function in ALL_TESTS:
        function()
        print(f"  ok  {function.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
