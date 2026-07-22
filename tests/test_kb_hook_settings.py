# tests/test_kb_hook_settings.py
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SETTINGS = REPO / ".claude" / "settings.json"
ECC_HOOK_FIXTURE = REPO / "tests" / "fixtures" / "ecc-2.0.0-hook-ids.json"
ECC_2_0_0_HOOKS_SHA256 = "a00e4c71051b067f0ee12613b3f575a06517b857808a22ffb7be4f981f0d82c4"


def load_ecc_hook_fixture():
    fixture = json.loads(ECC_HOOK_FIXTURE.read_text(encoding="utf-8"))
    assert fixture["fixture_version"] == 1
    provenance = fixture["provenance"]
    assert provenance["ecc_version"] == "2.0.0"
    assert provenance["source"] == "hooks/hooks.json"
    assert re.fullmatch(r"[0-9a-f]{64}", provenance["hooks_sha256"])
    assert provenance["hooks_sha256"] == ECC_2_0_0_HOOKS_SHA256
    hook_ids = fixture["hook_ids"]
    assert len(hook_ids) == 29
    assert len(set(hook_ids)) == len(hook_ids)
    return set(hook_ids)

def test_settings_exists_and_parses():
    data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    assert "env" in data and "hooks" in data

def test_all_ecc_hook_ids_disabled():
    data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    disabled = set(data["env"]["ECC_DISABLED_HOOKS"].split(","))
    fixture_ids = load_ecc_hook_fixture()
    assert fixture_ids <= disabled, f"missing: {fixture_ids - disabled}"

def test_ecc_suppression_compatibility_contract():
    env = json.loads(SETTINGS.read_text(encoding="utf-8"))["env"]
    assert env["ECC_GATEGUARD"] == "off"
    assert "pre:bash:dispatcher" in set(env["ECC_DISABLED_HOOKS"].split(","))
