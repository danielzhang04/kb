"""Behaviour tests for the LETTERING-FIDELITY laws (the Class-B guards).

Companion to test_text_supply_check.py, which covers Class A (a prompt names a
text element and never supplies its value). fc03482 recorded Class B — the
garbled renders CHECKIG, 1,44.27, YOU NAME — as "a rendering fault, not an
authoring one". Measuring the Wells Fargo shot list against the Poyais reference
implementation shows that is wrong for at least two of the three, and that the
authoring mechanism is mechanically detectable. These are those checks.

Same discipline as the Class-A suite: every prompt string is REAL, lifted from
channels/the-second-take/videos/{2026-07-19-wells-fargo,2026-07-04-poyais}/, and
the engine's actual rendered output is recorded on each FLAG case. The CLEAN
cases carry equal weight — these guards run over a 119-shot file, and one that
fires on correct prompts gets switched off.
"""
import pytest

from lint_shots import (
    carried_literal_check,
    control_leak_check,
    numeral_form_check,
    quoted_literals,
    word_cap_check,
)

SUFFIX = (
    "Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick #241a12 "
    "outline, flat cel with soft shading and depth; marker lettering only; locked palette plus "
    "the single red accent #d7402b used only semantically; no photorealism, no on-screen "
    "narrator, no unrequested text, no logos; 16:9."
)


def _hard(fn, *args):
    out = []
    fn("t", *args, out)
    return out


# ===========================================================================
# (1) CARRIED-FORWARD LITERAL RE-STATED AS A DESCRIPTION  — the CHECKIG defect
# ===========================================================================
# The real household delta chain. L11 established 'CHECKING'; L13 and L14 added
# their own labels and re-quoted correctly; L12 alone referred back to the
# established literal in lowercase prose. L11/L13/L14 rendered their lettering
# correctly and L12 rendered `CHECKIG`. That is the whole finding, and this
# fixture is the four real prompts.
HOUSEHOLD_CHAIN = [
    {"id": "L11", "stage": "household", "stage_role": "base", "still_prompt":
     "A clean cutaway of a single suburban house, one ordinary anonymous customer standing "
     "inside it, and ONE product icon beside them: a checking-account passbook on a small "
     "marker card labelled 'CHECKING'. " + SUFFIX},
    {"id": "L12", "stage": "household", "stage_role": "delta", "still_prompt":
     "The SAME cutaway house held from the prior frame, now with a credit-card icon added on a "
     "small marker card labelled 'CARD' beside the checking passbook. Everything else held. "
     + SUFFIX},
    {"id": "L13", "stage": "household", "stage_role": "delta", "still_prompt":
     "The SAME cutaway house held, now with a coin savings-jar added on a small marker card "
     "labelled 'SAVINGS' beside the others. Everything else held. " + SUFFIX},
    {"id": "L14", "stage": "household", "stage_role": "delta", "still_prompt":
     "The SAME cutaway house held, now with a small login-screen icon added on a marker card "
     "labelled 'ONLINE'. Everything else held. " + SUFFIX},
]


def test_lowercased_carried_literal_is_flagged():
    """L12's 'the checking passbook' — the frame that rendered CHECKIG."""
    hits = _hard(carried_literal_check, HOUSEHOLD_CHAIN, SUFFIX)
    assert len(hits) == 1, hits
    assert "L12" in hits[0]
    assert "'CHECKING'" in hits[0]


def test_the_three_correctly_authored_siblings_are_clean():
    """L11/L13/L14 rendered clean and must not be flagged — if they were, the
    check would be flagging the chain rather than the defect."""
    # Match on the REPORTED SHOT ID ("[t] L13 (stage ...") — a substring search would
    # hit the explanatory prose, which names L11/L13/L14 as the clean siblings.
    hits = _hard(carried_literal_check, HOUSEHOLD_CHAIN, SUFFIX)
    flagged = {h.split("] ", 1)[1].split(" ", 1)[0] for h in hits}
    assert flagged == {"L12"}, hits


def test_verbatim_caps_reference_is_not_a_downgrade():
    """The real fines-stack chain. L78's 'stacked on top of the CFPB slab' repeats
    the literal character-for-character, so no glyph is being reconstructed — and
    Round 4 rated L77-L80 the strongest sequence in the video. Case is the
    discriminator between a downgrade and a plain cross-reference; without this
    the check flags clean frames."""
    chain = [
        {"id": "L77", "stage": "fines-stack", "stage_role": "base", "still_prompt":
         "A first heavy fine slab dropped in front of the bank, marker-lettered 'CFPB' with "
         "'$100M' on its face. " + SUFFIX},
        {"id": "L78", "stage": "fines-stack", "stage_role": "delta", "still_prompt":
         "The SAME fine pile held, now a second slab marker-lettered 'OCC' with '$35M' stacked "
         "on top of the CFPB slab. Everything else held. " + SUFFIX},
    ]
    assert _hard(carried_literal_check, chain, SUFFIX) == []


def test_literal_reference_that_supplies_its_own_value_is_clean():
    """'a marker card labelled "ONLINE"' must not trip the established literal
    'CARD' just because the word `card` is the substrate for a different value."""
    chain = [
        {"id": "A", "stage": "s", "stage_role": "base", "still_prompt":
         "a small marker card labelled 'CARD'. " + SUFFIX},
        {"id": "B", "stage": "s", "stage_role": "delta", "still_prompt":
         "now a marker card labelled 'ONLINE' added. " + SUFFIX},
    ]
    assert _hard(carried_literal_check, chain, SUFFIX) == []


def test_check_does_not_span_separate_stages():
    """A hard cut to a new scene inherits no lettering — a literal established in
    an unrelated earlier stage must not haunt it."""
    shots = [
        {"id": "A", "stage": "one", "stage_role": "base", "still_prompt":
         "a card labelled 'CHECKING'. " + SUFFIX},
        {"id": "B", "stage": "two", "stage_role": "base", "still_prompt":
         "a totally different scene, a checking hall. " + SUFFIX},
    ]
    assert _hard(carried_literal_check, shots, SUFFIX) == []


def test_recased_requote_is_still_a_supplied_value():
    """An author who re-letters an established string in a different case has still
    SUPPLIED every glyph — the engine copies what is in the quotes. Only the
    quoted-here test can excuse this one (the case test cannot, by construction),
    which is what keeps the two excuses from collapsing into each other."""
    chain = [
        {"id": "A", "stage": "s", "stage_role": "base", "still_prompt":
         "a marker card labelled 'SAVINGS'. " + SUFFIX},
        {"id": "B", "stage": "s", "stage_role": "delta", "still_prompt":
         "the same card, its label re-lettered 'Savings' in title case. " + SUFFIX},
    ]
    assert _hard(carried_literal_check, chain, SUFFIX) == []


def test_short_literals_are_not_tracked():
    """'OCC' is a real Wells Fargo literal (L78). Three-character strings collide
    with ordinary prose far too often to chase across a chain, so they are
    deliberately out of scope — a precision trade, pinned here so it stays a
    decision rather than drifting into an accident."""
    chain = [
        {"id": "A", "stage": "s", "stage_role": "base", "still_prompt":
         "a slab marker-lettered 'OCC'. " + SUFFIX},
        {"id": "B", "stage": "s", "stage_role": "delta", "still_prompt":
         "another slab stacked beside the occ marker. " + SUFFIX},
    ]
    assert _hard(carried_literal_check, chain, SUFFIX) == []


def test_standalone_shots_with_no_stage_are_not_chained():
    shots = [
        {"id": "A", "still_prompt": "a card labelled 'CHECKING'. " + SUFFIX},
        {"id": "B", "still_prompt": "an unrelated checking hall. " + SUFFIX},
    ]
    assert _hard(carried_literal_check, shots, SUFFIX) == []


# ===========================================================================
# (2) PROMPT-CONTROL VOCABULARY LEAKING INTO THE ARTWORK
# ===========================================================================
def test_rig_form_is_flagged():
    """L100's prompt said 'hold ONLY the rig form.' and the engine lettered a
    document `rig form` in lowercase italic serif."""
    p = ("The regulator figures turning away from the bank building. Anonymous base-rig "
         "officials (round heads, no noses/ears, four-digit hands); hold ONLY the rig form. "
         + SUFFIX)
    hits = _hard(control_leak_check, [("L100", "still_prompt", p)], SUFFIX)
    assert len(hits) == 1 and "rig form" in hits[0]


def test_comedy_off_is_flagged():
    """L69's 'comedy off' rendered as a cash register labelled `COMEDY OFF`
    above a toggle switch."""
    p = ("The same employee now holding a termination notice. Desaturated grey-and-cream "
         "gravity register, comedy off, one faint red 'TERMINATED' mark. " + SUFFIX)
    hits = _hard(control_leak_check, [("L69", "still_prompt", p)], SUFFIX)
    assert {"comedy off", "gravity register"} == {h.split("phrase '")[1].split("'")[0] for h in hits}


def test_rig_vocabulary_attached_to_figures_is_clean():
    """'on the CROWD RIG' and 'base-rig figures' never leaked and must stay legal —
    they are properties of a depicted body, not noun phrases naming a production
    rule. Banning the word `rig` outright would flag most of the file."""
    p = ("The background figures are on the CROWD RIG: round cream-family heads, DOT EYES, "
         "one simple mouth, NO noses, NO ears. A base-rig anonymous teller in a teal uniform. "
         + SUFFIX)
    assert _hard(control_leak_check, [("x", "still_prompt", p)], SUFFIX) == []


def test_house_style_suffix_alone_is_clean():
    assert _hard(control_leak_check, [("x", "still_prompt", SUFFIX)], SUFFIX) == []


def test_each_leaked_phrase_is_reported_once_per_prompt():
    p = "hold ONLY the rig form, and again the rig form. " + SUFFIX
    assert len(_hard(control_leak_check, [("x", "still_prompt", p)], SUFFIX)) == 1


# ===========================================================================
# (3) WORD CAP — SKILL rule 9's "1-4 words proven", now enforced
# ===========================================================================
def test_seven_word_literal_is_flagged():
    """Poyais L97's 'Official Shoemaker to the Princess of Poyais' is the single
    string in either video that exceeds the cap, and its render is a documented
    lettering defect (the manifest's serif-register drift cluster)."""
    p = ("A cobbler's shop with a hanging trade sign lettered 'Official Shoemaker to the "
         "Princess of Poyais'. " + SUFFIX)
    hits = _hard(word_cap_check, [("L97", "still_prompt", p)], SUFFIX)
    assert len(hits) == 1 and "7 words" in hits[0]


@pytest.mark.parametrize("lit", ["CHECKING", "NEW ACCOUNT", "8,000,000 ACRES",
                                 "PRODUCTS PER HOUSEHOLD", "5,300 FIRED"])
def test_literals_within_the_cap_are_clean(lit):
    p = f"a marker card labelled '{lit}'. " + SUFFIX
    assert _hard(word_cap_check, [("x", "still_prompt", p)], SUFFIX) == []


def test_as_simile_is_not_measured_as_lettering():
    """L105 quoted a CHARACTERISATION — 'proof the bank was the best' — not a
    string to letter. The Class-A guard already excludes as-similes from counting
    as a supplied value; the cap must use the same notion of an authored string,
    or the two checks disagree about what text even is."""
    p = ("a banker presenting the scorecard to investors as 'proof the bank was the best'. "
         + SUFFIX)
    assert _hard(word_cap_check, [("L105", "still_prompt", p)], SUFFIX) == []


def test_quoted_literals_skips_the_house_style_suffix():
    """The suffix rides on EVERY prompt and legitimately quotes strings — the real
    Wells Fargo one ends 'no unrequested text beyond \'NORWEST\''. Measuring it as
    authored lettering would report the same violation on all 119 shots."""
    suffix = (SUFFIX[:-5] + ", no unrequested text beyond 'THE LONGEST BANNER IN THE FRAME'; 16:9.")
    assert quoted_literals(suffix, suffix) == []
    assert _hard(word_cap_check, [("x", "still_prompt", suffix)], suffix) == []


# ===========================================================================
# (4) NUMERAL FORM — advisory, and deliberately so
# ===========================================================================
def test_multi_separator_numeral_raises_a_headsup():
    p = "a deed face marker-lettered '8,000,000 ACRES'. " + SUFFIX
    soft = []
    numeral_form_check("t", [("L19", "still_prompt", p)], SUFFIX, soft)
    assert len(soft) == 1 and "8,000,000" in soft[0]


@pytest.mark.parametrize("lit", ["$5.4 MILLION", "565,000", "2.1M", "$1.95T", "20,000"])
def test_single_separator_numerals_are_not_even_advised_against(lit):
    """These all rendered correctly and check out against the fact ledger.
    Controlling for supply, the garble rate among digit-bearing literals is ~6%
    in Wells Fargo and ~7% in Poyais — indistinguishable. Punctuation is not the
    cause; volume is. Flagging these would be 19 false alarms for no defect."""
    p = f"a slab marker-lettered '{lit}'. " + SUFFIX
    soft = []
    numeral_form_check("t", [("x", "still_prompt", p)], SUFFIX, soft)
    assert soft == []


def test_numeral_form_writes_to_soft_not_hard():
    """The restraint is the point: this one is advice. It is wired to the `soft`
    list in main(); if it is ever promoted to HARD that should follow a changed
    measurement, not a tidy-looking rule."""
    p = "a deed marker-lettered '8,000,000 ACRES'. " + SUFFIX
    hard, soft = [], []
    numeral_form_check("t", [("x", "still_prompt", p)], SUFFIX, soft)
    assert soft and hard == []
