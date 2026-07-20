import { randomUUID } from 'node:crypto';
import type { PublicOperationalEvent } from './publicEvents.ts';

export interface ManagedStartSpec {
  runRef: string;
  sessionRef: string;
  role: 'manager' | 'worker';
  profileId: string;
  approvedPrompt: string;
}

export interface ManagedChild {
  stop(): void;
}

export interface ManagedSessionAdapter {
  start(
    spec: ManagedStartSpec,
    observer: { onEvent(event: PublicOperationalEvent): void; onExit(code: number | null, error: string | null): void },
  ): ManagedChild;
}

export type ManagedSessionState = 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted';

export type BrokerMutation =
  | { status: 'applied'; revision: number }
  | { status: 'duplicate'; revision: number }
  | { status: 'conflict'; revision: number }
  | { status: 'inactive'; revision: number };

export type BrokerConsumption = BrokerMutation & { instructions: string[] };

/**
 * Durable broker boundary. Each method is one atomic operation in the implementation:
 * state/event changes commit together, expectedRevision is compare-and-swap, and an
 * idempotencyKey returns the original receipt without applying the operation twice.
 */
export interface BrokerPersistence {
  /** Atomically CAS unused/inactive ownership to running and append its running lifecycle event. */
  reserveStart(input: {
    spec: ManagedStartSpec;
    idempotencyKey: string;
  }): { status: 'reserved'; revision: number } | { status: 'already-active'; revision: number };
  appendEvent(input: {
    runRef: string;
    sessionRef: string;
    event: PublicOperationalEvent;
    idempotencyKey: string;
  }): void;
  /** Atomically transition from running to a terminal state and append its lifecycle event. */
  completeSession(input: {
    runRef: string;
    sessionRef: string;
    state: Exclude<ManagedSessionState, 'running' | 'interrupted'>;
    detail: string | null;
    expectedRevision: number;
    idempotencyKey: string;
  }): BrokerMutation;
  /** Atomically persist the stop intent before any process signal is sent. */
  requestStop(input: {
    runRef: string;
    sessionRef: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): BrokerMutation;
  enqueueSteering(input: {
    runRef: string;
    sessionRef: string;
    instructionRef: string;
    instruction: string;
    checkpoint: string | null;
    expectedRevision: number;
    idempotencyKey: string;
  }): BrokerMutation;
  consumeSteering(input: {
    runRef: string;
    sessionRef: string;
    checkpoint: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): BrokerConsumption;
  /** Atomically CAS running residue to interrupted and append its lifecycle event. */
  interruptResidue(input: {
    runRef: string;
    sessionRef: string;
    idempotencyKey: string;
  }): BrokerMutation;
}

export type BrokerStart =
  | { ok: true; started: true }
  | { ok: true; started: false; reason: 'already-running' }
  | { ok: false; reason: 'spawn-failed' | 'persistence-failed'; detail: string };

interface LiveSession {
  spec: ManagedStartSpec;
  child: ManagedChild | null;
  stopping: boolean;
  stopRequestId: string;
  revision: number;
  eventSequence: number;
}

export interface ManagedSessionBrokerOptions {
  newId?(): string;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One daemon-owned child per logical managed-session reference. Browsers attach to durable events; they
 * never own the process. Inputs deliberately contain no cwd, environment, CLI flags, tools, or permission
 * mode: the adapter resolves those from the server-owned profile id.
 */
export class ManagedSessionBroker {
  readonly #live = new Map<string, LiveSession>();
  readonly #newId: () => string;
  private readonly adapter: ManagedSessionAdapter;
  private readonly persistence: BrokerPersistence;

  constructor(
    adapter: ManagedSessionAdapter,
    persistence: BrokerPersistence,
    options: ManagedSessionBrokerOptions = {},
  ) {
    this.adapter = adapter;
    this.persistence = persistence;
    this.#newId = options.newId ?? randomUUID;
  }

  start(spec: ManagedStartSpec): BrokerStart {
    // Rebuild the adapter input from the closed protocol so runtime callers cannot smuggle cwd/env/flags.
    const safeSpec: ManagedStartSpec = {
      runRef: spec.runRef,
      sessionRef: spec.sessionRef,
      role: spec.role,
      profileId: spec.profileId,
      approvedPrompt: spec.approvedPrompt,
    };
    if (this.#live.has(safeSpec.sessionRef)) return { ok: true, started: false, reason: 'already-running' };

    let reservation: ReturnType<BrokerPersistence['reserveStart']>;
    try {
      reservation = this.persistence.reserveStart({ spec: safeSpec, idempotencyKey: `start:${this.#newId()}` });
    } catch (error) {
      return { ok: false, reason: 'persistence-failed', detail: detail(error) };
    }
    if (reservation.status === 'already-active') {
      return { ok: true, started: false, reason: 'already-running' };
    }

    // Register the reservation before invoking the adapter: an adapter may synchronously call onExit.
    const live: LiveSession = {
      spec: safeSpec,
      child: null,
      stopping: false,
      stopRequestId: `stop:${this.#newId()}`,
      revision: reservation.revision,
      eventSequence: 0,
    };
    this.#live.set(safeSpec.sessionRef, live);

    try {
      const child = this.adapter.start(safeSpec, {
        onEvent: (event) => this.#observeEvent(live, event),
        onExit: (code, error) => this.#observeExit(live, code, error),
      });
      // A synchronous onExit has already removed the reservation; do not resurrect it.
      if (this.#live.get(safeSpec.sessionRef) === live) live.child = child;
      return { ok: true, started: true };
    } catch (error) {
      if (this.#live.get(safeSpec.sessionRef) === live) {
        this.#live.delete(safeSpec.sessionRef);
        this.#complete(live, 'failed', detail(error));
      }
      return { ok: false, reason: 'spawn-failed', detail: detail(error) };
    }
  }

  isRunning(sessionRef: string): boolean {
    return this.#live.has(sessionRef);
  }

  stop(sessionRef: string): boolean {
    const live = this.#live.get(sessionRef);
    if (!live || live.stopping || !live.child) return false;

    let persisted: BrokerMutation;
    try {
      persisted = this.persistence.requestStop({
        runRef: live.spec.runRef,
        sessionRef,
        expectedRevision: live.revision,
        idempotencyKey: live.stopRequestId,
      });
    } catch {
      return false;
    }
    live.revision = Math.max(live.revision, persisted.revision);
    if (persisted.status === 'conflict' || persisted.status === 'inactive') return false;
    live.stopping = true;
    try {
      live.child.stop();
      return true;
    } catch {
      // The durable request remains idempotent. Permit a later retry of the actual signal.
      live.stopping = false;
      return false;
    }
  }

  /** Persist inert operator text before it can become manager input. */
  queueInstruction(sessionRef: string, instruction: string, idempotencyKey = `steer:${this.#newId()}`): boolean {
    return this.#enqueueInstruction(sessionRef, instruction, null, idempotencyKey);
  }

  /** Persist inert operator text for one named safe checkpoint only. */
  queueInstructionAtCheckpoint(
    sessionRef: string,
    checkpoint: string,
    instruction: string,
    idempotencyKey = `steer:${this.#newId()}`,
  ): boolean {
    const boundedCheckpoint = checkpoint.trim().slice(0, 128);
    if (!boundedCheckpoint) return false;
    return this.#enqueueInstruction(sessionRef, instruction, boundedCheckpoint, idempotencyKey);
  }

  #enqueueInstruction(sessionRef: string, instruction: string, checkpoint: string | null, idempotencyKey: string): boolean {
    const live = this.#live.get(sessionRef);
    const bounded = instruction.trim().slice(0, 16_000);
    const operationKey = idempotencyKey.trim().slice(0, 256);
    if (!live || !bounded || !operationKey) return false;
    try {
      const result = this.persistence.enqueueSteering({
        runRef: live.spec.runRef,
        sessionRef,
        instructionRef: `instruction:${operationKey}`,
        instruction: bounded,
        checkpoint,
        expectedRevision: live.revision,
        idempotencyKey: operationKey,
      });
      live.revision = Math.max(live.revision, result.revision);
      if (result.status === 'conflict' || result.status === 'inactive') return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Atomically record checkpoint delivery and consume its durable queue before returning manager input.
   * Retrying the same idempotency key returns the original receipt rather than consuming a second batch.
   */
  reachCheckpoint(sessionRef: string, checkpoint: string, idempotencyKey = `checkpoint:${this.#newId()}`): string[] {
    const live = this.#live.get(sessionRef);
    const bounded = checkpoint.trim().slice(0, 128);
    const operationKey = idempotencyKey.trim().slice(0, 256);
    if (!live || !bounded || !operationKey) return [];
    try {
      const result = this.persistence.consumeSteering({
        runRef: live.spec.runRef,
        sessionRef,
        checkpoint: bounded,
        expectedRevision: live.revision,
        idempotencyKey: operationKey,
      });
      live.revision = Math.max(live.revision, result.revision);
      if (result.status === 'conflict' || result.status === 'inactive') return [];
      return [...result.instructions];
    } catch {
      return [];
    }
  }

  /** Daemon restart recovery: live ownership cannot survive, so durable residue becomes interrupted. */
  recover(sessionRefs: Array<{ runRef: string; sessionRef: string }>): void {
    for (const residue of sessionRefs) {
      if (this.#live.has(residue.sessionRef)) continue;
      try {
        this.persistence.interruptResidue({
          ...residue,
          idempotencyKey: `recovery:${residue.sessionRef}`,
        });
      } catch {
        // One corrupt/unavailable record must not prevent recovery attempts for the rest.
      }
    }
  }

  drain(): void {
    for (const sessionRef of [...this.#live.keys()]) this.stop(sessionRef);
  }

  #observeEvent(live: LiveSession, event: PublicOperationalEvent): void {
    if (this.#live.get(live.spec.sessionRef) !== live) return;
    try {
      this.persistence.appendEvent({
        runRef: live.spec.runRef,
        sessionRef: live.spec.sessionRef,
        event,
        idempotencyKey: `event:${live.spec.sessionRef}:${++live.eventSequence}`,
      });
    } catch {
      // Observer failures never propagate into the adapter or daemon.
    }
  }

  #observeExit(live: LiveSession, code: number | null, error: string | null): void {
    if (this.#live.get(live.spec.sessionRef) !== live) return;
    this.#live.delete(live.spec.sessionRef);
    const state = live.stopping ? 'stopped' : error || code !== 0 ? 'failed' : 'completed';
    this.#complete(live, state, error);
  }

  #complete(
    live: LiveSession,
    state: Exclude<ManagedSessionState, 'running' | 'interrupted'>,
    terminalDetail: string | null,
  ): void {
    try {
      this.persistence.completeSession({
        runRef: live.spec.runRef,
        sessionRef: live.spec.sessionRef,
        state,
        detail: terminalDetail,
        expectedRevision: live.revision,
        idempotencyKey: `complete:${live.spec.sessionRef}`,
      });
    } catch {
      // The child is already gone. Restart recovery reconciles any durable running residue.
    }
  }
}
