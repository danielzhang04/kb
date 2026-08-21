import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import forge

KIT = Path(__file__).resolve().parents[4] / "channels" / "the-second-take" / "visual-kit"


def test_content_triggered_rig_hold():
    assert forge.should_hold("environment", [], "A clerk raises one hand.")
    assert forge.should_hold("environment", ["/refs/member/member.png"], "A quiet office.")
    assert not forge.should_hold("environment", [], "An empty records room.")


def test_crowd_declaration_is_the_only_figure_transport():
    assert forge._fig_declared({"crowd": True}) is True
    assert forge._fig_declared({"crowd": False}) is False
    with pytest.raises(SystemExit, match="unknown key"):
        forge._fig_declared({"unexpected": ["clerk"]})


def test_prompt_assembly_ends_on_the_authored_payload():
    prompt = forge.assemble_prompt("DESCRIPTOR", "PAYLOAD", "CROWD", "RIG")
    assert prompt == "DESCRIPTOR\n\nCROWD\n\nRIG\n\nPAYLOAD"
    assert prompt.endswith("PAYLOAD")


def test_bible_descriptor_is_readable():
    kit = forge.Kit(str(KIT), dry=True)
    assert kit.desc_style.startswith("Draw in the SAME art style")


def test_step1_prompt_ends_on_its_authored_delta():
    kit = forge.Kit(str(KIT), dry=True)
    delta = "A new named cast member in a plain studio card."
    prompt = kit.prompt_for("new_character", delta)
    assert prompt.endswith(delta)


def test_live_kit_expands_the_bible_crowd_clause():
    bible = (KIT / "style-bible.md").read_text(encoding="utf-8")
    expected = forge.blockquote_after(bible, "CROWD-RIG clause")
    kit = forge.Kit(str(KIT), dry=True)
    prompt = kit.prompt_for(mode="environment", delta="",
                            figures={"crowd": True})
    assert expected
    assert kit.desc_crowdrig == expected
    assert expected in prompt
    assert prompt.endswith(expected)
