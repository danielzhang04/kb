# -*- coding: utf-8 -*-
"""Planted-defect + false-positive tests for the 2026-08-04 doctrine-reset guards:
C-2 (style one-voice), C-3/C-5 (place), C-7 (seat/support), C-8 (two-figure presence,
action-chain, semantic-cast). Every guard gets a plant it MUST catch and at least one
real-prose near-miss it must stay silent on — the calibration duty the build brief
requires, lifted from the archived bricks-fresh shots.json the adversarial review
measured (`channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`,
ids cited in comments below) so the negatives are genuine authored prose, not
invented straw cases.

Run from the scripts/ dir:  py -3 -m pytest test_doctrine_reset_guards.py -q
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import lint_shots as L  # noqa: E402

# A stand-in suffix for the checks that merely need SOME suffix value.
SUFFIX = "hand-lettered marker capitals for any in-world text"
# The poyais-era suffix restored 2026-08-05 (`ff36f63:videos/2026-07-04-poyais/shots.json`) —
# the channel's TAIL style voice. It is dense with recipe vocabulary BY DESIGN, so it is the
# calibration case the retargeted one-voice guard must stay silent on.
ERA_SUFFIX = (
    "Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm "
    "brown-black (#241a12) outline on everything, flat cel colours with gentle soft shading, "
    "rounded friendly shapes, no realistic detail; any in-world lettering "
    "hand-lettered in the marker style, short and legible; warm-biased scene palette plus "
    "the single red accent #d7402b used only semantically (alarm / prohibition / ownership / the "
    "last punch element); no photorealism, no on-screen narrator or host face, no unrequested "
    "text, no logos; 16:9.")


def _kit_with_suffix(text):
    """A throwaway <channel>/videos/<slug> dir whose ../../visual-kit/visual-grammar.md
    carries `text` as the channel's authored suffix. Returns the video dir."""
    root = Path(tempfile.mkdtemp())
    vdir = root / "videos" / "slug"
    vdir.mkdir(parents=True)
    kit = root / "visual-kit"
    kit.mkdir()
    (kit / "visual-grammar.md").write_text(
        "# grammar\n\n**`global_prompt_suffix`** - fixed channel data:\n\n> "
        + text + "\n\nProse after the blockquote.\n", encoding="utf-8")
    return vdir


def _p(prompt, pid="L01", field="still_prompt"):
    return [(pid, field, prompt)]


# =============================================================================
# C-2 — banned render-technique terms (prompts + suffix)
# =============================================================================
def test_c2_plant_each_banned_term_once():
    cases = {
        "gradient": "a gradient wash over the wall",
        "gloss": "a gloss sheen on the desk",
        "glossy": "a glossy varnish on the desk",
        "specular": "a specular highlight on the glass",
        "bloom": "a bloom of light around the lamp",
        "depth-of-field": "shallow depth-of-field on the foreground figure",
        "depth of field": "shallow depth of field on the foreground figure",
        "blurred background": "a blurred background behind the desk",
        "blurred behind": "the shelving is blurred behind him",
        "soft focus": "the corridor falls into soft focus",
        "photoreal": "a photoreal render of the office",
        "photorealistic": "a photorealistic render of the office",
        "subsurface": "subsurface scattering on the skin",
        "rim light": "a rim light along his shoulder",
    }
    for name, prompt in cases.items():
        hard = []
        L.render_technique_check("lf", _p(prompt), hard)
        assert len(hard) == 1, (name, hard)


def test_c2_scene_light_nouns_never_flagged():
    """The exact real prose (bricks L25/L79): 'warm amber light', 'warm lamp amber' —
    the design's own carve-out, and the measured false-positive class M8 found on
    ~70 real shots."""
    hard = []
    L.render_technique_check("lf", _p(
        "warm amber light spilling from inside in one low bar across the dark yard, "
        "the palette is charcoal, worn terracotta, ochre, and warm lamp amber"), hard)
    assert hard == [], hard


def test_c2_case_insensitive():
    hard = []
    L.render_technique_check("lf", _p("a GRADIENT wash, GLOSSY finish"), hard)
    assert len(hard) == 2, hard


def test_c2_thumbnail_and_suffix_are_covered():
    """render_technique_check takes the same (id, field, text) shape used for prompts,
    suffix, and thumbnail gen_prompt alike."""
    hard = []
    L.render_technique_check("thumbnail", [("thumbnail.primary", "gen_prompt",
                                            "a bloom of light behind the hero " + SUFFIX)], hard)
    assert len(hard) == 1, hard


# =============================================================================
# C-2(a) — suffix one-voice
# =============================================================================
def test_c2a_an_empty_suffix_hard_fails():
    """The suffix is the TAIL half of the two style voices forge injects; an empty one
    silently deletes half the LOOK from every generation in the file."""
    hard = []
    L.suffix_one_voice_check("", hard)
    assert len(hard) == 1 and "EMPTY" in hard[0], hard


def test_c2a_the_era_style_suffix_is_silent():
    """RETARGETED 2026-08-05. Style vocabulary in the suffix used to hard-fail under the
    lettering-only doctrine; the era restoration makes it the suffix's JOB. The restored
    suffix — a hex outline colour, a hex accent, `gentle soft shading`, the marker lettering
    register, `no photorealism` — must lint CLEAN, and it is
    the acceptance case for the visual-grammar.md header."""
    hard = []
    L.suffix_one_voice_check(ERA_SUFFIX, hard, _kit_with_suffix(ERA_SUFFIX))
    assert hard == [], hard


def test_c2a_a_suffix_that_diverges_from_its_channel_home_hard_fails():
    """The one-voice law, moved to where it is mechanically decidable: the suffix has ONE
    home (`visual-grammar.md`) and shots.json carries a verbatim COPY. Two texts differing
    by a word are two voices."""
    hard = []
    L.suffix_one_voice_check(ERA_SUFFIX.replace("gentle soft shading", "smooth shading"),
                             hard, _kit_with_suffix(ERA_SUFFIX))
    assert len(hard) == 1 and "does not match the channel's authored suffix" in hard[0], hard


def test_c2a_an_unreachable_kit_downgrades_to_non_empty_rather_than_inventing_a_canonical():
    """A fixture or a detached shots.json has no visual-kit to compare against. The check
    must not fabricate a canonical and fail correct text."""
    hard = []
    L.suffix_one_voice_check(ERA_SUFFIX, hard)          # vdir=None
    assert hard == [], hard
    hard = []
    L.suffix_one_voice_check(SUFFIX, hard, Path(tempfile.mkdtemp()) / "videos" / "slug")
    assert hard == [], hard


def test_c2a_the_render_technique_ban_still_owns_authored_prose():
    """The C-2 ban no longer runs on the suffix (it guards AUTHORED per-shot prose, and the
    channel suffix legitimately names `no realistic detail` and `no photorealism`).
    That ownership move must not weaken the prose side."""
    hard = []
    L.render_technique_check("long-form", _p("the corridor falls into soft focus at the edges"), hard)
    assert len(hard) == 1 and "'soft focus'" in hard[0], hard
    hard = []
    L.render_technique_check("long-form", _p("an airbrushed sky over the yard"), hard)
    assert len(hard) == 1 and "airbrush" in hard[0].lower(), hard


# =============================================================================
# C-3 — place key shape, shot-class/context exemptions, place-inventory
# =============================================================================
def _pkc(place):
    hard = []
    L.place_key_check("lf", [("L01", {"id": "L01", "place": place})], hard)
    return hard


def test_c3_plant_uppercase_place():
    assert len(_pkc("MiniScribe-Boardroom")) == 1


def test_c3_plant_space_in_place():
    assert len(_pkc("miniscribe boardroom")) == 1


def test_c3_valid_kebab_place_is_silent():
    assert _pkc("miniscribe-boardroom") == []
    assert _pkc("brick-co-yard") == []


def test_c3_absent_place_is_silent():
    hard = []
    L.place_key_check("lf", [("L01", {"id": "L01"})], hard)
    assert hard == []


def test_c3_plant_placeless_shot_class_declares_place():
    hard = []
    L.place_shot_class_exempt_check(
        "lf", [{"id": "L23", "shot_class": "map-plan-view", "place": "shipping-map"}], hard)
    assert len(hard) == 1 and "map-plan-view" in hard[0], hard


def test_c3_ordinary_shot_class_with_place_is_silent():
    hard = []
    L.place_shot_class_exempt_check(
        "lf", [{"id": "L60", "shot_class": "staged-interaction", "place": "fear-boardroom"}], hard)
    assert hard == []


# P1 PIN (taste-forensics G2) — the symbolic/abstract/object-insert classes STAY place-exempt, so
# P5/P6 plate pressure can never force a plate onto a standalone concept shot. Daniel liked exactly
# these (L32 "fun and unique", L35, L48) and ruled "there should be various standalone shots
# throughout. Many shots shouldn't be using plates anyways."
def test_c3_all_five_placeless_classes_are_exempt_and_enforced():
    # The membership half of the pin: without it the loop below passes VACUOUSLY if a later
    # proposal quietly drops a class out of the exempt set to widen plate coverage.
    assert L._PLACELESS_SHOT_CLASSES >= {
        "symbolic-stand-in-object", "number-glued-to-object", "map-plan-view",
        "physicalized-imbalance", "register-shift-infographic"}, L._PLACELESS_SHOT_CLASSES
    assert L._PLACELESS_SHOT_CLASSES <= L.SHOT_CLASSES, L._PLACELESS_SHOT_CLASSES
    for sc in L._PLACELESS_SHOT_CLASSES:
        hard = []
        L.place_shot_class_exempt_check("lf", [{"id": "X", "shot_class": sc, "place": "x-y"}], hard)
        assert len(hard) == 1, (sc, hard)


# P1 PIN (taste-forensics G2) — the thumbnail/first_frame context exemption is the other half of the
# standalone-shot protection: these run seedless under the bible descriptor and no plate law may
# start anchoring them to a place.
def test_c3_plant_thumbnail_declares_place():
    hard = []
    L.place_context_exempt_check("thumbnail", [("thumbnail.primary", {"place": "miniscribe-boardroom"})], hard)
    assert len(hard) == 1, hard


def test_c3_plant_first_frame_declares_place():
    hard = []
    L.place_context_exempt_check("short:s1", [("first_frame", {"place": "brick-co-yard"})], hard)
    assert len(hard) == 1, hard


def test_c3_thumbnail_without_place_is_silent():
    hard = []
    L.place_context_exempt_check("thumbnail", [("thumbnail.primary", {"gen_prompt": "a hero shot"})], hard)
    assert hard == []


# --- place-inventory ---------------------------------------------------------
def test_c3_plant_invented_place_not_in_script():
    vocab = {"miniscribe", "boardroom", "brick", "warehouse"}
    hard = []
    L.place_inventory_check("lf", [("L01", {"id": "L01", "place": "phantom-antechamber"})], vocab, hard)
    assert len(hard) == 1 and "phantom-antechamber" in hard[0], hard


def test_c3_place_anchored_to_real_script_vocab_is_silent():
    vocab = {"miniscribe", "boardroom", "brick", "warehouse"}
    hard = []
    L.place_inventory_check("lf", [("L01", {"id": "L01", "place": "miniscribe-boardroom"})], vocab, hard)
    assert hard == []


def test_c3_generic_only_tokens_cannot_be_judged_and_stay_silent():
    """A place id made only of structural set-type nouns ('office-room') has nothing
    this check can anchor to a script — silent, not a false accusation of invention."""
    vocab = {"miniscribe"}
    hard = []
    L.place_inventory_check("lf", [("L01", {"id": "L01", "place": "office-room"})], vocab, hard)
    assert hard == []


def test_c3_empty_vocab_means_no_check_at_all():
    hard = []
    L.place_inventory_check("lf", [("L01", {"id": "L01", "place": "phantom-antechamber"})], set(), hard)
    assert hard == []


# --- C-4 plate law: ONE definition (place_groups) -----------------------------
def test_c4_the_plate_is_the_first_in_file_shot_of_the_place():
    """One definition, decidable from the authored file alone — file order, cast or no
    cast. forge's `plate = not seeds` is the mechanical mirror; place_plate_check is what
    makes the two coincide."""
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom", "still_prompt": "`qt-wiles` at the table."},
        {"id": "L61", "place": "miniscribe-boardroom", "still_prompt": "The empty boardroom."},
        {"id": "L62", "place": "brick-co-yard", "still_prompt": "The yard at dusk."},
        {"id": "L63", "place": "miniscribe-boardroom", "still_prompt": "The boardroom, revisited."},
    ]
    groups = {p: (plate["id"], [s["id"] for s in grp], q) for p, plate, grp, q in L.place_groups(shots)}
    assert groups["miniscribe-boardroom"] == ("L60", ["L60", "L61", "L63"], True)
    assert groups["brick-co-yard"] == ("L62", ["L62"], False)   # single visit, unbranded


def test_c4_a_place_qualifies_on_REVISIT_not_on_shot_count():
    """The 2026-08-04 round-2 definition: a place RECURS when the file revisits it after
    leaving. An unbroken single visit is a STAGE — its chain base already IS the frame every
    later shot of the run seeds, so demanding a dedicated cast-free plate for a set the video
    never returns to is pure generation cost (the fresh fifth's author read it this way and
    was right). Same shot COUNT, opposite verdict, decided only by the visit pattern."""
    one_visit = [
        {"id": "L60", "place": "pc-store-1983", "still_prompt": "The shop counter."},
        {"id": "L61", "place": "pc-store-1983", "still_prompt": "The shop counter, a box added."},
    ]
    revisited = [
        {"id": "L60", "place": "pc-store-1983", "still_prompt": "The shop counter."},
        {"id": "L61", "place": "brick-co-yard", "still_prompt": "The yard at dusk."},
        {"id": "L62", "place": "pc-store-1983", "still_prompt": "The shop counter again."},
    ]
    assert [q for _p, _pl, _g, q in L.place_groups(one_visit)] == [False]
    assert [q for _p, _pl, _g, q in L.place_groups(revisited)] == [True, False]


def test_c4_place_owner_qualifies_a_single_visit_place():
    """The one exception the revisit rule keeps: a BRANDED set records its ownership decision
    on a cast-free plate whatever its visit count, because the sign bleeds into everything
    that seeds the plate."""
    shots = [
        {"id": "L60", "place": "miniscribe-plant", "place_owner": "MINISCRIBE",
         "still_prompt": "The floor, a board lettered 'MINISCRIBE'."},
        {"id": "L61", "place": "miniscribe-plant", "still_prompt": "The floor, one bench bare."},
    ]
    assert [q for _p, _pl, _g, q in L.place_groups(shots)] == [True]


def test_c4_new_seam_the_plate_skips_a_non_generated_first_shot():
    """New seam (2026-08-04): forge.py:1293-1297 skips any shot whose `source` is outside
    ai-gen|hybrid BEFORE `place_first` is ever set, so a place whose first-in-file shot is
    `stock`/`chart`/etc is invisible to forge's plate math. Lint's plate must be the first-in-
    file GENERATED shot, mirroring that skip exactly - not merely the first-in-file shot."""
    shots = [
        {"id": "L59", "place": "miniscribe-boardroom", "source": "stock",
         "still_prompt": "Stock photo of a generic boardroom."},
        {"id": "L60", "place": "miniscribe-boardroom", "still_prompt": "The empty boardroom."},
        {"id": "L61", "place": "brick-co-yard", "still_prompt": "The yard at dusk."},
        {"id": "L62", "place": "miniscribe-boardroom", "still_prompt": "The boardroom again."},
    ]
    groups = {p: (plate["id"], [s["id"] for s in grp], q) for p, plate, grp, q in L.place_groups(shots)}
    assert groups["miniscribe-boardroom"] == ("L60", ["L59", "L60", "L62"], True)


def test_c4_new_seam_a_place_with_no_generated_shot_has_no_plate():
    """No generated shot -> forge builds nothing for this place, so no plate law applies."""
    shots = [
        {"id": "L59", "place": "archive-hall", "source": "stock", "still_prompt": "Stock archive photo."},
        {"id": "L60", "place": "archive-hall", "source": "chart", "still_prompt": "A chart overlay."},
    ]
    assert L.place_groups(shots) == []


def test_c4_new_seam_a_stock_first_shot_still_lets_the_generated_plate_require_no_cast():
    """The plate law fires on the first GENERATED shot even when a stock shot precedes it -
    a named-cast stock frame does not exempt the real (generated) plate from C-4."""
    shots = [
        {"id": "L59", "place": "miniscribe-boardroom", "source": "stock",
         "still_prompt": "Stock photo, no cast."},
        {"id": "L60", "place": "miniscribe-boardroom",
         "still_prompt": "`qt-wiles` (`expr-smug`) sits at the head of the long table."},
        {"id": "L61", "place": "brick-co-yard", "still_prompt": "The yard at dusk."},
        {"id": "L62", "place": "miniscribe-boardroom", "still_prompt": "The same table, now empty."},
    ]
    hard = []
    L.place_plate_check("lf", shots, CHARS, hard)
    assert len(hard) == 1 and "qt-wiles" in hard[0] and "L60" in hard[0], hard


def test_c4_plant_a_qualifying_plate_carrying_named_cast():
    """The R2-M1 gap: a recurring place entered on a cast-bearing frame. Every later
    in-place shot would seed a cast-bearing rendered scene as its place frame."""
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom",
         "still_prompt": "`qt-wiles` (`expr-smug`) sits at the head of the long table."},
        {"id": "L61", "place": "brick-co-yard", "still_prompt": "The yard at dusk."},
        {"id": "L62", "place": "miniscribe-boardroom", "still_prompt": "The same table, now empty."},
    ]
    hard = []
    L.place_plate_check("lf", shots, CHARS, hard)
    assert len(hard) == 1 and "qt-wiles" in hard[0] and "L60" in hard[0], hard


def test_c4_a_single_use_unbranded_place_is_exempt():
    """C-4's conditional plate law: one shot, no `place_owner` — that shot IS its own
    place-first frame and runs seedless. No plate is demanded of it."""
    shots = [{"id": "L62", "place": "brick-co-yard",
              "still_prompt": "`brick-foreman` (`expr-deadpan`) stands alone in the yard."}]
    hard = []
    L.place_plate_check("lf", shots, CHARS, hard)
    assert hard == []


def test_c4_place_owner_makes_a_single_shot_place_qualify():
    shots = [{"id": "L62", "place": "miniscribe-boardroom", "place_owner": "MINISCRIBE",
              "still_prompt": "`qt-wiles` under a plaque reading 'MINISCRIBE'."}]
    hard = []
    L.place_plate_check("lf", shots, CHARS, hard)
    assert len(hard) == 1 and "qt-wiles" in hard[0], hard


def test_c4_a_plate_may_not_be_a_stage_delta():
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom", "stage": "fear-beat", "stage_role": "Delta",
         "still_prompt": "The empty boardroom, one chair moved."},
        {"id": "L61", "place": "brick-co-yard", "still_prompt": "The yard at dusk."},
        {"id": "L62", "place": "miniscribe-boardroom", "still_prompt": "The boardroom again."},
    ]
    hard = []
    L.place_plate_check("lf", shots, CHARS, hard)
    assert len(hard) == 1 and "delta" in hard[0], hard      # case-normalized like forge


def test_c4_no_cast_vocabulary_degrades_the_cast_half_silently():
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom", "still_prompt": "`qt-wiles` at the table."},
        {"id": "L61", "place": "miniscribe-boardroom", "still_prompt": "The table, empty."},
    ]
    hard = []
    L.place_plate_check("lf", shots, set(), hard)
    assert hard == []


# --- P6 plate VARIANTS: the backdrop-repetition bound (2026-08-12) ------------
# A place above the variant threshold declares 2-3 plate VARIANTS — different vantage/zone of the
# SAME set, one place id, `place_anchor` selecting which one a shot seeds. The lint half is a
# HEADS-UP only: which vantage a beat wants is taste, and the measured defect (liked mean plate
# reuse 1.89 vs disliked 7.44) is a QUANTITY, not an authoring-shape error lint can rule on.
def test_p6_variants_group_a_place_by_the_backdrop_each_shot_actually_seeds():
    """`place_variants` is the variant half of `place_groups`' one plate definition: the plate
    carries every shot that names no anchor, and each `place_anchor` carries its own."""
    grp = [
        {"id": "L28", "place": "miniscribe-floor"},
        {"id": "L29", "place": "miniscribe-floor"},
        {"id": "L44", "place": "miniscribe-floor", "place_anchor": "assets/scenes/L33.png"},
        {"id": "L46", "place": "miniscribe-floor", "place_anchor": "assets/scenes/L33.png"},
    ]
    assert L.place_variants(grp, grp[0]) == {"L28": ["L28", "L29"], "L33": ["L44", "L46"]}


def test_p6_a_delta_rides_its_own_bases_backdrop_never_a_second_one():
    """A delta seeds its CHAIN PARENT, not a plate — it is the same backdrop as its base, so it
    counts against that base's variant and never invents a third one."""
    grp = [
        {"id": "L28", "place": "f"},
        {"id": "L44", "place": "f", "stage": "bench", "stage_role": "base",
         "place_anchor": "assets/scenes/L33.png"},
        {"id": "L45", "place": "f", "stage": "bench", "stage_role": "Delta"},
    ]
    assert L.place_variants(grp, grp[0]) == {"L28": ["L28"], "L33": ["L44", "L45"]}


def test_p6_a_non_generated_shot_seeds_no_backdrop_at_all():
    """Same skip as `place_groups`/forge: a stock/chart/archival shot has no generated frame."""
    grp = [{"id": "L28", "place": "f"},
           {"id": "L29", "place": "f", "source": "stock"}]
    assert L.place_variants(grp, grp[0]) == {"L28": ["L28"]}


def _variant_soft(shots):
    soft = []
    L.place_variant_check("lf", shots, soft)
    return soft


def test_p6_is_wired_as_a_HEADS_UP_and_has_no_hard_sink_at_all():
    """Structural, not incidental: the check takes ONE sink and `main` hands it the soft list, so
    a place above the band can never fail a live file the way L69/L133 do."""
    src = Path(L.__file__).read_text(encoding="utf-8")
    assert "def place_variant_check(label, shots, soft):" in src, "one sink only"
    assert 'place_variant_check("long-form", lf_shots, soft)' in src, "wired into main's soft sink"


def _run_of(place, n, start=1, **extra):
    return [dict({"id": f"L{start + i:02d}", "place": place}, **extra) for i in range(n)]


def test_p6_plant_one_backdrop_carrying_a_whole_long_place_run():
    """The miniscribe-floor shape: 17 shots, one image. Above the band, so it draws the heads-up,
    and the message carries BOTH bounds (2-3 variants; never one bespoke environment per shot)."""
    soft = _variant_soft(_run_of("miniscribe-floor", 17))
    assert len(soft) == 1, soft
    m = soft[0]
    assert "miniscribe-floor" in m and "17" in m and "L01" in m, m
    assert "2-3" in m and "third" in m, m
    assert "bespoke" in m, m


def test_p6_a_place_split_across_variants_is_silent():
    """Sanctioned authoring: 9 shots over three vantages of the one set. No heads-up."""
    shots = (_run_of("rented-warehouse", 3, 1)
             + _run_of("rented-warehouse", 3, 4, place_anchor="assets/scenes/L20.png")
             + _run_of("rented-warehouse", 3, 7, place_anchor="assets/scenes/L21.png"))
    assert _variant_soft(shots) == []


def test_p6_two_variants_the_LOW_end_of_the_sanctioned_range_never_trips_the_band():
    """The band is set at the LOOSER end of the approved 2-3 range deliberately: a two-variant
    split is legal authoring, so it must not be reported as a defect. The message states the
    one-third TARGET; the heads-up fires only above what 2 variants can reach."""
    shots = (_run_of("audit-room", 4, 1)
             + _run_of("audit-room", 4, 5, place_anchor="assets/scenes/L20.png"))
    assert _variant_soft(shots) == []


def test_p6_a_short_place_run_is_exempt_no_variant_plan_is_owed():
    """`>~5 shots` is the threshold: a five-shot place on one plate is not the measured defect,
    and demanding variants for it is the cost half of the two-sided target."""
    assert _variant_soft(_run_of("wiles-office", 5)) == []


def test_p6_place_exempt_shot_classes_are_untouched():
    """P1's pin, restated at this check: a shot declaring NO place is not a place's run and can
    never be pushed onto a plate by the variant rule."""
    shots = [{"id": f"L{i:02d}", "shot_class": "symbolic"} for i in range(1, 12)]
    assert _variant_soft(shots) == []


# --- P5 + P6 doctrine: ONE plate law, both bounds on every target -------------
KIT = Path(__file__).resolve().parents[4] / "channels" / "the-second-take" / "visual-kit"
VPW_SKILL = Path(__file__).resolve().parents[1] / "SKILL.md"


def _flat(path):
    """A doc's prose with its markdown line-wrapping collapsed: where a sentence happens to break
    across lines is formatting, never doctrine, so a fingerprint must not be able to fail on a
    re-wrap alone. Same normalization `blockquote_after` applies on forge's side."""
    return " ".join(Path(path).read_text(encoding="utf-8").split())


def test_p5_p6_the_plate_law_states_occupancy_scale_ink_and_variants_as_one_law():
    """The law's home is `visual-grammar.md`. P5's occupancy half and P6's variant half are ONE
    paragraph, not two bolted ones, and each two-sided target carries BOTH of its bounds."""
    g = _flat(KIT / "visual-grammar.md")
    # P5 — occupancy + scale, both bounds
    assert "zero SEEDED FIGURES" in g and "never zero content" in g, "cast-free's positive half"
    assert "cavernous empty hangar" in g and "cluttered prop-shop" in g, "P5's two bounds"
    assert "at the scale the script implies" in g
    # P5 — signage ink, authored not left to the renderer
    assert "#241a12" in g and "ink" in g
    # P6 — variants, both bounds
    assert "2-3 plate VARIANTS" in g or "2–3 plate VARIANTS" in g
    assert "roughly a third" in g and "bespoke environment per shot" in g, "P6's two bounds"
    assert "place_anchor" in g and "seeded from the first plate" in g


def test_p5_p6_vpw_step_3a_POINTS_AT_the_law_instead_of_restating_it():
    """No bloat: the law lives in visual-grammar; the authoring step references it and adds only
    WHEN the decision is made (with the recurrence plan, once, not improvised per shot)."""
    s = _flat(VPW_SKILL)
    assert "working occupancy" in s and "visual-grammar" in s
    # the restatement test: VPW must NOT carry the law's own bounded phrases
    for span in ("cavernous empty hangar", "cluttered prop-shop", "roughly a third"):
        assert span not in s, f"VPW restates the plate law instead of pointing at it: {span!r}"


# --- place-owner: the forced choice (Daniel's failure #6) ---------------------
def test_c3_plant_a_place_recording_no_ownership_decision_at_all():
    """The case the OLD inferential check suppressed: nobody quoted anything, so nothing
    fired — which IS failure #6 (ownership invisible on the establishing frame). A forced
    choice cannot be satisfied by silence."""
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom", "still_prompt": "The boardroom sits empty, blank walls."},
        {"id": "L61", "place": "miniscribe-boardroom", "still_prompt": "The same table from the door."},
    ]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert len(hard) == 1 and "neither" in hard[0] and "L60" in hard[0], hard


def test_c3_plant_both_owner_declarations_at_once():
    shots = [{"id": "L60", "place": "miniscribe-boardroom", "place_owner": "MINISCRIBE",
              "owner_ambiguity": True,
              "still_prompt": "A wall plaque reads 'MINISCRIBE' by the door."}]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert len(hard) == 1 and "BOTH" in hard[0], hard


def test_c3_place_owner_quoted_on_the_plate_is_silent():
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom", "place_owner": "MINISCRIBE",
         "still_prompt": "A wall plaque reads 'MINISCRIBE' by the door."},
        {"id": "L61", "place": "miniscribe-boardroom",
         "still_prompt": "The plaque reading 'MINISCRIBE' is visible again."},
    ]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert hard == []


def test_c3_plant_place_owner_never_quoted_in_the_plate_prompt():
    """The cue is a DRAWN cue: declaring it without authoring the lettering renders an
    unbranded frame while the file claims ownership is legible."""
    shots = [{"id": "L60", "place": "miniscribe-boardroom", "place_owner": "MINISCRIBE",
              "still_prompt": "The boardroom sits empty, blank walls."}]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert len(hard) == 1 and "never quotes" in hard[0], hard


def test_c3_owner_ambiguity_declared_is_silent():
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom", "still_prompt": "The boardroom sits empty, blank walls.",
         "owner_ambiguity": True},
        {"id": "L61", "place": "miniscribe-boardroom", "still_prompt": "A wall plaque reads 'MINISCRIBE' by the door."},
    ]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert hard == []


def test_c3_place_owner_must_be_a_string():
    shots = [{"id": "L60", "place": "plant-office", "place_owner": True,
              "still_prompt": "A door reading 'ACME' stands shut."}]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert len(hard) == 1 and "non-empty string" in hard[0], hard


def test_c3_an_ownership_declaration_off_the_plate_is_a_hard_failure():
    """One decision, one place to record it. A later shot re-quoting the cue is ordinary
    L-1 carry, never a second declaration."""
    shots = [
        {"id": "L60", "place": "plant-office", "owner_ambiguity": True,
         "still_prompt": "The office, unmarked."},
        {"id": "L61", "place": "plant-office", "place_owner": "ACME",
         "still_prompt": "A door reading 'ACME'."},
    ]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert len(hard) == 1 and "not the plate" in hard[0] and "L61" in hard[0], hard


def test_c3_an_unbranded_place_still_has_to_say_so():
    """An unbranded generic warehouse no longer passes by staying quiet — it declares
    `owner_ambiguity: true`. That is the narrowing of the supplied-text 'omit' escape."""
    shots = [{"id": "L25", "place": "brick-co-yard",
              "still_prompt": "A rented warehouse stands shut and deserted."}]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert len(hard) == 1, hard
    shots[0]["owner_ambiguity"] = True
    hard2 = []
    L.place_owner_check("lf", shots, SUFFIX, hard2)
    assert hard2 == []


def test_c3_a_bare_numeral_literal_is_not_an_ownership_declaration():
    """The old check inferred ownership from any quoted literal; the new one reads the
    author's declaration, so a lettered ledger value is simply not part of this law."""
    shots = [{"id": "L35", "place": "plant-office", "owner_ambiguity": True,
              "still_prompt": "A ledger page nailed to the cash wall is lettered '600 MILLION'."}]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert hard == []


def test_c3_place_owner_is_carried_by_l1_across_the_whole_place():
    """The declared owner literal is an ordinary carried literal: a later in-place shot
    that redraws the sign must RE-QUOTE it, never downgrade it to lowercase prose — the
    CHECKIG mechanism, applied to the owner cue across stage runs."""
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom", "place_owner": "MINISCRIBE", "stage": "a",
         "still_prompt": "A wall plaque reads 'MINISCRIBE' by the door."},
        {"id": "L70", "place": "miniscribe-boardroom", "stage": "b",
         "still_prompt": "The miniscribe plaque hangs above the shut door."},
    ]
    hard = []
    L.carried_literal_check("lf", shots, SUFFIX, hard)
    assert len(hard) == 1 and "L70" in hard[0] and "MINISCRIBE" in hard[0], hard
    # re-quoted verbatim = silent, in a different stage run
    shots[1]["still_prompt"] = "The plaque reading 'MINISCRIBE' hangs above the shut door."
    hard2 = []
    L.carried_literal_check("lf", shots, SUFFIX, hard2)
    assert hard2 == []


# --- C-5 same-place mirror + place_anchor legality ---------------------------
def test_c5_plant_cross_place_anchor():
    shots = [
        {"id": "L60", "place": "warehouse-floor", "still_prompt": "…"},
        {"id": "L61", "place": "miniscribe-boardroom", "place_anchor": "assets/scenes/L60.png", "still_prompt": "…"},
    ]
    hard = []
    L.place_anchor_same_place_check("lf", shots, hard)
    assert len(hard) == 1 and "cross-place" in hard[0], hard


def test_c5_same_place_anchor_is_silent():
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom", "still_prompt": "…"},
        {"id": "L61", "place": "miniscribe-boardroom", "place_anchor": "assets/scenes/L60.png", "still_prompt": "…"},
    ]
    hard = []
    L.place_anchor_same_place_check("lf", shots, hard)
    assert hard == []


def test_c5_unresolvable_or_unplaced_anchor_stays_silent():
    """Neither side declares `place` yet (a pre-reset/archived file) — the same-PLACE
    law, not a mandatory-place law; nothing to compare, so silent."""
    shots = [
        {"id": "L60", "still_prompt": "…"},
        {"id": "L61", "place_anchor": "assets/scenes/L60.png", "still_prompt": "…"},
    ]
    hard = []
    L.place_anchor_same_place_check("lf", shots, hard)
    assert hard == []
    shots2 = [{"id": "L61", "place_anchor": "assets/scenes/L60.png", "place": "x", "still_prompt": "…"}]
    hard2 = []
    L.place_anchor_same_place_check("lf", shots2, hard2)
    assert hard2 == []          # L60 doesn't exist in this file - forge's job, not lint's


# --- bool field shape ---------------------------------------------------------
def test_bool_field_plant_non_bool_hard_cut():
    hard = []
    L.bool_field_check("lf", [("L01", {"hard_cut": "yes"})], "hard_cut", hard)
    assert len(hard) == 1, hard


def test_bool_field_true_and_absent_are_silent():
    hard = []
    L.bool_field_check("lf", [("L01", {"hard_cut": True}), ("L02", {})], "hard_cut", hard)
    assert hard == []


# =============================================================================
# Action-chain (C-8, presence only)
# =============================================================================
# Real archived VO lines (7f38d18 shots.json) — the L88->L91 span. The narration keeps
# working the same BOXES across the L88/L89 cut; L88 held a stage, L89 declared nothing.
ARCHIVED_VO = {
    "L88": "The real sheets were locked in the accountants' own boxes,",
    "L89": "so they popped the boxes open with Allen wrenches and paper clips,",
    "L90": "took the real count out and put the fake one in,",
    "L91": "and blamed the whole gap on a typo.",
}


def _chain(*shots, **kw):
    hard = []
    L.action_chain_check("lf", list(shots), kw.get("vo", ARCHIVED_VO), hard)
    return hard


def test_action_chain_plant_the_real_archived_l88_l89_drift():
    """The archived L89 defect, re-authored under the place doctrine: L88 and L89 sit in
    one place, the VO continues on 'boxes', and L89 declares no chain at all."""
    hard = _chain(
        {"id": "L88", "place": "lockbox-office", "stage": "lockbox-office-written",
         "stage_role": "delta", "still_prompt": "The same written back office, same locked framing."},
        {"id": "L89", "place": "lockbox-office",
         "still_prompt": "`brick-foreman` (`expr-deadpan`, `sit`) sits beside the wax-sealed box, "
         "now pried open a crack, on a stool at the desk edge."})
    assert len(hard) == 1, hard
    assert "L89" in hard[0] and "L88" in hard[0] and "box" in hard[0], hard


def test_action_chain_a_still_prompt_idiom_can_never_fire():
    """R2-B2's measured false-positive class. 'at the same eye-line' is the clause C-8's
    own two-figure law DEMANDS, and 'the same pallet three times' is one plan view — both
    live in `still_prompt`, which this check does not read at all. The VO shares no prop
    noun, so nothing fires however the prose is worded."""
    hard = _chain(
        {"id": "L38", "place": "brick-co-yard", "still_prompt": "A wide yard."},
        {"id": "L39", "place": "brick-co-yard",
         "still_prompt": "`qt-wiles` and `brick-foreman` face each other at the same eye-line "
         "across a counter's width, drawn small but plainly the same pallet three times."},
        vo={"L38": "He walked the lot at dawn.", "L39": "Nobody asked him anything."})
    assert hard == []


def test_action_chain_place_exempt_shot_classes_never_fire():
    """C-3's placeless classes cannot declare `place`, so the adjacency condition can
    never be met — the archived L204 symbolic insert and L24 map plan-view, which the
    idiom heuristic used to hard-fail with no legal fix available."""
    hard = _chain(
        {"id": "L203", "shot_class": "literal", "place": "warehouse-floor",
         "still_prompt": "The warehouse floor."},
        {"id": "L204", "shot_class": "symbolic-stand-in-object",
         "still_prompt": "The same steel-grey suit jacket `qt-wiles` wore through his rise hangs "
         "alone on a hook."},
        vo={"L203": "The bricks sat on the warehouse floor.",
            "L204": "The bricks were all that was left of him."})
    assert hard == []


def test_action_chain_a_shared_stage_is_silent():
    """Real prose (L67 idiom) — the same place, the same prop in the VO, but the shots
    share a `stage`: the chain is declared, so cause->effect readability is the critic's
    call (critics.md question 7), not lint's."""
    hard = _chain(
        {"id": "L66", "place": "miniscribe-boardroom", "stage": "public-firing-exit",
         "stage_role": "base", "still_prompt": "The populated boardroom."},
        {"id": "L67", "place": "miniscribe-boardroom", "stage": "public-firing-exit",
         "stage_role": "delta", "still_prompt": "The same populated boardroom, same locked framing."},
        vo={"L66": "Two cardboard boxes appeared by the door.",
            "L67": "The boxes were his."})
    assert hard == []


def test_action_chain_any_declared_chain_is_silent():
    """Condition 3 is 'declares no chain', not 'declares a DIFFERENT chain'. A shot that
    opens its own stage has made a positive continuity statement — and the author is never
    pushed into declaring `hard_cut: true` (which asserts the action does NOT continue) to
    silence a shot whose action really does continue."""
    hard = _chain(
        {"id": "L88", "place": "lockbox-office", "stage": "written-office", "stage_role": "base",
         "still_prompt": "The back office."},
        {"id": "L89", "place": "lockbox-office", "stage": "box-tamper", "stage_role": "base",
         "still_prompt": "The box, pried open."})
    assert hard == []


def test_action_chain_hard_cut_is_silent():
    hard = _chain(
        {"id": "L88", "place": "lockbox-office", "stage": "written-office",
         "still_prompt": "The back office."},
        {"id": "L89", "place": "lockbox-office", "hard_cut": True,
         "still_prompt": "A different night, the same box shape on a different desk."})
    assert hard == []


def test_action_chain_a_different_place_is_silent():
    """Two shots in different places cannot be continuing one staged action."""
    hard = _chain(
        {"id": "L88", "place": "lockbox-office", "stage": "written-office",
         "still_prompt": "The back office."},
        {"id": "L89", "place": "brick-co-yard", "still_prompt": "The yard."})
    assert hard == []


def test_action_chain_a_fresh_scene_with_no_shared_prop_is_silent():
    """Real prose (L92/L93) — a genuinely NEW beat in one place: adjacent, unchained, and
    silent, because the narration shares no prop noun."""
    hard = _chain(
        {"id": "L92", "place": "warehouse-floor", "still_prompt": "`auditor-rep` signs a page."},
        {"id": "L93", "place": "warehouse-floor",
         "still_prompt": "`brick-foreman` (`expr-deadpan`) stands with an open black equipment "
         "case on a polished casino-service corridor table."},
        vo={"L92": "The audit came back clean.",
            "L93": "Then somebody noticed the numbers."})
    assert hard == []


def test_action_chain_calibration_over_the_archived_file():
    """Calibration duty, measured (not argued) over the archived 214-shot `shots.json`
    (git 7f38d18) with EVERY shot forced into one shared place — the maximal-firing
    hypothesis, since the archived file predates `place` and scores 0 on its own.

    Result: ONE fire in 214 shots, and it is L89, the true positive. Every other adjacent
    unchained pair shares only stopwords ('the', 'and', 'in'), verb morphology ('counted'),
    contractions ("wasn't"), or category nouns ('people', 'level') — the four classes
    `_PROP_EXCLUDE`/`prop_nouns` drop. The pairs below are the real near-misses; they are
    what the exclusion list is calibrated against, and they must stay silent."""
    near_misses = [
        ("L114", "Next level.", "L115", "This was Ocean's Eleven level stuff."),
        ("L124", "Either way, the same bricks counted as a sale in one quarter,",
         "L125", "came home, and got counted as inventory in the next."),
        ("L150", "What finally killed it wasn't the auditors,",
         "L151", "and it wasn't a regulator."),
        ("L154", "and some of the people holding pink slips",
         "L155", "were the same people who had been packing the bricks."),
        ("L200", "The company kept the numbers in the same order,",
         "L201", "in front of everyone, in the open."),
    ]
    for a_id, a_vo, b_id, b_vo in near_misses:
        hard = _chain({"id": a_id, "place": "one-place", "stage": "s"},
                      {"id": b_id, "place": "one-place"},
                      vo={a_id: a_vo, b_id: b_vo})
        assert hard == [], (a_id, b_id, hard)
    # the one true positive in the whole file
    hard = _chain({"id": "L88", "place": "one-place", "stage": "s"}, {"id": "L89", "place": "one-place"})
    assert len(hard) == 1 and "box" in hard[0], hard


# =============================================================================
# Seat/support (C-7)
# =============================================================================
CHARS = {"brick-foreman", "qt-wiles", "ibm-suit", "miniscribe-rep"}


def test_c7_plant_the_real_l89_floating_sit():
    """Real prose (L89): `brick-foreman` (`sit`) with NO support noun anywhere in the
    sentence — the audit's own 'unambiguous floating sit' (§E2)."""
    objs = [("L89", {"id": "L89", "still_prompt":
             "`brick-foreman` (`expr-deadpan`, `sit`) sits beside the same wax-sealed box, now "
             "pried open a crack, with one Allen wrench and one straightened paper clip laid at "
             "the worked lock plate."})]
    hard, soft = [], []
    L.seat_support_check("lf", objs, CHARS, soft, hard)
    assert len(hard) == 1 and "brick-foreman" in hard[0], hard


def test_c7_support_plus_contact_is_a_soft_headsup_not_hard():
    """Real prose (L68): `brick-foreman` (`sit`) 'holds the near-end seat in clear
    three-quarter view' — support noun 'seat' + contact preposition 'in' in the same
    sentence, so this is a PASS (framing itself stays a soft heads-up, per M9)."""
    objs = [("L68", {"id": "L68", "still_prompt":
             "`qt-wiles` (`action-armscrossed`, `expr-smug`) commands the head of the shadowed "
             "MiniScribe boardroom table while `brick-foreman` (`expr-worried`, `sit`) holds the "
             "near-end seat in clear three-quarter view."})]
    hard, soft = [], []
    L.seat_support_check("lf", objs, CHARS, soft, hard)
    assert hard == [], hard
    assert len(soft) == 1 and "brick-foreman" in soft[0], soft


def test_c7_object_sits_is_never_the_trigger():
    """Real prose, exactly the M9 false-positive class this check must never
    reproduce: objects that 'sit' in plain English, no backticked `sit` primitive
    bound to any character.
      L25: 'a single clay brick ... sits on its end'
      L35: 'The metal desk sits pushed aside stage-left'
      L89: 'The rest of the cabinet sits blurred behind him'
      L06: 'the beige computer ... now sits half-buried'"""
    prompts = [
        "A single clay brick in dense red sits on its end under the shutter's lip.",
        "The metal desk sits pushed aside stage-left and the high window throws cool daylight.",
        "`brick-foreman` (`expr-deadpan`) works at the bench. The rest of the cabinet sits blurred behind him.",
        "The beige computer on the felt plinth now sits half-buried in a prised-open pine packing crate.",
    ]
    for i, prompt in enumerate(prompts):
        hard, soft = [], []
        L.seat_support_check("lf", [(f"L{i}", {"id": f"L{i}", "still_prompt": prompt})], CHARS, soft, hard)
        assert hard == [] and soft == [], (prompt, hard, soft)


def test_c7_no_registry_chars_means_no_check():
    """Registry unavailable (no channel/manifest wired) - degrades silent, never a
    false positive against an unresolved vocabulary."""
    objs = [("L01", {"id": "L01", "still_prompt": "`brick-foreman` (`sit`) sits on nothing at all."})]
    hard, soft = [], []
    L.seat_support_check("lf", objs, set(), soft, hard)
    assert hard == [] and soft == []


# =============================================================================
# Two-figure presence (C-8, presence only)
# =============================================================================
def test_c8_plant_the_real_l66_miniaturization_root():
    """Real prose (L66) - the audit's own §D finding: the clauses that exist (a long
    perspective table, a 'rear zone' crowd clause) never state plane/eye-line/scale
    between the two named leads, and that omission IS the miniaturization mechanism."""
    objs = [("L66", {"id": "L66", "still_prompt":
             "`qt-wiles` (`point-at-thing`, `expr-smug`) points across a long MiniScribe meeting "
             "table toward `brick-foreman` (`expr-worried`) at the near end. The office-worker "
             "crowd occupies the rear zone beyond the table's far side, behind a glass divider; "
             "the management section rises together from its rear chairs under Wiles's "
             "accusation."})]
    hard = []
    L.two_cast_presence_check("lf", objs, CHARS, hard)
    assert len(hard) == 1
    assert "plane" in hard[0] and "eye line" in hard[0] and "relative head scale" in hard[0], hard


def test_c8_dominant_resolves_the_scale_clause():
    """Real prose (L68) - 'makes Wiles the dominant vertical' resolves scale via
    posture/framing per the design, even though plane/eye-line are still missing."""
    objs = [("L68", {"id": "L68", "still_prompt":
             "`qt-wiles` (`action-armscrossed`, `expr-smug`) commands the head of the boardroom "
             "table while `brick-foreman` (`expr-worried`, `sit`) holds the near-end seat. "
             "Eye-level medium-wide framing makes Wiles the dominant vertical over the meeting."})]
    hard = []
    L.two_cast_presence_check("lf", objs, CHARS, hard)
    assert len(hard) == 1 and "relative head scale" not in hard[0], hard
    assert "plane" in hard[0] and "eye line" in hard[0], hard


def test_c8_all_three_clauses_present_is_silent():
    """The audit's own prescribed FIX for L66 (§D): same plane, aligned eye line,
    matching head scale."""
    objs = [("L66fix", {"id": "L66fix", "still_prompt":
             "`qt-wiles` and `brick-foreman` stand together on the same near table-side plane, "
             "eye line level between the two men, matching relative head scale, Wiles dominant "
             "only by posture."})]
    hard = []
    L.two_cast_presence_check("lf", objs, CHARS, hard)
    assert hard == []


def test_c8_single_named_cast_is_not_two_cast():
    objs = [("L01", {"id": "L01", "still_prompt": "`brick-foreman` (`expr-deadpan`) stands alone."})]
    hard = []
    L.two_cast_presence_check("lf", objs, CHARS, hard)
    assert hard == []


def test_c8_no_registry_chars_means_no_check():
    objs = [("L66", {"id": "L66", "still_prompt": "`qt-wiles` and `brick-foreman` stand there."})]
    hard = []
    L.two_cast_presence_check("lf", objs, set(), hard)
    assert hard == []


# =============================================================================
# Semantic-cast, narrow (C-8, M11)
# =============================================================================
def test_semantic_cast_plant_the_real_l100_defect():
    """Real prose - L100's VO says 'managers', the shot casts `brick-foreman` +
    `qt-wiles` by name, and neither slug fragment appears in that span or its
    neighbours (audit §E7, the bulk generic->named conversion mechanism)."""
    shots = [
        {"id": "L99"},
        {"id": "L100", "still_prompt": "`brick-foreman` (`expr-worried`) and `qt-wiles` "
         "(`expr-smug`, `action-armscrossed`) lean across a walnut office table with their heads "
         "close over one blank sheet of paper."},
        {"id": "L101"},
    ]
    id2text = {
        "L99": "He once made two managers stand up",
        "L100": "So the managers put their heads together",
        "L101": "and came up with a brilliant plan.",
    }
    hard = []
    L.semantic_cast_check("lf", shots, id2text, CHARS, hard)
    assert len(hard) == 1
    assert "brick-foreman" in hard[0] and "qt-wiles" in hard[0], hard


def test_semantic_cast_justified_nearby_lead_is_silent():
    """The M11 counter-example this check must never fire on: a generic plural role
    ('managers') where the named lead's own name surfaces in the same VO span."""
    shots = [
        {"id": "L50", "still_prompt": "`qt-wiles` (`action-armscrossed`, `expr-smug`) addresses "
         "the room."},
    ]
    id2text = {"L50": "The managers, especially Wiles, decided to act."}
    hard = []
    L.semantic_cast_check("lf", shots, id2text, CHARS, hard)
    assert hard == []


def test_semantic_cast_plural_role_justifies_a_singular_slug():
    """R2-M5, the commonest justified shape and the check's own documented promise: the VO
    names the role in the PLURAL ('bankers', 'auditors') and the cast slug is SINGULAR
    ('hq-banker', 'auditor-rep'). Measured on the archived file, exact-token matching fired
    on 6 such shots (L45, L76, L80, L150, L182, L191) it promised to leave alone."""
    chars = CHARS | {"hq-banker", "auditor-rep"}
    for slug, vo in (("hq-banker", "The bankers signed off on every page."),
                     ("auditor-rep", "The auditors came back twice that quarter.")):
        shots = [{"id": "L45", "still_prompt": f"`{slug}` (`expr-deadpan`) initials the page."}]
        hard = []
        L.semantic_cast_check("lf", shots, {"L45": vo}, chars, hard)
        assert hard == [], (slug, hard)


def test_semantic_cast_an_irregular_plural_role_still_justifies_its_slug():
    """`_singular`'s trailing-s rule cannot fold 'foremen'; `_IRREGULAR_ROLE` folds the
    irregulars the check's own closed role list can produce."""
    shots = [{"id": "L50", "still_prompt": "`brick-foreman` (`expr-deadpan`) squares the stack."}]
    hard = []
    L.semantic_cast_check("lf", shots, {"L50": "The foremen counted the same bricks twice."},
                          CHARS, hard)
    assert hard == []


def test_semantic_cast_singularization_does_not_swallow_the_real_defect():
    """The L100 defect must survive the fix: 'managers' folds to 'manager', which is still
    nowhere near `brick-foreman`/`qt-wiles`."""
    shots = [{"id": "L100", "still_prompt": "`brick-foreman` and `qt-wiles` lean over the table."}]
    hard = []
    L.semantic_cast_check("lf", shots, {"L100": "So the managers put their heads together"},
                          CHARS, hard)
    assert len(hard) == 1, hard


def test_semantic_cast_no_generic_plural_role_is_silent():
    shots = [
        {"id": "L01", "still_prompt": "`brick-foreman` (`expr-deadpan`) stands alone at the "
         "bench."},
    ]
    id2text = {"L01": "He built the fake inventory himself."}
    hard = []
    L.semantic_cast_check("lf", shots, id2text, CHARS, hard)
    assert hard == []


def test_semantic_cast_no_named_cast_is_silent():
    shots = [{"id": "L01", "still_prompt": "A crowd of anonymous managers argues in the hallway."}]
    id2text = {"L01": "The managers argued for an hour."}
    hard = []
    L.semantic_cast_check("lf", shots, id2text, CHARS, hard)
    assert hard == []


def test_semantic_cast_no_id2text_or_no_chars_means_no_check():
    shots = [{"id": "L100", "still_prompt": "`brick-foreman` and `qt-wiles` lean over the table."}]
    hard = []
    L.semantic_cast_check("lf", shots, {}, CHARS, hard)
    assert hard == []
    hard2 = []
    L.semantic_cast_check("lf", shots, {"L100": "the managers"}, set(), hard2)
    assert hard2 == []


# =============================================================================
# video_chars — best-effort registry + Pass-1 manifest merge
# =============================================================================
def test_video_chars_merges_registry_and_local_manifest():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        chan = root / "channels" / "the-second-take"
        vdir = chan / "videos" / "t"
        (chan / "visual-kit" / "registry").mkdir(parents=True)
        (vdir / "assets" / "library").mkdir(parents=True)
        (chan / "visual-kit" / "registry" / "registry.json").write_text(
            json.dumps({"characters": {"base": {}, "miniscribe-rep": {}}}), encoding="utf-8")
        (vdir / "assets" / "library" / "manifest.json").write_text(
            json.dumps({"assets": [{"name": "qt-wiles", "kind": "identity", "file": "x.png"},
                                    {"name": "prop-crate", "kind": "prop", "file": "y.png"}]}),
            encoding="utf-8")
        chars = L.video_chars({"channel": "the-second-take"}, vdir)
    # "base" is DROPPED (P2, 2026-08-12): the rig template is not a character and is never cast,
    # so no figure law may bind it. A prop is still not a character either.
    assert chars == {"miniscribe-rep", "qt-wiles"}


def test_the_rig_template_binds_no_figure_law_because_it_is_never_cast():
    """P2, on the lint side. The performer tier is abolished: `video_chars` drops `base`
    (ea71f99's `chars.discard`), so a prompt naming it registers as NO seeded figure anywhere -
    the plate law, the delta-entrance ban and the interaction rule all see an empty cast. The
    refusal lives forge-side (`seeding_law_violations`), where the naming is decidable and loud;
    lint carries no `base` law of its own, exactly as at ea71f99."""
    chars = CHARS                       # note: `base` is NOT added — video_chars never yields it
    performer = "A 1980s clerk, `base`, `expr-deadpan`, `action-armscrossed`, behind the counter."
    plate = [{"id": "L60", "place": "brick-co-yard", "still_prompt": performer},
             {"id": "L61", "place": "miniscribe-boardroom", "still_prompt": "The table, empty."},
             {"id": "L62", "place": "brick-co-yard", "still_prompt": "The yard again."}]
    hard = []
    L.place_plate_check("lf", plate, chars, hard)
    assert hard == [], hard             # `base` is no figure, so the plate reads as figure-free

    entrance = [{"id": "L10", "place": "brick-co-yard", "stage": "counter",
                 "stage_role": "base", "still_prompt": "The counter at dusk, unattended."},
                {"id": "L11", "place": "brick-co-yard", "stage": "counter",
                 "stage_role": "delta", "still_prompt": performer}]
    hard = []
    L.delta_entrance_check("lf", entrance, chars, hard)
    assert hard == [], hard

    # ...and `semantic_cast_check` needs no `base` exclusion any more: the name cannot reach it.
    hard = []
    L.semantic_cast_check("lf", [{"id": "L45", "still_prompt": performer}],
                          {"L45": "The clerks were all doing the same thing."}, chars, hard)
    assert hard == []
    # NAMED cast is still counted by that check, unchanged — the exclusion's removal is not a hole
    hard = []
    L.semantic_cast_check(
        "lf", [{"id": "L46", "still_prompt": "`qt-wiles` at the counter."}],
        {"L46": "The clerks were all doing the same thing."}, CHARS | {"qt-wiles"}, hard)
    assert len(hard) == 1 and "qt-wiles" in hard[0], hard


def test_the_one_performer_cap_check_is_gone_from_lint():
    """A-3's `seeded_performer_singleton_check` was a law ABOUT the abolished tier: it capped a
    shot at one `base` casting. With zero castings legal there is nothing to cap, so the check is
    deleted rather than flattened — the forge-side refusal is the whole guard, and this leaves
    less total function than a lint refusal mirroring it."""
    assert not hasattr(L, "seeded_performer_singleton_check")


def test_video_chars_missing_files_degrade_to_empty_set():
    with tempfile.TemporaryDirectory() as td:
        vdir = Path(td) / "channels" / "x" / "videos" / "t"
        vdir.mkdir(parents=True)
        chars = L.video_chars({"channel": "x"}, vdir)
    assert chars == set()


def test_video_chars_no_channel_field_skips_registry_but_keeps_manifest():
    with tempfile.TemporaryDirectory() as td:
        vdir = Path(td) / "videos" / "t"
        (vdir / "assets" / "library").mkdir(parents=True)
        (vdir / "assets" / "library" / "manifest.json").write_text(
            json.dumps({"assets": [{"name": "qt-wiles", "kind": "character", "file": "x.png"}]}),
            encoding="utf-8")
        chars = L.video_chars({}, vdir)
    assert chars == {"qt-wiles"}


# =============================================================================
# END-TO-END — main() wires the new checks in without breaking the existing floor
# =============================================================================
SCRIPT_MD = (
    "1,000 words / 175 wpm\n---\n"
    "The founder walked into the room and promised everyone a fortune by spring. "
    "Investors emptied their savings within a week. "
    "The ledgers told a very different story that autumn. "
    "By December the scheme had collapsed and the money was gone for good, "
    "leaving four hundred families holding nothing at all."
)
ANCHORS = ["The founder walked into", "Investors emptied their savings", "The ledgers told a",
           "By December the scheme", "leaving four hundred families"]


def _file(**shot_extra):
    shots = []
    for i, a in enumerate(ANCHORS):
        sh = {"id": f"L{i + 1:02d}", "vo_ref": a, "duration_s": 5,
              "shot_class": "symbolic-stand-in-object", "source": "ai-gen",
              "still_prompt": "a plain cartoon scene, every surface completely blank and unlettered",
              "synthetic": False, "notes": ""}
        if i == 0:
            sh.update(shot_extra)
        shots.append(sh)
    return {"schema": L.SCHEMA_V2, "channel": "the-second-take", "video_slug": "t",
            "generated": "2026-08-04", "status": "shots-drafted",
            "global_prompt_suffix": SUFFIX,
            "long_form": {"aspect_ratio": "16:9", "shots": shots},
            "thumbnail": {"primary": {"gen_prompt": "a plain cartoon poster"}, "challengers": []},
            "shorts": []}


def _main(data, *args):
    td = tempfile.mkdtemp()
    (Path(td) / "script.md").write_text(SCRIPT_MD, encoding="utf-8")
    p = Path(td) / "shots.json"
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return L.main([str(p), *args]), p


def test_e2e_a_clean_file_with_no_new_fields_still_exits_zero():
    """No `place`, no cast, no suffix defect: none of the new HARD guards should ever
    fire on ordinary prose that never touches their vocabulary."""
    rc, _ = _main(_file())
    assert rc == 0


def test_e2e_a_planted_render_technique_term_fails():
    rc, _ = _main(_file(still_prompt="a gradient wash over the whole room, otherwise blank"))
    assert rc == 1


def test_e2e_a_planted_invalid_place_key_fails():
    rc, _ = _main(_file(place="Not Kebab Case"))
    assert rc == 1


def test_e2e_a_placeless_shot_class_with_place_fails():
    rc, _ = _main(_file(place="fresh-lot"))
    assert rc == 1        # shot_class stays symbolic-stand-in-object, which is exempt


def test_e2e_an_empty_suffix_fails_while_a_style_bearing_one_passes():
    """main() wiring for the RETARGETED C-2(a): the suffix is the TAIL style voice, so style
    wording in it exits 0; deleting it removes half the LOOK from every gen and exits 1."""
    data = _file()
    data["global_prompt_suffix"] = "flat colours with gentle soft cel shading"
    rc, _ = _main(data)
    assert rc == 0
    data = _file()
    data["global_prompt_suffix"] = ""
    rc, _ = _main(data)
    assert rc == 1


def test_e2e_a_place_recording_no_ownership_decision_fails():
    """main() wiring for the forced choice — a declared place with neither field set."""
    rc, _ = _main(_file(place="founder-room", shot_class="literal"))
    assert rc == 1


def test_e2e_a_place_with_its_ownership_decision_recorded_exits_zero():
    rc, _ = _main(_file(place="founder-room", shot_class="literal", owner_ambiguity=True))
    assert rc == 0


CHAIN_MD = (
    "1,000 words / 175 wpm\n---\n"
    "The founder kept his ledgers in a locked cabinet. "
    "One night somebody popped the cabinet open. "
    "Investors never heard about it at all."
)
CHAIN_ANCHORS = ["The founder kept", "One night somebody", "Investors never heard"]


def _chain_file(**second_shot):
    shots = []
    for i, a in enumerate(CHAIN_ANCHORS):
        sh = {"id": f"L{i + 1:02d}", "vo_ref": a, "duration_s": 5, "shot_class": "literal",
              "source": "ai-gen", "place": "founder-office", "owner_ambiguity": i == 0,
              "still_prompt": "a plain cartoon scene, every surface completely blank and unlettered",
              "synthetic": False, "notes": ""}
        if i != 0:
            del sh["owner_ambiguity"]        # only the plate records the decision
        if i == 1:
            sh.update(second_shot)
        shots.append(sh)
    return {"schema": L.SCHEMA_V2, "channel": "the-second-take", "video_slug": "t",
            "generated": "2026-08-04", "status": "shots-drafted",
            "global_prompt_suffix": SUFFIX,
            "long_form": {"aspect_ratio": "16:9", "shots": shots},
            "thumbnail": {"primary": {"gen_prompt": "a plain cartoon poster"}, "challengers": []},
            "shorts": []}


def test_e2e_an_unchained_same_place_continuation_fails():
    """main() wiring for the action chain — and proof it works on a file that has never
    been `--write`-n: the VO comes from the tiling lint derives on this run, not from a
    stored `vo_text`. L01/L02 share the prop 'cabinet' in one place, and L02 declares
    nothing."""
    def run(data):
        p = Path(tempfile.mkdtemp())
        (p / "script.md").write_text(CHAIN_MD, encoding="utf-8")
        f = p / "shots.json"
        f.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return L.main([str(f)])

    assert run(_chain_file()) == 1                                  # unchained continuation
    assert run(_chain_file(stage="cabinet", stage_role="base")) == 0   # a chain declared
    assert run(_chain_file(hard_cut=True)) == 0                     # or an explicit hard cut


def test_semantic_cast_one_of_the_role_is_a_singular_story_bearer():
    """The "one of the <role>" construction singles ONE person out of a group, so the beat is
    individual and the tier law requires it be CAST - there is no anonymous-foreground tier to
    demote him to. Real prose: bricks-fresh L159, the only shot in that script that hits it."""
    shots = [{"id": "L159", "still_prompt": "`brick-foreman` (`expr-worried`) tapes a carton shut "
              "under one clip lamp."}]
    hard = []
    L.semantic_cast_check("lf", shots,
                          {"L159": "One of the executives even brought his own family"},
                          CHARS, hard)
    assert hard == [], hard


def test_semantic_cast_bare_plural_role_still_refuses_a_named_lead():
    """The other side of the same fix: exempting "one of the executives" must not exempt a BARE
    plural role, which is still the L100 defect."""
    shots = [{"id": "L160", "still_prompt": "`brick-foreman` (`expr-worried`) tapes a carton shut."}]
    hard = []
    L.semantic_cast_check("lf", shots, {"L160": "The executives packed the boxes themselves"},
                          CHARS, hard)
    assert len(hard) == 1 and "brick-foreman" in hard[0], hard


def test_semantic_cast_one_of_the_exemption_is_positional_not_global():
    """Narrowness: a sentence that singles one person out of ONE group and still names a SECOND
    group generically is judged on the second group."""
    shots = [{"id": "L161", "still_prompt": "`brick-foreman` (`expr-deadpan`) shrugs at camera."}]
    hard = []
    L.semantic_cast_check("lf", shots,
                          {"L161": "One of the executives told the accountants to sign"},
                          CHARS, hard)
    assert len(hard) == 1 and "accountants" in hard[0], hard

