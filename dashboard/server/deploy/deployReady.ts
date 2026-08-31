// Dashboard v3 P5 §3.1/§3.42 — the deploy-ready candidate reader [P5-C42, P5-C58].
//
// `deployReady.ts` is a PURE READER. It exposes `latestCandidate()` and NOTHING else: no timer, no
// cadence host, no store handle, and no write path of any kind. `latestCandidate()` is a synchronous
// read of the immutable VM release tree, called once on each Inbox projection pass; when a newer
// attested release lands it simply returns the new sha, and the earlier candidate is neither
// transitioned nor written — nothing to abort, nobody writes, no `GET /api/inbox` mutation
// (`design:367`). Candidate turnover needs no mechanism.
//
// "Tested green" is the only green signal the VM has: a release exists at `/opt/kb-releases/<sha>` with
// verified attestation sidecars, because CI gates `main` before any release is built [P5-C42]. A
// missing, unverifiable, tampered, or ambiguous candidate returns `null` — never a guessed SHA.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { DeployReadyCandidate, DeployReadyPort } from './contracts.ts';

export interface DeployReadyReaderOptions {
  /** The immutable-release `current` symlink; defaults to the VM path. */
  currentPath?: string;
}

const DEFAULT_CURRENT_PATH = '/opt/kb-releases/current';
const BREAKING_MARKER = 'BREAKING';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

interface ReleaseAttestation {
  workflow: string;
  sourceCommit: string;
  sha256: string;
}

function contained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function parseAttestation(value: unknown): ReleaseAttestation | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.workflow !== 'kb-platform-release'
    || typeof candidate.sourceCommit !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(candidate.sourceCommit)
    || typeof candidate.sha256 !== 'string' || !HEX64.test(candidate.sha256)) return null;
  return { workflow: candidate.workflow, sourceCommit: candidate.sourceCommit, sha256: candidate.sha256 };
}

/** Read a sidecar inside the resolved release root; a symlink escape or any fs error returns null. */
function readContained(releaseRoot: string, name: string): string | null {
  try {
    const canonical = realpathSync(resolve(releaseRoot, name));
    if (!contained(releaseRoot, canonical)) return null;
    return readFileSync(canonical, 'utf8');
  } catch {
    return null;
  }
}

/** The `MANIFEST.sha256` digest recorded for one relative path, or null if the path is not listed. */
function manifestDigestFor(manifest: string, path: string): string | null {
  for (const line of manifest.split('\n')) {
    if (line === '') continue;
    // `<64 hex>  <path>` — two spaces, exactly as `build_platform_release.py` writes it.
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (match && match[2] === path) return match[1]!;
  }
  return null;
}

/**
 * `breaking` is TRUE iff a regular `BREAKING` file sits in the release tree AND its bytes match its
 * `MANIFEST.sha256` entry. A `BREAKING` file that is uncovered by the manifest, or whose digest
 * disagrees, is a tampered tree: the whole candidate is refused rather than trusted. Returns
 * `'refused'` for that tamper case so the caller yields `null`.
 */
function readBreaking(releaseRoot: string, manifest: string): boolean | 'refused' {
  let markerPath: string;
  try {
    markerPath = realpathSync(resolve(releaseRoot, BREAKING_MARKER));
  } catch {
    // No BREAKING file. A stray manifest entry with no backing file is a tampered tree.
    return manifestDigestFor(manifest, BREAKING_MARKER) === null ? false : 'refused';
  }
  if (!contained(releaseRoot, markerPath)) return 'refused';
  let bytes: Buffer;
  try {
    if (!statSync(markerPath).isFile()) return 'refused';
    bytes = readFileSync(markerPath);
  } catch {
    return 'refused';
  }
  const recorded = manifestDigestFor(manifest, BREAKING_MARKER);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (recorded === null || recorded !== actual) return 'refused';
  return true;
}

export function createDeployReadyReader(options: DeployReadyReaderOptions = {}): DeployReadyPort {
  const currentPath = options.currentPath ?? DEFAULT_CURRENT_PATH;
  return {
    latestCandidate(): DeployReadyCandidate | null {
      let releaseRoot: string;
      try {
        releaseRoot = realpathSync(currentPath);
      } catch {
        return null; // absent release — no candidate.
      }
      const rawVersion = readContained(releaseRoot, 'VERSION');
      const rawAttestation = readContained(releaseRoot, 'attestation.json');
      const manifest = readContained(releaseRoot, 'MANIFEST.sha256');
      if (rawVersion === null || rawAttestation === null || manifest === null) return null;
      if (manifest.trim() === '') return null; // MANIFEST.sha256 disagrees / empty sidecar.

      let attestation: ReleaseAttestation | null;
      try { attestation = parseAttestation(JSON.parse(rawAttestation)); } catch { attestation = null; }
      if (!attestation) return null; // sidecars fail verification.

      const sha = rawVersion.trim();
      if (!HEX40.test(sha)) return null; // never a guessed SHA.
      if (sha !== attestation.sourceCommit) return null; // VERSION disagrees with the attestation.

      const breaking = readBreaking(releaseRoot, manifest);
      if (breaking === 'refused') return null; // tampered BREAKING marker.

      return { sha, attestationDigest: attestation.sha256, breaking };
    },
  };
}
