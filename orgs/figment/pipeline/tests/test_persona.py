import importlib.util
import json
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
PERSONAS = PIPELINE.parent / "personas"
PERSONA = PERSONAS / "creator-001" / "persona.yaml"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


persona_mod = load_module("figment_persona", PIPELINE / "persona.py")
load_persona = persona_mod.load_persona
validate_persona = persona_mod.validate_persona
PersonaError = persona_mod.PersonaError


def names(references):
    return [Path(ref).stem for ref in references]


def product_sizes(grammar):
    return (
        len(grammar["angles"]),
        len(grammar["distances"]),
        len(grammar["lights"]),
        len(grammar["wardrobe_families"]),
    )


# ---------------------------------------------------------------------------
# The contract test (plan step 1.2)
# ---------------------------------------------------------------------------


def test_persona_contract():
    persona = load_persona(PERSONA)
    assert names(persona["identity"]["references"]) == ["g01", "g02", "g07"]
    assert product_sizes(persona["grammar"]) == (5, 2, 4, 5)
    assert persona["grammar"]["allocation"]["replicate_scope"] == "half-body-strata-only"
    assert persona["identity"]["floor"]["anchor_cosine_p5"]["status"] == "uncalibrated"
    assert persona["identity"]["floor"]["min_face_px"] == {
        "status": "uncalibrated",
        "value": 600,
        "calibration_set_sha": None,
        "locked_by_gate": None,
    }


def test_persona_load_is_idempotent_and_matches_raw_json():
    raw = json.loads(PERSONA.read_text(encoding="utf-8"))
    loaded = load_persona(PERSONA)
    assert loaded == raw


# ---------------------------------------------------------------------------
# Fixture builder for negative-path tests
# ---------------------------------------------------------------------------


def _base_persona_dict():
    return json.loads(PERSONA.read_text(encoding="utf-8"))


def _write_persona(tmp_path, data, *, with_assets=True):
    # register.spec.path in the base fixture is "../../pipeline/look-spec-v2.md",
    # resolved relative to the persona's own directory — so this fixture root must
    # mirror personas/<id>/../../pipeline exactly two levels up from persona_dir.
    persona_dir = tmp_path / "personas" / "fixture-001"
    persona_dir.mkdir(parents=True)
    if with_assets:
        anchors = persona_dir / "anchors"
        anchors.mkdir()
        for name in ("g01.jpg", "g02.jpg", "g07.jpg"):
            (anchors / name).write_bytes(b"\xff\xd8\xff")  # fake jpeg bytes
        # Byte-identical copies of the REAL spec files, not placeholder text: `data`
        # (from _base_persona_dict) carries the real files' sha256 in
        # identity.spec.sha256 / register.spec.sha256, and validate_persona now
        # checks those against the live file digest (finding 4) — a placeholder
        # fixture would fail every test that doesn't explicitly want a mismatch.
        (persona_dir / "identity-spec.md").write_bytes(
            (PERSONAS / "creator-001" / "identity-spec.md").read_bytes()
        )
        pipeline_dir = tmp_path / "pipeline"
        pipeline_dir.mkdir(parents=True)
        (pipeline_dir / "look-spec-v2.md").write_bytes(
            (PIPELINE / "look-spec-v2.md").read_bytes()
        )
    path = persona_dir / "persona.yaml"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_unknown_top_level_key_rejected(tmp_path):
    data = _base_persona_dict()
    data["unexpected_field"] = "nope"
    path = _write_persona(tmp_path, data)
    with pytest.raises(PersonaError, match="unknown top-level"):
        load_persona(path)


def test_duplicate_reference_rejected(tmp_path):
    data = _base_persona_dict()
    data["identity"]["references"] = ["anchors/g01.jpg", "anchors/g01.jpg", "anchors/g07.jpg"]
    path = _write_persona(tmp_path, data)
    with pytest.raises(PersonaError, match="duplicate reference"):
        load_persona(path)


def test_missing_asset_fails_closed_by_default(tmp_path):
    data = _base_persona_dict()
    path = _write_persona(tmp_path, data)
    # Delete one of the staged anchor files after the persona document is written.
    (path.parent / "anchors" / "g02.jpg").unlink()
    with pytest.raises(PersonaError, match="missing file"):
        load_persona(path)


def test_require_assets_false_is_a_pure_schema_test(tmp_path):
    data = _base_persona_dict()
    path = _write_persona(tmp_path, data, with_assets=False)
    # No anchor files, no identity-spec.md, no look-spec-v2.md on disk at all — this
    # must still pass because require_assets=False skips every filesystem check.
    persona = load_persona(path, require_assets=False)
    assert persona["id"] == "creator-001"


@pytest.mark.parametrize(
    "mutation",
    [
        lambda alloc: alloc.__setitem__("strata", 39),
        lambda alloc: alloc.__setitem__("replicates", 19),
    ],
)
def test_invalid_allocation_totals_rejected(tmp_path, mutation):
    data = _base_persona_dict()
    mutation(data["grammar"]["allocation"])
    path = _write_persona(tmp_path, data)
    with pytest.raises(PersonaError, match="allocation"):
        load_persona(path)


@pytest.mark.parametrize(
    "field,bad_token",
    [
        ("angles", "top-down"),
        ("distances", "full"),
        ("lights", "studio-strobe"),
    ],
)
def test_unsupported_grammar_token_rejected(tmp_path, field, bad_token):
    data = _base_persona_dict()
    data["grammar"][field] = data["grammar"][field][:-1] + [bad_token]
    path = _write_persona(tmp_path, data)
    with pytest.raises(PersonaError, match="unsupported token"):
        load_persona(path)


def test_reference_path_escaping_persona_directory_rejected(tmp_path):
    data = _base_persona_dict()
    data["identity"]["references"] = [
        "../../../etc/passwd",
        "anchors/g02.jpg",
        "anchors/g07.jpg",
    ]
    path = _write_persona(tmp_path, data)
    with pytest.raises(PersonaError, match="escapes the persona directory"):
        load_persona(path, require_assets=False)


def test_register_spec_path_is_allowed_to_leave_the_persona_directory(tmp_path):
    # register.spec.path is *expected* to point outside the persona dir (into
    # pipeline/look-spec-v2.md, design §2.2) — only identity.references and
    # identity.spec.path are contained to the persona directory.
    data = _base_persona_dict()
    path = _write_persona(tmp_path, data, with_assets=False)
    load_persona(path, require_assets=False)  # must not raise


# ---------------------------------------------------------------------------
# Spec sha256 drift detection (finding 4 — P2R review, medium)
# ---------------------------------------------------------------------------


def test_identity_spec_sha256_mismatch_rejected(tmp_path):
    data = _base_persona_dict()
    path = _write_persona(tmp_path, data)
    # Tamper the staged identity-spec.md AFTER persona.yaml is written, so its
    # declared sha256 (copied verbatim from the real, matching file) now disagrees
    # with the live file on disk — exactly the "stale spec" scenario finding 4 named.
    spec_path = path.parent / "identity-spec.md"
    spec_path.write_bytes(spec_path.read_bytes() + b"\ntampered\n")
    with pytest.raises(PersonaError, match="identity.spec.sha256 does not match"):
        load_persona(path)


def test_register_spec_sha256_mismatch_rejected(tmp_path):
    data = _base_persona_dict()
    path = _write_persona(tmp_path, data)
    look_spec_path = tmp_path / "pipeline" / "look-spec-v2.md"
    look_spec_path.write_bytes(look_spec_path.read_bytes() + b"\ntampered\n")
    with pytest.raises(PersonaError, match="register.spec.sha256 does not match"):
        load_persona(path)


def test_spec_sha256_check_is_skipped_when_require_assets_is_false(tmp_path):
    data = _base_persona_dict()
    path = _write_persona(tmp_path, data)
    spec_path = path.parent / "identity-spec.md"
    spec_path.write_bytes(spec_path.read_bytes() + b"\ntampered\n")
    # Must not raise: require_assets=False skips every filesystem/digest check.
    load_persona(path, require_assets=False)


def test_locked_persona_matches_the_committed_look_spec_and_identity_spec_hashes():
    import hashlib

    persona = load_persona(PERSONA)
    identity_spec = PERSONAS / "creator-001" / "identity-spec.md"
    look_spec = PIPELINE / "look-spec-v2.md"
    assert persona["identity"]["spec"]["sha256"] == hashlib.sha256(
        identity_spec.read_bytes()
    ).hexdigest()
    assert persona["register"]["spec"]["sha256"] == hashlib.sha256(
        look_spec.read_bytes()
    ).hexdigest()
