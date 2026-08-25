import { describe, expect, it } from 'vitest';
import type { PlacementLease } from './contracts.ts';
import { submitReport } from './reportService.ts';
import type { ReportStorePort, RunTerminalState } from './reportService.ts';

const HASH_A = 'a'.repeat(64);
const NOW = '2026-08-25T00:00:00.000Z';
const NOT_EXPIRED = '2026-08-25T00:01:00.000Z';

function baseLease(overrides: Partial<PlacementLease> = {}): PlacementLease {
  return {
    runRef: 'run-1', hostId: 'desktop', capabilityHash: HASH_A, revision: 1,
    expiresAt: NOT_EXPIRED, lastReportSequence: 0, ...overrides,
  };
}

function fakePort(opts: {
  lease?: PlacementLease | undefined;
  terminal?: RunTerminalState;
  advertisedHash?: string | undefined;
} = {}): ReportStorePort & {
  events: Array<{ kind: string; sequence: number; payload: Record<string, unknown> }>;
  humanRequestsOpened: number;
  terminalCalls: number;
} {
  let lease = 'lease' in opts ? opts.lease : baseLease();
  let terminal: RunTerminalState = opts.terminal ?? { terminalOutcome: null, completedAt: null };
  const events: Array<{ kind: string; sequence: number; payload: Record<string, unknown> }> = [];
  let humanRequestsOpened = 0;
  let terminalCalls = 0;
  const port = {
    events,
    get humanRequestsOpened() { return humanRequestsOpened; },
    get terminalCalls() { return terminalCalls; },
    async getLease() { return lease; },
    async getRunTerminalState() { return terminal; },
    async currentAdvertisedCapabilityHash() { return opts.advertisedHash ?? HASH_A; },
    async appendReportEvent(_runRef: string, kind: string, payload: Record<string, unknown>, sequence: number) {
      events.push({ kind, sequence, payload });
    },
    async bumpLeaseSequence(_runRef: string, sequence: number) {
      if (lease) lease = { ...lease, lastReportSequence: sequence };
    },
    async markTerminal(_runRef: string, outcome: 'ok' | 'failed', completedAt: string) {
      terminalCalls += 1;
      terminal = { terminalOutcome: outcome, completedAt };
    },
    async openHumanRequest() {
      humanRequestsOpened += 1;
      return { requestRef: 'req-1' };
    },
  };
  return port as unknown as ReportStorePort & {
    events: typeof events; humanRequestsOpened: number; terminalCalls: number;
  };
}

describe('submitReport sequencing (§3.5)', () => {
  it('accepts sequence === lastReportSequence + 1', async () => {
    const port = fakePort();
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'started', payload: {} },
    });
    expect(result).toEqual({ ok: true });
    expect(port.events).toEqual([{ kind: 'started', sequence: 1, payload: {} }]);
  });

  it('refuses 409 report-out-of-order and makes NO state change when sequence is wrong', async () => {
    const port = fakePort();
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 5, kind: 'event', payload: {} },
    });
    expect(result).toEqual({ ok: false, status: 409, code: 'report-out-of-order' });
    expect(port.events).toEqual([]);
    expect(port.terminalCalls).toBe(0);
  });
});

describe('submitReport host/lease refusals (§3.5)', () => {
  it('refuses 403 wrong-host under another node\'s identity', async () => {
    const port = fakePort({ lease: baseLease({ hostId: 'vm' }) });
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: {} },
    });
    expect(result).toEqual({ ok: false, status: 403, code: 'wrong-host' });
  });

  it('refuses 409 lease-expired past expiresAt', async () => {
    const port = fakePort({ lease: baseLease({ expiresAt: '2026-08-24T23:00:00.000Z' }) });
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: {} },
    });
    expect(result).toEqual({ ok: false, status: 409, code: 'lease-expired' });
  });

  it('refuses 409 lease-expired when no lease exists at all', async () => {
    const port = fakePort({ lease: undefined });
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: {} },
    });
    expect(result).toEqual({ ok: false, status: 409, code: 'lease-expired' });
  });

  it('refuses 409 capability-lost when the advertisement no longer matches capabilityHash', async () => {
    const port = fakePort({ advertisedHash: 'b'.repeat(64) });
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: {} },
    });
    expect(result).toEqual({ ok: false, status: 409, code: 'capability-lost' });
  });
});

describe('submitReport terminal idempotency (§3.5, design:635 duplicate completion)', () => {
  it('a second completed/failed on an already-terminal run is 409 run-already-terminal, UNTOUCHED', async () => {
    const port = fakePort({ terminal: { terminalOutcome: 'ok', completedAt: '2026-08-24T22:00:00.000Z' } });
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'completed', payload: {} },
    });
    expect(result).toEqual({
      ok: false, status: 409, code: 'run-already-terminal',
      terminalOutcome: 'ok', completedAt: '2026-08-24T22:00:00.000Z',
    });
    expect(port.terminalCalls).toBe(0);
    expect(port.events).toEqual([]);
  });

  it('completed marks the run terminal exactly once', async () => {
    const port = fakePort();
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'completed', payload: {} },
    });
    expect(result).toEqual({ ok: true });
    expect(port.terminalCalls).toBe(1);
  });

  it('failed marks the run terminal with outcome failed', async () => {
    const port = fakePort();
    await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'failed', payload: {} },
    });
    expect(port.terminalCalls).toBe(1);
  });
});

describe('submitReport gate-opened (§3.5, §3.6 T3 host ban)', () => {
  it('opens a HumanRequest and the store port carries no method that could resolve one', async () => {
    const port = fakePort();
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'gate-opened', payload: { title: 'Review this' } },
    });
    expect(result).toEqual({ ok: true, requestRef: 'req-1' });
    expect(port.humanRequestsOpened).toBe(1);
    // Structural proof, not just behavioural: the port type has no respond/resolve method at all.
    expect((port as unknown as Record<string, unknown>).respondHumanRequest).toBeUndefined();
    expect((port as unknown as Record<string, unknown>).resolveHumanRequest).toBeUndefined();
  });

  it('never calls openHumanRequest for a non-gate report kind', async () => {
    const port = fakePort();
    await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: {} },
    });
    expect(port.humanRequestsOpened).toBe(0);
  });

  it('rejects a defined-but-invalid gateRequestKind as a clean 400 with NO port write (W5b fix #2)', async () => {
    const port = fakePort();
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'gate-opened', payload: { gateRequestKind: 'bogus' } },
    });
    expect(result).toEqual({ ok: false, status: 400, code: 'unknown-key', field: 'payload.gateRequestKind' });
    expect(port.events).toEqual([]);
    expect(port.humanRequestsOpened).toBe(0);
    expect(port.terminalCalls).toBe(0);
  });
});

describe('submitReport exact-key wall (§3.5, §3.6 T3 host ban)', () => {
  it('rejects a payload carrying a decision field before any store write', async () => {
    const port = fakePort();
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: { decision: 'approve' } },
    });
    expect(result).toEqual({ ok: false, status: 400, code: 'unknown-key', field: 'payload' });
    expect(port.events).toEqual([]);
  });

  it('rejects a payload carrying expectedRequestRevision before any store write', async () => {
    const port = fakePort();
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: { expectedRequestRevision: 3 } },
    });
    expect(result).toEqual({ ok: false, status: 400, code: 'unknown-key', field: 'payload' });
    expect(port.events).toEqual([]);
  });

  it('rejects a payload carrying an assertion field before any store write', async () => {
    const port = fakePort();
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: { assertion: {} } },
    });
    expect(result).toEqual({ ok: false, status: 400, code: 'unknown-key', field: 'payload' });
    expect(port.events).toEqual([]);
  });

  it('rejects a top-level unknown key before any store write', async () => {
    const port = fakePort();
    const result = await submitReport(port, {
      runRef: 'run-1', hostId: 'desktop', nowIso: NOW,
      body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: {}, extra: true },
    });
    expect(result.ok).toBe(false);
    expect((result as { status: number }).status).toBe(400);
    expect(port.events).toEqual([]);
  });
});
