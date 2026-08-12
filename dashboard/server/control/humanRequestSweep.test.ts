import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startHumanRequestSweeper,
  sweepOrphanedHumanRequests,
  type HumanRequestSweepDeps,
} from './humanRequestSweep.ts';
import { AUDIT_REL_PATH, type OpsGitRunner } from '../audit/log.ts';
import type { ControlPlaneStore } from './store.ts';

function fakeStore(impl: ControlPlaneStore['closeOrphanedHumanRequests']): ControlPlaneStore {
  return { closeOrphanedHumanRequests: impl } as unknown as ControlPlaneStore;
}

/** One request as the store reports it back from a sweep (only the fields this module reads). */
function closedRequest(requestRef: string, runRef: string, reason: string | null) {
  return { requestRef, runRef, response: { response: reason } };
}

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'human-request-sweep-'));
  tmpDirs.push(dir);
  return dir;
}

/** A REAL minimal git repo checked out on `ops` — the branch `appendAudit`'s own guard reads for real. */
function initOpsRepo(dir: string): void {
  execFileSync('git', ['init', '-q', '-b', 'ops'], { cwd: dir });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: dir }); // keep the ledger byte-stable
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir }).toString();
}

/**
 * A git runner that really runs the LOCAL half of the audit commit (diff/add/commit) against the scratch
 * repo and no-ops the two network steps (there is no remote in a hermetic test). That is what lets the
 * checkout-stays-clean assertion below be a real one rather than a mock-call assertion.
 */
function localOnlyGit(): { runner: OpsGitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: OpsGitRunner = (repoRoot, args) => {
    calls.push(args);
    if (args[0] === 'pull' || args[0] === 'push') return '';
    return execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args], { cwd: repoRoot }).toString();
  };
  return { runner, calls };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('sweepOrphanedHumanRequests', () => {
  it('calls the store with the resolved clock ONLY — there is no age window to pass any more', async () => {
    // The removed age predicate (ruling 2026-08-11): the sweep can no longer ask the store to close a
    // request for being old, so it has nothing to configure and no window constant to carry.
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [] });
    await sweepOrphanedHumanRequests({ store: fakeStore(closeOrphanedHumanRequests), now: () => new Date('2026-08-11T00:00:00.000Z') });
    expect(closeOrphanedHumanRequests).toHaveBeenCalledWith(Date.parse('2026-08-11T00:00:00.000Z'));
    expect(closeOrphanedHumanRequests.mock.calls[0]).toHaveLength(1);
  });

  it('reports what closed, on which run and why, to the sink the daemon logs from', async () => {
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({
      closed: [closedRequest('request-1', 'run-9', "Automatically closed — the run reached its terminal state ('failed')…")],
    });
    const onSweep = vi.fn();
    const deps: HumanRequestSweepDeps = {
      store: fakeStore(closeOrphanedHumanRequests),
      now: () => new Date('2026-08-11T00:00:00.000Z'),
      onSweep,
    };

    const result = await sweepOrphanedHumanRequests(deps);

    expect(result).toEqual({
      closed: [{ requestRef: 'request-1', runRef: 'run-9', reason: expect.stringContaining('terminal state') }],
      auditFailures: [],
    });
    expect(onSweep).toHaveBeenCalledWith(result);
  });

  it('writes one audit row per closed request, under the repo root, with the reason', async () => {
    const appendAudit = vi.fn().mockResolvedValue({ ts: '2026-08-11T00:00:00.000Z', action: 'x' });
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({
      closed: [closedRequest('request-1', 'run-9', 'terminal:failed'), closedRequest('request-2', 'run-9', 'terminal:failed')],
    });

    const result = await sweepOrphanedHumanRequests({
      store: fakeStore(closeOrphanedHumanRequests),
      repoRoot: '/repo',
      appendAudit,
      now: () => new Date('2026-08-11T00:00:00.000Z'),
    });

    expect(appendAudit).toHaveBeenCalledTimes(2);
    expect(appendAudit.mock.calls[0]![0]).toBe('/repo');
    expect(appendAudit.mock.calls[0]![1]).toMatchObject({
      action: 'control-human-request-auto-close',
      target: 'request-1',
      result: 'auto-closed',
      detail: { requestRef: 'request-1', runRef: 'run-9', reason: 'terminal:failed' },
    });
    // The COMMITTING seam is used, and it carries a per-request commit subject.
    expect(appendAudit.mock.calls[0]![2]).toMatchObject({ message: expect.stringContaining('request-1') });
    expect(result.auditFailures).toEqual([]);
  });

  /**
   * The N1 regression (2026-08-11). A BARE `appendAuditRowLocal` here left the tracked ledger dirty in the
   * shared `dashboard-ops` checkout, and `prepareCoordination` runs `git pull --rebase origin ops` with NO
   * autostash — so one dirty ledger aborted EVERY subsequent coordination write in the daemon. The boot
   * sweep exists precisely to close pre-existing orphans, so it fired on the very first boot. This test
   * runs the REAL `appendAudit` (the wired default — nothing is injected in its place) against a real repo
   * checked out on `ops`, and asserts the invariant directly: the checkout is CLEAN afterwards.
   */
  it('leaves the ops checkout clean after a sweep that closed something — the append and its commit share one ops transaction', async () => {
    const dir = await scratch();
    initOpsRepo(dir);
    const { runner, calls } = localOnlyGit();
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({
      closed: [closedRequest('request-1', 'run-9', 'terminal:failed'), closedRequest('request-2', 'run-9', 'terminal:failed')],
    });

    const result = await sweepOrphanedHumanRequests({
      store: fakeStore(closeOrphanedHumanRequests),
      repoRoot: dir,
      auditOptions: { runGit: runner, maxRetryPushes: 0 },
      now: () => new Date('2026-08-11T00:00:00.000Z'),
    });

    expect(result.closed).toHaveLength(2);
    expect(result.auditFailures).toEqual([]);
    // THE invariant: nothing is left uncommitted for the next coordination write to trip over.
    expect(git(dir, ['status', '--porcelain']).trim()).toBe('');
    // And the rows are genuinely in the committed tree, not merely absent from the working tree.
    const committed = git(dir, ['show', `HEAD:${AUDIT_REL_PATH}`]);
    expect(committed).toContain('control-human-request-auto-close');
    expect(committed).toContain('request-2');
    // Only the ledger path is ever staged (the audit commit never does `git add .`).
    expect(calls.some((argv) => argv[0] === 'add' && argv.includes(AUDIT_REL_PATH))).toBe(true);
    expect(calls.some((argv) => argv[0] === 'add' && argv.includes('.'))).toBe(false);
  });

  it('reports — never throws — when the audit row cannot be committed: the close is already durable', async () => {
    const appendAudit = vi.fn(() => { throw new Error('ledger unwritable'); });
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [closedRequest('request-1', 'run-9', 'terminal:failed')] });
    const onSweep = vi.fn();

    const result = await sweepOrphanedHumanRequests({
      store: fakeStore(closeOrphanedHumanRequests), repoRoot: '/repo', appendAudit, onSweep,
    });

    expect(result.closed).toHaveLength(1);
    expect(result.auditFailures).toEqual(['request-1']);
    expect(onSweep).toHaveBeenCalledWith(result);
  });

  it('reports a REJECTED promise from the audit seam too, not only a synchronous throw', async () => {
    const appendAudit = vi.fn().mockRejectedValue(new Error('push rejected'));
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [closedRequest('request-1', 'run-9', null)] });

    const result = await sweepOrphanedHumanRequests({
      store: fakeStore(closeOrphanedHumanRequests), repoRoot: '/repo', appendAudit,
    });

    expect(result.closed).toHaveLength(1);
    expect(result.auditFailures).toEqual(['request-1']);
  });

  it('attempts no audit row at all with no repo root (in-memory/test wiring)', async () => {
    const appendAudit = vi.fn();
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [closedRequest('request-1', 'run-9', null)] });
    const result = await sweepOrphanedHumanRequests({ store: fakeStore(closeOrphanedHumanRequests), appendAudit });
    expect(appendAudit).not.toHaveBeenCalled();
    expect(result).toEqual({ closed: [{ requestRef: 'request-1', runRef: 'run-9', reason: null }], auditFailures: [] });
  });
});

describe('startHumanRequestSweeper', () => {
  it('disables entirely for a non-positive interval — no boot sweep, no timer', () => {
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [] });
    const stop = startHumanRequestSweeper({ store: fakeStore(closeOrphanedHumanRequests) }, 0);
    expect(closeOrphanedHumanRequests).not.toHaveBeenCalled();
    stop();
  });

  it('sweeps once immediately (the boot sweep) and again on every interval tick', async () => {
    vi.useFakeTimers();
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [] });
    const stop = startHumanRequestSweeper({ store: fakeStore(closeOrphanedHumanRequests) }, 1_000);
    expect(closeOrphanedHumanRequests).toHaveBeenCalledTimes(1); // boot sweep, before any tick fires
    await vi.advanceTimersByTimeAsync(1_000);
    expect(closeOrphanedHumanRequests).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(closeOrphanedHumanRequests).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(closeOrphanedHumanRequests).toHaveBeenCalledTimes(4); // stopped: no further ticks
  });

  it('never lets a store throw escape a tick, and never overlaps a slow sweep with the next tick', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const closeOrphanedHumanRequests = vi.fn(() => {
      calls += 1;
      throw new Error('store fault');
    });
    expect(() => startHumanRequestSweeper({ store: fakeStore(closeOrphanedHumanRequests) }, 1_000)).not.toThrow();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000); // a throwing sweep must not reject out of the tick wrapper
    expect(calls).toBe(2);
  });

  it('skips a tick while the previous sweep is still awaiting its audit commit', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [closedRequest('request-1', 'run-9', null)] });
    const stop = startHumanRequestSweeper({
      store: fakeStore(closeOrphanedHumanRequests),
      repoRoot: '/repo',
      appendAudit: async () => { await blocked; return { ts: 'x', action: 'x' }; },
    }, 1_000);

    expect(closeOrphanedHumanRequests).toHaveBeenCalledTimes(1); // boot sweep, now parked on the audit
    await vi.advanceTimersByTimeAsync(3_000);
    expect(closeOrphanedHumanRequests).toHaveBeenCalledTimes(1); // overlapping ticks skipped, not queued

    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(closeOrphanedHumanRequests).toHaveBeenCalledTimes(2); // the next tick runs once it is free
    stop();
  });
});
