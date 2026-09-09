from __future__ import annotations

import copy
import os
from pathlib import Path

import pytest

from scripts.prospecting.dev_jobs import (
    DevJobValidationError,
    MAX_FILE_BYTES,
    snapshot,
    validate_manifest,
    validate_outputs,
    validate_relative,
    verify_local_base,
)


@pytest.mark.parametrize(
    "value",
    [
        "",
        "/absolute.py",
        "../escape.py",
        "a/./b.py",
        "a//b.py",
        "a\\b.py",
        "C:drive.py",
        "line\nbreak.py",
        "src/.git/config",
        "src/.ENV/value",
        "src/.env.local/value",
        "src/.env.production",
        "src/.ssh/key",
        "src/.credentials/item",
        "src/trailing./item.py",
        "nul.txt",
        "a" * 241,
    ],
)
def test_validate_relative_rejects_nonportable_or_sensitive_paths(value: str) -> None:
    with pytest.raises(DevJobValidationError):
        validate_relative(value)


def test_validate_relative_accepts_canonical_posix_path() -> None:
    assert validate_relative("scripts/prospecting/dev_jobs.py") == "scripts/prospecting/dev_jobs.py"
    assert validate_relative("config/.env.example") == "config/.env.example"


@pytest.fixture
def root_beneath_link(tmp_path: Path) -> tuple[Path, Path]:
    real_parent = tmp_path / "real-parent"
    root = real_parent / "root"
    root.mkdir(parents=True)
    (root / "src.py").write_text("source", encoding="utf-8")
    alias = tmp_path / "alias"
    try:
        alias.symlink_to(real_parent, target_is_directory=True)
    except OSError:
        pytest.skip("directory links unavailable")
    return alias / "root", root


def test_snapshot_rejects_root_beneath_link(root_beneath_link: tuple[Path, Path]) -> None:
    alias_root, _ = root_beneath_link
    with pytest.raises(DevJobValidationError, match="^root_unsafe$"):
        snapshot(alias_root, ["src.py"], ["out.py"])


def test_validate_outputs_rejects_root_beneath_link(
    root_beneath_link: tuple[Path, Path], tmp_path: Path
) -> None:
    alias_root, real_root = root_beneath_link
    manifest = snapshot(real_root, ["src.py"], ["out.py"])
    with pytest.raises(DevJobValidationError, match="^root_unsafe$"):
        validate_outputs(alias_root, manifest)


def test_verify_local_base_rejects_root_beneath_link(
    root_beneath_link: tuple[Path, Path]
) -> None:
    alias_root, real_root = root_beneath_link
    manifest = snapshot(real_root, ["src.py"], ["out.py"])
    with pytest.raises(DevJobValidationError, match="^root_unsafe$"):
        verify_local_base(alias_root, manifest, ["out.py"])


def test_snapshot_hashes_inputs_and_records_output_baselines(tmp_path: Path) -> None:
    source = tmp_path / "src.py"
    source.write_bytes(b"before\n")

    manifest = snapshot(tmp_path, ["src.py"], ["src.py", "new.py"])

    source_meta = manifest["inputs"][0]
    assert source_meta == {
        "path": "src.py",
        "sha256": "9160d4be34c8695bd172a76c7c7966587ea5a4d991ad22c87b2b91af54aa9ebb",
        "size": 7,
    }
    assert manifest["output_base"] == {
        "new.py": None,
        "src.py": {"sha256": source_meta["sha256"], "size": 7},
    }
    assert validate_manifest(manifest) == manifest


def test_snapshot_requires_existing_output_in_input_list(tmp_path: Path) -> None:
    (tmp_path / "input.py").write_text("input", encoding="utf-8")
    (tmp_path / "output.py").write_text("old", encoding="utf-8")

    with pytest.raises(DevJobValidationError, match="^output_not_input$"):
        snapshot(tmp_path, ["input.py"], ["output.py"])


def test_snapshot_rejects_duplicate_paths_and_oversize_file(tmp_path: Path) -> None:
    (tmp_path / "input.py").write_bytes(b"x" * (MAX_FILE_BYTES + 1))
    with pytest.raises(DevJobValidationError, match="^path_duplicate$"):
        snapshot(tmp_path, ["input.py", "INPUT.py"], ["out.py"])
    with pytest.raises(DevJobValidationError, match="^file_oversize$"):
        snapshot(tmp_path, ["input.py"], ["out.py"])


def test_snapshot_rejects_symlink_ancestor(tmp_path: Path) -> None:
    real = tmp_path / "real"
    real.mkdir()
    (real / "input.py").write_text("safe", encoding="utf-8")
    linked = tmp_path / "linked"
    try:
        linked.symlink_to(real, target_is_directory=True)
    except OSError:
        pytest.skip("symlinks unavailable")
    with pytest.raises(DevJobValidationError, match="^path_unsafe$"):
        snapshot(tmp_path, ["linked/input.py"], ["out.py"])


def test_snapshot_rejects_hardlinked_file(tmp_path: Path) -> None:
    source = tmp_path / "source.py"
    source.write_text("safe", encoding="utf-8")
    hardlink = tmp_path / "hardlink.py"
    os.link(source, hardlink)
    with pytest.raises(DevJobValidationError, match="^file_links$"):
        snapshot(tmp_path, ["hardlink.py"], ["out.py"])


def test_validate_manifest_rejects_schema_type_and_baseline_confusion(tmp_path: Path) -> None:
    (tmp_path / "src.py").write_text("source", encoding="utf-8")
    manifest = snapshot(tmp_path, ["src.py"], ["out.py"])

    extra = copy.deepcopy(manifest)
    extra["extra"] = False
    with pytest.raises(DevJobValidationError, match="^manifest_schema$"):
        validate_manifest(extra)

    boolean_version = copy.deepcopy(manifest)
    boolean_version["version"] = True
    with pytest.raises(DevJobValidationError, match="^manifest_version$"):
        validate_manifest(boolean_version)

    boolean_size = copy.deepcopy(manifest)
    boolean_size["inputs"][0]["size"] = True
    with pytest.raises(DevJobValidationError, match="^size_invalid$"):
        validate_manifest(boolean_size)

    zero_limit = copy.deepcopy(manifest)
    zero_limit["limits"]["max_file_bytes"] = 0
    with pytest.raises(DevJobValidationError, match="^limits_invalid$"):
        validate_manifest(zero_limit)

    forged_base = copy.deepcopy(manifest)
    forged_base["output_base"]["out.py"] = {
        "sha256": manifest["inputs"][0]["sha256"],
        "size": manifest["inputs"][0]["size"],
    }
    with pytest.raises(DevJobValidationError, match="^output_base_invalid$"):
        validate_manifest(forged_base)


def test_validate_outputs_returns_only_allowed_changed_files(tmp_path: Path) -> None:
    local = tmp_path / "local"
    local.mkdir()
    (local / "same.py").write_text("same", encoding="utf-8")
    (local / "changed.py").write_text("before", encoding="utf-8")
    manifest = snapshot(local, ["same.py", "changed.py"], ["same.py", "changed.py", "new.py"])

    collected = tmp_path / "collected"
    collected.mkdir()
    (collected / "same.py").write_text("same", encoding="utf-8")
    (collected / "changed.py").write_text("after", encoding="utf-8")
    (collected / "new.py").write_text("new", encoding="utf-8")

    changed = validate_outputs(collected, manifest)

    assert [item["path"] for item in changed] == ["changed.py", "new.py"]
    assert all(set(item) == {"path", "sha256", "size"} for item in changed)


def test_validate_outputs_allows_empty_or_missing_collection(tmp_path: Path) -> None:
    local = tmp_path / "local"
    local.mkdir()
    (local / "src.py").write_text("source", encoding="utf-8")
    manifest = snapshot(local, ["src.py"], ["out.py"])
    empty = tmp_path / "empty"
    empty.mkdir()

    assert validate_outputs(empty, manifest) == []
    assert validate_outputs(tmp_path / "missing", manifest) == []


def _new_output_manifest(tmp_path: Path) -> dict[str, object]:
    local = tmp_path / "local"
    local.mkdir()
    (local / "src.py").write_text("source", encoding="utf-8")
    return snapshot(local, ["src.py"], ["out.py"])


def test_validate_outputs_rejects_unexpected_file(tmp_path: Path) -> None:
    manifest = _new_output_manifest(tmp_path)

    unexpected = tmp_path / "unexpected"
    unexpected.mkdir()
    (unexpected / "other.py").write_text("other", encoding="utf-8")
    with pytest.raises(DevJobValidationError, match="^output_unexpected$"):
        validate_outputs(unexpected, manifest)


def test_validate_outputs_rejects_symlink(tmp_path: Path) -> None:
    manifest = _new_output_manifest(tmp_path)
    linked = tmp_path / "linked"
    linked.mkdir()
    try:
        (linked / "out.py").symlink_to(tmp_path / "local" / "src.py")
    except OSError:
        pytest.skip("symlinks unavailable")
    with pytest.raises(DevJobValidationError, match="^output_unsafe$"):
        validate_outputs(linked, manifest)


def test_validate_outputs_rejects_hardlink(tmp_path: Path) -> None:
    manifest = _new_output_manifest(tmp_path)
    hardlinks = tmp_path / "hardlinks"
    hardlinks.mkdir()
    seed = tmp_path / "seed.py"
    seed.write_text("seed", encoding="utf-8")
    os.link(seed, hardlinks / "out.py")
    with pytest.raises(DevJobValidationError, match="^file_links$"):
        validate_outputs(hardlinks, manifest)


def test_validate_outputs_rejects_oversize_file(tmp_path: Path) -> None:
    manifest = _new_output_manifest(tmp_path)
    oversize = tmp_path / "oversize"
    oversize.mkdir()
    (oversize / "out.py").write_bytes(b"x" * (MAX_FILE_BYTES + 1))
    with pytest.raises(DevJobValidationError, match="^file_oversize$"):
        validate_outputs(oversize, manifest)


def test_verify_local_base_detects_modified_created_and_missing_targets(tmp_path: Path) -> None:
    local = tmp_path / "local"
    local.mkdir()
    existing = local / "existing.py"
    existing.write_text("before", encoding="utf-8")
    manifest = snapshot(local, ["existing.py"], ["existing.py", "new.py"])

    verify_local_base(local, manifest, ["existing.py", "new.py"])
    existing.write_text("changed", encoding="utf-8")
    with pytest.raises(DevJobValidationError, match="^base_stale$"):
        verify_local_base(local, manifest, ["existing.py"])

    existing.unlink()
    with pytest.raises(DevJobValidationError, match="^base_stale$"):
        verify_local_base(local, manifest, ["existing.py"])

    (local / "new.py").write_text("collision", encoding="utf-8")
    with pytest.raises(DevJobValidationError, match="^base_stale$"):
        verify_local_base(local, manifest, ["new.py"])


def test_verify_local_base_rejects_unallowed_path_without_writes(tmp_path: Path) -> None:
    (tmp_path / "src.py").write_text("source", encoding="utf-8")
    manifest = snapshot(tmp_path, ["src.py"], ["out.py"])
    before = sorted(path.name for path in tmp_path.iterdir())

    with pytest.raises(DevJobValidationError, match="^output_unexpected$"):
        verify_local_base(tmp_path, manifest, ["src.py"])

    assert sorted(path.name for path in tmp_path.iterdir()) == before
