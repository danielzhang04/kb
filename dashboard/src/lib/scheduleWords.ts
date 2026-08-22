/**
 * Human words for schedule declarations. This is a display/editor aid only:
 * scripts/dispatch.py remains the scheduler and source of truth for every fire.
 */

export type RecurrencePreset = 'daily' | 'weekday' | 'weekly' | 'custom-raw';

export function localTimestampLabel(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type Day = (typeof DAYS)[number];
const EDITOR_DAYS: readonly Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export type RecurrenceDay = Day;

export interface StructuredRecurrence {
  days: Day[];
  times: string[];
}

const DAY_LABEL: Record<Day, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

const DAY_NUMBER: Record<string, Day> = { '0': 'sun', '7': 'sun', '1': 'mon', '2': 'tue', '3': 'wed', '4': 'thu', '5': 'fri', '6': 'sat' };

interface ScheduleDescription {
  label: string;
  preset: RecurrencePreset;
  /** A raw value is deliberately only exposed by the editor, never a schedule card. */
  raw?: string;
  weeklyDay?: Day;
}

function day(value: string): Day | null {
  const normalized = value.trim().toLowerCase().slice(0, 3);
  return DAY_NUMBER[normalized] ?? (DAYS.includes(normalized as Day) ? normalized as Day : null);
}

function parseDays(field: string, allowWeekdayRange = true): Day[] | null {
  if (field === '*') return [...DAYS];
  if (allowWeekdayRange && field.toLowerCase() === 'mon-fri') return ['mon', 'tue', 'wed', 'thu', 'fri'];
  if (!/^[a-z0-9,]+$/i.test(field)) return null;
  const values = field.split(',').map(day);
  return values.some((value) => value === null) ? null : [...new Set(values as Day[])].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
}

function parseNumbers(field: string, maximum: number): number[] | null {
  if (!/^\d+(?:,\d+)*$/.test(field)) return null;
  const values = field.split(',').map(Number);
  return values.every((value) => value >= 0 && value <= maximum) ? [...new Set(values)].sort((a, b) => a - b) : null;
}

function times(minutes: number[], hours: number[]): string[] | null {
  if (minutes.length > 1 && hours.length > 1) return null;
  return (minutes.length === 1 ? hours.map((hour) => [hour, minutes[0]]) : minutes.map((minute) => [hours[0], minute]))
    .map(([hour, minute]) => formatTime(hour, minute));
}

function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function recurrenceTimeErrors(times: string[]): Map<number, string> {
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
    } else {
      seen.set(time, index);
    }
  });
  return errors;
}

/** Return a structured representation only when cron can name exactly the selected times. */
export function decomposeRecurrence(cron: string | null | undefined): StructuredRecurrence | null {
  const fields = (cron ?? '').trim().split(/\s+/);
  if (fields.length !== 5 || fields[2] !== '*' || fields[3] !== '*') return null;
  const minutes = parseNumbers(fields[0], 59);
  const hours = parseNumbers(fields[1], 23);
  const parsedDays = parseDays(fields[4], false);
  if (!minutes || !hours || !parsedDays || (minutes.length > 1 && hours.length > 1)) return null;
  const selectedDays = EDITOR_DAYS.filter((selected) => parsedDays.includes(selected));
  const selectedTimes = minutes.length === 1
    ? hours.map((hour) => `${String(hour).padStart(2, '0')}:${String(minutes[0]).padStart(2, '0')}`)
    : minutes.map((minute) => `${String(hours[0]).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  return { days: selectedDays, times: selectedTimes };
}

/** Compile only the custom-picker subset to cron. Cross-product time sets are intentionally refused. */
export function compileRecurrence(value: StructuredRecurrence): string | null {
  if (recurrenceTimeErrors(value.times).size > 0) return null;
  const selectedTimes = [...new Set(value.times)].sort((a, b) => a.localeCompare(b));
  const selectedDays = EDITOR_DAYS.filter((selected) => value.days.includes(selected));
  if (selectedTimes.length === 0 || selectedDays.length === 0) return null;
  const hours = [...new Set(selectedTimes.map((time) => time.slice(0, 2)))].sort((a, b) => a.localeCompare(b));
  const minutes = [...new Set(selectedTimes.map((time) => time.slice(3, 5)))].sort((a, b) => a.localeCompare(b));
  if (hours.length > 1 && minutes.length > 1) return null;
  const minuteField = minutes.map(Number).sort((a, b) => a - b).join(',');
  const hourField = hours.map(Number).sort((a, b) => a - b).join(',');
  const dayField = selectedDays.length === EDITOR_DAYS.length ? '*' : selectedDays.join(',');
  return `${minuteField} ${hourField} * * ${dayField}`;
}

function describeCron(schedule: string): ScheduleDescription | null {
  const fields = schedule.split(/\s+/);
  if (fields.length !== 5 || fields[2] !== '*' || fields[3] !== '*') return null;
  const minutes = parseNumbers(fields[0], 59);
  const hours = parseNumbers(fields[1], 23);
  const selectedDays = parseDays(fields[4]);
  if (!minutes || !hours || !selectedDays) return null;
  const scheduledTimes = times(minutes, hours);
  if (!scheduledTimes) return null;
  const everyDay = selectedDays.length === DAYS.length;
  const weekdays = selectedDays.join(',') === 'mon,tue,wed,thu,fri';
  const dayText = everyDay ? 'Daily' : weekdays ? 'Every weekday (Mon–Fri)' : selectedDays.map((value) => DAY_LABEL[value]).join(', ');
  const label = everyDay && scheduledTimes.length === 1 ? 'Daily' : `${dayText} · ${scheduledTimes.join(', ')}`;
  const preset: RecurrencePreset = everyDay ? 'daily' : weekdays ? 'weekday' : selectedDays.length === 1 ? 'weekly' : 'custom-raw';
  return { label, preset, ...(selectedDays.length === 1 ? { weeklyDay: selectedDays[0] } : {}) };
}

/** Translate legacy words and the supported cron subset to a short card label and editor preset. */
export function describeSchedule(schedule: string | null | undefined): ScheduleDescription {
  const raw = (schedule ?? '').trim();
  if (raw.toLowerCase() === 'daily') return { label: 'Daily', preset: 'daily' };
  const weekly = /^weekly:([a-z0-9]+)$/i.exec(raw);
  const weeklyDay = weekly ? day(weekly[1]) : null;
  if (weeklyDay) return { label: `Weekly on ${DAY_LABEL[weeklyDay]}`, preset: 'weekly', weeklyDay };
  const cron = describeCron(raw);
  if (cron) return cron;
  return { label: raw === '' ? 'No schedule declared' : 'Custom schedule', preset: 'custom-raw', ...(raw ? { raw } : {}) };
}

/** Canonical declarations emitted after the operator explicitly selects a preset. */
export function presetSchedule(preset: Exclude<RecurrencePreset, 'custom-raw'>, weeklyDay: Day = 'mon'): string {
  if (preset === 'daily') return 'daily';
  if (preset === 'weekday') return '0 9 * * mon-fri';
  return `0 9 * * ${weeklyDay}`;
}

const EASTERN_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
});

interface EasternParts { minute: number; hour: number; day: number; month: number; weekday: Day }

function easternParts(value: Date): EasternParts {
  const parts = Object.fromEntries(EASTERN_PARTS.formatToParts(value).map((part) => [part.type, part.value]));
  return {
    minute: Number(parts.minute), hour: Number(parts.hour), day: Number(parts.day), month: Number(parts.month),
    weekday: parts.weekday.toLowerCase().slice(0, 3) as Day,
  };
}

function cronAtom(value: string, maximum: number, names?: Record<string, number>): number | null {
  const normalized = value.toLowerCase();
  const parsed = names?.[normalized] ?? (/^\d+$/.test(normalized) ? Number(normalized) : Number.NaN);
  return Number.isInteger(parsed) && parsed >= (maximum === 31 || maximum === 12 ? 1 : 0) && parsed <= maximum ? parsed : null;
}

function cronFieldMatches(field: string, current: number, maximum: number, names?: Record<string, number>): boolean {
  const minimum = maximum === 31 || maximum === 12 ? 1 : 0;
  for (const item of field.split(',')) {
    const [range, stepText, ...extra] = item.split('/');
    if (extra.length > 0 || (stepText !== undefined && (!/^\d+$/.test(stepText) || Number(stepText) < 1))) return false;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (range === '*') {
      if ((current - minimum) % step === 0) return true;
      continue;
    }
    const bounds = range.split('-');
    if (bounds.length > 2) return false;
    const start = cronAtom(bounds[0], maximum, names);
    const end = bounds.length === 2 ? cronAtom(bounds[1], maximum, names) : start;
    if (start === null || end === null || end < start) return false;
    for (let candidate = start; candidate <= end; candidate += step) {
      if ((maximum === 7 && candidate === 7 ? 0 : candidate) === current) return true;
    }
  }
  return false;
}

function cronMatches(fields: string[], value: Date): boolean {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const parts = easternParts(value);
  const dayNames = Object.fromEntries(DAYS.map((day, index) => [day, index])) as Record<string, number>;
  const cronWeekday = DAYS.indexOf(parts.weekday);
  const domHit = cronFieldMatches(dayOfMonth, parts.day, 31);
  const dowHit = cronFieldMatches(dayOfWeek, cronWeekday, 7, dayNames);
  const dayHit = dayOfMonth.startsWith('*') || dayOfWeek.startsWith('*') ? domHit && dowHit : domHit || dowHit;
  return cronFieldMatches(minute, parts.minute, 59)
    && cronFieldMatches(hour, parts.hour, 23)
    && cronFieldMatches(month, parts.month, 12)
    && dayHit;
}

/**
 * Finds the next representable declaration locally for display. This must never be used to dispatch:
 * scripts/dispatch.py remains the only clock.
 */
export function nextScheduleWindow(schedule: string | null | undefined, now: Date = new Date()): Date | null {
  const raw = (schedule ?? '').trim().toLowerCase();
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  if (raw === 'daily') return start;
  const weekly = /^weekly:([a-z0-9]+)$/.exec(raw);
  const weeklyDay = weekly ? day(weekly[1]) : null;
  if (weeklyDay) {
    const initial = easternParts(start);
    for (let offset = 0; offset <= 8 * 24 * 60; offset += 1) {
      const candidate = new Date(start.getTime() + offset * 60_000);
      const parts = easternParts(candidate);
      if (parts.weekday === weeklyDay && parts.hour === initial.hour && parts.minute === initial.minute) return candidate;
    }
    return null;
  }
  const fields = raw.split(/\s+/);
  if (fields.length !== 5) return null;
  for (let offset = 0; offset <= 370 * 24 * 60; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 60_000);
    if (cronMatches(fields, candidate)) return candidate;
  }
  return null;
}

export function relativeScheduleWindow(next: Date | null, now: Date = new Date()): string {
  if (!next) return 'not computed';
  const minutes = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 48) return rest === 0 ? `in ${Math.floor(hours / 24)}d` : `in ${Math.floor(hours / 24)}d ${rest}m`;
  return rest === 0 ? `in ${hours}h` : `in ${hours}h ${rest}m`;
}
