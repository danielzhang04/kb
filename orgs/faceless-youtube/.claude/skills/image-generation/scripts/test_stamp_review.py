#!/usr/bin/env python3
"""Unit tests for stamp_review.py — the honest three-state stamp writer.

Plain-assert style (this scripts dir has no pytest harness); run with `py -3 test_stamp_review.py`.

Fixtures mirror the REAL schemas pinned from the wells-fargo run:
  * `_review/merged.json` is a flat JSON array of ruling objects, each:
      {id, n, worst, f, s, r, why, fault}
    where `worst` and each axis (f=fidelity, s=style, r=rig) is either "clean"
    or a severity ("LOW"|"MEDIUM"|"HIGH"|"BLOCKING"). `why` is a (possibly empty) narrative.
  * `scenes/manifest.json` is {video_slug, generated, notes, shots: [entry, ...]} where each
    entry is keyed by `shot_id`. Task-2 (df0c18e) added `review_status`
    ("unreviewed"|"verified"|"parked") + `parked_reasons: [str]`, which render.py's gate reads.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import stamp_review


# --------------------------------------------------------------------------- #
# Fixture builders — mirror the pinned real schemas
# --------------------------------------------------------------------------- #
def _ruling(rid, worst, f="clean", s="clean", r="clean", why="", fault="R"):
    return {"id": rid, "n": int(rid[1:]), "worst": worst,
            "f": f, "s": s, "r": r, "why": why, "fault": fault}


def _entry(shot_id, **extra):
    e = {
        "shot_id": shot_id,
        "file": f"assets/scenes/{shot_id}.png",
        "files": [f"assets/scenes/{shot_id}.png"],
        "technique": "(c) environment gen, style-anchor seeded",
        "seeds": [],
        "flagged": True,
        "blocking": False,
        "review_status": "unreviewed",
        "parked_reasons": [],
        "notes": "placed via forge.py place.",
    }
    e.update(extra)
    return e


def _write_video_dir(base: Path, rulings, manifest):
    review_dir = base / "assets" / "_review"
    scenes_dir = base / "assets" / "scenes"
    review_dir.mkdir(parents=True)
    scenes_dir.mkdir(parents=True)
    (review_dir / "merged.json").write_text(
        json.dumps(rulings, ensure_ascii=False, indent=1), encoding="utf-8")
    (scenes_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return scenes_dir / "manifest.json"


def _read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- #
# classify() — the ruling -> (status, reasons) map
# --------------------------------------------------------------------------- #
def test_classify_clean_ruling_is_verified():
    # (a) a fully-clean ruling -> verified, no reasons
    status, reasons = stamp_review.classify(_ruling("L05", "clean"))
    assert status == "verified", status
    assert reasons == [], reasons


def test_classify_defect_ruling_is_parked_with_reasons():
    # (b) any non-clean ruling -> parked, ruling strings copied as reasons
    status, reasons = stamp_review.classify(
        _ruling("L03", "BLOCKING", f="BLOCKING", s="HIGH", r="clean",
                why="Malformed lettering; Period drift"))
    assert status == "parked", status
    # axis defects surfaced as readable strings; clean axis (rig) omitted
    assert "fidelity: BLOCKING" in reasons, reasons
    assert "style: HIGH" in reasons, reasons
    assert not any("rig" in x for x in reasons), reasons
    # the narrative is preserved
    assert any("Malformed lettering" in x for x in reasons), reasons


def test_classify_low_worst_is_parked_not_verified():
    # Honesty is conservative: only a fully-clean ruling verifies. A LOW defect parks.
    status, reasons = stamp_review.classify(_ruling("L26", "LOW", f="LOW", s="LOW", r="clean"))
    assert status == "parked", status
    assert reasons, reasons


def test_classify_defect_with_empty_axes_and_why_still_has_a_reason():
    # never emit a parked entry with zero reasons (render gate needs something to print)
    status, reasons = stamp_review.classify(
        {"id": "L99", "worst": "HIGH", "f": "clean", "s": "clean", "r": "clean", "why": ""})
    assert status == "parked", status
    assert reasons and all(isinstance(x, str) for x in reasons), reasons


# --------------------------------------------------------------------------- #
# stamp()/main() — writing onto the manifest
# --------------------------------------------------------------------------- #
def test_clean_ruling_writes_verified_status():
    # (a) end-to-end: clean ruling -> review_status "verified" on its entry
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        mpath = _write_video_dir(
            base,
            [_ruling("L01", "clean")],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L01")]})
        rc = stamp_review.main([str(base)])
        assert rc == 0, rc
        out = _read(mpath)
        e = out["shots"][0]
        assert e["review_status"] == "verified", e
        assert e.get("parked_reasons") == [], e
        # never writes the legacy boolean shape
        assert "verified" not in e or not isinstance(e.get("verified"), bool)


def test_defect_ruling_writes_parked_and_reasons():
    # (b) defect ruling -> review_status "parked" + reasons copied
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        mpath = _write_video_dir(
            base,
            [_ruling("L02", "BLOCKING", f="BLOCKING", s="HIGH", r="clean", why="garbled text")],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L02")]})
        stamp_review.main([str(base)])
        e = _read(mpath)["shots"][0]
        assert e["review_status"] == "parked", e
        assert "fidelity: BLOCKING" in e["parked_reasons"], e
        assert any("garbled text" in x for x in e["parked_reasons"]), e


def test_layered_shot_absent_from_manifest_gets_entry_created():
    # (c) a shot reviewed in merged.json but absent from the manifest (layered plate/cutout)
    # -> a fresh entry is created carrying the stamp
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        mpath = _write_video_dir(
            base,
            [_ruling("L01", "clean"), _ruling("L44", "HIGH", f="HIGH")],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L01")]})
        stamp_review.main([str(base)])
        out = _read(mpath)
        by_id = {e["shot_id"]: e for e in out["shots"]}
        assert "L44" in by_id, list(by_id)
        assert by_id["L44"]["review_status"] == "parked", by_id["L44"]
        assert by_id["L44"]["parked_reasons"], by_id["L44"]


def test_entries_not_in_merged_left_byte_identical():
    # (d) an entry with no ruling in merged.json is untouched — byte-identical
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        untouched = _entry("L07", review_status="unreviewed",
                           notes="a distinctive note", flagged=False)
        before_bytes = json.dumps(untouched, ensure_ascii=False, sort_keys=True)
        mpath = _write_video_dir(
            base,
            [_ruling("L01", "clean")],  # merged.json covers only L01
            {"video_slug": "t", "generated": "2026", "notes": "",
             "shots": [_entry("L01"), untouched]})
        stamp_review.main([str(base)])
        out = _read(mpath)
        after = {e["shot_id"]: e for e in out["shots"]}["L07"]
        assert json.dumps(after, ensure_ascii=False, sort_keys=True) == before_bytes, after
        # specifically: no stamp was added
        assert after["review_status"] == "unreviewed", after


def test_summary_line_counts_verified_and_parked():
    # (e) the printed summary line is `stamped: N verified, M parked`
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        rulings = [_ruling("L01", "clean"),
                   _ruling("L02", "clean"),
                   _ruling("L03", "BLOCKING", f="BLOCKING")]
        _write_video_dir(
            base, rulings,
            {"video_slug": "t", "generated": "2026", "notes": "",
             "shots": [_entry("L01"), _entry("L02"), _entry("L03")]})
        # exercise the real CLI so the summary line is observed on stdout
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "stamp_review.py"), str(base)],
            capture_output=True, text=True)
        assert proc.returncode == 0, proc.stderr
        assert "stamped: 2 verified, 1 parked" in proc.stdout, proc.stdout


def test_write_is_atomic_no_tmp_left_behind():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        mpath = _write_video_dir(
            base, [_ruling("L01", "clean")],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L01")]})
        stamp_review.main([str(base)])
        leftovers = [p.name for p in mpath.parent.iterdir() if p.suffix == ".tmp"]
        assert leftovers == [], leftovers


# --------------------------------------------------------------------------- #
def _run_all():
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_run_all())
