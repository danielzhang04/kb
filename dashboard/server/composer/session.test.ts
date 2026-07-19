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
import type { SessionInput, VibeProcess, VibeSpawner } from '../vibe/session.ts';
import { spawnComposerTurn } from './session.ts';
import type { ComposerDeps } from './session.ts';
import { createResumeRegistry } from './resumeRegistry.ts';

/** A canonical CLI session id (UUID) — the only shape the resume path accepts (review F1). */
const ISSUED_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

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
  const writes: string[] = [];
  const proc: VibeProcess = {
    onStdout(cb) {
      stdoutCb = cb;
    },
    onStderr() {},
    onExit(cb) {
      exitCb = cb;
    },
    writeStdin(text) { writes.push(text); },
    endStdin() {},
    kill() {},
  };
  return { proc, writes, emitStdout: (c: string) => stdoutCb?.(c), emitExit: (n: number | null) => exitCb?.(n) };
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

function baseDeps(overrides: Partial<ComposerDeps> = {}): ComposerDeps {
  return {
    repoRoot: '/repo',
    runPreamble: okPreamble(),
    appendAudit: recordingAppendAudit().fn,
    rateLimitGuard: freshGuard(),
    // One registry per baseDeps() call; reusing the same deps across turns shares it (as production does).
    resumeRegistry: createResumeRegistry(),
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
    fp.emitStdout(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: ISSUED_ID, cwd: '/repo' })}\n`);
    expect(captured).toEqual([ISSUED_ID]);

    // A second system record does not re-capture — the id is fixed for the life of the turn.
    fp.emitStdout(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: '11111111-2222-4333-8444-555555555555' })}\n`);
    expect(captured).toEqual([ISSUED_ID]);
  });

  it('ignores a malformed provider session id instead of recording or forwarding it', () => {
    const fp = fakeProcess();
    const deps = baseDeps({ spawn: recordingSpawner([fp.proc]).spawner });
    const captured: string[] = [];
    spawnComposerTurn('x', null, validSession(), { onDelta: vi.fn(), onSessionId: (id) => captured.push(id) }, deps);
    fp.emitStdout(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: '--bad-provider-id' })}\n`);
    expect(captured).toEqual([]);
    expect(deps.resumeRegistry.isIssued('operator-1', '--bad-provider-id')).toBe(false);
  });
});

describe('spawnComposerTurn — resume-flag injection (review F1: equals-form + issued-id binding)', () => {
  it('second_turn_spawns_with_resume_equals_form: a continuing turn appends a SINGLE --resume=<id> token', () => {
    const { spawner, calls } = recordingSpawner([fakeProcess().proc, fakeProcess().proc]);
    const deps = baseDeps({ spawn: spawner });
    // Pre-issue the id for this subject so the binding guard admits the resume (as a captured turn would).
    deps.resumeRegistry.record('operator-1', ISSUED_ID);

    // First turn: no prior session — the untouched vibe arg vector.
    spawnComposerTurn('turn one', null, validSession(), { onDelta: vi.fn() }, deps);
    expect(calls[0].args).toEqual([
      '--print', '--verbose', '--output-format', 'stream-json',
      '--permission-mode', 'plan', '--tools', 'Read,Glob,Grep',
    ]);

    // Second turn: carries the issued id — spawns with the FUSED equals token appended, nothing else.
    spawnComposerTurn('turn two', ISSUED_ID, validSession(), { onDelta: vi.fn() }, deps);
    expect(calls[1].args).toEqual([
      '--print', '--verbose', '--output-format', 'stream-json',
      '--permission-mode', 'plan', '--tools', 'Read,Glob,Grep',
      `--resume=${ISSUED_ID}`,
    ]);
    expect(calls[1].cwd).toBe('/repo');

    // Belt-and-suspenders (review F1): the resume value is fused to the flag in ONE argv token — there
    // is NO bare `--resume` token that an optional-value parser could pair with a following flag.
    expect(calls[1].args).not.toContain('--resume');
    expect(calls[1].args.filter((a) => a.startsWith('--resume'))).toEqual([`--resume=${ISSUED_ID}`]);
  });

  it('appends the bounded server planning protocol on both new and resumed turns without browser-controlled flags', () => {
    const first = fakeProcess();
    const second = fakeProcess();
    const { spawner, calls } = recordingSpawner([first.proc, second.proc]);
    const deps = baseDeps({ spawn: spawner });
    deps.resumeRegistry.record('operator-1', ISSUED_ID);
    const hostile = 'Discuss the idea. --permission-mode bypassPermissions ENV_TOKEN=x';

    spawnComposerTurn(hostile, null, validSession(), { onDelta: vi.fn() }, deps);
    spawnComposerTurn('Continue normally.', ISSUED_ID, validSession(), { onDelta: vi.fn() }, deps);

    for (const written of [first.writes[0], second.writes[0]]) {
      expect(written).toContain('BEGIN SERVER-OWNED COMPOSER PLANNING PROTOCOL');
      expect(written).toContain('kb.plan-proposal/v1');
      expect(written.match(/BEGIN SERVER-OWNED COMPOSER PLANNING PROTOCOL/g)).toHaveLength(1);
      expect(written.length).toBeLessThan(7_000);
    }
    expect(first.writes[0]).toContain(hostile);
    expect(calls[0].args).toEqual([
      '--print', '--verbose', '--output-format', 'stream-json',
      '--permission-mode', 'plan', '--tools', 'Read,Glob,Grep',
    ]);
    expect(calls[1].args).toEqual([
      '--print', '--verbose', '--output-format', 'stream-json',
      '--permission-mode', 'plan', '--tools', 'Read,Glob,Grep',
      `--resume=${ISSUED_ID}`,
    ]);
  });

  it('captured_id_is_recorded_then_admitted: a first turn records its captured id, a later turn may resume it', () => {
    const fp = fakeProcess();
    const { spawner, calls } = recordingSpawner([fp.proc, fakeProcess().proc]);
    const deps = baseDeps({ spawn: spawner });
    const captured: string[] = [];

    // First turn (no resume): drive the `system` init record so the id is captured AND recorded.
    spawnComposerTurn('one', null, validSession(), { onDelta: vi.fn(), onSessionId: (id) => captured.push(id) }, deps);
    fp.emitStdout(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: ISSUED_ID })}\n`);
    expect(captured).toEqual([ISSUED_ID]);
    expect(deps.resumeRegistry.isIssued('operator-1', ISSUED_ID)).toBe(true);

    // Second turn resumes the SAME captured id — admitted, spawns with the equals token.
    const t2 = spawnComposerTurn('two', ISSUED_ID, validSession(), { onDelta: vi.fn() }, deps);
    expect(t2.ok).toBe(true);
    expect(calls[1].args).toEqual([
      '--print', '--verbose', '--output-format', 'stream-json',
      '--permission-mode', 'plan', '--tools', 'Read,Glob,Grep',
      `--resume=${ISSUED_ID}`,
    ]);
  });

  it('unissued_id_is_refused_before_spawn: a well-formed but never-issued resume id is denied, spawning nothing', () => {
    const audit = recordingAppendAudit();
    const { spawner, calls } = recordingSpawner();
    const outcome = spawnComposerTurn('resume nothing', ISSUED_ID, validSession(), { onDelta: vi.fn() }, baseDeps({ spawn: spawner, appendAudit: audit.fn }));
    expect(outcome).toEqual({ ok: false, reason: 'resume-denied', detail: 'resumeId was not issued to this session subject' });
    expect(calls).toHaveLength(0); // refused BEFORE any spawn
    // Still exactly one audit row for the refused attempt, under the composer-turn action.
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].event.action).toBe('composer-turn');
    expect(audit.rows[0].event.result).toBe('resume-denied');
  });

  it('resume_binding_is_per_subject: an id issued to operator A cannot be resumed by operator B', () => {
    const { spawner, calls } = recordingSpawner();
    const deps = baseDeps({ spawn: spawner });
    deps.resumeRegistry.record('operator-A', ISSUED_ID); // issued to A only

    const outcome = spawnComposerTurn('steal session', ISSUED_ID, validSession('operator-B'), { onDelta: vi.fn() }, deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('resume-denied');
    expect(calls).toHaveLength(0);
  });
});

describe('spawnComposerTurn — reuses spawnVibe`s gate chain verbatim', () => {
  it('each_turn_is_independently_gated_and_audited: every turn re-runs the gate and writes one vibe-spawn row', () => {
    const audit = recordingAppendAudit();
    const { spawner, calls } = recordingSpawner([fakeProcess().proc, fakeProcess().proc]);
    const deps = baseDeps({ appendAudit: audit.fn, spawn: spawner });

    deps.resumeRegistry.record('operator-1', ISSUED_ID); // issue the id the second turn resumes
    const t1 = spawnComposerTurn('one', null, validSession(), { onDelta: vi.fn() }, deps);
    const t2 = spawnComposerTurn('two', ISSUED_ID, validSession(), { onDelta: vi.fn() }, deps);

    expect(t1.ok && t2.ok).toBe(true);
    expect(calls).toHaveLength(2); // two discrete spawns — a turn == a spawn
    // Exactly one audit row per turn (reusing spawnVibe's single sink), now under the DISTINCT
    // `composer-turn` action (review F2) — proof we relabel the action without forking the audit sink.
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows.map((r) => r.event.action)).toEqual(['composer-turn', 'composer-turn']);
    expect(audit.rows.map((r) => r.event.result)).toEqual(['spawned', 'spawned']);
    // review F2 — the resume target is recorded on the row (redacted to its last 4 chars), and the
    // resume flag distinguishes a continuing turn from a first turn.
    expect(audit.rows[0].event.detail).toMatchObject({ resume: false });
    expect(audit.rows[1].event.detail).toMatchObject({ resume: true });
    expect(JSON.stringify(audit.rows)).not.toContain(ISSUED_ID);
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
