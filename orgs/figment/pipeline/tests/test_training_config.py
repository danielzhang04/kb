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
        {"dop_enabled": True, "dop_multiplier": 2.5, "dop_class": "woman"}, "creator-002",
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
