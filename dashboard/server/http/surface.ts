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
import { createProviderIdProtector } from '../composer/protector.ts';
import { createFileComposerStore, resolveDashboardStateRoot } from '../composer/store.ts';
import { registerApprovalsRoutes } from '../approvals/routes.ts';
import { drainVibeProcesses } from '../vibe/session.ts';
import { drainAsyncGit } from '../write/asyncGit.ts';
import { createFileControlPlaneStore } from '../control/store.ts';
import { createFileDefinitionAmendmentStore } from '../workflows/amendmentStore.ts';
import { registerControlRoutes } from '../control/routes.ts';
import { buildActivatedExecution } from '../control/activation.ts';
import { RunControlTransactions } from '../control/runTransactions.ts';
import { DEFAULT_MANAGER_START_ACK_TIMEOUT_MS } from '../control/execution.ts';

/** dashboard/server/http/surface.ts -> ../../../ is the repo root. Overridable via env / tests. */
export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

export function resolveDurableRepoRoot(): string {
  return process.env.DASHBOARD_DURABLE_REPO_ROOT ?? resolveRepoRoot();
}

/**
 * Optional seam for the Wave-A executor activation. Production passes nothing: `build` defaults to the
 * real `buildActivatedExecution` and `env` to `process.env`, so the gate (`DASHBOARD_EXECUTION_ACTIVATED`)
 * is read from the real environment and the executor is constructed only when it is `'1'`. Tests inject a
 * hermetic `build`/`env` so the gate-on wiring is exercised without shelling git or touching the fs.
 */
export interface SurfaceActivationSeam {
  build?: typeof buildActivatedExecution;
  env?: Record<string, string | undefined>;
}

/** Build a full {@link SurfaceContext}, filling every field not supplied in `overrides` with its real
 *  default. `sessionConfig`'s secret is resolved exactly once (see module doc). */
export function makeSurfaceContext(
  overrides: Partial<SurfaceContext> = {},
  activation: SurfaceActivationSeam = {},
): SurfaceContext {
  const sessionConfig = overrides.sessionConfig ?? { secret: resolveSessionSecret(), ttlMs: resolveSessionTtlMs() };
  const repoRoot = overrides.repoRoot ?? resolveRepoRoot();
  const stateRoot = overrides.stateRoot ?? resolveDashboardStateRoot();
  const controlStore = overrides.controlStore ?? createFileControlPlaneStore(stateRoot);
  // Wave-A executor activation (env-gated, default OFF). When any of the three executor fields is already
  // supplied as an override (tests, or a future explicit injection), activation is skipped entirely so no
  // construction is attempted. Otherwise `buildActivatedExecution` returns `null` unless the gate is on —
  // meaning production, gate absent, constructs no broker/engine and spawns no `claude` (the core inert
  // invariant): the executor fields below stay `undefined` exactly as today.
  const activationOverridden = overrides.controlBroker !== undefined
    || overrides.runAutomatic !== undefined
    || overrides.cancelAutomatic !== undefined
    || overrides.containManagerStart !== undefined
    || overrides.verifyCanonicalResult !== undefined;
  const build = activation.build ?? buildActivatedExecution;
  const activated = activationOverridden
    ? null
    : build({ env: activation.env, controlStore, repoRoot, stateRoot });
  const definitionAmendmentStore = overrides.definitionAmendmentStore ?? createFileDefinitionAmendmentStore(stateRoot);
  return {
    repoRoot,
    stateRoot,
    definitionAmendmentStore,
    durableRepoRoot: overrides.durableRepoRoot ?? overrides.repoRoot ?? resolveDurableRepoRoot(),
    sessionConfig,
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
    activateManagedRoots: overrides.activateManagedRoots,
    spawn: overrides.spawn,
    vibeRateGuard: overrides.vibeRateGuard,
    now: overrides.now,
    // One issued-session allowlist for the whole process (review F1) — resumes only ids captured this
    // lifetime. Tests override with a fresh instance so ids never leak between them.
    resumeRegistry: overrides.resumeRegistry ?? createResumeRegistry(),
    composerStore:
      overrides.composerStore ??
      createFileComposerStore(stateRoot, {
        protector: createProviderIdProtector(sessionConfig.secret),
      }),
    controlStore,
    controlBroker: overrides.controlBroker ?? activated?.controlBroker,
    runAutomatic: overrides.runAutomatic ?? activated?.runAutomatic,
    cancelAutomatic: overrides.cancelAutomatic ?? activated?.cancelAutomatic,
    containManagerStart: overrides.containManagerStart ?? activated?.containManagerStart,
    verifyCanonicalResult: overrides.verifyCanonicalResult ?? activated?.verifyCanonicalResult,
    runControlTransactions: overrides.runControlTransactions ?? new RunControlTransactions(),
    managerStartAckTimeoutMs: overrides.managerStartAckTimeoutMs ?? DEFAULT_MANAGER_START_ACK_TIMEOUT_MS,
    triggerRunner: overrides.triggerRunner,
    schtasksRun: overrides.schtasksRun,
    // One liveness cache per context (see resumeRegistry) — persists across responds within this process,
    // fresh per test context so schtasks probe results never leak between tests.
    livenessCache: overrides.livenessCache ?? new Map(),
  };
}

/** Register the governed write surface (auth + write + vibe + approvals) as one guarded child scope. */
export function registerWriteSurface(app: FastifyInstance, ctx: SurfaceContext = makeSurfaceContext()): void {
  // preClose runs before Fastify waits for long-lived streaming requests to finish. Draining in
  // onClose would deadlock shutdown behind the very Composer children it was meant to stop.
  app.addHook('preClose', async () => {
    ctx.controlBroker?.drain();
    drainVibeProcesses();
    // Kill any in-flight (possibly network-stalled) coordination git/gh child so shutdown never blocks
    // behind a hung push — the very failure mode this async-git conversion exists to remove.
    drainAsyncGit();
  });
  app.register(async (scope) => {
    // Order matters: origin guard first (fail-closed), then the rate-limiter, both as onRequest hooks.
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('onRequest', writeRateLimitHook(ctx.rateGuard));

    registerAuthRoutes(scope, ctx);
    registerWriteRoutes(scope, ctx);
    registerVibeRoutes(scope, ctx);
    registerComposerRoutes(scope, ctx);
    registerControlRoutes(scope, ctx);
    registerApprovalsRoutes(scope, ctx);
  });
}
