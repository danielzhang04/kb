import assert from 'node:assert/strict';
import test from 'node:test';

import {pullScale} from './camera.ts';

const closeTo = (actual, expected) => assert.ok(
  Math.abs(actual - expected) < 1e-12,
  {actual, expected},
);

test('pull intensity scales both endpoints toward a locked camera', () => {
  const pullFrom = 1.18;
  closeTo(pullScale(0, pullFrom, 1), 1.18);
  closeTo(pullScale(0, pullFrom, 0.5), 1.09);
  closeTo(pullScale(1, pullFrom, 1), 1.045);
  closeTo(pullScale(1, pullFrom, 0.5), 1.0225);
});

test('half-strength pull stays weaker throughout the arc', () => {
  const full = pullScale(0.5, 1.18, 1);
  const half = pullScale(0.5, 1.18, 0.5);
  assert.ok(Math.abs(half - 1) < Math.abs(full - 1), {full, half});
});
