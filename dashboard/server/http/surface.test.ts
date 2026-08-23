/**
 * U2 — route-level security tests for the governed write surface. These exercise the REAL composition
 * chain (Origin/Host guard -> rate-limit -> session -> gate -> audit) end to end via `app.inject`
 * (which, unlike fetch/undici, does not strip the `Origin` header). Only the leaf side-effect runners
 * (git/py/spawn/appendAudit) are injected as the SAME hermetic fakes the gate modules' own unit tests
 * use — no security check is ever faked, and there is no dev-mode/bypass flag to disable one.
 *
 * Covered per the brief: route-exists (not 404), 403 bad Origin, 401 no session, 429 rate-limit breach,
 * an audit row on the success path, and the fail-closed WebAuthn reality (no passkey => no session).
 */
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  makeSurfaceContext as makeProductionSurfaceContext,
  PTY_OPEN_FLEET_FROZEN,
  registerWriteSurface,
} from './surface.ts';
import type { SurfaceContext } from './context.ts';
import { mintSession } from '../auth/session.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import type { GitRunner } from '../write/branch.ts';
import type { PyRunner } from '../write/launch.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { HostOpenRequest, PtyHost, PtySession } from '../pty/host.ts';
import type { EventBus } from '../hub/bus.ts';
import type { AttemptIoAppend } from '../control/attemptIo.ts';
import type { OwnedCard, QueueBridgeOptions } from '../control/queueBridge.ts';
import { admit } from '../control/admission.ts';
import { runtimeCapabilities } from '../runtime/capabilities.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { acquireWriterLease } from '../control/writerLease.ts';
import { normalizedTextSha256 } from '../control/textArtifactHash.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));
/** What a successful composition-time host probe publishes; nothing constructs a PTY without it. */
const AVAILABLE_PTY = {
  pty: true as const, host: 'desktop' as const, launchers: ['shell' as const],
  roots: ['repo' as const], checkedAt: '2026-08-22T09:00:00.000Z',
};
const KB_REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SECRET = Buffer.from('u2-surface-test-secret-0123456789');
const sessionConfig = { secret: SECRET, ttlMs: 60_000 };
const GOOD_ORIGIN = 'http://localhost';
const GOOD_HOST = 'localhost';

function makeSurfaceContext(
  overrides: Parameters<typeof makeProductionSurfaceContext>[0] = {},
  activation: Parameters<typeof makeProductionSurfaceContext>[1] = {},
) {
  return makeProductionSurfaceContext({ controlStore: createInMemoryControlPlaneStore(), ...overrides }, activation);
}

/** A recording audit fake — never touches git; captures every row a route writes. */
function recordingAudit(): { rows: AuditRow[]; fn: SurfaceContext['appendAudit'] } {
  const rows: AuditRow[] = [];
  const fn: SurfaceContext['appendAudit'] = (_repoRoot: string, event: AuditEvent): AuditRow => {
    const row: AuditRow = { ts: '2026-07-16T00:00:00.000Z', ...event };
    rows.push(row);
    return row;
  };
  return { rows, fn };
}

function recordingLocalAudit(rows: AuditRow[]): NonNullable<SurfaceContext['appendAuditLocal']> {
  return (_repoRoot, event) => {
    const row: AuditRow = { ts: '2026-07-16T00:00:00.000Z', ...event };
    rows.push(row);
    return row;
  };
}

/** Git/py/preamble fakes that succeed without touching the real binaries. */
const okGit: GitRunner = (_repo, args) =>
  args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'claude/m1-dashboard\n' : '';
const okOpsGit: GitRunner = (_repo, args) =>
  args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'ops\n' : '';
const okPy: PyRunner = (_repo, _code, jsonArg) => {
  // Return a plausible card-op stdout so launch/rerun parse it; harmless for other ops.
  const op = JSON.parse(jsonArg) as { cardId?: string };
  return { exitCode: 0, stdout: JSON.stringify({ id: 'card-new-0001', path: 'queue/inbox/card-new-0001.md', state: 'halting', cardId: op.cardId }), stderr: '' };
};
const okPreamble: PreambleRunner = () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' });
const noRunnerSignal: NonNullable<SurfaceContext['triggerRunner']> = (owner) => ({
  status: 'triggered', owner, task: 'test-runner',
});
const frozenPreamble: PreambleRunner = () => ({ exitCode: 1, stdout: 'PREAMBLE FAIL: STOP file present — fleet frozen', stderr: '' });

function recordingPtyHost(): {
  host: PtyHost;
  open: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  stopAll: ReturnType<typeof vi.fn>;
  sessions: ReturnType<typeof vi.fn>;
  session: PtySession;
} {
  const session = { sessionId: 'pty-surface-test', handle: {} } as PtySession;
  const open = vi.fn((_request: HostOpenRequest) => session);
  const stop = vi.fn((_sessionId: string) => true);
  const stopAll = vi.fn();
  const sessions = vi.fn(() => [session.sessionId]);
  return { host: { open, stop, stopAll, sessions }, open, stop, stopAll, sessions, session };
}

function buildApp(overrides: Partial<SurfaceContext> = {}): { app: FastifyInstance; ctx: SurfaceContext } {
  const app = Fastify({ logger: false });
  const ctx = makeSurfaceContext({
    repoRoot: REPO_A,
    sessionConfig,
    allowedOrigins: [GOOD_ORIGIN],
    runPreamble: okPreamble,
    triggerRunner: noRunnerSignal,
    ...overrides,
  });
  registerWriteSurface(app, ctx);
  return { app, ctx };
}

function token(): string {
  return mintSession('operator', sessionConfig).token;
}

function headers(withToken: boolean): Record<string, string> {
  const h: Record<string, string> = { origin: GOOD_ORIGIN, host: GOOD_HOST, 'content-type': 'application/json' };
  if (withToken) h.authorization = `Bearer ${token()}`;
  return h;
}

let app: FastifyInstance | undefined;
let testStateRoot: string | undefined;
const originalStateRoot = process.env.DASHBOARD_STATE_ROOT;

beforeEach(() => {
  testStateRoot = mkdtempSync(join(tmpdir(), 'kb-surface-test-state-'));
  process.env.DASHBOARD_STATE_ROOT = testStateRoot;
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
  if (originalStateRoot === undefined) delete process.env.DASHBOARD_STATE_ROOT;
  else process.env.DASHBOARD_STATE_ROOT = originalStateRoot;
  if (testStateRoot) rmSync(testStateRoot, { recursive: true, force: true });
  testStateRoot = undefined;
  rmSync(join(REPO_A, 'STOP'), { force: true });
  rmSync(join(REPO_A, 'ledgers', 'audit'), { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('write surface — composition chain', () => {
  it('constructs no PTY host, registry, store, or recorder when the probe refused', () => {
    const createPty = vi.fn(() => { throw new Error('must not construct'); });
    const ctx = makeSurfaceContext(
      { runtimeCapabilities: runtimeCapabilities('linux') },
      { createPtyHost: createPty },
    );
    expect(ctx.runtimeCapabilities.pty).toBe(false);
    expect(createPty).not.toHaveBeenCalled();
    expect(ctx.ptyHost).toBeUndefined();
    expect(ctx.ptySessions).toBeUndefined();
    expect(ctx.ptySessionRuns).toBeUndefined();
    expect(ctx.ptyTranscripts).toBeUndefined();
  });

  it('refuses the same way on Windows until composition supplies a probe result', () => {
    const createPty = vi.fn(() => { throw new Error('must not construct'); });
    const ctx = makeSurfaceContext(
      { runtimeCapabilities: runtimeCapabilities('win32') },
      { createPtyHost: createPty },
    );
    expect(ctx.runtimeCapabilities).toMatchObject({
      pty: false, diagnostic: { reason: 'node-pty-unavailable', detail: null },
    });
    expect(createPty).not.toHaveBeenCalled();
    expect(ctx.ptyHost).toBeUndefined();
    expect(ctx.ptySessions).toBeUndefined();
  });

  it('constructs the whole PTY stack once the probe advertised the closed capability', () => {
    const createPty = vi.fn(() => recordingPtyHost().host);
    const ctx = makeSurfaceContext(
      { runtimeCapabilities: runtimeCapabilities('win32', AVAILABLE_PTY) },
      { createPtyHost: createPty },
    );
    expect(createPty).toHaveBeenCalledOnce();
    expect(ctx.ptyHost).toBeDefined();
    expect(ctx.ptySessions).toBeDefined();
    expect(ctx.ptySessionRuns).toBeDefined();
    expect(ctx.ptyTranscripts).toBeDefined();
  });

  it('resolves outbox publication once and recovers the anchor before readiness', async () => {
    const calls: string[][] = [];
    const anchor = 'a'.repeat(40);
    const opsGit: GitRunner = async (_repo, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z') return '';
      if (command === 'rev-parse --verify refs/kb-outbox/spooled') return `${anchor}\n`;
      if (command === `rev-list --reverse ${anchor}..HEAD`) return '';
      throw new Error(`unexpected git invocation: ${command}`);
    };
    const ctx = makeSurfaceContext(
      { repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN], opsGit },
      { env: { KB_COORDINATION_PUBLICATION: 'outbox' } },
    );
    app = Fastify({ logger: false });
    registerWriteSurface(app, ctx);

    await app.ready();

    expect(ctx.coordinationPublication).toBe('outbox');
    expect(ctx.outboxRoot).toBe('/var/lib/kb/state/outbox');
    expect(calls).toContainEqual(['rev-parse', '--verify', 'refs/kb-outbox/spooled']);
    expect(calls.some((args) => ['fetch', 'pull', 'push'].includes(args[0]))).toBe(false);
  });

  it.each(['missing-anchor', 'staged-residue'] as const)(
    'degrades an outbox recovery fault (%s) without bricking readiness or the repair path',
    async (fault) => {
      const anchor = 'a'.repeat(40);
      const opsGit: GitRunner = async (_repo, args) => {
        const command = args.join(' ');
        if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
        if (command === 'diff --cached --name-only -z') {
          return fault === 'staged-residue' ? 'queue/crash.md\0' : '';
        }
        if (command === 'rev-parse --verify refs/kb-outbox/spooled') {
          if (fault === 'missing-anchor') throw new Error('missing outbox anchor');
          return `${anchor}\n`;
        }
        if (command === `rev-list --reverse ${anchor}..HEAD`) return '';
        throw new Error(`unexpected git invocation: ${command}`);
      };
      const ctx = makeSurfaceContext({
        repoRoot: REPO_A,
        sessionConfig,
        allowedOrigins: [GOOD_ORIGIN],
        coordinationPublication: 'outbox',
        outboxRoot: mkdtempSync(join(tmpdir(), 'surface-outbox-recovery-')),
        opsGit,
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      app = Fastify({ logger: false });
      app.get('/readyz', async () => await ctx.readiness());
      registerWriteSurface(app, ctx);

      await app.ready();
      const readiness = await app.inject({ method: 'GET', url: '/readyz' });
      expect(readiness.statusCode).toBe(200);
      expect(readiness.json().blockers).toContain('outbox-recovery-failed');
      const save = await app.inject({
        method: 'POST', url: '/api/write/save', headers: headers(true),
        payload: { relpath: 'docs/refused.md', content: 'not written' },
      });
      expect(save.statusCode).toBe(503);
      expect(save.json()).toMatchObject({ error: 'outbox-degraded' });
    },
  );

  it('keeps the real pending count when recovery degradation applies the paid-continuation ceiling', () => {
    const outboxRoot = mkdtempSync(join(tmpdir(), 'surface-outbox-ceiling-'));
    const ready = join(outboxRoot, 'ready');
    mkdirSync(ready);
    try {
      for (let index = 0; index < 1_000; index += 1) {
        writeFileSync(join(ready, `${index.toString().padStart(40, '0')}.json`), 'invalid\n', 'utf8');
      }
      const ctx = makeSurfaceContext({
        repoRoot: REPO_A,
        sessionConfig,
        coordinationPublication: 'outbox',
        outboxRoot,
        outboxRecoveryFailure: 'missing outbox anchor',
      });

      expect(ctx.admission('paid-continuation')).toEqual({
        ok: false,
        status: 503,
        reason: 'outbox-degraded',
      });
    } finally {
      rmSync(outboxRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('routes exist (a session-less POST is 401, never 404)', async () => {
    ({ app } = buildApp());
    for (const url of [
      '/api/write/save',
      '/api/write/launch',
      '/api/write/rerun',
      '/api/write/stop',
      '/api/approvals/verify',
    ]) {
      const res = await app.inject({ method: 'POST', url, headers: headers(false), payload: {} });
      expect(res.statusCode, `${url} should be gated, not missing`).not.toBe(404);
      expect(res.statusCode).toBe(401);
    }
    for (const request of [
      { method: 'POST' as const, url: '/api/write/stop-card' },
      { method: 'POST' as const, url: '/api/composer/turn' },
      { method: 'GET' as const, url: '/api/approvals' },
      { method: 'GET' as const, url: '/api/human-inbox' },
    ]) {
      expect((await app.inject({ method: request.method, url: request.url, headers: headers(true), payload: request.method === 'POST' ? {} : undefined })).statusCode).toBe(404);
    }
  });

  it('composes paid-action behind its spend-grant gate while every session route keeps the session gate', async () => {
    const grantToken = 'grant-bearer-token';
    const grant = {
      grantRef: 'grant-11111111111111111111111111111111',
      runRef: 'run-grant', stageRef: 'stage-images', operation: 'fyt.gemini-3-pro-image-2k' as const,
      maxCalls: 11, maxCostUsdMicros: 1_400_000, maxCharacters: 0, maxOutputs: 8,
      tokenHash: 'b'.repeat(64), subject: 'operator', gateRequestRef: 'request-spend',
      mintedAt: '2026-08-03T12:00:00.000Z', expiresAt: '2026-08-03T14:00:00.000Z',
    };
    const execute = vi.fn(async () => ({
      status: 'succeeded' as const,
      actionRef: 'paid-surface',
      output: {
        artifactPath: 'orgs/faceless-youtube/channels/demo/assets/scenes/s1.png',
        mediaType: 'image/png' as const,
        byteLength: 4,
        sha256: 'a'.repeat(64),
      },
    }));
    ({ app } = buildApp({
      controlStore: {
        getRun: () => ({ ok: true, value: { stages: [{ stageRef: 'stage-images', currentAttemptRef: 'attempt-7' }] } }),
      } as unknown as SurfaceContext['controlStore'],
      paidActionService: { execute, snapshot: () => [] } as unknown as SurfaceContext['paidActionService'],
      spendGrantStore: { resolve: (candidate) => candidate === grantToken ? grant : null },
      appendAudit: recordingAudit().fn,
    }));

    const missing = await app.inject({
      method: 'POST', url: '/api/control/paid-action', headers: headers(false), payload: {},
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({ reason: 'missing spend grant token' });

    const grantHeaders = { ...headers(false), authorization: `Bearer ${grantToken}` };
    const paid = await app.inject({
      method: 'POST', url: '/api/control/paid-action', headers: grantHeaders,
      payload: {
        operation: 'fyt.gemini-3-pro-image-2k', prompt: 'a brick',
        seeds: [{ pngBase64: 'AAAA', sha256: 'c'.repeat(64) }],
        expectedArtifactPath: 'orgs/faceless-youtube/channels/demo/assets/scenes/s1.png',
      },
    });
    expect(paid.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledOnce();

    const sessionRoute = await app.inject({ method: 'GET', url: '/api/control/execution', headers: grantHeaders });
    expect(sessionRoute.statusCode).toBe(401);
    expect(sessionRoute.json()).toMatchObject({ reason: 'malformed' });
  });

  it('403s a request whose Origin is not on the allowlist (DNS-rebinding guard)', async () => {
    ({ app } = buildApp());
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/save',
      headers: { origin: 'https://evil.example', host: GOOD_HOST, 'content-type': 'application/json', authorization: `Bearer ${token()}` },
      payload: { relpath: 'docs/x.md', content: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'forbidden' });
  });

  it('401s a request with no / an invalid session bearer (origin ok)', async () => {
    ({ app } = buildApp());
    const none = await app.inject({ method: 'POST', url: '/api/write/stop', headers: headers(false), payload: {} });
    expect(none.statusCode).toBe(401);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/write/stop',
      headers: { ...headers(false), authorization: 'Bearer not.a.real.token' },
      payload: {},
    });
    expect(bad.statusCode).toBe(401);
  });

  it('429s a WRITE once the write rate-limit window is breached (before the session check)', async () => {
    // limit 1 / window: the 2nd valid-origin mutation in the window is throttled.
    const { lockout, rateLimit } = await import('../security/ratelimit.ts');
    const guard = lockout(rateLimit({ limit: 1, windowMs: 60_000 }), { threshold: 10, lockoutMs: 60_000 });
    ({ app } = buildApp({ rateGuard: guard }));

    const first = await app.inject({ method: 'POST', url: '/api/write/stop', headers: headers(false), payload: {} });
    expect(first.statusCode).toBe(401); // passed origin + rate-limit, failed session
    const second = await app.inject({ method: 'POST', url: '/api/write/stop', headers: headers(false), payload: {} });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: 'throttled' });
  });

  it('429s a GET once the READ rate-limit window is breached (before the session check)', async () => {
    const { lockout, rateLimit } = await import('../security/ratelimit.ts');
    const guard = lockout(rateLimit({ limit: 1, windowMs: 60_000 }), { threshold: 10, lockoutMs: 60_000 });
    ({ app } = buildApp({ readRateGuard: guard }));

    const first = await app.inject({ method: 'GET', url: '/api/control/execution', headers: headers(false) });
    expect(first.statusCode).toBe(401); // passed origin + rate-limit, failed session
    const second = await app.inject({ method: 'GET', url: '/api/control/execution', headers: headers(false) });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: 'throttled' });
  });

  it('a GET storm NEVER consumes the write budget (the live 429-lockout defect)', async () => {
    // The defect: ONE shared 30/min bucket fronted every governed GET the UI polls AND every write, so
    // ordinary polling burned the write budget, escalated into the 5-minute lockout, and 429'd the whole
    // dashboard. Two independent buckets, dispatched by method, are what make that impossible.
    const { lockout, rateLimit } = await import('../security/ratelimit.ts');
    const writeGuard = lockout(rateLimit({ limit: 1, windowMs: 60_000 }), { threshold: 5, lockoutMs: 5 * 60_000 });
    const readGuard = lockout(rateLimit({ limit: 300, windowMs: 60_000 }), { threshold: 10, lockoutMs: 60_000 });
    ({ app } = buildApp({ rateGuard: writeGuard, readRateGuard: readGuard }));

    for (let i = 0; i < 60; i += 1) {
      const poll = await app.inject({ method: 'GET', url: '/api/control/execution', headers: headers(false) });
      expect(poll.statusCode).toBe(401); // never 429 — reads are metered on their own budget
    }
    // The write budget is untouched by all of that: the first mutation still reaches the session check.
    const first = await app.inject({ method: 'POST', url: '/api/write/stop', headers: headers(false), payload: {} });
    expect(first.statusCode).toBe(401);
    // ...and it still throttles on its own terms (limit 1) — the write budget itself is unchanged.
    const second = await app.inject({ method: 'POST', url: '/api/write/stop', headers: headers(false), payload: {} });
    expect(second.statusCode).toBe(429);
  });

  it('the SHIPPED default read budget survives a realistic UI poll burst', async () => {
    // No guard overrides: exactly what production wires. 120 polled reads is well past the old 30/min
    // shared budget that took the live dashboard down, and comfortably inside the 300/min read budget.
    ({ app } = buildApp());
    for (let i = 0; i < 120; i += 1) {
      const poll = await app.inject({ method: 'GET', url: '/api/control/execution', headers: headers(false) });
      expect(poll.statusCode).toBe(401);
    }
  });

  it('writes exactly one audit row on a successful governed save', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'u2-save-'));
    const audit = recordingAudit();
    const prCalls: unknown[] = [];
    ({ app } = buildApp({
      repoRoot,
      appendAudit: audit.fn,
      saveGit: okGit,
      openPr: (_r, req) => { prCalls.push(req); },
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/write/save',
      headers: headers(true),
      payload: { relpath: 'docs/note.md', content: '# hi\n' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, target: 'durable' });
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: 'save', target: 'docs/note.md', owner: 'operator' });
    expect(String(audit.rows[0].result)).toContain('saved');
    expect(prCalls).toHaveLength(1); // durable content -> PR to main
  });

  it('refuses an invalid canonical workflow definition before any governed save or audit', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'u2-workflow-save-'));
    const audit = recordingAudit();
    ({ app } = buildApp({ repoRoot, appendAudit: audit.fn, saveGit: okGit, openPr: () => {} }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/save',
      headers: headers(true),
      payload: {
        relpath: 'orgs/kb-ops/workflows/bad.md',
        content: [
          '---',
          'id: bad',
          'project: kb-ops',
          'title: Bad',
          'profile: made-up-profile',
          'stages: []',
          '---',
          'body',
          '',
        ].join('\n'),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'workflow-definition-invalid' });
    expect(audit.rows).toHaveLength(0);
  });

  it('refuses a canonical workflow whose declared project does not match its path', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'u2-workflow-project-'));
    ({ app } = buildApp({ repoRoot, appendAudit: recordingAudit().fn, saveGit: okGit, openPr: () => {} }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/save',
      headers: headers(true),
      payload: {
        relpath: 'orgs/kb-ops/workflows/mismatch.md',
        content: [
          '---',
          'id: mismatch',
          'project: other',
          'title: Mismatch',
          'profile: research',
          'stages:',
          '  - id: research',
          '    title: Research',
          '    action: research:brief',
          '    target: orgs/other/output',
          '    workOrder: research it',
          '---',
          'body',
          '',
        ].join('\n'),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toMatch(/does not match path project/);
  });

  it('audits a governed launch that clears the preamble + session gates', async () => {
    const audit = recordingAudit();
    ({ app } = buildApp({
      appendAudit: audit.fn,
      appendAuditLocal: recordingLocalAudit(audit.rows),
      runPreamble: okPreamble,
      runPy: okPy,
      opsGit: okOpsGit,
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/launch',
      headers: headers(true),
      payload: { project: 'kb', action: 'demo:x', target: '.', riskTier: 'T1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, cardId: 'card-new-0001' });
    expect(audit.rows[0]).toMatchObject({ action: 'launch', result: 'launched:card-new-0001' });
  });

  it('launch pulls before cards.py and commits card plus audit as one exact-path ops commit', async () => {
    const order: string[] = [];
    const selfCommittingAudit = recordingAudit();
    const localRows: AuditRow[] = [];
    const git: GitRunner = (_repo, args) => {
      order.push(`git:${args.join(' ')}`);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      return '';
    };
    const py: PyRunner = () => {
      order.push('cards.py');
      return { exitCode: 0, stdout: '{"id":"atomic-1","path":"queue/inbox/atomic-1.md"}\n', stderr: '' };
    };
    ({ app } = buildApp({
      appendAudit: selfCommittingAudit.fn,
      appendAuditLocal: (_repo, event) => {
        order.push('audit:local');
        return recordingLocalAudit(localRows)(_repo, event);
      },
      runPy: py,
      opsGit: git,
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/write/launch',
      headers: headers(true),
      payload: { project: 'kb', action: 'demo:x', target: '.', riskTier: 'T1' },
    });
    expect(res.statusCode).toBe(200);
    const pull = order.indexOf('git:pull --rebase origin ops');
    const write = order.indexOf('cards.py');
    const add = order.findIndex((x) => x.startsWith('git:add -- '));
    expect(pull).toBeGreaterThanOrEqual(0);
    expect(pull).toBeLessThan(write);
    expect(write).toBeLessThan(add);
    expect(order[add]).toBe('git:add -- queue/inbox/atomic-1.md ledgers/audit/dashboard-audit.ndjson');
    expect(order.filter((x) => x.startsWith('git:commit '))).toHaveLength(1);
    expect(order.filter((x) => x === 'git:push origin ops')).toHaveLength(1);
    expect(localRows).toHaveLength(1);
    expect(selfCommittingAudit.rows).toHaveLength(0);
  });

  it('launch and rerun refuse a non-ops checkout before cards.py or local audit mutation', async () => {
    const gitCalls: string[][] = [];
    const py = vi.fn();
    const appendLocal = vi.fn();
    ({ app } = buildApp({
      runPy: py as unknown as PyRunner,
      appendAuditLocal: appendLocal,
      opsGit: (_repo, args) => {
        gitCalls.push(args);
        return args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'main\n' : '';
      },
    }));

    const launch = await app.inject({
      method: 'POST',
      url: '/api/write/launch',
      headers: headers(true),
      payload: { project: 'kb', action: 'demo:x', target: '.', riskTier: 'T1' },
    });
    const rerun = await app.inject({
      method: 'POST',
      url: '/api/write/rerun',
      headers: headers(true),
      payload: { cardId: 'orig-1', feedback: 'try again' },
    });

    expect(launch.statusCode).toBe(500);
    expect(rerun.statusCode).toBe(500);
    expect(py).not.toHaveBeenCalled();
    expect(appendLocal).not.toHaveBeenCalled();
    expect(gitCalls).toEqual([
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      ['rev-parse', '--abbrev-ref', 'HEAD'],
    ]);
  });

  it('launch is refused 503 when the preamble reports a frozen fleet — and writes NO ops audit row', async () => {
    // FINDING 3: a refused write is not a consequential action; it must not commit an ops audit row
    // (an amplification vector — one pull-rebase-push per refusal). Only the SUCCESS path audits.
    const audit = recordingAudit();
    ({ app } = buildApp({ appendAudit: audit.fn, runPreamble: frozenPreamble, runPy: okPy }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/launch',
      headers: headers(true),
      payload: { project: 'kb', action: 'demo:x', target: '.', riskTier: 'T1' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'fleet-frozen' });
    expect(audit.rows).toHaveLength(0);
  });

  it('returns 503 before a new launch when the outbox is degraded, but still accepts STOP', async () => {
    const degraded = { pending: 100, oldestAgeMs: 1_000, degraded: true, reasons: ['pending-limit'] };
    const runPy = vi.fn(okPy);
    ({ app } = buildApp({ admission: (kind) => admit(kind, degraded), runPy }));
    const launch = await app.inject({
      method: 'POST', url: '/api/write/launch', headers: headers(true),
      payload: { project: 'kb-ops', action: 'report:self-lint', target: 'orgs/kb-ops/output', riskTier: 'T1' },
    });
    expect(launch.statusCode).toBe(503);
    expect(launch.json()).toMatchObject({ error: 'outbox-degraded' });
    expect(runPy).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: '/api/write/stop', headers: headers(true), payload: {} })).statusCode).toBe(200);
  });

  it('save is refused 503 on preamble failure before any file or git write', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'u2-save-frozen-'));
    const audit = recordingAudit();
    const gitCalls: string[][] = [];
    ({ app } = buildApp({
      repoRoot,
      appendAudit: audit.fn,
      runPreamble: frozenPreamble,
      saveGit: (_repo, args) => {
        gitCalls.push(args);
        return '';
      },
      openPr: () => {},
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/save',
      headers: headers(true),
      payload: { relpath: 'docs/blocked.md', content: 'must-not-land' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'save-refused' });
    expect(gitCalls).toHaveLength(0);
    expect(audit.rows).toHaveLength(0);
  });

  it('C7.7 — rejects a launch owner that is not filename-safe with 400 bad-owner (before the gate module)', async () => {
    ({ app } = buildApp({ runPreamble: okPreamble, runPy: okPy }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/launch',
      headers: headers(true),
      payload: { project: 'kb', action: 'demo:x', target: '.', riskTier: 'T1', owner: 'evil/../x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-owner' });
  });

  it('C7.7 — rejects a launch owner absent from the filesystem-enumerated closed set with 400 owner-not-registered', async () => {
    // REPO_A has no agents/ dir and no model-routing.yaml → the assignable set is empty → any owner refused.
    ({ app } = buildApp({ runPreamble: okPreamble, runPy: okPy }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/launch',
      headers: headers(true),
      payload: { project: 'kb', action: 'demo:x', target: '.', riskTier: 'T1', owner: 'ghost-agent' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'owner-not-registered' });
  });

  it('C7.7 — a declared agent owner (enumerated from agents/*.md) is claimed + routing-stamped end to end', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'c77-owner-'));
    mkdirSync(join(repoRoot, 'agents'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'agents', 'codex-runner.md'),
      ['---', 'id: codex-runner', 'role: work', 'runtime: codex', 'runner-bound: false', 'description: test runner', '---', '', '# Agent: codex-runner', ''].join('\n'),
    );
    // Recording py captures exactly what the launch path would shell — the resolver-sourced owner + routing.
    const calls: Array<{ jsonArg: string }> = [];
    const recPy: PyRunner = (_repo, _code, jsonArg) => {
      calls.push({ jsonArg });
      return { exitCode: 0, stdout: JSON.stringify({ id: 'owned-77', path: 'queue/inbox/owned-77.md' }), stderr: '' };
    };
    const audit = recordingAudit();
    ({ app } = buildApp({
      repoRoot,
      appendAudit: audit.fn,
      appendAuditLocal: recordingLocalAudit(audit.rows),
      runPreamble: okPreamble,
      runPy: recPy,
      opsGit: okOpsGit,
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/write/launch',
      headers: headers(true),
      payload: { project: 'kb', action: 'demo:x', target: '.', riskTier: 'T2', owner: 'codex-runner' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, cardId: 'owned-77' });
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0].jsonArg) as { kind: string; owner: string; runtime: string; model: string };
    expect(payload).toMatchObject({ kind: 'new', owner: 'codex-runner' });
    // Routing is resolver-sourced (effectiveForAgent) — present + concrete, never client input.
    expect(typeof payload.runtime).toBe('string');
    expect(typeof payload.model).toBe('string');
  });
});

describe('write surface — FINDING 1: server owns the durable work branch (no client-controlled push)', () => {
  it('rejects a save whose client body smuggles workBranch main/ops/refs-heads-main — never pushes', async () => {
    for (const bad of ['main', 'ops', 'refs/heads/main', 'MAIN']) {
      const pushCalls: string[][] = [];
      const recordingGit: GitRunner = (_r, args) => {
        pushCalls.push(args);
        return '';
      };
      const audit = recordingAudit();
      ({ app } = buildApp({ appendAudit: audit.fn, saveGit: recordingGit, openPr: () => {} }));
      const res = await app.inject({
        method: 'POST',
        url: '/api/write/save',
        headers: headers(true),
        payload: { relpath: 'docs/note.md', content: 'x', workBranch: bad },
      });
      expect(res.statusCode, bad).toBe(403);
      expect(res.json()).toMatchObject({ error: 'forbidden-branch' });
      // The git runner was never invoked with a push to that ref (nor at all) — refused before any git.
      expect(pushCalls.filter((c) => c[0] === 'push'), bad).toHaveLength(0);
      // A pre-gate rejection writes no audit row.
      expect(audit.rows, bad).toHaveLength(0);
      await app.close();
      app = undefined;
    }
  });

  it('a normal durable save (no workBranch) still routes to the server work branch', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'u2-wb-'));
    const pushCalls: string[][] = [];
    const recordingGit: GitRunner = (_r, args) => {
      pushCalls.push(args);
      return args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'claude/m1-dashboard\n' : '';
    };
    const prCalls: { head?: string }[] = [];
    ({ app } = buildApp({ repoRoot, appendAudit: recordingAudit().fn, saveGit: recordingGit, openPr: (_r, req) => { prCalls.push(req); } }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/save',
      headers: headers(true),
      payload: { relpath: 'docs/note.md', content: '# hi\n' },
    });
    expect(res.statusCode).toBe(200);
    const push = pushCalls.find((c) => c[0] === 'push');
    expect(push).toBeDefined();
    expect(push!.join(' ')).toContain('claude/m1-dashboard');
    expect(push!.join(' ')).not.toMatch(/\bops\b/);
    expect(push!).not.toEqual(['push', 'origin', 'main']);
    expect(prCalls[0]?.head).toBe('claude/m1-dashboard');
  });

  it('keeps durable saves isolated from the canonical ops checkout', async () => {
    const opsRoot = mkdtempSync(join(tmpdir(), 'u2-ops-root-'));
    const durableRoot = mkdtempSync(join(tmpdir(), 'u2-durable-root-'));
    const gitRoots: string[] = [];
    const auditRoots: string[] = [];
    ({ app } = buildApp({
      repoRoot: opsRoot,
      durableRepoRoot: durableRoot,
      saveGit: (repo, args) => {
        gitRoots.push(repo);
        return args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'claude/m1-dashboard\n' : '';
      },
      openPr: () => {},
      appendAudit: (repo, event) => {
        auditRoots.push(repo);
        return { ts: '2026-07-18T00:00:00.000Z', ...event };
      },
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/save',
      headers: headers(true),
      payload: { relpath: 'docs/isolated.md', content: '# isolated\n' },
    });
    expect(res.statusCode).toBe(200);
    expect(gitRoots).not.toContain(opsRoot);
    expect(new Set(gitRoots)).toEqual(new Set([durableRoot]));
    expect(auditRoots).toEqual([opsRoot]);
  });
});

describe('write surface — FINDING 2: pre-session rate-limit keyed on PEER IP, not the bearer token', () => {
  it('throttles the same peer across rotating garbage bearer tokens (write route)', async () => {
    const { lockout, rateLimit } = await import('../security/ratelimit.ts');
    const guard = lockout(rateLimit({ limit: 1, windowMs: 60_000 }), { threshold: 10, lockoutMs: 60_000 });
    ({ app } = buildApp({ rateGuard: guard }));
    // Same client (127.0.0.1), a DIFFERENT bearer each request. With the old tok:<bearer> key each got a
    // fresh bucket and never throttled; keyed on peer IP the 2nd request is throttled regardless.
    const h1 = { ...headers(false), authorization: 'Bearer garbage-token-A' };
    const h2 = { ...headers(false), authorization: 'Bearer garbage-token-B' };
    const first = await app.inject({ method: 'POST', url: '/api/write/stop', headers: h1, payload: {} });
    expect(first.statusCode).toBe(401); // passed origin + rate-limit, failed session
    const second = await app.inject({ method: 'POST', url: '/api/write/stop', headers: h2, payload: {} });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: 'throttled' });
  });

  it('covers the unauthenticated auth ceremony routes too (rotating bearers do not evade it)', async () => {
    const { lockout, rateLimit } = await import('../security/ratelimit.ts');
    const guard = lockout(rateLimit({ limit: 1, windowMs: 60_000 }), { threshold: 10, lockoutMs: 60_000 });
    ({ app } = buildApp({ rateGuard: guard, webAuthnConfig: () => ({ rpID: 'localhost', rpName: 't', origin: GOOD_ORIGIN }), credentials: () => [] }));
    const first = await app.inject({ method: 'POST', url: '/api/auth/assert/options', headers: { ...headers(false), authorization: 'Bearer x1' }, payload: {} });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/api/auth/assert/options', headers: { ...headers(false), authorization: 'Bearer x2' }, payload: {} });
    expect(second.statusCode).toBe(429);
  });
});

describe('write surface — FINDING 3: audit only on the consequential success path', () => {
  it('a session-authenticated but GATE-REFUSED save writes NO ops audit row', async () => {
    // governance/** is refused 403 by the gate even with a valid session — a refusal, no audit.
    const audit = recordingAudit();
    ({ app } = buildApp({ appendAudit: audit.fn, saveGit: okGit, openPr: () => {} }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/save',
      headers: headers(true),
      payload: { relpath: 'governance/risk-tiers.md', content: 'tampered' },
    });
    expect(res.statusCode).toBe(403);
    expect(audit.rows).toHaveLength(0);
  });

  it('a successful save writes exactly one audit row and still 500s if that audit throws (fail-loud preserved)', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'u2-audit-'));
    const throwingAudit: SurfaceContext['appendAudit'] = () => {
      throw new Error('ops audit commit failed');
    };
    ({ app } = buildApp({ repoRoot, appendAudit: throwingAudit, saveGit: okGit, openPr: () => {} }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/write/save',
      headers: headers(true),
      payload: { relpath: 'docs/note.md', content: '# hi\n' },
    });
    // An unauditable SUCCESSFUL write must not report success.
    expect(res.statusCode).toBe(500);
  });
});

describe('write surface — LOW: rerun cardId must be filename-safe (no glob metachars)', () => {
  it('rerun pulls before cards.py and commits dependent card plus audit in one exact-path ops commit', async () => {
    const order: string[] = [];
    const selfCommittingAudit = recordingAudit();
    const localRows: AuditRow[] = [];
    const git: GitRunner = (_repo, args) => {
      order.push(`git:${args.join(' ')}`);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      return '';
    };
    const py: PyRunner = () => {
      order.push('cards.py');
      return { exitCode: 0, stdout: '{"id":"rerun-atomic","path":"queue/inbox/rerun-atomic.md"}\n', stderr: '' };
    };
    ({ app } = buildApp({
      appendAudit: selfCommittingAudit.fn,
      appendAuditLocal: (_repo, event) => {
        order.push('audit:local');
        return recordingLocalAudit(localRows)(_repo, event);
      },
      runPy: py,
      opsGit: git,
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/write/rerun',
      headers: headers(true),
      payload: { cardId: 'orig-1', feedback: 'try again' },
    });
    expect(res.statusCode).toBe(200);
    const pull = order.indexOf('git:pull --rebase origin ops');
    const write = order.indexOf('cards.py');
    const add = order.findIndex((x) => x.startsWith('git:add -- '));
    expect(pull).toBeGreaterThanOrEqual(0);
    expect(pull).toBeLessThan(write);
    expect(write).toBeLessThan(add);
    expect(order[add]).toBe('git:add -- queue/inbox/rerun-atomic.md ledgers/audit/dashboard-audit.ndjson');
    expect(order.filter((x) => x.startsWith('git:commit '))).toHaveLength(1);
    expect(order.filter((x) => x === 'git:push origin ops')).toHaveLength(1);
    expect(localRows[0]).toMatchObject({ action: 'rerun', cardId: 'orig-1', result: 'requeued:rerun-atomic' });
    expect(selfCommittingAudit.rows).toHaveLength(0);
  });

  it('rejects a rerun cardId containing glob/traversal chars (400, never reaches the py runner)', async () => {
    const py = vi.fn();
    ({ app } = buildApp({ runPreamble: okPreamble, runPy: py as unknown as PyRunner }));
    for (const bad of ['*', 'card-*', '../etc/passwd', 'a b']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/write/rerun',
        headers: headers(true),
        payload: { cardId: bad, feedback: 'redo' },
      });
      expect(res.statusCode, bad).toBe(400);
      expect(res.json()).toMatchObject({ error: 'bad-card-id' });
    }
    expect(py).not.toHaveBeenCalled();
  });
});

describe('auth surface — fail-closed WebAuthn reality (no passkey provisioned)', () => {
  const testWebAuthn = () => ({ rpID: 'localhost', rpName: 'test', origin: GOOD_ORIGIN });

  it.each(['tailnet', 'win32-desktop'] as const)('exposes the guarded public auth context for %s', async (authMode) => {
    ({ app } = buildApp({ authMode }));

    const response = await app.inject({ method: 'GET', url: '/api/auth/context', headers: headers(false) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode: authMode });
  });

  it('assert/verify 401s because the credential store is empty (no session can be minted)', async () => {
    ({ app } = buildApp({ webAuthnConfig: testWebAuthn, credentials: () => [] }));

    // A real assertion ceremony issues a challenge; the store is fail-closed empty.
    const opts = await app.inject({ method: 'POST', url: '/api/auth/assert/options', headers: headers(false), payload: {} });
    expect(opts.statusCode).toBe(200);
    const { ceremonyId } = opts.json() as { ceremonyId: string };
    expect(typeof ceremonyId).toBe('string');

    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/assert/verify',
      headers: headers(false),
      payload: { ceremonyId, response: { id: 'no-such-credential' } },
    });
    expect(verify.statusCode).toBe(401);
    expect(verify.json()).toMatchObject({ error: 'unauthenticated' });
  });

  it('assert/verify 400s on an unknown/replayed ceremony id (single-use challenge)', async () => {
    ({ app } = buildApp({ webAuthnConfig: testWebAuthn, credentials: () => [] }));
    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/assert/verify',
      headers: headers(false),
      payload: { ceremonyId: 'never-issued', response: { id: 'x' } },
    });
    expect(verify.statusCode).toBe(400);
    expect(verify.json()).toMatchObject({ error: 'bad-ceremony' });
  });

  it('the whole surface is 403-locked when no RP origin is configured (empty allowlist)', async () => {
    // Default resolveAllowedOrigins({}) is []: fail-closed, every route 403s regardless of session.
    app = Fastify({ logger: false });
    registerWriteSurface(app, makeSurfaceContext({ repoRoot: REPO_A, sessionConfig, allowedOrigins: [] }));
    const res = await app.inject({ method: 'POST', url: '/api/approvals/verify', headers: headers(false), payload: {} });
    expect(res.statusCode).toBe(403);
  });
});

describe('approvals surface — verify wiring', () => {
  const CARD = [
    '---', 'id: card-77', 'project: kb', 'action: deploy:prod', 'target: infra/prod.yaml',
    'risk-tier: T3', 'owner: claude-m1', 'state: approvals', '---', '', '## Work order', '', 'ship it', '',
  ].join('\n');

  it('resolves cardId -> queue path, drives the verifier, and audits the outcome', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'u2-appr-'));
    mkdirSync(join(repoRoot, 'queue', 'approvals'), { recursive: true });
    writeFileSync(join(repoRoot, 'queue', 'approvals', 'card-77.md'), CARD, 'utf-8');
    const audit = recordingAudit();
    const verifierPy: PyRunner = () => ({
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, reason: 'verified', card: { id: 'card-77', action: 'deploy:prod', target: 'infra/prod.yaml', riskTier: 'T3', owner: 'claude-m1', body: 'ship it' } }),
      stderr: '',
    });
    ({ app } = buildApp({ repoRoot, appendAudit: audit.fn, runPy: verifierPy }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/approvals/verify',
      headers: headers(true),
      payload: { cardId: 'card-77', channel: 'webauthn' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, card: { id: 'card-77' } });
    expect(audit.rows[0]).toMatchObject({ action: 'approve', cardId: 'card-77', target: 'infra/prod.yaml', result: 'verified:webauthn' });
  });

  it('rejects a path-traversal cardId (400) — never hands an arbitrary path to the verifier', async () => {
    const py = vi.fn();
    ({ app } = buildApp({ runPy: py as unknown as PyRunner }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/approvals/verify',
      headers: headers(true),
      payload: { cardId: '../../etc/passwd', channel: 'signed' },
    });
    expect(res.statusCode).toBe(400);
    expect(py).not.toHaveBeenCalled();
  });
});

describe('surface — Wave-A executor activation wiring (env-gated, default OFF)', () => {
  const activatedTriple = () => ({
    controlBroker: { drain() {} } as unknown as NonNullable<SurfaceContext['controlBroker']>,
    runAutomatic: (async () => ({ state: 'succeeded', startedStageIds: [], completedStageIds: [], waitingStageIds: [] })) as unknown as NonNullable<SurfaceContext['runAutomatic']>,
    cancelAutomatic: (async () => ({ state: 'stopped', stoppedSessionRefs: [], interruptedSessionRefs: [], replayed: false })) as unknown as NonNullable<SurfaceContext['cancelAutomatic']>,
    containManagerStart: (async () => {}) as NonNullable<SurfaceContext['containManagerStart']>,
    verifyCanonicalResult: (async () => true) as NonNullable<SurfaceContext['verifyCanonicalResult']>,
  });

  it('CORE INERT INVARIANT: gate unset ⇒ controlBroker/runAutomatic/cancelAutomatic are undefined', () => {
    // Real builder, deterministic gate-off env — must return null and construct nothing.
    const ctx = makeSurfaceContext({ repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN] }, { env: {} });
    expect(ctx.controlBroker).toBeUndefined();
    expect(ctx.runAutomatic).toBeUndefined();
    expect(ctx.cancelAutomatic).toBeUndefined();
    expect(ctx.containManagerStart).toBeUndefined();
  });

  it('gate set ⇒ the three executor fields are populated from the builder result', () => {
    const triple = activatedTriple();
    const build = vi.fn().mockReturnValue(triple);
    const underlying = recordingPtyHost();
    const ctx = makeSurfaceContext(
      { repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN], ptyHost: underlying.host },
      { build: build as never, env: { DASHBOARD_EXECUTION_ACTIVATED: '1' } },
    );
    expect(build).toHaveBeenCalledTimes(1);
    // The builder receives the gate env, the resolved control store, and the ops repo root.
    expect(build).toHaveBeenCalledWith(expect.objectContaining({
      env: { DASHBOARD_EXECUTION_ACTIVATED: '1' },
      repoRoot: REPO_A,
    }));
    expect(build.mock.calls[0][0]).not.toHaveProperty('ptyHost');
    expect(build.mock.calls[0][0]).not.toHaveProperty('ptySessions');
    expect(ctx.ptyHost).not.toBe(underlying.host);
    expect(ctx.controlBroker).toBe(triple.controlBroker);
    expect(ctx.runAutomatic).toBe(triple.runAutomatic);
    expect(ctx.cancelAutomatic).toBe(triple.cancelAutomatic);
    expect(ctx.containManagerStart).toBe(triple.containManagerStart);
    expect(ctx.verifyCanonicalResult).toBe(triple.verifyCanonicalResult);
  });

  it('an explicit executor override wins and short-circuits activation entirely (builder never called)', () => {
    const build = vi.fn().mockReturnValue(activatedTriple());
    const overrideBroker = { drain() {} } as unknown as NonNullable<SurfaceContext['controlBroker']>;
    const ctx = makeSurfaceContext(
      { repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN], controlBroker: overrideBroker },
      { build: build as never, env: { DASHBOARD_EXECUTION_ACTIVATED: '1' } },
    );
    expect(build).not.toHaveBeenCalled();
    expect(ctx.controlBroker).toBe(overrideBroker);
    expect(ctx.runAutomatic).toBeUndefined();
    expect(ctx.cancelAutomatic).toBeUndefined();
    expect(ctx.containManagerStart).toBeUndefined();
  });

  it('publishes attempt-io while unlocked and drops the tap when the latch locks', () => {
    let emit: ((event: AttemptIoAppend) => void) | undefined;
    const off = vi.fn(() => { emit = undefined; });
    const bus = { publish: vi.fn(), subscribe: vi.fn(), subscriberCount: vi.fn() } as unknown as EventBus;
    const triple = {
      ...activatedTriple(),
      attemptIo: {
        onAppend: vi.fn((listener: (event: AttemptIoAppend) => void) => {
          emit = listener;
          return off;
        }),
        stop: vi.fn(),
      },
    };
    const ctx = makeSurfaceContext(
      { repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN], hubBus: bus },
      { build: vi.fn().mockReturnValue(triple) as never, env: {} },
    );

    expect(ctx.executionLatch?.unlock({ subject: 'operator' }).ok).toBe(true);
    emit?.({ attemptRef: 'attempt-1', entry: { seq: 1, t: '2026-08-06T00:00:00.000Z', dir: 'out', line: 'redacted' } });
    expect(bus.publish).toHaveBeenCalledWith({
      channel: 'control', kind: 'attempt-io',
      data: { attemptRef: 'attempt-1', seq: 1 },
    });

    ctx.executionLatch?.lock({ subject: 'operator' });
    emit?.({ attemptRef: 'attempt-1', entry: { seq: 2, t: '2026-08-06T00:00:01.000Z', dir: 'out', line: 'after lock' } });
    expect(off).toHaveBeenCalledOnce();
    expect(bus.publish).toHaveBeenCalledTimes(1);
  });

  it('starts the queue bridge on unlock, binds dispatch to the armed principal, and stops it once on lock', async () => {
    const triple = activatedTriple();
    const start = vi.fn();
    const stop = vi.fn();
    const bridge = { tick: vi.fn(), start, stop };
    let bridgeOptions: QueueBridgeOptions | undefined;
    const createBridge = vi.fn((options: QueueBridgeOptions) => {
      bridgeOptions = options;
      return bridge;
    });
    const dispatch = vi.fn().mockResolvedValue({ outcome: 'launched' });
    const ctx = makeSurfaceContext(
      { repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN], runPreamble: okPreamble, runPy: okPy },
      { build: vi.fn().mockReturnValue(triple) as never, env: {}, createQueueBridge: createBridge, dispatchClaimedCard: dispatch as never },
    );

    expect(createBridge).not.toHaveBeenCalled();
    expect(ctx.executionLatch?.unlock({ subject: 'operator' }).ok).toBe(true);
    expect(createBridge).toHaveBeenCalledWith(expect.objectContaining({
      repoRoot: REPO_A,
      runPreamble: okPreamble,
      runPy: okPy,
    }));
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(15_000);

    const card: OwnedCard = { id: 'card-1', path: 'queue/inbox/card-1.md', state: 'inbox' };
    await bridgeOptions?.dispatch?.(card);
    expect(dispatch).toHaveBeenCalledWith(ctx, card, expect.objectContaining({
      internalCaller: expect.any(Function), resolveScheduleReceiptOwner: expect.any(Function),
    }));
    const internalCaller = dispatch.mock.calls[0][2].internalCaller as (subject: string) => unknown;
    const receiptOwner = dispatch.mock.calls[0][2].resolveScheduleReceiptOwner as (cardId: string) => unknown;
    expect(receiptOwner('unmatched-card')).toBeNull();
    expect(internalCaller('dashboard-engine')).toMatchObject({ subject: 'dashboard-engine' });
    expect(() => internalCaller('other-subject')).toThrow(/unexpected internal service subject/);

    ctx.executionLatch?.lock({ subject: 'operator' });
    expect(stop).toHaveBeenCalledOnce();
    expect(ctx.stopQueueBridge).toBeUndefined();
    expect(() => internalCaller('dashboard-engine')).toThrow(/armed execution window/);
    await expect(bridgeOptions?.dispatch?.(card)).rejects.toThrow(/armed execution window/);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('constructs no queue bridge while boot-locked', () => {
    const createBridge = vi.fn();
    const ctx = makeSurfaceContext(
      { repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN] },
      { env: {}, createQueueBridge: createBridge },
    );
    expect(ctx.executionLatch?.snapshot().state).toBe('locked');
    expect(createBridge).not.toHaveBeenCalled();
    expect(ctx.stopQueueBridge).toBeUndefined();
  });

  it('does not construct the queue bridge for a headless env-override arm', () => {
    const createBridge = vi.fn();
    const ctx = makeSurfaceContext(
      { repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN] },
      { build: vi.fn().mockReturnValue(activatedTriple()) as never, env: { DASHBOARD_EXECUTION_ACTIVATED: '1' }, createQueueBridge: createBridge },
    );
    expect(ctx.executionLatch?.snapshot().source).toBe('env-override');
    expect(createBridge).not.toHaveBeenCalled();
    expect(ctx.stopQueueBridge).toBeUndefined();
  });

  it('tailnet mode arms the latch AND starts the queue bridge at BOOT — no unlock call', () => {
    const start = vi.fn();
    const createBridge = vi.fn(() => ({ tick: vi.fn(), start, stop: vi.fn() }));
    const ctx = makeSurfaceContext(
      { repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN] },
      {
        build: vi.fn().mockReturnValue(activatedTriple()) as never,
        env: { DASHBOARD_AUTH_MODE: 'tailnet', DASHBOARD_TAILNET_HOST: 'kb.command.ts.net', DASHBOARD_TAILNET_OPERATOR: 'op@example.com' },
        createQueueBridge: createBridge as never,
      },
    );
    expect(ctx.executionLatch?.snapshot()).toMatchObject({ state: 'unlocked', source: 'tailnet' });
    expect(ctx.authMode).toBe('tailnet');
    expect(createBridge).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(15_000);
    expect(ctx.stopQueueBridge).toBeTypeOf('function');
  });

  it('tailnet mode installs the operator authenticator on the shared session config', () => {
    const ctx = makeSurfaceContext(
      { repoRoot: REPO_A, allowedOrigins: [GOOD_ORIGIN] },
      { env: { DASHBOARD_AUTH_MODE: 'tailnet', DASHBOARD_TAILNET_HOST: 'kb.command.ts.net', DASHBOARD_TAILNET_OPERATOR: 'op@example.com' } },
    );
    expect(ctx.sessionConfig.operatorAuth).toBeDefined();
  });

  it('win32-desktop mode leaves the session config free of any operator authenticator', () => {
    const ctx = makeSurfaceContext({ repoRoot: REPO_A, allowedOrigins: [GOOD_ORIGIN] }, { env: {} });
    expect(ctx.authMode).toBe('win32-desktop');
    expect(ctx.sessionConfig.operatorAuth).toBeUndefined();
  });

  it('logs a non-launched dispatch outcome once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let bridgeOptions: QueueBridgeOptions | undefined;
    const createBridge = vi.fn((options: QueueBridgeOptions) => {
      bridgeOptions = options;
      return { tick: vi.fn(), start: vi.fn(), stop: vi.fn() };
    });
    const dispatch = vi.fn().mockResolvedValue({ cardId: 'card-1', outcome: 'blocked', status: 0, reconciled: false });
    const ctx = makeSurfaceContext(
      { repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN] },
      { build: vi.fn().mockReturnValue(activatedTriple()) as never, env: {}, createQueueBridge: createBridge, dispatchClaimedCard: dispatch as never },
    );
    expect(ctx.executionLatch?.unlock({ subject: 'operator' }).ok).toBe(true);
    await bridgeOptions?.dispatch?.({ id: 'card-1', path: 'queue/inbox/card-1.md', state: 'inbox' });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('stops an armed queue bridge during app close', async () => {
    const stop = vi.fn();
    const createBridge = vi.fn(() => ({ tick: vi.fn(), start: vi.fn(), stop }));
    const ctx = makeSurfaceContext(
      { repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN] },
      { build: vi.fn().mockReturnValue(activatedTriple()) as never, env: {}, createQueueBridge: createBridge },
    );
    expect(ctx.executionLatch?.unlock({ subject: 'operator' }).ok).toBe(true);
    app = Fastify({ logger: false });
    registerWriteSurface(app, ctx);
    await app.close();
    app = undefined;
    expect(stop).toHaveBeenCalledOnce();
    expect(ctx.stopQueueBridge).toBeUndefined();
  });
});

describe('surface — shared PTY host fleet gate', () => {
  const request: HostOpenRequest = { requestId: 'req-1', cwd: REPO_A, cols: 80, rows: 24 };

  it('fails closed before the underlying open and redacts all preamble failure details', () => {
    const underlying = recordingPtyHost();
    const sensitive = 'credential=provider-secret-value';
    const runPreamble = vi.fn((_repoRoot: string) => ({
      exitCode: 1,
      stdout: `PREAMBLE FAIL: STOP present; ${sensitive}`,
      stderr: `stderr ${sensitive}`,
    }));
    const ctx = makeSurfaceContext({
      repoRoot: REPO_A,
      sessionConfig,
      allowedOrigins: [GOOD_ORIGIN],
      runtimeCapabilities: runtimeCapabilities('win32', AVAILABLE_PTY),
      ptyHost: underlying.host,
      runPreamble,
    });

    expect(runPreamble).not.toHaveBeenCalled();
    let thrown: Error | null = null;
    try {
      ctx.ptyHost?.open(request);
    } catch (error) {
      thrown = error as Error;
    }

    expect(runPreamble).toHaveBeenCalledTimes(1);
    expect(runPreamble).toHaveBeenCalledWith(REPO_A);
    expect(underlying.open).not.toHaveBeenCalled();
    expect(thrown?.message).toBe(PTY_OPEN_FLEET_FROZEN);
    expect(thrown?.message).not.toContain('STOP');
    expect(thrown?.message).not.toContain(sensitive);
  });

  it('delegates exactly one passing open and preserves every lifecycle method', () => {
    const underlying = recordingPtyHost();
    const runPreamble = vi.fn((_repoRoot: string) => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }));
    const ctx = makeSurfaceContext({
      repoRoot: REPO_A,
      sessionConfig,
      allowedOrigins: [GOOD_ORIGIN],
      runtimeCapabilities: runtimeCapabilities('win32', AVAILABLE_PTY),
      ptyHost: underlying.host,
      runPreamble,
    });
    const host = ctx.ptyHost as PtyHost;

    expect(host.open(request)).toBe(underlying.session);
    expect(runPreamble).toHaveBeenCalledOnce();
    expect(runPreamble).toHaveBeenCalledWith(REPO_A);
    expect(underlying.open).toHaveBeenCalledOnce();
    expect(underlying.open).toHaveBeenCalledWith(request);

    expect(host.stop('pty-surface-test')).toBe(true);
    host.stopAll();
    expect(host.sessions()).toEqual(['pty-surface-test']);
    expect(underlying.stop).toHaveBeenCalledWith('pty-surface-test');
    expect(underlying.stopAll).toHaveBeenCalledOnce();
    expect(underlying.sessions).toHaveBeenCalledOnce();
  });
});

describe('P1 route matrix', () => {
  it('retains verify and fleet STOP while retired writes and Composer are 404', async () => {
    ({ app } = buildApp());
    for (const url of ['/api/approvals/verify', '/api/write/stop']) {
      expect((await app.inject({ method: 'POST', url, headers: headers(false), payload: {} })).statusCode, url).toBe(401);
    }
    for (const request of [
      { method: 'POST' as const, url: '/api/write/stop-card' },
      { method: 'GET' as const, url: '/api/human-inbox' },
      { method: 'GET' as const, url: '/api/approvals' },
      { method: 'GET' as const, url: '/api/composer/sessions' },
      { method: 'POST' as const, url: '/api/composer/sessions' },
    ]) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: headers(true),
        ...(request.method === 'POST' ? { payload: {} } : {}),
      });
      expect(response.statusCode, request.url).toBe(404);
    }
  });
});

describe('P2 production migration evidence wiring', () => {
  function fixture(): { repoRoot: string; stateRoot: string; path: string } {
    const repoRoot = mkdtempSync(join(tmpdir(), 'kb-surface-p2-repo-'));
    const stateRoot = mkdtempSync(join(tmpdir(), 'kb-surface-p2-state-'));
    mkdirSync(join(repoRoot, 'agents'), { recursive: true });
    mkdirSync(join(repoRoot, 'ledgers', 'audit'), { recursive: true });
    mkdirSync(join(stateRoot, 'control'), { recursive: true });
    copyFileSync(join(KB_REPO, 'agents', 'grader.md'), join(repoRoot, 'agents', 'grader.md'));
    const run = (overrides: Record<string, unknown>) => ({
      subject: 'operator', runRef: 'run-evidence', predecessorRunRef: null, title: 'Evidence fixture',
      proposalRef: 'proposal-evidence', proposalRevision: 1, proposalHash: 'a'.repeat(64),
      publicationState: 'published', lifecycle: { kind: 'running', deployPause: null }, version: 1,
      managerSessionRef: 'session-manager', managerGeneration: 1, managerAssignment: null,
      agentWorkspaceLaunch: {
        composerRef: 'composer-evidence', agentId: 'grader', declarationPath: 'agents/grader.md',
        declarationHash: normalizedTextSha256(readFileSync(join(repoRoot, 'agents', 'grader.md'))),
      },
      activationReceipts: [], authorizedFailedRunReconciliation: null,
      createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:02.000Z',
      ...overrides,
    });
    const document = JSON.parse(readFileSync(join(KB_REPO, 'tests', 'fixtures', 'control-plane', 'v2-empty.json'), 'utf8'));
    document.runs = [run({}), run({ runRef: 'run-archive-evidence', lifecycle: { kind: 'archived', deployPause: null },
      version: 2, archiveOperationKey: 'archive-evidence' })];
    writeFileSync(join(repoRoot, 'ledgers', 'audit', 'dashboard-audit.ndjson'), `${JSON.stringify({
      ts: '2026-08-21T00:00:01.000Z', action: 'control-run-archive-authorize', target: 'run-archive-evidence',
      result: 'authorized:archive-evidence', detail: { runOwnerSubject: 'operator', runVersion: 1, runState: 'waiting-human' },
    })}\n`, 'utf8');
    const path = join(stateRoot, 'control', 'control-plane.json');
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    return { repoRoot, stateRoot, path };
  }

  it('migrates through real surface wiring only when declaration and archive-audit evidence are present', () => {
    const success = fixture();
    const successLease = acquireWriterLease({ stateRoot: success.stateRoot, bootId: 'surface-evidence-success' });
    try {
      makeProductionSurfaceContext({ repoRoot: success.repoRoot, stateRoot: success.stateRoot,
        fileControlAccess: { mode: 'already-locked', lease: successLease } });
      expect(JSON.parse(readFileSync(success.path, 'utf8'))).toMatchObject({
        version: 3,
        runs: [
          { owner: { type: 'agent', id: 'grader' }, terminalOutcome: null },
          { owner: { type: 'agent', id: 'grader' }, terminalOutcome: 'abandoned', archivedFrom: 'waiting-human' },
        ],
      });
    } finally {
      successLease.release();
      rmSync(success.repoRoot, { recursive: true, force: true });
      rmSync(success.stateRoot, { recursive: true, force: true });
    }

    const withheld = fixture();
    const before = readFileSync(withheld.path);
    unlinkSync(join(withheld.repoRoot, 'agents', 'grader.md'));
    const withheldLease = acquireWriterLease({ stateRoot: withheld.stateRoot, bootId: 'surface-evidence-withheld' });
    try {
      expect(() => makeProductionSurfaceContext({ repoRoot: withheld.repoRoot, stateRoot: withheld.stateRoot,
        fileControlAccess: { mode: 'already-locked', lease: withheldLease } })).toThrow(/run-owner-migration-required/);
      expect(readFileSync(withheld.path)).toEqual(before);
    } finally {
      withheldLease.release();
      rmSync(withheld.repoRoot, { recursive: true, force: true });
      rmSync(withheld.stateRoot, { recursive: true, force: true });
    }
  });
});
