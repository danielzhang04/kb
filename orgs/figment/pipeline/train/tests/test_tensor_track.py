"""Tests for the tensor track — the 10sorLabs module-11 replication.

Covers the three things that can silently rot: the ai-toolkit config template no
longer carrying module 11's numbers, the start-script templates no longer rendering
under the harness's placeholder rules, and the three run manifests no longer passing
harness preflight (spend ceilings included).
"""
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest
import yaml


TRAIN = Path(__file__).resolve().parents[1]
PIPELINE = TRAIN.parent
POD = PIPELINE / "pod"
RUNS = TRAIN / "runs"
REAL_PERSONAS = PIPELINE.parent / "personas"

TRIGGER = "creator001krea2"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


runner = load_module("figment_pod_runpod_run_tensor", POD / "runpod_run.py")
renderer = load_module("figment_render_aitoolkit", TRAIN / "render_aitoolkit_config.py")
figment_train = load_module("figment_train_tensor_track", PIPELINE / "figment_train.py")

# Task E1 (docs/superpowers/plans/2026-09-06-figment-track2-faithful-pipeline.md): the
# hand-written train/train-smoke/tester/gen manifests figment_train.py plan now generates
# from creator-001's own persona.yaml/training.yaml/tensor-pins.yaml are retired --
# figment_train.py is the only producer. Build the same four manifests fresh, once per
# test session, from the REAL checked-in creator-001 persona (never a synthetic one: this
# file is specifically a replication check against the live config), and let `manifest()`
# load those instead of a frozen file.
_PLAN_DIR = Path(tempfile.mkdtemp(prefix="figment-tensor-track-plan-"))
_PLAN = figment_train.build_plan(
    "creator-001", "all", _PLAN_DIR, personas_root=REAL_PERSONAS, skip_pin_verify=True,
)

# "gen" is never part of a `--stage all` plan (it is only ever planned explicitly, after
# GATE 3) and creator-001's real training.yaml has no `chosen_checkpoint_step` recorded
# yet (GATE 3 has not run live) -- so it cannot be planned through build_plan() at all
# right now. Call the same private manifest-emission helper build_plan itself uses
# (`_gen_manifest`) directly against the real persona/pins, with a training dict that
# only adds the one missing key, instead of mutating the checked-in training.yaml or
# copying the persona tree (whose register.spec.path resolves relative to its real
# on-disk location and would break under a copy).
_persona, _training, _pins = figment_train._load_inputs("creator-001", REAL_PERSONAS)
_persona = dict(_persona)
_persona["_persona_path"] = str(REAL_PERSONAS / "creator-001" / "persona.yaml")
_gen_training = {**_training, "chosen_checkpoint_step": _training["steps"]}
_GEN_DIR = Path(tempfile.mkdtemp(prefix="figment-tensor-track-gen-"))
_GEN_MANIFEST_PATH = _GEN_DIR / "creator-001-tensor-gen.yaml"
figment_train._write_json(_GEN_MANIFEST_PATH, figment_train._gen_manifest(
    _persona, _gen_training, _pins,
))
# `rendered_training_start_script` resolves `training.start_script_file` relative to
# the manifest's OWN directory (same contract `_copy_support_files`/
# `build_train_first_plan` honour for every other plan) -- copy the lorapath launcher
# template alongside this hand-assembled manifest the same way those do.
(_GEN_DIR / figment_train.TESTER_START_PATH.name).write_text(
    figment_train.TESTER_START_PATH.read_text(encoding="utf-8"),
    encoding="utf-8",
)

MANIFESTS = {
    "train": _PLAN_DIR / _PLAN["stages"]["train"]["runs"][0]["manifest"],
    "train_smoke": _PLAN_DIR / _PLAN["stages"]["smoke"]["runs"][0]["manifest"],
    "tester": _PLAN_DIR / _PLAN["stages"]["tester"]["runs"][0]["manifest"],
    "gen": _GEN_MANIFEST_PATH,
}


def manifest(name):
    return runner.load_manifest(MANIFESTS[name])


def _expected_train_budget():
    """Recompute the train stage's derived job_timeout_seconds/max_minutes/ceiling_usd
    via the exact same production helper `_train_manifest` itself calls
    (`figment_train._apply_train_budget`), starting from a fresh pod-class floor
    manifest built the same way `_train_manifest` builds one (`_pod_base`) -- never a
    hardcoded number. Defect fix: the train stage's budget used to be a static,
    unrecomputed pod-class pin regardless of `training.steps`/`training.dop_enabled`;
    it is now derived per persona, so this stays correct (rather than silently going
    stale) if creator-001's live training.yaml or the pod-class pin ever changes."""
    floor = figment_train._pod_base(_pins, _training["pod_class"], "train")
    checkpoints = figment_train._checkpoint_steps(_training["steps"], _training["save_every"])
    return figment_train._apply_train_budget(floor, _training, num_artifacts=len(checkpoints) + 1)


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
        "train.steps: 5000 != 2000"
    ]


# --- DOP (Differential Output Preservation) -- Path-A train-first ------------
# r24 method 4 + r21 DOP + r25 causes #4/#5. Keys verified against the pinned
# ai-toolkit commit (training.git_ref b36bb3998ae596a566d85513299696a3a78f0dcb),
# `toolkit/config_modules.py` `TrainConfig.__init__`: `diff_output_preservation`
# (bool, default False), `diff_output_preservation_multiplier` (float, default 1.0),
# `diff_output_preservation_class` (str, default ''). OFF by default -- these three
# keys are purely additive over module 11's recipe.


@pytest.mark.parametrize("enabled", [False, True])
def test_dop_is_off_by_default_and_renders_when_asked(enabled):
    config = render_config(dop_enabled=str(enabled).lower())
    train = config["config"]["process"][0]["train"]
    assert train["diff_output_preservation"] is enabled
    assert train["diff_output_preservation_multiplier"] == pytest.approx(1.0)
    assert train["diff_output_preservation_class"] == "person"
    assert renderer.check_module_11(config) == (
        [] if not enabled else ["train.diff_output_preservation: True != False"]
    )


def test_dop_multiplier_and_class_are_overridable_via_context():
    config = render_config(dop_enabled="true", dop_multiplier="2.5", dop_class="woman")
    train = config["config"]["process"][0]["train"]
    assert train["diff_output_preservation_multiplier"] == pytest.approx(2.5)
    assert train["diff_output_preservation_class"] == "woman"


def test_dop_trigger_word_is_injected_only_when_dop_is_enabled():
    """SDTrainer.py (same pinned commit) raises 'diff_output_preservation requires a
    trigger_word to be set' unless the process-level (or a dataset's own) trigger_word
    is set -- but BaseSDTrainProcess.py's get_caption() auto-inserts a missing
    trigger_word into every caption whenever that key is merely PRESENT, DOP or not.
    Setting it unconditionally in the static template would silently change caption
    behavior for every already-proven non-DOP run, so this key is injected in Python,
    only when diff_output_preservation actually ends up True."""
    off = renderer.yaml.safe_load(renderer.render(
        (TRAIN / "ai-toolkit-krea2.yaml.template").read_text(encoding="utf-8"),
        {**renderer.MODULE_11, "trigger": TRIGGER,
         "dataset_dir": f"/workspace/ComfyUI/input/{TRIGGER}",
         "output_dir": "/workspace/train-output",
         "base_model_path": "/workspace/models/krea2/krea2_raw_bf16.safetensors",
         "dop_enabled": "false"},
    ))
    renderer.apply_dop_trigger_word(off, TRIGGER)
    assert "trigger_word" not in off["config"]["process"][0]

    on = render_config(dop_enabled="true")
    renderer.apply_dop_trigger_word(on, TRIGGER)
    assert on["config"]["process"][0]["trigger_word"] == TRIGGER


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
            "--trigger", TRIGGER, "--dataset-dir", f"/workspace/{TRIGGER}",
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


def test_training_start_script_publishes_all_checkpoints_by_exact_name():
    """Finding 10 (plus the smoke-#4 final-naming defect): the start script must
    copy every intermediate save plus the final checkpoint (creator-001's live
    1250-step train-first run: 4 intermediates + final) into /workspace/output
    under the manifest's declared artifact names, fail closed before the
    completion marker if any is missing, and never infer "final" from mtime.
    ai-toolkit writes the final step's save ONLY under the bare trigger name,
    never a step-suffixed one (evidence: smoke #4 wrote
    creator001krea2.safetensors at the final step, no
    creator001krea2_<step>.safetensors alongside it) — the source path for the
    final checkpoint must reflect that, not "${trigger}_${final_step}.safetensors"."""
    _remote, rendered = runner.rendered_training_start_script(
        manifest("train"), MANIFESTS["train"],
    )
    for step in range(250, 1250, 250):
        assert f"{step:09d}" in rendered
    # final_step still renders (used to filter checkpoint_steps below it), but
    # never as part of a step-suffixed filename.
    assert "final_step='000001250'" in rendered
    assert "_${final_step}.safetensors" not in rendered
    assert 'final_ckpt="${checkpoint_dir}/${trigger}.safetensors"' in rendered
    assert f"cp \"$final_ckpt\" \"/workspace/output/${{trigger}}.safetensors\"" in rendered
    assert "-printf '%T@" not in rendered, "final must not be inferred from mtime"
    # the checkpoint directory listing must be logged before the existence check
    # so a failed publish still shows what was actually on disk.
    listing_index = rendered.index("RESOURCE checkpoint directory listing")
    missing_index = rendered.index("missing+=")
    assert listing_index < missing_index
    assert missing_index < rendered.rindex("touch /workspace/output/_training.complete")
    assert "fail \"missing checkpoint(s) before publish" in rendered
    # checkpoint_steps is filtered to strictly-below-final_step before use, so a
    # manifest that (by mistake) lists the final step among checkpoint_steps can
    # never send this section looking for a step-suffixed final file.
    assert "10#$step < 10#$final_step" in rendered


def test_training_start_script_smoke_publish_treats_the_final_step_as_bare():
    """The smoke manifest's checkpoint_steps (one step-50 intermediate) and
    final_step (100) are genuinely different steps, so the shared publish logic
    exercises the intermediate-vs-bare-final distinction at 1+1 instead of 7+1."""
    _remote, rendered = runner.rendered_training_start_script(
        manifest("train_smoke"), MANIFESTS["train_smoke"],
    )
    assert "checkpoint_steps_raw=000000050" in rendered
    assert "final_step='000000100'" in rendered
    assert "_${final_step}.safetensors" not in rendered
    assert 'final_ckpt="${checkpoint_dir}/${trigger}.safetensors"' in rendered


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


def _lorapath_git_bash():
    """Same detection pattern the pod suite uses for its bash-executed script
    tests: prefer Git Bash proper (a real shell, unlike WSL's bash shim) and
    skip outright when neither is available."""
    bash = shutil.which("bash")
    git_bash = Path("C:/Program Files/Git/bin/bash.exe")
    if os.name == "nt" and git_bash.is_file():
        bash = str(git_bash)
    return bash


def _render_lorapath_script(tmp_path):
    """Render the real template for the tester manifest, then relocate every
    hardcoded /workspace path onto a private tmp_path tree so the script can
    be executed for real without touching the machine's actual filesystem
    root. A stub main.py records the argv it was execed with."""
    _remote, rendered = runner.rendered_training_start_script(
        manifest("tester"), MANIFESTS["tester"],
    )
    root = tmp_path.as_posix()
    script = rendered.replace("/workspace", root)

    comfy_dir = tmp_path / "ComfyUI"
    comfy_dir.mkdir(parents=True, exist_ok=True)
    (comfy_dir / "main.py").write_text(
        "import sys\nprint('MAIN_RAN:' + ' '.join(sys.argv[1:]))\n",
        encoding="utf-8",
    )
    return script


def _run_lorapath_script(bash, script, *args):
    # Without this, Git Bash's `ln -s` on a directory silently falls back to an
    # NT junction instead of a real symlink (no elevation needed either way on
    # this host), which `Path.is_symlink()` does not recognize as one.
    env = {**os.environ, "MSYS": "winsymlinks:nativestrict"}
    # `bash -c <script>` puts the whole rendered script on the Windows process
    # command line, which silently truncates past ~8188 characters (a real
    # limit hit on this host once the copy-stock-loras block was added: past
    # it, Git Bash either raises "unexpected EOF" if the cut lands mid-quote,
    # or drops the tail with no error at all if it lands on a clean boundary
    # -- ComfyUI's exec then just never runs). Writing the script to a file and
    # running `bash <file>` puts only that short path on the command line, so
    # the script body has no length ceiling.
    # Left in place deliberately, not cleaned up here: the lorapath template
    # backgrounds its assembler with `&`, and Git Bash's non-native fork
    # emulation re-execs against this same script path for that subshell, so
    # deleting it as soon as the foreground `bash` call returns races the
    # still-running background job off its own script file.
    fd, script_path = tempfile.mkstemp(suffix=".sh")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(script)
    return subprocess.run(
        [bash, Path(script_path).as_posix(), *args],
        capture_output=True, text=True, check=False, env=env,
    )


def test_lorapath_script_moves_a_real_loras_directory_aside_and_starts_comfy(tmp_path):
    """Regression for the live pod failure: ComfyUI ships models/loras as a real,
    non-empty directory (a put_loras_here placeholder), so the old `rmdir`
    always failed ENOTEMPTY, comfy-start exited 1 in under a second, and
    _comfy.log stayed empty. The fix must move the shipped directory aside
    (never delete it), symlink the real LoRA source in its place, log every
    decision to both _lorapath.log and stderr, and still exec ComfyUI."""
    bash = _lorapath_git_bash()
    if bash is None:
        pytest.skip("git bash not available")
    script = _render_lorapath_script(tmp_path)

    loras = tmp_path / "ComfyUI" / "models" / "loras"
    loras.mkdir(parents=True)
    (loras / "put_loras_here").write_text("", encoding="utf-8")

    result = _run_lorapath_script(bash, script, "--extra-arg", "42")

    assert result.returncode == 0, result.stderr
    assert "MAIN_RAN:--extra-arg 42" in result.stdout, result.stdout

    stock = tmp_path / "ComfyUI" / "models" / "loras.stock"
    assert (stock / "put_loras_here").is_file(), "shipped placeholder must survive the move"
    assert loras.is_symlink()
    lora_source = tmp_path / "ComfyUI" / "input" / TRIGGER
    assert os.path.realpath(loras) == os.path.realpath(lora_source)
    assert not (tmp_path / "output" / "_bootstrap.failed").exists()

    log_text = (tmp_path / "output" / "_lorapath.log").read_text(encoding="utf-8")
    assert "real directory" in log_text
    assert "linked at" in log_text
    # every decision must also reach stderr, which the harness captures into _comfy.log
    assert "real directory" in result.stderr
    assert "linked at" in result.stderr


def test_lorapath_script_copies_stock_loras_into_the_lora_source_without_the_placeholder(
        tmp_path):
    """A model pin with destination models/loras (e.g. pins.style_loras / pins.gen)
    lands its *.safetensors inside models/loras BEFORE this script runs, so it ends
    up in ${lora_link}.stock once the symlink swap moves the real directory aside.
    The launcher must copy every such *.safetensors into $lora_source (never move —
    .stock keeps the record) so ComfyUI can still see it through the symlink, while
    leaving the shipped put_loras_here placeholder behind."""
    bash = _lorapath_git_bash()
    if bash is None:
        pytest.skip("git bash not available")
    script = _render_lorapath_script(tmp_path)

    loras = tmp_path / "ComfyUI" / "models" / "loras"
    loras.mkdir(parents=True)
    (loras / "put_loras_here").write_text("", encoding="utf-8")
    (loras / "style.safetensors").write_bytes(b"STYLE-LORA-BYTES")

    result = _run_lorapath_script(bash, script)

    assert result.returncode == 0, result.stderr
    assert "MAIN_RAN:" in result.stdout, result.stdout

    stock = tmp_path / "ComfyUI" / "models" / "loras.stock"
    lora_source = tmp_path / "ComfyUI" / "input" / TRIGGER
    assert (stock / "style.safetensors").read_bytes() == b"STYLE-LORA-BYTES", \
        "the stock copy must survive: this is a copy, not a move"
    assert (lora_source / "style.safetensors").read_bytes() == b"STYLE-LORA-BYTES"
    assert not (lora_source / "put_loras_here").exists(), \
        "the shipped placeholder is not a LoRA and must not be copied"

    log_text = (tmp_path / "output" / "_lorapath.log").read_text(encoding="utf-8")
    assert "copied style.safetensors" in log_text
    assert "copied style.safetensors" in result.stderr


def test_lorapath_script_never_overwrites_an_existing_lora_of_the_same_name(tmp_path):
    """An uploaded/assembled identity checkpoint already at $lora_source wins over a
    same-named file that happened to ship in ${lora_link}.stock."""
    bash = _lorapath_git_bash()
    if bash is None:
        pytest.skip("git bash not available")
    script = _render_lorapath_script(tmp_path)

    loras = tmp_path / "ComfyUI" / "models" / "loras"
    loras.mkdir(parents=True)
    (loras / "shared.safetensors").write_bytes(b"STOCK-VERSION")

    lora_source = tmp_path / "ComfyUI" / "input" / TRIGGER
    lora_source.mkdir(parents=True)
    (lora_source / "shared.safetensors").write_bytes(b"UPLOADED-VERSION")

    result = _run_lorapath_script(bash, script)

    assert result.returncode == 0, result.stderr
    assert "MAIN_RAN:" in result.stdout, result.stdout
    assert (lora_source / "shared.safetensors").read_bytes() == b"UPLOADED-VERSION", \
        "an uploaded/assembled checkpoint must never be overwritten by a stock copy"

    log_text = (tmp_path / "output" / "_lorapath.log").read_text(encoding="utf-8")
    assert "already present" in log_text
    assert "not overwriting" in log_text


def test_lorapath_script_replaces_an_existing_symlink(tmp_path):
    bash = _lorapath_git_bash()
    if bash is None:
        pytest.skip("git bash not available")
    script = _render_lorapath_script(tmp_path)

    models_dir = tmp_path / "ComfyUI" / "models"
    models_dir.mkdir(parents=True)
    stale_target = tmp_path / "stale-loras"
    stale_target.mkdir()
    loras = models_dir / "loras"
    loras.symlink_to(stale_target, target_is_directory=True)

    result = _run_lorapath_script(bash, script)

    assert result.returncode == 0, result.stderr
    assert "MAIN_RAN:" in result.stdout, result.stdout
    assert loras.is_symlink()
    lora_source = tmp_path / "ComfyUI" / "input" / TRIGGER
    assert os.path.realpath(loras) == os.path.realpath(lora_source)
    assert not (models_dir / "loras.stock").exists()

    log_text = (tmp_path / "output" / "_lorapath.log").read_text(encoding="utf-8")
    assert "already a symlink" in log_text
    assert "already a symlink" in result.stderr


def _write_chunked_upload(lora_source, name, content, chunk_size):
    """Lay out one file's <name>.part-NNNN parts and <name>.parts.json manifest
    exactly as the chunked upload contract (pod/README.md) produces them."""
    parts = [content[i:i + chunk_size] for i in range(0, len(content), chunk_size)] or [b""]
    for index, part in enumerate(parts):
        (lora_source / f"{name}.part-{index:04d}").write_bytes(part)
    manifest = {
        "name": name, "parts": len(parts), "size": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    (lora_source / f"{name}.parts.json").write_text(json.dumps(manifest), encoding="utf-8")
    return parts


def _wait_for(path, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if path.exists():
            return True
        time.sleep(0.1)
    return path.exists()


def test_lorapath_script_assembles_chunked_parts_verifies_sha_and_writes_assembled_marker(
        tmp_path):
    """The background assembler (started before ComfyUI is exec'd) must wait for
    _parts.ready, reassemble every *.parts.json file's parts in order, verify size
    and sha256, delete the parts, and mark /workspace/output/_loras.assembled."""
    bash = _lorapath_git_bash()
    if bash is None:
        pytest.skip("git bash not available")
    script = _render_lorapath_script(tmp_path)

    (tmp_path / "ComfyUI" / "models").mkdir(parents=True, exist_ok=True)
    lora_source = tmp_path / "ComfyUI" / "input" / TRIGGER
    lora_source.mkdir(parents=True, exist_ok=True)

    content_a = b"A" * 25  # chunk_size=10 -> 3 parts (10, 10, 5): exact + remainder
    content_b = b"B" * 20  # chunk_size=10 -> 2 exact parts
    _write_chunked_upload(lora_source, "weights-a.safetensors", content_a, 10)
    _write_chunked_upload(lora_source, "weights-b.safetensors", content_b, 10)
    (lora_source / "_parts.ready").write_bytes(b"")

    result = _run_lorapath_script(bash, script)
    assert result.returncode == 0, result.stderr
    assert "MAIN_RAN:" in result.stdout, result.stdout

    assembled_marker = tmp_path / "output" / "_loras.assembled"
    assert _wait_for(assembled_marker), result.stderr

    assert (lora_source / "weights-a.safetensors").read_bytes() == content_a
    assert (lora_source / "weights-b.safetensors").read_bytes() == content_b
    # A successful assembly cleans up every part and its manifest.
    assert not list(lora_source.glob("*.part-*"))
    assert not list(lora_source.glob("*.parts.json"))
    assert not (tmp_path / "output" / "_loras.failed").exists()
    assert not (tmp_path / "output" / "_bootstrap.failed").exists()

    log_text = (tmp_path / "output" / "_lorapath.log").read_text(encoding="utf-8")
    assert "assembled weights-a.safetensors (3 parts, 25 bytes, sha256 verified)" in log_text
    assert "assembled weights-b.safetensors (2 parts, 20 bytes, sha256 verified)" in log_text


def test_lorapath_script_writes_failed_marker_on_a_corrupted_part(tmp_path):
    """A corrupted part must fail sha256 verification, never publish the final
    checkpoint name, and write both the dedicated _loras.failed sibling marker
    (which job-level wait_for polling honours) and a best-effort
    _bootstrap.failed for the narrow pre-readiness window."""
    bash = _lorapath_git_bash()
    if bash is None:
        pytest.skip("git bash not available")
    script = _render_lorapath_script(tmp_path)

    (tmp_path / "ComfyUI" / "models").mkdir(parents=True, exist_ok=True)
    lora_source = tmp_path / "ComfyUI" / "input" / TRIGGER
    lora_source.mkdir(parents=True, exist_ok=True)

    content = b"C" * 20
    good_parts = _write_chunked_upload(lora_source, "weights-c.safetensors", content, 10)
    # Corrupt the second part in place: same length, different bytes, so the size
    # check passes and only the sha256 check can catch it.
    corrupted = b"X" * len(good_parts[1])
    (lora_source / "weights-c.safetensors.part-0001").write_bytes(corrupted)
    (lora_source / "_parts.ready").write_bytes(b"")

    result = _run_lorapath_script(bash, script)
    assert result.returncode == 0, result.stderr  # ComfyUI itself must still start

    failed_marker = tmp_path / "output" / "_loras.failed"
    assert _wait_for(failed_marker), result.stderr
    assert "sha256 mismatch" in failed_marker.read_text(encoding="utf-8")
    assert _wait_for(tmp_path / "output" / "_bootstrap.failed")

    assert not (lora_source / "weights-c.safetensors").exists()
    assert not (tmp_path / "output" / "_loras.assembled").exists()

    log_text = (tmp_path / "output" / "_lorapath.log").read_text(encoding="utf-8")
    assert "sha256 mismatch for weights-c.safetensors" in log_text


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


def test_full_manifest_ceiling_covers_creator_001s_live_train_first_arithmetic():
    """creator-001's live training.yaml (Path-A train-first, r24 method 4): steps=1250,
    save_every=250, dop_enabled=true -- a 5-checkpoint ladder (4 intermediates + final).
    job_timeout_seconds/max_minutes are now DERIVED per persona from
    training.steps/training.dop_enabled (defect fix -- they used to be a static,
    unrecomputed pod-class pin regardless of either, see `_apply_train_budget`), floored
    at tensor-pins.yaml's pinned values. This checks the manifest carries exactly what
    that derivation computes, not a hardcoded number."""
    doc = manifest("train")
    expected = _expected_train_budget()
    assert doc["job_timeout_seconds"] == expected["job_timeout_seconds"]
    assert doc["readiness_timeout_seconds"] == 3600
    assert doc["artifact_download_seconds"] == 180
    assert len(runner.manifest_artifacts(doc)) == 5
    minimum = runner.minimum_runtime_minutes(doc)
    assert doc["max_minutes"] == expected["max_minutes"]
    assert doc["max_minutes"] >= minimum


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
    # The live 5-checkpoint ladder (steps=1250, save_every=250 -- module 11's
    # save-every kept identical while creator-001's own training.yaml now runs
    # train-first at 1250 steps, see TENSOR-TRAINING.md) comes back through /view
    # like any other artifact — no network volume required. minimum_runtime_minutes
    # no longer multiplies the job timeout by the artifact count (that was the
    # defect); it reserves one shared job timeout for the completion marker plus one
    # artifact_download_seconds allowance per further artifact. See
    # HARNESS-CHANGES.md addendum.
    step_checkpoints = [
        f"{TRIGGER}_{step:09d}.safetensors" for step in range(250, 1250, 250)
    ]
    assert [artifact["remote"] for artifact in artifacts] == [
        *step_checkpoints, f"{TRIGGER}.safetensors",
    ]
    assert len(artifacts) == 5
    assert all(artifact["wait_for"] == "_training.complete" for artifact in artifacts)
    # job_timeout_seconds/max_minutes are derived from steps/dop_enabled (defect fix) --
    # compare against the same production helper's own output, not a hardcoded number.
    expected = _expected_train_budget()
    assert doc["job_timeout_seconds"] == expected["job_timeout_seconds"]
    assert doc["artifact_download_seconds"] == 180
    assert doc["max_minutes"] == expected["max_minutes"]
    assert "network_volume_id" not in doc


def test_training_smoke_manifest_exercises_the_full_path_at_minimum_cost():
    """Findings 13/14: a reduced-step smoke that proves install -> torch.cuda ->
    trainer import -> Krea raw state-dict load -> save -> publish -> marker before
    the full 280-minute training run spends its ceiling."""
    doc = manifest("train_smoke")
    full = manifest("train")
    training = doc["training"]
    assert training["checkpoint_steps"] == "000000050"
    # final_step is deliberately a DIFFERENT step than checkpoint_steps: smoke #4
    # aliased them (both 50) and that made publish look for a step-suffixed
    # "final" file ai-toolkit never writes (it only ever saves the final step
    # under the bare trigger name). steps=100/save_every=50 keeps the two saves
    # genuinely distinct.
    assert training["final_step"] == "000000100"
    # same model pin, same trainer pin, same start script as the full run
    assert doc["models"] == full["models"]
    assert training["git_ref"] == full["training"]["git_ref"]
    assert training["start_script_file"] == full["training"]["start_script_file"]
    assert doc["job_timeout_seconds"] == 1800
    assert doc["readiness_timeout_seconds"] == 3600
    assert doc["max_minutes"] == 105
    assert doc["price_usd_per_hour"] == 1.30
    artifacts = runner.manifest_artifacts(doc)
    assert [a["remote"] for a in artifacts] == [
        "creator001krea2_000000050.safetensors", "creator001krea2.safetensors", "_training.log",
    ]
    assert all(a["wait_for"] == "_training.complete" for a in artifacts)
    minimum = runner.minimum_runtime_minutes(doc)
    assert minimum == pytest.approx(101.0)
    assert doc["max_minutes"] >= minimum
    # tight ceiling: this smoke must stay cheap, not creep toward the full run's cost
    assert doc["max_minutes"] < 120

    # the shared template renders cleanly for the reduced schedule too
    _remote, rendered = runner.rendered_training_start_script(doc, MANIFESTS["train_smoke"])
    assert "{{" not in rendered and "}}" not in rendered
    assert "checkpoint_steps_raw=000000050" in rendered
    assert "final_step='000000100'" in rendered


@pytest.mark.parametrize("name", ["train", "train_smoke"])
def test_training_manifests_run_comfyui_as_cpu_only_transport(name):
    assert manifest(name)["comfyui"]["extra_args"] == [
        "--cpu", "--disable-all-custom-nodes",
    ]


def test_tester_takes_the_checkpoints_as_an_upload_no_network_volume():
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
    assert len(jobs) == 5, "our live 1250-step run ranks 4 step saves plus the final checkpoint"
    assert {job["seed"] for job in jobs} == {1595}
    assert {job["expected_images"] for job in jobs} == {1}
    varied = set()
    for job in jobs:
        fields = {(sub["node_id"], sub["field"]) for sub in job["substitutions"]}
        assert fields == {("4", "lora_name")}
        varied.add(job["substitutions"][0]["value"])
    assert len(varied) == 5
    assert f"{TRIGGER}_000000250.safetensors" in varied
    assert f"{TRIGGER}_000001000.safetensors" in varied
    assert f"{TRIGGER}_000001250.safetensors" not in varied, "final ships bare, never step-suffixed"
    assert f"{TRIGGER}.safetensors" in varied


def test_generation_manifest_replicates_module_09_chain():
    """Track-2 Task D2's module-09 generation graph plus its cheap re-detail tail
    (MediaPipeFaceMask -> MaskToSEGS -> DetailerForEach). `training.style_lora` is
    unset on creator-001's real training.yaml, so `_gen_workflow` has deleted node
    `40` (the style LoraLoaderModelOnly slot) and rewired every consumer's `model`
    input back to the identity LoRA (node `4`) — no bypassed node ships."""
    doc = manifest("gen")
    workflow = doc["workflow"]
    base = workflow["8"]["inputs"]
    assert (base["steps"], base["cfg"], base["sampler_name"], base["scheduler"],
            base["denoise"]) == (4, 1.0, "res_2s", "beta", 1.0)
    assert base["model"] == ["4", 0], "no style lora set -- node 8 rewired past node 40"
    # The upscaler is a mid-chain resolution bump a second low-denoise sampler
    # re-renders into, not a final filter: x4 model, back down x0.25, re-encode.
    assert workflow["13"]["inputs"]["scale_by"] == 0.25
    refine = workflow["15"]["inputs"]
    assert (refine["steps"], refine["cfg"], refine["sampler_name"],
            refine["scheduler"], refine["denoise"]) == (
                4, 1.0, "euler_ancestral", "simple", 0.35)
    assert refine["latent_image"] == ["14", 0]
    assert refine["model"] == ["4", 0]
    # Node 4 (the identity LoRA) now loads at 1.0/1.0 -- the committed 0.8 module-09
    # carried was an unrecorded deviation (r23); the package's tester and generation
    # both use 1.0.
    assert workflow["4"]["inputs"]["strength_model"] == 1.0
    assert workflow["4"]["inputs"]["strength_clip"] == 1.0
    assert "40" not in workflow, "unused style-lora node must never ship in a manifest"
    # Finding 16: FaceDetailer/UltralyticsDetectorProvider are gone — no verifiable
    # Apache/MIT non-pickle face detector exists to replace face_yolov8s.pt, and the
    # brief forbids any .pt/.pth pickle entering a pod. D2's own detail tail replaces
    # it with MediaPipeFaceMask -> MaskToSEGS -> DetailerForEach instead.
    assert "18" not in workflow and "19" not in workflow
    savers = {nid: node["inputs"]["images"] for nid, node in workflow.items()
              if node["class_type"] == "SaveImage"}
    assert savers == {"20": ["16", 0], "21": ["9", 0], "34": ["33", 0]}

    detail = workflow["33"]["inputs"]
    assert detail["image"] == ["16", 0]
    assert detail["model"] == ["4", 0] and detail["clip"] == ["4", 1]
    assert (detail["steps"], detail["cfg"], detail["sampler_name"],
            detail["scheduler"], detail["denoise"]) == (4, 1.0, "euler", "normal", 0.15)
    assert workflow["35"]["inputs"]["image"] == ["16", 0]
    assert workflow["36"]["inputs"]["face_landmarks"] == ["35", 0]
    assert workflow["32"]["inputs"]["mask"] == ["31", 0]

    # One job per gen-prompts row (r22/D2: <distance> x <light> rows derived from the
    # persona's own register/grammar), each producing base + refined + detailed.
    jobs = doc["jobs"]
    assert len(jobs) == 12
    prompts = {sub["value"] for job in jobs for sub in job["substitutions"]
               if sub["field"] == "text"}
    assert len(prompts) == 12
    assert len({job["seed"] for job in jobs}) == 12, "the base render varies per job"
    assert {job["expected_images"] for job in jobs} == {3}
    # The harness writes the job seed into every seed field, so the refine and detail
    # passes must be substituted back to the fixed seed 40 or they stop being fixed.
    for job in jobs:
        restored = {sub["node_id"]: sub["value"] for sub in job["substitutions"]
                    if sub["field"] == "seed"}
        assert restored == {"15": 40, "33": 40}


def test_tester_and_gen_prompts_open_with_the_persona_trigger():
    """r24/r25 evidence: the train-first LoRA's own tester prompt carried NO trigger
    word (this file's fixtures are the exact live creator-001 persona/training.yaml that
    scoring run used -- dop_enabled: true, dop_class: "woman"), so every checkpoint
    rendered as the base model's generic woman -- facenet 0.17-0.23 vs anchors, i.e. a
    stranger -- because ai-toolkit only ever invokes a LoRA identity by naming its
    trigger in the prompt text, never implicitly just from being loaded. Both the
    tester's fixed portrait prompt and every gen-stage row must now open with
    "<trigger> <dop_class>, "."""
    tester_text = manifest("tester")["workflow"]["5"]["inputs"]["text"]
    assert tester_text.startswith(f"{TRIGGER} woman, ")
    assert not tester_text.startswith("Close-up portrait photograph of an adult woman")

    gen_texts = {
        sub["value"] for job in manifest("gen")["jobs"] for sub in job["substitutions"]
        if sub["field"] == "text"
    }
    assert gen_texts, "gen manifest carries no node-5 text substitutions"
    for text in gen_texts:
        assert text.startswith(f"{TRIGGER} woman, ")
        assert not text.startswith("Photograph of")


@pytest.mark.parametrize("name", sorted(MANIFESTS))
def test_every_model_entry_is_pinned_with_revision_and_sha256(name):
    """Finding 5: every train/tester/gen model must resolve an immutable commit,
    not mutable `main`, and its content must be verified — same field shapes as
    the dataset-stage shard manifests (expand/tests/test_tensor_dataset.py)."""
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


def test_generation_manifest_pulls_base_impact_pack_but_never_the_subpack():
    """Track-2 Task D2's detail tail (MaskToSEGS/DetailerForEach) is base Impact-Pack,
    which does not pull ultralytics/YOLO pickle weights (r23) -- Impact-Subpack, the
    unused pin review finding H4 flags one stage over (dataset), must never appear
    here either."""
    urls = [node["git_url"] for node in manifest("gen")["custom_nodes"]]
    assert any("ComfyUI-Impact-Pack" in url for url in urls)
    assert not any("Impact-Subpack" in url for url in urls)


def test_generation_manifests_declare_the_sampler_pack_they_depend_on():
    for name in ("tester", "gen"):
        urls = [node["git_url"] for node in manifest(name)["custom_nodes"]]
        # tensor-pins.yaml records the tester profile's RES4LYF url without a ".git"
        # suffix and the gen profile's with one -- both resolve to the same repo
        # (runpod_run.py's git clone accepts either), so this checks the repo, not
        # the exact suffix.
        assert any(
            url.rstrip("/").removesuffix(".git")
            == "https://github.com/ClownsharkBatwing/RES4LYF"
            for url in urls
        ), "res_2s is a RES4LYF sampler, not a ComfyUI core one"


def test_no_manifest_reaches_a_gated_repository():
    for name in MANIFESTS:
        for model in manifest(name).get("models", []):
            assert not model["repo_id"].startswith("krea/"), (
                "krea/Krea-2-Raw is gated; the harness sends no Hugging Face token"
            )
