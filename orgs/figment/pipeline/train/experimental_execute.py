#!/usr/bin/env python3
"""Stage and dry-run a non-promotable experimental single-g01 training plan.

This module is deliberately separate from ``figment_train.py``.  Its default
operation is local preparation only; ``--dry-run`` exercises the existing RunPod
harness without network access, and ``--execute`` is an explicit live path that
requires a fixed parent-owned admission record.  It never writes a production
dataset approval, QA stamp, checkpoint choice, persona setting, or export.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import sys
import tempfile
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable


HERE = Path(__file__).resolve().parent
PIPELINE = HERE.parent
ROOT = HERE.parents[3]
PRIVATE_ROOT = ROOT / "_private"
OPS_LEDGER_DIR = Path("C:/Users/danie/kb/_private/codex-worktrees/figment-analysis-ops-2026-09-07/ledgers/cost")
DAILY_BUDGET_PATH = ROOT / "governance" / "budget.yaml"
ARC_CAP_USD = 50.0
ARC_LEDGER_GLOB = "figment-*.tsv"
EXPERIMENTAL_PATH = HERE / "experimental_train.py"
FIGMENT_TRAIN_PATH = PIPELINE / "figment_train.py"
RUNNER_PATH = PIPELINE / "pod" / "runpod_run.py"

SCHEMA = "figment/experimental-train-execution@1"
ADMISSION_SCHEMA = "figment/experimental-train-admission@1"
PLAN_ROOT_NAME = "experimental-train-plans"
ADMISSION_ROOT_NAME = "experimental-train-admissions"
MAX_PLAN_BYTES = 2 * 1024 * 1024
MAX_IMAGE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 128 * 1024 * 1024
MAX_CAPTION_BYTES = 322
MAX_LAUNCHER_BYTES = 256 * 1024
MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024
MAX_LEDGER_FILES = 128
MAX_LEDGER_BYTES = 1024 * 1024
MAX_ROWS = 128
HEX = re.compile(r"[0-9a-f]{64}\Z")
SAFE_ID = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


class ExperimentalExecuteError(ValueError):
    """A fail-closed experimental executor refusal."""


def _load_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ExperimentalExecuteError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _experimental_module() -> Any:
    return _load_module("figment_experimental_execute_plan", EXPERIMENTAL_PATH)


def _figment_train_module() -> Any:
    return _load_module("figment_experimental_execute_recipe", FIGMENT_TRAIN_PATH)


def _runner_module() -> Any:
    return _load_module("figment_experimental_execute_runner", RUNNER_PATH)


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
            raise ExperimentalExecuteError(f"{label} and its ancestors must be real directories")
        return lexical.resolve(strict=True)
    except OSError as exc:
        raise ExperimentalExecuteError(f"{label} is unavailable") from exc


def _safe_file(root: Path, path: Path, label: str) -> Path:
    try:
        candidate = Path(path).absolute()
        if not candidate.is_relative_to(root) or any(_is_reparse(item) for item in (candidate, *candidate.parents)):
            raise ExperimentalExecuteError(f"{label} escapes its real root or traverses a reparse point")
        if not candidate.is_file():
            raise ExperimentalExecuteError(f"{label} must be a regular file")
        resolved = candidate.resolve(strict=True)
        if not resolved.is_relative_to(root):
            raise ExperimentalExecuteError(f"{label} escapes its real root")
        return resolved
    except OSError as exc:
        raise ExperimentalExecuteError(f"cannot inspect {label}") from exc


def _fresh_output(private_root: Path, out: Path) -> tuple[Path, Path]:
    root = _safe_root(private_root, "private root")
    raw = Path(out)
    if raw.is_absolute() or raw.drive or len(raw.parts) != 1 or raw.parts[0] in (".", ".."):
        raise ExperimentalExecuteError("out must be one fresh direct child of the private root")
    target = root / raw.name
    if _is_reparse(target) or target.exists():
        raise ExperimentalExecuteError("experimental execution output must be fresh")
    return root, target


def _read_bounded(path: Path, maximum: int, label: str) -> bytes:
    try:
        if _is_reparse(path) or not path.is_file():
            raise ExperimentalExecuteError(f"{label} must be a regular file")
        expected = path.stat().st_size
        if expected < 1 or expected > maximum:
            raise ExperimentalExecuteError(f"{label} exceeds its byte limit")
        with path.open("rb") as handle:
            raw = handle.read(maximum + 1)
        if len(raw) != expected or len(raw) > maximum or path.stat().st_size != expected:
            raise ExperimentalExecuteError(f"{label} changed while it was read")
        return raw
    except OSError as exc:
        raise ExperimentalExecuteError(f"cannot read {label}") from exc


def _read_json(path: Path, maximum: int, label: str) -> tuple[dict[str, Any], bytes]:
    raw = _read_bounded(path, maximum, label)
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ExperimentalExecuteError(f"{label} is not valid JSON") from exc
    if not isinstance(value, dict):
        raise ExperimentalExecuteError(f"{label} must be an object")
    return value, raw


def _write_json(path: Path, value: dict[str, Any]) -> bytes:
    raw = (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode("utf-8")
    temporary = path.with_name("." + path.name + ".tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return raw


def _hash(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _money(value: Any, label: str) -> str:
    try:
        decimal = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ExperimentalExecuteError(f"{label} is not a finite USD value") from exc
    if not decimal.is_finite() or decimal < 0:
        raise ExperimentalExecuteError(f"{label} is not a finite non-negative USD value")
    return f"{decimal:.6f}"


def _accounting_context(runner_module: Any) -> dict[str, str]:
    """Snapshot the configured Ops ledger used by the unchanged harness call."""
    ledger_root = _safe_root(OPS_LEDGER_DIR, "canonical Figment Ops ledger root")
    budget_root = _safe_root(DAILY_BUDGET_PATH.parent, "studio daily budget root")
    budget_path = _safe_file(budget_root, DAILY_BUDGET_PATH, "studio daily budget")
    paths = sorted(path for path in ledger_root.glob("*.tsv") if path.is_file())
    if not paths or len(paths) > MAX_LEDGER_FILES:
        raise ExperimentalExecuteError("canonical Figment Ops ledger inventory is unavailable or oversized")
    files: list[dict[str, Any]] = []
    for path in paths:
        safe = _safe_file(ledger_root, path, "canonical Figment Ops ledger entry")
        count, digest = _file_hash(safe, MAX_LEDGER_BYTES, "canonical Figment Ops ledger entry")
        files.append({"name": safe.name, "bytes": count, "sha256": digest})
    snapshot = _hash(json.dumps(files, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8"))
    try:
        daily_limit, daily_spent = runner_module.daily_budget_state(
            budget_path=budget_path, ledger_dir=ledger_root,
        )
        arc_cap, arc_spent = runner_module.arc_budget_state(
            arc_cap_usd=ARC_CAP_USD, ledger_dir=ledger_root, ledger_glob=ARC_LEDGER_GLOB,
        )
    except Exception as exc:
        raise ExperimentalExecuteError(f"cannot compute current Figment accounting context: {type(exc).__name__}") from exc
    if _money(daily_limit, "daily limit") != _money(10.0, "expected daily limit"):
        raise ExperimentalExecuteError("studio daily budget context is not the strict $10.00 limit")
    if _money(arc_cap, "arc cap") != _money(ARC_CAP_USD, "configured arc cap"):
        raise ExperimentalExecuteError("canonical Figment Ops arc cap is not $50.00")
    return {
        "ledger_dir": str(ledger_root),
        "daily_budget_path": str(budget_path),
        "daily_budget_sha256": _file_hash(budget_path, MAX_LEDGER_BYTES, "studio daily budget")[1],
        "ledger_snapshot_sha256": snapshot,
        "daily_usd_limit": _money(daily_limit, "daily limit"),
        "daily_usd_before": _money(daily_spent, "daily spent"),
        "arc_cap_usd": _money(arc_cap, "arc cap"),
        "arc_usd_before": _money(arc_spent, "arc spent"),
        "arc_ledger_glob": ARC_LEDGER_GLOB,
    }


def _file_hash(path: Path, maximum: int, label: str, *, allow_empty: bool = False) -> tuple[int, str]:
    try:
        if _is_reparse(path) or not path.is_file():
            raise ExperimentalExecuteError(f"{label} must be a regular file")
        expected = path.stat().st_size
        if expected < 0 or expected > maximum or (not allow_empty and expected < 1):
            raise ExperimentalExecuteError(f"{label} exceeds its byte limit")
        digest = hashlib.sha256()
        seen = 0
        with path.open("rb") as handle:
            while block := handle.read(1024 * 1024):
                seen += len(block)
                if seen > maximum:
                    raise ExperimentalExecuteError(f"{label} exceeds its byte limit")
                digest.update(block)
        if seen != expected or path.stat().st_size != expected:
            raise ExperimentalExecuteError(f"{label} changed while it was read")
        return seen, digest.hexdigest()
    except OSError as exc:
        raise ExperimentalExecuteError(f"cannot hash {label}") from exc


def _copy_verified(source: Path, destination: Path, expected_sha: str, maximum: int, label: str) -> tuple[int, str]:
    raw = _read_bounded(source, maximum, label)
    digest = _hash(raw)
    if digest != expected_sha:
        raise ExperimentalExecuteError(f"{label} hash no longer matches retained lineage")
    with destination.open("xb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    copied = _read_bounded(destination, maximum, f"staged {label}")
    if copied != raw:
        raise ExperimentalExecuteError(f"staged {label} changed while it was written")
    return len(raw), digest


def _stage_dataset(context: dict[str, Any], destination: Path) -> list[dict[str, Any]]:
    dataset_root = _safe_root(Path(context["dataset_dir"]), "curated dataset")
    subject = context["subject"]
    files = subject.get("files") if isinstance(subject, dict) else None
    if not isinstance(files, list) or not (20 <= len(files) <= MAX_ROWS):
        raise ExperimentalExecuteError("experimental dataset needs 20 through 128 verified train rows")
    destination.mkdir()
    total = 0
    staged: list[dict[str, Any]] = []
    for index, row in enumerate(files, start=1):
        if not isinstance(row, dict) or not isinstance(row.get("image"), dict) or not isinstance(row.get("caption"), dict):
            raise ExperimentalExecuteError("experimental dataset subject has malformed file entries")
        image, caption = row["image"], row["caption"]
        image_name, caption_name = image.get("name"), caption.get("name")
        if (not isinstance(image_name, str) or Path(image_name).name != image_name or Path(image_name).suffix.lower() != ".png"
                or not isinstance(caption_name, str) or Path(caption_name).name != caption_name or Path(caption_name).suffix.lower() != ".txt"
                or not isinstance(image.get("sha256"), str) or not HEX.fullmatch(image["sha256"])
                or not isinstance(caption.get("sha256"), str) or not HEX.fullmatch(caption["sha256"])):
            raise ExperimentalExecuteError("experimental dataset permits only bound PNG and TXT train entries")
        source_image = _safe_file(dataset_root, dataset_root / image_name, f"dataset image {index}")
        source_caption = _safe_file(dataset_root, dataset_root / caption_name, f"dataset caption {index}")
        image_bytes, image_hash = _copy_verified(source_image, destination / image_name, image["sha256"], MAX_IMAGE_BYTES, f"dataset image {index}")
        caption_bytes, caption_hash = _copy_verified(source_caption, destination / caption_name, caption["sha256"], MAX_CAPTION_BYTES, f"dataset caption {index}")
        total += image_bytes + caption_bytes
        if total > MAX_TOTAL_BYTES:
            raise ExperimentalExecuteError("experimental dataset staging exceeds its aggregate byte limit")
        staged.append({
            "index": index,
            "image": {"name": image_name, "bytes": image_bytes, "sha256": image_hash},
            "caption": {"name": caption_name, "bytes": caption_bytes, "sha256": caption_hash},
        })
    return staged


def _render_manifest(
    train: Any, creator: str, staging_name: str, *, training_config_sha256: str,
    staging_inventory_sha256: str, launcher_sha256: str,
) -> tuple[dict[str, Any], bytes]:
    persona, training, pins = train._load_inputs(creator, train.PERSONAS_ROOT)
    manifest = train._train_manifest(persona, training, pins, smoke=False, dataset_dirname=staging_name)
    if not isinstance(manifest.get("artifacts"), list):
        raise ExperimentalExecuteError("existing train manifest did not render artifacts")
    manifest["not_promotable"] = True
    manifest["experimental_training_config_sha256"] = training_config_sha256
    manifest["experimental_staging_inventory_sha256"] = staging_inventory_sha256
    manifest["experimental_launcher_sha256"] = launcher_sha256
    raw = (json.dumps(manifest, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode("utf-8")
    return manifest, raw


def _admission(
    private_root: Path, *, plan_hash: str, manifest: dict[str, Any], train: Any,
    manifest_sha256: str, launcher_sha256: str, training_config_sha256: str,
    staging_inventory_sha256: str,
) -> tuple[dict[str, Any], str, str]:
    parent = _safe_root(private_root / ADMISSION_ROOT_NAME, "experimental admission root")
    admission_path = _safe_file(parent, parent / f"{plan_hash}.json", "experimental execution admission")
    value, raw = _read_json(admission_path, 64 * 1024, "experimental execution admission")
    required = {
        "schema", "admission_id", "plan_sha256", "max_usd", "max_minutes",
        "ledger_dir", "daily_budget_path", "daily_budget_sha256", "ledger_snapshot_sha256",
        "daily_usd_limit", "daily_usd_before", "arc_cap_usd", "arc_usd_before", "arc_ledger_glob", "manifest_sha256",
        "launcher_sha256", "training_config_sha256", "staging_inventory_sha256",
    }
    if set(value) != required:
        raise ExperimentalExecuteError("experimental execution admission has unsupported fields")
    expected_usd = train.manifest_ceiling(manifest)
    try:
        admitted_usd = Decimal(str(value.get("max_usd")))
    except (InvalidOperation, ValueError) as exc:
        raise ExperimentalExecuteError("experimental execution admission has invalid max_usd") from exc
    accounting = _accounting_context(_runner_module())
    if (value.get("schema") != ADMISSION_SCHEMA or not isinstance(value.get("admission_id"), str)
            or not SAFE_ID.fullmatch(value["admission_id"]) or value.get("plan_sha256") != plan_hash
            or admitted_usd != Decimal(expected_usd) or value.get("max_minutes") != manifest.get("max_minutes")
            or any(value.get(key) != expected for key, expected in accounting.items())
            or value.get("manifest_sha256") != manifest_sha256
            or value.get("launcher_sha256") != launcher_sha256
            or value.get("training_config_sha256") != training_config_sha256
            or value.get("staging_inventory_sha256") != staging_inventory_sha256):
        raise ExperimentalExecuteError("experimental execution admission does not exactly bind this derived run")
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return value, _hash(raw), _hash(canonical), accounting


def _dispatch_marker(private_root: Path, plan_hash: str, admission_hash: str, admission: dict[str, Any]) -> Path:
    directory = private_root / "experimental-train-dispatch"
    if _is_reparse(directory):
        raise ExperimentalExecuteError("experimental dispatch directory traverses a reparse point")
    directory.mkdir(exist_ok=True)
    directory = _safe_root(directory, "experimental dispatch directory")
    key = hashlib.sha256(f"{plan_hash}:{admission['admission_id']}".encode("ascii")).hexdigest()
    target = directory / f"{key}.json"
    payload = json.dumps({
        "schema": "figment/experimental-train-dispatch@1",
        "plan_sha256": plan_hash,
        "admission_raw_sha256": admission_hash,
        "admission_canonical_sha256": hashlib.sha256(
            json.dumps(admission, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        ).hexdigest(),
        "admission_id": admission["admission_id"],
        "created_utc": datetime.now(timezone.utc).isoformat(),
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    try:
        descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise ExperimentalExecuteError("this plan/admission already has a dispatch marker; recovery or a new admission is required") from exc
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return target


def _receipt(target: Path, *, status: str, plan_hash: str, manifest_hash: str, inventory: list[dict[str, Any]], mode: str, detail: dict[str, Any]) -> None:
    _write_json(target / "experimental-execution.json", {
        "schema": SCHEMA,
        "status": status,
        "not_promotable": True,
        "mode": mode,
        "plan_sha256": plan_hash,
        "manifest_sha256": manifest_hash,
        "staged_train_inventory": inventory,
        "detail": detail,
    })


def _verify_staged(
    target: Path, inventory: list[dict[str, Any],], *, training_config_sha256: str,
    staging_inventory_sha256: str, launcher_sha256: str, manifest_sha256: str,
) -> None:
    root = _safe_root(target, "published experimental execution output")
    dataset = _safe_root(root / "dataset", "published experimental dataset")
    expected_names = {"training.json", "_dataset.ready"}
    for row in inventory:
        for kind in ("image", "caption"):
            value = row.get(kind)
            if not isinstance(value, dict) or not isinstance(value.get("name"), str):
                raise ExperimentalExecuteError("published staging inventory is malformed")
            expected_names.add(value["name"])
    if len(expected_names) != len(inventory) * 2 + 2:
        raise ExperimentalExecuteError("published staging inventory repeats a file name")
    try:
        entries = dataset.iterdir()
        for count, entry in enumerate(entries, start=1):
            if count > len(expected_names):
                raise ExperimentalExecuteError("published staging has extra files or directories")
            if entry.name not in expected_names:
                raise ExperimentalExecuteError("published staging has an unreviewed file or directory")
    except OSError as exc:
        raise ExperimentalExecuteError("cannot enumerate published staging") from exc
    total = 0
    for row in inventory:
        index = row.get("index")
        for kind, maximum in (("image", MAX_IMAGE_BYTES), ("caption", MAX_CAPTION_BYTES)):
            value = row.get(kind)
            if not isinstance(value, dict) or not isinstance(value.get("name"), str):
                raise ExperimentalExecuteError("published staging inventory is malformed")
            path = _safe_file(dataset, dataset / value["name"], f"published staged {kind} {index}")
            count, digest = _file_hash(path, maximum, f"published staged {kind} {index}")
            if count != value.get("bytes") or digest != value.get("sha256"):
                raise ExperimentalExecuteError("published staging file differs from its frozen inventory")
            total += count
            if total > MAX_TOTAL_BYTES:
                raise ExperimentalExecuteError("published staging exceeds its aggregate byte limit")
    config = _safe_file(dataset, dataset / "training.json", "published training config")
    if _file_hash(config, MAX_PLAN_BYTES, "published training config")[1] != training_config_sha256:
        raise ExperimentalExecuteError("published training config differs from its frozen bytes")
    ready = _safe_file(dataset, dataset / "_dataset.ready", "published ready marker")
    if _file_hash(ready, 0, "published ready marker", allow_empty=True) != (0, hashlib.sha256(b"").hexdigest()):
        raise ExperimentalExecuteError("published ready marker differs from the frozen empty marker")
    launcher = _safe_file(root, root / "start-training-aitoolkit.sh.template", "published training launcher")
    if _file_hash(launcher, MAX_LAUNCHER_BYTES, "published training launcher")[1] != launcher_sha256:
        raise ExperimentalExecuteError("published training launcher differs from its frozen bytes")
    manifest = _safe_file(root, root / "runpod-manifest.json", "published runner manifest")
    if _file_hash(manifest, MAX_PLAN_BYTES, "published runner manifest")[1] != manifest_sha256:
        raise ExperimentalExecuteError("published runner manifest differs from its frozen bytes")
    inventory_path = _safe_file(root, root / "staging-inventory.json", "published staging inventory")
    if _file_hash(inventory_path, MAX_PLAN_BYTES, "published staging inventory")[1] != staging_inventory_sha256:
        raise ExperimentalExecuteError("published staging inventory differs from its frozen bytes")


def _verify_live_artifacts(target: Path, result: dict[str, Any], manifest: dict[str, Any]) -> dict[str, str]:
    harness = _safe_root(target / "harness", "experimental harness output")
    run_path = _safe_file(harness, harness / "run.json", "experimental runner receipt")
    run_record, run_raw = _read_json(run_path, MAX_PLAN_BYTES, "experimental runner receipt")
    if (run_record.get("schema") != "figment/runpod-run@1" or run_record.get("dry_run") is not False
            or run_record.get("error") or run_record.get("termination_verified") is not True
            or not isinstance(run_record.get("placement_attempts"), list) or not run_record["placement_attempts"]
            or any(not isinstance(row, dict) or row.get("termination_verified") is not True
                   for row in run_record.get("placement_attempts", []))):
        raise ExperimentalExecuteError("runner receipt is not a terminated live diagnostic result")
    if (result.get("schema") != run_record.get("schema") or result.get("dry_run") is not False
            or result.get("termination_verified") is not True
            or not isinstance(result.get("placement_attempts"), list) or not result["placement_attempts"]
            or any(not isinstance(row, dict) or row.get("termination_verified") is not True
                   for row in result.get("placement_attempts", []))):
        raise ExperimentalExecuteError("harness return disagrees with the runner receipt")
    expected_items = {
        item["remote"]: item for item in manifest["artifacts"]
        if isinstance(item, dict) and isinstance(item.get("remote"), str)
    }
    if len(expected_items) != len(manifest["artifacts"]):
        raise ExperimentalExecuteError("generated manifest has malformed or duplicate artifacts")
    listed = run_record.get("artifacts")
    required_artifact_fields = {"remote", "path", "type", "wait_for", "bytes"}
    if (not isinstance(listed, list) or len(listed) != len(expected_items)
            or any(not isinstance(item, dict) or set(item) != required_artifact_fields for item in listed)):
        raise ExperimentalExecuteError("runner receipt has no artifact list")
    by_remote: dict[str, dict[str, Any]] = {}
    for item in listed:
        remote = item["remote"]
        if (not isinstance(remote, str) or remote in by_remote or remote not in expected_items
                or item["type"] != "output"
                or item["wait_for"] != expected_items[remote].get("wait_for")):
            raise ExperimentalExecuteError("runner receipt artifact list disagrees with the manifest")
        by_remote[remote] = item
    if set(by_remote) != set(expected_items):
        raise ExperimentalExecuteError("runner receipt artifact list disagrees with the manifest")
    hashes = {"run.json": _hash(run_raw)}
    for remote, item in by_remote.items():
        relative = item.get("path")
        if (not isinstance(relative, str) or not relative or "\\" in relative
                or Path(relative).is_absolute() or Path(relative).drive or ".." in Path(relative).parts):
            raise ExperimentalExecuteError("runner receipt has an unsafe artifact path")
        path = _safe_file(harness, harness.joinpath(*Path(relative).parts), f"downloaded artifact {remote}")
        count, digest = _file_hash(path, MAX_ARTIFACT_BYTES, f"downloaded artifact {remote}")
        if item.get("bytes") != count:
            raise ExperimentalExecuteError("runner receipt artifact bytes disagree with the downloaded file")
        hashes[remote] = digest
    return hashes


def execute_experimental_plan(
    plan_path: Path, out: Path, *, private_root: Path = PRIVATE_ROOT,
    dry_run: bool = False, execute: bool = False,
    train_module: Any | None = None, runner: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Prepare, dry-run, or explicitly execute one separately admitted diagnostic plan."""
    if dry_run and execute:
        raise ExperimentalExecuteError("choose at most one of dry_run and execute")
    private = _safe_root(private_root, "private root")
    plan_root = _safe_root(private / PLAN_ROOT_NAME, "experimental plan root")
    plan_file = _safe_file(plan_root, Path(plan_path), "experimental plan")
    if plan_file.parent.parent != plan_root:
        raise ExperimentalExecuteError("experimental plan must be in a direct configured plan-root child")
    plan, plan_raw = _read_json(plan_file, MAX_PLAN_BYTES, "experimental plan")
    experimental = _experimental_module()
    train = train_module or _figment_train_module()
    try:
        context = experimental.revalidate_experimental_plan(
            plan, personas_root=train.PERSONAS_ROOT, train_module=train,
        )
    except experimental.ExperimentalTrainError as exc:
        raise ExperimentalExecuteError(f"experimental plan revalidation refused: {exc}") from exc
    private, target = _fresh_output(private, out)
    temporary = Path(tempfile.mkdtemp(prefix=".experimental-execute-", dir=private))
    mode = "execute" if execute else "dry-run" if dry_run else "prepare"
    inventory: list[dict[str, Any]] = []
    manifest_hash = ""
    training_config_hash = ""
    staging_inventory_hash = ""
    launcher_hash = ""
    try:
        evidence = temporary / "evidence"; evidence.mkdir()
        staging = temporary / "dataset"
        inventory = _stage_dataset(context, staging)
        dataset_root = _safe_root(Path(context["dataset_dir"]), "curated dataset")
        for name, maximum in (("dataset_manifest.json", MAX_PLAN_BYTES), ("dataset_curation.json", MAX_PLAN_BYTES)):
            source = _safe_file(dataset_root, dataset_root / name, name)
            raw = _read_bounded(source, maximum, name)
            (evidence / name).write_bytes(raw)
        (evidence / "experimental-plan.json").write_bytes(plan_raw)
        (evidence / "experimental-review.json").write_bytes(context["review_raw"])
        config_raw = (json.dumps(context["recipe"]["rendered_training_config"], sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode("utf-8")
        training_config_hash = _hash(config_raw)
        (staging / "training.json").write_bytes(config_raw)
        (staging / "_dataset.ready").write_bytes(b"")
        inventory_raw = _write_json(temporary / "staging-inventory.json", {
            "schema": "figment/experimental-training-staging@1",
            "not_promotable": True,
            "plan_sha256": context["plan_sha256"],
            "training_config_sha256": training_config_hash,
            "entries": inventory,
        })
        staging_inventory_hash = _hash(inventory_raw)
        launcher_root = _safe_root(Path(train.TRAIN_START_PATH).parent, "training launcher root")
        launcher_source = _safe_file(launcher_root, Path(train.TRAIN_START_PATH), "training launcher")
        launcher_raw = _read_bounded(launcher_source, MAX_LAUNCHER_BYTES, "training launcher")
        launcher_hash = _hash(launcher_raw)
        manifest, manifest_raw = _render_manifest(
            train, context["creator"], "dataset", training_config_sha256=training_config_hash,
            staging_inventory_sha256=staging_inventory_hash, launcher_sha256=launcher_hash,
        )
        manifest_hash = _hash(manifest_raw)
        (temporary / "start-training-aitoolkit.sh.template").write_bytes(launcher_raw)
        (temporary / "runpod-manifest.json").write_bytes(manifest_raw)
        # A final source revalidation detects mutation after staging and before publish.
        try:
            experimental.revalidate_experimental_plan(plan, personas_root=train.PERSONAS_ROOT, train_module=train)
        except experimental.ExperimentalTrainError as exc:
            raise ExperimentalExecuteError(f"experimental plan changed before execution publish: {exc}") from exc
        os.replace(temporary, target)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise

    detail: dict[str, Any] = {"harness_invoked": False, "provider_call_status": "not-attempted"}
    if not dry_run and not execute:
        _receipt(target, status="prepared", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
        return {"status": "prepared", "out": target, "manifest_sha256": manifest_hash, "not_promotable": True}

    # Recheck source evidence immediately before handing control to the harness.
    try:
        experimental.revalidate_experimental_plan(plan, personas_root=train.PERSONAS_ROOT, train_module=train)
    except experimental.ExperimentalTrainError as exc:
        detail["error_class"] = "revalidation"
        _receipt(target, status="failed", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
        raise ExperimentalExecuteError(f"experimental plan changed before harness call: {exc}") from exc
    try:
        _verify_staged(
            target, inventory, training_config_sha256=training_config_hash,
            staging_inventory_sha256=staging_inventory_hash, launcher_sha256=launcher_hash,
            manifest_sha256=manifest_hash,
        )
    except ExperimentalExecuteError:
        detail["error_class"] = "staged-integrity"
        _receipt(target, status="failed", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
        raise

    invocation: dict[str, Any] = {
        "manifest": manifest,
        "manifest_path": target / "runpod-manifest.json",
        "out_dir": target / "harness",
        "max_minutes": manifest["max_minutes"],
        "dry_run": dry_run,
    }
    if execute:
        admission, admission_hash, admission_canonical_hash, accounting = _admission(
            private, plan_hash=context["plan_sha256"], manifest=manifest, train=train,
            manifest_sha256=manifest_hash, launcher_sha256=launcher_hash,
            training_config_sha256=training_config_hash, staging_inventory_sha256=staging_inventory_hash,
        )
        detail.update({
            "admission_raw_sha256": admission_hash,
            "admission_canonical_sha256": admission_canonical_hash,
            "accounting_ledger_snapshot_sha256": accounting["ledger_snapshot_sha256"],
            "accounting_arc_usd_before": accounting["arc_usd_before"],
        })
        _receipt(target, status="prepared", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
        marker = _dispatch_marker(private, context["plan_sha256"], admission_hash, admission)
        detail.update({"dispatch_marker": str(marker), "harness_invoked": True, "provider_call_status": "unknown"})
        _receipt(target, status="dispatched", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
        invocation.update({
            "max_usd": float(Decimal(train.manifest_ceiling(manifest))),
            "ledger_dir": Path(accounting["ledger_dir"]),
            "budget_path": Path(accounting["daily_budget_path"]),
            "arc_cap_usd": float(Decimal(accounting["arc_cap_usd"])),
            "arc_ledger_glob": accounting["arc_ledger_glob"],
        })
    else:
        invocation["max_usd"] = None
    runner_call = runner or _runner_module().run_harness
    if dry_run:
        detail.update({"harness_invoked": True, "provider_call_status": "not-applicable"})
        _receipt(target, status="prepared", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
    try:
        result = runner_call(**invocation)
    except BaseException as exc:
        detail["error_class"] = type(exc).__name__
        _receipt(target, status="failed", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
        raise
    if not isinstance(result, dict) or result.get("termination_verified") is not True:
        detail["error_class"] = "unverified-termination"
        _receipt(target, status="failed", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
        raise ExperimentalExecuteError("harness returned without verified termination")
    if dry_run:
        detail["runner_schema"] = result.get("schema")
        _receipt(target, status="dry-run-complete", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
        return {"status": "dry-run-complete", "out": target, "manifest_sha256": manifest_hash, "not_promotable": True}
    if result.get("dry_run") is not False or result.get("error"):
        detail["error_class"] = "invalid-live-harness-result"
        _receipt(target, status="failed", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
        raise ExperimentalExecuteError("harness result is not a completed live diagnostic")
    try:
        downloaded = _verify_live_artifacts(target, result, manifest)
    except ExperimentalExecuteError:
        detail["error_class"] = "missing-or-invalid-artifact"
        _receipt(target, status="failed", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
        raise
    detail["runner_schema"] = result.get("schema")
    detail["downloaded_sha256"] = downloaded
    detail["provider_call_status"] = "recorded" if isinstance(result.get("pod_id"), str) else "unknown"
    _receipt(target, status="harness-complete", plan_hash=context["plan_sha256"], manifest_hash=manifest_hash, inventory=inventory, mode=mode, detail=detail)
    return {"status": "harness-complete", "out": target, "manifest_sha256": manifest_hash, "not_promotable": True}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path, help="fresh direct child of the configured private root")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="call the existing harness offline")
    mode.add_argument("--execute", action="store_true", help="explicitly enter a separately admitted live harness call")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = execute_experimental_plan(args.plan, args.out, dry_run=args.dry_run, execute=args.execute)
    except ExperimentalExecuteError as exc:
        print(f"experimental execution refused: {exc}")
        return 2
    print(json.dumps({"status": result["status"], "manifest_sha256": result["manifest_sha256"], "not_promotable": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
