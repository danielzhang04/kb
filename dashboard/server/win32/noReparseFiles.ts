/**
 * Handle-rooted Windows file access for security-sensitive control channels.
 *
 * A lexical / lstat check followed by a pathname operation is inherently racy: another process can replace an
 * intermediate directory with a junction in between. This module therefore never performs I/O by a caller-supplied
 * pathname. It opens a configured root with OBJ_DONT_REPARSE, resolves validated relative components under that
 * handle with the same flag, and performs every read/write/hash/delete through the resulting HANDLE.
 *
 * `koffi` remains lazy. Importing this file is safe in hermetic tests and on non-Windows hosts; native bindings are
 * loaded only when a real tree operation is requested on Windows.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { win32 } from 'node:path';

const nodeRequire = createRequire(import.meta.url);

const OBJ_CASE_INSENSITIVE = 0x00000040;
const OBJ_DONT_REPARSE = 0x00001000;
const FILE_OPEN = 0x00000001;
const FILE_OPEN_IF = 0x00000003;
const FILE_DIRECTORY_FILE = 0x00000001;
const FILE_SYNCHRONOUS_IO_NONALERT = 0x00000020;
const FILE_NON_DIRECTORY_FILE = 0x00000040;
const FILE_OPEN_REPARSE_POINT = 0x00200000;
const FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
const FILE_ATTRIBUTE_NORMAL = 0x00000080;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
const FILE_READ_DATA = 0x0001;
const FILE_WRITE_DATA = 0x0002;
const FILE_READ_ATTRIBUTES = 0x0080;
const FILE_TRAVERSE = 0x0020;
const SYNCHRONIZE = 0x00100000;
const DELETE = 0x00010000;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_WRITE = 0x00000002;
const FILE_TYPE_DISK = 0x0001;
const FILE_DISPOSITION_INFO = 4;
const DRIVE_FIXED = 3;
const DIRECTORY_ACCESS = FILE_READ_DATA | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE;
const MAX_UTF8_FILE_BYTES = 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;
const STATUS_OBJECT_NAME_NOT_FOUND = 0xc0000034 | 0;
const STATUS_OBJECT_PATH_NOT_FOUND = 0xc000003a | 0;
const STATUS_STOPPED_ON_SYMLINK = 0x8000002d | 0;
const STATUS_REPARSE_POINT_ENCOUNTERED = 0xc000050b | 0;
const STATUS_NO_MORE_FILES = 0x80000006 | 0;
const INVALID_HANDLE = -1n;

type KoffiFn = (...args: unknown[]) => unknown;
interface KoffiLibrary {
  func(convention: string, name: string, result: string, arguments_: unknown[]): KoffiFn;
}
interface Koffi {
  load(name: string): KoffiLibrary;
  struct(name: string, fields: Record<string, string>): unknown;
  alloc(type: unknown, count: number): Buffer;
  decode(buffer: unknown, offsetOrType: unknown, type?: unknown, length?: unknown): unknown;
  encode(buffer: unknown, type: unknown, value: unknown, count?: number): void;
  sizeof(type: unknown): number;
  address(value: unknown): number | bigint;
}

interface NativeBindings {
  openFile(input: NativeOpen): unknown;
  isFixedLocalDrive(driveRoot: string): boolean;
  close(handle: unknown): void;
  inspect(handle: unknown): NativeFileInfo;
  read(handle: unknown, size: number): Buffer;
  write(handle: unknown, bytes: Buffer): void;
  truncate(handle: unknown): void;
  delete(handle: unknown): void;
  directoryEmpty(handle: unknown): boolean;
}

interface NativeOpen {
  root: unknown;
  name: string;
  desiredAccess: number;
  shareAccess: number;
  disposition: number;
  options: number;
  attributes: number;
}

interface NativeFileInfo {
  directory: boolean;
  reparse: boolean;
  disk: boolean;
  size: number;
  links: number;
  identity: string;
}

export interface NoReparseFileInfo {
  size: number;
  sha256: string | null;
  identity: string;
}
export type NoReparseHashMode = 'always' | 'never' | number;

/** A filesystem result that is unsafe or otherwise unusable; it intentionally has no file contents. */
export class NoReparseFileError extends Error {
  readonly code: 'unsupported' | 'unsafe-path' | 'missing' | 'io';
  /** NTSTATUS is diagnostic metadata only; callers must not surface file contents or secrets. */
  readonly ntstatus: number | null;

  constructor(code: NoReparseFileError['code'], operation: string, ntstatus: number | null = null) {
    super(`secure roster file ${operation} failed (${code})`);
    this.code = code;
    this.ntstatus = ntstatus;
  }
}

export interface NoReparseFileTree {
  ensureDir(parts: readonly string[]): void;
  /** Bounded UTF-8 contents, or null only when the final file is absent. */
  readUtf8(parts: readonly string[], maxBytes?: number): string | null;
  /** Opens/creates, validates, truncates, and writes through one file handle. */
  writeUtf8(parts: readonly string[], contents: string): void;
  /** Create or resume one exact UTF-8 file. Existing bytes must be a byte-prefix of `contents`. */
  completeUtf8FromPrefix(parts: readonly string[], contents: string): void;
  /** Same-handle exact-baseline append; a prior short append resumes only from the exact suffix prefix. */
  appendUtf8IfExact(parts: readonly string[], expected: string, suffix: string): void;
  /** Removes a regular, non-reparse, non-hardlinked file if present. */
  deleteFileIfPresent(parts: readonly string[]): void;
  /** Removes an empty, non-reparse, non-hardlinked directory if present. */
  deleteEmptyDirIfPresent(parts: readonly string[]): void;
  /** Opens and validates a regular file; hash is from the same handle when requested. */
  inspectRegularFile(parts: readonly string[], hashMode: NoReparseHashMode): NoReparseFileInfo | null;
  /** Handle-rooted kind inspection; null means the exact final path is absent. */
  pathKind(parts: readonly string[]): 'file' | 'directory' | null;
  /** Prove through the opened directory handle that the exact directory exists and has no entries. */
  assertEmptyDirectory(parts: readonly string[]): void;
  /** Render-only path for terminal arguments and permission settings. Never use it for I/O. */
  displayPath(parts: readonly string[]): string;
}

interface TreeOptions {
  createRoot: boolean;
  /** Direct native-layer fault injection for crash-recovery tests; never set by production wiring. */
  testShortWriteBytesOnce?: number;
}

function isBadHandle(koffi: Koffi, handle: unknown): boolean {
  try {
    const address = BigInt(koffi.address(handle));
    return address === 0n || address === INVALID_HANDLE;
  } catch {
    return true;
  }
}

function nativeStatusError(status: number, operation: string, toDosError: KoffiFn): NoReparseFileError {
  if (status === STATUS_STOPPED_ON_SYMLINK || status === STATUS_REPARSE_POINT_ENCOUNTERED) {
    return new NoReparseFileError('unsafe-path', operation, status);
  }
  if (status === STATUS_OBJECT_NAME_NOT_FOUND || status === STATUS_OBJECT_PATH_NOT_FOUND) {
    return new NoReparseFileError('missing', operation, status);
  }
  // Exercise the documented mapping while deliberately keeping opaque implementation errors out of logs/UI.
  void toDosError(status);
  return new NoReparseFileError('io', operation, status);
}

function loadNativeBindings(): NativeBindings {
  const koffi = nodeRequire('koffi') as Koffi;
  const HANDLE = 'void *';
  const ntdll = koffi.load('ntdll.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const UNICODE_STRING = koffi.struct('KB_UNICODE_STRING', {
    Length: 'uint16', MaximumLength: 'uint16', Buffer: HANDLE,
  });
  const OBJECT_ATTRIBUTES = koffi.struct('KB_OBJECT_ATTRIBUTES', {
    Length: 'uint32', RootDirectory: HANDLE, ObjectName: HANDLE, Attributes: 'uint32',
    SecurityDescriptor: HANDLE, SecurityQualityOfService: HANDLE,
  });
  const IO_STATUS_BLOCK = koffi.struct('KB_IO_STATUS_BLOCK', { Status: 'intptr_t', Information: 'uintptr_t' });
  const BY_HANDLE_FILE_INFORMATION = koffi.struct('KB_BY_HANDLE_FILE_INFORMATION', {
    dwFileAttributes: 'uint32', ftCreationTimeLow: 'uint32', ftCreationTimeHigh: 'uint32',
    ftLastAccessTimeLow: 'uint32', ftLastAccessTimeHigh: 'uint32', ftLastWriteTimeLow: 'uint32',
    ftLastWriteTimeHigh: 'uint32', dwVolumeSerialNumber: 'uint32', nFileSizeHigh: 'uint32',
    nFileSizeLow: 'uint32', nNumberOfLinks: 'uint32', nFileIndexHigh: 'uint32', nFileIndexLow: 'uint32',
  });
  const NtCreateFile = ntdll.func('__stdcall', 'NtCreateFile', 'int32', [
    HANDLE, 'uint32', HANDLE, HANDLE, HANDLE, 'uint32', 'uint32', 'uint32', 'uint32', HANDLE, 'uint32',
  ]);
  const NtQueryDirectoryFile = ntdll.func('__stdcall', 'NtQueryDirectoryFile', 'int32', [
    HANDLE, HANDLE, HANDLE, HANDLE, HANDLE, HANDLE, 'uint32', 'uint32', 'uint8', HANDLE, 'uint8',
  ]);
  const RtlNtStatusToDosError = ntdll.func('__stdcall', 'RtlNtStatusToDosError', 'uint32', ['int32']);
  const CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'bool', [HANDLE]);
  const GetFileInformationByHandle = kernel32.func('__stdcall', 'GetFileInformationByHandle', 'bool', [HANDLE, HANDLE]);
  const GetFileType = kernel32.func('__stdcall', 'GetFileType', 'uint32', [HANDLE]);
  const ReadFile = kernel32.func('__stdcall', 'ReadFile', 'bool', [HANDLE, HANDLE, 'uint32', HANDLE, HANDLE]);
  const WriteFile = kernel32.func('__stdcall', 'WriteFile', 'bool', [HANDLE, HANDLE, 'uint32', HANDLE, HANDLE]);
  const SetFilePointerEx = kernel32.func('__stdcall', 'SetFilePointerEx', 'bool', [HANDLE, 'int64', HANDLE, 'uint32']);
  const SetEndOfFile = kernel32.func('__stdcall', 'SetEndOfFile', 'bool', [HANDLE]);
  const SetFileInformationByHandle = kernel32.func('__stdcall', 'SetFileInformationByHandle', 'bool', [HANDLE, 'uint32', HANDLE, 'uint32']);
  const GetDriveTypeW = kernel32.func('__stdcall', 'GetDriveTypeW', 'uint32', ['str16']);

  const withName = (name: string, root: unknown): { nameBuffer: Buffer; objectName: Buffer; attributes: Buffer } => {
    const nameBuffer = Buffer.from(`${name}\0`, 'utf16le');
    if (nameBuffer.length > 0xfffe) throw new NoReparseFileError('unsafe-path', 'name');
    const objectName = koffi.alloc(UNICODE_STRING, 1);
    koffi.encode(objectName, UNICODE_STRING, {
      Length: nameBuffer.length - 2, MaximumLength: nameBuffer.length, Buffer: nameBuffer,
    });
    const attributes = koffi.alloc(OBJECT_ATTRIBUTES, 1);
    koffi.encode(attributes, OBJECT_ATTRIBUTES, {
      Length: koffi.sizeof(OBJECT_ATTRIBUTES), RootDirectory: root, ObjectName: objectName,
      Attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE, SecurityDescriptor: null, SecurityQualityOfService: null,
    });
    return { nameBuffer, objectName, attributes };
  };

  return {
    isFixedLocalDrive(driveRoot) { return (GetDriveTypeW(driveRoot) as number) === DRIVE_FIXED; },
    openFile(input) {
      const named = withName(input.name, input.root);
      const file = koffi.alloc(HANDLE, 1);
      const statusBlock = koffi.alloc(IO_STATUS_BLOCK, 1);
      const status = NtCreateFile(
        file, input.desiredAccess, named.attributes, statusBlock, null, input.attributes, input.shareAccess,
        input.disposition, input.options | FILE_OPEN_REPARSE_POINT, null, 0,
      ) as number;
      if (status < 0) throw nativeStatusError(status, 'open', RtlNtStatusToDosError);
      const handle = koffi.decode(file, HANDLE);
      if (isBadHandle(koffi, handle)) throw new NoReparseFileError('io', 'open');
      return handle;
    },
    close(handle) { if (!isBadHandle(koffi, handle)) CloseHandle(handle); },
    inspect(handle) {
      const info = koffi.alloc(BY_HANDLE_FILE_INFORMATION, 1);
      if (!GetFileInformationByHandle(handle, info)) throw new NoReparseFileError('io', 'inspect');
      const decoded = koffi.decode(info, BY_HANDLE_FILE_INFORMATION) as Record<string, number>;
      const size = decoded.nFileSizeHigh * 0x1_0000_0000 + decoded.nFileSizeLow;
      if (!Number.isSafeInteger(size)) throw new NoReparseFileError('io', 'inspect');
      return {
        directory: (decoded.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) !== 0,
        reparse: (decoded.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0,
        disk: (GetFileType(handle) as number) === FILE_TYPE_DISK,
        size,
        links: decoded.nNumberOfLinks,
        identity: `${decoded.dwVolumeSerialNumber}:${decoded.nFileIndexHigh}:${decoded.nFileIndexLow}`,
      };
    },
    read(handle, size) {
      const bytes = Buffer.allocUnsafe(size);
      const count = koffi.alloc('uint32', 1);
      if (!ReadFile(handle, bytes, size, count, null)) throw new NoReparseFileError('io', 'read');
      const read = koffi.decode(count, 'uint32') as number;
      if (read !== size) throw new NoReparseFileError('io', 'read');
      return bytes;
    },
    write(handle, bytes) {
      const count = koffi.alloc('uint32', 1);
      if (!WriteFile(handle, bytes, bytes.length, count, null) || (koffi.decode(count, 'uint32') as number) !== bytes.length) {
        throw new NoReparseFileError('io', 'write');
      }
    },
    truncate(handle) {
      if (!SetFilePointerEx(handle, 0n, null, 0) || !SetEndOfFile(handle)) throw new NoReparseFileError('io', 'truncate');
    },
    delete(handle) {
      const disposition = Buffer.from([1]);
      if (!SetFileInformationByHandle(handle, FILE_DISPOSITION_INFO, disposition, disposition.length)) {
        throw new NoReparseFileError('io', 'delete');
      }
    },
    directoryEmpty(handle) {
      let restart = 1;
      while (true) {
        const statusBlock = koffi.alloc(IO_STATUS_BLOCK, 1);
        const entry = Buffer.alloc(4096);
        const status = NtQueryDirectoryFile(
          handle, null, null, null, statusBlock, entry, entry.length, 12, 1, null, restart,
        ) as number;
        restart = 0;
        if (status === STATUS_NO_MORE_FILES) return true;
        if (status < 0) throw nativeStatusError(status, 'enumerate-directory', RtlNtStatusToDosError);
        const nameLength = entry.readUInt32LE(8);
        if (nameLength > entry.length - 12 || nameLength % 2 !== 0) {
          throw new NoReparseFileError('io', 'enumerate-directory');
        }
        const name = entry.subarray(12, 12 + nameLength).toString('utf16le');
        if (name !== '.' && name !== '..') return false;
      }
    },
  };
}

let cachedNative: NativeBindings | null = null;
function native(): NativeBindings {
  if (process.platform !== 'win32') throw new NoReparseFileError('unsupported', 'open');
  cachedNative ??= loadNativeBindings();
  return cachedNative;
}

function validateParts(parts: readonly string[]): string[] {
  if (parts.length === 0) throw new NoReparseFileError('unsafe-path', 'path');
  const device = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  return parts.map((part) => {
    if (!part || part === '.' || part === '..' || /[\\/:\0]/.test(part) || /[. ]$/.test(part) || device.test(part)) {
      throw new NoReparseFileError('unsafe-path', 'path');
    }
    return part;
  });
}

function absoluteRootParts(root: string): { driveRoot: string; parts: string[] } {
  // Never normalize an untrusted configured root. resolve would quietly turn drive-relative
  // and dot-dot spellings into an apparently safe absolute spelling after this point.
  if (!/^[A-Za-z]:\\/.test(root) || /[\0/]/.test(root)) {
    throw new NoReparseFileError('unsafe-path', 'root');
  }
  const driveRoot = root.slice(0, 3);
  const rest = root.slice(driveRoot.length);
  return { driveRoot, parts: rest === '' ? [] : validateParts(rest.split('\\')) };
}

function assertSafeDirectory(bindings: NativeBindings, handle: unknown): void {
  const info = bindings.inspect(handle);
  if (!info.disk || !info.directory || info.reparse || info.links !== 1) throw new NoReparseFileError('unsafe-path', 'directory');
}

function assertSafeRegularFile(bindings: NativeBindings, handle: unknown): NativeFileInfo {
  const info = bindings.inspect(handle);
  if (!info.disk || info.directory || info.reparse || info.links !== 1) throw new NoReparseFileError('unsafe-path', 'file');
  return info;
}

/** Opens a Windows-only tree. `createRoot` may create missing configured state-root components, never arbitrary child paths. */
export function openNoReparseFileTree(root: string, options: TreeOptions): NoReparseFileTree {
  const parsed = absoluteRootParts(root);
  const displayRoot = win32.join(parsed.driveRoot, ...parsed.parts);
  const withRoot = <T>(operation: (bindings: NativeBindings, rootHandle: unknown) => T): T => {
    const bindings = native();
    if (!bindings.isFixedLocalDrive(parsed.driveRoot)) throw new NoReparseFileError('unsafe-path', 'root');
    let current = bindings.openFile({
      root: null, name: `\\??\\${parsed.driveRoot}`, desiredAccess: DIRECTORY_ACCESS,
      shareAccess: FILE_SHARE_READ | FILE_SHARE_WRITE, disposition: FILE_OPEN,
      options: FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, attributes: 0,
    });
    try {
      assertSafeDirectory(bindings, current);
      for (const part of parsed.parts) {
        const next = bindings.openFile({
          root: current, name: part, desiredAccess: DIRECTORY_ACCESS,
          shareAccess: FILE_SHARE_READ | FILE_SHARE_WRITE, disposition: options.createRoot ? FILE_OPEN_IF : FILE_OPEN,
          options: FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, attributes: FILE_ATTRIBUTE_DIRECTORY,
        });
        try { assertSafeDirectory(bindings, next); } catch (error) { bindings.close(next); throw error; }
        bindings.close(current);
        current = next;
      }
      return operation(bindings, current);
    } finally {
      bindings.close(current);
    }
  };
  const relativeName = (parts: readonly string[]): string => validateParts(parts).join('\\');
  let shortWriteBytesOnce = options.testShortWriteBytesOnce;
  if (shortWriteBytesOnce !== undefined && (!Number.isSafeInteger(shortWriteBytesOnce) || shortWriteBytesOnce < 0)) {
    throw new NoReparseFileError('io', 'test-short-write');
  }
  const writeWithFault = (bindings: NativeBindings, handle: unknown, bytes: Buffer): void => {
    if (shortWriteBytesOnce !== undefined) {
      const length = Math.min(shortWriteBytesOnce, bytes.length);
      shortWriteBytesOnce = undefined;
      if (length > 0) bindings.write(handle, bytes.subarray(0, length));
      throw new NoReparseFileError('io', 'injected-short-write');
    }
    bindings.write(handle, bytes);
  };
  const withFile = <T>(parts: readonly string[], input: Omit<NativeOpen, 'root' | 'name'>, operation: (bindings: NativeBindings, handle: unknown) => T): T =>
    withRoot((bindings, rootHandle) => {
      const handle = bindings.openFile({ ...input, root: rootHandle, name: relativeName(parts) });
      try { return operation(bindings, handle); } finally { bindings.close(handle); }
    });
  return {
    ensureDir(parts) {
      const validated = validateParts(parts);
      withRoot((bindings, rootHandle) => {
        let current = rootHandle;
        let ownCurrent = false;
        try {
          for (const part of validated) {
            const next = bindings.openFile({
              root: current, name: part, desiredAccess: DIRECTORY_ACCESS,
              shareAccess: FILE_SHARE_READ | FILE_SHARE_WRITE, disposition: FILE_OPEN_IF,
              options: FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, attributes: FILE_ATTRIBUTE_DIRECTORY,
            });
            try { assertSafeDirectory(bindings, next); } catch (error) { bindings.close(next); throw error; }
            if (ownCurrent) bindings.close(current);
            current = next;
            ownCurrent = true;
          }
        } finally {
          if (ownCurrent) bindings.close(current);
        }
      });
    },
    readUtf8(parts, maxBytes = MAX_UTF8_FILE_BYTES) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_UTF8_FILE_BYTES) throw new NoReparseFileError('io', 'read');
      try {
        return withFile(parts, {
          desiredAccess: FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE, shareAccess: FILE_SHARE_READ | FILE_SHARE_WRITE,
          disposition: FILE_OPEN, options: FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, attributes: FILE_ATTRIBUTE_NORMAL,
        }, (bindings, handle) => {
          const info = assertSafeRegularFile(bindings, handle);
          if (info.size > maxBytes) throw new NoReparseFileError('io', 'read');
          return new TextDecoder('utf-8', { fatal: true }).decode(bindings.read(handle, info.size));
        });
      } catch (error) {
        if (error instanceof NoReparseFileError && error.code === 'missing') return null;
        throw error;
      }
    },
    writeUtf8(parts, contents) {
      const bytes = Buffer.from(contents, 'utf8');
      if (bytes.length > MAX_UTF8_FILE_BYTES) throw new NoReparseFileError('io', 'write');
      withFile(parts, {
        desiredAccess: FILE_READ_ATTRIBUTES | FILE_WRITE_DATA | SYNCHRONIZE, shareAccess: FILE_SHARE_READ,
        disposition: FILE_OPEN_IF, options: FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, attributes: FILE_ATTRIBUTE_NORMAL,
      }, (bindings, handle) => {
        assertSafeRegularFile(bindings, handle);
        bindings.truncate(handle);
        bindings.write(handle, bytes);
      });
    },
    completeUtf8FromPrefix(parts, contents) {
      const expected = Buffer.from(contents, 'utf8');
      if (expected.length > MAX_UTF8_FILE_BYTES) throw new NoReparseFileError('io', 'complete');
      withFile(parts, {
        desiredAccess: FILE_READ_DATA | FILE_READ_ATTRIBUTES | FILE_WRITE_DATA | SYNCHRONIZE,
        shareAccess: FILE_SHARE_READ, disposition: FILE_OPEN_IF,
        options: FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, attributes: FILE_ATTRIBUTE_NORMAL,
      }, (bindings, handle) => {
        const info = assertSafeRegularFile(bindings, handle);
        if (info.size > expected.length) throw new NoReparseFileError('unsafe-path', 'complete-prefix');
        const current = bindings.read(handle, info.size);
        if (!expected.subarray(0, current.length).equals(current)) {
          throw new NoReparseFileError('unsafe-path', 'complete-prefix');
        }
        if (current.length < expected.length) writeWithFault(bindings, handle, expected.subarray(current.length));
      });
    },
    appendUtf8IfExact(parts, expected, suffix) {
      const baseline = Buffer.from(expected, 'utf8');
      const replacement = Buffer.from(`${expected}${suffix}`, 'utf8');
      if (replacement.length > MAX_UTF8_FILE_BYTES) throw new NoReparseFileError('io', 'append');
      withFile(parts, {
        desiredAccess: FILE_READ_DATA | FILE_READ_ATTRIBUTES | FILE_WRITE_DATA | SYNCHRONIZE,
        shareAccess: FILE_SHARE_READ, disposition: baseline.length === 0 ? FILE_OPEN_IF : FILE_OPEN,
        options: FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, attributes: FILE_ATTRIBUTE_NORMAL,
      }, (bindings, handle) => {
        const info = assertSafeRegularFile(bindings, handle);
        if (info.size < baseline.length || info.size > replacement.length) {
          throw new NoReparseFileError('unsafe-path', 'append-baseline');
        }
        const current = bindings.read(handle, info.size);
        if (!replacement.subarray(0, current.length).equals(current)) {
          throw new NoReparseFileError('unsafe-path', 'append-baseline');
        }
        if (current.length < replacement.length) writeWithFault(bindings, handle, replacement.subarray(current.length));
      });
    },
    deleteFileIfPresent(parts) {
      try {
        withFile(parts, {
          desiredAccess: DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE, shareAccess: FILE_SHARE_READ | FILE_SHARE_WRITE,
          disposition: FILE_OPEN, options: FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, attributes: FILE_ATTRIBUTE_NORMAL,
        }, (bindings, handle) => { assertSafeRegularFile(bindings, handle); bindings.delete(handle); });
      } catch (error) {
        if (error instanceof NoReparseFileError && error.code === 'missing') return;
        throw error;
      }
    },
    deleteEmptyDirIfPresent(parts) {
      try {
        withFile(parts, {
          desiredAccess: DELETE | DIRECTORY_ACCESS, shareAccess: FILE_SHARE_READ | FILE_SHARE_WRITE,
          disposition: FILE_OPEN, options: FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, attributes: 0,
        }, (bindings, handle) => { assertSafeDirectory(bindings, handle); bindings.delete(handle); });
      } catch (error) {
        if (error instanceof NoReparseFileError && error.code === 'missing') return;
        throw error;
      }
    },
    inspectRegularFile(parts, hashMode) {
      try {
        return withFile(parts, {
          desiredAccess: FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE, shareAccess: FILE_SHARE_READ,
          disposition: FILE_OPEN, options: FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, attributes: FILE_ATTRIBUTE_NORMAL,
        }, (bindings, handle) => {
          const info = assertSafeRegularFile(bindings, handle);
          const includeHash = hashMode === 'always' || (typeof hashMode === 'number' && info.size === hashMode);
          if (!includeHash) return { size: info.size, sha256: null, identity: info.identity };
          const hash = createHash('sha256');
          let remaining = info.size;
          while (remaining > 0) {
            const length = Math.min(HASH_CHUNK_BYTES, remaining);
            hash.update(bindings.read(handle, length));
            remaining -= length;
          }
          return { size: info.size, sha256: hash.digest('hex'), identity: info.identity };
        });
      } catch (error) {
        if (error instanceof NoReparseFileError && error.code === 'missing') return null;
        throw error;
      }
    },
    pathKind(parts) {
      try {
        return withFile(parts, {
          desiredAccess: FILE_READ_ATTRIBUTES | FILE_TRAVERSE | SYNCHRONIZE,
          shareAccess: FILE_SHARE_READ | FILE_SHARE_WRITE, disposition: FILE_OPEN,
          options: FILE_SYNCHRONOUS_IO_NONALERT, attributes: 0,
        }, (bindings, handle) => {
          const info = bindings.inspect(handle);
          if (!info.disk || info.reparse || info.links !== 1) throw new NoReparseFileError('unsafe-path', 'path-kind');
          return info.directory ? 'directory' as const : 'file' as const;
        });
      } catch (error) {
        if (error instanceof NoReparseFileError && error.code === 'missing') return null;
        throw error;
      }
    },
    assertEmptyDirectory(parts) {
      withFile(parts, {
        desiredAccess: DIRECTORY_ACCESS, shareAccess: FILE_SHARE_READ | FILE_SHARE_WRITE,
        disposition: FILE_OPEN, options: FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, attributes: 0,
      }, (bindings, handle) => {
        assertSafeDirectory(bindings, handle);
        if (!bindings.directoryEmpty(handle)) throw new NoReparseFileError('unsafe-path', 'directory-not-empty');
      });
    },
    displayPath(parts) { return win32.join(displayRoot, ...validateParts(parts)); },
  };
}
