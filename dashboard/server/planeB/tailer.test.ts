import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { tailFrom, parseRecord, SKIP_RECORD_TYPES } from './tailer';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'planeb-tailer-'));
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

describe('tailFrom (byte-offset incremental tailer)', () => {
  it('resumes from a byte offset and never re-reads the head', async () => {
    const dir = await scratch();
    const path = join(dir, 'session.jsonl');
    const head =
      jl({ type: 'user', message: { content: 'one' } }) +
      jl({ type: 'assistant', message: { model: 'm', content: [] } }) +
      jl({ type: 'user', message: { content: 'three' } });
    await writeFile(path, head, 'utf8');

    const first = await tailFrom(path, 0);
    expect(first.records).toHaveLength(3);
    expect(first.nextOffset).toBe(Buffer.byteLength(head, 'utf8'));

    // Append two more lines and resume from the recorded offset.
    const more =
      jl({ type: 'assistant', message: { model: 'm2', content: [] } }) +
      jl({ type: 'user', message: { content: 'five' } });
    await appendFile(path, more, 'utf8');

    const second = await tailFrom(path, first.nextOffset);
    // Only the NEW records surface — the head is not re-read.
    expect(second.records).toHaveLength(2);
    expect((second.records[0] as { message: { model: string } }).message.model).toBe('m2');
    expect((second.records[1] as { message: { content: string } }).message.content).toBe('five');
    expect(second.nextOffset).toBe(Buffer.byteLength(head + more, 'utf8'));
  });

  it('carries a partial-line remainder across reads', async () => {
    const dir = await scratch();
    const path = join(dir, 'session.jsonl');
    const complete = jl({ type: 'user', message: { content: 'done' } });
    const partial = '{"type":"assistant","messa';
    await writeFile(path, complete + partial, 'utf8');

    const first = await tailFrom(path, 0);
    // Only the complete newline-terminated line is parsed; the fragment is held back.
    expect(first.records).toHaveLength(1);
    expect(first.remainder).toBe(partial);
    // nextOffset points at the START of the partial line so it is re-read once completed.
    expect(first.nextOffset).toBe(Buffer.byteLength(complete, 'utf8'));

    // Complete the fragment with an append.
    await appendFile(path, 'ge":{"model":"late"}}\n', 'utf8');
    const second = await tailFrom(path, first.nextOffset);
    expect(second.records).toHaveLength(1);
    expect((second.records[0] as { message: { model: string } }).message.model).toBe('late');
    expect(second.remainder).toBe('');
  });

  it('parses a single 3MB line without loading the whole file', async () => {
    const dir = await scratch();
    const path = join(dir, 'session.jsonl');
    const huge = 'x'.repeat(3 * 1024 * 1024); // ~3 MB single value
    const smallHead = jl({ type: 'user', message: { content: 'head' } });
    const hugeLine = jl({ type: 'assistant', message: { model: 'big', content: huge } });
    const smallTail = jl({ type: 'user', message: { content: 'tail' } });
    await writeFile(path, smallHead + hugeLine + smallTail, 'utf8');

    // Tail from AFTER the head line — proves we read incrementally from an offset,
    // not the whole file, and still assemble the multi-MB line from streamed chunks.
    const offset = Buffer.byteLength(smallHead, 'utf8');
    const res = await tailFrom(path, offset);
    expect(res.records).toHaveLength(2);
    const big = res.records[0] as { message: { content: string } };
    expect(big.message.content.length).toBe(huge.length);
    expect((res.records[1] as { message: { content: string } }).message.content).toBe('tail');
  });

  it('skips non-message record types', async () => {
    const dir = await scratch();
    const path = join(dir, 'session.jsonl');
    const lines =
      jl({ type: 'attachment' }) +
      jl({ type: 'last-prompt' }) +
      jl({ type: 'assistant', message: { model: 'm', content: [] } }) +
      jl({ type: 'mode' }) +
      jl({ type: 'permission-mode' }) +
      jl({ type: 'ai-title' }) +
      jl({ type: 'system' }) +
      jl({ type: 'file-history-snapshot' }) +
      jl({ type: 'file-history-delta' }) +
      jl({ type: 'queue-operation' }) +
      jl({ type: 'user', message: { content: 'kept' } });
    await writeFile(path, lines, 'utf8');

    const res = await tailFrom(path, 0);
    const keptTypes = res.records.map((r) => (r as { type: string }).type);
    expect(keptTypes).toEqual(['assistant', 'user']);

    // The observed non-message record types are all in the skip set.
    for (const t of [
      'attachment',
      'last-prompt',
      'mode',
      'permission-mode',
      'ai-title',
      'system',
      'file-history-snapshot',
      'file-history-delta',
      'queue-operation',
    ]) {
      expect(SKIP_RECORD_TYPES.has(t)).toBe(true);
    }
    // Message-bearing types are NOT skipped.
    expect(SKIP_RECORD_TYPES.has('assistant')).toBe(false);
    expect(SKIP_RECORD_TYPES.has('user')).toBe(false);
  });

  it('returns nothing when the offset is already at EOF', async () => {
    const dir = await scratch();
    const path = join(dir, 'session.jsonl');
    const body = jl({ type: 'user', message: { content: 'only' } });
    await writeFile(path, body, 'utf8');
    const size = Buffer.byteLength(body, 'utf8');

    const res = await tailFrom(path, size);
    expect(res.records).toHaveLength(0);
    expect(res.nextOffset).toBe(size);
    expect(res.remainder).toBe('');
  });
});

describe('parseRecord', () => {
  it('parses a complete JSON line into a record', () => {
    const rec = parseRecord('{"type":"assistant","message":{"model":"m"}}');
    expect(rec).not.toBeNull();
    expect((rec as { type: string }).type).toBe('assistant');
  });

  it('returns null for blank/whitespace lines', () => {
    expect(parseRecord('')).toBeNull();
    expect(parseRecord('   ')).toBeNull();
  });
});
