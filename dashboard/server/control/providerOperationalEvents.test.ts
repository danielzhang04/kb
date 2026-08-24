import { describe, expect, it } from 'vitest';
import {
  mapCodexEventToPrivate,
  mapCodexStreamLine,
  mapStreamEventToPrivate,
  mapStreamLine,
} from './providerOperationalEvents.ts';

describe('Claude stream-json private projection', () => {
  it('maps a system init event to a lifecycle started event', () => {
    expect(mapStreamEventToPrivate({ type: 'system', subtype: 'init' })).toEqual([
      { kind: 'lifecycle', state: 'init', detail: null },
    ]);
  });

  it('maps assistant text and tool_use blocks, skipping unnameable tool_result blocks', () => {
    const events = mapStreamEventToPrivate({
      type: 'assistant',
      message: { content: [
        { type: 'text', text: 'hello there' },
        { type: 'tool_use', name: 'Read', input: {} },
      ] },
    });
    expect(events).toEqual([
      { kind: 'message', visible: true, text: 'hello there' },
      { kind: 'tool', name: 'Read', status: 'started' },
    ]);
    const toolResult = mapStreamEventToPrivate({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } });
    expect(toolResult).toEqual([]);
  });

  it('projects NOTHING from user-type events, even a top-level text block', () => {
    // Defence in depth against a wire-format change: today Claude Code delivers tool output as
    // `tool_result` blocks (skipped for lack of a tool name), but if it ever hoisted that output
    // into a top-level `text` block on a user message it would be persisted verbatim as an event
    // summary. Only `assistant` events narrate; user events are echoes of worker output.
    expect(mapStreamEventToPrivate({
      type: 'user',
      message: { content: [{ type: 'text', text: 'code 123456 for user@example.com' }] },
    })).toEqual([]);
    expect(mapStreamLine(JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'text', text: 'code 123456 for user@example.com' }] },
    }))).toEqual([]);
  });

  it('maps a success result to lifecycle succeeded and an error result to lifecycle failed', () => {
    expect(mapStreamEventToPrivate({ type: 'result', subtype: 'success', is_error: false, result: 'ok' }))
      .toEqual([{ kind: 'lifecycle', state: 'succeeded', detail: 'ok' }]);
    expect(mapStreamEventToPrivate({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'bad' }))
      .toEqual([{ kind: 'lifecycle', state: 'failed', detail: 'bad' }]);
  });

  it('fails closed on a result event missing subtype and is_error', () => {
    expect(mapStreamEventToPrivate({ type: 'result', result: 'unverified' }))
      .toEqual([{ kind: 'lifecycle', state: 'failed', detail: 'unverified' }]);
  });

  it('ignores unknown or malformed events', () => {
    expect(mapStreamEventToPrivate(null)).toEqual([]);
    expect(mapStreamEventToPrivate({ type: 'nonsense' })).toEqual([]);
  });
});

describe('mapStreamLine — redacted public projection', () => {
  it('parses a stream-json line into normalized public events', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'progressing' }] } });
    expect(mapStreamLine(line)).toEqual([{ kind: 'message', text: 'progressing' }]);
  });

  it('returns nothing for blank or malformed lines', () => {
    expect(mapStreamLine('')).toEqual([]);
    expect(mapStreamLine('{ not json')).toEqual([]);
  });
});

describe('Codex JSONL public projection', () => {
  it('maps the live-proven event shapes and redacts agent messages', () => {
    const rows = [
      { type: 'thread.started', thread_id: '019-thread' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'token sk-12345678901234567890' } },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 3, cached_input_tokens: 2 } },
    ];
    expect(rows.flatMap((row) => mapCodexStreamLine(JSON.stringify(row)))).toEqual([
      { kind: 'lifecycle', state: 'started', detail: null },
      { kind: 'lifecycle', state: 'turn-started', detail: null },
      { kind: 'message', text: 'token [token redacted]' },
      { kind: 'lifecycle', state: 'succeeded', detail: null },
    ]);
  });

  it('ignores malformed, unknown, and non-message item events', () => {
    expect(mapCodexStreamLine('{bad')).toEqual([]);
    expect(mapCodexEventToPrivate({ type: 'unknown' })).toEqual([]);
    expect(mapCodexEventToPrivate({ type: 'item.completed', item: { type: 'command_execution', command: 'secret' } })).toEqual([]);
  });

  it('maps a failed turn to a lifecycle failure carrying its error message', () => {
    expect(mapCodexEventToPrivate({ type: 'turn.failed', error: { message: 'provider rejected the turn' } }))
      .toEqual([{ kind: 'lifecycle', state: 'failed', detail: 'provider rejected the turn' }]);
  });
});
