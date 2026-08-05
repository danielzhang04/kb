/**
 * The connected Human Inbox container. It sources decisions, input and interventions from the live
 * `GET /api/human-inbox` feed (refreshed whenever an SSE delta arrives) and
 * wires the presentational {@link Approvals} view's `onVerify` to `POST /api/approvals/verify`.
 *
 * The ordering law is preserved BY CONSTRUCTION: this container only supplies `items` + `onVerify`;
 * the {@link Approvals} view renders the corroboration panel on selection and fires `onVerify` only on
 * an explicit verify click — this container never prompts a biometric before that, and cannot re-order
 * the view's own calls.
 */
import { useEffect, useState } from 'react';
import type { HumanInboxItem } from '../../server/approvals/humanInbox';
import { Approvals } from './Approvals';
import type { ApprovalChannel, RespondAction } from './Approvals';
import { useSse } from '../lib/sseClient';
import { useSession } from '../lib/sessionContext';
import { fetchHumanInbox, respondToCard, verifyApproval, type FetchLike } from '../lib/approvalsClient';
import { HumanRequestsPanel } from '../control/HumanRequestsPanel';

export interface ApprovalsLiveProps {
  /** Injected for tests; production uses the real `fetch`/`EventSource`. */
  fetchImpl?: FetchLike;
}

export function ApprovalsLive({ fetchImpl }: ApprovalsLiveProps): React.JSX.Element {
  const { session, requireSession } = useSession();
  const sessionToken = session?.token;
  const [items, setItems] = useState<HumanInboxItem[]>([]);
  const [outcome, setOutcome] = useState<{ kind: 'progress' | 'success' | 'error'; message: string } | null>(null);
  // Refetch on every SSE arrival; `count` starts at 0, so the effect also runs once on mount.
  const { count } = useSse('/events');

  useEffect(() => {
    let alive = true;
    fetchHumanInbox(fetchImpl)
      .then((inbox) => {
        if (alive) setItems(inbox.items);
      })
      .catch(() => {
        // A transient fetch failure leaves the last-known list in place; the next SSE tick retries.
      });
    return () => {
      alive = false;
    };
  }, [count, fetchImpl]);

  /**
   * The operator-facing NAME of a card, read straight off the inbox DTO — status lines say "deploy:prod
   * was verified", never a raw id. Falls back to the id only if the item vanished between click and
   * render (a refetch race), which is the one case where no display name exists to read.
   */
  const nameFor = (cardId: string): string =>
    items.find((item) => item.card.meta.id === cardId)?.card.displayName ?? cardId;

  const onVerify = (cardId: string, channel: ApprovalChannel): void => {
    // Fired only on an explicit, post-corroboration verify click (see Approvals). If this tab has not
    // been unlocked yet, that same click runs the passkey ceremony before any verify request.
    void (async () => {
      setOutcome({
        kind: 'progress',
        message: sessionToken ? `Preparing verification for ${nameFor(cardId)}…` : 'Unlocking dashboard…',
      });
      let token = (await requireSession())?.token;
      if (!token) {
        setOutcome({ kind: 'error', message: 'Approval was not sent because the dashboard is still locked.' });
        return;
      }

      setOutcome({ kind: 'progress', message: `Verifying ${nameFor(cardId)}…` });
      let result = await verifyApproval(cardId, channel, { token, fetchImpl });
      if (result.status === 401) {
        // A daemon restart invalidates an otherwise unexpired stateless bearer; the governed 401 clears
        // it, so this mints a REPLACEMENT and retries the exact operator-selected card/channel once.
        // A ceremony that hands back the same bearer is not a replacement — never loop, never downgrade.
        const replacement = await requireSession();
        if (replacement && replacement.token !== token) {
          token = replacement.token;
          result = await verifyApproval(cardId, channel, { token, fetchImpl });
        }
      }

      if (result.ok) {
        setOutcome({
          kind: 'success',
          message: result.reason ? `${nameFor(cardId)}: ${result.reason}` : `${nameFor(cardId)} was verified.`,
        });
        try {
          setItems((await fetchHumanInbox(fetchImpl)).items);
        } catch {
          // The SSE feed will reconcile the list; the successful verification remains visible.
        }
      } else {
        setOutcome({
          kind: 'error',
          message: result.reason
            ? `${nameFor(cardId)} was not verified: ${result.reason}`
            : `${nameFor(cardId)} was not verified (HTTP ${result.status}).`,
        });
      }
    })();
  };

  const onRespond = (cardId: string, action: RespondAction, message: string): void => {
    // Fired only on an explicit send-reply / resolve click (see Approvals). Same point-of-action unlock
    // and single 401-session-replacement retry as onVerify — never a loop or a silent downgrade.
    void (async () => {
      const verb = action === 'reply' ? 'reply' : 'resolution';
      setOutcome({
        kind: 'progress',
        message: sessionToken ? `Sending ${verb} for ${nameFor(cardId)}…` : 'Unlocking dashboard…',
      });
      let token = (await requireSession())?.token;
      if (!token) {
        setOutcome({ kind: 'error', message: `The ${verb} was not sent because the dashboard is still locked.` });
        return;
      }

      setOutcome({ kind: 'progress', message: `Sending ${verb} for ${nameFor(cardId)}…` });
      let result = await respondToCard(cardId, action, message, { token, fetchImpl });
      if (result.status === 401) {
        const replacement = await requireSession();
        if (replacement && replacement.token !== token) {
          token = replacement.token;
          result = await respondToCard(cardId, action, message, { token, fetchImpl });
        }
      }

      if (result.ok) {
        // G3 reply-liveness: the write committed, but a reply only PROGRESSES if a consumer runs. When the
        // server reports no online consumer for the owner, say so plainly instead of implying delivery.
        const committed = action === 'reply' ? `${nameFor(cardId)}: reply recorded and committed.` : `${nameFor(cardId)}: resolved and committed.`;
        const liveness = result.liveness;
        const ownerRaw = items.find((item) => item.card.meta.id === cardId)?.card.meta.owner;
        const ownerLabel = typeof ownerRaw === 'string' && ownerRaw ? `\`${ownerRaw}\`` : 'its owner';
        setOutcome({
          kind: 'success',
          message: liveness && !liveness.online
            ? `${committed} No runner is online for ${ownerLabel} — this card will not progress until one runs.`
            : committed,
        });
        try {
          setItems((await fetchHumanInbox(fetchImpl)).items);
        } catch {
          // The SSE feed will reconcile the list; the successful response remains visible.
        }
      } else {
        setOutcome({
          kind: 'error',
          message: result.reason
            ? `${nameFor(cardId)} was not updated: ${result.reason}`
            : `${nameFor(cardId)} was not updated (HTTP ${result.status}).`,
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
      <Approvals items={items} onVerify={onVerify} onRespond={onRespond} pendingRespond={outcome?.kind === 'progress'} />
      <HumanRequestsPanel fetchImpl={fetchImpl} />
    </section>
  );
}
