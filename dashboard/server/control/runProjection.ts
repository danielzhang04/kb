import type { ArchivedFrom, AttentionEnvelope, EntityStatus, RunOutcome, RunRow, RunnableRef, ScheduleOccurrence } from './p2Contracts.ts';
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
  const row = run.source?.kind === 'pty'
    ? { runRef: run.runRef, title: run.title, owner: run.owner, lifecycle: run.lifecycle, outcome: run.terminalOutcome, createdAt: run.createdAt, completedAt: run.completedAt, streamKind: 'pty' as const, sessionId: run.source.sessionId }
    : { runRef: run.runRef, title: run.title, owner: run.owner, lifecycle: run.lifecycle, outcome: run.terminalOutcome, createdAt: run.createdAt, completedAt: run.completedAt, streamKind: 'transcript' as const };
  return {
    row,
    category: categoryFor(run.lifecycle),
    elapsedMs: Math.max(0, Date.parse(endedAt) - Date.parse(run.createdAt)),
    toolsCalled: run.events.filter((event) => event.kind === 'tool').length,
    lastLine: latest?.summary ?? run.lifecycle,
    result: run.terminalOutcome,
  };
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
