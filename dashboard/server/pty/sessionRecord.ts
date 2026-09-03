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
  SessionHostKind,
  SessionRecord,
  SessionRegistryPort,
  SessionSink,
  SessionSummary,
  StartRunSessionInput,
  StartRunSessionReceipt,
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
  sessionTranscriptPath,
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

export interface SessionRecordRegistry extends SessionRegistryPort, AttemptBindingPort {
  startRunSession(input: StartRunSessionInput): Promise<PortResult<StartRunSessionReceipt>>;
  activateEpoch(epochId: string): Promise<PortResult<{ abandoned: number; revision: number }>>;
  abandonEpoch(epochId: string, reason: 'epoch-lost' | 'daemon-restart' | 'start-recovery'):
    Promise<PortResult<{ abandoned: number; revision: number }>>;
}

export interface SessionRecordRegistryDeps {
  host: SessionHost;
  hostKind?: SessionHostKind;
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
  log?: (message: string) => void;
}

const ACTIVE_SESSION_STATES = new Set(['starting', 'live', 'closing']);
const SESSION_ID = /^pty-[0-9a-f]{32}$/;
const ATTACHMENT_ID = /^att-[0-9a-f]{32}$/;
const OPERATION_KEY = /^op-[0-9a-f]{64}$/;
const EARLY_FRAME_LIMIT = 64;
const EARLY_FRAME_BYTE_LIMIT = 1_048_576;
const UNSAFE_DISPLAY_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u2028\u2029]/gu;

function boundedDisplayName(value: string, fallback: string, maxBytes = 80): string {
  const safe = value.replace(UNSAFE_DISPLAY_TEXT_RE, ' ').replace(/\s+/gu, ' ').trim() || fallback;
  let result = '';
  let bytes = 0;
  for (const character of safe) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function internal<T>(): PortResult<T> {
  return { ok: false, refusal: 'internal', detail: 'session operation failed' };
}

/**
 * The recipe a manual shell create launches under. `toolPolicyId` is `shell-default` because that is the
 * ONLY value `brokerProtocol.ts`'s shell branch decodes — every wire vector, the broker's own tests and
 * `fdPinnedPaths.ts`'s probe recipe already agree on it, and this function was the one place that did not.
 *
 * It said `interactive` and nothing caught it: Windows never reads the id for a shell (`launcherProfiles.ts`
 * checks only its charset), and the Linux broker was unreachable because the capability probe was a stub, so
 * the only path that would refuse it was dead. It is not dead any more. A mismatch here does not fail one
 * session — `decodeBrokerClientFrame` throws inside `BrokerFrameDecoder.push`, which the broker answers by
 * destroying the connection, and `LinuxBrokerClient.handleDisconnect` then latches `unavailable` for the life
 * of the host object. The first shell an operator opened would have taken the daemon's PTY host with it.
 */
function manualRecipe(input: ApprovedManualCreate): LaunchRecipe | null {
  if (input.launcher !== 'shell') return null;
  return { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' };
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
  const hostKind = deps.hostKind ?? (process.platform === 'win32' ? 'desktop' : 'vm');
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
   * Each host sink gets one converter, so replay starts at zero while a sink that joins live resumes
   * from the durable transcript total. Fresh objects delivered to multiple sinks cannot double-count.
   */
  const createCursorSpace = (): {
    data(frame: SessionDataFrame): SessionDataFrame;
    exit(exit: ObservedExit): ObservedExit;
    resume(sessionId: string): void;
  } => {
    let sessionId: string | null = null;
    let nextOffset = 0;
    let lastHostSequence = -1;
    let lastOffset = 0;
    let sawData = false;
    const storedOffset = (targetSessionId: string): number => {
      const record = deps.persistence.read().sessions.find((item) => item.sessionId === targetSessionId);
      const stored = record !== undefined && Number.isSafeInteger(record.transcript.lastSequence)
        ? Math.max(0, record.transcript.lastSequence) : 0;
      let retained = 0;
      try {
        retained = deps.transcript?.retainedBytes?.(targetSessionId) ?? 0;
      } catch (error) {
        deps.onBackgroundError?.(error);
      }
      return Number.isSafeInteger(retained) && retained > stored ? retained : stored;
    };
    const resume = (targetSessionId: string): void => {
      if (sessionId === targetSessionId) return;
      sessionId = targetSessionId;
      nextOffset = storedOffset(targetSessionId);
      lastHostSequence = -1;
      lastOffset = 0;
      sawData = false;
    };
    const initialize = (frame: SessionDataFrame): void => {
      resume(frame.sessionId);
      if (frame.replay) {
        if (!sawData) nextOffset = 0;
      }
    };
    return {
      data(frame) {
        initialize(frame);
        if (frame.sequence <= lastHostSequence) {
          return frame.sequence === lastOffset ? frame : { ...frame, sequence: lastOffset };
        }
        const offset = nextOffset;
        nextOffset = Math.min(Number.MAX_SAFE_INTEGER,
          nextOffset + Buffer.byteLength(frame.data, 'base64'));
        lastHostSequence = frame.sequence;
        lastOffset = offset;
        sawData = true;
        return frame.sequence === offset ? frame : { ...frame, sequence: offset };
      },
      exit(observed) {
        resume(observed.sessionId);
        return observed.sequence === nextOffset ? observed : { ...observed, sequence: nextOffset };
      },
      resume,
    };
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
    await deps.persistence.mutate(null, (document) => applyObservedSessionExit(document, exit, epochId));
  };

  const observeHostExit = async (exit: ObservedExit, epochId: string): Promise<void> => {
    if (exit.reason !== 'abandoned') {
      await observeExit(exit, epochId);
      return;
    }
    await deps.persistence.mutate(null, (document) =>
      applyEpochAbandonment(document, epochId, 'epoch-lost', exit.observedAt));
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
      let pendingFrameBytes = 0;
      let pendingFrameDrops = 0;
      let pendingExit: ObservedExit | null = null;
      const cursorSpace = createCursorSpace();
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
            const stamped = cursorSpace.data(frame);
            if (recordReady) background(updateTranscript(stamped));
            else {
              const bytes = Buffer.byteLength(stamped.data, 'base64');
              if (pendingFrames.length < EARLY_FRAME_LIMIT
                && pendingFrameBytes + bytes <= EARLY_FRAME_BYTE_LIMIT) {
                pendingFrames.push(structuredClone(stamped));
                pendingFrameBytes += bytes;
              } else {
                pendingFrameDrops += 1;
              }
            }
          },
          exit: (exit) => {
            if (discardFrames) return;
            const stamped = cursorSpace.exit(exit);
            if (receiptEpoch === null) pendingExit = structuredClone(stamped);
            else background(observeHostExit(stamped, receiptEpoch));
          },
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
        const activated = await registry.activateEpoch(receipt.value.epochId);
        if (!activated.ok) throw new Error(activated.detail ?? activated.refusal);
        const matching = deps.persistence.read().sessions.filter((record) => record.operationKey === operationKey);
        // Operation keys are unique only while non-terminal. Prefer that row; after it terminates, the
        // newest historical row is the host replay identity, never the oldest retired incarnation.
        const existing = matching.find((record) => live(record)) ?? matching.at(-1);
        if (receipt.value.replayed && existing !== undefined) {
          recordReady = true;
          launched = null;
          for (const frame of pendingFrames.splice(0)) background(updateTranscript(frame));
          if (pendingExit !== null) background(observeHostExit(pendingExit, receipt.value.epochId));
          if (pendingFrameDrops > 0) {
            deps.log?.(`host=${operationKey} early-output-frames-dropped=${pendingFrameDrops}`);
          }
          background(launch.exit.then((exit) => observeHostExit(cursorSpace.exit(exit), receipt.value.epochId)));
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
          transcript: { path: sessionTranscriptPath(receipt.value.sessionId), bytes: 0,
            truncated: false, lastSequence: 0 },
          startedAt: receipt.value.boundAt,
          endedAt: null,
          revision: 1,
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
        if (pendingExit !== null) background(observeHostExit(pendingExit, receipt.value.epochId));
        if (pendingFrameDrops > 0) {
          deps.log?.(`host=${operationKey} early-output-frames-dropped=${pendingFrameDrops}`);
        }
        background(launch.exit.then((exit) => observeHostExit(cursorSpace.exit(exit), receipt.value.epochId)));
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
        const cursorSpace = createCursorSpace();
        cursorSpace.resume(sessionId);
        const guardedSink: SessionSink = {
          data: (frame) => { if (!detached) sink.data(cursorSpace.data(frame)); },
          exit: (exit) => { if (!detached) sink.exit(cursorSpace.exit(exit)); },
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
        let closed: Awaited<ReturnType<SessionHost['close']>>;
        try {
          closed = await deps.host.close(sessionId);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          deps.onBackgroundError?.(error);
          await observeHostExit({
            sessionId,
            sequence: record.transcript.lastSequence,
            exitCode: null,
            signal: null,
            reason: 'closed',
            observedAt: now(),
          }, record.epochId);
          return { ok: false, refusal: 'internal', detail };
        }
        if (!closed.ok) {
          deps.onBackgroundError?.(new Error(
            `session close refused (${closed.refusal}) for ${sessionId}: ${closed.detail ?? ''}`));
          await observeHostExit({
            sessionId,
            sequence: record.transcript.lastSequence,
            exitCode: null,
            signal: null,
            reason: 'closed',
            observedAt: now(),
          }, record.epochId);
          return closed;
        }
        await observeHostExit({ ...closed.value, sequence: record.transcript.lastSequence }, record.epochId);
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

    byAttempt(operator, attemptRef) {
      try {
        const matches = deps.persistence.read().attemptBindings.filter((binding) =>
          binding.operator === operator && binding.attemptRef === attemptRef);
        return structuredClone(matches.find((binding) => binding.retired !== true) ?? matches.at(-1) ?? null);
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
      // Durable order IS attempt order: bindings are appended at atomic start time and never reordered, so a
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
          if (record.sessionId !== null
            && !document.sessions.some((session) => session.sessionId === record.sessionId)) {
            return {
              ok: false,
              refusal: 'internal',
              detail: `attempt operation references missing session record '${record.sessionId}'`,
            } as PortResult<AttemptOperationRecord>;
          }
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

    async startRunSession(input) {
      if (!OPERATION_KEY.test(input.hostOperationKey) || !/^[0-9a-f]{64}$/u.test(input.requestHash)
        || input.rootId !== 'worktrees' || !Number.isSafeInteger(input.size.cols)
        || !Number.isSafeInteger(input.size.rows)) {
        return { ok: false, refusal: 'invalid-request', detail: 'run session start is invalid' };
      }

      type StartRefusal = { ok: false; refusal: import('../../shared/ptyProtocol.ts').HostRefusalCode;
        detail: string | null };
      const operationRefusal = (operation: AttemptOperationRecord | undefined): StartRefusal | null => {
        if (operation === undefined) {
          return { ok: false, refusal: 'internal', detail: 'run session start has no write-ahead operation' };
        }
        if (operation.requestHash !== input.requestHash || operation.attemptRef !== input.attemptRef) {
          return { ok: false, refusal: 'binding-conflict', detail: 'attempt operation identity conflict' };
        }
        if (operation.status === 'cancelled') {
          return { ok: false, refusal: 'cancelled', detail: 'attempt operation was durably cancelled' };
        }
        if (operation.status === 'failed' || operation.status === 'completed') {
          return {
            ok: false,
            refusal: operation.status === 'failed' ? (operation.receipt?.refusal ?? 'internal') : 'binding-conflict',
            detail: `attempt operation already ${operation.status}`,
          };
        }
        return null;
      };

      try {
        const before = deps.persistence.read();
        const refused = operationRefusal(before.attemptOperations[input.hostOperationKey]);
        if (refused !== null) return refused;
      } catch (error) {
        return reportInternal(error);
      }

      let resolveExit!: (exit: ObservedExit) => void;
      const exit = new Promise<ObservedExit>((resolve) => { resolveExit = resolve; });
      let launchedSessionId: string | null = null;
      let receiptEpochId: string | null = null;
      let recordReady = false;
      let flushing = false;
      let discardFrames = false;
      let earlyFrameBytes = 0;
      let earlyFrameDrops = 0;
      const earlyFrames: SessionDataFrame[] = [];
      let terminalObserved: ObservedExit | null = null;
      let terminalWork: Promise<void> | null = null;
      let launchExitRejected = false;
      const cursorSpace = createCursorSpace();

      const persistTerminal = (): Promise<void> => {
        if (!recordReady || receiptEpochId === null || terminalObserved === null) return Promise.resolve();
        if (terminalWork !== null) return terminalWork;
        const observed = structuredClone(terminalObserved);
        terminalWork = (async () => {
          try {
            const queued = transcriptQueues.get(observed.sessionId);
            if (queued !== undefined) await queued.catch(() => undefined);
            await observeHostExit(observed, receiptEpochId!);
          } catch (error) {
            deps.onBackgroundError?.(error);
          }
          try { input.sink.exit(structuredClone(observed)); } catch (error) { deps.onBackgroundError?.(error); }
          resolveExit(observed);
        })();
        return terminalWork;
      };

      const observeTerminal = (observed: ObservedExit): Promise<void> => {
        if (terminalObserved === null) terminalObserved = structuredClone(observed);
        return persistTerminal();
      };

      const sink: SessionSink = {
        data(frame) {
          if (discardFrames) return;
          const stamped = cursorSpace.data(frame);
          const bytes = Buffer.byteLength(stamped.data, 'base64');
          if (recordReady && !flushing) {
            background(updateTranscript(stamped));
          } else if (earlyFrames.length < EARLY_FRAME_LIMIT
            && earlyFrameBytes + bytes <= EARLY_FRAME_BYTE_LIMIT) {
            earlyFrames.push(structuredClone(stamped));
            earlyFrameBytes += bytes;
          } else {
            earlyFrameDrops += 1;
          }
          try { input.sink.data(stamped); } catch (error) { deps.onBackgroundError?.(error); }
        },
        exit(observed) { void observeTerminal(cursorSpace.exit(observed)); },
        closed() {
          if (terminalObserved !== null) return true;
          try { return input.sink.closed(); } catch (error) { deps.onBackgroundError?.(error); return false; }
        },
      };

      const failPendingOperation = async (code: import('../../shared/ptyProtocol.ts').HostRefusalCode): Promise<void> => {
        try {
          await deps.persistence.mutate(null, (document) => {
            const operation = document.attemptOperations[input.hostOperationKey];
            if (operation === undefined || operation.requestHash !== input.requestHash
              || operation.attemptRef !== input.attemptRef || operation.status !== 'pending'
              || operation.revision >= Number.MAX_SAFE_INTEGER) return;
            const settledAt = now();
            operation.status = code === 'cancelled' ? 'cancelled' : 'failed';
            operation.receipt = {
              operationKey: input.hostOperationKey,
              requestHash: input.requestHash,
              status: code === 'cancelled' ? 'cancelled' : 'failed',
              sessionId: operation.sessionId,
              attemptRef: input.attemptRef,
              refusal: code,
              createdAt: operation.receipt?.createdAt ?? settledAt,
              settledAt,
            };
            operation.revision += 1;
            operation.updatedAt = settledAt;
          });
        } catch (error) {
          deps.onBackgroundError?.(error);
        }
      };

      let launch: ReturnType<SessionHost['create']>;
      try {
        launch = deps.host.create({
          operationKey: input.hostOperationKey,
          principal: hostRequestPrincipal({ provenance: 'run', operator: input.operator, controller: null }),
          recipe: input.recipe,
          rootId: input.rootId,
          relativeCwd: input.relativeCwd,
          cols: input.size.cols,
          rows: input.size.rows,
        }, sink);
      } catch (error) {
        deps.onBackgroundError?.(error);
        await failPendingOperation('internal');
        return internal();
      }
      void launch.exit.then(
        (observed) => { void observeTerminal(cursorSpace.exit(observed)); },
        () => {
          launchExitRejected = true;
          if (launchedSessionId !== null) {
            void observeTerminal(cursorSpace.exit({
              sessionId: launchedSessionId,
              sequence: 0,
              exitCode: null,
              signal: null,
              reason: 'abandoned',
              observedAt: now(),
            }));
          }
        },
      );

      let hostReceipt: Awaited<typeof launch.receipt>;
      try {
        hostReceipt = await launch.receipt;
      } catch (error) {
        deps.onBackgroundError?.(error);
        await failPendingOperation('internal');
        return internal();
      }
      if (!hostReceipt.ok) {
        discardFrames = true;
        earlyFrames.splice(0);
        await failPendingOperation(hostReceipt.refusal);
        return hostReceipt;
      }
      launchedSessionId = hostReceipt.value.sessionId;
      receiptEpochId = hostReceipt.value.epochId;
      if (launchExitRejected && terminalObserved === null) {
        terminalObserved = cursorSpace.exit({
          sessionId: launchedSessionId,
          sequence: 0,
          exitCode: null,
          signal: null,
          reason: 'abandoned',
          observedAt: now(),
        });
      }
      const receipt: OperationReceipt = {
        operationKey: input.hostOperationKey,
        requestHash: input.requestHash,
        status: 'bound',
        sessionId: launchedSessionId,
        attemptRef: input.attemptRef,
        refusal: null,
        createdAt: hostReceipt.value.boundAt,
        settledAt: hostReceipt.value.boundAt,
      };
      const binding: AttemptBinding = {
        operator: input.operator,
        runRef: input.runRef,
        attemptRef: input.attemptRef,
        managedSessionRef: input.managedSessionRef,
        sessionId: launchedSessionId,
        createdAt: hostReceipt.value.boundAt,
      };
      const record: SessionRecord = {
        sessionId: launchedSessionId,
        operationKey: input.hostOperationKey,
        requestHash: input.requestHash,
        recipeDigest: hash(input.recipe),
        launcher: input.recipe.launcher,
        host: hostKind,
        rootId: input.rootId,
        relativeCwd: input.relativeCwd,
        name: boundedDisplayName(input.displayName, input.recipe.launcher),
        attachmentIds: [],
        transcript: {
          path: sessionTranscriptPath(launchedSessionId),
          bytes: 0,
          truncated: false,
          lastSequence: 0,
        },
        startedAt: hostReceipt.value.boundAt,
        endedAt: null,
        revision: 1,
        provenance: 'run',
        controller: null,
        operator: input.operator,
        runRef: input.runRef,
        attemptRef: input.attemptRef,
        managedSessionRef: input.managedSessionRef,
        state: 'live',
        epochId: receiptEpochId,
        exit: null,
      };

      const identityReplay = (document: ReturnType<SessionPersistence['read']>): SessionRecord | null => {
        const storedRecord = document.sessions.find((item) => item.sessionId === record.sessionId);
        const storedBinding = document.attemptBindings.find((item) => item.sessionId === binding.sessionId);
        const storedReceipt = document.operationReceipts.find((item) => item.operationKey === receipt.operationKey);
        const operation = document.attemptOperations[input.hostOperationKey];
        return storedRecord !== undefined && storedBinding !== undefined && storedReceipt !== undefined
          && storedRecord.operationKey === record.operationKey && storedRecord.requestHash === record.requestHash
          && storedRecord.provenance === 'run' && storedRecord.operator === record.operator
          && storedRecord.runRef === record.runRef && storedRecord.attemptRef === record.attemptRef
          && storedRecord.managedSessionRef === record.managedSessionRef
          && storedBinding.retired !== true && storedBinding.operator === binding.operator
          && storedBinding.runRef === binding.runRef && storedBinding.attemptRef === binding.attemptRef
          && storedBinding.managedSessionRef === binding.managedSessionRef
          && storedReceipt.requestHash === receipt.requestHash && storedReceipt.sessionId === receipt.sessionId
          && storedReceipt.attemptRef === receipt.attemptRef && operation !== undefined
          && operation.requestHash === input.requestHash && operation.attemptRef === input.attemptRef
          && operation.status === 'bound' && operation.sessionId === record.sessionId
          ? storedRecord : null;
      };

      const finishStart = async (
        storedRecord: SessionRecord,
        documentRevision: number,
        replayed: boolean,
      ): Promise<PortResult<StartRunSessionReceipt>> => {
        recordReady = true;
        flushing = true;
        while (earlyFrames.length > 0) {
          const frame = earlyFrames.shift();
          if (frame !== undefined) await updateTranscript(frame);
        }
        flushing = false;
        if (earlyFrameDrops > 0) {
          deps.log?.(`host=${input.hostOperationKey} early-output-frames-dropped=${earlyFrameDrops}`);
        }
        await persistTerminal();
        const current = deps.persistence.read().sessions.find((item) => item.sessionId === storedRecord.sessionId)
          ?? storedRecord;
        let closePromise: Promise<PortResult<ObservedExit>> | null = null;
        const close = (): Promise<PortResult<ObservedExit>> => {
          if (closePromise !== null) return closePromise;
          closePromise = (async () => {
            try {
              const closed = await deps.host.close(storedRecord.sessionId);
              if (closed.ok) await observeTerminal(cursorSpace.exit(closed.value));
              else {
                deps.onBackgroundError?.(new Error(
                  `session close refused (${closed.refusal}) for ${storedRecord.sessionId}: ${closed.detail ?? ''}`));
                await observeTerminal(cursorSpace.exit({
                  sessionId: storedRecord.sessionId,
                  sequence: current.transcript.lastSequence,
                  exitCode: null,
                  signal: null,
                  reason: 'closed',
                  observedAt: now(),
                }));
              }
              return closed;
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error);
              deps.onBackgroundError?.(error);
              await observeTerminal(cursorSpace.exit({
                sessionId: storedRecord.sessionId,
                sequence: current.transcript.lastSequence,
                exitCode: null,
                signal: null,
                reason: 'closed',
                observedAt: now(),
              }));
              return { ok: false, refusal: 'internal', detail };
            }
          })();
          return closePromise;
        };
        return {
          ok: true,
          value: {
            sessionId: storedRecord.sessionId,
            epochId: storedRecord.epochId,
            outputCursor: current.transcript.lastSequence,
            replayed,
            documentRevision,
            exit,
            close,
          },
        };
      };

      const compensate = async (failed: StartRefusal): Promise<PortResult<StartRunSessionReceipt>> => {
        let observed = terminalObserved;
        try {
          const closed = await deps.host.close(record.sessionId);
          if (closed.ok) observed ??= cursorSpace.exit(closed.value);
          else {
            deps.onBackgroundError?.(new Error(
              `compensating close refused (${closed.refusal}) for ${record.sessionId}: ${closed.detail ?? ''}`));
          }
        } catch (error) {
          deps.onBackgroundError?.(error);
        }
        observed ??= cursorSpace.exit({
          sessionId: record.sessionId,
          sequence: record.transcript.lastSequence,
          exitCode: null,
          signal: null,
          reason: 'closed',
          observedAt: now(),
        });
        terminalObserved = observed;
        discardFrames = true;
        earlyFrames.splice(0);
        // The terminal row and the operation settlement are SEPARATE mutates. The document refuses an
        // `exited` row whose exit reason is `abandoned` (a dropped socket, or the launch-exit rejection
        // synthesizer above), and one combined mutate meant that refusal threw away the operation
        // settlement too, leaving the key `pending` forever with no row to explain it.
        const terminal: SessionRecord = observed.reason === 'abandoned'
          ? {
            ...record,
            attachmentIds: [],
            state: 'abandoned',
            abandonReason: 'start-recovery',
            endedAt: observed.observedAt,
            revision: Math.min(Number.MAX_SAFE_INTEGER, record.revision + 1),
            exit: { ...observed, reason: 'abandoned' },
          }
          : {
            ...record,
            attachmentIds: [],
            state: 'exited',
            endedAt: observed.observedAt,
            revision: Math.min(Number.MAX_SAFE_INTEGER, record.revision + 1),
            exit: observed,
          };
        try {
          await deps.persistence.mutate(null, (document) => {
            if (document.sessions.some((item) => item.sessionId === record.sessionId)) return;
            insertSessionRecord(document, structuredClone(terminal));
          });
        } catch (error) {
          deps.onBackgroundError?.(error);
        }
        try {
          await deps.persistence.mutate(null, (document) => {
            const operation = document.attemptOperations[input.hostOperationKey];
            if (operation === undefined || operation.status !== 'pending'
              || operation.requestHash !== input.requestHash || operation.attemptRef !== input.attemptRef
              || operation.revision >= Number.MAX_SAFE_INTEGER) return;
            const settledStatus = failed.refusal === 'cancelled' ? 'cancelled' : 'failed';
            operation.status = settledStatus;
            operation.sessionId = record.sessionId;
            operation.receipt = { ...receipt, status: settledStatus, refusal: failed.refusal, settledAt: now() };
            operation.revision += 1;
            operation.updatedAt = now();
          });
        } catch (error) {
          deps.onBackgroundError?.(error);
        }
        recordReady = true;
        await persistTerminal();
        return failed;
      };

      try {
        if (hostReceipt.value.operationKey !== input.hostOperationKey
          || !Number.isSafeInteger(hostReceipt.value.outputSequence)
          || hostReceipt.value.outputSequence < 0) {
          return compensate({ ok: false, refusal: 'internal', detail: 'host start receipt is invalid' });
        }
        if ((deps.persistence.read().epochId ?? null) !== receiptEpochId) {
          const activated = await registry.activateEpoch(receiptEpochId);
          if (!activated.ok) return compensate(activated);
        }
        const snapshot = deps.persistence.read();
        const replayRecord = identityReplay(snapshot);
        if (replayRecord !== null) return finishStart(replayRecord, snapshot.revision, true);

        const mutation = await deps.persistence.mutate(null, (document) => {
          const operation = document.attemptOperations[input.hostOperationKey];
          const refused = operationRefusal(operation);
          if (refused !== null) return refused;
          const replay = identityReplay(document);
          if (replay !== null) return { ok: true, value: replay } as PortResult<SessionRecord>;
          const priorRecords = document.sessions.filter((item) => item.operationKey === record.operationKey
            && item.sessionId !== record.sessionId);
          const retireable = priorRecords.every((item) => (item.state === 'abandoned' || item.state === 'exited')
            && item.requestHash === record.requestHash && item.provenance === 'run'
            && item.operator === record.operator && item.runRef === record.runRef
            && item.attemptRef === record.attemptRef && item.managedSessionRef === record.managedSessionRef);
          if (!retireable) {
            return { ok: false, refusal: 'binding-conflict', detail: 'run session binding conflict' } as PortResult<SessionRecord>;
          }
          if (priorRecords.length > 0) {
            const retiredIds = new Set(priorRecords.map((item) => item.sessionId));
            document.attemptBindings = document.attemptBindings.map((item) =>
              retiredIds.has(item.sessionId) ? { ...item, retired: true } : item);
            document.operationReceipts = document.operationReceipts.filter((item) =>
              item.operationKey !== receipt.operationKey);
          }
          const collision = document.sessions.some((item) => item.sessionId === record.sessionId)
            || document.attemptBindings.some((item) => item.sessionId === binding.sessionId
              || (item.retired !== true && (item.attemptRef === binding.attemptRef
                || item.managedSessionRef === binding.managedSessionRef)))
            || document.operationReceipts.some((item) => item.operationKey === receipt.operationKey);
          if (collision || operation === undefined || operation.revision >= Number.MAX_SAFE_INTEGER) {
            return { ok: false, refusal: 'binding-conflict', detail: 'run session binding conflict' } as PortResult<SessionRecord>;
          }
          const settledReceipt = {
            ...receipt,
            createdAt: operation.receipt?.createdAt ?? receipt.createdAt,
          };
          insertSessionRecord(document, structuredClone(record));
          document.attemptBindings.push(structuredClone(binding));
          document.operationReceipts.push(structuredClone(settledReceipt));
          operation.status = 'bound';
          operation.sessionId = record.sessionId;
          operation.receipt = structuredClone(settledReceipt);
          operation.revision += 1;
          operation.updatedAt = now();
          return { ok: true, value: structuredClone(record) } as PortResult<SessionRecord>;
        });
        if (!mutation.value.ok) return compensate(mutation.value);
        return finishStart(mutation.value.value, mutation.revision, hostReceipt.value.replayed);
      } catch (error) {
        deps.onBackgroundError?.(error);
        return compensate({ ok: false, refusal: 'internal', detail: 'session operation failed' });
      }
    },

    async abandonEpoch(epochId, reason) {
      try {
        const result = await deps.persistence.mutate(null, (document) => applyEpochAbandonment(document, epochId, reason, now()));
        return { ok: true, value: { abandoned: result.value, revision: result.revision } };
      } catch (error) { return reportInternal(error); }
    },

    async activateEpoch(epochId) {
      try {
        const snapshot = deps.persistence.read();
        if (snapshot.epochId === epochId) {
          return { ok: true, value: { abandoned: 0, revision: snapshot.revision } };
        }
        const result = await deps.persistence.mutate(null, (document) => {
          if (document.epochId === epochId) return 0;
          const staleEpochs = new Set(document.sessions
            .filter((record) => live(record) && record.epochId !== epochId)
            .map((record) => record.epochId));
          let abandoned = 0;
          const observedAt = now();
          for (const staleEpochId of staleEpochs) {
            abandoned += applyEpochAbandonment(document, staleEpochId, 'daemon-restart', observedAt);
          }
          document.epochId = epochId;
          return abandoned;
        });
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
      let result: Awaited<ReturnType<SessionHost['close']>>;
      try {
        result = await deps.host.close(record.sessionId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        deps.onBackgroundError?.(error);
        await observeHostExit({
          sessionId: record.sessionId,
          sequence: record.transcript.lastSequence,
          exitCode: null,
          signal: null,
          reason: 'closed',
          observedAt: now(),
        }, record.epochId);
        return { ok: false, refusal: 'internal', detail };
      }
      if (!result.ok) {
        deps.onBackgroundError?.(new Error(
          `deployment close refused (${result.refusal}) for ${record.sessionId}: ${result.detail ?? ''}`));
        await observeHostExit({
          sessionId: record.sessionId,
          sequence: record.transcript.lastSequence,
          exitCode: null,
          signal: null,
          reason: 'closed',
          observedAt: now(),
        }, record.epochId);
        return result;
      }
      await observeHostExit({ ...result.value, sequence: record.transcript.lastSequence }, record.epochId);
      closed.push(record.sessionId);
    }
    return { ok: true, value: { closed } };
  };
  deps.installDeploymentCloser?.(deploymentCloser);
  return registry;
}
