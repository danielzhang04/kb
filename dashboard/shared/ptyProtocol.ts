export type SessionLauncher = 'shell' | 'claude' | 'codex';
export type SafeRootId = 'repo' | 'worktrees';
export type SessionHostKind = 'desktop' | 'vm';
export type SessionMode = 'interactive' | 'headless-json';
export type SessionState = 'starting' | 'live' | 'closing' | 'exited' | 'abandoned';
export type PtyProbeReason = 'node-pty-unavailable' | 'shell-unavailable' | 'broker-unavailable'
  | 'broker-identity-mismatch' | 'root-policy-invalid' | 'launcher-unavailable';
export type HostRefusalCode = 'unavailable' | 'capacity' | 'invalid-request' | 'unsafe-root'
  | 'unsafe-cwd' | 'launcher-unavailable' | 'input-too-large' | 'size-out-of-range'
  | 'not-found' | 'binding-conflict' | 'epoch-lost' | 'cancelled' | 'internal';
export type SessionSize = { cols: number; rows: number };
export type RecipeSandbox = 'interactive' | 'claude-policy' | 'codex-workspace-write';
export type LaunchRecipe = { launcher: SessionLauncher; mode: SessionMode; model: string | null;
  toolPolicyId: string; sandbox: RecipeSandbox; resumeRef?: string };

export type PublicPtyCapability =
  | { pty: true; host: SessionHostKind; launchers: SessionLauncher[]; roots: SafeRootId[]; checkedAt: string }
  | { pty: false; diagnostic: { reason: PtyProbeReason; detail: string | null; checkedAt: string } };
export type PublicExit = { exitCode: number | null; reason: 'exited' | 'closed' | 'abandoned'; observedAt: string };
export type SessionSummary = {
  sessionId: string;
  name: string;
  host: SessionHostKind;
  launcher: SessionLauncher;
  rootId: SafeRootId;
  cwd: string;
  state: SessionState;
  attachmentCount: number;
  attachmentState: 'attached' | 'detached';
  startedAt: string;
  endedAt: string | null;
  exit: PublicExit | null;
};
export type AttemptSessionPublicRow = {
  attemptRef: string;
  sessionId: string;
  launcher: 'claude' | 'codex';
  state: SessionState;
  startedAt: string;
  endedAt: string | null;
  exit: PublicExit | null;
  controllerClaimed: boolean;
  liveControl: boolean;
};

export type BrowserClientFrame =
  | { type: 'create'; requestId: string; launcher: SessionLauncher; rootId: SafeRootId;
      relativeCwd: string; cols: number; rows: number }
  | { type: 'attach'; requestId: string; sessionId: string; fromSequence: number }
  | { type: 'input'; requestId: string; sessionId: string; attachmentId: string;
      encoding: 'base64'; data: string }
  | { type: 'resize'; requestId: string; sessionId: string; attachmentId: string;
      cols: number; rows: number }
  | { type: 'close'; requestId: string; sessionId: string }
  | { type: 'detach'; requestId: string; sessionId: string; attachmentId: string };
export type BrowserServerFrame =
  | { type: 'session'; requestId: null; revision: number; session: SessionSummary }
  | { type: 'created'; requestId: string; revision: number; session: SessionSummary;
      attachmentId: string }
  | { type: 'attached'; requestId: string; revision: number; session: SessionSummary;
      attachmentId: string; replayFrom: number; nextSequence: number }
  | { type: 'data'; requestId: null; sessionId: string; attachmentId: string;
      sequence: number; encoding: 'base64'; data: string; replay: boolean }
  | { type: 'exit'; requestId: null; sessionId: string; sequence: number; exit: PublicExit }
  | { type: 'ack'; requestId: string; action: 'input'; sessionId: string;
      revision: number; accepted: number }
  | { type: 'ack'; requestId: string; action: 'resize'; sessionId: string;
      revision: number; size: SessionSize }
  | { type: 'ack'; requestId: string; action: 'close'; sessionId: string;
      revision: number; exit: PublicExit }
  | { type: 'ack'; requestId: string; action: 'detach'; sessionId: string;
      revision: number; attachmentId: string }
  | { type: 'error'; requestId: string | null; sessionId: string | null;
      code: HostRefusalCode; detail: string | null };
export type BrokerClientFrame =
  | { type: 'hello'; requestId: string; sessionId: null; protocol: 'kb-shell-broker/v1';
      dashboardEpochId: string }
  | { type: 'create'; requestId: string; sessionId: null; epochId: string; operationKey: string;
      recipe: LaunchRecipe; rootId: SafeRootId; relativeCwd: string; cols: number; rows: number }
  | { type: 'attach'; requestId: string; sessionId: string; epochId: string; fromSequence: number }
  | { type: 'input'; requestId: string; sessionId: string; epochId: string; sequence: number;
      encoding: 'base64'; data: string }
  | { type: 'resize'; requestId: string; sessionId: string; epochId: string; sequence: number;
      cols: number; rows: number }
  | { type: 'close'; requestId: string; sessionId: string; epochId: string; sequence: number };
export type BrokerServerFrame =
  | { type: 'ready'; requestId: string; sessionId: null; protocol: 'kb-shell-broker/v1';
      epochId: string; maxFrameBytes: 98_304; maxInputBytes: 65_536;
      maxQueuedInputBytes: 262_144; sessions: { sessionId: string; epochId: string }[] }
  | { type: 'ack'; requestId: string; action: 'create'; sessionId: string;
      epochId: string; sequence: number; operationKey: string; replayed: boolean }
  | { type: 'ack'; requestId: string; action: 'attach'; sessionId: string;
      epochId: string; sequence: number; replayFrom: number }
  | { type: 'ack'; requestId: string; action: 'input'; sessionId: string; epochId: string;
      sequence: number; accepted: number }
  | { type: 'ack'; requestId: string; action: 'resize'; sessionId: string; epochId: string;
      sequence: number; size: SessionSize }
  | { type: 'ack'; requestId: string; action: 'close'; sessionId: string; epochId: string;
      sequence: number; replayed: boolean }
  | { type: 'error'; requestId: string | null; sessionId: string | null;
      epochId: string | null; code: HostRefusalCode; detail: string | null }
  | { type: 'data'; requestId: null; sessionId: string; epochId: string; sequence: number;
      encoding: 'base64'; data: string }
  | { type: 'exit'; requestId: null; sessionId: string; epochId: string;
      sequence: number; exitCode: number | null; signal: number | null;
      reason: 'exited' | 'closed' | 'abandoned'; observedAt: string };
