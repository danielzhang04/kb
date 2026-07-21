"""Single source of truth for Atlas's kb tools.

One `REGISTRY` of `ToolSpec`s consumed by three surfaces so a new tool is a one-place edit:

  - the fastlane Anthropic tool-use loop  -> `anthropic_tools()` + `dispatch()`
  - the LiveKit voice worker              -> `livekit_tool()` (raw-schema wrappers)
  - the kb-MCP stdio server               -> `mcp_tool()` (typed wrappers for FastMCP)

Each `ToolSpec.fn` takes the parsed argument dict and returns the tool-result *string* —
identical in shape to the old `fastlane._dispatch` output (structured tools JSON-stringify
themselves; text tools pass the string through). `dispatch()` adds the FileNotFoundError ->
`"ERROR: ..."` wrapping and raises `KeyError` on an unknown name, exactly as V0 did.

Import discipline (constitution / V1 constraint): this module must stay importable without the
voice stack, because `kbmcp.server` imports it. It therefore never imports livekit at module
level — `livekit_tool()` imports `function_tool` lazily when first called.
"""
import inspect
import json
from dataclasses import dataclass
from typing import Any, Callable, Optional

from kbmcp import kb_tools


@dataclass(frozen=True)
class ToolSpec:
    """(name, description, input_schema, fn) — the four things every surface needs."""
    name: str
    description: str
    input_schema: dict
    fn: Callable[[dict], str]


# --- the 5 V0 read tools. fn mirrors old fastlane._dispatch: json.dumps structured results,
#     pass strings through; kb_root() is resolved per-call so ATLAS_KB_ROOT stays live. --------
def _queue_summary(args: dict) -> str:
    return json.dumps(kb_tools.queue_summary(kb_tools.kb_root(), args.get("state")))

def _read_dashboard(args: dict) -> str:
    return kb_tools.read_dashboard(kb_tools.kb_root(), args.get("name", "executive"))

def _read_state(args: dict) -> str:
    return kb_tools.read_state(kb_tools.kb_root(), args["project"])

def _ledger_rollup(args: dict) -> str:
    return json.dumps(kb_tools.ledger_rollup(kb_tools.kb_root()))

def _running_work(args: dict) -> str:
    return json.dumps(kb_tools.running_work(kb_tools.kb_root()))


REGISTRY: list[ToolSpec] = [
    ToolSpec("queue_summary",
             "Task-card queue counts + cards, optionally one state (inbox/working/done/approvals).",
             {"type": "object", "properties": {"state": {"type": "string"}}, "required": []},
             _queue_summary),
    ToolSpec("read_dashboard", "Read a dashboard markdown (default: executive).",
             {"type": "object", "properties": {"name": {"type": "string"}}, "required": []},
             _read_dashboard),
    ToolSpec("read_state", "Read a project's STATE.md.",
             {"type": "object", "properties": {"project": {"type": "string"}}, "required": ["project"]},
             _read_state),
    ToolSpec("ledger_rollup", "Today's cost (USD) and activity counts.",
             {"type": "object", "properties": {}, "required": []},
             _ledger_rollup),
    ToolSpec("running_work", "Cards currently in 'working'.",
             {"type": "object", "properties": {}, "required": []},
             _running_work),
]

_BY_NAME: dict[str, ToolSpec] = {s.name: s for s in REGISTRY}


def anthropic_tools() -> list[dict]:
    """The Anthropic tool-use schema list — identical shape to the V0 `fastlane.TOOLS` literal."""
    return [{"name": s.name, "description": s.description, "input_schema": s.input_schema}
            for s in REGISTRY]


def dispatch(name: str, args: dict) -> str:
    """Run a tool by name against the parsed args, returning its string result.

    Reproduces `fastlane._dispatch` exactly: FileNotFoundError -> `"ERROR: <e>"`; an unknown
    tool name raises KeyError (the lookup is inside the try, but only FileNotFoundError is caught).
    """
    try:
        return _BY_NAME[name].fn(args)
    except FileNotFoundError as e:
        return f"ERROR: {e}"


# --- LiveKit surface: raw-schema function tools (docstring/description reach the LLM verbatim).
#     function_tool imported lazily so `import worker.toolreg` never pulls the voice stack. ------
def livekit_tool(spec: ToolSpec):
    """Wrap one ToolSpec as a LiveKit raw-schema `function_tool` delegating to `dispatch`.

    Raw schema (vs a typed signature) lets the loop pass `spec.input_schema` and description
    straight through to the LLM — the same schema fastlane sends to Anthropic. The livekit
    executor invokes the wrapped fn with `raw_arguments=<parsed args dict>`.
    """
    from livekit.agents import function_tool

    async def _tool(raw_arguments: dict) -> str:
        return dispatch(spec.name, raw_arguments)

    return function_tool(
        _tool,
        raw_schema={"name": spec.name, "description": spec.description,
                    "parameters": spec.input_schema},
    )


# --- MCP surface: FastMCP derives a tool's parameter schema from the callable's signature and
#     there is no raw-schema hook, so synthesize a typed wrapper from input_schema whose body
#     delegates to `dispatch`. Description is passed explicitly at add_tool time. ----------------
def mcp_tool(spec: ToolSpec) -> Callable[..., str]:
    """Build a typed callable for `FastMCP.add_tool(...)` from a ToolSpec.

    The synthesized signature (one `str` param per schema property; optional -> `Optional[str]`
    with a None default) is what FastMCP introspects to produce the per-tool parameter schema.
    The body binds the call, drops unset optionals, and delegates to `dispatch` — so all three
    surfaces run the same underlying tool code.
    """
    props: dict = spec.input_schema.get("properties", {})
    required = set(spec.input_schema.get("required", []))

    params = []
    for pname in props:
        if pname in required:
            params.append(inspect.Parameter(pname, inspect.Parameter.POSITIONAL_OR_KEYWORD,
                                             annotation=str))
        else:
            params.append(inspect.Parameter(pname, inspect.Parameter.POSITIONAL_OR_KEYWORD,
                                             annotation=Optional[str], default=None))
    sig = inspect.Signature(params, return_annotation=str)

    def _tool(*args: Any, **kwargs: Any) -> str:
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()
        call_args = {k: v for k, v in bound.arguments.items() if v is not None}
        return dispatch(spec.name, call_args)

    _tool.__name__ = spec.name
    _tool.__qualname__ = spec.name
    _tool.__doc__ = spec.description
    _tool.__signature__ = sig  # type: ignore[attr-defined]
    _tool.__annotations__ = {p.name: p.annotation for p in params}
    _tool.__annotations__["return"] = str
    return _tool
