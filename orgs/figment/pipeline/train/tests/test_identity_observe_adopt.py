from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest


TRAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRAIN))
import identity_observe_adopt as adopt  # noqa: E402


def _pins(*, admission: str = "pending-independent-review") -> dict:
    pins = json.loads((TRAIN / "identity_observe_pins.json").read_text(encoding="utf-8"))
    pins["admission"] = admission
    return pins


def _write_pins(path: Path, pins: dict) -> None:
    path.write_text(json.dumps(pins), encoding="utf-8")


def test_private_root_rejects_reparse_ancestor(tmp_path: Path, monkeypatch):
    base = tmp_path / "linked-private"
    base.mkdir()
    monkeypatch.setattr(adopt, "PRIVATE_BASE", base)
    monkeypatch.setattr(adopt, "PRIVATE_ROOT", base / "identity-observer")
    monkeypatch.setattr(adopt, "_unsafe_link", lambda path: path.name == "linked-private")
    with pytest.raises(adopt.IdentityObserveAdoptionError, match="ancestors"):
        adopt._private_root()


def test_cleanup_never_recurses_into_nested_reparse_point(tmp_path: Path, monkeypatch):
    base = tmp_path / "private"
    staging = base / ".identity.staging"
    linked = staging / "linked"
    linked.mkdir(parents=True)
    monkeypatch.setattr(adopt, "PRIVATE_BASE", base)
    monkeypatch.setattr(adopt, "_unsafe_link", lambda path: path.name == "linked")
    calls: list[Path] = []
    original_rmdir = os.rmdir

    def rmdir_only(path: Path | str) -> None:
        calls.append(Path(path))
        original_rmdir(path)

    monkeypatch.setattr(adopt.os, "rmdir", rmdir_only)
    adopt._safe_remove_owned_tree(staging)
    assert linked in calls
    assert not staging.exists()


def _sharing_error(code: int) -> OSError:
    error = OSError("Windows sharing violation")
    error.winerror = code
    return error


def test_atomic_publication_retries_one_windows_sharing_violation(tmp_path: Path, monkeypatch):
    calls = 0
    sleeps: list[float] = []
    target = tmp_path / "published.txt"
    temporary = tmp_path / "temporary.part"
    temporary.write_text("verified", encoding="utf-8")
    original_replace = os.replace

    def locked_once(source: Path | str, destination: Path | str) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise _sharing_error(32)
        original_replace(source, destination)

    monkeypatch.setattr(adopt.os, "replace", locked_once)
    monkeypatch.setattr(adopt.time, "sleep", sleeps.append)
    adopt._retry_sharing_violation(lambda: os.replace(temporary, target))
    assert target.read_text(encoding="utf-8") == "verified"
    assert calls == 2
    assert sleeps == [0.1]


def test_atomic_publication_sharing_retry_is_bounded(monkeypatch):
    calls = 0
    sleeps: list[float] = []

    def always_locked() -> None:
        nonlocal calls
        calls += 1
        raise _sharing_error(33)

    monkeypatch.setattr(adopt.time, "sleep", sleeps.append)
    with pytest.raises(OSError, match="sharing"):
        adopt._retry_sharing_violation(always_locked)
    assert calls == len(adopt.SHARING_VIOLATION_RETRIES) + 1
    assert sleeps == list(adopt.SHARING_VIOLATION_RETRIES)


def test_staging_publication_retries_one_windows_sharing_violation(tmp_path: Path, monkeypatch):
    base = tmp_path / "private"
    staging = base / ".identity.staging"
    destination = base / "identity-observer"
    staging.mkdir(parents=True)
    monkeypatch.setattr(adopt, "PRIVATE_BASE", base)
    calls = 0
    sleeps: list[float] = []
    original_replace = os.replace

    def locked_once(source: Path | str, target: Path | str) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise _sharing_error(32)
        original_replace(source, target)

    monkeypatch.setattr(adopt.os, "replace", locked_once)
    monkeypatch.setattr(adopt.time, "sleep", sleeps.append)
    adopt._publish_staging(staging, destination)
    assert calls == 2
    assert sleeps == [0.1]
    assert destination.is_dir() and not staging.exists()


def test_failed_publication_preserves_primary_error_when_part_cleanup_fails(tmp_path: Path, monkeypatch):
    receipt = tmp_path / "adoption.json"
    staging = tmp_path / ".staging"
    staging.mkdir()
    monkeypatch.setattr(adopt, "PRIVATE_BASE", tmp_path)
    monkeypatch.setattr(adopt, "_stage_target", lambda _staging, path, _label: path)
    monkeypatch.setattr(adopt, "_discard_temporary", lambda _path: (_ for _ in ()).throw(_sharing_error(32)))
    monkeypatch.setattr(adopt.os, "replace", lambda _source, _target: (_ for _ in ()).throw(OSError("primary publication failure")))
    with pytest.raises(OSError, match="primary publication"):
        adopt._write_receipt(receipt, {"state": "pending"})


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda pins: pins["runtime"].update({"wheel": "../outside.whl"}), "wheel"),
        (lambda pins: pins["models"][0].update({"filename": "../model.onnx"}), "filename"),
        (lambda pins: pins["models"][0].update({"source_path": "../model.onnx"}), "source path"),
        (lambda pins: pins["models"][0].update({"github_lfs_pointer_path": "../model.onnx"}), "pointer path"),
    ],
)
def test_pin_controlled_paths_cannot_escape_staging(tmp_path: Path, monkeypatch, mutate, message: str):
    pins = _pins()
    mutate(pins)
    manifest = tmp_path / "pins.json"
    _write_pins(manifest, pins)
    monkeypatch.setattr(adopt, "PINS_PATH", manifest)
    with pytest.raises(adopt.IdentityObserveAdoptionError, match=message):
        adopt._load_pins()


def test_preparer_refuses_admitted_pins(tmp_path: Path, monkeypatch):
    manifest = tmp_path / "pins.json"
    _write_pins(manifest, _pins(admission="admitted"))
    monkeypatch.setattr(adopt, "PINS_PATH", manifest)
    with pytest.raises(adopt.IdentityObserveAdoptionError, match="only accepts pending"):
        adopt._load_pins()
