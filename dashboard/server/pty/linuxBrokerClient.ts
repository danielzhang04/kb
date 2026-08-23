import { randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';

import type {
  BrokerClientFrame,
  BrokerServerFrame,
  HostRefusalCode,
  SessionSize,
} from '../../shared/ptyProtocol.ts';
import type {
  HostLaunch,
  HostStartReceipt,
  ObservedExit,
  PortResult,
  PtyCapabilityProbe,
  SessionHost,
  SessionHostRequest,
  SessionSink,
} from './contracts.ts';
import {
  BROKER_MAX_QUEUED_INPUT_BYTES,
  BROKER_PROTOCOL,
  BrokerFrameDecoder,
  decodeBrokerServerFrame,
  encodeBrokerFrame,
} from './brokerProtocol.ts';

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve };
}

type Pending = { resolve(frame: BrokerServerFrame): void; reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> };
type Session = {
  sinks: Map<string, SessionSink>;
  nextInputSequence: number;
  exit: Deferred<ObservedExit>;
  exited: boolean;
};

export type LinuxBrokerClientOptions = {
  connect: () => Promise<Duplex>;
  dashboardEpochId: string;
  makeRequestId: () => string;
  makeAttachmentId?: () => string;
  now?: () => string;
  requestTimeoutMs?: number;
};

function failure<T>(refusal: HostRefusalCode, detail: string | null): PortResult<T> {
  return { ok: false, refusal, detail };
}

export class LinuxBrokerClient implements SessionHost {
  private socket: Duplex | null = null;
  private connecting: Promise<void> | null = null;
  private ready: Extract<BrokerServerFrame, { type: 'ready' }> | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly sessions = new Map<string, Session>();
  private unavailable = false;

  constructor(private readonly options: LinuxBrokerClientOptions) {}

  async probe(): Promise<PtyCapabilityProbe> {
    const checkedAt = (this.options.now ?? (() => new Date().toISOString()))();
    try {
      await this.ensureConnected();
      if (this.ready === null) throw new Error('broker did not send ready');
      return { available: true, host: 'vm', transport: 'unix-broker',
        launchers: ['shell', 'claude', 'codex'], roots: ['repo', 'worktrees'],
        epochId: this.ready.epochId, checkedAt };
    } catch {
      return { available: false, host: 'vm', transport: 'unix-broker',
        reason: 'broker-unavailable', detail: null, checkedAt };
    }
  }

  create(request: SessionHostRequest, sink: SessionSink): HostLaunch {
    const receipt = deferred<PortResult<HostStartReceipt>>();
    const provisionalExit = deferred<ObservedExit>();
    void (async () => {
      try {
        await this.ensureConnected();
        const ready = this.ready;
        if (ready === null) throw new Error('broker unavailable');
        const response = await this.request({ type: 'create', requestId: this.options.makeRequestId(),
          sessionId: null, epochId: ready.epochId, operationKey: request.operationKey,
          recipe: request.recipe, rootId: request.rootId, relativeCwd: request.relativeCwd,
          cols: request.cols, rows: request.rows });
        if (response.type === 'error') {
          receipt.resolve(failure(response.code, response.detail));
          provisionalExit.resolve(this.abandoned('pty-00000000000000000000000000000000', 0));
          return;
        }
        if (response.type !== 'ack' || response.action !== 'create') throw new Error('unexpected create response');
        let session = this.sessions.get(response.sessionId);
        if (session === undefined) {
          session = { sinks: new Map(), nextInputSequence: 0,
            exit: deferred<ObservedExit>(), exited: false };
          this.sessions.set(response.sessionId, session);
        }
        if (!ready.sessions.some((item) => item.sessionId === response.sessionId)) {
          ready.sessions.push({ sessionId: response.sessionId, epochId: response.epochId });
        }
        const attachmentId = this.addSink(session, sink);
        const attached = await this.request({ type: 'attach', requestId: this.options.makeRequestId(),
          sessionId: response.sessionId, epochId: response.epochId, fromSequence: 0 });
        if (attached.type === 'error') {
          session.sinks.delete(attachmentId);
          receipt.resolve(failure(attached.code, attached.detail));
          provisionalExit.resolve(this.abandoned(response.sessionId, response.sequence + 1));
          return;
        }
        const boundAt = (this.options.now ?? (() => new Date().toISOString()))();
        receipt.resolve({ ok: true, value: { operationKey: response.operationKey,
          sessionId: response.sessionId, epochId: response.epochId, revision: response.sequence,
          boundAt, replayed: response.replayed } });
        void session.exit.promise.then(provisionalExit.resolve);
      } catch {
        receipt.resolve(failure('unavailable', null));
        provisionalExit.resolve(this.abandoned('pty-00000000000000000000000000000000', 0));
      }
    })();
    return { receipt: receipt.promise, exit: provisionalExit.promise };
  }

  async attach(sessionId: string, sink: SessionSink): Promise<PortResult<{ attachmentId: string }>> {
    try {
      await this.ensureConnected();
      if (this.ready === null) return failure('unavailable', null);
      let session = this.sessions.get(sessionId);
      if (session === undefined) {
        session = { sinks: new Map(), nextInputSequence: 0,
          exit: deferred<ObservedExit>(), exited: false };
        this.sessions.set(sessionId, session);
      }
      const response = await this.request({ type: 'attach', requestId: this.options.makeRequestId(), sessionId,
        epochId: this.ready.epochId, fromSequence: 0 });
      if (response.type === 'error') return failure(response.code, response.detail);
      if (response.type !== 'ack' || response.action !== 'attach') return failure('internal', null);
      return { ok: true, value: { attachmentId: this.addSink(session, sink) } };
    } catch { return failure('unavailable', null); }
  }

  async write(sessionId: string, data: Uint8Array): Promise<PortResult<{ accepted: number }>> {
    if (data.byteLength > 65_536) return failure('input-too-large', null);
    try {
      await this.ensureConnected();
      const session = this.sessions.get(sessionId);
      if (this.ready === null || session === undefined || session.exited) return failure('not-found', null);
      const socketQueued = this.socket?.writableLength ?? 0;
      if (socketQueued + data.byteLength > BROKER_MAX_QUEUED_INPUT_BYTES) return failure('input-too-large', null);
      const response = await this.request({ type: 'input', requestId: this.options.makeRequestId(), sessionId,
        epochId: this.ready.epochId, sequence: session.nextInputSequence++, encoding: 'base64',
        data: Buffer.from(data).toString('base64') });
      if (response.type === 'error') return failure(response.code, response.detail);
      if (response.type !== 'ack' || response.action !== 'input') return failure('internal', null);
      return { ok: true, value: { accepted: response.accepted } };
    } catch { return failure('unavailable', null); }
  }

  async resize(sessionId: string, size: SessionSize): Promise<PortResult<SessionSize>> {
    try {
      await this.ensureConnected();
      const session = this.sessions.get(sessionId);
      if (this.ready === null || session === undefined || session.exited) return failure('not-found', null);
      const response = await this.request({ type: 'resize', requestId: this.options.makeRequestId(), sessionId,
        epochId: this.ready.epochId, sequence: session.nextInputSequence++, cols: size.cols, rows: size.rows });
      if (response.type === 'error') return failure(response.code, response.detail);
      if (response.type !== 'ack' || response.action !== 'resize') return failure('internal', null);
      return { ok: true, value: response.size };
    } catch { return failure('unavailable', null); }
  }

  async close(sessionId: string): Promise<PortResult<ObservedExit>> {
    try {
      await this.ensureConnected();
      const session = this.sessions.get(sessionId);
      if (this.ready === null || session === undefined) return failure('not-found', null);
      const response = await this.request({ type: 'close', requestId: this.options.makeRequestId(), sessionId,
        epochId: this.ready.epochId, sequence: session.nextInputSequence++ });
      if (response.type === 'error') return failure(response.code, response.detail);
      if (response.type !== 'ack' || response.action !== 'close') return failure('internal', null);
      return { ok: true, value: await session.exit.promise };
    } catch { return failure('unavailable', null); }
  }

  async listEpoch(): Promise<PortResult<{ epochId: string; sessionIds: string[] }>> {
    try {
      await this.ensureConnected();
      if (this.ready === null) return failure('unavailable', null);
      return { ok: true, value: { epochId: this.ready.epochId,
        sessionIds: this.ready.sessions.map((item) => item.sessionId) } };
    } catch { return failure('unavailable', null); }
  }

  async drain(epochId: string): Promise<PortResult<{ epochId: string; closed: string[]; alreadyGone: string[] }>> {
    try {
      await this.ensureConnected();
      if (this.ready === null || this.ready.epochId !== epochId) return failure('epoch-lost', null);
      const snapshot = this.ready.sessions.filter((item) => item.epochId === epochId).map((item) => item.sessionId);
      const closed: string[] = [];
      const alreadyGone: string[] = [];
      for (const sessionId of snapshot) {
        const session = this.sessions.get(sessionId);
        const closeSequence = session === undefined ? 0 : session.nextInputSequence++;
        const response = await this.request({ type: 'close', requestId: this.options.makeRequestId(), sessionId,
          epochId, sequence: closeSequence });
        if (response.type === 'error' && response.code === 'not-found') alreadyGone.push(sessionId);
        else if (response.type === 'ack' && response.action === 'close') closed.push(sessionId);
        else if (response.type === 'error') return failure(response.code, response.detail);
        else return failure('internal', null);
      }
      return { ok: true, value: { epochId, closed, alreadyGone } };
    } catch { return failure('unavailable', null); }
  }

  disconnect(): void {
    this.socket?.destroy();
    this.handleDisconnect();
  }

  private async ensureConnected(): Promise<void> {
    if (this.unavailable) throw new Error('broker disconnected');
    if (this.ready !== null && this.socket !== null && !this.socket.destroyed) return;
    if (this.connecting !== null) return this.connecting;
    this.connecting = this.open();
    try { await this.connecting; } finally { this.connecting = null; }
  }

  private async open(): Promise<void> {
    const socket = await this.options.connect();
    if (socket.destroyed) throw new Error('broker socket is closed');
    this.socket = socket;
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    socket.on('data', (chunk: Buffer) => {
      try { for (const frame of decoder.push(chunk)) this.handleFrame(frame); }
      catch { socket.destroy(); }
    });
    socket.once('close', () => this.handleDisconnect());
    socket.once('error', () => this.handleDisconnect());
    const requestId = this.options.makeRequestId();
    const ready = await this.request({ type: 'hello', requestId, sessionId: null,
      protocol: BROKER_PROTOCOL, dashboardEpochId: this.options.dashboardEpochId }, socket);
    if (ready.type !== 'ready') throw new Error('broker hello did not return ready');
    this.ready = ready;
  }

  private request(frame: BrokerClientFrame, socketOverride?: Duplex): Promise<BrokerServerFrame> {
    if (this.pending.size >= 256) return Promise.reject(new Error('too many broker requests'));
    const socket = socketOverride ?? this.socket;
    if (socket === null || socket.destroyed) return Promise.reject(new Error('broker socket is unavailable'));
    return new Promise<BrokerServerFrame>((resolve, reject) => {
      const timeoutMs = this.options.requestTimeoutMs ?? 5_000;
      const timer = setTimeout(() => {
        this.pending.delete(frame.requestId);
        reject(new Error('broker request timed out'));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(frame.requestId, { resolve, reject, timer });
      socket.write(encodeBrokerFrame(frame), (error?: Error | null) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(frame.requestId);
          reject(error);
        }
      });
    });
  }

  private handleFrame(frame: BrokerServerFrame): void {
    if (frame.requestId !== null) {
      const pending = this.pending.get(frame.requestId);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pending.delete(frame.requestId);
        pending.resolve(frame);
      }
      return;
    }
    if (frame.epochId === null || this.ready === null || frame.epochId !== this.ready.epochId) return;
    if (frame.type === 'data') {
      const session = this.sessions.get(frame.sessionId);
      if (session === undefined || session.exited) return;
      for (const sink of session.sinks.values()) {
        if (!sink.closed()) sink.data({ sessionId: frame.sessionId, sequence: frame.sequence,
          encoding: 'base64', data: frame.data, replay: false });
      }
      return;
    }
    if (frame.type === 'exit') {
      const session = this.sessions.get(frame.sessionId);
      if (session === undefined || session.exited) return;
      session.exited = true;
      const exit: ObservedExit = { sessionId: frame.sessionId, sequence: frame.sequence,
        exitCode: frame.exitCode, signal: frame.signal, reason: frame.reason, observedAt: frame.observedAt };
      for (const sink of session.sinks.values()) if (!sink.closed()) sink.exit(exit);
      session.exit.resolve(exit);
      this.ready.sessions = this.ready.sessions.filter((item) => item.sessionId !== frame.sessionId);
    }
  }

  private addSink(session: Session, sink: SessionSink): string {
    const attachmentId = this.options.makeAttachmentId?.() ?? `att-${randomBytes(16).toString('hex')}`;
    if (!/^att-[0-9a-f]{32}$/.test(attachmentId) || session.sinks.has(attachmentId)) {
      throw new Error('attachment id generator returned an invalid or duplicate id');
    }
    session.sinks.set(attachmentId, sink);
    return attachmentId;
  }

  private abandoned(sessionId: string, sequence: number): ObservedExit {
    return { sessionId, sequence, exitCode: null, signal: null, reason: 'abandoned',
      observedAt: (this.options.now ?? (() => new Date().toISOString()))() };
  }

  private handleDisconnect(): void {
    if (this.unavailable) return;
    this.unavailable = true;
    this.socket = null;
    this.ready = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('broker disconnected'));
    }
    this.pending.clear();
    for (const [sessionId, session] of this.sessions) {
      if (session.exited) continue;
      session.exited = true;
      const exit = this.abandoned(sessionId, session.nextInputSequence);
      for (const sink of session.sinks.values()) if (!sink.closed()) sink.exit(exit);
      session.exit.resolve(exit);
    }
  }
}
