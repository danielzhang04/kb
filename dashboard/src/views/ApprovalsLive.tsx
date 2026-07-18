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
  /** The WebAuthn-minted session bearer (from `authClient.signIn`), if the dashboard is unlocked. */
  sessionToken?: string;
  /** Point-of-action dashboard unlock. `force` replaces a bearer invalidated by a daemon restart. */
  onRequestSession?: (force?: boolean) => Promise<{ token: string } | null>;
  /** Injected for tests; production uses the real `fetch`/`EventSource`. */
  fetchImpl?: FetchLike;
}

export function ApprovalsLive({
  sessionToken,
  onRequestSession,
  fetchImpl,
}: ApprovalsLiveProps): React.JSX.Element {
  const [pending, setPending] = useState<ParsedCard[]>([]);
  const [outcome, setOutcome] = useState<{ kind: 'progress' | 'success' | 'error'; message: string } | null>(null);
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
    // Fired only on an explicit, post-corroboration verify click (see Approvals). If this tab has not
    // been unlocked yet, that same click runs the passkey ceremony before any verify request.
    void (async () => {
      setOutcome({
        kind: 'progress',
        message: sessionToken ? `Preparing verification for ${cardId}…` : 'Unlocking dashboard…',
      });
      let token = sessionToken;
      if (!token) token = (await onRequestSession?.())?.token;
      if (!token) {
        setOutcome({ kind: 'error', message: 'Approval was not sent because the dashboard is still locked.' });
        return;
      }

      setOutcome({ kind: 'progress', message: `Verifying ${cardId}…` });
      let result = await verifyApproval(cardId, channel, { token, fetchImpl });
      if (result.status === 401 && onRequestSession) {
        // A daemon restart invalidates an otherwise unexpired stateless bearer. Replace it once, then
        // retry the exact operator-selected card/channel; never loop or silently downgrade.
        const replacement = await onRequestSession(true);
        if (replacement) {
          token = replacement.token;
          result = await verifyApproval(cardId, channel, { token, fetchImpl });
        }
      }

      if (result.ok) {
        setOutcome({
          kind: 'success',
          message: result.reason ? `${cardId}: ${result.reason}` : `${cardId} was verified.`,
        });
        try {
          setPending(await fetchPending(fetchImpl));
        } catch {
          // The SSE feed will reconcile the list; the successful verification remains visible.
        }
      } else {
        setOutcome({
          kind: 'error',
          message: result.reason
            ? `${cardId} was not verified: ${result.reason}`
            : `${cardId} was not verified (HTTP ${result.status}).`,
        });
      }
    })();
  };

  return (
    <section className="v-approvals-live" aria-label="Approval verification">
      {outcome ? (
        <p
          className={`v-approvals__outcome v-approvals__outcome--${outcome.kind}`}
          role={outcome.kind === 'error' ? 'alert' : 'status'}
        >
          {outcome.message}
        </p>
      ) : null}
      <Approvals pending={pending} onVerify={onVerify} />
    </section>
  );
}
