/**
 * D3.6 (Option B) — the REAL koffi FFI backing for the Windows pipe transport + peer credential.
 *
 * This module is the ONLY place that touches koffi / the Win32 API; broker/win32PipeServer.ts consumes it
 * through the injected `Win32PeerFfi` + `Win32PipeTransport` interfaces (so the orchestration is hermetic
 * and this native surface is integration-tested on a real box). koffi is loaded LAZILY (first use), so a
 * bare `import` of this module never pulls in koffi — only actually starting the win32 transport does.
 *
 * ── I/O MODEL: OVERLAPPED (async) I/O POLLED ON THE MAIN LOOP — NOT the libuv threadpool ─────────────
 * The pipe is opened with FILE_FLAG_OVERLAPPED. `ConnectNamedPipe`/`ReadFile` return immediately with
 * ERROR_IO_PENDING; completion is detected by polling `GetOverlappedResult(…, bWait=FALSE)` on a
 * `setTimeout` tick. NOTHING blocks a worker thread — a blocking `ConnectNamedPipe` on the libuv
 * threadpool would (a) hold a pool thread for the entire idle wait and (b) be unsafe to cancel on
 * shutdown (closing a handle mid-blocking-call from another thread is racy). Overlapped + `CancelIoEx`
 * gives clean, deterministic teardown and keeps the daemon's main event loop fully responsive. All
 * `GetLastError()` reads happen on the MAIN thread immediately after the sync call that set them, so the
 * thread-local semantics are correct.
 *
 * ── TWO ENFORCED CROSS-USER CONTROLS (both mandatory) ───────────────────────────────────────────────
 *   1. LOAD-BEARING: a per-connection peer SID check via IMPERSONATION —
 *      ImpersonateNamedPipeClient → OpenThreadToken → GetTokenInformation(TokenUser) → SID, compared to
 *      the daemon's own process SID. This reads the pipe's ACTUAL client token at check time, so it is
 *      TOCTOU-free (no GetNamedPipeClientProcessId→OpenProcess PID-recycle race).
 *   2. DEFENSE-IN-DEPTH: an owner-only SDDL security descriptor on the pipe (only the daemon SID + SYSTEM
 *      may connect). It is MANDATORY too — `createPipe` fails closed if the SA cannot be built (M-1) — so
 *      a null/default DACL is never used; the SID check is what the security argument rests on.
 *
 * VERIFIED EMPIRICALLY on Node 24.18.0 win32-x64 (koffi 3.1.1, prebuilt binary):
 *   • CreateNamedPipeW(FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED | PIPE_REJECT_REMOTE_CLIENTS)
 *     with the owner-only SDDL SA.
 *   • overlapped ConnectNamedPipe/ReadFile/WriteFile polled on the main loop (heartbeat never stalls).
 *   • ImpersonateNamedPipeClient → OpenThreadToken(OpenAsSelf) → GetTokenInformation(TokenUser) → SID
 *     bytes parsed by broker/win32Sid.ts (crash-proof; NOT ConvertSidToStringSidW, whose returned
 *     wide-string pointer segfaults koffi.decode). RevertToSelf ALWAYS runs (synchronous window only).
 *   • response delivery is confirmed by a final overlapped "drain" read that completes with
 *     ERROR_BROKEN_PIPE once the client has read the response and closed (replaces FlushFileBuffers).
 *
 * KNOWN TRADE-OFF: an idle accept polls every `POLL_MS`. For a low-traffic control socket this CPU cost
 * is negligible; a future optimization could register the OVERLAPPED event with a wait instead of polling.
 */
import { createRequire } from 'node:module';
import { parseSidString } from './win32Sid.ts';
import type { PipeHandle, Win32PeerFfi, Win32PipeTransport } from './win32PipeServer.ts';

/** `require` for this ESM module, ANCHORED at the sibling `dashboard/` package (where koffi is installed:
 *  `broker/` has no node_modules of its own and joins the dashboard workspace — see dashboard/tsconfig.json
 *  + vitest.config.ts). Anchoring at `../dashboard/package.json` makes koffi resolve identically under
 *  vitest and in production (`node broker/index.ts`), independent of cwd. koffi is a CommonJS native addon. */
const nodeRequire = createRequire(new URL('../dashboard/package.json', import.meta.url));

/** A koffi-bound native function (directly callable). */
type KoffiFn = (...args: unknown[]) => unknown;
/** The minimal koffi surface this module uses (typed locally so we don't couple to koffi's own d.ts). */
interface KoffiLib {
  load(dll: string): { func(convention: string, name: string, ret: string, args: unknown[]): KoffiFn };
  struct(name: string, fields: Record<string, string>): unknown;
  alloc(type: unknown, count: number): Buffer;
  decode(buf: unknown, offsetOrType: unknown, type?: unknown, length?: unknown): unknown;
  encode(buf: unknown, type: unknown, value: unknown, count?: number): void;
  address(ptr: unknown): number | bigint;
  sizeof(type: unknown): number;
  out(type: unknown): unknown;
  pointer(type: unknown): unknown;
}

/** The full native surface: peer-credential + pipe transport + the daemon's own SID (for expectedOwnerId). */
export interface Win32Api extends Win32PeerFfi, Win32PipeTransport {
  /** The daemon's own SID string (from GetCurrentProcess's token), or null if unresolved. */
  currentSidString(): string | null;
  /** Write `data` to `path` with an explicit owner-only DACL (daemon SID + SYSTEM), then read the DACL
   *  back and VERIFY it grants no broad trustee. Returns false on any failure (→ caller unlinks + fails
   *  closed). The win32 analogue of the POSIX 0600 + stat-verify token file (L-2). */
  writeOwnerOnlyFile(path: string, data: string): boolean;
}

/** Production per-connection handle: a pipe instance handle + its OVERLAPPED event and buffer. Opaque to
 *  broker/win32PipeServer.ts (which passes it back through the transport/peer methods). */
interface Conn {
  h: unknown;
  ev: unknown;
  ov: Buffer;
  closed: boolean;
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
const PIPE_BUFFER_BYTES = 8192;
const TOKEN_QUERY = 0x0008;
const TOKEN_USER_CLASS = 1;
const SDDL_REVISION_1 = 1;
const INVALID_HANDLE = 0xffffffffffffffffn;
const ERROR_IO_PENDING = 997;
const ERROR_IO_INCOMPLETE = 996;
const ERROR_PIPE_CONNECTED = 535;
// Token-file DACL (L-2).
const GENERIC_WRITE = 0x40000000;
const CREATE_ALWAYS = 2;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const SE_FILE_OBJECT = 1;
const DACL_SECURITY_INFORMATION = 0x00000004;
/** SDDL substrings for broad trustees a token file must NOT grant (Everyone, Authenticated Users, Users…). */
const BROAD_TRUSTEES = ['S-1-1-0', ';WD)', ';AU)', ';BU)', ';AN)', ';WD;', ';AU;', 'S-1-5-11', 'S-1-5-32-545'];

const POLL_MS = 10;
const READ_CHUNK = 8192;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_READ_ITERS = 64;
const DRAIN_TIMEOUT_MS = 2000;

let cached: Win32Api | null = null;

/** Load (once) and return the real koffi-backed Win32 API. Memoized — koffi.load + fn binds + the SDDL
 *  security descriptor are all done a single time at first use. */
export function loadWin32Api(): Win32Api {
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
  // NOTE: Win32 BOOL is a 4-byte int, NOT koffi's 1-byte `bool`. Using `bool` for the `bWait` INPUT would
  // leave 3 high bytes of the arg slot indeterminate → GetOverlappedResult can read it as TRUE and BLOCK.
  // So `bWait` is `int` and we pass 0/1 explicitly. (Return BOOLs are read fine as `bool`.)
  const GetOverlappedResult = k32.func('__stdcall', 'GetOverlappedResult', 'bool', [HANDLE, 'void *', 'uint32 *', 'int']);
  const ResetEvent = k32.func('__stdcall', 'ResetEvent', 'bool', [HANDLE]);
  const CancelIoEx = k32.func('__stdcall', 'CancelIoEx', 'bool', [HANDLE, 'void *']);
  const DisconnectNamedPipe = k32.func('__stdcall', 'DisconnectNamedPipe', 'bool', [HANDLE]);
  const GetNamedPipeClientProcessId = k32.func('__stdcall', 'GetNamedPipeClientProcessId', 'bool', [HANDLE, 'uint32 *']);
  const GetCurrentProcess = k32.func('__stdcall', 'GetCurrentProcess', HANDLE, []);
  const CloseHandle = k32.func('__stdcall', 'CloseHandle', 'bool', [HANDLE]);
  const GetLastError = k32.func('__stdcall', 'GetLastError', 'uint32', []);
  const OpenProcessToken = adv.func('__stdcall', 'OpenProcessToken', 'bool', [HANDLE, 'uint32', 'void *']);
  const OpenThreadToken = adv.func('__stdcall', 'OpenThreadToken', 'bool', [HANDLE, 'uint32', 'int', 'void *']);
  const GetCurrentThread = k32.func('__stdcall', 'GetCurrentThread', HANDLE, []);
  const ImpersonateNamedPipeClient = adv.func('__stdcall', 'ImpersonateNamedPipeClient', 'bool', [HANDLE]);
  const RevertToSelf = adv.func('__stdcall', 'RevertToSelf', 'bool', []);
  const GetTokenInformation = adv.func('__stdcall', 'GetTokenInformation', 'bool', [HANDLE, 'int', 'void *', 'uint32', 'uint32 *']);
  const ConvertStringSecurityDescriptorToSecurityDescriptorW = adv.func('__stdcall',
    'ConvertStringSecurityDescriptorToSecurityDescriptorW', 'bool', ['str16', 'uint32', 'void *', 'void *']);
  const CreateFileW = k32.func('__stdcall', 'CreateFileW', HANDLE,
    ['str16', 'uint32', 'uint32', 'void *', 'uint32', 'uint32', HANDLE]);
  const LocalFree = k32.func('__stdcall', 'LocalFree', HANDLE, [HANDLE]);
  const GetNamedSecurityInfoW = adv.func('__stdcall', 'GetNamedSecurityInfoW', 'uint32',
    ['str16', 'int', 'uint32', 'void *', 'void *', 'void *', 'void *', 'void *']);
  const ConvertSecurityDescriptorToStringSecurityDescriptorW = adv.func('__stdcall',
    'ConvertSecurityDescriptorToStringSecurityDescriptorW', 'bool',
    ['void *', 'uint32', 'uint32', koffi.out(koffi.pointer('str16')), 'void *']);

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

  const dbg = process.env.KB_PIPE_DEBUG
    ? (m: string): void => {
        process.stderr.write(`[pipe] ${m}\n`);
      }
    : (): void => {};
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

  /** TokenUser SID bytes from an open access token, or null on any failure. Parses no strings (crash-proof). */
  function sidBytesFromToken(hToken: unknown): Uint8Array | null {
    const lenBuf = koffi.alloc('uint32', 1);
    GetTokenInformation(hToken, TOKEN_USER_CLASS, null, 0, lenBuf); // size probe (expected to "fail")
    const len = koffi.decode(lenBuf, 'uint32') as number;
    if (len === 0 || len > 4096) return null;
    const info = koffi.alloc('uint8', len);
    if (!GetTokenInformation(hToken, TOKEN_USER_CLASS, info, len, lenBuf)) return null;
    // TOKEN_USER { SID_AND_ATTRIBUTES { PSID Sid; DWORD Attributes } } — first field is the PSID, which
    // points INSIDE `info`. Read the offset, then copy the SID bytes out of the koffi-owned buffer.
    const psid = addrOf(koffi.decode(info, HANDLE));
    const base = addrOf(info);
    const off = Number(psid - base);
    if (!Number.isFinite(off) || off < 0 || off >= len) return null;
    const bytes = koffi.decode(info, off, 'uint8', len - off) as ArrayLike<number>;
    return Uint8Array.from(bytes);
  }

  /** SID bytes from a PROCESS handle's token (used for the daemon's OWN SID). */
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

  const daemonSid = ((): string | null => {
    // GetCurrentProcess returns a pseudo-handle (does not need closing).
    const bytes = sidBytesForProcessHandle(GetCurrentProcess());
    if (!bytes) return null;
    try {
      return parseSidString(bytes);
    } catch {
      return null;
    }
  })();

  /** Owner-only SECURITY_ATTRIBUTES (built ONCE). null → the daemon SID or SDDL construction failed; in
   *  that case `createPipe` returns null (fail closed) — the control pipe is NEVER created with a null SA,
   *  which would grant the DEFAULT named-pipe DACL (any local user could connect). The LocalAlloc'd SD is
   *  kept for daemon life (one allocation, not per-connection — no leak growth). */
  const securityAttributes: Buffer | null = ((): Buffer | null => {
    if (!daemonSid) return null;
    try {
      const sddl = `D:P(A;;GA;;;${daemonSid})(A;;GA;;;SY)`;
      const sdOut = koffi.alloc(HANDLE, 1);
      if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, sdOut, null)) return null;
      const pSD = koffi.decode(sdOut, HANDLE);
      const saBuf = koffi.alloc(SECURITY_ATTRIBUTES, 1);
      koffi.encode(saBuf, SECURITY_ATTRIBUTES, {
        nLength: koffi.sizeof(SECURITY_ATTRIBUTES),
        lpSecurityDescriptor: pSD,
        bInheritHandle: 0,
      });
      return saBuf;
    } catch {
      return null;
    }
  })();

  const asConn = (handle: PipeHandle): Conn => handle as Conn;

  /** Reset the OVERLAPPED + event before starting a new overlapped op on this connection. */
  function prep(conn: Conn): void {
    ResetEvent(conn.ev);
    koffi.encode(conn.ov, OVERLAPPED, { Internal: 0n, InternalHigh: 0n, Offset: 0, OffsetHigh: 0, hEvent: conn.ev });
  }

  /** Poll GetOverlappedResult on the main loop until the op completes, the connection closes, an error
   *  occurs, or (if given) `timeoutMs` elapses. Resolves { ok, n } — ok=false means error/closed/timeout. */
  function pollOverlapped(conn: Conn, timeoutMs?: number): Promise<{ ok: boolean; n: number }> {
    const deadline = timeoutMs != null ? Date.now() + timeoutMs : Infinity;
    return new Promise((resolve) => {
      const check = (): void => {
        if (conn.closed) return resolve({ ok: false, n: 0 });
        const nBuf = koffi.alloc('uint32', 1);
        if (GetOverlappedResult(conn.h, conn.ov, nBuf, 0)) {
          return resolve({ ok: true, n: koffi.decode(nBuf, 'uint32') as number });
        }
        if (lastErr() === ERROR_IO_INCOMPLETE && Date.now() < deadline) {
          setTimeout(check, POLL_MS);
          return;
        }
        resolve({ ok: false, n: 0 }); // broken pipe / cancelled / error / timeout
      };
      check();
    });
  }

  async function readChunk(conn: Conn): Promise<Buffer | null> {
    prep(conn);
    const buf = Buffer.allocUnsafe(READ_CHUNK);
    const rn = koffi.alloc('uint32', 1);
    const ok = ReadFile(conn.h, buf, READ_CHUNK, rn, conn.ov);
    dbg(`readChunk: ReadFile ret=${ok} err=${ok ? 0 : lastErr()}`);
    if (ok) {
      const n = koffi.decode(rn, 'uint32') as number;
      return n > 0 ? Buffer.from(buf.subarray(0, n)) : null;
    }
    if (lastErr() !== ERROR_IO_PENDING) return null; // broken pipe / error → EOF
    const res = await pollOverlapped(conn);
    dbg(`readChunk: poll ok=${res.ok} n=${res.n}`);
    if (!res.ok || res.n === 0) return null;
    return Buffer.from(buf.subarray(0, res.n));
  }

  cached = {
    currentSidString: () => daemonSid,

    writeOwnerOnlyFile: (filePath: string, data: string): boolean => {
      try {
        if (!daemonSid) return false;
        // Owner-only file DACL: full access to the daemon SID + SYSTEM, protected (P = no inheritance).
        const sddl = `D:P(A;;FA;;;${daemonSid})(A;;FA;;;SY)`;
        const sdOut = koffi.alloc(HANDLE, 1);
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, sdOut, null)) return false;
        const pSD = koffi.decode(sdOut, HANDLE);
        const sa = koffi.alloc(SECURITY_ATTRIBUTES, 1);
        koffi.encode(sa, SECURITY_ATTRIBUTES, {
          nLength: koffi.sizeof(SECURITY_ATTRIBUTES),
          lpSecurityDescriptor: pSD,
          bInheritHandle: 0,
        });
        // CREATE_ALWAYS with an explicit SD → the new file's DACL is exactly the SDDL above (used verbatim,
        // not inherited). Synchronous handle: a 64-byte token writes instantly (boot path, not per-conn).
        const h = CreateFileW(filePath, GENERIC_WRITE, 0, sa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, null);
        try {
          LocalFree(pSD);
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
        // VERIFY: read the file's DACL back as an SDDL string; it must name the daemon SID and NO broad
        // trustee (Everyone / Authenticated Users / Users). Symmetry with the POSIX 0600 + stat-verify.
        const sd2 = koffi.alloc(HANDLE, 1);
        const rc = GetNamedSecurityInfoW(filePath, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, null, null, null, null, sd2) as number;
        if (rc !== 0) return false;
        const pSD2 = koffi.decode(sd2, HANDLE);
        try {
          const holder: (string | null)[] = [null];
          if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(pSD2, SDDL_REVISION_1, DACL_SECURITY_INFORMATION, holder, null)) {
            return false;
          }
          const dacl = String(holder[0] ?? '');
          if (!dacl.includes(daemonSid)) return false;
          if (BROAD_TRUSTEES.some((b) => dacl.includes(b))) return false;
          return true;
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

    getClientPid: (handle: PipeHandle): number | null => {
      try {
        const conn = asConn(handle);
        const pidBuf = koffi.alloc('uint32', 1);
        if (!GetNamedPipeClientProcessId(conn.h, pidBuf)) return null;
        const pid = koffi.decode(pidBuf, 'uint32') as number;
        return pid > 0 ? pid : null;
      } catch {
        return null;
      }
    },

    // H/L-1 (TOCTOU-free peer read): impersonate the pipe's ACTUAL client and read its token SID, rather
    // than GetNamedPipeClientProcessId→OpenProcess (whose stored PID could be recycled to a daemon-owned
    // process between the PID read and OpenProcess). This is fully SYNCHRONOUS — no await between
    // ImpersonateNamedPipeClient and RevertToSelf — so no other event-loop work runs while impersonating.
    // MUST be called only after the client has written (the caller awaits readLine first). Fail closed on
    // any error. RevertToSelf ALWAYS runs (finally); a failed revert is a privilege hazard → exit hard so
    // PM2 restarts a clean daemon rather than continue mis-impersonated.
    getClientSidBytes: (handle: PipeHandle): Uint8Array | null => {
      const conn = asConn(handle);
      let impersonating = false;
      try {
        if (!ImpersonateNamedPipeClient(conn.h)) return null;
        impersonating = true;
        const tokBuf = koffi.alloc(HANDLE, 1);
        // OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, OpenAsSelf=TRUE, &token). OpenAsSelf=TRUE reads
        // the token using the daemon's own security context (not the impersonated one) so it succeeds.
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
          process.stderr.write('[kb-broker] FATAL: RevertToSelf failed; exiting to avoid a leaked impersonation\n');
          process.exit(70);
        }
      }
    },

    createPipe: (name: string, firstInstance: boolean): PipeHandle | null => {
      // F6: track the pipe + event handles so a throw AFTER creating them (e.g. koffi.alloc(OVERLAPPED))
      // closes them in the catch instead of leaking. Nulled once ownership transfers to the returned Conn.
      let h: unknown = null;
      let ev: unknown = null;
      try {
        // M-1: FAIL CLOSED if the owner-only SA could not be built. A null SA would give the default
        // named-pipe DACL (any local account could connect) — never create the control pipe that way.
        // A failed SDDL/SA construction is a hard boot failure, not a silent downgrade.
        if (!securityAttributes) return null;
        let openMode = PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED;
        if (firstInstance) openMode |= FILE_FLAG_FIRST_PIPE_INSTANCE;
        const pipeMode = PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS;
        h = CreateNamedPipeW(
          name, openMode, pipeMode, PIPE_UNLIMITED_INSTANCES,
          PIPE_BUFFER_BYTES, PIPE_BUFFER_BYTES, 0, securityAttributes,
        );
        if (badHandle(h)) {
          h = null;
          return null;
        }
        ev = CreateEventW(null, 1, 0, null); // manual-reset (1), initially non-signaled (0)
        if (badHandle(ev)) {
          ev = null;
          return null; // catch/finally-equivalent below closes h
        }
        const ov = koffi.alloc(OVERLAPPED, 1);
        const conn: Conn = { h, ev, ov, closed: false };
        h = null; // ownership transferred to conn — don't close in the cleanup path
        ev = null;
        return conn;
      } catch {
        return null;
      } finally {
        // Close anything still owned here (a mid-construction failure/throw): the returned-conn path nulled
        // both, so this only fires on a failure path — no double close.
        if (ev !== null) {
          try {
            CloseHandle(ev);
          } catch {
            /* ignore */
          }
        }
        if (h !== null) {
          try {
            CloseHandle(h);
          } catch {
            /* ignore */
          }
        }
      }
    },

    accept: async (handle: PipeHandle): Promise<void> => {
      const conn = asConn(handle);
      prep(conn);
      const r = ConnectNamedPipe(conn.h, conn.ov);
      dbg(`accept: ConnectNamedPipe ret=${r} err=${r ? 0 : lastErr()}`);
      if (r) return; // rare: connected synchronously
      const le = lastErr();
      if (le === ERROR_PIPE_CONNECTED) return; // a client raced in before ConnectNamedPipe
      if (le !== ERROR_IO_PENDING) throw new Error(`ConnectNamedPipe failed err=${le}`);
      const res = await pollOverlapped(conn);
      dbg(`accept: poll done ok=${res.ok}`);
      if (!res.ok) throw new Error('accept did not complete (closed/cancelled)');
    },

    readLine: async (handle: PipeHandle): Promise<string | null> => {
      const conn = asConn(handle);
      let acc = Buffer.alloc(0);
      for (let iter = 0; iter < MAX_READ_ITERS; iter++) {
        const chunk = await readChunk(conn);
        if (chunk === null) return acc.length > 0 ? acc.toString('utf-8') : null;
        acc = Buffer.concat([acc, chunk]);
        const nl = acc.indexOf(0x0a);
        if (nl !== -1) return acc.subarray(0, nl).toString('utf-8');
        if (acc.length > MAX_LINE_BYTES) throw new Error('control request line exceeded max length; fail-closed');
      }
      throw new Error('control request line read exceeded max iterations; fail-closed');
    },

    write: async (handle: PipeHandle, data: string): Promise<boolean> => {
      try {
        const conn = asConn(handle);
        prep(conn);
        const bytes = Buffer.from(data, 'utf-8');
        const wn = koffi.alloc('uint32', 1);
        const ok = WriteFile(conn.h, bytes, bytes.length, wn, conn.ov);
        dbg(`write: WriteFile ret=${ok} err=${ok ? 0 : lastErr()}`);
        if (ok) return (koffi.decode(wn, 'uint32') as number) === bytes.length;
        if (lastErr() !== ERROR_IO_PENDING) return false;
        // L-1: poll for completion bounded by DRAIN_TIMEOUT_MS — NEVER block the event loop. A response
        // larger than the pipe buffer to an authenticated client that never drains would otherwise stall
        // the daemon. On timeout/error, abort the pending write (CancelIoEx); the caller disconnects.
        const res = await pollOverlapped(conn, DRAIN_TIMEOUT_MS);
        dbg(`write: poll ok=${res.ok} n=${res.n}`);
        if (!res.ok) {
          try {
            CancelIoEx(conn.h, conn.ov);
          } catch {
            /* ignore */
          }
          return false;
        }
        return res.n === bytes.length;
      } catch {
        return false;
      }
    },

    // "Flush" = confirm delivery: an overlapped read that completes with ERROR_BROKEN_PIPE once the client
    // has read the response and closed. Bounded by DRAIN_TIMEOUT_MS so a client that never closes cannot
    // hold the instance open forever.
    flush: async (handle: PipeHandle): Promise<void> => {
      try {
        const conn = asConn(handle);
        prep(conn);
        const buf = Buffer.allocUnsafe(16);
        const dn = koffi.alloc('uint32', 1);
        const ok = ReadFile(conn.h, buf, 16, dn, conn.ov);
        dbg(`flush: drain ReadFile ret=${ok} err=${ok ? 0 : lastErr()}`);
        if (ok) return;
        if (lastErr() !== ERROR_IO_PENDING) return; // already broken/drained
        const r = await pollOverlapped(conn, DRAIN_TIMEOUT_MS);
        dbg(`flush: drain poll ok=${r.ok}`);
      } catch {
        /* best-effort */
      }
    },

    closeConnection: (handle: PipeHandle): void => {
      const conn = asConn(handle);
      conn.closed = true;
      try {
        CancelIoEx(conn.h, null);
      } catch {
        /* ignore */
      }
      try {
        DisconnectNamedPipe(conn.h);
      } catch {
        /* ignore */
      }
      try {
        CloseHandle(conn.h);
      } catch {
        /* ignore */
      }
      try {
        CloseHandle(conn.ev);
      } catch {
        /* ignore */
      }
    },
  };
  return cached;
}
