/**
 * The operator-authentication contract shared by both auth modes, plus the per-request attribution
 * channel the audit ledger reads.
 *
 * An {@link OperatorAuth} answers one question: "is this request the operator, and if so, who is it
 * attributable to?" `win32-desktop` mode has no implementation here — its answer is the WebAuthn session
 * bearer that `http/middleware.ts` already verifies. `tailnet` mode supplies
 * `tailnetOperator.ts#createTailnetOperatorAuth`.
 *
 * Attribution rides an `AsyncLocalStorage` rather than being threaded through ~30 audit call sites. The
 * auth middleware binds it once per request; `http/context.ts#auditFn` — the single funnel every route
 * already writes rows through — reads it back. That keeps the mode a seam instead of a per-route edit,
 * and it cannot race: each request handler runs in its own async context.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** Who a request is attributable to. NEVER an authentication input — the transport proof is. */
export interface OperatorAttribution {
  /** The tailnet login, e.g. `daniel.zhang.t1@gmail.com`. */
  login: string;
  /** Display name, when the proxy supplies one. */
  name?: string;
}

export type OperatorAuthResult =
  | { ok: true; subject: string; attribution: OperatorAttribution }
  | {
    ok: false;
    reason: 'untrusted-peer' | 'no-tailnet-identity' | 'identity-not-allowed' | 'cross-site';
  };

/** The minimal request shape an operator authenticator reads — headers plus the raw socket endpoints. */
export interface OperatorRequestLike {
  headers: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string | undefined;
    remotePort?: number | undefined;
    localAddress?: string | undefined;
    localPort?: number | undefined;
  } | undefined;
}

export interface OperatorAuth {
  authenticate(req: OperatorRequestLike): OperatorAuthResult;
}

/** Re-exported so callers need one import for "the operator identity" concept. */
export { OPERATOR_SUBJECT } from './mode.ts';

const attribution = new AsyncLocalStorage<OperatorAttribution | undefined>();

/**
 * Bind `value` as the attribution for the remainder of this request's async context. `enterWith` is used
 * (rather than `run`) because a Fastify `preHandler` returns before the handler runs and therefore cannot
 * wrap it in a callback; entering the store marks the current async context, which the handler inherits.
 *
 * `enterWith` mutates the current async context, which a keep-alive connection can share across requests,
 * so a stale value could in principle bleed into a later request that did not rebind. {@link resetAttribution}
 * closes that: it is called at the top of `http/middleware.ts#resolveSession`, the ONE function every
 * governed (audit-writing) request traverses, so each request starts from a clean store and the operator
 * path rebinds. There is therefore no request that both writes an audit row and inherits a prior request's
 * attribution — which is the invariant the audit stamp relies on.
 */
export function bindAttribution(value: OperatorAttribution): void {
  attribution.enterWith(value);
}

/** Clear any inherited attribution at the start of a request (see {@link bindAttribution}). */
export function resetAttribution(): void {
  attribution.enterWith(undefined);
}

/** The attribution bound for the current request, or `undefined` (always so in `win32-desktop` mode). */
export function currentAttribution(): OperatorAttribution | undefined {
  return attribution.getStore();
}

/** The single-line form stamped into an audit row's `detail.tailnetIdentity`. */
export function attributionLabel(value: OperatorAttribution): string {
  return value.name ? `${value.name} <${value.login}>` : value.login;
}
