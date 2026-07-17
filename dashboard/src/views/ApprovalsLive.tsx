/**
 * U2 — the connected Approvals container. It sources the pending list from the live `GET /api/approvals`
 * feed (refreshed whenever an SSE delta arrives, so a newly-promoted card appears without a reload) and
 * wires the presentational {@link Approvals} view's `onVerify` to `POST /api/approvals/verify`.
 *
 * The ordering law is preserved BY CONSTRUCTION: this container only supplies `pending` + `onVerify`;
 * the {@link Approvals} view renders the corroboration panel on selection and fires `onVerify` only on
 * an explicit verify click — this container never prompts a biometric before that, and cannot re-order
 * the view's own calls.
 */
import { useEffect, useState } from 'react';
import type { ParsedCard } from '../../server/planeA/cards';
import { Approvals } from './Approvals';
import type { ApprovalChannel } from './Approvals';
import { useSse } from '../lib/sseClient';
import { fetchPending, verifyApproval, type FetchLike } from '../lib/approvalsClient';

export interface ApprovalsLiveProps {
  /** The WebAuthn-minted session bearer (from `authClient.signIn`), if signed in. Absent => verify 401s. */
  sessionToken?: string;
  /** Injected for tests; production uses the real `fetch`/`EventSource`. */
  fetchImpl?: FetchLike;
}

export function ApprovalsLive({ sessionToken, fetchImpl }: ApprovalsLiveProps): React.JSX.Element {
  const [pending, setPending] = useState<ParsedCard[]>([]);
  // Refetch on every SSE arrival; `count` starts at 0, so the effect also runs once on mount.
  const { count } = useSse('/events');

  useEffect(() => {
    let alive = true;
    fetchPending(fetchImpl)
      .then((cards) => {
        if (alive) setPending(cards);
      })
      .catch(() => {
        // A transient fetch failure leaves the last-known list in place; the next SSE tick retries.
      });
    return () => {
      alive = false;
    };
  }, [count, fetchImpl]);

  const onVerify = (cardId: string, channel: ApprovalChannel): void => {
    // Fired only on an explicit, post-corroboration verify click (see Approvals). The bearer was minted
    // by a WebAuthn login; without it the server fail-closes to 401.
    void verifyApproval(cardId, channel, { token: sessionToken, fetchImpl });
  };

  return <Approvals pending={pending} onVerify={onVerify} />;
}
