/**
 * U6 — read-only run-envelope route. `GET /api/trace/:sessionId` returns the payload-elided
 * {@link RunEnvelope} for one Claude Code session JSONL. Registered exactly like the other read-only
 * projections (`registerPanels`, `registerAgents`): GET only, no write surface, no session state.
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
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { readEnvelope } from './envelope.ts';

/** Session ids are Claude Code UUID-shaped file stems. Anything else is rejected unread. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The transcript root: `DASHBOARD_TRACE_ROOT` when set, else Claude Code's default projects dir. */
export function resolveSessionRoot(): string {
  return process.env.DASHBOARD_TRACE_ROOT ?? join(homedir(), '.claude', 'projects');
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

/** Register the read-only trace route. Pure read: it opens transcripts and writes nothing. */
export function registerTraceRead(app: FastifyInstance, sessionRoot: string = resolveSessionRoot()): void {
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
