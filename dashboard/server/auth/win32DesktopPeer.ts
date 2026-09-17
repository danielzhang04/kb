/**
 * `win32-desktop` mode's operator proof — the Windows twin of `peerUid.ts`.
 *
 * WHAT THIS BUYS. The desktop daemon (`dashboard/pm2.config.cjs`) listens on loopback on Daniel's own
 * machine. There is no proxy to attest an identity and no sign-in ceremony left, so the only thing a
 * request carries that a local process cannot forge is the OS OWNER OF ITS OWN SOCKET. That is exactly
 * the fact `peerUid.ts` reads out of `/proc/net/tcp` on the VM, and exactly the fact the PTY broker's
 * `unixServiceIdentity.ts#readUnixPeerIdentity` reads with `SO_PEERCRED`: ask the kernel who is on the
 * other end, never the request. This module asks Windows the same question, through the same kind of
 * FFI seam (`koffi`, already a dependency for `SO_PEERCRED`):
 *
 *   1. `GetExtendedTcpTable(..., TCP_TABLE_OWNER_PID_ALL)` (iphlpapi) lists every TCP socket with the
 *      PID that owns it — the Windows analogue of `/proc/net/tcp`'s uid column. The peer's row is the
 *      MIRROR of ours: its local endpoint equals our remote, its remote equals our local. The FULL
 *      4-tuple is matched, addresses included, for the reason `peerUid.ts`'s header records at length:
 *      matching the port pair alone lets a process on another loopback address ride a concurrent
 *      genuine connection's ports.
 *   2. `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `OpenProcessToken(TOKEN_QUERY)` +
 *      `GetTokenInformation(TokenUser)` (kernel32/advapi32) resolves that PID's token user SID, and it
 *      must equal THIS process's own token user SID. A process owned by another Windows account is
 *      normally not even openable (`ACCESS_DENIED`), which fails closed one step earlier.
 *
 * WHAT THIS DOES NOT BUY, stated plainly: on a single-user desktop every process Daniel runs — including
 * the workers this daemon spawns — is the same OS user, so this proof is a MACHINE-AND-ACCOUNT boundary,
 * not a process boundary. It is the honest ceiling of the deployment: it refuses every remote client and
 * every other Windows account on the box, which is the whole population that exists to refuse there. The
 * tailnet deployment, where workers run as a separate unprivileged user, is the one that gets a process
 * boundary — and it keeps using `peerUid.ts` untouched.
 *
 * EVERY ambiguity fails CLOSED: no socket endpoints, a non-loopback endpoint, no matching row, two rows
 * disagreeing, an unopenable process, an unparsable token, or an unavailable FFI all DENY. There is no
 * arm of this module that returns `ok` without a matched 4-tuple and an equal SID.
 */
import { userInfo } from 'node:os';
import { createRequire } from 'node:module';
import { ipAddressBytes, isLoopbackAddress } from './peerUid.ts';
import type { PeerSocketRequest } from './peerUid.ts';

/** `MIB_TCP_STATE_ESTAB`. A LISTEN/TIME_WAIT/half-open row is not a live peer and proves nothing. */
export const MIB_TCP_STATE_ESTABLISHED = 5;

/** `TCP_TABLE_OWNER_PID_ALL` — the table class that carries the owning PID. */
const TCP_TABLE_OWNER_PID_ALL = 5;
const AF_INET = 2;
const AF_INET6 = 23;
const ERROR_INSUFFICIENT_BUFFER = 122;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x0008;
const TOKEN_USER_CLASS = 1;
/** Widest real `TOKEN_USER`: 16-byte header + an 8 + 15*4 SID. 512 is slack, not a guess. */
const TOKEN_USER_BUFFER = 512;
/** A SID is `revision(1) + subAuthorityCount(1) + identifierAuthority(6) + subAuthority[count](4n)`. */
const SID_HEADER = 8;
const SID_MAX_SUB_AUTHORITIES = 15;

/** One row of `MIB_TCPTABLE_OWNER_PID` / `MIB_TCP6TABLE_OWNER_PID`, addresses as raw network bytes. */
export interface TcpOwnerRow {
  family: 'ipv4' | 'ipv6';
  state: number;
  localAddress: Buffer;
  localPort: number;
  remoteAddress: Buffer;
  remotePort: number;
  owningPid: number;
}

export type DesktopPeerRefusal =
  /** Not Windows: this proof reads Win32 APIs and has no meaning anywhere else. */
  | 'unsupported-platform'
  /** One or both endpoints of the accepted connection are not exactly loopback. */
  | 'not-loopback'
  /** No ESTABLISHED row mirrors this connection, or its owner could not be resolved. */
  | 'peer-unknown'
  /** Two different PIDs claim one 4-tuple — impossible on a healthy kernel, so deny. */
  | 'peer-ambiguous'
  /** The peer is a real local process, owned by a DIFFERENT Windows account. */
  | 'peer-not-same-user'
  /** The proof itself could not run (FFI/library unavailable, our own SID unreadable). */
  | 'peer-lookup-unavailable';

export type DesktopPeerResult = { ok: true; user: string } | { ok: false; reason: DesktopPeerRefusal };

/** The one question the mint path asks of a request. Injected on {@link SurfaceContext} so a test can
 *  drive the route matrix without a real socket, exactly as the tailnet mode injects `operatorAuth`. */
export type DesktopPeerCheck = (req: PeerSocketRequest) => DesktopPeerResult;

/* ────────────────────────────── pure parsers over the kernel layouts ────────────────────────────── */

const V4_ROW_BYTES = 24;
const V6_ROW_BYTES = 56;

function rowCount(buffer: Buffer, rowBytes: number): number {
  if (buffer.length < 4) return 0;
  const declared = buffer.readUInt32LE(0);
  const available = Math.floor((buffer.length - 4) / rowBytes);
  return Math.min(declared, available);
}

/**
 * `MIB_TCPTABLE_OWNER_PID`: `DWORD dwNumEntries` then `{state, localAddr, localPort, remoteAddr,
 * remotePort, owningPid}` DWORDs. Addresses are network-order bytes in place; the ports are the LOW two
 * bytes of their DWORD, in network order — hence the big-endian 16-bit read.
 */
export function parseTcpOwnerTableV4(buffer: Buffer): TcpOwnerRow[] {
  const rows: TcpOwnerRow[] = [];
  for (let index = 0; index < rowCount(buffer, V4_ROW_BYTES); index++) {
    const at = 4 + index * V4_ROW_BYTES;
    rows.push({
      family: 'ipv4',
      state: buffer.readUInt32LE(at),
      localAddress: Buffer.from(buffer.subarray(at + 4, at + 8)),
      localPort: buffer.readUInt16BE(at + 8),
      remoteAddress: Buffer.from(buffer.subarray(at + 12, at + 16)),
      remotePort: buffer.readUInt16BE(at + 16),
      owningPid: buffer.readUInt32LE(at + 20),
    });
  }
  return rows;
}

/**
 * `MIB_TCP6TABLE_OWNER_PID`: `{ucLocalAddr[16], dwLocalScopeId, dwLocalPort, ucRemoteAddr[16],
 * dwRemoteScopeId, dwRemotePort, dwState, dwOwningPid}` — 56 bytes, a different field ORDER from the
 * v4 row (state is last but one), which is why this is a separate parser rather than a stride.
 */
export function parseTcpOwnerTableV6(buffer: Buffer): TcpOwnerRow[] {
  const rows: TcpOwnerRow[] = [];
  for (let index = 0; index < rowCount(buffer, V6_ROW_BYTES); index++) {
    const at = 4 + index * V6_ROW_BYTES;
    rows.push({
      family: 'ipv6',
      state: buffer.readUInt32LE(at + 48),
      localAddress: Buffer.from(buffer.subarray(at, at + 16)),
      localPort: buffer.readUInt16BE(at + 20),
      remoteAddress: Buffer.from(buffer.subarray(at + 24, at + 40)),
      remotePort: buffer.readUInt16BE(at + 44),
      owningPid: buffer.readUInt32LE(at + 52),
    });
  }
  return rows;
}

/**
 * The SID out of a `TOKEN_USER` buffer. `TOKEN_USER` is `{PSID Sid; DWORD Attributes;}` and Windows
 * documents the SID as APPENDED to it in the same buffer — so the SID sits at the first aligned offset
 * past the struct (16 on x64, 12 on x86). The `Sid` POINTER is deliberately never chased: it is an
 * absolute address with no meaning inside a JS `Buffer`, and chasing it would need a second FFI read
 * of arbitrary memory. Instead each candidate offset is VALIDATED as a real SID (revision, a sane
 * sub-authority count, and a length that exactly accounts for the bytes the call returned), so a layout
 * that is not what we expect yields `null` — a refusal — rather than a wrong answer.
 */
export function parseTokenUserSid(buffer: Buffer, returnLength: number): Buffer | null {
  const length = Math.min(returnLength, buffer.length);
  for (const at of [16, 12]) {
    if (length < at + SID_HEADER) continue;
    const revision = buffer[at];
    const subAuthorities = buffer[at + 1];
    if (revision !== 1 || subAuthorities < 1 || subAuthorities > SID_MAX_SUB_AUTHORITIES) continue;
    const sidLength = SID_HEADER + subAuthorities * 4;
    if (at + sidLength !== length) continue;
    return Buffer.from(buffer.subarray(at, at + sidLength));
  }
  return null;
}

/** The canonical `S-1-<authority>-<sub>...` rendering of a SID, or `null` if the bytes are not one. */
export function formatSid(sid: Buffer): string | null {
  if (sid.length < SID_HEADER || sid[0] !== 1) return null;
  const subAuthorities = sid[1];
  if (sid.length !== SID_HEADER + subAuthorities * 4) return null;
  let authority = 0;
  for (let index = 2; index < 8; index++) authority = authority * 256 + sid[index];
  const parts = [`S-1-${authority}`];
  for (let index = 0; index < subAuthorities; index++) parts.push(String(sid.readUInt32LE(SID_HEADER + index * 4)));
  return parts.join('-');
}

/**
 * The PID owning the peer socket of the accepted connection `localAddress:localPort` <-
 * `remoteAddress:remotePort`, matched on the FULL mirrored 4-tuple against an ESTABLISHED row.
 */
export function findPeerOwnerPid(input: {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  rows: readonly TcpOwnerRow[];
}): { ok: true; pid: number } | { ok: false; reason: 'peer-unknown' | 'peer-ambiguous' } {
  const peerLocal = ipAddressBytes(input.remoteAddress);
  const peerRemote = ipAddressBytes(input.localAddress);
  if (peerLocal === null || peerRemote === null) return { ok: false, reason: 'peer-unknown' };
  const wantLocal = Buffer.from(peerLocal);
  const wantRemote = Buffer.from(peerRemote);
  const owners = new Set<number>();
  for (const row of input.rows) {
    if (row.state !== MIB_TCP_STATE_ESTABLISHED) continue;
    if (row.localPort !== input.remotePort || row.remotePort !== input.localPort) continue;
    if (!row.localAddress.equals(wantLocal) || !row.remoteAddress.equals(wantRemote)) continue;
    owners.add(row.owningPid);
  }
  if (owners.size === 0) return { ok: false, reason: 'peer-unknown' };
  if (owners.size > 1) return { ok: false, reason: 'peer-ambiguous' };
  return { ok: true, pid: owners.values().next().value as number };
}

/* ─────────────────────────────────────── the Win32 FFI seam ─────────────────────────────────────── */

type Win32Bindings = {
  getExtendedTcpTable: (table: Buffer | null, size: Uint32Array, order: boolean, family: number, tableClass: number, reserved: number) => number;
  openProcess: (access: number, inherit: boolean, pid: number) => unknown;
  closeHandle: (handle: unknown) => boolean;
  openProcessToken: (process: unknown, access: number, out: unknown[]) => boolean;
  getTokenInformation: (token: unknown, infoClass: number, info: Buffer, length: number, returned: Uint32Array) => boolean;
  currentProcess: () => unknown;
};

let bindings: Win32Bindings | null | undefined;

/**
 * Load the three system libraries ONCE, SYNCHRONOUSLY. `createRequire` (not a dynamic `import`) on
 * purpose: this runs inside a request's decision path, so there must be no window in which the proof is
 * "not ready yet" and a request gets an answer that depends on timing. koffi is the same CJS module the
 * PTY broker's `SO_PEERCRED` path loads (`pty/unixServiceIdentity.ts`), so this adds no dependency. A
 * failure is cached as `null`: an environment without the FFI refuses every request cheaply rather than
 * re-throwing on each one.
 */
function win32Bindings(): Win32Bindings | null {
  if (bindings !== undefined) return bindings;
  try {
    const koffi = createRequire(import.meta.url)('koffi') as {
      load: (path: string) => { func: (prototype: string) => unknown };
    };
    const iphlpapi = koffi.load('iphlpapi.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const advapi32 = koffi.load('advapi32.dll');
    bindings = {
      getExtendedTcpTable: iphlpapi.func(
        'uint32 __stdcall GetExtendedTcpTable(void *pTcpTable, _Inout_ uint32 *pdwSize, bool bOrder, uint32 ulAf, int TableClass, uint32 Reserved)',
      ) as Win32Bindings['getExtendedTcpTable'],
      openProcess: kernel32.func('void *OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)') as Win32Bindings['openProcess'],
      closeHandle: kernel32.func('bool CloseHandle(void *hObject)') as Win32Bindings['closeHandle'],
      currentProcess: kernel32.func('void *GetCurrentProcess()') as Win32Bindings['currentProcess'],
      openProcessToken: advapi32.func('bool OpenProcessToken(void *ProcessHandle, uint32 DesiredAccess, _Out_ void **TokenHandle)') as Win32Bindings['openProcessToken'],
      getTokenInformation: advapi32.func(
        'bool GetTokenInformation(void *TokenHandle, int TokenInformationClass, _Out_ void *TokenInformation, uint32 TokenInformationLength, _Out_ uint32 *ReturnLength)',
      ) as Win32Bindings['getTokenInformation'],
    };
  } catch {
    // No FFI, no proof. Every caller then refuses; nothing degrades into a weaker check.
    bindings = null;
  }
  return bindings;
}

/** Both address families' owner tables, as rows. Throws only if the FFI itself is unavailable. */
export function readTcpOwnerRows(): TcpOwnerRow[] {
  const api = win32Bindings();
  if (api === null) throw new Error('win32 peer lookup is unavailable');
  const rows: TcpOwnerRow[] = [];
  for (const [family, parse] of [[AF_INET, parseTcpOwnerTableV4], [AF_INET6, parseTcpOwnerTableV6]] as const) {
    const size = new Uint32Array(1);
    const probe = api.getExtendedTcpTable(null, size, false, family, TCP_TABLE_OWNER_PID_ALL, 0);
    // A family that is absent (IPv6 disabled) answers something other than "need a bigger buffer".
    if (probe !== ERROR_INSUFFICIENT_BUFFER || size[0] === 0) continue;
    const table = Buffer.alloc(size[0]);
    if (api.getExtendedTcpTable(table, size, false, family, TCP_TABLE_OWNER_PID_ALL, 0) !== 0) continue;
    rows.push(...parse(table));
  }
  return rows;
}

/** The token user SID of `pid`, or `null` when the process cannot be opened or read (ANOTHER user's
 *  process normally lands here with `ACCESS_DENIED` — an unopenable peer is never a trusted peer). */
export function processUserSid(pid: number): Buffer | null {
  const api = win32Bindings();
  if (api === null) return null;
  let process_: unknown = null;
  let token: unknown = null;
  try {
    process_ = api.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!process_) return null;
    const out: unknown[] = [null];
    if (!api.openProcessToken(process_, TOKEN_QUERY, out) || !out[0]) return null;
    token = out[0];
    return readTokenUserSid(api, token);
  } catch {
    return null;
  } finally {
    try { if (token) api.closeHandle(token); } catch { /* best effort */ }
    try { if (process_) api.closeHandle(process_); } catch { /* best effort */ }
  }
}

/** THIS process's token user SID — the value every peer SID is compared against. */
export function currentUserSid(): Buffer | null {
  const api = win32Bindings();
  if (api === null) return null;
  let token: unknown = null;
  try {
    const out: unknown[] = [null];
    if (!api.openProcessToken(api.currentProcess(), TOKEN_QUERY, out) || !out[0]) return null;
    token = out[0];
    return readTokenUserSid(api, token);
  } catch {
    return null;
  } finally {
    try { if (token) api.closeHandle(token); } catch { /* best effort */ }
  }
}

function readTokenUserSid(api: Win32Bindings, token: unknown): Buffer | null {
  const info = Buffer.alloc(TOKEN_USER_BUFFER);
  const returned = new Uint32Array(1);
  if (!api.getTokenInformation(token, TOKEN_USER_CLASS, info, info.length, returned)) return null;
  return parseTokenUserSid(info, returned[0]);
}

/* ─────────────────────────────────────── the decision ─────────────────────────────────────── */

export interface Win32PeerOwnerDeps {
  /** Injected in tests; production reads the real `GetExtendedTcpTable`. */
  readRows?: () => readonly TcpOwnerRow[];
  processUserSid?: (pid: number) => Buffer | null;
  currentUserSid?: () => Buffer | null;
  /** The name recorded as `desktopUser` attribution. Same user by construction, so it is OUR name. */
  userName?: () => string;
}

/**
 * The peer proof: loopback on both ends, a mirrored ESTABLISHED row, and a token user SID equal to ours.
 * Returns the daemon's own account name on success — the value bound as `desktopUser` attribution.
 */
export function createWin32PeerOwner(deps: Win32PeerOwnerDeps = {}): DesktopPeerCheck {
  const readRows = deps.readRows ?? (() => readTcpOwnerRows());
  const peerSid = deps.processUserSid ?? processUserSid;
  const ourSid = deps.currentUserSid ?? currentUserSid;
  const name = deps.userName ?? (() => userInfo().username);
  return (req: PeerSocketRequest): DesktopPeerResult => {
    const socket = req.socket;
    // The loopback wall FIRST, and on both endpoints: it is a pure check, it is the requirement the
    // design states outright, and it must not cost a table read to refuse a remote client.
    if (!isLoopbackAddress(socket?.remoteAddress) || !isLoopbackAddress(socket?.localAddress)) {
      return { ok: false, reason: 'not-loopback' };
    }
    const { remotePort, localPort, remoteAddress, localAddress } = socket!;
    if (!Number.isInteger(remotePort) || !Number.isInteger(localPort)) return { ok: false, reason: 'peer-unknown' };
    let owner: ReturnType<typeof findPeerOwnerPid>;
    try {
      owner = findPeerOwnerPid({
        localAddress: localAddress!, localPort: localPort!, remoteAddress: remoteAddress!, remotePort: remotePort!,
        rows: readRows(),
      });
    } catch {
      return { ok: false, reason: 'peer-lookup-unavailable' };
    }
    if (!owner.ok) return { ok: false, reason: owner.reason };
    const mine = ourSid();
    if (mine === null) return { ok: false, reason: 'peer-lookup-unavailable' };
    const theirs = peerSid(owner.pid);
    if (theirs === null) return { ok: false, reason: 'peer-unknown' };
    if (!theirs.equals(mine)) return { ok: false, reason: 'peer-not-same-user' };
    return { ok: true, user: name() };
  };
}

export interface DesktopPeerCheckDeps {
  platform?: NodeJS.Platform;
  peerOwner?: DesktopPeerCheck;
}

/**
 * The check `http/surface.ts` installs in `win32-desktop` mode. Off win32 it refuses everything
 * (`unsupported-platform`) without constructing or consulting anything: a desktop-mode daemon running
 * somewhere this proof cannot exist has no mint path, which is the same fail-closed answer T2's removal
 * of the browser sign-in ceremony left behind everywhere else.
 */
export function createDesktopPeerCheck(deps: DesktopPeerCheckDeps = {}): DesktopPeerCheck {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') return () => ({ ok: false, reason: 'unsupported-platform' });
  const peerOwner = deps.peerOwner ?? createWin32PeerOwner();
  return (req) => peerOwner(req);
}
