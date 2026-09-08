/** A fixed, offline-only tester-plan preview. It never exposes or executes a planned argv. */
import { execFile as execFileCallback } from 'node:child_process';
import { lstat, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { resolvePython } from '../runtime/python.ts';

const execFile = promisify(execFileCallback);
const CREATOR = 'creator-001';
const STAGE = 'tester';
const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_PLAN_BYTES = 64 * 1024;
const MAX_CEILING_USD = 50;
const SHA256 = /^[a-f0-9]{64}$/;

export interface TesterPreview {
  schema: 'figment/plan-preview@1';
  offlinePreview: true;
  notPromotable: true;
  creator: 'creator-001';
  stage: 'tester';
  runCount: number;
  declaredCeilingUsd: number;
  manifestSha256: string;
}

export interface PreviewRunOptions { cwd: string; timeout: number; maxBuffer: number; windowsHide: boolean; }
export type RunTesterPreview = (command: string, args: readonly string[], options: PreviewRunOptions) => Promise<unknown>;

export interface PlanPreviewOptions {
  repoRoot: string;
  runTesterPreview?: RunTesterPreview;
  platform?: NodeJS.Platform;
}

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}

interface SafeRoot { path: string; real: string; }

async function openSafeRoot(path: string): Promise<SafeRoot | null> {
  try {
    const absolute = resolve(path); const info = await lstat(absolute);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    return { path: absolute, real: await realpath(absolute) };
  } catch { return null; }
}

/** Refuse every existing link/reparse ancestor before a fixed-path read, run, or deletion. */
async function safePath(root: SafeRoot, candidate: string, kind: 'file' | 'directory'): Promise<string | null> {
  const absolute = resolve(candidate);
  if (!inside(root.path, absolute)) return null;
  try {
    let cursor = root.path;
    for (const segment of relative(root.path, absolute).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, segment);
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) return null;
    }
    const info = await lstat(absolute);
    if ((kind === 'file' ? !info.isFile() : !info.isDirectory()) || info.isSymbolicLink()) return null;
    return inside(root.real, await realpath(absolute)) ? absolute : null;
  } catch { return null; }
}

/** Before mkdir, every existing ancestor must already be a real directory under the configured root. */
async function safeProspectiveDirectory(root: SafeRoot, candidate: string): Promise<boolean> {
  const absolute = resolve(candidate);
  if (!inside(root.path, absolute)) return false;
  try {
    let cursor = root.path;
    for (const segment of relative(root.path, absolute).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, segment);
      try {
        const info = await lstat(cursor);
        if (!info.isDirectory() || info.isSymbolicLink()) return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
        return false;
      }
    }
    return true;
  } catch { return false; }
}

async function readBoundedPlan(path: string): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    const before = await handle.stat();
    if (!before.isFile() || before.size < 0 || before.size > MAX_PLAN_BYTES) return null;
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead <= 0) return null;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    return after.isFile() && after.size === before.size ? bytes : null;
  } catch { return null; } finally { if (handle !== null) { try { await handle.close(); } catch { /* invalidates nothing already rejected */ } } }
}

function previewSummary(value: unknown): TesterPreview | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  if (plan.schema !== 'figment/train-plan@1' || plan.creator !== CREATOR || typeof plan.stages !== 'object' || plan.stages === null || Array.isArray(plan.stages)) return null;
  const stages = plan.stages as Record<string, unknown>;
  if (Object.keys(stages).length !== 1 || !Object.hasOwn(stages, STAGE) || typeof stages[STAGE] !== 'object' || stages[STAGE] === null || Array.isArray(stages[STAGE])) return null;
  const runs = (stages[STAGE] as Record<string, unknown>).runs;
  // The fixed tester planner emits exactly one planned job. More would be an unexpected
  // driver shape, not an opportunity to widen this small preview surface.
  if (!Array.isArray(runs) || runs.length !== 1) return null;
  let declaredCeilingUsd = 0; let manifestSha256: string | null = null;
  for (const run of runs) {
    if (typeof run !== 'object' || run === null || Array.isArray(run)) return null;
    const row = run as Record<string, unknown>;
    const ceiling = typeof row.ceiling_usd === 'number' ? row.ceiling_usd : typeof row.ceiling_usd === 'string' && /^\d+(?:\.\d{1,2})?$/.test(row.ceiling_usd) ? Number(row.ceiling_usd) : NaN;
    if (!Number.isFinite(ceiling) || ceiling < 0 || !SHA256.test(String(row.sha256 ?? '')) || !Number.isFinite(declaredCeilingUsd + ceiling) || declaredCeilingUsd + ceiling > MAX_CEILING_USD) return null;
    declaredCeilingUsd += ceiling;
    manifestSha256 ??= row.sha256 as string;
  }
  if (manifestSha256 === null) return null;
  return { schema: 'figment/plan-preview@1', offlinePreview: true, notPromotable: true, creator: CREATOR, stage: STAGE, runCount: runs.length, declaredCeilingUsd, manifestSha256 };
}

function defaultRunner(command: string, args: readonly string[], options: PreviewRunOptions): Promise<unknown> {
  return execFile(command, args, options);
}

function failureCode(error: unknown): 'timeout' | 'output-cap' | 'failed' {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined;
  return code === 'ETIMEDOUT' ? 'timeout' : code === 'ENOBUFS' ? 'output-cap' : 'failed';
}

/** Registers the sole planning write-like action: a fixed, non-persistent offline tester preview. */
export function registerFigmentTesterPreview(app: FastifyInstance, options: PlanPreviewOptions): void {
  const repoRoot = resolve(options.repoRoot);
  const script = join(repoRoot, 'orgs', 'figment', 'pipeline', 'figment_train.py');
  const previewRoot = join(repoRoot, '_private', 'figment-plan-preview');
  const run = options.runTesterPreview ?? defaultRunner;
  const python = resolvePython(options.platform ?? process.platform);
  let active = false;
  app.post('/api/figment/plan-preview/tester', async (request, reply) => {
    if (request.body !== undefined) return reply.code(400).send({ error: 'body-not-allowed' });
    if (active) return reply.code(429).send({ error: 'preview-busy' });
    active = true;
    let temporary: string | null = null;
    let root: SafeRoot | null = null;
    const cleanup = async (): Promise<void> => {
      if (root === null || temporary === null || !basename(temporary).startsWith('tester-') || await safePath(root, previewRoot, 'directory') === null || await safePath(root, temporary, 'directory') === null) return;
      const target = temporary; temporary = null;
      try { await rm(target, { recursive: true, force: true }); } catch { request.log.error('offline Figment tester preview cleanup failed'); }
    };
    try {
      root = await openSafeRoot(repoRoot);
      if (root === null || await safePath(root, script, 'file') === null || !await safeProspectiveDirectory(root, previewRoot)) throw new Error('unsafe-root');
      await mkdir(previewRoot, { recursive: true });
      if (await safePath(root, previewRoot, 'directory') === null) throw new Error('unsafe-preview-root');
      temporary = await mkdtemp(join(previewRoot, 'tester-'));
      if (basename(temporary).length <= 'tester-'.length || await safePath(root, temporary, 'directory') === null) throw new Error('unsafe-temporary');
      const args = [...python.prefixArgs, script, 'plan', '--creator', CREATOR, '--stage', STAGE, '--out', temporary, '--skip-pin-verify'];
      await run(python.command, args, { cwd: repoRoot, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true });
      const planPath = await safePath(root, join(temporary, 'plan.json'), 'file');
      const bytes = planPath === null ? null : await readBoundedPlan(planPath);
      if (bytes === null) throw new Error('missing-plan');
      let plan: unknown;
      try { plan = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('malformed-plan'); }
      const summary = previewSummary(plan);
      if (summary === null) throw new Error('invalid-plan-summary');
      return summary;
    } catch (error) {
      request.log.warn({ failure: failureCode(error) }, 'offline Figment tester preview unavailable');
      await cleanup();
      return reply.code(503).send({ error: 'preview-unavailable' });
    } finally {
      active = false;
      await cleanup();
    }
  });
}
