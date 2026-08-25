// Dashboard v3 P5 W2 — the desktop-helper CLIENT. This is the ONLY module in `dashboard/server` permitted
// to speak the helper protocol [P5-C16]. It consumes the W0-frozen request union, receipt record, and
// derived `HelperOutcome` (`deploy/contracts.ts`) and the schema wall (`helper/protocolCheck.ts`), and it
// owns three behaviours the wire shapes cannot express:
//   - the movement:235 one-deploy-plus-five-minute cooldown, and independently idempotent pull/result;
//   - a bounded HTTPS transport (20-second timeout, no redirects) to a REQUIRED tailnet origin;
//   - the design 667 version handshake that fails closed before the first Deploy/Pull of a daemon lifetime.
// It never learns a helper filesystem path, and no verb ever carries a path, host, command, or key.
import {
  decodeHelperReceipt, deriveHelperOutcome, encodeHelperRequest,
} from './contracts.ts';
import type { HelperOutcome, HelperRefusalCode, HelperRequest, HelperVerb } from './contracts.ts';
import { assertAdvertised, assertReceiptValid, assertRequestValid } from './helper/protocolCheck.ts';

/** movement:235 — Deploy permits one request plus a five-minute cooldown. */
export const DEPLOY_COOLDOWN_MS = 5 * 60 * 1000;
/** §3.4 — the helper transport is a bounded HTTPS call with a 20-second timeout and no redirects. */
export const TRANSPORT_TIMEOUT_MS = 20 * 1000;

/** Composition failed: the pinned helper origin is missing, non-`https:`, or non-tailnet [P5-C42]. */
export class HelperCompositionError extends Error {
  constructor(detail: string) {
    super(`DASHBOARD_DESKTOP_HELPER_ORIGIN ${detail}`);
    this.name = 'HelperCompositionError';
  }
}

/**
 * Validate and normalise the pinned desktop-helper origin. It MUST be an absolute `https:` URL whose host
 * is a tailnet name (`*.ts.net`), with no path, query, or fragment. A missing or malformed value FAILS
 * COMPOSITION — the client is never constructed against a default [P5-C42].
 */
export function assertHelperOrigin(value: string | undefined | null): string {
  if (typeof value !== 'string' || value.length === 0) throw new HelperCompositionError('is required');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HelperCompositionError('is not a valid absolute URL');
  }
  if (url.protocol !== 'https:') throw new HelperCompositionError('must be an https: origin');
  if (!/\.ts\.net$/.test(url.hostname)) throw new HelperCompositionError('must be a tailnet (*.ts.net) host');
  if ((url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') {
    throw new HelperCompositionError('must be a bare origin with no path, query, or fragment');
  }
  return url.origin;
}

/** Reads the pinned origin from the injected environment. Never defaults. */
export function helperOriginFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return assertHelperOrigin(env['DASHBOARD_DESKTOP_HELPER_ORIGIN']);
}

export type HelperFetch = (url: string, init: HelperFetchInit) => Promise<HelperFetchResponse>;
export interface HelperFetchInit {
  readonly method: 'GET' | 'POST';
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal: AbortSignal;
  readonly redirect: 'error';
}
export interface HelperFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** One deduplicated escalation card per failed handshake (P4 reconciliation publisher, wired by W6.1). */
export type HelperEscalate = (input: { verb: HelperVerb; reason: string }) => void;

export interface HelperClientOptions {
  /** Raw `DASHBOARD_DESKTOP_HELPER_ORIGIN`; validated at construction, never defaulted. */
  readonly origin: string | undefined | null;
  readonly fetch?: HelperFetch;
  readonly now?: () => number;
  readonly escalate?: HelperEscalate;
  readonly timeoutMs?: number;
  readonly cooldownMs?: number;
}

export type HelperInvokeResult =
  | { readonly ok: true; readonly outcome: HelperOutcome }
  | { readonly ok: false; readonly code: HelperRefusalCode };

export interface HelperClient {
  invoke(request: HelperRequest, options: { idempotencyKey: string }): Promise<HelperInvokeResult>;
}

const INVOKE_PATH = '/deploy-helper/invoke';
const PROTOCOL_PATH = '/deploy-helper/protocol';
/** Only `deploy` and `pull-assets` gate on a version advertisement (movement:235; §3.4). */
const HANDSHAKE_VERBS: ReadonlySet<HelperVerb> = new Set<HelperVerb>(['deploy', 'pull-assets']);

function refuse(code: HelperRefusalCode): HelperInvokeResult {
  return { ok: false, code };
}

/**
 * Construct the one helper client. Throws `HelperCompositionError` synchronously if the pinned origin is
 * absent or not an `https:` tailnet origin — a missing helper address is a composition failure, not a
 * runtime refusal [P5-C42].
 */
export function createHelperClient(options: HelperClientOptions): HelperClient {
  const origin = assertHelperOrigin(options.origin);
  const doFetch = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? TRANSPORT_TIMEOUT_MS;
  const cooldownMs = options.cooldownMs ?? DEPLOY_COOLDOWN_MS;
  const escalate = options.escalate;

  // Per-daemon-lifetime state. All in-memory; the client holds no store handle and writes nothing.
  const idempotent = new Map<string, HelperInvokeResult>();
  const handshakeOk = new Set<HelperVerb>();
  const handshakeBlocked = new Set<HelperVerb>();
  let lastDeployAt: number | null = null;

  async function bounded<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /** design 667 handshake, once per verb per lifetime. On failure, block the verb and escalate once. */
  async function handshake(verb: HelperVerb): Promise<boolean> {
    if (!HANDSHAKE_VERBS.has(verb) || handshakeOk.has(verb)) return true;
    if (handshakeBlocked.has(verb)) return false;
    let advertised: string | null = null;
    try {
      const body = await bounded((signal) => doFetch(`${origin}${PROTOCOL_PATH}?verb=${verb}`, {
        method: 'GET', headers: { accept: 'application/json' }, signal, redirect: 'error',
      }).then((response) => (response.ok ? response.json() : null)));
      if (body && typeof body === 'object' && typeof (body as { version?: unknown }).version === 'string') {
        advertised = (body as { version: string }).version;
      }
    } catch {
      advertised = null;
    }
    try {
      assertAdvertised(verb, advertised);
    } catch (error) {
      handshakeBlocked.add(verb);
      escalate?.({ verb, reason: error instanceof Error ? error.message : 'protocol version handshake failed' });
      return false;
    }
    handshakeOk.add(verb);
    return true;
  }

  async function transport(request: HelperRequest): Promise<HelperInvokeResult> {
    let body: unknown;
    try {
      body = await bounded((signal) => doFetch(`${origin}${INVOKE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: encodeHelperRequest(request),
        signal,
        redirect: 'error',
      }).then((response) => (response.ok ? response.json() : Promise.reject(new Error(`status ${response.status}`)))));
    } catch {
      return refuse('helper-unreachable');
    }
    // Both directions against protocol.schema.json, then the contracts closed-key decode. Any extra key,
    // unknown outcome, or signature/key-shaped field fails closed as protocol-invalid and never stored.
    try {
      assertReceiptValid(body);
    } catch {
      return refuse('protocol-invalid');
    }
    let receipt;
    try {
      receipt = decodeHelperReceipt(body);
    } catch {
      return refuse('protocol-invalid');
    }
    if (request.verb === 'deploy' && receipt.requestRef !== request.requestRef) {
      return refuse('protocol-invalid');
    }
    switch (receipt.outcome) {
      case 'accepted':
        return { ok: true, outcome: deriveHelperOutcome(request.verb, receipt) };
      case 'refused':
        return refuse('helper-refused');
      case 'failed':
        return refuse('helper-failed');
      default:
        return refuse('protocol-invalid');
    }
  }

  return {
    async invoke(request, invokeOptions) {
      const idempotencyKey = invokeOptions.idempotencyKey;
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
        return refuse('protocol-invalid');
      }
      // Outbound schema + contracts wall before anything else — nothing path/host/command/key-shaped serializes.
      try {
        assertRequestValid(request);
        encodeHelperRequest(request);
      } catch {
        return refuse('protocol-invalid');
      }

      // Idempotent replay: a repeat with the same verb+key returns the original result and never re-sends,
      // so deploy replays bypass the cooldown and pull/result are independently idempotent (movement:235).
      const cacheKey = `${request.verb} ${idempotencyKey}`;
      const cached = idempotent.get(cacheKey);
      if (cached) return cached;

      if (!(await handshake(request.verb))) return refuse('protocol-invalid');

      if (request.verb === 'deploy') {
        if (lastDeployAt !== null && now() - lastDeployAt < cooldownMs) {
          return refuse('helper-refused');
        }
        lastDeployAt = now(); // one request consumes the slot regardless of outcome (movement:235 cooldown)
      }

      const result = await transport(request);
      idempotent.set(cacheKey, result);
      return result;
    },
  };
}

const defaultFetch: HelperFetch = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    redirect: init.redirect,
  });
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
  };
};
