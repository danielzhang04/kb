/**
 * Shared core for the loopback browser-fixture HTTP(S) servers (`p1BrowserFixture.ts`,
 * `p5FixtureServer.ts`). Extracted per docs/plans/2026-08-26-vm-runtime-streamline-design.md §4
 * Slice D: both fixtures carried a byte-identical path-traversal-safe static-file resolver, an
 * identical `CONTENT_TYPES` map, and the same listen/TLS/origin/close bootstrap around whatever
 * request handler each fixture builds. Each fixture keeps its own request handler, its own extra
 * close-time cleanup (timers, in-flight streams, pending inbox releases, ...), and its own
 * host/port/distDir validation messages, which differ per fixture.
 */
import { statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { resolve, sep } from 'node:path';
import {
  createLoopbackTlsMaterial, publishLoopbackCertificate, revokeLoopbackCertificate,
} from './p3LoopbackTls.ts';

export const CONTENT_TYPES: Record<string, string> = {
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

/** Resolves a URL pathname to a file under `distDir`, refusing traversal outside it. Returns null for
 *  anything unsafe or missing (never throws). */
export function safeStaticFile(distDir: string, pathname: string): string | null {
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

export interface LoopbackHttpServerOptions {
  host: '127.0.0.1';
  port: number;
  /** Serve TLS with a per-process self-signed loopback certificate (see `p3LoopbackTls.ts`). */
  https?: boolean;
}

export interface LoopbackHttpServer {
  address: { host: '127.0.0.1'; port: number };
  origin: string;
  /** The PEM a client pins to reach an HTTPS fixture; null when serving plain HTTP. */
  certificate: string | null;
  /** Closes the server (idempotent). `cleanup`, if given, runs after the TLS cert is revoked and
   *  before the HTTP server itself closes — the caller's spot for its own timers/streams/pending work. */
  close(cleanup?: () => void): Promise<void>;
}

/**
 * Starts a bounded loopback HTTP(S) server for the given request handler: creates the TLS material
 * (if requested), binds `options.port` on `options.host`, and returns the address/origin/certificate
 * plus a `close()` that revokes the published certificate and closes the server. Never registered by
 * production — test-fixture only.
 */
export async function startLoopbackHttpServer(
  options: LoopbackHttpServerOptions,
  handler: (request: IncomingMessage, reply: ServerResponse) => void | Promise<void>,
): Promise<LoopbackHttpServer> {
  const wrapped = (request: IncomingMessage, reply: ServerResponse): void => {
    void handler(request, reply);
  };
  const tls = options.https === true ? await createLoopbackTlsMaterial() : null;
  const server = tls === null
    ? createServer(wrapped)
    : createSecureServer({ cert: tls.cert, key: tls.key }, wrapped);

  await new Promise<void>((resolveListen, rejectListen) => {
    const fail = (error: Error): void => rejectListen(error);
    server.once('error', fail);
    server.listen({ host: options.host, port: options.port }, () => {
      server.off('error', fail);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo;
  const origin = `${tls === null ? 'http' : 'https'}://127.0.0.1:${address.port}`;
  if (tls !== null) publishLoopbackCertificate(address.port, tls.cert);

  let closed = false;
  return {
    address: { host: '127.0.0.1', port: address.port },
    origin,
    certificate: tls === null ? null : tls.cert,
    async close(cleanup?: () => void): Promise<void> {
      if (closed) return;
      closed = true;
      if (tls !== null) revokeLoopbackCertificate(address.port);
      cleanup?.();
      await new Promise<void>((resolveClose, rejectClose) => (
        server.close((error) => (error ? rejectClose(error) : resolveClose()))
      ));
    },
  };
}
