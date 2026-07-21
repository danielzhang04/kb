import { describe, expect, it, vi } from 'vitest';
import {
  bridgeClaimsCard,
  scanOwnedDashboardCards,
  createQueueBridge,
  QueueBridgeError,
  QUEUE_BRIDGE_SELECT_SCRIPT,
  type OwnedCard,
} from './queueBridge.ts';
import type { PyRunResult } from '../write/launch.ts';
import type { PreambleRunResult } from '../write/preambleGate.ts';

const SUBJECT = 'dashboard-engine';

const okPreamble = (): PreambleRunResult => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' });
const stopPreamble = (): PreambleRunResult => ({ exitCode: 2, stdout: '', stderr: 'STOP file present' });

function pyReturning(rows: unknown): { runPy: (r: string, c: string, a: string) => PyRunResult; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    runPy: (_repo, _code, jsonArg) => { calls.push(jsonArg); return { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' }; },
  };
}

// --- bridgeClaimsCard: the owner x execution-controller x state matrix (double-execution guard) --------

describe('bridgeClaimsCard — inverse of agent_runner.ps1 step 6', () => {
  // Legacy-runner predicate, transcribed verbatim from scripts/agent_runner.ps1 step 6, to prove the
  // two sides partition the space with no overlap and no gap.
  const legacyClaims = (meta: Record<string, unknown>, agent: string): boolean =>
    meta['execution-controller'] !== 'dashboard'
    && meta.owner === agent
    && (meta.state === 'inbox' || meta.state === 'working');

  it('claims only (controller==="dashboard", owner===subject, state∈inbox|working)', () => {
    expect(bridgeClaimsCard({ 'execution-controller': 'dashboard', owner: SUBJECT, state: 'inbox' })).toBe(true);
    expect(bridgeClaimsCard({ 'execution-controller': 'dashboard', owner: SUBJECT, state: 'working' })).toBe(true);
  });

  it('rejects absent/null controller — that card belongs to the legacy runner', () => {
    expect(bridgeClaimsCard({ owner: SUBJECT, state: 'inbox' })).toBe(false);
    expect(bridgeClaimsCard({ 'execution-controller': null, owner: SUBJECT, state: 'inbox' })).toBe(false);
  });

  it('rejects a non-"dashboard" controller value, including case variants', () => {
    expect(bridgeClaimsCard({ 'execution-controller': 'codex', owner: SUBJECT, state: 'inbox' })).toBe(false);
    expect(bridgeClaimsCard({ 'execution-controller': 'DASHBOARD', owner: SUBJECT, state: 'inbox' })).toBe(false);
  });

  it('rejects a wrong owner', () => {
    expect(bridgeClaimsCard({ 'execution-controller': 'dashboard', owner: 'claude-boss', state: 'inbox' })).toBe(false);
  });

  it('rejects non-claimable states (blocked/done/approvals/absent)', () => {
    for (const state of ['blocked', 'done', 'approvals', 'approved', 'rejected', undefined]) {
      expect(bridgeClaimsCard({ 'execution-controller': 'dashboard', owner: SUBJECT, state: state as string })).toBe(false);
    }
  });

  it('partitions the owner/state-matched space with the legacy predicate — no overlap, no gap', () => {
    for (const controller of ['dashboard', 'codex', 'DASHBOARD', null, undefined, '']) {
      for (const state of ['inbox', 'working']) {
        const meta = { 'execution-controller': controller, owner: SUBJECT, state } as Record<string, unknown>;
        expect(bridgeClaimsCard(meta as never), `controller=${String(controller)}`).not.toBe(legacyClaims(meta, SUBJECT));
      }
    }
  });

  it('honors a non-default subject', () => {
    expect(bridgeClaimsCard({ 'execution-controller': 'dashboard', owner: 'other', state: 'inbox' }, 'other')).toBe(true);
    expect(bridgeClaimsCard({ 'execution-controller': 'dashboard', owner: SUBJECT, state: 'inbox' }, 'other')).toBe(false);
  });
});

// --- scanOwnedDashboardCards: invokes the selector, parses, fail-closed --------------------------------

describe('scanOwnedDashboardCards', () => {
  it('passes subject + queueRoot to the selector and returns the parsed rows', () => {
    const rows: OwnedCard[] = [{ id: 'wf-abc', path: 'queue/inbox/wf-abc.md', state: 'inbox' }];
    const py = pyReturning(rows);
    const got = scanOwnedDashboardCards({ repoRoot: '/repo', runPy: py.runPy }, { subject: SUBJECT, queueRoot: 'q' });
    expect(got).toEqual(rows);
    expect(JSON.parse(py.calls[0])).toEqual({ subject: SUBJECT, queueRoot: 'q' });
  });

  it('defaults the subject to the dashboard executor identity', () => {
    const py = pyReturning([]);
    scanOwnedDashboardCards({ repoRoot: '/repo', runPy: py.runPy }, {});
    expect(JSON.parse(py.calls[0])).toEqual({ subject: SUBJECT });
  });

  it('fails closed on a non-zero selector exit (never silently claims nothing)', () => {
    const runPy = () => ({ exitCode: 1, stdout: '', stderr: 'boom' });
    expect(() => scanOwnedDashboardCards({ repoRoot: '/repo', runPy }, {})).toThrow(QueueBridgeError);
  });

  it('fails closed on unparseable selector output', () => {
    const runPy = () => ({ exitCode: 0, stdout: 'not json', stderr: '' });
    expect(() => scanOwnedDashboardCards({ repoRoot: '/repo', runPy }, {})).toThrow(QueueBridgeError);
  });

  it('the embedded script defers to the committed python module (parse-parity), not an inline reimpl', () => {
    expect(QUEUE_BRIDGE_SELECT_SCRIPT).toContain('import queue_bridge_select');
    expect(QUEUE_BRIDGE_SELECT_SCRIPT).toContain('select_owned_dashboard_cards');
    expect(QUEUE_BRIDGE_SELECT_SCRIPT).toContain('sys.argv[1]');
  });
});

// --- createQueueBridge: preamble gate + single-flight, NO dispatch by default -------------------------

describe('createQueueBridge.tick', () => {
  it('gates on the preamble: a present STOP / blown budget blocks scan and dispatch (D7)', async () => {
    const dispatch = vi.fn(async () => {});
    const py = pyReturning([{ id: 'x', path: 'p', state: 'inbox' }]);
    const bridge = createQueueBridge({ repoRoot: '/repo', runPreamble: stopPreamble, runPy: py.runPy, dispatch });
    const res = await bridge.tick();
    expect(res).toEqual({ ran: true, blocked: true, discovered: 0, dispatched: 0 });
    expect(py.calls).toHaveLength(0); // never scanned
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('discovers owned cards and dispatches each when the preamble passes', async () => {
    const dispatched: OwnedCard[] = [];
    const rows: OwnedCard[] = [
      { id: 'wf-1', path: 'queue/inbox/wf-1.md', state: 'inbox' },
      { id: 'wf-2', path: 'queue/working/wf-2.md', state: 'working' },
    ];
    const py = pyReturning(rows);
    const bridge = createQueueBridge({
      repoRoot: '/repo', runPreamble: okPreamble, runPy: py.runPy,
      dispatch: async (c) => { dispatched.push(c); },
    });
    const res = await bridge.tick();
    expect(res).toEqual({ ran: true, blocked: false, discovered: 2, dispatched: 2 });
    expect(dispatched).toEqual(rows);
  });

  it('single-flight: a tick entered while one is in flight is skipped (ran:false)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const py = pyReturning([{ id: 'wf-1', path: 'p', state: 'inbox' }]);
    const bridge = createQueueBridge({
      repoRoot: '/repo', runPreamble: okPreamble, runPy: py.runPy,
      dispatch: async () => { await gate; },
    });
    const first = bridge.tick();
    const second = await bridge.tick(); // enters while `first` is parked in dispatch
    expect(second).toEqual({ ran: false, blocked: false, discovered: 0, dispatched: 0 });
    release();
    expect((await first).dispatched).toBe(1);
  });

  it('default dispatch is a no-op (T3 is discovery-only)', async () => {
    const py = pyReturning([{ id: 'wf-1', path: 'p', state: 'inbox' }]);
    const bridge = createQueueBridge({ repoRoot: '/repo', runPreamble: okPreamble, runPy: py.runPy });
    const res = await bridge.tick();
    expect(res).toEqual({ ran: true, blocked: false, discovered: 1, dispatched: 1 });
  });
});
