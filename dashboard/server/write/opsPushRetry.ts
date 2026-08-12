/**
 * The ONE `push origin ops` reconcile-and-retry primitive.
 *
 * WHY THIS EXISTS (live defect, both real bridge launches 2026-08-11 and 2026-08-12): the `ops` branch
 * has many concurrent writers — boss sessions, the fleet dispatcher, Daniel, this daemon. A coordination
 * transaction that pulls, mutates, commits and pushes loses the race whenever any of them pushes inside
 * that window, and git rejects the push non-fast-forward. That is TRANSIENT, and the repository
 * constitution already names the remedy: "A rejected push means: re-read state, reconcile, retry."
 * A launch that parked a run on a human intervention for it was implementing the opposite doctrine.
 *
 * Five identical hand-rolled retry loops used to live in `audit/log.ts`, `stop/floor.ts`,
 * `trace/commit.ts` and `write/branch.ts`, each retrying on ANY push failure and none of them safe
 * against a conflicting rebase. This module is the single seam they now share — the same file-level
 * idiom `atomicRename.ts` applied to renames.
 *
 * Three properties the hand-rolled loops did not have:
 *
 *   1. ONLY a lost race is retried. An authentication failure, a dead network, a pre-receive hook
 *      refusal or an unknown git error is NOT transient: retrying it three more times delays the park
 *      without changing its outcome, so those rethrow on the spot. Retry is gated on the git rejection
 *      markers (`non-fast-forward` / `fetch first` / `Updates were rejected because ...`).
 *   2. A CONFLICTING rebase never survives this function. `pull --rebase` replays the caller's one
 *      coordination commit onto the newer tip; if that conflicts, git leaves the checkout mid-rebase and
 *      the NEXT writer to touch this shared checkout inherits the jam (the 2026-07-30 incident class —
 *      see the guard comments in `control/canonicalResultIntegrator.ts` and `audit/log.ts`). So a failed
 *      reconcile always issues `rebase --abort` before rethrowing.
 *   3. Exhaustion rethrows the ORIGINAL rejection, so the caller's fail-loud park still reports the
 *      failure that actually started the sequence rather than the last echo of it.
 *
 * IDEMPOTENCY. Nothing here can double-apply. The caller's mutation (an appended audit row, a card
 * state transition, an emitted ledger shard) happened exactly once and is already sealed inside ONE
 * local commit before the first push; only `push` and the reconciling `pull --rebase` are repeated. A
 * rebase replays that same commit — a new SHA, byte-identical tree delta — it never re-runs the mutation
 * that produced it. Coordination state is content-addressed by exact path (`queue/**` cards are minted
 * under deterministic ids) or append-only per-writer shards (`ledgers/**`, the audit log), so replaying
 * the delta onto a newer tip is last-writer-wins per path with no merge semantics to get wrong. A path
 * a concurrent writer genuinely changed underneath us conflicts, which aborts and parks — the one case
 * that IS a human's to reconcile.
 */
import type { OpsGitRunner } from './asyncGit.ts';

/**
 * Substrings git emits when a push lost a race with another writer, lowercased for comparison. Deliberately
 * NOT `rejected` alone: `! [rejected] ops -> ops (pre-receive hook declined)` is a policy refusal that no
 * amount of rebasing will turn into an accepted push.
 */
const NON_FAST_FORWARD_MARKERS = [
  'non-fast-forward',
  'fetch first',
  'updates were rejected because',
];

/**
 * True when `error` is a push rejected because the remote moved on — the ONE transient, retryable push
 * failure. Reads `stderr`, `stdout` and `message` because the async runner truncates stderr at 512 bytes
 * when it composes the message, so the decisive marker can appear in either.
 */
export function isNonFastForwardRejection(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const text = [candidate.stderr, candidate.stdout, candidate.message]
    .filter((part): part is string => typeof part === 'string')
    .join('\n')
    .toLowerCase();
  return NON_FAST_FORWARD_MARKERS.some((marker) => text.includes(marker));
}

export interface OpsPushRetryOptions {
  repoRoot: string;
  runGit: OpsGitRunner;
  /** Extra push attempts after the first, each preceded by a reconciling pull. 0 disables retry. */
  maxRetryPushes?: number;
  /** The push argv. Defaults to the canonical coordination push. */
  pushArgs?: readonly string[];
  /** The reconciling pull argv. `audit/log.ts` needs `--autostash` here; others do not. */
  reconcileArgs?: readonly string[];
  /** Re-prove a caller precondition (e.g. the checkout is still `ops`) BEFORE each reconciling pull. */
  beforeReconcile?: () => void | Promise<void>;
  /** Re-prove caller authorization AFTER a reconcile replayed the commit onto a newer canonical head. */
  onReconciled?: () => void | Promise<void>;
}

/**
 * Push to `ops`, reconciling and retrying a lost race up to `maxRetryPushes` extra times.
 *
 * Runs entirely inside whatever `withOpsTransaction` span the caller already holds — it opens no lock of
 * its own, so it adds no new window in which another in-process writer could interleave.
 */
export async function pushOpsWithReconcile(options: OpsPushRetryOptions): Promise<void> {
  const { repoRoot, runGit } = options;
  const maxRetryPushes = options.maxRetryPushes ?? 3;
  const pushArgs = [...(options.pushArgs ?? ['push', 'origin', 'ops'])];
  const reconcileArgs = [...(options.reconcileArgs ?? ['pull', '--rebase', 'origin', 'ops'])];

  let originalError: unknown;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await runGit(repoRoot, pushArgs);
      return;
    } catch (error) {
      if (attempt === 0) originalError = error;
      // Not a lost race: auth, transport, hook refusal, unknown. Retrying cannot change the answer.
      if (!isNonFastForwardRejection(error)) throw error;
      if (attempt >= maxRetryPushes) throw originalError;
      await options.beforeReconcile?.();
      try {
        await runGit(repoRoot, reconcileArgs);
      } catch {
        // A conflicting replay is genuine divergence, not a race. Abort so this SHARED checkout is never
        // handed to the next writer mid-rebase, then park on the rejection that began the sequence —
        // the reconcile error is a consequence of it, not an independent failure.
        try { await runGit(repoRoot, ['rebase', '--abort']); } catch { /* no rebase was active */ }
        throw originalError;
      }
      await options.onReconciled?.();
    }
  }
}
