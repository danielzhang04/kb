import type { RunLifecycleRow } from './runStreamAdapter';
import { eventClock, timestampLabel } from './runEvents';
import './runTimeline.css';

export function RunTimeline({ rows }: { rows: readonly RunLifecycleRow[] }): React.JSX.Element {
  if (rows.length === 0) return <p className="run-timeline__empty">No lifecycle recorded yet.</p>;
  return <ol className="run-timeline" data-testid="run-timeline">
    {rows.map((row) => <li className="run-timeline__row" data-testid={`run-timeline-row-${row.cursor}`} key={row.cursor}>
      <time className="run-timeline__time" title={timestampLabel(row.createdAt)}>{eventClock(row.createdAt)}</time>
      <span className="run-timeline__label">{row.label}</span>
      <span className={`run-timeline__status${row.status ? ` run-timeline__status--${row.status}` : ''}`}>{row.status ?? row.source}</span>
    </li>)}
  </ol>;
}
