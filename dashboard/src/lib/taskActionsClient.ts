/**
 * Browser glue for governed card actions. `verifyApproval` drives `POST /api/approvals/verify` for an explicit operator
 * verify click (never on card selection). `fetch` is injected (mirrors the sseClient/webauthnClient DI
 * seam) so this is unit-testable with no network.
 *
 * This module never runs a WebAuthn ceremony itself and never re-orders the show-then-prompt law — it
 * is called only from an already-corroborated verify click. The session bearer is minted out-of-band by
 * the WebAuthn login (`authClient.ts`); absent a session the server replies 401, which is surfaced to
 * the caller rather than hidden.
 */
import type { OwnerLiveness } from '../../server/runner/liveness';
import { invalidateSessionOnGovernedAuthFailure } from './authClient';

export type ApprovalChannel = 'signed' | 'possession' | 'webauthn';
export type FetchLike = typeof fetch;

export interface VerifyResult {
  ok: boolean;
  reason: string;
  status: number;
  /** Present only on a successful `card-respond` (G3): the server's read of whether any consumer is
   *  online for the card's owner. Used to warn the operator when a reply will hang unread. */
  liveness?: OwnerLiveness;
}

/**
 * POST an explicit verify to the server, driving the channel's dispatcher-side verifier. The optional
 * session `token` is sent as a bearer; without one the server 401s (the fail-closed pre-passkey path),
 * which this returns as `{ ok: false, status: 401 }` rather than throwing.
 */
export async function verifyApproval(
  cardId: string,
  channel: ApprovalChannel,
  opts: { token?: string; fetchImpl?: FetchLike } = {},
): Promise<VerifyResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetchImpl('/api/approvals/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify({ cardId, channel }),
  });
  await invalidateSessionOnGovernedAuthFailure(res);
  let reason = '';
  try {
    const body = (await res.json()) as { reason?: string; error?: string };
    reason = body.reason ?? body.error ?? '';
  } catch {
    reason = 'no response body';
  }
  return { ok: res.ok, reason, status: res.status };
}

export type RespondAction = 'reply' | 'resolve';

/** The shape the `card-respond` success body carries beyond the base ack. */
interface RespondBody {
  reason?: string;
  error?: string;
  liveness?: OwnerLiveness;
}

/**
 * POST an inline operator response (a reply on an input card, or a resolve on a wake-me/blocked/halted
 * card) to the governed `POST /api/write/card-respond` route. Session-gated: without a bearer the server
 * 401s, surfaced here as `{ ok: false, status: 401 }` (mirroring {@link verifyApproval}) rather than
 * throwing, so the container can replace the session and retry exactly once.
 */
export async function respondToCard(
  cardId: string,
  action: RespondAction,
  message: string,
  opts: { token?: string; fetchImpl?: FetchLike } = {},
): Promise<VerifyResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetchImpl('/api/write/card-respond', {
    method: 'POST',
    headers,
    body: JSON.stringify({ cardId, action, message }),
  });
  await invalidateSessionOnGovernedAuthFailure(res);
  let reason = '';
  let liveness: OwnerLiveness | undefined;
  try {
    const body = (await res.json()) as RespondBody;
    reason = body.reason ?? body.error ?? '';
    liveness = body.liveness;
  } catch {
    reason = 'no response body';
  }
  return { ok: res.ok, reason, status: res.status, liveness };
}
