# atlas — STATE

_Updated: 2026-07-20 (build ACTIVE — Fable 5 boss session)_

## Now
- V0 build RUNNING. Tasks 1–6 code complete: T1–T5 done + inspector-graded (T3 96 / T4 96 / T5 96
  PASS; T5 live REPL smoke passed 2026-07-20). T6 built + task-reviewed (Spec PASS, Quality
  Approved): voice worker at claude/atlas d0ca81a, card 6a5c8ad2-df7abf53 in working awaiting
  Daniel's desk smoke (Step 6).
- **Pairing verdict (livekit/agents#2519) REVERSED by live desk evidence (2026-07-20 late): app.py
  uses the function_tool fallback (72c2fed).** The one-turn pairing smoke passed both paths, but in a
  real multi-turn session the native MCP attach 400s on the second LLM call — MCP TextContent carries
  an `annotations` field the Anthropic API rejects (`tool_result.content.0.text.annotations: Extra
  inputs are not permitted`), poisoning chat history. Function tools delegate to fastlane._dispatch
  in-process; kb-MCP server remains the boundary for external consumers. Retest native attach on
  livekit-agents upgrade (>1.6.6 / MCPToolset), and deepen pairing_smoke to two turns first.
- 2026-07-20 amendments (delta design §11): no LiveKit account V0–V2 (console mode, serverless);
  TTS bake-off = Deepgram Aura-2 (presumed default, $200 credit) vs ElevenLabs (Daniel's existing
  paid sub, scoped key); Cartesia scratched by Daniel; fast lane ≈ $10/mo, $20 cap. Barge-in pinned
  to VAD (adaptive interruption needs LiveKit-hosted inference — deliberately absent).

## Next
- Daniel desk smoke (T6 Step 6): from atlas worktree `atlas/` dir, `.venv\Scripts\python -m worker.app console`,
  speak "what's in the queue?" → spoken grounded answer (headphones — console mode has no AEC).
- Then T6 card close + inspector grade → T7 (wake word + engagement gating) → T8 (latency harness +
  Aura-2-vs-ElevenLabs persona bake-off + V0 checkpoint).
- V1 backlog (Daniel, 2026-07-20): hot-follow audio device routing — console streams bind at startup;
  want output to re-bind live to the connected Bluetooth device (else speakers) without app restart.
  Context: wake mic is PINNED to the laptop Intel array (wake_input_device) because Windows default-input
  drift to AirPods HFP delivers unusable wake audio; conversation/output follow the Windows default.

## Blocked
- ON DANIEL: desk smoke above. All account gates CLOSED 2026-07-20 (env has ANTHROPIC/DEEPGRAM/ELEVENLABS keys).
- Pre-existing unrelated: unstaged HEARTBEAT.md modification in dashboard-ops worktree (not atlas's; preserve).
