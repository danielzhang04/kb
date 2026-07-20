"""livekit/agents#2519 pairing smoke: does the Anthropic LLM plugin tolerate kb tools?

Runs TWO sequential text turns against a minimal AgentSession (llm = the
anthropic_compat shim on fast_model). The two-turn shape is load-bearing: the
1.6.6 tool_result serialization bug only bites the SECOND LLM call, once a
tool result is in chat history — a single turn (the earlier smoke) was too
shallow and let the bug ship. Turn 1 exercises a dict-returning tool
(queue_summary), turn 2 a list-returning tool (running_work) whose serialized
history is exactly what the bug mangled.
  (a) native MCP attach   — Agent(mcp_servers=[kb-MCP stdio server])
  (b) function_tool wrap  — Agent(tools=[fastlane._dispatch wrapped as @function_tool])
PASS per path = both turns reply with no exception (>=1 tool call across the two).

Run (from atlas/):  .venv\\Scripts\\python -m worker.pairing_smoke
"""
import asyncio
import sys
from pathlib import Path

import yaml

from worker import anthropic_compat, fastlane, repl

ATLAS = Path(__file__).resolve().parents[1]
# Turn 1 triggers a tool call; turn 2 forces the turn-1 tool_result through
# serialization AND calls a list-returning tool (running_work) — the exact bug path.
PROMPTS = [
    "Call queue_summary and tell me how many task cards are in the queue right now.",
    "And how many are in working?",
]


def _cfg() -> dict:
    return yaml.safe_load((ATLAS / "config" / "atlas.yaml").read_text(encoding="utf-8"))


def _kb_function_tools():
    """The 5 kb read tools wrapped as LiveKit function_tools delegating to fastlane._dispatch."""
    from livekit.agents import RunContext, function_tool

    @function_tool()
    async def queue_summary(context: RunContext, state: str | None = None) -> str:
        """Task-card queue counts + cards, optionally one state (inbox/working/done/approvals)."""
        return fastlane._dispatch("queue_summary", {"state": state})

    @function_tool()
    async def read_dashboard(context: RunContext, name: str = "executive") -> str:
        """Read a kb dashboard markdown (default: executive)."""
        return fastlane._dispatch("read_dashboard", {"name": name})

    @function_tool()
    async def read_state(context: RunContext, project: str) -> str:
        """Read a project's STATE.md under orgs/<project>."""
        return fastlane._dispatch("read_state", {"project": project})

    @function_tool()
    async def ledger_rollup(context: RunContext) -> str:
        """Today's cost (USD) and activity counts."""
        return fastlane._dispatch("ledger_rollup", {})

    @function_tool()
    async def running_work(context: RunContext) -> str:
        """Cards currently in 'working'."""
        return fastlane._dispatch("running_work", {})

    return [queue_summary, read_dashboard, read_state, ledger_rollup, running_work]


async def _drive(agent) -> None:
    """Start a text-only AgentSession, drive TWO sequential turns on it, assert each replies.

    Turn 2 runs on the same session, so turn 1's tool_result is serialized into the
    request history — the second-LLM-call path where the 1.6.6 bug 400s."""
    from livekit.agents import AgentSession
    from livekit.agents.voice.run_result import ChatMessageEvent, FunctionCallEvent

    cfg = _cfg()
    session = AgentSession(
        llm=anthropic_compat.build_llm(cfg["fast_model"]),
        max_tool_steps=cfg["max_tool_turns"],
    )
    await session.start(agent)
    try:
        any_tool = False
        for turn, prompt in enumerate(PROMPTS, start=1):
            result = await session.run(user_input=prompt, input_modality="text")
            any_tool = any_tool or any(isinstance(e, FunctionCallEvent) for e in result.events)
            # A conversational turn leaves final_output None (that's for typed runs);
            # the spoken reply is the last assistant ChatMessage.
            reply = ""
            for e in result.events:
                if isinstance(e, ChatMessageEvent) and e.item.role == "assistant":
                    reply = (e.item.text_content or "").strip()
            if not reply:
                raise AssertionError(f"turn {turn} empty text reply")
        if not any_tool:
            raise AssertionError("no tool call fired across turns")
    finally:
        await session.aclose()


async def _native_mcp() -> None:
    from livekit.agents import Agent, mcp

    kb_mcp = mcp.MCPServerStdio(
        command=str(ATLAS / ".venv" / "Scripts" / "python.exe"),
        args=["-m", "kbmcp.server"],
        cwd=str(ATLAS),
    )
    await _drive(Agent(instructions=fastlane.SYSTEM, mcp_servers=[kb_mcp]))


async def _function_tool() -> None:
    from livekit.agents import Agent

    await _drive(Agent(instructions=fastlane.SYSTEM, tools=_kb_function_tools()))


def _run(coro) -> str:
    try:
        asyncio.run(coro())
        return "PASS"
    except Exception as e:  # noqa: BLE001 — verdict wants the one-line reason
        return "FAIL " + str(e).splitlines()[0]


def main() -> int:
    repl.load_env()
    print("native-mcp:", _run(_native_mcp))
    print("function-tool:", _run(_function_tool))
    return 0


if __name__ == "__main__":
    sys.exit(main())
