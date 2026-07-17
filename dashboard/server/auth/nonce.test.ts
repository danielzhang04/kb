import { expect, it } from 'vitest';
import { consumeNonce, issueNonce } from './nonce';

it('a nonce is single-use; second consume fails', () => {
  const n = issueNonce();
  expect(consumeNonce(n)).toBe(true);
  expect(consumeNonce(n)).toBe(false);
});

it('an unknown nonce is rejected (fail closed)', () => {
  expect(consumeNonce('never-issued')).toBe(false);
});

it('an expired nonce is rejected even before it is ever consumed', () => {
  const now = Date.now();
  const n = issueNonce(1000, now);
  expect(consumeNonce(n, now + 1001)).toBe(false);
});

it('issued nonces are unique across calls', () => {
  const seen = new Set(Array.from({ length: 50 }, () => issueNonce()));
  expect(seen.size).toBe(50);
});
