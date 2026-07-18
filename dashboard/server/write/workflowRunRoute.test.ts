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

const CONFIG = {
  secret: Buffer.from('workflow-route-test-secret-01234567'),
  ttlMs: 60_000,
};
const ORIGIN = 'http://localhost';

function request(stages: unknown[] = [
  { id: 'research', action: 'research:atlas', target: 'orgs/atlas-prep/raw', workOrder: 'Research.', riskTier: 'T1', owner: 'codex-worker', dependsOn: [] },
  { id: 'draft', action: 'draft:atlas', target: 'orgs/atlas-prep/output', workOrder: 'Draft.', riskTier: 'T2', owner: 'codex-worker', dependsOn: ['research'] },
]) {
  return { name: 'atlas-run', project: 'atlas-prep', workflowDefinitionId: 'atlas-v1', stages };
}

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'workflow-route-'));
  mkdirSync(join(repo, 'governance'), { recursive: true });
  writeFileSync(join(repo, 'governance', 'model-routing.yaml'), [
    'runtimes:',
    '  codex:',
    '    default_worker: codex-worker',
    '    known_models: [gpt-5.3-codex]',
    'role_default:',
    '  runtime: codex',
    '  model: gpt-5.3-codex',
    '',
  ].join('\n'));
  return repo;
}

function headers(authenticated = true): Record<string, string> {
  return {
    origin: ORIGIN,
    host: 'localhost',
    'content-type': 'application/json',
    ...(authenticated ? { authorization: `Bearer ${mintSession('operator', CONFIG).token}` } : {}),
  };
}

describe('POST /api/write/workflow-runs', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('commits every card path and one audit row in the same prepared ops commit', async () => {
    const repoRoot = makeRepo();
    const order: string[] = [];
    const auditRows: AuditRow[] = [];
    const git: GitRunner = (_repo, args) => {
      order.push(`git:${args.join(' ')}`);
      return args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'ops\n' : '';
    };
    const py: PyRunner = (_repo, _code, jsonArg) => {
      order.push('cards.py');
      const payload = JSON.parse(jsonArg) as { runId: string };
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          runId: payload.runId,
          cards: [
            { stageId: 'research', cardId: 'research-card', state: 'inbox', cardPath: 'queue/inbox/research-card.md' },
            { stageId: 'draft', cardId: 'draft-card', state: 'blocked', cardPath: 'queue/inbox/draft-card.md' },
          ],
        }),
        stderr: '',
      };
    };
    app = Fastify({ logger: false });
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot,
      sessionConfig: CONFIG,
      allowedOrigins: [ORIGIN],
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' }),
      runPy: py,
      opsGit: git,
      appendAuditLocal: (_repo, event: AuditEvent) => {
        order.push('audit:local');
        const row = { ts: '2026-07-18T00:00:00.000Z', ...event };
        auditRows.push(row);
        return row;
      },
      triggerRunner: (owner) => ({ status: 'triggered', owner, task: 'test-runner' }),
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/write/workflow-runs',
      headers: headers(),
      payload: request(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      cards: [
        { stageId: 'research', cardId: 'research-card', state: 'inbox' },
        { stageId: 'draft', cardId: 'draft-card', state: 'blocked' },
      ],
    });
    const pull = order.indexOf('git:pull --rebase origin ops');
    const cardWrite = order.indexOf('cards.py');
    const audit = order.indexOf('audit:local');
    const add = order.findIndex((entry) => entry.startsWith('git:add -- '));
    expect(pull).toBeLessThan(cardWrite);
    expect(cardWrite).toBeLessThan(audit);
    expect(audit).toBeLessThan(add);
    expect(order[add]).toBe('git:add -- queue/inbox/research-card.md queue/inbox/draft-card.md ledgers/audit/dashboard-audit.ndjson');
    expect(order.filter((entry) => entry.startsWith('git:commit '))).toHaveLength(1);
    expect(order.filter((entry) => entry === 'git:push origin ops')).toHaveLength(1);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'workflow-run',
      target: 'atlas-run',
      result: expect.stringMatching(/^launched:wf-/),
      detail: { project: 'atlas-prep', stageCount: 2, workflowDefinitionId: 'atlas-v1' },
    });
  });

  it('refuses invalid owner, missing dependency/cycle, and T3 without a card subprocess', async () => {
    const repoRoot = makeRepo();
    const pyCalls: string[] = [];
    app = Fastify({ logger: false });
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot,
      sessionConfig: CONFIG,
      allowedOrigins: [ORIGIN],
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' }),
      runPy: (_repo, _code, arg) => {
        pyCalls.push(arg);
        return { exitCode: 1, stdout: '', stderr: 'must not run' };
      },
      opsGit: () => '',
    }));

    const badRequests = [
      request([{ ...request().stages[0] as object, owner: 'ghost-agent' }]),
      request([{ ...request().stages[0] as object, dependsOn: ['missing'] }]),
      request([
        { ...request().stages[0] as object, dependsOn: ['draft'] },
        { ...request().stages[1] as object, dependsOn: ['research'] },
      ]),
      request([{ ...request().stages[0] as object, riskTier: 'T3' }]),
    ];
    for (const payload of badRequests) {
      const response = await app.inject({ method: 'POST', url: '/api/write/workflow-runs', headers: headers(), payload });
      expect(response.statusCode).toBe(400);
    }
    expect(pyCalls).toHaveLength(0);
  });

  it('on a subprocess failure adds/commits/pushes nothing and emits no audit row', async () => {
    const repoRoot = makeRepo();
    const gitCalls: string[][] = [];
    const auditRows: AuditEvent[] = [];
    app = Fastify({ logger: false });
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot,
      sessionConfig: CONFIG,
      allowedOrigins: [ORIGIN],
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' }),
      runPy: () => ({ exitCode: 1, stdout: '', stderr: 'simulated staged-card failure' }),
      opsGit: (_repo, args) => {
        gitCalls.push(args);
        return args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'ops\n' : '';
      },
      appendAuditLocal: (_repo, event) => {
        auditRows.push(event);
        return { ts: '2026-07-18T00:00:00.000Z', ...event };
      },
    }));

    const response = await app.inject({ method: 'POST', url: '/api/write/workflow-runs', headers: headers(), payload: request() });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'card-op-failed', detail: 'simulated staged-card failure' });
    expect(gitCalls.some((args) => args[0] === 'add' || args[0] === 'commit' || args[0] === 'push')).toBe(false);
    expect(auditRows).toHaveLength(0);
  });

  it('stays behind the existing origin, rate/session, and preamble gates', async () => {
    const repoRoot = makeRepo();
    let pyCalls = 0;
    app = Fastify({ logger: false });
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot,
      sessionConfig: CONFIG,
      allowedOrigins: [ORIGIN],
      runPreamble: () => ({ exitCode: 1, stdout: 'PREAMBLE FAIL: STOP present\n', stderr: '' }),
      runPy: () => {
        pyCalls += 1;
        return { exitCode: 1, stdout: '', stderr: '' };
      },
    }));

    const unauthenticated = await app.inject({
      method: 'POST', url: '/api/write/workflow-runs', headers: headers(false), payload: request(),
    });
    expect(unauthenticated.statusCode).toBe(401);
    const frozen = await app.inject({
      method: 'POST', url: '/api/write/workflow-runs', headers: headers(), payload: request(),
    });
    expect(frozen.statusCode).toBe(503);
    expect(pyCalls).toBe(0);
  });
});
