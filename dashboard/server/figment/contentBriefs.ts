/** Fixed-repository, read-only projection of offline Figment content briefs. */
import { closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_JSON_BYTES = 256 * 1024, MAX_DEPTH = 32, MAX_ENTRIES = 64, MAX_SLOTS = 16, MAX_SOURCES = 16;
const MAX_TEXT = 4096, MAX_ID = 128;
const BRIEF_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, CREATOR_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/, TAXONOMY_TYPE = /^[A-Z][A-Z0-9-]{0,15}$/;
const FORBIDDEN_KEY = /(approv|accept|decision|promot|publish|post)/i;

interface Root { path: string; real: string; }
export interface ContentBriefItem {
  briefId: string;
  briefDate: string;
  creatorId: string;
  surface: 'carousel' | 'reel';
  templateId: string;
  requiredAssetCount: number;
  requiredAssetSlots: Array<{ role: string; kind: 'persona' | 'nonpersona' }>;
  hypothesis: string;
  intendedMetric: string;
  sourceCount: number;
  sourceDates: string[];
  observedMetrics: null;
  renderAs: 'text';
}
export type ContentBriefsProjection =
  | { status: 'not-configured'; items: [] }
  | { status: 'empty'; recordKind: 'planning-snapshot'; currentSourceRevalidated: false; items: [] }
  | { status: 'unavailable'; reason: 'evidence-unavailable'; items: [] }
  | { status: 'recorded'; recordKind: 'planning-snapshot'; currentSourceRevalidated: false; items: ContentBriefItem[] };

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function inside(root: string, candidate: string): boolean { const value = relative(root, candidate); return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value)); }
function reparse(path: string): boolean { try { const info = lstatSync(path), real = realpathSync(path); return info.isSymbolicLink() || resolve(real) !== resolve(path); } catch { return true; } }
function openRoot(value: unknown): Root | null {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value)) return null;
  try { const path = resolve(value); return lstatSync(path).isDirectory() && !reparse(path) ? { path, real: realpathSync(path) } : null; } catch { return null; }
}
function childRoot(parent: Root, name: string): Root | null {
  const path = resolve(parent.path, name); if (!inside(parent.path, path)) return null;
  try {
    let cursor = parent.path;
    for (const segment of relative(parent.path, path).split(/[\\/]/).filter(Boolean)) { cursor = join(cursor, segment); if (reparse(cursor)) return null; }
    return lstatSync(path).isDirectory() && inside(parent.real, realpathSync(path)) ? { path, real: realpathSync(path) } : null;
  } catch { return null; }
}
function file(parent: Root, name: string): string | null {
  const path = resolve(parent.path, name); if (!inside(parent.path, path)) return null;
  try {
    let cursor = parent.path;
    for (const segment of relative(parent.path, path).split(/[\\/]/).filter(Boolean)) { cursor = join(cursor, segment); if (reparse(cursor)) return null; }
    return lstatSync(path).isFile() && inside(parent.real, realpathSync(path)) ? path : null;
  } catch { return null; }
}
function absent(parent: Root, name: string): boolean {
  const path = resolve(parent.path, name); if (!inside(parent.path, path)) return false;
  let cursor = parent.path;
  for (const segment of relative(parent.path, path).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, segment);
    try { const info = lstatSync(cursor); if (info.isSymbolicLink() || resolve(realpathSync(cursor)) !== resolve(cursor)) return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
  }
  return false;
}
function sameFile(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean { return left.isFile() && right.isFile() && left.size === right.size && left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs; }
function bounded(path: string): Buffer | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, 'r'); const before = fstatSync(descriptor), namedBefore = lstatSync(path);
    if (!sameFile(before, namedBefore) || before.size < 1 || before.size > MAX_JSON_BYTES) return null;
    const bytes = Buffer.allocUnsafe(before.size);
    for (let offset = 0; offset < bytes.length;) { const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset); if (count <= 0) return null; offset += count; }
    const after = fstatSync(descriptor), namedAfter = lstatSync(path);
    return sameFile(before, after) && sameFile(before, namedAfter) ? bytes : null;
  } catch { return null; } finally { if (descriptor !== null) try { closeSync(descriptor); } catch { /* failed reads stay unavailable */ } }
}
function shallow(source: string): boolean {
  let depth = 0, quoted = false, escaped = false;
  for (const character of source) {
    if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; continue; }
    if (character === '"') quoted = true;
    else if (character === '{' || character === '[') { depth += 1; if (depth > MAX_DEPTH) return false; }
    else if (character === '}' || character === ']') { depth -= 1; if (depth < 0) return false; }
  }
  return !quoted && depth === 0;
}
function plain(value: string): boolean { for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); if (code < 32 || code === 127) return false; } return true; }
function text(value: unknown, maximum = MAX_TEXT): string | null { return typeof value === 'string' && value.length > 0 && value.length <= maximum && plain(value) ? value : null; }
function date(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!object(value)) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || hasForbiddenKey(child));
}
function snapshotRef(value: unknown): boolean {
  if (!object(value) || typeof value.path !== 'string' || value.path.length < 1 || value.path.length > 512 || !plain(value.path) || typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)) return false;
  return !isAbsolute(value.path) && !value.path.includes('\\') && value.path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}
function contentBrief(value: unknown, briefId: string): ContentBriefItem | null {
  if (!object(value) || hasForbiddenKey(value) || value.schema !== 'figment/content-brief@1' || !Object.prototype.hasOwnProperty.call(value, 'observed_metrics') || value.observed_metrics !== null) return null;
  const briefDate = date(value.brief_date), creator = object(value.creator) ? value.creator : null, content = object(value.content) ? value.content : null;
  const creatorId = creator === null ? null : text(creator.id, 80), hypothesis = text(value.hypothesis), intendedMetric = text(value.intended_metric);
  if (briefDate === null || creatorId === null || !CREATOR_ID.test(creatorId) || creator === null || !snapshotRef(creator.persona) || !object(creator.canonical_reference) || !snapshotRef(creator.canonical_reference) || typeof creator.canonical_reference.declared_path !== 'string' || content === null || hypothesis === null || intendedMetric === null) return null;
  const surface = content.surface, templateId = text(content.template_id, 16);
  if ((surface !== 'carousel' && surface !== 'reel') || templateId === null || (surface === 'carousel' ? !/^CT-[1-7]$/.test(templateId) : !/^RT-[1-6]$/.test(templateId)) || typeof content.template_sha256 !== 'string' || !SHA256.test(content.template_sha256) || typeof content.taxonomy_sha256 !== 'string' || !SHA256.test(content.taxonomy_sha256)) return null;
  if (!Array.isArray(content.required_asset_slots) || content.required_asset_slots.length < 1 || content.required_asset_slots.length > MAX_SLOTS) return null;
  const slots: ContentBriefItem['requiredAssetSlots'] = [];
  for (const [index, row] of content.required_asset_slots.entries()) {
    if (!object(row) || row.index !== index + 1 || (row.kind !== 'persona' && row.kind !== 'nonpersona') || typeof row.taxonomy_type !== 'string' || !TAXONOMY_TYPE.test(row.taxonomy_type)) return null;
    const role = text(row.role, 80); if (role === null) return null;
    slots.push({ role, kind: row.kind });
  }
  if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > MAX_SOURCES) return null;
  const sourceDates: string[] = [];
  for (const source of value.sources) {
    if (!object(source)) return null;
    const citation = text(source.citation, 2048), observedDate = date(source.observed_date);
    if (citation === null || !citation.startsWith('https://') || observedDate === null) return null;
    sourceDates.push(observedDate);
  }
  return { briefId, briefDate, creatorId, surface, templateId, requiredAssetCount: slots.length, requiredAssetSlots: slots, hypothesis, intendedMetric, sourceCount: sourceDates.length, sourceDates, observedMetrics: null, renderAs: 'text' };
}
function entries(root: Root): import('node:fs').Dirent[] | null {
  try {
    const result: import('node:fs').Dirent[] = [], directory = opendirSync(root.path);
    try { for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) { if (result.length >= MAX_ENTRIES) return null; result.push(entry); } }
    finally { directory.closeSync(); }
    return result;
  } catch { return null; }
}

/**
 * Reads recorded planning snapshots only. It does not revalidate compiler inputs,
 * persona files, references, citations, generated assets, quality, or publication state.
 */
export function collectContentBriefs(repoRoot?: string | null): ContentBriefsProjection {
  if (repoRoot == null || !repoRoot.trim()) return { status: 'not-configured', items: [] };
  const repo = openRoot(repoRoot); if (repo === null) return { status: 'unavailable', reason: 'evidence-unavailable', items: [] };
  const briefs = childRoot(repo, 'orgs/figment/content/briefs');
  if (briefs === null) return absent(repo, 'orgs/figment/content/briefs') ? { status: 'empty', recordKind: 'planning-snapshot', currentSourceRevalidated: false, items: [] } : { status: 'unavailable', reason: 'evidence-unavailable', items: [] };
  const listed = entries(briefs); if (listed === null) return { status: 'unavailable', reason: 'evidence-unavailable', items: [] };
  const items: ContentBriefItem[] = [];
  for (const entry of listed.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) return { status: 'unavailable', reason: 'evidence-unavailable', items: [] };
    if (!entry.isDirectory()) { if (!entry.isFile()) return { status: 'unavailable', reason: 'evidence-unavailable', items: [] }; continue; }
    if (entry.name.length > MAX_ID || !BRIEF_ID.test(entry.name)) return { status: 'unavailable', reason: 'evidence-unavailable', items: [] };
    const folder = childRoot(briefs, entry.name); if (folder === null) return { status: 'unavailable', reason: 'evidence-unavailable', items: [] };
    const briefPath = file(folder, 'brief.json');
    if (briefPath === null) { if (absent(folder, 'brief.json')) continue; return { status: 'unavailable', reason: 'evidence-unavailable', items: [] }; }
    const raw = bounded(briefPath); if (raw === null) return { status: 'unavailable', reason: 'evidence-unavailable', items: [] };
    try {
      const source = raw.toString('utf8');
      if (!shallow(source)) return { status: 'unavailable', reason: 'evidence-unavailable', items: [] };
      const item = contentBrief(JSON.parse(source) as unknown, entry.name);
      if (item === null) return { status: 'unavailable', reason: 'evidence-unavailable', items: [] };
      items.push(item);
    } catch { return { status: 'unavailable', reason: 'evidence-unavailable', items: [] }; }
  }
  if (items.length === 0) return { status: 'empty', recordKind: 'planning-snapshot', currentSourceRevalidated: false, items: [] };
  items.sort((left, right) => right.briefDate.localeCompare(left.briefDate) || left.briefId.localeCompare(right.briefId));
  return { status: 'recorded', recordKind: 'planning-snapshot', currentSourceRevalidated: false, items };
}
