/**
 * arc-3 — the horizontal run grid, replacing the truncating `<nav>` of flex-row buttons.
 *
 * The problem this solves is TRUNCATION, not density. The old strip clipped every run title with
 * `text-overflow: ellipsis` inside a horizontal scroller, so the operator could not read what a run
 * actually was. A tighter strip of shorter buttons would have been a worse version of the same defect.
 *
 * So this is a WRAPPING grid — horizontal *arrangement*, never a horizontal *scroller*. Wrapping is
 * precisely what lets every card show its title in full at any width; `auto-fill` collapses to a single
 * column with no media query. The title has no clamp and no ellipsis by deliberate choice.
 *
 * The four rollup counts on the card (`stageCount`, `attemptCount`, `sessionCount`, `eventCount`) are
 * already fetched by `listRuns` on every load and, before this, zero of the four were rendered
 * anywhere. They cost nothing to surface.
 */
import type { RunMetadataDto, RunState } from './controlClient';
import { relativeAge } from './runEvents';
import { EntityName } from '../components/EntityName';
import { entityRowProps } from '../components/entityRow';
import type { StatusTone } from '../entity/EntityDetail';

/** Map a run state onto a data-encoding tone. No new hues — these resolve to existing status tokens. */
export function runTone(state: RunState): StatusTone {
  switch (state) {
    case 'running':
    case 'recovering':
      return 'running';
    case 'succeeded':
      return 'ok';
    case 'failed':
    case 'interrupted':
      return 'error';
    case 'waiting-human':
    case 'stopping':
    case 'stopped':
      return 'warn';
    default:
      return 'idle';
  }
}

const DOT_BY_TONE: Record<StatusTone, string> = {
  running: 'running',
  ok: 'done',
  error: 'error',
  warn: 'blocked',
  idle: 'idle',
};

export interface RunGridProps {
  runs: RunMetadataDto[];
  /** The run whose detail is open, if any — drawn with the left-border marker. */
  selectedRunRef?: string | null;
  onSelect: (runRef: string) => void;
  /** Injectable clock so the "updated Nm ago" line is deterministic under test. */
  now?: number;
}

export function RunGrid({ runs, selectedRunRef, onSelect, now }: RunGridProps): React.JSX.Element {
  return (
    <div className="run-grid" data-testid="run-grid">
      {runs.map((run) => {
        const tone = runTone(run.state);
        const selected = selectedRunRef === run.runRef;
        return (
          <div
            key={run.runRef}
            className={`run-card${selected ? ' run-card--selected' : ''}`}
            data-testid={`run-card-${run.runRef}`}
            aria-pressed={selected}
            {...entityRowProps(() => onSelect(run.runRef))}
          >
            {/* Full title, wrapped. No clamp, no ellipsis — reading the whole title IS the requirement.
              * The runRef is no longer a second line: it lives in EntityName's tooltip + copy button. */}
            <span className="run-card__title" data-testid={`run-card-${run.runRef}-title`}>
              <EntityName kind="run" id={run.runRef} displayName={run.displayName} shortRef={run.shortRef} />
            </span>
            <span className="run-card__state">
              <span className={`mc-status-dot mc-status-dot--${DOT_BY_TONE[tone]}`} aria-hidden="true" />
              <span>{run.state}</span>
              {run.openHumanRequestCount > 0 ? (
                <span
                  className="run-card__needs-you mc-mono"
                  data-testid={`run-card-${run.runRef}-needs-you`}
                >
                  {run.openHumanRequestCount} needs you
                </span>
              ) : null}
            </span>
            <span className="run-card__rollups mc-mono" data-testid={`run-card-${run.runRef}-rollups`}>
              {run.stageCount} stages · {run.attemptCount} attempts · {run.sessionCount} sessions ·{' '}
              {run.eventCount} events
            </span>
            <span className="run-card__age mc-mono">updated {relativeAge(run.updatedAt, now)}</span>
          </div>
        );
      })}
    </div>
  );
}
