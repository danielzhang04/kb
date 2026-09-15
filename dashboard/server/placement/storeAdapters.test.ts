// Unit 1 of the v1 desktop-execution lane. These run against the REAL file-backed control store —
// not a fake — because the whole point of the unit is that `LeaseStorePort`/`ReportStorePort` finally
// have a production binding: a test that mocked the store would prove nothing about the CAS, the
// lazy-expiry pass, or the `interrupted` hold.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createExistingRootFileStoreHarnessForTest } from '../control/test-fixtures/controlStore.ts';
import type { ControlPlaneStore } from '../control/storeTypes.ts';
import { claimLease, renewLease } from './leaseService.ts';
import type { ClaimClock } from './leaseService.ts';
import { submitReport } from './reportService.ts';
import { LEASE_TTL_MS } from './contracts.ts';
import type { HostKind } from './contracts.ts';
import { createLeaseStoreAdapter, createReportStoreAdapter } from './storeAdapters.ts';

const roots: string[] = [];
const harness = createExistingRootFileStoreHarnessForTest();
/** The store refuses a document whose runs contradict the booted host, so follow the platform. */
const HOST: HostKind = process.platform === 'win32' ? 'desktop' : 'vm';
const T0 = Date.parse('2026-09-15T12:00:00.000Z');

afterAll(() => {
  harness.close();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface SeedRun {
  runRef: string;
  createdAt?: string;
  /** Defaults to `planned`: a `running` row is crash-normalized to `interrupted` at store open. */
  state?: 'planned' | 'running';
  terminalOutcome?: 'ok' | null;
  /** An attempt in this state is seeded against the run (baseline §6's unreconciled hold). */
  attemptState?: 'running' | 'interrupted';
}

function seed(name: string, runs: readonly SeedRun[]): ControlPlaneStore {
  const root = mkdtempSync(join(tmpdir(), `store-adapters-${name}-`));
  roots.push(root);
  const path = join(root, 'control', 'control-plane.json');
  mkdirSync(dirname(path), { recursive: true });
  const document = {
    version: 4,
    documentRevision: 0,
    nextEventCursor: 1,
    scheduleCollectionRevision: 0,
    proposals: [],
    runs: runs.map((run) => ({
      subject: 'dashboard-engine',
      runRef: run.runRef,
      predecessorRunRef: null,
      title: `Run ${run.runRef}`,
      proposalRef: 'proposal-1',
      proposalRevision: 1,
      proposalHash: 'a'.repeat(64),
      publicationState: 'published',
      lifecycle: { kind: run.state ?? 'planned', deployPause: null },
      version: 1,
      managerSessionRef: `session-${run.runRef}`,
      managerGeneration: 1,
      managerAssignment: null,
      agentWorkspaceLaunch: null,
      activationReceipts: [],
      authorizedFailedRunReconciliation: null,
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: HOST,
      terminalOutcome: run.terminalOutcome ?? null,
      completedAt: run.terminalOutcome ? new Date(T0).toISOString() : null,
      archivedFrom: null,
      createdAt: run.createdAt ?? new Date(T0).toISOString(),
      updatedAt: run.createdAt ?? new Date(T0).toISOString(),
    })),
    stages: [],
    attempts: runs.filter((run) => run.attemptState).map((run) => ({
      subject: 'dashboard-engine',
      attemptRef: `attempt-${run.runRef}`,
      runRef: run.runRef,
      stageRef: `stage-${run.runRef}`,
      generation: 1,
      predecessorAttemptRef: null,
      runtime: 'claude',
      model: 'sonnet',
      state: run.attemptState,
      version: 1,
      managedSessionRef: null,
      logicalGeneration: null,
      baseGenerationRef: null,
      baseCommit: null,
      createdAt: new Date(T0).toISOString(),
      updatedAt: new Date(T0).toISOString(),
    })),
    sessions: [],
    humanRequests: [],
    events: [],
    stageGenerations: [],
    iterationLoops: [],
    iterationRequests: [],
    iterationReceipts: [],
    generationSupersessions: [],
    quarantine: [],
    deployments: [],
    schedules: [],
    scheduleTombstones: [],
    scheduleOccurrenceClaims: [],
    scheduleSeedImports: [],
    hostAdvertisements: [],
    placementLeases: [],
    v1Idempotency: [],
  };
  writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
  const store = harness.open(root);
  advertise(store, T0);
  return store;
}

/** A fresh beat for HOST at `nowMs` — `selectCandidate` refuses a host that is not advertising. */
function advertise(store: ControlPlaneStore, nowMs: number, gpu = true): void {
  store.seedHostAdvertisementForTest({
    hostId: HOST,
    daemonVersion: '1.0.0',
    reportedAt: new Date(nowMs).toISOString(),
    connectors: [],
    skills: [],
    filesystemRoots: [],
    pty: true,
    gpu,
    clis: { claude: 'ready', codex: 'ready' },
    version: 1,
  });
}

/** A `ClaimClock` pinned to one instant: every claim below is single-pass, never a real long poll. */
function clockAt(nowMs: number): ClaimClock {
  return { now: () => nowMs, sleep: async () => {} };
}

const iso = (ms: number) => new Date(ms).toISOString();

describe('placement store adapters — the production LeaseStorePort binding', () => {
  it('claims the oldest eligible run for the advertising host and mints revision 1', async () => {
    const store = seed('claim', [
      { runRef: 'run-late', createdAt: iso(T0 + 5_000) },
      { runRef: 'run-early', createdAt: iso(T0) },
    ]);
    const port = createLeaseStoreAdapter(store, { now: () => T0 });

    const outcome = await claimLease(port, { hostId: HOST, waitMs: 0 }, clockAt(T0));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lease.runRef).toBe('run-early');
    expect(outcome.lease.hostId).toBe(HOST);
    expect(outcome.lease.revision).toBe(1);
    expect(outcome.lease.lastReportSequence).toBe(0);
    expect(Date.parse(outcome.lease.expiresAt)).toBe(T0 + LEASE_TTL_MS);
    // Persisted, not in-memory: the row is readable back through the store.
    expect(store.getPlacementLease('run-early')?.revision).toBe(1);
  });

  it('refuses a second claim of a run that is already leased (one row per runRef)', async () => {
    const store = seed('one-row', [{ runRef: 'run-1' }]);
    const port = createLeaseStoreAdapter(store, { now: () => T0 });

    const first = await claimLease(port, { hostId: HOST, waitMs: 0 }, clockAt(T0));
    expect(first.ok).toBe(true);
    // The only run is now leased, so the next claim finds no candidate and times out 204.
    const second = await claimLease(port, { hostId: HOST, waitMs: 0 }, clockAt(T0 + 1_000));
    expect(second).toEqual({ ok: false, status: 204 });
    expect(store.releaseExpiredPlacementLeases(T0 + 1_000)).toEqual([]);
  });

  it('renews on the CURRENT revision and refuses a stale one without touching the row', async () => {
    const store = seed('renew', [{ runRef: 'run-1' }]);
    const port = createLeaseStoreAdapter(store, { now: () => T0 });
    const claimed = await claimLease(port, { hostId: HOST, waitMs: 0 }, clockAt(T0));
    expect(claimed.ok).toBe(true);

    const renewed = await renewLease(port, { runRef: 'run-1', hostId: HOST, expectedLeaseRevision: 1 }, iso(T0 + 1_000));
    expect(renewed).toMatchObject({ ok: true });
    if (!renewed.ok) return;
    expect(renewed.lease.revision).toBe(2);
    expect(Date.parse(renewed.lease.expiresAt)).toBe(T0 + 1_000 + LEASE_TTL_MS);

    // The reporter bug baseline §1 names: renewing on the ORIGINAL revision after it moved on.
    const stale = await renewLease(port, { runRef: 'run-1', hostId: HOST, expectedLeaseRevision: 1 }, iso(T0 + 2_000));
    expect(stale).toEqual({ ok: false, status: 409, code: 'lease-expired' });
    expect(store.getPlacementLease('run-1')?.revision).toBe(2);
  });

  it('refuses a renew under another host identity — lease theft is 403, not a CAS race', async () => {
    const store = seed('wrong-host', [{ runRef: 'run-1' }]);
    const port = createLeaseStoreAdapter(store, { now: () => T0 });
    await claimLease(port, { hostId: HOST, waitMs: 0 }, clockAt(T0));

    const other: HostKind = HOST === 'vm' ? 'desktop' : 'vm';
    const stolen = await renewLease(port, { runRef: 'run-1', hostId: other, expectedLeaseRevision: 1 }, iso(T0 + 1_000));

    expect(stolen).toEqual({ ok: false, status: 403, code: 'wrong-host' });
    expect(store.getPlacementLease('run-1')?.hostId).toBe(HOST);
  });

  it('reclaims an expired lease inside the very claim that re-places the run', async () => {
    const store = seed('expiry', [{ runRef: 'run-1' }]);
    const port = createLeaseStoreAdapter(store, { now: () => T0 });
    const first = await claimLease(port, { hostId: HOST, waitMs: 0 }, clockAt(T0));
    expect(first.ok).toBe(true);

    const afterTtl = T0 + LEASE_TTL_MS + 1;
    advertise(store, afterTtl); // the host is still beating; only the lease aged out
    const reclaimPort = createLeaseStoreAdapter(store, { now: () => afterTtl });
    const second = await claimLease(reclaimPort, { hostId: HOST, waitMs: 0 }, clockAt(afterTtl));

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.lease.runRef).toBe('run-1');
    expect(second.lease.revision).toBe(1); // a fresh lease, not a resurrected one
    // And the renew of the DEAD lease is refused rather than resurrecting it.
    const dead = await renewLease(reclaimPort, { runRef: 'run-1', hostId: HOST, expectedLeaseRevision: 1 }, iso(afterTtl));
    expect(dead).toMatchObject({ ok: true }); // same revision number, but it is the NEW lease's CAS
    expect(store.getPlacementLease('run-1')?.revision).toBe(2);
  });

  it('never re-places a run holding an unreconciled interrupted attempt, even after expiry', async () => {
    const store = seed('interrupted', [
      { runRef: 'run-unknown', attemptState: 'interrupted' },
      { runRef: 'run-clean', createdAt: iso(T0 + 1_000) },
    ]);
    const port = createLeaseStoreAdapter(store, { now: () => T0 });

    // `run-unknown` is older, so ordering alone would hand it back; the §6 hold skips it.
    const outcome = await claimLease(port, { hostId: HOST, waitMs: 0 }, clockAt(T0));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lease.runRef).toBe('run-clean');
    // While the clean run holds its lease the host is handed nothing else — the interrupted run is
    // NOT the fallback.
    expect(store.selectPlacementCandidateRunRef(HOST, T0 + 1_000)).toBeUndefined();
    // And once that lease expires the clean run is reclaimable, but the interrupted one still is not.
    expect(store.selectPlacementCandidateRunRef(HOST, T0 + LEASE_TTL_MS + 1)).toBe('run-clean');
  });

  it('hands out nothing at all while the host has no fresh advertisement', async () => {
    const store = seed('stale-host', [{ runRef: 'run-1' }]);
    const port = createLeaseStoreAdapter(store, { now: () => T0 });
    const stale = T0 + 10 * 60_000; // far past ADVERTISEMENT_FRESHNESS_MS

    const outcome = await claimLease(port, { hostId: HOST, waitMs: 0 }, clockAt(stale));

    expect(outcome).toEqual({ ok: false, status: 204 });
    expect(store.getPlacementLease('run-1')).toBeUndefined();
    // The run itself is still eligible — it is the HOST that is not.
    expect(store.selectPlacementCandidateRunRef(HOST, stale)).toBe('run-1');
  });

  it('refuses a renew once the host re-advertises a different capability set', async () => {
    const store = seed('capability', [{ runRef: 'run-1' }]);
    const port = createLeaseStoreAdapter(store, { now: () => T0 });
    await claimLease(port, { hostId: HOST, waitMs: 0 }, clockAt(T0));

    advertise(store, T0 + 1_000, /* gpu */ false);
    const later = createLeaseStoreAdapter(store, { now: () => T0 + 1_000 });
    const lost = await renewLease(later, { runRef: 'run-1', hostId: HOST, expectedLeaseRevision: 1 }, iso(T0 + 1_000));

    expect(lost).toEqual({ ok: false, status: 409, code: 'capability-lost' });
    expect(store.getPlacementLease('run-1')?.revision).toBe(1);
  });
});

describe('placement store adapters — the production ReportStorePort binding', () => {
  async function leased(name: string) {
    const store = seed(name, [{ runRef: 'run-1' }]);
    const leasePort = createLeaseStoreAdapter(store, { now: () => T0 });
    const claimed = await claimLease(leasePort, { hostId: HOST, waitMs: 0 }, clockAt(T0));
    if (!claimed.ok) throw new Error('fixture claim failed');
    return { store, reportPort: createReportStoreAdapter(store, { now: () => T0 }), lease: claimed.lease };
  }

  it('appends a report as a worker event under the RUN’s subject and advances the lease sequence', async () => {
    const { store, reportPort } = await leased('report-append');

    const outcome = await submitReport(reportPort, {
      runRef: 'run-1',
      hostId: HOST,
      nowIso: iso(T0 + 1_000),
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'started', payload: { summary: 'desktop attempt up' } },
    });

    expect(outcome).toEqual({ ok: true });
    expect(store.getPlacementLease('run-1')?.lastReportSequence).toBe(1);
    const events = store.listEvents('dashboard-engine', 'run-1');
    expect(events.ok).toBe(true);
    if (!events.ok) return;
    expect(events.value).toHaveLength(1);
    expect(events.value[0]).toMatchObject({
      kind: 'lifecycle', source: 'worker', status: 'running', summary: 'host report started #1: desktop attempt up',
    });
  });

  it('refuses an out-of-sequence report with no store write at all', async () => {
    const { store, reportPort } = await leased('report-sequence');

    const outcome = await submitReport(reportPort, {
      runRef: 'run-1',
      hostId: HOST,
      nowIso: iso(T0 + 1_000),
      body: { expectedLeaseRevision: 1, sequence: 2, kind: 'event', payload: {} },
    });

    expect(outcome).toEqual({ ok: false, status: 409, code: 'report-out-of-order' });
    expect(store.getPlacementLease('run-1')?.lastReportSequence).toBe(0);
    const events = store.listEvents('dashboard-engine', 'run-1');
    expect(events.ok && events.value).toEqual([]);
  });

  it('refuses a report pinned to a superseded lease revision', async () => {
    const { store, reportPort } = await leased('report-revision');
    const leasePort = createLeaseStoreAdapter(store, { now: () => T0 });
    await renewLease(leasePort, { runRef: 'run-1', hostId: HOST, expectedLeaseRevision: 1 }, iso(T0 + 1_000));

    const outcome = await submitReport(reportPort, {
      runRef: 'run-1',
      hostId: HOST,
      nowIso: iso(T0 + 2_000),
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: {} },
    });

    expect(outcome).toEqual({ ok: false, status: 409, code: 'lease-expired' });
    expect(store.getPlacementLease('run-1')?.lastReportSequence).toBe(0);
  });

  it('refuses another host’s report on this lease', async () => {
    const { store, reportPort } = await leased('report-wrong-host');
    const other: HostKind = HOST === 'vm' ? 'desktop' : 'vm';

    const outcome = await submitReport(reportPort, {
      runRef: 'run-1',
      hostId: other,
      nowIso: iso(T0 + 1_000),
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: {} },
    });

    expect(outcome).toEqual({ ok: false, status: 403, code: 'wrong-host' });
    expect(store.getPlacementLease('run-1')?.lastReportSequence).toBe(0);
  });

  it('opens a real human request through the run’s own subject, and cannot resolve one', async () => {
    const { store, reportPort } = await leased('report-gate');

    const outcome = await submitReport(reportPort, {
      runRef: 'run-1',
      hostId: HOST,
      nowIso: iso(T0 + 1_000),
      body: {
        expectedLeaseRevision: 1,
        sequence: 1,
        kind: 'gate-opened',
        payload: { gateRequestKind: 'approval', title: 'Approve the desktop write', prompt: 'ok?' },
      },
    });

    expect(outcome).toMatchObject({ ok: true });
    if (!('requestRef' in outcome) || outcome.requestRef === undefined) throw new Error('no requestRef');
    const request = store.getHumanRequest('dashboard-engine', outcome.requestRef);
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(request.value).toMatchObject({ kind: 'approval', title: 'Approve the desktop write', state: 'open' });
    // §3.6: the port a report reaches carries no resolver — closing a gate is the operator's alone.
    expect(Object.keys(reportPort)).not.toContain('respondHumanRequest');
  });

  it('marks the run terminal through the ordinary lifecycle transition, then refuses every later report', async () => {
    const { store, reportPort } = await leased('report-terminal');

    const first = await submitReport(reportPort, {
      runRef: 'run-1',
      hostId: HOST,
      nowIso: iso(T0 + 1_000),
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'completed', payload: {} },
    });
    expect(first).toEqual({ ok: true });

    const run = store.getRun('dashboard-engine', 'run-1');
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.run.lifecycle.kind).toBe('succeeded');
    expect(run.value.run.terminalOutcome).toBe('ok');

    const second = await submitReport(reportPort, {
      runRef: 'run-1',
      hostId: HOST,
      nowIso: iso(T0 + 2_000),
      body: { expectedLeaseRevision: 1, sequence: 2, kind: 'event', payload: {} },
    });
    expect(second).toMatchObject({ ok: false, status: 409, code: 'run-already-terminal', terminalOutcome: 'ok' });
  });
});
