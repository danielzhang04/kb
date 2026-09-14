// Anchors shared suite so existing server/**/*.test.ts glob discovers it; hosts later route tests too.
import "../../shared/figmentGenSourceRead.test.ts";

import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { mintSession } from '../auth/session.ts';
import {
  decodeGenSourceReadInventory,
  decodeGenSourceReadResult,
  GEN_SOURCE_LIMITATIONS,
} from '../../shared/figmentGenSourceRead.ts';
import {
  parseGenSourceReadConfig,
  parseGenSourceReadConfigJson,
  registerFigmentGenSourceRead,
  type GenSourceReadConfig,
} from './genSourceRead.ts';
import { StudioPlanProcessError, type runStudioPlanProcessCapture } from './studioPlanProcess.ts';

type Runner = typeof runStudioPlanProcessCapture;
const CONFIG_ERROR = 'invalid Figment gen-source-read configuration';
const FIXED_ID = '00000000-0000-4000-8000-000000000001';
const PLAN = { schema: 'figment/train-plan@1', creator: 'creator-001', stages: { gen: { runs: [{ ceiling_usd: '2.50' }] } } };

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

const PLAN_BYTES = JSON.stringify(PLAN);
const KNOWN_PLAN_SHA256 = sha256(PLAN_BYTES);
const KNOWN_SOURCE_PLAN_SHA256 = sha256('fixture-source-plan');

const temps: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  // Close every owned app before removing the temporary roots it holds open,
  // even when an assertion above has already thrown.
  while (apps.length) {
    const app = apps.pop()!;
    await app.close().catch(() => {});
  }
  while (temps.length) await rm(temps.pop()!, { recursive: true, force: true });
});

function scopeFor(repo: string, subject = 'operator'): string {
  return sha256(JSON.stringify(['figment-studio-request-scope@1', resolve(repo), subject]));
}

function dependencyPins() {
  return {
    'observed_reads.py': sha256('observed'), 'figment_train.py': sha256('train'),
    'training_config.py': sha256('training'), 'persona.py': sha256('persona'), 'lineage.py': sha256('lineage'),
  };
}

function goodStdout(entry: { planSha256: string; sourcePlanSha256: string }, overrides: Record<string, unknown> = {}): Buffer {
  const base = {
    schema: 'figment/gen-source-read@1', result: 'current-source-observed', creator: 'creator-001',
    selected_plan_sha256: entry.planSha256,
    persona_sha256: sha256('persona-out'), approval_sha256: sha256('approval-out'),
    approval_lineage_sha256: sha256('lineage-out'), source_plan_sha256: entry.sourcePlanSha256,
    checkpoint_sha256: sha256('checkpoint-out'), gen_manifest_sha256: [sha256('manifest-out')],
    gen_runs: 1, claims: { launch_ready: false, quality_approved: false, atomic_snapshot: false },
    ...overrides,
  };
  return Buffer.from(`${JSON.stringify(base)}\n`, 'ascii');
}

async function makeFixture(options: { run?: Runner; configOverride?: GenSourceReadConfig | null; now?: () => Date } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'figment-gsr-repo-'));
  temps.push(repo);
  const adapterPath = join(repo, 'orgs', 'figment', 'pipeline', 'gen_source_read.py');
  await mkdir(join(adapterPath, '..'), { recursive: true });
  const adapterBytes = '# pinned fixture adapter\n';
  await writeFile(adapterPath, adapterBytes, 'utf8');
  const adapterSha256 = sha256(adapterBytes);

  // The source root must live inside the repo root: safePath() only accepts
  // paths that resolve inside the trusted repo tree.
  const sourceRoot = join(repo, 'source-material');
  await mkdir(sourceRoot, { recursive: true });

  const allocationRoot = join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans');
  const planDir = join(allocationRoot, FIXED_ID);
  await mkdir(planDir, { recursive: true });
  const planSha256 = sha256(PLAN_BYTES);
  await writeFile(join(planDir, 'plan.json'), PLAN_BYTES, 'utf8');
  const marker = {
    schema: 'figment/studio-gen-plan-marker@1', id: FIXED_ID, plan_sha256: planSha256,
    intent_sha256: sha256('fixture-intent'), created_utc: '2026-09-10T00:00:00.000Z',
  };
  await writeFile(join(planDir, 'published.json'), JSON.stringify(marker), 'utf8');

  const sourcePlanSha256 = KNOWN_SOURCE_PLAN_SHA256;
  const config: GenSourceReadConfig = {
    pythonExecutable: resolve(repo, '..', 'gsr-python-fixture.exe'),
    adapterSha256,
    dependencySha256: dependencyPins(),
    entries: [{ id: FIXED_ID, planSha256, sourceRoot, sourcePlanSha256 }],
  };

  const runner = vi.fn(options.run ?? (async () => ({ stdout: goodStdout(config.entries[0]!) }))) as unknown as Runner;
  const sessionConfig = { secret: Buffer.from('figment-gen-source-read-test-secret'), ttlMs: 60_000 };
  const app = Fastify({ logger: false });
  registerFigmentGenSourceRead(app, {
    repoRoot: repo, sessionConfig,
    config: options.configOverride === undefined ? config : options.configOverride,
    runProcess: runner, now: options.now,
  });
  await app.ready();
  apps.push(app);
  return { app, repo, sourceRoot, config, planSha256, sourcePlanSha256, runner, sessionConfig, planDir, adapterPath, adapterBytes };
}

function auth(sessionConfig: { secret: Buffer; ttlMs: number }, subject = 'operator'): Record<string, string> {
  return { authorization: `Bearer ${mintSession(subject, sessionConfig).token}` };
}

function postHeaders(fx: Awaited<ReturnType<typeof makeFixture>>, subject = 'operator'): Record<string, string> {
  return {
    ...auth(fx.sessionConfig, subject),
    'x-figment-plan-sha256': fx.planSha256,
    'x-figment-request-scope': scopeFor(fx.repo, subject),
  };
}

const GET = '/api/figment/studio/gen-source-reads';
const post = (id: string) => `/api/figment/studio/gen-plans/${id}/source-check`;

// ---------------------------------------------------------------------------
// Configuration parsing
// ---------------------------------------------------------------------------

describe('Figment gen-source-read configuration', () => {
  it('disables only on absent input; a present JSON null is a fixed configuration error', () => {
    expect(parseGenSourceReadConfig(undefined)).toBeNull();
    expect(parseGenSourceReadConfig(null)).toBeNull();
    expect(parseGenSourceReadConfigJson(undefined)).toBeNull();
    expect(() => parseGenSourceReadConfigJson('null')).toThrow(CONFIG_ERROR);
  });

  it('accepts one or two well-formed entries and clones them away from caller mutation', () => {
    const entryA = { id: 'a'.repeat(36), planSha256: sha256('pa'), sourceRoot: resolve('src-a'), sourcePlanSha256: sha256('spa') };
    const entryB = { id: 'b'.repeat(36), planSha256: sha256('pb'), sourceRoot: resolve('src-b'), sourcePlanSha256: sha256('spb') };
    const raw: GenSourceReadConfig = { pythonExecutable: resolve('python.exe'), adapterSha256: sha256('adapter'), dependencySha256: dependencyPins(), entries: [entryA, entryB] };
    const parsed = parseGenSourceReadConfig(raw);
    expect(parsed).toEqual(raw);
    expect(parseGenSourceReadConfigJson(JSON.stringify(raw))).toEqual(raw);
    // Capture the original id BEFORE mutating the shared reference; raw.entries[0]
    // and entryA are the same object, so mutating one mutates the other.
    const originalId = entryA.id;
    (raw.entries[0] as { id: string }).id = 'mutated';
    expect(parsed?.entries[0]?.id).toBe(originalId);
  });

  const validEntry = () => ({ id: 'a'.repeat(36), planSha256: sha256('p'), sourceRoot: resolve('src'), sourcePlanSha256: sha256('sp') });
  const validConfig = (): Record<string, unknown> => ({
    pythonExecutable: resolve('python.exe'), adapterSha256: sha256('adapter'), dependencySha256: dependencyPins(), entries: [validEntry()],
  });

  it.each<[string, () => unknown]>([
    ['extra top-level key', () => ({ ...validConfig(), extra: true })],
    ['missing top-level key', () => { const { adapterSha256, ...rest } = validConfig(); return rest; }],
    ['extra entry key', () => ({ ...validConfig(), entries: [{ ...validEntry(), extra: 1 }] })],
    ['missing entry key', () => { const { sourceRoot, ...rest } = validEntry(); return { ...validConfig(), entries: [rest] }; }],
    ['duplicate entry id', () => { const entry = validEntry(); return { ...validConfig(), entries: [entry, { ...entry }] }; }],
    ['uppercase sha256', () => ({ ...validConfig(), adapterSha256: sha256('adapter').toUpperCase() })],
    ['short sha256', () => ({ ...validConfig(), adapterSha256: sha256('adapter').slice(0, 63) })],
    ['relative sourceRoot', () => ({ ...validConfig(), entries: [{ ...validEntry(), sourceRoot: 'relative/src' }] })],
    ['forward-slash windows path', () => ({ ...validConfig(), entries: [{ ...validEntry(), sourceRoot: 'C:/forward/slash' }] })],
    ['trailing backslash', () => ({ ...validConfig(), entries: [{ ...validEntry(), sourceRoot: `${resolve('src')}\\` }] })],
    ['dot-segment', () => {
      // Constructed as a raw string, deliberately NOT passed through join()/resolve()
      // afterward, so the ".." segment is not normalized away before validation.
      const base = resolve('src');
      const raw = `${base}${sep}..${sep}src`;
      return { ...validConfig(), entries: [{ ...validEntry(), sourceRoot: raw }] };
    }],
    ['reserved device stem', () => ({ ...validConfig(), entries: [{ ...validEntry(), sourceRoot: 'C:\\safe\\CON' }] })],
    ['third entry exceeds capacity', () => ({
      ...validConfig(),
      entries: [validEntry(), { ...validEntry(), id: 'b'.repeat(36) }, { ...validEntry(), id: 'c'.repeat(36) }],
    })],
    ['array hole within capacity', () => {
      // One real entry plus one hole; total length 2 stays within MAX_ENTRIES(2)
      // so this exercises the hole-rejection path rather than the capacity path.
      const entries: unknown[] = [validEntry()];
      entries.length = 2;
      return { ...validConfig(), entries };
    }],
    ['symbol key on config', () => { const config = validConfig(); (config as Record<symbol, unknown>)[Symbol('x')] = 1; return config; }],
  ])('rejects %s with the fixed configuration error', (_label, buildInput) => {
    expect(() => parseGenSourceReadConfig(buildInput())).toThrow(CONFIG_ERROR);
  });

  it('rejects an accessor property without invoking its getter', () => {
    const config = validConfig();
    const getter = vi.fn(() => sha256('never'));
    Object.defineProperty(config, 'adapterSha256', { get: getter, enumerable: true, configurable: true });
    expect(() => parseGenSourceReadConfig(config)).toThrow(CONFIG_ERROR);
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects oversized, duplicate-keyed (identical and escaped), and syntactically invalid raw configuration JSON', () => {
    expect(() => parseGenSourceReadConfigJson(`${' '.repeat(65_537)}null`)).toThrow(CONFIG_ERROR);
    expect(() => parseGenSourceReadConfigJson('{')).toThrow(CONFIG_ERROR);
    const path = JSON.stringify(resolve('python.exe'));
    const identicalDuplicateKeyJson = `{"pythonExecutable":${path},"pythonExecutable":${path},"adapterSha256":"${sha256('a')}","dependencySha256":${JSON.stringify(dependencyPins())},"entries":[${JSON.stringify(validEntry())}]}`;
    expect(() => parseGenSourceReadConfigJson(identicalDuplicateKeyJson)).toThrow(CONFIG_ERROR);
    // Same key, but the second occurrence spells its first letter with a
    // \u0070 escape: the raw text differs but the decoded key is identical,
    // so this must be rejected as a duplicate key by decoded value, not text.
    const escapedDuplicateKeyJson = `{"pythonExecutable":${path},"\\u0070ythonExecutable":${path},"adapterSha256":"${sha256('a')}","dependencySha256":${JSON.stringify(dependencyPins())},"entries":[${JSON.stringify(validEntry())}]}`;
    expect(() => parseGenSourceReadConfigJson(escapedDuplicateKeyJson)).toThrow(CONFIG_ERROR);
    let nested: unknown = 0;
    for (let i = 0; i < 20; i += 1) nested = [nested];
    expect(() => parseGenSourceReadConfigJson(JSON.stringify({ ...validConfig(), adapterSha256: nested }))).toThrow(CONFIG_ERROR);
  });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('Figment gen-source-read registration', () => {
  it('requires an absolute repo root even with valid configuration', async () => {
    const fx = await makeFixture();
    const app = Fastify({ logger: false });
    expect(() => registerFigmentGenSourceRead(app, { repoRoot: 'relative-repo', sessionConfig: fx.sessionConfig, config: fx.config })).toThrow();
  });

  it('revalidates typed configuration at registration time', () => {
    const app = Fastify({ logger: false });
    const invalid = { pythonExecutable: 'relative.exe', adapterSha256: sha256('a'), dependencySha256: dependencyPins(), entries: [] } as unknown as GenSourceReadConfig;
    expect(() => registerFigmentGenSourceRead(app, { repoRoot: resolve('repo'), sessionConfig: { secret: Buffer.from('s'), ttlMs: 1 }, config: invalid })).toThrow(CONFIG_ERROR);
  });

  it('mutating the original config object after registration does not change served state', async () => {
    const fx = await makeFixture();
    // Capture expected/before values independently of the object we are about
    // to mutate, so the assertions below cannot accidentally read the mutation.
    const originalId = fx.config.entries[0]!.id;
    const originalSourceRoot = fx.sourceRoot;
    // Deliberate runtime cast: the config type is readonly, but this test
    // exists specifically to prove that post-registration mutation (via an
    // escape hatch a misbehaving caller might use) has no effect.
    (fx.config as { pythonExecutable: string }).pythonExecutable = resolve('MUTATED.exe');
    (fx.config.entries[0] as { sourceRoot: string }).sourceRoot = resolve('MUTATED-SOURCE');
    const listed = await fx.app.inject({ method: 'GET', url: GET, headers: auth(fx.sessionConfig) });
    expect(listed.json().entries[0].id).toBe(originalId);
    const ran = await fx.app.inject({ method: 'POST', url: post(originalId), headers: postHeaders(fx) });
    expect(ran.statusCode).toBe(200);
    const [, args] = (fx.runner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(args).toContain(originalSourceRoot);
  });

  it('freezes the runner options and rejects mutation of the served config clone', async () => {
    const fx = await makeFixture();
    await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    const [, , options] = (fx.runner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(Object.isFrozen(options)).toBe(true);
    expect(() => { (options as Record<string, unknown>).timeout = 1; }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// GET discovery
// ---------------------------------------------------------------------------

describe('Figment gen-source-read GET discovery', () => {
  it('requires a session, refuses queries and bodies, and disables cleanly without configuration', async () => {
    const fx = await makeFixture({ configOverride: null });
    expect((await fx.app.inject({ method: 'GET', url: GET })).statusCode).toBe(401);
    expect((await fx.app.inject({ method: 'GET', url: `${GET}?x=1`, headers: auth(fx.sessionConfig) })).statusCode).toBe(400);
    expect((await fx.app.inject({ method: 'GET', url: GET, headers: { ...auth(fx.sessionConfig), 'content-type': 'application/json', 'content-length': '2' }, payload: '{}' })).statusCode).toBe(400);
    const response = await fx.app.inject({ method: 'GET', url: GET, headers: auth(fx.sessionConfig) });
    expect(response.json()).toEqual({ schema: 'figment/studio-gen-source-reads@1', configured: false, availability: 'not-configured', entries: [] });
    expect(decodeGenSourceReadInventory(response.json())).not.toBeNull();
    expect(fx.runner).not.toHaveBeenCalled();
  });

  it('reports availability transitions across idle, busy, and quarantined', async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const waiting = new Promise<void>((done) => { release = done; });
    const enteredRunner = new Promise<void>((done) => { entered = done; });
    const fx = await makeFixture({ run: (async () => {
      entered?.();
      await waiting;
      return { stdout: goodStdout({ planSha256: KNOWN_PLAN_SHA256, sourcePlanSha256: KNOWN_SOURCE_PLAN_SHA256 }) };
    }) as unknown as Runner });
    // app.inject() returns a lazy thenable that does not begin executing until
    // awaited/`.then`-ed; start it explicitly before waiting on enteredRunner,
    // or the two promises deadlock each other.
    const first = fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) }).then((r) => r);
    await enteredRunner;
    expect((await fx.app.inject({ method: 'GET', url: GET, headers: auth(fx.sessionConfig) })).json().availability).toBe('busy');
    release?.();
    expect((await first).statusCode).toBe(200);
    expect((await fx.app.inject({ method: 'GET', url: GET, headers: auth(fx.sessionConfig) })).json().availability).toBe('available');

    const quarantinedFx = await makeFixture({ run: vi.fn(async () => { throw new StudioPlanProcessError('timeout', true); }) as unknown as Runner });
    await quarantinedFx.app.inject({ method: 'POST', url: post(quarantinedFx.config.entries[0]!.id), headers: postHeaders(quarantinedFx) });
    expect((await quarantinedFx.app.inject({ method: 'GET', url: GET, headers: auth(quarantinedFx.sessionConfig) })).json().availability).toBe('quarantined');
  });
});

// ---------------------------------------------------------------------------
// POST source-check: request validation before any pre-spawn or spawn work
// ---------------------------------------------------------------------------

describe('Figment gen-source-read POST request validation refuses before any call', () => {
  it.each<[string, number, (fx: Awaited<ReturnType<typeof makeFixture>>) => { url: string; headers: Record<string, string>; payload?: string }]>([
    ['missing session', 401, (fx) => ({ url: post(fx.config.entries[0]!.id), headers: {} })],
    ['query string present', 400, (fx) => ({ url: `${post(fx.config.entries[0]!.id)}?x=1`, headers: postHeaders(fx) })],
    ['body present', 400, (fx) => ({ url: post(fx.config.entries[0]!.id), headers: { ...postHeaders(fx), 'content-type': 'application/json', 'content-length': '2' }, payload: '{}' })],
    ['missing plan header', 400, (fx) => { const headers = postHeaders(fx); delete (headers as Record<string, string>)['x-figment-plan-sha256']; return { url: post(fx.config.entries[0]!.id), headers }; }],
    ['wrong-shape plan header', 400, (fx) => ({ url: post(fx.config.entries[0]!.id), headers: { ...postHeaders(fx), 'x-figment-plan-sha256': 'not-a-sha' } })],
    ['comma-joined duplicate-like plan header', 400, (fx) => ({ url: post(fx.config.entries[0]!.id), headers: { ...postHeaders(fx), 'x-figment-plan-sha256': `${fx.planSha256},${fx.planSha256}` } })],
    ['missing scope header', 400, (fx) => { const headers = postHeaders(fx); delete (headers as Record<string, string>)['x-figment-request-scope']; return { url: post(fx.config.entries[0]!.id), headers }; }],
    ['malformed scope header', 400, (fx) => ({ url: post(fx.config.entries[0]!.id), headers: { ...postHeaders(fx), 'x-figment-request-scope': 'not-a-scope' } })],
    ['malformed id', 400, (fx) => ({ url: post('not-an-id'), headers: postHeaders(fx) })],
  ])('%s', async (_label, expectedStatus, build) => {
    const fx = await makeFixture();
    const request = build(fx);
    const response = await fx.app.inject({ method: 'POST', ...request });
    expect(response.statusCode).toBe(expectedStatus);
    expect(fx.runner).not.toHaveBeenCalled();
  });

  it('refuses a mismatched request-scope for the authenticated subject', async () => {
    const fx = await makeFixture();
    // Authenticate as "operator" but present a scope minted for a different
    // subject: auth and scope subject deliberately diverge here.
    const headers = {
      ...auth(fx.sessionConfig, 'operator'),
      'x-figment-plan-sha256': fx.planSha256,
      'x-figment-request-scope': scopeFor(fx.repo, 'other-operator'),
    };
    const response = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers });
    expect(response.statusCode).toBe(409);
    expect(fx.runner).not.toHaveBeenCalled();
  });

  it('reports unconfigured, unknown id, and plan-sha mismatch before any call', async () => {
    const disabled = await makeFixture({ configOverride: null });
    expect((await disabled.app.inject({ method: 'POST', url: post(FIXED_ID), headers: postHeaders(disabled) })).statusCode).toBe(404);

    const fx = await makeFixture();
    expect((await fx.app.inject({ method: 'POST', url: post('b'.repeat(36)), headers: postHeaders(fx) })).statusCode).toBe(404);
    const mismatched = { ...postHeaders(fx), 'x-figment-plan-sha256': sha256('other-plan') };
    expect((await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: mismatched })).statusCode).toBe(409);
    expect(fx.runner).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pre-spawn refusals
// ---------------------------------------------------------------------------

describe('Figment gen-source-read pre-spawn refusals', () => {
  it('refuses an unmarked allocation directory before spawning', async () => {
    const fx = await makeFixture();
    await rm(join(fx.planDir, 'published.json'));
    const response = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(response.statusCode).toBe(503);
    expect(fx.runner).not.toHaveBeenCalled();
  });

  it('refuses a legacy-rooted published entry whose directory does not match the allocation root', async () => {
    const fx = await makeFixture();
    const legacyDir = join(fx.repo, '_private', 'figment-studio', 'gen-plans', fx.config.entries[0]!.id);
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, 'plan.json'), await readFile(join(fx.planDir, 'plan.json')));
    await writeFile(join(legacyDir, 'published.json'), await readFile(join(fx.planDir, 'published.json')));
    await rm(fx.planDir, { recursive: true, force: true });
    const response = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(response.statusCode).toBe(503);
    expect(fx.runner).not.toHaveBeenCalled();
  });

  it('refuses a duplicate published id across roots before spawning', async () => {
    const fx = await makeFixture();
    const legacyDir = join(fx.repo, '_private', 'figment-studio', 'gen-plans', fx.config.entries[0]!.id);
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, 'plan.json'), await readFile(join(fx.planDir, 'plan.json')));
    const dupMarker = JSON.parse(await readFile(join(fx.planDir, 'published.json'), 'utf8'));
    dupMarker.intent_sha256 = sha256('different-intent');
    await writeFile(join(legacyDir, 'published.json'), JSON.stringify(dupMarker));
    const response = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(response.statusCode).toBe(503);
    expect(fx.runner).not.toHaveBeenCalled();
  });

  it('refuses an adapter pin drift before spawning with zero calls', async () => {
    const fx = await makeFixture();
    await writeFile(fx.adapterPath, `${fx.adapterBytes}drift`, 'utf8');
    const response = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(response.statusCode).toBe(503);
    expect(fx.runner).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// In-flight drift during the runner
// ---------------------------------------------------------------------------

describe('Figment gen-source-read in-flight drift during the runner', () => {
  it('refuses on adapter replacement mid-flight, then recovers once restored', async () => {
    let calls = 0;
    const fx = await makeFixture({ run: (async () => {
      calls += 1;
      if (calls === 1) await writeFile(fx2.adapterPath, `${fx2.adapterBytes}drift-mid-flight`, 'utf8');
      return { stdout: goodStdout(fx2.config.entries[0]!) };
    }) as unknown as Runner });
    const fx2 = fx;
    const drifted = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(drifted.statusCode).toBe(503);
    await writeFile(fx.adapterPath, fx.adapterBytes, 'utf8');
    const recovered = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(recovered.statusCode).toBe(200);
    expect(fx.runner).toHaveBeenCalledTimes(2);
  });

  it('refuses on plan bytes drift mid-flight, then recovers once restored', async () => {
    let calls = 0;
    const fx = await makeFixture({ run: (async () => {
      calls += 1;
      if (calls === 1) await writeFile(join(fx2.planDir, 'plan.json'), `${PLAN_BYTES} `);
      return { stdout: goodStdout(fx2.config.entries[0]!) };
    }) as unknown as Runner });
    const fx2 = fx;
    const originalPlan = await readFile(join(fx.planDir, 'plan.json'));
    const drifted = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(drifted.statusCode).toBe(503);
    await writeFile(join(fx.planDir, 'plan.json'), originalPlan);
    const recovered = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(recovered.statusCode).toBe(200);
    expect(fx.runner).toHaveBeenCalledTimes(2);
  });

  it('refuses on marker intent drift mid-flight, then recovers once restored', async () => {
    let calls = 0;
    const fx = await makeFixture({ run: (async () => {
      calls += 1;
      if (calls === 1) {
        const marker = JSON.parse((await readFile(join(fx2.planDir, 'published.json'))).toString('utf8'));
        marker.intent_sha256 = sha256('drifted-intent');
        await writeFile(join(fx2.planDir, 'published.json'), JSON.stringify(marker));
      }
      return { stdout: goodStdout(fx2.config.entries[0]!) };
    }) as unknown as Runner });
    const fx2 = fx;
    const originalMarker = await readFile(join(fx.planDir, 'published.json'));
    const drifted = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(drifted.statusCode).toBe(503);
    await writeFile(join(fx.planDir, 'published.json'), originalMarker);
    const recovered = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(recovered.statusCode).toBe(200);
    expect(fx.runner).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Output framing and schema
// ---------------------------------------------------------------------------

describe('Figment gen-source-read output framing and schema', () => {
  it.each<[string, (entry: { planSha256: string; sourcePlanSha256: string }) => Buffer]>([
    ['non-ASCII byte', (entry) => { const buffer = goodStdout(entry); buffer[2] = 0xff; return buffer; }],
    ['embedded CR', () => Buffer.from(`${JSON.stringify({ a: 1 })}\r\n`, 'ascii')],
    ['no trailing LF', (entry) => { const buffer = goodStdout(entry); return buffer.subarray(0, buffer.length - 1); }],
    ['two trailing LF', (entry) => Buffer.concat([goodStdout(entry), Buffer.from('\n')])],
    ['duplicate JSON key', () => Buffer.from('{"schema":"a","schema":"b"}\n', 'ascii')],
    ['wrong creator', (entry) => goodStdout(entry, { creator: 'someone-else' })],
    ['wrong selected sha', (entry) => goodStdout(entry, { selected_plan_sha256: sha256('wrong') })],
    ['wrong source sha', (entry) => goodStdout(entry, { source_plan_sha256: sha256('wrong') })],
    ['wrong gen_runs', (entry) => goodStdout(entry, { gen_runs: 2 })],
    ['wrong manifest count', (entry) => goodStdout(entry, { gen_manifest_sha256: [sha256('m1'), sha256('m2')] })],
    ['claims true', (entry) => goodStdout(entry, { claims: { launch_ready: true, quality_approved: false, atomic_snapshot: false } })],
    ['extra top-level field', (entry) => goodStdout(entry, { extra: 'field' })],
    ['oversized stdout', (entry) => Buffer.concat([goodStdout(entry, { padding: 'x'.repeat(8_000) })])],
  ])('fails closed on %s and leaves the slot reusable', async (_label, buildStdout) => {
    const entry = { planSha256: KNOWN_PLAN_SHA256, sourcePlanSha256: KNOWN_SOURCE_PLAN_SHA256 };
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: buildStdout(entry) })
      .mockResolvedValueOnce({ stdout: goodStdout(entry) }) as unknown as Runner;
    const bad = await makeFixture({ run });
    const first = await bad.app.inject({ method: 'POST', url: post(bad.config.entries[0]!.id), headers: postHeaders(bad) });
    expect(first.statusCode).toBe(503);
    const second = await bad.app.inject({ method: 'POST', url: post(bad.config.entries[0]!.id), headers: postHeaders(bad) });
    expect(second.statusCode).toBe(200);
    expect(bad.runner).toHaveBeenCalledTimes(2);
  });

  it('fails closed on non-Buffer stdout and leaves the slot reusable', async () => {
    const entry = { planSha256: KNOWN_PLAN_SHA256, sourcePlanSha256: KNOWN_SOURCE_PLAN_SHA256 };
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: 'not-a-buffer' as unknown as Buffer })
      .mockResolvedValueOnce({ stdout: goodStdout(entry) }) as unknown as Runner;
    const fx = await makeFixture({ run });
    const first = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(first.statusCode).toBe(503);
    const second = await fx.app.inject({ method: 'POST', url: post(fx.config.entries[0]!.id), headers: postHeaders(fx) });
    expect(second.statusCode).toBe(200);
    expect(fx.runner).toHaveBeenCalledTimes(2);
  });

  it('returns the exact success body with fixed digests and timestamp, and exact argv/options', async () => {
    const fixedNow = () => new Date('2026-09-13T00:00:00.000Z');
    const fx = await makeFixture({ now: fixedNow });
    const entry = fx.config.entries[0]!;
    const response = await fx.app.inject({ method: 'POST', url: post(entry.id), headers: postHeaders(fx) });
    expect(response.statusCode).toBe(200);
    const expectedBody = {
      schema: 'figment/studio-gen-source-read@1',
      id: entry.id,
      planSha256: entry.planSha256,
      outcome: 'source-checked',
      checkedAtUtc: fixedNow().toISOString(),
      digests: {
        personaSha256: sha256('persona-out'),
        approvalSha256: sha256('approval-out'),
        approvalLineageSha256: sha256('lineage-out'),
        sourcePlanSha256: entry.sourcePlanSha256,
        checkpointSha256: sha256('checkpoint-out'),
        genManifestSha256: [sha256('manifest-out')],
      },
      claims: { launchReady: false, qualityApproved: false, atomicSnapshot: false },
      limitations: [...GEN_SOURCE_LIMITATIONS],
    };
    expect(response.json()).toEqual(expectedBody);
    expect(decodeGenSourceReadResult(response.json(), entry.id, entry.planSha256)).not.toBeNull();

    const [command, args, options] = (fx.runner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(command).toBe(fx.config.pythonExecutable);
    expect(args).toEqual([
      '-I', '-B', fx.adapterPath,
      '--creator', 'creator-001',
      '--selected-root', fx.planDir,
      '--selected-plan-sha256', entry.planSha256,
      '--source-root', fx.sourceRoot,
      '--source-plan-sha256', entry.sourcePlanSha256,
      '--dependency-sha256', JSON.stringify(fx.config.dependencySha256),
    ]);
    expect(args).not.toContain('client');
    expect(options).toEqual({ cwd: fx.repo, timeout: 120_000, maxBuffer: 8_192, windowsHide: true, requireEmptyStderr: true });
  });
});

// ---------------------------------------------------------------------------
// Runner failure classification and concurrency
// ---------------------------------------------------------------------------

describe('Figment gen-source-read runner failure classification and concurrency', () => {
  it('returns to idle on a confirmed-dead typed failure', async () => {
    const fx = await makeFixture({ run: vi.fn()
      .mockRejectedValueOnce(new StudioPlanProcessError('timeout', false))
      .mockResolvedValueOnce({ stdout: goodStdout({ planSha256: KNOWN_PLAN_SHA256, sourcePlanSha256: KNOWN_SOURCE_PLAN_SHA256 }) }) as unknown as Runner });
    const entry = fx.config.entries[0]!;
    const first = await fx.app.inject({ method: 'POST', url: post(entry.id), headers: postHeaders(fx) });
    expect(first.statusCode).toBe(503);
    const second = await fx.app.inject({ method: 'POST', url: post(entry.id), headers: postHeaders(fx) });
    expect(second.statusCode).toBe(200);
    expect(fx.runner).toHaveBeenCalledTimes(2);
  });

  it.each<[string, () => Promise<unknown>]>([
    ['uncertain typed failure', async () => { throw new StudioPlanProcessError('timeout', true); }],
    ['untyped async failure', async () => { throw new Error('opaque'); }],
    ['synchronous throw', () => { throw new Error('sync-opaque'); }],
  ])('permanently quarantines on %s', async (_label, run) => {
    const fx = await makeFixture({ run: vi.fn(run) as unknown as Runner });
    const entry = fx.config.entries[0]!;
    const first = await fx.app.inject({ method: 'POST', url: post(entry.id), headers: postHeaders(fx) });
    expect(first.statusCode).toBe(423);
    const second = await fx.app.inject({ method: 'POST', url: post(entry.id), headers: postHeaders(fx) });
    expect(second.statusCode).toBe(423);
    expect((await fx.app.inject({ method: 'GET', url: GET, headers: auth(fx.sessionConfig) })).json().availability).toBe('quarantined');
    expect(fx.runner).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent requests to a single runner call with a 409 while busy', async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const waiting = new Promise<void>((done) => { release = done; });
    const enteredRunner = new Promise<void>((done) => { entered = done; });
    const fx = await makeFixture({ run: (async () => {
      entered?.();
      await waiting;
      return { stdout: goodStdout(fx2.config.entries[0]!) };
    }) as unknown as Runner });
    const fx2 = fx;
    const entry = fx.config.entries[0]!;
    // Start the lazy inject() thenable explicitly before awaiting enteredRunner,
    // otherwise the request never begins and enteredRunner never resolves.
    const first = fx.app.inject({ method: 'POST', url: post(entry.id), headers: postHeaders(fx) }).then((r) => r);
    await enteredRunner;
    const second = await fx.app.inject({ method: 'POST', url: post(entry.id), headers: postHeaders(fx) });
    expect(second.statusCode).toBe(409);
    release?.();
    expect((await first).statusCode).toBe(200);
    expect(fx.runner).toHaveBeenCalledTimes(1);
  });

  // A genuine client-abort-without-server-release scenario is not practically
  // exercisable through Fastify's `inject()` transport, which has no partial-
  // close/abort signal reaching the route handler; it is not asserted here to
  // avoid an unsupported claim about behavior this harness cannot observe.
});
