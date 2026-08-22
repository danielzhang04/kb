import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RunnableRef, Schedule } from '../../server/control/p2Contracts.ts';
import type { CadenceInput, ScheduleCollection } from '../../server/schedules/contracts.ts';
import { humanizeEntityId } from '../entity/humanizeEntityId.ts';
import {
  ScheduleClientError,
  createSchedule,
  deleteSchedule,
  fetchSchedules,
  setScheduleArmed,
} from '../lib/scheduleClient.ts';
import { fetchEntityList } from '../lib/entityClient.ts';
import { localTimestampLabel, validateScheduleCadence } from '../lib/scheduleWords.ts';
import { useSession } from '../lib/sessionContext.tsx';
import '../styles/views/schedules.css';

function ownerKey(owner: RunnableRef): string {
  return `${owner.type}:${owner.id}`;
}

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function cadenceInput(format: 'words' | 'cron', words: string, time: string, cron: string): CadenceInput {
  if (format === 'words') return { kind: 'words', words, time };
  const [minute = '', hour = '', dayOfMonth = '', month = '', dayOfWeek = '', ...extra] = cron.trim().split(/\s+/);
  return {
    kind: 'cron', minute, hour, dayOfMonth, month,
    dayOfWeek: extra.length === 0 ? dayOfWeek : `${dayOfWeek} ${extra.join(' ')}`,
  };
}

function errorWords(error: unknown): string {
  if (error instanceof ScheduleClientError && error.code === 'invalid-cadence') {
    return 'Invalid cadence. Check the words, time, or five-field cron.';
  }
  if (error instanceof ScheduleClientError && error.code === 'stale-schedule-version') {
    return 'This schedule changed. Reload schedules and try again.';
  }
  return 'Schedule request failed. Nothing was changed.';
}

export function SchedulesBody({ scheduleOwner }: { scheduleOwner?: RunnableRef } = {}): React.JSX.Element {
  const { session } = useSession();
  const [snapshot, setSnapshot] = useState<ScheduleCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [ownerChoices, setOwnerChoices] = useState<RunnableRef[]>([]);
  const [ownerChoicesFailed, setOwnerChoicesFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedOwner, setSelectedOwner] = useState(scheduleOwner ? ownerKey(scheduleOwner) : '');
  const [format, setFormat] = useState<'words' | 'cron'>('words');
  const [words, setWords] = useState('daily');
  const [time, setTime] = useState('09:00');
  const [cron, setCron] = useState('0 9 * * *');
  const [cadenceError, setCadenceError] = useState<string | null>(null);

  useEffect(() => {
    if (scheduleOwner) setSelectedOwner(ownerKey(scheduleOwner));
  }, [scheduleOwner]);

  const load = useCallback(async (): Promise<void> => {
    if (!session) return;
    setLoading(true);
    setLoadFailed(false);
    setOwnerChoicesFailed(false);
    const [schedulesResult, agentsResult, workflowsResult] = await Promise.allSettled([
      fetchSchedules(session.token),
      fetchEntityList('agents'),
      fetchEntityList('workflows'),
    ]);
    if (schedulesResult.status === 'fulfilled') {
      setSnapshot(schedulesResult.value);
    } else {
      setSnapshot(null);
      setLoadFailed(true);
    }
    const refs: RunnableRef[] = [];
    if (agentsResult.status === 'fulfilled') {
      refs.push(...agentsResult.value.items.map((item) => item.ref).filter((ref) => ref.type === 'agent'));
    }
    if (workflowsResult.status === 'fulfilled') {
      refs.push(...workflowsResult.value.items.map((item) => item.ref).filter((ref) => ref.type === 'workflow'));
    }
    setOwnerChoices(refs);
    setOwnerChoicesFailed(agentsResult.status === 'rejected' || workflowsResult.status === 'rejected');
    setLoading(false);
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const owners = useMemo(() => {
    const refs = new Map<string, RunnableRef>();
    if (scheduleOwner) refs.set(ownerKey(scheduleOwner), scheduleOwner);
    for (const owner of ownerChoices) refs.set(ownerKey(owner), owner);
    for (const row of snapshot?.rows ?? []) refs.set(ownerKey(row.owner), row.owner);
    return [...refs.values()].sort((left, right) => ownerKey(left).localeCompare(ownerKey(right)));
  }, [ownerChoices, scheduleOwner, snapshot]);

  const applySchedule = (schedule: Schedule, collectionRevision: number): void => {
    setSnapshot((current) => ({
      scheduleCollectionRevision: collectionRevision,
      rows: [...(current?.rows ?? []).filter((row) => row.id !== schedule.id), schedule]
        .sort((left, right) => left.id.localeCompare(right.id)),
    }));
  };

  async function toggleArmed(row: Schedule): Promise<void> {
    if (!session) return;
    setBusyId(row.id);
    setMessage(null);
    try {
      const receipt = await setScheduleArmed(session.token, row.id, {
        expectedVersion: row.version,
        idempotencyKey: newKey(),
        armed: !row.armed,
      });
      applySchedule(receipt.schedule, receipt.collectionRevision);
    } catch (error) {
      setMessage(errorWords(error));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: Schedule): Promise<void> {
    if (!session) return;
    setBusyId(row.id);
    setMessage(null);
    try {
      const receipt = await deleteSchedule(session.token, row.id, {
        expectedVersion: row.version,
        idempotencyKey: newKey(),
      });
      setSnapshot((current) => ({
        scheduleCollectionRevision: receipt.collectionRevision,
        rows: (current?.rows ?? []).filter((candidate) => candidate.id !== row.id),
      }));
    } catch (error) {
      setMessage(errorWords(error));
    } finally {
      setBusyId(null);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!session || !snapshot) return;
    const cadence = cadenceInput(format, words, time, cron);
    const invalidCadence = validateScheduleCadence(cadence);
    if (invalidCadence) {
      setCadenceError(invalidCadence.message);
      return;
    }
    setCadenceError(null);
    const owner = owners.find((candidate) => ownerKey(candidate) === selectedOwner);
    if (!owner) {
      setMessage('Choose an existing Agent or Workflow.');
      return;
    }
    setBusyId('new');
    setMessage(null);
    try {
      const receipt = await createSchedule(session.token, {
        owner: { type: owner.type, id: owner.id },
        cadence,
        expectedCollectionRevision: snapshot.scheduleCollectionRevision,
        idempotencyKey: newKey(),
      });
      applySchedule(receipt.schedule, receipt.collectionRevision);
    } catch (error) {
      setMessage(errorWords(error));
    } finally {
      setBusyId(null);
    }
  }

  if (!session) return <p className="schedules__quiet" data-testid="schedules-locked">Unlock the dashboard to read schedules.</p>;
  if (loading && snapshot === null) return <p className="schedules__quiet">Reading schedules…</p>;
  if (loadFailed) return <div className="schedules__error"><p className="schedules__quiet">Schedules are unavailable. Nothing was changed.</p><button type="button" aria-label="Retry schedules" onClick={() => void load()}>Retry</button></div>;
  if (!snapshot) return <p className="schedules__quiet">Reading schedules…</p>;

  return <div className="schedules">
    <div className="schedules__intro"><h4>Schedules <span>{snapshot.rows.length}</span></h4><p>Live schedule store</p></div>
    {snapshot.rows.length === 0 ? <p className="schedules__quiet">No schedules</p> : <ul className="schedules__list">
      {snapshot.rows.map((row) => {
        const name = humanizeEntityId(row.owner.id);
        return <li className="schedules__card" data-testid={`schedules-row-${row.id}`} key={row.id}>
          <div className="schedules__card-main">
            <div className="schedules__title"><strong title={row.owner.id}>{name}</strong><span className="schedules__project" title={row.owner.type === 'workflow' ? row.owner.project : row.owner.type}>{row.owner.type === 'workflow' ? humanizeEntityId(row.owner.project) : 'Agent'}</span><span className="mc-badge schedules__outcome">{row.armed ? 'armed' : 'disarmed'}</span></div>
            <p className="schedules__recurrence">{row.cadence.words}</p>
            <p className="schedules__quiet">{row.nextAt ? `Next ${localTimestampLabel(row.nextAt)}` : 'Next fire not computed'} · {row.lastOutcome ? `Last ${row.lastOutcome}` : 'Never run'}</p>
          </div>
          <div className="schedules__actions">
            <button type="button" disabled={busyId === row.id} aria-label={`${row.armed ? 'Disarm' : 'Arm'} ${name}`} onClick={() => void toggleArmed(row)}>{row.armed ? 'Disarm' : 'Arm'}</button>
            <button type="button" disabled={busyId === row.id} aria-label={`Delete ${name}`} onClick={() => void remove(row)}>Delete</button>
          </div>
        </li>;
      })}
    </ul>}
    <form className="schedules__sheet schedules__new" onSubmit={(event) => void submit(event)}>
      <h4>New schedule</h4>
      <label className="schedules__cadence">Owner<select aria-label="Schedule owner" disabled={scheduleOwner !== undefined} value={selectedOwner} onChange={(event) => setSelectedOwner(event.target.value)}><option value="">Choose an Agent or Workflow</option>{owners.map((owner) => <option key={ownerKey(owner)} value={ownerKey(owner)}>{humanizeEntityId(owner.id)}</option>)}</select>{ownerChoicesFailed && scheduleOwner === undefined ? <span className="schedules__quiet">Agent and Workflow choices are unavailable.</span> : null}</label>
      <label className="schedules__cadence">Cadence format<select aria-label="Cadence format" value={format} onChange={(event) => setFormat(event.target.value as 'words' | 'cron')}><option value="words">Words and time</option><option value="cron">Five-field cron</option></select></label>
      {format === 'words' ? <div className="schedules__cadence-row"><label className="schedules__cadence">Recurrence<select value={words} onChange={(event) => setWords(event.target.value)}><option value="daily">Daily</option><option value="weekday">Weekdays</option><option value="weekly:sun">Weekly on Sunday</option></select></label><label className="schedules__cadence">Time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label></div> : <label className="schedules__cadence">Five-field cron<input aria-label="Five-field cron" value={cron} onChange={(event) => setCron(event.target.value)} /></label>}
      {cadenceError ? <p className="schedules__quiet" role="alert">{cadenceError}</p> : null}
      <div className="schedules__sheet-actions"><button type="submit" disabled={busyId === 'new' || selectedOwner === ''}>Create schedule</button></div>
    </form>
    {message ? <p className="schedules__quiet" role="status">{message}</p> : null}
  </div>;
}

export function Schedules({ scheduleOwner }: { scheduleOwner?: RunnableRef } = {}): React.JSX.Element {
  return <SchedulesBody scheduleOwner={scheduleOwner} />;
}
