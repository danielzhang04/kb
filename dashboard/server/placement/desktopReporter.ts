// P6 W5 §3.5: the Desktop-side claim/report orchestrator over `desktopClient.ts`. It never opens a
// store (no import of `control/store.ts` anywhere in this file), and it never infers completion from
// its local process: the ONLY way a `completed`/`failed` report is ever sent is an explicit call to
// `session.report('completed'|'failed', …)` by the caller's work function — there is no "attach a child
// process" API here for the orchestrator to watch instead. `sendWithRetry` reuses ONE idempotency token
// across every retry of the SAME logical call, minting a fresh one only for the next call [P6-C36
// client half].
import type { DesktopClient, DesktopClientResponse } from './desktopClient.ts';
import type { ReportKind } from '../api/v1/contracts.ts';

export interface RetryClock {
  sleep(ms: number): Promise<void>;
}

export interface RetryOptions<T> {
  readonly attempts: number;
  readonly delayMs: number;
  readonly isRetryable: (result: T) => boolean;
  /** Test-only override; production always mints a fresh random token per logical call. */
  readonly keyFactory?: () => string;
}

function randomIdempotencyKey(): string {
  return `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
}

/**
 * Call `send(key)` up to `attempts` times, generating the idempotency `key` ONCE before the first
 * attempt and reusing that SAME value on every retry of this logical call — never a fresh key per
 * attempt [P6-C36].
 */
export async function sendWithRetry<T>(
  send: (idempotencyKey: string) => Promise<T>,
  opts: RetryOptions<T>,
  clock: RetryClock,
): Promise<{ result: T; idempotencyKey: string; attempts: number }> {
  const idempotencyKey = (opts.keyFactory ?? randomIdempotencyKey)();
  let result: T;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    result = await send(idempotencyKey);
    if (!opts.isRetryable(result) || attempt >= opts.attempts) break;
    await clock.sleep(opts.delayMs);
  }
  return { result, idempotencyKey, attempts: attempt };
}

export type ReportSendOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'lease-expired' }
  | { readonly ok: false; readonly code: string };

/** One claimed run's reporting session: sequence tracking + the lease-expired stop switch. */
export interface ReporterSession {
  readonly runRef: string;
  readonly stopped: boolean;
  report(kind: ReportKind, payload?: Record<string, unknown>): Promise<ReportSendOutcome>;
}

function parseResponseCode(response: DesktopClientResponse): string | undefined {
  try {
    const parsed = JSON.parse(response.body) as { code?: unknown };
    return typeof parsed.code === 'string' ? parsed.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Open a reporting session for a freshly claimed lease. `report()` sends the NEXT sequence number
 * each call; a `409 lease-expired` STOPS the session (no further reports are ever sent through it)
 * rather than silently continuing.
 */
export function openReporterSession(client: DesktopClient, runRef: string, initialLeaseRevision: number): ReporterSession {
  let sequence = 0;
  let stopped = false;
  return {
    runRef,
    get stopped() { return stopped; },
    async report(kind, payload = {}) {
      if (stopped) return { ok: false, code: 'lease-expired' };
      sequence += 1;
      const response = await client.report(
        runRef, { expectedLeaseRevision: initialLeaseRevision, sequence, kind, payload }, `report-${runRef}-${sequence}`,
      );
      if (response.status === 409 && parseResponseCode(response) === 'lease-expired') {
        stopped = true;
        return { ok: false, code: 'lease-expired' };
      }
      if (response.status >= 200 && response.status < 300) return { ok: true };
      const code = parseResponseCode(response) ?? `http-${response.status}`;
      return { ok: false, code };
    },
  };
}

export type ClaimAttemptOutcome =
  | { readonly ok: true; readonly runRef: string; readonly leaseRevision: number }
  | { readonly ok: false };

/** Claim once. `204` (nothing available) and any non-2xx are both a plain "no lease yet" outcome. */
export async function attemptClaim(client: DesktopClient, hostId: 'vm' | 'desktop', waitMs: number): Promise<ClaimAttemptOutcome> {
  const response = await client.claim(hostId, waitMs);
  if (response.status === 204) return { ok: false };
  if (response.status < 200 || response.status >= 300) return { ok: false };
  const parsed = JSON.parse(response.body) as { runRef?: unknown; lease?: { revision?: unknown } };
  if (typeof parsed.runRef !== 'string' || typeof parsed.lease?.revision !== 'number') return { ok: false };
  return { ok: true, runRef: parsed.runRef, leaseRevision: parsed.lease.revision };
}

/**
 * Run one claim-then-report-loop cycle: claim a run, hand the caller's `work` function a session, and
 * — if `work` throws or the session stops on `lease-expired` — return so the caller can loop back to
 * `runOnce` again to re-claim. `work` receives ONLY the session (never a local process handle), so this
 * orchestrator has no signal from which it could ever infer completion on its own [P6-C36 client half].
 */
export async function runOnce(
  client: DesktopClient,
  hostId: 'vm' | 'desktop',
  waitMs: number,
  work: (session: ReporterSession) => Promise<void>,
): Promise<{ readonly claimed: boolean; readonly runRef?: string }> {
  const claim = await attemptClaim(client, hostId, waitMs);
  if (!claim.ok) return { claimed: false };
  const session = openReporterSession(client, claim.runRef, claim.leaseRevision);
  await work(session);
  return { claimed: true, runRef: claim.runRef };
}
