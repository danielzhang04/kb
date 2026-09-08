"""Small, deterministic lineage records for Figment review and training inputs."""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Any


APPROVAL_SCHEMA = "figment/approval-lineage@1"
EVALUATION_SCHEMA = "figment/evaluation-inputs@1"
DATASET_APPROVAL_SCHEMA = "figment/dataset-approval@1"
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
    return {
        "manifest": file_entry(manifest_path, name=manifest_path.name),
        "count": count,
        "caption_mode": mode,
        "files": entries,
    }
