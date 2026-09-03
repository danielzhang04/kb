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
 *   shell exit / kill  → `end` writes `ended` and attaches the flushed transcript, driven by the
 *                        registry's OBSERVED exit, which fires exactly once.
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
 * These records are the LEGACY arrays of the one v3 PTY document (`kb.pty-sessions/v3`, spec [C-M3]):
 * `legacyRuns` and `legacyArchiveKeys`. There is exactly one document, one lock and one revision
 * counter for the whole PTY stack, injected as a {@link SessionPersistence} port — this store no longer
 * owns a file, a schema, or a validator of its own, so a session run and a v2 session record can never
 * disagree about the document they both live in. Every mutation goes through `persistence.mutate`, which
 * validates the whole v3 document and applies the shared retention caps before publishing it.
 *
 * A daemon that still has a v1 `kb.pty-session-runs/v1` document on disk migrates it through W3's
 * `sessionMigration` (byte-for-byte `.v1.bak` first; ambiguity aborts and leaves v1 authoritative). The
 * composition root injects that as `deps.migrate`; this store awaits it EXACTLY ONCE, lazily, before its
 * first document write — so constructing the store still touches no filesystem.
 *
 * Every read is owner-scoped. A ref belonging to another operator is reported as `not-found`, never as
 * "forbidden" — an existence oracle across operators would be its own leak.
 */
import { randomUUID } from 'node:crypto';
import type { PtySessionsDocumentV3 } from './contracts.ts';
import type { SessionPersistence } from './sessionPersistence.ts';

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
  /** What the one-shot v1 -> v2 migration did, for Health. Closed and synchronous: it reports the state
   *  already reached, never starts a migration, and never touches the filesystem. */
  migrationState(): SessionRunMigrationState;
}

/** `pending` = not attempted yet (nothing has written); `ok` = migrated, or nothing to migrate; refused =
 *  W3's migration threw and the store is fail-closed for the rest of the process lifetime. The refusal
 *  code is a CLOSED literal on purpose: the underlying error's message may name paths, so it never
 *  reaches a caller — `document-unavailable` is all the store will ever say about why. */
export type SessionRunMigrationState = 'pending' | 'ok' | { refused: 'document-unavailable' };

export interface SessionRunStoreDeps {
  /** Injectable clock so tests get deterministic timestamps. */
  now?: () => number;
  /**
   * W3's v1 -> v2 migration, injected by the composition root (`http/surface.ts`). Awaited EXACTLY ONCE,
   * lazily, before the first document write — never at construction, so building a surface context still
   * touches no filesystem. A migration that refuses (ambiguous v1 input) leaves v1 authoritative and the
   * refusal surfaces here as `document-unavailable`: the store never guesses past a refused migration.
   */
  migrate?: () => Promise<unknown>;
}

/** Build the durable session-run store over the one injected v3 PTY document port. Construction is
 *  INERT — no directory is created and no file is read until the first read or write. */
export function createSessionRunStore(
  persistence: SessionPersistence,
  deps: SessionRunStoreDeps = {},
): SessionRunStore {
  const now = deps.now ?? Date.now;
  let migrated: Promise<unknown> | null = null;
  // No injected migration means there is nothing to migrate — `ok`, not `pending`, so Health does not
  // report a permanently-unresolved migration on a daemon that never had a v1 document.
  let migrationOutcome: SessionRunMigrationState = deps.migrate === undefined ? 'ok' : 'pending';

  /** One migration per process, awaited before the first write; a failure is re-thrown to every caller. */
  const ensureMigrated = async (): Promise<void> => {
    if (deps.migrate === undefined) return;
    // The outcome is recorded on the memoized promise itself, so the refusal survives for the process
    // lifetime exactly as long as the cached rejection that keeps refusing every subsequent write.
    migrated ??= deps.migrate().then(
      (value) => { migrationOutcome = 'ok'; return value; },
      (error: unknown) => { migrationOutcome = { refused: 'document-unavailable' }; throw error; },
    );
    await migrated;
  };

  /** Every write is one v3 document revision. `null` = accept whatever revision is current: session runs
   *  are appended/patched by ref, never compare-and-set against the shared PTY revision counter. */
  const mutate = async <R>(callback: (document: PtySessionsDocumentV3) => R): Promise<R> => {
    await ensureMigrated();
    const { value } = await persistence.mutate(null, callback);
    return value;
  };

  /** Timestamps are monotonic per record: a clock that goes backwards must never make an end precede
   *  its own start, which would render as a negative duration in the UI. */
  const stampAfter = (previous: string | null): string => {
    const current = now();
    const floor = previous ? Date.parse(previous) : Number.NEGATIVE_INFINITY;
    return new Date(Math.max(current, floor + 1)).toISOString();
  };

  const findIndex = (state: PtySessionsDocumentV3, owner: string, ref: string): number =>
    state.legacyRuns.findIndex((entry) => entry.sessionRunRef === ref && entry.owner === owner);

  const requireOwner = (owner: unknown): string => {
    if (typeof owner !== 'string' || owner.length === 0) fail('invalid-input', 'session run owner is invalid');
    return owner;
  };

  const readState = (): PtySessionsDocumentV3 => {
    try {
      return persistence.read();
    } catch (error) {
      throw documentError(error);
    }
  };

  return {
    migrationState: () => migrationOutcome,

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
        // Retention (live rows never evicted, orphaned archive keys dropped) is enforced for the whole
        // v3 document by `enforcePtySessionRetention` inside `persistence.mutate`.
        await mutate((state) => {
          state.legacyRuns.push(structuredClone(record));
        });
      } catch (error) {
        throw documentError(error);
      }
      return record;
    },

    async end(owner, sessionRunRef, input = {}) {
      const subject = requireOwner(owner);
      try {
        return await mutate((state) => {
          const index = findIndex(state, subject, sessionRunRef);
          if (index < 0) return null;
          const entry = state.legacyRuns[index] as SessionRunRecord;
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
        await mutate((state) => {
          const index = findIndex(state, subject, sessionRunRef);
          if (index < 0) return;
          const entry = state.legacyRuns[index] as SessionRunRecord;
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
        return await mutate((state) => {
          let corrected = 0;
          for (const entry of state.legacyRuns) {
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
        return await mutate<SessionRunArchiveResult>((state) => {
          const index = findIndex(state, subject, sessionRunRef);
          if (index < 0) return { ok: false, error: 'not-found' };
          const entry = state.legacyRuns[index] as SessionRunRecord;
          const priorKey = state.legacyArchiveKeys.find((key) => key.key === request.idempotencyKey);
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
          state.legacyArchiveKeys.push({ key: request.idempotencyKey, sessionRunRef, reason });
          return { ok: true, value: structuredClone(entry), replayed: false };
        });
      } catch (error) {
        throw documentError(error);
      }
    },

    list(owner, options = {}) {
      const subject = requireOwner(owner);
      const includeArchived = options.includeArchived === true;
      return readState().legacyRuns
        .filter((entry) => entry.owner === subject && (includeArchived || entry.outcome !== 'archived'))
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .map((entry) => structuredClone(entry));
    },

    get(owner, sessionRunRef) {
      const subject = requireOwner(owner);
      const entry = readState().legacyRuns.find(
        (candidate) => candidate.sessionRunRef === sessionRunRef && candidate.owner === subject,
      );
      return entry ? structuredClone(entry) : null;
    },
  };
}
