# atlas — STATE

_Updated: 2026-07-19 (paused by Daniel)_

## Now
- V0 build PAUSED mid-wave. Full resume map: docs/plans/2026-07-19-atlas-v0-HANDOFF.md on branch
  claude/atlas (pushed to origin; worktree C:/Users/danie/kb-worktrees/atlas).
- Tasks 1–5 built + reviewed clean (T3: 96 PASS, T4: 96 PASS; T5 at ad5fa9a, 14/14 tests, card
  6a5c8ad2-1d991c23 in working awaiting live smoke).

## Next
- On resume: preamble → check %USERPROFILE%\.atlas\env → key present ⇒ Task 5 Step 9 live REPL smoke,
  card close + grade; vendor keys present ⇒ Task 6 (pairing smoke BEFORE app.py).
- Ask Daniel: API-only fast lane, or add warm-SDK vs API comparison to Task 8's latency harness (unanswered).

## Blocked
- ON DANIEL: gate 3 (scoped ANTHROPIC_API_KEY into %USERPROFILE%\.atlas\env) + gate 4 (LiveKit/Deepgram/
  Cartesia/ElevenLabs accounts, keys into same file). Gates 1 (contract ratified) + 2 (CLAUDE.md carve-out) DONE.
- Pre-existing unrelated: unstaged HEARTBEAT.md modification in dashboard-ops worktree (not atlas's; preserve).
