/**
 * #2 Inbox — POST /api/write/card-respond. Validation refusals, each category's cards.py semantics
 * (recording fake PyRunner + GitRunner), the 409 refusals, and the single atomic audit+card ops commit.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { mintSession } from '../auth/session.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import type { GitRunner } from './branch.ts';
import type { PyRunner } from './launch.ts';
import type { RunnerState } from '../runner/trigger.ts';

const CONFIG = {
  secret: Buffer.from('card-respond-test-secret-0123456789'),
  ttlMs: 60_000,
};
const ORIGIN = 'http://localhost';

function headers(authenticated = true): Record<string, string> {
  return {
    origin: ORIGIN,
    host: 'localhost',
    'content-type': 'application/json',
    ...(authenticated ? { authorization: `Bearer ${mintSession('operator', CONFIG).token}` } : {}),
  };
}

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'card-respond-'));
  for (const dir of ['inbox', 'working', 'approvals', 'done']) {
    mkdirSync(join(repo, 'queue', dir), { recursive: true });
  }
  return repo;
}

/** Write a minimal, parseable card into the queue dir its state maps to. */
function writeCard(repo: string, dir: string, id: string, state: string, action: string, owner: string | null = null): void {
  const fm = [
    '---',
    `id: ${id}`,
    'project: kb',
    `action: ${action}`,
    'target: .',
    'risk-tier: T2',
    `owner: ${owner ?? 'null'}`,
    `state: ${state}`,
    '---',
    '',
    '## Work order',
    '',
    'Do the thing.',
    '',
  ].join('\n');
  writeFileSync(join(repo, 'queue', dir, `${id}.md`), fm, 'utf8');
}

interface Harness {
  app: FastifyInstance;
  order: string[];
  pyOps: Array<Record<string, unknown>>;
  auditRows: AuditRow[];
}

function harness(repoRoot: string, runnerState: () => RunnerState | null = () => ({ pid: 42, startTime: 99 }), runnerProcessStartTime: (pid: number) => number | null = () => 99): Harness {
  const order: string[] = [];
  const pyOps: Array<Record<string, unknown>> = [];
  const auditRows: AuditRow[] = [];
  const git: GitRunner = (_repo, args) => {
    order.push(`git:${args.join(' ')}`);
    return args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'ops\n' : '';
  };
  const py: PyRunner = (_repo, _code, jsonArg) => {
    order.push('cards.py');
    const op = JSON.parse(jsonArg) as Record<string, unknown>;
    pyOps.push(op);
    const id = op.cardId as string;
    const transitions = (op.transitions as string[]) ?? [];
    const inboxPath = `queue/inbox/${id}.md`;
    if (transitions.length > 0) {
      const last = transitions[transitions.length - 1];
      if (last === 'done') return { exitCode: 0, stdout: JSON.stringify({ id, state: 'done', paths: [inboxPath, `queue/done/${id}.md`] }), stderr: '' };
      return { exitCode: 0, stdout: JSON.stringify({ id, state: 'inbox', paths: [inboxPath] }), stderr: '' };
    }
    const isResult = op.section === 'Result';
    const dir = isResult ? 'working' : 'inbox';
    const state = isResult ? 'halted' : 'inbox';
    return { exitCode: 0, stdout: JSON.stringify({ id, state, paths: [`queue/${dir}/${id}.md`] }), stderr: '' };
  };
  const app = Fastify({ logger: false });
  registerWriteSurface(app, makeSurfaceContext({
    repoRoot,
    sessionConfig: CONFIG,
    allowedOrigins: [ORIGIN],
    runPy: py,
    opsGit: git,
    now: () => new Date('2026-07-19T12:00:00.000Z'),
    runnerState,
    runnerProcessStartTime,
    appendAuditLocal: (_repo, event: AuditEvent) => {
      order.push('audit:local');
      const row = { ts: '2026-07-19T12:00:00.000Z', ...event };
      auditRows.push(row);
      return row;
    },
  }));
  return { app, order, pyOps, auditRows };
}

describe('POST /api/write/card-respond', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('reply on an input card appends to ## Feedback, transitions nothing, commits card + audit atomically', async () => {
    const repo = makeRepo();
    writeCard(repo, 'inbox', 'input-1', 'inbox', 'needs-input:choose-source');
    const h = harness(repo);
    app = h.app;

    const res = await app.inject({
      method: 'POST', url: '/api/write/card-respond', headers: headers(),
      payload: { cardId: 'input-1', action: 'reply', message: 'Use source A.' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, cardId: 'input-1', state: 'inbox' });
    expect(h.pyOps[0]).toMatchObject({ cardId: 'input-1', section: 'Feedback', transitions: [], claimOwner: null });
    expect(h.pyOps[0].block).toBe('Reply from operator (2026-07-19T12:00:00.000Z):\nUse source A.');
    // ops transaction ordering: pull BEFORE cards.py, audit BEFORE the atomic add, exactly one commit+push.
    const pull = h.order.indexOf('git:pull --rebase origin ops');
    const cardsPy = h.order.indexOf('cards.py');
    const audit = h.order.indexOf('audit:local');
    const add = h.order.findIndex((e) => e.startsWith('git:add -- '));
    expect(pull).toBeLessThan(cardsPy);
    expect(cardsPy).toBeLessThan(audit);
    expect(audit).toBeLessThan(add);
    expect(h.order[add]).toBe('git:add -- queue/inbox/input-1.md ledgers/audit/dashboard-audit.ndjson');
    expect(h.order.filter((e) => e.startsWith('git:commit '))).toHaveLength(1);
    expect(h.order.filter((e) => e === 'git:push origin ops')).toHaveLength(1);
    expect(h.auditRows).toHaveLength(1);
    expect(h.auditRows[0]).toMatchObject({ action: 'card-respond', cardId: 'input-1', riskTier: 'T2', result: 'reply:inbox' });
  });

  it('resolve on a wake-me card records ## Result, claims human-operator, and stages BOTH the moved paths', async () => {
    const repo = makeRepo();
    writeCard(repo, 'inbox', 'wake-1', 'inbox', 'wake-me:runner-failed');
    const h = harness(repo);
    app = h.app;

    const res = await app.inject({
      method: 'POST', url: '/api/write/card-respond', headers: headers(),
      payload: { cardId: 'wake-1', action: 'resolve', message: 'Restarted the runner.' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, cardId: 'wake-1', state: 'done' });
    expect(h.pyOps[0]).toMatchObject({ section: 'Result', transitions: ['working', 'done'], claimOwner: 'human-operator' });
    expect(h.pyOps[0].block).toBe('Resolved by operator (2026-07-19T12:00:00.000Z):\nRestarted the runner.');
    const add = h.order.find((e) => e.startsWith('git:add -- '));
    expect(add).toBe('git:add -- queue/inbox/wake-1.md queue/done/wake-1.md ledgers/audit/dashboard-audit.ndjson');
    expect(h.auditRows[0]).toMatchObject({ result: 'resolve:done' });
  });

  it('resolve on a blocked card appends ## Feedback and releases blocked -> inbox', async () => {
    const repo = makeRepo();
    // blocked cards live in queue/inbox per STATE_DIR.
    writeCard(repo, 'inbox', 'block-1', 'blocked', 'route:unknown');
    const h = harness(repo);
    app = h.app;

    const res = await app.inject({
      method: 'POST', url: '/api/write/card-respond', headers: headers(),
      payload: { cardId: 'block-1', action: 'resolve', message: 'Assigning to codex.' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, cardId: 'block-1', state: 'inbox' });
    expect(h.pyOps[0]).toMatchObject({ section: 'Feedback', transitions: ['inbox'], claimOwner: null });
    expect(h.pyOps[0].block).toMatch(/^Reply from operator \(/);
  });

  it('resolve on a halted card records ## Result with no transition (terminal)', async () => {
    const repo = makeRepo();
    // halted cards live in queue/working per STATE_DIR.
    writeCard(repo, 'working', 'halt-1', 'halted', 'research:atlas', 'codex-worker');
    const h = harness(repo);
    app = h.app;

    const res = await app.inject({
      method: 'POST', url: '/api/write/card-respond', headers: headers(),
      payload: { cardId: 'halt-1', action: 'resolve', message: 'Closed out manually.' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, cardId: 'halt-1', state: 'halted' });
    expect(h.pyOps[0]).toMatchObject({ section: 'Result', transitions: [], claimOwner: null });
  });

  it('refuses illegal (state, verb) combinations with a 409 and no subprocess', async () => {
    const repo = makeRepo();
    writeCard(repo, 'inbox', 'wake-2', 'inbox', 'wake-me:runner-failed');
    writeCard(repo, 'inbox', 'ordinary', 'inbox', 'research:topic', 'codex-worker');
    writeCard(repo, 'working', 'live', 'working', 'build:site', 'codex-worker');
    const h = harness(repo);
    app = h.app;

    // reply is only for input cards — a wake-me card refuses.
    const r1 = await app.inject({ method: 'POST', url: '/api/write/card-respond', headers: headers(), payload: { cardId: 'wake-2', action: 'reply', message: 'x' } });
    // reply on an ordinary inbox card (no input action) refuses.
    const r2 = await app.inject({ method: 'POST', url: '/api/write/card-respond', headers: headers(), payload: { cardId: 'ordinary', action: 'reply', message: 'x' } });
    // resolve on a plain working card is not a projected item — refuses.
    const r3 = await app.inject({ method: 'POST', url: '/api/write/card-respond', headers: headers(), payload: { cardId: 'live', action: 'resolve', message: 'x' } });

    for (const r of [r1, r2, r3]) {
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('card-respond-refused');
    }
    expect(h.pyOps).toHaveLength(0);
    expect(h.order.some((e) => e.startsWith('git:add'))).toBe(false);
    expect(h.auditRows).toHaveLength(0);
  });

  it('rejects a bad card id, bad action, empty/oversized message, and secret-bearing message before any git', async () => {
    const repo = makeRepo();
    writeCard(repo, 'inbox', 'input-9', 'inbox', 'needs-input:x');
    const h = harness(repo);
    app = h.app;

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ cardId: 'bad/id', action: 'reply', message: 'x' }, 'bad-card-id'],
      [{ cardId: 'input-9', action: 'nope', message: 'x' }, 'bad-action'],
      [{ cardId: 'input-9', action: 'reply', message: '   ' }, 'invalid-message'],
      [{ cardId: 'input-9', action: 'reply', message: 'a'.repeat(16_001) }, 'invalid-message'],
      [{ cardId: 'input-9', action: 'reply', message: 'token ghp_abcdefghijklmnopqrstuvwx' }, 'sensitive-content-refused'],
    ];
    for (const [payload, error] of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/write/card-respond', headers: headers(), payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe(error);
    }
    expect(h.pyOps).toHaveLength(0);
    expect(h.order.some((e) => e.startsWith('git:'))).toBe(false);
  });

  it('G3: a successful reply returns a liveness field in the 200 body (owner with no runner -> none)', async () => {
    const repo = makeRepo();
    writeCard(repo, 'inbox', 'input-live', 'inbox', 'needs-input:x'); // owner null -> no registered runner
    const h = harness(repo);
    app = h.app;

    const res = await app.inject({
      method: 'POST', url: '/api/write/card-respond', headers: headers(),
      payload: { cardId: 'input-live', action: 'reply', message: 'Steer note.' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, cardId: 'input-live', state: 'inbox' });
    expect(body.liveness).toEqual({ consumer: 'none', online: false, detail: 'no runner is registered for this card' });
  });

  it('G3: an owner with a matching PID/start-time record comes back online', async () => {
    const repo = makeRepo();
    writeCard(repo, 'inbox', 'input-owned', 'inbox', 'needs-input:x', 'codex-worker');
    const h = harness(repo);
    app = h.app;

    const res = await app.inject({
      method: 'POST', url: '/api/write/card-respond', headers: headers(),
      payload: { cardId: 'input-owned', action: 'reply', message: 'Steer note.' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().liveness).toEqual({ consumer: 'runner-process', online: true, detail: 'runner kb-codex-runner is running (pid 42)' });
  });

  it('G3: a stale runner state still returns 200 (liveness never fails the respond)', async () => {
    const repo = makeRepo();
    writeCard(repo, 'inbox', 'input-fault', 'inbox', 'needs-input:x', 'codex-worker');
    const h = harness(repo, () => ({ pid: 42, startTime: 99 }), () => 100);
    app = h.app;

    const res = await app.inject({
      method: 'POST', url: '/api/write/card-respond', headers: headers(),
      payload: { cardId: 'input-fault', action: 'reply', message: 'Steer note.' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().liveness).toMatchObject({ consumer: 'runner-process', online: false });
  });

  it('404s an unknown card and 401s without a session', async () => {
    const repo = makeRepo();
    writeCard(repo, 'inbox', 'input-3', 'inbox', 'needs-input:x');
    const h = harness(repo);
    app = h.app;

    const missing = await app.inject({ method: 'POST', url: '/api/write/card-respond', headers: headers(), payload: { cardId: 'ghost', action: 'reply', message: 'x' } });
    expect(missing.statusCode).toBe(404);

    const unauth = await app.inject({ method: 'POST', url: '/api/write/card-respond', headers: headers(false), payload: { cardId: 'input-3', action: 'reply', message: 'x' } });
    expect(unauth.statusCode).toBe(401);
    expect(h.pyOps).toHaveLength(0);
  });
});
