# -*- coding: utf-8 -*-
"""Planted-defect + false-positive tests for the 2026-08-04 ROUND-2 guards.

The findings these close were measured by the fresh-fifth adversarial pass over
`channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json` (fresh) against
`assets/_archive-pre-reset/shots.pre-reset.json` (problem-era). Every fixture below is real
authored prose from one of those two files, so the positives AND the negatives are things an
author actually wrote — the calibration duty, not invented straw cases.

  F1  carry scan vs a control token   `blank_backticked` / `carried_literal_check`
  B1  a character's entrance in a delta  `delta_entrance_check`
  B4  payload buried mid-prompt          `payload_last_check`
  B5  declared duration vs the real hold `real_cadence_check`
  B3  the LOCKED lettering route         `lettering_route_check`
  B2  the interaction template           `interaction_cast_check`

Run from the scripts/ dir:  py -3 -m pytest test_round2_guards.py -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import lint_shots as L  # noqa: E402

SUFFIX = "hand-lettered marker capitals for any in-world text"
INTERACTIONS = {"handshake", "handoff", "fistbump"}

# L29 verbatim — the shot whose seed recipe was physically unsatisfiable while every lint law
# in the file passed it clean, which is exactly why it needed a law of its own.
L29 = ("`ibm-suit`, `expr-deadpan`, and `terry-johnson`, `expr-delighted`, meet in `handshake` "
       "at the plant's open shipping door, both standing on the same plane on the concrete apron "
       "at a matching eye-line and the same relative head scale, facing each other in profile.")


# =============================================================================
# F1 — the carry scan must not read a literal inside a control token
# =============================================================================
def test_carry_scan_ignores_a_literal_fragment_inside_a_backticked_slug():
    """The confirmed defect. `place_owner: "MINISCRIBE"` is word-boundary-matched inside the
    cast slug `` `miniscribe-rep` ``, so naming the company's own personified rep inside the
    company's own branded place HARD-failed unless the prompt re-quoted the sign within the
    60-char supply window. Measured consequences: it forced L28's payload into the identity
    zone (the ordering law's worst case in the file) and it bent L29's CASTING decision."""
    shots = [
        {"id": "L26", "place": "miniscribe-plant", "place_owner": "MINISCRIBE",
         "still_prompt": "A disk-drive assembly floor, cast-free. Above the floor entrance a "
                         "broad painted board carries 'MINISCRIBE'."},
        {"id": "L28", "place": "miniscribe-plant",
         "still_prompt": "`miniscribe-rep` under the painted board, `expr-delighted`, "
                         "`action-powerstance`, planted square in the floor entrance."},
    ]
    hard = []
    L.carried_literal_check("lf", shots, SUFFIX, hard)
    assert hard == [], hard


def test_carry_scan_still_catches_a_genuine_lowercase_downgrade():
    """The rule the fix must not weaken: a literal DOWNGRADED to prose is still the CHECKIG
    defect. Same fixture, but the paraphrase is real prose, not a control token."""
    shots = [
        {"id": "L26", "place": "miniscribe-plant", "place_owner": "MINISCRIBE",
         "still_prompt": "The floor, cast-free, a board carrying 'MINISCRIBE'."},
        {"id": "L28", "place": "miniscribe-plant",
         "still_prompt": "A figure planted under the miniscribe board in the floor entrance."},
    ]
    hard = []
    L.carried_literal_check("lf", shots, SUFFIX, hard)
    assert len(hard) == 1 and "MINISCRIBE" in hard[0] and "L28" in hard[0], hard


def test_blanking_a_backticked_span_preserves_every_offset():
    """Offsets are load-bearing: the check scans and reports by index into this same string."""
    src = "`miniscribe-rep` under the board carrying 'MINISCRIBE', `expr-delighted`."
    out = L.blank_backticked(src)
    assert len(out) == len(src)
    assert out.index("'MINISCRIBE'") == src.index("'MINISCRIBE'")
    assert "miniscribe-rep" not in out and "expr-delighted" not in out


# =============================================================================
# B1/C8 — a named figure's first appearance on a set is never a delta
# =============================================================================
def test_plant_the_l41_entrance_staged_as_a_delta():
    """The refusal that killed the whole batch at forge's pre-flight. L41 stages Terry
    Johnson's exit — his first appearance since L29 — as a delta on L40, a frame that does not
    contain him, so his pose and expression are prose against pixels holding neither."""
    shots = [
        {"id": "L40", "place": "miniscribe-plant",
         "still_prompt": "The quiet assembly floor, four workbenches, the packers filing out."},
        {"id": "L41", "place": "miniscribe-plant", "stage": "plant-thinning",
         "stage_role": "delta",
         "still_prompt": "The same quiet assembly floor. Only this changes: `terry-johnson`, "
                         "`expr-crestfallen`, `carry-by-handle`, now stands at the rear "
                         "doorway."},
    ]
    hard = []
    L.delta_entrance_check("lf", shots, {"terry-johnson"}, hard)
    assert len(hard) == 1 and "L41" in hard[0] and "terry-johnson" in hard[0], hard
    assert "'L40'" in hard[0], hard          # names the parent frame it is absent from


def test_a_delta_holding_a_figure_its_parent_already_carries_is_silent():
    """The DEFAULT authoring shape: parent + canonical carry the figure in pixels."""
    shots = [
        {"id": "L38", "place": "miniscribe-plant", "stage": "ibm-cut", "stage_role": "base",
         "still_prompt": "`ibm-suit`, `expr-deadpan`, blocks the shipping doorway."},
        {"id": "L39", "place": "miniscribe-plant", "stage": "ibm-cut", "stage_role": "delta",
         "still_prompt": "The same doorway: `ibm-suit`, `expr-deadpan`, the ramp now lowered."},
    ]
    hard = []
    L.delta_entrance_check("lf", shots, {"ibm-suit"}, hard)
    assert hard == []


def test_the_parent_is_forges_own_seeding_key_not_the_previous_line():
    """`delta_parent_of` mirrors `forge.py cmd_batch`: the key is `place or stage or id` and
    the parent is the previous shot carrying that key, not the previous shot in the file."""
    shots = [
        {"id": "L38", "place": "miniscribe-plant",
         "still_prompt": "`ibm-suit` blocks the shipping doorway."},
        {"id": "L39", "still_prompt": "A cutaway to a cash ledger, no place."},
        {"id": "L40", "place": "miniscribe-plant", "stage": "x", "stage_role": "delta",
         "still_prompt": "The same doorway, `ibm-suit` still there, the ramp lowered."},
    ]
    assert L.delta_parent_of(shots)["L40"]["id"] == "L38"
    hard = []
    L.delta_entrance_check("lf", shots, {"ibm-suit"}, hard)
    assert hard == []


def test_a_delta_with_no_earlier_shot_on_its_key_is_not_a_delta_beat():
    """forge does not treat it as one either (`place in place_last` is false), so neither does
    this check — no parent frame, nothing to be absent from."""
    shots = [{"id": "L41", "place": "miniscribe-plant", "stage_role": "delta",
              "still_prompt": "`terry-johnson` at the rear doorway."}]
    hard = []
    L.delta_entrance_check("lf", shots, {"terry-johnson"}, hard)
    assert hard == [] and L.delta_parent_of(shots) == {}


def test_delta_entrance_degrades_silently_with_no_cast_vocabulary():
    shots = [{"id": "L40", "place": "p", "still_prompt": "An empty floor."},
             {"id": "L41", "place": "p", "stage_role": "delta",
              "still_prompt": "`terry-johnson` now at the doorway."}]
    hard = []
    L.delta_entrance_check("lf", shots, set(), hard)
    assert hard == []


# =============================================================================
# B4 — the payload is the FINAL clause
# =============================================================================
def test_plant_the_buried_payload_on_the_shapes_the_fresh_fifth_used():
    """Fresh L21/L31 verbatim: the literal two or three sentences upstream of a trailing
    Framing/Palette clause. 0 of 9 non-delta text-bearing shots in that file were
    payload-last."""
    shots = [
        {"id": "L21", "still_prompt":
            "The rented warehouse again, lamp-lit and cast-free. A tally card propped against "
            "the front pallet carries '26,000'. Framing: wide static eye-level. Palette: "
            "cold concrete grey, warm lamp amber, brown board."},
        {"id": "L31", "still_prompt":
            "A stack of flat drive cartons rises off a plain concrete apron. The fourth carton "
            "up is lettered '125 MILLION' across its face. Framing: medium eye-level. Palette "
            "brown board, pale blue sky, grey concrete."},
    ]
    hard = []
    L.payload_last_check("lf", shots, SUFFIX, hard)
    assert len(hard) == 2 and "'26,000'" in hard[0] and "'125 MILLION'" in hard[1], hard


def test_the_problem_era_payload_last_prose_is_silent():
    """Archived L23/L39 verbatim — the same script span was 7/7 payload-last, which is why
    this is HARD rather than a heads-up: a discipline authors demonstrably hit."""
    shots = [
        {"id": "L23", "still_prompt":
            "A packing bench under a hanging lamp, one carton square in the middle of it. The "
            "carton's folded-back lid flap is lettered 'HARD DRIVE'."},
        {"id": "L39", "still_prompt":
            "The shop counter at closing, the register drawer shut. A desk calendar standing on "
            "the counter is lettered '1984'."},
    ]
    hard = []
    L.payload_last_check("lf", shots, SUFFIX, hard)
    assert hard == []


def test_a_delta_closing_on_the_sanctioned_formula_is_exempt():
    """A delta's final clause is its ONE change plus 'everything else exactly as established' —
    the chain logic owns that ordering, and both files close every delta that way, correctly."""
    shots = [{"id": "L22", "stage": "brick-tease", "stage_role": "delta", "still_prompt":
              "The same warehouse, the tally card still carrying '26,000'. Only this changes: "
              "the front carton's flaps stand folded open; everything else exactly as "
              "established."}]
    hard = []
    L.payload_last_check("lf", shots, SUFFIX, hard)
    assert hard == []


def test_a_carried_place_owner_literal_is_not_this_shots_payload():
    """The exemption that stops a lint rule manufacturing content. On L28 'MINISCRIBE' is L-1
    carry of a sign the PLATE established; demanding it in the payload slot is the same
    rule-pushes-signage failure the carry-scan collision produced. On the plate itself the
    owner literal IS the payload, so the law still applies there."""
    shots = [
        {"id": "L26", "place": "miniscribe-plant", "place_owner": "MINISCRIBE",
         "still_prompt": "A disk-drive assembly floor, cast-free. Above the floor entrance a "
                         "board carries 'MINISCRIBE'. Palette: beige, steel grey."},
        {"id": "L28", "place": "miniscribe-plant",
         "still_prompt": "`miniscribe-rep` under the board carrying 'MINISCRIBE', "
                         "`expr-delighted`. Palette beige, steel grey, daylight white."},
    ]
    hard = []
    L.payload_last_check("lf", shots, SUFFIX, hard)
    assert len(hard) == 1 and "L26" in hard[0], hard


def test_two_literals_need_only_one_of_them_in_the_final_clause():
    shots = [{"id": "L34", "still_prompt":
              "Two carton stacks on the apron, the left one plain. The right stack's fourth "
              "carton is lettered '125 MILLION' and the left stack's top carton '600 "
              "MILLION'."}]
    hard = []
    L.payload_last_check("lf", shots, SUFFIX, hard)
    assert hard == []


def test_a_textless_shot_is_never_flagged():
    shots = [{"id": "L03", "still_prompt": "A rented warehouse at night, cast-free. Every wall "
                                           "face stands completely blank and unlettered."}]
    hard = []
    L.payload_last_check("lf", shots, SUFFIX, hard)
    assert hard == []


# =============================================================================
# B5 — the REAL hold, measured off the word timings render cuts on
# =============================================================================
def _timings(*pairs):
    return [[w, t] for w, t in pairs]


def _matches(*starts):
    return [{"id": f"L{k:02d}", "start": s} for k, s in enumerate(starts, 1)]


def test_the_real_hold_is_measured_off_the_word_timings_not_duration_s():
    """The fresh fifth declared an average 2.45s 'inside the band' while L31's real hold was
    4.96s — a +2.36s divergence, on a static carton stack against sky. An average over
    declared numbers is not the cadence the render produces."""
    wt = _timings(("a", 0.0), ("b", 4.96), ("c", 7.0))
    shots = [{"id": "L01", "duration_s": 2.6}, {"id": "L02", "duration_s": 2.0},
             {"id": "L03", "duration_s": 2.0}]
    soft = []
    L.real_cadence_check("lf", shots, wt, _matches(0, 1, 2), soft)
    assert len(soft) == 1 and "4.96s" in soft[0] and "declared 2.6s" in soft[0], soft
    assert "over the 4s earned ceiling" in soft[0]


def test_the_floor_the_band_and_an_in_band_hold_read_differently():
    # holds: L01 2.50 (in band) · L02 1.45 (floor) · L03 2.50 (in band) · L04 3.90 (band)
    wt = _timings(("a", 0.0), ("b", 2.5), ("c", 3.95), ("d", 6.45), ("e", 10.35))
    shots = [{"id": f"L{k:02d}", "duration_s": 2.5} for k in range(1, 6)]
    soft = []
    L.real_cadence_check("lf", shots, wt, _matches(0, 1, 2, 3, 4), soft)
    assert len(soft) == 2, soft
    assert "below the 1.5s floor" in soft[0] and "L02" in soft[0]
    assert "over the 3s band" in soft[1] and "L04" in soft[1]


def test_the_final_shot_is_skipped_it_has_no_next_anchor():
    """A partial file's last shot absorbs every unwritten fifth; LONG_SPAN_WORDS already
    reports that, and a 448s 'hold' here would be noise, not a cadence finding."""
    wt = _timings(("a", 0.0), ("b", 2.0), ("c", 450.0))
    shots = [{"id": "L01"}, {"id": "L02"}]        # L02 is last: its span runs to the VO end
    soft = []
    L.real_cadence_check("lf", shots, wt, _matches(0, 1), soft)
    assert soft == []


def test_no_timings_means_no_cadence_check_at_all():
    """Pre-voiceover, the estimate is the only number there is — nothing truer to compare."""
    soft = []
    L.real_cadence_check("lf", [{"id": "L01"}], [], _matches(0), soft)
    assert soft == []


# =============================================================================
# B3 — the LOCKED lettering route, post-Pass-1
# =============================================================================
LETTER_PNG = "assets/library/lettering-marker-italic.png"


def test_a_partial_assets_block_dropping_the_exemplar_on_a_text_shot_fails():
    """Where this check lives: AFTER Pass 1, when an `assets` block exists and can disagree
    with forge's derivation. style-bible §5 is LOCKED — no exemplar means the literal renders
    in the clean digital font the bible forbids."""
    objs = [("L31", {"id": "L31", "assets": {"prop-drive": "assets/library/prop-drive.png"},
                     "still_prompt": "A carton lettered '125 MILLION' across its face."})]
    hard = []
    L.lettering_route_check("lf", objs, SUFFIX, hard)
    assert len(hard) == 1 and "lettering-marker-italic" in hard[0], hard


def test_assets_omitted_suppressing_the_exemplar_on_a_text_shot_fails():
    objs = [("L31", {"id": "L31", "assets": {"lettering-marker-italic": LETTER_PNG},
                     "assets_omitted": ["lettering-marker-italic"],
                     "still_prompt": "A carton lettered '125 MILLION'."})]
    hard = []
    L.lettering_route_check("lf", objs, SUFFIX, hard)
    assert len(hard) == 1 and "assets_omitted" in hard[0], hard


def test_a_complete_assets_block_on_a_text_shot_is_silent():
    objs = [("L31", {"id": "L31", "assets": {"lettering-marker-italic": LETTER_PNG},
                     "still_prompt": "A carton lettered '125 MILLION'."})]
    hard = []
    L.lettering_route_check("lf", objs, SUFFIX, hard)
    assert hard == []


def test_a_freshly_authored_file_has_no_assets_block_and_is_correctly_silent():
    """The whole authoring window: `assets` is image-generation-owned and written at Pass 1, so
    a VPW file has none. forge's derivation is the route there, not this check."""
    objs = [("L31", {"id": "L31", "still_prompt": "A carton lettered '125 MILLION'."})]
    hard = []
    L.lettering_route_check("lf", objs, SUFFIX, hard)
    assert hard == []


def test_a_textless_shot_with_an_assets_block_needs_no_exemplar():
    objs = [("L10", {"id": "L10", "assets": {"prop-drive": "assets/library/prop-drive.png"},
                     "still_prompt": "`pc-boxy` on a shop counter, a `prop-drive` in front."})]
    hard = []
    L.lettering_route_check("lf", objs, SUFFIX, hard)
    assert hard == []


# =============================================================================
# B2 — the interaction template, authoring side
# =============================================================================
def test_the_l29_two_cast_base_carrying_a_template_is_silent():
    """The fresh file's own L29 is CORRECT authoring — two named cast, a stage base, plane and
    eye-line and head scale all stated. The defect was forge's ROUTING, not the prose, so this
    check must not flag it."""
    objs = [("L29", {"id": "L29", "stage": "ibm-deal", "stage_role": "base",
                     "still_prompt": L29})]
    hard = []
    L.interaction_cast_check("lf", objs, {"ibm-suit", "terry-johnson"}, INTERACTIONS, hard)
    assert hard == []


def test_plant_a_template_on_a_solo_shot():
    objs = [("L29", {"id": "L29", "still_prompt":
                     "`terry-johnson`, `expr-delighted`, offers `handshake` to the camera."})]
    hard = []
    L.interaction_cast_check("lf", objs, {"terry-johnson"}, INTERACTIONS, hard)
    assert len(hard) == 1 and "1 seeded figure(s)" in hard[0] and "handshake" in hard[0], hard


def test_plant_a_template_on_a_delta_beat():
    objs = [("L30", {"id": "L30", "stage": "ibm-deal", "stage_role": "delta",
                     "still_prompt": L29})]
    hard = []
    L.interaction_cast_check("lf", objs, {"ibm-suit", "terry-johnson"}, INTERACTIONS, hard)
    assert len(hard) == 1 and "stage `delta`" in hard[0], hard


def test_an_ordinary_pose_slug_is_not_an_interaction():
    objs = [("L28", {"id": "L28", "still_prompt":
                     "`miniscribe-rep`, `expr-delighted`, `action-powerstance`, in the "
                     "doorway."})]
    hard = []
    L.interaction_cast_check("lf", objs, {"miniscribe-rep"}, INTERACTIONS, hard)
    assert hard == []


def test_interaction_check_degrades_silently_without_its_vocabulary():
    objs = [("L29", {"id": "L29", "still_prompt":
                     "`terry-johnson` offers `handshake` to the camera."})]
    hard = []
    L.interaction_cast_check("lf", objs, {"terry-johnson"}, set(), hard)
    L.interaction_cast_check("lf", objs, set(), INTERACTIONS, hard)
    assert hard == []


def test_video_interactions_reads_the_real_channel_registry():
    """The vocabulary source, on the live registry so a rename shows up here rather than as a
    silently disabled check."""
    vdir = (Path(__file__).resolve().parents[4] / "channels" / "the-second-take"
            / "videos" / "2026-07-28-bricks-fresh")
    names = L.video_interactions({"channel": "the-second-take"}, vdir)
    assert "handshake" in names and "handoff" in names, sorted(names)
    assert "action-powerstance" not in names and "sit" not in names
