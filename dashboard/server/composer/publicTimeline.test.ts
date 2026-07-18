import { describe, expect, it } from 'vitest';
import { publicTimeline, redactSensitiveText } from './publicTimeline.ts';

describe('Composer public timeline policy', () => {
  it('removes hidden reasoning and arbitrary tool payloads while retaining operational shape', () => {
    const model = publicTimeline({ turns: [{
      index: 0,
      model: 'claude-sonnet-5',
      timestamp: null,
      usage: null,
      steps: [
        { kind: 'thinking', text: 'private reasoning' },
        { kind: 'text', text: 'visible answer' },
        {
          kind: 'tool_use',
          toolUseId: 'tool-1',
          name: 'Read',
          input: { path: '.env', api_key: 'unregistered-secret-canary' },
          result: { toolUseId: 'tool-1', isError: false, content: 'PASSWORD=hunter2' },
          subagent: null,
        },
      ],
    }] });
    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain('private reasoning');
    expect(serialized).not.toContain('.env');
    expect(serialized).not.toContain('unregistered-secret-canary');
    expect(serialized).not.toContain('hunter2');
    expect(model.turns[0].steps).toMatchObject([
      { kind: 'text', text: 'visible answer' },
      { kind: 'tool_use', name: 'Read', input: { omitted: true }, result: { isError: false } },
    ]);
  });

  it('redacts common credentials and two-part dashboard bearers without mangling ordinary UUIDs', () => {
    const bearer = `eyJzdWIiOiJvcGVyYXRvciIsImlhdCI6MTcwMDAwMDAwMDAwMH0.${'A'.repeat(43)}`;
    const text = redactSensitiveText(
      `api_key=secret-value sk-abcdefghijklmnopqrstuvwxyz ${bearer} 123e4567-e89b-42d3-a456-426614174000`,
    );
    expect(text).not.toContain('secret-value');
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(text).not.toContain(bearer);
    expect(text).toContain('123e4567-e89b-42d3-a456-426614174000');
  });
});
