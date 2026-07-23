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
import type { ResumeRegistry } from '../composer/resumeRegistry.ts';
import type { ComposerWorkspaceStore } from '../composer/store.ts';
import type { RunnerTrigger } from '../runner/trigger.ts';
import type { LivenessCache, SchtasksRunner } from '../runner/liveness.ts';
import type { ControlPlaneStore } from '../control/store.ts';
import type { ManagedSessionBroker } from '../control/broker.ts';
import type { CancelRunInput, CancellationOutcome, ExecuteRunInput, ExecutionOutcome } from '../control/execution.ts';
import type { DefinitionAmendmentStore } from '../workflows/amendmentStore.ts';

/** How a route records exactly one audit row. Injected as a recording fake in tests. Widened to allow a
 *  `Promise` so the real (now async, off-the-event-loop) `appendAudit` and synchronous test fakes both fit;
 *  every route `await`s it. */
export type AppendAuditFn = (repoRoot: string, event: AuditEvent, options?: AppendAuditOptions) => AuditRow | Promise<AuditRow>;
/** Local-only audit append used when the consequential write and audit must share one ops commit. */
export type AppendAuditLocalFn = (repoRoot: string, event: AuditEvent, now?: () => Date) => AuditRow;

export interface SurfaceContext {
  /** Canonical ops worktree used for live reads and coordination writes. */
  repoRoot: string;
  /** Dashboard-owned runtime state root; never a repository content path. */
  stateRoot: string;
  /** Restart-safe, server-owned pending definition-amendment records. */
  definitionAmendmentStore: DefinitionAmendmentStore;
  /** Isolated work-branch checkout used only for durable Composer saves. */
  durableRepoRoot?: string;
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
  appendAuditLocal?: AppendAuditLocalFn;
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
  /** review F1 — the process-lifetime issued-CLI-session allowlist that binds Composer's `--resume`.
   *  Created ONCE per process in `makeSurfaceContext` (so ids captured on one turn are visible to the
   *  next); tests inject a fresh instance so nothing leaks across them. */
  resumeRegistry: ResumeRegistry;
  /** Durable, subject-bound Composer workspace catalog. Provider handles remain private to this store. */
  composerStore: ComposerWorkspaceStore;
  /** App-local durable proposal/run/session/event projection. Canonical queue cards remain fleet truth. */
  controlStore: ControlPlaneStore;
  /** Optional gated daemon-owned broker. Production remains inactive until its separate approval gate. */
  controlBroker?: ManagedSessionBroker;
  /** Optional server-owned automatic executor; never supplied by the browser. */
  runAutomatic?: (input: ExecuteRunInput) => Promise<ExecutionOutcome>;
  /** Optional executor-owned cancellation boundary for Manager and Worker processes. */
  cancelAutomatic?: (input: CancelRunInput) => Promise<CancellationOutcome>;
  /** Signals an already-provisioned background runner after a committed launch. */
  triggerRunner?: RunnerTrigger;
  /** G3 reply-liveness — read-only Windows Task Scheduler probe seam (mirrors `triggerRunner`). Injected as
   *  a recording fake in tests; production leaves it undefined and `ownerLiveness` shells the real
   *  `schtasks /Query`. Never involves a credential. */
  schtasksRun?: SchtasksRunner;
  /** Per-context TTL cache backing the liveness probe, created once per process in `makeSurfaceContext`
   *  (so a slow schtasks is queried at most once per TTL across responds) and fresh per test context. */
  livenessCache?: LivenessCache;
}

/** The audit fn a route should call — the injected fake in tests, the real git-committing one otherwise. */
export function auditFn(ctx: SurfaceContext): AppendAuditFn {
  return ctx.appendAudit ?? realAppendAudit;
}
