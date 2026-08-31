// Dashboard v3 P5 W4 — release reader tests (§3.5). Fed only by the injected activation port; never a
// filesystem or checkout read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROBE_BUDGETS_MS } from './probeBudget.ts';
import { readReleaseRow, type ReleaseActivationPort } from './releaseReader.ts';

const NOW = '2026-08-25T00:00:00.000Z';
const now = () => NOW;
const SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);

function readyPort(): ReleaseActivationPort {
  return {
    readActivation: () => Promise.resolve({
      revision: 'release:1', label: 'kb-dashboard', sha: SHA, activatedAt: '2026-08-24T00:00:00.000Z',
      archiveSha256: DIGEST, rollbackAvailable: true,
    }),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('readReleaseRow', () => {
  it('reads the ReleaseRow from the injected activation port and nothing else', async () => {
    const row = await readReleaseRow(readyPort(), now);
    expect(row).toEqual({
      kind: 'release', key: 'release', label: 'Release',
      value: { sha: SHA, archiveSha256: DIGEST, activatedAt: '2026-08-24T00:00:00.000Z', rollbackAvailable: true },
      observedAt: NOW, source: 'release',
    });
  });

  it('never reads a filesystem path: the port is the only input surface', async () => {
    let called = false;
    const port: ReleaseActivationPort = {
      readActivation: () => { called = true; return readyPort().readActivation(); },
    };
    await readReleaseRow(port, now);
    expect(called).toBe(true);
    // The port function takes no arguments — there is no path/handle to pass.
    expect(port.readActivation.length).toBe(0);
  });

  it('a hung activation read degrades the release row alone with reason "timeout", never rejecting', async () => {
    const pending = readReleaseRow({ readActivation: () => new Promise(() => {}) }, now);
    await vi.advanceTimersByTimeAsync(PROBE_BUDGETS_MS.release);
    await expect(pending).resolves.toEqual({
      kind: 'unavailable', key: 'error:daemon-machine', label: 'Unavailable',
      value: { status: 'unavailable', reason: 'timeout' }, observedAt: NOW, source: 'error',
    });
  });

  it('a throwing activation read degrades to reason "unavailable" without leaking the error text', async () => {
    const row = await readReleaseRow(
      { readActivation: () => Promise.reject(new Error('stderr: release manifest denied at /opt/kb-releases')) },
      now,
    );
    expect(row).toEqual({
      kind: 'unavailable', key: 'error:daemon-machine', label: 'Unavailable',
      value: { status: 'unavailable', reason: 'unavailable' }, observedAt: NOW, source: 'error',
    });
    expect(JSON.stringify(row)).not.toContain('kb-releases');
  });

  it('a malformed sha or digest degrades to reason "invalid"', async () => {
    const badSha = await readReleaseRow(
      { readActivation: () => Promise.resolve({ revision: 'r', label: 'l', sha: 'not-a-sha', activatedAt: 'x', archiveSha256: DIGEST, rollbackAvailable: false }) },
      now,
    );
    expect(badSha.kind).toBe('unavailable');
    expect((badSha as { value: { reason: string } }).value.reason).toBe('invalid');

    const badDigest = await readReleaseRow(
      { readActivation: () => Promise.resolve({ revision: 'r', label: 'l', sha: SHA, activatedAt: 'x', archiveSha256: 'nope', rollbackAvailable: false }) },
      now,
    );
    expect(badDigest.kind).toBe('unavailable');
    expect((badDigest as { value: { reason: string } }).value.reason).toBe('invalid');
  });

  it('the ReleaseRow carries no spend field', async () => {
    const row = await readReleaseRow(readyPort(), now);
    expect(Object.keys((row as { value: object }).value)).not.toContain('spend');
  });
});
