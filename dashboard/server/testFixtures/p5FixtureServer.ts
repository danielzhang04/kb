// Dashboard v3 P5 W6.1/W6.4 — the §8 browser fixture server. This is the fixture the seven §8 browser
// scenarios MOUNT (plan §8 lines 388-394). It is a bounded, read-only, loopback-only harness, never
// registered by production.
//
// WHY THIS EXISTS (the W6.5 boot-route fix): the reused `p1BrowserFixture.ts` serves `/api/home` and
// `/api/attention` ONLY inside its P2/P3 scenario blocks, so a P5 Inbox/Health/Home cell 404s on BOTH
// boot fetches and can never honestly claim "0 console errors". This server serves EVERY boot route the
// app shell fetches — `/api/auth/context`, `/api/runtime/capabilities`, `/api/home`, `/api/attention`,
// `/api/inbox`, `/api/health` — for ALL seven scenarios, plus `404` for `/api/deploy` and `/api/deploys`
// (the no-deploy-destination proof), so every cell reaches the app with no boot 404.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthResponseFixture } from '../health/__fixtures__/health.ts';
import type { HealthResponse } from '../health/service.ts';
import { P2_ATTENTION, p2Home } from './p2BrowserFixtureData.ts';
import {
  createLoopbackTlsMaterial, publishLoopbackCertificate, revokeLoopbackCertificate,
} from './p3LoopbackTls.ts';
import {
  P5_SCENARIOS, isP5FixtureKind, isP5Scenario, p5ScenarioProfile,
  type P5FixtureKind, type P5Scenario,
} from './p5ActualBrowserRunner.ts';

export interface P5FixtureServer {
  address: { host: '127.0.0.1'; port: number };
  origin: string;
  certificate: string | null;
  scenario: P5Scenario;
  fixtureKind: P5FixtureKind;
  close(): Promise<void>;
}

export interface P5FixtureServerOptions {
  scenario: P5Scenario;
  fixtureKind: P5FixtureKind;
  distDir?: string;
  host?: string;
  port?: number;
  https?: boolean;
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

/** The daemon hosts no PTY — the closed unavailable capability, matching `p1BrowserFixture.ts`. */
const FIXTURE_RUNTIME_CAPABILITIES = {
  pty: false as const,
  diagnostic: { reason: 'broker-unavailable' as const, detail: null, checkedAt: '2026-08-22T00:00:00.000Z' },
  localTranscripts: false,
};

function json(reply: ServerResponse, status: number, body: unknown): void {
  reply.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  reply.end(JSON.stringify(body));
}

function safeStaticFile(distDir: string, pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded === '/') decoded = '/index.html';
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.split('/').includes('..')) return null;
  const root = resolve(distDir);
  const target = resolve(root, decoded.slice(1));
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null;
  try { return statSync(target).isFile() ? target : null; } catch { return null; }
}

/**
 * `home-health-live-release` pins one injected activation: Home's chip SHA and Health's release row SHA
 * are the SAME value, and `<ago>` derives from `generatedAt`. This builds a Home/Health payload pair that
 * agrees, so the browser can assert chip-SHA === release-row-SHA.
 */
function homeForScenario(scenario: P5Scenario): unknown {
  const profile = p5ScenarioProfile(scenario);
  const home = p2Home(false) as Record<string, unknown>;
  if (profile.liveRelease) {
    return {
      ...home,
      release: {
        sha: profile.liveRelease.sha,
        activatedAt: profile.liveRelease.activatedAt,
        generatedAt: profile.liveRelease.generatedAt,
      },
    };
  }
  return home;
}

function healthForScenario(scenario: P5Scenario): HealthResponse {
  const profile = p5ScenarioProfile(scenario);
  const health = structuredClone(healthResponseFixture);
  if (profile.liveRelease) {
    // Health's daemon-machine release row carries the SAME sha as Home's chip.
    (health as unknown as { release?: unknown }).release = {
      sha: profile.liveRelease.sha,
      activatedAt: profile.liveRelease.activatedAt,
    };
  }
  return health;
}

/** Start the bounded P5 §8 browser fixture. Binds exactly 127.0.0.1. */
export async function startP5FixtureServer(options: P5FixtureServerOptions): Promise<P5FixtureServer> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('P5 fixture server must bind exactly 127.0.0.1');
  if (!isP5Scenario(options.scenario as string)) throw new Error(`Unknown P5 scenario: ${String(options.scenario)}`);
  if (!isP5FixtureKind(options.fixtureKind as string)) throw new Error(`Unknown fixture kind: ${String(options.fixtureKind)}`);
  const port = options.port ?? 4431;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error(`Invalid port: ${String(port)}`);
  const distDir = resolve(options.distDir ?? fileURLToPath(new URL('../../dist', import.meta.url)));
  if (!existsSync(resolve(distDir, 'index.html'))) throw new Error(`Built dashboard is missing at ${distDir}`);

  const profile = p5ScenarioProfile(options.scenario);
  const streams = new Set<ServerResponse>();
  let closed = false;

  const handler = (request: IncomingMessage, reply: ServerResponse): void => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (path === '/readyz') return json(reply, 200, { ok: true, scenario: options.scenario, fixtureKind: options.fixtureKind });

    // The no-deploy-destination proof: /api/deploy and /api/deploys are 404 on the wire, always.
    if (path === '/api/deploy' || path === '/api/deploys') return json(reply, 404, { error: 'not-found' });

    // The app shell opens a live-feedback SSE at /events on boot; serve an open, quiet stream so no cell
    // 404s on it (a boot fetch the reused p1 fixture also serves).
    if (request.method === 'GET' && path === '/events') {
      streams.add(reply);
      reply.once('close', () => streams.delete(reply));
      reply.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive',
      });
      reply.write(': connected\n\n');
      return;
    }

    if (request.method === 'GET') {
      // Boot routes — served for EVERY scenario so no cell 404s (the W6.5 fix).
      if (path === '/api/auth/context') return json(reply, 200, { mode: 'tailnet' });
      if (path === '/api/runtime/capabilities') return json(reply, 200, FIXTURE_RUNTIME_CAPABILITIES);
      if (path === '/api/attention') return json(reply, 200, P2_ATTENTION);
      if (path === '/api/home') return json(reply, 200, homeForScenario(options.scenario));
      if (path === '/api/inbox') return json(reply, 200, profile.inbox);
      if (path === '/api/health') return json(reply, 200, healthForScenario(options.scenario));

      const file = safeStaticFile(distDir, path);
      if (file) {
        reply.writeHead(200, {
          'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        reply.end(readFileSync(file));
        return;
      }
    }
    return json(reply, 404, { error: 'not-found' });
  };

  const tls = options.https === true ? await createLoopbackTlsMaterial() : null;
  const server = tls === null ? createServer(handler) : createSecureServer({ cert: tls.cert, key: tls.key }, handler);

  await new Promise<void>((resolveListen, rejectListen) => {
    const fail = (error: Error): void => rejectListen(error);
    server.once('error', fail);
    server.listen({ host, port }, () => { server.off('error', fail); resolveListen(); });
  });
  const address = server.address() as AddressInfo;
  const origin = `${tls === null ? 'http' : 'https'}://127.0.0.1:${address.port}`;
  if (tls !== null) publishLoopbackCertificate(address.port, tls.cert);

  return {
    address: { host: '127.0.0.1', port: address.port },
    origin,
    certificate: tls === null ? null : tls.cert,
    scenario: options.scenario,
    fixtureKind: options.fixtureKind,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (tls !== null) revokeLoopbackCertificate(address.port);
      for (const stream of streams) stream.destroy();
      streams.clear();
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    },
  };
}

export interface P5FixtureServerCliArgs {
  scenario: P5Scenario;
  fixtureKind: P5FixtureKind;
  port: number;
  https: boolean;
}

export function parseP5FixtureServerArgs(argv: readonly string[]): P5FixtureServerCliArgs {
  let scenario: P5Scenario | null = null;
  let fixtureKind: P5FixtureKind = 'bounded';
  let port = 4431;
  let https = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    const needValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--scenario': {
        const v = needValue();
        if (!isP5Scenario(v)) throw new Error(`--scenario must be one of: ${P5_SCENARIOS.join(', ')}`);
        scenario = v;
        break;
      }
      case '--fixture':
      case '--fixture-kind': {
        const v = needValue();
        if (!isP5FixtureKind(v)) throw new Error('--fixture must be bounded or real');
        fixtureKind = v;
        break;
      }
      case '--port': port = Number.parseInt(needValue(), 10); break;
      case '--https': https = true; break;
      default: throw new Error(`Unknown or incomplete argument: ${String(arg)}`);
    }
  }
  if (scenario === null) throw new Error('--scenario is required');
  return { scenario, fixtureKind, port, https };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseP5FixtureServerArgs(process.argv.slice(2));
  startP5FixtureServer(args)
    .then((fixture) => { process.stdout.write(`[p5-fixture-server] ${fixture.origin} (${fixture.scenario}/${fixture.fixtureKind})\n`); })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
