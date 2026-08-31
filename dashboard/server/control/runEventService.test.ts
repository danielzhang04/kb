import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RUN_LIFECYCLE_KINDS } from './runLifecycle.ts';
import { createRunEventService, type RunEventSource } from './runEventService.ts';
import { createRunEventStream } from './runEventStream.ts';
import type { OperationalEvent } from './types.ts';
import { serializeRunEventFold } from '../../src/control/runEventRecords.ts';

const here = dirname(fileURLToPath(import.meta.url));
const transcriptDir = resolve(here, '__fixtures__', 'dv3', 'transcripts');

function event(cursor: number, summary: string, stageRef: string | null = null): OperationalEvent {
  return {
    cursor, runRef: 'run-1', kind: 'lifecycle', source: 'system', stageRef,
    attemptRef: null, sessionRef: null, status: null, summary, command: null,
    toolName: null, path: null, diff: null, checkpoint: null,
    createdAt: `2026-08-21T00:00:${String(cursor).padStart(2, '0')}.000Z`,
  };
}

function fixtureSources(name: 'claude' | 'codex'): RunEventSource[] {
  return readFileSync(resolve(transcriptDir, `${name}-real-sanitized.jsonl`), 'utf8')
    .trim().split(/\r?\n/)
    .map((rawLine, index) => ({
      kind: 'provider' as const,
      provider: name,
      cursor: (index + 1) * 10,
      runRef: `${name}-run`,
      stageRef: index % 2 === 0 ? 'stage-a' : 'stage-b',
      createdAt: `2026-08-21T00:00:${String(index).padStart(2, '0')}.000Z`,
      rawLine,
    }));
}

function serviceFor(sources: readonly RunEventSource[]) {
  return createRunEventService({
    readRunEventSources: async ({ runRef }) => sources.filter((source) =>
      source.kind === 'control' ? source.event.runRef === runRef : source.runRef === runRef),
  });
}

describe('run event replay service', () => {
  it('projects every imported lifecycle state and label into a transcript RunRow without mutation', async () => {
    const items = RUN_LIFECYCLE_KINDS.map((kind, index) => event(index + 1, kind));
    const original = structuredClone(items);
    const service = serviceFor(items.map((value) => ({ kind: 'control', event: value })));
    const rows = RUN_LIFECYCLE_KINDS.map((lifecycle, index) => service.projectRunRow({
      runRef: `run-${index}`,
      title: `Lifecycle ${lifecycle}`,
      owner: { type: 'agent', id: 'alpha', sourcePath: 'agents/alpha.md' },
      lifecycle,
      outcome: null,
      createdAt: '2026-08-21T00:00:00.000Z',
      completedAt: null,
      source: { kind: 'transcript' },
    }));
    const page = await service.replay({
      subject: 'operator', runRef: 'run-1', afterCursor: 0, limit: 20,
    });

    expect(rows.map((row) => ({ state: row.lifecycle, label: row.title }))).toEqual(
      RUN_LIFECYCLE_KINDS.map((state) => ({ state, label: `Lifecycle ${state}` })),
    );
    expect(rows.every((row) => row.streamKind === 'transcript' && !('sessionId' in row))).toBe(true);
    expect(page.items.map((item) => item.summary)).toEqual([...RUN_LIFECYCLE_KINDS]);
    expect(page.items.map((item) => item.cursor)).toEqual(items.map((item) => item.cursor * 1_000));
    expect(items).toEqual(original);
  });

  it('projects PTY and transcript stream identity from the run source kind', () => {
    const base = {
      runRef: 'run-stream-kind',
      title: 'Stream kind',
      owner: { type: 'agent' as const, id: 'alpha', sourcePath: 'agents/alpha.md' as const },
      lifecycle: 'running' as const,
      outcome: null,
      createdAt: '2026-08-21T00:00:00.000Z',
      completedAt: null,
    };
    const service = serviceFor([]);
    expect(service.projectRunRow({ ...base, source: { kind: 'pty', sessionId: 'pty-123' } })).toMatchObject({
      streamKind: 'pty', sessionId: 'pty-123',
    });
    const transcript = service.projectRunRow({ ...base, source: { kind: 'transcript' } });
    expect(transcript.streamKind).toBe('transcript');
    expect('sessionId' in transcript).toBe(false);
  });

  it('deduplicates duplicate cursors, filters one step, and returns a revisioned page', async () => {
    const sources: RunEventSource[] = [event(3, 'third', 'stage-b'), event(1, 'first', 'stage-a'), event(1, 'duplicate', 'stage-a')]
      .map((value) => ({ kind: 'control', event: value }));
    const page = await serviceFor(sources).replay({
      subject: 'operator', runRef: 'run-1', afterCursor: 0, limit: 10, stageRef: 'stage-a',
    });

    expect(page.items.map((item) => item.summary)).toEqual(['first']);
    expect(page.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(page.nextCursor).toBeNull();
  });

  it.each([['Claude', 'claude'], ['Codex', 'codex']] as const)('%s golden is sanitized and replays through the provider projector', async (_label, provider) => {
    const fixture = readFileSync(resolve(transcriptDir, `${provider}-real-sanitized.jsonl`), 'utf8');
    expect(fixture).not.toMatch(/(?:[A-Za-z]:[\\/])?Users[\\/]/i);
    expect(fixture).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(fixture).not.toMatch(/\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/);

    const page = await serviceFor(fixtureSources(provider)).replay({
      subject: 'operator', runRef: `${provider}-run`, afterCursor: 0, limit: 250,
    });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((item) => item.runRef === `${provider}-run`)).toBe(true);
  });

  it.each([
    ['Claude real golden', () => fixtureSources('claude'), 'claude-run'],
    ['Codex real golden', () => fixtureSources('codex'), 'codex-run'],
    ['unknown provider raw line', () => [{
      kind: 'provider' as const,
      provider: 'future-cli',
      cursor: 7,
      runRef: 'unknown-parity-run',
      stageRef: null,
      createdAt: '2026-08-21T00:00:00.000Z',
      rawLine: JSON.stringify({ type: 'future.event', text: 'safe reconnect fallback' }),
    }], 'unknown-parity-run'],
  ] as const)('%s is byte-equal across REST, SSE, and every reconnect fold', async (_label, makeSources, runRef) => {
    const service = serviceFor(makeSources());
    const stream = createRunEventStream(service);
    const rest = await service.replay({ subject: 'operator', runRef, afterCursor: 0, limit: 250 });
    const sse = await stream.replay({ subject: 'operator', runRef, afterCursor: 0, limit: 250 });
    const streamed = sse.frames.map((frame) => JSON.parse(frame.data) as OperationalEvent);
    const expectedBytes = serializeRunEventFold(rest.items);

    expect(JSON.stringify(streamed)).toBe(JSON.stringify(rest.items));
    expect(serializeRunEventFold(streamed)).toBe(expectedBytes);
    for (let acceptedCount = 0; acceptedCount <= rest.items.length; acceptedCount += 1) {
      const accepted = rest.items.slice(0, acceptedCount);
      const boundary = accepted.at(-1);
      const resumed = await stream.replay({
        subject: 'operator', runRef, afterCursor: boundary?.cursor ?? 0, limit: 250,
      });
      const resumedItems = resumed.frames.map((frame) => JSON.parse(frame.data) as OperationalEvent);
      const withDuplicateBoundary = boundary === undefined
        ? resumedItems
        : [...accepted, boundary, ...resumedItems];
      expect(serializeRunEventFold(withDuplicateBoundary)).toBe(expectedBytes);
    }
  });

  it('unknown provider falls back to one safe raw lifecycle line', async () => {
    const rawLine = JSON.stringify({ type: 'future.event', path: 'C:/Users/example/private.txt', email: 'person@example.com', token: 'sk-12345678901234567890' });
    const page = await serviceFor([{
      kind: 'provider', provider: 'future-cli', cursor: 7, runRef: 'unknown-run',
      stageRef: null, createdAt: '2026-08-21T00:00:00.000Z', rawLine,
    }]).replay({ subject: 'operator', runRef: 'unknown-run', afterCursor: 0, limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ kind: 'lifecycle', status: null });
    expect(page.items[0].summary).toContain('Unknown provider event');
    expect(page.items[0].summary).not.toMatch(/Users[\\/]|person@example\.com|sk-12345678901234567890/);
  });

  it('redacts credentials, emails, and user-home paths from stored control rows', async () => {
    const unsafe = {
      ...event(1, 'contact person@example.com with access_token=abc'),
      command: 'use sk-12345678901234567890',
      path: 'C:/Users/example/private.txt',
    };
    const page = await serviceFor([{ kind: 'control', event: unsafe }]).replay({
      subject: 'operator', runRef: 'run-1', afterCursor: 0, limit: 10,
    });
    expect(JSON.stringify(page)).not.toMatch(/person@example\.com|sk-12345678901234567890|Users[\\/]/);
  });

  it('redacts provider-mapped message text identically on replay and SSE', async () => {
    const rawLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'contact person@example.com under C:/Users/example/private.txt' }] },
    });
    const service = serviceFor([{
      kind: 'provider', provider: 'claude', cursor: 1, runRef: 'provider-run', stageRef: null,
      createdAt: '2026-08-21T00:00:00.000Z', rawLine,
    }]);
    const page = await service.replay({ subject: 'operator', runRef: 'provider-run', afterCursor: 0, limit: 10 });
    const streamed = await createRunEventStream(service).replay({
      subject: 'operator', runRef: 'provider-run', afterCursor: 0, limit: 10,
    });
    const wireItems = streamed.frames.map((frame) => JSON.parse(frame.data) as OperationalEvent);
    expect(JSON.stringify(page.items)).not.toMatch(/person@example\.com|Users[\\/]/);
    expect(JSON.stringify(wireItems)).toBe(JSON.stringify(page.items));
  });

  it('reserves cursor space for multi-event provider lines beside the next source', async () => {
    const rawLine = JSON.stringify({
      type: 'assistant',
      message: { content: [
        { type: 'text', text: 'first provider event' },
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
      ] },
    });
    const sources: RunEventSource[] = [
      {
        kind: 'provider', provider: 'claude', cursor: 1, runRef: 'cursor-run', stageRef: null,
        createdAt: '2026-08-21T00:00:00.000Z', rawLine,
      },
      { kind: 'control', event: { ...event(2, 'adjacent source'), runRef: 'cursor-run' } },
    ];
    const service = serviceFor(sources);
    const page = await service.replay({ subject: 'operator', runRef: 'cursor-run', afterCursor: 0, limit: 10 });
    const stream = await createRunEventStream(service).replay({
      subject: 'operator', runRef: 'cursor-run', afterCursor: 0, limit: 10,
    });
    expect(page.items.map((item) => item.cursor)).toEqual([1_000, 1_001, 2_000]);
    expect(new Set(stream.frames.map((frame) => frame.id)).size).toBe(3);
  });

  it('keeps one full-stream revision across paging and step-filter views', async () => {
    const sources = [event(1, 'first', 'stage-a'), event(2, 'second', 'stage-b'), event(3, 'third', 'stage-a')]
      .map((value) => ({ kind: 'control' as const, event: value }));
    const service = serviceFor(sources);
    const first = await service.replay({ subject: 'operator', runRef: 'run-1', afterCursor: 0, limit: 1 });
    const second = await service.replay({
      subject: 'operator', runRef: 'run-1', afterCursor: first.items[0]!.cursor, limit: 1, stageRef: 'stage-a',
    });
    expect(first.revision).toBe(second.revision);
  });

  it('rejects a source cursor that cannot fit the composite cursor space', async () => {
    const tooLarge = Math.floor(Number.MAX_SAFE_INTEGER / 1_000) + 1;
    await expect(serviceFor([{ kind: 'control', event: event(tooLarge, 'overflow') }]).replay({
      subject: 'operator', runRef: 'run-1', afterCursor: 0, limit: 10,
    })).rejects.toThrow(/composite range/);
  });
});
