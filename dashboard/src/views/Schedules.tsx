/**
 * Schedules projects HEARTBEAT declarations; it is never a scheduler. Its next-window estimate is
 * display-only — scripts/dispatch.py remains the only clock, and edits still travel through a human PR.
 */
import { useState } from 'react';
import type { ScheduleHistory, ScheduleRow, SchedulesPanel } from '../../server/panels/schedules';
import { RecurrencePicker } from '../components/RecurrencePicker';
import { invalidateSessionOnGovernedAuthFailure } from '../lib/authClient';
import { describeSchedule, nextScheduleWindow, relativeScheduleWindow } from '../lib/scheduleWords';
import { useSession } from '../lib/sessionContext';
import { useReadPanel } from '../lib/useReadPanel';
import '../styles/views/schedules.css';

interface EditResponse { ok: boolean; target?: string; pr?: { url?: string; number?: number } | null; reason?: string; error?: string; }

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Replace only the selected cadence's direct-child `schedule:` field, preserving every other source byte. */
export function replaceCadenceSchedule(content: string, cadenceName: string, schedule: string): string {
  const lines = content.match(/.*(?:\r?\n|$)/g)?.filter((line) => line !== '') ?? [];
  const namePattern = new RegExp(`^([\\t ]*)-\\s+name:\\s*${escapeRegExp(cadenceName)}\\s*(?:\\r?\\n)?$`);
  const start = lines.findIndex((line) => namePattern.test(line));
  if (start === -1) return content;
  const cadenceIndent = namePattern.exec(lines[start])?.[1] ?? '';
  const lineIndent = (line: string) => /^([\t ]*)/.exec(line)?.[1] ?? '';
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || lineIndent(lines[end]).length > cadenceIndent.length)) end += 1;
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

function needsYou(narration: string | null): boolean {
  const match = narration?.match(/\bneeds you:\s*(.+)$/i);
  return match !== null && match !== undefined && match[1].trim().replace(/[.?!]+$/, '').toLowerCase() !== 'nothing';
}

function dateRelative(value: string | null): string {
  if (!value) return 'undated';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const minutes = Math.round((Date.now() - parsed.getTime()) / 60_000);
  if (Math.abs(minutes) < 60) return minutes <= 0 ? 'just now' : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return hours <= 0 ? 'soon' : `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function drift(scheduledFor: string | null, dispatchedAt: string | null): string | null {
  if (!scheduledFor || !dispatchedAt) return null;
  const milliseconds = new Date(dispatchedAt).getTime() - new Date(scheduledFor).getTime();
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) < 60_000) return null;
  return `${milliseconds >= 0 ? '+' : '−'}${Math.round(Math.abs(milliseconds) / 60_000)}m ${milliseconds >= 0 ? 'late' : 'early'}`;
}

function LastOutcome({ row }: { row: ScheduleRow }): React.JSX.Element {
  if (row.lastRun === null) return <span className="mc-badge schedules__outcome">never run</span>;
  const narration = row.lastRun.narration ?? `card ${row.lastRun.card} recorded`;
  return <span className="mc-badge schedules__outcome" title={narration}>last outcome</span>;
}

function HistoryTimeline({ history, loading }: { history: ScheduleHistory | null | undefined; loading: boolean }): React.JSX.Element {
  if (loading) return <p className="schedules__quiet">Reading history…</p>;
  if (history === null) return <p className="schedules__quiet">History is unavailable. Nothing was changed.</p>;
  if (!history || history.runs.length === 0) return <p className="schedules__quiet">No recorded fires yet.</p>;
  return <ol className="schedules__timeline">
    {history.runs.map((fire, index) => {
      const result = fire.result ?? 'No result recorded.';
      const short = result.length > 120 ? `${result.slice(0, 120)}…` : result;
      const late = drift(fire.scheduledFor, fire.dispatchedAt);
      return <li key={`${fire.card ?? 'unknown'}-${index}`}>
        <span className="schedules__timeline-dot" aria-hidden="true" />
        <div>
          <div className="schedules__timeline-meta"><span title={fire.scheduledFor ?? undefined}>{dateRelative(fire.scheduledFor ?? fire.dispatchedAt)}</span>{late ? <span>{late}</span> : null}<span>{fire.outcome}</span></div>
          {result.length > 120 ? <details><summary>{short}</summary><p>{result}</p></details> : <p>{short}</p>}
        </div>
      </li>;
    })}
  </ol>;
}

export function SchedulesBody(): React.JSX.Element {
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

  if (!session) return <p className="schedules__quiet" data-testid="schedules-locked">Unlock the dashboard to read schedules.</p>;
  if (state === 'loading' || state === 'idle') return <p className="schedules__quiet">Reading schedules…</p>;
  if (state === 'unavailable' || data === null) return <p className="schedules__quiet" data-testid="schedules-unavailable">Schedules are unavailable. Nothing was changed.</p>;

  const prefill = editFile === null ? '' : data.files[editFile] ?? '';
  const editsAvailable = data.edits?.available !== false;
  const editableCadences = data.cadences.filter((row) => row.file === editFile);
  const cadenceForPicker = editableCadences.find((row) => row.name === selectedCadence) ?? editableCadences[0] ?? null;
  const editDisabled = editBusy || !pickerValid || content.trim() === '' || content === prefill || content === submittedContent;

  const openEditor = (file: string, cadenceName?: string): void => {
    setEditFile(file); setContent(data.files[file] ?? ''); setSelectedCadence(cadenceName ?? data.cadences.find((row) => row.file === file)?.name ?? null);
    setPickerValid(true); setSubmittedContent(null); setEditResult(null);
  };

  async function submitEdit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!editFile) return;
    const token = (await requireSession())?.token;
    if (!token) { setEditResult({ ok: false, reason: 'the dashboard is locked' }); return; }
    setEditBusy(true); setEditResult(null);
    try {
      const response = await fetch('/api/schedules/edit', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ file: editFile, content }) });
      await invalidateSessionOnGovernedAuthFailure(response);
      const result = await response.json() as EditResponse;
      if (response.ok && result.ok) { setSubmittedContent(content); setEditResult(result); }
      else setEditResult({ ...result, ok: false, reason: `HTTP ${response.status}: ${result.reason ?? result.error ?? 'request refused'}` });
    } catch { setEditResult({ ok: false, reason: 'edit request failed' }); } finally { setEditBusy(false); }
  }

  async function pauseCadence(name: string): Promise<void> {
    const token = (await requireSession())?.token;
    if (!token) { setPauseMessages((old) => ({ ...old, [name]: 'dashboard locked; cadence was not paused' })); return; }
    try {
      const response = await fetch('/api/write/pause-cadence', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ name }) });
      await invalidateSessionOnGovernedAuthFailure(response);
      const result = await response.json() as { path?: string; reason?: string; error?: string };
      setPauseMessages((old) => ({ ...old, [name]: response.ok ? `paused (${result.path ?? 'pause marker written'})` : `refused (HTTP ${response.status}): ${result.reason ?? result.error ?? 'request refused'}` }));
      if (response.ok) setPausedNames((old) => new Set(old).add(name));
    } catch { setPauseMessages((old) => ({ ...old, [name]: 'pause request failed' })); }
  }

  async function toggleHistory(row: ScheduleRow): Promise<void> {
    const key = `${row.project}:${row.name}`;
    if (expandedHistory.has(key)) { setExpandedHistory((current) => { const next = new Set(current); next.delete(key); return next; }); return; }
    setExpandedHistory((current) => new Set(current).add(key));
    if (Object.hasOwn(histories, key)) return;
    setHistoryLoading((current) => new Set(current).add(key));
    try {
      const token = (await requireSession())?.token; if (!token) throw new Error('locked');
      const response = await fetch(`/api/panels/schedules/history?project=${encodeURIComponent(row.project)}&cadence=${encodeURIComponent(row.name)}`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('unavailable');
      const history = await response.json() as ScheduleHistory;
      setHistories((current) => ({ ...current, [key]: history }));
    } catch { setHistories((current) => ({ ...current, [key]: null })); } finally { setHistoryLoading((current) => { const next = new Set(current); next.delete(key); return next; }); }
  }

  return <div className="schedules">
    <div className="schedules__intro"><h4>Schedules <span>{data.cadences.length}</span></h4><p>{data.pausedCount} paused · HEARTBEAT declarations only</p></div>
    {data.cadences.length === 0 ? <p className="schedules__quiet">No schedules are declared yet.</p> : <ul className="schedules__list">
      {data.cadences.map((row) => {
        const paused = row.paused || pausedNames.has(row.name);
        const historyKey = `${row.project}:${row.name}`;
        const historyOpen = expandedHistory.has(historyKey);
        const attention = needsYou(row.lastRun?.narration ?? null);
        return <li className="schedules__card" data-testid={`schedules-row-${row.name}`} key={`${row.file}:${row.name}`}>
          <div className="schedules__card-main">
            <div className="schedules__title"><span className="schedules__project">{row.project}</span><strong>{row.name}</strong>{paused ? <span className="mc-badge schedules__paused" data-testid={`schedules-state-${row.name}`}>paused</span> : null}</div>
            <p className="schedules__recurrence">{describeSchedule(row.schedule).label}</p>
          </div>
          <div className="schedules__card-status"><span className="schedules__next"><small>next window</small>{relativeScheduleWindow(nextScheduleWindow(row.schedule))}</span><LastOutcome row={row} />{attention ? <span className="mc-badge schedules__needs-you">needs you</span> : null}</div>
          <div className="schedules__actions">{editsAvailable ? <button type="button" onClick={() => openEditor(row.file, row.name)}>Edit in PR</button> : null}{!paused ? <button type="button" onClick={() => void pauseCadence(row.name)} aria-label={`Pause cadence ${row.name}`}>Pause</button> : null}<button type="button" onClick={() => void toggleHistory(row)} aria-expanded={historyOpen} aria-label={`History for cadence ${row.name}`}>{historyOpen ? 'Hide history' : 'History'}</button></div>
          {unboundedCron(row.schedule) ? <p className="schedules__quiet" data-testid={`schedules-subhourly-${row.name}`}>This declaration can fire many times a day, each spending tokens.</p> : null}
          {paused ? <p className="schedules__quiet">Resuming is a manual ops act (delete queue/paused/{row.name})</p> : null}
          {pauseMessages[row.name] ? <p data-testid={`schedules-pause-${row.name}`} className="schedules__quiet">{pauseMessages[row.name]}</p> : null}
          {historyOpen ? <section className="schedules__history" data-testid={`schedules-history-${row.name}`}><HistoryTimeline history={histories[historyKey]} loading={historyLoading.has(historyKey)} /></section> : null}
        </li>;
      })}
    </ul>}
    {!editsAvailable ? <p className="schedules__quiet" data-testid="schedules-edit-unavailable">{data.edits?.reason}</p> : null}
    <div className="schedules__files"><span>Declaration files</span>{Object.keys(data.files).map((file) => editsAvailable ? <button type="button" key={file} onClick={() => openEditor(file)}>Edit {file} in PR</button> : <code key={file}>{file}</code>)}</div>
    {editFile ? <div className="schedules__backdrop" onMouseDown={() => setEditFile(null)}><form className="schedules__sheet" role="dialog" aria-modal="true" aria-label="Edit schedule in pull request" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => void submitEdit(event)}>
      <div className="schedules__sheet-head"><div><span className="schedules__project">{editFile}</span><h4>Edit schedule in PR</h4></div><button type="button" aria-label="Close schedule editor" onClick={() => setEditFile(null)}>Close</button></div>
      <p className="schedules__quiet">Choose a cadence and recurrence. The resulting change is proposed for human review.</p>
      {cadenceForPicker ? <><label className="schedules__cadence">Cadence<select aria-label="cadence" value={cadenceForPicker.name} onChange={(event) => { setSelectedCadence(event.target.value); setPickerValid(true); }}><option value={cadenceForPicker.name}>{cadenceForPicker.name}</option>{editableCadences.filter((row) => row.name !== cadenceForPicker.name).map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}</select></label><RecurrencePicker key={`${editFile}:${cadenceForPicker.name}:${cadenceForPicker.schedule ?? ''}`} initialCron={cadenceForPicker.schedule} onChange={(schedule) => setContent((current) => replaceCadenceSchedule(current, cadenceForPicker.name, schedule))} onValidityChange={setPickerValid} /></> : <p className="schedules__quiet">This file has no declared cadence.</p>}
      <details className="schedules__source"><summary>Review full source</summary><label>Full file contents — replaces {editFile}<textarea aria-label={`full file contents — replaces ${editFile}`} value={content} onChange={(event) => setContent(event.target.value)} /></label></details>
      <div className="schedules__sheet-actions"><button type="submit" disabled={editDisabled}>{editBusy ? 'Creating PR…' : 'Create edit PR'}</button></div>
      {editResult ? <p className="schedules__quiet" data-testid="schedules-edit-result">{editResult.ok ? <>Edit proposed; merges by human only. {editResult.pr?.url ? <a href={editResult.pr.url}>Open pull request</a> : 'PR metadata unavailable.'}</> : `Edit refused: ${editResult.reason ?? 'request failed'}`}</p> : null}
    </form></div> : null}
    <p className="schedules__quiet">Read-only timing display. The dashboard never starts, resumes, or reschedules a run.</p>
  </div>;
}

