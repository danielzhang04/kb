#!/usr/bin/env python3
"""Plain-assert tests for the P7 composer and its safety interlocks."""
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _tmp():
    return Path(tempfile.mkdtemp(prefix="p7-matched-"))


def _register():
    return {"ink_hex": "#0f0f0c", "palette": [
        {"hex": "#697c7d", "coverage": .2, "is_accent": False},
        {"hex": "#b0bbb7", "coverage": .2, "is_accent": False},
        {"hex": "#ede9cf", "coverage": .2, "is_accent": False},
        {"hex": "#839191", "coverage": .15, "is_accent": False},
        {"hex": "#9ea9a5", "coverage": .15, "is_accent": False},
        {"hex": "#678c99", "coverage": .1, "is_accent": True},
    ]}


def test_l28_composer_preserves_verbatim_contract_and_lettering_exception():
    import p7_matched as p7

    prompt = p7.compose_matched({"payload": "A placeholder scene.", "seed_roles": []}, {}, (1376, 768), "16:9", register=_register(), shot="L28", style_path="anchor.png")
    assert p7.SHOT_SPEC["L28"]["composition"] in prompt
    assert p7.SHOT_SPEC["L28"]["dressing"] in prompt
    assert p7.SHOT_SPEC["L28"]["lettering_treatment"] in prompt
    assert "words, letters, numerals or signage other than the exact string(s) specified in the Lettering line" in prompt
    assert "vivid steel-blue #678c99 — the bench work mats" in prompt


def test_every_shot_composes_its_full_contract_expression_and_explicit_lettering_fields():
    import p7_matched as p7

    full_l28_treatment = p7.SHOT_SPEC["L28"]["lettering_treatment"]
    for shot, spec in p7.SHOT_SPEC.items():
        prompt = p7.compose_matched({"payload": "A placeholder scene.", "seed_roles": []}, {},
                                    (1376, 768), "16:9", register=_register(), shot=shot,
                                    style_path="anchor.png")
        assert spec["composition"] in prompt, shot
        if spec.get("expression"):
            assert f"Expression geometry: {spec['expression']}" in prompt, shot
        assert isinstance(spec["lettering_strings"], list), shot
        assert isinstance(spec["lettering_treatment"], str), shot
        assert "as L28" not in spec["lettering_treatment"], shot
        if spec["lettering_strings"]:
            assert "text allowed VERBATIM and nothing else:" in prompt, shot
            for literal in spec["lettering_strings"]:
                assert f'"{literal}"' in prompt, (shot, literal)
        else:
            assert "text allowed VERBATIM and nothing else:" not in prompt, shot
    for shot in ("L29", "L33", "L44"):
        assert p7.SHOT_SPEC[shot]["lettering_treatment"] == full_l28_treatment


def test_lettering_allowlist_handles_multiple_strings_without_collapsing_them():
    import p7_matched as p7

    lines = p7._lettering_lines(["FIRST LABEL", "SECOND LABEL"],
                                 "two separate cream signboards")
    assert lines[0] == "Lettering: two separate cream signboards"
    assert lines[1].endswith('"FIRST LABEL"; "SECOND LABEL".')


def test_expression_geometry_and_non_lettering_no_words_ban_are_explicit():
    import p7_matched as p7

    prompt = p7.compose_matched({"payload": "A placeholder scene.", "seed_roles": []}, {}, (1376, 768), "16:9", register=_register(), shot="L27", style_path="anchor.png")
    assert "Expression geometry: deadpan — half-lidded flat eyes, tiny straight mouth, no smile." in prompt
    assert "any words, letters, numerals or signage" in prompt
    assert "other than the exact string(s) specified in the Lettering line" not in prompt


def test_ref_cap_trims_the_place_reference_before_the_style_anchor():
    import p7_matched as p7

    roles = [{"role": "figure", "path": "figure-a.png"}, {"role": "figure", "path": "figure-b.png"},
             {"role": "environment", "path": "lettering-marker-italic.png"}, {"role": "place", "path": "place.png"},
             {"role": "style-anchor", "path": "anchor.png"}, {"role": "figure", "path": "figure-c.png"}]
    kept_roles, kept_paths, trims = p7.trim_references(roles, [role["path"] for role in roles], cap=5)
    assert len(kept_roles) == len(kept_paths) == 5
    assert trims == [{"role": "place", "path": "place.png", "reason": "P7 ref cap"}]
    assert kept_paths[-2] == "anchor.png" or "anchor.png" in kept_paths


def test_ref_cap_without_a_place_never_drops_figure_or_lettering_references():
    import p7_matched as p7

    roles = [*({"role": "prop", "path": f"prop-{index}.png"} for index in range(4)),
             {"role": "figure", "path": "figure.png"},
             {"role": "environment", "path": "lettering-marker-italic.png"}]
    kept_roles, kept_paths, trims = p7.trim_references(
        roles, [role["path"] for role in roles], cap=4)
    assert len(kept_roles) == len(kept_paths) == 4
    assert "figure.png" in kept_paths and "lettering-marker-italic.png" in kept_paths
    assert len(trims) == 2 and all(row["role"] == "prop" for row in trims)


def test_load_register_data_recomputes_and_rejects_a_stale_anchor_table():
    import p7_matched as p7

    data = json.loads(p7.REGISTERS_PATH.read_text(encoding="utf-8"))
    shot = p7.TARGET_SHOTS[0]
    computed = p7.p7r.choose_anchor(shot, data["shots"])
    data["anchors"][shot] = next(name for name in sorted(data["shots"])
                                  if name not in (shot, computed))
    path = _tmp() / "poisoned-register.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    try:
        p7.load_register_data(path)
    except RuntimeError as exc:
        message = str(exc)
        assert shot in message and data["anchors"][shot] in message and computed in message
    else:
        raise AssertionError("stale P7 anchor table was accepted")


def test_resume_report_uses_banked_provenance_and_flags_seed_evidence_mismatch():
    import p7_matched as p7

    banked_anchor = "BANKED-ANCHOR"
    results, baselines, engine_rows = [], {}, {}
    for index, shot in enumerate(p7.TARGET_SHOTS):
        cell = {"lever": "P7", "shot": shot, "variant": "match", "rep": 1, "gens": 1}
        provenance = {
            "anchor": banked_anchor,
            "refs_used": [{"role": "figure", "path": f"C:/banked/{shot}.png"}],
            "ref_trims": [{"role": "place", "path": f"C:/trim/{shot}.png", "reason": "P7 ref cap"}],
        }
        results.append(dict(cell, png=f"C:/out/{shot}.png", provenance=provenance,
                            m1=1.0, m2=2.0, m3=3, m4=4.0))
        baselines[shot] = {"m1": 1.0, "m2": 2.0, "m3": 3, "m4": 4.0}
        evidence_path = (f"C:/wrong/{shot}.png" if index == 0 else f"C:/banked/{shot}.png")
        engine_rows[p7.staged_name(cell)] = {
            "fidelity_audit": "verified", "seed_sha256": {evidence_path: "abc"}}
    current_data = {"anchors": {shot: "CURRENT-ANCHOR" for shot in p7.TARGET_SHOTS},
                    "shots": {}}
    report = p7.build_report(
        results=results, baselines=baselines,
        derived={"kit": SimpleNamespace(staging="C:/staging"), "root_overridden": False,
                 "fake_seed_placeholders": {}, "baseline_content_seed_substitutions": {}},
        engine_rows=engine_rows, run_summary={"skipped": len(results)},
        stats={"run_item_calls": 0, "subprocess_generations": 0, "engine_rows": {}},
        data=current_data, fake=True, fake_mode="ok")
    assert all(row["anchor"] == banked_anchor for row in report["paired_rows"])
    assert report["paired_rows"][0]["seed_evidence_mismatch"]
    assert not report["paired_rows"][1]["seed_evidence_mismatch"]


def test_fake_run_banks_trim_logging_end_to_end_and_resume_reads_the_same_rows():
    import p7_matched as p7

    root = _tmp()
    data = json.loads(p7.REGISTERS_PATH.read_text(encoding="utf-8"))
    baseline = root / "baselines"
    baseline.mkdir()
    for shot in data["shots"]:
        Image.new("RGB", (16, 16), (120, 130, 140)).save(baseline / f"{shot}.png")
    zero = {"m1": 0.0, "m2": 0.0, "m3": 0, "m4": 0.0}
    saved = (p7.BASELINE_DIR, p7.sm.baseline_table, p7.fc.CODEX_ARGV_PREFIX,
             p7.fc.IMAGE_ROOT, p7.fc.SESSIONS_ROOT, p7.fc.TIMEOUT_S)
    p7.BASELINE_DIR = baseline
    p7.sm.baseline_table = lambda _path: {shot: dict(zero) for shot in data["shots"]}
    try:
        first = p7.run_driver(results_dir=root, fake=True)
        rows = [json.loads(line) for line in
                (root / "p7-results.jsonl").read_text(encoding="utf-8").splitlines()]
        l33 = next(row for row in rows if row["shot"] == "L33")
        report_l33 = next(row for row in first["paired_rows"] if row["shot"] == "L33")
        assert l33["provenance"]["ref_trims"]
        assert report_l33["ref_trims"] == l33["provenance"]["ref_trims"]
        assert report_l33["refs_used"] == l33["provenance"]["refs_used"]
        resumed = p7.run_driver(results_dir=root, fake=True)
        assert resumed["this_run"]["run_item_calls"] == 0
        assert resumed["this_run"]["skipped"] == len(p7.TARGET_SHOTS)
        assert resumed["provenance_mismatches"] == []
    finally:
        (p7.BASELINE_DIR, p7.sm.baseline_table, p7.fc.CODEX_ARGV_PREFIX,
         p7.fc.IMAGE_ROOT, p7.fc.SESSIONS_ROOT, p7.fc.TIMEOUT_S) = saved


def test_results_dir_is_required_and_real_mode_refuses_before_driver_work():
    import p7_matched as p7

    try:
        p7.main(["--fake"])
    except SystemExit as exc:
        assert exc.code == 2
    else:
        raise AssertionError("missing --results-dir was accepted")
    saved, called = p7.run_driver, []
    p7.run_driver = lambda **kwargs: called.append(kwargs)
    try:
        assert p7.main(["--results-dir", str(_tmp())]) == 2
    finally:
        p7.run_driver = saved
    assert called == []


ALL_TESTS = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

if __name__ == "__main__":
    for function in ALL_TESTS:
        function()
        print(f"  ok  {function.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
