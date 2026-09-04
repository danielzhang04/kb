"""Tests for the tensor track — the 10sorLabs module-11 replication.

Covers the three things that can silently rot: the ai-toolkit config template no
longer carrying module 11's numbers, the start-script templates no longer rendering
under the harness's placeholder rules, and the three run manifests no longer passing
harness preflight (spend ceilings included).
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest
import yaml


TRAIN = Path(__file__).resolve().parents[1]
PIPELINE = TRAIN.parent
POD = PIPELINE / "pod"
RUNS = TRAIN / "runs"

TRIGGER = "creator001krea2"
MANIFESTS = {
    "train": RUNS / "creator-001-tensor-train.yaml",
    "train_smoke": RUNS / "creator-001-tensor-train-smoke.yaml",
    "tester": RUNS / "creator-001-tensor-tester.yaml",
    "gen": RUNS / "creator-001-tensor-gen.yaml",
}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


runner = load_module("figment_pod_runpod_run_tensor", POD / "runpod_run.py")
renderer = load_module("figment_render_aitoolkit", TRAIN / "render_aitoolkit_config.py")


def manifest(name):
    return runner.load_manifest(MANIFESTS[name])


# --- ai-toolkit config template ----------------------------------------------

def render_config(**overrides):
    context = {
        "trigger": TRIGGER,
        "dataset_dir": f"/workspace/ComfyUI/input/{TRIGGER}",
        "output_dir": "/workspace/train-output",
        "base_model_path": "/workspace/models/krea2/krea2_raw_bf16.safetensors",
    }
    context.update(renderer.MODULE_11)
    context.update(overrides)
    template = (TRAIN / "ai-toolkit-krea2.yaml.template").read_text(encoding="utf-8")
    return yaml.safe_load(renderer.render(template, context))


def test_config_template_renders_module_11_settings_with_no_drift():
    config = render_config()
    assert renderer.check_module_11(config) == []
    process = config["config"]["process"][0]
    assert process["train"]["lr"] == pytest.approx(1e-4)
    assert isinstance(process["train"]["lr"], float)
    assert process["model"]["name_or_path"].endswith("krea2_raw_bf16.safetensors")
    assert process["training_folder"] == "/workspace/train-output"
    assert process["datasets"][0]["folder_path"].endswith(TRIGGER)
    # Sampling off is what buys the 70-80 minute run; cache_text_embeddings is what
    # makes sampling-off safe. Neither may drift without the other.
    assert process["train"]["disable_sampling"] is True
    assert process["train"]["cache_text_embeddings"] is True


def test_config_template_leaves_no_unresolved_placeholders():
    template = (TRAIN / "ai-toolkit-krea2.yaml.template").read_text(encoding="utf-8")
    rendered = renderer.render(template, {
        **renderer.MODULE_11,
        "trigger": TRIGGER,
        "dataset_dir": "/d",
        "output_dir": "/o",
        "base_model_path": "/b.safetensors",
    })
    assert "{{" not in rendered and "}}" not in rendered


def test_config_renderer_refuses_a_drifted_config():
    assert renderer.check_module_11(render_config(rank=16)) == [
        "network.linear: 16 != 32",
        "network.linear_alpha: 16 != 32",
    ]
    assert renderer.check_module_11(render_config(steps=5000)) == [
        "train.steps: 5000 != 3000"
    ]


@pytest.mark.parametrize(("section", "key", "wrong", "expected"), [
    ("network", "linear_alpha", 16, "network.linear_alpha: 16 != 32"),
    ("train", "train_text_encoder", True, "train.train_text_encoder: True != False"),
    ("train", "gradient_checkpointing", False, "train.gradient_checkpointing: False != True"),
    ("dataset", "caption_ext", "caption", "dataset.caption_ext: 'caption' != 'txt'"),
    ("dataset", "shuffle_tokens", True, "dataset.shuffle_tokens: True != False"),
    ("dataset", "cache_latents_to_disk", False, "dataset.cache_latents_to_disk: False != True"),
    ("model", "quantize_te", False, "model.quantize_te: False != True"),
    ("model", "qtype_te", "float8", "model.qtype_te: 'float8' != 'qfloat8'"),
    ("model", "layer_offloading", True, "model.layer_offloading: True != False"),
])
def test_config_renderer_detects_memory_sensitive_drift(section, key, wrong, expected):
    config = render_config()
    process = config["config"]["process"][0]
    target = process["datasets"][0] if section == "dataset" else process[section]
    target[key] = wrong

    assert expected in renderer.check_module_11(config)


def test_config_renderer_rejects_unknown_overrides(tmp_path):
    with pytest.raises(SystemExit):
        renderer.main([
            "--template", str(TRAIN / "ai-toolkit-krea2.yaml.template"),
            "--trigger", TRIGGER, "--dataset-dir", "/d",
            "--set", "quantize=false", "--out", str(tmp_path / "training.json"),
        ])


def test_config_renderer_writes_json_the_harness_can_upload(tmp_path):
    out = tmp_path / "training.json"
    assert renderer.main([
        "--template", str(TRAIN / "ai-toolkit-krea2.yaml.template"),
        "--trigger", TRIGGER,
        "--dataset-dir", f"/workspace/ComfyUI/input/{TRIGGER}",
        "--out", str(out),
    ]) == 0
    assert out.suffix in runner.UPLOAD_EXTENSIONS
    assert json.loads(out.read_text(encoding="utf-8"))["config"]["name"] == TRIGGER


# --- start-script templates ---------------------------------------------------

def test_training_start_script_renders_every_placeholder():
    remote, rendered = runner.rendered_training_start_script(
        manifest("train"), MANIFESTS["train"],
    )
    assert remote == "/workspace/start-training-aitoolkit.sh"
    assert "{{" not in rendered and "}}" not in rendered
    assert f"trigger='{TRIGGER}'" in rendered
    assert "python run.py" in rendered
    # The three caption modes module 11 and module 04/05 between them define.
    for mode in ("provided", "single_word", "auto"):
        assert f"  {mode})" in rendered
    # The pre-warm must stay ahead of ComfyUI, or the encoder/VAE downloads land
    # inside the job window instead of the readiness window.
    assert rendered.index("snapshot_download") < rendered.index("ComfyUI/main.py")


def test_training_start_script_streams_detached_training_evidence():
    _remote, rendered = runner.rendered_training_start_script(
        manifest("train_smoke"), MANIFESTS["train_smoke"],
    )

    assert "/sys/fs/cgroup/memory.max" in rendered
    assert "/sys/fs/cgroup/memory/memory.limit_in_bytes" in rendered
    assert "free -g" in rendered
    assert "nvidia-smi --query-gpu=memory.total,memory.used --format=csv" in rendered
    assert "df -h /workspace" in rendered
    assert rendered.count("log_resources ") >= 2
    assert "nohup bash -o pipefail -c" in rendered
    assert 'python run.py "$1" 2>&1 | tee -a "$2"' in rendered
    assert "/workspace/output/_training.heartbeat" in rendered
    assert "sleep 30" in rendered
    assert "date +%s" in rendered
    assert "tail -n 40 \"$training_log\"" in rendered
    assert "PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True" in rendered
    failed_marker = rendered.index("> /workspace/output/_training.failed")
    transport_wait = rendered.index('wait "$comfy_pid"', failed_marker)
    assert failed_marker < transport_wait, "failure evidence must remain retrievable"


def test_training_start_script_publishes_all_twelve_checkpoints_by_exact_name():
    """Finding 10: the start script must copy the 11 intermediate saves plus the
    exact step-3000 final into /workspace/output under the manifest's declared
    artifact names, fail closed before the completion marker if any is missing,
    and never infer "final" from mtime."""
    _remote, rendered = runner.rendered_training_start_script(
        manifest("train"), MANIFESTS["train"],
    )
    for step in range(250, 3000, 250):
        assert f"{step:09d}" in rendered
    assert "000003000" in rendered
    assert f"cp \"$final_ckpt\" \"/workspace/output/${{trigger}}.safetensors\"" in rendered
    assert "-printf '%T@" not in rendered, "final must not be inferred from mtime"
    assert rendered.index("missing+=") < rendered.rindex("touch /workspace/output/_training.complete")
    assert "fail \"missing checkpoint(s) before publish" in rendered


def test_lorapath_start_script_renders_for_both_generation_manifests():
    # Finding 12: tester takes the 12 checkpoints as an upload (no network
    # volume), so its lora_source_dir is the ComfyUI input subfolder the
    # harness uploads into — same shape as gen's, not /workspace/train-output.
    for name, expected in (
        ("tester", f"/workspace/ComfyUI/input/{TRIGGER}"),
        ("gen", f"/workspace/ComfyUI/input/{TRIGGER}"),
    ):
        remote, rendered = runner.rendered_training_start_script(
            manifest(name), MANIFESTS[name],
        )
        assert remote == "/workspace/start-comfy-lorapath.sh"
        assert f"lora_source='{expected}'" in rendered
        assert "{{" not in rendered and "}}" not in rendered


def test_training_start_script_rejects_a_shell_unsafe_trigger():
    broken = manifest("train")
    broken["training"]["trigger"] = "creator 001; rm -rf /"
    with pytest.raises(runner.HarnessError):
        runner.rendered_training_start_script(broken, MANIFESTS["train"])


# --- manifests ----------------------------------------------------------------

@pytest.mark.parametrize("name", sorted(MANIFESTS))
def test_manifest_passes_harness_preflight(name):
    runner.require_manifest(
        manifest(name), MANIFESTS[name], allow_missing_uploads=True,
    )


@pytest.mark.parametrize("name", sorted(MANIFESTS))
def test_manifest_uses_the_conservative_rate_and_never_retries_placement(name):
    """Finding 15: $1.30/h everywhere (not the underdeclared $0.89/h), and nothing
    retries live placement automatically."""
    doc = manifest(name)
    assert doc["price_usd_per_hour"] == 1.30
    assert doc["max_placement_attempts"] == 1


@pytest.mark.parametrize("name", sorted(MANIFESTS))
def test_manifest_ceilings_fit_the_daily_budget(name):
    doc = manifest(name)
    minimum = runner.minimum_runtime_minutes(doc)
    assert doc["max_minutes"] >= minimum
    estimate = runner.estimate_cost(doc, doc["max_minutes"], None)
    daily_limit, _spent = runner.daily_budget_state()
    assert estimate <= daily_limit, (
        f"{name} estimate ${estimate:.2f} cannot clear the ${daily_limit:.2f} "
        "daily limit even on a day with no prior figment spend"
    )


def test_training_manifest_replicates_module_11_transport():
    doc = manifest("train")
    training = doc["training"]
    assert training["git_ref"] == "b36bb3998ae596a566d85513299696a3a78f0dcb"
    assert doc["models"] == [{
        "repo_id": "Comfy-Org/Krea-2",
        "filename": "diffusion_models/krea2_raw_bf16.safetensors",
        "revision": "5ea0b6cb7e43749e5202aed076e8ecbe04d2deee",
        "sha256": "f99bb0ff8e362b77342bc4994e0c50906fe7ef7074864b181b7d48d2fa6d03d7",
        "destination_dir": "/workspace/models/krea2",
    }], "the base must stay the ungated Comfy-Org repackage of Krea-2 Raw, now pinned (finding 5)"
    uploads = runner.expand_manifest_uploads(doc, MANIFESTS["train"], allow_missing=True)
    assert uploads[-1].remote_name == "_dataset.ready"
    assert {item.subfolder for item in uploads} == {TRIGGER}
    assert any(item.remote_name == "training.json" for item in uploads)
    artifacts = runner.manifest_artifacts(doc)
    # The full 12-checkpoint ladder now comes back through /view like any other
    # artifact — no network volume required. minimum_runtime_minutes no longer
    # multiplies the job timeout by the artifact count (that was the defect); it
    # reserves one shared job timeout for the completion marker plus one
    # artifact_download_seconds allowance per further artifact. See
    # HARNESS-CHANGES.md addendum.
    step_checkpoints = [
        f"{TRIGGER}_{step:09d}.safetensors" for step in range(250, 3000, 250)
    ]
    assert [artifact["remote"] for artifact in artifacts] == [
        *step_checkpoints, f"{TRIGGER}.safetensors",
    ]
    assert len(artifacts) == 12
    assert all(artifact["wait_for"] == "_training.complete" for artifact in artifacts)
    assert doc["job_timeout_seconds"] == 10800
    assert doc["artifact_download_seconds"] == 180
    assert "network_volume_id" not in doc


def test_training_smoke_manifest_exercises_the_full_path_at_minimum_cost():
    """Findings 13/14: a reduced-step smoke that proves install -> torch.cuda ->
    trainer import -> Krea raw state-dict load -> save -> publish -> marker before
    the full 280-minute training run spends its ceiling."""
    doc = manifest("train_smoke")
    full = manifest("train")
    training = doc["training"]
    assert training["checkpoint_steps"] == "000000050"
    assert training["final_step"] == "000000050"
    # same model pin, same trainer pin, same start script as the full run
    assert doc["models"] == full["models"]
    assert training["git_ref"] == full["training"]["git_ref"]
    assert training["start_script_file"] == full["training"]["start_script_file"]
    assert doc["job_timeout_seconds"] == 1500
    assert doc["readiness_timeout_seconds"] == 3600
    assert doc["max_minutes"] == 98
    assert doc["price_usd_per_hour"] == 1.30
    artifacts = runner.manifest_artifacts(doc)
    assert [a["remote"] for a in artifacts] == [
        "creator001krea2_000000050.safetensors", "creator001krea2.safetensors", "_training.log",
    ]
    assert all(a["wait_for"] == "_training.complete" for a in artifacts)
    minimum = runner.minimum_runtime_minutes(doc)
    assert doc["max_minutes"] >= minimum
    # tight ceiling: this smoke must stay cheap, not creep toward the full run's cost
    assert doc["max_minutes"] < 120

    # the shared template renders cleanly for the reduced schedule too
    _remote, rendered = runner.rendered_training_start_script(doc, MANIFESTS["train_smoke"])
    assert "{{" not in rendered and "}}" not in rendered
    assert "checkpoint_steps_raw=000000050" in rendered
    assert "final_step='000000050'" in rendered


@pytest.mark.parametrize("name", ["train", "train_smoke"])
def test_training_manifests_run_comfyui_as_cpu_only_transport(name):
    assert manifest(name)["comfyui"]["extra_args"] == [
        "--cpu", "--disable-all-custom-nodes",
    ]


def test_tester_takes_the_12_checkpoints_as_an_upload_no_network_volume():
    """Finding 12: tester ranks the checkpoints the training run already downloaded
    locally, uploaded from train/runs/out/creator-001-tensor-train/ — no recurring
    network-volume charge, no REPLACE-WITH-RUNPOD-NETWORK-VOLUME-ID sentinel, no
    /workspace/train-output read."""
    doc = manifest("tester")
    assert "network_volume_id" not in doc
    assert "train-output" not in json.dumps(doc)
    uploads = doc["uploads"]
    assert len(uploads) == 1
    assert uploads[0]["files"] == ["out/creator-001-tensor-train/*.safetensors"]
    assert uploads[0]["subfolder"] == TRIGGER
    assert doc["training"]["lora_source_dir"] == f"/workspace/ComfyUI/input/{TRIGGER}"


def test_tester_holds_everything_but_the_checkpoint_fixed():
    doc = manifest("tester")
    sampler = doc["workflow"]["8"]["inputs"]
    assert sampler["seed"] == 1595
    assert sampler["steps"] == 4 and sampler["cfg"] == 1.0
    assert sampler["sampler_name"] == "res_2s" and sampler["scheduler"] == "beta"
    assert sampler["denoise"] == 1.0
    latent = doc["workflow"]["7"]["inputs"]
    assert (latent["width"], latent["height"]) == (1448, 2176)
    lora = doc["workflow"]["4"]["inputs"]
    assert lora["strength_model"] == 1.0 and lora["strength_clip"] == 1.0

    jobs = doc["jobs"]
    assert len(jobs) == 12, "module 11 ranks 11 step saves plus the final checkpoint"
    assert {job["seed"] for job in jobs} == {1595}
    assert {job["expected_images"] for job in jobs} == {1}
    varied = set()
    for job in jobs:
        fields = {(sub["node_id"], sub["field"]) for sub in job["substitutions"]}
        assert fields == {("4", "lora_name")}
        varied.add(job["substitutions"][0]["value"])
    assert len(varied) == 12
    assert f"{TRIGGER}_000000250.safetensors" in varied
    assert f"{TRIGGER}.safetensors" in varied


def test_generation_manifest_replicates_module_09_chain():
    doc = manifest("gen")
    workflow = doc["workflow"]
    base = workflow["8"]["inputs"]
    assert (base["steps"], base["cfg"], base["sampler_name"], base["scheduler"],
            base["denoise"]) == (4, 1.0, "res_2s", "beta", 1.0)
    # The upscaler is a mid-chain resolution bump a second low-denoise sampler
    # re-renders into, not a final filter: x4 model, back down x0.25, re-encode.
    assert workflow["13"]["inputs"]["scale_by"] == 0.25
    refine = workflow["15"]["inputs"]
    assert (refine["steps"], refine["cfg"], refine["sampler_name"],
            refine["scheduler"], refine["denoise"]) == (
                4, 1.0, "euler_ancestral", "simple", 0.35)
    assert refine["latent_image"] == ["14", 0]
    assert workflow["4"]["inputs"]["strength_model"] == 0.8
    # Finding 16: FaceDetailer/UltralyticsDetectorProvider are gone — no verifiable
    # Apache/MIT non-pickle face detector exists to replace face_yolov8s.pt, and the
    # brief forbids any .pt/.pth pickle entering a pod. Two SaveImage nodes survive
    # (base, refined) instead of the package's three (base, upscaled, FaceDetailer
    # final); node 20 now reads the refine output directly.
    assert "18" not in workflow and "19" not in workflow
    savers = {nid: node["inputs"]["images"] for nid, node in workflow.items()
              if node["class_type"] == "SaveImage"}
    assert savers == {"20": ["16", 0], "21": ["9", 0]}

    # 6 prompts x 2 seeds, angles and scenes the dataset never contained.
    jobs = doc["jobs"]
    assert len(jobs) == 12
    prompts = {sub["value"] for job in jobs for sub in job["substitutions"]
               if sub["field"] == "text"}
    assert len(prompts) == 6
    assert len({job["seed"] for job in jobs}) == 2
    assert {job["expected_images"] for job in jobs} == {2}
    # The harness writes the job seed into every seed field, so the refine
    # seed has to be substituted back or it stops being fixed. There is no
    # detailer seed left to restore.
    for job in jobs:
        restored = {sub["node_id"]: sub["value"] for sub in job["substitutions"]
                    if sub["field"] == "seed"}
        assert restored == {"15": 40}


@pytest.mark.parametrize("name", sorted(MANIFESTS))
def test_every_model_entry_is_pinned_with_revision_and_sha256(name):
    """Finding 5: every train/tester/gen model must resolve an immutable commit,
    not mutable `main`, and its content must be verified — same field shapes as
    the smoke/shard manifests (expand/runs/creator-001-tensor-smoke.yaml)."""
    models = manifest(name).get("models", [])
    assert models, f"{name} manifest declares no models"
    for model in models:
        revision = model.get("revision")
        assert isinstance(revision, str) and re.fullmatch(r"[0-9a-f]{40}", revision), model
        sha256 = model.get("sha256")
        assert isinstance(sha256, str) and re.fullmatch(r"[0-9a-f]{64}", sha256), model
        # runner.model_revision/model_sha256 must accept what we wrote.
        assert runner.model_revision(model) == revision
        assert runner.model_sha256(model) == sha256


@pytest.mark.parametrize("name", sorted(MANIFESTS))
def test_no_manifest_downloads_a_pickle_model(name):
    """Finding 16: the brief forbids any .pt/.pth pickle entering a pod."""
    for model in manifest(name).get("models", []):
        assert not model["filename"].lower().endswith((".pt", ".pth")), model


def test_generation_manifest_has_no_impact_pack_dependency():
    """With the FaceDetailer branch gone, gen no longer needs Impact-Pack/Subpack
    (they existed only to supply UltralyticsDetectorProvider/FaceDetailer)."""
    urls = [node["git_url"] for node in manifest("gen")["custom_nodes"]]
    assert not any("Impact-Pack" in url or "Impact-Subpack" in url for url in urls)


def test_generation_manifests_declare_the_sampler_pack_they_depend_on():
    for name in ("tester", "gen"):
        urls = [node["git_url"] for node in manifest(name)["custom_nodes"]]
        assert "https://github.com/ClownsharkBatwing/RES4LYF" in urls, (
            "res_2s is a RES4LYF sampler, not a ComfyUI core one"
        )


def test_no_manifest_reaches_a_gated_repository():
    for name in MANIFESTS:
        for model in manifest(name).get("models", []):
            assert not model["repo_id"].startswith("krea/"), (
                "krea/Krea-2-Raw is gated; the harness sends no Hugging Face token"
            )
