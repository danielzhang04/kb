import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

import type {
  BrokerClientFrame,
  BrokerServerFrame,
  HostRefusalCode,
} from '../../shared/ptyProtocol.ts';
import {
  BROKER_MAX_QUEUED_INPUT_BYTES,
  BROKER_MAX_SESSIONS,
  BROKER_PROTOCOL,
  BrokerFrameDecoder,
  BrokerProtocolError,
  decodeBrokerClientFrame,
  encodeBrokerFrame,
} from './brokerProtocol.ts';
import {
  BROKER_SOCKET_PATH,
  FdPinnedPathError,
  buildBrokerLaunch,
  type BrokerLaunchSpec,
} from './fdPinnedPaths.ts';

const MAX_ATTACHMENT_OUTPUT_BYTES = 1_048_576;
const INPUT_PAUSE_BYTES = 196_608;
/** Terminal receipts kept after their session exits, so a replayed operationKey is refused. */
const MAX_TERMINAL_RECEIPTS = 64;
/** Hard bound on persisted receipts: one per live session plus the terminal ring. */
export const MAX_BROKER_RECEIPTS = BROKER_MAX_SESSIONS + MAX_TERMINAL_RECEIPTS;
const MAX_SEQUENCE = 9_007_199_254_740_991;

export type BrokerPeerIdentity = { uid: number; gid: number; pid: number };
export type BrokerProcessIdentity = { pid: number; pgid: number; startTimeTicks: string };

export interface BrokerPty {
  readonly pid: number;
  readonly identity: BrokerProcessIdentity;
  write(data: Uint8Array): Promise<void>;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: Uint8Array) => void): void;
  onExit(listener: (exitCode: number | null, signal: number | null) => void): void;
}

export interface BrokerPtyLauncher {
  launch(spec: BrokerLaunchSpec): Promise<BrokerPty>;
}

export type BrokerRuntimeSession = {
  sessionId: string;
  epochId: string;
  identity: BrokerProcessIdentity;
};

export type BrokerRuntimeState = {
  protocol: typeof BROKER_PROTOCOL;
  epochId: string;
  sessions: Array<BrokerRuntimeSession & { state: 'live' | 'closing'; sequence: number; queuedInputBytes: number }>;
  receipts: Array<{ operationKey: string; requestHash: string; sessionId: string }>;
};

type Session = {
  sessionId: string;
  epochId: string;
  operationKey: string;
  requestHash: string;
  child: BrokerPty;
  sequence: number;
  inputSequence: number;
  queuedInputBytes: number;
  state: 'live' | 'closing';
  attachments: Set<Duplex>;
  pausedInputs: Set<Duplex>;
  durable: boolean;
  pendingData: Uint8Array[];
  pendingExit: { exitCode: number | null; signal: number | null } | null;
  closeAckSent: boolean;
};

type Receipt = { requestHash: string; sessionId: string };
type OutboundState = { blocked: boolean; pending: Uint8Array[]; pendingBytes: number };

export type LinuxBrokerServerOptions = {
  epochId: string;
  expectedClientUid: number;
  expectedClientGid: number;
  launcher: BrokerPtyLauncher;
  makeSessionId: () => string;
  now: () => string;
  recoveredSessions?: readonly BrokerRuntimeSession[];
  recoveredReceipts?: BrokerRuntimeState['receipts'];
  killOrphan?: (identity: BrokerProcessIdentity) => void | Promise<void>;
  persistState?: (state: BrokerRuntimeState) => void | Promise<void>;
};

type UnixServerLike = {
  listen(target: string | { fd: number }, callback: () => void): unknown;
  address(): string | AddressInfo | null;
};

function canonicalSocketPath(value: string): boolean {
  return value === BROKER_SOCKET_PATH && value.startsWith('/') && !value.includes('..') && !value.includes('\\');
}

/** The only production listen gate: a fixed Unix path or an inherited Unix descriptor. */
export async function listenOnUnixSocket(
  server: UnixServerLike,
  target: { fd: number; expectedPath: string },
): Promise<void> {
  const expectedPath = target.expectedPath;
  if (!canonicalSocketPath(expectedPath)) throw new Error('broker listener requires the canonical Unix socket path');
  if (target.fd !== 3) throw new Error('broker listener requires inherited fd 3');
  await new Promise<void>((resolve, reject) => {
    try {
      const callback = (): void => resolve();
      server.listen({ fd: target.fd }, callback);
    } catch (error) { reject(error); }
  });
  const address = server.address();
  if (typeof address !== 'string' || address !== expectedPath) {
    throw new Error('broker listener address is not the exact canonical Unix socket path');
  }
}

function hashCreate(frame: Extract<BrokerClientFrame, { type: 'create' }>): string {
  return createHash('sha256').update(JSON.stringify({
    recipe: frame.recipe,
    rootId: frame.rootId,
    relativeCwd: frame.relativeCwd,
    cols: frame.cols,
    rows: frame.rows,
  })).digest('hex');
}

function nextSequence(session: Session): number {
  if (session.sequence >= MAX_SEQUENCE) {
    session.state = 'closing';
    session.child.kill();
    throw new BrokerProtocolError('session sequence overflow', 'internal');
  }
  const value = session.sequence;
  session.sequence += 1;
  return value;
}

function safeDetail(error: unknown): string {
  if (error instanceof FdPinnedPathError || error instanceof BrokerProtocolError) {
    return error.message.replace(/[\r\n]/g, ' ').slice(0, 160);
  }
  return 'broker request refused';
}

export class LinuxBrokerServer {
  private readonly sessions = new Map<string, Session>();
  private readonly receipts = new Map<string, Receipt>();
  private readonly recovered = new Map<string, BrokerRuntimeSession>();
  private readonly suppressedEpochs = new Set<string>();
  private readonly observers = new Set<(frame: BrokerServerFrame) => void>();
  private readonly outbound = new WeakMap<Duplex, OutboundState>();
  private createTail: Promise<void> = Promise.resolve();
  private persistTail: Promise<void> = Promise.resolve();
  private recoveryComplete: boolean;

  private readonly options: LinuxBrokerServerOptions;

  constructor(options: LinuxBrokerServerOptions) {
    this.options = options;
    for (const session of options.recoveredSessions ?? []) this.recovered.set(session.sessionId, session);
    for (const receipt of options.recoveredReceipts ?? []) {
      this.receipts.set(receipt.operationKey, { requestHash: receipt.requestHash, sessionId: receipt.sessionId });
    }
    this.recoveryComplete = this.recovered.size === 0;
  }

  onFrame(listener: (frame: BrokerServerFrame) => void): () => void {
    this.observers.add(listener);
    return () => this.observers.delete(listener);
  }

  orphanSessionIds(): string[] { return [...this.recovered.keys()].sort(); }

  async recoverOrphans(): Promise<void> {
    for (const session of this.recovered.values()) {
      this.suppressedEpochs.add(session.epochId);
      await this.options.killOrphan?.(session.identity);
    }
    this.recovered.clear();
    // A killed orphan's receipt becomes terminal, so its operationKey still refuses a replay.
    this.pruneReceipts();
    this.recoveryComplete = true;
    await this.persist();
  }

  accept(socket: Duplex, peer: BrokerPeerIdentity): void {
    if (peer.uid !== this.options.expectedClientUid || peer.gid !== this.options.expectedClientGid || !this.recoveryComplete) {
      socket.destroy();
      return;
    }
    let greeted = false;
    const decoder = new BrokerFrameDecoder(decodeBrokerClientFrame);
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const frame of decoder.push(chunk)) {
          if (!greeted) {
            if (frame.type !== 'hello') throw new BrokerProtocolError('hello must be the first frame');
            greeted = true;
            this.send(socket, {
              type: 'ready', requestId: frame.requestId, sessionId: null, protocol: BROKER_PROTOCOL,
              epochId: this.options.epochId, maxFrameBytes: 98_304, maxInputBytes: 65_536,
              maxQueuedInputBytes: 262_144,
              sessions: [...this.sessions.values()].map(({ sessionId, epochId }) => ({ sessionId, epochId })),
            });
            continue;
          }
          if (frame.type === 'hello') throw new BrokerProtocolError('hello may be sent only once');
          void this.handle(socket, frame).catch((error: unknown) => {
            this.sendError(socket, frame.requestId, frame.sessionId, 'internal', safeDetail(error));
          });
        }
      } catch (error) {
        this.sendError(socket, null, null,
          error instanceof BrokerProtocolError ? error.refusal : 'invalid-request', safeDetail(error));
        socket.destroy();
      }
    });
    socket.on('close', () => {
      for (const session of this.sessions.values()) session.attachments.delete(socket);
    });
  }

  private async handle(socket: Duplex, frame: Exclude<BrokerClientFrame, { type: 'hello' }>): Promise<void> {
    if (frame.epochId !== this.options.epochId) {
      this.sendError(socket, frame.requestId, frame.sessionId, 'epoch-lost', null);
      return;
    }
    if (frame.type === 'create') {
      const queued = this.createTail.then(() => this.create(socket, frame));
      this.createTail = queued.catch(() => {});
      await queued;
      return;
    }
    const session = this.sessions.get(frame.sessionId);
    if (session === undefined) {
      this.sendError(socket, frame.requestId, frame.sessionId, 'not-found', null);
      return;
    }
    if (frame.type === 'attach') {
      session.attachments.add(socket);
      this.send(socket, { type: 'ack', requestId: frame.requestId, action: 'attach',
        sessionId: session.sessionId, epochId: session.epochId, sequence: nextSequence(session), replayFrom: frame.fromSequence });
      await this.persist();
      return;
    }
    if (frame.type === 'input') {
      const input = Buffer.from(frame.data, 'base64');
      if (session.state !== 'live') {
        this.sendError(socket, frame.requestId, frame.sessionId, 'not-found', null);
        return;
      }
      if (frame.sequence !== session.inputSequence) {
        this.sendError(socket, frame.requestId, frame.sessionId, 'invalid-request', null);
        return;
      }
      if (session.queuedInputBytes + input.byteLength > BROKER_MAX_QUEUED_INPUT_BYTES) {
        this.sendError(socket, frame.requestId, frame.sessionId, 'input-too-large', null);
        return;
      }
      session.inputSequence += 1;
      session.queuedInputBytes += input.byteLength;
      if (session.queuedInputBytes > INPUT_PAUSE_BYTES) {
        socket.pause();
        session.pausedInputs.add(socket);
      }
      await this.persist();
      try {
        await session.child.write(input);
      } finally {
        session.queuedInputBytes -= input.byteLength;
        if (session.queuedInputBytes < INPUT_PAUSE_BYTES) {
          for (const paused of session.pausedInputs) if (!paused.destroyed) paused.resume();
          session.pausedInputs.clear();
        }
      }
      this.send(socket, { type: 'ack', requestId: frame.requestId, action: 'input', sessionId: session.sessionId,
        epochId: session.epochId, sequence: nextSequence(session), accepted: input.byteLength });
      await this.persist();
      return;
    }
    if (frame.type === 'resize') {
      if (session.state !== 'live') { this.sendError(socket, frame.requestId, frame.sessionId, 'not-found', null); return; }
      if (frame.sequence !== session.inputSequence) {
        this.sendError(socket, frame.requestId, frame.sessionId, 'invalid-request', null); return;
      }
      session.inputSequence += 1;
      session.child.resize(frame.cols, frame.rows);
      this.send(socket, { type: 'ack', requestId: frame.requestId, action: 'resize', sessionId: session.sessionId,
        epochId: session.epochId, sequence: nextSequence(session), size: { cols: frame.cols, rows: frame.rows } });
      await this.persist();
      return;
    }
    if (frame.sequence !== session.inputSequence) {
      this.sendError(socket, frame.requestId, frame.sessionId, 'invalid-request', null); return;
    }
    session.inputSequence += 1;
    const replayed = session.state === 'closing';
    if (!replayed) {
      session.state = 'closing';
      session.child.kill();
    }
    this.send(socket, { type: 'ack', requestId: frame.requestId, action: 'close', sessionId: session.sessionId,
      epochId: session.epochId, sequence: nextSequence(session), replayed });
    session.closeAckSent = true;
    if (session.pendingExit !== null) {
      const pending = session.pendingExit;
      session.pendingExit = null;
      this.finalizeExit(session, pending.exitCode, pending.signal);
    }
    await this.persist();
  }

  private async create(socket: Duplex, frame: Extract<BrokerClientFrame, { type: 'create' }>): Promise<void> {
    const requestHash = hashCreate(frame);
    const prior = this.receipts.get(frame.operationKey);
    if (prior !== undefined) {
      if (prior.requestHash !== requestHash) {
        this.sendError(socket, frame.requestId, null, 'binding-conflict', null);
        return;
      }
      const existing = this.sessions.get(prior.sessionId);
      if (existing === undefined) { this.sendError(socket, frame.requestId, prior.sessionId, 'not-found', null); return; }
      this.send(socket, { type: 'ack', requestId: frame.requestId, action: 'create', sessionId: existing.sessionId,
        epochId: existing.epochId, sequence: nextSequence(existing), operationKey: frame.operationKey, replayed: true });
      return;
    }
    if (this.sessions.size >= BROKER_MAX_SESSIONS) {
      this.sendError(socket, frame.requestId, null, 'capacity', null);
      return;
    }
    let spec: BrokerLaunchSpec;
    try {
      spec = buildBrokerLaunch(frame.recipe, frame.rootId, frame.relativeCwd, { cols: frame.cols, rows: frame.rows });
    } catch (error) {
      this.sendError(socket, frame.requestId, null,
        error instanceof FdPinnedPathError ? 'unsafe-cwd' : 'invalid-request', safeDetail(error));
      return;
    }
    const child = await this.options.launcher.launch(spec);
    const sessionId = this.options.makeSessionId();
    const session: Session = {
      sessionId, epochId: this.options.epochId, operationKey: frame.operationKey, requestHash,
      child, sequence: 0, inputSequence: 0, queuedInputBytes: 0, state: 'live', attachments: new Set(),
      pausedInputs: new Set(), durable: false, pendingData: [], pendingExit: null, closeAckSent: false,
    };
    this.sessions.set(sessionId, session);
    this.receipts.set(frame.operationKey, { requestHash, sessionId });
    child.onData((data) => this.output(session, data));
    child.onExit((exitCode, signal) => this.exit(session, exitCode, signal));
    try {
      await this.persist();
    } catch (error) {
      this.sessions.delete(sessionId);
      this.receipts.delete(frame.operationKey);
      child.kill();
      throw error;
    }
    session.durable = true;
    session.attachments.add(socket);
    this.send(socket, { type: 'ack', requestId: frame.requestId, action: 'create', sessionId,
      epochId: session.epochId, sequence: nextSequence(session), operationKey: frame.operationKey, replayed: false });
    for (const data of session.pendingData.splice(0)) this.output(session, data);
    if (session.pendingExit !== null) {
      const pending = session.pendingExit;
      session.pendingExit = null;
      this.finalizeExit(session, pending.exitCode, pending.signal);
    }
  }

  private output(session: Session, data: Uint8Array): void {
    if (!this.sessions.has(session.sessionId) || this.suppressedEpochs.has(session.epochId)) return;
    if (!session.durable) {
      const queued = session.pendingData.reduce((total, value) => total + value.byteLength, 0);
      if (queued + data.byteLength > MAX_ATTACHMENT_OUTPUT_BYTES) session.child.kill();
      else session.pendingData.push(Buffer.from(data));
      return;
    }
    const bytes = Buffer.from(data);
    for (let offset = 0; offset < bytes.byteLength; offset += 65_536) {
      const frame: BrokerServerFrame = { type: 'data', requestId: null, sessionId: session.sessionId,
        epochId: session.epochId, sequence: nextSequence(session), encoding: 'base64',
        data: bytes.subarray(offset, offset + 65_536).toString('base64') };
      const encodedBytes = encodeBrokerFrame(frame).byteLength;
      for (const attachment of [...session.attachments]) {
        const queued = 'writableLength' in attachment ? attachment.writableLength : 0;
        if (queued + encodedBytes > MAX_ATTACHMENT_OUTPUT_BYTES) {
          session.attachments.delete(attachment);
          attachment.destroy();
        } else this.send(attachment, frame);
      }
    }
    void this.persist();
  }

  private exit(session: Session, exitCode: number | null, signal: number | null): void {
    if (!this.sessions.has(session.sessionId) || this.suppressedEpochs.has(session.epochId)) return;
    if (!session.durable || (session.state === 'closing' && !session.closeAckSent)) {
      session.pendingExit = { exitCode, signal };
      return;
    }
    this.finalizeExit(session, exitCode, signal);
  }

  private finalizeExit(session: Session, exitCode: number | null, signal: number | null): void {
    const reason = session.state === 'closing' ? 'closed' : 'exited';
    const frame: BrokerServerFrame = { type: 'exit', requestId: null, sessionId: session.sessionId,
      epochId: session.epochId, sequence: nextSequence(session), exitCode, signal, reason,
      observedAt: this.options.now() };
    for (const attachment of session.attachments) this.send(attachment, frame);
    this.sessions.delete(session.sessionId);
    // The receipt outlives the session: a create replayed after exit must be refused (`not-found`),
    // never launch a second shell. Only the oldest terminal receipts beyond the ring are dropped.
    this.pruneReceipts();
    void this.persist();
  }

  /** Keep every live session's receipt plus the newest MAX_TERMINAL_RECEIPTS terminal ones. */
  private pruneReceipts(): void {
    const terminal: string[] = [];
    for (const [operationKey, receipt] of this.receipts) {
      if (!this.sessions.has(receipt.sessionId)) terminal.push(operationKey);
    }
    for (const operationKey of terminal.slice(0, Math.max(0, terminal.length - MAX_TERMINAL_RECEIPTS))) {
      this.receipts.delete(operationKey);
    }
  }

  private sendError(socket: Duplex, requestId: string | null, sessionId: string | null,
    code: HostRefusalCode, detail: string | null): void {
    this.send(socket, { type: 'error', requestId, sessionId, epochId: this.options.epochId, code, detail });
  }

  private send(socket: Duplex, frame: BrokerServerFrame): void {
    for (const observer of this.observers) observer(frame);
    if (socket.destroyed) return;
    const encoded = encodeBrokerFrame(frame);
    let state = this.outbound.get(socket);
    if (state === undefined) {
      state = { blocked: false, pending: [], pendingBytes: 0 };
      this.outbound.set(socket, state);
    }
    if (state.blocked) {
      if (state.pendingBytes + encoded.byteLength > MAX_ATTACHMENT_OUTPUT_BYTES) {
        this.detachSlowSocket(socket);
        return;
      }
      state.pending.push(encoded);
      state.pendingBytes += encoded.byteLength;
      return;
    }
    if (!socket.write(encoded)) {
      state.blocked = true;
      socket.once('drain', () => this.flush(socket));
    }
  }

  private flush(socket: Duplex): void {
    const state = this.outbound.get(socket);
    if (state === undefined || socket.destroyed) return;
    state.blocked = false;
    while (state.pending.length > 0) {
      const encoded = state.pending.shift()!;
      state.pendingBytes -= encoded.byteLength;
      if (!socket.write(encoded)) {
        state.blocked = true;
        socket.once('drain', () => this.flush(socket));
        return;
      }
    }
  }

  private detachSlowSocket(socket: Duplex): void {
    for (const session of this.sessions.values()) {
      session.attachments.delete(socket);
      session.pausedInputs.delete(socket);
    }
    socket.destroy();
  }

  private async persist(): Promise<void> {
    const snapshot: BrokerRuntimeState = {
      protocol: BROKER_PROTOCOL,
      epochId: this.options.epochId,
      sessions: [...this.sessions.values()].map((session) => ({ sessionId: session.sessionId,
        epochId: session.epochId, identity: session.child.identity, state: session.state,
        sequence: session.sequence, queuedInputBytes: session.queuedInputBytes })),
      receipts: [...this.receipts].map(([operationKey, receipt]) => ({ operationKey, ...receipt })),
    };
    const queued = this.persistTail.then(async () => this.options.persistState?.(snapshot));
    this.persistTail = queued.then(() => {}, () => {});
    await queued;
  }

  async shutdown(): Promise<void> {
    this.suppressedEpochs.add(this.options.epochId);
    for (const session of this.sessions.values()) session.child.kill();
    this.sessions.clear();
    this.pruneReceipts();
    await this.persist();
  }
}
