/**
 * Declared persona references only. These helpers never discover arbitrary images:
 * every returned member must appear verbatim in a persona's `identity.references`.
 */
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_PERSONAS = 32;
const MAX_REFERENCES = 16;
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 64 * 1024 * 1024;
const MAX_PERSONA_BYTES = 64 * 1024;
const MAX_PIXELS = 32_000_000;
const SHA256 = /^[a-f0-9]{64}$/;
const REFERENCE = /^anchors\/([A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:png|jpe?g))$/i;
const CREATOR = /^[A-Za-z0-9-]{1,80}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface SafeRoot { path: string; real: string; }
interface Member { creator: string; name: string; path: string; bytes: number; }
export interface DeclaredReference { creator: string; name: string; bytes: number; sha256: string; width: number; height: number; modifiedAt: string; }
export interface DeclaredReferencesProjection { items: DeclaredReference[]; truncated: boolean; }
export interface LoadedReference { bytes: Buffer; contentType: 'image/jpeg' | 'image/png'; width: number; height: number; modifiedAt: string; }

export function isOpaqueReferenceTarget(creator: string, name: string): boolean {
  return CREATOR.test(creator) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:png|jpe?g)$/i.test(name);
}

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}

function openRoot(candidate: string): SafeRoot | null {
  try {
    const path = resolve(candidate); const info = lstatSync(path);
    return info.isDirectory() && !info.isSymbolicLink() ? { path, real: realpathSync(path) } : null;
  } catch { return null; }
}

/** Reject links and junctions at every existing component of a fixed repo-root path. */
function safeFile(root: SafeRoot, candidate: string): string | null {
  const path = isAbsolute(candidate) ? resolve(candidate) : resolve(root.path, candidate);
  if (!inside(root.path, path)) return null;
  try {
    let cursor = root.path;
    for (const segment of relative(root.path, path).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, segment);
      if (lstatSync(cursor).isSymbolicLink()) return null;
    }
    if (!lstatSync(path).isFile()) return null;
    return inside(root.real, realpathSync(path)) ? path : null;
  } catch { return null; }
}

function safeDirectory(root: SafeRoot, candidate: string): string | null {
  const path = isAbsolute(candidate) ? resolve(candidate) : resolve(root.path, candidate);
  if (!inside(root.path, path)) return null;
  try {
    let cursor = root.path;
    for (const segment of relative(root.path, path).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, segment);
      if (lstatSync(cursor).isSymbolicLink()) return null;
    }
    if (!lstatSync(path).isDirectory()) return null;
    return inside(root.real, realpathSync(path)) ? path : null;
  } catch { return null; }
}

function boundedEntries(directory: string): { entries: import('node:fs').Dirent[]; truncated: boolean } {
  const entries: import('node:fs').Dirent[] = [];
  try {
    const handle = opendirSync(directory);
    try {
      let entry = handle.readSync();
      while (entry !== null && entries.length < 256) { entries.push(entry); entry = handle.readSync(); }
      return { entries, truncated: entry !== null };
    } finally { handle.closeSync(); }
  } catch { return { entries, truncated: false }; }
}

function boundedRead(path: string, maximum: number, expectedBytes?: number): { bytes: Buffer; modifiedAt: string } | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, 'r');
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 0 || before.size > maximum || (expectedBytes !== undefined && before.size !== expectedBytes)) return null;
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (read <= 0) return null;
      offset += read;
    }
    const after = fstatSync(descriptor);
    return after.isFile() && after.size === before.size && (expectedBytes === undefined || after.size === expectedBytes) ? { bytes, modifiedAt: after.mtime.toISOString() } : null;
  } catch { return null; } finally { if (descriptor !== null) { try { closeSync(descriptor); } catch { /* failed reads are rejected */ } } }
}

function dimensions(width: number, height: number): { width: number; height: number } | null {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= MAX_PIXELS ? { width, height } : null;
}

function pngInfo(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

/** Strictly walk JPEG marker segments through SOF; malformed/truncated segments fail closed. */
function jpegInfo(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 0x00 || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (sof.has(marker)) {
      if (length < 8) return null;
      return dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    offset += length;
  }
  return null;
}

function imageInfo(bytes: Buffer): { width: number; height: number; contentType: 'image/jpeg' | 'image/png' } | null {
  const png = pngInfo(bytes); if (png !== null) return { ...png, contentType: 'image/png' };
  const jpeg = jpegInfo(bytes); return jpeg === null ? null : { ...jpeg, contentType: 'image/jpeg' };
}

function readPersona(root: SafeRoot, creator: string): string[] | null {
  const path = safeFile(root, join('personas', creator, 'persona.yaml'));
  const loaded = path === null ? null : boundedRead(path, MAX_PERSONA_BYTES);
  if (loaded === null) return null;
  try {
    const value: unknown = JSON.parse(loaded.bytes.toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const identity = (value as Record<string, unknown>).identity;
    if (typeof identity !== 'object' || identity === null || Array.isArray(identity) || !Array.isArray((identity as Record<string, unknown>).references)) return null;
    const values = (identity as Record<string, unknown>).references as unknown[];
    if (!values.every((reference) => typeof reference === 'string' && REFERENCE.test(reference))) return null;
    return values as string[];
  } catch { return null; }
}

/** Bounded declared membership only: no reference image is opened or hashed here. */
function members(repoRoot: string): { root: SafeRoot; items: Member[]; truncated: boolean } | null {
  const root = openRoot(repoRoot); const personas = root === null ? null : safeDirectory(root, 'personas');
  if (root === null || personas === null) return null;
  const listed = boundedEntries(personas); let truncated = listed.truncated;
  const creators = listed.entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && CREATOR.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (creators.length > MAX_PERSONAS) truncated = true;
  const items: Member[] = []; let total = 0;
  for (const entry of creators.slice(0, MAX_PERSONAS)) {
    const references = readPersona(root, entry.name);
    if (references === null) continue;
    const names = new Set<string>();
    for (const reference of references) {
      const match = REFERENCE.exec(reference);
      if (match === null || names.has(match[1])) continue;
      names.add(match[1]);
      // A seventeenth declaration is enough to state truncation. Do not resolve,
      // stat, open, or hash it: the count cap bounds traversal as well as bytes.
      if (items.length >= MAX_REFERENCES) return { root, items, truncated: true };
      const path = safeFile(root, join('personas', entry.name, reference));
      if (path === null) continue;
      let size: number;
      try { size = statSync(path).size; } catch { continue; }
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_REFERENCE_BYTES) continue;
      if (total + size > MAX_TOTAL_REFERENCE_BYTES) { truncated = true; continue; }
      items.push({ creator: entry.name, name: match[1], path, bytes: size }); total += size;
    }
  }
  return { root, items, truncated };
}

export function collectDeclaredReferences(repoRoot: string): DeclaredReferencesProjection {
  const listed = members(repoRoot);
  if (listed === null) return { items: [], truncated: false };
  const items: DeclaredReference[] = [];
  let truncated = listed.truncated;
  for (const member of listed.items) {
    const loaded = boundedRead(member.path, MAX_REFERENCE_BYTES, member.bytes);
    const info = loaded === null ? null : imageInfo(loaded.bytes);
    if (loaded === null || info === null) continue;
    items.push({ creator: member.creator, name: member.name, bytes: loaded.bytes.length, sha256: createHash('sha256').update(loaded.bytes).digest('hex'), width: info.width, height: info.height, modifiedAt: loaded.modifiedAt });
  }
  return { items, truncated };
}

/** Membership is metadata-only, so a binary read need not rehash a gallery. */
export function isDeclaredReference(repoRoot: string, creator: string, name: string): boolean {
  return isOpaqueReferenceTarget(creator, name) && (members(repoRoot)?.items.some((item) => item.creator === creator && item.name === name) ?? false);
}

/** Revalidates bounded declared membership, then opens and hashes only the requested member. */
export function readDeclaredReference(repoRoot: string, creator: string, name: string, expectedSha256: string): LoadedReference | null {
  if (!isOpaqueReferenceTarget(creator, name) || !SHA256.test(expectedSha256)) return null;
  const listed = members(repoRoot);
  const member = listed?.items.find((item) => item.creator === creator && item.name === name);
  if (member === undefined) return null;
  const loaded = boundedRead(member.path, MAX_REFERENCE_BYTES, member.bytes);
  const info = loaded === null ? null : imageInfo(loaded.bytes);
  if (loaded === null || info === null || createHash('sha256').update(loaded.bytes).digest('hex') !== expectedSha256) return null;
  return { bytes: loaded.bytes, contentType: info.contentType, width: info.width, height: info.height, modifiedAt: loaded.modifiedAt };
}
