from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path

import pytest


HERE = Path(__file__).resolve().parents[1]


def load():
    spec = importlib.util.spec_from_file_location("pair_engine_test", HERE / "local_lora_pair_engine.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


engine = load()


class EngineError(RuntimeError):
    pass


def safe(path: Path, root: Path, _label: str) -> Path:
    assert path.is_relative_to(root)
    assert path.exists()
    return path


def reparse(_path: Path) -> bool:
    return False


def file_hash(path: Path, maximum: int | None):
    data = path.read_bytes()
    if maximum is not None and len(data) > maximum:
        raise EngineError("too large")
    return hashlib.sha256(data).hexdigest(), len(data)


def test_pumper_reports_late_reader_error(tmp_path):
    class BrokenStream:
        def read(self, _size):
            raise OSError("reader failed")

    log = tmp_path / "stderr.log"
    log.open("xb").close()
    pumper = engine.Pumper(BrokenStream(), log, maximum=16, error=EngineError)
    pumper.start()
    with pytest.raises(EngineError, match="incomplete"):
        pumper.finish()
    assert isinstance(pumper.error, OSError)


def test_inventory_and_copy_preserve_closed_bounds(tmp_path):
    output = tmp_path / "output"
    loras = output / "loras"
    loras.mkdir(parents=True)
    png = output / "row.png"
    png.write_bytes(b"png")
    engine.runtime_output_bound(output, None, maximum_entries=2, maximum_png=8, root=tmp_path, safe_existing=safe, reparse=reparse, error=EngineError)
    (output / "extra.txt").write_text("x")
    with pytest.raises(EngineError, match="unsafe file"):
        engine.runtime_output_bound(output, None, maximum_entries=3, maximum_png=8, root=tmp_path, safe_existing=safe, reparse=reparse, error=EngineError)

    source = tmp_path / "source.safetensors"
    payload = b"1234"
    source.write_bytes(payload)
    target = loras / "adapter.safetensors"
    engine.copy_stream(source, target, hashlib.sha256(payload).hexdigest(), maximum=4, source_root=tmp_path, safe_existing=safe, reparse=reparse, file_hash=file_hash, error=EngineError)
    assert target.read_bytes() == payload
    oversized = tmp_path / "oversized.safetensors"
    oversized.write_bytes(b"12345")
    with pytest.raises(EngineError, match="boundary is unsafe"):
        engine.copy_stream(oversized, loras / "too-large.safetensors", hashlib.sha256(b"12345").hexdigest(), maximum=4, source_root=tmp_path, safe_existing=safe, reparse=reparse, file_hash=file_hash, error=EngineError)
