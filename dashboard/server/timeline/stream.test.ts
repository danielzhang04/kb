import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamSession } from './stream';
import { tailFrom } from '../planeB/tailer';
import { foldRecords } from '../../src/lib/timelineModel';
import { createBus } from '../hub/bus';
import type { HubEvent } from '../hub/bus';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'timeline-stream-'));
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

const PART1 =
  jl({ type: 'assistant', message: { model: 'm', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { p: 'a' } }] } }) +
  jl({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'body' }] } });
const PART2 =
  jl({ type: 'assistant', message: { model: 'm', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { c: 'ls' } }] } }) +
  jl({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'out' }] } });

describe('streamSession', () => {
  it('same fold produces identical model for live-tail and replay of the same file', async () => {
    const dir = await scratch();
    const path = join(dir, 'session.jsonl');
    await writeFile(path, PART1, 'utf8');

    const bus = createBus();
    const seen: HubEvent[] = [];
    bus.subscribe((e) => seen.push(e));

    // Live tail: consume PART1 incrementally, then append and consume PART2.
    const s1 = await streamSession(path, 0, bus);
    await appendFile(path, PART2, 'utf8');
    const s2 = await streamSession(path, s1.nextOffset, bus);

    // Replay: fold the whole file in one pass.
    const whole = await tailFrom(path, 0);
    const replayModel = foldRecords(whole.records);

    // Same fold over records accumulated live == the replay model (one code path).
    const liveModel = foldRecords([...s1.records, ...s2.records]);
    expect(liveModel).toEqual(replayModel);

    // A whole-file streamSession from offset 0 also matches replay.
    const full = await streamSession(path, 0, bus);
    expect(full.model).toEqual(replayModel);

    // The live tail published message-granular planeB deltas onto the bus.
    const planeB = seen.filter((e) => e.channel === 'planeB');
    expect(planeB.length).toBeGreaterThanOrEqual(2);
    expect(planeB[0].kind).toBe('tail');
    expect(planeB[0].path).toBe(path);
  });
});
