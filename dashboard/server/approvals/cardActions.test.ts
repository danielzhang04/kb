import { describe, expect, it } from 'vitest';
import { HUMAN_INPUT_ACTION, WAKE_ACTION } from './cardActions.ts';

describe('card actions', () => {
  it('classifies human input and wake actions identically', () => {
    for (const value of ['needs-input:choice', 'human-review', 'question/source']) {
      expect(HUMAN_INPUT_ACTION.test(value), value).toBe(true);
    }
    expect(HUMAN_INPUT_ACTION.test('build:site')).toBe(false);
    expect(WAKE_ACTION.test('wake-me:runner-failed')).toBe(true);
    expect(WAKE_ACTION.test('wake-me')).toBe(true);
    expect(WAKE_ACTION.test('not-wake-me')).toBe(false);
  });
});
