"""Assemble the dataset-to-training bridge (brief T1-FC finding 9).

The module-10 replication (`expand/`) returns bare PNGs on a RunPod pod. Nothing
in the repo previously turned an operator's human-approved subset of those images
into the captioned, ready-to-upload folder `train/runs/creator-001-tensor-dataset/`
that `creator-001-tensor-train.yaml` uploads from. This is that one owned assembly
step, run locally (never on a pod) after the operator has graded the dataset shards.

Inputs (exactly one of):
  --approved-cells   a JSON file the operator's grading produces:
                      `[{"image": "<path>", "caption": "<text>"}, ...]`
                      Used with `--mode provided` (the default for this input).
  --source-dir       a directory of already-approved images; captions are
                      generated per `--mode`.

Caption modes:
  provided   caption text comes from the approved-cells JSON, one per image.
             Requires `--approved-cells`; every image needs a non-empty caption.
  class      every image gets the single word `--caption-word` (default
             `woman`, matching the manifest's `training.caption_word`).
             Requires `--source-dir`.
  qwen3vl    documented hook for module 11's Qwen3-VL-8B auto-captioning.
             NOT IMPLEMENTED here — this tool never runs a model. Calling it
             raises DatasetBuildError so a live run cannot silently proceed
             on an empty/garbage caption set. See TENSOR-TRAINING.md
             "Captioning" for what an implementation would need to match
             (Qwen/Qwen3-VL-8B-Instruct, float8, max res 512, 128 new tokens).

Outputs, all under `--out` (normally `train/runs/creator-001-tensor-dataset/`):
  NN.png             one 1-indexed, zero-padded (width >= 2) PNG per approved
                      image, re-encoded through Pillow so every output is a
                      real PNG regardless of the source format.
  NN.txt              same-basename caption sidecar, UTF-8, trailing newline.
  dataset_manifest.json  {"count", "caption_mode", "files": [{"image",
                      "caption_file", "sha256"}, ...]} — bookkeeping for this
                      dataset build. NOT `training.json`: that filename is the
                      ai-toolkit trainer config `render_aitoolkit_config.py`
                      writes into this same directory as TENSOR-TRAINING.md's
                      step 2, and it is uploaded to the pod as
                      `training.caption_mode`'s config; writing this tool's
                      bookkeeping under the same name would let step 2 silently
                      clobber it (or vice versa, depending on run order) and
                      neither script would notice. See TENSOR-TRAINING.md.
  _dataset.ready      empty marker, written LAST — only after every image,
                      caption, and dataset_manifest.json is on disk and
                      verified, matching the upload contract's "marker last"
                      rule that `pod/runpod_run.py` and the harness enforce.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from PIL import Image

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
CAPTION_MODES = ("provided", "class", "qwen3vl")
READY_MARKER = "_dataset.ready"
MANIFEST_NAME = "dataset_manifest.json"


class DatasetBuildError(ValueError):
    pass


def load_approved_cells(path: Path) -> list[dict[str, Any]]:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise DatasetBuildError(f"cannot read approved-cells file: {path}") from exc
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise DatasetBuildError(f"approved-cells file is not valid JSON: {path}") from exc
    if not isinstance(value, list) or not value:
        raise DatasetBuildError("approved-cells JSON must be a non-empty list")
    for index, cell in enumerate(value):
        if (not isinstance(cell, dict)
                or not isinstance(cell.get("image"), str) or not cell["image"].strip()
                or not isinstance(cell.get("caption"), str) or not cell["caption"].strip()):
            raise DatasetBuildError(
                f"approved-cells entry {index} must be an object with non-empty "
                "string 'image' and 'caption'"
            )
    return value


def _resolve_image(raw: str, base: Path) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        path = base / path
    resolved = path.resolve()
    if not resolved.is_file():
        raise DatasetBuildError(f"approved image not found: {raw}")
    return resolved


def _collect_cells_provided(approved_cells: Path) -> list[tuple[Path, str]]:
    cells = load_approved_cells(approved_cells)
    base = approved_cells.resolve().parent
    return [(_resolve_image(cell["image"], base), cell["caption"].strip()) for cell in cells]


def _collect_cells_class(source_dir: Path, caption_word: str) -> list[tuple[Path, str]]:
    if not source_dir.is_dir():
        raise DatasetBuildError(f"--source-dir is not a directory: {source_dir}")
    images = sorted(
        p for p in source_dir.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )
    if not images:
        raise DatasetBuildError(f"no approved images found in {source_dir}")
    if not caption_word.strip() or any(ch.isspace() for ch in caption_word):
        raise DatasetBuildError("--caption-word must be a single non-empty token")
    return [(image.resolve(), caption_word) for image in images]


def build_training_set(
    *,
    approved_cells: Path | None,
    source_dir: Path | None,
    caption_mode: str,
    out_dir: Path,
    caption_word: str = "woman",
) -> dict[str, Any]:
    if caption_mode not in CAPTION_MODES:
        raise DatasetBuildError(f"unknown caption_mode: {caption_mode!r}")
    if caption_mode == "qwen3vl":
        # Documented hook only. See the module docstring: never runs a model here.
        raise DatasetBuildError(
            "caption_mode 'qwen3vl' is not implemented — it is a documented hook for "
            "module 11's Qwen3-VL-8B auto-captioning (float8, max res 512, 128 new "
            "tokens). Use 'provided' (operator-graded captions) or 'class' (single-word) "
            "until an implementation lands."
        )
    if caption_mode == "provided":
        if approved_cells is None or source_dir is not None:
            raise DatasetBuildError("caption_mode 'provided' requires --approved-cells only")
        cells = _collect_cells_provided(approved_cells)
    else:  # class
        if source_dir is None or approved_cells is not None:
            raise DatasetBuildError("caption_mode 'class' requires --source-dir only")
        cells = _collect_cells_class(source_dir, caption_word)

    out_dir.mkdir(parents=True, exist_ok=True)
    width = max(2, len(str(len(cells))))
    files: list[dict[str, Any]] = []
    for index, (image_path, caption) in enumerate(cells, start=1):
        stem = f"{index:0{width}d}"
        image_out = out_dir / f"{stem}.png"
        caption_out = out_dir / f"{stem}.txt"
        with Image.open(image_path) as image:
            image.convert("RGB").save(image_out, format="PNG")
        caption_out.write_text(caption.strip() + "\n", encoding="utf-8")
        digest = hashlib.sha256(image_out.read_bytes()).hexdigest()
        files.append({
            "image": image_out.name,
            "caption_file": caption_out.name,
            "sha256": digest,
        })

    manifest = {
        "count": len(files),
        "caption_mode": caption_mode,
        "files": files,
    }
    manifest_path = out_dir / MANIFEST_NAME
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    # Verify every image/sidecar pair is really on disk before the ready marker —
    # the review's own fix text for finding 9 ("verify every image/sidecar pair,
    # and write _dataset.ready last").
    for entry in files:
        if not (out_dir / entry["image"]).is_file() or not (out_dir / entry["caption_file"]).is_file():
            raise DatasetBuildError(f"post-write verification failed for {entry['image']}")

    ready_path = out_dir / READY_MARKER
    ready_path.write_text("", encoding="utf-8")
    return manifest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--approved-cells", type=Path, help="JSON list of {image, caption}")
    parser.add_argument("--source-dir", type=Path, help="directory of approved images")
    parser.add_argument(
        "--mode", choices=CAPTION_MODES, default=None,
        help="caption_mode; defaults to 'provided' with --approved-cells, "
             "'class' with --source-dir",
    )
    parser.add_argument("--caption-word", default="woman")
    parser.add_argument("--out", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    mode = args.mode
    if mode is None:
        if args.approved_cells is not None:
            mode = "provided"
        elif args.source_dir is not None:
            mode = "class"
        else:
            print("build-training-set error: one of --approved-cells or --source-dir is required",
                  file=sys.stderr)
            return 2
    try:
        manifest = build_training_set(
            approved_cells=args.approved_cells,
            source_dir=args.source_dir,
            caption_mode=mode,
            out_dir=args.out,
            caption_word=args.caption_word,
        )
    except DatasetBuildError as exc:
        print(f"build-training-set error: {exc}", file=sys.stderr)
        return 2
    print(f"built {manifest['count']} dataset cell(s) in {args.out} (caption_mode={mode})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
