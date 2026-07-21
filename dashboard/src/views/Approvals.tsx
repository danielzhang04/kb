/**
 * Human Inbox presentational view.
 *
 * It combines approval decisions with explicit requests for input/intervention. Selecting an item is
 * always read-only. Approval buttons verify an approval record only; the UI explicitly avoids claiming
 * that verification starts or resumes execution.
 */
import { useEffect, useState } from 'react';
import type { ParsedCard } from '../../server/planeA/cards';
import { buttonsFor } from '../../server/approvals/assurance';
import type { HumanInboxItem } from '../../server/approvals/humanInbox';
import { STOP_FILE_ITEM_ID } from '../../server/approvals/humanInbox';
import { workOrderOf } from '../../server/auth/workOrder';
import '../styles/views/approvals.css';

export type ApprovalChannel = 'signed' | 'possession' | 'webauthn';
export type RespondAction = 'reply' | 'resolve';

export interface ApprovalsProps {
  /** Unified feed. When supplied, this is the authoritative list. */
  items?: HumanInboxItem[];
  /** Backward-compatible approval-only feed while the connected container migrates. */
  pending?: ParsedCard[];
  /** Fires ONLY on an explicit verify-evidence click, never on selection/render. */
  onVerify?: (cardId: string, channel: ApprovalChannel) => void;
  /** Fires ONLY on an explicit send-reply / resolve click for an item carrying the `respond` capability. */
  onRespond?: (cardId: string, action: RespondAction, message: string) => void;
  /** True while a respond request is in flight — disables the send button (never on selection/render). */
  pendingRespond?: boolean;
}

function valueOf(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function riskLabel(card: ParsedCard): string {
  return valueOf(card.meta['risk-tier']);
}

function tierRank(card: ParsedCard): number {
  const match = /t\s*([0-9]+)/i.exec(riskLabel(card));
  return match ? Number(match[1]) : 0;
}

function safeWorkOrder(body: string): string | null {
  try {
    return workOrderOf(body);
  } catch {
    return null;
  }
}

function legacyDecision(card: ParsedCard): HumanInboxItem {
  return {
    card,
    category: 'decision',
    categoryLabel: 'Decision',
    urgency: tierRank(card) >= 3 ? 'high' : 'normal',
    status: 'Awaiting evidence verification',
    reason: 'This card is at an approval boundary.',
    nextAction: 'Review the signed scope, then verify an available approval record. Verification alone does not run or resume this card.',
    context: safeWorkOrder(card.body),
    buttons: buttonsFor(card),
  };
}

const CATEGORY_ORDER: HumanInboxItem['category'][] = ['decision', 'gate', 'input', 'intervention'];

function categoryRank(item: HumanInboxItem): number {
  return CATEGORY_ORDER.indexOf(item.category);
}

export function Approvals({ items, pending = [], onVerify, onRespond, pendingRespond = false }: ApprovalsProps): React.JSX.Element {
  const inbox = items ?? pending.map(legacyDecision);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const selected = inbox.find((item) => item.card.meta.id === selectedId) ?? null;

  // A fresh selection clears any half-typed response — the box is always scoped to the visible item.
  useEffect(() => setDraft(''), [selectedId]);

  const urgencyRank = (item: HumanInboxItem): number =>
    item.urgency === 'critical' ? 0 : item.urgency === 'high' ? 1 : item.urgency === 'normal' ? 2 : 3;
  const ranked = [...inbox].sort((a, b) => {
    if (a.urgency !== b.urgency) return urgencyRank(a) - urgencyRank(b);
    const tier = tierRank(b.card) - tierRank(a.card);
    if (tier !== 0) return tier;
    return categoryRank(a) - categoryRank(b);
  });

  const counts = inbox.reduce(
    (result, item) => ({ ...result, [item.category]: result[item.category] + 1 }),
    { decision: 0, gate: 0, input: 0, intervention: 0 },
  );

  if (inbox.length === 0) {
    return (
      <div className="v-approvals" aria-label="Human Inbox">
        <div className="v-approvals__empty" data-testid="approvals-empty">
          <p className="v-approvals__empty-title">No human attention waiting</p>
          <p className="v-approvals__empty-sub">Decisions, operator gates, questions, wake-me cards, and halted work will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="v-approvals" aria-label="Human Inbox">
      <div>
        <div className="v-approvals__summary" aria-label="Inbox category counts">
          <span><strong>{counts.decision}</strong> Decisions</span>
          <span data-testid="summary-gate"><strong>{counts.gate}</strong> Gates</span>
          <span><strong>{counts.input}</strong> Input</span>
          <span><strong>{counts.intervention}</strong> Interventions</span>
        </div>
        <p className="v-approvals__list-head">Needs you · {inbox.length}</p>
        <ul className="v-approvals__list">
          {ranked.map((item) => {
            const { card } = item;
            const tier = tierRank(card);
            const isSelected = card.meta.id === selectedId;
            const rowClass = [
              'v-approvals__row',
              tier >= 3 ? 'v-approvals__row--t3' : '',
              item.urgency === 'high' ? 'v-approvals__row--urgent' : '',
              isSelected ? 'v-approvals__row--selected' : '',
            ].filter(Boolean).join(' ');
            return (
              <li key={card.meta.id}>
                <button
                  type="button"
                  className={rowClass}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => setSelectedId(card.meta.id)}
                >
                  <span className="v-approvals__row-copy">
                    <span className="v-approvals__row-id">{card.meta.id}</span>
                    <span className="v-approvals__row-action">{valueOf(card.meta.action)}</span>
                  </span>
                  <span className="v-approvals__row-meta">
                    <span className={`v-approvals__category v-approvals__category--${item.category}`}>
                      {item.categoryLabel}
                    </span>
                    <span className={`v-approvals__row-badge mc-badge mc-badge--t${tier || 1}`}>
                      {riskLabel(card)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selected ? (
        <section
          className={`v-approvals__panel${tierRank(selected.card) >= 3 ? ' v-approvals__panel--t3' : ''}`}
          aria-label="Inbox item details"
          data-testid={selected.category === 'decision' ? 'corroboration-panel' : 'inbox-detail-panel'}
        >
          <p className={`v-approvals__eyebrow v-approvals__eyebrow--${selected.category}`}>
            {selected.categoryLabel}
          </p>
          <h2 className="v-approvals__panel-head">
            {selected.category === 'decision' ? 'Corroborate before you approve' : selected.status}
          </h2>
          <p className="v-approvals__caption">
            {selected.category === 'decision' ? 'This is what your signature covers.' : selected.reason}
          </p>
          {selected.card.meta.id === STOP_FILE_ITEM_ID ? (
            <p className="v-approvals__stop-banner" role="alert" data-testid="stop-file-caption">
              Fleet frozen — the repo-root STOP file is present. Every fleet agent halts at its preamble
              until it is removed.
            </p>
          ) : null}

          <div className="v-approvals__fields">
            <div className="v-approvals__field" data-testid="corrob-card-id">
              <span className="v-approvals__field-label">Card</span>
              <span className="v-approvals__field-value v-approvals__field-value--mono">{selected.card.meta.id}</span>
            </div>
            <div className="v-approvals__field" data-testid="corrob-action">
              <span className="v-approvals__field-label">Action</span>
              <span className="v-approvals__field-value v-approvals__field-value--mono">{valueOf(selected.card.meta.action)}</span>
            </div>
            <div className="v-approvals__field-row">
              <div className="v-approvals__field" data-testid="corrob-risk-tier">
                <span className="v-approvals__field-label">Risk tier</span>
                <span className="v-approvals__field-value v-approvals__field-value--mono">{riskLabel(selected.card)}</span>
              </div>
              <div className="v-approvals__field">
                <span className="v-approvals__field-label">State</span>
                <span className="v-approvals__field-value v-approvals__field-value--mono">{valueOf(selected.card.meta.state)}</span>
              </div>
              <div className="v-approvals__field">
                <span className="v-approvals__field-label">Owner</span>
                <span className="v-approvals__field-value v-approvals__field-value--mono">{valueOf(selected.card.meta.owner) || 'unassigned'}</span>
              </div>
            </div>
            {selected.context !== null ? (
              <div className="v-approvals__field">
                <span className="v-approvals__field-label">Work order</span>
                <pre className="v-approvals__work-order" data-testid="corrob-work-order">{selected.context}</pre>
              </div>
            ) : null}
          </div>

          <div className="v-approvals__next-action">
            <strong>Next action</strong>
            <span>{selected.nextAction}</span>
          </div>

          {selected.respond ? (
            <div className="v-approvals__respond" data-testid="respond-form">
              <label className="v-approvals__field-label" htmlFor="respond-message">
                {selected.respond === 'reply' ? 'Reply to the owning agent' : 'Resolution note'}
              </label>
              <textarea
                id="respond-message"
                className="v-approvals__respond-input"
                data-testid="respond-message"
                rows={4}
                maxLength={16000}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={selected.respond === 'reply'
                  ? 'Your note is appended to the card and it stays queued for pickup.'
                  : 'Recorded on the card as an operator resolution.'}
              />
              <div className="v-approvals__buttons">
                <button
                  type="button"
                  className="mc-btn mc-btn--primary"
                  data-testid="respond-submit"
                  disabled={draft.trim().length === 0 || pendingRespond}
                  onClick={() => onRespond?.(selected.card.meta.id, selected.respond as RespondAction, draft.trim())}
                >
                  {selected.respond === 'reply' ? 'Send reply' : 'Resolve'}
                </button>
              </div>
            </div>
          ) : null}

          {selected.category === 'decision' && selected.buttons ? (
            <>
              <p className="v-approvals__truth-note" role="note">
                Evidence verification records/checks an approval. It does not itself start, resume, or complete this workflow.
              </p>
              <div className="v-approvals__buttons">
                {selected.buttons.signed ? (
                  <button type="button" className="mc-btn mc-btn--primary" onClick={() => onVerify?.(selected.card.meta.id, 'signed')}>
                    Verify evidence (signed)
                  </button>
                ) : null}
                {selected.buttons.possession ? (
                  <button type="button" className="mc-btn" onClick={() => onVerify?.(selected.card.meta.id, 'possession')}>
                    Verify evidence (possession)
                  </button>
                ) : null}
                {selected.buttons.webauthn ? (
                  <button type="button" className="mc-btn mc-btn--primary" onClick={() => onVerify?.(selected.card.meta.id, 'webauthn')}>
                    Verify evidence (WebAuthn)
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      ) : (
        <div className="v-approvals__placeholder" data-testid="approvals-placeholder">
          Select an item to see why it needs you and what action is actually available.
        </div>
      )}
    </div>
  );
}
