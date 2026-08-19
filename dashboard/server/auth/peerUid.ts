/**
 * The OS-level half of the tailnet trust proof: resolve the owning UID of the loopback peer on the far
 * end of a connection this daemon has accepted.
 *
 * `tailscale serve` terminates TLS and proxies to `127.0.0.1:4317`, but so can any other local process —
 * including the governed workers the daemon itself spawns. Identity headers are therefore worthless on
 * their own: a direct local connection can forge every one of them. What a local process CANNOT forge is
 * the OS owner of its own socket. `tailscaled` runs as root (uid 0); the dashboard and everything it
 * spawns run as `kb-dashboard`. So "was this connection opened by the trusted proxy?" reduces to "who
 * owns the peer socket?".
 *
 * `/proc/net/tcp{,6}` answers that: it lists every TCP socket in the network namespace with the UID that
 * owns it, and is world-readable, so the unprivileged daemon needs no capability, helper, or IPC. For a
 * connection we accepted, the peer's row is the one whose LOCAL endpoint is our remote endpoint and whose
 * REMOTE endpoint is our local endpoint.
 *
 * Linux-only by construction; the win32 desktop mode never calls this.
 *
 * Every ambiguity fails CLOSED — no row, several rows disagreeing, a non-loopback endpoint, a
 * non-ESTABLISHED row, or an unparsable table all deny the request rather than guessing.
 */
import { readFileSync } from 'node:fs';

/** The tables to consult, in order. One may legitimately be absent (IPv6 disabled). */
const PROC_NET_TABLES = ['/proc/net/tcp', '/proc/net/tcp6'] as const;

/** `sl local_address rem_address st tx:rx tr:tm retrnsmt uid ...` — uid is the 8th whitespace field. */
const UID_FIELD = 7;
/** `st` value for ESTABLISHED. A half-open or TIME_WAIT row is not a live peer and never proves anything. */
const ESTABLISHED = '01';

/** 127.0.0.1 as the kernel prints it: one 32-bit word, little-endian, uppercase hex. */
const LOOPBACK_V4 = '0100007F';
/** ::1 and ::ffff:127.0.0.1 as four little-endian 32-bit words. */
const LOOPBACK_V6 = new Set(['00000000000000000000000001000000', '0000000000000000FFFF00000100007F']);

export type PeerUidResult =
  | { ok: true; uid: number }
  | { ok: false; reason: 'peer-socket-not-found' | 'peer-socket-ambiguous' | 'peer-uid-unparsable' };

/** Read both `/proc/net/tcp*` tables, skipping any that cannot be read. Never throws: an empty result
 *  makes {@link findPeerUid} fail closed, which is the correct response to an unreadable `/proc`. */
export function readProcNetTables(read: (path: string) => string = (path) => readFileSync(path, 'utf-8')): string[] {
  const tables: string[] = [];
  for (const path of PROC_NET_TABLES) {
    try {
      tables.push(read(path));
    } catch {
      // One address family may be absent, or /proc may be masked. Absence is never trust.
    }
  }
  return tables;
}

/** A `<hex-address>:<hex-port>` endpoint field, or `null` when the field is not that shape. */
function parseEndpoint(field: string | undefined): { address: string; port: string } | null {
  if (!field) return null;
  const colon = field.lastIndexOf(':');
  if (colon <= 0 || colon === field.length - 1) return null;
  return { address: field.slice(0, colon).toUpperCase(), port: field.slice(colon + 1).toUpperCase() };
}

function isLoopback(address: string): boolean {
  if (address.length === 8) return address === LOOPBACK_V4;
  if (address.length === 32) return LOOPBACK_V6.has(address);
  return false;
}

function hexPort(port: number): string {
  return port.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * The UID owning the peer socket of the accepted connection `localPort` <- `remotePort`, both loopback.
 *
 * `tables` is the raw text of `/proc/net/tcp` and/or `/proc/net/tcp6` (injected so this is testable
 * against captured real-world tables on any OS).
 */
export function findPeerUid(input: {
  localPort: number;
  remotePort: number;
  tables: readonly string[];
}): PeerUidResult {
  // The peer's socket is the mirror image of ours.
  const peerLocalPort = hexPort(input.remotePort);
  const peerRemotePort = hexPort(input.localPort);
  const owners = new Set<number>();

  for (const table of input.tables) {
    for (const line of table.split('\n')) {
      const fields = line.trim().split(/\s+/);
      if (fields.length <= UID_FIELD || !fields[0].endsWith(':')) continue; // header or short row
      if (fields[3] !== ESTABLISHED) continue;
      const local = parseEndpoint(fields[1]);
      const remote = parseEndpoint(fields[2]);
      if (!local || !remote) continue;
      if (local.port !== peerLocalPort || remote.port !== peerRemotePort) continue;
      if (!isLoopback(local.address) || !isLoopback(remote.address)) continue;
      const uid = Number(fields[UID_FIELD]);
      if (!Number.isInteger(uid) || uid < 0) return { ok: false, reason: 'peer-uid-unparsable' };
      owners.add(uid);
    }
  }

  if (owners.size === 0) return { ok: false, reason: 'peer-socket-not-found' };
  // Two owners for one 4-tuple cannot happen on a healthy kernel; if it is observed, deny.
  if (owners.size > 1) return { ok: false, reason: 'peer-socket-ambiguous' };
  return { ok: true, uid: owners.values().next().value as number };
}
