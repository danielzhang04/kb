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

  // Google OAuth credentials — the Gmail/Drive/Calendar connectors mint these, and none of the
  // vendor-prefix patterns (sk-, ghp_, AKIA, xox*) or the JWT pattern match them.
  it('redacts Google OAuth access tokens (ya29.)', () => {
    const token = 'ya29.a0AfB_byFAKEtokenvalueForTestingOnly1234567890abcdef';
    const out = redactSensitiveText(`Authorization: Bearer ${token}`);
    expect(out).not.toContain(token);
    expect(out).not.toContain('ya29.');
    expect(out).toContain('[token redacted]');
  });

  it('redacts Google OAuth refresh tokens (1//)', () => {
    const token = '1//0gFAKErefreshTokenValueForTestingOnly1234567890abcd';
    const out = redactSensitiveText(`refresh_token=${token}`);
    expect(out).not.toContain(token);
    expect(out).toContain('redacted');
  });

  it('does NOT mangle ordinary prose or URLs that merely contain "1//"', () => {
    // The `1//` prefix is only three characters and appears in normal text; the pattern must need
    // a long high-entropy run after it, or it becomes a corruption bug rather than a control.
    const prose = 'Section 1// of the report covers 2026 revenue, see https://example.com/docs/1//index.html for detail.';
    expect(redactSensitiveText(prose)).toBe(prose);
    // Short runs stay untouched too — well below the entropy floor a real token clears.
    const shortRun = 'build 1//abc123 finished';
    expect(redactSensitiveText(shortRun)).toBe(shortRun);
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
