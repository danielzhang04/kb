import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { FSWatcher } from 'chokidar';
import { registerSse } from './sse.ts';
import { createBus, wirePlaneA } from './bus.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hub-sse-'));
  cpSync(REPO_A, dir, { recursive: true });
  return dir;
}

const CARD = [
  '---',
  'id: dddd0001-9999',
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
  'sse fixture card',
  '',
].join('\n');

let app: FastifyInstance | undefined;
let watcher: FSWatcher | undefined;
afterEach(async () => {
  if (watcher) {
    await watcher.close();
    watcher = undefined;
  }
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe('registerSse', () => {
  it('streams an index delta to a subscribed client', async () => {
    const repo = scratchRepo();
    const bus = createBus();
    app = Fastify({ logger: false });
    registerSse(app, bus);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;

    watcher = await wirePlaneA(bus, repo);

    const res = await fetch(`http://127.0.0.1:${port}/events`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    // First read drains the initial ": connected" comment, proving the subscription is live.
    await reader.read();

    // Now cause a Plane-A change; the delta must arrive as an SSE frame.
    writeFileSync(join(repo, 'queue', 'inbox', 'card-new.md'), CARD, 'utf-8');

    const dec = new TextDecoder();
    let buf = '';
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (buf.includes('"channel":"planeA"') && buf.includes('card-new.md')) found = true;
    }
    await reader.cancel();
    expect(found).toBe(true);
  }, 15_000);
});
