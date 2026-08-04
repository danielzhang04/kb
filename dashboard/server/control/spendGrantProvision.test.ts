import { describe, expect, it, vi } from 'vitest';
import type { ProvisionSpendGrantInput } from './execution.ts';
import type { ProposalStage } from './proposal.ts';
import type { HumanRequest } from './types.ts';
import { SpendGrantError } from './spendGrant.ts';
import {
  createSpendGrantProvisioner,
  provisionAttemptSpendGrant,
  type SpendGrantFileContents,
  type SpendGrantMinter,
} from './spendGrantProvision.ts';

const STAGE_REF = 'stage-images-1';

function approvedGateRequest(overrides: Partial<HumanRequest> = {}): HumanRequest {
  return {
    requestRef: 'request-spend-gate',
    runRef: 'run-1',
    stageRef: STAGE_REF,
    kind: 'approval',
    revision: 1,
    state: 'resolved',
    title: 'automatic:gate:images:spend',
    prompt: 'Approve up to $1.40 of image generation.',
    response: {
      requestRevision: 1, decision: 'approved', respondedBy: 'operator',
      idempotencyKey: 'idem-1', response: null, respondedAt: '2026-08-03T12:00:00.000Z',
    },
    createdAt: '2026-08-03T11:00:00.000Z',
    updatedAt: '2026-08-03T12:00:00.000Z',
    ...overrides,
  };
}

function imagesStage(spendGate = true): ProposalStage {
  return {
    id: 'images',
    humanGates: spendGate
      ? [{ id: 'spend', kind: 'approval', prompt: 'Approve spend.', spendAuthorization: true }]
      : [],
  } as unknown as ProposalStage;
}

function input(overrides: Partial<ProvisionSpendGrantInput> = {}): ProvisionSpendGrantInput {
  return {
    subject: 'operator',
    runRef: 'run-1',
    stageRef: STAGE_REF,
    stageId: 'images',
    attemptRef: 'attempt-1',
    worktreePath: '/state/control/worktrees/run-1/attempt-1',
    proposalStage: imagesStage(),
    humanRequests: [approvedGateRequest()],
    ...overrides,
  };
}

function fakeMinter(token = 'raw-token-abc'): SpendGrantMinter & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    async mint(mintInput) {
      calls.push(mintInput as unknown as Record<string, unknown>);
      return { grantRef: 'grant-deadbeefdeadbeefdeadbeefdeadbeef', token };
    },
  };
}

describe('provisionAttemptSpendGrant', () => {
  it('mints and writes the token file for an approved spending stage, deriving the operation server-side', async () => {
    const grantStore = fakeMinter();
    const written: Array<{ path: string; contents: SpendGrantFileContents }> = [];
    const result = await provisionAttemptSpendGrant(input(), {
      grantStore,
      routeUrl: 'http://127.0.0.1:5317/api/control/paid-action',
      ttlMs: 7_200_000,
      writeGrantFile: (path, contents) => written.push({ path, contents }),
    });

    expect(result).toEqual({ provisioned: true, grantRef: 'grant-deadbeefdeadbeefdeadbeefdeadbeef', operation: 'fyt.gemini-3-pro-image-2k' });
    // Operation derived from the stage id, gateRequestRef pulled from the resolved approval — never supplied.
    expect(grantStore.calls[0]).toEqual({
      runRef: 'run-1', stageRef: STAGE_REF, operation: 'fyt.gemini-3-pro-image-2k',
      subject: 'operator', gateRequestRef: 'request-spend-gate', ttlMs: 7_200_000,
    });
    expect(written).toHaveLength(1);
    expect(written[0].path).toBe('/state/control/worktrees/run-1/attempt-1');
    expect(written[0].contents).toEqual({
      token: 'raw-token-abc',
      runRef: 'run-1',
      stageRef: STAGE_REF,
      attemptRef: 'attempt-1',
      operationsAllowed: ['fyt.gemini-3-pro-image-2k'],
      routeUrl: 'http://127.0.0.1:5317/api/control/paid-action',
    });
    // The token file's keys are exactly the capability descriptor — no provider-key field of any kind.
    expect(Object.keys(written[0].contents).sort()).toEqual(
      ['attemptRef', 'operationsAllowed', 'routeUrl', 'runRef', 'stageRef', 'token'],
    );
  });

  it('derives the audio operation from an audio stage id', async () => {
    const grantStore = fakeMinter();
    const result = await provisionAttemptSpendGrant(
      input({
        stageId: 'audio',
        proposalStage: { id: 'audio', humanGates: [{ id: 'spend', kind: 'approval', prompt: 'x', spendAuthorization: true }] } as unknown as ProposalStage,
        humanRequests: [approvedGateRequest({ title: 'automatic:gate:audio:spend' })],
      }),
      { grantStore, routeUrl: 'http://x/api', ttlMs: 60_000, writeGrantFile: () => {} },
    );
    expect(result).toMatchObject({ provisioned: true, operation: 'fyt.elevenlabs.locked-tts' });
    expect(grantStore.calls[0].operation).toBe('fyt.elevenlabs.locked-tts');
  });

  it('is a no-op for a stage that is not a paid stage', async () => {
    const grantStore = fakeMinter();
    const write = vi.fn();
    const result = await provisionAttemptSpendGrant(
      input({ stageId: 'script', proposalStage: { id: 'script', humanGates: [] } as unknown as ProposalStage }),
      { grantStore, routeUrl: 'http://x/api', ttlMs: 60_000, writeGrantFile: write },
    );
    expect(result).toEqual({ provisioned: false, reason: 'not-a-paid-stage' });
    expect(grantStore.calls).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('is a no-op for a paid stage that declares no spend gate', async () => {
    const grantStore = fakeMinter();
    const result = await provisionAttemptSpendGrant(
      input({ proposalStage: imagesStage(false), humanRequests: [] }),
      { grantStore, routeUrl: 'http://x/api', ttlMs: 60_000, writeGrantFile: () => {} },
    );
    expect(result).toEqual({ provisioned: false, reason: 'no-spend-gate' });
    expect(grantStore.calls).toHaveLength(0);
  });

  it('refuses to mint when the declared spend gate is not recorded approved', async () => {
    const grantStore = fakeMinter();
    const write = vi.fn();
    for (const request of [
      approvedGateRequest({ state: 'open', response: null }),
      approvedGateRequest({ response: { requestRevision: 1, decision: 'rejected', respondedBy: 'operator', idempotencyKey: 'i', response: null, respondedAt: '2026-08-03T12:00:00.000Z' } }),
      approvedGateRequest({ title: 'automatic:gate:images:other' }), // wrong title => no match
      approvedGateRequest({ stageRef: 'stage-other' }), // wrong stage => no match
    ]) {
      const result = await provisionAttemptSpendGrant(input({ humanRequests: [request] }), {
        grantStore, routeUrl: 'http://x/api', ttlMs: 60_000, writeGrantFile: write,
      });
      expect(result).toEqual({ provisioned: false, reason: 'spend-authorization-not-approved' });
    }
    expect(grantStore.calls).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('treats a second live mint (grant-already-live) as already-provisioned and never writes a stale token', async () => {
    const write = vi.fn();
    const grantStore: SpendGrantMinter = {
      async mint() { throw new SpendGrantError('grant-already-live', 'exists', 'grant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); },
    };
    const result = await provisionAttemptSpendGrant(input(), { grantStore, routeUrl: 'http://x/api', ttlMs: 60_000, writeGrantFile: write });
    expect(result).toEqual({ provisioned: false, reason: 'already-live', grantRef: 'grant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(write).not.toHaveBeenCalled();
  });

  it('propagates an unexpected mint failure rather than swallowing it', async () => {
    const grantStore: SpendGrantMinter = {
      async mint() { throw new SpendGrantError('journal-unavailable', 'io'); },
    };
    await expect(provisionAttemptSpendGrant(input(), { grantStore, routeUrl: 'http://x/api', ttlMs: 60_000, writeGrantFile: () => {} }))
      .rejects.toBeInstanceOf(SpendGrantError);
  });
});

describe('createSpendGrantProvisioner (engine hook adapter)', () => {
  it('resolves silently on the happy path and on non-spending stages', async () => {
    const hook = createSpendGrantProvisioner({ grantStore: fakeMinter(), routeUrl: 'http://x/api', ttlMs: 60_000, writeGrantFile: () => {} });
    await expect(hook(input())).resolves.toBeUndefined();
    await expect(hook(input({ stageId: 'script', proposalStage: { id: 'script', humanGates: [] } as unknown as ProposalStage }))).resolves.toBeUndefined();
  });

  it('throws when a paid stage reaches launch without a recorded spend approval', async () => {
    const hook = createSpendGrantProvisioner({ grantStore: fakeMinter(), routeUrl: 'http://x/api', ttlMs: 60_000, writeGrantFile: () => {} });
    await expect(hook(input({ humanRequests: [] }))).rejects.toThrow(/without a recorded spend-gate approval/);
  });
});
