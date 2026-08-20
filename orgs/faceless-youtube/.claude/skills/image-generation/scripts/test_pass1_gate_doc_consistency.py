#!/usr/bin/env python3
"""C-1 (final fix round, 2026-08-12) — the Pass-1 gate must say ONE thing across both skills.

`image-generation`'s Pass-1 step 1 said a named character "earns a slot", and its own exemption
said a cast member minted through the standard cast-generation wave "needs no per-item human slot
of its own". `visual-prompt-writer` then promised authors, unconditionally, that any name the
registry lacks reaches the human gate. Read together the three sentences contradicted: a new cast
member was simultaneously gated and exempt, and which behaviour a run took depended on which file
its agent had loaded — the failure mode being a paid mint that stops for a ruling nobody owes, or
a ruling that never comes.

The resolution splits the two meanings the word "slot" was carrying. Every asset, cast included,
carries a PASS-1 ROW (it must exist before a shot seeds it). Only a NEW non-cast asset carries a
HUMAN RULING. This file pins that split in the prose of both skills, because prose is the whole
mechanism here — nothing in `forge.py` can enforce which sentence an author reads.

Plain asserts (this repo has no pytest dependency); collected by pytest all the same.

Run:  py -3 .claude/skills/image-generation/scripts/test_pass1_gate_doc_consistency.py
"""
import sys
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]
IMAGE_GEN = SKILLS / "image-generation" / "SKILL.md"
VPW = SKILLS / "visual-prompt-writer" / "SKILL.md"
GRAMMAR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit" / "visual-grammar.md")


def _flat(path):
    """Both SKILLs are hard-wrapped, so a sentence crosses line breaks wherever it wraps.
    Collapsing whitespace pins the WORDS, not the wrap column."""
    return " ".join(path.read_text(encoding="utf-8").split())


IMAGE_GEN_TEXT = _flat(IMAGE_GEN)
VPW_TEXT = _flat(VPW)
GRAMMAR_TEXT = _flat(GRAMMAR)


def test_the_named_cast_row_is_a_pass1_row_not_a_human_slot():
    """Step 1 states what a named character owes: an ASSET that exists before the shot seeds it."""
    assert ("A **named character** earns a Pass-1 row (an asset that must exist before the shot "
            "seeds it) even for one shot") in IMAGE_GEN_TEXT
    # the sentence that read as a human-gate promise is gone from the cast row
    assert "A **named character** earns a slot" not in IMAGE_GEN_TEXT


def test_the_cast_exemption_waives_the_RULING_and_keeps_the_ROW():
    """The exemption is about who must decide, not about what must exist — so it can no longer be
    read as licence to seed a shot off a cast frame that was never built."""
    assert "needs no human ruling of its own — it still carries a Pass-1 row." in IMAGE_GEN_TEXT
    assert "per-item human slot" not in IMAGE_GEN_TEXT
    # and everything the cast member is SEEDED with is still gated, which is the half that pays
    assert ("everything it is seeded WITH (pose, expression, plate, prop) is still listed here"
            in IMAGE_GEN_TEXT)


def test_vpw_promises_the_gate_only_for_what_the_gate_actually_rules_on():
    """VPW keeps primitives closed-world while routing a new cast identity through its own wave."""
    assert "Pose, expression, interaction, and costume are CLOSED-WORLD" in VPW_TEXT
    assert "ELEVATION — primitive needed: <act>; BLOCKED until minted + approved" in VPW_TEXT
    assert "CAST member still follows the standard cast-generation wave" in VPW_TEXT
    assert "A name the registry lacks may still be written" not in VPW_TEXT


def test_the_two_skills_agree_on_who_owes_a_human_ruling():
    """The cross-file assertion, which is the actual defect: one skill may not gate what the other
    exempts. Both must say a new cast member skips the RULING, and neither may say it skips the
    asset."""
    for text in (IMAGE_GEN_TEXT, VPW_TEXT):
        assert "cast-generation wave" in text, text[:200]
    assert "no human ruling" in IMAGE_GEN_TEXT
    assert "without a separate human slot" in VPW_TEXT


def test_the_visual_grammar_blocks_unknown_primitives_before_the_shot():
    """A missing primitive is elevated and approved outside the shot authoring path."""
    assert "write no invented token or prose pose; emit the VPW elevation flag" in GRAMMAR_TEXT
    assert "primitive is minted, approved, and registered" in GRAMMAR_TEXT


if __name__ == "__main__":
    failures = []
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except BaseException as error:
                failures.append((name, error))
                print(f"FAIL {name}: {type(error).__name__}: {error}")
    print(f"{5 - len(failures)}/5 passed")
    sys.exit(bool(failures))
