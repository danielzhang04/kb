"""Small, deterministic lineage records for Figment review and training inputs."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from copy import deepcopy
from pathlib import Path
from typing import Any

from PIL import Image


APPROVAL_SCHEMA = "figment/approval-lineage@1"
EVALUATION_SCHEMA = "figment/evaluation-inputs@1"
DATASET_APPROVAL_SCHEMA = "figment/dataset-approval@1"
SINGLE_SEED_DATASET_SCHEMA = "figment/single-seed-dataset@1"
SINGLE_SEED_EVALUATION_SCOPE = "within-identity-diagnostic-not-independent-reference-validation"
SINGLE_SEED_TRIGGER_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
SINGLE_SEED_ID_RE = re.compile(r"[a-z][a-z0-9-]{0,63}")
SINGLE_SEED_SHA256_RE = re.compile(r"[a-f0-9]{64}\Z")
SINGLE_SEED_MAX_JSON_BYTES = 128 * 1024
SINGLE_SEED_MAX_IMAGE_BYTES = 16 * 1024 * 1024
SINGLE_SEED_MAX_TOTAL_BYTES = 128 * 1024 * 1024
SINGLE_SEED_MAX_PIXELS = 16_777_216
SINGLE_SEED_MAX_DIMENSION = 8192
SINGLE_SEED_MAX_ENTRIES = 128
SINGLE_SEED_REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
CHECKPOINT_SCHEMA = "figment/accepted-checkpoint@1"
SELECTION_KEYS = frozenset({
    "chosen_checkpoint_step",
    "chosen_checkpoint_sha256",
    "chosen_checkpoint_approval",
})


class LineageError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def training_input_projection(training: dict[str, Any]) -> dict[str, Any]:
    """Training inputs, excluding only fields produced by checkpoint promotion."""
    return {
        key: deepcopy(value)
        for key, value in training.items()
        if key not in SELECTION_KEYS and key != "dataset_dir"
    }


def persona_input_projection(persona: dict[str, Any]) -> dict[str, Any]:
    projected = deepcopy(persona)
    projected.pop("_persona_path", None)
    training = projected.get("training")
    if isinstance(training, dict):
        projected["training"] = training_input_projection(training)
    return projected


def file_entry(path: Path, *, name: str | None = None) -> dict[str, Any]:
    path = Path(path).resolve()
    if not path.is_file() or path.stat().st_size <= 0:
        raise LineageError(f"lineage input is missing or empty: {path}")
    return {
        "name": name if name is not None else path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def review_subject(
    *,
    creator: str,
    stage: str,
    plan_path: Path,
    manifest_paths: list[Path],
    images: list[dict[str, Any]],
    anchors: list[Path],
    persona: dict[str, Any],
    training: dict[str, Any],
    threshold_path: Path,
    score_path: Path,
    checkpoint_inputs: Any = None,
) -> dict[str, Any]:
    subject = {
        "creator": creator,
        "stage": stage,
        "plan": file_entry(plan_path, name="plan.json"),
        "manifests": [file_entry(path, name=path.name) for path in manifest_paths],
        "images": [
            {"image_id": row["image_id"], **file_entry(Path(row["path"]), name=Path(row["path"]).name)}
            for row in images
        ],
        "anchors": [file_entry(path, name=path.name) for path in anchors],
        "persona": persona_input_projection(persona),
        "training": training_input_projection(training),
        "thresholds": file_entry(threshold_path, name=threshold_path.name),
        "numeric_gate": file_entry(score_path, name=score_path.name),
        "checkpoint_inputs": deepcopy(checkpoint_inputs),
    }
    return subject


def wrap_subject(schema: str, subject: dict[str, Any], **fields: Any) -> dict[str, Any]:
    return {"schema": schema, **fields, "subject": subject, "subject_sha256": canonical_sha256(subject)}


def assert_current(record: dict[str, Any], current_subject: dict[str, Any], *, label: str) -> None:
    if not isinstance(record, dict) or not isinstance(record.get("subject"), dict):
        raise LineageError(f"{label} is malformed")
    recorded = record.get("subject_sha256")
    if recorded != canonical_sha256(record["subject"]):
        raise LineageError(f"{label} has a corrupt recorded subject digest")
    current = canonical_sha256(current_subject)
    if recorded != current:
        raise LineageError(
            f"{label} is stale (recorded {recorded}, current {current}); rebuild the grade "
            "and obtain fresh operator rulings"
        )


def _plain_snapshot_name(value: Any) -> str:
    if not isinstance(value, str) or Path(value).name != value or not value:
        raise LineageError("single-seed curation has an unsafe snapshot filename")
    return value


def _single_seed_is_reparse(path: Path) -> bool:
    try:
        attributes = getattr(os.lstat(path), "st_file_attributes", 0)
    except OSError:
        return False
    is_junction = getattr(os.path, "isjunction", lambda _: False)
    return path.is_symlink() or is_junction(path) or bool(attributes & SINGLE_SEED_REPARSE)


def _single_seed_file_entry(path: Path, *, name: str, maximum: int) -> dict[str, Any]:
    """Hash one retained curation file with a stable bounded read."""
    try:
        if _single_seed_is_reparse(path) or not path.is_file():
            raise LineageError(f"single-seed retained snapshot is missing or linked: {name}")
        expected = path.stat().st_size
        if expected <= 0 or expected > maximum:
            raise LineageError(f"single-seed retained snapshot is oversized: {name}")
        digest = hashlib.sha256()
        seen = 0
        with path.open("rb") as handle:
            while block := handle.read(1024 * 1024):
                seen += len(block)
                if seen > maximum:
                    raise LineageError(f"single-seed retained snapshot is oversized: {name}")
                digest.update(block)
        if seen != expected or path.stat().st_size != expected:
            raise LineageError(f"single-seed retained snapshot changed while read: {name}")
        return {"name": name, "bytes": seen, "sha256": digest.hexdigest()}
    except OSError as exc:
        raise LineageError(f"cannot read single-seed retained snapshot: {name}") from exc


def _single_seed_read_json(path: Path, *, name: str) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        if _single_seed_is_reparse(path) or not path.is_file():
            raise LineageError(f"single-seed retained snapshot is missing or linked: {name}")
        expected = path.stat().st_size
        if expected <= 0 or expected > SINGLE_SEED_MAX_JSON_BYTES:
            raise LineageError(f"single-seed retained snapshot is oversized: {name}")
        blocks: list[bytes] = []
        seen = 0
        with path.open("rb") as handle:
            while block := handle.read(min(1024 * 1024, SINGLE_SEED_MAX_JSON_BYTES + 1 - seen)):
                seen += len(block)
                if seen > SINGLE_SEED_MAX_JSON_BYTES:
                    raise LineageError(f"single-seed retained snapshot is oversized: {name}")
                blocks.append(block)
        raw = b"".join(blocks)
        if seen != expected or path.stat().st_size != expected:
            raise LineageError(f"single-seed retained snapshot changed while read: {name}")
        entry = {"name": name, "bytes": seen, "sha256": hashlib.sha256(raw).hexdigest()}
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LineageError(f"cannot parse single-seed JSON snapshot: {name}") from exc
    if not isinstance(value, dict):
        raise LineageError(f"single-seed JSON snapshot must be an object: {name}")
    return value, entry


def _single_seed_image_entry(path: Path, *, name: str) -> dict[str, Any]:
    entry = _single_seed_file_entry(path, name=name, maximum=SINGLE_SEED_MAX_IMAGE_BYTES)
    try:
        with Image.open(path) as image:
            width, height = image.size
            if (width <= 0 or height <= 0 or width > SINGLE_SEED_MAX_DIMENSION
                    or height > SINGLE_SEED_MAX_DIMENSION or width * height > SINGLE_SEED_MAX_PIXELS):
                raise LineageError(f"single-seed retained image exceeds decoded limits: {name}")
            image.verify()
        if path.stat().st_size != entry["bytes"]:
            raise LineageError(f"single-seed retained image changed while inspected: {name}")
    except LineageError:
        raise
    except (OSError, ValueError) as exc:
        raise LineageError(f"cannot inspect single-seed retained image: {name}") from exc
    return entry


def _single_seed_caption_text(path: Path, *, name: str) -> str:
    """Read a generated caption once under the compiler's 320-byte line limit."""
    try:
        if _single_seed_is_reparse(path) or not path.is_file():
            raise LineageError(f"single-seed caption is missing or linked: {name}")
        expected = path.stat().st_size
        # A 320-byte logical caption is written through Windows text mode as
        # CRLF, so its valid byte representation can reach 322 bytes.
        if expected <= 0 or expected > 322:
            raise LineageError(f"single-seed caption is oversized: {name}")
        with path.open("rb") as handle:
            raw = handle.read(322)
        if len(raw) != expected or path.stat().st_size != expected:
            raise LineageError(f"single-seed caption changed while read: {name}")
        text = raw.decode("utf-8")
        # `build_training_set.py` writes ``caption + "\n"`` in text mode. On
        # Windows the byte representation is CRLF, while its logical sidecar
        # content remains the compiler's single LF-terminated caption.
        return text[:-2] + "\n" if text.endswith("\r\n") else text
    except (OSError, UnicodeDecodeError) as exc:
        raise LineageError(f"cannot read single-seed caption: {name}") from exc


def _single_seed_curation_subject(dataset_dir: Path, dataset_entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return immutable single-seed evidence when this is a curated dataset.

    The normal dataset builder deliberately remains usable for older generic
    datasets.  A curation record opts a directory into this stricter inventory:
    its record and every retained source/provenance snapshot must still hash to
    the values materialized before the ordinary numbered training PNGs.
    """
    record_path = dataset_dir / "dataset_curation.json"
    if not record_path.exists():
        return None
    record, record_entry = _single_seed_read_json(record_path, name=record_path.name)
    if not isinstance(record, dict) or record.get("schema") != SINGLE_SEED_DATASET_SCHEMA:
        raise LineageError("single-seed curation record has the wrong schema")
    if record.get("creator") != "creator-001":
        raise LineageError("single-seed curation record has the wrong creator")
    seed = record.get("canonical_seed")
    if (not isinstance(seed, dict) or seed.get("path") != "anchors/g01.jpg"
            or not isinstance(seed.get("sha256"), str) or not SINGLE_SEED_SHA256_RE.fullmatch(seed["sha256"])):
        raise LineageError("single-seed curation record does not bind canonical g01")
    if record.get("evaluation_scope") != SINGLE_SEED_EVALUATION_SCOPE:
        raise LineageError("single-seed curation must state its within-identity evaluation scope")
    trigger = record.get("trigger")
    if not isinstance(trigger, str) or not SINGLE_SEED_TRIGGER_RE.fullmatch(trigger):
        raise LineageError("single-seed curation record has an invalid trigger")
    entries = record.get("entries")
    inventory = record.get("snapshot_inventory")
    if (not isinstance(entries, list) or not entries or len(entries) > SINGLE_SEED_MAX_ENTRIES
            or not isinstance(inventory, list) or not inventory
            or len(inventory) > 1 + SINGLE_SEED_MAX_ENTRIES * 2):
        raise LineageError("single-seed curation record needs entries and a snapshot inventory")
    inventory_names: set[str] = set()
    snapshots: list[dict[str, Any]] = []
    snapshot_total = 0
    for row in inventory:
        if not isinstance(row, dict):
            raise LineageError("single-seed snapshot inventory entry is malformed")
        name = _plain_snapshot_name(row.get("name"))
        declared = row.get("sha256")
        declared_bytes = row.get("bytes")
        maximum = (SINGLE_SEED_MAX_JSON_BYTES if name == "curation-request.json" or name.endswith(".provenance.json")
                   else SINGLE_SEED_MAX_IMAGE_BYTES if name.endswith(".source") else 0)
        if (not maximum or name in inventory_names or not isinstance(declared, str)
                or not SINGLE_SEED_SHA256_RE.fullmatch(declared)
                or isinstance(declared_bytes, bool) or not isinstance(declared_bytes, int) or declared_bytes <= 0):
            raise LineageError("single-seed snapshot inventory is malformed")
        snapshot_total += declared_bytes
        if snapshot_total > SINGLE_SEED_MAX_TOTAL_BYTES:
            raise LineageError("single-seed snapshot inventory exceeds the aggregate byte limit")
        path = dataset_dir / name
        entry = _single_seed_file_entry(path, name=name, maximum=maximum)
        if entry["sha256"] != declared or entry["bytes"] != declared_bytes:
            raise LineageError(f"single-seed retained snapshot hash mismatch: {name}")
        inventory_names.add(name)
        snapshots.append(entry)
    request = record.get("request")
    if (not isinstance(request, dict) or request.get("snapshot") != "curation-request.json"
            or not isinstance(request.get("sha256"), str) or not SINGLE_SEED_SHA256_RE.fullmatch(request["sha256"])
            or request.get("sha256") != next((item["sha256"] for item in snapshots if item["name"] == "curation-request.json"), None)):
        raise LineageError("single-seed curation request snapshot is not bound")
    seen_ids: set[str] = set()
    seen_source_hashes: dict[str, str] = {}
    expected_snapshot_names = {"curation-request.json"}
    has_seed = False
    derivative_train_rows = 0
    curated_train_rows: list[dict[str, Any]] = []
    for row in entries:
        if (not isinstance(row, dict) or not isinstance(row.get("id"), str)
                or not SINGLE_SEED_ID_RE.fullmatch(row["id"]) or row["id"] in seen_ids):
            raise LineageError("single-seed curation entries are malformed")
        seen_ids.add(row["id"])
        kind, split, source = row.get("kind"), row.get("split"), row.get("source")
        if kind not in ("seed", "derivative") or split not in ("train", "eval") or not isinstance(source, dict):
            raise LineageError("single-seed curation entries have invalid kind, split, or source")
        caption = row.get("caption")
        variation = row.get("variation")
        if (not isinstance(caption, str) or not caption.startswith(trigger + " ")
                or not caption.strip() or any(char in caption for char in "\r\n\x00")
                or len(caption.encode("utf-8")) > 320):
            raise LineageError("single-seed curation caption is not a bounded trigger-prefixed line")
        if not isinstance(variation, dict) or not variation or len(variation) > 8:
            raise LineageError("single-seed curation variation is malformed")
        for key, item in variation.items():
            if (not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", key)
                    or not isinstance(item, str) or not item or any(char in item for char in "\r\n\x00")
                    or len(item.encode("utf-8")) > 160):
                raise LineageError("single-seed curation variation is malformed")
        logical_path = source.get("logical_path")
        source_hash = source.get("sha256")
        snapshot = _plain_snapshot_name(source.get("snapshot"))
        snapshot_hash = source.get("snapshot_sha256")
        source_bytes = source.get("bytes")
        found = next((item for item in snapshots if item["name"] == snapshot), None)
        expected_source_snapshot = f"curation-{row['id']}.source"
        if (snapshot != expected_source_snapshot or not isinstance(logical_path, str)
                or not isinstance(source_hash, str) or not SINGLE_SEED_SHA256_RE.fullmatch(source_hash)
                or not isinstance(snapshot_hash, str) or snapshot_hash != source_hash
                or isinstance(source_bytes, bool) or not isinstance(source_bytes, int) or source_bytes <= 0
                or found is None or found["sha256"] != snapshot_hash or found["bytes"] != source_bytes):
            raise LineageError("single-seed curation source snapshot is not bound")
        expected_snapshot_names.add(snapshot)
        image_entry = _single_seed_image_entry(dataset_dir / snapshot, name=snapshot)
        if image_entry != found:
            raise LineageError("single-seed retained image changed while inspected")
        if kind == "seed":
            if row["id"] != "seed-g01" or split != "train" or logical_path != "anchors/g01.jpg" or source_hash != seed["sha256"]:
                raise LineageError("single-seed curation seed is not canonical g01 in train")
            if has_seed:
                raise LineageError("single-seed curation contains g01 more than once")
            has_seed = True
        else:
            if Path(logical_path).name != logical_path:
                raise LineageError("single-seed derivative source path is not a plain filename")
            previous = seen_source_hashes.setdefault(source_hash, split)
            if previous != split:
                raise LineageError("single-seed curation leaks a derivative source hash across train and eval")
            provenance = row.get("provenance")
            expected_provenance_snapshot = f"curation-{row['id']}.provenance.json"
            if (not isinstance(provenance, dict) or provenance.get("snapshot") != expected_provenance_snapshot
                    or _plain_snapshot_name(provenance.get("snapshot")) not in inventory_names
                    or not isinstance(provenance.get("sha256"), str)
                    or not SINGLE_SEED_SHA256_RE.fullmatch(provenance["sha256"])):
                raise LineageError("single-seed derivative provenance snapshot is not bound")
            provenance_name = provenance["snapshot"]
            found_provenance = next((item for item in snapshots if item["name"] == provenance_name), None)
            if found_provenance is None or found_provenance["sha256"] != provenance["sha256"]:
                raise LineageError("single-seed derivative provenance snapshot hash mismatch")
            provenance_path = dataset_dir / provenance_name
            provenance_document, parsed_provenance = _single_seed_read_json(provenance_path, name=provenance_name)
            if parsed_provenance != found_provenance:
                raise LineageError("single-seed derivative provenance changed while parsed")
            expected_snapshot_names.add(provenance_name)
            provenance_source = provenance_document.get("source") if isinstance(provenance_document, dict) else None
            provenance_output = provenance_document.get("output") if isinstance(provenance_document, dict) else None
            provenance_review = provenance_document.get("review") if isinstance(provenance_document, dict) else None
            role = provenance_source.get("role") if isinstance(provenance_source, dict) else None
            if (not isinstance(provenance_document, dict)
                    or provenance_document.get("schema") != "figment/generated-input-experiment@1"
                    or provenance_document.get("creator") != "creator-001"
                    or not isinstance(provenance_source, dict)
                    or provenance_source.get("reference") != "anchors/g01.jpg"
                    or provenance_source.get("sha256") != seed["sha256"]
                    or not isinstance(role, str)
                    or not re.search(r"no prior generated candidate|first generated portrait is not an input", role, re.I)
                    or not isinstance(provenance_output, dict)
                    or provenance_output.get("file") != logical_path
                    or provenance_output.get("sha256") != source_hash
                    or not isinstance(provenance_review, dict)
                    or provenance_review.get("training_eligible") is not True
                    or (isinstance(provenance_review.get("status"), str)
                        and provenance_review["status"].casefold().startswith("rejected"))):
                raise LineageError("single-seed derivative provenance is not an eligible first-generation g01 output")
            if split == "train":
                derivative_train_rows += 1
        materialization = row.get("materialization")
        if split == "train":
            curated_train_rows.append(row)
            index = len(curated_train_rows)
            expected = dataset_entries[index - 1] if index <= len(dataset_entries) else None
            if (not isinstance(materialization, dict) or materialization.get("index") != index
                    or not isinstance(expected, dict)
                    or materialization.get("image") != expected["image"]["name"]
                    or materialization.get("caption_file") != expected["caption"]["name"]
                    or _single_seed_caption_text(
                        dataset_dir / expected["caption"]["name"], name=expected["caption"]["name"],
                    ) != caption + "\n"):
                raise LineageError("single-seed curation does not bind train entry order to dataset outputs")
        elif materialization is not None:
            raise LineageError("single-seed eval entry must not be materialized as trainer media")
    if not has_seed or derivative_train_rows < 1 or len(curated_train_rows) != len(dataset_entries):
        raise LineageError("single-seed curation lacks the required train seed, derivative, or exact output mapping")
    actual_curation_names = {
        path.name for path in dataset_dir.iterdir() if path.name.startswith("curation-")
    }
    if inventory_names != expected_snapshot_names or actual_curation_names != expected_snapshot_names:
        raise LineageError("single-seed curation snapshot inventory has unlisted or unused retained files")
    return {
        "record": record_entry,
        "snapshots": snapshots,
        "canonical_seed": {"path": seed["path"], "sha256": seed["sha256"]},
        "evaluation_scope": SINGLE_SEED_EVALUATION_SCOPE,
    }


def dataset_subject(dataset_dir: Path) -> dict[str, Any]:
    dataset_dir = Path(dataset_dir).resolve()
    manifest_path = dataset_dir / "dataset_manifest.json"
    ready_path = dataset_dir / "_dataset.ready"
    if not ready_path.is_file():
        raise LineageError(f"dataset ready marker is missing: {ready_path}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LineageError(f"cannot read dataset manifest {manifest_path}: {exc}") from exc
    if not isinstance(manifest, dict):
        raise LineageError("dataset manifest must be an object")
    count = manifest.get("count")
    mode = manifest.get("caption_mode")
    files = manifest.get("files")
    if isinstance(count, bool) or not isinstance(count, int) or count <= 0:
        raise LineageError("dataset manifest count must be a positive integer")
    if mode not in ("provided", "class"):
        raise LineageError("dataset manifest caption_mode must be provided or class")
    if not isinstance(files, list) or len(files) != count:
        raise LineageError("dataset manifest files length does not match count")
    seen: set[str] = set()
    entries: list[dict[str, Any]] = []
    for index, row in enumerate(files):
        if not isinstance(row, dict):
            raise LineageError(f"dataset manifest files[{index}] must be an object")
        image_name = row.get("image")
        caption_name = row.get("caption_file")
        declared = row.get("sha256")
        if not isinstance(image_name, str) or not isinstance(caption_name, str):
            raise LineageError(f"dataset manifest files[{index}] needs image and caption_file")
        if Path(image_name).name != image_name or Path(caption_name).name != caption_name:
            raise LineageError("dataset manifest filenames must be plain local filenames")
        if Path(image_name).suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            raise LineageError(f"dataset image has unsupported extension: {image_name}")
        if Path(caption_name).suffix.lower() != ".txt":
            raise LineageError(f"dataset caption must be a .txt file: {caption_name}")
        if image_name in seen or caption_name in seen:
            raise LineageError("dataset manifest contains duplicate filenames")
        seen.update((image_name, caption_name))
        image_path = dataset_dir / image_name
        caption_path = dataset_dir / caption_name
        for candidate in (image_path, caption_path):
            try:
                candidate.resolve().relative_to(dataset_dir)
            except ValueError as exc:
                raise LineageError(f"dataset file escapes dataset_dir: {candidate.name}") from exc
        image = file_entry(image_path, name=image_name)
        caption = file_entry(caption_path, name=caption_name)
        if not isinstance(declared, str) or declared != image["sha256"]:
            raise LineageError(f"dataset image hash mismatch for {image_name}")
        try:
            caption_text = caption_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise LineageError(f"cannot read dataset caption {caption_name}: {exc}") from exc
        if not caption_text.strip():
            raise LineageError(f"dataset caption is empty: {caption_name}")
        entries.append({"image": image, "caption": caption})
    actual_images = {
        path.name for path in dataset_dir.iterdir()
        if path.is_file() and path.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")
    }
    if actual_images != {row["image"]["name"] for row in entries}:
        raise LineageError("dataset directory images do not exactly match dataset_manifest.json")
    subject = {
        "manifest": file_entry(manifest_path, name=manifest_path.name),
        "count": count,
        "caption_mode": mode,
        "files": entries,
    }
    curation = _single_seed_curation_subject(dataset_dir, entries)
    if curation is not None:
        subject["curation"] = curation
    return subject
