import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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

function buildRunner(capturedArgv: string[][], fixturePersonas?: string): RunStudioGenPlan {
  return (async (command, args) => {
    expect(command).toBe(python.command);
    capturedArgv.push([...args]);
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    await execFileP(python.command, [
      ...python.prefixArgs, FIXTURE_SCRIPT, 'plan',
      '--creator', at('--creator'), '--stage', at('--stage'),
      '--out', at('--out'), '--ledger-dir', at('--ledger-dir'),
      ...(fixturePersonas === undefined ? [] : ['--fixture-personas', fixturePersonas]),
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
      const planPath = join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', prepared.id, 'plan.json');
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
      '--out', join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', prepared.id),
      '--ledger-dir', join(repo, 'ledgers', 'cost'),
    ]);
    expect(argv).not.toContain('--skip-pin-verify');

    const publishedDir = join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', prepared.id);
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

    // Discovery returns the same real producer's DTO from its integrity-bound
    // marker; it is inventory, not approval, so the consumer below still decides.
    const listed = await app.inject({ method: 'GET', url: '/api/figment/studio/gen-plans', headers: { authorization: headers(key).authorization } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      schema: 'figment/studio-gen-plans@3', requestScope: expect.stringMatching(/^[a-f0-9]{64}$/),
      plans: [prepared], preparation: 'available',
      assignmentRecords: [{ id: prepared.id, planSha256: prepared.planSha256, state: { status: 'recorded', recordKind: 'planning-snapshot', currentSourceRevalidated: false, slots: [] } }],
      executionRecords: [{ id: prepared.id, planSha256: prepared.planSha256, state: {
        status: 'recorded', planSha256: prepared.planSha256, creator: 'creator-001', stage: 'gen',
        execution: 'no-stage-record', liveness: 'unknown', quality: 'not-assessed',
        declaredCeilingUsd: prepared.declaredCeilingUsd,
        maxMinutes: Number(genRun.argv[genRun.argv.indexOf('--max-minutes') + 1]), receipt: null,
      } }],
    });
    expect(listed.body).not.toContain('plan.json');
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
    // Mutate only a file the fixture wrote inside this test's own repo root.
    const approvalRaw = String(plan.training.chosen_checkpoint_approval);
    expect(isAbsolute(approvalRaw)).toBe(true);
    const approvalPath = resolve(approvalRaw);
    const ownedRoot = await realpath(repo);
    const approvalRelative = relative(ownedRoot, await realpath(approvalPath));
    expect(approvalRelative === '' || approvalRelative === '..' || approvalRelative.startsWith(`..${sep}`) || isAbsolute(approvalRelative)).toBe(false);
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


describe('Studio allocation to real content-assignment authority', () => {
  it('binds the exact new prepared plan through real producers and rejects a separately compiled legacy plan without losing legacy replay', async () => {
    const { repo, ledger } = await repoFixture();
    const figment = join(repo, 'orgs', 'figment');
    const assignmentFixture = resolve(dirname(fileURLToPath(import.meta.url)), 'studio_assignment_fixture.py');
    await execFileP(python.command, [...python.prefixArgs, '-B', assignmentFixture, 'init', '--root', figment],
      { timeout: REVALIDATE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    const capturedArgv: string[][] = [];
    const app = Fastify({ logger: false });
    registerFigmentStudioGenPlan(app, { repoRoot: repo, ledgerDir: ledger, sessionConfig, platform: process.platform,
      runStudioGenPlan: buildRunner(capturedArgv, join(figment, 'personas')) });
    await app.ready();
    try {
      const key = 'P'.repeat(32);
      const posted = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers(key) });
      expect(posted.statusCode).toBe(200);
      const prepared = posted.json();
      const planPath = join(figment, '_private', 'figment-studio', 'gen-plans', prepared.id, 'plan.json');
      const markerPath = join(dirname(planPath), 'published.json');
      const before = await Promise.all([planPath, markerPath].map((path) => readFile(path)));
      expect(createHash('sha256').update(before[0]).digest('hex')).toBe(prepared.planSha256);
      expect(capturedArgv).toHaveLength(1);
      expect(capturedArgv[0].slice(capturedArgv[0].indexOf('plan'))).toEqual([
        'plan', '--creator', 'creator-001', '--stage', 'gen', '--out', dirname(planPath), '--ledger-dir', ledger,
      ]);
      expect(capturedArgv[0]).not.toContain('--fixture-personas');
      expect(capturedArgv[0]).not.toContain('--skip-pin-verify');

      const legacyId = '00000000-0000-4000-8000-000000000001';
      const legacyOut = join(repo, '_private', 'figment-studio', 'gen-plans', legacyId);
      const bound = await execFileP(python.command, [...python.prefixArgs, '-B', assignmentFixture, 'bind',
        '--root', figment, '--plan', planPath, '--legacy-out', legacyOut, '--ledger-dir', ledger],
      { timeout: REVALIDATE_TIMEOUT_MS * 2, maxBuffer: 16 * 1024 * 1024 });
      const result = JSON.parse(bound.stdout.trim());
      expect(result).toMatchObject({ schema: 'figment/studio-assignment-fixture@1', positive_exit: 0, legacy_exit: 2,
        plan_sha256: prepared.planSha256, plan_and_marker_unchanged: true, legacy_plan_unchanged: true, base_unchanged: true });
      expect(result.legacy_error).toMatch(/relative|escapes|traversal/);
      expect(await Promise.all([planPath, markerPath].map((path) => readFile(path)))).toEqual(before);
      const assignment = JSON.parse(await readFile(join(figment, result.assignment), 'utf8'));
      const briefRaw = await readFile(join(figment, result.brief)); const brief = JSON.parse(briefRaw.toString('utf8'));
      const persona = JSON.parse(await readFile(join(figment, 'personas', 'creator-001', 'persona.yaml'), 'utf8'));
      expect(brief.creator.canonical_reference.declared_path).toBe(persona.identity.references[0]);
      expect(assignment).toMatchObject({ schema: 'figment/content-asset-assignment@1', creator: 'creator-001', not_promotable: true,
        brief: { path: result.brief, sha256: createHash('sha256').update(briefRaw).digest('hex') } });
      expect(assignment.assignments).toHaveLength(2);
      for (const [index, row] of assignment.assignments.entries()) {
        const slot = brief.content.required_asset_slots[index];
        expect(row).toMatchObject({ slot_index: slot.index, role: slot.role, taxonomy_type: slot.taxonomy_type, kind: slot.kind,
          asset: { kind: 'approved-gen-still', source_plan: { path: relative(figment, planPath).split(sep).join('/'), sha256: prepared.planSha256 } } });
      }
      expect(new Set(assignment.assignments.map((row: { asset: { image_id: string } }) => row.asset.image_id)).size).toBe(2);
      expect(createHash('sha256').update(await readFile(join(figment, result.base_brief))).digest('hex')).not.toBe(assignment.brief.sha256);

      // Retain the separately built old-layout fixture using the original marker
      // schema and its own produced digest. Nothing is moved from the new allocation.
      const legacyRaw = await readFile(join(legacyOut, 'plan.json'));
      const legacySha = createHash('sha256').update(legacyRaw).digest('hex');
      expect(legacySha).toBe(result.legacy_plan_sha256);
      const legacyKey = 'L'.repeat(32);
      await writeFile(join(legacyOut, 'published.json'), JSON.stringify({ schema: 'figment/studio-gen-plan-marker@1', id: legacyId,
        plan_sha256: legacySha, intent_sha256: createHash('sha256').update(JSON.stringify(['operator', legacyKey])).digest('hex'),
        created_utc: '2026-09-10T00:00:00.000Z' }), { flag: 'wx' });
      const legacyMarker = await readFile(join(legacyOut, 'published.json'));
      const listed = await app.inject({ method: 'GET', url: '/api/figment/studio/gen-plans', headers: headers(key) });
      expect(listed.statusCode).toBe(200);
      expect(Object.keys(listed.json()).sort()).toEqual(['assignmentRecords', 'executionRecords', 'plans', 'preparation', 'requestScope', 'schema']);
      expect(listed.json()).toMatchObject({ schema: 'figment/studio-gen-plans@3', preparation: 'at-capacity',
        plans: [{ id: legacyId, planSha256: legacySha }, prepared], executionRecords: [{ id: legacyId, planSha256: legacySha }, { id: prepared.id, planSha256: prepared.planSha256 }] });
      expect(result.second_positive_exit).toBe(0);
      const joinedSlots = [];
      for (const [briefName, assignmentName] of [[result.brief, result.assignment], [result.second_brief, result.second_assignment]]) {
        const raw = await readFile(join(figment, briefName));
        const exactBrief = JSON.parse(raw.toString('utf8'));
        const exactAssignment = JSON.parse(await readFile(join(figment, assignmentName), 'utf8'));
        const digest = createHash('sha256').update(raw).digest('hex');
        expect(exactAssignment.brief).toEqual({ path: briefName, sha256: digest });
        for (const slot of exactBrief.content.required_asset_slots) joinedSlots.push({ briefId: briefName.split('/')[2], briefSha256: digest, slotIndex: slot.index, role: slot.role, kind: slot.kind, taxonomyType: slot.taxonomy_type });
      }
      const records = listed.json().assignmentRecords;
      expect(records[0]).toEqual({ id: legacyId, planSha256: legacySha, state: { status: 'unavailable', reason: 'outside-content-authority-root' } });
      expect(records[1]).toEqual({ id: prepared.id, planSha256: prepared.planSha256, state: { status: 'recorded', recordKind: 'planning-snapshot', currentSourceRevalidated: false, slots: expect.arrayContaining(joinedSlots) } });
      expect(records[1].state.slots).toHaveLength(4);
      expect(new Set(records[1].state.slots.map((slot: { briefSha256: string }) => slot.briefSha256)).size).toBe(2);
      const { collectContentBriefs } = await import('./contentBriefs.ts');
      const hubBriefs = collectContentBriefs(repo);
      expect(hubBriefs).toMatchObject({ status: 'recorded', items: expect.arrayContaining([expect.objectContaining({ briefId: result.base_brief.split('/')[2], assignment: 'missing' })]) });
      for (const slot of joinedSlots) expect(hubBriefs.items).toEqual(expect.arrayContaining([expect.objectContaining({ briefId: slot.briefId, briefSha256: slot.briefSha256 })]));
      expect(listed.body).not.toMatch(/source_plan|plan\.json|operator-fixture|image_id|approval_lineage|_private/);
      const legacyReplay = await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: { ...headers(legacyKey), 'x-figment-intent-scope': listed.json().requestScope } });
      expect(legacyReplay.statusCode).toBe(200);
      expect(legacyReplay.json()).toEqual(listed.json().plans[0]);
      expect((await app.inject({ method: 'POST', url: '/api/figment/studio/gen-plan', headers: headers(key) })).json()).toEqual(prepared);
      expect(capturedArgv).toHaveLength(1);
      expect(await readFile(join(legacyOut, 'plan.json'))).toEqual(legacyRaw);
      expect(await readFile(join(legacyOut, 'published.json'))).toEqual(legacyMarker);
    } finally { await app.close(); }
  }, REVALIDATE_TIMEOUT_MS * 4);
});
