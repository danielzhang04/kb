import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Fastify from 'fastify';
import { mintSession } from '../auth/session.ts';
import { registerFigmentStudioGenPlan, type RunStudioGenPlan, type StudioGenPlanOptions } from './studioGenPlan.ts';

import { StudioPlanProcessError } from './studioPlanProcess.ts';

const temporary: string[] = [];
afterEach(async () => { while (temporary.length) await rm(temporary.pop()!, { recursive: true, force: true }); });
const sessionConfig = { secret: Buffer.from('figment-studio-gen-plan-test-secret'), ttlMs: 60_000 };
const key = 'A'.repeat(32);
const PLAN = { schema: 'figment/train-plan@1', creator: 'creator-001', stages: { gen: { runs: [{ ceiling_usd: '2.50', sha256: 'a'.repeat(64), argv: ['not-returned'] }] } } };

async function fixture(run?: RunStudioGenPlan, extra: Partial<StudioGenPlanOptions> = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'figment-studio-plan-')); temporary.push(repo);
  const script = join(repo, 'orgs', 'figment', 'pipeline', 'figment_train.py'); await mkdir(join(script, '..'), { recursive: true }); await writeFile(script, '# fixture', 'utf8');
  const ledger = join(repo, 'ledgers', 'cost'); await mkdir(ledger, { recursive: true });
  const runner = vi.fn(run ?? (async (_command, args) => { const out = args[args.indexOf('--out') + 1]; await writeFile(join(out, 'plan.json'), JSON.stringify(PLAN), 'utf8'); })) as RunStudioGenPlan;
  const audit = vi.fn(async (_subject: string, _id: string, _sha: string) => {}); const app = Fastify({ logger: false }); registerFigmentStudioGenPlan(app, { repoRoot: repo, ledgerDir: ledger, sessionConfig, runStudioGenPlan: runner, auditPrepared: audit, platform: 'win32', ...extra }); await app.ready();
  return { app, repo, ledger, runner, audit };
}
function headers(intent = key, subject = 'operator'): Record<string, string> { return { authorization: `Bearer ${mintSession(subject, sessionConfig).token}`, 'idempotency-key': intent }; }
function read(subject = 'operator'): Record<string, string> { return { authorization: `Bearer ${mintSession(subject, sessionConfig).token}` }; }
const GET = '/api/figment/studio/gen-plans';
const POST = '/api/figment/studio/gen-plan';
function scopeOf(repo: string, subject = 'operator'): string { return createHash('sha256').update(JSON.stringify(['figment-studio-request-scope@1', resolve(repo), subject])).digest('hex'); }
function expectPrivateFree(body: string, repo: string): void {
  for (const forbidden of [repo, repo.replaceAll('\\', '\\\\'), 'published.json', 'intent_sha256', 'created_utc', 'operator', 'argv']) expect(body).not.toContain(forbidden);
}

describe('Studio generation-plan preparation', () => {
  it('runs only the fixed planner into a stable published directory and returns no private fields', async () => {
    const { app, repo, ledger, runner, audit } = await fixture(); const response = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ schema: 'figment/studio-gen-plan@1', status: 'prepared', creator: 'creator-001', stage: 'gen', runCount: 1, declaredCeilingUsd: 2.5 }); expect(response.body).not.toMatch(/argv|checkpoint|prompt|path/i);
    const [, args, options] = (runner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[], { cwd: string; timeout: number; maxBuffer: number; windowsHide: boolean }];
    expect(args).toEqual(['-3', join(repo, 'orgs', 'figment', 'pipeline', 'figment_train.py'), 'plan', '--creator', 'creator-001', '--stage', 'gen', '--out', args[8], '--ledger-dir', ledger]); expect(args).not.toContain('--skip-pin-verify'); expect(options).toEqual({ cwd: repo, timeout: 30_000, maxBuffer: 16 * 1024, windowsHide: true }); expect(await readdir(args[8])).toContain('published.json'); expect(audit).toHaveBeenCalledTimes(1); await app.close();
  });

  it('requires an empty body and a bounded idempotency key before spawning', async () => {
    const { app, runner } = await fixture(); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers(), payload: {} })).statusCode).toBe(400); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers('short') })).statusCode).toBe(400); expect(runner).not.toHaveBeenCalled(); await app.close();
  });

  it('replays a matching marker without a second child and blocks one active preparation', async () => {
    let release: (() => void) | undefined; const waiting = new Promise<void>((resolve) => { release = resolve; });
    let entered: (() => void) | undefined; const runnerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const { app, runner, audit } = await fixture(async (_command, args) => { entered?.(); await waiting; await writeFile(join(args[args.indexOf('--out') + 1], 'plan.json'), JSON.stringify(PLAN), 'utf8'); });
    const first = app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() }); await runnerEntered; expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers('B'.repeat(32)) })).statusCode).toBe(429); release?.(); const prepared = await first; expect(prepared.statusCode).toBe(200);
    const replay = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() }); expect(replay.statusCode).toBe(200); expect(replay.json().id).toBe(prepared.json().id); expect(runner).toHaveBeenCalledTimes(1);
    // Replay re-audits the same stable id (at-least-once).
    expect(audit).toHaveBeenCalledTimes(2); expect(audit.mock.calls[1]).toEqual(audit.mock.calls[0]); await app.close();
  });

  it('refuses a replay marker whose opaque id does not bind its allocated directory', async () => {
    const { app, repo, runner } = await fixture(); const first = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() }); const { id } = first.json() as { id: string }; const root = join(repo, '_private', 'figment-studio', 'gen-plans'); const marker = join(root, id, 'published.json'); const plan = JSON.stringify(PLAN); await writeFile(marker, JSON.stringify({ schema: 'figment/studio-gen-plan-marker@1', id: '00000000-0000-4000-8000-000000000000', plan_sha256: createHash('sha256').update(plan).digest('hex'), intent_sha256: createHash('sha256').update(JSON.stringify(['operator', key])).digest('hex'), created_utc: '2026-09-10T00:00:00.000Z' }), 'utf8'); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(503); expect(runner).toHaveBeenCalledTimes(1); await app.close();
  });

  it('does not reuse a key when its published plan bytes are stale, and reserves two published plans', async () => {
    const { app, repo, runner } = await fixture(); const first = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() }); const { id } = first.json() as { id: string }; const plan = join(repo, '_private', 'figment-studio', 'gen-plans', id, 'plan.json'); await writeFile(plan, JSON.stringify({ ...PLAN, generated_utc: 'changed' }), 'utf8'); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(409); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers('B'.repeat(32)) })).statusCode).toBe(200); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers('C'.repeat(32)) })).json()).toEqual({ error: 'preparation-unavailable' }); expect(runner).toHaveBeenCalledTimes(2); await app.close();
  });

  it('refuses unsafe existing allocation entries before the planner starts', async () => {
    const { app, repo, runner } = await fixture(); await mkdir(join(repo, '_private', 'figment-studio', 'gen-plans', 'not-an-opaque-id'), { recursive: true }); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).json()).toEqual({ error: 'preparation-unavailable' }); expect(runner).not.toHaveBeenCalled(); await app.close();
  });

  it('fails closed and removes only its current unmarked directory on child failure', async () => {
    const { app, repo } = await fixture(async (_command, args) => { await writeFile(join(args[args.indexOf('--out') + 1], 'partial'), 'x'); throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).json()).toEqual({ error: 'preparation-unavailable' }); const root = join(repo, '_private', 'figment-studio', 'gen-plans'); expect(await readdir(root)).toEqual([]); await app.close();
  });
});


describe('Studio preparation repair boundaries', () => {
  it.each([2.5, null, 'NaN', 'Infinity', '-1', '1e1', '50.01', '1.234', ' 4.01'])('refuses malformed or excessive producer ceiling %j', async (value) => {
    const { app, repo } = await fixture(async (_command, args) => {
      const plan = structuredClone(PLAN) as { stages: { gen: { runs: Array<{ ceiling_usd: unknown }> } } };
      plan.stages.gen.runs[0].ceiling_usd = value;
      await writeFile(join(args[args.indexOf('--out') + 1], 'plan.json'), JSON.stringify(plan));
    });
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(503);
    expect(await readdir(join(repo, '_private', 'figment-studio', 'gen-plans'))).toEqual([]);
    await app.close();
  });

  it('retains partial publication on failure and refuses a later request', async () => {
    let markerPath = '';
    const { app, runner } = await fixture(undefined, { publishMarker: async (path) => {
      markerPath = path;
      await writeFile(path, '{', { flag: 'wx' });
      throw new Error('injected sync failure');
    } });
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(503);
    expect(await readFile(markerPath, 'utf8')).toBe('{');
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers('B'.repeat(32)) })).statusCode).toBe(503);
    expect(runner).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('retains a published plan on audit failure and succeeds on replay only once audit succeeds', async () => {
    let failures = 2;
    const audit = vi.fn(async (_subject: string, _id: string, _sha: string) => { if (failures-- > 0) throw new Error('injected audit failure'); });
    const { app, repo, runner } = await fixture(undefined, { auditPrepared: audit });
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).json()).toEqual({ error: 'preparation-unavailable' });
    const replay = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() });
    expect(replay.statusCode).toBe(200);
    expect(await readFile(join(repo, '_private', 'figment-studio', 'gen-plans', replay.json().id, 'published.json'), 'utf8')).toContain('figment/studio-gen-plan-marker@1');
    expect(runner).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(3);
    expect(new Set(audit.mock.calls.map(([subject, id, sha]) => `${subject}|${id}|${sha}`))).toEqual(new Set([`operator|${replay.json().id}|${replay.json().planSha256}`]));
    await app.close();
  });

  it('binds the idempotency key to the verified session subject', async () => {
    const { app, runner, audit } = await fixture();
    const first = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers(key, 'operator') });
    const other = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers(key, 'second-operator') });
    expect(first.statusCode).toBe(200);
    expect(other.statusCode).toBe(200);
    expect(other.json().id).not.toBe(first.json().id);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(audit.mock.calls.map(([subject]) => subject)).toEqual(['operator', 'second-operator']);
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers(key, 'second-operator') })).json().id).toBe(other.json().id);
    expect(runner).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('keeps an uncertain allocation blocking new dispatch after the route is registered again', async () => {
    let allocated = '';
    const { app, repo, ledger, runner } = await fixture(async (_command, args) => {
      allocated = args[args.indexOf('--out') + 1];
      await writeFile(join(allocated, 'incomplete'), 'owned partial output');
      throw new StudioPlanProcessError('timeout', true);
    });
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(503);
    await app.close();
    // Simulated dashboard restart: a fresh instance with no in-memory flag.
    const restartedRunner = vi.fn(async () => {}) as unknown as RunStudioGenPlan;
    const restarted = Fastify({ logger: false });
    registerFigmentStudioGenPlan(restarted, { repoRoot: repo, ledgerDir: ledger, sessionConfig, runStudioGenPlan: restartedRunner, auditPrepared: async () => {}, platform: 'win32' });
    await restarted.ready();
    expect((await restarted.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers('B'.repeat(32)) })).json()).toEqual({ error: 'preparation-unavailable' });
    expect(restartedRunner).not.toHaveBeenCalled();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(await readFile(join(allocated, 'incomplete'), 'utf8')).toBe('owned partial output');
    await restarted.close();
  });

  it('retains uncertain process output and refuses every later preparation on this handler', async () => {
    let allocated = '';
    const { app, runner } = await fixture(async (_command, args) => {
      allocated = args[args.indexOf('--out') + 1];
      await writeFile(join(allocated, 'incomplete'), 'owned partial output');
      throw new StudioPlanProcessError('timeout', true);
    });
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(503);
    expect(await readFile(join(allocated, 'incomplete'), 'utf8')).toBe('owned partial output');
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers('B'.repeat(32)) })).statusCode).toBe(503);
    expect(runner).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('refuses a linked allocation before invoking the planner', async () => {
    const { app, repo, runner } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'figment-studio-outside-')); temporary.push(outside);
    const root = join(repo, '_private', 'figment-studio', 'gen-plans');
    await mkdir(root, { recursive: true });
    await symlink(outside, join(root, '00000000-0000-4000-8000-000000000000'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(outside, 'sentinel'), 'unchanged');
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(503);
    expect(runner).not.toHaveBeenCalled();
    expect(await readFile(join(outside, 'sentinel'), 'utf8')).toBe('unchanged');
    await app.close();
  });

  it('checks the full inventory before returning an otherwise valid replay', async () => {
    const { app, repo, runner } = await fixture();
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(200);
    await mkdir(join(repo, '_private', 'figment-studio', 'gen-plans', 'zz-invalid'));
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(503);
    expect(runner).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('refuses an excessive allocation byte count using a truncated fixture file', async () => {
    const { app, repo } = await fixture(async (_command, args) => {
      const out = args[args.indexOf('--out') + 1];
      await writeFile(join(out, 'plan.json'), JSON.stringify(PLAN));
      const file = await open(join(out, 'oversized'), 'wx');
      try { await file.truncate(257 * 1024 * 1024); } finally { await file.close(); }
    });
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(503);
    expect(await readdir(join(repo, '_private', 'figment-studio', 'gen-plans'))).toEqual([]);
    await app.close();
  });

  it('refuses a mismatched or malformed intent scope before replay or allocation', async () => {
    const { app, repo, runner } = await fixture();
    for (const scope of ['0'.repeat(64), 'not-a-scope']) {
      const response = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: { ...headers(), 'x-figment-intent-scope': scope } });
      expect(response.statusCode).toBe(409); expect(response.json()).toEqual({ error: 'intent-scope-conflict' });
    }
    expect(runner).not.toHaveBeenCalled(); expect(existsSync(join(repo, '_private'))).toBe(false);
    const scope = (await app.inject({ method: 'GET', url: '/api/figment/studio/gen-plans', headers: read('other-operator') })).json().requestScope;
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: { ...headers(), 'x-figment-intent-scope': scope } })).statusCode).toBe(409);
    expect(runner).not.toHaveBeenCalled();
    await app.close();
  });

  it('refuses a deep existing tree before the planner and preserves it', async () => {
    const { app, repo, runner } = await fixture();
    const root = join(repo, '_private', 'figment-studio', 'gen-plans', '00000000-0000-4000-8000-000000000000');
    const deep = join(root, ...Array.from({ length: 17 }, () => 'd'));
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, 'sentinel'), 'preserved');
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(503);
    expect(runner).not.toHaveBeenCalled();
    expect(await readFile(join(deep, 'sentinel'), 'utf8')).toBe('preserved');
    await app.close();
  });
});

describe('Studio generation-plan discovery', () => {
  const plansRootOf = (repo: string) => join(repo, '_private', 'figment-studio', 'gen-plans');

  it('reports a safely absent root as available without creating, spawning, or auditing', async () => {
    const { app, repo, runner, audit } = await fixture();
    const response = await app.inject({ method: 'GET', url: GET, headers: read() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schema: 'figment/studio-gen-plans@1', requestScope: scopeOf(repo), plans: [], preparation: 'available' });
    expect(existsSync(join(repo, '_private'))).toBe(false); expect(runner).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled();
    expectPrivateFree(response.body, repo);
    await app.close();
  });

  it('rejects queries and bodies, and requires a session', async () => {
    const { app, repo } = await fixture();
    expect((await app.inject({ method: 'GET', url: `${GET}?all=1`, headers: read() })).json()).toEqual({ error: 'query-not-allowed' });
    // inject() normalizes a trailing bare '?' out of request.raw.url, so this hits the plain GET path (200), not the query guard.
    expect((await app.inject({ method: 'GET', url: `${GET}?`, headers: read() })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: GET, headers: { ...read(), 'content-type': 'application/json' }, payload: '{}' })).json()).toEqual({ error: 'body-not-allowed' });
    expect((await app.inject({ method: 'GET', url: GET })).statusCode).toBe(401);
    expect(existsSync(join(repo, '_private'))).toBe(false);
    await app.close();
  });

  it('lists the exact POST DTO, survives restart, and replays the same intent without a second runner', async () => {
    const { app, repo, ledger, runner } = await fixture();
    const prepared = (await app.inject({ method: 'POST', url: POST, headers: headers() })).json();
    const listed = await app.inject({ method: 'GET', url: GET, headers: read() });
    expect(listed.json()).toEqual({ schema: 'figment/studio-gen-plans@1', requestScope: scopeOf(repo), plans: [prepared], preparation: 'available' });
    expectPrivateFree(listed.body, repo);
    await app.close();
    const restartedRunner = vi.fn(async () => {}) as unknown as RunStudioGenPlan;
    const restarted = Fastify({ logger: false });
    registerFigmentStudioGenPlan(restarted, { repoRoot: repo, ledgerDir: ledger, sessionConfig, runStudioGenPlan: restartedRunner, auditPrepared: async () => {}, platform: 'win32' });
    await restarted.ready();
    const after = (await restarted.inject({ method: 'GET', url: GET, headers: read() })).json();
    expect(after.plans).toEqual([prepared]);
    const replay = await restarted.inject({ method: 'POST', url: POST, headers: { ...headers(), 'x-figment-intent-scope': after.requestScope } });
    expect(replay.json()).toEqual(prepared);
    expect(restartedRunner).not.toHaveBeenCalled(); expect(runner).toHaveBeenCalledTimes(1);
    await restarted.close();
  });

  it('orders by marker timestamp then id and reports at-capacity without allowing a third', async () => {
    const { app, repo, runner } = await fixture();
    const first = (await app.inject({ method: 'POST', url: POST, headers: headers() })).json();
    const second = (await app.inject({ method: 'POST', url: POST, headers: headers('B'.repeat(32)) })).json();
    // Only marker timestamps move; plan bytes stay integrity-bound.
    const markerOf = (id: string) => join(plansRootOf(repo), id, 'published.json');
    for (const [id, stamp] of [[first.id, '2026-09-11T00:00:02.000Z'], [second.id, '2026-09-11T00:00:01.000Z']]) {
      const saved = JSON.parse(await readFile(markerOf(id), 'utf8')); await writeFile(markerOf(id), JSON.stringify({ ...saved, created_utc: stamp }));
    }
    const listed = (await app.inject({ method: 'GET', url: GET, headers: read() })).json();
    expect(listed.preparation).toBe('at-capacity'); expect(listed.plans).toEqual([second, first]);
    expect((await app.inject({ method: 'POST', url: POST, headers: headers('C'.repeat(32)) })).statusCode).toBe(503);
    expect(runner).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it.each([
    ['stale plan bytes', async (root: string, id: string) => writeFile(join(root, id, 'plan.json'), JSON.stringify({ ...PLAN, generated_utc: 'changed' }))],
    ['malformed marker', async (root: string, id: string) => writeFile(join(root, id, 'published.json'), '{')],
    ['foreign entry', async (root: string) => mkdir(join(root, 'not-an-opaque-id'))],
    ['linked entry', async (root: string) => {
      const outside = await mkdtemp(join(tmpdir(), 'figment-studio-outside-')); temporary.push(outside);
      await symlink(outside, join(root, '00000000-0000-4000-8000-000000000000'), process.platform === 'win32' ? 'junction' : 'dir');
    }],
  ])('fails closed on %s with no plans and no disclosure, touching nothing', async (_label, corrupt) => {
    const { app, repo } = await fixture();
    const { id } = (await app.inject({ method: 'POST', url: POST, headers: headers() })).json() as { id: string };
    await corrupt(plansRootOf(repo), id);
    const before = (await readdir(plansRootOf(repo))).sort();
    const response = await app.inject({ method: 'GET', url: GET, headers: read() });
    expect(response.json()).toEqual({ schema: 'figment/studio-gen-plans@1', requestScope: scopeOf(repo), plans: [], preparation: 'unavailable' });
    expectPrivateFree(response.body, repo);
    expect((await readdir(plansRootOf(repo))).sort()).toEqual(before);
    await app.close();
  });

  it('reports an unsafe root or missing planner as unavailable', async () => {
    const { app, repo } = await fixture();
    await rm(join(repo, 'orgs', 'figment', 'pipeline', 'figment_train.py'));
    expect((await app.inject({ method: 'GET', url: GET, headers: read() })).json().preparation).toBe('unavailable');
    await app.close();
  });

  it('reports a retained unmarked allocation as maintenance-required with only verified summaries', async () => {
    const { app, repo } = await fixture();
    const prepared = (await app.inject({ method: 'POST', url: POST, headers: headers() })).json();
    const orphan = join(plansRootOf(repo), '00000000-0000-4000-8000-000000000000');
    await mkdir(orphan); await writeFile(join(orphan, 'partial'), 'kept');
    const response = await app.inject({ method: 'GET', url: GET, headers: read() });
    expect(response.json()).toMatchObject({ plans: [prepared], preparation: 'maintenance-required' });
    expect(await readFile(join(orphan, 'partial'), 'utf8')).toBe('kept');
    await app.close();
  });

  it('reports uncertain termination as maintenance-required without clearing it', async () => {
    const { app, runner } = await fixture(async (_command, args) => {
      await writeFile(join(args[args.indexOf('--out') + 1], 'incomplete'), 'x');
      throw new StudioPlanProcessError('timeout', true);
    });
    await app.inject({ method: 'POST', url: POST, headers: headers() });
    for (let i = 0; i < 2; i += 1) expect((await app.inject({ method: 'GET', url: GET, headers: read() })).json()).toMatchObject({ plans: [], preparation: 'maintenance-required' });
    expect((await app.inject({ method: 'POST', url: POST, headers: headers('B'.repeat(32)) })).statusCode).toBe(503);
    expect(runner).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('reports busy with no plans while a preparation is active', async () => {
    let release: (() => void) | undefined; const waiting = new Promise<void>((resolve) => { release = resolve; });
    let entered: (() => void) | undefined; const runnerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const { app } = await fixture(async (_command, args) => { entered?.(); await waiting; await writeFile(join(args[args.indexOf('--out') + 1], 'plan.json'), JSON.stringify(PLAN)); });
    const pending = app.inject({ method: 'POST', url: POST, headers: headers() }); await runnerEntered;
    expect((await app.inject({ method: 'GET', url: GET, headers: read() })).json()).toMatchObject({ plans: [], preparation: 'busy' });
    release?.(); expect((await pending).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: GET, headers: read() })).json().preparation).toBe('available');
    await app.close();
  });
});
