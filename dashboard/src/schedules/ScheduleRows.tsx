/** Store-backed Schedule rows prepared for the W6.4 live-route cutover. */
import { useCallback, useEffect, useState } from 'react';
import type { Schedule } from '../../server/control/p2Contracts.ts';
import type { ScheduleCollection } from '../../server/schedules/contracts.ts';
import { humanizeEntityId } from '../entity/humanizeEntityId.ts';
import {
  ScheduleClientError,
  createSchedule,
  deleteSchedule,
  fetchSchedules,
  setScheduleArmed,
} from '../lib/scheduleClient.ts';
import { localTimestampLabel, validateScheduleCadence } from '../lib/scheduleWords.ts';
import { useSession } from '../lib/sessionContext.tsx';
import '../styles/views/schedules.css';

interface ScheduleListProps {
  schedules: Schedule[];
  onSetArmed(schedule: Schedule, armed: boolean): void;
  onDelete(schedule: Schedule): void;
  busyId: string | null;
  errors: Readonly<Record<string, string>>;
}

function ScheduleList({ schedules, onSetArmed, onDelete, busyId, errors }: ScheduleListProps): React.JSX.Element {
  if (schedules.length === 0) return <p className="schedules__quiet">No schedules</p>;
  return <ul className="schedules__list">
    {schedules.map((schedule) => {
      const name = humanizeEntityId(schedule.owner.id);
      return <li className="schedules__card" data-testid={`schedules-row-${schedule.id}`} key={schedule.id}>
        <div className="schedules__card-main">
          <div className="schedules__title"><strong>{name}</strong><span className="mc-badge">{schedule.origin}</span></div>
          <p className="schedules__recurrence">{schedule.cadence.words}</p>
        </div>
        <div className="schedules__card-status">
          <span className="schedules__next"><small>next</small>{schedule.nextAt ? localTimestampLabel(schedule.nextAt) : 'not scheduled'}</span>
          <span className="mc-badge schedules__outcome">{schedule.lastOutcome ?? 'never run'}</span>
        </div>
        <div className="schedules__actions">
          <button type="button" disabled={busyId === schedule.id} onClick={() => onSetArmed(schedule, !schedule.armed)} aria-label={`${schedule.armed ? 'Disarm' : 'Arm'} ${name}`}>{schedule.armed ? 'Disarm' : 'Arm'}</button>
          <button type="button" disabled={busyId === schedule.id} onClick={() => onDelete(schedule)} aria-label={`Delete ${name}`}>Delete</button>
        </div>
        {errors[schedule.id] ? <p className="schedules__quiet" role="alert">{errors[schedule.id]}</p> : null}
      </li>;
    })}
  </ul>;
}

export function ScheduleRows(): React.JSX.Element {
  const { session, requireSession } = useSession();
  const sessionToken = session?.token ?? null;
  const [snapshot, setSnapshot] = useState<ScheduleCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ownerType, setOwnerType] = useState<'agent' | 'workflow'>('agent');
  const [ownerId, setOwnerId] = useState('');
  const [cron, setCron] = useState('0 9 * * *');

  const load = useCallback(async (): Promise<void> => {
    if (!sessionToken) return;
    setLoading(true);
    setLoadError(false);
    try { setSnapshot(await fetchSchedules(sessionToken)); }
    catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [sessionToken]);

  useEffect(() => { void load(); }, [load]);

  const mutationError = (error: unknown): string => error instanceof ScheduleClientError ? error.code : 'schedule-request-failed';

  async function changeArmed(schedule: Schedule, armed: boolean): Promise<void> {
    const token = (await requireSession())?.token;
    if (!token) return;
    setBusyId(schedule.id);
    setErrors((current) => ({ ...current, [schedule.id]: '' }));
    try {
      const receipt = await setScheduleArmed(token, schedule.id, {
        expectedVersion: schedule.version,
        idempotencyKey: `schedule-${schedule.id}-${schedule.version}-${armed ? 'arm' : 'disarm'}`,
        armed,
      });
      setSnapshot((current) => current ? {
        scheduleCollectionRevision: receipt.collectionRevision,
        rows: current.rows.map((row) => row.id === schedule.id ? receipt.schedule : row),
      } : current);
    } catch (error) { setErrors((current) => ({ ...current, [schedule.id]: mutationError(error) })); }
    finally { setBusyId(null); }
  }

  async function remove(schedule: Schedule): Promise<void> {
    const token = (await requireSession())?.token;
    if (!token) return;
    setBusyId(schedule.id);
    try {
      const receipt = await deleteSchedule(token, schedule.id, {
        expectedVersion: schedule.version,
        idempotencyKey: `schedule-${schedule.id}-${schedule.version}-delete`,
      });
      setSnapshot((current) => current ? {
        scheduleCollectionRevision: receipt.collectionRevision,
        rows: current.rows.filter((row) => row.id !== schedule.id),
      } : current);
    } catch (error) { setErrors((current) => ({ ...current, [schedule.id]: mutationError(error) })); }
    finally { setBusyId(null); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!snapshot) return;
    const fields = cron.trim().split(/\s+/);
    const cadence = { kind: 'cron' as const, minute: fields[0] ?? '', hour: fields[1] ?? '', dayOfMonth: fields[2] ?? '', month: fields[3] ?? '', dayOfWeek: fields[4] ?? '' };
    if (fields.length !== 5 || ownerId.trim() === '' || validateScheduleCadence(cadence)) {
      setErrors((current) => ({ ...current, create: 'invalid-cadence' }));
      return;
    }
    const token = (await requireSession())?.token;
    if (!token) return;
    setBusyId('create');
    setErrors((current) => ({ ...current, create: '' }));
    try {
      const receipt = await createSchedule(token, {
        owner: { type: ownerType, id: ownerId.trim() },
        cadence,
        expectedCollectionRevision: snapshot.scheduleCollectionRevision,
        idempotencyKey: `schedule-create-${ownerType}-${ownerId.trim()}-${Date.now()}`,
      });
      setSnapshot((current) => current ? {
        scheduleCollectionRevision: receipt.collectionRevision,
        rows: [...current.rows.filter((row) => row.id !== receipt.schedule.id), receipt.schedule],
      } : current);
    } catch (error) { setErrors((current) => ({ ...current, create: mutationError(error) })); }
    finally { setBusyId(null); }
  }

  if (!session) return <p className="schedules__quiet" data-testid="schedules-locked">Unlock the dashboard to read schedules.</p>;
  if (loading && snapshot === null) return <p className="schedules__quiet">Reading schedules…</p>;
  if (loadError && snapshot === null) return <div className="schedules__quiet" data-testid="schedules-unavailable"><p>Schedules are unavailable.</p><button type="button" onClick={() => void load()} aria-label="Retry schedules">Retry</button></div>;

  return <div className="schedules">
    <div className="schedules__intro"><h4>Schedules <span>{snapshot?.rows.length ?? 0}</span></h4></div>
    <form className="schedules__sheet" onSubmit={(event) => void submit(event)}>
      <label>Owner type<select value={ownerType} onChange={(event) => setOwnerType(event.target.value as 'agent' | 'workflow')}><option value="agent">Agent</option><option value="workflow">Workflow</option></select></label>
      <label>Owner id<input aria-label="Owner id" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} /></label>
      <label>Cron<input aria-label="Cron" value={cron} onChange={(event) => setCron(event.target.value)} /></label>
      <button type="submit" disabled={busyId === 'create'}>Create schedule</button>
      {errors.create ? <p className="schedules__quiet" role="alert">{errors.create}</p> : null}
    </form>
    <ScheduleList
      schedules={snapshot?.rows ?? []}
      onSetArmed={(schedule, armed) => void changeArmed(schedule, armed)}
      onDelete={(schedule) => void remove(schedule)}
      busyId={busyId}
      errors={errors}
    />
  </div>;
}
