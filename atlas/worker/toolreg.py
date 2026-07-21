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
import logging
from dataclasses import dataclass
from typing import Any, Callable, Optional

from kbmcp import kb_tools

logger = logging.getLogger("atlas.toolreg")


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


# --- write tools + credit (Task 9) ------------------------------------------------------------
# Publisher-agnostic post-file hook: app.py sets this at startup to publisher.add_filed_card so a
# voice-filed card appears in the /state snapshot's `filed_cards` — toolreg never imports state
# or a publisher. A hook failure is best-effort (the card is already filed): logged, not raised.
_post_file_hook: Optional[Callable[[dict], None]] = None


def set_post_file_hook(fn: Optional[Callable[[dict], None]]) -> None:
    """Install (or clear, with None) the post-file callback. Called once from app.py's entrypoint
    with `lambda p: publisher.add_filed_card(p["id"], p["action"])`."""
    global _post_file_hook
    _post_file_hook = fn


def _fire_post_file_hook(payload: dict) -> None:
    if _post_file_hook is not None:
        try:
            _post_file_hook(payload)
        except Exception:
            logger.exception("atlas post-file hook raised; card is filed regardless")


def _require_confirmed(args: dict) -> None:
    """Structural read-back gate: the LLM must set confirmed=true only after speaking project/
    action/target/risk-tier and getting a yes. Raised BEFORE any write, so an unconfirmed call
    writes NOTHING; dispatch turns the ValueError into the exact spoken ERROR string."""
    if args.get("confirmed") is not True:
        raise ValueError("not confirmed — read the card back and get a yes.")


def _file_card(args: dict) -> str:
    _require_confirmed(args)
    result = kb_tools.file_card(str(kb_tools.ops_root()), args.get("project"), args.get("action"),
                                args.get("target"), args.get("risk_tier"), body=args.get("body", ""),
                                workflow=None)
    _fire_post_file_hook({"id": result["id"], "action": args.get("action"), "path": result["path"]})
    return json.dumps(result)


def _launch_workflow(args: dict) -> str:
    _require_confirmed(args)
    result = kb_tools.file_card(str(kb_tools.ops_root()), args.get("project"), args.get("action"),
                                args.get("target"), args.get("risk_tier"), body=args.get("body", ""),
                                workflow=args.get("workflow"))
    _fire_post_file_hook({"id": result["id"], "action": args.get("action"), "path": result["path"]})
    return json.dumps(result)


def _credit_remaining(args: dict) -> str:
    return json.dumps(kb_tools.credit_remaining())


# Gate-C desk finding (2026-07-21): with no sleep tool, a conversational dismissal that slips past
# the reflex lane makes the LLM ROLE-PLAY sleeping while the mic stays open. This hook lets the
# LLM actually perform the state change: app.py installs the real _sleep closure at startup.
# Without a hook installed (REPL, MCP, tests) the tool reports that it can't sleep here.
_sleep_hook: Optional[Callable[[], None]] = None


def set_sleep_hook(fn: Optional[Callable[[], None]]) -> None:
    global _sleep_hook
    _sleep_hook = fn


def _go_to_sleep(args: dict) -> str:
    if _sleep_hook is None:
        return "Sleep is not available in this mode."
    try:
        _sleep_hook()
    except Exception:
        logger.exception("atlas sleep hook raised")
        return "ERROR: sleep failed — the mic may still be open."
    return "Sleeping now. (The audible cue already played; add nothing beyond a brief sign-off.)"


_READBACK = ("You MUST first read back the project, action, target, and risk-tier aloud and get "
             "an explicit spoken yes; only then set confirmed=true. ")

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
    ToolSpec("file_card",
             "File a task card into the kb queue for Daniel's fleet to pick up (Atlas does not "
             "run it). " + _READBACK,
             {"type": "object",
              "properties": {
                  "project": {"type": "string", "description": "kb project the card belongs to."},
                  "action": {"type": "string", "description": "One-line imperative of the ask."},
                  "target": {"type": "string", "description": "What it acts on (path/area)."},
                  "risk_tier": {"type": "string", "description": "T1, T2, or T3."},
                  "body": {"type": "string", "description": "Optional work-order detail."},
                  "confirmed": {"type": "boolean",
                                "description": "true ONLY after the spoken read-back was confirmed."}},
              "required": ["project", "action", "target", "risk_tier", "confirmed"]},
             _file_card),
    ToolSpec("launch_workflow",
             "File a card that launches a named kb workflow for the fleet to run (Atlas does not "
             "run it). " + _READBACK,
             {"type": "object",
              "properties": {
                  "workflow": {"type": "string", "description": "The named workflow to launch."},
                  "project": {"type": "string", "description": "kb project the card belongs to."},
                  "action": {"type": "string", "description": "One-line imperative of the ask."},
                  "target": {"type": "string", "description": "What it acts on (path/area)."},
                  "risk_tier": {"type": "string", "description": "T1, T2, or T3."},
                  "body": {"type": "string", "description": "Optional work-order detail."},
                  "confirmed": {"type": "boolean",
                                "description": "true ONLY after the spoken read-back was confirmed."}},
              "required": ["workflow", "project", "action", "target", "risk_tier", "confirmed"]},
             _launch_workflow),
    ToolSpec("credit_remaining", "How much Deepgram voice credit is left (USD).",
             {"type": "object", "properties": {}, "required": []},
             _credit_remaining),
    ToolSpec("go_to_sleep",
             "ACTUALLY end the listening session (close the mic) when the user asks you to sleep, "
             "stop listening, or wraps up. You cannot sleep by saying so — you MUST call this tool; "
             "never claim to be sleeping without it.",
             {"type": "object", "properties": {}, "required": []},
             _go_to_sleep),
]

_BY_NAME: dict[str, ToolSpec] = {s.name: s for s in REGISTRY}


def anthropic_tools() -> list[dict]:
    """The Anthropic tool-use schema list — identical shape to the V0 `fastlane.TOOLS` literal."""
    return [{"name": s.name, "description": s.description, "input_schema": s.input_schema}
            for s in REGISTRY]


def dispatch(name: str, args: dict) -> str:
    """Run a tool by name against the parsed args, returning its string result.

    Reproduces `fastlane._dispatch` for the read tools (FileNotFoundError -> `"ERROR: <e>"`) and
    extends it for the write tools: a `ValueError` — the unconfirmed gate and card-schema
    validation failures (Task 9) — also becomes a speakable `"ERROR: <e>"` (e.g. the exact
    "ERROR: not confirmed — read the card back and get a yes."). An unknown tool name still raises
    KeyError (the lookup is inside the try, but KeyError is not caught).
    """
    try:
        return _BY_NAME[name].fn(args)
    except (FileNotFoundError, ValueError) as e:
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

    # Required params (no default) MUST precede optional ones (default None) or the synthesized
    # signature is illegal ("non-default argument follows default argument"). Emit all required in
    # schema order, then all optional in schema order — FastMCP reads the annotations, not order,
    # so the produced parameter schema is unchanged. `confirmed` is boolean; every other field str.
    def _ann(pname: str):
        return bool if props[pname].get("type") == "boolean" else str

    params = [inspect.Parameter(p, inspect.Parameter.POSITIONAL_OR_KEYWORD, annotation=_ann(p))
              for p in props if p in required]
    params += [inspect.Parameter(p, inspect.Parameter.POSITIONAL_OR_KEYWORD,
                                 annotation=Optional[_ann(p)], default=None)
               for p in props if p not in required]
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
