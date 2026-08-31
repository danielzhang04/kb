import type { TranscriptRecord } from '../../server/planeB/record.ts';
import type { RunEventPage } from '../../server/control/p2Contracts.ts';
import { foldRecords, type TimelineModel } from '../lib/timelineModel.ts';

type RunEvent = RunEventPage['items'][number];
const MAX_RENDERED_DIFF_CHARS = 2_000;

export function orderedRunEventRecords(
  events: readonly RunEvent[],
  stageRef: string | null = null,
): RunEvent[] {
  const ordered = [...events].sort((left, right) => left.cursor - right.cursor);
  const byCursor = new Map<number, RunEvent>();
  for (const event of ordered) {
    if (stageRef !== null && event.stageRef !== stageRef) continue;
    if (!byCursor.has(event.cursor)) byCursor.set(event.cursor, event);
  }
  return [...byCursor.values()];
}

function label(event: RunEvent): string {
  return event.summary ?? event.command ?? event.toolName ?? event.path ?? event.checkpoint ?? event.kind;
}

function transcriptRecords(event: RunEvent): TranscriptRecord[] {
  if (event.kind === 'tool') {
    const toolUseId = `run-event-${event.cursor}`;
    const assistant: TranscriptRecord = {
      type: 'assistant',
      timestamp: event.createdAt,
      message: {
        content: [{ type: 'tool_use', id: toolUseId, name: event.toolName ?? 'tool', input: { omitted: true } }],
      },
    };
    const result: TranscriptRecord = {
      type: 'user',
      timestamp: event.createdAt,
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseId,
          is_error: event.status === 'failure' || event.status === 'interrupted' || event.status === 'stopped',
          content: event.summary ?? event.status ?? 'recorded',
        }],
      },
    };
    return [assistant, result];
  }
  if (event.kind === 'file' || event.kind === 'diff'
    || event.kind === 'checkpoint' || event.kind === 'lifecycle') {
    const diff = event.diff ?? null;
    const record = {
      type: 'assistant',
      timestamp: event.createdAt,
      message: { content: [{
        type: 'run_event',
        kind: event.kind,
        text: label(event),
        path: event.path,
        diff: diff === null ? null : diff.slice(0, MAX_RENDERED_DIFF_CHARS),
        status: event.status,
        checkpoint: event.checkpoint,
        truncated: diff !== null && diff.length > MAX_RENDERED_DIFF_CHARS,
      }] },
    };
    return [record as unknown as TranscriptRecord];
  }
  return [{
    type: 'assistant',
    timestamp: event.createdAt,
    message: { content: [{ type: 'text', text: label(event) }] },
  }];
}

export function foldRunEventRecords(events: readonly RunEvent[], stageRef: string | null = null): TimelineModel {
  return foldRecords(orderedRunEventRecords(events, stageRef).flatMap(transcriptRecords));
}

export function serializeRunEventFold(events: readonly RunEvent[], stageRef: string | null = null): string {
  return JSON.stringify(foldRunEventRecords(events, stageRef));
}
