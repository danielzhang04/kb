// @vitest-environment jsdom
/** Real synthetic producers -> default contained Python reader -> governed loopback HTTP -> React.
 * jsdom interaction coverage only: this is not a Chrome render or media-quality claim.
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GenSourceRead } from '../../src/figment/GenSourceRead.tsx';
import { decodeGenSourceReadResult, GEN_SOURCE_LIMITATIONS, parseGenSourceJson } from '../../shared/figmentGenSourceRead.ts';
import { mintSession } from '../auth/session.ts';
import { admit } from '../control/admission.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import type { GenSourceReadDependencyPins } from './genSourceRead.ts';
import { runStudioPlanProcessCapture } from './studioPlanProcess.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ID = '11111111-2222-4333-8444-555555555555';
const SHA = /^[a-f0-9]{64}$/;
const DEPENDENCIES = ['observed_reads.py', 'figment_train.py', 'training_config.py', 'persona.py', 'lineage.py'];
const HASH = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const nativeFetch = globalThis.fetch;
const sessionConfig = { secret: Buffer.from('synthetic-gen-source-http-test-secret-no-real-credential'), ttlMs: 30 * 60_000 };
const scope = (root: string, subject: string) => HASH(Buffer.from(JSON.stringify(['figment-studio-request-scope@1', resolve(root), subject])));
const POST = `/api/figment/studio/gen-plans/${ID}/source-check`;
type CodePin = { source: string; dest: string; sha256: string };
type Descriptor = {
  schema: 'figment/gen-source-http-fixture@1'; root: string; sourceRoot: string; selectedRoot: string;
  id: string; planSha256: string; sourcePlanSha256: string; adapterSha256: string;
  dependencySha256: GenSourceReadDependencyPins; checkpointPath: string; personaPath: string;
  codePins: CodePin[]; generatedLookSha256: string;
};
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
function exact(x: Record<string, unknown>, keys: string[]): void {
  expect(Object.keys(x).sort()).toEqual([...keys].sort());
}
function child(parent: string, path: string): boolean {
  const rel = relative(parent, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function absoluteEnv(name: string): string {
  const value = process.env[name];
  if (!value || !isAbsolute(value)) throw new Error(`${name} must be an explicit absolute test path`);
  return resolve(value);
}
async function fixtureFiles(root: string): Promise<Record<string, string>> {
  const pins: Record<string, string> = {};
  let entries = 0, bytes = 0;
  async function visit(path: string): Promise<void> {
    if (++entries > 512) throw new Error('synthetic fixture entry cap exceeded');
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || await realpath(path) !== path) throw new Error('noncanonical fixture path');
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name));
    } else {
      if (!stat.isFile() || (bytes += stat.size) > 32 * 1024 * 1024) throw new Error('synthetic fixture byte cap exceeded');
      pins[path] = HASH(await readFile(path));
    }
  }
  await visit(root);
  return pins;
}
function decodeDescriptor(bytes: Buffer, allocated: string): Descriptor {
  expect(bytes.length).toBeLessThanOrEqual(65536);
  expect([...bytes].every((b) => b < 128)).toBe(true);
  expect(bytes.at(-1)).toBe(10);
  expect([...bytes].filter((b) => b === 10)).toHaveLength(1);
  const value: unknown = JSON.parse(bytes.toString('ascii'));
  if (!object(value)) throw new Error('invalid fixture descriptor');
  exact(value, ['schema', 'root', 'sourceRoot', 'selectedRoot', 'id', 'planSha256', 'sourcePlanSha256',
    'adapterSha256', 'dependencySha256', 'checkpointPath', 'personaPath', 'codePins', 'generatedLookSha256']);
  expect(value.schema).toBe('figment/gen-source-http-fixture@1');
  expect(value.id).toBe(ID);
  for (const key of ['root', 'sourceRoot', 'selectedRoot', 'checkpointPath', 'personaPath']) {
    expect(typeof value[key]).toBe('string');
    const path = value[key] as string;
    expect(isAbsolute(path) && resolve(path) === path && child(allocated, path)).toBe(true);
  }
  expect(value.root).toBe(join(allocated, 'r'));
  expect(value.selectedRoot).toBe(join(value.root as string, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', ID));
  for (const key of ['planSha256', 'sourcePlanSha256', 'adapterSha256', 'generatedLookSha256']) expect(value[key]).toMatch(SHA);
  if (!object(value.dependencySha256)) throw new Error('invalid dependency pins');
  exact(value.dependencySha256, DEPENDENCIES);
  for (const digest of Object.values(value.dependencySha256)) expect(digest).toMatch(SHA);
  if (!Array.isArray(value.codePins)) throw new Error('invalid copied code pins');
  expect(value.codePins).toHaveLength(28);
  const seen = new Set<string>();
  for (const pin of value.codePins) {
    if (!object(pin)) throw new Error('invalid copied code pin');
    exact(pin, ['source', 'dest', 'sha256']);
    expect(pin.sha256).toMatch(SHA);
    if (typeof pin.source !== 'string' || typeof pin.dest !== 'string') throw new Error('invalid code path');
    const sourceBase = join(REPO, 'orgs', 'figment', 'pipeline');
    const destBase = join(value.root as string, 'orgs', 'figment', 'pipeline');
    expect(child(sourceBase, pin.source) && child(destBase, pin.dest)).toBe(true);
    expect(relative(sourceBase, pin.source)).toBe(relative(destBase, pin.dest));
    expect(seen.has(pin.dest)).toBe(false); seen.add(pin.dest);
  }
  return value as Descriptor;
}

describe('synthetic real producer/default reader/governed HTTP/React join', () => {
  it('requires manual checks, refuses real checkpoint/persona drift, recovers, and rejects stale owners', async () => {
    const python = absoluteEnv('FIGMENT_TEST_PYTHON_EXECUTABLE');
    const parent = await realpath(absoluteEnv('FIGMENT_GEN_SOURCE_FIXTURE_PARENT'));
    const evidence = absoluteEnv('FIGMENT_GEN_SOURCE_JOIN_EVIDENCE');
    // Root passes the dedicated short private parent. Never allocate in a long OS temp path.
    const workspacePrivate = resolve(REPO, '../../..', '_private');
    expect(child(workspacePrivate, parent)).toBe(true);
    const allocated = await realpath(await mkdtemp(join(parent, 'g-')));
    expect(dirname(allocated)).toBe(parent); expect(basename(allocated).startsWith('g-')).toBe(true);
    // Precreate sibling state before any observed-read snapshot; state writes never touch fixture repo.
    const stateRoot = join(allocated, 'state'); await mkdir(stateRoot);
    const fixtureOut = join(allocated, 'f'); await mkdir(fixtureOut);
    const app = Fastify({ logger: false });
    const restored = new Map<string, Buffer>();
    const cases: string[] = [];
    const calls: { method: string; path: string; status: number }[] = [];
    const before: Record<string, string> = {};
    let artifactRoot = '';
    let allArtifactsBefore: Record<string, string> = {};
    let passed = false;
    try {
      // Builder alone needs installed user-site pytest/Pillow used by the accepted producer helper.
      // The production reader still receives its exact isolated -I -B arguments from the registrar.
      const built = await runStudioPlanProcessCapture(python, ['-B',
        join(REPO, 'dashboard', 'server', 'figment', 'gen_source_read_fixture.py'), '--repo-source', REPO, '--out', fixtureOut,
      ], { cwd: REPO, timeout: 600_000, maxBuffer: 65536, windowsHide: true, requireEmptyStderr: true });
      const fixture = decodeDescriptor(built.stdout, fixtureOut);
      const pipeline = join(fixture.root, 'orgs', 'figment', 'pipeline');
      for (const pin of fixture.codePins) for (const path of [pin.source, pin.dest]) {
        expect(HASH(await readFile(path))).toBe(pin.sha256); before[path] = pin.sha256;
      }
      const look = join(pipeline, 'look-spec.md');
      expect(HASH(await readFile(look))).toBe(fixture.generatedLookSha256); before[look] = fixture.generatedLookSha256;
      for (const path of [fixture.checkpointPath, fixture.personaPath, join(fixture.sourceRoot, 'plan.json'),
        join(fixture.selectedRoot, 'plan.json'), join(fixture.selectedRoot, 'published.json')]) {
        const bytes = await readFile(path); before[path] = HASH(bytes);
        if ([fixture.checkpointPath, fixture.personaPath].includes(path)) restored.set(path, bytes);
      }
      artifactRoot = fixture.root;
      allArtifactsBefore = await fixtureFiles(artifactRoot);
      await writeFile(join(evidence, 'all-fixture-files-before.json'), `${JSON.stringify(allArtifactsBefore, null, 2)}\n`);
      await writeFile(join(evidence, 'fixture-descriptor.json'), `${JSON.stringify(fixture, null, 2)}\n`);
      await writeFile(join(evidence, 'artifact-pins-before.json'), `${JSON.stringify(before, null, 2)}\n`);
      // Bind the port first, then expose exactly that loopback origin through the live allowlist.
      let allowedOrigin = '';
      const ctx = makeSurfaceContext({ repoRoot: fixture.root, stateRoot,
        controlStore: createInMemoryControlPlaneStore(), sessionConfig, allowedOrigins: () => allowedOrigin ? [allowedOrigin] : [],
        traceRoot: null, figmentVideoRulingConfig: null,
        runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
        admission: (kind) => admit(kind, { pending: 0, oldestAgeMs: 0, degraded: false, reasons: [] }),
        figmentGenSourceReadConfig: { pythonExecutable: python, adapterSha256: fixture.adapterSha256,
          dependencySha256: fixture.dependencySha256,
          entries: [{ id: fixture.id, planSha256: fixture.planSha256, sourceRoot: fixture.sourceRoot, sourcePlanSha256: fixture.sourcePlanSha256 }] },
        // Deliberately omit figmentGenSourceReadRunProcess: the production owned runner is exercised.
      }, { env: {} });
      registerWriteSurface(app, ctx);
      const origin = await app.listen({ host: '127.0.0.1', port: 0 });
      allowedOrigin = origin;
      const responses: { status: number; body: string }[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin);
        expect(url.origin).toBe(origin);
        const headers = new Headers(init?.headers); headers.set('Origin', allowedOrigin);
        const response = await nativeFetch(url, { ...init, headers });
        calls.push({ method: init?.method ?? 'GET', path: url.pathname, status: response.status });
        if (init?.method === 'POST') responses.push({ status: response.status, body: await response.clone().text() });
        return response;
      };
      const props = { planId: ID, planSha256: fixture.planSha256, requestScope: scope(fixture.root, 'operator'),
        ownerGeneration: 1, token: mintSession('operator', sessionConfig).token, fetchImpl };
      const view = render(<GenSourceRead {...props} />);
      const ready = async () => waitFor(() => expect((screen.getByRole('button', { name: 'Check current source' }) as HTMLButtonElement).disabled).toBe(false), { timeout: 120_000 });
      const postCount = () => calls.filter((c) => c.method === 'POST').length;
      await ready(); expect(postCount()).toBe(0); cases.push('initial-manual-zero-post');
      async function check(status: number): Promise<void> {
        const count = postCount();
        fireEvent.click(screen.getByRole('button', { name: 'Check current source' }));
        await waitFor(() => expect(postCount()).toBe(count + 1), { timeout: 120_000 });
        await ready();
        const response = responses.at(-1)!; expect(response.status).toBe(status);
        expect(calls.at(-1)?.path).toBe(POST);
        if (status === 200) {
          const result = decodeGenSourceReadResult(parseGenSourceJson(response.body), ID, fixture.planSha256);
          expect(result).not.toBeNull();
          expect(result!.claims).toEqual({ launchReady: false, qualityApproved: false, atomicSnapshot: false });
          expect(result!.digests.sourcePlanSha256).toBe(fixture.sourcePlanSha256);
          expect(result!.digests.checkpointSha256).toBe(before[fixture.checkpointPath]);
          expect(result!.digests.personaSha256).toBe(before[fixture.personaPath]);
          expect(result!.limitations).toEqual(GEN_SOURCE_LIMITATIONS);
          expect(screen.getByText(/^Source checked at /)).toBeTruthy();
        } else {
          expect(JSON.parse(response.body)).toEqual({ error: status === 409 ? 'identity-mismatch' : 'unavailable' });
          expect(screen.queryByText(/^Source checked at /)).toBeNull();
          expect(screen.getByRole('alert').textContent).toContain(status === 409 ? 'identity did not match' : 'unavailable');
        }
        for (const path of [fixture.root, fixture.checkpointPath, fixture.personaPath]) expect(response.body).not.toContain(path);
      }
      await check(200); cases.push('real-default-reader-success-false-claims');
      for (const [name, path] of [['checkpoint', fixture.checkpointPath], ['persona', fixture.personaPath]]) {
        const bytes = restored.get(path)!;
        const changed = name === 'checkpoint' ? Buffer.from(bytes) : Buffer.concat([bytes, Buffer.from('\n')]);
        if (name === 'checkpoint') changed[0] ^= 1;
        try { await writeFile(path, changed); await check(503); cases.push(`${name}-drift-refused`); }
        finally { await writeFile(path, bytes); }
        await check(200); cases.push(`${name}-restored-recovered`);
      }
      let count = postCount();
      view.rerender(<GenSourceRead {...props} requestScope={scope(fixture.root, 'other-operator')} ownerGeneration={2} />);
      expect(screen.queryByText(/^Source checked at /)).toBeNull();
      await ready(); expect(postCount()).toBe(count); await check(409); cases.push('old-request-scope-refused');
      count = postCount();
      view.rerender(<GenSourceRead {...props} ownerGeneration={3} />);
      expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText(/^Source checked at /)).toBeNull();
      await ready(); expect(postCount()).toBe(count); cases.push('owner-restored-no-auto-post');
      await check(200); cases.push('owner-restored-manual-success');
      expect(postCount()).toBe(7);
      passed = true;
    } finally {
      // Each cleanup/evidence step is independent: a listener-close or pin-read error must never
      // skip restoration of the other mutable artifact or suppress the terminal receipt.
      const finalizationErrors: string[] = [];
      try { cleanup(); } catch { finalizationErrors.push('component-cleanup-failed'); }
      try { await app.close(); } catch { finalizationErrors.push('listener-close-failed'); }
      for (const [path, bytes] of restored) {
        try { await writeFile(path, bytes); } catch { finalizationErrors.push(`artifact-restore-failed:${path}`); }
      }
      const after: Record<string, string> = {};
      for (const path of Object.keys(before)) {
        try { after[path] = HASH(await readFile(path)); } catch { finalizationErrors.push(`pin-read-failed:${path}`); }
      }
      let allArtifactsAfter: Record<string, string> = {};
      try { if (artifactRoot) allArtifactsAfter = await fixtureFiles(artifactRoot); }
      catch { finalizationErrors.push('fixture-snapshot-failed'); }
      const artifactsUnchanged = JSON.stringify(allArtifactsBefore) === JSON.stringify(allArtifactsAfter);
      for (const [name, data] of [['all-fixture-files-after.json', allArtifactsAfter], ['artifact-pins-after.json', after]] as const) {
        try { await writeFile(join(evidence, name), `${JSON.stringify(data, null, 2)}\n`); }
        catch { finalizationErrors.push(`evidence-write-failed:${name}`); }
      }
      const pinsUnchanged = JSON.stringify(before) === JSON.stringify(after);
      passed = passed && pinsUnchanged && artifactsUnchanged && finalizationErrors.length === 0;
      if (passed) {
        try {
          const canonical = await realpath(allocated);
          if (canonical !== allocated || dirname(canonical) !== parent || !basename(canonical).startsWith('g-')) throw new Error('unsafe fixture cleanup');
          await rm(canonical, { recursive: true, force: false });
        } catch { finalizationErrors.push('owned-fixture-cleanup-failed'); passed = false; }
      }
      await writeFile(join(evidence, 'journey.json'), `${JSON.stringify({ passed, cases, calls, allocated, pinsUnchanged, artifactsUnchanged, finalizationErrors }, null, 2)}\n`);
      expect(after).toEqual(before);
      expect(allArtifactsAfter).toEqual(allArtifactsBefore);
      expect(finalizationErrors).toEqual([]);
    }
  }, 15 * 60_000);
});
