import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { renameWithRetrySync } from '../atomicRename.ts';

export type SaveDurability = 'ordinary' | 'deploy-critical';

export interface PersistenceDeps {
  platform: NodeJS.Platform;
  openTemp(path: string): number;
  write(fd: number, encoded: string): void;
  fsync(fd: number): void;
  close(fd: number): void;
  rename(temp: string, target: string): void;
  openDirectory(path: string): number;
  removeTemp(path: string): void;
  recordBestEffortDirectorySyncFailure(error: unknown): void;
}

export function createNodePersistenceDeps(): PersistenceDeps {
  return {
    platform: process.platform,
    openTemp: (path) => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      return openSync(path, 'wx', 0o600);
    },
    write: (fd, encoded) => writeFileSync(fd, encoded, 'utf8'),
    fsync: fsyncSync,
    close: closeSync,
    rename: renameWithRetrySync,
    openDirectory: (path) => openSync(path, 'r'),
    removeTemp: (path) => rmSync(path, { force: true }),
    recordBestEffortDirectorySyncFailure: () => undefined,
  };
}

const NODE_PERSISTENCE_DEPS = createNodePersistenceDeps();

function recordingPersistenceDeps(
  calls: string[],
  platform: NodeJS.Platform,
  delegate?: PersistenceDeps,
): PersistenceDeps {
  let nextDescriptor = 1;
  const descriptorKind = new Map<number, 'temp' | 'dir'>();
  const invoke = <T>(label: string, operation: () => T): T => {
    calls.push(label);
    return operation();
  };
  return {
    platform,
    openTemp: (path) => invoke('open-temp', () => {
      const fd = delegate?.openTemp(path) ?? nextDescriptor++;
      descriptorKind.set(fd, 'temp');
      return fd;
    }),
    write: (fd, encoded) => invoke('write', () => delegate?.write(fd, encoded)),
    fsync: (fd) => invoke(descriptorKind.get(fd) === 'dir' ? 'fsync-dir' : 'fsync-temp', () => delegate?.fsync(fd)),
    close: (fd) => invoke(descriptorKind.get(fd) === 'dir' ? 'close-dir' : 'close-temp', () => delegate?.close(fd)),
    rename: (temp, target) => invoke('rename', () => delegate?.rename(temp, target)),
    openDirectory: (path) => invoke('open-dir', () => {
      const fd = delegate?.openDirectory(path) ?? nextDescriptor++;
      descriptorKind.set(fd, 'dir');
      return fd;
    }),
    removeTemp: (path) => invoke('remove-temp', () => delegate?.removeTemp(path)),
    recordBestEffortDirectorySyncFailure: (error) => invoke(
      'record-best-effort-directory-sync-failure',
      () => delegate?.recordBestEffortDirectorySyncFailure(error),
    ),
  };
}

export function fakePersistenceDeps(calls: string[], platform: NodeJS.Platform): PersistenceDeps {
  return recordingPersistenceDeps(calls, platform);
}

export function spyPersistenceDeps(calls: string[], realDeps: PersistenceDeps): PersistenceDeps {
  return recordingPersistenceDeps(calls, realDeps.platform, realDeps);
}

export function persistControlDocumentSync(
  path: string,
  encoded: string,
  durability: SaveDurability,
  deps: PersistenceDeps = NODE_PERSISTENCE_DEPS,
): void {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let tempFd: number | null = null;
  let dirFd: number | null = null;
  try {
    tempFd = deps.openTemp(temp);
    deps.write(tempFd, encoded);
    if (durability === 'deploy-critical' || deps.platform !== 'linux') deps.fsync(tempFd);
    deps.close(tempFd);
    tempFd = null;
    deps.rename(temp, path);

    if (durability === 'deploy-critical' || deps.platform !== 'linux') {
      if (deps.platform === 'linux') {
        dirFd = deps.openDirectory(dirname(path));
        deps.fsync(dirFd);
        const syncedDirFd = dirFd;
        dirFd = null;
        try { deps.close(syncedDirFd); } catch {}
      } else {
        try {
          dirFd = deps.openDirectory(dirname(path));
          deps.fsync(dirFd);
        } catch (error) {
          deps.recordBestEffortDirectorySyncFailure(error);
        } finally {
          if (dirFd !== null) {
            const openedDirFd = dirFd;
            dirFd = null;
            try { deps.close(openedDirFd); } catch {}
          }
        }
      }
    }
  } catch (error) {
    if (dirFd !== null) {
      try { deps.close(dirFd); } catch {}
      dirFd = null;
    }
    if (tempFd !== null) {
      try { deps.close(tempFd); } catch {}
      tempFd = null;
    }
    try { deps.removeTemp(temp); } catch {}
    throw error;
  }
}
