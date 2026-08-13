#!/usr/bin/env python3
"""Plain-assert tests for P8 composition, fake generation, and delta banking."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _tmp():
    return Path(tempfile.mkdtemp(prefix="p8-matched-"))


def _register():
    return {"ink_hex": "#0f0f0c", "palette": [
        {"hex": "#697c7d", "coverage": .2, "is_accent": False},
        {"hex": "#b0bbb7", "coverage": .2, "is_accent": False},
        {"hex": "#ede9cf", "coverage": .2, "is_accent": False},
        {"hex": "#839191", "coverage": .15, "is_accent": False},
        {"hex": "#9ea9a5", "coverage": .15, "is_accent": False},
        {"hex": "#678c99", "coverage": .1, "is_accent": True},
    ], "fill_modes": [{"hex": "#d4d4ac", "share": 1.0}]}


def test_l36_contract_prose_is_verbatim_and_camera_is_first_in_composition():
    import p8_matched as p8

    contracts = p8.load_contracts()
    prompt = p8.compose_matched({"payload": "A placeholder scene.", "seed_roles": []}, {}, (1376, 768), "16:9",
                                register=_register(), shot="L36", contracts=contracts, style_path="anchor.png")
    spec = contracts["shots"]["L36"]
    for clause in [spec["camera"], *spec["surfaces"], *spec["counts"], *spec["negatives"],
                   *spec["pose"], *spec["emitters"], *spec["orientation"]]:
        assert clause in prompt
    composition = prompt.split("Composition: ", 1)[1]
    assert composition.startswith(spec["camera"])
    assert "Surfaces:" in prompt and "Counts:" in prompt and "Inventory negatives:" in prompt
    assert "Emitters: none." in prompt and "Orientation:" in prompt
    assert p8.CLOSED_INVENTORY in prompt and p8.FLAT_MATERIAL in prompt


def test_fake_full_slate_delta_only_two_and_resume_banking():
    import p8_matched as p8
    import p8_register as p8r

    root, registers = _tmp(), _tmp() / "p8-registers.json"
    p8r.write_registers(registers)
    first = p8.run_driver(results_dir=root, mode="fake", register_path=registers)
    assert first["shots"] == list(p8.TARGET_SHOTS)
    assert first["this_run"]["subprocess_generations"] == 8
    rows = [json.loads(line) for line in (root / "p8-results.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 8 and {row["shot"] for row in rows} == set(p8.TARGET_SHOTS)
    deltas_path = root / "deltas.json"
    deltas = {"L36": ["Delta clause L36 â€” preserve every bill edge."],
              "L50": ["Delta clause L50 â€” keep lamp cone visible."]}
    deltas_path.write_text(json.dumps(deltas), encoding="utf-8")
    second = p8.run_driver(results_dir=root, mode="fake", shots=("L36", "L50"), deltas=p8._load_deltas(deltas_path),
                            register_path=registers)
    assert second["round"] == 2 and second["this_run"]["subprocess_generations"] == 2
    rows = [json.loads(line) for line in (root / "p8-results.jsonl").read_text(encoding="utf-8").splitlines()]
    r2 = [row for row in rows if row["variant"] == "match-r2"]
    assert {row["shot"] for row in r2} == {"L36", "L50"}
    assert all(Path(row["png"]).name == f"{row['shot']}-p8-match-r2.png" for row in r2)
    prompt = (root / "p8-staging" / "_codex" / "prompts" / "L36-p8-match-r2.txt").read_text(encoding="utf-8")
    assert deltas["L36"][0] in prompt
    resumed = p8.run_driver(results_dir=root, mode="fake", register_path=registers)
    assert resumed["this_run"]["run_item_calls"] == 0 and resumed["this_run"]["skipped"] == 8


def test_shots_filter_and_real_gate_are_pinned():
    import p8_matched as p8

    calls, saved = [], p8.run_driver
    p8.run_driver = lambda **kwargs: calls.append(kwargs) or {"ok": True}
    try:
        assert p8.main(["--mode", "fake", "--results-dir", str(_tmp()), "--shots", "L36,L50"]) == 0
        assert calls[0]["shots"] == ("L36", "L50")
        assert p8.main(["--results-dir", str(_tmp())]) == 2
    finally:
        p8.run_driver = saved


ALL_TESTS = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

if __name__ == "__main__":
    for function in ALL_TESTS:
        function()
        print(f"  ok  {function.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
