import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintSession } from '../auth/session.ts';
import { collectContentBriefs } from './contentBriefs.ts';
import {
  registerFigmentStudioContentBrief,
  type StudioContentBriefAudit,
} from './studioContentBrief.ts';
import { runStudioPlanProcessCapture } from './studioPlanProcess.ts';

/**
 * Real local join over a caller-owned synthetic repository. The actual builder
 * creates the base pair, the actual collector admits it, and the route invokes
 * the publisher and reader through the production owned-process runner.
 */

if (process.platform !== 'win32') {
  throw new Error('Studio content-brief real-join tests require Windows');
}
const configuredPython = process.env.FIGMENT_TEST_PYTHON_EXECUTABLE;
if (configuredPython === undefined || !isAbsolute(configuredPython)) {
  throw new Error('FIGMENT_TEST_PYTHON_EXECUTABLE must name an absolute test interpreter');
}

const PYTHON_EXECUTABLE = resolve(configuredPython);
const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_REPO = resolve(HERE, '..', '..', '..');
const SOURCE_CONTENT = join(SOURCE_REPO, 'orgs', 'figment', 'pipeline', 'content');
const PIPELINE_FILES = [
  'content_brief.py',
  'content_brief_read.py',
  'taxonomy.yaml',
  'carousel-templates.yaml',
  'reel-templates.yaml',
] as const;
const FIXTURE_PREFIX = 'figment-studio-content-brief-real-join-';
const BASE_ID = 'base-brief';
const BRIEF_ID = '2026-09-12-creator-001-revision-a';
const POST = '/api/figment/studio/content-brief-revisions';
const FIXTURE_TIMEOUT_MS = 30_000;
const CASE_TIMEOUT_MS = 120_000;
const SOURCE_CITATION = 'https://example.test/research';
const REFERENCE_BYTES = Buffer.from('synthetic-adult-persona-reference-bytes', 'utf8');
const sessionConfig = {
  secret: Buffer.from('figment-studio-content-brief-real-join-session-secret', 'utf8'),
  ttlMs: 60_000,
};
const requestBody = {
  baseBriefId: BASE_ID,
  briefDate: '2026-09-12',
  slug: 'revision-a',
  hypothesis: 'A revised synthetic hypothesis for the contained real join.',
  intendedMetric: 'profile visits per reached account',
};
const baseRequest = {
  schema: 'figment/content-brief-request@1',
  brief_date: '2026-09-11',
  creator: {
    id: 'creator-001',
    persona_path: 'personas/creator-001/persona.yaml',
    canonical_reference: 'anchors/g01.jpg',
  },
  surface: 'carousel',
  template_id: 'CT-2',
  asset_slots: [
    { taxonomy_type: 'A', kind: 'persona' },
    { taxonomy_type: 'A', kind: 'persona' },
  ],
  sources: [{ citation: SOURCE_CITATION, observed_date: '2026-09-10' }],
  hypothesis: 'A synthetic base hypothesis for the contained real join.',
  intended_metric: 'saves per reached account',
  observed_metrics: null,
};
const syntheticPersona = {
  id: 'creator-001',
  identity: {
    references: ['anchors/g01.jpg'],
    fixture_subject: 'synthetic-adult',
  },
};

interface Fixture {
  repo: string;
  figment: string;
  briefs: string;
  base: string;
  final: string;
  allocation: string;
  edits: string;
  recovery: string;
  persona: string;
  reference: string;
  publisher: string;
  pins: Map<string, Buffer>;
}

const temporary: string[] = [];

function samePath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function ownedTemporaryRoot(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child !== ''
    && child !== '..'
    && !child.startsWith(`..${sep}`)
    && !isAbsolute(child)
    && dirname(child) === '.'
    && basename(child).startsWith(FIXTURE_PREFIX);
}

async function verifiedTemporaryRoot(parent: string, candidate: string): Promise<string> {
  const [resolvedParent, resolvedCandidate, info] = await Promise.all([
    realpath(parent), realpath(candidate), lstat(candidate),
  ]);
  if (!samePath(dirname(resolvedCandidate), resolvedParent)
    || !ownedTemporaryRoot(resolvedParent, resolvedCandidate)
    || !info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`refusing unverified recursive fixture cleanup; preserved: ${candidate}`);
  }
  return resolvedCandidate;
}

afterEach(async (context) => {
  const roots = temporary.splice(0);
  if (context.task.result?.state !== 'pass') {
    for (const root of roots) process.stderr.write(`[studioContentBrief.integration.test] preserved failed fixture: ${root}\n`);
    return;
  }
  for (const root of roots.reverse()) {
    const parent = await realpath(tmpdir());
    const verified = await verifiedTemporaryRoot(parent, root);
    await rm(verified, { recursive: true, force: false });
    expect(existsSync(verified)).toBe(false);
  }
});

function encoded(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function headers(subject = 'operator-real-join'): Record<string, string> {
  return { authorization: `Bearer ${mintSession(subject, sessionConfig).token}` };
}

async function post(app: FastifyInstance) {
  return app.inject({ method: 'POST', url: POST, headers: headers(), payload: requestBody });
}

async function assertPins(fixture: Fixture): Promise<void> {
  for (const [path, expected] of fixture.pins) {
    expect((await readFile(path)).equals(expected), `fixture input changed: ${basename(path)}`).toBe(true);
  }
}

async function buildFixture(): Promise<Fixture> {
  const temporaryParent = await realpath(tmpdir());
  const allocated = await mkdtemp(join(temporaryParent, FIXTURE_PREFIX));
  temporary.push(allocated);
  const repo = await verifiedTemporaryRoot(temporaryParent, allocated);
  const figment = join(repo, 'orgs', 'figment');
  const briefs = join(figment, 'content', 'briefs');
  const base = join(briefs, BASE_ID);
  const final = join(briefs, BRIEF_ID);
  const pipeline = join(figment, 'pipeline', 'content');
  const persona = join(figment, 'personas', 'creator-001', 'persona.yaml');
  const reference = join(figment, 'personas', 'creator-001', 'anchors', 'g01.jpg');
  const allocation = join(figment, 'content', '.studio-revision-active');
  const publisher = join(pipeline, 'content_brief.py');

  await Promise.all([
    mkdir(base, { recursive: true }),
    mkdir(dirname(reference), { recursive: true }),
    mkdir(pipeline, { recursive: true }),
  ]);
  for (const name of PIPELINE_FILES) {
    const source = join(SOURCE_CONTENT, name);
    const target = join(pipeline, name);
    await copyFile(source, target);
    if (!(await readFile(source)).equals(await readFile(target))) {
      throw new Error(`copied fixture input did not match source: ${name}`);
    }
  }
  await writeFile(persona, encoded(syntheticPersona));
  await writeFile(reference, REFERENCE_BYTES);
  await writeFile(join(base, 'request.json'), encoded(baseRequest));

  const built = await runStudioPlanProcessCapture(PYTHON_EXECUTABLE, [
    '-I', '-B', publisher,
    '--root', figment,
    '--request', `content/briefs/${BASE_ID}/request.json`,
    '--out', `content/briefs/${BASE_ID}/brief.json`,
  ], {
    cwd: repo,
    timeout: FIXTURE_TIMEOUT_MS,
    maxBuffer: 16 * 1024,
    windowsHide: true,
  });
  if (built.stdout.length !== 0) throw new Error('content-brief fixture builder returned unexpected output');

  const initial = collectContentBriefs(repo);
  const initialItem = initial.items[0];
  if (initial.status !== 'recorded' || initial.items.length !== 1
    || initialItem?.briefId !== BASE_ID || initialItem?.creatorId !== 'creator-001'
    || initialItem?.assignment !== 'missing') {
    throw new Error('real collector did not admit the synthetic base brief');
  }

  const pinned = [
    join(base, 'request.json'),
    join(base, 'brief.json'),
    persona,
    reference,
    ...PIPELINE_FILES.map((name) => join(pipeline, name)),
  ];
  const pins = new Map<string, Buffer>();
  for (const path of pinned) pins.set(path, await readFile(path));
  return {
    repo,
    figment,
    briefs,
    base,
    final,
    allocation,
    edits: join(allocation, 'edits.json'),
    recovery: join(allocation, 'recovery.json'),
    persona,
    reference,
    publisher,
    pins,
  };
}

async function makeApp(
  fixture: Fixture,
  auditPublished: (subject: string, result: StudioContentBriefAudit) => Promise<void>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerFigmentStudioContentBrief(app, {
    repoRoot: fixture.repo,
    sessionConfig,
    pythonResolver: () => ({ command: PYTHON_EXECUTABLE, prefixArgs: [] }),
    auditPublished,
  });
  await app.ready();
  return app;
}

function expectPrivateFree(body: string, fixture: Fixture): void {
  for (const hidden of [
    fixture.repo,
    fixture.repo.replaceAll('\\', '\\\\'),
    fixture.publisher,
    requestBody.hypothesis,
    requestBody.intendedMetric,
    SOURCE_CITATION,
    'request_sha256',
    'edits_sha256',
    'created_utc',
    'Traceback',
  ]) expect(body).not.toContain(hidden);
}

describe('Studio content-brief route: real builder, collector, publisher, reader, and runner', () => {
  it('publishes a revalidated revision, audits its hash, preserves the base, and cleans before success', async () => {
    const fixture = await buildFixture();
    const audit = vi.fn(async (_subject: string, _result: StudioContentBriefAudit) => {});
    const app = await makeApp(fixture, audit);
    try {
      const response = await post(app);
      expect(response.statusCode).toBe(200);
      const finalBrief = await readFile(join(fixture.final, 'brief.json'));
      const briefSha256 = sha256(finalBrief);
      expect(response.json()).toEqual({
        schema: 'figment/studio-content-brief-revision@1',
        status: 'published',
        briefId: BRIEF_ID,
        briefSha256,
      });
      expectPrivateFree(response.body, fixture);
      expect(audit).toHaveBeenCalledTimes(1);
      expect(audit).toHaveBeenCalledWith('operator-real-join', {
        baseBriefId: BASE_ID,
        briefId: BRIEF_ID,
        briefSha256,
      });
      expect((await readdir(fixture.final)).sort()).toEqual(['brief.json', 'request.json']);

      const originalRequest = JSON.parse(fixture.pins.get(join(fixture.base, 'request.json'))!.toString('utf8')) as Record<string, unknown>;
      const revisedRequest = JSON.parse(await readFile(join(fixture.final, 'request.json'), 'utf8')) as Record<string, unknown>;
      expect(revisedRequest).toEqual({
        ...originalRequest,
        brief_date: requestBody.briefDate,
        hypothesis: requestBody.hypothesis,
        intended_metric: requestBody.intendedMetric,
      });

      const projection = collectContentBriefs(fixture.repo);
      expect(projection.status).toBe('recorded');
      if (projection.status !== 'recorded') throw new Error('real collector lost the published briefs');
      expect(projection.items.map((item) => item.briefId)).toEqual([BRIEF_ID, BASE_ID]);
      expect(projection.items.find((item) => item.briefId === BRIEF_ID)).toMatchObject({
        briefDate: requestBody.briefDate,
        creatorId: 'creator-001',
        hypothesis: requestBody.hypothesis,
        intendedMetric: requestBody.intendedMetric,
        assignment: 'missing',
      });
      expect(existsSync(fixture.allocation)).toBe(false);
      await assertPins(fixture);
    } finally {
      await app.close();
    }
  }, CASE_TIMEOUT_MS);

  it('retains exact recovery after a real stale-input refusal and blocks the same and restarted registrar', async () => {
    const fixture = await buildFixture();
    const originalPersona = await readFile(fixture.persona);
    const stalePersona = {
      ...(JSON.parse(originalPersona.toString('utf8')) as Record<string, unknown>),
      fixture_stale_dependency: true,
    };
    await writeFile(fixture.persona, encoded(stalePersona));
    expect(collectContentBriefs(fixture.repo)).toMatchObject({
      status: 'recorded',
      items: [{ briefId: BASE_ID, creatorId: 'creator-001' }],
    });

    const firstAudit = vi.fn(async (_subject: string, _result: StudioContentBriefAudit) => {});
    let retainedEdits: Buffer | undefined;
    let retainedRecovery: Buffer | undefined;
    const firstApp = await makeApp(fixture, firstAudit);
    try {
      let refused;
      try {
        refused = await post(firstApp);
      } finally {
        await writeFile(fixture.persona, originalPersona);
      }
      expect(refused.statusCode).toBe(503);
      expect(refused.json()).toEqual({ error: 'publication-unavailable' });
      expectPrivateFree(refused.body, fixture);
      expect(firstAudit).not.toHaveBeenCalled();
      expect(existsSync(fixture.final)).toBe(false);
      expect(await readdir(fixture.briefs)).toEqual([BASE_ID]);
      expect((await readdir(fixture.allocation)).sort()).toEqual(['edits.json', 'recovery.json']);

      retainedEdits = await readFile(fixture.edits);
      retainedRecovery = await readFile(fixture.recovery);
      expect(JSON.parse(retainedEdits.toString('utf8'))).toEqual({
        brief_date: requestBody.briefDate,
        hypothesis: requestBody.hypothesis,
        intended_metric: requestBody.intendedMetric,
      });
      const recoveryRecord = JSON.parse(retainedRecovery.toString('utf8')) as Record<string, unknown>;
      expect(Object.keys(recoveryRecord).sort()).toEqual([
        'base_brief_id', 'brief_id', 'created_utc', 'edits_sha256', 'schema', 'status',
      ]);
      expect(recoveryRecord).toMatchObject({
        schema: 'figment/studio-content-brief-revision-recovery@1',
        status: 'publication-outcome-unclaimed',
        base_brief_id: BASE_ID,
        brief_id: BRIEF_ID,
        edits_sha256: sha256(retainedEdits),
      });
      expect(recoveryRecord.created_utc).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));
      expect(new Date(recoveryRecord.created_utc as string).toISOString()).toBe(recoveryRecord.created_utc);

      const sameInstance = await post(firstApp);
      expect(sameInstance.statusCode).toBe(503);
      expect(sameInstance.json()).toEqual({ error: 'publication-unavailable' });
      expect(await readFile(fixture.edits)).toEqual(retainedEdits);
      expect(await readFile(fixture.recovery)).toEqual(retainedRecovery);
      expect(existsSync(fixture.final)).toBe(false);
      expect(firstAudit).not.toHaveBeenCalled();
      await assertPins(fixture);
    } finally {
      await firstApp.close();
    }

    if (retainedEdits === undefined || retainedRecovery === undefined) {
      throw new Error('retained recovery evidence was not captured before restart');
    }
    const restartedAudit = vi.fn(async (_subject: string, _result: StudioContentBriefAudit) => {});
    const restartedApp = await makeApp(fixture, restartedAudit);
    try {
      const restarted = await post(restartedApp);
      expect(restarted.statusCode).toBe(503);
      expect(restarted.json()).toEqual({ error: 'publication-unavailable' });
      expectPrivateFree(restarted.body, fixture);
      expect(restartedAudit).not.toHaveBeenCalled();
      expect(existsSync(fixture.final)).toBe(false);
      expect(await readFile(fixture.edits)).toEqual(retainedEdits);
      expect(await readFile(fixture.recovery)).toEqual(retainedRecovery);
      expect((await readdir(fixture.allocation)).sort()).toEqual(['edits.json', 'recovery.json']);
      await assertPins(fixture);
    } finally {
      await restartedApp.close();
    }
  }, CASE_TIMEOUT_MS);
});
