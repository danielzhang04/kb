"""Prepare or explicitly load an isolated, local SDXL tokenizer cache.

Preparation copies only ten pinned tokenizer files into a fresh Figment-private
directory.  It does not import Transformers, torch, a model, or a trainer.
``--load`` is an explicit fixed-venv action: it loads only the two local
``CLIPTokenizer`` directories with offline flags and records token counts, not
token IDs, embeddings, models, or a training decision.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PRIVATE_ROOT = ROOT / "_private"
HUB_ROOT = Path(r"C:\Users\danie\.cache\huggingface\hub")
VENV_PYTHON = Path(r"C:\Users\danie\tools\lora-trainer\venv\Scripts\python.exe")
SCHEMA = "figment/local-tokenizer-prepared@1"
LOAD_SCHEMA = "figment/local-tokenizer-load@1"
PREPARED_NAME = "local-tokenizer-prepared.json"
LOAD_NAME = "local-tokenizer-load.json"
HF_HOME_NAME = ".hf-home"
MAX_FILE_BYTES = 3 * 1024 * 1024
MAX_TOTAL_BYTES = 8 * 1024 * 1024
MAX_RECEIPT_BYTES = 32 * 1024
SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,80}\Z")
CAPTION_PROBE = "figmentlocalg01probe, an adult woman, original canonical reference photograph"

PINNED_INVENTORY: tuple[dict[str, Any], ...] = (
    {
        "id": "openai/clip-vit-large-patch14",
        "model_directory": "models--openai--clip-vit-large-patch14",
        "snapshot": "32bd64288804d66eefd0ccbe215aa642df71cc41",
        "cache_directory": "openai_clip-vit-large-patch14",
        "files": (
            ("merges.txt", 524619, "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a"),
            ("special_tokens_map.json", 389, "f8c0d6c39aee3f8431078ef6646567b0aba7f2246e9c54b8b99d55c22b707cbf"),
            ("tokenizer.json", 2224003, "a83e0809aa4c3af7208b2df632a7a69668c6d48775b3c3fe4e1b1199d1f8b8f4"),
            ("tokenizer_config.json", 905, "deef455e52fa5e8151e339add0582e4235f066009601360999d3a9cda83b1129"),
            ("vocab.json", 961143, "3f0c4f7d2086b61b38487075278ea9ed04edb53a03cbb045b86c27190fa8fb69"),
        ),
    },
    {
        "id": "laion/CLIP-ViT-bigG-14-laion2B-39B-b160k",
        "model_directory": "models--laion--CLIP-ViT-bigG-14-laion2B-39B-b160k",
        "snapshot": "743c27bd53dfe508a0ade0f50698f99b39d03bec",
        "cache_directory": "laion_CLIP-ViT-bigG-14-laion2B-39B-b160k",
        "files": (
            ("merges.txt", 524619, "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a"),
            ("special_tokens_map.json", 389, "f8c0d6c39aee3f8431078ef6646567b0aba7f2246e9c54b8b99d55c22b707cbf"),
            ("tokenizer.json", 2224041, "b556ac8c99757ffb677208af34bc8c6721572114111a6e0aaf5fa69ff0b8d842"),
            ("tokenizer_config.json", 904, "e19f34ef773563fb695f96cfcae1e4c7b112ab6ad532f6962061df5242d924f0"),
            ("vocab.json", 862328, "5047b556ce86ccaf6aa22b3ffccfc52d391ea4accdab9c2f2407da5b742d4363"),
        ),
    },
)


class TokenizerPreflightError(ValueError):
    """The bounded local tokenizer preparation or load is unsafe or stale."""


def _is_reparse(path: Path) -> bool:
    try:
        return path.is_symlink() or bool(path.lstat().st_file_attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
    except (AttributeError, OSError):
        return path.is_symlink()


def _real_directory(path: Path, label: str) -> Path:
    lexical = path.absolute()
    try:
        if not lexical.is_dir() or any(_is_reparse(item) for item in (lexical, *lexical.parents)):
            raise TokenizerPreflightError(f"{label} and its ancestors must be real directories")
        return lexical.resolve(strict=True)
    except OSError as exc:
        raise TokenizerPreflightError(f"{label} is unavailable") from exc


def _safe_child(root: Path, name: str, *, exists: bool) -> Path:
    if not isinstance(name, str) or not SAFE_NAME.fullmatch(name):
        raise TokenizerPreflightError("output name must be one safe private-directory component")
    path = root / name
    if path.exists() != exists or _is_reparse(path):
        raise TokenizerPreflightError("private tokenizer output must have the requested fresh/existing state")
    if exists and not path.is_dir():
        raise TokenizerPreflightError("private tokenizer output is not a directory")
    return path


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _inventory_sha256() -> str:
    return hashlib.sha256(_canonical(PINNED_INVENTORY)).hexdigest()


def _source_snapshots() -> list[dict[str, str]]:
    return [{"id": spec["id"], "snapshot": spec["snapshot"]} for spec in PINNED_INVENTORY]


def _bounded_regular(path: Path, label: str, maximum: int) -> tuple[bytes, str]:
    try:
        before = path.lstat()
        if _is_reparse(path) or not stat.S_ISREG(before.st_mode) or before.st_size < 1 or before.st_size > maximum:
            raise TokenizerPreflightError(f"{label} is not a bounded regular file")
        with path.open("rb") as handle:
            data = handle.read(maximum + 1)
        after = path.lstat()
    except OSError as exc:
        raise TokenizerPreflightError(f"cannot read {label}") from exc
    if (len(data) != before.st_size or len(data) > maximum or after.st_size != before.st_size
            or after.st_mtime_ns != before.st_mtime_ns or _is_reparse(path)):
        raise TokenizerPreflightError(f"{label} changed while it was read")
    return data, hashlib.sha256(data).hexdigest()


def _source_blob(spec: dict[str, Any], filename: str) -> Path:
    model = HUB_ROOT / spec["model_directory"]
    snapshots = model / "snapshots" / spec["snapshot"]
    blobs = model / "blobs"
    _real_directory(HUB_ROOT, "Hugging Face cache root")
    _real_directory(model, "tokenizer model cache")
    _real_directory(snapshots, "tokenizer snapshot")
    _real_directory(blobs, "tokenizer blob cache")
    entry = snapshots / filename
    try:
        if not entry.is_symlink():
            raise TokenizerPreflightError("tokenizer snapshot entry must be the expected symlink")
        target = os.readlink(entry)
        relative_target = Path(target)
        if relative_target.is_absolute() or relative_target.drive or ".." not in relative_target.parts:
            raise TokenizerPreflightError("tokenizer snapshot symlink target is unsafe")
        blob = (entry.parent / relative_target).resolve(strict=True)
        blob.relative_to(blobs.resolve(strict=True))
        if blob.parent != blobs.resolve(strict=True):
            raise TokenizerPreflightError("tokenizer source must resolve directly below its blobs directory")
    except TokenizerPreflightError:
        raise
    except (OSError, ValueError) as exc:
        raise TokenizerPreflightError("tokenizer snapshot does not resolve to its local blob cache") from exc
    if _is_reparse(blob):
        raise TokenizerPreflightError("tokenizer blob must be a regular non-reparse file")
    return blob


def _write_exclusive(path: Path, data: bytes) -> None:
    descriptor = None
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as exc:
        raise TokenizerPreflightError(f"cannot exclusively write {path.name}") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _records_from_output(root: Path, *, prepared: bool, load_receipt: bool = False) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    total = 0
    expected_root_names = {item["cache_directory"] for item in PINNED_INVENTORY} | {HF_HOME_NAME}
    if prepared:
        expected_root_names.add(PREPARED_NAME)
    if load_receipt:
        expected_root_names.add(LOAD_NAME)
    observed_root_names: set[str] = set()
    try:
        with os.scandir(root) as members:
            for member in members:
                observed_root_names.add(member.name)
                if len(observed_root_names) > len(expected_root_names):
                    raise TokenizerPreflightError("prepared tokenizer root inventory exceeds its bound")
    except OSError as exc:
        raise TokenizerPreflightError("prepared tokenizer root inventory is unavailable") from exc
    if observed_root_names != expected_root_names:
        raise TokenizerPreflightError("prepared tokenizer root has stale, missing, or extra members")
    for spec in PINNED_INVENTORY:
        directory = root / spec["cache_directory"]
        if _is_reparse(directory) or not directory.is_dir():
            raise TokenizerPreflightError("prepared tokenizer directory is unsafe")
        expected_files = {item[0] for item in spec["files"]}
        observed_files: set[str] = set()
        try:
            with os.scandir(directory) as members:
                for member in members:
                    observed_files.add(member.name)
                    if len(observed_files) > len(expected_files):
                        raise TokenizerPreflightError("prepared tokenizer directory inventory exceeds its bound")
        except OSError as exc:
            raise TokenizerPreflightError("prepared tokenizer directory inventory is unavailable") from exc
        if observed_files != expected_files:
            raise TokenizerPreflightError("prepared tokenizer directory has stale, missing, or extra files")
        for filename, expected_bytes, expected_sha in spec["files"]:
            data, actual_sha = _bounded_regular(directory / filename, "prepared tokenizer file", MAX_FILE_BYTES)
            if len(data) != expected_bytes or actual_sha != expected_sha:
                raise TokenizerPreflightError("prepared tokenizer file disagrees with pinned inventory")
            total += len(data)
            records.append({"tokenizer": spec["id"], "path": f"{spec['cache_directory']}/{filename}", "bytes": len(data), "sha256": actual_sha})
    home = root / HF_HOME_NAME
    if _is_reparse(home) or not home.is_dir():
        raise TokenizerPreflightError("isolated Hugging Face home is unsafe")
    if total > MAX_TOTAL_BYTES:
        raise TokenizerPreflightError("prepared tokenizer aggregate exceeds its bound")
    return records


def _read_receipt(path: Path) -> tuple[dict[str, Any], bytes]:
    raw, _ = _bounded_regular(path, "prepared tokenizer receipt", MAX_RECEIPT_BYTES)
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TokenizerPreflightError("prepared tokenizer receipt is malformed") from exc
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise TokenizerPreflightError("prepared tokenizer receipt has an unsupported schema")
    frozen = value.get("frozen_sha256")
    content = dict(value)
    content.pop("frozen_sha256", None)
    if not isinstance(frozen, str) or hashlib.sha256(_canonical(content)).hexdigest() != frozen:
        raise TokenizerPreflightError("prepared tokenizer receipt hash is invalid")
    return value, raw


def prepare(out: str) -> dict[str, Any]:
    """Copy exactly ten verified tokenizer files. No runtime library is imported."""
    private = _real_directory(PRIVATE_ROOT, "Figment private root")
    destination = _safe_child(private, out, exists=False)
    destination.mkdir()
    try:
        (destination / HF_HOME_NAME).mkdir()
        copied: list[dict[str, Any]] = []
        total = 0
        for spec in PINNED_INVENTORY:
            directory = destination / spec["cache_directory"]
            directory.mkdir()
            for filename, expected_bytes, expected_sha in spec["files"]:
                source = _source_blob(spec, filename)
                data, actual_sha = _bounded_regular(source, "tokenizer source blob", MAX_FILE_BYTES)
                if len(data) != expected_bytes or actual_sha != expected_sha:
                    raise TokenizerPreflightError("tokenizer source blob disagrees with pinned inventory")
                total += len(data)
                if total > MAX_TOTAL_BYTES:
                    raise TokenizerPreflightError("tokenizer aggregate exceeds its bound")
                target = directory / filename
                _write_exclusive(target, data)
                copied.append({"tokenizer": spec["id"], "path": f"{spec['cache_directory']}/{filename}", "bytes": len(data), "sha256": actual_sha})
        current_copies = _records_from_output(destination, prepared=False)
        if current_copies != copied:
            raise TokenizerPreflightError("prepared tokenizer copies changed before receipt publication")
        receipt: dict[str, Any] = {
            "schema": SCHEMA,
            "purpose": "isolated-local-sdxl-tokenizer-cache",
            "not_promotable": True,
            "runtime_or_training_approval": False,
            "inventory_sha256": _inventory_sha256(),
            "source_snapshots": _source_snapshots(),
            "copies": current_copies,
            "total_bytes": total,
        }
        receipt["frozen_sha256"] = hashlib.sha256(_canonical(receipt)).hexdigest()
        _write_exclusive(destination / PREPARED_NAME, json.dumps(receipt, sort_keys=True, indent=2).encode("utf-8") + b"\n")
        return receipt
    except BaseException:
        # A partial fresh output is intentionally retained for inspection rather
        # than recursively deleting through a raced Windows reparse point.
        raise


def _cuda_observation() -> dict[str, Any]:
    torch = sys.modules.get("torch")
    if torch is None:
        return {"torch_imported": False, "cuda_initialized": False, "cuda_available": None, "cuda_device_count": None}
    cuda = getattr(torch, "cuda", None)
    initialized = getattr(cuda, "is_initialized", None)
    available = getattr(cuda, "is_available", None)
    count = getattr(cuda, "device_count", None)
    try:
        return {
            "torch_imported": True,
            "cuda_initialized": bool(initialized()) if callable(initialized) else False,
            "cuda_available": bool(available()) if callable(available) else False,
            "cuda_device_count": int(count()) if callable(count) else 0,
        }
    except Exception as exc:
        raise TokenizerPreflightError("CUDA observation failed without initializing a tokenizer model") from exc


def _require_no_cuda(stage: str) -> dict[str, Any]:
    state = _cuda_observation()
    if state["cuda_initialized"] or (state["torch_imported"] and (state["cuda_available"] is not False or state["cuda_device_count"] != 0)):
        raise TokenizerPreflightError(f"{stage} exposed or initialized CUDA")
    return state


def _load_tokenizers(root: Path) -> list[dict[str, Any]]:
    fixed_venv = VENV_PYTHON.absolute()
    if Path(sys.executable).absolute() != fixed_venv:
        raise TokenizerPreflightError("--load requires the fixed local trainer virtual environment")
    try:
        _real_directory(fixed_venv.parent, "fixed local trainer virtual environment")
        if _is_reparse(fixed_venv) or not fixed_venv.is_file():
            raise TokenizerPreflightError("fixed local trainer Python is unsafe")
    except OSError as exc:
        raise TokenizerPreflightError("fixed local trainer Python is unavailable") from exc
    if _cuda_observation()["cuda_initialized"]:
        raise TokenizerPreflightError("CUDA was already initialized before tokenizer loading")
    os.environ.update({
        "CUDA_VISIBLE_DEVICES": "-1", "PYTORCH_NVML_BASED_CUDA_CHECK": "1",
        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
        "HF_HOME": str(root / HF_HOME_NAME), "NO_PROXY": "*", "HTTP_PROXY": "", "HTTPS_PROXY": "",
    })
    try:
        from transformers import CLIPTokenizer
    except Exception as exc:
        raise TokenizerPreflightError("fixed venv cannot import CLIPTokenizer") from exc
    _require_no_cuda("CLIPTokenizer import")
    results: list[dict[str, Any]] = []
    for index, spec in enumerate(PINNED_INVENTORY):
        try:
            tokenizer = CLIPTokenizer.from_pretrained(str(root / spec["cache_directory"]), local_files_only=True)
            if index == 1:
                tokenizer.pad_token_id = 0
            input_ids = tokenizer(CAPTION_PROBE, truncation=True, max_length=77, return_tensors=None)["input_ids"]
        except Exception as exc:
            raise TokenizerPreflightError("local tokenizer load or caption tokenization failed") from exc
        if not isinstance(input_ids, list) or not input_ids:
            raise TokenizerPreflightError("local tokenizer produced no caption token IDs")
        results.append({"id": spec["id"], "class": type(tokenizer).__name__, "effective_pad_token_id": tokenizer.pad_token_id,
                        "caption_token_count": len(input_ids), "local_files_only": True})
    _require_no_cuda("tokenizer loading")
    return results


def load(out: str) -> dict[str, Any]:
    """Explicitly load only the prepared local tokenizers under offline flags."""
    private = _real_directory(PRIVATE_ROOT, "Figment private root")
    root = _safe_child(private, out, exists=True)
    if _is_reparse(root / LOAD_NAME) or (root / LOAD_NAME).exists():
        raise TokenizerPreflightError("tokenizer load receipt must be fresh")
    prepared, prepared_raw = _read_receipt(root / PREPARED_NAME)
    copies = _records_from_output(root, prepared=True)
    prepared_content = dict(prepared)
    prepared_content.pop("frozen_sha256", None)
    expected_prepared = {
        "schema": SCHEMA,
        "purpose": "isolated-local-sdxl-tokenizer-cache",
        "not_promotable": True,
        "runtime_or_training_approval": False,
        "inventory_sha256": _inventory_sha256(),
        "source_snapshots": _source_snapshots(),
        "copies": copies,
        "total_bytes": sum(record["bytes"] for record in copies),
    }
    if prepared_content != expected_prepared:
        raise TokenizerPreflightError("prepared tokenizer receipt disagrees with current copied files")
    tokenizers = _load_tokenizers(root)
    cuda = _require_no_cuda("tokenizer receipt publication")
    # The tokenizer library has just opened these files.  Re-read the exact
    # prepared receipt and every copy before publishing a load receipt, so a
    # concurrent change cannot be attributed to the earlier hashes.
    try:
        prepared_after, prepared_raw_after = _read_receipt(root / PREPARED_NAME)
        copies_after = _records_from_output(root, prepared=True)
    except TokenizerPreflightError as exc:
        raise TokenizerPreflightError("prepared tokenizer inputs changed during explicit loading") from exc
    if prepared_raw_after != prepared_raw or prepared_after != prepared or copies_after != copies:
        raise TokenizerPreflightError("prepared tokenizer inputs changed during explicit loading")
    record: dict[str, Any] = {
        "schema": LOAD_SCHEMA,
        "purpose": "explicit-local-tokenizer-load-only",
        "not_promotable": True,
        "runtime_or_training_approval": False,
        "prepared_receipt_sha256": hashlib.sha256(prepared_raw).hexdigest(),
        "inventory_sha256": _inventory_sha256(),
        "copies": copies_after,
        "caption_sha256": hashlib.sha256(CAPTION_PROBE.encode("utf-8")).hexdigest(),
        "tokenizers": tokenizers,
        "cuda_visible_devices": os.environ.get("CUDA_VISIBLE_DEVICES"),
        "pytorch_nvml_based_cuda_check": os.environ.get("PYTORCH_NVML_BASED_CUDA_CHECK"),
        **cuda,
    }
    record["frozen_sha256"] = hashlib.sha256(_canonical(record)).hexdigest()
    _write_exclusive(root / LOAD_NAME, json.dumps(record, sort_keys=True, indent=2).encode("utf-8") + b"\n")
    return record


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    def out_name(value: str) -> str:
        if not SAFE_NAME.fullmatch(value):
            raise argparse.ArgumentTypeError("--out must be one safe private-directory component")
        return value
    parser.add_argument("--out", required=True, type=out_name, help="one fresh/existing direct child of the fixed Figment private root")
    parser.add_argument("--load", action="store_true", help="explicitly load prepared local tokenizers using only the fixed venv")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        record = load(args.out) if args.load else prepare(args.out)
    except TokenizerPreflightError as exc:
        print(f"local tokenizer preflight refused: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"schema": record["schema"], "frozen_sha256": record["frozen_sha256"], "not_promotable": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
