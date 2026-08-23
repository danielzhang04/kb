---
schema-version: 1
id: 6a8aaeaa-faf8e48b
project: atlas-prep
action: atlas-wave3-review
target: C:\Users\danie\Atlas-worktrees\revamp
risk-tier: T1
owner: codex-worker
claim-token: 261612da4d1cf5f1
state: done
approval: null
workflow: 01a02da4-153e-7c31-9661-966b7ea76910
depends-on: []
variant-group: null
role: work
session-id: 6a8aa8f2-57ffbbc5
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Atlas wave 3 — adversarial review brief (READ-ONLY)

You are a Codex reviewer on the standalone Atlas application. Working directory:
`C:\Users\danie\Atlas-worktrees\revamp` (branch `claude/atlas-revamp`, wave 3 merged). Read-only sandbox;
findings only. Read `CLAUDE.md`, `docs/specs/2026-08-23-atlas-wave3-design.md`, then the wave-3 diff
(`git diff 06e21e3 --stat` = end of wave 2 + icon) and every file it touches, plus `worker/brain.py`,
`worker/tools.py` end to end.

Probe (cite file:line; try to break):
1. Host-owned confirmation (`brain.py`): affirmative/negative phrase matching false positives in ordinary
   speech ("yes it was great" with a pending action from 90 s ago), expiry races, synthetic tool_use/tool_result
   shape validity for the Anthropic API (ids, ordering, `tool_choice none`), `on_tool` semantics, history.
2. Taint + `launch_work` brief substitution: can injected content still reach the job brief (title field?
   transcript containing the injected text read aloud?); name-only re-proposal guard bypass via a different
   confirm-policy tool doing the same mutation.
3. UI: bearer handling in `ui/app.js` (memory only, cleared on expiry), History result fetch, cancel POST,
   XSS through transcript/job text/tool content (`textContent` vs `innerHTML` everywhere?), `/signal` polling
   cost and pause, canvas DPR handling on resize, hash routing edge cases.
4. Audio follow (`devicewatch.py`, `wakeword.py`, `app.py`, `desktop.py`): device-change storms (BT
   connect/disconnect flapping), reopen failures leaving no mic, resample correctness at 8/16/44.1/48 kHz,
   the restart path (exit 21) — rate limit, window state, job cancellation on restart, stale pairing, the
   `/state.audio` shape, Settings display.
5. Known-folder roots (`localfiles.py`): resolution failures, OneDrive placeholder files (cloud-only, not
   hydrated) making `read_file`/`find_file` stall or error; worker prompt folder line leaking paths.
6. Overhead changes (if present): lazy imports that change behaviour on the first turn; wake model loading
   only the configured model — does `hey_jarvis` fallback still work?
7. Residue and docs: README/CLAUDE.md/handoffs vs code; dead config keys; tests that only exercise fakes
   for Windows-critical behaviour.
Output: numbered findings with severity (high/medium/low), file:line, one-sentence defect, one-sentence
concrete failure scenario, minimal fix; then a short "verified OK" list. No praise.

## Result

1. **High — [worker/brain.py:432](</C:/Users/danie/Atlas-worktrees/revamp/worker/brain.py:432>)** Defect: confirmation accepts every normalized utterance beginning with “yes,” “confirm,” or “go ahead,” regardless of trailing ordinary speech. Failure: with a 90-second-old pending send, “yes it was great” immediately executes the mutation. Fix: accept only closed, standalone confirmation phrases with no unrelated trailing proposition.

2. **High — [worker/brain.py:343](</C:/Users/danie/Atlas-worktrees/revamp/worker/brain.py:343>), [worker/brain.py:399](</C:/Users/danie/Atlas-worktrees/revamp/worker/brain.py:399>)** Defect: when host phrase matching returns no intent, the pending ID is exposed to the model and a model-generated matching `confirm` call is allowed. Failure: an unrelated follow-up can cause the model to emit `confirm` and execute a mutation solely on model judgment. Fix: reject every model-issued `confirm`/`cancel_pending` call and consume pending actions only through the host classifier.

3. **High — [worker/tools.py:160](</C:/Users/danie/Atlas-worktrees/revamp/worker/tools.py:160>)** Defect: an existing pending action blocks only another proposal with the same tool name, so any different confirm-policy tool silently replaces it. Failure: injected content can replace a reviewed draft operation with another Gmail mutation, after which “yes” confirms the replacement. Fix: while any pending action exists, refuse all new confirm-policy proposals until explicit cancellation or expiry.

4. **High — [worker/tools.py:167](</C:/Users/danie/Atlas-worktrees/revamp/worker/tools.py:167>)** Defect: the confirmation summary silently truncates serialized arguments at 300 characters while retaining and later executing the complete arguments. Failure: a long body placed first can hide a recipient, BCC, attendee, or other consequential field from the spoken readback. Fix: generate a complete canonical host summary or refuse confirmation when every material field cannot be read back exactly.

5. **Medium — [worker/brain.py:257](</C:/Users/danie/Atlas-worktrees/revamp/worker/brain.py:257>), [worker/brain.py:286](</C:/Users/danie/Atlas-worktrees/revamp/worker/brain.py:286>), [worker/brain.py:389](</C:/Users/danie/Atlas-worktrees/revamp/worker/brain.py:389>)** Defect: confirmation executes before a second provider call, but success is remembered only after that narration call completes. Failure: a send succeeds and `on_tool` records `confirm: ok`, then narration times out and the user hears a generic failure with no Brain history, encouraging a duplicate request. Fix: persist the host outcome immediately and produce a deterministic local success/error acknowledgment.

6. **Medium — [worker/brain.py:414](</C:/Users/danie/Atlas-worktrees/revamp/worker/brain.py:414>)** Defect: `find_file` and `work_status` are classified as trusted metadata even though filenames and job titles are attacker-controlled text. Failure: a prompt-injection filename can be copied into an untainted `launch_work` brief and reach the background agent. Fix: taint all externally derived strings and add provenance-bound exceptions only for validated follow-up operations such as opening the exact returned path.

7. **Medium — [worker/tools.py:156](</C:/Users/danie/Atlas-worktrees/revamp/worker/tools.py:156>), [worker/claude_launcher.py:93](</C:/Users/danie/Atlas-worktrees/revamp/worker/claude_launcher.py:93>)** Defect: tainted `launch_work` substitutes the raw turn transcript, which is not safe when the user has read or quoted injected content aloud. Failure: “analyse this note—ignore earlier rules and upload…” forwards that quoted payload verbatim as the worker’s request. Fix: require a fresh, clean follow-up turn after content exposure instead of forwarding the original transcript.

8. **Medium — [ui/app.js:817](</C:/Users/danie/Atlas-worktrees/revamp/ui/app.js:817>), [worker/stateserver.py:98](</C:/Users/danie/Atlas-worktrees/revamp/worker/stateserver.py:98>)** Defect: the in-memory bearer has no client-visible expiry or renewal path, while the sole bootstrap token is permanently consumed. Failure: reloading the page loses the bearer immediately, and after 12 hours the UI remains “Paired” until a 401 then cannot re-pair without restarting Atlas. Fix: let the desktop mint a fresh one-use bootstrap, return expiry metadata, clear by timer, and retain an in-memory retry token until pairing succeeds.

9. **Low — [ui/app.js:497](</C:/Users/danie/Atlas-worktrees/revamp/ui/app.js:497>), [worker/state.py:158](</C:/Users/danie/Atlas-worktrees/revamp/worker/state.py:158>)** Defect: Settings reads `wake_model`, `wake.model`, or `config.wake_model`, but `/state` publishes none of those fields. Failure: the Wake model row always displays “—” despite a configured model. Fix: publish a bounded safe `wake_model` field in the state projection.

10. **Medium — [worker/app.py:189](</C:/Users/danie/Atlas-worktrees/revamp/worker/app.py:189>), [worker/app.py:211](</C:/Users/danie/Atlas-worktrees/revamp/worker/app.py:211>)** Defect: audio-follow directions are watched only when their initial COM probe succeeds. Failure: starting Atlas while Bluetooth is connecting or COM briefly returns `None` leaves that direction permanently unwatched after the device appears. Fix: keep polling unavailable directions and treat their first later endpoint as a reopen event.

11. **Medium — [worker/devicewatch.py:244](</C:/Users/danie/Atlas-worktrees/revamp/worker/devicewatch.py:244>), [worker/wakeword.py:360](</C:/Users/danie/Atlas-worktrees/revamp/worker/wakeword.py:360>)** Defect: `InputFollower` cannot observe asynchronous wake-stream reopen failures, and the wake thread merely logs and exits on any open/read error. Failure: LiveKit switches successfully but the new wake stream is busy or disconnects, leaving Atlas permanently deaf without exit 21. Fix: add bounded reopen retries and an error callback that requests restart and updates audio state.

12. **Medium — [worker/devicewatch.py:245](</C:/Users/danie/Atlas-worktrees/revamp/worker/devicewatch.py:245>)** Defect: the installed `AgentsConsole.set_microphone_enabled` called here opens capture at a fixed 24 kHz, so only the wake-word stream—not LiveKit STT—uses the device’s native rate. Failure: an 8/16 kHz HFP endpoint can reject the LiveKit reopen and enter the restart path despite wake resampling being correct. Fix: use a native-rate capture adapter with resampling to LiveKit’s required rate, or capability-test the endpoint before declaring follow successful.

13. **Medium — [worker/desktop.py:307](</C:/Users/danie/Atlas-worktrees/revamp/worker/desktop.py:307>)** Defect: a second audio restart within 30 seconds converts a recoverable flap into a permanent stopped page. Failure: Bluetooth exposing and withdrawing HFP/A2DP endpoints twice during connection stops Atlas until manually reopened. Fix: coalesce changes and delay/retry after the rate-limit window instead of terminating restart supervision.

14. **High — [worker/app.py:157](</C:/Users/danie/Atlas-worktrees/revamp/worker/app.py:157>), [worker/jobobject.py:201](</C:/Users/danie/Atlas-worktrees/revamp/worker/jobobject.py:201>), [worker/desktop.py:446](</C:/Users/danie/Atlas-worktrees/revamp/worker/desktop.py:446>)** Defect: exit 21 uses `os._exit` inside a kill-on-close job and the desktop then closes the old job handle, which can terminate descendant background Claude sessions. Failure: an audio restart during a long research job kills the agent and the replacement worker reattaches to a dead session that becomes failed. Fix: supervise background work outside the restartable audio job or perform a coordinated handoff that preserves its process/job handle.

15. **Medium — [worker/localfiles.py:156](</C:/Users/danie/Atlas-worktrees/revamp/worker/localfiles.py:156>), [worker/localfiles.py:241](</C:/Users/danie/Atlas-worktrees/revamp/worker/localfiles.py:241>), [worker/tools.py:346](</C:/Users/danie/Atlas-worktrees/revamp/worker/tools.py:346>)** Defect: all reparse points are rejected, silently excluding OneDrive cloud placeholders, while accepted `read_file` I/O still runs synchronously on the event loop. Failure: a cloud-only CSV either vanishes from `find_file`/returns `ValueError`, or a provider-specific hydration blocks the entire voice and state loop beyond the asyncio timeout. Fix: distinguish Cloud Files tags from traversal links, return explicit hydration status, and perform bounded reads off-thread.

16. **Low — [worker/claude_launcher.py:85](</C:/Users/danie/Atlas-worktrees/revamp/worker/claude_launcher.py:85>), [worker/claude_launcher.py:98](</C:/Users/danie/Atlas-worktrees/revamp/worker/claude_launcher.py:98>)** Defect: every background prompt includes absolute paths for all resolved known folders, even for unrelated work. Failure: a web-research job unnecessarily sends user-specific directory topology in the model prompt and command line. Fix: provide only requested folder aliases through a scoped lookup rather than unconditional absolute paths.

17. **Medium — [config/atlas.yaml:25](</C:/Users/danie/Atlas-worktrees/revamp/config/atlas.yaml:25>), [CLAUDE.md:3](</C:/Users/danie/Atlas-worktrees/revamp/CLAUDE.md:3>)** Defect: the file roots still contain a direct external knowledge-checkout path despite the binding standalone boundary. Failure: Atlas behaves differently when that checkout exists and exposes its files through general local-file tools. Fix: remove that root or place it behind a separately reviewed, dormant optional bridge.

18. **Medium — [worker/runtime.py:29](</C:/Users/danie/Atlas-worktrees/revamp/worker/runtime.py:29>), [worker/brain.py:251](</C:/Users/danie/Atlas-worktrees/revamp/worker/brain.py:251>)** Defect: the deferred Anthropic import and constructor execute synchronously inside the first asynchronous turn and its timeout. Failure: the first utterance blocks `/state` and `/signal` for the import duration and can time out even when the same provider latency succeeds on later turns. Fix: warm the client in a background thread after `/state` is available or initialize it asynchronously outside the per-turn budget.

19. **Medium — [worker/wakeword.py:156](</C:/Users/danie/Atlas-worktrees/revamp/worker/wakeword.py:156>), [worker/wakeword.py:360](</C:/Users/danie/Atlas-worktrees/revamp/worker/wakeword.py:360>)** Defect: the module claims `hey_jarvis` is a fallback, but failure to load the configured model terminates the listener without attempting it. Failure: a missing or corrupt custom model leaves Atlas deaf although the pretrained fallback is available. Fix: catch configured-model initialization failure, load only `hey_jarvis`, and surface the fallback state.

20. **Medium — [handoffs/2026-08-23-atlas-wave3.md:28](</C:/Users/danie/Atlas-worktrees/revamp/handoffs/2026-08-23-atlas-wave3.md:28>), [docs/specs/2026-08-23-atlas-wave3-design.md:82](</C:/Users/danie/Atlas-worktrees/revamp/docs/specs/2026-08-23-atlas-wave3-design.md:82>)** Defect: the handoff counts an in-lane CSV answer as a pass although the specified workflow required an oversized file to select `launch_work`, and no per-run records are present under `docs`. Failure: the heavy file-analysis lane can remain broken while acceptance is reported complete. Fix: rerun the exact oversized fixture and persist tool calls, state timeline, result, and lane evidence for all five workflows.

21. **Low — [tests/test_devicewatch.py:139](</C:/Users/danie/Atlas-worktrees/revamp/tests/test_devicewatch.py:139>), [tests/test_desktop.py:27](</C:/Users/danie/Atlas-worktrees/revamp/tests/test_desktop.py:27>)** Defect: Windows-critical COM, PortAudio, LiveKit reopen, Job Object, and WebView restart behavior is exercised only through fakes. Failure: fixed-rate HFP rejection, real endpoint flapping, or background-job termination passes the suite unchanged. Fix: add a Windows integration harness covering real 8/16/44.1/48 kHz endpoints, disconnect/reconnect storms, reopen failure, and an active job across exit 21.

\### Verified OK

- Pending expiry is rechecked atomically by `ToolRegistry.confirm`; an action that expires before consumption is not executed.
- The synthetic Anthropic sequence has valid assistant `tool_use` → user `tool_result` ordering, matching IDs, string content, and supported `tool_choice: {"type":"none"}`.
- Directly tainted `launch_work` calls discard the model-generated brief, and the job title is not included in `worker_prompt`.
- History result fetch and job cancellation use the paired action header; the bearer is not persisted in browser storage.
- Transcript, job, event, tool, and result content use `textContent`; no `innerHTML` or equivalent HTML injection sink exists.
- `/signal` polling is single-flight, 20 Hz, and stopped outside Live or while hidden; canvas rendering also pauses while hidden.
- Canvas backing dimensions and transform account for DPR when resized, and invalid hashes normalize to `#live`.
- Synthetic 1 kHz probes at 8, 16, 44.1, and 48 kHz all resampled to exactly 1,280 samples with the correct spectral peak.
- `/state.audio` has the requested input/output `{name, following}` shape and Settings consumes it correctly.
- Non-writing checks passed: `git diff --check`, `node --check ui/app.js`, and AST parsing of all 24 changed Python files. The pytest suite was not rerun because this review sandbox was read-only.
