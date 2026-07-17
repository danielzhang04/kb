import { describe, it, expect, vi } from 'vitest';
import { SessionOwner } from './index.ts';
import type { SpawnSpec } from './index.ts';
import { assertFleetRunnable } from './preambleGate.ts';
import type { PreambleRunner } from './preambleGate.ts';

/** A preamble runner that reproduces `scripts/preamble.py`'s exact stdout contract. */
const okRunner: PreambleRunner = () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' });
const failRunner = (msg: string): PreambleRunner => () => ({
  exitCode: 2,
  stdout: `PREAMBLE FAIL: ${msg}\n`,
  stderr: '',
});

/** A recording spawner so we can assert whether a session was EVER constructed. */
function recordingSpawner() {
  const calls: SpawnSpec[] = [];
  const spawner = (spec: SpawnSpec) => {
    calls.push(spec);
    return {
      id: 'sess-1',
      kind: 'broker-cli' as const,
      cardId: spec.cardId,
      card: spec.card,
      createdAt: 0,
      live: true,
      interrupt() {},
      sigterm() {},
      sigkill() {},
      steer() {},
    };
  };
  return { spawner, calls };
}

const spec: SpawnSpec = { cardId: 'kb-0001', prompt: 'do the thing' };

describe('broker/preambleGate — spawnSession is gated by assertFleetRunnable', () => {
  it('spawnSession REFUSES to spawn when STOP is present (frozen fleet not re-activated by a Broker spawn)', () => {
    const { spawner, calls } = recordingSpawner();
    const owner = new SessionOwner({
      repoRoot: '/repo',
      runPreamble: failRunner('STOP file present — fleet is frozen'),
      cliSpawner: spawner,
    });
    const outcome = owner.spawnSession(spec);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('fleet-frozen');
    expect(calls).toHaveLength(0); // no session was constructed
  });

  it('spawnSession REFUSES when ANTHROPIC_API_KEY is set (preamble catches it)', () => {
    const { spawner, calls } = recordingSpawner();
    const owner = new SessionOwner({
      repoRoot: '/repo',
      runPreamble: failRunner('ANTHROPIC_API_KEY is set — would silently bill to API; unset it'),
      cliSpawner: spawner,
    });
    const outcome = owner.spawnSession(spec);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('fleet-frozen');
    expect(calls).toHaveLength(0);
  });

  it('spawnSession REFUSES when the daily budget is exceeded', () => {
    const { spawner, calls } = recordingSpawner();
    const owner = new SessionOwner({
      repoRoot: '/repo',
      runPreamble: failRunner('daily budget breached: $6.00 >= $5.00'),
      cliSpawner: spawner,
    });
    const outcome = owner.spawnSession(spec);
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('spawnSession PROCEEDS only when the preamble passes', () => {
    const { spawner, calls } = recordingSpawner();
    const owner = new SessionOwner({ repoRoot: '/repo', runPreamble: okRunner, cliSpawner: spawner });
    const outcome = owner.spawnSession(spec);
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('assertFleetRunnable is called BEFORE any spawner runs (order-of-operations)', () => {
    const seen: string[] = [];
    const runPreamble: PreambleRunner = () => {
      seen.push('preamble');
      return { exitCode: 2, stdout: 'PREAMBLE FAIL: STOP file present — fleet is frozen\n', stderr: '' };
    };
    const spawner = vi.fn(() => {
      seen.push('spawn');
      throw new Error('should never be reached');
    });
    const owner = new SessionOwner({ repoRoot: '/repo', runPreamble, cliSpawner: spawner as never });
    owner.spawnSession(spec);
    expect(seen).toEqual(['preamble']); // spawner never ran
    expect(spawner).not.toHaveBeenCalled();
  });

  it('assertFleetRunnable keeps the raw FAIL tail as one opaque message', () => {
    const res = assertFleetRunnable('/repo', failRunner('STOP file present — fleet is frozen'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problems[0]).toContain('STOP file present');
  });
});
