"""Plan and CPU-preflight one local, non-promotable SDXL LoRA observation.

This module never starts a trainer, loads a model, initializes CUDA, exports an
image, or invokes a provider.  It creates a fresh, private snapshot containing
only creator-001's current canonical ``anchors/g01.jpg`` plus one fixed caption
and the fixed 10-step SDXL fit-probe template.  The separate CPU parser command
is an explicit later action; the later GPU fit probe needs a separate admission.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import stat
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PERSONAS_ROOT = ROOT / "orgs" / "figment" / "personas"
TEMPLATE_PATH = HERE / "local_single_observation.toml"
PRIVATE_ROOT = ROOT / "_private"
SCHEMA = "figment/local-single-observation-lora-plan@1"
CREATOR = "creator-001"
TRIGGER = "figmentlocalg01probe"
SOURCE_RELATIVE = Path("creator-001") / "anchors" / "g01.jpg"
MODEL_PATH = Path(r"C:\Users\danie\tools\ComfyUI\models\checkpoints\RealVisXL_V5.0_fp16.safetensors")
MODEL_SHA256 = "6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80"
MODEL_BYTES = 6_938_065_488
SD_SCRIPTS_ROOT = Path(r"C:\Users\danie\tools\lora-trainer\sd-scripts")
SD_SCRIPTS_COMMIT = "37a1cbbc5725ed2a3575506e7bd2001c9908ac92"
SDXL_SCRIPT = SD_SCRIPTS_ROOT / "sdxl_train_network.py"
VENV_PYTHON = Path(r"C:\Users\danie\tools\lora-trainer\venv\Scripts\python.exe")
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 12_000_000
MAX_CAPTION_BYTES = 512


class LocalObservationError(ValueError):
    """A local-only observation plan could not be safely frozen."""


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _file_sha256(path: Path, *, maximum: int | None = None) -> tuple[str, int]:
    try:
        before = path.stat()
        size = before.st_size
    except OSError as exc:
        raise LocalObservationError(f"cannot stat {path.name}") from exc
    if size < 1 or (maximum is not None and size > maximum):
        raise LocalObservationError(f"{path.name} exceeds its bounded size")
    digest = hashlib.sha256()
    loaded = 0
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                loaded += len(chunk)
                if maximum is not None and loaded > maximum:
                    raise LocalObservationError(f"{path.name} exceeds its bounded size")
                digest.update(chunk)
    except OSError as exc:
        raise LocalObservationError(f"cannot read {path.name}") from exc
    try:
        after = path.stat()
    except OSError as exc:
        raise LocalObservationError(f"cannot re-stat {path.name}") from exc
    if loaded != size or after.st_size != size or after.st_mtime_ns != before.st_mtime_ns:
        raise LocalObservationError(f"{path.name} changed while it was read")
    return digest.hexdigest(), size


def _bounded_bytes(path: Path, maximum: int, label: str) -> bytes:
    try:
        before = path.stat()
        if before.st_size < 1 or before.st_size > maximum:
            raise LocalObservationError(f"{label} exceeds its bounded size")
        with path.open("rb") as handle:
            data = handle.read(maximum + 1)
        after = path.stat()
    except OSError as exc:
        raise LocalObservationError(f"cannot read {label}") from exc
    if (len(data) != before.st_size or len(data) > maximum or after.st_size != before.st_size
            or after.st_mtime_ns != before.st_mtime_ns):
        raise LocalObservationError(f"{label} changed while it was read")
    return data


def _sd_scripts_head() -> str:
    prefix = ["git", "-c", f"safe.directory={SD_SCRIPTS_ROOT.as_posix()}", "-C", str(SD_SCRIPTS_ROOT)]
    try:
        completed = subprocess.run(
            [*prefix, "rev-parse", "HEAD"], check=True, shell=False, capture_output=True, text=True, timeout=5,
        )
        status = subprocess.run(
            [*prefix, "status", "--porcelain", "--untracked-files=all"],
            check=True, shell=False, capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise LocalObservationError("cannot verify local sd-scripts pin") from exc
    head = completed.stdout.strip().lower()
    if head != SD_SCRIPTS_COMMIT:
        raise LocalObservationError("local sd-scripts HEAD disagrees with the pinned commit")
    if status.stdout.strip():
        raise LocalObservationError("local sd-scripts worktree is not clean")
    return head


def _is_reparse(path: Path) -> bool:
    try:
        mode = path.lstat().st_mode
    except OSError as exc:
        raise LocalObservationError(f"cannot inspect {path}") from exc
    if stat.S_ISLNK(mode):
        return True
    attrs = getattr(path.lstat(), "st_file_attributes", 0)
    if attrs & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400):
        return True
    return bool(getattr(os.path, "isjunction", lambda _path: False)(path))


def _fixed_regular(path: Path, label: str) -> None:
    try:
        info = path.lstat()
    except OSError as exc:
        raise LocalObservationError(f"required local {label} is unavailable") from exc
    if _is_reparse(path) or not stat.S_ISREG(info.st_mode):
        raise LocalObservationError(f"required local {label} is not a regular file")


def _safe_existing(path: Path, root: Path) -> Path:
    """Refuse links, junctions, and escapes for a member already on disk."""
    if not path.is_absolute():
        raise LocalObservationError("path must be absolute")
    try:
        relative = path.relative_to(root)
    except ValueError as exc:
        raise LocalObservationError("path escapes its fixed root") from exc
    current = root
    if not current.exists() or _is_reparse(current):
        raise LocalObservationError("fixed root is unavailable or reparse-backed")
    for part in relative.parts:
        current = current / part
        if not current.exists() or _is_reparse(current):
            raise LocalObservationError("path is missing or reparse-backed")
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root.resolve(strict=True))
    except (OSError, ValueError) as exc:
        raise LocalObservationError("resolved path escapes its fixed root") from exc
    return resolved


def _safe_fresh_output(private_root: Path, relative: Path) -> Path:
    if relative.is_absolute() or not relative.parts or any(part in {"", ".", ".."} for part in relative.parts):
        raise LocalObservationError("output must be a non-empty private-relative path")
    private_root = private_root.absolute()
    # The default is constrained to this checkout. Tests may inject an isolated root.
    if private_root == PRIVATE_ROOT.absolute():
        if private_root.parent != ROOT or private_root.name != "_private":
            raise LocalObservationError("default private root is not workspace-owned")
    parent = private_root
    while not parent.exists():
        parent = parent.parent
    if _is_reparse(parent):
        raise LocalObservationError("private root ancestor is reparse-backed")
    private_root.mkdir(parents=True, exist_ok=True)
    current = parent
    for part in private_root.relative_to(parent).parts:
        current /= part
        if _is_reparse(current):
            raise LocalObservationError("private root is reparse-backed")
    candidate = private_root.joinpath(*relative.parts)
    try:
        candidate.relative_to(private_root)
    except ValueError as exc:  # pragma: no cover - defensive Windows path check
        raise LocalObservationError("output escapes private root") from exc
    if candidate.exists() or candidate.is_symlink():
        raise LocalObservationError("output must be fresh")
    return candidate


def _read_jpeg(path: Path) -> tuple[bytes, int, int]:
    data = _bounded_bytes(path, MAX_IMAGE_BYTES, "canonical g01")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "JPEG":
                raise LocalObservationError("canonical g01 must be JPEG")
            width, height = image.size
            if width < 1 or height < 1 or width * height > MAX_PIXELS:
                raise LocalObservationError("canonical g01 dimensions exceed the local bound")
            image.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise LocalObservationError("canonical g01 cannot be decoded") from exc
    return data, width, height


def _persona_caption(persona_path: Path) -> tuple[str, str]:
    try:
        raw = _bounded_bytes(persona_path, 64 * 1024, "creator-001 persona")
        persona = json.loads(raw.decode("utf-8"))
        look = persona["identity"]["look"]
        age = look["age_stage"].strip()
        hair = look["hair"].strip()
    except (OSError, KeyError, TypeError, AttributeError, json.JSONDecodeError) as exc:
        raise LocalObservationError("creator-001 persona lacks bounded age and hair text") from exc
    if (not age or not hair or "adult" not in age.casefold()
            or any(ch in age + hair for ch in "\r\n")):
        raise LocalObservationError("persona age or hair wording is not usable for the local caption")
    caption = f"{TRIGGER}, {age}, {hair}, original canonical reference photograph"
    encoded = caption.encode("utf-8")
    if len(encoded) > MAX_CAPTION_BYTES:
        raise LocalObservationError("derived local caption exceeds its bound")
    return caption, _sha256(raw)


def _canonical_json(value: dict[str, Any]) -> bytes:
    copy = dict(value)
    copy.pop("frozen_sha256", None)
    return json.dumps(copy, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


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
        raise LocalObservationError(f"cannot exclusively publish {path.name}") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _cleanup_owned_tree(root: Path) -> None:
    """Best-effort cleanup that never follows a nested link or junction.

    A fresh output may be left behind after a local race instead of risking an
    external deletion.  ``shutil.rmtree`` is deliberately not used because its
    Windows implementation does not promise symlink-attack resistance.
    """
    def remove(path: Path) -> bool:
        try:
            path.relative_to(root)
            info = path.lstat()
        except (OSError, ValueError):
            return False
        if _is_reparse(path):
            return False
        if stat.S_ISREG(info.st_mode):
            try:
                path.unlink()
            except OSError:
                return False
            return True
        if not stat.S_ISDIR(info.st_mode):
            return False
        try:
            with os.scandir(path) as children:
                names = [child.name for child in children]
        except OSError:
            return False
        paths = [path / name for name in names]
        for child in paths:
            try:
                child.relative_to(root)
                if _is_reparse(child):
                    return False
            except (OSError, ValueError):
                return False
        for child in paths:
            if not remove(child):
                return False
        try:
            path.rmdir()
        except OSError:
            return False
        return True

    remove(root)


def build_plan(
    out: Path, *, personas_root: Path = PERSONAS_ROOT, private_root: Path = PRIVATE_ROOT,
) -> dict[str, Any]:
    """Freeze one g01 snapshot and a fit-probe plan. No training code is imported."""
    personas_root = Path(personas_root).absolute()
    g01 = _safe_existing(personas_root / SOURCE_RELATIVE, personas_root)
    persona_path = _safe_existing(personas_root / CREATOR / "persona.yaml", personas_root)
    g01_bytes, width, height = _read_jpeg(g01)
    g01_sha = _sha256(g01_bytes)
    caption, persona_sha = _persona_caption(persona_path)
    template = _safe_existing(TEMPLATE_PATH, HERE)
    template_bytes = _bounded_bytes(template, 16 * 1024, "local fit-probe template")
    _fixed_regular(SDXL_SCRIPT, "SDXL trainer script")
    _fixed_regular(VENV_PYTHON, "Python executable")
    _fixed_regular(MODEL_PATH, "checkpoint")
    model_sha, model_bytes = _file_sha256(MODEL_PATH)
    if model_sha != MODEL_SHA256 or model_bytes != MODEL_BYTES:
        raise LocalObservationError("local checkpoint does not match its pinned provenance")
    _sd_scripts_head()
    destination = _safe_fresh_output(Path(private_root), Path(out))
    owned_destination = False
    try:
        # mkdir is the exclusive output reservation.  The plan JSON is written
        # last and is the visibility marker for this fresh, otherwise private
        # directory; no existing output can be replaced.
        destination.mkdir()
        owned_destination = True
        dataset = destination / "dataset" / f"1_{TRIGGER}"
        dataset.mkdir(parents=True)
        _write_exclusive(dataset / "g01.jpg", g01_bytes)
        _write_exclusive(dataset / "g01.txt", (caption + "\n").encode("utf-8"))
        _write_exclusive(destination / "fit-probe.toml", template_bytes)
        reread_source, _reread_width, _reread_height = _read_jpeg(g01)
        if _sha256(reread_source) != g01_sha:
            raise LocalObservationError("canonical g01 changed after its snapshot")
        files = {
            "g01.jpg": {"sha256": g01_sha, "bytes": len(g01_bytes), "width": width, "height": height},
            "g01.txt": {"sha256": _sha256((caption + "\n").encode("utf-8")), "bytes": len((caption + "\n").encode("utf-8"))},
            "fit-probe.toml": {"sha256": _sha256(template_bytes), "bytes": len(template_bytes)},
        }
        plan: dict[str, Any] = {
            "schema": SCHEMA,
            "purpose": "single-observation-local-sdxl-fit-probe",
            "not_promotable": True,
            "execution": {"cpu_preflight_allowed": True, "gpu_fit_probe_allowed": False,
                          "checkpoint_acceptance_allowed": False, "sample_export_allowed": False},
            "creator": CREATOR,
            "observation": {"count": 1, "kind": "canonical-original-pixels", "crop_training_view": None,
                            "independent_views": 1},
            "source": {"logical_path": "anchors/g01.jpg", "sha256": g01_sha,
                       "bytes": len(g01_bytes), "width": width, "height": height, "format": "JPEG"},
            "caption": caption,
            "staging": {"dataset": f"dataset/1_{TRIGGER}", "files": files},
            "fit_probe": {"max_train_steps": 10, "samples": 0, "exports": 0,
                          "reason": "availability and memory-fit probe only; not a quality evaluation"},
            "trainer": {"script": "sdxl_train_network.py", "sd_scripts_commit": SD_SCRIPTS_COMMIT,
                        "sd_scripts_script_sha256": _file_sha256(SDXL_SCRIPT)[0],
                        "venv_python": str(VENV_PYTHON), "template": "fit-probe.toml"},
            "base_model": {"path": str(MODEL_PATH), "sha256": MODEL_SHA256, "bytes": MODEL_BYTES,
                           "license": "OpenRAIL++", "provenance": "2026-09-08-local-comfy-capability.md"},
            "persona_sha256": persona_sha,
            "generated_utc": datetime.now(timezone.utc).isoformat(),
        }
        plan["frozen_sha256"] = _sha256(_canonical_json(plan))
        _write_exclusive(destination / "local-single-observation-plan.json", json.dumps(plan, sort_keys=True, indent=2).encode("utf-8") + b"\n")
        return plan
    except BaseException:
        if owned_destination:
            _cleanup_owned_tree(destination)
        raise


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="fresh path relative to the fixed private root")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        plan = build_plan(args.out)
    except LocalObservationError as exc:
        print(f"local single-observation plan refused: {exc}")
        return 2
    print(json.dumps({"plan": "local-single-observation-plan.json", "frozen_sha256": plan["frozen_sha256"],
                      "not_promotable": True, "gpu_fit_probe_allowed": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
