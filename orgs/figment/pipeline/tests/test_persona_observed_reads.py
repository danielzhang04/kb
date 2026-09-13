"""B1 contracts using synthetic persona/spec/reference bytes only."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from types import SimpleNamespace

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
MISSING = object()


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


persona = load("b1_persona_under_test", PIPELINE / "persona.py")
observed = load("b1_observed_policy", PIPELINE / "observed_reads.py")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def make_fixture(tmp_path, *, inline=MISSING, sidecar=MISSING, references=3):
    root = tmp_path / "repo" / "orgs" / "figment"
    home = root / "personas" / "creator-001"
    (home / "anchors").mkdir(parents=True)
    (root / "pipeline").mkdir()
    refs = [home / "anchors" / f"g{i:02d}.bin" for i in range(references)]
    for index, path in enumerate(refs):
        path.write_bytes(f"synthetic reference {index}".encode())
    identity = home / "identity-spec.md"
    register = root / "pipeline" / "look-spec-v2.md"
    identity.write_bytes(b"Synthetic identity specification\n")
    register.write_bytes(b"Synthetic register specification\n")
    floor = {"status": "uncalibrated", "value": None, "calibration_set_sha": None, "locked_by_gate": None}
    data = {
        "id": "creator-001", "disclosure": {"is_ai_generated": True},
        "identity": {"references": [f"anchors/{p.name}" for p in refs],
                     "history": ["not-followed/historical.bin"],
                     "spec": {"path": "identity-spec.md", "sha256": sha(identity.read_bytes())},
                     "floor": {"anchor_cosine_p5": dict(floor), "min_face_px": dict(floor)},
                     "look": {"age_stage": "adult", "hair": "brown", "eyes": "brown", "skin": "natural",
                              "brows": "natural", "makeup": "none", "build": "average", "clothing": "cotton shirt"}},
        "body_target": {"source": "synthetic", "exemplars": []},
        "grammar": {"angles": ["front"], "distances": ["half"], "lights": ["flat-white"],
                    "wardrobe_families": ["cotton"], "traversal_order": ["angle", "distance", "light"],
                    "allocation": {"strata": 1, "replicates": 1, "replicate_scope": "half-body-strata-only",
                                   "replicate_policy": "alt-wardrobe-new-seed", "seed_policy": "fixed-per-cell"}},
        "register": {"spec": {"path": "../../pipeline/look-spec-v2.md", "sha256": sha(register.read_bytes()), "section": "synthetic"},
                     "settings": {"makeup": "none", "skin": "natural", "light": ["flat-white"], "wardrobe_families": ["cotton"]}},
        "lora": {"base": "krea2", "tier": "synthetic"}, "voice": {}, "accounts": [],
        "tiers": {"instagram": {}, "explicit": {}},
    }
    if inline is not MISSING:
        data["training"] = deepcopy(inline)
    path = home / "persona.yaml"
    path.write_text(json.dumps(data), encoding="utf-8")
    training = home / "training.yaml"
    if sidecar is not MISSING:
        training.write_text(json.dumps({"training": sidecar}), encoding="utf-8")
    return SimpleNamespace(root=root, home=home, path=path, sidecar=training, refs=refs,
                           identity=identity, register=register, data=data,
                           members=[path, training, *refs, identity, register])


def reader_for(fixture, *, optional_assets=False, limits=None, extra=()):
    assets = {*fixture.refs, fixture.identity, fixture.register}
    return observed.ObservedReads(
        roots=(fixture.root,),
        members=tuple(observed.ReadMember(path, 256 * 1024,
                                         allow_json=path in (fixture.path, fixture.sidecar),
                                         optional=path == fixture.sidecar or (optional_assets and path in assets))
                      for path in [*fixture.members, *extra]),
        directories=(fixture.home,),
        limits=limits or observed.ReadLimits(max_files=68, max_unique_bytes=128 * 1024**2, max_stream_bytes=256 * 1024**2),
    )


def base_data(fixture):
    value = deepcopy(fixture.data)
    value.pop("training", None)
    return value


@pytest.mark.parametrize("separator", ["/", "\\"])
def test_canonical_register_identity_spec_and_reference_parity(tmp_path, separator):
    fixture = make_fixture(tmp_path)
    data = base_data(fixture)
    data["register"]["spec"]["path"] = separator.join(["..", "..", "pipeline", "look-spec-v2.md"])
    original = deepcopy(data)
    persona.validate_persona(data, base_dir=fixture.home)
    reader = reader_for(fixture)
    persona.validate_persona(data, base_dir=fixture.home, reads=reader)
    assert persona._resolve_reference(fixture.home, data["register"]["spec"]["path"], "register.spec.path", must_stay_within=False, reads=reader) == fixture.register
    assert reader.sha256(fixture.register) == data["register"]["spec"]["sha256"]
    assert reader.sha256(fixture.identity) == data["identity"]["spec"]["sha256"]
    assert data == original
    reader.recheck()


@pytest.mark.parametrize("mutation", ["unknown", "duplicate", "allocation", "token", "identity-hash", "register-hash"])
def test_default_and_observed_domain_failures_match(tmp_path, mutation):
    fixture = make_fixture(tmp_path)
    data = base_data(fixture)
    if mutation == "unknown": data["unexpected"] = True
    elif mutation == "duplicate": data["identity"]["references"].append(data["identity"]["references"][0])
    elif mutation == "allocation": data["grammar"]["allocation"]["strata"] = 2
    elif mutation == "token": data["grammar"]["angles"] = ["unsupported"]
    else: data["identity" if mutation == "identity-hash" else "register"]["spec"]["sha256"] = "0" * 64
    with pytest.raises(persona.PersonaError) as ordinary:
        persona.validate_persona(data, base_dir=fixture.home)
    with pytest.raises(persona.PersonaError) as supplied:
        persona.validate_persona(data, base_dir=fixture.home, reads=reader_for(fixture))
    assert str(supplied.value) == str(ordinary.value)


@pytest.mark.parametrize("spec", ["identity", "register"])
def test_each_current_spec_digest_is_checked_independently(tmp_path, spec):
    fixture = make_fixture(tmp_path)
    getattr(fixture, spec).write_bytes(b"changed synthetic spec")
    with pytest.raises(persona.PersonaError, match="does not match the live file digest"):
        persona.validate_persona(base_data(fixture), base_dir=fixture.home, reads=reader_for(fixture))


def test_schema_only_keeps_structure_and_confinement_without_asset_claim(tmp_path):
    fixture = make_fixture(tmp_path)
    data = base_data(fixture)
    for path in [*fixture.refs, fixture.identity, fixture.register]: path.unlink()
    data["identity"]["spec"]["sha256"] = "deliberately not a digest"
    persona.validate_persona(data, base_dir=fixture.home, require_assets=False)
    reader = reader_for(fixture, optional_assets=True)
    persona.validate_persona(data, base_dir=fixture.home, require_assets=False, reads=reader)
    reader.recheck()
    data["identity"]["references"] = ["../../pipeline/look-spec-v2.md"]
    for reads in (None, reader_for(fixture, optional_assets=True)):
        with pytest.raises(ValueError):
            persona.validate_persona(data, base_dir=fixture.home, require_assets=False, reads=reads)


@pytest.mark.parametrize("field", ["reference", "identity-spec"])
def test_identity_cannot_escape_even_to_an_independently_admitted_spec(tmp_path, field):
    fixture = make_fixture(tmp_path)
    data = base_data(fixture)
    if field == "reference": data["identity"]["references"] = ["../../pipeline/look-spec-v2.md"]
    else: data["identity"]["spec"] = dict(data["register"]["spec"])
    with pytest.raises(ValueError):
        persona.validate_persona(data, base_dir=fixture.home, reads=reader_for(fixture))


@pytest.mark.parametrize("raw", [
    "x/../identity-spec.md", "../x/../identity-spec.md", "../../../outside", "..", ".", "./identity-spec.md",
    "anchors//g00.bin", "anchors/", "C:x", "C:/x", "\\x", "//server/share/x", "\\\\?\\C:\\x",
    "anchors/g00.bin:stream", "NUL", "con.txt", "COM1", "trailing.", "trailing ", "wild*card", "x?", "x\x00y",
    "x" * 4097, "/".join(["x"] * 65), "../\\server/share/file",
])
def test_unsupported_raw_reference_refuses_before_any_reader_operation(tmp_path, raw):
    fixture = make_fixture(tmp_path)
    class NoIO:
        def resolve(self, path): pytest.fail("unsupported spelling reached reader")
    with pytest.raises(ValueError):
        persona._resolve_reference(fixture.home, raw, "test", must_stay_within=False, reads=NoIO())


@pytest.mark.parametrize("raw", ["x" * 4096, "/".join(["x"] * 64)])
def test_raw_reference_boundary_reaches_policy_without_claiming_filesystem_support(tmp_path, raw):
    class ReachedPolicy(Exception): pass
    class StopAtPolicy:
        def resolve(self, path): raise ReachedPolicy()
    with pytest.raises(ReachedPolicy):
        persona._resolve_reference(tmp_path, raw, "test", must_stay_within=False, reads=StopAtPolicy())


@pytest.mark.parametrize("kind", ["missing", "directory", "reparse"])
def test_current_reference_must_be_a_safe_file(tmp_path, monkeypatch, kind):
    fixture = make_fixture(tmp_path)
    target = fixture.refs[0]
    if kind in ("missing", "directory"):
        target.unlink()
        if kind == "directory": target.mkdir()
    reader = reader_for(fixture)
    if kind == "reparse":
        original = os.lstat
        def changed(path, *args, **kwargs):
            info = original(path, *args, **kwargs)
            if Path(path) != target: return info
            values = {name: getattr(info, name) for name in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_birthtime_ns", "st_mode", "st_file_attributes")}
            values["st_file_attributes"] |= stat.FILE_ATTRIBUTE_REPARSE_POINT
            return SimpleNamespace(**values)
        monkeypatch.setattr(os, "lstat", changed)
    with pytest.raises(observed.ObservedReadError):
        persona.validate_persona(base_data(fixture), base_dir=fixture.home, reads=reader)


def test_root_escape_and_unlisted_target_do_not_reach_target_io(tmp_path, monkeypatch):
    fixture = make_fixture(tmp_path)
    reader = observed.ObservedReads(roots=(fixture.home,), members=(observed.ReadMember(fixture.identity, 1024),))
    def forbidden(*args, **kwargs): pytest.fail("outside-root parent reached filesystem")
    with monkeypatch.context() as patch:
        patch.setattr(os, "lstat", forbidden)
        with pytest.raises(ValueError):
            persona._resolve_reference(fixture.home, "../../pipeline/look-spec-v2.md", "register", must_stay_within=False, reads=reader)
    unknown = fixture.home / "unlisted.md"
    unknown.write_bytes(b"must not read")
    reader = reader_for(fixture)
    original = os.lstat
    def guard(path, *args, **kwargs):
        assert Path(path) != unknown, "unlisted target reached filesystem"
        return original(path, *args, **kwargs)
    monkeypatch.setattr(os, "lstat", guard)
    with pytest.raises(ValueError):
        persona._resolve_reference(fixture.home, unknown.name, "reference", must_stay_within=True, reads=reader)


@pytest.mark.parametrize("field", ["references", "history"])
def test_observed_identity_lists_at_64_and_one_over(tmp_path, field):
    fixture = make_fixture(tmp_path, references=64 if field == "references" else 3)
    data = base_data(fixture)
    if field == "history": data["identity"][field] = [f"old/{i}" for i in range(64)]
    reader = reader_for(fixture)
    persona.validate_persona(data, base_dir=fixture.home, reads=reader)
    reader.recheck()
    data["identity"][field].append("extra/unread.bin")
    class NoIO:
        def resolve(self, path): pytest.fail("oversized list reached reader")
    with pytest.raises(ValueError):
        persona.validate_persona(data, base_dir=fixture.home, reads=NoIO())


def test_actual_caller_topology_refuses_a_file_as_persona_parent(tmp_path):
    fixture = make_fixture(tmp_path)
    fake_parent = fixture.home / "not-directory"
    fake_parent.write_bytes(b"file")
    with pytest.raises(observed.ObservedReadError):
        observed.ObservedReads(roots=(fixture.root,), members=(observed.ReadMember(fake_parent / "persona.yaml", 1024),))


def test_junction_base_cannot_be_hidden_by_parent_navigation(tmp_path):
    fixture = make_fixture(tmp_path)
    link = fixture.root / "personas" / "linked"
    result = subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(fixture.home)], capture_output=True, text=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
    assert result.returncode == 0, result.stderr
    try:
        assert link.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
        with pytest.raises(observed.ObservedReadError):
            observed.ObservedReads(roots=(fixture.root,), members=(observed.ReadMember(link / "persona.yaml", 4096), observed.ReadMember(fixture.register, 1024)))
    finally:
        link.rmdir()
    assert fixture.path.is_file()
