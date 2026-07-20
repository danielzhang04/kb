/**
 * D2.9 — append-only, git-committed audit trail.
 *
 * Every consequential dashboard action (approve/steer/spawn/save/launch/...) gets exactly one row
 * appended to a dedicated NDJSON ledger, independent of Fastify's own request logs. The row is
 * appended to disk exactly once via `appendFileSync` (never a read-modify-rewrite of prior rows),
 * then committed to the `ops` branch via the CLAUDE.md coordination-write rule: `git pull --rebase
 * origin ops` -> commit -> push, where a rejected push means re-read state and retry (bounded).
 *
 * The git invocation is an injectable `OpsGitRunner` (same shape as `dashboard/server/trace/commit.ts`)
 * so tests are hermetic — they never touch the real repo or network. Only the audit ledger path is
 * ever staged (never `git add .`).
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createAsyncGitRunner, withOpsTransaction } from '../write/asyncGit.ts';
import type { OpsGitRunner } from '../write/asyncGit.ts';

/** A git invocation runner. `args` is the full argv AFTER `git`. Injected for hermetic tests. Widened
 *  to allow a `Promise` so the async default coexists with synchronous test fakes. Shared, unified type. */
export type { OpsGitRunner };

/** Default runner: the shared async git runner (spawn, off the event loop, 60s kill-timeout). gpg
 *  signing off; the repo's pre-commit hook still runs. */
export const defaultOpsGitRunner: OpsGitRunner = createAsyncGitRunner({ requireTransaction: true });

/** Relative (POSIX) path of the dedicated, append-only audit ledger under the repo root. */
export const AUDIT_REL_PATH = 'ledgers/audit/dashboard-audit.ndjson';

/**
 * One consequential action to record. `action` is the verb (`approve`, `steer`, `spawn`, `save`,
 * `launch`, ...); the rest are the consequential fields worth binding into the trail (mirrors the
 * D2.2 content-hash preimage fields where applicable) plus a free-form `detail` bag.
 */
export interface AuditEvent {
  action: string;
  cardId?: string;
  owner?: string;
  target?: string;
  riskTier?: string;
  result?: string;
  detail?: Record<string, unknown>;
}

/** An {@link AuditEvent} as written to the ledger: always carries a server-assigned timestamp. */
export interface AuditRow extends AuditEvent {
  ts: string;
}

/** Serialize one row to a single NDJSON line (a stray newline in a field must never split a row). */
function serializeRow(row: AuditRow): string {
  return `${JSON.stringify(row).replace(/\n/g, ' ')}\n`;
}

/** Absolute, OS-native path of the audit ledger under `repoRoot`. */
function auditFile(repoRoot: string): string {
  return join(repoRoot, ...AUDIT_REL_PATH.split('/'));
}

/**
 * Append `event` as one NDJSON row to the audit ledger under `repoRoot`. Purely local — no git.
 * `appendFileSync` only ever adds bytes at the end of the file; it never reads or rewrites any prior
 * row, so concurrent/repeated calls can only ever grow the ledger. Returns the row as written
 * (timestamp filled in).
 */
export function appendAuditRowLocal(
  repoRoot: string,
  event: AuditEvent,
  now: () => Date = () => new Date(),
): AuditRow {
  const file = auditFile(repoRoot);
  mkdirSync(dirname(file), { recursive: true });
  const row: AuditRow = { ts: now().toISOString(), ...event };
  appendFileSync(file, serializeRow(row), 'utf8');
  return row;
}

export interface CommitAuditOptions {
  /** Commit subject; a sensible default is used when omitted. */
  message?: string;
  /** How many extra push attempts (each preceded by a reconciling `pull --rebase`) after the first. */
  maxRetryPushes?: number;
}

/**
 * Commit the already-appended audit ledger to `ops` via pull-rebase-push, retrying a rejected push
 * after re-reading state (per CLAUDE.md: "a rejected push means: re-read state, reconcile, retry").
 * Staging is confined to the audit ledger path — the audit log shares `ops` with the fleet dispatcher
 * and other dashboard writers, so it never stages anything else.
 */
export async function commitAuditToOps(
  repoRoot: string,
  runGit: OpsGitRunner = defaultOpsGitRunner,
  options: CommitAuditOptions = {},
): Promise<void> {
  return withOpsTransaction(async () => {
  const message = options.message ?? 'chore(audit): dashboard audit row';
  const maxRetryPushes = options.maxRetryPushes ?? 3;

  const staged = (await runGit(repoRoot, ['diff', '--cached', '--name-only', '-z']))
    .split('\0').map((path) => path.trim()).filter(Boolean);
  if (staged.length > 0) throw new Error(`refusing audit commit with pre-existing staged paths: ${staged.join(', ')}`);
  // Reconcile with remote ops before writing history, stage ONLY the audit ledger, commit.
  // `--autostash` is REQUIRED: the row was already appended to the tracked ledger by the caller, so the
  // working tree is dirty and a plain `pull --rebase` aborts ("cannot pull with rebase: You have unstaged
  // changes"). Autostash shelves the pending row (and any other unstaged change in this shared checkout),
  // rebases onto origin/ops, then restores it — so only the FIRST write ever succeeded before this.
  await runGit(repoRoot, ['pull', '--rebase', '--autostash', 'origin', 'ops']);
  await runGit(repoRoot, ['add', '--', AUDIT_REL_PATH]);
  await runGit(repoRoot, ['commit', '-m', message, '--only', '--', AUDIT_REL_PATH]);

  // Push; a rejected push means re-read state (pull --rebase) and retry, bounded. The append above
  // already happened exactly once — only the push step is retried, so a retry never duplicates a row.
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetryPushes; attempt += 1) {
    try {
      await runGit(repoRoot, ['push', 'origin', 'ops']);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetryPushes) break;
      await runGit(repoRoot, ['pull', '--rebase', '--autostash', 'origin', 'ops']);
    }
  }
  throw lastErr;
  });
}

export interface AppendAuditOptions {
  runGit?: OpsGitRunner;
  maxRetryPushes?: number;
  message?: string;
  now?: () => Date;
}

/**
 * Record one consequential action end-to-end: append exactly one row to the local audit ledger,
 * then commit it to `ops` via pull-rebase-push (retrying a rejected push). This is the entry point
 * every write endpoint's middleware calls — independent of the dashboard's own Fastify request logs.
 */
export async function appendAudit(
  repoRoot: string,
  event: AuditEvent,
  options: AppendAuditOptions = {},
): Promise<AuditRow> {
  // The LOCAL append must sit inside the same lock as the commit: two interleaved appendAudits would
  // otherwise both append rows, the first commit would take both, and the second would find nothing to
  // commit and fail its caller (observed live as a PTY `audit-failed`).
  return withOpsTransaction(async () => {
    const row = appendAuditRowLocal(repoRoot, event, options.now);
    await commitAuditToOps(repoRoot, options.runGit ?? defaultOpsGitRunner, {
      message: options.message ?? `chore(audit): ${event.action}${event.cardId ? ` ${event.cardId}` : ''}`,
      maxRetryPushes: options.maxRetryPushes,
    });
    return row;
  });
}
