"""Tests for `training_config.py`'s DOP (Differential Output Preservation) keys --
Path-A train-first (r24 method 4 + r21 DOP + r25 causes #4/#5). DOP is off by
default; see `select_training_cells.py`'s module docstring and
`training_config.py`'s own DOP docstring for why the trigger word must be present
in every caption regardless of whether DOP is enabled for a given run.
"""
import importlib.util
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


tc = load_module("figment_training_config", PIPELINE / "training_config.py")


def test_dop_is_off_by_default():
    config = tc.validate_training(None, "creator-002")
    assert config["dop_enabled"] is False
    assert config["dop_multiplier"] == pytest.approx(1.0)
    assert config["dop_class"] == "person"


def test_dop_can_be_turned_on_with_a_custom_multiplier_and_class():
    config = tc.validate_training(
        {"recipe_profile": "clean", "dop_enabled": True, "dop_multiplier": 2.5, "dop_class": "woman"}, "creator-002",
    )
    assert config["dop_enabled"] is True
    assert config["dop_multiplier"] == pytest.approx(2.5)
    assert config["dop_class"] == "woman"


def test_dop_enabled_must_be_a_bool():
    with pytest.raises(tc.TrainingConfigError, match="dop_enabled"):
        tc.validate_training({"dop_enabled": "true"}, "creator-002")


@pytest.mark.parametrize("bad", [0, -1.0, "1.0", True])
def test_dop_multiplier_must_be_a_positive_number_and_not_a_bool(bad):
    with pytest.raises(tc.TrainingConfigError, match="dop_multiplier"):
        tc.validate_training({"dop_multiplier": bad}, "creator-002")


def test_dop_multiplier_is_coerced_to_float():
    config = tc.validate_training({"dop_multiplier": 3}, "creator-002")
    assert config["dop_multiplier"] == 3.0
    assert isinstance(config["dop_multiplier"], float)


@pytest.mark.parametrize("bad", ["", "   ", 5, None])
def test_dop_class_must_be_a_non_empty_string(bad):
    with pytest.raises(tc.TrainingConfigError, match="dop_class"):
        tc.validate_training({"dop_class": bad}, "creator-002")


def test_unknown_training_keys_are_still_rejected():
    with pytest.raises(tc.TrainingConfigError, match="unknown key"):
        tc.validate_training({"dop_enable": True}, "creator-002")  # typo'd key name


# P2 (MANDATE.md stage 2): a second dataset-stage source, klein 3-reference
# generation, alongside today's qwen-edit two-stage replica. Default preserves
# today's behaviour so every existing dataset test (built against "qwen-edit")
# stays green without naming the new key.


def test_dataset_source_defaults_to_qwen_edit():
    config = tc.validate_training(None, "creator-002")
    assert config["dataset_source"] == "qwen-edit"


def test_dataset_source_accepts_klein_multiref():
    config = tc.validate_training({"recipe_profile": "clean", "dataset_source": "klein-multiref"}, "creator-002")
    assert config["dataset_source"] == "klein-multiref"


@pytest.mark.parametrize("bad", ["", "   ", "klein_multiref", "qwen-edit ", 5, None, True])
def test_dataset_source_rejects_anything_outside_the_allowed_set(bad):
    with pytest.raises(tc.TrainingConfigError, match="dataset_source"):
        tc.validate_training({"dataset_source": bad}, "creator-002")


# P2 task 2 (2026-09-16): `dataset_replicates` -- how many distinct-seed jobs
# `_dataset_jobs` emits per qwen-edit prompt row, to push dataset yield above the
# identity gate's approval floor. Default preserves today's behaviour.


def test_dataset_replicates_defaults_to_one():
    config = tc.validate_training(None, "creator-002")
    assert config["dataset_replicates"] == 1


def test_dataset_replicates_accepts_a_larger_integer():
    config = tc.validate_training({"recipe_profile": "clean", "dataset_replicates": 2}, "creator-002")
    assert config["dataset_replicates"] == 2


@pytest.mark.parametrize("bad", [0, -1, 1.5, "2", None, True, False])
def test_dataset_replicates_rejects_anything_outside_a_positive_integer(bad):
    with pytest.raises(tc.TrainingConfigError, match="dataset_replicates"):
        tc.validate_training({"dataset_replicates": bad}, "creator-002")


# 2026-09-22 fix (live evidence, orgs/figment/runs/creator-001/live-20260916b): the
# gen-stage prompt composer's default ("look-clause") reproduces today's behaviour
# byte-for-byte; "trigger-scene" is the tester-proven alternative (10sorlabs
# r15b-generation.md "Prompt-and-LoRA-must-agree").


def test_gen_prompt_style_defaults_to_look_clause():
    config = tc.validate_training(None, "creator-002")
    assert config["gen_prompt_style"] == "look-clause"


def test_gen_prompt_style_accepts_trigger_scene():
    config = tc.validate_training({"gen_prompt_style": "trigger-scene"}, "creator-002")
    assert config["gen_prompt_style"] == "trigger-scene"


@pytest.mark.parametrize("bad", ["", "   ", "look_clause", "trigger-scene ", 5, None, True])
def test_gen_prompt_style_rejects_anything_outside_the_allowed_set(bad):
    with pytest.raises(tc.TrainingConfigError, match="gen_prompt_style"):
        tc.validate_training({"gen_prompt_style": bad}, "creator-002")


def test_gen_prompt_style_accepts_look_clause_close():
    config = tc.validate_training({"gen_prompt_style": "look-clause-close"}, "creator-002")
    assert config["gen_prompt_style"] == "look-clause-close"


# 2026-09-23: `gen_refine_denoise`/`gen_detailer_denoise` -- gen-time-only knobs on
# `_gen_workflow`'s refine (node 15) and detailer (node 33) passes. Defaults reproduce
# today's shipped denoise values (0.35/0.15) byte-for-byte.


def test_gen_refine_and_detailer_denoise_default_to_todays_shipped_values():
    config = tc.validate_training(None, "creator-002")
    assert config["gen_refine_denoise"] == 0.35
    assert config["gen_detailer_denoise"] == 0.15


@pytest.mark.parametrize("key", ["gen_refine_denoise", "gen_detailer_denoise"])
def test_gen_denoise_keys_accept_the_full_0_to_1_range(key):
    for value in (0, 0.0, 1, 1.0, 0.2):
        config = tc.validate_training({key: value}, "creator-002")
        assert config[key] == float(value)


@pytest.mark.parametrize("key", ["gen_refine_denoise", "gen_detailer_denoise"])
@pytest.mark.parametrize("bad", [-0.01, 1.01, "0.1", None, True, False])
def test_gen_denoise_keys_reject_out_of_range_or_non_numeric(key, bad):
    with pytest.raises(tc.TrainingConfigError, match=key):
        tc.validate_training({key: bad}, "creator-002")


def test_recipe_profile_defaults_to_tensor_and_rejects_unknown_values():
    assert tc.validate_training(None, "creator-003")["recipe_profile"] == "tensor"
    assert tc.validate_training({"recipe_profile": "clean"}, "creator-002")["recipe_profile"] == "clean"
    with pytest.raises(tc.TrainingConfigError, match="recipe_profile"):
        tc.validate_training({"recipe_profile": "hybrid"}, "creator-003")


def test_creator001_must_name_its_recipe_profile_explicitly():
    with pytest.raises(tc.TrainingConfigError, match="creator-001 must name"):
        tc.validate_training({"steps": 3000, "save_every": 250}, "creator-001")
    assert tc.validate_training({"recipe_profile": "clean"}, "creator-001")["recipe_profile"] == "clean"
