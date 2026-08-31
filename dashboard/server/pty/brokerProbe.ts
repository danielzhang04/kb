import type { PtyProbeReason, SafeRootId, SessionLauncher } from '../../shared/ptyProtocol.ts';
import type { PtyCapabilityProbe } from './contracts.ts';
import { BROKER_SOCKET_PATH } from './fdPinnedPaths.ts';
import type { BrokerPeerIdentity } from './linuxBrokerServer.ts';

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

function unavailable(checkedAt: string, reason: 'broker-unavailable' | 'broker-identity-mismatch' | 'root-policy-invalid',
  detail: string | null): PtyCapabilityProbe {
  return { available: false, host: 'vm', transport: 'unix-broker', reason, detail, checkedAt };
}

function validEpochId(value: string): boolean { return /^epoch-[0-9a-f]{32}$/.test(value); }

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
        || result.launchers.join(',') !== 'shell,claude,codex' || result.roots.join(',') !== 'repo,worktrees') {
      return unavailable(checkedAt, 'broker-identity-mismatch', 'broker capability identity mismatch');
    }
    return { available: true, host: 'vm', transport: 'unix-broker',
      launchers: [...result.launchers], roots: [...result.roots], epochId: result.epochId, checkedAt };
  } catch {
    return unavailable(checkedAt, 'broker-unavailable', null);
  } finally {
    connection.close();
  }
}
