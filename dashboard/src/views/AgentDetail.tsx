import type { EntityDetail } from '../../server/entities/contracts.ts';
import { EntityBrief } from '../entity/EntityBrief';
import type { NavTarget } from '../nav/stack';

export interface AgentDetailBodyProps {
  detail: EntityDetail;
  surface?: 'live' | 'brief';
  onNavigate?: (target: NavTarget) => void;
}

/** Presentational P2 Agent detail body retained as the reusable view seam; consoles live in Terminal. */
export function AgentDetailBody({ detail, surface = 'live', onNavigate }: AgentDetailBodyProps): React.JSX.Element {
  if (surface === 'brief') {
    return <EntityBrief brief={detail.brief} />;
  }
  return detail.summary.activeRuns.length ? <ul className="entity-list">{detail.summary.activeRuns.map((run) => <li key={run.runRef}>
    <button type="button" className="entity-row entity-row--link" onClick={() => onNavigate?.({ view: 'workflows', focus: { kind: 'run', id: run.runRef } })}>{run.title} {'\u00b7'} {run.lifecycle} {'\u00b7'} {Math.round((run.elapsedMs ?? 0) / 1000)}s {'\u00b7'} {run.toolsCalled ?? 0} tools {'\u00b7'} {run.lastLine ?? run.lifecycle}{run.gateBadge ? ` \u00b7 ${run.gateBadge}` : ''}</button>
  </li>)}</ul> : <p className="entity-note">{detail.summary.temporalLabel}</p>;
}
