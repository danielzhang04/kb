import { describe, expect, it } from 'vitest';
import { foldRecords } from './timelineModel';
import type { SubagentInput } from './timelineModel';
import type { TranscriptRecord } from '../../server/planeB/tailer';

describe('foldRecords', () => {
  it('folds records into ordered turns with attached tool results', () => {
    const records: TranscriptRecord[] = [
      {
        type: 'assistant',
        message: {
          model: 'claude-x',
          content: [
            { type: 'thinking', thinking: 'consider the read' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a' } },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: false, content: 'file body' }],
        },
      },
      {
        type: 'assistant',
        message: {
          model: 'claude-x',
          content: [
            { type: 'text', text: 'now run it' },
            { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'a\nb' }],
        },
      },
    ];

    const model = foldRecords(records);
    // Two assistant turns, in order.
    expect(model.turns).toHaveLength(2);
    expect(model.turns[0].index).toBe(0);
    expect(model.turns[1].index).toBe(1);

    // Turn 0: thinking step then a tool_use step whose result is attached by tool_use_id.
    const t0 = model.turns[0];
    expect(t0.steps.map((s) => s.kind)).toEqual(['thinking', 'tool_use']);
    expect(t0.steps[0].text).toBe('consider the read');
    const use0 = t0.steps[1];
    expect(use0.toolUseId).toBe('toolu_1');
    expect(use0.name).toBe('Read');
    expect(use0.input).toEqual({ file_path: '/a' });
    expect(use0.result).not.toBeNull();
    expect(use0.result!.toolUseId).toBe('toolu_1');
    expect(use0.result!.isError).toBe(false);
    expect(use0.result!.content).toBe('file body');

    // Turn 1: text step then a Bash tool_use with its result.
    const t1 = model.turns[1];
    expect(t1.steps.map((s) => s.kind)).toEqual(['text', 'tool_use']);
    expect(t1.steps[0].text).toBe('now run it');
    expect(t1.steps[1].result!.content).toBe('a\nb');
  });

  it('nests subagent turns under the spawning Task by toolUseId', () => {
    const records: TranscriptRecord[] = [
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [{ type: 'tool_use', id: 'toolu_task1', name: 'Task', input: { subagent_type: 'Explore' } }],
        },
      },
    ];
    const subagents: SubagentInput[] = [
      {
        meta: { agentType: 'Explore', description: 'scout the tree', toolUseId: 'toolu_task1', spawnDepth: 1, model: 'sonnet' },
        records: [
          {
            type: 'assistant',
            message: { model: 'sonnet', content: [{ type: 'text', text: 'sub work done' }] },
          },
        ],
      },
    ];

    const model = foldRecords(records, subagents);
    const taskStep = model.turns[0].steps.find((s) => s.toolUseId === 'toolu_task1');
    expect(taskStep).toBeDefined();
    expect(taskStep!.subagent).not.toBeNull();
    expect(taskStep!.subagent!.agentType).toBe('Explore');
    expect(taskStep!.subagent!.spawnDepth).toBe(1);
    expect(taskStep!.subagent!.turns).toHaveLength(1);
    expect(taskStep!.subagent!.turns[0].steps[0].text).toBe('sub work done');
  });

  it('surfaces per-turn tokens from message.usage', () => {
    const usage = {
      input_tokens: 10,
      output_tokens: 844,
      cache_creation_input_tokens: 20496,
      cache_read_input_tokens: 21060,
    };
    const records: TranscriptRecord[] = [
      {
        type: 'assistant',
        message: {
          model: 'claude-haiku-4-5-20251001',
          usage,
          content: [{ type: 'tool_use', id: 'toolu_2', name: 'Grep', input: { pattern: 'x' } }],
        },
      },
    ];

    const model = foldRecords(records);
    const u = model.turns[0].usage;
    expect(u).not.toBeNull();
    expect(u!.inputTokens).toBe(10);
    expect(u!.outputTokens).toBe(844);
    expect(u!.cacheCreationInputTokens).toBe(20496);
    expect(u!.cacheReadInputTokens).toBe(21060);
    expect(u!.totalTokens).toBe(10 + 844 + 20496 + 21060);
  });
});
