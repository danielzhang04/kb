import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { FSWatcher } from 'chokidar';
import WebSocket from 'ws';
import { registerReadWs } from './ws.ts';
import { createBus, wirePlaneA } from './bus.ts';
import { registerHub } from './index.ts';
import { mintSession } from '../auth/session.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hub-ws-'));
  cpSync(REPO_A, dir, { recursive: true });
  return dir;
}

const CARD = [
  '---',
  'id: eeee0001-9999',
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
  'ws fixture card',
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

describe('registerReadWs', () => {
  it('streams a Plane-A delta to a subscribed WS client', async () => {
    const repo = scratchRepo();
    const bus = createBus();
    app = Fastify({ logger: false });
    await registerReadWs(app, bus);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;

    watcher = await wirePlaneA(bus, repo);

    const message = new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      socket.on('open', () => {
        writeFileSync(join(repo, 'queue', 'inbox', 'card-new.md'), CARD, 'utf-8');
      });
      socket.on('message', (data: Buffer) => {
        const text = data.toString('utf8');
        if (text.includes('"channel":"planeA"') && text.includes('card-new.md')) {
          resolve(text);
          socket.close();
        }
      });
      socket.on('error', reject);
    });

    const frame = await message;
    expect(frame).toContain('"channel":"planeA"');
    expect(frame).toContain('card-new.md');
  }, 15_000);

  it('rejects unauthenticated upgrades before a stream opens, while accepting cookie and bearer sessions', async () => {
    const bus = createBus();
    const session = { secret: Buffer.from('hub-ws-session-secret'), ttlMs: 60_000 };
    let origin = '';
    app = Fastify({ logger: false });
    registerHub(app, { bus, sessionConfig: session, allowedOrigins: () => [origin] });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    origin = `http://127.0.0.1:${port}`;
    const url = `ws://127.0.0.1:${port}/ws`;

    for (const headers of [
      { origin },
      { origin, cookie: 'kb_session=%E0%A4%A' },
    ]) {
      await new Promise<void>((resolve, reject) => {
        let opened = false;
        let frames = 0;
        const socket = new WebSocket(url, { headers });
        socket.on('open', () => { opened = true; });
        socket.on('message', () => { frames += 1; });
        socket.on('unexpected-response', (_request, response) => {
          expect(response.statusCode).toBe(401);
          response.resume();
          response.on('end', () => {
            expect(opened).toBe(false);
            expect(frames).toBe(0);
            resolve();
          });
        });
        socket.on('error', (err) => reject(err));
      });
    }

    const token = mintSession('operator', session).token;
    for (const headers of [
      { origin, cookie: `kb_session=${encodeURIComponent(token)}` },
      { origin, authorization: `Bearer ${token}` },
    ]) {
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(url, { headers });
        socket.on('open', () => socket.close());
        socket.on('close', () => resolve());
        socket.on('error', reject);
      });
    }
  });
});
