/**
 * D2.7 — vibe-code chat box server-side spawn path. Every test injects fakes for the preamble
 * runner, the rate-limit/lockout guard, `appendAudit`, and the `claude` spawner itself (see
 * `session.ts`'s module docstring for the DI rationale) — no test here ever shells a real `py`/`git`/
 * `claude` binary, touches a real STOP file, or touches a real `ledgers/audit/**` file. Fully hermetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import { rateLimit, lockout } from '../security/ratelimit.ts';
import type { LockoutGuard } from '../security/ratelimit.ts';
import { drainVibeProcesses, spawnVibe } from './session.ts';
import type { SessionInput, VibeDeps, VibeHandlers, VibeProcess, VibeSpawner } from './session.ts';

const SECRET = Buffer.from('vibe-test-secret-do-not-reuse');
const SESSION_CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };

afterEach(() => { drainVibeProcesses(); });

function okPreamble(): PreambleRunner {
  return () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' });
}

function frozenPreamble(problem: string): PreambleRunner {
  return () => ({ exitCode: 2, stdout: `PREAMBLE FAIL: ${problem}\n`, stderr: '' });
}

function validSession(sub = 'operator-1'): SessionInput {
  const { token } = mintSession(sub, SESSION_CONFIG);
  return { token, config: SESSION_CONFIG };
}

/** A fake `VibeProcess`: records writes/kills, and exposes its registered callbacks so a test can
 *  drive stdout/stderr/exit manually — no real child process is ever spawned. */
function fakeProcess() {
  let stdoutCb: ((chunk: string) => void) | undefined;
  let stderrCb: ((chunk: string) => void) | undefined;
  let exitCb: ((code: number | null) => void) | undefined;
  const writes: string[] = [];
  let killed = false;
  let ended = false;
  const proc: VibeProcess = {
    onStdout(cb) {
      stdoutCb = cb;
    },
    onStderr(cb) {
      stderrCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
    },
    writeStdin(text) {
      writes.push(text);
    },
    endStdin() {
      ended = true;
    },
    kill() {
      killed = true;
    },
  };
  return {
    proc,
    emitStdout: (chunk: string) => stdoutCb?.(chunk),
    emitStderr: (chunk: string) => stderrCb?.(chunk),
    emitExit: (code: number | null) => exitCb?.(code),
    writes,
    isKilled: () => killed,
    isEnded: () => ended,
  };
}

/** Records every spawn invocation (args + cwd) so refusal paths can assert zero spawns occurred. */
function recordingSpawner(processes: VibeProcess[] = []): { spawner: VibeSpawner; calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  let i = 0;
  const spawner: VibeSpawner = (args, cwd) => {
    calls.push({ args, cwd });
    return processes[i++] ?? fakeProcess().proc;
  };
  return { spawner, calls };
}

/** Records every `appendAudit` call so tests can assert exactly-one-row-per-call, in order. */
function recordingAppendAudit(): {
  fn: (repoRoot: string, event: AuditEvent) => AuditRow;
  rows: Array<{ repoRoot: string; event: AuditEvent }>;
} {
  const rows: Array<{ repoRoot: string; event: AuditEvent }> = [];
  const fn = (repoRoot: string, event: AuditEvent): AuditRow => {
    rows.push({ repoRoot, event });
    return { ts: 'fixed-ts', ...event };
  };
  return { fn, rows };
}

function noopHandlers(overrides: Partial<VibeHandlers> = {}): VibeHandlers {
  return { onDelta: vi.fn(), ...overrides };
}

function baseDeps(overrides: Partial<VibeDeps> = {}): VibeDeps {
  const audit = recordingAppendAudit();
  return {
    repoRoot: '/repo',
    runPreamble: okPreamble(),
    appendAudit: audit.fn,
    ...overrides,
  };
}

describe('spawnVibe — spawned-child containment', async () => {
  it('drains every tracked child during daemon shutdown', async () => {
    const first = fakeProcess();
    const second = fakeProcess();
    const { spawner } = recordingSpawner([first.proc, second.proc]);
    const guard = lockout(rateLimit({ limit: 10, windowMs: 60_000 }), { threshold: 10, lockoutMs: 1 });
    const deps = baseDeps({ spawn: spawner, rateLimitGuard: guard });
    expect((await spawnVibe('one', validSession(), noopHandlers(), deps)).ok).toBe(true);
    expect((await spawnVibe('two', validSession(), noopHandlers(), deps)).ok).toBe(true);
    expect(drainVibeProcesses()).toBe(2);
    expect(first.isKilled()).toBe(true);
    expect(second.isKilled()).toBe(true);
    expect(drainVibeProcesses()).toBe(0);
  });

  it('kills an already-spawned child if the audit sink throws', async () => {
    const child = fakeProcess();
    const { spawner } = recordingSpawner([child.proc]);
    await expect(spawnVibe('run safely', validSession(), noopHandlers(), baseDeps({
      spawn: spawner,
      rateLimitGuard: lockout(rateLimit({ limit: 10, windowMs: 60_000 }), { threshold: 10, lockoutMs: 1 }),
      appendAudit: () => { throw new Error('audit unavailable'); },
    }))).rejects.toThrow('audit unavailable');
    expect(child.isKilled()).toBe(true);
  });

  it('contains an asynchronous transcript callback failure and stops the child', async () => {
    const child = fakeProcess();
    const { spawner } = recordingSpawner([child.proc]);
    const outcome = await spawnVibe('run safely', validSession(), noopHandlers({
      onDelta: () => { throw new Error('state sink unavailable'); },
    }), baseDeps({
      spawn: spawner,
      rateLimitGuard: lockout(rateLimit({ limit: 10, windowMs: 60_000 }), { threshold: 10, lockoutMs: 1 }),
    }));
    expect(outcome.ok).toBe(true);
    expect(() => child.emitStdout(`${JSON.stringify({ type: 'assistant', message: { model: 'x', content: [{ type: 'text', text: 'hello' }] } })}\n`)).not.toThrow();
    expect(child.isKilled()).toBe(true);
  });
});

describe('spawnVibe — preamble gate (runs first, spawns nothing on failure)', async () => {
  it('refuses to spawn when STOP is present / ANTHROPIC_API_KEY set / budget exceeded — no claude child spawned', async () => {
    const { spawner, calls } = recordingSpawner();
    const audit = recordingAppendAudit();

    const stopDeps = baseDeps({
      runPreamble: frozenPreamble('STOP file present — fleet is frozen'),
      spawn: spawner,
      appendAudit: audit.fn,
    });
    const stopResult = await spawnVibe('do something', validSession(), noopHandlers(), stopDeps);
    expect(stopResult).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['STOP file present — fleet is frozen'],
    });

    const apiKeyDeps = baseDeps({
      runPreamble: frozenPreamble('ANTHROPIC_API_KEY is set — would silently bill to API; unset it'),
      spawn: spawner,
      appendAudit: audit.fn,
    });
    const apiKeyResult = await spawnVibe('do something', validSession(), noopHandlers(), apiKeyDeps);
    expect(apiKeyResult).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['ANTHROPIC_API_KEY is set — would silently bill to API; unset it'],
    });

    const budgetDeps = baseDeps({
      runPreamble: frozenPreamble('daily budget breached: $6.00 >= $5.00'),
      spawn: spawner,
      appendAudit: audit.fn,
    });
    const budgetResult = await spawnVibe('do something', validSession(), noopHandlers(), budgetDeps);
    expect(budgetResult).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['daily budget breached: $6.00 >= $5.00'],
    });

    // The load-bearing assertion: a frozen/ungoverned fleet must spawn NOTHING, ever.
    expect(calls).toHaveLength(0);
    // But each refusal still produced exactly one audit row.
    expect(audit.rows).toHaveLength(3);
    expect(audit.rows.every((r) => r.event.action === 'vibe-spawn' && r.event.result === 'fleet-frozen')).toBe(true);
  });
});

describe('spawnVibe — WebAuthn session gate (checked only after the preamble passes)', async () => {
  it('refuses to spawn without a WebAuthn session', async () => {
    const { spawner, calls } = recordingSpawner();
    const deps = baseDeps({ spawn: spawner });
    const noSession: SessionInput = { token: null, config: SESSION_CONFIG };

    const result = await spawnVibe('do something', noSession, noopHandlers(), deps);
    expect(result).toEqual({
      ok: false,
      reason: 'unauthenticated',
      detail: 'no WebAuthn session token supplied',
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses an expired/tampered session token the same way as a missing one — no spawn', async () => {
    const { spawner, calls } = recordingSpawner();
    const deps = baseDeps({ spawn: spawner });
    const expiredConfig: SessionConfig = { secret: SECRET, now: () => 0, ttlMs: 1 };
    const { token } = mintSession('operator-1', expiredConfig);
    const laterSession: SessionInput = { token, config: { secret: SECRET, now: () => 1_000_000 } };

    const result = await spawnVibe('do something', laterSession, noopHandlers(), deps);
    expect(result).toEqual({ ok: false, reason: 'unauthenticated', detail: 'expired' });
    expect(calls).toHaveLength(0);
  });
});

describe('spawnVibe — rate-limit + lockout (D2.9 ratelimit.ts, keyed by verified session subject)', async () => {
  function fakeClock(start = 0) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  it('rate-limits and locks out after repeated attempts — no spawn once locked out', async () => {
    const clock = fakeClock();
    const guard: LockoutGuard = lockout(rateLimit({ limit: 1, windowMs: 1000, now: clock.now }), {
      threshold: 2,
      lockoutMs: 60_000,
      now: clock.now,
    });
    const { spawner, calls } = recordingSpawner([fakeProcess().proc, fakeProcess().proc, fakeProcess().proc]);
    const deps = baseDeps({ spawn: spawner, rateLimitGuard: guard });

    // First attempt: allowed by the underlying window, so it spawns.
    const first = await spawnVibe('one', validSession(), noopHandlers(), deps);
    expect(first.ok).toBe(true);

    // Second attempt (same session, inside the window): throttled, no spawn.
    const second = await spawnVibe('two', validSession(), noopHandlers(), deps);
    expect(second).toEqual({ ok: false, reason: 'rate-limited', retryAfterMs: expect.any(Number) });

    // Third attempt: consecutive throttle streak trips the lockout threshold — no spawn.
    const third = await spawnVibe('three', validSession(), noopHandlers(), deps);
    expect(third).toEqual({ ok: false, reason: 'locked-out', retryAfterMs: expect.any(Number) });

    // Even once the underlying window would allow a fresh hit, the lockout still holds.
    clock.advance(1001);
    const fourth = await spawnVibe('four', validSession(), noopHandlers(), deps);
    expect(fourth).toEqual({ ok: false, reason: 'locked-out', retryAfterMs: expect.any(Number) });

    // Only the first call ever reached the spawner.
    expect(calls).toHaveLength(1);
  });

  it('tracks the rate limit independently per verified session subject', async () => {
    const clock = fakeClock();
    const guard: LockoutGuard = lockout(rateLimit({ limit: 1, windowMs: 1000, now: clock.now }), {
      threshold: 2,
      lockoutMs: 60_000,
      now: clock.now,
    });
    const { spawner, calls } = recordingSpawner([fakeProcess().proc, fakeProcess().proc]);
    const deps = baseDeps({ spawn: spawner, rateLimitGuard: guard });

    const a = await spawnVibe('from a', validSession('operator-a'), noopHandlers(), deps);
    const b = await spawnVibe('from b', validSession('operator-b'), noopHandlers(), deps);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe('spawnVibe — audit coverage (D2.9 appendAudit, independent trail)', async () => {
  it('every spawn writes an audit-log row — attempted (refused) and actual (spawned) alike', async () => {
    const audit = recordingAppendAudit();
    const { spawner } = recordingSpawner([fakeProcess().proc]);

    // Refused at the preamble gate.
    await spawnVibe('x', validSession(), noopHandlers(), baseDeps({ runPreamble: frozenPreamble('STOP file present'), appendAudit: audit.fn, spawn: spawner }));
    // Refused at the session gate.
    await spawnVibe('x', { token: null, config: SESSION_CONFIG }, noopHandlers(), baseDeps({ appendAudit: audit.fn, spawn: spawner }));
    // Actually spawns.
    await spawnVibe('x', validSession(), noopHandlers(), baseDeps({ appendAudit: audit.fn, spawn: spawner }));

    expect(audit.rows).toHaveLength(3);
    expect(audit.rows.map((r) => r.event.action)).toEqual(['vibe-spawn', 'vibe-spawn', 'vibe-spawn']);
    expect(audit.rows.map((r) => r.event.result)).toEqual(['fleet-frozen', 'unauthenticated', 'spawned']);
    // The successful spawn's row records the verified owner (session subject).
    expect(audit.rows[2].event.owner).toBe('operator-1');
  });

  it('appendAudit is called with repoRoot passed straight through', async () => {
    const audit = recordingAppendAudit();
    const { spawner } = recordingSpawner([fakeProcess().proc]);
    await spawnVibe('x', validSession(), noopHandlers(), baseDeps({ repoRoot: '/some/repo', appendAudit: audit.fn, spawn: spawner }));
    expect(audit.rows[0].repoRoot).toBe('/some/repo');
  });
});

describe('spawnVibe — stream-json parsing into the shared TimelineModel (D0.7 foldRecords, reused)', async () => {
  it('parses stream-json deltas into the timeline model as stdout chunks arrive', async () => {
    const fp = fakeProcess();
    const { spawner } = recordingSpawner([fp.proc]);
    const deltas: Array<{ turnsLen: number; lastText: string | undefined }> = [];
    const handlers: VibeHandlers = {
      onDelta: (model) => {
        const lastTurn = model.turns[model.turns.length - 1];
        const lastStep = lastTurn?.steps[lastTurn.steps.length - 1];
        deltas.push({ turnsLen: model.turns.length, lastText: lastStep?.text });
      },
    };
    const deps = baseDeps({ spawn: spawner });

    const result = await spawnVibe('summarize the repo', validSession(), handlers, deps);
    expect(result.ok).toBe(true);

    // One complete stream-json line (an assistant text message) arrives in one chunk.
    fp.emitStdout(
      `${JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: 'hi there' }] } })}\n`,
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual({ turnsLen: 1, lastText: 'hi there' });

    // A second line arrives split across two chunks (partial-line buffering, mirroring tailFrom).
    const secondLine = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: 'second turn' }] },
    });
    fp.emitStdout(secondLine.slice(0, 10));
    expect(deltas).toHaveLength(1); // no complete line yet — no delta fired
    fp.emitStdout(`${secondLine.slice(10)}\n`);
    expect(deltas).toHaveLength(2);
    expect(deltas[1]).toEqual({ turnsLen: 2, lastText: 'second turn' });

    // The prompt was written to stdin (never argv) and stdin was closed.
    expect(fp.writes).toEqual(['summarize the repo']);
    expect(fp.isEnded()).toBe(true);

    // Stop wiring: the returned kill() reaches the underlying process.
    if (result.ok) result.kill();
    expect(fp.isKilled()).toBe(true);
  });

  it('a malformed stream-json line is dropped without crashing the session (defensive, mirrors tailFrom)', async () => {
    const fp = fakeProcess();
    const { spawner } = recordingSpawner([fp.proc]);
    const onDelta = vi.fn();
    const deps = baseDeps({ spawn: spawner });

    await spawnVibe('x', validSession(), { onDelta }, deps);

    fp.emitStdout('not json at all\n');
    expect(onDelta).not.toHaveBeenCalled();

    fp.emitStdout(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } })}\n`);
    expect(onDelta).toHaveBeenCalledTimes(1);
  });
});

describe('spawnVibe — CLI-subprocess invocation shape', async () => {
  it('spawns claude with --print --output-format stream-json under repoRoot, args only (never prompt in argv)', async () => {
    const { spawner, calls } = recordingSpawner([fakeProcess().proc]);
    const deps = baseDeps({ repoRoot: '/repo/root', spawn: spawner });

    await spawnVibe('a secret-shaped prompt', validSession(), noopHandlers(), deps);

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['--print', '--verbose', '--output-format', 'stream-json']);
    expect(calls[0].cwd).toBe('/repo/root');
    expect(calls[0].args.join(' ')).not.toContain('secret-shaped prompt');
  });
});
