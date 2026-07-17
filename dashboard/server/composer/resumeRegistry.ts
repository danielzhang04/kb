/**
 * C1 / review-F1 — the issued-CLI-session allowlist that binds `--resume` to THIS daemon.
 *
 * WHY: Composer's continuing turns pass a CLI `session_id` back to `claude --resume`. A well-formed
 * UUID shape check (at the route boundary) stops traversal/flag-shaped ids, but a *syntactically valid*
 * UUID that this process never issued is still not something we should resume — resuming an arbitrary
 * session id lets a caller reach a session-file resolver / another operator's live session. So the
 * server only ever resumes a session id it CAPTURED from a real `system` init record during this process
 * lifetime, recorded against the verified WebAuthn SUBJECT (`claims.sub`) that captured it. A resume
 * whose (subject, id) pair was never issued is refused BEFORE any spawn.
 *
 * The store is a per-instance `Map<subject, Set<sessionId>>` — NOT a module singleton — so it is
 * injected via DI (one instance lives on the SurfaceContext for the whole process; every test gets its
 * own fresh instance). This mirrors the pending-challenge store's spirit while avoiding global mutable
 * state that would leak across tests.
 *
 * In-memory + unbounded-per-process is acceptable here for the same reason the pending-challenge store
 * is single-process: this daemon is one process, ids are only added as real turns are spawned, and the
 * set is naturally bounded by how many turns an authenticated operator actually runs. (A hard size cap
 * is out of scope for this review — see F3, inherited from the vibe surface.)
 */

/** The issued-session allowlist: record ids as they are captured, check them before a resume. */
export interface ResumeRegistry {
  /** Record that `sessionId` was issued (captured from a `system` init record) for `subject`. */
  record(subject: string, sessionId: string): void;
  /** True iff `sessionId` was previously issued for `subject` this process lifetime. */
  isIssued(subject: string, sessionId: string): boolean;
}

/** Build a fresh, isolated {@link ResumeRegistry}. One per process (on the SurfaceContext); one per test. */
export function createResumeRegistry(): ResumeRegistry {
  const bySubject = new Map<string, Set<string>>();
  return {
    record(subject, sessionId) {
      if (!subject || !sessionId) return;
      let set = bySubject.get(subject);
      if (!set) {
        set = new Set<string>();
        bySubject.set(subject, set);
      }
      set.add(sessionId);
    },
    isIssued(subject, sessionId) {
      return bySubject.get(subject)?.has(sessionId) ?? false;
    },
  };
}

/**
 * A well-formed CLI session id — a canonical UUID. `--resume` MUST be handed one of these; anything
 * else (traversal-shaped `../…`, flag-shaped `--foo`, empty) is refused at the route boundary BEFORE a
 * spawn, so a malformed value can never reach the `claude` child as an argv token.
 */
export const RESUME_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** True iff `value` is a well-formed CLI session id (canonical UUID). */
export function isValidResumeId(value: unknown): value is string {
  return typeof value === 'string' && RESUME_ID_PATTERN.test(value);
}
