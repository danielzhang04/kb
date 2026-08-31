import { createHash, randomBytes } from 'node:crypto';

import type {
  ApprovedManualCreate,
  AttemptBinding,
  AttemptBindingPort,
  AttemptOperationRecord,
  BrowserPrincipal,
  ClaimReceipt,
  ClaimRunControllerInput,
  LaunchRecipe,
  ObservedExit,
  OperationReceipt,
  PortResult,
  SessionDataFrame,
  SessionHost,
  SessionRecord,
  SessionRegistryPort,
  SessionSink,
  SessionSummary,
} from './contracts.ts';
import {
  MAX_PRINCIPAL_LIVE_SESSIONS,
  RUN_CONTROLLER_NULL_BROWSER_SESSION_REF,
  principalCapacityKey,
} from './contracts.ts';
import {
  applyEpochAbandonment,
  applyObservedSessionExit,
  beginOperationReceipt,
  insertSessionRecord,
  settleOperationReceipt,
} from './sessionPersistence.ts';
import type { SessionPersistence, TranscriptRetention } from './sessionPersistence.ts';

export const MAX_SESSION_ATTACHMENTS = 64;

export type HostPrincipalSource =
  | { provenance: 'manual'; controller: BrowserPrincipal }
  | { provenance: 'run'; operator: string; controller: BrowserPrincipal | null };

/**
 * Every `SessionHostRequest` names a principal (contracts amendment 1) — the host, not the
 * registry, owns per-principal capacity. Controller-null Run sessions borrow the owning operator
 * with the fixed non-minted `RUN_CONTROLLER_NULL_BROWSER_SESSION_REF`.
 */
export function hostRequestPrincipal(source: HostPrincipalSource): BrowserPrincipal {
  if (source.provenance === 'manual') return { ...source.controller };
  return source.controller === null
    ? { operator: source.operator, browserSessionRef: RUN_CONTROLLER_NULL_BROWSER_SESSION_REF }
    : { ...source.controller };
}

export function principalMatches(left: BrowserPrincipal, right: BrowserPrincipal): boolean {
  return left.operator === right.operator && left.browserSessionRef === right.browserSessionRef;
}

export function sessionIsControlledBy(record: SessionRecord, principal: BrowserPrincipal): boolean {
  return record.controller !== null && principalMatches(record.controller, principal);
}

export function summarizeSessionRecord(record: SessionRecord): SessionSummary {
  return {
    sessionId: record.sessionId,
    name: record.name,
    host: record.host,
    launcher: record.launcher,
    rootId: record.rootId,
    cwd: record.relativeCwd,
    state: record.state,
    attachmentCount: record.attachmentIds.length,
    attachmentState: record.attachmentIds.length === 0 ? 'detached' : 'attached',
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    exit: record.exit === null ? null : {
      exitCode: record.exit.exitCode,
      reason: record.exit.reason,
      observedAt: record.exit.observedAt,
    },
  };
}

function refusal(refusal: 'not-found' | 'binding-conflict', detail: string): PortResult<ClaimReceipt> {
  return { ok: false, refusal, detail };
}

/** Pure mutation used inside the persistence CAS by the route-facing registry. */
export function claimRunController(
  record: SessionRecord,
  principal: BrowserPrincipal,
  input: ClaimRunControllerInput,
  currentRunVersion: number | null,
): PortResult<ClaimReceipt> {
  if (record.provenance !== 'run' || record.operator !== principal.operator
    || record.runRef !== input.runRef || record.sessionId !== input.sessionId
    || record.state === 'exited' || record.state === 'abandoned') {
    return refusal('not-found', 'session not found');
  }
  if (record.controller !== null) {
    if (!principalMatches(record.controller, principal)) return refusal('not-found', 'session not found');
    const originalRevision = record.claimRevision - 1;
    if (currentRunVersion !== input.expectedRunVersion
      || input.expectedSessionRevision !== originalRevision) {
      return refusal('binding-conflict', 'controller claim revision conflict');
    }
    // Byte-stable envelope: the original claim's revision and session id, flagged as a replay so
    // callers can tell an idempotent retry from a first claim (ClaimReceipt.replayed).
    return { ok: true, value: { revision: record.claimRevision, sessionId: record.sessionId, replayed: true } };
  }
  if (currentRunVersion === null) return refusal('not-found', 'session not found');
  if (currentRunVersion !== input.expectedRunVersion || record.revision !== input.expectedSessionRevision
    || record.revision >= Number.MAX_SAFE_INTEGER) {
    return refusal('binding-conflict', 'controller claim revision conflict');
  }

  const revision = record.revision + 1;
  Object.assign(record, { controller: { ...principal }, claimRevision: revision, revision });
  return { ok: true, value: { revision, sessionId: record.sessionId, replayed: false } };
}

export function createAttachmentClosure(
  attachmentId: string,
  attachmentIds: Set<string>,
): () => Promise<void> {
  let detached = false;
  return async () => {
    if (detached) return;
    detached = true;
    attachmentIds.delete(attachmentId);
  };
}

export type DeploymentSessionCloser = (sessionIds: readonly string[]) =>
  Promise<PortResult<{ closed: string[] }>>;

export interface PersistRunSessionInput {
  record: SessionRecord;
  binding: AttemptBinding;
  receipt: OperationReceipt;
}

export interface SessionRecordRegistry extends SessionRegistryPort, AttemptBindingPort {
  persistRunSession(input: PersistRunSessionInput): Promise<PortResult<{ revision: number }>>;
  abandonEpoch(epochId: string, reason: 'epoch-lost' | 'daemon-restart' | 'start-recovery'):
    Promise<PortResult<{ abandoned: number; revision: number }>>;
}

export interface SessionRecordRegistryDeps {
  host: SessionHost;
  persistence: SessionPersistence;
  now?: () => string;
  makeOperationKey?: () => string;
  resolveManualRecipe?: (input: ApprovedManualCreate) => LaunchRecipe | null;
  transcript?: TranscriptRetention;
  /** Returns null unless the operator has scoped Run-read access. */
  resolveRunVersion?: (operator: string, runRef: string) => number | null | Promise<number | null>;
  /** Receives the only cross-controller closer; it is deliberately absent from the returned registry. */
  installDeploymentCloser?: (closer: DeploymentSessionCloser) => void;
  onBackgroundError?: (error: unknown) => void;
}

const ACTIVE_SESSION_STATES = new Set(['starting', 'live', 'closing']);
const SESSION_ID = /^pty-[0-9a-f]{32}$/;
const ATTACHMENT_ID = /^att-[0-9a-f]{32}$/;
const OPERATION_KEY = /^op-[0-9a-f]{64}$/;

function internal<T>(): PortResult<T> {
  return { ok: false, refusal: 'internal', detail: 'session operation failed' };
}

function manualRecipe(input: ApprovedManualCreate): LaunchRecipe | null {
  if (input.launcher !== 'shell') return null;
  return { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'interactive', sandbox: 'interactive' };
}

function live(record: SessionRecord): boolean {
  return ACTIVE_SESSION_STATES.has(record.state);
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validManualInput(input: ApprovedManualCreate): boolean {
  return ['shell', 'claude', 'codex'].includes(input.launcher)
    && ['repo', 'worktrees'].includes(input.rootId)
    && typeof input.relativeCwd === 'string' && Buffer.byteLength(input.relativeCwd, 'utf8') <= 240
    && Number.isSafeInteger(input.cols) && input.cols >= 20 && input.cols <= 500
    && Number.isSafeInteger(input.rows) && input.rows >= 5 && input.rows <= 200;
}

/** Pure-policy registry over the one injected v2 persistence port and one injected host. */
export function createSessionRecordRegistry(deps: SessionRecordRegistryDeps): SessionRecordRegistry {
  const now = deps.now ?? (() => new Date().toISOString());
  const makeOperationKey = deps.makeOperationKey
    ?? (() => `op-${randomBytes(32).toString('hex')}`);
  const transcriptQueues = new Map<string, Promise<void>>();

  const reportInternal = <T>(error: unknown): PortResult<T> => {
    deps.onBackgroundError?.(error);
    return internal<T>();
  };

  const background = (work: Promise<unknown>): void => {
    void work.catch((error) => deps.onBackgroundError?.(error));
  };

  /**
   * [C-R6] cursor minting (W0 amendment #3). A host numbers its output frames 1, 2, 3 …; the wire
   * numbers BYTES. This is the one place the translation happens, so the offset a browser holds, the
   * offset the retention writer is handed, and the offset the replay reader serves are the same number.
   *
   * The same host frame reaches every sink of a session (the registry's own transcript sink and one per
   * attachment), and the hosts differ in how: the Windows host hands the SAME object to each attachment
   * from independent async queues, the Linux broker builds a fresh object per sink inside one
   * synchronous loop. Minting is therefore idempotent twice over — by frame identity (`minted`) and by
   * host sequence (`lastHostSequence`) — because counting one frame's bytes twice would shift every
   * later offset off the transcript for good.
   */
  const offsets = new Map<string, { total: number; lastHostSequence: number; lastOffset: number }>();
  const minted = new WeakMap<SessionDataFrame, number>();

  const mintOffset = (frame: SessionDataFrame): number => {
    const known = minted.get(frame);
    if (known !== undefined) return known;
    let state = offsets.get(frame.sessionId);
    if (state === undefined) {
      // A record that already holds bytes (a re-created registry over live persistence) resumes its
      // stream where the transcript ends; a fresh session starts at offset 0. `lastSequence` is trusted
      // as a byte total, but a record written by an earlier build may have stored a FRAME COUNTER there
      // instead — a cumulative byte total can never be smaller than what is still retained on disk, so
      // the baseline is whichever of the two is larger.
      const record = deps.persistence.read().sessions.find((item) => item.sessionId === frame.sessionId);
      const stored = record !== undefined && Number.isSafeInteger(record.transcript.lastSequence)
        ? Math.max(0, record.transcript.lastSequence) : 0;
      let retained = 0;
      try {
        retained = deps.transcript?.retainedBytes?.(frame.sessionId) ?? 0;
      } catch (error) {
        deps.onBackgroundError?.(error);
        retained = 0;
      }
      const resume = Number.isSafeInteger(retained) && retained > stored ? retained : stored;
      state = { total: resume, lastHostSequence: -1, lastOffset: resume };
      offsets.set(frame.sessionId, state);
    }
    if (frame.sequence <= state.lastHostSequence) {
      minted.set(frame, state.lastOffset);
      return state.lastOffset;
    }
    const offset = state.total;
    state.total = Math.min(Number.MAX_SAFE_INTEGER, offset + Buffer.byteLength(frame.data, 'base64'));
    state.lastHostSequence = frame.sequence;
    state.lastOffset = offset;
    minted.set(frame, offset);
    return offset;
  };

  /** The frame every sink sees: the host's own frame counter is never forwarded past this point. */
  const inCursorSpace = (frame: SessionDataFrame): SessionDataFrame => {
    const offset = mintOffset(frame);
    return frame.sequence === offset ? frame : { ...frame, sequence: offset };
  };

  const updateTranscript = (frame: SessionDataFrame): Promise<void> => {
    const prior = transcriptQueues.get(frame.sessionId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(async () => {
      if (!SESSION_ID.test(frame.sessionId)) return;
      const before = deps.persistence.read().sessions.find((item) => item.sessionId === frame.sessionId);
      // `lastSequence` is the cumulative byte total, so a frame that STARTS before it was already
      // recorded. A new frame starts exactly at it.
      if (before === undefined || !live(before) || frame.sequence < before.transcript.lastSequence) return;
      const decoded = Buffer.from(frame.data, 'base64');
      const retained = deps.transcript?.append(frame.sessionId, frame.sequence, decoded);
      await deps.persistence.mutate(null, (document) => {
        const record = document.sessions.find((item) => item.sessionId === frame.sessionId);
        if (record === undefined || !live(record) || frame.sequence < record.transcript.lastSequence) return;
        if (record.revision >= Number.MAX_SAFE_INTEGER) return;
        record.transcript = retained ?? {
          ...record.transcript,
          bytes: Math.min(1_073_741_824, record.transcript.bytes + decoded.byteLength),
          lastSequence: frame.sequence + decoded.byteLength,
        };
        record.revision += 1;
      });
    });
    transcriptQueues.set(frame.sessionId, next);
    const cleanup = () => {
      if (transcriptQueues.get(frame.sessionId) === next) transcriptQueues.delete(frame.sessionId);
    };
    void next.then(cleanup, cleanup);
    return next;
  };

  const observeExit = async (exit: ObservedExit, epochId: string): Promise<void> => {
    // The cursor state dies with the session; the record keeps the byte total for the replay reader.
    offsets.delete(exit.sessionId);
    await deps.persistence.mutate(null, (document) => applyObservedSessionExit(document, exit, epochId));
  };

  /**
   * Per-principal capacity lives HERE, not in a host: the 8-per-`{operator, browserSessionRef}`
   * ceiling is platform-independent, and the Linux broker wire carries no principal at all. Both
   * entry points that make a session controlled-live (create, first claim) take a reservation
   * synchronously — no `await` between the count and the take — so no interleaving oversubscribes.
   * Hosts keep their own ceilings as defence in depth.
   */
  const pendingPrincipalReservations = new Map<string, number>();

  const controlledLiveCount = (
    sessions: readonly SessionRecord[], principal: BrowserPrincipal,
  ): number => sessions.filter((record) => live(record) && sessionIsControlledBy(record, principal)).length;

  const principalAtCapacity = (
    sessions: readonly SessionRecord[], principal: BrowserPrincipal,
  ): boolean => controlledLiveCount(sessions, principal)
    + (pendingPrincipalReservations.get(principalCapacityKey(principal)) ?? 0)
    >= MAX_PRINCIPAL_LIVE_SESSIONS;

  /** Synchronous check-and-take against persisted controlled-live rows plus in-flight creates. */
  const reservePrincipal = (principal: BrowserPrincipal): boolean => {
    if (principalAtCapacity(deps.persistence.read().sessions, principal)) return false;
    const key = principalCapacityKey(principal);
    pendingPrincipalReservations.set(key, (pendingPrincipalReservations.get(key) ?? 0) + 1);
    return true;
  };

  /** Released once the row is persisted (where the count then sees it) or the create failed. */
  const releasePrincipal = (principal: BrowserPrincipal): void => {
    const key = principalCapacityKey(principal);
    const remaining = (pendingPrincipalReservations.get(key) ?? 1) - 1;
    if (remaining <= 0) pendingPrincipalReservations.delete(key);
    else pendingPrincipalReservations.set(key, remaining);
  };

  const authorize = (principal: BrowserPrincipal, sessionId: string): SessionRecord | null => {
    const record = deps.persistence.read().sessions.find((item) => item.sessionId === sessionId);
    return record !== undefined && sessionIsControlledBy(record, principal) ? record : null;
  };

  const registry: SessionRecordRegistry = {
    async create(principal, input) {
      if (!validManualInput(input)) return { ok: false, refusal: 'invalid-request', detail: 'manual session request is invalid' };
      // Taken before the probe and before any host call: capacity is the registry's, on every platform.
      if (!reservePrincipal(principal)) return { ok: false, refusal: 'capacity', detail: null };
      let reservationHeld = true;
      const releaseHeldReservation = (): void => {
        if (!reservationHeld) return;
        reservationHeld = false;
        releasePrincipal(principal);
      };
      let launched: { operationKey: string; requestHash: string; sessionId: string; epochId: string } | null = null;
      let recordReady = false;
      let discardFrames = false;
      const pendingFrames: SessionDataFrame[] = [];
      try {
        const probe = await deps.host.probe();
        if (!probe.available || !probe.launchers.includes(input.launcher) || !probe.roots.includes(input.rootId)) {
          return { ok: false, refusal: 'unavailable', detail: null };
        }
        const recipe = deps.resolveManualRecipe?.(input) ?? manualRecipe(input);
        if (recipe === null || recipe.launcher !== input.launcher || recipe.mode !== 'interactive'
          || recipe.resumeRef !== undefined) {
          return { ok: false, refusal: 'invalid-request', detail: 'manual launch recipe is unavailable' };
        }
        const operationKey = makeOperationKey();
        if (!OPERATION_KEY.test(operationKey)) return internal();
        const requestHash = hash({ principal, input });
        const createdAt = now();
        const begun = await deps.persistence.mutate(null, (document) => beginOperationReceipt(document, {
          operationKey,
          requestHash,
          attemptRef: null,
          createdAt,
        }));
        if (!begun.value.ok) return begun.value;

        let receiptEpoch: string | null = null;
        const sink: SessionSink = {
          data: (frame) => {
            if (discardFrames) return;
            // Minting happens HERE, before the frame is queued or persisted: a frame that waits for the
            // record must still hold the offset of the moment it was produced.
            const stamped = inCursorSpace(frame);
            if (recordReady) background(updateTranscript(stamped));
            else pendingFrames.push(structuredClone(stamped));
          },
          exit: (exit) => { if (!discardFrames && receiptEpoch !== null) background(observeExit(exit, receiptEpoch)); },
          closed: () => false,
        };
        // The host owns capacity now that it is told who is asking; the registry keeps only
        // authorization. A `capacity` refusal comes back on the receipt below and is surfaced.
        const launch = deps.host.create({
          operationKey,
          principal: hostRequestPrincipal({ provenance: 'manual', controller: principal }),
          recipe,
          rootId: input.rootId,
          relativeCwd: input.relativeCwd,
          cols: input.cols,
          rows: input.rows,
        }, sink);
        const receipt = await launch.receipt;
        if (!receipt.ok) {
          await deps.persistence.mutate(null, (document) => settleOperationReceipt(document, {
            operationKey,
            requestHash,
            status: 'failed',
            sessionId: null,
            refusal: receipt.refusal,
            settledAt: now(),
          }));
          return receipt;
        }
        receiptEpoch = receipt.value.epochId;
        launched = { operationKey, requestHash, sessionId: receipt.value.sessionId, epochId: receipt.value.epochId };
        const existing = deps.persistence.read().sessions.find((record) => record.operationKey === operationKey);
        if (receipt.value.replayed && existing !== undefined) {
          recordReady = true;
          launched = null;
          for (const frame of pendingFrames.splice(0)) background(updateTranscript(frame));
          background(launch.exit.then((exit) => observeExit(exit, receipt.value.epochId)));
          return { ok: true, value: summarizeSessionRecord(existing) };
        }
        const record: SessionRecord = {
          sessionId: receipt.value.sessionId,
          operationKey,
          requestHash,
          recipeDigest: hash(recipe),
          launcher: input.launcher,
          host: probe.host,
          rootId: input.rootId,
          relativeCwd: input.relativeCwd,
          name: input.launcher === 'shell' ? 'Shell' : input.launcher === 'claude' ? 'Claude' : 'Codex',
          attachmentIds: [],
          transcript: { path: `pty/transcripts/${receipt.value.sessionId}.raw`, bytes: 0,
            truncated: false, lastSequence: 0 },
          startedAt: receipt.value.boundAt,
          endedAt: null,
          revision: receipt.value.revision,
          provenance: 'manual',
          controller: { ...principal },
          state: 'live',
          epochId: receipt.value.epochId,
          exit: null,
        };
        await deps.persistence.mutate(null, (document) => {
          if (document.sessions.some((item) => item.sessionId === record.sessionId
            || item.operationKey === operationKey)) throw new Error('host receipt collides with a persisted session');
          insertSessionRecord(document, record);
          const settled = settleOperationReceipt(document, {
            operationKey,
            requestHash,
            status: 'bound',
            sessionId: record.sessionId,
            refusal: null,
            settledAt: receipt.value.boundAt,
          });
          if (!settled.ok) throw new Error(settled.detail ?? 'operation receipt settlement failed');
        });
        recordReady = true;
        launched = null;
        for (const frame of pendingFrames.splice(0)) background(updateTranscript(frame));
        background(launch.exit.then((exit) => observeExit(exit, receipt.value.epochId)));
        return { ok: true, value: summarizeSessionRecord(record) };
      } catch (error) {
        deps.onBackgroundError?.(error);
        if (launched !== null && !recordReady) {
          discardFrames = true;
          pendingFrames.splice(0);
          try {
            // A refused compensating close leaves a live child nobody names: escalate, never
            // swallow it. This is the original blocker's scenario one branch narrower.
            const compensated = await deps.host.close(launched.sessionId);
            if (!compensated.ok) {
              deps.onBackgroundError?.(new Error(
                `compensating close refused (${compensated.refusal}) for ${launched.sessionId}`));
            }
          } catch (closeError) {
            deps.onBackgroundError?.(closeError);
          }
          try {
            const failedAt = now();
            await deps.persistence.mutate(null, (document) => {
              const settled = settleOperationReceipt(document, {
                operationKey: launched!.operationKey,
                requestHash: launched!.requestHash,
                status: 'failed',
                sessionId: null,
                refusal: 'internal',
                settledAt: failedAt,
              });
              if (!settled.ok) throw new Error('operation receipt compensation failed');
            });
          } catch (settlementError) {
            deps.onBackgroundError?.(settlementError);
          }
        }
        return internal();
      } finally {
        releaseHeldReservation();
      }
    },

    async attach(principal, sessionId, sink) {
      try {
        const record = authorize(principal, sessionId);
        if (record === null || !live(record)) return { ok: false, refusal: 'not-found', detail: 'session not found' };
        if (record.attachmentIds.length >= MAX_SESSION_ATTACHMENTS) {
          return { ok: false, refusal: 'capacity', detail: null };
        }
        let detached = false;
        const guardedSink: SessionSink = {
          data: (frame) => { if (!detached) sink.data(inCursorSpace(frame)); },
          exit: (exit) => { if (!detached) sink.exit(exit); },
          closed: () => detached || sink.closed(),
        };
        const attached = await deps.host.attach(sessionId, guardedSink);
        if (!attached.ok) return attached;
        if (!ATTACHMENT_ID.test(attached.value.attachmentId)) {
          detached = true;
          return { ok: false, refusal: 'internal', detail: 'host attachment id is invalid' };
        }
        const attachmentId = attached.value.attachmentId;
        await deps.persistence.mutate(null, (document) => {
          const current = document.sessions.find((item) => item.sessionId === sessionId);
          if (current === undefined || !sessionIsControlledBy(current, principal) || !live(current)
            || current.attachmentIds.length >= MAX_SESSION_ATTACHMENTS
            || current.attachmentIds.includes(attachmentId)) throw new Error('attachment authorization changed');
          current.attachmentIds.push(attachmentId);
          current.revision += 1;
        });
        let closureUsed = false;
        const detach = async (): Promise<void> => {
          if (closureUsed) return;
          closureUsed = true;
          detached = true;
          await deps.persistence.mutate(null, (document) => {
            const current = document.sessions.find((item) => item.sessionId === sessionId);
            if (current === undefined) return;
            const index = current.attachmentIds.indexOf(attachmentId);
            if (index < 0) return;
            current.attachmentIds.splice(index, 1);
            if (current.revision < Number.MAX_SAFE_INTEGER) current.revision += 1;
          });
        };
        const refreshed = deps.persistence.read().sessions.find((item) => item.sessionId === sessionId) as SessionRecord;
        return { ok: true, value: { attachmentId, session: summarizeSessionRecord(refreshed), detach } };
      } catch (error) {
        return reportInternal(error);
      }
    },

    async list(principal) {
      try {
        return deps.persistence.read().sessions.filter((record) => sessionIsControlledBy(record, principal))
          .map(summarizeSessionRecord);
      } catch (error) {
        deps.onBackgroundError?.(error);
        return [];
      }
    },

    async write(principal, sessionId, data) {
      try {
        const record = authorize(principal, sessionId);
        if (record === null || !live(record)) return { ok: false, refusal: 'not-found', detail: 'session not found' };
        const accepted = await deps.host.write(sessionId, data);
        if (!accepted.ok) return accepted;
        await deps.persistence.mutate(null, (document) => {
          const current = document.sessions.find((item) => item.sessionId === sessionId);
          if (current === undefined || !sessionIsControlledBy(current, principal) || !live(current)) {
            throw new Error('session authorization changed');
          }
          current.revision += 1;
        });
        return accepted;
      } catch (error) { return reportInternal(error); }
    },

    async resize(principal, sessionId, size) {
      try {
        const record = authorize(principal, sessionId);
        if (record === null || !live(record)) return { ok: false, refusal: 'not-found', detail: 'session not found' };
        const resized = await deps.host.resize(sessionId, size);
        if (!resized.ok) return resized;
        await deps.persistence.mutate(null, (document) => {
          const current = document.sessions.find((item) => item.sessionId === sessionId);
          if (current === undefined || !sessionIsControlledBy(current, principal) || !live(current)) {
            throw new Error('session authorization changed');
          }
          current.revision += 1;
        });
        const current = deps.persistence.read().sessions.find((item) => item.sessionId === sessionId) as SessionRecord;
        return { ok: true, value: summarizeSessionRecord(current) };
      } catch (error) { return reportInternal(error); }
    },

    async close(principal, sessionId) {
      try {
        const record = authorize(principal, sessionId);
        if (record === null || !live(record)) return { ok: false, refusal: 'not-found', detail: 'session not found' };
        const closed = await deps.host.close(sessionId);
        if (!closed.ok) return closed;
        await observeExit(closed.value, record.epochId);
        return closed;
      } catch (error) { return reportInternal(error); }
    },

    async claimRunController(principal, input) {
      try {
        const resolveRunVersion = deps.resolveRunVersion;
        const authorizedRunVersion = await resolveRunVersion?.(principal.operator, input.runRef) ?? null;
        if (authorizedRunVersion === null) return { ok: false, refusal: 'not-found', detail: 'session not found' };
        const result = await deps.persistence.mutate(null, async (document) => {
          const runVersion = await resolveRunVersion?.(principal.operator, input.runRef) ?? null;
          if (runVersion === null || runVersion !== authorizedRunVersion) {
            return refusal('binding-conflict', 'controller claim revision conflict');
          }
          const record = document.sessions.find((item) => item.sessionId === input.sessionId);
          if (record === undefined) return { ok: false, refusal: 'not-found', detail: 'session not found' } as PortResult<ClaimReceipt>;
          // A first claim makes the session controlled-live for this principal, so it spends a slot
          // of the same 8-cap create spends. An idempotent replay (already this controller) does not.
          if (record.controller === null && principalAtCapacity(document.sessions, principal)) {
            return { ok: false, refusal: 'capacity', detail: null } as PortResult<ClaimReceipt>;
          }
          return claimRunController(record, principal, input, runVersion);
        });
        return result.value;
      } catch (error) { return reportInternal(error); }
    },

    async bind(input) {
      try {
        const result = await deps.persistence.mutate(input.expectedRevision, (document) => {
          const record = document.sessions.find((item) => item.sessionId === input.sessionId);
          if (record === undefined || record.provenance !== 'run' || record.operator !== input.operator
            || record.runRef !== input.runRef || record.attemptRef !== input.attemptRef
            || record.managedSessionRef !== input.managedSessionRef) {
            return { ok: false, refusal: 'not-found', detail: 'session not found' } as PortResult<{ revision: number }>;
          }
          const duplicate = document.attemptBindings.find((binding) => binding.attemptRef === input.attemptRef
            || binding.managedSessionRef === input.managedSessionRef || binding.sessionId === input.sessionId);
          if (duplicate !== undefined) {
            const replayed = duplicate.operator === input.operator && duplicate.runRef === input.runRef
              && duplicate.attemptRef === input.attemptRef && duplicate.managedSessionRef === input.managedSessionRef
              && duplicate.sessionId === input.sessionId;
            return replayed
              ? { ok: true, value: { revision: document.revision } } as PortResult<{ revision: number }>
              : { ok: false, refusal: 'binding-conflict', detail: 'attempt binding conflict' } as PortResult<{ revision: number }>;
          }
          document.attemptBindings.push({
            operator: input.operator,
            runRef: input.runRef,
            attemptRef: input.attemptRef,
            managedSessionRef: input.managedSessionRef,
            sessionId: input.sessionId,
            createdAt: now(),
          });
          return { ok: true, value: { revision: document.revision + 1 } } as PortResult<{ revision: number }>;
        });
        return result.value;
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        return code === 'revision-conflict'
          ? { ok: false, refusal: 'binding-conflict', detail: 'attempt binding revision conflict' }
          : reportInternal(error);
      }
    },

    byAttempt(operator, attemptRef) {
      try {
        return structuredClone(deps.persistence.read().attemptBindings.find((binding) =>
          binding.operator === operator && binding.attemptRef === attemptRef) ?? null);
      } catch (error) {
        deps.onBackgroundError?.(error);
        return null;
      }
    },

    bySession(operator, sessionId) {
      try {
        return structuredClone(deps.persistence.read().attemptBindings.find((binding) =>
          binding.operator === operator && binding.sessionId === sessionId) ?? null);
      } catch (error) {
        deps.onBackgroundError?.(error);
        return null;
      }
    },

    byRun(operator, runRef) {
      // Durable order IS attempt order: bindings are appended at bind time and never reordered, so a
      // single document read reconstructs Run selection after a restart with no in-memory index.
      try {
        return structuredClone(deps.persistence.read().attemptBindings.filter((binding) =>
          binding.operator === operator && binding.runRef === runRef));
      } catch (error) {
        deps.onBackgroundError?.(error);
        return [];
      }
    },

    async readOperation(operationKey) {
      try {
        if (!OPERATION_KEY.test(operationKey)) return null;
        const stored = deps.persistence.read().attemptOperations[operationKey];
        return stored === undefined ? null : structuredClone(stored);
      } catch (error) {
        deps.onBackgroundError?.(error);
        return null;
      }
    },

    /**
     * Durable write-ahead CAS for one attempt operation. `expectedRevision: null` means "must not
     * exist"; any mismatch (or a create over an existing key) refuses with `binding-conflict`.
     * The compare and the write share the one `mutate` critical section every other write uses,
     * so two concurrent writers cannot both observe the same base revision.
     */
    async writeOperation(record, expectedRevision) {
      try {
        if (!OPERATION_KEY.test(record.operationKey)) {
          return { ok: false, refusal: 'invalid-request', detail: 'attempt operation key is invalid' };
        }
        if (expectedRevision !== null && !Number.isSafeInteger(expectedRevision)) {
          return { ok: false, refusal: 'invalid-request', detail: 'attempt operation revision is invalid' };
        }
        const conflict: PortResult<AttemptOperationRecord> = {
          ok: false, refusal: 'binding-conflict', detail: 'attempt operation revision conflict',
        };
        const result = await deps.persistence.mutate(null, (document) => {
          const stored = document.attemptOperations[record.operationKey];
          if (expectedRevision === null) {
            if (stored !== undefined) return conflict;
          } else if (stored === undefined || stored.revision !== expectedRevision) {
            return conflict;
          }
          const next: AttemptOperationRecord = {
            ...structuredClone(record),
            revision: (stored?.revision ?? 0) + 1,
            updatedAt: now(),
          };
          document.attemptOperations[record.operationKey] = next;
          return { ok: true, value: structuredClone(next) } as PortResult<AttemptOperationRecord>;
        });
        return result.value;
      } catch (error) { return reportInternal(error); }
    },

    async persistRunSession(input) {
      try {
        if (input.record.provenance !== 'run' || input.record.controller !== null
          || input.record.sessionId !== input.binding.sessionId
          || input.record.operator !== input.binding.operator || input.record.runRef !== input.binding.runRef
          || input.record.attemptRef !== input.binding.attemptRef
          || input.record.managedSessionRef !== input.binding.managedSessionRef
          || input.receipt.operationKey !== input.record.operationKey
          || input.receipt.requestHash !== input.record.requestHash) {
          return { ok: false, refusal: 'invalid-request', detail: 'run session record set is inconsistent' };
        }
        const result = await deps.persistence.mutate(null, (document) => {
          const collisions = document.sessions.some((item) => item.sessionId === input.record.sessionId
            || item.operationKey === input.record.operationKey)
            || document.attemptBindings.some((item) => item.sessionId === input.binding.sessionId
              || item.attemptRef === input.binding.attemptRef || item.managedSessionRef === input.binding.managedSessionRef)
            || document.operationReceipts.some((item) => item.operationKey === input.receipt.operationKey);
          if (collisions) return ({
            ok: false,
            refusal: 'binding-conflict',
            detail: 'run session binding conflict',
          } as PortResult<{ revision: number }>);
          insertSessionRecord(document, structuredClone(input.record));
          document.attemptBindings.push(structuredClone(input.binding));
          document.operationReceipts.push(structuredClone(input.receipt));
          return { ok: true, value: { revision: document.revision + 1 } } as PortResult<{ revision: number }>;
        });
        return result.value;
      } catch (error) { return reportInternal(error); }
    },

    async abandonEpoch(epochId, reason) {
      try {
        const result = await deps.persistence.mutate(null, (document) => applyEpochAbandonment(document, epochId, reason, now()));
        return { ok: true, value: { abandoned: result.value, revision: result.revision } };
      } catch (error) { return reportInternal(error); }
    },
  };

  const deploymentCloser: DeploymentSessionCloser = async (sessionIds) => {
    const ids = [...sessionIds];
    if (ids.length === 0 || new Set(ids).size !== ids.length || ids.some((id) => !SESSION_ID.test(id))) {
      return { ok: false, refusal: 'invalid-request', detail: 'deployment session ids are invalid' };
    }
    const document = deps.persistence.read();
    const records = ids.map((id) => document.sessions.find((record) => record.sessionId === id));
    if (records.some((record) => record === undefined || !live(record))) {
      return { ok: false, refusal: 'not-found', detail: 'session not found' };
    }
    const closed: string[] = [];
    for (const record of records as SessionRecord[]) {
      const result = await deps.host.close(record.sessionId);
      if (!result.ok) return result;
      await observeExit(result.value, record.epochId);
      closed.push(record.sessionId);
    }
    return { ok: true, value: { closed } };
  };
  deps.installDeploymentCloser?.(deploymentCloser);
  return registry;
}
