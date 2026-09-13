/** Shared bounded metadata index for current and legacy Studio preparations. */
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const CREATOR = 'creator-001';
const STAGE = 'gen';
const MAX_PLAN_BYTES = 64 * 1024;
const MAX_TREE_BYTES = 256 * 1024 * 1024;
const MAX_ROOT_BYTES = 512 * 1024 * 1024;
export const MAX_PUBLISHED = 2;
const MAX_ENTRIES = 2048;
const MAX_DEPTH = 16;
const SHA256 = /^[a-f0-9]{64}$/;
export const ID = /^[0-9a-f-]{36}$/;
export interface StudioGenPlan {
  schema: 'figment/studio-gen-plan@1'; id: string; status: 'prepared'; creator: 'creator-001'; stage: 'gen';
  runCount: 1; declaredCeilingUsd: number; planSha256: string;
}
export interface SafeRoot { path: string; real: string; }
export interface Marker { schema: 'figment/studio-gen-plan-marker@1'; id: string; plan_sha256: string; intent_sha256: string; created_utc: string; }
export interface Published { saved: Marker; directory: string; }
export interface Inventory { published: Published[]; unmarked: boolean; directories: string[]; roots: string[]; }
export type PublishedObservations = Array<() => Promise<boolean>>;

/** Both locations are server-owned; only the Figment-contained root accepts new plans. */
export function studioPlanRoots(repoRoot: string): { legacy: string; allocation: string } {
  return {
    legacy: join(repoRoot, '_private', 'figment-studio', 'gen-plans'),
    allocation: join(repoRoot, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans'),
  };
}

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
export async function safeRoot(path: string): Promise<SafeRoot | null> {
  try {
    const absolute = resolve(path);
    const info = await lstat(absolute);
    return info.isDirectory() && !info.isSymbolicLink()
      ? { path: absolute, real: await realpath(absolute) } : null;
  } catch { return null; }
}
export async function currentRoot(root: SafeRoot): Promise<boolean> {
  const current = await safeRoot(root.path);
  return current !== null && current.real === root.real;
}
export async function safePath(root: SafeRoot, candidate: string, kind: 'file' | 'directory'): Promise<string | null> {
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
export async function safeProspective(root: SafeRoot, candidate: string): Promise<boolean> {
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
export async function entryExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
function sameFile(a: Stats, b: Stats): boolean {
  return a.isFile() && b.isFile() && !a.isSymbolicLink() && !b.isSymbolicLink()
    && a.dev === b.dev && a.ino === b.ino && a.size === b.size
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
async function readBoundedRecord(path: string): Promise<{ bytes: Buffer; identity: Stats } | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const namedBefore = await lstat(path);
    handle = await open(path, 'r');
    const before = await handle.stat();
    if (!sameFile(before, namedBefore) || before.size < 1 || before.size > MAX_PLAN_BYTES) return null;
    const value = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < value.length) {
      const read = await handle.read(value, offset, value.length - offset, offset);
      if (read.bytesRead < 1) return null;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    const namedAfter = await lstat(path);
    return sameFile(before, after) && sameFile(before, namedAfter) ? { bytes: value, identity: before } : null;
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}
export async function readBounded(path: string): Promise<Buffer | null> {
  return (await readBoundedRecord(path))?.bytes ?? null;
}
async function readObserved(root: SafeRoot, path: string, observations?: PublishedObservations): Promise<Buffer | null> {
  if (await safePath(root, path, 'file') === null) return null;
  const original = await readBoundedRecord(path);
  if (original === null) return null;
  observations?.push(async () => {
    if (await safePath(root, path, 'file') === null) return false;
    const current = await readBoundedRecord(path);
    return current !== null && sameFile(original.identity, current.identity) && original.bytes.equals(current.bytes);
  });
  return original.bytes;
}
export function summary(value: unknown, id: string, planSha256: string): StudioGenPlan | null {
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
/** Bounded metadata discovery; recursive capacity failures do not hide safe published summaries. */
async function scanPlanMarkers(root: SafeRoot, plansRoot: string, observations?: PublishedObservations): Promise<Inventory> {
  if (await safePath(root, plansRoot, 'directory') === null) throw new Error('unsafe-root');
  const published: Published[] = [];
  const directories: string[] = [];
  let unmarked = false;
  const entries = await opendir(plansRoot);
  let count = 0;
  for await (const entry of entries) {
    if (++count > MAX_ENTRIES || !entry.isDirectory() || !ID.test(entry.name)) throw new Error('unsafe-plan-entry');
    const directory = join(plansRoot, entry.name);
    if (await safePath(root, directory, 'directory') === null) throw new Error('unsafe-plan-entry');
    directories.push(directory);
    const markerName = join(directory, 'published.json');
    if (!await entryExists(markerName)) { unmarked = true; continue; }
    const markerPath = await safePath(root, markerName, 'file');
    const raw = markerPath === null ? null : await readObserved(root, markerPath, observations);
    const saved = raw === null ? null : marker(JSON.parse(raw.toString('utf8')));
    if (saved === null || saved.id !== entry.name) throw new Error('bad-marker');
    published.push({ saved, directory });
  }
  if (published.length > MAX_PUBLISHED) throw new Error('capacity');
  return { published, unmarked, directories, roots: [plansRoot] };
}

/** Recheck both fixed root locations, including roots that were absent at collection. */
export async function assertInventoryRoots(root: SafeRoot, inventory: Inventory): Promise<void> {
  for (const path of Object.values(studioPlanRoots(root.path))) {
    if (!await safeProspective(root, path)) throw new Error('unsafe-root');
    const exists = await entryExists(path);
    if (exists !== inventory.roots.includes(path)
      || (exists && await safePath(root, path, 'directory') === null)) throw new Error('changed-root');
  }
}

/** One bounded marker index, with global identity/count limits across old and new locations. */
export async function readPublishedStudioPlans(root: SafeRoot, observations?: PublishedObservations): Promise<Inventory> {
  const result: Inventory = { published: [], unmarked: false, directories: [], roots: [] };
  const ids = new Set<string>();
  const intents = new Set<string>();
  for (const path of Object.values(studioPlanRoots(root.path))) {
    if (!await safeProspective(root, path)) throw new Error('unsafe-root');
    if (!await entryExists(path)) continue;
    const inventory = await scanPlanMarkers(root, path, observations);
    result.roots.push(path);
    result.unmarked ||= inventory.unmarked;
    result.directories.push(...inventory.directories);
    if (result.directories.length > MAX_ENTRIES) throw new Error('unsafe-plan-entry');
    for (const entry of inventory.published) {
      if (ids.has(entry.saved.id) || intents.has(entry.saved.intent_sha256)) throw new Error('duplicate-plan-identity');
      ids.add(entry.saved.id);
      intents.add(entry.saved.intent_sha256);
      result.published.push(entry);
      if (result.published.length > MAX_PUBLISHED) throw new Error('capacity');
    }
  }
  result.published.sort((a, b) => a.saved.created_utc.localeCompare(b.saved.created_utc)
    || a.saved.id.localeCompare(b.saved.id));
  await assertInventoryRoots(root, result);
  return result;
}

/** Original per-tree/unsafe-descendant guards, with a single total across both roots. */
export async function assertPublishedStudioCapacity(root: SafeRoot, inventory: Inventory): Promise<void> {
  await assertInventoryRoots(root, inventory);
  let total = 0;
  for (const path of inventory.roots) {
    const rootBytes = await sizeOf(root, path);
    if (rootBytes === null || (total += rootBytes) > MAX_ROOT_BYTES) throw new Error('unsafe-capacity');
  }
  for (const directory of inventory.directories) {
    const bytes = await sizeOf(root, directory);
    if (bytes === null || bytes > MAX_TREE_BYTES) throw new Error('unsafe-plan-entry');
  }
  await assertInventoryRoots(root, inventory);
}
/** The published summary, only when the plan bytes still hash to the marker. */
export async function publishedPlan(root: SafeRoot, entry: Published, observations?: PublishedObservations): Promise<StudioGenPlan | null> {
  const planPath = await safePath(root, join(entry.directory, 'plan.json'), 'file');
  const raw = planPath === null ? null : await readObserved(root, planPath, observations);
  if (raw === null || sha256(raw) !== entry.saved.plan_sha256) return null;
  return summary(JSON.parse(raw.toString('utf8')), entry.saved.id, entry.saved.plan_sha256);
}
