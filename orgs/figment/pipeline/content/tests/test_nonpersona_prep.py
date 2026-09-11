from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from orgs.figment.pipeline.content import content_brief as briefs
from orgs.figment.pipeline.content import nonpersona_prep as prep

TRIGGER = "ohwx001"
PINS_PATH = briefs.CONTENT_DIR.parent / "train" / "tensor-pins.yaml"
DELIVERY_TARGET = {"aspect": "3:4", "width": 1080, "height": 1440}
SEEDS = [1595, 481516234, 90210]

CT5_SLOTS = [
    {"taxonomy_type": "A", "kind": "persona"},
    {"taxonomy_type": "D", "kind": "nonpersona"},
    {"taxonomy_type": "C", "kind": "nonpersona"},
    {"taxonomy_type": "A", "kind": "persona"},
]
CT3_SLOTS = [
    {"taxonomy_type": "B", "kind": "persona"},
    {"taxonomy_type": "B", "kind": "persona"},
    {"taxonomy_type": "B", "kind": "persona"},
    {"taxonomy_type": "E", "kind": "nonpersona"},
]
CT1_SLOTS = [
    {"taxonomy_type": "A", "kind": "persona"},
    {"taxonomy_type": "A", "kind": "persona"},
    {"taxonomy_type": "A", "kind": "persona"},
    {"taxonomy_type": "A", "kind": "persona"},
    {"taxonomy_type": "F", "kind": "nonpersona"},
]


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _root(tmp_path: Path) -> Path:
    root = tmp_path / "prep-root"
    persona_dir = root / "personas" / "creator-001"
    (persona_dir / "anchors").mkdir(parents=True)
    (persona_dir / "anchors" / "g01.jpg").write_bytes(b"canonical-anchor")
    (persona_dir / "persona.yaml").write_text(json.dumps({
        "id": "creator-001",
        "identity": {"references": ["anchors/g01.jpg"]},
        "training": {"trigger": TRIGGER},
    }), encoding="utf-8")
    (root / "out").mkdir()
    return root


def _request(template_id: str, slots: list[dict]) -> dict:
    return {
        "schema": "figment/content-brief-request@1",
        "brief_date": "2026-09-08",
        "creator": {"id": "creator-001", "persona_path": "personas/creator-001/persona.yaml", "canonical_reference": "anchors/g01.jpg"},
        "surface": "carousel",
        "template_id": template_id,
        "asset_slots": slots,
        "sources": [{"citation": "https://example.test/research", "observed_date": "2026-09-07"}],
        "hypothesis": "A cheap non-persona slot supports the payoff.",
        "intended_metric": "saves per reached account",
        "observed_metrics": None,
    }


def _brief(root: Path, template_id: str, slots: list[dict]) -> dict:
    (root / "request.json").write_text(json.dumps(_request(template_id, slots)), encoding="utf-8")
    return briefs.build_content_brief(root, "request.json", "out/brief.json")


def _brief_ref(root: Path) -> dict:
    return {"path": "out/brief.json", "sha256": _sha(root / "out" / "brief.json")}


def _scene(brief_ref: dict, slot_index: int, taxonomy_type: str, subject: str, **extra: object) -> dict:
    result = {
        "schema": prep.REQUEST_SCHEMA,
        "brief": brief_ref,
        "slot_index": slot_index,
        "taxonomy_type": taxonomy_type,
        "subject": subject,
    }
    result.update(extra)
    return result


def _write_scene(root: Path, scene: dict, name: str = "scene.json") -> None:
    (root / name).write_text(json.dumps(scene), encoding="utf-8")


def _expected_models() -> list[dict]:
    pins = json.loads(PINS_PATH.read_text(encoding="utf-8"))
    return pins["pins"]["tester"]["models"]


@pytest.mark.parametrize(("slot_index", "taxonomy_type"), [(2, "D"), (3, "C")])
def test_prepares_ct5_place_alone_slot(tmp_path: Path, slot_index: int, taxonomy_type: str):
    root = _root(tmp_path)
    _brief(root, "CT-5", CT5_SLOTS)
    scene = _scene(_brief_ref(root), slot_index, taxonomy_type, "an empty tiled cafe counter at dawn")
    _write_scene(root, scene)

    record = prep.build_nonpersona_slot_preparation(
        root=root, request_path="request.json", brief_path="out/brief.json",
        scene_path="scene.json", output_path="out/prep.json",
    )

    assert record["schema"] == prep.OUTPUT_SCHEMA
    assert record["not_promotable"] is True
    assert record["claims"] == {"generated": False, "reviewed": False, "slot_fit": False, "delivered": False}
    assert record["slot"] == {"index": slot_index, "role": "place-alone", "taxonomy_type": taxonomy_type, "kind": "nonpersona"}
    assert record["seeds"] == SEEDS
    gb = record["generation_basis"]
    assert gb["arm"] == "base-model-no-lora"
    assert gb["models"] == _expected_models()
    assert gb["delivery_target"] == DELIVERY_TARGET
    assert gb["native_inference_dimensions"] is None
    assert gb["pins_sha256"] == _sha(PINS_PATH)
    deps = record["dependencies"]
    assert deps["persona"]["sha256"] == _sha(root / "personas" / "creator-001" / "persona.yaml")
    assert deps["canonical_reference"]["sha256"] == _sha(root / "personas" / "creator-001" / "anchors" / "g01.jpg")
    assert isinstance(deps["template"]["sha256"], str) and deps["template"]["sha256"]
    assert deps["taxonomy"]["sha256"] == _sha(briefs.CONTENT_DIR / "taxonomy.yaml")

    saved = json.loads((root / "out" / "prep.json").read_text(encoding="utf-8"))
    assert saved == record
    replayed = prep.revalidate_nonpersona_slot_preparation(
        root, "request.json", "out/brief.json", "scene.json", "out/prep.json",
    )
    assert replayed == record


def test_prepares_ct3_flatlay_slot(tmp_path: Path):
    root = _root(tmp_path)
    _brief(root, "CT-3", CT3_SLOTS)
    scene = _scene(_brief_ref(root), 4, "E", "a folded wool scarf on a wooden table")
    _write_scene(root, scene)

    record = prep.build_nonpersona_slot_preparation(
        root=root, request_path="request.json", brief_path="out/brief.json",
        scene_path="scene.json", output_path="out/prep.json",
    )
    assert record["slot"] == {"index": 4, "role": "flatlay", "taxonomy_type": "E", "kind": "nonpersona"}
    assert record["generation_basis"]["delivery_target"] == DELIVERY_TARGET


def test_invalid_brief_rejects_unsupported_template_type(tmp_path: Path):
    root = _root(tmp_path)
    bad_slots = list(CT5_SLOTS)
    bad_slots[1] = {"taxonomy_type": "G", "kind": "nonpersona"}
    with pytest.raises(briefs.ContentBriefError):
        _brief(root, "CT-5", bad_slots)


def test_invalid_prep_rejects_mismatched_slot_kind(tmp_path: Path):
    root = _root(tmp_path)
    _brief(root, "CT-5", CT5_SLOTS)
    scene = _scene(_brief_ref(root), 1, "A", "a persona slot mistakenly targeted")
    _write_scene(root, scene)
    with pytest.raises(prep.NonpersonaPrepError, match="slot kind must be nonpersona"):
        prep.build_nonpersona_slot_preparation(
            root=root, request_path="request.json", brief_path="out/brief.json",
            scene_path="scene.json", output_path="out/prep.json",
        )


def test_invalid_prep_rejects_unsupported_taxonomy_type(tmp_path: Path):
    root = _root(tmp_path)
    _brief(root, "CT-1", CT1_SLOTS)
    scene = _scene(_brief_ref(root), 5, "F", "a blurred neon sign at night")
    _write_scene(root, scene)
    with pytest.raises(prep.NonpersonaPrepError, match="not supported by this preparation slice"):
        prep.build_nonpersona_slot_preparation(
            root=root, request_path="request.json", brief_path="out/brief.json",
            scene_path="scene.json", output_path="out/prep.json",
        )


@pytest.mark.parametrize(("subject", "match"), [
    ("this is creator-001's counter", "creator id"),
    (f"a room branded with {TRIGGER}", "training trigger"),
    ("a woman leaning on the counter", "person-denylisted"),
    ("a counter with a\x00null byte", "control characters"),
    ("a counter with a\udcff lone surrogate", "lone surrogate"),
    (" a counter with leading space", "already be trimmed"),
    ("a" * 513, "exceeds"),
    ("\U0001F600" * 257, "exceeds"),
])
def test_rejects_invalid_subject(tmp_path: Path, subject: str, match: str):
    root = _root(tmp_path)
    _brief(root, "CT-5", CT5_SLOTS)
    scene = _scene(_brief_ref(root), 2, "D", subject)
    _write_scene(root, scene)
    with pytest.raises(prep.NonpersonaPrepError, match=match):
        prep.build_nonpersona_slot_preparation(
            root=root, request_path="request.json", brief_path="out/brief.json",
            scene_path="scene.json", output_path="out/prep.json",
        )


def test_rejects_unknown_scene_keys(tmp_path: Path):
    root = _root(tmp_path)
    _brief(root, "CT-5", CT5_SLOTS)
    scene = _scene(_brief_ref(root), 2, "D", "an empty tiled counter", extra_field="nope")
    _write_scene(root, scene)
    with pytest.raises(prep.NonpersonaPrepError, match="unsupported fields"):
        prep.build_nonpersona_slot_preparation(
            root=root, request_path="request.json", brief_path="out/brief.json",
            scene_path="scene.json", output_path="out/prep.json",
        )


def test_rejects_forged_claims_in_scene(tmp_path: Path):
    root = _root(tmp_path)
    _brief(root, "CT-5", CT5_SLOTS)
    scene = _scene(_brief_ref(root), 2, "D", "an empty tiled counter")
    scene["approved"] = True
    _write_scene(root, scene)
    with pytest.raises(prep.NonpersonaPrepError, match="unsupported fields"):
        prep.build_nonpersona_slot_preparation(
            root=root, request_path="request.json", brief_path="out/brief.json",
            scene_path="scene.json", output_path="out/prep.json",
        )


@pytest.mark.parametrize("mutate", ["scene", "request", "brief", "persona", "anchor"])
def test_revalidate_rejects_stale_producer_inputs(tmp_path: Path, mutate: str):
    root = _root(tmp_path)
    _brief(root, "CT-3", CT3_SLOTS)
    scene = _scene(_brief_ref(root), 4, "E", "a folded wool scarf on a wooden table")
    _write_scene(root, scene)
    prep.build_nonpersona_slot_preparation(
        root=root, request_path="request.json", brief_path="out/brief.json",
        scene_path="scene.json", output_path="out/prep.json",
    )

    if mutate == "scene":
        scene["subject"] = "a folded wool scarf on the porch railing"
        _write_scene(root, scene)
    elif mutate == "request":
        request = json.loads((root / "request.json").read_text(encoding="utf-8"))
        request["hypothesis"] = "A different hypothesis entirely."
        (root / "request.json").write_text(json.dumps(request), encoding="utf-8")
    elif mutate == "brief":
        brief_path = root / "out" / "brief.json"
        brief_record = json.loads(brief_path.read_text(encoding="utf-8"))
        brief_record["hypothesis"] = "A tampered hypothesis."
        brief_path.write_text(json.dumps(brief_record), encoding="utf-8")
    elif mutate == "persona":
        persona_path = root / "personas" / "creator-001" / "persona.yaml"
        persona = json.loads(persona_path.read_text(encoding="utf-8"))
        persona["training"]["trigger"] = "ohwx002"
        persona_path.write_text(json.dumps(persona), encoding="utf-8")
    else:
        (root / "personas" / "creator-001" / "anchors" / "g01.jpg").write_bytes(b"different-anchor-bytes")

    with pytest.raises((prep.NonpersonaPrepError, briefs.ContentBriefError)):
        prep.revalidate_nonpersona_slot_preparation(
            root, "request.json", "out/brief.json", "scene.json", "out/prep.json",
        )


@pytest.mark.parametrize("tamper", [
    lambda record: {**record, "seeds": [1595.0, *record["seeds"][1:]]},
    lambda record: {**record, "slot": {**record["slot"], "index": str(record["slot"]["index"])}},
])
def test_revalidate_rejects_tampered_stored_preparation(tmp_path: Path, tamper):
    root = _root(tmp_path)
    _brief(root, "CT-3", CT3_SLOTS)
    scene = _scene(_brief_ref(root), 4, "E", "a folded wool scarf on a wooden table")
    _write_scene(root, scene)
    record = prep.build_nonpersona_slot_preparation(
        root=root, request_path="request.json", brief_path="out/brief.json",
        scene_path="scene.json", output_path="out/prep.json",
    )
    output_path = root / "out" / "prep.json"
    output_path.write_text(json.dumps(tamper(record), indent=2, sort_keys=True), encoding="utf-8")

    with pytest.raises(prep.NonpersonaPrepError, match="stale"):
        prep.revalidate_nonpersona_slot_preparation(
            root, "request.json", "out/brief.json", "scene.json", "out/prep.json",
        )


def test_rejects_non_fresh_output(tmp_path: Path):
    root = _root(tmp_path)
    _brief(root, "CT-3", CT3_SLOTS)
    scene = _scene(_brief_ref(root), 4, "E", "a folded wool scarf on a wooden table")
    _write_scene(root, scene)
    (root / "out" / "prep.json").write_text("{}", encoding="utf-8")
    with pytest.raises(prep.NonpersonaPrepError, match="fresh"):
        prep.build_nonpersona_slot_preparation(
            root=root, request_path="request.json", brief_path="out/brief.json",
            scene_path="scene.json", output_path="out/prep.json",
        )


def test_build_and_revalidate_accept_nested_path_arguments(tmp_path: Path):
    root = _root(tmp_path)
    _brief(root, "CT-3", CT3_SLOTS)
    scene = _scene(_brief_ref(root), 4, "E", "a folded wool scarf on a wooden table")
    (root / "place").mkdir(exist_ok=True)
    _write_scene(root, scene, name="place/scene-D.json")

    record = prep.build_nonpersona_slot_preparation(
        root=root, request_path=Path("request.json"), brief_path=Path("out/brief.json"),
        scene_path=Path("place/scene-D.json"), output_path=Path("place/prep-D.json"),
    )
    assert record["slot"]["taxonomy_type"] == "E"

    replayed = prep.revalidate_nonpersona_slot_preparation(
        root, Path("request.json"), Path("out/brief.json"),
        Path("place/scene-D.json"), Path("place/prep-D.json"),
    )
    assert replayed == record


def test_rejects_path_traversal_argument(tmp_path: Path):
    root = _root(tmp_path)
    _brief(root, "CT-3", CT3_SLOTS)
    scene = _scene(_brief_ref(root), 4, "E", "a folded wool scarf on a wooden table")
    _write_scene(root, scene)
    with pytest.raises(prep.NonpersonaPrepError):
        prep.build_nonpersona_slot_preparation(
            root=root, request_path="request.json", brief_path="out/brief.json",
            scene_path=Path("../scene.json"), output_path="out/prep.json",
        )


def test_rejects_output_path_escape(tmp_path: Path):
    root = _root(tmp_path)
    _brief(root, "CT-3", CT3_SLOTS)
    scene = _scene(_brief_ref(root), 4, "E", "a folded wool scarf on a wooden table")
    _write_scene(root, scene)
    with pytest.raises(prep.NonpersonaPrepError):
        prep.build_nonpersona_slot_preparation(
            root=root, request_path="request.json", brief_path="out/brief.json",
            scene_path="scene.json", output_path="../escape.json",
        )


def test_rejects_concurrent_scene_mutation_during_replay(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _root(tmp_path)
    _brief(root, "CT-3", CT3_SLOTS)
    brief_ref = _brief_ref(root)
    scene_path = root / "scene.json"

    def write(subject: str) -> None:
        _write_scene(root, _scene(brief_ref, 4, "E", subject))

    write("a folded wool scarf on a wooden table")

    original = prep._compile_record
    calls = {"n": 0}

    def mutated(root_arg, request_path, brief_path, scene_path_arg):
        calls["n"] += 1
        result = original(root_arg, request_path, brief_path, scene_path_arg)
        if calls["n"] == 1:
            write("a folded wool scarf on the porch railing")
        return result

    monkeypatch.setattr(prep, "_compile_record", mutated)
    with pytest.raises(prep.NonpersonaPrepError, match="changed while preparing"):
        prep.build_nonpersona_slot_preparation(
            root=root, request_path="request.json", brief_path="out/brief.json",
            scene_path="scene.json", output_path="out/prep.json",
        )
    assert not (root / "out" / "prep.json").exists()
    assert scene_path.exists()
