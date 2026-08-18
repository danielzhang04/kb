/**
 * U6 — `readEnvelope` over a synthetic transcript (the `render.test.ts` `jl()` idiom) AND over a
 * TRIMMED, SCRUBBED slice of a real kb session (`__fixtures__/real-run-slice.jsonl`), so the real
 * on-disk record shape — not just a hand-written one — is proven to parse.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvelope } from './envelope.ts';

const REAL_SLICE = fileURLToPath(new URL('./__fixtures__/real-run-slice.jsonl', import.meta.url));

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'trace-envelope-'));
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

async function writeSession(name: string, lines: string[]): Promise<string> {
  const dir = await scratch();
  const path = join(dir, name);
  await writeFile(path, lines.join(''), 'utf8');
  return path;
}

/** Three tool calls: one clean, one errored, one never answered. */
async function writeMixedSession(): Promise<string> {
  return writeSession('87d8aef2-1111-2222-3333-444455556666.jsonl', [
    jl({ type: 'user', timestamp: '2026-08-18T10:00:00.000Z', message: { content: 'go' } }),
    jl({
      type: 'assistant',
      timestamp: '2026-08-18T10:00:01.000Z',
      message: {
        model: 'claude-opus-5',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 5,
          // Provider extras that must NOT survive the projection.
          service_tier: 'standard',
          inference_geo: 'not_available',
          server_tool_use: { web_search_requests: 0 },
          iterations: [{ input_tokens: 10, type: 'message' }],
        },
        content: [
          { type: 'text', text: 'reading' },
          { type: 'tool_use', id: 'toolu_ok', name: 'Read', input: { file_path: '/secret/place.txt' } },
        ],
      },
    }),
    jl({
      type: 'user',
      timestamp: '2026-08-18T10:00:03.500Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_ok', content: 'top secret bytes' }] },
    }),
    jl({
      type: 'assistant',
      timestamp: '2026-08-18T10:00:04.000Z',
      message: {
        model: 'claude-sonnet-5',
        content: [{ type: 'tool_use', id: 'toolu_err', name: 'Bash', input: { command: 'rm -rf /' } }],
      },
    }),
    jl({
      type: 'user',
      timestamp: '2026-08-18T10:00:05.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_err', is_error: true, content: 'denied' }] },
    }),
    jl({
      type: 'assistant',
      timestamp: '2026-08-18T10:00:06.000Z',
      message: { model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: 'toolu_pending', name: 'Write', input: {} }] },
    }),
  ]);
}

describe('readEnvelope', () => {
  it('derives the session id from the file name and counts every tool step', async () => {
    const path = await writeMixedSession();
    const env = await readEnvelope(path);
    expect(env.sessionId).toBe('87d8aef2-1111-2222-3333-444455556666');
    expect(env.stepCount).toBe(3);
    expect(env.steps.map((s) => s.name)).toEqual(['Read', 'Bash', 'Write']);
    expect(env.steps.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('accepts an explicit session id override', async () => {
    const path = await writeMixedSession();
    const env = await readEnvelope(path, 'given-id');
    expect(env.sessionId).toBe('given-id');
  });

  it('carries model, usage and result state per step', async () => {
    const env = await readEnvelope(await writeMixedSession());
    const [ok, err, pending] = env.steps;
    expect(ok.model).toBe('claude-opus-5');
    expect(ok.hasResult).toBe(true);
    expect(err.hasResult).toBe(true);
    expect(pending.hasResult).toBe(false);
    expect(pending.usage).toBeNull();
  });

  it('PROJECTS usage field by field — provider extras never travel through', async () => {
    const env = await readEnvelope(await writeMixedSession());
    const [ok] = env.steps;
    // Exactly the allowlisted numeric counters, nothing else — an equality assertion, so a new
    // provider field cannot slip through unnoticed.
    expect(ok.usage).toEqual({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 });
    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain('service_tier');
    expect(serialized).not.toContain('inference_geo');
    expect(serialized).not.toContain('server_tool_use');
    expect(serialized).not.toContain('iterations');
  });

  it('drops a usage object that carries no numeric counter at all', async () => {
    const path = await writeSession('no-usage.jsonl', [
      jl({
        type: 'assistant',
        timestamp: '2026-08-18T10:00:00.000Z',
        message: {
          model: 'claude-opus-5',
          usage: { service_tier: 'standard', input_tokens: 'twelve' },
          content: [{ type: 'tool_use', id: 'toolu_x', name: 'Read', input: {} }],
        },
      }),
    ]);
    const env = await readEnvelope(path);
    expect(env.steps[0].usage).toBeNull();
  });

  it('keeps isError TRI-STATE: true, absent-on-clean-result, absent-on-missing-result', async () => {
    const env = await readEnvelope(await writeMixedSession());
    const [ok, err, pending] = env.steps;
    expect(err.isError).toBe(true);
    expect(ok.isError).toBeUndefined();
    expect(pending.isError).toBeUndefined();
  });

  it('computes durations from record timestamps, and null when the pair is incomplete', async () => {
    const env = await readEnvelope(await writeMixedSession());
    const [ok, err, pending] = env.steps;
    expect(ok.startedAt).toBe('2026-08-18T10:00:01.000Z');
    expect(ok.endedAt).toBe('2026-08-18T10:00:03.500Z');
    expect(ok.durationMs).toBe(2500);
    expect(err.durationMs).toBe(1000);
    expect(pending.endedAt).toBeNull();
    expect(pending.durationMs).toBeNull();
  });

  it('ELIDES payloads entirely — no tool input or result byte reaches the envelope', async () => {
    const env = await readEnvelope(await writeMixedSession());
    for (const step of env.steps) {
      expect(step).not.toHaveProperty('input');
      expect(step).not.toHaveProperty('result');
      expect(step).not.toHaveProperty('content');
    }
    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain('/secret/place.txt');
    expect(serialized).not.toContain('top secret bytes');
    expect(serialized).not.toContain('rm -rf /');
  });

  it('is JSON-serializable and round-trips unchanged', async () => {
    const env = await readEnvelope(await writeMixedSession());
    expect(JSON.parse(JSON.stringify(env))).toEqual(JSON.parse(JSON.stringify(env)));
    expect(JSON.parse(JSON.stringify(env)).steps).toHaveLength(3);
  });

  it('is empty-safe on a transcript with no tool calls', async () => {
    const path = await writeSession('empty.jsonl', [
      jl({ type: 'user', timestamp: '2026-08-18T10:00:00.000Z', message: { content: 'hello' } }),
    ]);
    const env = await readEnvelope(path);
    expect(env.stepCount).toBe(0);
    expect(env.steps).toEqual([]);
  });

  it('handles the REAL session slice: real record shape, attachment record skipped', async () => {
    const env = await readEnvelope(REAL_SLICE);
    expect(env.sessionId).toBe('real-run-slice');
    expect(env.stepCount).toBe(3);
    expect(env.steps.map((s) => s.name)).toEqual(['Glob', 'Glob', 'Write']);
    expect(env.steps.every((s) => s.model === 'claude-sonnet-5')).toBe(true);
    // The real slice's usage blob carries `service_tier`, `iterations[]`, `speed`, … — the projection
    // keeps only the counters.
    expect(Object.keys(env.steps[0].usage ?? {}).sort()).toEqual([
      'cache_creation_input_tokens',
      'cache_read_input_tokens',
      'input_tokens',
      'output_tokens',
    ]);
    expect(env.steps.every((s) => s.hasResult)).toBe(true);
    // Third step's tool_result carried is_error: true; the first two carried no flag at all.
    expect(env.steps.map((s) => s.isError)).toEqual([undefined, undefined, true]);
    // Real timestamps produce real (positive) durations.
    expect(env.steps[0].durationMs).toBeGreaterThan(0);
  });
});
