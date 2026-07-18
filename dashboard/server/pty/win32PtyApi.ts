/**
 * D3.1e/f — the REAL koffi FFI backing for the CROSS-USER PTY-host pipe (server + client) and the
 * secure token file. Daniel's D-4 decision: this is a COPY-AND-PARAMETERIZE of the Broker's
 * `broker/win32Api.ts` into a NEW file (broker/** stays frozen), with three cross-user changes:
 *
 *   1. PARAMETERIZED PIPE SDDL — the Broker hardcodes `D:P(A;;GA;;;${daemonSid})…` (same-user). Here the
 *      pipe is OWNED by kb-fleet but its client is Daniel, so the SA is built from `buildPipeSddl({ownerSid,
 *      peerSid})` (§2): owner GA, peer GRGW (connect-only, least privilege), SYSTEM GA, Medium label. The
 *      transport is produced by `makeHostTransport({ownerSid, peerSid})`, binding the SIDs at boot.
 *   2. PARAMETERIZED TOKEN-FILE WRITER — `writeAndVerify(path, token, {ownerSid, readerSid})` builds
 *      `buildTokenFileSddl` (owner FA + Daniel FR + SYSTEM FA + Medium NRNWNX), reparse-safe create
 *      (FILE_FLAG_OPEN_REPARSE_POINT), then reads the DACL+label back and verifies the allowlist
 *      (`tokenFileSddlVerified`) — the SecureTokenFileWriter seam from Phase 1, now real.
 *   3. NEW CLIENT SURFACE — `connectAndVerifyServer(name, expectedServerSid)`: CreateFileW-connect at
 *      SECURITY_IDENTIFICATION (never Impersonation — the host may identify Daniel, never act as him), then
 *      GetSecurityInfo(OWNER) on the pipe handle → owner SID, compared to the pinned kb-fleet SID BEFORE any
 *      byte is written (anti-squat, design Point 4). The OWNER check (not a server-PROCESS-token check) works
 *      cross-user: OpenProcess against the kb-fleet daemon is ACCESS_DENIED from a non-admin Medium daemon.
 *      Returns a duplex `PtyClientChannel` only if the pipe owner matches.
 *
 * The persistent connection (unlike the Broker's one-shot) needs a full-duplex overlapped stream, so each
 * connection carries TWO OVERLAPPED structures + events (one for reads, one for writes) and a serialized
 * async write queue. Reads feed a `FrameParser`. The SID reads (impersonation on the server; server-process
 * token on the client) reuse the Broker's crash-proof `parseSidString` (SID bytes → string; NOT the
 * segfaulting `ConvertSidToStringSidW`+`koffi.decode` path). koffi is loaded LAZILY (first `loadWin32PtyApi`
 * call), so a bare import never pulls it in — hermetic suites inject fakes and never reach here.
 *
 * Every FFI step is fail-closed: any failure at create / label-readback / impersonate / SID-parse / connect
 * / server-verify yields null (→ the caller rejects / the boot fails closed). `RevertToSelf` ALWAYS runs
 * after an impersonation; a failed revert hard-exits (Broker rule). Nothing here ever logs the token.
 */
import { createRequire } from 'node:module';
import { parseSidString } from '../../../broker/win32Sid.ts';
import { buildPipeSddl, buildTokenFileSddl, ownerSidFromSddl, sddlHasMediumLabel, tokenFileSddlVerified } from './pipeSddl.ts';
import { encodeFrame, FrameParser } from './ptyProtocol.ts';
import type { ControlFrame, InboundFrame, PtyClientChannel, PtyServerChannel } from './ptyProtocol.ts';
import type { PipeHandle, PtyPeerFfi, PtyPipeTransport } from './hostPipeServer.ts';

/** `require` for this ESM module. Unlike broker/win32Api.ts (which sits OUTSIDE `dashboard/` and must
 *  anchor at `../dashboard/package.json`), this file lives INSIDE `dashboard/`, so a plain
 *  `createRequire(import.meta.url)` resolves koffi from `dashboard/node_modules` under both vitest and
 *  `node …/hostMain.ts`. koffi is a CommonJS native addon, loaded lazily on first `loadWin32PtyApi`. */
const nodeRequire = createRequire(import.meta.url);

type KoffiFn = (...args: unknown[]) => unknown;
interface KoffiLib {
  load(dll: string): { func(convention: string, name: string, ret: string, args: unknown[]): KoffiFn };
  struct(name: string, fields: Record<string, string>): unknown;
  alloc(type: unknown, count: number): Buffer;
  decode(buf: unknown, offsetOrType: unknown, type?: unknown, length?: unknown): unknown;
  encode(buf: unknown, type: unknown, value: unknown, count?: number): void;
  address(ptr: unknown): number | bigint;
  sizeof(type: unknown): number;
  view(ptr: unknown, len: number): Uint8Array;
}

/* ── Win32 constants ─────────────────────────────────────────────────────────────────────────────── */
const PIPE_ACCESS_DUPLEX = 0x00000003;
const FILE_FLAG_FIRST_PIPE_INSTANCE = 0x00080000;
const FILE_FLAG_OVERLAPPED = 0x40000000;
const PIPE_TYPE_BYTE = 0x0;
const PIPE_READMODE_BYTE = 0x0;
const PIPE_WAIT = 0x0;
const PIPE_REJECT_REMOTE_CLIENTS = 0x8;
const PIPE_UNLIMITED_INSTANCES = 255;
const PIPE_BUFFER_BYTES = 65536;
const TOKEN_QUERY = 0x0008;
const TOKEN_USER_CLASS = 1;
const SDDL_REVISION_1 = 1;
const INVALID_HANDLE = 0xffffffffffffffffn;
const ERROR_IO_PENDING = 997;
const ERROR_IO_INCOMPLETE = 996;
const ERROR_PIPE_CONNECTED = 535;
const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const OPEN_EXISTING = 3;
const CREATE_ALWAYS = 2;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
const SE_FILE_OBJECT = 1;
const SE_KERNEL_OBJECT = 6;
const OWNER_SECURITY_INFORMATION = 0x00000001;
const DACL_SECURITY_INFORMATION = 0x00000004;
const LABEL_SECURITY_INFORMATION = 0x00000010;
const WAIT_OBJECT_0 = 0x0;
// SECURITY_QUALITY_OF_SERVICE flags OR'd into CreateFileW's dwFlagsAndAttributes for the CLIENT pipe open.
// SECURITY_SQOS_PRESENT says "an impersonation level is specified"; SECURITY_IDENTIFICATION caps the server
// (the kb-fleet host) at IDENTIFICATION level — it may query the client's token (SID) but can NOT impersonate
// Daniel to act as him. Together = 0x00110000. (FIX 1, D3.1 adversarial review — least authority to the host.)
const SECURITY_SQOS_PRESENT = 0x00100000;
const SECURITY_IDENTIFICATION = 0x00010000;

const POLL_MS = 5;
const READ_CHUNK = 65536;

/** A live connection: a pipe handle + SEPARATE read/write OVERLAPPED+event pairs (full duplex), a frame
 *  parser, and a serialized write chain. Opaque to hostPipeServer.ts. */
interface Conn {
  h: unknown;
  readEv: unknown;
  readOv: Buffer;
  writeEv: unknown;
  writeOv: Buffer;
  parser: FrameParser;
  writeChain: Promise<void>;
  closed: boolean;
}

let cached: Win32PtyApi | null = null;

/** The full native surface. */
export interface Win32PtyApi {
  /** The current process's own SID string (from its token), or null if unresolved. */
  currentSidString(): string | null;
  /** SecureTokenFileWriter: write `token` to `path` under the cross-user token-file SD, reparse-safe, then
   *  read the DACL+label back and verify the {owner, reader, SYSTEM}+Medium allowlist. False on ANY failure. */
  writeAndVerify(path: string, token: string, sids: { ownerSid: string; readerSid: string }): boolean;
  /** Build the SERVER transport + peer FFI, with the pipe SA bound to {ownerSid (kb-fleet), peerSid (Daniel)}. */
  makeHostTransport(sids: { ownerSid: string; peerSid: string }): { transport: PtyPipeTransport; peerFfi: PtyPeerFfi };
  /** CLIENT: connect the pipe and verify the server's SID == `expectedServerSid` BEFORE any byte is written.
   *  Returns a duplex channel, or null on connect failure / SID mismatch (anti-squat, fail closed). */
  connectAndVerifyServer(pipeName: string, expectedServerSid: string): PtyClientChannel | null;
}

/**
 * Load (once) and return the real koffi-backed PTY API. Memoized — koffi.load + fn binds are done once.
 */
export function loadWin32PtyApi(): Win32PtyApi {
  if (cached) return cached;
  const koffi = nodeRequire('koffi') as KoffiLib;
  const HANDLE = 'void *';
  const k32 = koffi.load('kernel32.dll');
  const adv = koffi.load('advapi32.dll');

  const CreateNamedPipeW = k32.func('__stdcall', 'CreateNamedPipeW', HANDLE,
    ['str16', 'uint32', 'uint32', 'uint32', 'uint32', 'uint32', 'uint32', 'void *']);
  const CreateEventW = k32.func('__stdcall', 'CreateEventW', HANDLE, ['void *', 'int', 'int', 'void *']);
  const ConnectNamedPipe = k32.func('__stdcall', 'ConnectNamedPipe', 'bool', [HANDLE, 'void *']);
  const ReadFile = k32.func('__stdcall', 'ReadFile', 'bool', [HANDLE, 'void *', 'uint32', 'uint32 *', 'void *']);
  const WriteFile = k32.func('__stdcall', 'WriteFile', 'bool', [HANDLE, 'void *', 'uint32', 'uint32 *', 'void *']);
  // Win32 BOOL is a 4-byte int; koffi `bool` is 1 byte. bWait INPUT must be `int` (0/1) or 3 high bytes are
  // indeterminate → GetOverlappedResult may read TRUE and block (Broker note).
  const GetOverlappedResult = k32.func('__stdcall', 'GetOverlappedResult', 'bool', [HANDLE, 'void *', 'uint32 *', 'int']);
  const ResetEvent = k32.func('__stdcall', 'ResetEvent', 'bool', [HANDLE]);
  const CancelIoEx = k32.func('__stdcall', 'CancelIoEx', 'bool', [HANDLE, 'void *']);
  const DisconnectNamedPipe = k32.func('__stdcall', 'DisconnectNamedPipe', 'bool', [HANDLE]);
  const WaitForSingleObject = k32.func('__stdcall', 'WaitForSingleObject', 'uint32', [HANDLE, 'uint32']);
  const GetNamedPipeClientProcessId = k32.func('__stdcall', 'GetNamedPipeClientProcessId', 'bool', [HANDLE, 'uint32 *']);
  const GetCurrentProcess = k32.func('__stdcall', 'GetCurrentProcess', HANDLE, []);
  const GetCurrentThread = k32.func('__stdcall', 'GetCurrentThread', HANDLE, []);
  const CloseHandle = k32.func('__stdcall', 'CloseHandle', 'bool', [HANDLE]);
  const GetLastError = k32.func('__stdcall', 'GetLastError', 'uint32', []);
  const CreateFileW = k32.func('__stdcall', 'CreateFileW', HANDLE,
    ['str16', 'uint32', 'uint32', 'void *', 'uint32', 'uint32', HANDLE]);
  const LocalFree = k32.func('__stdcall', 'LocalFree', HANDLE, [HANDLE]);
  const OpenProcessToken = adv.func('__stdcall', 'OpenProcessToken', 'bool', [HANDLE, 'uint32', 'void *']);
  const OpenThreadToken = adv.func('__stdcall', 'OpenThreadToken', 'bool', [HANDLE, 'uint32', 'int', 'void *']);
  const ImpersonateNamedPipeClient = adv.func('__stdcall', 'ImpersonateNamedPipeClient', 'bool', [HANDLE]);
  const RevertToSelf = adv.func('__stdcall', 'RevertToSelf', 'bool', []);
  const GetTokenInformation = adv.func('__stdcall', 'GetTokenInformation', 'bool', [HANDLE, 'int', 'void *', 'uint32', 'uint32 *']);
  const ConvertStringSecurityDescriptorToSecurityDescriptorW = adv.func('__stdcall',
    'ConvertStringSecurityDescriptorToSecurityDescriptorW', 'bool', ['str16', 'uint32', 'void *', 'void *']);
  const GetNamedSecurityInfoW = adv.func('__stdcall', 'GetNamedSecurityInfoW', 'uint32',
    ['str16', 'int', 'uint32', 'void *', 'void *', 'void *', 'void *', 'void *']);
  const GetSecurityInfo = adv.func('__stdcall', 'GetSecurityInfo', 'uint32',
    [HANDLE, 'int', 'uint32', 'void *', 'void *', 'void *', 'void *', 'void *']);
  const ConvertSecurityDescriptorToStringSecurityDescriptorW = adv.func('__stdcall',
    'ConvertSecurityDescriptorToStringSecurityDescriptorW', 'bool',
    ['void *', 'uint32', 'uint32', 'void *', 'uint32 *']);

  const SECURITY_ATTRIBUTES = koffi.struct('SECURITY_ATTRIBUTES', {
    nLength: 'uint32',
    lpSecurityDescriptor: HANDLE,
    bInheritHandle: 'int',
  });
  const OVERLAPPED = koffi.struct('OVERLAPPED', {
    Internal: 'uint64',
    InternalHigh: 'uint64',
    Offset: 'uint32',
    OffsetHigh: 'uint32',
    hEvent: HANDLE,
  });

  const lastErr = (): number => Number(GetLastError());
  const addrOf = (h: unknown): bigint => {
    try {
      return BigInt(koffi.address(h));
    } catch {
      return 0n;
    }
  };
  const badHandle = (h: unknown): boolean => {
    const a = addrOf(h);
    return a === 0n || a === INVALID_HANDLE;
  };

  /** TokenUser SID bytes from an open access token, or null. Parses no strings (crash-proof). */
  function sidBytesFromToken(hToken: unknown): Uint8Array | null {
    const lenBuf = koffi.alloc('uint32', 1);
    GetTokenInformation(hToken, TOKEN_USER_CLASS, null, 0, lenBuf);
    const len = koffi.decode(lenBuf, 'uint32') as number;
    if (len === 0 || len > 4096) return null;
    const info = koffi.alloc('uint8', len);
    if (!GetTokenInformation(hToken, TOKEN_USER_CLASS, info, len, lenBuf)) return null;
    const psid = addrOf(koffi.decode(info, HANDLE));
    const base = addrOf(info);
    const off = Number(psid - base);
    if (!Number.isFinite(off) || off < 0 || off >= len) return null;
    const bytes = koffi.decode(info, off, 'uint8', len - off) as ArrayLike<number>;
    return Uint8Array.from(bytes);
  }

  function sidBytesForProcessHandle(hProc: unknown): Uint8Array | null {
    const tokBuf = koffi.alloc(HANDLE, 1);
    if (!OpenProcessToken(hProc, TOKEN_QUERY, tokBuf)) return null;
    const hToken = koffi.decode(tokBuf, HANDLE);
    try {
      return sidBytesFromToken(hToken);
    } finally {
      CloseHandle(hToken);
    }
  }

  const ownSid = ((): string | null => {
    const bytes = sidBytesForProcessHandle(GetCurrentProcess());
    if (!bytes) return null;
    try {
      return parseSidString(bytes);
    } catch {
      return null;
    }
  })();

  /** Build a SECURITY_ATTRIBUTES buffer for an SDDL string (LocalAlloc'd SD kept alive by the returned
   *  buffer's closure; freed by the caller after CreateFile/CreateNamedPipe consumes it). Returns
   *  {sa, pSD} or null. */
  function buildSecurityAttributes(sddl: string): { sa: Buffer; pSD: unknown } | null {
    try {
      const sdOut = koffi.alloc(HANDLE, 1);
      if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, sdOut, null)) return null;
      const pSD = koffi.decode(sdOut, HANDLE);
      const sa = koffi.alloc(SECURITY_ATTRIBUTES, 1);
      koffi.encode(sa, SECURITY_ATTRIBUTES, {
        nLength: koffi.sizeof(SECURITY_ATTRIBUTES),
        lpSecurityDescriptor: pSD,
        bInheritHandle: 0,
      });
      return { sa, pSD };
    } catch {
      return null;
    }
  }

  function sddlFromSecurityDescriptor(pSD: unknown, secInfo: number): string | null {
    const strBuf = koffi.alloc(HANDLE, 1);
    const lenBuf = koffi.alloc('uint32', 1);
    let strPtr: unknown = null;
    try {
      if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(pSD, SDDL_REVISION_1, secInfo, strBuf, lenBuf)) return null;
      strPtr = koffi.decode(strBuf, HANDLE);
      const charLen = koffi.decode(lenBuf, 'uint32') as number;
      if (!charLen || charLen > 8192) return null;
      return Buffer.from(koffi.view(strPtr, charLen * 2)).toString('utf16le').replace(/\0[\s\S]*$/, '').trim();
    } finally {
      if (strPtr != null) {
        try {
          LocalFree(strPtr);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /* ── overlapped duplex helpers ───────────────────────────────────────────────────────────────────── */

  function prep(ov: Buffer, ev: unknown): void {
    ResetEvent(ev);
    koffi.encode(ov, OVERLAPPED, { Internal: 0n, InternalHigh: 0n, Offset: 0, OffsetHigh: 0, hEvent: ev });
  }

  /** Poll GetOverlappedResult on the main loop until the op completes / closes / errors. */
  function pollOverlapped(conn: Conn, ov: Buffer): Promise<{ ok: boolean; n: number }> {
    return new Promise((resolve) => {
      const check = (): void => {
        if (conn.closed) return resolve({ ok: false, n: 0 });
        const nBuf = koffi.alloc('uint32', 1);
        if (GetOverlappedResult(conn.h, ov, nBuf, 0)) {
          return resolve({ ok: true, n: koffi.decode(nBuf, 'uint32') as number });
        }
        if (lastErr() === ERROR_IO_INCOMPLETE) {
          setTimeout(check, POLL_MS);
          return;
        }
        resolve({ ok: false, n: 0 });
      };
      check();
    });
  }

  /** Async overlapped read of up to READ_CHUNK bytes. null on EOF/error/close. */
  async function readAsync(conn: Conn): Promise<Buffer | null> {
    if (conn.closed) return null;
    prep(conn.readOv, conn.readEv);
    const buf = Buffer.allocUnsafe(READ_CHUNK);
    const rn = koffi.alloc('uint32', 1);
    const ok = ReadFile(conn.h, buf, READ_CHUNK, rn, conn.readOv);
    if (ok) {
      const n = koffi.decode(rn, 'uint32') as number;
      return n > 0 ? Buffer.from(buf.subarray(0, n)) : null;
    }
    if (lastErr() !== ERROR_IO_PENDING) return null;
    const res = await pollOverlapped(conn, conn.readOv);
    if (!res.ok || res.n === 0) return null;
    return Buffer.from(buf.subarray(0, res.n));
  }

  /** Synchronous (blocking, bounded) overlapped read — used ONLY by the client open handshake. Because in
   *  production the host is a SEPARATE process, blocking this process's loop briefly does not deadlock. */
  function readBlocking(conn: Conn, timeoutMs: number): Buffer | null {
    if (conn.closed) return null;
    prep(conn.readOv, conn.readEv);
    const buf = Buffer.allocUnsafe(READ_CHUNK);
    const rn = koffi.alloc('uint32', 1);
    const ok = ReadFile(conn.h, buf, READ_CHUNK, rn, conn.readOv);
    if (ok) {
      const n = koffi.decode(rn, 'uint32') as number;
      return n > 0 ? Buffer.from(buf.subarray(0, n)) : null;
    }
    if (lastErr() !== ERROR_IO_PENDING) return null;
    const w = Number(WaitForSingleObject(conn.readEv, timeoutMs));
    if (w !== WAIT_OBJECT_0) {
      try {
        CancelIoEx(conn.h, conn.readOv);
      } catch {
        /* ignore */
      }
      return null;
    }
    if (!GetOverlappedResult(conn.h, conn.readOv, rn, 1)) return null;
    const n = koffi.decode(rn, 'uint32') as number;
    return n > 0 ? Buffer.from(buf.subarray(0, n)) : null;
  }

  /** Synchronous (blocking, bounded) overlapped write — used ONLY by the client open handshake. */
  function writeBlocking(conn: Conn, bytes: Buffer, timeoutMs: number): boolean {
    if (conn.closed) return false;
    prep(conn.writeOv, conn.writeEv);
    const wn = koffi.alloc('uint32', 1);
    const ok = WriteFile(conn.h, bytes, bytes.length, wn, conn.writeOv);
    if (ok) return (koffi.decode(wn, 'uint32') as number) === bytes.length;
    if (lastErr() !== ERROR_IO_PENDING) return false;
    const w = Number(WaitForSingleObject(conn.writeEv, timeoutMs));
    if (w !== WAIT_OBJECT_0) {
      try {
        CancelIoEx(conn.h, conn.writeOv);
      } catch {
        /* ignore */
      }
      return false;
    }
    if (!GetOverlappedResult(conn.h, conn.writeOv, wn, 1)) return false;
    return (koffi.decode(wn, 'uint32') as number) === bytes.length;
  }

  /** Async overlapped write of the whole buffer. false on failure. */
  async function writeAsync(conn: Conn, bytes: Buffer): Promise<boolean> {
    if (conn.closed) return false;
    prep(conn.writeOv, conn.writeEv);
    const wn = koffi.alloc('uint32', 1);
    const ok = WriteFile(conn.h, bytes, bytes.length, wn, conn.writeOv);
    if (ok) return (koffi.decode(wn, 'uint32') as number) === bytes.length;
    if (lastErr() !== ERROR_IO_PENDING) return false;
    const res = await pollOverlapped(conn, conn.writeOv);
    return res.ok && res.n === bytes.length;
  }

  function closeConn(conn: Conn): void {
    if (conn.closed) return;
    conn.closed = true;
    try {
      CancelIoEx(conn.h, null);
    } catch {
      /* ignore */
    }
    try {
      DisconnectNamedPipe(conn.h); // server-only; harmless no-op error on a client handle
    } catch {
      /* ignore */
    }
    for (const h of [conn.h, conn.readEv, conn.writeEv]) {
      try {
        CloseHandle(h);
      } catch {
        /* ignore */
      }
    }
  }

  /** Allocate the read/write OVERLAPPED+event pair for a fresh connection. Returns null on event failure. */
  function makeConn(h: unknown): Conn | null {
    const readEv = CreateEventW(null, 1, 0, null);
    if (badHandle(readEv)) return null;
    const writeEv = CreateEventW(null, 1, 0, null);
    if (badHandle(writeEv)) {
      try {
        CloseHandle(readEv);
      } catch {
        /* ignore */
      }
      return null;
    }
    return {
      h,
      readEv,
      readOv: koffi.alloc(OVERLAPPED, 1),
      writeEv,
      writeOv: koffi.alloc(OVERLAPPED, 1),
      parser: new FrameParser(),
      writeChain: Promise.resolve(),
      closed: false,
    };
  }

  /** Serialize an async write; on failure, close the connection (best-effort). */
  function enqueueWrite(conn: Conn, frame: ControlFrame): void {
    const bytes = Buffer.from(encodeFrame(frame), 'utf-8');
    conn.writeChain = conn.writeChain
      .then(async () => {
        const ok = await writeAsync(conn, bytes);
        if (!ok) closeConn(conn);
      })
      .catch(() => closeConn(conn));
  }

  /* ── channels ────────────────────────────────────────────────────────────────────────────────────── */

  function makeServerChannel(conn: Conn): PtyServerChannel {
    const queue: InboundFrame[] = [];
    let frameCb: ((f: InboundFrame) => void) | null = null;
    let closeCb: (() => void) | null = null;
    let waiter: ((f: InboundFrame | null) => void) | null = null;
    let waiterTimer: ReturnType<typeof setTimeout> | null = null;
    let closedFired = false;

    const fireClose = (): void => {
      if (closedFired) return;
      closedFired = true;
      if (waiter) {
        const w = waiter;
        waiter = null;
        if (waiterTimer) clearTimeout(waiterTimer);
        w(null);
      }
      closeCb?.();
    };
    const deliver = (f: InboundFrame): void => {
      if (frameCb) return frameCb(f);
      if (waiter) {
        const w = waiter;
        waiter = null;
        if (waiterTimer) clearTimeout(waiterTimer);
        return w(f);
      }
      queue.push(f);
    };

    void (async (): Promise<void> => {
      for (;;) {
        const chunk = await readAsync(conn);
        if (chunk === null) {
          closeConn(conn);
          fireClose();
          return;
        }
        let frames: InboundFrame[];
        try {
          frames = conn.parser.push(chunk.toString('utf-8'));
        } catch {
          closeConn(conn);
          fireClose();
          return;
        }
        for (const f of frames) {
          try {
            deliver(f);
          } catch {
            // FIX 3 — a per-frame handler throw closes ONLY this connection; an unguarded throw here escapes
            // the void IIFE as an unhandledRejection and would take down the whole host process.
            closeConn(conn);
            fireClose();
            return;
          }
        }
      }
    })();

    return {
      nextFrame: (timeoutMs) =>
        new Promise((resolve) => {
          if (queue.length) return resolve(queue.shift() as InboundFrame);
          if (conn.closed || closedFired) return resolve(null);
          waiter = resolve;
          waiterTimer = setTimeout(() => {
            if (waiter === resolve) {
              waiter = null;
              resolve(null);
            }
          }, timeoutMs);
        }),
      sendFrame: (frame) => {
        if (conn.closed) return false;
        enqueueWrite(conn, frame);
        return true;
      },
      onFrame: (cb) => {
        frameCb = cb;
        while (queue.length) cb(queue.shift() as InboundFrame);
      },
      onClose: (cb) => {
        closeCb = cb;
        if (closedFired) cb();
      },
      close: () => {
        closeConn(conn);
        fireClose();
      },
    };
  }

  function makeClientChannel(conn: Conn): PtyClientChannel {
    const queue: InboundFrame[] = [];
    let frameCb: ((f: InboundFrame) => void) | null = null;
    let closeCb: (() => void) | null = null;
    let pumpStarted = false;
    let closedFired = false;

    const fireClose = (): void => {
      if (closedFired) return;
      closedFired = true;
      closeCb?.();
    };

    const startPump = (): void => {
      if (pumpStarted) return;
      pumpStarted = true;
      void (async (): Promise<void> => {
        for (;;) {
          const chunk = await readAsync(conn);
          if (chunk === null) {
            closeConn(conn);
            fireClose();
            return;
          }
          let frames: InboundFrame[];
          try {
            frames = conn.parser.push(chunk.toString('utf-8'));
          } catch {
            closeConn(conn);
            fireClose();
            return;
          }
          for (const f of frames) {
            try {
              if (frameCb) frameCb(f);
              else queue.push(f);
            } catch {
              // FIX 3 — a per-frame handler throw tears down ONLY this connection, never the host process.
              closeConn(conn);
              fireClose();
              return;
            }
          }
        }
      })();
    };

    /** Blocking read of one queued/next inbound frame within `deadline` (null on timeout/EOF/parse fault).
     *  Shared by `receiveFrame` (D3.1 two-phase: receive the host `challenge`) and `requestSync`. */
    const drainOneFrame = (deadline: number): InboundFrame | null => {
      while (queue.length === 0) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        const chunk = readBlocking(conn, remaining);
        if (chunk === null) return null;
        let frames: InboundFrame[];
        try {
          frames = conn.parser.push(chunk.toString('utf-8'));
        } catch {
          return null;
        }
        for (const f of frames) queue.push(f);
      }
      return queue.shift() as InboundFrame;
    };

    return {
      receiveFrame: (timeoutMs) => drainOneFrame(Date.now() + timeoutMs),
      requestSync: (frame, timeoutMs) => {
        const deadline = Date.now() + timeoutMs;
        if (!writeBlocking(conn, Buffer.from(encodeFrame(frame), 'utf-8'), timeoutMs)) return null;
        return drainOneFrame(deadline);
      },
      sendFrame: (frame) => {
        if (conn.closed) return false;
        enqueueWrite(conn, frame);
        return true;
      },
      onFrame: (cb) => {
        frameCb = cb;
        while (queue.length) cb(queue.shift() as InboundFrame);
        startPump();
      },
      onClose: (cb) => {
        closeCb = cb;
        if (closedFired) cb();
      },
      close: () => {
        closeConn(conn);
        fireClose();
      },
    };
  }

  cached = {
    currentSidString: () => ownSid,

    writeAndVerify: (filePath: string, data: string, sids: { ownerSid: string; readerSid: string }): boolean => {
      try {
        const sddl = buildTokenFileSddl(sids);
        const built = buildSecurityAttributes(sddl);
        if (!built) return false;
        // CREATE_ALWAYS + explicit SD → the file's DACL/label are exactly `sddl` (not inherited).
        // FILE_FLAG_OPEN_REPARSE_POINT (F7) → a race-planted junction is not followed.
        const h = CreateFileW(
          filePath, GENERIC_WRITE, 0, built.sa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, null,
        );
        try {
          LocalFree(built.pSD);
        } catch {
          /* ignore */
        }
        if (badHandle(h)) return false;
        let wrote = false;
        try {
          const bytes = Buffer.from(data, 'utf-8');
          const wn = koffi.alloc('uint32', 1);
          wrote = Boolean(WriteFile(h, bytes, bytes.length, wn, null)) && (koffi.decode(wn, 'uint32') as number) === bytes.length;
        } finally {
          CloseHandle(h);
        }
        if (!wrote) return false;
        // READ-BACK ALLOWLIST VERIFY: DACL grants ONLY {owner, reader, SYSTEM} + a Medium label.
        const sd2 = koffi.alloc(HANDLE, 1);
        const secInfo = DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION;
        if ((GetNamedSecurityInfoW(filePath, SE_FILE_OBJECT, secInfo, null, null, null, null, sd2) as number) !== 0) return false;
        const pSD2 = koffi.decode(sd2, HANDLE);
        try {
          const rb = sddlFromSecurityDescriptor(pSD2, secInfo);
          return rb != null && tokenFileSddlVerified(rb, sids);
        } finally {
          try {
            LocalFree(pSD2);
          } catch {
            /* ignore */
          }
        }
      } catch {
        return false;
      }
    },

    makeHostTransport: (sids: { ownerSid: string; peerSid: string }) => {
      // Build the cross-user pipe SA ONCE (bound to {ownerSid, peerSid}). null → createPipe fails closed.
      const built = buildSecurityAttributes(buildPipeSddl(sids));

      const transport: PtyPipeTransport = {
        createPipe: (name: string, firstInstance: boolean): PipeHandle | null => {
          let h: unknown = null;
          try {
            // M-1: fail closed if the SA could not be built — never the default (any-user) pipe DACL.
            if (!built) return null;
            let openMode = PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED;
            if (firstInstance) openMode |= FILE_FLAG_FIRST_PIPE_INSTANCE;
            const pipeMode = PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS;
            h = CreateNamedPipeW(name, openMode, pipeMode, PIPE_UNLIMITED_INSTANCES, PIPE_BUFFER_BYTES, PIPE_BUFFER_BYTES, 0, built.sa);
            if (badHandle(h)) return null;
            // LOW-1: read the pipe SD back and assert the Medium label actually took, else fail closed.
            const sd = koffi.alloc(HANDLE, 1);
            const secInfo = DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION;
            if ((GetSecurityInfo(h, SE_KERNEL_OBJECT, secInfo, null, null, null, null, sd) as number) !== 0) {
              CloseHandle(h);
              return null;
            }
            const pSD = koffi.decode(sd, HANDLE);
            let labelOk = false;
            try {
              const rb = sddlFromSecurityDescriptor(pSD, secInfo);
              labelOk = rb != null && sddlHasMediumLabel(rb);
            } finally {
              try {
                LocalFree(pSD);
              } catch {
                /* ignore */
              }
            }
            if (!labelOk) {
              CloseHandle(h);
              return null;
            }
            const conn = makeConn(h);
            if (!conn) {
              CloseHandle(h);
              return null;
            }
            return conn as PipeHandle;
          } catch {
            if (h && !badHandle(h)) {
              try {
                CloseHandle(h);
              } catch {
                /* ignore */
              }
            }
            return null;
          }
        },

        accept: async (handle: PipeHandle): Promise<void> => {
          const conn = handle as Conn;
          prep(conn.readOv, conn.readEv);
          const r = ConnectNamedPipe(conn.h, conn.readOv);
          if (r) return;
          const le = lastErr();
          if (le === ERROR_PIPE_CONNECTED) return;
          if (le !== ERROR_IO_PENDING) throw new Error(`ConnectNamedPipe failed err=${le}`);
          const res = await pollOverlapped(conn, conn.readOv);
          if (!res.ok) throw new Error('accept did not complete (closed/cancelled)');
        },

        channel: (handle: PipeHandle): PtyServerChannel => makeServerChannel(handle as Conn),
        closeConnection: (handle: PipeHandle): void => closeConn(handle as Conn),
      };

      const peerFfi: PtyPeerFfi = {
        // TOCTOU-free peer read via impersonation; RevertToSelf ALWAYS runs; a failed revert hard-exits.
        getClientSidBytes: (handle: PipeHandle): Uint8Array | null => {
          const conn = handle as Conn;
          let impersonating = false;
          try {
            if (!ImpersonateNamedPipeClient(conn.h)) return null;
            impersonating = true;
            const tokBuf = koffi.alloc(HANDLE, 1);
            if (!OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, tokBuf)) return null;
            const hToken = koffi.decode(tokBuf, HANDLE);
            try {
              return sidBytesFromToken(hToken);
            } finally {
              CloseHandle(hToken);
            }
          } catch {
            return null;
          } finally {
            if (impersonating && !RevertToSelf()) {
              process.stderr.write('[kb-pty-host] FATAL: RevertToSelf failed; exiting to avoid a leaked impersonation\n');
              process.exit(70);
            }
          }
        },
        getClientPid: (handle: PipeHandle): number | null => {
          try {
            const conn = handle as Conn;
            const pidBuf = koffi.alloc('uint32', 1);
            if (!GetNamedPipeClientProcessId(conn.h, pidBuf)) return null;
            const pid = koffi.decode(pidBuf, 'uint32') as number;
            return pid > 0 ? pid : null;
          } catch {
            return null;
          }
        },
      };

      return { transport, peerFfi };
    },

    connectAndVerifyServer: (pipeName: string, expectedServerSid: string): PtyClientChannel | null => {
      let h: unknown = null;
      try {
        // FIX 1 — connect at SECURITY_IDENTIFICATION (SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION =
        // 0x00110000), so the kb-fleet host can only IDENTIFY this client (its OpenThreadToken(TOKEN_QUERY) +
        // GetTokenInformation(TokenUser) SID check still works) but can NOT impersonate Daniel to act as him.
        h = CreateFileW(
          pipeName, GENERIC_READ | GENERIC_WRITE, 0, null, OPEN_EXISTING,
          FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, null,
        );
        if (badHandle(h)) return null;
        // FIX 2 — ANTI-SQUAT (design Point 4): verify the pipe's OWNER SID == kb-fleet BEFORE writing a single
        // byte. We read the OWNER from the connected pipe handle itself (READ_CONTROL is implied by
        // FILE_GENERIC_READ), NOT the server PROCESS token: OpenProcess against the kb-fleet daemon is
        // ACCESS_DENIED from a non-admin Medium daemon (cross-user), so a process-token check fails legitimately.
        // The pipe owner is stamped deterministically to the kb-fleet USER sid by buildPipeSddl's `O:` component.
        let serverSid: string | null = null;
        const sdOut = koffi.alloc(HANDLE, 1);
        if ((GetSecurityInfo(h, SE_KERNEL_OBJECT, OWNER_SECURITY_INFORMATION, null, null, null, null, sdOut) as number) !== 0) {
          CloseHandle(h);
          return null;
        }
        const pSD = koffi.decode(sdOut, HANDLE);
        try {
          const ownerSddl = sddlFromSecurityDescriptor(pSD, OWNER_SECURITY_INFORMATION);
          serverSid = ownerSddl != null ? ownerSidFromSddl(ownerSddl) : null;
        } finally {
          try {
            LocalFree(pSD);
          } catch {
            /* ignore */
          }
        }
        if (!serverSid || serverSid !== expectedServerSid) {
          CloseHandle(h);
          return null;
        }
        const conn = makeConn(h);
        if (!conn) {
          CloseHandle(h);
          return null;
        }
        h = null; // ownership transferred to conn
        return makeClientChannel(conn);
      } catch {
        if (h && !badHandle(h)) {
          try {
            CloseHandle(h);
          } catch {
            /* ignore */
          }
        }
        return null;
      }
    },
  };
  return cached;
}
