// P6 W6.1 §6 — POST /api/v1/runs/:runRef/reports. Node auth; append-only started|event|gate-opened|
// completed|failed; sequence-pinned (no Idempotency-Key [P6-C69]); CANNOT respond to or resolve a human
// gate — the report decoder's exact-key wall rejects a decision-shaped field before any store write.
import { describe, expect, it } from 'vitest';
import { nodeApp, nodeCtx, nodeHeaders, lease } from './_nodeHarness.ts';
import type { ReportStorePort, RunTerminalState } from '../../placement/reportService.ts';

function store(over: Partial<ReportStorePort> = {}): ReportStorePort {
  const noTerminal: RunTerminalState = { terminalOutcome: null, completedAt: null };
  return {
    async getLease() { return lease(); },
    async getRunTerminalState() { return noTerminal; },
    async currentAdvertisedCapabilityHash() { return undefined; },
    async appendReportEvent() { /* record */ },
    async bumpLeaseSequence() { /* record */ },
    async markTerminal() { /* record */ },
    async openHumanRequest() { return { requestRef: 'hr-1' }; },
    ...over,
  };
}

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { expectedLeaseRevision: 1, sequence: 1, kind: 'started', payload: {}, ...over };
}

describe('POST /api/v1/runs/:runRef/reports', () => {
  it('200 kind:report on an in-order append', async () => {
    const res = await nodeApp(nodeCtx({ v1: { reportStore: store() } })).inject({ method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(), payload: body() });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).kind).toBe('report');
  });

  it('gate-opened returns the opened requestRef', async () => {
    const res = await nodeApp(nodeCtx({ v1: { reportStore: store() } })).inject({ method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(), payload: body({ kind: 'gate-opened' }) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.requestRef).toBe('hr-1');
  });

  it('409 report-out-of-order on a sequence gap', async () => {
    const res = await nodeApp(nodeCtx({ v1: { reportStore: store() } })).inject({ method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(), payload: body({ sequence: 5, kind: 'event' }) });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('report-out-of-order');
  });

  it('409 run-already-terminal on a duplicate completion', async () => {
    const ctx = nodeCtx({ v1: { reportStore: store({ async getRunTerminalState() { return { terminalOutcome: 'ok', completedAt: '2026-08-25T00:00:00.000Z' }; } }) } });
    const res = await nodeApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(), payload: body({ kind: 'completed' }) });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('run-already-terminal');
  });

  it('403 wrong-host when the lease belongs to another host', async () => {
    const ctx = nodeCtx({ v1: { reportStore: store({ async getLease() { return lease({ hostId: 'desktop' }); } }) } });
    const res = await nodeApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders('nodeVM01'), payload: body() });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('wrong-host');
  });

  it('SECURITY: 400 unknown-key rejects a decision-shaped payload before any store write (cannot resolve a gate)', async () => {
    const res = await nodeApp(nodeCtx({ v1: { reportStore: store() } })).inject({ method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(), payload: body({ kind: 'event', payload: { decision: 'approve' } }) });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('unknown-key');
  });

  it('SECURITY: 400 unknown-key rejects a top-level expectedRequestRevision (a T3 assertion shape)', async () => {
    const res = await nodeApp(nodeCtx({ v1: { reportStore: store() } })).inject({ method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(), payload: body({ expectedRequestRevision: 2 }) });
    expect(res.statusCode).toBe(400);
  });
});
