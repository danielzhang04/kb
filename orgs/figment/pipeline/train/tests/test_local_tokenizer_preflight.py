"""Offline tests for the isolated local SDXL tokenizer cache preflight."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
from types import ModuleType

import pytest


TRAIN = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("figment_local_tokenizer_preflight_test", TRAIN / "local_tokenizer_preflight.py")
assert spec and spec.loader
tokenizer = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = tokenizer
spec.loader.exec_module(tokenizer)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, tuple[dict, ...]]:
    hub = tmp_path / "hub"
    private = tmp_path / "private"
    private.mkdir(parents=True)
    inventory: list[dict] = []
    for index, name in enumerate(("alpha/model", "beta/model")):
        model = hub / f"models--{index}"
        snapshot = model / "snapshots" / ("a" * 40 if index == 0 else "b" * 40)
        blobs = model / "blobs"
        snapshot.mkdir(parents=True)
        blobs.mkdir()
        files = []
        for filename in ("merges.txt", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.json"):
            data = f"{index}:{filename}".encode("utf-8")
            blob = blobs / f"{index}-{filename}.blob"
            blob.write_bytes(data)
            os.symlink(Path("..") / ".." / "blobs" / blob.name, snapshot / filename)
            files.append((filename, len(data), _sha(data)))
        inventory.append({"id": name, "model_directory": model.name, "snapshot": snapshot.name,
                          "cache_directory": name.replace("/", "_"), "files": tuple(files)})
    venv = tmp_path / "venv" / "Scripts" / "python.exe"
    venv.parent.mkdir(parents=True)
    venv.write_bytes(b"fixed")
    monkeypatch.setattr(tokenizer, "HUB_ROOT", hub)
    monkeypatch.setattr(tokenizer, "PRIVATE_ROOT", private)
    monkeypatch.setattr(tokenizer, "VENV_PYTHON", venv)
    monkeypatch.setattr(tokenizer, "PINNED_INVENTORY", tuple(inventory))
    return private, tuple(inventory)


def test_prepare_copies_exact_ten_files_without_transformers_import(tmp_path, monkeypatch):
    private, inventory = _fixture(tmp_path, monkeypatch)
    monkeypatch.delitem(sys.modules, "transformers", raising=False)
    receipt = tokenizer.prepare("cache")
    root = private / "cache"
    assert receipt["not_promotable"] is True and receipt["runtime_or_training_approval"] is False
    assert len(receipt["copies"]) == 10 and not (root / tokenizer.LOAD_NAME).exists()
    assert "transformers" not in sys.modules
    assert {item.name for item in root.iterdir()} == {item["cache_directory"] for item in inventory} | {tokenizer.HF_HOME_NAME, tokenizer.PREPARED_NAME}


def test_prepare_refuses_regular_snapshot_entry_and_source_hash_mismatch(tmp_path, monkeypatch):
    private, inventory = _fixture(tmp_path, monkeypatch)
    entry = tokenizer.HUB_ROOT / inventory[0]["model_directory"] / "snapshots" / inventory[0]["snapshot"] / "merges.txt"
    entry.unlink()
    entry.write_bytes(b"not a link")
    with pytest.raises(tokenizer.TokenizerPreflightError, match="expected symlink"):
        tokenizer.prepare("cache")
    assert (private / "cache").exists() and not (private / "cache" / tokenizer.PREPARED_NAME).exists()

    private, inventory = _fixture(tmp_path / "changed", monkeypatch)
    blob = tokenizer.HUB_ROOT / inventory[0]["model_directory"] / "blobs" / "0-merges.txt.blob"
    blob.write_bytes(b"changed")
    with pytest.raises(tokenizer.TokenizerPreflightError, match="disagrees"):
        tokenizer.prepare("cache")


def test_prepare_refuses_source_reparse_and_oversized_source(tmp_path, monkeypatch):
    _private, inventory = _fixture(tmp_path, monkeypatch)
    blob = tokenizer.HUB_ROOT / inventory[0]["model_directory"] / "blobs" / "0-merges.txt.blob"
    real_reparse = tokenizer._is_reparse
    monkeypatch.setattr(tokenizer, "_is_reparse", lambda path: path == blob or real_reparse(path))
    with pytest.raises(tokenizer.TokenizerPreflightError, match="regular"):
        tokenizer.prepare("cache")

    monkeypatch.setattr(tokenizer, "_is_reparse", real_reparse)
    _private, inventory = _fixture(tmp_path / "large", monkeypatch)
    blob = tokenizer.HUB_ROOT / inventory[0]["model_directory"] / "blobs" / "0-tokenizer.json.blob"
    blob.write_bytes(b"x" * (tokenizer.MAX_FILE_BYTES + 1))
    with pytest.raises(tokenizer.TokenizerPreflightError, match="bounded"):
        tokenizer.prepare("cache")


def test_load_requires_current_exact_copies_and_refuses_extra_member_before_import(tmp_path, monkeypatch):
    private, inventory = _fixture(tmp_path, monkeypatch)
    tokenizer.prepare("cache")
    root = private / "cache"
    (root / inventory[0]["cache_directory"] / "extra.bin").write_bytes(b"extra")
    called = False

    def no_import(_root):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(tokenizer, "_load_tokenizers", no_import)
    with pytest.raises(tokenizer.TokenizerPreflightError, match="inventory"):
        tokenizer.load("cache")
    assert called is False


def test_prepare_and_load_refuse_stale_copied_bytes_before_any_runtime_import(tmp_path, monkeypatch):
    private, inventory = _fixture(tmp_path, monkeypatch)
    actual_write = tokenizer._write_exclusive

    def mutate_copy(path, data):
        actual_write(path, data)
        if path.name == "vocab.json":
            path.write_bytes(b"stale")

    monkeypatch.setattr(tokenizer, "_write_exclusive", mutate_copy)
    with pytest.raises(tokenizer.TokenizerPreflightError, match="disagrees"):
        tokenizer.prepare("stale-prepare")

    monkeypatch.setattr(tokenizer, "_write_exclusive", actual_write)
    tokenizer.prepare("stale-load")
    root = private / "stale-load"
    (root / inventory[0]["cache_directory"] / "vocab.json").write_bytes(b"stale")
    called = False

    def no_import(_root):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(tokenizer, "_load_tokenizers", no_import)
    with pytest.raises(tokenizer.TokenizerPreflightError, match="disagrees"):
        tokenizer.load("stale-load")
    assert called is False


def test_explicit_load_uses_fixed_venv_local_only_and_records_second_pad_zero(tmp_path, monkeypatch):
    private, _inventory = _fixture(tmp_path, monkeypatch)
    tokenizer.prepare("cache")
    monkeypatch.setattr(sys, "executable", str(tokenizer.VENV_PYTHON))
    calls = []

    class FakeTokenizer:
        pad_token_id = 49407

        @classmethod
        def from_pretrained(cls, path, *, local_files_only):
            calls.append((path, local_files_only))
            return cls()

        def __call__(self, value, **kwargs):
            assert value == tokenizer.CAPTION_PROBE and kwargs["return_tensors"] is None
            return {"input_ids": [1, 2, 3]}

    fake = ModuleType("transformers")
    fake.CLIPTokenizer = FakeTokenizer
    monkeypatch.setitem(sys.modules, "transformers", fake)
    result = tokenizer.load("cache")
    assert [item[1] for item in calls] == [True, True]
    assert [item["effective_pad_token_id"] for item in result["tokenizers"]] == [49407, 0]
    assert [item["caption_token_count"] for item in result["tokenizers"]] == [3, 3]
    assert (private / "cache" / tokenizer.LOAD_NAME).is_file()


def test_load_refuses_copy_mutation_during_runtime_before_publishing_receipt(tmp_path, monkeypatch):
    private, inventory = _fixture(tmp_path, monkeypatch)
    tokenizer.prepare("cache")

    def mutate_after_open(root):
        (root / inventory[0]["cache_directory"] / "vocab.json").write_bytes(b"mutated-after-load")
        return []

    monkeypatch.setattr(tokenizer, "_load_tokenizers", mutate_after_open)
    with pytest.raises(tokenizer.TokenizerPreflightError, match="changed during"):
        tokenizer.load("cache")
    assert not (private / "cache" / tokenizer.LOAD_NAME).exists()


def test_load_refuses_wrong_runtime_or_existing_load_receipt(tmp_path, monkeypatch):
    private, _inventory = _fixture(tmp_path, monkeypatch)
    tokenizer.prepare("cache")
    monkeypatch.setattr(sys, "executable", str(tmp_path / "wrong-python.exe"))
    with pytest.raises(tokenizer.TokenizerPreflightError, match="fixed local trainer"):
        tokenizer.load("cache")
    monkeypatch.setattr(sys, "executable", str(tokenizer.VENV_PYTHON))
    (private / "cache" / tokenizer.LOAD_NAME).write_text("already", encoding="utf-8")
    with pytest.raises(tokenizer.TokenizerPreflightError, match="fresh"):
        tokenizer.load("cache")


def test_load_refuses_a_self_hashed_but_noncanonical_prepared_receipt_before_import(tmp_path, monkeypatch):
    private, _inventory = _fixture(tmp_path, monkeypatch)
    receipt = tokenizer.prepare("cache")
    path = private / "cache" / tokenizer.PREPARED_NAME
    changed = dict(receipt)
    changed["runtime_or_training_approval"] = True
    changed.pop("frozen_sha256")
    changed["frozen_sha256"] = _sha(tokenizer._canonical(changed))
    path.write_text(json.dumps(changed), encoding="utf-8")
    called = False

    def no_import(_root):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(tokenizer, "_load_tokenizers", no_import)
    with pytest.raises(tokenizer.TokenizerPreflightError, match="disagrees"):
        tokenizer.load("cache")
    assert called is False


def test_cli_keeps_prepare_and_load_explicit():
    args = tokenizer.build_parser().parse_args(["--out", "cache"])
    assert args.load is False
    assert tokenizer.build_parser().parse_args(["--out", "cache", "--load"]).load is True
    with pytest.raises(SystemExit):
        tokenizer.build_parser().parse_args(["--out", "../escape"])
