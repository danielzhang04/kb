#!/usr/bin/env python3
"""Unit tests for build_review_artifact.py's C-12 row/comparison machinery.

Plain-assert style (this scripts dir has no pytest harness); run with
`py -3 test_build_review_artifact.py`.

Covers: `named_figures_by_shot` / `seated_shots` / `canonical_files` (the generic readers of
`assets/library/manifest.json`, this video's own Pass-1 ledger — never `registry.json`),
`owner_branding_declared`, `applicable_invariants` (the C-12 pre-filter), and an end-to-end
`collect()` pass over a fabricated tmp video dir proving the filter is driven entirely by
declared data — arbitrary, never-seen-before cast/pose names still classify correctly, which is
the "no hardcoded cast/places" requirement made concrete.
"""
import io
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_review_artifact as bra

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required:  py -3 -m pip install pillow")


# --------------------------------------------------------------------------- #
# named_figures_by_shot / seated_shots / canonical_files
# --------------------------------------------------------------------------- #
def test_named_figures_by_shot_reads_arbitrary_never_seen_names():
    # deliberately unfamiliar names — proves the reader hardcodes no cast
    lib = [
        {"name": "zeta-clerk", "kind": "identity", "file": "x/zeta-clerk.png",
         "shots": ["Q01", "Q02"]},
        {"name": "vintner-nine", "kind": "identity", "file": "x/vintner-nine.png",
         "shots": ["Q02"]},
        {"name": "action-walk", "kind": "action", "shots": ["Q01"]},  # not identity: ignored
    ]
    out = bra.named_figures_by_shot(lib)
    assert out["Q01"] == ["zeta-clerk"], out
    assert out["Q02"] == ["vintner-nine", "zeta-clerk"], out  # sorted, dedup-safe


def test_named_figures_by_shot_empty_on_no_library():
    assert bra.named_figures_by_shot([]) == {}


def test_seated_shots_matches_sit_or_seat_in_name_or_tag_generically():
    lib = [
        {"name": "pose", "kind": "pose", "tag": "sit", "shots": ["Q01"]},
        {"name": "acme-seat-fold", "kind": "action", "tag": "", "shots": ["Q02"]},
        {"name": "action-salute", "kind": "action", "tag": "salute", "shots": ["Q03"]},
        {"name": "sitting-pretty", "kind": "prop", "tag": "", "shots": ["Q04"]},  # wrong kind
    ]
    out = bra.seated_shots(lib)
    assert out == {"Q01", "Q02"}, out


def test_canonical_files_maps_identity_name_to_its_file():
    lib = [{"name": "zeta-clerk", "kind": "identity", "file": "refs/zeta-clerk/zeta-clerk.png",
            "shots": ["Q01"]},
           {"name": "action-walk", "kind": "action", "file": "refs/base/action-walk.png",
            "shots": ["Q01"]}]
    out = bra.canonical_files(lib)
    assert out == {"zeta-clerk": "refs/zeta-clerk/zeta-clerk.png"}, out


# --------------------------------------------------------------------------- #
# owner_branding_declared
# --------------------------------------------------------------------------- #
def test_owner_branding_declared_quoted_trackable_literal_in_still_prompt():
    # an owner cue is authored as an ordinary quoted literal, lint's own signal — not a field
    assert bra.owner_branding_declared(
        {"still_prompt": "a plaque reads 'Miniscribe Corp' by the door"}) is True


def test_owner_branding_declared_ambiguity_call_counts_even_if_false():
    # an EXPLICIT ambiguity call (either boolean value) is still a recorded decision
    assert bra.owner_branding_declared({"owner_ambiguity": False}) is True
    assert bra.owner_branding_declared({"owner_ambiguity": True}) is True


def test_owner_branding_declared_false_when_nothing_recorded():
    assert bra.owner_branding_declared({}) is False
    assert bra.owner_branding_declared({"place": "some-place", "figures": {"crowd": True}}) is False
    # a bare backtick cast/pose reference is not a quoted literal — no false positive
    assert bra.owner_branding_declared({"still_prompt": "`zeta-clerk` (`sit`) sits at a desk"}) is False


# --------------------------------------------------------------------------- #
# applicable_invariants — the C-12 pre-filter
# --------------------------------------------------------------------------- #
def test_support_contact_needs_named_figure_and_seated_shot_together():
    rows = bra.applicable_invariants({}, "Q01", ["zeta-clerk"], {"Q01"})
    assert ("support-contact", bra.INVARIANTS["support-contact"]) in rows, rows
    # seated shot but no named figure present -> no row
    rows2 = bra.applicable_invariants({}, "Q02", [], {"Q02"})
    assert not any(slug == "support-contact" for slug, _ in rows2), rows2
    # named figure present but shot not in the seated set -> no row
    rows3 = bra.applicable_invariants({}, "Q03", ["zeta-clerk"], {"Q01"})
    assert not any(slug == "support-contact" for slug, _ in rows3), rows3


def test_relative_scale_needs_two_named_figures():
    assert not any(s == "relative-scale" for s, _ in
                   bra.applicable_invariants({}, "Q01", ["a"], set()))
    rows = bra.applicable_invariants({}, "Q01", ["a", "b"], set())
    assert any(s == "relative-scale" for s, _ in rows), rows


def test_place_owner_needs_place_and_a_recorded_decision():
    # place with no decision -> no row
    rows = bra.applicable_invariants({"place": "hq-lobby"}, "Q01", [], set())
    assert not any(s == "place-owner" for s, _ in rows), rows
    # decision with no place -> no row
    rows2 = bra.applicable_invariants({"owner_ambiguity": True}, "Q01", [], set())
    assert not any(s == "place-owner" for s, _ in rows2), rows2
    # both -> row fires
    rows3 = bra.applicable_invariants({"place": "hq-lobby", "owner_ambiguity": True}, "Q01", [], set())
    assert any(s == "place-owner" for s, _ in rows3), rows3


def test_crowd_row_only_when_figures_crowd_declared():
    assert not any(s == "crowd" for s, _ in bra.applicable_invariants({}, "Q01", [], set()))
    rows = bra.applicable_invariants({"figures": {"crowd": True}}, "Q01", [], set())
    assert any(s == "crowd" for s, _ in rows), rows


def test_flat_cel_hazard_only_on_ai_gen_source():
    assert not any(s == "flat-cel-hazard" for s, _ in
                   bra.applicable_invariants({"source": "stock"}, "Q01", [], set()))
    rows = bra.applicable_invariants({"source": "ai-gen"}, "Q01", [], set())
    assert any(s == "flat-cel-hazard" for s, _ in rows), rows


def test_no_applicable_invariants_returns_empty_list():
    assert bra.applicable_invariants({"source": "stock"}, "Q01", [], set()) == []


# --------------------------------------------------------------------------- #
# collect() end-to-end over a fabricated video dir
# --------------------------------------------------------------------------- #
def _png(path, size=(40, 30), color=(120, 140, 160)):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.new("RGB", size, color).save(path)


def test_collect_wires_invariants_and_canon_into_cards_generically():
    with tempfile.TemporaryDirectory() as td:
        video = Path(td) / "video"
        shots = {
            "schema": "faceless-youtube/shots@2", "long_form": {"shots": [
                {"id": "Q01", "source": "ai-gen", "place": "widget-hall",
                 "still_prompt": "`zeta-clerk` (`sit`) sits at a desk beneath a "
                                  "'Widget Hall' plaque", "vo_text": "he sits"},
                {"id": "Q02", "source": "stock", "figures": {"crowd": True},
                 "still_prompt": "a crowd of onlookers", "vo_text": "onlookers gather"},
            ]}}
        (video).mkdir(parents=True)
        (video / "shots.json").write_text(json.dumps(shots), encoding="utf-8")
        canon_path = video / "refs" / "zeta-clerk.png"
        _png(str(canon_path))
        library = {"assets": [
            {"name": "zeta-clerk", "kind": "identity", "file": str(canon_path), "shots": ["Q01"]},
            {"name": "pose", "kind": "pose", "tag": "sit", "shots": ["Q01"]},
        ]}
        (video / "assets" / "library").mkdir(parents=True)
        (video / "assets" / "library" / "manifest.json").write_text(
            json.dumps(library), encoding="utf-8")
        _png(str(video / "assets" / "scenes" / "Q01.png"))
        _png(str(video / "assets" / "scenes" / "Q02.png"))

        cards = bra.collect(str(video), None)
        by_sid = {c["sid"]: c for c in cards}

        q01_slugs = {s for s, _ in by_sid["Q01"]["invariants"]}
        assert q01_slugs == {"support-contact", "place-owner", "flat-cel-hazard"}, q01_slugs
        assert by_sid["Q01"]["canon"] == [("zeta-clerk", str(canon_path))], by_sid["Q01"]["canon"]

        q02_slugs = {s for s, _ in by_sid["Q02"]["invariants"]}
        assert q02_slugs == {"crowd"}, q02_slugs
        assert by_sid["Q02"]["canon"] == [], by_sid["Q02"]["canon"]  # no named figure -> no comparison


def test_collect_drops_comparison_when_canonical_file_missing_on_disk():
    with tempfile.TemporaryDirectory() as td:
        video = Path(td) / "video"
        shots = {"long_form": {"shots": [
            {"id": "Q01", "source": "ai-gen", "still_prompt": "`ghost-clerk` stands"},
        ]}}
        video.mkdir(parents=True)
        (video / "shots.json").write_text(json.dumps(shots), encoding="utf-8")
        library = {"assets": [
            {"name": "ghost-clerk", "kind": "identity", "file": "nowhere/ghost.png",
             "shots": ["Q01"]},
        ]}
        (video / "assets" / "library").mkdir(parents=True)
        (video / "assets" / "library" / "manifest.json").write_text(
            json.dumps(library), encoding="utf-8")
        _png(str(video / "assets" / "scenes" / "Q01.png"))

        cards = bra.collect(str(video), None)
        assert cards[0]["canon"] == [], cards[0]["canon"]  # never invents a missing comparison


def test_collect_degrades_gracefully_with_no_library_manifest_at_all():
    # source/crowd rows don't depend on the library ledger, so they still fire; named-figure
    # rows (support-contact/relative-scale) and comparisons correctly emit nothing.
    with tempfile.TemporaryDirectory() as td:
        video = Path(td) / "video"
        shots = {"long_form": {"shots": [
            {"id": "Q01", "source": "ai-gen", "figures": {"crowd": True}, "still_prompt": "a crowd"},
        ]}}
        video.mkdir(parents=True)
        (video / "shots.json").write_text(json.dumps(shots), encoding="utf-8")
        _png(str(video / "assets" / "scenes" / "Q01.png"))

        cards = bra.collect(str(video), None)
        slugs = {s for s, _ in cards[0]["invariants"]}
        assert slugs == {"flat-cel-hazard", "crowd"}, slugs
        assert cards[0]["canon"] == [], cards[0]["canon"]


# --------------------------------------------------------------------------- #
# build() — HTML rendering is additive and backward compatible
# --------------------------------------------------------------------------- #
def _card(path, **extra):
    base = dict(sid="Q01", label="scene", path=path, cls="literal", vo="he sits", anim="—",
                flagged=False, reason="", verified={}, invariants=[], canon=[])
    base.update(extra)
    return base


def test_build_renders_checklist_rows_and_canon_thumbnails():
    with tempfile.TemporaryDirectory() as td:
        main_png = os.path.join(td, "main.png")
        canon_png = os.path.join(td, "canon.png")
        _png(main_png)
        _png(canon_png, size=(20, 20))
        card = _card(main_png,
                     invariants=[("support-contact", bra.INVARIANTS["support-contact"])],
                     canon=[("zeta-clerk", canon_png)])
        page, _ = bra.build([card], "T", "sub", 1600, 82)
        assert "support-contact" in page
        assert bra.INVARIANTS["support-contact"] in page
        assert "canonical vs. candidate" in page
        assert "zeta-clerk" in page


def test_build_omits_checklist_and_canon_blocks_when_none_apply():
    # a card with no invariants/canon renders exactly like the pre-C-12 board — no dangling markup
    with tempfile.TemporaryDirectory() as td:
        main_png = os.path.join(td, "main.png")
        _png(main_png)
        card = _card(main_png)
        page, _ = bra.build([card], "T", "sub", 1600, 82)
        assert 'class="checks"' not in page
        assert 'class="canon"' not in page


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
