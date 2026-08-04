#!/usr/bin/env python3
"""Regression contract for Forge fixes 1 and 4 (plain asserts; no provider calls).

Run: py -3 .claude/skills/image-generation/scripts/test_forge_seed_roles_and_delta.py

The batch item carries ordered ``seed_roles`` dictionaries.  Their order is the provider-part
order and each dictionary is ``{path, role, character?}``; Forge must derive its ordinal prose
from that final list after retry prepending/deduplication, then preflight the agreement.
"""
import contextlib
import copy
import hashlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from forge import (Kit, RETRY_OVERLAY_SCHEMA, cmd_batch, cmd_retry_batch, placement_delta,
                   preflight_batch)


KIT_DIR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit")
ROOT = KIT_DIR.parents[2]
PNG = b"\x89PNG\r\n\x1a\n"


def _kit():
    kit = Kit(str(KIT_DIR), dry=True)
    # `Kit` finds the repo root by walking up to the env marker, which exists only in the primary
    # checkout; a worktree has none, so pin the root the fixture's relative seed paths are written
    # against instead of resolving them off the filesystem root.
    kit.root = str(ROOT)
    kit.staging = os.path.join(tempfile.mkdtemp(), "_staging")
    os.makedirs(kit.staging)
    return kit


def _write_json(path, value):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f)


def _batch(kit, shots_path, out_path, scope=None):
    with contextlib.redirect_stdout(io.StringIO()):
        cmd_batch(kit, shots_path, out_path, shots=scope)
    with open(out_path, encoding="utf-8") as f:
        return json.load(f)


def _l28_retry_fixture():
    """The audited bad order: place, Terry, MiniScribe, then the drive prop."""
    video = tempfile.mkdtemp()
    scenes = os.path.join(video, "assets", "scenes")
    os.makedirs(scenes)
    place = os.path.join(scenes, "L26.png")
    with open(place, "wb") as f:
        f.write(PNG)
    _write_json(os.path.join(scenes, "manifest.json"), {
        "video_slug": "l28-role-regression",
        "shots": [{"shot_id": "L26", "file": "assets/scenes/L26.png",
                   "review_status": "verified"}],
    })
    shots = os.path.join(video, "shots.json")
    _write_json(shots, {
        "schema": "shots/1", "video_slug": "l28-role-regression",
        "long_form": {"aspect_ratio": "16:9", "shots": [{
            "id": "L28", "source": "ai-gen", "stage": "factory", "stage_role": "base",
            "place_anchor": "assets/scenes/L26.png",
            "assets": {"prop-drive": "channels/the-second-take/visual-kit/refs/env/prop-drive.png"},
            "still_prompt": ("`terry-johnson` and `miniscribe-rep` stand beside the drive "
                             "assembly line, with `prop-drive` on the workbench."),
        }]},
    })
    overlay = os.path.join(video, "retry.json")
    _write_json(overlay, {
        "schema": RETRY_OVERLAY_SCHEMA, "video_slug": "l28-role-regression",
        "entries": [{
            "kind": "scene", "shot": "L28", "name": "L28-role-retry",
            "defect": "mechanism",
            # This is already the native place seed.  Retry stable-dedup moves it to FIRST.
            "prepend_seeds": ["assets/scenes/L26.png"],
        }],
    })
    return video, shots, overlay, os.path.join(video, "spec.json")


def _l28_retry_spec():
    video, shots, overlay, out = _l28_retry_fixture()
    kit = _kit()
    # A staged STEP-1 is reusable only with an all-pass review record pinned to its bytes (C-6),
    # so the fixture stages the frames the way an approved run leaves them: reviewed.
    reviewed = {}
    for name in ("fig-terry-johnson.png", "fig-miniscribe-rep.png"):
        with open(os.path.join(kit.staging, name), "wb") as f:
            f.write(PNG)
        reviewed[os.path.splitext(name)[0]] = {
            "canonical_sha256": hashlib.sha256(PNG).hexdigest(), "expression_sha256": None,
            "verdicts": {"rig": "pass"}, "reviewer": "fresh-eyes", "date": "2026-08-04"}
    _write_json(os.path.join(kit.staging, "review.json"), {"figures": reviewed})
    with contextlib.redirect_stdout(io.StringIO()):
        cmd_retry_batch(kit, shots, out, overlay)
    with open(out, encoding="utf-8") as f:
        return kit, json.load(f)


def _scene(spec, name):
    return next(item for item in spec if item["name"] == name)


def test_l28_final_seed_roles_and_ordinals_follow_the_final_retry_order():
    kit, spec = _l28_retry_spec()
    scene = _scene(spec, "L28-role-retry")
    stems = [Path(seed).stem for seed in scene["seed"]]
    assert stems == ["L26", "fig-terry-johnson", "fig-miniscribe-rep", "prop-drive"], stems
    assert scene["seed_roles"] == [
        {"path": scene["seed"][0], "role": "place", "character": None},
        {"path": scene["seed"][1], "role": "figure", "character": "terry-johnson"},
        {"path": scene["seed"][2], "role": "figure", "character": "miniscribe-rep"},
        {"path": scene["seed"][3], "role": "prop", "character": "prop-drive"},
    ], scene.get("seed_roles")
    for clause in (
        "The FIRST image is the destination place",
        "The SECOND image is `terry-johnson`'s complete STEP-1 figure",
        "The THIRD image is `miniscribe-rep`'s complete STEP-1 figure",
        "The FOURTH image is the `prop-drive` prop canonical",
    ):
        assert clause in scene["delta"], scene["delta"]


def test_preflight_rejects_seed_role_metadata_that_disagrees_with_final_seed_prose():
    kit, spec = _l28_retry_spec()
    bad = copy.deepcopy(spec)
    scene = _scene(bad, "L28-role-retry")
    scene["seed_roles"] = list(reversed(scene["seed_roles"]))
    try:
        preflight_batch(kit, bad, force=True, dry=True)
    except SystemExit as exc:
        message = str(exc).lower()
        assert "seed role" in message and "l28-role-retry" in message, str(exc)
    else:
        assert False, "preflight must reject ordinal prose/role metadata that lies about final seed order"


def test_preflight_rejects_semantically_false_roles_even_when_prose_was_rebuilt_from_them():
    kit, spec = _l28_retry_spec()
    scene = _scene(spec, "L28-role-retry")
    scene["seed_roles"][0]["role"] = "figure"
    scene["seed_roles"][0]["character"] = "terry-johnson"
    scene["delta"] = placement_delta(scene["payload"], scene["seed_roles"])
    try:
        preflight_batch(kit, spec, force=True, dry=True)
    except SystemExit as exc:
        assert "not truthful" in str(exc), str(exc)
    else:
        assert False, "a place image relabelled as a figure must hard-fail preflight"


def test_preflight_rejects_roleless_manual_composite_specs():
    kit, spec = _l28_retry_spec()
    scene = _scene(spec, "L28-role-retry")
    scene.pop("seed_roles")
    try:
        preflight_batch(kit, spec, force=True, dry=True)
    except SystemExit as exc:
        assert "seed_roles" in str(exc), str(exc)
    else:
        assert False, "a hand-written composite may not bypass seed-role truth by omitting metadata"


def _delta_fixture(delta_primitives=None):
    video = tempfile.mkdtemp()
    shots = os.path.join(video, "shots.json")
    delta = {
        "id": "D02", "source": "ai-gen", "stage": "factory", "stage_role": "delta",
        "still_prompt": ("The same factory, with `miniscribe-rep`, `action-powerstance`, and "
                         "`expr-smug`, while only the contract on the desk changes."),
    }
    if delta_primitives is not None:
        # New explicit, per-character declaration: no generic primitive may enter a delta otherwise.
        delta["delta_primitives"] = delta_primitives
    _write_json(shots, {
        "schema": "shots/1", "video_slug": "delta-seed-regression",
        "long_form": {"aspect_ratio": "16:9", "shots": [
            {"id": "D01", "source": "ai-gen", "stage": "factory", "stage_role": "base",
             "still_prompt": ("`miniscribe-rep`, `action-powerstance`, and `expr-smug` stand "
                              "at a factory desk."),},
            delta,
        ]},
    })
    return shots, os.path.join(video, "spec.json")


def test_whole_scene_delta_uses_only_parent_and_canonical_identity_by_default():
    shots, out = _delta_fixture()
    spec = _batch(_kit(), shots, out)
    delta = _scene(spec, "D02")
    assert [Path(seed).stem for seed in delta["seed"]] == ["D01", "miniscribe-rep"], delta["seed"]
    assert delta["seed_roles"] == [
        {"path": delta["seed"][0], "role": "parent", "character": None},
        {"path": delta["seed"][1], "role": "canonical", "character": "miniscribe-rep"},
    ], delta.get("seed_roles")


def test_delta_allows_only_explicitly_proven_necessary_primitives_and_labels_them_in_order():
    shots, out = _delta_fixture({"miniscribe-rep": ["action-powerstance"]})
    spec = _batch(_kit(), shots, out)
    delta = _scene(spec, "D02")
    assert [Path(seed).stem for seed in delta["seed"]] == [
        "D01", "miniscribe-rep", "action-powerstance"], delta["seed"]
    assert delta["seed_roles"] == [
        {"path": delta["seed"][0], "role": "parent", "character": None},
        {"path": delta["seed"][1], "role": "canonical", "character": "miniscribe-rep"},
        {"path": delta["seed"][2], "role": "pose", "character": "miniscribe-rep"},
    ], delta.get("seed_roles")
    assert "expr-smug" not in "\n".join(map(str, delta["seed"])), delta["seed"]


def test_manual_delta_declaration_must_bind_primitive_to_the_authored_character():
    shots, out = _delta_fixture()
    kit = _kit()
    spec = _batch(kit, shots, out)
    delta = _scene(spec, "D02")
    pose = next(a["file"] for a in kit.reg["assets"] if a["name"] == "action-powerstance")
    delta["delta_primitives"] = {"not-in-cast": ["action-powerstance"]}
    delta["seed"].append(pose)
    delta["seed_roles"].append(
        {"path": pose, "role": "pose", "character": "not-in-cast"})
    delta["delta"] = placement_delta(delta["payload"], delta["seed_roles"])
    try:
        preflight_batch(kit, spec, force=True, dry=True)
    except SystemExit as exc:
        assert "not-in-cast" in str(exc) and "delta_primitives" in str(exc), str(exc)
    else:
        assert False, "manual specs may not declare a primitive under a character absent from the shot cast"


def test_expression_defect_scene_retry_routes_to_step1_remint_not_contradictory_scene_prose():
    video = tempfile.mkdtemp()
    shots = os.path.join(video, "shots.json")
    _write_json(shots, {
        "schema": "shots/1", "video_slug": "expression-retry-regression",
        "long_form": {"aspect_ratio": "16:9", "shots": [{
            "id": "E01", "source": "ai-gen", "stage_role": "base",
            "still_prompt": "`miniscribe-rep`, `action-powerstance`, and `expr-smug` at a desk.",
        }]},
    })
    overlay = os.path.join(video, "retry.json")
    _write_json(overlay, {
        "schema": RETRY_OVERLAY_SCHEMA, "video_slug": "expression-retry-regression",
        "entries": [{
            "kind": "scene", "shot": "E01", "name": "E01-expression-retry",
            "defect": "expression",
            "instruction": "Replace the smug face with a worried expression.",
        }],
    })
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_retry_batch(_kit(), shots, os.path.join(video, "spec.json"), overlay)
    except SystemExit as exc:
        message = str(exc).lower()
        assert "expression" in message and "step-1" in message, str(exc)
    else:
        assert False, "expression-defect scene retries must route to a STEP-1 remint"


def test_expression_defect_cannot_hide_inside_an_exact_scene_replacement():
    item = {
        "name": "E01", "seed": [], "seed_roles": [],
        "payload": "`miniscribe-rep` holds `expr-smug` at the desk.",
        "delta": "`miniscribe-rep` holds `expr-smug` at the desk.",
    }
    entry = {
        "kind": "scene", "shot": "E01", "name": "E01-expression-retry",
        "defect": "expression",
        "replace": {"from": "`expr-smug`", "to": "`expr-worried`"},
    }
    try:
        from types import SimpleNamespace
        from forge import _retry_scene
        with tempfile.TemporaryDirectory() as video:
            _retry_scene(item, {"id": "E01"}, entry,
                         SimpleNamespace(root=video, kit=video, staging=video),
                         video, "retry entry 1")
    except SystemExit as exc:
        message = str(exc).lower()
        assert "expression" in message and "step-1" in message, str(exc)
    else:
        assert False, "an expression-tag replacement must route to STEP-1"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("PASS test_forge_seed_roles_and_delta")
