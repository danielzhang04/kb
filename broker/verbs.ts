/**
 * D3.3 — the Broker's five control verbs: `list`, `inspect`, `stop`, `steer`, `rerun`.
 *
 * TWO HARD BOUNDARIES enforced here (both are security invariants, not conveniences):
 *
 * 1. GRACEFUL-ONLY-FOR-BROKER-SESSIONS. `stop`, `steer`, and `rerun` are "graceful" verbs that require
 *    a live control handle. They apply ONLY to Broker-spawned sessions (`broker-sdk` / `broker-cli`,
 *    which are in the handle table). EXTERNAL sessions — a human TTY, a `claude -p` one-shot, a
 *    scheduled Routine — have no control handle the Broker owns, so they are KILL-ONLY: `stop` may
 *    SIGTERM them, but `steer` and `rerun` refuse outright (`external-session-kill-only`). This stops
 *    the Broker from pretending to steer a turn it does not actually own.
 *
 * 2. STEER MUST NEVER LAUNDER A RISK-TIER BUMP PAST APPROVAL. A `steer` may propose new card fields.
 *    If it RAISES the card's risk-tier (T1<T2<T3), it is NOT applied — it returns `needs-reapproval`
 *    and the steer text is never dispatched to the session. The re-approval BINDS via the dashboard
 *    `content_hash` preimage (`dashboard/server/auth/challenge.ts`), which INCLUDES `risk-tier`: this
 *    verb recomputes `contentHash(canonicalCardPayload(proposedCard, body))`, and because the tier is
 *    in the preimage the proposed hash necessarily differs from the approved one, so no
 *    already-collected WebAuthn signature can cover the higher-tier card — a fresh D2.2/D2.3 approval
 *    over the new hash is required.
 *
 *    WHY A TIER COMPARISON AND NOT JUST HASH-BINDING (plan §D3.3 note): the FLEET channel's
 *    `approvals.payload_hash` deliberately binds a NARROWER set (`action`+`target`+work-order, NO
 *    `risk-tier`). So a tier bump arriving over the fleet channel would NOT change that hash and would
 *    slip a pure hash-equality check. The tier comparison below is what actually catches it; the
 *    dashboard content-hash is what the resulting re-approval then binds to. Lowering or keeping the
 *    tier is allowed and applies normally (de-escalation never needs a fresh approval).
 *
 * `canonicalCardPayload` + `contentHash` are IMPORTED (read-only) from the frozen dashboard challenge
 * module — never reimplemented — so the Broker hashes a proposed card with byte-identical semantics to
 * the approval channel that will verify the re-approval.
 */
import { canonicalCardPayload, contentHash } from '../dashboard/server/auth/challenge.ts';
import { isBrokerSpawned } from './index.ts';
import type {
  RiskTier,
  SessionCard,
  SessionHandle,
  SessionOwner,
  SessionSummary,
  SpawnOutcome,
} from './index.ts';

/** Total order on risk tiers. A "raise" is a strictly-greater proposed tier. */
const TIER_RANK: Record<RiskTier, number> = { T1: 1, T2: 2, T3: 3 };

/** A proposed change carried by a `steer`. Any subset; absent fields keep the session card's value. */
export interface SteerPatch {
  action?: string;
  target?: string;
  riskTier?: RiskTier;
  owner?: string | null;
  workOrderBody?: string;
  /** The steering guidance to inject into the live turn (only dispatched if the patch is approvable). */
  guidance: string;
}

export type ListResult = { ok: true; sessions: SessionSummary[] };

export type InspectResult =
  | { ok: true; session: SessionSummary }
  | { ok: false; reason: 'no-such-session' };

export type StopResult =
  | { ok: true; mode: 'graceful' | 'kill' }
  | { ok: false; reason: 'no-such-session' };

export type SteerResult =
  | { ok: true; contentHash: string }
  | { ok: false; reason: 'no-such-session' }
  | { ok: false; reason: 'external-session-kill-only' }
  | { ok: false; reason: 'not-live' }
  | { ok: false; reason: 'needs-reapproval'; priorContentHash: string; newContentHash: string; detail: string };

export type RerunResult =
  | { ok: true; outcome: SpawnOutcome }
  | { ok: false; reason: 'no-such-session' }
  | { ok: false; reason: 'external-session-kill-only' }
  | { ok: false; reason: 'no-card-bound' };

/** VERB 1 — `list`: token-free summaries of every session the Broker knows (spawned + external). */
export function list(owner: SessionOwner): ListResult {
  return { ok: true, sessions: owner.list() };
}

/** VERB 2 — `inspect`: one session's summary (token-free), or `no-such-session`. */
export function inspect(owner: SessionOwner, id: string): InspectResult {
  const handle = owner.get(id);
  if (!handle) return { ok: false, reason: 'no-such-session' };
  const summary = owner.list().find((s) => s.id === id);
  return { ok: true, session: summary! };
}

/**
 * VERB 3 — `stop`: graceful for a Broker-spawned session (starts the escalation ladder at
 * `interrupt()`; `broker/stopWatch.ts`/a monitor drives SIGTERM→SIGKILL from there), KILL-ONLY for an
 * external session (SIGTERM — there is no handle to gracefully interrupt). Both are permitted; the
 * boundary is HOW, not WHETHER, they stop.
 */
export function stop(owner: SessionOwner, id: string): StopResult {
  const handle = owner.get(id);
  if (!handle) return { ok: false, reason: 'no-such-session' };
  if (isBrokerSpawned(handle)) {
    handle.interrupt();
    return { ok: true, mode: 'graceful' };
  }
  handle.sigterm(); // external: kill-only
  return { ok: true, mode: 'kill' };
}

/** Content hash of a card + its work-order body, via the frozen dashboard challenge preimage. */
function hashCard(card: SessionCard): string {
  return contentHash(
    canonicalCardPayload(
      { action: card.action, target: card.target, 'risk-tier': card['risk-tier'], owner: card.owner },
      card.workOrderBody,
    ),
  );
}

/** Apply a patch onto a session's card, producing the proposed post-steer card. */
function applyPatch(card: SessionCard, patch: SteerPatch): SessionCard {
  return {
    action: patch.action ?? card.action,
    target: patch.target ?? card.target,
    'risk-tier': patch.riskTier ?? card['risk-tier'],
    owner: patch.owner !== undefined ? patch.owner : card.owner,
    workOrderBody: patch.workOrderBody ?? card.workOrderBody,
  };
}

/**
 * VERB 4 — `steer`: inject guidance into a live Broker-spawned turn, UNLESS the patch raises the card's
 * risk-tier (then it refuses with `needs-reapproval` and dispatches NOTHING). External sessions are
 * refused (`external-session-kill-only`). See the module doc for the full re-approval binding rationale.
 */
export function steer(owner: SessionOwner, id: string, patch: SteerPatch): SteerResult {
  const handle = owner.get(id);
  if (!handle) return { ok: false, reason: 'no-such-session' };
  if (!isBrokerSpawned(handle)) return { ok: false, reason: 'external-session-kill-only' };
  if (!handle.live) return { ok: false, reason: 'not-live' };

  const currentCard = handle.card;
  if (currentCard) {
    const proposed = applyPatch(currentCard, patch);
    const raisesTier = TIER_RANK[proposed['risk-tier']] > TIER_RANK[currentCard['risk-tier']];
    if (raisesTier) {
      // NEVER dispatch the steer. Force a fresh approval bound to the higher-tier card's content hash.
      return {
        ok: false,
        reason: 'needs-reapproval',
        priorContentHash: hashCard(currentCard),
        newContentHash: hashCard(proposed),
        detail: `steer raises risk-tier ${currentCard['risk-tier']} -> ${proposed['risk-tier']}; a fresh WebAuthn approval over the new content hash is required`,
      };
    }
    // De-escalation or a non-tier change: dispatch the steer and report the (bound) content hash.
    handle.steer(patch.guidance);
    return { ok: true, contentHash: hashCard(proposed) };
  }

  // No card bound (e.g. an ad-hoc session): a steer cannot raise a tier it doesn't have — dispatch it.
  handle.steer(patch.guidance);
  return { ok: true, contentHash: '' };
}

/**
 * VERB 5 — `rerun`: re-spawn a Broker-spawned session's bound card as a fresh session. Refused for
 * external sessions (`external-session-kill-only`). Because it re-spawns through
 * `SessionOwner.spawnSession`, it re-runs `assertFleetRunnable()` — a rerun cannot re-activate a frozen
 * fleet (ordering-law 8).
 */
export function rerun(owner: SessionOwner, id: string, prompt: string): RerunResult {
  const handle: SessionHandle | undefined = owner.get(id);
  if (!handle) return { ok: false, reason: 'no-such-session' };
  if (!isBrokerSpawned(handle)) return { ok: false, reason: 'external-session-kill-only' };
  if (!handle.card) return { ok: false, reason: 'no-card-bound' };

  const outcome = owner.spawnSession({ cardId: handle.cardId, card: handle.card, prompt });
  return { ok: true, outcome };
}
