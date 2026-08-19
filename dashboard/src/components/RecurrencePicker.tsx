/** A deliberately bounded, Google-Calendar-style schedule editor for governed PR proposals. */
import { useEffect, useRef, useState } from 'react';
import { describeSchedule, presetSchedule, type RecurrencePreset } from '../lib/scheduleWords';
import './RecurrencePicker.css';

const DAYS = [
  { label: 'Mon', cron: 'mon' }, { label: 'Tue', cron: 'tue' }, { label: 'Wed', cron: 'wed' },
  { label: 'Thu', cron: 'thu' }, { label: 'Fri', cron: 'fri' }, { label: 'Sat', cron: 'sat' }, { label: 'Sun', cron: 'sun' },
] as const;

type Day = (typeof DAYS)[number]['cron'];

interface StructuredValue { days: Day[]; times: string[]; }

export interface RecurrencePickerProps {
  initialCron?: string | null;
  onChange: (cron: string) => void;
  onValidityChange?: (isValid: boolean) => void;
}

function uniqueSorted(values: string[]): string[] { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }

function timeErrors(times: string[]): Map<number, string> {
  const errors = new Map<number, string>();
  const seen = new Map<string, number>();
  times.forEach((time, index) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { errors.set(index, `Time ${index + 1} is invalid.`); return; }
    const first = seen.get(time);
    if (first !== undefined) {
      errors.set(first, `Time ${first + 1} duplicates time ${index + 1}.`);
      errors.set(index, `Time ${index + 1} duplicates time ${first + 1}.`);
    } else seen.set(time, index);
  });
  return errors;
}

function numbers(field: string, maximum: number): number[] | null {
  if (!/^\d+(?:,\d+)*$/.test(field)) return null;
  const values = field.split(',').map(Number);
  return values.every((value) => Number.isInteger(value) && value >= 0 && value <= maximum) ? [...new Set(values)].sort((a, b) => a - b) : null;
}

function days(field: string): Day[] | null {
  if (field === '*') return DAYS.map((item) => item.cron);
  const aliases: Record<string, Day> = { '0': 'sun', '7': 'sun', '1': 'mon', '2': 'tue', '3': 'wed', '4': 'thu', '5': 'fri', '6': 'sat' };
  const values = field.toLowerCase().split(',').map((value) => aliases[value] ?? (DAYS.some((item) => item.cron === value) ? value as Day : null));
  if (values.some((value) => value === null)) return null;
  return DAYS.filter((item) => values.includes(item.cron)).map((item) => item.cron);
}

/** Return a structured representation only when cron can name exactly the selected times. */
export function decomposeRecurrence(cron: string | null | undefined): StructuredValue | null {
  const fields = (cron ?? '').trim().split(/\s+/);
  if (fields.length !== 5 || fields[2] !== '*' || fields[3] !== '*') return null;
  const minutes = numbers(fields[0], 59);
  const hours = numbers(fields[1], 23);
  const selectedDays = days(fields[4]);
  if (!minutes || !hours || !selectedDays || (minutes.length > 1 && hours.length > 1)) return null;
  const times = minutes.length === 1
    ? hours.map((hour) => `${String(hour).padStart(2, '0')}:${String(minutes[0]).padStart(2, '0')}`)
    : minutes.map((minute) => `${String(hours[0]).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  return { days: selectedDays, times };
}

/** Compile only the custom-picker subset to cron. Cross-product time sets are intentionally refused. */
export function compileRecurrence(value: StructuredValue): string | null {
  if (timeErrors(value.times).size > 0) return null;
  const times = uniqueSorted(value.times);
  const selectedDays = DAYS.filter((item) => value.days.includes(item.cron)).map((item) => item.cron);
  if (times.length === 0 || selectedDays.length === 0) return null;
  const hours = uniqueSorted(times.map((time) => time.slice(0, 2)));
  const minutes = uniqueSorted(times.map((time) => time.slice(3, 5)));
  if (hours.length > 1 && minutes.length > 1) return null;
  const minuteField = minutes.map(Number).sort((a, b) => a - b).join(',');
  const hourField = hours.map(Number).sort((a, b) => a - b).join(',');
  const dayField = selectedDays.length === DAYS.length ? '*' : selectedDays.join(',');
  return `${minuteField} ${hourField} * * ${dayField}`;
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

export function RecurrencePicker({ initialCron, onChange, onValidityChange }: RecurrencePickerProps): React.JSX.Element {
  const initialStructured = decomposeRecurrence(initialCron);
  const initialDescription = describeSchedule(initialCron);
  const [preset, setPreset] = useState<RecurrencePreset>(initialDescription.preset);
  const [value, setValue] = useState<StructuredValue>(initialStructured ?? DEFAULT_VALUE);
  const [weeklyDay, setWeeklyDay] = useState<Day>(initialDescription.weeklyDay ?? 'mon');
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
    if (next === 'custom-raw') setRaw(initialStructured ? null : raw);
  };

  const errors = timeErrors(value.times);
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
          <select aria-label="Weekly day" value={weeklyDay} onChange={(event) => { changed.current = true; setWeeklyDay(event.target.value as Day); }}>
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

      {preset === 'custom-raw' && raw === null ? (
        <div className="recurrence-picker__custom">
          <div className="recurrence-picker__days" aria-label="Days of week">
            {DAYS.map((item) => (
              <label className="recurrence-picker__day" key={item.cron}>
                <input aria-label={item.label} type="checkbox" checked={value.days.includes(item.cron)} onChange={() => {
                  changed.current = true;
                  setValue((current) => ({ ...current, days: current.days.includes(item.cron) ? current.days.filter((selected) => selected !== item.cron) : [...current.days, item.cron] }));
                }} />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          <div className="recurrence-picker__times">
            {value.times.map((time, index) => (
              <div className="recurrence-picker__time-row" key={`${time}-${index}`}>
                <label>Time <input aria-label={`Time ${index + 1}`} type="time" value={time} onChange={(event) => {
                  changed.current = true;
                  setValue((current) => ({ ...current, times: current.times.map((currentTime, currentIndex) => currentIndex === index ? event.target.value : currentTime) }));
                }} /></label>
                {value.times.length > 1 ? <button type="button" onClick={() => { changed.current = true; setValue((current) => ({ ...current, times: current.times.filter((_, currentIndex) => currentIndex !== index) })); }}>Remove time</button> : null}
                {errors.has(index) ? <p className="recurrence-picker__error" data-testid={`recurrence-time-error-${index + 1}`}>{errors.get(index)}</p> : null}
              </div>
            ))}
            <button type="button" onClick={() => { changed.current = true; setValue((current) => ({ ...current, times: [...current.times, current.times[current.times.length - 1] ?? '09:00'] })); }}>Add time</button>
          </div>
          <p className="recurrence-picker__preview" aria-live="polite">{customCron ? preview(value) : value.days.length === 0 ? 'Choose at least one day.' : 'Correct the highlighted time rows and choose times that share an hour or minute.'}</p>
        </div>
      ) : null}
      {preset !== 'custom-raw' ? <p className="recurrence-picker__preview" aria-live="polite">{describeSchedule(schedule).label}</p> : null}
    </fieldset>
  );
}
