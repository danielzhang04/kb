// P4 W6.1: the browser Inbox client, cut over ATOMICALLY to the closed PR + escalation + source-health
// contract of section 3.3. No compatibility union or adapter remains. The decoder validates SHAPE only
// (it never recomputes the server's sha256 revisions — those are opaque 64-hex strings here) and rebuilds
// the PR href from the pinned owner/repo/number so subject text can never supply a link target.

// P5 W6.1: the FOUR-source envelope. The decoder validates SHAPE only (it never recomputes the server's
// sha256 revisions) and admits the two new item arms `deployment` + `asset-pull` (plus the projected
// `deployment-escalation` subject). No compatibility union or adapter remains [P5-C22].
import { record, exactKeys } from './decodeGuards.ts';

export type InboxSourceKind = 'pr' | 'escalation' | 'deployment' | 'assetPull';
export type InboxSourceErrorCode = 'unavailable' | 'timeout' | 'overflow' | 'invalid';
const SOURCE_ERROR_CODES: readonly InboxSourceErrorCode[] = ['unavailable', 'timeout', 'overflow', 'invalid'];

export type SourceState =
  | { status: 'verified'; revision: string; verifiedAt: string; stale?: true }
  | { status: 'failed'; revision?: string; verifiedAt?: string; errorCode: InboxSourceErrorCode; stale: boolean };

export interface PrItem {
  id: string;
  createdAt: string;
  revision: string;
  kind: 'pr';
  subject: { owner: string; repo: string; number: number };
  title: string;
  href: string;
}

export interface EscalationItem {
  id: string;
  createdAt: string;
  revision: string;
  kind: 'escalation';
  subject: { cardId: string };
  related: { runRef?: string; stopEvent?: string };
  title: string;
  reason: string;
}

export type DeploymentItemState =
  | 'waiting-confirmation' | 'requested' | 'parked' | 'swapping' | 'resuming'
  | 'succeeded' | 'aborted' | 'failed' | 'acknowledged' | 'deploy-ready';
export const DEPLOYMENT_ITEM_STATES: readonly DeploymentItemState[] = [
  'waiting-confirmation', 'requested', 'parked', 'swapping', 'resuming',
  'succeeded', 'aborted', 'failed', 'acknowledged', 'deploy-ready',
];

export interface DeploymentItem {
  id: string;
  createdAt: string;
  revision: string;
  kind: 'deployment';
  subject: { deploymentRef: string };
  title: string;
  state: DeploymentItemState;
  blockingPtyIds: string[];
}

export type AssetPullItemState = 'pending' | 'in-flight' | 'succeeded' | 'failed' | 'offline';
const ASSET_PULL_ITEM_STATES: readonly AssetPullItemState[] = ['pending', 'in-flight', 'succeeded', 'failed', 'offline'];

export interface AssetPullItem {
  id: string;
  createdAt: string;
  revision: string;
  kind: 'asset-pull';
  subject: { intentRef: string; runRef: string; manifestDigest: string };
  title: string;
  state: AssetPullItemState;
}

export interface DeploymentEscalationItem {
  id: string;
  createdAt: string;
  revision: string;
  kind: 'deployment-escalation';
  subject: { deploymentRef: string };
  title: string;
  swapDeadlineAt: string;
}

export type InboxItem = PrItem | EscalationItem | DeploymentItem | AssetPullItem | DeploymentEscalationItem;

export interface InboxResponse {
  items: InboxItem[];
  revision: string;
  sources: { pr: SourceState; escalation: SourceState; deployment: SourceState; assetPull: SourceState };
}

export type FetchLike = typeof fetch;


function hex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** The server rebuilds the href from the pin; the client re-derives it to reject a tampered link. */
function prHref(subject: { owner: string; repo: string; number: number }): string {
  return `https://github.com/${subject.owner}/${subject.repo}/pull/${subject.number}`;
}

function decodePrItem(item: Record<string, unknown>): PrItem | null {
  if (!exactKeys(item, ['createdAt', 'href', 'id', 'kind', 'revision', 'subject', 'title'])) return null;
  const subject = record(item.subject);
  if (!subject || !exactKeys(subject, ['number', 'owner', 'repo'])) return null;
  const { owner, repo, number } = subject;
  if (typeof owner !== 'string' || typeof repo !== 'string'
    || typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return null;
  if (!hex64(item.id) || !hex64(item.revision) || !validTime(item.createdAt) || typeof item.title !== 'string') return null;
  const pinned = { owner, repo, number };
  if (item.href !== prHref(pinned)) return null;
  return { id: item.id, createdAt: item.createdAt, revision: item.revision, kind: 'pr', subject: pinned, title: item.title, href: item.href };
}

function decodeEscalationItem(item: Record<string, unknown>): EscalationItem | null {
  if (!exactKeys(item, ['createdAt', 'id', 'kind', 'reason', 'related', 'revision', 'subject', 'title'])) return null;
  const subject = record(item.subject);
  const related = record(item.related);
  if (!subject || !exactKeys(subject, ['cardId']) || !related) return null;
  if (!Object.keys(related).every((key) => key === 'runRef' || key === 'stopEvent')) return null;
  if (!Object.values(related).every((entry) => typeof entry === 'string')) return null;
  if (!hex64(item.id) || !hex64(item.revision) || !validTime(item.createdAt)
    || typeof subject.cardId !== 'string' || !/^[0-9a-f]{8}-/.test(subject.cardId)
    || typeof item.title !== 'string' || typeof item.reason !== 'string') return null;
  return {
    id: item.id,
    createdAt: item.createdAt,
    revision: item.revision,
    kind: 'escalation',
    subject: { cardId: subject.cardId },
    related: {
      ...(typeof related.runRef === 'string' ? { runRef: related.runRef } : {}),
      ...(typeof related.stopEvent === 'string' ? { stopEvent: related.stopEvent } : {}),
    },
    title: item.title,
    reason: item.reason,
  };
}

const PTY_SESSION_ID = /^pty-[0-9a-f]{32}$/;

function decodeDeploymentItem(item: Record<string, unknown>): DeploymentItem | null {
  if (!exactKeys(item, ['blockingPtyIds', 'createdAt', 'id', 'kind', 'revision', 'state', 'subject', 'title'])) return null;
  const subject = record(item.subject);
  if (!subject || !exactKeys(subject, ['deploymentRef']) || typeof subject.deploymentRef !== 'string') return null;
  if (!hex64(item.id) || typeof item.revision !== 'string' || !validTime(item.createdAt) || typeof item.title !== 'string') return null;
  const state = item.state;
  if (typeof state !== 'string' || !DEPLOYMENT_ITEM_STATES.includes(state as DeploymentItemState)) return null;
  const rawIds = item.blockingPtyIds;
  if (!Array.isArray(rawIds) || !rawIds.every((id) => typeof id === 'string' && PTY_SESSION_ID.test(id))) return null;
  // A deploy-ready subject is a read projection with no record behind it — it carries no blocking ids.
  if (state === 'deploy-ready' && rawIds.length > 0) return null;
  return {
    id: item.id, createdAt: item.createdAt, revision: item.revision, kind: 'deployment',
    subject: { deploymentRef: subject.deploymentRef }, title: item.title,
    state: state as DeploymentItemState, blockingPtyIds: rawIds as string[],
  };
}

function decodeAssetPullItem(item: Record<string, unknown>): AssetPullItem | null {
  if (!exactKeys(item, ['createdAt', 'id', 'kind', 'revision', 'state', 'subject', 'title'])) return null;
  const subject = record(item.subject);
  if (!subject || !exactKeys(subject, ['intentRef', 'manifestDigest', 'runRef'])) return null;
  const { intentRef, manifestDigest, runRef } = subject;
  if (typeof intentRef !== 'string' || typeof runRef !== 'string' || !hex64(manifestDigest)) return null;
  if (!hex64(item.id) || typeof item.revision !== 'string' || !validTime(item.createdAt) || typeof item.title !== 'string') return null;
  const state = item.state;
  if (typeof state !== 'string' || !ASSET_PULL_ITEM_STATES.includes(state as AssetPullItemState)) return null;
  return {
    id: item.id, createdAt: item.createdAt, revision: item.revision, kind: 'asset-pull',
    subject: { intentRef, runRef, manifestDigest }, title: item.title, state: state as AssetPullItemState,
  };
}

function decodeDeploymentEscalationItem(item: Record<string, unknown>): DeploymentEscalationItem | null {
  if (!exactKeys(item, ['createdAt', 'id', 'kind', 'revision', 'subject', 'swapDeadlineAt', 'title'])) return null;
  const subject = record(item.subject);
  if (!subject || !exactKeys(subject, ['deploymentRef']) || typeof subject.deploymentRef !== 'string') return null;
  if (!hex64(item.id) || typeof item.revision !== 'string' || !validTime(item.createdAt)
    || typeof item.title !== 'string' || !validTime(item.swapDeadlineAt)) return null;
  return {
    id: item.id, createdAt: item.createdAt, revision: item.revision, kind: 'deployment-escalation',
    subject: { deploymentRef: subject.deploymentRef }, title: item.title, swapDeadlineAt: item.swapDeadlineAt,
  };
}

function decodeItem(value: unknown): InboxItem | null {
  const item = record(value);
  if (!item) return null;
  if (item.kind === 'pr') return decodePrItem(item);
  if (item.kind === 'escalation') return decodeEscalationItem(item);
  if (item.kind === 'deployment') return decodeDeploymentItem(item);
  if (item.kind === 'asset-pull') return decodeAssetPullItem(item);
  if (item.kind === 'deployment-escalation') return decodeDeploymentEscalationItem(item);
  return null;
}

function decodeSourceState(value: unknown): SourceState | null {
  const state = record(value);
  if (!state) return null;
  if (state.status === 'verified') {
    if (!exactKeys(state, state.stale === undefined ? ['revision', 'status', 'verifiedAt'] : ['revision', 'stale', 'status', 'verifiedAt'])) return null;
    if (state.stale !== undefined && state.stale !== true) return null;
    if (typeof state.revision !== 'string' || !validTime(state.verifiedAt)) return null;
    return { status: 'verified', revision: state.revision, verifiedAt: state.verifiedAt, ...(state.stale === true ? { stale: true } : {}) };
  }
  if (state.status === 'failed') {
    if (typeof state.errorCode !== 'string' || !SOURCE_ERROR_CODES.includes(state.errorCode as InboxSourceErrorCode)) return null;
    if (typeof state.stale !== 'boolean') return null;
    if (state.revision !== undefined && typeof state.revision !== 'string') return null;
    if (state.verifiedAt !== undefined && !validTime(state.verifiedAt)) return null;
    return {
      status: 'failed',
      errorCode: state.errorCode as InboxSourceErrorCode,
      stale: state.stale,
      ...(typeof state.revision === 'string' ? { revision: state.revision } : {}),
      ...(typeof state.verifiedAt === 'string' ? { verifiedAt: state.verifiedAt } : {}),
    };
  }
  return null;
}

function decode(value: unknown): InboxResponse | null {
  const response = record(value);
  if (!response || !exactKeys(response, ['items', 'revision', 'sources'])) return null;
  if (!Array.isArray(response.items) || typeof response.revision !== 'string') return null;
  const items = response.items.map(decodeItem);
  if (!items.every((item): item is InboxItem => item !== null)) return null;
  const sources = record(response.sources);
  if (!sources || !exactKeys(sources, ['assetPull', 'deployment', 'escalation', 'pr'])) return null;
  const pr = decodeSourceState(sources.pr);
  const escalation = decodeSourceState(sources.escalation);
  const deployment = decodeSourceState(sources.deployment);
  const assetPull = decodeSourceState(sources.assetPull);
  if (!pr || !escalation || !deployment || !assetPull) return null;
  return { items, revision: response.revision, sources: { pr, escalation, deployment, assetPull } };
}

/** `refresh` retries only the named failed source (`?refresh=deployment|assetPull|pr|escalation`). */
export async function fetchInbox(fetchImpl: FetchLike = fetch, refresh?: InboxSourceKind): Promise<InboxResponse> {
  const url = refresh ? `/api/inbox?refresh=${refresh}` : '/api/inbox';
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET /api/inbox failed: ${response.status}`);
  const body = decode(await response.json());
  if (!body) throw new Error('Invalid Inbox response');
  return body;
}
