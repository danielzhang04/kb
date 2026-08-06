# Atlas Remote Audio — Design Spec

**Date:** 2026-08-06
**Status:** Approved shape (Daniel, 2026-08-06: include Atlas; browser-tab audio).
**Sequenced:** AFTER `2026-08-06-cloud-migration-design.md` Phase 3 cutover — the
brain joins a live VM, not a half-migrated one.

## Goal

Atlas's brain (orchestration in `atlas/run-worker.js` + its Python worker, STT→
LLM→TTS loop) runs on the cloud VM. Its ears and mouth stay at Daniel's desk:
the dashboard browser tab (already open at `http://localhost:5317` via the
tunnel) captures the mic and plays Atlas's replies.

**Success condition:** with zero Atlas processes on the desktop, Daniel speaks at
his desk, the dashboard tab streams audio to the VM brain, and Atlas's spoken
reply plays back through the same tab — round-trip subjectively as usable as the
current local V1.

## Non-goals

- Always-listening without the dashboard tab open. Daniel chose browser-tab audio
  over a resident desktop bridge; tab closed ⇒ Atlas is deaf. Accepted. (A thin
  native bridge remains a possible later add-on; nothing here forecloses it.)
- Phone/other-device audio, multi-listener, or public access.
- Changing Atlas's brain pipeline (STT/TTS providers, V2a scope). Transport only.

## Load-bearing design decision: WebSocket, not WebRTC

The tunnel already gives the tab a direct, private, low-latency TCP path to the
VM. WebRTC's machinery (STUN/TURN/ICE, SDP) exists to traverse NATs we don't
have. Therefore: **one WebSocket endpoint on the existing daemon** carrying audio
frames both ways.

- Uplink: tab captures mic via `getUserMedia` (works on `http://localhost` — it
  is a secure context), encodes fixed-size PCM16 mono 16 kHz frames (~20–60 ms),
  sends binary WS messages. No client-side VAD/wake-word; the brain's existing
  pipeline decides what is speech (confirm at read-time — see Unknowns).
- Downlink: brain sends TTS audio as binary frames + small JSON control messages
  (`speaking-start/stop`, transcript echo for the UI); tab plays via Web Audio.
- Backpressure: if WS `bufferedAmount` exceeds a cap, drop mic frames oldest-first
  and surface a "degraded" indicator; never buffer unbounded.
- Auth: the endpoint mounts on the daemon and follows the SAME session/gating
  discipline as the existing hub SSE/WS surfaces — no new auth model. Mic data
  is treated like attempt IO: never persisted unless the brain already persists
  transcripts.

## Components

1. **`dashboard/src/atlas/` tab client** — mic capture, frame encode, WS,
   playback, tiny status strip (listening / speaking / degraded / disconnected)
   in the existing dashboard chrome. Auto-reconnect with backoff; reconnect is
   session-resume, not a new conversation.
2. **Daemon WS endpoint** (`dashboard/server/atlas/` route) — dumb pipe +
   framing/auth; relays to the brain process over its existing local IPC (or
   stdin/stdout if that is what run-worker uses today — confirm at read-time).
3. **Brain adapter on VM** — `atlas/run-worker.js` ported off the hardcoded
   `.venv/Scripts/python.exe` to the Linux venv (this is also cloud-migration P-list
   adjacent but lands here, with the consumer that needs it); audio source/sink
   swapped from local devices to the relay. Runs as a systemd user unit like the
   rest of the fleet.

## Error handling

- Tab closed / WS dropped: brain pauses listening state cleanly (no half-open
  session); status strip shows disconnected; reconnect resumes.
- Mic permission denied: explicit UI state with the fix (browser permission),
  never a silent failure.
- Brain process dead: WS endpoint returns a distinct close code; tab shows
  "Atlas offline" rather than spinning.

## Unknowns to resolve by READING before planning (not by guessing)

The plan's first task is a read-only sweep of `atlas/` (worker code, V1 Hands
merge, V2a spec PR #51) answering: (a) how audio I/O enters the pipeline today
(device API? file? stream?), (b) where VAD/wake-word runs, (c) the brain's IPC
shape, (d) what the spend-capped Atlas key exception (CLAUDE.md preamble §2)
touches so it is preserved intact on the VM. The plan is written against those
findings; this spec constrains shape, not those internals.

## Testing

- Unit: frame codec round-trip; backpressure drop policy; reconnect resume.
- Integration: fake-brain echo server — tab sends N frames, receives them back,
  plays; WS close-code paths.
- Acceptance (human): Daniel has one spoken exchange with Atlas through the tab,
  desktop process audit shows zero Atlas processes locally.
