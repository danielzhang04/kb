/**
 * T4 — merge-gate reconciler. All side effects (gh read, cards.py, git commit, audit) are injected as
 * recording fakes: no real gh/git/py runs. Proves the close path uses the governed transaction sequence,
 * and that EVERY non-merged / unknown / branch-only / failing case leaves the card OPEN.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseMergeTarget,
  reconcileMergeGates,
  startMergeGateReconciler,
  type ReconcileDeps,
} from './mergeGateReconciler.ts';
import type { ParsedCard } from '../planeA/cards.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';

function gateCard(id: string, target: string, state: string, action?: string): ParsedCard {
  return {
    meta: {
      id,
      project: 'kb',
      action: action ?? `approve:merge:${target}`,
      target,
      'risk-tier': 'T2',
      owner: 'human-operator',
      state,
    },
    body: '## Work order\n\nmerge it\n',
  };
}

function index(cards: ParsedCard[]): PlaneAIndex {
  const grouped: Record<string, ParsedCard[]> = {};
  for (const c of cards) (grouped[String(c.meta.state)] ??= []).push(c);
  return {
    cards: grouped,
    ledgers: {
      dispatch: { count: 0, cards: 0, byProject: {} },
      cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
      grades: { count: 0, rows: [] },
      activity: { count: 0, rows: [] },
    },
    orgStates: [],
  };
}

/** A recording deps set that uses the REAL executeCardMutation (so prepare<py ordering is exercised),
 *  with every external effect (index, gh, prepareWrite, runPy, audit, commit) injected. */
function recordingDeps(cards: ParsedCard[], gh: ReconcileDeps['gh']): { deps: ReconcileDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: ReconcileDeps = {
    repoRoot: '/repo',
    indexRepo: () => index(cards),
    gh,
    prepareWrite: async () => { calls.push('prepare'); },
    runPy: (_repo, _code, jsonArg) => {
      calls.push('py');
      const op = JSON.parse(jsonArg) as { cardId: string };
      return { exitCode: 0, stdout: JSON.stringify({ id: op.cardId, state: 'done', paths: [`queue/inbox/${op.cardId}.md`, `queue/done/${op.cardId}.md`] }), stderr: '' };
    },
    appendAuditLocal: (_repo, event) => { calls.push('audit'); return { ts: '2026-07-20T00:00:00.000Z', ...event }; },
    commitPreparedCoordination: (async (..._args: unknown[]) => { calls.push('commit'); }) as ReconcileDeps['commitPreparedCoordination'],
    now: () => new Date('2026-07-20T00:00:00.000Z'),
  };
  return { deps, calls };
}

describe('parseMergeTarget', () => {
  it('returns the PR number for a numeric target and null for a branch target', () => {
    expect(parseMergeTarget('approve:merge:42')).toBe('42');
    expect(parseMergeTarget('approve:merge:codex/foo-bar')).toBeNull();
    expect(parseMergeTarget('approve:merge:')).toBeNull();
    expect(parseMergeTarget('deploy:prod')).toBeNull();
  });
});

describe('reconcileMergeGates', () => {
  it('closes a gate whose PR is merged via the governed transaction, in prepare<py<audit<commit order', async () => {
    const { deps, calls } = recordingDeps([gateCard('g1', '42', 'inbox')], () => ({ merged: true, closed: false }));
    const result = await reconcileMergeGates(deps);
    expect(result).toEqual({ closed: ['g1'], skipped: [] });
    expect(calls).toEqual(['prepare', 'py', 'audit', 'commit']); // one commit, correct sequence
  });

  it('closes a gate whose PR is closed (not merged) too', async () => {
    const { deps } = recordingDeps([gateCard('g1', '42', 'inbox')], () => ({ merged: false, closed: true }));
    const result = await reconcileMergeGates(deps);
    expect(result.closed).toEqual(['g1']);
  });

  it('leaves an OPEN (not merged/closed) PR gate untouched and skipped', async () => {
    const { deps, calls } = recordingDeps([gateCard('g1', '42', 'inbox')], () => ({ merged: false, closed: false }));
    const result = await reconcileMergeGates(deps);
    expect(result).toEqual({ closed: [], skipped: ['g1'] });
    expect(calls).toEqual([]); // no mutation at all
  });

  it('leaves the gate open when gh returns null (absent / timeout / parse fault)', async () => {
    const { deps, calls } = recordingDeps([gateCard('g1', '42', 'inbox')], () => null);
    const result = await reconcileMergeGates(deps);
    expect(result).toEqual({ closed: [], skipped: ['g1'] });
    expect(calls).toEqual([]);
  });

  it('leaves the gate open when gh THROWS (never lets a subprocess fault crash the reconcile)', async () => {
    const { deps } = recordingDeps([gateCard('g1', '42', 'inbox')], () => { throw new Error('gh boom'); });
    const result = await reconcileMergeGates(deps);
    expect(result).toEqual({ closed: [], skipped: ['g1'] });
  });

  it('skips a branch-only target WITHOUT ever calling gh (Decision 5)', async () => {
    const gh = vi.fn(() => ({ merged: true, closed: false }));
    const { deps } = recordingDeps([gateCard('b1', 'codex/foo', 'inbox')], gh);
    const result = await reconcileMergeGates(deps);
    expect(result).toEqual({ closed: [], skipped: ['b1'] });
    expect(gh).not.toHaveBeenCalled();
  });

  it('ignores non-live gates (parsed state done/rejected/halted) — keyed on state, not directory', async () => {
    const gh = vi.fn(() => ({ merged: true, closed: false }));
    const { deps } = recordingDeps([gateCard('done-gate', '42', 'done'), gateCard('halted-gate', '43', 'halted')], gh);
    const result = await reconcileMergeGates(deps);
    expect(result).toEqual({ closed: [], skipped: [] }); // neither is live
    expect(gh).not.toHaveBeenCalled();
  });

  it('closes the mergeable PR gate but skips the branch gate in one pass', async () => {
    const { deps } = recordingDeps(
      [gateCard('pr', '99', 'inbox'), gateCard('br', 'codex/x', 'working')],
      () => ({ merged: true, closed: false }),
    );
    const result = await reconcileMergeGates(deps);
    expect(result.closed).toEqual(['pr']);
    expect(result.skipped).toEqual(['br']);
  });

  it('leaves the gate open when the cards.py mutation fails (fail toward surfacing)', async () => {
    const { deps } = recordingDeps([gateCard('g1', '42', 'inbox')], () => ({ merged: true, closed: false }));
    deps.runPy = () => ({ exitCode: 1, stdout: '', stderr: 'illegal transition' });
    const result = await reconcileMergeGates(deps);
    expect(result).toEqual({ closed: [], skipped: ['g1'] });
  });
});

describe('startMergeGateReconciler', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('is a no-op (never schedules a tick) when intervalMs <= 0', () => {
    vi.useFakeTimers();
    const indexRepo = vi.fn(() => index([]));
    const stop = startMergeGateReconciler({ repoRoot: '/repo', indexRepo }, 0);
    vi.advanceTimersByTime(1_000_000);
    expect(indexRepo).not.toHaveBeenCalled();
    expect(typeof stop).toBe('function');
    stop(); // idempotent no-op
  });

  it('runs a reconcile on each interval and stops on the returned stop fn', async () => {
    vi.useFakeTimers();
    const indexRepo = vi.fn(() => index([]));
    const stop = startMergeGateReconciler({ repoRoot: '/repo', indexRepo, gh: () => null }, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(indexRepo).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(indexRepo).toHaveBeenCalledTimes(1); // no further ticks after stop
  });

  it('swallows a reconcile throw so a tick can never crash the daemon', async () => {
    vi.useFakeTimers();
    const indexRepo = vi.fn(() => { throw new Error('index boom'); });
    const stop = startMergeGateReconciler({ repoRoot: '/repo', indexRepo }, 1000);
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
    stop();
  });
});
