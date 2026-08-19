import { useEffect, useState } from 'react';
import type { AgentPlatformPanel } from '../types';
import type { AgentRosterEntry } from '../../../../server/agents/roster';
import type { GradesHistory, GradeHistorySource } from '../../../../server/panels/gradesHistory';
import { useSession } from '../../../lib/sessionContext';
import { useReadPanel } from '../../../lib/useReadPanel';
import './GradesHistory.css';

type Filter = 'all' | GradeHistorySource;
const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function GradesHistoryBody(): React.JSX.Element {
  const { session } = useSession();
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const [rosterState, setRosterState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [agent, setAgent] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void fetch('/api/agents')
      .then((response) => {
        if (!response.ok) throw new Error('roster unavailable');
        return response.json() as Promise<AgentRosterEntry[]>;
      })
      .then((rows) => {
        if (cancelled) return;
        const safe = (Array.isArray(rows) ? rows : []).filter((row) => SAFE_AGENT_ID.test(row.id));
        setRoster(safe);
        setAgent((current) => current || safe[0]?.id || '');
        setRosterState('ready');
      })
      .catch(() => { if (!cancelled) setRosterState('unavailable'); });
    return () => { cancelled = true; };
  }, [session]);

  const { data, state } = useReadPanel<GradesHistory>(session && agent ? `/api/panels/grades-history?agent=${encodeURIComponent(agent)}` : null);

  if (!session) return <p className="ap-grades-history__empty" data-testid="ap-grades-history-locked">Unlock the dashboard to read grade history.</p>;
  if (rosterState === 'loading') return <p className="ap-grades-history__empty">Reading the agent roster…</p>;
  if (rosterState === 'unavailable') return <p className="ap-grades-history__empty" data-testid="ap-grades-history-roster-unavailable">The agent roster is unavailable. Nothing was changed.</p>;
  if (roster.length === 0) return <p className="ap-grades-history__empty">No safe roster identities are available.</p>;

  const rows = data?.rows.filter((row) => filter === 'all' || row.source === filter) ?? [];
  return (
    <div className="ap-grades-history">
      <p className="ap-grades-history__evidence" data-testid="ap-grades-history-evidence">
        Eval-suite rows are evidence, never autonomy input. This panel shows history only and makes no promotion recommendation.
      </p>
      <div className="ap-grades-history__controls">
        <label className="ap-grades-history__control">
          agent
          <select aria-label="agent" value={agent} onChange={(event) => setAgent(event.target.value)}>
            {roster.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName || entry.id}</option>)}
          </select>
        </label>
        <label className="ap-grades-history__control">
          source
          <select aria-label="grade source" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
            <option value="all">all sources</option>
            <option value="task">task grades</option>
            <option value="eval">eval evidence</option>
          </select>
        </label>
      </div>
      {state === 'loading' || state === 'idle' ? <p className="ap-grades-history__note">Reading grade history…</p> : null}
      {state === 'unavailable' || data === null ? <p className="ap-grades-history__empty" data-testid="ap-grades-history-unavailable">Grade history is unavailable. Nothing was changed.</p> : null}
      {data && rows.length === 0 ? <p className="ap-grades-history__empty" data-testid="ap-grades-history-empty">No {filter === 'all' ? '' : `${filter} `}grade rows for {agent}.</p> : null}
      {data && rows.length > 0 ? (
        <ul className="ap-grades-history__list" data-testid="ap-grades-history-rows">
          {rows.map((row, index) => (
            (() => {
              const verdict = row.passed === true ? 'pass' : row.passed === false ? 'fail' : 'unverified';
              const verdictClass = row.passed === true ? ' mc-badge--done' : row.passed === false ? ' mc-badge--error' : ' mc-badge--unevaluated';
              return (
                <li className={`ap-grades-history__row ap-grades-history__row--${row.source}`} data-testid={`ap-grades-history-row-${row.source}-${index}`} key={`${row.source}:${row.date}:${row.cardId}:${index}`}>
                  <time dateTime={row.date}>{row.date || 'undated'}</time>
                  <span className="mc-badge">{row.grade || 'unscored'}</span>
                  <span className={`mc-badge${verdictClass}`} data-testid={`ap-grades-history-verdict-${index}`}>{verdict}</span>
                  <span className={`mc-badge${row.source === 'eval' ? ' mc-badge--unevaluated' : ''}`}>{row.source === 'eval' ? 'eval evidence' : 'task'}</span>
                  <code className="ap-grades-history__id">{row.cardId || 'no card id'}</code>
                </li>
              );
            })()
          ))}
        </ul>
      ) : null}
      <p className="ap-grades-history__note">Read-only history. Promotion logic remains in <code>scripts/promotion.py</code>.</p>
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'grades-history',
  order: 110,
  title: 'Grades History',
  description: 'Per-identity task grades and eval evidence, newest first, with no promotion advice.',
  render: () => <GradesHistoryBody />,
};

export { GradesHistoryBody };
