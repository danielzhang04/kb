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

/** One run row used by entity, attention, and Home projections. */
export interface RunRow {
  runRef: string;
  title: string;
  owner: RunnableRef;
  lifecycle: RunLifecycleKind;
  outcome: RunOutcome | null;
  createdAt: string;
  completedAt: string | null;
}

/** A schedule fire projected for cards and Home. */
export interface ScheduleOccurrence {
  scheduleId: string;
  scheduledFor: string;
  nextAt: string;
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
export interface AttentionItem {
  runRef: string;
  owner: RunnableRef;
}

export interface AttentionEnvelope {
  revision: string;
  items: AttentionItem[];
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
