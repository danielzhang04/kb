"""Offline tensor score contracts; injected runners only."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from PIL import Image

PIPELINE = Path(__file__).resolve().parents[1]

def load(name):
    spec = importlib.util.spec_from_file_location("phase2_" + name, PIPELINE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module

J = load("vlm_judge")
G = load("identity_gate")
PAYLOAD = dict(same_person=90, apparent_age_reference=25, apparent_age_candidate=25,
               skin_realism=90, gloss=1, artifacts=1, notes="fixture")
JT = dict(same_person_min=70, age_delta_max=2, skin_realism_min=60, gloss_max=30, artifacts_max=20)
T = dict(identity_own_min=.6, face_px_min=500, age_floor_years=20)
S = dict(identity_own=.9, face_px=700, age_value=25)

def judge_row():
    return J._coerce_judge_payload(PAYLOAD)

@pytest.mark.parametrize("value", [True, "50", float("nan"), float("inf"), -1, 101, 10**400])
def test_trait_values_reject_invalid(value):
    payload = dict(PAYLOAD, traits=dict.fromkeys(J.TRAIT_AXES, 80))
    payload["traits"]["lips"] = value
    assert J._coerce_judge_payload(payload, trait_axes=True) is None

@pytest.mark.parametrize("value", [0, 100, None])
def test_trait_boundaries_and_unknown(value):
    payload = dict(PAYLOAD, traits=dict.fromkeys(J.TRAIT_AXES, value))
    row = J._coerce_judge_payload(payload, trait_axes=True)
    assert row["traits"]["lips"] == value
    assert row["trait_unavailable"] == (list(J.TRAIT_AXES) if value is None else [])

@pytest.mark.parametrize("value", [None, float("nan"), float("inf"), True, "25", 19])
def test_age_hold_is_independent_of_display_group(value):
    row = G.tensor_verdict(dict(S, face_px=None, age_value=value), None, T, JT)
    assert row["group"] == "unscorable"
    assert row["age_hold"] and row["age_reasons"]
    assert not row["pass"]

@pytest.mark.parametrize("side", ["vit", "judge"])
def test_either_estimator_triggers_hold(side):
    scores = dict(S, age_value=19 if side == "vit" else 25)
    judge = dict(judge_row(), apparent_age_candidate=19 if side == "judge" else 25)
    row = G.tensor_verdict(scores, judge, T, JT)
    assert row["group"] == "age" and row["age_hold"]

@pytest.mark.parametrize("field", ["identity_own", "face_px"])
def test_nonfinite_identity_never_passes(field):
    assert not G.tensor_verdict(dict(S, **{field: float("nan")}), judge_row(), T, JT)["pass"]

def test_traits_never_activate_thresholds():
    first = G.tensor_verdict(S, dict(judge_row(), traits=dict.fromkeys(J.TRAIT_AXES, 0)), T, JT)
    second = G.tensor_verdict(S, dict(judge_row(), traits=dict.fromkeys(J.TRAIT_AXES, 100)), T, JT)
    assert first == second
    assert first["pass"]

def test_clean_payload_and_verdict_unchanged():
    assert "traits" not in judge_row()
    assert G.two_stage_gate(S, judge_row(), T, JT)["pass"]
    assert "group" not in G.two_stage_gate(S, judge_row(), T, JT)

def test_cache_mode_reference_and_schema_isolation(tmp_path):
    paths = [tmp_path / (name + ".png") for name in ("candidate", "reference", "other")]
    for index, path in enumerate(paths):
        Image.new("RGB", (8, 8), (index * 50, 30, 50)).save(path)
    calls = []
    def runner(prompt, **kwargs):
        calls.append(prompt)
        return json.dumps({"result": json.dumps(dict(PAYLOAD, traits=dict.fromkeys(J.TRAIT_AXES, 80)))})
    cache = tmp_path / "cache"
    clean = J.judge_image(paths[0], [paths[1]], runner=runner, cache_dir=cache)
    tensor = J.judge_image(paths[0], [paths[1]], runner=runner, cache_dir=cache, trait_axes=True)
    assert len(calls) == 2 and "traits" not in clean and tensor["traits"]["lips"] == 80
    assert J.judge_image(paths[0], [paths[1]], runner=runner, cache_dir=cache, trait_axes=True)["cache_hit"]
    J.judge_image(paths[0], [paths[2]], runner=runner, cache_dir=cache, trait_axes=True)
    assert len(calls) == 3
    for path in cache.glob("*.json"):
        data = json.loads(path.read_text())
        if "traits" in data:
            data.pop("traits")
            path.write_text(json.dumps(data))
    J.judge_image(paths[0], [paths[1]], runner=runner, cache_dir=cache, trait_axes=True)
    assert len(calls) == 4

def test_downstream_judges_faced_failures_and_retains_every_cell(monkeypatch, tmp_path):
    images = [{"image_id": x, "path": str(tmp_path / (x + ".png"))} for x in ("bad", "rear")]
    monkeypatch.setattr(G, "load_thresholds", lambda persona: T)
    monkeypatch.setattr(G, "load_judge_thresholds", lambda: JT)
    monkeypatch.setattr(G, "score_cells_for_stage", lambda *a, **k: [dict(S, image_id="bad", identity_own=.1), dict(S, image_id="rear", face_px=None, age_value=None)])
    calls = []
    class Judge:
        judge_gate = staticmethod(J.judge_gate)
        @staticmethod
        def judge_images_for_stage(items, refs, **kwargs):
            calls.append((items, refs, kwargs))
            return [dict(judge_row(), image_id="bad")]
    monkeypatch.setattr(G, "_vlm_judge_module", lambda: Judge)
    result = G.run_two_stage_gate(lambda: {}, [tmp_path / "passport.png"], images, tmp_path, tensor_review=True)
    assert [r["image_id"] for r in result["rows"]] == ["bad", "rear"]
    assert calls[0][0] == images[:1] and calls[0][2]["trait_axes"]
    assert result["rows"][0]["group"] == "failed"
    assert result["rows"][1]["group"] == "unscorable" and result["rows"][1]["age_hold"]
    assert result["summary"]["groups"] == {"failed": 1, "unscorable": 1}


def test_existing_calibration_never_invents_trait_labels_or_thresholds():
    old = {"schema": "figment/judge-calibration@1", "prompt_version": "v1", "sets": {"accepted": {"rows": [dict(judge_row(), decision="keep")]}}}
    report = J.trait_calibration_inventory(old)
    assert report["rows"] == 1 and report["proposed_thresholds"] == {}
    assert all(axis["missing_scores"] == axis["missing_labels"] == 1 for axis in report["axes"].values())

def test_tensor_outage_keeps_rows_with_explicit_age_hold(tmp_path):
    def unavailable():
        raise RuntimeError("offline failure")
    result = G.run_two_stage_gate(unavailable, [tmp_path / "passport.png"], [{"image_id": "one", "path": "unused"}], tmp_path, tensor_review=True)
    assert result["rows"][0]["group"] == "unscorable"
    assert result["rows"][0]["age_hold"] and result["rows"][0]["age_reasons"]
    assert result["summary"]["total"] == 1

@pytest.mark.parametrize("metric", ["same_person", "age_delta", "skin_realism", "gloss", "artifacts"])
def test_tensor_nonfinite_judge_metrics_are_unscorable(metric):
    verdict = G.tensor_verdict(S, dict(judge_row(), **{metric: float("nan")}), T, JT)
    assert verdict["group"] == "unscorable" and not verdict["pass"]


def test_unavailable_metric_does_not_hide_other_known_failure():
    verdict = G.tensor_verdict(S, dict(judge_row(), same_person=0, gloss=None), T, JT)
    assert verdict["group"] == "unscorable"
    assert "unavailable: gloss" in verdict["reasons"]
    assert any("same_person 0" in reason for reason in verdict["reasons"])


def test_tensor_rejects_unsupported_diagnostic_backend_before_scoring():
    def must_not_load():
        pytest.fail("unsupported backend reached scoring")
    with pytest.raises(G.IdentityGateError, match="codex-diagnostic is not supported"):
        G.run_two_stage_gate(must_not_load, [Path("passport.png")], [], Path("unused"),
                             tensor_review=True, judge_backend="codex-diagnostic")
