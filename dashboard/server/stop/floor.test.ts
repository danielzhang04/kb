/**
 * D2.8 — files-only stop floor. Every test injects a fake `PyRunner` / `OpsGitRunner` / clock (see
 * `floor.ts`'s module docstring for why: hermetic — no test here ever shells a real `py`/`git` binary,
 * touches the network, or sleeps a real timer). `writeStop` and `pauseCadence` DO touch a real
 * filesystem (a throwaway `mkdtemp` scratch dir), mirroring the established pattern in
 * `dashboard/server/audit/log.test.ts` — only the git/py subprocess boundary is faked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import {
  pauseCadence,
  requestStop,
  sigkillBackstop,
  writeStop,
  STOP_CARD_SCRIPT,
} from './floor.ts';
import type { FloorDeps, OpsGitRunner, PyRunResult, PyRunner, SessionInput } from './floor.ts';

const SECRET = Buffer.from('floor-test-secret-do-not-reuse');
const SESSION_CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };

function validSession(): SessionInput {
  const { token } = mintSession('operator-1', SESSION_CONFIG);
  return { token, config: SESSION_CONFIG };
}

function noSession(): SessionInput {
  return { token: null, config: SESSION_CONFIG };
}

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'stop-floor-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

/** Records every invocation so tests can assert exactly what would have been shelled (or wasn't). */
function recordingPyRunner(result: PyRunResult): { runner: PyRunner; calls: Array<{ code: string; jsonArg: string }> } {
  const calls: Array<{ code: string; jsonArg: string }> = [];
  const runner: PyRunner = (_repoRoot, code, jsonArg) => {
    calls.push({ code, jsonArg });
    return result;
  };
  return { runner, calls };
}

/** Records every git invocation (argv after `git`); never touches the network or a real repo. */
function recordingGitRunner(): { runner: OpsGitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: OpsGitRunner = (_repoRoot, args) => {
    calls.push(args);
    return '';
  };
  return { runner, calls };
}

describe('writeStop — creates the STOP file (session-gated)', () => {
  it('creates the STOP file (session-gated)', async () => {
    const repo = await scratch();
    const deps: FloorDeps = { repoRoot: repo };

    const result = writeStop(validSession(), deps);

    expect(result.ok).toBe(true);
    expect(existsSync(join(repo, 'STOP'))).toBe(true);
  });

  it('refuses without a valid WebAuthn session and writes nothing', async () => {
    const repo = await scratch();
    const deps: FloorDeps = { repoRoot: repo };

    const result = writeStop(noSession(), deps);

    expect(result).toEqual({
      ok: false,
      reason: 'unauthenticated',
      detail: 'no WebAuthn session token supplied',
    });
    expect(existsSync(join(repo, 'STOP'))).toBe(false);
  });

  it('rejects an expired session the same way as a missing one', async () => {
    const repo = await scratch();
    const expiredConfig: SessionConfig = { secret: SECRET, now: () => 0, ttlMs: 1 };
    const { token } = mintSession('operator-1', expiredConfig);
    const laterSession: SessionInput = { token, config: { secret: SECRET, now: () => 1_000_000 } };

    const result = writeStop(laterSession, { repoRoot: repo });

    expect(result).toEqual({ ok: false, reason: 'unauthenticated', detail: 'expired' });
    expect(existsSync(join(repo, 'STOP'))).toBe(false);
  });
});

describe('requestStop — transitions the card working→stop-requested→halting via the governed path', () => {
  it('transitions the card working→stop-requested→halting via the governed path (no ValidationError)', () => {
    const { runner: runPy, calls: pyCalls } = recordingPyRunner({
      exitCode: 0,
      stdout: '{"id":"card-1","path":"queue/working/card-1.md","state":"halting"}\n',
      stderr: '',
    });
    const { runner: runGit, calls: gitCalls } = recordingGitRunner();

    const result = requestStop('card-1', validSession(), { repoRoot: '/repo', runPy, runGit });

    expect(result).toEqual({
      ok: true,
      cardId: 'card-1',
      cardPath: 'queue/working/card-1.md',
      state: 'halting',
    });

    // Exactly one subprocess call, shelling the governed STOP_CARD_SCRIPT — imports scripts/cards.py
    // as a module and calls cards.transition twice (working -> stop-requested -> halting).
    expect(pyCalls).toHaveLength(1);
    expect(pyCalls[0].code).toBe(STOP_CARD_SCRIPT);
    expect(STOP_CARD_SCRIPT).toContain('import cards');
    expect(STOP_CARD_SCRIPT).toContain('cards.transition');
    const payload = JSON.parse(pyCalls[0].jsonArg);
    expect(payload.cardId).toBe('card-1');

    // The card-state write is a coordination write: routes to `ops` via pull-rebase-push, staging
    // only the card path that changed (never `git add .`).
    const verbs = gitCalls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toEqual(['pull --rebase', 'add --', 'commit -m', 'push origin']);
    expect(gitCalls[0]).toEqual(['pull', '--rebase', 'origin', 'ops']);
    expect(gitCalls[1]).toEqual(['add', '--', 'queue/working/card-1.md']);
    expect(gitCalls[3]).toEqual(['push', 'origin', 'ops']);
  });

  it('refuses without a valid session, spawning neither the card-op subprocess nor git', () => {
    const { runner: runPy, calls: pyCalls } = recordingPyRunner({ exitCode: 0, stdout: '{}', stderr: '' });
    const { runner: runGit, calls: gitCalls } = recordingGitRunner();

    const result = requestStop('card-1', noSession(), { repoRoot: '/repo', runPy, runGit });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unauthenticated');
    expect(pyCalls).toHaveLength(0);
    expect(gitCalls).toHaveLength(0);
  });

  it('surfaces a card-op failure (e.g. illegal transition) instead of pretending success, and never touches git', () => {
    const { runner: runPy } = recordingPyRunner({
      exitCode: 1,
      stdout: '',
      stderr: 'ValidationError: illegal transition done -> stop-requested',
    });
    const { runner: runGit, calls: gitCalls } = recordingGitRunner();

    const result = requestStop('card-1', validSession(), { repoRoot: '/repo', runPy, runGit });

    expect(result).toEqual({
      ok: false,
      reason: 'card-op-failed',
      detail: 'ValidationError: illegal transition done -> stop-requested',
    });
    expect(gitCalls).toHaveLength(0);
  });

  it('re-reads (pull --rebase) and retries when the push is rejected', () => {
    const { runner: runPy } = recordingPyRunner({
      exitCode: 0,
      stdout: '{"id":"card-2","path":"queue/working/card-2.md","state":"halting"}\n',
      stderr: '',
    });
    const calls: string[][] = [];
    let pushes = 0;
    const runGit: OpsGitRunner = (_repoRoot, args) => {
      calls.push(args);
      if (args[0] === 'push') {
        pushes += 1;
        if (pushes === 1) throw new Error('! [rejected] ops -> ops (fetch first)');
      }
      return '';
    };

    const result = requestStop('card-2', validSession(), { repoRoot: '/repo', runPy, runGit });

    expect(result.ok).toBe(true);
    const pushIdx = calls.map((c, i) => (c[0] === 'push' ? i : -1)).filter((i) => i >= 0);
    expect(pushIdx).toHaveLength(2);
    expect(calls[pushIdx[0] + 1]).toEqual(['pull', '--rebase', 'origin', 'ops']);
  });
});

describe('pauseCadence — writes queue/paused/<name> via the governed ops path', () => {
  it('writes queue/paused/<name> so dispatch.due() skips the next beat, via the governed ops path', async () => {
    const repo = await scratch();
    const { runner: runGit, calls: gitCalls } = recordingGitRunner();

    const result = pauseCadence('weekly-report', validSession(), { repoRoot: repo, runGit });

    expect(result.ok).toBe(true);
    expect(existsSync(join(repo, 'queue', 'paused', 'weekly-report'))).toBe(true);

    const verbs = gitCalls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toEqual(['pull --rebase', 'add --', 'commit -m', 'push origin']);
    expect(gitCalls[1]).toEqual(['add', '--', 'queue/paused/weekly-report']);
  });

  it('refuses without a valid session, writing nothing and touching no git', async () => {
    const repo = await scratch();
    const { runner: runGit, calls: gitCalls } = recordingGitRunner();

    const result = pauseCadence('weekly-report', noSession(), { repoRoot: repo, runGit });

    expect(result.ok).toBe(false);
    expect(existsSync(join(repo, 'queue', 'paused', 'weekly-report'))).toBe(false);
    expect(gitCalls).toHaveLength(0);
  });
});

describe('sigkillBackstop — escalates on the 60s→+30s (Q8) ladder', () => {
  it('sigkillBackstop escalates 60s→+30s ladder', () => {
    const requestedAt = 1_700_000_000_000;
    const kills: Array<{ pid: number; signal: string }> = [];
    const kill = (pid: number, signal: NodeJS.Signals): void => {
      kills.push({ pid, signal });
    };

    // Before the 60s grace elapses: no-op — nothing killed (injected clock, no real sleep).
    const before = sigkillBackstop(1234, { requestedAt }, { now: () => requestedAt + 30_000, kill });
    expect(before).toBe('none');
    expect(kills).toHaveLength(0);

    // At the 60s mark: escalate to the interrupt-equivalent backstop (SIGTERM — no live Broker handle
    // exists at this files-only floor, so a process-group signal is the "interrupt()" analogue).
    const atGrace = sigkillBackstop(1234, { requestedAt }, { now: () => requestedAt + 60_000, kill });
    expect(atGrace).toBe('interrupt');
    expect(kills).toEqual([{ pid: 1234, signal: 'SIGTERM' }]);

    // At +30s past that (90s total): SIGKILL — the backstop for a card that never self-halts.
    const atEscalate = sigkillBackstop(1234, { requestedAt }, { now: () => requestedAt + 90_000, kill });
    expect(atEscalate).toBe('sigkill');
    expect(kills[1]).toEqual({ pid: 1234, signal: 'SIGKILL' });
  });

  it('never kills before the grace period elapses, even for a long-idle card', () => {
    const requestedAt = 0;
    const kills: unknown[] = [];
    const kill = (pid: number, signal: NodeJS.Signals): void => {
      kills.push({ pid, signal });
    };
    expect(sigkillBackstop(99, { requestedAt }, { now: () => 59_999, kill })).toBe('none');
    expect(kills).toHaveLength(0);
  });

  it('honors custom ladder timings when supplied', () => {
    const requestedAt = 0;
    const kills: Array<{ pid: number; signal: string }> = [];
    const kill = (pid: number, signal: NodeJS.Signals): void => {
      kills.push({ pid, signal });
    };
    const ladder = { requestedAt, graceMs: 5_000, escalateMs: 2_000 };
    expect(sigkillBackstop(1, ladder, { now: () => 4_999, kill })).toBe('none');
    expect(sigkillBackstop(1, ladder, { now: () => 5_000, kill })).toBe('interrupt');
    expect(sigkillBackstop(1, ladder, { now: () => 7_000, kill })).toBe('sigkill');
  });
});
