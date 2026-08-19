/**
 * Schedules is a view of the HEARTBEAT declarations, not a second scheduler. `scheduleHint` is supplied
 * by the server and is deliberately displayed as text: `scripts/dispatch.py` remains the only clock.
 * Edits create a governed PR; pausing uses the STOP floor; unpausing is intentionally a manual ops act.
 */
import { useState } from 'react';
import type { AgentPlatformPanel } from '../types';
import type { ScheduleRow, SchedulesPanel } from '../../../../server/panels/schedules';
import { invalidateSessionOnGovernedAuthFailure } from '../../../lib/authClient';
import { useSession } from '../../../lib/sessionContext';
import { useReadPanel } from '../../../lib/useReadPanel';
import './Schedules.css';

interface EditResponse {
  ok: boolean;
  target?: string;
  pr?: { url?: string; number?: number } | null;
  reason?: string;
  error?: string;
}

function unboundedCron(schedule: string | null): boolean {
  const fields = (schedule ?? '').trim().split(/\s+/);
  return fields.length === 5 && (!/^\d+$/.test(fields[0]) || fields[1] === '*');
}

function CadenceState({ paused, testId }: { paused: boolean; testId: string }): React.JSX.Element {
  return (
    <span className="ap-schedules__state" data-testid={testId} data-state={paused ? 'paused' : 'active'}>
      <span className="mc-status-dot mc-status-dot--idle" aria-hidden="true" />
      <span className="mc-badge">{paused ? 'paused' : 'active'}</span>
    </span>
  );
}

function needsYou(narration: string | null): boolean {
  const match = narration?.match(/\bneeds you:\s*(.+)$/i);
  return match !== null && match !== undefined && match[1].trim().replace(/[.?!]+$/, '').toLowerCase() !== 'nothing';
}

function LastRun({ row }: { row: ScheduleRow }): React.JSX.Element {
  if (row.lastRun === null) return <span className="ap-schedules__last-run">never run</span>;
  const narration = row.lastRun.narration ?? `card ${row.lastRun.card} records no result`;
  return (
    <span className="ap-schedules__last-run">
      <span className="ap-schedules__date">{row.lastRun.date || 'undated'}:</span>{' '}
      <span className={needsYou(row.lastRun.narration) ? 'ap-schedules__narration ap-schedules__narration--needs-you' : 'ap-schedules__narration'}>{narration}</span>
    </span>
  );
}

function SchedulesBody(): React.JSX.Element {
  const { session, requireSession } = useSession();
  const { data, state } = useReadPanel<SchedulesPanel>(session ? '/api/panels/schedules' : null);
  const [editFile, setEditFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [submittedContent, setSubmittedContent] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<EditResponse | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [pausedNames, setPausedNames] = useState<Set<string>>(() => new Set());
  const [pauseMessages, setPauseMessages] = useState<Record<string, string>>({});

  if (!session) {
    return <p className="ap-schedules__note" data-testid="ap-schedules-locked">Unlock the dashboard to read schedules.</p>;
  }
  if (state === 'loading' || state === 'idle') return <p className="ap-schedules__note">Reading schedules…</p>;
  if (state === 'unavailable' || data === null) {
    return <p className="ap-schedules__note" data-testid="ap-schedules-unavailable">Schedules are unavailable. Nothing was changed.</p>;
  }

  const files = Object.keys(data.files);
  const prefill = editFile === null ? '' : data.files[editFile] ?? '';
  const editDisabled = editBusy || content.trim() === '' || content === prefill || content === submittedContent;

  async function submitEdit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editFile) return;
    const token = (await requireSession())?.token;
    if (!token) {
      setEditResult({ ok: false, reason: 'the dashboard is locked' });
      return;
    }
    setEditBusy(true);
    setEditResult(null);
    try {
      const response = await fetch('/api/schedules/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        // The verified bearer is the authority. Keeping it out of the body prevents two token sources.
        body: JSON.stringify({ file: editFile, content }),
      });
      await invalidateSessionOnGovernedAuthFailure(response);
      const result = (await response.json()) as EditResponse;
      if (response.ok && result.ok) {
        setSubmittedContent(content);
        setEditResult(result);
      } else {
        setEditResult({ ...result, ok: false, reason: `HTTP ${response.status}: ${result.reason ?? result.error ?? 'request refused'}` });
      }
    } catch {
      setEditResult({ ok: false, reason: 'edit request failed' });
    } finally {
      setEditBusy(false);
    }
  }

  async function pauseCadence(name: string): Promise<void> {
    const token = (await requireSession())?.token;
    if (!token) {
      setPauseMessages((old) => ({ ...old, [name]: 'dashboard locked; cadence was not paused' }));
      return;
    }
    try {
      const response = await fetch('/api/write/pause-cadence', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      await invalidateSessionOnGovernedAuthFailure(response);
      const result = (await response.json()) as { path?: string; reason?: string; error?: string };
      if (response.ok) {
        setPausedNames((old) => new Set(old).add(name));
        setPauseMessages((old) => ({ ...old, [name]: `paused (${result.path ?? 'sentinel written'})` }));
      } else {
        setPauseMessages((old) => ({ ...old, [name]: `refused (HTTP ${response.status}): ${result.reason ?? result.error ?? 'request refused'}` }));
      }
    } catch {
      setPauseMessages((old) => ({ ...old, [name]: 'pause request failed' }));
    }
  }

  return (
    <div className="ap-schedules">
      <h4 className="ap-schedules__heading">Schedules ({data.cadences.length})</h4>
      <p className="ap-schedules__note">
        {data.pausedCount} paused. Schedule timing is declared in HEARTBEAT files; the dispatcher is the only clock.
      </p>
      <ul className="ap-schedules__list">
        {data.cadences.map((row) => {
          const paused = row.paused || pausedNames.has(row.name);
          return (
            <li className="ap-schedules__row" data-testid={`ap-schedules-row-${row.name}`} key={`${row.file}:${row.name}`}>
              <div className="ap-schedules__identity">
                <strong>{row.name}</strong>
                <span>{row.project}</span>
                <CadenceState paused={paused} testId={`ap-schedules-state-${row.name}`} />
              </div>
              <div className="ap-schedules__details">
                <code>{row.schedule ?? 'no schedule declared'}</code>
                <span>{row.scheduleHint}</span>
                <span>declared in <code>{row.file}</code></span>
                <span>{row.tier ?? 'no tier'} · {row.riskTier ?? 'no risk tier'}</span>
                <LastRun row={row} />
              </div>
              {unboundedCron(row.schedule) ? (
                <p className="ap-schedules__warning" data-testid={`ap-schedules-subhourly-${row.name}`}>
                  Warning: this cron fires on every matching occurrence — potentially many runs a day, each spending tokens.
                </p>
              ) : null}
              {!paused ? (
                <button type="button" onClick={() => void pauseCadence(row.name)} aria-label={`Pause cadence ${row.name}`}>
                  Pause
                </button>
              ) : null}
              {paused ? <p className="ap-schedules__note">Resuming is a manual ops act (delete queue/paused/{row.name})</p> : null}
              {pauseMessages[row.name] ? <p data-testid={`ap-schedules-pause-${row.name}`} className="ap-schedules__status">{pauseMessages[row.name]}</p> : null}
            </li>
          );
        })}
      </ul>

      <h4 className="ap-schedules__heading">Edit in PR</h4>
      <p className="ap-schedules__note">Edits are proposed on a work branch and merge by human only.</p>
      <div className="ap-schedules__edit-files">
        {files.map((file) => (
          <button type="button" key={file} onClick={() => { setEditFile(file); setContent(data.files[file]); setSubmittedContent(null); setEditResult(null); }}>
            Edit {file} in PR
          </button>
        ))}
      </div>
      {editFile ? (
        <form className="ap-schedules__edit-form" onSubmit={(event) => void submitEdit(event)}>
          <label>
            full file contents — replaces {editFile}
            <textarea aria-label={`full file contents — replaces ${editFile}`} value={content} onChange={(event) => setContent(event.target.value)} />
          </label>
          <button type="submit" disabled={editDisabled}>{editBusy ? 'Creating PR…' : 'Create edit PR'}</button>
        </form>
      ) : null}
      {editResult ? (
        <p className="ap-schedules__status" data-testid="ap-schedules-edit-result">
          {editResult.ok ? (
            <>
              Edit proposed; merges by human only.{' '}
              {editResult.pr?.url ? <a href={editResult.pr.url}>Open pull request</a> : 'PR metadata unavailable.'}
            </>
          ) : `Edit refused: ${editResult.reason ?? 'request failed'}`}
        </p>
      ) : null}
      <p className="ap-schedules__note">Read-only surface: the dashboard never starts, resumes, or reschedules a run — schedule changes merge by human PR.</p>
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'schedules',
  order: 6,
  title: 'Schedules',
  description: 'Declared HEARTBEAT cadences, their recent runs and governed edit or pause controls.',
  render: () => <SchedulesBody />,
};

export { SchedulesBody, unboundedCron };
