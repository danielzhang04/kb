import { createRequire } from 'node:module';
import { win32 as windowsPath } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';

import { buildChildEnv } from '../control/childEnv.ts';
import {
  buildReadScopeSettings,
  createWorkflowToolPolicyResolver,
  type ClaudeToolPolicy,
} from '../control/claudeLaunchPolicy.ts';
import { codexSandboxMode } from '../control/workflowProfiles.ts';
import type {
  LaunchRecipe,
  PortResult,
  SessionHostRequest,
  SessionLauncher,
  SessionSize,
} from './contracts.ts';

type WindowsEnvironment = Record<string, string | undefined>;

export type WindowsLauncherPaths = {
  shell: string;
  claude: string;
  codexShim: string;
  codexEntry: string;
  node: string;
};

export type WindowsLaunchProfile = {
  launcher: SessionLauncher;
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  validationPaths: string[];
  rootValidationPaths: string[];
  codexShim: string | null;
  codexEntry: string | null;
};

export type WindowsPinnedPath = {
  path: string;
  fileId: string;
  canonicalPath: string;
  ownerSid: string;
  unsafeWriteAce: boolean;
  currentFileId(): Promise<string>;
  close(): Promise<void>;
};

export type WindowsPathPinInspector = {
  pin(path: string): Promise<WindowsPinnedPath>;
  readText(path: string): Promise<string>;
};

export type WindowsPinnedLaunch = {
  recheck(): Promise<boolean>;
  release(): Promise<void>;
};

export type WindowsLaunchRecipeOptions = {
  environment: WindowsEnvironment;
  rootPath: string;
  /**
   * The server-owned workflow profile table, for tests and for a caller that wants to inject one;
   * production leaves it undefined and `createWorkflowToolPolicyResolver` loads the real table. It is
   * named for claude for historical reasons but BOTH launchers resolve through it — codex has no
   * `--allowedTools`, so its profile decides the sandbox mode instead (`codexSandboxMode`).
   */
  claudeProfiles?: readonly { id: string; allowedTools: readonly string[] }[];
  claudeScopes?: Readonly<Record<string, { readScope: readonly string[]; writeScope: readonly string[] }>>;
  claudePermissionMode?: string;
};

export const CODEX_CONFIGURATION_PINS: readonly string[] = [
  '-c', 'approval_policy=never',
  '-c', 'forced_login_method="chatgpt"',
  '-c', 'mcp_servers={}',
  '-c', 'sandbox_workspace_write.network_access=false',
  '-c', 'web_search="disabled"',
];

/** Sentinel resolved inside the native inspector to the current process token's exact SID. */
export const CURRENT_PROCESS_SERVICE_SID = 'CURRENT_PROCESS_USER';

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/;
const POLICY_RE = /^[a-z][a-z0-9-]{0,63}$/;
const RESUME_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RESERVED_SEGMENT_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const UNSAFE_DISPLAY_RE = /[\0-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

export function isApprovedLocalWindowsRoot(root: string): boolean {
  return typeof root === 'string' && root.length > 0 && windowsPath.isAbsolute(root)
    && !root.startsWith('\\\\');
}

function requiredRoot(environment: WindowsEnvironment, name: string): string {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim() === '' || !isApprovedLocalWindowsRoot(value)) {
    throw new Error(`missing Windows service root: ${name}`);
  }
  return windowsPath.normalize(value);
}

/** Derive launchers only from the service identity. PATH is never consulted. */
export function deriveWindowsLauncherPaths(environment: WindowsEnvironment): WindowsLauncherPaths {
  const systemRoot = requiredRoot(environment, 'SystemRoot');
  const userProfile = requiredRoot(environment, 'USERPROFILE');
  const appData = requiredRoot(environment, 'APPDATA');
  const programFiles = requiredRoot(environment, 'ProgramFiles');
  return {
    shell: windowsPath.join(systemRoot, 'System32', 'cmd.exe'),
    claude: windowsPath.join(userProfile, '.local', 'bin', 'claude.exe'),
    codexShim: windowsPath.join(appData, 'npm', 'codex.cmd'),
    codexEntry: windowsPath.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    node: windowsPath.join(programFiles, 'nodejs', 'node.exe'),
  };
}

const WINDOWS_CHILD_ALLOWLIST = [
  'SYSTEMROOT', 'SystemRoot', 'SYSTEMDRIVE', 'SystemDrive', 'WINDIR', 'windir',
  'COMSPEC', 'ComSpec', 'TEMP', 'TMP', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE',
  'USERNAME', 'USERDOMAIN', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'TZ',
] as const;

export function createWindowsChildEnv(
  environment: WindowsEnvironment,
  size: SessionSize,
): Record<string, string> {
  const child = buildChildEnv(environment, WINDOWS_CHILD_ALLOWLIST);
  child.TERM = 'xterm-256color';
  child.COLUMNS = String(size.cols);
  child.LINES = String(size.rows);
  return child;
}

function validSize(size: SessionSize): boolean {
  return Number.isInteger(size.cols) && size.cols >= 20 && size.cols <= 500
    && Number.isInteger(size.rows) && size.rows >= 5 && size.rows <= 200;
}

export function isSafeRelativeWindowsCwd(relativeCwd: string): boolean {
  if (typeof relativeCwd !== 'string' || Buffer.byteLength(relativeCwd, 'utf8') > 240
    || UNSAFE_DISPLAY_RE.test(relativeCwd) || windowsPath.isAbsolute(relativeCwd)
    || /^[A-Za-z]:/.test(relativeCwd) || relativeCwd.startsWith('\\\\') || relativeCwd.includes('\\')) {
    return false;
  }
  if (relativeCwd === '') return true;
  const segments = relativeCwd.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'
    && !segment.endsWith('.') && !segment.endsWith(' ') && !RESERVED_SEGMENT_RE.test(segment));
}

function recipeIsWellFormed(recipe: LaunchRecipe): boolean {
  if (!POLICY_RE.test(recipe.toolPolicyId)) return false;
  if (recipe.model !== null && !MODEL_RE.test(recipe.model)) return false;
  if (recipe.resumeRef !== undefined && !RESUME_RE.test(recipe.resumeRef)) return false;
  if (recipe.launcher === 'shell') {
    return recipe.mode === 'interactive' && recipe.model === null && recipe.sandbox === 'interactive'
      && recipe.resumeRef === undefined;
  }
  if (recipe.model === null) return false;
  if (recipe.launcher === 'claude') return recipe.sandbox === 'claude-policy';
  return recipe.sandbox === 'codex-workspace-write';
}

function chain(root: string, leaf: string): string[] {
  const normalizedRoot = windowsPath.normalize(root);
  const normalizedLeaf = windowsPath.normalize(leaf);
  const relative = windowsPath.relative(normalizedRoot, normalizedLeaf);
  if (relative.startsWith('..') || windowsPath.isAbsolute(relative)) return [normalizedLeaf];
  const result = [normalizedRoot];
  let current = normalizedRoot;
  for (const segment of relative.split('\\')) {
    current = windowsPath.join(current, segment);
    result.push(current);
  }
  return result;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((candidate) => {
    const key = candidate.toLocaleLowerCase('en-US');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function refusal(): PortResult<never> {
  return { ok: false, refusal: 'invalid-request', detail: null };
}

/**
 * Resolve the server-owned profile the recipe NAMES, on this side of the wire, for EITHER launcher.
 * `createWorkflowToolPolicyResolver` throws `ToolPolicyRefusal` on an id that names nothing
 * server-owned, and `mapWindowsLaunchRecipe`'s enclosing catch turns that into `invalid-request` — so
 * an unknown id is REFUSED. That is deliberate and load-bearing for codex: the alternative, carrying
 * on with a default, would mean defaulting to the more permissive sandbox for exactly the ids nobody
 * approved. Failing closed is the only acceptable answer here.
 */
function resolveWorkflowPolicy(
  recipe: LaunchRecipe,
  options: WindowsLaunchRecipeOptions,
): ClaudeToolPolicy {
  const resolver = createWorkflowToolPolicyResolver({
    permissionMode: options.claudePermissionMode,
    profiles: options.claudeProfiles,
  });
  return resolver(recipe.toolPolicyId);
}

function resolveClaudePolicy(
  recipe: LaunchRecipe,
  options: WindowsLaunchRecipeOptions,
): { policy: ClaudeToolPolicy; settings: string | undefined } {
  const policy = resolveWorkflowPolicy(recipe, options);
  const scopes = options.claudeScopes?.[recipe.toolPolicyId] ?? { readScope: [], writeScope: [] };
  return {
    policy,
    settings: buildReadScopeSettings({
      allowedTools: policy.allowedTools,
      readScope: scopes.readScope,
      writeScope: scopes.writeScope,
      repoRoot: options.rootPath,
    }),
  };
}

/** Map the closed recipe to one server-owned executable/argv pair. */
export function mapWindowsLaunchRecipe(
  request: SessionHostRequest,
  options: WindowsLaunchRecipeOptions,
): PortResult<WindowsLaunchProfile> {
  try {
    if (!recipeIsWellFormed(request.recipe) || !validSize(request)
      || !isApprovedLocalWindowsRoot(options.rootPath) || !isSafeRelativeWindowsCwd(request.relativeCwd)) {
      return refusal();
    }
    const paths = deriveWindowsLauncherPaths(options.environment);
    const cwd = request.relativeCwd === ''
      ? windowsPath.normalize(options.rootPath)
      : windowsPath.join(options.rootPath, request.relativeCwd);
    const env = createWindowsChildEnv(options.environment, request);
    const rootValidationPaths = uniquePaths(chain(options.rootPath, cwd));
    const { recipe } = request;
    if (recipe.launcher === 'shell') {
      return { ok: true, value: {
        launcher: 'shell', file: paths.shell, args: [], cwd, env,
        validationPaths: uniquePaths([
          ...chain(requiredRoot(options.environment, 'SystemRoot'), paths.shell),
          ...rootValidationPaths,
        ]),
        rootValidationPaths,
        codexShim: null, codexEntry: null,
      } };
    }
    if (recipe.launcher === 'claude') {
      const { policy, settings } = resolveClaudePolicy(recipe, options);
      const args = recipe.mode === 'headless-json'
        ? ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose']
        : [];
      if (settings !== undefined) args.push('--settings', settings);
      args.push('--model', recipe.model as string);
      if (recipe.resumeRef !== undefined) args.push('--resume', recipe.resumeRef);
      args.push('--allowedTools', policy.allowedTools.join(','), '--permission-mode', policy.permissionMode);
      return { ok: true, value: {
        launcher: 'claude', file: paths.claude, args, cwd, env,
        validationPaths: uniquePaths([
          ...chain(requiredRoot(options.environment, 'USERPROFILE'), paths.claude),
          ...rootValidationPaths,
        ]),
        rootValidationPaths,
        codexShim: null, codexEntry: null,
      } };
    }
    // A codex worker carries no `--allowedTools`; its only real cap is the sandbox, so the profile the
    // recipe names has to reach the child as `-s`/`sandbox_mode` or it reaches the child as nothing at
    // all. `-s workspace-write` used to be a hardcoded literal here (`recipe.sandbox` is the frame's
    // launcher discriminator, never a mode), so `checker-readonly` and `producer` produced identical
    // argv: the review stages of orgs/faceless-youtube/workflows/iteration-loop-demo.md, whose work
    // orders read "Read only ... Never edit the artifact", launched with unattended write and command
    // execution across the worktree under `approval_policy=never`. The Linux broker was fixed in
    // 5996b9c6; this is the same derivation, from the same table, so the two cannot disagree.
    const sandboxMode = codexSandboxMode(resolveWorkflowPolicy(recipe, options).allowedTools);
    // `exec resume` accepts no `-s/--sandbox` flag — plain `exec` offers
    // `-s [read-only, workspace-write, danger-full-access]` and resume offers only `-c`, `--last`, `-m`
    // — so the resume branch pins the config key that flag sets instead. Without it a resumed session
    // inherited whatever the CLI defaulted to and could silently outrank the fresh launch it continues.
    // `CODEX_CONFIGURATION_PINS` STAYS LAST in every branch (only `--cd`/`-C <cwd>` may follow): codex
    // is last-wins on `-c`, and that ordering is what keeps `approval_policy=never`, `mcp_servers={}`,
    // `sandbox_workspace_write.network_access=false` and `web_search="disabled"` un-overridable.
    const args = recipe.mode === 'headless-json'
      ? recipe.resumeRef === undefined
        ? ['exec', '-', '--json', '--model', recipe.model as string, '-s', sandboxMode,
            ...CODEX_CONFIGURATION_PINS, '--cd', cwd]
        : ['exec', 'resume', recipe.resumeRef, '-', '--json', '-c', `model=${recipe.model}`,
            '-c', `sandbox_mode="${sandboxMode}"`, ...CODEX_CONFIGURATION_PINS]
      : ['--model', recipe.model as string, '-s', sandboxMode, ...CODEX_CONFIGURATION_PINS, '-C', cwd];
    const appData = requiredRoot(options.environment, 'APPDATA');
    const programFiles = requiredRoot(options.environment, 'ProgramFiles');
    return { ok: true, value: {
      launcher: 'codex', file: paths.node, args: [paths.codexEntry, ...args], cwd, env,
      validationPaths: uniquePaths([
        ...chain(appData, paths.codexShim),
        ...chain(appData, paths.codexEntry),
        ...chain(programFiles, paths.node),
        ...rootValidationPaths,
      ]),
      rootValidationPaths,
      codexShim: paths.codexShim,
      codexEntry: paths.codexEntry,
    } };
  } catch {
    return refusal();
  }
}

/** Build the policy-only profile used by the public probe; it is pinned by the launch validator. */
export function createWindowsLauncherProbeProfile(
  launcher: SessionLauncher,
  environment: WindowsEnvironment,
  rootPath: string,
): PortResult<WindowsLaunchProfile> {
  try {
    if (!isApprovedLocalWindowsRoot(rootPath)) return refusal();
    const paths = deriveWindowsLauncherPaths(environment);
    const cwd = windowsPath.normalize(rootPath);
    const rootValidationPaths = uniquePaths(chain(rootPath, cwd));
    const env = createWindowsChildEnv(environment, { cols: 80, rows: 24 });
    if (launcher === 'shell') {
      return { ok: true, value: {
        launcher, file: paths.shell, args: [], cwd, env,
        validationPaths: uniquePaths([
          ...chain(requiredRoot(environment, 'SystemRoot'), paths.shell), ...rootValidationPaths,
        ]),
        rootValidationPaths, codexShim: null, codexEntry: null,
      } };
    }
    if (launcher === 'claude') {
      return { ok: true, value: {
        launcher, file: paths.claude, args: [], cwd, env,
        validationPaths: uniquePaths([
          ...chain(requiredRoot(environment, 'USERPROFILE'), paths.claude), ...rootValidationPaths,
        ]),
        rootValidationPaths, codexShim: null, codexEntry: null,
      } };
    }
    return { ok: true, value: {
      launcher, file: paths.node, args: [paths.codexEntry], cwd, env,
      validationPaths: uniquePaths([
        ...chain(requiredRoot(environment, 'APPDATA'), paths.codexShim),
        ...chain(requiredRoot(environment, 'APPDATA'), paths.codexEntry),
        ...chain(requiredRoot(environment, 'ProgramFiles'), paths.node),
        ...rootValidationPaths,
      ]),
      rootValidationPaths, codexShim: paths.codexShim, codexEntry: paths.codexEntry,
    } };
  } catch {
    return refusal();
  }
}

const SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';
const TRUSTED_INSTALLER_SID = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';

function allowedOwner(ownerSid: string, serviceSid: string, shell: boolean): boolean {
  const privileged = ownerSid === SYSTEM_SID || ownerSid === ADMINISTRATORS_SID
    || ownerSid === TRUSTED_INSTALLER_SID;
  return privileged || (!shell && ownerSid === serviceSid);
}

function normalizeComparable(path: string): string {
  const withoutDevicePrefix = path.startsWith('\\\\?\\') ? path.slice(4) : path;
  return windowsPath.normalize(withoutDevicePrefix).toLocaleLowerCase('en-US');
}

function codexShimTargetsExactEntry(shimPath: string, entryPath: string, encoded: string): boolean {
  if (Buffer.byteLength(encoded, 'utf8') > 65_536 || UNSAFE_DISPLAY_RE.test(encoded.replace(/[\r\n\t]/g, ''))) {
    return false;
  }
  const mentions = [...encoded.matchAll(/(?:"([^"\r\n]*codex\.js)"|([^\s"&|<>]*codex\.js))/gi)]
    .map((match) => match[1] ?? match[2])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (mentions.length === 0) return false;
  const shimDirectory = windowsPath.dirname(shimPath);
  return mentions.every((mention) => {
    const slashed = mention.replace(/\//g, '\\');
    const expanded = slashed
      .replace(/^%dp0%\\?/i, `${shimDirectory}\\`)
      .replace(/^%~dp0\\?/i, `${shimDirectory}\\`);
    const absolute = windowsPath.isAbsolute(expanded) ? expanded : windowsPath.join(shimDirectory, expanded);
    return normalizeComparable(absolute) === normalizeComparable(entryPath);
  });
}

type NativeFileInformation = {
  volume: number;
  indexHigh: number;
  indexLow: number;
};

type NativeAclInformation = { aceCount: number; aclBytesInUse: number; aclBytesFree: number };

type KoffiSurface = typeof import('koffi');

/**
 * Native Win32 pins: CreateFileW omits FILE_SHARE_DELETE, rejects reparse components, and keeps
 * every handle alive until the caller completes its post-spawn identity check.
 */
/** The closed refusal for asking for a Win32-only surface on a machine that has none. */
export class WindowsPlatformUnsupportedError extends Error {
  constructor(platform: NodeJS.Platform = process.platform) {
    super(`Windows path pins require win32, not ${platform}`);
    this.name = 'WindowsPlatformUnsupportedError';
  }
}

export function createWindowsPathPinInspector(
  serviceSid: string = CURRENT_PROCESS_SERVICE_SID,
): WindowsPathPinInspector {
  if (process.platform !== 'win32') throw new WindowsPlatformUnsupportedError();
  const nodeRequire = createRequire(import.meta.url);
  const koffi = nodeRequire('koffi') as KoffiSurface;
  const kernel32 = koffi.load('kernel32.dll');
  const advapi32 = koffi.load('advapi32.dll');
  const fileTime = koffi.struct({ low: 'uint32', high: 'uint32' });
  const fileInformation = koffi.struct({
    attributes: 'uint32',
    created: fileTime,
    accessed: fileTime,
    written: fileTime,
    volume: 'uint32',
    sizeHigh: 'uint32',
    sizeLow: 'uint32',
    links: 'uint32',
    indexHigh: 'uint32',
    indexLow: 'uint32',
  });
  const aclInformation = koffi.struct({
    aceCount: 'uint32', aclBytesInUse: 'uint32', aclBytesFree: 'uint32',
  });
  const createFile = kernel32.func('void *CreateFileW(str16,uint32,uint32,void *,uint32,uint32,void *)');
  const closeHandle = kernel32.func('bool CloseHandle(void *)');
  const getFileInformation = kernel32.func(
    'GetFileInformationByHandle', 'bool', ['void *', koffi.out(koffi.pointer(fileInformation))],
  );
  const getFileAttributes = kernel32.func('uint32 GetFileAttributesW(str16)');
  const getNamedSecurity = advapi32.func(
    'uint32 GetNamedSecurityInfoW(str16,uint32,uint32,void *,void *,void *,void *,void *)',
  );
  const getAclInformation = advapi32.func(
    'GetAclInformation', 'bool', ['void *', koffi.out(koffi.pointer(aclInformation)), 'uint32', 'uint32'],
  );
  const getAce = advapi32.func('bool GetAce(void *,uint32,void *)');
  const equalSid = advapi32.func('bool EqualSid(void *,void *)');
  const validSid = advapi32.func('bool IsValidSid(void *)');
  const convertSid = advapi32.func('bool ConvertStringSidToSidW(str16,void *)');
  const getCurrentProcess = kernel32.func('void *GetCurrentProcess()');
  const openProcessToken = advapi32.func('bool OpenProcessToken(void *,uint32,void *)');
  const getTokenInformation = advapi32.func('bool GetTokenInformation(void *,uint32,void *,uint32,void *)');
  const localFree = kernel32.func('void *LocalFree(void *)');

  const pointerHolder = (): unknown => koffi.alloc('void *', 1);
  const decodePointer = (holder: unknown): unknown => koffi.decode(holder, 'void *');
  const badHandle = (handle: unknown): boolean => {
    if (handle === null) return true;
    const address = koffi.address(handle);
    return address === 0n || BigInt.asUintN(process.arch === 'x64' ? 64 : 32, address)
      === BigInt.asUintN(process.arch === 'x64' ? 64 : 32, -1n);
  };
  const sidFromString = (sid: string): unknown => {
    const holder = pointerHolder();
    if (!convertSid(sid, holder)) throw new Error('invalid trusted SID');
    return decodePointer(holder);
  };
  const currentUserSid = (): { sid: unknown; backing: unknown } => {
    const tokenHolder = pointerHolder();
    if (!openProcessToken(getCurrentProcess(), 0x0008, tokenHolder)) throw new Error('token unavailable');
    const token = decodePointer(tokenHolder);
    try {
      const length = koffi.alloc('uint32', 1);
      getTokenInformation(token, 1, null, 0, length);
      const required = koffi.decode(length, 'uint32') as number;
      if (!Number.isInteger(required) || required <= 0 || required > 65_536) throw new Error('token size invalid');
      const backing = koffi.alloc('uint8', required);
      if (!getTokenInformation(token, 1, backing, required, length)) throw new Error('token identity unavailable');
      return { sid: koffi.decode(backing, 'void *'), backing };
    } finally {
      closeHandle(token);
    }
  };
  const serviceIdentity = serviceSid === CURRENT_PROCESS_SERVICE_SID
    ? currentUserSid()
    : { sid: sidFromString(serviceSid), backing: null as unknown };
  void serviceIdentity.backing;
  const trusted = [
    { label: serviceSid, sid: serviceIdentity.sid },
    { label: SYSTEM_SID, sid: sidFromString(SYSTEM_SID) },
    { label: ADMINISTRATORS_SID, sid: sidFromString(ADMINISTRATORS_SID) },
    { label: TRUSTED_INSTALLER_SID, sid: sidFromString(TRUSTED_INSTALLER_SID) },
  ];

  const trustedLabel = (sid: unknown): string | null => {
    if (!validSid(sid)) return null;
    return trusted.find((candidate) => equalSid(sid, candidate.sid))?.label ?? null;
  };
  const fileIdFor = (handle: unknown): string => {
    const information = {} as NativeFileInformation;
    if (!getFileInformation(handle, information)) throw new Error('file identity unavailable');
    return `${information.volume >>> 0}:${information.indexHigh >>> 0}:${information.indexLow >>> 0}`;
  };
  const openPinned = (path: string): unknown => {
    const attributes = getFileAttributes(path) as number;
    if (attributes === 0xffff_ffff || (attributes & 0x0000_0400) !== 0) {
      throw new Error('missing or reparse launcher component');
    }
    const handle = createFile(
      path,
      0x0000_0080,
      0x0000_0001 | 0x0000_0002,
      null,
      3,
      0x0200_0000 | 0x0020_0000,
      null,
    );
    if (badHandle(handle)) throw new Error('launcher component cannot be pinned');
    return handle;
  };
  const security = (path: string): { ownerSid: string; unsafeWriteAce: boolean } => {
    const ownerHolder = pointerHolder();
    const daclHolder = pointerHolder();
    const descriptorHolder = pointerHolder();
    const status = getNamedSecurity(path, 1, 0x0000_0001 | 0x0000_0004,
      ownerHolder, null, daclHolder, null, descriptorHolder) as number;
    if (status !== 0) throw new Error('launcher ACL unavailable');
    const descriptor = decodePointer(descriptorHolder);
    try {
      const owner = decodePointer(ownerHolder);
      const ownerSid = trustedLabel(owner) ?? 'UNTRUSTED_OWNER';
      const dacl = decodePointer(daclHolder);
      if (dacl === null) return { ownerSid, unsafeWriteAce: true };
      const information = {} as NativeAclInformation;
      if (!getAclInformation(dacl, information, koffi.sizeof(aclInformation), 2)) {
        throw new Error('launcher ACL invalid');
      }
      let unsafeWriteAce = false;
      for (let index = 0; index < information.aceCount; index += 1) {
        const aceHolder = pointerHolder();
        if (!getAce(dacl, index, aceHolder)) throw new Error('launcher ACE unavailable');
        const ace = decodePointer(aceHolder);
        const aceType = koffi.decode(ace, 0, 'uint8') as number;
        const aceFlags = koffi.decode(ace, 1, 'uint8') as number;
        const allowedAce = aceType === 0 || aceType === 5 || aceType === 9 || aceType === 11;
        if (!allowedAce || (aceFlags & 0x08) !== 0) continue;
        const mask = (koffi.decode(ace, 4, 'uint32') as number) >>> 0;
        const writeMask = 0x1000_0000 | 0x4000_0000 | 0x0001_0000 | 0x0004_0000 | 0x0008_0000
          | 0x0000_0002 | 0x0000_0004 | 0x0000_0010 | 0x0000_0040 | 0x0000_0100;
        if ((mask & writeMask) === 0) continue;
        let sidOffset = 8;
        if (aceType === 5 || aceType === 11) {
          const objectFlags = (koffi.decode(ace, 8, 'uint32') as number) >>> 0;
          sidOffset = 12 + ((objectFlags & 0x1) !== 0 ? 16 : 0) + ((objectFlags & 0x2) !== 0 ? 16 : 0);
        }
        const sid = koffi.as(koffi.address(ace) + BigInt(sidOffset), 'void *');
        if (trustedLabel(sid) === null) {
          unsafeWriteAce = true;
          break;
        }
      }
      return { ownerSid, unsafeWriteAce };
    } finally {
      localFree(descriptor);
    }
  };

  return {
    async pin(path) {
      const handle = openPinned(path);
      try {
        const fileId = fileIdFor(handle);
        const acl = security(path);
        let closed = false;
        return {
          path,
          fileId,
          canonicalPath: await realpath(path),
          ...acl,
          async currentFileId() {
            if (closed) return '';
            const current = openPinned(path);
            try { return fileIdFor(current); } finally { closeHandle(current); }
          },
          async close() {
            if (closed) return;
            closed = true;
            closeHandle(handle);
          },
        };
      } catch (error) {
        closeHandle(handle);
        throw error;
      }
    },
    async readText(path) { return readFile(path, 'utf8'); },
  };
}

/** Hold no-delete-sharing pins over spawn, then compare volume/file identities. */
export async function pinWindowsLauncher(
  launch: WindowsLaunchProfile,
  inspector: WindowsPathPinInspector,
  serviceSid: string,
  platform: NodeJS.Platform = process.platform,
): Promise<PortResult<WindowsPinnedLaunch>> {
  // Pinning is a Win32-only operation (no-delete-sharing handles, owner SIDs, volume/file ids).
  // Off win32 there is nothing to pin, so refuse through the closed launcher refusal before the
  // inspector — and therefore any Win32 API — is touched.
  if (platform !== 'win32') return { ok: false, refusal: 'launcher-unavailable', detail: null };
  const pins: WindowsPinnedPath[] = [];
  const rootPaths = new Set(launch.rootValidationPaths.map(normalizeComparable));
  let refusalCode: 'unsafe-root' | 'launcher-unavailable' = 'launcher-unavailable';
  const release = async (): Promise<void> => {
    for (const pin of [...pins].reverse()) {
      try { await pin.close(); } catch { /* every remaining handle must still be attempted */ }
    }
  };
  try {
    for (const path of launch.validationPaths) {
      refusalCode = rootPaths.has(normalizeComparable(path)) ? 'unsafe-root' : 'launcher-unavailable';
      const pin = await inspector.pin(path);
      if (normalizeComparable(pin.canonicalPath) !== normalizeComparable(path)) {
        await pin.close();
        throw new Error('non-canonical Windows path');
      }
      const shellExecutable = launch.launcher === 'shell'
        && normalizeComparable(path) === normalizeComparable(launch.file);
      if (!allowedOwner(pin.ownerSid, serviceSid, shellExecutable) || pin.unsafeWriteAce) {
        await pin.close();
        throw new Error('unsafe launcher ACL');
      }
      pins.push(pin);
    }
    refusalCode = 'launcher-unavailable';
    if (launch.codexShim !== null && launch.codexEntry !== null) {
      const shim = await inspector.readText(launch.codexShim);
      if (!codexShimTargetsExactEntry(launch.codexShim, launch.codexEntry, shim)) {
        throw new Error('Codex shim target mismatch');
      }
    }
    let released = false;
    return { ok: true, value: {
      async recheck() {
        if (released) return false;
        const identities = await Promise.all(pins.map((pin) => pin.currentFileId()));
        return identities.every((identity, index) => identity === pins[index].fileId);
      },
      async release() {
        if (released) return;
        released = true;
        await release();
      },
    } };
  } catch {
    await release();
    return { ok: false, refusal: refusalCode, detail: null };
  }
}
