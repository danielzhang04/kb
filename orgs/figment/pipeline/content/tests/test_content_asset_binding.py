from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

import orgs.figment.pipeline.content.content_asset_binding as binding
import orgs.figment.pipeline.content.content_brief as briefs


ROOT = Path(__file__).resolve().parents[5]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path: Path, value: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def content_root(tmp_path: Path) -> Path:
    root = tmp_path / "r"
    persona = root / "personas" / "creator-002"
    (persona / "anchors").mkdir(parents=True)
    (persona / "anchors" / "g01.jpg").write_bytes(b"canonical-anchor")
    write(persona / "persona.yaml", {
        "id": "creator-002", "identity": {"references": ["anchors/g01.jpg"]},
    })
    write(root / "request.json", {
        "schema": "figment/content-brief-request@1",
        "brief_date": "2026-09-10",
        "creator": {
            "id": "creator-002", "persona_path": "personas/creator-002/persona.yaml",
            "canonical_reference": "anchors/g01.jpg",
        },
        "surface": "carousel", "template_id": "CT-2",
        "asset_slots": [
            {"taxonomy_type": "A", "kind": "persona"},
            {"taxonomy_type": "A", "kind": "persona"},
        ],
        "sources": [{"citation": "https://example.test/research", "observed_date": "2026-09-09"}],
        "hypothesis": "A current two-frame planning hypothesis.",
        "intended_metric": "saves per reached viewer", "observed_metrics": None,
    })
    briefs.build_content_brief(root, "request.json", "brief.json")
    return root


def fake_gen(root: Path, *, persona_bytes: bytes | None = None, anchor_bytes: bytes | None = None):
    plan_root = root / "gen"
    persona = root / "personas" / "creator-002" / "persona.yaml"
    if persona_bytes is not None:
        persona.write_bytes(persona_bytes)
    anchor = plan_root / "anchors" / "g01.jpg"
    anchor.parent.mkdir(parents=True, exist_ok=True)
    anchor.write_bytes(anchor_bytes if anchor_bytes is not None else (root / "personas/creator-002/anchors/g01.jpg").read_bytes())
    images = []
    for name in ("image-01", "image-02"):
        path = plan_root / "images" / f"{name}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(f"{name}-bytes".encode())
        images.append({"image_id": name, "path": str(path)})
    plan = write(plan_root / "plan.json", {
        "schema": "figment/train-plan@1", "creator": "creator-002",
        "persona_sha256": sha(persona),
        "assets": {"persona_dir": "personas/creator-002", "anchors": ["anchors/g01.jpg"]},
    })
    grade = plan_root / "grade" / "gen"
    anchor_entry = {"name": "g01.jpg", "bytes": anchor.stat().st_size, "sha256": sha(anchor)}
    approval = write(grade / "approval-lineage.json", {
        "schema": "figment/approval-lineage@1", "subject": {
            "creator": "creator-002", "persona": {"id": "creator-002"},
            "anchors": [anchor_entry],
        },
    })
    approved = write(grade / "approved-list.json", {
        "schema": "figment/approved-images@1", "creator": "creator-002", "stage": "gen",
        "images": images,
    })
    for name in ("rulings.json", "grading-manifest.json", "evaluation-inputs.json", "gate.json"):
        write(grade / name, {"fixture": name})

    def validate(creator: str, plan_path: Path, image_id: str) -> dict:
        assert creator == "creator-002" and Path(plan_path) == plan
        image = next(row for row in images if row["image_id"] == image_id)
        path = Path(image["path"])
        return {
            "image_id": image_id, "path": str(path), "bytes": path.stat().st_size,
            "sha256": sha(path),
            "source_plan": {"path": str(plan), "sha256": sha(plan)},
            "approval_lineage": {"path": str(approval), "sha256": sha(approval)},
            "approved_list": {"path": str(approved), "sha256": sha(approved)},
        }

    return SimpleNamespace(ROOT=root, validate_approved_gen_still=validate), plan, images


def rulings(root: Path, plan: Path, images: list[dict], **row_changes: object) -> Path:
    brief = root / "brief.json"
    rows = []
    for index, (role, image) in enumerate(zip(("hook", "punchline"), images, strict=True), 1):
        row = {
            "slot_index": index, "role": role, "taxonomy_type": "A", "kind": "persona",
            "decision": "fit", "decided_by": "operator-fixture",
            "decided_at": "2026-09-10T03:00:00Z",
            "source": {"kind": "approved-gen-still", "plan": plan.relative_to(root).as_posix(), "image_id": image["image_id"]},
        }
        if index == 1:
            row.update(row_changes)
        rows.append(row)
    return write(root / "slot-rulings.json", {
        "schema": binding.RULINGS_SCHEMA,
        "brief": {"path": "brief.json", "sha256": sha(brief)},
        "creator": "creator-002", "rulings": rows,
    })


def test_binds_every_exact_slot_and_revalidates_authority_twice(tmp_path: Path, monkeypatch):
    root = content_root(tmp_path)
    train, plan, images = fake_gen(root)
    calls: list[str] = []
    original = train.validate_approved_gen_still
    train.validate_approved_gen_still = lambda creator, source, image: (calls.append(image) or original(creator, source, image))
    monkeypatch.setattr(binding, "_train_module", lambda: train)
    result = binding.build_content_asset_binding(
        root=root, brief_path="brief.json", request_path="request.json",
        rulings_path=rulings(root, plan, images).name, output_path="assignment.json",
    )
    assert result["schema"] == binding.SCHEMA and result["not_promotable"] is True
    assert [row["slot_index"] for row in result["assignments"]] == [1, 2]
    assert calls == ["image-01", "image-02", "image-01", "image-02"]
    assert all(not Path(row["asset"]["path"]).is_absolute() for row in result["assignments"])


@pytest.mark.parametrize(("change", "message"), [
    ({"slot_index": 2}, "duplicate index"),
    ({"role": "other"}, "exact brief slot"),
    ({"taxonomy_type": "B"}, "exact brief slot"),
    ({"kind": "nonpersona"}, "exact brief slot"),
    ({"decision": "reject"}, "explicit fit"),
    ({"decided_by": ""}, "decided_by"),
    ({"decided_at": "2026-09-10"}, "timezone"),
    ({"source": {"kind": "diagnostic-video", "plan": "gen/plan.json", "image_id": "image-01"}}, "approved-gen-still"),
])
def test_rejects_missing_duplicate_or_misfit_slot_rulings(tmp_path: Path, monkeypatch, change: dict, message: str):
    root = content_root(tmp_path)
    train, plan, images = fake_gen(root)
    monkeypatch.setattr(binding, "_train_module", lambda: train)
    ruled = rulings(root, plan, images, **change)
    with pytest.raises(binding.ContentAssetBindingError, match=message):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")
    assert not (root / "assignment.json").exists()


def test_rejects_missing_slot_and_reused_image(tmp_path: Path, monkeypatch):
    root = content_root(tmp_path)
    train, plan, images = fake_gen(root)
    monkeypatch.setattr(binding, "_train_module", lambda: train)
    ruled = rulings(root, plan, images)
    value = json.loads(ruled.read_text("utf-8"))
    value["rulings"].pop()
    write(ruled, value)
    with pytest.raises(binding.ContentAssetBindingError, match="cover every"):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")
    value = json.loads(rulings(root, plan, images).read_text("utf-8"))
    value["rulings"][1]["source"]["image_id"] = "image-01"
    write(ruled, value)
    with pytest.raises(binding.ContentAssetBindingError, match="distinct"):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")


def test_rejects_wrong_creator_and_unsupported_motion_brief(tmp_path: Path, monkeypatch):
    root = content_root(tmp_path)
    train, plan, images = fake_gen(root)
    monkeypatch.setattr(binding, "_train_module", lambda: train)
    ruled = rulings(root, plan, images)
    value = json.loads(ruled.read_text("utf-8")); value["creator"] = "creator-other"; write(ruled, value)
    with pytest.raises(binding.ContentAssetBindingError, match="current brief and creator"):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")

    request = json.loads((root / "request.json").read_text("utf-8"))
    request.update(surface="reel", template_id="RT-1", asset_slots=[{"taxonomy_type": "G", "kind": "persona"}])
    write(root / "request.json", request); (root / "brief.json").unlink()
    briefs.build_content_brief(root, "request.json", "brief.json")
    write(ruled, {
        "schema": binding.RULINGS_SCHEMA,
        "brief": {"path": "brief.json", "sha256": sha(root / "brief.json")},
        "creator": "creator-002",
        "rulings": [{
            "slot_index": 1, "role": "motion", "taxonomy_type": "G", "kind": "persona",
            "decision": "fit", "decided_by": "operator-fixture", "decided_at": "2026-09-10T03:00:00Z",
            "source": {"kind": "approved-gen-still", "plan": plan.relative_to(root).as_posix(), "image_id": "image-01"},
        }],
    })
    with pytest.raises(binding.ContentAssetBindingError, match="motion/video"):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")


@pytest.mark.parametrize("dependency", ["persona", "reference", "taxonomy", "template"])
def test_brief_replay_detects_each_dependency_mutating_during_validation(tmp_path: Path, monkeypatch, dependency: str):
    root = content_root(tmp_path)
    static = tmp_path / "static"
    static.mkdir()
    for name in ("taxonomy.yaml", "carousel-templates.yaml", "reel-templates.yaml"):
        shutil.copy2(briefs.CONTENT_DIR / name, static / name)
    monkeypatch.setattr(briefs, "CONTENT_DIR", static)
    (root / "brief.json").unlink()
    briefs.build_content_brief(root, "request.json", "brief.json")
    original = briefs._compile_content_brief
    calls = 0

    def changing(content_root: Path, request_file: Path):
        nonlocal calls
        result = original(content_root, request_file)
        calls += 1
        if calls == 1:
            target = {
                "persona": root / "personas/creator-002/persona.yaml",
                "reference": root / "personas/creator-002/anchors/g01.jpg",
                "taxonomy": static / "taxonomy.yaml",
                "template": static / "carousel-templates.yaml",
            }[dependency]
            if target.suffix == ".jpg":
                target.write_bytes(target.read_bytes() + b"changed")
            else:
                value = json.loads(target.read_text("utf-8")); value["mutation"] = dependency; write(target, value)
        return result

    monkeypatch.setattr(briefs, "_compile_content_brief", changing)
    with pytest.raises(briefs.ContentBriefError, match="changed|stale"):
        briefs.revalidate_content_brief(root, "request.json", "brief.json")


def test_same_creator_with_different_persona_or_anchor_cannot_join(tmp_path: Path, monkeypatch):
    root = content_root(tmp_path)
    train, plan, images = fake_gen(root)
    ruled = rulings(root, plan, images)
    monkeypatch.setattr(binding, "_train_module", lambda: train)
    plan_value = json.loads(plan.read_text("utf-8")); plan_value["persona_sha256"] = "0" * 64; write(plan, plan_value)
    with pytest.raises(binding.ContentAssetBindingError, match="brief persona"):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")
    train, plan, images = fake_gen(root, anchor_bytes=b"different-identity-anchor")
    ruled = rulings(root, plan, images)
    monkeypatch.setattr(binding, "_train_module", lambda: train)
    with pytest.raises(binding.ContentAssetBindingError, match="canonical reference"):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")


def test_reparse_gen_metadata_is_rejected_before_authority_call(tmp_path: Path, monkeypatch):
    root = content_root(tmp_path)
    train, plan, images = fake_gen(root)
    ruled = rulings(root, plan, images)
    grade = plan.parent / "grade"
    target = plan.parent / "real-grade"
    grade.rename(target)
    try:
        os.symlink(target, grade, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"symlink unavailable: {exc}")
    called = False
    def should_not_run(*args):
        nonlocal called
        called = True
        raise AssertionError("authority must not run")
    train.validate_approved_gen_still = should_not_run
    monkeypatch.setattr(binding, "_train_module", lambda: train)
    with pytest.raises(binding.ContentAssetBindingError, match="link"):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")
    assert called is False


def test_reparse_gen_persona_is_rejected_before_authority_call(tmp_path: Path, monkeypatch):
    root = content_root(tmp_path)
    train, plan, images = fake_gen(root)
    ruled = rulings(root, plan, images)
    linked = root / "gen-persona-link"
    try:
        os.symlink(root / "personas/creator-002", linked, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"symlink unavailable: {exc}")
    value = json.loads(plan.read_text("utf-8")); value["assets"]["persona_dir"] = linked.name; write(plan, value)
    called = False
    def should_not_run(*args):
        nonlocal called
        called = True
        raise AssertionError("authority must not run")
    train.validate_approved_gen_still = should_not_run
    monkeypatch.setattr(binding, "_train_module", lambda: train)
    with pytest.raises(binding.ContentAssetBindingError, match="persona path traverses a link"):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")
    assert called is False


def test_oversized_gen_metadata_is_rejected_before_authority_call(tmp_path: Path, monkeypatch):
    root = content_root(tmp_path)
    train, plan, images = fake_gen(root)
    ruled = rulings(root, plan, images)
    oversized = plan.parent / "grade/gen/gate.json"
    padding = "x" * briefs.MAX_JSON_BYTES
    oversized.write_text(json.dumps({"padding": padding}), encoding="utf-8")
    called = False
    def should_not_run(*args):
        nonlocal called
        called = True
        raise AssertionError("authority must not run")
    train.validate_approved_gen_still = should_not_run
    monkeypatch.setattr(binding, "_train_module", lambda: train)
    with pytest.raises(binding.ContentAssetBindingError, match="exceeds"):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")
    assert called is False


def test_second_pass_image_change_and_existing_output_fail_without_replacement(tmp_path: Path, monkeypatch):
    root = content_root(tmp_path)
    train, plan, images = fake_gen(root)
    ruled = rulings(root, plan, images)
    original = train.validate_approved_gen_still
    calls = 0
    def changing(creator, source, image):
        nonlocal calls
        calls += 1
        if calls == 3:
            Path(images[0]["path"]).write_bytes(b"changed-after-capture")
        return original(creator, source, image)
    train.validate_approved_gen_still = changing
    monkeypatch.setattr(binding, "_train_module", lambda: train)
    with pytest.raises(binding.ContentAssetBindingError, match="bytes differ|evidence changed"):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")
    assert not (root / "assignment.json").exists()
    (root / "assignment.json").write_text("keep", encoding="utf-8")
    with pytest.raises(binding.ContentAssetBindingError, match="fresh"):
        binding.build_content_asset_binding(root=root, brief_path="brief.json", request_path="request.json", rulings_path=ruled.name, output_path="assignment.json")
    assert (root / "assignment.json").read_text("utf-8") == "keep"


def test_cli_reports_invalid_slot_coverage_without_partial_output(tmp_path: Path):
    root = content_root(tmp_path)
    _, plan, images = fake_gen(root)
    ruled = rulings(root, plan, images, slot_index=2)
    result = subprocess.run([
        sys.executable, "-I", "-B", str(PIPELINE / "content/content_asset_binding.py"),
        "--root", str(root), "--brief", "brief.json", "--request", "request.json",
        "--rulings", ruled.name, "--out", "assignment.json",
    ], cwd=ROOT, capture_output=True, text=True, timeout=30)
    assert result.returncode == 2
    assert "invalid or duplicate index" in result.stderr
    assert not (root / "assignment.json").exists()


def test_real_gen_producer_to_cli_consumer(tmp_path: Path):
    gen = __import__("orgs.figment.pipeline.tests.test_gen_stage", fromlist=["unused"])
    command = binding._train_module()
    root = tmp_path / "real"
    personas = root / "personas"
    gen._promoted_persona(personas, creator_id="creator-002", steps=3000)
    gen._prepare_accepted_checkpoint(command, personas, root)
    plan_root = root / "gen"
    plan_value = command.build_plan("creator-002", "gen", plan_root, personas_root=personas, skip_pin_verify=True)
    gen.anchor_stage_test._fake_stage_outputs(plan_root, plan_value, "gen")
    grade = command.build_grade("creator-002", "gen", plan_root / "plan.json", skip_judge=True)
    grade_rulings = gen.load_json(Path(grade["rulings_template"]))
    for row in grade_rulings["rulings"]:
        row.update(gen.anchor_stage_test._axes(), decision="keep", gate_override="fixture: synthetic image")
    grade_rulings.update({"decided_by": "operator-fixture", "decided_at": "2026-09-10T03:00:00Z"})
    filled = write(root / "gen-rulings.json", grade_rulings)
    command.apply_rulings("creator-002", "gen", plan_root / "plan.json", filled)
    approved = json.loads((plan_root / "grade/gen/approved-list.json").read_text("utf-8"))["images"][:2]
    persona = json.loads((personas / "creator-002/persona.yaml").read_text("utf-8"))
    reference = persona["identity"]["references"][0]
    write(root / "request.json", {
        "schema": "figment/content-brief-request@1", "brief_date": "2026-09-10",
        "creator": {"id": "creator-002", "persona_path": "personas/creator-002/persona.yaml", "canonical_reference": reference},
        "surface": "carousel", "template_id": "CT-2",
        "asset_slots": [{"taxonomy_type": "A", "kind": "persona"}, {"taxonomy_type": "A", "kind": "persona"}],
        "sources": [{"citation": "https://example.test/source", "observed_date": "2026-09-10"}],
        "hypothesis": "A real lineage fixture.", "intended_metric": "saves", "observed_metrics": None,
    })
    briefs.build_content_brief(root, "request.json", "brief.json")
    slot_file = rulings(root, plan_root / "plan.json", approved)
    result = subprocess.run([
        sys.executable, "-I", "-B", str(PIPELINE / "content/content_asset_binding.py"),
        "--root", str(root), "--brief", "brief.json", "--request", "request.json",
        "--rulings", slot_file.name, "--out", "assignment.json",
    ], cwd=ROOT, capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "assigned slots: 2" in result.stdout
    assert json.loads((root / "assignment.json").read_text("utf-8"))["not_promotable"] is True
