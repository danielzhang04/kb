#!/usr/bin/env python3
"""Plain-assert fake-backed tests for the P6 matched-register driver."""
import json
import sys
import tempfile
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _tmp():
    return Path(tempfile.mkdtemp(prefix="p6-matched-"))


def _baseline_fixture(p6, root):
    baseline = root / "baselines"
    baseline.mkdir()
    data = json.loads(p6.REGISTERS_PATH.read_text(encoding="utf-8"))
    for shot in data["shots"]:
        Image.new("RGB", (16, 16), (120, 130, 140)).save(baseline / f"{shot}.png")
    return baseline


def test_cells_and_staging_names_are_exactly_the_eight_one_shot_contract():
    import p6_matched as p6

    cells = p6.driver_cells()
    assert [cell["shot"] for cell in cells] == list(p6.TARGET_SHOTS)
    assert sum(cell["gens"] for cell in cells) == p6.GEN_BUDGET == 8
    assert [p6.staged_name(cell) for cell in cells] == [f"{shot}-p6-match-r1" for shot in p6.TARGET_SHOTS]
    assert p6.STYLE_EXEMPLAR == p6.BASELINE_DIR / "L47.png"


def test_derivation_uses_forge_content_seeds_and_suppresses_only_the_synthetic_tile():
    import p6_matched as p6

    root = _tmp()
    baseline = _baseline_fixture(p6, root)
    saved = p6.BASELINE_DIR, p6.STYLE_EXEMPLAR
    p6.BASELINE_DIR, p6.STYLE_EXEMPLAR = baseline, baseline / "L47.png"
    try:
        derived = p6.derive_corpus(fake_seed_dir=root / "seed-placeholders")
    finally:
        p6.BASELINE_DIR, p6.STYLE_EXEMPLAR = saved
    assert set(derived["items"]) == set(p6.TARGET_SHOTS)
    tile = p6.CANONICAL_TILE.resolve()
    assert all(tile not in [Path(seed).resolve() for seed in seeds] for seeds in derived["seeds"].values())
    assert all(len(derived["seeds"][shot]) + 1 <= p6.fc.TRANSPORT_SEED_CEILING for shot in p6.TARGET_SHOTS)
    assert derived["suppressed_tiles"]["L26"] == 1
    assert all(paths for paths in derived["fake_seed_placeholders"].values())
    substitutions = derived["baseline_content_seed_substitutions"]
    # Environment-dependent branch: substitution fires only when a forge-named STEP-1
    # plate is ABSENT from kit staging. On plate-staged machines this dict is legally
    # empty (every seed resolves), so a >=1 count cannot be pinned against the live
    # derivation — proven both ways live on 2026-08-13 (plate-less fix worktree fired
    # it; plate-staged arc worktree did not). Pin consistency instead of count.
    assert set(substitutions) <= {"L29", "L33", "L44", "L46"}
    for shot, paths in substitutions.items():
        assert paths, f"{shot}: substitution recorded with no paths"
        assert all(Path(p).stem in p6.TARGET_SHOTS for p in paths)
        assert not set(paths) & set(derived["fake_seed_placeholders"].get(shot, []))


def test_l33_prompt_is_the_exact_p6_shape_with_l31_last_and_no_bible_ink_leak():
    import p6_matched as p6

    root = _tmp()
    baseline = _baseline_fixture(p6, root)
    saved = p6.BASELINE_DIR, p6.STYLE_EXEMPLAR
    p6.BASELINE_DIR, p6.STYLE_EXEMPLAR = baseline, baseline / "L47.png"
    try:
        derived = p6.derive_corpus(fake_seed_dir=root / "seed-placeholders")
    finally:
        p6.BASELINE_DIR, p6.STYLE_EXEMPLAR = saved
    registers = p6.load_registers()
    item = derived["items"]["L33"]
    prompt = p6.compose_matched(item, derived["kit"].reg, (1376, 768), "16:9",
                                register=registers["L33"])
    lines = prompt.splitlines()
    assert [line.split(":", 1)[0] for line in lines] == [
        "Use case", "Asset type", "Style/medium", "Primary request", "Input images",
        "Composition/framing", "Color palette", "Constraints", "Avoid"]
    assert "Image 5: style reference ONLY" in prompt
    assert "soft light gradients and subtle contact shadows are required" in prompt
    assert "gradients and cast shadows" not in prompt
    assert "#241a12" not in prompt or registers["L33"]["ink_hex"] == "#241a12"
    content_parts = [part for part in lines[4].split("; ")
                     if part.startswith("Image ") and "style reference ONLY" not in part]
    assert content_parts and all("do not copy its background or style" in part for part in content_parts)


def test_fake_driver_completes_then_resumes_all_eight_without_subprocess_generations():
    import p6_matched as p6

    tmp = _tmp()
    baseline = _baseline_fixture(p6, tmp)
    zero = {"m1": 0.0, "m2": 0.0, "m3": 0, "m4": 0.0}
    register_data = json.loads(p6.REGISTERS_PATH.read_text(encoding="utf-8"))
    saved = (p6.fc.CODEX_ARGV_PREFIX, p6.fc.IMAGE_ROOT, p6.fc.SESSIONS_ROOT, p6.fc.TIMEOUT_S,
             p6.BASELINE_DIR, p6.STYLE_EXEMPLAR, p6.sm.baseline_table)
    p6.BASELINE_DIR, p6.STYLE_EXEMPLAR = baseline, baseline / "L47.png"
    p6.sm.baseline_table = lambda _path: {shot: dict(zero) for shot in register_data["shots"]}
    try:
        first = p6.run_driver(results_dir=tmp, fake=True)
        assert first["this_run"]["subprocess_generations"] == 8
        assert len(first["paired_rows"]) == 8
        assert all(len(row["refs_used"]) <= 5 for row in first["paired_rows"])
        assert (tmp / "p6-results.jsonl").is_file() and (tmp / "p6-report.md").is_file()
        second = p6.run_driver(results_dir=tmp, fake=True)
        assert second["this_run"]["subprocess_generations"] == 0
        assert second["this_run"]["skipped"] == 8
    finally:
        (p6.fc.CODEX_ARGV_PREFIX, p6.fc.IMAGE_ROOT, p6.fc.SESSIONS_ROOT, p6.fc.TIMEOUT_S,
         p6.BASELINE_DIR, p6.STYLE_EXEMPLAR, p6.sm.baseline_table) = saved


def test_real_mode_refuses_before_any_driver_work():
    import p6_matched as p6

    saved, called = p6.run_driver, []
    p6.run_driver = lambda **kwargs: called.append(kwargs)
    try:
        rc = p6.main(["--results-dir", str(_tmp())])
    finally:
        p6.run_driver = saved
    assert rc == 2 and called == []


ALL_TESTS = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

if __name__ == "__main__":
    for function in ALL_TESTS:
        function()
        print(f"  ok  {function.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
