/**
 * G1 reconciler — the dashboard-daemon side of the merge-gate loop.
 *
 * Every few minutes it lists open `approve:merge:<pr-number>` cards and asks GitHub whether each PR is
 * merged or closed; if so it walks the gate card to `done` through the SAME governed transaction path the
 * card-respond route uses (`withOpsTransaction` -> extracted cards.py executor -> local audit row -> one
 * `commitPreparedCoordination`). Every other outcome — gh absent, a timeout, a parse fault, a branch-only
 * target, or a PR that is not yet merged — leaves the card OPEN (fail toward surfacing, never toward
 * silent closure).
 *
 * The GitHub read is a subprocess (`gh pr view`) over AMBIENT auth: the credential itself is NEVER read,
 * printed, copied, or persisted. `gh` is injected as a `GhRunner` so the whole reconciler is hermetically
 * unit-tested with no real gh/git/py.
 *
 * Live-state notion mirrors `scripts/merge_gate.py` (`LIVE_STATES = cards.STATES - {done,rejected,halted}`)
 * and keys on the card's PARSED `state`, never the directory its file sits in (the branch_hygiene N1 lesson).
 */
import { execFileSync } from 'node:child_process';
import { indexRepo } from '../planeA/indexer.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { ParsedCard } from '../planeA/cards.ts';
import { executeCardMutation } from './cardRespond.ts';
import type { CardMutationOp } from './cardRespond.ts';
import type { PyRunner } from './launch.ts';
import { withOpsTransaction } from './asyncGit.ts';
import { commitPreparedCoordination, defaultGitRunner, prepareCoordination } from './branch.ts';
import type { CoordinationPublication } from './outbox.ts';
import type { GitRunner } from './branch.ts';
import { appendAuditRowLocal, AUDIT_REL_PATH } from '../audit/log.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';

/** A gate card is LIVE until it is resolved (done), rejected, or halted — mirrors merge_gate.py LIVE_STATES
 *  by EXCLUSION so an unknown/transient state (e.g. stop-requested) is treated as live, exactly as Python's
 *  `s not in {...}` does. Keyed on parsed `state`, never directory. */
const NON_LIVE_STATES = new Set(['done', 'rejected', 'halted']);
const APPROVE_MERGE_ACTION = /^approve:merge:/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

/** The GitHub view of one PR. `null` from a {@link GhRunner} means UNKNOWN/unavailable (gh absent, a
 *  timeout, or a parse fault) — the reconciler treats it as "leave the card open". */
export type PrStatus = { merged: boolean; closed: boolean };
export type GhRunner = (prNumber: string) => PrStatus | null;

/**
 * Default `gh pr view` runner. Ambient auth — the credential is never read/printed/copied; this is a READ
 * whose stdout we parse. Any throw (gh absent, non-zero exit, timeout, malformed JSON) collapses to `null`.
 *
 * `repoRoot` PINS the subprocess `cwd` so `gh` resolves the PR against THIS repo, never whatever ambient
 * directory the daemon happens to run in — otherwise a same-numbered PR in an unrelated repo checked out
 * elsewhere could wrong-close a gate. The `exec` seam is injectable so the pinned cwd is unit-asserted.
 */
export function defaultGhRunner(
  repoRoot: string,
  timeoutMs = 15_000,
  exec: typeof execFileSync = execFileSync,
): GhRunner {
  return (prNumber) => {
    try {
      const out = exec('gh', ['pr', 'view', prNumber, '--json', 'state,mergedAt'], {
        cwd: repoRoot,
        timeout: timeoutMs,
        windowsHide: true,
        encoding: 'utf8',
      });
      const data = JSON.parse(out) as { state?: string; mergedAt?: string | null };
      const state = text(data.state).toUpperCase();
      const merged = state === 'MERGED' || (data.mergedAt != null && data.mergedAt !== '');
      const closed = state === 'CLOSED';
      return { merged, closed };
    } catch {
      return null; // gh absent / non-zero / timeout / parse fault -> unknown -> card stays open
    }
  };
}

/**
 * Pull `<target>` out of `approve:merge:<target>` and return it ONLY when it is a bare PR number. A branch
 * target (`codex/foo`, anything non-numeric) returns `null` — it is not `gh pr view`-checkable, so the
 * reconciler never gh-views it and the gate persists until a human closes it (Decision 5).
 */
export function parseMergeTarget(action: string): string | null {
  const match = /^approve:merge:(.+)$/i.exec(text(action));
  if (!match) return null;
  const target = match[1];
  return /^[0-9]+$/.test(target) ? target : null;
}

export interface ReconcileDeps {
  repoRoot: string;
  /** PR status reader. Injected in tests; default shells `gh pr view` over ambient auth. */
  gh?: GhRunner;
  /** cards.py executor — default the extracted {@link executeCardMutation}. */
  executeCardMutation?: (op: CardMutationOp, deps: { repoRoot: string; runPy?: PyRunner; prepareWrite?: (repoRoot: string) => void | Promise<void> }) => Promise<{ id: string; state: string; paths: string[] }>;
  runPy?: PyRunner;
  /** Reconcile ops before the cards.py write; default `prepareCoordination` over `opsGit`. */
  prepareWrite?: (repoRoot: string) => void | Promise<void>;
  appendAuditLocal?: (repoRoot: string, event: AuditEvent, now?: () => Date) => AuditRow;
  commitPreparedCoordination?: typeof commitPreparedCoordination;
  opsGit?: GitRunner;
  now?: () => Date;
  /** Fresh Plane-A snapshot source; default {@link indexRepo}. */
  indexRepo?: (repoRoot: string) => PlaneAIndex;
  publication?: CoordinationPublication;
  outboxRoot?: string;
}

/**
 * List open merge-gate cards, and for each PR-number target ask gh whether it is merged/closed; close the
 * gate through the governed transaction when so. Returns the card ids it `closed` and the ids it `skipped`
 * (branch-only target, gh unknown, PR not yet merged, or a mutation failure — all leave the card OPEN).
 */
export async function reconcileMergeGates(deps: ReconcileDeps): Promise<{ closed: string[]; skipped: string[] }> {
  const gh = deps.gh ?? defaultGhRunner(deps.repoRoot);
  const index = (deps.indexRepo ?? indexRepo)(deps.repoRoot);
  const execute = deps.executeCardMutation ?? executeCardMutation;
  const commit = deps.commitPreparedCoordination ?? commitPreparedCoordination;
  const appendLocal = deps.appendAuditLocal ?? appendAuditRowLocal;
  const opsGit = deps.opsGit ?? defaultGitRunner;
  const clock = deps.now ?? (() => new Date());

  const gates = Object.values(index.cards)
    .flat()
    .filter((card: ParsedCard) => APPROVE_MERGE_ACTION.test(text(card.meta.action)) && !NON_LIVE_STATES.has(text(card.meta.state)));

  const closed: string[] = [];
  const skipped: string[] = [];

  for (const card of gates) {
    const cardId = text(card.meta.id);
    const prNumber = parseMergeTarget(text(card.meta.action));
    if (prNumber === null) {
      skipped.push(cardId); // branch-only gate — never gh-checked (Decision 5)
      continue;
    }

    let status: PrStatus | null;
    try {
      status = gh(prNumber);
    } catch {
      status = null; // a throwing gh runner is treated as unknown, same as a null return
    }
    if (status === null || (!status.merged && !status.closed)) {
      skipped.push(cardId); // unknown, or not yet merged/closed -> leave OPEN (fail toward surfacing)
      continue;
    }

    // State-aware close walk — mirrors merge_gate.py close(): only a gate parked in a state with a legal
    // walk to `done` can be auto-closed. `inbox` walks inbox->working->done; `working` walks working->done
    // (a `working->working` step is illegal, so a hardcoded ['working','done'] would throw on a working
    // gate). Any OTHER live state (blocked / approvals / stop-requested / halting) has no legal walk, so
    // the gate is left OPEN (fail toward surfacing) rather than fed an illegal transition.
    const state = text(card.meta.state);
    const transitions = state === 'inbox' ? ['working', 'done'] : state === 'working' ? ['done'] : null;
    if (transitions === null) {
      skipped.push(cardId); // no legal walk to done from this live state — leave OPEN
      continue;
    }

    try {
      const disposition = status.merged ? 'merged' : 'closed';
      const iso = clock().toISOString();
      const op: CardMutationOp = {
        cardId,
        section: 'Result',
        block: `Reconciler: PR #${prNumber} ${disposition} — merge gate cleared at ${iso}.`,
        transitions,
        claimOwner: 'human-operator',
      };
      await withOpsTransaction(async () => {
        const result = await execute(op, {
          repoRoot: deps.repoRoot,
          runPy: deps.runPy,
          prepareWrite: deps.prepareWrite ?? ((repoRoot) => prepareCoordination(repoRoot, opsGit, deps.publication, deps.outboxRoot)),
        });
        appendLocal(deps.repoRoot, { action: 'merge-gate-reconcile', cardId, result: 'done', detail: { prNumber, disposition } }, deps.now);
        const [first, ...rest] = result.paths;
        if (!first) throw new Error('merge-gate reconcile produced no card paths');
        await commit(deps.repoRoot, first, {
          runGit: opsGit,
          alsoStage: [...rest, AUDIT_REL_PATH],
          message: `chore(queue): reconcile merge gate ${cardId} (PR #${prNumber} ${disposition})`,
          publication: deps.publication,
          outboxRoot: deps.outboxRoot,
        });
      });
      closed.push(cardId);
    } catch {
      // ANY failure in the mutation/commit leaves the card open — fail toward surfacing.
      skipped.push(cardId);
    }
  }

  return { closed, skipped };
}

/**
 * Start the interval poller. `intervalMs <= 0` disables it (returns a no-op stop fn — Decision 2's
 * fail-safe: since every reconciler failure leaves cards open, disabling it just stops auto-closing).
 * Each tick is wrapped so a throw can never kill the daemon, and overlapping ticks are skipped. The timer
 * is unref'd so it never keeps the process alive on its own. Returns a stop fn for the shutdown path.
 */
export function startMergeGateReconciler(deps: ReconcileDeps, intervalMs: number): () => void {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // never overlap a slow reconcile with the next tick
    running = true;
    try {
      await reconcileMergeGates(deps);
    } catch {
      // swallow — a reconcile throw must never crash the daemon (fail toward surfacing: cards stay open)
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
