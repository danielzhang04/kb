import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeployReadyReader } from './deployReady.ts';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function digest(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface ReleaseSpec {
  sha?: string;
  sourceCommit?: string;
  attestationSha256?: string;
  manifest?: string;
  breaking?: string | null;
  attestationJson?: string;
}

function writeRelease(spec: ReleaseSpec = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'deploy-ready-'));
  roots.push(root);
  const sha = spec.sha ?? SHA;
  const attestationSha256 = spec.attestationSha256 ?? digest(`archive-${sha}`);
  writeFileSync(join(root, 'VERSION'), `${sha}\n`, 'utf8');
  const attestation = spec.attestationJson ?? JSON.stringify({
    archive: `kb-platform-${sha}.tar.gz`,
    schema: 'kb.release-attestation/v2',
    sha256: attestationSha256,
    sourceCommit: spec.sourceCommit ?? sha,
    stateSchema: '3', rollbackStateSchema: '2', stateMigration: 'breaking', workflow: 'kb-platform-release',
  });
  writeFileSync(join(root, 'attestation.json'), attestation, 'utf8');
  const manifestLines: string[] = [`${digest('server')}  dashboard/server/index.ts`];
  if (spec.breaking !== undefined && spec.breaking !== null) {
    writeFileSync(join(root, 'BREAKING'), spec.breaking, 'utf8');
    manifestLines.push(`${digest(spec.breaking)}  BREAKING`);
  }
  writeFileSync(join(root, 'MANIFEST.sha256'), spec.manifest ?? `${manifestLines.join('\n')}\n`, 'utf8');
  return root;
}

describe('deployReady candidate reader', () => {
  it('projects a verified green release as a non-breaking candidate', () => {
    const root = writeRelease();
    const candidate = createDeployReadyReader({ currentPath: root }).latestCandidate();
    expect(candidate).toEqual({ sha: SHA, attestationDigest: digest(`archive-${SHA}`), breaking: false });
  });

  it('reports breaking:true from a manifest-covered BREAKING marker', () => {
    const root = writeRelease({ breaking: 'state schema bump\n' });
    expect(createDeployReadyReader({ currentPath: root }).latestCandidate()?.breaking).toBe(true);
  });

  it('returns null when the release is absent', () => {
    expect(createDeployReadyReader({ currentPath: join(tmpdir(), 'no-such-release-xyz') }).latestCandidate())
      .toBeNull();
  });

  it('returns null when the attestation sidecar fails verification', () => {
    const root = writeRelease({ attestationJson: '{ not json' });
    expect(createDeployReadyReader({ currentPath: root }).latestCandidate()).toBeNull();
    const wrongWorkflow = writeRelease({ attestationJson: JSON.stringify({
      archive: 'x', schema: 'kb.release-attestation/v2', sha256: digest('x'),
      sourceCommit: SHA, stateSchema: '3', rollbackStateSchema: '2', stateMigration: 'breaking',
      workflow: 'not-kb-platform-release',
    }) });
    expect(createDeployReadyReader({ currentPath: wrongWorkflow }).latestCandidate()).toBeNull();
  });

  it('returns null (never a guessed SHA) when VERSION disagrees with the attestation', () => {
    const root = writeRelease({ sha: SHA, sourceCommit: OTHER_SHA });
    expect(createDeployReadyReader({ currentPath: root }).latestCandidate()).toBeNull();
  });

  it('returns null when MANIFEST.sha256 is empty', () => {
    const root = writeRelease({ manifest: '' });
    expect(createDeployReadyReader({ currentPath: root }).latestCandidate()).toBeNull();
  });

  it('refuses a tampered BREAKING marker whose bytes disagree with the manifest', () => {
    const root = writeRelease({ breaking: 'real\n' });
    writeFileSync(join(root, 'BREAKING'), 'planted\n', 'utf8'); // bytes no longer match the manifest digest
    expect(createDeployReadyReader({ currentPath: root }).latestCandidate()).toBeNull();
  });

  it('refuses a stray manifest BREAKING entry with no backing file', () => {
    const root = writeRelease();
    writeFileSync(join(root, 'MANIFEST.sha256'),
      `${digest('server')}  dashboard/server/index.ts\n${digest('ghost')}  BREAKING\n`, 'utf8');
    expect(createDeployReadyReader({ currentPath: root }).latestCandidate()).toBeNull();
  });

  it('is a pure reader — exactly latestCandidate(), no store handle, no write path', () => {
    const root = writeRelease();
    const port = createDeployReadyReader({ currentPath: root });
    expect(Object.keys(port)).toEqual(['latestCandidate']);
    // Repeated reads are pure and equal.
    expect(port.latestCandidate()).toEqual(port.latestCandidate());
  });

  it('follows a newer attested release by sha with no transition of the earlier candidate', () => {
    const root = writeRelease({ sha: SHA });
    const port = createDeployReadyReader({ currentPath: root });
    expect(port.latestCandidate()?.sha).toBe(SHA);
    // A newer release lands at the same current path; the reader simply returns the new sha.
    const next = digest(`archive-${OTHER_SHA}`);
    writeFileSync(join(root, 'VERSION'), `${OTHER_SHA}\n`, 'utf8');
    writeFileSync(join(root, 'attestation.json'), JSON.stringify({
      archive: 'x', schema: 'kb.release-attestation/v2', sha256: next, sourceCommit: OTHER_SHA,
      stateSchema: '3', rollbackStateSchema: '2', stateMigration: 'breaking', workflow: 'kb-platform-release',
    }), 'utf8');
    expect(port.latestCandidate()).toEqual({ sha: OTHER_SHA, attestationDigest: next, breaking: false });
  });
});
