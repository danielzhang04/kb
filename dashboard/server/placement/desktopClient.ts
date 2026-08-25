// P6 W5 §5, P6-C29: `desktopClient.ts` is the ONLY daemon-to-daemon outbound module in `dashboard/server`
// (`control/paidActionProviders.ts`'s injectable `fetchImpl` is the separate, named, read-only external
// -provider exception — not cross-host). Its base URL is a PINNED `/api/v1` origin: a bare host string
// is refused before it can ever be used to build a request. It talks to the VM's four node routes
// (`design:456-459` verbatim paths) plus the two read-only routes `desktopReadProxy.ts` forwards.
//
// Transport is INJECTED (`DesktopClientTransport`) — no real network call happens in any test in this
// package, and no other file under `placement/` may hold its own transport.
import { decodeClaimRequest, decodeRenewRequest } from '../api/v1/contracts.ts';
import type { HostKind } from './contracts.ts';

/**
 * An absolute http(s) URL ending EXACTLY in `/api/v1` — never a bare host, never a trailing slash.
 * The host segment excludes `@` (and whitespace) so a userinfo-bearing origin like
 * `https://vm.example@attacker.com/api/v1` — which browsers/fetch resolve to host `attacker.com` —
 * is refused rather than accepted on the spoofed `vm.example` prefix (W5b fix #3).
 */
const API_V1_ORIGIN = /^https?:\/\/[^\s/@]+(?::\d+)?\/api\/v1$/;

export function assertApiV1Origin(origin: unknown): string {
  if (typeof origin !== 'string' || !API_V1_ORIGIN.test(origin)) {
    throw new RangeError(
      `desktopClient: origin must be an absolute http(s) URL ending in "/api/v1" (a bare host is refused), got ${JSON.stringify(origin)}`,
    );
  }
  return origin;
}

export interface DesktopClientResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The one shape every outbound call goes through. No test ever supplies a real `fetch`. */
export interface DesktopClientTransport {
  send(request: {
    readonly method: 'GET' | 'POST';
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  }): Promise<DesktopClientResponse>;
}

export interface DesktopClient {
  readonly origin: string;
  claim(hostId: HostKind, waitMs: number): Promise<DesktopClientResponse>;
  renew(runRef: string, expectedLeaseRevision: number): Promise<DesktopClientResponse>;
  report(
    runRef: string,
    body: { expectedLeaseRevision: number; sequence: number; kind: string; payload: Record<string, unknown> },
    idempotencyKey: string,
  ): Promise<DesktopClientResponse>;
  getRunEvents(runRef: string, opts?: { cursor?: string; accept?: 'json' | 'event-stream' }): Promise<DesktopClientResponse>;
  getRunGates(runRef: string): Promise<DesktopClientResponse>;
}

function safeRunRef(runRef: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runRef)) throw new RangeError(`desktopClient: unsafe runRef ${JSON.stringify(runRef)}`);
  return runRef;
}

/**
 * Build a Desktop-to-VM client. `origin` is validated once, at construction, so an unpinned base URL
 * fails before any request is ever attempted [P6-C29]. Claim/renew/report carry NO `Idempotency-Key`
 * — all three are exempt (`§3.4`: each is already a no-op-by-CAS or sequence-pinned replay) — the
 * `idempotencyKey` parameter on `report()` exists only so a caller-side retry wrapper can prove it
 * reuses one token across attempts of the same logical call; it is not sent as a header.
 */
export function createDesktopClient(origin: string, transport: DesktopClientTransport): DesktopClient {
  const base = assertApiV1Origin(origin);
  return {
    origin: base,
    async claim(hostId, waitMs) {
      const { waitMs: validWaitMs } = decodeClaimRequest({ waitMs });
      return transport.send({
        method: 'POST',
        url: `${base}/hosts/${hostId}/leases/claim`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ waitMs: validWaitMs }),
      });
    },
    async renew(runRef, expectedLeaseRevision) {
      const decoded = decodeRenewRequest({ expectedLeaseRevision });
      return transport.send({
        method: 'POST',
        url: `${base}/runs/${safeRunRef(runRef)}/leases/renew`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(decoded),
      });
    },
    async report(runRef, body, _idempotencyKey) {
      return transport.send({
        method: 'POST',
        url: `${base}/runs/${safeRunRef(runRef)}/reports`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    async getRunEvents(runRef, opts = {}) {
      const query = opts.cursor ? `?cursor=${encodeURIComponent(opts.cursor)}` : '';
      const headers: Record<string, string> = {};
      if (opts.accept === 'event-stream') headers.accept = 'text/event-stream';
      return transport.send({ method: 'GET', url: `${base}/runs/${safeRunRef(runRef)}/events${query}`, headers });
    },
    async getRunGates(runRef) {
      return transport.send({ method: 'GET', url: `${base}/runs/${safeRunRef(runRef)}/gates`, headers: {} });
    },
  };
}
