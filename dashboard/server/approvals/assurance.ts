/**
 * D2.4 — `buttonsFor`: purely frontmatter-driven approval-channel gating.
 *
 * A pending card's `card.meta.assurance_class` is emitted by fleet **3.1** (`promotion.decide()`) and
 * stamped onto the card by fleet **3.4** — both already merged (fleet Wave 3). This module NEVER
 * recomputes novelty/tier itself; it only reads the class it was handed, mirroring the read-only
 * stance `scripts/notify.py#notify_pending` takes on the exact same field ("`assurance_class` MUST be
 * the value `promotion.decide()` emitted for this card — novelty is decided there (O9), never
 * recomputed here"). `buttonsFor` is the dashboard-side twin of that rule.
 */
import type { ParsedCard } from '../planeA/cards.ts';

/**
 * Mirrors `scripts/notify.py`'s `POSSESSION_ADMISSIBLE` frozenset EXACTLY — the only two assurance
 * classes a possession (tap) approval is ever offered for. `"T3-novel"` and `"signed-only"` are
 * deliberately absent (O9's fail-closed cutline: no possession button for a novel/first-ever T3, or
 * for an unknown/ambiguous class), and so is `"acts-alone"` (no approval channel is needed at all for
 * a card that never reaches the approvals boundary).
 */
const POSSESSION_ADMISSIBLE = new Set(['possession-eligible', 'T3-established']);

export interface ApprovalButtons {
  signed: boolean;
  webauthn: boolean;
  possession: boolean;
}

/**
 * Which approval buttons a pending card offers, decided PURELY from the fleet-emitted
 * `card.meta.assurance_class` frontmatter — dashboard-read-only, never recomputed.
 *
 * - `"T3-novel"` -> signed/WebAuthn ONLY, no possession button (possession is never admissible for a
 *   novel/first-time T3 — O9/D0, and `scripts/approvals.verify_telegram_approval`'s own F4 check
 *   enforces the identical rule dispatcher-side as defense-in-depth).
 * - `"possession-eligible"` (the T1/T2 case) or `"T3-established"` -> all three buttons, including
 *   possession.
 * - Anything else — missing, `"signed-only"`, `"acts-alone"`, or an unrecognized future class — fails
 *   closed to signed+WebAuthn only, the same cutline as `"T3-novel"`.
 */
export function buttonsFor(card: ParsedCard): ApprovalButtons {
  const raw = card.meta['assurance_class'];
  const assuranceClass = typeof raw === 'string' ? raw : null;
  return {
    signed: true,
    webauthn: true,
    possession: assuranceClass !== null && POSSESSION_ADMISSIBLE.has(assuranceClass),
  };
}
