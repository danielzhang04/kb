# tests/test_context_lifecycle_inert.py
"""Acceptance guard for the U7/U8 hook family after project-frame arming (2026-09-11).

Three of these files are now ARMED (regrounding_hook.js, context_lifecycle_pre_compact.js,
context_lifecycle_activity_tracker.js — see docs/superpowers/specs/2026-09-11-project-frame-hooks-design.md
§3 "Armed as-is" / "Settings change"). Two remain INERT: context_lifecycle_session_start.js
(project_frame_session_start.js now owns SessionStart injection) and the lib file
context_store.js (never itself a registered command). This file's job shifts from "prove
nothing is armed" to "prove exactly the right split holds".
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOKS = REPO / "scripts" / "hooks"
SETTINGS = REPO / ".claude" / "settings.json"

REGROUNDING = HOOKS / "regrounding_hook.js"
PRE_COMPACT = HOOKS / "context_lifecycle_pre_compact.js"
ACTIVITY_TRACKER = HOOKS / "context_lifecycle_activity_tracker.js"
SESSION_START_STILL_INERT = HOOKS / "context_lifecycle_session_start.js"
CONTEXT_STORE_LIB = HOOKS / "lib" / "context_store.js"

ARMED = [REGROUNDING, PRE_COMPACT, ACTIVITY_TRACKER]
STILL_INERT = [SESSION_START_STILL_INERT, CONTEXT_STORE_LIB]
FAMILY = ARMED + STILL_INERT


def _settings():
    return json.loads(SETTINGS.read_text(encoding="utf-8"))


def _command_for(path: Path) -> str:
    return f'node "C:/Users/danie/kb/scripts/hooks/{path.name}"'


def _entries(data, event):
    """Flatten every {matcher, command} pair registered under one event."""
    out = []
    for block in data.get("hooks", {}).get(event, []):
        for h in block.get("hooks", []):
            out.append((block.get("matcher"), h.get("command")))
    return out


def test_regrounding_hook_is_registered_exactly_once_under_each_of_its_three_events():
    data = _settings()
    cmd = _command_for(REGROUNDING)

    session_start_compact = [m for m, c in _entries(data, "SessionStart") if c == cmd]
    assert session_start_compact == ["compact"], "regrounding_hook.js must sit on SessionStart matcher=compact, exactly once"

    prompt_submit = [c for _, c in _entries(data, "UserPromptSubmit") if c == cmd]
    assert prompt_submit == [cmd]

    post_tool_use = [c for _, c in _entries(data, "PostToolUse") if c == cmd]
    assert post_tool_use == [cmd]


def test_pre_compact_hook_is_registered_exactly_once_under_pre_compact():
    data = _settings()
    cmd = _command_for(PRE_COMPACT)
    hits = [c for _, c in _entries(data, "PreCompact") if c == cmd]
    assert hits == [cmd]


def test_activity_tracker_is_registered_exactly_once_under_post_tool_use():
    data = _settings()
    cmd = _command_for(ACTIVITY_TRACKER)
    hits = [c for _, c in _entries(data, "PostToolUse") if c == cmd]
    assert hits == [cmd]


def test_still_inert_members_are_registered_nowhere():
    for settings in (REPO / ".claude").glob("settings*.json"):
        text = settings.read_text(encoding="utf-8")
        for path in STILL_INERT:
            assert path.stem not in text, (settings.name, path.stem)


def test_no_gateguard_reached_scripts_hooks_through_this_unit():
    """GateGuard is the ECC subsystem this reclaim DROPPED (`ECC_GATEGUARD: off`). No file in this
    family, armed or not, may mention it except the two pre-existing legitimate citations."""
    allowed = {HOOKS / "hard_ceiling_guard.js", HOOKS / "lib" / "destructive_classifier.js"}
    hits = {
        path
        for path in HOOKS.rglob("*")
        if path.is_file() and "gateguard" in path.read_text(encoding="utf-8", errors="replace").lower()
    }
    assert hits <= allowed
    assert not (hits & set(FAMILY))


def test_armed_members_declare_armed_and_the_rest_declare_inert():
    for path in ARMED:
        assert "ARMED" in path.read_text(encoding="utf-8"), path
    for path in STILL_INERT:
        assert "INERT" in path.read_text(encoding="utf-8"), path
