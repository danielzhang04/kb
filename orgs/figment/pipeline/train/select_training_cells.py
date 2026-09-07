#!/usr/bin/env python3
"""Select training cells from ALREADY-JUDGED evidence -- Path A "train-first"
(r24 method 4 + r21 DOP + r25 causes #4/#5).

The 2000-step run trained on an uncurated dataset shard: every cell the module-10
replication happened to generate, approved in bulk once at least 20 were on hand
(`figment_train.py apply_rulings`, stage "dataset"). r25 cause #5 names this as a
likely driver of the identity/age drift the tester exposed, and cause #4 shows the
same run's OWN tester ranking never fed back into which checkpoint (or which input
cells) to trust. This script closes that loop for the dataset side: instead of a
fresh, ungraded ComfyUI batch, pick only the cells a judge run already rated closest
to the persona's own anchors, from every existing evidence set that has one --
`judge-calibration.json`'s per-set rows (`vlm_judge.calibrate`) and/or a stage's
`figment/gate@1` `gate.json` (`identity_gate.py`) -- and always keep the anchors
themselves, unscored, first.

Never draws from a set the operator has already labelled strangers
(`passport-candidates`, r20/r25) -- that exclusion cannot be overridden by any CLI
flag; see `NEVER_SETS`.

Output contract:
  selection.json      {"schema": "figment/training-selection@1", "thresholds",
                       "excluded_sets", "skipped", "anchors", "cells",
                       "counts_by_set", "total_images"} -- the full audit trail:
                       every candidate's source set and score, which sets were
                       skipped and why, and the final cap-per-set ordering.
  approved-cells.json  (optional, `--approved-cells-out`) the flat
                       `[{"image", "caption"}, ...]` list `build_training_set.py
                       --mode provided` reads directly.
  <dataset-out>/       (optional, `--dataset-out`) the captioned, ready-to-upload
                       folder itself -- this script calls `build_training_set.py`
                       directly rather than shelling out, so a single invocation
                       can select, caption, and materialize in one step.

Captions are always `"<trigger> <caption-word>"` (default caption-word "woman") --
the trigger token must be present for DOP's class substitution to have anything to
replace (r21 Q1; Ostris `ai-toolkit` `toolkit/config_modules.py` at the pinned
commit, see `training_config.py`'s DOP docstring for the exact citation).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")

DEFAULT_SAME_PERSON_MIN = 80.0
DEFAULT_AGE_DELTA_MAX = 2.0
DEFAULT_ARTIFACTS_MAX = 40.0

# Operator ruling (r20/r25): passport-candidates are labelled strangers by the operator,
# not by score -- some rows even clear a naive same_person floor (calibration:
# passport-candidates max same_person 68 is actually below our 80 default, but the
# exclusion must hold regardless of where thresholds are set). This can never be
# CLI-unexcluded; `build_selection` ORs any caller-supplied `exclude_sets` onto this.
NEVER_SETS = frozenset({"passport-candidates"})

HERE = Path(__file__).resolve().parent
BUILD_SET_MODULE_PATH = HERE / "build_training_set.py"


class SelectionError(ValueError):
    """A selection input could not be trusted (missing anchor images, bad JSON, ...)."""


def _load_build_set_module():
    name = "_figment_select_training_cells_build_set"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, BUILD_SET_MODULE_PATH)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise ImportError(f"cannot load {BUILD_SET_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _images_in(directory: Path) -> list[Path]:
    # Always resolved: candidates are written into selection.json and later into
    # approved-cells.json, which build_training_set.py resolves relative to ITS OWN
    # location -- a directory argument left relative to this script's cwd would
    # resolve to the wrong file once read back from a different working directory.
    directory = Path(directory).resolve()
    if not directory.is_dir():
        return []
    return sorted(
        path for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def _find_image(directory: Path, image_id: str) -> Path:
    directory = Path(directory).resolve()
    for extension in IMAGE_EXTENSIONS:
        candidate = directory / f"{image_id}{extension}"
        if candidate.is_file():
            return candidate
    raise SelectionError(f"no image file for {image_id!r} in {directory}")


# ---------------------------------------------------------------------------
# anchors -- always included, never scored/thresholded (they ARE the identity)
# ---------------------------------------------------------------------------


def anchor_cells(anchors_dir: Path) -> list[dict[str, Any]]:
    paths = _images_in(anchors_dir)
    if not paths:
        raise SelectionError(f"no anchor images found in {anchors_dir}")
    return [
        {
            "image_id": path.stem, "source_set": "anchors", "path": str(path),
            "same_person": None, "age_delta": None, "artifacts": None,
        }
        for path in paths
    ]


# ---------------------------------------------------------------------------
# candidate loaders -- judge-calibration.json (flat rows) and gate.json (nested
# "judge" scores per figment/gate@1)
# ---------------------------------------------------------------------------


def _row_scores(row: dict[str, Any]) -> tuple[float, float, float] | None:
    judge = row.get("judge", row)
    try:
        return (
            float(judge["same_person"]), float(judge["age_delta"]), float(judge["artifacts"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


def load_calibration_candidates(
    calibration_path: Path, image_dirs: dict[str, Path], *, exclude_sets: frozenset[str] = NEVER_SETS,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Every non-anchor, non-excluded set in a `vlm_judge.calibrate` document, resolved
    against the caller-supplied `image_dirs` (name -> directory). A set the calibration
    document carries but `image_dirs` has no entry for is SKIPPED, not an error -- this
    is how a set whose source images this tool cannot legally reach (e.g. one living
    under a restricted run-output tree) is left out cleanly rather than faked."""
    document = json.loads(Path(calibration_path).read_text(encoding="utf-8"))
    sets = document.get("sets", {})
    if not isinstance(sets, dict):
        raise SelectionError(f"{calibration_path}: 'sets' must be an object")
    candidates: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for name, data in sets.items():
        if name == "anchors" or name in exclude_sets:
            continue
        directory = image_dirs.get(name)
        if directory is None:
            skipped.append({"name": name, "reason": "no image directory supplied"})
            continue
        directory = Path(directory)
        for row in data.get("rows", []):
            scores = _row_scores(row)
            if scores is None:
                continue
            image_id = row["image_id"]
            try:
                path = _find_image(directory, image_id)
            except SelectionError:
                skipped.append({"name": name, "image_id": image_id, "reason": "image file not found"})
                continue
            same_person, age_delta, artifacts = scores
            candidates.append({
                "image_id": image_id, "source_set": name, "path": str(path),
                "same_person": same_person, "age_delta": age_delta, "artifacts": artifacts,
            })
    return candidates, skipped


def load_gate_candidates(
    gate_path: Path, source_set: str, images_dir: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """One `figment/gate@1` `gate.json`'s rows, resolved against `images_dir`. Scores come
    from each row's nested `judge` object -- the same same_person/age_delta/artifacts
    triple the calibration loader reads, just nested under the gate's own verdict."""
    document = json.loads(Path(gate_path).read_text(encoding="utf-8"))
    rows = document.get("rows", [])
    if not isinstance(rows, list):
        raise SelectionError(f"{gate_path}: 'rows' must be a list")
    images_dir = Path(images_dir)
    candidates: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for row in rows:
        scores = _row_scores(row)
        if scores is None:
            continue
        image_id = row["image_id"]
        try:
            path = _find_image(images_dir, image_id)
        except SelectionError:
            skipped.append({"name": source_set, "image_id": image_id, "reason": "image file not found"})
            continue
        same_person, age_delta, artifacts = scores
        candidates.append({
            "image_id": image_id, "source_set": source_set, "path": str(path),
            "same_person": same_person, "age_delta": age_delta, "artifacts": artifacts,
        })
    return candidates, skipped


# ---------------------------------------------------------------------------
# selection -- thresholds, cap-per-set, deterministic ordering
# ---------------------------------------------------------------------------


def select_cells(
    candidates: list[dict[str, Any]],
    *,
    same_person_min: float = DEFAULT_SAME_PERSON_MIN,
    age_delta_max: float = DEFAULT_AGE_DELTA_MAX,
    artifacts_max: float = DEFAULT_ARTIFACTS_MAX,
    cap_per_set: int | None = None,
) -> list[dict[str, Any]]:
    passed = [
        c for c in candidates
        if c["same_person"] >= same_person_min
        and abs(c["age_delta"]) <= age_delta_max
        and c["artifacts"] <= artifacts_max
    ]
    by_set: dict[str, list[dict[str, Any]]] = {}
    for candidate in passed:
        by_set.setdefault(candidate["source_set"], []).append(candidate)

    selected: list[dict[str, Any]] = []
    for name in sorted(by_set):
        # Best first: highest same_person, then fewest artifacts, then smallest age
        # drift, then image_id for a stable tie-break -- "closest to the anchors"
        # per r24 method 4.
        rows = sorted(
            by_set[name],
            key=lambda c: (-c["same_person"], c["artifacts"], abs(c["age_delta"]), c["image_id"]),
        )
        if cap_per_set is not None:
            rows = rows[:cap_per_set]
        selected.extend(rows)
    return selected


def build_selection(
    *,
    anchors_dir: Path,
    calibration_path: Path | None = None,
    image_dirs: dict[str, Path] | None = None,
    gate_sources: list[tuple[str, Path, Path]] | None = None,
    same_person_min: float = DEFAULT_SAME_PERSON_MIN,
    age_delta_max: float = DEFAULT_AGE_DELTA_MAX,
    artifacts_max: float = DEFAULT_ARTIFACTS_MAX,
    cap_per_set: int | None = None,
    exclude_sets: tuple[str, ...] = (),
) -> dict[str, Any]:
    effective_exclude = NEVER_SETS | set(exclude_sets)
    anchors = anchor_cells(Path(anchors_dir))

    all_candidates: list[dict[str, Any]] = []
    all_skipped: list[dict[str, str]] = []
    if calibration_path is not None:
        candidates, skipped = load_calibration_candidates(
            calibration_path, image_dirs or {}, exclude_sets=effective_exclude,
        )
        all_candidates.extend(candidates)
        all_skipped.extend(skipped)
    for source_set, gate_path, images_dir in gate_sources or []:
        if source_set in effective_exclude:
            continue
        candidates, skipped = load_gate_candidates(gate_path, source_set, images_dir)
        all_candidates.extend(candidates)
        all_skipped.extend(skipped)

    selected = select_cells(
        all_candidates, same_person_min=same_person_min, age_delta_max=age_delta_max,
        artifacts_max=artifacts_max, cap_per_set=cap_per_set,
    )
    counts_by_set: dict[str, int] = {"anchors": len(anchors)}
    for candidate in selected:
        counts_by_set[candidate["source_set"]] = counts_by_set.get(candidate["source_set"], 0) + 1

    return {
        "schema": "figment/training-selection@1",
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "thresholds": {
            "same_person_min": same_person_min, "age_delta_max": age_delta_max,
            "artifacts_max": artifacts_max, "cap_per_set": cap_per_set,
        },
        "excluded_sets": sorted(effective_exclude),
        "skipped": all_skipped,
        "anchors": anchors,
        "cells": selected,
        "counts_by_set": counts_by_set,
        "total_images": len(anchors) + len(selected),
    }


# ---------------------------------------------------------------------------
# caption + build_training_set bridge
# ---------------------------------------------------------------------------


def to_approved_cells(
    selection: dict[str, Any], *, trigger: str, caption_word: str = "woman",
) -> list[dict[str, str]]:
    """`build_training_set.py --mode provided`'s exact input shape: anchors first, then
    the selected cells, every caption "<trigger> <caption-word>" so the trigger token is
    present for DOP's class substitution (r21 Q1) whether or not this run turns DOP on."""
    caption = f"{trigger} {caption_word}"
    rows = selection["anchors"] + selection["cells"]
    return [{"image": row["path"], "caption": caption} for row in rows]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_name_path(value: str, flag: str) -> tuple[str, str]:
    name, sep, path = value.partition("=")
    if not sep or not name.strip() or not path.strip():
        raise argparse.ArgumentTypeError(f"{flag} must be NAME=PATH, got {value!r}")
    return name.strip(), path.strip()


def _parse_gate_source(value: str) -> tuple[str, str, str]:
    name, sep, rest = value.partition("=")
    if not sep:
        raise argparse.ArgumentTypeError(
            f"--gate-source must be NAME=GATE_JSON_PATH=IMAGES_DIR, got {value!r}"
        )
    gate_path, sep2, images_dir = rest.partition("=")
    if not sep2 or not name.strip() or not gate_path.strip() or not images_dir.strip():
        raise argparse.ArgumentTypeError(
            f"--gate-source must be NAME=GATE_JSON_PATH=IMAGES_DIR, got {value!r}"
        )
    return name.strip(), gate_path.strip(), images_dir.strip()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--anchors-dir", required=True, type=Path)
    parser.add_argument("--calibration", type=Path, default=None,
                         help="judge-calibration.json (vlm_judge.calibrate output)")
    parser.add_argument(
        "--image-dir", dest="image_dirs", action="append", default=[], metavar="NAME=PATH",
        help="calibration set name -> directory of its source images (repeatable)",
    )
    parser.add_argument(
        "--gate-source", dest="gate_sources", action="append", default=[],
        metavar="NAME=GATE_JSON_PATH=IMAGES_DIR",
        help="one figment/gate@1 gate.json plus its images directory, named as an "
             "extra evidence set (repeatable)",
    )
    parser.add_argument("--exclude-set", dest="exclude_sets", action="append", default=[],
                         metavar="NAME", help="an additional set name to exclude "
                         "(passport-candidates is always excluded, unconditionally)")
    parser.add_argument("--same-person-min", type=float, default=DEFAULT_SAME_PERSON_MIN)
    parser.add_argument("--age-delta-max", type=float, default=DEFAULT_AGE_DELTA_MAX)
    parser.add_argument("--artifacts-max", type=float, default=DEFAULT_ARTIFACTS_MAX)
    parser.add_argument("--cap-per-set", type=int, default=None)
    parser.add_argument("--trigger", required=True)
    parser.add_argument("--caption-word", default="woman")
    parser.add_argument("--out", required=True, type=Path, help="selection.json path")
    parser.add_argument("--approved-cells-out", type=Path, default=None)
    parser.add_argument("--dataset-out", type=Path, default=None,
                         help="if given, also materialize the captioned dataset directory "
                              "via build_training_set.py --mode provided")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.cap_per_set is not None and args.cap_per_set <= 0:
        parser.error("--cap-per-set must be a positive integer")

    try:
        image_dirs = {
            name: Path(path)
            for name, path in (_parse_name_path(v, "--image-dir") for v in args.image_dirs)
        }
        gate_sources = [
            (name, Path(gate_path), Path(images_dir))
            for name, gate_path, images_dir in (
                _parse_gate_source(v) for v in args.gate_sources
            )
        ]
    except argparse.ArgumentTypeError as exc:
        parser.error(str(exc))
        return 2  # pragma: no cover -- parser.error exits

    try:
        selection = build_selection(
            anchors_dir=args.anchors_dir,
            calibration_path=args.calibration,
            image_dirs=image_dirs,
            gate_sources=gate_sources,
            same_person_min=args.same_person_min,
            age_delta_max=args.age_delta_max,
            artifacts_max=args.artifacts_max,
            cap_per_set=args.cap_per_set,
            exclude_sets=tuple(args.exclude_sets),
        )
    except SelectionError as exc:
        print(f"select-training-cells error: {exc}", file=sys.stderr)
        return 2

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(selection, indent=2) + "\n", encoding="utf-8")
    print(f"selected {selection['total_images']} cell(s) ({selection['counts_by_set']}) -> {args.out}")

    if not selection["cells"] and not selection["anchors"]:  # pragma: no cover -- anchors always >=1
        return 0

    approved = to_approved_cells(selection, trigger=args.trigger, caption_word=args.caption_word)
    if args.approved_cells_out is not None:
        args.approved_cells_out.parent.mkdir(parents=True, exist_ok=True)
        args.approved_cells_out.write_text(json.dumps(approved, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {args.approved_cells_out}")

    if args.dataset_out is not None:
        approved_cells_path = args.approved_cells_out
        if approved_cells_path is None:
            approved_cells_path = args.dataset_out.parent / "approved-cells.json"
            approved_cells_path.parent.mkdir(parents=True, exist_ok=True)
            approved_cells_path.write_text(json.dumps(approved, indent=2) + "\n", encoding="utf-8")
        builder = _load_build_set_module()
        try:
            builder.build_training_set(
                approved_cells=approved_cells_path,
                source_dir=None,
                caption_mode="provided",
                out_dir=args.dataset_out,
            )
        except builder.DatasetBuildError as exc:
            print(f"select-training-cells error: {exc}", file=sys.stderr)
            return 2
        print(f"materialized dataset -> {args.dataset_out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
