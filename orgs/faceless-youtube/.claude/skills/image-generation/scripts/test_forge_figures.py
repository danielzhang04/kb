#!/usr/bin/env python3
"""Plain-assert test for the `figures` expansion + prompt assembly (repo has no pytest).

Runs on the REAL `the-second-take` style-bible so the §2d blockquote under test is the one
production reads. It touches only pure functions — no Kit, no .env, no key, no network, no file
written — so it is safe to run at any time and proves the expansion without a single gen token.

Run:  py -3 .claude/skills/image-generation/scripts/test_forge_figures.py
      py -3 .claude/skills/image-generation/scripts/test_forge_figures.py --show   (print the prompts)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from forge import (IMAGE_SIZES, IMAGE_SIZE_DEFAULT, assemble_prompt,
                   blockquote_after, figures_expansion, placement_delta, should_hold, Kit)

BIBLE = (Path(__file__).resolve().parents[4]
         / "channels" / "the-second-take" / "visual-kit" / "style-bible.md")
_MD = BIBLE.read_text(encoding="utf-8")
DESC_STYLE = blockquote_after(_MD, "STYLE-ONLY descriptor")
DESC_RIGHOLD = blockquote_after(_MD, "RIG-HOLD descriptor")
CROWD_RIG = blockquote_after(_MD, "CROWD-RIG clause")

# --- sample shots (hand-built; the shapes VPW emits) -------------------------------------------
# (a) a base shot staging a crowd
SHOT_BASE = {
    "shot_id": "L07", "stage": "dock-1900", "stage_role": "base",
    "still_prompt": ("Wide shot of a brick dock at dawn: a crowd of dockhands moves crates "
                     "under a rust-red crane."),
    "figures": {"crowd": True},
}
# (b) the delta on the SAME stage: one element changes, the crowd is HELD
SHOT_DELTA = {
    "shot_id": "L08", "stage": "dock-1900", "stage_role": "delta",
    "still_prompt": ("The same dock at dawn, unchanged, except the crate is now open on the "
                     "cobbles — only this changes."),
    "figures": {"crowd": True},
}
# (c) a legacy shot: no `figures` key at all -> must assemble exactly as it did before the field
SHOT_LEGACY = {
    "shot_id": "L12", "stage_role": "base",
    "still_prompt": ("A parchment ledger page on a desk, the column of figures ruled in red ink, "
                     "one brass weight holding the corner down."),
}


def _assemble(shot, hold=True):
    return assemble_prompt(
        DESC_STYLE, shot["still_prompt"],
        figures_expansion(shot.get("figures"), CROWD_RIG),
        DESC_RIGHOLD if hold else "")


# --- the bible still exposes the clauses forge expands ------------------------------------------
def test_bible_blockquotes_are_readable():
    assert "CROWD RIG" in CROWD_RIG, CROWD_RIG[:120]
    assert DESC_RIGHOLD and DESC_STYLE


# --- (a) base shot ------------------------------------------------------------------------------
def test_crowd_only_shot_gets_only_the_crowd_clause():
    fig = figures_expansion({"crowd": True}, CROWD_RIG)
    assert fig == CROWD_RIG, fig[:160]


# --- (b) delta shot ----------------------------------------------------------------------------
def test_delta_shot_keeps_the_crowd_clause():
    fig = figures_expansion(SHOT_DELTA["figures"], CROWD_RIG)
    assert fig == CROWD_RIG, fig[:160]


# --- P1 PINS: the rig-discipline floor law, asserted where it REACHES the payload ---------------
# Daniel, G2: "Four digit hand should be baked in. No nose as well. identity rig laws as well."
# These are channel-level floor law, not per-video preference. They are pinned as the spans that
# actually enter a generated prompt, not as free-floating doctrine strings, so a clause silently
# dropped from the bible or from forge's assembly fails here rather than in a render.

# P1 PIN — the CROWD FACE TIER (style-bible §2d): dot eyes / one simple mouth / NO nose / NO ears /
# NO teeth / the squat proportion, applied to EVERY crowd figure. Protects "don't slip back into
# prior rig problems". Deliberately excludes the "round cream-family heads" head-tone phrase, which
# is the ONE span P4 is approved to rewrite.
def test_p1_pin_crowd_face_tier_clauses_reach_the_crowd_payload():
    text = _assemble(SHOT_BASE)
    for span in (
        "DOT EYES, one simple consistent mouth (neutral / smile / downturn only), "
        "NO noses, NO ears, NO teeth",
        "**EXACT same squat head-to-body proportion as the base rig**",
        "to EVERY crowd figure individually and without exception in a multi-figure group",
        "a single detailed or individuated face anywhere in the group is a rig FAIL",
    ):
        assert span in CROWD_RIG, span
        assert span in text, span


# P1 PIN — the FOUR-DIGIT HAND LAW (style-bible §2c RIG-HOLD, auto-appended to every
# character-bearing gen, and §2d for crowd hands). Protects "without fucking up rigging".
def test_p1_pin_four_digit_hand_law_reaches_every_figure_bearing_payload():
    text = _assemble(SHOT_BASE)
    for span in ("NO nose, NO ears",
                 "exactly THREE fingers plus ONE thumb (four digits total, Mickey / Simpsons "
                 "style, NEVER four fingers, NEVER five digits)"):
        assert span in DESC_RIGHOLD, span
        assert span in text, span
    # crowd hands are the SAME hand: the face tier is the only thing the crowd rig simplifies
    assert "hands, where visible, are the same four-digit cartoon hand" in text


# --- (c) legacy shot: byte-identical to pre-`figures` assembly ----------------------------------
def test_shot_without_figures_keeps_payload_final_under_the_new_zone_order():
    """REGRESSION GUARD. The pre-`figures` assembly was `descriptor + "\\n\\n" + delta` plus
    `"\\n\\n" + righold` when held. A shot with no `figures` key must produce those exact bytes —
    the field is additive or it silently re-prompts every legacy shot in the library."""
    legacy_before = DESC_STYLE + "\n\n" + DESC_RIGHOLD + "\n\n" + SHOT_LEGACY["still_prompt"]
    assert _assemble(SHOT_LEGACY, hold=True) == legacy_before
    no_hold_before = DESC_STYLE + "\n\n" + SHOT_LEGACY["still_prompt"]
    assert _assemble(SHOT_LEGACY, hold=False) == no_hold_before
    # an empty/false declaration is the same as no declaration
    for empty in (None, {}, {"crowd": False}):
        assert figures_expansion(empty, CROWD_RIG) == "", repr(empty)


# --- assembly order + the rig-hold signal ------------------------------------------------------
def test_assembly_order_is_descriptor_figures_righold_payload():
    text = _assemble(SHOT_BASE)
    i_desc = text.index(DESC_STYLE)
    i_delta = text.index("Wide shot of a brick dock")
    i_fig = text.index(CROWD_RIG)
    i_hold = text.index(DESC_RIGHOLD)
    assert i_desc < i_fig < i_hold < i_delta, (i_desc, i_fig, i_hold, i_delta)


def test_declared_figures_force_the_rig_hold():
    env = ["channels/x/visual-kit/refs/env/dock.png"]
    # a prompt whose figure words all hide behind proper nouns still holds, because the shot DECLARED
    assert should_hold("environment", env, "Dawn over the wharf.", SHOT_BASE["figures"]) is True
    assert should_hold("environment", env, "Dawn over the wharf.") is False   # unchanged without it
    assert should_hold("identity", env, "Dawn over the wharf.", SHOT_BASE["figures"]) is False


def test_step2_preserves_authored_prompt_and_identity_carry_without_scale_scaffold():
    authored = "`hq-banker` stands behind the polished desk in a high-rise office."
    roles = [
        {"path": "fig-hq-banker.png", "role": "figure", "character": "hq-banker"},
        {"path": "assets/scenes/office.png", "role": "place"},
    ]
    text = placement_delta(authored, roles)
    assert text.endswith("\n\n" + authored), text
    assert "`hq-banker`'s complete STEP-1 figure" in text
    assert "destination place" in text and "preserve its set, palette, outline weight and lighting" in text
    for removed in ("true human scale", "ground plane", "occluded", "re-lit"):
        assert removed not in text, (removed, text)


def test_a_scene_prompt_is_bible_head_then_authored_text_then_the_file_suffix_tail():
    """The poyais-era assembly, restored 2026-08-05: exactly TWO style voices, one at each end,
    with the authored payload untouched between them. No third voice is generated by forge."""
    k = Kit(str(BIBLE.parent), dry=True)
    authored = "A warm records room with two pens on a bare central paper."
    suffix = "Clean flat 2.5D vector cartoon in The Second Take house style: ... 16:9."
    text = k.prompt_for("environment", authored, suffix=suffix)
    assert text == k.desc_style + "\n\n" + authored + "\n\n" + suffix, text
    assert text.count(authored) == 1, text
    assert text.startswith(k.desc_style) and text.endswith(suffix), text
    # era §2b survivors the head voice must still carry (archaeology D1)
    # P1 PIN — the last two spans are the §2b SATURATION clause in its ea71f99 wording (verified
    # byte-identical to HEAD). median_sat is the one measured axis that separates Daniel's liked
    # frames from his disliked ones, so this clause is floor law: P11's warm re-lean is channel-level
    # and must never be delivered by weakening or re-rolling it.
    for phrase in ("Draw in the SAME art style as the reference image", "FLAT cel-shaded CARTOON",
                   "an even\nMEDIUM-THICK".replace("\n", " "), "#241a12",
                   "gentle soft cel shading", "No text, no words, no labels",
                   "flat colours laid down at FULL cel strength",
                   "every fill a real colour, and any grey or neutral clearly TINTED warm or cool, "
                   "so a cold scene reads COLD-COLOURED and never drains to greyscale"):
        assert phrase in text, (phrase, text)
    # a request with no suffix (an ad-hoc gen, a STEP-1 identity card) assembles exactly as before
    step1 = k.prompt_for("environment", "A neutral reference figure.")
    assert step1 == k.desc_style + "\n\nA neutral reference figure.", step1


# --- malformed declarations hard-error rather than dropping the clause ---------------------------
def test_malformed_figures_hard_error():
    for bad in (["the clerk"], {"anon_fg": ["x"]}, {"anon_foreground": "the clerk"},
                {"crowd": "yes"}):
        try:
            figures_expansion(bad, CROWD_RIG)
        except SystemExit:
            pass
        else:
            assert False, f"malformed figures accepted: {bad!r}"


def test_resolution_tier_default_is_the_era_register():
    """1K is the DEFAULT again (2026-08-05 era restoration): the poyais board — the register this
    channel is judged against — sent no `imageSize` at all, i.e. 1K. At 2K the same "medium-thick"
    instruction renders a proportionally finer stroke (archaeology D6), so a 2K run is not the same
    instrument. 2K/4K stay reachable as an explicit per-run spend call."""
    assert IMAGE_SIZES == ("1K", "2K", "4K")
    assert IMAGE_SIZE_DEFAULT == "1K"


def _show():
    for label, shot, hold in (("(a) BASE shot — crowd:true", SHOT_BASE, True),
                              ("(b) DELTA shot — same stage, crowd HELD", SHOT_DELTA, True),
                              ("(c) LEGACY shot — no `figures` field", SHOT_LEGACY, True)):
        print("=" * 100)
        print(label, f"[{shot['shot_id']}]")
        print("=" * 100)
        print(_assemble(shot, hold))
        print()


def _run_all():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
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
    if "--show" in sys.argv:
        _show()
        sys.exit(0)
    sys.exit(_run_all())
