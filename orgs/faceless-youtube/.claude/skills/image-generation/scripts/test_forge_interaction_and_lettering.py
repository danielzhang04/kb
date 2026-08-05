#!/usr/bin/env python3
"""Regression contract for the 2026-08-04 round-2 forge fixes (no provider calls, $0).

Two defects the fresh-fifth adversarial pass measured, both invisible to lint:

  * **B2 — the interaction slug bound to ONE figure.** `_split_primitives` treated an
    `interaction` asset as a pose, so `shot_cast`'s most-recently-named binding minted
    `fig-terry-johnson--handshake--expr-delighted`: a SOLO reference sheet whose own payload
    says "the character alone, fully resolved" while its third seed was a two-person
    handshake. An interaction template is "two blank base mannequins carrying clasp geometry
    + eye-line" (image-generation SKILL, Pass-1 build recipe) — it belongs to the SCENE.
  * **B3/L3 — the LOCKED lettering route depended on a field nobody had written.**
    style-bible §5: `lettering-marker-italic` "seeds every text-bearing gen". forge routed
    prop/environment seeds from the shot's `assets` block ONLY, and the fresh fifth carried no
    `assets` block on any of its 41 shots — so the exemplar seeded 0 of 14 text-bearing
    frames, and L10's backticked `prop-drive` shipped as an unresolved control token.

Fixtures are the REAL L29 handshake shape and the REAL L10 prop shape, against the real
`the-second-take` registry, so the vocabulary under test is production's.

Run: py -3 -m pytest test_forge_interaction_and_lettering.py -q
"""
import contextlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from forge import (FIGURE_PREFIX, Kit, _interaction_primitives, _split_primitives, _stem,
                   cmd_batch, figure_card_payload, interaction_violations, shot_cast,
                   text_bearing)

KIT_DIR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit")
ROOT = KIT_DIR.parents[2]

# L29 verbatim from the fresh fifth — the shot whose recipe was physically unsatisfiable.
L29_PROMPT = (
    "`ibm-suit`, `expr-deadpan`, and `terry-johnson`, `expr-delighted`, meet in `handshake` at "
    "the plant's open shipping door, both standing on the same plane on the concrete apron at a "
    "matching eye-line and the same relative head scale, facing each other in profile. Between "
    "and behind them a loaded pallet of flat cartons waits at the door's lip. Framing: "
    "medium-wide two-shot, the handshake centred at chest height.")
# L10 verbatim: a backticked recurring PROP with no `assets` block anywhere in the file.
L10_PROMPT = (
    "`pc-boxy`, `expr-delighted`, on a shop counter, a `prop-drive` set square in front of it, "
    "the price rail below running the length of the counter.")


def _kit():
    kit = Kit(str(KIT_DIR), dry=True)
    # A worktree has no env marker, so `Kit` walks to the filesystem root; pin the root the
    # registry's relative asset paths are written against (same fixture shape as
    # test_forge_seed_roles_and_delta.py).
    kit.root = str(ROOT)
    kit.staging = os.path.join(tempfile.mkdtemp(), "_staging")
    os.makedirs(kit.staging)
    return kit


def _batch(shots, scope=None):
    """Run the builder over a hand-built shots.json and return `{name: request}`."""
    kit = _kit()
    d = tempfile.mkdtemp()
    shots_path = os.path.join(d, "shots.json")
    out_path = os.path.join(d, "slate.json")
    with open(shots_path, "w", encoding="utf-8") as f:
        json.dump({"schema": "faceless-youtube/shots@2", "channel": "the-second-take",
                   "long_form": {"aspect_ratio": "16:9", "shots": shots}}, f)
    with contextlib.redirect_stdout(io.StringIO()):
        cmd_batch(kit, shots_path, out_path, video_dir=d, shots=scope)
    with open(out_path, encoding="utf-8") as f:
        return {r["name"]: r for r in json.load(f)}


def _reg():
    return _kit().reg


# =============================================================================
# B2 — the interaction template is scene-level, never a figure's pose
# =============================================================================
def test_split_primitives_no_longer_calls_an_interaction_a_pose():
    """The single line that produced B2. `handshake` is registry kind `interaction`."""
    pose, expr = _split_primitives(_reg(), ["handshake", "expr-delighted"])
    assert pose is None, pose
    assert expr == "expr-delighted"


def test_interaction_primitives_are_collected_scene_level_across_the_whole_cast():
    """Which character `shot_cast` happened to bind the slug to carries no meaning."""
    reg = _reg()
    cast = shot_cast(reg, L29_PROMPT)
    assert [c for c, _p in cast] == ["ibm-suit", "terry-johnson"]
    assert _interaction_primitives(reg, cast) == ["handshake"]


def test_interaction_primitives_honour_assets_omitted():
    reg = _reg()
    cast = shot_cast(reg, L29_PROMPT)
    assert _interaction_primitives(reg, cast, omitted=("handshake",)) == []


def test_l29_mints_two_pose_free_step1_cards_and_seeds_the_template_scene_level():
    """The whole B2 fix, on the real fixture: no STEP-1 name carries `handshake`, both cards
    are solo and pose-free, and the template is ONE scene-level seed serving both figures.
    2 figures + template + place = 4 seeds, exactly at SEED_CAP."""
    reqs = _batch([
        {"id": "L26", "place": "miniscribe-plant", "place_owner": "MINISCRIBE",
         "still_prompt": "A disk-drive assembly floor, cast-free, a board carrying 'MINISCRIBE'."},
        {"id": "L29", "place": "miniscribe-plant", "stage": "ibm-deal", "stage_role": "base",
         "still_prompt": L29_PROMPT},
    ])
    step1 = [n for n in reqs if n.startswith(FIGURE_PREFIX)]
    assert sorted(step1) == ["fig-ibm-suit--expr-deadpan",
                             "fig-terry-johnson--expr-delighted"], step1
    assert not any("handshake" in n for n in step1), step1
    for n in step1:
        assert [e["role"] for e in reqs[n]["seed_roles"]] == ["canonical", "expression"]

    roles = [(e["role"], _stem(e["path"]), e["character"]) for e in reqs["L29"]["seed_roles"]]
    assert roles == [("figure", "fig-ibm-suit--expr-deadpan", "ibm-suit"),
                     ("figure", "fig-terry-johnson--expr-delighted", "terry-johnson"),
                     ("interaction", "handshake", None),
                     ("place", "L26", None)], roles


def test_the_template_role_prose_gives_the_geometry_to_neither_figure():
    """Attribute routing (SKILL Pass-2 table): the template is geometry ONLY. Untruthful role
    prose is the B4 root cause `seed_roles_text` exists to remove."""
    reqs = _batch([
        {"id": "L26", "place": "miniscribe-plant", "place_owner": "MINISCRIBE",
         "still_prompt": "A disk-drive assembly floor, cast-free, a board carrying 'MINISCRIBE'."},
        {"id": "L29", "place": "miniscribe-plant", "stage": "ibm-deal", "stage_role": "base",
         "still_prompt": L29_PROMPT},
    ])
    prose = reqs["L29"]["delta"]
    assert "`handshake` interaction template" in prose
    assert "two blank mannequins" in prose
    assert "neither figure's identity, costume or expression" in prose


def test_a_pose_free_step1_card_is_told_to_stand_neutral_not_to_copy_a_missing_reference():
    """Both interaction cards are pose-free by construction, so the stance sentence may not
    point at a pose reference the request does not carry."""
    assert "pose reference shows" in figure_card_payload("action-salute")
    assert "pose reference" not in figure_card_payload(None)
    assert "standing squarely at rest" in figure_card_payload(None)


def test_the_surplus_note_no_longer_reports_the_template_as_a_dropped_primitive():
    reqs = _batch([
        {"id": "L26", "place": "miniscribe-plant", "place_owner": "MINISCRIBE",
         "still_prompt": "A disk-drive assembly floor, cast-free, a board carrying 'MINISCRIBE'."},
        {"id": "L29", "place": "miniscribe-plant", "stage": "ibm-deal", "stage_role": "base",
         "still_prompt": L29_PROMPT},
    ])
    assert "surplus" not in reqs["L29"]["why"], reqs["L29"]["why"]


# --- the three refusals, one per way of breaking the law ----------------------
def _violations(request, prompt):
    reg = _reg()
    return interaction_violations(_kit(), dict(request, payload=prompt),
                                  shot_cast(reg, prompt), request.get("seed", []))


def test_refusal_solo_shot_authoring_an_interaction_template():
    solo = "`terry-johnson`, `expr-delighted`, offers `handshake` to the camera."
    bad = _violations({"name": "L29", "seed": ["handshake.png"]}, solo)
    assert len(bad) == 1 and "1 named cast" in bad[0] and "BETWEEN two bodies" in bad[0], bad


def test_refusal_a_step1_card_may_never_carry_a_template():
    bad = _violations({"name": "fig-terry-johnson--handshake--expr-delighted",
                       "seed": ["handshake.png"]}, L29_PROMPT)
    assert len(bad) == 1 and "reference sheet of the character ALONE" in bad[0], bad


def test_refusal_a_delta_beat_has_no_slot_for_a_template():
    bad = _violations({"name": "L30", "stage_role": "delta", "seed": ["handshake.png"]},
                      L29_PROMPT)
    assert len(bad) == 1 and "no slot left" in bad[0], bad


def test_refusal_the_template_is_named_but_not_seeded():
    bad = _violations({"name": "L29", "seed": []}, L29_PROMPT)
    assert len(bad) == 1 and "does not seed it" in bad[0], bad


def test_a_correct_two_cast_base_carrying_its_template_is_silent():
    assert _violations({"name": "L29", "stage_role": "base",
                        "seed": ["refs/base/handshake.png"]}, L29_PROMPT) == []


def test_a_shot_with_no_interaction_slug_is_silent():
    assert _violations({"name": "L28", "seed": []},
                       "`miniscribe-rep`, `expr-delighted`, `action-powerstance`.") == []


# =============================================================================
# B3 — the LOCKED lettering route is DERIVED, not remembered
# =============================================================================
def test_text_bearing_reads_a_supplied_quoted_literal_and_not_a_possessive():
    assert text_bearing("a tally card propped up carries '26,000'.")
    assert not text_bearing("the counter's edge, the shop's back wall, every surface blank.")
    assert not text_bearing("a bare concrete apron with nothing written on it.")


def test_a_text_bearing_shot_derives_the_lettering_exemplar_with_no_assets_block():
    """style-bible §5 is LOCKED. The fresh fifth declared no `assets` block on ANY shot and
    seeded the exemplar on 0 of 14 text frames; the route is now derived from the prompt, the
    same content-first move `depicts_figures` already makes for the rig hold."""
    reqs = _batch([{"id": "L31", "shot_class": "number-glued-to-object",
                    "still_prompt": "A stack of flat drive cartons; the fourth carton up is "
                                    "lettered '125 MILLION' across its face."}])
    roles = [(e["role"], _stem(e["path"])) for e in reqs["L31"]["seed_roles"]]
    assert roles == [("environment", "lettering-marker-italic")], roles
    assert "LETTERING" in reqs["L31"]["why"]


def test_a_figure_free_textless_shot_derives_nothing_and_stays_a_plate():
    reqs = _batch([{"id": "L03", "still_prompt": "A rented warehouse interior at night, "
                                                 "cast-free. Every wall face stands completely "
                                                 "blank and unlettered."}])
    assert reqs["L03"]["seed"] == [] and reqs["L03"]["plate"] is True


def test_a_backticked_registry_prop_is_derived_even_with_no_assets_block():
    """L10's defect: `prop-drive` was backticked, forge routed no seed for it, and the literal
    control token shipped in the prompt text unresolved."""
    reqs = _batch([{"id": "L10", "still_prompt": L10_PROMPT}])
    roles = [(e["role"], _stem(e["path"])) for e in reqs["L10"]["seed_roles"]]
    assert roles == [("canonical", "pc-boxy"), ("expression", "expr-delighted"),
                     ("prop", "prop-drive")], roles


def test_assets_omitted_still_suppresses_the_derived_exemplar():
    """`assets_omitted` is where a DELIBERATE exclusion is recorded; a derivation may not
    silently re-add one."""
    reqs = _batch([{"id": "L31", "assets_omitted": ["lettering-marker-italic"],
                    "still_prompt": "A carton lettered '125 MILLION' across its face."}])
    assert reqs["L31"]["seed"] == [], reqs["L31"]["seed"]


def test_an_explicit_assets_tag_is_not_duplicated_by_the_derivation():
    reqs = _batch([{"id": "L31",
                    "assets": {"lettering-marker-italic":
                               "channels/the-second-take/visual-kit/refs/env/"
                               "lettering-marker-italic.png"},
                    "still_prompt": "A carton lettered '125 MILLION' across its face."}])
    assert [_stem(s) for s in reqs["L31"]["seed"]] == ["lettering-marker-italic"]
