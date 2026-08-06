# Dashboard deletion manifest — Phase 7 execution order (2026-08-05)

Adversarially verified against the CURRENT tree at `claude/dashboard-ux-overhaul` (HEAD `3365415`),
AFTER phases 3-6 landed. This supersedes `2026-08-04-dashboard-bloat-inventory.md` wherever the two
disagree — that inventory was written before P3-P6 and is wrong in four places (noted inline).

All paths are repo-relative from the worktree root
(`C:\Users\danie\kb-worktrees\boss-dashboard-ux`). Every path below was confirmed to exist.

**Read this first — order matters.** Do section 1 (DELETE), then section 2 (SPLIT), then section 3
is a do-not-touch list, then section 4 (FIXES). Sections 1 and 2 are interdependent: several files in
section 1 are only safe to delete because a section-2 edit removes their last importer. If you stop
halfway, the tree does not compile.

**Baseline warning.** `npx tsc --noEmit` is ALREADY RED on this tree: 7 pre-existing errors, all in
`dashboard/server/control/paidAction*` (4× TS7016 missing `pngjs` types, 2× TS6133 unused symbol,
1× TS7006 implicit any). Do NOT treat a green typecheck as your gate — capture the error list before
you start and require it to be byte-identical after. `npx vitest run` from `dashboard/` is the real gate.

---

## 1. DELETE — remove these files outright

### 1a. Source files

```
dashboard/src/lib/ptyAssertionClient.ts
dashboard/src/views/Vibe.tsx
dashboard/src/views/Editor.tsx
dashboard/src/views/Registry.tsx
dashboard/src/views/CodeView.tsx
dashboard/src/views/launchControls.tsx
dashboard/src/lib/assignableOwners.ts
dashboard/server/vibe/routes.ts
dashboard/server/auth/nonce.ts
```

### 1b. Source files — the retired Factor-C PTY host cluster (13)

Do NOT touch `host.ts`, `persistentSessions.ts`, or `route.ts` in this directory. Those three are the
LIVE PTY stack and were modified by P5 (the roster-allowlist `PtyCommand` spawn path).

```
dashboard/server/pty/crossUserAuth.ts
dashboard/server/pty/fleetIdentity.ts
dashboard/server/pty/hostClient.ts
dashboard/server/pty/hostMain.ts
dashboard/server/pty/hostPipeServer.ts
dashboard/server/pty/hostPtySession.ts
dashboard/server/pty/peerConfig.ts
dashboard/server/pty/pipeSddl.ts
dashboard/server/pty/ptyAssertionVerify.ts
dashboard/server/pty/ptyChallenge.ts
dashboard/server/pty/ptyProtocol.ts
dashboard/server/pty/rendezvousToken.ts
dashboard/server/pty/win32PtyApi.ts
```

### 1c. Test files

```
dashboard/src/lib/ptyAssertionClient.test.ts
dashboard/src/views/Vibe.test.tsx
dashboard/src/views/Editor.test.tsx
dashboard/src/views/launchControls.test.tsx
dashboard/server/auth/nonce.test.ts
```

`Registry.tsx` and `CodeView.tsx` have no test files — do not go looking for them.
`assignableOwners.ts` has no test file either.

### 1d. Test files — the PTY cluster (14, not 13)

**Correction to the inventory:** it said "13 test files". There are **14**. The set is not a 1:1
pairing with the 13 sources — `fleetIdentity.ts` has no test, while `hostConnection.test.ts`,
`registerPtyHost.rehearsal.test.ts`, and `win32PtyApi.integration.test.ts` are cluster-only tests with
no same-named source. Delete all 14.

```
dashboard/server/pty/crossUserAuth.test.ts
dashboard/server/pty/hostClient.test.ts
dashboard/server/pty/hostConnection.test.ts
dashboard/server/pty/hostMain.test.ts
dashboard/server/pty/hostPipeServer.test.ts
dashboard/server/pty/hostPtySession.test.ts
dashboard/server/pty/peerConfig.test.ts
dashboard/server/pty/pipeSddl.test.ts
dashboard/server/pty/ptyAssertionVerify.test.ts
dashboard/server/pty/ptyChallenge.test.ts
dashboard/server/pty/ptyProtocol.test.ts
dashboard/server/pty/registerPtyHost.rehearsal.test.ts
dashboard/server/pty/rendezvousToken.test.ts
dashboard/server/pty/win32PtyApi.integration.test.ts
```

Cluster total: 13 source + 14 test = **27 files**.

Do NOT delete `host.test.ts`, `persistentSessions.test.ts`, or `route.test.ts`.

### 1e. Fixtures

Delete the whole directory:

```
dashboard/server/control/__fixtures__/repl-frames/
```

which contains `bypass-accept-modal.txt`, `idle-repl-prompt.txt`, `theme-picker.txt`, and its own
directory-local `.gitattributes`.

**Correction to the inventory:** it listed "`repl-frames/*` + `.gitattributes`" as if a line had to be
removed from a parent `.gitattributes`. It does not. The `.gitattributes` is a 2-line file INSIDE the
fixture directory and dies with it. The repo-root `/.gitattributes` contains **no** repl-frames entry
— verified — so **make no edit to the root `.gitattributes`**.

Provenance, so you know what you are throwing away: added by commit `9369674` for
`server/control/rosterSessions.ts`, which no longer exists. These are real bytes captured off
`claude.exe 2.1.220`; if a REPL-readiness detector is ever rebuilt they must be recaptured, not
reconstructed.

### 1f. Repo-root PTY-host scripts

These are the human-gate collateral for `hostMain.ts`. `Get-ScheduledTask` on this machine confirms
**no PTY-host scheduled task was ever registered** (only `kb-codex-runner` and `kb-desktop-dispatcher`
exist, both Disabled), so nothing on this box runs them.

```
scripts/pty_host_launch.cmd
scripts/register_pty_host.md
scripts/pty_host_assertion_verify.py
```

**Correction to the inventory:** it claimed "hostMain's referenced `scripts/register_pty_host.md`
doesn't exist". It does exist, at the REPO ROOT `scripts/` directory (the scout appears to have
checked `dashboard/scripts/`, which holds only `write-trace.ts`).

`scripts/pty_host_launch.cmd` is read at test time by `registerPtyHost.rehearsal.test.ts:15`, which
is in the 1d delete list — so this only becomes safe once 1d is done.

---

## 2. SPLIT — surgical edits to files that SURVIVE

Line numbers are for the CURRENT tree. Apply the edits in each file from the BOTTOM UP so earlier
cuts do not shift later line numbers.

### 2.1 `dashboard/src/views/Control.tsx` (314 lines)

Keeps `StopControls` only. `App.tsx` no longer imports anything from this file; the live consumer is
`dashboard/src/views/panels/Sentinel.tsx:15` (`import { StopControls } from '../Control';`), which
needs **no change**.

CUT, bottom-up:

| Range | What |
|---|---|
| `260-314` | blank + the `/** Control landing… */` doc + `export function Control()` |
| `24-118` | blank + `EMPTY_INDEX` (25-34) + `agentCount` doc/fn (36-45) + `FleetStrip` (47-88) + `OrgStates` (90-118) |
| `15-21` | the 7 imports used only by the dead half: `PlaneAIndex`(15), `Browser`(16), `Registry`(17), `Timeline`(18), `LaunchControls`(19), `useSse`(20), `useAssignableOwners`(21) |

KEEP: `1-12` (file header — **rewrite it**, it describes a Control landing view that no longer
exists), `13-14` (`useEffect, useState` / `FormEvent`), `22-23` (`invalidateSessionOnGovernedAuthFailure`,
`useSession` — both used by `StopControls`), `119-259` (`StopControls` doc comment at 120-135 plus the
component at 136-259).

Removed exports: `Control`, `FleetStrip`, `OrgStates`, `agentCount`, `EMPTY_INDEX`.
Surviving export: `StopControls` only. Net −157 lines.

Optional follow-on, NOT required for correctness: the file is now named `Control.tsx` but exports no
`Control`. Renaming it `dashboard/src/views/stopControls.tsx` matches the existing
`launchControls`/`routingControls` lowercase-helper convention and would need a one-line update at
`Sentinel.tsx:15`. Leave this to the boss — do not do it unasked.

### 2.2 `dashboard/src/views/Control.test.tsx` (301 lines)

CUT, bottom-up:

| Range | What | Why |
|---|---|---|
| `264-300` | the two `LaunchControls` tests inside `describe('point-of-action session mint')` | `launchControls.tsx` is deleted in 1a |
| `115-177` | `describe('Control view — D2.6 launch/rerun controls')` | tests `LaunchControls` through the dead `Control` |
| `73-114` | `describe('Control view')` | tests `FleetStrip` + the App-level landing toggle |
| `23-61` | the `card()` helper (23-38) and the `SNAPSHOT` fixture (40-61) | consumed only by the cut describes |
| `10-13` | `LaunchControls` import(10), `App` import(11), `PlaneAIndex` type(12), `CardProjection` type(13) | all four are now unreferenced |

EDIT line `9` from `import { Control, StopControls } from './Control';` to
`import { StopControls } from './Control';`.

KEEP: `1-8` (header — **rewrite it**, it describes the Control landing view), `14-15`, `17-22`
(`withSession` helper — used by the surviving tests), `63-72` (`beforeEach`/`afterEach` — keep, but
update the comment: it names `Browser/Registry/Timeline`, all now gone), `178-234`
(`describe('Emergency-stop controls (D2.8; mounted on Sentinel since spec §6)')` — 3 tests),
`235-263` (`describe('point-of-action session mint')` opener + the StopControls mint test), `301`
(the closing `});`).

**If the boss reprieves `launchControls.tsx`:** lines `264-300` MOVE into
`dashboard/src/views/launchControls.test.tsx` instead of dying, and 1a/1c drop the three
launchControls/assignableOwners entries. Everything else in this file is unaffected.

### 2.3 `dashboard/src/lib/approvalsClient.ts` — client half only

This file is very much ALIVE (`fetchHumanInbox` is imported by `App.tsx:74`, `ApprovalsLive.tsx:21`,
and `Tasks.tsx:39`). Cut only the dead pair.

CUT lines `21-34`: the `/** One row of the GET /api/approvals payload. */` comment (21), the
`PendingApproval` interface (22-25), blank (26), the `fetchPending` doc comment (27-28), and
`export async function fetchPending` (29-34).

Also update the module header at lines `2-3` — it opens "`fetchPending` reads the live
`GET /api/approvals` corroboration feed" and must stop naming a function that no longer exists.

Leave `ApprovalChannel`/`FetchLike` (18-19) and everything from `fetchHumanInbox` (36) down untouched.
The `ApprovalButtons` type import at line 14 becomes unused once `PendingApproval` goes — remove that
import specifier too, and check whether `ParsedCard` (line 13) is still referenced elsewhere in the
file before removing it (it is used by `respondToCard`'s types — verify before cutting).

### 2.4 `dashboard/src/lib/approvalsClient.test.ts`

CUT lines `19-32`: the entire `describe('fetchPending')` block (19-31) plus the trailing blank (32).
EDIT line `5` to drop `fetchPending` from
`import { fetchHumanInbox, fetchPending, respondToCard, verifyApproval } from './approvalsClient';`.

### 2.5 `dashboard/server/http/surface.ts` — unmount `registerVibeRoutes`

CUT line `27`: `import { registerVibeRoutes } from '../vibe/routes.ts';`
CUT line `229`: `registerVibeRoutes(scope, ctx);`

That is the whole unmount. This is a net SECURITY WIN: `POST /api/vibe` is an RCE-equivalent live
prompt route with zero browser callers once `Vibe.tsx` is deleted.

**Do NOT touch `dashboard/server/vibe/session.ts`.** Only `routes.ts` dies. `session.ts` is live:
`spawnVibe`/`defaultVibeSpawner` via `server/composer/session.ts:34-35`, and `drainVibeProcesses` via
`server/http/surface.ts:33`+`:217` and `server/shutdown.ts:15`. Likewise leave `ctx.vibeRateGuard`
alone (`server/composer/routes.ts:320` uses it) and `ctx.spawn`.

### 2.6 `dashboard/server/http/surface.test.ts` (960 lines)

CUT, bottom-up:

| Range | What |
|---|---|
| `896-960` | `describe('vibe surface — gate wiring')` — runs to EOF, all 3 tests |
| `127` | the `'/api/vibe',` entry in the routes-exist list inside `describe('write surface — composition chain')` |

Leave line `140` alone — that `GET /api/approvals` inject stays (see section 3).

### 2.7 `dashboard/server/embeddedPython.test.ts`

This is a LIVE cross-cutting test that ast-parses every embedded Python constant. It imports one
symbol from the dying cluster.

CUT line `25`: `import { PTY_VERIFY_SCRIPT } from './pty/ptyAssertionVerify.ts';`
CUT line `45`: the `PTY_VERIFY_SCRIPT,` entry in the `SCRIPTS` map.

Change nothing else — the other 15 constants in that map are live.

### 2.8 `dashboard/src/control/control.css` — dead selector families

Both families were orphaned by deleted cockpit/inbox panels. Verified zero matches across all
non-test `.tsx`, including template-literal construction.

CUT lines `47-69`:
- `.control-panel__head { … }` (47-52)
- `.control-panel__head h2, .control-panel__head h3, .control-inbox-requests h3 { … }` (54-57)
- `.control-panel__head p { … }` (60-64)
- `.control-inbox-requests { … }` (66-69)

**Careful — do not over-cut this file.** Many selectors that LOOK unused in a literal grep are built
by template literal in `RunDetail.tsx`/`ProposalCard.tsx`, e.g.
`` className={`control-state control-state--${approval?.decision ?? 'review'}`} ``. That covers
`.control-state--approved/--rejected/--changes-requested`,
`.run-activity__checkpoint--blocked/--failed/--reached/--released`, `.run-activity__row--tool`, and
`.run-stream-tile--blocked`. All of those STAY. Only the two families named above go.

---

## 3. KEEP — do not delete these, and strike them from any older cut list

| Path / symbol | Reason |
|---|---|
| `dashboard/server/auth/challenge.ts` | **Cross-language conformance mirror, not dead code.** `challenge.test.ts:108` asserts its `content_hash` is byte-identical to the Python verifier; `scripts/approvals.py:106` is the authority. Zero runtime importers is the EXPECTED shape — the test is the drift detector. Its `workOrderOf` is a re-export of the live `server/auth/workOrder.ts` (lines 74/77), not a duplicate implementation. |
| `dashboard/server/connectors/catalog.ts` | Self-declared staged scaffold: its header says "NOT WIRED… increments 2-3 of the staged plan" per `docs/specs/2026-07-20-external-reach-design.md §5`. Its `GATE_G1..G4` ids are the real queue-card ids listed at line 29 of that spec. |
| `dashboard/src/control/runEvents.ts` | 5 live importers: `AgentDetail.tsx:26`, `Agents.tsx:46`, `RunDetail.tsx:80`, `WorkflowDetail.tsx:19`, `Workflows.tsx:25`. The inventory's "delete-with-P3" is superseded — P3 kept it. |
| `dashboard/src/control/runEventWindow.ts` | Live via `RunDetail.tsx:81` (`loadRunEventWindow`, `RunEventWindow`). Same superseded note. |
| `reactflow` in `dashboard/package.json` | Two live importers: `RunDetail.tsx:32-33` (component + `reactflow/dist/style.css`) and `WorkflowAgentGraph.tsx`. Keep the dependency entry. |
| `GET /api/approvals` + `server/approvals/inbox.ts#listPending` | Only the CLIENT half is dead. Server half is named as the read-only corroboration feed in `docs/specs/2026-07-21-atlas-v2a-trust-design.md:77`, documented as a deliberate pre-auth exemption at `server/http/middleware.ts:55`, and used as the unauthenticated probe in the "surface 403-locks on empty origin allowlist" security test (`surface.test.ts:714`). ~30 LOC against three live contracts — bad trade. |
| composer `agentId` (`src/composer/workspaceClient.ts:38`) | Client-unused (`App.tsx:644` is the sole call site and passes only the token), but `server/composer/routes.ts:24-29` validates it and `:133-136` resolves the declaration and persists path + source revision, with `workspaceClient.test.ts:14-19` pinning the wire shape. Cutting 3 interface lines would desync client from a live tested server capability. |
| `dashboard/server/control/synthetic-acceptance.ts` | Standalone CLI harness, inert at import (`import.meta.main` guard); referenced by `docs/runbooks/2026-07-20-wave-a-acceptance-runbook.md`. Zero importers is by design. |
| `dashboard/server/trace/commit.ts`, `dashboard/server/trace/render.ts` | Both imported by `dashboard/scripts/write-trace.ts:14-15`, the documented manual CLI. |
| `dashboard/server/pm2Entry.ts` | PM2 process entry — `dashboard/pm2.config.cjs:29` `script: 'server/pm2Entry.ts'`. Never imported by design. |
| `dashboard/server/types/ws.d.ts` | Ambient declaration file; picked up by the compiler, never imported. |
| `dashboard/server/vibe/session.ts` | Live via composer + shutdown drain — see 2.5. |
| `dashboard/server/pty/{host,persistentSessions,route}.ts` + their 3 tests | The live PTY stack; `route.ts` carries P5's roster-allowlist spawn path. |
| `.code-view` rule at `dashboard/src/styles/app.css:1310` | Still used by the live `ComingSoon` at `App.tsx:300`. Deleting `CodeView.tsx` does NOT free this CSS. |
| `koffi`, `node-pty` in `package.json` | `koffi` survives the cluster via `server/win32/noReparseFiles.ts:167`; `node-pty` via `server/pty/host.ts:64`. |

### 3b. AMBIGUOUS — boss decision, do NOT delete without a ruling

| Path | LOC | The tension |
|---|---|---|
| `dashboard/server/timeline/stream.ts` | 90 (+68 test) | `streamSession` has zero callers and no route registers it; it is the only file in its directory. BUT it is the D0.7 live spectator feed and shares `foldRecords` with static replay, so it reads as awaiting a hub wiring rather than as rot. Deleting it forecloses the live-tail feature; keeping it costs 90 dead lines. Needs a ruling, not a sweep. |

---

## 4. FIXES — not deletions, but they belong to this wave

### 4.1 Stray `naming.json` written into the worktree root

**Symptom:** an untracked `naming.json` appears at the worktree root containing
`{"workflow":{"email-triage":1,"research-brief":2,"self-lint-report":3,"thin-slice-run":4,"video-run":5}}`
— the five real shipped org workflow defs, not fixtures.

**Root cause:** `dashboard/server/workflows/fyt.videoRun.registration.test.ts` sets
`const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));` at line **20** — which
resolves to the worktree root — and then at line **95** passes it as **`stateRoot: REPO_ROOT`**
(line 94 correctly passes it as `repoRoot`; line 95 is the bug). Because that state root is not equal
to `resolveDashboardStateRoot()`, `namingFor` at `server/http/context.ts:165` falls through to
`new NamingRegistry(join(ctx.stateRoot, 'naming.json'))` and writes into the repo. The ordinals are
then minted by `server/workflows/routes.ts:417`.

**Fix (do both):**

1. **Test isolation (the real fix).** Change line 95 to an isolated temp state root, e.g.
   `stateRoot: mkdtempSync(join(tmpdir(), 'fyt-videorun-'))`, and clean it up in `afterEach`. This is
   the documented intent: `server/http/context.ts:138-139` already says a test whose `stateRoot` is a
   temp dir "automatically gets an isolated ordinal file". Leave line 94 (`repoRoot: REPO_ROOT`) alone
   — scanning the real repo is what this acceptance test is for.
2. **`.gitignore` backstop (warranted).** Neither the repo-root `.gitignore` nor `dashboard/.gitignore`
   covers it today. Add a `naming.json` entry. Justification: this is daemon-local state that is
   explicitly never coordination truth (`pm2.config.cjs` puts the production copy under
   `DASHBOARD_STATE_ROOT` = `AppData\Local\kb-dashboard`, deliberately outside every git worktree), so
   a stray copy should never be committable regardless of which test misfires next.

While in there, grep for other `stateRoot: REPO_ROOT` occurrences — this is a copy-paste-shaped
mistake. At time of writing `fyt.videoRun.registration.test.ts:95` is the only one.

### 4.2 `dashboard/docs/design-brief.md` — stale sections for the docs rewrite

Note the path: the brief is at `dashboard/docs/design-brief.md`, not `docs/design-brief.md`.

`src/nav/config.ts:8-11` is self-documenting about its own authority and must be read first. It says
the config supersedes **§D**'s verb-grouping, but that "The brief's sidebar BEHAVIOUR (48px rail,
hover tooltips, expand to ~220px) and every §E/§F visual rule remain authoritative."

**Correction to the inventory:** it said "§D/§E … all superseded". That over-claims. §E is mostly
still live.

| Section | Lines | Verdict |
|---|---|---|
| §D Information Architecture | 67-88 | **Rewrite.** Contradicts current nav on every group: names Operate/Build/Knowledge/System, and the destinations `Board`, `Editor`, `Vibe`, `Pipeline`, `Registry`. Also describes a "Session/Stop floor (pinned bottom)" that P6 relocated to the Sentinel view. The final paragraph (48px rail collapse, command palette) SURVIVES — fold it into the rewrite. |
| §E Per-view layout | 89-114 | **Surgical.** Delete the **Board (Control)**, **Registry**, **Editor**, and **Vibe** bullets — those views are deleted by this manifest. KEEP the **Approvals** bullet (the show-then-prompt ordering law is load-bearing and still live), **Timeline**, **Browser**, **Terminal**. |
| §F Signature details + anti-patterns | 115-125 | **No change.** Still authoritative per `nav/config.ts`. |

Ground truth for the rewrite is `src/nav/config.ts` `NAV_SECTIONS`: three unlabelled divider-separated
groups — `home · approvals(labelled "Inbox") · activity · atlas · terminal` / `workflows · agents ·
tasks · projects · files` / `connectors · ledgers · sentinel`. All 13 are `status: 'live'`.

Do NOT rewrite these sections as part of the deletion wave — this entry exists so a later docs leg has
the exact scope.

---

## 5. Expected LOC delta

| Bucket | Source | Test |
|---|---|---|
| `ptyAssertionClient` pair | 130 | 133 |
| PTY Factor-C cluster (13 src / 14 test) | 2,626 | 2,333 |
| `Vibe.tsx` + `Editor.tsx` + `server/vibe/routes.ts` | 430 | 238 |
| `Control.tsx` dead half (157) + `launchControls.tsx` (267) + `assignableOwners.ts` (77) | 501 | 255 |
| `Registry.tsx` | 108 | 0 |
| `CodeView.tsx` | 17 | 0 |
| `approvalsClient` client half | 14 | 14 |
| `server/auth/nonce.ts` pair | 48 | 23 |
| `control.css` dead selectors (47-69) | 23 | 0 |
| Edits to surviving tests (`surface.test.ts` 66, `embeddedPython.test.ts` 2) | 2 | 66 |
| **TOTAL** | **~3,899** | **~3,062** |

**Grand total ≈ 6,961 LOC**, plus 120 lines of `repl-frames` fixture data and 3 repo-root PTY-host
scripts (not counted as LOC).

For comparison the 2026-08-04 inventory projected ~6,087. The delta is mostly the `launchControls` /
`assignableOwners` cascade (+456) and the miscounted cluster test files, partly offset by the items
moved to KEEP in section 3.

---

## 6. Verification after execution

1. `cd dashboard && npx vitest run` — this is the gate. Expect the deleted suites to be gone and
   ZERO new failures.
2. `cd dashboard && npx tsc --noEmit` — expect EXACTLY the 7 pre-existing `paidAction*` errors,
   byte-identical to the pre-work capture. Any 8th error is yours.
3. `cd dashboard && npx vite build` — must succeed.
4. `git status` — confirm no stray `naming.json` reappears after the test run (that is the 4.1 fix
   working).
5. Spot-check the two relocations survived: `src/views/panels/Sentinel.tsx:15` still imports
   `StopControls`, and `App.tsx:300`'s `ComingSoon` still renders with the `.code-view` class styled.
