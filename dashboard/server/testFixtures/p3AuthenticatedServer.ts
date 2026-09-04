/**
 * P3 §7 — a REAL authenticated dashboard, composed from the PRODUCTION `buildApp`.
 *
 * This is not a stand-in server. It builds the same Fastify app the daemon builds, over the same surface
 * context, with the same Origin/Host guard, the same session pre-handlers, the same rate-limit hooks and
 * the same fleet-gated PTY host. Only three things are injected, and each through a seam production
 * already has:
 *
 *  - `ptySessionHost` — a deterministic fake by default, or the REAL Windows host under
 *    `--real-windows-host`. Either way `makeSurfaceContext` wraps it in the fleet-preamble gate, so a
 *    frozen fleet refuses here exactly as it refuses in production. There is no bypass flag.
 *  - `browserSessionRefs` — an in-memory ref table, so two independent browser identities can be minted
 *    without touching the daemon's real v3 document.
 *  - `sessionConfig` — a per-process HMAC secret, so the tokens this fixture prints verify against this
 *    process and nothing else.
 *
 * The two contexts are the point of the fixture. Context A and context B hold DIFFERENT operators and
 * DIFFERENT refs; a third identity, A's second tab, holds the same operator AND the same ref as A. That
 * triple is what makes "B cannot list/attach/close/resize/write A's session, but A's other tab can" a
 * statement about the browser-session ref rather than about the operator name.
 */
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../index.ts';
import { acquireWriterLease } from '../control/writerLease.ts';
import { mintSession } from '../auth/session.ts';
import {
  BROWSER_SESSION_COOKIE_NAME,
  createBrowserSessionRefManager,
  findStoredBrowserSessionRef,
  type StoredBrowserSessionRef,
} from '../auth/browserSessionRef.ts';
import { createWindowsSessionHost } from '../pty/windowsSessionHost.ts';
import { toPublicPtyCapability } from '../pty/probe.ts';
import { runtimeHostCapabilities, unavailablePtyCapability } from '../runtime/capabilities.ts';
import type {
  HostLaunch, ObservedExit, PtyCapabilityProbe, PublicPtyCapability, SessionHost, SessionHostRequest,
  SessionSink,
} from '../pty/contracts.ts';
import {
  createLoopbackTlsMaterial, publishFixturePrincipal, publishLoopbackCertificate,
  revokeFixturePrincipal, revokeLoopbackCertificate,
} from './p3LoopbackTls.ts';


/** One browser identity the fixture publishes: a session token plus the ref cookie that pairs with it. */
export interface P3FixtureContext {
  label: 'a' | 'b' | 'a-second-tab';
  operator: string;
  browserSessionRef: string;
  cookie: string;
  token: string;
  /** The URL that installs THIS context's cookie in a browser and nothing else. */
  entryUrl: string;
}

export interface P3AuthenticatedServer {
  origin: string;
  address: { host: '127.0.0.1'; port: number };
  certificate: string | null;
  contexts: { a: P3FixtureContext; b: P3FixtureContext; aSecondTab: P3FixtureContext };
  /** Whether the REAL Windows host is driving PTYs, or the deterministic fake. */
  realWindowsHost: boolean;
  usageBanner(): string;
  close(): Promise<void>;
}

export interface P3AuthenticatedServerOptions {
  port?: number;
  https?: boolean;
  realWindowsHost?: boolean;
  repoRoot?: string;
  stateRoot?: string;
  /** Override the host entirely (the suite injects a recorder here). */
  sessionHost?: SessionHost;
}

/**
 * The fixture's epoch id. It must satisfy the v3 document's `epoch-[0-9a-f]{32}` grammar: a friendly
 * label here is rejected by `sessionPersistence`'s validator at the FIRST create, which is exactly how
 * the WS surface came to look broken while only the fixture was.
 */
const FIXTURE_EPOCH = 'epoch-0f3a0f3a0f3a0f3a0f3a0f3a0f3a0f3a';

/**
 * A deterministic in-process {@link SessionHost}. Every session emits the SAME scripted bytes, so a
 * `compare-transcript` cycle has a byte-identical expectation without a real shell in the loop. It
 * spawns nothing; the real-host path is the separate `--real-windows-host` flag.
 */
export function createDeterministicSessionHost(): SessionHost {
  let counter = 0;
  interface Entry {
    /** The create-time sink (the registry's transcript recorder). */
    sink: SessionSink;
    /** Every ATTACHED sink, by attachment id. One write reaches all of them, as a real PTY's output does. */
    attached: Map<string, SessionSink>;
    sequence: number;
    settleExit: (exit: ObservedExit) => void;
  }
  const live = new Map<string, Entry>();
  const emitData = (sessionId: string, entry: Entry, bytes: Buffer): void => {
    entry.sequence += 1;
    const frame = {
      sessionId, sequence: entry.sequence, encoding: 'base64' as const,
      data: bytes.toString('base64'), replay: false,
    };
    for (const sink of [entry.sink, ...entry.attached.values()]) {
      if (!sink.closed()) sink.data({ ...frame });
    }
  };
  const now = (): string => new Date().toISOString();
  const mintId = (): string => {
    counter += 1;
    return `pty-${counter.toString(16).padStart(32, '0')}`;
  };
  return {
    async probe(): Promise<PtyCapabilityProbe> {
      return {
        available: true, host: 'desktop', transport: 'local-node-pty',
        launchers: ['shell', 'claude', 'codex'], roots: ['repo', 'worktrees'],
        epochId: FIXTURE_EPOCH, checkedAt: now(),
      };
    },
    create(request: SessionHostRequest, sink: SessionSink): HostLaunch {
      const sessionId = mintId();
      let settleExit: (exit: ObservedExit) => void = () => {};
      const exit = new Promise<ObservedExit>((settle) => { settleExit = settle; });
      const entry: Entry = { sink, attached: new Map(), sequence: 0, settleExit };
      live.set(sessionId, entry);
      // One scripted banner per launcher, delivered after the receipt so a client that attaches late
      // still replays exactly these bytes. A MACROtask, not a microtask: the route creates and then
      // attaches the creating browser, and that attach settles across several already-resolved
      // promises. Emitting in a microtask beat it, so the banner reached only the transcript recorder
      // and the creating tab never saw live what a reattach later replays — which made the §7
      // live-versus-replayed fold unequal by exactly the banner.
      setTimeout(() => {
        if (!live.has(sessionId)) return;
        emitData(sessionId, entry, Buffer.from(`kb ${request.recipe.launcher} ready\r\n`, 'utf8'));
      }, 0);
      return {
        receipt: Promise.resolve({
          ok: true,
          value: {
            operationKey: request.operationKey, sessionId, epochId: FIXTURE_EPOCH,
            outputSequence: 1, boundAt: now(), replayed: false,
          },
        }),
        exit,
      };
    },
    async attach(sessionId, sink) {
      const entry = live.get(sessionId);
      if (!entry) return { ok: false, refusal: 'not-found', detail: null };
      // REGISTER the sink. A host that mints an attachment id without wiring the sink hands the browser a
      // socket that acknowledges input and never shows output - the exact hole this fixture must not have.
      const attachmentId = `att-${randomBytes(16).toString('hex')}`;
      entry.attached.set(attachmentId, sink);
      return { ok: true, value: { attachmentId } };
    },
    async write(sessionId, data) {
      const entry = live.get(sessionId);
      if (!entry) return { ok: false, refusal: 'not-found', detail: null };
      // Echo, the way an interactive shell does — this is what makes a write observable to the client.
      emitData(sessionId, entry, Buffer.from(data));
      return { ok: true, value: { accepted: data.byteLength } };
    },
    async endInput(sessionId) {
      if (!live.has(sessionId)) return { ok: false, refusal: 'not-found', detail: null };
      return { ok: true, value: { ended: true } };
    },
    async resize(sessionId, size) {
      if (!live.has(sessionId)) return { ok: false, refusal: 'not-found', detail: null };
      return { ok: true, value: size };
    },
    async close(sessionId) {
      const entry = live.get(sessionId);
      if (!entry) return { ok: false, refusal: 'not-found', detail: null };
      live.delete(sessionId);
      const observed: ObservedExit = {
        sessionId, sequence: entry.sequence + 1, exitCode: 0, signal: null,
        reason: 'closed', observedAt: now(),
      };
      entry.settleExit(observed);
      for (const sink of [entry.sink, ...entry.attached.values()]) {
        if (!sink.closed()) sink.exit(observed);
      }
      return { ok: true, value: observed };
    },
    async listEpoch() {
      return { ok: true, value: { epochId: FIXTURE_EPOCH, sessionIds: [...live.keys()] } };
    },
    async drain(epochId) {
      const closed = [...live.keys()];
      for (const sessionId of closed) await this.close(sessionId);
      return { ok: true, value: { epochId, closed, alreadyGone: [] } };
    },
  };
}

/** An in-memory browser-session ref table with the production manager's own reserve/verify contract. */
export function createMemoryBrowserSessionRefs() {
  const stored = new Map<string, StoredBrowserSessionRef>();
  return createBrowserSessionRefManager({
    reserve: async (ref, expiresAt) => {
      if (stored.has(ref)) return false;
      stored.set(ref, { ref, expiresAt });
      return true;
    },
    verify: async (matches) => findStoredBrowserSessionRef(matches, stored.values()),
    renew: async (ref, expiresAt) => {
      if (!stored.has(ref)) return false;
      stored.set(ref, { ref, expiresAt });
      return true;
    },
  });
}

/**
 * Create `<stateRoot>/pty-roots/{repo,worktrees}` with an ACL the W1 root policy accepts: inheritance
 * broken, and write granted to nobody but SYSTEM, Administrators and the account this process runs as
 * (the service identity the pin validator compares against). `icacls` is the only way to set a Windows
 * DACL from Node; it is invoked with a fixed argument vector (no shell), so no path can inject flags.
 */
function createPolicyConformingPtyRoots(stateRoot: string): { repo: string; worktrees: string } {
  const base = resolvePath(stateRoot, 'pty-roots');
  const roots = { repo: resolvePath(base, 'repo'), worktrees: resolvePath(base, 'worktrees') };
  for (const root of [roots.repo, roots.worktrees]) {
    mkdirSync(root, { recursive: true });
    // Resolved absolutely, never through PATH: on a machine whose own P3 finding is that `%APPDATA%\\npm`
    // is writable by sandbox SIDs and sits on PATH, resolving a security tool by bare name is the wrong
    // discipline even where the argv is fixed.
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [
      root,
      '/inheritance:r',
      '/grant:r', '*S-1-5-18:(OI)(CI)F',
      '/grant:r', '*S-1-5-32-544:(OI)(CI)F',
      '/grant:r', `${process.env.USERDOMAIN ?? '.'}\\${process.env.USERNAME ?? ''}:(OI)(CI)F`,
    ], { stdio: 'ignore' });
  }
  return roots;
}

export async function startP3AuthenticatedServer(
  options: P3AuthenticatedServerOptions = {},
): Promise<P3AuthenticatedServer> {
  const port = options.port ?? 4317;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`Invalid port: ${String(port)}`);
  const realWindowsHost = options.realWindowsHost === true;
  if (realWindowsHost && process.platform !== 'win32') {
    // Fail closed rather than silently substituting the fake: the §7 command exists to prove the REAL
    // host, and a green run against a stand-in would be worse than no run.
    throw new Error('--real-windows-host requires win32; refusing to substitute the deterministic host');
  }

  const repoRoot = options.repoRoot ?? resolvePath(fileURLToPath(new URL('../../../', import.meta.url)));
  const stateRoot = options.stateRoot ?? mkdtempSync(join(tmpdir(), 'kb-p3-authenticated-'));
  const previousStateRoot = process.env.DASHBOARD_STATE_ROOT;
  process.env.DASHBOARD_STATE_ROOT = stateRoot;

  const sessionHost = options.sessionHost
    ?? (realWindowsHost
      ? createWindowsSessionHost({
        epochId: FIXTURE_EPOCH,
        // NOT this checkout and NOT a bare mkdtemp: both inherit Modify ACEs for other local
        // principals on a developer machine (kb's own codex sandbox provisioning grants
        // `CodexSandboxUsers` and per-worker SIDs (OI)(CI)(M) all the way down `%USERPROFILE%`), and
        // the W1 root policy refuses such a root as `unsafe-root` — correctly, since anything those
        // accounts write becomes the cwd of a spawned shell. The fixture therefore PROVISIONS roots
        // that conform, so the smoke proves the real host against a real conforming root.
        roots: createPolicyConformingPtyRoots(stateRoot),
      })
      : createDeterministicSessionHost());

  const tls = options.https === true ? await createLoopbackTlsMaterial() : null;

  // Bind FIRST. With `--port 0` the real port is only known after listen, and the Origin allowlist the
  // production guard enforces is derived from it — building the app against the requested port would
  // hand every request a 403 that has nothing to do with the code under test.
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;
  let contextsByPath = new Map<string, P3FixtureContext>();

  const handler = (request: import('node:http').IncomingMessage, reply: import('node:http').ServerResponse): void => {
    if (app === null) {
      reply.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      reply.end(JSON.stringify({ error: 'starting' }));
      return;
    }
    const path = (request.url ?? '/').split('?')[0];
    const context = contextsByPath.get(path);
    if (context) {
      // Installs exactly ONE context's cookie. There is no endpoint that hands a browser a ref of its
      // choosing, so a tab can never assume another context's identity by asking for it.
      reply.writeHead(302, {
        location: '/', 'cache-control': 'no-store',
        'set-cookie': `${BROWSER_SESSION_COOKIE_NAME}=${context.browserSessionRef}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`,
      });
      reply.end();
      return;
    }
    app.routing(request, reply);
  };

  const server = tls === null ? createServer(handler) : createSecureServer({ cert: tls.cert, key: tls.key }, handler);
  // The outer server owns the listening socket, so Fastify's own `upgrade` listener — the one
  // `@fastify/websocket` installs on `app.server` — never sees a byte unless we hand it over. Without
  // this, `/api/pty` answers an upgrade with a router 404 and the whole WS surface is untestable here
  // while production (which listens on `app.server` directly) works. Registered before `listen`, and
  // fail-closed during the window where the app is still being built.
  // Every socket handed to Fastify, so shutdown can destroy it. Node stops tracking a socket the moment
  // it emits `upgrade`, so neither `close()` nor `closeAllConnections()` can reach one afterwards - a
  // single refused handshake would otherwise leave `server.close()` pending forever.
  const upgraded = new Set<Duplex>();
  server.on('upgrade', (request, socket, head) => {
    upgraded.add(socket);
    socket.once('close', () => upgraded.delete(socket));
    if (app === null) socket.destroy();
    else app.server.emit('upgrade', request, socket, head);
  });
  await new Promise<void>((settle, fail) => {
    const onError = (error: Error): void => fail(error);
    server.once('error', onError);
    server.listen({ host: '127.0.0.1', port }, () => {
      server.off('error', onError);
      settle();
    });
  });
  const address = server.address() as AddressInfo;
  const origin = `${tls === null ? 'http' : 'https'}://127.0.0.1:${address.port}`;
  if (tls !== null) publishLoopbackCertificate(address.port, tls.cert);

  // One probe of the composed host, before the app exists — the same single composition-time probe
  // `start()` performs in production.
  let ptyCapability: PublicPtyCapability;
  try {
    ptyCapability = toPublicPtyCapability(await sessionHost.probe());
  } catch {
    ptyCapability = unavailablePtyCapability(process.platform, new Date().toISOString());
  }

  const writerLease = acquireWriterLease({ stateRoot, bootId: `p3-fixture-${process.pid}` });
  const browserSessionRefs = createMemoryBrowserSessionRefs();
  const sessionConfig = { secret: randomBytes(32), ttlMs: 60 * 60 * 1000 };

  app = buildApp({
    validateData: false,
    repoRoot,
    traceRoot: null,
    allowedOrigins: [origin],
    sessionConfig,
    // The published capability is the host's OWN probe, never a literal. A hard-coded `pty: true`
    // here is what let the §7 smoke reach WS create against a real host whose probe had refused
    // (`root-policy-invalid`), i.e. the surface advertised a terminal the host would not build.
    // Composition is fail-closed in exactly the production direction: a refusing — or throwing —
    // probe publishes the closed capability, and the launchers advertised are the launchers the pin
    // validator accepted, nothing more.
    // Typed, not cast: `RuntimeCapabilities` is the host slice plus the published PTY capability, so a
    // shape drift in `toPublicPtyCapability` fails HERE at compile time instead of at fixture runtime.
    runtimeCapabilities: { ...runtimeHostCapabilities(), ...ptyCapability },
    ptySessionHost: sessionHost,
    browserSessionRefs,
    // A REAL writer lease, but over this fixture's throwaway state root: boot performs control-plane
    // writes, so a read-only harness cannot start, and taking the daemon's own state root would contend
    // with a dashboard running on this machine. A fresh temp root gives the production write path with
    // nothing of Daniel's behind it.
    fileControlAccess: { mode: 'already-locked', lease: writerLease },
  });
  await app.ready();

  async function mintContext(label: P3FixtureContext['label'], operator: string): Promise<P3FixtureContext> {
    const minted = await browserSessionRefs.mint();
    if (!minted.ok) throw new Error(`p3AuthenticatedServer: could not mint a ref for ${label}`);
    return {
      label,
      operator,
      browserSessionRef: minted.value.browserSessionRef,
      cookie: minted.value.cookie ?? '',
      token: mintSession(operator, sessionConfig).token,
      entryUrl: `${origin}/fixture/context-${label}`,
    };
  }

  const a = await mintContext('a', 'operator-a');
  const b = await mintContext('b', 'operator-b');
  // A's second tab reuses A's ref AND A's operator — the same principal, a different socket.
  const aSecondTab: P3FixtureContext = {
    ...a, label: 'a-second-tab', entryUrl: `${origin}/fixture/context-a-second-tab`,
  };
  contextsByPath = new Map<string, P3FixtureContext>([
    ['/fixture/context-a', a],
    ['/fixture/context-b', b],
    ['/fixture/context-a-second-tab', aSecondTab],
  ]);

  // Published AFTER the contexts exist and BEFORE the banner: the lifecycle only reads it once
  // `/readyz` answers, so a half-written principal can never be handed to a client.
  publishFixturePrincipal(address.port, {
    origin,
    token: a.token,
    browserSessionRef: a.browserSessionRef,
    contextPath: '/fixture/context-a',
  });

  let closed = false;
  return {
    origin,
    address: { host: '127.0.0.1', port: address.port },
    certificate: tls === null ? null : tls.cert,
    contexts: { a, b, aSecondTab },
    realWindowsHost,
    usageBanner(): string {
      // Tokens are printed because the §7 client is a NODE process on this machine, not a browser; the
      // secret they are signed with dies with this fixture and authorises nothing else.
      return [
        `[p3-authenticated] ${origin}`,
        `[p3-authenticated] host=${realWindowsHost ? 'real-windows' : 'deterministic'} stateRoot=${stateRoot}`,
        `[p3-authenticated] context A ${a.entryUrl} ref=${a.browserSessionRef} token=${a.token}`,
        `[p3-authenticated] context B ${b.entryUrl} ref=${b.browserSessionRef} token=${b.token}`,
        `[p3-authenticated] context A2 ${aSecondTab.entryUrl} (same operator + same ref as A)`,
      ].join('\n');
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      revokeFixturePrincipal(address.port);
      if (tls !== null) revokeLoopbackCertificate(address.port);
      for (const socket of upgraded) socket.destroy();
      upgraded.clear();
      await new Promise<void>((settle, fail) => {
        server.close((error) => error ? fail(error) : settle());
        // An upgraded WebSocket (or an idle keep-alive socket) would keep `close` pending forever.
        server.closeAllConnections();
      });
      if (app !== null) await app.close();
      writerLease.release();
      if (previousStateRoot === undefined) delete process.env.DASHBOARD_STATE_ROOT;
      else process.env.DASHBOARD_STATE_ROOT = previousStateRoot;
    },
  };
}

export function parseP3AuthenticatedServerArgs(argv: readonly string[]): P3AuthenticatedServerOptions {
  const options: P3AuthenticatedServerOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--port') {
      if (value === undefined) throw new Error('p3AuthenticatedServer: --port needs a value');
      options.port = Number.parseInt(value, 10);
      index += 1;
    } else if (flag === '--https') {
      options.https = true;
    } else if (flag === '--real-windows-host') {
      options.realWindowsHost = true;
    } else if (flag === '--scenario') {
      // Accepted and ignored: the lifecycle wrapper forwards it uniformly for both fixtures.
      index += 1;
    } else {
      throw new Error(`p3AuthenticatedServer: unknown argument ${String(flag)}`);
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startP3AuthenticatedServer(parseP3AuthenticatedServerArgs(process.argv.slice(2)))
    .then((fixture) => { console.log(fixture.usageBanner()); })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
