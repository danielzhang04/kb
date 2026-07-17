/**
 * D2.4 — approvals inbox view: ranked pending cards + a corroborable challenge panel.
 *
 * Selecting a pending card renders a "corroboration panel" showing exactly what the signature will
 * cover — `card_id` + `action` + `risk-tier` (and, since gate D2.11 bound the `## Work order` body into
 * the WebAuthn `content_hash`, the body too, extracted the same fence-aware way `auth/challenge.ts`
 * does) — from the COMMITTED card, BEFORE any biometric prompt. This is load-bearing: the panel is
 * rendered purely from the `pending` prop the server already indexed (no fetch here) the instant a card
 * is selected, and `onVerify` only ever fires on an EXPLICIT verify-button click. This component never
 * calls into WebAuthn itself (no `navigator.credentials`/`performAssertion` import) — it only reports
 * "the operator picked channel X for card Y" upward via `onVerify`; the actual ceremony + the D2.3
 * dispatcher-side re-verify (`server/approvals/inbox.ts#driveVerify`) are a separate seam, so the
 * ordering invariant (show-then-prompt) can never be violated by this file re-ordering its own calls.
 *
 * `## Evidence` is NEVER surfaced here — untrusted/inert data per the card schema, not corroborable
 * signed content.
 */
import { useState } from 'react';
import type { ParsedCard } from '../../server/planeA/cards';
import { buttonsFor } from '../../server/approvals/assurance';
import { workOrderOf } from '../../server/auth/challenge';

export type ApprovalChannel = 'signed' | 'possession' | 'webauthn';

export interface ApprovalsProps {
  pending: ParsedCard[];
  /** Fires ONLY on an explicit verify-button click — never on selection/render. */
  onVerify?: (cardId: string, channel: ApprovalChannel) => void;
}

function riskLabel(card: ParsedCard): string {
  const v = card.meta['risk-tier'];
  return typeof v === 'string' ? v : String(v ?? '');
}

/** `workOrderOf` throws when a card has no `## Work order` section — never let a malformed body crash
 *  the corroboration panel; just omit that line of the panel. */
function safeWorkOrder(body: string): string | null {
  try {
    return workOrderOf(body);
  } catch {
    return null;
  }
}

export function Approvals({ pending, onVerify }: ApprovalsProps): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = pending.find((c) => c.meta.id === selectedId) ?? null;
  const workOrder = selected ? safeWorkOrder(selected.body) : null;
  const buttons = selected ? buttonsFor(selected) : null;

  return (
    <div className="approvals" aria-label="Approvals inbox">
      <ul className="approvals__list">
        {pending.map((card) => (
          <li key={card.meta.id}>
            <button type="button" onClick={() => setSelectedId(card.meta.id)}>
              {card.meta.id} · {riskLabel(card)}
            </button>
          </li>
        ))}
      </ul>

      {selected && buttons ? (
        <section aria-label="Corroboration panel" data-testid="corroboration-panel">
          <h2>Corroborate before you approve</h2>
          <p data-testid="corrob-card-id">Card: {selected.meta.id}</p>
          <p data-testid="corrob-action">Action: {selected.meta.action}</p>
          <p data-testid="corrob-risk-tier">Risk tier: {riskLabel(selected)}</p>
          {workOrder !== null ? (
            <pre data-testid="corrob-work-order">{workOrder}</pre>
          ) : null}

          <div className="approvals__buttons">
            {buttons.signed ? (
              <button type="button" onClick={() => onVerify?.(selected.meta.id, 'signed')}>
                Verify (signed)
              </button>
            ) : null}
            {buttons.possession ? (
              <button type="button" onClick={() => onVerify?.(selected.meta.id, 'possession')}>
                Verify (possession)
              </button>
            ) : null}
            {buttons.webauthn ? (
              <button type="button" onClick={() => onVerify?.(selected.meta.id, 'webauthn')}>
                Verify (WebAuthn)
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
