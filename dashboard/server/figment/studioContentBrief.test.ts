import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintSession } from '../auth/session.ts';
import { registerFigmentStudioContentBrief, type StudioContentBriefOptions } from './studioContentBrief.ts';
import { StudioPlanProcessError, type runStudioPlanProcessCapture } from './studioPlanProcess.ts';
import type { collectContentBriefs } from './contentBriefs.ts';

const TEMPORARY_PARENT = resolve(tmpdir());
const TEMPORARY_PREFIXES = ['figment-studio-content-brief-', 'figment-studio-content-brief-missing-'];
const temporary: string[] = [];

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function trackTemporary(root: string): string {
  const absolute = resolve(root);
  if (!samePath(dirname(absolute), TEMPORARY_PARENT)
    || !TEMPORARY_PREFIXES.some((prefix) => basename(absolute).startsWith(prefix))) {
    throw new Error(`refusing to track test fixture outside the intended temporary parent: ${absolute}`);
  }
  temporary.push(absolute);
  return absolute;
}

async function verifyTemporaryForRemoval(root: string): Promise<string> {
  const absolute = resolve(root);
  const [parentIdentity, rootIdentity, rootStat] = await Promise.all([
    realpath(TEMPORARY_PARENT), realpath(absolute), lstat(absolute),
  ]);
  if (!samePath(dirname(absolute), TEMPORARY_PARENT)
    || !TEMPORARY_PREFIXES.some((prefix) => basename(absolute).startsWith(prefix))
    || !samePath(dirname(rootIdentity), parentIdentity)
    || !rootStat.isDirectory()
    || rootStat.isSymbolicLink()) {
    throw new Error(`refusing unverified recursive fixture cleanup; preserved: ${absolute}`);
  }
  return absolute;
}

afterEach(async (context) => {
  const roots = temporary.splice(0);
  if (context.task.result?.state !== 'pass') {
    for (const root of roots) process.stderr.write(`[studioContentBrief.test] preserved failed fixture: ${root}\n`);
    return;
  }
  const verified = await Promise.all(roots.map(verifyTemporaryForRemoval));
  for (const root of verified.reverse()) await rm(root, { recursive: true, force: false });
});

const sessionConfig = { secret: Buffer.from('figment-studio-content-brief-test-secret'), ttlMs: 60_000 };
const POST = '/api/figment/studio/content-brief-revisions';
const BASE = 'summer-test';
const BRIEF_ID = '2026-09-12-creator-001-revision-a';
const REQUEST_SHA = 'a'.repeat(64);
const BRIEF_SHA = 'b'.repeat(64);
const NOW = new Date('2026-09-12T12:34:56.000Z');
const PYTHON = resolve('figment-studio-content-brief-python.exe');
const BARRIER_TIMEOUT_MS = 2_000;
const READER_RESULT = Buffer.from(JSON.stringify({
  brief_sha256: BRIEF_SHA,
  request_sha256: REQUEST_SHA,
  schema: 'figment/content-brief-revalidation@1',
}) + '\n', 'utf8');

type Runner = typeof runStudioPlanProcessCapture;
type Collector = typeof collectContentBriefs;

interface Paths {
  repo: string;
  figment: string;
  content: string;
  briefs: string;
  base: string;
  final: string;
  allocation: string;
  edits: string;
  recovery: string;
  publisher: string;
  reader: string;
}

interface FixtureOptions {
  paths?: Paths;
  runnerFactory?: (paths: Paths) => Runner;
  collector?: Collector;
  audit?: StudioContentBriefOptions['auditPublished'];
  extra?: Partial<StudioContentBriefOptions>;
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    baseBriefId: BASE,
    briefDate: '2026-09-12',
    slug: 'revision-a',
    hypothesis: 'A bounded replacement hypothesis.',
    intendedMetric: 'saves per reached account',
    ...overrides,
  };
}

function headers(subject = 'operator'): Record<string, string> {
  return { authorization: `Bearer ${mintSession(subject, sessionConfig).token}` };
}

function recorded(baseBriefId = BASE, creatorId = 'creator-001'): ReturnType<Collector> {
  return {
    status: 'recorded', recordKind: 'planning-snapshot', currentSourceRevalidated: false,
    items: [{ briefId: baseBriefId, creatorId }],
  } as unknown as ReturnType<Collector>;
}

async function makePaths(): Promise<Paths> {
  const repo = trackTemporary(await mkdtemp(join(TEMPORARY_PARENT, 'figment-studio-content-brief-')));
  const figment = join(repo, 'orgs', 'figment');
  const content = join(figment, 'content');
  const briefs = join(content, 'briefs');
  const base = join(briefs, BASE);
  const pipeline = join(figment, 'pipeline', 'content');
  await mkdir(base, { recursive: true });
  await mkdir(pipeline, { recursive: true });
  await writeFile(join(base, 'request.json'), '{}\n', 'utf8');
  await writeFile(join(base, 'brief.json'), '{}\n', 'utf8');
  const publisher = join(pipeline, 'content_brief.py');
  const reader = join(pipeline, 'content_brief_read.py');
  await writeFile(publisher, '# publisher fixture\n', 'utf8');
  await writeFile(reader, '# reader fixture\n', 'utf8');
  return {
    repo, figment, content, briefs, base,
    final: join(briefs, BRIEF_ID),
    allocation: join(content, '.studio-revision-active'),
    edits: join(content, '.studio-revision-active', 'edits.json'),
    recovery: join(content, '.studio-revision-active', 'recovery.json'),
    publisher, reader,
  };
}

function argument(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index < 0 || index + 1 >= args.length) throw new Error(`missing test argv flag ${flag}`);
  return args[index + 1]!;
}

async function publishSynthetic(args: readonly string[]): Promise<void> {
  const root = argument(args, '--root');
  const out = argument(args, '--out-dir');
  const target = join(root, ...out.split('/'));
  await mkdir(target);
  await writeFile(join(target, 'request.json'), '{"fixture":"request"}\n', 'utf8');
  await writeFile(join(target, 'brief.json'), '{"fixture":"brief"}\n', 'utf8');
}

function defaultRunner(): Runner {
  let calls = 0;
  return (async (_command, args) => {
    calls += 1;
    if (calls === 1) {
      await publishSynthetic(args);
      return { stdout: Buffer.from('publisher stdout is ignored', 'utf8') };
    }
    return { stdout: READER_RESULT };
  }) as Runner;
}

async function fixture(options: FixtureOptions = {}) {
  const paths = options.paths ?? await makePaths();
  const runner = vi.fn(options.runnerFactory?.(paths) ?? defaultRunner()) as unknown as Runner;
  const collector = vi.fn(options.collector ?? (() => recorded())) as unknown as Collector;
  const audit = vi.fn(options.audit ?? (async (
    _subject: string, _result: Parameters<StudioContentBriefOptions['auditPublished']>[1],
  ) => {}));
  const app = Fastify({ logger: false });
  registerFigmentStudioContentBrief(app, {
    repoRoot: paths.repo,
    sessionConfig,
    runProcess: runner,
    collectBriefs: collector,
    pythonResolver: () => ({ command: PYTHON, prefixArgs: ['-3'] }),
    platform: 'win32',
    now: () => NOW,
    auditPublished: audit,
    ...options.extra,
  });
  await app.ready();
  return { app, paths, runner, collector, audit };
}

async function post(
  app: FastifyInstance, value: unknown = body(), subject = 'operator',
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: POST,
    headers: { ...headers(subject), 'content-type': 'application/json' },
    payload: JSON.stringify(value),
  });
}

function expectError(response: LightMyRequestResponse, status: number, error: string): void {
  expect(response.statusCode).toBe(status);
  expect(response.json()).toEqual({ error });
}

function expectUnauthenticated(response: LightMyRequestResponse): void {
  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({ error: 'unauthenticated', reason: 'missing session token' });
}

async function allocationEntries(paths: Paths): Promise<string[]> {
  return (await readdir(paths.allocation)).sort();
}

function expectPrivateFree(response: LightMyRequestResponse, paths: Paths): void {
  for (const forbidden of [
    paths.repo, paths.repo.replaceAll('\\', '\\\\'), paths.publisher, paths.reader,
    'A bounded replacement hypothesis.', 'saves per reached account',
    'publisher stdout is ignored', 'private-child-error', 'edits_sha256', 'created_utc',
  ]) expect(response.body).not.toContain(forbidden);
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), BARRIER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe('Studio content-brief revision request and publication', () => {
  it('requires an authenticated session before request processing', async () => {
    const { app, paths, runner, audit } = await fixture();
    expectUnauthenticated(await app.inject({ method: 'POST', url: POST, payload: body() }));
    expect(runner).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(existsSync(paths.allocation)).toBe(false);
    await app.close();
  });

  it('registers inertly and refuses unsupported platform or unsafe Windows root forms before every port', async () => {
    const paths = await makePaths();
    const cases: Array<{ repoRoot: string; platform: NodeJS.Platform }> = [
      { repoRoot: paths.repo, platform: 'linux' },
      { repoRoot: '\\\\server\\share\\private-repo', platform: 'win32' },
      { repoRoot: '\\\\?\\C:\\private-repo', platform: 'win32' },
      { repoRoot: '\\rooted-without-drive\\private-repo', platform: 'win32' },
      { repoRoot: 'relative-repo', platform: 'win32' },
    ];
    for (const value of cases) {
      const collector = vi.fn(() => { throw new Error('collector must not run'); }) as unknown as Collector;
      const pythonResolver = vi.fn(() => { throw new Error('resolver must not run'); });
      const runner = vi.fn(defaultRunner()) as unknown as Runner;
      const audit = vi.fn(async () => {});
      const app = Fastify({ logger: false });
      expect(() => registerFigmentStudioContentBrief(app, {
        repoRoot: value.repoRoot,
        sessionConfig,
        runProcess: runner,
        collectBriefs: collector,
        pythonResolver,
        platform: value.platform,
        auditPublished: audit,
      })).not.toThrow();
      try {
        await app.ready();
        expectUnauthenticated(await app.inject({ method: 'POST', url: POST, payload: body() }));
        expectError(await post(app, { invalid: true }), 400, 'invalid-request');
        const response = await post(app);
        expectError(response, 503, 'publication-unavailable');
        expect(response.body).not.toContain('private-repo');
        expect(collector).not.toHaveBeenCalled();
        expect(pythonResolver).not.toHaveBeenCalled();
        expect(runner).not.toHaveBeenCalled();
        expect(audit).not.toHaveBeenCalled();
        expect(existsSync(paths.allocation)).toBe(false);
      } finally {
        await app.close();
      }
    }
  });

  it('creates exact durable inputs before launch, uses only fixed argv, audits, cleans, then returns the public DTO', async () => {
    let invocation = 0;
    const { app, paths, runner, audit, collector } = await fixture({ runnerFactory: (owned) => (async (command, args, options) => {
      invocation += 1;
      expect(command).toBe(PYTHON);
      expect(options).toEqual({ cwd: owned.repo, timeout: 30_000, maxBuffer: 16_384, windowsHide: true });
      if (invocation === 1) {
        expect(await allocationEntries(owned)).toEqual(['edits.json', 'recovery.json']);
        const editsBytes = await readFile(owned.edits);
        expect(JSON.parse(editsBytes.toString('utf8'))).toEqual({
          brief_date: '2026-09-12',
          hypothesis: 'A bounded replacement hypothesis.',
          intended_metric: 'saves per reached account',
        });
        const recovery = JSON.parse(await readFile(owned.recovery, 'utf8')) as Record<string, unknown>;
        expect(recovery).toEqual({
          schema: 'figment/studio-content-brief-revision-recovery@1',
          status: 'publication-outcome-unclaimed',
          base_brief_id: BASE,
          brief_id: BRIEF_ID,
          edits_sha256: createHash('sha256').update(editsBytes).digest('hex'),
          created_utc: NOW.toISOString(),
        });
        expect(args).toEqual([
          '-3', '-I', '-B', owned.publisher,
          '--root', owned.figment,
          '--revise-base', `content/briefs/${BASE}`,
          '--edits', 'content/.studio-revision-active/edits.json',
          '--out-dir', `content/briefs/${BRIEF_ID}`,
        ]);
        await publishSynthetic(args);
        return { stdout: Buffer.from('publisher stdout is ignored', 'utf8') };
      }
      expect(await allocationEntries(owned)).toEqual(['edits.json', 'recovery.json']);
      expect(args).toEqual([
        '-3', '-I', '-B', owned.reader,
        '--root', owned.figment,
        '--request', `content/briefs/${BRIEF_ID}/request.json`,
        '--brief', `content/briefs/${BRIEF_ID}/brief.json`,
      ]);
      return { stdout: READER_RESULT };
    }) as Runner });

    const response = await post(app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schema: 'figment/studio-content-brief-revision@1',
      status: 'published', briefId: BRIEF_ID, briefSha256: BRIEF_SHA,
    });
    expectPrivateFree(response, paths);
    expect(collector).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith('operator', { baseBriefId: BASE, briefId: BRIEF_ID, briefSha256: BRIEF_SHA });
    expect(existsSync(paths.allocation)).toBe(false);
    expect((await readdir(paths.final)).sort()).toEqual(['brief.json', 'request.json']);
    expectError(await post(app), 409, 'brief-exists');
    expect(runner).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('rejects malformed shapes, IDs, dates, UTF-16 boundaries, controls, and unpaired surrogates before mutation', async () => {
    const { app, paths, runner, collector } = await fixture();
    const cases: unknown[] = [
      null,
      [],
      {},
      { ...body(), extra: true },
      body({ baseBriefId: 'Summer-Test' }),
      body({ baseBriefId: 'a'.repeat(129) }),
      body({ baseBriefId: 'unsafe/path' }),
      body({ baseBriefId: '-base' }),
      body({ baseBriefId: 'base-' }),
      body({ baseBriefId: 'base--id' }),
      body({ briefDate: '2026-02-30' }),
      body({ briefDate: '2026-9-1' }),
      body({ slug: 'Revision-A' }),
      body({ slug: '-revision' }),
      body({ slug: 'revision-' }),
      body({ slug: 'revision--a' }),
      body({ slug: 'a'.repeat(106) }),
      body({ hypothesis: ' padded' }),
      body({ hypothesis: '' }),
      body({ hypothesis: 'a'.repeat(4_097) }),
      body({ hypothesis: `bad\u0000control` }),
      body({ hypothesis: `bad\u0085control` }),
      body({ hypothesis: `bad\ud800surrogate` }),
      body({ intendedMetric: 'metric\nline' }),
    ];
    for (const value of cases) expectError(await post(app, value), 400, 'invalid-request');
    const malformed = await app.inject({
      method: 'POST', url: POST, headers: { ...headers(), 'content-type': 'application/json' }, payload: '{',
    });
    expectError(malformed, 400, 'invalid-request');
    expect(runner).not.toHaveBeenCalled();
    expect(collector).not.toHaveBeenCalled();
    expect(existsSync(paths.allocation)).toBe(false);
    await app.close();
  });

  it('accepts an escaped 4,096-unit body below 65,536 bytes and fixes oversized-body failure at 413', async () => {
    const accepted = await fixture();
    const escaped = `{"baseBriefId":"${BASE}","briefDate":"2026-09-12","slug":"revision-a","hypothesis":"${'\\u0061'.repeat(4_096)}","intendedMetric":"metric"}`;
    expect(Buffer.byteLength(escaped, 'utf8')).toBeGreaterThan(16_384);
    expect(Buffer.byteLength(escaped, 'utf8')).toBeLessThanOrEqual(65_536);
    const response = await accepted.app.inject({ method: 'POST', url: POST, headers: { ...headers(), 'content-type': 'application/json' }, payload: escaped });
    expect(response.statusCode).toBe(200);
    expect(accepted.runner).toHaveBeenCalledTimes(2);
    await accepted.app.close();

    const oversized = await fixture();
    const tooLarge = await oversized.app.inject({
      method: 'POST', url: POST, headers: { ...headers(), 'content-type': 'application/json' }, payload: `{"padding":"${'x'.repeat(65_537)}"}`,
    });
    expectError(tooLarge, 413, 'body-too-large');
    expect(oversized.runner).not.toHaveBeenCalled();
    expect(oversized.collector).not.toHaveBeenCalled();
    expect(existsSync(oversized.paths.allocation)).toBe(false);
    await oversized.app.close();
  });

  it('distinguishes a missing base from unavailable collector evidence without allocating', async () => {
    const missing = await fixture({ collector: (() => ({ status: 'empty', recordKind: 'planning-snapshot', currentSourceRevalidated: false, items: [] })) as Collector });
    expectError(await post(missing.app), 404, 'not-found');
    expect(missing.runner).not.toHaveBeenCalled();
    expect(existsSync(missing.paths.allocation)).toBe(false);
    await missing.app.close();

    const unavailable = await fixture({ collector: (() => ({ status: 'unavailable', reason: 'evidence-unavailable', items: [] })) as Collector });
    expectError(await post(unavailable.app), 503, 'publication-unavailable');
    expect(unavailable.runner).not.toHaveBeenCalled();
    expect(existsSync(unavailable.paths.allocation)).toBe(false);
    await unavailable.app.close();

    const wrongCreator = await fixture({ collector: (() => recorded(BASE, 'creator-002')) as Collector });
    expectError(await post(wrongCreator.app), 404, 'not-found');
    expect(wrongCreator.runner).not.toHaveBeenCalled();
    await wrongCreator.app.close();
  });

  it('returns 409 only for a safe prelaunch directory and treats other target types as unavailable', async () => {
    const existing = await fixture();
    await mkdir(existing.paths.final);
    expectError(await post(existing.app), 409, 'brief-exists');
    expect(existing.runner).not.toHaveBeenCalled();
    expect(existing.audit).not.toHaveBeenCalled();
    expect(existsSync(existing.paths.allocation)).toBe(false);
    await existing.app.close();

    const unsafe = await fixture();
    await writeFile(unsafe.paths.final, 'foreign target', 'utf8');
    expectError(await post(unsafe.app), 503, 'publication-unavailable');
    expect(unsafe.runner).not.toHaveBeenCalled();
    expect(await readFile(unsafe.paths.final, 'utf8')).toBe('foreign target');
    await unsafe.app.close();
  });

  it('refuses and preserves a foreign fixed allocation, including after process restart', async () => {
    const paths = await makePaths();
    await mkdir(paths.allocation);
    await writeFile(join(paths.allocation, 'sentinel'), 'foreign', 'utf8');
    const first = await fixture({ paths });
    expectError(await post(first.app), 503, 'publication-unavailable');
    expect(first.runner).not.toHaveBeenCalled();
    expect(await readFile(join(paths.allocation, 'sentinel'), 'utf8')).toBe('foreign');
    await first.app.close();
    const restarted = await fixture({ paths });
    expectError(await post(restarted.app), 503, 'publication-unavailable');
    expect(restarted.runner).not.toHaveBeenCalled();
    expect(await readFile(join(paths.allocation, 'sentinel'), 'utf8')).toBe('foreign');
    await restarted.app.close();
  });
});

describe('Studio content-brief concurrency and recovery', () => {
  it('returns 429 for a second request while one handler owns the active slot', async () => {
    let entered: (() => void) | undefined;
    let release: (() => void) | undefined;
    const runnerEntered = new Promise<void>((done) => { entered = done; });
    const waiting = new Promise<void>((done) => { release = done; });
    let invocation = 0;
    const item = await fixture({ runnerFactory: () => (async (_command, args) => {
      invocation += 1;
      if (invocation === 1) { entered?.(); await bounded(waiting, 'same-process test release'); await publishSynthetic(args); return { stdout: Buffer.alloc(0) }; }
      return { stdout: READER_RESULT };
    }) as Runner });
    const first = post(item.app);
    try {
      await bounded(runnerEntered, 'same-process runner entry');
      expectError(await post(item.app, body({ slug: 'revision-b' })), 429, 'busy');
      release?.();
      expect((await bounded(first, 'same-process first response')).statusCode).toBe(200);
      expect(item.runner).toHaveBeenCalledTimes(2);
    } finally {
      release?.();
      await bounded(first, 'same-process request settlement').catch(() => undefined);
      await item.app.close();
    }
  });

  it('uses the fixed allocation as a cross-instance lock', async () => {
    const paths = await makePaths();
    let entered: (() => void) | undefined;
    let release: (() => void) | undefined;
    const runnerEntered = new Promise<void>((done) => { entered = done; });
    const waiting = new Promise<void>((done) => { release = done; });
    let invocation = 0;
    const first = await fixture({ paths, runnerFactory: () => (async (_command, args) => {
      invocation += 1;
      if (invocation === 1) { entered?.(); await bounded(waiting, 'cross-instance test release'); await publishSynthetic(args); return { stdout: Buffer.alloc(0) }; }
      return { stdout: READER_RESULT };
    }) as Runner });
    const second = await fixture({ paths });
    const pending = post(first.app);
    try {
      await bounded(runnerEntered, 'cross-instance runner entry');
      expectError(await post(second.app, body({ slug: 'revision-b' })), 503, 'publication-unavailable');
      expect(second.runner).not.toHaveBeenCalled();
      release?.();
      expect((await bounded(pending, 'cross-instance first response')).statusCode).toBe(200);
    } finally {
      release?.();
      await bounded(pending, 'cross-instance request settlement').catch(() => undefined);
      await Promise.allSettled([first.app.close(), second.app.close()]);
    }
  });

  it.each([
    ['confirmed nonzero', new StudioPlanProcessError('exit_nonzero', false)],
    ['confirmed timeout', new StudioPlanProcessError('timeout', false)],
    ['uncertain timeout', new StudioPlanProcessError('timeout', true)],
    ['unknown failure', new Error('private-child-error')],
  ])('retains durable recovery after publisher may have started: %s', async (_label, failure) => {
    const item = await fixture({ runnerFactory: () => (async () => { throw failure; }) as Runner });
    const response = await post(item.app);
    expectError(response, 503, 'publication-unavailable');
    expectPrivateFree(response, item.paths);
    expect(await allocationEntries(item.paths)).toEqual(['edits.json', 'recovery.json']);
    expect(item.runner).toHaveBeenCalledTimes(1);
    expectError(await post(item.app, body({ slug: 'revision-b' })), 503, 'publication-unavailable');
    expect(item.runner).toHaveBeenCalledTimes(1);
    await item.app.close();

    const restarted = await fixture({ paths: item.paths });
    expectError(await post(restarted.app, body({ slug: 'revision-c' })), 503, 'publication-unavailable');
    expect(restarted.runner).not.toHaveBeenCalled();
    expect(await allocationEntries(item.paths)).toEqual(['edits.json', 'recovery.json']);
    await restarted.app.close();
  });

  it('treats a target race inside the publisher as ambiguous recovery, never 409', async () => {
    const item = await fixture({ runnerFactory: () => (async (_command, args) => {
      await publishSynthetic(args);
      throw new StudioPlanProcessError('exit_nonzero', false);
    }) as Runner });
    const response = await post(item.app);
    expectError(response, 503, 'publication-unavailable');
    expect(await allocationEntries(item.paths)).toEqual(['edits.json', 'recovery.json']);
    expect((await readdir(item.paths.final)).sort()).toEqual(['brief.json', 'request.json']);
    expect(item.audit).not.toHaveBeenCalled();
    await item.app.close();
  });

  it('detects allocation identity replacement before the reader and preserves both trees', async () => {
    let moved = '';
    const item = await fixture({ runnerFactory: (paths) => (async () => {
      moved = `${paths.allocation}.moved`;
      await rename(paths.allocation, moved);
      await mkdir(paths.allocation);
      await writeFile(paths.edits, 'foreign edits', 'utf8');
      await writeFile(paths.recovery, 'foreign recovery', 'utf8');
      return { stdout: Buffer.alloc(0) };
    }) as Runner });
    const response = await post(item.app);
    expectError(response, 503, 'publication-unavailable');
    expect(item.runner).toHaveBeenCalledTimes(1);
    expect((await readdir(moved)).sort()).toEqual(['edits.json', 'recovery.json']);
    expect(await allocationEntries(item.paths)).toEqual(['edits.json', 'recovery.json']);
    expect(await readFile(item.paths.edits, 'utf8')).toBe('foreign edits');
    expect(item.audit).not.toHaveBeenCalled();
    await item.app.close();
  });

  it.each([
    ['non-UTF8', Buffer.from([0xff])],
    ['noncanonical key order', Buffer.from(JSON.stringify({ schema: 'figment/content-brief-revalidation@1', request_sha256: REQUEST_SHA, brief_sha256: BRIEF_SHA }) + '\n')],
    ['extra key', Buffer.from(JSON.stringify({ brief_sha256: BRIEF_SHA, private: true, request_sha256: REQUEST_SHA, schema: 'figment/content-brief-revalidation@1' }) + '\n')],
    ['uppercase hash', Buffer.from(JSON.stringify({ brief_sha256: BRIEF_SHA.toUpperCase(), request_sha256: REQUEST_SHA, schema: 'figment/content-brief-revalidation@1' }) + '\n')],
  ])('retains recovery when the final reader returns %s', async (_label, stdout) => {
    let invocation = 0;
    const item = await fixture({ runnerFactory: () => (async (_command, args) => {
      invocation += 1;
      if (invocation === 1) { await publishSynthetic(args); return { stdout: Buffer.alloc(0) }; }
      return { stdout };
    }) as Runner });
    const response = await post(item.app);
    expectError(response, 503, 'publication-unavailable');
    expectPrivateFree(response, item.paths);
    expect(item.runner).toHaveBeenCalledTimes(2);
    expect(item.audit).not.toHaveBeenCalled();
    expect(await allocationEntries(item.paths)).toEqual(['edits.json', 'recovery.json']);
    await item.app.close();
  });

  it('retains recovery and returns no success when audit fails', async () => {
    const audit = vi.fn(async () => { throw new Error('private audit failure'); });
    const item = await fixture({ audit });
    const response = await post(item.app, body(), 'verified-subject');
    expectError(response, 503, 'publication-unavailable');
    expectPrivateFree(response, item.paths);
    expect(audit).toHaveBeenCalledWith('verified-subject', { baseBriefId: BASE, briefId: BRIEF_ID, briefSha256: BRIEF_SHA });
    expect(await allocationEntries(item.paths)).toEqual(['edits.json', 'recovery.json']);
    await item.app.close();
  });

  it('awaits identity-checked cleanup and refuses success when an owned file changes', async () => {
    const item = await fixture({ audit: async () => {} });
    await item.app.close();
    const mutated = await fixture({ paths: item.paths, audit: async () => { await appendFile(item.paths.recovery, 'changed'); } });
    const response = await post(mutated.app);
    expectError(response, 503, 'publication-unavailable');
    expect(mutated.audit).toHaveBeenCalledTimes(1);
    expect(existsSync(item.paths.allocation)).toBe(true);
    expect(await allocationEntries(item.paths)).toEqual(['edits.json', 'recovery.json']);
    await mutated.app.close();
  });

  it('fails closed on an unavailable root or collector exception without child or audit output', async () => {
    const missingParent = trackTemporary(await mkdtemp(join(TEMPORARY_PARENT, 'figment-studio-content-brief-missing-')));
    const missingRoot = join(missingParent, 'absent');
    const absent = Fastify({ logger: false });
    const run = vi.fn(defaultRunner()) as unknown as Runner;
    const audit = vi.fn(async () => {});
    registerFigmentStudioContentBrief(absent, {
      repoRoot: missingRoot, sessionConfig, runProcess: run,
      collectBriefs: (() => recorded()) as Collector,
      pythonResolver: () => ({ command: PYTHON, prefixArgs: [] }), platform: 'win32', auditPublished: audit,
    });
    await absent.ready();
    expectError(await post(absent), 503, 'publication-unavailable');
    expect(run).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    await absent.close();

    const unavailable = await fixture({ collector: (() => { throw new Error('private collector failure'); }) as Collector });
    const response = await post(unavailable.app);
    expectError(response, 503, 'publication-unavailable');
    expectPrivateFree(response, unavailable.paths);
    expect(unavailable.runner).not.toHaveBeenCalled();
    expect(unavailable.audit).not.toHaveBeenCalled();
    expect(existsSync(unavailable.paths.allocation)).toBe(false);
    await unavailable.app.close();
  });
});
