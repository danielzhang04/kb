import { createContext, useContext } from 'react';
import type {
  PtyProbeReason, PublicPtyCapability, SafeRootId, SessionLauncher,
} from '../../shared/ptyProtocol.ts';

/** The server payload the browser trusts: the closed P3 §3 PTY capability plus the transcript flag. */
export type ClientRuntimeCapabilities = { localTranscripts: boolean } & PublicPtyCapability;

const PROBE_REASONS: readonly PtyProbeReason[] = [
  'node-pty-unavailable', 'shell-unavailable', 'broker-unavailable',
  'broker-identity-mismatch', 'root-policy-invalid', 'launcher-unavailable',
];
const DECLARED_LAUNCHERS: readonly SessionLauncher[] = ['shell', 'claude', 'codex'];
const DECLARED_ROOTS: readonly SafeRootId[] = ['repo', 'worktrees'];
/** Probe internals that are never part of the published §3 capability, on either branch. */
const INTERNAL_PROBE_KEYS = ['epochId', 'transport', 'available', 'diagnostic', 'reason', 'detail'];
const DETAIL_MAX_BYTES = 160;
/**
 * The one representation of "no host was ever checked", shared with the server's `NEVER_CHECKED_AT`:
 * a composition that never probed publishes this rather than a fabricated check time, so the closed
 * branch of the decoder accepts it and this module's own sentinel round-trips its own decoder. The
 * available branch still requires a real check time — an advertised terminal was always probed.
 */
const NEVER_CHECKED_AT = '';

/**
 * The fail-closed capability. A browser that has not been told about a terminal never assumes one,
 * so both the un-provided context and every decode/transport failure land here. `checkedAt` is empty
 * precisely because no host was ever checked; only the closed reason drives the unavailable copy.
 */
export const UNAVAILABLE_RUNTIME_CAPABILITIES: ClientRuntimeCapabilities = {
  pty: false,
  diagnostic: { reason: 'broker-unavailable', detail: null, checkedAt: NEVER_CHECKED_AT },
  localTranscripts: false,
};

/** Accept only the declared members, in declared order, without repeats. */
function decodeOrderedUnique<T extends string>(value: unknown, declared: readonly T[]): T[] | null {
  if (!Array.isArray(value)) return null;
  let cursor = -1;
  const decoded: T[] = [];
  for (const entry of value) {
    const index = declared.indexOf(entry as T);
    if (index < 0 || index <= cursor) return null;
    cursor = index;
    decoded.push(entry as T);
  }
  return decoded;
}

function decodeDiagnostic(value: unknown): PublicPtyCapability & { pty: false } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 3) return null;
  const reason = row.reason as PtyProbeReason;
  if (!PROBE_REASONS.includes(reason)) return null;
  if (row.detail !== null && typeof row.detail !== 'string') return null;
  if (typeof row.detail === 'string'
    && (row.detail.includes('\n') || new TextEncoder().encode(row.detail).length > DETAIL_MAX_BYTES)) {
    return null;
  }
  // A refusal may legitimately carry the never-checked sentinel: a composition that never probed a
  // host has no check time to report, and inventing one would be the lie the sentinel exists to avoid.
  if (typeof row.checkedAt !== 'string') return null;
  return { pty: false, diagnostic: { reason, detail: row.detail, checkedAt: row.checkedAt } };
}

/**
 * Decode `/api/runtime/capabilities`. A payload without the closed capability is REJECTED — there is
 * no permissive fallback that reads a bare boolean or invents an available terminal.
 */
export function decodeRuntimeCapabilities(payload: unknown): ClientRuntimeCapabilities | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.localTranscripts !== 'boolean') return null;
  const localTranscripts = row.localTranscripts;
  if (row.pty === true) {
    // Closed both ways. The available payload rides beside the non-PTY host slice, so its key set is
    // not fixed and cannot be counted the way the diagnostic's is; instead the internal probe fields
    // are named and rejected outright, so a server that ever leaked one is refused, not tolerated.
    if (INTERNAL_PROBE_KEYS.some((key) => key in row)) return null;
    if (row.host !== 'desktop' && row.host !== 'vm') return null;
    const launchers = decodeOrderedUnique(row.launchers, DECLARED_LAUNCHERS);
    const roots = decodeOrderedUnique(row.roots, DECLARED_ROOTS);
    if (launchers === null || launchers.length === 0) return null;
    if (roots === null || roots.length === 0) return null;
    if (typeof row.checkedAt !== 'string' || row.checkedAt === '') return null;
    return { pty: true, host: row.host, launchers, roots, checkedAt: row.checkedAt, localTranscripts };
  }
  if (row.pty === false) {
    const closed = decodeDiagnostic(row.diagnostic);
    return closed === null ? null : { ...closed, localTranscripts };
  }
  return null;
}

const RuntimeCapabilitiesContext = createContext<ClientRuntimeCapabilities>(
  UNAVAILABLE_RUNTIME_CAPABILITIES,
);

export const RuntimeCapabilitiesProvider = RuntimeCapabilitiesContext.Provider;

export function useRuntimeCapabilities(): ClientRuntimeCapabilities {
  return useContext(RuntimeCapabilitiesContext);
}
