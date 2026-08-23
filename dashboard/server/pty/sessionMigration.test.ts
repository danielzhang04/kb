import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { migratePtySessionDocument, PtySessionMigrationError } from './sessionMigration.ts';
import {
  PTY_SESSIONS_V1_DOCUMENT,
  PTY_SESSIONS_V1_ENDED_RUN,
  PTY_SESSIONS_V1_LIVE_RUN,
  PTY_SESSIONS_V1_RELATIVE_PATH,
} from './__fixtures__/ptySessionsV1.ts';

const roots: string[] = [];
const NOW = '2026-08-23T12:00:00.000Z';

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'kb-pty-migration-'));
  roots.push(value);
  return value;
}

/**
 * A literal `kb.pty-session-runs/v1` document — one live row, one ended row with a transcript, one
 * archived row plus its idempotency key. It is written by hand because the session-run store no longer
 * produces v1: since W6.3 it writes the `legacyRuns` array of the v2 document this migration creates, so
 * the only honest source of a v1 fixture is the on-disk shape itself.
 */
async function writeV1Fixture(stateRoot: string) {
  const live = PTY_SESSIONS_V1_LIVE_RUN;
  const ended = PTY_SESSIONS_V1_ENDED_RUN;
  const path = join(stateRoot, ...PTY_SESSIONS_V1_RELATIVE_PATH);
  mkdirSync(join(stateRoot, 'pty'), { recursive: true });
  writeFileSync(path, JSON.stringify(PTY_SESSIONS_V1_DOCUMENT));
  const original = readFileSync(path);
  const source = JSON.parse(original.toString('utf8')) as { runs: Array<Record<string, unknown>>;
    archiveKeys: Array<Record<string, unknown>> };
  return { path, original, source, live, ended };
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('v1 PTY document migration', () => {
  it('false-persistence prevention', async () => {
    const stateRoot = root();
    const { path, original, source, live, ended } = await writeV1Fixture(stateRoot);

    await expect(migratePtySessionDocument(path, { now: () => NOW })).resolves.toMatchObject({
      migrated: true,
      replayed: false,
    });
    expect(readFileSync(`${path}.v1.bak`)).toEqual(original);
    const migrated = JSON.parse(readFileSync(path, 'utf8'));
    expect(migrated).toMatchObject({
      schema: 'kb.pty-sessions/v2',
      revision: 0,
      sessions: [],
      attemptBindings: [],
      operationReceipts: [],
      legacyArchiveKeys: source.archiveKeys,
    });
    // v1 carries no attempt-operation state, so v2 starts with an exactly empty map — never a
    // missing key (the strict validator refuses that) and never an array.
    expect(migrated.attemptOperations).toEqual({});
    expect(Array.isArray(migrated.attemptOperations)).toBe(false);
    expect(Object.keys(migrated).sort()).toEqual(['attemptBindings', 'attemptOperations', 'legacyArchiveKeys',
      'legacyRuns', 'operationReceipts', 'revision', 'schema', 'sessions']);
    expect(migrated.legacyRuns.find((row: { sessionRunRef: string }) => row.sessionRunRef === live.sessionRunRef)).toEqual({
      ...live,
      outcome: 'abandoned',
      endedAt: NOW,
      version: live.version + 1,
    });
    expect(migrated.legacyRuns.find((row: { sessionRunRef: string }) => row.sessionRunRef === ended?.sessionRunRef))
      .toEqual(ended);
    expect(migrated.legacyRuns.find((row: { outcome: string }) => row.outcome === 'archived'))
      .toEqual(source.runs.find((row) => row.outcome === 'archived'));
    await expect(migratePtySessionDocument(path, { now: () => NOW })).resolves.toMatchObject({
      migrated: false,
      replayed: true,
    });
  });

  it.each(['directory', 'mutex', 'source-read', 'backup', 'fsync-backup', 'write-temp',
    'fsync-temp', 'validation', 'rename', 'fsync-parent'] as const)(
    'leaves the v1 input byte-identical when operation stage %s fails',
    async (failAt) => {
      const stateRoot = root();
      const { path, original } = await writeV1Fixture(stateRoot);
      await expect(migratePtySessionDocument(path, { now: () => NOW, failAt })).rejects.toBeInstanceOf(PtySessionMigrationError);
      expect(readFileSync(path)).toEqual(original);
    },
  );

  it('normalizes a partial temp write and leaves the real v1 source byte-identical', async () => {
    const stateRoot = root();
    const { path, original } = await writeV1Fixture(stateRoot);
    const writeFile = (target: string, data: string | NodeJS.ArrayBufferView, options?: object) => {
      if (target.endsWith('.tmp')) {
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
        writeFileSync(target, bytes.subarray(0, 7), options);
        throw new Error('partial write');
      }
      writeFileSync(target, data, options);
    };
    const remove = () => { throw new Error('cleanup denied'); };
    let caught: PtySessionMigrationError | null = null;
    try {
      await migratePtySessionDocument(path, { now: () => NOW, fs: { writeFile, remove } });
    } catch (error) {
      caught = error as PtySessionMigrationError;
    }
    expect(caught).toMatchObject({ code: 'pty-session-migration-required' });
    expect(caught?.report).toContain('cleanup: failed');
    expect(readFileSync(path)).toEqual(original);
  });

  it('recovers from a crash after backup and completes on re-run', async () => {
    const stateRoot = root();
    const { path, original } = await writeV1Fixture(stateRoot);
    await expect(migratePtySessionDocument(path, { now: () => NOW,
      afterBackup: () => { throw new Error('simulated crash'); } })).rejects.toMatchObject({
      code: 'pty-session-migration-required',
    });
    expect(readFileSync(path)).toEqual(original);
    expect(readFileSync(`${path}.v1.bak`)).toEqual(original);
    await expect(migratePtySessionDocument(path, { now: () => NOW })).resolves.toMatchObject({ migrated: true });
  });

  it('reports restore failure and preserves the byte-exact backup', async () => {
    const stateRoot = root();
    const { path, original } = await writeV1Fixture(stateRoot);
    const rename = (source: string, destination: string) => {
      if (source.endsWith('.restore')) throw new Error('restore denied');
      renameSync(source, destination);
    };
    let caught: PtySessionMigrationError | null = null;
    try {
      await migratePtySessionDocument(path, { now: () => NOW,
        afterPublish: () => { throw new Error('post-publish crash'); }, fs: { rename } });
    } catch (error) {
      caught = error as PtySessionMigrationError;
    }
    expect(caught).toMatchObject({ code: 'pty-session-migration-required' });
    expect(caught?.report).toContain('restore: failed');
    expect(readFileSync(`${path}.v1.bak`)).toEqual(original);
  });

  it('aborts malformed, duplicate, and pre-existing-backup ambiguity with a bounded named report', async () => {
    const stateRoot = root();
    const fixture = await writeV1Fixture(stateRoot);
    const path = fixture.path;
    const duplicate = structuredClone(fixture.source);
    duplicate.runs.push({ ...duplicate.runs[0] });
    const original = JSON.stringify({ schema: 'kb.pty-session-runs/v1', ...duplicate });
    writeFileSync(path, original);
    writeFileSync(`${path}.v1.bak`, 'ambiguous');

    await expect(migratePtySessionDocument(path, { now: () => NOW })).rejects.toMatchObject({
      code: 'pty-session-migration-required',
    });
    try {
      await migratePtySessionDocument(path, { now: () => NOW });
    } catch (error) {
      expect((error as PtySessionMigrationError).report.length).toBeLessThanOrEqual(20);
    }
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  it.each([['malformed', '{'], ['oversize', 'x'.repeat(4_000_001)]])(
    'refuses %s v1 input without changing one byte', async (_case, original) => {
    const stateRoot = root();
    const path = join(stateRoot, 'session-runs.json');
    writeFileSync(path, original);
    await expect(migratePtySessionDocument(path, { now: () => NOW })).rejects.toMatchObject({
      code: 'pty-session-migration-required',
    });
    expect(readFileSync(path, 'utf8')).toBe(original);
  });
});
