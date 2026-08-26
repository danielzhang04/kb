import { sha256Hex } from '../shared/hashing.ts';
import {
  mapCodexStreamLine,
  mapStreamLine as mapClaudeStreamLine,
} from './providerOperationalEvents.ts';
import type { RunEventPage, RunRow } from './p2Contracts.ts';
import type { PublicOperationalEvent } from './publicEvents.ts';
import { redactSensitiveText } from '../composer/publicTimeline.ts';

type RunEvent = RunEventPage['items'][number];

export type RunEventSource =
  | { kind: 'control'; event: RunEvent }
  | {
      kind: 'provider';
      provider: string;
      cursor: number;
      runRef: string;
      stageRef: string | null;
      createdAt: string;
      rawLine: string;
    };

export interface ReadRunEventSourcesInput {
  subject: string;
  runRef: string;
  scope?: 'own-subject' | 'all-subjects';
}

export interface RunEventInvalidationSource {
  subscribe(listener: () => void): () => void;
  release(): void;
}

export interface RunEventSourcePort {
  readRunEventSources(input: ReadRunEventSourcesInput): readonly RunEventSource[] | Promise<readonly RunEventSource[]>;
  openRunEventSource?(input: ReadRunEventSourcesInput): RunEventInvalidationSource;
}

export interface ReplayRunEventsInput extends ReadRunEventSourcesInput {
  afterCursor?: number;
  limit?: number;
  stageRef?: string | null;
}

export type RunStreamSource =
  | { kind: 'pty'; sessionId: string }
  | { kind: 'transcript' };

export interface ProjectRunRowInput extends Omit<RunRow, 'streamKind' | 'sessionId'> {
  source: RunStreamSource;
}

export interface RunEventService {
  projectRunRow(input: ProjectRunRowInput): RunRow;
  replay(input: ReplayRunEventsInput): Promise<RunEventPage>;
  openLive(input: ReadRunEventSourcesInput): RunEventInvalidationSource;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const USER_HOME = /(?:[A-Za-z]:[\\/])?Users[\\/][^\\/\s"'<>]+(?:[\\/][^\s"'<>]+)*/gi;
const MAX_PUBLIC_TEXT = 8_000;
const CURSOR_STRIDE = 1_000;
const MAX_SOURCE_CURSOR = Math.floor((Number.MAX_SAFE_INTEGER - (CURSOR_STRIDE - 1)) / CURSOR_STRIDE);

function safeText(value: string): string {
  return redactSensitiveText(value)
    .replace(EMAIL, '[email redacted]')
    .replace(USER_HOME, '[user-path]')
    .replace(/\0/g, '')
    .slice(0, MAX_PUBLIC_TEXT);
}

function safeNullable(value: string | null): string | null {
  return value === null ? null : safeText(value);
}

function compositeCursor(sourceCursor: number, index: number): number {
  if (!Number.isSafeInteger(sourceCursor) || sourceCursor < 0 || sourceCursor > MAX_SOURCE_CURSOR) {
    throw new Error('event source cursor exceeds composite range');
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= CURSOR_STRIDE) {
    throw new Error('event source expands beyond reserved cursor space');
  }
  return sourceCursor * CURSOR_STRIDE + index;
}

function statusOf(status: 'started' | 'succeeded' | 'failed'): RunEvent['status'] {
  if (status === 'started') return 'running';
  return status === 'succeeded' ? 'success' : 'failure';
}

function publicEventToRunEvent(
  event: PublicOperationalEvent,
  source: Extract<RunEventSource, { kind: 'provider' }>,
  cursor: number,
): RunEvent {
  const base: RunEvent = {
    cursor,
    runRef: source.runRef,
    kind: 'lifecycle',
    source: 'worker',
    stageRef: source.stageRef,
    attemptRef: null,
    sessionRef: null,
    status: null,
    summary: null,
    command: null,
    toolName: null,
    path: null,
    diff: null,
    checkpoint: null,
    createdAt: source.createdAt,
  };
  switch (event.kind) {
    case 'message':
      return { ...base, kind: 'message', summary: event.text };
    case 'session':
      return {
        ...base, kind: 'session-link', sessionRef: event.sessionRef,
        summary: `${event.role} session ${event.state}`,
      };
    case 'command':
      return { ...base, kind: 'command', command: event.label, path: event.path, status: statusOf(event.status) };
    case 'tool':
      return { ...base, kind: 'tool', toolName: event.name, status: statusOf(event.status) };
    case 'file':
      return { ...base, kind: 'file', path: event.path, summary: event.operation, status: 'success' };
    case 'diff':
      return { ...base, kind: 'diff', path: event.path, summary: event.summary };
    case 'checkpoint':
      return {
        ...base, kind: 'checkpoint', checkpoint: event.name,
        status: event.state === 'blocked' ? 'waiting' : 'success', summary: event.state,
      };
    case 'lifecycle':
      return {
        ...base, kind: 'lifecycle',
        status: event.state === 'succeeded' ? 'success' : event.state === 'failed' ? 'failure' : null,
        summary: event.detail ? `${event.state}: ${event.detail}` : event.state,
      };
  }
}

function sanitizedControlEvent(event: RunEvent): RunEvent {
  return {
    ...event,
    summary: safeNullable(event.summary),
    command: safeNullable(event.command),
    toolName: safeNullable(event.toolName),
    path: safeNullable(event.path),
    diff: safeNullable(event.diff),
    checkpoint: safeNullable(event.checkpoint),
  };
}

function parsedType(rawLine: string): string | null {
  try {
    const parsed = JSON.parse(rawLine) as { type?: unknown };
    return typeof parsed.type === 'string' ? parsed.type : null;
  } catch {
    return null;
  }
}

function providerEvents(source: Extract<RunEventSource, { kind: 'provider' }>): RunEvent[] {
  if (parsedType(source.rawLine) === 'fixture-provenance') return [];
  const normalized = source.provider === 'claude'
    ? mapClaudeStreamLine(source.rawLine)
    : source.provider === 'codex'
      ? mapCodexStreamLine(source.rawLine)
      : null;
  if (normalized === null) {
    const raw = safeText(source.rawLine);
    return [sanitizedControlEvent({
      cursor: compositeCursor(source.cursor, 0),
      runRef: source.runRef,
      kind: 'lifecycle',
      source: 'system',
      stageRef: source.stageRef,
      attemptRef: null,
      sessionRef: null,
      status: null,
      summary: `Unknown provider event (${source.provider}): ${raw}`,
      command: null,
      toolName: null,
      path: null,
      diff: null,
      checkpoint: null,
      createdAt: source.createdAt,
    })];
  }
  return normalized.map((event, index) => sanitizedControlEvent(
    publicEventToRunEvent(event, source, compositeCursor(source.cursor, index)),
  ));
}

function normalizedSources(sources: readonly RunEventSource[]): RunEvent[] {
  const projected = sources.flatMap((source) => source.kind === 'control'
    ? [{ ...sanitizedControlEvent(source.event), cursor: compositeCursor(source.event.cursor, 0) }]
    : providerEvents(source));
  projected.sort((left, right) => left.cursor - right.cursor);
  const byCursor = new Map<number, RunEvent>();
  for (const event of projected) {
    if (!byCursor.has(event.cursor)) byCursor.set(event.cursor, event);
  }
  return [...byCursor.values()];
}

function revisionOf(items: readonly RunEvent[]): string {
  return sha256Hex(JSON.stringify(items));
}

export function createRunEventService(port: RunEventSourcePort): RunEventService {
  return {
    projectRunRow(input) {
      const { source, ...row } = input;
      return source.kind === 'pty'
        ? { ...row, streamKind: 'pty', sessionId: source.sessionId }
        : { ...row, streamKind: 'transcript' };
    },
    async replay(input) {
      const afterCursor = input.afterCursor ?? 0;
      const limit = input.limit ?? 250;
      if (!Number.isSafeInteger(afterCursor) || afterCursor < 0) throw new Error('event cursor must be non-negative');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) throw new Error('event limit must be 1-250');
      const sources = await port.readRunEventSources({
        subject: input.subject, runRef: input.runRef, scope: input.scope,
      });
      const fullStream = normalizedSources(sources).filter((event) => event.runRef === input.runRef);
      const matching = fullStream
        .filter((event) => event.cursor > afterCursor)
        .filter((event) => input.stageRef == null || event.stageRef === input.stageRef);
      const items = matching.slice(0, limit);
      return {
        revision: revisionOf(fullStream),
        items,
        nextCursor: matching.length > limit ? items.at(-1)?.cursor ?? null : null,
      };
    },
    openLive(input) {
      return port.openRunEventSource?.(input) ?? {
        subscribe: () => () => undefined,
        release: () => undefined,
      };
    },
  };
}
