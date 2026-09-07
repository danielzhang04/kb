"""Contract tests for the stage-2 perceptual judge (vlm_judge.py).

Every test here injects a fake `runner` (or monkeypatches `subprocess.run` for the one
test of the real CLI-argument-building path) -- NONE of these tests ever invokes the
real `claude` CLI. See `orgs/figment/personas/creator-001/calibration/` for the real,
subscription-billed calibration run this module's `calibrate()` was built to support.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def judge_module():
    return load_module("figment_test_vlm_judge", PIPELINE / "vlm_judge.py")


def _png(directory: Path, name: str) -> Path:
    from PIL import Image

    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{name}.png"
    Image.new("RGB", (8, 8), color=(120, 90, 90)).save(path)
    return path


def _envelope(result_text: str, *, is_error: bool = False, cost: float = 0.01) -> str:
    return json.dumps({
        "type": "result", "subtype": "success", "is_error": is_error,
        "duration_ms": 1234, "total_cost_usd": cost, "result": result_text,
    })


GOOD_PAYLOAD = {
    "same_person": 58, "apparent_age_reference": 23, "apparent_age_candidate": 30,
    "skin_realism": 55, "gloss": 40, "artifacts": 10, "notes": "kind of close, older, glossy",
}


# ---------------------------------------------------------------------------
# judge_image -- fake runner, no CLI
# ---------------------------------------------------------------------------


def test_judge_image_parses_envelope_and_result_json(judge_module, tmp_path):
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")
    calls = []

    def fake_runner(prompt, *, model, timeout=None):
        calls.append((prompt, model))
        return _envelope(json.dumps(GOOD_PAYLOAD))

    result = judge_module.judge_image(candidate, [reference], model="sonnet", runner=fake_runner)

    assert len(calls) == 1
    assert str(reference) in calls[0][0]
    assert str(candidate) in calls[0][0]
    assert result["image_id"] == "candidate"
    assert result["same_person"] == 58
    assert result["apparent_age_reference"] == 23
    assert result["apparent_age_candidate"] == 30
    assert result["age_delta"] == 7
    assert result["skin_realism"] == 55
    assert result["gloss"] == 40
    assert result["artifacts"] == 10
    assert result["notes"] == "kind of close, older, glossy"
    assert result["model"] == "sonnet"
    assert result["duration_s"] >= 0
    assert result["cost_usd"] == pytest.approx(0.01)
    assert result["cache_hit"] is False
    assert result["unavailable"] == {}


def test_judge_image_retries_once_on_non_json_result_then_succeeds(judge_module, tmp_path):
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")
    calls = {"n": 0}

    def fake_runner(prompt, *, model, timeout=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return _envelope("sorry, here is some prose, not JSON")
        return _envelope(json.dumps(GOOD_PAYLOAD))

    result = judge_module.judge_image(candidate, [reference], runner=fake_runner)
    assert calls["n"] == 2
    assert result["same_person"] == 58
    assert result["unavailable"] == {}


def test_judge_image_fails_closed_after_two_bad_results(judge_module, tmp_path):
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")
    calls = {"n": 0}

    def fake_runner(prompt, *, model, timeout=None):
        calls["n"] += 1
        return _envelope("still not JSON")

    result = judge_module.judge_image(candidate, [reference], runner=fake_runner)
    assert calls["n"] == 2
    assert result["same_person"] is None
    assert result["apparent_age_reference"] is None
    assert result["age_delta"] is None
    assert result["skin_realism"] is None
    assert result["gloss"] is None
    assert result["artifacts"] is None
    assert result["notes"] is None
    assert "judge" in result["unavailable"]


def test_judge_image_fails_closed_when_runner_raises(judge_module, tmp_path):
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")

    def boom(prompt, *, model, timeout=None):
        raise RuntimeError("subprocess exploded")

    result = judge_module.judge_image(candidate, [reference], runner=boom)
    assert result["same_person"] is None
    assert "subprocess exploded" in result["unavailable"]["judge"]


def test_judge_image_fails_closed_when_the_envelope_reports_is_error(judge_module, tmp_path):
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")

    def fake_runner(prompt, *, model, timeout=None):
        return _envelope("permission denied", is_error=True)

    result = judge_module.judge_image(candidate, [reference], runner=fake_runner)
    assert result["same_person"] is None
    assert "judge" in result["unavailable"]


def test_judge_image_fails_closed_with_no_references(judge_module, tmp_path):
    candidate = _png(tmp_path, "candidate")

    def boom(prompt, *, model, timeout=None):
        raise AssertionError("must never call the runner with zero references")

    result = judge_module.judge_image(candidate, [], runner=boom)
    assert result["same_person"] is None
    assert "judge" in result["unavailable"]


def test_judge_image_extracts_json_from_a_markdown_fence(judge_module, tmp_path):
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")
    fenced = "Here you go:\n```json\n" + json.dumps(GOOD_PAYLOAD) + "\n```\nHope that helps."

    def fake_runner(prompt, *, model, timeout=None):
        return _envelope(fenced)

    result = judge_module.judge_image(candidate, [reference], runner=fake_runner)
    assert result["same_person"] == 58


# ---------------------------------------------------------------------------
# cache
# ---------------------------------------------------------------------------


def test_judge_image_uses_cache_on_second_call_without_invoking_runner(judge_module, tmp_path):
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")
    cache_dir = tmp_path / "cache"
    calls = {"n": 0}

    def fake_runner(prompt, *, model, timeout=None):
        calls["n"] += 1
        return _envelope(json.dumps(GOOD_PAYLOAD))

    first = judge_module.judge_image(candidate, [reference], runner=fake_runner, cache_dir=cache_dir)
    second = judge_module.judge_image(candidate, [reference], runner=fake_runner, cache_dir=cache_dir)

    assert calls["n"] == 1
    assert first["cache_hit"] is False
    assert second["cache_hit"] is True
    assert second["same_person"] == first["same_person"]
    assert len(list(cache_dir.glob("*.json"))) == 1


def test_judge_image_cache_key_differs_by_model(judge_module, tmp_path):
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")
    cache_dir = tmp_path / "cache"
    calls = {"n": 0}

    def fake_runner(prompt, *, model, timeout=None):
        calls["n"] += 1
        return _envelope(json.dumps(GOOD_PAYLOAD))

    judge_module.judge_image(candidate, [reference], runner=fake_runner, cache_dir=cache_dir, model="sonnet")
    judge_module.judge_image(candidate, [reference], runner=fake_runner, cache_dir=cache_dir, model="opus")
    assert calls["n"] == 2
    assert len(list(cache_dir.glob("*.json"))) == 2


# ---------------------------------------------------------------------------
# judge_images_for_stage -- parallel batch
# ---------------------------------------------------------------------------


def test_judge_images_for_stage_preserves_order_and_judges_every_image(judge_module, tmp_path):
    reference = _png(tmp_path, "g01")
    images = [
        {"image_id": f"cell-{i}", "path": str(_png(tmp_path, f"cell-{i}"))} for i in range(6)
    ]

    def fake_runner(prompt, *, model, timeout=None):
        return _envelope(json.dumps(GOOD_PAYLOAD))

    rows = judge_module.judge_images_for_stage(images, [reference], runner=fake_runner, workers=4)
    assert [row["image_id"] for row in rows] == [item["image_id"] for item in images]
    assert all(row["same_person"] == 58 for row in rows)


def test_judge_images_for_stage_empty_list_returns_empty(judge_module):
    assert judge_module.judge_images_for_stage([], ["ref"], runner=lambda *a, **k: "{}") == []


# ---------------------------------------------------------------------------
# CLI parsing helpers -- envelope, JSON extraction, default runner argv
# ---------------------------------------------------------------------------


def test_parse_cli_envelope_returns_none_on_garbage(judge_module):
    assert judge_module.parse_cli_envelope("not json at all") is None
    assert judge_module.parse_cli_envelope("") is None
    assert judge_module.parse_cli_envelope("[]") is None  # a JSON array, not an object


def test_parse_cli_envelope_parses_a_real_shaped_envelope(judge_module):
    raw = _envelope(json.dumps(GOOD_PAYLOAD))
    envelope = judge_module.parse_cli_envelope(raw)
    assert envelope["result"] == json.dumps(GOOD_PAYLOAD)
    assert envelope["total_cost_usd"] == 0.01


def test_extract_json_object_handles_plain_prose_prefix(judge_module):
    text = "Sure, here's my assessment: " + json.dumps(GOOD_PAYLOAD)
    parsed = judge_module._extract_json_object(text)
    assert parsed["same_person"] == 58


def test_default_runner_builds_the_expected_cli_command(judge_module, monkeypatch):
    captured = {}

    class FakeCompleted:
        returncode = 0
        stdout = _envelope(json.dumps(GOOD_PAYLOAD))
        stderr = ""

    def fake_run(cmd, *, cwd, input, capture_output, text, timeout, env):
        captured["cmd"] = cmd
        captured["input"] = input
        captured["env"] = env
        captured["timeout"] = timeout
        return FakeCompleted()

    monkeypatch.setattr(judge_module.subprocess, "run", fake_run)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "should-never-be-forwarded")
    monkeypatch.setenv("PATH", "/fake/path")

    out = judge_module._default_runner("THE PROMPT", model="sonnet", timeout=42)

    assert captured["cmd"] == [
        "claude", "-p", "--model", "sonnet", "--output-format", "json",
        "--permission-mode", "bypassPermissions", "--allowedTools", "Read",
    ]
    assert captured["input"] == "THE PROMPT"
    assert captured["timeout"] == 42
    assert "ANTHROPIC_API_KEY" not in captured["env"]
    assert captured["env"]["PATH"] == "/fake/path"
    assert out == FakeCompleted.stdout


def test_default_runner_raises_judge_error_on_nonzero_exit(judge_module, monkeypatch):
    class FakeCompleted:
        returncode = 1
        stdout = ""
        stderr = "boom"

    monkeypatch.setattr(judge_module.subprocess, "run", lambda *a, **k: FakeCompleted())
    with pytest.raises(judge_module.JudgeError, match="exited 1"):
        judge_module._default_runner("prompt", model="sonnet")


# ---------------------------------------------------------------------------
# judge_gate -- fail-closed threshold logic
# ---------------------------------------------------------------------------


JUDGE_THRESHOLDS = {
    "same_person_min": 80, "age_delta_max": 4, "skin_realism_min": 75,
    "gloss_max": 20, "artifacts_max": 30,
}

GOOD_JUDGE_ROW = {
    "same_person": 95, "age_delta": 1, "skin_realism": 90, "gloss": 5, "artifacts": 5,
}


def test_judge_gate_passes_when_every_metric_clears_its_threshold(judge_module):
    result = judge_module.judge_gate(GOOD_JUDGE_ROW, JUDGE_THRESHOLDS)
    assert result == {"pass": True, "reasons": []}


def test_judge_gate_fails_closed_on_none_row(judge_module):
    result = judge_module.judge_gate(None, JUDGE_THRESHOLDS)
    assert result == {"pass": False, "reasons": ["unavailable: judge"]}


@pytest.mark.parametrize("field", ["same_person", "age_delta", "skin_realism", "gloss", "artifacts"])
def test_judge_gate_fails_closed_with_a_single_unavailable_reason_when_any_field_missing(judge_module, field):
    row = dict(GOOD_JUDGE_ROW)
    row[field] = None
    result = judge_module.judge_gate(row, JUDGE_THRESHOLDS)
    assert result == {"pass": False, "reasons": ["unavailable: judge"]}


def test_judge_gate_fails_same_person_below_floor(judge_module):
    row = dict(GOOD_JUDGE_ROW, same_person=50)
    result = judge_module.judge_gate(row, JUDGE_THRESHOLDS)
    assert result["pass"] is False
    assert any("same_person" in reason for reason in result["reasons"])


def test_judge_gate_fails_age_delta_positive_and_negative(judge_module):
    for delta in (10, -10):
        result = judge_module.judge_gate(dict(GOOD_JUDGE_ROW, age_delta=delta), JUDGE_THRESHOLDS)
        assert result["pass"] is False
        assert any("age_delta" in reason for reason in result["reasons"])


def test_judge_gate_fails_skin_realism_below_floor(judge_module):
    result = judge_module.judge_gate(dict(GOOD_JUDGE_ROW, skin_realism=20), JUDGE_THRESHOLDS)
    assert result["pass"] is False


def test_judge_gate_fails_gloss_above_ceiling(judge_module):
    result = judge_module.judge_gate(dict(GOOD_JUDGE_ROW, gloss=99), JUDGE_THRESHOLDS)
    assert result["pass"] is False


def test_judge_gate_fails_artifacts_above_ceiling(judge_module):
    result = judge_module.judge_gate(dict(GOOD_JUDGE_ROW, artifacts=99), JUDGE_THRESHOLDS)
    assert result["pass"] is False


def test_judge_gate_fails_closed_when_a_threshold_key_is_missing(judge_module):
    thresholds = dict(JUDGE_THRESHOLDS)
    del thresholds["gloss_max"]
    result = judge_module.judge_gate(GOOD_JUDGE_ROW, thresholds)
    assert result["pass"] is False
    assert any("unavailable: gloss_max" in reason for reason in result["reasons"])


# ---------------------------------------------------------------------------
# calibrate -- fake runner, synthetic evidence sets
# ---------------------------------------------------------------------------


def _synthetic_persona(tmp_path) -> dict:
    persona_dir = tmp_path / "creator-xyz"
    for name in ("g01", "g02", "g07"):
        _png(persona_dir / "anchors", name)
    persona_path = persona_dir / "persona.yaml"
    document = {
        "id": "creator-xyz",
        "identity": {"references": ["anchors/g01.png", "anchors/g02.png", "anchors/g07.png"]},
    }
    persona_path.write_text(json.dumps(document, indent=2), encoding="utf-8")
    document["_persona_path"] = str(persona_path)
    return document


def test_calibrate_builds_anchor_leave_one_out_and_named_sets(judge_module, tmp_path):
    persona = _synthetic_persona(tmp_path)
    bad_dir = tmp_path / "bad-set"
    for index in range(3):
        _png(bad_dir, f"bad-{index}")

    calls = []

    def fake_runner(prompt, *, model, timeout=None):
        calls.append(prompt)
        # every "bad" candidate should read as a clear non-match with worse realism
        if "bad-" in prompt:
            payload = dict(GOOD_PAYLOAD, same_person=10, skin_realism=20, gloss=80, artifacts=70)
        else:
            payload = dict(GOOD_PAYLOAD, same_person=97, skin_realism=95, gloss=2, artifacts=2, apparent_age_candidate=23)
        return _envelope(json.dumps(payload))

    sets = {"bad": bad_dir}
    calibration = judge_module.calibrate(persona, sets, runner=fake_runner)

    assert calibration["sets"]["anchors"]["n"] == 3
    assert calibration["sets"]["bad"]["n"] == 3
    assert calibration["proposed_thresholds"]["same_person_min"] is not None
    assert calibration["proposed_thresholds"]["same_person_min"] > 10
    assert "separates" in calibration["separability"]["same_person_min"]
    assert calibration["total_images"] == 3 + 3
    # anchors judged leave-one-out: none of the 3 anchor prompts should contain a
    # reference photo alongside itself as a "candidate AND reference" no-op
    assert len(calls) == 6


def test_run_calibrate_writes_json_and_md(judge_module, tmp_path):
    persona = _synthetic_persona(tmp_path)
    personas_root = Path(persona["_persona_path"]).parents[1]

    def fake_runner(prompt, *, model, timeout=None):
        return _envelope(json.dumps(GOOD_PAYLOAD))

    out = tmp_path / "out"
    result = judge_module.run_calibrate(
        "creator-xyz", {}, out, personas_root=personas_root, runner=fake_runner,
    )
    assert Path(result["json"]).is_file()
    assert Path(result["md"]).is_file()
    md_text = Path(result["md"]).read_text(encoding="utf-8")
    assert "Proposed thresholds" in md_text
    assert "anchors" in md_text


# ---------------------------------------------------------------------------
# run_judge / CLI
# ---------------------------------------------------------------------------


def test_run_judge_writes_judge_json(judge_module, tmp_path):
    persona_dir = tmp_path / "creator-xyz"
    for name in ("g01",):
        _png(persona_dir / "anchors", name)
    persona_path = persona_dir / "persona.yaml"
    persona_path.write_text(
        json.dumps({"id": "creator-xyz", "identity": {"references": ["anchors/g01.png"]}}),
        encoding="utf-8",
    )
    images_dir = tmp_path / "candidates"
    for index in range(2):
        _png(images_dir, f"c{index}")

    def fake_runner(prompt, *, model, timeout=None):
        return _envelope(json.dumps(GOOD_PAYLOAD))

    out = tmp_path / "out"
    result = judge_module.run_judge(
        "creator-xyz", [str(images_dir)], out, personas_root=tmp_path, runner=fake_runner,
    )
    document = json.loads(Path(result["json"]).read_text(encoding="utf-8"))
    assert document["schema"] == "figment/judge@1"
    assert len(document["rows"]) == 2
    assert document["summary"]["total"] == 2
    assert document["summary"]["available"] == 2


def test_run_judge_raises_when_no_images_match(judge_module, tmp_path):
    persona_dir = tmp_path / "creator-xyz"
    _png(persona_dir / "anchors", "g01")
    (persona_dir / "persona.yaml").write_text(
        json.dumps({"id": "creator-xyz", "identity": {"references": ["anchors/g01.png"]}}),
        encoding="utf-8",
    )
    with pytest.raises(judge_module.JudgeError, match="no images matched"):
        judge_module.run_judge(
            "creator-xyz", [str(tmp_path / "nonexistent")], tmp_path / "out", personas_root=tmp_path,
        )


def test_resolve_images_dedupes_directory_and_glob_overlap(judge_module, tmp_path):
    directory = tmp_path / "imgs"
    a = _png(directory, "a")
    _png(directory, "b")
    resolved = judge_module._resolve_images([str(directory), str(directory / "*.png")])
    assert len(resolved) == 2
    assert a.resolve() in {p.resolve() for p in resolved}


def test_cli_default_personas_root_resolves_to_the_real_personas_directory(judge_module):
    args = judge_module.build_parser().parse_args(["calibrate", "--creator", "x", "--out", "y"])
    assert args.personas_root.is_dir()
    assert args.personas_root.parts[-3:] == ("orgs", "figment", "personas")


def test_cli_run_parses_repeatable_images_flag(judge_module):
    args = judge_module.build_parser().parse_args([
        "run", "--creator", "creator-001", "--images", "a", "--images", "b", "--out", "out",
    ])
    assert args.images == ["a", "b"]
    assert args.workers == judge_module.DEFAULT_WORKERS
    assert args.model == judge_module.DEFAULT_MODEL
