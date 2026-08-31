import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { sigkillBackstop, writeStop, type FloorDeps, type SessionInput } from './floor.ts';

const SECRET = Buffer.from('floor-test-secret-do-not-reuse');
const SESSION_CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };
const roots: string[] = [];

function validSession(): SessionInput {
  const { token } = mintSession('operator-1', SESSION_CONFIG);
  return { token, config: SESSION_CONFIG };
}

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'stop-floor-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('writeStop', () => {
  it('creates the local STOP file only for a valid session', async () => {
    const repo = await scratch();
    const deps: FloorDeps = { repoRoot: repo };
    expect(writeStop(validSession(), deps)).toMatchObject({ ok: true, path: 'STOP' });
    expect(existsSync(join(repo, 'STOP'))).toBe(true);
  });

  it('refuses missing and expired sessions without writing', async () => {
    const repo = await scratch();
    expect(writeStop({ token: null, config: SESSION_CONFIG }, { repoRoot: repo })).toEqual({
      ok: false, reason: 'unauthenticated', detail: 'no WebAuthn session token supplied',
    });
    const expiredConfig: SessionConfig = { secret: SECRET, now: () => 0, ttlMs: 1 };
    const { token } = mintSession('operator-1', expiredConfig);
    expect(writeStop({ token, config: { secret: SECRET, now: () => 1_000_000 } }, { repoRoot: repo }))
      .toEqual({ ok: false, reason: 'unauthenticated', detail: 'expired' });
    expect(existsSync(join(repo, 'STOP'))).toBe(false);
  });
});

describe('sigkillBackstop', () => {
  it('escalates on the 60s then +30s Q8 ladder', () => {
    const requestedAt = 1_700_000_000_000;
    const kills: Array<{ pid: number; signal: string }> = [];
    const kill = (pid: number, signal: NodeJS.Signals): void => { kills.push({ pid, signal }); };
    expect(sigkillBackstop(1234, { requestedAt }, { now: () => requestedAt + 30_000, kill })).toBe('none');
    expect(sigkillBackstop(1234, { requestedAt }, { now: () => requestedAt + 60_000, kill })).toBe('interrupt');
    expect(sigkillBackstop(1234, { requestedAt }, { now: () => requestedAt + 90_000, kill })).toBe('sigkill');
    expect(kills).toEqual([{ pid: 1234, signal: 'SIGTERM' }, { pid: 1234, signal: 'SIGKILL' }]);
  });

  it('honors a custom ladder without acting before grace', () => {
    const kills: string[] = [];
    const kill = (_pid: number, signal: NodeJS.Signals): void => { kills.push(signal); };
    const ladder = { requestedAt: 0, graceMs: 5_000, escalateMs: 2_000 };
    expect(sigkillBackstop(1, ladder, { now: () => 4_999, kill })).toBe('none');
    expect(sigkillBackstop(1, ladder, { now: () => 5_000, kill })).toBe('interrupt');
    expect(sigkillBackstop(1, ladder, { now: () => 7_000, kill })).toBe('sigkill');
    expect(kills).toEqual(['SIGTERM', 'SIGKILL']);
  });
});
