import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthResponseFixture } from '../health/__fixtures__/health.ts';
import type { HealthResponse } from '../health/service.ts';
import { inboxFixtureData, type InboxFixtureScenario } from '../inbox/fixture.ts';

export const P1_BROWSER_SCENARIOS = [
  'inbox-populated',
  'inbox-empty',
  'inbox-error-after-success',
  'events-reconnect-unknown',
  'health-reader-error',
] as const;

export type P1BrowserScenario = (typeof P1_BROWSER_SCENARIOS)[number];

export interface P1BrowserFixtureState {
  inboxRequests: number;
  inboxInFlight: number;
  maxInboxInFlight: number;
  eventConnections: number;
  eventFrames: number;
  unknownEventFrames: number;
}

export interface P1BrowserFixture {
  address: { host: '127.0.0.1'; port: number };
  origin: string;
  state: P1BrowserFixtureState;
  releaseInbox(): void;
  close(): Promise<void>;
}

export interface P1BrowserFixtureOptions {
  scenario: P1BrowserScenario;
  distDir?: string;
  host?: string;
  port?: number;
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function isScenario(value: string): value is P1BrowserScenario {
  return P1_BROWSER_SCENARIOS.includes(value as P1BrowserScenario);
}

function json(reply: ServerResponse, status: number, body: unknown): void {
  reply.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  reply.end(JSON.stringify(body));
}

function degradedHealth(): HealthResponse {
  const health = structuredClone(healthResponseFixture);
  health.sections[0].rows = [{
    kind: 'unavailable', key: 'error:fleet', label: 'Unavailable',
    value: { status: 'unavailable', reason: 'Reader unavailable' },
    observedAt: '2026-08-21T12:00:00.000Z', source: 'error',
  }];
  return health;
}

function safeStaticFile(distDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded === '/') decoded = '/index.html';
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.split('/').includes('..')) return null;
  const root = resolve(distDir);
  const target = resolve(root, decoded.slice(1));
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null;
  try {
    return statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

/** Start the bounded, read-only P1 browser harness. This module is never registered by production. */
export async function startP1BrowserFixture(options: P1BrowserFixtureOptions): Promise<P1BrowserFixture> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('P1 browser fixture must bind exactly 127.0.0.1');
  if (!isScenario(options.scenario as string)) throw new Error(`Unknown scenario: ${String(options.scenario)}`);
  const port = options.port ?? 4317;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error(`Invalid port: ${String(port)}`);
  const distDir = resolve(options.distDir ?? fileURLToPath(new URL('../../dist', import.meta.url)));
  if (!existsSync(resolve(distDir, 'index.html'))) throw new Error(`Built dashboard is missing at ${distDir}`);

  const state: P1BrowserFixtureState = {
    inboxRequests: 0,
    inboxInFlight: 0,
    maxInboxInFlight: 0,
    eventConnections: 0,
    eventFrames: 0,
    unknownEventFrames: 0,
  };
  const inboxScenario: InboxFixtureScenario = options.scenario === 'health-reader-error' ? 'inbox-populated' : options.scenario;
  const inboxData = inboxFixtureData(inboxScenario);
  const pendingInbox = new Set<() => void>();
  const streams = new Set<ServerResponse>();
  const timers = new Set<NodeJS.Timeout>();
  let closed = false;

  const later = (callback: () => void, delay: number): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  };

  const server = createServer((request, reply) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET') return json(reply, 404, { error: 'not found' });

    if (url.pathname === '/api/auth/context') return json(reply, 200, { mode: 'tailnet' });
    if (url.pathname === '/api/runtime/capabilities') return json(reply, 200, { pty: false, localTranscripts: false });

    if (url.pathname === '/api/inbox') {
      state.inboxRequests += 1;
      state.inboxInFlight += 1;
      state.maxInboxInFlight = Math.max(state.maxInboxInFlight, state.inboxInFlight);
      let settled = false;
      const finish = (status: number, body: unknown): void => {
        if (settled) return;
        settled = true;
        state.inboxInFlight -= 1;
        json(reply, status, body);
      };
      reply.once('close', () => {
        if (!settled) {
          settled = true;
          state.inboxInFlight -= 1;
        }
      });
      if (options.scenario === 'events-reconnect-unknown' && state.inboxRequests === 1) {
        const response = inboxData.responses[0];
        pendingInbox.add(() => finish(response.status, response.body));
        return;
      }
      const response = inboxData.responses[Math.min(state.inboxRequests - 1, inboxData.responses.length - 1)]!;
      return finish(response.status, response.body);
    }

    if (url.pathname === '/api/health') {
      return json(reply, 200, options.scenario === 'health-reader-error' ? degradedHealth() : healthResponseFixture);
    }

    if (url.pathname === '/events') {
      state.eventConnections += 1;
      const connection = state.eventConnections;
      streams.add(reply);
      reply.once('close', () => streams.delete(reply));
      reply.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      reply.write(': connected\n\n');

      if (options.scenario === 'events-reconnect-unknown' && connection === 1) {
        for (const [index, frame] of inboxData.eventFrames.entries()) {
          later(() => {
            if (reply.destroyed) return;
            state.eventFrames += 1;
            reply.write(`event: planeA\ndata: ${frame}\n\n`);
          }, 5 * (index + 1));
        }
        later(() => {
          if (reply.destroyed) return;
          state.unknownEventFrames += 1;
          reply.write(`event: fixture-unknown\ndata: ${JSON.stringify({ channel: 'unknown', kind: 'must-not-render' })}\n\n`);
          reply.end();
        }, 40);
      } else if (options.scenario === 'events-reconnect-unknown') {
        state.unknownEventFrames += 1;
        reply.write(`event: fixture-unknown\ndata: ${JSON.stringify({ channel: 'unknown', kind: 'must-not-render' })}\n\n`);
      } else if (options.scenario === 'inbox-error-after-success') {
        later(() => {
          if (!reply.destroyed) reply.write(`event: planeA\ndata: ${JSON.stringify({ channel: 'planeA', kind: 'fixture-tick' })}\n\n`);
        }, 25);
      }
      return;
    }

    const file = safeStaticFile(distDir, url.pathname);
    if (file) {
      reply.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      reply.end(readFileSync(file));
      return;
    }
    return json(reply, 404, { error: 'not found' });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const fail = (error: Error): void => rejectListen(error);
    server.once('error', fail);
    server.listen({ host, port }, () => {
      server.off('error', fail);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo;

  return {
    address: { host: '127.0.0.1', port: address.port },
    origin: `http://127.0.0.1:${address.port}`,
    state,
    releaseInbox(): void {
      for (const release of pendingInbox) release();
      pendingInbox.clear();
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const release of pendingInbox) release();
      pendingInbox.clear();
      for (const stream of streams) stream.destroy();
      streams.clear();
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    },
  };
}

function parseArgs(args: string[]): { scenario: P1BrowserScenario; port: number } {
  let scenario: string | null = null;
  let port = 4317;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--scenario' && value) {
      scenario = value;
      index += 1;
    } else if (arg === '--port' && value) {
      port = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${String(arg)}`);
    }
  }
  if (!scenario || !isScenario(scenario)) throw new Error(`Unknown scenario: ${String(scenario)}`);
  return { scenario, port };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startP1BrowserFixture(parseArgs(process.argv.slice(2)))
    .then((fixture) => console.log(`[p1-browser-fixture] ${fixture.address.host}:${fixture.address.port}`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
