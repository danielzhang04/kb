import { spawn as spawnChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import type { IWindowsPtyForkOptions } from 'node-pty';

import { buildChildEnv } from '../control/childEnv.ts';
import type {
  HostLaunch, HostStartReceipt, ObservedExit, PortResult, SessionDataFrame,
  SessionHost, SessionHostRequest, SessionSink, SessionSize,
} from './contracts.ts';
import {
  createWindowsPathPinInspector, CURRENT_PROCESS_SERVICE_SID, isApprovedLocalWindowsRoot,
  isSafeRelativeWindowsCwd, mapWindowsLaunchRecipe, pinWindowsLauncher,
  type WindowsLaunchProfile, type WindowsLaunchRecipeOptions, type WindowsPathPinInspector,
  type WindowsPinnedLaunch,
} from './launcherProfiles.ts';
import { probeWindowsPty } from './probe.ts';

export type WindowsPtyProcess = {
  pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
};

export type WindowsPtySpawner = (
  file: string, args: string[], options: IWindowsPtyForkOptions,
) => WindowsPtyProcess;

export type WindowsTranscriptWriter = {
  data?(sessionId: string, sequence: number, frame: SessionDataFrame): void | Promise<void>;
  exit?(exit: ObservedExit): void | Promise<void>;
};

type TreeKillHelper = {
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'close', listener: (code: number | null) => void): unknown;
};
export type WindowsTreeKillSpawner = (
  file: string, args: string[],
  options: { windowsHide: true; stdio: 'ignore'; env: NodeJS.ProcessEnv },
) => TreeKillHelper;

export type WindowsSessionHostOptions = {
  epochId: string;
  roots: { repo: string; worktrees: string };
  environment?: Record<string, string | undefined>;
  launchOptions?: Omit<WindowsLaunchRecipeOptions, 'environment' | 'rootPath'>;
  resolveLaunch?: (request: SessionHostRequest) => Promise<PortResult<WindowsLaunchProfile>>;
  spawn?: WindowsPtySpawner;
  pathInspector?: WindowsPathPinInspector;
  serviceSid?: string;
  transcript?: WindowsTranscriptWriter;
  now?: () => Date;
  randomId?: () => string;
  killProcessTree?: (pid: number) => Promise<void>;
  hostCapacity?: number;
  principalCapacity?: number;
  /** Upper bound on the post-exit sink/transcript drain; the observed exit resolves regardless. */
  drainTimeoutMs?: number;
};

type AttachmentState = {
  sink: SessionSink; queuedBytes: number; queue: Promise<void>; detached: boolean;
};
type LiveState = 'starting' | 'live' | 'closing' | 'exited';
type HostSession = {
  sessionId: string;
  requestHash: string;
  operationKey: string;
  principal: string;
  child: WindowsPtyProcess | null;
  listeners: Array<{ dispose(): void }>;
  state: LiveState;
  sequence: number;
  attachments: Map<string, AttachmentState>;
  transcriptQueue: Promise<void>;
  transcriptQueuedBytes: number;
  outputOverflow: boolean;
  closeRequested: boolean;
  closeAttempt: Promise<boolean> | null;
  released: boolean;
  exitValue: ObservedExit | null;
  exitPromise: Promise<ObservedExit>;
  resolveExit: (exit: ObservedExit) => void;
  receiptPromise: Promise<PortResult<HostStartReceipt>> | null;
};
type OperationEntry = {
  requestHash: string;
  session: HostSession | null;
  receiptPromise: Promise<PortResult<HostStartReceipt>>;
  terminalExit: ObservedExit | null;
};
type ResourceCounts = {
  sessions: number; childRefs: number; listeners: number; sinks: number; operations: number;
};

const OPERATION_KEY_RE = /^op-[0-9a-f]{64}$/;
const MAX_INPUT_BYTES = 65_536;
const MAX_OUTPUT_BACKLOG = 1_048_576;
const MAX_ATTACHMENTS = 64;
/** Terminal operation receipts retained for replay; older terminal entries are evicted first. */
const MAX_TERMINAL_OPERATIONS = 64;
const DEFAULT_DRAIN_TIMEOUT_MS = 2_000;
/** Composite principal key: NUL-separated so no operator/ref pair can forge another bucket. */
const PRINCIPAL_KEY_SEPARATOR = '\u0000';
const TREE_HELPER_ALLOWLIST = [
  'SYSTEMROOT', 'SystemRoot', 'SYSTEMDRIVE', 'SystemDrive', 'WINDIR', 'windir',
  'COMSPEC', 'ComSpec', 'TEMP', 'TMP',
] as const;
const resourceInspectors = new WeakMap<SessionHost, () => ResourceCounts>();

export function inspectWindowsSessionHostResources(host: SessionHost): ResourceCounts {
  return resourceInspectors.get(host)?.() ?? {
    sessions: 0, childRefs: 0, listeners: 0, sinks: 0, operations: 0,
  };
}

function failedExit(now: () => Date): ObservedExit {
  return {
    sessionId: `pty-${'0'.repeat(32)}`, sequence: 0, exitCode: null, signal: null,
    reason: 'abandoned', observedAt: now().toISOString(),
  };
}

function failedLaunch(result: PortResult<never>, now: () => Date): HostLaunch {
  return { receipt: Promise.resolve(result), exit: Promise.resolve(failedExit(now)) };
}

function validSize(size: SessionSize): boolean {
  return Number.isInteger(size.cols) && size.cols >= 20 && size.cols <= 500
    && Number.isInteger(size.rows) && size.rows >= 5 && size.rows <= 200;
}

/** Key-order-independent encoding: two semantically identical requests must hash identically. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

function requestHash(request: SessionHostRequest): string { return canonicalJson(request); }

function principalKey(request: SessionHostRequest): string {
  return `${request.principal.operator}${PRINCIPAL_KEY_SEPARATOR}${request.principal.browserSessionRef}`;
}

function isWellFormedPrincipal(request: SessionHostRequest): boolean {
  const principal = (request as { principal?: unknown }).principal;
  if (principal === null || typeof principal !== 'object') return false;
  const { operator, browserSessionRef } = principal as { operator?: unknown; browserSessionRef?: unknown };
  return typeof operator === 'string' && operator.length > 0 && operator.length <= 128
    && typeof browserSessionRef === 'string' && browserSessionRef.length > 0
    && browserSessionRef.length <= 128;
}

async function defaultSpawn(
  file: string, args: string[], options: IWindowsPtyForkOptions,
): Promise<WindowsPtyProcess> {
  const loaded = await import('node-pty');
  return loaded.spawn(file, args, options);
}

/** `taskkill /PID` exits 128 when the PID no longer exists. */
const TASKKILL_NO_SUCH_PROCESS = 128;

export class TaskkillNoSuchProcessError extends Error {
  constructor() { super(`taskkill failed with exit code ${String(TASKKILL_NO_SUCH_PROCESS)}`); }
}

export function createWindowsTreeCloser(
  environment: Record<string, string | undefined>,
  spawnHelper: WindowsTreeKillSpawner = (file, args, options) => spawnChildProcess(file, args, options),
): (pid: number) => Promise<void> {
  const helperEnv = buildChildEnv(environment, TREE_HELPER_ALLOWLIST);
  const systemRoot = helperEnv.SystemRoot ?? helperEnv.SYSTEMROOT;
  const taskkill = typeof systemRoot === 'string' && systemRoot.length > 0
    ? `${systemRoot}\\System32\\taskkill.exe`
    : 'taskkill';
  const run = (pid: number): Promise<void> => new Promise((resolve, reject) => {
    const helper = spawnHelper(taskkill, ['/T', '/F', '/PID', String(pid)], {
      windowsHide: true, stdio: 'ignore', env: { ...helperEnv },
    });
    let settled = false;
    helper.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    helper.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else if (code === TASKKILL_NO_SUCH_PROCESS) reject(new TaskkillNoSuchProcessError());
      else reject(new Error(`taskkill failed with exit code ${String(code)}`));
    });
  });
  return async (pid) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { await run(pid); return; } catch (error) {
        lastError = error;
        // 128 means the PID is already gone; a retry can only re-report the same absence.
        if (error instanceof TaskkillNoSuchProcessError) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('taskkill failed');
  };
}

export function createWindowsSessionHost(options: WindowsSessionHostOptions): SessionHost {
  const now = options.now ?? (() => new Date());
  const makeRandomId = options.randomId ?? (() => randomBytes(16).toString('hex'));
  const environment = options.environment ?? process.env;
  const hostCapacity = options.hostCapacity ?? 16;
  const principalCapacity = options.principalCapacity ?? 8;
  const serviceSid = options.serviceSid ?? CURRENT_PROCESS_SERVICE_SID;
  const pathInspector = options.pathInspector ?? (options.resolveLaunch === undefined
    ? createWindowsPathPinInspector(serviceSid)
    : undefined);
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const treeCloser = options.killProcessTree ?? createWindowsTreeCloser(environment);
  const sessions = new Map<string, HostSession>();
  const operations = new Map<string, OperationEntry>();
  const principalReservations = new Map<string, number>();
  let reservations = 0;
  let attachmentCounter = 0;

  const releasePrincipal = (principal: string): void => {
    reservations -= 1;
    const remaining = (principalReservations.get(principal) ?? 1) - 1;
    if (remaining <= 0) principalReservations.delete(principal);
    else principalReservations.set(principal, remaining);
  };

  const releaseReservation = (session: HostSession): void => {
    if (session.released) return;
    session.released = true;
    releasePrincipal(session.principal);
  };

  /**
   * The single atomic reservation point: one synchronous check-and-take of both the 16-per-host
   * ceiling and the 8-per-`{operator,browserSessionRef}` ceiling, so no interleaving can oversubscribe.
   */
  const reserve = (principal: string): boolean => {
    if (reservations >= hostCapacity || (principalReservations.get(principal) ?? 0) >= principalCapacity) {
      return false;
    }
    reservations += 1;
    principalReservations.set(principal, (principalReservations.get(principal) ?? 0) + 1);
    return true;
  };

  /** Keep every live operation; evict terminal ones oldest-first past the retention bound. */
  const pruneOperations = (): void => {
    if (operations.size <= MAX_TERMINAL_OPERATIONS) return;
    for (const [key, entry] of operations) {
      if (operations.size <= MAX_TERMINAL_OPERATIONS) return;
      if (entry.session === null) operations.delete(key);
    }
  };

  const uniqueSessionId = (): string => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const suffix = makeRandomId();
      if (/^[0-9a-f]{32}$/.test(suffix) && !sessions.has(`pty-${suffix}`)) return `pty-${suffix}`;
    }
    throw new Error('session id unavailable');
  };

  const addSink = (session: HostSession, sink: SessionSink): string | null => {
    if (session.state === 'exited' || sink.closed() || session.attachments.size >= MAX_ATTACHMENTS) return null;
    let attachmentId: string;
    do {
      attachmentCounter += 1;
      attachmentId = `att-${attachmentCounter.toString(16).padStart(32, '0')}`;
    } while (session.attachments.has(attachmentId));
    session.attachments.set(attachmentId, {
      sink, queuedBytes: 0, queue: Promise.resolve(), detached: false,
    });
    return attachmentId;
  };

  const finalize = (session: HostSession, exitCode: number | null, signal: number | null): void => {
    if (session.exitValue !== null) return;
    session.state = 'exited';
    session.sequence += 1;
    const observed: ObservedExit = {
      sessionId: session.sessionId, sequence: session.sequence, exitCode, signal,
      reason: session.closeRequested ? 'closed' : 'exited', observedAt: now().toISOString(),
    };
    session.exitValue = observed;
    releaseReservation(session);
    for (const listener of session.listeners.splice(0)) {
      try { listener.dispose(); } catch { /* release every listener */ }
    }
    session.child = null;
    const attachments = [...session.attachments.values()];
    session.attachments.clear();
    sessions.delete(session.sessionId);
    const operation = operations.get(session.operationKey);
    if (operation?.session === session) {
      operation.session = null;
      operation.terminalExit = observed;
    }
    if (session.outputOverflow) {
      void Promise.resolve(options.transcript?.exit?.(observed)).catch(() => {});
      session.resolveExit(observed);
      return;
    }
    // D1: the observed exit must resolve even if a sink or the transcript never settles. The drain
    // races a bounded timer; whichever side loses is abandoned and its late completion discarded.
    let drainSettled = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      deadlineTimer = setTimeout(resolve, drainTimeoutMs);
      if (typeof deadlineTimer.unref === 'function') deadlineTimer.unref();
    });
    const dataDrained = Promise.all(attachments.map((attachment) => attachment.queue.catch(() => {})));
    const transcriptExit = Promise.all([session.transcriptQueue.catch(() => {}), dataDrained]).then(async () => {
      if (drainSettled) return;
      await options.transcript?.exit?.(observed);
    });
    const sinkExits = attachments.map((attachment) => attachment.queue.catch(() => {}).then(async () => {
      await transcriptExit;
      if (drainSettled || attachment.sink.closed()) return;
      await attachment.sink.exit(observed);
    }).catch(() => {}));
    void Promise.race([Promise.all(sinkExits).then(() => {}), deadline]).then(() => {
      drainSettled = true;
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      session.resolveExit(observed);
    });
  };

  /**
   * D2: an unrecoverable tree-close failure must not permanently consume a slot. Release both
   * reservations, drop the session from the live map, resolve `create()`'s exit promise with an
   * `abandoned` outcome, and record that outcome on the operation entry for replay.
   */
  const abandonSession = (session: HostSession): ObservedExit => {
    if (session.exitValue !== null) return session.exitValue;
    session.state = 'exited';
    session.sequence += 1;
    const observed: ObservedExit = {
      sessionId: session.sessionId, sequence: session.sequence, exitCode: null, signal: null,
      reason: 'abandoned', observedAt: now().toISOString(),
    };
    session.exitValue = observed;
    releaseReservation(session);
    for (const listener of session.listeners.splice(0)) {
      try { listener.dispose(); } catch { /* release every listener */ }
    }
    session.child = null;
    session.attachments.clear();
    sessions.delete(session.sessionId);
    const operation = operations.get(session.operationKey);
    if (operation?.session === session) {
      operation.session = null;
      operation.terminalExit = observed;
    }
    void Promise.resolve(options.transcript?.exit?.(observed)).catch(() => {});
    session.resolveExit(observed);
    return observed;
  };

  const closeTree = async (session: HostSession): Promise<boolean> => {
    const child = session.child;
    if (child === null) return true;
    if (session.closeAttempt !== null) return session.closeAttempt;
    const attempt = treeCloser(child.pid).then(() => true, () => false);
    session.closeAttempt = attempt;
    const closed = await attempt;
    if (!closed && session.closeAttempt === attempt) session.closeAttempt = null;
    return closed;
  };

  const wireChild = (session: HostSession, child: WindowsPtyProcess): void => {
    const exitListener = child.onExit((event) => finalize(session, event.exitCode, event.signal ?? null));
    session.listeners.push(exitListener);
    const dataListener = child.onData((data) => {
      if (session.state === 'exited' || session.outputOverflow) return;
      const decodedBytes = Buffer.byteLength(data, 'utf8');
      if (session.transcriptQueuedBytes + decodedBytes > MAX_OUTPUT_BACKLOG) {
        session.outputOverflow = true;
        session.closeRequested = true;
        session.state = 'closing';
        void closeTree(session);
        return;
      }
      session.sequence += 1;
      const frame: SessionDataFrame = {
        sessionId: session.sessionId, sequence: session.sequence, encoding: 'base64',
        data: Buffer.from(data, 'utf8').toString('base64'), replay: false,
      };
      session.transcriptQueuedBytes += decodedBytes;
      const transcriptReady = session.transcriptQueue.catch(() => {}).then(async () => {
        try {
          await options.transcript?.data?.(session.sessionId, frame.sequence, frame);
          return true;
        } catch {
          return false;
        } finally {
          session.transcriptQueuedBytes -= decodedBytes;
        }
      });
      session.transcriptQueue = transcriptReady.then(() => {});
      for (const [attachmentId, attachment] of session.attachments) {
        if (attachment.sink.closed() || attachment.queuedBytes + decodedBytes > MAX_OUTPUT_BACKLOG) {
          attachment.detached = true;
          session.attachments.delete(attachmentId);
          continue;
        }
        attachment.queuedBytes += decodedBytes;
        attachment.queue = attachment.queue.catch(() => {}).then(async () => {
          const recorded = await transcriptReady;
          if (!recorded || attachment.detached || attachment.sink.closed()) {
            attachment.detached = true;
            session.attachments.delete(attachmentId);
            return;
          }
          await attachment.sink.data(frame);
        }).catch(() => {
          attachment.detached = true;
          session.attachments.delete(attachmentId);
        }).finally(() => {
          attachment.queuedBytes -= decodedBytes;
        });
      }
    });
    session.listeners.push(dataListener);
  };

  const resolveLaunch = options.resolveLaunch ?? (async (request: SessionHostRequest) => mapWindowsLaunchRecipe(request, {
    environment, rootPath: options.roots[request.rootId], ...options.launchOptions,
  }));

  const closeSession = async (session: HostSession): Promise<PortResult<ObservedExit>> => {
    if (session.exitValue !== null) return { ok: true, value: session.exitValue };
    session.closeRequested = true;
    session.state = 'closing';
    if (session.child !== null && !await closeTree(session)) {
      // D3: the child may have exited between the check above and the closer returning — including
      // the taskkill-128 "no such process" case. A confirmed exit is a successful close.
      if (session.exitValue !== null) return { ok: true, value: session.exitValue };
      abandonSession(session);
      return { ok: false, refusal: 'internal', detail: null };
    }
    return { ok: true, value: await session.exitPromise };
  };

  const host: SessionHost = {
    probe: () => probeWindowsPty({
      epochId: options.epochId, environment, roots: options.roots, pathInspector,
      serviceSid, launchOptions: options.launchOptions,
    }),

    create(request, initialSink) {
      if (!OPERATION_KEY_RE.test(request.operationKey) || !validSize(request)
        || !isWellFormedPrincipal(request)
        || !isSafeRelativeWindowsCwd(request.relativeCwd)
        || !Object.hasOwn(options.roots, request.rootId)
        || !isApprovedLocalWindowsRoot(options.roots[request.rootId])) {
        return failedLaunch({ ok: false, refusal: 'invalid-request', detail: null }, now);
      }
      const hash = requestHash(request);
      const existing = operations.get(request.operationKey);
      if (existing !== undefined) {
        if (existing.requestHash !== hash) {
          return failedLaunch({ ok: false, refusal: 'binding-conflict', detail: null }, now);
        }
        if (existing.session !== null) addSink(existing.session, initialSink);
        return {
          receipt: existing.receiptPromise.then((result) => result.ok
            ? { ok: true, value: { ...result.value, replayed: true } }
            : result),
          exit: existing.session?.exitPromise ?? Promise.resolve(existing.terminalExit ?? failedExit(now)),
        };
      }

      // The caller-authenticated `{operator, browserSessionRef}` is the only owner bucket. Controller-null
      // Run sessions arrive with the owning operator and RUN_CONTROLLER_NULL_BROWSER_SESSION_REF, so they
      // count against that operator. Never derive an owner from `rootId` or the opaque `operationKey`.
      const principal = principalKey(request);
      if (!reserve(principal)) {
        return failedLaunch({ ok: false, refusal: 'capacity', detail: null }, now);
      }
      let sessionId: string;
      try { sessionId = uniqueSessionId(); } catch {
        releasePrincipal(principal);
        return failedLaunch({ ok: false, refusal: 'internal', detail: null }, now);
      }
      let resolveExit = (_exit: ObservedExit): void => {};
      const exitPromise = new Promise<ObservedExit>((resolve) => { resolveExit = resolve; });
      const session: HostSession = {
        sessionId, requestHash: hash, operationKey: request.operationKey, principal,
        child: null, listeners: [], state: 'starting', sequence: 0, attachments: new Map(),
        transcriptQueue: Promise.resolve(), transcriptQueuedBytes: 0, outputOverflow: false,
        closeRequested: false, closeAttempt: null, released: false, exitValue: null,
        exitPromise, resolveExit, receiptPromise: null,
      };
      addSink(session, initialSink);
      sessions.set(sessionId, session);

      const receipt = (async (): Promise<PortResult<HostStartReceipt>> => {
        let pinned: WindowsPinnedLaunch | null = null;
        try {
          const launch = await resolveLaunch(request);
          if (!launch.ok) { finalize(session, null, null); return launch; }
          if (session.closeRequested) {
            finalize(session, null, null);
            return { ok: false, refusal: 'cancelled', detail: null };
          }
          if (pathInspector !== undefined) {
            if (serviceSid.length === 0) throw new Error('service SID is required');
            const pin = await pinWindowsLauncher(launch.value, pathInspector, serviceSid);
            if (!pin.ok) { finalize(session, null, null); return pin; }
            pinned = pin.value;
            if (!await pinned.recheck()) {
              await pinned.release();
              pinned = null;
              finalize(session, null, null);
              return { ok: false, refusal: 'launcher-unavailable', detail: null };
            }
          }
          const child = options.spawn !== undefined
            ? options.spawn(launch.value.file, launch.value.args, {
                name: 'xterm-256color', cols: request.cols, rows: request.rows,
                cwd: launch.value.cwd, env: launch.value.env,
              })
            : await defaultSpawn(launch.value.file, launch.value.args, {
                name: 'xterm-256color', cols: request.cols, rows: request.rows,
                cwd: launch.value.cwd, env: launch.value.env,
              });
          session.child = child;
          wireChild(session, child);
          await pinned?.release();
          pinned = null;
          if (session.closeRequested) {
            if (!await closeTree(session)) {
              if (session.exitValue === null) abandonSession(session);
              return { ok: false, refusal: 'internal', detail: null };
            }
            await session.exitPromise;
            return { ok: false, refusal: 'cancelled', detail: null };
          }
          if (session.exitValue === null) session.state = 'live';
          const boundAt = now().toISOString();
          return { ok: true, value: {
            operationKey: request.operationKey, sessionId, epochId: options.epochId,
            revision: 1, boundAt, replayed: false,
          } };
        } catch {
          await pinned?.release();
          if (session.child === null) finalize(session, null, null);
          else {
            session.closeRequested = true;
            session.state = 'closing';
            if (await closeTree(session)) await session.exitPromise;
            else if (session.exitValue === null) abandonSession(session);
          }
          return { ok: false, refusal: 'launcher-unavailable', detail: null };
        }
      })();
      session.receiptPromise = receipt;
      operations.set(request.operationKey, {
        requestHash: hash, session, receiptPromise: receipt, terminalExit: null,
      });
      pruneOperations();
      return { receipt, exit: exitPromise };
    },

    async attach(sessionId, sink) {
      const session = sessions.get(sessionId);
      if (session === undefined || session.state === 'exited') {
        return { ok: false, refusal: 'not-found', detail: null };
      }
      const attachmentId = addSink(session, sink);
      return attachmentId === null
        ? { ok: false, refusal: 'capacity', detail: null }
        : { ok: true, value: { attachmentId } };
    },

    async write(sessionId, data) {
      const session = sessions.get(sessionId);
      if (session === undefined || session.state !== 'live' || session.child === null) {
        return { ok: false, refusal: 'not-found', detail: null };
      }
      if (data.byteLength === 0 || data.byteLength > MAX_INPUT_BYTES) {
        return { ok: false, refusal: 'input-too-large', detail: null };
      }
      session.child.write(Buffer.from(data).toString('utf8'));
      return { ok: true, value: { accepted: data.byteLength } };
    },

    async resize(sessionId, size) {
      const session = sessions.get(sessionId);
      if (session === undefined || session.state !== 'live' || session.child === null) {
        return { ok: false, refusal: 'not-found', detail: null };
      }
      if (!validSize(size)) return { ok: false, refusal: 'size-out-of-range', detail: null };
      try { session.child.resize(size.cols, size.rows); } catch {
        return { ok: false, refusal: 'internal', detail: null };
      }
      return { ok: true, value: { cols: size.cols, rows: size.rows } };
    },

    async close(sessionId) {
      const session = sessions.get(sessionId);
      if (session === undefined) return { ok: false, refusal: 'not-found', detail: null };
      return closeSession(session);
    },

    async listEpoch() {
      return { ok: true, value: { epochId: options.epochId, sessionIds: [...sessions.keys()] } };
    },

    async drain(epochId) {
      if (epochId !== options.epochId) return { ok: false, refusal: 'epoch-lost', detail: null };
      const snapshot = [...sessions.values()];
      const closed: string[] = [];
      const alreadyGone: string[] = [];
      for (const session of snapshot) {
        if (session.exitValue !== null) { alreadyGone.push(session.sessionId); continue; }
        const result = await closeSession(session);
        if (!result.ok) return result;
        closed.push(session.sessionId);
      }
      return { ok: true, value: { epochId, closed, alreadyGone } };
    },
  };
  resourceInspectors.set(host, () => ({
    sessions: sessions.size,
    childRefs: [...sessions.values()].filter((session) => session.child !== null).length,
    listeners: [...sessions.values()].reduce((total, session) => total + session.listeners.length, 0),
    sinks: [...sessions.values()].reduce((total, session) => total + session.attachments.size, 0),
    operations: operations.size,
  }));
  return host;
}

export const createWindowsPtyHost = createWindowsSessionHost;
