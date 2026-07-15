from validate_capability_map import validate, VALID_RESOLUTIONS


def _base(slots):
    return {"channel": "x", "production_pipeline": "p", "slots": slots}


def test_valid_map_has_no_errors():
    data = _base({"research": {"resolution": "reuse", "skill": "researcher"}})
    assert validate(data) == []


def test_missing_top_level_key():
    errs = validate({"slots": {}})
    assert any("channel" in e for e in errs)
    assert any("production_pipeline" in e for e in errs)


def test_slots_must_be_object():
    errs = validate({"channel": "x", "production_pipeline": "p", "slots": []})
    assert any("slots" in e for e in errs)


def test_invalid_resolution():
    errs = validate(_base({"s": {"resolution": "bogus"}}))
    assert any("invalid resolution" in e for e in errs)


def test_reuse_requires_skill():
    errs = validate(_base({"s": {"resolution": "reuse"}}))
    assert any("requires 'skill'" in e for e in errs)


def test_reconfigure_requires_skill():
    errs = validate(_base({"s": {"resolution": "reconfigure"}}))
    assert any("requires 'skill'" in e for e in errs)


def test_build_requires_plan():
    errs = validate(_base({"s": {"resolution": "build"}}))
    assert any("requires 'plan'" in e for e in errs)


def test_na_slot_ok():
    assert validate(_base({"s": {"resolution": "n/a"}})) == []


def test_enum_constant_shape():
    assert VALID_RESOLUTIONS == {"reuse", "reconfigure", "adapt", "build", "n/a"}
