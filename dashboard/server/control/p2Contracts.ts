import type { OperationalEvent } from './types.ts';
import type { RunLifecycleKind } from './runLifecycle.ts';

/** Immutable reference constructed by the server from a declared runnable. */
export type RunnableRef =
  | { type: 'agent'; id: string; sourcePath: `agents/${string}.md` }
  | { type: 'workflow'; id: string; project: string; sourcePath: `orgs/${string}/workflows/${string}.md` };

export type RunOutcome = 'ok' | 'failed' | 'stopped' | 'interrupted' | 'abandoned';
export type ArchivedFrom = 'succeeded' | 'failed' | 'stopped' | 'interrupted' | 'waiting-human';
export type EntityStatus = 'running' | 'needs-you' | 'failed' | 'idle' | 'scheduled';
export type HostKind = 'vm' | 'desktop';

/** P2 persistence fields; W6.1 attaches these to Run and StoredRun atomically. */
export interface RunIdentityFields {
  owner: RunnableRef;
  executionHost: HostKind;
  terminalOutcome: RunOutcome | null;
  completedAt: string | null;
  archivedFrom: ArchivedFrom | null;
}

/** Canonical browser/server run transport. Display fields are server projections, never persisted. */
export interface ControlRunDto extends RunIdentityFields {
  runRef: string;
  predecessorRunRef: string | null;
  title: string;
  displayName: string;
  shortRef: number;
  workflowRef: string | null;
  proposalRef: string;
  proposalRevision: number;
  proposalHash: string;
  publicationState: 'pending' | 'waiting-human' | 'publishing' | 'published' | 'reconcile-required';
  state: 'planned' | 'recovering' | 'running' | 'waiting-human' | 'stopping'
    | 'succeeded' | 'failed' | 'stopped' | 'interrupted' | 'archived';
  version: number;
  managerSessionRef: string;
  managerGeneration: number;
  managerAssignment: {
    agentId: string;
    declarationPath: string;
    declarationHash: string;
    profileId: string;
    runtime: string;
    model: string;
  } | null;
  agentWorkspaceLaunch?: {
    composerRef: string;
    agentId: string;
    declarationPath: string;
    declarationHash: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/** One run row used by entity, attention, and Home projections. */
export interface RunRow {
  runRef: string;
  title: string;
  owner: RunnableRef;
  lifecycle: RunLifecycleKind;
  outcome: RunOutcome | null;
  createdAt: string;
  completedAt: string | null;
  streamKind: 'pty' | 'transcript';
  sessionId?: string;
  elapsedMs?: number;
  toolsCalled?: number;
  lastLine?: string;
  gateBadge?: string | null;
}

/** A schedule fire projected for cards and Home. */
export interface ScheduleOccurrence {
  scheduleId: string;
  scheduledFor: string;
  nextAt: string;
  owner: RunnableRef;
}

/** Safe, server-projected output target. */
export type OutputRef =
  | { kind: 'repository-file'; label: string; path: string }
  | { kind: 'artifact'; label: string; path: string }
  | { kind: 'external-pr'; label: string; owner: string; repository: string; number: number };

/** Ordered, redacted control-stream page for replay and SSE parity. */
export interface RunEventPage {
  revision: string;
  items: OperationalEvent[];
  nextCursor: number | null;
}

/** One distinct Run/owner pair contributing to a noun's attention count. */
export interface AttentionPair {
  runRef: string;
  owner: RunnableRef;
}

export interface AttentionEnvelope {
  revision: string;
  pairs: AttentionPair[];
  agents: Record<string, number>;
  workflows: Record<string, number>;
}

/** Entity card projection fixed by the Dashboard v3 design. */
export interface EntitySummary {
  ref: RunnableRef;
  humanName: string;
  status: EntityStatus;
  modelLabel: string;
  temporalLabel: string;
  host: HostKind;
  gatedRunCount: number;
  activeRuns: RunRow[];
  latestRun: RunOutcome | null;
  nextSchedule: ScheduleOccurrence | null;
}

/** Stored schedule projection fixed by the Dashboard v3 design. */
export interface Schedule {
  id: string;
  owner: RunnableRef;
  cadence: { source: string; words: string };
  nextAt: string | null;
  lastOutcome: RunOutcome | null;
  armed: boolean;
  origin: 'seed' | 'operator';
  mirroredAt: string | null;
  mirrorPath: 'HEARTBEAT.md' | `orgs/${string}/HEARTBEAT.md`;
  version: number;
}
