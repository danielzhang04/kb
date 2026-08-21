import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { serializeRunEventFold } from '../../src/control/runEventRecords.ts';
import { createRunEventService, type RunEventSource } from './runEventService.ts';
import { createRunEventStream } from './runEventStream.ts';
import type { OperationalEvent } from './types.ts';

const transcriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'dv3', 'transcripts');

function event(cursor: number): OperationalEvent {
  return {
    cursor, runRef: 'run-1', kind: cursor % 2 ? 'message' : 'tool', source: 'worker',
    stageRef: null, attemptRef: null, sessionRef: null, status: cursor % 2 ? null : 'success',
    summary: cursor % 2 ? `line ${cursor}` : null, command: null,
    toolName: cursor % 2 ? null : 'Read', path: null, diff: null, checkpoint: null,
    createdAt: `2026-08-21T00:00:0${cursor}.000Z`,
  };
}

function sourceFixture(provider: 'claude' | 'codex'): RunEventSource[] {
  return readFileSync(resolve(transcriptDir, `${provider}-real-sanitized.jsonl`), 'utf8').trim().split(/\r?\n/)
    .map((rawLine, index) => ({
      kind: 'provider', provider, cursor: (index + 1) * 10, runRef: `${provider}-run`,
      stageRef: null, createdAt: `2026-08-21T00:00:${String(index).padStart(2, '0')}.000Z`, rawLine,
    }));
}

function streamFor(sources: readonly RunEventSource[]) {
  const service = createRunEventService({ readRunEventSources: async () => sources });
  return createRunEventStream(service);
}

describe('run event SSE stream', () => {
  it('Last-Event-ID replay skips accepted rows and duplicate cursor frames', async () => {
    const sources = [event(1), event(2), event(2), event(3)].map((value) => ({ kind: 'control' as const, event: value }));
    const result = await streamFor(sources).replay({
      subject: 'operator', runRef: 'run-1', afterCursor: 0, limit: 10, lastEventId: '1000',
    });

    expect(result.frames.map((frame) => frame.id)).toEqual([2_000, 3_000]);
    expect(result.frames[0].wire).toMatch(/^id: 2000\nevent: run-event\ndata: /);
  });

  it.each([['Claude', 'claude'], ['Codex', 'codex']] as const)('%s golden reconnect is byte-equal to uninterrupted replay', async (_label, provider) => {
    const sources = sourceFixture(provider);
    const stream = streamFor(sources);
    const full = await stream.replay({ subject: 'operator', runRef: `${provider}-run`, afterCursor: 0, limit: 250 });
    const splitAt = full.frames[Math.max(0, Math.floor(full.frames.length / 2) - 1)]?.id ?? 0;
    const firstItems = full.page.items.filter((item) => item.cursor <= splitAt);
    const resumed = await stream.replay({
      subject: 'operator', runRef: `${provider}-run`, afterCursor: 0, limit: 250, lastEventId: String(splitAt),
    });
    const resumedItems = resumed.frames.map((frame) => JSON.parse(frame.data) as OperationalEvent);

    expect(serializeRunEventFold([...firstItems, ...resumedItems])).toBe(serializeRunEventFold(full.page.items));
    expect(resumedItems.every((item) => item.cursor > splitAt)).toBe(true);
  });
});
