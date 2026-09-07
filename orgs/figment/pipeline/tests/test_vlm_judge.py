"""Contract tests for the stage-2 perceptual judge (vlm_judge.py).

Every test here injects a fake `runner` (or monkeypatches `subprocess.run` for the one
test of the real CLI-argument-building path) -- NONE of these tests ever invokes the
real `claude` CLI. See `orgs/figment/personas/creator-001/calibration/` for the real,
subscription-billed calibration run this module's `calibrate()` was built to support.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import logging
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
    """An 8x8 solid-color PNG fixture, colored deterministically FROM `name` so every
    distinctly-named fixture image has distinct file bytes (and thus a distinct
    sha256) -- `vlm_judge.py`'s cache key and its downscaled-copy filename are both
    content-addressed (`_sha256_file` / `_downscale_for_judge`), same as real,
    always-distinct photographs would be; a shared, name-independent color would make
    every fixture image collide onto the same cache entry and the same downscaled
    copy, which no real evidence set could ever do."""
    from PIL import Image

    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{name}.png"
    digest = hashlib.sha256(name.encode("utf-8")).digest()
    color = (digest[0], digest[1], digest[2])
    Image.new("RGB", (8, 8), color=color).save(path)
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
    # The CLI is pointed at DOWNSCALED copies, never the original full-size files
    # (see `_downscale_for_judge`) -- the prompt carries the downscaled candidate path
    # (recorded on the row as `judged_from`) and a downscaled `.jpg` reference copy,
    # not `reference`/`candidate`'s own original paths.
    assert str(candidate) not in calls[0][0]
    assert str(reference) not in calls[0][0]
    assert result["judged_from"] is not None
    assert result["judged_from"] in calls[0][0]
    judged_from_path = Path(result["judged_from"])
    assert judged_from_path.is_file()
    assert judged_from_path.suffix == ".jpg"
    assert calls[0][0].count(".jpg") == 2  # the downscaled candidate + the one reference
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


def test_judge_image_retries_once_on_a_timeout_with_the_same_downscaled_inputs(judge_module, tmp_path):
    """The 2026-09-07 live incident: 16/18 rows failed with `JudgeError("judge CLI
    failed to run: ... timed out")`. `judge_image`'s existing retry-once loop already
    covers this exception (it catches ANY exception the runner raises, not just
    non-JSON responses) -- this test pins that a timeout specifically retries, and that
    the retry judges the exact SAME (already-downscaled) inputs, never re-downscaling
    or picking a different candidate/reference on the second attempt."""
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")
    prompts = []

    def fake_runner(prompt, *, model, timeout=None):
        prompts.append(prompt)
        if len(prompts) == 1:
            raise judge_module.JudgeError("judge CLI failed to run: Command [...] timed out")
        return _envelope(json.dumps(GOOD_PAYLOAD))

    result = judge_module.judge_image(candidate, [reference], runner=fake_runner)
    assert len(prompts) == 2
    assert prompts[0] == prompts[1]
    assert result["same_person"] == 58
    assert result["unavailable"] == {}


def test_judge_image_logs_start_and_finish_with_duration(judge_module, tmp_path, caplog):
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")

    def fake_runner(prompt, *, model, timeout=None):
        return _envelope(json.dumps(GOOD_PAYLOAD))

    with caplog.at_level(logging.INFO, logger="figment.vlm_judge"):
        judge_module.judge_image(candidate, [reference], runner=fake_runner)

    messages = [record.message for record in caplog.records]
    assert any(msg.startswith("judge start id=candidate") for msg in messages)
    assert any(
        msg.startswith("judge finish id=candidate") and "duration_s=" in msg for msg in messages
    )


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


def test_judge_image_never_caches_a_failed_result_and_retries_for_real_on_the_next_run(
    judge_module, tmp_path,
):
    """The live 2026-09-07 bug: 16/18 rows timed out, and the timeout was cached and
    served back as `cache_hit: True` forever after. `judge_image` must NEVER write a
    failed/unavailable result to the cache -- a fresh invocation over the same cache_dir
    (e.g. the operator re-running `vlm_judge.py run` after the first run failed) has to
    call the runner again, not silently keep replaying the old failure."""
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")
    cache_dir = tmp_path / "cache"
    calls = {"n": 0}

    def always_fails(prompt, *, model, timeout=None):
        calls["n"] += 1
        raise judge_module.JudgeError("judge CLI failed to run: Command [...] timed out")

    # "run 1" -- every attempt (both of judge_image's own built-in retries) times out.
    first_run = judge_module.judge_image(candidate, [reference], runner=always_fails, cache_dir=cache_dir)
    assert calls["n"] == 2
    assert first_run["same_person"] is None
    assert "judge" in first_run["unavailable"]
    assert not list(cache_dir.glob("*.json")), "a failed judgement must never be cached"

    def succeeds(prompt, *, model, timeout=None):
        calls["n"] += 1
        return _envelope(json.dumps(GOOD_PAYLOAD))

    # "run 2" -- a fresh invocation over the SAME cache_dir. A cached failure would
    # have short-circuited this and kept returning `unavailable: judge` forever.
    second_run = judge_module.judge_image(candidate, [reference], runner=succeeds, cache_dir=cache_dir)
    assert calls["n"] == 3
    assert second_run["cache_hit"] is False
    assert second_run["same_person"] == 58
    assert len(list(cache_dir.glob("*.json"))) == 1  # now it IS cached, correctly


def test_judge_image_treats_a_legacy_failed_cache_row_as_a_miss(judge_module, tmp_path):
    """Heals the existing bad cache entries this bug already wrote to disk: a cache
    file shaped like the OLD (pre-fix) bug -- `unavailable["judge"]` set, no parsed
    `same_person` -- must be treated as a miss on load, not replayed as a false
    `cache_hit`, and gets overwritten with a real result once the runner succeeds."""
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    key = judge_module._cache_key(
        judge_module._sha256_file(candidate), [judge_module._sha256_file(reference)],
        candidate=candidate, references=[reference],
        model=judge_module.DEFAULT_MODEL, prompt_version=judge_module.PROMPT_VERSION,
    )
    legacy_bad_row = {
        "image_id": "candidate", "same_person": None, "apparent_age_reference": None,
        "apparent_age_candidate": None, "age_delta": None, "skin_realism": None,
        "gloss": None, "artifacts": None, "notes": None, "model": judge_module.DEFAULT_MODEL,
        "duration_s": 185.4, "cost_usd": None, "cache_hit": False,
        "unavailable": {"judge": "judge CLI failed to run: Command [...] timed out"},
    }
    (cache_dir / f"{key}.json").write_text(json.dumps(legacy_bad_row), encoding="utf-8")

    calls = {"n": 0}

    def fake_runner(prompt, *, model, timeout=None):
        calls["n"] += 1
        return _envelope(json.dumps(GOOD_PAYLOAD))

    result = judge_module.judge_image(candidate, [reference], runner=fake_runner, cache_dir=cache_dir)
    assert calls["n"] == 1, "a legacy failed cache row must be treated as a miss, not served"
    assert result["cache_hit"] is False
    assert result["same_person"] == 58

    healed = judge_module.judge_image(candidate, [reference], runner=fake_runner, cache_dir=cache_dir)
    assert calls["n"] == 1, "the healed entry now serves a real cache hit"
    assert healed["cache_hit"] is True
    assert healed["same_person"] == 58


# ---------------------------------------------------------------------------
# downscaling -- candidate + reference photos are shrunk before the judge CLI Reads
# them (the 2026-09-07 fix for slow/timing-out `claude` CLI Reads of full-size,
# 3-4MB PNGs)
# ---------------------------------------------------------------------------


def test_downscale_for_judge_produces_at_most_1024px_jpeg(judge_module, tmp_path):
    from PIL import Image

    large = tmp_path / "large.png"
    Image.new("RGB", (1448, 2176), color=(10, 20, 30)).save(large)
    dest_dir = tmp_path / "judge-inputs"

    out = judge_module._downscale_for_judge(large, dest_dir)

    assert out.is_file()
    assert out.parent == dest_dir
    assert out.suffix == ".jpg"
    with Image.open(out) as image:
        assert max(image.size) <= judge_module.DOWNSCALE_MAX_SIDE
        assert image.size[1] < 2176  # actually shrunk, not just re-encoded in place
        assert image.size[0] == pytest.approx(1448 * image.size[1] / 2176, abs=1)  # aspect kept


def test_downscale_for_judge_never_upscales_a_small_image(judge_module, tmp_path):
    from PIL import Image

    small = tmp_path / "small.png"
    Image.new("RGB", (8, 8), color=(1, 2, 3)).save(small)
    dest_dir = tmp_path / "judge-inputs"

    out = judge_module._downscale_for_judge(small, dest_dir)
    with Image.open(out) as image:
        assert image.size == (8, 8)


def test_downscale_for_judge_reuses_the_same_copy_for_identical_content(judge_module, tmp_path):
    """A shared reference photo, downscaled once for the first candidate in a batch, is
    reused verbatim (by its content sha) for every later candidate against the same
    references -- not re-encoded per call."""
    photo = _png(tmp_path, "g01")
    dest_dir = tmp_path / "judge-inputs"

    first = judge_module._downscale_for_judge(photo, dest_dir)
    written_at = first.stat().st_mtime_ns
    second = judge_module._downscale_for_judge(photo, dest_dir)

    assert second == first
    assert second.stat().st_mtime_ns == written_at  # never rewritten


def test_judge_image_cache_key_is_unchanged_by_where_downscaled_copies_land(judge_module, tmp_path):
    """The cache key stays keyed on the ORIGINAL candidate/reference sha256 + model +
    prompt_version -- it must NOT depend on `cache_dir` (and therefore not on where
    `_downscale_for_judge` happens to write the `judge-inputs/` copies either), so the
    same evidence run through two different `--out` directories still lands on the
    exact same cache filename."""
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")
    expected_key = judge_module._cache_key(
        judge_module._sha256_file(candidate), [judge_module._sha256_file(reference)],
        candidate=candidate, references=[reference],
        model=judge_module.DEFAULT_MODEL, prompt_version=judge_module.PROMPT_VERSION,
    )

    def fake_runner(prompt, *, model, timeout=None):
        return _envelope(json.dumps(GOOD_PAYLOAD))

    cache_dir_a = tmp_path / "run-a" / "judge-cache"
    cache_dir_b = tmp_path / "run-b" / "judge-cache"
    judge_module.judge_image(candidate, [reference], runner=fake_runner, cache_dir=cache_dir_a)
    judge_module.judge_image(candidate, [reference], runner=fake_runner, cache_dir=cache_dir_b)

    assert (cache_dir_a / f"{expected_key}.json").is_file()
    assert (cache_dir_b / f"{expected_key}.json").is_file()


def test_judge_image_records_judged_from_as_the_downscaled_candidate_path(judge_module, tmp_path):
    candidate = _png(tmp_path, "candidate")
    reference = _png(tmp_path, "g01")
    cache_dir = tmp_path / "cache"

    def fake_runner(prompt, *, model, timeout=None):
        return _envelope(json.dumps(GOOD_PAYLOAD))

    result = judge_module.judge_image(candidate, [reference], runner=fake_runner, cache_dir=cache_dir)

    assert result["judged_from"] is not None
    assert result["judged_from"] != str(candidate)
    assert Path(result["judged_from"]).parent == cache_dir.parent / "judge-inputs"


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
        # Every candidate now Reads from a content-addressed DOWNSCALED temp path
        # (see `_downscale_for_judge`), never the original "bad-N.png"/"gNN.png" name,
        # so a "bad-" filename substring check can't tell the two calls apart anymore.
        # Reference COUNT still can: the anchors' own leave-one-out rows judge against
        # only the 2 OTHER reference photos, while the "bad" set is judged against the
        # persona's full 3-reference list -- one more "another real photo of the SAME
        # woman" line in the prompt (see `_build_prompt`) is exactly the "bad" set.
        if prompt.count("another real photo of the SAME woman") >= 2:
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


def test_run_judge_forwards_call_timeout_to_the_judge_runner(judge_module, tmp_path):
    persona_dir = tmp_path / "creator-xyz"
    _png(persona_dir / "anchors", "g01")
    (persona_dir / "persona.yaml").write_text(
        json.dumps({"id": "creator-xyz", "identity": {"references": ["anchors/g01.png"]}}),
        encoding="utf-8",
    )
    images_dir = tmp_path / "candidates"
    _png(images_dir, "c0")
    captured = {}

    def fake_runner(prompt, *, model, timeout=None):
        captured["timeout"] = timeout
        return _envelope(json.dumps(GOOD_PAYLOAD))

    judge_module.run_judge(
        "creator-xyz", [str(images_dir)], tmp_path / "out", personas_root=tmp_path,
        runner=fake_runner, timeout=45.0,
    )
    assert captured["timeout"] == 45.0


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


def test_cli_defaults_are_two_workers_and_a_600s_call_timeout(judge_module):
    """2026-09-07 fix: 4 concurrent workers Reading full-size images was what actually
    produced the 185s timeouts in the live incident; the new defaults are 2 workers and
    a 600s per-call timeout (both still overridable via --workers/--call-timeout)."""
    assert judge_module.DEFAULT_WORKERS == 2
    assert judge_module.DEFAULT_TIMEOUT == 600.0

    run_args = judge_module.build_parser().parse_args([
        "run", "--creator", "creator-001", "--images", "a", "--out", "out",
    ])
    assert run_args.workers == 2
    assert run_args.timeout == 600.0

    calibrate_args = judge_module.build_parser().parse_args([
        "calibrate", "--creator", "creator-001", "--out", "out",
    ])
    assert calibrate_args.workers == 2
    assert calibrate_args.timeout == 600.0


def test_cli_run_parses_call_timeout_flag(judge_module):
    args = judge_module.build_parser().parse_args([
        "run", "--creator", "creator-001", "--images", "a", "--out", "out",
        "--call-timeout", "45",
    ])
    assert args.timeout == 45.0


def test_cli_calibrate_parses_call_timeout_flag(judge_module):
    args = judge_module.build_parser().parse_args([
        "calibrate", "--creator", "creator-001", "--out", "out", "--call-timeout", "90",
    ])
    assert args.timeout == 90.0
