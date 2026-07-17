/**
 * Flyout panel (U4) — the small "live contents" popover beside a sidebar entity item. Purely
 * presentational: it renders a {@link FlyoutSummary} and nothing else. It renders NOTHING when closed or
 * when the summary is empty/absent, so a flyout degrades silently on empty or unavailable data (no error
 * state ever appears here). Dense mono contents, hairline panel, no new colours.
 *
 * It renders in a PORTAL on document.body, positioned by the anchor button's rect — the sidebar and its
 * nav list both clip overflow (rail + scroll), so an in-flow absolute popover would be cut off. Fixed
 * positioning beside the rail escapes the clip and works identically in the 48px rail and expanded modes.
 */
import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import type { FlyoutSummary } from './flyoutModel';
import '../styles/flyout.css';

const GAP = 8;

/** Fixed viewport coordinates beside the anchor. Anchors below mid-height align by their bottom edge so
 *  the panel never runs off the bottom of the screen (the reference group sits low in the rail). */
function positionStyle(anchor: RefObject<HTMLElement | null> | undefined): React.CSSProperties {
  const rect = anchor?.current?.getBoundingClientRect();
  if (!rect) return { left: GAP, top: GAP };
  const left = rect.right + GAP;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  if (vh && rect.top > vh / 2) return { left, bottom: Math.max(GAP, vh - rect.bottom) };
  return { left, top: rect.top };
}

export function Flyout({
  open,
  id,
  summary,
  anchor,
}: {
  open: boolean;
  id: string;
  summary: FlyoutSummary | null | undefined;
  /** The anchoring nav button; the panel is placed beside its right edge. */
  anchor?: RefObject<HTMLElement | null>;
}): React.JSX.Element | null {
  if (!open || !summary || summary.empty) return null;
  return createPortal(
    <div
      className="mc-flyout"
      role="tooltip"
      data-testid={`flyout-${id}`}
      aria-label={`${summary.title} summary`}
      style={positionStyle(anchor)}
    >
      <span className="mc-flyout__title">{summary.title}</span>
      <dl className="mc-flyout__lines">
        {summary.lines.map((l) => (
          <div className="mc-flyout__line" key={l.label}>
            <dt className="mc-flyout__line-label">{l.label}</dt>
            <dd className="mc-flyout__line-value mc-mono">{l.value}</dd>
          </div>
        ))}
      </dl>
      {summary.ids.length > 0 ? (
        <div className="mc-flyout__ids">
          {summary.idLabel ? <span className="mc-flyout__ids-label">{summary.idLabel}</span> : null}
          <ul className="mc-flyout__id-list">
            {summary.ids.map((entry) => (
              <li className="mc-flyout__id mc-mono" key={entry}>
                {entry}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
