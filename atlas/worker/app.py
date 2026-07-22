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
import json
import logging
import os
import sys
import threading
from pathlib import Path

import yaml

from livekit.agents import Agent, AgentSession, JobContext, StopResponse, WorkerOptions, cli
# elevenlabs imported at module level even though only some voices use it: livekit plugins
# self-register on import and MUST do so on the main thread (job tasks raise RuntimeError).
from livekit.plugins import deepgram, elevenlabs, silero

from kbmcp import kb_tools
from worker import anthropic_compat
from worker import devicewatch
from worker import engagement as engagement_mod
from worker import (addressing as addressing_mod, donewatcher, fastlane, ledgerwriter, repl,
                    router, sanitize, state, stateserver, toolreg, wakeword)

ATLAS = Path(__file__).resolve().parents[1]
logger = logging.getLogger("atlas.app")

# Fallback voice if config has no voices/active_voice (pre-bake-off default).
TTS_VOICE = "aura-2-andromeda-en"

# Output-follow sentinel (docs/specs/2026-07-21-atlas-output-follow-design.md): tts_output_device
# set to exactly this lowercase string switches TTS from static-pin to hot-follow the Windows default
# output. Any other non-empty string is the existing static substring pin, byte-for-byte unchanged.
FOLLOW_SENTINEL = "follow"

# Fallback ops worktree for the transcript ledger if config omits `ops_root` (design §5, Task 6).
DEFAULT_OPS_ROOT = "C:/Users/danie/kb-worktrees/dashboard-ops"


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


# Reflex intents live in config/intents.yaml (design §7, loaded by router.load_intents). This
# constant is ONLY the fallback used when that file is missing, so sleep-by-voice never depends on
# a file that failed to ship — the phrases themselves have MIGRATED out of atlas.yaml into
# intents.yaml (the single source of reflex matching data).
DEFAULT_DISMISS = ["that's all", "go to sleep", "thanks atlas", "thank you atlas"]

# Canonical session-frame lines (conversation-rules design §3, Daniel-judged 2026-07-21).
WAKE_LINE = "Hey boss. What can I do for you?"
SLEEP_LINE = "Okay, sleeping. Wake me when you need something."


def _load_intents() -> dict:
    """Reflex intents from config/intents.yaml; if that file is absent, fall back to a
    dismiss-only intent set so voice-sleep still works (Task 10 fallback, documented)."""
    path = ATLAS / "config" / "intents.yaml"
    if path.is_file():
        return router.load_intents(path)
    logger.warning("intents.yaml missing — reflex lane limited to the dismiss fallback")
    return {"dismiss": {"phrases": DEFAULT_DISMISS}}


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


def _apply_agent_state(engagement, publisher, agent_state: str) -> None:
    """Body of the agent_state_changed handler, extracted so the wiring is unit-testable.

    design §2: THINKING = LLM turn in flight, SPEAKING = TTS playing, else LISTENING. The session's
    own AgentState (agent_session.py:1757) gives these directly. Guarded by ENGAGED so session
    chatter while ASLEEP — the "Going to sleep." ack, warm-up ("initializing"->"listening") — never
    overrides the ASLEEP orb.

    Silence-clock re-stamp (2026-07-21 fix): Atlas entering SPEAKING is proof of a real, directed
    interaction — Atlas answered, ack'd a wake ("Yes?"), or spoke a reflex reply ("repeat that") —
    so it re-opens the 2-min window. We deliberately do NOT re-stamp on THINKING or on raw user
    transcripts: while ENGAGED the mic streams the WHOLE room to STT, so ambient chatter is
    transcribed (and can even spin up a THINKING turn) without Atlas ever speaking. Keying the window
    off Atlas's own voice is what lets a noisy room go quiet into ASLEEP after timeout_s."""
    if engagement.state != engagement_mod.ENGAGED:
        return
    mapped = state.STATE_FROM_AGENT.get(agent_state)
    if mapped is not None:
        publisher.set_state(mapped)
    if mapped == state.SPEAKING:
        engagement.interacted()


def _silence_decision(orb_state: str) -> str:
    """What the silence watcher should do this tick given the current orb state (M2 fix, 2026-07-21).

    'restamp' while SPEAKING — Atlas is actually talking, so measure silence from the END of the
    utterance, never sleep out from under a >120s reply. 'defer' while THINKING — an LLM turn is in
    flight (possibly a follow-up asked at t≈timeout), so don't sleep mid-generation, but don't
    extend the window either (ambient chatter also spins up THINKING and must not hold Atlas awake).
    'check' otherwise — LISTENING/ASLEEP: run the normal timeout check."""
    if orb_state == state.SPEAKING:
        return "restamp"
    if orb_state == state.THINKING:
        return "defer"
    return "check"


def _boot_default_output_name() -> str | None:
    """Name of the output device livekit opened at boot (PortAudio's boot-time default)."""
    try:
        import sounddevice as sd
        return sd.query_devices(sd.default.device[1])["name"]
    except Exception:
        return None


def _output_device_status(cfg: dict, resolve=wakeword.resolve_output_device,
                          boot_default=_boot_default_output_name) -> dict:
    """{'configured', 'resolved', 'following'} for the TTS output, surfaced in GET /state (M4).

    Three modes: absent (system default, not following), a name substring (static pin,
    unchanged since 2026-07-21), or the sentinel 'follow' (output-follow design: the
    watcher moves the stream when the Windows default endpoint changes; `resolved` is
    updated live by the follower and starts as the boot default)."""
    configured = cfg.get("tts_output_device")
    if not configured:
        return {"configured": None, "resolved": None, "following": False}
    if configured == FOLLOW_SENTINEL:
        return {"configured": FOLLOW_SENTINEL, "resolved": boot_default(), "following": True}
    idx = resolve(configured)
    if idx is None:
        return {"configured": configured, "resolved": None, "following": False}
    try:
        import sounddevice as sd
        name = sd.query_devices(idx)["name"]
    except Exception:
        name = str(idx)
    return {"configured": configured, "resolved": name, "following": False}


def _console_singleton():
    """The live console object whose set_speaker_enabled hot-reopens the output stream.

    livekit.agents.cli._legacy is a PRIVATE module (import-guarded here): AgentsConsole is a
    singleton (get_instance, _legacy.py:285-293) and set_speaker_enabled (:597) is the same
    close-and-reopen primitive livekit's own console UI calls (:1441). If a livekit upgrade
    moves it, _start_output_follow degrades loudly instead of crashing the worker."""
    from livekit.agents.cli._legacy import AgentsConsole
    return AgentsConsole.get_instance()


def _start_output_follow(cfg: dict, publisher, *,
                         console_factory=_console_singleton,
                         watcher_cls=devicewatch.DeviceWatcher,
                         follower_cls=devicewatch.OutputFollower,
                         probe=devicewatch.current_default_output):
    """Start the output-follow watcher when configured; returns it, or None (pin/absent mode).

    Failure to reach the console (livekit internals moved, pycaw missing) is loud-but-running:
    CRITICAL log + /state shows following:false with the boot default — design 'fail loud,
    run anyway'."""
    if cfg.get("tts_output_device") != FOLLOW_SENTINEL:
        return None
    # Startup self-check (spec 'Dependencies'): a dead probe (pycaw missing, COM broken)
    # means the watcher would silently never fire — refuse to claim following:true.
    probe_ok = False
    try:
        probe_ok = probe() is not None
    except Exception:
        pass
    if not probe_ok:
        logger.critical(
            "output-follow configured but the default-endpoint probe returned nothing "
            "(pycaw/comtypes missing or COM failure) — TTS stays on the boot default and "
            "will NOT follow device changes. `pip install pycaw comtypes` into the worker venv.")
        publisher.set_output_device(
            {"configured": FOLLOW_SENTINEL, "resolved": _boot_default_output_name(),
             "following": False})
        return None
    try:
        console = console_factory()
    except Exception:
        logger.critical(
            "output-follow configured but the console audio object is unavailable — TTS stays "
            "on the boot default and will NOT follow device changes", exc_info=True)
        publisher.set_output_device(
            {"configured": FOLLOW_SENTINEL, "resolved": _boot_default_output_name(),
             "following": False})
        return None
    # Review finding #4 (2026-07-21): everything past the two guards must ALSO degrade
    # loudly rather than fail the whole voice job — same "fail loud, run anyway" envelope.
    try:
        import sounddevice as sd
        try:
            # Review finding #2: seed the follower with the boot output index livekit opened,
            # so even the first swap's open-failure has a known-good device to fall back to.
            boot_idx = sd.default.device[1]
        except Exception:
            boot_idx = None
        follower = follower_cls(
            console,
            wake_input_substring=cfg.get("wake_input_device"),
            resolve_output=wakeword.resolve_output_device,
            resolve_input=wakeword.resolve_input_device,
            sd_module=sd,
            initial_idx=boot_idx)

        def _on_change(name: str) -> None:
            publisher.set_output_device(follower.swap_to(name))

        # Review finding #1: hold the first poll 10s past boot — livekit's own
        # set_speaker_enabled call at console-audio-mode entry is the only concurrent
        # caller, and it happens within seconds of startup.
        watcher = watcher_cls(probe=probe, on_change=_on_change, period_s=1.5,
                              initial_delay_s=10.0)
        watcher.start()
        logger.info("TTS output-follow active: tracking the Windows default output device")
        return watcher
    except Exception:
        logger.critical(
            "output-follow wiring failed — TTS stays on the boot default and will NOT follow "
            "device changes", exc_info=True)
        publisher.set_output_device(
            {"configured": FOLLOW_SENTINEL, "resolved": _boot_default_output_name(),
             "following": False})
        return None


class AtlasAgent(Agent):
    """Agent that gives the reflex lane (design §7) its interception point AHEAD of the LLM turn.

    `on_user_turn_completed` is the ONLY livekit-agents 1.6.6 hook that runs after the user turn is
    finalized but BEFORE the reply is generated, and whose `StopResponse` keeps the utterance out of
    the LLM chat context: raising it there returns from `_user_turn_completed_task`
    (agent_activity.py:2334) *before* the user ChatMessage is appended to chat_ctx and before
    `_generate_reply` (verified against the installed source). That is what lets a reflex utterance
    never reach Claude while a normal utterance falls straight through to the fast lane.

    `reflex` is an async `fn(text) -> bool` installed by `entrypoint()` once the voice-loop closures
    exist (None until then, and in --text mode, where it is left unset — same as V0 dismiss)."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.reflex = None

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        handler = self.reflex
        if handler is None:
            return
        text = getattr(new_message, "text_content", None) or ""
        if await handler(text):
            # handled locally as a reflex — suppress the LLM reply AND the chat_ctx insertion.
            raise StopResponse()

    def tts_node(self, text, model_settings):
        # Voice-clean seam (rules design §2): every spoken string — LLM turns AND session.say
        # canned lines — passes through here; sanitize per chunk (split-safe by construction).
        async def _clean():
            async for chunk in text:
                yield sanitize.sanitize_for_tts(chunk)
        return Agent.default.tts_node(self, _clean(), model_settings)


async def entrypoint(ctx: JobContext) -> None:
    repl.load_env()  # DEEPGRAM_API_KEY / ANTHROPIC_API_KEY -> process env, before plugins build
    cfg = _cfg()
    keyterms = seed_keyterms(kb_tools.kb_root())

    # Addressed-speech gate (rules design §1): vocabulary = config base + kb proper nouns.
    # Constructed unconditionally so the conversation_item_added handler can re-arm it in
    # both text and audio modes; user speech never marks it (see addressing.Addressing).
    addr = addressing_mod.Addressing(
        cfg.get("engaged_window_s", 30),
        list(cfg.get("address_vocab") or []) + keyterms)

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
    agent = AtlasAgent(instructions=fastlane.SYSTEM, tools=_kb_function_tools())
    await session.start(agent=agent, room=ctx.room)

    # --- Unified worker state (design §2): a pure observer of the voice loop. The HTTP
    # surface (Task 5), transcript ledger (Task 6), and done-watcher (Task 11) all consume
    # this ONE stream. `voice` mirrors the active config voice.
    publisher = state.StatePublisher(voice=cfg.get("active_voice"))
    # M4 (2026-07-21): surface the TTS output-device pin in /state so a bad pin (configured but not
    # resolved) is visible on the dashboard after Daniel walks away, not just a scrolling log line.
    publisher.set_output_device(_output_device_status(cfg))

    # Output-follow (design 2026-07-21): when tts_output_device is 'follow', a watcher thread
    # tracks the Windows default output endpoint and hot-moves the TTS stream — headphones
    # connect, Atlas speaks there; disconnect, back to the speakers. No restart.
    _start_output_follow(cfg, publisher)

    # Done-watcher (design §8, Task 11): watches the ops queue for the cards Atlas files by voice
    # and speaks their completion. Its sidecar (default %USERPROFILE%\.atlas\watched.json) is
    # restart-safe, so callbacks survive a worker restart. Same configurable ops_root as the ledger.
    watcher = donewatcher.DoneWatcher(cfg.get("ops_root", DEFAULT_OPS_ROOT))

    # Publisher-agnostic post-file hook (design §3/§6, Task 9): when the LLM files a card via
    # file_card/launch_workflow, mirror it into the /state snapshot's `filed_cards` so the orb
    # shows filed work (toolreg stays publisher-agnostic — it only knows a callable), AND register
    # it with the done-watcher so its completion gets a spoken callback (Task 11). The watcher later
    # calls publisher.update_filed_card(id, state) via the announce path as outcomes land.
    def _post_file(p: dict) -> None:
        publisher.add_filed_card(p["id"], p["action"])
        watcher.watch(p["id"], p["action"])
    toolreg.set_post_file_hook(_post_file)

    async def _purge_quiet(item_id: str) -> None:
        # Gate finding #2 (2026-07-21 desk): [quiet] turns left in chat history teach the model
        # that silence answers everything — it began [quiet]-ing DIRECT addresses ("Atlas, can
        # you hear me?"). Drop the marker turn and the ambient user line that triggered it, so
        # ambient noise never accumulates as conversational precedent. chat_ctx.copy() yields a
        # fresh mutable context; update_chat_ctx replaces the agent's (installed agent.py:235).
        ctx = agent.chat_ctx.copy()
        idx = ctx.index_by_id(item_id)
        if idx is None:
            return
        items = ctx.items
        del items[idx]
        if idx > 0 and getattr(items[idx - 1], "role", None) == "user":
            del items[idx - 1]
        await agent.update_chat_ctx(ctx)

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
        if role == "assistant":
            # Gate finding #1 (2026-07-21 desk): a reply to ambient chatter re-armed the window,
            # which kept the next ambient line addressed, whose reply re-armed again — a loop the
            # 30s expiry could never break. A [quiet] turn (the LLM's structural silence) is
            # therefore neither spoken (sanitizer strips it), mirrored, nor window-re-arming.
            if sanitize.is_quiet_turn(text):
                logger.info("quiet turn — no audio, window not re-armed, purged from chat ctx")
                purge = asyncio.create_task(_purge_quiet(msg.id))
                _BG_TASKS.add(purge)
                purge.add_done_callback(_BG_TASKS.discard)
                return
            addr.mark_activity()   # a CONTENT Atlas turn re-arms the window (rules design §1)
        publisher.add_line("atlas" if role == "assistant" else "user", text)

    # --- Local read-only /state surface (design §3, Task 5). Started HERE on the job-context
    # event loop (same placement discipline as _build_tts) so it stays inside the job context and
    # off the wake thread — the V0 landmine. Bound to 127.0.0.1 only; serves publisher.snapshot()
    # + a request-time heartbeat. Started BEFORE the TEXT_MODE return so the --text REPL path also
    # exposes /state (the REPL benefits from the same surface), and its shutdown is registered for
    # both paths.
    state_srv = await stateserver.start(publisher, cfg["state_port"])

    async def _stop_state_server() -> None:
        await state_srv.stop()
    ctx.add_shutdown_callback(_stop_state_server)

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

    # Announcements spoken/queued while ASLEEP are re-told in the next wake greeting (canonical
    # #3). Plain closed-over local; drained + cleared by _engage on wake.
    pending_news: list = []

    # --- Durable transcript ledger (design §5, Task 6): a second consumer of the ONE publisher
    # stream. It buckets each wake-session's lines and, at sleep, commits+pushes them to the ops
    # worktree. It's built with the atlas-worker commit identity inline (never git config) and
    # never raises into the voice loop — a git/network failure retains the lines and retries at
    # the next sleep. ops_root is configurable (default = the real ops worktree).
    ledger = ledgerwriter.SessionLedger(cfg.get("ops_root", DEFAULT_OPS_ROOT))
    ledger.subscribe_to(publisher)

    async def _flush_transcript(sid: str) -> None:
        # Run the synchronous git subprocess work in a thread so the sleep cue / TTS is never
        # blocked (design §5: the voice loop is never blocked by git). flush() never raises.
        await loop.run_in_executor(None, ledger.flush, sid)

    def _sleep(announce: bool = True) -> bool:
        """Close the mic; returns True only on a real transition. Audible cue (Daniel's ask:
        never leave him guessing whether Atlas is still listening)."""
        if not session.input.audio_enabled:
            return False
        session.input.set_audio_enabled(False)
        publisher.set_state(state.ASLEEP)
        logger.info("ASLEEP — mic detached, no audio leaves the PC (wake word to re-engage)")
        if announce:
            session.say(SLEEP_LINE, add_to_chat_ctx=False)
            publisher.add_line("atlas", SLEEP_LINE)  # audible, so it's mirrored
        # Flush this wake-session's transcript to ops as a fire-and-forget task so the sleep cue
        # is never blocked. Capture the session_id NOW — a future wake re-mints it, but the
        # ledger buckets by id so flush(sid) drains exactly this wake's lines.
        sid = publisher.session_id
        if sid is not None:
            flush_task = asyncio.create_task(_flush_transcript(sid))
            _BG_TASKS.add(flush_task)
            flush_task.add_done_callback(_BG_TASKS.discard)
        return True

    def _engage() -> None:
        already = engagement.state == engagement_mod.ENGAGED
        engagement.wake()
        session.input.set_audio_enabled(True)  # open the STT stream — audio now leaves the PC
        logger.info("ENGAGED — listening (silence timeout %ss, or say \"that's all\")",
                    cfg["engagement_timeout_s"])
        if not already:
            addr.mark_activity()                  # wake re-arms the window (rules design §1)
            publisher.start_session()             # new wake-session id per wake
            publisher.set_state(state.LISTENING)
            news = " ".join(pending_news)         # news queued while asleep (canonical #3)
            pending_news.clear()
            greeting = f"Hey boss. {news} What can I do for you?" if news else WAKE_LINE
            session.say(greeting, add_to_chat_ctx=False)  # audible wake greeting
            publisher.add_line("atlas", greeting)         # audible, so it's mirrored

    @session.on("agent_state_changed")
    def _on_agent_state(ev) -> None:
        _apply_agent_state(engagement, publisher, ev.new_state)

    # Gate-C fix (2026-07-21): give the LLM a real go_to_sleep tool so a conversational dismissal
    # that slips past the reflex lane ACTUALLY closes the mic instead of being role-played.
    # LiveKit tool calls run on the event loop, so calling the closures directly is safe.
    def _sleep_via_tool() -> None:
        engagement.dismiss()
        _sleep()
    toolreg.set_sleep_hook(_sleep_via_tool)

    def _on_wake() -> None:  # called from the wake-word thread; hop to the event loop
        loop.call_soon_threadsafe(_engage)

    # NOTE (2026-07-21 fix): there is deliberately NO `user_input_transcribed` -> engagement
    # re-stamp any more. While ENGAGED the mic streams the ENTIRE room to Deepgram, so every sound
    # in the room becomes a "final" transcript — including background conversation Atlas is not part
    # of. Re-stamping the silence clock on those (the old behavior) meant any nearby talking kept
    # Atlas awake indefinitely and the 2-min auto-sleep never fired (Daniel's report, 2026-07-21).
    # The window is now re-opened only by Atlas's own SPEAKING (see _on_agent_state) — a directed
    # interaction — plus wake(). A reflex reply ("repeat that") still keeps Atlas awake, because
    # speaking it flips the session to SPEAKING; reflex classification is unchanged
    # (AtlasAgent.on_user_turn_completed).

    # --- Reflex lane (design §7). intents.yaml is the ONLY matching source; the handler runs ahead
    # of the LLM turn via AtlasAgent.on_user_turn_completed and returns True to suppress the reply.
    intents = _load_intents()

    def _reflex_say(text: str) -> None:
        """Speak a reflex response and mirror it. add_to_chat_ctx=False keeps it out of the LLM
        history (it is not a conversation turn for Claude) AND means it does NOT arrive via
        conversation_item_added — so it is mirrored here, exactly like the "Yes?"/"Going to sleep."
        acks."""
        session.say(text, add_to_chat_ctx=False)
        publisher.add_line("atlas", text)
        addr.mark_activity()   # an Atlas spoken reply re-arms the window (rules design §1)

    def _last_atlas_line() -> str | None:
        for line in reversed(publisher.snapshot()["transcript"]):
            if line["role"] == "atlas":
                return line["text"]
        return None

    def _format_credit(raw: str) -> str:
        if not raw or raw.startswith("ERROR"):
            return "I couldn't reach the credit balance just now."
        try:
            d = json.loads(raw)
        except (ValueError, TypeError):
            return "I couldn't read the credit balance."
        bal, units = d.get("balance", 0), d.get("units", "USD")
        amount = f"about {round(float(bal))} dollars" if units == "USD" else f"{bal} {units}"
        return f"You've got {amount} of Deepgram credit left."

    async def _handle_reflex(text: str) -> bool:
        """Route one final utterance. Returns True (and performs the reflex) on a reflex hit, so the
        Agent suppresses the LLM reply; False -> the utterance flows to the fast lane unchanged.

        Because the reply is suppressed (StopResponse), the user's reflex utterance does NOT arrive
        via conversation_item_added, so BOTH the user line and Atlas's response are mirrored here —
        no double-add (a fast-lane turn, by contrast, is mirrored by the conversation_item_added
        handler and this method adds nothing)."""
        if not text or not text.strip():
            return False
        lane, intent = router.route(text, intents)
        if lane != "reflex":
            if not addr.is_addressed(router.normalize(text)):
                # Not for Atlas (rules design §1): zero LLM, zero TTS. Mirrored for the
                # ledger so desk debugging can see what was gated.
                publisher.add_line("user", text)
                logger.info("gated (not addressed): %r", text)
                return True
            return False
        publisher.add_line("user", text)  # the reflex utterance, mirrored (won't arrive elsewhere)
        if intent == "dismiss":
            engagement.dismiss()
            _sleep()                       # speaks + mirrors "Going to sleep."
        elif intent == "cancel":
            # livekit-agents 1.6.6: AgentSession.interrupt(force=True) (agent_session.py:1356)
            # aborts the in-flight turn — it cancels the current SpeechHandle, which spans LLM
            # generation THROUGH TTS playout (speech_handle.py:160 interrupt -> _cancel), plus any
            # preemptive generation and queued speeches (agent_activity.py:1509). force=True bypasses
            # the allow_interruptions guard. So cancel is wired to a real abort, not just an ack.
            try:
                session.interrupt(force=True)
            except RuntimeError:
                pass                       # no active generation to interrupt — the ack still fires
            _reflex_say("Dropped.")
        elif intent == "repeat":
            last = _last_atlas_line()
            _reflex_say(last if last else "There's nothing to repeat yet.")
        elif intent == "credit":
            # credit_remaining does blocking HTTP; run it off the event loop so the voice loop
            # never stalls, then speak the result compactly.
            raw = await loop.run_in_executor(None, lambda: toolreg.dispatch("credit_remaining", {}))
            _reflex_say(_format_credit(raw))
        return True

    agent.reflex = _handle_reflex

    async def _silence_watcher() -> None:
        while True:
            await asyncio.sleep(1.0)
            # M2 fix (2026-07-21): never sleep out from under an in-flight turn. While Atlas is
            # SPEAKING, re-stamp so silence is measured from the END of the utterance (fixes a >120s
            # reply, and the wake ack, being cut off mid-speech). While THINKING (e.g. a follow-up
            # question asked right at the timeout), defer the sleep decision without extending the
            # window — ambient chatter also spins up THINKING and must not hold Atlas awake. Only
            # when idle-LISTENING do we run the timeout check.
            decision = _silence_decision(publisher.state)
            if decision == "restamp":
                engagement.interacted()
                continue
            if decision == "defer":
                continue
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
    silence_task = asyncio.create_task(_silence_watcher())
    _BG_TASKS.add(silence_task)                # retain handle so the watcher can't be GC'd
    silence_task.add_done_callback(_BG_TASKS.discard)

    # --- Completion callbacks (design §8, Task 11): poll the ops queue for the cards Atlas filed
    # and speak the outcome. The poll (git pull + file scan, blocking) runs off the event loop; it
    # ONLY runs while the sidecar has pending watches, so an idle worker does no git/file work. ----
    announce_when_asleep = cfg.get("announce_when_asleep", True)
    watch_period = cfg.get("watch_period_s", 30)

    def _announce(ann: donewatcher.Announcement) -> None:
        """Deliver one completion callback. ENGAGED -> inline; ASLEEP + announce_when_asleep -> a
        one-shot say that does NOT open STT (audio stays detached, orb stays ASLEEP — TTS out is
        not capture). BOTH speaking paths mirror the line (transcript ring + ledger). The filed-card
        outcome is updated in the /state snapshot regardless of whether we spoke.

        Accepted-for-now (2026-07-21): if a callback fires while ENGAGED, speaking it flips the orb
        to SPEAKING, which re-stamps the silence window (Atlas legitimately spoke to Daniel). A burst
        of completion callbacks could thus extend the window; this is intentional — a callback IS a
        directed interaction — and callbacks are rare (only for cards this session filed)."""
        engaged = engagement.state == engagement_mod.ENGAGED
        if engaged or announce_when_asleep:
            # add_to_chat_ctx=False: a callback is not a conversation turn for Claude, and (like the
            # wake/sleep acks) it therefore does NOT arrive via conversation_item_added, so we mirror
            # it here. The ASLEEP _on_agent_state guard keeps this say from flipping the orb.
            session.say(ann.text, add_to_chat_ctx=False)
            publisher.add_line("atlas", ann.text)
        # ENGAGED -> a spoken callback re-arms the window; not-engaged -> queue for the next wake
        # greeting exactly once whether or not it was spoken (canonical #3, rules design §1).
        if engaged:
            addr.mark_activity()
        else:
            pending_news.append(ann.text)
        # Reflect the outcome on the orb's filed-cards list even if we stayed silent while asleep.
        publisher.update_filed_card(ann.card_id, "done" if ann.outcome == "success" else "failed")

    async def _done_watch_loop() -> None:
        while True:
            await asyncio.sleep(watch_period)
            if not watcher.has_watches():       # cheap sidecar check — no busy git work when empty
                continue
            for ann in await loop.run_in_executor(None, watcher.poll):
                _announce(ann)

    done_task = asyncio.create_task(_done_watch_loop())
    _BG_TASKS.add(done_task)
    done_task.add_done_callback(_BG_TASKS.discard)


def _console_output_args(argv: list[str], cfg: dict,
                         resolve=wakeword.resolve_output_device) -> list[str]:
    """Extra CLI args pinning the TTS OUTPUT device for `console` audio mode (Bug 2, 2026-07-21).

    livekit's console output falls back to `sd.default.device[1]` — the drifting Windows default
    output — and opens its OutputStream on it ONCE at startup (cli/_legacy.py set_speaker_enabled),
    so TTS can end up on an inaudible AirPods HFP sink and never follow Daniel switching to the main
    speaker. When atlas.yaml sets `tts_output_device` (a name substring, exactly like
    `wake_input_device`) and an audio console is running without an explicit --output-device, we
    resolve it to a device index and pass `--output-device <idx>`, which livekit hands straight to
    sounddevice. Returns [] (system default, unchanged) when: not a console run, --text/--list-devices,
    an explicit --output-device is already present, no config key, or the configured device is not
    found (resolve() logs a loud warning — never a silent swap)."""
    if "console" not in argv or "--text" in argv or "--list-devices" in argv:
        return []
    if any(a == "--output-device" or a.startswith("--output-device=") for a in argv):
        return []
    substring = cfg.get("tts_output_device")
    if not substring:
        return []
    if substring == FOLLOW_SENTINEL:
        # Output-follow mode: pass no flag. livekit opens on the boot-time default, which
        # IS the current Windows default at start; the devicewatch follower moves the
        # stream afterward (docs/specs/2026-07-21-atlas-output-follow-design.md).
        return []
    idx = resolve(substring)
    if idx is None:
        # Loud, non-fatal: Atlas still starts, but Daniel is told WHY he may hear nothing.
        logger.critical(
            "TTS output device %r not found — Atlas will fall back to the system default output, "
            "which on this machine drifts to an inaudible Bluetooth sink; you may hear nothing. "
            "Fix `tts_output_device` in atlas/config/atlas.yaml or connect the named speaker.",
            substring)
        return []
    try:
        import sounddevice as sd
        name = sd.query_devices(idx)["name"]
    except Exception:
        name = "?"
    logger.info("TTS output pinned to device [%d] %s (config tts_output_device=%r)",
                idx, name, substring)
    return ["--output-device", str(idx)]


def main() -> int:
    # Pin the TTS output device from config before livekit resolves the (drifting) system default.
    try:
        sys.argv.extend(_console_output_args(sys.argv, _cfg()))
    except Exception:
        logger.exception("could not resolve tts_output_device — using the system default output")
    # Desk finding (2026-07-21, pm2 rollout): the console's STT mic is a SEPARATE capture from
    # the wake listener and defaults to the OS default input — which drifts to AirPods HFP
    # (unusable) while indices reshuffle on BT connect (the V0 landmine). A raw name substring
    # can't ride the CLI flag: the same physical mic appears under MME/DirectSound/WASAPI and
    # sounddevice raises on multiple matches — so resolve the INDEX here at start time with the
    # wake listener's own resolver (first input device matching the name, same pin, same config
    # key). An explicit user-passed flag wins.
    if "console" in sys.argv and "--input-device" not in sys.argv:
        idx = wakeword.resolve_input_device(_cfg().get("wake_input_device"))
        if idx is not None:
            sys.argv += ["--input-device", str(idx)]
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
    return 0


if __name__ == "__main__":
    sys.exit(main())
