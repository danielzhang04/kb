/**
 * U9 — read-only projection of the model-verify audit log.
 *
 *   GET /api/model-audit → the parsed rows, plus where the log lives and when it was last written
 *
 * Registered by the section owner (the wiring commit), exactly like the other read-only projections
 * (`registerTraceRead`, `registerAgents`, `registerContextLifecycle`): GET only, no write surface, no
 * session state. Nothing here can arm, disarm, or edit a hook — the hooks are INERT and this route
 * only reports what they WOULD have written.
 *
 * WHERE THE LOG LIVES. Not in the repo: `KB_MODEL_AUDIT_PATH` when set, else
 * `<context-store dir>/model-audit.jsonl`, which resolves the same way
 * `scripts/hooks/lib/context_store.js:storeDir()` does — `KB_CONTEXT_STORE_DIR`, else
 * `DASHBOARD_STATE_ROOT/context-lifecycle` in the daemon, then
 * `%LOCALAPPDATA%\kb-context-lifecycle` on the desktop. Hook-written per-session state is daemon-local, never
 * coordination truth (the DASHBOARD_STATE_ROOT reasoning in .gitignore). Tests inject a fixture path
 * as the second argument.
 *
 * WHY THE ROUTE SUPPLIES THE TIMESTAMP. The rows themselves carry NO clock: no hook event provides
 * one, and calling Date.now() inside a hook would make its output untestable (see the decision-note
 * in `scripts/hooks/lib/model_audit.js`). The audit FILE's mtime is the honest substitute, so it is
 * reported once for the whole log rather than faked per row.
 *
 * THE PARSER IS A DELIBERATE SECOND COPY — same reasoning as the context-lifecycle route: the hook
 * library is CommonJS under `scripts/`, outside the dashboard's TypeScript ESM graph, and importing
 * it would drag a hook runtime into the daemon bundle. JSONL is a few lines to re-read, and
 * `tests/test_model_verify.py` pins the writer's shape on the other side.
 */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { resolveStatePath } from '../../../scripts/hooks/lib/kb_paths.js';

/** Refuse to read a log that is not a log. Real ones are a few KiB. */
const MAX_LOG_BYTES = 4 * 1024 * 1024;

/** Never ship an unbounded array to the browser; the panel shows the most recent activity. */
const MAX_ROWS = 500;

/** The verdict vocabulary the hooks write. Anything else is passed through untouched and shown raw. */
export type ModelAuditVerdict = 'allowed' | 'unknown' | 'unspecified' | 'unverified' | 'match' | 'mismatch';

/** One audit row. Every field is optional because a row only ever carries what its event supplied. */
export interface ModelAuditRow {
  event?: string;
  tool?: string;
  session_id?: string | null;
  agent_id?: string | null;
  agent_type?: string | null;
  subagent_type?: string | null;
  description?: string | null;
  requested_model?: string | null;
  /** The model that answered FIRST, read off an assistant record. The verdict is computed from this. */
  observed_model?: string | null;
  /** Every model id the transcript MENTIONS — supplementary, never a verdict input. */
  observed_models?: string[];
  pairing?: string;
  verdict?: ModelAuditVerdict | string;
}

export interface ModelAuditResponse {
  /** False when the log does not exist — the EXPECTED state while the hooks are inert. */
  available: boolean;
  auditPath: string;
  /** The log file's mtime, or null when there is no file. Rows carry no timestamp of their own. */
  modifiedAt: string | null;
  /** Most recent first, capped at {@link MAX_ROWS}. */
  rows: ModelAuditRow[];
  /** How many rows the file held before the cap, so a truncated view never reads as the whole log. */
  totalRows: number;
}

/** The audit log path — `KB_MODEL_AUDIT_PATH`, else `<context-store dir>/model-audit.jsonl`. */
export function resolveAuditPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KB_MODEL_AUDIT_PATH) return env.KB_MODEL_AUDIT_PATH;
  const desktop = join(env.LOCALAPPDATA ?? join(homedir(), '.local', 'state'), 'kb-context-lifecycle');
  const base = env.KB_CONTEXT_STORE_DIR
    ?? resolveStatePath('context-lifecycle', desktop, env)!;
  return join(base, 'model-audit.jsonl');
}

/** Parse JSONL into rows, skipping blank and unparseable lines (a partial trailing line is normal). */
export function parseAuditRows(text: string): ModelAuditRow[] {
  const rows: ModelAuditRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rows.push(parsed as ModelAuditRow);
    } catch {
      // Not a row. The log is append-only, so this is a torn last line or hand-editing — skip it.
    }
  }
  return rows;
}

/** Register the read-only model-audit route. Pure read: it opens one file and writes nothing. */
export function registerModelAudit(app: FastifyInstance, auditPath: string = resolveAuditPath()): void {
  app.get('/api/model-audit', async (request): Promise<ModelAuditResponse> => {
    try {
      const stats = await stat(auditPath);
      if (!stats.isFile() || stats.size > MAX_LOG_BYTES) {
        return { available: false, auditPath, modifiedAt: null, rows: [], totalRows: 0 };
      }
      const all = parseAuditRows(await readFile(auditPath, 'utf8'));
      return {
        available: true,
        auditPath,
        modifiedAt: stats.mtime.toISOString(),
        // Most recent first: an operator opening this panel wants the dispatch they just made.
        rows: all.slice(-MAX_ROWS).reverse(),
        totalRows: all.length,
      };
    } catch (error) {
      // A missing log is the EXPECTED state while the hooks are inert — never an error page.
      request.log.debug({ err: error }, 'model audit log unreadable');
      return { available: false, auditPath, modifiedAt: null, rows: [], totalRows: 0 };
    }
  });
}
