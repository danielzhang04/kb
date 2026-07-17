/**
 * D3.2 — the daemon's PTY open path. Every test injects fakes for the preamble runner, the host
 * transport, and `appendAudit` (see `hostClient.ts`'s DI rationale) — no test here ever shells a real
 * `py`/`git`, opens a real named pipe, spawns a real PTY, or touches a real `ledgers/audit/**` file.
 * Fully hermetic.
 *
 * The load-bearing security assertion lives here: the daemon only ever SIGNALS the host with an
 * authenticated open-request. It never calls `CreateProcessAsUser`/`runas` and never passes a
 * password/token-as-credential argument — proven against the recorded transport traffic, not assumed.
 */
import { describe, expect, it } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import { openPty } from './hostClient.ts';
import type {
  HostChannelAuth,
  HostConnection,
  OpenPtyAck,
  OpenPtyDeps,
  OpenPtyRequest,
  SessionInput,
} from './hostClient.ts';

const SECRET = Buffer.from('pty-test-secret-do-not-reuse');
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

/** A fake host connection recording every open-request + every channel auth it was created with, so a
 *  test can inspect exactly what the daemon signalled (and assert what it did NOT). */
function fakeConnection(sessionId = 'pty-1') {
  const opens: OpenPtyRequest[] = [];
  const writes: string[] = [];
  let closed = false;
  const conn: HostConnection = {
    requestOpen(req) {
      opens.push(req);
      return { sessionId } satisfies OpenPtyAck;
    },
    onData() {},
    onExit() {},
    write(data) {
      writes.push(data);
    },
    resize() {},
    close() {
      closed = true;
    },
  };
  return { conn, opens, writes, isClosed: () => closed };
}

/** Records every transport connect (channel auth) and hands back a controllable connection. */
function recordingTransport(conn: HostConnection) {
  const connects: HostChannelAuth[] = [];
  const transport = (auth: HostChannelAuth): HostConnection => {
    connects.push(auth);
    return conn;
  };
  return { transport, connects };
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

function baseDeps(overrides: Partial<OpenPtyDeps> = {}): OpenPtyDeps {
  const audit = recordingAppendAudit();
  return {
    repoRoot: '/repo',
    runPreamble: okPreamble(),
    appendAudit: audit.fn,
    channelAuth: { pipePath: '\\\\.\\pipe\\kb-pty-host', bootToken: 'boot-xyz' },
    requestId: () => 'req-fixed',
    ...overrides,
  };
}

describe('openPty — WebAuthn session gate (fail-closed 401)', () => {
  it('refuses to open without a fresh WebAuthn session — 401, host never signalled', () => {
    const fc = fakeConnection();
    const rt = recordingTransport(fc.conn);
    const noSession: SessionInput = { token: null, config: SESSION_CONFIG };

    const result = openPty(noSession, baseDeps({ transport: rt.transport }));
    expect(result).toEqual({
      ok: false,
      reason: 'unauthenticated',
      status: 401,
      detail: 'no WebAuthn session token supplied',
    });
    // The host is never contacted without a session.
    expect(rt.connects).toHaveLength(0);
    expect(fc.opens).toHaveLength(0);
  });

  it('refuses an expired/tampered session the same way — 401, no signal', () => {
    const fc = fakeConnection();
    const rt = recordingTransport(fc.conn);
    const expiredConfig: SessionConfig = { secret: SECRET, now: () => 0, ttlMs: 1 };
    const { token } = mintSession('operator-1', expiredConfig);
    const later: SessionInput = { token, config: { secret: SECRET, now: () => 1_000_000 } };

    const result = openPty(later, baseDeps({ transport: rt.transport }));
    expect(result).toEqual({ ok: false, reason: 'unauthenticated', status: 401, detail: 'expired' });
    expect(rt.connects).toHaveLength(0);
    expect(fc.opens).toHaveLength(0);
  });
});

describe('openPty — preamble gate (runs first, signals nothing on failure; ordering law 8)', () => {
  it('refuses to signal the host when the preamble fails (STOP present) — even with a valid session', () => {
    const fc = fakeConnection();
    const rt = recordingTransport(fc.conn);
    const audit = recordingAppendAudit();

    const result = openPty(
      validSession(),
      baseDeps({
        runPreamble: frozenPreamble('STOP file present — fleet is frozen'),
        transport: rt.transport,
        appendAudit: audit.fn,
      }),
    );
    expect(result).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['STOP file present — fleet is frozen'],
    });
    // The load-bearing assertion: a frozen fleet signals the host NOTHING, ever.
    expect(rt.connects).toHaveLength(0);
    expect(fc.opens).toHaveLength(0);
    // But the refusal is still audited exactly once.
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].event.result).toBe('fleet-frozen');
  });

  it('the preamble is checked BEFORE the session — a frozen fleet refuses as fleet-frozen even with no session', () => {
    const fc = fakeConnection();
    const rt = recordingTransport(fc.conn);
    const noSession: SessionInput = { token: null, config: SESSION_CONFIG };

    const result = openPty(
      noSession,
      baseDeps({ runPreamble: frozenPreamble('daily budget breached: $6.00 >= $5.00'), transport: rt.transport }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('fleet-frozen');
    expect(rt.connects).toHaveLength(0);
  });
});

describe('openPty — the daemon only SIGNALS the host (no spawn-as-user, no credential argument)', () => {
  it('sends exactly one authenticated open-request carrying no CreateProcessAsUser/runas/password/token-credential', () => {
    const fc = fakeConnection('pty-42');
    const rt = recordingTransport(fc.conn);

    const result = openPty(validSession('operator-7'), baseDeps({ transport: rt.transport, cols: 120, rows: 40 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sessionId).toBe('pty-42');

    // The daemon connected once and sent exactly one open-request.
    expect(rt.connects).toHaveLength(1);
    expect(fc.opens).toHaveLength(1);

    const req = fc.opens[0];
    // The request carries only geometry + cwd + correlation id + the verified subject.
    expect(req).toEqual({
      type: 'open-pty',
      requestId: 'req-fixed',
      cols: 120,
      rows: 40,
      cwd: '/repo',
      sessionSubject: 'operator-7',
    });

    // The full serialized traffic (channel auth + request) contains NO spawn-as-user primitive and NO
    // password/account-credential field — the daemon holds and passes none.
    const wire = JSON.stringify({ connects: rt.connects, opens: fc.opens });
    expect(wire).not.toMatch(/CreateProcessAsUser/i);
    expect(wire).not.toMatch(/\brunas\b/i);
    expect(wire).not.toMatch(/password/i);
    // No request field is named like an account credential.
    for (const key of Object.keys(req)) {
      expect(key).not.toMatch(/password|credential|runas|createprocessasuser/i);
    }
  });
});

describe('openPty — audit coverage (D2.9 appendAudit, independent trail)', () => {
  it('every open writes exactly one audit row — refused (preamble), refused (session), and opened alike', () => {
    const audit = recordingAppendAudit();
    const fc = fakeConnection();
    const rt = recordingTransport(fc.conn);

    // Refused at the preamble gate.
    openPty(validSession(), baseDeps({ runPreamble: frozenPreamble('STOP file present'), appendAudit: audit.fn, transport: rt.transport }));
    // Refused at the session gate.
    openPty({ token: null, config: SESSION_CONFIG }, baseDeps({ appendAudit: audit.fn, transport: rt.transport }));
    // Actually opens.
    openPty(validSession('operator-1'), baseDeps({ appendAudit: audit.fn, transport: rt.transport }));

    expect(audit.rows).toHaveLength(3);
    expect(audit.rows.map((r) => r.event.action)).toEqual(['pty-open', 'pty-open', 'pty-open']);
    expect(audit.rows.map((r) => r.event.result)).toEqual(['fleet-frozen', 'unauthenticated', 'opened']);
    // The successful open records the verified owner (session subject).
    expect(audit.rows[2].event.owner).toBe('operator-1');
    // repoRoot passes straight through.
    expect(audit.rows[2].repoRoot).toBe('/repo');
  });

  it('a host that is unreachable is refused (host-unreachable) and audited, not thrown', () => {
    const audit = recordingAppendAudit();
    const throwingTransport = () => {
      throw new Error('pipe refused: host not registered yet');
    };
    const result = openPty(
      validSession(),
      baseDeps({ appendAudit: audit.fn, transport: throwingTransport }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('host-unreachable');
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].event.result).toBe('host-unreachable');
  });
});
