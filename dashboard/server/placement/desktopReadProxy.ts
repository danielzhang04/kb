// P6 W5 §3.5/§3.6, P6-C53: the Desktop UI's ONLY path to VM run state. A read-only v1 proxy forwarding
// EXACTLY `GET /api/v1/runs/:runRef/events` (including the `text/event-stream` form) and
// `GET /api/v1/runs/:runRef/gates` to the pinned VM origin, over `desktopClient.ts`'s transport.
//
// The method+path ALLOWLIST below is evaluated BEFORE any call reaches `desktopClient.ts` — a
// disallowed request never leaves the machine. In particular the human-response route
// (`POST /api/v1/runs/:runRef/human-requests/:requestRef/respond`) and any VM-store write (any method
// other than GET, on any path) are refused here, structurally, by omission from the allowlist: this
// file registers NO route that mutates anything, on either host.
import type { DesktopClient, DesktopClientResponse } from './desktopClient.ts';

export type DesktopReadProxyRoute = 'run-events' | 'run-gates';

const ALLOWLIST: ReadonlyArray<{ readonly route: DesktopReadProxyRoute; readonly method: 'GET'; readonly pattern: RegExp }> = [
  { route: 'run-events', method: 'GET', pattern: /^\/api\/v1\/runs\/([^/]+)\/events$/ },
  { route: 'run-gates', method: 'GET', pattern: /^\/api\/v1\/runs\/([^/]+)\/gates$/ },
];

export type ProxyDecision =
  | { readonly allow: true; readonly route: DesktopReadProxyRoute; readonly runRef: string }
  | { readonly allow: false; readonly status: 404 | 405 };

/**
 * Evaluate a proxy request against the closed allowlist. This is a pure function with no side effect
 * and no transport call — the caller checks this FIRST, always, so a disallowed request is refused
 * before anything leaves the machine.
 */
export function evaluateProxyRequest(method: string, path: string): ProxyDecision {
  const pathMatches = ALLOWLIST.filter((rule) => rule.pattern.test(path));
  if (pathMatches.length === 0) return { allow: false, status: 404 };
  const methodMatch = pathMatches.find((rule) => rule.method === method);
  if (!methodMatch) return { allow: false, status: 405 };
  const runRef = path.match(methodMatch.pattern)![1]!;
  return { allow: true, route: methodMatch.route, runRef };
}

export interface ForwardOptions {
  readonly cursor?: string;
  readonly accept?: 'json' | 'event-stream';
}

/**
 * Forward one request through the allowlist. On refusal, `client` is NEVER called — proven by the
 * refusal tests passing a transport that throws if it is ever invoked. On allow, the runRef parsed
 * from the path is handed straight to `desktopClient.ts` with NO re-derivation, so a VM-minted cursor
 * passed in `opts.cursor` reaches the VM byte-for-byte unchanged [P6-C41].
 */
export async function forwardDesktopReadProxy(
  client: DesktopClient,
  method: string,
  path: string,
  opts: ForwardOptions = {},
): Promise<DesktopClientResponse> {
  const decision = evaluateProxyRequest(method, path);
  if (!decision.allow) {
    return { status: decision.status, headers: {}, body: JSON.stringify({ error: { code: 'not-found', message: 'path not proxied' } }) };
  }
  if (decision.route === 'run-events') {
    return client.getRunEvents(decision.runRef, { cursor: opts.cursor, accept: opts.accept });
  }
  return client.getRunGates(decision.runRef);
}
