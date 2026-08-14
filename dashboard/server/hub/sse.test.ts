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
import { registerHub } from './index.ts';
import { mintSession } from '../auth/session.ts';

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

  it('does not flush an SSE stream before session validation, and accepts either session transport', async () => {
    const bus = createBus();
    const session = { secret: Buffer.from('hub-sse-session-secret'), ttlMs: 60_000 };
    let origin = '';
    app = Fastify({ logger: false });
    registerHub(app, { bus, sessionConfig: session, allowedOrigins: () => [origin] });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    origin = `http://127.0.0.1:${port}`;
    const url = `${origin}/events`;

    for (const headers of [
      { origin, accept: 'text/event-stream' },
      { origin, accept: 'text/event-stream', cookie: 'kb_session=%E0%A4%A' },
    ] as Array<Record<string, string>>) {
      const rejected = await fetch(url, { headers });
      expect(rejected.status).toBe(401);
      expect(rejected.headers.get('content-type')).not.toContain('text/event-stream');
      // The transport's initial ': connected' frame is never written on a rejected request.
      expect(await rejected.text()).not.toContain(': connected');
    }

    const token = mintSession('operator', session).token;
    for (const headers of [
      { origin, accept: 'text/event-stream', cookie: `kb_session=${encodeURIComponent(token)}` },
      { origin, accept: 'text/event-stream', authorization: `Bearer ${token}` },
    ] as Array<Record<string, string>>) {
      const accepted = await fetch(url, { headers });
      expect(accepted.status).toBe(200);
      expect(accepted.headers.get('content-type')).toContain('text/event-stream');
      const reader = accepted.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain(': connected');
      await reader.cancel();
    }
  });
});
