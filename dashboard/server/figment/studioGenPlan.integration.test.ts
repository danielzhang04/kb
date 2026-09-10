import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { mintSession } from '../auth/session.ts';
import { resolvePython } from '../runtime/python.ts';
import { registerFigmentStudioGenPlan, type RunStudioGenPlan } from './studioGenPlan.ts';

/**
 * Real end-to-end join of the actual planner (`figment_train.py build_plan` /
 * `build_grade` / `apply_rulings`, exercised through
 * `studio_gen_plan_fixture.py`) with the actual HTTP control route
 * (`registerFigmentStudioGenPlan`) and the actual `run_planned_stage`
 * consumer -- entirely provider- and harness-free. The only injected piece is
 * `runStudioGenPlan`, which stands in for `execFile` and forwards the exact
 * argv the route built to the bounded Python fixture; no plan content is
 * fabricated or copied from elsewhere.
 */

const execFileP = promisify(execFile);
const FIXTURE_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'studio_gen_plan_fixture.py');
const python = resolvePython(process.platform);
const REVALIDATE_TIMEOUT_MS = 120_000;

const temporary: string[] = [];
afterEach(async () => { while (temporary.length) await rm(temporary.pop()!, { recursive: true, force: true }); });

const sessionConfig = { secret: Buffer.from('figment-studio-gen-plan-integration-secret'), ttlMs: 60_000 };

function headers(intentKey: string): Record<string, string> {
  return { authorization: `Bearer ${mintSession('operator', sessionConfig).token}`, 'idempotency-key': intentKey };
}

async function repoFixture(): Promise<{ repo: string; ledger: string }> {
  const repo = await mkdtemp(join(tmpdir(), 'figment-studio-plan-integration-'));
  temporary.push(repo);
  // Only an existence placeholder for the route's own file-safety check --
  // never executed: `runner` below forwards to the real pipeline directly.
  const script = join(repo, 'orgs', 'figment', 'pipeline', 'figment_train.py');
  await mkdir(join(script, '..'), { recursive: true });
  await writeFile(script, '# route-existence placeholder, never executed', 'utf8');
  const ledger = join(repo, 'ledgers', 'cost');
  await mkdir(ledger, { recursive: true });
  return { repo, ledger };
}

function buildRunner(capturedArgv: string[][]): RunStudioGenPlan {
  return (async (command, args) => {
    expect(command).toBe(python.command);
    capturedArgv.push([...args]);
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    await execFileP(python.command, [
      ...python.prefixArgs, FIXTURE_SCRIPT, 'plan',
      '--creator', at('--creator'), '--stage', at('--stage'),
      '--out', at('--out'), '--ledger-dir', at('--ledger-dir'),
    ], { timeout: REVALIDATE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  }) as RunStudioGenPlan;
}

async function appFixture(): Promise<{ app: FastifyInstance; repo: string; capturedArgv: string[][] }> {
  const { repo, ledger } = await repoFixture();
  const capturedArgv: string[][] = [];
  const app = Fastify({ logger: false });
  registerFigmentStudioGenPlan(app, {
    repoRoot: repo, ledgerDir: ledger, sessionConfig,
    runStudioGenPlan: buildRunner(capturedArgv), platform: process.platform,
  });
  await app.ready();
  return { app, repo, capturedArgv };
}

describe('Studio generation-plan: real planner + real HTTP control + real consumer', () => {
  it('runs the real fixture planner through the default owned-process executor', async () => {
    const { repo, ledger } = await repoFixture();
    // Build synthetic training/tester authority before the production planner's
    // timeout starts. Real plan preparation consumes already-existing authority.
    const seedOut = join(repo, 'bootstrap', 'seed-plan');
    await execFileP(python.command, [...python.prefixArgs, FIXTURE_SCRIPT, 'plan', '--creator', 'creator-001', '--stage', 'gen', '--out', seedOut, '--ledger-dir', ledger], { timeout: REVALIDATE_TIMEOUT_MS });
    const fixturePersonas = join(repo, 'fixture-source-seed-plan', 'personas');
    // Isolated test entry point: production process containment and fixed argv,
    // with synthetic authority supplied only inside the existing fixture.
    await writeFile(join(repo, 'orgs', 'figment', 'pipeline', 'figment_train.py'),
      `import runpy, sys\nsys.argv[0] = ${JSON.stringify(FIXTURE_SCRIPT)}\nsys.argv.extend(["--fixture-personas", ${JSON.stringify(fixturePersonas)}])\nrunpy.run_path(sys.argv[0], run_name="__main__")\n`, 'utf8');
    const app = Fastify({ logger: false });
    registerFigmentStudioGenPlan(app, { repoRoot: repo, ledgerDir: ledger, sessionConfig, platform: process.platform });
    try {
      const first = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers('D'.repeat(32)) });
      expect(first.statusCode).toBe(200);
      const prepared = first.json();
      const planPath = join(repo, '_private', 'figment-studio', 'gen-plans', prepared.id, 'plan.json');
      const fresh = await execFileP(python.command, [...python.prefixArgs, FIXTURE_SCRIPT, 'revalidate', '--plan', planPath], { timeout: REVALIDATE_TIMEOUT_MS });
      expect(JSON.parse(fresh.stdout.trim()).launched_count).toBe(1);
    } finally { await app.close(); }
  }, REVALIDATE_TIMEOUT_MS);

  it('prepares one real creator-001 gen plan via the exact production argv, replays it on retry, and refuses a stale-authority run before the harness', async () => {
    const { app, repo, capturedArgv } = await appFixture();
    const key = 'A'.repeat(32);

    const first = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers(key) });
    expect(first.statusCode).toBe(200);
    const prepared = first.json();
    expect(prepared).toEqual({
      schema: 'figment/studio-gen-plan@1', id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      status: 'prepared', creator: 'creator-001', stage: 'gen', runCount: 1,
      declaredCeilingUsd: expect.any(Number), planSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(Object.keys(prepared).sort()).toEqual(
      ['creator', 'declaredCeilingUsd', 'id', 'planSha256', 'runCount', 'schema', 'stage', 'status'].sort(),
    );

    // Exact production argv: the fixed `plan` invocation the route builds, with
    // no operator-only flags (e.g. --skip-pin-verify) ever exposed by the route.
    expect(capturedArgv).toHaveLength(1);
    const argv = capturedArgv[0];
    expect(argv.slice(argv.indexOf('plan'))).toEqual([
      'plan', '--creator', 'creator-001', '--stage', 'gen',
      '--out', join(repo, '_private', 'figment-studio', 'gen-plans', prepared.id),
      '--ledger-dir', join(repo, 'ledgers', 'cost'),
    ]);
    expect(argv).not.toContain('--skip-pin-verify');

    const publishedDir = join(repo, '_private', 'figment-studio', 'gen-plans', prepared.id);
    const planPath = join(publishedDir, 'plan.json');
    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    expect(plan.schema).toBe('figment/train-plan@1');
    expect(plan.creator).toBe('creator-001');
    expect(Object.keys(plan.stages)).toEqual(['gen']);
    const genRun = plan.stages.gen.runs[0];
    expect(genRun.ceiling_usd).toEqual(expect.stringMatching(/^\d+(?:\.\d{1,2})?$/));
    expect(Number(genRun.ceiling_usd)).toBeCloseTo(prepared.declaredCeilingUsd, 2);

    // Same idempotency-key replay: the published plan is returned again without
    // running the planner (real or fixture) a second time.
    const replay = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers(key) });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(prepared);
    expect(capturedArgv).toHaveLength(1);

    // The same real consumer must first reach the isolated sentinel harness
    // under fresh authority; a refusal-only fixture could otherwise hide a
    // producer/consumer mismatch unrelated to the later mutation.
    const fresh = await execFileP(python.command, [
      ...python.prefixArgs, FIXTURE_SCRIPT, 'revalidate', '--plan', planPath,
    ], { timeout: REVALIDATE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    expect(JSON.parse(fresh.stdout.trim()).launched_count).toBe(1);

    // Stale-authority negative: mutating the selected checkpoint's approval
    // provenance after the plan was compiled must make the real consumer
    // refuse before it ever reaches the (fake, sentinel-returning) harness.
    const approvalPath = resolve(String(plan.training.chosen_checkpoint_approval));
    await appendFile(approvalPath, ' ');
    const revalidate = await execFileP(python.command, [
      ...python.prefixArgs, FIXTURE_SCRIPT, 'revalidate', '--plan', planPath,
    ], { timeout: REVALIDATE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    const result = JSON.parse(revalidate.stdout.trim());
    expect(result.launched_count).toBe(0);
    expect(result.error).toMatch(/selected checkpoint approval provenance changed/);

    await app.close();
  }, REVALIDATE_TIMEOUT_MS * 3);
});
