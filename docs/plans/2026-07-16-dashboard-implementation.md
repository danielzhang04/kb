# Month-1 Dashboard (Mission Control) — Implementation Plan (TDD, wave-ordered) — FINAL

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (or
> `superpowers:executing-plans`) to implement this plan task-by-task, strict TDD (failing test
> first, minimal green, refactor). Steps use checkbox (`- [ ]`) syntax for tracking. TS units run on
> **vitest**; the Python-side edits in **D1** (session-id + steering-floor states + `due()`
> paused-awareness) extend **`tests/test_dispatch.py`** / `tests/test_cards.py`; the dispatcher-side
> WebAuthn verifier (D2) is **pytest** under `tests/test_webauthn_verify.py`. A Playwright SPA smoke
> is optional/late (D0.11), never a gate.

> **This plan doc + branch.** This file lives at `docs/plans/2026-07-16-dashboard-implementation.md`
> and is committed on **`claude/m1-fleet`** (the fleet work branch already links this path from its
> execution-order §). Dashboard **code** lands on its own work branch **`claude/m1-dashboard`** (cut
> from `main`, PR to `main`); the D1 fleet-file edits ride `claude/m1-fleet`'s serialized `dispatch.py`
> queue (see Execution order). Do not confuse the two: the plan doc and the D1 fleet edits share
> `claude/m1-fleet`; everything else is `claude/m1-dashboard`.

**Goal.** Turn the approved design (`docs/specs/2026-07-16-dashboard-design.md`, Option B — Hybrid
Workbench) into a buildable, dependency-ordered task list for an **optional local web daemon** that
(v0) renders the fleet's live state read-only, (v1) lets Daniel steer it through the *same governed
CLI paths agents already use* behind a WebAuthn-backed enrolled-device session, and (v2) adds a real
terminal + graceful Broker steering. **Git stays the database**; the dashboard is a projection over
files (Plane A = the kb repo, Plane B = local Claude Code JSONL transcripts) plus a thin authenticated
GUI over `scripts/*`. If the dashboard is off, the fleet coordinates through git exactly as today.
This plan is the test-first realization of design §6's build inventory, adjusted by Daniel's locked
decisions (below), and it **interlocks with the fleet plan** (`2026-07-16-m1-fleet-implementation.md`)
at exactly one point: the `dispatch.py` sessionId edit (D1), which joins the fleet's serialized
`dispatch.py` queue.

**Daniel's locked decisions folded in (this session — binding; override the design where they conflict).**
1. **Scope is plan v0 + v1 + v2 now**, with explicit gates: **v1 (D2) is HARD-GATED** on fleet Wave-1
   exit *and* a human security review of the WebAuthn verifier; **v2 (D3) is GATED** on SDK-on-
   subscription ToS re-verification *and* a Broker threat review. Gates appear inline as HUMAN GATE
   items at their sequence position.
2. **Code home: `dashboard/` inside the kb repo** — one Node/TS Fastify backend + a Vite/React SPA
   over it. `dashboard/node_modules/` is gitignored; the daemon reads the repo it lives in. Dashboard
   code is **durable content on `main`** (reached via PR from the work branch), not a coordination
   write.
3. **Execution is parallel with the fleet plan.** Dashboard D0 builds in its own worktree while fleet
   Waves 0–1 run. The **only** fleet-file coupling is D1.
4. **Option B confirmed** — Control-view landing (Q1), Code view one toggle away; the VS-Code-like
   terminal/editor (v2 PTY pane) is in scope with the constrained-identity posture standing (Q5).
5. **Adopted §7 defaults (approved as a batch):** Q2 file-watch only, hooks deferred; Q3 device-bound
   passkey for the approval signer; Q4 RP-ID pinned to the full ts.net host (localhost credential
   decided at the enrollment gate); Q6 Node/TS maintained in-fleet + a light TS reimplementation of
   `claude-view` parsing (not its Rust core); Q7 Broker-only graceful steering is a hard boundary;
   Q8 escalation ladder = 60s `stop-requested` → `interrupt()` → SIGKILL at +30s; Q9 no per-skill
   forms in month 1 (CodeMirror only); Q10 traces committed **distilled** with a GC policy (raw stays
   local); Q11 OAuth-refresh chore + a quota-watch panel; Q12 both vibe-code and Broker designed to
   degrade to CLI-subprocess-only.

**Ground-truth corrections (verified this session — trust these over the design where they differ).**
- **`session-id` exists nowhere** in `queue/`, `ledgers/`, or `scripts/` today (grep-confirmed; the
  token appears only inside the design doc). D1 introduces it as a new optional card field.
- **Plane B record types** seen in a real session: `attachment, assistant, user, last-prompt, mode,
  permission-mode, ai-title, system, file-history-snapshot, file-history-delta, queue-operation`.
  `model` at `message.model`; `usage` at `message.usage`; `tool_result.tool_use_id → tool_use.id`
  join confirmed; subagent `.meta.json = {agentType, description, toolUseId, spawnDepth, model}` —
  the `toolUseId` join is real. The transcript-side `subagents/` dir is **FLAT**
  (`agent-<hex>.jsonl` + a sibling `agent-<hex>.meta.json` per subagent, **not** per-runId
  subdirectories — the design's shorthand is wrong; D0.3's implementation reads this flat layout). The
  transcript-side `workflows/` dir (when present) contains a `scripts/` **subdirectory**, not flat
  `wf_<id>.json` files — but D0.3 never reads it, and D0.6's `indexWorkflows` targets the **repo-root**
  `workflows/` **registry** (a different thing that does not exist yet). Do not conflate the Plane-B
  transcript `workflows/` with the Plane-A repo `workflows/` registry.
- **kb project dir:** 17 session JSONLs, 100 KB–4.6 MB; individual lines can be huge (3.1 MB = 912
  lines). **Byte-offset tailing is mandatory; never whole-file reads.**
- **Plane A shapes:** card frontmatter = `id, project, action, target, risk-tier, owner, claim-token,
  state(inbox|blocked|working|done|approvals|approved|rejected), approval, workflow, depends-on[],
  variant-group, role`. Ledgers are TSV `<agent>-<YYYY-MM-DD>.tsv`; kinds `dispatch|cost|activity|
  grades` (+ `approvals` added by fleet task 2.3). `ledgers/grades/` and `ledgers/activity/` are
  currently **EMPTY** — the registry trust overlay must render with **no data**.
- **NO `workflows/` dir exists.** The design's "workflows registry" view renders from a nonexistent
  directory → scope it **render-if-present / empty-state otherwise** (D0.6), never a hard dependency.
- **`dashboards/executive.md` + `handover.md`** exist on `ops` only, regenerated by the
  `dashboard-generator` **skill** (agent prose, no deterministic script) — the daemon computes its
  own rollups directly; there is nothing to reuse.
- **Tailscale is NOT installed** (hard human prerequisite). The repo has an active pre-commit hook
  (`.githooks`, `core.hooksPath`) running `sync_skills` checks on every commit; dashboard commits
  touch **no `skills/` files** so the hook passes untouched, but expect it to run.
- **Fleet interplay:** fleet Wave-1 exit gates D2. Fleet `approvals.py` (task 1.2) exposes
  `verify_signed_approval` / `verify_telegram_approval`, which the D2 approvals inbox drives by
  child-process. Fleet `promotion.decide()` (task 3.1) emits `assurance_class` — the D2 inbox
  **consumes** it to decide which cards may show possession/telegram buttons vs signed/WebAuthn-only;
  **it never recomputes novelty.**

---

## Revision note (what changed vs. the draft, and why)

This FINAL applies two adversarial-review lenses (repo-reality + ordering-safety) against the live
repo. The load-bearing changes:

- **D2's fleet gate corrected to name the real cross-wave dependencies.** The draft gated *all* of D2
  on the fleet **Wave-1 exit** only, but two D2 tasks consume artifacts built later: **D2.4** reads
  `assurance_class` (emitted by fleet **3.1**, stamped on the card by fleet **3.4** — both **Wave 3**),
  and **D2.10** edits `scripts/notify.py` (**created** by fleet **2.4** — **Wave 2**). Verified: neither
  `scripts/promotion.py` nor `scripts/notify.py` exists today. Ordering-law 2, HUMAN GATE D2.0, and
  the D2.4/D2.10 headers now carry those explicit merged-to-`main` preconditions. (repo-reality BLOCKER
  1 / ordering-safety MAJOR 3)
- **No STOP/preamble gate on the spawn/launch/Broker paths → added.** D2.6 (launch), D2.7 (vibe-code,
  RCE-equivalent), and D3.3 (Broker spawn) could dispatch/spawn fleet work while the fleet is frozen.
  Each now runs `scripts/preamble.py` (STOP-absent + `ANTHROPIC_API_KEY` unset + budget-OK) and refuses
  to spawn otherwise, with a named `refuses to … when STOP present` test. (ordering-safety BLOCKER 1)
- **The join key is now stamped by the worker runner, not the dispatcher.** `dispatch.run()` claims a
  card for a worker whose Claude Code session does not exist yet, so a dispatcher-stamped `session-id`
  would be null in every real hand-off. D1 is restructured: **D1.1** adds the optional field +
  `stamp_session()` and threads an optional param through `run()` (correct only for the cloud nightly
  session that self-executes its own card); **new D1.2** stamps `session-id` from the *worker runner*
  at transition-to-`working`, which is the only place the real worker session id is known. (repo-reality
  MAJOR 3 / ordering-safety MAJOR 4)
- **Steering-floor states are now added to `cards.py` code, not just the schema doc.** `cards.py`
  `STATES`/`STATE_DIR`/`LEGAL` reject `stop-requested`/`halting`/`halted`, so D2.8's stop-floor writes
  would `ValidationError`/`KeyError`. **New D1.3** extends the three tables (with tests). This grows
  D1's scope but adds **no new coupling point** — it is inside D1's existing `cards.py` edit (decision
  3's "only fleet coupling is D1" holds, now explicitly covering session-id + steering states +
  paused-awareness). (ordering-safety MAJOR 2)
- **`pauseCadence` enforcement wired into `dispatch.py` `due()` (inside the D1 serialized edit).** The
  draft wrote a `paused` overlay nothing read; `due()` would still fire the next beat. D1.1 now also
  makes `due()` consult a files-only `queue/paused/<cadence>` marker (skips the next beat), riding the
  **same single serialized `dispatch.py` insertion** after fleet 5.2 — not a second coupling. D2.8
  writes/clears that marker through the governed path. (ordering-safety MAJOR 6)
- **Cost/usage rollups reworded to dimensions the ledger actually has.** Verified: the cost ledger's
  only quantitative columns are `step` and `usd` (`ledger.cost_today` sums `usd`; header
  `model\tstep\tusd`) — there are **no** token or wall-clock columns. D0.2 and D3.5 no longer claim
  "tokens/wall-clock" and no longer assert "never a dollar figure"; they roll up **per-model `step`
  counts, card/dispatch counts, and model mix**, and *suppress* (not deny) the USD figure. (repo-reality
  MAJOR 4)
- **D2.4 verify calls fixed to a runnable interface.** `approvals.py` has **no** argparse/CLI, so
  `python scripts/approvals.py verify_signed_approval …` is not runnable and adding a CLI would be a
  second fleet-file edit. `driveVerify` now child-processes the fleet verbs via a documented **module
  interface** (`python -c "import approvals; …"`) — no fleet-file edit — and the **WebAuthn channel is
  wired end-to-end** by routing WebAuthn cards to `webauthn_verify.verify_webauthn_approval` (D2.3),
  which previously had no caller. (repo-reality MAJOR 2 / ordering-safety MAJOR 8)
- **`assurance_class` source named.** D2.4 reads it from **card frontmatter stamped by fleet 3.4**
  (`dispatch.py` sets `card.meta["assurance_class"]`) — a fleet-emitted, dashboard-read-only field; the
  dashboard never recomputes novelty and does not add it to the D1.4 schema proposal (it is a fleet
  field). (repo-reality MINOR 5)
- **Governed-save now classifies its target branch.** D2.5 routed *all* saves to `ops`; durable content
  (`skills/**`, `docs/**`, KB markdown) must go to a **work branch → PR to `main`**, and a `skills/`
  edit also triggers the `sync_skills` pre-commit hook (auto-stages `.claude/skills`, blocks on drift).
  D2.5 now classifies durable-content vs coordination writes and handles the hook. (ordering-safety
  MAJOR 5)
- **PTY runs as a pre-authenticated fleet-identity host the daemon signals — it does not spawn-as-user.**
  Spawning node-pty under a different Windows account needs that account's login secret, which the
  daemon (running as Daniel) would then hold as an object (a credential-ceiling breach). D3.1 now
  provisions the constrained account **and** its own at-logon PTY-host task; D3.2's daemon signals that
  already-running host over an authenticated local channel (peer-cred + per-boot token) instead of
  `CreateProcessAsUser`. (ordering-safety MAJOR 7, uncertain — flagged for the D3.6 review)
- **PWA manifest + service worker now has a build task.** HUMAN GATE D0.13 assumed an installable PWA
  but no task built one. **New Task D0.10** adds the manifest + service worker before the
  add-to-home-screen gate (Playwright shifts to D0.11; the two D0 gates to D0.12/D0.13). (ordering-safety
  MINOR 10)
- Minor fixes: D0.3 skip-list aligned to observed record types (`summary` marked *defensive* — never
  seen; `system` skip made a conscious decision); D1.1 drops the stale "line 80" anchor for the semantic
  "after `cards.claim`"; D0.8 trace-commit + D2.9 audit made explicit `ops` `pull-rebase-push` writes
  (and D0's "zero writes" scoped to the build/PR — trace *commit* is a runtime write); transcript
  `workflows/` prose de-conflated from the repo `workflows/` registry; a cross-plan note that the fleet
  `payload_hash` (1.1) binds action+target+work-order only (no risk-tier), so tier-laundering on the
  *fleet* channel is caught by the re-approval rule, not hash-binding. (repo-reality MINOR 6/7/8 /
  ordering-safety MINOR 9/11/12)

One finding was **partially rebutted**: repo-reality MINOR 5 claimed no card field carries
`assurance_class`. Fleet task 3.4 **does** stamp `card.meta["assurance_class"]`, so the field is
real and named by a fleet task; the fix applied is the clarification (name the source), not a new
schema field. See the disposition log at the end.

---

## Ordering law (binding on the whole plan)

1. **Read-only before writes.** D0 ships zero writes and zero fleet coupling. No control surface
   (approve, governed-save, launch/rerun, vibe-code, PTY, Broker verb) is built or exposed until its
   wave's gate opens. The one-enforcement-point story depends on `scripts/cards.py` + the approvals
   flow being the sole write path.
2. **D2 (governed writes / v1) is HARD-GATED** behind **both** (a) the fleet **Wave-1 exit**
   (`approvals.py` hardened + merged to `main`, protected `approvals` ref + pinned keyring live) and
   (b) a **human security/threat review of the WebAuthn verifier**. Neither alone suffices.
   **Two D2 subtasks carry additional, later fleet preconditions** (their own inline gates, not the
   whole wave): **D2.10** needs fleet **2.4** (`scripts/notify.py`, Wave 2) merged to `main`; **D2.4**
   needs fleet **3.1 + 3.4** (`assurance_class` emitted and stamped on the card, Wave 3) merged to
   `main`. Verified today: neither `scripts/notify.py` nor `scripts/promotion.py` exists — an executor
   who opens those two subtasks at Wave-1 exit hits missing modules. The rest of D2's write modules can
   proceed at Wave-1 exit.
3. **D3 (power / v2) is GATED** behind (a) an SDK-on-subscription **ToS re-verification at build
   time** and (b) a **Broker threat review**. The Broker's *existence*, not merely its cost, is
   contingent on the ToS check; the CLI-subprocess fallback stays first-class.
4. **Network location is never a trust boundary.** localhost bind + Tailscale Serve are *attack-
   surface reductions*, not authentication. Every consequential action requires a live WebAuthn-backed
   session; every HTTP request and WebSocket upgrade validates `Origin`/`Host` == the ts.net RP origin
   — enforced from **day one** (D0.4), before any write surface exists.
5. **The credential ceiling holds.** No agent, and no dashboard child process, handles a credential as
   an object. The daemon uses Daniel's ambient git credential for the governed `ops` write path but
   never prints/copies/persists/transmits it; the v2 PTY child runs under a **constrained fleet
   identity** whose env **excludes** the `ops` push credential and `CLAUDE_CODE_OAUTH_TOKEN`. Every
   token/identity/account/network step is a **HUMAN GATE**, never an agent task.
6. **Governance is human-committed.** `governance/**`, `CLAUDE.md`, and `card-schema.md` changes are
   human-committed proposals — an agent may only PROPOSE the exact text (into the PR body or a
   `docs/proposals/*.md` scratch file); Daniel commits it.
7. **HIGH-EFFORT security lines are not routine.** The **dispatcher-side WebAuthn verifier (D2.3)**
   and the **Broker daemon (D3.2)** are carved out as human-reviewed security work with an explicit
   design/threat-review gate before merge — a subtle bug in either silently defeats the whole gate /
   grants new lateral-movement capability. They are **NOT** ordinary agent-buildable tasks.
8. **STOP / preamble before any spawn or launch.** Per the constitution, `scripts/preamble.py` runs
   before ANY loop or task, and a present `STOP` file means halt immediately. Every dashboard surface
   that **spawns or dispatches fleet work** — card launch/rerun (D2.6), vibe-code (D2.7,
   RCE-equivalent), and the Broker spawn path (D3.3) — MUST run the preamble (STOP-absent +
   `ANTHROPIC_API_KEY` unset + budget-OK) and **refuse to spawn/launch when it fails**, with a named
   failing test. The WebAuthn session gate authorizes *who*; the preamble gate enforces *whether the
   fleet is frozen* — both are required. (The Broker's active `STOP`-**watch** in D3.3 is a separate,
   additional mechanism that drains live handles; this law is about not *starting* work under STOP.)
9. **Only one fleet-file coupling: D1 — now covering `cards.py` (session-id field + steering-floor
   states) and `dispatch.py` (session-id thread + `due()` paused-awareness).** Every one of these is
   an additive edit to a file D1 already owns; no *new* coupling point on the coordination-critical
   `dispatch.py`/`cards.py` path is introduced. The `dispatch.py` parts ride the fleet's serialized
   `3.4 → 4.1 → 4.2 → 5.2 → D1` queue (Execution order). **One narrow exception:** D2.10 makes an
   *additive* extension to `scripts/notify.py` (a fleet script **created** by fleet 2.4, not a
   coordination-state file) — it adds a function, edits no existing behavior, is gated on fleet 2.4, and
   lands via PR to `main`. That is the only fleet-script touch outside D1; no dashboard task edits
   `dispatch.py`/`cards.py`/`approvals.py`/`promotion.py` outside D1.

**Branch discipline (per CLAUDE.md).** All AGENT-BUILDABLE dashboard code lands on work branch
**`claude/m1-dashboard`** (cut from `main`) and reaches `main` via **PR** (never a direct push to
`main`). Each wave closes with one PR (or a small PR per sub-area) that Daniel reviews and merges.
`dashboard/` code + the D2 Python verifier are **durable content → they live on `main` after merge**.
The **D1 sessionId edit to `dispatch.py`/`cards.py`** is durable code and also lands via PR to `main`,
but it **must join the fleet plan's serialized `dispatch.py` queue** (see Execution order). **HUMAN
GATE** steps are never done by an agent — they are listed in sequence with exact instructions for
Daniel. Coordination artifacts the running dashboard *writes at runtime* (cards, ledgers, `traces/`,
audit log, `queue/paused/` markers) follow the usual `ops`-branch **pull-rebase-push** rule (a rejected
push means re-read state, reconcile, retry) — this applies to **every** runtime `ops` write, including
D0.8 trace commits and the D2.9 audit log.

**Runtime write classification (binding on the governed-save path, D2.5).** The dashboard's runtime
writes fall in two classes and route differently:
- **Coordination artifacts** — cards (`queue/**`), ledgers, `traces/`, the audit log, `queue/paused/`
  markers — go to **`ops`** (pull-rebase-push).
- **Durable content** — `skills/**`, `docs/**`, KB markdown, and dashboard code — goes to a **work
  branch → PR to `main`**, never direct to `ops` or `main`. A `skills/**` edit additionally triggers
  the active `sync_skills` pre-commit hook (auto-stages `.claude/skills`, blocks on drift), so the
  governed-save path must let the hook run and commit its staged mirror. Mislabeling a skill/doc edit
  as a coordination write (pushing it to `ops`) skips the durable-content review path and fights the
  hook.

This **plan doc** is durable content committed on **`claude/m1-fleet`** (alongside the D1 fleet edits);
dashboard **code** is durable content on **`claude/m1-dashboard`** → PR to `main`.

**Pinned toolchain (decided up front, D0.1).** Box runs **Node v24.18.0, npm 11.16.0, NO pnpm**.
`dashboard/.nvmrc` pins `24.18.0`; the daemon's Node version is pinned so a `node-pty` native rebuild
is never forced silently. `node-pty` ships only in D3 but its **ABI/prebuild strategy is decided in
D0.1**: vendor a known-good ConPTY prebuild matching the pinned ABI, fall back to a `node-gyp` +
VS Build Tools rebuild, so a bare box is never a from-scratch native build at D3 time.

---

# Wave D0 — Read-only Observatory (v0) — no writes, no fleet coupling, builds in parallel with fleet Waves 0–1

> Everything here is a **projection over files**. Zero writes to `queue/`/`ledgers/`/`governance/`.
> `Origin`/`Host` validation (D0.4) is present from the first served byte even though no write surface
> exists yet — it is the invariant the later waves inherit. Existing Omnara/Happy cover steering until
> D2. Fully agent-buildable.

### Task D0.1 — Scaffold `dashboard/` (pinned toolchain, vitest, node-pty ABI decision)  *(AGENT-BUILDABLE)*
**Goal.** One Node/TS Fastify backend + Vite/React SPA skeleton that builds and serves an empty
Control shell, with the test runner and native-addon strategy fixed before any feature code.

**Files touched:** `dashboard/package.json`, `dashboard/.nvmrc` (`24.18.0`), `dashboard/tsconfig.json`,
`dashboard/vitest.config.ts`, `dashboard/server/index.ts` (Fastify bootstrap, localhost bind),
`dashboard/src/main.tsx`, `dashboard/src/App.tsx`, `dashboard/vite.config.ts`, `dashboard/README.md`
(records the node-pty ABI/prebuild decision + pinned Node), root `.gitignore` (add
`dashboard/node_modules/`, `dashboard/dist/`).

**Failing tests first** (`dashboard/server/index.test.ts`):
- `index.test.ts > server binds localhost only and returns 200 on /healthz` — boot Fastify on an
  ephemeral port, assert `127.0.0.1` bind and `/healthz` → `{ ok: true, node: "24.18.0" }`.
- `index.test.ts > /healthz reports the pinned node major` — asserts `process.versions.node` starts
  with `24.` (guards an accidental unpinned upgrade).

**Implementation.** `npm init` with npm (not pnpm); deps: `fastify`, `@fastify/websocket`, `vite`,
`react`, `react-dom`, `vitest`, `typescript`, `chokidar`. Fastify listens on `127.0.0.1` only; add
`/healthz`. Vite dev server proxies `/api` + `/events` to Fastify. In `README.md` record: **pinned
Node 24.18.0**, npm 11.16.0, and the **node-pty plan** — vendor a ConPTY prebuild matching this ABI,
`node-gyp`+VS Build Tools as fallback; node-pty is NOT a dependency yet (added at D3.1).

**Verification.** `npm test` (vitest) green; `npm run build` produces `dashboard/dist/`; manual
`npm run dev` serves an empty Control shell at the localhost origin.

**Commit message:** `feat(dashboard): scaffold Fastify+Vite/React shell, pin Node 24.18.0, decide node-pty ABI strategy`

### Task D0.2 — Plane-A file-watch indexer  *(AGENT-BUILDABLE)*
**Goal.** An in-memory, disposable index of the repo's coordination truth, rebuilt on start and kept
live by file-watch — no SQLite, no source-of-truth store.

**Files touched:** `dashboard/server/planeA/indexer.ts` (`indexRepo(repoRoot)`, `watchPlaneA(repoRoot,
onChange)`), `dashboard/server/planeA/cards.ts` (`parseCardFrontmatter(text)`, `groupByState`),
`dashboard/server/planeA/ledgers.ts` (`rollupLedgers(repoRoot)` — TSV parse + usage rollup),
`dashboard/server/planeA/states.ts` (`readOrgStates(repoRoot)`).

**Failing tests first** (`dashboard/server/planeA/*.test.ts`, using a fixture repo under
`dashboard/test/fixtures/repo-a/`):
- `cards.test.ts > parses frontmatter for all 7 card states` — one card per `STATES` value grouped
  correctly.
- `cards.test.ts > tolerates a card missing optional fields` (no `workflow`/`variant-group`).
- `ledgers.test.ts > rolls up dispatch+cost TSV using only columns that exist` — the cost ledger's
  only quantitative columns are `step` and `usd` (header `model\tstep\tusd`; `ledger.cost_today` sums
  `usd`); there are **no** token or wall-clock columns. The rollup surfaces **per-model `step` counts,
  card/dispatch counts, and model mix**, and **suppresses** the USD figure in the "usage not spend"
  view (it does not fabricate tokens/wall-clock, and it does not claim the data is non-monetary — USD
  exists, it is just not shown).
- `ledgers.test.ts > empty grades/ and activity/ produce an empty-but-valid rollup` (no throw, no
  fabricated rows) — directly guards the current empty-ledger reality.
- `indexer.test.ts > watchPlaneA fires onChange when a card file is written` (chokidar over the
  fixture).

**Implementation.** Watch `queue/`, `ledgers/`, `dashboards/*.md`, `orgs/*/STATE.md`, `skills/**`,
`memory/`. Parse card YAML frontmatter into the index; TSV rollups keyed by kind. Debounce writes;
regenerate the affected slice, not the whole index. Compute rollups directly (nothing reuses the
`dashboard-generator` skill).

**Verification.** `npm test -- planeA` green.

**Commit message:** `feat(dashboard): Plane-A file-watch indexer (cards/ledgers/STATE, usage rollups, empty-safe)`

### Task D0.3 — Plane-B byte-offset JSONL tailer + join engine  *(AGENT-BUILDABLE)*
**Goal.** Incrementally tail multi-MB JSONL transcripts by byte offset, skip non-message records,
join `tool_result → tool_use`, and assemble the subagent spawn tree from flat `.meta.json` files.

**Files touched:** `dashboard/server/planeB/tailer.ts` (`tailFrom(path, byteOffset)`,
`parseRecord(line)`, `SKIP_RECORD_TYPES`), `dashboard/server/planeB/join.ts`
(`joinToolResults(records)`), `dashboard/server/planeB/subagents.ts` (`buildSubagentTree(sessionDir)`
reading flat `subagents/agent-*.jsonl` + `.meta.json`).

**Failing tests first** (`dashboard/server/planeB/*.test.ts`, fixtures under
`dashboard/test/fixtures/jsonl/`):
- `tailer.test.ts > resumes from a byte offset and never re-reads the head` — write N lines, tail from
  the recorded offset, assert only new records emerge.
- `tailer.test.ts > parses a single 3MB line without loading the whole file` — a fixture line ~3 MB
  proves streaming line assembly, not whole-file `readFileSync`.
- `tailer.test.ts > skips non-message record types` — asserts the observed non-message types are
  dropped and `assistant`/`user` are kept. The skip set is aligned to the **observed** kb record types
  (`attachment, last-prompt, mode, permission-mode, ai-title, system, file-history-snapshot,
  file-history-delta, queue-operation`). **`system` is a conscious skip** (it carries session
  metadata, not timeline content — confirm nothing the timeline needs lives there before excluding it,
  ~25 records in a sampled session). **`summary` is included defensively** — it was **not** observed in
  any sampled kb session, so it is a belt-and-suspenders entry, not an observed type (do not treat its
  presence in the test as evidence it occurs).
- `join.test.ts > joins tool_result.tool_use_id to tool_use.id` — a `tool_result` attaches to its
  originating `tool_use` block.
- `join.test.ts > reads model from message.model and usage from message.usage`.
- `subagents.test.ts > builds spawn tree from flat meta files via toolUseId` — three flat
  `agent-*.jsonl` + `.meta.json` (`{agentType, description, toolUseId, spawnDepth, model}`) assemble
  into a parent→child tree by `toolUseId`; asserts FLAT layout (no per-runId dirs).

**Implementation.** Open the file, `fs.read` from `byteOffset` into a rolling buffer, split on `\n`,
retain a trailing partial fragment across reads; parse only complete newline-terminated lines.
`SKIP_RECORD_TYPES` is an allowlist-by-exclusion set. `join` indexes `tool_use.id`, attaches each
`tool_result` by `tool_use_id`. `buildSubagentTree` globs `subagents/agent-*.jsonl`, reads each
sibling `.meta.json`, links by `toolUseId` to the parent `Task` tool-use.

**Verification.** `npm test -- planeB` green, including the 3 MB-line case.

**Commit message:** `feat(dashboard): Plane-B byte-offset JSONL tailer + tool/subagent join (flat meta, huge-line safe)`

### Task D0.4 — SSE/WS hub with Origin/Host validation from day one  *(AGENT-BUILDABLE)*
**Goal.** Push Plane-A/Plane-B deltas to the SPA over SSE (and a read WebSocket for live tails), with
`Origin`/`Host` validation on **every** request and WS upgrade — the invariant later waves inherit.

**Files touched:** `dashboard/server/hub/sse.ts` (`registerSse(app, bus)`),
`dashboard/server/hub/ws.ts` (`registerReadWs(app, bus)`), `dashboard/server/security/origin.ts`
(`assertOrigin(req, expectedOrigin)`, `originPlugin`), `dashboard/server/hub/bus.ts` (in-memory event
bus wiring D0.2 + D0.3 into a stream).

**Failing tests first** (`dashboard/server/security/origin.test.ts`, `hub/*.test.ts`):
- `origin.test.ts > rejects a request whose Origin != the configured ts.net RP origin` → 403.
- `origin.test.ts > rejects a WebSocket upgrade with a mismatched Host` (DNS-rebinding guard) → close.
- `origin.test.ts > accepts the configured origin` → passes through.
- `sse.test.ts > streams an index delta to a subscribed client` — write a fixture card, assert the SSE
  frame carries the delta.

**Implementation.** `expectedOrigin` from config (the ts.net host; `localhost:<port>` allowed only if
enrolled at D0.12). `originPlugin` is a Fastify `onRequest` hook applied globally + on the WS upgrade
handshake. The bus fans D0.2/D0.3 `onChange` callbacks to SSE/WS subscribers.

**Verification.** `npm test -- hub security` green.

**Commit message:** `feat(dashboard): SSE/WS hub + Origin/Host validation on every request and WS upgrade`

### Task D0.5 — KB file browser (read-only tree + markdown render + `git log --follow`)  *(AGENT-BUILDABLE)*
**Goal.** Browse the local checkout read-only: file tree, rendered markdown, per-file history.

**Files touched:** `dashboard/server/kb/browser.ts` (`listTree(repoRoot, subpath)`,
`readFile(repoRoot, relpath)`, `fileHistory(repoRoot, relpath)` — shells `git log --follow --format`),
`dashboard/src/views/Browser.tsx`, `dashboard/src/lib/markdown.ts` (safe render).

**Failing tests first** (`dashboard/server/kb/browser.test.ts`):
- `browser.test.ts > lists tree under a subpath and refuses to escape repoRoot` (a `../../etc` relpath
  is rejected — path-traversal guard).
- `browser.test.ts > fileHistory returns commits for a tracked file via git log --follow` (fixture git
  repo).
- `browser.test.ts > readFile refuses a path outside the repo root`.

**Implementation.** Normalize + confine every relpath to `repoRoot` (reject `..` escapes). `git log
--follow --format=%H%x09%an%x09%ad%x09%s` per file. Markdown rendered client-side with a sanitizer
(no raw HTML injection). Read-only — no write endpoints.

**Verification.** `npm test -- kb` green; manual browse of `orgs/` + `skills/`.

**Commit message:** `feat(dashboard): read-only KB browser (confined tree, markdown, git log --follow)`

### Task D0.6 — Registry views (skills / connections / workflows-if-present)  *(AGENT-BUILDABLE)*
**Goal.** Derive skills, MCP connections, and (only if the dir exists) workflows registries, overlaying
grade/trust where data exists — degrading cleanly to empty-state.

**Files touched:** `dashboard/server/registry/skills.ts` (`indexSkills(repoRoot)` over
`skills/**/SKILL.md`), `dashboard/server/registry/connections.ts` (per-project MCP settings),
`dashboard/server/registry/workflows.ts` (`indexWorkflows(repoRoot)` — **render-if-present**),
`dashboard/src/views/Registry.tsx`.

**Failing tests first** (`dashboard/server/registry/*.test.ts`):
- `skills.test.ts > indexes curated SKILL.md files with name+description`.
- `skills.test.ts > overlays trust grade when ledgers/grades has rows, empty overlay otherwise`
  (guards the currently-empty grades ledger).
- `workflows.test.ts > returns an empty-state marker when no workflows/ dir exists` — asserts
  `{ present: false, items: [] }`, **no throw** (the real repo has no `workflows/`).
- `workflows.test.ts > lists wf_*.md entries when a workflows/ dir is present` (fixture).

**Implementation.** `indexWorkflows` checks `existsSync(repoRoot/workflows)` first; absent → `{present:
false, items: []}`; the SPA renders an explicit "no workflows registered yet" empty state. Trust
overlay reads `ledgers/grades/` and no-ops on empty.

**Verification.** `npm test -- registry` green (including the no-dir path).

**Commit message:** `feat(dashboard): skills/connections registries + render-if-present workflows (empty-state safe)`

### Task D0.7 — Live spectator timeline (message-granular)  *(AGENT-BUILDABLE)*
**Goal.** Render an active session's steps landing live at message/record granularity (~1–2s:
thinking → tool_use → tool_result, subagent tree, per-turn tokens) — the same code path for live tail
and static replay.

**Files touched:** `dashboard/server/timeline/stream.ts` (`streamSession(sessionPath, fromOffset,
bus)` — wraps D0.3 tailer + join into a live feed), `dashboard/src/views/Timeline.tsx`,
`dashboard/src/lib/timelineModel.ts` (`foldRecords(records)` → turn/tool/subagent view model).

**Failing tests first:**
- `timelineModel.test.ts > folds records into ordered turns with attached tool results`.
- `timelineModel.test.ts > nests subagent turns under the spawning Task by toolUseId`.
- `timelineModel.test.ts > surfaces per-turn tokens from message.usage`.
- `stream.test.ts > same fold produces identical model for live-tail and replay of the same file`
  (one code path invariant).

**Implementation.** `streamSession` seeks from the last byte offset and pushes folded deltas onto the
bus; `foldRecords` is pure and shared by replay. Label the surface **message-granular** in the UI (no
intra-turn token claim — that arrives only with the v2 Broker).

**Verification.** `npm test -- timeline` green; manual watch of a live kb session.

**Commit message:** `feat(dashboard): message-granular spectator timeline (shared live/replay fold, subagent nesting)`

### Task D0.8 — Static trace permalinks under `traces/<card-id>/` (distilled)  *(AGENT-BUILDABLE)*
**Goal.** Post-run render of a dispatch's transcript to a self-contained static HTML permalink,
committed **distilled** (Q10) under `traces/<card-id>/` — the Flight-Recorder artifact — with a GC
policy note (raw stays local).

**Files touched:** `dashboard/server/trace/render.ts` (`renderTrace(sessionPath, cardId) -> html`,
`distill(records)`), `dashboard/scripts/write-trace.ts` (CLI: render + write under `traces/<card-id>/`),
`docs/proposals/trace-retention.md` (distilled-vs-raw + GC policy note; governance-adjacent, PROPOSE).

**Failing tests first** (`dashboard/server/trace/render.test.ts`):
- `render.test.ts > renders a self-contained HTML with no external asset refs` (offline-openable).
- `render.test.ts > distill drops raw tool payloads over the size threshold, keeps turn structure`.
- `render.test.ts > path is traces/<card-id>/index.html` (stable permalink shape).

**Implementation.** Light TS fork of `claude-code-log`'s static renderer; inline CSS/JS; `distill`
truncates large tool payloads to summaries. In **D0**, `write-trace.ts` **renders to a local path
only** — it does not commit. **Committing** the distilled `traces/<card-id>/` to `ops` is a **runtime
coordination write** and is the *one* dashboard `ops` write that first appears in the D0 build, so it
is called out explicitly: it follows `git pull --rebase origin ops` → commit → push, and it is wired
as a runtime step, not part of D0's zero-write PR (D0's "zero writes" is a property of the D0 *build /
PR*, not of the daemon at runtime). If preferred, the commit step can be deferred entirely to the D2
governed-write era; the render is what D0 ships.

**Verification.** `npm test -- trace` green; open a rendered trace offline.

**Commit message:** `feat(dashboard): distilled static trace permalinks under traces/<card-id>/ (Flight Recorder)`

### Task D0.9 — React SPA shell: Control-view landing + navigation  *(AGENT-BUILDABLE)*
**Goal.** Assemble D0.5–D0.8 under a tabbed Control-view landing (Q1) with a Code-view toggle stub
(populated in D2/D3), responsive/phone-first layout.

**Files touched:** `dashboard/src/App.tsx` (router + Control/Code tabs),
`dashboard/src/views/Control.tsx` (fleet strip: agents, running count, usage %; approvals placeholder),
`dashboard/src/lib/sseClient.ts` (`useSse(path)`), `dashboard/src/styles/*`.

**Failing tests first** (`dashboard/src/**/*.test.tsx`, vitest + Testing Library):
- `Control.test.tsx > renders the fleet strip from an index snapshot`.
- `Control.test.tsx > lands on Control view by default, Code view reachable by one toggle`.
- `sseClient.test.ts > useSse applies an incoming delta to state`.

**Implementation.** React Router; `useSse` subscribes to `/events`; Control view composes Browser /
Registry / Timeline panes. Code view is a stub tab (no editor/terminal yet). Mobile-first CSS.

**Verification.** `npm test` green; manual desktop + phone-width smoke.

**Commit message:** `feat(dashboard): Control-view SPA shell (fleet strip, SSE client, Code-view stub)`

### Task D0.10 — PWA manifest + service worker (installable standalone shell)  *(AGENT-BUILDABLE)*
**Goal.** Make the SPA an **installable PWA** over the ts.net secure-context origin so HUMAN GATE
D0.13 (add-to-home-screen) and the D2 passkey/push surfaces have something to install. Without this
there is nothing to add to the home screen and no service worker to receive Declarative Web Push.

**Files touched:** `dashboard/public/manifest.webmanifest` (name, icons, `display: standalone`,
`start_url`, `scope`), `dashboard/public/sw.ts` (service worker: offline app-shell cache + a
Declarative-Web-Push stub, no background fleet sync — iOS PWAs have no background sync, live tails stay
foreground per design §3.3), `dashboard/src/lib/registerSw.ts`, `dashboard/index.html` (manifest link
+ theme-color).

**Failing tests first** (`dashboard/src/lib/registerSw.test.ts`, `dashboard/public/manifest.test.ts`):
- `manifest.test.ts > manifest is standalone with a scoped start_url` — asserts `display: "standalone"`
  and `scope`/`start_url` under the served origin.
- `registerSw.test.ts > registers the service worker only over a secure context` — no-ops on
  insecure origin (guards a localhost-http dev boot), registers over https.
- `registerSw.test.ts > service worker caches the app shell and does not background-sync fleet state`
  (asserts no periodic-sync / no fleet fetch in the SW).

**Implementation.** Standard Vite PWA wiring (hand-rolled or `vite-plugin-pwa`, pinned; no external
runtime fetch — assets are same-origin). The SW caches only the static app shell; all live data still
arrives over the foreground SSE/WS from D0.4. Push is a **stub** here (endpoints land in D2).

**Verification.** `npm test -- pwa` green; `npm run build` emits the manifest + SW into `dist/`; manual
install prompt appears over the ts.net origin (verified at the D0.13 gate).

**Commit message:** `feat(dashboard): PWA manifest + service worker (installable standalone shell, foreground-only)`

### Task D0.11 — Playwright SPA smoke (optional/late)  *(AGENT-BUILDABLE, non-gating)*
**Goal.** One end-to-end smoke proving the built SPA loads over the served origin and renders the
Control view. Optional; never blocks a wave.

**Files touched:** `dashboard/e2e/smoke.spec.ts`, `dashboard/playwright.config.ts`.

**Test:** `smoke.spec.ts > loads Control view and shows the fleet strip against the built server`.

**Verification.** `npx playwright test` green on desktop Chromium (run late; not a wave gate).

**Commit message:** `test(dashboard): Playwright Control-view smoke (optional)`

### HUMAN GATE D0.12 — Install Tailscale + Serve + device-scoped ACL + never-funnel assertion
- [ ] Install **Tailscale** on desktop **and** iPhone; join the tailnet. (Tailscale is not installed —
  hard prerequisite; nothing above is remotely reachable until this is done.)
- [ ] Enable **Tailscale Serve** on the daemon port; confirm the backend binds **localhost-only** behind
  Serve; capture the stable `*.ts.net` host (this becomes the WebAuthn RP-ID and PWA secure-context
  origin — set it in the daemon config the `Origin` check reads).
- [ ] Add a **Tailscale ACL restricting the daemon port to your own devices/tag** (not the whole
  tailnet).
- [ ] **Confirm `tailscale funnel` is NEVER used** (funnel would expose the box to the public
  internet); the daemon asserts tailnet-scoped-not-funnelled at startup — verify that assertion fires.
- [ ] Decide (Q4) whether to also register a separate **`localhost` credential** for desktop-direct
  use (different RP-ID = separate passkey); record the decision for D2.

### HUMAN GATE D0.13 — Add-to-Home-Screen the PWA on iPhone
- [ ] Over the Tailscale HTTPS origin, **Add to Home Screen** the PWA (built in D0.10; iOS has no
  auto-install prompt). Confirm it opens standalone. (Passkeys / Face ID work in the installed PWA over
  this origin — needed at D2.)

**Wave-D0 exit criteria:**
1. `dashboard/` builds and serves read-only over localhost + Tailscale Serve; `Origin`/`Host`
   validation rejects mismatches on requests **and** WS upgrades.
2. Plane-A index (cards/ledgers/STATE, usage rollups) and Plane-B tailer (byte-offset, huge-line safe,
   tool + flat-subagent join) are green and drive the live message-granular timeline.
3. KB browser, skills/connections registries, and the **render-if-present** workflows view all render;
   empty `grades/`/`activity/` and absent `workflows/` produce clean empty states, not errors.
4. Distilled trace permalinks render self-contained under `traces/<card-id>/`.
5. **Zero writes in the D0 build/PR** to `queue/`/`ledgers/`/`governance/`; no fleet file touched. (The
   daemon's *runtime* trace-commit under `traces/` is the one permitted `ops` write and is a runtime
   step, not part of the D0 PR — D0.8.) Tailscale + PWA (installable) + add-to-home-screen gates done.
   `npm test` (vitest) fully green.

---

# Wave D1 — Join key + steering-floor states (THE ONLY FLEET-FILE COUPLING)

> This is the single point where dashboard code edits fleet files. **The `dispatch.py` edits MUST join
> the fleet plan's serialized `dispatch.py` queue** — fleet order **3.4 → 4.1 → 4.2 → 5.2**, then
> **D1** — because all are additive edits to the same `run()`/`due()`/card-build path and must land
> through **one** worktree to avoid churn (see Execution order). Do D1 **after** fleet 5.2 merges.
> D1 owns three fleet edits, all inside this one coupling: **(a)** the `session-id` field + threading
> (`cards.py` + `dispatch.py`), **(b)** the steering-floor states (`cards.py`), **(c)** `due()`
> paused-awareness (`dispatch.py`). No *new* coupling point beyond D1 is introduced.

### Task D1.1 — `session-id` field + `dispatch.py` thread + `due()` paused-awareness  *(AGENT-BUILDABLE)*
**Goal.** Introduce the optional `session-id` field (the Plane-A↔Plane-B join key) and make
`dispatch.py` (i) accept an optional `session_id` for the self-executing case and (ii) honor a
files-only `paused` marker so a paused cadence's next beat skips. `session-id` exists **nowhere**
today. **Important scope note:** `dispatch.run()` is the *dispatcher* claiming a card for a worker
whose Claude Code session **does not exist yet**; the `session_id` param here is populated **only** for
the cloud nightly session that self-executes its own carve-out card. The *general* worker case is wired
in **D1.2** (the worker runner stamps it at transition-to-`working`). Advertise the field's meaning
accordingly.

**Files touched:** `scripts/cards.py` (add `"session-id": None` to `new_card` meta defaults; add
`stamp_session(card, session_id)`; leave `_validate` unchanged — the field is optional so legacy cards
stay valid), `scripts/dispatch.py` (thread an optional `session_id: str | None = None` through
`run()`, stamping **after `cards.claim(...)`** — the semantic anchor, **not** a line number; the fleet
serialization moves that call, so never cite "line 80"; and extend `due()` to return `False` when a
`queue/paused/<cadence-name>` marker file exists), `tests/test_cards.py`, `tests/test_dispatch.py`.

**Failing tests first (named ids):**
- `tests/test_cards.py::test_new_card_has_null_session_id_by_default` — a fresh card's meta contains
  `session-id: None` (field present, unset).
- `tests/test_cards.py::test_stamp_session_sets_field` — `stamp_session(card, "sess-abc")` sets
  `card.meta["session-id"] == "sess-abc"`; re-`save`/`parse` round-trips it.
- `tests/test_cards.py::test_missing_session_id_still_validates` — a card with no `session-id` key
  (legacy on-disk card) parses without `ValidationError` (backward compatibility).
- `tests/test_dispatch.py::test_run_stamps_session_id_when_supplied` — `dispatch.run(repo, tier=...,
  agent_id=..., today=..., session_id="sess-xyz")` emits cards whose parsed `session-id == "sess-xyz"`.
- `tests/test_dispatch.py::test_run_without_session_id_leaves_field_null` — the existing no-`session_id`
  call path keeps `session-id: None` (regression: all current dispatch tests stay green).
- `tests/test_dispatch.py::test_due_skips_paused_cadence` — with a `queue/paused/<name>` marker present,
  `due()` (and therefore `run()`) does **not** emit that cadence's card; removing the marker restores it.

**Implementation.** `new_card` gains the default; `stamp_session` is a two-line setter mirroring
`claim`. `run()` signature becomes `run(repo_root, tier, agent_id, today=None, session_id=None)`; after
`cards.claim(...)` call `cards.stamp_session(card, session_id)` **only if** `session_id` — never break
current call sites. `due(cadence, today, repo_root)` gains a paused check (a `queue/paused/<name>`
sentinel — files-only, dashboard-writable via the governed path in D2.8, and does **not** touch the
human-committed `HEARTBEAT.md`). All three edits ride the single serialized `dispatch.py` insertion.

**Verification.** `python -m pytest tests/test_cards.py tests/test_dispatch.py -q` green (old + new;
gpg-independent). Confirm no other `dispatch.run(`/`due(` call site regresses.

**Commit message:** `feat(cards,dispatch): optional session-id field + due() paused-marker awareness`

### Task D1.2 — Worker-runner session-id wiring (stamp at transition-to-`working`)  *(AGENT-BUILDABLE)*
**Goal.** Deliver the join key for the *general* worker case. The dispatcher cannot know a worker's
Claude Code session id (that session is spawned later by the Task-Scheduler runner), so the real value
is stamped by the **worker runner** when it starts executing a claimed card — the only place the id is
known. Without this, `session-id` would be null on every card handed to a worker and the whole Plane-A↔
Plane-B linkage would be undelivered.

**Files touched:** `scripts/cards.py` (no change beyond D1.1's `stamp_session`), the desktop worker
runner (`scripts/agent_runner.ps1` / `scripts/desktop_dispatch.ps1` — fleet-owned runners; the
dashboard edit adds a stamp step) and/or a tiny `scripts/stamp_session.py` CLI shim the runner calls
(`python scripts/stamp_session.py <card_path> <session_id>`), plus `tests/test_stamp_session.py`.

**Failing tests first (named ids):**
- `tests/test_stamp_session.py::test_stamp_cli_sets_session_id_on_card` — the shim reads a card, calls
  `cards.stamp_session`, re-saves; the on-disk card's `session-id` equals the passed id.
- `tests/test_stamp_session.py::test_stamp_is_idempotent_and_preserves_other_fields` — re-stamping the
  same card overwrites only `session-id`.
- Runner shape test (`test_runner_stamps_session_before_work`): the runner script (a) resolves the
  spawned session id from the Claude Code runtime env, and (b) invokes the stamp step **before** the
  worker begins the card (prose/shape test, mirroring the fleet runner shape tests).

**Implementation.** Add a small idempotent CLI shim over `cards.stamp_session` (so the PowerShell runner
needs no Python logic inline). In the runner, after the worker's Claude Code session id is known and
**before** the card moves to `working`, call the shim to stamp it. The runner edit is minimal and
prose-tested; the id-resolution mechanism is a runner/runtime detail (documented, not invented here).
Narrow the field's advertised meaning to "the executing worker's Claude Code session" — populated here,
not by the dispatcher.

**Verification.** `python -m pytest tests/test_stamp_session.py -q` green; runner shape test green.

**Commit message:** `feat(runner): stamp worker session-id at transition-to-working (real Plane-A↔Plane-B join)`

### Task D1.3 — `cards.py` steering-floor states (STATES/STATE_DIR/LEGAL)  *(AGENT-BUILDABLE)*
**Goal.** Make the three transient steering-floor states first-class in `cards.py` so D2.8's stop-floor
writes do not crash. Today `cards.py` `STATES = (inbox, blocked, working, done, approvals, approved,
rejected)`; `_validate` raises on any other state, `STATE_DIR` has no directory for a new state (→
`KeyError` in `save`), and `LEGAL` has no transitions into/out of them — so a `requestStop` that sets
`stop-requested` would `ValidationError`/`KeyError`. This is inside D1's existing `cards.py` edit — it
adds **no new fleet coupling** (decision 3 holds).

**Files touched:** `scripts/cards.py` (extend `STATES` with `stop-requested`, `halting`, `halted`; add
`STATE_DIR` entries — map all three to a `working` (or a new `halting/`) directory so `save` resolves;
extend `LEGAL` with `working → stop-requested → halting → halted`), `tests/test_cards.py`.

**Failing tests first (named ids):**
- `tests/test_cards.py::test_steering_states_are_valid` — a card with `state: "stop-requested"` (and
  `halting`, `halted`) validates and `save`s without `KeyError` (each resolves a `STATE_DIR`).
- `tests/test_cards.py::test_legal_stop_ladder_transitions` — `working → stop-requested`,
  `stop-requested → halting`, `halting → halted` are legal; an illegal jump (e.g. `done →
  stop-requested`) raises `ValidationError`.
- `tests/test_cards.py::test_existing_transitions_unchanged` — every prior `LEGAL` transition and
  `STATE_DIR` mapping still holds (regression: existing card tests stay green).

**Implementation.** Purely additive edits to the three module-level tables; keep the existing states,
dirs, and transitions untouched. Choose a `STATE_DIR` home for the transient states (reuse `working/`
so an in-flight card being stopped stays visible where it ran, or add a `halting/` dir — decide and
test one). Pair with the D1.4 schema proposal (the doc side of the same change).

**Verification.** `python -m pytest tests/test_cards.py -q` green (old + new).

**Commit message:** `feat(cards): steering-floor states (stop-requested/halting/halted) in STATES/STATE_DIR/LEGAL`

### HUMAN GATE D1.4 — `governance/card-schema.md` additions (agent PROPOSES exact text)
- [ ] Agent deliverable (on `claude/m1-dashboard`, in `docs/proposals/card-schema-dashboard.md`): the
  **verbatim** additions to `governance/card-schema.md` (the doc side of the D1.1/D1.3 code edits):
  - `session-id: <str|null>` — the **executing worker's** Claude Code session id, stamped by the worker
    runner at transition-to-`working` (D1.2); for the cloud self-executing case the dispatcher may stamp
    it at claim (D1.1). Joins the card to its Plane-B transcript. Optional; null on unclaimed/legacy
    cards. (Do **not** describe it as "the dispatcher's session" — it is the worker's.)
  - Extend the `state` enum with the **steering-floor** transient states already added to `cards.py`
    (D1.3): `stop-requested`, `halting`, `halted` (files-only cooperative stop; a worker polls
    `stop-requested` at a checkpoint, moves to `halting`, then `halted`; SIGKILL is the backstop).
  - The **cadence `paused` marker** convention: a files-only `queue/paused/<cadence-name>` sentinel that
    `dispatch.due()` consults (D1.1) so the next beat skips — **not** an edit to the human-committed
    `HEARTBEAT.md`; distinct from the per-card stop.
  - The **`## Feedback`** body-section convention (steer text appended for a requeue/rerun — inert like
    `## Evidence`, never executed as instructions).
  - Confirm the **dashboard** WebAuthn `content_hash` **preimage covers the full canonical card payload**
    including `action`, `risk-tier`, `owner`, and `target` (this is what D2.2/D2.3 bind). **Cross-plan
    note:** the *fleet* signed channel's `payload_hash` (fleet 1.1) binds `action`+`target`+work-order
    **only** (no `risk-tier`/`owner`), so tier-laundering prevention on the *fleet* channel rests on the
    re-approval rule, not hash-binding — the two channels canonicalize differently on purpose; do not
    assume the fleet hash covers risk-tier.
- [ ] **Daniel** reviews and commits these into `governance/card-schema.md` on `main` (governance is
  human-committed). Merge `main → ops` so the running fleet sees the schema.

**Wave-D1 exit criteria:**
1. `session-id` round-trips through `cards.parse`; legacy cards without the field still validate;
   **all** existing `test_dispatch.py`/`test_cards.py` cases stay green. The **worker runner** stamps
   the real worker session id at transition-to-`working` (D1.2); the dispatcher self-execute case
   (D1.1) is the only place `run()` stamps it.
2. `cards.py` accepts `stop-requested`/`halting`/`halted` (STATES/STATE_DIR/LEGAL, D1.3) and
   `dispatch.due()` skips a `queue/paused/<name>`-marked cadence (D1.1) — both proven by test, so D2.8's
   stop-floor and pause writes cannot crash.
3. The `dispatch.py`/`cards.py` edits landed **through the shared serialized dispatch queue** (after
   fleet 5.2), via PR to `main`; no dashboard task edits any other fleet file.
4. The card-schema additions (session-id, steering-floor states, paused-marker, `## Feedback`,
   content_hash-preimage confirmation + the fleet-vs-dashboard hash note) are **human-committed** to
   `governance/` on `main`.

---

# Wave D2 — Governed writes (v1) — HARD-GATED on fleet Wave-1 exit + WebAuthn-verifier human security review

> **DO NOT START D2 control surfaces until BOTH gates are open:** (a) fleet **Wave-1 exit** —
> `approvals.py` hardened & merged to `main`, protected `approvals` ref + pinned keyring live; and
> (b) the **WebAuthn verifier passes its human security/threat review (HUMAN GATE D2.11).** The inbox
> drives fleet `verify_signed_approval`/`verify_telegram_approval` by child-process and **consumes**
> `promotion.decide()`'s `assurance_class` — it never recomputes novelty. Every action here is
> WebAuthn-session-gated (design §3.6); localhost/tailnet is never the authenticator.

### HUMAN GATE D2.0 — Confirm the fleet Wave-1 exit is reached (precondition) + note the two later-wave subtask deps
- [ ] Confirm fleet tasks 1.1–1.10 are merged to `main` and `main → ops`; the protected `approvals`
    ref exists (fleet 1.6); `governance/web-flow.gpg` is pinned (fleet 1.7); `verify_signed_approval`
    / `verify_telegram_approval` are callable. **If any is missing, D2 does not start.**
- [ ] **Two D2 subtasks carry additional later-wave preconditions (their own inline gates — the rest of
    D2 does NOT wait on these):**
    - **D2.10** edits `scripts/notify.py`, which is **created by fleet task 2.4 (Wave 2)** — do **not**
      start D2.10 until fleet 2.4 is merged to `main`. (Verified: `scripts/notify.py` does not exist
      today.)
    - **D2.4** consumes `assurance_class`, which is **emitted by fleet 3.1 and stamped on the card by
      fleet 3.4 (Wave 3)** — do **not** start D2.4 until fleet 3.1 + 3.4 are merged to `main`.
      (Verified: `scripts/promotion.py` does not exist today.)
    The remaining D2 write modules (D2.1/D2.2/D2.3/D2.5/D2.6/D2.7/D2.8/D2.9) proceed at Wave-1 exit.

### Task D2.1 — SimpleWebAuthn registration + assertion endpoints  *(AGENT-BUILDABLE)*
**Goal.** The browser-facing enrollment + assertion ceremony (registration options/verification;
assertion options/verification helpers), RP-ID pinned to the full ts.net host (Q4). This is the
*transport*; the load-bearing verify is D2.3.

**Files touched:** `dashboard/server/auth/webauthn.ts` (`registrationOptions(user)`,
`verifyRegistration(resp)`, `assertionOptions(session)`, `assertionForChallenge(challenge)`),
`dashboard/server/auth/session.ts` (short-TTL session token minted at a successful assertion),
`dashboard/src/lib/webauthnClient.ts`.

**Failing tests first** (`dashboard/server/auth/webauthn.test.ts`):
- `webauthn.test.ts > registrationOptions pins rpID to the full ts.net host` (never the bare suffix).
- `webauthn.test.ts > assertionOptions embeds the server challenge and requires userVerification`.
- `session.test.ts > a verified assertion mints a short-TTL session token; expiry rejects` .

**Implementation.** `@simplewebauthn/server`; `rpID` = full host from config; `userVerification:
"required"`. Session token is a signed short-TTL cookie/bearer consumed by every write endpoint.
**Note:** SimpleWebAuthn covers registration/assertion mechanics; it does **not** cover the custom
challenge-binding + independent dispatcher verify — that is D2.3.

**Verification.** `npm test -- auth` green.

**Commit message:** `feat(dashboard): SimpleWebAuthn registration/assertion + short-TTL session (full-host RP-ID)`

### Task D2.2 — Challenge construction + canonical content-hash preimage  *(AGENT-BUILDABLE)*
**Goal.** Deterministically build `challenge = base64url(card_id ‖ action ‖ content_hash ‖ nonce)`
where `content_hash` is over the **full canonicalized card payload** (incl. `risk-tier`, `owner`,
`target`) — so no consequential field escapes the binding.

**Files touched:** `dashboard/server/auth/challenge.ts` (`canonicalCardPayload(card)`,
`contentHash(payload)`, `buildChallenge(cardId, action, contentHash, nonce)`,
`parseChallenge(challenge)`), `dashboard/server/auth/nonce.ts` (`issueNonce()`, `consumeNonce(n)`
single-use store).

**Failing tests first** (`dashboard/server/auth/challenge.test.ts`):
- `challenge.test.ts > content_hash changes when risk-tier/owner/target changes` — three cards with
  identical bodies but a differing consequential field produce three distinct hashes (defeats
  post-approval field mutation).
- `challenge.test.ts > canonicalCardPayload is order-stable` (frontmatter key/whitespace order does
  not change the hash).
- `challenge.test.ts > buildChallenge/parseChallenge round-trip binds card_id + action`.
- `nonce.test.ts > a nonce is single-use; second consume fails` .

**Implementation.** Canonical payload built from named fields explicitly (not raw YAML); SHA-256;
base64url join. Nonce store is in-memory single-use with TTL. This mirrors the fleet
`approval_payload`/`payload_hash` shape but binds the full payload (design §3.5).

**Verification.** `npm test -- challenge nonce` green.

**Commit message:** `feat(dashboard): full-payload content_hash + single-use challenge construction`

### Task D2.3 — [⚠ HIGH-EFFORT · HUMAN-REVIEWED SECURITY] Dispatcher-side WebAuthn verifier  *(NOT a routine agent task)*
> **This is the load-bearing T3 trust boundary. It is carved out as human-reviewed security work with
> an explicit design + threat review (HUMAN GATE D2.11) BEFORE merge — a subtle bug here silently
> defeats the entire approval gate. It is NOT ordinary agent-buildable work: build behind the gate,
> narrow diff, adversarial tests first, security review mandatory.**

**Goal.** Independently verify a recorded WebAuthn assertion in the dispatcher and execute the T3
action **against pinned content**, with the full assertion check set.

**Files touched:** `scripts/webauthn_verify.py` (`verify_webauthn_approval(card_path, repo_root) ->
(bool, reason)` plus private helpers `_check_flags`, `_check_rpid_hash`, `_check_counter`,
`_check_origin`, `_recompute_and_pin_hash`), `tests/test_webauthn_verify.py`. **Invoked by D2.4's
`driveVerify` for WebAuthn-channel cards** (D2.4 both calls `verify_webauthn_approval` and performs the
pinned-content execute), alongside the fleet `approvals.verify_signed_approval` module interface. Expose
a small `__main__`/argparse entry (this is a dashboard-owned script, so a CLI here is fine — unlike the
fleet `approvals.py`) so the Node side can shell it deterministically.

**Failing tests first (adversarial, pytest — write ALL before any impl):**
- `tests/test_webauthn_verify.py::test_uv_zero_rejected` — `UV == 0` (no biometric) → reject (without
  this the whole "biometric required" guarantee is unenforced).
- `::test_up_zero_rejected` — `UP == 0` (no user presence) → reject.
- `::test_wrong_rpidhash_rejected` — `rpIdHash != SHA256(expected full host)` → reject.
- `::test_non_monotonic_counter_rejected` — a sign-counter ≤ the last seen → reject (clone detection).
- `::test_origin_mismatch_rejected` — clientDataJSON `origin` != the ts.net RP origin → reject.
- `::test_nonce_replay_rejected` — a previously-consumed nonce → reject (single-use freshness).
- `::test_signature_not_chaining_to_pinned_pubkey_rejected` — signature not chaining to a
  `governance/`-pinned pubkey → reject.
- `::test_content_hash_recomputed_and_pinned_to_committed_object` — verify recomputes `content_hash`,
  finds it in clientDataJSON, and pins to the **exact committed object/commit hash** the assertion was
  issued against.
- `::test_toctou_ops_swap_rejected` — after issuance, a replacement card is pushed to `ops`; execution
  runs against the **pinned** content, not a re-read of `ops` → the swap does not take effect.
- `::test_valid_assertion_accepts` — a fully-valid fixture assertion → `(True, "ok")`.
- All conditions **fail closed** (missing pinned pubkey / missing nonce store → reject, never
  skip→pass).

**Implementation.** Parse `authenticatorData` (flags byte → UV/UP; `rpIdHash`; sign-count),
`clientDataJSON` (origin + challenge). Recompute `content_hash` (must equal D2.2's canonical hash) and
pin to the committed object; execute against pinned content (closes the TOCTOU — the same-desktop
agent has `ops` write access). Verify signature chains to a `governance/`-pinned pubkey; enforce
monotonic counter (persisted per-credential); enforce nonce single-use. Mirror the fleet suite's
gpg/fixture stance where a real crypto fixture is needed.

**Verification.** `python -m pytest tests/test_webauthn_verify.py -q` green; **plus** the HUMAN GATE
D2.11 security review sign-off recorded before merge.

**Commit message:** `feat(security): dispatcher WebAuthn verifier — UV/UP/rpIdHash/counter/origin/nonce, pinned-hash TOCTOU-safe execute`

### Task D2.4 — Approvals inbox: typed renderers + corroborable challenge UI  *(AGENT-BUILDABLE — GATED on fleet 3.1 + 3.4)*
> **Inline precondition (beyond the D2 wave gate):** `assurance_class` is emitted by fleet **3.1**
> (`promotion.decide()`) and stamped onto the card (`card.meta["assurance_class"]`) by fleet **3.4**,
> both in fleet **Wave 3**. Do not start D2.4 until fleet 3.1 + 3.4 are merged to `main`. (Verified:
> `scripts/promotion.py` does not exist today; `dispatch.py` does not stamp the field yet.)

**Goal.** A ranked approvals inbox that renders each pending card, shows the exact `card_id + action +
risk-tier` the signature will cover (corroborable against the committed card on `ops`) **before** the
biometric prompt, and drives the fleet + WebAuthn verifiers by child-process. **Consumes**
`assurance_class` (read from card frontmatter, stamped by fleet 3.4); never recomputes novelty.

**Files touched:** `dashboard/server/approvals/inbox.ts` (`listPending(index)`, `driveVerify(cardPath,
channel)` — child-processes the appropriate verifier per channel: for the fleet gpg/possession channels
it invokes the fleet functions via a **documented module interface** — `python -c "import sys;
sys.path.insert(0,'scripts'); import approvals; ok,reason = approvals.verify_signed_approval(<card>,
<repo>); ..."` (or `verify_telegram_approval`) — because **`approvals.py` has no argparse CLI** and
adding one would be a second fleet-file edit; for the **WebAuthn channel** it invokes
`scripts/webauthn_verify.py`'s `verify_webauthn_approval` (D2.3) and triggers the **pinned-content
execute**), `dashboard/server/approvals/assurance.ts` (`buttonsFor(assuranceClass)` — reads the card's
frontmatter `assurance_class`), `dashboard/src/views/Approvals.tsx` (corroborable challenge panel).

**Failing tests first:**
- `assurance.test.ts > T3-novel offers signed/WebAuthn-only, NO possession button` (reads
  `assurance_class == "T3-novel"` from frontmatter — does not recompute).
- `assurance.test.ts > T1/T2 or T3-established offers the possession button`.
- `inbox.test.ts > driveVerify invokes the fleet verifier via the module interface (python -c), never
  a nonexistent CLI subcommand, and never writes queue/ directly` (assert on a fake child-process
  runner — the command list uses `python -c "import approvals; …"`, not
  `approvals.py verify_signed_approval`).
- `inbox.test.ts > a WebAuthn-channel card drives scripts/webauthn_verify.py and the pinned-content
  execute` (asserts the WebAuthn verifier D2.3 is actually invoked and its execute runs — the T3
  WebAuthn boundary is wired end-to-end, not only unit-tested in D2.3).
- `Approvals.test.tsx > renders card_id+action+risk-tier from the committed card before prompting`.

**Implementation.** `buttonsFor` switches purely on the frontmatter `assurance_class` (fleet-emitted,
dashboard-read-only). `driveVerify` selects the verifier by channel: fleet signed/possession via the
`python -c` module interface (no fleet-file edit); WebAuthn via `webauthn_verify.verify_webauthn_approval`
(D2.3) followed by its pinned-content execute. The corroborable panel fetches the committed card from
`ops` for independent display. The dashboard never writes `queue/` directly — the governed script
records the assertion.

**Verification.** `npm test -- approvals` green.

**Commit message:** `feat(dashboard): approvals inbox — corroborable challenge, frontmatter assurance_class, module-interface + WebAuthn verify`

### Task D2.5 — CodeMirror governed save (target-classified branch routing, sync_skills-aware)  *(AGENT-BUILDABLE)*
**Goal.** Edit KB/skill markdown in CodeMirror 6 and save through the **governed branch path** — never
a raw write; WebAuthn-session-gated. **The save target determines the branch** (per the plan's Runtime
write classification): durable content is not a coordination write.

**Files touched:** `dashboard/server/write/governedSave.ts` (`save(relpath, content, session)`),
`dashboard/src/views/Editor.tsx` (CodeMirror 6), `dashboard/server/write/branch.ts`
(`classifyTarget(relpath) -> "durable" | "coordination"` + branch-rule guard).

**Failing tests first:**
- `governedSave.test.ts > rejects a save without a valid WebAuthn session` (401).
- `governedSave.test.ts > path confined to repo root` (traversal guard).
- `branch.test.ts > durable content (skills/**, docs/**, KB markdown) routes to a work branch, PR to
  main — NEVER ops, NEVER direct main` (assert on a fake git runner: commit on `claude/m1-dashboard`
  (or a fresh work branch), open a PR to `main`; no push to `ops`, no push to `main`).
- `branch.test.ts > coordination files (queue/**, ledgers/**, traces/**, audit) route to ops via
  pull-rebase-push`.
- `governedSave.test.ts > a skills/** save lets the sync_skills pre-commit hook run and includes its
  staged .claude/skills mirror` (assert the commit does not use `--no-verify` and that a drifted mirror
  fails the save rather than being bypassed).

**Implementation.** Session-gate first; confine path; `classifyTarget` decides the route — **durable**
(`skills/**`, `docs/**`, and other KB markdown) → commit on a work branch → **PR to `main`**;
**coordination** (`queue/**`, `ledgers/**`, `traces/**`, audit log, `queue/paused/**`) → `git pull
--rebase origin ops` → commit → push. A `skills/**` edit triggers the active `.githooks/pre-commit`
`sync_skills.py` (auto-stages `.claude/skills`, then `--check` blocks on residual drift), so the path
must let the hook run and commit its staged mirror — **never** `--no-verify`. Shell git through an
injectable runner (hermetic tests). Never a raw `fs.write` into `queue/`/`ledgers/`/`governance/`.

**Verification.** `npm test -- write` green.

**Commit message:** `feat(dashboard): governed save with target-classified branch routing + sync_skills-hook-aware skill edits`

### Task D2.6 — Card launch / rerun (governed dispatch, preamble-gated)  *(AGENT-BUILDABLE)*
**Goal.** Launch a new card or rerun-as-`depends-on` follow-up through `scripts/*`, WebAuthn-session-
gated, honoring branch rules, **and refusing to dispatch when the fleet is frozen** (ordering-law 8).

**Files touched:** `dashboard/server/write/launch.ts` (`launchCard(spec, session)`,
`rerunAsDependsOn(cardId, feedback, session)` — child-process to `scripts/cards.py`/`dispatch.py`),
`dashboard/server/write/preambleGate.ts` (`assertFleetRunnable()` — child-processes
`python scripts/preamble.py`, or asserts STOP-absent + `ANTHROPIC_API_KEY` unset + budget-OK),
`dashboard/src/views/Control.tsx` (launch/rerun controls).

**Failing tests first:**
- `launch.test.ts > rerun files a new card with depends-on:[orig] and feedback in ## Evidence`
  (feedback is inert data).
- `launch.test.ts > rejects launch/rerun without a WebAuthn session`.
- `launch.test.ts > refuses to launch/rerun when STOP is present` (preamble gate — assert no
  `dispatch.py`/`cards.py` child-process is spawned when a `STOP` file exists).
- `launch.test.ts > refuses to launch when ANTHROPIC_API_KEY is set or the budget is exceeded`
  (preamble gate).
- `launch.test.ts > shells scripts/cards.py; no raw queue/ write`.

**Implementation.** `assertFleetRunnable()` runs **first** (before the WebAuthn-gated dispatch);
on failure, return an error and spawn nothing. Rerun creates a `depends-on:[orig]` card with feedback
in `## Evidence`; launch child-processes the governed dispatch path. Session-gate on both.

**Verification.** `npm test -- launch` green.

**Commit message:** `feat(dashboard): governed card launch + rerun-as-depends-on (session-gated, preamble/STOP-gated)`

### Task D2.7 — Vibe-code chat box (WebAuthn-gated, rate-limited, audited)  *(AGENT-BUILDABLE)*
**Goal.** A chat box that spawns a real `claude --print --output-format stream-json` session against
the kb and streams it back live — a **live prompt with fleet reach (RCE-equivalent)**, so gated behind
the same WebAuthn session, rate-limited, and audited. This is the **CLI-subprocess** path (the
first-class fallback, independent of the SDK/OAuth route).

**Files touched:** `dashboard/server/vibe/session.ts` (`spawnVibe(prompt, session)` — `claude
--print --output-format stream-json`, stream parse, stop wiring; calls `assertFleetRunnable()` from
D2.6 first), `dashboard/src/views/Vibe.tsx`.

**Failing tests first:**
- `session.test.ts > refuses to spawn without a WebAuthn session`.
- `session.test.ts > refuses to spawn when STOP is present / ANTHROPIC_API_KEY set / budget exceeded`
  (preamble gate — a STOP-frozen fleet must not be re-activated by an RCE-equivalent spawn; assert no
  `claude` child-process is launched).
- `session.test.ts > rate-limits and locks out after repeated attempts`.
- `session.test.ts > every spawn writes an audit-log row` (independent audit; D2.9).
- `session.test.ts > parses stream-json deltas into the timeline model` (reuses D0.7 fold).

**Implementation.** `assertFleetRunnable()` (D2.6 preamble gate) **first**, then session-gate +
rate-limit middleware (D2.9); spawn via injectable runner; parse stream-json; `ANTHROPIC_API_KEY` stays
unset (subscription). No SDK/OAuth here — pure CLI subprocess. Because free-form text here is a live
prompt with fleet reach, the preamble/STOP gate is load-bearing, not cosmetic.

**Verification.** `npm test -- vibe` green.

**Commit message:** `feat(dashboard): vibe-code chat box (CLI stream-json, session-gated, preamble/STOP-gated, rate-limited, audited)`

### Task D2.8 — Files-only stop floor (STOP writer, stop-requested/halting, paused marker, SIGKILL backstop)  *(AGENT-BUILDABLE — depends on D1.1/D1.3)*
> **Depends on D1:** the `stop-requested`/`halting`/`halted` states must exist in `cards.py`
> (D1.3) and `dispatch.due()` must honor the `queue/paused/<name>` marker (D1.1), or these writes
> `ValidationError`/`KeyError` and the paused marker is inert. Do not build D2.8 before D1 has merged.

**Goal.** The dashboard-down-safe coarse-stop layer that never needs the Broker: write `STOP`, set a
card `stop-requested`/`halting` (via the D1.3 states), write a cadence `queue/paused/<name>` marker
(consumed by D1.1's `due()`), with a SIGKILL backstop on the Q8 ladder (60s → `interrupt` equivalent →
SIGKILL at +30s).

**Files touched:** `dashboard/server/stop/floor.ts` (`writeStop(session)`, `requestStop(cardId,
session)`, `pauseCadence(name, session)`, `sigkillBackstop(pid, ladder)`), `dashboard/src/views/
Control.tsx` (scoped stop + nuclear STOP controls).

**Failing tests first:**
- `floor.test.ts > writeStop creates the STOP file (session-gated)`.
- `floor.test.ts > requestStop transitions the card working→stop-requested→halting via the governed
  path` (relies on the D1.3 states + LEGAL ladder — asserts no `ValidationError`).
- `floor.test.ts > pauseCadence writes queue/paused/<name> so dispatch.due() skips the next beat`
  (the marker D1.1's `due()` reads; assert the file lands via the governed `ops` path).
- `floor.test.ts > sigkillBackstop escalates on the 60s→+30s ladder` (injected clock).

**Implementation.** All writes governed + session-gated; two controls surfaced distinctly — scoped
(this card/session) vs nuclear `STOP` (whole fleet). Uses the D1.3 steering-floor states and the D1.1
`queue/paused/` marker convention; the marker + card-state writes route as **coordination** writes to
`ops` (pull-rebase-push).

**Verification.** `npm test -- stop` green.

**Commit message:** `feat(dashboard): files-only stop floor (STOP/stop-requested/paused-marker, SIGKILL backstop, session-gated)`

### Task D2.9 — Append-only git-committed audit log + rate-limit/lockout middleware  *(AGENT-BUILDABLE)*
**Goal.** An independent, append-only, git-committed audit trail of every approve/steer/spawn/save/
launch, plus throttling + lockout — independent of the dashboard's own logs.

**Files touched:** `dashboard/server/audit/log.ts` (`appendAudit(event)` — append + `git pull --rebase
origin ops` → commit → push), `dashboard/server/security/ratelimit.ts` (`rateLimit`, `lockout`).

**Failing tests first:**
- `log.test.ts > appendAudit is append-only (never rewrites prior rows)`.
- `log.test.ts > appendAudit commits on ops via pull-rebase-push (retries on a rejected push)`
  (assert on a fake git runner: `pull --rebase origin ops` precedes commit, and a rejected push
  triggers a reconcile-retry rather than a clobber).
- `log.test.ts > every consequential action produces exactly one audit row`.
- `ratelimit.test.ts > throttles then locks out after the threshold`.

**Implementation.** Audit rows are appended to a dedicated `ops` path and committed via the standard
`git pull --rebase origin ops` → commit → push (a rejected push means re-read, reconcile, retry —
the audit log shares `ops` with the fleet dispatcher and other dashboard writers); middleware wraps
every write endpoint. Independent of Fastify request logs.

**Verification.** `npm test -- audit ratelimit` green.

**Commit message:** `feat(dashboard): append-only git-committed audit log + rate-limit/lockout middleware`

### Task D2.10 — Out-of-band dispatcher approval-confirmation push  *(AGENT-BUILDABLE — GATED on fleet 2.4)*
> **Inline precondition (beyond the D2 wave gate):** this task **extends `scripts/notify.py`, which is
> created by fleet task 2.4 (Wave 2)**. Do not start D2.10 until fleet 2.4 is merged to `main`.
> (Verified: `scripts/notify.py` does not exist today.) It also extends `tests/test_notify.py`, which
> 2.4 introduces.

**Goal.** On execution, the **dispatcher** emits an independent ntfy/Telegram push — "you approved card
X: `<action>`, tier `<T>`" — sourced from the dispatcher's own verified view, so a mis-sign is
detectable on a second channel (design §3.5 WYSIWYS residual).

**Files touched:** `scripts/notify.py` (extend the fleet notify path — created by fleet 2.4 — with
`confirm_approval_executed(card, verified_view)`), `tests/test_notify.py` (extend). This is the one D2
task that edits a fleet script; it is additive to a fleet-owned file and lands via PR to `main`.

**Failing tests first:**
- `tests/test_notify.py::test_confirm_push_sourced_from_dispatcher_view` — the confirmation text is
  built from the dispatcher's verified card view, **not** dashboard-supplied fields.
- `::test_confirm_push_names_action_and_tier`.

**Implementation.** Hook the confirmation emit into the post-verify execution path; reuse the fleet
Telegram/ntfy send. Never trust dashboard-rendered fields for the confirmation.

**Verification.** `python -m pytest tests/test_notify.py -q` green.

**Commit message:** `feat(notify): out-of-band dispatcher approval-confirmation push (mis-sign detector)`

### HUMAN GATE D2.11 — WebAuthn verifier security/threat review (BLOCKS D2.3 merge)
- [ ] **Daniel** (or a designated reviewer) runs an explicit **security/threat review of D2.3**
  (`scripts/webauthn_verify.py`): confirm UV=1, UP=1, `rpIdHash`, monotonic sign-counter, origin,
  nonce single-use, signature-chain-to-pinned-pubkey, and the **pinned-hash TOCTOU-safe execute** are
  all present and fail-closed. Record the sign-off. **D2.3 does not merge without it.**

### HUMAN GATE D2.12 — Register passkeys + commit public keys to `governance/`
- [ ] Register **device-bound** passkeys (Q3): Windows Hello/TPM on desktop, Face ID/Secure Enclave on
  iPhone, against the **full-host RP-ID** (never the bare `ts.net` suffix).
- [ ] **Commit the public keys to `governance/`** (agents cannot — branch-protected). These are what
  D2.3 chains signatures to.
- [ ] (Q4) If a `localhost` desktop-direct credential was chosen at D0.12, enroll it now (separate
  RP-ID = separate passkey).

### HUMAN GATE D2.13 — Set tier policy for the weak channel
- [ ] Set which risk tiers may be approved via the weak Telegram/ntfy channel vs. **WebAuthn-dashboard-
  only** (recommend **T3 = dashboard/signed only**). Confirm the `content_hash` preimage covers
  `action` + `risk-tier` + `owner` + `target` (committed at D1.2). Commit the policy note on `main`.

**Wave-D2 exit criteria:**
1. **Both gates open:** fleet Wave-1 exit reached (D2.0) **and** the WebAuthn verifier passed its
   security review (D2.11); passkeys registered + pubkeys committed (D2.12); tier policy set (D2.13).
2. Every write surface (approve, governed-save, launch/rerun, vibe-code, stop-floor) is **WebAuthn-
   session-gated**, `Origin`/`Host`-validated, rate-limited, and audited; none writes `queue/`/
   `ledgers/`/`governance/` raw — all shell `scripts/*`.
3. The dispatcher **independently verifies** assertions (D2.3, full check set, pinned-hash execute);
   the inbox **consumes** `assurance_class` and never recomputes novelty; a mis-sign is detectable via
   the out-of-band push.
4. All TS (`vitest`) + Python (`test_webauthn_verify.py`, `test_notify.py`) suites green.

---

# Wave D3 — Power release (v2) — GATED on SDK-on-subscription ToS re-verify + Broker threat review

> **DO NOT START the Broker (D3.2) or PTY (D3.1) until:** (a) the SDK-on-subscription **ToS is
> re-verified at build time** (HUMAN GATE D3.0) — the Broker's *existence* is contingent on it; and
> (b) the **Broker threat review** (HUMAN GATE D3.6) passes. The CLI-subprocess fallback (D2.7) stays
> first-class regardless. The PTY runs under a **constrained fleet identity** (no `ops` push cred, no
> `CLAUDE_CODE_OAUTH_TOKEN`), WebAuthn-gated + short-TTL + audited.

### HUMAN GATE D3.0 — Re-verify SDK-on-subscription ToS + provision the OAuth token (precondition)
- [ ] **Re-verify at build time** whether a persistent SDK Broker riding the Max subscription is
  permitted (the "individual use vs product/service" line; the June-15 metering change is *paused, not
  cancelled*). If disallowed/metered, **the Broker (D3.2) is not built** — ship PTY + canvas + panels
  on the CLI-subprocess fallback only.
- [ ] If permitted: **Daniel** runs `claude setup-token` and provisions `CLAUDE_CODE_OAUTH_TOKEN` into
  the Broker's env (a credential act — agents never handle it); confirm `ANTHROPIC_API_KEY` stays
  unset; **confirm the token is NOT present in the PTY child's env.**

### HUMAN GATE D3.1 — Create the constrained fleet Windows identity + its pre-authenticated PTY-host task
- [ ] Create a dedicated **fleet Windows account** for the PTY child whose environment **excludes
  Daniel's git push credential and `CLAUDE_CODE_OAUTH_TOKEN`**. Confirm it cannot push `ops` or the
  fleet's coordination writes. (Account/identity creation is human-only.)
- [ ] **Register that account's own at-logon / scheduled task that runs a small PTY-host process under
  the fleet identity** (already authenticated as that account), listening on a **local authenticated
  channel** (named pipe / localhost socket: peer-cred + per-boot token, mirroring the Broker socket).
  **This is what avoids the credential ceiling:** the daemon (running as Daniel) must **not**
  `CreateProcessAsUser`/`runas` the fleet account — doing so would require the daemon to hold that
  account's login secret **as an object**, which ordering-law 5 forbids. Instead the daemon *signals*
  the already-running fleet-identity PTY-host to open a terminal; no login secret is ever handled by
  the daemon. (Human step: create the account + register its task; the host process itself is
  agent-built in D3.2.) **This mechanism is part of the D3.6 review.**

### Task D3.2 — PTY pane (xterm.js + node-pty/ConPTY, signalled fleet-identity host, WebAuthn-gated)  *(AGENT-BUILDABLE)*
**Goal.** A real embedded terminal over WebSocket, where the node-pty child runs inside the
**pre-authenticated fleet-identity PTY-host** (D3.1) that the daemon *signals* over the authenticated
local channel — the daemon never spawns-as-user. WebAuthn-gated with a short session TTL, process-group
tracked, audited.

**Files touched:** `dashboard/server/pty/hostClient.ts` (`openPty(session)` — authenticates to the
D3.1 PTY-host over the local channel (peer-cred + per-boot token) and requests a terminal; refuses
without a fresh WebAuthn step; **issues no `CreateProcessAsUser`/`runas` and handles no account
credential**), `dashboard/server/pty/host.ts` (the host process that runs **under the fleet identity**
and actually spawns node-pty with an explicit env allowlist — shipped to run as the D3.1 task),
`dashboard/src/views/Terminal.tsx` (xterm.js), `dashboard/package.json` (add `node-pty` with the
D0.1-vendored ConPTY prebuild).

**Failing tests first:**
- `hostClient.test.ts > refuses to open without a fresh WebAuthn session` (401).
- `hostClient.test.ts > the daemon signals the pre-running fleet-identity host and NEVER
  spawns-as-user / handles an account credential` (assert on a fake runner: no `CreateProcessAsUser`,
  `runas`, or password/token argument appears; the daemon only sends an authenticated open-request).
- `host.test.ts > the host spawns node-pty under the constrained env allowlist (no push cred, no
  OAUTH token)`.
- `hostClient.test.ts > every PTY open writes an audit row` (D2.9).
- `host.test.ts > process-group tracked so a scoped stop kills the group`.

**Implementation.** The **host** (running as the fleet identity) owns node-pty and the constrained env
allowlist; the **daemon** is a thin authenticated client that requests a terminal over the local
channel (same peer-cred + per-boot-token scheme as the Broker socket) after a fresh WebAuthn step.
xterm.js over WS (same `Origin` check). Honestly a deliberate escape hatch — contained by identity +
gate + audit + the no-spawn-as-user boundary, not the write-funnel.

**Verification.** `npm test -- pty` green; manual desktop terminal session (reserve for desktop, not
phone). **Reconcile with ordering-law 5 at the D3.6 review:** confirm the daemon holds no account
credential.

**Commit message:** `feat(dashboard): PTY pane via signalled fleet-identity host (no spawn-as-user, WebAuthn+TTL, process-group tracked, audited)`

### Task D3.3 — [⚠ HIGH-EFFORT · HUMAN-REVIEWED SECURITY] Broker daemon  *(NOT a routine agent task — a fleet-wide re-architecture)*
> **The Broker changes how the whole fleet executes work: "every steerable worker runs as an SDK
> streaming session under a PM2-supervised session-owner holding control handles." It is its OWN
> High-effort security line, gated behind the ToS re-verify (D3.0) and a threat review (D3.6) BEFORE
> merge — an unauthenticated socket would grant genuinely new lateral-movement capability (injecting
> into a sibling agent's in-flight turn). NOT ordinary agent-buildable work.**

**Goal.** A long-lived, dispatcher-side session-owner that spawns fleet workers as SDK streaming
sessions, holds their control handles, exposes an **authenticated** localhost socket with five verbs,
actively honors `STOP` by draining live handles, and is PM2-supervised — with a first-class CLI-
subprocess fallback.

**Files touched:** `broker/index.ts` (session-owner, `spawnSession`, handle table),
`broker/socket.ts` (localhost socket: peer-cred + per-boot token auth), `broker/verbs.ts`
(`list, inspect, stop, steer, rerun`), `broker/stopWatch.ts` (active `STOP` file-watch → drain),
`broker/preambleGate.ts` (`assertFleetRunnable()` before any `spawnSession` — STOP-absent +
`ANTHROPIC_API_KEY` unset + budget-OK), `broker/fallback.ts` (CLI-subprocess degrade path),
`broker/pm2.config.cjs`, `broker/*.test.ts` (vitest).

**Failing tests first (adversarial — write ALL before impl):**
- `socket.test.ts > rejects a connection failing peer-credential check`.
- `socket.test.ts > rejects a connection without the per-boot dispatcher-issued token`.
- `socket.test.ts > accepts only peer-cred AND token together`.
- `preambleGate.test.ts > spawnSession refuses to spawn when STOP is present` (a STOP-frozen fleet must
  not be re-activated by a Broker spawn — distinct from the `stopWatch` *drain* of already-live
  handles; this guards *starting* new work).
- `preambleGate.test.ts > spawnSession refuses when ANTHROPIC_API_KEY is set or budget exceeded`.
- `stopWatch.test.ts > on STOP appearance, interrupt()→SIGTERM→SIGKILL drains every live handle on the
  Q8 ladder` (injected clock).
- `verbs.test.ts > steer that raises a card's risk-tier re-triggers approval (never launders a tier
  bump past the gate)`.
- `verbs.test.ts > graceful verbs apply ONLY to Broker-spawned sessions; external TTY/-p/Routines are
  kill-only` (hard boundary).
- `fallback.test.ts > degrades to CLI-subprocess-only when the SDK/OAuth path is unavailable`.

**Implementation.** `assertFleetRunnable()` runs **before every `spawnSession`** (the constitution's
preamble/STOP gate — the `stopWatch` drains live handles, but nothing must *start* under STOP). SDK
streaming sessions via `CLAUDE_CODE_OAUTH_TOKEN`; handle table keyed by session; socket auth =
`SO_PEERCRED`/named-pipe peer-PID→owner **and** per-boot token; `stopWatch` actively drains on `STOP`;
verbs enforce the tier-bump re-approval rule (**note:** the re-approval binds via the *dashboard*
`content_hash` preimage, which includes `risk-tier`; the *fleet* `payload_hash` does not — so a fleet-
channel tier bump is caught by the re-approval rule, not hash-binding) and the
graceful-only-for-Broker-sessions boundary. PM2-supervised. The dashboard is a thin authenticated
client over the socket.

**Verification.** `npm test -- broker` green; **plus** the D3.6 threat-review sign-off recorded before
merge.

**Commit message:** `feat(broker): PM2-supervised SDK session-owner — authenticated socket, active STOP-drain, five verbs, CLI fallback`

### Task D3.4 — React Flow pipeline canvas over `depends-on` DAGs  *(AGENT-BUILDABLE)*
**Goal.** Render `depends-on`/`variant-group` card graphs as a React Flow canvas with per-node
stop/rerun (wired to D2.6/D2.8 + D3.3 verbs where present).

**Files touched:** `dashboard/server/dag/graph.ts` (`buildDag(index)` from card `depends-on`),
`dashboard/src/views/Pipeline.tsx` (React Flow).

**Failing tests first:**
- `graph.test.ts > builds nodes+edges from depends-on`.
- `graph.test.ts > marks variant-group siblings`.
- `graph.test.ts > a node with an unreleased dependency renders blocked`.

**Implementation.** Pure `buildDag` over the Plane-A index; React Flow renders; node actions reuse
existing governed controls.

**Verification.** `npm test -- dag` green.

**Commit message:** `feat(dashboard): React Flow pipeline canvas over depends-on DAGs`

### Task D3.5 — Layer panels (Sentinel / Quartermaster / Flight Recorder / Atlas stubs)  *(AGENT-BUILDABLE)*
**Goal.** Dock-in panel stubs reading the same projection: Sentinel health, Quartermaster cost/usage,
Flight Recorder run-diff (over D0.8 traces), Atlas read-aloud stub. Plus an optional code-server annex
note (design §5, C-as-annex).

**Files touched:** `dashboard/src/views/panels/{Sentinel,Quartermaster,FlightRecorder,Atlas}.tsx`,
`dashboard/server/panels/health.ts`, `dashboard/server/panels/usage.ts`, `docs/proposals/code-server-
annex.md` (optional annex note — never the front door).

**Failing tests first:**
- `health.test.ts > Sentinel reports agent liveness from HEARTBEAT/STATE`.
- `usage.test.ts > Quartermaster rolls up per-model step counts + card/dispatch counts + model mix from
  the cost/dispatch ledgers` — uses only columns that exist (`model`, `step`, `usd`; `ledger.cost_today`
  sums `usd`); labeled **usage** and it **suppresses** the USD figure rather than claiming the data has
  no dollar value or fabricating tokens/wall-clock (which the ledger does not record).
- `FlightRecorder.test.tsx > links to committed traces/<card-id>/ permalinks`.

**Implementation.** Each panel is a projection reader; no new writes. Atlas is a stub. Annex is a doc
note only.

**Verification.** `npm test -- panels` green.

**Commit message:** `feat(dashboard): layer panels (Sentinel/Quartermaster/Flight Recorder/Atlas stubs) + code-server annex note`

### HUMAN GATE D3.6 — Broker threat review + constrained-identity sign-off (BLOCKS D3.3 merge)
- [ ] **Daniel** runs an explicit **threat review of the Broker (D3.3)**: confirm the socket requires
  **both** peer-cred and the per-boot token, the active `STOP`-drain works on the Q8 ladder, graceful
  verbs are **Broker-spawned-only**, a `steer` cannot launder a tier bump, and the CLI-subprocess
  fallback is first-class. Record the sign-off. **D3.3 does not merge without it.**
- [ ] Sign off that the **PTY and vibe-code sessions run as constrained fleet identities** (branch +
  approval + WebAuthn gates still bind) and approve the merge of the v2 dashboard code.

**Wave-D3 exit criteria:**
1. ToS re-verified (D3.0); constrained fleet identity created (D3.1); Broker threat review passed
   (D3.6). If ToS disallows the Broker, D3.3 is **skipped** and the wave ships PTY + canvas + panels on
   the CLI-subprocess fallback.
2. The PTY runs inside the **pre-authenticated fleet-identity host** (no push cred / no OAUTH token in
   its env), which the daemon **signals** over an authenticated local channel — the daemon never
   spawns-as-user and holds no account credential (reconciled against ordering-law 5 at D3.6);
   WebAuthn+TTL-gated, process-group tracked, audited.
3. The Broker (if built) authenticates every socket connection (peer-cred + per-boot token), **runs the
   preamble/STOP gate before every `spawnSession`** (refuses to start work under STOP), actively drains
   handles on `STOP`, exposes the five verbs graceful-for-Broker-sessions-only, re-triggers approval on
   a tier-raising steer, and degrades to CLI-subprocess.
4. Pipeline canvas + layer panels render over the projection; all vitest suites green.

---

## Month-1 dashboard exit criteria (overall)

The dashboard month is done when all hold:
1. **v0 Observatory live** (D0): read-only projection over Plane A + Plane B serves the Control-view
   SPA over Tailscale Serve with `Origin`/`Host` validation; message-granular timeline, KB browser,
   registries (workflows render-if-present), distilled trace permalinks; **zero writes in the D0
   build/PR, zero fleet coupling**; Tailscale + installable-PWA + add-to-home-screen gates done.
2. **Join key shipped** (D1): `session-id` stamped by the **worker runner** at transition-to-`working`
   (D1.2; the dispatcher self-execute case in D1.1), round-tripping through `cards.py`; the
   steering-floor states + `due()` paused-marker awareness live; all landed through the **shared
   serialized dispatch queue**; card-schema additions (session-id, steering-floor states, paused
   marker, `## Feedback`, hash-preimage note) human-committed.
3. **v1 governed writes live** (D2), only after **fleet Wave-1 exit + WebAuthn-verifier security
   review** (and the two subtask deps: fleet 2.4 for D2.10, fleet 3.1+3.4 for D2.4): approvals inbox
   (reading frontmatter `assurance_class`, driving the fleet verbs via the module interface + the
   WebAuthn verifier end-to-end), target-classified governed save, preamble/STOP-gated launch/rerun and
   vibe-code, files-only stop floor — all WebAuthn-session-gated, `Origin`-validated, rate-limited,
   audited; the dispatcher independently verifies assertions with the full check set + pinned-hash
   execute; out-of-band confirmation push live.
4. **v2 power release live** (D3), only after **ToS re-verify + Broker threat review**: PTY via the
   signalled fleet-identity host (no spawn-as-user); Broker (if ToS-permitted) with authenticated socket
   + preamble/STOP gate on spawn + active STOP-drain + five verbs + CLI fallback; React Flow canvas;
   layer panels.
5. **All tests green:** `npm test` (vitest, all waves) + `python -m pytest tests/test_cards.py
   tests/test_dispatch.py tests/test_stamp_session.py tests/test_webauthn_verify.py tests/test_notify.py
   -q` pass. Optional Playwright smoke green.

**Explicitly NOT in month-1 dashboard scope:** per-skill structured forms (Q9 — CodeMirror only);
Monaco (CM6 default); intra-turn token streaming outside the Broker; hooks (file-watch only, Q2);
code-server as the front door (annex-only); any funnel exposure; the PTY as a phone-primary surface.

---

## Build-session execution order (parallel-in-worktrees vs strictly serial)

**Strictly serial spine (each gates the next):**
- **D0 → D1 → D2 → D3** at the wave level: read-only before the join key before governed writes before
  the power release.
- **D1's `dispatch.py`/`cards.py` edits MUST join the fleet plan's serialized `dispatch.py` queue.**
  The fleet plan serializes **all** `dispatch.py` edits through **one** worktree in the order
  **3.4 → 4.1 → 4.2 → 5.2** (fleet Execution-order §"Wave 4 shares dispatch.py"); **D1 appends to the
  END of that chain — do D1 only after fleet 5.2 merges**, re-running `tests/test_dispatch.py` after
  each link. Within D1, do **D1.1** (session-id thread + `due()` paused-awareness, both `dispatch.py`)
  and **D1.3** (`cards.py` steering-floor states) as the fleet-file edits that ride the serialized
  queue; **D1.2** (worker-runner stamp) touches the runner scripts + a small shim, not `dispatch.py`,
  and can follow once D1.1 lands. This is the single shared-serialization contract between the two
  plans; violating it (editing `dispatch.py` in a concurrent worktree) causes exactly the churn the
  fleet plan serializes to avoid.
- **D2 is a HARD serial gate behind two events:** fleet **Wave-1 exit** AND the **WebAuthn-verifier
  security review (D2.11)**. Neither alone opens it. D2.3 does not merge before D2.11.
- **D3 is a serial gate behind the ToS re-verify (D3.0) AND the Broker threat review (D3.6).** D3.3
  does not merge before D3.6; if D3.0 disallows the Broker, D3.3 is dropped and the rest of D3 ships.

**Safe to parallelize in separate worktrees (independent file sets, no shared-function edits):**
- **D0 runs entirely in its own worktree in parallel with fleet Waves 0–1** (decision 3). Within D0:
  D0.2 (Plane A), D0.3 (Plane B) are independent files and parallelize; D0.4 (hub) depends on both;
  D0.5/D0.6 are independent of the planes; D0.7 depends on D0.3; D0.8 depends on D0.3; D0.9 composes
  D0.5–D0.8; D0.10 (PWA manifest/SW) depends only on the SPA shell (D0.9); D0.11 (Playwright) is last
  and optional. HUMAN GATES D0.12/D0.13 proceed in parallel with agent coding and must be done before
  any remote use (D0.13 needs D0.10's installable PWA).
- **D1** is a tiny serial insertion into the fleet dispatch queue — not parallelizable against other
  `dispatch.py` work by construction.
- **Within D2** (after both gates open): D2.1 (WebAuthn transport) and D2.2 (challenge/hash) are
  independent and parallelize; **D2.3 (the HIGH-EFFORT verifier) is built behind the security gate**,
  consumes D2.2, and is its own worktree with adversarial-tests-first; **D2.4 has an extra inline gate
  on fleet 3.1+3.4** (`assurance_class`) and depends on D2.1+D2.2+D2.3 — it lands only after fleet Wave
  3 merges, so it is typically the *last* D2 task; D2.5/D2.6/D2.7/D2.8 are independent write modules
  (parallel) that all depend on D2.1's session + D2.9's middleware (D2.6/D2.7 also on the D2.6 preamble
  gate; D2.8 on D1.1/D1.3); D2.9 (audit + rate-limit) should land early so D2.5–D2.8 wrap it; **D2.10
  (Python notify) has an extra inline gate on fleet 2.4** (it extends `scripts/notify.py`) and lands
  only after fleet Wave 2 merges, parallelizing with the TS work otherwise.
- **Within D3** (after both gates open): D3.2 (PTY) depends only on D3.1's identity + D0.1's node-pty
  prebuild; **D3.3 (the HIGH-EFFORT Broker) is its own worktree behind the threat gate**; D3.4 (canvas)
  and D3.5 (panels) are pure projection readers and parallelize freely with everything.

**Recommended session batching:** Session 1 = D0 in its own worktree (parallel with fleet Wave 0/1),
plus D0.12/D0.13 gates. Session 2 = D1, inserted at the tail of the fleet dispatch serialization after
fleet 5.2 merges. Session 3 (only after fleet Wave-1 exit + D2.11) = D2 — land D2.9 first, then
D2.1∥D2.2, then D2.3 behind the security gate, then D2.5–D2.8 (the write modules not gated on later
fleet waves); **defer D2.10 until fleet 2.4 merges and D2.4 until fleet 3.1+3.4 merge** (they are the
two subtasks with later-wave fleet preconditions). Session 4 (only after D3.0 + D3.6) = D3 — D3.2 +
D3.4 + D3.5 in parallel, D3.3 behind the threat gate. The two HIGH-EFFORT security lines
(D2.3 verifier, D3.3 Broker) are never batched with routine tasks and never merge without their review
sign-off.

---

## Findings-disposition log (adversarial review → this FINAL)

Two lenses ran against the live repo (`kb-worktrees/m1-fleet`, branch `claude/m1-fleet`), the real
Claude Code transcript dir, `dispatch.py`/`cards.py`/`ledger.py`/`approvals.py`, and the fleet plan.
**Accepted: 20 of 21** (repo-reality 8/8; ordering-safety 12/13 fully, 1 partially). **Partially
rebutted: 1** (repo-reality MINOR 5). No finding was fully rebutted.

**repo-reality lens**
1. BLOCKER — D2 gate understates fleet deps (D2.4↔3.1/3.4, D2.10↔2.4) → **ACCEPTED.** Ordering-law 2,
   D2.0, D2.4/D2.10 headers now carry the explicit later-wave preconditions.
2. MAJOR — D2.4 shells a nonexistent `approvals.py` CLI → **ACCEPTED.** `driveVerify` now uses the
   `python -c "import approvals; …"` module interface (no fleet-file edit); D2.3 exposes its own CLI.
3. MAJOR — join key stamped in the dispatcher can't know the worker session → **ACCEPTED.** New D1.2
   stamps it in the worker runner at transition-to-`working`; D1.1's dispatcher param narrowed to the
   cloud self-execute case; field meaning re-advertised.
4. MAJOR — cost rollup test contradicts the ledger schema → **ACCEPTED.** D0.2 + D3.5 reworded to
   per-model `step` counts / card-dispatch counts / model mix; "tokens/wall-clock" and "never a dollar
   figure" removed (USD exists and is suppressed, not denied).
5. MINOR — D2.4 reads a `assurance_class` card field "not defined" → **PARTIALLY REBUTTED.** Fleet 3.4
   **does** stamp `card.meta["assurance_class"]`, so the field is real and named by a fleet task; the
   fix applied is the clarification (D2.4 reads it from frontmatter, source named), not a new D1.4
   schema field.
6. MINOR — D0.3 skip-list names `summary` (unseen) and skips `system` (seen) → **ACCEPTED.** Skip-list
   aligned to observed types; `summary` marked defensive; `system` made a conscious skip.
7. MINOR — ground-truth mis-describes the transcript `workflows/` layout → **ACCEPTED.** Prose fixed:
   flat `subagents/` confirmed, transcript `workflows/` de-conflated from the repo `workflows/`
   registry, unverified `wf_<id>.json` claim dropped for the transcript side.
8. MINOR — stale "line 80" anchor in D1.1 → **ACCEPTED.** Replaced with the semantic "after
   `cards.claim`" anchor; number removed.

**ordering-safety lens**
1. BLOCKER — no STOP/preamble gate on D2.6/D2.7/D3.3 spawn paths → **ACCEPTED.** New ordering-law 8;
   `assertFleetRunnable()` + `refuses … when STOP present` tests added to D2.6, D2.7, and D3.3.
2. MAJOR — steering-floor states never added to `cards.py` → **ACCEPTED.** New D1.3 extends
   STATES/STATE_DIR/LEGAL (inside D1's existing `cards.py` edit — no new coupling).
3. MAJOR — D2.4/D2.10 depend on later fleet waves → **ACCEPTED** (same as repo-reality 1).
4. MAJOR — join key null in practice (dispatcher stamp) → **ACCEPTED** (same as repo-reality 3).
5. MAJOR — governed-save routes durable content to `ops`, fights `sync_skills` → **ACCEPTED.** D2.5
   now classifies durable-content (→ work branch → PR to `main`) vs coordination (→ `ops`) and is
   sync_skills-hook-aware; a Runtime-write-classification block added to branch discipline.
6. MAJOR — `pauseCadence` overlay nothing reads; enforcement needs a `dispatch.py` edit →
   **ACCEPTED.** D1.1 folds `due()` paused-marker awareness into the single serialized `dispatch.py`
   insertion (`queue/paused/<name>` marker, files-only, no HEARTBEAT edit); D2.8 writes/clears it.
7. MAJOR (uncertain) — PTY spawn-as-user makes the daemon hold the fleet account credential →
   **ACCEPTED.** D3.1 now registers a pre-authenticated fleet-identity PTY-host task; D3.2's daemon
   *signals* it over an authenticated channel and never `CreateProcessAsUser`; reconciled with
   ordering-law 5 at D3.6.
8. MAJOR (uncertain) — no task invokes the D2.3 WebAuthn verifier → **ACCEPTED.** D2.4's `driveVerify`
   now routes WebAuthn-channel cards to `verify_webauthn_approval` + the pinned-content execute, with a
   test; D2.3 names D2.4 as its caller.
9. MINOR — D0.8 `traces/` write during "zero writes" D0 → **ACCEPTED.** D0.8 renders locally in D0;
   the trace *commit* is the one permitted runtime `ops` write (pull-rebase-push), explicitly scoped
   out of the D0 PR; exit criterion 5 reworded.
10. MINOR — no PWA manifest/service-worker task → **ACCEPTED.** New Task D0.10; Playwright → D0.11,
    D0 gates → D0.12/D0.13.
11. MINOR — `ops` write discipline under-specified for D2.9/D0.8 → **ACCEPTED.** pull-rebase-push made
    explicit on the audit log and traces (and in branch discipline for all runtime `ops` writes).
12. MINOR (uncertain, cross-plan) — risk-tier-in-preimage guarantee holds only for the dashboard hash →
    **ACCEPTED.** A cross-plan note added (D1.4 schema proposal + D3.3): fleet `payload_hash` binds
    action+target+work-order only, so fleet-channel tier-laundering is caught by the re-approval rule.
13. MINOR — plan-doc destination/branch not stated → **ACCEPTED.** Preamble now states the doc lives at
    `docs/plans/2026-07-16-dashboard-implementation.md` on `claude/m1-fleet`; code on `claude/m1-dashboard`.
