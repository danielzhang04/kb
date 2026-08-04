import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FYT_LOCKED_TTS_COST_USD_MICROS,
  FYT_THIN_SLICE_TTS_MAX_CHARACTERS,
} from './paidActionService.ts';
import { SpendGrantError, createSpendGrantStore, type SpendGrantMintInput } from './spendGrant.ts';

const roots: string[] = [];
const HOUR = 60 * 60 * 1_000;
const IMAGE_OP = 'fyt.gemini-3-pro-image-2k' as const;
const AUDIO_OP = 'fyt.elevenlabs.locked-tts' as const;

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'spend-grants-'));
  roots.push(root);
  return root;
}

function journalPath(root: string): string {
  return join(root, 'control', 'spend-grants.json');
}

function readJournal(root: string): { schema: string; revision: number; grants: Record<string, unknown>[] } {
  return JSON.parse(readFileSync(journalPath(root), 'utf8'));
}

function writeJournal(root: string, journal: unknown): void {
  writeFileSync(journalPath(root), `${JSON.stringify(journal)}\n`, 'utf8');
}

function mintInput(overrides: Partial<SpendGrantMintInput> = {}): SpendGrantMintInput {
  return {
    runRef: 'run-1',
    stageRef: 'stage-images-1',
    operation: IMAGE_OP,
    subject: 'daniel',
    gateRequestRef: 'human-req-abc',
    ttlMs: 2 * HOUR,
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('SpendGrantStore', () => {
  it('mints an opaque token exactly once and resolves it back to the grant', async () => {
    const root = temporaryRoot();
    const store = createSpendGrantStore({ stateRoot: root, now: () => new Date('2026-08-03T12:00:00.000Z') });

    const { grantRef, token } = await store.mint(mintInput());
    expect(grantRef).toMatch(/^grant-[a-f0-9]{32}$/);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThanOrEqual(32);

    const resolved = store.resolve(token);
    expect(resolved).toMatchObject({
      grantRef,
      runRef: 'run-1',
      stageRef: 'stage-images-1',
      operation: IMAGE_OP,
      subject: 'daniel',
      gateRequestRef: 'human-req-abc',
    });
    // The raw token is never on disk; only its sha256 hash is stored.
    const raw = readFileSync(journalPath(root), 'utf8');
    expect(raw).not.toContain(token);
    expect((readJournal(root).grants[0] as { tokenHash: string }).tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('copies caps from the frozen definitions, never from the caller', async () => {
    const root = temporaryRoot();
    const store = createSpendGrantStore({ stateRoot: root });

    const image = await store.mint(mintInput());
    expect(store.resolve(image.token)).toMatchObject({
      maxCalls: 11, maxCostUsdMicros: 1_400_000, maxCharacters: 0, maxOutputs: 8,
    });

    const audio = await store.mint(mintInput({ stageRef: 'stage-audio-1', operation: AUDIO_OP }));
    expect(store.resolve(audio.token)).toMatchObject({
      maxCalls: 1,
      maxCostUsdMicros: FYT_LOCKED_TTS_COST_USD_MICROS,
      maxCharacters: FYT_THIN_SLICE_TTS_MAX_CHARACTERS,
      maxOutputs: 1,
    });
  });

  it('returns null for an unknown or tampered token', async () => {
    const root = temporaryRoot();
    const store = createSpendGrantStore({ stateRoot: root });
    const { token } = await store.mint(mintInput());

    expect(store.resolve(`${token}x`)).toBeNull();
    const flipped = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(store.resolve(flipped)).toBeNull();
    expect(store.resolve('not-a-real-token')).toBeNull();
    expect(store.resolve('')).toBeNull();
  });

  it('refuses a resolved grant once it has expired', async () => {
    const root = temporaryRoot();
    const minted = new Date('2026-08-03T12:00:00.000Z');
    const store = createSpendGrantStore({ stateRoot: root, now: () => minted });
    const { token } = await store.mint(mintInput({ ttlMs: 2 * HOUR }));

    expect(store.resolve(token, new Date(minted.getTime() + HOUR))).not.toBeNull();
    expect(store.resolve(token, new Date(minted.getTime() + 2 * HOUR))).toBeNull();
    expect(store.resolve(token, new Date(minted.getTime() + 3 * HOUR))).toBeNull();
  });

  it('enforces one live grant per (runRef, stageRef, operation) and re-mints after expiry', async () => {
    const root = temporaryRoot();
    let clock = new Date('2026-08-03T12:00:00.000Z');
    const store = createSpendGrantStore({ stateRoot: root, now: () => clock });

    const first = await store.mint(mintInput({ ttlMs: 2 * HOUR }));

    // A second live mint for the same tuple is refused, and the error names the existing grant.
    await expect(store.mint(mintInput({ ttlMs: 2 * HOUR }))).rejects.toMatchObject({
      code: 'grant-already-live',
      grantRef: first.grantRef,
    });

    // A different stage (or operation) is a different tuple and mints fine.
    const other = await store.mint(mintInput({ stageRef: 'stage-audio-1', operation: AUDIO_OP }));
    expect(other.grantRef).not.toBe(first.grantRef);

    // Once the first grant has expired, the tuple is free again and yields a fresh token.
    clock = new Date('2026-08-03T15:00:00.000Z');
    const reminted = await store.mint(mintInput({ ttlMs: 2 * HOUR }));
    expect(reminted.grantRef).not.toBe(first.grantRef);
    expect(reminted.token).not.toBe(first.token);
    expect(store.resolve(reminted.token)).not.toBeNull();
  });

  it('rejects invalid mint input before touching the journal', async () => {
    const root = temporaryRoot();
    const store = createSpendGrantStore({ stateRoot: root });

    await expect(store.mint(mintInput({ runRef: '../escape' }))).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(store.mint(mintInput({ operation: 'fyt.unknown' as never }))).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(store.mint(mintInput({ ttlMs: 10 }))).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(store.mint(mintInput({ ttlMs: 24 * HOUR }))).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('snapshot strips the token hash', async () => {
    const root = temporaryRoot();
    const store = createSpendGrantStore({ stateRoot: root });
    const { grantRef } = await store.mint(mintInput());

    const snapshot = store.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ grantRef, operation: IMAGE_OP });
    expect('tokenHash' in snapshot[0]).toBe(false);
  });

  it('fails closed when the durable file shape is tampered', async () => {
    const root = temporaryRoot();
    await createSpendGrantStore({ stateRoot: root }).mint(mintInput());

    const journal = readJournal(root);
    (journal.grants[0] as { grantRef: string }).grantRef = 'not-a-grant-ref';
    writeJournal(root, journal);

    const reopened = createSpendGrantStore({ stateRoot: root });
    expect(() => reopened.snapshot()).toThrow(SpendGrantError);
    expect(() => reopened.resolve('anything')).toThrow(SpendGrantError);
  });

  it('fails closed when a stored cap is inflated past the frozen policy', async () => {
    const root = temporaryRoot();
    const { token } = await createSpendGrantStore({ stateRoot: root }).mint(mintInput());

    const journal = readJournal(root);
    (journal.grants[0] as { maxCostUsdMicros: number }).maxCostUsdMicros = 9_999_999;
    writeJournal(root, journal);

    const reopened = createSpendGrantStore({ stateRoot: root });
    expect(() => reopened.resolve(token)).toThrow(/caps differ from the frozen policy/);
  });
});
