"""Behaviour tests for the SUPPLIED-TEXT law (lint_shots.text_supply_check).

Every prompt string below is REAL — lifted verbatim from
channels/the-second-take/videos/2026-07-19-wells-fargo/, the documentary about a
real, named, living person where this defect put an invented criminal charge and
~20 other fabricated facts on screen. The engine's actual output is recorded in
the FLAG cases, because the point of this check is not "a regex matched" but
"this exact sentence made a diffusion model make a fact up".

The CLEAN cases matter just as much: a lint that fires on correctly-authored
prompts gets switched off, and an earlier cut of this check flagged 69 of the
file's 119 shots.
"""
import pytest

from lint_shots import unsupplied_text_requests

SUFFIX = (
    "Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm "
    "brown-black (#241a12) outline on everything, flat cel colours; any in-world lettering "
    "hand-lettered in the marker style, short and legible; no unrequested text, no logos; 16:9."
)


# --- FLAG: the prompt names a text element and never supplies its value -------
FLAG = [
    pytest.param(
        "A single heavy round dark boulder with a large marker scorecard number painted on its "
        "face, clean side profile.",
        id="L31-cutout-engine-rendered-1"),
    pytest.param(
        "Register shift to a clean marker-drawn dashboard: all those product icons feed into a "
        "single big boxed scorecard figure - a hand-lettered 'PRODUCTS PER HOUSEHOLD' label over "
        "one prominent number.",
        id="L16-engine-rendered-3.5-despite-a-nearby-quote"),
    pytest.param(
        "A steep slope: a heavy round boulder marked with the scorecard number rolls DOWNHILL from "
        "a scorecard perched at the top, past small executive figures who step aside.",
        id="L31-still-would-reseed-the-bug-on-any-regen"),
    pytest.param(
        "The SAME counter held, now a fresh account-opening form lies on it, a customer's name "
        "marker-written across the top and a small 'NEW ACCOUNT' tab - opened without the customer.",
        id="L34-invented-name-rendered-as-YOU-NAME"),
    pytest.param(
        "At a bank counter, a banker figure has turned his back on a waiting customer to reach up "
        "and crank a giant scorecard number higher - serving the metric, not the person.",
        id="L30-giant-scorecard-number"),
    pytest.param(
        "The whole bank still chasing one enormous glowing scorecard number floating above them.",
        id="L116-enormous-glowing-number"),
    pytest.param(
        "Tolstedt on a stage presenting the big cross-sell scorecard number to a row of investor "
        "figures as 'proof the bank was the best', a marker banner overhead.",
        id="L105-adjacent-quote-is-a-simile-not-the-value"),
]


@pytest.mark.parametrize("prompt", FLAG)
def test_unsupplied_value_is_flagged(prompt):
    assert unsupplied_text_requests(prompt + " " + SUFFIX, SUFFIX), (
        "this prompt tells the engine to render glyphs and never says which — "
        "it MUST be caught before generation")


# --- CLEAN: correctly-authored prompts the check must leave alone -------------
CLEAN = [
    pytest.param(
        "A single heavy round dark boulder in clean side profile, with the single marker numeral "
        "'8' painted LARGE on its face in the locked red accent #d7402b.",
        id="L31-cutout-repaired-value-adjacent"),
    pytest.param(
        "A heavy red block-capital rubber stamp reading 'ADMITTED', dense saturated red ink, "
        "isolated on one solid uniform FLAT magenta background.",
        id="L44-stamp-reading-quoted-value"),
    pytest.param(
        "An OCC order barring a bank CEO: a marker header 'OCC' on a banking license with a fine "
        "figure '$17.5M' beside it, the license face otherwise clear with NO stamp on it.",
        id="L101-two-values-both-supplied"),
    pytest.param(
        "Three marker numerals in a row on a slate field - a crossed-out '7', a big glowing '8' in "
        "the middle, and a crossed-out '10' - why eight, and not seven or ten.",
        id="L23-values-supplied-just-a-little-downstream"),
    pytest.param(
        "The whole trick captured as one deadpan label: a big hand-lettered marker word 'PINNING' "
        "stamped across a folder.",
        id="L39-colon-then-value"),
    pytest.param(
        "A clean marker recipe-card infographic assembling three labelled ingredients into one "
        "bowl: 'IMPOSSIBLE TARGET', 'BONUS', and 'TOLERANCE FOR FIRING'.",
        id="L66-list-of-supplied-values"),
    pytest.param(
        "A courtroom docket with a single blank name line and everything else empty, a big baked "
        "caption 'ONE PERSON WAS CHARGED' across the top.",
        id="short05-deliberately-blank-is-an-authored-choice"),
    pytest.param(
        "On a bright stage, a proud banker figure presents a big marker placard reading "
        "'CROSS-SELLING' to a row of seated bare-headed investor figures who lean in.",
        id="L10-bare-headed-is-not-a-text-verb"),
    pytest.param(
        "A money bag being clawed back with a marker tag '$67M' and a small 'TOLSTEDT' label.",
        id="L99-plate-every-element-carries-its-own-value"),
    # The three FALSE POSITIVES the 2026-07-28 bricks pipe test hit (fragments recorded
    # verbatim in that video's pipe-test-log.md, F-4). All three cost an author a rewrite
    # of a correctly-authored prompt, which is exactly how a lint loses its credibility.
    pytest.param(
        "A stack of sealed kraft cartons with one carton pulled out, the opening reading as a "
        "hole punched in the wall of boxes, cold overhead light.",
        id="bricks-L07-reading-AS-is-the-legibility-idiom"),
    pytest.param(
        "An auditor figure in half-moon reading glasses looking down at a clipboard, "
        "arms-crossed appraisal, warm desk lamp.",
        id="bricks-L148-reading-glasses-is-an-object-not-a-text-verb"),
    pytest.param(
        "A supermarket aisle end-cap seen wide, one red price rail running along the shelf edge, "
        "the shelves themselves empty.",
        id="bricks-L84-price-modifies-rail-nothing-is-lettered"),
]


@pytest.mark.parametrize("prompt", CLEAN)
def test_supplied_value_is_not_flagged(prompt):
    assert unsupplied_text_requests(prompt + " " + SUFFIX, SUFFIX) == [], (
        "this prompt supplies its values — flagging it trains authors to ignore the lint")


# --- the specific discriminations the implementation turns on -----------------

def test_possessive_apostrophe_is_not_a_quote():
    """"a customer's name ... and a small 'NEW ACCOUNT' tab" — the possessive
    apostrophe once paired with the next real quote to form a phantom literal
    that cleared the unsupplied name."""
    hits = unsupplied_text_requests(
        "a customer's name marker-written across the top and a small 'NEW ACCOUNT' tab", SUFFIX)
    assert hits, "possessive apostrophe must not count as a supplied value"


def test_coordinator_blocks_borrowing_a_neighbours_value():
    """Same distance, opposite verdicts: only the coordinator separates them."""
    assert unsupplied_text_requests(
        "a big marker number lettered on the wall and a small 'EXIT' sign beside it", SUFFIX)
    assert unsupplied_text_requests(
        "a big marker number lettered on the wall, the figure '8' filling it", SUFFIX) == []


def test_as_simile_is_not_a_supplied_value():
    assert unsupplied_text_requests(
        "presenting the big scorecard number as 'proof the bank was best'", SUFFIX)


def test_house_style_suffix_alone_is_clean():
    """The suffix says 'any in-world lettering hand-lettered in the marker style'.
    Scanning it would flag every prompt in every file identically."""
    assert unsupplied_text_requests(SUFFIX, SUFFIX) == []


def test_absence_instruction_is_not_a_request():
    assert unsupplied_text_requests(
        "a settlement document, the face otherwise clear with NO stamp on it", SUFFIX) == []


def test_schema_worked_example_no_longer_teaches_the_defect():
    """Regression pin from the retired shots-schema worked example (the §6
    exemplar, deleted in the 2026-07-28 trim). It once read "a single
    load-bearing calculation carved into a monolithic stone tablet" — a
    value-free text request, modelled as good practice. Both halves stay
    pinned: the old form must FAIL, the corrected form must PASS. (Catching
    the old form is why `calculation` and `carved` are in the vocabularies.)"""
    old = ("a single load-bearing calculation carved into a monolithic stone tablet "
           "balanced on a knife-edge, cold blue key light")
    new = ("a monolithic stone tablet with the single figure '2,800 TONS' carved into its "
           "face, balanced on a knife-edge, cold blue key light")
    assert unsupplied_text_requests(old, SUFFIX), "the old exemplar must be caught"
    assert unsupplied_text_requests(new, SUFFIX) == [], "the shipped exemplar must be clean"


def test_incised_lettering_verbs_are_text_verbs():
    """carved / etched / embossed put glyphs on a surface exactly as painted does.
    Pinned separately because these phrasings carry no emphasis word, so the SLOT
    grammar never sees them — the RENDER-VERB grammar is the only thing catching
    "a plaque with the date etched into it"."""
    for verb in ("carved", "etched", "embossed", "chiselled"):
        assert unsupplied_text_requests(
            f"a stone plaque with the date {verb} into its face, cold key light", SUFFIX), verb
    assert unsupplied_text_requests(
        "a stone plaque with the date '1907' carved into its face, cold key light", SUFFIX) == []


def test_a_text_noun_used_attributively_is_not_a_request():
    """"one red price rail" — the count and the colour belong to the RAIL; `price`
    only says what the rail is for. The staged-focal-value shape the SLOT grammar
    hunts needs the text noun to END its phrase, which is what separates these two."""
    assert unsupplied_text_requests("one red price rail along the shelf edge", SUFFIX) == []
    assert unsupplied_text_requests("one red price painted along the shelf edge", SUFFIX)


def test_bare_reading_is_still_a_text_verb_when_it_introduces_lettering():
    """The two `reading` exclusions must not gut the verb itself: "a stamp reading
    <nothing>" is the original defect and stays HARD."""
    assert unsupplied_text_requests("a rubber stamp reading across the invoice face", SUFFIX)
    assert unsupplied_text_requests("a rubber stamp reading 'PAID' across the invoice face",
                                    SUFFIX) == []


def test_reading_eyewear_exemption_keeps_text_requests_intact():
    """Eyewear compounds are objects; bare `reading` remains a supplied-text verb."""
    assert unsupplied_text_requests(
        "an auditor in full-rim reading spectacles low on the nose, inspecting a clipboard", SUFFIX) == []
    assert unsupplied_text_requests("a placard reading 'SOLD' beside the door", SUFFIX) == []
    assert unsupplied_text_requests("a sign reading beside the door", SUFFIX)


def test_text_supply_check_reports_id_field_and_excerpt():
    hard = []
    from lint_shots import text_supply_check
    text_supply_check("long-form",
                      [("L31", "still_prompt", "a boulder marked with the scorecard number rolls on")],
                      SUFFIX, hard)
    assert len(hard) == 1
    assert "L31" in hard[0] and "still_prompt" in hard[0]
    assert "scorecard number" in hard[0], "the message must quote the offending text"
