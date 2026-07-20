import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscriptRecord } from '../planeB/tailer.ts';
import { distill, renderTrace, tracePath } from './render.ts';

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
    const big = 'x'.repeat(2548);
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

  // A size threshold defends against BULK; the risk in a committed, pushed artifact is SENSITIVITY.
  // These tests pin that small payloads — the dangerous ones — are elided too.
  it('elides a SMALL tool_result from the rendered page (size is not the test)', async () => {
    const dir = await scratch();
    const path = join(dir, 'session.jsonl');
    // Synthetic stand-ins for the shapes that fit well under any threshold: a contact address and a
    // short numeric code. Both are far below the old 2048-byte cutoff and used to render verbatim.
    const secret = 'To: user@example.com — your verification code is 123456';
    await writeFile(
      path,
      jl({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'toolu_s', name: 'search_messages', input: { query: 'from:user@example.com' } }] },
      }) +
        jl({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_s', content: secret }] } }),
      'utf8',
    );

    const html = await renderTrace(path, 'card-small');

    expect(secret.length).toBeLessThan(2048); // guard: this really is a "small" payload
    expect(html).not.toContain('123456');
    expect(html).not.toContain('user@example.com');
    expect(html).not.toContain(secret);
    // ...and the tool INPUT is elided too: it carries the query and the recipient.
    expect(html).not.toContain('from:user@example.com');
    expect(html).toMatch(/distilled|elided/i);
  });

  it('elides small tool payloads in distill(), for results AND inputs', () => {
    const records: TranscriptRecord[] = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Read', input: { path: 'a.txt' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'small' }] } },
    ];
    const out = distill(records);
    const toolUse = (out[0].message!.content as Array<Record<string, unknown>>)[0];
    const result = (out[1].message!.content as Array<Record<string, unknown>>)[0];
    expect(result.content).not.toBe('small');
    expect(JSON.stringify(result.content)).toMatch(/distilled|elided/i);
    expect(JSON.stringify(toolUse.input)).not.toContain('a.txt');
    expect(JSON.stringify(toolUse.input)).toMatch(/distilled|elided/i);
  });

  it('keeps tool names, roles and turn structure ALIVE through elision', async () => {
    // The counterweight to the tests above: the fix must not degenerate into "render nothing".
    // Tool names and turn structure are the auditable content and must survive.
    const path = await writeSmallSession();
    const html = await renderTrace(path, 'card-structure');

    // The tool name survives IN ITS OWN SLOT. Asserting a bare `toContain('Read')` would be
    // satisfied by the prose "Reading it now." and would not notice the name being dropped.
    expect(html).toContain('<span class="tool-name">Read</span>');
    expect(html).toContain('Reading it now.');   // assistant prose survives
    expect(html).toContain('Done.');             // ...across turns
    expect(html).toContain('card-structure');
    // Both roles are still rendered as distinct turns.
    expect(html).toMatch(/class="turn assistant"/);
    expect(html).toMatch(/class="turn user"/);
    // A result DID arrive for the call — presence is auditable even though content is not shown.
    expect(html).toContain('class="result"');
    // But the payload itself is gone.
    expect(html).not.toContain('{"ok":true}');
    expect(html).not.toContain('config.json');
  });

  it('never renders hidden reasoning, only the fact that it occurred', async () => {
    const dir = await scratch();
    const path = join(dir, 'session.jsonl');
    await writeFile(
      path,
      jl({
        type: 'assistant',
        message: { content: [
          { type: 'thinking', thinking: 'the code in the mail was 123456 and the balance was 42' },
          { type: 'text', text: 'All set.' },
        ] },
      }),
      'utf8',
    );

    const html = await renderTrace(path, 'card-think');

    expect(html).not.toContain('123456');
    expect(html).not.toContain('balance was 42');
    expect(html).toContain('hidden reasoning omitted'); // structure survives
    expect(html).toContain('All set.');                 // visible prose survives
  });

  it('scrubs recognized credentials out of the prose that does survive', async () => {
    const dir = await scratch();
    const path = join(dir, 'session.jsonl');
    await writeFile(
      path,
      jl({ type: 'assistant', message: { content: [{ type: 'text', text: 'used ya29.aFAKEtokenvaluefortestingonly12345 to call it' }] } }),
      'utf8',
    );
    const html = await renderTrace(path, 'card-cred');
    expect(html).not.toContain('ya29.aFAKEtokenvaluefortestingonly12345');
    expect(html).toContain('[token redacted]');
  });

  it('path is traces/<card-id>/index.html (stable permalink shape)', () => {
    expect(tracePath('card-123')).toBe('traces/card-123/index.html');
  });
});
