/**
 * Task 7 — Atlas panel: a read-only projection of the voice worker for the dashboard Atlas view.
 * Three sources, all read-only (pre-auth panels tier — this route can trigger nothing):
 *
 *   1. `worker`  — a passthrough of the worker's `GET /state` JSON (design §3), fetched from the
 *      `ATLAS_STATE_URL` base (default `http://127.0.0.1:4360`) through an INJECTED fetch (the
 *      `claudeWorkerAdapter` DI precedent), under a short timeout. Unreachable / timeout / non-ok /
 *      malformed-JSON degrade to an explicit `{ state: "OFFLINE", lastHeartbeat }` shape — never a
 *      thrown 500, never a blank panel. OFFLINE is NOT a worker state; it is what the dashboard
 *      derives when the endpoint is unreachable.
 *   2. `history` — recent session transcripts from `orgs/atlas/output/transcripts/*.jsonl` under the
 *      repo root the panels tier already receives, newest-first and bounded to the last 10 sessions.
 *   3. `cards`   — `project: atlas` queue cards across states, via the shared `parseCardFrontmatter`.
 *
 * SECRET DISCIPLINE: the only env var this module reads is `ATLAS_STATE_URL`. It never reads, logs,
 * or forwards any credential, and the worker `/state` surface is itself provably key-free (design §3).
 *
 * Strip-only floor (Node runs this `.ts` directly under --experimental-strip-types): no TS enums,
 * no parameter properties, no namespaces. ESM with explicit `.ts` import specifiers.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseValidatedCard } from '../planeA/cards.ts';
import type { CardFieldValue } from '../planeA/cards.ts';

/** The worker base URL when `ATLAS_STATE_URL` is unset. The daemon owns 4317; the worker owns 4360. */
export const DEFAULT_STATE_URL = 'http://127.0.0.1:4360';
/** Short timeout so an unreachable/hung worker degrades to OFFLINE fast (design §4). */
export const DEFAULT_TIMEOUT_MS = 800;
/** History is bounded to the most recent N sessions. */
export const HISTORY_LIMIT = 10;
/** The atlas project identifier used to filter queue cards. */
export const ATLAS_PROJECT = 'atlas';
/** The four physical queue dirs (mirrors planeA/indexer). Logical states (blocked/approved/rejected)
 *  live inside these dirs and are read from each card's `state` field. */
const QUEUE_DIRS = ['inbox', 'working', 'approvals', 'done'];
const TRANSCRIPTS_SEGMENTS = ['orgs', 'atlas', 'output', 'transcripts'];

/** Minimal Response surface this module needs — satisfied by the global `fetch` and by test fakes. */
export interface FetchResponseLike {
  ok: boolean;
  json(): Promise<unknown>;
}

/** Injected fetch seam (the claudeWorkerAdapter DI precedent) so tests need no live worker/port. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>;

/** The dashboard-derived offline shape when the worker endpoint is unreachable/malformed. */
export interface OfflineWorker {
  state: 'OFFLINE';
  lastHeartbeat: string | null;
}

/** Either the worker's `/state` JSON (passthrough) or the derived OFFLINE shape. */
export type WorkerSnapshot = Record<string, unknown> | OfflineWorker;

export interface AtlasWorkerOptions {
  /** Injected fetch. Defaults to the global `fetch` (only used by the live daemon, never under test). */
  fetchImpl?: FetchLike;
  /** Worker base URL. Defaults to `ATLAS_STATE_URL` env, then `DEFAULT_STATE_URL`. */
  stateUrl?: string;
  /** Per-request timeout. Defaults to `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Last heartbeat seen from a prior healthy response, surfaced in the OFFLINE shape. */
  lastHeartbeat?: string | null;
}

/** One transcript row (`{t, role, text}`), tolerant of missing fields. */
export interface TranscriptLine {
  t: string | null;
  role: string | null;
  text: string | null;
}

/** One recent session read from the transcript ledger. */
export interface HistoryEntry {
  file: string;
  date: string;
  sessionId: string;
  lines: TranscriptLine[];
}

/** One atlas-project queue card, reduced to what the panel renders. */
export interface AtlasCard {
  id: string;
  action: string;
  state: string;
  workflow: string | null;
}

export interface AtlasPanel {
  worker: WorkerSnapshot;
  history: HistoryEntry[];
  cards: AtlasCard[];
}

/** Build the derived OFFLINE shape carrying the last-known heartbeat (or null). */
function offline(lastHeartbeat: string | null): OfflineWorker {
  return { state: 'OFFLINE', lastHeartbeat };
}

/**
 * Fetch the worker `/state` JSON and pass it through verbatim when healthy; otherwise degrade to the
 * explicit OFFLINE shape. Never throws and never blocks past `timeoutMs` — a hung fetch loses a race
 * to the timeout (the injected fetch is not required to honor the abort signal). Reads only
 * `ATLAS_STATE_URL` from the environment.
 */
export async function fetchWorkerState(options: AtlasWorkerOptions = {}): Promise<WorkerSnapshot> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  const last = options.lastHeartbeat ?? null;
  if (!fetchImpl) return offline(last);

  const base = options.stateUrl ?? process.env.ATLAS_STATE_URL ?? DEFAULT_STATE_URL;
  const url = `${base.replace(/\/+$/, '')}/state`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<WorkerSnapshot>((resolve) => {
    timer = setTimeout(() => {
      try { controller.abort(); } catch { /* aborting is best-effort */ }
      resolve(offline(last));
    }, timeoutMs);
  });

  const attempt = (async (): Promise<WorkerSnapshot> => {
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res || res.ok !== true) return offline(last);
      const data = await res.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) return offline(last);
      return data as Record<string, unknown>;
    } catch {
      return offline(last);
    }
  })();

  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Coerce a raw JSONL row into a tolerant `{t, role, text}` line. */
function toLine(row: Record<string, unknown>): TranscriptLine {
  return {
    t: typeof row.t === 'string' ? row.t : null,
    role: typeof row.role === 'string' ? row.role : null,
    text: typeof row.text === 'string' ? row.text : null,
  };
}

/**
 * Read recent session transcripts from `orgs/atlas/output/transcripts/*.jsonl`, newest-first and
 * bounded to `limit` sessions. Filenames are `YYYY-MM-DD-<sessionId>.jsonl`; ISO date prefixes sort
 * lexicographically, so a descending basename sort is newest-first. A missing dir, an unreadable
 * file, or a malformed JSONL line is tolerated by skipping — never thrown.
 */
export function readTranscriptHistory(repoRoot: string, limit: number = HISTORY_LIMIT): HistoryEntry[] {
  const dir = join(repoRoot, ...TRANSCRIPTS_SEGMENTS);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const files = names
    .filter((n) => n.endsWith('.jsonl'))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);

  const out: HistoryEntry[] = [];
  for (const file of files) {
    const match = /^(\d{4}-\d{2}-\d{2})-(.+)\.jsonl$/.exec(file);
    const date = match ? match[1] : '';
    const sessionId = match ? match[2] : file.replace(/\.jsonl$/, '');
    let raw: string;
    try {
      raw = readFileSync(join(dir, file), 'utf-8');
    } catch {
      continue;
    }
    const lines: TranscriptLine[] = [];
    for (const rawLine of raw.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (trimmed === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue; // one malformed line never drops the whole session
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        lines.push(toLine(parsed as Record<string, unknown>));
      }
    }
    out.push({ file, date, sessionId, lines });
  }
  return out;
}

/** True when a card's `project` field (scalar or list) names the atlas project. */
function isAtlasProject(project: CardFieldValue | undefined): boolean {
  if (Array.isArray(project)) return project.includes(ATLAS_PROJECT);
  return project === ATLAS_PROJECT;
}

/**
 * Read `project: atlas` queue cards across the four physical queue dirs, reusing the shared
 * `parseCardFrontmatter` (Evidence stays inert — only frontmatter is read). A missing dir or a
 * malformed card is skipped, never thrown.
 */
export function readAtlasCards(repoRoot: string): AtlasCard[] {
  const out: AtlasCard[] = [];
  for (const dirName of QUEUE_DIRS) {
    const full = join(repoRoot, 'queue', dirName);
    if (!existsSync(full)) continue;
    let names: string[];
    try {
      names = readdirSync(full);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      let meta;
      try {
        meta = parseValidatedCard(readFileSync(join(full, name), 'utf-8')).meta;
      } catch {
        continue;
      }
      if (!isAtlasProject(meta.project)) continue;
      out.push({
        id: typeof meta.id === 'string' ? meta.id : String(meta.id ?? ''),
        action: typeof meta.action === 'string' ? meta.action : String(meta.action ?? ''),
        state: typeof meta.state === 'string' ? meta.state : String(meta.state ?? ''),
        workflow: typeof meta.workflow === 'string' ? meta.workflow : null,
      });
    }
  }
  return out;
}

/** Assemble the full Atlas panel payload: worker passthrough + transcript history + atlas cards. */
export async function buildAtlasPanel(repoRoot: string, options: AtlasWorkerOptions = {}): Promise<AtlasPanel> {
  const worker = await fetchWorkerState(options);
  return {
    worker,
    history: readTranscriptHistory(repoRoot),
    cards: readAtlasCards(repoRoot),
  };
}
