"""Offline scene batching/role integration; no model, pod or approval writes."""
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tensor_stills as stills
import tensor_stills_parity as parity
intake = stills.prompt_intake

_spec = importlib.util.spec_from_file_location("stills_helpers_harness", Path(__file__).resolve().parents[1] / "pod/runpod_run.py")
harness = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = harness
_spec.loader.exec_module(harness)


@pytest.fixture
def scenes(tmp_path, monkeypatch):
    import socket
    import subprocess
    def forbidden(*args, **kwargs):
        pytest.fail("unexpected external execution")
    monkeypatch.setattr(socket, "socket", forbidden)
    monkeypatch.setattr(subprocess, "Popen", forbidden)
    Image.new("RGB", (8, 8), "blue").save(tmp_path / "scene.png")
    Image.new("RGB", (8, 8), "green").save(tmp_path / "passport.png")
    selection = {"source_plan": str(tmp_path / "plan.json"), "image_id": "passport"}
    proof = {"schema": "figment/registered-passport-authority@1", "creator": "creator-999", "fixture": True,
        "registered_reference": str(tmp_path / "passport.png")}
    for key in ("image", "source_plan", "chosen_anchor", "approval_lineage", "rulings"):
        proof[key] = {"path": str(tmp_path / ("passport.png" if key == "image" else "plan.json")), "sha256": "a" * 64}
    proof["image"]["image_id"] = "passport"
    descriptors = {"face": "oval face", "hair": "dark curls", "eyes": "brown eyes", "skin": "freckled skin"}
    def resolve(*args):
        result = copy.deepcopy(proof)
        result["authority_sha256"] = hashlib.sha256(intake._canonical(result)).hexdigest()
        return result
    adapter = intake.CanonicalPassportAdapter(resolve, lambda *args: dict(descriptors))
    passport = intake.canonical_passport_binding(creator="creator-999", selection=selection, passport_adapter=adapter)
    requests = []
    for index, framing in ((0, "full"), (3, "close-up"), (7, "full")):
        raw = {key: "" for key in intake.SECTIONS}
        raw.update(shot_subject="one adult person", age_appearance={key: "" for key in intake.DESCRIPTORS},
                   environment=f"A quiet garden number {index}.")
        draft = intake.extract_fixture_draft(tmp_path, photo_path="scene.png", creator="creator-999", passport=passport,
            aspects=["environment"], framing=framing, runner=intake.FixtureRunner(json.dumps(raw)), passport_adapter=adapter)
        approval = intake.approve_fixture_prompt(tmp_path, draft, decided_by="fixture:reviewer", decided_at="2026-10-05T12:00:00Z",
            acknowledged_notes=draft["review_notes"], passport_adapter=adapter)
        requests.append({"scene_index": index, "draft": draft, "approval": approval})
    return tmp_path, requests, passport, adapter, descriptors


def projections(scenes):
    root, requests, passport, adapter, _ = scenes
    return stills.revalidate_scenes(root, requests, creator="creator-999", current_passport=passport, passport_adapter=adapter)


def groups(scenes):
    return stills.compile_scene_groups(projections(scenes), identity_lora="creator999_000001000.safetensors", output_prefix="c999-stills")


def test_framing_batches_bind_distinct_prompts_and_preserve_noncontiguous_seeds(scenes):
    result = groups(scenes)
    assert [g["framing"] for g in result] == ["full", "close-up"]
    assert [j["seed"] for j in result[0]["jobs"]] == [1594, 1601]
    assert [j["seed"] for j in result[1]["jobs"]] == [1597]
    assert result[0]["approved_prompts"]["0"] != result[0]["approved_prompts"]["7"]
    for group in result:
        manifest = {**parity.stills_pin_group(group["framing"]), **group}
        assert parity.check_stills(group["workflow"], manifest, framing=group["framing"],
            identity_lora="creator999_000001000.safetensors", approved_prompts=group["approved_prompts"]) == []
        assert "uploads" not in group and "scene.png" not in json.dumps(group)
        for job in group["jobs"]:
            effective = harness.apply_job(group["workflow"], job, seed_fields=group["seed_fields"])
            assert effective["1686"]["inputs"]["text"] == group["approved_prompts"][str(job["scene_index"])]
            assert effective["1634"]["inputs"]["seed"] == 1594 + job["scene_index"]
            assert effective["1611"]["inputs"]["seed"] == 137053700462745
            if group["framing"] != "close-up": assert effective["1637"]["inputs"]["seed"] == 40
            effective_job = copy.deepcopy(job)
            effective_job["substitutions"] = [s for s in effective_job["substitutions"] if s["node_id"] != "1686"]
            assert parity.check_stills(effective, {**manifest, "jobs": [effective_job]}, framing=group["framing"],
                prompt=group["approved_prompts"][str(job["scene_index"])],
                identity_lora="creator999_000001000.safetensors") == []


@pytest.mark.parametrize("mutation", ["photo", "descriptor", "framing", "duplicate", "creator"])
def test_frozen_authority_changes_refused(scenes, mutation):
    root, requests, passport, adapter, descriptors = scenes
    if mutation == "photo": Image.new("RGB", (8, 8), "red").save(root / "scene.png")
    elif mutation == "descriptor": descriptors["hair"] = "new hair"
    elif mutation == "framing": requests[0]["draft"]["framing"] = "wide"
    elif mutation == "duplicate": requests[1]["scene_index"] = 0
    else: passport["creator"] = "creator-998"
    with pytest.raises((stills.StillsError, intake.IntakeError)):
        projections(scenes)


@pytest.mark.parametrize("mutation", ["wrong", "missing", "extra", "unbound"])
def test_per_job_prompt_requires_exact_caller_authority(scenes, mutation):
    group = groups(scenes)[0]
    manifest = {**parity.stills_pin_group(), **group}
    approved = copy.deepcopy(group["approved_prompts"])
    if mutation == "wrong": group["jobs"][0]["substitutions"][0]["value"] = "Unapproved prompt"
    elif mutation == "missing": del approved["7"]
    elif mutation == "extra": approved["99"] = "Other prompt"
    else: approved = None
    assert parity.check_stills(group["workflow"], manifest, identity_lora="creator999_000001000.safetensors", approved_prompts=approved)


@pytest.mark.parametrize("framing", ["full", "close-up"])
def test_all_saved_roles_survive_reordered_receipts(scenes, framing):
    group = next(g for g in groups(scenes) if g["framing"] == framing)
    receipt = {"output_name": group["jobs"][0]["output_name"], "files": [
        {"role": role, "node_id": node, "media_type": "image/png", "path": role + ".png", "bytes": 10, "sha256": "a" * 64}
        for role, node in reversed(list(group["output_roles"].items()))]}
    rows = stills.normalize_stills_outputs(group, receipt)
    assert [r["role"] for r in rows] == list(group["output_roles"])
    assert len({r["image_id"] for r in rows}) == (2 if framing == "close-up" else 3)
    receipt["files"][0]["node_id"] = "wrong"
    with pytest.raises(stills.StillsError): stills.normalize_stills_outputs(group, receipt)


@pytest.mark.parametrize("mutation", ["duplicate", "missing", "extra", "job", "companion"])
def test_role_receipt_ambiguity_refused(scenes, mutation):
    group = groups(scenes)[0]
    receipt = {"output_name": group["jobs"][0]["output_name"], "files": [
        {"role": role, "node_id": node, "media_type": "image/png"} for role, node in group["output_roles"].items()]}
    if mutation == "duplicate": receipt["files"][1] = dict(receipt["files"][0])
    elif mutation == "missing": receipt["files"].pop()
    elif mutation == "extra": receipt["files"].append(dict(receipt["files"][0]))
    elif mutation == "job": receipt["output_name"] = "other"
    else: receipt["files"][0]["companion_of"] = "video"
    with pytest.raises(stills.StillsError): stills.normalize_stills_outputs(group, receipt)
