#!/usr/bin/env python3
"""Unit tests for build_review_artifact.py's C-12 row/comparison machinery.

Plain-assert style (this scripts dir has no pytest harness); run with
`py -3 test_build_review_artifact.py`.

Covers: `named_figures_by_shot` / `seated_shots` / `canonical_files` (the generic readers of
`assets/library/manifest.json`, this video's own Pass-1 ledger — never `registry.json`),
`owner_literal_by_place` / `_quotes_literal`, `applicable_invariants` (the C-12 pre-filter), and
an end-to-end `collect()` pass over a fabricated tmp video dir proving the filter is driven
entirely by declared data — arbitrary, never-seen-before cast/pose names still classify
correctly, which is the "no hardcoded cast/places" requirement made concrete.
"""
import hashlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_review_artifact as bra
import forge
import stamp_review

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


def test_seated_shots_reads_lints_own_prompt_signal_not_the_library_ledger():
    """M11. Seated-ness is decided by the PROMPT — a backticked `sit` pose primitive bound by
    backtick order to the most recently named character — the same signal
    `lint_shots.py::seat_support_check` uses. Deciding it from the library ledger instead meant a
    shot lint HARD-failed for a floating sit could reach the board with no support row."""
    shots = {
        "Q01": {"still_prompt": "`zeta-clerk` (`sit`) at a long desk"},
        "Q02": {"still_prompt": "the metal desk sits pushed aside, `zeta-clerk` standing"},
        "Q03": {"still_prompt": "`sit` alone, bound to no named character"},
        "Q04": {"still_prompt": "`vintner-nine` (`action-salute`) by the door"},
    }
    out = bra.seated_shots(shots, {"zeta-clerk", "vintner-nine"})
    # Q02: the English verb "sits" is NOT the primitive (this project's prose uses it for objects)
    # Q03: an unbound primitive names no figure to rule on
    assert out == {"Q01"}, out


def test_identity_names_is_the_backtick_binding_vocabulary():
    lib = [{"name": "zeta-clerk", "kind": "identity", "shots": ["Q01"]},
           {"name": "pose", "kind": "pose", "tag": "sit", "shots": ["Q01"]}]
    assert bra.identity_names(lib) == {"zeta-clerk"}


# --------------------------------------------------------------------------- #
# drift canaries — every signal copied from lint_shots.py, byte-for-byte
# --------------------------------------------------------------------------- #
LINT_SRC = (Path(__file__).resolve().parents[2] / "visual-prompt-writer" / "scripts"
            / "lint_shots.py")
BRA_SRC = Path(bra.__file__)

# The module-level definitions both files must carry, byte for byte. `lint_shots.py` lives in a
# sibling SKILL with no import path to this one, so C-7's seated signal is COPIED — and a copy
# that drifts is exactly how the two halves of one law start disagreeing per shot (M11: the two
# seated sources). The place-owner signal is NOT in this list any more: F2 landed `place_owner`
# as a real, lint-enforced field, so this file now reads that field directly instead of copying
# lint's quoted-literal scan (the deleted `_QUOTED`/`_TRACKABLE_LITERAL` heuristic).
_MIRRORED_DEFINITIONS = ("_BACKTICK = ", "SEATED_PRIMITIVE = ")


def _definition_block(source, start):
    """The named module-level definition plus its wrapped continuation lines, verbatim."""
    lines = source.splitlines()
    for i, line in enumerate(lines):
        if line.startswith(start):
            block = [line]
            for nxt in lines[i + 1:]:
                if not nxt.strip() or not nxt[:1].isspace():
                    break
                block.append(nxt)
            return "\n".join(block)
    return None


def test_every_signal_copied_from_lint_is_byte_identical_in_both_files():
    assert LINT_SRC.exists(), LINT_SRC
    lint = LINT_SRC.read_text(encoding="utf-8")
    mine = BRA_SRC.read_text(encoding="utf-8")
    for start in _MIRRORED_DEFINITIONS:
        theirs, ours = _definition_block(lint, start), _definition_block(mine, start)
        assert theirs, "gone from lint_shots.py — re-sync or re-derive: %r" % start
        assert ours, "gone from build_review_artifact.py: %r" % start
        assert theirs == ours, "DRIFT in %r:\nlint:\n%s\nreview artifact:\n%s" % (
            start, theirs, ours)


def test_canonical_files_maps_identity_name_to_its_file():
    lib = [{"name": "zeta-clerk", "kind": "identity", "file": "refs/zeta-clerk/zeta-clerk.png",
            "shots": ["Q01"]},
           {"name": "action-walk", "kind": "action", "file": "refs/base/action-walk.png",
            "shots": ["Q01"]}]
    out = bra.canonical_files(lib)
    assert out == {"zeta-clerk": "refs/zeta-clerk/zeta-clerk.png"}, out


# --------------------------------------------------------------------------- #
# owner_literal_by_place / _quotes_literal — the field-based place-owner signal
# (F2 landed `place_owner` as a real, lint-enforced field; this file reads it
# directly instead of re-inferring a decision from a generic quoted-literal scan)
# --------------------------------------------------------------------------- #
def test_owner_literal_by_place_reads_the_declared_field():
    shots = [{"id": "Q01", "place": "widget-hall", "place_owner": "Widget Hall"},
             {"id": "Q02", "place": "widget-hall"}]
    assert bra.owner_literal_by_place(shots) == {"widget-hall": "Widget Hall"}


def test_owner_literal_by_place_empty_string_or_missing_contributes_nothing():
    shots = [{"id": "Q01", "place": "hq-lobby", "place_owner": ""},
             {"id": "Q02", "place": "back-room"}]
    assert bra.owner_literal_by_place(shots) == {}


def test_owner_literal_by_place_owner_ambiguity_contributes_no_entry():
    # an ambiguity call is a real decision, but it declares no LITERAL to verify legibility of
    shots = [{"id": "Q01", "place": "hq-lobby", "owner_ambiguity": True}]
    assert bra.owner_literal_by_place(shots) == {}


def test_quotes_literal_matches_any_of_the_project_quote_styles():
    assert bra._quotes_literal("a plaque reads 'Widget Hall' by the door", "Widget Hall")
    assert bra._quotes_literal('a plaque reads "Widget Hall" by the door', "Widget Hall")
    assert bra._quotes_literal("a plaque reads ‘Widget Hall’ by the door", "Widget Hall")
    assert bra._quotes_literal("a plaque reads “Widget Hall” by the door", "Widget Hall")


def test_quotes_literal_false_when_unquoted_or_a_different_literal():
    # a possessive apostrophe or an unquoted mention is not a redraw — no heuristic to fool here,
    # the string being searched for is already fixed, not inferred from the prompt
    assert not bra._quotes_literal("a customer's Widget Hall badge on the desk", "Widget Hall")
    assert not bra._quotes_literal("a plaque reads 'Acme Corp' by the door", "Widget Hall")
    assert not bra._quotes_literal("", "Widget Hall")
    assert not bra._quotes_literal("a plaque reads 'Widget Hall'", "")


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


def test_place_owner_fires_on_the_plate_that_declared_the_literal():
    # (a): a shot that IS the plate -- it carries `place_owner` itself
    owner_of = {"hq-lobby": "Widget Hall"}
    shot = {"place": "hq-lobby", "place_owner": "Widget Hall"}
    rows = bra.applicable_invariants(shot, "Q01", [], set(), owner_of)
    assert ("place-owner", "owner cue 'Widget Hall' legible in frame per L-1?") in rows, rows


def test_place_owner_fires_on_a_later_shot_that_redraws_the_literal():
    # (b): a delta/chain shot that never declares `place_owner` itself (lint forbids that), but
    # its own still_prompt re-quotes the place's established literal
    owner_of = {"hq-lobby": "Widget Hall"}
    shot = {"place": "hq-lobby", "still_prompt": "the desk sits under the 'Widget Hall' sign"}
    rows = bra.applicable_invariants(shot, "Q02", [], set(), owner_of)
    assert ("place-owner", "owner cue 'Widget Hall' legible in frame per L-1?") in rows, rows


def test_place_owner_silent_on_an_owner_ambiguity_place():
    # the place declared `owner_ambiguity`, not a literal -- `owner_of` carries no entry for it,
    # so no row fires anywhere in the place, plate or otherwise
    owner_of = {}
    plate = {"place": "back-room", "owner_ambiguity": True}
    other = {"place": "back-room", "still_prompt": "the same back room, emptier now"}
    assert not any(s == "place-owner" for s, _ in
                   bra.applicable_invariants(plate, "Q01", [], set(), owner_of))
    assert not any(s == "place-owner" for s, _ in
                   bra.applicable_invariants(other, "Q02", [], set(), owner_of))


def test_place_owner_silent_on_a_shot_that_does_not_carry_the_literal():
    # same place, literal declared elsewhere, but THIS shot neither declares it nor quotes it
    owner_of = {"hq-lobby": "Widget Hall"}
    shot = {"place": "hq-lobby", "still_prompt": "a wide shot of the lobby, sign out of frame"}
    rows = bra.applicable_invariants(shot, "Q03", [], set(), owner_of)
    assert not any(s == "place-owner" for s, _ in rows), rows


def test_place_owner_silent_with_no_place_declared():
    rows = bra.applicable_invariants({"place_owner": "Widget Hall"}, "Q01", [], set(),
                                     {"hq-lobby": "Widget Hall"})
    assert not any(s == "place-owner" for s, _ in rows), rows


def test_place_owner_defaults_owner_of_to_empty_when_omitted():
    # backward-compatible call shape: no `owner_of` arg -> never fires, never crashes
    rows = bra.applicable_invariants({"place": "hq-lobby", "place_owner": "Widget Hall"},
                                     "Q01", [], set())
    assert not any(s == "place-owner" for s, _ in rows), rows


def test_crowd_row_only_when_figures_crowd_declared():
    assert not any(s == "crowd" for s, _ in bra.applicable_invariants({}, "Q01", [], set()))
    rows = bra.applicable_invariants({"figures": {"crowd": True}}, "Q01", [], set())
    assert any(s == "crowd" for s, _ in rows), rows


def test_flat_cel_hazard_fires_on_every_shot_whose_pixels_are_generated():
    """M13. forge generates for `ai-gen` OR `hybrid`, and treats an absent `source` as `ai-gen`.
    Narrowed to `== "ai-gen"`, a generated hybrid frame — or any shot whose author omitted
    `source` — reached the board with NO style row, in the one wave whose headline defect is style
    drift. Only pure library reuse (the sources forge skips) is exempt."""
    for generated in ({"source": "ai-gen"}, {"source": "hybrid"}, {}):
        rows = bra.applicable_invariants(generated, "Q01", [], set())
        assert any(s == "flat-cel-hazard" for s, _ in rows), generated
    for reused in ("stock", "chart", "screencap", "archival"):
        rows = bra.applicable_invariants({"source": reused}, "Q01", [], set())
        assert not any(s == "flat-cel-hazard" for s, _ in rows), reused


def test_line_register_fires_wherever_flat_cel_hazard_does_and_nowhere_else():
    """The 2026-08 line-register axis. It rides the SAME generated-pixels predicate as
    `flat-cel-hazard` because it is the same risk asked about differently: that axis rules on
    SHADING technique, this one on LINE WEIGHT — a frame can be perfectly flat-cel and still be
    drawn a whole register thinner than its own cast, which had no row to fail on."""
    for generated in ({"source": "ai-gen"}, {"source": "hybrid"}, {}):
        rows = bra.applicable_invariants(generated, "Q01", ["zeta"], set())
        assert any(s == "line-register" for s, _ in rows), generated
    for reused in ("stock", "chart", "screencap", "archival"):
        rows = bra.applicable_invariants({"source": reused}, "Q01", [], set())
        assert not any(s == "line-register" for s, _ in rows), reused


def test_insertability_fires_only_on_a_generated_cast_free_plate():
    """A plate's one job is to be STOOD ON, so the axis is scoped to the tier that has no cast:
    a figure-bearing or crowd-bearing frame already answers the question in pixels."""
    plate = bra.applicable_invariants({"source": "ai-gen"}, "Q01", [], set())
    assert any(s == "insertability" for s, _ in plate), plate
    cast = bra.applicable_invariants({"source": "ai-gen"}, "Q01", ["zeta-clerk"], set())
    assert not any(s == "insertability" for s, _ in cast), cast
    crowd = bra.applicable_invariants({"source": "ai-gen", "figures": {"crowd": True}},
                                      "Q01", [], set())
    assert not any(s == "insertability" for s, _ in crowd), crowd
    reused = bra.applicable_invariants({"source": "stock"}, "Q01", [], set())
    assert not any(s == "insertability" for s, _ in reused), reused


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
                 "place_owner": "Widget Hall",
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
        # Q01 names cast, so it takes `line-register` (every generated frame) but not
        # `insertability` (plate tier only).
        assert q01_slugs == {"support-contact", "place-owner", "flat-cel-hazard",
                             "line-register"}, q01_slugs
        assert ("place-owner", "owner cue 'Widget Hall' legible in frame per L-1?") in \
            by_sid["Q01"]["invariants"], by_sid["Q01"]["invariants"]
        assert by_sid["Q01"]["canon"] == [("zeta-clerk", str(canon_path))], by_sid["Q01"]["canon"]

        q02_slugs = {s for s, _ in by_sid["Q02"]["invariants"]}
        assert q02_slugs == {"crowd"}, q02_slugs
        assert by_sid["Q02"]["canon"] == [], by_sid["Q02"]["canon"]  # no named figure -> no comparison


def test_collect_wires_the_place_owner_row_across_a_place_end_to_end():
    """The full (a)/(b)/no-row set, driven through `collect()` rather than
    `applicable_invariants` directly, over one place with a plate and two later shots."""
    with tempfile.TemporaryDirectory() as td:
        video = Path(td) / "video"
        shots = {"long_form": {"shots": [
            # plate: declares the literal itself -> (a)
            {"id": "P01", "source": "ai-gen", "place": "widget-hall",
             "place_owner": "Widget Hall",
             "still_prompt": "an establishing shot beneath a 'Widget Hall' plaque"},
            # later shot, same place, redraws the plate's literal -> (b)
            {"id": "P02", "source": "ai-gen", "place": "widget-hall",
             "still_prompt": "the desk sits under the 'Widget Hall' sign"},
            # later shot, same place, carries no cue at all -> no row
            {"id": "P03", "source": "ai-gen", "place": "widget-hall",
             "still_prompt": "a tight shot of the desk drawer, sign out of frame"},
            # a different place entirely, owner_ambiguity -> no row anywhere in it
            {"id": "P04", "source": "ai-gen", "place": "back-room",
             "owner_ambiguity": True, "still_prompt": "a dim, unmarked back room"},
        ]}}
        video.mkdir(parents=True)
        (video / "shots.json").write_text(json.dumps(shots), encoding="utf-8")
        for sid in ("P01", "P02", "P03", "P04"):
            _png(str(video / "assets" / "scenes" / (sid + ".png")))

        cards = {c["sid"]: c for c in bra.collect(str(video), None)}
        q = "owner cue 'Widget Hall' legible in frame per L-1?"
        assert ("place-owner", q) in cards["P01"]["invariants"], cards["P01"]["invariants"]
        assert ("place-owner", q) in cards["P02"]["invariants"], cards["P02"]["invariants"]
        assert not any(s == "place-owner" for s, _ in cards["P03"]["invariants"])
        assert not any(s == "place-owner" for s, _ in cards["P04"]["invariants"])


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
        assert slugs == {"flat-cel-hazard", "crowd", "line-register"}, slugs
        assert cards[0]["canon"] == [], cards[0]["canon"]


# --------------------------------------------------------------------------- #
# build() — HTML rendering is additive and backward compatible
# --------------------------------------------------------------------------- #
def _card(path, **extra):
    base = dict(sid="Q01", label="scene", path=path, cls="literal", vo="he sits", anim="—",
                flagged=False, reason="", review_status="unreviewed", invariants=[], canon=[])
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
# M4 — the honest three-state stamp, never the deleted `verified` boolean
# --------------------------------------------------------------------------- #
def test_cards_carry_the_three_state_review_status_not_the_deleted_verified_boolean():
    """`stamp_review.py` has written `review_status` since the three-state gate landed and states
    outright that it never writes the legacy `verified: {scene, rig}` shape. Reading `verified`
    reported EVERY card as unstamped — including a fully verified batch — a false honesty signal on
    the review surface, in the wave whose whole point is honest review."""
    with tempfile.TemporaryDirectory() as td:
        video = Path(td) / "video"
        video.mkdir(parents=True)
        (video / "shots.json").write_text(json.dumps({"long_form": {"shots": [
            {"id": "Q01", "source": "ai-gen", "still_prompt": "a desk"},
            {"id": "Q02", "source": "ai-gen", "still_prompt": "a door"}]}}), encoding="utf-8")
        _png(str(video / "assets" / "scenes" / "Q01.png"))
        _png(str(video / "assets" / "scenes" / "Q02.png"))
        (video / "assets" / "scenes" / "manifest.json").write_text(json.dumps({"shots": [
            {"shot_id": "Q01", "review_status": "verified", "parked_reasons": []},
            {"shot_id": "Q02", "review_status": "parked", "parked_reasons": ["rig: HIGH"]}]}),
            encoding="utf-8")
        cards = {c["sid"]: c for c in bra.collect(str(video), None)}
        assert cards["Q01"]["review_status"] == "verified", cards["Q01"]
        assert cards["Q02"]["review_status"] == "parked", cards["Q02"]
        assert "verified" not in cards["Q01"] or isinstance(cards["Q01"].get("verified"), str)
        # only the non-`verified` entries are reported as outstanding
        assert [s for s, c in cards.items() if c["review_status"] != "verified"] == ["Q02"]


# --------------------------------------------------------------------------- #
# C-6 — the closing step of the figure-reuse loop
# --------------------------------------------------------------------------- #
def _staged_figure(staging, fig_id):
    os.makedirs(staging, exist_ok=True)
    path = os.path.join(staging, fig_id + ".png")
    _png(path)
    with open(path, "rb") as f:
        return path, hashlib.sha256(f.read()).hexdigest()


def test_pending_figures_is_forges_own_reuse_gate_never_a_second_predicate():
    """A figure carrying an all-pass, digest-current record is REUSABLE and must not cost the
    reviewer an eye; every other staged figure is exactly what the next batch would hard-stop on."""
    with tempfile.TemporaryDirectory() as td:
        staging = os.path.join(td, "_staging")
        _staged_figure(staging, "fig-zeta-clerk--sit--expr-deadpan")           # no record
        ok_path, ok_sha = _staged_figure(staging, "fig-vintner-nine--stand--expr-smug")
        failed_path, failed_sha = _staged_figure(staging, "fig-ghost--stand--expr-smug")
        with io.open(os.path.join(staging, "review.json"), "w", encoding="utf-8") as f:
            json.dump({"figures": {
                "fig-vintner-nine--stand--expr-smug": {
                    "canonical_sha256": ok_sha, "expression_sha256": None,
                    "verdicts": {"rig": "pass"}, "reviewer": "fresh-eyes", "date": "2026-08-04"},
                "fig-ghost--stand--expr-smug": {
                    "canonical_sha256": failed_sha, "expression_sha256": None,
                    "verdicts": {"rig": "fail"}, "reviewer": "fresh-eyes", "date": "2026-08-04"},
            }}, f)
        pending = {fig for fig, _p, _w in bra.pending_figures(staging)}
        assert pending == {"fig-zeta-clerk--sit--expr-deadpan",
                           "fig-ghost--stand--expr-smug"}, pending


def test_the_figure_skeleton_is_stamp_reviews_input_shape_with_empty_verdicts():
    with tempfile.TemporaryDirectory() as td:
        staging = os.path.join(td, "_staging")
        path, sha = _staged_figure(staging, "fig-zeta-clerk--sit--expr-deadpan")
        skeleton = bra.figure_verdict_skeleton(bra.pending_figures(staging))
        rec = skeleton["figures"]["fig-zeta-clerk--sit--expr-deadpan"]
        assert rec["canonical_sha256"] == sha, rec
        assert set(rec) == {"canonical_sha256", "expression_sha256", "verdicts", "reviewer", "date"}
        assert set(rec["verdicts"]) == set(bra.FIGURE_INVARIANTS), rec["verdicts"]
        assert all(v == "" for v in rec["verdicts"].values()), rec["verdicts"]
        # and it feeds `stamp_review.py --figures` unchanged once the verdicts are filled
        rec["verdicts"] = {k: "pass" for k in rec["verdicts"]}
        store = {}
        assert stamp_review.merge_figure_records(store, skeleton) == 1
        assert store["figures"]["fig-zeta-clerk--sit--expr-deadpan"]["canonical_sha256"] == sha
        # ... which is exactly what clears forge's gate for the next slice
        with io.open(os.path.join(staging, "review.json"), "w", encoding="utf-8") as f:
            json.dump(store, f)
        assert bra.pending_figures(staging) == []


def test_pending_figures_become_review_cards_carrying_the_figure_invariants():
    with tempfile.TemporaryDirectory() as td:
        video = Path(td) / "video"
        video.mkdir(parents=True)
        (video / "shots.json").write_text(json.dumps({"long_form": {"shots": [
            {"id": "Q01", "source": "ai-gen", "still_prompt": "`zeta-clerk` at a desk"}]}}),
            encoding="utf-8")
        _png(str(video / "assets" / "scenes" / "Q01.png"))
        canon = video / "refs" / "zeta-clerk.png"
        _png(str(canon))
        (video / "assets" / "library").mkdir(parents=True)
        (video / "assets" / "library" / "manifest.json").write_text(json.dumps({"assets": [
            {"name": "zeta-clerk", "kind": "identity", "file": str(canon), "shots": ["Q01"]}]}),
            encoding="utf-8")
        staging = os.path.join(td, "_staging")
        _staged_figure(staging, "fig-zeta-clerk--sit--expr-deadpan")
        cards = bra.collect(str(video), None, staging)
        fig = cards[-1]
        assert fig["sid"] == "fig-zeta-clerk--sit--expr-deadpan", fig
        assert fig["label"] == "step-1 figure" and fig["flagged"] is True, fig
        assert "no review record" in fig["reason"], fig["reason"]
        assert [s for s, _q in fig["invariants"]] == list(bra.FIGURE_INVARIANTS), fig["invariants"]
        assert fig["canon"] == [("zeta-clerk", str(canon))], fig["canon"]
        # the scene cards are untouched and still come first, in shots.json order
        assert [c["sid"] for c in cards[:-1]] == ["Q01"], cards


def test_figure_character_reads_forges_own_frame_name_composition():
    assert bra.figure_character("fig-zeta-clerk--sit--expr-deadpan") == "zeta-clerk"
    assert bra.figure_character(forge.figure_frame_name("qt-wiles", "sit", "expr-smug")) == "qt-wiles"


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
