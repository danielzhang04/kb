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
import os
import re
import sys
import threading
from pathlib import Path

import yaml

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
# elevenlabs imported at module level even though only some voices use it: livekit plugins
# self-register on import and MUST do so on the main thread (job tasks raise RuntimeError).
from livekit.plugins import deepgram, elevenlabs, silero

from kbmcp import kb_tools
from worker import anthropic_compat
from worker import engagement as engagement_mod
from worker import fastlane, repl, state, toolreg, wakeword

ATLAS = Path(__file__).resolve().parents[1]
logger = logging.getLogger("atlas.app")

# Fallback voice if config has no voices/active_voice (pre-bake-off default).
TTS_VOICE = "aura-2-andromeda-en"


def _build_tts(cfg: dict):
    """TTS from the config voice toggle: voices[active_voice] -> vendor-specific plugin.
    Daniel switches voices by editing active_voice and restarting the console (V1: spoken switch)."""
    entry = (cfg.get("voices") or {}).get(cfg.get("active_voice") or "")
    if not entry:
        return deepgram.TTS(model=TTS_VOICE)
    if entry["vendor"] == "deepgram":
        return deepgram.TTS(model=entry["model"])
    if entry["vendor"] == "elevenlabs":
        from livekit.agents.utils import http_context
        # plugin's env fallback is ELEVEN_API_KEY; our env file uses ELEVENLABS_API_KEY — pass explicitly.
        # http_session passed explicitly: the plugin otherwise creates it lazily on FIRST synthesis,
        # and our first synthesis ("Yes?") fires from the wake-thread callback via call_soon_threadsafe,
        # which runs outside the job-context ContextVar -> RuntimeError (desk traceback 2026-07-20).
        # _build_tts is only called from entrypoint, where the job context is active.
        return elevenlabs.TTS(voice_id=entry["voice_id"], model=entry["model"],
                              api_key=os.environ.get("ELEVENLABS_API_KEY"),
                              http_session=http_context.http_session())
    raise ValueError(f"unknown voice vendor: {entry['vendor']}")

# Text-mode console (`--text`) bypasses audio entirely, so wake gating doesn't apply — only the
# audio path is gated. Detected from argv because the CLI flag is parsed by livekit's typer app.
TEXT_MODE = "--text" in sys.argv

_BG_TASKS: set = set()   # strong refs to fire-and-forget tasks (silence watcher)


DEFAULT_DISMISS = ["that's all", "go to sleep", "thanks atlas", "thank you atlas"]


def _norm_phrase(s: str) -> str:
    """Lowercase, drop punctuation (incl. apostrophes — Deepgram may omit them), collapse spaces."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", "", s.lower())).strip()


def _is_dismiss(transcript: str, phrases: list[str] | None = None) -> bool:
    """True when a final transcript matches a configured dismiss phrase
    (case/punctuation-insensitive; 'Thanks, Atlas.' == 'thanks atlas')."""
    t = _norm_phrase(transcript)
    return t in {_norm_phrase(p) for p in (phrases or DEFAULT_DISMISS)}


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
    """The kb read tools as LiveKit function_tools — one raw-schema wrapper per registry entry.

    Adding a tool is now a single edit in worker/toolreg.py; this loop and the MCP server pick it
    up automatically. Each wrapper delegates to toolreg.dispatch (== fastlane._dispatch)."""
    return [toolreg.livekit_tool(spec) for spec in toolreg.REGISTRY]


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
        tts=_build_tts(cfg),
        max_tool_steps=cfg["max_tool_turns"],        # 5, not the plugin default 3
    )
    await session.start(
        agent=Agent(instructions=fastlane.SYSTEM, tools=_kb_function_tools()),
        room=ctx.room,
    )

    # --- Unified worker state (design §2): a pure observer of the voice loop. The HTTP
    # surface (Task 5), transcript ledger (Task 6), and done-watcher (Task 11) all consume
    # this ONE stream. `voice` mirrors the active config voice.
    publisher = state.StatePublisher(voice=cfg.get("active_voice"))

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        # Final committed turns for BOTH roles feed the transcript mirror (agent_session.py
        # emits this at :1836 for every inserted ChatMessage). The synthetic session.say acks
        # use add_to_chat_ctx=False so they DON'T arrive here — they're mirrored at their
        # callsites. Non-message items (e.g. AgentHandoff) have no `role` and are skipped.
        msg = ev.item
        role = getattr(msg, "role", None)
        if role not in ("user", "assistant"):
            return
        text = getattr(msg, "text_content", None)
        if not text:
            return
        publisher.add_line("atlas" if role == "assistant" else "user", text)

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

    def _sleep(announce: bool = True) -> bool:
        """Close the mic; returns True only on a real transition. Audible cue (Daniel's ask:
        never leave him guessing whether Atlas is still listening)."""
        if not session.input.audio_enabled:
            return False
        session.input.set_audio_enabled(False)
        publisher.set_state(state.ASLEEP)
        logger.info("ASLEEP — mic detached, no audio leaves the PC (wake word to re-engage)")
        if announce:
            session.say("Going to sleep.", add_to_chat_ctx=False)
            publisher.add_line("atlas", "Going to sleep.")  # audible, so it's mirrored
        return True

    def _engage() -> None:
        already = engagement.state == engagement_mod.ENGAGED
        engagement.wake()
        session.input.set_audio_enabled(True)  # open the STT stream — audio now leaves the PC
        logger.info("ENGAGED — listening (silence timeout %ss, or say \"that's all\")",
                    cfg["engagement_timeout_s"])
        if not already:
            publisher.start_session()             # new wake-session id per wake
            publisher.set_state(state.LISTENING)
            session.say("Yes?", add_to_chat_ctx=False)  # audible wake ack
            publisher.add_line("atlas", "Yes?")         # audible, so it's mirrored

    @session.on("agent_state_changed")
    def _on_agent_state(ev) -> None:
        # design §2: THINKING = LLM turn in flight, SPEAKING = TTS playing, else LISTENING.
        # The session's own AgentState (agent_session.py:1757) gives these directly. Guarded
        # by ENGAGED so session chatter while ASLEEP — the "Going to sleep." ack, session
        # warm-up ("initializing"->"listening") — never overrides the ASLEEP orb.
        if engagement.state != engagement_mod.ENGAGED:
            return
        mapped = state.STATE_FROM_AGENT.get(ev.new_state)
        if mapped is not None:
            publisher.set_state(mapped)

    def _on_wake() -> None:  # called from the wake-word thread; hop to the event loop
        loop.call_soon_threadsafe(_engage)

    dismiss_phrases = cfg.get("dismiss_phrases", DEFAULT_DISMISS)

    @session.on("user_input_transcribed")
    def _on_transcript(ev) -> None:
        if not ev.is_final:
            return
        engagement.heard_speech()                        # re-stamp the silence clock
        if _is_dismiss(ev.transcript, dismiss_phrases):  # dismiss phrase -> immediate sleep + cue
            engagement.dismiss()
            _sleep()

    async def _silence_watcher() -> None:
        while True:
            await asyncio.sleep(1.0)
            if engagement.tick() == engagement_mod.ASLEEP:
                _sleep()

    # Quiet the "Atlas is DEAF" CRITICAL on Ctrl+C: flag teardown so the wake thread's error
    # path knows the stream tore down deliberately (a mid-run mic failure still logs loudly).
    async def _quiet_shutdown() -> None:
        wakeword.shutting_down.set()
    ctx.add_shutdown_callback(_quiet_shutdown)

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
