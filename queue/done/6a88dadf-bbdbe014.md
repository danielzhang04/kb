---
schema-version: 1
id: 6a88dadf-bbdbe014
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: f5dcfd8d94199564
state: done
approval: null
workflow: 01a02694-94e6-77d2-9870-73c9fed70567
depends-on: []
variant-group: null
role: work
session-id: 6a88da3e-846e23ad
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 585be2b99920989059467342f540c2d088953ff9
---

## Work order

\# Task — W1c: align runProjection.ts with the W3-extended contracts (streamKind, pairs)

Repo `C:/Users/danie/kb`, branch `claude/dashboard-v3`. Do not commit. Rules:
`C:/Users/danie/AppData/Local/Temp/claude/C--Users-danie-kb/833beb04-ca1f-4739-9250-95c23e464b7d/scratchpad/dv3-p2-builder-common.md`.

`npm run typecheck` (from `dashboard`) currently fails at:
- `server/control/runProjection.ts:56` — `RunRow` now requires `streamKind: 'pty' | 'transcript'` and
  optional `sessionId` (`server/control/p2Contracts.ts:24-33`; spec §5 Run view: PTY-backed runs carry
  `streamKind:"pty"` + `sessionId`, transcript runs `streamKind:"transcript"`).
- `server/control/runProjection.ts:96` — `AttentionEnvelope` field is `pairs`, not `items`
  (`p2Contracts.ts:60-65`).

Fix in `runProjection.ts` + `runProjection.test.ts` only (read both, and `server/control/
runEventService.ts` to see how W3 derives stream kind from a run's sources so both agree):
1. Derive `streamKind`/`sessionId` in the projector from the run input: a run with an attached PTY
   session (use the same field W3's `runEventService` reads; if the projector's input type lacks it,
   add the minimal optional field to the projector's own input type — NOT to `Run` in `types.ts`) →
   `'pty'` + `sessionId`; otherwise `'transcript'` with no `sessionId`. Test both branches.
2. Rename `items` → `pairs` where the projector builds the attention envelope; if `runProjection`
   duplicates logic now owned by `server/control/attention.ts` (`projectRunAttention`), delete the
   duplicate and call/compose the W3 function instead — one owner.
3. Any other `RunRow` literal in tests you own gets `streamKind`.

Checkpoint from `dashboard`: `npm run typecheck` (zero errors), then
`npx vitest run server/control/runProjection.test.ts server/control/attention.test.ts server/entities server/home --maxWorkers=2`.
Final message ≤ 10 lines: files, what was de-duplicated, numbers.

## Result

Modified [runProjection.ts](C:\Users\danie\kb\dashboard\server\control\runProjection.ts) and [runProjection.test.ts](C:\Users\danie\kb\dashboard\server\control\runProjection.test.ts).

- Added optional W3 `source` input; PTY projects `streamKind: "pty"` plus `sessionId`, otherwise transcript.
- Replaced duplicate gate reduction with `projectRunAttention`; envelope now uses `pairs`.
- Added PTY/transcript coverage; updated gate assertions.
- `npm run typecheck`: passed (0 errors).
- Focused Vitest command: passed — 9 files, 30 tests.
- No commit created.
