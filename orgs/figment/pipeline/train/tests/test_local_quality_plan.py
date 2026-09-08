from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]


def load():
    spec = importlib.util.spec_from_file_location("quality_plan_test", HERE / "local_quality_plan.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


quality = load()


def test_closed_recipe_has_eleven_exact_sd_scripts_names():
    recipe = quality._recipe((HERE / "local_quality.toml").read_bytes(), "quality-current")
    assert recipe["max_train_steps"] == 100 and recipe["save_every_n_steps"] == 10
    assert len(recipe["checkpoint_names"]) == 11
    assert recipe["checkpoint_names"][0] == "quality-current-step00000010.safetensors"
    assert recipe["checkpoint_names"][-2:] == ["quality-current-step00000100.safetensors", "quality-current.safetensors"]
    assert recipe["checkpoint_steps"][-2:] == [100, 100]


def test_recipe_refuses_template_without_closed_scheduler():
    with pytest.raises(quality.QualityPlanError, match="fixed recipe"):
        quality._recipe(b"max_train_steps = 100\n", "quality-current")


def test_recipe_refuses_changed_learning_rate_or_rank():
    raw = (HERE / "local_quality.toml").read_text(encoding="utf-8")
    with pytest.raises(quality.QualityPlanError, match="fixed recipe"):
        quality._recipe(raw.replace("learning_rate = 1e-4", "learning_rate = 2e-4").encode(), "quality-current")
    with pytest.raises(quality.QualityPlanError, match="fixed recipe"):
        quality._recipe(raw.replace("network_dim = 32", "network_dim = 16").encode(), "quality-current")


def test_caption_branches_are_closed():
    class Planner:
        MAX_CAPTION_BYTES = 512
        def _persona_caption(self, path): return "current", "persona"
    assert quality._caption("current", Planner(), Path("persona"))[0] == "current"
    assert quality._caption("concise", Planner(), Path(__file__))[0] == quality.CONCISE_CAPTION
    with pytest.raises(quality.QualityPlanError): quality._caption("crop", Planner(), Path(__file__))


@pytest.mark.skipif(not (HERE.parents[3] / "orgs" / "figment" / "personas" / "creator-001" / "anchors" / "g01.jpg").is_file(), reason="local canonical source is not a checkout fixture")
def test_actual_canonical_source_smoke_without_model_access():
    planner = quality._load_planner()
    image = planner._safe_existing(planner.PERSONAS_ROOT / planner.SOURCE_RELATIVE, planner.PERSONAS_ROOT)
    _raw, width, height = planner._read_jpeg(image)
    assert width > 0 and height > 0
