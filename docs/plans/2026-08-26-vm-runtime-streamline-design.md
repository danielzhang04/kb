# VM-runtime streamline — design spec (2026-08-26)

## 1. Goal + success condition

Make the kb **VM-deployed runtime** codebase as streamlined as possible **without changing any
behavior**. Cut extraneous code (never function), condense, merge duplicates, delete dead code,
right-home misplaced code, and give the infra a coherent shape to keep building on.

**Success condition (all must hold at close):**
- Every existing test stays green — the full server vitest suite (~4,800 tests, `bad-alone:0` on
  both platforms), the python pytest suite, browser matrices, and the P4/P5/P6 attack gates.
- `npm run typecheck` = 0 and `npm run build` clean.
- **No external interface changes**: no route shape, no envelope, no exported-symbol *contract* a
  consumer depends on, no wire behavior changes. Internal moves are re-export-preserved.
- Runs on branch `claude/dashboard-v3` (before the P7 merge), as a series of independently-gated
  commits.

**Scope:** the VM-deployed runtime — `dashboard/server/**`, `dashboard/src/**`, `broker/**`,
`deploy/*.py` + `deploy/systemd/**`, and the release/provisioning scripts. Evidence base: a 9-agent
read-only analysis of ~90K lines (5 opus / 4 sonnet), 2026-08-26.

## 2. Non-goals (explicitly out of this pass)

Three findings are **production-wiring decisions, folded into P7**, not streamlining:
1. **W0-contracts vs W6.1-routes gap** — `api/v1/contracts.ts` has rigorous precondition/ETag
   helpers the fast-built `api/v1/routes.ts` never wired to (routes hand-roll parallel
   `leaseEtag`/`evaluateHostPrecondition`; part of contracts.ts has zero runtime callers).
   Wire-in-vs-prune is a P7 call, tied to #3.
2. **Legacy `control/routes.ts`** — the `/api/control/*` surface P6 W2 never migrated onto the new
   `services/`; coexists with `/api/v1`. Relocation only, and only if still consumed — P7.
3. **Placement-lease stack unwired** — `claimLease`/`renewLease`/`leaseStore` exist only in
   fixtures; live routes return 503 (found independently by 3 agents). This IS the P7
   store→async-port adapter item. **Not dead — built-ahead. Do not touch here.**

Also out: no behavior-touching refactors (the `makeStore` closure, the 8 reconciliation ports, the
21-collection accessor generalization), no renames-for-legibility that churn imports without value
(`planeA`/`planeB` → snapshot/transcript), no test-strengthening.

## 3. Root-cause finding

The single structural cause of most horizontal duplication: **there is no shared-primitives home.**
Small pure utilities were reinvented per module:
- `exactKeys` — **13 near-identical reimpls** (8 server, 5 client).
- inline `createHash('sha256')…digest('hex')` — **28 non-test sites**, despite a canonical
  `sha256Hex` at `write/durableManifest.ts:75` (already imported by 15 files).
- `record`/`asRecord`/`isPlainRecord`, `isoUtc`, header-first-value (6×), `isLoopbackAddress` +
  peer-uid resolution (2×), byte-identical private helpers duplicated store↔migrations.

`write/durableManifest.ts` is also a de-facto shared-primitives grab-bag: its generic exports
(`ContractDecodeError`, `sha256Hex`, `isCommitSha`, `isDigestSha256`) are imported by api/v1, auth,
deploy, inbox, health, learnings, placement, reconciliation, schedules — none a "write" concern.

Fixing this one gap (a `shared/` dir everything references) collapses the largest findings.

## 4. The work — ordered slices

Each slice is behavior-identical, its own commit, gated before the next. Order is dependency-driven:
the shared home lands first (everything references it); dead-code removal lands last (most
confirmation).

### Slice A — shared-primitives home (the root-cause fix)
- Create `dashboard/server/shared/` with the canonical pure primitives: `exactKeys`, `record`/
  `asRecord`/`isPlainRecord`, `sha256Hex`, `isoUtc`, `ContractDecodeError`, `isCommitSha`,
  `isDigestSha256`, header-first-value, peer-uid resolution (`resolvePeerUid`), `isLoopbackAddress`.
  Move the 4 generic symbols OUT of `write/durableManifest.ts` into `shared/` and **re-export from
  durableManifest** so its 15 importers are untouched.
- Create `dashboard/src/lib/decodeGuards.ts` + `src/lib/http.ts` (`record`, `exactKeys`, `getJson`)
  — client bundle is separate, so it gets its own canonical copies.
- Repoint the 13 `exactKeys`, 28 inline sha256, and the per-module `record`/`isoUtc`/header/peer-uid
  reimpls at the shared modules. Delete the local copies.
- Per-module `ContractDecodeError` *label args* stay exactly as they are (only the class moves).

### Slice B — split `store.ts` (7,474 → ~6,000)
- Extract `control/authorizedIncidentRecovery.ts` (~595L of module-level `AUTHORIZED_2026*` incident
  consts + `exactAuthorized*`/`classifyAuthorized*`/`validateAuthorized*Durability`/`*Fingerprint`),
  **barrel re-export from store.ts** (store.test.ts references these 39× — zero test edits).
- Extract `control/storeTypes.ts` (~880L of exported DTOs/interfaces), re-export from store.ts.
- **Do NOT split the `makeStore` closure** (3110-7214) — it is deliberate capture-based
  encapsulation; splitting risks behavior.

### Slice C — local byte-identical dedup
- store↔migrations byte-identical private helpers (`clone`/`canonicalJson`/`sha256`/`isPlainRecord`/
  `iterationDefinitionHash`/`iterationRequestBody`/`iterationRequestFingerprint`) → one internal
  module (or `shared/`).
- record-shape validators dup'd in assetPullState/deploymentState → `shared/recordShape` (or
  Slice-A `shared/`).
- `migrations.ts` edge-map encoded 3× → one `EDGES` table (keep the assert-after-each-edge exactly;
  `breaking` from `breakingFlagForUpEdge` up / `true` down).
- `reconciliation/realPorts.ts` byte-identical lazy-receipt-port (317-324 ≡ 395-402) → one
  `lazyReceiptPort(store)`.
- `sendServiceReply` dup'd 4× (agents/workflows/schedules/api-v1 routes) → one `http/` reply helper.
- `write/branch.ts` `splitZ` NUL idiom (8×) → one helper; unify inline `HEX40` regex with imported
  `isCommitSha`.
- `deploy/validate_vm_runtime.py` duplicate frozen-table entry (`WHOIS_SERVICE_SECTIONS` ≡
  `WHOIS_SERVICE_DIRECTIVES` — "nine tables" is really 8) + its redundant parametrized test case;
  fold `validate_broker_service`/`_socket` onto the existing `_forbidden_and_privilege` helper
  (verify no fixture trips two violations — error-order sensitive).

### Slice D — testFixtures dedup (test-only; lower priority but real)
- `gateResultsCore.ts`: extract the shared Vitest-JSON types + `toDashboardRelative` + the three
  `collect*Violations` generics from the 4 phase asserters (~350-450L). Each phase file keeps only
  its attack-id list + CLI/mode logic (**do NOT unify the CLIs** — P6's dual-mode differs genuinely).
- `staticHttpServer.ts`: extract byte-identical `safeStaticFile` + `CONTENT_TYPES` (+ listen/close/
  TLS boilerplate) shared by `p1BrowserFixture` and `p5FixtureServer`.
- `LifecycleChild`/`LifecycleSpawn` type dup'd 3× → one `lifecycleTypes.ts`.
- (`p3ActualBrowserRunner` CDP core + `stagingGit` are already correctly shared — leave.)

### Slice E — structural (move + re-export; navigability)
- Sub-folder `control/` (68 flat files) into `control/{run,paidAction,attempt,migration,adapters}`,
  **re-exported from an index** so no importer changes. Biggest "where does new code go" win.
- Relocate `routes.ts` run-activation orchestration (`activateRunUnderOwner` +
  `resumeRunAfterBoundaryAccepted`, ~385L, module-private) into `control/launch.ts` (or a
  `run/activation` module) — relocation only, exports off `routes.ts` unchanged.
- Fix inverted layering: `services/inboxService.ts` imports `decodeP5InboxRefreshParam` *up* from
  `inbox/routes.ts` — move the decoder down into the service (or `shared/`).
- Right-home `panels/autonomyLadder.ts` (its only consumer is `planeA/`), `getJson` (→ `src/lib`),
  add a "generated — do not edit" provenance header to `control/generated/controlPlaneSchema.ts`.

### Slice F — dead-code removal (git-log-verified, LAST)
Each item: **`git log -p`/blame confirm it is orphaned, not staged-ahead for an unmerged branch**,
before deletion. Where a dead file carries its own orphaned test, deleting removes that test too —
call each out explicitly at execution.
- `connectors/catalog.ts` (104L), `tasks/cardProjection.ts` (211L), `timeline/stream.ts` (90L) —
  each with only its own test importing it.
- `src/` dead components: `AttemptMiniTail.tsx`, `RecurrencePicker.tsx`(+css), `lib/useReadPanel.ts`,
  `schedules/ScheduleRows.tsx`, `control/ProposalDiff.tsx` (component only — `ProposalDiffDto` stays).
- pty dead aliases: `windowsSessionHost.ts:694`, `probe.ts:216`.
- Drop the needless `export` keyword on internal-only symbols (`authorizedLegacyRecoveryExecution`,
  `strandedIntegrationTitle`, `COORDINATION_GIT_GUARD_REASON`) — leave test-only exports alone.

## 5. Do-NOT-touch register (agents flagged these as intentional; cutting = behavior/security change)
- `makeStore` closure; the 8 reconciliation ports (non-uniform TOCTOU/CAS — no factory); the 21
  collection accessors.
- Trust-boundary duplication: `kb_node_proxy.py` ↔ `kb_whois_shim.py` (`_connect_unix`, NODE_ID
  regex) — separate audit surfaces across a privilege boundary; the 4 systemd `UnsetEnvironment`
  blocks — a shared drop-in/EnvironmentFile is forbidden by the sandbox's own contract.
- `control_plane_schema.py` — already generator-sourced (single source, two emits); never hand-edit.
- pty `sessionPersistence`/`sessionRecord`/`sessionRuns` — three deliberate array-owners of one doc.
- Load-bearing "why" doctrine headers; purpose-bound T3 preimages (human-response vs deploy).
- The placement-lease stack, and the 4 unwired live-fact VM validators — **P7, not dead.**

## 6. Verification protocol
- Per slice: ANSI-stripped `tsc` = 0, then the focused suites for the touched files
  (`--maxWorkers=1` to avoid the known singleton load-flakes), commit, move on.
- Dead-code slice (F): before each delete, `git log --oneline -- <path>` + `rg` the symbol
  repo-wide; a symbol referenced only by its own test with no unmerged-branch origin = safe.
- End of pass: full both-platform gate (Windows dv3-gate + WSL `~/kb-v3`), `bad-alone:0`, + pytest,
  + the P6 closure gate (§7 focused 1406, 21 attacks, two-daemon 6/6, browser) to prove
  behavior-identical against the P6-CLOSE-CLEAN baseline. + a whole-diff adversarial review.
- Norms every slice: LF, no raw NUL bytes (escape to `\u0000`), no TS constructor parameter-properties (the P3
  strip-only floor), read-only analysis agents never delete/mutate.

## 7. Estimated impact
~1,500+ lines net cleaner (dedup + dead-code) + the largest file dropping 7,474 → ~6,000 + a
coherent `shared/` home and a sub-foldered `control/`. All behavior-identical. The pass also produced
the P7 map: the placement-lease adapter (#3 non-goal) is the concrete thing to wire, and the
W0-contract gap (#1) rides with it.
