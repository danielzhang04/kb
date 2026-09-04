"""Tests for the module-10 replication (brief T1-D).

Guards the four properties the brief names: the clothing-removal branch is gone,
every model resolves to an allowed source, the prompt templates carry no
look-spec-v2.md §4a banned phrase, and the shards stay inside the pod README's
contract at 10 jobs per pod.

Reuses the repo's existing ad-hoc file loader and `test_build_expansion_set.py`'s
own BANNED_PHRASES mirror rather than a third copy, the same way
`test_build_variation_set.py` does.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

EXPAND = Path(__file__).resolve().parents[1]
PIPELINE = EXPAND.parent
POD = PIPELINE / "pod"
RESEARCH = PIPELINE.parent / "research"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


pod = load_module("figment_tensor_test_pod_runpod_run", POD / "runpod_run.py")
bes_test = load_module(
    "figment_tensor_test_build_expansion_set", EXPAND / "tests" / "test_build_expansion_set.py"
)

BANNED_PHRASES = bes_test.BANNED_PHRASES
UNSAFE_TERMS = bes_test.UNSAFE_TERMS

WORKFLOW = EXPAND / "workflows" / "tensor_dataset_v2_api.json"
TEMPLATES = EXPAND / "templates" / "tensor-dataset-prompts.yaml"
SHARDS = tuple(
    EXPAND / "runs" / f"creator-001-tensor-dataset-shard-{i:02d}.yaml" for i in (1, 2, 3)
)
SOURCE_GRAPH = (
    RESEARCH / "10sorlabs-package" / "10_dataset_generator_v2"
    / "10sorlabs_dataset_generator_v2.json"
)

# Every model file the port is allowed to pull. Comfy-Org repackages are the
# ComfyUI org's own; lightx2v is the Lightning team's own repo; Phips is the
# upscaler's own author. gravedigga / Phr00t / Kiro930 / zw2013 are the
# unaudited accounts r15 §2c flagged, and black-forest-labs/FLUX.2-klein-9b-fp8
# is gated while the harness deliberately sends no Hugging Face token.
ALLOWED_MODELS = {
    ("Comfy-Org/Qwen-Image-Edit_ComfyUI", "split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors"),
    ("Comfy-Org/Qwen-Image_ComfyUI", "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors"),
    ("Comfy-Org/Qwen-Image_ComfyUI", "split_files/vae/qwen_image_vae.safetensors"),
    ("lightx2v/Qwen-Image-Edit-2511-Lightning", "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"),
    ("Comfy-Org/flux2-klein-4B", "split_files/diffusion_models/flux-2-klein-4b.safetensors"),
    ("Comfy-Org/flux2-klein-4B", "split_files/text_encoders/qwen_3_4b.safetensors"),
    ("Comfy-Org/flux2-klein-4B", "split_files/vae/flux2-vae.safetensors"),
    ("Phips/4xNomosWebPhoto_RealPLKSR", "4xNomosWebPhoto_RealPLKSR.safetensors"),
}

FORBIDDEN_OWNERS = (
    "gravedigga/", "Phr00t/", "Kiro930/", "zw2013/", "black-forest-labs/", "datasets/",
)

# Artefacts of the branch that is out of bounds under GUARDRAIL #3, plus the
# unaudited weights that fed it. None may survive anywhere in our files.
REMOVAL_BRANCH_ARTEFACTS = (
    "qwen-rapid-aio",
    "checkpointloadersimple",
    "bfs_head_v5",
    "qwen2512_",
    "zit_upscaler",
    "sam_vit_b",
    "remove the clothes",
    "fully naked",
)


@pytest.fixture(scope="module")
def workflow():
    return json.loads(WORKFLOW.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def templates():
    return json.loads(TEMPLATES.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def manifests():
    return [pod.load_manifest(path) for path in SHARDS]


def jobs(manifests):
    for manifest in manifests:
        for job in manifest["jobs"]:
            yield job


def subs(job):
    return {(s["node_id"], s["field"]): s["value"] for s in job["substitutions"]}


# ---------------------------------------------------------------------------
# The clothing-removal branch is gone
# ---------------------------------------------------------------------------


def test_no_removal_branch_artefact_survives_in_any_shipped_file():
    for path in (WORKFLOW, TEMPLATES, *SHARDS):
        text = path.read_text(encoding="utf-8").lower()
        for artefact in REMOVAL_BRANCH_ARTEFACTS:
            assert artefact not in text, f"{artefact!r} found in {path.name}"


def test_the_source_graph_really_does_carry_those_artefacts():
    """Negative control: the guard above only means something if the package
    graph it filters actually contains what we claim to have stripped."""
    source = SOURCE_GRAPH.read_text(encoding="utf-8").lower()
    for artefact in ("qwen-rapid-aio", "checkpointloadersimple", "bfs_head_v5", "zit_upscaler"):
        assert artefact in source


def test_port_drops_exactly_the_nodes_it_claims_to_drop(workflow):
    source = json.loads(SOURCE_GRAPH.read_text(encoding="utf-8"))
    source_ids = {str(node["id"]) for node in source["nodes"]}
    ported = set(workflow)
    # Nothing invented except the three loaders that replace the AIO checkpoint.
    assert ported - source_ids == {"901", "902", "903"}
    # Dropped: the AIO checkpoint (701); the bypassed unaudited body LoRA (723)
    # — node 89 keeps its id but now carries the Lightning LoRA; the CR Prompt
    # List pair (179/697) and its Set/Get plumbing (805-810) and string drivers
    # (760/761), all replaced by per-job substitutions; the second SaveImage
    # (833), replaced by a per-job selector on 832; the three PreviewImage
    # nodes (652/700/830) and both Note nodes (834/835).
    assert source_ids - ported == {
        "701", "723", "179", "697", "760", "761",
        "805", "806", "807", "808", "809", "810",
        "652", "700", "830", "833", "834", "835",
    }


def test_no_node_class_from_a_dropped_pack_remains(workflow):
    classes = {node["class_type"] for node in workflow.values()}
    for gone in ("CheckpointLoaderSimple", "CR Prompt List", "SetNode", "GetNode",
                 "PrimitiveStringMultiline", "PreviewImage", "Note"):
        assert gone not in classes


def test_exactly_one_output_node_selected_per_job(workflow, manifests):
    savers = [nid for nid, node in workflow.items() if node["class_type"] == "SaveImage"]
    assert savers == ["832"]
    for job in jobs(manifests):
        assert job["expected_images"] == 1
        assert subs(job)[("832", "images")] in (["791", 0], ["776", 0])


# ---------------------------------------------------------------------------
# Settings fidelity against r15 §3f
# ---------------------------------------------------------------------------


def test_generation_samplers_keep_the_package_settings(workflow):
    for node_id, eta in (("646", 0.31), ("672", 0.30)):
        sampler = workflow[node_id]["inputs"]
        assert sampler["eta"] == eta
        assert sampler["sampler_name"] == "linear/euler"
        assert sampler["scheduler"] == "beta57"
        assert (sampler["steps"], sampler["cfg"], sampler["denoise"]) == (4, 1.0, 1.0)
        assert sampler["sampler_mode"] == "standard"
        assert sampler["bongmath"] is True
    # Both decoders read the sampler's "denoised" output (slot 1), as the package does.
    assert workflow["8"]["inputs"]["samples"] == ["646", 1]
    assert workflow["673"]["inputs"]["samples"] == ["672", 1]


def test_refine_samplers_keep_denoise_023_at_four_steps(workflow):
    for node_id in ("788", "778"):
        ksampler = workflow[node_id]["inputs"]
        assert (ksampler["steps"], ksampler["cfg"], ksampler["denoise"]) == (4, 1.0, 0.23)
        assert (ksampler["sampler_name"], ksampler["scheduler"]) == ("euler", "beta")


def test_detail_boost_windows_and_face_bbox_are_unchanged(workflow):
    fields = ("weight", "method", "mode", "eta", "start_step", "end_step")
    assert [workflow["647"]["inputs"][k] for k in fields] == [1.0, "model", "hard", 0.5, 4, 10]
    assert [workflow["675"]["inputs"][k] for k in fields] == [1.0, "model", "hard", 0.5, 2, 4]
    assert workflow["698"]["inputs"]["padding"] == 15
    assert workflow["699"]["inputs"] == {"library": "insightface", "provider": "CPU"}


def test_geometry_shift_and_lora_strength_are_unchanged(workflow):
    for node_id in ("176", "722"):
        assert (workflow[node_id]["inputs"]["width"], workflow[node_id]["inputs"]["height"]) == (1024, 1440)
    for node_id in ("645", "678", "679"):
        assert (workflow[node_id]["inputs"]["width"], workflow[node_id]["inputs"]["height"]) == (1680, 1680)
    assert workflow["66"]["inputs"]["shift"] == 3.1
    assert workflow["797"]["inputs"]["shift"] == workflow["774"]["inputs"]["shift"] == 3.0
    assert workflow["89"]["inputs"]["strength_model"] == 1.0
    for node_id in ("785", "771"):
        assert workflow[node_id]["inputs"]["megapixels"] == 1.0
    for node_id in ("783", "768"):
        assert workflow[node_id]["inputs"]["scale_by"] == 0.5


def test_the_two_reference_inputs_are_the_g01_g07_pair(workflow):
    assert workflow["836"]["inputs"]["image"] == "creator-001/g01.jpg"
    assert workflow["837"]["inputs"]["image"] == "creator-001/g07.jpg"
    # Face branch takes the face crop only; body branch takes body + face crop.
    assert workflow["174"]["inputs"]["image1"] == ["645", 0]
    assert "image2" not in workflow["174"]["inputs"]
    assert workflow["676"]["inputs"]["image1"] == ["678", 0]
    assert workflow["676"]["inputs"]["image2"] == ["698", 0]


# ---------------------------------------------------------------------------
# Models resolve to allowed sources
# ---------------------------------------------------------------------------


def test_every_model_is_an_allowed_ungated_source(manifests):
    for manifest in manifests:
        assert {(m["repo_id"], m["filename"]) for m in manifest["models"]} == ALLOWED_MODELS


def test_no_flagged_account_appears_anywhere():
    for path in (WORKFLOW, TEMPLATES, *SHARDS):
        text = path.read_text(encoding="utf-8")
        for owner in FORBIDDEN_OWNERS:
            assert owner not in text, f"{owner!r} found in {path.name}"


def test_every_model_file_the_graph_names_is_downloaded(workflow, manifests):
    downloaded = {Path(m["filename"]).name for m in manifests[0]["models"]}
    named = set()
    for node in workflow.values():
        for field in ("unet_name", "clip_name", "vae_name", "lora_name", "model_name"):
            if field in node["inputs"]:
                named.add(node["inputs"][field])
    assert named == downloaded


def test_custom_node_packs_are_public_git_with_a_recorded_installer_pin(manifests):
    for manifest in manifests:
        assert {node["name"] for node in manifest["custom_nodes"]} == {
            "RES4LYF", "ComfyUI-Impact-Pack", "ComfyUI-Impact-Subpack",
            "ComfyUI_FaceAnalysis", "ComfyUI-KJNodes",
        }
        for node in manifest["custom_nodes"]:
            assert node["git_url"].startswith("https://github.com/")
            assert len(node["installer_pin"]) == 40


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------


def test_templates_hold_two_lists_of_fifteen_rows(templates):
    for side in ("face", "body"):
        assert len(templates[side]["rows"]) == 15
        assert len(set(templates[side]["rows"])) == 15
        assert templates[side]["identity"].endswith(", ")


def test_templates_and_every_prompt_in_graph_and_shards_are_clean(templates, workflow, manifests):
    texts = []
    for side in ("face", "body"):
        texts.append(templates[side]["identity"])
        texts.extend(templates[side]["rows"])
    for node in workflow.values():
        for field in ("prompt", "text"):
            if field in node["inputs"] and isinstance(node["inputs"][field], str):
                texts.append(node["inputs"][field])
    for job in manifests[0]["jobs"] + manifests[1]["jobs"] + manifests[2]["jobs"]:
        for sub in job["substitutions"]:
            if sub["field"] == "prompt":
                texts.append(sub["value"])
    for text in texts:
        lowered = text.lower()
        hits = sorted(t for t in BANNED_PHRASES | UNSAFE_TERMS if t in lowered)
        assert not hits, f"{hits} in {text[:80]!r}"


def test_prompts_state_adulthood_without_a_bare_numeral(templates):
    for side in ("face", "body"):
        identity = templates[side]["identity"].lower()
        assert "a woman in her early twenties, about twenty-one" in identity
        assert not any(ch.isdigit() for ch in identity)


def test_the_baked_refine_prompts_are_the_template_identity_strings(templates, workflow):
    assert workflow["800"]["inputs"]["text"] == templates["face"]["identity"]
    assert workflow["780"]["inputs"]["text"] == templates["body"]["identity"]
    assert workflow["801"]["inputs"]["text"] == workflow["766"]["inputs"]["text"] == ""


def test_every_template_row_is_used_exactly_once_across_the_shards(templates, manifests):
    built = {"face": [], "body": []}
    for job in jobs(manifests):
        table = subs(job)
        if ("174", "prompt") in table:
            built["face"].append(table[("174", "prompt")])
        else:
            built["body"].append(table[("676", "prompt")])
    for side in ("face", "body"):
        identity = templates[side]["identity"]
        assert len(built[side]) == 15
        assert all(p.startswith(identity) for p in built[side])
        assert {p[len(identity):] for p in built[side]} == set(templates[side]["rows"])


# ---------------------------------------------------------------------------
# Shard shape and the pod README contract
# ---------------------------------------------------------------------------


def test_each_shard_passes_the_pod_manifest_contract():
    for path in SHARDS:
        assert pod.require_manifest(pod.load_manifest(path), path) is None


def test_thirty_jobs_in_three_shards_of_ten_for_thirty_images(manifests):
    counts = [len(m["jobs"]) for m in manifests]
    assert counts == [10, 10, 10]
    assert sum(job["expected_images"] for job in jobs(manifests)) == 30
    names = [job["output_name"] for job in jobs(manifests)]
    expected = [f"c001-tds-f{i:02d}" for i in range(1, 16)]
    expected += [f"c001-tds-b{i:02d}" for i in range(1, 16)]
    assert sorted(names) == sorted(expected)
    assert len(set(names)) == 30


def test_max_minutes_covers_readiness_plus_jobs_plus_teardown(manifests):
    for manifest in manifests:
        budget = (
            manifest["readiness_timeout_seconds"]
            + manifest["job_timeout_seconds"] * len(manifest["jobs"])
            + 300
        )
        assert budget <= manifest["max_minutes"] * 60


def test_shards_run_on_a_48gb_class_gpu_under_a_three_dollar_ceiling(manifests):
    for manifest in manifests:
        assert manifest["gpu"]["type"] == "NVIDIA L40S"
        assert manifest["price_usd_per_hour"] == 1.30
        assert manifest["container_disk_gb"] >= 100
        assert manifest["max_minutes"] / 60 * manifest["price_usd_per_hour"] <= 3.00


def test_shards_copy_the_proven_comfyui_and_host_denylist_from_composite_02(manifests):
    base = pod.load_manifest(PIPELINE / "train" / "runs" / "creator-001-composite-02.yaml")
    for manifest in manifests:
        assert manifest["comfyui"] == base["comfyui"]
        assert manifest["avoid_machine_hosts"] == base["avoid_machine_hosts"]


def test_seeds_stay_fixed_at_the_package_values(manifests):
    for manifest in manifests:
        assert manifest["seed_fields"] == ["seed"]
    for job in jobs(manifests):
        table = subs(job)
        if ("174", "prompt") in table:
            assert job["seed"] == 241731167782064
            assert table[("788", "seed")] == 1098688918602660
        else:
            assert job["seed"] == 269789944143426
            assert table[("778", "seed")] == 1098688918602660
