/**
 * Stranded-card auto-archiver — the daemon-side sweep that retires abandoned cards out of the active
 * queue instead of surfacing them to the operator (APPROVED DESIGN, Daniel 2026-07-21).
 *
 * A card is STRANDED, and only then MOVED to `queue/archived/`, when ALL THREE hold:
 *   1. its owner is a REAL agent — not `human-operator` (an operator gate the Human Inbox already shows),
 *      and not null/empty (an unassigned card no runner owns);
 *   2. it is idle in `inbox` or `working` and older than 24h — age derived PURELY from the card id's
 *      8-hex unix-epoch-seconds prefix (`cards.new_id`), exactly like humanInbox/brief; a non-hex id
 *      yields an UNKNOWN age and is NEVER archived; and
 *   3. the owner's runner is OFFLINE per the shared `ownerLiveness` probe — a card whose runner is
 *      ONLINE (merely slow) is left alone.
 *
 * Every archive walks the card through the SAME governed transaction path the card-respond route uses
 * (`withOpsTransaction` -> extracted `executeCardMutation` over cards.py -> local audit row -> one
 * `commitPreparedCoordination`), recording a `## Result` note. The card is MOVED, never deleted, and the
 * `archived -> inbox` transition (cards.py LEGAL) makes it reversible: a human reopens by un-archiving.
 *
 * Fail-safe in every direction: a bad index, a throwing/failed liveness probe, an unknown age, or any
 * mutation/commit fault leaves the card UNTOUCHED — the loop fails toward NOT archiving. The liveness
 * probe reuses the built-in schtasks TTL cache + hard timeout, so a slow schtasks can never block a tick.
 */
import { indexRepo as defaultIndexRepo } from '../planeA/indexer.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { ParsedCard } from '../planeA/cards.ts';
import { executeCardMutation } from './cardRespond.ts';
import type { CardMutationOp } from './cardRespond.ts';
import type { PyRunner } from './launch.ts';
import { withOpsTransaction } from './asyncGit.ts';
import { commitPreparedCoordination, defaultGitRunner, prepareCoordination } from './branch.ts';
import type { GitRunner } from './branch.ts';
import { appendAuditRowLocal, AUDIT_REL_PATH } from '../audit/log.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import { ownerLiveness } from '../runner/liveness.ts';
import type { OwnerLiveness, SchtasksRunner, LivenessCache } from '../runner/liveness.ts';

/** The owner id the dispatchers assign to a card only a human can move — NEVER archived (it is an
 *  operator gate the Human Inbox surfaces). Byte-identical to humanInbox.HUMAN_OPERATOR. */
const HUMAN_OPERATOR = 'human-operator';
/** Only these two live states are ever eligible; every terminal/transient state is skipped. */
const ARCHIVABLE_STATES = new Set(['inbox', 'working']);
/** Idle threshold — 24h. Mirrors humanInbox/brief STRANDED_AGE_MS. */
const STRANDED_AGE_MS = 24 * 60 * 60 * 1000;
/** `cards.new_id` prefixes every id with an 8-hex unix-epoch-seconds stamp; a non-matching id (legacy /
 *  hand-authored) yields an UNKNOWN age and is therefore NEVER archived. Mirrors humanInbox CARD_ID_EPOCH_RE. */
const CARD_ID_EPOCH_RE = /^([0-9a-f]{8})-/;

/** The exact `## Result` marker prefix the archiver writes, carrying a parseable ISO timestamp. Kept in
 *  lockstep with `scripts/stranded_report.py` ARCHIVE_MARKER so the weekly-audit report can window by it. */
export const ARCHIVE_MARKER = 'Auto-archived by the stranded-archiver';

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

/** Age of a card in ms from its id's epoch prefix, or `null` when the id carries none (unknown age =>
 *  never archived). Pure over `nowMs` so the sweep is fixture-testable with no clock/mtime read. */
export function cardAgeMs(card: ParsedCard, nowMs: number): number | null {
  const match = CARD_ID_EPOCH_RE.exec(text(card.meta.id));
  if (!match) return null;
  const epochSec = parseInt(match[1], 16);
  if (!Number.isFinite(epochSec)) return null;
  return nowMs - epochSec * 1000;
}

/** Owner-offline probe — `(owner, card) => OwnerLiveness`. Injected in tests; the default wraps the
 *  shared `ownerLiveness` over the schtasks seam + TTL cache so it never blocks the tick. */
export type LivenessProbe = (owner: string, card: ParsedCard) => OwnerLiveness;

export interface StrandedArchiveDeps {
  repoRoot: string;
  now?: () => Date;
  /** Fresh Plane-A snapshot source; default {@link defaultIndexRepo}. */
  indexRepo?: (repoRoot: string) => PlaneAIndex;
  /** Owner-offline probe; default wraps {@link ownerLiveness} over the schtasks/cache seams below. */
  liveness?: LivenessProbe;
  schtasksRun?: SchtasksRunner;
  livenessCache?: LivenessCache;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  /** cards.py executor — default the extracted {@link executeCardMutation}. */
  executeCardMutation?: (op: CardMutationOp, deps: { repoRoot: string; runPy?: PyRunner; prepareWrite?: (repoRoot: string) => void | Promise<void> }) => Promise<{ id: string; state: string; paths: string[] }>;
  runPy?: PyRunner;
  /** Reconcile ops before the cards.py write; default `prepareCoordination` over `opsGit`. */
  prepareWrite?: (repoRoot: string) => void | Promise<void>;
  appendAuditLocal?: (repoRoot: string, event: AuditEvent, now?: () => Date) => AuditRow;
  commitPreparedCoordination?: typeof commitPreparedCoordination;
  opsGit?: GitRunner;
}

/**
 * One sweep: list active cards, and for each one that is stranded (real-agent owner + idle >24h + owner
 * runner offline) MOVE it to `queue/archived/` through the governed transaction. Returns the ids it
 * `archived` and the ids it `skipped` (any of the three conditions unmet, a liveness fault, or a mutation
 * failure — all leave the card untouched).
 */
export async function archiveStrandedCards(deps: StrandedArchiveDeps): Promise<{ archived: string[]; skipped: string[] }> {
  const index = (deps.indexRepo ?? defaultIndexRepo)(deps.repoRoot);
  const execute = deps.executeCardMutation ?? executeCardMutation;
  const commit = deps.commitPreparedCoordination ?? commitPreparedCoordination;
  const appendLocal = deps.appendAuditLocal ?? appendAuditRowLocal;
  const opsGit = deps.opsGit ?? defaultGitRunner;
  const clock = deps.now ?? (() => new Date());
  const nowMs = clock().getTime();
  const liveness: LivenessProbe = deps.liveness ?? ((owner, card) => ownerLiveness(owner, card, {
    run: deps.schtasksRun,
    cache: deps.livenessCache,
    now: deps.now ? () => deps.now!().getTime() : undefined,
    platform: deps.platform,
    env: deps.env,
  }));

  const cards = Object.values(index.cards).flat();
  const archived: string[] = [];
  const skipped: string[] = [];

  for (const card of cards) {
    const cardId = text(card.meta.id);
    const state = text(card.meta.state);
    // Condition 2a: only a live inbox/working card is ever eligible.
    if (!ARCHIVABLE_STATES.has(state)) continue;
    // Condition 1: owner must be a REAL agent — never human-operator, never unowned.
    const owner = text(card.meta.owner);
    if (owner === '' || owner === HUMAN_OPERATOR) continue;
    // Condition 2b: idle strictly longer than 24h; unknown age (non-hex id) is never archived.
    const age = cardAgeMs(card, nowMs);
    if (age === null || age <= STRANDED_AGE_MS) continue;

    // Condition 3: the owner's runner must be OFFLINE. A throwing probe is treated as UNKNOWN and the
    // card is left untouched (fail toward NOT archiving), never as offline.
    let live: OwnerLiveness;
    try {
      live = liveness(owner, card);
    } catch {
      skipped.push(cardId);
      continue;
    }
    if (live.online) {
      skipped.push(cardId); // owner is online (merely slow) — never archive a live card
      continue;
    }

    // All three hold — MOVE the card to queue/archived/ through the governed transaction. A single legal
    // step (inbox->archived or working->archived, cards.py LEGAL); the card is already owned so no claim.
    try {
      const iso = clock().toISOString();
      const op: CardMutationOp = {
        cardId,
        section: 'Result',
        block: `${ARCHIVE_MARKER} (${iso}):\nauto-archived: stranded >24h, owner ${owner} offline, not revisited per policy (reversible: move to inbox to reopen)`,
        transitions: ['archived'],
        claimOwner: null,
      };
      await withOpsTransaction(async () => {
        const result = await execute(op, {
          repoRoot: deps.repoRoot,
          runPy: deps.runPy,
          prepareWrite: deps.prepareWrite ?? ((repoRoot) => prepareCoordination(repoRoot, opsGit)),
        });
        appendLocal(deps.repoRoot, { action: 'stranded-archive', cardId, result: 'archived', detail: { owner, ageMs: age, liveness: live.detail } }, deps.now);
        const [first, ...rest] = result.paths;
        if (!first) throw new Error('stranded-archive produced no card paths');
        await commit(deps.repoRoot, first, {
          runGit: opsGit,
          alsoStage: [...rest, AUDIT_REL_PATH],
          message: `chore(queue): auto-archive stranded card ${cardId} (owner ${owner} offline)`,
        });
      });
      archived.push(cardId);
    } catch {
      // ANY failure in the mutation/commit leaves the card in place — fail toward NOT archiving.
      skipped.push(cardId);
    }
  }

  return { archived, skipped };
}

/**
 * Start the interval sweeper. `intervalMs <= 0` (or non-finite) disables it (returns a no-op stop fn) —
 * the fail-safe default, since disabling only stops auto-archiving and never strands a card the other way.
 * Each tick is wrapped so a throw can never kill the daemon; overlapping ticks are skipped; the timer is
 * unref'd so it never keeps the process alive; the returned stop fn is registered on shutdown.
 */
export function startStrandedArchiver(deps: StrandedArchiveDeps, intervalMs: number): () => void {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // never overlap a slow sweep with the next tick
    running = true;
    try {
      await archiveStrandedCards(deps);
    } catch {
      // swallow — a sweep throw must never crash the daemon (fail toward NOT archiving)
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
