/**
 * Descriptor-rooted POSIX file access for security-sensitive control files.
 *
 * Each configured-root and relative parent component is opened from the previously pinned directory
 * descriptor with O_NOFOLLOW. Final files are also opened with O_NOFOLLOW and all content I/O uses
 * that descriptor, so replacing a checked component with a symlink cannot redirect the operation.
 * Unlinking or removing by name retains POSIX's inherent unlinkat window; there is no Windows handle-delete parity.
 * Network and FUSE filesystems receive local-disk trust because POSIX has no isFixedLocalDrive analogue here.
 * The sync-only style is load-bearing: descriptor numbers stay safe from recycling because the event loop never turns.
 */
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeSync,
  type Stats,
} from 'node:fs';
import { posix } from 'node:path';
import {
  NoReparseFileError,
  type NoReparseFileTree,
  type NoReparseTreeOptions,
  validateNoReparseParts,
} from './noReparseFiles.shared.ts';

const MAX_UTF8_FILE_BYTES = 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;

interface ErrnoLike {
  code?: unknown;
}

function errnoCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as ErrnoLike).code;
  return typeof code === 'string' ? code : null;
}

function filesystemError(error: unknown, operation: string): never {
  if (error instanceof NoReparseFileError) throw error;
  const code = errnoCode(error);
  if (code === 'ENOENT') throw new NoReparseFileError('missing', operation);
  if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'EISDIR' || code === 'ENAMETOOLONG') {
    throw new NoReparseFileError('unsafe-path', operation);
  }
  throw new NoReparseFileError('io', operation);
}

function fsCall<T>(operation: string, call: () => T): T {
  try {
    return call();
  } catch (error) {
    return filesystemError(error, operation);
  }
}

/** Parse without normalization so ambiguous, drive-like, or dot-component roots fail closed. */
export function parsePosixAbsoluteRoot(root: string): string[] {
  if (root === '/') return [];
  if (!root.startsWith('/') || root.startsWith('//') || root.endsWith('/') || root.includes('\0')) {
    throw new NoReparseFileError('unsafe-path', 'root');
  }
  return validateNoReparseParts(root.slice(1).split('/'));
}

function descriptorRoot(): string {
  return process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd';
}

function descriptorPath(directory: number, name?: string): string {
  const base = `${descriptorRoot()}/${directory}`;
  return name === undefined ? base : `${base}/${name}`;
}

function noFollowFlags(): { directory: number; noFollow: number; nonBlock: number } {
  const directory = constants.O_DIRECTORY;
  const noFollow = constants.O_NOFOLLOW;
  const nonBlock = constants.O_NONBLOCK;
  if (directory === undefined || noFollow === undefined || nonBlock === undefined) {
    throw new NoReparseFileError('unsupported', 'open');
  }
  return { directory, noFollow, nonBlock };
}

function assertSafeDirectory(file: number): Stats {
  const info = fsCall('inspect-directory', () => fstatSync(file));
  if (!info.isDirectory()) throw new NoReparseFileError('unsafe-path', 'directory');
  return info;
}

function assertSafeRegularFile(file: number): Stats {
  const info = fsCall('inspect-file', () => fstatSync(file));
  if (!info.isFile() || info.nlink !== 1 || !Number.isSafeInteger(info.size)) {
    throw new NoReparseFileError('unsafe-path', 'file');
  }
  return info;
}

function openDirectory(path: string): number {
  const flags = noFollowFlags();
  const file = fsCall('open-directory', () => openSync(path, constants.O_RDONLY | flags.directory | flags.noFollow));
  try {
    assertSafeDirectory(file);
    return file;
  } catch (error) {
    closeSync(file);
    throw error;
  }
}

function openDirectoryAt(parent: number, name: string): number {
  return openDirectory(descriptorPath(parent, name));
}

function readExact(file: number, size: number): Buffer {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const count = fsCall('read', () => readSync(file, bytes, offset, size - offset, null));
    if (count <= 0) throw new NoReparseFileError('io', 'read');
    offset += count;
  }
  return bytes;
}

function writeAll(file: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) {
    const count = fsCall('write', () => writeSync(file, bytes, offset, bytes.length - offset, null));
    if (count <= 0) throw new NoReparseFileError('io', 'write');
    offset += count;
  }
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertSameNamedObject(parent: number, name: string, opened: Stats): void {
  const named = fsCall('inspect-path', () => lstatSync(descriptorPath(parent, name)));
  if (named.isSymbolicLink() || !sameIdentity(named, opened)) {
    throw new NoReparseFileError('unsafe-path', 'path-identity');
  }
}

export function openPosixNoReparseFileTree(root: string, options: NoReparseTreeOptions): NoReparseFileTree {
  try {
    closeSync(openDirectory(descriptorRoot()));
  } catch {
    throw new NoReparseFileError('unsupported', 'open');
  }
  const rootParts = parsePosixAbsoluteRoot(root);
  const flags = noFollowFlags();
  let shortWriteBytesOnce = options.testShortWriteBytesOnce;
  if (shortWriteBytesOnce !== undefined && (!Number.isSafeInteger(shortWriteBytesOnce) || shortWriteBytesOnce < 0)) {
    throw new NoReparseFileError('io', 'test-short-write');
  }

  const withRoot = <T>(operation: (rootFile: number) => T): T => {
    let current = openDirectory('/');
    try {
      for (const part of rootParts) {
        if (options.createRoot) {
          try {
            mkdirSync(descriptorPath(current, part), 0o700);
          } catch (error) {
            if (errnoCode(error) !== 'EEXIST') filesystemError(error, 'create-root');
          }
        }
        const next = openDirectoryAt(current, part);
        closeSync(current);
        current = next;
      }
      return operation(current);
    } finally {
      closeSync(current);
    }
  };

  const withParent = <T>(parts: readonly string[], operation: (parent: number, name: string) => T): T => {
    const validated = validateNoReparseParts(parts);
    return withRoot((rootFile) => {
      let current = rootFile;
      let ownsCurrent = false;
      try {
        for (const part of validated.slice(0, -1)) {
          const next = openDirectoryAt(current, part);
          if (ownsCurrent) closeSync(current);
          current = next;
          ownsCurrent = true;
        }
        return operation(current, validated.at(-1) as string);
      } finally {
        if (ownsCurrent) closeSync(current);
      }
    });
  };

  const withFile = <T>(
    parts: readonly string[],
    openFlags: number,
    operation: (file: number, info: Stats, parent: number, name: string) => T,
  ): T => withParent(parts, (parent, name) => {
    const file = fsCall('open', () => openSync(
      descriptorPath(parent, name),
      openFlags | flags.noFollow | flags.nonBlock,
      0o600,
    ));
    try {
      const info = assertSafeRegularFile(file);
      return operation(file, info, parent, name);
    } finally {
      closeSync(file);
    }
  });

  const withDirectory = <T>(
    parts: readonly string[],
    operation: (file: number, info: Stats, parent: number, name: string) => T,
  ): T => withParent(parts, (parent, name) => {
    const file = openDirectoryAt(parent, name);
    try {
      return operation(file, assertSafeDirectory(file), parent, name);
    } finally {
      closeSync(file);
    }
  });

  const writeWithFault = (file: number, bytes: Buffer): void => {
    if (shortWriteBytesOnce !== undefined) {
      const length = Math.min(shortWriteBytesOnce, bytes.length);
      shortWriteBytesOnce = undefined;
      if (length > 0) writeAll(file, bytes.subarray(0, length));
      throw new NoReparseFileError('io', 'injected-short-write');
    }
    writeAll(file, bytes);
  };

  return {
    ensureDir(parts) {
      const validated = validateNoReparseParts(parts);
      withRoot((rootFile) => {
        let current = rootFile;
        let ownsCurrent = false;
        try {
          for (const part of validated) {
            try {
              mkdirSync(descriptorPath(current, part), 0o700);
            } catch (error) {
              if (errnoCode(error) !== 'EEXIST') filesystemError(error, 'create-directory');
            }
            const next = openDirectoryAt(current, part);
            if (ownsCurrent) closeSync(current);
            current = next;
            ownsCurrent = true;
          }
        } finally {
          if (ownsCurrent) closeSync(current);
        }
      });
    },
    readUtf8(parts, maxBytes = MAX_UTF8_FILE_BYTES) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_UTF8_FILE_BYTES) {
        throw new NoReparseFileError('io', 'read');
      }
      try {
        return withFile(parts, constants.O_RDONLY, (file, info) => {
          if (info.size > maxBytes) throw new NoReparseFileError('io', 'read');
          try {
            return new TextDecoder('utf-8', { fatal: true }).decode(readExact(file, info.size));
          } catch (error) {
            return filesystemError(error, 'read');
          }
        });
      } catch (error) {
        if (error instanceof NoReparseFileError && error.code === 'missing') return null;
        throw error;
      }
    },
    writeUtf8(parts, contents) {
      const bytes = Buffer.from(contents, 'utf8');
      if (bytes.length > MAX_UTF8_FILE_BYTES) throw new NoReparseFileError('io', 'write');
      withFile(parts, constants.O_RDWR | constants.O_CREAT, (file) => {
        fsCall('truncate', () => ftruncateSync(file, 0));
        writeAll(file, bytes);
      });
    },
    completeUtf8FromPrefix(parts, contents) {
      const expected = Buffer.from(contents, 'utf8');
      if (expected.length > MAX_UTF8_FILE_BYTES) throw new NoReparseFileError('io', 'complete');
      withFile(parts, constants.O_RDWR | constants.O_CREAT, (file, info) => {
        if (info.size > expected.length) throw new NoReparseFileError('unsafe-path', 'complete-prefix');
        const current = readExact(file, info.size);
        if (!expected.subarray(0, current.length).equals(current)) {
          throw new NoReparseFileError('unsafe-path', 'complete-prefix');
        }
        if (current.length < expected.length) writeWithFault(file, expected.subarray(current.length));
      });
    },
    appendUtf8IfExact(parts, expected, suffix) {
      const baseline = Buffer.from(expected, 'utf8');
      const replacement = Buffer.from(`${expected}${suffix}`, 'utf8');
      if (replacement.length > MAX_UTF8_FILE_BYTES) throw new NoReparseFileError('io', 'append');
      const openFlags = constants.O_RDWR | (baseline.length === 0 ? constants.O_CREAT : 0);
      withFile(parts, openFlags, (file, info) => {
        if (info.size < baseline.length || info.size > replacement.length) {
          throw new NoReparseFileError('unsafe-path', 'append-baseline');
        }
        const current = readExact(file, info.size);
        if (!replacement.subarray(0, current.length).equals(current)) {
          throw new NoReparseFileError('unsafe-path', 'append-baseline');
        }
        if (current.length < replacement.length) writeWithFault(file, replacement.subarray(current.length));
      });
    },
    deleteFileIfPresent(parts) {
      try {
        withFile(parts, constants.O_RDONLY, (_file, info, parent, name) => {
          assertSameNamedObject(parent, name, info);
          fsCall('delete-file', () => unlinkSync(descriptorPath(parent, name)));
        });
      } catch (error) {
        if (error instanceof NoReparseFileError && error.code === 'missing') return;
        throw error;
      }
    },
    deleteEmptyDirIfPresent(parts) {
      try {
        withDirectory(parts, (_file, info, parent, name) => {
          assertSameNamedObject(parent, name, info);
          fsCall('delete-directory', () => rmdirSync(descriptorPath(parent, name)));
        });
      } catch (error) {
        if (error instanceof NoReparseFileError && error.code === 'missing') return;
        throw error;
      }
    },
    inspectRegularFile(parts, hashMode) {
      try {
        return withFile(parts, constants.O_RDONLY, (file, info) => {
          const includeHash = hashMode === 'always' || (typeof hashMode === 'number' && info.size === hashMode);
          if (!includeHash) return { size: info.size, sha256: null, identity: `${info.dev}:${info.ino}` };
          const hash = createHash('sha256');
          let remaining = info.size;
          while (remaining > 0) {
            const length = Math.min(HASH_CHUNK_BYTES, remaining);
            hash.update(readExact(file, length));
            remaining -= length;
          }
          return { size: info.size, sha256: hash.digest('hex'), identity: `${info.dev}:${info.ino}` };
        });
      } catch (error) {
        if (error instanceof NoReparseFileError && error.code === 'missing') return null;
        throw error;
      }
    },
    pathKind(parts) {
      try {
        return withParent(parts, (parent, name) => {
          const file = fsCall('open', () => openSync(
            descriptorPath(parent, name),
            constants.O_RDONLY | flags.noFollow | flags.nonBlock,
          ));
          try {
            const info = fsCall('inspect-path-kind', () => fstatSync(file));
            if (info.isDirectory()) return 'directory' as const;
            if (info.isFile() && info.nlink === 1) return 'file' as const;
            throw new NoReparseFileError('unsafe-path', 'path-kind');
          } finally {
            closeSync(file);
          }
        });
      } catch (error) {
        if (error instanceof NoReparseFileError && error.code === 'missing') return null;
        throw error;
      }
    },
    assertEmptyDirectory(parts) {
      withDirectory(parts, (file) => {
        const entries = fsCall('enumerate-directory', () => readdirSync(descriptorPath(file)));
        if (entries.length !== 0) throw new NoReparseFileError('unsafe-path', 'directory-not-empty');
      });
    },
    displayPath(parts) {
      return posix.join(root, ...validateNoReparseParts(parts));
    },
  };
}
