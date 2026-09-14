/**
 * Governed-surface integration tests for the newly wired Figment gen-source-read route
 * (`registerFigmentGenSourceRead`), exercised ONLY through the real composition root
 * (`makeSurfaceContext` + `registerWriteSurface`) via `app.inject`, exactly as `http/surface.test.ts`
 * exercises every other governed route. No route module is imported or called directly, and no
 * published helper (`studioPublishedPlans.ts`) is mocked — a full synthetic local published-plan
 * filesystem is built instead. Only the bounded process seam (`figmentGenSourceReadRunProcess`) is
 * injected, standing in for the real Python reader; no real Python is invoked or claimed.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { makeSurfaceContext as makeProductionSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import type { SurfaceContext } from '../http/context.ts';
import { mintSession } from '../auth/session.ts';
import { admit } from '../control/admission.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import { GEN_SOURCE_LIMITATIONS } from '../../shared/figmentGenSourceRead.ts';
import type { GenSourceReadConfig } from './genSourceRead.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));
const SECRET = Buffer.from('gen-source-read-governed-test-secret-01234');
const sessionConfig = { secret: SECRET, ttlMs: 60_000 };
const GOOD_ORIGIN = 'http://localhost';
const GOOD_HOST = 'localhost';
const GEN_SOURCE_GET = '/api/figment/studio/gen-source-reads';
const GEN_SOURCE_POST = (id: string) => `/api/figment/studio/gen-plans/${id}/source-check`;
const FIXED_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const okPreamble: PreambleRunner = () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' });
const frozenPreamble: PreambleRunner = () => ({
  exitCode: 1, stdout: 'PREAMBLE FAIL: STOP file present — fleet frozen', stderr: '',
});

function makeSurfaceContext(
  overrides: Parameters<typeof makeProductionSurfaceContext>[0] = {},
  activation: Parameters<typeof makeProductionSurfaceContext>[1] = {},
) {
  return makeProductionSurfaceContext({ controlStore: createInMemoryControlPlaneStore(), ...overrides }, activation);
}

function buildApp(
  overrides: Partial<SurfaceContext> = {},
  activation: Parameters<typeof makeProductionSurfaceContext>[1] = {},
): { app: FastifyInstance; ctx: SurfaceContext } {
  const app = Fastify({ logger: false });
  const ctx = makeSurfaceContext({
    repoRoot: REPO_A,
    sessionConfig,
    allowedOrigins: [GOOD_ORIGIN],
    runPreamble: okPreamble,
    ...overrides,
  }, activation);
  registerWriteSurface(app, ctx);
  return { app, ctx };
}

function token(): string {
  return mintSession('operator', sessionConfig).token;
}

function headers(withToken: boolean): Record<string, string> {
  const h: Record<string, string> = { origin: GOOD_ORIGIN, host: GOOD_HOST };
  if (withToken) h.authorization = `Bearer ${token()}`;
  return h;
}

/** Exactly the formula `registerFigmentGenSourceRead` uses internally for the request-scope header. */
function requestScopeFor(repoRoot: string, subject: string): string {
  return createHash('sha256')
    .update(JSON.stringify(['figment-studio-request-scope@1', resolve(repoRoot), subject]))
    .digest('hex');
}

/** A structurally valid config with no filesystem backing — sufficient for discovery-only GET tests. */
function syntheticValidConfig(): GenSourceReadConfig {
  return {
    pythonExecutable: join(REPO_A, 'python-stub.exe'),
    adapterSha256: 'a'.repeat(64),
    dependencySha256: {
      'observed_reads.py': 'b'.repeat(64),
      'figment_train.py': 'c'.repeat(64),
      'training_config.py': 'd'.repeat(64),
      'persona.py': 'e'.repeat(64),
      'lineage.py': 'f'.repeat(64),
    },
    entries: [{
      id: FIXED_ID, planSha256: '1'.repeat(64),
      sourceRoot: join(REPO_A, 'source-root'), sourcePlanSha256: '2'.repeat(64),
    }],
  };
}

/** A complete synthetic local published-plan filesystem: adapter bytes, allocation marker/plan, and a
 *  source root, all hashed to match the config so the real (unmocked) published-plan reader accepts it. */
function buildGenSourceFixture(): {
  repoRoot: string; id: string; planSha256: string; config: GenSourceReadConfig; stdoutText: string;
} {
  const repoRoot = mkdtempSync(join(tmpdir(), 'kb-gensource-'));
  const id = FIXED_ID;
  const planJson = JSON.stringify({
    schema: 'figment/train-plan@1', creator: 'creator-001',
    stages: { gen: { runs: [{ ceiling_usd: '10.00' }] } },
  });
  const planSha256 = createHash('sha256').update(planJson).digest('hex');
  const sourcePlanSha256 = 'd'.repeat(64);

  const pipelineDir = join(repoRoot, 'orgs', 'figment', 'pipeline');
  mkdirSync(pipelineDir, { recursive: true });
  const adapterBytes = Buffer.from('# synthetic gen_source_read adapter\n', 'utf8');
  writeFileSync(join(pipelineDir, 'gen_source_read.py'), adapterBytes);
  const adapterSha256 = createHash('sha256').update(adapterBytes).digest('hex');

  const allocationDir = join(repoRoot, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', id);
  mkdirSync(allocationDir, { recursive: true });
  writeFileSync(join(allocationDir, 'plan.json'), planJson);
  writeFileSync(join(allocationDir, 'published.json'), JSON.stringify({
    schema: 'figment/studio-gen-plan-marker@1', id, plan_sha256: planSha256,
    intent_sha256: 'c'.repeat(64), created_utc: '2026-09-12T00:00:00.000Z',
  }));

  const sourceRoot = join(repoRoot, 'source-root');
  mkdirSync(sourceRoot, { recursive: true });

  const config: GenSourceReadConfig = {
    pythonExecutable: join(repoRoot, 'python-stub.exe'),
    adapterSha256,
    dependencySha256: {
      'observed_reads.py': '6'.repeat(64), 'figment_train.py': '7'.repeat(64),
      'training_config.py': '8'.repeat(64), 'persona.py': '9'.repeat(64), 'lineage.py': '0'.repeat(64),
    },
    entries: [{ id, planSha256, sourceRoot, sourcePlanSha256 }],
  };

  const stdoutObj = {
    schema: 'figment/gen-source-read@1', result: 'current-source-observed', creator: 'creator-001',
    selected_plan_sha256: planSha256,
    persona_sha256: '1'.repeat(64), approval_sha256: '2'.repeat(64), approval_lineage_sha256: '3'.repeat(64),
    source_plan_sha256: sourcePlanSha256, checkpoint_sha256: '4'.repeat(64),
    gen_manifest_sha256: ['5'.repeat(64)], gen_runs: 1,
    claims: { launch_ready: false, quality_approved: false, atomic_snapshot: false },
  };
  const stdoutText = `${JSON.stringify(stdoutObj)}\n`;

  return { repoRoot, id, planSha256, config, stdoutText };
}

let app: FastifyInstance | undefined;
let testStateRoot: string | undefined;
const tempDirs: string[] = [];
const originalStateRoot = process.env.DASHBOARD_STATE_ROOT;

beforeEach(() => {
  testStateRoot = mkdtempSync(join(tmpdir(), 'kb-gensource-state-'));
  process.env.DASHBOARD_STATE_ROOT = testStateRoot;
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
  if (originalStateRoot === undefined) delete process.env.DASHBOARD_STATE_ROOT;
  else process.env.DASHBOARD_STATE_ROOT = originalStateRoot;
  if (testStateRoot) rmSync(testStateRoot, { recursive: true, force: true });
  testStateRoot = undefined;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('genSourceRead — discovery GET is the ONLY exempt route (config absent)', () => {
  it('serves discovery even through a frozen preamble and a degraded outbox when config is absent', async () => {
    const runner = vi.fn(async () => { throw new Error('runner must never be invoked for discovery'); });
    const degraded = { pending: 100, oldestAgeMs: 1_000, degraded: true, reasons: ['pending-limit'] };
    ({ app } = buildApp({
      runPreamble: frozenPreamble,
      admission: (kind) => admit(kind, degraded),
      figmentGenSourceReadRunProcess: runner as unknown as NonNullable<SurfaceContext['figmentGenSourceReadRunProcess']>,
    }, { env: {} }));

    const res = await app.inject({ method: 'GET', url: GEN_SOURCE_GET, headers: headers(true) });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      schema: 'figment/studio-gen-source-reads@1', configured: false, availability: 'not-configured', entries: [],
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('401s an unauthenticated discovery GET despite the exemption', async () => {
    ({ app } = buildApp({}, { env: {} }));
    const res = await app.inject({ method: 'GET', url: GEN_SOURCE_GET, headers: headers(false) });
    expect(res.statusCode).toBe(401);
  });

  it('exempts the discovery GET by PATH only: a query-augmented GET still bypasses admission/preamble, but the handler itself rejects the query', async () => {
    const baseAdmission: SurfaceContext['admission'] = (kind) => admit(kind, { pending: 0, oldestAgeMs: 0, degraded: false, reasons: [] });
    const admission = vi.fn(baseAdmission);
    const runPreamble = vi.fn(frozenPreamble);
    ({ app } = buildApp({ admission, runPreamble }, { env: {} }));
    const withQuery = await app.inject({ method: 'GET', url: `${GEN_SOURCE_GET}?x=1`, headers: headers(true) });
    expect(withQuery.statusCode).toBe(400);
    expect(withQuery.json()).toEqual({ error: 'query-not-allowed' });
    // The studio preHandler exemption matches on `req.routeOptions.url` (the route PATH pattern) and
    // method only — it never inspects the query string — so admission/preamble are bypassed here too;
    // the 400 comes from the route handler's OWN query check, never from a gate refusal.
    expect(admission).not.toHaveBeenCalled();
    expect(runPreamble).not.toHaveBeenCalled();
  });

  it('does not extend the exemption to HEAD: the route has exposeHeadRoute:false and is unregistered (404)', async () => {
    const baseAdmission: SurfaceContext['admission'] = (kind) => admit(kind, { pending: 0, oldestAgeMs: 0, degraded: false, reasons: [] });
    const admission = vi.fn(baseAdmission);
    const runPreamble = vi.fn(frozenPreamble);
    ({ app } = buildApp({ admission, runPreamble }, { env: {} }));
    const head = await app.inject({ method: 'HEAD', url: GEN_SOURCE_GET, headers: headers(true) });
    expect(head.statusCode).toBe(404);
    expect(admission).not.toHaveBeenCalled();
    expect(runPreamble).not.toHaveBeenCalled();
  });

  it('meters the discovery GET on the independent read-rate budget, never the write budget', async () => {
    const { lockout, rateLimit } = await import('../security/ratelimit.ts');
    const readRateGuard = lockout(rateLimit({ limit: 1, windowMs: 60_000 }), { threshold: 10, lockoutMs: 60_000 });
    const writeRateGuard = lockout(rateLimit({ limit: 1, windowMs: 60_000 }), { threshold: 10, lockoutMs: 60_000 });
    ({ app } = buildApp({ readRateGuard, rateGuard: writeRateGuard }, { env: {} }));
    expect((await app.inject({ method: 'GET', url: GEN_SOURCE_GET, headers: headers(true) })).statusCode).toBe(200);
    // The read budget (limit 1) is now spent; the SEPARATE write budget must remain untouched.
    const secondRead = await app.inject({ method: 'GET', url: GEN_SOURCE_GET, headers: headers(true) });
    expect(secondRead.statusCode).toBe(429);
    const scope = requestScopeFor(REPO_A, 'operator');
    const write = await app.inject({
      method: 'POST', url: GEN_SOURCE_POST(FIXED_ID),
      headers: { ...headers(true), 'x-figment-plan-sha256': 'e'.repeat(64), 'x-figment-request-scope': scope },
    });
    expect(write.statusCode).not.toBe(429);
  });
});

describe('genSourceRead — config resolution: injection vs environment, malformed startup', () => {
  it('honors an explicit null override ahead of a configured environment value', async () => {
    const envConfig = syntheticValidConfig();
    ({ app } = buildApp(
      { figmentGenSourceReadConfig: null },
      { env: { DASHBOARD_FIGMENT_GEN_SOURCE_READS_JSON: JSON.stringify(envConfig) } },
    ));
    const res = await app.inject({ method: 'GET', url: GEN_SOURCE_GET, headers: headers(true) });
    expect(res.json()).toEqual({
      schema: 'figment/studio-gen-source-reads@1', configured: false, availability: 'not-configured', entries: [],
    });
  });

  it('an undefined override falls back to the environment configuration', async () => {
    const envConfig = syntheticValidConfig();
    ({ app } = buildApp(
      {},
      { env: { DASHBOARD_FIGMENT_GEN_SOURCE_READS_JSON: JSON.stringify(envConfig) } },
    ));
    const res = await app.inject({ method: 'GET', url: GEN_SOURCE_GET, headers: headers(true) });
    expect(res.json()).toEqual({
      schema: 'figment/studio-gen-source-reads@1', configured: true, availability: 'available',
      entries: [{ id: envConfig.entries[0]!.id, planSha256: envConfig.entries[0]!.planSha256 }],
    });
  });

  it('fails startup with the fixed error for malformed non-null environment configuration', () => {
    const privateValue = 'PRIVATE_CONFIG_SECRET';
    let message = '';
    try {
      makeSurfaceContext(
        { repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN] },
        { env: { DASHBOARD_FIGMENT_GEN_SOURCE_READS_JSON: JSON.stringify({ pythonExecutable: privateValue }) } },
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('invalid Figment gen-source-read configuration');
    expect(message).not.toContain(privateValue);
  });

  it('fails startup with the same fixed error for a malformed direct injection override', () => {
    let message = '';
    try {
      makeSurfaceContext({
        repoRoot: REPO_A, sessionConfig, allowedOrigins: [GOOD_ORIGIN],
        figmentGenSourceReadConfig: { entries: [] } as unknown as GenSourceReadConfig,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('invalid Figment gen-source-read configuration');
  });
});

describe('genSourceRead — POST source-check: origin, session, write-rate, admission, preamble precede the runner', () => {
  it('refuses at each guard in order, never invoking the runner — proven against a configured fixture that WOULD succeed once every guard clears', async () => {
    const fixture = buildGenSourceFixture();
    tempDirs.push(fixture.repoRoot);
    const url = GEN_SOURCE_POST(fixture.id);
    const runner = vi.fn(async () => ({ stdout: Buffer.from(fixture.stdoutText, 'ascii') }));
    const runnerOverride = runner as unknown as NonNullable<SurfaceContext['figmentGenSourceReadRunProcess']>;
    const scope = requestScopeFor(fixture.repoRoot, 'operator');
    const postHeaders = (withToken: boolean, origin = GOOD_ORIGIN) => ({
      origin, host: GOOD_HOST,
      'x-figment-plan-sha256': fixture.planSha256, 'x-figment-request-scope': scope,
      ...(withToken ? { authorization: `Bearer ${token()}` } : {}),
    });
    const common = {
      repoRoot: fixture.repoRoot,
      figmentGenSourceReadConfig: fixture.config,
      figmentGenSourceReadRunProcess: runnerOverride,
    };

    // 0. Sanity: with every guard clear, this EXACT request succeeds — so every refusal below is a
    //    genuine guard block, never an accidental "feature disabled" confound.
    ({ app } = buildApp(common));
    expect((await app.inject({ method: 'POST', url, headers: postHeaders(true) })).statusCode).toBe(200);
    expect(runner).toHaveBeenCalledOnce();
    await app.close(); app = undefined;
    runner.mockClear();

    // 1. Origin guard, ahead of everything.
    ({ app } = buildApp(common));
    expect((await app.inject({ method: 'POST', url, headers: postHeaders(true, 'https://wrong.example') })).statusCode).toBe(403);
    expect(runner).not.toHaveBeenCalled();
    await app.close(); app = undefined;

    // 2. Session guard, ahead of admission/preamble/route.
    ({ app } = buildApp(common));
    expect((await app.inject({ method: 'POST', url, headers: postHeaders(false) })).statusCode).toBe(401);
    expect(runner).not.toHaveBeenCalled();
    await app.close(); app = undefined;

    // 3. Write-rate guard, keyed ahead of the session check.
    const { lockout, rateLimit } = await import('../security/ratelimit.ts');
    const writeGuard = lockout(rateLimit({ limit: 1, windowMs: 60_000 }), { threshold: 10, lockoutMs: 60_000 });
    ({ app } = buildApp({ ...common, rateGuard: writeGuard }));
    expect((await app.inject({ method: 'POST', url, headers: postHeaders(false) })).statusCode).toBe(401);
    const throttled = await app.inject({ method: 'POST', url, headers: postHeaders(false) });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json()).toMatchObject({ error: 'throttled' });
    expect(runner).not.toHaveBeenCalled();
    await app.close(); app = undefined;

    // 4. New-work admission, ahead of the preamble.
    const degraded = { pending: 100, oldestAgeMs: 1_000, degraded: true, reasons: ['pending-limit'] };
    const admissionPreamble = vi.fn(okPreamble);
    ({ app } = buildApp({
      ...common,
      admission: (kind) => admit(kind, degraded),
      runPreamble: admissionPreamble,
    }));
    const admissionRes = await app.inject({ method: 'POST', url, headers: postHeaders(true) });
    expect(admissionRes.statusCode).toBe(503);
    expect(admissionRes.json()).toEqual({ error: 'outbox-degraded' });
    expect(admissionPreamble).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
    await app.close(); app = undefined;

    // 5. Fleet preamble, ahead of the route handler / runner.
    const frozen = vi.fn(frozenPreamble);
    ({ app } = buildApp({ ...common, runPreamble: frozen }));
    const preambleRes = await app.inject({ method: 'POST', url, headers: postHeaders(true) });
    expect(preambleRes.statusCode).toBe(503);
    expect(preambleRes.json()).toEqual({ error: 'fleet-frozen' });
    expect(frozen).toHaveBeenCalledWith(fixture.repoRoot);
    expect(runner).not.toHaveBeenCalled();
  });
});

describe('genSourceRead — bodyless POST: exact scope + planSha256 headers only', () => {
  it('rejects an unexpected JSON body and an unexpected query string before reaching the runner', async () => {
    const fixture = buildGenSourceFixture();
    tempDirs.push(fixture.repoRoot);
    const runner = vi.fn(async () => { throw new Error('runner must not be invoked for a malformed request'); });
    ({ app } = buildApp({
      repoRoot: fixture.repoRoot,
      figmentGenSourceReadConfig: fixture.config,
      figmentGenSourceReadRunProcess: runner as unknown as NonNullable<SurfaceContext['figmentGenSourceReadRunProcess']>,
    }));
    const scope = requestScopeFor(fixture.repoRoot, 'operator');
    const baseHeaders = {
      origin: GOOD_ORIGIN, host: GOOD_HOST, authorization: `Bearer ${token()}`,
      'x-figment-plan-sha256': fixture.planSha256, 'x-figment-request-scope': scope,
    };

    const withBody = await app.inject({
      method: 'POST', url: GEN_SOURCE_POST(fixture.id),
      headers: { ...baseHeaders, 'content-type': 'application/json' },
      payload: { unexpected: true },
    });
    expect(withBody.statusCode).toBe(400);
    expect(withBody.json()).toEqual({ error: 'malformed' });

    const withQuery = await app.inject({
      method: 'POST', url: `${GEN_SOURCE_POST(fixture.id)}?x=1`, headers: baseHeaders,
    });
    expect(withQuery.statusCode).toBe(400);
    expect(withQuery.json()).toEqual({ error: 'malformed' });

    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects a mismatched request-scope header (identity-mismatch) before the runner', async () => {
    const fixture = buildGenSourceFixture();
    tempDirs.push(fixture.repoRoot);
    const runner = vi.fn(async () => { throw new Error('runner must not be invoked on identity mismatch'); });
    ({ app } = buildApp({
      repoRoot: fixture.repoRoot,
      figmentGenSourceReadConfig: fixture.config,
      figmentGenSourceReadRunProcess: runner as unknown as NonNullable<SurfaceContext['figmentGenSourceReadRunProcess']>,
    }));
    const res = await app.inject({
      method: 'POST', url: GEN_SOURCE_POST(fixture.id),
      headers: {
        origin: GOOD_ORIGIN, host: GOOD_HOST, authorization: `Bearer ${token()}`,
        'x-figment-plan-sha256': fixture.planSha256, 'x-figment-request-scope': 'f'.repeat(64),
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'identity-mismatch' });
    expect(runner).not.toHaveBeenCalled();
  });
});

describe('genSourceRead — full success path through the governed surface', () => {
  it('completes admission -> preamble -> ONE runner call -> published result over a synthetic local repo', async () => {
    const fixture = buildGenSourceFixture();
    tempDirs.push(fixture.repoRoot);
    const events: string[] = [];
    const admission: SurfaceContext['admission'] = (kind) => { events.push(`admission:${kind}`); return { ok: true }; };
    const runPreamble: PreambleRunner = (repoRoot) => { events.push('preamble'); return okPreamble(repoRoot); };
    const runner = vi.fn(async (executable: string, args: readonly string[]) => {
      events.push('runner');
      expect(executable).toBe(fixture.config.pythonExecutable);
      expect(args).toContain('--selected-plan-sha256');
      expect(args).toContain(fixture.planSha256);
      expect(args).toContain('--source-plan-sha256');
      return { stdout: Buffer.from(fixture.stdoutText, 'ascii') };
    });
    ({ app } = buildApp({
      repoRoot: fixture.repoRoot,
      admission,
      runPreamble,
      figmentGenSourceReadConfig: fixture.config,
      figmentGenSourceReadRunProcess: runner as unknown as NonNullable<SurfaceContext['figmentGenSourceReadRunProcess']>,
    }));

    const scope = requestScopeFor(fixture.repoRoot, 'operator');
    const res = await app.inject({
      method: 'POST', url: GEN_SOURCE_POST(fixture.id),
      headers: {
        origin: GOOD_ORIGIN, host: GOOD_HOST, authorization: `Bearer ${token()}`,
        'x-figment-plan-sha256': fixture.planSha256, 'x-figment-request-scope': scope,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      schema: 'figment/studio-gen-source-read@1',
      id: fixture.id,
      planSha256: fixture.planSha256,
      outcome: 'source-checked',
      checkedAtUtc: expect.any(String),
      digests: {
        personaSha256: '1'.repeat(64),
        approvalSha256: '2'.repeat(64),
        approvalLineageSha256: '3'.repeat(64),
        sourcePlanSha256: 'd'.repeat(64),
        checkpointSha256: '4'.repeat(64),
        genManifestSha256: ['5'.repeat(64)],
      },
      claims: { launchReady: false, qualityApproved: false, atomicSnapshot: false },
      limitations: GEN_SOURCE_LIMITATIONS,
    });
    expect(events).toEqual(['admission:new-work', 'preamble', 'runner']);
    expect(runner).toHaveBeenCalledTimes(1);

    // The discovery inventory reflects the entry the whole time (never mutated by a read).
    const discovery = await app.inject({ method: 'GET', url: GEN_SOURCE_GET, headers: headers(true) });
    expect(discovery.json()).toEqual({
      schema: 'figment/studio-gen-source-reads@1', configured: true, availability: 'available',
      entries: [{ id: fixture.id, planSha256: fixture.planSha256 }],
    });
  });

  it('returns 404 unknown for a well-formed id absent from the configured entries', async () => {
    const fixture = buildGenSourceFixture();
    tempDirs.push(fixture.repoRoot);
    const runner = vi.fn(async () => { throw new Error('runner must not run for an unknown id'); });
    ({ app } = buildApp({
      repoRoot: fixture.repoRoot,
      figmentGenSourceReadConfig: fixture.config,
      figmentGenSourceReadRunProcess: runner as unknown as NonNullable<SurfaceContext['figmentGenSourceReadRunProcess']>,
    }));
    const otherId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const scope = requestScopeFor(fixture.repoRoot, 'operator');
    const res = await app.inject({
      method: 'POST', url: GEN_SOURCE_POST(otherId),
      headers: {
        origin: GOOD_ORIGIN, host: GOOD_HOST, authorization: `Bearer ${token()}`,
        'x-figment-plan-sha256': fixture.planSha256, 'x-figment-request-scope': scope,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'unknown' });
    expect(runner).not.toHaveBeenCalled();
  });
});
