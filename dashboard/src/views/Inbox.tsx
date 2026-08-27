/**
 * The dashboard's one "needs you" destination. It composes the Plane-A card projection with the
 * external/deployment Inbox projection, then renders four stable priority sections. Card escalation
 * stubs are removed only when the richer actionable card with the same subject id is present.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchInbox, type FetchLike, type InboxItem, type InboxResponse, type InboxSourceKind, type SourceState,
  type DeploymentItem, type DeploymentItemState, type AssetPullItem, type EscalationItem,
} from '../lib/inboxClient.ts';
import { fetchCardIndex, type CardsByState } from '../lib/cardIndexClient.ts';
import { createInboxRefresher } from '../lib/inboxRefresher.ts';
import { recencyLabel } from '../lib/relativeAge.ts';
import { useSse, type SseFactory } from '../lib/sseClient.ts';
import type { NavTarget } from '../nav/stack.ts';
import { humanizeEntityId } from '../entity/humanizeEntityId.ts';
import { CardApprovals, cardsNeedingHuman } from './Tasks.tsx';
import '../styles/views/inbox.css';

export interface InboxProps {
  fetchImpl?: FetchLike;
  sseFactory?: SseFactory;
  onNavigate?: (target: NavTarget) => void;
  initialSelectedId?: string;
}

const SOURCE_LABEL: Record<InboxSourceKind, string> = {
  pr: 'Pull requests', escalation: 'Approval cards', deployment: 'Deploys', assetPull: 'Asset pulls',
};
const ALL_SOURCE_KINDS: readonly InboxSourceKind[] = ['pr', 'escalation', 'deployment', 'assetPull'];

/** A deployment's single mutating control (or none) — the §3.1 table. `deploy-ready` carries no blocking
 * ids by construction, so Close-PTYs never fires for it. Inspect remains a separate navigation action. */
export type DeploymentMutatingVerb = 'confirm' | 'deploy' | 'abort' | 'acknowledge' | 'close-ptys-and-continue';
export interface DeploymentControl { verb: DeploymentMutatingVerb; label: string; t3: boolean }

export function isBreakingDeployReady(item: Pick<DeploymentItem, 'state' | 'title'>): boolean {
  return item.state === 'deploy-ready' && item.title.trimEnd().endsWith('(breaking)');
}

export function resolveDeploymentControl(
  state: DeploymentItemState, blockingPtyIds: readonly string[], breaking: boolean,
): DeploymentControl | null {
  if (state !== 'deploy-ready' && blockingPtyIds.length > 0) {
    return { verb: 'close-ptys-and-continue', label: 'Close terminals and continue', t3: true };
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

/** Fixed browser copy per closed error code — never raw stderr. */
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

function ProjectionHealthRow({ label, onRetry }: { label: string; onRetry: () => void }): React.JSX.Element {
  return (
    <li className="inbox__source-health">
      <p className="inbox__source-reason" role="status">{label} could not be refreshed. Verified items from other sources remain visible.</p>
      <button type="button" className="inbox__retry" onClick={onRetry} aria-label={`Retry ${label}`}>Retry</button>
    </li>
  );
}

function InboxSection({ title, description, count, revealWhenEmpty = false, children }: {
  title: string;
  description: string;
  count: number;
  revealWhenEmpty?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="inbox__section" aria-label={title}>
      <header className="inbox__section-head">
        <div>
          <h2 className="inbox__section-title">{title}</h2>
          <p className="inbox__section-description">{description}</p>
        </div>
        <span className="inbox__section-count mc-num" aria-label={`${count} items`}>{count}</span>
      </header>
      {count === 0 && !revealWhenEmpty ? <p className="inbox__section-empty">Nothing here right now.</p> : children}
    </section>
  );
}

function newestFirst(left: InboxItem, right: InboxItem): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function deploymentNeedsAction(item: InboxItem): boolean {
  if (item.kind === 'deployment-escalation') return true;
  if (item.kind !== 'deployment') return false;
  return resolveDeploymentControl(item.state, item.blockingPtyIds, isBreakingDeployReady(item)) !== null;
}

export function Inbox({ fetchImpl, sseFactory, onNavigate, initialSelectedId }: InboxProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<InboxResponse | null>(null);
  const [cards, setCards] = useState<CardsByState | null>(null);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const { count } = useSse('/events', sseFactory);
  const previousCount = useRef(count);

  const inboxRefresher = useMemo(() => createInboxRefresher({
    load: () => fetchInbox(fetchImpl),
    onSuccess: (next) => { setSnapshot(next); setInboxError(null); },
    onFailure: () => setInboxError('Could not refresh Inbox sources.'),
    onSettled: () => setInboxLoading(false),
  }), [fetchImpl]);
  const cardRefresher = useMemo(() => createInboxRefresher({
    load: () => fetchCardIndex(fetchImpl),
    onSuccess: (next) => { setCards(next); setCardsError(null); },
    onFailure: () => setCardsError('Could not refresh approval cards.'),
    onSettled: () => setCardsLoading(false),
  }), [fetchImpl]);

  const refreshAll = useCallback(() => {
    inboxRefresher.trigger();
    cardRefresher.trigger();
  }, [cardRefresher, inboxRefresher]);

  useEffect(() => {
    refreshAll();
    return () => { inboxRefresher.dispose(); cardRefresher.dispose(); };
  }, [cardRefresher, inboxRefresher, refreshAll]);

  // SSE carries invalidation only. Both projections are re-read; event payload text is never rendered.
  useEffect(() => {
    if (count === previousCount.current) return;
    previousCount.current = count;
    refreshAll();
  }, [count, refreshAll]);

  const retrySource = useCallback((kind: InboxSourceKind) => {
    void fetchInbox(fetchImpl, kind)
      .then((next) => { setSnapshot(next); setInboxError(null); })
      .catch(() => setInboxError('Could not refresh Inbox sources.'));
  }, [fetchImpl]);

  // NON-T3 mutations retain their exact endpoint/body/idempotency behavior. T3 controls remain rendered
  // disabled because the provisioned ceremony is unavailable and the server refuses direct calls too.
  const runMutation = useCallback((endpoint: string, body: Record<string, unknown>) => {
    const impl = fetchImpl ?? fetch;
    const key = globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`;
    void impl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); refreshAll(); })
      .catch(() => setInboxError('Could not complete the action.'));
  }, [fetchImpl, refreshAll]);

  if (inboxLoading && cardsLoading && snapshot === null && cards === null) {
    return <p className="inbox__loading" role="status">Loading Inbox…</p>;
  }

  const failedSources = snapshot
    ? ALL_SOURCE_KINDS.filter((kind) => snapshot.sources[kind].status === 'failed')
    : [];
  const attentionCards = cards ? cardsNeedingHuman(cards) : [];
  const focusedCardExists = initialSelectedId !== undefined && cards !== null
    && Object.values(cards).flat().some((card) => String(card.meta.id) === initialSelectedId);
  const visibleCardIds = new Set(attentionCards.map((card) => String(card.meta.id)));
  const items = snapshot?.items ?? [];
  const unmatchedEscalations = items.filter((item): item is EscalationItem =>
    item.kind === 'escalation' && !visibleCardIds.has(item.subject.cardId));
  const deploys = items
    .filter((item) => item.kind === 'deployment' || item.kind === 'deployment-escalation')
    .sort((left, right) => Number(deploymentNeedsAction(right)) - Number(deploymentNeedsAction(left)) || newestFirst(left, right));
  const pullRequests = items.filter((item) => item.kind === 'pr');
  const assetPulls = items
    .filter((item): item is AssetPullItem => item.kind === 'asset-pull')
    .sort((left, right) => Number(resolveAssetPullControl(right.state) !== null) - Number(resolveAssetPullControl(left.state) !== null)
      || newestFirst(left, right));
  const approvalCount = attentionCards.length + unmatchedEscalations.length;
  const total = approvalCount + deploys.length + pullRequests.length + assetPulls.length;
  const allVerifiedEmpty = total === 0 && snapshot !== null && cards !== null
    && !focusedCardExists && failedSources.length === 0 && inboxError === null && cardsError === null;

  return (
    <section className="inbox" aria-label="Inbox">
      <header className="inbox__intro">
        <p className="inbox__eyebrow">Needs you</p>
        <h1 className="inbox__heading">Inbox</h1>
        <p className="inbox__lede">Decisions, deploys, pull requests, and asset movement in one place.</p>
      </header>

      {inboxError ? <p className="inbox__error" role="alert">{inboxError}</p> : null}
      {cardsError ? <p className="inbox__error" role="alert">{cardsError}</p> : null}
      {failedSources.length > 0 || inboxError !== null || cardsError !== null || snapshot === null || cards === null ? (
        <ul className="inbox__sources">
          {failedSources.map((kind) => (
            <SourceHealthRow key={kind} kind={kind} state={snapshot!.sources[kind]} onRetry={retrySource} />
          ))}
          {inboxError !== null || (snapshot === null && !inboxLoading)
            ? <ProjectionHealthRow label="Inbox sources" onRetry={() => inboxRefresher.trigger()} /> : null}
          {cardsError !== null || (cards === null && !cardsLoading)
            ? <ProjectionHealthRow label="Approval cards" onRetry={() => cardRefresher.trigger()} /> : null}
        </ul>
      ) : null}

      {allVerifiedEmpty ? <p className="inbox__empty">Nothing needs you</p> : (
        <div className="inbox__sections">
          <InboxSection title="Approvals / cards" description="Things waiting on your decision."
            count={approvalCount} revealWhenEmpty={focusedCardExists}>
            {(attentionCards.length > 0 || focusedCardExists) && cards ? (
              <CardApprovals data={cards} initialSelectedId={initialSelectedId} fetchImpl={fetchImpl} onRefresh={refreshAll} />
            ) : null}
            {unmatchedEscalations.length > 0 ? (
              <ul className="inbox__list">
                {unmatchedEscalations.map((item) => (
                  <InboxRow key={item.id} item={item} onNavigate={onNavigate} onMutate={runMutation} />
                ))}
              </ul>
            ) : null}
          </InboxSection>

          <InboxSection title="Deploys" description="Releases waiting for you to confirm or check." count={deploys.length}>
            <ul className="inbox__list">
              {deploys.map((item) => <InboxRow key={item.id} item={item} onNavigate={onNavigate} onMutate={runMutation} />)}
            </ul>
          </InboxSection>

          <InboxSection title="Pull requests" description="Code changes waiting for your review." count={pullRequests.length}>
            <ul className="inbox__list">
              {pullRequests.map((item) => <InboxRow key={item.id} item={item} onNavigate={onNavigate} onMutate={runMutation} />)}
            </ul>
          </InboxSection>

          <InboxSection title="Asset pulls" description="Files waiting to be pulled in or retried." count={assetPulls.length}>
            <ul className="inbox__list">
              {assetPulls.map((item) => <InboxRow key={item.id} item={item} onNavigate={onNavigate} onMutate={runMutation} />)}
            </ul>
          </InboxSection>
        </div>
      )}
    </section>
  );
}

function InspectButton({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return <button type="button" className="inbox__action inbox__action--inspect" data-testid="inbox-inspect" onClick={onClick}>{label}</button>;
}

function ItemCopy({ cue, title, reason, item }: {
  cue: string;
  title: string;
  reason: string;
  item: InboxItem;
}): React.JSX.Element {
  return (
    <div className="inbox__row-main">
      <p className="inbox__lead"><span className="inbox__cue">{cue}</span><span className="inbox__title" title={title}>{humanizeEntityId(title)}</span></p>
      <p className="inbox__reason">{reason}</p>
      <p className="inbox__meta">{recencyLabel('Arrived', item.createdAt)}</p>
    </div>
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
        <ItemCopy cue="Review" title={item.title} reason={`${item.subject.owner}/${item.subject.repo} #${item.subject.number}`} item={item} />
        <div className="inbox__actions">
          <a className="inbox__action inbox__action--external" href={item.href} target="_blank" rel="noopener noreferrer external"
            aria-label={`Open PR #${item.subject.number} on GitHub (opens externally in a new tab)`}>
            Open PR <span className="inbox__external-label">(external)</span>
          </a>
        </div>
      </li>
    );
  }
  if (item.kind === 'escalation') {
    return (
      <li className="inbox__row" data-testid="inbox-escalation">
        <ItemCopy cue="Open card" title={item.title} reason={item.reason} item={item} />
        <div className="inbox__actions">
          <button type="button" className="inbox__action"
            onClick={() => onNavigate?.({ view: 'inbox', focus: { kind: 'card', id: item.subject.cardId } })}>
            Open card
          </button>
        </div>
      </li>
    );
  }
  const inspect = (deploymentRef: string): void =>
    onNavigate?.({ view: 'health', focus: { kind: 'deploy', id: deploymentRef } } as unknown as NavTarget);
  if (item.kind === 'deployment-escalation') {
    return (
      <li className="inbox__row" data-testid="inbox-deployment-escalation">
        <ItemCopy cue="Inspect" title={item.title} reason="Swap deadline expired" item={item} />
        <div className="inbox__actions"><InspectButton label="Inspect" onClick={() => inspect(item.subject.deploymentRef)} /></div>
      </li>
    );
  }
  if (item.kind === 'asset-pull') {
    const control = resolveAssetPullControl(item.state);
    const endpoint = control ? `/api/inbox/asset-pull/${item.subject.intentRef}/${control.verb}` : '';
    return (
      <li className="inbox__row" data-testid={`inbox-asset-pull-${item.state}`}>
        <ItemCopy cue={control?.label ?? 'Inspect'} title={item.title}
          reason={`Run ${humanizeEntityId(item.subject.runRef)} · ${humanizeEntityId(item.state)}`} item={item} />
        <div className="inbox__actions">
          {control ? <button type="button" className="inbox__action inbox__action--mutating" data-testid="inbox-asset-control"
            onClick={() => onMutate(endpoint, {})}>{control.label}</button> : null}
          <InspectButton label="Inspect" onClick={() => onNavigate?.({ view: 'inbox', focus: { kind: 'card', id: item.subject.intentRef } } as NavTarget)} />
        </div>
      </li>
    );
  }

  const breaking = isBreakingDeployReady(item);
  const control = resolveDeploymentControl(item.state, item.blockingPtyIds, breaking);
  const endpoint = control ? `/api/inbox/deployment/${item.subject.deploymentRef}/${control.verb}` : '';
  const stateLabel = item.state === 'deploy-ready' ? (breaking ? 'Breaking release ready' : 'Release ready') : humanizeEntityId(item.state);
  return (
    <li className="inbox__row" data-testid={`inbox-deployment-${item.state}${breaking ? '-breaking' : ''}`}>
      <ItemCopy cue={control?.label ?? 'Inspect'} title={item.title}
        reason={`${stateLabel}${item.blockingPtyIds.length > 0
          ? ` · ${item.blockingPtyIds.length} open terminal${item.blockingPtyIds.length === 1 ? '' : 's'}`
          : ''}`} item={item} />
      <div className="inbox__actions">
        {control ? (
          <button type="button" className="inbox__action inbox__action--mutating" data-testid="inbox-deploy-control"
            data-verb={control.verb} disabled={control.t3} aria-disabled={control.t3}
            onClick={control.t3 ? undefined : () => onMutate(endpoint, { expectedRevision: item.revision })}>
            {control.label}
          </button>
        ) : null}
        <InspectButton label="Inspect" onClick={() => inspect(item.subject.deploymentRef)} />
      </div>
    </li>
  );
}
