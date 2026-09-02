import type {
  BrokerClientFrame,
  BrokerServerFrame,
  HostRefusalCode,
  LaunchRecipe,
  SafeRootId,
  SessionLauncher,
  SessionSize,
} from '../../shared/ptyProtocol.ts';

export const BROKER_PROTOCOL = 'kb-shell-broker/v1' as const;
export const BROKER_MAX_FRAME_BYTES = 98_304;
export const BROKER_MAX_INPUT_BYTES = 65_536;
export const BROKER_MAX_QUEUED_INPUT_BYTES = 262_144;
export const BROKER_MAX_SESSIONS = 16;
const MAX_SAFE_SEQUENCE = 9_007_199_254_740_991;
const requestIdPattern = /^req-[0-9a-f]{32}$/;
const sessionIdPattern = /^pty-[0-9a-f]{32}$/;
const operationKeyPattern = /^op-[0-9a-f]{64}$/;
const epochIdPattern = /^epoch-[0-9a-f]{32}$/;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/;
const policyPattern = /^[a-z][a-z0-9-]{0,63}$/;
const resumePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const refusalCodes = new Set<HostRefusalCode>([
  'unavailable', 'capacity', 'invalid-request', 'unsafe-root', 'unsafe-cwd',
  'launcher-unavailable', 'input-too-large', 'size-out-of-range', 'not-found',
  'binding-conflict', 'epoch-lost', 'cancelled', 'internal',
]);

/**
 * The launcher set, in the ONE wire form this protocol admits: canonical order, no duplicates, nothing
 * outside the closed set. Every party that handles an enumerated set runs it through here — the broker
 * before it answers, the client before it believes, the probe before it publishes — so an enumeration
 * cannot smuggle a launcher past a decoder by reordering or repeating it, and a junk entry is DROPPED
 * rather than allowed to fail the whole set open or closed by accident.
 */
export const SESSION_LAUNCHER_ORDER = ['shell', 'claude', 'codex'] as const;
export function canonicalLaunchers(values: readonly unknown[]): SessionLauncher[] {
  return SESSION_LAUNCHER_ORDER.filter((launcher) => values.includes(launcher));
}

export class BrokerProtocolError extends Error {
  readonly refusal: HostRefusalCode;
  readonly requestId: string | null;

  constructor(message: string, refusal: HostRefusalCode = 'invalid-request', requestId: string | null = null) {
    super(message);
    this.name = 'BrokerProtocolError';
    this.refusal = refusal;
    this.requestId = requestId;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BrokerProtocolError('broker frame must be an object');
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new BrokerProtocolError('broker frame keys are invalid');
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new BrokerProtocolError(`${label} must be a string`);
  return value;
}

function identifier(value: unknown, label: string, pattern: RegExp): string {
  const candidate = text(value, label);
  if (!pattern.test(candidate)) throw new BrokerProtocolError(`${label} is invalid`);
  return candidate;
}

function sequence(value: unknown, label = 'sequence'): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_SAFE_SEQUENCE) {
    throw new BrokerProtocolError(`${label} is outside the safe integer range`);
  }
  return value as number;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new BrokerProtocolError(`${label} must be boolean`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}

function canonicalBase64(value: unknown): string {
  const candidate = text(value, 'data');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(candidate)) {
    throw new BrokerProtocolError('data must be canonical base64');
  }
  const decoded = Buffer.from(candidate, 'base64');
  if (decoded.toString('base64') !== candidate || decoded.byteLength > BROKER_MAX_INPUT_BYTES) {
    throw new BrokerProtocolError('decoded input exceeds 65,536 bytes', 'input-too-large');
  }
  return candidate;
}

function size(cols: unknown, rows: unknown): SessionSize {
  if (!Number.isInteger(cols) || (cols as number) < 20 || (cols as number) > 500
      || !Number.isInteger(rows) || (rows as number) < 5 || (rows as number) > 200) {
    throw new BrokerProtocolError('terminal size is out of range', 'size-out-of-range');
  }
  return { cols: cols as number, rows: rows as number };
}

function rootId(value: unknown): SafeRootId {
  if (value !== 'repo' && value !== 'worktrees') throw new BrokerProtocolError('rootId is invalid', 'unsafe-root');
  return value;
}

export function isSafeRelativeCwd(candidate: string): boolean {
  if (Buffer.byteLength(candidate, 'utf8') > 240 || candidate.includes('\\')
      || candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate) || candidate.startsWith('//')
      || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(candidate)) return false;
  if (candidate === '') return true;
  const parts = candidate.split('/');
  return !parts.some((part) => part === '' || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part));
}

function relativeCwd(value: unknown): string {
  const candidate = text(value, 'relativeCwd');
  if (!isSafeRelativeCwd(candidate)) throw new BrokerProtocolError('relativeCwd is unsafe', 'unsafe-cwd');
  return candidate;
}

export function decodeLaunchRecipe(value: unknown): LaunchRecipe {
  const input = record(value);
  const hasResume = Object.hasOwn(input, 'resumeRef');
  exact(input, hasResume
    ? ['launcher', 'mode', 'model', 'toolPolicyId', 'sandbox', 'resumeRef']
    : ['launcher', 'mode', 'model', 'toolPolicyId', 'sandbox']);
  const launcher = input.launcher;
  const mode = input.mode;
  const model = input.model;
  const toolPolicyId = text(input.toolPolicyId, 'toolPolicyId');
  const sandbox = input.sandbox;
  const resumeRef = hasResume ? text(input.resumeRef, 'resumeRef') : undefined;
  if (!policyPattern.test(toolPolicyId) || (resumeRef !== undefined && !resumePattern.test(resumeRef))) {
    throw new BrokerProtocolError('recipe identifier is invalid');
  }
  if (launcher === 'shell') {
    if (mode !== 'interactive' || model !== null || toolPolicyId !== 'shell-default'
        || sandbox !== 'interactive' || resumeRef !== undefined) {
      throw new BrokerProtocolError('shell recipe is invalid');
    }
  } else if (launcher === 'claude' || launcher === 'codex') {
    if (mode !== 'interactive' && mode !== 'headless-json') throw new BrokerProtocolError('recipe mode is invalid');
    if (typeof model !== 'string' || !modelPattern.test(model)) throw new BrokerProtocolError('recipe model is invalid');
    if (launcher === 'claude' && sandbox !== 'claude-policy') throw new BrokerProtocolError('Claude sandbox is invalid');
    if (launcher === 'codex' && sandbox !== 'codex-workspace-write') throw new BrokerProtocolError('Codex sandbox is invalid');
    if (mode === 'interactive' && resumeRef !== undefined) throw new BrokerProtocolError('interactive resume is invalid');
  } else {
    throw new BrokerProtocolError('recipe launcher is invalid');
  }
  return { launcher, mode, model, toolPolicyId, sandbox: sandbox as LaunchRecipe['sandbox'],
    ...(resumeRef === undefined ? {} : { resumeRef }) };
}

function commonRequest(frame: Record<string, unknown>, sessionNullable: boolean): void {
  identifier(frame.requestId, 'requestId', requestIdPattern);
  if (sessionNullable) {
    if (frame.sessionId !== null) throw new BrokerProtocolError('sessionId must be null');
  } else {
    identifier(frame.sessionId, 'sessionId', sessionIdPattern);
  }
}

export function decodeBrokerClientFrame(value: unknown): BrokerClientFrame {
  const frame = record(value);
  const requestId = typeof frame.requestId === 'string' && requestIdPattern.test(frame.requestId)
    ? frame.requestId
    : null;
  let recognizedRequestType = false;
  try {
    switch (frame.type) {
    case 'hello':
      exact(frame, ['type', 'requestId', 'sessionId', 'protocol', 'dashboardEpochId']);
      commonRequest(frame, true);
      if (frame.protocol !== BROKER_PROTOCOL) throw new BrokerProtocolError('protocol is invalid');
      identifier(frame.dashboardEpochId, 'dashboardEpochId', epochIdPattern);
      break;
    case 'create':
      recognizedRequestType = true;
      exact(frame, ['type', 'requestId', 'sessionId', 'epochId', 'operationKey', 'recipe', 'rootId', 'relativeCwd', 'cols', 'rows']);
      commonRequest(frame, true);
      identifier(frame.epochId, 'epochId', epochIdPattern);
      identifier(frame.operationKey, 'operationKey', operationKeyPattern);
      frame.recipe = decodeLaunchRecipe(frame.recipe);
      rootId(frame.rootId); relativeCwd(frame.relativeCwd); size(frame.cols, frame.rows);
      break;
    case 'attach':
      recognizedRequestType = true;
      exact(frame, ['type', 'requestId', 'sessionId', 'epochId', 'fromSequence']);
      commonRequest(frame, false); identifier(frame.epochId, 'epochId', epochIdPattern); sequence(frame.fromSequence, 'fromSequence');
      break;
    case 'input':
      recognizedRequestType = true;
      exact(frame, ['type', 'requestId', 'sessionId', 'epochId', 'sequence', 'encoding', 'data']);
      commonRequest(frame, false); identifier(frame.epochId, 'epochId', epochIdPattern); sequence(frame.sequence);
      if (frame.encoding !== 'base64') throw new BrokerProtocolError('encoding is invalid');
      canonicalBase64(frame.data);
      break;
    case 'resize':
      recognizedRequestType = true;
      exact(frame, ['type', 'requestId', 'sessionId', 'epochId', 'sequence', 'cols', 'rows']);
      commonRequest(frame, false); identifier(frame.epochId, 'epochId', epochIdPattern); sequence(frame.sequence); size(frame.cols, frame.rows);
      break;
    case 'close':
      recognizedRequestType = true;
      exact(frame, ['type', 'requestId', 'sessionId', 'epochId', 'sequence']);
      commonRequest(frame, false); identifier(frame.epochId, 'epochId', epochIdPattern); sequence(frame.sequence);
      break;
    case 'launchers':
      recognizedRequestType = true;
      exact(frame, ['type', 'requestId', 'sessionId', 'epochId']);
      commonRequest(frame, true); identifier(frame.epochId, 'epochId', epochIdPattern);
      break;
    default:
      throw new BrokerProtocolError('broker client frame type is invalid');
    }
  } catch (error) {
    const recoverableRefusals: ReadonlySet<HostRefusalCode> = new Set([
      'unsafe-root', 'unsafe-cwd', 'size-out-of-range', 'input-too-large',
      'launcher-unavailable', 'not-found', 'capacity', 'epoch-lost',
      'binding-conflict', 'invalid-request',
    ]);
    if (recognizedRequestType && requestId !== null && error instanceof BrokerProtocolError
        && recoverableRefusals.has(error.refusal)) {
      throw new BrokerProtocolError(error.message, error.refusal, requestId);
    }
    throw error;
  }
  return frame as BrokerClientFrame;
}

function errorDetail(value: unknown): string | null {
  const detail = nullableString(value, 'detail');
  if (detail !== null && (Buffer.byteLength(detail, 'utf8') > 160 || /[\r\n]/.test(detail))) {
    throw new BrokerProtocolError('error detail is invalid');
  }
  return detail;
}

function timestamp(value: unknown): string {
  const candidate = text(value, 'observedAt');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(candidate)
      || Number.isNaN(Date.parse(candidate))) throw new BrokerProtocolError('timestamp is invalid');
  return candidate;
}

export function decodeBrokerServerFrame(value: unknown): BrokerServerFrame {
  const frame = record(value);
  switch (frame.type) {
    case 'ready': {
      exact(frame, ['type', 'requestId', 'sessionId', 'protocol', 'epochId', 'maxFrameBytes', 'maxInputBytes', 'maxQueuedInputBytes', 'sessions']);
      commonRequest(frame, true);
      if (frame.protocol !== BROKER_PROTOCOL || frame.maxFrameBytes !== BROKER_MAX_FRAME_BYTES
          || frame.maxInputBytes !== BROKER_MAX_INPUT_BYTES || frame.maxQueuedInputBytes !== BROKER_MAX_QUEUED_INPUT_BYTES) {
        throw new BrokerProtocolError('ready contract is invalid');
      }
      identifier(frame.epochId, 'epochId', epochIdPattern);
      if (!Array.isArray(frame.sessions) || frame.sessions.length > BROKER_MAX_SESSIONS) throw new BrokerProtocolError('ready sessions are invalid');
      const seen = new Set<string>();
      for (const item of frame.sessions) {
        const entry = record(item); exact(entry, ['sessionId', 'epochId']);
        const id = identifier(entry.sessionId, 'sessionId', sessionIdPattern);
        identifier(entry.epochId, 'epochId', epochIdPattern);
        if (seen.has(id)) throw new BrokerProtocolError('ready sessions contain duplicates');
        seen.add(id);
      }
      break;
    }
    case 'launchers': {
      exact(frame, ['type', 'requestId', 'sessionId', 'epochId', 'launchers']);
      commonRequest(frame, true);
      identifier(frame.epochId, 'epochId', epochIdPattern);
      // One wire form per value: the canonical rewrite must be a no-op, so a set that is out of order,
      // repeated, or carrying anything outside the closed launcher set is REFUSED here rather than
      // silently narrowed. A narrowed set would still be honest, but it would also hide a broker whose
      // enumeration is producing something this protocol never described.
      if (!Array.isArray(frame.launchers)
          || canonicalLaunchers(frame.launchers).join(',') !== frame.launchers.join(',')) {
        throw new BrokerProtocolError('enumerated launchers are invalid');
      }
      break;
    }
    case 'ack': {
      const action = frame.action;
      const actionKeys: Record<string, readonly string[]> = {
        create: ['type', 'requestId', 'action', 'sessionId', 'epochId', 'sequence', 'operationKey', 'replayed'],
        attach: ['type', 'requestId', 'action', 'sessionId', 'epochId', 'sequence', 'replayFrom'],
        input: ['type', 'requestId', 'action', 'sessionId', 'epochId', 'sequence', 'accepted'],
        resize: ['type', 'requestId', 'action', 'sessionId', 'epochId', 'sequence', 'size'],
        close: ['type', 'requestId', 'action', 'sessionId', 'epochId', 'sequence', 'replayed'],
      };
      if (typeof action !== 'string' || !(action in actionKeys)) throw new BrokerProtocolError('ack action is invalid');
      exact(frame, actionKeys[action]!); commonRequest(frame, false);
      identifier(frame.epochId, 'epochId', epochIdPattern); sequence(frame.sequence);
      if (action === 'create') { identifier(frame.operationKey, 'operationKey', operationKeyPattern); bool(frame.replayed, 'replayed'); }
      if (action === 'attach') sequence(frame.replayFrom, 'replayFrom');
      if (action === 'input') {
        const accepted = sequence(frame.accepted, 'accepted');
        if (accepted > BROKER_MAX_INPUT_BYTES) throw new BrokerProtocolError('accepted is invalid');
      }
      if (action === 'resize') { const value = record(frame.size); exact(value, ['cols', 'rows']); size(value.cols, value.rows); }
      if (action === 'close') bool(frame.replayed, 'replayed');
      break;
    }
    case 'error':
      exact(frame, ['type', 'requestId', 'sessionId', 'epochId', 'code', 'detail']);
      if (frame.requestId !== null) identifier(frame.requestId, 'requestId', requestIdPattern);
      if (frame.sessionId !== null) identifier(frame.sessionId, 'sessionId', sessionIdPattern);
      if (frame.epochId !== null) identifier(frame.epochId, 'epochId', epochIdPattern);
      if (typeof frame.code !== 'string' || !refusalCodes.has(frame.code as HostRefusalCode)) throw new BrokerProtocolError('error code is invalid');
      errorDetail(frame.detail);
      break;
    case 'data':
      exact(frame, ['type', 'requestId', 'sessionId', 'epochId', 'sequence', 'encoding', 'data']);
      if (frame.requestId !== null) throw new BrokerProtocolError('unsolicited requestId must be null');
      identifier(frame.sessionId, 'sessionId', sessionIdPattern); identifier(frame.epochId, 'epochId', epochIdPattern); sequence(frame.sequence);
      if (frame.encoding !== 'base64') throw new BrokerProtocolError('encoding is invalid'); canonicalBase64(frame.data);
      break;
    case 'exit':
      exact(frame, ['type', 'requestId', 'sessionId', 'epochId', 'sequence', 'exitCode', 'signal', 'reason', 'observedAt']);
      if (frame.requestId !== null) throw new BrokerProtocolError('unsolicited requestId must be null');
      identifier(frame.sessionId, 'sessionId', sessionIdPattern); identifier(frame.epochId, 'epochId', epochIdPattern); sequence(frame.sequence);
      if (frame.exitCode !== null && !Number.isInteger(frame.exitCode)) throw new BrokerProtocolError('exitCode is invalid');
      if (frame.signal !== null && !Number.isInteger(frame.signal)) throw new BrokerProtocolError('signal is invalid');
      if (frame.reason !== 'exited' && frame.reason !== 'closed' && frame.reason !== 'abandoned') throw new BrokerProtocolError('exit reason is invalid');
      timestamp(frame.observedAt);
      break;
    default:
      throw new BrokerProtocolError('broker server frame type is invalid');
  }
  return frame as BrokerServerFrame;
}

export function encodeBrokerFrame(frame: unknown): Uint8Array {
  let json: string;
  try { json = JSON.stringify(frame); } catch { throw new BrokerProtocolError('frame is not JSON serializable'); }
  if (json === undefined) throw new BrokerProtocolError('frame is not JSON serializable');
  const body = Buffer.from(json, 'utf8');
  if (body.byteLength > BROKER_MAX_FRAME_BYTES) throw new BrokerProtocolError('broker frame exceeds 98,304 bytes');
  const wire = Buffer.allocUnsafe(body.byteLength + 4);
  wire.writeUInt32BE(body.byteLength, 0);
  body.copy(wire, 4);
  return wire;
}

export class BrokerFrameDecoder<T> {
  private buffered = Buffer.alloc(0);
  private readonly decode: (value: unknown) => T;
  private readonly recover: ((error: unknown) => boolean) | undefined;

  constructor(decode: (value: unknown) => T, recover?: (error: unknown) => boolean) {
    this.decode = decode;
    this.recover = recover;
  }

  push(chunk: Uint8Array): T[] {
    if (chunk.byteLength === 0) return [];
    this.buffered = Buffer.concat([this.buffered, Buffer.from(chunk)]);
    const frames: T[] = [];
    while (this.buffered.byteLength >= 4) {
      const length = this.buffered.readUInt32BE(0);
      if (length > BROKER_MAX_FRAME_BYTES) {
        this.buffered = Buffer.alloc(0);
        throw new BrokerProtocolError('declared broker frame exceeds 98,304 bytes');
      }
      if (this.buffered.byteLength < length + 4) break;
      const body = this.buffered.subarray(4, length + 4);
      this.buffered = this.buffered.subarray(length + 4);
      let value: unknown;
      try { value = JSON.parse(body.toString('utf8')); } catch { throw new BrokerProtocolError('broker frame is not valid JSON'); }
      try {
        frames.push(this.decode(value));
      } catch (error) {
        if (this.recover?.(error) !== true) throw error;
      }
    }
    return frames;
  }
}
