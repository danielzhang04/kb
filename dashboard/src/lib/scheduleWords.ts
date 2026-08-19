/**
 * Human words for schedule declarations. This is a display/editor aid only:
 * scripts/dispatch.py remains the scheduler and source of truth for every fire.
 */

export type RecurrencePreset = 'daily' | 'weekday' | 'weekly' | 'custom-raw';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type Day = (typeof DAYS)[number];

const DAY_LABEL: Record<Day, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

const DAY_NUMBER: Record<string, Day> = { '0': 'sun', '7': 'sun', '1': 'mon', '2': 'tue', '3': 'wed', '4': 'thu', '5': 'fri', '6': 'sat' };

export interface ScheduleDescription {
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

function parseDays(field: string): Day[] | null {
  if (field === '*') return [...DAYS];
  if (field.toLowerCase() === 'mon-fri') return ['mon', 'tue', 'wed', 'thu', 'fri'];
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

function cronMatches(fields: string[], value: Date): boolean {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== '*' || month !== '*') return false;
  const matchNumber = (field: string, current: number, maximum: number): boolean => {
    if (field === '*') return true;
    const interval = /^\*\/(\d+)$/.exec(field);
    if (interval) return current % Number(interval[1]) === 0;
    return parseNumbers(field, maximum)?.includes(current) ?? false;
  };
  const weekday = DAYS[value.getDay()];
  return matchNumber(minute, value.getMinutes(), 59) && matchNumber(hour, value.getHours(), 23) && (parseDays(dayOfWeek)?.includes(weekday) ?? false);
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
    while (DAYS[start.getDay()] !== weeklyDay) start.setDate(start.getDate() + 1);
    return start;
  }
  const fields = raw.split(/\s+/);
  if (fields.length !== 5) return null;
  for (let offset = 0; offset <= 14 * 24 * 60; offset += 1) {
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
