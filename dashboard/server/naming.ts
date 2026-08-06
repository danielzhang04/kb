/**
 * Server-owned display-name/short-ref registry. Humans see a title plus a short stable ordinal
 * ("run 87d8aef2", short ref #3); every other system (routing, persistence, cross-service refs)
 * keeps using the canonical ID untouched — this module never replaces it, only labels it.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { resolveDashboardStateRoot } from './composer/store.ts';

export type EntityKind = 'card' | 'run' | 'workflow' | 'agent' | 'task';

export interface EntityDisplay {
  displayName: string;
  shortRef: number;
}

type RegistryDocument = Record<string, Record<string, number>>;

/** Prefixes stripped from a canonical id before it is truncated into a fallback display name. */
const ID_PREFIXES = ['run-', 'wf-', 'workflow-', 'request-', 'card-', 'agent-', 'task-'];

function isRegistryDocument(value: unknown): value is RegistryDocument {
  if (typeof value !== 'object' || value === null) return false;
  for (const bucket of Object.values(value as Record<string, unknown>)) {
    if (typeof bucket !== 'object' || bucket === null) return false;
    for (const ordinal of Object.values(bucket as Record<string, unknown>)) {
      if (typeof ordinal !== 'number' || !Number.isInteger(ordinal) || ordinal < 1) return false;
    }
  }
  return true;
}

function fallbackDisplayName(kind: EntityKind, id: string): string {
  let rest = id;
  for (const prefix of ID_PREFIXES) {
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
      break;
    }
  }
  return `${kind} ${rest.slice(0, 8)}`;
}

/** Assigns and persists per-kind ordinals and human display names for canonical entity IDs. */
export class NamingRegistry {
  private readonly path: string;
  private doc: RegistryDocument | null = null;

  constructor(filePath: string) {
    this.path = filePath;
  }

  private load(): RegistryDocument {
    if (this.doc) return this.doc;
    if (!existsSync(this.path)) {
      this.doc = {};
      return this.doc;
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      this.doc = isRegistryDocument(parsed) ? parsed : {};
    } catch {
      this.doc = {};
    }
    return this.doc;
  }

  private save(doc: RegistryDocument): void {
    const encoded = `${JSON.stringify(doc)}\n`;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    let fd: number | null = null;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, encoded, 'utf8');
      closeSync(fd);
      fd = null;
      renameSync(temp, this.path);
    } finally {
      if (fd !== null) closeSync(fd);
      if (existsSync(temp)) rmSync(temp, { force: true });
    }
  }

  shortRef(kind: EntityKind, id: string): number {
    const doc = this.load();
    const bucket = doc[kind] ?? (doc[kind] = {});
    const existing = bucket[id];
    if (existing !== undefined) return existing;
    let next = 1;
    for (const ordinal of Object.values(bucket)) next = Math.max(next, ordinal + 1);
    bucket[id] = next;
    this.save(doc);
    return next;
  }

  displayFor(kind: EntityKind, id: string, title?: string): EntityDisplay {
    const trimmed = title?.trim();
    const displayName = trimmed ? trimmed : fallbackDisplayName(kind, id);
    return { displayName, shortRef: this.shortRef(kind, id) };
  }
}

let singleton: NamingRegistry | null = null;

/** Process-wide singleton over the dashboard's shared state root, matching the control store's default. */
export function defaultNamingRegistry(): NamingRegistry {
  if (!singleton) singleton = new NamingRegistry(join(resolveDashboardStateRoot(), 'naming.json'));
  return singleton;
}
