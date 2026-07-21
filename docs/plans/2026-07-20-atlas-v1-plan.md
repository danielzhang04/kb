# Atlas V1 (Hands) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Atlas V1 — unified worker state + local `/state` surface → dashboard Atlas view with big orb, global mini-orb, live transcript and activity history → transcript ledger on ops → reflex lane + `file_card` / `launch_workflow` (card-backed) / `credit_remaining` → card-completion callbacks → persona.md — so Daniel can file a card by voice, watch the orb track every stage, and hear its completion callback.

**Architecture:** Per `docs/specs/2026-07-20-atlas-v1-hands-design.md` (amending the approved delta design §5/§7). Slice 1 (status surface) lands before Slice 2 (hands). The kb-MCP boundary rule is unchanged: card writes go through `scripts/cards.py` into `queue/inbox/` on ops and stop — the dispatcher assigns; Atlas never self-claims. Dashboard work targets the Vite+React SPA + Fastify daemon (NOT Next.js).

**Tech Stack:** Python 3.13 venv at `atlas/.venv` (aiohttp arrives as an explicit dep — it's already transitively installed via livekit-agents), pytest; dashboard: React 19 + Vite 8, Fastify daemon under Node `--experimental-strip-types` (no enums, explicit `.ts` import extensions), route tests via the dashboard's existing runner + `app.inject`.

## Global Constraints

- Worktree: `C:/Users/danie/kb-worktrees/atlas`, branch `claude/atlas` (fast-forwarded to origin/main 2031663). Never push main; PR at wave end.
- Ops coordination writes go through worktree `C:/Users/danie/kb-worktrees/dashboard-ops`: `git -C <ops> pull --rebase origin ops` immediately before EVERY write, push immediately after; rejected push = re-read, reconcile, retry.
- Workers are Opus 4.8 or below; model self-reported in output AND orchestrator-verified. Implementers commit locally on `claude/atlas` only and never push; the orchestrator reviews every diff, owns all pushes and all ops-branch writes.
- Atlas suite: `atlas\.venv\Scripts\python -m pytest atlas/tests -v` (from repo root). Fleet suite (`py -3.13 -m pytest tests/`) and dashboard suite (`npm test` in `dashboard/`) must stay green; voice deps never leak into either.
- Secrets: keys live ONLY in the worker's process env (loaded from `%USERPROFILE%\.atlas\env`). The `/state` endpoint, panel route, ledger, and all tests must be provably key-free. No new accounts or purchases — V1 requires zero new keys.
- Card discipline: cards `project: atlas`, `risk-tier: T2`, `role: work`, `runtime: claude`, model stamped `opus`, `workflow: atlas-v1`; lifecycle inbox→working→done; inspector grades each card fresh-context.
- `governance/` and `CLAUDE.md` are never edited by agents.
- API-surface rule (standing V0 landmine): any step touching livekit-agents session events, aiohttp server wiring, or Deepgram HTTP APIs MUST first verify the API against the INSTALLED package source in `atlas/.venv` (and context7 docs for livekit-agents 1.6.6), then adjust code to the shipped API with the step's behavior contract unchanged.
- Dashboard read-only rule: everything V1 adds to the dashboard is GET/read-only, registered with the pre-auth panels tier; nothing goes near `registerWriteSurface`.

---

### Task 1: V1 pre-flight sweep (GATE)

**Files:**
- Modify: `atlas/tests/test_preflight.py` (extend the standing sweep)

**Interfaces:**
- Produces: proof that the infra V1 leans on works TODAY: (a) dispatcher demonstrably consumes an inbox card end-to-end, (b) V0 atlas suite + fleet suite green, (c) dashboard daemon starts and serves an existing panel route.

- [ ] **Step 1: Suites green** — run atlas suite (23 PASS expected) and fleet suite; any failure stops the wave.
- [ ] **Step 2: Dispatcher end-to-end proof.** Read `scripts/dispatch.py`'s CLI (`argparse` at bottom) and the desktop poll scripts to determine the sanctioned invocation. File a canary card on ops (`project: atlas`, `action: "v1 sweep canary"`, `risk-tier: T1`), then either observe the live scheduler claim it or run one sanctioned dispatch cycle; verify the card gains an owner + claim-token and a `ledgers/dispatch/` row appears. Record card id + evidence in execution notes. **If the dispatcher is not operational on this machine, STOP — wake Daniel (this is the sweep's purpose).** Clean up: transition the canary to done with a note.
- [ ] **Step 3: Dashboard daemon smoke** — `npm run start` (or pm2 config) in `dashboard/`, `curl 127.0.0.1:4317/api/panels/health` → 200 JSON. Kill after.
- [ ] **Step 4: Extend `test_preflight.py`** with a static check that `scripts/dispatch.py` and the dashboard `server/panels/` dir exist and import/parse (cheap standing guards; the live proof above is the real gate, not CI).
- [ ] **Step 5: Commit** — `feat(atlas): V1 pre-flight sweep`

---

### Task 2: Ops registration — V1 cards + STATE

**Files:**
- Create (ops worktree): `queue/inbox/<id>.md` × 10 (cards for Tasks 3–12)
- Modify (ops worktree): `orgs/atlas/STATE.md`

**Interfaces:**
- Consumes: `scripts/cards.py::new_card/save` (exact `**extra` field spellings checked against `governance/card-schema.md` before running).
- Produces: 10 cards `workflow: atlas-v1`; STATE.md "Now" reflects V1 underway + this plan as authority.

- [ ] **Step 1:** Rebase ops; file cards for Tasks 3–12 (actions = each task's title); verify all `cards.parse()`; update STATE.md; commit `atlas: file V1 cards [atlas-v1]`; push.
- [ ] **Step 2:** Record card ids in this plan's execution notes.

---

### Task 3: Tool-registry consolidation (refactor, no behavior change)

**Files:**
- Create: `atlas/worker/toolreg.py`, `atlas/tests/test_toolreg.py`
- Modify: `atlas/worker/fastlane.py`, `atlas/worker/app.py`, `atlas/kbmcp/server.py`

**Interfaces:**
- Produces: `toolreg.REGISTRY: list[ToolSpec]` where `ToolSpec = (name, description, input_schema, fn: Callable[[dict], str])`; `toolreg.anthropic_tools() -> list[dict]` (== old `fastlane.TOOLS` shape); `toolreg.dispatch(name, args) -> str` (== old `fastlane._dispatch` behavior incl. `"ERROR: ..."` on FileNotFoundError); helpers for LiveKit `function_tool` wrapping and FastMCP registration so `app.py` and `server.py` each become a loop over REGISTRY.
- Consumes: `kbmcp.kb_tools` (unchanged).

- [ ] **Step 1:** Failing tests: registry covers exactly the 5 V0 tool names; `anthropic_tools()` schema equals the current `fastlane.TOOLS` literal; `dispatch("queue_summary", {})` works against `kb_fixture`; unknown tool name raises `KeyError`.
- [ ] **Step 2:** Implement `toolreg.py`; rewrite `fastlane.TOOLS`/`_dispatch` as thin re-exports (so existing tests + callers stay valid); rewrite `app.py::_kb_function_tools()` and `kbmcp/server.py` registration as loops over REGISTRY.
- [ ] **Step 3:** Full atlas suite green (V0 tests unchanged and passing is the no-behavior-change proof). REPL smoke: one typed question still answers.
- [ ] **Step 4:** Commit — `refactor(atlas): single tool registry consumed by fastlane, LiveKit, and MCP surfaces`
- [ ] **Step 5:** Card lifecycle + grade (orchestrator: Result, done, inspector).

---

### Task 4: Worker state core (TDD)

**Files:**
- Create: `atlas/worker/state.py`, `atlas/tests/test_state.py`
- Modify: `atlas/worker/app.py`, `atlas/worker/wakeword.py` (DEAF-suppress only)

**Interfaces:**
- Produces: `state.StatePublisher(clock=...)` with `.state -> "ASLEEP"|"LISTENING"|"THINKING"|"SPEAKING"`, `.set_state(s)`, `.add_line(role, text)` (ring, default 50), `.subscribe(fn)` / `.unsubscribe(fn)` (sync callbacks, event-loop-only by contract), `.snapshot() -> dict` (the §3 design schema minus `filed_cards`, which Task 9 adds), `.session_id` (new uuid per wake). All pure — no I/O, no asyncio imports.
- Consumes (wiring): `_engage()`/`_sleep()` closures; existing `user_input_transcribed` handler; NEW assistant-turn + speech-lifecycle `session.on(...)` handlers.

- [ ] **Step 1:** Failing tests: transitions (wake→LISTENING, llm-start→THINKING, tts-start→SPEAKING, tts-end→LISTENING, sleep→ASLEEP); ring truncation at 50; subscriber receives `("state", ...)` and `("line", ...)` events; `snapshot()` matches the design schema keys; injectable clock stamps `since`.
- [ ] **Step 2:** Implement (~80 lines). PASS.
- [ ] **Step 3: MANDATORY installed-source check** — enumerate `AgentSession` events in `atlas/.venv/.../livekit/agents/` (and context7): identify the real event names for user turn committed, agent speech/reply started/finished, LLM inference start (if exposed — else derive THINKING = user turn committed → speech started). Record chosen events + rationale in execution notes.
- [ ] **Step 4:** Wire in `app.py`: publisher constructed in `entrypoint()`; `_engage`/`_sleep` set LISTENING/ASLEEP; new handlers per Step 3 set THINKING/SPEAKING and feed `.add_line()` for both roles (the two synthetic `session.say` acks are also added as atlas lines — they're audible, so they belong in the mirror).
- [ ] **Step 5:** DEAF-suppress: `wakeword.py` gains a `shutting_down` flag (set from app.py teardown) checked before logging the CRITICAL.
- [ ] **Step 6:** Suite green; REPL unaffected. Commit — `feat(atlas): unified state core + turn observation (+ quiet shutdown)`
- [ ] **Step 7:** Card lifecycle + grade.

---

### Task 5: Worker HTTP surface (TDD)

**Files:**
- Create: `atlas/worker/stateserver.py`, `atlas/tests/test_stateserver.py`
- Modify: `atlas/worker/app.py`, `atlas/config/atlas.yaml` (`state_port: 4360`), `atlas/requirements.txt` (pin `aiohttp` explicitly)

**Interfaces:**
- Produces: `stateserver.start(publisher, port) -> awaitable handle` serving `GET /state` (JSON = `publisher.snapshot()` + `heartbeat` stamped at request time), bound `127.0.0.1` only; `.stop()` for teardown.
- Consumes: `state.StatePublisher`.

- [ ] **Step 1:** Failing tests via `aiohttp.test_utils` (or `pytest-aiohttp`): 200 + schema keys; transcript ring content round-trips; header `cache-control: no-store`; response never contains any value from a poisoned `os.environ` sentinel (key-free proof).
- [ ] **Step 2:** Implement (AppRunner + TCPSite; started from `entrypoint()` into `_BG_TASKS` like `_silence_watcher`, event-loop placement per the job-context landmine). PASS.
- [ ] **Step 3:** Desk smoke: run console mode, `curl 127.0.0.1:4360/state` shows ASLEEP + heartbeat advancing; say "hey Atlas", curl shows LISTENING and the transcript filling.
- [ ] **Step 4:** Commit — `feat(atlas): local read-only /state surface on 127.0.0.1:4360`
- [ ] **Step 5:** Card lifecycle + grade.

---

### Task 6: Transcript ledger on ops (TDD)

**Files:**
- Create: `atlas/worker/ledgerwriter.py`, `atlas/tests/test_ledgerwriter.py`
- Modify: `atlas/worker/app.py`

**Interfaces:**
- Produces: `ledgerwriter.SessionLedger(ops_root, git_runner=..., clock=...)` — subscribes to the publisher, buffers lines, and on `flush(session_id)`: pull-rebase, append JSONL to `orgs/atlas/output/transcripts/YYYY-MM-DD-<session_id>.jsonl`, commit `atlas: session transcript <id>`, push; rejected push → rebase + retry (bounded); any failure logs and defers to next flush (never raises into the voice loop). `git_runner` is an injected `fn(args: list[str]) -> CompletedProcess` seam.
- Consumes: `state.StatePublisher.subscribe`.

- [ ] **Step 1:** Failing tests against a tmp git repo with a local bare "origin": flush writes valid JSONL + pushes; concurrent-push rejection (pre-push to origin from a second clone) → retry succeeds; git failure → no exception, lines retained for next flush; JSONL lines match `{"t","role","text"}`.
- [ ] **Step 2:** Implement; wire flush into `_sleep()` (fire-and-forget task, never blocks the sleep cue) with real runner = subprocess against `C:/Users/danie/kb-worktrees/dashboard-ops`.
- [ ] **Step 3:** Suite green. Commit — `feat(atlas): durable session transcripts on ops`
- [ ] **Step 4:** Card lifecycle + grade.

---

### Task 7: Dashboard server — `/api/panels/atlas` (TDD)

**Files:**
- Create: `dashboard/server/panels/atlas.ts`, `dashboard/server/panels/atlas.test.ts`, fixture additions under `dashboard/server/__fixtures__/repo-a/orgs/atlas/output/transcripts/`
- Modify: `dashboard/server/panels/routes.ts` (register), `dashboard/server/index.ts` only if registration requires it

**Interfaces:**
- Produces: `GET /api/panels/atlas` → `{ worker: <worker /state passthrough | { state: "OFFLINE", lastHeartbeat: string|null }>, history: [{file, date, sessionId, lines}], cards: [<atlas-project queue cards>] }`. Worker base URL from `ATLAS_STATE_URL` env (default `http://127.0.0.1:4360`), fetch injected for tests, ~800ms timeout.
- Consumes: panels registration pattern (`health.ts` shape), repo-root projections for transcripts + queue.

- [ ] **Step 1:** Failing `app.inject` tests: healthy (injected fetch returns V1 schema) → passthrough; fetch rejects/times out → `state: "OFFLINE"`; malformed worker JSON → OFFLINE (never a 500); history reads fixture transcripts newest-first (bounded, e.g. last 10 sessions); cards filtered to `project: atlas`.
- [ ] **Step 2:** Implement under the strip-types floor (no enums, explicit `.ts` extensions). PASS; full dashboard server suite green.
- [ ] **Step 3:** Commit — `feat(dashboard): atlas panel route (read-only, OFFLINE-explicit)`
- [ ] **Step 4:** Card lifecycle + grade.

---

### Task 8: Dashboard UI — Atlas view + global mini-orb, then GATE A

**Files:**
- Create: `dashboard/src/views/Atlas.tsx`, `dashboard/src/styles/views/atlas.css`, `dashboard/src/lib/useAtlasState.ts`, `dashboard/src/components/AtlasMiniOrb.tsx`
- Modify: `dashboard/src/nav/config.ts` (`atlas` → `live`), `dashboard/src/App.tsx` (ViewBody case + mount mini-orb at shell level + drop Atlas from `LAYER_PANELS`)
- Delete: `dashboard/src/views/panels/Atlas.tsx` (stub retired)

**Interfaces:**
- Produces: `useAtlasState()` — single shared poller (~1s visible-tab interval + `/events` tick refetch) returning the Task-7 payload; the full view (big orb with per-state motion: LISTENING steady / THINKING shimmer / SPEAKING pulse / ASLEEP dim / OFFLINE hollow + "last seen \<age\>", live transcript in the Timeline auto-scroll/freeze/"N new" idiom, activity history, atlas cards with queue states); mini-orb on every view — hidden when ASLEEP/OFFLINE, pulsing when awake, click → navigate to Atlas view.
- Consumes: `/api/panels/atlas`, house theme tokens (`--bg-*`/`--fg-*`, semantic status colors only — no decorative accents), `.v-panel__*`/`.mc-*` classes where they fit.

- [ ] **Step 1:** Implement hook + view + mini-orb + nav promotion + stub retirement. No new data-fetching libraries. Poller pauses on `document.hidden`.
- [ ] **Step 2:** `npm run build` + dashboard suites green; grep proves no other `LAYER_PANELS`/nav references to the retired stub remain.
- [ ] **Step 3:** Live check with worker running: OFFLINE (worker down) → hollow orb + last-seen; start worker → ASLEEP; wake → mini-orb appears on a non-Atlas tab and pulses; Atlas tab shows live transcript.
- [ ] **Step 4:** Commit — `feat(dashboard): Atlas view + global mini-orb (nav IA amendment per V1 design)`
- [ ] **Step 5: HUMAN GATE A — Slice-1 desk check.** Daniel: dashboard open on any tab, "hey Atlas", watch mini-orb appear/pulse; open Atlas view mid-conversation, see transcript + orb states; kill worker, see OFFLINE. Verdict recorded in STATE.md. **Slice 2 does not start until this gate passes.**
- [ ] **Step 6:** Card lifecycle + grade.

---

### Task 9: `file_card` + `launch_workflow` + `credit_remaining` (TDD)

**Files:**
- Create: `atlas/tests/test_voice_tools.py`
- Modify: `atlas/kbmcp/kb_tools.py`, `atlas/worker/toolreg.py`, `atlas/worker/state.py` (snapshot gains `filed_cards`, fed by app.py on each successful `file_card`; Task 11's watcher updates their outcomes), `atlas/worker/fastlane.py` (system-prompt confirm rule — moves to persona.md in Task 12)

**Interfaces:**
- Produces (in `kb_tools.py`, pure, git seam injected): `file_card(ops_root, project, action, target, risk_tier, body="", workflow=None, git_runner=...) -> dict` (returns `{"id", "path"}`; `new_card` + `save` under pull-rebase/push discipline; stamps `workflow: atlas-voice` when `workflow` is None, else the named workflow — the latter IS `launch_workflow`); `credit_remaining(http_get=...) -> dict` (Deepgram balances; key read inside from env, never a parameter, never in the return). Registry entries: `file_card` and `launch_workflow` schemas both require `confirmed: boolean` with descriptions mandating spoken read-back of project/action/target/risk-tier first; `dispatch` rejects `confirmed != true` with `"ERROR: not confirmed — read the card back and get a yes."`.
- Consumes: `scripts/cards.py`, Task 6's git-runner seam pattern, Deepgram HTTP API (verified against current docs before coding).

- [ ] **Step 1:** Failing tests: `file_card` lands a parseable card in `inbox` with right fields + workflow stamp and pushes (bare-remote fixture); unconfirmed dispatch → ERROR string, nothing written; `launch_workflow` sets the named workflow; `credit_remaining` parses a canned balances payload via injected `http_get` and never leaks the key (poisoned-env check); registry now covers 8 names.
- [ ] **Step 2:** Implement; register in `toolreg.REGISTRY` (one-place edit — the Task 3 payoff); MCP server + LiveKit surfaces pick them up via the existing loops; system prompt gains the read-back-confirm rule.
- [ ] **Step 3:** REPL smoke: type "file a card to check the faceless renderer" → model asks/reads back → confirm → card id spoken back; verify card on ops; then transition it done manually (it's a smoke artifact).
- [ ] **Step 4:** Commit — `feat(atlas): voice card filing, workflow launch (card-backed), credit check`
- [ ] **Step 5:** Card lifecycle + grade.

---

### Task 10: Reflex lane + intents.yaml (TDD)

**Files:**
- Create: `atlas/config/intents.yaml`, `atlas/tests/test_reflex.py`
- Modify: `atlas/worker/router.py`, `atlas/worker/app.py`, `atlas/config/atlas.yaml` (dismiss list migrates)

**Interfaces:**
- Produces: `router.route(utterance, intents) -> ("reflex", intent_name) | ("fast", None)`; `router.load_intents(path)`; intents: `dismiss` (existing behavior, phrases migrated from `dismiss_phrases`), `cancel` (abort in-flight turn if API allows — verified against installed source; else no-op ack), `repeat` (replay last atlas ring line via `session.say`), `credit` (→ `credit_remaining`, spoken). Matching = normalized exact phrase or anchored regex, from YAML only.
- Consumes: `state.StatePublisher` ring (for `repeat`).

- [ ] **Step 1:** Failing tests: each intent matches its phrase variants post-normalization; near-miss sentences ("cancel the deploy card") do NOT match reflex and go fast; empty utterance still raises; V0 `route()` callers updated.
- [ ] **Step 2:** Implement; wire reflex dispatch in `app.py`'s transcript handler ahead of the LLM turn; dismiss path now flows through intents (old hardcoded list deleted).
- [ ] **Step 3:** Suite green; REPL shows `[reflex:repeat]` style echo for reflex hits. Commit — `feat(atlas): reflex lane driven by intents.yaml`
- [ ] **Step 4:** Card lifecycle + grade.

---

### Task 11: Card-completion callbacks (TDD)

**Files:**
- Create: `atlas/worker/donewatcher.py`, `atlas/tests/test_donewatcher.py`
- Modify: `atlas/worker/app.py`, `atlas/config/atlas.yaml` (`announce_when_asleep: true`, `watch_period_s: 30`)

**Interfaces:**
- Produces: `donewatcher.DoneWatcher(ops_root, sidecar_path, git_runner=..., clock=...)` — `.watch(card_id, spoken_label)` persists to a JSON sidecar (`%USERPROFILE%\.atlas\watched.json`, restart-safe); `.poll() -> list[Announcement]` pull-rebases then scans queue state dirs for watched ids reaching `done`/failure states, removes them from the sidecar, returns `Announcement(card_id, outcome, text)`. Pure logic; app.py owns the timer (event-loop task, runs only while sidecar non-empty) and speaking: ENGAGED → inline `session.say`; ASLEEP + `announce_when_asleep` → one-shot say WITHOUT opening STT (state stays ASLEEP; the announcement is added to the transcript ring/ledger).
- Consumes: Task 9's `file_card` return (auto-`.watch()` every card Atlas files), `scripts/cards.py::parse`.

- [ ] **Step 1:** Failing tests: watch→sidecar round-trip survives a new instance; poll on a fixture queue where a watched card moved to done → one announcement, sidecar emptied; failure-state card → failure announcement; unmoved card → nothing; git failure → empty result, watch retained.
- [ ] **Step 2:** Implement + wire (timer task in `_BG_TASKS`; speak paths per contract above).
- [ ] **Step 3:** Suite green. Commit — `feat(atlas): spoken completion callbacks for voice-filed cards`
- [ ] **Step 4:** Card lifecycle + grade.

---

### Task 12: HUMAN GATE B — persona.md co-authoring + loader

**Files:**
- Create: `atlas/config/persona.md`
- Modify: `atlas/worker/fastlane.py` (SYSTEM ← loader), `atlas/worker/app.py` (Agent instructions ← loader), `atlas/tests/test_fastlane.py` (loader test)

**Interfaces:**
- Produces: `fastlane.load_persona() -> str` reading `atlas/config/persona.md` (falls back to the relocated V0 text if the file is missing — worker must never fail to start over persona); both live path and REPL consume it.

- [ ] **Step 1:** Mechanical relocation first: persona.md = V0 SYSTEM text verbatim + loader + test; suite green; commit `refactor(atlas): persona text lives in config/persona.md`.
- [ ] **Step 2: HUMAN GATE B — co-authoring session with Daniel** (explicitly wanted; boss session drives, not a subagent): voice, register, brevity defaults, humor bounds, how to read back cards, how to deliver callbacks. The read-back-confirm rule from Task 9 moves in here. Output committed as the real persona.md.
- [ ] **Step 3:** Desk ear-check: two or three exchanges in the new persona; adjust live if Daniel wants.
- [ ] **Step 4:** Commit — `feat(atlas): persona v1 (co-authored)`
- [ ] **Step 5:** Card lifecycle + grade.

---

### Task 13: V1 checkpoint (GATE C) + wave close

**Files:**
- Modify (ops): `orgs/atlas/STATE.md`, `memory/claude-boss.md`
- Create (ops): checkpoint note in `orgs/atlas/output/`

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Full-loop rehearsal (orchestrator, no Daniel):** REPL/desk run — file a real T1 card by voice targeting a trivial deliverable, dispatcher picks it up, work completes, callback speaks; orb tracked every stage; transcript ledger pushed; panel history shows the session.
- [ ] **Step 2: HUMAN GATE C — V1 checkpoint with Daniel:** he files a card by voice end-to-end, watches mini-orb + Atlas view, hears the completion callback (engaged AND asleep variants). A broken leg = stop-and-fix, not plow-ahead.
- [ ] **Step 3: Wave close:** atlas + fleet + dashboard suites green; consistency sweep (leaked keys grep, dead references to the retired stub, files >~300 lines that should split, unresolved spec cross-refs); STATE.md + boss memory updated; **PR `claude/atlas` → main**; V2 planning go/no-go with Daniel.

---

## Execution notes

- Task 1 (2026-07-20): atlas 23/23 + fleet 530/530 green. Canary 6a5ec3bb-65db6d11 through
  inbox→claim→working→done with ops pushes. Dashboard daemon: live under pm2 on
  **127.0.0.1:5317** (ALWAYS-ON config; dev default 4317 — live checks in Tasks 7/8 use 5317).
  Dispatcher nuance recorded: dispatch.py emits cadence cards (today's ledger row confirms it
  ran); hand-filed inbox cards — Atlas's path — are executed by fleet sessions after
  assignment, same execution model as V0. Sweep verdict: PASS. Commit 267a8a6.
- Task 2 (2026-07-20): cards filed workflow `atlas-v1` — T3 6a5ec41c-b18aa9f1,
  T4 6a5ec41c-f7d86587, T5 6a5ec41c-d2e26925, T6 6a5ec41c-216ad53f, T7 6a5ec41c-53ac36f7,
  T8 6a5ec41c-caabe932, T9 6a5ec41c-d8332ebf, T10 6a5ec41c-6a21da88, T11 6a5ec41c-4800fe6e,
  T12 6a5ec41c-3a4808a7. STATE.md updated; ops pushed.
- Task 3 scope amendment (2026-07-20, orchestrator): `atlas/kbmcp/kb_tools.py` WAS modified in
  ae2e6f6 — one orchestrator-review edit widening `read_state`'s unknown-project error to name
  known projects, replacing the MCP-only recovery hint the server.py loop rewrite would have
  dropped. The Task 3 Interfaces line "Consumes: kbmcp.kb_tools (unchanged)" is amended
  accordingly. Inspector grade 93 FAIL (ops d358a7c) flagged this + unattached evidence;
  remediation = this amendment, attached suite output, and a live REPL smoke appended to the
  card, then fresh-context re-grade. Re-grade: 95 PASS (ops d6fadfa).
- Slice 1 built 2026-07-20 (all TDD, all suites green at every step): T4 state core 8ca17da
  (96 PASS), T5 /state server 72786fc (97 PASS; live text-mode smoke: curl 4360/state exact
  schema), T7 panel route ef4e0be (95 PASS), T8 view + mini-orb 87552c2 (96 PASS), T6 ledger
  8f08503 (grade pending). Fleet suite 530 green post-Slice-1.
- LANDMINE fixed 2026-07-20: an inspector session had left `inspector@agents.local` in the
  SHARED repo git config (kb/.git/config — all worktrees inherit it), mislabeling two work
  commits; config restored to codex-worker, branch history reauthored (f5b7ca2→8ca17da,
  6cec338→cbf1719). Standing rule now in every worker/inspector prompt: git identity is passed
  per-command with `-c user.name/-c user.email`, NEVER via `git config`.
- Gate A staging: dev daemon from the branch on 127.0.0.1:4317 with
  DASHBOARD_REPO_ROOT=dashboard-ops (matches pm2 production env; pm2/5317 untouched, runs
  pre-branch code until merge). Panel verified serving live ops cards + OFFLINE worker shape.
- Console-redirect note: worker output piped to a file needs PYTHONUTF8=1 (livekit banner
  emoji vs cp1252); interactive terminals unaffected.
- Task 10 scope amendment (2026-07-21, orchestrator, PRE-DECLARED before grading): (1) reflex
  dispatch is implemented in a new `AtlasAgent.on_user_turn_completed` override raising
  `StopResponse` rather than "in app.py's transcript handler" — installed-source trace
  (agent_activity.py:2331/2334/2390) proved that is the ONLY 1.6.6 seam that both suppresses
  the LLM reply and keeps the utterance out of chat_ctx; the plan's "ahead of the LLM turn"
  intent is honored at the correct hook, and `_on_transcript` is retained solely for
  engagement re-stamping. (2) `atlas/tests/test_engagement.py` is ADDED to Task 10's files —
  it imported the deleted `_is_dismiss`; its dismiss test migrated to the router intent path.
  (3) `cancel` wires a REAL abort: `session.interrupt(force=True)` (agent_session.py:1356,
  agent_activity.py:1509, speech_handle.py:160/175) — spans LLM inference through TTS playout.
- Task 9 scope amendment (2026-07-20, orchestrator, PRE-DECLARED before grading): Task 9's
  Files list is amended to ADD — `atlas/worker/gitseam.py` (new: the Task-6 git seam factored
  into one shared home, orchestrator-instructed "factor a shared helper if clean"),
  `atlas/worker/ledgerwriter.py` (refactored onto gitseam, behavior unchanged),
  `atlas/worker/app.py` (post-file hook wiring required by the task's Wiring bullet),
  and assertion updates in test_state/test_stateserver/test_fastlane/test_toolreg (the 8-tool
  surface + filed_cards snapshot). Also fixed in-scope: latent `mcp_tool` param-ordering bug.
  GATE A PASSED at the desk (Daniel, 2026-07-20 late); one desk fix: console mic index 2→1
  (BT reshuffle; wake thread already name-pinned; console-flag name-pinning = polish backlog).
- Task 6 scope amendment (2026-07-20, orchestrator): `atlas/config/atlas.yaml` is ADDED to
  Task 6's modify list — the orchestrator's dispatch instructed making the ledger's ops root
  configurable (`ops_root` key, default = the real ops worktree) per design §5 wiring; the
  plan's Files list simply hadn't named it. Inspector grade 92 FAIL (ops a87d0d8) flagged this
  + assert-not-attach evidence; remediation = this amendment + verbatim outputs on the card,
  then fresh-context re-grade.
