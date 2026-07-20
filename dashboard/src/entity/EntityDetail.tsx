/**
 * arc-3 — the shared entity-detail shell.
 *
 * ONE presentational surface behind every entity's detail view (run now; workflow and agent in later
 * steps). It owns the chrome — back affordance, eyebrow/title/status, the header fact strip, the
 * cross-entity link row, the section tab bar — and it owns NO fetching. Every section body is a pure
 * component over its own DTO slice, which is what makes each one testable with a literal fixture and
 * no fetch mock.
 *
 * `render()`-per-section matches the tabbed-panel convention already in `App.tsx` (the Sentinel layer
 * panels are `{ id, label, render }` too), so this introduces no new pattern.
 *
 * Visual rules (binding): the active tab and the selected anything is the 2px LEFT-BORDER marker
 * learned in `.mc-nav-item--active` — never a fill wash, never a decorative hue. The only colours in
 * here are data-encoding: the status dot and the amber attention dot. Ids/hashes/counts/timestamps are
 * mono + tabular-nums via `.mc-mono`.
 */
import { useState } from 'react';
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
  /** "Governed run · <runRef>" */
  eyebrow: string;
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
}: EntityDetailProps): React.JSX.Element {
  // Controlled/uncontrolled, the standard way round: when the nav stack drives `activeSectionId` it
  // wins, so back-navigation can restore a tab. With no controller the component still has to be
  // INTERACTIVE, so it keeps its own selection — a tab bar that silently does nothing when rendered
  // standalone would be a defect, not a simplification. Either way a stale id (after the section set
  // changes) falls back to the first section rather than rendering an empty body.
  const [internalSectionId, setInternalSectionId] = useState<string | undefined>(undefined);
  const selectedId = activeSectionId ?? internalSectionId;
  const active = sections.find((section) => section.id === selectedId) ?? sections[0];

  const selectSection = (id: string): void => {
    setInternalSectionId(id);
    onSectionChange?.(id);
  };

  return (
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

      <div className="entity-detail__tabs" role="tablist" aria-label={`${entity.kind} sections`}>
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
                className="entity-detail__tab-attention"
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
}
