// Dashboard v3 P5 W3 — the Inbox action resolver. Wraps the W0 total action functions
// (`resolveDeploymentAction`, `resolveAssetPullAction` in `./deploymentContracts.ts`) with the
// projector-facing guards this wave owns: the direct-Abort 409 refusal at `waiting-confirmation`,
// `swapping`, `resuming` (movement:115), and a closed-verb assertion that `decline` can never surface
// [P5-C18, P5-C49, P5-C58]. Pure functions only — no route, no store mutation.
import {
  resolveAssetPullAction, resolveDeploymentAction,
  type AssetPullAction, type AssetPullMutatingVerb, type AssetPullState,
  type DeploymentAction, type DeploymentActionInput, type DeploymentItemState, type DeploymentMutatingVerb,
} from './deploymentContracts.ts';

export { resolveAssetPullAction, resolveDeploymentAction };

/** The nine `DEPLOYMENT_STATES` plus the two `deploy-ready` variants — eleven total cases [P5-C58]. */
export function deploymentActionTableCases(): readonly DeploymentActionInput[] {
  const common = { deploymentRef: 'deployment-1', blockingPtyIds: [] as readonly string[] };
  const states: readonly DeploymentItemState[] = [
    'waiting-confirmation', 'requested', 'parked', 'swapping', 'resuming',
    'succeeded', 'aborted', 'failed', 'acknowledged',
  ];
  return [
    ...states.map((state): DeploymentActionInput => ({
      ...common, state, abortRequestedAt: null, breaking: false,
    })),
    { ...common, state: 'deploy-ready', abortRequestedAt: null, breaking: false },
    { ...common, state: 'deploy-ready', abortRequestedAt: null, breaking: true },
  ];
}

/**
 * `waiting-confirmation`, `swapping`, `resuming` never expose Abort at all (`resolveDeploymentAction`
 * already omits it structurally), and a direct call against one of those three is refused `409` per
 * `movement:115` — this is that refusal as a pure, route-independent predicate.
 */
const DIRECT_ABORT_REFUSED_STATES = new Set<DeploymentItemState>([
  'waiting-confirmation', 'swapping', 'resuming',
]);

export function isDirectAbortRefused(state: DeploymentItemState): boolean {
  return DIRECT_ABORT_REFUSED_STATES.has(state);
}

export interface AbortAttemptResult {
  readonly allowed: boolean;
  readonly status: 200 | 409;
}

/** `requested|parked` (movement:115's "prominently abortable" pair) are the only allowed direct Aborts. */
export function resolveAbortAttempt(state: DeploymentItemState): AbortAttemptResult {
  return isDirectAbortRefused(state) ? { allowed: false, status: 409 } : { allowed: true, status: 200 };
}

// ---------------------------------------------------------------------------------------------------
// Closed-verb guard — there is no `decline` action, endpoint, or copy anywhere [P5-C49].
// ---------------------------------------------------------------------------------------------------

const DEPLOYMENT_MUTATING_VERBS: readonly DeploymentMutatingVerb[] = [
  'confirm', 'deploy', 'abort', 'acknowledge', 'close-ptys-and-continue',
];
const ASSET_PULL_MUTATING_VERBS: readonly AssetPullMutatingVerb[] = ['pull', 'retry'];
const ALL_MUTATING_VERBS: ReadonlySet<string> = new Set([
  ...DEPLOYMENT_MUTATING_VERBS, ...ASSET_PULL_MUTATING_VERBS,
]);

/** Throws on any verb outside the closed sets above — in particular `'decline'`, which is never a member. */
export function assertKnownMutatingVerb(verb: string): void {
  if (!ALL_MUTATING_VERBS.has(verb)) {
    throw new Error(`unknown mutating verb ${JSON.stringify(verb)} — 'decline' does not exist [P5-C49]`);
  }
}

// ---------------------------------------------------------------------------------------------------
// One dispatch surface over both Inbox arms, for the serial vertical's route to call.
// ---------------------------------------------------------------------------------------------------

export type InboxActionResolution =
  | { readonly kind: 'deployment'; readonly action: DeploymentAction }
  | { readonly kind: 'asset-pull'; readonly action: AssetPullAction };

export type InboxActionQuery =
  | { readonly kind: 'deployment'; readonly input: DeploymentActionInput }
  | { readonly kind: 'asset-pull'; readonly intentRef: string; readonly state: AssetPullState };

export function resolveInboxAction(query: InboxActionQuery): InboxActionResolution {
  if (query.kind === 'deployment') {
    return { kind: 'deployment', action: resolveDeploymentAction(query.input) };
  }
  return { kind: 'asset-pull', action: resolveAssetPullAction(query.intentRef, query.state) };
}
