/** Read-only HTTP bridge to the local semantic-brain query CLI. */
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { resolveRepoRoot } from '../planeA/routes.ts';
import { resolvePython } from '../runtime/python.ts';

const execFile = promisify(execFileCallback);
const DEFAULT_K = 8;
const MAX_K = 20;
const QUERY_TIMEOUT_MS = 60_000;

export type RunBrainQuery = (query: string, k: number) => Promise<string>;

interface BrainSearchOptions {
  repoRoot?: string;
  runQuery?: RunBrainQuery;
  platform?: NodeJS.Platform;
}

function defaultRunQuery(repoRoot: string, platform: NodeJS.Platform): RunBrainQuery {
  const python = resolvePython(platform);
  return async (query, k) => {
    // Flags precede "--"; the query is the sole positional after it. A dash-leading query
    // (e.g. "-rf") would otherwise parse as an argparse flag and fail with the CLI's usage-error
    // exit code, which used to collide with "index not built" — see brain_query.py's
    // _StrictArgumentParser for the other half of this fix.
    const { stdout } = await execFile(
      python.command,
      [...python.prefixArgs, '-m', 'scripts.brain.brain_query', '--k', String(k), '--json', '--', query],
      { cwd: repoRoot, timeout: QUERY_TIMEOUT_MS },
    );
    return stdout;
  };
}

function validK(value: unknown): number | null {
  if (value === undefined) return DEFAULT_K;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= MAX_K ? parsed : null;
}

function exitCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'number' ? error.code : null;
}

/** The CLI's stdout on failure, when execFile rejects on a non-zero exit (Node attaches it). */
function errorStdout(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('stdout' in error)) return null;
  const stdout = (error as { stdout: unknown }).stdout;
  return typeof stdout === 'string' ? stdout : null;
}

/** Under --json the CLI emits {"error": reason} on stdout for both success- and failure-exit
 *  processes; treat that shape as the single source of truth for the unavailable reason. */
function errorReason(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const reason = (payload as Record<string, unknown>).error;
  return typeof reason === 'string' ? reason : null;
}

/** Register GET /api/brain/search. The CLI itself is read-only; no write route exists. */
export function registerBrainSearch(app: FastifyInstance, options: BrainSearchOptions = {}): void {
  const runQuery = options.runQuery ?? defaultRunQuery(
    options.repoRoot ?? resolveRepoRoot(),
    options.platform ?? process.platform,
  );
  app.get('/api/brain/search', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const q = query.q;
    const k = validK(query.k);
    if (typeof q !== 'string' || q.trim().length === 0 || q.length > 500 || k === null) {
      return reply.code(400).send({ error: 'invalid-query' });
    }
    try {
      const payload: unknown = JSON.parse(await runQuery(q, k));
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('invalid CLI JSON');
      const reason = errorReason(payload);
      if (reason !== null) return { available: false, reason };
      return payload;
    } catch (error) {
      // Server-side only: runner errors may contain local filesystem paths, so clients receive a stable reason.
      request.log.error({ err: error }, 'brain search query failed');
      const stdout = errorStdout(error);
      if (stdout !== null) {
        try {
          const reason = errorReason(JSON.parse(stdout));
          if (reason !== null) return { available: false, reason };
        } catch {
          // stdout wasn't the {"error": ...} JSON shape (e.g. a crash before the CLI could emit
          // it) — fall through to the exit-code mapping below.
        }
      }
      if (exitCode(error) === 2) return { available: false, reason: 'index-not-built' };
      return { available: false, reason: 'query-failed' };
    }
  });
}
