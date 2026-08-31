/**
 * THE frozen `kb.pty-session-runs/v1` document shape.
 *
 * Since W6.3 the session-run store writes the `legacyRuns` array of the v2 document, so NOTHING in the
 * codebase can produce a v1 document any more. That makes the v1 shape a contract with the past that only
 * a pinned fixture can hold: every test that needs a v1 document imports this one constant, so a drift in
 * what "v1" means shows up as one failing import site rather than as three hand-typed literals quietly
 * disagreeing with each other.
 *
 * Frozen deeply and exported as the single source: a test that mutates it would rewrite history for every
 * other test in the run.
 */

/** One live row, one ended row with a transcript, one archived row plus its idempotency key. */
export const PTY_SESSIONS_V1_LIVE_RUN = {
  sessionRunRef: 'srun-11111111-1111-4111-8111-111111111111',
  kind: 'agent',
  targetRef: 'builder-live',
  owner: 'alice',
  ptySessionId: `pty-${'1'.repeat(32)}`,
  primingPath: 'priming/live.md',
  startedAt: '2026-08-23T11:00:00.000Z',
  endedAt: null,
  outcome: 'live',
  exitCode: null,
  transcript: null,
  version: 1,
} as const;

export const PTY_SESSIONS_V1_ENDED_RUN = {
  sessionRunRef: 'srun-22222222-2222-4222-8222-222222222222',
  kind: 'workflow',
  targetRef: 'ended-workflow',
  owner: 'alice',
  ptySessionId: `pty-${'2'.repeat(32)}`,
  primingPath: 'priming/ended.md',
  startedAt: '2026-08-23T11:00:01.000Z',
  endedAt: '2026-08-23T11:00:02.000Z',
  outcome: 'ended',
  exitCode: 7,
  transcript: { path: 'pty/transcripts/ended.log', bytes: 12, truncated: false },
  version: 2,
} as const;

export const PTY_SESSIONS_V1_ARCHIVED_RUN = {
  sessionRunRef: 'srun-33333333-3333-4333-8333-333333333333',
  kind: 'agent',
  targetRef: 'archived-agent',
  owner: 'alice',
  ptySessionId: null,
  primingPath: null,
  startedAt: '2026-08-23T11:00:03.000Z',
  endedAt: '2026-08-23T11:00:04.000Z',
  outcome: 'archived',
  exitCode: null,
  transcript: null,
  version: 3,
} as const;

/** The whole document, exactly as it sat at `<stateRoot>/pty/session-runs.json` under v1. */
export const PTY_SESSIONS_V1_DOCUMENT = {
  schema: 'kb.pty-session-runs/v1',
  runs: [PTY_SESSIONS_V1_LIVE_RUN, PTY_SESSIONS_V1_ENDED_RUN, PTY_SESSIONS_V1_ARCHIVED_RUN],
  archiveKeys: [
    { key: 'archive-one', sessionRunRef: PTY_SESSIONS_V1_ARCHIVED_RUN.sessionRunRef, reason: 'done' },
  ],
} as const;

/** The relative on-disk location of the v1 document, pinned beside its shape. */
export const PTY_SESSIONS_V1_RELATIVE_PATH = ['pty', 'session-runs.json'] as const;

/** A deep, mutable-shaped copy for a test that needs to perturb one field before writing it. */
export function ptySessionsV1Document(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(PTY_SESSIONS_V1_DOCUMENT)) as Record<string, unknown>;
}
