import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ApprovedAttemptDeclaration,
  AssignmentDeclaration,
  AttemptBindingPort,
  AttemptLaunch,
  AttemptExecutionPort,
  AttemptOperationRecord,
  AttemptOperationStatus,
  BrowserController,
  BrowserPrincipal,
  IterationDeclaration,
  LaunchRecipe,
  HostLaunch,
  ObservedExit,
  SessionHost,
  SessionHostRequest,
  SessionRecordProvenance,
  SessionRecordState,
} from './contracts.ts';
import type {
  BrokerClientFrame,
  BrokerServerFrame,
  BrowserClientFrame,
  BrowserServerFrame,
} from '../../shared/ptyProtocol.ts';
import {
  invalidLaunchRecipeVectors,
  invalidPtyProtocolVectors,
  validBrokerClientFrames,
  validBrokerServerFrames,
  validBrowserClientFrames,
  validBrowserServerFrames,
  validLaunchRecipeVectors,
} from '../../shared/ptyProtocolVectors.ts';

describe('P3 closed contracts', () => {
  it('keeps the four wire protocols as closed discriminated unions', () => {
    expectTypeOf<BrowserClientFrame['type']>().toEqualTypeOf<
      'create' | 'attach' | 'input' | 'resize' | 'close' | 'detach'
    >();
    expectTypeOf<BrowserServerFrame['type']>().toEqualTypeOf<
      'session' | 'created' | 'attached' | 'data' | 'exit' | 'ack' | 'error'
    >();
    expectTypeOf<BrokerClientFrame['type']>().toEqualTypeOf<
      'hello' | 'create' | 'attach' | 'input' | 'resize' | 'close' | 'launchers'
    >();
    expectTypeOf<BrokerServerFrame['type']>().toEqualTypeOf<
      'ready' | 'ack' | 'error' | 'data' | 'exit' | 'launchers'
    >();
  });

  it('keeps declaration halves and controller/state records discriminated', () => {
    expectTypeOf<AssignmentDeclaration>().toMatchTypeOf<
      { assignment?: never; instructionMarkdown?: never }
      | { assignment: unknown; instructionMarkdown: string }
    >();
    expectTypeOf<IterationDeclaration>().toMatchTypeOf<
      { iterationContract?: never; expectsIterationOutcome?: false }
      | { iterationContract: unknown; expectsIterationOutcome: true }
    >();
    expectTypeOf<Extract<SessionRecordProvenance, { provenance: 'manual' }>['controller']>()
      .toEqualTypeOf<BrowserController>();
    expectTypeOf<Extract<SessionRecordState, { state: 'exited' }>['exit']>()
      .toEqualTypeOf<ObservedExit>();
  });

  it('makes host creation and attempt begin synchronous launch-returning ports', () => {
    expectTypeOf<ReturnType<SessionHost['create']>>().toEqualTypeOf<HostLaunch>();
    expectTypeOf<ReturnType<AttemptExecutionPort['begin']>>().toEqualTypeOf<AttemptLaunch>();
  });

  it('keeps the durable attempt-operation record closed and its port async (2026-08-23)', () => {
    expectTypeOf<AttemptOperationStatus>().toEqualTypeOf<
      'pending' | 'bound' | 'cancelled' | 'failed' | 'completed'
    >();
    expectTypeOf<ReturnType<AttemptBindingPort['readOperation']>>()
      .toEqualTypeOf<Promise<AttemptOperationRecord | null>>();
    expectTypeOf<Parameters<AttemptBindingPort['writeOperation']>[1]>()
      .toEqualTypeOf<number | null>();
    expectTypeOf<SessionHostRequest['principal']>().toEqualTypeOf<BrowserPrincipal>();
  });

  it('publishes every wire branch and the recipe/refusal matrices', () => {
    expect(validBrowserClientFrames).toHaveLength(8);
    expect(validBrowserServerFrames).toHaveLength(10);
    expect(validBrokerClientFrames).toHaveLength(7);
    expect(validBrokerServerFrames).toHaveLength(12);
    expect(validLaunchRecipeVectors).toHaveLength(7);
    expect(invalidLaunchRecipeVectors).toHaveLength(9);
    expect(invalidPtyProtocolVectors).toHaveLength(29);
  });
});

const assignment = {} as Extract<AssignmentDeclaration, { assignment: unknown }>['assignment'];
const iterationContract = {} as Extract<IterationDeclaration, { iterationContract: unknown }>['iterationContract'];
const attempt = {} as ApprovedAttemptDeclaration;
const observedExit: ObservedExit = {
  sessionId: 'pty-0123456789abcdef0123456789abcdef',
  sequence: 1,
  exitCode: null,
  signal: null,
  reason: 'closed',
  observedAt: '2026-08-22T00:00:00.000Z',
};

// Declaration negatives.
// @ts-expect-error assignment requires instructionMarkdown
const badAssignmentMissingInstruction: AssignmentDeclaration = { assignment };
// @ts-expect-error instructionMarkdown requires assignment
const badInstructionMissingAssignment: AssignmentDeclaration = { instructionMarkdown: 'x' };
// @ts-expect-error iterationContract requires expectsIterationOutcome true
const badIterationFlag: IterationDeclaration = { iterationContract, expectsIterationOutcome: false };
// @ts-expect-error expectsIterationOutcome true requires iterationContract
const badIterationMissingContract: IterationDeclaration = { expectsIterationOutcome: true };
// @ts-expect-error attempts always use the worktrees root
const badAttemptRoot: ApprovedAttemptDeclaration = { ...attempt, rootId: 'repo' };

// Controller/provenance negatives.
// @ts-expect-error a manual record controller cannot be null
const badManualNull: SessionRecordProvenance = { provenance: 'manual', controller: null };
// @ts-expect-error a manual record cannot carry Run refs
const badManualRunRefs: SessionRecordProvenance = { provenance: 'manual', controller: { operator: 'o', browserSessionRef: 'b' }, runRef: 'run-x' };
// @ts-expect-error an unclaimed Run record cannot carry claimRevision
const badUnclaimedRevision: SessionRecordProvenance = {
  provenance: 'run', controller: null, claimRevision: 1, operator: 'o', runRef: 'run-x',
  attemptRef: 'attempt-x', managedSessionRef: 'managed-x',
};
// @ts-expect-error a claimed Run record requires claimRevision
const badClaimedWithoutRevision: SessionRecordProvenance = {
  provenance: 'run', controller: { operator: 'o', browserSessionRef: 'b' }, operator: 'o',
  runRef: 'run-x', attemptRef: 'attempt-x', managedSessionRef: 'managed-x',
};

// State negatives.
// @ts-expect-error starting records cannot have an exit
const badStartingExit: SessionRecordState = { state: 'starting', epochId: 'epoch-x', exit: observedExit };
// @ts-expect-error live records cannot have an exit
const badLiveExit: SessionRecordState = { state: 'live', epochId: 'epoch-x', exit: observedExit };
// @ts-expect-error closing records cannot have an exit
const badClosingExit: SessionRecordState = { state: 'closing', epochId: 'epoch-x', exit: observedExit };
// @ts-expect-error exited records require an exit
const badExitedNull: SessionRecordState = { state: 'exited', epochId: 'epoch-x', exit: null };
// @ts-expect-error abandoned records require an abandoned exit reason
const badAbandonedExitReason: SessionRecordState = {
  state: 'abandoned', epochId: 'epoch-x', exit: observedExit, abandonReason: 'epoch-lost',
};
// @ts-expect-error abandoned records require abandonReason
const badAbandonedMissingReason: SessionRecordState = {
  state: 'abandoned', epochId: 'epoch-x', exit: { ...observedExit, reason: 'abandoned' },
};

// Host-request principal negatives (2026-08-23 ruling).
const hostRequest = {} as SessionHostRequest;
// @ts-expect-error every host create must name its principal
const badRequestMissingPrincipal: SessionHostRequest = {
  operationKey: 'op-x', recipe: {} as LaunchRecipe, rootId: 'worktrees',
  relativeCwd: '', cols: 80, rows: 24,
};
// @ts-expect-error the principal is exactly {operator,browserSessionRef}
const badPrincipalExtraKey: SessionHostRequest = { ...hostRequest, principal: { operator: 'o', browserSessionRef: 'b', runRef: 'run-x' } };

// Durable attempt-operation negatives (2026-08-23 ruling).
const operationRecord: AttemptOperationRecord = {
  operationKey: 'op-x', requestHash: 'a'.repeat(64), status: 'pending', promptsDelivered: 0,
  sessionId: null, attemptRef: null, receipt: null, revision: 0,
  updatedAt: '2026-08-23T00:00:00.000Z',
};
// @ts-expect-error the operation status union is closed
const badOperationStatus: AttemptOperationRecord = { ...operationRecord, status: 'archived' };
// @ts-expect-error the CAS revision is required on every record
const badOperationMissingRevision: AttemptOperationRecord = {
  operationKey: 'op-x', requestHash: 'a'.repeat(64), status: 'pending', promptsDelivered: 0,
  sessionId: null, attemptRef: null, receipt: null, updatedAt: '2026-08-23T00:00:00.000Z',
};
// @ts-expect-error writeOperation is async-only, never a synchronous CAS
const badSyncWriteOperation: AttemptBindingPort['writeOperation'] = () => ({ ok: true, value: operationRecord });
// @ts-expect-error expectedRevision is a number or null, never a string
const badExpectedRevisionType: Parameters<AttemptBindingPort['writeOperation']>[1] = '1';
// @ts-expect-error byRun lists every binding for the run; it is never a single-binding lookup
const badByRunSingle: AttemptBindingPort['byRun'] = () => null;
// @ts-expect-error byRun is a synchronous document read, never a promise
const badByRunAsync: AttemptBindingPort['byRun'] = async () => [];

// Async-port negatives.
// @ts-expect-error create returns HostLaunch directly, never Promise<HostLaunch>
const badAsyncCreate: SessionHost['create'] = async () => ({}) as never;
// @ts-expect-error begin returns AttemptLaunch directly, never Promise<AttemptLaunch>
const badAsyncBegin: AttemptExecutionPort['begin'] = async () => ({}) as never;

// Recipe negatives.
// @ts-expect-error launcher is a closed enum
const badRecipeLauncher: LaunchRecipe = { launcher: 'powershell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' };
// @ts-expect-error mode is a closed enum
const badRecipeMode: LaunchRecipe = { launcher: 'shell', mode: 'batch', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' };
// @ts-expect-error sandbox is a closed enum
const badRecipeSandbox: LaunchRecipe = { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'dangerous' };

type RecipeMatrixRow = typeof validLaunchRecipeVectors[number];
// @ts-expect-error the recipe matrix forbids a model on shell
const badShellModelCombination: RecipeMatrixRow = { launcher: 'shell', mode: 'interactive', model: 'gpt-5.6', toolPolicyId: 'shell-default', sandbox: 'interactive' };
// @ts-expect-error the recipe matrix forbids resume on interactive Claude
const badInteractiveResumeCombination: RecipeMatrixRow = { launcher: 'claude', mode: 'interactive', model: 'claude-sonnet-4-5', toolPolicyId: 'standard', sandbox: 'claude-policy', resumeRef: 'resume-claude-1' };
// @ts-expect-error the recipe matrix pins Claude to claude-policy
const badClaudeSandboxCombination: RecipeMatrixRow = { launcher: 'claude', mode: 'headless-json', model: 'claude-sonnet-4-5', toolPolicyId: 'standard', sandbox: 'codex-workspace-write' };
// @ts-expect-error the recipe matrix pins Codex to codex-workspace-write
const badCodexSandboxCombination: RecipeMatrixRow = { launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6', toolPolicyId: 'standard', sandbox: 'claude-policy' };

void [
  badAssignmentMissingInstruction,
  badInstructionMissingAssignment,
  badIterationFlag,
  badIterationMissingContract,
  badAttemptRoot,
  badManualNull,
  badManualRunRefs,
  badUnclaimedRevision,
  badClaimedWithoutRevision,
  badStartingExit,
  badLiveExit,
  badClosingExit,
  badExitedNull,
  badAbandonedExitReason,
  badAbandonedMissingReason,
  badRequestMissingPrincipal,
  badPrincipalExtraKey,
  badOperationStatus,
  badOperationMissingRevision,
  badSyncWriteOperation,
  badExpectedRevisionType,
  badAsyncCreate,
  badAsyncBegin,
  badRecipeLauncher,
  badRecipeMode,
  badRecipeSandbox,
  badShellModelCombination,
  badInteractiveResumeCombination,
  badClaudeSandboxCombination,
  badCodexSandboxCombination,
];
