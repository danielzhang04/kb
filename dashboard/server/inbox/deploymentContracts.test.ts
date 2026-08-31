import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractDecodeError } from '../write/durableManifest.ts';
import { DEPLOYMENT_STATES } from '../control/deploymentState.ts';
import {
  ASSET_PULL_MAX_ATTEMPTS, DEPLOYMENT_ITEM_STATES,
  assetPullIdempotencyKey, assetPullItemId, decodeAssetPullIntent, decodeDeploymentInboxItem,
  decodeQuiescenceActionPayload, deployReadyRevision, deploymentItemId, isDeployReadyRevision,
  parseDeploymentRef, parseDeploymentRevision, quiescenceDigest, resolveAssetPullAction,
  resolveDeploymentAction, stringifyDeploymentRevision,
} from './deploymentContracts.ts';
import type { DeploymentAction, DeploymentActionInput, DeploymentMutatingControl } from './deploymentContracts.ts';

interface VectorCase { readonly name: string; readonly field?: string; readonly value: unknown }
interface ContractVectors {
  readonly constants: Record<string, string>;
  readonly deploymentItems: { readonly valid: readonly VectorCase[]; readonly invalid: readonly VectorCase[] };
  readonly deploymentRevisions: { readonly accept: readonly { s: string; n: number }[]; readonly reject: readonly string[] };
  readonly deploymentRefs: { readonly accept: readonly string[]; readonly reject: readonly string[] };
  readonly assetPullIntents: { readonly valid: readonly VectorCase[]; readonly invalid: readonly VectorCase[] };
  readonly quiescence: { readonly valid: readonly (VectorCase & { digest: string })[]; readonly invalid: readonly VectorCase[] };
}
const vectors = JSON.parse(readFileSync(
  new URL('../../../tests/fixtures/dashboard-v3-p5-contract-vectors.json', import.meta.url),
  'utf8',
)) as ContractVectors;

describe('revision + ref parse/stringify (P5-C28, P5-C58)', () => {
  it('stringifies deployment:<n> with no padding', () => {
    expect(stringifyDeploymentRevision(0)).toBe('deployment:0');
    expect(stringifyDeploymentRevision(42)).toBe('deployment:42');
  });

  for (const accept of vectors.deploymentRevisions.accept) {
    it(`parses ${accept.s}`, () => expect(parseDeploymentRevision(accept.s)).toBe(accept.n));
  }
  for (const reject of vectors.deploymentRevisions.reject) {
    it(`refuses revision ${JSON.stringify(reject)}`, () => {
      expect(() => parseDeploymentRevision(reject)).toThrow(ContractDecodeError);
    });
  }

  it('round-trips stringify -> parse', () => {
    for (const n of [0, 1, 9, 1234567890]) expect(parseDeploymentRevision(stringifyDeploymentRevision(n))).toBe(n);
  });

  it('builds the derived deploy-ready:<sha256> revision', () => {
    const rev = deployReadyRevision(vectors.constants['targetSha']!, vectors.constants['liveSha']!);
    expect(rev).toBe(vectors.constants['deployReadyRevision']);
    expect(isDeployReadyRevision(rev)).toBe(true);
    expect(isDeployReadyRevision('deployment:3')).toBe(false);
  });

  for (const accept of vectors.deploymentRefs.accept) {
    it(`accepts ref ${accept}`, () => expect(parseDeploymentRef(accept).ref).toBe(accept));
  }
  for (const reject of vectors.deploymentRefs.reject) {
    it(`refuses ref ${JSON.stringify(reject)}`, () => {
      expect(() => parseDeploymentRef(reject)).toThrow(ContractDecodeError);
    });
  }
});

describe('deployment Inbox item (design 256)', () => {
  it('exposes the nine states plus deploy-ready', () => {
    expect([...DEPLOYMENT_ITEM_STATES]).toEqual([...DEPLOYMENT_STATES, 'deploy-ready']);
  });

  it('computes the pinned item id and it is stable across Deploy [P5-C17]', () => {
    const ref = vectors.constants['deployReadyRef']!;
    expect(deploymentItemId(ref)).toBe(vectors.constants['deployReadyItemId']);
  });

  for (const vector of vectors.deploymentItems.valid) {
    it(`decodes ${vector.name}`, () => {
      expect(decodeDeploymentInboxItem(vector.value)).toEqual(vector.value);
    });
  }
  for (const vector of vectors.deploymentItems.invalid) {
    it(`refuses ${vector.name}`, () => {
      expect(() => decodeDeploymentInboxItem(vector.value)).toThrow(ContractDecodeError);
    });
  }
});

describe('resolveDeploymentAction — total, single mutating control (P5-C18, P5-C49, P5-C58)', () => {
  const input = (over: Partial<DeploymentActionInput>): DeploymentActionInput => ({
    state: 'requested', deploymentRef: 'deploy-ready:aa', blockingPtyIds: [], abortRequestedAt: null,
    breaking: false, ...over,
  });
  const verb = (a: DeploymentAction): string | null => a.mutating?.verb ?? null;

  it('maps every one of the eleven cases to at most one mutating control, Inspect always present', () => {
    const cases: Array<[DeploymentActionInput, string | null, boolean]> = [
      [input({ state: 'deploy-ready', breaking: false }), 'deploy', true],
      [input({ state: 'deploy-ready', breaking: true }), 'confirm', true],
      [input({ state: 'waiting-confirmation' }), 'confirm', true],
      [input({ state: 'requested' }), 'abort', true],
      [input({ state: 'parked' }), 'abort', true],
      [input({ state: 'requested', abortRequestedAt: 'now' }), null, false],
      [input({ state: 'swapping' }), null, false],
      [input({ state: 'resuming' }), null, false],
      [input({ state: 'succeeded' }), 'acknowledge', false],
      [input({ state: 'aborted' }), 'acknowledge', false],
      [input({ state: 'failed' }), 'acknowledge', false],
      [input({ state: 'acknowledged' }), null, false],
    ];
    for (const [inp, expectedVerb, t3] of cases) {
      const action = resolveDeploymentAction(inp);
      expect(verb(action)).toBe(expectedVerb);
      expect(action.inspect).toEqual({ kind: 'navigate', deploymentRef: inp.deploymentRef });
      if (action.mutating) expect(action.mutating.t3).toBe(t3);
    }
  });

  it('waiting-confirmation exposes Confirm alone — never Abort, never Decline', () => {
    const action = resolveDeploymentAction(input({ state: 'waiting-confirmation' }));
    expect(action.mutating?.verb).toBe('confirm');
    expect(action.mutating?.verb).not.toBe('abort');
  });

  it('a non-empty blocking PTY set wins in any STORED pre-swap state', () => {
    const action = resolveDeploymentAction(input({
      state: 'parked', blockingPtyIds: ['pty-00000000000000000000000000000000'],
    }));
    expect(action.mutating?.verb).toBe('close-ptys-and-continue');
    expect(action.mutating?.t3).toBe(true);
  });

  it('deploy-ready never renders close-ptys-and-continue [P5-C59]', () => {
    const action = resolveDeploymentAction(input({
      state: 'deploy-ready', breaking: false, blockingPtyIds: ['pty-00000000000000000000000000000000'],
    }));
    expect(action.mutating?.verb).toBe('deploy');
  });
});

describe('asset-pull intent (movement:256, §3.2)', () => {
  it('caps attempts at 32 and computes the pinned item id + idempotency key', () => {
    expect(ASSET_PULL_MAX_ATTEMPTS).toBe(32);
    expect(assetPullItemId(vectors.constants['intentRef']!)).toBe(vectors.constants['assetPullItemId']);
    expect(assetPullIdempotencyKey('assetpull-x', 'digest')).toBe('pull-assets:assetpull-x:digest');
  });

  for (const vector of vectors.assetPullIntents.valid) {
    it(`decodes ${vector.name}`, () => {
      expect(decodeAssetPullIntent(vector.value)).toEqual(vector.value);
    });
  }
  for (const vector of vectors.assetPullIntents.invalid) {
    it(`refuses ${vector.name}`, () => {
      expect(() => decodeAssetPullIntent(vector.value)).toThrow(ContractDecodeError);
    });
  }

  it('maps state to a single action', () => {
    expect(resolveAssetPullAction('i', 'pending').mutating?.verb).toBe('pull');
    expect(resolveAssetPullAction('i', 'failed').mutating?.verb).toBe('retry');
    expect(resolveAssetPullAction('i', 'offline').mutating?.verb).toBe('retry');
    expect(resolveAssetPullAction('i', 'in-flight').mutating).toBeNull();
    expect(resolveAssetPullAction('i', 'succeeded').mutating).toBeNull();
  });
});

describe('quiescence action payload (§3.7)', () => {
  for (const vector of vectors.quiescence.valid) {
    it(`decodes ${vector.name} and pins the sorted-id digest`, () => {
      const payload = decodeQuiescenceActionPayload(vector.value);
      expect(payload).toEqual(vector.value);
      expect(quiescenceDigest(payload.sessionIds)).toBe(vector.digest);
    });
  }
  for (const vector of vectors.quiescence.invalid) {
    it(`refuses ${vector.name}`, () => {
      expect(() => decodeQuiescenceActionPayload(vector.value)).toThrow(ContractDecodeError);
    });
  }
});

describe('compile negatives (verified by tsc --noEmit)', () => {
  const ctrl: DeploymentMutatingControl = { verb: 'confirm', t3: true, endpoint: '/x' };

  it('a deployment action cannot expose two mutating controls', () => {
    const action: DeploymentAction = {
      // @ts-expect-error - `mutating` is exactly ONE control or null; two cannot be assigned.
      mutating: [ctrl, ctrl],
      inspect: { kind: 'navigate', deploymentRef: 'deploy-ready:aa' },
    };
    expect(Array.isArray(action.mutating)).toBe(true);
  });

  it('resolveDeploymentAction rejects an unmapped deployment state', () => {
    expect(() => resolveDeploymentAction({
      // @ts-expect-error - 'banana' is not a DeploymentItemState.
      state: 'banana',
      deploymentRef: 'deploy-ready:aa', blockingPtyIds: [], abortRequestedAt: null, breaking: false,
    })).toThrow(ContractDecodeError);
  });
});
