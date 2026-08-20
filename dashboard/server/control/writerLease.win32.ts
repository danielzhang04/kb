import { createRequire } from 'node:module';
import type { NativeWriterLease } from './writerLease.ts';

const nodeRequire = createRequire(import.meta.url);
const GENERIC_READ_WRITE = 0xc0000000;
const OPEN_ALWAYS = 4;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const HANDLE_FLAG_INHERIT = 0x1;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const INVALID_HANDLE = -1n;
const ERROR_SHARING_VIOLATION = 32;
const ERROR_LOCK_VIOLATION = 33;
const STILL_ACTIVE = 259;

type KoffiFn = (...args: unknown[]) => unknown;
interface KoffiLibrary { func(convention: string, name: string, result: string, args: unknown[]): KoffiFn }
interface Koffi {
  load(name: string): KoffiLibrary;
  alloc(type: unknown, count: number): Buffer;
  decode(buffer: unknown, type: unknown): unknown;
  address(value: unknown): number | bigint;
}

function badHandle(koffi: Koffi, handle: unknown): boolean {
  try {
    const address = BigInt(koffi.address(handle));
    return address === 0n || BigInt.asIntN(64, address) === INVALID_HANDLE;
  } catch { return true; }
}

function loadBindings() {
  if (process.platform !== 'win32') throw new Error('Windows writer lease loaded on a non-Windows host');
  const koffi = nodeRequire('koffi') as Koffi;
  const kernel32 = koffi.load('kernel32.dll');
  const HANDLE = 'void *';
  return {
    koffi,
    HANDLE,
    CreateFileW: kernel32.func('__stdcall', 'CreateFileW', HANDLE, ['str16', 'uint32', 'uint32', HANDLE, 'uint32', 'uint32', HANDLE]),
    GetLastError: kernel32.func('__stdcall', 'GetLastError', 'uint32', []),
    CloseHandle: kernel32.func('__stdcall', 'CloseHandle', 'bool', [HANDLE]),
    GetHandleInformation: kernel32.func('__stdcall', 'GetHandleInformation', 'bool', [HANDLE, HANDLE]),
    OpenProcess: kernel32.func('__stdcall', 'OpenProcess', HANDLE, ['uint32', 'bool', 'uint32']),
    GetProcessTimes: kernel32.func('__stdcall', 'GetProcessTimes', 'bool', [HANDLE, HANDLE, HANDLE, HANDLE, HANDLE]),
    GetExitCodeProcess: kernel32.func('__stdcall', 'GetExitCodeProcess', 'bool', [HANDLE, HANDLE]),
  };
}

function processStartTicks(bindings: ReturnType<typeof loadBindings>, pid: number): number | null {
  const handle = bindings.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (badHandle(bindings.koffi, handle)) return null;
  try {
    const creation = Buffer.alloc(8);
    const exit = Buffer.alloc(8);
    const kernel = Buffer.alloc(8);
    const user = Buffer.alloc(8);
    if (!bindings.GetProcessTimes(handle, creation, exit, kernel, user)) return null;
    const exitCode = Buffer.alloc(4);
    if (!bindings.GetExitCodeProcess(handle, exitCode) || exitCode.readUInt32LE(0) !== STILL_ACTIVE) return null;
    // FILETIME is beyond Number.MAX_SAFE_INTEGER. Both the persisted sample and later liveness
    // sample take this same conversion, whose current-date ULP is 16 ticks (1.6 microseconds), so
    // the self-comparison remains stable while retaining far more precision than process launches.
    return Number(creation.readBigUInt64LE(0));
  } finally {
    bindings.CloseHandle(handle);
  }
}

export function win32ProcessStartTicks(pid: number): number | null {
  return processStartTicks(loadBindings(), pid);
}

export function acquireWin32WriterLease(lockPath: string):
  { lease: NativeWriterLease; holderPid: null } | { lease: null; holderPid: null } {
  const bindings = loadBindings();
  // A null SECURITY_ATTRIBUTES pointer makes the returned handle non-inheritable. Share mode zero
  // makes this exact pathname an exclusive process-lifetime capability.
  const handle = bindings.CreateFileW(
    lockPath, GENERIC_READ_WRITE, 0, null, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, null,
  );
  if (badHandle(bindings.koffi, handle)) {
    const errorCode = bindings.GetLastError() as number;
    if (errorCode === ERROR_SHARING_VIOLATION || errorCode === ERROR_LOCK_VIOLATION) {
      return { lease: null, holderPid: null };
    }
    throw new Error(`CreateFileW failed for dashboard writer lease (Win32 error ${errorCode})`);
  }
  let closed = false;
  const inheritFlagSet = (): boolean => {
    const flags = bindings.koffi.alloc('uint32', 1);
    if (!bindings.GetHandleInformation(handle, flags)) throw new Error('GetHandleInformation failed for dashboard writer lease');
    return (((bindings.koffi.decode(flags, 'uint32') as number) & HANDLE_FLAG_INHERIT) !== 0);
  };
  try {
    if (inheritFlagSet()) throw new Error('dashboard writer lease handle is inheritable');
    return {
      lease: {
        inheritFlagSet: false,
        assertHeld() {
          if (closed) throw new Error('writer lease has been released');
          if (inheritFlagSet()) throw new Error('dashboard writer lease handle is inheritable');
        },
        assertOwnedForContentionCleanup() {
          if (closed) throw new Error('writer lease has been released');
          if (inheritFlagSet()) throw new Error('dashboard writer lease handle is inheritable');
        },
        release() {
          if (closed) return;
          closed = true;
          bindings.CloseHandle(handle);
        },
      },
      holderPid: null,
    };
  } catch (error) {
    bindings.CloseHandle(handle);
    closed = true;
    throw error;
  }
}
