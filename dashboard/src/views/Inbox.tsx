// P4 W6.1: the Inbox view, cut over ATOMICALLY to the PR + escalation + source-health contract. Each PR
// exposes exactly ONE action — "Open PR", explicitly labelled external, following the server-constructed
// URL to the pinned PR (`design:264`); each escalation exposes "Open card". No lifecycle, read-state, or
// deferral controls exist here (no merge, no run) — the surface is links only. A failed source shows a
// source-specific retry row and never empties the healthy half; "Nothing needs you" appears only when
// both sources are freshly verified and empty.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchInbox, type FetchLike, type InboxItem, type InboxResponse, type InboxSourceKind, type SourceState,
  type DeploymentItem, type DeploymentItemState, type AssetPullItem,
} from '../lib/inboxClient.ts';
import { createInboxRefresher } from '../lib/inboxRefresher.ts';
import { useSse, type SseFactory } from '../lib/sseClient.ts';
import type { NavTarget } from '../nav/stack.ts';
import { humanizeEntityId } from '../entity/humanizeEntityId.ts';
import '../styles/views/inbox.css';

export interface InboxProps {
  fetchImpl?: FetchLike;
  sseFactory?: SseFactory;
  onNavigate?: (target: NavTarget) => void;
}

const SOURCE_LABEL: Record<InboxSourceKind, string> = {
  pr: 'Pull requests', escalation: 'Escalations', deployment: 'Deployments', assetPull: 'Asset pulls',
};
const ALL_SOURCE_KINDS: readonly InboxSourceKind[] = ['pr', 'escalation', 'deployment', 'assetPull'];

/** A deployment's single mutating control (or none) — the §3.1 table. `deploy-ready` carries no blocking
 *  ids by construction, so Close-PTYs never fires for it; `breaking` is read from the projected title
 *  suffix. Every deployment ALSO gets Inspect (navigation), rendered separately. [P5-C18/C49/C58/C59] */
export type DeploymentMutatingVerb = 'confirm' | 'deploy' | 'abort' | 'acknowledge' | 'close-ptys-and-continue';
export interface DeploymentControl { verb: DeploymentMutatingVerb; label: string; t3: boolean }

export function isBreakingDeployReady(item: Pick<DeploymentItem, 'state' | 'title'>): boolean {
  return item.state === 'deploy-ready' && item.title.trimEnd().endsWith('(breaking)');
}

export function resolveDeploymentControl(
  state: DeploymentItemState, blockingPtyIds: readonly string[], breaking: boolean,
): DeploymentControl | null {
  if (state !== 'deploy-ready' && blockingPtyIds.length > 0) {
    return { verb: 'close-ptys-and-continue', label: 'Close PTYs and continue', t3: true };
  }
  switch (state) {
    case 'waiting-confirmation': return { verb: 'confirm', label: 'Confirm', t3: true };
    case 'deploy-ready': return breaking
      ? { verb: 'confirm', label: 'Confirm', t3: true }
      : { verb: 'deploy', label: 'Deploy', t3: true };
    case 'requested':
    case 'parked': return { verb: 'abort', label: 'Abort', t3: true };
    case 'swapping':
    case 'resuming': return null;
    case 'succeeded':
    case 'aborted':
    case 'failed': return { verb: 'acknowledge', label: 'Acknowledge', t3: false };
    case 'acknowledged': return null;
    default: return null;
  }
}

/** Asset-pull mapping: pending⇒Pull home, failed/offline⇒Retry, in-flight/succeeded⇒none. NOT T3. */
export function resolveAssetPullControl(state: AssetPullItem['state']): { verb: 'pull' | 'retry'; label: string } | null {
  if (state === 'pending') return { verb: 'pull', label: 'Pull home' };
  if (state === 'failed' || state === 'offline') return { verb: 'retry', label: 'Retry' };
  return null;
}
/** Fixed browser copy per closed error code — never raw stderr (section 3.3). */
const ERROR_COPY: Record<string, string> = {
  unavailable: 'the source is unavailable',
  timeout: 'the source timed out',
  overflow: 'the source returned too many rows',
  invalid: 'the source returned an unreadable response',
};

function SourceHealthRow({ kind, state, onRetry }: {
  kind: InboxSourceKind;
  state: SourceState;
  onRetry: (kind: InboxSourceKind) => void;
}): React.JSX.Element {
  const copy = ERROR_COPY[state.status === 'failed' ? state.errorCode : 'unavailable'] ?? 'the source is unavailable';
  return (
    <li className="inbox__source-health" data-testid={`inbox-source-${kind}`}>
      <p className="inbox__source-reason" role="status">
        {SOURCE_LABEL[kind]}: {copy}. Showing the last verified items{state.stale ? ' (stale)' : ''}.
      </p>
      <button type="button" className="inbox__retry" onClick={() => onRetry(kind)} aria-label={`Retry ${SOURCE_LABEL[kind]}`}>
        Retry
      </button>
    </li>
  );
}

export function Inbox({ fetchImpl, sseFactory, onNavigate }: InboxProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { count } = useSse('/events', sseFactory);
  const previousCount = useRef(count);
  const refresher = useMemo(() => createInboxRefresher({
    load: () => fetchInbox(fetchImpl),
    onSuccess: (next) => {
      setSnapshot(next);
      setError(null);
    },
    onFailure: () => setError('Could not refresh Inbox.'),
    onSettled: () => setLoading(false),
  }), [fetchImpl]);

  useEffect(() => {
    refresher.trigger();
    return () => refresher.dispose();
  }, [refresher]);

  // SSE invalidation: a PR/card/run/STOP source revision bumps the event count; re-read on every change.
  useEffect(() => {
    if (count === previousCount.current) return;
    previousCount.current = count;
    refresher.trigger();
  }, [count, refresher]);

  const retrySource = useCallback((kind: InboxSourceKind) => {
    void fetchInbox(fetchImpl, kind)
      .then((next) => { setSnapshot(next); setError(null); })
      .catch(() => setError('Could not refresh Inbox.'));
  }, [fetchImpl]);

  // A NON-T3 mutation (Acknowledge / Pull home / Retry): POST session-authenticated with a fresh
  // idempotency key, then re-read. T3 controls (Deploy / Confirm / Abort / Close-PTYs) are rendered
  // DISABLED — the ceremony is unavailable without a provisioned credential, and the wire refuses too.
  const runMutation = useCallback((endpoint: string, body: Record<string, unknown>) => {
    const impl = fetchImpl ?? fetch;
    const key = (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`);
    void impl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return refresher.trigger(); })
      .catch(() => setError('Could not complete the action.'));
  }, [fetchImpl, refresher]);

  if (loading && snapshot === null) return <p className="inbox__loading" role="status">Loading Inbox…</p>;
  if (snapshot === null) return <p className="inbox__error" role="alert">{error ?? 'Could not refresh Inbox.'}</p>;

  const failedSources = ALL_SOURCE_KINDS.filter((kind) => snapshot.sources[kind].status === 'failed');
  const allVerifiedEmpty = snapshot.items.length === 0 && failedSources.length === 0;

  return (
    <section className="inbox" aria-label="Inbox">
      {error ? <p className="inbox__error" role="alert">{error}</p> : null}
      {failedSources.length > 0 ? (
        <ul className="inbox__sources">
          {failedSources.map((kind) => (
            <SourceHealthRow key={kind} kind={kind} state={snapshot.sources[kind]} onRetry={retrySource} />
          ))}
        </ul>
      ) : null}
      {allVerifiedEmpty ? <p className="inbox__empty">Nothing needs you</p> : (
        <ul className="inbox__list">
          {snapshot.items.map((item) => (
            <InboxRow key={item.id} item={item} onNavigate={onNavigate} onMutate={runMutation} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InspectButton({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" className="inbox__action inbox__action--inspect" data-testid="inbox-inspect" onClick={onClick}>
      {label}
    </button>
  );
}

function InboxRow({ item, onNavigate, onMutate }: {
  item: InboxItem;
  onNavigate?: (target: NavTarget) => void;
  onMutate: (endpoint: string, body: Record<string, unknown>) => void;
}): React.JSX.Element {
  if (item.kind === 'pr') {
    return (
      <li className="inbox__row" data-testid="inbox-pr">
        <div>
          <p className="inbox__title" title={item.title}>{humanizeEntityId(item.title)}</p>
          <p className="inbox__reason">{item.subject.owner}/{item.subject.repo}#{item.subject.number}</p>
        </div>
        <a className="inbox__action inbox__action--external" href={item.href} target="_blank"
          rel="noopener noreferrer external"
          aria-label={`Open PR #${item.subject.number} on GitHub (opens externally in a new tab)`}>
          Open PR <span className="inbox__external-label">(external)</span>
        </a>
      </li>
    );
  }
  if (item.kind === 'escalation') {
    return (
      <li className="inbox__row" data-testid="inbox-escalation">
        <div>
          <p className="inbox__title" title={item.title}>{humanizeEntityId(item.title)}</p>
          <p className="inbox__reason">{item.reason}</p>
        </div>
        <button type="button" className="inbox__action"
          onClick={() => onNavigate?.({ view: 'tasks', focus: { kind: 'card', id: item.subject.cardId } })}>
          Open card
        </button>
      </li>
    );
  }
  const inspect = (deploymentRef: string): void =>
    onNavigate?.({ view: 'health', focus: { kind: 'deploy', id: deploymentRef } } as unknown as NavTarget);
  if (item.kind === 'deployment-escalation') {
    return (
      <li className="inbox__row" data-testid="inbox-deployment-escalation">
        <div>
          <p className="inbox__title" title={item.title}>{humanizeEntityId(item.title)}</p>
          <p className="inbox__reason">Swap deadline expired at {item.swapDeadlineAt}</p>
        </div>
        <InspectButton label="Inspect" onClick={() => inspect(item.subject.deploymentRef)} />
      </li>
    );
  }
  if (item.kind === 'asset-pull') {
    const control = resolveAssetPullControl(item.state);
    const endpoint = control ? `/api/inbox/asset-pull/${item.subject.intentRef}/${control.verb}` : '';
    return (
      <li className="inbox__row" data-testid={`inbox-asset-pull-${item.state}`}>
        <div>
          <p className="inbox__title" title={item.title}>{humanizeEntityId(item.title)}</p>
          <p className="inbox__reason">Run {item.subject.runRef} · {item.state}</p>
        </div>
        {control ? (
          <button type="button" className="inbox__action inbox__action--mutating" data-testid="inbox-asset-control"
            onClick={() => onMutate(endpoint, {})}>
            {control.label}
          </button>
        ) : null}
        <InspectButton label="Inspect" onClick={() => onNavigate?.({ view: 'tasks', focus: { kind: 'card', id: item.subject.intentRef } } as unknown as NavTarget)} />
      </li>
    );
  }
  // item.kind === 'deployment'
  const breaking = isBreakingDeployReady(item);
  const control = resolveDeploymentControl(item.state, item.blockingPtyIds, breaking);
  const endpoint = control ? `/api/inbox/deployment/${item.subject.deploymentRef}/${control.verb}` : '';
  // The candidate projection state is never shown as raw copy (it would put `deploy-ready` in the UI
  // string wall [P5-C61]); a friendly label is used instead. Stored states carry no forbidden token.
  const stateLabel = item.state === 'deploy-ready' ? (breaking ? 'Breaking release ready' : 'Release ready') : item.state;
  return (
    <li className="inbox__row" data-testid={`inbox-deployment-${item.state}${breaking ? '-breaking' : ''}`}>
      <div>
        <p className="inbox__title" title={item.title}>{humanizeEntityId(item.title)}</p>
        <p className="inbox__reason">{stateLabel}{item.blockingPtyIds.length > 0 ? ` · ${item.blockingPtyIds.length} live PTY` : ''}</p>
      </div>
      {control ? (
        <button
          type="button"
          className="inbox__action inbox__action--mutating"
          data-testid="inbox-deploy-control"
          data-verb={control.verb}
          // T3 controls are disabled: the deploy ceremony is unavailable without a provisioned credential,
          // and a direct call is refused `403 ceremony-unavailable` on the wire too [P5-C23/C45].
          disabled={control.t3}
          aria-disabled={control.t3}
          onClick={control.t3 ? undefined : () => onMutate(endpoint, { expectedRevision: item.revision })}
        >
          {control.label}
        </button>
      ) : null}
      <InspectButton label="Inspect" onClick={() => inspect(item.subject.deploymentRef)} />
    </li>
  );
}
