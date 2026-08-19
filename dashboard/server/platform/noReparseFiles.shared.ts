export interface NoReparseFileInfo {
  size: number;
  sha256: string | null;
  identity: string;
}

export type NoReparseHashMode = 'always' | 'never' | number;

/** A filesystem result that is unsafe or otherwise unusable; it intentionally has no file contents. */
export class NoReparseFileError extends Error {
  readonly code: 'unsupported' | 'unsafe-path' | 'missing' | 'io';
  /** NTSTATUS is Windows diagnostic metadata only; callers must not surface file contents or secrets. */
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

export interface NoReparseTreeOptions {
  createRoot: boolean;
  /** Direct filesystem-layer fault injection for crash-recovery tests; never set by production wiring. */
  testShortWriteBytesOnce?: number;
}

export function validateNoReparseParts(parts: readonly string[]): string[] {
  if (parts.length === 0) throw new NoReparseFileError('unsafe-path', 'path');
  const device = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  return parts.map((part) => {
    if (!part || part === '.' || part === '..' || /[\\/:\0]/.test(part) || /[. ]$/.test(part) || device.test(part)) {
      throw new NoReparseFileError('unsafe-path', 'path');
    }
    return part;
  });
}
