# Atlas V1 "Hands" — design

**Status:** approved by Daniel 2026-07-20 (conversation gate, boss session).
**Amends:** `2026-07-19-atlas-build-delta-design.md` §5 (V1 row) and §7 — every other decision in
that doc and the 07-15 spec stands. Written after V0 shipped live (PRs #37, #39 merged; desk loop
verified). V2 "Trust" is deliberately **not** designed here — Daniel chose to plan V2 after the V1
checkpoint, informed by what V1 ships.
**Supersedes:** the "Atlas itself: excluded" line in `2026-07-19-fleet-layers-arc-design.md` —
Daniel confirmed 2026-07-20 that dashboard integration rides V1.

## 1. Scope

V1 gives Atlas hands and a face, in that order:

- **Slice 1 — Status surface (sequenced first, Daniel's call):** a unified worker state core, a
  local read-only HTTP surface, a dashboard Atlas view with a big orb + live transcript +
  activity history, a **global mini-orb** visible from every dashboard view, and a durable
  transcript ledger on ops.
- **Slice 2 — Hands:** reflex lane, `file_card`, `launch_workflow` (card-backed),
  `credit_remaining`, card-completion callbacks, and the persona.md gate.

Checkpoint: Daniel files a card by voice, watches the orb track every stage, and hears its
completion callback.

Deferred (named, so they don't silently vanish): TTFT input diet, spoken voice-switch, hot-follow
Bluetooth output routing, SSE push upgrade for the panel, tray widget, any panel write-back
control (V1 dashboard stays strictly read-only — Daniel reaffirmed 2026-07-20), Agent SDK
in-process workflow execution (V2 candidate), native MCP attach retest (unchanged condition:
livekit-agents upgrade with the #2519-class fix).

## 2. Worker state core

V0 has no unified state: engagement is ASLEEP/ENGAGED, and thinking/speaking live invisibly
inside `AgentSession`. V1 adds `worker/state.py` — a small publisher owning:

- **`AtlasState`: `ASLEEP | LISTENING | THINKING | SPEAKING`.** ENGAGED and idle = LISTENING;
  LLM turn in flight = THINKING; TTS audio playing = SPEAKING. OFFLINE is not a worker state —
  it is what the dashboard derives when the endpoint is unreachable.
- **One event stream** (in-process subscriber list, event-loop-only, no locks): state changes
  and final transcript lines (user *and* assistant). Everything downstream — HTTP snapshot,
  transcript ring, ledger writer, done-watcher announcements — consumes this stream; nothing
  taps `AgentSession` twice.
- **Transcript ring buffer** (last ~50 lines) for the HTTP snapshot.

Hook points (from code recon of shipped V0): the existing `_engage()`/`_sleep()` closures in
`app.py` (already funnel every ASLEEP↔ENGAGED transition, already on the event loop); the
existing `user_input_transcribed` handler; **new** `session.on(...)` handlers for assistant-turn
lifecycle (assistant text is never observed in V0). Exact event names MUST be verified against
the installed `livekit-agents==1.6.6` source before writing handlers — standing V0 landmine:
never trust remembered API surface.

Riding polish fix: suppress the spurious "Atlas is DEAF" CRITICAL during Ctrl+C teardown
(shutdown flag checked by the wake thread's error path).

## 3. Worker HTTP surface

An aiohttp server (aiohttp is already a transitive dep of livekit-agents) started inside
`entrypoint()` on the existing event loop — same placement discipline as `_build_tts()`, which
keeps it inside the job context and off the wake thread (the V0 landmine). Bound to
**`127.0.0.1:4360`** (config `state_port` in atlas.yaml; dashboard daemon owns 4317).

One endpoint, `GET /state`, JSON snapshot:

```json
{
  "version": 1,
  "state": "ASLEEP|LISTENING|THINKING|SPEAKING",
  "since": "<iso — when state last changed>",
  "heartbeat": "<iso — now, proves liveness>",
  "session_id": "<wake-session id or null>",
  "voice": "mars",
  "transcript": [{"t": "<iso>", "role": "user|atlas", "text": "..."}],
  "filed_cards": [{"id": "...", "action": "...", "state": "inbox|working|done|..."}]
}
```

Read-only, localhost-only, never touches or reflects process env (the scoped-key carve-out means
this surface must be provably key-free). No other routes in V1.

## 4. Dashboard: Atlas view + global mini-orb

The dashboard is the Vite + React SPA served by the Fastify daemon (`127.0.0.1:4317`) — not
Next.js. Two Atlas placeholders exist today; V1 resolves them to **one** surface:

- **Top-level nav view** (Daniel's pick): promote `nav/config.ts`'s existing
  `{ id: 'atlas', status: 'soon' }` to `live`, add the `ViewBody` case, new `src/views/Atlas.tsx`
  + `src/styles/views/atlas.css`. This amends the locked entity-first nav IA — recorded here as
  Daniel's amendment (2026-07-20).
- The static stub under the Sentinel tab bar (`views/panels/Atlas.tsx`) is **retired** in the
  same change — no third surface.

**Server side:** `dashboard/server/panels/atlas.ts` mirroring the `health.ts`/`usage.ts` panel
shape — GET `/api/panels/atlas`, pre-auth read-only tier (it can trigger nothing), fetches
`ATLAS_STATE_URL` (default `http://127.0.0.1:4360/state`) with a short timeout via an
**injected fetch** (the `claudeWorkerAdapter` DI precedent, so fixture tests need no live
worker). Unreachable/timeout/malformed → explicit `{ state: "OFFLINE", ... }` shape with the
last-known heartbeat if any — never a blank panel. It also merges filesystem context the daemon
already has: recent transcript-ledger files (§5) for the activity-history pane and `atlas`-project
queue cards for running work.

**Full Atlas view:** big orb visual (state-colored pulse: LISTENING steady, THINKING shimmer,
SPEAKING pulse, ASLEEP dim, OFFLINE hollow + "last seen \<heartbeat age\>"), state word, live
transcript in the house Timeline idiom (dense single column, auto-scroll with freeze + "N new"
pill), activity history (past sessions from the ledger), and the cards/workflows Atlas has filed
with their queue states.

**Global mini-orb (Daniel's addition, 2026-07-20):** a small orb mounted at the App-shell level,
rendered on **every** view. Hidden while ASLEEP/OFFLINE; appears in a corner and pulses through
LISTENING/THINKING/SPEAKING whenever Atlas wakes; click navigates to the Atlas view. Voice
interaction is unaffected by which tab is open — the mic is the desk worker's, the browser never
captures audio in V1; the dashboard is a mirror at two zoom levels.

**Data flow:** one shared poller hook (plain `fetch` + `useState`/`useEffect` — house convention,
no new libraries) polling `/api/panels/atlas` at ~1s while the tab is visible, feeding both the
mini-orb and the full view; the existing `/events` SSE tick triggers refetch of the
filesystem-derived parts. If 1s orb lag annoys at the desk, the SSE upgrade is a named follow-on,
not a redesign.

## 5. Transcript ledger

The worker appends each session's turns as JSONL to
`orgs/atlas/output/transcripts/YYYY-MM-DD-<session_id>.jsonl` in the **ops worktree**
(`{"t", "role", "text"}` lines, one file per wake-session), then commits and pushes ops **once at
session end** (sleep/dismiss transition), under the constitution's pull-rebase-before-write rule
with the standard rejected-push→reconcile→retry loop. Failures log and retry at the next sleep —
the voice loop is never blocked by git. Git operations go through an injected runner seam so
tests use a throwaway repo + bare remote, no network.

## 6. Voice tools

**Registry consolidation first (refactor, no behavior change):** today a new tool must be edited
into four places (`kb_tools.py`, kbmcp `server.py`, `fastlane.py` TOOLS+`_dispatch`, `app.py`
`_kb_function_tools()`). V1 collapses to **one registry** (name, description, input schema,
callable) that fastlane, the LiveKit function_tool wrapper, and the MCP server all consume.
Lands before any new tool so the additions below are one-place edits.

- **`file_card(project, action, target, risk_tier, body, confirmed)`** — calls
  `cards.new_card(...)` + `save(...)` into `queue/inbox/` on ops (same git seam as §5) and
  **stops**: the dispatcher assigns owners; Atlas never claims, transitions, or self-assigns.
  Cards are stamped `workflow: atlas-voice` so the surface is auditable. Read-back confirm is
  enforced structurally: the tool schema requires `confirmed: true`, and persona/system
  instructions require Atlas to read back project/action/target/risk-tier and get a spoken yes
  before setting it. `orgs/atlas/contract.md` already classes filing cards as
  queues-for-me/supervised — V1 keeps that: the card lands in inbox for the normal dispatch path,
  nothing acts alone.
- **`launch_workflow(workflow, project, action, target, risk_tier, body, confirmed)`** —
  card-backed (Daniel's pick over the Agent-SDK-in-process alternative): `file_card` with the
  card's `workflow` field set to the named workflow. The dispatcher/fleet runs it on subscription
  billing; nothing executes on Atlas's spend-capped key; governance path identical to any other
  card. Agent SDK typed task events are deferred to V2 planning.
- **`credit_remaining()`** — calls Deepgram's balances API with the worker's own
  `DEEPGRAM_API_KEY`; answers "how much credit is left." Key never leaves process env.

## 7. Reflex lane

`router.py` grows the real three-lane dispatch (`reflex | fast | work` — stubbed and unit-tested
since V0). Reflex = `atlas/config/intents.yaml`: normalized (case/punctuation-stripped)
exact-phrase and anchored-regex matching, no LLM call. V1 intents: dismiss variants (migrating
out of the hardcoded `dismiss_phrases` list), "cancel / never mind" (abort in-flight turn),
"repeat that" (replay last atlas line from the ring), "how much credit is left" →
`credit_remaining`. Unmatched → fast lane, unchanged. Engagement timeout stays 120s.
The `work` lane routes utterances that name filing/launching to the fast lane's tool loop (the
LLM drives `file_card`/`launch_workflow` with the confirm flow) — `work` as a distinct execution
path beyond that is V2 territory.

## 8. Completion callbacks

A done-watcher task in the worker (event-loop timer, ~30s period, only while cards are pending)
polls the ops worktree queue for the card IDs **this session filed** (persisted in a small local
sidecar so a worker restart doesn't orphan them; git-pulls before reading). When a watched card
reaches `done` (or a failure state), Atlas speaks the result: if ENGAGED, inline; if ASLEEP, a
one-shot spoken announcement **without opening STT** (config `announce_when_asleep: true`) —
audio still only ever *leaves* the PC while engaged; TTS out is not capture.

## 9. Persona

`fastlane.SYSTEM`'s hardcoded string moves to **`atlas/config/persona.md`**, loaded by a small
loader consumed by both the live path (`Agent(instructions=...)`) and the REPL/fastlane. The
content is written in a **co-authoring human gate with Daniel** (explicitly wanted) placed before
the V1 checkpoint so the demo speaks in the chosen persona; until that gate, the file carries the
V0 system text verbatim (pure relocation, no behavior change).

## 10. Verification

V0 discipline unchanged — everything testable without audio hardware:

- `state.py` publisher, ring, HTTP snapshot: pytest on the event stream + aiohttp test client.
- Ledger + card tools: pytest against the conftest `kb_fixture` (real card schema) + throwaway
  git repo with a local bare remote for the ops seam.
- Dashboard route: `__fixtures__` + `app.inject` with injected fetch (OFFLINE, healthy, and
  malformed-worker-response cases). Server TS honors the `--experimental-strip-types` floor.
- Router/intents: pure unit tests. REPL drives lanes end-to-end typed (grows a `/state`-less mode
  check so it still runs without the server).
- Desk facts (orb feel, callback audio, mini-orb behavior) verified only at the two human gates.

## 11. Execution model

Delta design §9 unchanged: cards on ops (`project: atlas`, `workflow: atlas-v1`), implementers
Opus 4.8 or below (model self-reported AND orchestrator-verified), orchestrator reviews every
diff and owns pushes/ops writes, inspector grades fresh-context, human gates one at a time:
**gate A** = Slice-1 desk check (orb + panel live), **gate B** = persona co-authoring,
**gate C** = V1 checkpoint (card by voice → orb tracks → completion callback heard).
Work branch `claude/atlas` (worktree `C:/Users/danie/kb-worktrees/atlas`), dashboard code on the
same branch, one PR at wave end unless review says split.
