# tests/test_kb_hook_settings.py
import json, os, subprocess
from pathlib import Path
import pytest

REPO = Path(__file__).resolve().parents[1]
SETTINGS = REPO / ".claude" / "settings.json"
ECC = Path(r"C:/Users/danie/.claude/plugins/cache/ecc/ecc/2.0.0")

def test_settings_exists_and_parses():
    data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    assert "env" in data and "hooks" in data

@pytest.mark.skipif(not ECC.exists(), reason="ECC plugin not installed")
def test_all_ecc_hook_ids_disabled():
    data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    disabled = set(data["env"]["ECC_DISABLED_HOOKS"].split(","))
    ecc_hooks = json.loads((ECC / "hooks" / "hooks.json").read_text(encoding="utf-8"))
    ids = {m["id"] for evt in ecc_hooks.get("hooks", {}).values() for m in evt if "id" in m}
    assert ids <= disabled, f"missing: {ids - disabled}"

@pytest.mark.skipif(not ECC.exists(), reason="ECC plugin not installed")
def test_disabled_hook_is_skipped_by_ecc_lib():
    r = subprocess.run(
        ["node", "-e",
         "const f=require(process.argv[1]);process.exit(f.isHookEnabled('pre:bash:dispatcher',{})?1:0)",
         str(ECC / "scripts" / "lib" / "hook-flags.js")],
        env={**os.environ, "ECC_DISABLED_HOOKS": "pre:bash:dispatcher"},
        capture_output=True)
    assert r.returncode == 0, r.stderr.decode()
