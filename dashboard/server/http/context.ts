/**
 * U2 — the shared context every governed-write route registrar receives. It bundles the resolved
 * security config (session signing, origin allowlist, rate-limit guard, WebAuthn RP config + registered
 * credentials) plus the SAME injectable side-effect runners each gate module already exposes for its
 * own hermetic unit tests. In production every runner field is left `undefined` and each module falls
 * back to its real default (shell git/py/claude); route tests inject recording fakes so no real
 * subprocess, git remote, or `queue/` tree is ever touched — the security chain itself is never faked.
 */
import type { SessionConfig } from '../auth/session.ts';
import type { AllowedOrigins } from '../security/origin.ts';
import type { LockoutGuard } from '../security/ratelimit.ts';
import type { WebAuthnConfig } from '../auth/webauthn.ts';
import type { WebAuthnCredential } from '@simplewebauthn/server';
import { appendAudit as realAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditEvent, AuditRow, OpsGitRunner } from '../audit/log.ts';
import type { GitRunner, PrOpener } from '../write/branch.ts';
import type { PyRunner } from '../write/launch.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { VibeSpawner } from '../vibe/session.ts';

/** How a route records exactly one audit row. Injected as a recording fake in tests. */
export type AppendAuditFn = (repoRoot: string, event: AuditEvent, options?: AppendAuditOptions) => AuditRow;

export interface SurfaceContext {
  repoRoot: string;
  /** One shared session config (secret resolved ONCE) so a token minted at assert/verify verifies at
   *  every write route. Re-resolving per request would mint a fresh random secret and break everything. */
  sessionConfig: SessionConfig;
  allowedOrigins: AllowedOrigins;
  rateGuard: LockoutGuard;
  /** Lazy — `auth/webauthn.ts#resolveWebAuthnConfig` THROWS when `DASHBOARD_RP_ORIGIN` is unset, so it
   *  is only ever called inside a handler (which the origin guard already blocked when the allowlist is
   *  empty), never at registration time. */
  webAuthnConfig: () => WebAuthnConfig;
  /** The fail-closed registered-credential store (`[]` until a human provisions a passkey). */
  credentials: () => WebAuthnCredential[];

  // --- injectable side-effect runners (undefined => each module's real default) ---
  appendAudit?: AppendAuditFn;
  /** Git runner for the audit-log ops commit + the floor's coordination writes. */
  opsGit?: OpsGitRunner;
  /** Git runner for governedSave's branch routing (structurally identical; kept distinct for clarity). */
  saveGit?: GitRunner;
  openPr?: PrOpener;
  runPy?: PyRunner;
  runPreamble?: PreambleRunner;
  spawn?: VibeSpawner;
  /** Optional dedicated guard for the vibe module's own internal limiter (else its module singleton). */
  vibeRateGuard?: LockoutGuard;
  now?: () => Date;
}

/** The audit fn a route should call — the injected fake in tests, the real git-committing one otherwise. */
export function auditFn(ctx: SurfaceContext): AppendAuditFn {
  return ctx.appendAudit ?? realAppendAudit;
}
