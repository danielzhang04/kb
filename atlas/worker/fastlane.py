"""Fast conversational lane: Anthropic tool-use loop over kb read tools (in-process).

Tool definitions now live in `worker.toolreg` (single registry shared by fastlane, the LiveKit
worker, and the kb-MCP server). `TOOLS` and `_dispatch` are thin re-exports so existing callers
and tests keep working unchanged — that stability is the no-behavior-change proof for the refactor.
"""
from worker import toolreg

SYSTEM = ("You are Atlas, the spoken interface to Daniel's kb agentic OS. Answers are read "
          "aloud: lead with the point, one breath long by default; offer detail on request. "
          "Use tools to ground every factual claim about kb state.")

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
