"""Fast conversational lane: Anthropic tool-use loop over kb read tools (in-process)."""
import json
from kbmcp import kb_tools

SYSTEM = ("You are Atlas, the spoken interface to Daniel's kb agentic OS. Answers are read "
          "aloud: lead with the point, one breath long by default; offer detail on request. "
          "Use tools to ground every factual claim about kb state.")

TOOLS = [
    {"name": "queue_summary", "description": "Task-card queue counts + cards, optionally one state (inbox/working/done/approvals).",
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

def _dispatch(name: str, args: dict) -> str:
    root = kb_tools.kb_root()
    fns = {"queue_summary": lambda: kb_tools.queue_summary(root, args.get("state")),
           "read_dashboard": lambda: kb_tools.read_dashboard(root, args.get("name", "executive")),
           "read_state": lambda: kb_tools.read_state(root, args["project"]),
           "ledger_rollup": lambda: kb_tools.ledger_rollup(root),
           "running_work": lambda: kb_tools.running_work(root)}
    try:
        out = fns[name]()
        return out if isinstance(out, str) else json.dumps(out)
    except FileNotFoundError as e:
        return f"ERROR: {e}"

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
