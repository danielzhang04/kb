"""nonpersona_native compile/revalidate against a real isolated creator-001 fixture.

Real content_brief and nonpersona_prep producers build every input; nothing mocks
approval, hashing, or the pod-runner manifest contract. Only the publication tests
inject filesystem failures.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
from pathlib import Path, PurePosixPath

import pytest

from orgs.figment.pipeline.content import content_brief as briefs
from orgs.figment.pipeline.content import nonpersona_native as native
from orgs.figment.pipeline.content import nonpersona_prep as prep

PERSONA_SRC = Path(__file__).resolve().parents[3] / "personas" / "creator-001"
TRIGGER = "creator001krea2"
# taxonomy -> (template, 1-based slot index, subject)
SLOTS = {
    "D": ("CT-5", 2, "an empty tiled cafe counter at dawn"),
    "C": ("CT-5", 3, "a folded wool scarf on a wooden table"),
    "E": ("CT-3", 4, "a folded wool scarf on a wooden table"),
}
TEMPLATE_SLOTS = {"CT-5": "ADCA", "CT-3": "BBBE"}


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


@pytest.fixture
def root(tmp_path: Path) -> Path:
    base = tmp_path / "root"
    persona_dir = base / "personas" / "creator-001"
    persona_dir.mkdir(parents=True)
    (base / "out").mkdir()
    (base / "ledger").mkdir()
    persona_src = PERSONA_SRC / "persona.yaml"
    shutil.copy2(persona_src, persona_dir / "persona.yaml")
    if (PERSONA_SRC / "training.yaml").is_file():
        shutil.copy2(PERSONA_SRC / "training.yaml", persona_dir / "training.yaml")
    persona = json.loads(persona_src.read_text(encoding="utf-8"))
    identity = persona["identity"]
    for rel in [*identity["references"], identity["spec"]["path"]]:
        (persona_dir / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(PERSONA_SRC / rel, persona_dir / rel)
    # register.spec is project-relative (../../pipeline/...): mirror it at the same
    # resolved position inside the fixture root, never outside it.
    register_rel = persona["register"]["spec"]["path"]
    register_src = (PERSONA_SRC / register_rel).resolve()
    register_dst = (persona_dir / register_rel).resolve()
    assert register_src.is_relative_to(PERSONA_SRC.parents[1].resolve())
    assert register_dst.is_relative_to(base.resolve())
    register_dst.parent.mkdir(parents=True, exist_ok=True)
    register_dst.write_bytes(register_src.read_bytes())
    return base


def _request(template: str) -> dict:
    return {
        "schema": "figment/content-brief-request@1",
        "brief_date": "2026-09-08",
        "creator": {
            "id": "creator-001",
            "persona_path": "personas/creator-001/persona.yaml",
            "canonical_reference": "anchors/g01.jpg",
        },
        "surface": "carousel",
        "template_id": template,
        "asset_slots": [
            {"taxonomy_type": t, "kind": "persona" if t in "AB" else "nonpersona"}
            for t in TEMPLATE_SLOTS[template]
        ],
        "sources": [{"citation": "https://example.test/research", "observed_date": "2026-09-07"}],
        "hypothesis": "An empty scene supports the sequence.",
        "intended_metric": "saves per reached account",
        "observed_metrics": None,
    }


def _prepare(root: Path, taxonomy: str, tag: str, subject: str | None = None) -> Path:
    template, index, default_subject = SLOTS[taxonomy]
    request, brief, scene, out = (f"{tag}-request.json", f"out/{tag}-brief.json",
                                  f"{tag}-scene.json", f"out/{tag}-prep.json")
    _write_json(root / request, _request(template))
    briefs.build_content_brief(root, request, brief)
    _write_json(root / scene, {
        "schema": prep.REQUEST_SCHEMA,
        "brief": {"path": brief, "sha256": hashlib.sha256((root / brief).read_bytes()).hexdigest()},
        "slot_index": index,
        "taxonomy_type": taxonomy,
        "subject": subject or default_subject,
    })
    prep.build_nonpersona_slot_preparation(
        root=root, request_path=request, brief_path=brief, scene_path=scene, output_path=out,
    )
    return Path(out)


def _compile(root: Path, tag: str, taxonomy: str = "D") -> tuple[Path, dict]:
    prep_rel = _prepare(root, taxonomy, tag)
    out = Path("out") / f"native-{tag}"
    record = native.compile_nonpersona_native(
        root=root, preparation_path=prep_rel, out=out, ledger_dir=root / "ledger",
    )
    return out, record


def _snapshot(directory: Path) -> dict[str, bytes]:
    return {p.relative_to(directory).as_posix(): p.read_bytes()
            for p in sorted(directory.rglob("*")) if p.is_file()}


@pytest.mark.parametrize("taxonomy", ["C", "D", "E"])
def test_real_slot_compiles_to_tester_graph_and_revalidates(root: Path, taxonomy: str) -> None:
    index = SLOTS[taxonomy][1]
    prep_rel = _prepare(root, taxonomy, taxonomy)
    prepared = json.loads((root / prep_rel).read_text(encoding="utf-8"))
    out = Path("out") / f"native-{taxonomy}"
    record = native.compile_nonpersona_native(
        root=root, preparation_path=prep_rel, out=out, ledger_dir=root / "ledger",
    )
    train = native._train()
    seeds = list(train.DIAGNOSTIC_PROTOCOL_SEEDS[:3])
    prefix = f"{train._creator_output_code('creator-001')}-np-s{index}"
    prompt = prepared["prompt"]["text"]

    assert prepared["seeds"] == seeds
    assert record["stage"] == "compiled-not-run" and record["not_promotable"] is True
    assert record["claims"] == {"generated": False, "reviewed": False,
                                "slot_fit": False, "delivered": False}
    assert record["slot"] == prepared["slot"] and record["slot"]["index"] == index
    assert record["slot"]["taxonomy_type"] == taxonomy
    assert record["arm"] == "base-model-no-lora"
    assert record["native_dimensions"] == {"width": 1448, "height": 2176}
    assert record["delivery_target"] == prepared["generation_basis"]["delivery_target"]
    assert record["delivery_transform"] is None
    assert record["cells"] == [{"id": f"s{index}-{s}", "seed": s, "output_name": f"{prefix}-{s}"}
                               for s in seeds]
    assert record["preparation"]["path"] == prep_rel.as_posix()
    assert record["out"] == out.as_posix()

    out_dir = root / out
    manifest_bytes = (out_dir / native.MANIFEST_NAME).read_bytes()
    manifest = json.loads(manifest_bytes)
    assert record["manifest"] == {"path": native.MANIFEST_NAME,
                                  "sha256": hashlib.sha256(manifest_bytes).hexdigest()}
    assert json.loads((out_dir / native.RECORD_NAME).read_bytes()) == record
    assert (out_dir / native.PENDING_RECORD_NAME).read_bytes() == \
        (out_dir / native.RECORD_NAME).read_bytes()

    # B1: plain harness launch; nothing that trains, uploads, or waits.
    assert manifest["comfyui"]["start_command"] == "python main.py"
    assert record["startup"]["start_command"] == "python main.py"
    assert not {"training", "uploads", "wait_for", "artifacts"} & set(manifest)
    assert manifest["jobs"] == [{"seed": c["seed"], "output_name": c["output_name"],
                                 "expected_images": 1} for c in record["cells"]]
    assert manifest["workflow"] == train._tester_base_workflow(prompt, prefix)

    pod = train._pod_runner_module()
    pod.require_manifest(manifest, out_dir / native.MANIFEST_NAME)
    for job in manifest["jobs"]:
        applied = pod.apply_job(copy.deepcopy(manifest["workflow"]), job, manifest["seed_fields"])
        assert applied["5"]["inputs"]["text"] == prompt
        assert applied["5"]["inputs"]["clip"] == ["2", 0]
        assert applied["8"]["inputs"]["model"] == ["1", 0]
        assert applied["8"]["inputs"]["seed"] == job["seed"]
        assert applied["10"]["inputs"]["filename_prefix"] == job["output_name"]
        assert "4" not in applied
        assert not any("lora" in node["class_type"].lower() for node in applied.values())

    before = _snapshot(out_dir)
    assert native.revalidate_nonpersona_native(root=root, out=out) == record
    assert _snapshot(out_dir) == before


def _json_edit(edit):
    def apply(raw: bytes) -> bytes:
        value = json.loads(raw)
        edit(value)
        return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")
    return apply


def _set(path: tuple, value):
    def edit(obj):
        for key in path[:-1]:
            obj = obj[key]
        obj[path[-1]] = value
    return edit


INPUT_TAMPERS = {
    "duplicate-key": lambda raw: raw.replace(b"{\n", b'{\n  "stage": "x",\n', 1),
    "nan-seed": _json_edit(lambda d: d["seeds"].__setitem__(0, float("nan"))),
    "bool-seeds": _json_edit(_set(("seeds",), [True, False, True])),
    "float-seeds": _json_edit(lambda d: d.__setitem__("seeds", [float(s) for s in d["seeds"]])),
    "preset-native-dims": _json_edit(_set(("generation_basis", "native_inference_dimensions"),
                                          {"width": 1448, "height": 2176})),
    "generated-claim": _json_edit(_set(("claims", "generated"), True)),
}


@pytest.mark.parametrize("case", sorted(INPUT_TAMPERS))
def test_tampered_preparation_input_rejected(root: Path, case: str) -> None:
    prep_rel = _prepare(root, "D", case)
    path = root / prep_rel
    tampered = INPUT_TAMPERS[case](path.read_bytes())
    assert tampered != path.read_bytes()
    path.write_bytes(tampered)
    out = Path("out") / f"native-{case}"
    with pytest.raises(native.NonpersonaNativeError):
        native.compile_nonpersona_native(root=root, preparation_path=prep_rel, out=out,
                                         ledger_dir=root / "ledger")
    assert not (root / out).exists()


def _manifest_edit(edit):
    def apply(raw: bytes) -> bytes:
        value = json.loads(raw)
        edit(value)
        return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    return apply


STORED_TAMPERS = {
    "run-argv": (native.RECORD_NAME, _json_edit(lambda r: r["run"]["argv"].append("--tampered"))),
    "run-cli": (native.RECORD_NAME,
                _json_edit(lambda r: r["run"].__setitem__("cli", r["run"]["cli"] + " --tampered"))),
    "claims-generated": (native.RECORD_NAME, _json_edit(_set(("claims", "generated"), True))),
    "unknown-field": (native.RECORD_NAME, _json_edit(_set(("unexpected",), "x"))),
    "manifest-seed": (native.MANIFEST_NAME,
                      _manifest_edit(lambda m: m["jobs"][0].__setitem__("seed", m["jobs"][0]["seed"] + 1))),
    "manifest-start": (native.MANIFEST_NAME,
                       _manifest_edit(_set(("comfyui", "start_command"), "python main.py --listen"))),
    "pending-copy": (native.PENDING_RECORD_NAME, _json_edit(_set(("unexpected",), "x"))),
}


@pytest.mark.parametrize("case", sorted(STORED_TAMPERS))
def test_stored_tamper_rejected_read_only(root: Path, case: str) -> None:
    out, _ = _compile(root, case)
    name, edit = STORED_TAMPERS[case]
    target = root / out / name
    original = target.read_bytes()
    target.write_bytes(edit(original))
    assert target.read_bytes() != original
    after_tamper = _snapshot(root / out)
    with pytest.raises(native.NonpersonaNativeError):
        native.revalidate_nonpersona_native(root=root, out=out)
    assert _snapshot(root / out) == after_tamper


def test_path_errors(root: Path, tmp_path: Path) -> None:
    prep_rel = _prepare(root, "D", "paths")
    bad = [
        (root / prep_rel, Path("out/native-a")),                    # absolute preparation
        ("out/../out/paths-prep.json", Path("out/native-b")),       # traversal preparation
        ("out\\paths-prep.json", Path("out/native-c")),             # non-posix string
        (prep_rel, tmp_path / "escape"),                            # absolute out
        (prep_rel, "out/../../escape"),                             # traversal out
        (prep_rel, Path("missing/native-d")),                       # missing parent
    ]
    for preparation, out in bad:
        with pytest.raises(native.NonpersonaNativeError):
            native.compile_nonpersona_native(root=root, preparation_path=preparation, out=out,
                                             ledger_dir=root / "ledger")
    assert not any(p.name.startswith("native-") for p in (root / "out").iterdir())
    assert not (tmp_path / "escape").exists()

    out = Path("out/native-existing")
    native.compile_nonpersona_native(root=root, preparation_path=prep_rel, out=out,
                                     ledger_dir=root / "ledger")
    existing = _snapshot(root / out)
    with pytest.raises(native.NonpersonaNativeError, match="fresh directory"):
        native.compile_nonpersona_native(root=root, preparation_path=prep_rel, out=out,
                                         ledger_dir=root / "ledger")
    assert _snapshot(root / out) == existing
    with pytest.raises(native.NonpersonaNativeError):
        native.revalidate_nonpersona_native(root=root, out=Path("out/native-absent"))


def test_model_pin_shape() -> None:
    train = native._train()
    models = json.loads(Path(train.PINS_PATH).read_bytes())["pins"]["tester"]["models"]
    names = {PurePosixPath(m["filename"]).name for m in models}
    assert native._check_models(copy.deepcopy(models), names) == models

    def broken(edit):
        value = copy.deepcopy(models)
        edit(value)
        return value

    cases = [
        broken(lambda m: m[0].__setitem__("sha256", "0" * 63)),
        broken(lambda m: m[0].__setitem__("sha256", "g" * 64)),
        broken(lambda m: m[0].__setitem__("revision", "abc123")),
        broken(lambda m: m[0].__setitem__("extra", "x")),
        broken(lambda m: m[0].pop("destination_dir")),
        broken(lambda m: m[0].__setitem__("repo_id", "")),
        broken(lambda m: m[0].__setitem__("filename", "renamed.safetensors")),
        broken(lambda m: m.pop()),
        "not-a-list",
    ]
    for case in cases:
        with pytest.raises(native.NonpersonaNativeError):
            native._check_models(case, names)


def test_stale_scene_rejected(root: Path) -> None:
    prep_rel = _prepare(root, "D", "stale")
    scene_path = root / "stale-scene.json"
    scene = json.loads(scene_path.read_text(encoding="utf-8"))
    scene["subject"] = "a different empty bench in a park"
    _write_json(scene_path, scene)
    with pytest.raises(native.NonpersonaNativeError):
        native.compile_nonpersona_native(root=root, preparation_path=prep_rel,
                                         out=Path("out/native-stale"), ledger_dir=root / "ledger")
    assert not (root / "out/native-stale").exists()


def test_resolved_training_trigger_in_subject_rejected(root: Path) -> None:
    # Prep accepts: its guard sees no inline trigger in the persona. Native must refuse.
    prep_rel = _prepare(root, "D", "trigger", subject=f"a {TRIGGER} branded ceramic mug on a shelf")
    with pytest.raises(native.NonpersonaNativeError, match="resolved persona trigger"):
        native.compile_nonpersona_native(root=root, preparation_path=prep_rel,
                                         out=Path("out/native-trigger"), ledger_dir=root / "ledger")
    assert not (root / "out/native-trigger").exists()


def _publication_failure(root: Path, monkeypatch: pytest.MonkeyPatch, tag: str, patch) -> Path:
    prep_rel = _prepare(root, "D", tag)
    out = Path("out") / f"native-{tag}"
    patch(root / out)
    with pytest.raises(native.NonpersonaNativeError, match=native.RECORD_NAME):
        native.compile_nonpersona_native(root=root, preparation_path=prep_rel, out=out,
                                         ledger_dir=root / "ledger")
    monkeypatch.undo()
    assert (root / out / native.MANIFEST_NAME).is_file()  # partial output retained
    return out


def test_record_fsync_failure_publishes_nothing(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    real_fsync = os.fsync

    def patch(out_dir: Path) -> None:
        def fsync(fd: int) -> None:
            if (out_dir / native.PENDING_RECORD_NAME).exists():  # only the record fsync
                raise OSError("injected record fsync failure")
            real_fsync(fd)
        monkeypatch.setattr(native.prep.os, "fsync", fsync)

    out = _publication_failure(root, monkeypatch, "fsync", patch)
    assert not (root / out / native.RECORD_NAME).exists()
    with pytest.raises(native.NonpersonaNativeError):
        native.revalidate_nonpersona_native(root=root, out=out)


def test_unsupported_hardlink_publishes_nothing(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def link(src, dst) -> None:
        raise OSError("injected: hardlinks unsupported")

    out = _publication_failure(root, monkeypatch, "nolink",
                               lambda _: monkeypatch.setattr(native.os, "link", link))
    assert not (root / out / native.RECORD_NAME).exists()
    with pytest.raises(native.NonpersonaNativeError):
        native.revalidate_nonpersona_native(root=root, out=out)


def test_existing_final_record_is_never_overwritten(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    sentinel = b'{"sentinel": true}\n'
    real_link = os.link

    def link(src, dst) -> None:
        Path(dst).write_bytes(sentinel)  # inserted just before the commit point
        real_link(src, dst)

    out = _publication_failure(root, monkeypatch, "raced",
                               lambda _: monkeypatch.setattr(native.os, "link", link))
    assert (root / out / native.RECORD_NAME).read_bytes() == sentinel
    with pytest.raises(native.NonpersonaNativeError):
        native.revalidate_nonpersona_native(root=root, out=out)
