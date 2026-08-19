/**
 * Schedules is a view of the HEARTBEAT declarations, not a second scheduler. `scheduleHint` is supplied
 * by the server and is deliberately displayed as text: `scripts/dispatch.py` remains the only clock.
 * Edits create a governed PR; pausing uses the STOP floor; unpausing is intentionally a manual ops act.
 */
import { useState } from 'react';
import type { AgentPlatformPanel } from '../types';
import type { ScheduleHistory, ScheduleRow, SchedulesPanel } from '../../../../server/panels/schedules';
import { RecurrencePicker } from '../../../components/RecurrencePicker';
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace only the selected cadence's direct-child `schedule:` field, preserving every other source byte. */
export function replaceCadenceSchedule(content: string, cadenceName: string, schedule: string): string {
  const lines = content.match(/.*(?:\r?\n|$)/g)?.filter((line) => line !== '') ?? [];
  const namePattern = new RegExp(`^([\\t ]*)-\\s+name:\\s*${escapeRegExp(cadenceName)}\\s*(?:\\r?\\n)?$`);
  const start = lines.findIndex((line) => namePattern.test(line));
  if (start === -1) return content;

  const nameMatch = namePattern.exec(lines[start]);
  const cadenceIndent = nameMatch?.[1] ?? '';
  const lineIndent = (line: string) => /^([\t ]*)/.exec(line)?.[1] ?? '';
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    const indent = lineIndent(line);
    if (line.trim() !== '' && indent.length <= cadenceIndent.length) break;
    end += 1;
  }

  const firstChild = lines.slice(start + 1, end).find((line) => line.trim() !== '');
  const childIndent = firstChild ? lineIndent(firstChild) : `${cadenceIndent}  `;
  for (let index = start + 1; index < end; index += 1) {
    if (lineIndent(lines[index]) !== childIndent || !/^schedule:\s*/.test(lines[index].slice(childIndent.length))) continue;
    lines[index] = lines[index].replace(/^([\t ]*schedule:\s*).*?(\r?\n)?$/, `$1${schedule}$2`);
    return lines.join('');
  }

  const newline = lines[start].endsWith('\r\n') ? '\r\n' : '\n';
  lines.splice(start + 1, 0, `${childIndent}schedule: ${schedule}${newline}`);
  return lines.join('');
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
  const [selectedCadence, setSelectedCadence] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(() => new Set());
  const [histories, setHistories] = useState<Record<string, ScheduleHistory | null>>({});
  const [historyLoading, setHistoryLoading] = useState<Set<string>>(() => new Set());
  const [pickerValid, setPickerValid] = useState(true);

  if (!session) {
    return <p className="ap-schedules__note" data-testid="ap-schedules-locked">Unlock the dashboard to read schedules.</p>;
  }
  if (state === 'loading' || state === 'idle') return <p className="ap-schedules__note">Reading schedules…</p>;
  if (state === 'unavailable' || data === null) {
    return <p className="ap-schedules__note" data-testid="ap-schedules-unavailable">Schedules are unavailable. Nothing was changed.</p>;
  }

  const files = Object.keys(data.files);
  const prefill = editFile === null ? '' : data.files[editFile] ?? '';
  const editableCadences = data.cadences.filter((row) => row.file === editFile);
  const cadenceForPicker = editableCadences.find((row) => row.name === selectedCadence) ?? editableCadences[0] ?? null;
  const editDisabled = editBusy || !pickerValid || content.trim() === '' || content === prefill || content === submittedContent;

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

  async function toggleHistory(row: ScheduleRow): Promise<void> {
    const key = `${row.project}:${row.name}`;
    if (expandedHistory.has(key)) {
      setExpandedHistory((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      return;
    }
    setExpandedHistory((current) => new Set(current).add(key));
    if (Object.hasOwn(histories, key)) return;
    setHistoryLoading((current) => new Set(current).add(key));
    try {
      const token = (await requireSession())?.token;
      if (!token) throw new Error('locked');
      const response = await fetch(`/api/panels/schedules/history?project=${encodeURIComponent(row.project)}&cadence=${encodeURIComponent(row.name)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('unavailable');
      const history = await response.json() as ScheduleHistory;
      setHistories((current) => ({ ...current, [key]: history }));
    } catch {
      setHistories((current) => ({ ...current, [key]: null }));
    } finally {
      setHistoryLoading((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
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
          const historyKey = `${row.project}:${row.name}`;
          const historyOpen = expandedHistory.has(historyKey);
          const history = histories[historyKey];
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
              <button type="button" onClick={() => void toggleHistory(row)} aria-expanded={historyOpen} aria-label={`History for cadence ${row.name}`}>
                {historyOpen ? 'Hide history' : 'History'}
              </button>
              {paused ? <p className="ap-schedules__note">Resuming is a manual ops act (delete queue/paused/{row.name})</p> : null}
              {pauseMessages[row.name] ? <p data-testid={`ap-schedules-pause-${row.name}`} className="ap-schedules__status">{pauseMessages[row.name]}</p> : null}
              {historyOpen ? (
                <div className="ap-schedules__history" data-testid={`ap-schedules-history-${row.name}`}>
                  {historyLoading.has(historyKey) ? <p className="ap-schedules__note">Reading history…</p> : null}
                  {!historyLoading.has(historyKey) && history === null ? <p className="ap-schedules__note">History is unavailable. Nothing was changed.</p> : null}
                  {history && history.runs.length === 0 ? <p className="ap-schedules__note">No recorded fires.</p> : null}
                  {history && history.runs.length > 0 ? (
                    <ul>
                      {history.runs.map((fire, index) => (
                        <li key={`${fire.card ?? 'unknown'}-${index}`}>
                          <span>scheduled <code>{fire.scheduledFor ?? 'unknown'}</code></span>{' · '}
                          <span>dispatched <code>{fire.dispatchedAt ?? 'unknown'}</code></span>{' · '}
                          <span>{fire.outcome}</span>
                          {fire.result ? <> {' · '}<span>{fire.result}</span></> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <h4 className="ap-schedules__heading">Edit in PR</h4>
      <p className="ap-schedules__note">Edits are proposed on a work branch and merge by human only.</p>
      <div className="ap-schedules__edit-files">
        {files.map((file) => (
          <button type="button" key={file} onClick={() => {
            setEditFile(file);
            setContent(data.files[file]);
            setSelectedCadence(data.cadences.find((row) => row.file === file)?.name ?? null);
            setPickerValid(true);
            setSubmittedContent(null);
            setEditResult(null);
          }}>
            Edit {file} in PR
          </button>
        ))}
      </div>
      {editFile ? (
        <form className="ap-schedules__edit-form" onSubmit={(event) => void submitEdit(event)}>
          {cadenceForPicker ? (
            <>
              <label>
                cadence
                <select aria-label="cadence" value={cadenceForPicker.name} onChange={(event) => {
                  setSelectedCadence(event.target.value);
                  setPickerValid(true);
                }}>
                  {editableCadences.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
                </select>
              </label>
              <RecurrencePicker
                key={`${editFile}:${cadenceForPicker.name}:${cadenceForPicker.schedule ?? ''}`}
                initialCron={cadenceForPicker.schedule}
                onChange={(cron) => setContent((current) => replaceCadenceSchedule(current, cadenceForPicker.name, cron))}
                onValidityChange={setPickerValid}
              />
            </>
          ) : null}
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
  placement: 'sidebar',
  render: () => <SchedulesBody />,
};

export { SchedulesBody, unboundedCron };
