"""Tests for `train/render_aitoolkit_config.py`'s pod-path guard.

A Git Bash MSYS session silently rewrites a POSIX `--dataset-dir
/workspace/...` argument into a Windows path (e.g.
`C:/Program Files/Git/workspace/...`) unless the caller sets
MSYS_NO_PATHCONV=1 or runs from PowerShell instead. That corrupted path was
baked into a rendered `training.json` and shipped to the pod (evidence:
`train/runs/out/creator-001-tensor-train-smoke/_harness/_training.log`'s
`folder_path`). These tests cover the fail-closed guard added to catch that
class of bug before a bad config is ever written, plus the same guard applied
to an already-rendered config. Reuses the repo's ad-hoc `load_module` file
loader, same pattern as `test_build_training_set.py`.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

TRAIN = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


rc = load_module("figment_train_render_aitoolkit_config", TRAIN / "render_aitoolkit_config.py")


# ---------------------------------------------------------------------------
# validate_pod_path — unit level
# ---------------------------------------------------------------------------


def test_accepts_a_clean_absolute_posix_workspace_path():
    rc.validate_pod_path("/workspace/ComfyUI/input/creator001krea2", "--dataset-dir")


def test_rejects_the_msys_mangled_git_bash_signature():
    with pytest.raises(rc.PodPathError, match="MSYS_NO_PATHCONV"):
        rc.validate_pod_path(
            "C:/Program Files/Git/workspace/ComfyUI/input/creator001krea2",
            "--dataset-dir",
        )


def test_rejects_a_backslash_windows_path():
    with pytest.raises(rc.PodPathError, match="backslash"):
        rc.validate_pod_path(r"C:\workspace\ComfyUI\input\creator001krea2", "--dataset-dir")


def test_rejects_a_bare_drive_letter_path():
    with pytest.raises(rc.PodPathError, match="drive letter"):
        rc.validate_pod_path("D:/workspace/ComfyUI/input/creator001krea2", "--dataset-dir")


def test_rejects_program_files_anywhere_in_the_path():
    with pytest.raises(rc.PodPathError, match="Program Files"):
        rc.validate_pod_path("/workspace/Program Files/oops", "--dataset-dir")


def test_rejects_a_relative_or_non_workspace_path():
    with pytest.raises(rc.PodPathError, match="/workspace/"):
        rc.validate_pod_path("relative/dir", "--dataset-dir")
    with pytest.raises(rc.PodPathError, match="/workspace/"):
        rc.validate_pod_path("/somewhere/else", "--dataset-dir")


def test_rejects_an_empty_path():
    with pytest.raises(rc.PodPathError, match="non-empty"):
        rc.validate_pod_path("", "--dataset-dir")


# ---------------------------------------------------------------------------
# validate_rendered_pod_paths — the same guard applied post-render
# ---------------------------------------------------------------------------


def _rendered_config(
    dataset_dir="/workspace/ComfyUI/input/creator001krea2",
    output_dir="/workspace/train-output",
    base_model_path="/workspace/models/krea2/krea2_raw_bf16.safetensors",
):
    return {
        "config": {
            "process": [{
                "training_folder": output_dir,
                "datasets": [{"folder_path": dataset_dir}],
                "model": {"name_or_path": base_model_path},
            }],
        },
    }


def test_validate_rendered_pod_paths_accepts_a_clean_config():
    rc.validate_rendered_pod_paths(_rendered_config())


def test_validate_rendered_pod_paths_rejects_a_mangled_dataset_dir():
    config = _rendered_config(
        dataset_dir="C:/Program Files/Git/workspace/ComfyUI/input/creator001krea2",
    )
    with pytest.raises(rc.PodPathError, match="MSYS_NO_PATHCONV"):
        rc.validate_rendered_pod_paths(config)


def test_validate_rendered_pod_paths_rejects_a_mangled_output_dir():
    config = _rendered_config(output_dir="C:/Program Files/Git/workspace/train-output")
    with pytest.raises(rc.PodPathError, match="MSYS_NO_PATHCONV"):
        rc.validate_rendered_pod_paths(config)


def test_validate_rendered_pod_paths_rejects_a_mangled_base_model_path():
    config = _rendered_config(
        base_model_path="C:/Program Files/Git/workspace/models/krea2/krea2_raw_bf16.safetensors",
    )
    with pytest.raises(rc.PodPathError, match="MSYS_NO_PATHCONV"):
        rc.validate_rendered_pod_paths(config)


# ---------------------------------------------------------------------------
# main() — CLI level, real template
# ---------------------------------------------------------------------------

TEMPLATE = TRAIN / "ai-toolkit-krea2.yaml.template"


def test_cli_accepts_a_clean_posix_dataset_dir(tmp_path, capsys):
    out_path = tmp_path / "training.json"
    exit_code = rc.main([
        "--template", str(TEMPLATE),
        "--trigger", "creator001krea2",
        "--dataset-dir", "/workspace/ComfyUI/input/creator001krea2",
        "--out", str(out_path),
    ])

    assert exit_code == 0
    assert out_path.is_file()
    config = json.loads(out_path.read_text(encoding="utf-8"))
    folder_path = config["config"]["process"][0]["datasets"][0]["folder_path"]
    assert folder_path == "/workspace/ComfyUI/input/creator001krea2"


def test_cli_rejects_an_msys_mangled_dataset_dir(tmp_path, capsys):
    out_path = tmp_path / "training.json"
    exit_code = rc.main([
        "--template", str(TEMPLATE),
        "--trigger", "creator001krea2",
        "--dataset-dir", "C:/Program Files/Git/workspace/ComfyUI/input/creator001krea2",
        "--out", str(out_path),
    ])

    assert exit_code == 1
    assert not out_path.exists()
    err = capsys.readouterr().err
    assert "MSYS_NO_PATHCONV" in err
    assert "PowerShell" in err


def test_cli_rejects_an_msys_mangled_output_dir(tmp_path, capsys):
    out_path = tmp_path / "training.json"
    exit_code = rc.main([
        "--template", str(TEMPLATE),
        "--trigger", "creator001krea2",
        "--dataset-dir", "/workspace/ComfyUI/input/creator001krea2",
        "--output-dir", "C:/Program Files/Git/workspace/train-output",
        "--out", str(out_path),
    ])

    assert exit_code == 1
    assert not out_path.exists()
    assert "MSYS_NO_PATHCONV" in capsys.readouterr().err


def test_cli_rejects_a_windows_drive_letter_base_model_path(tmp_path, capsys):
    out_path = tmp_path / "training.json"
    exit_code = rc.main([
        "--template", str(TEMPLATE),
        "--trigger", "creator001krea2",
        "--dataset-dir", "/workspace/ComfyUI/input/creator001krea2",
        "--base-model-path", "C:/models/krea2_raw_bf16.safetensors",
        "--out", str(out_path),
    ])

    assert exit_code == 1
    assert not out_path.exists()
    assert "drive letter" in capsys.readouterr().err
