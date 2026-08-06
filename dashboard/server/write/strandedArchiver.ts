/**
 * Stranded-card auto-archiver — v2 (redesign 2026-07-21). The daemon-side sweep that retires ABANDONED
 * cards out of the active queue. This version corrects the held build's liveness defect and ships
 * DRY-RUN-ONLY, DEFAULT-OFF.
 *
 * WHAT WENT WRONG IN v1 (`claude/stranded-archiver` @ ced3716, HELD): it gated abandonment on
 * `ownerLiveness().online === false` — a G3 PID/start-time reply-liveness badge whose closed runner map covers
 * ONLY `codex-worker`. Every `claude-*` / `dispatcher-cloud` / `worker-desktop` owner therefore read
 * `online:false` and would have been archived; a MISSING schtasks task was silently converted into "the
 * agent abandoned this card." On the live queue that would have wrongly archived two 84h worker-desktop
 * cadence cards on the first tick.
 *
 * THE CORRECTED MODEL — a card is STRANDED, and only then MOVED to `queue/archived/`, when ALL hold:
 *   1. owner is a REAL agent — not `human-operator` (an operator gate the Human Inbox surfaces), not
 *      null/empty (an unowned card no runner consumes);
 *   2. it is in `inbox` or `working` (every terminal/transient state is skipped);
 *   3. CARD-IDLE past the window: `now - max(idEpoch(C), lastBodyWriteTs(C)) > WINDOW`. `idEpoch` is the
 *      card id's 8-hex unix-epoch prefix (non-hex id => UNKNOWN age => NEVER archived, unchanged);
 *      `lastBodyWriteTs` is the newest ISO timestamp inside the card's OWN trusted `## Result` / `##
 *      Feedback` sections — never `## Evidence`, which stays inert. An agent that wrote a Result note
 *      recently has not abandoned the card even if the id is old;
 *   4. OWNER-IDLE past the window: `now - ownerLastActivity > WINDOW`, where owner activity is the newest
 *      of the owner's real artifacts (dispatch/activity ledger shards, `memory/<owner>.md`, a commit
 *      authored by the owner — see {@link OwnerActivityReader}) OR the card's own last body write. **If the
 *      owner leaves NO observable footprint at all, owner-idle is UNKNOWN => treat as ALIVE => SKIP.** This
 *      is the single most important inversion vs v1: unknown owner ⇒ alive, not dead;
 *   5. schtasks is a VETO ONLY: if `ownerLiveness` AFFIRMATIVELY returns `online:true`, SKIP. Any
 *      non-affirmative result (null map, error, Disabled) does NOT authorize archiving — it merely fails
 *      to veto; predicates 3+4 still gate;
 *   6. a `execution-controller: dashboard` card is the Wave-A bridge's to consume — SKIP unless the bridge
 *      is active (it is not today).
 *
 * DRY-RUN-ONLY THIS SHIP: `dryRun` defaults TRUE. In dry-run the sweep computes the FULL decision and emits
 * a report line for every card it WOULD archive, but performs NO move, NO commit, NO audit write. The live
 * MOVE path (the governed `withOpsTransaction` -> `executeCardMutation` -> local audit -> single
 * `commitPreparedCoordination`, MOVE-not-delete with `archived -> inbox` reversibility) is retained but
 * runs only when `dryRun === false`, which the wiring never sets until Daniel answers the policy questions.
 *
 * Fail-safe in every direction: unknown age => skip (existing); unknown owner-activity => skip (NEW);
 * throwing probe => no veto (proceed on 3+4 only, per the veto-only rule); any mutation/commit fault =>
 * skip (existing). The loop always fails toward NOT archiving.
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
import type { OwnerLiveness, RunnerStateReader, ProcessStartTimeReader, LivenessCache } from '../runner/liveness.ts';
import { defaultOwnerActivity } from './ownerActivity.ts';
import type { OwnerActivity, OwnerActivityReader } from './ownerActivity.ts';

/** The owner id the dispatchers assign to a card only a human can move — NEVER archived (it is an
 *  operator gate the Human Inbox surfaces). Byte-identical to humanInbox.HUMAN_OPERATOR. */
const HUMAN_OPERATOR = 'human-operator';
/** Only these two live states are ever eligible; every terminal/transient state is skipped. */
const ARCHIVABLE_STATES = new Set(['inbox', 'working']);
/** Default abandonment window — 7 days. 24h (v1) is too short for session-based `claude-*` and daily
 *  `dispatcher-cloud`. Overridable via the injected `windowMs` (policy Q1). */
export const DEFAULT_STRANDED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** `cards.new_id` prefixes every id with an 8-hex unix-epoch-seconds stamp; a non-matching id (legacy /
 *  hand-authored) yields an UNKNOWN age and is therefore NEVER archived. Mirrors humanInbox CARD_ID_EPOCH_RE. */
const CARD_ID_EPOCH_RE = /^([0-9a-f]{8})-/;
/** The card's OWN trusted sections whose timestamps count as a body write. `## Evidence` is DELIBERATELY
 *  excluded — it is inert data (constitution) and must never be able to keep a card alive or spoof one. */
const TRUSTED_BODY_SECTIONS = ['Result', 'Feedback'];
/** ISO-8601 timestamp shapes we accept inside a trusted section (with or without seconds / fractional /
 *  offset). Parsed with `Date.parse`; the newest valid one is the body-write time. */
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;

/** The exact `## Result` marker prefix the archiver writes, carrying a parseable ISO timestamp. Kept in
 *  lockstep with `scripts/stranded_report.py` ARCHIVE_MARKER so the weekly-audit report can window by it. */
export const ARCHIVE_MARKER = 'Auto-archived by the stranded-archiver';

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

/** Epoch of a card id's 8-hex prefix in ms, or `null` when the id carries none (unknown => never archived). */
export function cardIdEpochMs(card: ParsedCard): number | null {
  const match = CARD_ID_EPOCH_RE.exec(text(card.meta.id));
  if (!match) return null;
  const epochSec = parseInt(match[1], 16);
  if (!Number.isFinite(epochSec)) return null;
  return epochSec * 1000;
}

/** Age of a card in ms from its id's epoch prefix, or `null` when the id carries none. Retained (v1 API)
 *  for the report script parity and the age unit tests. */
export function cardAgeMs(card: ParsedCard, nowMs: number): number | null {
  const epoch = cardIdEpochMs(card);
  return epoch === null ? null : nowMs - epoch;
}

/** Text of one `## <section>` block (up to the next `## ` header / EOF), mirroring the stripped-header /
 *  `startsWith('## ')` rule the Python surfaces use — so a timestamp is only ever read inside its own
 *  named section and `## Evidence` is never entered. */
function sectionText(body: string, section: string): string {
  const lines = text(body).split(/\r?\n/);
  const header = `## ${section}`;
  const start = lines.findIndex((ln) => ln.trim() === header);
  if (start === -1) return '';
  const rest: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) break;
    rest.push(lines[i]);
  }
  return rest.join('\n');
}

/** Newest ISO timestamp (ms) inside the card's TRUSTED body sections, or `null` when none parse. Guards
 *  against future-dated spoofs by ignoring any timestamp after `nowMs`. NEVER reads `## Evidence`. */
export function lastBodyWriteMs(card: ParsedCard, nowMs: number): number | null {
  let best: number | null = null;
  for (const section of TRUSTED_BODY_SECTIONS) {
    const chunk = sectionText(card.body, section);
    if (!chunk) continue;
    for (const raw of chunk.match(ISO_TS_RE) ?? []) {
      const ms = Date.parse(raw);
      if (!Number.isFinite(ms) || ms > nowMs) continue; // ignore unparseable / future-dated
      if (best === null || ms > best) best = ms;
    }
  }
  return best;
}

/** Owner-offline probe — `(owner, card) => OwnerLiveness`. Injected in tests; the default wraps the shared
 *  `ownerLiveness` over the schtasks seam + TTL cache. Used here as a VETO ONLY (affirmative online => skip). */
export type LivenessProbe = (owner: string, card: ParsedCard) => OwnerLiveness;

/** One card's fully-computed decision, surfaced for the dry-run report and (in future) a dashboard surface. */
export interface StrandedDecision {
  cardId: string;
  owner: string;
  state: string;
  cardIdleMs: number | null;
  ownerIdleMs: number | null;
  ownerActivitySources: OwnerActivity['sources'];
  liveness: string;
  /** The predicate verdict IGNORING dry-run — true means "this card meets every archive condition". */
  wouldArchive: boolean;
  /** Why it was skipped (present only when `wouldArchive` is false), for the report. */
  skipReason?: string;
}

export interface StrandedArchiveDeps {
  repoRoot: string;
  now?: () => Date;
  /** Abandonment window in ms; default {@link DEFAULT_STRANDED_WINDOW_MS} (7 days). */
  windowMs?: number;
  /** DRY-RUN gate — default TRUE. When true the sweep computes decisions and reports but MOVES nothing. */
  dryRun?: boolean;
  /** Whether the Wave-A dashboard bridge is active; default false => `execution-controller: dashboard`
   *  cards are the bridge's to consume and are SKIPPED. */
  dashboardBridgeActive?: boolean;
  /** Optional structured sink for dry-run decisions (a card the sweep WOULD archive). Default: no-op. */
  logDryRun?: (decision: StrandedDecision) => void;
  /** Fresh Plane-A snapshot source; default {@link defaultIndexRepo}. */
  indexRepo?: (repoRoot: string) => PlaneAIndex;
  /** Owner-activity reader (the corrected owner-idle clock); default {@link defaultOwnerActivity}. */
  ownerActivity?: OwnerActivityReader;
  /** Owner-offline probe (VETO ONLY); default wraps {@link ownerLiveness} over the schtasks/cache seams. */
  liveness?: LivenessProbe;
  runnerState?: RunnerStateReader;
  runnerProcessStartTime?: ProcessStartTimeReader;
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

export interface StrandedArchiveResult {
  /** Ids actually MOVED to queue/archived/ this sweep (always empty in dry-run). */
  archived: string[];
  /** Ids that met every predicate — MOVED (live) or merely reported (dry-run). */
  wouldArchive: string[];
  /** Ids left untouched (a predicate unmet, unknown owner, veto, or a mutation fault). */
  skipped: string[];
  /** Full per-eligible-card decisions, for the dry-run report / future dashboard surface. */
  decisions: StrandedDecision[];
}

/**
 * One sweep. For each `inbox`/`working` card owned by a REAL agent, decide via the §2 predicates whether it
 * is stranded (BOTH card-idle AND owner-idle past the window, no affirmative online veto). In dry-run
 * (default) it REPORTS the cards it would archive and moves nothing; live, it MOVES each through the
 * governed transaction. Every failure/unknown leaves the card untouched.
 */
export async function archiveStrandedCards(deps: StrandedArchiveDeps): Promise<StrandedArchiveResult> {
  const index = (deps.indexRepo ?? defaultIndexRepo)(deps.repoRoot);
  const execute = deps.executeCardMutation ?? executeCardMutation;
  const commit = deps.commitPreparedCoordination ?? commitPreparedCoordination;
  const appendLocal = deps.appendAuditLocal ?? appendAuditRowLocal;
  const opsGit = deps.opsGit ?? defaultGitRunner;
  const clock = deps.now ?? (() => new Date());
  const nowMs = clock().getTime();
  const windowMs = deps.windowMs ?? DEFAULT_STRANDED_WINDOW_MS;
  const dryRun = deps.dryRun ?? true; // DRY-RUN-ONLY this ship: default true
  const bridgeActive = deps.dashboardBridgeActive ?? false;
  const ownerActivity = deps.ownerActivity ?? ((owner, repoRoot) => defaultOwnerActivity(owner, repoRoot));
  const liveness: LivenessProbe = deps.liveness ?? ((owner, card) => ownerLiveness(owner, card, {
    readState: deps.runnerState,
    processStartTime: deps.runnerProcessStartTime,
    cache: deps.livenessCache,
    now: deps.now ? () => deps.now!().getTime() : undefined,
    env: deps.env,
  }));

  const cards = Object.values(index.cards).flat();
  const archived: string[] = [];
  const wouldArchive: string[] = [];
  const skipped: string[] = [];
  const decisions: StrandedDecision[] = [];

  for (const card of cards) {
    const cardId = text(card.meta.id);
    const state = text(card.meta.state);
    // Predicate 2: only a live inbox/working card is ever eligible.
    if (!ARCHIVABLE_STATES.has(state)) continue;
    // Predicate 1: owner must be a REAL agent — never human-operator, never unowned.
    const owner = text(card.meta.owner);
    if (owner === '' || owner === HUMAN_OPERATOR) continue;
    // Predicate 6: a dashboard-executed card is the Wave-A bridge's to consume, never the archiver's.
    if (text(card.meta['execution-controller']) === 'dashboard' && !bridgeActive) {
      skipped.push(cardId);
      decisions.push({ cardId, owner, state, cardIdleMs: null, ownerIdleMs: null, ownerActivitySources: [], liveness: 'n/a', wouldArchive: false, skipReason: 'execution-controller: dashboard (bridge inactive)' });
      continue;
    }

    // Predicate 3 — CARD-IDLE. idEpoch UNKNOWN (non-hex id) => never archived. Fold in the card's own last
    // trusted body write so a recently-noted card is not treated as idle even with an old id.
    const idEpochMs = cardIdEpochMs(card);
    if (idEpochMs === null) continue; // unknown age — never archive (fail-safe, unchanged)
    const bodyMs = lastBodyWriteMs(card, nowMs);
    const cardLastTouchMs = Math.max(idEpochMs, bodyMs ?? Number.NEGATIVE_INFINITY);
    const cardIdleMs = nowMs - cardLastTouchMs;
    if (cardIdleMs <= windowMs) {
      skipped.push(cardId);
      decisions.push({ cardId, owner, state, cardIdleMs, ownerIdleMs: null, ownerActivitySources: [], liveness: 'not-probed', wouldArchive: false, skipReason: `card-idle ${Math.round(cardIdleMs / 3.6e6)}h <= window` });
      continue;
    }

    // Predicate 4 — OWNER-IDLE. Newest of the owner's real artifacts OR the card's own body write. If NONE
    // resolve (owner never observed), owner-idle is UNKNOWN => treat as ALIVE => SKIP (the key inversion).
    // A THROWING reader is itself UNKNOWN — we cannot observe the owner at all, so it must force SKIP
    // outright, NOT fall through to a body-only owner clock (which could archive off one stale ## Result
    // timestamp). This is the same fail direction as unknown-owner: absence of evidence never authorizes.
    let activity: OwnerActivity;
    try {
      activity = ownerActivity(owner, deps.repoRoot);
    } catch {
      skipped.push(cardId);
      decisions.push({ cardId, owner, state, cardIdleMs, ownerIdleMs: null, ownerActivitySources: [], liveness: 'not-probed', wouldArchive: false, skipReason: 'owner-activity reader threw => UNKNOWN => treated as ALIVE' });
      continue;
    }
    const ownerLastMs = Math.max(activity.lastActivityMs ?? Number.NEGATIVE_INFINITY, bodyMs ?? Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(ownerLastMs)) {
      skipped.push(cardId);
      decisions.push({ cardId, owner, state, cardIdleMs, ownerIdleMs: null, ownerActivitySources: activity.sources, liveness: 'not-probed', wouldArchive: false, skipReason: 'owner-idle UNKNOWN (owner unobserved) => treated as ALIVE' });
      continue;
    }
    const ownerIdleMs = nowMs - ownerLastMs;
    if (ownerIdleMs <= windowMs) {
      skipped.push(cardId);
      decisions.push({ cardId, owner, state, cardIdleMs, ownerIdleMs, ownerActivitySources: activity.sources, liveness: 'not-probed', wouldArchive: false, skipReason: `owner-idle ${Math.round(ownerIdleMs / 3.6e6)}h <= window` });
      continue;
    }

    // Predicate 5 — schtasks VETO ONLY. Affirmative online => skip. A throwing/non-affirmative probe does
    // NOT veto (and does NOT authorize) — predicates 3+4 already authorized, so the sweep proceeds.
    let livenessDetail = 'no affirmative online veto';
    try {
      const live = liveness(owner, card);
      if (live.online) {
        skipped.push(cardId);
        decisions.push({ cardId, owner, state, cardIdleMs, ownerIdleMs, ownerActivitySources: activity.sources, liveness: `VETO: ${live.detail}`, wouldArchive: false, skipReason: 'schtasks affirmatively ONLINE (veto)' });
        continue;
      }
      livenessDetail = `no veto (${live.detail})`;
    } catch {
      livenessDetail = 'no veto (probe threw)';
    }

    // Every predicate holds — this card is STRANDED.
    const decision: StrandedDecision = { cardId, owner, state, cardIdleMs, ownerIdleMs, ownerActivitySources: activity.sources, liveness: livenessDetail, wouldArchive: true };
    decisions.push(decision);
    wouldArchive.push(cardId);

    if (dryRun) {
      // DRY-RUN: report exactly what WOULD be archived; write nothing (no move, no commit, no audit row).
      try { deps.logDryRun?.(decision); } catch { /* a logging fault must never affect the sweep */ }
      continue;
    }

    // LIVE MOVE — MOVE the card to queue/archived/ through the SAME governed transaction the respond route
    // uses. A single legal step (inbox->archived or working->archived, cards.py LEGAL); already owned so no
    // claim. This path is UNREACHABLE until the wiring flips dryRun off (policy Q3/Q4/Q5).
    try {
      const iso = clock().toISOString();
      const op: CardMutationOp = {
        cardId,
        section: 'Result',
        block: `${ARCHIVE_MARKER} (${iso}):\nauto-archived: stranded — card idle ${Math.round(cardIdleMs / 3.6e6)}h AND owner ${owner} idle ${Math.round(ownerIdleMs / 3.6e6)}h, both past the ${Math.round(windowMs / 3.6e6)}h window (reversible: move to inbox to reopen)`,
        transitions: ['archived'],
        claimOwner: null,
      };
      await withOpsTransaction(async () => {
        const result = await execute(op, {
          repoRoot: deps.repoRoot,
          runPy: deps.runPy,
          prepareWrite: deps.prepareWrite ?? ((repoRoot) => prepareCoordination(repoRoot, opsGit)),
        });
        appendLocal(deps.repoRoot, { action: 'stranded-archive', cardId, result: 'archived', detail: { owner, cardIdleMs, ownerIdleMs, liveness: livenessDetail } }, deps.now);
        const [first, ...rest] = result.paths;
        if (!first) throw new Error('stranded-archive produced no card paths');
        await commit(deps.repoRoot, first, {
          runGit: opsGit,
          alsoStage: [...rest, AUDIT_REL_PATH],
          message: `chore(queue): auto-archive stranded card ${cardId} (owner ${owner} idle, card idle)`,
        });
      });
      archived.push(cardId);
    } catch {
      // ANY failure in the mutation/commit leaves the card in place — fail toward NOT archiving.
      wouldArchive.pop(); // it did NOT get archived; keep wouldArchive == what was actually retired (live)
      skipped.push(cardId);
    }
  }

  return { archived, wouldArchive, skipped, decisions };
}

/**
 * Start the interval sweeper. `intervalMs <= 0` (or non-finite) disables it (returns a no-op stop fn) —
 * the DEFAULT (the wiring passes 0 until Daniel enables it). Each tick is wrapped so a throw can never kill
 * the daemon; overlapping ticks are skipped; the timer is unref'd so it never keeps the process alive; the
 * returned stop fn is registered on shutdown.
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
