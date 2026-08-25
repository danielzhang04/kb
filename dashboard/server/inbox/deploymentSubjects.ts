// Dashboard v3 P5 W3 — the Inbox projector extension for the deployment arm (§3.1). Pure projection:
// reads a Deployment store, a live-PTY-registry snapshot, and the W0 `DeployReadyPort`, and turns them
// into `DeploymentInboxItem`s plus the movement §2.5 swap-deadline escalation subject. NO store write of
// any kind lives here or is ever called — every port below is read-only by its own declared shape, and
// `projectDeploymentSubjects` never imports `createDeployment`/`transitionDeployment` [P5-C58].
import type { Deployment } from '../control/types.ts';
import { isTerminalDeploymentState, type DeploymentState } from '../control/deploymentState.ts';
import type { DeployReadyPort } from '../deploy/contracts.ts';
import { ContractDecodeError, sha256Hex } from '../write/durableManifest.ts';
import {
  deployReadyRevision, deploymentItemId, stringifyDeploymentRevision,
  type DeploymentInboxItem, type DeploymentItemState,
} from './deploymentContracts.ts';

// ---------------------------------------------------------------------------------------------------
// Injected read-only ports. Each is declared with exactly one read method, so a double built to satisfy
// the interface literally cannot expose a write path through it [P5-C58].
// ---------------------------------------------------------------------------------------------------

export interface DeploymentsReaderPort {
  readonly listDeployments: () => readonly Deployment[];
}

export interface LivePtySessionsPort {
  /** The P3 registry snapshot's live session ids at projection time (§3.1, movement:90). */
  readonly liveSessionIds: () => readonly string[];
}

export interface LiveReleasePort {
  readonly liveSha: () => string | null;
}

export interface CommitAncestryPort {
  readonly isStrictDescendant: (candidateSha: string, liveSha: string) => boolean;
}

const PTY_SESSION_ID = /^pty-[0-9a-f]{32}$/;

/** `waiting-confirmation | requested | parked` — the only states with a live-PTY blocking set [P5-C39]. */
const PRE_SWAP_STATES = new Set<DeploymentState>(['waiting-confirmation', 'requested', 'parked']);

function liveBlockingPtyIds(state: DeploymentState, pty: LivePtySessionsPort): readonly string[] {
  if (!PRE_SWAP_STATES.has(state)) return [];
  const ids = pty.liveSessionIds().filter((id) => PTY_SESSION_ID.test(id));
  return [...new Set(ids)].sort();
}

function deploymentTitle(state: DeploymentItemState, targetCommit: string): string {
  return `Deploy ${targetCommit.slice(0, 12)} — ${state}`;
}

/** `acknowledged` and terminal-but-already-acknowledged records leave the Inbox (design 266). */
function isPresented(deployment: Deployment): boolean {
  if (deployment.state === 'acknowledged') return false;
  if (isTerminalDeploymentState(deployment.state) && deployment.acknowledgedBy !== null) return false;
  return true;
}

/** One stored Deployment -> its Inbox item, or `null` if it should not be presented. */
export function projectStoredDeploymentItem(
  deployment: Deployment,
  pty: LivePtySessionsPort,
): DeploymentInboxItem | null {
  if (!isPresented(deployment)) return null;
  return {
    kind: 'deployment',
    id: deploymentItemId(deployment.deploymentRef),
    createdAt: deployment.requestedAt,
    revision: stringifyDeploymentRevision(deployment.revision),
    subject: { deploymentRef: deployment.deploymentRef },
    title: deploymentTitle(deployment.state, deployment.targetCommit),
    state: deployment.state,
    blockingPtyIds: liveBlockingPtyIds(deployment.state, pty),
  };
}

// ---------------------------------------------------------------------------------------------------
// Swap-deadline escalation (movement:90,113,164 §2.5). A distinct, unregistered subject kind — additive
// per the wave rule, wired into the closed Inbox union only by the owning serial vertical [P5-C18].
// ---------------------------------------------------------------------------------------------------

export interface DeploymentEscalationItem {
  readonly kind: 'deployment-escalation';
  readonly id: string;
  readonly createdAt: string;
  readonly revision: string;
  readonly subject: { readonly deploymentRef: string };
  readonly title: string;
  readonly swapDeadlineAt: string;
}

export function deploymentEscalationItemId(deploymentRef: string): string {
  return sha256Hex(`deployment-escalation\u0000${deploymentRef}`);
}

/**
 * A `swapping` deployment past its hard `swapDeadlineAt` escalates instead of stalling silently
 * (movement:90,113,164). One deterministic subject per deployment ref+revision — deduplicated by
 * construction, since the same store record always yields the same id/revision.
 */
export function resolveSwapEscalation(deployment: Deployment, now: Date): DeploymentEscalationItem | null {
  if (deployment.state !== 'swapping' || deployment.swapDeadlineAt === null) return null;
  if (Date.parse(deployment.swapDeadlineAt) > now.getTime()) return null;
  return {
    kind: 'deployment-escalation',
    id: deploymentEscalationItemId(deployment.deploymentRef),
    createdAt: deployment.swapDeadlineAt,
    revision: sha256Hex(`${deployment.deploymentRef}\u0000${deployment.revision}\u0000${deployment.swapDeadlineAt}`),
    subject: { deploymentRef: deployment.deploymentRef },
    title: `Deploy swap deadline expired at ${deployment.swapDeadlineAt}`,
    swapDeadlineAt: deployment.swapDeadlineAt,
  };
}

// ---------------------------------------------------------------------------------------------------
// deploy-ready gate (§3.1, design 371) [P5-C35, P5-C42, P5-C58, P5-C59].
// ---------------------------------------------------------------------------------------------------

/** True when some stored Deployment still needs the operator's attention (non-terminal, or terminal
 * and not yet acknowledged) — either half blocks a deploy-ready subject from also being shown [P5-C35]. */
function hasBlockingDeployment(deployments: readonly Deployment[]): boolean {
  return deployments.some((deployment) => !isTerminalDeploymentState(deployment.state)
    || (isTerminalDeploymentState(deployment.state) && deployment.acknowledgedBy === null));
}

export interface ProjectDeployReadyInput {
  readonly deployReady: DeployReadyPort;
  readonly liveRelease: LiveReleasePort;
  readonly ancestry: CommitAncestryPort;
  readonly deployments: DeploymentsReaderPort;
  readonly now: Date;
}

/**
 * `DeployReadyPort` is the ONLY candidate source — an injected `null` projects nothing [P5-C42]. Both
 * `breaking` variants project the SAME derived `deploy-ready:<sha>` subject with `blockingPtyIds: []`
 * [P5-C58, P5-C59]; only the resolved action differs (built by `actionResolver.ts`, not here).
 */
export function projectDeployReadyItem(input: ProjectDeployReadyInput): DeploymentInboxItem | null {
  const candidate = input.deployReady.latestCandidate();
  if (candidate === null) return null;
  const liveSha = input.liveRelease.liveSha();
  if (liveSha === null) return null;
  if (!input.ancestry.isStrictDescendant(candidate.sha, liveSha)) return null;
  if (hasBlockingDeployment(input.deployments.listDeployments())) return null;
  const deploymentRef = `deploy-ready:${candidate.sha}`;
  return {
    kind: 'deployment',
    id: deploymentItemId(deploymentRef),
    createdAt: input.now.toISOString(),
    revision: deployReadyRevision(candidate.sha, liveSha),
    subject: { deploymentRef },
    title: `Deploy ready: ${candidate.sha.slice(0, 12)}${candidate.breaking ? ' (breaking)' : ''}`,
    state: 'deploy-ready',
    blockingPtyIds: [],
  };
}

// ---------------------------------------------------------------------------------------------------
// Composition — the full deployment-arm projection pass. A failing source yields a `failed` state and
// its LAST-KNOWN-empty items, never a false-empty `ok` [design 367's "never directly mutated" pairs
// with P4's InboxSourceSnapshot idiom: partial failure never invents silence].
// ---------------------------------------------------------------------------------------------------

export type DeploymentSourceState =
  | { readonly status: 'ok' }
  | { readonly status: 'failed'; readonly errorCode: 'unavailable' };

export interface ProjectDeploymentSubjectsInput {
  readonly deployments: DeploymentsReaderPort;
  readonly pty: LivePtySessionsPort;
  readonly deployReady: DeployReadyPort;
  readonly liveRelease: LiveReleasePort;
  readonly ancestry: CommitAncestryPort;
  readonly now: Date;
}

export interface DeploymentSubjectsResult {
  readonly items: readonly DeploymentInboxItem[];
  readonly escalations: readonly DeploymentEscalationItem[];
  readonly state: DeploymentSourceState;
}

function compareById(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function projectDeploymentSubjects(input: ProjectDeploymentSubjectsInput): DeploymentSubjectsResult {
  try {
    const stored = input.deployments.listDeployments();
    const items: DeploymentInboxItem[] = [];
    const escalations: DeploymentEscalationItem[] = [];
    for (const deployment of stored) {
      const item = projectStoredDeploymentItem(deployment, input.pty);
      if (item !== null) items.push(item);
      const escalation = resolveSwapEscalation(deployment, input.now);
      if (escalation !== null) escalations.push(escalation);
    }
    const deployReadyItem = projectDeployReadyItem({
      deployReady: input.deployReady, liveRelease: input.liveRelease,
      ancestry: input.ancestry, deployments: input.deployments, now: input.now,
    });
    if (deployReadyItem !== null) items.push(deployReadyItem);
    items.sort(compareById);
    escalations.sort(compareById);
    return { items, escalations, state: { status: 'ok' } };
  } catch (error) {
    if (error instanceof ContractDecodeError) throw error;
    return { items: [], escalations: [], state: { status: 'failed', errorCode: 'unavailable' } };
  }
}
