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
 *
 * U3 (styling/layout only): two-pane shell — a ranked pending list (highest tier first; a T3 row wears
 * a tier-t3 red left-border) and the corroboration panel wrapped in a border-strong frame with a
 * "what your signature covers" caption. The ranking is a purely presentational sort of the already-
 * indexed `pending` prop (a stable copy — the prop is never mutated); it changes nothing about the
 * verify/corroborate logic or the show-then-prompt ordering. Unavailable verify channels stay ABSENT
 * from the DOM (never rendered as disabled ghosts).
 */
import { useState } from 'react';
import type { ParsedCard } from '../../server/planeA/cards';
import { buttonsFor } from '../../server/approvals/assurance';
import { workOrderOf } from '../../server/auth/challenge';
import '../styles/views/approvals.css';

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

/** Numeric rank of a card's risk-tier for ordering/styling. `T3` -> 3, `T2` -> 2, … ; anything the
 *  regex can't read (missing/garbled) ranks 0 so it sorts to the bottom rather than jumping the queue. */
function tierRank(card: ParsedCard): number {
  const m = /t\s*([0-9]+)/i.exec(riskLabel(card));
  return m ? Number(m[1]) : 0;
}

function actionLabel(card: ParsedCard): string {
  const v = card.meta.action;
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

  // Presentational ranking only: highest tier first, original order preserved within a tier (stable
  // sort over a COPY — the `pending` prop is never mutated). This re-orders how rows are DISPLAYED and
  // touches nothing in the verify/corroborate path or the show-then-prompt ordering invariant.
  const ranked = [...pending].sort((a, b) => tierRank(b) - tierRank(a));

  if (pending.length === 0) {
    return (
      <div className="v-approvals" aria-label="Approvals inbox">
        <div className="v-approvals__empty" data-testid="approvals-empty">
          <p className="v-approvals__empty-title">No approvals waiting</p>
          <p className="v-approvals__empty-sub">Promoted cards that need your signature will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="v-approvals" aria-label="Approvals inbox">
      <div>
        <p className="v-approvals__list-head">Pending · {pending.length}</p>
        <ul className="v-approvals__list">
          {ranked.map((card) => {
            const tier = tierRank(card);
            const isSelected = card.meta.id === selectedId;
            const rowClass = [
              'v-approvals__row',
              tier >= 3 ? 'v-approvals__row--t3' : '',
              isSelected ? 'v-approvals__row--selected' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <li key={card.meta.id}>
                <button
                  type="button"
                  className={rowClass}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => setSelectedId(card.meta.id)}
                >
                  <span className="v-approvals__row-id">{card.meta.id}</span>
                  <span className={`v-approvals__row-badge mc-badge mc-badge--t${tier || 1}`}>
                    {riskLabel(card)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selected && buttons ? (
        <section
          className={`v-approvals__panel${tierRank(selected) >= 3 ? ' v-approvals__panel--t3' : ''}`}
          aria-label="Corroboration panel"
          data-testid="corroboration-panel"
        >
          <h2 className="v-approvals__panel-head">Corroborate before you approve</h2>
          <p className="v-approvals__caption">This is what your signature covers.</p>

          <div className="v-approvals__fields">
            <div className="v-approvals__field" data-testid="corrob-card-id">
              <span className="v-approvals__field-label">Card</span>
              <span className="v-approvals__field-value v-approvals__field-value--mono">
                {selected.meta.id}
              </span>
            </div>
            <div className="v-approvals__field" data-testid="corrob-action">
              <span className="v-approvals__field-label">Action</span>
              <span className="v-approvals__field-value v-approvals__field-value--mono">
                {actionLabel(selected)}
              </span>
            </div>
            <div className="v-approvals__field" data-testid="corrob-risk-tier">
              <span className="v-approvals__field-label">Risk tier</span>
              <span className="v-approvals__field-value v-approvals__field-value--mono">
                {riskLabel(selected)}
              </span>
            </div>
            {workOrder !== null ? (
              <div className="v-approvals__field">
                <span className="v-approvals__field-label">Work order</span>
                <pre className="v-approvals__work-order" data-testid="corrob-work-order">
                  {workOrder}
                </pre>
              </div>
            ) : null}
          </div>

          <div className="v-approvals__buttons">
            {buttons.signed ? (
              <button
                type="button"
                className="mc-btn mc-btn--primary"
                onClick={() => onVerify?.(selected.meta.id, 'signed')}
              >
                Verify (signed)
              </button>
            ) : null}
            {buttons.possession ? (
              <button
                type="button"
                className="mc-btn"
                onClick={() => onVerify?.(selected.meta.id, 'possession')}
              >
                Verify (possession)
              </button>
            ) : null}
            {buttons.webauthn ? (
              <button
                type="button"
                className="mc-btn mc-btn--primary"
                onClick={() => onVerify?.(selected.meta.id, 'webauthn')}
              >
                Verify (WebAuthn)
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <div className="v-approvals__placeholder" data-testid="approvals-placeholder">
          Select a pending card to see what your signature will cover.
        </div>
      )}
    </div>
  );
}
