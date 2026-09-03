import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync } from 'node:fs';
import { open, readFile, rename, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { constants as osConstants } from 'node:os';
import { ReadStream as TtyReadStream } from 'node:tty';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { IPty } from 'node-pty';
import { BROKER_MAX_SESSIONS, BROKER_PROTOCOL } from './brokerProtocol.ts';
import {
  BROKER_RUNTIME_POLICY,
  BROKER_SOCKET_PATH,
  FdPinnedPathError,
  PIPE_STDIN_EXEC_CHILD_FD,
  PIPE_STDIN_SHIM_CHILD_FD,
  enumerateBrokerLaunchers,
  pinBrokerLaunch,
  pinPipeStdinExec,
  type BrokerLaunchSpec,
  type PinIdentities,
  type PinnedPipeStdinExec,
} from './fdPinnedPaths.ts';
import {
  LinuxBrokerServer,
  MAX_BROKER_RECEIPTS,
  listenOnUnixSocket,
  type BrokerProcessIdentity,
  type BrokerPty,
  type BrokerPtyLauncher,
  type BrokerRuntimeSession,
  type BrokerRuntimeState,
} from './linuxBrokerServer.ts';
// The peer-credential read and the passwd/group parsing are shared with the DASHBOARD side of this
// socket (`brokerProbe.ts`), so they live in their own module rather than here: the broker payload and
// the daemon must resolve `kb-shell` to the same numbers or the identity checks are theatre.
import { namedId, readUnixPeerIdentity } from './unixServiceIdentity.ts';

export { readUnixPeerIdentity };

const MAX_RUNTIME_STATE_BYTES = 262_144;
const brokerSessionPattern = /^pty-[0-9a-f]{32}$/;
const brokerEpochPattern = /^epoch-[0-9a-f]{32}$/;
const brokerOperationPattern = /^op-[0-9a-f]{64}$/;

export type ServiceIdentities = {
  shellUid: number; shellGid: number; dashboardUid: number; dashboardGid: number;
};

export function validateServiceIdentity(passwd: string, groups: string,
  effective: { uid: number; gid: number }): ServiceIdentities {
  const shellUid = namedId(passwd, 'kb-shell', 2);
  const shellAccountGid = namedId(passwd, 'kb-shell', 3);
  const shellGid = namedId(groups, 'kb-shell', 2);
  const dashboardUid = namedId(passwd, 'kb-dashboard', 2);
  const dashboardAccountGid = namedId(passwd, 'kb-dashboard', 3);
  const dashboardGid = namedId(groups, 'kb-dashboard', 2);
  if (effective.uid === 0) throw new Error('kb-shell broker refuses root');
  if (shellAccountGid !== shellGid || dashboardAccountGid !== dashboardGid) {
    throw new Error('service account gid does not match named group');
  }
  if (effective.uid !== shellUid || effective.gid !== shellGid) {
    throw new Error('effective kb-shell uid/gid mismatch');
  }
  return { shellUid, shellGid, dashboardUid, dashboardGid };
}

async function resolveServiceIdentities(): Promise<ServiceIdentities> {
  const [passwd, groups] = await Promise.all([readFile('/etc/passwd', 'utf8'), readFile('/etc/group', 'utf8')]);
  return validateServiceIdentity(passwd, groups, { uid: process.getuid!(), gid: process.getgid!() });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function decodeBrokerRuntimeState(value: unknown): BrokerRuntimeState {
  const root = object(value);
  if (root === null || !exactKeys(root, ['protocol', 'epochId', 'sessions', 'receipts'])
      || root.protocol !== BROKER_PROTOCOL || typeof root.epochId !== 'string'
      || !brokerEpochPattern.test(root.epochId) || !Array.isArray(root.sessions)
      || root.sessions.length > BROKER_MAX_SESSIONS || !Array.isArray(root.receipts)
      || root.receipts.length > MAX_BROKER_RECEIPTS) {
    throw new Error('broker runtime state is invalid');
  }
  const sessions = root.sessions.map((value): BrokerRuntimeState['sessions'][number] => {
    const row = object(value);
    const identity = row === null ? null : object(row.identity);
    if (row === null || !exactKeys(row, ['sessionId', 'epochId', 'identity', 'state', 'sequence', 'queuedInputBytes'])
        || typeof row.sessionId !== 'string' || !brokerSessionPattern.test(row.sessionId)
        || typeof row.epochId !== 'string' || !brokerEpochPattern.test(row.epochId)
        || identity === null || !exactKeys(identity, ['pid', 'pgid', 'startTimeTicks'])
        || !Number.isSafeInteger(identity.pid) || (identity.pid as number) <= 1
        || !Number.isSafeInteger(identity.pgid) || (identity.pgid as number) <= 1
        || typeof identity.startTimeTicks !== 'string' || !/^[0-9]+$/.test(identity.startTimeTicks)
        || (row.state !== 'live' && row.state !== 'closing')
        || !Number.isSafeInteger(row.sequence) || (row.sequence as number) < 0
        || !Number.isSafeInteger(row.queuedInputBytes) || (row.queuedInputBytes as number) < 0
        || (row.queuedInputBytes as number) > 262_144) throw new Error('broker runtime session is invalid');
    return row as BrokerRuntimeState['sessions'][number];
  });
  const receipts = root.receipts.map((value): BrokerRuntimeState['receipts'][number] => {
    const row = object(value);
    if (row === null || !exactKeys(row, ['operationKey', 'requestHash', 'sessionId'])
        || typeof row.operationKey !== 'string' || !brokerOperationPattern.test(row.operationKey)
        || typeof row.requestHash !== 'string' || !/^[0-9a-f]{64}$/.test(row.requestHash)
        || typeof row.sessionId !== 'string' || !brokerSessionPattern.test(row.sessionId)) {
      throw new Error('broker runtime receipt is invalid');
    }
    return row as BrokerRuntimeState['receipts'][number];
  });
  if (new Set(sessions.map((row) => row.sessionId)).size !== sessions.length
      || new Set(receipts.map((row) => row.operationKey)).size !== receipts.length) {
    throw new Error('broker runtime state contains duplicates');
  }
  return { protocol: BROKER_PROTOCOL, epochId: root.epochId, sessions, receipts };
}

export type BrokerNodePolicy = { uid: number; gids: readonly number[]; modes: readonly number[] };
export type BrokerRuntimePolicy = {
  state: BrokerNodePolicy;
  directory: BrokerNodePolicy;
  directoryPath: string;
};

/** Refuse a runtime node whose fstat does not match the declared policy. */
export function assertBrokerRuntimeNode(stats: { mode: number; uid: number; gid: number },
  policy: BrokerNodePolicy, kind: 'state file' | 'directory'): void {
  if (stats.uid !== policy.uid || !policy.gids.includes(stats.gid)
      || !policy.modes.includes(stats.mode & 0o7777)) {
    throw new Error(`broker runtime ${kind} ownership or mode violates policy`);
  }
}

/**
 * The recovery input's integrity boundary, derived from the declared constants rather than
 * hard-coded: BROKER_RUNTIME_POLICY.stateOwner/stateMode for /run/kb-shell/state.json, and for
 * the runtime directory the socket unit's 0750 with the kb-dashboard group, which is what lets the
 * dashboard reach broker.sock.
 *
 * The units are reconciled (the socket unit owns /run/kb-shell via its privileged ExecStartPre
 * `+chown`/`+chmod` pair - RuntimeDirectory=/User=/Group= on the socket unit do NOT chown it, a false
 * premise that was hand-verified and corrected on the VM; the service declares no RuntimeDirectory at
 * all), so this FAILS CLOSED on the old shape: gid kb-shell and mode 0700 are REFUSED. A 0700
 * kb-shell:kb-shell runtime directory is unreachable by kb-dashboard, so accepting it bought a broker
 * that boots happily while the dashboard can never traverse to broker.sock - silent unavailability.
 * The one accepted shape is the socket unit's: kb-shell:kb-dashboard 0750.
 */
export function brokerRuntimePolicy(identities: ServiceIdentities): BrokerRuntimePolicy {
  const [owner, group] = BROKER_RUNTIME_POLICY.stateOwner.split(':');
  if (owner !== 'kb-shell' || group !== 'kb-shell') {
    throw new Error('broker runtime state owner policy is unsupported');
  }
  return {
    state: { uid: identities.shellUid, gids: [identities.shellGid], modes: [BROKER_RUNTIME_POLICY.stateMode] },
    directory: {
      uid: identities.shellUid,
      gids: [identities.dashboardGid],
      modes: [BROKER_RUNTIME_POLICY.runtimeDirectoryMode],
    },
    directoryPath: BROKER_RUNTIME_POLICY.runtimeDirectory,
  };
}

async function assertRuntimeDirectory(policy: BrokerRuntimePolicy): Promise<void> {
  const handle = await open(policy.directoryPath,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isDirectory()) throw new Error('broker runtime directory is not a directory');
    assertBrokerRuntimeNode(stats, policy.directory, 'directory');
  } finally { await handle.close(); }
}

export async function loadRuntimeState(statePath: string,
  policy: BrokerRuntimePolicy | null = null): Promise<BrokerRuntimeState | null> {
  // Checked before the state file is opened: the directory is where state.json will be written,
  // so a policy-violating runtime directory must refuse startup even on a first, stateless boot.
  if (policy !== null) await assertRuntimeDirectory(policy);
  try {
    const handle = await open(statePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const metadata = await handle.stat();
      if (metadata.size > MAX_RUNTIME_STATE_BYTES) throw new Error('broker runtime state is oversized');
      if (policy !== null) assertBrokerRuntimeNode(metadata, policy.state, 'state file');
      bytes = await handle.readFile();
    } finally { await handle.close(); }
    return decodeBrokerRuntimeState(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function storeRuntimeState(statePath: string, state: BrokerRuntimeState): Promise<void> {
  const encoded = Buffer.from(JSON.stringify(state), 'utf8');
  if (encoded.byteLength > MAX_RUNTIME_STATE_BYTES) throw new Error('broker runtime state is oversized');
  const temporary = `${statePath}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  const handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(encoded);
    await handle.sync();
  } finally { await handle.close(); }
  await rename(temporary, statePath);
  const directory = await open(BROKER_RUNTIME_POLICY.runtimeDirectory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try { await directory.sync(); } finally { await directory.close(); }
}

/** node-pty's master socket, the only writability signal the library exposes. */
type PtyMasterSocket = { writableNeedDrain?: boolean; once(event: string, listener: () => void): unknown };

/** How long after a child exits its pty master may still hand over trailing output. */
const MASTER_DRAIN_MS = 250;

/** One printable ASCII line, bounded - broker text written into a byte-exact transcript. */
function asciiLine(value: string): string {
  return [...value].map((character) => {
    const code = character.codePointAt(0)!;
    return code >= 0x20 && code <= 0x7e ? character : ' ';
  }).join('').slice(0, 160);
}

/**
 * The listener plumbing every broker child shares.
 *
 * Output can arrive before the broker has registered its own listener - node-pty starts its master
 * socket flowing at spawn, and a `child_process` master is being read from the moment its stream is
 * constructed - and an emitter with no listener discards those bytes with no trace. Reading
 * `/proc/<pid>/stat` for the process identity is a real filesystem round-trip, so a launcher that
 * wrapped its child only afterwards lost the session's opening frame (a shell banner, a CLI's first
 * render). Everything seen before `onData`/`onExit` is buffered here and replayed when they arrive.
 */
abstract class BufferedBrokerChild implements BrokerPty {
  readonly pid: number;
  protected identityValue: BrokerProcessIdentity | null = null;
  private dataListener: ((data: Uint8Array) => void) | null = null;
  private exitListener: ((exitCode: number | null, signal: number | null) => void) | null = null;
  /** Output observed before the broker registered its listener. */
  private readonly bufferedData: Uint8Array[] = [];
  private bufferedExit: { exitCode: number | null; signal: number | null } | null = null;

  constructor(pid: number) { this.pid = pid; }

  get identity(): BrokerProcessIdentity {
    if (this.identityValue === null) throw new Error('pty process identity was never read');
    return this.identityValue;
  }

  protected observe(data: Uint8Array): void {
    if (this.dataListener === null) this.bufferedData.push(data);
    else this.dataListener(data);
  }

  protected observeExit(exitCode: number | null, signal: number | null): void {
    if (this.exitListener === null) this.bufferedExit = { exitCode, signal };
    else this.exitListener(exitCode, signal);
  }

  /** SIGKILL the child's whole process group, so its own children go with it. */
  protected killGroup(fallback: () => void): void {
    try { process.kill(-this.pid, 'SIGKILL'); }
    catch { try { fallback(); } catch { /* already gone */ } }
  }

  onData(listener: (data: Uint8Array) => void): void {
    this.dataListener = listener;
    for (const buffered of this.bufferedData.splice(0)) listener(buffered);
  }
  onExit(listener: (exitCode: number | null, signal: number | null) => void): void {
    this.exitListener = listener;
    const buffered = this.bufferedExit;
    if (buffered === null) return;
    this.bufferedExit = null;
    listener(buffered.exitCode, buffered.signal);
  }

  abstract write(data: Uint8Array): Promise<void>;
  abstract resize(cols: number, rows: number): void;
  abstract kill(): void;
}

/** An interactive child: fd 0, 1 and 2 are all the pty slave, which is all node-pty can express. */
export class NodePtyChild extends BufferedBrokerChild {
  private readonly child: IPty;

  constructor(child: IPty, identity: BrokerProcessIdentity | null = null) {
    super(child.pid);
    this.child = child;
    this.identityValue = identity;
    // Spawned with `encoding: null`, so node-pty delivers Buffers: PTY output is never decoded.
    // A string can only appear if that option is lost; latin1 is the byte-preserving fallback.
    child.onData((data: string | Uint8Array) => this.observe(
      typeof data === 'string' ? Buffer.from(data, 'latin1') : Buffer.from(data)));
    child.onExit(({ exitCode, signal }) => this.observeExit(exitCode, signal ?? null));
  }

  /** Wraps a freshly spawned child SYNCHRONOUSLY, then reads its identity. See the base class. */
  static async adopt(child: IPty): Promise<NodePtyChild> {
    const adopted = new NodePtyChild(child);
    try {
      adopted.identityValue = await readProcessIdentity(child.pid);
    } catch (error) {
      adopted.kill();
      throw error;
    }
    return adopted;
  }

  /**
   * Resolves when the master pty has taken the bytes. node-pty's `write` returns void, so real
   * writability comes from its master socket's drain watermark; where that is not observable the
   * write is in flight only until the server's 262,144-byte queued-input cap refuses more.
   */
  write(data: Uint8Array): Promise<void> {
    this.child.write(Buffer.from(data) as never);
    const socket = (this.child as IPty & { _socket?: PtyMasterSocket })._socket;
    if (socket?.writableNeedDrain !== true) return Promise.resolve();
    return new Promise<void>((resolve) => socket.once('drain', () => resolve()));
  }
  resize(cols: number, rows: number): void { this.child.resize(cols, rows); }
  kill(): void { this.killGroup(() => this.child.kill('SIGKILL')); }
}

/**
 * A headless child: stdin is a PIPE, stdout and stderr are the pty slave.
 *
 * `claude -p` refuses to run at all when stdin is a tty ("Input must be provided either through stdin
 * or as a prompt argument when using --print", VM run-a9bdd60f) and `codex exec -` names stdin as its
 * prompt source, while the broker's transcript and resize contracts are both a pty. node-pty puts a
 * tty on all three descriptors and exposes no way to split them, so this class opens the pty pair
 * itself and spawns through `child_process`, which does take one descriptor per stdio slot.
 *
 * Two things differ from the tty case, and only two. INPUT goes to the stdin pipe, never to the
 * master: a master write would echo into the transcript and would not reach a `--input-format
 * stream-json` reader at all. EXIT comes from the child process's own status rather than from the
 * master's EOF - the master reports EIO only once EVERY copy of the slave is closed, which a
 * surviving grandchild can delay indefinitely, and the exit code is what the session record persists.
 * Output and resize are unchanged: both still go through the pty master.
 */
export class PipeStdinChild extends BufferedBrokerChild {
  private readonly child: ChildProcess;
  private readonly master: TtyReadStream;
  private readonly masterFd: number;
  private readonly resizeMaster: (fd: number, cols: number, rows: number) => void;
  private exitStatus: { exitCode: number | null; signal: number | null } | null = null;
  private masterDrained = false;
  private settled = false;
  private drainTimer: NodeJS.Timeout | null = null;

  constructor(pid: number, child: ChildProcess, master: TtyReadStream, masterFd: number,
    resizeMaster: (fd: number, cols: number, rows: number) => void) {
    super(pid);
    this.child = child;
    this.master = master;
    this.masterFd = masterFd;
    this.resizeMaster = resizeMaster;
    master.on('data', (chunk: Buffer) => this.observe(Buffer.from(chunk)));
    // EIO on a pty master is how Linux says "the last slave closed" - the ordinary end of a session,
    // never a fault to surface. `end` and `close` are the same event by another name.
    for (const event of ['error', 'end', 'close']) {
      master.on(event, () => { this.masterDrained = true; this.settle(); });
    }
    // EPIPE on a stdin pipe whose reader is gone is ordinary too; `write` resolves on close.
    child.stdin?.on('error', () => { /* the child is gone; the exit path reports it */ });
    child.on('error', (error) => {
      // A spawn that never became a process has no exit code and no signal, and an exit frame of
      // `{null, null}` tells an operator nothing. Say what happened in the one place they are already
      // reading - the transcript - before reporting the exit.
      this.observe(Buffer.from(`[broker] spawn failed: ${asciiLine(error.message)}\r\n`, 'ascii'));
      this.exitStatus ??= { exitCode: null, signal: null };
      this.masterDrained = true;
      this.settle();
    });
    child.on('exit', (exitCode, signal) => {
      this.exitStatus = { exitCode, signal: signal === null ? null : osConstants.signals[signal] };
      // The child is gone; let the master hand over what it wrote on the way out, but bound the wait
      // so a grandchild still holding the slave can never strand the session's exit.
      this.drainTimer = setTimeout(() => { this.masterDrained = true; this.settle(); }, MASTER_DRAIN_MS);
      this.drainTimer.unref();
      this.settle();
    });
  }

  /** Wraps a freshly spawned child SYNCHRONOUSLY, then reads its identity. See the base class. */
  static async adopt(pid: number, child: ChildProcess, master: TtyReadStream, masterFd: number,
    resizeMaster: (fd: number, cols: number, rows: number) => void): Promise<PipeStdinChild> {
    const adopted = new PipeStdinChild(pid, child, master, masterFd, resizeMaster);
    try {
      adopted.identityValue = await readProcessIdentity(pid);
    } catch (error) {
      adopted.kill();
      throw error;
    }
    return adopted;
  }

  /** Resolves when the stdin PIPE has taken the bytes, or when it can never take them again. */
  write(data: Uint8Array): Promise<void> {
    const stdin = this.child.stdin;
    if (stdin === null || stdin.destroyed || stdin.writableEnded) return Promise.resolve();
    if (stdin.write(Buffer.from(data))) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const settle = (): void => {
        stdin.off('drain', settle);
        stdin.off('close', settle);
        resolve();
      };
      stdin.once('drain', settle);
      stdin.once('close', settle);
    });
  }

  resize(cols: number, rows: number): void {
    // Once the master is gone its NUMBER is free for the next open, so an ioctl on it would be aimed
    // at whatever took the number - another session's pty, in the worst case. `settled` alone is not
    // that test: the master can be destroyed while `exitStatus` is still null (the child closed fd
    // 1/2, or the pty reported EIO before the process was reaped), which leaves `settled` false with
    // the descriptor already closed. All three conditions, so a dead session's resize is a no-op
    // rather than an EBADF surfaced as `internal` AFTER the server advanced inputSequence.
    if (this.settled || this.masterDrained || this.master.destroyed) return;
    this.resizeMaster(this.masterFd, cols, rows);
  }

  kill(): void { this.killGroup(() => this.child.kill('SIGKILL')); }

  /** Report the exit once, and only once BOTH the process status and the master's output are in. */
  private settle(): void {
    const status = this.exitStatus;
    if (this.settled || status === null || !this.masterDrained) return;
    this.settled = true;
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    // Destroying the stream closes the master fd it owns; nothing may touch that number afterwards.
    this.master.destroy();
    // The stdin pipe's write end is ours, and nothing will ever read it again. Left open it is a
    // descriptor and a libuv handle leaked per completed headless run, and a pending `write` waiting
    // on a 'close' that never comes.
    this.child.stdin?.destroy();
    this.observeExit(status.exitCode, status.signal);
  }
}

/** `encoding: null` keeps PTY output as Buffers end to end; nothing decodes child bytes. */
export function nodePtySpawnOptions(launch: BrokerLaunchSpec): {
  cwd: string; env: BrokerLaunchSpec['env']; cols: number; rows: number; name: string; encoding: null;
} {
  return {
    cwd: launch.cwd,
    env: launch.env,
    cols: launch.cols,
    rows: launch.rows,
    name: 'xterm-256color',
    encoding: null,
  };
}

/**
 * node-pty's native binding. `open` is openpty(3) handing back the RAW master and slave descriptors,
 * and `resize` is the TIOCSWINSZ that `IPty.resize` itself calls. Neither is in the package's
 * `.d.ts`, which declares `spawn` alone, so the shape is written out here and the module is cast once
 * at load. It is the same binding `spawn` runs on - there is no second pty implementation for this to
 * drift from - and the dependency is pinned at `node-pty@^1.1.0`.
 */
export type NodePtyNative = {
  open(cols: number, rows: number): { master: number; slave: number; pty: string };
  resize(fd: number, cols: number, rows: number): void;
};

export type BrokerNodePty = {
  spawn(file: string, args: string[], options: ReturnType<typeof nodePtySpawnOptions>): IPty;
  native: NodePtyNative | null;
};

export async function loadBrokerNodePty(): Promise<BrokerNodePty> {
  return await import('node-pty') as unknown as BrokerNodePty;
}

/** What `spawnBrokerChild` needs out of a pinned launch. `PinnedBrokerLaunch` satisfies it. */
export type BrokerChildSpec = {
  launch: BrokerLaunchSpec;
  /** The descriptor `launch.executable` names. Pipe mode hands the child THIS, not a path. */
  executableFd: number;
  /** The CLI's own name, for the child's argv[0] once the executable is a bare descriptor. */
  argv0: string;
  shebang: boolean;
};

/** The shim ships beside the compiled broker, so its path is the broker's own, never the wire's. */
export function pipeStdinShimPath(): string {
  return fileURLToPath(new URL('./pipeStdinExec.py', import.meta.url));
}

/**
 * The one place a broker child is created, for BOTH stdin modes, so the pinned executable, the pinned
 * cwd and the process-group contract cannot drift apart between them.
 *
 * `spec.launch` is the PINNED spec: `executable` and `cwd` are `/proc/self/fd/<n>` paths naming
 * descriptors this process holds open across the call, resolved in the forked child before `execve`.
 *
 * TTY MODE is node-pty, unchanged: it forks, sets up its own session and controlling terminal, and
 * puts the slave on all three descriptors.
 *
 * PIPE MODE cannot use node-pty (it has no way to split fd 0 off the pty) and cannot use a bare
 * `child_process.spawn` either, because three things then go wrong that only the child can fix:
 * node-pty's openpty leaves the MASTER inheritable, so the agent could read its own transcript or
 * write bytes the slave echoes back into it; the slave carries O_NONBLOCK, so a burst larger than the
 * pty buffer comes back EAGAIN on the child's own stdout; and `detached` gives a new session with no
 * CONTROLLING terminal, so SIGWINCH reaches nobody and /dev/tty will not open. So pipe mode execs the
 * pinned `/usr/bin/python3` on `pipeStdinExec.py`, which fixes all three and then execs the CLI off
 * the descriptor it was handed. The pin is not weakened by the extra hop: the CLI arrives as a
 * DESCRIPTOR in a stdio slot (dup2 clears FD_CLOEXEC, so it survives the exec into python), and the
 * shim execs `/proc/self/fd/<that slot>` - no pathname is ever re-resolved.
 */
export async function spawnBrokerChild(spec: BrokerChildSpec, nodePty: BrokerNodePty,
  pipeExec: PinnedPipeStdinExec | null): Promise<BrokerPty> {
  const launch = spec.launch;
  if (launch.stdinMode === 'tty') {
    return await NodePtyChild.adopt(nodePty.spawn(launch.executable, launch.args, nodePtySpawnOptions(launch)));
  }
  if (pipeExec === null) {
    throw new FdPinnedPathError('headless launch needs the pinned pipe-stdin exec shim');
  }
  // A shebang entrypoint reaches the CLI as `args[0] = /proc/self/fd/<entrypoint>`, a number that
  // belongs to THIS process and means nothing after the shim's exec. Both installed CLIs are native
  // binaries so this is unreachable today, and it is refused rather than launched wrong. (The tty
  // path has the same defect and always has: that descriptor is FD_CLOEXEC, so it is already closed
  // by the time the interpreter opens it. Fixing that is a separate change.)
  if (spec.shebang) throw new FdPinnedPathError('headless launch cannot use a script interpreter');
  const native = nodePty.native;
  if (native === null) throw new Error('node-pty exposes no openpty binding');
  const pair = native.open(launch.cols, launch.rows);
  let child: ChildProcess;
  try {
    child = spawn(pipeExec.interpreter, [
      // `-I` (isolated): no PYTHONPATH, no PYTHONSTARTUP, no user site-packages. The child's env is
      // already the broker's own six-key table, but the shim runs as kb-shell and this makes an
      // injected module directory unable to reach it at all rather than merely unlikely to.
      '-I', `/proc/self/fd/${PIPE_STDIN_SHIM_CHILD_FD}`, String(PIPE_STDIN_EXEC_CHILD_FD),
      spec.argv0, ...launch.args,
    ], {
      // fd 0 a pipe, fd 1 and fd 2 the pty slave, then the two descriptors the shim needs. libuv
      // dup2s each into the slot named by its index, and dup2 clears FD_CLOEXEC on what it makes.
      stdio: ['pipe', pair.slave, pair.slave, spec.executableFd, pipeExec.shimFd],
      cwd: launch.cwd,
      env: launch.env,
      // setsid, so the child leads its own session and process group and pgid === pid. That is the
      // premise `killGroup` and `terminateVerifiedIdentity` are both written against, and it is also
      // what lets the shim take the terminal: only a session leader may TIOCSCTTY.
      detached: true,
    });
  } catch (error) {
    closeSync(pair.slave);
    closeSync(pair.master);
    throw error;
  }
  // The child holds its own duplicates now. A parent copy left open would keep the master from ever
  // reporting EIO, and the session could never observe the end of its own output.
  closeSync(pair.slave);
  if (child.pid === undefined) {
    child.stdin?.destroy();
    closeSync(pair.master);
    throw new Error('broker child did not start');
  }
  const master = new TtyReadStream(pair.master);
  try {
    return await PipeStdinChild.adopt(child.pid, child, master, pair.master,
      (fd, cols, rows) => native.resize(fd, cols, rows));
  } catch (error) {
    child.stdin?.destroy();
    master.destroy();
    throw error;
  }
}

/**
 * The pipe-stdin exec pin, taken ONCE at start-up and held for the broker's lifetime: the descriptors
 * are claimed before any session exists to race them. A host with no /usr/bin/python3 must not take
 * the broker down - interactive shells stay servable - so the failure is carried, re-thrown at the
 * launch that needs it, AND published to the capability probe so no agent launcher is advertised that
 * create would refuse.
 */
export type BrokerPipeExec = { pinned: PinnedPipeStdinExec | null; failure: unknown };

export function createBrokerPipeExec(identities: PinIdentities): BrokerPipeExec {
  try { return { pinned: pinPipeStdinExec(pipeStdinShimPath(), identities), failure: null }; }
  catch (error) { return { pinned: null, failure: error }; }
}

function createPinnedLauncher(identities: PinIdentities, nodePty: BrokerNodePty,
  pipeExec: BrokerPipeExec): BrokerPtyLauncher {
  return {
    launch: async (spec: BrokerLaunchSpec): Promise<BrokerPty> => {
      if (spec.stdinMode === 'pipe' && pipeExec.pinned === null) throw pipeExec.failure;
      const pinned = await pinBrokerLaunch(spec, identities);
      try {
        return await spawnBrokerChild(pinned, nodePty, pipeExec.pinned);
      } finally { await pinned.close(); }
    },
  };
}

export async function readProcessIdentity(pid: number): Promise<BrokerProcessIdentity> {
  const raw = await readFile(`/proc/${pid}/stat`, 'utf8');
  const close = raw.lastIndexOf(')');
  const fields = close < 0 ? [] : raw.slice(close + 2).trim().split(/\s+/);
  const pgid = Number(fields[2]);
  const startTimeTicks = fields[19];
  if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isSafeInteger(pgid) || pgid <= 1
      || startTimeTicks === undefined || !/^[0-9]+$/.test(startTimeTicks)) {
    throw new Error('process identity is invalid');
  }
  return { pid, pgid, startTimeTicks };
}

export async function terminateVerifiedIdentity(identity: BrokerProcessIdentity, dependencies: {
  read(pid: number): Promise<BrokerProcessIdentity>;
  kill(pgid: number): void;
} = { read: readProcessIdentity, kill: (pgid) => process.kill(-pgid, 'SIGKILL') }): Promise<void> {
  let current: BrokerProcessIdentity;
  try { current = await dependencies.read(identity.pid); } catch { return; }
  if (current.pid !== identity.pid || current.pgid !== identity.pgid
      || current.startTimeTicks !== identity.startTimeTicks) return;
  try { dependencies.kill(identity.pgid); } catch { /* already gone */ }
}

export type LinuxBrokerMain = { close(): Promise<void>; epochId: string };

export async function startLinuxBrokerMain(socketFd = 3): Promise<LinuxBrokerMain> {
  if (socketFd !== 3) throw new Error('broker requires fd 3');
  if (process.platform !== 'linux' || process.getuid?.() === undefined || process.getgid?.() === undefined) {
    throw new Error('kb-shell broker is Linux-only');
  }
  const identities = await resolveServiceIdentities();
  const socketIdentity = await stat(BROKER_SOCKET_PATH);
  if (!socketIdentity.isSocket() || (socketIdentity.mode & 0o777) !== 0o600
      || socketIdentity.uid !== identities.dashboardUid || socketIdentity.gid !== identities.dashboardGid) {
    throw new Error('broker socket policy is invalid');
  }
  const oldState = await loadRuntimeState(BROKER_RUNTIME_POLICY.statePath, brokerRuntimePolicy(identities));
  const recoveredSessions: BrokerRuntimeSession[] = oldState?.sessions.map(({ sessionId, epochId, identity }) => (
    { sessionId, epochId, identity }
  )) ?? [];
  const epochId = `epoch-${randomBytes(16).toString('hex')}`;
  const pinIdentities = { rootUid: 0, ...identities };
  const pipeExec = createBrokerPipeExec(pinIdentities);
  const broker = new LinuxBrokerServer({
    epochId,
    expectedClientUid: identities.dashboardUid,
    expectedClientGid: identities.dashboardGid,
    launcher: createPinnedLauncher(pinIdentities, await loadBrokerNodePty(), pipeExec),
    // Asked fresh each time the dashboard's capability probe asks, and answered against the same
    // `rootUid: 0` identity set the pinned launcher uses — the enumeration and the launch are looking
    // at the same filesystem through the same rules, as the same user.
    // The SAME headless precondition create enforces: a broker whose python3 pin failed advertises
    // no agent launcher at all, rather than one that refuses the moment an operator picks it.
    enumerateLaunchers: () => enumerateBrokerLaunchers(pinIdentities, undefined, pipeExec.pinned !== null),
    makeSessionId: () => `pty-${randomBytes(16).toString('hex')}`,
    now: () => new Date().toISOString(),
    log: (message) => { process.stderr.write(`${message}\n`); },
    recoveredSessions,
    recoveredReceipts: oldState?.receipts,
    killOrphan: terminateVerifiedIdentity,
    persistState: (state) => storeRuntimeState(BROKER_RUNTIME_POLICY.statePath, state),
  });
  await broker.recoverOrphans();
  const listener = createServer((socket) => {
    void readUnixPeerIdentity(socket).then((peer) => broker.accept(socket, peer), () => socket.destroy());
  });
  await listenOnUnixSocket(listener, { fd: socketFd, expectedPath: BROKER_SOCKET_PATH });
  return {
    epochId,
    close: async () => {
      await broker.shutdown();
      await new Promise<void>((resolve, reject) => listener.close((error) => error === undefined ? resolve() : reject(error)));
    },
  };
}

export type LinuxBrokerInvocation = { kind: 'print-version' } | { kind: 'serve'; socketFd: 3 };

export function parseLinuxBrokerInvocation(argv: readonly string[]): LinuxBrokerInvocation {
  if (argv.length === 1 && argv[0] === '--print-protocol-version') return { kind: 'print-version' };
  if (argv.length === 2 && argv[0] === '--socket-fd=3'
      && argv[1] === `--protocol-version=${BROKER_PROTOCOL}`) return { kind: 'serve', socketFd: 3 };
  throw new Error('invalid broker arguments');
}

export type LinuxBrokerEntrypointDependencies = {
  stdout(value: string): void;
  stderr(value: string): void;
  isSocketFd(fd: number): boolean;
  start(fd: 3): Promise<LinuxBrokerMain>;
};

export async function runLinuxBrokerEntrypoint(argv: readonly string[],
  dependencies: LinuxBrokerEntrypointDependencies): Promise<0 | 1> {
  let invocation: LinuxBrokerInvocation;
  try { invocation = parseLinuxBrokerInvocation(argv); }
  catch (error) {
    dependencies.stderr(`${(error as Error).message.replace(/[\r\n]/g, ' ')}\n`);
    return 1;
  }
  if (invocation.kind === 'print-version') {
    dependencies.stdout(`${BROKER_PROTOCOL}\n`);
    return 0;
  }
  if (!dependencies.isSocketFd(invocation.socketFd)) {
    dependencies.stderr('fd 3 is not a socket\n');
    return 1;
  }
  try { await dependencies.start(invocation.socketFd); return 0; }
  catch (error) {
    dependencies.stderr(`${(error as Error).message.replace(/[\r\n]/g, ' ').slice(0, 160)}\n`);
    return 1;
  }
}

export async function runLinuxBrokerProcess(): Promise<void> {
  const result = await runLinuxBrokerEntrypoint(process.argv.slice(2), {
    stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value),
    isSocketFd: (fd) => { try { return fstatSync(fd).isSocket(); } catch { return false; } },
    start: async (fd) => {
      const main = await startLinuxBrokerMain(fd);
      const stop = (): void => { void main.close().then(() => process.exit(0), () => process.exit(1)); };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
      return main;
    },
  });
  process.exitCode = result;
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href;
if (invokedPath === import.meta.url) void runLinuxBrokerProcess().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message.replace(/[\r\n]/g, ' ').slice(0, 160)}\n`);
  process.exitCode = 1;
});
