import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { join, resolve } from 'node:path';
import { mintSession } from '../auth/session.ts';
import { VIDEO_RULING_LIMITATIONS, decodeVideoRulingResult } from '../../shared/figmentVideoRuling.ts';
import {
  parseVideoRulingConfig,
  parseVideoRulingConfigJson,
  registerFigmentVideoRulingRead,
  type VideoRulingConfig,
} from './videoRulingRead.ts';
import { StudioPlanProcessError, type runStudioPlanProcessCapture } from './studioPlanProcess.ts';

const sessionConfig = { secret: Buffer.from('figment-video-ruling-read-test-secret'), ttlMs: 60_000 };
const repoRoot = resolve('figment-video-ruling-read-repo');
const pythonExecutable = resolve('figment-video-ruling-read-python.exe');
const root = resolve('figment-video-ruling-read-root');
const GET = '/api/figment/video-rulings';
const post = (id: string) => `/api/figment/video-rulings/${id}/read`;
type Runner = typeof runStudioPlanProcessCapture;

function auth(): Record<string, string> {
  return { authorization: `Bearer ${mintSession('operator', sessionConfig).token}` };
}

function entries(...ids: string[]): VideoRulingConfig['entries'] {
  return ids.map((id) => ({
    id,
    root,
    evaluationPath: 'prepared/evaluation.json',
    rulingPath: 'rulings/operator.json',
  }));
}

function config(...ids: string[]): VideoRulingConfig {
  return { pythonExecutable, entries: entries(...ids) };
}

const PYTHON_LIMITATIONS = [
  'playback_observation, correspondence_review, temporal_review, detail_crop_review, template_fit_review, and all audio_* fields are self-reported claims by the declared attribution, not observations made by this reader.',
  'The bound_subject_sha256/bound_review_directory match and the ruling_file hash only prove this claim is bound to the current prepared evidence at read time; they do not prove the claim is true.',
  'unauthenticated_attribution is an unverified, self-declared string; no authentication of the claimed author was performed.',
  'No human review of the video was observed or performed by this reader; it never watches, decodes, or renders the media itself.',
  'This reader grants no delivery, media-quality, promotion, or publication authority; not_promotable is always true.',
  'The reused prepared-delivery store (video_delivery_review.py) has its own separately documented technical limitations.',
  'Equality checks across the two validate_prepared_delivery calls and the two byte snapshots establish cooperative freshness only; they are not atomicity guarantees against a hostile concurrent writer.',
];

function rawResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const subjectSha256 = 'a'.repeat(64);
  return {
    schema: 'figment/video-delivery-ruling-result@1',
    projection: {
      review_directory: 'prepared/review',
      subject_sha256: subjectSha256,
      accepted_lineage: {},
      source_movie: {},
      derivative: {},
      template: {},
      transform_declaration: {},
      extraction_receipt: {},
      tools: {},
    },
    ruling: {
      schema: 'figment/video-delivery-ruling-assertion@1',
      bound_subject_sha256: subjectSha256,
      bound_review_directory: 'prepared/review',
      playback_observation: 'watched_full',
      correspondence_review: 'pass',
      temporal_review: 'pass',
      detail_crop_review: 'pass',
      template_fit_review: 'pass',
      audio_presence_claim: 'present',
      audio_licensing_review: 'pass',
      audio_mix_sync_review: 'pass',
      notes: 'PRIVATE_OPERATOR_NOTES',
      unauthenticated_attribution: 'PRIVATE_ATTRIBUTION',
      recorded_at: '2026-09-12T00:00:00Z',
    },
    ruling_file: { path: 'rulings/operator.json', bytes: 123, sha256: 'b'.repeat(64) },
    derived_outcome: 'reported_pass',
    not_promotable: true,
    attribution_authenticated: false,
    limitations: [...PYTHON_LIMITATIONS],
    ...overrides,
  };
}

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');

async function fixture(options: { run?: Runner; rulingConfig?: VideoRulingConfig | null } = {}) {
  const runner = vi.fn(options.run ?? (async () => ({ stdout: bytes(rawResult()) }))) as unknown as Runner;
  const app = Fastify({ logger: false });
  registerFigmentVideoRulingRead(app, {
    repoRoot,
    sessionConfig,
    config: options.rulingConfig === undefined ? config('alpha') : options.rulingConfig,
    runProcess: runner,
  });
  await app.ready();
  return { app, runner };
}

function expectNoPrivateDisclosure(body: string): void {
  for (const forbidden of [repoRoot, root, pythonExecutable, 'PRIVATE_OPERATOR_NOTES', 'PRIVATE_ATTRIBUTION', 'rulings/operator.json', 'stderr-private']) {
    expect(body).not.toContain(forbidden);
  }
}

function fixedConfigError(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error('expected configuration to be refused');
}

describe('Figment video-ruling configuration', () => {
  it('disables only nullish configuration and clones a valid closed configuration', () => {
    expect(parseVideoRulingConfig(undefined)).toBeNull();
    expect(parseVideoRulingConfig(null)).toBeNull();
    expect(parseVideoRulingConfigJson(undefined)).toBeNull();
    expect(parseVideoRulingConfigJson('null')).toBeNull();
    const input = config('alpha');
    const parsed = parseVideoRulingConfig(input);
    expect(parsed).toEqual(input);
    expect(parseVideoRulingConfigJson(JSON.stringify(input))).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed?.entries).not.toBe(input.entries);
    input.entries[0]!.root = resolve('mutated-root');
    expect(parsed?.entries[0]?.root).toBe(root);
  });

  it('rejects closed-key, duplicate-id, unsafe-path, malformed-Unicode, malformed JSON, and oversized configuration without echoing it', () => {
    const badPath = 'PRIVATE_CONFIG_VALUE';
    const entry = entries('alpha')[0]!;
    const messages = [
      fixedConfigError(() => parseVideoRulingConfig({ ...config('alpha'), extra: true })),
      fixedConfigError(() => parseVideoRulingConfig({ pythonExecutable, entries: [entry, { ...entry }] })),
      fixedConfigError(() => parseVideoRulingConfig({ pythonExecutable: 'python', entries: [entry] })),
      fixedConfigError(() => parseVideoRulingConfig({ pythonExecutable, entries: [{ ...entry, evaluationPath: '../outside.json' }] })),
      fixedConfigError(() => parseVideoRulingConfig({ pythonExecutable, entries: [{ ...entry, rulingPath: `rulings/${badPath}\\bad.json` }] })),
      fixedConfigError(() => parseVideoRulingConfig({ pythonExecutable, entries: [{ ...entry, root: `x\u0000${root}` }] })),
      fixedConfigError(() => parseVideoRulingConfig({ pythonExecutable, entries: [{ ...entry, id: 'alpha\n' }] })),
      fixedConfigError(() => parseVideoRulingConfig({ pythonExecutable, entries: [{ ...entry, id: 'alpha\r' }] })),
      fixedConfigError(() => parseVideoRulingConfig({ pythonExecutable: `${pythonExecutable}\ud800`, entries: [entry] })),
      fixedConfigError(() => parseVideoRulingConfig({ pythonExecutable, entries: [{ ...entry, root: `${root}\ud800` }] })),
      fixedConfigError(() => parseVideoRulingConfig({ pythonExecutable, entries: [{ ...entry, evaluationPath: 'prepared/evaluation.json\ud800' }] })),
      fixedConfigError(() => parseVideoRulingConfig({ pythonExecutable, entries: [{ ...entry, rulingPath: 'rulings/operator.json\ud800' }] })),
      fixedConfigError(() => parseVideoRulingConfigJson('{')),
      fixedConfigError(() => parseVideoRulingConfigJson(`${' '.repeat(65_537)}null`)),
    ];
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).not.toContain(badPath);
    expect(messages[0]).not.toContain(root);
  });

  it('accepts exactly sixteen distinct entries and refuses a seventeenth', () => {
    const sixteen = Array.from({ length: 16 }, (_, index) => `id-${index}`);
    expect(parseVideoRulingConfig(config(...sixteen))?.entries.map((entry) => entry.id)).toEqual(sixteen);
    expect(() => parseVideoRulingConfig(config(...Array.from({ length: 17 }, (_, index) => `id-${index}`)))).toThrow();
  });

  it('accepts well-formed non-BMP path segments while retaining the relative-path rules', () => {
    const parsed = parseVideoRulingConfig({
      pythonExecutable: resolve('trusted-🐍.exe'),
      entries: [{ id: 'alpha', root: resolve('review-🪐'), evaluationPath: 'prepared/🧪.json', rulingPath: 'rulings/📜.json' }],
    });
    expect(parsed).toEqual({
      pythonExecutable: resolve('trusted-🐍.exe'),
      entries: [{ id: 'alpha', root: resolve('review-🪐'), evaluationPath: 'prepared/🧪.json', rulingPath: 'rulings/📜.json' }],
    });
  });

  it('revalidates an invalid typed config at registration even with a valid repo root', () => {
    const invalid = { pythonExecutable, entries: [{ ...entries('alpha')[0]!, evaluationPath: 'C:/client.json' }] } as unknown as VideoRulingConfig;
    const app = Fastify({ logger: false });
    expect(() => registerFigmentVideoRulingRead(app, { repoRoot, sessionConfig, config: invalid })).toThrow();
  });

  it('requires an absolute server-owned repo root even with valid configuration', () => {
    const app = Fastify({ logger: false });
    expect(() => registerFigmentVideoRulingRead(app, { repoRoot: 'relative-repo', sessionConfig, config: config('alpha') })).toThrow();
  });
});

describe('Figment video-ruling reader routes', () => {
  it('requires its own session gate before either route has observable behavior', async () => {
    const { app, runner } = await fixture();
    expect((await app.inject({ method: 'GET', url: GET })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: post('alpha') })).statusCode).toBe(401);
    expect(runner).not.toHaveBeenCalled();
    await app.close();
  });

  it('reports a disabled reader without discovery and refuses all reads without spawning', async () => {
    const { app, runner } = await fixture({ rulingConfig: null });
    expect((await app.inject({ method: 'GET', url: GET, headers: auth() })).json()).toEqual({ schema: 'figment/studio-video-rulings@1', ids: [], availability: 'available' });
    const response = await app.inject({ method: 'POST', url: post('alpha'), headers: auth() });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not-found' });
    expect(runner).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts no client-controlled body or query on either endpoint', async () => {
    const { app, runner } = await fixture();
    for (const request of [
      { method: 'GET' as const, url: `${GET}?discover=1`, payload: undefined, framing: {} },
      // Fastify does not normally parse a GET payload: exercise the actual wire framing the route closes.
      { method: 'GET' as const, url: GET, payload: '{}', framing: { 'content-type': 'application/json', 'content-length': '2' } },
      { method: 'POST' as const, url: `${post('alpha')}?root=client`, payload: undefined, framing: {} },
      { method: 'POST' as const, url: post('alpha'), payload: '{}', framing: {} },
    ]) {
      const response = await app.inject({ ...request, headers: { ...auth(), ...(request.payload === undefined ? {} : { 'content-type': 'application/json' }), ...(request.framing ?? {}) } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid-request' });
    }
    expect((await app.inject({ method: 'GET', url: GET, headers: { ...auth(), 'content-type': 'application/json', 'content-length': '0' } })).statusCode).toBe(200);
    expect(runner).not.toHaveBeenCalled();
    await app.close();
  });

  it('treats ids as opaque configured names, including names that collide with object properties', async () => {
    const { app, runner } = await fixture({ rulingConfig: config('constructor') });
    expect((await app.inject({ method: 'POST', url: post('other'), headers: auth() })).json()).toEqual({ error: 'not-found' });
    expect((await app.inject({ method: 'POST', url: post('%24bad'), headers: auth() })).json()).toEqual({ error: 'not-found' });
    expect((await app.inject({ method: 'POST', url: post('constructor'), headers: auth() })).statusCode).toBe(200);
    expect(runner).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('uses only the fixed interpreter, script, argv, and runner options, and never exposes raw reader fields', async () => {
    const { app, runner } = await fixture();
    const response = await app.inject({ method: 'POST', url: post('alpha'), headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schema: 'figment/studio-video-ruling@1', id: 'alpha', subjectSha256: 'a'.repeat(64), rulingSha256: 'b'.repeat(64),
      derivedOutcome: 'reported_pass',
      criteria: {
        playbackObservation: 'watched_full', correspondenceReview: 'pass', temporalReview: 'pass', detailCropReview: 'pass', templateFitReview: 'pass',
        audioPresenceClaim: 'present', audioLicensingReview: 'pass', audioMixSyncReview: 'pass',
      },
      notPromotable: true, attributionAuthenticated: false, limitations: [...VIDEO_RULING_LIMITATIONS],
    });
    expect(decodeVideoRulingResult(response.json(), 'alpha')).not.toBeNull();
    const [command, args, options] = (runner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[], unknown];
    expect(command).toBe(pythonExecutable);
    expect(args).toEqual(['-I', '-B', join(repoRoot, 'orgs', 'figment', 'pipeline', 'video', 'video_delivery_ruling_assertion.py'), 'read', '--root', root, '--evaluation', 'prepared/evaluation.json', '--ruling', 'rulings/operator.json']);
    expect(options).toEqual({ cwd: repoRoot, timeout: 90_000, maxBuffer: 262_144, windowsHide: true });
    expectNoPrivateDisclosure(response.body);
    await app.close();
  });

  it('detaches the registrar slot and invocation from later caller mutation', async () => {
    const mutable = config('alpha');
    const { app, runner } = await fixture({ rulingConfig: mutable });
    mutable.pythonExecutable = resolve('MUTATED-PYTHON');
    mutable.entries[0]!.root = resolve('MUTATED-ROOT');
    mutable.entries[0]!.evaluationPath = 'mutated.json';
    expect((await app.inject({ method: 'GET', url: GET, headers: auth() })).json().ids).toEqual(['alpha']);
    expect((await app.inject({ method: 'POST', url: post('alpha'), headers: auth() })).statusCode).toBe(200);
    const [command, args] = (runner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(command).toBe(pythonExecutable);
    expect(args).toContain(root);
    expect(args).toContain('prepared/evaluation.json');
    await app.close();
  });

  it('has one synchronous registration-wide slot across ids and makes its state visible through GET', async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const waiting = new Promise<void>((done) => { release = done; });
    const enteredRunner = new Promise<void>((done) => { entered = done; });
    const run = vi.fn(async () => { entered?.(); await waiting; return { stdout: bytes(rawResult()) }; }) as unknown as Runner;
    const { app, runner } = await fixture({ rulingConfig: config('alpha', 'beta'), run });
    const first = app.inject({ method: 'POST', url: post('alpha'), headers: auth() });
    await enteredRunner;
    expect((await app.inject({ method: 'GET', url: GET, headers: auth() })).json()).toEqual({ schema: 'figment/studio-video-rulings@1', ids: ['alpha', 'beta'], availability: 'busy' });
    expect((await app.inject({ method: 'POST', url: post('beta'), headers: auth() })).json()).toEqual({ error: 'busy' });
    release?.();
    expect((await first).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: GET, headers: auth() })).json().availability).toBe('available');
    expect(runner).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('releases a confirmed-dead process failure but quarantines uncertain and unknown failures', async () => {
    const confirmed = await fixture({ run: vi.fn()
      .mockRejectedValueOnce(new StudioPlanProcessError('timeout', false))
      .mockResolvedValueOnce({ stdout: bytes(rawResult()) }) as unknown as Runner });
    expect((await confirmed.app.inject({ method: 'POST', url: post('alpha'), headers: auth() })).json()).toEqual({ error: 'unavailable' });
    expect((await confirmed.app.inject({ method: 'POST', url: post('alpha'), headers: auth() })).statusCode).toBe(200);
    expect(confirmed.runner).toHaveBeenCalledTimes(2);
    await confirmed.app.close();

    for (const error of [new StudioPlanProcessError('timeout', true), new Error('stderr-private')]) {
      const quarantined = await fixture({ run: vi.fn(async () => { throw error; }) as unknown as Runner });
      const first = await quarantined.app.inject({ method: 'POST', url: post('alpha'), headers: auth() });
      expect(first.statusCode).toBe(423);
      expect(first.json()).toEqual({ error: 'quarantined' });
      expectNoPrivateDisclosure(first.body);
      expect((await quarantined.app.inject({ method: 'GET', url: GET, headers: auth() })).json().availability).toBe('quarantined');
      expect((await quarantined.app.inject({ method: 'POST', url: post('alpha'), headers: auth() })).json()).toEqual({ error: 'quarantined' });
      expect(quarantined.runner).toHaveBeenCalledTimes(1);
      await quarantined.app.close();
    }
  });

  it('counts Python notes by Unicode code point, validates them, and never returns them', async () => {
    const validNotes = '😀'.repeat(4_096);
    const invalidNotes = '😀'.repeat(4_097);
    const withNotes = (notes: string) => rawResult({ ruling: { ...(rawResult().ruling as object), notes } });
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: bytes(withNotes(validNotes)) })
      .mockResolvedValueOnce({ stdout: bytes(withNotes(invalidNotes)) }) as unknown as Runner;
    const { app, runner } = await fixture({ run });
    const accepted = await app.inject({ method: 'POST', url: post('alpha'), headers: auth() });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body).not.toContain('😀');
    const refused = await app.inject({ method: 'POST', url: post('alpha'), headers: auth() });
    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toEqual({ error: 'unavailable' });
    expect(refused.body).not.toContain('😀');
    expect(runner).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it.each([
    ['non-UTF8 stdout', Buffer.from([0xff])],
    ['invalid JSON', Buffer.from('{', 'utf8')],
    ['extra top-level field', bytes({ ...rawResult(), private: true })],
    ['wrong process flags', bytes(rawResult({ not_promotable: false }))],
    ['mismatched bound hash', bytes(rawResult({ ruling: { ...(rawResult().ruling as object), bound_subject_sha256: 'c'.repeat(64) } }))],
    ['closed projection shape', bytes(rawResult({ projection: { ...(rawResult().projection as object), private: {} } }))],
    ['closed ruling shape', bytes(rawResult({ ruling: { ...(rawResult().ruling as object), private: {} } }))],
    ['invalid ruling file bounds', bytes(rawResult({ ruling_file: { path: 'rulings/operator.json', bytes: 0, sha256: 'b'.repeat(64) } }))],
    ['non-lowercase hash', bytes(rawResult({ ruling_file: { path: 'rulings/operator.json', bytes: 123, sha256: 'B'.repeat(64) } }))],
    ['line-feed-terminated subject hash', bytes(rawResult({
      projection: { ...(rawResult().projection as object), subject_sha256: `${'a'.repeat(64)}\n` },
      ruling: { ...(rawResult().ruling as object), bound_subject_sha256: `${'a'.repeat(64)}\n` },
    }))],
    ['carriage-return-terminated ruling hash', bytes(rawResult({ ruling_file: { path: 'rulings/operator.json', bytes: 123, sha256: `${'b'.repeat(64)}\r` } }))],
    ['inconsistent audio criteria', bytes(rawResult({ ruling: { ...(rawResult().ruling as object), audio_presence_claim: 'absent' } }))],
    ['incorrect outcome', bytes(rawResult({ derived_outcome: 'reported_fail' }))],
    ['wrong limitation list', bytes(rawResult({ limitations: ['wrong'] }))],
    ['oversized private note', bytes(rawResult({ ruling: { ...(rawResult().ruling as object), notes: 'x'.repeat(4097) } }))],
  ])('fails closed on %s and releases the slot after confirmed reader completion', async (_label, stdout) => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout })
      .mockResolvedValueOnce({ stdout: bytes(rawResult()) }) as unknown as Runner;
    const { app, runner } = await fixture({ run });
    const invalid = await app.inject({ method: 'POST', url: post('alpha'), headers: auth() });
    expect(invalid.statusCode).toBe(503);
    expect(invalid.json()).toEqual({ error: 'unavailable' });
    expectNoPrivateDisclosure(invalid.body);
    expect((await app.inject({ method: 'POST', url: post('alpha'), headers: auth() })).statusCode).toBe(200);
    expect(runner).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
