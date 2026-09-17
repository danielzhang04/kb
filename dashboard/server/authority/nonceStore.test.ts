import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNonceStore } from './nonceStore.ts';

const hex = (n: number) => n.toString(16).padStart(32, '0');

describe('nonce store', () => {
  it('claims a fresh nonce once and refuses the replay', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-nonce-'));
    const now = 1_000_000;
    const store = createNonceStore(root, () => now);
    expect(store.claim(hex(1), now + 60_000)).toBe('fresh');
    expect(store.claim(hex(1), now + 60_000)).toBe('replayed');
  });

  it('forgets a nonce after its expiry', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-nonce-'));
    let now = 1_000_000;
    const store = createNonceStore(root, () => now);
    expect(store.claim(hex(2), now + 60_000)).toBe('fresh');
    now += 60_001;
    expect(store.claim(hex(2), now + 60_000)).toBe('fresh');
  });

  it('survives a restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-nonce-'));
    const now = 1_000_000;
    expect(createNonceStore(root, () => now).claim(hex(3), now + 60_000)).toBe('fresh');
    expect(createNonceStore(root, () => now).claim(hex(3), now + 60_000)).toBe('replayed');
  });

  it('refuses rather than evicting above the cap', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-nonce-'));
    const now = 1_000_000;
    const store = createNonceStore(root, () => now);
    for (let i = 0; i < 10_000; i += 1) expect(store.claim(hex(1000 + i), now + 900_000)).toBe('fresh');
    expect(store.claim(hex(999_999), now + 900_000)).toBe('unavailable');
  }, 60_000); // 10,000 durable (fsync-adjacent) writes; append-only, but still real per-call disk I/O.

  it('reports unavailable when the state root cannot be written', () => {
    const store = createNonceStore(join(tmpdir(), 'kb-nonce-missing', '\0bad'), () => 1);
    expect(store.claim(hex(4), 60_000)).toBe('unavailable');
  });
});
