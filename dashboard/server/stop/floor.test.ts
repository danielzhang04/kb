/**
 * D2.8 — files-only stop floor. Every test injects a fake `OpsGitRunner` / clock (see
 * `floor.ts`'s module docstring for why: hermetic — no test here ever shells a real git binary,
 * touches the network, or sleeps a real timer). `writeStop` and `pauseCadence` DO touch a real
 * filesystem (a throwaway `mkdtemp` scratch dir), mirroring the established pattern in
 * `dashboard/server/audit/log.test.ts` — only the git/py subprocess boundary is faked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import {
  pauseCadence,
  sigkillBackstop,
  writeStop,
} from './floor.ts';
import type { FloorDeps, OpsGitRunner, SessionInput } from './floor.ts';

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

function declareCadence(repo: string, name = 'weekly-report'): void {
  writeFileSync(
    join(repo, 'HEARTBEAT.md'),
    `# test\n\n\`\`\`yaml\ncadences:\n  - name: ${name}\n    schedule: weekly:sat\n\`\`\`\n`,
    'utf8',
  );
}
afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

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

describe('pauseCadence — writes queue/paused/<name> via the governed ops path', () => {
  it('writes queue/paused/<name> so dispatch.due() skips the next beat, via the governed ops path', async () => {
    const repo = await scratch();
    declareCadence(repo);
    const { runner: runGit, calls: gitCalls } = recordingGitRunner();

    const result = await pauseCadence('weekly-report', validSession(), { repoRoot: repo, runGit });

    expect(result.ok).toBe(true);
    expect(existsSync(join(repo, 'queue', 'paused', 'weekly-report'))).toBe(true);

    const verbs = gitCalls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toEqual(['pull --rebase', 'add --', 'commit -m', 'push origin']);
    expect(gitCalls[1]).toEqual(['add', '--', 'queue/paused/weekly-report']);
  });

  it.each(['../../STOP', '..\\..\\STOP', 'nightly-review/../x', 'undeclared', '', 'bad\0name'])(
    'refuses invalid or undeclared cadence %j before a marker or git/outbox action',
    async (name) => {
      const repo = await scratch();
      declareCadence(repo, 'nightly-review');
      const { runner: runGit, calls: gitCalls } = recordingGitRunner();

      const result = await pauseCadence(name, validSession(), { repoRoot: repo, runGit });

      expect(result).toMatchObject({ ok: false, reason: 'invalid-cadence' });
      expect(existsSync(join(repo, 'STOP'))).toBe(false);
      expect(existsSync(join(repo, 'queue', 'paused'))).toBe(false);
      expect(gitCalls).toEqual([]);
    },
  );

  it('refuses without a valid session, writing nothing and touching no git', async () => {
    const repo = await scratch();
    declareCadence(repo);
    const { runner: runGit, calls: gitCalls } = recordingGitRunner();

    const result = await pauseCadence('weekly-report', noSession(), { repoRoot: repo, runGit });

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
