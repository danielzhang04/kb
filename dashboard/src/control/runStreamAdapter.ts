import type { OperationalEventDto } from './controlClient';

/** A deliberately flat, safe projection of an operational event for the run lifecycle stream. */
export interface RunLifecycleRow {
  cursor: number;
  source: OperationalEventDto['source'];
  stageRef: string | null;
  attemptRef: string | null;
  sessionRef: string | null;
  status: OperationalEventDto['status'];
  label: string;
  summary: string | null;
  command: string | null;
  toolName: string | null;
  path: string | null;
  diff: string | null;
  checkpoint: string | null;
  createdAt: string;
}

function labelFor(event: OperationalEventDto): string {
  return event.summary ?? event.command ?? event.toolName ?? event.path ?? event.checkpoint ?? event.kind;
}

/** Maps every server event into a safe row without inventing transcript correlation identifiers. */
export function lifecycleRow(event: OperationalEventDto): RunLifecycleRow {
  return {
    cursor: event.cursor,
    source: event.source,
    stageRef: event.stageRef,
    attemptRef: event.attemptRef,
    sessionRef: event.sessionRef,
    status: event.status,
    label: labelFor(event),
    summary: event.summary,
    command: event.command,
    toolName: event.toolName,
    path: event.path,
    diff: event.diff,
    checkpoint: event.checkpoint,
    createdAt: event.createdAt,
  };
}

/** Full replay and reconnect batches fold through this same ordering/deduplication adapter. */
export function appendRunLifecycle(current: readonly RunLifecycleRow[], incoming: readonly OperationalEventDto[]): RunLifecycleRow[] {
  const byCursor = new Map(current.map((row) => [row.cursor, row]));
  for (const event of incoming) byCursor.set(event.cursor, lifecycleRow(event));
  return [...byCursor.values()].sort((left, right) => left.cursor - right.cursor);
}

export function replayRunLifecycle(events: readonly OperationalEventDto[]): RunLifecycleRow[] {
  return appendRunLifecycle([], events);
}
