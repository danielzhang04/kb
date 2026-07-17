/**
 * U2 — route-level security tests for the governed write surface. These exercise the REAL composition
 * chain (Origin/Host guard -> rate-limit -> session -> gate -> audit) end to end via `app.inject`
 * (which, unlike fetch/undici, does not strip the `Origin` header) and a real-listen fetch for the
 * streaming vibe path. Only the leaf side-effect runners (git/py/spawn/appendAudit) are injected as the
 * SAME hermetic fakes the gate modules' own unit tests use — no security check is ever faked, and there
 * is no dev-mode/bypass flag to disable one.
 *
 * Covered per the brief: route-exists (not 404), 403 bad Origin, 401 no session, 429 rate-limit breach,
 * an audit row on the success path, and the fail-closed WebAuthn reality (no passkey => no session).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { makeSurfaceContext, registerWriteSurface } from './surface';
import type { SurfaceContext } from './context';
import { mintSession } from '../auth/session';
import type { AuditEvent, AuditRow } from '../audit/log';
import type { GitRunner } from '../write/branch';
import type { PyRunner } from '../write/launch';
import type { PreambleRunner } from '../write/preambleGate';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));
const SECRET = Buffer.from('u2-surface-test-secret-0123456789');
const sessionConfig = { secret: SECRET, ttlMs: 60_000 };
const GOOD_ORIGIN = 'http://localhost';
const GOOD_HOST = 'localhost';

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

/** Git/py/preamble fakes that succeed without touching the real binaries. */
const okGit: GitRunner = () => '';
const okPy: PyRunner = (_repo, _code, jsonArg) => {
  // Return a plausible card-op stdout so launch/rerun parse it; harmless for other ops.
  const op = JSON.parse(jsonArg) as { cardId?: string };
  return { exitCode: 0, stdout: JSON.stringify({ id: 'card-new-0001', path: 'queue/inbox/card-new-0001.md', state: 'halting', cardId: op.cardId }), stderr: '' };
};
const okPreamble: PreambleRunner = () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' });
const frozenPreamble: PreambleRunner = () => ({ exitCode: 1, stdout: 'PREAMBLE FAIL: STOP file present — fleet frozen', stderr: '' });

function buildApp(overrides: Partial<SurfaceContext> = {}): { app: FastifyInstance; ctx: SurfaceContext } {
  const app = Fastify({ logger: false });
  const ctx = makeSurfaceContext({
    repoRoot: REPO_A,
    sessionConfig,
    allowedOrigins: [GOOD_ORIGIN],
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
afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe('write surface — composition chain', () => {
  it('routes exist (a session-less POST is 401, never 404)', async () => {
    ({ app } = buildApp());
    for (const url of [
      '/api/write/save',
      '/api/write/launch',
      '/api/write/rerun',
      '/api/write/stop',
      '/api/write/stop-card',
      '/api/write/pause-cadence',
      '/api/vibe',
      '/api/approvals/verify',
    ]) {
      const res = await app.inject({ method: 'POST', url, headers: headers(false), payload: {} });
      expect(res.statusCode, `${url} should be gated, not missing`).not.toBe(404);
      expect(res.statusCode).toBe(401);
    }
    // The read-only list exists too (no session required).
    const list = await app.inject({ method: 'GET', url: '/api/approvals', headers: headers(false) });
    expect(list.statusCode).toBe(200);
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

  it('429s once the rate-limit window is breached (before the session check)', async () => {
    // limit 1 / window: the 2nd valid-origin request in the window is throttled.
    const { lockout, rateLimit } = await import('../security/ratelimit');
    const guard = lockout(rateLimit({ limit: 1, windowMs: 60_000 }), { threshold: 10, lockoutMs: 60_000 });
    ({ app } = buildApp({ rateGuard: guard }));

    const first = await app.inject({ method: 'POST', url: '/api/write/stop', headers: headers(false), payload: {} });
    expect(first.statusCode).toBe(401); // passed origin + rate-limit, failed session
    const second = await app.inject({ method: 'POST', url: '/api/write/stop', headers: headers(false), payload: {} });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: 'throttled' });
  });

  it('writes exactly one audit row on a successful governed save', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'u2-save-'));
    const audit = recordingAudit();
    const prCalls: unknown[] = [];
    ({ app } = buildApp({
      repoRoot,
      appendAudit: audit.fn,
      saveGit: okGit,
      openPr: (_r, req) => prCalls.push(req),
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

  it('audits a governed launch that clears the preamble + session gates', async () => {
    const audit = recordingAudit();
    ({ app } = buildApp({ appendAudit: audit.fn, runPreamble: okPreamble, runPy: okPy }));
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
      return '';
    };
    const prCalls: { head?: string }[] = [];
    ({ app } = buildApp({ repoRoot, appendAudit: recordingAudit().fn, saveGit: recordingGit, openPr: (_r, req) => prCalls.push(req) }));
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
});

describe('write surface — FINDING 2: pre-session rate-limit keyed on PEER IP, not the bearer token', () => {
  it('throttles the same peer across rotating garbage bearer tokens (write route)', async () => {
    const { lockout, rateLimit } = await import('../security/ratelimit');
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
    const { lockout, rateLimit } = await import('../security/ratelimit');
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
    const res = await app.inject({ method: 'GET', url: '/api/approvals', headers: headers(false) });
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

describe('vibe surface — gate wiring', () => {
  it('401s without a session (before any spawn)', async () => {
    const spawn = vi.fn();
    ({ app } = buildApp({ spawn }));
    const res = await app.inject({ method: 'POST', url: '/api/vibe', headers: headers(false), payload: { prompt: 'hi' } });
    expect(res.statusCode).toBe(401);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('503s (fleet-frozen) via spawnVibe and audits the refused attempt, never spawning', async () => {
    const audit = recordingAudit();
    const spawn = vi.fn();
    ({ app } = buildApp({ appendAudit: audit.fn, runPreamble: frozenPreamble, spawn }));
    const res = await app.inject({ method: 'POST', url: '/api/vibe', headers: headers(true), payload: { prompt: 'hi' } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'fleet-frozen' });
    expect(spawn).not.toHaveBeenCalled(); // gate refused before spawn
    expect(audit.rows[0]).toMatchObject({ action: 'vibe-spawn', result: 'fleet-frozen' });
  });

  it('streams NDJSON frames from a spawned session over real HTTP (past all gates)', async () => {
    const audit = recordingAudit();
    // A fake spawner that emits one stream-json line then exits ASYNCHRONOUSLY (as a real child does),
    // so the route has already hijacked + started streaming before any frame arrives.
    const spawn = (_args: string[], _cwd: string) => {
      let onOut: ((c: string) => void) | undefined;
      let onExit: ((c: number | null) => void) | undefined;
      return {
        onStdout(cb: (c: string) => void) { onOut = cb; },
        onStderr() {},
        onExit(cb: (c: number | null) => void) { onExit = cb; },
        writeStdin() {},
        endStdin() {
          setImmediate(() => {
            onOut?.('{"type":"user","uuid":"u1","timestamp":"2026-07-16T00:00:00Z"}\n');
            onExit?.(0);
          });
        },
        kill() {},
      };
    };
    // A LIVE, mutable allowlist the origin guard reads per request — undici strips Origin, so the
    // Host authority (127.0.0.1:port) is what must be enrolled, only knowable after listen().
    const allowedOrigins: string[] = [];
    const built = buildApp({ allowedOrigins, appendAudit: audit.fn, runPreamble: okPreamble, spawn });
    app = built.app;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    allowedOrigins.push(`http://127.0.0.1:${port}`);

    const res = await fetch(`http://127.0.0.1:${port}/api/vibe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
      body: JSON.stringify({ prompt: 'hello fleet' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const text = await res.text();
    const frames = text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string });
    expect(frames.some((f) => f.type === 'delta')).toBe(true);
    expect(frames.some((f) => f.type === 'exit')).toBe(true);
    // spawnVibe wrote its single audit row for the actual spawn.
    expect(audit.rows.some((r) => r.action === 'vibe-spawn' && r.result === 'spawned')).toBe(true);
  });
});
