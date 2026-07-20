"""Atlas LiveKit voice worker: wake-free V0 voice loop, run in console mode (no LiveKit server).

Pipeline: Deepgram Flux STT (keyterm-biased on kb proper nouns) -> Claude fast lane
(Anthropic plugin on cfg fast_model, system prompt = fastlane.SYSTEM) -> Deepgram Aura-2 TTS,
with silero VAD for adaptive barge-in. kb read tools reach the LLM as in-process
function_tools (native MCP attach reversed by live desk evidence 2026-07-20 — the
livekit-agents 1.6.6 serializer mangles tool_results; see worker/anthropic_compat.py).

Run (from atlas/):
    .venv\\Scripts\\python -m worker.app console                 # desk mic/speaker
    .venv\\Scripts\\python -m worker.app console --text          # audio-free smoke
    .venv\\Scripts\\python -m worker.app console --list-devices  # enumerate audio devices
Console mode needs DEEPGRAM_API_KEY + ANTHROPIC_API_KEY in %USERPROFILE%\\.atlas\\env.
"""
import asyncio
import logging
import re
import sys
import threading
from pathlib import Path

import yaml

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import deepgram, silero

from kbmcp import kb_tools
from worker import anthropic_compat
from worker import engagement as engagement_mod
from worker import fastlane, repl, wakeword

ATLAS = Path(__file__).resolve().parents[1]
logger = logging.getLogger("atlas.app")

# Documented Aura-2 default voice — clear, conversational; rides the Deepgram $200 credit.
# The production voice is chosen by ear in the Task 8 bake-off; this is the startup default.
TTS_VOICE = "aura-2-andromeda-en"

# Text-mode console (`--text`) bypasses audio entirely, so wake gating doesn't apply — only the
# audio path is gated. Detected from argv because the CLI flag is parsed by livekit's typer app.
TEXT_MODE = "--text" in sys.argv

_BG_TASKS: set = set()   # strong refs to fire-and-forget tasks (silence watcher)


def _is_dismiss(transcript: str) -> bool:
    """True when a final transcript says "that's all" (case-insensitive, trailing punctuation ok).
    Deepgram may or may not emit the apostrophe, so both "that's all" and "thats all" match."""
    t = re.sub(r"[.!?,;:\s]+$", "", transcript.strip().lower())
    return t in ("that's all", "thats all")


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


def _kb_function_tools():
    """The 5 kb read tools as LiveKit function_tools delegating to fastlane._dispatch
    (same pattern as pairing_smoke.py path b — the proven-good tool path)."""
    from livekit.agents import RunContext, function_tool

    @function_tool()
    async def queue_summary(context: RunContext, state: str | None = None) -> str:
        """Task-card queue counts + cards, optionally one state (inbox/working/done/approvals)."""
        return fastlane._dispatch("queue_summary", {"state": state} if state else {})

    @function_tool()
    async def read_dashboard(context: RunContext, name: str = "executive") -> str:
        """Read a dashboard markdown (default: executive)."""
        return fastlane._dispatch("read_dashboard", {"name": name})

    @function_tool()
    async def read_state(context: RunContext, project: str) -> str:
        """Read a project's STATE.md."""
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


async def entrypoint(ctx: JobContext) -> None:
    repl.load_env()  # DEEPGRAM_API_KEY / ANTHROPIC_API_KEY -> process env, before plugins build
    cfg = _cfg()
    keyterms = seed_keyterms(kb_tools.kb_root())

    stt_kwargs: dict = {"model": "flux-general-en"}
    if keyterms:
        stt_kwargs["keyterm"] = keyterms

    # Tool path REVERSED from the pairing-smoke verdict (2026-07-20 live desk session): native MCP
    # attach 400s on the SECOND llm turn — MCP TextContent carries an `annotations` field the
    # Anthropic API rejects ('tool_result.content.0.text.annotations: Extra inputs are not
    # permitted'), poisoning the chat history (the #2519 bug class; smoke was one turn too shallow).
    # Fallback per plan decision rule: the same 5 kb read tools as LiveKit function_tools
    # delegating to fastlane._dispatch in-process. kb-MCP server remains the boundary for
    # everything else; retest native attach on livekit-agents upgrade.
    await ctx.connect()  # console mode: connects the simulated room
    session = AgentSession(
        stt=deepgram.STTv2(**stt_kwargs),
        vad=silero.VAD.load(),                       # VAD barge-in; the AdaptiveInterruptionDetector WARNING at
                                                     # startup is expected+harmless (that path needs LiveKit-hosted
                                                     # inference / LIVEKIT_API_KEY, absent by design — falls back to VAD)
        # anthropic_compat.build_llm: shim over the 1.6.6 tool_result serialization bug
        # (see worker/anthropic_compat.py) — plain anthropic.LLM 400s on the 2nd LLM call
        # once a list-returning tool (e.g. running_work) enters chat history.
        llm=anthropic_compat.build_llm(cfg["fast_model"]),
        tts=deepgram.TTS(model=TTS_VOICE),
        max_tool_steps=cfg["max_tool_turns"],        # 5, not the plugin default 3
    )
    await session.start(
        agent=Agent(instructions=fastlane.SYSTEM, tools=_kb_function_tools()),
        room=ctx.room,
    )

    if TEXT_MODE:
        return  # audio-free smoke: no wake gate, no mic loop — text turns flow straight through

    # --- Gated listening (spec §2): audio leaves the PC ONLY while ENGAGED ------------------
    # The wake-word loop is always on locally and never streams audio anywhere; it only flips the
    # engagement state. The Deepgram STT audio input is detached (set_audio_enabled(False)) while
    # ASLEEP so no mic audio reaches Deepgram, and re-attached on wake. Silence timeout + an
    # explicit "that's all" both return to ASLEEP.
    loop = asyncio.get_running_loop()
    engagement = engagement_mod.Engagement(timeout_s=cfg["engagement_timeout_s"])
    session.input.set_audio_enabled(False)  # start ASLEEP: no audio to STT until "hey jarvis"

    def _sleep() -> None:
        if session.input.audio_enabled:
            session.input.set_audio_enabled(False)
            logger.info("ASLEEP — mic detached, no audio leaves the PC (wake word to re-engage)")

    def _engage() -> None:
        already = engagement.state == engagement_mod.ENGAGED
        engagement.wake()
        session.input.set_audio_enabled(True)  # open the STT stream — audio now leaves the PC
        logger.info("ENGAGED — listening (silence timeout %ss, or say \"that's all\")",
                    cfg["engagement_timeout_s"])
        if not already:
            session.say("Yes?", add_to_chat_ctx=False)  # audible wake ack

    def _on_wake() -> None:  # called from the wake-word thread; hop to the event loop
        loop.call_soon_threadsafe(_engage)

    @session.on("user_input_transcribed")
    def _on_transcript(ev) -> None:
        if not ev.is_final:
            return
        engagement.heard_speech()          # re-stamp the silence clock
        if _is_dismiss(ev.transcript):     # "that's all" -> immediate dismissal
            engagement.dismiss()
            _sleep()

    async def _silence_watcher() -> None:
        while True:
            await asyncio.sleep(1.0)
            if engagement.tick() == engagement_mod.ASLEEP:
                _sleep()

    # daemon thread: blocking mic read + onnx wake scoring, off the event loop
    threading.Thread(target=wakeword.listen, args=(_on_wake, cfg["wake_model"]),
                     kwargs={"device": cfg.get("wake_input_device"),
                             "threshold": cfg.get("wake_threshold", wakeword.THRESHOLD)},
                     daemon=True).start()
    watcher = asyncio.create_task(_silence_watcher())
    _BG_TASKS.add(watcher)                     # retain handle so the watcher can't be GC'd
    watcher.add_done_callback(_BG_TASKS.discard)


def main() -> int:
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
    return 0


if __name__ == "__main__":
    sys.exit(main())
