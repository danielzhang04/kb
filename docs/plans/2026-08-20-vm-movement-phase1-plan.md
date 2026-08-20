# Desk⇄VM Movement — Phase 1 (State Foundation) Implementation Plan

> **Boss amendment (2026-08-20, in force):** a parser-only edit to
> `deploy/activate_release.py` (structural attestation v2 validation) was ruled INTO
> Task-7 scope during the build. The plan's original "never edits activate_release.py"
> gates (`git diff --exit-code origin/main -- deploy/activate_release.py` and the
> final `$forbidden` diff-guard entry for that path) are superseded for exactly this
> parser change; activation/swap/rollback behavior remains out of Phase-1 scope, and
> the resident-VM v2 probe remains the standing merge-precondition. Value agreement
> for the three registry-derived fields is recomputed post-extraction in Phase 3
> (spec §2.4), not pinned at parse time.
> **For agentic workers:** execute task-by-task; steps use checkbox syntax.

**Goal:** Build only the durable state foundation required by Phase 1: schema-v2 migration, exhaustive run lifecycle, deployment/journal records, one-writer capability, durable critical saves, and shared TypeScript/Python schema validation.

**Architecture:** One versioned control document remains authoritative. A process-lifetime writer lease gates its file store; a pure ordered registry migrates v1→v2 before crash normalization; centralized exhaustive lifecycle/deployment state machines own all transitions; one generated manifest binds TypeScript, bootstrap, backup, and future release metadata.

**Tech Stack:** Node.js 24.18.0, TypeScript 7, Vitest 4, Fastify 5, Koffi 3, Python 3.12, pytest, synchronous atomic JSON persistence on the VM.

**Spec:** `docs/specs/2026-08-20-desk-vm-movement-design.md` §8 Phase 1, with §2.1 and §2.4 as the detailed contract.

## Global Constraints

- Branch from fresh `origin/main`, never local `main`: run `git fetch origin` and `git switch -c codex/vm-movement-phase1 origin/main` before editing.
- The verified `origin/main` is four commits ahead of the cutover snapshot; all anchors in this plan are against `origin/main` (`439fc90d` at authoring), including `makeSurfaceContext()`'s file-store construction at `dashboard/server/http/surface.ts:142`. Re-run the branch proof before trusting an anchor.
- Control-document current schema is `2`; the ordered breaking migration is `v1→v2`, with a present down migration to schema `1`.
- Release attestation schema is exactly `kb.release-attestation/v2`; its exact eight-key set is `archive,schema,sha256,sourceCommit,stateSchema,rollbackStateSchema,stateMigration,workflow`.
- Registry-derived release values are exactly `stateSchema="2"`, `rollbackStateSchema="1"`, and `stateMigration="breaking"`; Phase 1 does not hand-author those values in the builder.
- Phase-0's resident v1/v2 compatibility activator is a merge/deploy prerequisite for v2 metadata; this plan verifies that prerequisite but never edits `deploy/activate_release.py`.
- Phase 1 must NOT be activated on the VM: its v1→v2 migration is a one-way door for pre-Phase-1 code, whose loader rejects `version !== 1` (`dashboard/server/control/store.ts:2192-2198`). The first deployable release is Phase 3 under old quiescence, per spec §2.5 bootstrap step 2.
- The writer lock is exactly `$DASHBOARD_STATE_ROOT/control/dashboard.lock`, acquired nonblocking for process lifetime with `O_CLOEXEC`.
- Linux/VM deploy-critical saves perform temp write → temp-fd fsync → atomic rename → parent-directory fsync; ordinary Linux saves keep atomic rename without the second barrier; non-Linux temp-fsyncs and best-effort directory-fsyncs with no power-loss claim.
- The VM durability gate is a 2× production control document, 100 deploy-critical transitions, p99 save ≤250 ms, and maximum event-loop delay ≤1 s.
- No activation behavior changes in Phase 1: do not change `deploy/activate_release.py`, quiescence, fencing, parking execution, rehydration, `/api/v1`, Inbox, one-click deploy, assets, credentials, or VM floor behavior.
- The existing CI gate must stay green after every task: non-Atlas pytest, dashboard typecheck/build, and the slow builder test (`.github/workflows/kb-platform-release.yml:20-28`). CI explicitly banks full Vitest (`:23-24`), so focused/full Vitest are mandatory local integrator gates, not CI claims.
- Workers never commit. Each commit checkbox is a human-integrator command; an agentic worker stops and reports the green tree at that checkpoint.
- Test commands use `npm` on Linux/WSL/CI; when running the same command from Windows PowerShell, invoke `npm.cmd` with identical arguments.

### Task 1: Pin the migration manifest and generated schema contracts

**Files:** Create `schemas/control-plane-migrations.json`; Create `scripts/generate_control_plane_schema.py`; Create `dashboard/server/control/generated/controlPlaneSchema.ts`; Create `deploy/control_plane_schema.py`; Create `dashboard/server/control/generated/controlPlaneSchema.test.ts`; Create `tests/test_control_plane_schema.py`; Create `tests/fixtures/control-plane/v1-supported.json`; Create `tests/fixtures/control-plane/v1-sparse-legacy.json`; Create `tests/fixtures/control-plane/v1-attempt-provenance.json`; Create `tests/fixtures/control-plane/v1-review-loops.json`; Create `tests/fixtures/control-plane/v1-review-rows.json`; Create `tests/fixtures/control-plane/v1-quarantined-legacy.json`; Create `tests/fixtures/control-plane/v2-empty.json`; Create `tests/fixtures/control-plane/future-v3.json`; Create `tests/fixtures/control-plane/malformed.json`; Test `dashboard/package.json:11-18`, `.github/workflows/kb-platform-release.yml:20-28`.

**Interfaces:** Consumes `schemas/control-plane-migrations.json`; Produces `CONTROL_PLANE_SCHEMA_VERSION`, `ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION`, `CONTROL_PLANE_COLLECTIONS`, `type ControlPlaneCollection = typeof CONTROL_PLANE_COLLECTIONS[number]`, `CONTROL_PLANE_MIGRATIONS`, `RELEASE_ATTESTATION_SCHEMA`, `RELEASE_ATTESTATION_KEYS`, `STATE_SCHEMA`, `ROLLBACK_STATE_SCHEMA`, `STATE_MIGRATION`, `emptyControlPlaneDocument()` in TypeScript, and the equivalent constants plus `EMPTY_CONTROL_PLANE` and `assert_control_plane_schema(value)` in Python.

- [ ] **[2 min]** Fetch and branch from the verified remote tip; prove the branch is not based on stale local `main`:

  ```powershell
  git fetch origin
  git switch -c codex/vm-movement-phase1 origin/main
  if ((git rev-parse HEAD) -ne (git rev-parse origin/main)) { throw 'branch is not at origin/main' }
  git ls-tree -r --name-only HEAD -- deploy .github/workflows/kb-platform-release.yml dashboard/server/control/store.ts
  ```

  Expected: `HEAD` equals `origin/main`, and all three cutover paths print.

- [ ] **[4 min]** Write the failing TypeScript contract test:

  ```ts
  import { describe, expect, it } from 'vitest';
  import {
    CONTROL_PLANE_COLLECTIONS, CONTROL_PLANE_MIGRATIONS,
    CONTROL_PLANE_SCHEMA_VERSION, RELEASE_ATTESTATION_KEYS,
    RELEASE_ATTESTATION_SCHEMA, ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION,
    STATE_MIGRATION, STATE_SCHEMA, ROLLBACK_STATE_SCHEMA,
    emptyControlPlaneDocument,
  } from './controlPlaneSchema.ts';

  describe('generated control-plane schema', () => {
    it('pins v2 and derives release metadata from the migration edge', () => {
      expect(CONTROL_PLANE_SCHEMA_VERSION).toBe(2);
      expect(ROLLBACK_CONTROL_PLANE_SCHEMA_VERSION).toBe(1);
      expect(CONTROL_PLANE_MIGRATIONS).toEqual([
        { from: 1, to: 2, breaking: true, down: 'present' },
      ]);
      expect([STATE_SCHEMA, ROLLBACK_STATE_SCHEMA, STATE_MIGRATION]).toEqual(['2', '1', 'breaking']);
      expect(RELEASE_ATTESTATION_SCHEMA).toBe('kb.release-attestation/v2');
      expect(RELEASE_ATTESTATION_KEYS).toEqual([
        'archive', 'schema', 'sha256', 'sourceCommit', 'stateSchema',
        'rollbackStateSchema', 'stateMigration', 'workflow',
      ]);
      const empty = emptyControlPlaneDocument();
      expect(empty.version).toBe(2);
      expect(empty.documentRevision).toBe(0);
      expect(Object.entries(empty).filter(([, value]) => Array.isArray(value)).map(([key]) => key).sort())
        .toEqual([...CONTROL_PLANE_COLLECTIONS].sort());
    });
  });
  ```

- [ ] **[2 min]** Run the red test:

  ```powershell
  npm --prefix dashboard test -- server/control/generated/controlPlaneSchema.test.ts
  ```

  Expected failure: Vitest cannot resolve `controlPlaneSchema.ts`.

- [ ] **[4 min]** Write the failing Python contract test:

  ```py
  import json
  from pathlib import Path
  import pytest
  from deploy import control_plane_schema

  FIXTURES = Path(__file__).parent / "fixtures/control-plane"

  def test_generated_empty_document_is_schema_v2():
      value = json.loads(control_plane_schema.EMPTY_CONTROL_PLANE)
      assert value["version"] == control_plane_schema.CONTROL_PLANE_SCHEMA_VERSION == 2
      assert value["documentRevision"] == 0
      assert {k for k, v in value.items() if isinstance(v, list)} == set(
          control_plane_schema.CONTROL_PLANE_COLLECTIONS
      )

  @pytest.mark.parametrize(
      ("name", "accepted"),
      [("v1-supported.json", True), ("v1-sparse-legacy.json", True), ("v2-empty.json", True),
       ("future-v3.json", False), ("malformed.json", False)],
  )
  def test_cross_language_schema_fixtures(name, accepted):
      value = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
      if accepted:
          assert control_plane_schema.assert_control_plane_schema(value)["version"] in {1, 2}
      else:
          with pytest.raises(ValueError):
              control_plane_schema.assert_control_plane_schema(value)

  def test_generated_modules_are_byte_current(tmp_path):
      from scripts.generate_control_plane_schema import generate
      root = Path(__file__).parents[1]
      ts_out, py_out = tmp_path / "schema.ts", tmp_path / "schema.py"
      generate(root / "schemas/control-plane-migrations.json", ts_out, py_out)
      assert ts_out.read_bytes() == (root / "dashboard/server/control/generated/controlPlaneSchema.ts").read_bytes()
      assert py_out.read_bytes() == (root / "deploy/control_plane_schema.py").read_bytes()
  ```

- [ ] **[2 min]** Run the red Python test:

  ```powershell
  python -m pytest -q tests/test_control_plane_schema.py
  ```

  Expected failure: `deploy.control_plane_schema` cannot be imported.

- [ ] **[5 min]** Add the closed registry JSON. Its schema is `kb.control-plane-migrations/v1`; each version has `collections` and `envelopeRequired`. Version 1's canonical collection list is the 13 arrays at `dashboard/server/control/store.ts:412-428`, while its required pre-migration core is exactly `proposals,runs,stages,attempts,sessions,humanRequests,events,quarantine`; version 2 lists/requires those 13 plus `deployments`. Its only edge is `{from:1,to:2,breaking:true,down:"present"}`; its release-attestation object contains the exact v2 literal and ordered eight keys above. Reject unknown top-level or nested keys in the generator. Task 1 proves generator self-consistency only; the non-tautological bridge to the real `StoreDocument` lands in Task 2 and is required before the Task-2 checkpoint.

- [ ] **[5 min]** Implement `generate(registry: Path, ts_output: Path, py_output: Path) -> None` and `--check` in `scripts/generate_control_plane_schema.py`. Sort no semantic arrays, emit canonical UTF-8/LF bytes, derive current/rollback/migration values from the edge graph, and generate both checked-in modules. `--check` compares exact bytes and exits nonzero on drift; it never parses TypeScript source.

- [ ] **[5 min]** Create the base fixtures: `v1-supported.json` is the current empty v1 shape from `store.ts:896-914`; hand-author `v1-sparse-legacy.json` with exactly `version:1`, `nextEventCursor:1`, and empty `proposals,runs,stages,attempts,sessions,humanRequests,events,quarantine`, deliberately omitting `stageGenerations,iterationLoops,iterationRequests,iterationReceipts,generationSupersessions`; `v2-empty.json` is generated v2; `future-v3.json` changes only `version` to 3; `malformed.json` gives `runs` an object value. Do not derive the sparse fixture from `store.test.ts:3435-3466`; that test characterizes checker-contract nulling, not the sparse document envelope.

- [ ] **[5 min]** Create the four transform fixtures one-to-one: hand-author `v1-attempt-provenance.json` from `migrateLegacyStoreAttemptProvenance()`'s exact field contract at `store.ts:2290-2333`—one valid attempt carries matching `reviewSubjectGenerationRef`, `reviewSubjectResultHash`, and `reviewSubjectCanonicalCommit`, omits `logicalGeneration,baseGenerationRef,baseCommit`, and has a matching `stageGenerations` row; `v1-review-loops.json` copies the review-stage/run graph built at `store.test.ts:583-661` with generic/review-loop arrays removed so `materializeLegacyStoreReviewLoops()` must run; `v1-review-rows.json` copies the active legacy review-loop/receipt migration scenario at `:1884-1946`; `v1-quarantined-legacy.json` uses the quarantine branch at `:848-860` with the same assertions as `:1884-1946`. `store.test.ts:1948-1971` supplies the tampered-review rejection fixture; `:2099-2117` supplies only the migration-size fixture, not a fourth transform. Generate modules, then run:

  ```powershell
  python scripts/generate_control_plane_schema.py
  python scripts/generate_control_plane_schema.py --check
  npm --prefix dashboard test -- server/control/generated/controlPlaneSchema.test.ts
  python -m pytest -q tests/test_control_plane_schema.py
  ```

  Expected: generator check and both suites pass.

- [ ] **[2 min]** Human integrator only; workers do not run this command:

  ```powershell
  git add schemas/control-plane-migrations.json scripts/generate_control_plane_schema.py dashboard/server/control/generated/controlPlaneSchema.ts deploy/control_plane_schema.py dashboard/server/control/generated/controlPlaneSchema.test.ts tests/test_control_plane_schema.py tests/fixtures/control-plane
  git commit -m "feat(control): generate schema-v2 contracts"
  ```

### Task 2: Install the v1→v2 loader, legacy extraction, and exhaustive lifecycle

**Files:** Create `dashboard/server/control/persistence.ts`; Create `dashboard/server/control/persistence.test.ts`; Create `dashboard/server/control/migrations.ts`; Create `dashboard/server/control/migrations.test.ts`; Create `dashboard/server/control/runLifecycle.ts`; Create `dashboard/server/control/runLifecycle.test.ts`; Modify `dashboard/server/control/types.ts:64-110,506-540`; Modify `dashboard/server/control/store.ts:104-175,223-231,412-428,747-914,1207-1450,2192-2217,2290-2399,2633-2728,3198-3375,6522-6588`; Modify `dashboard/server/control/execution.ts:326-346,856-955,1041,1147,1213-1217,2433-2486`; Modify `dashboard/server/control/launch.ts:474`; Modify `dashboard/server/control/queueBridge.ts:858,1003`; Modify `dashboard/server/control/routes.ts:163,677,791,1055,1249-1305,1563-1567,1747-1806,1903-2072`; Modify `dashboard/server/control/synthetic-acceptance.ts:203-208`; Modify `dashboard/server/control/execution.test.ts:1032,1239,1343,1441,1493,2689`; Modify `dashboard/server/control/queueBridge.test.ts:1547`; Modify `dashboard/server/control/routes.test.ts:2412,2508,3693,4351`; Modify `dashboard/server/control/store.test.ts:1884-1971,2099-2117,3339,3614,3912,3988,4226,4303,4395,4423`; Modify `dashboard/server/workflows/routes.test.ts:232,623`.

**Interfaces:** Consumes generated schema constants and raw JSON; Produces `type SaveDurability='ordinary'|'deploy-critical'`; `PersistenceDeps`; `createNodePersistenceDeps():PersistenceDeps`; `fakePersistenceDeps(calls,platform):PersistenceDeps`; `spyPersistenceDeps(calls,realDeps):PersistenceDeps`; `persistControlDocumentSync(path:string,encoded:string,durability:SaveDurability,deps?:PersistenceDeps):void`; `ControlStoreOptions.persistenceDepsForTest?:PersistenceDeps`; minimal empty-only `StoredDeployment`; `StoreDocumentCollections` (the 13 existing arrays extracted from `StoreDocument`, plus v2 `deployments`); `emptyStoreDocumentForTest():StoreDocument`; `RUN_LIFECYCLE_KINDS`; `RUN_LIFECYCLE_SEMANTICS`; `RunLifecycleKind`; `RunLifecycle`; `DeployPause`; `lifecycleForKind()`; `runLifecycleKind()`; `projectRunState()`; `isTerminalRun()`; `canQuarantineRun()`; `canTransitionRun()`; `assertMigrationEnvelope()`; `assertDocumentInvariant()`; `migrateControlDocument(source,target,context)`; `loadAndMigrate()`; and `normalizeCrash(document,{stamp,bootId})` containing crash-state normalization only.

- [ ] **[4 min]** Before enabling schema v2, write the failing critical-save order test:

  ```ts
  import { expect, it } from 'vitest';
  import { fakePersistenceDeps, persistControlDocumentSync } from './persistence.ts';

  it('orders both Linux barriers for deploy-critical persistence', () => {
    const calls: string[] = [];
    persistControlDocumentSync('/state/control/control-plane.json', '{}\n',
      'deploy-critical', fakePersistenceDeps(calls, 'linux'));
    expect(calls).toEqual([
      'open-temp', 'write', 'fsync-temp', 'close-temp', 'rename',
      'open-dir', 'fsync-dir', 'close-dir',
    ]);
  });
  ```

- [ ] **[2 min]** Run the critical-save test red:

  ```powershell
  npm --prefix dashboard test -- server/control/persistence.test.ts
  ```

  Expected failure: `persistence.ts` is absent.

- [ ] **[5 min]** Extract `store.ts:6550-6567` into `persistControlDocumentSync(path,encoded,durability,deps?)`. Implement the exact Linux critical barriers now, before the loader can write v2. Linux ordinary saves keep temp/write/close/atomic-rename; non-Linux temp-fsyncs, renames, then best-effort directory-fsyncs and records unsupported directory sync without claiming power-loss durability. Exact-temp cleanup and descriptor closure are mandatory on every throw.

- [ ] **[3 min]** Define the persistence injection contract before wiring the store:

  ```ts
  export interface PersistenceDeps {
    platform: NodeJS.Platform;
    openTemp(path: string): number;
    write(fd: number, encoded: string): void;
    fsync(fd: number): void;
    close(fd: number): void;
    rename(temp: string, target: string): void;
    openDirectory(path: string): number;
    removeTemp(path: string): void;
    recordBestEffortDirectorySyncFailure(error: unknown): void;
  }
  export function createNodePersistenceDeps(): PersistenceDeps;
  export function fakePersistenceDeps(calls: string[], platform: NodeJS.Platform): PersistenceDeps;
  export function spyPersistenceDeps(calls: string[], realDeps: PersistenceDeps): PersistenceDeps;
  ```

  `fakePersistenceDeps()` records operations and returns deterministic fake descriptors without touching disk; it is only for ordering/error tests. `spyPersistenceDeps()` wraps every method, records the same operation labels, and delegates arguments/results/errors to `realDeps`; it is for real-file assertions. Add `/** @internal */ persistenceDepsForTest?:PersistenceDeps` beside the existing test seam in `ControlStoreOptions` (`store.ts:463-473`). Production uses `createNodePersistenceDeps()`; tests inject only through this option.

- [ ] **[5 min]** Write the migration tests before moving code:

  ```ts
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import { describe, expect, it } from 'vitest';
  import {
    assertMigrationEnvelope, migrateControlDocument,
  } from './migrations.ts';

  const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(
    new URL(`../../../tests/fixtures/control-plane/${name}`, import.meta.url)), 'utf8'));

  describe('control document migrations', () => {
    it('migrates v1 to v2 once and is repeat-safe', () => {
      const first = migrateControlDocument(fixture('v1-supported.json'), 2, {
        stamp: '2026-08-20T00:00:00.000Z',
      });
      expect(first.applied).toEqual([{ from: 1, to: 2, breaking: true, down: 'present' }]);
      expect(first.document).toMatchObject({ version: 2, documentRevision: 0, deployments: [] });
      const second = migrateControlDocument(first.document, 2, { stamp: '2026-08-20T00:00:00.000Z' });
      expect(second.applied).toEqual([]);
      expect(second.document).toEqual(first.document);
    });

    it('rejects future versions before mutation', () => {
      const future = fixture('future-v3.json');
      const before = structuredClone(future);
      expect(() => assertMigrationEnvelope(future)).toThrow(/unsupported control-plane version 3/);
      expect(future).toEqual(before);
    });
  });
  ```

- [ ] **[2 min]** Run the red migration suite:

  ```powershell
  npm --prefix dashboard test -- server/control/migrations.test.ts
  ```

  Expected failure: `migrations.ts` is absent.

- [ ] **[5 min]** Add the final lifecycle exhaustiveness test. Choose the type-system proof: do not source-grep `.lifecycle`, because the store and engine legitimately own/read that field.

  ```ts
  import { describe, expect, it } from 'vitest';
  import {
    RUN_LIFECYCLE_KINDS, RUN_LIFECYCLE_SEMANTICS,
    canQuarantineRun, canTransitionRun, isTerminalRun,
    lifecycleForKind, projectRunState,
  } from './runLifecycle.ts';

  const TEST_DEPLOY_PAUSE = {
    deploymentRef:'deploy-1', pausedAt:'2026-08-20T00:00:00.000Z', priorKind:'running',
    resumeStreak:0, lastResumeAttemptCursor:null, resumeClaim:null,
  } as const;

  describe('RunLifecycle exhaustiveness', () => {
    it('has exactly one semantics row for every lifecycle kind', () => {
      expect(Object.keys(RUN_LIFECYCLE_SEMANTICS).sort())
        .toEqual([...RUN_LIFECYCLE_KINDS].sort());
    });

    it.each(RUN_LIFECYCLE_KINDS)('handles %s in every predicate and projection', (kind) => {
      const lifecycle = lifecycleForKind(kind, kind === 'paused-for-deploy' ? TEST_DEPLOY_PAUSE : null);
      expect(projectRunState(lifecycle)).toBe(kind);
      expect(typeof isTerminalRun(lifecycle)).toBe('boolean');
      expect(typeof canQuarantineRun(lifecycle)).toBe('boolean');
      for (const target of RUN_LIFECYCLE_KINDS) {
        expect(typeof canTransitionRun(lifecycle, target)).toBe('boolean');
      }
    });
  });
  ```

- [ ] **[2 min]** Run the red lifecycle suite:

  ```powershell
  npm --prefix dashboard test -- server/control/runLifecycle.test.ts
  ```

  Expected failure: `runLifecycle.ts` is absent.

- [ ] **[5 min]** In `types.ts`, replace the old `RunState`/`Run.state` storage contract with the closed `RunLifecycle` union. Existing kinds carry `{kind,deployPause:null}`. Define `DeployPause={deploymentRef:string,pausedAt:string,priorKind:Exclude<RunLifecycleKind,'paused-for-deploy'>,resumeStreak:number,lastResumeAttemptCursor:number|null,resumeClaim:{deploymentRef:string,bootId:string,claimantRef:string}|null}`. Keep wire field `state` only on a distinct `RunDto`; store/engine records expose `lifecycle`.

- [ ] **[5 min]** Independently author `RUN_LIFECYCLE_KINDS = ['planned','recovering','running','waiting-human','stopping','succeeded','failed','stopped','interrupted','archived','paused-for-deploy'] as const`; define `RunLifecycleKind = typeof RUN_LIFECYCLE_KINDS[number]`. Never derive the tuple from `Object.keys(RUN_LIFECYCLE_SEMANTICS)`, because the key-equality test must compare independent declarations.

- [ ] **[5 min]** Implement `runLifecycle.ts` around one `RUN_LIFECYCLE_SEMANTICS satisfies Record<RunLifecycleKind, ...>` value. Export only the reconciled constructor `lifecycleForKind(kind:RunLifecycleKind,deployPause:DeployPause|null):RunLifecycle`; reject null pause data for `paused-for-deploy` and non-null pause data for every other kind. Put terminal, quarantine, transition-edge, crash-normalization, and DTO projection decisions there; every public helper switches or indexes exhaustively and calls `assertNever` for impossible values. `paused-for-deploy` is nonterminal, non-quarantinable, and has no ordinary run-transition edges in Phase 1.

- [ ] **[3 min]** Change the real `ControlPlaneStore.transitionRun(subject,runRef,expectedVersion,state)` parameter at `store.ts:788` from `RunState` to `Exclude<RunLifecycleKind,'paused-for-deploy'>`; use the same parameter name `state` in the implementation and engine inputs. Only future deploy-store methods may construct the paused variant. Keep server `RunDto.state` typed as the projected `RunLifecycleKind` so existing HTTP clients can display the new value without gaining mutation authority.

- [ ] **[5 min]** Implement `assertMigrationEnvelope(value)` as bounded pre-migration sanity, never the target invariant. For v1 require only `version,nextEventCursor,proposals,runs,stages,attempts,sessions,humanRequests,events,quarantine`; allow `reviewLoops/reviewReceipts` and the five generic collections to be absent, and require them to be bounded arrays only when present. For v2 require the generated full collection set plus `documentRevision`. Reject future/malformed versions before mutation. Run `assertDocumentInvariant()` only after the registry reaches target v2; it owns cursor, receipt, lifecycle/deployPause, collection, and quarantine invariants formerly mixed into `assertDocument()`.

- [ ] **[5 min]** Before moving code, add one test per mapped fixture from Task 1: hand-authored `v1-sparse-legacy` asserts the five missing generic arrays are created; hand-authored `v1-attempt-provenance` asserts the three legacy review-subject fields are removed, `logicalGeneration/baseGenerationRef/baseCommit` become null, and mismatching the linked generation fails closed per `store.ts:2290-2333`; `v1-review-loops` asserts review stages materialize loops (graph `store.test.ts:583-661`); `v1-review-rows` asserts review rows decode to iteration requests/receipts (scenario `:1884-1946`); `v1-quarantined-legacy` repeats all four assertions inside quarantine (builder `:848-860`). Add the tampered outcome rejection from `:1948-1971` and migration-size assertion from `:2099-2117` as separate non-transform tests. Run once red against missing registry functions.

- [ ] **[5 min]** Move the exact bodies and their private helper types from `store.ts` into the v1→v2 `up` implementation: `migrateLegacyStoreAttemptProvenance` (`:2290-2333`), `prepareLegacyStoreMigration` (`:2335-2399`), `decodeLegacyStoreRows` (`:2633-2728`), and `materializeLegacyStoreReviewLoops` (`:3198-3248`). Execute them in that order, then convert live and quarantined run `state` fields to `lifecycle`, add `documentRevision:0` and `deployments:[]`, delete legacy fields, and set `version:2`. Preserve proposal snapshots/hashes byte-for-byte; rerunning v2 applies nothing.

- [ ] **[3 min]** Keep module direction acyclic: export `StoreDocument`/stored row types from `store.ts` only as `@internal` types; `migrations.ts` uses `import type` and owns every runtime constant/helper used by the moved transforms; `store.ts` is the sole runtime importer of `migrations.ts`. No runtime import from migrations back to store is permitted.

- [ ] **[5 min]** Implement the v2→v1 down function now because the registry declares `down:'present'`. Reject a nonterminal Deployment or paused lifecycle. For terminal Deployment records, append one deterministic reserved lifecycle event carrying their canonical JSON and the original `documentRevision/nextEventCursor`; remove `deployments`, project ordinary lifecycles to state strings, and set `version:1`. The up edge recognizes/removes that carrier and rematerializes the exact terminal records/scalars. Test v2→v1→v2 exact equality with a terminal deployment, plus refusal for nonterminal/paused state.

- [ ] **[5 min]** Split file hydration into two paths. `loadAndMigrate()` is exactly parse → `assertMigrationEnvelope` → registry chain → `assertDocumentInvariant`; every ordinary store load uses it and never calls `normalizeCrash`. Constructor startup alone calls `loadAndMigrate()`, then `normalizeCrash(document,{stamp,bootId})` once, then increments `documentRevision` once and performs one `deploy-critical` save if either step changed data. Remove all four legacy calls from `normalizeCrash`; preserve `paused-for-deploy` and its pending activation, clear any resume claim whose bootId differs from the supplied bootId, and keep present waiting-human/interrupted containment for non-paused active rows.

- [ ] **[3 min]** Until Task 4 supplies the entrypoint lease, add `bootId?:string` to `ControlStoreOptions`; file-store construction creates one random fallback boot ID and passes it only to its single startup normalization, while deterministic tests pass one explicitly. Task 4 deletes this fallback and makes `access.lease.bootId` the sole file-store boot identity. No paused row can be authored by production behavior in this phase.

- [ ] **[3 min]** Bind generated collections to the actual store type. Export `emptyStoreDocumentForTest()` and a compile-time equality assertion between `keyof StoreDocumentCollections` and generated `ControlPlaneCollection`; add a test comparing list-valued keys from `emptyStoreDocumentForTest()` with `CONTROL_PLANE_COLLECTIONS`. This is the non-tautological TypeScript↔manifest half of the Python seed parity proof.

- [ ] **[3 min]** Define the Phase-1-minimal persisted row beside `StoredRun` at `store.ts:223-231`, before `StoreDocumentCollections` refers to it:

  ```ts
  interface StoredDeployment {
    deploymentRef: string;
    revision: number;
    operationReceipts: [];
  }
  ```

  Task 2's `assertDocumentInvariant()` requires `deployments` to be an empty array, so this minimal shape cannot admit a partial runtime Deployment. Task 3 extends this existing interface into the complete persisted record and relaxes the empty-only invariant; it must not introduce a second `StoredDeployment` declaration.

- [ ] **[5 min]** Rename the storage contract first: extract the 13 current collection arrays at `store.ts:412-428` into this exact sub-interface, then make `StoreDocument` extend it:

  ```ts
  interface StoreDocumentCollections {
    proposals: StoredProposal[]; runs: StoredRun[]; stages: StoredStage[];
    attempts: StoredAttempt[]; sessions: StoredSession[];
    humanRequests: StoredHumanRequest[]; events: StoredEvent[];
    stageGenerations: StoredStageGeneration[]; iterationLoops: StoredIterationLoop[];
    iterationRequests: StoredIterationRequest[]; iterationReceipts: StoredIterationReceipt[];
    generationSupersessions: StoredGenerationSupersession[];
    quarantine: QuarantinedRunBundle[]; deployments: StoredDeployment[];
  }
  interface StoreDocument extends StoreDocumentCollections {
    version: 2; documentRevision: number; nextEventCursor: number;
  }
  ```

  Change `StoredRun`/internal `Run` to `lifecycle`, and make `publicRun()` (`:1207-1219`) explicitly project `state:projectRunState(value.lifecycle)` into `RunDto`. Use the generated `ControlPlaneCollection` equality assertion here.

- [ ] **[5 min]** Convert `store.ts` lifecycle declarations/predicates and early projections: the `RunState` import plus tables at `:63,104-175`, `transitionRun` signature at `:788`, public/quarantine projections at `:1207-1493`, and run guards at `:1623,1905`. Replace set/table lookups with `runLifecycle.ts` helpers.

- [ ] **[5 min]** Convert `store.ts` crash and activation sites: reads/writes at `:3276-3318` and `:4019-4148`. Representative write becomes `run.lifecycle = lifecycleForKind('waiting-human', null)` instead of `run.state = 'waiting-human'` at `:3277`; never mutate `lifecycle.kind` in place.

- [ ] **[5 min]** Convert `store.ts` transition sites at `:4156-4188`. Representative read becomes `if (runLifecycleKind(run.lifecycle) === state)` instead of `if (run.state === state)` at `:4165`; the assignment at `:4174` replaces the whole lifecycle value. Preserve exact replay, edge, boundary, success, version, timestamp, and auto-close behavior.

- [ ] **[5 min]** Convert the remaining `store.ts` run sites at `:4279-4317,5337-5660,6281-6320`. The verified origin/main inventory is 41 `run.state` reads/writes total in this file; finish with `git grep -n 'run\.state' -- dashboard/server/control/store.ts` returning no hits.

- [ ] **[5 min]** Convert `execution.ts:856-955` (batch/result projections), replacing its 13 state reads with `runLifecycleKind(detail.run.lifecycle)` while preserving returned `state` DTO strings and every early return.

- [ ] **[5 min]** Convert the other 8 verified `execution.ts` sites at `:1041,1147,1213-1217,2433-2486`; settlement writes replace whole lifecycle values through the central helper. Finish with zero `run.state` hits in `execution.ts` (21 origin/main sites total).

- [ ] **[5 min]** Convert the first route group at `routes.ts:677,791,1055,1249-1305,1563-1567`; keep outward JSON as `RunDto.state`, but all internal predicates read lifecycle helpers.

- [ ] **[5 min]** Convert the second route group at `routes.ts:1747-1806,1903-2072`; finish with zero `run.state` hits in `routes.ts` (17 origin/main sites total).

- [ ] **[5 min]** Convert the small production files exactly: `synthetic-acceptance.ts:206-207` (2 sites), `launch.ts:474` (1), and `queueBridge.ts:1003` (1; `collectTerminalStageCosts` begins at `:858`). Do not change launch, queue, or execution behavior beyond the lifecycle representation.

- [ ] **[5 min]** Convert the verified test sites: `store.test.ts` (7), `execution.test.ts` (6), `routes.test.ts` (4), and `workflows/routes.test.ts:232,623` (2). Internal store assertions use `run.lifecycle.kind`; HTTP DTO assertions keep `run.state`. Run `git grep -n 'run\.state'` over these four files and inspect every remaining hit as an intentional DTO assertion.

- [ ] **[2 min]** Record the deliberate client deferral: `dashboard/src/control/controlClient.ts:124-128` has its own 9-member `RunState`; Phase 3 must add `paused-for-deploy` when the API/UI begins observing parked runs. Do not change the client in Phase 1 because no production path can author the paused lifecycle yet.

- [ ] **[3 min]** Run focused tests and use TypeScript as the exhaustive-site detector:

  ```powershell
  npm --prefix dashboard test -- server/control/persistence.test.ts server/control/migrations.test.ts server/control/runLifecycle.test.ts server/control/store.test.ts server/control/execution.test.ts server/control/routes.test.ts
  npm --prefix dashboard run typecheck
  ```

  Expected: all tests pass; typecheck has zero old `Run.state`/`RunState` errors.

- [ ] **[2 min]** Human integrator only; workers do not run this command:

  This checkpoint is repository-only and non-deployable: once any file store migrates to v2, pre-Phase-1 dashboard code hard-fails on that document. Do not build, ship, or activate this commit on the VM; Phase 3's old-quiescence bootstrap is the first activation boundary.

  ```powershell
  git add dashboard/server/control dashboard/server/workflows/routes.test.ts
  git commit -m "feat(control): migrate runs to exhaustive lifecycle v2"
  ```

### Task 3: Add Deployment CAS records and activation-journal types

**Files:** Create `dashboard/server/control/deploymentState.ts`; Create `dashboard/server/control/deploymentTransitions.test.ts`; Create `dashboard/server/release/activationJournal.ts`; Create `dashboard/server/release/activationJournal.test.ts`; Modify `dashboard/server/control/types.ts:92-110`; Modify `dashboard/server/control/store.ts:412-428,747-887,896-914`; Insert Deployment methods beside the store factory at `dashboard/server/control/store.ts:3378-3410` and the existing expected-version mutation pattern at `:4156-4188`; Test `dashboard/server/control/store.test.ts`.

**Interfaces:** Consumes schema-v2 `deployments` and Task 2's minimal `StoredDeployment`; Extends that one stored interface to the full record; Produces `DeploymentState`, `Deployment`, `DeploymentProgress`, `DeploymentTerminalOutcome`, `DeploymentTransitionPatch`, `CreateDeploymentInput`, `TransitionDeploymentInput`, `getDeployment()`, `listDeployments()`, `createDeployment()`, `transitionDeployment()`, `getControlDocumentMetadata()`, `ActivationJournal`, and `parseActivationJournal()`.

- [ ] **[5 min]** Write the Deployment state-machine and CAS tests:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { createInMemoryControlPlaneStore } from './store.ts';
  import { DEPLOYMENT_STATES, canTransitionDeployment } from './deploymentState.ts';

  const create = {
    deploymentRef: 'deploy-1', initialState: 'waiting-confirmation',
    targetCommit: 'b'.repeat(40), previousCommit: 'a'.repeat(40),
    requestedAt: '2026-08-20T00:00:00.000Z', parkWarnAt: '2026-08-20T00:35:00.000Z',
    idempotencyKey: 'create-1',
  } as const;

  describe('Deployment CAS', () => {
    it('accepts only the exhaustive transition graph', () => {
      const allowed = new Set([
        'waiting-confirmation>requested', 'waiting-confirmation>aborted',
        'requested>parked', 'requested>aborted', 'requested>failed',
        'parked>swapping', 'parked>aborted', 'parked>failed',
        'swapping>resuming', 'swapping>aborted', 'swapping>failed',
        'resuming>succeeded', 'resuming>aborted', 'resuming>failed',
        'succeeded>acknowledged', 'aborted>acknowledged', 'failed>acknowledged',
      ]);
      for (const from of DEPLOYMENT_STATES) for (const to of DEPLOYMENT_STATES) {
        expect(canTransitionDeployment(from, to)).toBe(allowed.has(`${from}>${to}`));
      }
    });

    it('commits transition and receipt once, then replays exactly', () => {
      const store = createInMemoryControlPlaneStore();
      const made = store.createDeployment('operator', create);
      expect(made.ok).toBe(true);
      if (!made.ok) return;
      const input = { expectedRevision: made.value.revision, expectedState: 'waiting-confirmation',
        nextState: 'requested', idempotencyKey: 'request-1', patch: {} } as const;
      const first = store.transitionDeployment('operator', 'deploy-1', input);
      const replay = store.transitionDeployment('operator', 'deploy-1', input);
      expect(first).toMatchObject({ ok: true, replayed: undefined });
      expect(replay).toMatchObject({ ok: true, replayed: true });
      expect(store.getControlDocumentMetadata().documentRevision).toBe(2);
    });
  });
  ```

- [ ] **[2 min]** Run red:

  ```powershell
  npm --prefix dashboard test -- server/control/deploymentTransitions.test.ts
  ```

  Expected failure: deployment module/store methods do not exist.

- [ ] **[5 min]** Add the spec's exact state union and these closed interfaces; do not add `parkedRunRefs`:

  ```ts
  export interface DeploymentProgress {
    kind: 'idle'|'waiting-attempt'|'parked'|'swapping'|'rehydrating';
    attemptRef: string|null; since: string|null; detail: string|null;
  }
  export interface DeploymentTerminalOutcome {
    kind: 'succeeded'|'aborted'|'failed'; at: string; by: string;
  }
  export interface DeploymentAcknowledgement { subject: string; at: string; }
  export interface Deployment {
    deploymentRef: string; revision: number; targetCommit: string; previousCommit: string;
    state: DeploymentState; requestedAt: string; parkWarnAt: string; swapDeadlineAt: string|null;
    fenceRevision: number; drainAcks: Record<string,{fenceRevision:number;acknowledgedAt:string}>;
    blockers: string[]; progress: DeploymentProgress; abortRequestedAt: string|null;
    error: string|null; terminalOutcome: DeploymentTerminalOutcome|null;
    acknowledgedBy: DeploymentAcknowledgement|null;
  }
  export interface DeploymentTransitionPatch {
    swapDeadlineAt?: string|null; blockers?: string[]; progress?: DeploymentProgress;
    abortRequestedAt?: string|null; error?: string|null;
    terminalOutcome?: DeploymentTerminalOutcome|null;
    acknowledgedBy?: DeploymentAcknowledgement|null;
  }
  export interface CreateDeploymentInput {
    deploymentRef: string; initialState: 'waiting-confirmation'|'requested';
    targetCommit: string; previousCommit: string;
    requestedAt: string; parkWarnAt: string; idempotencyKey: string;
  }
  export interface TransitionDeploymentInput {
    expectedRevision: number; expectedState: DeploymentState; nextState: DeploymentState;
    idempotencyKey: string; patch: DeploymentTransitionPatch;
  }
  ```

  `DEPLOYMENT_EDGES satisfies Record<DeploymentState,ReadonlySet<DeploymentState>>` and `assertNever` own the graph. Per-target validators reject patch fields not meaningful for that next state. `acknowledged` is absorbing. Exactly one deployment may be nonterminal.

- [ ] **[3 min]** `createDeployment()` initializes `revision:1`, the explicit `initialState`, `swapDeadlineAt:null`, `fenceRevision:0`, empty acknowledgements/blockers, idle-null progress, and all abort/error/outcome/acknowledgement fields null. It rejects equal target/previous SHAs, non-full lowercase SHAs, noncanonical timestamps, `parkWarnAt <= requestedAt`, and any initial state outside the two declared values.

- [ ] **[5 min]** Extend Task 2's sole `StoredDeployment` definition with every `Deployment` field above and change `operationReceipts:[]` to `{key:string,fingerprint:string,operation:'create'|'transition',deploymentRevision:number,result:Deployment,recordedAt:string}[]`, capped at the newest 64 receipts. Relax the Task-2 empty-only invariant to validate the complete shape. `createDeployment(subject,input)` and `transitionDeployment(subject,ref,input)` fingerprint the full closed input. Same key/fingerprint returns the saved result with `replayed:true`; key reuse with different content, wrong record revision/state, illegal edge, or second nonterminal deployment returns conflict without save. Each successful mutation increments entity revision and `documentRevision` exactly once in one deploy-critical commit.

- [ ] **[4 min]** Write the journal parser test:

  ```ts
  import { expect, it } from 'vitest';
  import { ACTIVATION_JOURNAL_PHASES, parseActivationJournal } from './activationJournal.ts';

  it.each(ACTIVATION_JOURNAL_PHASES)('validates journal phase %s', (phase) => {
    const noSnapshot = ['authorized', 'rollback-authorized', 'old-selected', 'rollback-cancelled', 'recovery-required'].includes(phase);
    const parsed = parseActivationJournal({
      schema: 'kb.activation-journal/v1', deploymentRef: 'deploy-1',
      targetCommit: 'b'.repeat(40), previousCommit: 'a'.repeat(40),
      snapshotDigest: noSnapshot ? null : 'c'.repeat(64),
      phase, updatedAt: '2026-08-20T00:00:00.000Z',
    });
    expect(parsed.phase).toBe(phase);
  });
  ```

- [ ] **[4 min]** Implement `activationJournal.ts` as types/validation only. The phase set is `authorized|service-stopped|migrated|current-swapped|restart-issued|activation-committed|healthy|rollback-authorized|rollback-stopped|down-migrated|rollback-swapped|rollback-committed|rollback-healthy|old-selected|rollback-cancelled|recovery-required`. Model active forward, active rollback, and terminal recovery outcomes as a discriminated union so later boot code cannot confuse them. Require `snapshotDigest:null` at pre-snapshot/terminal-no-snapshot outcomes and a lowercase SHA-256 digest in every post-stop active phase/outcome. Export no file writer, timer, recovery action, service call, or activator hook.

- [ ] **[5 min]** Add these exact Deployment cases to `deploymentTransitions.test.ts`; `createStoreAndDeployment()` returns `{store,made}` and throws unless create succeeds, while `transition(store,made,nextState,key,patch={})` supplies `made.revision/state`:

  ```ts
  it('rejects stale revision and state without committing', () => {
    const {store, made} = createStoreAndDeployment();
    const before = store.getControlDocumentMetadata().documentRevision;
    expect(store.transitionDeployment('operator', made.deploymentRef, {
      expectedRevision: 0, expectedState: 'waiting-confirmation', nextState: 'requested',
      idempotencyKey: 'stale', patch: {},
    })).toMatchObject({ok:false, reason:'conflict'});
    expect(store.getControlDocumentMetadata().documentRevision).toBe(before);
  });
  it('rejects reuse of an idempotency key with different input', () => {
    const {store, made} = createStoreAndDeployment();
    const first = transition(store, made, 'requested', 'same-key');
    expect(first.ok).toBe(true);
    expect(store.transitionDeployment('operator', made.deploymentRef, {
      expectedRevision: made.revision, expectedState: made.state, nextState: 'aborted',
      idempotencyKey: 'same-key', patch: {},
    })).toMatchObject({ok:false, reason:'idempotency-conflict'});
  });
  it('refuses a second nonterminal deployment', () => {
    const {store} = createStoreAndDeployment();
    expect(store.createDeployment('operator', {...create, deploymentRef:'deploy-2',
      idempotencyKey:'create-2'})).toMatchObject({ok:false, reason:'conflict'});
  });
  it.each(['succeeded','aborted','failed'] as const)('allows %s to be acknowledged once', (state) => {
    const {store, terminal} = createTerminalDeployment(state);
    const result = transition(store, terminal, 'acknowledged', `ack-${state}`, {
      acknowledgedBy:{subject:'operator',at:'2026-08-20T01:00:00.000Z'},
    });
    expect(result).toMatchObject({ok:true, value:{state:'acknowledged'}});
  });
  it('does not alter attempt session or accounting inventory', () => {
    const store = createInMemoryControlPlaneStore();
    const seeded = seedRunWithAttemptAndSession(store);
    const before = store.getRun('operator', seeded.runRef);
    if (!before.ok) throw new Error(before.detail);
    expect(store.createDeployment('operator', create).ok).toBe(true);
    const after = store.getRun('operator', seeded.runRef);
    if (!after.ok) throw new Error(after.detail);
    expect(after.value.attempts).toEqual(before.value.attempts);
    expect(after.value.sessions).toEqual(before.value.sessions);
  });
  ```

  Define the helpers in this file, not in production: `createStoreAndDeployment()` creates an in-memory store, calls `createDeployment('operator',create)`, throws on failure, and returns the successful value as `made`; `transition()` builds the closed input from the supplied Deployment's current revision/state and throws on an unexpected failure. `createTerminalDeployment('succeeded')` walks `waiting-confirmation→requested→parked→swapping→resuming→succeeded`; the `aborted` case takes `waiting-confirmation→aborted`; the `failed` case takes `waiting-confirmation→requested→failed`. `seedRunWithAttemptAndSession()` copies the proposal/run setup at `store.test.ts:452-495`, then creates one attempt and one worker session with the public store calls; return its `runRef`. Do not mock collections or add an inspection-only production API.

- [ ] **[3 min]** Add these exact parser failures to `activationJournal.test.ts`:

  ```ts
  it('rejects an unknown activation-journal phase', () => {
    expect(() => parseActivationJournal({...validJournal('authorized'), phase:'other'}))
      .toThrow(/activation journal phase/);
  });
  it('requires null before snapshot and sha256 after service stop', () => {
    expect(() => parseActivationJournal({...validJournal('authorized'), snapshotDigest:'c'.repeat(64)}))
      .toThrow(/snapshot digest/);
    expect(() => parseActivationJournal({...validJournal('migrated'), snapshotDigest:null}))
      .toThrow(/snapshot digest/);
  });
  ```

- [ ] **[3 min]** Run the complete state and journal matrices:

  ```powershell
  npm --prefix dashboard test -- server/control/deploymentTransitions.test.ts server/release/activationJournal.test.ts server/control/store.test.ts
  npm --prefix dashboard run typecheck
  ```

  Expected: green.

- [ ] **[2 min]** Human integrator only; workers do not run this command:

  ```powershell
  git add dashboard/server/control dashboard/server/release
  git commit -m "feat(control): add deployment and journal state models"
  ```

### Task 4: Enforce the process-lifetime single-writer lease

**Files:** Create `dashboard/server/control/writerLease.ts`; Create `dashboard/server/control/writerLease.posix.ts`; Create `dashboard/server/control/writerLease.win32.ts`; Create `dashboard/server/control/writerLease.test.ts`; Create `dashboard/server/control/test-fixtures/writerLeaseChild.ts`; Create `dashboard/server/control/test-fixtures/controlStore.ts`; Modify `dashboard/server/control/store.ts:463-473,6522-6588`; Modify `dashboard/server/index.ts:124-148,327-347`; Modify `dashboard/server/http/surface.ts:121-143`; Modify `dashboard/server/control/synthetic-acceptance.ts:216-258`; Modify `dashboard/server/runtime/evidence.ts:288-296`; Modify `dashboard/server/atomicRename.test.ts:26,126,150`; Modify `dashboard/server/auth/routes.test.ts:7-28`; Modify `dashboard/server/composer/routes.test.ts:7,74-79`; Modify `dashboard/server/control/activation.boot.test.ts:24-28,58-134`; Modify `dashboard/server/control/brokerStore.test.ts:8,203-214`; Modify `dashboard/server/control/execution.test.ts:5,1180-1192,1319-1338,1618-1638,2875-2905`; Modify `dashboard/server/control/routes.test.ts:9,158,476,1001,1177,1289,2589-2703,3733`; Modify `dashboard/server/control/store.test.ts:16,183-196,249-368,1235-1920`; Modify `dashboard/server/control/synthetic-acceptance.test.ts:1`; Modify `dashboard/server/http/surface.test.ts:1`; Modify `dashboard/server/index.test.ts:42-199`; Modify `dashboard/server/workflows/fyt.videoRun.registration.test.ts:18,115`; Modify `dashboard/server/workflows/routes.test.ts:8,83,407,651`; Modify `dashboard/server/write/cardRespondRoute.test.ts:12,102`; Modify `dashboard/server/write/workflowRunRoute.test.ts:4,19`; Reuse `/proc` start-tick parsing from `dashboard/server/runner/trigger.ts:79-88`.

**Interfaces:** Consumes Koffi-backed POSIX or Windows native locking and the process entrypoint; Produces `WriterLease`; `LockContentionRecord`; `FileControlPlaneAccess`; `ControlStoreReadOnlyError`; `acquireWriterLease()`; `currentLockContention()`; `inspectWriterLeaseForTest()`; `createFileControlPlaneStore(stateRoot,access,options?)`; and `createLeasedFileStoreForTest(options?:ControlStoreOptions,seed?:unknown,bootId?:string):{root:string,path:string,store:ControlPlaneStore,lease:WriterLease,close():void}` plus `createDeploymentFixture(sequence?:number):CreateDeploymentInput`.

- [ ] **[5 min]** Write subprocess-backed failing tests:

  ```ts
  import { existsSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';
  import {
    WriterLeaseContentionError, acquireWriterLease, currentLockContention,
  } from './writerLease.ts';
  import { makeCurrentV2RootForTest, makeLeaseRoot, spawnLeaseFixture, writeContentionForTest } from './test-fixtures/writerLeaseChild.ts';

  describe('writer lease', () => {
    it('refuses a second process and records current contention', async () => {
      const root = makeLeaseRoot();
      const held = await spawnLeaseFixture('hold', root, 'boot-a');
      expect(() => acquireWriterLease({ stateRoot: root, bootId: 'boot-b' }))
        .toThrow(WriterLeaseContentionError);
      const contention = currentLockContention(root);
      expect(contention).toMatchObject({ bootId: 'boot-b' });
      if (process.platform === 'linux') expect(contention?.holderPid).toBe(held.pid);
      if (process.platform === 'win32') expect(contention?.holderPid).toBeNull();
      await held.stop();
    });

    it('does not leak the fd into a spawned child', async () => {
      const root = makeLeaseRoot();
      const lease = acquireWriterLease({ stateRoot: root, bootId: 'boot-a' });
      const sleeper = await spawnLeaseFixture('sleep', root, 'unused');
      lease.release();
      expect((await spawnLeaseFixture('try', root, 'boot-b')).exitCode).toBe(0);
      await sleeper.stop();
    });

    it('ignores stale contention and lets the incumbent clear it', () => {
      const root = makeLeaseRoot();
      writeContentionForTest(root, { bootId: 'dead', contenderPid: process.pid,
        contenderStartTicks: 1, holderPid: null, observedAt: '2026-08-20T00:00:00.000Z' });
      expect(currentLockContention(root)).toBeNull();
      const lease = acquireWriterLease({ stateRoot: root, bootId: 'live' });
      lease.assertHeld();
      expect(existsSync(join(root, 'control', 'lock-contention.json'))).toBe(false);
      lease.release();
    });
  });
  ```

- [ ] **[2 min]** Run red on Linux/WSL:

  ```powershell
  npm --prefix dashboard test -- server/control/writerLease.test.ts
  ```

  Expected failure: `writerLease.ts` is absent.

- [ ] **[5 min]** Implement exact interfaces:

  ```ts
  export interface LockContentionRecord {
    bootId: string; contenderPid: number; contenderStartTicks: number;
    holderPid: number | null; observedAt: string;
  }
  export interface WriterLease {
    readonly mode: 'already-locked'; readonly stateRoot: string;
    readonly bootId: string; readonly pid: number;
    assertHeld(): void; release(): void;
  }
  export type FileControlPlaneAccess =
    | { mode: 'already-locked'; lease: WriterLease }
    | { mode: 'read-only-harness' };
  export function acquireWriterLease(input: {
    stateRoot: string; bootId: string; now?: () => Date;
  }): WriterLease;
  export function currentLockContention(stateRoot: string): LockContentionRecord | null;
  ```

- [ ] **[5 min]** In `writerLease.posix.ts`, use Koffi to call libc `open(...,O_RDWR|O_CREAT|O_CLOEXEC,0600)`, `flock(fd,LOCK_EX|LOCK_NB)`, `fcntl(fd,F_GETFD)`, `fstat`, and `close`; do not rely on `node:fs` exposing `O_CLOEXEC`. Immediately assert `FD_CLOEXEC`. Match the full `fstat(fd)` device-major/device-minor/inode tuple in `/proc/locks`, never inode alone. Use PID plus `/proc/<pid>/stat` field 22 for sidecar freshness.

- [ ] **[5 min]** In `writerLease.win32.ts`, use Koffi `CreateFileW` on the exact lock path with share mode 0 and a non-inheritable handle, then verify `HANDLE_FLAG_INHERIT` is clear with `GetHandleInformation`; use `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` plus `GetProcessTimes` for contender freshness. Both platform adapters atomically write the same mode-restricted sidecar on contention and only `lease.assertHeld()` clears it after ownership recheck. Unit tests inject a fake native adapter; the real subprocess suite runs on its matching platform.

- [ ] **[4 min]** Add a private unique-symbol brand so an `already-locked` capability cannot be forged. Change the file-store signature to `createFileControlPlaneStore(stateRoot:string, access:FileControlPlaneAccess, options?:ControlStoreOptions)`. It calls `lease.assertHeld()` before load and before each save and rejects a lease for another root. `read-only-harness` accepts only already-current v2, performs no migration, normalization, or save, and every mutation throws `ControlStoreReadOnlyError`.

- [ ] **[5 min]** Add `controlStore?:ControlPlaneStore` and `fileControlAccess?:FileControlPlaneAccess` to `BuildAppOptions`. In `start()`, create random `bootId`, acquire one lease before `buildApp()`, pass `{mode:'already-locked',lease}` through `BuildAppOptions` to `makeSurfaceContext()`, release it from `onClose`, and release it on build/listen failure. Remove `makeSurfaceContext()`'s implicit file-store construction and remove `registerWriteSurface()`'s default `makeSurfaceContext()` argument: callers must inject `controlStore` or explicit `fileControlAccess`.

- [ ] **[3 min]** Define `StartOptions={repoRoot?:string,leaseFactory?:typeof acquireWriterLease,buildApplication?:typeof buildApp}` with both seams marked `@internal` and defaulting to production functions. `start(port,host,options)` is the sole lease acquirer; `buildApp()` and `makeSurfaceContext()` only consume the supplied capability and never acquire.

- [ ] **[4 min]** Add internal `SyntheticAcceptanceOptions={leaseFactory?:typeof acquireWriterLease}` to `main(options={})`. Acquire exactly one lease after creating the throwaway state root at `synthetic-acceptance.ts:224`, create/inject the already-locked store at `:243`, and release in its existing `finally`. Update every exact call site listed under **Files**: file-store tests acquire/release an isolated-root lease and move old options to argument 3; surface/build helpers inject an in-memory store; `runtime/evidence.ts` injects an isolated in-memory store; inspection tests use `read-only-harness` only for a current-schema fixture.

- [ ] **[5 min]** Implement `writerLeaseChild.ts` as parent-side helpers plus a plain-JavaScript `CHILD_SCRIPT` string. Follow the repository subprocess precedent at `dashboard/server/control/atomicJsonDocument.test.ts:34-44`: invoke `spawn(process.execPath,['--input-type=module','-e',CHILD_SCRIPT,mode,root,bootId,writerLeaseModuleUrl],...)`; the script dynamically imports the module URL and contains no TypeScript syntax. `hold` acquires, prints `READY <pid>\n`, then waits for stdin EOF; `sleep` prints ready without acquiring and waits; `try` acquires/releases and exits 0, or exits 17 on contention. `spawnLeaseFixture()` waits for the complete ready line, captures PID/exit status, exposes idempotent `stop()`, kills on timeout, and never removes a root it did not create. Fixture tests cover full device-major/device-minor/inode parsing and deterministic cleanup.

- [ ] **[4 min]** Create `test-fixtures/controlStore.ts` now, before converting any three-argument call sites. `createLeasedFileStoreForTest(options={},seed,bootId='test-boot')` creates one temp root/control directory, optionally writes `seed` canonically, acquires exactly one lease with that boot ID, calls `createFileControlPlaneStore(root,{mode:'already-locked',lease},options)`, and returns `{root,path,store,lease,close}`; `close()` releases once and removes only that root. `createDeploymentFixture(sequence=1)` returns a full unique `CreateDeploymentInput`. All file-store tests use this helper unless they specifically test lock acquisition or read-only mode.

- [ ] **[5 min]** Add these required test bodies, not prose-only checks:

  ```ts
  it('sets the native noninherit flag', () => {
    const lease = acquireWriterLease({stateRoot:makeLeaseRoot(),bootId:'boot-a'});
    expect(inspectWriterLeaseForTest(lease).inheritFlagSet).toBe(false);
    lease.release();
  });
  it('rejects a lease minted for another root', () => {
    const lease = acquireWriterLease({stateRoot:makeLeaseRoot(),bootId:'boot-a'});
    expect(() => createFileControlPlaneStore(makeLeaseRoot(), {mode:'already-locked',lease})).toThrow(/root/);
    lease.release(); lease.release();
  });
  it('read-only harness refuses before mutation', () => {
    const ro = createFileControlPlaneStore(makeCurrentV2RootForTest(), {mode:'read-only-harness'});
    expect(() => ro.createDeployment('operator', {
      deploymentRef:'deploy-1', initialState:'waiting-confirmation',
      targetCommit:'b'.repeat(40), previousCommit:'a'.repeat(40),
      requestedAt:'2026-08-20T00:00:00.000Z', parkWarnAt:'2026-08-20T00:35:00.000Z',
      idempotencyKey:'create-1',
    })).toThrow(ControlStoreReadOnlyError);
  });
  ```

  `makeCurrentV2RootForTest()` creates its own temp root, writes generated `emptyControlPlaneDocument()` bytes at `control/control-plane.json`, and returns that root. In `index.test.ts`, inject `leaseFactory` and a throwing `buildApplication`; assert `release` once on build and listen failure. In `synthetic-acceptance.test.ts`, inject a counting lease factory and assert exactly one acquire/release. Retain current/stale-sidecar, POSIX `F_GETFD & FD_CLOEXEC`, Windows handle-flag, wrong-root, idempotent-release, and spawned-child tests.

- [ ] **[4 min]** Run all signature and ownership call sites:

  ```powershell
  npm --prefix dashboard test -- server/control/writerLease.test.ts server/atomicRename.test.ts server/auth/routes.test.ts server/composer/routes.test.ts server/control/activation.boot.test.ts server/control/brokerStore.test.ts server/control/execution.test.ts server/control/routes.test.ts server/control/store.test.ts server/control/synthetic-acceptance.test.ts server/http/surface.test.ts server/index.test.ts server/workflows/fyt.videoRun.registration.test.ts server/workflows/routes.test.ts server/write/cardRespondRoute.test.ts server/write/workflowRunRoute.test.ts
  npm --prefix dashboard run typecheck
  ```

  Expected: green on Linux/VM and Windows; native subprocess cases select their platform adapter, and injected adapter tests exercise both contracts.

- [ ] **[2 min]** Human integrator only; workers do not run this command:

  ```powershell
  git add dashboard/server
  git commit -m "feat(dashboard): enforce the control-store writer lease"
  ```

### Task 5: Prove coalesced durability and the VM latency gate

**Files:** Create `dashboard/server/control/store.durability.vm.test.ts`; Create `dashboard/server/control/stateFoundation.integration.test.ts`; Modify `dashboard/server/control/persistence.test.ts`; Modify the Task-3 insertion points in `dashboard/server/control/store.ts` beside `:3378-3410,4156-4188` and the file-store persistence seam at `:6501-6588`; Test `dashboard/server/control/deploymentTransitions.test.ts`; Test `dashboard/server/control/migrations.test.ts`; Reuse `resolveDashboardStateRoot()` from `dashboard/server/composer/store.ts:116`; the resolved state root feeds file-store construction at `dashboard/server/http/surface.ts:142`.

**Interfaces:** Consumes Task 2's `PersistenceDeps`, `createNodePersistenceDeps()`, and delegating `spyPersistenceDeps()`, Task 3's CAS, and Task 4's `createLeasedFileStoreForTest`; Produces `ControlStoreOptions.persistenceTargetBytesForTest?:number`, one composed state-foundation proof, and the exact VM performance gate.

- [ ] **[4 min]** Write the failing exact-size test seam before the benchmark:

  ```ts
  import { statSync } from 'node:fs';
  import { expect, it } from 'vitest';
  import { createDeploymentFixture, createLeasedFileStoreForTest } from './test-fixtures/controlStore.ts';

  it('pads only test documents to an exact persisted byte target', () => {
    const { path, store, close } = createLeasedFileStoreForTest({persistenceTargetBytesForTest:8192});
    store.createDeployment('operator', createDeploymentFixture());
    expect(statSync(path).size).toBe(8192);
    close();
  });
  ```

- [ ] **[2 min]** Run red:

  ```powershell
  npm --prefix dashboard test -- server/control/persistence.test.ts
  ```

  Expected failure: `persistenceTargetBytesForTest` is not a `ControlStoreOptions` field.

- [ ] **[4 min]** Implement `persistenceTargetBytesForTest` as an `@internal` test-only option rejected unless `process.env.NODE_ENV==='test'` or `KB_VM_DURABILITY_BENCHMARK=1`. After canonical JSON and before the final newline, append ASCII spaces to reach the exact target; JSON semantics/collections remain unchanged. Reject a target smaller than encoded bytes. Production callers cannot set it.

- [ ] **[5 min]** Reassert coalescing with Task 2's injected persistence spy; add this body to `persistence.test.ts` (the fixture loader reads `v1-supported.json`):

  ```ts
  it('coalesces each deploy-critical mutation into one persisted transaction', () => {
    const calls: string[] = [];
    const deps = spyPersistenceDeps(calls, createNodePersistenceDeps());
    const opened = createLeasedFileStoreForTest(
      {persistenceDepsForTest:deps}, fixture('v1-supported.json'));
    expect(calls.filter((call) => call === 'rename')).toHaveLength(1); // migration
    const migrated = readDocument(opened.path);
    calls.length = 0;
    const made = opened.store.createDeployment('operator', createDeploymentFixture());
    expect(made.ok).toBe(true);
    expect(calls.filter((call) => call === 'rename')).toHaveLength(1);
    const afterCreate = readDocument(opened.path);
    expect(afterCreate.documentRevision).toBe(migrated.documentRevision + 1);
    expect(afterCreate.deployments[0].revision).toBe(1);
    expect(afterCreate.deployments[0].operationReceipts).toHaveLength(1);
    calls.length = 0;
    if (!made.ok) throw new Error(made.detail);
    const input = {expectedRevision:made.value.revision, expectedState:made.value.state,
      nextState:'aborted', idempotencyKey:'abort-1', patch:{}} as const;
    const first = opened.store.transitionDeployment('operator', made.value.deploymentRef, input);
    expect(first.ok).toBe(true);
    expect(calls.filter((call) => call === 'rename')).toHaveLength(1);
    const afterTransition = readDocument(opened.path);
    expect(afterTransition.documentRevision).toBe(afterCreate.documentRevision + 1);
    expect(afterTransition.deployments[0].revision).toBe(2);
    expect(afterTransition.deployments[0].operationReceipts).toHaveLength(2);
    const transitionBytes = readFileSync(opened.path);
    calls.length = 0;
    expect(opened.store.transitionDeployment('operator', made.value.deploymentRef, input))
      .toMatchObject({ok:true,replayed:true});
    expect(calls.filter((call) => call === 'rename')).toHaveLength(0);
    expect(readFileSync(opened.path)).toEqual(transitionBytes);
    expect(opened.store.transitionDeployment('operator', made.value.deploymentRef,
      {...input, nextState:'failed'})).toMatchObject({ok:false,reason:'idempotency-conflict'});
    expect(calls.filter((call) => call === 'rename')).toHaveLength(0);
    expect(readFileSync(opened.path)).toEqual(transitionBytes);
    opened.close();
  });
  ```

  `readDocument()` is a test-local JSON reader. The one `rename` covers the record, receipt, and both revisions; no field performs its own save. Receipt lookup/fingerprint comparison precedes revision/state checks so same-key/different-input deterministically returns `idempotency-conflict` without a write.

- [ ] **[5 min]** Add the first exact real-file case to `stateFoundation.integration.test.ts`:

  ```ts
  it('migrates once, commits CAS once, and reopens byte-identically', () => {
    const opened = createLeasedFileStoreForTest({}, fixture('v1-supported.json'));
    expect(readDocument(opened.path)).toMatchObject({version:2,documentRevision:1,deployments:[]});
    const input = createDeploymentFixture();
    const made = opened.store.createDeployment('operator', input);
    expect(made.ok).toBe(true);
    expect(readDocument(opened.path)).toMatchObject({documentRevision:2,attempts:[],sessions:[]});
    const bytes = readFileSync(opened.path);
    expect(opened.store.createDeployment('operator', input)).toMatchObject({ok:true,replayed:true});
    expect(readFileSync(opened.path)).toEqual(bytes);
    const document = readDocument(opened.path);
    opened.close();
    const reopened = createLeasedFileStoreForTest({}, document);
    expect(readFileSync(reopened.path)).toEqual(bytes);
    reopened.close();
  });
  ```

- [ ] **[5 min]** Add the constructor-only normalization case:

  ```ts
  it('normalizes a stale resume claim only at construction', () => {
    const opened = createLeasedFileStoreForTest(
      {}, pausedV2Fixture({resumeClaimBootId:'boot-old'}), 'boot-new');
    expect(readPaused(opened.path).deployPause.resumeClaim).toBeNull();
    expect(readPaused(opened.path).pendingActivation).toEqual(PENDING_ACTIVATION_FIXTURE);
    opened.store.appendEvent('operator', RUN_REF,
      {kind:'message',source:'manager',summary:'ordinary mutation'});
    expect(readPaused(opened.path).lifecycle.kind).toBe('paused-for-deploy');
    expect(readPaused(opened.path).pendingActivation).toEqual(PENDING_ACTIVATION_FIXTURE);
    opened.close();
  });
  ```

  Implement `fixture()`, `pausedV2Fixture()`, `readDocument()`, and `readPaused()` as test-local JSON builders/readers; use `try/finally` around each opened helper in the final code. The exact assertions above are mandatory; do not replace them with snapshots.

- [ ] **[5 min]** Add the VM-only case with this literal skip mechanism—no suite-wide conditional:

  ```ts
  it.skipIf(process.env.KB_VM_DURABILITY_BENCHMARK !== '1')(
    'meets the VM deploy-critical latency budget',
    async () => { await runVmDurabilityBenchmark(); },
  );
  ```

  In `runVmDurabilityBenchmark()`, resolve the read-only source as `process.env.KB_VM_DURABILITY_SOURCE ?? join(resolveDashboardStateRoot(),'control','control-plane.json')`; the default is therefore `$DASHBOARD_STATE_ROOT/control/control-plane.json`. Before creating any temp root, call `accessSync(source,R_OK)` and `statSync(source)`. Catch either failure only to throw `new Error('KB_VM_DURABILITY_SOURCE is absent or unreadable: '+source)`—never skip or substitute a fixture. The invoking account needs read permission to that file.

- [ ] **[5 min]** Implement `runVmDurabilityBenchmark()` exactly: read only `statSync(source).size`; open a fresh helper with `{persistenceTargetBytesForTest:sourceBytes*2}` and generated empty v2 state. Enable `monitorEventLoopDelay({resolution:10})`, wait 20 ms, and define `measure(fn)` to time one synchronous CAS with `performance.now()`, push its duration, throw unless its `ControlResult.ok`, then `await new Promise<void>(resolve=>setImmediate(resolve))`. For cycles 1–14, measure one unique create followed by measured transitions through `requested,parked,swapping,resuming,succeeded,acknowledged`; carry each successful returned Deployment into the next transition. Then measure one unique create and `aborted`. In `finally`, disable the histogram and close the helper. Assert `durations.length===100`; sort ascending; set `p99=durations[Math.ceil(0.99*durations.length)-1]!`; assert `p99<=250` and `histogram.max/1e6<=1000`. Never read the source body or write its path.

- [ ] **[3 min]** Run functional tests:

  ```powershell
  npm --prefix dashboard test -- server/control/persistence.test.ts server/control/deploymentTransitions.test.ts server/control/migrations.test.ts server/control/stateFoundation.integration.test.ts server/control/store.test.ts
  npm --prefix dashboard run typecheck
  ```

  Expected: green.

- [ ] **[3 min]** Run the live durability gate on the Linux VM only:

  ```powershell
  $env:KB_VM_DURABILITY_BENCHMARK='1'
  $env:KB_VM_DURABILITY_SOURCE='/var/lib/kb/state/control/control-plane.json'
  npm --prefix dashboard test -- server/control/store.durability.vm.test.ts
  Remove-Item Env:KB_VM_DURABILITY_SOURCE
  Remove-Item Env:KB_VM_DURABILITY_BENCHMARK
  ```

  Expected: 100 transitions, p99 ≤250 ms, maximum event-loop delay ≤1 s.

- [ ] **[2 min]** Human integrator only; workers do not run this command:

  ```powershell
  git add dashboard/server/control/persistence.test.ts dashboard/server/control/store.durability.vm.test.ts dashboard/server/control/stateFoundation.integration.test.ts dashboard/server/control/store.ts
  git commit -m "feat(control): durably persist deploy-critical state"
  ```

### Task 6: Make bootstrap and tier-zero restore consume the generated schema

**Files:** Modify `deploy/bootstrap_vm.py:21,34-69`; Modify `scripts/backup_tier0.py:392-457`; Modify `tests/test_bootstrap_vm.py:103-163,225-287`; Modify `tests/test_state_backup.py:391-426`; Modify `tests/test_build_platform_release.py:26-60`; Test `tests/test_control_plane_schema.py`; Test generated `deploy/control_plane_schema.py`.

**Interfaces:** Consumes `EMPTY_CONTROL_PLANE` and `assert_control_plane_schema()` from the generated Python module; Produces a schema-v2 canonical seed and one Python schema/version assertion path used by bootstrap and backup while retaining backup's referential checks.

- [ ] **[4 min]** Replace the old seed expectation with the failing generated-contract test:

  ```py
  import json
  from pathlib import Path
  from deploy import bootstrap_vm, control_plane_schema

  def test_seed_uses_generated_current_schema(tmp_path):
      bootstrap_vm.seed_control_plane(tmp_path)
      raw = (tmp_path / "control/control-plane.json").read_bytes()
      assert raw == control_plane_schema.EMPTY_CONTROL_PLANE
      assert json.loads(raw)["version"] == control_plane_schema.CONTROL_PLANE_SCHEMA_VERSION == 2

  def test_seed_collection_set_matches_store_document_contract():
      seeded = json.loads(control_plane_schema.EMPTY_CONTROL_PLANE)
      assert {k for k, v in seeded.items() if isinstance(v, list)} == set(
          control_plane_schema.CONTROL_PLANE_COLLECTIONS
      )

  def test_python_accepts_supported_sparse_v1_before_typescript_migration():
      fixture = Path(__file__).parent / "fixtures/control-plane/v1-sparse-legacy.json"
      assert control_plane_schema.assert_control_plane_schema(
          json.loads(fixture.read_text(encoding="utf-8"))
      )["version"] == 1
  ```

- [ ] **[2 min]** Run red against the still-hardcoded v1 authoring path:

  ```powershell
  python -m pytest -q tests/test_bootstrap_vm.py -k "seed_uses_generated or seed_collection_set"
  ```

  Expected failure: bootstrap writes version 1 and omits `documentRevision`/`deployments`.

- [ ] **[4 min]** In the generated Python validator, mirror the TypeScript migration envelope: v1 requires only the stable core collections and accepts bounded optional legacy/generic arrays; v2 requires the full generated set plus `documentRevision`; future/malformed versions fail. Delete `bootstrap_vm.py:21`'s literal and paste this exact dual-import block at the imports:

  ```py
  try:
      from .control_plane_schema import EMPTY_CONTROL_PLANE, assert_control_plane_schema
  except ImportError:  # direct `python deploy/bootstrap_vm.py` execution
      from control_plane_schema import EMPTY_CONTROL_PLANE, assert_control_plane_schema
  ```

  `seed_control_plane()` writes exact closed v2 `EMPTY_CONTROL_PLANE`. `_validate_control_plane()` duplicate-safe parses then calls the shared validator. Update the non-clobber test to seed a valid generated document before the second bootstrap; invalid existing JSON/schema fails closed.

- [ ] **[4 min]** In `backup_tier0.validate_state_json()`, replace only the duplicate version/container checks at `:410-424` with `assert_control_plane_schema(document)`. Keep the run/stage/attempt referential checks at `:425-455`. Thus Python interprets control schema in exactly one generated module, while backup retains its tier-zero graph gate.

- [ ] **[5 min]** Delete `empty_control_plane_from_store_source()` and the regex mutation test at `test_bootstrap_vm.py:233-287`; replace them with generated-byte equality and collection-parity tests. The TypeScript side from Task 2 compares generated keys to real `StoreDocumentCollections`; the Python side compares the generated seed to the same manifest, making the parity proof transitive rather than self-referential.

- [ ] **[5 min]** Add the exact restore-validator cases below. `write_fixture(target,name)` writes the named JSON fixture to `target/var/lib/kb/state/control/control-plane.json`; the duplicate-key case writes raw bytes and the broken-reference case uses the existing mutation at `test_state_backup.py:420-426`.

  ```py
  CONTROL_FIXTURES = Path(__file__).parent / "fixtures/control-plane"

  def control_path(target: Path) -> Path:
      return target / "var/lib/kb/state/control/control-plane.json"

  def write_fixture(target: Path, name: str) -> None:
      control_path(target).write_bytes((CONTROL_FIXTURES / name).read_bytes())

  @pytest.mark.parametrize("name", ["v1-sparse-legacy.json", "v2-empty.json"])
  def test_restore_accepts_supported_control_schema(tmp_path, name):
      target = valid_restored_tree(tmp_path); write_fixture(target, name)
      assert backup_tier0.validate_state_json(target) is True

  @pytest.mark.parametrize("name", ["future-v3.json", "malformed.json"])
  def test_restore_rejects_unsupported_or_malformed_control_schema(tmp_path, name):
      target = valid_restored_tree(tmp_path); write_fixture(target, name)
      assert backup_tier0.validate_state_json(target) is False

  def test_restore_rejects_duplicate_control_key(tmp_path):
      target = valid_restored_tree(tmp_path)
      control_path(target).write_bytes(b'{"version":2,"version":2}\n')
      assert backup_tier0.validate_state_json(target) is False

  def test_restore_retains_run_stage_attempt_reference_checks(tmp_path):
      target = valid_restored_tree(tmp_path)
      value = json.loads(control_path(target).read_text()); value["runs"] = []
      control_path(target).write_text(json.dumps(value))
      assert backup_tier0.validate_state_json(target) is False
  ```

- [ ] **[3 min]** Extend `release_source()`'s fixture list at `tests/test_build_platform_release.py:26-38` with `deploy/control_plane_schema.py`, and add `assert "deploy/control_plane_schema.py" in names` beside the existing `bootstrap_vm.py` archive assertion at `:56`. This proves bootstrap's generated import ships in the immutable release.

- [ ] **[3 min]** Run Python green and generator drift checks:

  ```powershell
  python scripts/generate_control_plane_schema.py --check
  python -m pytest -q tests/test_control_plane_schema.py tests/test_bootstrap_vm.py tests/test_state_backup.py tests/test_build_platform_release.py
  ```

  Expected: green; generated seed's list-valued key set equals the v2 `StoreDocument` collection set.

- [ ] **[2 min]** Human integrator only; workers do not run this command:

  ```powershell
  git add deploy/bootstrap_vm.py scripts/backup_tier0.py tests/test_bootstrap_vm.py tests/test_state_backup.py tests/test_build_platform_release.py
  git commit -m "feat(deploy): share generated control schema validators"
  ```

### Task 7: Emit registry-derived v2 release metadata without changing activation

**Files:** Modify `scripts/build_platform_release.py:62-85`; Modify only the parser at `scripts/deploy_platform_release.py:13-32` and preserve `deploy()` at `:35-51`; Modify `tests/test_build_platform_release.py:41-73`; Modify `tests/test_deploy_release.py:20-43`; Test generated `deploy/control_plane_schema.py`; Do not modify `deploy/activate_release.py:98-108`.

**Interfaces:** Consumes generated `RELEASE_ATTESTATION_SCHEMA`, `RELEASE_ATTESTATION_KEYS`, `STATE_SCHEMA`, `ROLLBACK_STATE_SCHEMA`, and `STATE_MIGRATION`; Produces exact canonical v2 CI metadata and a compatibility desktop parser that accepts only exact canonical v1 or v2.

- [ ] **[5 min]** Hard prerequisite—run before changing the builder or parser. Require `KB_VM_HOST`, generate a canonical v2 probe from Task 1's checked-in constants, upload it, and invoke the *resident* activator's parser directly:

  ```powershell
  if (-not $env:KB_VM_HOST) { throw 'KB_VM_HOST is required; abort Task 7' }
  $probe = Join-Path ([IO.Path]::GetTempPath()) "kb-attestation-v2-probe-$PID.json"
  $script = Join-Path ([IO.Path]::GetTempPath()) "kb-attestation-v2-probe-$PID.py"
  $remoteDir = "/var/tmp/kb-attestation-v2-probe-$PID"
  python -c 'import json,sys; from pathlib import Path; from deploy.control_plane_schema import RELEASE_ATTESTATION_SCHEMA,STATE_SCHEMA,ROLLBACK_STATE_SCHEMA,STATE_MIGRATION; v={"archive":"kb-platform-"+"b"*40+".tar.gz","schema":RELEASE_ATTESTATION_SCHEMA,"sha256":"c"*64,"sourceCommit":"b"*40,"stateSchema":STATE_SCHEMA,"rollbackStateSchema":ROLLBACK_STATE_SCHEMA,"stateMigration":STATE_MIGRATION,"workflow":"kb-platform-release"}; Path(sys.argv[1]).write_text(json.dumps(v,sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8",newline="")' $probe
  $source = [string]::Join("`n", @(
    'import importlib.util',
    'import pathlib',
    'import sys',
    'path = "/usr/local/lib/kb/activate_release.py"',
    'spec = importlib.util.spec_from_file_location("resident_activate", path)',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'module.parse_attestation(pathlib.Path(sys.argv[1]).read_bytes())',
    'print("V2_OK")'
  )) + "`n"
  [IO.File]::WriteAllText($script, $source, [Text.UTF8Encoding]::new($false))
  try {
    ssh $env:KB_VM_HOST "install -d -m 0700 $remoteDir"
    if ($LASTEXITCODE -ne 0) { throw 'could not create VM probe directory' }
    scp $probe $script "$($env:KB_VM_HOST):$remoteDir/"
    if ($LASTEXITCODE -ne 0) { throw 'could not upload VM probe files' }
    $result = ssh $env:KB_VM_HOST "sudo python3 $remoteDir/$(Split-Path $script -Leaf) $remoteDir/$(Split-Path $probe -Leaf)"
    if ($LASTEXITCODE -ne 0 -or $result.Trim() -ne 'V2_OK') {
      throw 'resident activator did not accept canonical v2; abort Task 7 without editing metadata code'
    }
  } finally {
    ssh $env:KB_VM_HOST "rm -f $remoteDir/$(Split-Path $script -Leaf) $remoteDir/$(Split-Path $probe -Leaf)"
    ssh $env:KB_VM_HOST "rmdir $remoteDir"
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $script -Force -ErrorAction SilentlyContinue
  }
  ```

  Expected: exactly `V2_OK`. Any missing host, upload/import error, nonzero exit, or other output aborts Task 7. Do not “fix” this by editing repo `deploy/activate_release.py`; Phase 0 must update the resident compatibility activator first.

- [ ] **[4 min]** Change the existing builder test first:

  ```py
  def test_release_attestation_uses_registry_metadata(tmp_path):
      source = release_source(tmp_path)
      output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
      attestation = tmp_path / f"kb-platform-{VERSION}.attestation.json"
      build_release(source, VERSION, output, attestation)
      value = json.loads(attestation.read_bytes())
      assert set(value) == {
          "archive", "schema", "sha256", "sourceCommit", "stateSchema",
          "rollbackStateSchema", "stateMigration", "workflow",
      }
      assert value == {
          "archive": output.name, "schema": "kb.release-attestation/v2",
          "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
          "sourceCommit": VERSION, "stateSchema": "2",
          "rollbackStateSchema": "1", "stateMigration": "breaking",
          "workflow": "kb-platform-release",
      }
  ```

- [ ] **[2 min]** Run red:

  ```powershell
  python -m pytest -q tests/test_build_platform_release.py -k registry_metadata
  ```

  Expected failure: the builder still emits the five-key v1 statement.

- [ ] **[4 min]** In `build_platform_release.py`, import the five generated metadata constants and build the statement from them; do not duplicate schema numbers, classification, or key sets. Before writing, assert `set(statement)==set(RELEASE_ATTESTATION_KEYS)`. Keep canonical sorted compact JSON and every existing archive/digest rule unchanged.

- [ ] **[4 min]** Replace the desktop parser's one five-key constant with two closed schemas: canonical v1 has exactly the historical five keys; canonical v2 has exactly the generated eight keys and additionally requires decimal strings for both schema fields, `stateMigration in {'compatible','breaking'}`, and values equal the generated current aggregate. Any mixed/extra/missing key set fails. This is compatibility parsing in the existing shipper, not one-click selection or activation behavior.

- [ ] **[5 min]** Keep the existing `canonical_attestation(commit,digest)->bytes` at `tests/test_deploy_release.py:25-33` unchanged so its existing callers retain the v1 fixture contract. Add generated imports, a local commit constant, and a separate digest-correct pair helper after `write_release_archive()` (`:36-43`):

  ```py
  from deploy.control_plane_schema import (
      RELEASE_ATTESTATION_KEYS,
      RELEASE_ATTESTATION_SCHEMA,
      ROLLBACK_STATE_SCHEMA,
      STATE_MIGRATION,
      STATE_SCHEMA,
  )

  TEST_RELEASE_COMMIT = "d" * 40

  def canonical_attestation_pair(tmp_path: Path, schema_version: int) -> tuple[Path, Path]:
      archive = tmp_path / f"kb-platform-{TEST_RELEASE_COMMIT}.tar.gz"
      write_release_archive(archive, TEST_RELEASE_COMMIT)
      digest = hashlib.sha256(archive.read_bytes()).hexdigest()
      attestation = tmp_path / "attestation.json"
      if schema_version == 1:
          attestation.write_bytes(canonical_attestation(TEST_RELEASE_COMMIT, digest))
      elif schema_version == 2:
          value = {
              "archive": archive.name,
              "schema": RELEASE_ATTESTATION_SCHEMA,
              "sha256": digest,
              "sourceCommit": TEST_RELEASE_COMMIT,
              "stateSchema": STATE_SCHEMA,
              "rollbackStateSchema": ROLLBACK_STATE_SCHEMA,
              "stateMigration": STATE_MIGRATION,
              "workflow": "kb-platform-release",
          }
          attestation.write_bytes(
              (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
          )
      else:
          raise ValueError("schema_version must be 1 or 2")
      return archive, attestation

  def rewrite_attestation(path: Path, mutate) -> None:
      value = json.loads(path.read_bytes())
      mutate(value)
      path.write_bytes((json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode())
  ```

- [ ] **[5 min]** Add these exact module-qualified parser cases:

  ```py
  def test_desktop_parser_accepts_exact_v1_and_v2(tmp_path):
      for schema_version in (1, 2):
          archive, attestation = canonical_attestation_pair(tmp_path, schema_version)
          assert deploy_platform_release.parse_local_attestation(
              attestation, archive
          )["sourceCommit"] == TEST_RELEASE_COMMIT

  @pytest.mark.parametrize("missing", sorted(RELEASE_ATTESTATION_KEYS))
  def test_desktop_parser_rejects_each_missing_v2_key(tmp_path, missing):
      archive, attestation = canonical_attestation_pair(tmp_path, 2)
      rewrite_attestation(attestation, lambda value: value.pop(missing))
      with pytest.raises(RuntimeError, match="closed canonical"):
          deploy_platform_release.parse_local_attestation(attestation, archive)

  def test_desktop_parser_rejects_extra_or_noncanonical_v2(tmp_path):
      archive, attestation = canonical_attestation_pair(tmp_path, 2)
      rewrite_attestation(attestation, lambda value: value.update(extra="x"))
      with pytest.raises(RuntimeError, match="closed canonical"):
          deploy_platform_release.parse_local_attestation(attestation, archive)
      archive, attestation = canonical_attestation_pair(tmp_path, 2)
      attestation.write_text(json.dumps(json.loads(attestation.read_text()), indent=2))
      with pytest.raises(RuntimeError, match="closed canonical"):
          deploy_platform_release.parse_local_attestation(attestation, archive)

  @pytest.mark.parametrize(("field","value"), [
      ("stateSchema","02"), ("rollbackStateSchema","1.0"),
      ("stateMigration","compatible"),
  ])
  def test_desktop_parser_rejects_noncanonical_or_nonregistry_v2_values(tmp_path, field, value):
      archive, attestation = canonical_attestation_pair(tmp_path, 2)
      rewrite_attestation(attestation, lambda body: body.__setitem__(field, value))
      with pytest.raises(RuntimeError, match="attestation"):
          deploy_platform_release.parse_local_attestation(attestation, archive)
  ```

  `rewrite_attestation()` always rewrites sorted compact JSON plus one newline, so these tests isolate schema rejection from byte-canonicality. Keep activator tests unchanged.

- [ ] **[3 min]** Verify metadata and compatibility:

  ```powershell
  python scripts/generate_control_plane_schema.py --check
  python -m pytest -q tests/test_build_platform_release.py tests/test_deploy_release.py tests/test_control_plane_schema.py
  git diff --exit-code origin/main -- deploy/activate_release.py
  ```

  Expected: exact v2 builder output, exact v1/v2 desktop acceptance, green generator drift check, and no activator diff.

- [ ] **[2 min]** Human integrator only; workers do not run this command:

  ```powershell
  git add scripts/build_platform_release.py scripts/deploy_platform_release.py tests/test_build_platform_release.py tests/test_deploy_release.py
  git commit -m "feat(release): attest registry-derived state schema"
  ```

#### Final Phase-1 verification

- [ ] **[3 min]** Confirm the focused suites jointly cover every allowed/refused Deployment edge, exact CAS replay/conflict, one-nonterminal rule, `documentRevision +1` per committed mutation, journal phase/digest matrix, lifecycle predicate/projection matrix, paused normalization, and one critical save per migration/deployment mutation. Do not construct a fence, admission lease, BootReport, rehydrator, `/api/v1` route, or activator call.

- [ ] **[3 min]** Run all focused Phase-1 suites:

  ```powershell
  npm --prefix dashboard test -- server/control/migrations.test.ts server/control/runLifecycle.test.ts server/control/deploymentTransitions.test.ts server/control/writerLease.test.ts server/control/persistence.test.ts server/control/stateFoundation.integration.test.ts server/release/activationJournal.test.ts
  python -m pytest -q tests/test_control_plane_schema.py tests/test_bootstrap_vm.py tests/test_state_backup.py tests/test_build_platform_release.py tests/test_deploy_release.py
  python scripts/generate_control_plane_schema.py --check
  ```

  Expected: green.

- [ ] **[4 min]** Run the existing broad suites that the type-breaking rename can affect:

  ```powershell
  npm --prefix dashboard run typecheck
  npm --prefix dashboard test
  npm --prefix dashboard run build
  python -m pytest -q --ignore=atlas
  ```

  Expected: all commands exit 0.

- [ ] **[3 min]** Enforce the Phase-1-only diff:

  ```powershell
  $changed = @((git diff --name-only origin/main), (git ls-files --others --exclude-standard)) | Where-Object { $_ }
  $forbidden = $changed | Select-String -Pattern '(^deploy/activate_release\.py$|rehydrate\.ts$|approvals/|deploy_green_platform\.py$|assets/|credential-registry)'
  if ($forbidden) { $forbidden; throw 'later-phase behavior entered Phase 1' }
  $behavior = git diff origin/main -- dashboard/server/control/execution.ts dashboard/server/control/queueBridge.ts | Select-String -Pattern 'requestPause|parkRunIfEligible|AdmissionLease|stopAndDrain|rehydrate'
  if ($behavior) { $behavior; throw 'lifecycle-only engine edits gained later-phase behavior' }
  rg -n '/api/v1|requestPause|parkRunIfEligible|rehydratePausedRuns' dashboard/server deploy scripts
  ```

  Expected: neither PowerShell guard throws. The final search finds only pre-existing text or tests explicitly asserting absence; inspect every hit.

- [ ] **[2 min]** Self-review the mapping: Task 1 = generated manifest/constants; Task 2 = critical-save seam/envelope/registry/four legacy transforms/lifecycle; Task 3 = Deployment+journal/CAS/transition matrix; Task 4 = entrypoint lease/modes/sidecar; Task 5 = coalesced durability/latency/integration proof; Task 6 = generated Python seed/backup/parity; Task 7 = mechanically aggregated v2 metadata with the activator untouched. Confirm every §8 Phase-1 noun appears once and no later-phase implementation appears.
