import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import forge

KIT = Path(__file__).resolve().parents[4] / "channels" / "the-second-take" / "visual-kit"


def _kit():
    kit = forge.Kit(str(KIT), dry=True)
    kit.root = str(KIT.parents[2])
    return kit


def test_closed_world_tokens_resolve_against_registry():
    kit = _kit()
    assert forge.unresolved_closed_world(kit.reg, "A face holds `expr-smug`.") == []
    assert forge.unresolved_closed_world(kit.reg, "A face holds `expr-not-real`.") == [
        "expr-not-real"]


def test_text_bearing_detects_supplied_literal_not_possessive_apostrophe():
    assert forge.text_bearing("A sign reads 'SOLD'.")
    assert not forge.text_bearing("The banker's desk is empty.")


def test_lettering_exemplar_is_registered():
    asset = {a["name"]: a for a in _kit().reg["assets"]}["lettering-marker-italic"]
    assert asset["kind"] == "environment"


def test_handshake_remains_factual_interaction_vocabulary():
    asset = {a["name"]: a for a in _kit().reg["assets"]}["handshake"]
    assert asset["kind"] == "interaction"
