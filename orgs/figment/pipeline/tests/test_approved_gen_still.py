"""Focused contract coverage for the read-only approved-gen video authority."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest


PIPELINE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("figment_train_approved_gen_test", PIPELINE / "figment_train.py")
assert SPEC and SPEC.loader
command = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = command
SPEC.loader.exec_module(command)


def write(path: Path, value: object) -> None: path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(value), encoding="utf-8")
def digest(path: Path) -> str: return hashlib.sha256(path.read_bytes()).hexdigest()


def records(root: Path) -> tuple[Path, str]:
    image_id = "creator-test-gen-01"; image = root / "gen-01.png"; image.write_bytes(b"synthetic clothed approved still")
    plan = root / "plan.json"; write(plan, {"schema": "figment/train-plan@1", "creator": "creator-test"})
    grade = root / "grade" / "gen"; row = {"image_id": image_id, "path": str(image), "review_status": "unreviewed", "parked_reasons": [], "safety_failed": False, "safety_reasons": []}
    write(grade / "grading-manifest.json", {"creator": "creator-test", "stage": "gen", "images": [row]})
    write(grade / "evaluation-inputs.json", {"schema": "figment/evaluation-inputs@1", "subject_sha256": "fresh-subject"})
    rulings = {"creator": "creator-test", "stage": "gen", "evaluation_subject_sha256": "fresh-subject", "decided_by": "synthetic-fixture", "decided_at": "2026-09-09T00:00:00Z", "rulings": [{"image_id": image_id, "decision": "keep", "identity": "pass", "realism": "pass", "hands": "pass", "lighting": "pass", "adult_read": "pass", "garment_integrity": "pass", "real_person_resemblance": "clear"}]}
    write(grade / "rulings.json", rulings); write(grade / "gate.json", {"schema": "figment/gate@1", "rows": [{"image_id": image_id, "pass": True}]})
    write(grade / "approved-list.json", {"schema": "figment/approved-images@1", "creator": "creator-test", "stage": "gen", "images": [{"image_id": image_id, "path": str(image)}]})
    write(grade / "approval-lineage.json", {"fixture": True})
    return plan, image_id


def approval(root: Path, image_id: str) -> dict[str, object]:
    image = root / "gen-01.png"; grade = root / "grade" / "gen"
    return {"creator": "creator-test", "stage": "gen", "decision": "verified", "rulings_sha256": digest(grade / "rulings.json"), "reviewed_subject_sha256": "fresh-subject", "subject": {"images": [{"image_id": image_id, "bytes": image.stat().st_size, "sha256": digest(image)}]}}


def test_validates_current_approved_gen_membership_gate_and_bytes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    plan, image_id = records(tmp_path); monkeypatch.setattr(command, "_load_current_approval", lambda *args, **kwargs: approval(tmp_path, image_id))
    result = command.validate_approved_gen_still("creator-test", plan, image_id)
    assert result["image_id"] == image_id and result["sha256"] == digest(tmp_path / "gen-01.png")
    approved = tmp_path / "grade" / "gen" / "approved-list.json"; data = json.loads(approved.read_text()); data["images"] = []; write(approved, data)
    with pytest.raises(command.FigmentTrainError, match="current kept"):
        command.validate_approved_gen_still("creator-test", plan, image_id)


def test_rejects_stale_authority_rejected_id_and_changed_image(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    plan, image_id = records(tmp_path); frozen = approval(tmp_path, image_id); monkeypatch.setattr(command, "_load_current_approval", lambda *args, **kwargs: frozen)
    with pytest.raises(command.FigmentTrainError, match="not approved"):
        command.validate_approved_gen_still("creator-test", plan, "rejected-image")
    (tmp_path / "gen-01.png").write_bytes(b"changed")
    with pytest.raises(command.FigmentTrainError, match="bytes changed"):
        command.validate_approved_gen_still("creator-test", plan, image_id)
    monkeypatch.setattr(command, "_load_current_approval", lambda *args, **kwargs: (_ for _ in ()).throw(command.FigmentTrainError("gen operator approval is stale")))
    with pytest.raises(command.FigmentTrainError, match="stale"):
        command.validate_approved_gen_still("creator-test", plan, image_id)
