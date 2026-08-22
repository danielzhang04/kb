import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type AttestedSourceUnavailableReason =
  | 'release-unavailable'
  | 'release-attestation-invalid'
  | 'release-attestation-mismatch';

export class AttestedSourceError extends Error {
  constructor(readonly code: 'attested-source-path-refused' | 'attested-source-file-unavailable', message = code) {
    super(message);
    this.name = 'AttestedSourceError';
  }
}

export type AttestedScheduleSource =
  | { available: false; reason: AttestedSourceUnavailableReason }
  | {
    available: true;
    releaseRoot: string;
    sourceCommit: string;
    archiveSha256: string;
    read(path: 'HEARTBEAT.md' | `orgs/${string}/HEARTBEAT.md` | `agents/${string}.md`): Promise<string>;
  };

interface Attestation {
  workflow: string;
  sourceCommit: string;
  sha256: string;
}

function attestation(value: unknown): Attestation | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.workflow !== 'kb-platform-release'
    || typeof candidate.sourceCommit !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(candidate.sourceCommit)
    || typeof candidate.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(candidate.sha256)) return null;
  return { workflow: candidate.workflow, sourceCommit: candidate.sourceCommit, sha256: candidate.sha256 };
}

function validPackedPath(path: string): boolean {
  if (path === '' || isAbsolute(path) || path.includes('\\') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) return false;
  return path === 'HEARTBEAT.md'
    || /^orgs\/[a-z0-9][a-z0-9-]*\/HEARTBEAT\.md$/.test(path)
    || /^agents\/[a-z0-9][a-z0-9-]*\.md$/.test(path);
}

function contained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function openAttestedScheduleSource(
  options: { currentPath?: string } = {},
): Promise<AttestedScheduleSource> {
  const currentPath = options.currentPath ?? '/opt/kb-releases/current';
  let releaseRoot: string;
  let version: string;
  let rawAttestation: string;
  try {
    releaseRoot = await realpath(currentPath);
    const [versionPath, attestationPath] = await Promise.all([
      realpath(resolve(releaseRoot, 'VERSION')),
      realpath(resolve(releaseRoot, 'attestation.json')),
    ]);
    if (!contained(releaseRoot, versionPath) || !contained(releaseRoot, attestationPath)) {
      return { available: false, reason: 'release-unavailable' };
    }
    [version, rawAttestation] = await Promise.all([
      readFile(versionPath, 'utf8'),
      readFile(attestationPath, 'utf8'),
    ]);
  } catch {
    return { available: false, reason: 'release-unavailable' };
  }
  let parsed: Attestation | null;
  try { parsed = attestation(JSON.parse(rawAttestation)); } catch { parsed = null; }
  if (!parsed) return { available: false, reason: 'release-attestation-invalid' };
  if (version.trim() !== parsed.sourceCommit) return { available: false, reason: 'release-attestation-mismatch' };
  return {
    available: true,
    releaseRoot,
    sourceCommit: parsed.sourceCommit,
    archiveSha256: parsed.sha256,
    async read(path) {
      if (!validPackedPath(path)) throw new AttestedSourceError('attested-source-path-refused');
      const candidate = resolve(releaseRoot, path);
      if (!contained(releaseRoot, candidate)) throw new AttestedSourceError('attested-source-path-refused');
      try {
        const canonical = await realpath(candidate);
        if (!contained(releaseRoot, canonical)) throw new AttestedSourceError('attested-source-path-refused');
        return await readFile(canonical, 'utf8');
      } catch (error) {
        if (error instanceof AttestedSourceError) throw error;
        throw new AttestedSourceError('attested-source-file-unavailable');
      }
    },
  };
}
