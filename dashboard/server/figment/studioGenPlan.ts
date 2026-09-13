/** Durable, provider-free preparation of one current Figment generation plan. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireSession, verifiedSession } from '../http/middleware.ts';
import type { SessionConfig } from '../auth/session.ts';
import { resolvePython } from '../runtime/python.ts';
import { runStudioPlanProcess, StudioPlanProcessError } from './studioPlanProcess.ts';
import { collectPreparedGenStatus, type PreparedGenStatus } from './cloudExperiment.ts';
import { collectStudioAssignmentRecords, type StudioAssignmentRecord, type StudioPlanIdentity } from './contentBriefs.ts';
import {
  ID, MAX_PUBLISHED, assertInventoryRoots, assertPublishedStudioCapacity, entryExists,
  publishedPlan, readBounded, readPublishedStudioPlans, safePath, safeProspective, safeRoot,
  studioPlanRoots, summary, type Marker, type PublishedObservations, type SafeRoot, type StudioGenPlan,
} from './studioPublishedPlans.ts';

const CREATOR = 'creator-001';
const STAGE = 'gen';
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 16 * 1024;
const INTENT = /^[A-Za-z0-9_-]{32,64}$/;

export type { StudioGenPlan } from './studioPublishedPlans.ts';
export type StudioPreparation = 'available' | 'busy' | 'at-capacity' | 'maintenance-required' | 'unavailable';
/** Discovery read: prepared plans are existing POST DTOs, never approval or launch authority. */
export interface StudioGenPlans {
  schema: 'figment/studio-gen-plans@3'; requestScope: string; plans: StudioGenPlan[]; preparation: StudioPreparation;
  executionRecords: Array<{ id: string; planSha256: string; state: PreparedGenStatus }>;
  assignmentRecords: StudioAssignmentRecord[];
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
function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
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
  const { legacy: legacyRoot, allocation: plansRoot } = studioPlanRoots(repoRoot);
  const python = resolvePython(options.platform ?? process.platform);
  const run = options.runStudioGenPlan ?? runStudioPlanProcess;
  const publish = options.publishMarker ?? publishMarker;
  let active = false;
  let started = 0;
  let terminationUncertain = false;
  // Nonsecret continuity identifier for browser intent records, never authorization.
  const requestScope = (subject: string): string =>
    sha256(JSON.stringify(['figment-studio-request-scope@1', repoRoot, subject]));
  const openRoot = async (): Promise<SafeRoot> => {
    const root = await safeRoot(repoRoot);
    if (root === null || await safePath(root, script, 'file') === null
      || await safePath(root, ledgerDir, 'directory') === null
      || !await safeProspective(root, plansRoot)
      || !await safeProspective(root, legacyRoot)) throw new Error('unsafe-root');
    return root;
  };
  // Read-only discovery: no mkdir, spawn, audit, deletion, or uncertainty reset.
  app.get('/api/figment/studio/gen-plans', { preHandler: requireSession(options.sessionConfig), exposeHeadRoute: false }, async (request, reply) => {
    if ((request.raw.url ?? '').includes('?')) return reply.code(400).send({ error: 'query-not-allowed' });
    const length = request.headers['content-length'];
    if (request.body !== undefined || request.headers['transfer-encoding'] !== undefined
      || (length !== undefined && length !== '0')) return reply.code(400).send({ error: 'body-not-allowed' });
    const session = verifiedSession(request);
    if (session === undefined) return reply.code(401).send({ error: 'missing-session' });
    const view = (preparation: StudioPreparation, plans: StudioGenPlan[] = [], executionRecords: StudioGenPlans['executionRecords'] = [], assignmentRecords: StudioAssignmentRecord[] = []): StudioGenPlans =>
      ({ schema: 'figment/studio-gen-plans@3', requestScope: requestScope(session.claims.sub), plans, preparation, executionRecords, assignmentRecords });
    if (active) return view('busy');
    const generation = started;
    let result: StudioGenPlans;
    try {
      const root = await openRoot();
      const observations: PublishedObservations = [];
      const inventory = await readPublishedStudioPlans(root, observations);
      const plans: StudioGenPlan[] = [];
      const identities: StudioPlanIdentity[] = [];
      const executionRecords: StudioGenPlans['executionRecords'] = [];
      for (const entry of inventory.published) {
        const prepared = await publishedPlan(root, entry, observations);
        if (prepared === null) throw new Error('stale-plan');
        plans.push(prepared);
        const authorityPath = relative(join(repoRoot, 'orgs', 'figment'), join(entry.directory, 'plan.json'));
        identities.push({ id: prepared.id, planSha256: prepared.planSha256, creator: prepared.creator,
          authorityRelativePlanPath: isAbsolute(authorityPath) || authorityPath === '..' || authorityPath.startsWith(`..${sep}`)
            ? null : authorityPath.split(sep).join('/') });
        executionRecords.push({ id: prepared.id, planSha256: prepared.planSha256,
          state: collectPreparedGenStatus(entry.directory, entry.saved.plan_sha256) });
      }
      let capacityAvailable = true;
      try { await assertPublishedStudioCapacity(root, inventory); }
      catch { capacityAvailable = false; }
      await assertInventoryRoots(root, inventory);
      let assignmentRecords = collectStudioAssignmentRecords(repoRoot, identities);
      const after = await readPublishedStudioPlans(root);
      const signature = (value: typeof inventory): string => JSON.stringify({ ...value,
        directories: [...value.directories].sort(), roots: [...value.roots].sort() });
      if (signature(after) !== signature(inventory)) throw new Error('changed-inventory');
      for (const entry of after.published) if (await publishedPlan(root, entry) === null) throw new Error('stale-plan');
      for (const unchanged of observations) if (!await unchanged()) throw new Error('changed-published-file');
      result = view(terminationUncertain || inventory.unmarked || !capacityAvailable ? 'maintenance-required'
        : plans.length >= MAX_PUBLISHED ? 'at-capacity' : 'available', plans, executionRecords, assignmentRecords);
      const encoded = JSON.stringify(result);
      if (encoded.length > 65536 || Buffer.byteLength(encoded, 'utf8') > 65536) {
        assignmentRecords = assignmentRecords.map((record) => ({ id: record.id, planSha256: record.planSha256,
          state: { status: 'unavailable', reason: record.state.status === 'unavailable' ? record.state.reason : 'evidence-unavailable' } }));
        result = { ...result, assignmentRecords };
      }
    } catch {
      request.log.warn('Figment generation-plan discovery unavailable');
      result = view('unavailable');
    }
    // A preparation that started during the scan may have allocated mid-read.
    return active || started !== generation ? view('busy') : result;
  });
  app.post('/api/figment/studio/gen-plan', { preHandler: requireSession(options.sessionConfig) }, async (request, reply) => {
    if (request.body !== undefined) return reply.code(400).send({ error: 'body-not-allowed' });
    const intent = request.headers['idempotency-key'];
    if (typeof intent !== 'string' || !INTENT.test(intent)) return reply.code(400).send({ error: 'invalid-idempotency-key' });
    // Resolve the verified subject before any mutation; the intent is bound to it.
    const session = verifiedSession(request);
    if (session === undefined) return reply.code(401).send({ error: 'missing-session' });
    // Optional for existing controlled clients; when present it must match before any replay or allocation.
    const scope = request.headers['x-figment-intent-scope'];
    if (scope !== undefined && scope !== requestScope(session.claims.sub)) return reply.code(409).send({ error: 'intent-scope-conflict' });
    if (terminationUncertain) return reply.code(503).send({ error: 'preparation-unavailable' });
    if (active) return reply.code(429).send({ error: 'preparation-busy' });
    active = true;
    started += 1;
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
      root = await openRoot();
      const inventory = await readPublishedStudioPlans(root);
      await assertPublishedStudioCapacity(root, inventory);
      const { published, unmarked } = inventory;
      const replays = published.filter((entry) => entry.saved.intent_sha256 === intentSha);
      if (replays.length > 1) throw new Error('duplicate-intent');
      if (replays.length === 1) {
        const prepared = await publishedPlan(root, replays[0]);
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
      if (published.length >= MAX_PUBLISHED) throw new Error('capacity');
      await mkdir(plansRoot, { recursive: true });
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
      if (prepared === null) throw new Error('invalid-plan');
      const finalInventory = await readPublishedStudioPlans(root);
      await assertPublishedStudioCapacity(root, finalInventory);
      if (finalInventory.published.length >= MAX_PUBLISHED
        || finalInventory.published.some((entry) => entry.saved.id === id || entry.saved.intent_sha256 === intentSha)
        || finalInventory.directories.some((directory) => directory !== allocated
          && !finalInventory.published.some((entry) => entry.directory === directory))) throw new Error('changed-inventory');
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
