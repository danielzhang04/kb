"""Contract tests for the fail-closed per-cell gate (identity_gate.py).

Unlike `score_cells.py` (advisory-only, never keeps or culls), this module IS allowed
to make a fail-closed pass/fail call -- operator ruling 2026-09-03: no image board
reaches the operator until this gate says a shown cell holds identity, age and realism.
Every metric that could not be computed must fail closed, never pass silently.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
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
def gate_module():
    return load_module("figment_test_identity_gate", PIPELINE / "identity_gate.py")


def _png(directory: Path, name: str, size=(64, 64), color=(120, 90, 90)) -> Path:
    from PIL import Image

    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    Image.new("RGB", size, color=color).save(path)
    return path


# ---------------------------------------------------------------------------
# gate() -- fail-closed threshold logic (pure, no models)
# ---------------------------------------------------------------------------

THRESHOLDS = {
    "identity_own_min": 0.6,
    "age_delta_max_years": 4.0,
    "gloss_max": 0.1,
    "niqe_max": 6.0,
    "face_px_min": 500,
}

GOOD_SCORES = {
    "identity_own": 0.9, "age_delta": 1.0, "gloss": 0.02, "niqe": 3.0, "face_px": 700,
}


def test_gate_passes_when_every_metric_clears_its_threshold(gate_module):
    result = gate_module.gate(GOOD_SCORES, THRESHOLDS)
    assert result == {"pass": True, "reasons": []}


@pytest.mark.parametrize("metric", ["identity_own", "age_delta", "gloss", "niqe", "face_px"])
def test_gate_fails_closed_when_a_metric_is_missing(gate_module, metric):
    scores = dict(GOOD_SCORES)
    scores[metric] = None
    result = gate_module.gate(scores, THRESHOLDS)
    assert result["pass"] is False
    assert f"unavailable: {metric}" in result["reasons"]


@pytest.mark.parametrize("threshold_key", list(THRESHOLDS))
def test_gate_fails_closed_when_a_threshold_is_missing(gate_module, threshold_key):
    thresholds = dict(THRESHOLDS)
    del thresholds[threshold_key]
    result = gate_module.gate(GOOD_SCORES, thresholds)
    assert result["pass"] is False
    assert any("unavailable" in reason for reason in result["reasons"])


def test_gate_fails_identity_below_floor(gate_module):
    scores = dict(GOOD_SCORES, identity_own=0.4)
    result = gate_module.gate(scores, THRESHOLDS)
    assert result["pass"] is False
    assert any("identity_own" in reason for reason in result["reasons"])


def test_gate_fails_age_delta_positive_and_negative(gate_module):
    for delta in (10.0, -10.0):
        result = gate_module.gate(dict(GOOD_SCORES, age_delta=delta), THRESHOLDS)
        assert result["pass"] is False
        assert any("age_delta" in reason for reason in result["reasons"])


def test_gate_fails_gloss_above_ceiling(gate_module):
    result = gate_module.gate(dict(GOOD_SCORES, gloss=0.5), THRESHOLDS)
    assert result["pass"] is False


def test_gate_fails_niqe_above_ceiling(gate_module):
    result = gate_module.gate(dict(GOOD_SCORES, niqe=99.0), THRESHOLDS)
    assert result["pass"] is False


def test_gate_fails_face_px_below_floor(gate_module):
    result = gate_module.gate(dict(GOOD_SCORES, face_px=10), THRESHOLDS)
    assert result["pass"] is False
    assert any("face_px" in reason for reason in result["reasons"])


def test_load_thresholds_reads_gate_yaml_defaults(gate_module):
    thresholds = gate_module.load_thresholds()
    for key in gate_module.THRESHOLD_KEYS:
        assert key in thresholds


def test_load_thresholds_overlays_persona_min_face_px(gate_module):
    persona = {"identity": {"floor": {"min_face_px": {"value": 1234}}}}
    thresholds = gate_module.load_thresholds(persona)
    assert thresholds["face_px_min"] == 1234.0


def test_load_thresholds_falls_back_when_persona_declares_no_floor(gate_module):
    persona = {"identity": {}}
    thresholds = gate_module.load_thresholds(persona)
    assert thresholds["face_px_min"] == gate_module.load_thresholds()["face_px_min"]


def test_load_judge_thresholds_reads_gate_yaml_judge_block(gate_module):
    thresholds = gate_module.load_judge_thresholds()
    for key in gate_module._vlm_judge_module().JUDGE_THRESHOLD_KEYS:
        assert key in thresholds


def test_load_judge_thresholds_raises_when_gate_yaml_has_no_judge_block(gate_module, tmp_path):
    bad_config = tmp_path / "gate.yaml"
    bad_config.write_text("identity_own_min: 0.5\n", encoding="utf-8")
    with pytest.raises(gate_module.IdentityGateError, match="judge"):
        gate_module.load_judge_thresholds(bad_config)


# ---------------------------------------------------------------------------
# identity_floor_gate / two_stage_gate -- stage 1 + stage 2 (vlm_judge.py build)
# ---------------------------------------------------------------------------

STAGE1_THRESHOLDS = {"identity_own_min": 0.7, "face_px_min": 500}
GOOD_STAGE1_SCORES = {"identity_own": 0.9, "face_px": 700}

JUDGE_THRESHOLDS = {
    "same_person_min": 80, "age_delta_max": 4, "skin_realism_min": 75,
    "gloss_max": 20, "artifacts_max": 30,
}
GOOD_JUDGE_ROW = {
    "same_person": 95, "age_delta": 1, "skin_realism": 90, "gloss": 5, "artifacts": 5,
}


def test_identity_floor_gate_passes_on_identity_and_face_px_alone(gate_module):
    result = gate_module.identity_floor_gate(GOOD_STAGE1_SCORES, STAGE1_THRESHOLDS)
    assert result == {"pass": True, "reasons": []}


def test_identity_floor_gate_ignores_age_gloss_niqe(gate_module):
    # A cell whose age/gloss/niqe values would fail the OLD single-stage gate() must
    # still pass stage 1 alone -- those three metrics no longer have hard-fail duty.
    scores = dict(GOOD_STAGE1_SCORES, age_delta=99.0, gloss=1.0, niqe=999.0)
    result = gate_module.identity_floor_gate(scores, STAGE1_THRESHOLDS)
    assert result == {"pass": True, "reasons": []}


def test_identity_floor_gate_fails_closed_when_identity_own_missing(gate_module):
    scores = dict(GOOD_STAGE1_SCORES, identity_own=None)
    result = gate_module.identity_floor_gate(scores, STAGE1_THRESHOLDS)
    assert result["pass"] is False
    assert "unavailable: identity_own" in result["reasons"]


def test_identity_floor_gate_fails_closed_when_face_px_missing(gate_module):
    scores = dict(GOOD_STAGE1_SCORES, face_px=None)
    result = gate_module.identity_floor_gate(scores, STAGE1_THRESHOLDS)
    assert result["pass"] is False
    assert "unavailable: face_px" in result["reasons"]


def test_identity_floor_gate_fails_identity_below_floor(gate_module):
    result = gate_module.identity_floor_gate(dict(GOOD_STAGE1_SCORES, identity_own=0.1), STAGE1_THRESHOLDS)
    assert result["pass"] is False


def test_two_stage_gate_short_circuits_stage2_when_stage1_fails(gate_module, monkeypatch):
    boom_calls = {"n": 0}

    class BoomJudgeModule:
        @staticmethod
        def judge_gate(*args, **kwargs):
            boom_calls["n"] += 1
            raise AssertionError("stage 2 must never run when stage 1 fails")

    monkeypatch.setattr(gate_module, "_vlm_judge_module", lambda: BoomJudgeModule())
    scores = dict(GOOD_STAGE1_SCORES, identity_own=0.1)
    result = gate_module.two_stage_gate(scores, None, STAGE1_THRESHOLDS, JUDGE_THRESHOLDS)
    assert result["pass"] is False
    assert result["stage2"] is None
    assert boom_calls["n"] == 0
    assert any("identity_own" in reason for reason in result["reasons"])


def test_two_stage_gate_passes_when_both_stages_pass(gate_module, monkeypatch):
    vlm_judge = gate_module._vlm_judge_module()
    result = gate_module.two_stage_gate(
        GOOD_STAGE1_SCORES, GOOD_JUDGE_ROW, STAGE1_THRESHOLDS, JUDGE_THRESHOLDS,
    )
    assert result["pass"] is True
    assert result["reasons"] == []
    assert result["stage1"]["pass"] is True
    assert result["stage2"] == vlm_judge.judge_gate(GOOD_JUDGE_ROW, JUDGE_THRESHOLDS)


def test_two_stage_gate_fails_when_stage1_passes_but_judge_fails(gate_module):
    bad_judge_row = dict(GOOD_JUDGE_ROW, same_person=10)
    result = gate_module.two_stage_gate(
        GOOD_STAGE1_SCORES, bad_judge_row, STAGE1_THRESHOLDS, JUDGE_THRESHOLDS,
    )
    assert result["pass"] is False
    assert result["stage1"]["pass"] is True
    assert result["stage2"]["pass"] is False
    assert any("same_person" in reason for reason in result["reasons"])


def test_two_stage_gate_fails_closed_when_judge_scores_is_none_but_stage1_passed(gate_module):
    # stage1 passes but the judge was never run/produced nothing usable -- must still
    # fail overall (unavailable: judge), never a silent pass.
    result = gate_module.two_stage_gate(
        GOOD_STAGE1_SCORES, None, STAGE1_THRESHOLDS, JUDGE_THRESHOLDS,
    )
    assert result["pass"] is False
    assert result["reasons"] == ["unavailable: judge"]


# ---------------------------------------------------------------------------
# score_cell -- monkeypatched models, no heavy weights
# ---------------------------------------------------------------------------


class FakeModels:
    """A fully synthetic stand-in for GateModels -- deterministic, instant, and never
    touches real FaceNet/age-classifier weights. `detections`/`embeddings`/`ages` are
    keyed by `Path(path).stem`."""

    def __init__(self, *, detections=None, embeddings=None, ages=None):
        self.detections = detections or {}
        self.embeddings = embeddings or {}
        self.ages = ages or {}

    def detect(self, path):
        return self.detections.get(Path(path).stem)

    def embed(self, path):
        vector = self.embeddings.get(Path(path).stem)
        if vector is None:
            raise ValueError(f"no fake embedding for {path}")
        return vector

    def predict_age(self, path):
        age = self.ages.get(Path(path).stem)
        if age is None:
            raise ValueError(f"no fake age for {path}")
        return age


def _fake_detection(prob=0.99, box=(10, 10, 110, 210), crop_color=(200, 150, 150)):
    crop = np.full((box[3] - box[1], box[2] - box[0], 3), crop_color, dtype=np.uint8)
    return {"box": box, "prob": prob, "crop": crop}


def test_score_cell_computes_identity_own_max_mean_and_per_anchor(gate_module, tmp_path, monkeypatch):
    image = _png(tmp_path, "candidate.png")
    anchor_a = _png(tmp_path, "g01.png")
    anchor_b = _png(tmp_path, "g02.png")
    models = FakeModels(
        detections={"candidate": _fake_detection()},
        embeddings={"candidate": [1.0, 0.0], "g01": [1.0, 0.0], "g02": [0.0, 1.0]},
        ages={"candidate": 22.0, "g01": 21.0, "g02": 23.0},
    )
    monkeypatch.setattr(gate_module, "compute_niqe", lambda rgb, pristine: 2.5)
    result = gate_module.score_cell(
        image, {"g01": anchor_a, "g02": anchor_b}, own_anchor="g01", models=models,
        pristine_niqe=("fake-mean", "fake-cov"),
    )
    assert result["identity_per_anchor"]["g01"] == pytest.approx(1.0)
    assert result["identity_per_anchor"]["g02"] == pytest.approx(0.0)
    assert result["identity_own"] == pytest.approx(1.0)
    assert result["identity_max"] == pytest.approx(1.0)
    assert result["identity_mean"] == pytest.approx(0.5)
    assert result["age_value"] == pytest.approx(22.0)
    assert result["age_anchor"] == pytest.approx(22.0)
    assert result["age_delta"] == pytest.approx(0.0)
    assert result["face_px"] == 100  # min(110-10, 210-10)
    assert result["niqe"] == pytest.approx(2.5)
    assert not result["unavailable"]


def test_score_cell_no_face_detected_marks_every_metric_unavailable(gate_module, tmp_path):
    image = _png(tmp_path, "noface.png")
    models = FakeModels(detections={})
    result = gate_module.score_cell(image, {"g01": image}, own_anchor="g01", models=models)
    for metric in (
        "identity_own", "identity_max", "identity_mean", "face_px",
        "age_value", "age_delta", "niqe", "laplacian_variance", "gloss",
    ):
        assert result[metric] is None
        assert metric in result["unavailable"]


def test_score_cell_without_own_anchor_reports_reason(gate_module, tmp_path):
    image = _png(tmp_path, "candidate.png")
    anchor = _png(tmp_path, "g01.png")
    models = FakeModels(
        detections={"candidate": _fake_detection()},
        embeddings={"candidate": [1.0, 0.0], "g01": [1.0, 0.0]},
        ages={"candidate": 22.0, "g01": 21.0},
    )
    result = gate_module.score_cell(image, {"g01": anchor}, own_anchor=None, models=models)
    assert result["identity_own"] is None
    assert "identity_own" in result["unavailable"]
    assert result["identity_max"] == pytest.approx(1.0)


def test_score_cell_unknown_anchor_embedding_failure_is_recorded_not_raised(gate_module, tmp_path):
    image = _png(tmp_path, "candidate.png")
    bad_anchor = tmp_path / "broken.png"
    bad_anchor.write_bytes(b"not an image")
    models = FakeModels(
        detections={"candidate": _fake_detection()},
        embeddings={"candidate": [1.0, 0.0]},
        ages={"candidate": 22.0},
    )
    result = gate_module.score_cell(
        image, {"broken": bad_anchor}, own_anchor="broken", models=models,
    )
    assert result["identity_per_anchor"]["broken"] is None
    assert result["identity_own"] is None
    assert "identity_own" in result["unavailable"]


def test_score_cells_for_stage_precomputes_anchor_data_once(gate_module, tmp_path):
    image = _png(tmp_path, "candidate.png")
    anchor = _png(tmp_path, "g01.png")
    calls = {"embed": 0, "age": 0}

    class CountingModels(FakeModels):
        def embed(self, path):
            calls["embed"] += 1
            return super().embed(path)

        def predict_age(self, path):
            calls["age"] += 1
            return super().predict_age(path)

    models = CountingModels(
        detections={"candidate": _fake_detection()},
        embeddings={"candidate": [1.0, 0.0], "g01": [1.0, 0.0]},
        ages={"candidate": 22.0, "g01": 21.0},
    )
    images = [{"image_id": "candidate", "path": str(image)}, {"image_id": "candidate2", "path": str(image)}]
    rows = gate_module.score_cells_for_stage(
        images, {"g01": anchor}, own_anchor="g01", models=models,
    )
    assert len(rows) == 2
    # anchor embedded/aged once up front, then once per candidate image (2 candidates)
    assert calls["embed"] == 1 + 2
    assert calls["age"] == 1 + 2


# ---------------------------------------------------------------------------
# NIQE -- standalone reimplementation
# ---------------------------------------------------------------------------


def test_niqe_natural_image_scores_lower_than_its_own_blur(gate_module):
    from PIL import Image, ImageFilter

    anchors_dir = PIPELINE.parent / "personas" / "creator-001" / "anchors"
    anchor_paths = sorted(anchors_dir.glob("*.jpg"))
    assert len(anchor_paths) >= 2, "expected creator-001's real anchor photographs"
    pristine = gate_module.fit_pristine_niqe(anchor_paths)
    assert pristine is not None

    natural_path = anchor_paths[0]
    with Image.open(natural_path) as image:
        natural_rgb = np.array(image.convert("RGB"))
        blurred_rgb = np.array(image.convert("RGB").filter(ImageFilter.GaussianBlur(radius=6)))

    natural_score = gate_module.compute_niqe(natural_rgb, pristine)
    blurred_score = gate_module.compute_niqe(blurred_rgb, pristine)
    assert natural_score is not None and blurred_score is not None
    assert blurred_score > natural_score


def test_niqe_returns_none_on_a_too_small_image(gate_module):
    tiny = np.zeros((4, 4, 3), dtype=np.uint8)
    pristine = (np.zeros(18), np.eye(18))
    assert gate_module.compute_niqe(tiny, pristine) is None


def test_fit_pristine_niqe_returns_none_with_no_usable_images(tmp_path, gate_module):
    garbage = tmp_path / "broken.png"
    garbage.write_bytes(b"not an image")
    assert gate_module.fit_pristine_niqe([garbage]) is None


# ---------------------------------------------------------------------------
# gloss proxy + face-crop Laplacian
# ---------------------------------------------------------------------------


def test_gloss_proxy_flags_bright_skin_tone_patch(gate_module):
    # A skin tone (well inside the Chai/Ngan Cb/Cr band) with luma above the
    # near-saturated threshold should read as fully glossy.
    bright_skin = np.full((20, 20, 3), (255, 235, 210), dtype=np.uint8)
    result = gate_module._gloss_proxy(bright_skin)
    assert result is not None
    assert result > 0.5


def test_gloss_proxy_spares_dim_skin_tone_patch(gate_module):
    dim_skin = np.full((20, 20, 3), (140, 100, 80), dtype=np.uint8)
    result = gate_module._gloss_proxy(dim_skin)
    assert result is not None
    assert result < 0.5


def test_gloss_proxy_none_when_no_skin_toned_pixels(gate_module):
    blue = np.full((20, 20, 3), (0, 0, 255), dtype=np.uint8)
    assert gate_module._gloss_proxy(blue) is None


def test_face_crop_laplacian_differs_from_whole_frame(gate_module):
    """A sharp-edged crop and a uniform (flat) crop from the same synthetic image must
    give different Laplacian variances -- proof this is scored on the CROP, not always
    the same whole-frame value regardless of which region is passed in."""
    identity = gate_module._identity_module()
    sharp = np.zeros((40, 40, 3), dtype=np.uint8)
    sharp[:, 20:] = 255  # a hard vertical edge
    flat = np.full((40, 40, 3), 128, dtype=np.uint8)
    sharp_metrics = identity.compute_raw_metrics(sharp)
    flat_metrics = identity.compute_raw_metrics(flat)
    assert sharp_metrics["laplacian_variance"] > flat_metrics["laplacian_variance"]


# ---------------------------------------------------------------------------
# Age model integrity -- pinned, sha256-verified, safetensors-only
# ---------------------------------------------------------------------------


def test_pinned_age_model_weight_is_safetensors(gate_module):
    assert gate_module.AGE_MODEL_WEIGHT_FILENAME.endswith(".safetensors")


def test_ensure_age_model_refuses_when_live_etag_mismatches_the_pin(gate_module, tmp_path, monkeypatch):
    monkeypatch.setenv(gate_module.AGE_MODEL_CACHE_ENV, str(tmp_path))
    monkeypatch.setattr(gate_module, "_fetch_x_linked_etag", lambda url: "deadbeef")

    def _boom(*args, **kwargs):
        raise AssertionError("must not download before etag verification passes")

    monkeypatch.setattr(gate_module, "_download", _boom)
    with pytest.raises(gate_module.IdentityGateError, match="changed upstream"):
        gate_module.ensure_age_model()


def test_ensure_age_model_refuses_a_tampered_cached_file_without_hitting_the_network(
    gate_module, tmp_path, monkeypatch,
):
    monkeypatch.setenv(gate_module.AGE_MODEL_CACHE_ENV, str(tmp_path))
    snapshot = tmp_path / "dima806-facial_age_image_detection" / gate_module.AGE_MODEL_REVISION
    snapshot.mkdir(parents=True)
    (snapshot / gate_module.AGE_MODEL_WEIGHT_FILENAME).write_bytes(b"tampered bytes")

    def _boom(url):
        raise AssertionError("a cached file must be sha256-checked without a network call")

    monkeypatch.setattr(gate_module, "_fetch_x_linked_etag", _boom)
    with pytest.raises(gate_module.IdentityGateError, match="does not match the pinned sha256"):
        gate_module.ensure_age_model()


def test_ensure_age_model_downloads_once_and_reuses_the_cache(gate_module, tmp_path, monkeypatch):
    monkeypatch.setenv(gate_module.AGE_MODEL_CACHE_ENV, str(tmp_path))
    payload = b"pretend-safetensors-bytes"
    real_sha256 = gate_module._sha256_file
    monkeypatch.setattr(gate_module, "AGE_MODEL_WEIGHT_SHA256", __import__("hashlib").sha256(payload).hexdigest())
    monkeypatch.setattr(gate_module, "_fetch_x_linked_etag", lambda url: gate_module.AGE_MODEL_WEIGHT_SHA256)

    downloads = []

    def _fake_download(url, destination):
        downloads.append(url)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload if destination.suffix == ".safetensors" else b"{}")

    monkeypatch.setattr(gate_module, "_download", _fake_download)
    snapshot = gate_module.ensure_age_model()
    assert (snapshot / gate_module.AGE_MODEL_WEIGHT_FILENAME).read_bytes() == payload
    first_call_count = len(downloads)
    assert first_call_count >= 1

    # Second call: file already on disk and hash still matches -> no network calls at all.
    def _boom(url):
        raise AssertionError("must not re-check etag once the file is cached")

    monkeypatch.setattr(gate_module, "_fetch_x_linked_etag", _boom)
    monkeypatch.setattr(gate_module, "_download", _boom)
    snapshot_again = gate_module.ensure_age_model()
    assert snapshot_again == snapshot


# ---------------------------------------------------------------------------
# calibrate -- monkeypatched models, synthetic evidence sets
# ---------------------------------------------------------------------------


def _synthetic_persona(tmp_path) -> dict:
    persona_dir = tmp_path / "creator-xyz"
    anchors_dir = persona_dir / "anchors"
    for name in ("g01", "g02", "g07"):
        _png(anchors_dir, f"{name}.png")
    persona_path = persona_dir / "persona.yaml"
    document = {
        "id": "creator-xyz",
        "identity": {
            "references": ["anchors/g01.png", "anchors/g02.png", "anchors/g07.png"],
            "floor": {"min_face_px": {"value": 400}},
            "calibration": {
                "anchor_pairwise": {"g01:g02": 0.9, "g01:g07": 0.92, "g02:g07": 0.88},
            },
        },
    }
    persona_path.write_text(json.dumps(document, indent=2), encoding="utf-8")
    document["_persona_path"] = str(persona_path)
    return document


def test_calibrate_reports_per_set_distributions_and_proposed_thresholds(gate_module, tmp_path, monkeypatch):
    persona = _synthetic_persona(tmp_path)
    passport_dir = tmp_path / "passport"
    for index in range(3):
        _png(passport_dir, f"stranger-{index}.png")

    def fake_score_cells_for_stage(images, anchors, *, own_anchor, models=None):
        rows = []
        for item in images:
            is_passport = "stranger" in item["image_id"]
            rows.append({
                "image_id": item["image_id"],
                "identity_own": 0.2 if is_passport else 0.9,
                "identity_max": 0.2 if is_passport else 0.9,
                "age_value": 30.0 if is_passport else 21.0,
                "age_anchor": 21.0,
                "age_delta": 9.0 if is_passport else 0.5,
                "gloss": 0.01,
                "niqe": 1.0,
                "laplacian_variance": 500.0,
                "face_px": 800,
                "unavailable": {},
            })
        return rows

    monkeypatch.setattr(gate_module, "score_cells_for_stage", fake_score_cells_for_stage)
    monkeypatch.setattr(gate_module, "fit_pristine_niqe", lambda paths: None)

    sets = {"anchors": Path(persona["_persona_path"]).parent / "anchors", "passport": passport_dir}
    calibration = gate_module.calibrate(persona, sets)

    assert calibration["sets"]["anchors"]["n"] == 3
    assert calibration["sets"]["passport"]["n"] == 3
    assert calibration["proposed_thresholds"]["identity_own_min"] is not None
    # passport (0.2) must land on the failing side of the proposed identity floor
    assert calibration["proposed_thresholds"]["identity_own_min"] > 0.2
    assert calibration["proposed_thresholds"]["face_px_min"] == 400
    assert "separates" in calibration["separability"]["age_delta_max_years"] or \
        "separate" in calibration["separability"]["age_delta_max_years"]


def test_cli_default_personas_root_resolves_to_the_real_personas_directory(gate_module):
    args = gate_module.build_parser().parse_args(["calibrate", "--creator", "x", "--out", "y"])
    assert args.personas_root.is_dir()
    assert args.personas_root.parts[-3:] == ("orgs", "figment", "personas")


def test_run_calibrate_writes_json_and_md(gate_module, tmp_path, monkeypatch):
    persona = _synthetic_persona(tmp_path)
    personas_root = Path(persona["_persona_path"]).parents[1]

    def fake_score_cells_for_stage(images, anchors, *, own_anchor, models=None):
        return [{
            "image_id": item["image_id"], "identity_own": 0.9, "identity_max": 0.9,
            "age_value": 21.0, "age_anchor": 21.0, "age_delta": 0.1, "gloss": 0.01,
            "niqe": 1.0, "laplacian_variance": 400.0, "face_px": 700, "unavailable": {},
        } for item in images]

    monkeypatch.setattr(gate_module, "score_cells_for_stage", fake_score_cells_for_stage)
    out = tmp_path / "out"
    result = gate_module.run_calibrate(
        "creator-xyz", {"anchors": Path(persona["_persona_path"]).parent / "anchors"},
        out, personas_root=personas_root,
    )
    assert Path(result["json"]).is_file()
    assert Path(result["md"]).is_file()
    md_text = Path(result["md"]).read_text(encoding="utf-8")
    assert "Proposed thresholds" in md_text
    assert "anchors" in md_text
