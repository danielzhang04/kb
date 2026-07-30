#!/usr/bin/env python3
"""Tests for crop_battery.py's `--batch` parallelism (2026-07-30 SPEED item): a thread pool across
MANY frames must produce byte-identical output to the serial loop it replaces.

Run: py -3 -m pytest test_crop_battery_batch.py -q
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from PIL import Image

from crop_battery import run_batch


def _make_frame(path, w=800, h=600, color=(40, 90, 140)):
    Image.new("RGB", (w, h), color).save(path)


def _fixture(tmp_path, n=6):
    """n synthetic frames, each with one face box + one hand box, varying slightly per frame so
    crops differ (proving the comparison isn't accidentally trivial)."""
    entries = []
    for i in range(n):
        frame = tmp_path / f"frame{i:02d}.png"
        _make_frame(frame, color=(30 + i * 10, 80, 130))
        boxes = {
            "figures": [{
                "name": f"char{i % 3}",
                "face": [0.1 + 0.01 * i, 0.1, 0.35 + 0.01 * i, 0.4],
                "hands": [[0.5, 0.5, 0.7, 0.8]],
            }]
        }
        boxes_path = tmp_path / f"frame{i:02d}-boxes.json"
        boxes_path.write_text(json.dumps(boxes), encoding="utf-8")
        entries.append({"frame": str(frame), "boxes": str(boxes_path)})
    return entries


def _normalize_index(index_json_path, outdir):
    """The index stores absolute paths under `outdir`; strip that prefix so two runs into
    DIFFERENT output directories can be compared for everything BUT the directory itself."""
    data = json.loads(Path(index_json_path).read_text(encoding="utf-8"))
    out = []
    for entry in data:
        e = dict(entry)
        e["crops"] = [Path(c).relative_to(outdir).as_posix() for c in entry["crops"]]
        e["sheet"] = Path(entry["sheet"]).relative_to(outdir).as_posix() if entry["sheet"] else None
        out.append(e)
    return out


def test_serial_and_parallel_produce_the_same_index_and_file_lists(tmp_path):
    entries = _fixture(tmp_path, n=6)
    serial_dir = tmp_path / "out-serial"
    parallel_dir = tmp_path / "out-parallel"

    idx_serial, results_serial = run_batch(entries, str(serial_dir), concurrency=1)
    idx_parallel, results_parallel = run_batch(entries, str(parallel_dir), concurrency=4)

    norm_serial = _normalize_index(idx_serial, str(serial_dir))
    norm_parallel = _normalize_index(idx_parallel, str(parallel_dir))
    # byte-compare the JSON (path-normalized so only the outdir prefix differs)
    assert json.dumps(norm_serial, sort_keys=True) == json.dumps(norm_parallel, sort_keys=True)

    # compare the crop FILE LISTS (relative names) directly too
    serial_names = sorted(p.name for p in serial_dir.glob("*.png"))
    parallel_names = sorted(p.name for p in parallel_dir.glob("*.png"))
    assert serial_names == parallel_names
    assert len(serial_names) > 0

    # and every corresponding crop/sheet file is byte-IDENTICAL, not just same-named
    for name in serial_names:
        a = (serial_dir / name).read_bytes()
        b = (parallel_dir / name).read_bytes()
        assert a == b, name


def test_batch_index_is_deterministic_regardless_of_input_order(tmp_path):
    entries = _fixture(tmp_path, n=5)
    fwd_dir = tmp_path / "out-fwd"
    rev_dir = tmp_path / "out-rev"

    idx_fwd, _ = run_batch(entries, str(fwd_dir), concurrency=1)
    idx_rev, _ = run_batch(list(reversed(entries)), str(rev_dir), concurrency=3)

    norm_fwd = _normalize_index(idx_fwd, str(fwd_dir))
    norm_rev = _normalize_index(idx_rev, str(rev_dir))
    assert json.dumps(norm_fwd, sort_keys=True) == json.dumps(norm_rev, sort_keys=True)


def test_run_batch_writes_one_sheet_and_crops_per_frame(tmp_path):
    entries = _fixture(tmp_path, n=3)
    outdir = tmp_path / "out"
    index_path, results = run_batch(entries, str(outdir), concurrency=2)
    assert len(results) == 3
    for r in results:
        assert len(r["crops"]) == 2   # one face + one hand box per fixture frame
        assert r["sheet"] and Path(r["sheet"]).exists()
        for c in r["crops"]:
            assert Path(c).exists()
    assert Path(index_path).exists()


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
