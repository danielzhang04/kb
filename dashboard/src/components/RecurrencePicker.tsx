/**
 * A small, pure editor for the subset of cron that describes selected weekdays at one or more
 * times of day. It deliberately does not try to be a general cron editor: expressions with a
 * day-of-month, month, interval, or non-representable minute/hour cross-product stay raw.
 */
import { useEffect, useRef, useState } from 'react';
import './RecurrencePicker.css';

const DAYS = [
  { label: 'Mon', cron: 'mon' },
  { label: 'Tue', cron: 'tue' },
  { label: 'Wed', cron: 'wed' },
  { label: 'Thu', cron: 'thu' },
  { label: 'Fri', cron: 'fri' },
  { label: 'Sat', cron: 'sat' },
  { label: 'Sun', cron: 'sun' },
] as const;

type Day = (typeof DAYS)[number]['cron'];

interface StructuredValue {
  days: Day[];
  times: string[];
}

export interface RecurrencePickerProps {
  /** A five-field cron to decompose when it uses only weekdays and one representable set of times. */
  initialCron?: string | null;
  /** Called only with a valid five-field cron emitted by this picker. */
  onChange: (cron: string) => void;
  /** Reports whether the visible weekday/time value can safely replace a schedule. */
  onValidityChange?: (isValid: boolean) => void;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function timeErrors(times: string[]): Map<number, string> {
  const errors = new Map<number, string>();
  const seen = new Map<string, number>();
  times.forEach((time, index) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      errors.set(index, `Time ${index + 1} is invalid.`);
      return;
    }
    const first = seen.get(time);
    if (first !== undefined) {
      errors.set(first, `Time ${first + 1} duplicates time ${index + 1}.`);
      errors.set(index, `Time ${index + 1} duplicates time ${first + 1}.`);
      return;
    }
    seen.set(time, index);
  });
  return errors;
}

function numbers(field: string, maximum: number): number[] | null {
  if (!/^\d+(?:,\d+)*$/.test(field)) return null;
  const values = field.split(',').map(Number);
  return values.every((value) => Number.isInteger(value) && value >= 0 && value <= maximum)
    ? [...new Set(values)].sort((a, b) => a - b)
    : null;
}

function days(field: string): Day[] | null {
  if (field === '*') return DAYS.map((day) => day.cron);
  const aliases: Record<string, Day> = { '0': 'sun', '7': 'sun', '1': 'mon', '2': 'tue', '3': 'wed', '4': 'thu', '5': 'fri', '6': 'sat' };
  const values = field.toLowerCase().split(',').map((value) => aliases[value] ?? (DAYS.some((day) => day.cron === value) ? value as Day : null));
  if (values.some((value) => value === null)) return null;
  return DAYS.filter((day) => values.includes(day.cron)).map((day) => day.cron);
}

/** Return a structured representation only when cron can name exactly the chosen times. */
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

/** Compile only the picker subset to cron. Cross-product time sets are intentionally refused. */
export function compileRecurrence(value: StructuredValue): string | null {
  if (timeErrors(value.times).size > 0) return null;
  const times = uniqueSorted(value.times);
  const selectedDays = DAYS.filter((day) => value.days.includes(day.cron)).map((day) => day.cron);
  if (times.length === 0 || selectedDays.length === 0) return null;
  const [firstHour, firstMinute] = times[0].split(':').map(Number);
  const hours = uniqueSorted(times.map((time) => time.slice(0, 2)));
  const minutes = uniqueSorted(times.map((time) => time.slice(3, 5)));
  if (hours.length > 1 && minutes.length > 1) return null;
  const minuteField = minutes.map(Number).sort((a, b) => a - b).join(',');
  const hourField = hours.map(Number).sort((a, b) => a - b).join(',');
  // The destructure validates the sole-time case at the type boundary too; its values are otherwise
  // intentionally not used because the sorted fields above are the canonical cron representation.
  if (!Number.isInteger(firstHour) || !Number.isInteger(firstMinute)) return null;
  const dayField = selectedDays.length === DAYS.length ? '*' : selectedDays.join(',');
  return `${minuteField} ${hourField} * * ${dayField}`;
}

function preview(value: StructuredValue): string {
  const everyDay = value.days.length === DAYS.length;
  const dayText = everyDay ? 'every day' : `on ${DAYS.filter((day) => value.days.includes(day.cron)).map((day) => day.label).join(', ')}`;
  return `Runs ${dayText} at ${value.times.join(', ')}.`;
}

const DEFAULT_VALUE: StructuredValue = { days: DAYS.map((day) => day.cron), times: ['09:00'] };

export function RecurrencePicker({ initialCron, onChange, onValidityChange }: RecurrencePickerProps): React.JSX.Element {
  const initial = decomposeRecurrence(initialCron);
  const [value, setValue] = useState<StructuredValue>(initial ?? DEFAULT_VALUE);
  const [raw, setRaw] = useState<string | null>(initial ? null : (initialCron?.trim() || null));
  const cron = raw === null ? compileRecurrence(value) : null;
  const lastEmitted = useRef<string | null>(null);
  const valid = raw !== null || cron !== null;

  useEffect(() => {
    // Parents commonly hand this component an inline callback that updates their prefilled source.
    // Remembering the value makes that benign re-render a no-op instead of a callback loop.
    if (cron && cron !== lastEmitted.current) {
      lastEmitted.current = cron;
      onChange(cron);
    }
  }, [cron, onChange]);

  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  if (raw !== null) {
    return (
      <div className="recurrence-picker" data-testid="recurrence-picker-raw">
        <p className="recurrence-picker__note">This schedule uses raw cron and is shown unchanged.</p>
        <code>{raw}</code>
        <button type="button" onClick={() => setRaw(null)}>Use weekday and time picker</button>
      </div>
    );
  }

  const canCompile = cron !== null;
  const errors = timeErrors(value.times);
  return (
    <fieldset className="recurrence-picker" data-testid="recurrence-picker">
      <legend>Repeat</legend>
      <div className="recurrence-picker__days" aria-label="Days of week">
        {DAYS.map((day) => (
          <label key={day.cron}>
            <input
              type="checkbox"
              checked={value.days.includes(day.cron)}
              onChange={() => setValue((current) => ({
                ...current,
                days: current.days.includes(day.cron)
                  ? current.days.filter((selected) => selected !== day.cron)
                  : [...current.days, day.cron],
              }))}
            />
            {day.label}
          </label>
        ))}
      </div>
      <div className="recurrence-picker__times">
        {value.times.map((time, index) => (
          <div key={`${time}-${index}`}>
            <label>
              Time
              <input
                aria-label={`Time ${index + 1}`}
                type="time"
                value={time}
                onChange={(event) => setValue((current) => ({
                  ...current,
                  times: current.times.map((currentTime, currentIndex) => currentIndex === index ? event.target.value : currentTime),
                }))}
              />
            </label>
            {errors.has(index) ? <p className="recurrence-picker__error" data-testid={`recurrence-time-error-${index + 1}`}>{errors.get(index)}</p> : null}
            {value.times.length > 1 ? <button type="button" onClick={() => setValue((current) => ({ ...current, times: current.times.filter((_, currentIndex) => currentIndex !== index) }))}>Remove time</button> : null}
          </div>
        ))}
        <button type="button" onClick={() => setValue((current) => ({ ...current, times: [...current.times, current.times[current.times.length - 1] ?? '09:00'] }))}>Add time</button>
      </div>
      <p className="recurrence-picker__preview" aria-live="polite">{canCompile ? preview(value) : value.days.length === 0 ? 'Choose at least one day.' : 'Correct the highlighted time rows and choose times that share an hour or minute.'}</p>
      {canCompile ? <code className="recurrence-picker__cron">{cron}</code> : null}
    </fieldset>
  );
}
