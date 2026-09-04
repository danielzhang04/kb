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
    checks = [
        ("network.linear", process["network"]["linear"], 32),
        ("save.save_every", save["save_every"], 250),
        ("save.max_step_saves_to_keep", save["max_step_saves_to_keep"], 15),
        ("save.dtype", save["dtype"], "bf16"),
        ("train.steps", train["steps"], 3000),
        ("train.batch_size", train["batch_size"], 1),
        ("train.gradient_accumulation", train["gradient_accumulation"], 1),
        ("train.lr", float(train["lr"]), 1e-4),
        ("train.optimizer", train["optimizer"], "adamw8bit"),
        ("train.timestep_type", train["timestep_type"], "linear"),
        ("train.cache_text_embeddings", train["cache_text_embeddings"], True),
        ("train.disable_sampling", train["disable_sampling"], True),
        ("dataset.caption_dropout_rate", dataset["caption_dropout_rate"], 0.05),
        ("dataset.resolution", dataset["resolution"], [512, 768, 1024]),
        ("model.arch", process["model"]["arch"], "krea2"),
        ("model.quantize", process["model"]["quantize"], True),
        ("model.qtype", process["model"]["qtype"], "qfloat8"),
        ("model.low_vram", process["model"]["low_vram"], True),
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

    rendered = render(args.template.read_text(encoding="utf-8"), build_context(args))
    config = yaml.safe_load(rendered)
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
