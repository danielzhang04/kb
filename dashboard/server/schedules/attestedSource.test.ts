import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openAttestedScheduleSource } from './attestedSource.ts';

function fixture(): { root: string; current: string } {
  const root = mkdtempSync(join(tmpdir(), 'schedule-release-'));
  const release = join(root, 'releases', 'r1');
  mkdirSync(join(release, 'orgs', 'kb-ops'), { recursive: true });
  writeFileSync(join(release, 'VERSION'), 'a'.repeat(40) + '\n');
  writeFileSync(join(release, 'attestation.json'), JSON.stringify({ workflow: 'kb-platform-release', sourceCommit: 'a'.repeat(40), sha256: 'b'.repeat(64) }));
  writeFileSync(join(release, 'HEARTBEAT.md'), 'root-bytes');
  writeFileSync(join(release, 'orgs', 'kb-ops', 'HEARTBEAT.md'), 'org-bytes');
  const current = join(root, 'current');
  symlinkSync(release, current, 'junction');
  return { root, current };
}

describe('openAttestedScheduleSource', () => {
  it('reads only confined bytes from a VERSION-matched installed release', async () => {
    const fx = fixture();
    const source = await openAttestedScheduleSource({ currentPath: fx.current });
    expect(source).toMatchObject({ available: true, sourceCommit: 'a'.repeat(40), archiveSha256: 'b'.repeat(64) });
    if (!source.available) throw new Error('expected attested source');
    expect(await source.read('HEARTBEAT.md')).toBe('root-bytes');
    expect(await source.read('orgs/kb-ops/HEARTBEAT.md')).toBe('org-bytes');
    const readUntrusted = source.read as (path: string) => Promise<string>;
    await expect(readUntrusted('../VERSION')).rejects.toMatchObject({ code: 'attested-source-path-refused' });
    await expect(readUntrusted('orgs/kb-ops/../../VERSION')).rejects.toMatchObject({ code: 'attested-source-path-refused' });
  });

  it('fails closed for missing, mismatched, or malformed release identity', async () => {
    expect(await openAttestedScheduleSource({ currentPath: join(tmpdir(), 'absent-kb-release') })).toMatchObject({ available: false, reason: 'release-unavailable' });
    const fx = fixture();
    const release = join(fx.root, 'releases', 'r1');
    writeFileSync(join(release, 'VERSION'), 'c'.repeat(40) + '\n');
    expect(await openAttestedScheduleSource({ currentPath: fx.current })).toMatchObject({ available: false, reason: 'release-attestation-mismatch' });
    writeFileSync(join(release, 'attestation.json'), JSON.stringify({ workflow: 'wrong', sourceCommit: 'c'.repeat(40), sha256: 'b'.repeat(64) }));
    expect(await openAttestedScheduleSource({ currentPath: fx.current })).toMatchObject({ available: false, reason: 'release-attestation-invalid' });

    writeFileSync(join(release, 'VERSION'), 'd'.repeat(41) + '\n');
    writeFileSync(join(release, 'attestation.json'), JSON.stringify({ workflow: 'kb-platform-release', sourceCommit: 'd'.repeat(41), sha256: 'b'.repeat(64) }));
    expect(await openAttestedScheduleSource({ currentPath: fx.current })).toMatchObject({ available: false, reason: 'release-attestation-invalid' });
  });

  it.each(['VERSION', 'attestation.json'] as const)('refuses a symlink-escaping %s sidecar', async (sidecar) => {
    const fx = fixture();
    const release = join(fx.root, 'releases', 'r1');
    const outside = join(fx.root, `outside-${sidecar.replace('.', '-')}`);
    const bytes = sidecar === 'VERSION'
      ? 'a'.repeat(40) + '\n'
      : JSON.stringify({ workflow: 'kb-platform-release', sourceCommit: 'a'.repeat(40), sha256: 'b'.repeat(64) });
    writeFileSync(outside, bytes);
    rmSync(join(release, sidecar));
    symlinkSync(outside, join(release, sidecar), 'file');
    expect(await openAttestedScheduleSource({ currentPath: fx.current })).toMatchObject({
      available: false,
      reason: 'release-unavailable',
    });
  });
});
