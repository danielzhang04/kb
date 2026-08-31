"""Structural validation for the docs/proposals/loops/ cadence drafts.

These are DRAFTS, not live cadences: nothing here dispatches anything. The point of the
suite is that the drafts are schema-valid against the real dispatcher before a human is
asked to land them, and that the three copies of each loop's prompt (the heartbeat block,
the loop brief, the stage-1 card) have not drifted apart.

Prompt drift is the specific hazard worth a test. promotion._cadence_matches
(promotion.py:285) compares (name, schedule, tier, risk-tier, prompt) against the block on
protected origin/main with `==` — a plain equality over the raw strings. A re-wrapped line
or a stripped space therefore does not fail loudly; it silently voids standing
authorization. So the comparison here is an EXACT string compare, with no normalization of
whitespace or blank lines.

Structure lint only — no assertion about whether the loop briefs say the *right* thing.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
import dispatch  # noqa: E402

DRAFTS = REPO_ROOT / "docs" / "proposals" / "loops"
BLOCKS = DRAFTS / "heartbeat-blocks.yaml"
README = DRAFTS / "README.md"
STAGE1 = DRAFTS / "stage1-cards.md"

EXPECTED = {
    "loop-a-hygiene": {"schedule": "daily", "risk-tier": "T1"},
    "loop-b-lesson-mining": {"schedule": "daily", "risk-tier": "T1"},
    "loop-c-agent-upgrade": {"schedule": "weekly:sat", "risk-tier": "T2"},
}
PROMPT_FILES = {
    "loop-a-hygiene": DRAFTS / "prompt-loop-a.md",
    "loop-b-lesson-mining": DRAFTS / "prompt-loop-b.md",
    "loop-c-agent-upgrade": DRAFTS / "prompt-loop-c.md",
}
REQUIRED_MARKERS = ("DONE-CRITERION", "BOUNDARIES", "wake-me", "NARRATION")

# The narration line is the one piece of every ## Result a human reads first, so its wording
# is fixed and identical across all three loops rather than left to each prompt.
NARRATION = (
    "NARRATION (mandatory): the FIRST line of ## Result is a human narration line under\n"
    "   200 characters, in exactly this shape:\n"
    '   "Hey — <what I found/learned>. <what I did>. Needs you: <what/nothing>."\n'
    "   Machine detail goes BELOW that line, never above it. A ## Result whose first line is\n"
    "   not this narration line is an incomplete run."
)


def _fenced(path: Path, language: str) -> list[str]:
    pattern = re.compile(r"```" + language + r"\n(.*?)\n```", re.DOTALL)
    return pattern.findall(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def cadences(tmp_path_factory) -> dict[str, dict]:
    """The drafted blocks, parsed by the REAL dispatcher parser.

    parse_heartbeat() reads a ```yaml fence, which is how the blocks will be embedded in
    HEARTBEAT.md. The drafts file is plain YAML, so wrap it exactly as the append would.
    """
    hb = tmp_path_factory.mktemp("loop-drafts") / "HEARTBEAT.md"
    hb.write_text(
        "# drafted blocks\n\n```yaml\n" + BLOCKS.read_text(encoding="utf-8").rstrip("\n") + "\n```\n",
        encoding="utf-8",
    )
    parsed = dispatch.parse_heartbeat(hb)
    assert parsed, "parse_heartbeat found no cadences in the drafted blocks"
    return {c["name"]: c for c in parsed}


def test_drafts_parse_through_the_real_dispatcher(cadences):
    assert set(cadences) == set(EXPECTED)


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_block_matches_the_declared_shape(cadences, name):
    cadence = cadences[name]
    assert cadence["schedule"] == EXPECTED[name]["schedule"]
    assert cadence["risk-tier"] == EXPECTED[name]["risk-tier"]
    # dispatch.run() rejects any tier outside this pair with an unknown-tier wake card.
    assert cadence["tier"] == "desktop"
    assert cadence["role"] == "work"
    assert cadence["inspect"] is True
    assert cadence["prompt"].strip()


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_routing_fields_are_registry_known(cadences, name):
    """runtime/model are dispatcher-authored routing inputs; an unknown named model makes
    routing.resolve() raise and the cadence be skipped with a wake card."""
    import routing  # noqa: PLC0415 — resolved off the same scripts/ path insert

    cadence = cadences[name]
    policy = routing.load_policy(REPO_ROOT)
    known = set(policy.get("runtimes", {}).get(cadence["runtime"], {}).get("known_models", []))
    assert cadence["runtime"] in policy.get("runtimes", {}), cadence["runtime"]
    assert cadence["model"] in known, f"{name}: {cadence['model']} not in {sorted(known)}"


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_schedule_is_one_dispatch_due_understands(cadences, name):
    """due() only fires `daily` and `weekly:<dow>`; anything else silently never runs."""
    import datetime  # noqa: PLC0415

    cadence = cadences[name]
    fired = any(
        dispatch.due(cadence, datetime.date(2026, 8, 17) + datetime.timedelta(days=offset))
        for offset in range(7)
    )
    assert fired, f"{name}: schedule {cadence['schedule']!r} never fires in a full week"


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_prompt_brief_exists_and_carries_the_discipline_markers(name):
    """Structure lint, not content review: each brief must carry a decidable done-criterion
    heading, a boundaries section, a wake-me fallback (loop-design-check discipline), and
    the narration mandate."""
    text = PROMPT_FILES[name].read_text(encoding="utf-8")
    for marker in REQUIRED_MARKERS:
        assert marker in text, f"{PROMPT_FILES[name].name}: missing {marker!r}"


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_narration_mandate_is_identical_in_every_prompt(cadences, name):
    """One wording, three loops: a narration line that varied per loop would be a format a
    reader has to re-learn every time."""
    assert NARRATION in cadences[name]["prompt"]


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_block_prompt_matches_the_brief_verbatim_block_exactly(cadences, name):
    """EXACT compare — promotion.py:285 uses ==, so no normalization is permissible here.

    The single trailing newline is a YAML block-scalar artifact of the `|` indicator, not
    content, so it is the one character removed before comparing.
    """
    fenced = _fenced(PROMPT_FILES[name], "text")
    assert len(fenced) == 1, f"{PROMPT_FILES[name].name}: expected exactly one ```text block"
    assert fenced[0] == cadences[name]["prompt"].rstrip("\n")


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_stage1_card_work_order_matches_the_block_prompt_exactly(cadences, name):
    """Each stage-1 card body carries the block prompt as its ## Work order, byte for byte,
    and leaves owner/claim-token null — dispatchers assign, agents never self-claim."""
    cards = [c for c in _fenced(STAGE1, "markdown") if f"action: cadence:{name}\n" in c]
    assert len(cards) == 1, f"stage1-cards.md: expected exactly one card for {name}"
    card = cards[0]
    assert "owner: null" in card
    assert "claim-token: null" in card
    assert f"risk-tier: {EXPECTED[name]['risk-tier']}\n" in card
    # rsplit, not split: the prompt text itself refers to "## Result", so only the LAST
    # occurrence is the card's own empty Result heading.
    work_order = card.split("## Work order\n\n", 1)[1].rsplit("\n\n## Result\n", 1)[0]
    assert work_order == cadences[name]["prompt"].rstrip("\n")


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_prompt_survives_a_yaml_round_trip_unchanged(cadences, name):
    """A block scalar is fragile: one trailing space or blank line and the re-parsed prompt
    differs from the authored one, which is drift a human would never see in a diff."""
    prompt = cadences[name]["prompt"]
    for line in prompt.splitlines():
        assert line == line.rstrip(), f"{name}: trailing whitespace in {line!r}"
        assert line.strip(), f"{name}: blank line inside the prompt block scalar"


def test_drafts_are_marked_as_proposals_not_live():
    assert "Status: PROPOSAL" in README.read_text(encoding="utf-8")
    assert "Status: PROPOSAL" in BLOCKS.read_text(encoding="utf-8")


def test_loop_c_names_its_stage_two_driver():
    """Loop C's evidence must come from the committed script, not the model's reading of
    the ledger; the prompt has to actually invoke it."""
    assert (REPO_ROOT / "scripts" / "agent_track_record.py").exists()
    assert "scripts/agent_track_record.py" in PROMPT_FILES["loop-c-agent-upgrade"].read_text(
        encoding="utf-8")
