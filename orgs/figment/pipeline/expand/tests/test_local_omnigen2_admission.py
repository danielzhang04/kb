import builtins
import hashlib
import importlib
import io
import json
import os
import subprocess
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[5]))

from orgs.figment.pipeline.expand import local_omnigen2_admission as adm  # noqa: E402

EXPAND = Path(adm.__file__).resolve().parent
REAL_STUDIO = Path(__file__).resolve().parents[5]
REAL_TEMPLATE = Path("C:/Users/danie/kb/_private/figment-omnigen2-template-20260908-v1/workflow.json")
PIL = pytest.importorskip("PIL.Image")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _jpeg(width: int, height: int) -> bytes:
    buf = io.BytesIO()
    PIL.new("RGB", (width, height), (120, 90, 70)).save(buf, format="JPEG", quality=30)
    return buf.getvalue()


class Studio:
    def __init__(self, tmp: Path):
        self.main_private = tmp / "_private"
        self.studio = self.main_private / "codex-worktrees" / "figment-studio-20260908"
        self.expand = self.studio / "orgs/figment/pipeline/expand"
        self.models = self.main_private / "figment-local-omnigen2-models-20260908-v1"
        self.template = self.main_private / "figment-omnigen2-template-20260908-v1" / "workflow.json"
        self.reference = self.studio / "orgs/figment/personas/creator-001/anchors/g01.jpg"
        self.admission = self.studio / "_private" / "figment-local-omnigen2-reference-admission-20260908-v1" / "admission.json"
        self.pins: dict = {}

    def write(self, path: Path, data: bytes) -> str:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return _sha(data)


@pytest.fixture
def studio(tmp_path, monkeypatch):
    s = Studio(tmp_path)
    code = {}
    for name in ("local_omnigen2_inference.py", "local_omnigen2_prepare.py"):
        code[f"orgs/figment/pipeline/expand/{name}"] = s.write(s.expand / name, (EXPAND / name).read_bytes())
    code["orgs/figment/pipeline/expand/local_comfy_input.py"] = s.write(s.expand / "local_comfy_input.py", b"# comfy input\n")
    for rel in adm.DYNAMIC_CODE:
        s.write(s.studio / rel, f"# {rel}\n".encode())
    # Real docs and real template bytes: the copied planner keeps its production
    # TEMPLATE_SNAPSHOT / FEASIBILITY_SHA256 cross-checks, which must hold here too.
    docs = {}
    for rel in adm.FIXED_DOCS:
        real_doc = REAL_STUDIO / rel
        if not real_doc.is_file():
            pytest.skip(f"real doc missing: {real_doc}")
        docs[rel] = s.write(s.studio / rel, real_doc.read_bytes())
    if not REAL_TEMPLATE.is_file():
        pytest.skip(f"real template missing: {REAL_TEMPLATE}")
    template = REAL_TEMPLATE.read_bytes()
    s.write(s.template, template)
    receipt = b'{"schema": "prep", "ok": true}'
    s.write(s.models / "preparation.json", receipt)
    ref = _jpeg(1408, 768)
    ref_sha = s.write(s.reference, ref)
    real_planner = importlib.import_module("orgs.figment.pipeline.expand.local_omnigen2_inference")
    model_pins = {}
    for key, spec in real_planner.MODELS.items():
        blob = f"weight-{key}".encode() * 100
        sha = s.write(s.models / spec["directory"] / spec["file"], blob)
        model_pins[key] = {**spec, "bytes": len(blob), "sha256": sha}
    s.pins = {
        "code": code,
        "docs": docs,
        "template": {"bytes": len(template), "sha256": _sha(template)},
        "preparation_receipt_sha256": _sha(receipt),
        "reference_bytes": len(ref),
        "comfy_commit": real_planner.COMFY_COMMIT,
        "comfy_critical_files": 7,
        "comfy_untracked_inventory": ("gen_history.json", "gen_start_ts.txt", "server.pid", "torch_install.pid"),
    }
    s.reference_pin = {"filename": "g01.jpg", "sha256": ref_sha, "width": 1408, "height": 768}
    s.model_pins = model_pins
    s.comfy = {
        "root": "C:/fixture/ComfyUI",
        "commit": real_planner.COMFY_COMMIT,
        "tracked_clean": True,
        "untracked_inventory": list(s.pins["comfy_untracked_inventory"]),
        "critical_files": [{"path": f"f{i}.py", "bytes": 1, "sha256": "0" * 64} for i in range(7)],
    }
    for name, value in {
        "STUDIO": s.studio,
        "EXPECTED_STUDIO": s.studio,
        "MAIN_PRIVATE": s.main_private,
        "STUDIO_PRIVATE": s.studio / "_private",
        "RUN_ROOT": s.main_private / "figment-local-omnigen2-reference-20260908-v1",
        "ADMISSION_PATH": s.admission,
        "MODELS_ROOT": s.models,
        "TEMPLATE_PATH": s.template,
        "REFERENCE_PATH": s.reference,
        "PINS": s.pins,
    }.items():
        monkeypatch.setattr(adm, name, value)
    monkeypatch.setattr(adm, "_inspect_comfy", lambda prep: json.loads(json.dumps(s.comfy)))
    monkeypatch.setattr(adm, "_model_pins", lambda planner: {k: dict(v) for k, v in s.model_pins.items()})
    monkeypatch.setattr(adm, "_reference_pin", lambda planner: dict(s.reference_pin))
    s.monkeypatch = monkeypatch
    return s


def _write_admission(s: Studio, record) -> None:
    s.write(s.admission, adm.canonical(record))


def _symlink_or_skip(target: Path, link: Path, directory: bool) -> None:
    try:
        os.symlink(target, link, target_is_directory=directory)
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"symlinks unavailable: {exc}")


# ---------------------------------------------------------------- import-time
def test_import_performs_no_file_reads_or_processes(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("I/O at import")

    monkeypatch.setattr(builtins, "open", boom)
    monkeypatch.setattr(io, "open", boom)
    monkeypatch.setattr(os, "scandir", boom)
    monkeypatch.setattr(subprocess, "Popen", boom)
    name = adm.__name__
    saved = sys.modules.pop(name)
    try:
        fresh = importlib.import_module(name)
        assert fresh.STUDIO == adm.STUDIO
        assert not any(k.startswith(adm._PINNED_PREFIX) for k in sys.modules)
    finally:
        sys.modules[name] = saved


def test_fixed_layout_constants():
    # Worktree-independent: STUDIO is derived from the repo root (matching this
    # test file's own independent parents[5] computation), not pinned to any one
    # checkout's literal directory name.
    assert adm.STUDIO == REAL_STUDIO
    assert adm.EXPECTED_STUDIO == adm.STUDIO
    assert adm.MAIN_PRIVATE == adm.STUDIO.parents[1]
    assert adm.STUDIO_PRIVATE == adm.STUDIO / "_private"
    assert adm.ADMISSION_PATH == adm.STUDIO / "_private" / "figment-local-omnigen2-reference-admission-20260908-v1" / "admission.json"
    assert adm.REFERENCE_PATH == adm.STUDIO / "orgs/figment/personas/creator-001/anchors/g01.jpg"


# ---------------------------------------------------------------- primitives
def test_canonical_is_sorted_compact_non_ascii_and_finite_only():
    assert adm.canonical({"b": 1, "a": ["é", True, None]}) == '{"a":["é",true,null],"b":1}'.encode("utf-8")
    assert adm.canonical(types.MappingProxyType({"z": (1, 2)})) == b'{"z":[1,2]}'
    with pytest.raises(ValueError):
        adm.canonical({"x": float("nan")})
    with pytest.raises(TypeError):
        adm.canonical({"x": Path("a")})


def test_hash_file_bounds_and_types(tmp_path):
    f = tmp_path / "f.bin"
    f.write_bytes(b"abc")
    assert adm.hash_file(f, 3) == (_sha(b"abc"), 3)
    with pytest.raises(adm.AdmissionError):
        adm.hash_file(f, 2)
    empty = tmp_path / "e.bin"
    empty.write_bytes(b"")
    with pytest.raises(adm.AdmissionError):
        adm.hash_file(empty, 10)
    assert adm.hash_file(empty, 10, allow_empty=True) == (_sha(b""), 0)
    with pytest.raises(adm.AdmissionError):
        adm.hash_file(tmp_path, 10)
    with pytest.raises(adm.AdmissionError):
        adm.hash_file(tmp_path / "missing", 10)
    with pytest.raises(adm.AdmissionError):
        adm.hash_file(f, 0)


def test_hash_file_rejects_symlink_leaf_and_ancestor(tmp_path):
    real = tmp_path / "real"
    real.mkdir()
    (real / "f.bin").write_bytes(b"data")
    link = tmp_path / "link"
    _symlink_or_skip(real, link, directory=True)
    assert adm.reparse(link) and not adm.reparse(real)
    with pytest.raises(adm.AdmissionError, match="reparse"):
        adm.hash_file(link / "f.bin", 10)
    file_link = tmp_path / "f-link"
    _symlink_or_skip(real / "f.bin", file_link, directory=False)
    with pytest.raises(adm.AdmissionError, match="reparse"):
        adm.hash_file(file_link, 10)
    with pytest.raises(adm.AdmissionError, match="reparse"):
        adm.safe(link / "f.bin", tmp_path, "x")


def test_safe_requires_absolute_containment(tmp_path):
    root = tmp_path / "root"
    assert adm.safe(root / "a" / "b", root, "x") == root / "a" / "b"
    assert adm.safe(root, root, "x") == root
    for bad in (root.parent / "other", root / ".." / "x", Path("relative/x")):
        with pytest.raises(adm.AdmissionError):
            adm.safe(bad, root, "x")
    with pytest.raises(adm.AdmissionError):
        adm.safe(root / "a", Path("rel"), "x")


# ---------------------------------------------------------------- evidence
def test_build_evidence_and_admission_roundtrip(studio):
    evidence = adm.build_evidence()
    assert evidence["schema"] == adm.EVIDENCE_SCHEMA
    assert isinstance(evidence, types.MappingProxyType)
    assert evidence["manifest"]["schema"] == "figment/local-omnigen2-inference-plan@1"
    assert set(evidence["code"]) == set(adm.FIXED_CODE) | set(adm.DYNAMIC_CODE)
    assert set(evidence["docs"]) == set(adm.FIXED_DOCS)
    assert evidence["reference"]["width"] == 1408 and evidence["reference"]["height"] == 768
    assert evidence["models"]["vae"]["sha256"] == studio.model_pins["vae"]["sha256"]
    assert evidence["comfyui"]["untracked_inventory"] == studio.pins["comfy_untracked_inventory"]
    assert evidence["bounds"]["total_minutes"] == 100 and evidence["bounds"]["max_samples"] == 6100
    assert evidence["cooperative_deadlines"] is True
    assert evidence["automatic_promotion"] is False and evidence["commercial_use_cleared"] is False
    assert "timestamp" not in evidence
    with pytest.raises(TypeError):
        evidence["bounds"]["total_minutes"] = 1  # type: ignore[index]

    record = adm.make_admission(evidence)
    assert record["schema"] == adm.ADMISSION_SCHEMA and record["id"] == adm.ADMISSION_ID
    assert record["admitted_by"] == "codex-worker" and record["not_promotable"] is True
    body = {k: v for k, v in record.items() if k != "admission_sha256"}
    assert record["admission_sha256"] == _sha(adm.canonical(body))
    assert not studio.admission.exists()

    _write_admission(studio, record)
    result = adm.validate_admission()
    assert result["admission_id"] == adm.ADMISSION_ID
    assert result["admission_sha256"] == record["admission_sha256"]
    assert result["admission_file_sha256"] == _sha(studio.admission.read_bytes())
    assert adm.canonical(result["evidence"]) == adm.canonical(evidence)
    assert adm.canonical(adm.build_evidence()) == adm.canonical(evidence)


def test_validate_admission_calls_compare_with_fresh_evidence(studio):
    _write_admission(studio, adm.make_admission(adm.build_evidence()))
    calls = []
    real = adm.compare_admission
    studio.monkeypatch.setattr(adm, "compare_admission", lambda o, e: (calls.append((o, e)), real(o, e)))
    adm.validate_admission()
    assert len(calls) == 1
    assert calls[0][1]["evidence"]["schema"] == adm.EVIDENCE_SCHEMA


def test_missing_admission_file_fails(studio):
    with pytest.raises(adm.AdmissionError, match="missing"):
        adm.validate_admission()


def test_admission_file_outside_studio_private_fails(studio):
    studio.monkeypatch.setattr(adm, "ADMISSION_PATH", studio.main_private / "admission.json")
    studio.write(studio.main_private / "admission.json", b"{}")
    with pytest.raises(adm.AdmissionError, match="outside"):
        adm.validate_admission()


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r.__setitem__("purpose", "something else"),
        lambda r: r.__setitem__("not_promotable", 1),
        lambda r: r.__setitem__("extra", None),
        lambda r: r["evidence"]["bounds"].__setitem__("total_minutes", 100.0),
        lambda r: r["evidence"].__setitem__("cooperative_deadlines", "true"),
        lambda r: r["evidence"]["comfyui"].__setitem__("tracked_clean", 1),
        lambda r: r["evidence"]["models"]["vae"].__setitem__("sha256", "f" * 64),
        lambda r: r["evidence"].__setitem__("automatic_promotion", True),
        lambda r: r["evidence"]["code"].pop("orgs/figment/pipeline/expand/local_omnigen2_runtime.py"),
        lambda r: r.__setitem__("admitted_by", "root"),
    ],
)
def test_tampered_admission_rejected_even_with_recomputed_hash(studio, mutate):
    record = json.loads(adm.canonical(adm.make_admission(adm.build_evidence())))
    mutate(record)
    body = {k: v for k, v in record.items() if k != "admission_sha256"}
    record["admission_sha256"] = _sha(adm.canonical(body))
    _write_admission(studio, record)
    with pytest.raises(adm.AdmissionError, match="does not match"):
        adm.validate_admission()


def test_admission_subset_and_bad_json_rejected(studio):
    record = json.loads(adm.canonical(adm.make_admission(adm.build_evidence())))
    subset = {k: v for k, v in record.items() if k in {"schema", "id", "admission_sha256"}}
    _write_admission(studio, subset)
    with pytest.raises(adm.AdmissionError, match="does not match"):
        adm.validate_admission()
    studio.write(studio.admission, b'{"schema": 1, "schema": 2}')
    with pytest.raises(adm.AdmissionError, match="duplicate"):
        adm.validate_admission()
    studio.write(studio.admission, b"[]")
    with pytest.raises(adm.AdmissionError, match="JSON object"):
        adm.validate_admission()


def test_make_admission_rejects_foreign_evidence():
    with pytest.raises(adm.AdmissionError):
        adm.make_admission({"schema": "other"})
    with pytest.raises(adm.AdmissionError):
        adm.make_admission({"schema": adm.EVIDENCE_SCHEMA, "x": Path("p")})


def test_wrong_studio_path_fails(studio):
    studio.monkeypatch.setattr(adm, "EXPECTED_STUDIO", Path("C:/Users/danie/kb"))
    with pytest.raises(adm.AdmissionError, match="expected path"):
        adm.build_evidence()


def test_missing_future_runtime_fails(studio):
    (studio.expand / "local_omnigen2_runtime.py").unlink()
    with pytest.raises(adm.AdmissionError, match="missing"):
        adm.build_evidence()


def test_pinned_source_and_doc_hash_mismatch_fails(studio):
    planner = studio.expand / "local_omnigen2_inference.py"
    planner.write_bytes(planner.read_bytes() + b"\n# tampered\n")
    with pytest.raises(adm.AdmissionError, match="pinned code hash"):
        adm.build_evidence()
    planner.write_bytes(planner.read_bytes()[: -len(b"\n# tampered\n")])
    adm.build_evidence()
    (studio.studio / adm.RUNTIME_DESIGN_REL).write_bytes(b"# changed\n")
    with pytest.raises(adm.AdmissionError, match="pinned doc hash"):
        adm.build_evidence()


def test_same_size_dynamic_source_mutation_invalidates_admission(studio):
    _write_admission(studio, adm.make_admission(adm.build_evidence()))
    target = studio.expand / "local_omnigen2_resources.py"
    original = target.read_bytes()
    target.write_bytes(b"#" + original[1:].replace(b"r", b"R", 1))
    assert target.stat().st_size == len(original)
    with pytest.raises(adm.AdmissionError, match="does not match"):
        adm.validate_admission()


def test_source_changed_during_model_hashing_fails(studio):
    real = adm._inspect_models

    def slow(pins):
        result = real(pins)
        (studio.studio / adm.DYNAMIC_CODE[3]).write_bytes(b"# engine swapped mid-read\n")
        return result

    studio.monkeypatch.setattr(adm, "_inspect_models", slow)
    with pytest.raises(adm.AdmissionError, match="changed while evidence"):
        adm.build_evidence()


def test_model_wrong_hash_and_wrong_size(studio):
    path = studio.models / "vae" / studio.model_pins["vae"]["file"]
    original = path.read_bytes()
    path.write_bytes(b"X" + original[1:])
    with pytest.raises(adm.AdmissionError, match="does not match pin"):
        adm.build_evidence()
    path.write_bytes(original + b"!")
    with pytest.raises(adm.AdmissionError, match="exceeds bound"):
        adm.build_evidence()


def test_model_inventory_must_be_closed(studio):
    (studio.models / "notes.txt").write_bytes(b"x")
    with pytest.raises(adm.AdmissionError, match="more than 4|not closed"):
        adm.build_evidence()
    (studio.models / "notes.txt").unlink()
    (studio.models / "vae" / "extra.safetensors").write_bytes(b"x")
    with pytest.raises(adm.AdmissionError, match="more than 1|not closed"):
        adm.build_evidence()
    (studio.models / "vae" / "extra.safetensors").unlink()
    (studio.models / "text_encoders").rename(studio.models / "text_encoder")
    with pytest.raises(adm.AdmissionError, match="not closed"):
        adm.build_evidence()


def test_models_root_symlink_fails(studio):
    real = studio.models.rename(studio.main_private / "models-real")
    _symlink_or_skip(real, studio.models, directory=True)
    with pytest.raises(adm.AdmissionError, match="reparse"):
        adm.build_evidence()


def test_model_dir_symlink_entry_fails(studio):
    spec = studio.model_pins["vae"]
    real = (studio.models / "vae" / spec["file"]).rename(studio.main_private / "vae-real.bin")
    _symlink_or_skip(real, studio.models / "vae" / spec["file"], directory=False)
    with pytest.raises(adm.AdmissionError, match="reparse"):
        adm.build_evidence()


def test_bad_preparation_receipt(studio):
    receipt = studio.models / "preparation.json"
    for raw in (b'{"a": 1, "a": 2}', b'{"a": NaN}', b"[1]", b"{", b"\xff\xfe"):
        receipt.write_bytes(raw)
        studio.pins["preparation_receipt_sha256"] = _sha(raw)
        with pytest.raises(adm.AdmissionError, match="preparation receipt"):
            adm.build_evidence()
    receipt.write_bytes(b'{"ok": true}')
    with pytest.raises(adm.AdmissionError, match="receipt hash mismatch"):
        adm.build_evidence()


def test_reference_wrong_dimension_or_hash(studio):
    wrong = _jpeg(768, 768)
    studio.write(studio.reference, wrong)
    studio.pins["reference_bytes"] = len(wrong)
    with pytest.raises(adm.AdmissionError, match="planner pin"):
        adm.build_evidence()
    studio.reference_pin["sha256"] = _sha(wrong)
    with pytest.raises(adm.AdmissionError, match="dimensions"):
        adm.build_evidence()


def test_template_pin_enforced(studio):
    studio.write(studio.template, b'{"template": "other!"}')
    with pytest.raises(adm.AdmissionError, match="template"):
        adm.build_evidence()


def test_comfy_evidence_shape_enforced(studio):
    pristine = json.loads(json.dumps(studio.comfy))
    for patch, message in (
        ({"commit": "0" * 40}, "frozen clean commit"),
        ({"tracked_clean": 1}, "frozen clean commit"),
        ({"critical_files": pristine["critical_files"][:6]}, "critical file evidence"),
        ({"untracked_inventory": [1]}, "untracked inventory"),
        ({"untracked_inventory": [*pristine["untracked_inventory"], "unexpected.py"]}, "reviewed snapshot"),
        ({"untracked_inventory": pristine["untracked_inventory"][:-1]}, "reviewed snapshot"),
        ({"extra": True}, "unexpected shape"),
    ):
        studio.comfy = {**json.loads(json.dumps(pristine)), **patch}
        with pytest.raises(adm.AdmissionError, match=message):
            adm.build_evidence()
    studio.comfy = pristine
    adm.build_evidence()


def test_comfy_mutated_between_reads_fails(studio):
    pristine = json.loads(json.dumps(studio.comfy))
    calls = []

    def inspect(prep):
        calls.append(1)
        snapshot = json.loads(json.dumps(pristine))
        if len(calls) >= 2:
            snapshot["untracked_inventory"] = [*snapshot["untracked_inventory"], "custom_nodes/injected.py"]
        return snapshot

    studio.monkeypatch.setattr(adm, "_inspect_comfy", inspect)
    with pytest.raises(adm.AdmissionError, match="ComfyUI changed while evidence"):
        adm.build_evidence()
    assert len(calls) == 2


def test_strict_loads_rejects_non_finite_and_huge_numbers():
    with pytest.raises(adm.AdmissionError, match="non-finite number 1e999"):
        adm._strict_loads(b'{"x": 1e999}', "t")
    with pytest.raises(adm.AdmissionError, match="non-finite number -1e999"):
        adm._strict_loads(b'[-1e999]', "t")
    with pytest.raises(adm.AdmissionError, match="non-finite number Infinity"):
        adm._strict_loads(b'{"x": Infinity}', "t")
    with pytest.raises(adm.AdmissionError, match="non-finite|integer too large|invalid JSON"):
        adm._strict_loads(b"1" + b"0" * 5000, "t")
    assert adm._strict_loads(b'{"x": 1.5, "y": 2}', "t") == {"x": 1.5, "y": 2}


def test_hash_file_streams_large_file_without_retaining_bytes(tmp_path):
    import tracemalloc

    block = bytes(range(256)) * 1024  # 256 KiB
    total = 32 * 1024 * 1024
    path = tmp_path / "big.safetensors"
    expected = hashlib.sha256()
    with open(path, "wb") as handle:
        for _ in range(total // len(block)):
            handle.write(block)
            expected.update(block)
    assert path.stat().st_size == total
    tracemalloc.start()
    try:
        tracemalloc.reset_peak()
        sha, size = adm.hash_file(path, total)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert (sha, size) == (expected.hexdigest(), total)
    assert peak < 4 * 1024 * 1024, peak


def test_hash_file_never_calls_byte_retaining_reader(tmp_path, monkeypatch):
    path = tmp_path / "w.bin"
    path.write_bytes(b"weights" * 1000)

    def boom(*a, **k):
        raise AssertionError("hash_file must not retain bytes via _read_bounded")

    monkeypatch.setattr(adm, "_read_bounded", boom)
    assert adm.hash_file(path, 7000) == (_sha(b"weights" * 1000), 7000)


def test_stream_detects_same_size_replacement_during_read(tmp_path, monkeypatch):
    path = tmp_path / "w.bin"
    path.write_bytes(b"A" * 4096)
    real_identity = adm._identity
    seen = []

    def identity(info):
        size, mtime_ns, ino, dev = real_identity(info)
        seen.append(1)
        # third identity check is the post-read fstat: same size, new inode = replaced file
        return (size, mtime_ns, ino + 1 if len(seen) == 3 else ino, dev)

    monkeypatch.setattr(adm, "_identity", identity)
    with pytest.raises(adm.AdmissionError, match="file changed during read"):
        adm.hash_file(path, 4096)
    assert len(seen) == 3


def test_pinned_modules_are_fresh_objects_not_cached_imports(studio):
    adm.build_evidence()
    planner = sys.modules[f"{adm._PINNED_PREFIX}.local_omnigen2_inference"]
    assert planner.__file__ == str(studio.expand / "local_omnigen2_inference.py")
    assert planner is not sys.modules["orgs.figment.pipeline.expand.local_omnigen2_inference"]
