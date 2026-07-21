# Atlas TTS output follows the Windows default device — design

**Date:** 2026-07-21 (late) · **Approved:** Daniel, in-terminal ("design 1 is fine")
**Branch:** `claude/atlas-voice-rules` (the code the live worker runs)
**Motivating incident:** PR #55/#60 pinned TTS output statically to `Speakers (Realtek`. Daniel: output
should follow whatever is connected (headphones, AirPods, speakers) with **no worker reboot**. Live
confirmation at design time: Windows default output was the Px7 headphones while Atlas was pinned to
Realtek.

## Goal

When the Windows **default output device** changes (Bluetooth headphones connect, headphones unplug,
user switches default), Atlas TTS moves to the new default within a few seconds, in-process. The wake
**input stays pinned** (`wake_input_device: Intel`) — Bluetooth HFP mics are unusable; this is
deliberate and unchanged.

## Non-goals

- No input-device following.
- No priority/preference list ("prefer headphones over speakers") — Windows already moves its default
  on connect; we follow Windows, we do not re-rank it.
- No OS-level notification elegance (IMMNotificationClient callbacks): polling is chosen deliberately
  (COM apartment + asyncio callback threading is fiddly; a 1.5s poll is imperceptible and robust).

## Mechanism (verified against installed livekit-agents `cli/_legacy.py`)

- `AgentsConsole` is a **singleton** (`_legacy.py:285-293`, `get_instance()`); our worker code can
  reach the live console object in-process.
- `set_speaker_enabled(enable, *, device)` (`:597`) **closes and reopens** the sounddevice
  `OutputStream` on the given device — the hot-swap primitive already exists; livekit itself calls it
  (`:1441`). `set_microphone_enabled` (`:562`) is the input analogue (used only in the full-reinit
  path, re-pinned to Intel).

## Design

### Config (`atlas/config/atlas.yaml`)

`tts_output_device: follow` — new sentinel value, becomes the shipped default.
- `follow` → follow mode (this design).
- any other string → today's static substring pin, unchanged behavior.
- absent/no-match → today's fallback (system default at boot, loud warning).

### Watcher (`worker/devicewatch.py`, new)

A dedicated daemon thread (`CoInitialize`d) polls the current Windows default output endpoint via
`pycaw` (`GetDefaultAudioEndpoint(eRender, eMultimedia)`), period **1.5s**, comparing the **endpoint
ID string** (not the name — IDs are stable and unique). On change it invokes the swap callback with
the endpoint's FriendlyName. Pure-decision core (`decide(prev_id, current_id) -> action`) is a
separately testable seam; the thread is a thin shell around it.

### Swap orchestration (in `app.py`, small hook)

On watcher callback with new endpoint name:
1. Resolve name → PortAudio output device index via existing `wakeword.resolve_output_device`
   (substring match against the PA snapshot; MME truncates names at 31 chars — match on a prefix of
   the FriendlyName, consistent with existing resolver behavior).
2. **Common path** (endpoint present in PA's boot snapshot — true for already-paired devices):
   `AgentsConsole.get_instance().set_speaker_enabled(True, device=idx)`. Mid-utterance: immediate
   cutover (a dropped syllable beats speaking into a disconnected sink).
3. **Rare path** (endpoint not in snapshot — first-ever-paired device mid-session): full audio
   re-init — `set_microphone_enabled(False)`, `set_speaker_enabled(False)`, `sd._terminate()`,
   `sd._initialize()`, reopen mic via re-resolved `wake_input_device` pin, reopen speaker via step-1
   resolution against the fresh snapshot.
4. **Failure** (name unmatched / device unopenable): keep the current stream, log **CRITICAL**,
   `/state` reflects reality — never a silent wrong-device swap. Because `set_speaker_enabled`
   closes the old stream BEFORE opening the new one, the swap **pre-validates** the candidate
   (`sd.query_devices(idx, kind="output")`) before calling it; if the open still raises after
   pre-validation, immediately reopen the previous device (its index is retained) so a failed swap
   costs a blip, not deafness. The rare-path teardown likewise happens only after the fresh
   snapshot confirms the device exists.

### `/state` (M4 parity)

`output_device` becomes `{configured: "follow", resolved: <current PA device name>, following: true}`.
Pin mode keeps today's shape plus `following: false`. `resolved` always states the device the stream
is actually open on.

### Dependencies

`pycaw` + `comtypes` (pure-Python) added to `atlas/requirements.txt` and installed into the worker
venv. If `pycaw` import fails at startup with `follow` configured: CRITICAL log, behave as today
(boot default), `/state` shows `following: false` — fail loud, run anyway.

## Threading note

The watcher thread never touches asyncio state. The swap calls (`set_speaker_enabled` etc.) mutate
only the console object's own stream fields, matching how livekit's own keyboard toggle invokes them
from its console thread; calls are serialized through a lock in our hook so watcher-driven and
future-manual swaps cannot interleave.

## Tests

Same seam style as #55's `_apply_agent_state`/`_silence_decision`:
- `decide()` matrix: first poll (baseline, no action), same ID (no action), changed ID (swap action),
  COM error (no action + counted).
- Swap orchestration with a **mocked console object** + mocked resolver: common path calls
  `set_speaker_enabled(True, device=idx)` once; unmatched name → no console call + CRITICAL; open
  failure → stream untouched; rare path ordering (mic closed → PA reinit → mic reopened → speaker
  reopened) verified by call sequence.
- `/state`: follow mode surfaces `{configured: follow, resolved, following: true}`.
- Config parsing: `follow` sentinel vs pin string vs absent.
- Real plug/unplug verification is **manual (Daniel)**: connect Px7 → TTS moves to Px7 ≤ ~3s;
  disconnect → back to Realtek; `/state` tracks each move.

## Files

- `atlas/worker/devicewatch.py` — new: poller thread + `decide()` seam.
- `atlas/worker/app.py` — hook: start watcher when `follow` configured; swap orchestration + lock.
- `atlas/worker/wakeword.py` — only if resolver needs a fresh-snapshot variant for the rare path.
- `atlas/config/atlas.yaml` — `tts_output_device: follow` + comment rewrite.
- `atlas/worker/state.py` / snapshot surface — `following` field.
- `atlas/requirements.txt` — `pycaw`, `comtypes`.
- `atlas/tests/test_devicewatch.py` — new; small additions to `test_state.py`.

## Risks / accepted residuals

- **PortAudio snapshot staleness** is handled by the rare-path reinit; the reinit closes the mic for
  well under a second — an in-flight wake utterance in that exact window can be lost (accepted; the
  event is a first-ever device pairing mid-session).
- Polling cadence 1.5s: up to ~3s worst-case switch latency (accepted).
- If Windows moves the default to an endpoint PA cannot open (exotic virtual sink), Atlas keeps the
  previous device and shouts in the log + `/state` (accepted; matches "never silent" rule).

## Rollout

Build + tests on `claude/atlas-voice-rules` → venv `pip install pycaw comtypes` (worker stopped by
Daniel) → Daniel restarts worker → manual plug/unplug verification → this branch's eventual PR to
main carries the feature with the rest of the voice-rules work.
