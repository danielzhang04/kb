/**
 * Ensure the Codex CLI trusts an attempt worktree directory BEFORE the roster spawns `codex` into it.
 *
 * WHY THIS EXISTS. On this Windows host (codex-cli 0.146.0) a never-before-trusted `--cd` directory makes
 * `codex` stop at an interactive "Do you trust the contents of this directory?" wall. `--ask-for-approval
 * never` does NOT suppress it; `--dangerously-bypass-approvals-and-sandbox` does but also disables the
 * sandbox (unusable — the roster relies on the workspace-write sandbox for its network-off isolation); and
 * the `-c projects.'<path>'.trust_level="trusted"` CLI flag has no effect. The ONLY working suppression that
 * KEEPS the sandbox enforced is a persistent TOML table in codex's own config:
 *
 *     [projects.'<lowercased-absolute-path>']
 *     trust_level = "trusted"
 *
 * The path is a single-quoted TOML literal (Windows backslashes need no escaping) LOWERCASED exactly as
 * codex writes it. The config lives at `$CODEX_HOME/config.toml`, default `~/.codex/config.toml`. A custom
 * CODEX_HOME also relocates the credential store, so children run under the default CODEX_HOME and this
 * entry must land in the real `~/.codex/config.toml`.
 *
 * The config is keyring-backed (`cli_auth_credentials_store = "keyring"`), so it holds NO secrets — this
 * module reads it only to match the existing entry format and never prints, copies, or transmits it, and
 * never touches `auth.json`.
 *
 * Strip-only floor: no TS enums, parameter properties, or namespaces. ESM with `.ts` specifiers.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface EnsureCodexDirectoryTrustedOptions {
  /** Override the codex home used to locate config.toml. Defaults to $CODEX_HOME then `~/.codex`. */
  codexHome?: string;
}

/** Never read a pathological config.toml into memory; the real file is a few KiB of tables. */
const MAX_CONFIG_BYTES = 1024 * 1024;
/** Bounded wait for the cross-process lock before failing closed rather than racing the write. */
const LOCK_TIMEOUT_MS = 5_000;
/** A lock older than this is treated as abandoned by a crashed writer and broken. The hold is milliseconds. */
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 15;

export class CodexDirectoryTrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexDirectoryTrustError';
  }
}

/** Resolve config.toml the same way codex will when it inherits the daemon's (default) CODEX_HOME. */
function resolveConfigPath(options: EnsureCodexDirectoryTrustedOptions): string {
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
  if (!codexHome || codexHome.includes('\0')) {
    throw new CodexDirectoryTrustError('codex home path is invalid');
  }
  return join(codexHome, 'config.toml');
}

/**
 * The `[projects.'<key>']` key codex writes: the absolute directory, lowercased. Codex stores a single-quoted
 * TOML literal, which cannot represent a `'` or a newline — a path bearing one could not be encoded safely, so
 * reject it rather than corrupt the file.
 */
function codexProjectKey(workDir: string): string {
  if (!workDir || workDir.includes('\0') || !isAbsolute(workDir)) {
    throw new CodexDirectoryTrustError('codex trust work directory must be an absolute path');
  }
  const key = resolve(workDir).toLowerCase();
  if (key.includes("'") || key.includes('\n') || key.includes('\r')) {
    throw new CodexDirectoryTrustError('codex trust work directory cannot be encoded as a TOML literal');
  }
  return key;
}

/** Exact table header line codex writes for a trusted project. */
function projectHeader(key: string): string {
  return `[projects.'${key}']`;
}

/**
 * True when the config already declares this exact project header. Idempotency is header-presence based:
 * codex only ever writes a trusted table under this header, and this module only ever writes `trusted`, so a
 * present header means the wall is already suppressed. Appending a second table under the same header would be
 * invalid TOML, so a present header is always a no-op — never a duplicate.
 */
function hasProjectHeader(content: string, key: string): boolean {
  const header = projectHeader(key);
  for (const line of content.split('\n')) {
    if (line.trim() === header) return true;
  }
  return false;
}

/** Append-only block that preserves every existing byte and separates the new table with one blank line. */
function appendTrustBlock(content: string, key: string): string {
  const table = `[projects.'${key}']\ntrust_level = "trusted"\n`;
  if (content.length === 0) return table;
  const separator = content.endsWith('\n') ? '\n' : '\n\n';
  return `${content}${separator}${table}`;
}

/** Atomic whole-file replace: write a temp sibling, then rename over the target so no reader sees a partial. */
function atomicWrite(path: string, content: string): void {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | null = null;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, content, 'utf8');
    closeSync(fd);
    fd = null;
    renameSync(temp, path);
  } finally {
    if (fd !== null) closeSync(fd);
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
}

/**
 * Acquire a cross-process advisory lock via exclusive file creation. `openSync(..., 'wx')` fails atomically
 * when the lock exists, so concurrent callers — in this process or another — serialize on the same config.
 * A crashed holder's lock is broken once it ages past {@link LOCK_STALE_MS}; the real hold is a few
 * synchronous filesystem calls.
 */
async function withConfigLock<T>(configPath: string, work: () => T): Promise<T> {
  const lockPath = `${configPath}.kb-trust.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number | null = null;
  while (fd === null) {
    try {
      fd = openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new CodexDirectoryTrustError(`codex trust lock is unavailable: ${(error as Error).message}`);
      }
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch { /* the holder released it between our open and stat — just retry */ }
      if (Date.now() >= deadline) throw new CodexDirectoryTrustError('codex trust lock is busy');
      await new Promise((resolvePromise) => { setTimeout(resolvePromise, LOCK_RETRY_MS); });
    }
  }
  try {
    return work();
  } finally {
    closeSync(fd);
    try { rmSync(lockPath, { force: true }); } catch { /* a leaked lock ages out via the stale breaker */ }
  }
}

/** Read config.toml, refusing a pathologically large file. Absent config reads as empty (created on write). */
function readConfig(configPath: string): string {
  if (!existsSync(configPath)) return '';
  if (statSync(configPath).size > MAX_CONFIG_BYTES) {
    throw new CodexDirectoryTrustError('codex config.toml exceeds the expected size');
  }
  return readFileSync(configPath, 'utf8');
}

/**
 * Idempotently ensure codex trusts `workDir`, adding the `[projects.'<lowercased-abs>']` / `trust_level =
 * "trusted"` table to config.toml when absent. Concurrency-safe and append-only: existing entries are
 * preserved byte-for-byte. A no-op when the entry already exists.
 */
export async function ensureCodexDirectoryTrusted(
  workDir: string,
  options: EnsureCodexDirectoryTrustedOptions = {},
): Promise<void> {
  const key = codexProjectKey(workDir);
  const configPath = resolveConfigPath(options);
  mkdirSync(join(configPath, '..'), { recursive: true });
  await withConfigLock(configPath, () => {
    const content = readConfig(configPath);
    if (hasProjectHeader(content, key)) return;
    atomicWrite(configPath, appendTrustBlock(content, key));
  });
}
