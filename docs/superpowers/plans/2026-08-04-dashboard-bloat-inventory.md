# Dashboard bloat inventory — Phase 7 evidence record (2026-08-05)

Read-only scout (sonnet, boss-verified via transcript grep). Import-closure traced from
`src/main.tsx`, `server/index.ts`, `server/pm2Entry.ts`, vitest roots, `pm2.config.cjs`,
`package.json` scripts. Deletions execute ONLY through Phase 7's adversarial verify + gate.

## 1. Dead files (high confidence)

| Path | Evidence | LOC |
|---|---|---|
| `src/lib/ptyAssertionClient.ts` (+test) | zero importers; Terminal.tsx:18 documents the Factor-C ceremony as removed | 130 (+133) |
| `server/pty/{hostMain,hostPipeServer,hostClient,crossUserAuth,ptyChallenge,ptyAssertionVerify,rendezvousToken,pipeSddl,fleetIdentity,win32PtyApi,ptyProtocol,hostPtySession,peerConfig}.ts` (+13 test files) | retired cross-user Factor-C host cluster; live PTY route imports only host.ts+persistentSessions.ts; surface.ts comment: "retired… future hardening milestone, not an active control"; hostMain's referenced scripts/register_pty_host.md doesn't exist | 2,626 (+2,043) |
| `src/views/Vibe.tsx` (+test) | zero importers; no 'vibe' DestinationId; header: "No route is wired by this file". Server registerVibeRoutes still mounted with no live caller — include in cut | 190 (+172) |
| `src/views/Editor.tsx` (+test) | only importer is dead Vibe.tsx | 140 (+66) |
| `src/views/Control.tsx` dead portion: `Control()`, `FleetStrip`, `OrgStates`, `agentCount`, `EMPTY_INDEX` (lines 1-131, 244-298) | only importer is own test; no 'control' DestinationId; App.test.tsx:165 asserts the view is never rendered. Keep `StopControls` (132-243, live via App.tsx:46) | ~170 (+~172 of test) |
| `src/views/Registry.tsx` | sole importer is dead Control.tsx:17; no test exists | 108 |
| `src/views/CodeView.tsx` | zero importers. NOTE: `.code-view*` CSS classes stay — App.tsx's live ComingSoon reuses them | 17 |
| `server/control/__fixtures__/repl-frames/*` + `.gitattributes` | zero references | 120 |

High-confidence total: ~3,501 source + ~2,586 tests = **~6,087 LOC**.

## 2. Unused exports (medium confidence)

- `src/lib/approvalsClient.ts` `fetchPending()`/`PendingApproval` — no browser caller (ApprovalsLive uses /api/human-inbox). Related dead half: `server/approvals/inbox.ts#listPending` + `GET /api/approvals` handler. Verify end-to-end in P7.
- Gap flagged: no symbol-level pass done on `server/control/store.ts` (76 top-level fns) or `src/control/controlClient.ts` (1,001 lines) — run ts-prune-style pass in P7 before the deletion wave.

## 3. Redundancy verdicts

- Registry-vs-Agents, Vibe-vs-Composer, folderView/Browser/CodeView: no live redundancy — the losers are simply dead (§1). folderView is legitimately shared (Browser + Projects).
- `approvals/inbox.ts` vs `humanInbox.ts`: both live, different jobs (verify-drive vs inbox projection); only listPending half dead.
- `Approvals.tsx` vs `ApprovalsLive.tsx`: legitimate container/presentational split — keep.

## 4. Orphaned-by-Phase-3 (delete WITH phase 3, not before)

| Path | Sole consumers | LOC |
|---|---|---|
| `src/control/RetentionPanel.tsx` (+test) | ManagedRuns — spec §3 says it must earn its place; it doesn't | 191 |
| `src/control/runEvents.ts` | RunCockpit, RunGrid | 131 |
| `src/control/runEventWindow.ts` | ManagedRuns, RunCockpit, RunCanvas | 80 |
| `src/styles/views/pipeline.css` | Pipeline.tsx | 247 |
| `src/styles/views/runCanvas.css` | RunCanvas.tsx | 58 |
| `src/control/control.css` cockpit/run-*/retention selector families (~450 of 771) | SURGICAL SPLIT — `.control-proposal*`/`.control-diff*`/`.control-request*` families live via ProposalCard/ProposalDiff/HumanRequestsPanel; titleClamp.test.ts asserts `.run-card__title` (update test) | ~450 |
| `reactflow` dependency | becomes zero-import once Pipeline dies IF RunDetail's scoped DAG doesn't reuse it (it will — keep unless P3 decides otherwise) | — |

## 5. Oversized-file characterization (no redesign this arc)

- `server/control/store.ts` 5,209 lines: proposal CRUD, run/stage/attempt/session lifecycle, review-loop bookkeeping, human requests, broker backend, retention/quarantine, PLUS two permanently-embedded one-off incident datasets (`AUTHORIZED_20260731_*` @1260, `AUTHORIZED_20260801_*` @1462-1601) — first extraction candidate if ever split.
- `src/control/controlClient.ts` 1,001 lines mirrors the same spread client-side.
- Others >800: execution.ts 2,019 · routes.ts 1,582 · proposal.ts 1,096 · paidActionService.ts 921 · adapters.ts 916 · canonicalResultIntegrator.ts 895 · workflows/defs.ts 841 · authorizedFailedRunReconciliation.ts 836 · queueBridge.ts 826 · claudeWorkerAdapter.ts 822 · workflows/routes.ts 810 · Composer.tsx 875 · App.tsx 863.

## 6. Stale docs

- `docs/design-brief.md` §D/§E: describes Operate/Build/Knowledge/System IA, Board landing, Editor/Vibe/Registry rows — all superseded (nav/config.ts says so itself). Rewrite or delete the sections in P7.
- T6 TUI-roster terms (rosterSessions/boot sentinels/codexDirectoryTrust): zero hits — already clean.

## 7. Dependencies

- No zero-import deps today. `koffi`/`node-pty` used via lazy require in LIVE files (note: win32PtyApi.ts is dead but noReparseFiles.ts/host.ts are the live koffi/node-pty users). `scripts/write-trace.ts` is a documented manual CLI — keep.

## Sequencing into Phase 7

1. After P3 lands: delete §4 bundle with it (P3's own acceptance already names the five views).
2. P7 wave 1: §1 cut list → adversarial verify (opus refuters) → Daniel gate → delete.
3. P7 wave 2: ts-prune-style symbol pass on store.ts/controlClient.ts + §2 verification.
4. P7 wave 3: docs rewrite (design-brief §D/§E), control.css surgical split if not done in P3.
