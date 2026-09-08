#!/usr/bin/env python3
"""Prepare the local, hash-verified runtime for the pending identity observer.

Without ``--apply`` this prints a plan and performs neither writes nor network
requests.  ``--apply`` downloads the fixed public model/runtime artifacts plus
the two model-directory license texts, verifies every declared size and SHA-256,
then installs only the verified wheels in a fresh private venv.  It never changes the
observer pin admission, opens an image, or creates a model session.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import re
import stat
import subprocess
import sys
import time
import urllib.request
import uuid
import venv
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
PINS_PATH = HERE / "identity_observe_pins.json"
PRIVATE_ROOT = Path(r"C:\Users\danie\kb\_private\figment-identity-observer-20260908")
PRIVATE_BASE = Path(r"C:\Users\danie\kb\_private")
MAX_LICENSE_BYTES = 128 * 1024
NUMPY_CONSTRAINT = ">=2,<2.3"
NUMPY = {
    "filename": "numpy-2.2.5-cp313-cp313-win_amd64.whl",
    "url": "https://files.pythonhosted.org/packages/13/ae/72e6276feb9ef06787365b05915bfdb057d01fceb4a43cb80978e518d79b/numpy-2.2.5-cp313-cp313-win_amd64.whl",
    "bytes": 12638356,
    "sha256": "d8882a829fd779f0f43998e931c466802a77ca1ee0fe25a3abe50278616b1471",
    "license": "BSD-3-Clause",
    "source": "https://pypi.org/project/numpy/2.2.5/",
}
PILLOW = {
    "filename": "pillow-12.3.0-cp313-cp313-win_amd64.whl",
    "url": "https://files.pythonhosted.org/packages/a6/9b/7a58e61d62be561da3a356fe2384d4059a6345fc130e23ef1c36a5b81d24/pillow-12.3.0-cp313-cp313-win_amd64.whl",
    "bytes": 7239691,
    "sha256": "1cca606cd25738df4ed873d5ad46bbdb3d83b5cbca291f6b4ff13a4df6b0bbe8",
    "license": "MIT-CMU",
    "source": "https://pypi.org/project/pillow/12.3.0/",
}
HEX = re.compile(r"[0-9a-f]{64}\Z")
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
SAFE_COMPONENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
SAFE_PRIVATE_CHILD = re.compile(r"\.?[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
SHARING_VIOLATION_RETRIES = (0.1, 0.2, 0.3, 0.4, 0.5)


class IdentityObserveAdoptionError(RuntimeError):
    pass


def _sharing_violation(error: OSError) -> bool:
    return getattr(error, "winerror", None) in {32, 33}


def _retry_sharing_violation(action):
    """Retry only Windows sharing violations; every other error fails immediately."""
    for delay in (*SHARING_VIOLATION_RETRIES, None):
        try:
            return action()
        except OSError as exc:
            if not _sharing_violation(exc) or delay is None:
                raise
            time.sleep(delay)
    raise AssertionError("unreachable")


def _discard_temporary(path: Path) -> None:
    try:
        _retry_sharing_violation(path.unlink)
    except FileNotFoundError:
        return


def _unsafe_link(path: Path) -> bool:
    try:
        return path.is_symlink() or bool(path.lstat().st_file_attributes & REPARSE_POINT)
    except (AttributeError, OSError):
        return path.is_symlink()


def _sha256(path: Path, maximum: int) -> dict[str, Any]:
    expected = path.stat().st_size
    if expected < 0 or expected > maximum:
        raise IdentityObserveAdoptionError(f"{path.name} exceeds its byte limit")
    digest = hashlib.sha256()
    observed = 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            observed += len(block)
            if observed > maximum:
                raise IdentityObserveAdoptionError(f"{path.name} exceeds its byte limit")
            digest.update(block)
    if observed != expected or path.stat().st_size != expected:
        raise IdentityObserveAdoptionError(f"{path.name} changed while it was read")
    return {"path": path.name, "bytes": observed, "sha256": digest.hexdigest()}


def _safe_leaf(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SAFE_COMPONENT.fullmatch(value) or Path(value).name != value:
        raise IdentityObserveAdoptionError(f"{label} must be a bounded leaf filename")
    return value


def _safe_relative(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 512 or "\\" in value:
        raise IdentityObserveAdoptionError(f"{label} must be a normalized relative path")
    path = Path(value)
    if path.is_absolute() or path.drive or not path.parts or any(not SAFE_COMPONENT.fullmatch(part) for part in path.parts):
        raise IdentityObserveAdoptionError(f"{label} must be a normalized relative path")
    return path.as_posix()


def _trusted_private_base() -> Path:
    base = PRIVATE_BASE.absolute()
    try:
        if not base.is_dir() or any(_unsafe_link(part) for part in (base, *base.parents)):
            raise IdentityObserveAdoptionError("private base and its ancestors must be real non-reparse directories")
        return base.resolve(strict=True)
    except OSError as exc:
        raise IdentityObserveAdoptionError("private base is unavailable") from exc


def _private_child(path: Path, label: str, *, must_exist: bool) -> Path:
    """Validate a direct, non-reparse child of the trusted private base."""
    base = _trusted_private_base()
    target = path.absolute()
    if target.parent != base or not SAFE_PRIVATE_CHILD.fullmatch(target.name):
        raise IdentityObserveAdoptionError(f"{label} is outside the trusted private base")
    if _unsafe_link(target):
        raise IdentityObserveAdoptionError(f"{label} may not be a symlink or reparse point")
    if must_exist and not target.exists():
        raise IdentityObserveAdoptionError(f"{label} is unavailable")
    if target.exists():
        try:
            target.resolve(strict=True).relative_to(base)
        except (OSError, ValueError) as exc:
            raise IdentityObserveAdoptionError(f"{label} escaped the trusted private base") from exc
    return target


def _stage_target(staging: Path, path: Path, label: str) -> Path:
    """Refuse a reparse component before opening any path below staging."""
    staging = _private_child(staging, "staging directory", must_exist=True)
    try:
        relative = path.relative_to(staging)
    except ValueError as exc:
        raise IdentityObserveAdoptionError(f"{label} escaped staging") from exc
    current = staging
    for part in relative.parts:
        current /= part
        if _unsafe_link(current):
            raise IdentityObserveAdoptionError(f"{label} may not traverse a symlink or reparse point")
    return path


def _safe_remove_owned_tree(path: Path) -> None:
    """Remove only the owned staging child; never recurse into a reparse point."""
    target = _private_child(path, "staging cleanup directory", must_exist=True)

    def remove(current: Path) -> None:
        details = current.lstat()
        if _unsafe_link(current):
            # os.rmdir removes a directory junction itself; it does not traverse it.
            try:
                os.rmdir(current)
            except OSError:
                current.unlink()
            return
        if stat.S_ISDIR(details.st_mode):
            for child in current.iterdir():
                remove(child)
            current.rmdir()
        else:
            current.unlink()

    remove(target)


def _load_pins() -> tuple[dict[str, Any], str]:
    try:
        if not PINS_PATH.is_file() or _unsafe_link(PINS_PATH):
            raise IdentityObserveAdoptionError("observer pin manifest is unavailable")
        expected = PINS_PATH.stat().st_size
        if expected > 64 * 1024:
            raise IdentityObserveAdoptionError("observer pin manifest exceeds its byte limit")
        with PINS_PATH.open("rb") as handle:
            raw = handle.read(64 * 1024 + 1)
        if len(raw) != expected or PINS_PATH.stat().st_size != expected or len(raw) > 64 * 1024:
            raise IdentityObserveAdoptionError("observer pin manifest changed while it was read")
    except OSError as exc:
        raise IdentityObserveAdoptionError("observer pin manifest is unavailable") from exc
    try:
        pins = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise IdentityObserveAdoptionError("observer pin manifest is not JSON") from exc
    if not isinstance(pins, dict) or pins.get("schema") != "figment/identity-observer-pins@1":
        raise IdentityObserveAdoptionError("observer pin manifest has an unexpected schema")
    if pins.get("admission") != "pending-independent-review":
        raise IdentityObserveAdoptionError("this preparer only accepts pending observer pins")
    runtime, models = pins.get("runtime"), pins.get("models")
    if not isinstance(runtime, dict) or not isinstance(models, list) or len(models) != 2:
        raise IdentityObserveAdoptionError("observer pin manifest is incomplete")
    if runtime.get("package") != "opencv-python-headless" or runtime.get("version") != "4.12.0.88":
        raise IdentityObserveAdoptionError("unexpected OpenCV runtime pin")
    _safe_leaf(runtime.get("wheel"), "OpenCV wheel")
    if not isinstance(runtime.get("sha256"), str) or not HEX.fullmatch(runtime["sha256"]):
        raise IdentityObserveAdoptionError("OpenCV wheel SHA-256 is invalid")
    roles: set[str] = set()
    filenames: set[str] = set()
    for model in models:
        if not isinstance(model, dict) or not isinstance(model.get("source_repository"), str) or not model["source_repository"].startswith("https://huggingface.co/opencv/"):
            raise IdentityObserveAdoptionError("model source must be the pinned OpenCV Hugging Face repository")
        if not isinstance(model.get("source_revision"), str) or not HEX40.fullmatch(model["source_revision"]):
            raise IdentityObserveAdoptionError("model source revision is not immutable")
        if not isinstance(model.get("bytes"), int) or model["bytes"] <= 0 or not isinstance(model.get("sha256"), str) or not HEX.fullmatch(model["sha256"]):
            raise IdentityObserveAdoptionError("model byte pin is invalid")
        role = model.get("role")
        if role not in {"face_detector", "face_recognizer"} or role in roles:
            raise IdentityObserveAdoptionError("model roles must be unique detector and recognizer")
        roles.add(role)
        filename = _safe_leaf(model.get("filename"), "model filename")
        if filename in filenames:
            raise IdentityObserveAdoptionError("model filenames must be unique")
        filenames.add(filename)
        _safe_leaf(model.get("id"), "model id")
        _safe_relative(model.get("source_path"), "model source path")
        if model.get("github_lfs_pointer_repository") != "https://github.com/opencv/opencv_zoo" or not isinstance(model.get("github_lfs_pointer_revision"), str) or not HEX40.fullmatch(model["github_lfs_pointer_revision"]):
            raise IdentityObserveAdoptionError("GitHub LFS pointer evidence is not immutable")
        _safe_relative(model.get("github_lfs_pointer_path"), "GitHub LFS pointer path")
    if roles != {"face_detector", "face_recognizer"}:
        raise IdentityObserveAdoptionError("model roles are incomplete")
    return pins, hashlib.sha256(raw).hexdigest()


def _version_in_range(value: str) -> bool:
    match = re.fullmatch(r"(\d+)\.(\d+)(?:\.(\d+))?(?:[+._-].*)?", value)
    if not match:
        return False
    major, minor = int(match.group(1)), int(match.group(2))
    return (major, minor) >= (2, 0) and (major, minor) < (2, 3)


def _current_numpy() -> str | None:
    try:
        return importlib.metadata.version("numpy")
    except importlib.metadata.PackageNotFoundError:
        return None


def _model_url(model: dict[str, Any]) -> str:
    return f"{model['source_repository']}/resolve/{model['source_revision']}/{model['source_path']}"


def _license_url(model: dict[str, Any]) -> str:
    directory = model["github_lfs_pointer_path"].rsplit("/", 1)[0]
    return f"https://raw.githubusercontent.com/opencv/opencv_zoo/{model['github_lfs_pointer_revision']}/{directory}/LICENSE"


def _pointer_url(model: dict[str, Any]) -> str:
    return f"https://raw.githubusercontent.com/opencv/opencv_zoo/{model['github_lfs_pointer_revision']}/{model['github_lfs_pointer_path']}"


def _verify_lfs_pointer(path: Path, model: dict[str, Any]) -> None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        raise IdentityObserveAdoptionError(f"invalid Git LFS pointer: {model['id']}") from exc
    expected = ["version https://git-lfs.github.com/spec/v1", f"oid sha256:{model['sha256']}", f"size {model['bytes']}"]
    if lines != expected:
        raise IdentityObserveAdoptionError(f"GitHub LFS pointer disagrees with immutable Hugging Face pin: {model['id']}")


def _download(url: str, target: Path, *, maximum: int, expected_bytes: int | None, expected_sha256: str | None) -> dict[str, Any]:
    """Download one fixed public URL with a hard byte limit and atomic publication."""
    _stage_target(target.parents[1], target, f"download target {target.name}")
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.part")
    digest = hashlib.sha256()
    observed = 0
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "figment-identity-observer-adoption/1"})
        with urllib.request.urlopen(request, timeout=30) as response, temporary.open("xb") as handle:
            while block := response.read(1024 * 1024):
                observed += len(block)
                if observed > maximum:
                    raise IdentityObserveAdoptionError(f"download exceeds limit: {target.name}")
                digest.update(block)
                handle.write(block)
            handle.flush()
            os.fsync(handle.fileno())
        actual = digest.hexdigest()
        if expected_bytes is not None and observed != expected_bytes:
            raise IdentityObserveAdoptionError(f"download byte count mismatch: {target.name}")
        if expected_sha256 is not None and actual != expected_sha256:
            raise IdentityObserveAdoptionError(f"download SHA-256 mismatch: {target.name}")
        _retry_sharing_violation(lambda: os.replace(temporary, target))
        return {"url": url, "bytes": observed, "sha256": actual}
    except Exception:
        # A lock on a .part file must never replace the real download/hash error.
        try:
            _discard_temporary(temporary)
        except OSError:
            pass
        raise


def _install(venv_python: Path, wheel: Path) -> None:
    subprocess.run([str(venv_python), "-m", "pip", "install", "--no-index", "--no-deps", str(wheel)], check=True, stdin=subprocess.DEVNULL)


def _private_root() -> Path:
    root = _private_child(PRIVATE_ROOT, "private observer destination", must_exist=False)
    if root.exists():
        raise IdentityObserveAdoptionError("private observer destination must be fresh")
    return root


def _publish_staging(staging: Path, destination: Path) -> None:
    """Atomically publish the verified staging child with bounded lock handling."""
    _private_child(staging, "staging directory", must_exist=True)
    _private_child(destination, "private observer destination", must_exist=False)
    _retry_sharing_violation(lambda: os.replace(staging, destination))


def _write_receipt(path: Path, value: dict[str, Any]) -> None:
    _stage_target(path.parent, path, "adoption receipt")
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
    try:
        temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        _retry_sharing_violation(lambda: os.replace(temporary, path))
    except Exception:
        # Preserve receipt-serialization/publication errors if cleanup is locked.
        try:
            _discard_temporary(temporary)
        except OSError:
            pass
        raise
    else:
        _discard_temporary(temporary)


def _run_apply(pins: dict[str, Any], pins_sha: str, current_numpy: str | None) -> Path:
    destination = _private_root()
    staging = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.staging")
    _private_child(staging, "staging directory", must_exist=False)
    compatible = current_numpy is not None and _version_in_range(current_numpy)
    published = False
    try:
        staging.mkdir()
        _private_child(staging, "staging directory", must_exist=True)
        (staging / "models").mkdir()
        (staging / "wheels").mkdir()
        (staging / "licenses").mkdir()
        (staging / "lfs-pointers").mkdir()
        downloaded_models: list[dict[str, Any]] = []
        saved_licenses: list[dict[str, Any]] = []
        lfs_pointers: list[dict[str, Any]] = []
        for model in pins["models"]:
            pointer_target = staging / "lfs-pointers" / f"{model['id']}.txt"
            pointer_receipt = _download(_pointer_url(model), pointer_target, maximum=512, expected_bytes=None, expected_sha256=None)
            _verify_lfs_pointer(pointer_target, model)
            lfs_pointers.append({"id": model["id"], "file": _sha256(pointer_target, 512), **pointer_receipt})
            model_target = staging / "models" / model["filename"]
            model_receipt = _download(_model_url(model), model_target, maximum=model["bytes"], expected_bytes=model["bytes"], expected_sha256=model["sha256"])
            downloaded_models.append({"id": model["id"], "file": _sha256(model_target, model["bytes"]), **model_receipt})
            license_target = staging / "licenses" / f"{model['id']}.LICENSE"
            license_receipt = _download(_license_url(model), license_target, maximum=MAX_LICENSE_BYTES, expected_bytes=None, expected_sha256=None)
            saved_licenses.append({"id": model["id"], "file": _sha256(license_target, MAX_LICENSE_BYTES), **license_receipt})
        runtime = pins["runtime"]
        wheel_target = staging / "wheels" / runtime["wheel"]
        wheel_url = f"https://files.pythonhosted.org/packages/f2/35/0858e9e71b36948eafbc5e835874b63e515179dc3b742cbe3d76bc683439/{runtime['wheel']}"
        runtime_wheel = _download(wheel_url, wheel_target, maximum=38923559, expected_bytes=38923559, expected_sha256=runtime["sha256"])
        numpy_wheel: dict[str, Any] | None = None
        if not compatible:
            numpy_target = staging / "wheels" / NUMPY["filename"]
            numpy_wheel = _download(NUMPY["url"], numpy_target, maximum=NUMPY["bytes"], expected_bytes=NUMPY["bytes"], expected_sha256=NUMPY["sha256"])
        receipt = {
            "schema": "figment/identity-observer-adoption@1",
            "pins": {"path": str(PINS_PATH), "sha256": pins_sha, "admission_at_install": pins["admission"]},
            "models": downloaded_models,
            "github_lfs_pointers": lfs_pointers,
            "licenses": saved_licenses,
            "runtime": {"wheel": runtime_wheel, "numpy_constraint": NUMPY_CONSTRAINT, "host_numpy": current_numpy, "system_site_packages": compatible, "fallback_numpy_wheel": numpy_wheel, "pillow_wheel": None},
            "state": "verified-artifacts; venv-not-created",
            "limitations": "Prepared local artifacts only. This receipt neither admits model pins nor records an observer result, approval, gate, or threshold.",
        }
        pillow_target = staging / "wheels" / PILLOW["filename"]
        pillow_wheel = _download(PILLOW["url"], pillow_target, maximum=PILLOW["bytes"], expected_bytes=PILLOW["bytes"], expected_sha256=PILLOW["sha256"])
        receipt["runtime"]["pillow_wheel"] = pillow_wheel
        _write_receipt(staging / "adoption.json", receipt)
        _publish_staging(staging, destination)
        published = True
        # A venv records absolute interpreter paths; create it only after the verified
        # artifacts have their final private location.
        builder = venv.EnvBuilder(with_pip=True, system_site_packages=compatible, clear=False)
        builder.create(destination / "venv")
        venv_python = destination / "venv" / "Scripts" / "python.exe"
        if not venv_python.is_file():
            raise IdentityObserveAdoptionError("created venv lacks Windows python.exe")
        if not compatible:
            _install(venv_python, destination / "wheels" / NUMPY["filename"])
        _install(venv_python, destination / "wheels" / PILLOW["filename"])
        _install(venv_python, destination / "wheels" / runtime["wheel"])
        installed = subprocess.check_output([str(venv_python), "-c", "import importlib.metadata as m; print(m.version('numpy')); print(m.version('Pillow')); print(m.version('opencv-python-headless'))"], text=True).splitlines()
        if len(installed) != 3 or not _version_in_range(installed[0]) or installed[1] != "12.3.0" or installed[2] != runtime["version"]:
            raise IdentityObserveAdoptionError("final venv does not contain the pinned NumPy, Pillow, and OpenCV versions")
        receipt["runtime"].update({"venv_numpy": installed[0], "venv_pillow": installed[1], "venv_opencv_distribution": installed[2]})
        receipt["state"] = "verified-artifacts-and-venv"
        _write_receipt(destination / "adoption.json", receipt)
        return destination
    except Exception as exc:
        if staging.exists():
            _safe_remove_owned_tree(staging)
        if published and destination.exists() and not _unsafe_link(destination):
            try:
                _private_child(destination, "private observer destination", must_exist=True)
                receipt_path = destination / "adoption.json"
                receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
                receipt["state"] = "verified-artifacts; venv-preparation-failed"
                receipt["venv_error"] = str(exc)
                _write_receipt(receipt_path, receipt)
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                pass
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="perform the bounded local preparation; default is a no-I/O plan")
    args = parser.parse_args(argv)
    try:
        pins, pins_sha = _load_pins()
        current_numpy = _current_numpy()
        compatible = current_numpy is not None and _version_in_range(current_numpy)
        plan = {"destination": str(PRIVATE_ROOT), "pins_sha256": pins_sha, "current_numpy": current_numpy, "numpy_constraint": NUMPY_CONSTRAINT, "venv_system_site_packages": compatible, "downloads": [model["filename"] for model in pins["models"]] + [pins["runtime"]["wheel"], PILLOW["filename"]] + ([] if compatible else [NUMPY["filename"]]), "pin_admission_unchanged": pins["admission"]}
        if not args.apply:
            print(json.dumps(plan, indent=2, sort_keys=True))
            return 0
        print(_run_apply(pins, pins_sha, current_numpy))
        return 0
    except IdentityObserveAdoptionError as exc:
        parser.error(str(exc))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
