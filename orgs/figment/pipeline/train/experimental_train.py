#!/usr/bin/env python3
"""Compile a local, non-promotable single-g01 training diagnostic plan.

This module deliberately has no provider, subprocess, checkpoint-selection, QA-stamp,
or approval writer.  It turns already-curated, agent-observed evidence into a private
planning record only.  Production ``figment_train.py`` continues to reject this plan's
different schema before a stage can run.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
PIPELINE = HERE.parent
ROOT = HERE.parents[3]
PRIVATE_ROOT = ROOT / "_private"
LINEAGE_PATH = PIPELINE / "lineage.py"
FIGMENT_TRAIN_PATH = PIPELINE / "figment_train.py"

SCHEMA = "figment/experimental-train-plan@1"
REVIEW_SCHEMA = "figment/experimental-dataset-review@1"
PURPOSE = "single-g01-training-diagnostic"
MIN_TRAIN_ROWS = 20
MAX_REVIEW_BYTES = 256 * 1024
MAX_JSON_DEPTH = 16
MAX_ROWS = 128
HEX = re.compile(r"[0-9a-f]{64}\Z")
SAFE_ID = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


class ExperimentalTrainError(ValueError):
    """A fail-closed refusal to produce an experimental plan."""


def _is_reparse(path: Path) -> bool:
    is_junction = getattr(os.path, "isjunction", lambda _path: False)
    try:
        return path.is_symlink() or is_junction(path) or bool(path.lstat().st_file_attributes & REPARSE_POINT)
    except (AttributeError, OSError):
        return path.is_symlink() or is_junction(path)


def _safe_root(path: Path, label: str) -> Path:
    lexical = Path(path).absolute()
    try:
        if not lexical.is_dir() or any(_is_reparse(item) for item in (lexical, *lexical.parents)):
            raise ExperimentalTrainError(f"{label} and its ancestors must be real directories")
        return lexical.resolve(strict=True)
    except OSError as exc:
        raise ExperimentalTrainError(f"{label} is unavailable") from exc


def _safe_private_output(private_root: Path, out: Path) -> Path:
    private_root = _safe_root(private_root, "private root")
    raw = Path(out)
    if raw.is_absolute() or raw.drive or not raw.parts or any(part in (".", "..") for part in raw.parts):
        raise ExperimentalTrainError("out must be a fresh path relative to the private root")
    target = private_root.joinpath(*raw.parts)
    current = private_root
    for part in raw.parts:
        current /= part
        if _is_reparse(current):
            raise ExperimentalTrainError("out may not traverse a symlink or reparse point")
    if target.exists():
        raise ExperimentalTrainError("experimental plan output must be fresh")
    return target


def _read_bounded_json(path: Path, label: str) -> tuple[dict[str, Any], bytes]:
    try:
        if _is_reparse(path) or not path.is_file():
            raise ExperimentalTrainError(f"{label} must be a regular file")
        size = path.stat().st_size
        if size < 1 or size > MAX_REVIEW_BYTES:
            raise ExperimentalTrainError(f"{label} exceeds its byte limit")
        with path.open("rb") as handle:
            raw = handle.read(MAX_REVIEW_BYTES + 1)
        if len(raw) != size or len(raw) > MAX_REVIEW_BYTES or path.stat().st_size != size:
            raise ExperimentalTrainError(f"{label} changed while it was read")
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ExperimentalTrainError(f"cannot read {label}") from exc
    _check_json(value, label)
    if not isinstance(value, dict):
        raise ExperimentalTrainError(f"{label} must be an object")
    return value, raw


def _check_json(value: Any, label: str, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise ExperimentalTrainError(f"{label} exceeds nesting limit")
    if isinstance(value, dict):
        if len(value) > 32:
            raise ExperimentalTrainError(f"{label} has too many fields")
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > 128:
                raise ExperimentalTrainError(f"{label} has an invalid key")
            _check_json(item, label, depth + 1)
    elif isinstance(value, list):
        if len(value) > MAX_ROWS:
            raise ExperimentalTrainError(f"{label} has too many rows")
        for item in value:
            _check_json(item, label, depth + 1)
    elif isinstance(value, str) and len(value) > 8_192:
        raise ExperimentalTrainError(f"{label} contains overlong text")
    elif not isinstance(value, (str, int, float, bool, type(None))):
        raise ExperimentalTrainError(f"{label} contains an unsupported value")


def _load_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ExperimentalTrainError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _lineage_module() -> Any:
    return _load_module("figment_experimental_train_lineage", LINEAGE_PATH)


def _figment_train_module() -> Any:
    return _load_module("figment_experimental_train_recipe", FIGMENT_TRAIN_PATH)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            while block := handle.read(1024 * 1024):
                digest.update(block)
    except OSError as exc:
        raise ExperimentalTrainError(f"cannot hash {path.name}") from exc
    return digest.hexdigest()


def _canonical_sha256(value: Any, lineage: Any) -> str:
    return lineage.canonical_sha256(value)


def _load_current_subject(dataset_dir: Path, lineage: Any) -> tuple[dict[str, Any], dict[str, Any], bytes]:
    dataset_dir = Path(dataset_dir).resolve()
    try:
        subject = lineage.dataset_subject(dataset_dir)
    except Exception as exc:
        raise ExperimentalTrainError(f"dataset lineage is invalid: {exc}") from exc
    curation = subject.get("curation")
    if not isinstance(curation, dict):
        raise ExperimentalTrainError("experimental training requires a single-seed curation record")
    record_path = dataset_dir / "dataset_curation.json"
    record, record_raw = _read_bounded_json(record_path, "single-seed curation record")
    recorded_entry = curation.get("record")
    if (not isinstance(recorded_entry, dict)
            or recorded_entry.get("sha256") != hashlib.sha256(record_raw).hexdigest()):
        raise ExperimentalTrainError("single-seed curation record changed after lineage validation")
    if record.get("schema") != "figment/single-seed-dataset@1":
        raise ExperimentalTrainError("experimental training requires the single-seed curation schema")
    return subject, record, record_raw


def _validate_creator_seed_and_trigger(
    creator: str, subject: dict[str, Any], curation: dict[str, Any], *, personas_root: Path, recipe: dict[str, Any],
) -> None:
    if creator != "creator-001" or curation.get("creator") != creator:
        raise ExperimentalTrainError("experimental training is currently restricted to creator-001 curation")
    try:
        personas_root = _safe_root(personas_root, "personas root")
        anchor = personas_root / creator / "anchors" / "g01.jpg"
        if _is_reparse(anchor) or not anchor.is_file():
            raise ExperimentalTrainError("current canonical g01 must be a regular file")
        actual_seed_sha = _sha256(anchor)
    except OSError as exc:
        raise ExperimentalTrainError("cannot read current canonical g01") from exc
    expected_seed = {"path": "anchors/g01.jpg", "sha256": actual_seed_sha}
    if curation.get("canonical_seed") != expected_seed:
        raise ExperimentalTrainError("curation canonical seed does not match current creator g01")
    subject_seed = subject.get("curation", {}).get("canonical_seed")
    if subject_seed != expected_seed:
        raise ExperimentalTrainError("lineage canonical seed does not match current creator g01")
    if curation.get("trigger") != recipe.get("trigger"):
        raise ExperimentalTrainError("curation trigger does not match the current pinned training recipe")


def _source_rows(subject: dict[str, Any], curation: dict[str, Any]) -> dict[str, dict[str, Any]]:
    files = subject.get("files")
    entries = curation.get("entries")
    if not isinstance(files, list) or not isinstance(entries, list):
        raise ExperimentalTrainError("curation lineage is malformed")
    train_entries = [row for row in entries if isinstance(row, dict) and row.get("split") == "train"]
    if len(train_entries) != len(files):
        raise ExperimentalTrainError("curation train rows do not exactly match dataset rows")
    result: dict[str, dict[str, Any]] = {}
    derivative_sources: set[str] = set()
    seed_count = 0
    for index, row in enumerate(train_entries, start=1):
        materialization, source = row.get("materialization"), row.get("source")
        expected = files[index - 1]
        if (not isinstance(materialization, dict) or not isinstance(source, dict)
                or materialization.get("index") != index
                or materialization.get("image") != expected.get("image", {}).get("name")
                or materialization.get("caption_file") != expected.get("caption", {}).get("name")):
            raise ExperimentalTrainError("curation materialization no longer binds every training row")
        row_id = row.get("id")
        source_hash = source.get("sha256")
        if not isinstance(row_id, str) or not SAFE_ID.fullmatch(row_id) or not isinstance(source_hash, str) or not HEX.fullmatch(source_hash):
            raise ExperimentalTrainError("curation source row is malformed")
        if row.get("kind") == "seed":
            if row_id != "seed-g01" or source.get("logical_path") != "anchors/g01.jpg":
                raise ExperimentalTrainError("curation seed must be canonical g01")
            seed_count += 1
        elif row.get("kind") == "derivative":
            if source_hash in derivative_sources:
                raise ExperimentalTrainError("experimental training requires distinct first-generation derivatives")
            derivative_sources.add(source_hash)
        else:
            raise ExperimentalTrainError("curation training row has an unsupported kind")
        result[row_id] = {"curation": row, "dataset": expected}
    if seed_count != 1 or len(derivative_sources) < MIN_TRAIN_ROWS - 1:
        raise ExperimentalTrainError("experimental training requires g01 plus 19 distinct first-generation derivatives")
    return result


def _entry_matches(value: Any, expected: dict[str, Any]) -> bool:
    return (isinstance(value, dict) and set(value) == {"name", "sha256"}
            and value.get("name") == expected.get("name") and value.get("sha256") == expected.get("sha256"))


def _validate_review(review: dict[str, Any], *, creator: str, subject: dict[str, Any], curation: dict[str, Any], lineage: Any) -> None:
    required = {"schema", "creator", "purpose", "not_promotable", "reviewer", "dataset_subject_sha256", "rows"}
    if set(review) != required or review.get("schema") != REVIEW_SCHEMA or review.get("creator") != creator:
        raise ExperimentalTrainError("experimental review has an unsupported schema or creator")
    if review.get("purpose") != PURPOSE or review.get("not_promotable") is not True:
        raise ExperimentalTrainError("experimental review is not explicitly non-promotable")
    reviewer = review.get("reviewer")
    if not isinstance(reviewer, dict) or set(reviewer) != {"kind", "id"} or reviewer.get("kind") != "agent" or not isinstance(reviewer.get("id"), str) or not SAFE_ID.fullmatch(reviewer["id"]):
        raise ExperimentalTrainError("experimental review must identify an agent reviewer")
    if review.get("dataset_subject_sha256") != _canonical_sha256(subject, lineage):
        raise ExperimentalTrainError("experimental review is stale for the current dataset subject")
    rows = review.get("rows")
    source_rows = _source_rows(subject, curation)
    if not isinstance(rows, list) or len(rows) != len(source_rows) or len(rows) < MIN_TRAIN_ROWS:
        raise ExperimentalTrainError("experimental review must bind every one of at least 20 training rows")
    seen: set[str] = set()
    expected_fields = {"id", "image", "caption", "source", "evidence_assertion", "state", "adult_presentation", "clothing", "real_person_likeness", "resemblance", "image_defects", "caption_accuracy"}
    for row in rows:
        if not isinstance(row, dict) or set(row) != expected_fields:
            raise ExperimentalTrainError("experimental review row has unexpected fields")
        row_id = row.get("id")
        binding = source_rows.get(row_id) if isinstance(row_id, str) else None
        if binding is None or row_id in seen:
            raise ExperimentalTrainError("experimental review does not bind a unique curation row")
        seen.add(row_id)
        dataset, curation_row = binding["dataset"], binding["curation"]
        if (not _entry_matches(row.get("image"), dataset.get("image", {}))
                or not _entry_matches(row.get("caption"), dataset.get("caption", {}))):
            raise ExperimentalTrainError("experimental review row does not bind current image and caption bytes")
        source = row.get("source")
        expected_source = curation_row.get("source")
        if (not isinstance(source, dict) or set(source) != {"logical_path", "sha256"}
                or not isinstance(expected_source, dict)
                or source.get("logical_path") != expected_source.get("logical_path")
                or source.get("sha256") != expected_source.get("sha256")):
            raise ExperimentalTrainError("experimental review row does not bind its curation source")
        if row.get("evidence_assertion") is not True:
            raise ExperimentalTrainError("experimental review row lacks its evidence assertion")
        if row.get("state") != "observed":
            raise ExperimentalTrainError("experimental review contains an excluded or unavailable row")
        if row.get("adult_presentation") != "observed-unambiguous-adult":
            raise ExperimentalTrainError("experimental review contains unsafe adult-presentation evidence")
        if row.get("clothing") != "observed-opaque-intact":
            raise ExperimentalTrainError("experimental review contains unsafe clothing evidence")
        if row.get("real_person_likeness") != "no-observed-concern":
            raise ExperimentalTrainError("experimental review contains a real-person-likeness concern")
        if row.get("resemblance") != "observed-unresolved":
            raise ExperimentalTrainError("experimental review must preserve unresolved resemblance evidence")
        if row.get("image_defects") != "no-observed-blocking-defect":
            raise ExperimentalTrainError("experimental review contains blocking image-defect evidence")
        if row.get("caption_accuracy") != "observed-caption-matches-image":
            raise ExperimentalTrainError("experimental review contains inaccurate-caption evidence")
    if seen != set(source_rows):
        raise ExperimentalTrainError("experimental review does not cover every curation row")


def _recipe(creator: str, personas_root: Path, train_module: Any) -> dict[str, Any]:
    try:
        persona, training, _pins = train_module._load_inputs(creator, Path(personas_root))
        config = train_module._render_training_config(
            training["trigger"], training["steps"], training["save_every"],
            dop_enabled=training["dop_enabled"], dop_multiplier=training["dop_multiplier"], dop_class=training["dop_class"],
        )
        persona_path = Path(personas_root) / creator / "persona.yaml"
        pins_path = Path(train_module.PINS_PATH)
        template_path = Path(train_module.AI_TEMPLATE_PATH)
    except (AttributeError, KeyError, ValueError) as exc:
        raise ExperimentalTrainError("existing pinned training recipe is invalid") from exc
    return {
        "persona_sha256": _sha256(persona_path),
        "tensor_pins_sha256": _sha256(pins_path),
        "training_template_sha256": _sha256(template_path),
        "trigger": training["trigger"],
        "steps": training["steps"],
        "save_every": training["save_every"],
        "rendered_training_config": config,
        "persona_id": persona["id"],
    }


def _canonical(value: dict[str, Any]) -> bytes:
    copy = dict(value)
    copy.pop("frozen_sha256", None)
    return json.dumps(copy, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _write_fresh(path: Path, value: dict[str, Any]) -> None:
    data = (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=False)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".experimental-plan.", suffix=".tmp", dir=str(path.parent))
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        try:
            path.parent.rmdir()
        except OSError:
            pass
        raise


def build_experimental_training_plan(
    creator: str, dataset_dir: Path, review_path: Path, out: Path, *,
    personas_root: Path | None = None, private_root: Path = PRIVATE_ROOT, train_module: Any | None = None,
) -> dict[str, Any]:
    """Build a fresh private plan without starting a provider or accepting a checkpoint."""
    if not isinstance(creator, str) or not SAFE_ID.fullmatch(creator):
        raise ExperimentalTrainError("creator must be a bounded identifier")
    if creator != "creator-001":
        raise ExperimentalTrainError("experimental training is currently restricted to creator-001")
    lineage = _lineage_module()
    personas_root = Path(personas_root or (ROOT / "orgs" / "figment" / "personas"))
    subject, curation, curation_raw = _load_current_subject(Path(dataset_dir), lineage)
    review, review_raw = _read_bounded_json(Path(review_path), "experimental review")
    _validate_review(review, creator=creator, subject=subject, curation=curation, lineage=lineage)
    recipe = _recipe(creator, personas_root, train_module or _figment_train_module())
    if recipe["persona_id"] != creator:
        raise ExperimentalTrainError("pinned training recipe belongs to another creator")
    _validate_creator_seed_and_trigger(creator, subject, curation, personas_root=personas_root, recipe=recipe)
    current_subject, _current_curation, current_curation_raw = _load_current_subject(Path(dataset_dir), lineage)
    if (_canonical_sha256(current_subject, lineage) != _canonical_sha256(subject, lineage)
            or current_curation_raw != curation_raw):
        raise ExperimentalTrainError("dataset lineage changed before experimental plan publication")
    output_dir = _safe_private_output(private_root, out)
    plan = {
        "schema": SCHEMA,
        "creator": creator,
        "purpose": PURPOSE,
        "not_promotable": True,
        "execution": {"provider_start_allowed": False, "checkpoint_acceptance_allowed": False, "qa_stamp_allowed": False},
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "inputs": {
            "dataset_locator": str(Path(dataset_dir).resolve()),
            "revalidate_before_execution": True,
            "dataset_subject_sha256": _canonical_sha256(subject, lineage),
            "review_sha256": hashlib.sha256(review_raw).hexdigest(),
            "curation_record_sha256": subject["curation"]["record"]["sha256"],
            "canonical_seed": subject["curation"]["canonical_seed"],
            "train_row_count": subject["count"],
        },
        "frozen_inputs": {"review": review, "dataset_subject": subject, "curation": curation},
        "training_recipe": recipe,
    }
    plan["frozen_sha256"] = hashlib.sha256(_canonical(plan)).hexdigest()
    _write_fresh(output_dir / "experimental-plan.json", plan)
    return plan


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--creator", required=True)
    parser.add_argument("--dataset-dir", required=True, type=Path)
    parser.add_argument("--review", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path, help="fresh path relative to --private-root")
    parser.add_argument("--private-root", type=Path, default=PRIVATE_ROOT)
    parser.add_argument("--personas-root", type=Path, default=ROOT / "orgs" / "figment" / "personas")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        plan = build_experimental_training_plan(
            args.creator, args.dataset_dir, args.review, args.out,
            personas_root=args.personas_root, private_root=args.private_root,
        )
    except ExperimentalTrainError as exc:
        print(f"experimental training plan refused: {exc}")
        return 2
    print(json.dumps({"plan": "experimental-plan.json", "frozen_sha256": plan["frozen_sha256"], "not_promotable": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
