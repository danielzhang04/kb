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


def _write_video_dir(base: Path, rulings, manifest, schema=stamp_review._SHOTS_SCHEMA_V1):
    """`schema`: MEDIUM-4 made a MISSING shots.json fail-closed (`require_dsg=True`), so every one
    of this file's many pre-existing callers that only mean to exercise ruling/manifest mechanics
    (not that behaviour specifically) would otherwise start requiring a `dsg` checklist their
    fixtures never carry. Default here writes a minimal companion shots.json declaring an EXPLICIT
    v1 — the legacy, dsg-optional path — so those callers are unaffected. A caller that already
    wrote its OWN shots.json first (`_write_shots_json`, or directly, as the MEDIUM-4 tests do) is
    never overwritten. Pass `schema=None` to skip writing one at all (the "isolated caller, truly
    no shots.json" case those same tests need)."""
    review_dir = base / "assets" / "_review"
    scenes_dir = base / "assets" / "scenes"
    review_dir.mkdir(parents=True)
    scenes_dir.mkdir(parents=True)
    (review_dir / "merged.json").write_text(
        json.dumps(rulings, ensure_ascii=False, indent=1), encoding="utf-8")
    (scenes_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    shots_path = base / "shots.json"
    if schema is not None and not shots_path.exists():
        shots_path.write_text(json.dumps({"schema": schema}), encoding="utf-8")
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


def test_dsg_absent_is_noop_but_malformed_now_hard_errors():
    # absent dsg key is the documented additive-field contract -> no-op, old verdict stands
    assert stamp_review.classify(_ruling("L16", "clean"))[0] == "verified"
    # a non-list dsg container is MALFORMED, not absent — a judge that returned garbage instead
    # of a checklist must be loud, not silently treated as "no checklist ran"
    r = _ruling("L17", "clean"); r["dsg"] = "not a list"
    try:
        stamp_review.classify(r)
        assert False, "expected a non-list dsg field to raise"
    except ValueError as e:
        assert "L17" in str(e), str(e)
    # an item with no verdict key at all is a malformed judge output, not a passing check
    r2 = _ruling("L18", "clean"); r2["dsg"] = [{"id": "e1", "q": "x"}]  # no verdict key
    try:
        stamp_review.classify(r2)
        assert False, "expected a missing verdict to raise"
    except ValueError as e:
        assert "e1" in str(e) or "L18" in str(e), str(e)


def test_dsg_verdict_pass_and_skipped_are_not_defects_case_insensitive():
    for spelling in ("pass", "PASS", "Pass", "skipped", "SKIPPED", "Skipped"):
        r = _ruling("L19", "clean")
        r["dsg"] = [{"id": "a1", "q": "some atomic fact", "verdict": spelling}]
        status, reasons = stamp_review.classify(r)
        assert status == "verified", (spelling, status, reasons)


def test_dsg_verdict_fail_spellings_are_defects_case_insensitive():
    for spelling in ("fail", "FAIL", "Fail"):
        r = _ruling("L20", "clean")
        r["dsg"] = [{"id": "a1", "q": "some atomic fact", "verdict": spelling}]
        status, reasons = stamp_review.classify(r)
        assert status == "parked", (spelling, status)


def test_dsg_verdict_malformed_spellings_hard_error_naming_the_item():
    # a judge's malformed output (a near-miss spelling, a boolean, a missing key) must be LOUD,
    # never silently treated as pass/fail
    for bad_verdict in ("failed", "no", "false", None):
        r = _ruling("L21", "clean")
        item = {"id": "z9", "q": "some atomic fact"}
        if bad_verdict is not None:
            item["verdict"] = bad_verdict
        r["dsg"] = [item]
        try:
            stamp_review.classify(r)
            assert False, f"expected verdict={bad_verdict!r} to raise"
        except ValueError as e:
            assert "z9" in str(e), (bad_verdict, str(e))


def test_classify_defect_with_empty_axes_and_why_still_has_a_reason():
    # never emit a parked entry with zero reasons (render gate needs something to print)
    status, reasons = stamp_review.classify(
        {"id": "L99", "worst": "HIGH", "f": "clean", "s": "clean", "r": "clean", "why": ""})
    assert status == "parked", status
    assert reasons and all(isinstance(x, str) for x in reasons), reasons


# --------------------------------------------------------------------------- #
# MEDIUM-10 (audit follow-up) — a ruling that OMITS the dsg checklist entirely must not be
# indistinguishable from a genuine pre-checklist ruling once `require_dsg` says the current
# schema is in play; and a ruling with NO axis info at all must park, not default to clean.
# --------------------------------------------------------------------------- #
def test_missing_dsg_is_still_a_noop_when_not_required():
    # the documented legacy behaviour, unchanged: require_dsg defaults False
    r = _ruling("L30", "clean")
    assert stamp_review.classify(r) == ("verified", [])
    r2 = _ruling("L31", "clean"); r2["dsg"] = None
    assert stamp_review.classify(r2) == ("verified", [])


def test_missing_dsg_parks_when_required():
    """The defect this closes: a fidelity judge that silently failed to emit its checklist used
    to be indistinguishable from a genuine pre-checklist ruling — both verified. With
    `require_dsg=True` (the video's shots.json declares the current schema), an absent OR
    explicit-null `dsg` now parks instead."""
    r = _ruling("L32", "clean")
    status, reasons = stamp_review.classify(r, require_dsg=True)
    assert status == "parked", (status, reasons)
    assert any("dsg" in x for x in reasons), reasons

    r2 = _ruling("L33", "clean"); r2["dsg"] = None
    status2, reasons2 = stamp_review.classify(r2, require_dsg=True)
    assert status2 == "parked", (status2, reasons2)


def test_dsg_present_and_clean_still_verifies_when_required():
    r = _ruling("L34", "clean")
    r["dsg"] = [{"id": "e1", "q": "a wall is present", "verdict": "pass"}]
    assert stamp_review.classify(r, require_dsg=True) == ("verified", [])


def test_bare_ruling_with_no_axis_keys_at_all_parks_not_verifies():
    """A ruling like `{"id": "L5"}` — no worst, no f/s/r, no dsg — used to default every axis to
    "clean" and verify. That is silence, not evidence; the operating law disallows it."""
    status, reasons = stamp_review.classify({"id": "L5"})
    assert status == "parked", (status, reasons)
    assert reasons, reasons


def test_a_ruling_with_at_least_one_axis_still_gets_the_missing_axis_default():
    """Only a TOTALLY bare ruling parks by default — one that names even a single clean axis
    still gets the "missing axis defaults to clean" convenience for the others."""
    status, reasons = stamp_review.classify({"id": "L6", "f": "clean"})
    assert status == "verified", (status, reasons)


# --------------------------------------------------------------------------- #
# MEDIUM-4 (audit follow-up) — `_is_clean` must not trust `worst` alone: a clean aggregate next to
# an explicitly non-clean axis is the defect written down and ignored, not silence.
# --------------------------------------------------------------------------- #
def test_worst_clean_but_an_axis_says_high_parks_not_verifies():
    """The reproduction from the audit: `{'id': 'L5', 'worst': 'clean', 'f': 'HIGH'}` used to
    classify as clean because `worst` short-circuited before the axes were ever read."""
    status, reasons = stamp_review.classify({"id": "L5", "worst": "clean", "f": "HIGH"})
    assert status == "parked", (status, reasons)
    assert any("fidelity: HIGH" in x for x in reasons), reasons


def test_worst_clean_but_style_axis_non_clean_parks():
    status, reasons = stamp_review.classify({"id": "L7", "worst": "clean", "s": "LOW"})
    assert status == "parked", (status, reasons)
    assert any("style: LOW" in x for x in reasons), reasons


def test_worst_clean_and_every_present_axis_clean_still_verifies():
    """Regression guard: the fix must not park a genuinely clean ruling that names its axes."""
    status, reasons = stamp_review.classify(
        {"id": "L8", "worst": "clean", "f": "clean", "s": "clean", "r": "clean"})
    assert status == "verified", (status, reasons)
    assert reasons == [], reasons


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


def test_main_exits_nonzero_and_names_the_item_on_malformed_dsg():
    # end-to-end: the CLI must exit nonzero and print which item was malformed, never crash
    # silently or write a partial manifest
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        bad_ruling = _ruling("L09", "clean")
        bad_ruling["dsg"] = [{"id": "zz9", "q": "some fact", "verdict": "maybe"}]
        mpath = _write_video_dir(
            base, [bad_ruling],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L09")]})
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "stamp_review.py"), str(base)],
            capture_output=True, text=True)
        assert proc.returncode != 0, proc.stdout
        assert "zz9" in proc.stderr, proc.stderr
        # the manifest is left untouched — no partial/dishonest stamp written
        assert _read(mpath)["shots"][0]["review_status"] == "unreviewed"


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
# MEDIUM-10 end-to-end — main() reads <video_dir>/shots.json to decide `require_dsg`, the same
# fail-closed law lint_shots.py's HIGH-5 fix uses: only an explicit v1 declaration is legacy.
# --------------------------------------------------------------------------- #
def _write_shots_json(base: Path, schema):
    data = {"channel": "c", "video_slug": "t"}
    if schema is not None:
        data["schema"] = schema
    (base / "shots.json").write_text(json.dumps(data), encoding="utf-8")


def test_main_v2_shots_json_parks_a_ruling_with_no_dsg():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        _write_shots_json(base, "faceless-youtube/shots@2")
        mpath = _write_video_dir(
            base, [_ruling("L01", "clean")],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L01")]})
        stamp_review.main([str(base)])
        e = _read(mpath)["shots"][0]
        assert e["review_status"] == "parked", e
        assert any("dsg" in x for x in e["parked_reasons"]), e


def test_main_explicit_v1_shots_json_keeps_missing_dsg_a_noop():
    """The real 2026-07-19-wells-fargo shots.json declares itself v1 explicitly, and its 119
    rulings genuinely predate the DSG-lite checklist. That must keep verifying."""
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        _write_shots_json(base, "faceless-youtube/shots@1")
        mpath = _write_video_dir(
            base, [_ruling("L01", "clean")],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L01")]})
        stamp_review.main([str(base)])
        e = _read(mpath)["shots"][0]
        assert e["review_status"] == "verified", e


def test_main_missing_schema_key_in_shots_json_requires_dsg():
    """Fail-closed, same as HIGH-5: a shots.json present but with no `schema` key at all is NOT
    treated as legacy — it requires dsg like an explicit v2 file."""
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        _write_shots_json(base, None)
        mpath = _write_video_dir(
            base, [_ruling("L01", "clean")],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L01")]})
        stamp_review.main([str(base)])
        e = _read(mpath)["shots"][0]
        assert e["review_status"] == "parked", e


def test_main_typo_schema_in_shots_json_requires_dsg():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        _write_shots_json(base, "faceless-youtube/shots@3")
        mpath = _write_video_dir(
            base, [_ruling("L01", "clean")],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L01")]})
        stamp_review.main([str(base)])
        e = _read(mpath)["shots"][0]
        assert e["review_status"] == "parked", e


def test_main_no_shots_json_at_all_now_requires_dsg_and_parks():
    """MEDIUM-4 (audit follow-up): this used to be documented as a permanent no-op — "not a real
    pipeline state... defaulting False keeps this a no-op". That was FAILING OPEN on the one
    signal this function reads: a missing shots.json is unknown schema, not legacy schema, and an
    isolated caller with no shots.json at all must now park for want of a `dsg` checklist, the
    same as a real run whose shots.json is missing/typo'd v2, rather than silently verify."""
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        mpath = _write_video_dir(
            base, [_ruling("L01", "clean")],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L01")]},
            schema=None)
        stamp_review.main([str(base)])
        e = _read(mpath)["shots"][0]
        assert e["review_status"] == "parked", e
        assert any("dsg" in x for x in e["parked_reasons"]), e


def test_require_dsg_for_missing_shots_json_is_true():
    """Unit-level companion to the e2e test above, exercising `_require_dsg_for` directly."""
    with tempfile.TemporaryDirectory() as td:
        assert stamp_review._require_dsg_for(Path(td)) is True


def test_require_dsg_for_non_utf8_shots_json_fails_closed_not_a_crash():
    """LOW-8 (audit follow-up): `UnicodeDecodeError` was missing from the except tuple, and the
    call sits outside `main()`'s own try/except, so a mojibake'd shots.json raised a raw
    traceback instead of a controlled, fail-closed answer. Write a shots.json with a byte
    sequence that is not valid UTF-8 and confirm `_require_dsg_for` returns True (fail-closed —
    same conservative answer as a missing file) instead of raising."""
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        (base / "shots.json").write_bytes(b'{"schema": "faceless-youtube/shots@2", "bad": "\xff\xfe"}')
        assert stamp_review._require_dsg_for(base) is True


def test_main_non_utf8_shots_json_parks_instead_of_crashing():
    """End-to-end companion: the CLI must not crash on a mojibake'd shots.json — it fails closed
    (requires dsg) exactly like a missing file, and a ruling with no dsg checklist parks."""
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        (base / "shots.json").write_bytes(b'{"schema": "\xff\xfe-not-utf8"}')
        mpath = _write_video_dir(
            base, [_ruling("L01", "clean")],
            {"video_slug": "t", "generated": "2026", "notes": "", "shots": [_entry("L01")]})
        rc = stamp_review.main([str(base)])
        assert rc == 0, rc
        e = _read(mpath)["shots"][0]
        assert e["review_status"] == "parked", e


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
