import type { EntityDetail } from '../../server/entities/contracts.ts';
import { outputHref } from '../../server/entities/outputs.ts';
import type { NavTarget } from '../nav/stack';

export interface AgentDetailBodyProps {
  detail: EntityDetail;
  surface?: 'live' | 'brief';
  onNavigate?: (target: NavTarget) => void;
}

/** Presentational P2 Agent detail body retained as the reusable view seam; consoles live in Terminal. */
export function AgentDetailBody({ detail, surface = 'live', onNavigate }: AgentDetailBodyProps): React.JSX.Element {
  if (surface === 'brief') {
    return <div className="entity-brief">
      <p>{detail.brief.purpose}</p>
      <p>{detail.brief.doingNow}</p>
      <p>{detail.brief.autonomyTier}. {detail.brief.pendingGates} pending {detail.brief.pendingGates === 1 ? 'gate' : 'gates'}.</p>
      <p>{detail.brief.schedule ? `Next scheduled ${detail.brief.schedule.nextAt}.` : 'No schedule.'}</p>
      <h3>Recent runs</h3>
      {detail.brief.recentRuns.length ? <ul>{detail.brief.recentRuns.map((run) => <li key={run.runRef}>{run.createdAt} {'\u00b7'} {run.outcome ?? run.lifecycle} {'\u00b7'} {run.lastLine ?? run.title}</li>)}</ul> : <p>No runs yet</p>}
      <h3>Recent outputs</h3>
      {detail.brief.outputs.length ? <ul>{detail.brief.outputs.map((output) => <li key={`${output.kind}:${output.label}`}><a href={outputHref(output)}>{output.label}</a></li>)}</ul> : <p>No recent outputs</p>}
    </div>;
  }
  return detail.summary.activeRuns.length ? <ul className="entity-list">{detail.summary.activeRuns.map((run) => <li key={run.runRef}>
    <button type="button" className="entity-row entity-row--link" onClick={() => onNavigate?.({ view: 'workflows', focus: { kind: 'run', id: run.runRef } })}>{run.title} {'\u00b7'} {run.lifecycle} {'\u00b7'} {Math.round((run.elapsedMs ?? 0) / 1000)}s {'\u00b7'} {run.toolsCalled ?? 0} tools {'\u00b7'} {run.lastLine ?? run.lifecycle}{run.gateBadge ? ` \u00b7 ${run.gateBadge}` : ''}</button>
  </li>)}</ul> : <p className="entity-note">{detail.summary.temporalLabel}</p>;
}
