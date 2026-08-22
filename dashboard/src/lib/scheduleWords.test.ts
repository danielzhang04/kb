import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { describeSchedule, localTimestampLabel, nextScheduleWindow, presetSchedule, relativeScheduleWindow } from './scheduleWords';

interface ClockVector {
  id: string;
  cron: string;
  now: string;
  latest: string | null;
  next: string;
  labelInput?: string;
  label?: string;
}
const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../tests/fixtures/schedule-clock-vectors.json'), 'utf8')) as ClockVector[];

describe('scheduleWords', () => {
  it.each([
    ['daily', 'Daily', 'daily'],
    ['weekly:sat', 'Weekly on Sat', 'weekly'],
    ['0 9,17 * * mon-fri', 'Every weekday (Mon–Fri) · 9:00 AM, 5:00 PM', 'weekday'],
    ['3 7 * * mon,thu', 'Mon, Thu · 7:03 AM', 'custom-raw'],
  ])('describes %s without exposing raw cron', (schedule, label, preset) => {
    expect(describeSchedule(schedule)).toMatchObject({ label, preset });
  });

  it('uses the safe fallback for unrepresentable schedules', () => {
    expect(describeSchedule('*/5 * * * *')).toEqual({ label: 'Custom schedule', preset: 'custom-raw', raw: '*/5 * * * *' });
  });

  it('maps explicit preset changes to declarations', () => {
    expect(presetSchedule('daily')).toBe('daily');
    expect(presetSchedule('weekday')).toBe('0 9 * * mon-fri');
    expect(presetSchedule('weekly', 'sat')).toBe('0 9 * * sat');
  });

  it('formats valid timestamps explicitly in America/New_York with no suffix', () => {
    const vector = vectors.find((candidate) => candidate.labelInput);
    if (!vector?.labelInput || !vector.label) throw new Error('missing Eastern label vector');
    const formatter = vi.spyOn(Date.prototype, 'toLocaleString');
    expect(localTimestampLabel(vector.labelInput)).toBe(vector.label);
    expect(formatter).toHaveBeenCalledWith('en-US', expect.objectContaining({ timeZone: 'America/New_York' }));
    expect(vector.label).not.toMatch(/\b(?:EST|EDT|Eastern)\b/);
    expect(localTimestampLabel('not-a-time')).toBe('not-a-time');
  });

  it('calculates a display-only next window for word and cron schedules', () => {
    const now = new Date('2026-08-19T08:58:20-04:00');
    expect(relativeScheduleWindow(nextScheduleWindow('0 9 * * mon-fri', now), now)).toBe('in 2m');
    expect(relativeScheduleWindow(nextScheduleWindow('*/5 * * * *', now), now)).toBe('in 2m');
    expect(relativeScheduleWindow(nextScheduleWindow('weekly:sat', now), now)).toBe('in 3d 1m');
  });

  it.each(vectors)('matches shared Eastern clock vector $id', (vector) => {
    expect(nextScheduleWindow(vector.cron, new Date(vector.now))?.toISOString()).toBe(vector.next);
  });
});
