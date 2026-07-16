import { describe, expect, it } from 'vitest';
import { joinToolResults } from './join';
import type { TranscriptRecord } from './tailer';

describe('joinToolResults', () => {
  it('joins tool_result.tool_use_id to tool_use.id', () => {
    const records: TranscriptRecord[] = [
      {
        type: 'assistant',
        message: {
          model: 'claude-x',
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a' } },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', is_error: false, content: 'file body' },
          ],
        },
      },
    ];

    const joined = joinToolResults(records);
    expect(joined).toHaveLength(1);
    expect(joined[0].id).toBe('toolu_1');
    expect(joined[0].name).toBe('Read');
    expect(joined[0].input).toEqual({ file_path: '/a' });
    expect(joined[0].result).not.toBeNull();
    expect(joined[0].result!.tool_use_id).toBe('toolu_1');
    expect(joined[0].result!.is_error).toBe(false);
    expect(joined[0].result!.content).toBe('file body');
  });

  it('leaves result null for a tool_use with no matching tool_result', () => {
    const records: TranscriptRecord[] = [
      {
        type: 'assistant',
        message: {
          model: 'm',
          content: [{ type: 'tool_use', id: 'toolu_orphan', name: 'Bash', input: {} }],
        },
      },
    ];
    const joined = joinToolResults(records);
    expect(joined).toHaveLength(1);
    expect(joined[0].result).toBeNull();
  });

  it('reads model from message.model and usage from message.usage', () => {
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
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'match' }],
        },
      },
    ];

    const joined = joinToolResults(records);
    expect(joined[0].model).toBe('claude-haiku-4-5-20251001');
    expect(joined[0].usage).toEqual(usage);
  });
});
