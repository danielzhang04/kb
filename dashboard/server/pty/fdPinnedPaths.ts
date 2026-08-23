import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readlinkSync,
  readSync,
} from 'node:fs';
import type { BigIntStats } from 'node:fs';
import path from 'node:path';

import type { LaunchRecipe, SafeRootId, SessionSize } from '../../shared/ptyProtocol.ts';
import { decodeLaunchRecipe } from './brokerProtocol.ts';

export const LINUX_ROOTS = {
  repo: '/var/lib/kb/ops',
  worktrees: '/var/lib/kb-shell/worktrees',
} as const satisfies Record<SafeRootId, string>;

export const BROKER_SOCKET_PATH = '/run/kb-shell/broker.sock';
export const LINUX_CHILD_ENV_KEYS = ['HOME', 'PATH', 'LANG', 'TERM', 'COLUMNS', 'LINES'] as const;
export const BROKER_RUNTIME_POLICY = {
  runtimeDirectory: '/run/kb-shell',
  runtimeDirectoryMode: 0o700,
  statePath: '/run/kb-shell/state.json',
  stateOwner: 'kb-shell:kb-shell',
  stateMode: 0o600,
  readOnlyPaths: ['/var/lib/kb/ops', '/var/lib/kb-shell/home'],
  readWritePaths: ['/var/lib/kb-shell/worktrees'],
  inaccessiblePaths: ['/var/lib/kb/state', '/opt/kb-releases', '/var/lib/kb-activation'],
} as const;

/**
 * The [Socket] and [Service] sections of deploy/systemd/kb-shell-broker.*, directive for directive.
 *
 * This is one of three copies of the frozen sandbox contract - the unit files, the Python validator
 * (deploy/validate_vm_runtime.py BROKER_*_DIRECTIVES), and this one. They are held identical by
 * tests/test_validate_vm_runtime.py, which parses this literal and compares all three pairwise, so a
 * directive added here without the unit file (or the reverse) is a red test, not silent drift.
 *
 * The runtime directory lives on the SOCKET unit: a service-side RuntimeDirectory= is chowned to the
 * service's own User:Group on every start, which would make /run/kb-shell kb-shell:kb-shell and lock
 * the dashboard out of broker.sock.
 */
export const BROKER_SYSTEMD_POLICY = {
  socket: {
    ListenStream: BROKER_SOCKET_PATH,
    Accept: 'no',
    SocketUser: 'kb-dashboard',
    SocketGroup: 'kb-dashboard',
    SocketMode: '0600',
    DirectoryMode: '0750',
    RemoveOnStop: 'yes',
    User: 'kb-shell',
    Group: 'kb-dashboard',
    RuntimeDirectory: 'kb-shell',
    RuntimeDirectoryMode: '0750',
    RuntimeDirectoryPreserve: 'restart',
  },
  service: {
    Type: 'simple',
    User: 'kb-shell',
    Group: 'kb-shell',
    WorkingDirectory: '/var/lib/kb-shell/home',
    ExecStart: '/usr/bin/node /opt/kb-shell-broker/current/main.js --socket-fd=3 --protocol-version=kb-shell-broker/v1',
    Restart: 'on-failure',
    KillMode: 'control-group',
    TimeoutStopSec: '90',
    NoNewPrivileges: 'yes',
    UnsetEnvironment: 'GITHUB_TOKEN GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK DASHBOARD_SESSION_SECRET KB_CANARY_SESSION',
    PrivateTmp: 'yes',
    ProtectSystem: 'strict',
    ReadOnlyPaths: '/var/lib/kb/ops /var/lib/kb-shell/home',
    ReadWritePaths: '/var/lib/kb-shell/worktrees /run/kb-shell',
    InaccessiblePaths: '/var/lib/kb/state /opt/kb-releases /var/lib/kb-activation',
    CapabilityBoundingSet: '',
    AmbientCapabilities: '',
    RestrictSUIDSGID: 'yes',
  },
} as const;

const deniedRoots = BROKER_RUNTIME_POLICY.inaccessiblePaths;
const claudePolicies = {
  standard: { allowedTools: ['Read', 'Write', 'Edit', 'Bash'], permissionMode: 'acceptEdits', settings: undefined },
} as const;
const codexPolicies = new Set(['standard']);
export const APPROVED_MODELS = {
  claude: ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'],
  codex: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.6'],
} as const;
const pinnedCodexConfig = [
  '-c', 'approval_policy=never',
  '-c', 'forced_login_method="chatgpt"',
  '-c', 'mcp_servers={}',
  '-c', 'sandbox_workspace_write.network_access=false',
  '-c', 'web_search="disabled"',
] as const;

export class FdPinnedPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FdPinnedPathError';
  }
}

export type PinnedIdentity = {
  dev: bigint;
  ino: bigint;
  uid: number;
  gid: number;
  mode: number;
  kind: 'file' | 'directory' | 'other';
};

export type BrokerLaunchSpec = {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<(typeof LINUX_CHILD_ENV_KEYS)[number], string>;
  cols: number;
  rows: number;
};

export function resolveLinuxRoot(rootId: SafeRootId): string {
  return LINUX_ROOTS[rootId];
}

export function validateRelativeCwd(value: string): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 240
      || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.startsWith('//')
      || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new FdPinnedPathError('unsafe relative cwd');
  }
  if (value === '') return value;
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) {
    throw new FdPinnedPathError('unsafe relative cwd');
  }
  return value;
}

function childEnvironment(size: SessionSize): BrokerLaunchSpec['env'] {
  return {
    HOME: '/var/lib/kb-shell/home',
    PATH: '/var/lib/kb-shell/home/.local/bin:/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
    COLUMNS: String(size.cols),
    LINES: String(size.rows),
  };
}

function absoluteCwd(rootId: SafeRootId, relative: string): string {
  const root = resolveLinuxRoot(rootId);
  return relative === '' ? root : `${root}/${relative}`;
}

export function buildBrokerLaunch(
  rawRecipe: LaunchRecipe,
  rootId: SafeRootId,
  relativeCwd: string,
  size: SessionSize,
): BrokerLaunchSpec {
  const recipe = decodeLaunchRecipe(rawRecipe);
  const relative = validateRelativeCwd(relativeCwd);
  if (!Number.isInteger(size.cols) || size.cols < 20 || size.cols > 500
      || !Number.isInteger(size.rows) || size.rows < 5 || size.rows > 200) {
    throw new FdPinnedPathError('terminal size is out of range');
  }
  const cwd = absoluteCwd(rootId, relative);
  const common = { cwd, env: childEnvironment(size), cols: size.cols, rows: size.rows };
  if (recipe.launcher === 'shell') return { executable: '/bin/bash', args: [], ...common };
  if (!APPROVED_MODELS[recipe.launcher].includes(recipe.model as never)) {
    throw new FdPinnedPathError('recipe model is not in the approved model table');
  }

  if (recipe.launcher === 'claude') {
    const policy = claudePolicies[recipe.toolPolicyId as keyof typeof claudePolicies];
    if (policy === undefined) throw new FdPinnedPathError('unknown Claude tool policy');
    const args = recipe.mode === 'headless-json'
      ? ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose']
      : [];
    if (policy.settings !== undefined) args.push('--settings', policy.settings);
    args.push('--model', recipe.model!);
    if (recipe.resumeRef !== undefined) args.push('--resume', recipe.resumeRef);
    args.push('--allowedTools', policy.allowedTools.join(','), '--permission-mode', policy.permissionMode);
    return { executable: '/var/lib/kb-shell/home/.local/bin/claude', args, ...common };
  }

  if (!codexPolicies.has(recipe.toolPolicyId)) throw new FdPinnedPathError('unknown Codex tool policy');
  const args = recipe.mode === 'headless-json'
    ? recipe.resumeRef === undefined
      ? ['exec', '-', '--json', '--model', recipe.model!, '-s', 'workspace-write', ...pinnedCodexConfig, '--cd', cwd]
      : ['exec', 'resume', recipe.resumeRef, '-', '--json', '-c', `model=${recipe.model!}`, ...pinnedCodexConfig]
    : ['--model', recipe.model!, '-s', 'workspace-write', ...pinnedCodexConfig, '--cd', cwd];
  return { executable: '/var/lib/kb-shell/home/.local/bin/codex', args, ...common };
}

function identity(stats: BigIntStats): PinnedIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    uid: Number(stats.uid),
    gid: Number(stats.gid),
    mode: Number(stats.mode),
    kind: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
  };
}

function isWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

export type PinningFileSystem = {
  open(path: string, flags: number): number;
  identity(fd: number): PinnedIdentity;
  identityAt(path: string, expected: PinnedIdentity): PinnedIdentity;
  readlink(path: string): string;
  read(fd: number, maxBytes: number): Uint8Array;
  close(fd: number): void;
};

const O_PATH = 0x20_0000;

const productionPinningFs: PinningFileSystem = {
  open: (target, flags) => openSync(target, flags),
  identity: (fd) => identity(fstatSync(fd, { bigint: true })),
  identityAt: (target) => identity(lstatSync(target, { bigint: true })),
  readlink: (target) => readlinkSync(target, 'utf8'),
  read: (fd, maxBytes) => {
    const output = Buffer.alloc(maxBytes);
    const count = readSync(fd, output, 0, maxBytes, 0);
    return output.subarray(0, count);
  },
  close: (fd) => closeSync(fd),
};

export type PinnedBrokerLaunch = {
  launch: BrokerLaunchSpec;
  executableFd: number;
  cwdFd: number;
  close(): Promise<void>;
};

/**
 * Linux openat-style primitive: open `/` once, then open every component through
 * `/proc/self/fd/<pinned-dirfd>/<component>` with O_NOFOLLOW (and O_DIRECTORY for directories).
 * Symlink objects are themselves pinned with O_PATH|O_NOFOLLOW before their target is traversed.
 * Every original pathname identity is rechecked before returning, while launch uses only proc-fd paths.
 */
export async function pinBrokerLaunch(
  launch: BrokerLaunchSpec,
  identities: { rootUid: number; shellUid: number; shellGid: number; dashboardUid: number; dashboardGid: number },
  fs: PinningFileSystem = productionPinningFs,
): Promise<PinnedBrokerLaunch> {
  if (!Object.values(LINUX_ROOTS).some((root) => isWithin(launch.cwd, root))
      || deniedRoots.some((root) => isWithin(launch.cwd, root))) {
    throw new FdPinnedPathError('cwd is outside an approved root');
  }
  const executableRoots = ['/bin', '/usr/bin', '/usr/local/bin', '/var/lib/kb-shell/home/.local'];
  if (!executableRoots.some((root) => isWithin(launch.executable, root))) {
    throw new FdPinnedPathError('executable is outside an approved root');
  }
  const held: number[] = [];
  const rechecks: Array<{ path: string; identity: PinnedIdentity }> = [];
  const closeHeld = (): void => {
    for (const fd of held.reverse()) { try { fs.close(fd); } catch { /* already closed */ } }
  };

  const validateComponent = (absolute: string, value: PinnedIdentity, leafKind: 'file' | 'directory'): void => {
    const inWorktree = isWithin(absolute, LINUX_ROOTS.worktrees);
    const special = value.mode & 0o6000;
    if (value.kind !== leafKind || (special !== 0 && !(inWorktree && leafKind === 'directory' && special === 0o2000))) {
      throw new FdPinnedPathError('pinned component kind or special mode is unsafe');
    }
    const mode = value.mode & 0o7777;
    const inHome = isWithin(absolute, '/var/lib/kb-shell/home');
    if (inWorktree) {
      const root = absolute === LINUX_ROOTS.worktrees;
      const validOwner = root ? value.uid === identities.dashboardUid
        : value.uid === identities.dashboardUid || value.uid === identities.shellUid;
      if (!validOwner || value.gid !== identities.shellGid || mode !== 0o2770 || leafKind !== 'directory') {
        throw new FdPinnedPathError('worktree component metadata is unsafe');
      }
      return;
    }
    if (inHome) {
      const allowed = leafKind === 'file' ? [0o700, 0o750] : absolute === '/var/lib/kb-shell/home' ? [0o700] : [0o700, 0o750];
      if (value.uid !== identities.shellUid || value.gid !== identities.shellGid || !allowed.includes(mode)) {
        throw new FdPinnedPathError('provider-home component metadata is unsafe');
      }
      return;
    }
    if (value.uid !== identities.rootUid || ![identities.rootUid, identities.shellGid].includes(value.gid)
        || (leafKind === 'file' ? mode !== 0o755 : ![0o755, 0o750].includes(mode))) {
      throw new FdPinnedPathError('root-owned component metadata is unsafe');
    }
  };

  const openAbsolute = (absolute: string, leafKind: 'file' | 'directory', allowedRoots: readonly string[], depth = 0): number => {
    if (!path.posix.isAbsolute(absolute) || depth > 8 || !allowedRoots.some((root) => isWithin(absolute, root))) {
      throw new FdPinnedPathError('pinned symlink chain is invalid');
    }
    let parentFd = fs.open('/', fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_DIRECTORY);
    held.push(parentFd);
    const rootIdentity = fs.identity(parentFd);
    validateComponent('/', rootIdentity, 'directory');
    rechecks.push({ path: '/', identity: rootIdentity });
    const parts = absolute.split('/').filter(Boolean);
    let current = '';
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      current += `/${part}`;
      const final = index === parts.length - 1;
      const expectedKind = final ? leafKind : 'directory';
      const viaFd = `/proc/self/fd/${parentFd}/${part}`;
      let fd: number;
      try {
        fd = fs.open(viaFd, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
          | (expectedKind === 'directory' ? fsConstants.O_DIRECTORY : 0));
      } catch (error) {
        if (!['ELOOP', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw new FdPinnedPathError('pinned component open refused');
        }
        fd = fs.open(viaFd, O_PATH | fsConstants.O_NOFOLLOW);
        held.push(fd);
        const symlinkIdentity = fs.identity(fd);
        const symlinkInWorktree = isWithin(current, LINUX_ROOTS.worktrees);
        const symlinkInHome = isWithin(current, '/var/lib/kb-shell/home');
        const allowedSymlinkOwner = symlinkInWorktree
          ? [identities.dashboardUid, identities.shellUid].includes(symlinkIdentity.uid)
            && symlinkIdentity.gid === identities.shellGid
          : symlinkInHome ? symlinkIdentity.uid === identities.shellUid && symlinkIdentity.gid === identities.shellGid
            : symlinkIdentity.uid === identities.rootUid;
        if (symlinkIdentity.kind !== 'other' || (symlinkIdentity.mode & 0o6000) !== 0 || !allowedSymlinkOwner) {
          throw new FdPinnedPathError('pinned symlink metadata is unsafe');
        }
        // Verify the fd we pinned, not a fresh pathname resolution: both sides of this comparison
        // are anchored at the parent dirfd (fstat of the O_PATH fd vs an lstat through
        // /proc/self/fd/<parentFd>/<part>, the readlinkat-equivalent Node exposes).
        const atFd = fs.identityAt(viaFd, symlinkIdentity);
        if (symlinkIdentity.dev !== atFd.dev || symlinkIdentity.ino !== atFd.ino
            || symlinkIdentity.kind !== atFd.kind) {
          throw new FdPinnedPathError('pinned symlink identity changed');
        }
        rechecks.push({ path: viaFd, identity: symlinkIdentity });
        const target = fs.readlink(viaFd);
        const resolved = path.posix.resolve(path.posix.dirname(current), target,
          ...parts.slice(index + 1));
        return openAbsolute(resolved, leafKind, allowedRoots, depth + 1);
      }
      held.push(fd);
      const openedIdentity = fs.identity(fd);
      validateComponent(current, openedIdentity, expectedKind);
      rechecks.push({ path: current, identity: openedIdentity });
      parentFd = fd;
    }
    return parentFd;
  };

  try {
    const cwdRoot = Object.values(LINUX_ROOTS).find((root) => isWithin(launch.cwd, root))!;
    const cwdFd = openAbsolute(launch.cwd, 'directory', [cwdRoot]);
    const entrypointFd = openAbsolute(launch.executable, 'file', executableRoots);
    for (const check of rechecks) {
      const current = fs.identityAt(check.path, check.identity);
      if (current.dev !== check.identity.dev || current.ino !== check.identity.ino || current.kind !== check.identity.kind) {
        throw new FdPinnedPathError('pinned ancestor identity changed');
      }
    }
    const prefix = Buffer.from(fs.read(entrypointFd, 256)).toString('utf8');
    let executableFd = entrypointFd;
    let args = launch.args;
    if (prefix.startsWith('#!')) {
      const firstLine = prefix.split(/\r?\n/, 1)[0]!.slice(2).trim();
      const interpreter = firstLine === '/usr/bin/env node' ? '/usr/bin/node'
        : /^\/(?:usr\/)?bin\/[A-Za-z0-9._-]+$/.test(firstLine) ? firstLine : null;
      if (interpreter === null) throw new FdPinnedPathError('script interpreter is not approved');
      executableFd = openAbsolute(interpreter, 'file', executableRoots);
      args = [`/proc/self/fd/${entrypointFd}`, ...args];
    }
    const cwdProcPath = `/proc/self/fd/${cwdFd}`;
    return {
      launch: {
        ...launch,
        executable: `/proc/self/fd/${executableFd}`,
        args: args.map((argument) => argument === launch.cwd ? cwdProcPath : argument),
        cwd: cwdProcPath,
      },
      executableFd,
      cwdFd,
      close: async () => closeHeld(),
    };
  } catch (error) {
    closeHeld();
    throw error instanceof FdPinnedPathError ? error : new FdPinnedPathError('fd-pinned launch refused');
  }
}
