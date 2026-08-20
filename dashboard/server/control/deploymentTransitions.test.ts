import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryControlPlaneStore, type ControlPlaneStore } from './store.ts';
import { createExistingRootFileStoreHarnessForTest } from './test-fixtures/controlStore.ts';
import {
  DEPLOYMENT_STATES,
  canTransitionDeployment,
  type DeploymentState,
  validateCreateDeploymentInput,
  validateDeploymentTransitionPatch,
} from './deploymentState.ts';
import type { Deployment, DeploymentTransitionPatch } from './types.ts';

const create = {
  deploymentRef: 'deploy-1', initialState: 'waiting-confirmation',
  targetCommit: 'b'.repeat(40), previousCommit: 'a'.repeat(40),
  requestedAt: '2026-08-20T00:00:00.000Z', parkWarnAt: '2026-08-20T00:35:00.000Z',
  idempotencyKey: 'create-1',
} as const;
const roots: string[] = [];
const TERMINAL_AT = '2026-08-20T01:00:00.000Z';
const fileStores = createExistingRootFileStoreHarnessForTest();
const createFileControlPlaneStore = fileStores.open;

afterEach(() => {
  fileStores.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fileStore() {
  const root = mkdtempSync(join(tmpdir(), 'deployment-file-store-'));
  roots.push(root);
  return { root, path: join(root, 'control', 'control-plane.json'), store: createFileControlPlaneStore(root) };
}

function outcomePatch(state: 'succeeded' | 'aborted' | 'failed'): DeploymentTransitionPatch {
  return { terminalOutcome: { kind: state, at: TERMINAL_AT, by: 'operator' } };
}

function createStoreAndDeployment() {
  const store = createInMemoryControlPlaneStore();
  const result = store.createDeployment('operator', create);
  if (!result.ok) throw new Error(result.detail);
  return { store, made: result.value };
}

function transition(
  store: ControlPlaneStore,
  made: Deployment,
  nextState: DeploymentState,
  key: string,
  patch: DeploymentTransitionPatch = {},
) {
  const result = store.transitionDeployment('operator', made.deploymentRef, {
    expectedRevision: made.revision,
    expectedState: made.state,
    nextState,
    idempotencyKey: key,
    patch,
  });
  if (!result.ok) throw new Error(result.detail);
  return result;
}

function createTerminalDeployment(state: 'succeeded' | 'aborted' | 'failed') {
  const { store, made } = createStoreAndDeployment();
  let current = made;
  const move = (nextState: DeploymentState): void => {
    const patch = ['succeeded', 'aborted', 'failed'].includes(nextState)
      ? outcomePatch(nextState as 'succeeded' | 'aborted' | 'failed')
      : {};
    current = transition(store, current, nextState, `${current.state}-${nextState}`, patch).value;
  };
  if (state === 'succeeded') {
    for (const next of ['requested', 'parked', 'swapping', 'resuming', 'succeeded'] as const) move(next);
  } else if (state === 'aborted') {
    move('aborted');
  } else {
    move('requested');
    move('failed');
  }
  return { store, terminal: current };
}

function seedRunWithAttemptAndSession(store: ControlPlaneStore): { runRef: string } {
  const proposal = store.createProposalRevision('operator', {
    sourceComposerRef: 'composer-deployment-inventory',
    sourceTurnId: 'turn-deployment-inventory',
    title: 'Deployment inventory run',
    snapshot: {
      schema: 'kb.plan-proposal/v1',
      title: 'Deployment inventory run',
      manager: {},
      stages: [{ id: 'build', title: 'Build', dependsOn: [] }],
    },
  });
  if (!proposal.ok) throw new Error(proposal.detail);
  const approved = store.decideProposal('operator', proposal.value.proposalRef, proposal.value.revision, {
    expectedHash: proposal.value.hash,
    expectedApprovalRevision: 0,
    decision: 'approved',
    idempotencyKey: 'approve-deployment-inventory',
  });
  if (!approved.ok) throw new Error(approved.detail);
  const run = store.createRun('operator', {
    title: 'Deployment inventory run',
    proposalRef: approved.value.proposalRef,
    proposalRevision: approved.value.revision,
    expectedProposalHash: approved.value.hash,
    managerRuntime: 'claude',
    managerModel: 'claude-sonnet-5',
    idempotencyKey: 'launch-deployment-inventory',
    stages: [{ stageId: 'build', title: 'Build', dependsOn: [] }],
  });
  if (!run.ok) throw new Error(run.detail);
  const stage = run.value.stages[0];
  if (!stage) throw new Error('deployment inventory stage was not created');
  const attempt = store.createAttempt('operator', stage.stageRef, {
    expectedStageVersion: stage.version,
    runtime: 'codex',
    model: 'gpt-5.6-terra',
  });
  if (!attempt.ok) throw new Error(attempt.detail);
  const session = store.createWorkerSession('operator', attempt.value.attemptRef, {
    expectedAttemptVersion: attempt.value.version,
  });
  if (!session.ok) throw new Error(session.detail);
  return { runRef: run.value.run.runRef };
}

describe('Deployment CAS', () => {
  it('accepts only the exhaustive transition graph', () => {
    const allowed = new Set([
      'waiting-confirmation>requested', 'waiting-confirmation>aborted',
      'requested>parked', 'requested>aborted', 'requested>failed',
      'parked>swapping', 'parked>aborted', 'parked>failed',
      'swapping>resuming', 'swapping>aborted', 'swapping>failed',
      'resuming>succeeded', 'resuming>aborted', 'resuming>failed',
      'succeeded>acknowledged', 'aborted>acknowledged', 'failed>acknowledged',
    ]);
    for (const from of DEPLOYMENT_STATES) for (const to of DEPLOYMENT_STATES) {
      expect(canTransitionDeployment(from, to)).toBe(allowed.has(`${from}>${to}`));
    }
  });

  it('commits transition and receipt once, then replays exactly', () => {
    const store = createInMemoryControlPlaneStore();
    const made = store.createDeployment('operator', create);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const input = { expectedRevision: made.value.revision, expectedState: 'waiting-confirmation',
      nextState: 'requested', idempotencyKey: 'request-1', patch: {} } as const;
    const first = store.transitionDeployment('operator', 'deploy-1', input);
    const replay = store.transitionDeployment('operator', 'deploy-1', input);
    expect(first).toMatchObject({ ok: true, replayed: undefined });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(store.getControlDocumentMetadata().documentRevision).toBe(2);
  });

  it('replays createDeployment exactly without a second commit', () => {
    const store = createInMemoryControlPlaneStore();
    const first = store.createDeployment('operator', create);
    const replay = store.createDeployment('operator', create);
    expect(first).toMatchObject({ ok: true });
    expect(first).not.toHaveProperty('replayed');
    expect(replay).toMatchObject({ ok: true, replayed: true, value: first.ok ? first.value : undefined });
    expect(store.getControlDocumentMetadata().documentRevision).toBe(1);
  });

  it('rejects stale revision and state without committing', () => {
    const {store, made} = createStoreAndDeployment();
    const before = store.getControlDocumentMetadata().documentRevision;
    expect(store.transitionDeployment('operator', made.deploymentRef, {
      expectedRevision: 0, expectedState: 'waiting-confirmation', nextState: 'requested',
      idempotencyKey: 'stale', patch: {},
    })).toMatchObject({ok:false, reason:'conflict'});
    expect(store.getControlDocumentMetadata().documentRevision).toBe(before);
  });
  it('rejects reuse of an idempotency key with different input', () => {
    const {store, made} = createStoreAndDeployment();
    const first = transition(store, made, 'requested', 'same-key');
    expect(first.ok).toBe(true);
    expect(store.transitionDeployment('operator', made.deploymentRef, {
      expectedRevision: made.revision, expectedState: made.state, nextState: 'aborted',
      idempotencyKey: 'same-key', patch: outcomePatch('aborted'),
    })).toMatchObject({ok:false, reason:'idempotency-conflict'});
  });
  it('refuses a second nonterminal deployment', () => {
    const {store} = createStoreAndDeployment();
    expect(store.createDeployment('operator', {...create, deploymentRef:'deploy-2',
      idempotencyKey:'create-2'})).toMatchObject({ok:false, reason:'conflict'});
  });
  it.each(['succeeded', 'aborted', 'failed'] as const)('requires terminalOutcome when entering %s', (state) => {
    expect(validateDeploymentTransitionPatch(state, {})).toBe(false);
    expect(validateDeploymentTransitionPatch(state, outcomePatch(state))).toBe(true);
  });
  it('requires acknowledgedBy when entering acknowledged', () => {
    expect(validateDeploymentTransitionPatch('acknowledged', {})).toBe(false);
  });
  it.each(['succeeded','aborted','failed'] as const)('allows %s to be acknowledged once', (state) => {
    const {store, terminal} = createTerminalDeployment(state);
    const result = transition(store, terminal, 'acknowledged', `ack-${state}`, {
      acknowledgedBy:{subject:'operator',at:'2026-08-20T01:00:00.000Z'},
    });
    expect(result).toMatchObject({ok:true, value:{state:'acknowledged'}});
  });
  it('does not alter attempt session or accounting inventory', () => {
    const store = createInMemoryControlPlaneStore();
    const seeded = seedRunWithAttemptAndSession(store);
    const before = store.getRun('operator', seeded.runRef);
    if (!before.ok) throw new Error(before.detail);
    expect(store.createDeployment('operator', create).ok).toBe(true);
    const after = store.getRun('operator', seeded.runRef);
    if (!after.ok) throw new Error(after.detail);
    expect(after.value.attempts).toEqual(before.value.attempts);
    expect(after.value.sessions).toEqual(before.value.sessions);
  });
});

describe('Deployment input validation', () => {
  it.each([
    ['equal SHAs', { previousCommit: create.targetCommit }],
    ['non-canonical target SHA', { targetCommit: 'B'.repeat(40) }],
    ['non-canonical requestedAt', { requestedAt: '2026-08-20T00:00:00Z' }],
    ['non-canonical parkWarnAt', { parkWarnAt: '2026-08-20T00:35:00Z' }],
    ['parkWarnAt equal to requestedAt', { parkWarnAt: create.requestedAt }],
    ['parkWarnAt before requestedAt', { parkWarnAt: '2026-08-19T23:59:59.000Z' }],
    ['bad initial state', { initialState: 'parked' }],
  ])('rejects create input with %s', (_name, change) => {
    expect(validateCreateDeploymentInput({ ...create, ...change })).toBe(false);
  });

  it.each([
    ['waiting-confirmation', { blockers: [] }],
    ['requested', { error: null }],
    ['parked', { swapDeadlineAt: null }],
    ['swapping', { abortRequestedAt: null }],
    ['resuming', { swapDeadlineAt: null }],
    ['succeeded', { error: null }],
    ['aborted', { progress: { kind: 'idle', attemptRef: null, since: null, detail: null } }],
    ['failed', { progress: { kind: 'idle', attemptRef: null, since: null, detail: null } }],
    ['acknowledged', { progress: { kind: 'idle', attemptRef: null, since: null, detail: null } }],
  ] as const)('rejects an illegal patch field for %s', (state, patch) => {
    expect(validateDeploymentTransitionPatch(state, patch)).toBe(false);
  });
});

describe('Deployment file-store hydration invariants', () => {
  function seedTwoDeployments() {
    const seeded = fileStore();
    const first = seeded.store.createDeployment('operator', create);
    if (!first.ok) throw new Error(first.detail);
    const terminal = transition(seeded.store, first.value, 'aborted', 'abort-first', outcomePatch('aborted'));
    const second = seeded.store.createDeployment('operator', {
      ...create, deploymentRef: 'deploy-2', idempotencyKey: 'create-2',
    });
    if (!second.ok) throw new Error(second.detail);
    return { ...seeded, terminal: terminal.value, second: second.value };
  }

  it('rejects two stored nonterminal deployments through file hydration', () => {
    const { root, path } = seedTwoDeployments();
    const document = JSON.parse(readFileSync(path, 'utf8')) as any;
    document.deployments[0].state = 'waiting-confirmation';
    document.deployments[0].terminalOutcome = null;
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root)).toThrow(/active deployments/);
  });

  it('rejects duplicate stored receipt keys through file hydration', () => {
    const { root, path } = seedTwoDeployments();
    const document = JSON.parse(readFileSync(path, 'utf8')) as any;
    document.deployments[1].operationReceipts[0].key = document.deployments[0].operationReceipts[0].key;
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root)).toThrow(/deployment receipt/);
  });

  it('rejects an inexact stored deployment shape through file hydration', () => {
    const { root, path } = fileStore();
    const store = createFileControlPlaneStore(root);
    expect(store.createDeployment('operator', create).ok).toBe(true);
    const document = JSON.parse(readFileSync(path, 'utf8')) as any;
    document.deployments[0].unexpected = true;
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root)).toThrow(/invalid control-plane deployment/);
  });

  it('rejects terminal stored states without durable outcome and acknowledgement data', () => {
    const { root, path } = seedTwoDeployments();
    const document = JSON.parse(readFileSync(path, 'utf8')) as any;
    document.deployments[0].terminalOutcome = null;
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root)).toThrow(/invalid control-plane deployment/);

    document.deployments[0].state = 'acknowledged';
    document.deployments[0].terminalOutcome = {
      kind: 'aborted', at: TERMINAL_AT, by: 'operator',
    };
    document.deployments[0].acknowledgedBy = null;
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root)).toThrow(/invalid control-plane deployment/);
  });

  it('evicts only transition receipts and keeps create replay pinned at the 64-receipt cap', () => {
    const { root, path, store } = fileStore();
    const made = store.createDeployment('operator', create);
    if (!made.ok) throw new Error(made.detail);
    const document = JSON.parse(readFileSync(path, 'utf8')) as any;
    const deployment = document.deployments[0];
    const publicResult = structuredClone(deployment);
    delete publicResult.operationReceipts;
    deployment.state = 'resuming';
    deployment.revision = 64;
    for (let index = 1; index <= 63; index += 1) {
      deployment.operationReceipts.push({
        key: `transition-${index}`,
        fingerprint: index.toString(16).padStart(64, '0'),
        operation: 'transition',
        deploymentRevision: index + 1,
        result: { ...publicResult, revision: index + 1 },
        recordedAt: TERMINAL_AT,
      });
    }
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    const reopened = createFileControlPlaneStore(root);
    const completed = reopened.transitionDeployment('operator', create.deploymentRef, {
      expectedRevision: 64,
      expectedState: 'resuming',
      nextState: 'succeeded',
      idempotencyKey: 'transition-64',
      patch: outcomePatch('succeeded'),
    });
    expect(completed.ok).toBe(true);
    expect(reopened.createDeployment('operator', create)).toMatchObject({ ok: true, replayed: true });
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as any;
    expect(persisted.deployments[0].operationReceipts).toHaveLength(64);
    expect(persisted.deployments[0].operationReceipts.some((receipt: any) => receipt.operation === 'create')).toBe(true);
    expect(persisted.deployments[0].operationReceipts.some((receipt: any) => receipt.key === 'transition-1')).toBe(false);
  });
});
