/**
 * U8 — read-only projection of the context-lifecycle session stores.
 *
 *   GET /api/context-lifecycle              → the session stores that exist (id + mtime)
 *   GET /api/context-lifecycle/:sessionId   → one store, parsed into ordered `{heading, body}`
 *
 * Registered exactly like the other read-only projections (`registerTraceRead`, `registerAgents`):
 * GET only, no write surface, no session state. Nothing here can arm, disarm, or edit a hook — the
 * hooks are inert and this route only reports what they WOULD have written.
 *
 * WHERE THE STORES LIVE. Not in the repo: a per-session context file is daemon-local state, never
 * coordination truth (same reasoning as DASHBOARD_STATE_ROOT — see .gitignore). The root resolves to
 * `KB_CONTEXT_STORE_DIR` when set, else `DASHBOARD_STATE_ROOT/context-lifecycle` in the daemon,
 * then `%LOCALAPPDATA%\kb-context-lifecycle` on the desktop, matching
 * `scripts/hooks/lib/context_store.js:storeDir()` exactly. Tests inject a fixture root as the second
 * argument.
 *
 * PATH SAFETY. `:sessionId` is matched against the same strict id charset the hook library enforces
 * BEFORE it touches the filesystem, so no `..`, separator, absolute path, or URL-encoded escape can
 * leave the configured root. Lookup is one flat directory — never a recursive walk.
 *
 * THE PARSER IS A DELIBERATE SECOND COPY. The section parse is ~15 lines duplicated from the hook
 * library rather than imported: that library is CommonJS under `scripts/`, outside the dashboard's
 * TypeScript ESM graph, and importing it would drag a hook runtime into the daemon bundle. The two
 * are pinned together by `tests/test_context_store.py` (format) and `routes.test.ts` (this parse).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { resolveStatePath } from '../../../scripts/hooks/lib/kb_paths.js';

/** Session ids are Claude Code UUID-shaped file stems. Anything else is rejected unread. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const FILE_SUFFIX = '.ctx.md';
const STORE_DIR_NAME = 'kb-context-lifecycle';

/** Refuse to read a store that is not a store. Real files are a few KiB. */
const MAX_STORE_BYTES = 2 * 1024 * 1024;

/** One parsed section of a store file. */
export interface ContextSection {
  heading: string;
  body: string;
}

/** One store file as the listing reports it. */
export interface ContextSessionSummary {
  sessionId: string;
  modifiedAt: string;
  bytes: number;
}

/** The store root — explicit override, daemon state root, then the desktop repo-external default. */
export function resolveStoreRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KB_CONTEXT_STORE_DIR) return env.KB_CONTEXT_STORE_DIR;
  const base = env.LOCALAPPDATA ?? join(homedir(), '.local', 'state');
  return resolveStatePath('context-lifecycle', join(base, STORE_DIR_NAME), env)!;
}

/** Parse store markdown into ordered sections. Text before the first `## ` heading is dropped. */
export function parseSections(text: string): ContextSection[] {
  const sections: ContextSection[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^##[ \t]+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
      current = { heading: match[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
  return sections;
}

async function listStores(root: string): Promise<ContextSessionSummary[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const sessions: ContextSessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(FILE_SUFFIX)) continue;
    const sessionId = entry.name.slice(0, -FILE_SUFFIX.length);
    if (!SESSION_ID.test(sessionId)) continue;
    try {
      const stats = await stat(join(root, entry.name));
      sessions.push({ sessionId, modifiedAt: stats.mtime.toISOString(), bytes: stats.size });
    } catch {
      // A file that vanished between readdir and stat is simply not listed.
    }
  }
  // Most recently written first: an operator opening this panel wants the session they just ran.
  return sessions.sort(
    (a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.sessionId.localeCompare(b.sessionId),
  );
}

/** Register the read-only context-lifecycle routes. Pure read: it opens store files and writes nothing. */
export function registerContextLifecycle(
  app: FastifyInstance,
  storeRoot: string = resolveStoreRoot(),
): void {
  app.get('/api/context-lifecycle', async (request) => {
    try {
      return { available: true, storeRoot, sessions: await listStores(storeRoot) };
    } catch (error) {
      // A missing store dir is the EXPECTED state while the hooks are inert — never an error page.
      request.log.debug({ err: error }, 'context-lifecycle store root unreadable');
      return { available: false, storeRoot, sessions: [] };
    }
  });

  app.get('/api/context-lifecycle/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!SESSION_ID.test(sessionId)) {
      return reply.code(400).send({ error: 'invalid-session-id' });
    }
    const file = join(storeRoot, `${sessionId}${FILE_SUFFIX}`);
    try {
      const stats = await stat(file);
      if (!stats.isFile() || stats.size > MAX_STORE_BYTES) {
        return reply.code(404).send({ error: 'no-store' });
      }
      return {
        sessionId,
        modifiedAt: stats.mtime.toISOString(),
        sections: parseSections(await readFile(file, 'utf8')),
      };
    } catch {
      return reply.code(404).send({ error: 'no-store' });
    }
  });
}
