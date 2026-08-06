"""Task 5.4 — shape test for .codex/config.toml (Wave 5, m1-fleet).

Some of the key NAMES in .codex/config.toml are this worker's best-effort
reconstruction of the Codex CLI schema (flagged inline in the file itself and
at HUMAN GATE 5.0/5.7 — see docs/plans/2026-07-16-m1-fleet-implementation.md
and docs/specs/2026-07-16-m1-fleet-architecture.md D3/O8) because no Codex
config reference exists anywhere in this repo. This test therefore asserts
TEXTUAL/STRUCTURAL invariants that survive a future key-name correction —
e.g. "auth.json appears in a deny/exclude context" rather than "the key is
named exactly `sandbox_workspace_write.deny.paths`" — plus the one hard fact
that must never regress regardless of key names: the file exists, parses as
valid TOML, and never contains a literal credential value.
"""
import re
import tomllib
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[1] / ".codex" / "config.toml"


def _text() -> str:
    return CONFIG.read_text(encoding="utf-8")


def _data() -> dict:
    with CONFIG.open("rb") as f:
        return tomllib.load(f)


def test_config_exists_and_parses_as_toml():
    assert CONFIG.exists(), ".codex/config.toml must exist"
    data = _data()  # raises tomllib.TOMLDecodeError if malformed
    assert isinstance(data, dict) and data, "config must parse to a non-empty table"


def test_workspace_write_sandbox_posture_present():
    text = _text()
    data = _data()

    # Textual invariant: "workspace-write" must appear somewhere as a
    # configured value, regardless of which key holds it.
    assert "workspace-write" in text, (
        "config must declare a workspace-write sandbox posture somewhere"
    )

    # Structural invariant: whatever the top-level key turns out to be named,
    # a workspace-write-shaped mode value must be assigned to *some* scalar
    # key at the top level (not merely mentioned in a comment).
    top_level_scalars = {k: v for k, v in data.items() if isinstance(v, str)}
    assert any("workspace-write" in v for v in top_level_scalars.values()), (
        "a top-level (non-comment) key must be assigned the value "
        "'workspace-write' — found top-level string keys: "
        f"{top_level_scalars}"
    )

    # Never the dangerous full-access mode as the configured default.
    assert not re.search(r'sandbox_mode\s*=\s*"danger-full-access"', text), (
        "must not default to a danger-full-access sandbox mode"
    )


def test_conservative_approval_policy_present():
    """The config's policy governs INTERACTIVE codex and stays conservative here;
    the dispatch lane (scripts/codex_dispatch.py) pins `approval_policy=never`
    per-command because `codex exec` cannot serve an approval prompt at all —
    every file_change under an asking policy just fails — and the
    workspace-write sandbox, not the prompt, is that lane's boundary.
    """
    text = _text()
    data = _data()

    assert "approval_policy" in text, "an approval_policy key must be present"
    # Whatever the exact enum spelling, it must not be the no-approval /
    # fully-autonomous extreme.
    assert re.search(r'approval_policy\s*=\s*"[^"]+"', text), (
        "approval_policy must be set to a string value"
    )
    policy_value = data.get("approval_policy")
    assert policy_value is not None, "approval_policy must be a top-level key"
    assert policy_value not in ("never", "full-auto", "auto", "always"), (
        f"approval_policy={policy_value!r} reads as a fully-autonomous / "
        "never-ask posture, not conservative"
    )


def test_network_disabled_by_default():
    text = _text()
    data = _data()

    # Structural: find network_access (or a network-shaped key) anywhere in
    # the parsed tree and assert it is false, wherever it's nested.
    def _find_network_flags(node, path=""):
        found = []
        if isinstance(node, dict):
            for k, v in node.items():
                key_path = f"{path}.{k}" if path else k
                if "network" in k.lower() and isinstance(v, bool):
                    found.append((key_path, v))
                else:
                    found.extend(_find_network_flags(v, key_path))
        return found

    network_flags = _find_network_flags(data)
    assert network_flags, (
        "no boolean network-access-shaped key found anywhere in the config; "
        f"raw text:\n{text}"
    )
    for key_path, value in network_flags:
        assert value is False, f"{key_path} must default to false (network OFF)"

    # Also require an explicit textual comment establishing "OFF by default"
    # intent, so a future edit that flips the bool without updating the
    # rationale gets caught in review.
    assert re.search(r"network.{0,40}off.{0,20}default", text, re.IGNORECASE), (
        "config must document the network-off-by-default intent in prose"
    )


def test_deny_rules_cover_credential_store_paths():
    text = _text()

    # auth.json itself.
    assert "auth.json" in text, ".codex/auth.json must appear in the config"
    assert re.search(r"auth\.json", text) and _in_deny_context(text, "auth.json"), (
        "auth.json must appear in a deny/exclude context, not just anywhere"
    )

    # Claude Code's own credential/session store.
    assert ".claude" in text, "~/.claude/ must appear in the config"
    assert _in_deny_context(text, ".claude"), (
        "~/.claude/ must appear in a deny/exclude context"
    )

    # SSH private keys (incl. the Phase-A/B git-transport deploy key).
    assert ".ssh" in text, "~/.ssh/ must appear in the config"
    assert _in_deny_context(text, ".ssh"), (
        "~/.ssh/ must appear in a deny/exclude context"
    )


def _in_deny_context(text: str, needle: str, window: int = 400) -> bool:
    """True if ANY occurrence of `needle` appears within `window` chars of a
    deny/exclude marker.

    Deliberately loose (substring + nearby keyword) rather than tied to any
    specific TOML table name, since the exact key name housing these paths is
    flagged as unverified in the file itself. Checks every occurrence (not
    just the first) because a path may also be mentioned in prose — e.g. the
    file header — before its load-bearing appearance inside the actual
    deny/exclude table.
    """
    lower = text.lower()
    needle_lower = needle.lower()
    start = 0
    while True:
        idx = lower.find(needle_lower, start)
        if idx == -1:
            return False
        window_start = max(0, idx - window)
        window_end = min(len(text), idx + window)
        context = lower[window_start:window_end]
        if any(marker in context for marker in ("deny", "exclude")):
            return True
        start = idx + 1


def test_env_var_passthrough_excludes_telegram_bot_token():
    text = _text()

    # The desktop poll cadence's ambient bot-token env var name
    # (the retired desktop poll launcher) must never be allowed to pass through to a
    # spawned Codex subprocess.
    assert "KB_TELEGRAM_BOT_TOKEN" in text, (
        "KB_TELEGRAM_BOT_TOKEN must be named in an env exclusion rule"
    )
    assert _in_deny_context(text, "KB_TELEGRAM_BOT_TOKEN") or re.search(
        r"exclude", text, re.IGNORECASE
    ), "KB_TELEGRAM_BOT_TOKEN must appear in an exclude-shaped context"

    # Never a literal Telegram bot token value (numeric-id:secret shape).
    assert not re.search(r"[0-9]{6,}:[A-Za-z0-9_-]{30,}", text), (
        "config must never contain a literal Telegram bot token"
    )


def test_uncertain_keys_are_flagged_for_human_gate_verification():
    text = _text()

    assert "FLAG" in text, (
        "uncertain Codex config key names must be flagged inline in the file"
    )
    assert re.search(r"5\.0", text) and re.search(r"5\.7", text), (
        "the file must point at HUMAN GATE 5.0 and 5.7 for key-name verification"
    )
