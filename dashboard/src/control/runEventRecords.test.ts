import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRunEventService, type RunEventSource } from '../../server/control/runEventService.ts';
import { createRunEventStream } from '../../server/control/runEventStream.ts';
import type { OperationalEvent } from '../../server/control/types.ts';
import { orderedRunEventRecords, serializeRunEventFold } from './runEventRecords.ts';

const transcriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'control', '__fixtures__', 'dv3', 'transcripts');

function event(cursor: number, stageRef: string | null, kind: OperationalEvent['kind'] = 'message'): OperationalEvent {
  return {
    cursor, runRef: 'run-1', kind, source: 'worker', stageRef, attemptRef: null, sessionRef: null,
    status: kind === 'tool' ? 'success' : null, summary: kind === 'message' ? `message ${cursor}` : null,
    command: null, toolName: kind === 'tool' ? 'Read' : null, path: null, diff: null, checkpoint: null,
    createdAt: `2026-08-21T00:00:0${cursor}.000Z`,
  };
}

describe('run event record projection', () => {
  it('orders, deduplicates, and step-filters the same event source', () => {
    expect(orderedRunEventRecords([event(3, 'b'), event(1, 'a'), event(1, 'a'), event(2, 'b')], 'b')
      .map((item) => item.cursor)).toEqual([2, 3]);
  });

  it('folds messages and tools through the existing TimelineModel fold', () => {
    const serialized = serializeRunEventFold([event(1, null), event(2, null, 'tool')]);
    expect(JSON.parse(serialized)).toMatchObject({ turns: [
      { steps: [{ kind: 'text', text: 'message 1' }] },
      { steps: [{ kind: 'tool_use', name: 'Read', result: expect.objectContaining({ isError: false }) }] },
    ] });
  });

  it.each([['Claude', 'claude'], ['Codex', 'codex']] as const)('%s golden REST and SSE item folds are byte-equal', async (_label, provider) => {
    const sources: RunEventSource[] = readFileSync(resolve(transcriptDir, `${provider}-real-sanitized.jsonl`), 'utf8')
      .trim().split(/\r?\n/).map((rawLine, index) => ({
        kind: 'provider', provider, cursor: (index + 1) * 10, runRef: 'golden-run', stageRef: null,
        createdAt: `2026-08-21T00:00:${String(index).padStart(2, '0')}.000Z`, rawLine,
      }));
    const service = createRunEventService({ readRunEventSources: async () => sources });
    const page = await service.replay({
      subject: 'operator', runRef: 'golden-run', afterCursor: 0, limit: 250,
    });
    const streamed = await createRunEventStream(service).replay({
      subject: 'operator', runRef: 'golden-run', afterCursor: 0, limit: 250,
    });
    const sseRoundTrip = streamed.frames.map((frame) => JSON.parse(frame.data) as OperationalEvent);
    expect(serializeRunEventFold(sseRoundTrip)).toBe(serializeRunEventFold(page.items));
  });

  it('unknown provider raw lifecycle line folds as inert visible text', async () => {
    const page = await createRunEventService({
      readRunEventSources: async () => [{
        kind: 'provider', provider: 'future-cli', cursor: 1, runRef: 'future-run', stageRef: null,
        createdAt: '2026-08-21T00:00:00.000Z',
        rawLine: JSON.stringify({ type: 'future.event', text: 'safe fallback' }),
      }],
    }).replay({ subject: 'operator', runRef: 'future-run', afterCursor: 0, limit: 10 });
    expect(serializeRunEventFold(page.items)).toContain('Unknown provider event');
  });
});
