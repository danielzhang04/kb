import { describe, expect, it } from 'vitest';
import {
  P6_SCENARIOS, ScenarioUsageError, parseScenarioArgs, runScenario, runScenarios,
  type CallFn, type CallResult, type P6ScenarioId, type ScenarioOutcome, type ScenarioRequest,
} from './p6TwoDaemonScenarios.ts';

/** A stateful fake of the two daemons, faithful enough for the scenario assertions. `desktop` GETs read
 *  the SAME run state the vm holds — the fixture's stand-in for the read proxy forwarding to the vm. */
function fakeDaemons(): { call: CallFn; state: { runs: Map<string, { host: string; events: unknown[]; gates: unknown[]; leased: boolean }> } } {
  const runs = new Map<string, { host: string; events: unknown[]; gates: unknown[]; leased: boolean }>();
  const call: CallFn = async (target, req: ScenarioRequest): Promise<CallResult> => {
    const ok = (data: unknown): CallResult => ({ status: 200, body: { apiVersion: 'v1', data } });
    if (req.path === '/fixture/advertise-seed') return { status: 200, body: { apiVersion: 'v1', data: {} } };
    if (req.path === '/fixture/schedule-run') {
      const body = req.body as { runRef: string; host: string };
      runs.set(body.runRef, { host: body.host, events: [], gates: [], leased: false });
      return { status: 201, body: { apiVersion: 'v1', data: { runRef: body.runRef } } };
    }
    if (req.path === '/api/v1/hosts/desktop/leases/claim') {
      const run = [...runs.entries()].find(([, r]) => r.host === 'desktop' && !r.leased);
      if (!run) return { status: 204, body: {} };
      run[1].leased = true;
      return ok({ runRef: run[0], lease: { runRef: run[0], hostId: 'desktop', revision: 1 } });
    }
    const renewMatch = /^\/api\/v1\/runs\/([^/]+)\/leases\/renew$/.exec(req.path);
    if (renewMatch && req.nodeId === 'oldNODE7') return { status: 403, body: { apiVersion: 'v1', error: { code: 'node-revoked' } } };
    const reportMatch = /^\/api\/v1\/runs\/([^/]+)\/reports$/.exec(req.path);
    if (reportMatch) {
      const run = runs.get(reportMatch[1]!);
      const kind = (req.body as { kind: string }).kind;
      if (run) { run.events.push(req.body); if (kind === 'gate-opened') run.gates.push({ requestRef: `req-${run.gates.length + 1}` }); }
      return ok({ runRef: reportMatch[1] });
    }
    const eventsMatch = /^\/api\/v1\/runs\/([^/]+)\/events$/.exec(req.path);
    if (eventsMatch) { void target; return ok({ runRef: eventsMatch[1], events: runs.get(eventsMatch[1]!)?.events ?? [] }); }
    const gatesMatch = /^\/api\/v1\/runs\/([^/]+)\/gates$/.exec(req.path);
    if (gatesMatch) return ok({ runRef: gatesMatch[1], gates: runs.get(gatesMatch[1]!)?.gates ?? [] });
    return { status: 404, body: { apiVersion: 'v1', error: { code: 'not-found' } } };
  };
  return { call, state: { runs } };
}

describe('runScenario', () => {
  for (const id of P6_SCENARIOS) {
    it(`passes ${id} against the faithful fake`, async () => {
      const { call } = fakeDaemons();
      const outcome = await runScenario(id, call);
      expect(outcome.passed, outcome.detail).toBe(true);
    });
  }

  it('reads the VM stream from the Desktop origin (proving the read-proxy path is exercised)', async () => {
    const { call } = fakeDaemons();
    const targets: string[] = [];
    const spy: CallFn = async (target, req) => { if (req.method === 'GET' && req.path.endsWith('/events')) targets.push(target); return call(target, req); };
    const outcome = await runScenario('one-stream-both-hosts', spy);
    expect(outcome.passed).toBe(true);
    expect(targets).toContain('desktop');
    expect(targets).toContain('vm');
  });
});

describe('runScenarios', () => {
  it('writes one artifact per scenario and exits 0 when all pass', async () => {
    const { call } = fakeDaemons();
    const written = new Map<P6ScenarioId, ScenarioOutcome>();
    const { exitCode, outcomes } = await runScenarios([...P6_SCENARIOS], call, (id, o) => written.set(id, o));
    expect(exitCode).toBe(0);
    expect(written.size).toBe(P6_SCENARIOS.length);
    expect(outcomes.every((o) => o.passed)).toBe(true);
  });

  it('exits non-zero when any scenario fails, and still records its artifact', async () => {
    // A call that makes the claim return the wrong host → schedule-desktop-run fails.
    const brokenClaim: CallFn = async (_target, req) => {
      if (req.path === '/api/v1/hosts/desktop/leases/claim') return { status: 200, body: { apiVersion: 'v1', data: { lease: { hostId: 'vm' } } } };
      if (req.path.startsWith('/fixture/')) return { status: req.path.endsWith('schedule-run') ? 201 : 200, body: { apiVersion: 'v1', data: {} } };
      return { status: 404, body: {} };
    };
    const written = new Map<P6ScenarioId, ScenarioOutcome>();
    const { exitCode } = await runScenarios(['schedule-desktop-run'], brokenClaim, (id, o) => written.set(id, o));
    expect(exitCode).toBe(1);
    expect(written.get('schedule-desktop-run')?.passed).toBe(false);
  });

  it('captures a throwing scenario as a failure rather than crashing', async () => {
    const throwing: CallFn = async () => { throw new Error('daemon unreachable'); };
    const { exitCode, outcomes } = await runScenarios(['rotation-invalidates-leases'], throwing, () => {});
    expect(exitCode).toBe(1);
    expect(outcomes[0]!.detail).toContain('daemon unreachable');
  });
});

describe('parseScenarioArgs', () => {
  it('requires both origins and an artifact dir', () => {
    expect(() => parseScenarioArgs(['--origin-vm', 'https://127.0.0.1:1'])).toThrow(ScenarioUsageError);
    expect(() => parseScenarioArgs(['--origin-vm', 'https://127.0.0.1:1', '--origin-desktop', 'https://127.0.0.1:2'])).toThrow(/artifact-dir/);
  });
  it('defaults to all six scenarios and parses a custom subset', () => {
    const full = parseScenarioArgs(['--origin-vm', 'a', '--origin-desktop', 'b', '--artifact-dir', 'd']);
    expect(full.scenarios).toEqual([...P6_SCENARIOS]);
    const subset = parseScenarioArgs(['--origin-vm', 'a', '--origin-desktop', 'b', '--artifact-dir', 'd', '--scenarios', 'schedule-desktop-run,gate-open-and-resolve', '--fail-if-unavailable']);
    expect(subset.scenarios).toEqual(['schedule-desktop-run', 'gate-open-and-resolve']);
    expect(subset.failIfUnavailable).toBe(true);
  });
  it('rejects an unknown scenario name', () => {
    expect(() => parseScenarioArgs(['--origin-vm', 'a', '--origin-desktop', 'b', '--artifact-dir', 'd', '--scenarios', 'nope'])).toThrow(/unknown scenario/);
  });
});
