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


const unavailableExecution = (plan: { id: string; planSha256: string }) => ({ id: plan.id, planSha256: plan.planSha256, state: { status: 'unavailable', reason: 'evidence-unavailable' } });
const manifestName = 'train/runs/creator-001-gen.yaml';
const outputName = 'train/runs/out/creator-001-gen';
async function recordedFixture() {
  const item = await fixture(async (_command, args) => {
    const out = args[args.indexOf('--out') + 1];
    await mkdir(join(out, 'train/runs'), { recursive: true });
    const manifest = JSON.stringify({ max_minutes: 115, jobs: [{ output_name: 'c001-gen-01', expected_images: 3 }] });
    await writeFile(join(out, manifestName), manifest);
    const run = { manifest: manifestName, out: outputName, sha256: createHash('sha256').update(manifest).digest('hex'), ceiling_usd: '2.50',
      argv: ['python', 'runpod_run.py', 'run', '--manifest', join(out, manifestName), '--out', join(out, outputName), '--max-usd', '2.50', '--max-minutes', '115'] };
    await writeFile(join(out, 'plan.json'), JSON.stringify({ schema: 'figment/train-plan@1', creator: 'creator-001', stages: { gen: { runs: [run] } } }));
  });
  const posted = await item.app.inject({ method: 'POST', url: POST, headers: headers() });
  expect(posted.statusCode).toBe(200);
  const prepared = posted.json() as { id: string; planSha256: string };
  const directory = join(item.repo, 'orgs/figment/_private/figment-studio/gen-plans', prepared.id);
  const expected = { status: 'recorded', planSha256: prepared.planSha256, creator: 'creator-001', stage: 'gen',
    execution: 'no-stage-record', liveness: 'unknown', quality: 'not-assessed', declaredCeilingUsd: 2.5, maxMinutes: 115, receipt: null };
  return { ...item, prepared, directory, expected };
}

describe('Studio generation-plan preparation', () => {
  it('runs only the fixed planner into a stable published directory and returns no private fields', async () => {
    const { app, repo, ledger, runner, audit } = await fixture(); const response = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ schema: 'figment/studio-gen-plan@1', status: 'prepared', creator: 'creator-001', stage: 'gen', runCount: 1, declaredCeilingUsd: 2.5 }); expect(response.body).not.toMatch(/argv|checkpoint|prompt|path/i);
    const [, args, options] = (runner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[], { cwd: string; timeout: number; maxBuffer: number; windowsHide: boolean }];
    expect(args).toEqual(['-3', join(repo, 'orgs', 'figment', 'pipeline', 'figment_train.py'), 'plan', '--creator', 'creator-001', '--stage', 'gen', '--out', args[8], '--ledger-dir', ledger]); expect(args[8]).toBe(join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', response.json().id)); expect(existsSync(join(repo, '_private', 'figment-studio'))).toBe(false); expect(args).not.toContain('--skip-pin-verify'); expect(options).toEqual({ cwd: repo, timeout: 30_000, maxBuffer: 16 * 1024, windowsHide: true }); expect(await readdir(args[8])).toContain('published.json'); expect(audit).toHaveBeenCalledTimes(1); await app.close();
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
    const { app, repo, runner } = await fixture(); const first = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() }); const { id } = first.json() as { id: string }; const root = join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans'); const marker = join(root, id, 'published.json'); const plan = JSON.stringify(PLAN); await writeFile(marker, JSON.stringify({ schema: 'figment/studio-gen-plan-marker@1', id: '00000000-0000-4000-8000-000000000000', plan_sha256: createHash('sha256').update(plan).digest('hex'), intent_sha256: createHash('sha256').update(JSON.stringify(['operator', key])).digest('hex'), created_utc: '2026-09-10T00:00:00.000Z' }), 'utf8'); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(503); expect(runner).toHaveBeenCalledTimes(1); await app.close();
  });

  it('does not reuse a key when its published plan bytes are stale, and reserves two published plans', async () => {
    const { app, repo, runner } = await fixture(); const first = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() }); const { id } = first.json() as { id: string }; const plan = join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', id, 'plan.json'); await writeFile(plan, JSON.stringify({ ...PLAN, generated_utc: 'changed' }), 'utf8'); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).statusCode).toBe(409); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers('B'.repeat(32)) })).statusCode).toBe(200); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers('C'.repeat(32)) })).json()).toEqual({ error: 'preparation-unavailable' }); expect(runner).toHaveBeenCalledTimes(2); await app.close();
  });

  it('refuses unsafe existing allocation entries before the planner starts', async () => {
    const { app, repo, runner } = await fixture(); await mkdir(join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', 'not-an-opaque-id'), { recursive: true }); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).json()).toEqual({ error: 'preparation-unavailable' }); expect(runner).not.toHaveBeenCalled(); await app.close();
  });

  it('fails closed and removes only its current unmarked directory on child failure', async () => {
    const { app, repo } = await fixture(async (_command, args) => { await writeFile(join(args[args.indexOf('--out') + 1], 'partial'), 'x'); throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }); expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers() })).json()).toEqual({ error: 'preparation-unavailable' }); const root = join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans'); expect(await readdir(root)).toEqual([]); await app.close();
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
    expect(await readdir(join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans'))).toEqual([]);
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
    expect(await readFile(join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', replay.json().id, 'published.json'), 'utf8')).toContain('figment/studio-gen-plan-marker@1');
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
    const root = join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans');
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
    await mkdir(join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', 'zz-invalid'));
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
    expect(await readdir(join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans'))).toEqual([]);
    await app.close();
  });

  it('refuses a mismatched or malformed intent scope before replay or allocation', async () => {
    const { app, repo, runner } = await fixture();
    for (const scope of ['0'.repeat(64), 'not-a-scope']) {
      const response = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: { ...headers(), 'x-figment-intent-scope': scope } });
      expect(response.statusCode).toBe(409); expect(response.json()).toEqual({ error: 'intent-scope-conflict' });
    }
    expect(runner).not.toHaveBeenCalled(); expect(existsSync(join(repo, '_private'))).toBe(false); expect(existsSync(join(repo, 'orgs/figment/_private'))).toBe(false);
    const scope = (await app.inject({ method: 'GET', url: '/api/figment/studio/gen-plans', headers: read('other-operator') })).json().requestScope;
    expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: { ...headers(), 'x-figment-intent-scope': scope } })).statusCode).toBe(409);
    expect(runner).not.toHaveBeenCalled();
    await app.close();
  });

  it('refuses a deep existing tree before the planner and preserves it', async () => {
    const { app, repo, runner } = await fixture();
    const root = join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', '00000000-0000-4000-8000-000000000000');
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
  const plansRootOf = (repo: string) => join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans');

  it('reports a safely absent root as available without creating, spawning, or auditing', async () => {
    const { app, repo, runner, audit } = await fixture();
    const response = await app.inject({ method: 'GET', url: GET, headers: read() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(repo), plans: [], executionRecords: [], preparation: 'available' });
    expect(existsSync(join(repo, '_private'))).toBe(false); expect(existsSync(join(repo, 'orgs/figment/_private'))).toBe(false); expect(runner).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled();
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
    expect(existsSync(join(repo, '_private'))).toBe(false); expect(existsSync(join(repo, 'orgs/figment/_private'))).toBe(false);
    await app.close();
  });

  it('lists the exact POST DTO, survives restart, and replays the same intent without a second runner', async () => {
    const { app, repo, ledger, runner } = await fixture();
    const prepared = (await app.inject({ method: 'POST', url: POST, headers: headers() })).json();
    const listed = await app.inject({ method: 'GET', url: GET, headers: read() });
    expect(listed.json()).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(repo), plans: [prepared], executionRecords: [unavailableExecution(prepared)], preparation: 'available' });
    expectPrivateFree(listed.body, repo);
    await app.close();
    const restartedRunner = vi.fn(async () => {}) as unknown as RunStudioGenPlan;
    const restarted = Fastify({ logger: false });
    registerFigmentStudioGenPlan(restarted, { repoRoot: repo, ledgerDir: ledger, sessionConfig, runStudioGenPlan: restartedRunner, auditPrepared: async () => {}, platform: 'win32' });
    await restarted.ready();
    const after = (await restarted.inject({ method: 'GET', url: GET, headers: read() })).json();
    expect(after.plans).toEqual([prepared]);
    expect(after.executionRecords).toEqual([unavailableExecution(prepared)]);
    const replay = await restarted.inject({ method: 'POST', url: POST, headers: { ...headers(), 'x-figment-intent-scope': after.requestScope } });
    expect(replay.json()).toEqual(prepared);
    expect(restartedRunner).not.toHaveBeenCalled(); expect(runner).toHaveBeenCalledTimes(1);
    await restarted.close();
  });

  it('orders by marker timestamp then id and reports at-capacity without allowing a third', async () => {
    let sequence = 0;
    const { app, repo, runner } = await fixture(async (_command, args) => {
      await writeFile(join(args[args.indexOf('--out') + 1], 'plan.json'), JSON.stringify({ ...PLAN, fixtureSequence: ++sequence }));
    });
    const first = (await app.inject({ method: 'POST', url: POST, headers: headers() })).json();
    const second = (await app.inject({ method: 'POST', url: POST, headers: headers('B'.repeat(32)) })).json();
    expect(first.planSha256).not.toBe(second.planSha256);
    // Only marker timestamps move; plan bytes stay integrity-bound.
    const markerOf = (id: string) => join(plansRootOf(repo), id, 'published.json');
    for (const [id, stamp] of [[first.id, '2026-09-11T00:00:02.000Z'], [second.id, '2026-09-11T00:00:01.000Z']]) {
      const saved = JSON.parse(await readFile(markerOf(id), 'utf8')); await writeFile(markerOf(id), JSON.stringify({ ...saved, created_utc: stamp }));
    }
    const listed = (await app.inject({ method: 'GET', url: GET, headers: read() })).json();
    expect(listed.preparation).toBe('at-capacity'); expect(listed.plans).toEqual([second, first]);
    expect(listed.executionRecords).toEqual([unavailableExecution(second), unavailableExecution(first)]);
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
    expect(response.json()).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(repo), plans: [], executionRecords: [], preparation: 'unavailable' });
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
    for (let i = 0; i < 2; i += 1) expect((await app.inject({ method: 'GET', url: GET, headers: read() })).json()).toMatchObject({ plans: [], executionRecords: [], preparation: 'maintenance-required' });
    expect((await app.inject({ method: 'POST', url: POST, headers: headers('B'.repeat(32)) })).statusCode).toBe(503);
    expect(runner).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('reports busy with no plans while a preparation is active', async () => {
    let release: (() => void) | undefined; const waiting = new Promise<void>((resolve) => { release = resolve; });
    let entered: (() => void) | undefined; const runnerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const { app } = await fixture(async (_command, args) => { entered?.(); await waiting; await writeFile(join(args[args.indexOf('--out') + 1], 'plan.json'), JSON.stringify(PLAN)); });
    const pending = app.inject({ method: 'POST', url: POST, headers: headers() }); await runnerEntered;
    expect((await app.inject({ method: 'GET', url: GET, headers: read() })).json()).toMatchObject({ plans: [], executionRecords: [], preparation: 'busy' });
    release?.(); expect((await pending).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: GET, headers: read() })).json().preparation).toBe('available');
    await app.close();
  });
});


describe('Studio generation-plan recorded execution discovery', () => {
  it('projects actual producer-shaped metadata while leaving prepared POST replay unchanged', async () => {
    const item = await recordedFixture();
    try {
      const paths = ['plan.json', 'published.json', manifestName].map((name) => join(item.directory, name));
      const before = await Promise.all(paths.map((path) => readFile(path)));
      const response = await item.app.inject({ method: 'GET', url: GET, headers: read() });
      expect(response.json()).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(item.repo), preparation: 'available',
        plans: [item.prepared], executionRecords: [{ id: item.prepared.id, planSha256: item.prepared.planSha256, state: item.expected }] });
      expectPrivateFree(response.body, item.repo);
      expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(before);
      expect(item.runner).toHaveBeenCalledTimes(1); expect(item.audit).toHaveBeenCalledTimes(1);
      const replay = await item.app.inject({ method: 'POST', url: POST, headers: headers() });
      expect(replay.json()).toEqual(item.prepared); expect(item.runner).toHaveBeenCalledTimes(1);
    } finally { await item.app.close(); }
  });

  it('retains safe summary and status beyond the per-plan byte limit, while POST replay and new dispatch remain refused', async () => {
    const item = await recordedFixture();
    try {
      const metadata = ['plan.json', 'published.json', manifestName].map((name) => join(item.directory, name));
      const before = await Promise.all(metadata.map((path) => readFile(path)));
      await writeFile(join(item.directory, 'stage.json'), JSON.stringify({ schema: 'figment/train-stage@1', creator: 'creator-001',
        plan_sha256: item.prepared.planSha256, status: 'complete', completed_stages: ['gen'],
        runs: { [manifestName]: { status: 'complete', started_utc: '2026-09-12T18:00:00Z' } } }));
      await mkdir(join(item.directory, outputName), { recursive: true });
      await writeFile(join(item.directory, outputName, 'run.json'), JSON.stringify({ schema: 'figment/runpod-run@1', dry_run: false,
        started_utc: '2026-09-12T18:00:00Z', finished_utc: '2026-09-12T18:05:00Z', max_minutes: 115,
        preflight_estimate_usd: 2.5, estimated_actual_usd: 0.1, termination_verified: true, placement_attempts: [{ termination_verified: true }],
        jobs: [{ output_name: 'c001-gen-01', files: [0, 1, 2].map((index) => ({ path: `image-${index}.png`, bytes: 500 })) }], pod_id: 'private-pod' }));
      const expectedExecution = { ...item.expected, execution: 'recorded-completed', liveness: null, receipt: {
        startedUtc: '2026-09-12T18:00:00Z', finishedUtc: '2026-09-12T18:05:00Z', terminationVerified: true,
        outputCount: 3, preflightEstimateUsd: 2.5, estimatedActualUsd: 0.1, failure: null } };
      const large = join(item.directory, 'large-output.dat'); const handle = await open(large, 'wx');
      try { await handle.truncate(256 * 1024 * 1024 + 1); } finally { await handle.close(); }
      const response = await item.app.inject({ method: 'GET', url: GET, headers: read() });
      expect(response.json()).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(item.repo), preparation: 'maintenance-required',
        plans: [item.prepared], executionRecords: [{ id: item.prepared.id, planSha256: item.prepared.planSha256, state: expectedExecution }] });
      for (const intent of [key, 'B'.repeat(32)]) expect((await item.app.inject({ method: 'POST', url: POST, headers: headers(intent) })).statusCode).toBe(503);
      expect(item.runner).toHaveBeenCalledTimes(1); expect(item.audit).toHaveBeenCalledTimes(1); expect(existsSync(large)).toBe(true);
      expect(await Promise.all(metadata.map((path) => readFile(path)))).toEqual(before); expectPrivateFree(response.body, item.repo);
    } finally { await item.app.close(); }
  });

  it('retains safe metadata across an unrelated reparse descendant without allowing preparation or touching the target', async () => {
    const item = await recordedFixture();
    try {
      const outside = await mkdtemp(join(tmpdir(), 'figment-status-foreign-')); temporary.push(outside);
      const sentinel = join(outside, 'private-sentinel'); await writeFile(sentinel, 'untouched');
      await symlink(outside, join(item.directory, 'unrelated-output'), process.platform === 'win32' ? 'junction' : 'dir');
      const response = await item.app.inject({ method: 'GET', url: GET, headers: read() });
      expect(response.json()).toMatchObject({ preparation: 'maintenance-required', plans: [item.prepared],
        executionRecords: [{ id: item.prepared.id, planSha256: item.prepared.planSha256, state: item.expected }] });
      expect((await item.app.inject({ method: 'POST', url: POST, headers: headers() })).statusCode).toBe(503);
      expect(await readFile(sentinel, 'utf8')).toBe('untouched'); expect(item.runner).toHaveBeenCalledTimes(1);
      expectPrivateFree(response.body, item.repo); expect(response.body).not.toContain('private-sentinel');
    } finally { await item.app.close(); }
  });

  it.each(['malformed-stage', 'linked-stage', 'changed-manifest'] as const)('retains the prepared summary when only execution metadata is %s', async (failure) => {
    const item = await recordedFixture();
    try {
      const before = await readFile(join(item.directory, 'published.json'));
      if (failure === 'malformed-stage') await writeFile(join(item.directory, 'stage.json'), '{');
      else if (failure === 'changed-manifest') await writeFile(join(item.directory, manifestName), '{}');
      else {
        const outside = await mkdtemp(join(tmpdir(), 'figment-status-stage-')); temporary.push(outside);
        await symlink(outside, join(item.directory, 'stage.json'), process.platform === 'win32' ? 'junction' : 'dir');
      }
      const response = await item.app.inject({ method: 'GET', url: GET, headers: read() });
      expect(response.json()).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(item.repo),
        preparation: failure === 'linked-stage' ? 'maintenance-required' : 'available', plans: [item.prepared], executionRecords: [unavailableExecution(item.prepared)] });
      expect(await readFile(join(item.directory, 'published.json'))).toEqual(before); expect(item.runner).toHaveBeenCalledTimes(1);
      expectPrivateFree(response.body, item.repo);
    } finally { await item.app.close(); }
  });

  it('refuses a linked plans root before listing metadata or invoking the planner', async () => {
    const item = await fixture();
    try {
      const outside = await mkdtemp(join(tmpdir(), 'figment-status-root-')); temporary.push(outside);
      await writeFile(join(outside, 'sentinel'), 'untouched');
      await mkdir(join(item.repo, 'orgs/figment/_private/figment-studio'), { recursive: true });
      await symlink(outside, join(item.repo, 'orgs/figment/_private/figment-studio/gen-plans'), process.platform === 'win32' ? 'junction' : 'dir');
      const response = await item.app.inject({ method: 'GET', url: GET, headers: read() });
      expect(response.json()).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(item.repo), preparation: 'unavailable', plans: [], executionRecords: [] });
      expect(item.runner).not.toHaveBeenCalled(); expect(item.audit).not.toHaveBeenCalled();
      expect(await readFile(join(outside, 'sentinel'), 'utf8')).toBe('untouched'); expectPrivateFree(response.body, item.repo);
    } finally { await item.app.close(); }
  });

  it.each(['oversized-marker', 'linked-marker', 'oversized-plan', 'third-published-id'] as const)('refuses unsafe inventory metadata %s as a whole', async (failure) => {
    const item = await recordedFixture();
    try {
      const root = join(item.repo, 'orgs/figment/_private/figment-studio/gen-plans');
      if (failure === 'oversized-marker' || failure === 'oversized-plan') {
        const path = join(item.directory, failure === 'oversized-marker' ? 'published.json' : 'plan.json');
        const oversized = (await readFile(path, 'utf8')) + ' '.repeat(256 * 1024 + 1);
        await writeFile(path, oversized);
        if (failure === 'oversized-plan') {
          const markerPath = join(item.directory, 'published.json'), marker = JSON.parse(await readFile(markerPath, 'utf8'));
          await writeFile(markerPath, JSON.stringify({ ...marker, plan_sha256: createHash('sha256').update(oversized).digest('hex') }));
        }
      }
      else if (failure === 'linked-marker') {
        await rm(join(item.directory, 'published.json'));
        const outside = await mkdtemp(join(tmpdir(), 'figment-status-marker-')); temporary.push(outside);
        await symlink(outside, join(item.directory, 'published.json'), process.platform === 'win32' ? 'junction' : 'dir');
      } else {
        const marker = JSON.parse(await readFile(join(item.directory, 'published.json'), 'utf8'));
        for (const id of ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']) {
          await mkdir(join(root, id)); await writeFile(join(root, id, 'published.json'), JSON.stringify({ ...marker, id, intent_sha256: createHash('sha256').update(id).digest('hex') }));
          await writeFile(join(root, id, 'plan.json'), await readFile(join(item.directory, 'plan.json')));
        }
      }
      const before = (await readdir(root)).sort();
      const response = await item.app.inject({ method: 'GET', url: GET, headers: read() });
      expect(response.json()).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(item.repo), preparation: 'unavailable', plans: [], executionRecords: [] });
      expectPrivateFree(response.body, item.repo); expect((await readdir(root)).sort()).toEqual(before); expect(item.runner).toHaveBeenCalledTimes(1);
    } finally { await item.app.close(); }
  });
});


const legacyRootOf = (repo: string) => join(repo, '_private', 'figment-studio', 'gen-plans');
const allocationRootOf = (repo: string) => join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans');
const FIXED_A = '00000000-0000-4000-8000-000000000001';
const FIXED_B = '00000000-0000-4000-8000-000000000002';
async function seedPublished(root: string, id: string, intent: string, stamp = '2026-09-10T00:00:00.000Z') {
  // A retained legacy-format marker/plan fixture, not a relocated live plan or approval.
  const directory = join(root, id); await mkdir(directory, { recursive: true });
  const raw = JSON.stringify({ ...PLAN, fixtureId: id });
  const planSha256 = createHash('sha256').update(raw).digest('hex');
  await writeFile(join(directory, 'plan.json'), raw);
  await writeFile(join(directory, 'published.json'), JSON.stringify({ schema: 'figment/studio-gen-plan-marker@1', id,
    plan_sha256: planSha256, intent_sha256: createHash('sha256').update(JSON.stringify(['operator', intent])).digest('hex'), created_utc: stamp }));
  const prepared = { schema: 'figment/studio-gen-plan@1', id, status: 'prepared', creator: 'creator-001', stage: 'gen', runCount: 1, declaredCeilingUsd: 2.5, planSha256 };
  return { directory, prepared, bytes: await Promise.all(['plan.json', 'published.json'].map((name) => readFile(join(directory, name)))) };
}

describe('Studio two-root allocation and legacy replay', () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])('reads empty roots (legacy=%s, new=%s) without creating either missing root', async (legacy, current) => {
    const item = await fixture();
    try {
      if (legacy) await mkdir(legacyRootOf(item.repo), { recursive: true });
      if (current) await mkdir(allocationRootOf(item.repo), { recursive: true });
      const listed = await item.app.inject({ method: 'GET', url: GET, headers: read() });
      expect(listed.json()).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(item.repo), preparation: 'available', plans: [], executionRecords: [] });
      expect(existsSync(legacyRootOf(item.repo))).toBe(legacy); expect(existsSync(allocationRootOf(item.repo))).toBe(current);
      expect(item.runner).not.toHaveBeenCalled(); expect(item.audit).not.toHaveBeenCalled();
    } finally { await item.app.close(); }
  });

  it('discovers and replays a legacy intent with unchanged scope, original bytes and no new child', async () => {
    const item = await fixture();
    try {
      const old = await seedPublished(legacyRootOf(item.repo), FIXED_A, key);
      const listed = (await item.app.inject({ method: 'GET', url: GET, headers: read() })).json();
      expect(listed).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(item.repo), preparation: 'available', plans: [old.prepared], executionRecords: [unavailableExecution(old.prepared)] });
      expect(existsSync(allocationRootOf(item.repo))).toBe(false);
      const replay = await item.app.inject({ method: 'POST', url: POST, headers: { ...headers(), 'x-figment-intent-scope': listed.requestScope } });
      expect(replay.statusCode).toBe(200); expect(replay.json()).toEqual(old.prepared);
      expect(item.runner).not.toHaveBeenCalled(); expect(item.audit).toHaveBeenCalledTimes(1); expect(item.audit).toHaveBeenCalledWith('operator', FIXED_A, old.prepared.planSha256);
      expect(await Promise.all(['plan.json', 'published.json'].map((name) => readFile(join(old.directory, name))))).toEqual(old.bytes);
      if (existsSync(allocationRootOf(item.repo))) expect(await readdir(allocationRootOf(item.repo))).toEqual([]);
    } finally { await item.app.close(); }
  });

  it.each(['legacy-only', 'mixed'] as const)('keeps a global two-plan limit for %s and permits only original replays', async (placement) => {
    const item = await fixture();
    try {
      const first = await seedPublished(legacyRootOf(item.repo), FIXED_B, key);
      const second = await seedPublished(placement === 'mixed' ? allocationRootOf(item.repo) : legacyRootOf(item.repo), FIXED_A, 'B'.repeat(32));
      const listed = await item.app.inject({ method: 'GET', url: GET, headers: read() });
      expect(listed.json()).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(item.repo), preparation: 'at-capacity',
        plans: [second.prepared, first.prepared], executionRecords: [unavailableExecution(second.prepared), unavailableExecution(first.prepared)] });
      for (const [intent, expected] of [[key, first.prepared], ['B'.repeat(32), second.prepared]] as const) {
        expect((await item.app.inject({ method: 'POST', url: POST, headers: headers(intent) })).json()).toEqual(expected);
      }
      expect((await item.app.inject({ method: 'POST', url: POST, headers: headers('C'.repeat(32)) })).statusCode).toBe(503);
      expect(item.runner).not.toHaveBeenCalled(); expect(item.audit).toHaveBeenCalledTimes(2);
      expectPrivateFree(listed.body, item.repo);
    } finally { await item.app.close(); }
  });

  it('allocates the remaining slot only in the new root and leaves the legacy published bytes intact', async () => {
    const item = await fixture();
    try {
      const old = await seedPublished(legacyRootOf(item.repo), FIXED_A, key);
      const posted = await item.app.inject({ method: 'POST', url: POST, headers: headers('B'.repeat(32)) });
      expect(posted.statusCode).toBe(200);
      expect(await readdir(legacyRootOf(item.repo))).toEqual([FIXED_A]);
      expect(await readdir(allocationRootOf(item.repo))).toEqual([posted.json().id]);
      expect(await Promise.all(['plan.json', 'published.json'].map((name) => readFile(join(old.directory, name))))).toEqual(old.bytes);
      expect(item.runner).toHaveBeenCalledTimes(1);
      expect((await item.app.inject({ method: 'GET', url: GET, headers: read() })).json().preparation).toBe('at-capacity');
    } finally { await item.app.close(); }
  });

  it.each(['uuid', 'intent'] as const)('rejects duplicate %s across roots before replay even when both records parse', async (duplicate) => {
    const item = await fixture();
    try {
      const old = await seedPublished(legacyRootOf(item.repo), FIXED_A, key);
      const newer = await seedPublished(allocationRootOf(item.repo), duplicate === 'uuid' ? FIXED_A : FIXED_B, duplicate === 'intent' ? key : 'B'.repeat(32));
      const listed = await item.app.inject({ method: 'GET', url: GET, headers: read() });
      expect(listed.json()).toEqual({ schema: 'figment/studio-gen-plans@2', requestScope: scopeOf(item.repo), preparation: 'unavailable', plans: [], executionRecords: [] });
      expect((await item.app.inject({ method: 'POST', url: POST, headers: headers() })).statusCode).toBe(503);
      expect(item.runner).not.toHaveBeenCalled(); expect(item.audit).not.toHaveBeenCalled();
      for (const record of [old, newer]) expect(await Promise.all(['plan.json', 'published.json'].map((name) => readFile(join(record.directory, name))))).toEqual(record.bytes);
    } finally { await item.app.close(); }
  });

  it('retains a legacy unmarked allocation and refuses a fresh intent without starting a child', async () => {
    const item = await fixture();
    try {
      const directory = join(legacyRootOf(item.repo), FIXED_A); await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'partial'), 'retained uncertain legacy work');
      expect((await item.app.inject({ method: 'GET', url: GET, headers: read() })).json()).toMatchObject({ preparation: 'maintenance-required', plans: [], executionRecords: [] });
      expect((await item.app.inject({ method: 'POST', url: POST, headers: headers() })).statusCode).toBe(503);
      expect(item.runner).not.toHaveBeenCalled(); expect(item.audit).not.toHaveBeenCalled();
      expect(await readFile(join(directory, 'partial'), 'utf8')).toBe('retained uncertain legacy work');
      if (existsSync(allocationRootOf(item.repo))) expect(await readdir(allocationRootOf(item.repo))).toEqual([]);
    } finally { await item.app.close(); }
  });

  it.each(['legacy', 'new'] as const)('refuses a linked %s root without entering its target', async (where) => {
    const item = await fixture();
    try {
      const outside = await mkdtemp(join(tmpdir(), 'figment-two-root-outside-')); temporary.push(outside);
      await writeFile(join(outside, 'sentinel'), 'unchanged');
      const target = where === 'legacy' ? legacyRootOf(item.repo) : allocationRootOf(item.repo);
      await mkdir(join(target, '..'), { recursive: true });
      await symlink(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
      expect((await item.app.inject({ method: 'GET', url: GET, headers: read() })).json()).toMatchObject({ preparation: 'unavailable', plans: [], executionRecords: [] });
      expect((await item.app.inject({ method: 'POST', url: POST, headers: headers() })).statusCode).toBe(503);
      expect(item.runner).not.toHaveBeenCalled(); expect(await readFile(join(outside, 'sentinel'), 'utf8')).toBe('unchanged');
    } finally { await item.app.close(); }
  });

  it('refuses malformed metadata in legacy inventory before replaying an otherwise valid new plan', async () => {
    const item = await fixture();
    try {
      const newer = await seedPublished(allocationRootOf(item.repo), FIXED_A, key);
      const old = await seedPublished(legacyRootOf(item.repo), FIXED_B, 'B'.repeat(32));
      await writeFile(join(old.directory, 'published.json'), '{');
      expect((await item.app.inject({ method: 'GET', url: GET, headers: read() })).json().preparation).toBe('unavailable');
      expect((await item.app.inject({ method: 'POST', url: POST, headers: headers() })).statusCode).toBe(503);
      expect(item.runner).not.toHaveBeenCalled(); expect(item.audit).not.toHaveBeenCalled();
      expect(await readFile(join(newer.directory, 'published.json'))).toEqual(newer.bytes[1]);
    } finally { await item.app.close(); }
  });

  it('cleans only a failed new allocation and never changes the legacy published plan', async () => {
    const item = await fixture(async (_command, args) => { await writeFile(join(args[args.indexOf('--out') + 1], 'partial'), 'new failed work'); throw new Error('fixture child failure'); });
    try {
      const old = await seedPublished(legacyRootOf(item.repo), FIXED_A, key);
      expect((await item.app.inject({ method: 'POST', url: POST, headers: headers('B'.repeat(32)) })).statusCode).toBe(503);
      expect(await readdir(allocationRootOf(item.repo))).toEqual([]); expect(await readdir(legacyRootOf(item.repo))).toEqual([FIXED_A]);
      expect(await Promise.all(['plan.json', 'published.json'].map((name) => readFile(join(old.directory, name))))).toEqual(old.bytes);
      expect(item.runner).toHaveBeenCalledTimes(1);
    } finally { await item.app.close(); }
  });
});


describe('Studio final publication rechecks both roots', () => {
  it.each(['same-intent', 'full-capacity', 'unmarked'] as const)('refuses a competing legacy %s state appearing while the child prepares', async (conflict) => {
    let entered!: () => void; const started = new Promise<void>((done) => { entered = done; });
    let release!: () => void; const waiting = new Promise<void>((done) => { release = done; });
    const item = await fixture(async (_command, args) => { entered(); await waiting; await writeFile(join(args[args.indexOf('--out') + 1], 'plan.json'), JSON.stringify(PLAN)); });
    const pending = item.app.inject({ method: 'POST', url: POST, headers: headers() });
    try {
      await started;
      if (conflict === 'unmarked') {
        const retained = join(legacyRootOf(item.repo), FIXED_A); await mkdir(retained, { recursive: true }); await writeFile(join(retained, 'partial'), 'competing work');
      } else {
        await seedPublished(legacyRootOf(item.repo), FIXED_A, conflict === 'same-intent' ? key : 'B'.repeat(32));
        if (conflict === 'full-capacity') await seedPublished(legacyRootOf(item.repo), FIXED_B, 'C'.repeat(32));
      }
      const retainedNames = (await readdir(legacyRootOf(item.repo))).sort();
      release(); const response = await pending;
      expect(response.statusCode).toBe(503); expect(response.json()).toEqual({ error: 'preparation-unavailable' });
      expect(await readdir(allocationRootOf(item.repo))).toEqual([]);
      expect((await readdir(legacyRootOf(item.repo))).sort()).toEqual(retainedNames);
      expect(item.runner).toHaveBeenCalledTimes(1); expect(item.audit).not.toHaveBeenCalled();
    } finally { release(); await pending; await item.app.close(); }
  });
});
