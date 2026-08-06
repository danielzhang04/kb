/**
 * SESSION RUNS — the durable record of "a human sat down with an agent in a terminal".
 *
 * ── Why this is NOT a control-plane run (the doctrine this file exists to hold) ──
 *
 * A governed run (`server/control/`) is a proposal-hash-pinned execution: it is launched from a compiled
 * plan, its running state is owned by the executor, and every transition is a governed write. A session
 * run is none of those things. It is one PTY-hosted `claude` primed as an agent or as a workflow's
 * governing agent, driven by an operator's keystrokes. It has no proposal, no plan hash, no stage graph,
 * and — critically — no closed-tab exit: the shell survives the browser, so "the operator went away" is
 * not an outcome at all.
 *
 * Those are different provenances and they are deliberately different RECORDS. Nothing here is ever
 * rendered as a governed run, and nothing in `server/control/` is touched by this file. The store lives
 * outside `server/control/` on purpose: a PTY `claude` cannot authenticate to the control plane, so a
 * record it produced could never be a control-plane object without lying about how it was made.
 *
 * ── Who writes ──
 *
 * The DAEMON, only. The agent inside the PTY never writes a session run — it has no route to one, and
 * that is the point: the record is an observation the server makes ABOUT the session, not a claim the
 * session makes about itself. Every transition below is driven by something the daemon itself observed:
 *
 *   spawn accepted     → `create` writes `live` BEFORE any byte reaches the operator (the same
 *                        fail-closed point as the `opened` audit row in `route.ts`).
 *   shell exit / kill  → `end` writes `ended` and attaches the flushed transcript, driven by
 *                        `persistentSessions`' `observe()` gone-notification, which fires exactly once.
 *   daemon boot        → `sweepAbandoned` turns every surviving `live` into `abandoned`. Nothing
 *                        survives a restart, so a `live` record that outlived the process is a lie and
 *                        is corrected before anything can read it.
 *   operator dismiss   → `archive`, absorbing and T3-audited at the route layer.
 *
 * Closing the browser tab is NOT a transition. It detaches a socket; the shell keeps running and `live`
 * stays truthful.
 *
 * ── Storage ──
 *
 * One lock-serialized JSON document under the daemon state root, through the same
 * `createAtomicJsonDocument` primitive `server/control/agentSessionChains.ts` uses — the one local
 * persistence primitive in this codebase with a REAL cross-process lock (a SQLite `BEGIN IMMEDIATE`
 * holding an OS file lock), which matters because the daemon and its tests can both be running. The
 * document is created LAZILY, so merely constructing this store touches no filesystem.
 *
 * Every read is owner-scoped. A ref belonging to another operator is reported as `not-found`, never as
 * "forbidden" — an existence oracle across operators would be its own leak.
 */
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { createAtomicJsonDocument } from '../control/atomicJsonDocument.ts';
import type { AtomicJsonDocument } from '../control/atomicJsonDocument.ts';

/** What a session was primed as. A plain shell or an unprimed `claude` is NOT a session run: it belongs
 *  to no entity, so there is no detail surface it could honestly appear on. */
export type SessionRunKind = 'agent' | 'workflow';

/**
 * The lifecycle. `live` is the only non-terminal state; `archived` is ABSORBING (an archived record is
 * never revived, which is what makes "dismiss" a decision the operator only has to make once).
 *
 *   live      — the daemon spawned it and has not observed it end.
 *   ended     — the shell exited, or the operator killed it. Transcript flushed.
 *   abandoned — it was `live` when the daemon restarted. The shell is gone; the transcript stops there.
 *   archived  — the operator dismissed the record.
 */
export type SessionRunOutcome = 'live' | 'ended' | 'abandoned' | 'archived';

/** Where the operator-visible transcript landed, and whether it is the WHOLE session. `truncated` is a
 *  truth label the UI must render ("last 512KB"), never a detail to hide. */
export interface SessionRunTranscript {
  path: string;
  bytes: number;
  truncated: boolean;
}

export interface SessionRunRecord {
  /** `srun-<uuid>`, minted SERVER-SIDE. A client never proposes one. */
  sessionRunRef: string;
  kind: SessionRunKind;
  /** The agent id or workflow ref. Already allowlist-validated upstream (`server/pty/route.ts`). */
  targetRef: string;
  /** The session subject (`sub`) that owns it. Every read in this file is scoped by it. */
  owner: string;
  /** The PTY session this record describes, or null if the shell was never minted. */
  ptySessionId: string | null;
  /** The server-generated priming file this session was started with, when there was one. */
  primingPath: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: SessionRunOutcome;
  /** The shell's exit code when the daemon actually observed one. Often null: the gone-notification
   *  carries no exit info, and a detached session's exit is observed by nobody. Null means UNKNOWN. */
  exitCode: number | null;
  transcript: SessionRunTranscript | null;
  /** Compare-and-set counter, incremented on every accepted mutation. */
  version: number;
}

/** Archive is idempotent by key, exactly like the governed run archive it copies its shape from. */
export interface SessionRunArchiveRequest {
  idempotencyKey: string;
  reason: string | null;
}

export type SessionRunArchiveResult =
  | { ok: true; value: SessionRunRecord; replayed: boolean }
  | { ok: false; error: 'not-found' }
  | { ok: false; error: 'session-run-live' }
  | { ok: false; error: 'idempotency-conflict' };

export type SessionRunStoreErrorCode = 'invalid-input' | 'document-unavailable';

export class SessionRunStoreError extends Error {
  readonly code: SessionRunStoreErrorCode;

  constructor(code: SessionRunStoreErrorCode, message: string) {
    super(message);
    this.name = 'SessionRunStoreError';
    this.code = code;
  }
}

function fail(code: SessionRunStoreErrorCode, message: string): never {
  throw new SessionRunStoreError(code, message);
}

/** `srun-` + a v4 UUID. Anchored, so a ref can never carry a path separator into a filename or a URL. */
export const SESSION_RUN_REF_RE = /^srun-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Document ceiling. Comfortably above the retention cap below; a document over it is refused, never
 *  silently truncated. */
const MAX_DOCUMENT_BYTES = 4_000_000;

/** How many records are retained. Oldest TERMINAL records are evicted first; a `live` record is NEVER
 *  evicted, because forgetting a running shell is how orphans happen. */
export const MAX_RETAINED_SESSION_RUNS = 500;

/** Bounded idempotency memory — the same ceiling philosophy as the retention cap. */
const MAX_ARCHIVE_KEYS = 512;

interface ArchiveKeyEntry {
  key: string;
  sessionRunRef: string;
  reason: string | null;
}

interface SessionRunDocument {
  schema: 'kb.pty-session-runs/v1';
  /** Oldest first — the natural order for retention eviction. Readers sort for themselves. */
  runs: SessionRunRecord[];
  archiveKeys: ArchiveKeyEntry[];
}

const OUTCOMES: readonly SessionRunOutcome[] = ['live', 'ended', 'abandoned', 'archived'];

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isTranscript(value: unknown): value is SessionRunTranscript | null {
  if (value === null) return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const t = value as Record<string, unknown>;
  return typeof t.path === 'string' && typeof t.bytes === 'number' && Number.isFinite(t.bytes)
    && typeof t.truncated === 'boolean';
}

function isRecord(value: unknown): value is SessionRunRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return typeof r.sessionRunRef === 'string' && SESSION_RUN_REF_RE.test(r.sessionRunRef)
    && (r.kind === 'agent' || r.kind === 'workflow')
    && typeof r.targetRef === 'string' && r.targetRef.length > 0
    && typeof r.owner === 'string' && r.owner.length > 0
    && (r.ptySessionId === null || typeof r.ptySessionId === 'string')
    && (r.primingPath === null || typeof r.primingPath === 'string')
    && isTimestamp(r.startedAt)
    && (r.endedAt === null || isTimestamp(r.endedAt))
    && OUTCOMES.includes(r.outcome as SessionRunOutcome)
    && (r.exitCode === null || (typeof r.exitCode === 'number' && Number.isFinite(r.exitCode)))
    && isTranscript(r.transcript)
    && typeof r.version === 'number' && Number.isSafeInteger(r.version) && r.version >= 1;
}

/** A malformed document is a REFUSAL, never a silent reset: the alternative is quietly forgetting live
 *  shells the daemon is still responsible for. */
function assertDocument(value: unknown): asserts value is SessionRunDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('document-unavailable', 'session run document is invalid');
  }
  const document = value as Record<string, unknown>;
  if (document.schema !== 'kb.pty-session-runs/v1') {
    fail('document-unavailable', 'session run document is invalid');
  }
  if (!Array.isArray(document.runs) || document.runs.some((entry) => !isRecord(entry))) {
    fail('document-unavailable', 'session run document is invalid');
  }
  if (!Array.isArray(document.archiveKeys)) fail('document-unavailable', 'session run document is invalid');
  for (const entry of document.archiveKeys) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail('document-unavailable', 'session run document is invalid');
    }
    const key = entry as Record<string, unknown>;
    if (typeof key.key !== 'string' || typeof key.sessionRunRef !== 'string'
      || (key.reason !== null && typeof key.reason !== 'string')) {
      fail('document-unavailable', 'session run document is invalid');
    }
  }
}

function documentError(error: unknown): SessionRunStoreError {
  if (error instanceof SessionRunStoreError) return error;
  return new SessionRunStoreError('document-unavailable', 'session run document is unavailable');
}

export interface CreateSessionRunInput {
  owner: string;
  kind: SessionRunKind;
  targetRef: string;
  ptySessionId: string | null;
  primingPath?: string | null;
}

export interface EndSessionRunInput {
  /** Only recorded when the daemon actually observed it; omitted leaves the field UNKNOWN (null). */
  exitCode?: number | null;
  transcript?: SessionRunTranscript | null;
}

export interface SessionRunStore {
  /** Write a `live` record. Called before any byte reaches the operator; a failure fails the spawn. */
  create(input: CreateSessionRunInput): Promise<SessionRunRecord>;
  /** Terminal transition on an observed shell death. A no-op (null) for an already-terminal record. */
  end(owner: string, sessionRunRef: string, input?: EndSessionRunInput): Promise<SessionRunRecord | null>;
  /** Fill in an exit code the gone-notification could not carry. Only ever fills an UNKNOWN. */
  stampExitCode(owner: string, sessionRunRef: string, exitCode: number): Promise<void>;
  /** Boot sweep: every surviving `live` becomes `abandoned`. Returns how many were corrected. */
  sweepAbandoned(): Promise<number>;
  /** Operator dismiss. Absorbing, idempotent by key, and REFUSED while the session is live. */
  archive(owner: string, sessionRunRef: string, request: SessionRunArchiveRequest): Promise<SessionRunArchiveResult>;
  /** Newest first. Archived records are excluded unless asked for. */
  list(owner: string, options?: { includeArchived?: boolean }): SessionRunRecord[];
  get(owner: string, sessionRunRef: string): SessionRunRecord | null;
}

export interface SessionRunStoreDeps {
  /** Injectable clock so tests get deterministic timestamps. */
  now?: () => number;
}

/** Build the durable session-run store rooted at the daemon state root. Construction is INERT — no
 *  directory is created and no file is read until the first read or write. */
export function createSessionRunStore(stateRoot: string, deps: SessionRunStoreDeps = {}): SessionRunStore {
  if (!isAbsolute(stateRoot) || stateRoot.includes('\0')) fail('invalid-input', 'session run state root is invalid');
  const root = resolve(stateRoot);
  const now = deps.now ?? Date.now;
  let document: AtomicJsonDocument<SessionRunDocument> | null = null;

  const doc = (): AtomicJsonDocument<SessionRunDocument> => {
    if (document) return document;
    document = createAtomicJsonDocument<SessionRunDocument>({
      path: join(root, 'pty', 'session-runs.json'),
      empty: () => ({ schema: 'kb.pty-session-runs/v1', runs: [], archiveKeys: [] }),
      validate: assertDocument,
      error: (message) => new SessionRunStoreError('document-unavailable', message),
      maxBytes: MAX_DOCUMENT_BYTES,
    });
    return document;
  };

  /** Timestamps are monotonic per record: a clock that goes backwards must never make an end precede
   *  its own start, which would render as a negative duration in the UI. */
  const stampAfter = (previous: string | null): string => {
    const current = now();
    const floor = previous ? Date.parse(previous) : Number.NEGATIVE_INFINITY;
    return new Date(Math.max(current, floor + 1)).toISOString();
  };

  const findIndex = (state: SessionRunDocument, owner: string, ref: string): number =>
    state.runs.findIndex((entry) => entry.sessionRunRef === ref && entry.owner === owner);

  /** Retention: evict oldest TERMINAL records only. A `live` record is never dropped — the daemon is
   *  still responsible for the shell behind it. */
  const applyRetention = (state: SessionRunDocument): void => {
    while (state.runs.length > MAX_RETAINED_SESSION_RUNS) {
      const index = state.runs.findIndex((entry) => entry.outcome !== 'live');
      if (index < 0) break; // every retained record is live: keep them all, honestly over the cap
      const [dropped] = state.runs.splice(index, 1);
      if (dropped) {
        state.archiveKeys = state.archiveKeys.filter((entry) => entry.sessionRunRef !== dropped.sessionRunRef);
      }
    }
    while (state.archiveKeys.length > MAX_ARCHIVE_KEYS) state.archiveKeys.shift();
  };

  const requireOwner = (owner: unknown): string => {
    if (typeof owner !== 'string' || owner.length === 0) fail('invalid-input', 'session run owner is invalid');
    return owner;
  };

  const readState = (): SessionRunDocument => {
    try {
      return doc().read();
    } catch (error) {
      throw documentError(error);
    }
  };

  return {
    async create(input) {
      const owner = requireOwner(input.owner);
      if (input.kind !== 'agent' && input.kind !== 'workflow') {
        fail('invalid-input', 'session run kind is invalid');
      }
      if (typeof input.targetRef !== 'string' || input.targetRef.length === 0 || input.targetRef.length > 512) {
        fail('invalid-input', 'session run target reference is invalid');
      }
      if (input.ptySessionId !== null && (typeof input.ptySessionId !== 'string' || input.ptySessionId.length === 0)) {
        fail('invalid-input', 'session run pty session id is invalid');
      }
      const record: SessionRunRecord = {
        sessionRunRef: `srun-${randomUUID()}`,
        kind: input.kind,
        targetRef: input.targetRef,
        owner,
        ptySessionId: input.ptySessionId,
        primingPath: input.primingPath ?? null,
        startedAt: new Date(now()).toISOString(),
        endedAt: null,
        outcome: 'live',
        exitCode: null,
        transcript: null,
        version: 1,
      };
      try {
        await doc().mutate((state) => {
          state.runs.push(structuredClone(record));
          applyRetention(state);
        });
      } catch (error) {
        throw documentError(error);
      }
      return record;
    },

    async end(owner, sessionRunRef, input = {}) {
      const subject = requireOwner(owner);
      try {
        return await doc().mutate((state) => {
          const index = findIndex(state, subject, sessionRunRef);
          if (index < 0) return null;
          const entry = state.runs[index] as SessionRunRecord;
          // Terminal is terminal. A second gone-notification, or an end racing the boot sweep, must not
          // rewrite an outcome that has already been observed and reported.
          if (entry.outcome !== 'live') return structuredClone(entry);
          entry.outcome = 'ended';
          entry.endedAt = stampAfter(entry.startedAt);
          if (typeof input.exitCode === 'number' && Number.isFinite(input.exitCode)) entry.exitCode = input.exitCode;
          if (input.transcript !== undefined) entry.transcript = input.transcript;
          entry.version += 1;
          return structuredClone(entry);
        });
      } catch (error) {
        throw documentError(error);
      }
    },

    async stampExitCode(owner, sessionRunRef, exitCode) {
      const subject = requireOwner(owner);
      if (typeof exitCode !== 'number' || !Number.isFinite(exitCode)) return;
      try {
        await doc().mutate((state) => {
          const index = findIndex(state, subject, sessionRunRef);
          if (index < 0) return;
          const entry = state.runs[index] as SessionRunRecord;
          // Only ever fills an UNKNOWN. An exit code already recorded is the observed one and wins.
          if (entry.exitCode !== null) return;
          entry.exitCode = exitCode;
          entry.version += 1;
        });
      } catch (error) {
        throw documentError(error);
      }
    },

    async sweepAbandoned() {
      try {
        return await doc().mutate((state) => {
          let corrected = 0;
          for (const entry of state.runs) {
            if (entry.outcome !== 'live') continue;
            entry.outcome = 'abandoned';
            entry.endedAt = stampAfter(entry.startedAt);
            entry.version += 1;
            corrected += 1;
          }
          return corrected;
        });
      } catch (error) {
        throw documentError(error);
      }
    },

    async archive(owner, sessionRunRef, request) {
      const subject = requireOwner(owner);
      if (typeof request.idempotencyKey !== 'string' || request.idempotencyKey.length === 0
        || request.idempotencyKey.length > 512) {
        fail('invalid-input', 'session run idempotency key is invalid');
      }
      const reason = request.reason ?? null;
      if (reason !== null && (typeof reason !== 'string' || reason.length > 2_000)) {
        fail('invalid-input', 'session run archive reason is invalid');
      }
      try {
        return await doc().mutate<SessionRunArchiveResult>((state) => {
          const index = findIndex(state, subject, sessionRunRef);
          if (index < 0) return { ok: false, error: 'not-found' };
          const entry = state.runs[index] as SessionRunRecord;
          const priorKey = state.archiveKeys.find((key) => key.key === request.idempotencyKey);
          if (priorKey) {
            // Same key, same target, same words → a replay. Anything else reused the key for a
            // DIFFERENT decision, which is a conflict, never a silent second archive.
            if (priorKey.sessionRunRef !== sessionRunRef || priorKey.reason !== reason) {
              return { ok: false, error: 'idempotency-conflict' };
            }
            return { ok: true, value: structuredClone(entry), replayed: true };
          }
          // A live session must be KILLED first (the existing close path), which ends it and makes it
          // archivable. Dismissing a running shell from a list would leave an orphan nothing surfaces.
          if (entry.outcome === 'live') return { ok: false, error: 'session-run-live' };
          if (entry.outcome !== 'archived') {
            entry.outcome = 'archived';
            entry.endedAt = entry.endedAt ?? stampAfter(entry.startedAt);
            entry.version += 1;
          }
          state.archiveKeys.push({ key: request.idempotencyKey, sessionRunRef, reason });
          applyRetention(state);
          return { ok: true, value: structuredClone(entry), replayed: false };
        });
      } catch (error) {
        throw documentError(error);
      }
    },

    list(owner, options = {}) {
      const subject = requireOwner(owner);
      const includeArchived = options.includeArchived === true;
      return readState().runs
        .filter((entry) => entry.owner === subject && (includeArchived || entry.outcome !== 'archived'))
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .map((entry) => structuredClone(entry));
    },

    get(owner, sessionRunRef) {
      const subject = requireOwner(owner);
      const entry = readState().runs.find(
        (candidate) => candidate.sessionRunRef === sessionRunRef && candidate.owner === subject,
      );
      return entry ? structuredClone(entry) : null;
    },
  };
}
