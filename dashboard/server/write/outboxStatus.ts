import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { OutboxStatus } from '../control/admission.ts';
import { isCoordinationPath } from './branch.ts';

const MANIFEST_KEYS = ['bundleSha256', 'commit', 'createdAt', 'id', 'parent', 'paths', 'schema'] as const;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;

type Manifest = {
  bundleSha256: string;
  commit: string;
  createdAt: string;
  id: string;
  parent: string;
  paths: string[];
  schema: 'kb.ops-outbox/v1';
};

function canonicalJson(value: object): string {
  return JSON.stringify(value, Object.keys(value).sort())
    .replace(/[\u007f-\uffff]/g, (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** JSON.parse permits duplicate object keys; the outbox schema does not. */
function rejectDuplicateKeys(source: string): void {
  let cursor = 0;
  const whitespace = () => {
    while (/\s/.test(source[cursor] ?? '')) cursor += 1;
  };
  const string = (): string => {
    if (source[cursor] !== '"') throw new Error('expected JSON string');
    const start = cursor++;
    while (cursor < source.length) {
      const unit = source[cursor++];
      if (unit === '"') return JSON.parse(source.slice(start, cursor)) as string;
      if (unit === '\\') cursor += 1;
    }
    throw new Error('unterminated JSON string');
  };
  const value = (): void => {
    whitespace();
    if (source[cursor] === '{') {
      cursor += 1;
      whitespace();
      const keys = new Set<string>();
      if (source[cursor] === '}') { cursor += 1; return; }
      while (true) {
        const key = string();
        if (keys.has(key)) throw new Error('duplicate JSON key');
        keys.add(key);
        whitespace();
        if (source[cursor++] !== ':') throw new Error('expected JSON colon');
        value();
        whitespace();
        const delimiter = source[cursor++];
        if (delimiter === '}') return;
        if (delimiter !== ',') throw new Error('expected JSON delimiter');
        whitespace();
      }
    }
    if (source[cursor] === '[') {
      cursor += 1;
      whitespace();
      if (source[cursor] === ']') { cursor += 1; return; }
      while (true) {
        value();
        whitespace();
        const delimiter = source[cursor++];
        if (delimiter === ']') return;
        if (delimiter !== ',') throw new Error('expected JSON delimiter');
      }
    }
    if (source[cursor] === '"') { string(); return; }
    const start = cursor;
    while (cursor < source.length && !/[\s,\]}]/.test(source[cursor])) cursor += 1;
    if (start === cursor) throw new Error('expected JSON value');
  };
  value();
  whitespace();
  if (cursor !== source.length) throw new Error('trailing JSON data');
}

function validManifest(raw: string, filename: string): number {
  rejectDuplicateKeys(raw);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('manifest must be an object');
  const manifest = parsed as Partial<Manifest>;
  if (Object.keys(manifest).sort().join(',') !== MANIFEST_KEYS.join(',')) throw new Error('manifest key set is invalid');
  if (raw !== `${canonicalJson(manifest as object)}\n`) throw new Error('manifest is noncanonical');
  if (typeof manifest.schema !== 'string' || manifest.schema !== 'kb.ops-outbox/v1'
    || typeof manifest.id !== 'string' || typeof manifest.commit !== 'string' || typeof manifest.parent !== 'string'
    || typeof manifest.createdAt !== 'string' || typeof manifest.bundleSha256 !== 'string') throw new Error('manifest field is invalid');
  const identity = filename.slice(0, -'.json'.length);
  if (!COMMIT_RE.test(identity) || manifest.id !== identity || manifest.commit !== identity || !COMMIT_RE.test(manifest.parent)) {
    throw new Error('manifest identity is invalid');
  }
  if (!Array.isArray(manifest.paths) || manifest.paths.length === 0
    || manifest.paths.some((path) => typeof path !== 'string' || !isCoordinationPath(path))
    || JSON.stringify(manifest.paths) !== JSON.stringify([...new Set(manifest.paths)].sort())) throw new Error('manifest paths are invalid');
  if (!DIGEST_RE.test(manifest.bundleSha256)) throw new Error('manifest digest is invalid');
  const createdAt = new Date(manifest.createdAt);
  if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== manifest.createdAt) throw new Error('manifest timestamp is invalid');
  return createdAt.getTime();
}

function readPendingManifestTimes(spoolRoot: string): { pending: number; times: number[]; invalid: boolean } {
  try {
    const ready = join(spoolRoot, 'ready');
    const receipts = join(spoolRoot, 'receipts');
    const names = readdirSync(ready).filter((name) => name.endsWith('.json'));
    const times: number[] = [];
    let pending = 0;
    let invalid = false;
    for (const name of names) {
      const receipt = join(receipts, name);
      let received = false;
      try {
        received = statSync(receipt).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') invalid = true;
      }
      if (received) continue;
      pending += 1;
      try {
        times.push(validManifest(readFileSync(join(ready, name), 'utf8'), name));
      } catch {
        invalid = true;
      }
    }
    return { pending, times, invalid };
  } catch {
    return { pending: 0, times: [], invalid: true };
  }
}

export function outboxStatus(
  spoolRoot: string,
  options: { maxPending?: number; maxAgeMs?: number; now?: () => number } = {},
): OutboxStatus {
  const maxPending = options.maxPending ?? 100;
  const maxAgeMs = options.maxAgeMs ?? 15 * 60_000;
  const now = options.now ?? Date.now;
  const scan = readPendingManifestTimes(spoolRoot);
  const oldestAgeMs = scan.times.length === 0 ? 0 : Math.max(0, now() - Math.min(...scan.times));
  const reasons = [
    ...(scan.invalid ? ['manifest-invalid'] : []),
    ...(scan.pending >= maxPending ? ['pending-limit'] : []),
    ...(oldestAgeMs >= maxAgeMs ? ['oldest-age-limit'] : []),
  ];
  return { pending: scan.pending, oldestAgeMs, degraded: reasons.length > 0, reasons };
}
