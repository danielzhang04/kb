import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerFigmentTesterPreview, type RunTesterPreview } from './planPreview.ts';

const temporary: string[] = [];
afterEach(async () => { while (temporary.length) await rm(temporary.pop()!, { recursive: true, force: true }); });

const PLAN = {
  schema: 'figment/train-plan@1', creator: 'creator-001', stages: { tester: { runs: [{ ceiling_usd: 2.5, sha256: 'a'.repeat(64), argv: ['must-not-return'] }] } },
};

async function fixture(run?: RunTesterPreview) {
  const repo = await mkdtemp(join(tmpdir(), 'figment-preview-')); temporary.push(repo);
  const script = join(repo, 'orgs', 'figment', 'pipeline', 'figment_train.py');
  await mkdir(join(script, '..'), { recursive: true }); await writeFile(script, '# fixed fixture script', 'utf8');
  const runner = vi.fn(run ?? (async (_command, args) => {
    const index = args.indexOf('--out'); const out = args[index + 1];
    await writeFile(join(out, 'plan.json'), JSON.stringify(PLAN), 'utf8');
  })) as RunTesterPreview;
  const app = Fastify({ logger: false }); registerFigmentTesterPreview(app, { repoRoot: repo, runTesterPreview: runner, platform: 'win32' }); await app.ready();
  return { app, repo, runner };
}

describe('Figment offline tester preview', () => {
  it('uses only the fixed local planner invocation, returns a bounded summary, and removes its temp output', async () => {
    const { app, repo, runner } = await fixture();
    const response = await app.inject({ method: 'POST', url: '/api/figment/plan-preview/tester' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schema: 'figment/plan-preview@1', offlinePreview: true, notPromotable: true, creator: 'creator-001', stage: 'tester', runCount: 1, declaredCeilingUsd: 2.5, manifestSha256: 'a'.repeat(64) });
    expect(response.body).not.toContain('argv');
    const [command, args, options] = (runner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[], { cwd: string; timeout: number; maxBuffer: number; windowsHide: boolean }];
    expect(command).toBe('py');
    expect(args.slice(0, 9)).toEqual(['-3', join(repo, 'orgs', 'figment', 'pipeline', 'figment_train.py'), 'plan', '--creator', 'creator-001', '--stage', 'tester', '--out', args[8]]);
    expect(args.slice(9)).toEqual(['--skip-pin-verify']);
    expect(options).toEqual({ cwd: repo, timeout: 10_000, maxBuffer: 16 * 1024, windowsHide: true });
    expect(await readdir(join(repo, '_private', 'figment-plan-preview'))).toEqual([]);
    await app.close();
  });

  it('rejects every request body before starting a planner', async () => {
    const { app, runner } = await fixture();
    const response = await app.inject({ method: 'POST', url: '/api/figment/plan-preview/tester', payload: {} });
    expect(response.statusCode).toBe(400); expect(response.json()).toEqual({ error: 'body-not-allowed' }); expect(runner).not.toHaveBeenCalled();
    await app.close();
  });

  it.each(['timeout', 'output-cap'] as const)('fails closed and cleans output on a %s', async (kind) => {
    const { app, repo } = await fixture(async (_command, args) => {
      const out = args[args.indexOf('--out') + 1]; await writeFile(join(out, 'partial.txt'), 'partial', 'utf8');
      throw Object.assign(new Error(kind), { code: kind === 'timeout' ? 'ETIMEDOUT' : 'ENOBUFS' });
    });
    expect((await app.inject({ method: 'POST', url: '/api/figment/plan-preview/tester' })).statusCode).toBe(503);
    expect(await readdir(join(repo, '_private', 'figment-plan-preview'))).toEqual([]);
    await app.close();
  });

  it('refuses malformed or over-budget summaries without exposing plan fields', async () => {
    const { app } = await fixture(async (_command, args) => {
      const out = args[args.indexOf('--out') + 1];
      await writeFile(join(out, 'plan.json'), JSON.stringify({ ...PLAN, stages: { tester: { runs: [{ ceiling_usd: 51, sha256: 'f'.repeat(64) }] } } }), 'utf8');
    });
    const response = await app.inject({ method: 'POST', url: '/api/figment/plan-preview/tester' });
    expect(response.statusCode).toBe(503); expect(response.body).not.toContain('ceiling_usd');
    await app.close();
  });

  it('refuses a junction ancestor and a symlinked generated plan', async () => {
    const { app, repo, runner } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'figment-preview-outside-')); temporary.push(outside);
    await mkdir(join(repo, '_private'), { recursive: true });
    await symlink(outside, join(repo, '_private', 'figment-plan-preview'), 'junction');
    expect((await app.inject({ method: 'POST', url: '/api/figment/plan-preview/tester' })).statusCode).toBe(503);
    expect(runner).not.toHaveBeenCalled(); await app.close();

    const linked = await fixture(async (_command, args) => {
      const out = args[args.indexOf('--out') + 1]; const outsidePlan = join(out, '..', 'outside-plan.json');
      await writeFile(outsidePlan, JSON.stringify(PLAN), 'utf8'); await symlink(outsidePlan, join(out, 'plan.json'), 'file');
    });
    expect((await linked.app.inject({ method: 'POST', url: '/api/figment/plan-preview/tester' })).statusCode).toBe(503);
    await linked.app.close();
  });

  it('allows one isolated preview at a time', async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const { app } = await fixture(async (_command, args) => {
      await waiting;
      await writeFile(join(args[args.indexOf('--out') + 1], 'plan.json'), JSON.stringify(PLAN), 'utf8');
    });
    const first = app.inject({ method: 'POST', url: '/api/figment/plan-preview/tester' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await app.inject({ method: 'POST', url: '/api/figment/plan-preview/tester' })).statusCode).toBe(429);
    release?.(); expect((await first).statusCode).toBe(200);
    await app.close();
  });

  it('runs the real fixed planner through the default endpoint and cleans its private output', async () => {
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const app = Fastify({ logger: false }); registerFigmentTesterPreview(app, { repoRoot: repo }); await app.ready();
    const response = await app.inject({ method: 'POST', url: '/api/figment/plan-preview/tester' });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ offlinePreview: true, notPromotable: true, creator: 'creator-001', stage: 'tester', runCount: 1 });
    expect(await readdir(join(repo, '_private', 'figment-plan-preview'))).toEqual([]);
    await app.close();
  });
});
