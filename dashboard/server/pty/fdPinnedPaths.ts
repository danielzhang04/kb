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

import {
  WORKFLOW_EXECUTION_PROFILES,
  WORKFLOW_PERMISSION_MODE,
} from '../control/workflowProfiles.ts';
import type { LaunchRecipe, SafeRootId, SessionLauncher, SessionSize } from '../../shared/ptyProtocol.ts';
import { decodeLaunchRecipe } from './brokerProtocol.ts';

export const LINUX_ROOTS = {
  repo: '/var/lib/kb/ops',
  worktrees: '/var/lib/kb-shell/worktrees',
} as const satisfies Record<SafeRootId, string>;

export const BROKER_SOCKET_PATH = '/run/kb-shell/broker.sock';
export const LINUX_CHILD_ENV_KEYS = ['HOME', 'PATH', 'LANG', 'TERM', 'COLUMNS', 'LINES'] as const;
/**
 * Runtime-directory + state-file facts the BROKER PROCESS checks at boot. It carries no copy of the
 * unit's path sandbox: `ReadOnlyPaths`/`ReadWritePaths`/`InaccessiblePaths` live once, in
 * `BROKER_SYSTEMD_POLICY.service` below, which is the literal the pairwise-equality test compares
 * against the unit file and the Python validator. `runtimeDirectoryMode` is 0750, the value the
 * SOCKET unit creates /run/kb-shell with (kb-shell:kb-dashboard) — the only mode that lets the
 * dashboard traverse to broker.sock.
 */
export const BROKER_RUNTIME_POLICY = {
  runtimeDirectory: '/run/kb-shell',
  runtimeDirectoryMode: 0o750,
  statePath: '/run/kb-shell/state.json',
  stateOwner: 'kb-shell:kb-shell',
  stateMode: 0o600,
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
    ReadWritePaths: '/var/lib/kb-shell/worktrees /run/kb-shell /var/lib/kb-shell/home/.claude /var/lib/kb-shell/home/.codex',
    InaccessiblePaths: '/var/lib/kb/state /opt/kb-releases /var/lib/kb-activation',
    CapabilityBoundingSet: '',
    AmbientCapabilities: '',
    RestrictSUIDSGID: 'yes',
  },
} as const;

const deniedRoots = BROKER_RUNTIME_POLICY.inaccessiblePaths;

/**
 * The broker's tool-policy table, DERIVED from the one server-owned profile table
 * (`control/workflowProfiles.ts`) rather than hand-written beside it. `toolPolicyId` on the wire is a
 * NAME; the broker re-resolves the cap from that name on its own side and has to land on exactly the
 * policy the dashboard approved, or `createAttemptToolPolicyIdResolver` refuses the launch. Two
 * hand-maintained tables is how this broker shipped knowing only `standard` — an id nothing has ever
 * sent — while every real launch named a workflow profile and died on `unknown ... tool policy`.
 *
 * `shell-default` is deliberately absent: `decodeLaunchRecipe` pins the shell recipe's policy id to
 * that exact value and `buildBrokerLaunch` returns before any lookup, so the shell launcher never
 * consults this table.
 */
const workflowPolicies = new Map(WORKFLOW_EXECUTION_PROFILES.map((profile) => [profile.id, {
  allowedTools: profile.allowedTools,
  permissionMode: WORKFLOW_PERMISSION_MODE,
}]));

/**
 * The launcher/model cross-check, and deliberately NOTHING MORE — there is no model enumeration here
 * on purpose. Do not reintroduce one.
 *
 * 1. `decodeLaunchRecipe` has already run `modelPattern` (/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/) over
 *    this value: it cannot be empty, cannot begin with `-`, and cannot contain whitespace, quotes, or
 *    shell metacharacters.
 * 2. The value reaches the child as a single `--model <value>` argv element of an execve'd process.
 *    There is no shell, so there is no injection an allowlist would be blocking.
 * 3. WHICH model a run may use is a governance decision, and it is already enforced upstream at the
 *    control plane by `governance/model-routing.yaml` + `scripts/routing.py`. A second copy in the
 *    broker buys no security — it only guarantees that every model the fleet adopts breaks every
 *    agent launch until someone edits this file, which is exactly what happened: the enumeration
 *    listed six ids, the registry named seven others, and the two sets overlapped in one entry.
 *
 * What remains is the one check that IS about this frame: a recipe whose launcher and model disagree
 * is crossed up, and a crossed recipe is a bug we refuse rather than execute.
 */
const MODEL_PREFIXES = { claude: /^claude-/, codex: /^gpt-/ } as const;
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
  if (!MODEL_PREFIXES[recipe.launcher].test(recipe.model!)) {
    throw new FdPinnedPathError('recipe model does not belong to this launcher');
  }

  if (recipe.launcher === 'claude') {
    const policy = workflowPolicies.get(recipe.toolPolicyId);
    if (policy === undefined) throw new FdPinnedPathError('unknown Claude tool policy');
    const args = recipe.mode === 'headless-json'
      ? ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose']
      : [];
    // No `--settings` on Linux, and none is constructed here: the read-scope blob is not part of the
    // v1 recipe frame, and the child is confined by the unit's own ReadOnlyPaths/ReadWritePaths
    // instead. Adding one is a protocol change, not a line in this function.
    args.push('--model', recipe.model!);
    if (recipe.resumeRef !== undefined) args.push('--resume', recipe.resumeRef);
    args.push('--allowedTools', policy.allowedTools.join(','), '--permission-mode', policy.permissionMode);
    return { executable: '/var/lib/kb-shell/home/.local/bin/claude', args, ...common };
  }

  if (!workflowPolicies.has(recipe.toolPolicyId)) throw new FdPinnedPathError('unknown Codex tool policy');
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

/** The service accounts every metadata rule in the walk below is written against. */
export type PinIdentities = {
  rootUid: number; shellUid: number; shellGid: number; dashboardUid: number; dashboardGid: number;
};

/**
 * The only directories a broker child may be executed out of. Exported because the capability probe
 * asks "would pinning this launcher succeed?" against the SAME list the launch asks it against — a
 * second copy would drift, and a probe answering about a different root set is a probe that lies.
 */
export const APPROVED_EXECUTABLE_ROOTS = [
  '/bin', '/usr/bin', '/usr/local/bin', '/var/lib/kb-shell/home/.local',
] as const;

/**
 * The shebang allowlist, in one place. `#!/usr/bin/env node` is rewritten to the concrete interpreter
 * (env resolves through PATH, which a pinned launch may not depend on); anything else must already be
 * an absolute `/bin` or `/usr/bin` name. `null` means "not approved" and is always fatal.
 */
function shebangInterpreter(prefix: string): string | null {
  const firstLine = prefix.split(/\r?\n/, 1)[0]!.slice(2).trim();
  return firstLine === '/usr/bin/env node' ? '/usr/bin/node'
    : /^\/(?:usr\/)?bin\/[A-Za-z0-9._-]+$/.test(firstLine) ? firstLine : null;
}

type PinWalk = {
  openAbsolute(absolute: string, leafKind: 'file' | 'directory', allowedRoots: readonly string[]): number;
  /** Re-lstat every pathname opened so far and refuse if any moved under our own handles. */
  verifyRechecks(): void;
  closeHeld(): void;
};

/**
 * Linux openat-style primitive: open `/` once, then open every component through
 * `/proc/self/fd/<pinned-dirfd>/<component>` with O_NOFOLLOW (and O_DIRECTORY for directories).
 * Symlink objects are themselves pinned with O_PATH|O_NOFOLLOW before their target is traversed.
 * Every original pathname identity is rechecked before use, while launch uses only proc-fd paths.
 *
 * One walk, two callers: `pinBrokerLaunch`, which then spawns, and `pinnableLauncher`, which then
 * throws the descriptors away. They must never diverge — the moment the probe validates something
 * weaker than the launch, the daemon starts advertising launchers that refuse at `create`, which is
 * the same class of lie as advertising a launcher nobody looked for.
 */
function beginPinWalk(identities: PinIdentities, fs: PinningFileSystem): PinWalk {
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

  const verifyRechecks = (): void => {
    for (const check of rechecks) {
      const current = fs.identityAt(check.path, check.identity);
      if (current.dev !== check.identity.dev || current.ino !== check.identity.ino || current.kind !== check.identity.kind) {
        throw new FdPinnedPathError('pinned ancestor identity changed');
      }
    }
  };

  return {
    openAbsolute: (absolute, leafKind, allowedRoots) => openAbsolute(absolute, leafKind, allowedRoots),
    verifyRechecks,
    closeHeld,
  };
}

export async function pinBrokerLaunch(
  launch: BrokerLaunchSpec,
  identities: PinIdentities,
  fs: PinningFileSystem = productionPinningFs,
): Promise<PinnedBrokerLaunch> {
  if (!Object.values(LINUX_ROOTS).some((root) => isWithin(launch.cwd, root))
      || deniedRoots.some((root) => isWithin(launch.cwd, root))) {
    throw new FdPinnedPathError('cwd is outside an approved root');
  }
  if (!APPROVED_EXECUTABLE_ROOTS.some((root) => isWithin(launch.executable, root))) {
    throw new FdPinnedPathError('executable is outside an approved root');
  }
  const walk = beginPinWalk(identities, fs);
  try {
    const cwdRoot = Object.values(LINUX_ROOTS).find((root) => isWithin(launch.cwd, root))!;
    const cwdFd = walk.openAbsolute(launch.cwd, 'directory', [cwdRoot]);
    const entrypointFd = walk.openAbsolute(launch.executable, 'file', APPROVED_EXECUTABLE_ROOTS);
    walk.verifyRechecks();
    const prefix = Buffer.from(fs.read(entrypointFd, 256)).toString('utf8');
    let executableFd = entrypointFd;
    let args = launch.args;
    if (prefix.startsWith('#!')) {
      const interpreter = shebangInterpreter(prefix);
      if (interpreter === null) throw new FdPinnedPathError('script interpreter is not approved');
      executableFd = walk.openAbsolute(interpreter, 'file', APPROVED_EXECUTABLE_ROOTS);
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
      close: async () => walk.closeHeld(),
    };
  } catch (error) {
    walk.closeHeld();
    throw error instanceof FdPinnedPathError ? error : new FdPinnedPathError('fd-pinned launch refused');
  }
}

/**
 * The recipe a launcher is PROBED with. It exists so the executable path comes out of
 * `buildBrokerLaunch` — the same table launch reads — instead of a second copy of
 * `/var/lib/kb-shell/home/.local/bin/<name>`. The model and the policy id are placeholders that exist
 * only to get past validation: nothing is spawned and the argv is discarded, so the model is the
 * shortest string satisfying the launcher's prefix check, and the policy id is read out of the
 * profile table rather than written out again, so a renamed profile cannot silently un-probe a
 * launcher.
 */
const PROBE_POLICY_ID = WORKFLOW_EXECUTION_PROFILES[0]!.id;

function probeRecipe(launcher: SessionLauncher): LaunchRecipe {
  if (launcher === 'shell') {
    return { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' };
  }
  return launcher === 'claude'
    ? { launcher: 'claude', mode: 'interactive', model: 'claude-probe', toolPolicyId: PROBE_POLICY_ID, sandbox: 'claude-policy' }
    : { launcher: 'codex', mode: 'interactive', model: 'gpt-probe', toolPolicyId: PROBE_POLICY_ID, sandbox: 'codex-workspace-write' };
}

/** The executable a launcher resolves to, straight out of the launch table. */
export function launcherExecutable(launcher: SessionLauncher): string {
  return buildBrokerLaunch(probeRecipe(launcher), 'repo', '', { cols: 80, rows: 24 }).executable;
}

/**
 * "Would pinning this launcher succeed right now?" — answered by walking the executable exactly as
 * `pinBrokerLaunch` does (O_NOFOLLOW component by component, the ownership/mode matrix, the symlink
 * depth limit, the recheck sweep, the shebang allowlist and its interpreter) and then dropping the
 * descriptors instead of spawning. It deliberately does NOT walk a cwd: a broken approved root is a
 * property of the host, not of a launcher, and letting it answer "codex is missing" would misname the
 * fault — the host's own root policy is checked where it belongs, at `create`.
 *
 * FAIL CLOSED, without exception. Every refusal, every errno, every unexpected throw returns `false`.
 * There is no error this function can see that means "the launcher is probably fine": the entire point
 * of the enumeration is that a launcher it names is one an operator may be routed onto.
 */
export async function pinnableLauncher(
  launcher: SessionLauncher,
  identities: PinIdentities,
  fs: PinningFileSystem = productionPinningFs,
): Promise<boolean> {
  let executable: string;
  let walk: PinWalk;
  try {
    executable = launcherExecutable(launcher);
    if (!APPROVED_EXECUTABLE_ROOTS.some((root) => isWithin(executable, root))) return false;
    walk = beginPinWalk(identities, fs);
  } catch { return false; }
  try {
    const entrypointFd = walk.openAbsolute(executable, 'file', APPROVED_EXECUTABLE_ROOTS);
    walk.verifyRechecks();
    const prefix = Buffer.from(fs.read(entrypointFd, 256)).toString('utf8');
    if (prefix.startsWith('#!')) {
      const interpreter = shebangInterpreter(prefix);
      if (interpreter === null) return false;
      walk.openAbsolute(interpreter, 'file', APPROVED_EXECUTABLE_ROOTS);
    }
    return true;
  } catch {
    return false;
  } finally {
    walk.closeHeld();
  }
}

/**
 * The broker's answer to "which launchers can I actually launch?", produced by inspecting the real
 * filesystem AS `kb-shell` — the only principal that can see inside `/var/lib/kb-shell/home` (0700,
 * `kb-shell`), which is exactly why this runs in the broker and not in the daemon.
 *
 * Every launcher is asked independently and every failure is that launcher's own: one launcher that
 * throws can never remove another from the set, and can never add itself to it.
 */
export async function enumerateBrokerLaunchers(
  identities: PinIdentities,
  fs: PinningFileSystem = productionPinningFs,
): Promise<SessionLauncher[]> {
  const available: SessionLauncher[] = [];
  for (const launcher of ['shell', 'claude', 'codex'] as const) {
    let pinnable = false;
    try { pinnable = await pinnableLauncher(launcher, identities, fs); } catch { pinnable = false; }
    if (pinnable) available.push(launcher);
  }
  return available;
}
