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
 * connection we accepted, the peer's row is the one whose LOCAL endpoint EQUALS our remote endpoint and
 * whose REMOTE endpoint EQUALS our local endpoint — the full 4-tuple, addresses included.
 *
 * SECURITY — the 4-tuple must be matched in full, not just the port pair. An earlier version matched
 * `(peerLocalPort, peerRemotePort)` plus "both endpoints are some loopback address". That let an
 * unprivileged process bind `127.0.0.2:<port>` on the SAME source port tailscaled was using for a
 * concurrent genuine connection and connect to `127.0.0.1:4317`: its own row (`0200007F`) was owned by
 * the attacker, but tailscaled's genuine row (`0100007F`, identical ports) also matched and returned
 * uid 0 → full operator bypass. Requiring the peer's local endpoint to EQUAL this connection's real
 * remote address selects only the socket that actually is this connection's peer.
 *
 * Linux-only by construction; the win32 desktop mode never calls this.
 *
 * Every ambiguity fails CLOSED — no row, several rows disagreeing, a non-matching endpoint, a
 * non-ESTABLISHED row, an unparsable address, or an unparsable table all deny the request.
 */
import { readFileSync } from 'node:fs';

/** The tables to consult, in order. One may legitimately be absent (IPv6 disabled). */
const PROC_NET_TABLES = ['/proc/net/tcp', '/proc/net/tcp6'] as const;

/** `sl local_address rem_address st tx:rx tr:tm retrnsmt uid ...` — uid is the 8th whitespace field. */
const UID_FIELD = 7;
/** `st` value for ESTABLISHED. A half-open or TIME_WAIT row is not a live peer and never proves anything. */
const ESTABLISHED = '01';

export type PeerUidResult =
  | { ok: true; uid: number }
  | { ok: false; reason: 'peer-socket-not-found' | 'peer-socket-ambiguous' | 'peer-uid-unparsable' | 'peer-address-unparsable' };

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

function hexPort(port: number): string {
  return port.toString(16).toUpperCase().padStart(4, '0');
}

/** Parse a dotted-quad into its four octet bytes, or `null`. */
function ipv4Bytes(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

/** Parse an IPv6 literal (including the `::ffff:1.2.3.4` embedded-v4 form) into its 16 bytes, or `null`. */
function ipv6Bytes(address: string): number[] | null {
  const [head, tail, ...rest] = address.split('::');
  if (rest.length > 0) return null; // more than one "::" is invalid

  const expand = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups = segment.split(':');
    const bytes: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      // A trailing embedded IPv4 (only valid as the final group).
      if (group.includes('.')) {
        if (i !== groups.length - 1) return null;
        const v4 = ipv4Bytes(group);
        if (!v4) return null;
        bytes.push(...v4);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      const value = Number.parseInt(group, 16);
      bytes.push((value >> 8) & 0xff, value & 0xff);
    }
    return bytes;
  };

  if (tail === undefined) {
    // No "::": must be a full 16-byte address.
    const bytes = expand(head);
    return bytes && bytes.length === 16 ? bytes : null;
  }
  const headBytes = expand(head);
  const tailBytes = expand(tail);
  if (!headBytes || !tailBytes) return null;
  const gap = 16 - headBytes.length - tailBytes.length;
  if (gap < 0) return null;
  return [...headBytes, ...new Array<number>(gap).fill(0), ...tailBytes];
}

/**
 * Render an IP address string into the exact hex form the kernel prints in `/proc/net/tcp{,6}`: each
 * 32-bit word little-endian, uppercase, IPv4 as one word and IPv6 as four. Returns `null` for anything
 * that does not parse, so a caller fails closed rather than matching on a partial address.
 */
export function ipToProcHex(address: string): string | null {
  const v4 = ipv4Bytes(address);
  if (v4) return leWord(v4);
  const v6 = ipv6Bytes(address);
  if (v6) return [0, 4, 8, 12].map((offset) => leWord(v6.slice(offset, offset + 4))).join('');
  return null;
}

/** One little-endian hex word from 4 bytes: reverse, 2-hex-uppercase each. */
function leWord(bytes: number[]): string {
  return bytes.slice().reverse().map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join('');
}

/**
 * The UID owning the peer socket of the accepted connection
 * `localAddress:localPort` <- `remoteAddress:remotePort`.
 *
 * `tables` is the raw text of `/proc/net/tcp` and/or `/proc/net/tcp6` (injected so this is testable
 * against captured real-world tables on any OS). The addresses are matched in FULL — see the module
 * header for why the port pair alone is exploitable.
 */
export function findPeerUid(input: {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  tables: readonly string[];
}): PeerUidResult {
  // The peer's socket is the mirror image of ours: its local endpoint is our remote, and vice versa.
  const peerLocalAddress = ipToProcHex(input.remoteAddress);
  const peerRemoteAddress = ipToProcHex(input.localAddress);
  if (peerLocalAddress === null || peerRemoteAddress === null) {
    return { ok: false, reason: 'peer-address-unparsable' };
  }
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
      if (local.address !== peerLocalAddress || remote.address !== peerRemoteAddress) continue;
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

/** The socket-bearing request shape the peer proof reads (a structural subset of `OperatorRequestLike`). */
export interface PeerSocketRequest {
  socket?: {
    remoteAddress?: string | undefined;
    remotePort?: number | undefined;
    localAddress?: string | undefined;
    localPort?: number | undefined;
  } | undefined;
}

/**
 * Exactly loopback, nothing else in 127/8 — the same tight set both trust boundaries use. `startsWith('127.')`
 * would admit `127.0.0.2`, the source-address spoof the full-4-tuple match in {@link findPeerUid} guards.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * Resolve the owning uid of the accepted connection's loopback peer, or a fail-closed `PeerUidResult`. The
 * node-identity and tailnet-operator boundaries share this exact block: require both endpoints to be
 * loopback with integer ports (else `peer-socket-not-found`), then match the full 4-tuple against `/proc`
 * via {@link findPeerUid}. `readTables` is read ONLY on the success path — never on a socket rejection.
 */
export function resolvePeerUid(req: PeerSocketRequest, readTables: () => readonly string[]): PeerUidResult {
  const socket = req.socket;
  const remoteAddress = socket?.remoteAddress;
  const localAddress = socket?.localAddress;
  const remotePort = socket?.remotePort;
  const localPort = socket?.localPort;
  if (!isLoopbackAddress(remoteAddress) || !isLoopbackAddress(localAddress)
    || !Number.isInteger(remotePort) || !Number.isInteger(localPort)) {
    return { ok: false, reason: 'peer-socket-not-found' };
  }
  return findPeerUid({
    localAddress: localAddress!, localPort: localPort!,
    remoteAddress: remoteAddress!, remotePort: remotePort!,
    tables: readTables(),
  });
}
