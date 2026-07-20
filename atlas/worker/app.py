"""Atlas LiveKit voice worker: wake-free V0 voice loop, run in console mode (no LiveKit server).

Pipeline: Deepgram Flux STT (keyterm-biased on kb proper nouns) -> Claude fast lane
(Anthropic plugin on cfg fast_model, system prompt = fastlane.SYSTEM) -> Deepgram Aura-2 TTS,
with silero VAD for adaptive barge-in. kb read tools reach the LLM via native MCP attach
(pairing_smoke.py verdict 2026-07-20: native-mcp PASS -> #2519 does not bite here).

Run (from atlas/):
    .venv\\Scripts\\python -m worker.app console                 # desk mic/speaker
    .venv\\Scripts\\python -m worker.app console --text          # audio-free smoke
    .venv\\Scripts\\python -m worker.app console --list-devices  # enumerate audio devices
Console mode needs DEEPGRAM_API_KEY + ANTHROPIC_API_KEY in %USERPROFILE%\\.atlas\\env.
"""
import sys
from pathlib import Path

import yaml

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli, mcp
from livekit.plugins import anthropic, deepgram, silero

from kbmcp import kb_tools
from worker import fastlane, repl

ATLAS = Path(__file__).resolve().parents[1]

# Documented Aura-2 default voice — clear, conversational; rides the Deepgram $200 credit.
# The production voice is chosen by ear in the Task 8 bake-off; this is the startup default.
TTS_VOICE = "aura-2-andromeda-en"


def _cfg() -> dict:
    return yaml.safe_load((ATLAS / "config" / "atlas.yaml").read_text(encoding="utf-8"))


def seed_keyterms(root: Path) -> list[str]:
    """kb proper nouns for Flux STT keyterm biasing (spec §12 mitigation):
    project (orgs/*) names + skill (skills/*/*) names. Tolerates missing dirs."""
    def named(p: Path) -> bool:
        return not p.name.startswith(".")

    terms: set[str] = set()
    orgs = root / "orgs"
    if orgs.is_dir():
        terms.update(p.name for p in orgs.iterdir() if p.is_dir() and named(p))
    skills = root / "skills"
    if skills.is_dir():
        for category in skills.iterdir():
            if category.is_dir() and named(category):
                terms.update(p.name for p in category.iterdir() if named(p))
    return sorted(terms)


async def entrypoint(ctx: JobContext) -> None:
    repl.load_env()  # DEEPGRAM_API_KEY / ANTHROPIC_API_KEY -> process env, before plugins build
    cfg = _cfg()
    keyterms = seed_keyterms(kb_tools.kb_root())

    stt_kwargs: dict = {"model": "flux-general-en"}
    if keyterms:
        stt_kwargs["keyterm"] = keyterms

    kb_mcp = mcp.MCPServerStdio(
        command=str(ATLAS / ".venv" / "Scripts" / "python.exe"),
        args=["-m", "kbmcp.server"],
        cwd=str(ATLAS),  # run from atlas/ so `python -m kbmcp.server` resolves the package
    )

    await ctx.connect()  # console mode: connects the simulated room
    session = AgentSession(
        stt=deepgram.STTv2(**stt_kwargs),
        vad=silero.VAD.load(),
        interruption_detection="vad",                # pin VAD barge-in; adaptive path needs LiveKit-hosted
                                                     # inference (LIVEKIT_API_KEY), absent by design (serverless)
        llm=anthropic.LLM(model=cfg["fast_model"]),
        tts=deepgram.TTS(model=TTS_VOICE),
        max_tool_steps=cfg["max_tool_turns"],        # 5, not the plugin default 3
    )
    await session.start(
        agent=Agent(instructions=fastlane.SYSTEM, mcp_servers=[kb_mcp]),
        room=ctx.room,
    )


def main() -> int:
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
    return 0


if __name__ == "__main__":
    sys.exit(main())
