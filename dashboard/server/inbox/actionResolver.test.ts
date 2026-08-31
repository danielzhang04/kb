import { describe, expect, it } from 'vitest';
import {
  assertKnownMutatingVerb, deploymentActionTableCases, isDirectAbortRefused,
  resolveAbortAttempt, resolveAssetPullAction, resolveDeploymentAction, resolveInboxAction,
} from './actionResolver.ts';
import type { DeploymentAction, DeploymentItemState } from './deploymentContracts.ts';

const ALL_STATES: readonly DeploymentItemState[] = [
  'waiting-confirmation', 'requested', 'parked', 'swapping', 'resuming',
  'succeeded', 'aborted', 'failed', 'acknowledged', 'deploy-ready',
];

describe('deployment action table — eleven cases, exhaustive [P5-C18, P5-C49, P5-C58]', () => {
  const cases = deploymentActionTableCases();

  it('covers exactly the nine DEPLOYMENT_STATES plus both deploy-ready variants', () => {
    expect(cases).toHaveLength(11);
    const stateShape = cases.map((c) => (c.state === 'deploy-ready' ? `deploy-ready:${c.breaking}` : c.state));
    expect(new Set(stateShape).size).toBe(11);
    for (const state of ALL_STATES) {
      expect(cases.some((c) => c.state === state)).toBe(true);
    }
  });

  it('no state is unmapped: resolveDeploymentAction never throws over the table', () => {
    for (const input of cases) {
      expect(() => resolveDeploymentAction(input)).not.toThrow();
    }
  });

  it('at most one mutating control per case, exactly one wherever the case is actionable', () => {
    const actionable = new Set<string>([
      'waiting-confirmation', 'requested', 'parked', 'succeeded', 'aborted', 'failed', 'deploy-ready:false', 'deploy-ready:true',
    ]);
    for (const input of cases) {
      const action = resolveDeploymentAction(input);
      // Structurally at most one: `mutating` is a single nullable field, never an array or a pair.
      expect(action.mutating === null || typeof action.mutating === 'object').toBe(true);
      const key = input.state === 'deploy-ready' ? `deploy-ready:${input.breaking}` : input.state;
      if (actionable.has(key)) {
        expect(action.mutating).not.toBeNull();
      } else {
        expect(action.mutating).toBeNull();
      }
    }
  });

  it('waiting-confirmation resolves Confirm alone', () => {
    const action = resolveDeploymentAction({
      state: 'waiting-confirmation', deploymentRef: 'd1', blockingPtyIds: [], abortRequestedAt: null, breaking: false,
    });
    expect(action.mutating?.verb).toBe('confirm');
  });

  it('deploy-ready breaking:false -> Deploy; breaking:true -> Confirm', () => {
    const green = resolveDeploymentAction({
      state: 'deploy-ready', deploymentRef: 'deploy-ready:sha', blockingPtyIds: [], abortRequestedAt: null, breaking: false,
    });
    const breaking = resolveDeploymentAction({
      state: 'deploy-ready', deploymentRef: 'deploy-ready:sha', blockingPtyIds: [], abortRequestedAt: null, breaking: true,
    });
    expect(green.mutating?.verb).toBe('deploy');
    expect(breaking.mutating?.verb).toBe('confirm');
  });

  it('Inspect is always present as navigation, regardless of the mutating control', () => {
    for (const input of cases) {
      const action = resolveDeploymentAction(input);
      expect(action.inspect).toEqual({ kind: 'navigate', deploymentRef: input.deploymentRef });
    }
  });

  it('a table-driven fixture that FAILS if any case yields a second mutating control', () => {
    // `DeploymentAction.mutating` is a single nullable field, not a set — the only way a second control
    // could ever appear is via an array/union collapse, which this assertion locks against by shape.
    for (const input of cases) {
      const action: DeploymentAction = resolveDeploymentAction(input);
      const mutatingFieldNames = Object.keys(action).filter((key) => key !== 'inspect');
      expect(mutatingFieldNames).toEqual(['mutating']);
    }
  });
});

describe('no decline anywhere [P5-C49]', () => {
  it('the deployment mutating-verb union never contains decline', () => {
    for (const input of deploymentActionTableCases()) {
      const action = resolveDeploymentAction(input);
      expect(action.mutating?.verb).not.toBe('decline');
    }
  });

  it('the asset-pull mutating-verb union never contains decline', () => {
    for (const state of ['pending', 'in-flight', 'succeeded', 'failed', 'offline'] as const) {
      const action = resolveAssetPullAction('assetpull-1', state);
      expect(action.mutating?.verb).not.toBe('decline');
    }
  });

  it('assertKnownMutatingVerb refuses decline and accepts every real verb', () => {
    expect(() => assertKnownMutatingVerb('decline')).toThrow(/decline/);
    for (const verb of ['confirm', 'deploy', 'abort', 'acknowledge', 'close-ptys-and-continue', 'pull', 'retry']) {
      expect(() => assertKnownMutatingVerb(verb)).not.toThrow();
    }
  });

  it('no generated deployment title or endpoint string contains the word decline', () => {
    for (const input of deploymentActionTableCases()) {
      const action = resolveDeploymentAction(input);
      const text = JSON.stringify(action).toLowerCase();
      expect(text).not.toContain('decline');
    }
  });
});

describe('direct Abort refusal at waiting-confirmation | swapping | resuming (movement:115)', () => {
  it('refuses 409 at exactly those three states', () => {
    for (const state of ['waiting-confirmation', 'swapping', 'resuming'] as const) {
      expect(isDirectAbortRefused(state)).toBe(true);
      expect(resolveAbortAttempt(state)).toEqual({ allowed: false, status: 409 });
    }
  });

  it('allows a direct Abort attempt at requested|parked (movement:115 "prominently abortable")', () => {
    for (const state of ['requested', 'parked'] as const) {
      expect(isDirectAbortRefused(state)).toBe(false);
      expect(resolveAbortAttempt(state)).toEqual({ allowed: true, status: 200 });
    }
  });

  it('every other state is also not a refused-abort state (Abort is simply not offered there)', () => {
    for (const state of ['succeeded', 'aborted', 'failed', 'acknowledged', 'deploy-ready'] as const) {
      expect(isDirectAbortRefused(state)).toBe(false);
    }
  });

  it('swapping/resuming never resolve an Abort control from resolveDeploymentAction itself', () => {
    for (const state of ['swapping', 'resuming'] as const) {
      const action = resolveDeploymentAction({
        state, deploymentRef: 'd1', blockingPtyIds: [], abortRequestedAt: null, breaking: false,
      });
      expect(action.mutating).toBeNull();
    }
  });
});

describe('resolveInboxAction dispatch', () => {
  it('dispatches deployment queries to resolveDeploymentAction', () => {
    const result = resolveInboxAction({
      kind: 'deployment',
      input: { state: 'requested', deploymentRef: 'd1', blockingPtyIds: [], abortRequestedAt: null, breaking: false },
    });
    expect(result.kind).toBe('deployment');
    expect(result.action.mutating?.verb).toBe('abort');
  });

  it('dispatches asset-pull queries to resolveAssetPullAction', () => {
    const result = resolveInboxAction({ kind: 'asset-pull', intentRef: 'assetpull-1', state: 'pending' });
    expect(result.kind).toBe('asset-pull');
    expect(result.action.mutating?.verb).toBe('pull');
  });
});
