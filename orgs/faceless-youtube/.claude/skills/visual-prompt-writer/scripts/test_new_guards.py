# -*- coding: utf-8 -*-
"""Planted-defect + false-positive tests for the seven guards added 2026-07-29.

Every guard gets: one plant it MUST catch, and at least one near-miss it must stay
silent on. Run from the scripts/ dir:  py -3 -m pytest <this file> -q
"""
import json
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import lint_shots as L  # noqa: E402

SUFFIX = "clean flat cel cartoon, hand-lettered marker capitals for any in-world text"


def _p(prompt, pid="L01", field="still_prompt"):
    return [(pid, field, prompt + " " + SUFFIX)]


def _run(fn, prompt, *extra):
    out = []
    fn("lf", _p(prompt), SUFFIX, out, *extra)
    return out


# =========================================================================
# GUARD 1 — char cap on a quoted literal (HARD)
# =========================================================================
def test_g1_plant_26_char_literal_under_the_word_cap():
    """_pearlman-test-act1 L04: 'TRANS CONTINENTAL AIRLINES' is 3 words / 26 chars —
    legal under the 4-word cap, over the glyph ceiling."""
    hits = _run(L.word_cap_check, "a hangar sign lettered 'TRANS CONTINENTAL AIRLINES' above the door")
    assert len(hits) == 1 and "26 characters" in hits[0], hits


def test_g1_25_chars_exactly_is_silent():
    lit = "A" * 25
    assert _run(L.word_cap_check, f"a plaque reading '{lit}'") == []


def test_g1_word_cap_still_reported_as_words_not_chars():
    hits = _run(L.word_cap_check,
                "a sign lettered 'Official Shoemaker to the Princess of Poyais' over the shop")
    assert len(hits) == 1 and "7 words" in hits[0], hits


def test_g1_the_bricks_segment_longest_literal_is_silent():
    assert _run(L.word_cap_check, "a marker card reading '125 MILLION' on the stack") == []


# =========================================================================
# GUARD 2 — >3 distinct literals in one prompt (HARD)
# =========================================================================
def test_g2_plant_four_literals():
    """Poyais L47's four city plaques."""
    hits = _run(L.literal_count_check,
                "a wall of four brass plaques: 'POYAIS OFFICE', 'LONDON', 'EDINBURGH', 'PARIS'")
    assert len(hits) == 1 and "4 distinct literals" in hits[0], hits


def test_g2_three_literals_is_silent():
    assert _run(L.literal_count_check,
                "three cards reading 'CHECKING', 'SAVINGS' and 'ONLINE' in a row") == []


def test_g2_repeats_of_the_same_literal_count_once():
    """L-1 REQUIRES a delta to re-quote what it redraws; counting occurrences would
    punish obedience. Four quotes, two strings -> silent."""
    assert _run(L.literal_count_check,
                "a card reading '125 MILLION' beside a card reading '600 MILLION'; the "
                "'125 MILLION' card is nearer, the '600 MILLION' card behind it") == []


def test_g2_thumbnail_prompts_are_covered():
    out = []
    L.literal_count_check("thumbnail", [("thumbnail.primary", "gen_prompt",
                                        "cards 'A LOT', 'B LOT', 'C LOT', 'D LOT' " + SUFFIX)],
                          SUFFIX, out, [])
    assert len(out) == 1


# --- FIX 6 (audit follow-up): literal_count_check gated on schema == SCHEMA_V2, same law as
# shot_class_check — the 3-literal cap postdates plenty of archived v1 files, so failing them over
# a rule that did not exist when they were authored breaks a video for nothing. ---------------------
def _lit(prompt, strict=True):
    hard, soft = [], []
    L.literal_count_check("lf", _p(prompt), SUFFIX, hard, soft, strict)
    return hard, soft


def test_g2_v1_file_gets_a_heads_up_not_a_hard_failure():
    hard, soft = _lit(
        "a wall of four brass plaques: 'POYAIS OFFICE', 'LONDON', 'EDINBURGH', 'PARIS'", strict=False)
    assert hard == [] and len(soft) == 1 and "v1 file" in soft[0], (hard, soft)


def test_g2_v2_file_still_hard_fails():
    hard, soft = _lit(
        "a wall of four brass plaques: 'POYAIS OFFICE', 'LONDON', 'EDINBURGH', 'PARIS'", strict=True)
    assert len(hard) == 1 and soft == [], (hard, soft)


# =========================================================================
# GUARD 3 — a lettered word >=9 chars the script never uses (SOFT)
# =========================================================================
def test_g3_plant_author_chosen_long_word():
    """Wells Fargo L69's 'TERMINATED' on a video that elsewhere authored 'FIRED'."""
    hits = _run(L.long_literal_word_check, "a red stamp reading 'TERMINATED' across the notice",
                {"fired", "notice"})
    assert len(hits) == 1 and "TERMINATED" in hits[0], hits


def test_g3_a_word_the_script_uses_is_exempt():
    """MINISCRIBE is the bricks segment's subject and appears 6 times; there is no
    shorter synonym for a proper noun."""
    assert _run(L.long_literal_word_check,
                "a parapet sign reading 'MINISCRIBE' above the dock",
                {"miniscribe", "dock"}) == []


def test_g3_eight_char_word_is_silent_by_design():
    """CHECKIG is the headline garble and 'CHECKING' is 8 chars — owned by L-1, not
    by this guard."""
    assert _run(L.long_literal_word_check, "a card labelled 'CHECKING'", {"card"}) == []


def test_g3_no_script_vocabulary_means_no_check():
    """The guard IS the script comparison; with no script.md there is no
    discriminator, and firing would be loudest on the file we know least about."""
    assert _run(L.long_literal_word_check, "a stamp reading 'TERMINATED'", set()) == []


def test_g3_reports_each_long_word_once_per_prompt():
    hits = _run(L.long_literal_word_check,
                "a stamp 'OBSTRUCTION' beside a second stamp 'OBSTRUCTION'", {"stamp"})
    assert len(hits) == 1


# =========================================================================
# GUARD 4 — negation-list phrasing (SOFT)
# =========================================================================
def test_g4_plant_two_negations_in_one_sentence():
    """_bricks-seg L07, verbatim."""
    hits = _run(L.negation_list_check, "A wide from inside the store. "
                "The glass carries no signs and no words.")
    assert len(hits) == 1 and "no signs, no words" in hits[0], hits


def test_g4_three_negations_also_fire():
    hits = _run(L.negation_list_check,
                "No prices, no words and no labels anywhere on the boxes or the shelving.")
    assert len(hits) == 1 and "3 negations" in hits[0], hits


def test_g4_a_single_absence_is_silent():
    """_bricks-seg L42/L43 — one negation reads cleanly and lands."""
    assert _run(L.negation_list_check, "The building carries no signage on this side.") == []
    assert _run(L.negation_list_check, "Flat overcast light, no shadows.") == []


def test_g4_rig_anatomy_negations_are_exempt():
    """shots-schema L-2 blesses exactly this form as LEGAL."""
    assert _run(L.negation_list_check, "Figures on the crowd rig: round heads, dot eyes, "
                "NO noses, NO ears, NO teeth.") == []


def test_g4_anatomy_mixed_with_a_surface_noun_still_reports():
    hits = _run(L.negation_list_check,
                "A round head with NO nose and NO lettering on the placard.")
    assert len(hits) == 1, hits


def test_g4_no_longer_is_not_an_absence():
    """'no longer' + one real negation must not read as a list of two."""
    assert _run(L.negation_list_check, "The sign is no longer lit and carries no words.") == []


def test_g4_no_one_is_not_a_counted_negation():
    """FIX 12 (audit follow-up): 'no one' is the idiom for 'nobody', not an authored absence of a
    noun called 'one' — before the fix, 'no one' + one real negation miscounted as TWO negations
    and fired; it must stay silent the same way a lone real negation does."""
    assert _run(L.negation_list_check,
                "No one stands at the counter, and no words appear on the sign.") == []


def test_g4_the_positive_form_is_silent():
    """The form the guard tells you to use — _bricks-seg L01/L16."""
    assert _run(L.negation_list_check,
                "Every surface in the room is completely blank and unlettered. "
                "The stage front and the oversized phone are both left COMPLETELY BLANK.") == []


# =========================================================================
# GUARD 5 — shot_class closed enum (HARD)
# =========================================================================
def _sc(shots, strict=True):
    hard, soft = [], []
    L.shot_class_check("lf", shots, hard, soft, strict)
    return hard, soft


def test_g5_plant_bogus_shot_class():
    hard, soft = _sc([{"id": "L01", "shot_class": "vibes-montage"}])
    assert len(hard) == 1 and "not in shots-schema.md" in hard[0]


def test_g5_near_miss_gets_the_suggestion():
    """The real instance: this lint's own v2 fixture carried 'symbolic-stand-in'."""
    hard, soft = _sc([{"id": "L01", "shot_class": "symbolic-stand-in"}])
    assert len(hard) == 1 and "symbolic-stand-in-object" in hard[0], hard


def test_g5_every_enum_value_passes():
    hard, soft = _sc([{"id": f"L{i}", "shot_class": c}
                      for i, c in enumerate(sorted(L.SHOT_CLASSES))])
    assert (hard, soft) == ([], [])


def test_g5_absent_shot_class_is_not_flagged():
    """A v1 file may predate the field entirely."""
    assert _sc([{"id": "L01"}, {"id": "L02", "shot_class": ""}]) == ([], [])


def test_g5_a_v1_file_gets_a_heads_up_not_a_failure():
    """The published Wells Fargo file (v1) classes three shots 'comparison'; the
    field is not engine-read, so failing an archived video over it breaks it for
    nothing (same law as schema_check / legacy_field_check)."""
    hard, soft = _sc([{"id": "L01", "shot_class": "comparison"}], strict=False)
    assert hard == [] and len(soft) == 1 and "v1 file" in soft[0], (hard, soft)


def test_g5_the_committed_enum_matches_the_schema_doc():
    """Guard against hand-sync drift: every value in SHOT_CLASSES appears in
    shots-schema.md's shot_class line, and vice versa."""
    doc = (SCRIPTS.parent / "references" / "shots-schema.md").read_text(encoding="utf-8")
    line = [l for l in doc.splitlines() if '"shot_class"' in l][0]
    # split on commas rather than a hyphenated-word regex: a hyphen-only pattern silently can
    # never match the single-word entry 'literal', which is exactly the gap the old (vacuous)
    # `... or True` assertion papered over instead of fixing.
    tail = line.split("table):")[1].split('"')[0]
    listed = {w.strip() for w in tail.split(",") if w.strip()}
    assert listed == set(L.SHOT_CLASSES), (listed - set(L.SHOT_CLASSES), set(L.SHOT_CLASSES) - listed)


# =========================================================================
# GUARD 6 — rig-clause fingerprint (HARD)
# =========================================================================
def test_g6_plant_base_rig_clause():
    hits = _run(L.rig_clause_check, "One anonymous worker at the dock. This prominent foreground "
                "figure is an anonymous, non-recurring person drawn on the FULL base family rig - "
                "SAME round near-circle head, NO nose, NO ears.")
    assert hits and any("FULL base family rig" in h for h in hits), hits


def test_g6_plant_crowd_rig_clause():
    hits = _run(L.rig_clause_check, "A dense crowd presses against the window. The background / "
                "crowd figures are on the CROWD RIG: round cream-family heads, DOT EYES.")
    assert len(hits) == 1 and "CROWD RIG:" in hits[0], hits


def test_g6_plant_the_leadin_sentence():
    """The lead-in exists only to hand off to a pasted clause."""
    hits = _run(L.rig_clause_check, "its keeper stands behind the counter. "
                "The stall keeper is drawn as follows.")
    assert len(hits) == 1 and "drawn as follows" in hits[0], hits


def test_g6_rig_vocabulary_as_prose_about_a_body_is_silent():
    """'base-rig figures' / 'on the crowd rig' never leaked and stay legal."""
    assert _run(L.rig_clause_check,
                "A base-rig anonymous teller in a teal uniform behind the counter, and the "
                "background figures sit on the crowd rig at the same squat proportion.") == []


def test_g6_the_house_suffix_alone_is_silent():
    assert _run(L.rig_clause_check, "a plain den with a console television") == []


def test_g6_bare_drawn_as_follows_on_a_non_figure_subject_is_soft_not_hard():
    """FIX 12 (audit follow-up): 'drawn as follows' is VPW's own habitual lead-in phrase, not
    style-bible text, so the fingerprint must anchor to a FIGURE subject the way the real
    lead-in ('The stall keeper is drawn as follows.') always has — ordinary prose describing a
    non-person diagram must not HARD-fail.

    HIGH-6 (audit follow-up): it is no longer perfectly silent either — every bare occurrence of
    the phrase now produces a soft heads-up (never zero signal), it just never escalates to HARD
    for an un-anchored subject."""
    hard, soft = [], []
    L.rig_clause_check("lf", _p("A wall chart of quarterly earnings is drawn as follows: "
                                 "three bars rising left to right, tallest at the far right."),
                        SUFFIX, hard, soft)
    assert hard == [] and len(soft) == 1 and "drawn as follows" in soft[0], (hard, soft)


# --- HIGH-6 (audit follow-up): _RIG_LEADIN_FIGURE_WORD is a closed noun list against an open
# English word class. A real §2d/§2e lead-in phrased around an off-list noun (vendor, customer,
# cashier, guard, ...) used to escape _RIG_CLAUSE and rig_clause_check returned ZERO hits — the
# exact "silence is disallowed" failure the operating law forbids. These off-list nouns must now
# always produce at least a SOFT hit. ------------------------------------------------------------
def test_g6_offlist_noun_vendor_still_produces_a_soft_signal():
    hard, soft = [], []
    L.rig_clause_check("lf", _p("The vendor is drawn as follows: a stooped figure with a canvas "
                                 "apron, restocking a fruit cart."), SUFFIX, hard, soft)
    assert hard == [] and len(soft) == 1 and "drawn as follows" in soft[0], (hard, soft)


def test_g6_offlist_noun_customer_still_produces_a_soft_signal():
    hard, soft = [], []
    L.rig_clause_check("lf", _p("The customer is drawn as follows: a hunched shape at the "
                                 "counter, coat still buttoned."), SUFFIX, hard, soft)
    assert hard == [] and len(soft) == 1, (hard, soft)


def test_g6_offlist_noun_cashier_still_produces_a_soft_signal():
    hard, soft = [], []
    L.rig_clause_check("lf", _p("The cashier is drawn as follows: a narrow silhouette behind the "
                                 "till, sleeves rolled."), SUFFIX, hard, soft)
    assert hard == [] and len(soft) == 1, (hard, soft)


def test_g6_offlist_noun_guard_still_produces_a_soft_signal():
    hard, soft = [], []
    L.rig_clause_check("lf", _p("The guard is drawn as follows: a squared-off shape by the door, "
                                 "cap pulled low."), SUFFIX, hard, soft)
    assert hard == [] and len(soft) == 1, (hard, soft)


def test_g6_offlist_noun_merchant_still_produces_a_soft_signal():
    hard, soft = [], []
    L.rig_clause_check("lf", _p("The merchant is drawn as follows: a rounded shape behind the "
                                 "stall, apron dusted with flour."), SUFFIX, hard, soft)
    assert hard == [] and len(soft) == 1, (hard, soft)


def test_g6_anchored_and_unanchored_in_the_same_prompt_report_both():
    """An anchored figure-noun clause (HARD) and a separate off-list-noun clause (SOFT) in the
    same prompt must not suppress each other."""
    hard, soft = [], []
    L.rig_clause_check(
        "lf", _p("The stall keeper is drawn as follows: round head, no nose, no ears. Behind him "
                 "the vendor is drawn as follows: a stooped figure with a canvas apron."),
        SUFFIX, hard, soft)
    assert len(hard) == 1 and len(soft) == 1, (hard, soft)


# --- LOW-7 (audit follow-up): the bare "drawn as follows" catch-all reached ZERO signal — not
# even a soft heads-up — on ordinary wording variants: a double space, a wrapped line, an intervening
# word ("drawn EXACTLY as follows"), or the "rendered" spelling. Each must now produce at least a
# soft hit, and none of them may be promoted to HARD even when paired with an on-list figure noun,
# because the anchored HARD regex still demands the exact literal single-space phrase. ------------
def test_g7low_double_space_still_produces_a_soft_signal():
    hard, soft = [], []
    L.rig_clause_check(
        "lf", _p("The stall keeper is drawn  as follows: round head, no nose, no ears."),
        SUFFIX, hard, soft)
    assert hard == [] and len(soft) == 1 and "drawn" in soft[0].lower(), (hard, soft)


def test_g7low_newline_inside_the_phrase_still_produces_a_soft_signal():
    hard, soft = [], []
    L.rig_clause_check(
        "lf", _p("The stall keeper is drawn as\nfollows: round head, no nose, no ears."),
        SUFFIX, hard, soft)
    assert hard == [] and len(soft) == 1, (hard, soft)


def test_g7low_drawn_exactly_as_follows_still_produces_a_soft_signal():
    hard, soft = [], []
    L.rig_clause_check(
        "lf", _p("The stall keeper is drawn exactly as follows: round head, no nose, no ears."),
        SUFFIX, hard, soft)
    assert hard == [] and len(soft) == 1, (hard, soft)


def test_g7low_rendered_as_follows_still_produces_a_soft_signal():
    hard, soft = [], []
    L.rig_clause_check(
        "lf", _p("The stall keeper is rendered as follows: round head, no nose, no ears."),
        SUFFIX, hard, soft)
    assert hard == [] and len(soft) == 1, (hard, soft)


def test_g7low_ordinary_prose_with_no_as_follows_stays_silent():
    """False-positive guard: the widened regex must not fire on prose that merely contains
    "drawn" and "follows" without the "as follows" idiom between them."""
    assert _run(L.rig_clause_check,
                "The plan the keeper drew inspired the design that follows in this chapter.") == []


def test_g7low_wording_variant_never_promotes_to_hard():
    """Even paired with an on-list figure noun, a wording variant must stay soft-only — the
    anchored HARD regex demands the exact literal single-space phrase and is untouched by the
    LOW-7 widening."""
    hard, soft = [], []
    L.rig_clause_check(
        "lf", _p("The stall keeper is drawn  as follows: round head, no nose, no ears."),
        SUFFIX, hard, soft)
    assert hard == [], hard


# --- FIX 6 (audit follow-up): rig_clause_check gated on schema == SCHEMA_V2, same law as
# shot_class_check — a v1 file predates the `figures`-field migration entirely, so hard-failing an
# archived video over vocabulary the migration retired breaks it for nothing. -----------------------
def _rig(prompt, strict=True):
    hard, soft = [], []
    L.rig_clause_check("lf", _p(prompt), SUFFIX, hard, soft, strict)
    return hard, soft


def test_g6_v1_file_gets_a_heads_up_not_a_hard_failure():
    hard, soft = _rig(
        "One anonymous worker at the dock. This prominent foreground figure is an anonymous, "
        "non-recurring person drawn on the FULL base family rig - SAME round near-circle head, "
        "NO nose, NO ears.", strict=False)
    assert hard == [] and len(soft) == 1 and "v1 file" in soft[0], (hard, soft)


def test_g6_v2_file_still_hard_fails():
    hard, soft = _rig(
        "One anonymous worker at the dock. This prominent foreground figure is an anonymous, "
        "non-recurring person drawn on the FULL base family rig - SAME round near-circle head, "
        "NO nose, NO ears.", strict=True)
    assert len(hard) == 1 and soft == [], (hard, soft)


# =========================================================================
# GUARD 7 — `figures` shape + declaration/prompt agreement
# =========================================================================
def _fig(fig, prompt="one anonymous person stands on the carpet", **extra):
    sh = {"id": "L01", "figures": fig, "still_prompt": prompt}
    sh.update(extra)
    hard, soft = [], []
    L.figures_check("lf", [("L01", sh)], hard, soft)
    return hard, soft


def test_g7_plant_wrong_container_type():
    hard, soft = _fig(["one anonymous person"])
    assert len(hard) == 1 and "expected an object" in hard[0]


def test_g7_plant_unknown_key():
    hard, soft = _fig({"anon_background": ["x"]})
    assert len(hard) == 1 and "anon_background" in hard[0]


def test_g7_plant_crowd_wrong_type():
    hard, soft = _fig({"crowd": "yes"})
    assert len(hard) == 1 and "expected true" in hard[0]


def test_g7_plant_anon_foreground_not_a_list():
    hard, soft = _fig({"anon_foreground": "one anonymous person"})
    assert len(hard) == 1 and "expected a list" in hard[0]


def test_g7_plant_non_string_entry():
    hard, soft = _fig({"anon_foreground": ["one anonymous person", 7, "  "]})
    assert len(hard) == 1 and "non-string/empty" in hard[0], hard


def test_g7_plant_declared_phrase_absent_from_the_prompt():
    hard, soft = _fig({"anon_foreground": ["the stall keeper"]},
                      prompt="its keeper stands behind the counter in a waistcoat")
    assert hard == [] and len(soft) == 1 and "never contains that phrase" in soft[0], (hard, soft)


def test_g7_a_valid_declaration_is_silent():
    hard, soft = _fig({"anon_foreground": ["one anonymous person"], "crowd": True})
    assert (hard, soft) == ([], [])


def test_g7_case_insensitive_match():
    hard, soft = _fig({"anon_foreground": ["two anonymous business figures"]},
                      prompt="Two anonymous business figures face each other centre stage")
    assert (hard, soft) == ([], [])


def test_g7_a_delta_is_not_required_to_restage_the_phrase():
    hard, soft = _fig({"anon_foreground": ["One anonymous worker in a short-sleeved shirt"]},
                      prompt="The same den, same locked camera. A box now sits in the foreground.",
                      stage_role="delta")
    assert (hard, soft) == ([], [])


def test_g7_crowd_false_and_empty_list_are_soft_not_hard():
    hard, soft = _fig({"crowd": False, "anon_foreground": []})
    assert hard == [] and len(soft) == 2, (hard, soft)


def test_g7_no_figures_key_is_silent():
    hard, soft = [], []
    L.figures_check("lf", [("L01", {"id": "L01", "still_prompt": "a plain den"})], hard, soft)
    assert (hard, soft) == ([], [])


# =========================================================================
# GUARD 8 — `place_anchor` structural contract; forge owns filesystem checks
# =========================================================================
def _place(anchor=None, **extra):
    sh = {"id": "L01", "stage_role": "base"}
    if anchor is not None or "place_anchor" in extra:
        sh["place_anchor"] = anchor
    sh.update(extra)
    hard = []
    L.place_anchor_check("lf", [("L01", sh)], hard)
    return hard


def test_g8_valid_video_local_anchor_is_silent_without_a_filesystem_probe():
    assert _place("assets/scenes/missing-but-well-formed.png") == []


def test_g8_absent_anchor_is_silent():
    assert _place() == []


def test_g8_rejects_non_string_empty_and_non_normalized_paths():
    for anchor in (None, "", "assets\\scenes\\L60.png", "./assets/scenes/L60.png",
                   "assets/scenes/../L60.png", "C:/assets/scenes/L60.png",
                   "/assets/scenes/L60.png", "channels/other/videos/v/assets/scenes/L60.png",
                   "assets/scenes/sub/L60.png"):
        hard = _place(anchor, place_anchor=anchor)
        assert len(hard) == 1 and "normalized video-relative" in hard[0], (anchor, hard)


def test_g8_anchor_is_base_only():
    hard = _place("assets/scenes/L60.png", stage_role="delta")
    assert len(hard) == 1 and "only valid on a stage `base`" in hard[0], hard


# =========================================================================
# END-TO-END — exit codes and --write must be untouched
# =========================================================================
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


def _file(schema=L.SCHEMA_V2, **shot_extra):
    """HIGH-5 (audit follow-up): `schema` used to be hardcoded to SCHEMA_V2 here, which is exactly
    why the missing-key/typo/wrong-version paths through `strict_schema` had ZERO test coverage —
    every main()-level fixture in this file only ever exercised the one path. Now a caller can
    override it (including omitting it: pass `schema=None` and it's left OUT of the dict below, the
    same as a real file that never got the key written)."""
    shots = []
    for i, a in enumerate(ANCHORS):
        sh = {"id": f"L{i + 1:02d}", "vo_ref": a, "duration_s": 5,
              "shot_class": "symbolic-stand-in-object", "source": "ai-gen",
              "still_prompt": "a plain cartoon scene, every surface completely blank and unlettered",
              "synthetic": False, "notes": ""}
        if i == 0:
            sh.update(shot_extra)
        shots.append(sh)
    data = {"channel": "the-second-take", "video_slug": "t",
            "generated": "2026-07-29", "status": "shots-drafted",
            "global_prompt_suffix": SUFFIX,
            "long_form": {"aspect_ratio": "16:9", "shots": shots},
            "thumbnail": {"primary": {"gen_prompt": "a plain cartoon poster"}, "challengers": []},
            "shorts": []}
    if schema is not None:
        data["schema"] = schema
    return data


def _main(data, *args, script_md=SCRIPT_MD):
    td = tempfile.mkdtemp()
    (Path(td) / "script.md").write_text(script_md, encoding="utf-8")
    p = Path(td) / "shots.json"
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return L.main([str(p), *args]), p


def test_e2e_clean_file_still_exits_zero_and_writes_vo_text():
    rc, p = _main(_file(), "--write")
    assert rc == 0
    assert "vo_text" in json.loads(p.read_text(encoding="utf-8"))["long_form"]["shots"][0]


def test_e2e_a_new_hard_guard_fails_and_skips_write():
    rc, p = _main(_file(shot_class="vibes-montage"), "--write")
    assert rc == 1
    assert "vo_text" not in json.loads(p.read_text(encoding="utf-8"))["long_form"]["shots"][0]


def test_e2e_a_new_soft_guard_does_not_change_the_exit_code():
    rc, _ = _main(_file(figures={"anon_foreground": ["a figure never staged"]}))
    assert rc == 0


def test_e2e_a_bad_place_anchor_is_hard_and_skips_write():
    rc, p = _main(_file(place_anchor="../other-video/assets/scenes/L60.png"), "--write")
    assert rc == 1
    assert "vo_text" not in json.loads(p.read_text(encoding="utf-8"))["long_form"]["shots"][0]


def test_e2e_report_encodes_on_a_cp1252_console(capsys):
    _main(_file(shot_class="vibes-montage",
                figures={"anon_foreground": ["a figure never staged"], "crowd": False},
                still_prompt="a keeper. The stall keeper is drawn as follows. The glass carries "
                             "no signs and no words. A sign 'TRANS CONTINENTAL AIRLINES' and "
                             "cards 'A LOT', 'B LOT', 'C LOT', 'D LOT' with 'TERMINATED'"))
    capsys.readouterr().out.encode("cp1252")   # must not raise


# =========================================================================
# HIGH-5 (audit follow-up) — a missing/typo'd `schema` key must fail CLOSED into strict, not
# silently take the v1 lenient path. Only an EXPLICIT v1 declaration is legacy.
# =========================================================================
def test_e2e_missing_schema_key_lints_strict():
    """No `schema` key at all — previously indistinguishable from an archived v1 file, so the
    bogus shot_class below (a genuine HARD defect on a v2-shaped file) used to be silently
    downgraded to a heads-up and the run exited 0. It must now exit 1."""
    rc, _ = _main(_file(schema=None, shot_class="vibes-montage"))
    assert rc == 1


def test_e2e_undeclared_schema_long_form_requires_a_stage_chain(capsys):
    """The missing-schema strict path also reaches require_stage through main(), not just its unit."""
    data = _file(schema=None)
    template = data["long_form"]["shots"][0]
    anchors = [f"anchor{i}" for i in range(1, 41)]
    data["long_form"]["shots"] = [dict(template, id=f"L{i:02d}", vo_ref=anchor,
                                        duration_s=1)
                                for i, anchor in enumerate(anchors, 1)]
    script = "1,000 words / 175 wpm\n---\n" + " ".join(anchors)
    rc, _ = _main(data, script_md=script)
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "undeclared-schema long-form plan treated strictly" in out, out
    assert "zero stage-bearing shots/base roles" in out, out


def test_e2e_typo_schema_version_lints_strict():
    """A misspelled/wrong version string is not a v1 declaration either."""
    rc, _ = _main(_file(schema="faceless-youtube/shots@3", shot_class="vibes-montage"))
    assert rc == 1


def test_e2e_explicit_v1_lints_lenient():
    """An EXPLICIT v1 declaration is the only thing that earns the lenient path: the same bogus
    shot_class is downgraded to a soft heads-up and the run exits 0 — a real archived file must
    not break over a rule that postdates it."""
    rc, _ = _main(_file(schema=L.SCHEMA_V1, shot_class="vibes-montage"))
    assert rc == 0


def test_e2e_explicit_v2_lints_strict():
    rc, _ = _main(_file(schema=L.SCHEMA_V2, shot_class="vibes-montage"))
    assert rc == 1


def test_g5_missing_schema_key_shot_class_check_is_strict_directly():
    """Unit-level companion to the e2e tests above, exercising shot_class_check directly the same
    way test_g5_a_v1_file_gets_a_heads_up_not_a_failure does for the explicit-v1 case."""
    hard, soft = [], []
    strict_schema = {}.get("schema") != L.SCHEMA_V1
    assert strict_schema is True
    L.shot_class_check("lf", [{"id": "L01", "shot_class": "vibes-montage"}], hard, soft,
                        strict_schema)
    assert len(hard) == 1 and soft == [], (hard, soft)


# =========================================================================
# MEDIUM-3 (audit follow-up) — `--require-schema <value>`: `schema_check`'s fail-closed HARD/soft
# strictness (HIGH-5) does not stop an author self-declaring an explicit v1 on a brand-new file,
# which is a real, available cheat given every shots.json committed today happens to BE v1 (a
# v1 declaration downgrades literal_count_check/rig_clause_check/shot_class_check from HARD to a
# heads-up). Only the CALLER promoting a plan (the shots-merge DAG node) knows it is being
# promoted right now, so the refusal is an opt-in CLI flag, never a change to the lint's own
# default strictness.
# =========================================================================
def test_require_schema_refuses_a_v1_file_with_its_own_named_reason(capsys):
    """A file that otherwise lints perfectly clean (default shot_class, no other defects) is still
    REFUSED — not merely heads-up'd — when it declares v1 and the caller demands v2, and the
    printed reason names the file's ACTUAL schema value."""
    rc, _ = _main(_file(schema=L.SCHEMA_V1), "--require-schema", L.SCHEMA_V2)
    out = capsys.readouterr().out
    assert rc == 3, (rc, out)
    assert "SCHEMA REFUSED" in out, out
    assert repr(L.SCHEMA_V1) in out, out
    assert repr(L.SCHEMA_V2) in out, out


def test_require_schema_is_unaffected_by_a_matching_v2_file():
    """A file whose schema already equals the required value proceeds exactly as if the flag were
    absent — clean in, clean out, exit 0."""
    rc, _ = _main(_file(schema=L.SCHEMA_V2), "--require-schema", L.SCHEMA_V2)
    assert rc == 0, rc


def test_require_schema_refuses_a_missing_schema_key_too():
    """Fail-closed applies here exactly as it does to schema_check's own HARD/soft gate: a missing
    `schema` key is not a v1 declaration and is refused just as a wrong one is."""
    rc, _ = _main(_file(schema=None), "--require-schema", L.SCHEMA_V2)
    assert rc == 3, rc


def test_require_schema_refusal_is_distinguishable_from_a_hard_violation_report(capsys):
    """The merge node has to tell "wrong schema, plan otherwise fine" apart from "plan is broken" —
    the refusal must never be confusable with the ordinary HARD-violations report, in EITHER its
    exit code or its printed text."""
    rc, _ = _main(_file(schema=L.SCHEMA_V1), "--require-schema", L.SCHEMA_V2)
    out = capsys.readouterr().out
    assert rc not in (0, 1), rc                 # never the HARD-violations exit code
    assert "HARD violations" not in out, out    # never worded like one either
    # A genuine HARD violation, by contrast, keeps its own exit code and wording untouched by the
    # new flag when schema DOES match — the two failure shapes never collide.
    rc2, p2 = _main(_file(schema=L.SCHEMA_V2, shot_class="vibes-montage"), "--require-schema", L.SCHEMA_V2)
    out2 = capsys.readouterr().out
    assert rc2 == 1, rc2
    assert "HARD violations" in out2, out2
    assert "SCHEMA REFUSED" not in out2, out2


def test_require_schema_absent_leaves_an_archived_v1_file_untouched():
    """The flag is opt-in: an archived v1 file linted with NO --require-schema behaves exactly as
    it does today (the same file this suite already proves stays lenient in
    test_e2e_explicit_v1_lints_lenient), including that --write still succeeds."""
    rc, p = _main(_file(schema=L.SCHEMA_V1, shot_class="vibes-montage"), "--write")
    assert rc == 0
    assert "vo_text" in json.loads(p.read_text(encoding="utf-8"))["long_form"]["shots"][0]


def test_require_schema_missing_value_is_a_usage_error():
    """`--require-schema` with no following value is a usage error (exit 2), caught before the
    file is even opened."""
    rc = L.main(["/does/not/exist/shots.json", "--require-schema"])
    assert rc == 2
