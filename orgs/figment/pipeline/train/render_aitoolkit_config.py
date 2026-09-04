#!/usr/bin/env python3
"""Render `ai-toolkit-<base>.yaml.template` into the `training.json` the pod reads.

The harness upload allowlist has no `.yaml` entry, and ai-toolkit's `get_config`
accepts `.json` as readily as `.yaml`, so the rendered config ships as JSON. This
script is the only place the module-11 numbers turn into a concrete file, so it also
refuses a config that has silently drifted off those numbers.

    py -3 render_aitoolkit_config.py \
        --template ai-toolkit-krea2.yaml.template \
        --trigger creator001krea2 \
        --dataset-dir /workspace/ComfyUI/input/creator001krea2 \
        --out runs/creator-001-tensor-dataset/training.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

PLACEHOLDER = re.compile(r"{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}")

# Every pod-side path this config carries must be an absolute POSIX path under
# this prefix — it is read by ai-toolkit inside the pod's Linux container, never
# on the machine that renders it.
POD_PATH_PREFIX = "/workspace/"

# Git Bash's MSYS layer rewrites a bare-looking absolute POSIX argument
# (`/workspace/...`) into a Windows path before Python ever sees it, unless the
# caller set MSYS_NO_PATHCONV=1 or ran from PowerShell/cmd instead. This is the
# exact prefix that mangling produces (confirmed by the creator-001 smoke's
# `_training.log`, which shipped `folder_path` as
# `C:/Program Files/Git/workspace/ComfyUI/input/creator001krea2`).
MSYS_MANGLED_PREFIX = "C:/Program Files/Git/"

WINDOWS_DRIVE_LETTER = re.compile(r"^[A-Za-z]:[\\/]")


class PodPathError(ValueError):
    """A pod-side path option is not a clean absolute POSIX /workspace/... path."""


def validate_pod_path(value: str, option_name: str) -> None:
    """Fail closed on any pod-side path option that isn't a real POSIX path.

    `--dataset-dir`, `--output-dir`, and `--base-model-path` are all read by
    ai-toolkit inside the pod's Linux container. If Git Bash's MSYS path
    conversion (or any other Windows-path leakage) mangles one of these before
    it reaches this script, the rendered `training.json` silently ships a
    Windows path the pod can never resolve, and the trainer fails deep inside
    dataset/model loading with a confusing error. Reject it here instead,
    where the operator can see exactly which option and why.
    """
    if not isinstance(value, str) or not value:
        raise PodPathError(f"{option_name} must be a non-empty string, got {value!r}")
    if value.startswith(MSYS_MANGLED_PREFIX):
        raise PodPathError(
            f"{option_name}={value!r} looks like Git Bash's MSYS path conversion "
            "rewrote a POSIX /workspace/... argument into a Windows path. Set "
            "MSYS_NO_PATHCONV=1 before running this script, or run it from "
            "PowerShell instead."
        )
    if "\\" in value:
        raise PodPathError(
            f"{option_name}={value!r} contains a backslash; pod-side paths must be "
            "POSIX paths (forward slashes only)."
        )
    if "Program Files" in value:
        raise PodPathError(
            f"{option_name}={value!r} contains 'Program Files', which cannot be a "
            "pod-side path."
        )
    if WINDOWS_DRIVE_LETTER.match(value):
        raise PodPathError(
            f"{option_name}={value!r} starts with a Windows drive letter, not a "
            "pod-side POSIX path."
        )
    if not value.startswith(POD_PATH_PREFIX):
        raise PodPathError(
            f"{option_name}={value!r} must be an absolute POSIX path starting with "
            f"{POD_PATH_PREFIX!r}."
        )


def validate_rendered_pod_paths(config: dict) -> None:
    """Re-check the same pod-side paths after they land in the rendered config.

    Called both by this script's own `main` (belt-and-suspenders on top of the
    pre-render CLI check) and by `build_training_set.py`, which validates an
    already-rendered `training.json` sitting in a pod-bound dataset dir before
    it lets `_dataset.ready` be written next to it.
    """
    try:
        process = config["config"]["process"][0]
        dataset_dir = process["datasets"][0]["folder_path"]
        output_dir = process["training_folder"]
        base_model_path = process["model"]["name_or_path"]
    except (KeyError, IndexError, TypeError) as exc:
        raise PodPathError(f"config is missing an expected pod-path field: {exc}") from exc
    validate_pod_path(dataset_dir, "datasets[0].folder_path (--dataset-dir)")
    validate_pod_path(output_dir, "training_folder (--output-dir)")
    validate_pod_path(base_model_path, "model.name_or_path (--base-model-path)")


# Module 11's on-screen values. Changing one of these is a deliberate deviation and
# has to be argued in TENSOR-TRAINING.md, not slipped in through a CLI flag.
MODULE_11 = {
    "rank": 32,
    # 1.0e-4, not 1e-4: YAML 1.1 only reads the former as a float, and ai-toolkit
    # hands `lr` straight to the optimizer.
    "lr": "1.0e-4",
    "steps": 3000,
    "save_every": 250,
    "max_step_saves_to_keep": 15,
    "resolutions": "[512, 768, 1024]",
}


def render(template_text: str, context: dict[str, object]) -> str:
    missing: list[str] = []

    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in context:
            missing.append(key)
            return match.group(0)
        return str(context[key])

    rendered = PLACEHOLDER.sub(replace, template_text)
    if missing:
        raise KeyError("unresolved placeholders: " + ", ".join(sorted(set(missing))))
    return rendered


def build_context(args: argparse.Namespace) -> dict[str, object]:
    context: dict[str, object] = dict(MODULE_11)
    context.update({
        "trigger": args.trigger,
        "dataset_dir": args.dataset_dir,
        "output_dir": args.output_dir,
        "base_model_path": args.base_model_path,
    })
    for override in args.set or []:
        key, _, value = override.partition("=")
        if key not in MODULE_11:
            raise SystemExit(f"--set may only override module-11 values: {key!r}")
        context[key] = value
    return context


def check_module_11(config: dict) -> list[str]:
    """Return a list of drifts from the module-11 recipe (empty means faithful)."""
    process = config["config"]["process"][0]
    train = process["train"]
    save = process["save"]
    dataset = process["datasets"][0]
    model = process["model"]
    checks = [
        ("job", config["job"], "extension"),
        ("process.type", process["type"], "sd_trainer"),
        ("network.type", process["network"]["type"], "lora"),
        ("network.linear", process["network"]["linear"], 32),
        ("network.linear_alpha", process["network"]["linear_alpha"], 32),
        ("save.save_every", save["save_every"], 250),
        ("save.max_step_saves_to_keep", save["max_step_saves_to_keep"], 15),
        ("save.dtype", save["dtype"], "bf16"),
        ("train.steps", train["steps"], 3000),
        ("train.batch_size", train["batch_size"], 1),
        ("train.gradient_accumulation", train["gradient_accumulation"], 1),
        ("train.train_unet", train["train_unet"], True),
        ("train.train_text_encoder", train["train_text_encoder"], False),
        ("train.gradient_checkpointing", train["gradient_checkpointing"], True),
        ("train.lr", float(train["lr"]), 1e-4),
        ("train.optimizer", train["optimizer"], "adamw8bit"),
        ("train.dtype", train["dtype"], "bf16"),
        ("train.noise_scheduler", train["noise_scheduler"], "flowmatch"),
        ("train.timestep_type", train["timestep_type"], "linear"),
        ("train.cache_text_embeddings", train["cache_text_embeddings"], True),
        ("train.disable_sampling", train["disable_sampling"], True),
        ("dataset.caption_ext", dataset["caption_ext"], "txt"),
        ("dataset.caption_dropout_rate", dataset["caption_dropout_rate"], 0.05),
        ("dataset.shuffle_tokens", dataset["shuffle_tokens"], False),
        ("dataset.cache_latents_to_disk", dataset["cache_latents_to_disk"], True),
        ("dataset.resolution", dataset["resolution"], [512, 768, 1024]),
        ("model.arch", model["arch"], "krea2"),
        ("model.quantize", model["quantize"], True),
        ("model.qtype", model["qtype"], "qfloat8"),
        ("model.quantize_te", model["quantize_te"], True),
        ("model.qtype_te", model["qtype_te"], "qfloat8"),
        ("model.low_vram", model["low_vram"], True),
        ("model.layer_offloading", model["layer_offloading"], False),
    ]
    return [f"{name}: {actual!r} != {expected!r}"
            for name, actual, expected in checks if actual != expected]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", required=True, type=Path)
    parser.add_argument("--trigger", required=True)
    parser.add_argument("--dataset-dir", required=True)
    parser.add_argument("--output-dir", default="/workspace/train-output")
    parser.add_argument(
        "--base-model-path",
        default="/workspace/models/krea2/krea2_raw_bf16.safetensors",
    )
    parser.add_argument("--set", action="append", metavar="KEY=VALUE")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument(
        "--allow-drift", action="store_true",
        help="write the config even when it no longer matches module 11",
    )
    args = parser.parse_args(argv)

    try:
        validate_pod_path(args.dataset_dir, "--dataset-dir")
        validate_pod_path(args.output_dir, "--output-dir")
        validate_pod_path(args.base_model_path, "--base-model-path")
    except PodPathError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    rendered = render(args.template.read_text(encoding="utf-8"), build_context(args))
    config = yaml.safe_load(rendered)
    try:
        validate_rendered_pod_paths(config)
    except PodPathError as exc:
        print(f"error: rendered config carries a bad pod path: {exc}", file=sys.stderr)
        return 1
    drift = check_module_11(config)
    if drift and not args.allow_drift:
        print("config drifted from module 11:", file=sys.stderr)
        for line in drift:
            print("  " + line, file=sys.stderr)
        return 1
    for line in drift:
        print("DRIFT " + line, file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
