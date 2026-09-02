import { randomBytes } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { connect as connectUnixSocket } from 'node:net';

import type { PtyProbeReason, SafeRootId, SessionLauncher } from '../../shared/ptyProtocol.ts';
import type { PtyCapabilityProbe } from './contracts.ts';
import { canonicalLaunchers } from './brokerProtocol.ts';
import { BROKER_SOCKET_PATH } from './fdPinnedPaths.ts';
import { LinuxBrokerClient } from './linuxBrokerClient.ts';
import type { BrokerPeerIdentity } from './linuxBrokerServer.ts';
import { namedId, readUnixPeerIdentity } from './unixServiceIdentity.ts';

export type BrokerSocketIdentity = {
  kind: 'socket' | 'file' | 'directory' | 'other';
  uid: number;
  gid: number;
  mode: number;
  realpath: string;
};

export type ProbeResult =
  | { available: true; host: 'vm'; transport: 'unix-broker';
      launchers: readonly SessionLauncher[]; roots: readonly SafeRootId[]; epochId: string; checkedAt: string }
  | { available: false; host: 'vm'; transport: 'unix-broker'; reason: PtyProbeReason; detail: string | null; checkedAt: string };

export type BrokerProbeConnection = {
  peer: BrokerPeerIdentity;
  probe(): Promise<ProbeResult>;
  close(): void;
};

export type LinuxBrokerProbeOptions = {
  socketPath: string;
  expectedBrokerUid: number;
  expectedBrokerGid: number;
  expectedSocketUid: number;
  expectedSocketGid: number;
  inspectSocket(path: string): Promise<BrokerSocketIdentity>;
  connect(path: string): Promise<BrokerProbeConnection>;
  now: () => string;
};

function unavailable(checkedAt: string,
  reason: 'broker-unavailable' | 'broker-identity-mismatch' | 'root-policy-invalid' | 'shell-unavailable',
  detail: string | null): PtyCapabilityProbe {
  return { available: false, host: 'vm', transport: 'unix-broker', reason, detail, checkedAt };
}

function validEpochId(value: string): boolean { return /^epoch-[0-9a-f]{32}$/.test(value); }

/**
 * IDENTITY AND CAPABILITY ARE DIFFERENT QUESTIONS, and this probe answers them in that order.
 *
 * IDENTITY — "is the thing on the other end of this socket really our broker?" — is the socket path,
 * the socket's own owner/mode, the peer's uid/gid/pid, and the answer's host/transport/epoch/roots.
 * Every one of those is a fixed property of a correctly deployed broker, so any mismatch is a
 * `broker-identity-mismatch` and the whole PTY capability comes back unavailable. That is right:
 * something is answering on `kb-shell`'s socket that is not `kb-shell`'s broker.
 *
 * CAPABILITY — "which launchers does it have?" — is a property of the MACHINE, not of the broker, and
 * it varies legitimately. This probe used to conflate the two: it demanded the launcher set be exactly
 * `shell,claude,codex` and called anything else an identity mismatch, so a VM with no `codex` had no
 * terminal at all — not even a shell. With enumeration that is now honest rather than hardcoded, that
 * rule would turn every partial install into a total blackout, and it buys no security whatsoever:
 * `pinBrokerLaunch` is the enforcement, it runs at `create` on every launch, and it is untouched here.
 * A capability claim that overstates the machine is caught there; a capability claim that understates
 * it just costs a placement.
 *
 * So the launcher set is now read as capability, with exactly one floor: `shell`. A broker that cannot
 * launch a shell cannot open a terminal at all, which is `shell-unavailable` — the same floor
 * `pty/probe.ts` holds on Windows, where `claude` and `codex` have always been individually optional.
 * The two hosts now answer the same shape of question the same way.
 */
export async function probeLinuxBroker(options: LinuxBrokerProbeOptions): Promise<PtyCapabilityProbe> {
  const checkedAt = options.now();
  if (options.socketPath !== BROKER_SOCKET_PATH) {
    return unavailable(checkedAt, 'root-policy-invalid', 'broker socket policy invalid');
  }
  let socket: BrokerSocketIdentity;
  try { socket = await options.inspectSocket(options.socketPath); }
  catch { return unavailable(checkedAt, 'broker-unavailable', null); }
  if (socket.kind !== 'socket' || socket.realpath !== BROKER_SOCKET_PATH || socket.mode !== 0o600
      || socket.uid !== options.expectedSocketUid || socket.gid !== options.expectedSocketGid) {
    return unavailable(checkedAt, 'broker-identity-mismatch', 'broker socket identity mismatch');
  }
  let connection: BrokerProbeConnection;
  try { connection = await options.connect(options.socketPath); }
  catch { return unavailable(checkedAt, 'broker-unavailable', null); }
  try {
    if (connection.peer.uid !== options.expectedBrokerUid || connection.peer.gid !== options.expectedBrokerGid
        || !Number.isInteger(connection.peer.pid)
        || connection.peer.pid <= 0) {
      return unavailable(checkedAt, 'broker-identity-mismatch', 'broker peer identity mismatch');
    }
    const result = await connection.probe();
    if (!result.available) {
      const reason = result.reason === 'root-policy-invalid' ? 'root-policy-invalid' : 'broker-unavailable';
      return unavailable(checkedAt, reason, result.detail === null ? null : 'broker probe refused');
    }
    if (result.host !== 'vm' || result.transport !== 'unix-broker' || !validEpochId(result.epochId)
        || result.roots.join(',') !== 'repo,worktrees') {
      return unavailable(checkedAt, 'broker-identity-mismatch', 'broker capability identity mismatch');
    }
    // Normalized again on this side of the seam. The production `connect` hands back a client that has
    // already canonicalized, but this port is injected, so the probe never publishes a launcher set it
    // did not itself put in canonical form — a duplicate or an unknown member is DROPPED, never carried.
    const launchers = canonicalLaunchers(result.launchers);
    if (!launchers.includes('shell')) {
      return unavailable(checkedAt, 'shell-unavailable', 'broker enumerated no shell');
    }
    return { available: true, host: 'vm', transport: 'unix-broker',
      launchers, roots: [...result.roots], epochId: result.epochId, checkedAt };
  } catch {
    return unavailable(checkedAt, 'broker-unavailable', null);
  } finally {
    connection.close();
  }
}

/** How long the probe will wait for the socket itself; the client's own request timeout covers the rest. */
const BROKER_CONNECT_TIMEOUT_MS = 5_000;

/** The `epoch-`/`req-` id forms `brokerProtocol.ts` decodes. A UUID is NOT one of them. */
function brokerEpochId(): string { return `epoch-${randomBytes(16).toString('hex')}`; }
function brokerRequestId(): string { return `req-${randomBytes(16).toString('hex')}`; }

async function inspectBrokerSocket(target: string): Promise<BrokerSocketIdentity> {
  // `lstat`, not `stat`: a symlink standing where the socket should be must read as `other` and be
  // refused, not silently followed to whatever it points at.
  const stats = await lstat(target);
  return {
    kind: stats.isSocket() ? 'socket' : stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'other',
    uid: stats.uid,
    gid: stats.gid,
    mode: stats.mode & 0o7777,
    realpath: await realpath(target),
  };
}

async function connectToBroker(target: string): Promise<BrokerProbeConnection> {
  const socket = await new Promise<ReturnType<typeof connectUnixSocket>>((resolve, reject) => {
    const pending = connectUnixSocket(target);
    const timer = setTimeout(() => {
      pending.destroy();
      reject(new Error('broker connect timed out'));
    }, BROKER_CONNECT_TIMEOUT_MS);
    timer.unref?.();
    pending.once('connect', () => { clearTimeout(timer); resolve(pending); });
    pending.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
  try {
    const peer = await readUnixPeerIdentity(socket);
    const client = new LinuxBrokerClient({
      connect: async () => socket,
      dashboardEpochId: brokerEpochId(),
      makeRequestId: brokerRequestId,
      requestTimeoutMs: BROKER_CONNECT_TIMEOUT_MS,
    });
    return {
      peer,
      probe: async () => {
        const probed = await client.probe();
        return probed.available
          ? { available: true, host: 'vm', transport: 'unix-broker',
            launchers: probed.launchers, roots: probed.roots, epochId: probed.epochId, checkedAt: probed.checkedAt }
          : { available: false, host: 'vm', transport: 'unix-broker',
            reason: probed.reason, detail: probed.detail, checkedAt: probed.checkedAt };
      },
      // The probe owns this socket and nothing else uses it: `/api/pty`'s session host builds its own.
      close: () => { client.disconnect(); socket.destroy(); },
    };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

/**
 * The production Linux capability probe, composed once at boot. It reads the machine's own account
 * table because the identity checks are only worth anything against the REAL `kb-shell` and
 * `kb-dashboard` ids — the socket must be owned by the dashboard account (the socket unit's
 * `SocketUser`/`SocketGroup`) and answered by a process running as the shell account (the service
 * unit's `User`/`Group`). Nothing here is a guess; if the accounts cannot be resolved the probe
 * refuses, because an identity check against a made-up uid is worse than no check at all.
 */
export async function probeLinuxBrokerHost(
  options: { now: () => string },
): Promise<PtyCapabilityProbe> {
  let ids: { shellUid: number; shellGid: number; dashboardUid: number; dashboardGid: number };
  try {
    const [passwd, groups] = await Promise.all([
      readFile('/etc/passwd', 'utf8'), readFile('/etc/group', 'utf8'),
    ]);
    ids = {
      shellUid: namedId(passwd, 'kb-shell', 2),
      shellGid: namedId(groups, 'kb-shell', 2),
      dashboardUid: namedId(passwd, 'kb-dashboard', 2),
      dashboardGid: namedId(groups, 'kb-dashboard', 2),
    };
  } catch {
    return unavailable(options.now(), 'broker-unavailable', null);
  }
  return probeLinuxBroker({
    socketPath: BROKER_SOCKET_PATH,
    expectedBrokerUid: ids.shellUid,
    expectedBrokerGid: ids.shellGid,
    expectedSocketUid: ids.dashboardUid,
    expectedSocketGid: ids.dashboardGid,
    inspectSocket: inspectBrokerSocket,
    connect: connectToBroker,
    now: options.now,
  });
}
