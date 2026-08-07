import { openPosixNoReparseFileTree } from './noReparseFiles.posix.ts';
import {
  NoReparseFileError,
  type NoReparseFileTree,
  type NoReparseTreeOptions,
} from './noReparseFiles.shared.ts';
import { openNoReparseFileTree as openWin32NoReparseFileTree } from '../win32/noReparseFiles.ts';

export { NoReparseFileError } from './noReparseFiles.shared.ts';
export type {
  NoReparseFileInfo,
  NoReparseFileTree,
  NoReparseHashMode,
  NoReparseTreeOptions,
} from './noReparseFiles.shared.ts';

/** The single platform boundary for secure roster/state filesystem access. */
export function openNoReparseFileTree(root: string, options: NoReparseTreeOptions): NoReparseFileTree {
  if (process.platform === 'win32') return openWin32NoReparseFileTree(root, options);
  if (process.platform === 'linux') return openPosixNoReparseFileTree(root, options);
  // Darwin/FreeBSD need a proven descriptor-root run and EMLINK mapping before re-adding.
  throw new NoReparseFileError('unsupported', 'open');
}
