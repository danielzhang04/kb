import type { EntityBrief as EntityBriefData } from '../../server/entities/contracts.ts';
import { outputHref } from '../../server/entities/outputs.ts';

export interface EntityBriefProps {
  brief: EntityBriefData;
  onSelectRun?: (runRef: string) => void;
  testId?: string;
}

export function EntityBrief({ brief, onSelectRun, testId }: EntityBriefProps): React.JSX.Element {
  return <div className="entity-brief" data-testid={testId}>
    <p className="entity-prose entity-brief__purpose">{brief.purpose}</p>

    <dl className="entity-kv">
      <div className="entity-kv__row">
        <dt>Doing now</dt>
        <dd>{brief.doingNow}</dd>
      </div>
      <div className="entity-kv__row">
        <dt>Autonomy</dt>
        <dd>{brief.autonomyTier}. {brief.pendingGates} pending {brief.pendingGates === 1 ? 'gate' : 'gates'}.</dd>
      </div>
      <div className="entity-kv__row">
        <dt>Schedule</dt>
        <dd>{brief.schedule ? <>Next scheduled <time className="mc-mono" dateTime={brief.schedule.nextAt}>{brief.schedule.nextAt}</time>.</> : 'No schedule.'}</dd>
      </div>
    </dl>

    <section className="entity-brief__section">
      <h3 className="entity-brief__heading">Recent runs</h3>
      {brief.recentRuns.length ? <ul className="entity-list">{brief.recentRuns.map((run) => {
        const content = <>
          <span className="entity-row__main">{run.title} {'\u00b7'} {run.outcome ?? run.lifecycle}{run.lastLine ? ` \u00b7 ${run.lastLine}` : ''}</span>
          <time className="entity-row__meta mc-mono entity-brief__timestamp" dateTime={run.createdAt}>{run.createdAt}</time>
        </>;
        return <li key={run.runRef}>
          {onSelectRun
            ? <button type="button" className="entity-row entity-row--link" onClick={() => onSelectRun(run.runRef)}>{content}</button>
            : <div className="entity-row">{content}</div>}
        </li>;
      })}</ul> : <p className="entity-note">No runs yet</p>}
    </section>

    <section className="entity-brief__section">
      <h3 className="entity-brief__heading">Recent outputs</h3>
      {brief.outputs.length ? <ul className="entity-list">{brief.outputs.map((output) => <li key={`${output.kind}:${output.label}`}>
        <a className="entity-row entity-row--link" href={outputHref(output)}><span className="entity-row__main">{output.label}</span></a>
      </li>)}</ul> : <p className="entity-note">No recent outputs</p>}
    </section>
  </div>;
}
