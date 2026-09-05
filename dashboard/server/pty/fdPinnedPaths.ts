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
  codexSandboxMode,
  FORBIDDEN_WORKFLOW_TOOLS,
  toolCapArgv,
  WORKFLOW_EXECUTION_PROFILES,
  WORKFLOW_PERMISSION_MODE,
} from '../control/workflowProfiles.ts';
import type { LaunchRecipe, SafeRootId, SessionLauncher, SessionSize } from '../../shared/ptyProtocol.ts';
import { decodeLaunchRecipe, isSafeRelativeCwd } from './brokerProtocol.ts';

export const LINUX_ROOTS = {
  repo: '/var/lib/kb/ops',
  worktrees: '/var/lib/kb-shell/worktrees',
} as const satisfies Record<SafeRootId, string>;

export const BROKER_SOCKET_PATH = '/run/kb-shell/broker.sock';
/**
 * The pipe-stdin exec hop. A headless child needs three things done between fork and exec that no
 * parent can do for it - drop the inherited pty master, put a BLOCKING terminal on fd 1/2, and take
 * that terminal as its controlling tty - so `pipeStdinExec.py` does them and then execs the pinned
 * CLI. `/usr/bin/python3` is a root-owned binary under an approved executable root and is pinned by
 * the same walk every other broker executable goes through; the shim itself and the CLI reach the
 * child as DESCRIPTORS in stdio slots, because dup2 clears FD_CLOEXEC and that is the only way a
 * descriptor survives the exec into python.
 */
export const PIPE_STDIN_INTERPRETER = '/usr/bin/python3';
/**
 * Where codex actually is, in preference order. `~/.local/bin/codex` is an npm WRAPPER -
 * `#!/usr/bin/env node`, 7 KB, whose whole job is to spawn the vendored native binary - and a wrapper
 * cannot be the pinned entrypoint: a shebang entrypoint reaches its interpreter as
 * `args[0] = /proc/self/fd/<n>`, a descriptor that is FD_CLOEXEC and therefore already gone by the
 * time node opens it. That has always been broken on the tty path and the headless path refuses it
 * outright, so codex must be pinned at the NATIVE binary the wrapper would have spawned.
 *
 * A fixed list, not a readlink and not a read of the wrapper's JavaScript: resolution stays inside
 * the same O_NOFOLLOW walk every other executable goes through, so a candidate that is not
 * kb-shell-owned 0700/0750 under the provider home is refused rather than followed. First hit wins;
 * (a) is the nested npm layout the VM has, (b) the hoisted one, (c) the wrapper path itself, which is
 * accepted only when it turns out to be a native binary rather than a script.
 *
 * Skipping the wrapper costs the child nothing. Read from the shipped `bin/codex.js` (0.153.0, the
 * VM runs 0.152.0): it ends in `spawn(binaryPath, process.argv.slice(2), { stdio: 'inherit', env })`
 * - argv passes through untouched, and the only additions to the environment are
 * `CODEX_MANAGED_PACKAGE_ROOT` plus one of `CODEX_MANAGED_BY_{NPM,BUN,PNPM}`. Its own comment says
 * that detection exists "to give the user a hint about how to update it": update nags, nothing the
 * binary needs to run. The broker's six-key child environment never carried them anyway.
 */
const CODEX_VENDOR_TAIL = '@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
export const CODEX_EXECUTABLE_CANDIDATES = [
  `/var/lib/kb-shell/home/.local/lib/node_modules/@openai/codex/node_modules/${CODEX_VENDOR_TAIL}`,
  `/var/lib/kb-shell/home/.local/lib/node_modules/${CODEX_VENDOR_TAIL}`,
  '/var/lib/kb-shell/home/.local/bin/codex',
] as const;
export const PIPE_STDIN_EXEC_CHILD_FD = 3;
export const PIPE_STDIN_SHIM_CHILD_FD = 4;
export const LINUX_CHILD_BASE_ENV_KEYS = ['HOME', 'PATH', 'LANG', 'TERM', 'COLUMNS', 'LINES'] as const;
/**
 * The git ownership escape hatch, and the ONLY conditional part of the child environment.
 *
 * An attempt worktree is created by the dashboard (kb-dashboard:kb-dashboard, mode 2770, its gitdir
 * under /var/lib/kb/ops/.git/worktrees) and the child runs as kb-shell, so git 2.53 refuses every
 * command in it with "detected dubious ownership in repository". There is no /etc/gitconfig and no
 * gitconfig in the child's HOME, and the child environment is a closed key set, so the only way to
 * tell git this directory is trusted is to pass the config on the environment. Verified on the VM:
 * `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=<worktree>` makes
 * `git status` succeed as kb-shell.
 *
 * Emitted ONLY for a `worktrees`-rooted launch, and only for that launch's own validated cwd. A
 * `repo`-rooted launch gets none: trusting /var/lib/kb/ops would widen kb-shell's git trust to the
 * canonical repository itself, which is exactly the thing the ownership check is protecting.
 *
 * Broker-side only - these keys are derived here from the pinned root and the validated cwd, and
 * never travel on the wire.
 */
export const LINUX_CHILD_GIT_ENV_KEYS = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'] as const;
export const LINUX_CHILD_ENV_KEYS = [...LINUX_CHILD_BASE_ENV_KEYS, ...LINUX_CHILD_GIT_ENV_KEYS] as const;
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
 * the dashboard out of broker.sock. On the socket unit itself, RuntimeDirectory=/User=/Group= do NOT
 * chown the directory either (verified on the VM: they left it root:root) - the socket's privileged
 * ExecStartPre `+chown`/`+chmod` pair below is what actually makes it kb-shell:kb-dashboard 0750.
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
    // The one repeatable systemd directive in this frozen table: two ExecStartPre execs, in this
    // order. `+` runs each as root regardless of this unit's own User=kb-shell.
    ExecStartPre: [
      '+/usr/bin/chown kb-shell:kb-dashboard /run/kb-shell',
      '+/usr/bin/chmod 0750 /run/kb-shell',
    ],
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
    // `-` prefix: ignore-if-missing on this one path. Nothing in the repo ever creates
    // /var/lib/kb-activation, and systemd refuses to build the mount namespace when a listed
    // InaccessiblePaths entry does not exist (confirmed on the VM: every spawn died at NAMESPACE).
    InaccessiblePaths: '/var/lib/kb/state /opt/kb-releases -/var/lib/kb-activation',
    CapabilityBoundingSet: '',
    AmbientCapabilities: '',
    RestrictSUIDSGID: 'yes',
  },
} as const;

const deniedRoots = BROKER_RUNTIME_POLICY.inaccessiblePaths;

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

/**
 * Mirrors `isWellFormedToolName` (control/claudeLaunchPolicy.ts) — deliberately COPIED, not imported.
 * That module reaches the workflow-profile loader and the rest of the control plane, while the broker
 * payload is a compiled bundle with no repo behind it, so importing it would drag the control plane
 * into the broker bundle or throw at broker start-up. Five lines of duplication is the cheaper of the
 * two, and `profiles.test.ts` holds the two copies to the same verdict on the same table.
 */
function isWellFormedToolName(name: string): boolean {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 200
    && !/[\s,\0"']/.test(name)
    && !name.startsWith('-');
}

/**
 * The broker's tool-policy table, DERIVED from the one server-owned profile table
 * (`control/workflowProfiles.ts`) rather than hand-written beside it, and RE-FILTERED here rather than
 * taken on trust. `toolPolicyId` on the wire is a NAME, and what the broker does with the profile that
 * name selects is NOT the same on both launchers:
 *
 *   - claude: the resolved `allowedTools` becomes the child's `--allowedTools` argv, so the broker has
 *     to land on exactly the policy the dashboard approved or `createAttemptToolPolicyIdResolver`
 *     refuses the launch. This is the hop that actually carries a tool cap.
 *   - codex: the CLI has no per-tool allowlist, so the resolved tools never reach codex argv. There the
 *     name is a membership test, and the tools decide the codex sandbox mode (`codexSandboxMode`) —
 *     nothing more. Do not read the claude sentence above as describing codex; it does not.
 *
 * The filters are the broker holding its OWN opinion rather than inheriting the dashboard's.
 * `createWorkflowToolPolicyResolver` refuses a malformed tool name (one that would corrupt the
 * comma-joined `--allowedTools` value or smuggle a flag) and any tool on `FORBIDDEN_WORKFLOW_TOOLS`;
 * deriving from the shared literal without those checks would let a profile the dashboard would refuse
 * to resolve still launch here. Applying them at Map construction takes the broker out at start-up
 * instead, which is the failure we want: a broker that will not start is visible, a broker that
 * launches an over-capable worker is not.
 *
 * `shell-default` is deliberately absent: `decodeLaunchRecipe` pins the shell recipe's policy id to
 * that exact value and `buildBrokerLaunch` returns before any lookup, so the shell launcher never
 * consults this table.
 */
export function buildWorkflowPolicyTable(
  profiles: readonly { id: string; allowedTools: readonly string[] }[],
): Map<string, { allowedTools: readonly string[]; permissionMode: string }> {
  // An empty table leaves every agent launch unservable and `PROBE_POLICY_ID` undefined; say so here
  // rather than failing later on an unrelated subscript.
  if (profiles.length === 0) throw new FdPinnedPathError('the workflow profile table is empty');
  const table = new Map<string, { allowedTools: readonly string[]; permissionMode: string }>();
  for (const profile of profiles) {
    if (profile.allowedTools.length === 0) {
      throw new FdPinnedPathError(`workflow profile '${profile.id}' grants no tools`);
    }
    for (const tool of profile.allowedTools) {
      if (!isWellFormedToolName(tool)) {
        throw new FdPinnedPathError(`workflow profile '${profile.id}' names a malformed tool`);
      }
      if (FORBIDDEN_WORKFLOW_TOOLS.includes(tool)) {
        throw new FdPinnedPathError(`workflow profile '${profile.id}' names forbidden tool '${tool}'`);
      }
    }
    table.set(profile.id, {
      allowedTools: profile.allowedTools,
      permissionMode: WORKFLOW_PERMISSION_MODE,
    });
  }
  return table;
}

const workflowPolicies = buildWorkflowPolicyTable(WORKFLOW_EXECUTION_PROFILES);

/**
 * Re-exported, not redefined. The derivation itself lives in `control/workflowProfiles.ts` because the
 * Windows launcher (`pty/launcherProfiles.ts`) needs the SAME rule and does not share this module: two
 * copies of "which profile may write" is precisely the class of drift the importless profile leaf was
 * extracted to end, and it shipped here first, so this file kept the name it exported.
 */
export { codexSandboxMode };

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
  env: Record<(typeof LINUX_CHILD_BASE_ENV_KEYS)[number], string>
    & Partial<Record<(typeof LINUX_CHILD_GIT_ENV_KEYS)[number], string>>;
  cols: number;
  rows: number;
  /**
   * What kind of fd 0 the child is given. Derived below from `recipe.mode`, NOT carried on the wire:
   * the dashboard sends a recipe, the broker decides how to hold that child's stdin.
   *
   * `tty` - fd 0/1/2 are all the pty slave, the shape an interactive shell needs.
   * `pipe` - fd 0 is a pipe, fd 1/2 stay on the pty slave. Both headless CLIs REFUSE a tty on stdin:
   * `claude -p` exits 1 with "Input must be provided either through stdin or as a prompt argument
   * when using --print" (observed on the VM, run-a9bdd60f, the first real claude launch), and
   * `codex exec -` names stdin as the prompt source by definition. Passing the prompt as argv is not
   * the alternative - it is single-turn, and it would put the work order in a `ps` listing, which
   * `control/claudeWorkerAdapter.ts` forbids outright.
   */
  stdinMode: 'tty' | 'pipe';
};

export function resolveLinuxRoot(rootId: SafeRootId): string {
  return LINUX_ROOTS[rootId];
}

export function validateRelativeCwd(value: string): string {
  if (!isSafeRelativeCwd(value)) throw new FdPinnedPathError('unsafe relative cwd');
  return value;
}

function childEnvironment(size: SessionSize, rootId: SafeRootId, cwd: string): BrokerLaunchSpec['env'] {
  const base = {
    HOME: '/var/lib/kb-shell/home',
    PATH: '/var/lib/kb-shell/home/.local/bin:/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
    COLUMNS: String(size.cols),
    LINES: String(size.rows),
  };
  // See LINUX_CHILD_GIT_ENV_KEYS: a launch's OWN worktree only. Never the canonical repo root, and
  // never the shared worktrees parent either - `/var/lib/kb-shell/worktrees` is every attempt's
  // container, so trusting it would hand one attempt's child git trust over every other attempt's
  // worktree at once. The value is this launch's already-validated absolute cwd, a real subdirectory
  // of the root: not a wildcard, not a parent.
  if (rootId !== 'worktrees' || cwd === resolveLinuxRoot(rootId)) return base;
  return { ...base, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: cwd };
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
  // The one place stdin mode is decided, for every launcher at once. It keys off the MODE, not off a
  // list of launcher names, so a headless launcher added later inherits the pipe by declaring itself
  // headless rather than by someone remembering to edit a second table.
  const stdinMode: BrokerLaunchSpec['stdinMode'] = recipe.mode === 'headless-json' ? 'pipe' : 'tty';
  const common = { cwd, env: childEnvironment(size, rootId, cwd), cols: size.cols, rows: size.rows, stdinMode };
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
    // The cap FIRST, the pre-approval second. `--tools` is what the child is actually given
    // (`toolCapArgv`, control/workflowProfiles.ts); `--allowedTools` only keeps those given tools from
    // prompting. Passing the second without the first is what launched `scanner` with Bash.
    args.push(...toolCapArgv(policy.allowedTools));
    args.push('--allowedTools', policy.allowedTools.join(','), '--permission-mode', policy.permissionMode);
    return { executable: '/var/lib/kb-shell/home/.local/bin/claude', args, ...common };
  }

  const codexPolicy = workflowPolicies.get(recipe.toolPolicyId);
  if (codexPolicy === undefined) throw new FdPinnedPathError('unknown Codex tool policy');
  // Codex argv carries no `--allowedTools`; the profile's cap reaches the child as the sandbox mode.
  const sandboxMode = codexSandboxMode(codexPolicy.allowedTools);
  // `exec resume` accepts no `-s/--sandbox` flag — verified against the installed CLI: its option list
  // offers `-c`, `--last`, `-m` and no sandbox flag, while plain `exec` offers
  // `-s [read-only, workspace-write, danger-full-access]`. The equivalent is the config key that flag
  // sets, `sandbox_mode`, so the resume branch pins it with `-c`. Without it a resumed session
  // inherited whatever the CLI happened to default to and could silently outrank the fresh launch it
  // continues. `pinnedCodexConfig` STAYS LAST in every branch: codex is last-wins on `-c`, and that
  // ordering is what keeps `approval_policy=never` and the network/mcp/web-search pins un-overridable.
  // CONTRACT CHANGE (W64) - the fresh headless branch carries NO `--cd`, and this is the fix for a
  // launch that could never have worked. `pinBrokerLaunch` rewrites every argv token equal to the cwd
  // into `/proc/self/fd/<cwdFd>`, and that descriptor is FD_CLOEXEC: it is gone by the time codex
  // resolves the flag, two execve hops later (the pipe-stdin shim closes every non-kept fd besides).
  // Measured on the VM as kb-shell against the real binary: `--cd /proc/self/fd/<n>` exits 1 in 0.1 s,
  // the identical launch WITHOUT it exits 0 in 17 s with the work done. Nothing is lost by dropping it
  // - `spawn(cwd)` has already chdir'd the child into the pinned dirfd, so codex's own process cwd IS
  // the worktree - and the resume branch has always omitted it. The INTERACTIVE branch carries none
  // either, for exactly the same reason: node-pty forks and execs from the pinned dirfd, so its child's
  // cwd is already the worktree, while the flag it used to pass named the same dead descriptor. One
  // codex argv table, one answer about how codex learns its directory - the chdir, never a flag.
  const args = recipe.mode === 'headless-json'
    ? recipe.resumeRef === undefined
      ? ['exec', '-', '--json', '--model', recipe.model!, '-s', sandboxMode, ...pinnedCodexConfig]
      : ['exec', 'resume', recipe.resumeRef, '-', '--json', '-c', `model=${recipe.model!}`,
        '-c', `sandbox_mode="${sandboxMode}"`, ...pinnedCodexConfig]
    : ['--model', recipe.model!, '-s', sandboxMode, ...pinnedCodexConfig];
  return { executable: '/var/lib/kb-shell/home/.local/bin/codex', args, ...common };
}

/**
 * Does this recipe's child read its instruction from stdin UNTIL EOF?
 *
 * The one place that question is answered, beside the argv table it is a property of. `codex exec -`
 * and `codex exec resume <ref> -` both name stdin as the prompt source and block until it closes, so
 * their sender must half-close after the last approved prompt; `claude -p --input-format stream-json`
 * frames each turn itself and needs the pipe HELD OPEN for the next one (Gate 4a proved multi-turn
 * over the held pipe), so ending its stdin would break it.
 *
 * Derived from the closed recipe table - the launcher and the mode - and from nothing else. It is
 * deliberately NOT a field on `LaunchRecipe` or on `BrokerLaunchSpec`: on the wire it would be the
 * SENDER's claim about a child whose argv this module owns, and the broker never needs it (it acts on
 * an explicit `end-input` request and refuses one only when the session has no stdin pipe at all).
 * An interactive recipe answers false: its stdin is a tty, where U+0004 is already EOF.
 */
export function recipeEndsInputOnEof(recipe: LaunchRecipe): boolean {
  return recipe.launcher === 'codex' && recipe.mode === 'headless-json';
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
  /** The CLI's own name, for the child's argv[0] once the executable is a bare descriptor. */
  argv0: string;
  /** True when `executableFd` is a script INTERPRETER rather than the CLI itself. */
  shebang: boolean;
  close(): Promise<void>;
};

/**
 * The pinned pipe-stdin exec hop, pinned ONCE at broker start and held for the broker's lifetime.
 *
 * Pinning it per launch would re-walk `/usr/bin/python3` on every agent session for no gain; pinning
 * it at boot means the descriptors were taken before any session existed to race them, and every
 * later launch execs the inode the boot-time walk validated.
 */
export type PinnedPipeStdinExec = {
  /** `/proc/self/fd/<n>` for the interpreter - what `child_process.spawn` actually execs. */
  interpreter: string;
  interpreterFd: number;
  /** The shim source. Passed down a stdio slot, never by a pathname the child re-resolves. */
  shimFd: number;
  close(): void;
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

/** An entrypoint the walk accepted, with the bytes that say whether it is a script. */
type ResolvedEntrypoint = { fd: number; path: string; prefix: string };

/**
 * The launcher's real entrypoint, resolved through the walk and NOWHERE else. One list, one order,
 * one caller-visible result, so `pinBrokerLaunch` and `pinnableLauncher` cannot disagree about which
 * file a launcher means - the moment they do, the probe advertises a launcher that create refuses.
 *
 * A native candidate always beats a script one. If every candidate that opened turned out to be a
 * script, the FIRST such is returned rather than an error: the tty path has always run those (badly),
 * and it is `spawnBrokerChild` and the probe - not this walk - that decide a script is unusable.
 */
function resolveEntrypoint(executable: string, walk: PinWalk, fs: PinningFileSystem): ResolvedEntrypoint {
  const candidates = executable === CODEX_EXECUTABLE_CANDIDATES[2]
    ? CODEX_EXECUTABLE_CANDIDATES : [executable];
  let script: ResolvedEntrypoint | null = null;
  let refusal: unknown = null;
  for (const candidate of candidates) {
    let opened: ResolvedEntrypoint;
    try {
      const fd = walk.openAbsolute(candidate, 'file', APPROVED_EXECUTABLE_ROOTS);
      opened = { fd, path: candidate, prefix: Buffer.from(fs.read(fd, 256)).toString('utf8') };
    } catch (error) { refusal = error; continue; }
    if (!opened.prefix.startsWith('#!')) return opened;
    if (script === null) script = opened;
  }
  if (script !== null) return script;
  throw refusal instanceof FdPinnedPathError ? refusal
    : new FdPinnedPathError('no approved entrypoint for this launcher');
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
    const entrypoint = resolveEntrypoint(launch.executable, walk, fs);
    // The recheck sweep still runs before anything is USED: the prefix above was read off a
    // descriptor this walk holds, and a component swapped since it was opened fails here.
    walk.verifyRechecks();
    const entrypointFd = entrypoint.fd;
    const prefix = entrypoint.prefix;
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
      argv0: path.posix.basename(launch.executable),
      shebang: executableFd !== entrypointFd,
      close: async () => walk.closeHeld(),
    };
  } catch (error) {
    walk.closeHeld();
    throw error instanceof FdPinnedPathError ? error : new FdPinnedPathError('fd-pinned launch refused');
  }
}

/**
 * Pin the pipe-stdin exec hop: `/usr/bin/python3` through the SAME walk `pinBrokerLaunch` uses (same
 * O_NOFOLLOW component-by-component descent, same ownership/mode matrix, same symlink depth limit and
 * recheck sweep - `/usr/bin/python3` is a root-owned symlink to a versioned binary on every distro we
 * deploy, and the walk resolves it exactly as it resolves any other), plus a plain open of the shim.
 *
 * The shim is NOT walked, deliberately. Its path is derived from the broker's own module location,
 * not from anything on the wire, and it lives beside `main.js` in the release the systemd unit
 * already execs by path on a `ProtectSystem=strict` mount. An attacker who can rewrite it has already
 * replaced the broker itself, so a metadata check there would be theatre; what matters is that the
 * child receives it as a descriptor this function opened rather than as a name it re-resolves.
 */
export function pinPipeStdinExec(
  shimPath: string,
  identities: PinIdentities,
  fs: PinningFileSystem = productionPinningFs,
): PinnedPipeStdinExec {
  const walk = beginPinWalk(identities, fs);
  let shimFd: number | null = null;
  try {
    const interpreterFd = walk.openAbsolute(PIPE_STDIN_INTERPRETER, 'file', APPROVED_EXECUTABLE_ROOTS);
    walk.verifyRechecks();
    shimFd = fs.open(shimPath, fsConstants.O_RDONLY);
    // The shim is code this broker is about to run as itself, so anyone who can WRITE it owns the
    // broker's children. Group- and other-writable is refused outright; the owner must be root (the
    // release on the VM) or the broker's own account, which could rewrite the payload regardless and
    // so buys an attacker nothing. Checked on the DESCRIPTOR already opened, never by a second
    // pathname lookup.
    const shim = fs.identity(shimFd);
    if (shim.kind !== 'file' || (shim.mode & 0o022) !== 0
        || ![identities.rootUid, identities.shellUid].includes(shim.uid)) {
      throw new FdPinnedPathError('pipe-stdin exec shim ownership or mode is unsafe');
    }
    return {
      interpreter: `/proc/self/fd/${interpreterFd}`,
      interpreterFd,
      shimFd,
      close: () => {
        if (shimFd !== null) { try { fs.close(shimFd); } catch { /* already closed */ } }
        walk.closeHeld();
      },
    };
  } catch (error) {
    if (shimFd !== null) { try { fs.close(shimFd); } catch { /* already closed */ } }
    walk.closeHeld();
    throw error instanceof FdPinnedPathError ? error
      : new FdPinnedPathError('pipe-stdin exec shim could not be pinned');
  }
}

/**
 * The recipe a launcher is PROBED with. It exists so the executable path comes out of
 * `buildBrokerLaunch` — the same table launch reads — instead of a second copy of
 * `/var/lib/kb-shell/home/.local/bin/<name>`. The model and the policy id are placeholders that exist
 * only to get past validation: nothing is spawned and the argv is discarded, so the model is the
 * shortest string satisfying the launcher's prefix check, and the policy id is read out of the
 * profile table rather than written out again, so a renamed profile cannot silently un-probe a
 * launcher. (`buildWorkflowPolicyTable` above has already refused an empty table by name, so the
 * subscript cannot be the thing that reports it.)
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
 *
 * `headlessReady` is the caller's answer to "did the boot-time pipe-stdin exec pin succeed?". Every
 * agent launch the dashboard makes is `headless-json`, so a claude or codex that cannot run headless
 * is one create WILL refuse, and advertising it is the same lie as advertising a missing binary. The
 * shebang rule is the other half of the same precondition, applied here rather than inferred: a
 * script entrypoint is refused by `spawnBrokerChild` for the agent launchers, so it is refused here.
 */
export async function pinnableLauncher(
  launcher: SessionLauncher,
  identities: PinIdentities,
  fs: PinningFileSystem = productionPinningFs,
  headlessReady = true,
): Promise<boolean> {
  let executable: string;
  let walk: PinWalk;
  try {
    executable = launcherExecutable(launcher);
    if (!APPROVED_EXECUTABLE_ROOTS.some((root) => isWithin(executable, root))) return false;
    walk = beginPinWalk(identities, fs);
  } catch { return false; }
  const headless = launcher !== 'shell';
  try {
    if (headless && !headlessReady) return false;
    const entrypoint = resolveEntrypoint(executable, walk, fs);
    walk.verifyRechecks();
    if (entrypoint.prefix.startsWith('#!')) {
      if (headless) return false;
      const interpreter = shebangInterpreter(entrypoint.prefix);
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
  headlessReady = true,
): Promise<SessionLauncher[]> {
  const available: SessionLauncher[] = [];
  for (const launcher of ['shell', 'claude', 'codex'] as const) {
    let pinnable = false;
    try { pinnable = await pinnableLauncher(launcher, identities, fs, headlessReady); }
    catch { pinnable = false; }
    if (pinnable) available.push(launcher);
  }
  return available;
}
