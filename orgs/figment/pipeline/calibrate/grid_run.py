"""Build and inspect single-axis calibration grids for the RunPod harness."""

from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable


HERE = Path(__file__).resolve().parent
POD_RUNNER = HERE.parent / "pod" / "runpod_run.py"
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")


class GridError(ValueError):
    pass


def _load_harness():
    spec = importlib.util.spec_from_file_location("figment_runpod_run", POD_RUNNER)
    if spec is None or spec.loader is None:
        raise GridError(f"cannot load harness: {POD_RUNNER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_document(path: Path) -> dict[str, Any]:
    """Load JSON-form YAML or the harness's documented YAML subset."""
    text = path.read_text(encoding="utf-8-sig")
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        value = _load_harness().parse_simple_yaml(text)
    if not isinstance(value, dict):
        raise GridError(f"document root must be an object: {path}")
    return value


def load_axis(path: Path) -> dict[str, Any]:
    axis = load_document(path)
    missing = [key for key in ("axis", "description", "apply", "variants", "seeds") if key not in axis]
    if missing:
        raise GridError(f"axis file {path} is missing: {', '.join(missing)}")
    if axis["seeds"] != [100001, 200002, 300003]:
        raise GridError(f"axis {axis['axis']} must use the fixed three seeds")
    if not 3 <= len(axis["variants"]) <= 6:
        raise GridError(f"axis {axis['axis']} must define 3-6 variants")
    names = [str(item.get("name", "")) for item in axis["variants"]]
    if any(not name for name in names) or len(names) != len(set(names)):
        raise GridError(f"axis {axis['axis']} has empty or duplicate variant names")
    return axis


def arm_kind(manifest: dict[str, Any]) -> str:
    workflow = manifest.get("workflow", {})
    for node in workflow.values() if isinstance(workflow, dict) else ():
        inputs = node.get("inputs", {}) if isinstance(node, dict) else {}
        clip_type = inputs.get("type")
        if clip_type == "lumina2":
            return "z_image"
        if clip_type == "flux2":
            return "klein4b"
    raise GridError("cannot identify bake-off arm from its workflow")


def find_base_job(manifest: dict[str, Any], output_name: str) -> dict[str, Any]:
    matches = [job for job in manifest.get("jobs", []) if job.get("output_name") == output_name]
    if len(matches) != 1:
        raise GridError(f"base job {output_name!r} matched {len(matches)} jobs")
    return matches[0]


def prompt_location(job: dict[str, Any]) -> tuple[str, int | None]:
    if isinstance(job.get("prompt"), str):
        return "prompt", None
    matches = [
        index for index, sub in enumerate(job.get("substitutions", []))
        if sub.get("field") == "text" and isinstance(sub.get("value"), str)
    ]
    if len(matches) != 1:
        raise GridError("base job must have one prompt or one text substitution")
    return "substitution", matches[0]


def read_prompt(job: dict[str, Any]) -> str:
    where, index = prompt_location(job)
    return job["prompt"] if where == "prompt" else job["substitutions"][index]["value"]


def write_prompt(job: dict[str, Any], value: str) -> None:
    where, index = prompt_location(job)
    if where == "prompt":
        job["prompt"] = value
    else:
        job["substitutions"][index]["value"] = value


def apply_variant(prompt: str, axis: dict[str, Any], variant: dict[str, Any]) -> str:
    operation = dict(axis["apply"])
    operation.update(variant.get("apply", {}))
    kind = operation.get("type")
    value = str(variant.get("value", "")).strip()
    if kind == "replace":
        target = str(operation.get("target", ""))
        if not target or prompt.count(target) != 1:
            raise GridError(
                f"axis {axis['axis']} replacement target must occur exactly once: {target!r}"
            )
        return prompt.replace(target, value, 1)
    if kind in {"append", "lora"}:
        # The bake-off contract keeps the heritage phrase at the very end to avoid
        # demographic-noun cascades. Append immediately before it when present.
        if not value:
            return prompt
        heritage = "Asian-American woman."
        clause = value.rstrip(".") + "."
        if prompt.endswith(heritage):
            prefix = prompt[:-len(heritage)].rstrip()
            return f"{prefix} {clause} {heritage}"
        separator = " " if prompt.endswith((".", "!", "?")) else ". "
        return prompt + separator + clause
    raise GridError(f"axis {axis['axis']} has unsupported apply type {kind!r}")


def slug(value: Any) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    if not result:
        raise GridError(f"cannot make output-name slug from {value!r}")
    return result


def output_name(axis_name: str, variant_name: str, seed: int) -> str:
    return f"cal__{slug(axis_name)}__{slug(variant_name)}__seed_{int(seed)}"


def _lora_spec(variant: dict[str, Any], kind: str) -> dict[str, Any] | None:
    lora = variant.get("lora")
    if not isinstance(lora, dict):
        return None
    selected = lora.get(kind)
    return selected if isinstance(selected, dict) else None


def _rewire_model_reference(value: Any, old_ref: list[Any], new_ref: list[Any]) -> Any:
    if isinstance(value, dict):
        return {key: _rewire_model_reference(child, old_ref, new_ref) for key, child in value.items()}
    if isinstance(value, list):
        if value == old_ref:
            return copy.deepcopy(new_ref)
        return [_rewire_model_reference(child, old_ref, new_ref) for child in value]
    return value


def install_lora_chain(
    manifest: dict[str, Any], axes: Iterable[dict[str, Any]], kind: str
) -> dict[tuple[str, str], str]:
    """Install every arm-compatible candidate LoRA at zero strength.

    Jobs turn on at most one loader through substitutions. Stacking zero-strength
    loaders keeps every grid cell on one shared workflow and therefore one pod.
    """
    specs: list[tuple[str, str, dict[str, Any]]] = []
    for axis in axes:
        for variant in axis["variants"]:
            spec = _lora_spec(variant, kind)
            if spec is None:
                continue
            specs.append((str(axis["axis"]), str(variant["name"]), spec))
    if not specs:
        return {}

    workflow = manifest.get("workflow")
    if not isinstance(workflow, dict):
        raise GridError("LoRA grids require an inline workflow object")
    model_loaders = [key for key, node in workflow.items() if node.get("class_type") == "UNETLoader"]
    if len(model_loaders) != 1:
        raise GridError("LoRA grids require exactly one UNETLoader")
    source_ref: list[Any] = [str(model_loaders[0]), 0]
    original_nodes = list(workflow)
    numeric_ids = [int(key) for key in workflow if str(key).isdigit()]
    next_id = max(numeric_ids, default=0) + 1
    loader_ids: dict[tuple[str, str], str] = {}
    models = manifest.setdefault("models", [])

    current_ref = source_ref
    for axis_name, variant_name, spec in specs:
        node_id = str(next_id)
        next_id += 1
        local_name = Path(str(spec["filename"])).name
        workflow[node_id] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": current_ref,
                "lora_name": local_name,
                "strength_model": 0.0,
            },
        }
        model_record = {
            "repo_id": spec["repo_id"],
            "filename": spec["filename"],
            "destination_dir": "/workspace/ComfyUI/models/loras",
        }
        if model_record not in models:
            models.append(model_record)
        loader_ids[(axis_name, variant_name)] = node_id
        current_ref = [node_id, 0]

    for node_id in original_nodes:
        workflow[node_id] = _rewire_model_reference(workflow[node_id], source_ref, current_ref)
    return loader_ids


def build_manifest(
    arm_path: Path, axis_paths: list[Path], base_job_name: str
) -> dict[str, Any]:
    if not axis_paths:
        raise GridError("at least one --axis is required")
    manifest = load_document(arm_path)
    axes = [load_axis(path) for path in axis_paths]
    if len({str(axis["axis"]) for axis in axes}) != len(axes):
        raise GridError("the same axis was supplied more than once")
    kind = arm_kind(manifest)
    base_job = find_base_job(manifest, base_job_name)
    base_prompt = read_prompt(base_job)

    manifest = copy.deepcopy(manifest)
    manifest["readiness_timeout_seconds"] = 480
    loader_ids = install_lora_chain(manifest, axes, kind)
    jobs: list[dict[str, Any]] = []
    for axis in axes:
        for variant in axis["variants"]:
            varied_prompt = apply_variant(base_prompt, axis, variant)
            for seed in axis["seeds"]:
                job = copy.deepcopy(base_job)
                job["seed"] = int(seed)
                job["output_name"] = output_name(axis["axis"], variant["name"], seed)
                job["expected_images"] = 1
                write_prompt(job, varied_prompt)
                for key, node_id in loader_ids.items():
                    weight = 0.0
                    if key == (str(axis["axis"]), str(variant["name"])):
                        spec = _lora_spec(variant, kind)
                        weight = float(spec["weight"]) if spec else 0.0
                    job.setdefault("substitutions", []).append({
                        "node_id": node_id,
                        "field": "strength_model",
                        "value": weight,
                    })
                job["calibration"] = {
                    "axis": axis["axis"],
                    "variant": variant["name"],
                    "arm": kind,
                    "lora_applied": _lora_spec(variant, kind) is not None,
                }
                jobs.append(job)
    manifest["jobs"] = jobs
    manifest["max_minutes"] = math.ceil(8 + len(jobs) * 70 / 60)
    manifest["price_usd_per_hour"] = min(float(manifest["price_usd_per_hour"]), 0.80)
    manifest["calibration"] = {
        "base_job": base_job_name,
        "axes": [axis["axis"] for axis in axes],
        "cell_seconds": 70,
        "bootstrap_minutes": 8,
    }
    harness = _load_harness()
    # Validate the generated in-memory structure through the same function used by
    # the harness dry-run entry point before writing it.
    harness.require_manifest(manifest, arm_path)
    return manifest


def write_manifest(manifest: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _find_cell_image(run_dir: Path, name: str) -> Path | None:
    for suffix in IMAGE_SUFFIXES:
        candidate = run_dir / f"{name}{suffix}"
        if candidate.is_file():
            return candidate
    return None


def build_sheet(run_dir: Path, axis_path: Path, out_path: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    axis = load_axis(axis_path)
    variants = axis["variants"]
    seeds = axis["seeds"]
    cell_w, cell_h, header_h, label_w = 220, 220, 34, 170
    canvas = Image.new(
        "RGB",
        (label_w + cell_w * len(seeds), header_h + cell_h * len(variants)),
        "#f4f1ea",
    )
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    draw.text((8, 10), str(axis["axis"]), fill="black", font=font)
    for column, seed in enumerate(seeds):
        draw.text((label_w + column * cell_w + 8, 10), f"seed {seed}", fill="black", font=font)
    for row, variant in enumerate(variants):
        y = header_h + row * cell_h
        draw.text((8, y + 8), str(variant["name"]), fill="black", font=font)
        name = output_name(axis["axis"], variant["name"], seeds[0])
        for column, seed in enumerate(seeds):
            name = output_name(axis["axis"], variant["name"], seed)
            path = _find_cell_image(run_dir, name)
            box = (label_w + column * cell_w, y, label_w + (column + 1) * cell_w, y + cell_h)
            draw.rectangle(box, outline="#777777", width=1)
            if path is None:
                draw.text((box[0] + 8, box[1] + 8), "missing", fill="#9b1c1c", font=font)
                continue
            with Image.open(path) as source:
                tile = source.convert("RGB")
                tile.thumbnail((cell_w - 12, cell_h - 12), Image.Resampling.LANCZOS)
                x = box[0] + (cell_w - tile.width) // 2
                yy = box[1] + (cell_h - tile.height) // 2
                canvas.paste(tile, (x, yy))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, format="JPEG", quality=92, optimize=False, progressive=False)


CELL_RE = re.compile(r"^cal__(?P<axis>[a-z0-9-]+)__(?P<variant>[a-z0-9-]+)__seed_(?P<seed>\d+)$")


def build_table(run_dirs: list[Path], out_path: Path) -> None:
    cells: dict[str, list[str]] = defaultdict(list)
    for run_dir in run_dirs:
        manifest_path = run_dir / "manifest.json"
        if not manifest_path.is_file():
            raise GridError(f"missing harness output manifest: {manifest_path}")
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        for image in data.get("images", []):
            image_id = str(image.get("image_id", ""))
            match = CELL_RE.match(image_id)
            if match:
                cells[match.group("axis")].append(str(image.get("path") or f"{image_id}.png"))
    if not cells:
        raise GridError("no calibration cells found in run directories")
    lines = ["# Lever table v2 — findings skeleton", ""]
    for axis_name in sorted(cells):
        lines.extend([
            f"## {axis_name}",
            "",
            "### Cells",
            "",
            *[f"- `{name}`" for name in sorted(set(cells[axis_name]))],
            "",
            "### Finding",
            "",
            "_Pending review._",
            "",
            "### Setting of record",
            "",
            "_Pending review._",
            "",
            "### Negative results",
            "",
            "_Pending review._",
            "",
        ])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build", help="build one merged calibration manifest")
    build.add_argument("--arm", type=Path, required=True)
    build.add_argument("--axis", type=Path, action="append", required=True)
    build.add_argument("--base-job", required=True)
    build.add_argument("--out", type=Path, required=True)
    sheet = sub.add_parser("sheet", help="render a labelled axis contact sheet")
    sheet.add_argument("--run-dir", type=Path, required=True)
    sheet.add_argument("--axis", type=Path, required=True)
    sheet.add_argument("--out", type=Path, required=True)
    table = sub.add_parser("table", help="build a lever-table findings skeleton")
    table.add_argument("--run-dirs", type=Path, nargs="+", required=True)
    table.add_argument("--out", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "build":
            manifest = build_manifest(args.arm, args.axis, args.base_job)
            write_manifest(manifest, args.out)
            print(
                f"built {len(manifest['jobs'])} cells across "
                f"{len(manifest['calibration']['axes'])} axis/axes; "
                f"max_minutes={manifest['max_minutes']}"
            )
            if manifest["max_minutes"] > 60:
                print(
                    "warning: estimated runtime exceeds the harness 60-minute hard cap; "
                    "split axes before a live run",
                    file=sys.stderr,
                )
        elif args.command == "sheet":
            build_sheet(args.run_dir, args.axis, args.out)
            print(f"wrote {args.out}")
        else:
            build_table(args.run_dirs, args.out)
            print(f"wrote {args.out}")
        return 0
    except (GridError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"grid error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
