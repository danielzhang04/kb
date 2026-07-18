/**
 * U2 — the governed write surface's composition root. Builds one encapsulated Fastify child scope that
 * applies, as `onRequest` hooks in this exact order, the SAME primitives the hub already uses:
 *
 *   1. `security/origin.ts#originPlugin`   — Origin/Host guard (fail-closed: empty allowlist 403s all).
 *   2. `http/middleware.ts#writeRateLimitHook` — sliding-window rate-limit + lockout.
 *
 * then registers the auth / write / vibe / approvals routes onto that scope (each mutating route adds
 * its own `requireSession` preHandler, so the full chain is origin -> rate-limit -> session -> gate ->
 * audit). `/healthz` and the read-only hub/registry/planeA routes stay OUTSIDE this scope — untouched.
 *
 * All security config is resolved ONCE here (notably the session secret — re-resolving per request would
 * mint a fresh random secret and invalidate every token). Tests call `makeSurfaceContext` with overrides
 * to inject hermetic runners and a test allowlist/credential store; production passes none and every
 * gate falls back to its real default.
 */
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { resolveSessionSecret, resolveSessionTtlMs } from '../auth/session.ts';
import { resolveAllowedOrigins, originPlugin } from '../security/origin.ts';
import { resolveWebAuthnConfig } from '../auth/webauthn.ts';
import { resolveCredentials } from '../auth/credentialStore.ts';
import { makeDefaultWriteRateGuard, writeRateLimitHook } from './middleware.ts';
import type { SurfaceContext } from './context.ts';
import { registerAuthRoutes } from '../auth/routes.ts';
import { registerWriteRoutes } from '../write/routes.ts';
import { registerVibeRoutes } from '../vibe/routes.ts';
import { registerComposerRoutes } from '../composer/routes.ts';
import { createResumeRegistry } from '../composer/resumeRegistry.ts';
import { registerApprovalsRoutes } from '../approvals/routes.ts';

/** dashboard/server/http/surface.ts -> ../../../ is the repo root. Overridable via env / tests. */
export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

export function resolveDurableRepoRoot(): string {
  return process.env.DASHBOARD_DURABLE_REPO_ROOT ?? resolveRepoRoot();
}

/** Build a full {@link SurfaceContext}, filling every field not supplied in `overrides` with its real
 *  default. `sessionConfig`'s secret is resolved exactly once (see module doc). */
export function makeSurfaceContext(overrides: Partial<SurfaceContext> = {}): SurfaceContext {
  return {
    repoRoot: overrides.repoRoot ?? resolveRepoRoot(),
    durableRepoRoot: overrides.durableRepoRoot ?? overrides.repoRoot ?? resolveDurableRepoRoot(),
    sessionConfig: overrides.sessionConfig ?? { secret: resolveSessionSecret(), ttlMs: resolveSessionTtlMs() },
    allowedOrigins: overrides.allowedOrigins ?? resolveAllowedOrigins(),
    rateGuard: overrides.rateGuard ?? makeDefaultWriteRateGuard(),
    // Lazy: resolveWebAuthnConfig throws when DASHBOARD_RP_ORIGIN is unset — only called inside a handler
    // (which the origin guard has already blocked when the allowlist is empty), never at registration.
    webAuthnConfig: overrides.webAuthnConfig ?? (() => resolveWebAuthnConfig()),
    credentials: overrides.credentials ?? (() => resolveCredentials()),
    appendAudit: overrides.appendAudit,
    appendAuditLocal: overrides.appendAuditLocal,
    opsGit: overrides.opsGit,
    saveGit: overrides.saveGit,
    openPr: overrides.openPr,
    runPy: overrides.runPy,
    runPreamble: overrides.runPreamble,
    spawn: overrides.spawn,
    vibeRateGuard: overrides.vibeRateGuard,
    now: overrides.now,
    // One issued-session allowlist for the whole process (review F1) — resumes only ids captured this
    // lifetime. Tests override with a fresh instance so ids never leak between them.
    resumeRegistry: overrides.resumeRegistry ?? createResumeRegistry(),
    triggerRunner: overrides.triggerRunner,
  };
}

/** Register the governed write surface (auth + write + vibe + approvals) as one guarded child scope. */
export function registerWriteSurface(app: FastifyInstance, ctx: SurfaceContext = makeSurfaceContext()): void {
  app.register(async (scope) => {
    // Order matters: origin guard first (fail-closed), then the rate-limiter, both as onRequest hooks.
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('onRequest', writeRateLimitHook(ctx.rateGuard));

    registerAuthRoutes(scope, ctx);
    registerWriteRoutes(scope, ctx);
    registerVibeRoutes(scope, ctx);
    registerComposerRoutes(scope, ctx);
    registerApprovalsRoutes(scope, ctx);
  });
}
