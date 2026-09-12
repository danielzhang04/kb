import { cpSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FSWatcher } from 'chokidar';
import { createBus, publishAttemptIoSignal, publishControlTick, publishTailDelta, wireControlStoreTick, wirePlaneA } from './bus.ts';
import type { HubEvent } from './bus.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hub-bus-'));
  cpSync(REPO_A, dir, { recursive: true });
  return dir;
}

const CARD = [
  '---',
  'id: cccc0001-9999',
  'project: kb',
  'action: cadence:new',
  'target: .',
  'risk-tier: T1',
  'owner: null',
  'state: inbox',
  '---',
  '',
  '## Work order',
  '',
  'bus fixture card',
  '',
].join('\n');

let watcher: FSWatcher | undefined;
afterEach(async () => {
  if (watcher) {
    await watcher.close();
    watcher = undefined;
  }
});

describe('createBus', () => {
  it('fans a published event out to every subscriber', () => {
    const bus = createBus();
    const a: HubEvent[] = [];
    const b: HubEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    bus.publish({ channel: 'planeA', kind: 'cards', path: '/x/card.md' });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toEqual({ channel: 'planeA', kind: 'cards', path: '/x/card.md' });
  });

  it('stops delivering after unsubscribe', () => {
    const bus = createBus();
    const seen: HubEvent[] = [];
    const unsub = bus.subscribe((e) => seen.push(e));
    bus.publish({ channel: 'planeA', kind: 'cards' });
    unsub();
    bus.publish({ channel: 'planeA', kind: 'ledgers' });
    expect(seen).toHaveLength(1);
    expect(bus.subscriberCount()).toBe(0);
  });

  it('isolates one subscriber throwing from the others', () => {
    const bus = createBus();
    const seen: HubEvent[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((e) => seen.push(e));
    expect(() => bus.publish({ channel: 'planeB', kind: 'tail' })).not.toThrow();
    expect(seen).toHaveLength(1);
  });
});

describe('publishTailDelta', () => {
  it('bridges a Plane-B tail into a message-granular planeB event', () => {
    const bus = createBus();
    const seen: HubEvent[] = [];
    bus.subscribe((e) => seen.push(e));
    publishTailDelta(bus, {
      sessionPath: '/sessions/s.jsonl',
      records: [{ type: 'assistant' }, { type: 'user' }],
      nextOffset: 4096,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].channel).toBe('planeB');
    expect(seen[0].path).toBe('/sessions/s.jsonl');
    expect((seen[0].data as { count: number }).count).toBe(2);
    expect((seen[0].data as { nextOffset: number }).nextOffset).toBe(4096);
  });
});

describe('control channel', () => {
  it('publishes an attempt-io signal without transcript content', () => {
    const bus = createBus();
    const seen: HubEvent[] = [];
    bus.subscribe((event) => seen.push(event));

    publishAttemptIoSignal(bus, { attemptRef: 'attempt-1', seq: 1 });

    expect(seen).toEqual([{
      channel: 'control',
      kind: 'attempt-io',
      data: { attemptRef: 'attempt-1', seq: 1 },
    }]);
    const serialized = JSON.stringify(seen[0]);
    expect(serialized).not.toContain('"line"');
    expect(serialized).not.toContain('"dir"');
  });

  it('publishes a payload-free store-change tick', () => {
    const bus = createBus();
    const seen: HubEvent[] = [];
    bus.subscribe((event) => seen.push(event));

    publishControlTick(bus);

    expect(seen).toEqual([{ channel: 'control', kind: 'store-change' }]);
  });

  it('debounces control-plane file changes into one tick per settle window', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'hub-control-'));
    const controlDir = join(stateRoot, 'control');
    const controlPath = join(controlDir, 'control-plane.json');
    mkdirSync(controlDir, { recursive: true });
    writeFileSync(controlPath, '{}', 'utf-8');
    const bus = createBus();
    const seen: HubEvent[] = [];
    bus.subscribe((event) => seen.push(event));
    watcher = await wireControlStoreTick(bus, stateRoot, { debounceMs: 50 });

    writeFileSync(controlPath, '{"version":1}', 'utf-8');
    writeFileSync(controlPath, '{"version":2}', 'utf-8');
    await waitFor(() => seen.length === 1);
    expect(seen).toEqual([{ channel: 'control', kind: 'store-change' }]);

    writeFileSync(controlPath, '{"version":3}', 'utf-8');
    await waitFor(() => seen.length === 2);
    expect(seen).toEqual([
      { channel: 'control', kind: 'store-change' },
      { channel: 'control', kind: 'store-change' },
    ]);
  }, 2_000);
});

async function waitFor(assertion: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!assertion()) {
    if (Date.now() - started >= timeoutMs) throw new Error('Timed out waiting for watcher event.');
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

describe('wirePlaneA', () => {
  it('bridges a Plane-A file-watch delta onto the bus', async () => {
    const repo = scratchRepo();
    const bus = createBus();
    const got = new Promise<HubEvent>((resolve) => {
      bus.subscribe((e) => resolve(e));
    });
    watcher = await wirePlaneA(bus, repo);
    writeFileSync(join(repo, 'queue', 'inbox', 'card-bus.md'), CARD, 'utf-8');
    const event = await got;
    expect(event.channel).toBe('planeA');
    expect(event.kind).toBe('cards');
    expect(event.path).toContain('card-bus.md');
  }, 15_000);
});


describe('Figment allocation paths never reach the hub bus', () => {
  it('keeps private initial and changing files off the bus while publishing a neighboring STATE change', async () => {
    const repo = scratchRepo();
    const hiddenRoot = join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans');
    mkdirSync(join(hiddenRoot, 'private-allocation'), { recursive: true });
    const secret = join(hiddenRoot, 'private-allocation', 'private-stage.json'); writeFileSync(secret, '{}');
    const state = join(repo, 'orgs', 'figment', 'STATE.md'); writeFileSync(state, '# Figment\n');
    const bus = createBus(); const seen: HubEvent[] = []; const unsubscribe = bus.subscribe((event) => seen.push(event));
    try {
      watcher = await wirePlaneA(bus, repo, { debounceMs: 10 });
      const added = join(hiddenRoot, 'private-marker.json'); writeFileSync(added, '{}'); writeFileSync(secret, '{"changed":true}'); unlinkSync(added);
      // Exercise the ingress guard through the actual watcher-to-bus composition too.
      for (const event of ['add', 'change', 'unlink']) watcher.emit(event, secret);
      await new Promise<void>((done) => setTimeout(done, 150)); expect(seen).toEqual([]);
      writeFileSync(state, '# Figment updated\n');
      await waitFor(() => seen.some((event) => event.path === state));
      expect(seen).toEqual([{ channel: 'planeA', kind: 'states', path: state }]);
      expect(JSON.stringify(seen)).not.toMatch(/private-allocation|private-stage|private-marker|gen-plans/);
    } finally { unsubscribe(); await watcher?.close(); watcher = undefined; rmSync(repo, { recursive: true, force: true }); }
  }, 15_000);
});
