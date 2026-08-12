/**
 * The connected Human Inbox — spec §5.
 *
 * It joins the TWO things that can need a person into one live list: queue cards (the
 * `GET /api/human-inbox` projection, refreshed on every SSE tick) and managed-run asks (each parked
 * run's open Human Requests, plus a run parked with none — otherwise invisible in both feeds). They
 * used to be a view and a separate panel wall stacked under it, with two vocabularies for one job.
 *
 * This container FETCHES and MERGES; it does not write. Every gate is answered on the surface that owns
 * it — a run ask deep-links into that run (`RunDetail`'s "Waiting on you" strip has the same respond /
 * resume machinery this file used to duplicate, with the run's stream and transcript around it), and a
 * card deep-links into Tasks (whose detail pane owns verify + reply/resolve). Nothing is recorded here
 * as "handled": when a writer anywhere moves a card or run on, the item stops being projected and the
 * row goes away by itself.
 *
 * Run asks need the passkey session the card feed does not — a real boundary, not a display toggle — so
 * a locked tab cannot fetch them at all. It used to just render the card side with no sign anything was
 * missing; `Approvals`' `locked` prop now carries an explicit notice instead, so "I can't find shit" is
 * never actually "there was more, and this surface hid it silently."
 */
import { useCallback, useEffect, useState } from 'react';
import { Approvals, inboxRows, type RunAskRow } from './Approvals';
import type { HumanInboxItem } from '../../server/approvals/humanInbox';
import { useSse } from '../lib/sseClient';
import { useSession } from '../lib/sessionContext';
import { fetchHumanInbox, type FetchLike } from '../lib/approvalsClient';
import { getRun, listRuns, type FetchLike as ControlFetchLike, type RunDetailDto } from '../control/controlClient';
import { tierForHumanRequest } from '../control/humanBoundaries';
import type { NavTarget } from '../nav/stack';

export interface ApprovalsLiveProps {
  /** Injected for tests; production uses the real `fetch`/`EventSource`. */
  fetchImpl?: FetchLike;
  /** Open the surface that owns a gate. Wired by the shell to its nav stack. */
  onNavigate?: (target: NavTarget) => void;
}

/** The inbox category a run ask reads as, from the kind of request the engine filed. */
function categoryOf(kind: RunDetailDto['humanRequests'][number]['kind']): RunAskRow['category'] {
  if (kind === 'approval' || kind === 'review') return 'gate';
  if (kind === 'input') return 'input';
  return 'intervention';
}

function labelOf(category: RunAskRow['category']): RunAskRow['categoryLabel'] {
  return category === 'gate' ? 'Gate' : category === 'input' ? 'Input' : 'Intervention';
}

/** Every open ask on a run, in the words the server already rendered them in (`HumanRequestDto.ask`). */
function asksForRun(detail: RunDetailDto): RunAskRow[] {
  const open = detail.humanRequests.filter((request) => request.state === 'open');
  if (open.length > 0) {
    return open.map((request) => {
      const category = categoryOf(request.kind);
      return {
        requestRef: request.requestRef,
        runRef: request.runRef,
        displayName: request.displayName,
        shortRef: request.shortRef,
        ask: request.ask,
        tier: tierForHumanRequest(request.kind),
        category,
        categoryLabel: labelOf(category),
        urgency: tierForHumanRequest(request.kind) === 'T3' ? 'high' : 'normal',
        createdAt: request.createdAt,
      };
    });
  }
  // A run parked on a human with NO open request is still waiting on one — and is otherwise reachable
  // from no feed at all. It gets one row that says exactly that, and links to the run.
  if (detail.run.state !== 'waiting-human') return [];
  return [{
    requestRef: `${detail.run.runRef}:parked`,
    runRef: detail.run.runRef,
    displayName: detail.run.displayName,
    shortRef: detail.run.shortRef,
    ask: `${detail.run.displayName} is paused and waiting on a person, with nothing recorded to answer. Open the run to see where it stopped.`,
    tier: 'T2',
    category: 'intervention',
    categoryLabel: 'Intervention',
    urgency: 'normal',
    // No request to date this row on — the run's own createdAt is the closest honest stand-in.
    createdAt: detail.run.createdAt,
  }];
}

export function ApprovalsLive({ fetchImpl, onNavigate }: ApprovalsLiveProps): React.JSX.Element {
  const { session, locked } = useSession();
  const token = session?.token;
  const [items, setItems] = useState<HumanInboxItem[]>([]);
  const [runAsks, setRunAsks] = useState<RunAskRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Refetch on every SSE arrival; `count` starts at 0, so the effect also runs once on mount.
  const { count } = useSse('/events');

  const loadRunAsks = useCallback(async (activeToken: string): Promise<RunAskRow[]> => {
    const runs = await listRuns(activeToken, fetchImpl as ControlFetchLike | undefined);
    // Widen beyond "has open requests" to also pull `waiting-human` runs. Archived runs are already
    // absent — the server drops them from this list, which is what archiving is FOR.
    const parked = runs.filter((run) => run.openHumanRequestCount > 0 || run.state === 'waiting-human');
    const details = await Promise.all(parked.map((run) => getRun(run.runRef, activeToken, fetchImpl as ControlFetchLike | undefined)));
    return details.flatMap(asksForRun);
  }, [fetchImpl]);

  useEffect(() => {
    let alive = true;
    fetchHumanInbox(fetchImpl)
      .then((inbox) => {
        if (alive) setItems(inbox.items);
      })
      .catch(() => {
        // A transient fetch failure leaves the last-known list in place; the next SSE tick retries.
      });
    return () => { alive = false; };
  }, [count, fetchImpl]);

  useEffect(() => {
    // Run asks need the session the card feed does not. A locked tab cannot fetch them at all — that is
    // a real boundary (the WebAuthn session, not a display toggle) — so it shows the card side and the
    // `locked` prop below carries an EXPLICIT notice that run-side asks may exist and are hidden; there
    // is no second unlock button here, the app has ONE (the top-bar chip), and any governed click runs it.
    if (!token) {
      setRunAsks([]);
      return;
    }
    let alive = true;
    loadRunAsks(token)
      .then((asks) => {
        if (!alive) return;
        setRunAsks(asks);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : 'Could not load run requests.');
      });
    return () => { alive = false; };
  }, [count, loadRunAsks, token]);

  // The `Human Inbox` landmark label belongs to the list itself (see Approvals); this shell only
  // carries the load error above it, so it must not claim the same name twice.
  return (
    <section className="v-approvals-live">
      {error ? <p className="v-approvals__outcome v-approvals__outcome--error" role="alert">{error}</p> : null}
      <Approvals rows={inboxRows(items, runAsks)} onNavigate={onNavigate} locked={locked} />
    </section>
  );
}
