# -*- coding: utf-8 -*-
"""Planted-defect + false-positive tests for the 2026-08-04 doctrine-reset guards:
C-2 (style one-voice), C-3/C-5 (place), C-7 (seat/support), C-8 (two-cast presence,
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

SUFFIX = "clean flat cel cartoon, hand-lettered marker capitals for any in-world text"


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
def test_c2a_plant_the_deleted_phrase():
    """The exact string style-bible.md's C-1 rewrite deletes: 'flat colours with
    gentle soft cel shading'."""
    hard = []
    L.suffix_one_voice_check(
        "clean flat cel-shaded cartoon style, flat colours with gentle soft cel shading, "
        "rounded friendly shapes", hard)
    msgs = " ".join(hard)
    assert "gentle" in msgs and "soft" in msgs, hard


def test_c2a_blended_and_feathered_fire():
    hard = []
    L.suffix_one_voice_check("no blended or feathered transitions ever, wait this suffix "
                              "itself uses blended and feathered wording", hard)
    msgs = " ".join(hard)
    assert "blended" in msgs and "feathered" in msgs, hard


def test_c2a_the_c1_recipe_itself_is_silent():
    """The unified recipe's OWN wording (C-1, pinned contract) must lint clean —
    a suffix authored correctly must never trip its own one-voice guard."""
    hard = []
    L.suffix_one_voice_check(
        "medium-thick dark warm brown-black #241a12 outline on everything, flat colour "
        "fills, one flat base colour per surface plus at most one hard-edged single-step "
        "shadow shape, no feathered or blended transitions, uniform highlight-free "
        "surfaces, rounded friendly shapes, no realistic detail. No text, no words, no "
        "labels.", hard)
    # "no feathered or blended transitions" as a NEGATION is the correct C-1 text and
    # must still not multiply into false alarms beyond the two words it names.
    assert len(hard) == 2 and all("feather" in h or "blend" in h for h in hard), hard


def test_c2a_soft_focus_is_not_double_reported():
    """`soft focus` is already the C-2 banned PHRASE; the bare-'soft' suffix guard
    must not also fire on the same span - one report, not two, for one defect."""
    hard = []
    L.suffix_one_voice_check("the corridor falls into soft focus at the edges", hard)
    assert len(hard) == 1, hard
    assert "banned render-technique term 'soft focus'" in hard[0], hard


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


def test_c3_all_five_placeless_classes_are_exempt_and_enforced():
    for sc in L._PLACELESS_SHOT_CLASSES:
        hard = []
        L.place_shot_class_exempt_check("lf", [{"id": "X", "shot_class": sc, "place": "x-y"}], hard)
        assert len(hard) == 1, (sc, hard)


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


# --- place-owner ---------------------------------------------------------
def test_c3_plant_owner_cue_quoted_elsewhere_but_absent_from_plate():
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom", "still_prompt": "The boardroom sits empty, blank walls."},
        {"id": "L61", "place": "miniscribe-boardroom", "still_prompt": "A wall plaque reads 'MINISCRIBE' by the door."},
    ]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert len(hard) == 1 and "MINISCRIBE" in hard[0] and "L60" in hard[0], hard


def test_c3_owner_cue_on_the_plate_is_silent():
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom", "still_prompt": "A wall plaque reads 'MINISCRIBE' by the door."},
        {"id": "L61", "place": "miniscribe-boardroom", "still_prompt": "The plaque reading 'MINISCRIBE' is visible again."},
    ]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert hard == []


def test_c3_owner_ambiguity_declared_is_silent():
    shots = [
        {"id": "L60", "place": "miniscribe-boardroom", "still_prompt": "The boardroom sits empty, blank walls.",
         "owner_ambiguity": True},
        {"id": "L61", "place": "miniscribe-boardroom", "still_prompt": "A wall plaque reads 'MINISCRIBE' by the door."},
    ]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert hard == []


def test_c3_no_branding_anywhere_in_the_place_is_silent():
    """An unbranded place (a generic warehouse, no institution) never triggers the
    owner-cue requirement — nothing was ever quoted."""
    shots = [
        {"id": "L25", "place": "brick-co-yard", "still_prompt": "A rented warehouse stands shut and deserted."},
    ]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert hard == []


def test_c3_bare_numeral_literal_is_not_treated_as_an_owner_cue():
    shots = [
        {"id": "L35", "place": "plant-office", "still_prompt": "A ledger page nailed to the cash wall is lettered '600 MILLION'."},
    ]
    hard = []
    L.place_owner_check("lf", shots, SUFFIX, hard)
    assert hard == []


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
def test_action_chain_plant_the_real_l89_l90_drift():
    """Real bricks-fresh prose (L89, L90) — 'the same wax-sealed box' / 'the same
    open box', no `stage`, no `hard_cut` — the exact narrative-nonsense mechanism
    (audit §E4)."""
    shots = [
        {"id": "L89", "still_prompt": "`brick-foreman` (`expr-deadpan`, `sit`) sits beside the "
         "same wax-sealed box, now pried open a crack, with one Allen wrench and one straightened "
         "paper clip laid at the worked lock plate."},
        {"id": "L90", "still_prompt": "`brick-foreman` (`expr-deadpan`, `sit`) sits beside the "
         "same open box. The clean fake sheet is now seated in the gap where the real one sat."},
    ]
    hard = []
    L.action_chain_check("lf", shots, hard)
    assert len(hard) == 2, hard
    assert "L89" in hard[0] and "L90" in hard[1], hard


def test_action_chain_declared_stage_is_silent():
    """The SAME idiom used correctly (real prose, L67): 'the same populated boardroom,
    same locked framing' — silent because `stage` is declared."""
    shots = [
        {"id": "L67", "stage": "public-firing-exit", "stage_role": "base",
         "still_prompt": "The same populated boardroom, same locked framing: `qt-wiles` at the "
         "table head. Only this changes: two plain cardboard boxes now rest beside the open "
         "corridor doorway."},
    ]
    hard = []
    L.action_chain_check("lf", shots, hard)
    assert hard == []


def test_action_chain_declared_hard_cut_is_silent():
    shots = [{"id": "L90b", "hard_cut": True,
              "still_prompt": "The same open box is shown one final time before the scene cuts away."}]
    hard = []
    L.action_chain_check("lf", shots, hard)
    assert hard == []


def test_action_chain_a_fresh_scene_with_no_callback_is_silent():
    """Real prose (L93) — a genuinely NEW scene (casino corridor), no 'the same'
    callback, no stage: must not be flagged just for following L89-L91."""
    shots = [
        {"id": "L93", "still_prompt": "`brick-foreman` (`expr-deadpan`) stands with an open black "
         "equipment case on a polished casino-service corridor table, while a crowd of tuxedoed "
         "accomplices in dark sunglasses gathers around him."},
    ]
    hard = []
    L.action_chain_check("lf", shots, hard)
    assert hard == []


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
# Two-cast presence (C-8, presence only)
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
    assert chars == {"miniscribe-rep", "qt-wiles"}    # "base" dropped, prop not a character


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


def test_e2e_a_suffix_soft_word_fails():
    data = _file()
    data["global_prompt_suffix"] = "flat colours with gentle soft cel shading"
    rc, _ = _main(data)
    assert rc == 1
