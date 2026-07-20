# Atlas — Voice Interface for the Agentic OS — Design Specification

**Date:** 2026-07-15
**Status:** Draft for user review — deliberately stops short of implementation planning (the kb substrate is still landing M1; the implementation plan is written against the substrate as actually shipped)
**Owner:** Daniel (daniel.zhang.t1@gmail.com)
**Destination:** commit to `kb/docs/specs/` once the M1 workflow completes; Atlas is then scaffolded as `orgs/atlas/` and built by the fleet.
**Process:** Coordinated by Claude (Fable 5); video analysis of creator-built Jarvis systems and 2026 voice-stack research performed by Opus 4.8 subagents (`model: "opus"` harness override).

---

## 1. Goal

A Jarvis-class voice interface over the entire kb agentic OS: summon it by name at the desk, converse continuously, ask it to pull things up, report on any project, file tasks, launch workflows, and approve gated actions — with spoken responses in a chosen persona, sub-second perceived latency, and proactive completion callbacks for work it was asked to run. Voice is one touchpoint among several (dashboards, GitHub, phone surfaces remain); it is the lowest-friction one while at the computer.

### Non-goals (v1)
- No phone/mobile voice until V3 (design keeps the path open: same backend, PWA client).
- No always-on room assistant beyond the desk PC; laptop closed = Atlas off.
- No speech-to-speech frontier model as the conversationalist (Stack C is the documented escape hatch, not the plan).
- No custom wake-word hardware; mic is whatever the PC has.

## 2. Decisions (settled with user)

| Decision | Choice |
|---|---|
| Architecture | **Stack A — cascade with Claude brain**, engineered for latency (three-lane router) |
| Touchpoint v1 | Desktop only, wake-word summoned, continuous conversation while engaged |
| Name | **Atlas** (config value + retrainable wake word — renaming later is an afternoon) |
| Persona | Decided by ear at build time from TTS samples (butler / chief-of-staff / casual candidates); persona prompt is swappable markdown |
| Authority | **Full peer to keyboard** — including spoken T3 approvals via readback + explicit confirm |
| Identity bar | Desk presence = identity (logged-in PC session; same threat model as keyboard) |
| Proactive voice | ONLY completion callbacks for work the user asked Atlas to run; everything else is visual or on-demand |
| Ambient visual | Slim always-on-top status surface: running workflows, progress, approval/wake-me badges, Atlas state (LISTENING/THINKING/SPEAKING/MUTED) |
| Budget | ~$50/mo for the voice layer (target stack lands ~$35–45) |
| Build home | kb org project (`orgs/atlas/`), built by the fleet under normal governance |
| Reach | **kb + workspace control**: open/focus apps, files, tabs, window arrangement, media — but NO arbitrary command execution by voice (that stays behind task cards) |
| Listening | **Gated**: audio streams to STT only between wake word and dismissal/timeout; nothing leaves the PC before wake |
| Conversation memory | **Distilled**: decisions, taught preferences, action items appended to project memory post-session; raw transcripts kept briefly for approval audit only |
| Visualizer | **Orb** (Jarvis-circle lineage) when engaged, collapsing to the slim strip when idle; exact look iterated from rendered samples at build time |
| Latency bar | Reflex actions ~200–400 ms; conversational turns 500–800 ms; long work = instant ack + async callback |

## 3. Why a cascade (the decisive research fact)

Anthropic has no realtime speech API as of mid-2026. Claude app voice mode is consumer-only (no API); Claude Code voice mode is dictation-only with no hooks or speech output. Keeping Claude as the brain therefore requires assembling wake word → streaming STT → Claude → streaming TTS. 2026 components make this hit 500–800 ms voice-to-voice — inside the ~2 s "still feels like Jarvis" threshold observed across every credible creator build. If Anthropic ships a realtime speech API, revisit; the MCP tool surface (§6) is the part that survives any such swap.

What actually makes the reference builds feel fast (video research, 7 systems): instant end-of-turn detection, acknowledgment before the full answer, actions firing while the voice confirms, and barge-in. A 600 ms cascade with those behaviors beats a 300 ms S2S model without them.

## 4. Architecture — three lanes

```
[Mic] → openWakeWord (local, always-on while PC awake; custom "Atlas" model; $0, Apache-2.0)
      → LiveKit Agents worker (Python, desktop PC; self-host or free cloud tier)
           ├─ Deepgram Flux STT (streaming; built-in end-of-turn ~300 ms — the key latency component)
           ├─ ROUTER
           │    ├─ REFLEX (~200–400 ms): deterministic intent match → local action,
           │    │    speech confirms in parallel. Pull up X / show queue / open file /
           │    │    file a card / launch a known workflow. No LLM in the loop.
           │    ├─ FAST (~500–800 ms): Claude (Haiku default, Sonnet escalation) via
           │    │    livekit-plugins-anthropic + kb-MCP tools, prompt-cached KB context,
           │    │    streamed into TTS at first sentence.
           │    └─ WORK (async): task card onto ops queue (dispatcher consumes it) or
           │         Claude Agent SDK run. Instant spoken ack; spoken callback on completion.
           ├─ TTS: Cartesia Sonic (latency leader) or ElevenLabs Flash (persona/cloning) — chosen by ear
           ├─ Barge-in: user speech immediately halts TTS (LiveKit adaptive interruption)
           └─ Proactive channel: ops-queue watcher → voice (only §7-permitted) + status surface
```

**Supporting pieces:**
- **kb-MCP server** — the single integration boundary (§6).
- **Screen driver** — local tool set: open/focus apps and files, render dashboard views in browser. Desktop-tier only; never available to cloud agents.
- **Status surface** — §8.
- **Session model:** wake word opens an engagement window; conversation continues hands-free until explicit dismissal ("that's all") or timeout. Mute is one hotkey and one voice command. All state transitions visible on the status surface.

## 5. Component choices (mid-2026 research)

| Slot | Pick | Why | Cost |
|---|---|---|---|
| Wake word | openWakeWord | Picovoice free tier sunset 2026-06-30; oWW is Apache-2.0, Windows/ONNX, custom-trainable | $0 |
| Voice framework | LiveKit Agents (~1.5.x) | Native MCP support, first-party Anthropic plugin, adaptive barge-in, async background tasks, mobile SDKs for V3, self-hostable | $0–tier |
| STT | Deepgram Flux | Integrated end-of-turn <300 ms median; purpose-built for voice agents | ~$0.0065/min (~$6–10/mo) |
| Fast-lane LLM | Claude Haiku 4.5 → Sonnet escalation | Claude stays the brain; caching keeps TTFT low | ~$3–15/mo |
| TTS | Cartesia Sonic **or** ElevenLabs Flash | 40–90 ms vs ~75 ms TTFA; ElevenLabs wins on persona/cloning — decided by ear with persona | $0–22/mo |
| Slow path | Task cards + Claude Agent SDK | Already exists / subscription-covered | $0 marginal |

**Total: ~$15–45/mo** depending on TTS tier. Alternative components (AssemblyAI, Pipecat, Gemini Live) evaluated and documented in research; none change the architecture.

## 6. kb integration — the MCP boundary

One small MCP server over the kb checkout exposes, to any surface (Atlas first, phone later):
- **Read:** dashboards, `orgs/*/STATE.md`, wiki files, queue contents by state, ledger rollups, running-work summary.
- **Write (all through existing governance):** `file_card` (validated via `scripts/cards.py`; lands in `queue/inbox/` on ops — the dispatcher does the rest), `launch_workflow` (files the card DAG for a declared workflow), `record_approval` (§9 only).
- **Never:** direct file edits in project trees, pushes to main, anything in governance/. Atlas requests work; the fleet performs it under contract.md rules.

This means Atlas's "hands" are the queue — it inherits concurrency discipline, audit (every action is a commit), risk tiers, and the kill switch (STOP file halts Atlas's work lane like every other loop; mute/process-kill stops the voice loop itself) without new mechanisms. The shared preamble runs before work-lane actions like any agent.

## 7. Proactivity rules

Voice speaks uninvited in exactly one case: **completion (or failure) of work the user asked Atlas to run**, at any duration — short, medium, or long.

Everything else is silent-by-default:
- Other projects' events, fleet activity, human checkpoints (approvals waiting, wake-me cards, budget alerts) → **visual only** (status surface badges/toasts), plus available on demand: "what's running?", "anything need me?", morning brief on request.
- Non-fast workflows the user launched also show **visual progress** (milestones/toasts) between ack and spoken completion.
- Etiquette: if the user is mid-utterance or the mic detects an active call, spoken callbacks queue and deliver at the next quiet moment.
- The rules live in `orgs/atlas/proactivity.md` — tunable by editing markdown, no code changes.

## 8. Status surface

A slim always-on-top desktop panel (corner strip), part of the Atlas org project:
- Atlas state: LISTENING / THINKING / SPEAKING / MUTED (the highest-value trust feature in every studied build).
- Live transcript of the current exchange.
- Running workflows with coarse progress; badges for approvals pending and wake-me cards; today's budget spend.
- Data source: the same ops-branch state the dashboards use — the surface is a renderer, not a new state store.
- Audio-reactive **orb** when engaged (user decision: Jarvis-circle lineage; color/motion encodes LISTENING/THINKING/SPEAKING; final look iterated from rendered samples at build time). Idle collapses to the slim strip; the orb appears when Atlas is awake.
Form (tray widget vs pinned browser panel vs terminal HUD) is an implementation-plan decision.

Companion file: `2026-07-15-atlas-voice-layer-research.md` — condensed research findings (creator-build analysis, component data, Anthropic voice-API status) so this spec is self-sufficient for a fresh builder.

## 9. Spoken approvals (T3 gate compliance)

The kb treats agent-set `approval` fields as tampering; approvals must be human-minted. Atlas therefore acts as a **human proxy channel**, equivalent in trust to Omnara's tap:
1. Atlas reads the approval card back fully (action, target, scope, e.g. diff size, tests state).
2. Only an explicit confirm that echoes the action or card ("approve the merge", "approve card 7") counts. Bare "yes" is insufficient. "Show me first" pulls the diff/artifact on screen. "Reject" and "later" are first-class.
3. On confirm, the gateway commits the approval (content hash per spec §7 mechanics) under **Daniel's own git identity** from the logged-in desktop session, and the dispatcher verifies it exactly as it would a GitHub-mobile approval.
4. Every spoken approval is ledgered identically to tapped/merged ones; the voice session transcript is retained alongside.
Identity bar is desk presence (user decision): anyone at the unlocked PC could already approve via browser; Atlas adds no weaker path. A confirmation-phrase or speaker-verification upgrade is a config-level tightening documented for later, not built in v1.

## 10. Persona and name

- Wake word/name: **Atlas**. Stored as config; renaming = retrain openWakeWord model (~1 hr) + edit persona prompt.
- Persona selection at build time: generate 3 fixed sample replies (a status report, a completion callback, an approval readback) in ~5 candidate voices across butler / chief-of-staff / casual registers; pick by listening. Persona prompt + voice ID live in `orgs/atlas/persona.md`.
- Writing style rule regardless of persona: answers lead with the point, one breath long by default; detail goes to screen ("it's on your monitor") rather than monologue.

## 10.5 Learning — taught preferences without prompt rot

Atlas is teachable in conversation ("from now on, when I say X, do Y") with automatic encoding. The bloat risk of an ever-growing preference list is designed out by routing each teaching to the right store by KIND:

| Kind | Example | Home | Prompt cost |
|---|---|---|---|
| Command mapping (majority) | "'show me X status' → open these files/views" | `orgs/atlas/intents.yaml` — structured trigger→action entries consumed by the reflex lane | **Zero** (lookup table, not prompt text) |
| Persona rule | "when you wake, respond with XXX" | `orgs/atlas/persona.md` — small, hard size cap | Tiny, capped |
| Behavioral preference | "be terser during mornings"; per-project reporting styles | `orgs/atlas/preferences.md`, scoped per-project where possible; loaded only when relevant | Bounded by scoping |

Flow: Atlas writes the entry as a `learned`-tier item, confirms aloud, effective immediately. The existing weekly review **composts** these stores: dedupe, conflict detection (surfaced to the user, never silently resolved), consolidation-instead-of-append when the size budget is hit, promotion of stable items to curated — the same provenance-tier discipline the kb applies to skills. Learning rides the kb's §8.1 loops; no new subsystem.

## 11. Phasing (milestone-level only — implementation plans come per-phase, post-M1)

- **V0 — Loop:** wake word → Flux → Claude fast lane with read-only kb-MCP tools → TTS. Ask about anything in the kb, get a spoken answer. Already exceeds Claude Code voice mode.
- **V1 — Hands:** reflex lane + screen driver; file cards, launch known workflows; work-lane acks and spoken completion callbacks; status surface v1.
- **V2 — Trust:** spoken approvals; proactivity rules + quiet-moment queueing; morning brief; persona polish.
- **V3 — Reach:** phone PWA over the same LiveKit backend; optional Twilio number ("call Atlas"); lessons-driven iteration.

Each phase is independently useful. V0–V1 depend only on M1 substrate (queue, cards, dispatcher, dashboards); V2's approval flow depends on M1b's approval loop being live.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Cascade latency disappoints in practice | Flux EOT + streamed TTS + reflex lane first; documented escape hatch: Stack C (realtime front-end delegating to Claude) reuses the same MCP surface |
| STT mishears domain terms (observed today in Claude Code dictation) | Deepgram keyword boosting/keyterm prompting seeded from kb project names + skill names, regenerated by the nightly loop |
| Wake-word false triggers / privacy discomfort | Local-only detection; hard mute (hotkey + voice + tray); visible state; audio never leaves the PC before wake |
| Voice approval misfire | Full readback + action-echo confirm; T3 still hash-bound + 24 h expiry; ledgered with transcript |
| Vendor churn (2026 voice market moves fast) | Every component behind an interface LiveKit already abstracts (STT/TTS/LLM plugins); MCP boundary isolates the OS from the voice stack entirely |
| Cost creep from always-listening | Wake word is local/$0; STT streams only during engagement windows; ledgered to `ledgers/cost/atlas-*.tsv` under the existing budget guard |
| kb architecture drifts before build | This doc pins intent, not file paths; implementation plan is written against shipped M1 |

## 13. Open questions (deferred to implementation planning, deliberately)

1. Status surface form: tray widget vs pinned browser panel vs terminal HUD.
2. TTS vendor + voice + persona register (decided by ear).
3. Reflex-lane intent matching: keyword grammar vs tiny local model vs Haiku-with-tight-timeout.
4. Engagement-window timeout length; whether "Atlas" mid-sentence re-opens it.
5. Whether the fast lane runs on API keys (scoped, capped, ledgered) or an Agent SDK session riding the Max subscription — cost/latency trade to measure, not guess.
6. Exact Agent SDK ↔ LiveKit callback plumbing (SDK task lifecycle events looked right in research; verify against shipped SDK version at build time).
