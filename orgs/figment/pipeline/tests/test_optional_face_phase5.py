"""Optional gen-only face words preserve established identity/training behavior."""
import copy
import importlib.util
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("optional_face_driver", HERE / "figment_train.py")
ft = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = ft
spec.loader.exec_module(ft)


@pytest.fixture
def persona():
    return ft._read_json(HERE.parent / "personas/creator-003/persona.yaml")


@pytest.mark.parametrize("value", [None, "", "an oval adult face"])
def test_optional_face_does_not_change_eight_slot_composition_or_generic_projection(persona, value):
    original = copy.deepcopy(persona)
    original["identity"]["look"].pop("face", None)
    changed = copy.deepcopy(original)
    if value is not None:
        changed["identity"]["look"]["face"] = value
    ft._persona_module()._validate_identity_look(changed["identity"]["look"], "identity.look")
    assert ft._compose_look_clause(original["identity"]["look"]) == ft._compose_look_clause(changed["identity"]["look"])
    assert ft._lineage_module().persona_input_projection(original) == ft._lineage_module().persona_input_projection(changed)


@pytest.mark.parametrize("key", ["age_stage", "hair", "eyes", "skin", "brows", "makeup", "build", "clothing"])
def test_original_eight_slots_remain_generic_authority_inputs(persona, key):
    changed = copy.deepcopy(persona)
    changed["identity"]["look"][key] += " changed"
    assert ft._lineage_module().persona_input_projection(persona) != ft._lineage_module().persona_input_projection(changed)


@pytest.mark.parametrize("value", [None, 42, True, [], {}, "full face of makeup"])
def test_explicit_face_must_be_text_and_obey_existing_word_rules(persona, value):
    persona["identity"]["look"]["face"] = value
    with pytest.raises(ValueError):
        ft._persona_module()._validate_identity_look(persona["identity"]["look"], "identity.look")


def test_gen_only_face_does_not_change_passport_leakage_scan(persona):
    parity = ft._tensor_parity_module()
    training = ft._training_config_module().validate_training({}, "creator-003")
    pins = ft._read_json(ft.PINS_PATH)
    manifest = ft._passport_tensor_manifest(persona, training, pins)
    workflow = ft._read_json(ft.TENSOR_PASSPORT_WORKFLOW_PATH)
    look = copy.deepcopy(persona["identity"]["look"])
    look.pop("face", None)
    baseline = parity.check_passport(workflow, manifest, look)
    look["face"] = manifest["jobs"][0]["substitutions"][0]["value"]
    assert parity.check_passport(workflow, manifest, look) == baseline
    look["skin"] = look["face"]
    assert any("identity.look.skin" in problem for problem in parity.check_passport(workflow, manifest, look))
