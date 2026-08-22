import type { HomeResponse, HomeUnavailableReason } from '../../server/home/contracts.ts';
import type { RunnableRef } from '../../server/control/p2Contracts.ts';

export type D13RetryTarget = 'running-now' | 'attention-counts' | 'next-schedules' | 'version' | 'recent-outcomes';

export interface D13HomeProps {
  response: HomeResponse;
  onOpenRun?: (runRef: string) => void;
  onOpenAttention?: (target: 'agents' | 'workflows' | 'inbox') => void;
  onOpenSchedule?: (owner: RunnableRef) => void;
  onRetry?: (target: D13RetryTarget) => void;
}

function relativeTime(value: string, now: Date): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const hours = Math.max(0, Math.floor((now.getTime() - timestamp) / 3_600_000));
  return hours < 1 ? 'just now' : `${hours}h ago`;
}

function Unavailable({ label, reason, retryTarget, onRetry }: {
  label: string;
  reason: HomeUnavailableReason;
  retryTarget: D13RetryTarget;
  onRetry?: D13HomeProps['onRetry'];
}): React.JSX.Element {
  return (
    <section aria-label={label} className="d13-home__section">
      <h2>{label}</h2>
      <p>Unavailable: {reason}</p>
      {onRetry ? <button type="button" onClick={() => onRetry(retryTarget)}>Retry {label}</button> : null}
    </section>
  );
}

/** Presentational D13 Home. The shell continues to own fetching and navigation wiring. */
export function D13Home({ response, onOpenRun, onOpenAttention, onOpenSchedule, onRetry }: D13HomeProps): React.JSX.Element {
  const [running, attention, schedules, version, outcomes] = response.sections;
  return (
    <main aria-label="Home" className="d13-home">
      {running.state === 'unavailable' ? <Unavailable label="Running now" reason={running.reason} retryTarget="running-now" onRetry={onRetry} /> : (
        <section aria-label="Running now" className="d13-home__section"><h2>Running now</h2>
          {running.data.runs.length === 0 ? <p>Nothing running</p> : <div>{running.data.runs.map((run) => <button key={run.runRef} type="button" onClick={() => onOpenRun?.(run.runRef)}>{run.title}</button>)}</div>}
        </section>
      )}
      {attention.state === 'unavailable' ? <Unavailable label="Needs you" reason={attention.reason} retryTarget="attention-counts" onRetry={onRetry} /> : (
        <section aria-label="Needs you" className="d13-home__section"><h2>Needs you</h2><div>
          <button type="button" onClick={() => onOpenAttention?.('agents')}>{attention.data.agents} Agents gates</button>
          <button type="button" onClick={() => onOpenAttention?.('workflows')}>{attention.data.workflows} Workflows gates</button>
          <button type="button" onClick={() => onOpenAttention?.('inbox')}>{attention.data.inbox} Inbox items</button>
        </div></section>
      )}
      {schedules.state === 'unavailable' ? <Unavailable label="Next schedules" reason={schedules.reason} retryTarget="next-schedules" onRetry={onRetry} /> : (
        <section aria-label="Next schedules" className="d13-home__section"><h2>Next schedules</h2>
          {schedules.data.occurrences.length === 0 ? <p>No schedules</p> : <div>{schedules.data.occurrences.map((occurrence) => <button key={`${occurrence.scheduleId}:${occurrence.scheduledFor}`} type="button" onClick={() => onOpenSchedule?.(occurrence.owner)}>{occurrence.nextAt}</button>)}</div>}
        </section>
      )}
      {version.state === 'unavailable' ? <Unavailable label="Version" reason={version.reason} retryTarget="version" onRetry={onRetry} /> : (
        <section aria-label="Version" className="d13-home__section"><h2>Version</h2><span>{`${version.data.label} \u00b7 ${version.data.sha.slice(0, 8)} \u00b7 ${relativeTime(version.data.activatedAt, new Date(response.generatedAt))}`}</span></section>
      )}
      {outcomes.state === 'unavailable' ? <Unavailable label="Recent outcomes" reason={outcomes.reason} retryTarget="recent-outcomes" onRetry={onRetry} /> : (
        <section aria-label="Recent outcomes" className="d13-home__section"><h2>Recent outcomes</h2>
          {outcomes.data.outcomes.length === 0 ? <p>No runs yet</p> : <div>{outcomes.data.outcomes.map((outcome) => <button key={outcome.runRef} type="button" onClick={() => onOpenRun?.(outcome.runRef)}>{`${outcome.title} \u00b7 ${outcome.outcome}`}</button>)}</div>}
        </section>
      )}
    </main>
  );
}
