/**
 * arc-3 — the shared entity-detail shell.
 *
 * ONE presentational surface behind every entity's detail view (run now; workflow and agent in later
 * steps). It owns the chrome — back affordance, eyebrow/title/status, the header fact strip, the
 * cross-entity link row, the section tab bar — and it owns NO fetching. Every section body is a pure
 * component over its own DTO slice, which is what makes each one testable with a literal fixture and
 * no fetch mock.
 *
 * `render()`-per-section matches the tabbed-panel convention already used by the app shell.
 *
 * Visual rules (binding): the active tab and the selected anything use the exact pair learned in
 * `.mc-nav-item--active` — the 2px LEFT-BORDER marker plus `--accent-quiet`, which app.css defines as
 * the "selected wash — subtle raised, not a colour". Never a decorative hue, never a glow. The only
 * colours in here are data-encoding: the status dot and the amber attention dot. Ids/hashes/counts/timestamps are
 * mono + tabular-nums via `.mc-mono`.
 */
import { useEffect, useRef, useState } from 'react';
import type { NavTarget } from '../nav/stack';
import '../styles/views/entity.css';

export type EntityKind = 'run' | 'workflow' | 'agent';

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export interface DetailSection {
  id: string;
  label: string;
  /** Rendered mono + tabular-nums beside the label. Omit when a count is meaningless. */
  count?: number;
  /** Amber dot on the tab when the section needs the operator (open requests, blocked checkpoint). */
  attention?: boolean;
  render: () => React.ReactNode;
}

export interface EntityLink {
  label: string;
  target: NavTarget;
  /** Mono id shown after the label, e.g. the runRef being linked to. */
  ref?: string;
}

export type StatusTone = 'running' | 'ok' | 'error' | 'warn' | 'idle';

export interface EntityFact {
  label: string;
  value: React.ReactNode;
  /** Opts the value into mono + tabular-nums (ids, hashes, counts, timestamps). */
  mono?: boolean;
}

export interface EntityDetailProps {
  entity: EntityRef;
  /** "Governed run · <EntityName …>" — a node, not a string, so the entity's identity renders through
   *  the one `EntityName` component instead of being string-interpolated into a raw ref. */
  eyebrow: React.ReactNode;
  title: string;
  status?: { label: string; tone: StatusTone };
  facts: EntityFact[];
  sections: DetailSection[];
  links?: EntityLink[];
  /** Controlled so the nav stack can restore the tab on back. Unset falls back to sections[0]. */
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  onNavigate?: (target: NavTarget) => void;
  onBack?: () => void;
  /** "All runs", "video-pipeline" — resolved by the view, which holds the data, not by the stack. */
  backLabel?: string;
  /** Governed mutations live in the header, never inside a section, so they stay in one place. */
  actions?: React.ReactNode;
  /** W4 entity rosters stay mounted while this raised right-hand panel is open. */
  overlay?: boolean;
  onClose?: () => void;
  detailsContent?: React.ReactNode;
}

/** Map a status tone onto the existing `mc-status-dot--*` vocabulary. No new hues. */
const DOT_BY_TONE: Record<StatusTone, string> = {
  running: 'running',
  ok: 'done',
  error: 'error',
  warn: 'blocked',
  idle: 'idle',
};

export function EntityDetail({
  entity,
  eyebrow,
  title,
  status,
  facts,
  sections,
  links,
  activeSectionId,
  onSectionChange,
  onNavigate,
  onBack,
  backLabel,
  actions,
  overlay = false,
  onClose,
  detailsContent,
}: EntityDetailProps): React.JSX.Element {
  // Controlled/uncontrolled, the standard way round: when the nav stack drives `activeSectionId` it
  // wins, so back-navigation can restore a tab. With no controller the component still has to be
  // INTERACTIVE, so it keeps its own selection — a tab bar that silently does nothing when rendered
  // standalone would be a defect, not a simplification. Either way a stale id (after the section set
  // changes) falls back to the first section rather than rendering an empty body.
  const [internalSectionId, setInternalSectionId] = useState<string | undefined>(undefined);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const selectedId = activeSectionId ?? internalSectionId;
  const active = sections.find((section) => section.id === selectedId) ?? sections[0];

  const selectSection = (id: string): void => {
    setInternalSectionId(id);
    onSectionChange?.(id);
  };

  useEffect(() => {
    if (!overlay || typeof document === 'undefined') return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const trapFocus = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = closeRef.current?.closest<HTMLElement>('.entity-detail__overlay');
      const focusable = panel ? Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((node) => !node.hidden) : [];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      restoreFocus.current?.focus();
    };
  }, [overlay]);

  const detail = (
    <section
      className="entity-detail"
      aria-label={`${entity.kind} ${entity.id}`}
      data-testid={`entity-detail-${entity.kind}`}
    >
      {onBack ? (
        <button
          type="button"
          className="entity-detail__back"
          data-testid="entity-detail-back"
          onClick={onBack}
        >
          <span aria-hidden="true">←</span> {backLabel ?? 'Back'}
        </button>
      ) : null}

      <header className="entity-detail__head">
        <div className="entity-detail__identity">
          <p className="entity-detail__eyebrow mc-mono">{eyebrow}</p>
          <div className="entity-detail__title-row">
            {/* The title WRAPS. A run title is the operator's primary handle on the run and is never
             *  truncated at any width — that is the requirement, not a nicety. */}
            <h2 className="entity-detail__title" data-testid="entity-detail-title">{title}</h2>
            {status ? (
              <span className="entity-detail__status" data-testid="entity-detail-status">
                <span
                  className={`mc-status-dot mc-status-dot--${DOT_BY_TONE[status.tone]}`}
                  aria-hidden="true"
                />
                <span>{status.label}</span>
              </span>
            ) : null}
          </div>
        </div>
        {actions ? <div className="entity-detail__actions">{actions}</div> : null}
      </header>

      {facts.length ? (
        <dl className="entity-detail__facts" data-testid="entity-detail-facts">
          {facts.map((fact) => (
            <div key={fact.label} className="entity-detail__fact">
              <dt>{fact.label}</dt>
              <dd className={fact.mono ? 'mc-mono' : undefined}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {links?.length && onNavigate ? (
        <nav className="entity-detail__links" aria-label="Related entities">
          {links.map((link) => (
            <button
              key={`${link.label}-${link.ref ?? ''}`}
              type="button"
              className="entity-detail__link"
              data-testid={`entity-link-${link.target.focus?.id ?? link.target.view}`}
              onClick={() => onNavigate(link.target)}
            >
              <span className="entity-detail__link-label">{link.label}</span>
              {link.ref ? <span className="mc-mono entity-detail__link-ref">{link.ref}</span> : null}
            </button>
          ))}
        </nav>
      ) : null}

      {/* A one-section detail renders NO tab bar. A tablist with a single, permanently-selected tab is
       *  pure ceremony — the surfaces that collapsed to one body (workflow, run) would otherwise carry a
       *  control that can never do anything. */}
      <div
        className="entity-detail__tabs"
        role="tablist"
        aria-label={`${entity.kind} sections`}
        hidden={sections.length < 2}
      >
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={active?.id === section.id}
            data-testid={`entity-tab-${section.id}`}
            className={`entity-detail__tab${active?.id === section.id ? ' entity-detail__tab--active' : ''}`}
            onClick={() => selectSection(section.id)}
          >
            <span>{section.label}</span>
            {typeof section.count === 'number' ? (
              <span className="entity-detail__tab-count mc-mono">{section.count}</span>
            ) : null}
            {section.attention ? (
              <span
                className="mc-status-dot mc-status-dot--waiting entity-detail__tab-attention"
                data-testid={`entity-tab-${section.id}-attention`}
                aria-label="needs you"
              />
            ) : null}
          </button>
        ))}
      </div>

      <div className="entity-detail__body" data-testid="entity-detail-body">
        {active?.render()}
      </div>
    </section>
  );

  if (!overlay) return detail;
  return (
    <div className="entity-detail__layer" role="presentation">
      <button type="button" className="entity-detail__backdrop" aria-label="Close detail" data-testid="entity-detail-backdrop" onClick={onClose} />
      <aside className="entity-detail__overlay" role="dialog" aria-modal="true" aria-label={`${title} detail`}>
        <button ref={closeRef} type="button" className="entity-detail__close" data-testid="entity-detail-close" onClick={onClose}>Close</button>
        {detail}
        <button type="button" className="entity-detail__details" data-testid="entity-detail-details" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
          Details
        </button>
        {detailsOpen ? <div className="entity-detail__details-body">{detailsContent ?? 'No additional loaded details.'}</div> : null}
      </aside>
    </div>
  );
}
