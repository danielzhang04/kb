import { randomBytes } from 'node:crypto';
import { constants as fsConstants, fstatSync } from 'node:fs';
import { open, readFile, rename, stat } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { pathToFileURL } from 'node:url';

import type { IPty } from 'node-pty';
import { BROKER_MAX_SESSIONS, BROKER_PROTOCOL } from './brokerProtocol.ts';
import {
  BROKER_RUNTIME_POLICY,
  BROKER_SOCKET_PATH,
  BROKER_SYSTEMD_POLICY,
  pinBrokerLaunch,
  type BrokerLaunchSpec,
} from './fdPinnedPaths.ts';
import {
  LinuxBrokerServer,
  MAX_BROKER_RECEIPTS,
  listenOnUnixSocket,
  type BrokerPeerIdentity,
  type BrokerProcessIdentity,
  type BrokerPty,
  type BrokerPtyLauncher,
  type BrokerRuntimeSession,
  type BrokerRuntimeState,
} from './linuxBrokerServer.ts';

const MAX_RUNTIME_STATE_BYTES = 262_144;
const brokerSessionPattern = /^pty-[0-9a-f]{32}$/;
const brokerEpochPattern = /^epoch-[0-9a-f]{32}$/;
const brokerOperationPattern = /^op-[0-9a-f]{64}$/;

type SocketWithFd = Socket & { _handle?: { fd?: number } };
export type ServiceIdentities = {
  shellUid: number; shellGid: number; dashboardUid: number; dashboardGid: number;
};

function namedId(document: string, name: 'kb-shell' | 'kb-dashboard', field: number): number {
  const row = document.split(/\r?\n/).find((line) => line.split(':')[0] === name);
  const value = row === undefined ? Number.NaN : Number(row.split(':')[field]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} identity is missing`);
  return value;
}

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
 * The units are now reconciled (the socket unit owns /run/kb-shell; the service declares no
 * RuntimeDirectory at all), so 0700 is accepted only as the tmpfiles/manual-provisioning fallback:
 * a directory that strict is unreachable by kb-dashboard, which the WSL gate detects by stat-ing
 * /run/kb-shell rather than by anything this process can see.
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
      gids: [identities.shellGid, identities.dashboardGid],
      modes: [BROKER_RUNTIME_POLICY.runtimeDirectoryMode,
        Number.parseInt(BROKER_SYSTEMD_POLICY.socket.DirectoryMode, 8)],
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

export async function readUnixPeerIdentity(socket: Socket): Promise<BrokerPeerIdentity> {
  if (process.platform !== 'linux') throw new Error('Unix peer identity is Linux-only');
  const fd = (socket as SocketWithFd)._handle?.fd;
  if (!Number.isInteger(fd) || (fd as number) < 0) throw new Error('Unix peer descriptor unavailable');
  const koffi = (await import('koffi')).default;
  const libc = koffi.load(null);
  const getsockopt = libc.func('int getsockopt(int, int, int, _Out_ void *, _Inout_ unsigned int *)');
  const credentials = Buffer.alloc(12);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(credentials.byteLength, 0);
  const result = getsockopt(fd, 1, 17, credentials, length) as number;
  if (result !== 0 || length.readUInt32LE(0) !== 12) throw new Error('SO_PEERCRED failed');
  return { pid: credentials.readInt32LE(0), uid: credentials.readUInt32LE(4), gid: credentials.readUInt32LE(8) };
}

/** node-pty's master socket, the only writability signal the library exposes. */
type PtyMasterSocket = { writableNeedDrain?: boolean; once(event: string, listener: () => void): unknown };

export class NodePtyChild implements BrokerPty {
  readonly pid: number;
  private dataListener: (data: Uint8Array) => void = () => {};
  private exitListener: (exitCode: number | null, signal: number | null) => void = () => {};

  private readonly child: IPty;
  readonly identity: BrokerProcessIdentity;

  constructor(child: IPty, identity: BrokerProcessIdentity) {
    this.child = child;
    this.identity = identity;
    this.pid = child.pid;
    // Spawned with `encoding: null`, so node-pty delivers Buffers: PTY output is never decoded.
    // A string can only appear if that option is lost; latin1 is the byte-preserving fallback.
    child.onData((data: string | Uint8Array) => this.dataListener(
      typeof data === 'string' ? Buffer.from(data, 'latin1') : Buffer.from(data)));
    child.onExit(({ exitCode, signal }) => this.exitListener(exitCode, signal ?? null));
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
  kill(): void {
    try { process.kill(-this.pid, 'SIGKILL'); }
    catch { try { this.child.kill('SIGKILL'); } catch { /* already gone */ } }
  }
  onData(listener: (data: Uint8Array) => void): void { this.dataListener = listener; }
  onExit(listener: (exitCode: number | null, signal: number | null) => void): void { this.exitListener = listener; }
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

async function createPinnedLauncher(identities: ServiceIdentities): Promise<BrokerPtyLauncher> {
  const nodePty = await import('node-pty');
  return {
    launch: async (spec: BrokerLaunchSpec): Promise<BrokerPty> => {
      const pinned = await pinBrokerLaunch(spec, { rootUid: 0, ...identities });
      try {
        const child = nodePty.spawn(pinned.launch.executable, pinned.launch.args,
          nodePtySpawnOptions(pinned.launch));
        let identity: BrokerProcessIdentity;
        try { identity = await readProcessIdentity(child.pid); }
        catch (error) { try { child.kill('SIGKILL'); } catch { /* already gone */ } throw error; }
        return new NodePtyChild(child, identity);
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
  const broker = new LinuxBrokerServer({
    epochId,
    expectedClientUid: identities.dashboardUid,
    expectedClientGid: identities.dashboardGid,
    launcher: await createPinnedLauncher(identities),
    makeSessionId: () => `pty-${randomBytes(16).toString('hex')}`,
    now: () => new Date().toISOString(),
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
