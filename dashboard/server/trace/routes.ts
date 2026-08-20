/**
 * U6 — read-only run-envelope routes.
 *
 *   GET /api/trace              → the transcripts that EXIST under the root (id + project + mtime)
 *   GET /api/trace/:sessionId   → the payload-elided {@link RunEnvelope} for one session JSONL
 *
 * Registered exactly like the other read-only projections (`registerPanels`, `registerAgents`): GET
 * only, no write surface, no session state.
 *
 * WHY THE LIST EXISTS (U12). The panel used to hard-code ONE session id, which is a claim about one
 * machine: on any other machine it 404s and the panel reads as broken rather than as empty. The list
 * is the only honest way for the client to name a subject — the control plane's `listRuns` cannot do
 * it, because a `runRef` is a control-plane identifier and a session id is a Claude Code transcript
 * stem; feeding one into the other 404s by construction. Same shape and same posture as
 * `GET /api/context-lifecycle`: `{ available, sessions }`, an unreadable root reported as
 * `available: false` rather than as an error page.
 *
 * The list carries NO transcript content — id, project directory name, mtime and size only. Reading a
 * transcript still costs a second, explicit request for exactly one session.
 *
 * WHERE SESSIONS LIVE. Transcripts are NOT in the repo — Claude Code writes them under
 * `~/.claude/projects/<project-dir>/<sessionId>.jsonl`. The root is therefore its own resolution
 * (`resolveSessionRoot`, overridable with `DASHBOARD_TRACE_ROOT`), mirroring the
 * `panels/routes.ts:resolveRepoRoot` override pattern rather than reusing the repo root; tests inject
 * a fixture root as the second argument.
 *
 * PATH SAFETY. `:sessionId` is matched against a strict id charset BEFORE it touches the filesystem,
 * so no `..`, no separator, no absolute path, no URL-encoded escape can leave the configured root.
 * Lookup is the root itself plus ONE level of project sub-directories (the real on-disk layout) —
 * never an unbounded recursive walk.
 */
import { readdir, stat } from 'node:fs/promises';
import { accessSync, constants, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { readEnvelope } from './envelope.ts';

/** Session ids are Claude Code UUID-shaped file stems. Anything else is rejected unread. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Resolve one readable transcript directory, or null when ProtectHome/no local history hides it. */
export function resolveSessionRoot(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string | null {
  const configured = env.DASHBOARD_TRACE_ROOT?.trim();
  const candidate = configured || join(home, '.claude', 'projects');
  try {
    accessSync(candidate, constants.R_OK);
    return statSync(candidate).isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Resolve `<sessionId>.jsonl` directly under `root`, else under one level of sub-directories. */
async function findSession(root: string, sessionId: string): Promise<string | null> {
  const direct = join(root, `${sessionId}.jsonl`);
  if (await isFile(direct)) return direct;
  let entries: Dirent[] = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = join(root, entry.name, `${sessionId}.jsonl`);
    if (await isFile(nested)) return nested;
  }
  return null;
}

/**
 * How many transcripts the list route reports. The real root on this machine holds a few hundred and
 * grows forever, so the RESPONSE is bounded (the walk stats every transcript, then slices) and the
 * bound is disclosed on the wire (`truncated`) rather than hidden — the same posture as the paged
 * event window.
 */
export const SESSION_LIST_LIMIT = 200;

/** One transcript, described without opening it. No content, no step count — that costs a read. */
export interface SessionListEntry {
  sessionId: string;
  /** The project sub-directory it sits in, or null when it sits at the root itself. */
  project: string | null;
  modifiedAt: string;
  sizeBytes: number;
}

export interface SessionListResponse {
  /** False when the root cannot be read at all — the expected state on a machine with no Claude Code
   *  history. Distinct from an empty `sessions` under a readable root. */
  available: boolean;
  sessionRoot: string;
  /** True when more transcripts exist than {@link SESSION_LIST_LIMIT} reports. */
  truncated: boolean;
  /** Newest-modified first. */
  sessions: SessionListEntry[];
}

/** `<stem>.jsonl` → `<stem>`, or null when the name is not a transcript with a legal id. */
function sessionIdOf(fileName: string): string | null {
  if (!fileName.endsWith('.jsonl')) return null;
  const stem = fileName.slice(0, -'.jsonl'.length);
  return SESSION_ID.test(stem) ? stem : null;
}

/** Describe every `*.jsonl` directly in `dir`. An unreadable directory contributes nothing. */
async function describeDir(dir: string, project: string | null): Promise<SessionListEntry[]> {
  let entries: Dirent[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: SessionListEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const sessionId = sessionIdOf(entry.name);
    if (sessionId === null) continue;
    try {
      const stats = await stat(join(dir, entry.name));
      found.push({
        sessionId,
        project,
        modifiedAt: stats.mtime.toISOString(),
        sizeBytes: stats.size,
      });
    } catch {
      // A file that vanished between readdir and stat is simply not listed.
    }
  }
  return found;
}

/**
 * Every transcript under `root` and ONE level of project sub-directories — the same shape
 * {@link findSession} looks in, so a listed id is always a fetchable id. Never a recursive walk.
 */
export async function listSessions(root: string): Promise<SessionListResponse> {
  let entries: Dirent[] = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { available: false, sessionRoot: root, truncated: false, sessions: [] };
  }
  const all = await describeDir(root, null);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    all.push(...(await describeDir(join(root, entry.name), entry.name)));
  }
  all.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : a.sessionId.localeCompare(b.sessionId)));
  return {
    available: true,
    sessionRoot: root,
    truncated: all.length > SESSION_LIST_LIMIT,
    sessions: all.slice(0, SESSION_LIST_LIMIT),
  };
}

/** Register the read-only trace routes. Pure read: they open transcripts and write nothing. */
export function registerTraceRead(app: FastifyInstance, sessionRoot: string): void {
  app.get('/api/trace', async (): Promise<SessionListResponse> => await listSessions(sessionRoot));

  app.get('/api/trace/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!SESSION_ID.test(sessionId)) {
      return reply.code(400).send({ error: 'bad-session-id' });
    }
    const path = await findSession(sessionRoot, sessionId);
    if (path === null) {
      return reply.code(404).send({ error: 'session-not-found', sessionId });
    }
    return readEnvelope(path, sessionId);
  });
}
