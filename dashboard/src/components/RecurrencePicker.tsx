/** A deliberately bounded, Google-Calendar-style schedule editor for governed PR proposals. */
import { useEffect, useRef, useState } from 'react';
import {
  compileRecurrence,
  decomposeRecurrence,
  describeSchedule,
  presetSchedule,
  recurrenceTimeErrors as timeErrors,
  type RecurrenceDay as Day,
  type RecurrencePreset,
  type StructuredRecurrence as StructuredValue,
} from '../lib/scheduleWords';
import './RecurrencePicker.css';

const DAYS = [
  { label: 'Mon', cron: 'mon' }, { label: 'Tue', cron: 'tue' }, { label: 'Wed', cron: 'wed' },
  { label: 'Thu', cron: 'thu' }, { label: 'Fri', cron: 'fri' }, { label: 'Sat', cron: 'sat' }, { label: 'Sun', cron: 'sun' },
] as const;

interface RecurrencePickerProps {
  initialCron?: string | null;
  onChange: (cron: string) => void;
  onValidityChange?: (isValid: boolean) => void;
}

function preview(value: StructuredValue): string {
  const everyDay = value.days.length === DAYS.length;
  const dayText = everyDay ? 'Daily' : DAYS.filter((item) => value.days.includes(item.cron)).map((item) => item.label).join(', ');
  const toWords = (time: string): string => {
    const [hour, minute] = time.split(':').map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  };
  return `${dayText} · ${value.times.map(toWords).join(', ')}`;
}

const DEFAULT_VALUE: StructuredValue = { days: DAYS.map((item) => item.cron), times: ['09:00'] };

function presetValue(preset: RecurrencePreset, weeklyDay: Day = 'mon'): StructuredValue {
  if (preset === 'weekday') return { days: DAYS.slice(0, 5).map((item) => item.cron), times: ['09:00'] };
  if (preset === 'weekly') return { days: [weeklyDay], times: ['09:00'] };
  return { days: [...DEFAULT_VALUE.days], times: [...DEFAULT_VALUE.times] };
}

export function RecurrencePicker({ initialCron, onChange, onValidityChange }: RecurrencePickerProps): React.JSX.Element {
  const initialStructured = decomposeRecurrence(initialCron);
  const initialDescription = describeSchedule(initialCron);
  const [preset, setPreset] = useState<RecurrencePreset>(initialDescription.preset);
  const [weeklyDay, setWeeklyDay] = useState<Day>(initialDescription.weeklyDay ?? 'mon');
  const [value, setValue] = useState<StructuredValue>(() => initialStructured ?? presetValue(initialDescription.preset, initialDescription.weeklyDay));
  const [raw, setRaw] = useState<string | null>(initialStructured ? null : initialDescription.raw ?? null);
  const changed = useRef(false);
  const lastEmitted = useRef<string | null>(null);
  const customCron = compileRecurrence(value);
  const schedule = preset === 'custom-raw' ? (raw === null ? customCron : null) : presetSchedule(preset, weeklyDay);
  const valid = schedule !== null;

  useEffect(() => {
    if (changed.current && schedule && schedule !== lastEmitted.current) {
      lastEmitted.current = schedule;
      onChange(schedule);
    }
  }, [onChange, schedule]);

  useEffect(() => { onValidityChange?.(valid); }, [onValidityChange, valid]);

  const choosePreset = (next: RecurrencePreset): void => {
    changed.current = true;
    setPreset(next);
    if (next === 'custom-raw') {
      // A visible preset becomes the editable starting point for Custom.
      setRaw(null);
    } else {
      setRaw(null);
      setValue(presetValue(next, weeklyDay));
    }
  };

  const errors = timeErrors(value.times);
  const editable = preset === 'custom-raw';
  return (
    <fieldset className="recurrence-picker" data-testid={raw !== null ? 'recurrence-picker-raw' : 'recurrence-picker'}>
      <legend>Recurrence</legend>
      <label className="recurrence-picker__preset">
        Repeat
        <select aria-label="Recurrence preset" value={preset} onChange={(event) => choosePreset(event.target.value as RecurrencePreset)}>
          <option value="daily">Daily</option>
          <option value="weekday">Every weekday (Mon–Fri)</option>
          <option value="weekly">Weekly on {DAYS.find((item) => item.cron === weeklyDay)?.label}</option>
          <option value="custom-raw">{raw !== null ? 'Custom (raw)' : 'Custom…'}</option>
        </select>
      </label>

      {preset === 'weekly' ? (
        <label className="recurrence-picker__weekly">Weekday
          <select aria-label="Weekly day" value={weeklyDay} onChange={(event) => {
            const nextDay = event.target.value as Day;
            changed.current = true;
            setWeeklyDay(nextDay);
            setValue((current) => ({ ...current, days: [nextDay] }));
          }}>
            {DAYS.map((item) => <option value={item.cron} key={item.cron}>{item.label}</option>)}
          </select>
        </label>
      ) : null}

      {preset === 'custom-raw' && raw !== null ? (
        <div className="recurrence-picker__raw">
          <p className="recurrence-picker__note">This declaration cannot be safely expressed by the selectors.</p>
          <code>{raw}</code>
          <button type="button" onClick={() => { changed.current = true; setRaw(null); }}>Use custom selectors</button>
        </div>
      ) : null}

      {raw === null ? (
        <div className="recurrence-picker__custom" aria-disabled={!editable}>
          <div className="recurrence-picker__days" aria-label="Days of week" aria-disabled={!editable}>
            {DAYS.map((item) => (
              <label className="recurrence-picker__day" data-read-only={!editable || undefined} key={item.cron}>
                <input aria-label={item.label} aria-disabled={!editable} checked={value.days.includes(item.cron)} disabled={!editable} type="checkbox" onChange={editable ? () => {
                  changed.current = true;
                  setValue((current) => ({ ...current, days: current.days.includes(item.cron) ? current.days.filter((selected) => selected !== item.cron) : [...current.days, item.cron] }));
                } : undefined} />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          <div className="recurrence-picker__times">
            {value.times.map((time, index) => (
              <div className="recurrence-picker__time-row" key={`${time}-${index}`}>
                <label>Time <input aria-label={`Time ${index + 1}`} aria-disabled={!editable} disabled={!editable} type="time" value={time} onChange={editable ? (event) => {
                  changed.current = true;
                  setValue((current) => ({ ...current, times: current.times.map((currentTime, currentIndex) => currentIndex === index ? event.target.value : currentTime) }));
                } : undefined} /></label>
                {value.times.length > 1 ? <button aria-disabled={!editable} disabled={!editable} type="button" onClick={editable ? () => { changed.current = true; setValue((current) => ({ ...current, times: current.times.filter((_, currentIndex) => currentIndex !== index) })); } : undefined}>Remove time</button> : null}
                {errors.has(index) ? <p className="recurrence-picker__error" data-testid={`recurrence-time-error-${index + 1}`}>{errors.get(index)}</p> : null}
              </div>
            ))}
            <button aria-disabled={!editable} disabled={!editable} type="button" onClick={editable ? () => { changed.current = true; setValue((current) => ({ ...current, times: [...current.times, current.times[current.times.length - 1] ?? '09:00'] })); } : undefined}>Add time</button>
          </div>
          <p className="recurrence-picker__preview" aria-live="polite">{customCron ? preview(value) : value.days.length === 0 ? 'Choose at least one day.' : 'Correct the highlighted time rows and choose times that share an hour or minute.'}</p>
        </div>
      ) : null}
      {preset !== 'custom-raw' ? <p className="recurrence-picker__preview" aria-live="polite">{describeSchedule(schedule).label}</p> : null}
    </fieldset>
  );
}
