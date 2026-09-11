/** Durable, provider-free preparation of one current Figment generation plan. */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, opendir, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireSession, verifiedSession } from '../http/middleware.ts';
import type { SessionConfig } from '../auth/session.ts';
import { resolvePython } from '../runtime/python.ts';
import { runStudioPlanProcess, StudioPlanProcessError } from './studioPlanProcess.ts';

const CREATOR = 'creator-001';
const STAGE = 'gen';
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_PLAN_BYTES = 64 * 1024;
const MAX_TREE_BYTES = 256 * 1024 * 1024;
const MAX_ROOT_BYTES = 512 * 1024 * 1024;
const MAX_PUBLISHED = 2;
const MAX_ENTRIES = 2048;
const MAX_DEPTH = 16;
const SHA256 = /^[a-f0-9]{64}$/;
const INTENT = /^[A-Za-z0-9_-]{32,64}$/;
const ID = /^[0-9a-f-]{36}$/;

export interface StudioGenPlan {
  schema: 'figment/studio-gen-plan@1'; id: string; status: 'prepared'; creator: 'creator-001'; stage: 'gen';
  runCount: 1; declaredCeilingUsd: number; planSha256: string;
}
export interface RunStudioGenPlanOptions { cwd: string; timeout: number; maxBuffer: number; windowsHide: boolean; }
export type RunStudioGenPlan = (command: string, args: readonly string[], options: RunStudioGenPlanOptions) => Promise<unknown>;
export interface StudioGenPlanOptions {
  repoRoot: string; ledgerDir: string; sessionConfig: SessionConfig; platform?: NodeJS.Platform;
  runStudioGenPlan?: RunStudioGenPlan;
  auditPrepared?: (subject: string, id: string, planSha256: string) => Promise<void>;
  /** Fault-injection seam; production uses exclusive fsynced publication. */
  publishMarker?: (path: string, content: string) => Promise<void>;
}
interface SafeRoot { path: string; real: string; }
interface Marker { schema: 'figment/studio-gen-plan-marker@1'; id: string; plan_sha256: string; intent_sha256: string; created_utc: string; }

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function ceiling(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 16 || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 50 ? parsed : null;
}
function inside(root: string, candidate: string): boolean {
  const part = relative(root, candidate);
  return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part));
}
async function safeRoot(path: string): Promise<SafeRoot | null> {
  try {
    const absolute = resolve(path);
    const info = await lstat(absolute);
    return info.isDirectory() && !info.isSymbolicLink()
      ? { path: absolute, real: await realpath(absolute) } : null;
  } catch { return null; }
}
async function currentRoot(root: SafeRoot): Promise<boolean> {
  const current = await safeRoot(root.path);
  return current !== null && current.real === root.real;
}
async function safePath(root: SafeRoot, candidate: string, kind: 'file' | 'directory'): Promise<string | null> {
  const absolute = resolve(candidate);
  if (!inside(root.path, absolute) || !await currentRoot(root)) return null;
  try {
    let cursor = root.path;
    for (const segment of relative(root.path, absolute).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, segment);
      if ((await lstat(cursor)).isSymbolicLink()) return null;
    }
    const info = await lstat(absolute);
    return (kind === 'file' ? info.isFile() : info.isDirectory())
      && !info.isSymbolicLink() && inside(root.real, await realpath(absolute)) ? absolute : null;
  } catch { return null; }
}
async function safeProspective(root: SafeRoot, candidate: string): Promise<boolean> {
  const absolute = resolve(candidate);
  if (!inside(root.path, absolute) || !await currentRoot(root)) return false;
  let cursor = root.path;
  for (const segment of relative(root.path, absolute).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink() || !inside(root.real, await realpath(cursor))) return false;
    } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
  }
  return true;
}
async function entryExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
async function readBounded(path: string): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_PLAN_BYTES) return null;
    const value = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < value.length) {
      const read = await handle.read(value, offset, value.length - offset, offset);
      if (read.bytesRead < 1) return null;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    return after.isFile() && after.size === before.size && after.mtimeMs === before.mtimeMs ? value : null;
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}
function summary(value: unknown, id: string, planSha256: string): StudioGenPlan | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  const stages = plan.stages;
  if (plan.schema !== 'figment/train-plan@1' || plan.creator !== CREATOR
    || typeof stages !== 'object' || stages === null || Array.isArray(stages)
    || Object.keys(stages).length !== 1 || !Object.hasOwn(stages, STAGE)) return null;
  const gen = (stages as Record<string, unknown>).gen;
  if (typeof gen !== 'object' || gen === null || Array.isArray(gen)) return null;
  const runs = (gen as Record<string, unknown>).runs;
  if (!Array.isArray(runs) || runs.length !== 1 || typeof runs[0] !== 'object'
    || runs[0] === null || Array.isArray(runs[0])) return null;
  const declaredCeilingUsd = ceiling((runs[0] as Record<string, unknown>).ceiling_usd);
  return declaredCeilingUsd === null ? null : {
    schema: 'figment/studio-gen-plan@1', id, status: 'prepared', creator: CREATOR,
    stage: STAGE, runCount: 1, declaredCeilingUsd, planSha256,
  };
}
async function sizeOf(root: SafeRoot, directory: string): Promise<number | null> {
  let total = 0;
  let count = 0;
  const pending = [{ path: directory, depth: 0 }];
  try {
    while (pending.length) {
      const current = pending.pop()!;
      if (current.depth > MAX_DEPTH || await safePath(root, current.path, 'directory') === null) return null;
      const entries = await opendir(current.path);
      for await (const entry of entries) {
        if (++count > MAX_ENTRIES) return null;
        const next = join(current.path, entry.name);
        const info = await lstat(next);
        if (info.isSymbolicLink()) return null;
        if (info.isDirectory()) pending.push({ path: next, depth: current.depth + 1 });
        else if (info.isFile()) {
          if (await safePath(root, next, 'file') === null) return null;
          total += info.size;
          if (total > MAX_ROOT_BYTES) return total;
        } else return null;
      }
    }
    return total;
  } catch { return null; }
}
function marker(value: unknown): Marker | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const expected = ['schema', 'id', 'plan_sha256', 'intent_sha256', 'created_utc'];
  if (Object.keys(item).length !== expected.length || expected.some((key) => !Object.hasOwn(item, key))) return null;
  return item.schema === 'figment/studio-gen-plan-marker@1'
    && typeof item.id === 'string' && ID.test(item.id)
    && typeof item.plan_sha256 === 'string' && SHA256.test(item.plan_sha256)
    && typeof item.intent_sha256 === 'string' && SHA256.test(item.intent_sha256)
    && typeof item.created_utc === 'string' && item.created_utc.length === 24
    && Number.isFinite(Date.parse(item.created_utc))
    && new Date(item.created_utc).toISOString() === item.created_utc ? item as unknown as Marker : null;
}
async function publishMarker(path: string, content: string): Promise<void> {
  const handle = await open(path, 'wx');
  try { await handle.writeFile(content); await handle.sync(); }
  finally { await handle.close(); }
}

export function registerFigmentStudioGenPlan(app: FastifyInstance, options: StudioGenPlanOptions): void {
  const repoRoot = resolve(options.repoRoot);
  const ledgerDir = resolve(options.ledgerDir);
  const script = join(repoRoot, 'orgs', 'figment', 'pipeline', 'figment_train.py');
  const plansRoot = join(repoRoot, '_private', 'figment-studio', 'gen-plans');
  const python = resolvePython(options.platform ?? process.platform);
  const run = options.runStudioGenPlan ?? runStudioPlanProcess;
  const publish = options.publishMarker ?? publishMarker;
  let active = false;
  let terminationUncertain = false;
  app.post('/api/figment/studio/gen-plan', { preHandler: requireSession(options.sessionConfig) }, async (request, reply) => {
    if (request.body !== undefined) return reply.code(400).send({ error: 'body-not-allowed' });
    const intent = request.headers['idempotency-key'];
    if (typeof intent !== 'string' || !INTENT.test(intent)) return reply.code(400).send({ error: 'invalid-idempotency-key' });
    // Resolve the verified subject before any mutation; the intent is bound to it.
    const session = verifiedSession(request);
    if (session === undefined) return reply.code(401).send({ error: 'missing-session' });
    if (terminationUncertain) return reply.code(503).send({ error: 'preparation-unavailable' });
    if (active) return reply.code(429).send({ error: 'preparation-busy' });
    active = true;
    const intentSha = sha256(JSON.stringify([session.claims.sub, intent]));
    let root: SafeRoot | null = null;
    let allocated: string | null = null;
    const cleanup = async (): Promise<void> => {
      if (terminationUncertain || root === null || allocated === null || !ID.test(basename(allocated))) return;
      try {
        if (await safePath(root, plansRoot, 'directory') === null
          || await safePath(root, allocated, 'directory') === null
          || await entryExists(join(allocated, 'published.json'))) return;
        await rm(allocated, { recursive: true, force: true });
      } catch { request.log.error('Figment generation-plan cleanup failed'); }
    };
    try {
      root = await safeRoot(repoRoot);
      if (root === null || await safePath(root, script, 'file') === null
        || await safePath(root, ledgerDir, 'directory') === null
        || !await safeProspective(root, plansRoot)) throw new Error('unsafe-root');
      await mkdir(plansRoot, { recursive: true });
      const rootBytes = await sizeOf(root, plansRoot);
      if (rootBytes === null || rootBytes > MAX_ROOT_BYTES) throw new Error('unsafe-capacity');
      let published = 0;
      let unmarked = false;
      let replay: { saved: Marker; directory: string } | null = null;
      const entries = await opendir(plansRoot);
      let count = 0;
      for await (const entry of entries) {
        if (++count > MAX_ENTRIES || !entry.isDirectory() || !ID.test(entry.name)) throw new Error('unsafe-plan-entry');
        const directory = join(plansRoot, entry.name);
        const bytes = await sizeOf(root, directory);
        if (bytes === null || bytes > MAX_TREE_BYTES) throw new Error('unsafe-plan-entry');
        const markerName = join(directory, 'published.json');
        if (!await entryExists(markerName)) { unmarked = true; continue; }
        const markerPath = await safePath(root, markerName, 'file');
        const raw = markerPath === null ? null : await readBounded(markerPath);
        const saved = raw === null ? null : marker(JSON.parse(raw.toString('utf8')));
        if (saved === null || saved.id !== entry.name) throw new Error('bad-marker');
        published += 1;
        if (saved.intent_sha256 === intentSha) {
          if (replay !== null) throw new Error('duplicate-intent');
          replay = { saved, directory };
        }
      }
      if (published > MAX_PUBLISHED) throw new Error('capacity');
      if (replay !== null) {
        const planPath = await safePath(root, join(replay.directory, 'plan.json'), 'file');
        const raw = planPath === null ? null : await readBounded(planPath);
        if (raw === null || sha256(raw) !== replay.saved.plan_sha256) return reply.code(409).send({ error: 'idempotency-conflict' });
        const prepared = summary(JSON.parse(raw.toString('utf8')), replay.saved.id, replay.saved.plan_sha256);
        if (prepared === null) return reply.code(409).send({ error: 'idempotency-conflict' });
        // A prior audit may have failed after publication: audit again (at least
        // once, same stable id) so a replay never becomes unaudited success.
        await options.auditPrepared?.(session.claims.sub, prepared.id, prepared.planSha256);
        return prepared;
      }
      // An unmarked allocation survives only when its runner's termination was
      // uncertain or cleanup failed, possibly in an earlier process. Nothing
      // proves that process is gone, so refuse new dispatch; recovery remains
      // explicit operator work.
      if (unmarked) throw new Error('unmarked-allocation');
      if (published >= MAX_PUBLISHED) throw new Error('capacity');
      const id = randomUUID();
      allocated = join(plansRoot, id);
      if (!await safeProspective(root, allocated)) throw new Error('unsafe-allocation');
      await mkdir(allocated);
      if (await safePath(root, allocated, 'directory') === null) throw new Error('unsafe-allocation');
      await run(python.command, [...python.prefixArgs, script, 'plan', '--creator', CREATOR,
        '--stage', STAGE, '--out', allocated, '--ledger-dir', ledgerDir], {
        cwd: repoRoot, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true,
      });
      const planPath = await safePath(root, join(allocated, 'plan.json'), 'file');
      const raw = planPath === null ? null : await readBounded(planPath);
      if (raw === null) throw new Error('missing-plan');
      const planSha256 = sha256(raw);
      const prepared = summary(JSON.parse(raw.toString('utf8')), id, planSha256);
      const bytes = await sizeOf(root, allocated);
      const finalRootBytes = await sizeOf(root, plansRoot);
      if (prepared === null || bytes === null || bytes > MAX_TREE_BYTES
        || finalRootBytes === null || finalRootBytes > MAX_ROOT_BYTES) throw new Error('invalid-plan');
      const publishedMarker: Marker = { schema: 'figment/studio-gen-plan-marker@1', id,
        plan_sha256: planSha256, intent_sha256: intentSha, created_utc: new Date().toISOString() };
      if (await safePath(root, allocated, 'directory') === null) throw new Error('unsafe-publication');
      await publish(join(allocated, 'published.json'), JSON.stringify(publishedMarker));
      allocated = null;
      await options.auditPrepared?.(session.claims.sub, id, planSha256);
      return prepared;
    } catch (error) {
      if (error instanceof StudioPlanProcessError && error.terminationUncertain) terminationUncertain = true;
      request.log.warn({ failure: error instanceof Error ? error.name : 'failed' }, 'Figment generation-plan preparation unavailable');
      // Fastify can expose reply.send() before an async finally completes.
      // Finish owned cleanup before the failure response becomes observable.
      await cleanup();
      return reply.code(503).send({ error: 'preparation-unavailable' });
    } finally {
      active = false;
    }
  });
}
