/**
 * C1 — Composer multi-turn chat session wrapper. `spawnComposerTurn` is a THIN wrapper over the merged
 * `vibe/session.ts#spawnVibe`: it captures the CLI's own `session_id` from the `system` init record on
 * raw stdout and, on a continuing turn, injects `--resume <session_id>` into the spawn args. It re-uses
 * `spawnVibe`'s gate chain (preamble -> session -> rate-limit -> exactly-one-audit-row) VERBATIM — it
 * forks no gate. These tests prove exactly that, with the same hermetic fakes `session.test.ts` uses:
 * no real `claude`/`py`/`git` binary, no real STOP file, no real `ledgers/audit/**` write.
 */
import { describe, expect, it, vi } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import { rateLimit, lockout } from '../security/ratelimit.ts';
import type { LockoutGuard } from '../security/ratelimit.ts';
import type { SessionInput, VibeDeps, VibeProcess, VibeSpawner } from '../vibe/session.ts';
import { spawnComposerTurn } from './session.ts';

const SECRET = Buffer.from('composer-test-secret-do-not-reuse');
const SESSION_CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };

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

/** A fake `VibeProcess` exposing its registered callbacks so a test can drive stdout/exit manually. */
function fakeProcess() {
  let stdoutCb: ((chunk: string) => void) | undefined;
  let exitCb: ((code: number | null) => void) | undefined;
  const proc: VibeProcess = {
    onStdout(cb) {
      stdoutCb = cb;
    },
    onStderr() {},
    onExit(cb) {
      exitCb = cb;
    },
    writeStdin() {},
    endStdin() {},
    kill() {},
  };
  return { proc, emitStdout: (c: string) => stdoutCb?.(c), emitExit: (n: number | null) => exitCb?.(n) };
}

/** Records every spawn (args + cwd) so refusal paths can assert zero spawns and resume args can be read. */
function recordingSpawner(processes: VibeProcess[] = []): { spawner: VibeSpawner; calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  let i = 0;
  const spawner: VibeSpawner = (args, cwd) => {
    calls.push({ args, cwd });
    return processes[i++] ?? fakeProcess().proc;
  };
  return { spawner, calls };
}

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

/** A permissive per-test guard so the vibe module's shared 5/min singleton never bleeds into these tests. */
function freshGuard(): LockoutGuard {
  return lockout(rateLimit({ limit: 1000, windowMs: 60_000 }), { threshold: 1000, lockoutMs: 1000 });
}

function baseDeps(overrides: Partial<VibeDeps> = {}): VibeDeps {
  return {
    repoRoot: '/repo',
    runPreamble: okPreamble(),
    appendAudit: recordingAppendAudit().fn,
    rateLimitGuard: freshGuard(),
    ...overrides,
  };
}

describe('spawnComposerTurn — CLI session_id capture', () => {
  it('captures_session_id_from_system_record: reads session_id off the system init record, once', () => {
    const fp = fakeProcess();
    const { spawner } = recordingSpawner([fp.proc]);
    const captured: string[] = [];
    const outcome = spawnComposerTurn(
      'summarize the repo',
      null,
      validSession(),
      { onDelta: vi.fn(), onSessionId: (id) => captured.push(id) },
      baseDeps({ spawn: spawner }),
    );
    expect(outcome.ok).toBe(true);

    // The `system` init record carries the CLI session id — the fold drops it from the timeline, but
    // spawnVibe still hands every parsed record to onDelta's second arg, where we scan for it.
    fp.emitStdout(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-abc', cwd: '/repo' })}\n`);
    expect(captured).toEqual(['sess-abc']);

    // A second system record does not re-capture — the id is fixed for the life of the turn.
    fp.emitStdout(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-xyz' })}\n`);
    expect(captured).toEqual(['sess-abc']);
  });
});

describe('spawnComposerTurn — resume-flag injection', () => {
  it('second_turn_spawns_with_resume_flag: a continuing turn appends --resume <id> to the vibe args', () => {
    const { spawner, calls } = recordingSpawner([fakeProcess().proc, fakeProcess().proc]);
    const deps = baseDeps({ spawn: spawner });

    // First turn: no prior session — the untouched vibe arg vector.
    spawnComposerTurn('turn one', null, validSession(), { onDelta: vi.fn() }, deps);
    expect(calls[0].args).toEqual(['--print', '--output-format', 'stream-json']);

    // Second turn: carries the captured id — spawns with --resume appended, nothing else changed.
    spawnComposerTurn('turn two', 'sess-abc', validSession(), { onDelta: vi.fn() }, deps);
    expect(calls[1].args).toEqual(['--print', '--output-format', 'stream-json', '--resume', 'sess-abc']);
    expect(calls[1].cwd).toBe('/repo');
  });
});

describe('spawnComposerTurn — reuses spawnVibe`s gate chain verbatim', () => {
  it('each_turn_is_independently_gated_and_audited: every turn re-runs the gate and writes one vibe-spawn row', () => {
    const audit = recordingAppendAudit();
    const { spawner, calls } = recordingSpawner([fakeProcess().proc, fakeProcess().proc]);
    const deps = baseDeps({ appendAudit: audit.fn, spawn: spawner });

    const t1 = spawnComposerTurn('one', null, validSession(), { onDelta: vi.fn() }, deps);
    const t2 = spawnComposerTurn('two', 'sess-1', validSession(), { onDelta: vi.fn() }, deps);

    expect(t1.ok && t2.ok).toBe(true);
    expect(calls).toHaveLength(2); // two discrete spawns — a turn == a spawn
    // Exactly one audit row per turn, and the action is spawnVibe's own `vibe-spawn` — proof we reuse
    // its audit sink rather than minting a new one.
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows.map((r) => r.event.action)).toEqual(['vibe-spawn', 'vibe-spawn']);
    expect(audit.rows.map((r) => r.event.result)).toEqual(['spawned', 'spawned']);
  });

  it('frozen_fleet_refuses_before_any_spawn: a STOP-frozen fleet refuses, spawns nothing, captures no id, audits once', () => {
    const audit = recordingAppendAudit();
    const { spawner, calls } = recordingSpawner();
    const captured: string[] = [];
    const outcome = spawnComposerTurn(
      'do something',
      'sess-prev',
      validSession(),
      { onDelta: vi.fn(), onSessionId: (id) => captured.push(id) },
      baseDeps({ runPreamble: frozenPreamble('STOP file present'), appendAudit: audit.fn, spawn: spawner }),
    );
    expect(outcome).toEqual({ ok: false, reason: 'fleet-frozen', problems: ['STOP file present'] });
    expect(calls).toHaveLength(0);
    expect(captured).toHaveLength(0);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].event.result).toBe('fleet-frozen');
  });
});
