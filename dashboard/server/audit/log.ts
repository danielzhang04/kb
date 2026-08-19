/**
 * D2.9 — append-only, git-committed audit trail.
 *
 * Every consequential dashboard action (approve/steer/spawn/save/launch/...) gets exactly one row
 * appended to a dedicated NDJSON ledger, independent of Fastify's own request logs. The row is
 * appended to disk exactly once via `appendFileSync` (never a read-modify-rewrite of prior rows),
 * then — ONLY if `repoRoot` is confirmed checked out on `ops` — committed via the CLAUDE.md
 * coordination-write rule: `git pull --rebase origin ops` -> commit -> push, where a rejected push
 * means re-read state and retry (bounded). If the repo root is anything other than a confirmed `ops`
 * (a feature branch, detached HEAD, not a git repo, or the check itself failing) NO git runs at all —
 * the row still lands locally and a loud warning is logged. See `appendAudit`'s docstring for the
 * incident this guard exists to prevent.
 *
 * The git invocation is an injectable `OpsGitRunner` (same shape as `dashboard/server/trace/commit.ts`)
 * so tests are hermetic — they never touch the real repo or network. Only the audit ledger path is
 * ever staged (never `git add .`).
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { attributionLabel, currentAttribution } from '../auth/operator.ts';
import { createAsyncGitRunner, resolveCheckedOutBranch, withOpsTransaction } from '../write/asyncGit.ts';
import type { OpsGitRunner } from '../write/asyncGit.ts';
import { pushOpsWithReconcile } from '../write/opsPushRetry.ts';
import { isCoordinationPath } from '../write/branch.ts';
import { recoverUnspooledCoordinationCommits, type CoordinationPublication } from '../write/outbox.ts';

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
  /**
   * Set only on the object {@link appendAudit} RETURNS to its caller — never part of what is
   * serialized to the ledger row itself (the persisted row is byte-identical whichever path ran; see
   * `serializeRow`/`appendAuditRowLocal`). `true` when this row was also committed and pushed to
   * `origin/ops`; `false` when the repo root was not resolved to be checked out on `ops` and the row
   * stayed local-only. Absent on rows returned by `appendAuditRowLocal` directly, which never decides
   * this.
   */
  synced?: boolean;
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
  const row: AuditRow = { ts: now().toISOString(), ...attributed(event) };
  appendFileSync(file, serializeRow(row), 'utf8');
  return row;
}

/**
 * Stamp the request's operator attribution onto a row, when there is one.
 *
 * This sits at the SINGLE write point every audit row passes through, rather than in one of the wrappers
 * above it — `http/context.ts#auditFn` covers the governed routes, but `pty/route.ts` appends through its
 * own context, and a future writer would be just as easy to miss. Putting it here means no caller has to
 * know a mode exists.
 *
 * In `win32-desktop` mode nothing is ever attributed and the event is returned by IDENTITY, so rows are
 * byte-identical to before this existed. Attribution is recorded ONLY: `owner` (the session subject) still
 * decides authority, and the tailnet identity is never read back as an authentication input.
 */
function attributed(event: AuditEvent): AuditEvent {
  const attribution = currentAttribution();
  if (!attribution) return event;
  return { ...event, detail: { ...event.detail, tailnetIdentity: attributionLabel(attribution) } };
}

export interface CommitAuditOptions {
  /** Commit subject; a sensible default is used when omitted. */
  message?: string;
  /** How many extra push attempts (each preceded by a reconciling `pull --rebase`) after the first. */
  maxRetryPushes?: number;
  publication?: CoordinationPublication;
  outboxRoot?: string;
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
  if ((options.publication ?? 'direct') === 'outbox') {
    await recoverUnspooledCoordinationCommits({
      repoRoot,
      spoolRoot: options.outboxRoot ?? '/var/lib/kb/state/outbox',
      runGit,
      isCoordinationPath,
    });
  } else {
    await runGit(repoRoot, ['pull', '--rebase', '--autostash', 'origin', 'ops']);
  }
  await runGit(repoRoot, ['add', '--', AUDIT_REL_PATH]);
  await runGit(repoRoot, ['commit', '-m', message, '--only', '--', AUDIT_REL_PATH]);

  // Push; a push rejected because another ops writer got there first means re-read state (pull --rebase)
  // and retry, bounded (`write/opsPushRetry.ts`). The append above already happened exactly once — only
  // the push step is retried, so a retry never duplicates a row.
  if ((options.publication ?? 'direct') === 'outbox') {
    await recoverUnspooledCoordinationCommits({
      repoRoot,
      spoolRoot: options.outboxRoot ?? '/var/lib/kb/state/outbox',
      runGit,
      isCoordinationPath,
    });
  } else {
    await pushOpsWithReconcile({
      repoRoot,
      runGit,
      maxRetryPushes,
      // `--autostash` for the same reason the pre-commit pull above needs it: this shared checkout may
      // hold another writer's unstaged work, and a plain `pull --rebase` refuses to run over it.
      reconcileArgs: ['pull', '--rebase', '--autostash', 'origin', 'ops'],
    });
  }
  });
}

export interface AppendAuditOptions {
  runGit?: OpsGitRunner;
  maxRetryPushes?: number;
  message?: string;
  now?: () => Date;
  publication?: CoordinationPublication;
  outboxRoot?: string;
}

/** The one branch coordination writes are ever allowed to run git against (CLAUDE.md's Branch rules). */
const COORDINATION_BRANCH = 'ops';

/**
 * Record one consequential action end-to-end: append exactly one row to the local audit ledger, then
 * — ONLY if `repoRoot` is confirmed checked out on {@link COORDINATION_BRANCH} — commit it to `ops` via
 * pull-rebase-push (retrying a rejected push). This is the entry point every write endpoint's
 * middleware calls — independent of the dashboard's own Fastify request logs.
 *
 * Structural guard (the reason this branch check exists at all): a misconfigured `repoRoot` must be
 * REFUSED, not rebased. Before any git runs, the currently checked-out branch is resolved read-only
 * (`resolveCheckedOutBranch`, `git symbolic-ref --short HEAD` — never through the mutating
 * `OpsGitRunner` seam). Anything other than a confirmed "ops" — a feature branch, detached HEAD, a
 * non-git directory, or the resolution itself failing/timing out — is treated identically: NO git
 * invocation of any kind (no fetch/pull/rebase/commit/push), the row still lands in the local ledger
 * (losing the audit row is worse than not pushing it), and one loud, greppable warning is logged so the
 * misconfiguration is impossible to miss. This is a fail-CLOSED decision: ambiguity always resolves to
 * local-only, never to running git. See the 2026-07-30 incident this guard was written in response to —
 * a test harness pointed `DASHBOARD_REPO_ROOT` at a feature-branch worktree, and every real audit call
 * ran `pull --rebase --autostash origin ops` against it, starting a 549-step interactive rebase of that
 * feature branch that jammed mid-rebase on a ledger conflict.
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

    const branch = await resolveCheckedOutBranch(repoRoot);
    if (branch !== COORDINATION_BRANCH) {
      // eslint-disable-next-line no-console -- deliberately loud: this is a misconfiguration, not a
      // normal condition, and must be unmistakable when grepping daemon logs.
      console.error(
        `AUDIT-GIT-GUARD: coordination write SKIPPED for repoRoot="${repoRoot}" — checked-out branch is ` +
          `${branch === null ? 'UNRESOLVED (detached HEAD, not a git repo, or git failed/timed out)' : `"${branch}"`}, ` +
          `not "${COORDINATION_BRANCH}". The audit row for action="${event.action}" was appended to the ` +
          `LOCAL ledger only; NO git command was run (no fetch/pull/rebase/commit/push). This almost ` +
          `certainly means DASHBOARD_REPO_ROOT (or an equivalent override) points at the wrong checkout — ` +
          `fix the repo root, do not ignore this.`,
      );
      return { ...row, synced: false };
    }

    await commitAuditToOps(repoRoot, options.runGit ?? defaultOpsGitRunner, {
      message: options.message ?? `chore(audit): ${event.action}${event.cardId ? ` ${event.cardId}` : ''}`,
      maxRetryPushes: options.maxRetryPushes,
      publication: options.publication,
      outboxRoot: options.outboxRoot,
    });
    return { ...row, synced: true };
  });
}
