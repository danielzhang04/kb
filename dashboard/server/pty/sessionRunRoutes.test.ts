/**
 * Hermetic tests for the session-run REST surface. A real Fastify instance, a real store over a temp
 * state root, a real transcript recorder, and a recording audit sink — no network, no git, no control
 * plane, and nothing written outside the temp directory.
 *
 * The load-bearing claims: every route is bearer-gated and owner-scoped (a foreign ref 404s), the boot
 * sweep runs at registration, and the archive endpoint holds the copied governed shape — T3 audit BEFORE
 * the mutation, refusal when the audit cannot be written, idempotent by key, and refused outright while
 * the session is live.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import { createSessionRunStore } from './sessionRuns.ts';
import type { SessionRunStore } from './sessionRuns.ts';
import { createTranscriptRecorder, transcriptPath } from './transcripts.ts';
import { registerSessionRunRoutes } from './sessionRunRoutes.ts';

const SECRET = Buffer.from('session-run-route-test-secret-do-not-reuse');
const SESSION_CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };
const token = (sub = 'operator-1'): string => mintSession(sub, SESSION_CONFIG).token;
const auth = (sub = 'operator-1') => ({ authorization: `Bearer ${token(sub)}` });

const dirs: string[] = [];
function stateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kb-session-run-routes-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function recordingAudit() {
  const rows: AuditEvent[] = [];
  const fn = (_repoRoot: string, event: AuditEvent): AuditRow => {
    rows.push(event);
    return { ts: 'fixed-ts', ...event };
  };
  return { fn, rows };
}

async function harness(options: {
  store?: SessionRunStore;
  root?: string;
  appendAudit?: (repoRoot: string, event: AuditEvent) => AuditRow | Promise<AuditRow>;
  transcripts?: ReturnType<typeof createTranscriptRecorder>;
} = {}): Promise<{
  app: FastifyInstance;
  store: SessionRunStore;
  audit: ReturnType<typeof recordingAudit>;
  root: string;
}> {
  const root = options.root ?? stateRoot();
  const store = options.store ?? createSessionRunStore(root);
  const audit = recordingAudit();
  const app = Fastify();
  await registerSessionRunRoutes(app, {
    repoRoot: '/repo',
    sessionConfig: SESSION_CONFIG,
    sessionRuns: store,
    transcripts: options.transcripts ?? createTranscriptRecorder({ root }),
    appendAudit: options.appendAudit ?? audit.fn,
  });
  await app.ready();
  return { app, store, audit, root };
}

describe('GET /api/pty/session-runs', () => {
  it('accepts bearer or session cookie and lists only the caller-owned runs, newest first', async () => {
    const root = stateRoot();
    const store = createSessionRunStore(root);
    const { app } = await harness({ store, root });
    // Sessions spawn AFTER the daemon boots — a record created before registration would (correctly) be
    // swept to `abandoned` by the boot sweep, which is a different test.
    await store.create({ owner: 'operator-1', kind: 'agent', targetRef: 'fyt-runner', ptySessionId: 'pty-a' });
    await store.create({ owner: 'operator-2', kind: 'agent', targetRef: 'other-agent', ptySessionId: 'pty-b' });
    try {
      expect((await app.inject({ method: 'GET', url: '/api/pty/session-runs' })).statusCode).toBe(401);

      const mine = await app.inject({ method: 'GET', url: '/api/pty/session-runs', headers: auth('operator-1') });
      expect(mine.statusCode).toBe(200);
      const runs = mine.json().sessionRuns as Array<Record<string, unknown>>;
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ targetRef: 'fyt-runner', outcome: 'live', kind: 'agent' });
      // Server-internal fields are not published to a browser.
      expect(runs[0]).not.toHaveProperty('owner');
      expect(runs[0]).not.toHaveProperty('primingPath');

      const cookie = await app.inject({
        method: 'GET', url: '/api/pty/session-runs', headers: { cookie: `kb_session=${encodeURIComponent(token('operator-1'))}` },
      });
      expect(cookie.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('excludes archived runs unless includeArchived=1 is asked for', async () => {
    const root = stateRoot();
    const store = createSessionRunStore(root);
    const record = await store.create({ owner: 'operator-1', kind: 'agent', targetRef: 'a', ptySessionId: null });
    await store.end('operator-1', record.sessionRunRef);
    await store.archive('operator-1', record.sessionRunRef, { idempotencyKey: 'k', reason: null });
    const { app } = await harness({ store, root });
    try {
      const hidden = await app.inject({ method: 'GET', url: '/api/pty/session-runs', headers: auth() });
      expect(hidden.json().sessionRuns).toEqual([]);
      const shown = await app.inject({
        method: 'GET', url: '/api/pty/session-runs?includeArchived=1', headers: auth(),
      });
      expect(shown.json().sessionRuns).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

describe('the boot sweep runs at registration', () => {
  it('corrects a live record left by the previous daemon before any request can read it', async () => {
    const root = stateRoot();
    const previous = createSessionRunStore(root);
    const stale = await previous.create({ owner: 'operator-1', kind: 'agent', targetRef: 'a', ptySessionId: 'pty-x' });
    const { app, store } = await harness({ root });
    try {
      expect(store.get('operator-1', stale.sessionRunRef)).toMatchObject({ outcome: 'abandoned' });
      const listed = await app.inject({ method: 'GET', url: '/api/pty/session-runs', headers: auth() });
      expect((listed.json().sessionRuns as Array<{ outcome: string }>)[0]?.outcome).toBe('abandoned');
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/pty/session-runs/:ref', () => {
  it('returns the record plus its transcript text', async () => {
    const root = stateRoot();
    const store = createSessionRunStore(root);
    const transcripts = createTranscriptRecorder({ root });
    const record = await store.create({ owner: 'operator-1', kind: 'agent', targetRef: 'a', ptySessionId: 'pty-test-1' });
    // Simulate a taped session by writing through the recorder's own path.
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    const path = transcriptPath(root, 'pty-test-1');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'the session said this', 'utf8');
    const { app } = await harness({ store, root, transcripts });
    try {
      const res = await app.inject({
        method: 'GET', url: `/api/pty/session-runs/${record.sessionRunRef}`, headers: auth(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().sessionRun).toMatchObject({ sessionRunRef: record.sessionRunRef, targetRef: 'a' });
      expect(res.json().transcript).toMatchObject({ text: 'the session said this', truncated: false });
    } finally {
      await app.close();
      transcripts.dispose();
    }
  });

  it('404s a foreign ref, an unknown ref, and a malformed ref alike', async () => {
    const root = stateRoot();
    const store = createSessionRunStore(root);
    const mine = await store.create({ owner: 'operator-1', kind: 'agent', targetRef: 'a', ptySessionId: null });
    const { app } = await harness({ store, root });
    try {
      // A transcript holds the operator's own keystrokes; another operator gets NOT FOUND, not 403.
      expect((await app.inject({
        method: 'GET', url: `/api/pty/session-runs/${mine.sessionRunRef}`, headers: auth('operator-2'),
      })).statusCode).toBe(404);
      expect((await app.inject({
        method: 'GET', url: '/api/pty/session-runs/srun-00000000-0000-0000-0000-000000000000', headers: auth(),
      })).statusCode).toBe(404);
      expect((await app.inject({
        method: 'GET', url: '/api/pty/session-runs/..%2F..%2Fetc%2Fpasswd', headers: auth(),
      })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/pty/session-runs/:ref/archive — the copied governed shape', () => {
  async function endedRun(store: SessionRunStore): Promise<string> {
    const record = await store.create({ owner: 'operator-1', kind: 'agent', targetRef: 'a', ptySessionId: null });
    await store.end('operator-1', record.sessionRunRef);
    return record.sessionRunRef;
  }

  it('writes the T3 audit row BEFORE the mutation, carrying the operator reason', async () => {
    const root = stateRoot();
    const store = createSessionRunStore(root);
    const ref = await endedRun(store);
    const { app, audit } = await harness({ store, root });
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/pty/session-runs/${ref}/archive`,
        headers: auth(),
        payload: { idempotencyKey: 'key-1', reason: 'finished reading it' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, replayed: false });
      expect(res.json().sessionRun).toMatchObject({ outcome: 'archived' });
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        action: 'pty-session-run-archive-authorize',
        owner: 'operator-1',
        target: ref,
        riskTier: 'T3',
        result: 'authorized:key-1',
      });
      expect(audit.rows[0]?.detail).toMatchObject({ reason: 'finished reading it', outcome: 'ended' });
    } finally {
      await app.close();
    }
  });

  it('REFUSES the dismissal when the audit row cannot be written, and does not mutate', async () => {
    const root = stateRoot();
    const store = createSessionRunStore(root);
    const ref = await endedRun(store);
    const { app } = await harness({
      store,
      root,
      appendAudit: () => { throw new Error('ops checkout unavailable'); },
    });
    try {
      const res = await app.inject({
        method: 'POST', url: `/api/pty/session-runs/${ref}/archive`, headers: auth(),
        payload: { idempotencyKey: 'key-1' },
      });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'session-run-archive-audit-required' });
      expect(store.get('operator-1', ref)).toMatchObject({ outcome: 'ended' });
    } finally {
      await app.close();
    }
  });

  it('refuses a LIVE session run — it must be killed through the close path first', async () => {
    const root = stateRoot();
    const store = createSessionRunStore(root);
    const { app, audit } = await harness({ store, root });
    // Spawned after boot, so it is genuinely live rather than a leftover the sweep would have corrected.
    const record = await store.create({ owner: 'operator-1', kind: 'agent', targetRef: 'a', ptySessionId: 'pty-1' });
    try {
      const res = await app.inject({
        method: 'POST', url: `/api/pty/session-runs/${record.sessionRunRef}/archive`, headers: auth(),
        payload: { idempotencyKey: 'key-1' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'session-run-live' });
      // Refused before anything was authorized: a refusal is not a decision to audit.
      expect(audit.rows).toHaveLength(0);
      expect(store.get('operator-1', record.sessionRunRef)).toMatchObject({ outcome: 'live' });
    } finally {
      await app.close();
    }
  });

  it('replays an identical key without re-auditing, and 409s a key reused for another record', async () => {
    const root = stateRoot();
    const store = createSessionRunStore(root);
    const first = await endedRun(store);
    const second = await endedRun(store);
    const { app, audit } = await harness({ store, root });
    try {
      const body = { idempotencyKey: 'key-1', reason: 'cleanup' };
      expect((await app.inject({ method: 'POST', url: `/api/pty/session-runs/${first}/archive`, headers: auth(), payload: body })).statusCode).toBe(200);
      const replay = await app.inject({ method: 'POST', url: `/api/pty/session-runs/${first}/archive`, headers: auth(), payload: body });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ ok: true, replayed: true });
      // A replay is not a second decision, so it writes no second audit row.
      expect(audit.rows).toHaveLength(1);

      const conflict = await app.inject({ method: 'POST', url: `/api/pty/session-runs/${second}/archive`, headers: auth(), payload: body });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toMatchObject({ error: 'idempotency-conflict' });
      expect(store.get('operator-1', second)).toMatchObject({ outcome: 'ended' });
    } finally {
      await app.close();
    }
  });

  it('requires a bearer, an idempotency key, and a textual reason', async () => {
    const root = stateRoot();
    const store = createSessionRunStore(root);
    const ref = await endedRun(store);
    const { app } = await harness({ store, root });
    try {
      expect((await app.inject({
        method: 'POST', url: `/api/pty/session-runs/${ref}/archive`, payload: { idempotencyKey: 'k' },
      })).statusCode).toBe(401);
      expect((await app.inject({
        method: 'POST', url: `/api/pty/session-runs/${ref}/archive`, headers: auth(), payload: {},
      })).statusCode).toBe(400);
      expect((await app.inject({
        method: 'POST', url: `/api/pty/session-runs/${ref}/archive`, headers: auth(),
        payload: { idempotencyKey: 'k', reason: 42 },
      })).statusCode).toBe(400);
      // A foreign record is not found, so it can never be dismissed by someone else.
      expect((await app.inject({
        method: 'POST', url: `/api/pty/session-runs/${ref}/archive`, headers: auth('operator-2'),
        payload: { idempotencyKey: 'k' },
      })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
