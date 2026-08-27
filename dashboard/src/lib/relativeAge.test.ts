import { describe, expect, it } from 'vitest';
import { recencyLabel, relativeAge } from './relativeAge.ts';

describe('relativeAge', () => {
  const now = Date.parse('2026-08-27T12:00:00.000Z');

  it('uses compact row labels across minute, hour, and day boundaries', () => {
    expect(relativeAge('2026-08-27T11:57:00.000Z', now)).toBe('3m');
    expect(relativeAge('2026-08-27T09:00:00.000Z', now)).toBe('3h');
    expect(relativeAge('2026-08-24T12:00:00.000Z', now)).toBe('3d');
    expect(recencyLabel('Arrived', '2026-08-24T12:00:00.000Z', now)).toBe('Arrived 3d ago');
  });

  it('fails soft for optional legacy timestamps', () => {
    expect(recencyLabel('Updated', undefined, now)).toBe('Updated recently');
  });
});
