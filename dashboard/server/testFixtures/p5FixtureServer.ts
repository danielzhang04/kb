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
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthResponseFixture } from '../health/__fixtures__/health.ts';
import type { HealthResponse } from '../health/service.ts';
import { P2_ATTENTION, p2Home } from './p2BrowserFixtureData.ts';
import { CONTENT_TYPES, safeStaticFile, startLoopbackHttpServer } from './staticHttpServer.ts';
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

/**
 * `home-health-live-release` pins one injected activation: Home's chip SHA and Health's release row SHA
 * are the SAME value, and `<ago>` derives from `generatedAt`.
 *
 * W6.5b fix: the field this used to write (`{ ...home, release: {...} }`) is a top-level key `D13Home.tsx`
 * never reads — the browser's "Version" section renders `sections[3].data.sha` / `.activatedAt` against
 * top-level `generatedAt`, so the old shape was a silent no-op and the chip always showed the DEFAULT
 * fixture sha regardless of the injected activation. This now writes the SAME fields the client actually
 * renders, so the browser can genuinely assert chip-SHA === release-row-SHA.
 */
function homeForScenario(scenario: P5Scenario): unknown {
  const profile = p5ScenarioProfile(scenario);
  const home = p2Home(false) as { sections: { state: string; data?: Record<string, unknown> }[]; generatedAt: string; [key: string]: unknown };
  if (!profile.liveRelease) return home;
  const live = profile.liveRelease;
  const sections = home.sections.map((section, index) => {
    if (index !== 3 || section.data === undefined) return section;
    return { ...section, data: { ...section.data, sha: live.sha, activatedAt: live.activatedAt } };
  });
  return { ...home, sections, generatedAt: live.generatedAt };
}

function healthForScenario(scenario: P5Scenario): HealthResponse {
  const profile = p5ScenarioProfile(scenario);
  const health = structuredClone(healthResponseFixture);
  if (profile.liveRelease) {
    const live = profile.liveRelease;
    // W6.5b fix: the old code set a top-level `health.release` key `Health.tsx` never reads — the
    // rendered "Release" row lives at `sections['daemon-machine'].rows[key='release'].value`. Mutate
    // THAT row so the browser's rendered sha/activated fields genuinely reflect the injected activation.
    for (const section of health.sections) {
      for (const row of section.rows) {
        if (row.kind === 'release') {
          row.value = { ...row.value, sha: live.sha, activatedAt: live.activatedAt };
        }
      }
    }
  }
  if (scenario === 'health-bounded-probe-failure') {
    // W6.5b addition: the browser bullet asserts "exactly one row degrades under an injected probe fault,
    // every other row stays ready" — the fixture previously served the same all-ready payload for every
    // scenario, so there was nothing for the browser to observe. Replace exactly one section's rows with
    // the REAL production shape a bounded probe failure takes (`UnavailableRow`, `server/health/service.ts`).
    health.sections = health.sections.map((section) => (
      section.id === 'mcp'
        ? {
          ...section,
          rows: [{
            kind: 'unavailable', key: `error:${section.id}`, label: 'Unavailable',
            value: { status: 'unavailable', reason: 'probe-timeout' },
            observedAt: '2026-08-25T12:00:00.000Z', source: 'error',
          }],
        }
        : section
    )) as HealthResponse['sections'];
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

      // W6.5b addition: mirror production's SPA fallback (`server/static/routes.ts#registerStatic`'s
      // `setNotFoundHandler`) — any GET that isn't under `/api/*` and matched no route above serves
      // `index.html`, letting the client-side `parseNavigationSearch` (src/nav/stack.ts) run and fall
      // back to a clean Home root. Without this the fixture hard-404s `/deploy` and `/deploys` at the
      // HTTP layer for the top-level navigation itself, which is NOT what production does and which the
      // browser logs as a console error, masking the real `no-deploy-destination` proof.
      if (!path.startsWith('/api/')) {
        const indexPath = safeStaticFile(distDir, '/');
        if (indexPath) {
          reply.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          reply.end(readFileSync(indexPath));
          return;
        }
      }
    }
    return json(reply, 404, { error: 'not-found' });
  };

  const loopback = await startLoopbackHttpServer({ host: '127.0.0.1', port, https: options.https }, handler);

  return {
    address: loopback.address,
    origin: loopback.origin,
    certificate: loopback.certificate,
    scenario: options.scenario,
    fixtureKind: options.fixtureKind,
    close(): Promise<void> {
      return loopback.close(() => {
        for (const stream of streams) stream.destroy();
        streams.clear();
      });
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
