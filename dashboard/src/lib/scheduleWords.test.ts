import { describe, expect, it } from 'vitest';
import { describeSchedule, localTimestampLabel, nextScheduleWindow, presetSchedule, relativeScheduleWindow } from './scheduleWords';

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

  it('formats valid local timestamps and preserves invalid input', () => {
    const iso = '2026-08-19T13:24:00.000Z';
    expect(localTimestampLabel(iso)).toBe(new Date(iso).toLocaleString());
    expect(localTimestampLabel('not-a-time')).toBe('not-a-time');
  });

  it('calculates a display-only next window for word and cron schedules', () => {
    const now = new Date(2026, 7, 19, 8, 58, 20);
    expect(relativeScheduleWindow(nextScheduleWindow('0 9 * * mon-fri', now), now)).toBe('in 2m');
    expect(relativeScheduleWindow(nextScheduleWindow('*/5 * * * *', now), now)).toBe('in 2m');
    expect(relativeScheduleWindow(nextScheduleWindow('weekly:sat', now), now)).toBe('in 3d 1m');
  });
});
