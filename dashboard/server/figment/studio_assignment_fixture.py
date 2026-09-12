"""Synthetic offline authority fixture for the real Studio-to-content-binding join.

Uses actual creator-001 checkpoint/plan/grade/rulings/brief/revision/binding
producers. Only stage receipts/images and attributed fixture judgments are
synthetic, as in the existing pipeline integration recipe. No provider or
harness is called; production validators are neither patched nor replaced.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import importlib.util

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"
CREATOR = "creator-001"
BASE = "content/briefs/2026-09-11-studio-base"
REVISION = "content/briefs/2026-09-12-studio-revision"


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path: Path, value: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")
    return path


def modules():
    fixture = load("studio_assignment_plan_support", HERE / "studio_gen_plan_fixture.py")
    command = fixture.load_module("studio_assignment_train", PIPELINE / "figment_train.py")
    anchor = fixture.load_module("studio_assignment_anchor", PIPELINE / "tests" / "test_anchor_stage.py")
    return fixture, command, anchor


def init(root: Path) -> None:
    fixture, command, anchor = modules()
    personas = root / "personas"
    assert not (personas / CREATOR).exists()
    anchor._promoted_persona(personas, creator_id=CREATOR, steps=3000)
    fixture._prepare_creator001_accepted_checkpoint(command, anchor, personas, root / "_private" / "assignment-test-authority")
    print(json.dumps({"creator": CREATOR, "persona": str(personas / CREATOR / "persona.yaml")}))


def approve_synthetic_gen(command, anchor, plan: Path) -> list[dict]:
    original = plan.read_bytes()
    value = json.loads(original)
    assert value["creator"] == CREATOR
    anchor._fake_stage_outputs(plan.parent, value, "gen")
    grade = command.build_grade(CREATOR, "gen", plan, skip_judge=True)
    decisions = anchor.load_json(Path(grade["rulings_template"]))
    for row in decisions["rulings"]:
        row.update(anchor._axes(), decision="keep", gate_override="fixture: synthetic image")
    decisions.update({"decided_by": "operator-fixture", "decided_at": "2026-09-12T00:00:00Z"})
    filled = write(plan.parent / "fixture-gen-rulings.json", decisions)
    command.apply_rulings(CREATOR, "gen", plan, filled)
    images = anchor.load_json(plan.parent / "grade/gen/approved-list.json")["images"][:2]
    assert len(images) == 2
    # Actual authority verification, not an injected successful stub.
    for image in images:
        authority = command.validate_approved_gen_still(CREATOR, plan, image["image_id"])
        assert authority["source_plan"] == {"path": str(plan), "sha256": sha(plan)}
    assert plan.read_bytes() == original
    return images


def bind(root: Path, plan: Path, legacy_out: Path, ledger: Path) -> None:
    _, command, anchor = modules()
    briefs = load("studio_assignment_briefs", PIPELINE / "content/content_brief.py")
    binding = load("studio_assignment_binding", PIPELINE / "content/content_asset_binding.py")
    expected_parent = root / "_private/figment-studio/gen-plans"
    assert plan.name == "plan.json" and plan.parent.parent == expected_parent
    assert not legacy_out.exists()
    assert legacy_out.parent == root.parents[1] / "_private/figment-studio/gen-plans"
    before = plan.read_bytes()
    marker_before = (plan.parent / "published.json").read_bytes()
    assert json.loads(marker_before)["plan_sha256"] == sha(plan)
    images = approve_synthetic_gen(command, anchor, plan)
    persona = anchor.load_json(root / "personas" / CREATOR / "persona.yaml")
    reference = persona["identity"]["references"][0]
    request = {
        "schema": "figment/content-brief-request@1", "brief_date": "2026-09-11",
        "creator": {"id": CREATOR, "persona_path": f"personas/{CREATOR}/persona.yaml", "canonical_reference": reference},
        "surface": "carousel", "template_id": "CT-2",
        "asset_slots": [{"taxonomy_type": "A", "kind": "persona"}, {"taxonomy_type": "A", "kind": "persona"}],
        "sources": [{"citation": "https://example.test/studio-binding", "observed_date": "2026-09-10"}],
        "hypothesis": "Synthetic Studio preparation reaches the actual content authority.",
        "intended_metric": "saves", "observed_metrics": None,
    }
    write(root / BASE / "request.json", request)
    briefs.build_content_brief(root, f"{BASE}/request.json", f"{BASE}/brief.json")
    base_before = [(root / BASE / name).read_bytes() for name in ("request.json", "brief.json")]
    edits = write(root / "fixture-revision-edits.json", {"brief_date": "2026-09-12", "hypothesis": "A distinct revision of the synthetic Studio binding hypothesis.", "intended_metric": "profile visits"})
    briefs.revise_content_brief(root, BASE, edits.relative_to(root).as_posix(), REVISION)
    proof = briefs.revalidate_content_brief(root, f"{REVISION}/request.json", f"{REVISION}/brief.json")
    assert proof["record"]["creator"]["canonical_reference"]["declared_path"] == reference
    brief = root / REVISION / "brief.json"
    slots = proof["record"]["content"]["required_asset_slots"]

    def rulings(source_plan: str, approved: list[dict], filename: str) -> Path:
        rows = [{"slot_index": slot["index"], "role": slot["role"], "taxonomy_type": slot["taxonomy_type"], "kind": slot["kind"],
                 "decision": "fit", "decided_by": "operator-fixture", "decided_at": "2026-09-12T00:00:00Z",
                 "source": {"kind": "approved-gen-still", "plan": source_plan, "image_id": image["image_id"]}}
                for slot, image in zip(slots, approved, strict=True)]
        return write(root / filename, {"schema": binding.RULINGS_SCHEMA, "brief": {"path": f"{REVISION}/brief.json", "sha256": sha(brief)}, "creator": CREATOR, "rulings": rows})

    def binding_cli(fit: Path, output: str):
        return subprocess.run([sys.executable, "-B", str(PIPELINE / "content/content_asset_binding.py"),
            "--root", str(root), "--brief", f"{REVISION}/brief.json", "--request", f"{REVISION}/request.json",
            "--rulings", fit.relative_to(root).as_posix(), "--out", output], cwd=ROOT, capture_output=True, text=True, timeout=90)

    fit = rulings(plan.relative_to(root).as_posix(), images, "fixture-slot-rulings.json")
    positive = binding_cli(fit, f"{REVISION}/assignment.json")
    assert positive.returncode == 0, positive.stdout + positive.stderr
    assert "assigned slots: 2" in positive.stdout
    assignment = anchor.load_json(root / REVISION / "assignment.json")
    assert all(row["asset"]["source_plan"] == {"path": plan.relative_to(root).as_posix(), "sha256": sha(plan)} for row in assignment["assignments"])

    # Compile a separate real legacy-layout plan in place, with the SAME real
    # canonical persona and selected checkpoint. Never copy or rewrite a plan.
    command.build_plan(CREATOR, "gen", legacy_out, personas_root=root / "personas", skip_pin_verify=True, ledger_dir=ledger)
    legacy_plan = legacy_out / "plan.json"
    legacy_bytes = legacy_plan.read_bytes()
    legacy_images = approve_synthetic_gen(command, anchor, legacy_plan)
    # Its root-relative spelling necessarily escapes. The actual producer must
    # refuse at the boundary even though the underlying plan/still authority is valid.
    bad_fit = rulings(Path(os.path.relpath(legacy_plan, root)).as_posix(), legacy_images, "fixture-legacy-slot-rulings.json")
    negative = binding_cli(bad_fit, f"{REVISION}/legacy-assignment.json")
    assert negative.returncode == 2, negative.stdout + negative.stderr
    assert "relative" in negative.stderr or "escapes" in negative.stderr or "traversal" in negative.stderr, negative.stderr
    assert not (root / REVISION / "legacy-assignment.json").exists()
    assert legacy_plan.read_bytes() == legacy_bytes
    assert plan.read_bytes() == before and (plan.parent / "published.json").read_bytes() == marker_before
    assert [(root / BASE / name).read_bytes() for name in ("request.json", "brief.json")] == base_before
    print(json.dumps({"schema": "figment/studio-assignment-fixture@1", "positive_exit": positive.returncode,
        "legacy_exit": negative.returncode, "legacy_error": negative.stderr.strip(), "assignment": f"{REVISION}/assignment.json",
        "brief": f"{REVISION}/brief.json", "base_brief": f"{BASE}/brief.json", "plan_sha256": sha(plan),
        "legacy_plan_sha256": sha(legacy_plan), "canonical_reference": reference, "plan_and_marker_unchanged": True,
        "legacy_plan_unchanged": True, "base_unchanged": True}))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    setup = sub.add_parser("init")
    setup.add_argument("--root", required=True, type=Path)
    run = sub.add_parser("bind")
    run.add_argument("--root", required=True, type=Path)
    run.add_argument("--plan", required=True, type=Path)
    run.add_argument("--legacy-out", required=True, type=Path)
    run.add_argument("--ledger-dir", required=True, type=Path)
    args = parser.parse_args()
    if args.command == "init":
        init(args.root.resolve())
    else:
        bind(args.root.resolve(), args.plan.resolve(), args.legacy_out.resolve(), args.ledger_dir.resolve())


if __name__ == "__main__":
    main()
