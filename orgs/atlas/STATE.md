# atlas — STATE

_Updated: 2026-07-20 (build ACTIVE — Fable 5 boss session)_

## Now
- V0 build RUNNING. Tasks 1–6 code complete: T1–T5 done + inspector-graded (T3 96 / T4 96 / T5 96
  PASS; T5 live REPL smoke passed 2026-07-20). T6 built + task-reviewed (Spec PASS, Quality
  Approved): voice worker at claude/atlas d0ca81a, card 6a5c8ad2-df7abf53 in working awaiting
  Daniel's desk smoke (Step 6).
- **Pairing verdict (livekit/agents#2519, 2026-07-20): native-mcp PASS, function-tool PASS** on
  installed livekit-agents 1.6.6 → app.py uses native MCP attach (`Agent(mcp_servers=[MCPServerStdio…])`).
  Retest condition: on upgrade past 1.6.6, re-run atlas/worker/pairing_smoke.py (the 1.6.6 wiring is
  deprecated in favor of MCPToolset in 1.7).
- 2026-07-20 amendments (delta design §11): no LiveKit account V0–V2 (console mode, serverless);
  TTS bake-off = Deepgram Aura-2 (presumed default, $200 credit) vs ElevenLabs (Daniel's existing
  paid sub, scoped key); Cartesia scratched by Daniel; fast lane ≈ $10/mo, $20 cap. Barge-in pinned
  to VAD (adaptive interruption needs LiveKit-hosted inference — deliberately absent).

## Next
- Daniel desk smoke (T6 Step 6): from atlas worktree `atlas/` dir, `.venv\Scripts\python -m worker.app console`,
  speak "what's in the queue?" → spoken grounded answer (headphones — console mode has no AEC).
- Then T6 card close + inspector grade → T7 (wake word + engagement gating) → T8 (latency harness +
  Aura-2-vs-ElevenLabs persona bake-off + V0 checkpoint).

## Blocked
- ON DANIEL: desk smoke above. All account gates CLOSED 2026-07-20 (env has ANTHROPIC/DEEPGRAM/ELEVENLABS keys).
- Pre-existing unrelated: unstaged HEARTBEAT.md modification in dashboard-ops worktree (not atlas's; preserve).
