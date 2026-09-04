import type {
  BrokerClientFrame,
  BrokerServerFrame,
  BrowserClientFrame,
  BrowserServerFrame,
  LaunchRecipe,
  SessionSummary,
} from './ptyProtocol.ts';

const requestId = 'req-0123456789abcdef0123456789abcdef';
const sessionId = 'pty-0123456789abcdef0123456789abcdef';
const epochId = 'epoch-0123456789abcdef0123456789abcdef';
const operationKey = 'op-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const attachmentId = 'att-0123456789abcdef0123456789abcdef';

const session = {
  sessionId,
  name: 'Shell',
  host: 'desktop',
  launcher: 'shell',
  rootId: 'repo',
  cwd: '',
  state: 'live',
  attachmentCount: 1,
  attachmentState: 'attached',
  startedAt: '2026-08-22T00:00:00.000Z',
  endedAt: null,
  exit: null,
} as const satisfies SessionSummary;

export const validLaunchRecipeVectors = [
  { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
  { launcher: 'claude', mode: 'interactive', model: 'claude-sonnet-4-5', toolPolicyId: 'standard', sandbox: 'claude-policy' },
  { launcher: 'claude', mode: 'headless-json', model: 'claude-sonnet-4-5', toolPolicyId: 'standard', sandbox: 'claude-policy' },
  { launcher: 'claude', mode: 'headless-json', model: 'claude-sonnet-4-5', toolPolicyId: 'standard', sandbox: 'claude-policy', resumeRef: 'resume-claude-1' },
  { launcher: 'codex', mode: 'interactive', model: 'gpt-5.6', toolPolicyId: 'standard', sandbox: 'codex-workspace-write' },
  { launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6', toolPolicyId: 'standard', sandbox: 'codex-workspace-write' },
  { launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6', toolPolicyId: 'standard', sandbox: 'codex-workspace-write', resumeRef: 'resume-codex-1' },
] as const satisfies readonly LaunchRecipe[];

export const invalidLaunchRecipeVectors = [
  { case: 'shell-model', recipe: { launcher: 'shell', mode: 'interactive', model: 'gpt', toolPolicyId: 'shell-default', sandbox: 'interactive' } },
  { case: 'shell-policy', recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'standard', sandbox: 'interactive' } },
  { case: 'shell-resume', recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive', resumeRef: 'resume' } },
  { case: 'interactive-resume', recipe: { launcher: 'claude', mode: 'interactive', model: 'claude-sonnet-4-5', toolPolicyId: 'standard', sandbox: 'claude-policy', resumeRef: 'resume' } },
  { case: 'claude-sandbox', recipe: { launcher: 'claude', mode: 'headless-json', model: 'claude-sonnet-4-5', toolPolicyId: 'standard', sandbox: 'codex-workspace-write' } },
  { case: 'codex-sandbox', recipe: { launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6', toolPolicyId: 'standard', sandbox: 'claude-policy' } },
  { case: 'headless-null-model', recipe: { launcher: 'codex', mode: 'headless-json', model: null, toolPolicyId: 'standard', sandbox: 'codex-workspace-write' } },
  { case: 'raw-argv', recipe: { launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6', toolPolicyId: 'standard', sandbox: 'codex-workspace-write', argv: ['--danger'] } },
  { case: 'raw-env', recipe: { launcher: 'claude', mode: 'headless-json', model: 'claude-sonnet-4-5', toolPolicyId: 'standard', sandbox: 'claude-policy', env: { TOKEN: 'x' } } },
] as const satisfies readonly unknown[];

export const validBrowserClientFrames = [
  { type: 'create', requestId, launcher: 'shell', rootId: 'repo', relativeCwd: '', cols: 20, rows: 5 },
  { type: 'create', requestId, launcher: 'codex', rootId: 'worktrees', relativeCwd: 'run', cols: 500, rows: 200 },
  { type: 'attach', requestId, sessionId, fromSequence: 0 },
  { type: 'attach', requestId, sessionId, fromSequence: 9_007_199_254_740_991 },
  { type: 'input', requestId, sessionId, attachmentId, encoding: 'base64', data: 'YQ==' },
  { type: 'resize', requestId, sessionId, attachmentId, cols: 80, rows: 24 },
  { type: 'close', requestId, sessionId },
  { type: 'detach', requestId, sessionId, attachmentId },
] as const satisfies readonly BrowserClientFrame[];

export const validBrowserServerFrames = [
  { type: 'session', requestId: null, revision: 0, session },
  { type: 'created', requestId, revision: 1, session, attachmentId },
  { type: 'attached', requestId, revision: 2, session, attachmentId, replayFrom: 0, nextSequence: 1 },
  { type: 'data', requestId: null, sessionId, attachmentId, sequence: 0, encoding: 'base64', data: '', replay: false },
  { type: 'exit', requestId: null, sessionId, sequence: 1, exit: { exitCode: 0, reason: 'exited', observedAt: '2026-08-22T00:00:01.000Z' } },
  { type: 'ack', requestId, action: 'input', sessionId, revision: 3, accepted: 65_536 },
  { type: 'ack', requestId, action: 'resize', sessionId, revision: 4, size: { cols: 80, rows: 24 } },
  { type: 'ack', requestId, action: 'close', sessionId, revision: 5, exit: { exitCode: null, reason: 'closed', observedAt: '2026-08-22T00:00:02.000Z' } },
  { type: 'ack', requestId, action: 'detach', sessionId, revision: 6, attachmentId },
  { type: 'error', requestId, sessionId, code: 'invalid-request', detail: null },
] as const satisfies readonly BrowserServerFrame[];

export const validBrokerClientFrames = [
  { type: 'hello', requestId, sessionId: null, protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId },
  { type: 'create', requestId, sessionId: null, epochId, operationKey, recipe: validLaunchRecipeVectors[0], rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 },
  { type: 'attach', requestId, sessionId, epochId, fromSequence: 0 },
  { type: 'input', requestId, sessionId, epochId, sequence: 0, encoding: 'base64', data: 'YQ==' },
  { type: 'resize', requestId, sessionId, epochId, sequence: 1, cols: 80, rows: 24 },
  { type: 'close', requestId, sessionId, epochId, sequence: 2 },
  { type: 'launchers', requestId, sessionId: null, epochId },
  // APPENDED, never inserted: the indices above are addressed positionally by brokerProtocol.test.ts
  // and by the invalid-vector table below.
  { type: 'end-input', requestId, sessionId, epochId, sequence: 3 },
] as const satisfies readonly BrokerClientFrame[];

export const validBrokerServerFrames = [
  { type: 'ready', requestId, sessionId: null, protocol: 'kb-shell-broker/v1', epochId,
    maxFrameBytes: 98_304, maxInputBytes: 65_536, maxQueuedInputBytes: 262_144,
    sessions: [{ sessionId, epochId }] },
  { type: 'ack', requestId, action: 'create', sessionId, epochId, sequence: 0, operationKey, replayed: false },
  { type: 'ack', requestId, action: 'attach', sessionId, epochId, sequence: 1, replayFrom: 0 },
  { type: 'ack', requestId, action: 'input', sessionId, epochId, sequence: 2, accepted: 1 },
  { type: 'ack', requestId, action: 'resize', sessionId, epochId, sequence: 3, size: { cols: 80, rows: 24 } },
  { type: 'ack', requestId, action: 'close', sessionId, epochId, sequence: 4, replayed: false },
  { type: 'error', requestId: null, sessionId, epochId, code: 'epoch-lost', detail: null },
  { type: 'data', requestId: null, sessionId, epochId, sequence: 5, encoding: 'base64', data: 'YQ==' },
  { type: 'exit', requestId: null, sessionId, epochId, sequence: 6, exitCode: null, signal: null,
    reason: 'abandoned', observedAt: '2026-08-22T00:00:03.000Z' },
  { type: 'launchers', requestId, sessionId: null, epochId, launchers: ['shell', 'claude', 'codex'] },
  // The empty set is a LEGAL answer, not a malformed one: a broker that can launch nothing says so.
  { type: 'launchers', requestId, sessionId: null, epochId, launchers: [] },
  { type: 'launchers', requestId, sessionId: null, epochId, launchers: ['shell'] },
  { type: 'ack', requestId, action: 'end-input', sessionId, epochId, sequence: 7 },
] as const satisfies readonly BrokerServerFrame[];

export const invalidPtyProtocolVectors = [
  { case: 'request-id-short', frame: { type: 'close', requestId: 'req-0', sessionId } },
  { case: 'request-id-nonhex', frame: { type: 'close', requestId: `req-${'g'.repeat(32)}`, sessionId } },
  { case: 'session-id-short', frame: { type: 'close', requestId, sessionId: 'pty-0' } },
  { case: 'operation-key-short', frame: { ...validBrokerClientFrames[1], operationKey: 'op-0' } },
  { case: 'epoch-id-short', frame: { ...validBrokerClientFrames[2], epochId: 'epoch-0' } },
  { case: 'attachment-id-short', frame: { ...validBrowserClientFrames[4], attachmentId: 'att-0' } },
  { case: 'sequence-negative', frame: { ...validBrokerClientFrames[3], sequence: -1 } },
  { case: 'sequence-overflow', frame: { ...validBrokerClientFrames[3], sequence: 9_007_199_254_740_992 } },
  { case: 'cols-below-min', frame: { ...validBrowserClientFrames[0], cols: 19 } },
  { case: 'cols-above-max', frame: { ...validBrowserClientFrames[0], cols: 501 } },
  { case: 'rows-below-min', frame: { ...validBrowserClientFrames[0], rows: 4 } },
  { case: 'rows-above-max', frame: { ...validBrowserClientFrames[0], rows: 201 } },
  { case: 'cwd-over-240-bytes', frame: { ...validBrowserClientFrames[0], relativeCwd: 'a'.repeat(241) } },
  { case: 'cwd-traversal', frame: { ...validBrowserClientFrames[0], relativeCwd: '../state' } },
  { case: 'invalid-base64', frame: { ...validBrowserClientFrames[4], data: '**' } },
  { case: 'decoded-input-over-65536', decodedBytes: 65_537, frame: validBrowserClientFrames[4] },
  { case: 'raw-browser-frame-over-90112', rawBytes: 90_113, frame: validBrowserClientFrames[4] },
  { case: 'raw-broker-frame-over-98304', rawBytes: 98_305, frame: validBrokerClientFrames[3] },
  { case: 'queued-input-over-262144', queuedBytes: 262_145, frame: validBrokerClientFrames[3] },
  // An end-input with no `sequence` is the shape that matters: unordered, it could reach the child
  // ahead of the prompt it terminates and close the pipe on an empty instruction. The exact-key rule
  // is what refuses it, so the vector carries the frame MINUS that one key.
  { case: 'end-input-unsequenced', frame: { type: 'end-input', requestId, sessionId, epochId } },
  { case: 'response-request-id-null', frame: { ...validBrowserServerFrames[5], requestId: null } },
  { case: 'unsolicited-request-id-non-null', frame: { ...validBrowserServerFrames[3], requestId } },
  { case: 'missing-key', frame: { type: 'close', requestId } },
  { case: 'extra-key', frame: { ...validBrowserClientFrames[6], command: 'whoami' } },
  { case: 'raw-authority-argv', frame: { ...validBrokerClientFrames[1], argv: ['bash'] } },
  { case: 'raw-authority-env', frame: { ...validBrokerClientFrames[1], env: { TOKEN: 'x' } } },
  { case: 'raw-authority-user', frame: { ...validBrokerClientFrames[1], user: 'root' } },
  { case: 'launchers-duplicated', frame: { type: 'launchers', requestId, sessionId: null, epochId, launchers: ['shell', 'shell'] } },
  { case: 'launchers-out-of-order', frame: { type: 'launchers', requestId, sessionId: null, epochId, launchers: ['codex', 'shell'] } },
  { case: 'launchers-unknown-member', frame: { type: 'launchers', requestId, sessionId: null, epochId, launchers: ['shell', 'bash'] } },
] as const satisfies readonly unknown[];
