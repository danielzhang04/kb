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
  canonicalLaunchers,
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
/**
 * A create in flight, keyed by its request id. The broker flushes the child's opening output
 * IMMEDIATELY after the create ack, so ack and data usually land in ONE socket chunk and are decoded in
 * one synchronous loop. Resolving the ack's promise only schedules a microtask, so a `create` that
 * registered its session in that continuation would not yet exist when the data frame in the same chunk
 * is dispatched, and the session's first frame would be dropped as `no-session`. The frame handler binds
 * the session and the sink synchronously instead, and `create` reads the result here.
 */
type PendingCreate = { sink: SessionSink; attachmentId: string | null; error: Error | null };
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
  onDisconnect?: (info: {
    cause: 'socket-close' | 'socket-error' | 'explicit' | 'decode-error';
    error: string | null;
    lastErrorFrame: { code: string; detail: string | null } | null;
  }) => void;
  onReconcile?: (info: { sessionId: string; error: string }) => void;
};

function failure<T>(refusal: HostRefusalCode, detail: string | null): PortResult<T> {
  return { ok: false, refusal, detail };
}

export class LinuxBrokerClient implements SessionHost {
  private socket: Duplex | null = null;
  private connecting: Promise<void> | null = null;
  private ready: Extract<BrokerServerFrame, { type: 'ready' }> | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly pendingCreates = new Map<string, PendingCreate>();
  private readonly sessions = new Map<string, Session>();
  private closedForever = false;
  private lastErrorFrame: { code: string; detail: string | null } | null = null;

  private readonly options: LinuxBrokerClientOptions;

  constructor(options: LinuxBrokerClientOptions) {
    this.options = options;
  }

  /**
   * The host's own capability answer. `launchers` is the set the BROKER enumerated off the real
   * filesystem as `kb-shell` — never a literal, and never inferred from the fact that a socket
   * accepted us. A connection proves the broker is there; it proves nothing about what is installed
   * inside `/var/lib/kb-shell/home`, which this process cannot even read.
   *
   * `roots` stays the policy constant it has always been: `LINUX_ROOTS` is a compiled-in pair that
   * `pinBrokerLaunch` enforces at launch, not something the broker discovers.
   *
   * Fail closed on every path — an old broker that does not know the `launchers` request answers with
   * an `error` frame, and that lands here as "no capability", not as a guess.
   */
  async probe(): Promise<PtyCapabilityProbe> {
    const checkedAt = (this.options.now ?? (() => new Date().toISOString()))();
    try {
      await this.ensureConnected();
      const ready = this.ready;
      if (ready === null) throw new Error('broker did not send ready');
      const response = await this.request({ type: 'launchers',
        requestId: this.options.makeRequestId(), sessionId: null, epochId: ready.epochId });
      if (response.type !== 'launchers') throw new Error('broker did not enumerate its launchers');
      return { available: true, host: 'vm', transport: 'unix-broker',
        launchers: canonicalLaunchers(response.launchers), roots: ['repo', 'worktrees'],
        epochId: ready.epochId, checkedAt };
    } catch {
      return { available: false, host: 'vm', transport: 'unix-broker',
        reason: 'broker-unavailable', detail: null, checkedAt };
    }
  }

  create(request: SessionHostRequest, sink: SessionSink): HostLaunch {
    const receipt = deferred<PortResult<HostStartReceipt>>();
    const provisionalExit = deferred<ObservedExit>();
    // Set once the create ack has bound a session and sink (`bindSession`, run synchronously inside
    // `handleFrame`). If anything after that point throws, the catch below uses this to find and
    // release what was already registered; otherwise the session and its sink outlive this attempt
    // with no close ever sent, a leak `listEpoch()` and every future frame for that id would carry.
    let bound: { sessionId: string; attachmentId: string } | null = null;
    void (async () => {
      try {
        await this.ensureConnected();
        const ready = this.ready;
        if (ready === null) throw new Error('broker unavailable');
        const requestId = this.options.makeRequestId();
        const creating: PendingCreate = { sink, attachmentId: null, error: null };
        this.pendingCreates.set(requestId, creating);
        let response: BrokerServerFrame;
        try {
          response = await this.request({ type: 'create', requestId,
            sessionId: null, epochId: ready.epochId, operationKey: request.operationKey,
            recipe: request.recipe, rootId: request.rootId, relativeCwd: request.relativeCwd,
            cols: request.cols, rows: request.rows });
        } finally { this.pendingCreates.delete(requestId); }
        if (response.type === 'error') {
          receipt.resolve(failure(response.code, response.detail));
          provisionalExit.resolve(this.abandoned('pty-00000000000000000000000000000000', 0));
          return;
        }
        if (response.type !== 'ack' || response.action !== 'create') throw new Error('unexpected create response');
        if (creating.error !== null) throw creating.error;
        const session = this.sessions.get(response.sessionId);
        if (session === undefined || creating.attachmentId === null) {
          throw new Error('broker create ack was not bound to a session');
        }
        const attachmentId = creating.attachmentId;
        bound = { sessionId: response.sessionId, attachmentId };
        const attached = await this.request({ type: 'attach', requestId: this.options.makeRequestId(),
          sessionId: response.sessionId, epochId: response.epochId, fromSequence: 0 });
        if (attached.type === 'error') {
          session.sinks.delete(attachmentId);
          bound = null;
          // The compensating close is cleanup; whether it succeeds does not change WHY the create was
          // refused, so the attach's own refusal is what the caller is told either way.
          await this.close(response.sessionId);
          receipt.resolve(failure(attached.code, attached.detail));
          provisionalExit.resolve(this.abandoned(response.sessionId, response.sequence + 1));
          return;
        }
        const boundAt = (this.options.now ?? (() => new Date().toISOString()))();
        receipt.resolve({ ok: true, value: { operationKey: response.operationKey,
          sessionId: response.sessionId, epochId: response.epochId, outputSequence: response.sequence,
          boundAt, replayed: response.replayed } });
        void session.exit.promise.then(provisionalExit.resolve);
      } catch {
        if (bound !== null) {
          this.sessions.get(bound.sessionId)?.sinks.delete(bound.attachmentId);
          void this.close(bound.sessionId).then((closeResult) => {
            if (!closeResult.ok) {
              this.options.onReconcile?.({ sessionId: bound!.sessionId, error: closeResult.refusal });
            }
          });
        }
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
      const sequence = session.nextInputSequence++;
      const response = await this.request({ type: 'input', requestId: this.options.makeRequestId(), sessionId,
        epochId: this.ready.epochId, sequence, encoding: 'base64',
        data: Buffer.from(data).toString('base64') });
      if (response.type === 'error') {
        this.releaseSequence(session, sequence);
        return failure(response.code, response.detail);
      }
      if (response.type !== 'ack' || response.action !== 'input') return failure('internal', null);
      return { ok: true, value: { accepted: response.accepted } };
    } catch { return failure('unavailable', null); }
  }

  /**
   * Half-close this session's stdin on the broker side. It takes a slot in the SAME ordered input
   * sequence `write` and `resize` use, so it cannot overtake a prompt already sent; the broker refuses
   * it for a tty session and refuses a repeat, and both arrive here as an ordinary refusal rather than
   * an exception.
   */
  async endInput(sessionId: string): Promise<PortResult<{ ended: true }>> {
    try {
      await this.ensureConnected();
      const session = this.sessions.get(sessionId);
      if (this.ready === null || session === undefined || session.exited) return failure('not-found', null);
      const sequence = session.nextInputSequence++;
      const response = await this.request({ type: 'end-input', requestId: this.options.makeRequestId(), sessionId,
        epochId: this.ready.epochId, sequence });
      if (response.type === 'error') {
        this.releaseSequence(session, sequence);
        return failure(response.code, response.detail);
      }
      if (response.type !== 'ack' || response.action !== 'end-input') return failure('internal', null);
      return { ok: true, value: { ended: true } };
    } catch { return failure('unavailable', null); }
  }

  async resize(sessionId: string, size: SessionSize): Promise<PortResult<SessionSize>> {
    try {
      await this.ensureConnected();
      const session = this.sessions.get(sessionId);
      if (this.ready === null || session === undefined || session.exited) return failure('not-found', null);
      const sequence = session.nextInputSequence++;
      const response = await this.request({ type: 'resize', requestId: this.options.makeRequestId(), sessionId,
        epochId: this.ready.epochId, sequence, cols: size.cols, rows: size.rows });
      if (response.type === 'error') {
        this.releaseSequence(session, sequence);
        return failure(response.code, response.detail);
      }
      if (response.type !== 'ack' || response.action !== 'resize') return failure('internal', null);
      return { ok: true, value: response.size };
    } catch { return failure('unavailable', null); }
  }

  async close(sessionId: string): Promise<PortResult<ObservedExit>> {
    try {
      await this.ensureConnected();
      const session = this.sessions.get(sessionId);
      if (this.ready === null || session === undefined) return failure('not-found', null);
      const sequence = session.nextInputSequence++;
      const response = await this.request({ type: 'close', requestId: this.options.makeRequestId(), sessionId,
        epochId: this.ready.epochId, sequence });
      if (response.type === 'error') {
        this.releaseSequence(session, sequence);
        return failure(response.code, response.detail);
      }
      if (response.type !== 'ack' || response.action !== 'close') return failure('internal', null);
      // The broker acks the close before the child's exit frame, and a broker that never emits that
      // frame would leave this promise pending forever — hanging the caller's start receipt, and with it
      // any cancel waiting on the same start. The ack is the acknowledgement; the exit frame only
      // sharpens it, so it is raced against the same timeout every other request uses.
      return { ok: true, value: await this.exitWithinTimeout(session, sessionId, response.sequence) };
    } catch { return failure('unavailable', null); }
  }

  /**
   * Give a REFUSED input slot back. The broker consumes a session's `inputSequence` only on a request
   * it ACCEPTS: `epoch-lost`, `not-found`, a sequence mismatch, `input-too-large` and both end-input
   * refusals all return before the increment. So a client that kept counting after a refusal would
   * send its NEXT request one number ahead, the broker would refuse that one as out of order, and
   * every request on that session afterwards - one refused frame desyncs the session permanently. The
   * codex path made that reachable in production: an end-input refused for any reason would strand the
   * compensating close that is supposed to clean the session up.
   *
   * Only the TOP of the counter is returned. If another request has already taken a number since,
   * rolling back would hand the same sequence to two requests, so the gap is left visible instead.
   */
  private releaseSequence(session: Session, sequence: number): void {
    if (session.nextInputSequence === sequence + 1) session.nextInputSequence = sequence;
  }

  /** The session's real exit if it lands within the request timeout, else a synthesized `closed` one. */
  private exitWithinTimeout(session: Session, sessionId: string, sequence: number): Promise<ObservedExit> {
    return new Promise<ObservedExit>((resolve) => {
      const timer = setTimeout(() => {
        // The real exit frame never landed in time, so this session is being torn down on the
        // synthesized verdict below. Mark it exited and drop it from the ready listing NOW, the same
        // way a real `exit` frame does in `handleFrame`; otherwise `session.exited` stays false and
        // the id lingers in `listEpoch()` until a real exit frame arrives, if one ever does. Marking it
        // here also makes that late real frame a no-op: `handleFrame`'s `session.exited` guard drops it,
        // so it can never double-resolve `session.exit` or double-remove the id from `ready.sessions`.
        if (session.exited) return;
        session.exited = true;
        const exit: ObservedExit = {
          sessionId, sequence, exitCode: null, signal: null, reason: 'closed',
          observedAt: (this.options.now ?? (() => new Date().toISOString()))(),
        };
        // Settle the teardown FIRST, before touching any sink: `close()`'s caller and `listEpoch()`
        // must never hang or lie about this session's liveness because a sink threw.
        session.exit.resolve(exit);
        // Drop the id from the ready listing on this synthesized verdict, same as a real exit frame.
        // The child itself may still be alive (it ignored the kill); reconciling that with the broker
        // is deferred to `reconcileAbandoned`, which runs on the next connect.
        if (this.ready !== null) {
          this.ready.sessions = this.ready.sessions.filter((item) => item.sessionId !== sessionId);
        }
        resolve(exit);
        // Deliver it to every attached sink exactly like a real `exit` frame does at :443 - an
        // attached browser viewer waits on this same event and would otherwise hang forever, since the
        // late real frame (if the child ignores its kill) is now a no-op above. A faulting sink must
        // not strand the teardown above, which has already settled by this point.
        try {
          for (const sink of session.sinks.values()) if (!sink.closed()) sink.exit(exit);
        } catch { /* sink faults must not strand the teardown */ }
      }, this.options.requestTimeoutMs ?? 5_000);
      timer.unref?.();
      void session.exit.promise.then((exit) => { clearTimeout(timer); resolve(exit); });
    });
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
        if (response.type === 'error' && session !== undefined) this.releaseSequence(session, closeSequence);
        if (response.type === 'error' && response.code === 'not-found') alreadyGone.push(sessionId);
        else if (response.type === 'ack' && response.action === 'close') closed.push(sessionId);
        else if (response.type === 'error') return failure(response.code, response.detail);
        else return failure('internal', null);
      }
      return { ok: true, value: { epochId, closed, alreadyGone } };
    } catch { return failure('unavailable', null); }
  }

  disconnect(): void {
    if (this.closedForever) return;
    this.closedForever = true;
    const socket = this.socket;
    this.handleDisconnect(socket, 'explicit', null);
    socket?.destroy();
  }

  private async ensureConnected(): Promise<void> {
    if (this.closedForever) throw new Error('broker disconnected');
    if (this.ready !== null && this.socket !== null && !this.socket.destroyed) return;
    if (this.connecting !== null) return this.connecting;
    const connecting = this.open();
    this.connecting = connecting;
    try { await connecting; } finally {
      if (this.connecting === connecting) this.connecting = null;
    }
  }

  private async open(): Promise<void> {
    const socket = await this.options.connect();
    if (this.closedForever) {
      socket.destroy();
      throw new Error('broker disconnected');
    }
    if (socket.destroyed) throw new Error('broker socket is closed');
    this.socket = socket;
    this.lastErrorFrame = null;
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    socket.on('data', (chunk: Buffer) => {
      if (socket !== this.socket) return;
      try { for (const frame of decoder.push(chunk)) this.handleFrame(socket, frame); }
      catch (error) {
        this.handleDisconnect(socket, 'decode-error', this.errorMessage(error));
        socket.destroy();
      }
    });
    socket.once('close', () => this.handleDisconnect(socket, 'socket-close', null));
    socket.once('error', (error: Error) => {
      this.handleDisconnect(socket, 'socket-error', error.message);
      socket.destroy();
    });
    try {
      const requestId = this.options.makeRequestId();
      const ready = await this.request({ type: 'hello', requestId, sessionId: null,
        protocol: BROKER_PROTOCOL, dashboardEpochId: this.options.dashboardEpochId }, socket);
      if (ready.type !== 'ready') throw new Error('broker hello did not return ready');
      this.ready = ready;
      this.reconcileAbandoned(ready);
    } catch (error) {
      socket.destroy();
      this.handleDisconnect(socket, 'socket-error', this.errorMessage(error));
      throw error;
    }
  }

  private reconcileAbandoned(ready: Extract<BrokerServerFrame, { type: 'ready' }>): void {
    const abandoned = ready.sessions.filter((item) => this.sessions.get(item.sessionId)?.exited === true);
    if (abandoned.length === 0) return;
    this.ready!.sessions = ready.sessions.filter((item) => !abandoned.includes(item));
    for (const item of abandoned) {
      const session = this.sessions.get(item.sessionId)!;
      void this.request({ type: 'close', requestId: this.options.makeRequestId(),
        sessionId: item.sessionId, epochId: item.epochId,
        sequence: session.nextInputSequence++ }).then((response) => {
        if (response.type !== 'ack' || response.action !== 'close') {
          throw new Error(response.type === 'error'
            ? `broker reconciliation refused: ${response.code}`
            : 'broker reconciliation returned an unexpected response');
        }
      }).catch((error: unknown) => this.options.onReconcile?.({
        sessionId: item.sessionId,
        error: this.errorMessage(error),
      }));
    }
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

  private handleFrame(socket: Duplex, frame: BrokerServerFrame): void {
    if (socket !== this.socket) return;
    if (frame.type === 'error') {
      this.lastErrorFrame = { code: frame.code, detail: frame.detail };
    }
    if (frame.requestId !== null) {
      const creating = this.pendingCreates.get(frame.requestId);
      if (creating !== undefined && frame.type === 'ack' && frame.action === 'create') {
        this.pendingCreates.delete(frame.requestId);
        try {
          creating.attachmentId = this.bindSession(frame.sessionId, frame.epochId, creating.sink);
        } catch (error) {
          creating.error = error instanceof Error ? error : new Error(this.errorMessage(error));
        }
      }
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

  /** Registers a session and one sink SYNCHRONOUSLY; see `PendingCreate`. */
  private bindSession(sessionId: string, epochId: string, sink: SessionSink): string {
    let session = this.sessions.get(sessionId);
    if (session === undefined) {
      session = { sinks: new Map(), nextInputSequence: 0, exit: deferred<ObservedExit>(), exited: false };
      this.sessions.set(sessionId, session);
    }
    if (this.ready !== null && !this.ready.sessions.some((item) => item.sessionId === sessionId)) {
      this.ready.sessions.push({ sessionId, epochId });
    }
    return this.addSink(session, sink);
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

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private handleDisconnect(
    socket: Duplex | null,
    cause: 'socket-close' | 'socket-error' | 'explicit' | 'decode-error',
    error: string | null,
  ): void {
    if (socket !== this.socket) return;
    this.socket = null;
    this.ready = null;
    this.connecting = null;
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
    const lastErrorFrame = this.lastErrorFrame;
    this.lastErrorFrame = null;
    this.options.onDisconnect?.({ cause, error, lastErrorFrame });
  }
}
