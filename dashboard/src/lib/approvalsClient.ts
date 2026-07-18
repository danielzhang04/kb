/**
 * U2 — browser glue for the approvals surface. `fetchPending` reads the live `GET /api/approvals`
 * corroboration feed; `verifyApproval` drives `POST /api/approvals/verify` for an EXPLICIT operator
 * verify click (never on card selection). `fetch` is injected (mirrors the sseClient/webauthnClient DI
 * seam) so this is unit-testable with no network.
 *
 * This module never runs a WebAuthn ceremony itself and never re-orders the show-then-prompt law — it
 * is called only from an already-corroborated verify click. The session bearer is minted out-of-band by
 * the WebAuthn login (`authClient.ts`); absent a session the server replies 401, which is surfaced to
 * the caller rather than hidden.
 */
import type { ParsedCard } from '../../server/planeA/cards';
import type { ApprovalButtons } from '../../server/approvals/assurance';
import type { HumanInboxProjection } from '../../server/approvals/humanInbox';

export type ApprovalChannel = 'signed' | 'possession' | 'webauthn';
export type FetchLike = typeof fetch;

/** One row of the `GET /api/approvals` payload. */
export interface PendingApproval {
  card: ParsedCard;
  buttons: ApprovalButtons;
}

/** Fetch the ranked pending approvals. Returns the parsed cards (the Approvals view recomputes its own
 *  buttons from `assurance.ts`, so only the cards are threaded through). Throws on a non-2xx response. */
export async function fetchPending(fetchImpl: FetchLike = fetch): Promise<ParsedCard[]> {
  const res = await fetchImpl('/api/approvals', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /api/approvals failed: ${res.status}`);
  const body = (await res.json()) as { pending?: PendingApproval[] };
  return (body.pending ?? []).map((p) => p.card);
}

/** Fetch the unified, read-only Human Inbox projection. */
export async function fetchHumanInbox(fetchImpl: FetchLike = fetch): Promise<HumanInboxProjection> {
  const res = await fetchImpl('/api/human-inbox', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /api/human-inbox failed: ${res.status}`);
  const body = (await res.json()) as HumanInboxProjection;
  return {
    items: Array.isArray(body.items) ? body.items : [],
    counts: body.counts ?? { total: 0, decision: 0, input: 0, intervention: 0 },
  };
}

export interface VerifyResult {
  ok: boolean;
  reason: string;
  status: number;
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
  let reason = '';
  try {
    const body = (await res.json()) as { reason?: string; error?: string };
    reason = body.reason ?? body.error ?? '';
  } catch {
    reason = 'no response body';
  }
  return { ok: res.ok, reason, status: res.status };
}
