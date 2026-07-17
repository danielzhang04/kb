/**
 * C1 — Composer turn route. Composed exactly like `vibe/routes.ts`: a `requireSession` preHandler, then
 * hand off to `composer/session.ts#spawnComposerTurn` (which re-runs spawnVibe's authoritative gates and
 * writes the single audit row). The route only wires the resulting NDJSON stream — {type:'delta'},
 * {type:'session'}, {type:'stderr'}, {type:'exit'} — or a calm refusal with a mapped status. These tests
 * inject the same hermetic leaf fakes the gate modules use; no real `claude` process is ever spawned.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { makeSurfaceContext } from '../http/surface.ts';
import type { SurfaceContext } from '../http/context.ts';
import { registerComposerRoutes } from './routes.ts';
import { mintSession } from '../auth/session.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { VibeProcess, VibeSpawner } from '../vibe/session.ts';

const SECRET = Buffer.from('composer-routes-test-secret-0123456789');
const sessionConfig = { secret: SECRET, ttlMs: 60_000 };

function recordingAudit(): { rows: AuditRow[]; fn: SurfaceContext['appendAudit'] } {
  const rows: AuditRow[] = [];
  const fn: SurfaceContext['appendAudit'] = (_repoRoot: string, event: AuditEvent): AuditRow => {
    const row: AuditRow = { ts: '2026-07-17T00:00:00.000Z', ...event };
    rows.push(row);
    return row;
  };
  return { rows, fn };
}

const okPreamble: PreambleRunner = () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' });
const frozenPreamble: PreambleRunner = () => ({ exitCode: 1, stdout: 'PREAMBLE FAIL: STOP file present — fleet frozen', stderr: '' });

function token(): string {
  return mintSession('operator', sessionConfig).token;
}

/** Register just the composer route on a bare scope — the route owns its own requireSession preHandler
 *  (mirrors how a caller mounts vibe). No origin/rate-limit hooks here; those are the surface's job and
 *  are proven separately in `surface.test.ts`. */
function buildApp(overrides: Partial<SurfaceContext> = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const ctx = makeSurfaceContext({ repoRoot: '/repo', sessionConfig, ...overrides });
  app.register(async (scope) => {
    registerComposerRoutes(scope, ctx);
  });
  return app;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe('composer route — refusal-status mapping', () => {
  it('401s without a session, before any spawn', async () => {
    const spawn = vi.fn();
    app = buildApp({ spawn: spawn as unknown as VibeSpawner });
    const res = await app.inject({
      method: 'POST',
      url: '/api/composer/turn',
      headers: { 'content-type': 'application/json' },
      payload: { prompt: 'hi' },
    });
    expect(res.statusCode).toBe(401);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('503s (fleet-frozen) via spawnComposerTurn and audits the refused attempt, never spawning', async () => {
    const audit = recordingAudit();
    const spawn = vi.fn();
    app = buildApp({ appendAudit: audit.fn, runPreamble: frozenPreamble, spawn: spawn as unknown as VibeSpawner });
    const res = await app.inject({
      method: 'POST',
      url: '/api/composer/turn',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
      payload: { prompt: 'hi' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'fleet-frozen' });
    expect(spawn).not.toHaveBeenCalled();
    expect(audit.rows[0]).toMatchObject({ action: 'vibe-spawn', result: 'fleet-frozen' });
  });
});

describe('composer route — NDJSON framing + session_id round-trip', () => {
  it('streams delta + a session frame carrying the CLI session_id + exit, over real HTTP', async () => {
    const audit = recordingAudit();
    // A fake spawner that, ASYNCHRONOUSLY (as a real child does, after the route has hijacked and
    // started streaming), emits a `system` init line (carrying session_id) then a content line, then exits.
    const spawn: VibeSpawner = (_args, _cwd): VibeProcess => {
      let onOut: ((c: string) => void) | undefined;
      let onExit: ((c: number | null) => void) | undefined;
      return {
        onStdout(cb) {
          onOut = cb;
        },
        onStderr() {},
        onExit(cb) {
          onExit = cb;
        },
        writeStdin() {},
        endStdin() {
          setImmediate(() => {
            onOut?.('{"type":"system","subtype":"init","session_id":"sess-http"}\n');
            onOut?.('{"type":"user","uuid":"u1","timestamp":"2026-07-17T00:00:00Z"}\n');
            onExit?.(0);
          });
        },
        kill() {},
      };
    };
    app = buildApp({ appendAudit: audit.fn, runPreamble: okPreamble, spawn });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/composer/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
      body: JSON.stringify({ prompt: 'hello fleet' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const frames = (await res.text())
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; sessionId?: string });

    expect(frames.find((f) => f.type === 'session')?.sessionId).toBe('sess-http');
    expect(frames.some((f) => f.type === 'delta')).toBe(true);
    expect(frames.some((f) => f.type === 'exit')).toBe(true);
    expect(audit.rows.some((r) => r.action === 'vibe-spawn' && r.result === 'spawned')).toBe(true);
  });

  it('threads body.resumeId into the spawn as --resume on a continuing turn', async () => {
    const calls: string[][] = [];
    const spawn: VibeSpawner = (args, _cwd): VibeProcess => {
      calls.push(args);
      let onExit: ((c: number | null) => void) | undefined;
      return {
        onStdout() {},
        onStderr() {},
        onExit(cb) {
          onExit = cb;
        },
        writeStdin() {},
        endStdin() {
          setImmediate(() => onExit?.(0));
        },
        kill() {},
      };
    };
    app = buildApp({ appendAudit: recordingAudit().fn, runPreamble: okPreamble, spawn });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/composer/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
      body: JSON.stringify({ prompt: 'again', resumeId: 'sess-prev' }),
    });
    await res.text();
    expect(calls[0]).toEqual(['--print', '--output-format', 'stream-json', '--resume', 'sess-prev']);
  });
});
