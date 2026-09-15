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
  --images-from      one or more directories of already-approved images
                      (`--mode class` only, tonight's finding-9 path). Images
                      are collected in argument order, sorted by filename
                      within each directory, then concatenated — this is how
                      several run dirs (a dependency smoke plus dataset
                      shards) become one dataset. Combine with `--exclude` to
                      drop specific source filenames (matched by full
                      filename or bare stem) from every directory before the
                      images are numbered and re-encoded.

Caption modes:
  provided   caption text comes from the approved-cells JSON, one per image.
             Requires `--approved-cells`; every image needs a non-empty caption.
  class      every image gets the single word `--caption-word` (default
             `woman`, matching the manifest's `training.caption_word`).
             Requires `--source-dir`.
  qwen3vl    module 11's Qwen3-VL-8B-Instruct auto-captioning (float8, max res
             512, 128 new tokens — TENSOR-TRAINING.md "Captioning"), shaped as
             a pod job over this tool's own already-collected image list: this
             tool still never runs a model itself (GUARDRAILS: no ambient pod
             spend from a "local, never a pod" tool) — it builds the job
             description (`qwen3vl_caption_job`) and calls the caller-supplied
             `job_runner(job) -> [caption body, ...]` (one raw description per
             image, same order), which is what actually talks to a pod in a
             real run. `job_runner` and `trigger` (F4) are REQUIRED for this
             mode; there is no default live dispatcher here. Requires
             `--source-dir` or `--images-from`, like `class`. Every written
             caption is `"<trigger> <caption-word>, <model body>"` — the same
             `"<trigger> <class>, "` opening `figment_train.py`'s
             `_persona_trigger_clause` composes for tester/gen prompts, so a
             descriptive caption is self-contained (identity-associated
             whether or not DOP's own trigger_word injection is on). Each
             manifest file entry additionally carries `caption_sha256`
             (sha256 of the written caption text, trailing newline included)
             so a captioning run is auditable per row.

Outputs, all under `--out` (normally `train/runs/creator-001-tensor-dataset/`):
  NN.png             one 1-indexed, zero-padded (width >= 2) PNG per approved
                      image, re-encoded through Pillow so every output is a
                      real PNG regardless of the source format.
  NN.txt              same-basename caption sidecar, UTF-8, trailing newline.
  dataset_manifest.json  {"count", "caption_mode", "files": [{"image",
                      "caption_file", "sha256"}, ...]} — bookkeeping for this
                      dataset build (`qwen3vl` additionally carries
                      "caption_sha256" per file; other modes' shape is
                      unchanged). NOT `training.json`: that filename is the
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
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any, Callable

from PIL import Image

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
CAPTION_MODES = ("provided", "class", "qwen3vl")
READY_MARKER = "_dataset.ready"
MANIFEST_NAME = "dataset_manifest.json"
TRAINING_JSON_NAME = "training.json"

HERE = Path(__file__).resolve().parent
RENDER_MODULE_PATH = HERE / "render_aitoolkit_config.py"

# F4: module 11's captioner, ported as a pod job (TENSOR-TRAINING.md "Captioning").
QWEN3VL_CAPTION_MODEL_ID = "Qwen/Qwen3-VL-8B-Instruct"
QWEN3VL_CAPTION_SETTINGS = {
    "dtype": "float8", "max_resolution": 512, "max_new_tokens": 128,
}
# Same shape figment_train.py's own trigger validation uses (training_config.py
# SAFE_TRIGGER) -- a caption-formatting helper here should refuse the same malformed
# triggers the training config itself would refuse, not accept a wider set.
_SAFE_TRIGGER = re.compile(r"^[a-z][a-z0-9]*$")

# One raw, untriggered caption body per image, same order as the job's "images" list.
# The real dispatcher (pod-side, not this tool -- see the qwen3vl docstring above)
# lives elsewhere; tests inject a fake one.
JobRunner = Callable[[dict[str, Any]], list[str]]


class DatasetBuildError(ValueError):
    pass


def _load_render_module():
    spec = importlib.util.spec_from_file_location(
        "figment_render_aitoolkit_config", RENDER_MODULE_PATH,
    )
    if spec is None or spec.loader is None:
        raise DatasetBuildError(f"cannot load render module: {RENDER_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _check_existing_training_json(out_dir: Path) -> None:
    """Refuse to write `_dataset.ready` next to a `training.json` with a bad pod path.

    `render_aitoolkit_config.py` (TENSOR-TRAINING.md step 3) normally writes
    `training.json` into this same directory *after* this tool runs, so on a
    first build there is usually nothing here yet. But re-running this tool
    over a dataset dir that already carries a previously-rendered config must
    not leave a stale, MSYS-mangled, or otherwise bad pod path sitting next to
    a freshly written ready marker — that is exactly the shape of the bug that
    shipped `C:/Program Files/Git/workspace/...` to the pod as `folder_path`.
    Validates with the same guard `render_aitoolkit_config.py` applies to a
    config it renders itself; see that module's `validate_rendered_pod_paths`.
    """
    training_json = out_dir / TRAINING_JSON_NAME
    if not training_json.is_file():
        return
    try:
        config = json.loads(training_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DatasetBuildError(
            f"cannot read existing {TRAINING_JSON_NAME} in {out_dir}: {exc}"
        ) from exc
    render_module = _load_render_module()
    try:
        render_module.validate_rendered_pod_paths(config)
    except render_module.PodPathError as exc:
        raise DatasetBuildError(
            f"existing {TRAINING_JSON_NAME} in {out_dir} carries a bad pod path: {exc}"
        ) from exc


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


def _validate_caption_word(caption_word: str) -> None:
    if not caption_word.strip() or any(ch.isspace() for ch in caption_word):
        raise DatasetBuildError("--caption-word must be a single non-empty token")


def _collect_cells_class(source_dir: Path, caption_word: str) -> list[tuple[Path, str]]:
    if not source_dir.is_dir():
        raise DatasetBuildError(f"--source-dir is not a directory: {source_dir}")
    images = sorted(
        p for p in source_dir.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )
    if not images:
        raise DatasetBuildError(f"no approved images found in {source_dir}")
    _validate_caption_word(caption_word)
    return [(image.resolve(), caption_word) for image in images]


def _collect_cells_images_from(
    source_dirs: list[Path], caption_word: str, exclude: list[str] | None,
) -> list[tuple[Path, str]]:
    if not source_dirs:
        raise DatasetBuildError("--images-from requires at least one directory")
    _validate_caption_word(caption_word)
    excluded = {name.strip() for name in (exclude or []) if name.strip()}
    cells: list[tuple[Path, str]] = []
    for source_dir in source_dirs:
        if not source_dir.is_dir():
            raise DatasetBuildError(f"--images-from is not a directory: {source_dir}")
        images = sorted(
            p for p in source_dir.iterdir()
            if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
            and p.name not in excluded and p.stem not in excluded
        )
        cells.extend((image.resolve(), caption_word) for image in images)
    if not cells:
        raise DatasetBuildError(
            "no approved images found across --images-from directories "
            "(after applying --exclude, if given)"
        )
    return cells


def _validate_trigger(trigger: str) -> None:
    if not isinstance(trigger, str) or not _SAFE_TRIGGER.fullmatch(trigger):
        raise DatasetBuildError(
            "--trigger must be a lowercase alphanumeric token (matches "
            "training_config.py's own SAFE_TRIGGER) when caption_mode is 'qwen3vl'"
        )


def qwen3vl_caption_job(image_paths: list[Path]) -> dict[str, Any]:
    """The pod-job description for module 11's Qwen3-VL-8B-Instruct auto-captioning
    (TENSOR-TRAINING.md "Captioning"): model id + settings this tool documents but never
    runs itself, plus the exact image list (order load-bearing -- the runner's returned
    captions are matched back to images positionally, same contract every other
    `job_runner` in this pipeline uses for its own `jobs`/`substitutions` lists)."""
    return {
        "model": QWEN3VL_CAPTION_MODEL_ID,
        "settings": dict(QWEN3VL_CAPTION_SETTINGS),
        "images": [str(path) for path in image_paths],
    }


def _collect_cells_qwen3vl(
    source_dir: Path | None,
    images_from: list[Path] | None,
    exclude: list[str] | None,
    *,
    trigger: str,
    caption_word: str,
    job_runner: JobRunner | None,
) -> list[tuple[Path, str]]:
    """Collect the approved image list exactly like `class` mode (same
    `--source-dir`/`--images-from`/`--exclude` contract), then replace the bare
    class-word caption with a Qwen3-VL-8B-Instruct description, run as a pod job (F4)
    rather than in this process. `trigger`/`job_runner` are validated here, before any
    image is touched, so a misconfigured caller fails closed before spending anything."""
    if job_runner is None:
        raise DatasetBuildError(
            "caption_mode 'qwen3vl' requires a job_runner -- this tool never talks to "
            "a pod itself (GUARDRAILS: build_training_set.py runs locally, never on a "
            "pod); pass the real dispatcher in a live run, or a fake one in tests"
        )
    _validate_trigger(trigger)
    _validate_caption_word(caption_word)
    if source_dir is not None:
        images = [image for image, _ in _collect_cells_class(source_dir, caption_word)]
    else:
        images = [
            image for image, _ in
            _collect_cells_images_from(images_from or [], caption_word, exclude)
        ]

    job = qwen3vl_caption_job(images)
    bodies = job_runner(job)
    if not isinstance(bodies, list) or len(bodies) != len(images):
        raise DatasetBuildError(
            f"job_runner must return exactly one caption per image "
            f"({len(images)} images, got {len(bodies) if isinstance(bodies, list) else bodies!r})"
        )
    captions: list[str] = []
    for image, body in zip(images, bodies):
        if not isinstance(body, str) or not body.strip():
            raise DatasetBuildError(f"job_runner returned an empty caption for {image}")
        stripped = body.strip()
        # m10/MINOR 9 (REVIEW): refuse a caption body containing a newline/control
        # character or longer than 500 chars -- never trust a pod's raw text output
        # into a caption file (and, downstream, into a training/gen prompt) without
        # this floor, whatever job_runner produced it (the live pod dispatcher or a
        # test fake alike). DEL (U+007F) and the Unicode line/paragraph separators
        # (U+2028, U+2029) are control-adjacent line breaks `ord(ch) < 32` alone
        # misses -- both can split a prompt across lines exactly like a raw \n would.
        if len(stripped) > 500 or any(
            ord(ch) < 32 or ord(ch) == 127 or ch in (" ", " ")
            for ch in stripped
        ):
            raise DatasetBuildError(
                f"job_runner returned an invalid caption body for {image} (over 500 "
                "chars or contains a newline/control character)"
            )
        # Same "<trigger> <class>, " opening figment_train.py's own
        # _persona_trigger_clause composes for tester/gen prompts -- a descriptive
        # caption stays identity-associated whether or not DOP's trigger_word
        # injection is on (see the qwen3vl docstring above).
        captions.append(f"{trigger} {caption_word}, {stripped}")
    return list(zip(images, captions))


def build_training_set(
    *,
    approved_cells: Path | None,
    source_dir: Path | None,
    caption_mode: str,
    out_dir: Path,
    caption_word: str = "woman",
    images_from: list[Path] | None = None,
    exclude: list[str] | None = None,
    trigger: str | None = None,
    job_runner: JobRunner | None = None,
) -> dict[str, Any]:
    if caption_mode not in CAPTION_MODES:
        raise DatasetBuildError(f"unknown caption_mode: {caption_mode!r}")
    if exclude and images_from is None:
        raise DatasetBuildError("--exclude requires --images-from")
    if caption_mode == "provided":
        if approved_cells is None or source_dir is not None or images_from is not None:
            raise DatasetBuildError("caption_mode 'provided' requires --approved-cells only")
        cells = _collect_cells_provided(approved_cells)
    elif caption_mode == "qwen3vl":
        if approved_cells is not None:
            raise DatasetBuildError(
                "caption_mode 'qwen3vl' requires --source-dir or --images-from, "
                "not --approved-cells"
            )
        if (source_dir is None) == (images_from is None):
            raise DatasetBuildError(
                "caption_mode 'qwen3vl' requires exactly one of --source-dir or --images-from"
            )
        cells = _collect_cells_qwen3vl(
            source_dir, images_from, exclude,
            trigger=trigger, caption_word=caption_word, job_runner=job_runner,
        )
    else:  # class
        if approved_cells is not None:
            raise DatasetBuildError(
                "caption_mode 'class' requires --source-dir or --images-from, not --approved-cells"
            )
        if (source_dir is None) == (images_from is None):
            raise DatasetBuildError(
                "caption_mode 'class' requires exactly one of --source-dir or --images-from"
            )
        if source_dir is not None:
            cells = _collect_cells_class(source_dir, caption_word)
        else:
            cells = _collect_cells_images_from(images_from, caption_word, exclude)

    out_dir.mkdir(parents=True, exist_ok=True)
    width = max(2, len(str(len(cells))))
    files: list[dict[str, Any]] = []
    for index, (image_path, caption) in enumerate(cells, start=1):
        stem = f"{index:0{width}d}"
        image_out = out_dir / f"{stem}.png"
        caption_out = out_dir / f"{stem}.txt"
        with Image.open(image_path) as image:
            image.convert("RGB").save(image_out, format="PNG")
        caption_text = caption.strip() + "\n"
        # newline="" keeps the written bytes exactly caption_text.encode("utf-8") on
        # every platform -- without it, Python's text-mode write translates "\n" to
        # "\r\n" on Windows, so a caption_sha256 computed from caption_text (below)
        # would silently mismatch the real on-disk bytes lineage.dataset_subject
        # verifies (M4(b)).
        caption_out.write_text(caption_text, encoding="utf-8", newline="")
        digest = hashlib.sha256(image_out.read_bytes()).hexdigest()
        entry = {
            "image": image_out.name,
            "caption_file": caption_out.name,
            "sha256": digest,
        }
        if caption_mode == "qwen3vl":
            # F4/M4(b): per-row audit trail for a model-generated caption -- provided/
            # class captions are operator/config text, not worth hashing the same way.
            # Hashed from the bytes actually written to disk, not the pre-write
            # string, so this can never silently drift from what
            # lineage.dataset_subject re-verifies.
            entry["caption_sha256"] = hashlib.sha256(caption_out.read_bytes()).hexdigest()
        files.append(entry)

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

    # Fail closed rather than write a ready marker next to a config the pod
    # cannot use — see _check_existing_training_json.
    _check_existing_training_json(out_dir)

    ready_path = out_dir / READY_MARKER
    ready_path.write_text("", encoding="utf-8")
    return manifest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--approved-cells", type=Path, help="JSON list of {image, caption}")
    parser.add_argument("--source-dir", type=Path, help="directory of approved images")
    parser.add_argument(
        "--images-from", nargs="+", type=Path, metavar="DIR",
        help="one or more directories of approved images (--mode class only); "
             "collected in argument order, sorted by filename within each directory",
    )
    parser.add_argument(
        "--exclude", nargs="+", metavar="NAME", default=None,
        help="source filenames (full name or bare stem) to drop from --images-from",
    )
    parser.add_argument(
        "--mode", choices=CAPTION_MODES, default=None,
        help="caption_mode; defaults to 'provided' with --approved-cells, "
             "'class' with --source-dir or --images-from",
    )
    parser.add_argument("--caption-word", default="woman")
    parser.add_argument(
        "--trigger",
        help="required for --mode qwen3vl: prefixed onto every generated caption as "
             "'<trigger> <caption-word>, ...'",
    )
    parser.add_argument("--out", type=Path, help="required unless --plan-root is given")
    parser.add_argument(
        "--plan-root", type=Path, default=None,
        help="M4: --mode qwen3vl only. PLAN (never run) one qwen3vl captioning pod "
             "job under this plan root and print its manifest/argv -- this tool still "
             "never talks to a pod itself (GUARDRAILS); running the planned argv, "
             "downloading captions.json, and feeding it back into this tool's own "
             "local assembly is a separate step (figment_train.py's "
             "_live_qwen3vl_job_runner). Requires --creator and --trigger.",
    )
    parser.add_argument("--creator", help="required with --plan-root")
    parser.add_argument("--pod-class", default="l40s", help="only meaningful with --plan-root")
    parser.add_argument("--ledger-dir", type=Path, help="only meaningful with --plan-root")
    parser.add_argument(
        "--skip-pin-verify", action="store_true",
        help="only meaningful with --plan-root; offline/test use only",
    )
    return parser


def _figment_train_module():
    """Lazy-load ../figment_train.py -- only touched by --plan-root (--mode qwen3vl's
    plan-only path). This tool otherwise never imports it: figment_train.py already
    loads THIS module the same way, via _build_set_module() -- a two-way lazy
    relationship (importlib, no top-level import) that avoids a hard circular
    dependency between the two files."""
    figment_train_path = HERE.parent / "figment_train.py"
    spec = importlib.util.spec_from_file_location(
        "_build_training_set_figment_train", figment_train_path,
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    mode = args.mode
    if mode is None:
        if args.approved_cells is not None:
            mode = "provided"
        elif args.source_dir is not None or args.images_from is not None:
            mode = "class"
        elif args.plan_root is not None:
            mode = "qwen3vl"
        else:
            print(
                "build-training-set error: one of --approved-cells, --source-dir, "
                "--images-from, or --plan-root is required",
                file=sys.stderr,
            )
            return 2

    if args.plan_root is not None:
        if mode != "qwen3vl":
            print("build-training-set error: --plan-root requires --mode qwen3vl", file=sys.stderr)
            return 2
        if not args.creator or not args.trigger:
            print("build-training-set error: --plan-root requires --creator and --trigger", file=sys.stderr)
            return 2
        if (args.source_dir is None) == (args.images_from is None):
            print(
                "build-training-set error: --plan-root requires exactly one of "
                "--source-dir or --images-from",
                file=sys.stderr,
            )
            return 2
        if args.source_dir is not None:
            images = [image for image, _ in _collect_cells_class(args.source_dir, args.caption_word)]
        else:
            images = [
                image for image, _ in
                _collect_cells_images_from(args.images_from, args.caption_word, args.exclude)
            ]
        figment_train = _figment_train_module()
        try:
            planned = figment_train.plan_qwen3vl_caption(
                args.creator, args.trigger, images, args.plan_root,
                pod_class=args.pod_class, ledger_dir=args.ledger_dir,
                skip_pin_verify=args.skip_pin_verify,
            )
        except figment_train.FigmentTrainError as exc:
            print(f"build-training-set error: {exc}", file=sys.stderr)
            return 2
        print(
            f"planned qwen3vl caption job for {len(images)} image(s) at "
            f"{args.plan_root.resolve() / planned['manifest']} (ceiling_usd=${planned['ceiling_usd']})"
        )
        print(planned["cli"])
        return 0

    if args.out is None:
        print("build-training-set error: --out is required unless --plan-root is given", file=sys.stderr)
        return 2
    try:
        manifest = build_training_set(
            approved_cells=args.approved_cells,
            source_dir=args.source_dir,
            caption_mode=mode,
            out_dir=args.out,
            caption_word=args.caption_word,
            images_from=args.images_from,
            exclude=args.exclude,
            trigger=args.trigger,
            # No CLI-wired LIVE dispatcher exists for this direct-build path -- a CLI
            # --mode qwen3vl run without --plan-root fails closed with the same
            # "requires a job_runner" error the library call would, since this tool
            # never talks to a pod itself. Use --plan-root to plan the pod job, then
            # figment_train.py's own apply-rulings dataset assembly (or a script that
            # imports _live_qwen3vl_job_runner directly) to actually run it.
            job_runner=None,
        )
    except DatasetBuildError as exc:
        print(f"build-training-set error: {exc}", file=sys.stderr)
        return 2
    print(f"built {manifest['count']} dataset cell(s) in {args.out} (caption_mode={mode})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
