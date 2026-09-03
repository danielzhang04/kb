import importlib.util
import json
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


qa_stamp = load_module("figment_pipeline_qa_stamp_under_test", PIPELINE / "qa_stamp.py")


GOOD_SAFETY = {"adult_read": "pass", "garment_integrity": "pass", "real_person_resemblance": "clear"}
GOOD_QUALITY = {"identity": "pass", "realism": "pass", "hands": "pass", "lighting": "pass"}


def _ruling(image_id="img_0001", **overrides):
    ruling = {"image_id": image_id}
    ruling.update(GOOD_QUALITY)
    ruling.update(GOOD_SAFETY)
    ruling.update(overrides)
    return ruling


def _manifest(*image_ids):
    return {"images": [
        {"image_id": iid, "review_status": "unreviewed", "parked_reasons": []}
        for iid in image_ids
    ]}


# ---------------------------------------------------------------------------
# A complete pass
# ---------------------------------------------------------------------------


def test_classify_complete_pass_is_verified_with_no_safety_failure():
    status, reasons, safety_failed, safety_reasons = qa_stamp.classify(_ruling())
    assert (status, reasons, safety_failed, safety_reasons) == ("verified", [], False, [])


def test_stamp_writes_verified_and_safety_fields_onto_manifest():
    manifest = _manifest("img_0001")
    n_verified, m_parked, n_unreviewed = qa_stamp.stamp(manifest, [_ruling()])
    assert (n_verified, m_parked, n_unreviewed) == (1, 0, 0)
    entry = manifest["images"][0]
    assert entry["review_status"] == "verified"
    assert entry["parked_reasons"] == []
    assert entry["safety_failed"] is False
    assert entry["safety_reasons"] == []


# ---------------------------------------------------------------------------
# Each safety failure spelling
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"adult_read": "ambiguous"},
        {"adult_read": "fail"},
        {"garment_integrity": "fail"},
        {"real_person_resemblance": "flag"},
    ],
)
def test_each_safety_failure_spelling_trips_safety_failed(overrides):
    status, reasons, safety_failed, safety_reasons = qa_stamp.classify(_ruling(**overrides))
    assert safety_failed is True
    assert safety_reasons  # non-empty — names the failing axis:value
    # review_status stays orthogonal — an otherwise-clean quality ruling still verifies.
    assert status == "verified"


def test_safety_failed_does_not_force_review_status_to_parked():
    ruling = _ruling(garment_integrity="fail")
    status, _reasons, safety_failed, _safety_reasons = qa_stamp.classify(ruling)
    assert safety_failed is True
    assert status == "verified"


# ---------------------------------------------------------------------------
# Each missing safety axis
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("missing_axis", list(qa_stamp.SAFETY_AXES))
def test_each_missing_safety_axis_fails_closed(missing_axis):
    ruling = _ruling()
    del ruling[missing_axis]
    with pytest.raises(ValueError, match="missing required safety axis"):
        qa_stamp.classify(ruling)


@pytest.mark.parametrize("missing_axis", list(qa_stamp.SAFETY_AXES))
def test_null_safety_axis_also_fails_closed(missing_axis):
    ruling = _ruling(**{missing_axis: None})
    with pytest.raises(ValueError, match="missing required safety axis"):
        qa_stamp.classify(ruling)


# ---------------------------------------------------------------------------
# An unknown value
# ---------------------------------------------------------------------------


def test_unknown_safety_value_hard_errors():
    ruling = _ruling(adult_read="probably-fine")
    with pytest.raises(ValueError, match="malformed safety verdict"):
        qa_stamp.classify(ruling)


def test_unknown_quality_value_hard_errors():
    ruling = _ruling(identity="kinda-pass")
    with pytest.raises(ValueError, match="malformed axis verdict"):
        qa_stamp.classify(ruling)


# ---------------------------------------------------------------------------
# A parked item
# ---------------------------------------------------------------------------


def test_a_parked_item_carries_reasons_and_safety_fields():
    ruling = _ruling(hands="hard-fail", why="six fingers")
    status, reasons, safety_failed, safety_reasons = qa_stamp.classify(ruling)
    assert status == "parked"
    assert "hands: hard-fail" in reasons
    assert "six fingers" in reasons
    assert safety_failed is False
    assert safety_reasons == []


def test_a_parked_item_with_a_safety_failure_carries_both():
    ruling = _ruling(hands="hard-fail", real_person_resemblance="flag")
    status, reasons, safety_failed, safety_reasons = qa_stamp.classify(ruling)
    assert status == "parked"
    assert safety_failed is True
    assert "real_person_resemblance: flag" in safety_reasons
    # parked_reasons stays quality-only — safety reasons live in their own field.
    assert not any("real_person_resemblance" in r for r in reasons)


# ---------------------------------------------------------------------------
# Atomic persistence
# ---------------------------------------------------------------------------


def test_atomic_write_json_leaves_no_tmp_file_and_round_trips(tmp_path):
    path = tmp_path / "manifest.json"
    qa_stamp._atomic_write_json(path, {"hello": "world"})
    assert json.loads(path.read_text(encoding="utf-8")) == {"hello": "world"}
    assert not path.with_name(path.name + ".tmp").exists()


def test_cli_main_writes_manifest_atomically(tmp_path):
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(_manifest("img_0001")), encoding="utf-8")
    rulings_path = tmp_path / "rulings.json"
    rulings_path.write_text(json.dumps([_ruling()]), encoding="utf-8")

    assert qa_stamp.main([str(rulings_path), str(manifest_path)]) == 0
    updated = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert updated["images"][0]["review_status"] == "verified"
    assert not manifest_path.with_name(manifest_path.name + ".tmp").exists()


# ---------------------------------------------------------------------------
# Legacy input with no safety axes fails closed rather than silently passing
# ---------------------------------------------------------------------------


def test_legacy_ruling_with_no_safety_axes_fails_closed():
    legacy_ruling = {"image_id": "img_0001", "identity": "pass"}  # pre-P1 shape
    with pytest.raises(ValueError, match="missing required safety axis"):
        qa_stamp.classify(legacy_ruling)


def test_stamp_propagates_the_fail_closed_error_and_writes_nothing(tmp_path):
    manifest = _manifest("img_0001")
    before = json.dumps(manifest)
    legacy_ruling = {"image_id": "img_0001", "identity": "pass"}
    with pytest.raises(ValueError, match="missing required safety axis"):
        qa_stamp.stamp(manifest, [legacy_ruling])
    # stamp() mutates the in-memory manifest only on a per-ruling basis; the ruling
    # that raised must not have partially written review_status onto the entry.
    assert manifest["images"][0]["review_status"] == "unreviewed"
    assert json.dumps(manifest) != "corrupted"  # sanity: manifest is still valid JSON-able
    assert before  # unused beyond documenting intent; real atomicity is the CLI's job
