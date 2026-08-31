import type { ArchivedFrom, AttemptSessionPublicRow, AttentionEnvelope, EntityStatus, RunOutcome, RunRow, RunnableRef, ScheduleOccurrence, SessionState } from './p2Contracts.ts';
import type { AttemptBinding, SessionRecord } from '../pty/contracts.ts';
import { projectRunAttention } from './attention.ts';
import type { RunStreamSource } from './runEventService.ts';
import type { RunLifecycleKind } from './runLifecycle.ts';

export interface ProjectableRunEvent {
  kind: 'tool' | 'message' | 'command' | 'file' | 'diff' | 'checkpoint' | 'lifecycle' | 'session-link' | 'governance';
  summary: string | null;
  createdAt: string;
}

export interface ProjectableRun {
  runRef: string;
  title: string;
  owner: RunnableRef;
  lifecycle: RunLifecycleKind;
  createdAt: string;
  updatedAt: string;
  terminalOutcome: RunOutcome | null;
  completedAt: string | null;
  archivedFrom: ArchivedFrom | null;
  openHumanRequestCount: number;
  events: readonly ProjectableRunEvent[];
  source?: RunStreamSource;
}

export interface RunActivityProjection {
  row: RunRow;
  category: 'attention' | 'active' | 'failed' | 'completed';
  elapsedMs: number;
  toolsCalled: number;
  lastLine: string;
  result: RunOutcome | null;
}

function assertNever(value: never): never { throw new Error(`unexpected run lifecycle: ${String(value)}`); }

function categoryFor(lifecycle: RunLifecycleKind): RunActivityProjection['category'] {
  switch (lifecycle) {
    case 'waiting-human': return 'attention';
    case 'planned':
    case 'recovering':
    case 'running':
    case 'stopping':
    case 'paused-for-deploy': return 'active';
    case 'interrupted': return 'failed';
    case 'succeeded':
    case 'failed':
    case 'stopped':
    case 'archived': return 'completed';
    default: return assertNever(lifecycle);
  }
}

export function projectRunActivity(run: ProjectableRun, now: string): RunActivityProjection {
  const latest = [...run.events].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const endedAt = run.completedAt ?? (categoryFor(run.lifecycle) === 'active' || categoryFor(run.lifecycle) === 'attention' ? now : run.updatedAt);
  const elapsedMs = Math.max(0, Date.parse(endedAt) - Date.parse(run.createdAt));
  const toolsCalled = run.events.filter((event) => event.kind === 'tool').length;
  const lastLine = latest?.summary ?? run.lifecycle;
  const common = { runRef: run.runRef, title: run.title, owner: run.owner, lifecycle: run.lifecycle, outcome: run.terminalOutcome, createdAt: run.createdAt, completedAt: run.completedAt, elapsedMs, toolsCalled, lastLine, gateBadge: run.openHumanRequestCount > 0 ? `${run.openHumanRequestCount} pending` : null };
  const row = run.source?.kind === 'pty'
    ? { ...common, streamKind: 'pty' as const, sessionId: run.source.sessionId }
    : { ...common, streamKind: 'transcript' as const };
  return {
    row,
    category: categoryFor(run.lifecycle),
    elapsedMs,
    toolsCalled,
    lastLine,
    result: run.terminalOutcome,
  };
}

/** A PTY session state that has not settled: the child is still on the host, so live control is possible. */
function sessionIsRunning(state: SessionState): boolean {
  return state === 'starting' || state === 'live' || state === 'closing';
}

/**
 * [C-M4] The Run's attempt sessions, exactly as the browser is allowed to see them, plus the ONE
 * session the Run view selects.
 *
 * Rows keep `AttemptBindingPort.byRun`'s durable append order and are never re-sorted by timestamp: two
 * attempts started inside one clock tick would otherwise swap places between reads and the operator's
 * attempt list would reorder itself under them.
 *
 * A binding whose session record is absent (evicted by the record cap, or a launcher this Run surface
 * does not project) contributes NO row — a placeholder would list an attempt the console could never
 * open. Nothing internal crosses: no operator, browser session ref, transcript path, epoch, managed
 * session ref, argv, env, or cwd.
 */
export function projectAttemptSessions(
  bindings: readonly AttemptBinding[],
  records: readonly SessionRecord[],
): AttemptSessionPublicRow[] {
  const byId = new Map(records.map((record) => [record.sessionId, record]));
  const attemptSessions: AttemptSessionPublicRow[] = [];
  for (const binding of bindings) {
    const record = byId.get(binding.sessionId);
    if (record === undefined) continue;
    if (record.launcher !== 'claude' && record.launcher !== 'codex') continue;
    attemptSessions.push({
      attemptRef: binding.attemptRef,
      sessionId: record.sessionId,
      launcher: record.launcher,
      state: record.state,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      exit: record.exit === null
        ? null
        : { exitCode: record.exit.exitCode, reason: record.exit.reason, observedAt: record.exit.observedAt },
      // `controllerClaimed` is whether SOME browser already holds this session's controller; `liveControl`
      // is whether live control is possible at all (the child is still running). They are independent:
      // an unclaimed live attempt is exactly the claimable case the Run view offers.
      controllerClaimed: record.controller !== null,
      liveControl: sessionIsRunning(record.state),
    });
  }
  return attemptSessions;
}

/**
 * The server's ONE selection rule over those rows (see above): the last running attempt, else the last
 * attempt, else null. It is server-side so the browser never has to agree with the console about which
 * attempt is "current" — it renders the id it was given.
 */
export function selectAttemptSessionId(rows: readonly AttemptSessionPublicRow[]): string | null {
  const running = [...rows].reverse().find((row) => sessionIsRunning(row.state));
  return running?.sessionId ?? rows.at(-1)?.sessionId ?? null;
}

function isActive(run: ProjectableRun): boolean { return categoryFor(run.lifecycle) === 'active'; }
function isAttention(run: ProjectableRun): boolean { return categoryFor(run.lifecycle) === 'attention'; }

function latestCompletedOutcome(runs: readonly ProjectableRun[]): RunOutcome | null {
  const completed = runs.filter((run) => run.completedAt !== null && run.terminalOutcome !== null)
    .sort((left, right) => right.completedAt!.localeCompare(left.completedAt!) || left.runRef.localeCompare(right.runRef));
  return completed[0]?.terminalOutcome ?? null;
}

export function projectRunStatus(runs: readonly ProjectableRun[], nextSchedule: ScheduleOccurrence | null): EntityStatus {
  if (runs.some(isAttention)) return 'needs-you';
  if (runs.some(isActive)) return 'running';
  const latest = latestCompletedOutcome(runs);
  if (runs.some((run) => run.lifecycle === 'interrupted') || latest === 'failed' || latest === 'interrupted' || latest === 'abandoned') return 'failed';
  if (nextSchedule !== null) return 'scheduled';
  return 'idle';
}

export function projectGateCounts(revision: string, runs: readonly ProjectableRun[]): AttentionEnvelope {
  return {
    ...projectRunAttention({
      runs: runs.map(({ runRef, owner, lifecycle }) => ({ runRef, owner, lifecycle })),
      humanRequests: runs.flatMap((run) => run.openHumanRequestCount > 0
        ? [{ requestRef: `${run.runRef}:open`, runRef: run.runRef, state: 'open' as const }]
        : []),
    }),
    revision,
  };
}
