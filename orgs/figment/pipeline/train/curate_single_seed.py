#!/usr/bin/env python3
"""Materialize a provenance-bound, single-seed training-dataset draft.

This is deliberately a curation and snapshot step, not an approval path.  It
accepts only the canonical ``anchors/g01.jpg`` seed for creator-001 and reviewed
first-generation derivatives of that exact seed.  It never writes
``dataset-approval.json``, plans a run, or invokes a provider.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PERSONAS_ROOT = ROOT / "orgs" / "figment" / "personas"
BUILD_SET = HERE / "build_training_set.py"
LINEAGE_PATH = HERE.parent / "lineage.py"

REQUEST_SCHEMA = "figment/single-seed-curation-request@1"
DATASET_SCHEMA = "figment/single-seed-dataset@1"
EVALUATION_SCOPE = "within-identity-diagnostic-not-independent-reference-validation"
MAX_REQUEST_BYTES = 128 * 1024
MAX_PROVENANCE_BYTES = 128 * 1024
MAX_IMAGE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_SOURCE_BYTES = 128 * 1024 * 1024
MAX_TOTAL_OUTPUT_BYTES = 128 * 1024 * 1024
MAX_PIXELS = 16_777_216
MAX_DIMENSION = 8192
MAX_ENTRIES = 128
MAX_CAPTION_BYTES = 320
ID_RE = re.compile(r"[a-z][a-z0-9-]{0,63}")
TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
SOURCE_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:png|jpe?g|webp)", re.I)
PROVENANCE_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.provenance\.json", re.I)


class CurationError(ValueError):
    pass


def _is_reparse(path: Path) -> bool:
    try:
        attributes = getattr(os.lstat(path), "st_file_attributes", 0)
    except OSError:
        return False
    is_junction = getattr(os.path, "isjunction", lambda _: False)
    return path.is_symlink() or is_junction(path) or bool(attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def _safe_root(path: Path, label: str) -> Path:
    try:
        lexical = path.absolute()
        if not lexical.is_dir() or any(_is_reparse(part) for part in (lexical, *lexical.parents)):
            raise CurationError(f"{label} and its ancestors must be real non-reparse directories")
        return lexical.resolve(strict=True)
    except OSError as exc:
        raise CurationError(f"{label} is unavailable") from exc


def _safe_file(root: Path, parts: tuple[str, ...], label: str) -> Path:
    current = root
    for part in parts:
        current /= part
        if _is_reparse(current) or not current.exists():
            raise CurationError(f"{label} is missing or traverses a symlink or reparse point")
    if not current.is_file() or _is_reparse(current):
        raise CurationError(f"{label} must be a regular file")
    return current


def _read_limited(path: Path, maximum: int, label: str) -> bytes:
    try:
        if _is_reparse(path) or not path.is_file():
            raise CurationError(f"{label} is missing or linked: {path.name}")
        expected = path.stat().st_size
        if expected < 0 or expected > maximum:
            raise CurationError(f"{label} is oversized: {path.name}")
        blocks: list[bytes] = []
        seen = 0
        with path.open("rb") as handle:
            while block := handle.read(min(1024 * 1024, maximum + 1 - seen)):
                seen += len(block)
                if seen > maximum:
                    raise CurationError(f"{label} is oversized: {path.name}")
                blocks.append(block)
        if seen != expected or path.stat().st_size != expected:
            raise CurationError(f"{label} changed while it was read: {path.name}")
        return b"".join(blocks)
    except OSError as exc:
        raise CurationError(f"cannot read {label}: {path.name}") from exc


def _sha256(path: Path, *, maximum: int = MAX_IMAGE_BYTES, label: str = "source") -> str:
    try:
        if _is_reparse(path) or not path.is_file():
            raise CurationError(f"{label} is missing or linked: {path.name}")
        expected = path.stat().st_size
        if expected <= 0 or expected > maximum:
            raise CurationError(f"{label} is oversized: {path.name}")
        digest = hashlib.sha256()
        seen = 0
        with path.open("rb") as handle:
            while block := handle.read(1024 * 1024):
                seen += len(block)
                if seen > maximum:
                    raise CurationError(f"{label} is oversized: {path.name}")
                digest.update(block)
        if seen != expected or path.stat().st_size != expected:
            raise CurationError(f"{label} changed while it was read: {path.name}")
        return digest.hexdigest()
    except OSError as exc:
        raise CurationError(f"cannot read {label}: {path.name}") from exc


def _bounded_json(path: Path, maximum: int, label: str) -> tuple[dict[str, Any], str]:
    try:
        raw = _read_limited(path, maximum, label)
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CurationError(f"cannot parse {label}: {path.name}") from exc
    if not isinstance(value, dict):
        raise CurationError(f"{label} must be an object: {path.name}")
    return value, hashlib.sha256(raw).hexdigest()


def _load_builder():
    spec = importlib.util.spec_from_file_location("figment_curate_builder", BUILD_SET)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise CurationError(f"cannot load training-set builder: {BUILD_SET}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _load_lineage():
    spec = importlib.util.spec_from_file_location("figment_single_seed_lineage", LINEAGE_PATH)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise CurationError(f"cannot load lineage verifier: {LINEAGE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _plain_text(value: Any, label: str, maximum: int) -> str:
    if (not isinstance(value, str) or not value or value != value.strip()
            or len(value.encode("utf-8")) > maximum or any(ch in value for ch in "\r\n\x00")):
        raise CurationError(f"{label} must be a bounded single line")
    return value


def _variation(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or not value or len(value) > 8:
        raise CurationError("variation must be a non-empty object of at most eight fields")
    result: dict[str, str] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", key):
            raise CurationError("variation keys must be bounded lowercase identifiers")
        result[key] = _plain_text(item, f"variation.{key}", 160)
    return result


def _source_file(sources: Path, value: Any, expression: re.Pattern[str], label: str) -> Path:
    if not isinstance(value, str) or not expression.fullmatch(value):
        raise CurationError(f"{label} must be one plain staged filename")
    candidate = sources / value
    if _is_reparse(candidate):
        raise CurationError(f"{label} must be a regular staged file, not a symlink")
    path = candidate.resolve()
    try:
        path.relative_to(sources.resolve())
    except ValueError as exc:
        raise CurationError(f"{label} escapes the staged source directory") from exc
    return path


def _image_size(path: Path, label: str) -> int:
    try:
        if _is_reparse(path) or not path.is_file():
            raise CurationError(f"{label} is missing or linked: {path.name}")
        size = path.stat().st_size
        if size <= 0 or size > MAX_IMAGE_BYTES:
            raise CurationError(f"{label} is oversized: {path.name}")
        with Image.open(path) as image:
            width, height = image.size
            if (width <= 0 or height <= 0 or width > MAX_DIMENSION or height > MAX_DIMENSION
                    or width * height > MAX_PIXELS):
                raise CurationError(f"{label} exceeds decoded dimension or pixel limits: {path.name}")
            image.verify()
    except CurationError:
        raise
    except (OSError, ValueError) as exc:
        raise CurationError(f"cannot inspect {label}: {path.name}") from exc
    return size


def _copy_snapshot(source: Path, destination: Path, *, maximum: int | None = None) -> dict[str, Any]:
    if _is_reparse(source) or not source.is_file():
        raise CurationError(f"source is missing, linked, or oversized: {source.name}")
    try:
        expected = source.stat().st_size
        if expected <= 0 or (maximum is not None and expected > maximum):
            raise CurationError(f"source is missing, linked, or oversized: {source.name}")
        digest = hashlib.sha256()
        seen = 0
        with source.open("rb") as input_handle, destination.open("xb") as output_handle:
            while block := input_handle.read(1024 * 1024):
                seen += len(block)
                if maximum is not None and seen > maximum:
                    raise CurationError(f"source is missing, linked, or oversized: {source.name}")
                digest.update(block)
                output_handle.write(block)
        if seen != expected or source.stat().st_size != expected:
            raise CurationError(f"snapshot source changed while copying: {source.name}")
    except OSError as exc:
        raise CurationError(f"cannot snapshot curation input: {source.name}") from exc
    return {"name": destination.name, "bytes": seen, "sha256": digest.hexdigest()}


def _validate_provenance(
    document: dict[str, Any], *, creator: str, seed_sha256: str, image_name: str, image_sha256: str,
) -> None:
    source = document.get("source")
    output = document.get("output")
    review = document.get("review")
    if document.get("schema") != "figment/generated-input-experiment@1" or document.get("creator") != creator:
        raise CurationError("derivative provenance has the wrong schema or creator")
    if not isinstance(source, dict) or source.get("reference") != "anchors/g01.jpg" or source.get("sha256") != seed_sha256:
        raise CurationError("derivative provenance does not bind the canonical g01 seed")
    role = source.get("role")
    if not isinstance(role, str) or not re.search(r"no prior generated candidate|first generated portrait is not an input", role, re.I):
        raise CurationError("derivative provenance does not prove it is first-generation, not chained")
    if not isinstance(output, dict) or output.get("file") != image_name or output.get("sha256") != image_sha256:
        raise CurationError("derivative provenance output does not match staged image bytes")
    if not isinstance(review, dict) or review.get("training_eligible") is not True:
        raise CurationError("derivative is not explicitly training-eligible")
    if isinstance(review.get("status"), str) and review["status"].casefold().startswith("rejected"):
        raise CurationError("rejected derivative cannot be made eligible by this compiler")


def _request_entries(request: dict[str, Any], *, sources: Path, seed: Path) -> tuple[str, list[dict[str, Any]]]:
    creator = request.get("creator")
    trigger = request.get("trigger")
    seed_record = request.get("canonical_seed")
    entries = request.get("entries")
    if creator != "creator-001" or not isinstance(trigger, str) or not TOKEN_RE.fullmatch(trigger):
        raise CurationError("request must name creator-001 and one bounded trigger token")
    seed_bytes = _image_size(seed, "canonical seed")
    if not isinstance(seed_record, dict) or seed_record.get("path") != "anchors/g01.jpg" or seed_record.get("sha256") != _sha256(seed, label="canonical seed"):
        raise CurationError("request canonical_seed must exactly match current anchors/g01.jpg")
    if not isinstance(entries, list) or not entries or len(entries) > MAX_ENTRIES:
        raise CurationError("request entries must be a non-empty bounded list")
    seen_ids: set[str] = set()
    seen_images: dict[str, str] = {}
    materialized: list[dict[str, Any]] = []
    seed_rows = 0
    derivative_train_rows = 0
    seed_sha256 = _sha256(seed, label="canonical seed")
    source_total = seed_bytes
    for raw in entries:
        if not isinstance(raw, dict):
            raise CurationError("each curation entry must be an object")
        entry_id = raw.get("id")
        kind = raw.get("kind")
        split = raw.get("split")
        if not isinstance(entry_id, str) or not ID_RE.fullmatch(entry_id) or entry_id in seen_ids:
            raise CurationError("curation entry ids must be unique bounded identifiers")
        if kind not in ("seed", "derivative") or split not in ("train", "eval"):
            raise CurationError("curation entries need kind seed|derivative and split train|eval")
        caption = _plain_text(raw.get("caption"), "caption", MAX_CAPTION_BYTES)
        if not caption.startswith(trigger + " "):
            raise CurationError("every caption must start with the declared trigger token")
        row: dict[str, Any] = {"id": entry_id, "kind": kind, "split": split, "caption": caption, "variation": _variation(raw.get("variation"))}
        seen_ids.add(entry_id)
        if kind == "seed":
            if entry_id != "seed-g01" or seed_rows or split != "train" or "image" in raw or "provenance" in raw:
                raise CurationError("g01 is the sole seed and may appear once in the train split")
            row["source"] = {
                "logical_path": "anchors/g01.jpg", "sha256": seed_sha256,
                "bytes": seed_bytes, "path": seed,
            }
            seed_rows += 1
        else:
            image_name = raw.get("image")
            provenance_name = raw.get("provenance")
            image = _source_file(sources, image_name, SOURCE_NAME_RE, "image")
            provenance = _source_file(sources, provenance_name, PROVENANCE_NAME_RE, "provenance")
            image_bytes = _image_size(image, "derivative")
            provenance_bytes = provenance.stat().st_size
            if provenance_bytes <= 0 or provenance_bytes > MAX_PROVENANCE_BYTES:
                raise CurationError(f"derivative provenance is missing or oversized: {provenance.name}")
            if source_total + image_bytes + provenance_bytes > MAX_TOTAL_SOURCE_BYTES:
                raise CurationError("curation source inputs exceed the aggregate byte limit")
            source_total += image_bytes + provenance_bytes
            image_sha256 = _sha256(image, label="derivative")
            previous_split = seen_images.setdefault(image_sha256, split)
            if previous_split != split:
                raise CurationError("one derivative source hash cannot appear in both train and eval")
            if previous_split == split and sum(1 for item in materialized if item.get("source", {}).get("sha256") == image_sha256):
                raise CurationError("duplicate derivative source image is not allowed")
            document, _ = _bounded_json(provenance, MAX_PROVENANCE_BYTES, "derivative provenance")
            _validate_provenance(document, creator=creator, seed_sha256=seed_sha256, image_name=image.name, image_sha256=image_sha256)
            row["source"] = {
                "logical_path": image.name, "sha256": image_sha256,
                "bytes": image_bytes, "path": image,
            }
            row["provenance_path"] = provenance
            if split == "train":
                derivative_train_rows += 1
        materialized.append(row)
    if seed_rows != 1 or derivative_train_rows < 1:
        raise CurationError("a trainable single-seed draft requires g01 and at least one eligible train derivative")
    return trigger, materialized


def curate_single_seed_dataset(request_path: Path, out_dir: Path, *, personas_root: Path = PERSONAS_ROOT) -> dict[str, Any]:
    """Create an unapproved dataset snapshot. Existing outputs are never replaced."""
    raw_request_path = Path(request_path)
    if raw_request_path.is_symlink() or not raw_request_path.name:
        raise CurationError("curation request must be a regular file, not a symlink")
    request_root = _safe_root(raw_request_path.absolute().parent, "curation request root")
    request_path = _safe_file(request_root, (raw_request_path.name,), "curation request")
    sources = _safe_root(request_root / "sources", "curation sources root")
    request, request_sha256 = _bounded_json(request_path, MAX_REQUEST_BYTES, "curation request")
    if request.get("schema") != REQUEST_SCHEMA:
        raise CurationError("wrong single-seed curation request schema")
    persona_root = _safe_root(Path(personas_root), "personas root")
    seed = _safe_file(persona_root, ("creator-001", "anchors", "g01.jpg"), "canonical anchors/g01.jpg")
    trigger, entries = _request_entries(request, sources=sources, seed=seed)
    raw_out = Path(out_dir)
    if not raw_out.name:
        raise CurationError("curation output must be a new direct child of an existing directory")
    out_parent = _safe_root(raw_out.absolute().parent, "curation output parent")
    out_dir = out_parent / raw_out.name
    if out_dir.exists() or _is_reparse(out_dir):
        raise CurationError(f"refusing to overwrite curation output: {out_dir}")
    with tempfile.TemporaryDirectory(prefix="single-seed-curation-", dir=out_parent) as temporary_name:
        temporary = Path(temporary_name)
        snapshots: list[dict[str, Any]] = []
        request_snapshot = _copy_snapshot(request_path, temporary / "curation-request.json", maximum=MAX_REQUEST_BYTES)
        if request_snapshot["sha256"] != request_sha256:
            raise CurationError("curation request changed before its retained snapshot was copied")
        snapshots.append(request_snapshot)
        record_entries: list[dict[str, Any]] = []
        approved: list[dict[str, str]] = []
        train_index = 0
        train_count = sum(1 for row in entries if row["split"] == "train")
        image_width = max(2, len(str(train_count)))
        for row in entries:
            source_snapshot_name = f"curation-{row['id']}.source"
            source_snapshot = _copy_snapshot(row["source"]["path"], temporary / source_snapshot_name, maximum=MAX_IMAGE_BYTES)
            snapshots.append(source_snapshot)
            source = {
                "logical_path": row["source"]["logical_path"], "sha256": row["source"]["sha256"],
                "bytes": row["source"]["bytes"], "snapshot": source_snapshot_name,
                "snapshot_sha256": source_snapshot["sha256"],
            }
            stored = {key: row[key] for key in ("id", "kind", "split", "caption", "variation")}
            stored["source"] = source
            if "provenance_path" in row:
                provenance_snapshot_name = f"curation-{row['id']}.provenance.json"
                provenance_snapshot = _copy_snapshot(row["provenance_path"], temporary / provenance_snapshot_name, maximum=MAX_PROVENANCE_BYTES)
                snapshots.append(provenance_snapshot)
                stored["provenance"] = {"snapshot": provenance_snapshot_name, "sha256": provenance_snapshot["sha256"]}
            if row["split"] == "train":
                train_index += 1
                stem = f"{train_index:0{image_width}d}"
                stored["materialization"] = {
                    "index": train_index, "image": f"{stem}.png", "caption_file": f"{stem}.txt",
                }
                # The ordinary builder must consume only this retained snapshot,
                # never a staging path that can change after its provenance hash
                # was captured. Eval rows deliberately never enter this list.
                approved.append({"image": str(temporary / source_snapshot_name), "caption": row["caption"]})
            record_entries.append(stored)
        record = {
            "schema": DATASET_SCHEMA,
            "creator": "creator-001",
            "trigger": trigger,
            "request": {"snapshot": "curation-request.json", "sha256": request_snapshot["sha256"]},
            "canonical_seed": {"path": "anchors/g01.jpg", "sha256": _sha256(seed)},
            "evaluation_scope": EVALUATION_SCOPE,
            "entries": record_entries,
            "snapshot_inventory": [
                {"name": item["name"], "bytes": item["bytes"], "sha256": item["sha256"]}
                for item in snapshots
            ],
        }
        record_text = json.dumps(record, indent=2, ensure_ascii=False) + "\n"
        if len(record_text.encode("utf-8")) > MAX_REQUEST_BYTES:
            raise CurationError("curation record exceeds its bounded JSON limit")
        (temporary / "dataset_curation.json").write_text(record_text, encoding="utf-8")
        approved_path = temporary / "curation-approved-cells.json"
        approved_path.write_text(json.dumps(approved, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        builder = _load_builder()
        try:
            manifest = builder.build_training_set(
                approved_cells=approved_path, source_dir=None, caption_mode="provided", out_dir=temporary,
            )
        except builder.DatasetBuildError as exc:
            raise CurationError(f"training-set builder rejected curated inputs: {exc}") from exc
        output_total = 0
        for row in manifest["files"]:
            image_path = temporary / row["image"]
            output_total += _image_size(image_path, "materialized training image")
            if output_total > MAX_TOTAL_OUTPUT_BYTES:
                raise CurationError("materialized training images exceed the aggregate byte limit")
        approved_path.unlink()
        # A source can change after validation but before its snapshot read. Do
        # not publish a draft in that case: verify the completed retained record
        # and numbered outputs before the atomic directory publication.
        lineage = _load_lineage()
        try:
            lineage.dataset_subject(temporary)
        except ValueError as exc:
            raise CurationError(f"completed curation draft failed lineage verification: {exc}") from exc
        os.replace(temporary, out_dir)
    return record


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, type=Path, help="request JSON; sources/ is its fixed adjacent input directory")
    parser.add_argument("--out", required=True, type=Path, help="new dataset draft directory")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        record = curate_single_seed_dataset(args.request, args.out)
    except CurationError as exc:
        print(f"single-seed curation error: {exc}", file=sys.stderr)
        return 2
    print(f"curated {sum(1 for entry in record['entries'] if entry['split'] == 'train')} train source(s) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
