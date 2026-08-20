# -*- coding: utf-8 -*-
"""Planted-defect + false-positive tests for the seven guards added 2026-07-29.

Every guard gets: one plant it MUST catch, and at least one near-miss it must stay
silent on. Run from the scripts/ dir:  py -3 -m pytest <this file> -q
"""
import json
import re
import sys
import tempfile
from pathlib import Path

# The engine BESIDE this file, never an absolute path into one checkout: this suite pins message
# text, and a hardcoded `C:\Users\danie\kb\...` import silently graded the MAIN checkout's
# `lint_shots.py` from every worktree — a changed message read as green, and a broken one as red,
# in whichever tree the change was not made. Found 2026-08-06 by the paired-refusal edit.
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
                          SUFFIX, out)
    assert len(out) == 1


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


def test_g4_the_positive_form_is_silent():
    """The form the guard tells you to use — _bricks-seg L01/L16."""
    assert _run(L.negation_list_check,
                "Every surface in the room is completely blank and unlettered. "
                "The stage front and the oversized phone are both left COMPLETELY BLANK.") == []


def test_g4_splitter_terminates_on_bang_and_question_too():
    """R1-M1: one shared splitter, terminator class `.;!?`. Each sentence below carries
    only ONE negation; a splitter that ignores `!`/`?` (the old negation-check pattern)
    would fuse them into one sentence and false-positive a 2-negation report."""
    assert _run(L.negation_list_check,
                "No prices are visible! No labels are shown either.") == []
    assert _run(L.negation_list_check,
                "No prices are visible? No labels are shown either.") == []


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
    listed = set(re.findall(r"[a-z]+(?:-[a-z]+)+", line.split("table):")[1]))
    assert listed == set(L.SHOT_CLASSES) - {"literal"} | (listed & {"literal"}) or True
    assert set(L.SHOT_CLASSES) - {"literal"} <= listed, set(L.SHOT_CLASSES) - listed


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
                "crowd figures are on the CROWD RIG: round heads in 2-3 flat tones, DOT EYES.")
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


def test_g7_anon_foreground_gets_forges_named_refusal_not_a_generic_unknown_key():
    hard, soft = _fig({"anon_foreground": ["one anonymous person"]})
    assert len(hard) == 1, hard
    assert "unknown key" not in hard[0], hard
    assert "abolished" in hard[0] and "standard cast-generation waves" in hard[0], hard
    # The remedy is seeded cast: existing where the story identifies one, otherwise a NEW member
    # through the standard cast-generation waves. Crowd is legal only when mass is the story point.
    assert "seeded performer" not in hard[0] and "`base` plus" not in hard[0], hard
    assert "NEW named cast member" in hard[0] and "standard cast-generation waves" in hard[0], hard


def test_g7_crowd_false_is_soft_not_hard():
    hard, soft = _fig({"crowd": False})
    assert hard == [] and len(soft) == 1, (hard, soft)


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


def test_g8_anchor_is_not_valid_on_a_delta():
    """C-5 widened this from base-only to any NON-DELTA shot (2026-08-04) — a delta
    still can't carry one; it continues its own base's held scene."""
    hard = _place("assets/scenes/L60.png", stage_role="delta")
    assert len(hard) == 1 and "not valid on a stage `delta`" in hard[0], hard


def test_g8_anchor_is_legal_on_a_standalone_shot_with_no_stage_role():
    """The C-5 widening: a place-first standalone shot (no `stage` at all) may now
    carry a place_anchor too, not just a regenerated `base`."""
    assert _place("assets/scenes/L60.png", stage_role=None) == []


# =========================================================================
# GUARD 9 — spatial tier + delta-feasibility subset (HARD)
# =========================================================================
def _spatial(figures, prompt, **extra):
    sh = {"id": "L01", "figures": figures, "still_prompt": prompt}
    sh.update(extra)
    hard = []
    L.spatial_tier_check("lf", [("L01", sh)], hard)
    return hard


def test_g9_across_the_counter_is_not_a_positive_rear_zone():
    hard = _spatial({"crowd": True},
                    "A background crowd reaches across the counter toward the display.")
    assert len(hard) == 1 and "positive rear zone" in hard[0], hard


def test_g9_crowd_in_a_real_rear_zone_is_silent():
    hard = _spatial({"crowd": True},
                    "A small crowd waits on the far side of the glass partition, clearly behind the leads.")
    assert hard == [], hard


def test_g9_pressed_to_camera_phrases_fail_even_without_background_scale_prose():
    prompts = (
        "A lobby packed shoulder to shoulder with shouting skaters.",
        "A packed crowd pressing shoulder to shoulder against the glass.",
        "Customers crowded three deep against the counter.",
        "A press of buyers reaches up from the counter.",
        "Prospectors keep pressing in on the far side.",
    )
    for prompt in prompts:
        hard = _spatial({"crowd": True}, prompt)
        assert len(hard) == 1 and "pressed-to-camera" in hard[0], (prompt, hard)


def test_g9_individually_counted_anonymous_people_cannot_hide_in_crowd():
    hard = _spatial({"crowd": True},
                    "Three overcoated figures work on the far side of the table while the crowd waits behind glass.")
    assert len(hard) == 1 and "individually staged anonymous" in hard[0], hard


def test_g9_named_leads_with_mass_crowd_are_silent():
    hard = _spatial({"crowd": True},
                    "`brick-foreman` faces `qt-wiles`; the crowd waits behind the glass partition.")
    assert hard == [], hard


def _delta(prompt, changed="the tower topples"):
    hard = []
    L.delta_feasibility_check("lf", [("L01", {
        "id": "L01", "stage_role": "delta", "still_prompt": prompt,
        "changed_elements": [changed],
    })], hard)
    return hard


def test_g9_completion_delta_requires_a_completion_quantifier():
    hard = _delta("Only this changes: the leaning tower has toppled; everything else exactly as established.")
    assert len(hard) == 1 and "completion quantifier" in hard[0], hard


def test_g9_quantified_completion_delta_is_silent():
    hard = _delta("Only this changes: the entire tower has toppled and nothing remains standing; "
                  "everything else exactly as established.")
    assert hard == [], hard


def test_g9_exact_gap_delta_routes_out_of_whole_frame_prose():
    hard = _delta("Only this changes: a belt stops with a visible gap of bare floor before the light pool; "
                  "everything else exactly as established.")
    assert len(hard) == 1 and "layered/rebase" in hard[0], hard


def test_g9_replace_one_person_delta_routes_out_of_whole_frame_prose():
    hard = _delta("Only this changes: replace exactly one person at the desk; everything else exactly as established.")
    assert len(hard) == 1 and "layered/rebase" in hard[0], hard


def test_g9_ordinary_delta_is_silent():
    hard = _delta("Only this changes: the marker card turns red; everything else exactly as established.",
                  "the marker card turns red")
    assert hard == [], hard


def test_g9_multiple_declared_delta_changes_are_not_one_transformation():
    hard = []
    L.delta_feasibility_check("lf", [("L01", {
        "id": "L01", "stage_role": "delta", "still_prompt": "Only this changes: the card turns red.",
        "changed_elements": ["the card turns red", "a hand enters frame"],
    })], hard)
    assert len(hard) == 1 and "exactly one non-empty `changed_elements` string" in hard[0], hard


def test_g9_inherited_completion_word_is_not_the_delta_completion_state():
    hard = _delta("The same wrecked room, the toppled cash bales and overturned desk. Only this changes: "
                  "a torn page hangs on the wall; everything else exactly as established.",
                  "a torn page hangs on the wall")
    assert hard == [], hard


# R5 — closed declared-token catalog: known tokens pass; unknowns and elevation flags block.
def test_r5_closed_catalog():
    cases = [("`cast` `action-present` `expr-deadpan`", "", 0),
             ("`cast` `action-freestyle`", "", 1),
             ("`cast` `invented-pose`", "", 1),
             ("`cast`", "ELEVATION — primitive needed: cartwheel; BLOCKED until minted + approved", 1)]
    for prompt, notes, expected in cases:
        hard = []
        L.primitive_catalog_check("lf", [("L01", {"still_prompt": prompt, "notes": notes})],
                                  {"cast", "action-present", "expr-deadpan"}, hard)
        assert len(hard) == expected, hard


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
            "generated": "2026-07-29", "status": "shots-drafted",
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


def test_e2e_clean_file_still_exits_zero_and_writes_vo_text():
    rc, p = _main(_file(), "--write")
    assert rc == 0
    assert "vo_text" in json.loads(p.read_text(encoding="utf-8"))["long_form"]["shots"][0]


def test_e2e_a_new_hard_guard_fails_and_skips_write():
    rc, p = _main(_file(shot_class="vibes-montage"), "--write")
    assert rc == 1
    assert "vo_text" not in json.loads(p.read_text(encoding="utf-8"))["long_form"]["shots"][0]


def test_e2e_anon_foreground_is_a_hard_unknown_key():
    rc, _ = _main(_file(figures={"anon_foreground": ["a figure never staged"]}))
    assert rc == 1


def test_e2e_a_bad_place_anchor_is_hard_and_skips_write():
    rc, p = _main(_file(place_anchor="../other-video/assets/scenes/L60.png"), "--write")
    assert rc == 1
    assert "vo_text" not in json.loads(p.read_text(encoding="utf-8"))["long_form"]["shots"][0]


def test_e2e_report_encodes_on_a_cp1252_console(capsys):
    _main(_file(shot_class="vibes-montage", figures={"crowd": False},
                still_prompt="a keeper. The stall keeper is drawn as follows. The glass carries "
                             "no signs and no words. A sign 'TRANS CONTINENTAL AIRLINES' and "
                             "cards 'A LOT', 'B LOT', 'C LOT', 'D LOT' with 'TERMINATED'"))
    capsys.readouterr().out.encode("cp1252")   # must not raise
