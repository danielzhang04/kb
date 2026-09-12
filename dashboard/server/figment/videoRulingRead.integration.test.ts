import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { mintSession } from '../auth/session.ts';
import { VIDEO_RULING_LIMITATIONS } from '../../shared/figmentVideoRuling.ts';
import { registerFigmentVideoRulingRead } from './videoRulingRead.ts';
import { runStudioPlanProcessCapture } from './studioPlanProcess.ts';

/**
 * Real local join: the fixture builder uses the accepted Python producer helpers
 * to create a synthetic accepted native video, FFmpeg derivative, prepared
 * delivery subject, and external self-reported claim. The HTTP registrar then
 * invokes the real assertion reader through the production owned-process runner.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const FIXTURE_SCRIPT = join(HERE, 'video_ruling_fixture.py');
const FIXTURE_PREFIX = 'figment-video-ruling-real-join-';
const FIXTURE_TIMEOUT_MS = 10 * 60_000;
const CASE_TIMEOUT_MS = 2 * 60_000;
const ID = 'real-chain';
const POST = `/api/figment/video-rulings/${ID}/read`;
const PRIVATE_NOTE = 'fixture-private-self-reported-note';
const PRIVATE_ATTRIBUTION = 'fixture-self-report';

const configuredPython = process.env.FIGMENT_TEST_PYTHON_EXECUTABLE;
if (configuredPython === undefined || !isAbsolute(configuredPython)) {
  throw new Error('FIGMENT_TEST_PYTHON_EXECUTABLE must name an absolute test interpreter');
}
const PYTHON_EXECUTABLE = resolve(configuredPython);

type FixtureDescriptor = {
  schema: 'figment/video-ruling-real-join-fixture@1';
  root: string;
  evaluationPath: string;
  rulingPath: string;
  subjectSha256: string;
  rulingSha256: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function decodeDescriptor(value: unknown): FixtureDescriptor {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== [
    'evaluationPath', 'root', 'rulingPath', 'rulingSha256', 'schema', 'subjectSha256',
  ].sort().join(',')) throw new Error('fixture builder returned an invalid descriptor');
  if (
    value.schema !== 'figment/video-ruling-real-join-fixture@1'
    || typeof value.root !== 'string'
    || typeof value.evaluationPath !== 'string'
    || typeof value.rulingPath !== 'string'
    || typeof value.subjectSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.subjectSha256)
    || typeof value.rulingSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.rulingSha256)
  ) throw new Error('fixture builder returned an invalid descriptor');
  return value as FixtureDescriptor;
}

function isOwnedTemporaryRoot(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child !== ''
    && child !== '..'
    && !child.startsWith(`..${sep}`)
    && !isAbsolute(child)
    && dirname(child) === '.'
    && basename(child).startsWith(FIXTURE_PREFIX);
}

const sessionConfig = {
  secret: Buffer.from('figment-video-ruling-real-join-session-secret'),
  ttlMs: 60_000,
};

function auth(): Record<string, string> {
  return { authorization: `Bearer ${mintSession('operator', sessionConfig).token}` };
}

let app: FastifyInstance | undefined;
let temporaryParent = '';
let fixtureRoot = '';
let fixture!: FixtureDescriptor;
let rulingPath = '';
let originalRuling = Buffer.alloc(0);
const completedCases = new Set<string>();

beforeAll(async () => {
  temporaryParent = await realpath(tmpdir());
  const allocated = await mkdtemp(join(temporaryParent, FIXTURE_PREFIX));
  fixtureRoot = await realpath(allocated);
  if (!isOwnedTemporaryRoot(temporaryParent, fixtureRoot)) {
    throw new Error('allocated fixture root escaped the caller-owned temporary directory');
  }

  // Build the expensive real producer chain before the route's 90-second
  // reader timeout begins. This process has its own larger bound and the same
  // owned-tree termination guarantee as the production reader invocation.
  const built = await runStudioPlanProcessCapture(PYTHON_EXECUTABLE, [
    FIXTURE_SCRIPT, '--root', fixtureRoot,
  ], {
    cwd: REPO_ROOT,
    timeout: FIXTURE_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  try {
    fixture = decodeDescriptor(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(built.stdout)) as unknown);
  } catch (error) {
    throw new Error('fixture builder output was not a valid descriptor', { cause: error });
  }
  if (resolve(fixture.root) !== fixtureRoot) {
    throw new Error('fixture builder reported a different root');
  }

  rulingPath = join(fixtureRoot, ...fixture.rulingPath.split('/'));
  originalRuling = await readFile(rulingPath);
  app = Fastify({ logger: false });
  registerFigmentVideoRulingRead(app, {
    repoRoot: REPO_ROOT,
    sessionConfig,
    config: {
      pythonExecutable: PYTHON_EXECUTABLE,
      entries: [{
        id: ID,
        root: fixtureRoot,
        evaluationPath: fixture.evaluationPath,
        rulingPath: fixture.rulingPath,
      }],
    },
    // Deliberately no runProcess override: the route must join the production
    // owned-process runner to the real Python assertion reader.
  });
  await app.ready();
}, FIXTURE_TIMEOUT_MS + 30_000);

afterAll(async () => {
  await app?.close();
  if (completedCases.size !== 2 || !fixtureRoot) {
    if (fixtureRoot) console.error(`Preserved failed Figment real-join fixture: ${fixtureRoot}`);
    return;
  }
  const currentRoot = await realpath(fixtureRoot).catch(() => null);
  if (currentRoot !== fixtureRoot || !isOwnedTemporaryRoot(temporaryParent, currentRoot)) {
    throw new Error('refusing to clean an unverified fixture root');
  }
  await rm(currentRoot, { recursive: true, force: false });
});

describe('Figment video-ruling route: real Python reader + owned process runner', () => {
  it('returns the sanitized DTO from one real prepared chain under synthetic session auth', async () => {
    const response = await app!.inject({ method: 'POST', url: POST, headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schema: 'figment/studio-video-ruling@1',
      id: ID,
      subjectSha256: fixture.subjectSha256,
      rulingSha256: fixture.rulingSha256,
      derivedOutcome: 'reported_pass',
      criteria: {
        playbackObservation: 'watched_full',
        correspondenceReview: 'pass',
        temporalReview: 'pass',
        detailCropReview: 'pass',
        templateFitReview: 'pass',
        audioPresenceClaim: 'absent',
        audioLicensingReview: 'not_applicable',
        audioMixSyncReview: 'not_applicable',
      },
      notPromotable: true,
      attributionAuthenticated: false,
      limitations: [...VIDEO_RULING_LIMITATIONS],
    });
    expect(response.body).not.toContain(PRIVATE_NOTE);
    expect(response.body).not.toContain(PRIVATE_ATTRIBUTION);
    expect(response.body).not.toContain(fixtureRoot);
    expect(response.body).not.toContain(fixture.evaluationPath);
    expect(response.body).not.toContain(fixture.rulingPath);
    completedCases.add('success');
  }, CASE_TIMEOUT_MS);

  it('refuses a stale external claim, leaks no detail, and accepts it after exact restoration', async () => {
    const changed = JSON.parse(originalRuling.toString('utf8')) as Record<string, unknown>;
    changed.bound_subject_sha256 = '0'.repeat(64);
    const refused = await (async () => {
      try {
        await writeFile(rulingPath, `${JSON.stringify(changed)}\n`, 'utf8');
        return await app!.inject({ method: 'POST', url: POST, headers: auth() });
      } finally {
        await writeFile(rulingPath, originalRuling);
      }
    })();

    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toEqual({ error: 'unavailable' });
    for (const hidden of [
      fixtureRoot, fixture.evaluationPath, fixture.rulingPath,
      PRIVATE_NOTE, PRIVATE_ATTRIBUTION, 'bound_subject_sha256',
    ]) expect(refused.body).not.toContain(hidden);

    // A nonzero reader exits through the production runner's confirmed-dead
    // path. A second success proves the registrar released its slot rather
    // than leaving it busy or quarantined after that bounded refusal.
    const restored = await app!.inject({ method: 'POST', url: POST, headers: auth() });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      subjectSha256: fixture.subjectSha256,
      rulingSha256: fixture.rulingSha256,
      notPromotable: true,
      attributionAuthenticated: false,
    });
    completedCases.add('stale-restored');
  }, CASE_TIMEOUT_MS * 2);
});
