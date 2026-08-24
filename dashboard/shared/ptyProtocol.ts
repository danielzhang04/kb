/**
 * Outbound (server -> browser) high-water mark, in bytes of socket send buffer. A PTY can produce faster
 * than a browser drains; without a ceiling the daemon buffers the difference forever. When a socket's
 * `bufferedAmount` crosses this, the connection's attachments are dropped rather than queued: the session
 * itself survives for reattach, and the reader that could not keep up pays with a reconnect instead of
 * the daemon paying with unbounded memory.
 */
export const PTY_OUTBOUND_HIGH_WATER_BYTES = 1_048_576;

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

/**
 * Why the PTY socket closed, as a CLOSED set. The route uses exactly four codes and the browser must be
 * able to tell them apart: "the daemon shed you because you could not keep up" and "the session ended"
 * are different truths and only one of them is worth reattaching after. Anything else — including a
 * close with no code at all — is `other`.
 */
export const PTY_CLOSE_CODES = {
  normal: 1000,
  policy: 1008,
  tooLarge: 1009,
  backpressure: 1013,
} as const;
export type PtyCloseReason = keyof typeof PTY_CLOSE_CODES | 'other';

export function decodePtyCloseReason(code: unknown): PtyCloseReason {
  for (const [reason, value] of Object.entries(PTY_CLOSE_CODES)) {
    if (code === value) return reason as PtyCloseReason;
  }
  return 'other';
}
export type RecipeSandbox = 'interactive' | 'claude-policy' | 'codex-workspace-write';
export type LaunchRecipe = { launcher: SessionLauncher; mode: SessionMode; model: string | null;
  toolPolicyId: string; sandbox: RecipeSandbox; resumeRef?: string };

/**
 * Why an OPTIONAL launcher was dropped from an otherwise-available host. A closed set of codes and
 * nothing else — never a path, an ACL, a SID, or a message from the pin inspector: this crosses the
 * wire to the browser and into Health, where a tampered launcher must be VISIBLE without publishing
 * the attacker's own filenames back out.
 */
export type DroppedLauncherRefusal = 'launcher-profile-invalid' | 'launcher-unavailable' | 'launcher-changed';
export type DroppedLauncher = { launcher: SessionLauncher; refusal: DroppedLauncherRefusal };
export type PublicPtyCapability =
  /** `droppedLaunchers` is present ONLY when a launcher was dropped: an available host that advertised
   *  everything it found says nothing, so the field's presence is itself the alarm. */
  | { pty: true; host: SessionHostKind; launchers: SessionLauncher[]; roots: SafeRootId[]; checkedAt: string;
      droppedLaunchers?: DroppedLauncher[] }
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

/**
 * THE CURSOR CONTRACT ([C-R6], W0 amendment #3). Every `sequence` in this grammar — `data.sequence`,
 * `attach.fromSequence`, `attached.replayFrom`, `attached.nextSequence` — is a BYTE OFFSET into the
 * session's output stream: the offset of a frame's first byte, counted from the first byte the session
 * ever produced. It is NOT a frame counter, and frame boundaries carry no meaning: a replayed frame is
 * any slice of the retained transcript. A client's cursor is therefore always
 * `frame.sequence + byteLength(frame.data)`, which it sends back as `attach.fromSequence`; the server
 * answers with the `replayFrom` it could actually honour, so a cursor whose bytes are gone is visible
 * rather than silently skipped.
 */
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
