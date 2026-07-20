# Atlas voice layer — condensed research findings (2026-07-15)

Companion to `2026-07-15-atlas-voice-layer-design.md`. Research by Opus 4.8 subagents: video analysis of creator-built Jarvis systems + 2026 voice-stack landscape.

## A. Creator-build analysis (7 systems)

| System | What it is | Key lesson |
|---|---|---|
| FatihMakes "Jarvis Mark X–XLIX" (github.com/FatihMakes/Mark-XLVIII) | Most complete real build; Gemini Live single-pipe (STT+LLM+TTS); full PC control, planner/executor, ~40 public iterations | ~1–2 s turns feel fine WITH good mechanics; false self-triggering forced an F4 mute; visible LISTENING/SPEAKING/THINKING/MUTED states; speaks errors aloud |
| Eddie Chen "Friday" (yt 8FEo2RqOSCI) | LiveKit Agents + Claude Code build; email draft→readback→confirm→send; live camera vision | Sub-second turn-taking + barge-in + confirm-before-destructive = the "feels smart" trifecta; personality/wit carries more than visuals |
| Kev Blackburn "Mattar" | No-code (Lovable+n8n+ElevenLabs) operator dashboard w/ voice front-end; demo is SIMULATED | The product concept worth stealing: proactive "what matters today" brief + signals→intelligence→actions dashboard |
| isair/jarvis (github, ~1.4k★) | 100% local: Ollama+Whisper+Piper; wake word mid-sentence; unlimited MCP tools w/ embedding-based tool-relevance filtering; knowledge-graph memory | Best MCP routing + ambient-listening design; self-echo cancellation; "stop" interruption |
| eadmin2/jarvis_ai | Hermes agent + faster-whisper + ElevenLabs + HUD | ALLOW/DENY approval cards + STOP key + command previews = best power-with-control UX; honest 3–5 s round trip on stitched local stack |
| harsh-raj00/my-jarvis | React/Three.js HUD + Gemini + ElevenLabs | HUD is cosmetic; auto-discovered plugin dir is the reusable idea |
| lukebuildsai "Jarvis Agent OS" (IG seed #1) | Manager→specialist agent team over SLACK (text, not voice); course funnel | The orchestration archetype; approval rules as "final say" principles |

IG seed #2 (@dhaibuilds) reposts @fatihmakes. @agentcoreai: login-walled, unidentifiable; same niche, low loss.

**Cross-cutting:** impressive-vs-toy = deliberate barge-in, visible state, confirm-before-destructive, <~2 s turns, wit. **Universal gaps** (= Atlas's kb-provided advantages): true async task callbacks, tasteful proactivity, voice-driven multi-agent, real memory, permissions depth, non-happy-path reliability.

## B. Decisive platform fact

**Anthropic has NO realtime speech API (verified July 2026).** Claude app voice mode = consumer-only, no API. Claude Code voice mode (since 2026-03-03) = dictation ONLY: speech→prompt text, no speech out, no hooks, requires claude.ai login, free, no tokens (code.claude.com/docs/en/voice-dictation). → Claude-as-brain requires a cascade. Watch for the consumer voice mode graduating to API; the MCP boundary survives any swap.

## C. Component data (mid-2026)

- **Wake word:** Picovoice free tier SUNSET 2026-06-30 (existing free keys disabled; paid ~$6k/yr scale). **openWakeWord**: Apache-2.0, Windows/ONNX, custom word trainable from synthetic speech in Colab, $0. Home Assistant ecosystem migrated to it.
- **Framework:** **LiveKit Agents** ~1.5.x–1.6.x: native MCP tool attach, first-party `livekit-plugins-anthropic`, adaptive interruption, async background tasks that inject messages into live sessions, mobile SDKs, fully self-hostable; cloud free tier fine for one user. Runner-up: Pipecat 1.5 (more DIY, MCPClient, AnthropicLLMService). Vapi/Retell = call-center economics ($0.07–0.31/min realistic), ruled out.
- **STT:** **Deepgram Flux** — integrated end-of-turn detection, median EOT <300 ms (saves 200–600 ms vs STT+VAD), $0.0065/min EN. Alternatives: ElevenLabs Scribe v2 Realtime ~150 ms; AssemblyAI ~$0.15/hr but bills idle; local Whisper not competitive for streaming turn-taking. Deepgram supports keyword/keyterm boosting → seed with kb project/skill names (mitigates domain-term mishearing).
- **TTS:** **Cartesia Sonic 3** ~90 ms TTFA (Turbo ~40 ms), Pro from $4/mo, cloning. **ElevenLabs Flash v2.5** ~75 ms model latency, best cloning/persona, Creator $22/mo, ~$0.04–0.10/min. Budget: Deepgram Aura-2 (~$0.030/1k chars), no cloning.
- **S2S alternatives (rejected as primary):** OpenAI GPT-Realtime-2 ~$0.06–0.11/min real-world (mini ~$0.02–0.05); Gemini Live ~$0.005–0.018/min (cheapest); Nova 2 Sonic ~$0.015/min. All put a non-Claude model in charge of the conversation and the tool-call decisions.
- **Claude API (fast lane):** Haiku 4.5 $1/$5 per MTok; Sonnet 4.6 $3/$15 (intro $2/$10 to 2026-08-31); Opus 4.6 $5/$25. Agent SDK emits typed task lifecycle events (TaskStarted/Progress/Notification) — the async-callback hook; verify against shipped SDK at build time. Max subscription may cover slow-path SDK usage at flat cost (open question §13.5 of the spec).

## D. Cost model (1–2 h conversation/day, ~40% billable speech)

| Tier | Stack | Est./mo |
|---|---|---|
| Cheap | oWW + LiveKit free + Flux + Cartesia free/Pro + Haiku + sub-covered slow path | ~$10–20 |
| **Mid (target)** | + ElevenLabs Creator (cloned voice) + Sonnet fast lane w/ caching (+ optional Twilio number $2–4) | **~$35–45** |
| Premium | GPT-Realtime front-end + Claude behind | ~$120–200 (rejected: over budget + wrong brain) |

## E. Phone path (V3, pre-researched)

PWA voice client over LiveKit WebRTC (same backend, $0 extra; mic OK on Android PWA, workable iOS Safari) → later native via LiveKit mobile SDKs → optional Twilio number (+LiveKit SIP $0.003–0.004/min, number ~$1.15/mo) as "call Atlas from anything" fallback.
