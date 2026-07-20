# atlas — STATE

_Updated: 2026-07-20 late (V0 LIVE at desk — Fable 5 boss session)_

## Now
- **V0 COMPLETE and WORKING at Daniel's desk.** T1–T8 done, all six inspector grades 96 PASS T2.
  PR #37 (claude/atlas → main) open, now through f9375bd. Full loop verified live: "hey Atlas"
  (custom model) → wake ack → multi-turn grounded kb answers → dismiss/2-min silence → sleep cue.
- **Custom wake model DELIVERED 2026-07-20:** Daniel's Colab-trained `hey_atlas.onnx` lives in
  `atlas/config/`; wakeword.py loads custom models by path (predict-key = file stem, verified
  against installed oww 0.6.0 source), pretrained `hey_jarvis` kept as one-line fallback in
  atlas.yaml. Triggered reliably at threshold 0.5, no tuning needed. (8203cdf)
- **Active voice: mars** (Deepgram aura-2, $0 on credit) — Daniel's pick, switched after live
  desk session. Matilda (ElevenLabs) remains in the toggle. (f9375bd)
- Two desk-discovered fixes shipped during hey_atlas bring-up (both were latent since the voice
  toggle landed; first console run on the ElevenLabs path exposed them):
  - elevenlabs plugin must import at module level (main-thread registration) — fbc7a99
  - elevenlabs TTS needs the job-context http session passed explicitly, because our first
    synthesis fires from the wake-thread callback outside the context var — 7c6cf50

## Desk prerequisites (operational, not code)
- **Windows default INPUT must be the Intel mic array**, not the AirPods hands-free mic.
  Root cause of the "silent Matilda" desk session 2026-07-20: while AirPods HFP holds default
  input, Windows mutes the AirPods A2DP output the console plays into. With Intel as default
  input, AirPods work as pure output. (Settings → System → Sound → Input.)
- Run: `cd kb-worktrees\atlas\atlas; .venv\Scripts\python -m worker.app console --input-device 2`.
- Known cosmetic: on Ctrl+C shutdown the wake thread logs a scary "Atlas is DEAF" CRITICAL
  (PortAudio teardown race). Harmless at exit; polish candidate = suppress during shutdown.

## Next
- MERGED 2026-07-20: PR #37 (V0 wave) and PR #39 (hey_atlas + desk fixes + mars flip) — main
  matches the desk. PAUSED at Daniel's request; resume point in boss session memory.
- RESUME ACTION: draft V1 "Hands" wave plan for Daniel's review (delta design §5/§7):
  dashboard status panel + orb sequenced FIRST (read-only slice), then reflex lane, file_card,
  launch_workflow, completion callbacks. Backlog to weave in: persona.md authoring session
  (explicitly wanted), TTFT input diet, spoken voice-switch, hot-follow Bluetooth output
  routing, Deepgram credit-remaining tool.
- Retest native MCP attach on livekit-agents upgrade >1.6.6 (anthropic_compat shim removal
  condition: upstream #2519-class fix + two-turn pairing_smoke pass).

## Blocked
- Nothing in-flight. All build work paused pending Daniel's two gates above.
