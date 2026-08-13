#!/usr/bin/env python3
"""Unit tests for stamp_review.py — the honest three-state stamp writer.

Plain-assert style (this scripts dir has no pytest harness); run with `py -3 test_stamp_review.py`.

Fixtures mirror the REAL schemas pinned from the wells-fargo run:
  * `_review/merged.json` is a flat JSON array of ruling objects, each:
      {id, n, worst, f, s, r, why, fault}
    where `worst` and each axis (f=fidelity, s=style, r=rig) is either "clean"
    or a severity ("LOW"|"MEDIUM"|"HIGH"|"BLOCKING"). `why` is a (possibly empty) narrative.
    An optional `dsg: [{id, parent, q, verdict, note}]` carries the DSG-lite per-item adherence
    results; any `verdict: "fail"` parks the shot regardless of the axis/aggregate severities.
  * `scenes/manifest.json` is {video_slug, generated, notes, shots: [entry, ...]} where each
    entry is keyed by `shot_id`. Task-2 (df0c18e) added `review_status`
    ("unreviewed"|"verified"|"parked") + `parked_reasons: [str]`, which render.py's gate reads.
"""
import hashlib
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


def test_failed_dsg_item_parks_even_when_the_aggregate_says_clean():
    """The DSG-lite hole this closes: the fidelity judge writes the per-item checklist AND the axis
    severities in one pass, so a ruling can carry a failed adherence item under a `worst: "clean"`
    summary. Trusting the summary would ship a frame whose own evidence says it missed a fact."""
    r = _ruling("L14", "clean")
    r["dsg"] = [
        {"id": "e1", "parent": None, "q": "a brick wall is present", "verdict": "pass"},
        {"id": "a1", "parent": "e1", "q": "the wall is unlettered", "verdict": "fail",
         "note": "reads BRIKS in marker capitals"},
        {"id": "r1", "parent": "a1", "q": "the sign faces the worker", "verdict": "skipped"},
    ]
    status, reasons = stamp_review.classify(r)
    assert status == "parked", (status, reasons)
    assert any("the wall is unlettered" in x for x in reasons), reasons
    assert any("BRIKS" in x for x in reasons), reasons
    # a short-circuited CHILD is not itself a defect (its parent already carries one)
    assert not any("faces the worker" in x for x in reasons), reasons


def test_all_passing_dsg_items_still_verify():
    r = _ruling("L15", "clean")
    r["dsg"] = [{"id": "e1", "q": "one clerk at the wicket", "verdict": "pass"},
                {"id": "a1", "parent": "e1", "q": "clerk in a green eyeshade", "verdict": "pass"}]
    status, reasons = stamp_review.classify(r)
    assert status == "verified", (status, reasons)
    assert reasons == [], reasons


def test_dsg_absent_or_malformed_changes_nothing():
    # every pre-DSG ruling shape keeps its old verdict — the field is additive
    assert stamp_review.classify(_ruling("L16", "clean"))[0] == "verified"
    r = _ruling("L17", "clean"); r["dsg"] = "not a list"
    assert stamp_review.classify(r)[0] == "verified"
    r2 = _ruling("L18", "clean"); r2["dsg"] = [{"id": "e1", "q": "x"}]  # no verdict key
    assert stamp_review.classify(r2)[0] == "verified"


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
# C-6 figure-verdicts merge path — merge_figure_records() + `--figures` CLI form
# --------------------------------------------------------------------------- #
def _figrec(canonical="c-sha", verdicts=None, reviewer="fresh-eyes", date="2026-08-04", **extra):
    r = {"canonical_sha256": canonical, "verdicts": verdicts or {"support-contact": "pass"},
         "reviewer": reviewer, "date": date}
    r.update(extra)
    return r


def test_merge_figure_records_into_empty_store_normalizes_shape():
    store = {}
    n = stamp_review.merge_figure_records(
        store, {"figures": {"fig-a--sit--deadpan": _figrec()}})
    assert n == 1, n
    rec = store["figures"]["fig-a--sit--deadpan"]
    # normalized to exactly the C-6 pinned shape, expression_sha256 defaults to null
    assert set(rec) == {"canonical_sha256", "expression_sha256", "verdicts", "reviewer", "date"}, rec
    assert rec["expression_sha256"] is None, rec
    assert rec["canonical_sha256"] == "c-sha", rec


def test_merge_figure_records_accepts_bare_mapping_without_wrapper():
    store = {}
    n = stamp_review.merge_figure_records(store, {"fig-a--sit--deadpan": _figrec()})
    assert n == 1, n
    assert "fig-a--sit--deadpan" in store["figures"], store


def test_merge_figure_records_drops_extra_input_keys():
    store = {}
    stamp_review.merge_figure_records(
        store, {"figures": {"fig-a--sit--deadpan": _figrec(extra_field="junk")}})
    assert "extra_field" not in store["figures"]["fig-a--sit--deadpan"]


def test_merge_figure_records_replaces_existing_entry_wholesale():
    store = {"figures": {"fig-a--sit--deadpan": {
        "canonical_sha256": "old-sha", "expression_sha256": "old-expr-sha",
        "verdicts": {"support-contact": "fail"}, "reviewer": "fresh-eyes", "date": "2026-08-01"}}}
    n = stamp_review.merge_figure_records(
        store, {"figures": {"fig-a--sit--deadpan": _figrec(
            canonical="new-sha", verdicts={"support-contact": "pass"}, date="2026-08-04")}})
    assert n == 1, n
    rec = store["figures"]["fig-a--sit--deadpan"]
    assert rec["canonical_sha256"] == "new-sha", rec
    assert rec["expression_sha256"] is None, rec  # old field NOT carried over — wholesale replace
    assert rec["verdicts"] == {"support-contact": "pass"}, rec


def test_merge_figure_records_is_additive_across_other_fig_ids():
    store = {"figures": {"fig-b--stand--smug": _figrec(canonical="b-sha")}}
    n = stamp_review.merge_figure_records(
        store, {"figures": {"fig-a--sit--deadpan": _figrec(canonical="a-sha")}})
    assert n == 1, n
    assert set(store["figures"]) == {"fig-a--sit--deadpan", "fig-b--stand--smug"}, store["figures"]
    assert store["figures"]["fig-b--stand--smug"]["canonical_sha256"] == "b-sha"  # untouched


def test_merge_figure_records_skips_malformed_record_but_keeps_the_rest():
    store = {}
    bad = {"canonical_sha256": "x-sha"}  # missing verdicts/reviewer/date
    n = stamp_review.merge_figure_records(
        store, {"figures": {"fig-bad": bad, "fig-good": _figrec()}})
    assert n == 1, n
    assert "fig-bad" not in store["figures"], store["figures"]
    assert "fig-good" in store["figures"], store["figures"]


def test_figures_cli_creates_review_json_and_prints_summary():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        staging = base / "_staging"
        staging.mkdir()
        input_path = base / "figure-verdicts.json"
        input_path.write_text(
            json.dumps({"figures": {"fig-a--sit--deadpan": _figrec()}}), encoding="utf-8")
        rc = stamp_review.main(["--figures", str(input_path), str(staging)])
        assert rc == 0, rc
        review_path = staging / "review.json"
        assert review_path.exists()
        out = _read(review_path)
        assert "fig-a--sit--deadpan" in out["figures"], out
        leftovers = [p.name for p in staging.iterdir() if p.suffix == ".tmp"]
        assert leftovers == [], leftovers


def test_figures_cli_merges_additively_into_existing_review_json():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        staging = base / "_staging"
        staging.mkdir()
        (staging / "review.json").write_text(
            json.dumps({"figures": {"fig-old--stand--smug": _figrec(canonical="old-sha")}}),
            encoding="utf-8")
        input_path = base / "figure-verdicts.json"
        input_path.write_text(
            json.dumps({"figures": {"fig-new--sit--deadpan": _figrec(canonical="new-sha")}}),
            encoding="utf-8")
        stamp_review.main(["--figures", str(input_path), str(staging)])
        out = _read(staging / "review.json")
        assert set(out["figures"]) == {"fig-old--stand--smug", "fig-new--sit--deadpan"}, out


def test_figures_cli_migrates_a_legacy_stem_keyed_store_onto_paths_as_it_writes():
    """The one-time key migration, persisted. A curated row — the P12 human veto, a grandfathered
    standing asset — must cross byte-equivalent in CONTENT; only its key moves onto the frame it
    names. A stem naming a frame that is no longer on disk keeps its stem rather than being
    dropped, and is migrated by whichever read can resolve it."""
    with tempfile.TemporaryDirectory() as td:
        kit = Path(td) / "visual-kit"
        staging, refs = kit / "_staging", kit / "refs" / "base"
        staging.mkdir(parents=True)
        refs.mkdir(parents=True)
        pixels = b"\x89PNG\r\n\x1a\n"
        (refs / "expr-pleading.png").write_bytes(pixels)
        # The record's OWN digest is what binds it to a frame — the store's existing notion of
        # which pixels were ruled on, never a second naming convention laid beside it.
        veto = {"canonical_sha256": hashlib.sha256(pixels).hexdigest(), "expression_sha256": None,
                "verdicts": {"rig": "pass", "flat-cel-hazard": "pass", "human-veto": "fail"},
                "reviewer": "Daniel veto, G2 2026-08-12, P12", "date": "2026-08-12"}
        unresolvable = _figrec(canonical="b" * 64)
        (staging / "review.json").write_text(
            json.dumps({"figures": {"expr-pleading": veto, "L28": unresolvable}}),
            encoding="utf-8")
        input_path = Path(td) / "verdicts.json"
        input_path.write_text(json.dumps({"figures": {"refs/base/new.png": _figrec()}}),
                              encoding="utf-8")
        assert stamp_review.main(["--figures", str(input_path), str(staging)]) == 0
        out = _read(staging / "review.json")["figures"]
        # Kit-relative, so the key reads identically in every checkout (`forge.store_key`).
        key = "refs/base/expr-pleading.png"
        assert set(out) == {key, "L28", "refs/base/new.png"}, out
        assert out[key] == veto, out[key]              # content byte-equivalent, key only moved
        assert out["L28"] == unresolvable, out["L28"]


def test_figures_cli_missing_input_file_errors_without_writing():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        staging = base / "_staging"
        staging.mkdir()
        rc = stamp_review.main(["--figures", str(base / "nope.json"), str(staging)])
        assert rc == 1, rc
        assert not (staging / "review.json").exists()


def test_figures_cli_summary_line_via_real_subprocess():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        staging = base / "_staging"
        staging.mkdir()
        input_path = base / "figure-verdicts.json"
        input_path.write_text(
            json.dumps({"figures": {"fig-a--sit--deadpan": _figrec(),
                                     "fig-b--stand--smug": _figrec(canonical="b-sha")}}),
            encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "stamp_review.py"),
             "--figures", str(input_path), str(staging)],
            capture_output=True, text=True)
        assert proc.returncode == 0, proc.stderr
        assert "asset-review: 2 merged into" in proc.stdout, proc.stdout


def test_scene_stamping_cli_unaffected_by_the_figures_dispatch():
    # a plain `<video_dir>` positional call still routes to the ORIGINAL scene-stamping path
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        mpath = _write_video_dir(
            base, [_ruling("L01", "clean")],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L01")]})
        rc = stamp_review.main([str(base)])
        assert rc == 0, rc
        assert _read(mpath)["shots"][0]["review_status"] == "verified"


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
