"""Tool-registry consolidation: one REGISTRY consumed by fastlane, LiveKit, and the MCP server.

These tests are the no-behavior-change contract for the V1 Task-3 refactor:
- the registry covers exactly the 5 V0 tool names;
- `anthropic_tools()` reproduces the frozen V0 `fastlane.TOOLS` literal byte-for-byte;
- `dispatch()` reproduces the old `fastlane._dispatch` behaviour (incl. the ERROR string on
  FileNotFoundError and KeyError on an unknown name);
- the LiveKit and MCP surfaces are loops over the same REGISTRY, descriptions intact.
"""
import inspect
import json

import pytest

from worker import toolreg

V0_NAMES = {"queue_summary", "read_dashboard", "read_state", "ledger_rollup", "running_work"}

# Frozen snapshot of the V0 fastlane.TOOLS literal — the refactor must not change this shape.
V0_TOOLS = [
    {"name": "queue_summary",
     "description": "Task-card queue counts + cards, optionally one state (inbox/working/done/approvals).",
     "input_schema": {"type": "object", "properties": {"state": {"type": "string"}}, "required": []}},
    {"name": "read_dashboard", "description": "Read a dashboard markdown (default: executive).",
     "input_schema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": []}},
    {"name": "read_state", "description": "Read a project's STATE.md.",
     "input_schema": {"type": "object", "properties": {"project": {"type": "string"}}, "required": ["project"]}},
    {"name": "ledger_rollup", "description": "Today's cost (USD) and activity counts.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},
    {"name": "running_work", "description": "Cards currently in 'working'.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},
]


# Task 9 added file_card / launch_workflow / credit_remaining; the 5 V0 read tools' shapes
# stay frozen (below), and they remain the first entries of the registry.
V1_ADDED = {"file_card", "launch_workflow", "credit_remaining"}


def test_registry_covers_v0_names_plus_task9():
    names = [s.name for s in toolreg.REGISTRY]
    assert set(names) == V0_NAMES | V1_ADDED
    assert len(names) == len(set(names)) == 8  # no dupes


def test_v0_read_tool_schemas_unchanged():
    """The V0 read tools keep their exact anthropic schema — Task 9 only appends new tools."""
    by_name = {t["name"]: t for t in toolreg.anthropic_tools()}
    for t in V0_TOOLS:
        assert by_name[t["name"]] == t


def test_anthropic_tools_equals_fastlane_TOOLS():
    """The re-export proof: fastlane.TOOLS is still the registry projection, unchanged in shape."""
    from worker import fastlane
    assert fastlane.TOOLS == toolreg.anthropic_tools()


def test_dispatch_queue_summary_against_fixture(kb_fixture, monkeypatch):
    monkeypatch.setenv("ATLAS_KB_ROOT", str(kb_fixture))
    out = toolreg.dispatch("queue_summary", {})
    parsed = json.loads(out)  # queue_summary returns JSON-stringified structured output
    assert parsed["counts"]["inbox"] == 1 and parsed["counts"]["working"] == 1


def test_dispatch_state_filter_against_fixture(kb_fixture, monkeypatch):
    monkeypatch.setenv("ATLAS_KB_ROOT", str(kb_fixture))
    parsed = json.loads(toolreg.dispatch("queue_summary", {"state": "working"}))
    assert set(parsed["counts"]) == {"working"} and len(parsed["cards"]) == 1


def test_dispatch_read_state_string_passthrough(kb_fixture, monkeypatch):
    monkeypatch.setenv("ATLAS_KB_ROOT", str(kb_fixture))
    out = toolreg.dispatch("read_state", {"project": "demo"})
    assert "testing" in out and not out.startswith("ERROR")


def test_dispatch_filenotfound_returns_error_string(kb_fixture, monkeypatch):
    monkeypatch.setenv("ATLAS_KB_ROOT", str(kb_fixture))
    out = toolreg.dispatch("read_state", {"project": "nope"})
    assert out.startswith("ERROR: ")


def test_dispatch_unknown_name_raises_keyerror():
    with pytest.raises(KeyError):
        toolreg.dispatch("no_such_tool", {})


def test_fastlane_dispatch_re_export(kb_fixture, monkeypatch):
    """fastlane._dispatch is a thin re-export — old callers/tests must keep working."""
    monkeypatch.setenv("ATLAS_KB_ROOT", str(kb_fixture))
    from worker import fastlane
    assert json.loads(fastlane._dispatch("queue_summary", {}))["counts"]["inbox"] == 1
    assert fastlane._dispatch("read_state", {"project": "nope"}).startswith("ERROR: ")


def test_no_module_level_livekit_import():
    """kbmcp must stay importable without livekit: toolreg imports function_tool lazily."""
    src = inspect.getsource(toolreg)
    top = [ln for ln in src.splitlines()
           if ln and not ln.startswith((" ", "\t")) and ("import livekit" in ln or "from livekit" in ln)]
    assert top == [], f"toolreg has a module-level livekit import: {top}"


def test_livekit_tools_wrap_registry():
    tools = [toolreg.livekit_tool(s) for s in toolreg.REGISTRY]
    assert [t.info.name for t in tools] == [s.name for s in toolreg.REGISTRY]
    # raw-schema tools carry the registry description + input schema verbatim to the LLM
    by_name = {t.info.name: t for t in tools}
    qs = by_name["queue_summary"].info.raw_schema
    assert qs["description"] == "Task-card queue counts + cards, optionally one state (inbox/working/done/approvals)."
    assert qs["parameters"] == {"type": "object", "properties": {"state": {"type": "string"}}, "required": []}


def test_livekit_tool_dispatches(kb_fixture, monkeypatch):
    monkeypatch.setenv("ATLAS_KB_ROOT", str(kb_fixture))
    import asyncio
    spec = next(s for s in toolreg.REGISTRY if s.name == "queue_summary")
    tool = toolreg.livekit_tool(spec)
    out = asyncio.run(tool(raw_arguments={}))
    assert json.loads(out)["counts"]["inbox"] == 1


def test_mcp_registration_is_a_registry_loop():
    from mcp.server.fastmcp import FastMCP
    app = FastMCP("kb-test")
    for spec in toolreg.REGISTRY:
        app.add_tool(toolreg.mcp_tool(spec), name=spec.name, description=spec.description)
    tools = {t.name: t for t in app._tool_manager.list_tools()}
    assert set(tools) == V0_NAMES | V1_ADDED
    # descriptions reach the (MCP client's) LLM verbatim from the registry
    assert tools["read_dashboard"].description == "Read a dashboard markdown (default: executive)."
    # per-tool parameter schemas are preserved (not a single opaque dict arg)
    assert set(tools["read_state"].parameters.get("required", [])) == {"project"}
    assert "state" in tools["queue_summary"].parameters["properties"]
    assert set(tools["queue_summary"].parameters.get("required", [])) == set()


def test_mcp_tool_callable_dispatches(kb_fixture, monkeypatch):
    monkeypatch.setenv("ATLAS_KB_ROOT", str(kb_fixture))
    spec = next(s for s in toolreg.REGISTRY if s.name == "read_state")
    fn = toolreg.mcp_tool(spec)
    assert "testing" in fn(project="demo")
