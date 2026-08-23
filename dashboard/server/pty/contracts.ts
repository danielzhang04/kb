// P3 §3 closed contracts. Amendments ruled by P3 re-review, 2026-08-23:
//   1. `SessionHostRequest.principal` (BrowserPrincipal) is REQUIRED — every host create names the
//      operator and browser session it is charged to; controller-null Run sessions use the owning
//      operator with `RUN_CONTROLLER_NULL_BROWSER_SESSION_REF`.
//   2. Durable attempt-operation state: `AttemptOperationStatus`, `AttemptOperationRecord`,
//      `AttemptBindingPort.readOperation`/`writeOperation` (CAS), and
//      `PtySessionsDocumentV2.attemptOperations`. Internal only — no wire vector or manifest changes.
import type { IterationOutcomeContract } from '../control/iterationOutcome.ts';
import type { ExecutionProfile } from '../control/policy.ts';
import type { ProposalStage, ResolvedAgentAssignment } from '../control/proposal.ts';
import type { WorkerExecutionResult } from '../control/execution.ts';
import type { SessionRunRecord } from './sessionRuns.ts';
import type {
  HostRefusalCode,
  LaunchRecipe,
  SafeRootId,
  SessionHostKind,
  SessionLauncher,
  SessionSize,
  SessionSummary,
} from '../../shared/ptyProtocol.ts';

export type {
  AttemptSessionPublicRow,
  BrokerClientFrame,
  BrokerServerFrame,
  BrowserClientFrame,
  BrowserServerFrame,
  HostRefusalCode,
  LaunchRecipe,
  PublicExit,
  PublicPtyCapability,
  PtyProbeReason,
  RecipeSandbox,
  SafeRootId,
  SessionHostKind,
  SessionLauncher,
  SessionMode,
  SessionSize,
  SessionState,
  SessionSummary,
} from '../../shared/ptyProtocol.ts';

export type PortResult<T> = { ok: true; value: T }
  | { ok: false; refusal: HostRefusalCode; detail: string | null };
export type ObservedExit = { sessionId: string; sequence: number; exitCode: number | null;
  signal: number | null; reason: 'exited' | 'closed' | 'abandoned'; observedAt: string };
/** A host output frame. As a HOST frame `sequence` is that host's own frame counter; the registry
 *  re-mints it into the [C-R6] cursor space before any sink sees it, so every frame that leaves
 *  `createSessionRecordRegistry` carries the BYTE OFFSET of its first byte in the session's output
 *  stream. Sinks, the retention writer, and the browser all read it that way. */
export type SessionDataFrame = { sessionId: string; sequence: number; encoding: 'base64';
  data: string; replay: boolean };
export type SessionSink = { data(frame: SessionDataFrame): void; exit(exit: ObservedExit): void;
  closed(): boolean };
export type PtyCapabilityProbe =
  | { available: true; host: SessionHostKind; transport: 'local-node-pty' | 'unix-broker';
      launchers: SessionLauncher[]; roots: SafeRootId[]; epochId: string; checkedAt: string }
  | { available: false; host: SessionHostKind; transport: 'local-node-pty' | 'unix-broker';
      reason: import('../../shared/ptyProtocol.ts').PtyProbeReason; detail: string | null; checkedAt: string };
export type BrowserPrincipal = { operator: string; browserSessionRef: string };
export type BrowserController = BrowserPrincipal;
export type ApprovedManualCreate = { launcher: SessionLauncher; rootId: SafeRootId;
  relativeCwd: string; cols: number; rows: number };
export type AssignmentDeclaration =
  | { assignment?: never; instructionMarkdown?: never }
  | { assignment: ResolvedAgentAssignment; instructionMarkdown: string };
export type IterationDeclaration =
  | { iterationContract?: never; expectsIterationOutcome?: false }
  | { iterationContract: IterationOutcomeContract; expectsIterationOutcome: true };
export type ApprovedAttemptDeclaration = AssignmentDeclaration & IterationDeclaration & {
  operationKey: string; subject: string; runRef: string; stageRef: string; attemptRef: string;
  sessionRef: string; rootId: 'worktrees'; relativeCwd: string; cols: number; rows: number;
  profile: ExecutionProfile & { runtime: 'claude' | 'codex' }; workflowProfile: string | null;
  skills: readonly string[]; action: string; target: string; workOrder: string;
  readScope: readonly string[]; writeScope: readonly string[]; checkpoints: readonly string[];
  proposalStage: ProposalStage; project: string;
};
export type AttemptParserContext = {
  runtime: 'claude' | 'codex'; stdout: string; stderrTail: string; exitCode: number | null;
  timedOut: boolean; outputLimitExceeded: boolean; cancelled: boolean; resultObserved: boolean;
  iterationContract?: IterationOutcomeContract;
};
export type ParsedAttemptResult = { result: WorkerExecutionResult; resumeRef: string | null };
export type ApprovedRunInstruction = { operator: string; runRef: string; idempotencyKey: string;
  message: string };
export type ApprovedCheckpointInstruction = ApprovedRunInstruction & { checkpoint: string };
export type AttemptBinding = { operator: string; runRef: string; attemptRef: string;
  managedSessionRef: string; sessionId: string; createdAt: string };
export type ClaimRunControllerInput = { runRef: string; sessionId: string;
  expectedRunVersion: number; expectedSessionRevision: number };
export type ClaimReceipt = { revision: number; sessionId: string; replayed: boolean };
/** Controller-null Run sessions carry this fixed `browserSessionRef`; it is deliberately outside the
 *  43-char base64url minted-ref grammar so it can never collide with a real browser session. */
export const RUN_CONTROLLER_NULL_BROWSER_SESSION_REF = 'run-controller-null' as const;
export type SessionHostRequest = { operationKey: string; principal: BrowserPrincipal;
  recipe: LaunchRecipe; rootId: SafeRootId;
  relativeCwd: string; cols: number; rows: number };
export type HostStartReceipt = { operationKey: string; sessionId: string; epochId: string;
  revision: number; boundAt: string; replayed: boolean };
export type HostLaunch = { receipt: Promise<PortResult<HostStartReceipt>>; exit: Promise<ObservedExit> };
export type AttemptStartReceipt = { operationKey: string; sessionId: string; attemptRef: string;
  revision: number; boundAt: string; replayed: boolean };
export type AttemptLaunch = { receipt: Promise<PortResult<AttemptStartReceipt>>;
  result: Promise<WorkerExecutionResult> };
export interface SessionHost {
  probe(): Promise<PtyCapabilityProbe>;
  create(request: SessionHostRequest, sink: SessionSink): HostLaunch;
  attach(sessionId: string, sink: SessionSink): Promise<PortResult<{ attachmentId: string }>>;
  write(sessionId: string, data: Uint8Array): Promise<PortResult<{ accepted: number }>>;
  resize(sessionId: string, size: SessionSize): Promise<PortResult<SessionSize>>;
  close(sessionId: string): Promise<PortResult<ObservedExit>>;
  listEpoch(): Promise<PortResult<{ epochId: string; sessionIds: string[] }>>;
  drain(epochId: string): Promise<PortResult<{ epochId: string; closed: string[]; alreadyGone: string[] }>>;
}
export interface AttemptBindingPort {
  bind(input: { expectedRevision: number; operator: string; runRef: string; attemptRef: string;
    managedSessionRef: string; sessionId: string }): Promise<PortResult<{ revision: number }>>;
  byAttempt(operator: string, attemptRef: string): AttemptBinding | null;
  bySession(operator: string, sessionId: string): AttemptBinding | null;
  readOperation(operationKey: string): Promise<AttemptOperationRecord | null>;
  /** Write-ahead CAS. `expectedRevision: null` means "must not exist" (create); any revision
   *  mismatch (or a create over an existing key) refuses with `'binding-conflict'`.
   *  CONTRACT — approved prompt delivery is at-most-once, never at-least-once: a prompt whose delivery
   *  was reserved here (`promptsDelivered` incremented) is never re-sent, so a crash between the
   *  reservation and the write LOSES that prompt, and the attempt timer surfaces the stranded session as
   *  `failed`. Lost beats duplicate: a re-sent work order re-executes a stage whose side effects are
   *  already committed. */
  writeOperation(record: AttemptOperationRecord,
    expectedRevision: number | null): Promise<PortResult<AttemptOperationRecord>>;
}
export interface AttemptExecutionPort {
  begin(input: ApprovedAttemptDeclaration): AttemptLaunch;
  cancel(input: { operationKey: string; reason: string }): Promise<PortResult<ObservedExit>>;
  isRunLive(input: { operator: string; runRef: string }): boolean;
  queueRunInstruction(input: ApprovedRunInstruction): Promise<boolean>;
  queueRunInstructionAtCheckpoint(input: ApprovedCheckpointInstruction): Promise<boolean>;
  drain(): Promise<void>;
}
export interface SessionRegistryPort {
  create(principal: BrowserPrincipal, input: ApprovedManualCreate): Promise<PortResult<SessionSummary>>;
  attach(principal: BrowserPrincipal, sessionId: string, sink: SessionSink): Promise<PortResult<Attachment>>;
  list(principal: BrowserPrincipal): Promise<SessionSummary[]>;
  write(principal: BrowserPrincipal, sessionId: string, data: Uint8Array): Promise<PortResult<{accepted:number}>>;
  resize(principal: BrowserPrincipal, sessionId: string, size: SessionSize): Promise<PortResult<SessionSummary>>;
  close(principal: BrowserPrincipal, sessionId: string): Promise<PortResult<ObservedExit>>;
  claimRunController(principal: BrowserPrincipal, input: ClaimRunControllerInput): Promise<PortResult<ClaimReceipt>>;
}
export type Attachment = { attachmentId: string; session: SessionSummary; detach(): Promise<void> };

export type SessionRecordBase = {
  sessionId: string;
  operationKey: string;
  requestHash: string;
  recipeDigest: string;
  launcher: SessionLauncher;
  host: SessionHostKind;
  rootId: SafeRootId;
  relativeCwd: string;
  name: string;
  attachmentIds: string[];
  /** `bytes` is what is still on disk; `lastSequence` is the CUMULATIVE BYTE TOTAL the session has
   *  produced (the offset one past its last byte), so the retained window is
   *  `[lastSequence - bytes, lastSequence)`. `truncated` records that compaction dropped a head. */
  transcript: { path: string; bytes: number; truncated: boolean; lastSequence: number };
  startedAt: string;
  endedAt: string | null;
  revision: number;
};
export type SessionRecordProvenance =
  | { provenance: 'manual'; controller: BrowserController; claimRevision?: never;
      operator?: never; runRef?: never; attemptRef?: never; managedSessionRef?: never }
  | { provenance: 'run'; controller: null; claimRevision?: never; operator: string;
      runRef: string; attemptRef: string; managedSessionRef: string }
  | { provenance: 'run'; controller: BrowserController; claimRevision: number; operator: string;
      runRef: string; attemptRef: string; managedSessionRef: string };
export type SessionRecordState =
  | { state: 'starting'; epochId: string; exit: null }
  | { state: 'live'; epochId: string; exit: null }
  | { state: 'closing'; epochId: string; exit: null }
  | { state: 'exited'; epochId: string; exit: ObservedExit }
  | { state: 'abandoned'; epochId: string; exit: ObservedExit & { reason: 'abandoned' };
      abandonReason: 'epoch-lost' | 'daemon-restart' | 'start-recovery' };
export type SessionRecord = SessionRecordBase & SessionRecordProvenance & SessionRecordState;
export type OperationReceipt = { operationKey: string; requestHash: string;
  status: 'pending' | 'bound' | 'failed' | 'cancelled'; sessionId: string | null;
  attemptRef: string | null; refusal: HostRefusalCode | null; createdAt: string; settledAt: string | null };
export type AttemptOperationStatus = 'pending' | 'bound' | 'cancelled' | 'failed' | 'completed';
/** Durable write-ahead state for one attempt operation, keyed by `operationKey`. No optional
 *  fields: absence is always an explicit `null`. `requestHash` is the sha256 hex of the canonical
 *  declaration JSON. `revision` is the CAS token carried by `AttemptBindingPort.writeOperation`.
 *  CONTRACT — `promptsDelivered` is a RESERVATION count, not a delivery receipt: it is incremented
 *  before the bytes leave the process and never decremented, so prompt `i` is sent at most once for the
 *  life of the key. A crash between the reservation and the write loses that prompt permanently; the
 *  session strands with a durable `promptsDelivered` the operator can read, and the attempt timer
 *  settles the operation `failed`. */
export type AttemptOperationRecord = { operationKey: string; requestHash: string;
  status: AttemptOperationStatus; promptsDelivered: number; sessionId: string | null;
  attemptRef: string | null; receipt: OperationReceipt | null; revision: number; updatedAt: string };
export type ArchiveKeyEntry = { key: string; sessionRunRef: string; reason: string | null };
export type PtySessionsDocumentV2 = { schema: 'kb.pty-sessions/v2'; revision: number;
  sessions: SessionRecord[]; attemptBindings: AttemptBinding[]; operationReceipts: OperationReceipt[];
  attemptOperations: Record<string, AttemptOperationRecord>;
  legacyRuns: SessionRunRecord[]; legacyArchiveKeys: ArchiveKeyEntry[] };
/** CONTRACT ([C-R6], W0 amendment #3) — every `sequence` here is a BYTE OFFSET into the session's
 *  output stream, not a frame counter: a frame's `sequence` is the offset of its first byte, counted
 *  from the first byte the session ever produced. `fromSequence` is the offset the caller asked for,
 *  `replayFrom` the offset the reader actually started at (higher when compaction or the 64 KiB window
 *  moved it forward — earlier output was not kept), and `nextSequence` the offset one past the last
 *  byte returned, which is the cursor the caller holds next. */
export type RawSessionReplay = { sessionId: string; fromSequence: number; replayFrom: number;
  nextSequence: number; complete: boolean;
  frames: { sequence: number; encoding: 'base64'; data: string }[] };
