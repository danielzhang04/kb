"""Fast conversational lane: Anthropic tool-use loop over kb read tools (in-process).

Tool definitions now live in `worker.toolreg` (single registry shared by fastlane, the LiveKit
worker, and the kb-MCP server). `TOOLS` and `_dispatch` are thin re-exports so existing callers
and tests keep working unchanged — that stability is the no-behavior-change proof for the refactor.
"""
from pathlib import Path

from worker import toolreg

# The V0 system text, kept ONLY as the fallback when config/persona.md is missing — the worker
# must never fail to start over persona (design §9). The file is the source of truth.
_FALLBACK_PERSONA = (
    "You are Atlas, the spoken interface to Daniel's kb agentic OS. Answers are read "
    "aloud: lead with the point, one breath long by default; offer detail on request. "
    "Use tools to ground every factual claim about kb state. "
    "Before filing a card (file_card) or launching a workflow (launch_workflow), read back "
    "the project, action, target, and risk-tier and get an explicit spoken yes — only then "
    "call the tool with confirmed=true. Never set confirmed=true without that spoken yes.")

_PERSONA_PATH = Path(__file__).resolve().parents[1] / "config" / "persona.md"


def load_persona(path: Path = _PERSONA_PATH) -> str:
    """The system prompt from atlas/config/persona.md (Task 12 / design §9); both the live voice
    path (Agent instructions) and the REPL consume this. Missing/empty file -> the V0 fallback."""
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return _FALLBACK_PERSONA
    return text or _FALLBACK_PERSONA


SYSTEM = load_persona()

# Re-exports from the single tool registry (see worker/toolreg.py).
TOOLS = toolreg.anthropic_tools()


def _dispatch(name: str, args: dict) -> str:
    return toolreg.dispatch(name, args)


def answer(question: str, client, model: str, max_turns: int = 5) -> str:
    messages = [{"role": "user", "content": question}]
    for _ in range(max_turns):
        msg = client.messages.create(model=model, max_tokens=1024, system=SYSTEM,
                                     tools=TOOLS, messages=messages)
        if msg.stop_reason != "tool_use":
            return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        messages.append({"role": "assistant", "content": msg.content})
        results = [{"type": "tool_result", "tool_use_id": b.id,
                    "content": _dispatch(b.name, b.input)}
                   for b in msg.content if getattr(b, "type", "") == "tool_use"]
        messages.append({"role": "user", "content": results})
    return "I hit my tool-call limit before finishing — try a narrower question."
