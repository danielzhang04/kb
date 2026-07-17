import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscriptRecord } from '../planeB/tailer.ts';
import { DISTILL_THRESHOLD_BYTES, distill, renderTrace, tracePath } from './render.ts';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'trace-render-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

function jl(obj: unknown): string {
  return JSON.stringify(obj) + '\n';
}

/** A transcript with a small tool_use/tool_result pair and a bit of prose. */
async function writeSmallSession(): Promise<string> {
  const dir = await scratch();
  const path = join(dir, 'session.jsonl');
  const lines = [
    jl({ type: 'user', message: { content: 'please read the config' } }),
    jl({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-8',
        usage: { input_tokens: 12, output_tokens: 34 },
        content: [
          { type: 'text', text: 'Reading it now.' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: 'config.json' } },
        ],
      },
    }),
    jl({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' }] },
    }),
    jl({ type: 'assistant', message: { model: 'claude-opus-4-8', content: [{ type: 'text', text: 'Done.' }] } }),
  ];
  await writeFile(path, lines.join(''), 'utf8');
  return path;
}

describe('renderTrace', () => {
  it('renders a self-contained HTML with no external asset refs', async () => {
    const path = await writeSmallSession();
    const html = await renderTrace(path, 'card-abc');

    // A whole, offline-openable document with INLINE styling only.
    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html).toContain('<style>');
    // No external assets of any kind: no stylesheet links, no external scripts, no http(s) asset URLs.
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\s+src=/i);
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/i);
    // The card id is surfaced as the permalink identity.
    expect(html).toContain('card-abc');
  });

  it('renders all transcript text inert (escaped), like the D0.5 sanitizer', async () => {
    const dir = await scratch();
    const path = join(dir, 'session.jsonl');
    await writeFile(
      path,
      jl({ type: 'assistant', message: { content: [{ type: 'text', text: '<script>alert(1)</script>' }] } }),
      'utf8',
    );
    const html = await renderTrace(path, 'card-evil');
    // The renderer emits ZERO live <script> markup; transcript text is escaped, not interpreted.
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('distill drops raw tool payloads over the size threshold, keeps turn structure', () => {
    const big = 'x'.repeat(DISTILL_THRESHOLD_BYTES + 500);
    const records: TranscriptRecord[] = [
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'toolu_big', name: 'Read', input: { path: 'a' } }] },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_big', content: big }] },
      },
    ];

    const out = distill(records);

    // Turn structure preserved: same record count, same types, tool ids intact.
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe('assistant');
    expect(out[1].type).toBe('user');
    const toolUse = (out[0].message!.content as Array<Record<string, unknown>>)[0];
    expect(toolUse.type).toBe('tool_use');
    expect(toolUse.id).toBe('toolu_big');

    // The oversize tool_result payload is elided to a summary, not carried raw.
    const result = (out[1].message!.content as Array<Record<string, unknown>>)[0];
    const serialized = JSON.stringify(result.content);
    expect(serialized).not.toContain(big);
    expect(serialized.length).toBeLessThan(big.length);
    expect(serialized).toMatch(/distilled|elided/i);
  });

  it('distill keeps small payloads untouched', () => {
    const records: TranscriptRecord[] = [
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'small' }] } },
    ];
    const out = distill(records);
    const result = (out[0].message!.content as Array<Record<string, unknown>>)[0];
    expect(result.content).toBe('small');
  });

  it('path is traces/<card-id>/index.html (stable permalink shape)', () => {
    expect(tracePath('card-123')).toBe('traces/card-123/index.html');
  });
});
