---
schema-version: 1
id: 6a87f534-f8efbaee
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\AppData\Local\kb-codex-dispatch\worktrees\6a87f0e6-0e8ac331
risk-tier: T1
owner: codex-worker
claim-token: f8a22d25ceda3c67
state: done
approval: null
workflow: 01a02305-24e2-78b1-9b33-6b4d2e3c80ed
depends-on: []
variant-group: null
role: work
session-id: 6a87f0e6-0e8ac331
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: b0e7b6659af9d12ac28dd336e45ee427ff6bcda0
---

## Work order

\# Brief — TARGETED PATCH of the Dashboard v3 P1 plan (round 4)

`docs/plans/2026-08-20-dv3-p1-plan.md` (round 3, commit `f43f2950`) passed its grep audit (every §2/§3 hit
list now matches source) but its round-3 adversarial review found 9 blockers + 7 majors + 1 minor in
ordering, shapes, and scope. This is a PATCH round, not a rewrite: apply each finding's **"Required"**
clause exactly, touch nothing the review did not name, keep section structure and numbering. Edit the
plan in place; no other file; no commit; no `npm` commands (no node_modules — `git grep`/read only).

\## Read (in order)
1. `C:/Users/danie/AppData/Local/Temp/claude/C--Users-danie-kb/ce8d7c13-5aa9-4545-a0b9-babacd112cb2/scratchpad/dv3-p1-plan-review-3.md`
   — the findings; each has claim · evidence (file:line) · Required change. Verify each evidence line
   yourself before editing.
2. The plan. Then `docs/specs/2026-08-20-dashboard-v3-design.md` §3, §4 (lines 121-159), §5, §8, §9, §10
   P1 and `dashboard/docs/ux-rules.md` for the lines the review cites.
3. Only the source files the findings cite.

\## Apply (one bullet per finding; the review's "Required" text is binding unless a ruling below overrides)
- **B1** W0 helper: add an awaited readiness API (`renderWithTestSession` / `installTestAuthContext` returning
  a promise that resolves when `mode` is set) or a synchronous injected initial mode; every migrated test
  awaits it; fetch stubs restored per test. Name the API in W0 and in §11.
- **B2** Keep all three PTY 401 rows as a Win32-capability `buildApp()` matrix runnable on both OSes; keep
  the Linux-404 composition test. No row deleted.
- **B3** Durability: serialized VALID control-plane fixture padded to 128 KiB; latency/fsync assertions
  unchanged. State the padding mechanism.
- **B4 — BOSS RULING:** no canonical next-fire reader exists without schedule semantics (P1-Out). Keep
  `nextScheduledFire` OUT of the P1 contract AND add a §11 row `needs spec amendment — Daniel gate` with
  this proposed wording: *"§5 Inbox empty state: in P1 the empty state is `Nothing needs you`; the
  trailing next-scheduled-fire line is added in P2 with the Schedules store (no second clock in P1)."*
  Change §11's "zero Daniel-gate rows" sentence accordingly and point W1 at the row. If Daniel rejects
  the amendment the plan must say what P1 would then need (name the P2 reader it would depend on).
- **B5** One atomic W5 substep: narrow `StopControls` to fleet STOP only, remove `/api/write/stop-card`
  registration, delete Sentinel + its test, mount served Health. Health is never served with card-stop
  or cadence-pause controls. Re-sequence W5.2–W5.4 so every substep ends green; renumber if needed.
- **B6** `humanInbox.ts` move/delete happens in the same substep that deletes `Approvals.tsx`,
  `Approvals.test.tsx`, `ApprovalsLive.tsx/.test.tsx` and strips `fetchHumanInbox` + `HumanInboxProjection`
  import + their tests from the retained `src/lib/approvalsClient.ts`. A copy or re-export is not a move.
- **B7** W5.3 rewrites/deletes every stale retired-route assertion the review lists (`index.test.ts:210-226`,
  `surface.test.ts:255-285,1008-1014,1060-1075`, `panels/routes.test.ts:13-27,57-70`,
  `panels/loopStatus.test.ts:527-538` ordering) and runs `index.test.ts` + `surface.test.ts` UNFILTERED before
  proceeding. Co-delete route-owned tests that cannot stay green, in the same patch as their route.
- **B8** Health: exact response envelope; closed row union including an `unavailable`/`error` variant;
  one Release row in daemon/machine; VM/Desktop rows beside each MCP configuration only; section order
  fleet, STOP, daemon/machine, MCP, usage.
- **B9** Greps: restrict `spend` and `Composer` greps to retired route/type/UI identifiers OR enumerate the
  exact allowed hits (`AgentWorkPanel.tsx:207-213`, `workflows.css:439,506-508`, the `emits no spend`
  title). No grep may require an impossible empty result.
- **M1** Inbox `id`/`createdAt`/`revision`: pin the algorithms from spec lines 249-258 (deterministic hash
  of kind + `subject.cardId`; source-event time = name the card field; revision = name the source) using
  fields that EXIST in `server/planeA/cards.ts:32-45` / `indexer.ts:38-40` — or, if no honest source exists
  for one of them, add it to the B4 Daniel-gate row rather than inventing.
- **M2 — BOSS RULING:** W4 = humanization (`EntityName.tsx`, pure `humanizeEntityId.ts`, acronym dictionary),
  structural grid/list persistence key, mounted roster + overlay + focus trap/restore + 720 px, and the
  Live/Brief/Details chrome rendered over EXISTING loaded facts. Remove: computed card values (status/
  model/temporal/gate counts), host chip from daemon platform, System-agents grouping, tab content
  projections — all P2 (spec 131-159, 561-569). Update W4 tests, ownership row, §10 Out list.
- **M3** Palette: exact full-command inventory test = ten destinations + retained entity-bound actions;
  remove global aliases (`Launch`, `Approve/Stop`, `Open Inbox`) unless each is justified as entity-bound.
- **M4** Enumerate and delete the scoped-stop closure in `server/stop/floor.ts` (`PyRunResult`, `PyRunner`,
  `defaultPyRunner`, `FloorDeps.runPy`, parser/outcome types, Python imports at the cited lines) + their
  exact floor tests; add dead-symbol greps to §8.
- **M5** Inbox SSE: one in-flight GET + at most one trailing refresh; burst → ≤2 requests; pin the counts in
  the fixture scenario and the component test.
- **M6** Browser URL encoding tests: spaces, `#`, `?`, `%`, slashes/traversal, exactly-once encoding; keep
  `server/kb/routes.test.ts:35-69`.
- **M7** Real-server browser procedure: create/install/build/run consistently as one account (state which),
  name the second terminal + cleanup; every checklist item recorded in the 2×2 (dark/light × desktop/720).
- **Minor E** State explicitly that `appTokens.test.ts`/`entityDetail.test.ts` are `readFileSync` CSS-source
  parsers (pattern `titleClamp.test.ts:46-71`).

\## Acceptance
- Every one of the 17 items above is visibly applied at the cited place; nothing else changed in intent.
- Branch `claude/dashboard-v3`; sections 1–11 intact; W5 substeps still ordered with green checkpoints.

Final message: the plan path + one line per item (B1…Minor E) stating WHERE it was applied (section/
substep), + the §11 Daniel-gate row text verbatim, + any item you could not apply and why.

## Result

Patched [2026-08-20-dv3-p1-plan.md](/C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a87f0e6-0e8ac331/docs/plans/2026-08-20-dv3-p1-plan.md:1).

- B1 — W0 and §11: awaited `renderWithTestSession`/`installTestAuthContext().ready`, with per-test fetch restoration.
- B2 — W0 and §11: retained all three PTY 401 rows in an injected-Win32 `buildApp()` matrix plus Linux 404 coverage.
- B3 — W0 and §11: valid serialized control-plane JSON padded with ASCII spaces to exactly 128 KiB.
- B4 — W1, §10, and §11: added the Daniel gate, kept `nextScheduledFire` outside P1, and named the required P2 schedules reader if rejected.
- B5 — W5.3: atomic StopControls narrowing, scoped-stop registration removal, Sentinel deletion, and served Health mount.
- B6 — §3 and W5.4: true `humanInbox.ts` move/delete with all four Approvals files and obsolete approvals-client symbols/tests removed together.
- B7 — W5.3: enumerated every stale route assertion and required unfiltered index/surface checkpoints.
- B8 — §2 and W2: exact `HealthResponse`, closed unavailable variant, one daemon/machine Release row, and MCP-adjacent VM/Desktop rows.
- B9 — §8: spend permits only the named test title; Composer checks target retired identifiers and preserve enumerated AgentWorkPanel hits.
- M1 — W1 and §11: pinned escalation ID hashing; unresolved timestamp/revision sources share the Daniel gate.
- M2 — ownership table, W4, and §10: limited P1 to humanization and structural entity chrome; deferred computed projections, host, grouping, and tab contents to P2.
- M3 — W5.3 and §11: exact ten-command inventory; removed all current global aliases because none is entity-bound.
- M4 — W5.4 and §8: enumerated the full scoped-stop Python closure, exact tests, and dead-symbol grep.
- M5 — W1, W5.6, and §7: one in-flight GET, one trailing refresh, five-frame burst, exactly two requests.
- M6 — W4: added spaces, `#`, `?`, `%`, slash/traversal, and exactly-once encoding tests while retaining server confinement tests.
- M7 — §7: consistent `kb-dashboard` account, named two-terminal workflow, validated cleanup, and full 21×4 recording matrix.
- Minor E — W5.5: specified `appTokens.test.ts` and `entityDetail.test.ts` as `readFileSync` CSS-source parsers.

§11 Daniel-gate row, verbatim:

```markdown
| `docs/specs/2026-08-20-dashboard-v3-design.md` §5 Inbox | `needs spec amendment — Daniel gate`: *"§5 Inbox empty state: in P1 the empty state is `Nothing needs you`; the trailing next-scheduled-fire line is added in P2 with the Schedules store (no second clock in P1)."* W1 pins `id` to lowercase-hex `sha256(UTF8("escalation\0" + card.meta.id))`, but `CardProjection` exposes neither a canonical source-event timestamp nor revision; Daniel must also amend §5 to name P1 `createdAt`/`revision` sources or permit their omission. If Daniel rejects the empty-state amendment, P1 must pull forward P2's `GET /api/schedules` `ControlPlaneStore` collection reader and project the earliest armed row's `nextAt`; it must not add a second clock. |
```

All findings were applied. `git diff --check` passes, sections 1–11 remain intact, and this is the only modified file. No npm commands or commit were run. The managed worktree is detached at `f43f2950`, the current `claude/dashboard-v3` tip.
