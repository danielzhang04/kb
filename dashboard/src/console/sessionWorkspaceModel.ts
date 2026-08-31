import type {
  AttemptSessionPublicRow,
  BrowserServerFrame,
  HostRefusalCode,
  PublicExit,
  PublicPtyCapability,
  PtyProbeReason,
  SafeRootId,
  SessionHostKind,
  SessionLauncher,
  SessionSize,
  SessionState,
  SessionSummary,
} from '../../shared/ptyProtocol.ts';

const MAX_SAFE_SEQUENCE = 9_007_199_254_740_991;
const REQUEST_ID = /^req-[0-9a-f]{32}$/;
const SESSION_ID = /^pty-[0-9a-f]{32}$/;
const ATTACHMENT_ID = /^att-[0-9a-f]{32}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DISPLAY_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const HOSTS = ['desktop', 'vm'] as const satisfies readonly SessionHostKind[];
const LAUNCHERS = ['shell', 'claude', 'codex'] as const satisfies readonly SessionLauncher[];
const ROOTS = ['repo', 'worktrees'] as const satisfies readonly SafeRootId[];
const STATES = ['starting', 'live', 'closing', 'exited', 'abandoned'] as const satisfies readonly SessionState[];
const REFUSALS = [
  'unavailable',
  'capacity',
  'invalid-request',
  'unsafe-root',
  'unsafe-cwd',
  'launcher-unavailable',
  'input-too-large',
  'size-out-of-range',
  'not-found',
  'binding-conflict',
  'epoch-lost',
  'cancelled',
  'internal',
] as const satisfies readonly HostRefusalCode[];

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.some((entry) => entry === value);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isSafeInteger(value: unknown, minimum = 0, maximum = MAX_SAFE_SEQUENCE): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isSafeText(value: unknown, maximumBytes: number): value is string {
  return typeof value === 'string'
    && !DISPLAY_CONTROL.test(value)
    && utf8Length(value) <= maximumBytes;
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

function isAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && ATTACHMENT_ID.test(value);
}

function isCanonicalBase64(value: unknown): value is string {
  if (typeof value !== 'string' || !BASE64.test(value)) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if ((value.length / 4) * 3 - padding > 65_536) return false;
  try {
    return btoa(atob(value)) === value;
  } catch {
    return false;
  }
}

function decodePublicExit(value: unknown): value is PublicExit {
  if (!isRecord(value) || !hasExactKeys(value, ['exitCode', 'reason', 'observedAt'])) return false;
  return (value.exitCode === null
      || (typeof value.exitCode === 'number' && Number.isFinite(value.exitCode)))
    && isEnum(value.reason, ['exited', 'closed', 'abandoned'] as const)
    && isIsoInstant(value.observedAt);
}

function isSafeCwd(value: unknown): value is string {
  if (typeof value !== 'string' || utf8Length(value) > 240 || DISPLAY_CONTROL.test(value)) return false;
  if (value === '') return true;
  const normalized = value.normalize('NFKC');
  if (/^(?:[A-Za-z]:|[/\\])/.test(normalized) || normalized.includes('\\')) return false;
  const segments = normalized.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..'
    && !/[. ]$/.test(segment)
    && !WINDOWS_DEVICE.test(segment));
}

function isSafeName(value: unknown): value is string {
  if (!isSafeText(value, 80) || value.length === 0) return false;
  const normalized = value.normalize('NFKC');
  return normalized !== '.'
    && normalized !== '..'
    && !/^(?:[A-Za-z]:|[/\\])/.test(normalized)
    && !normalized.includes('/')
    && !normalized.includes('\\')
    && !/[. ]$/.test(normalized)
    && !WINDOWS_DEVICE.test(normalized);
}

/** The one strict summary decoder: every inbound row, frame or REST body, is judged by exactly this. */
export function decodeSessionSummary(value: unknown): value is SessionSummary {
  if (!isRecord(value) || !hasExactKeys(value, [
    'sessionId',
    'name',
    'host',
    'launcher',
    'rootId',
    'cwd',
    'state',
    'attachmentCount',
    'attachmentState',
    'startedAt',
    'endedAt',
    'exit',
  ])) return false;

  if (!isSessionId(value.sessionId)
    || !isSafeName(value.name)
    || !isEnum(value.host, HOSTS)
    || !isEnum(value.launcher, LAUNCHERS)
    || !isEnum(value.rootId, ROOTS)
    || !isSafeCwd(value.cwd)
    || !isEnum(value.state, STATES)
    || !isSafeInteger(value.attachmentCount, 0, 64)
    || !isEnum(value.attachmentState, ['attached', 'detached'] as const)
    || !isIsoInstant(value.startedAt)
    || !(value.endedAt === null || isIsoInstant(value.endedAt))
    || !(value.exit === null || decodePublicExit(value.exit))) return false;

  if ((value.attachmentCount === 0) !== (value.attachmentState === 'detached')) return false;
  const terminal = value.state === 'exited' || value.state === 'abandoned';
  if (terminal !== (value.endedAt !== null && value.exit !== null)) return false;
  if (value.state === 'abandoned' && value.exit?.reason !== 'abandoned') return false;
  return true;
}

function decodeSize(value: unknown): value is SessionSize {
  return isRecord(value)
    && hasExactKeys(value, ['cols', 'rows'])
    && isSafeInteger(value.cols, 20, 500)
    && isSafeInteger(value.rows, 5, 200);
}

function decodeErrorDetail(value: unknown): value is string | null {
  return value === null || isSafeText(value, 160);
}

function decodeRequestSessionRevision(value: UnknownRecord): boolean {
  return isRequestId(value.requestId)
    && isSessionId(value.sessionId)
    && isSafeInteger(value.revision);
}

/** Closed decoder for browser frames sent by the PTY server. */
export function decodeBrowserServerFrame(value: unknown): BrowserServerFrame | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;

  if (value.type === 'session') {
    return hasExactKeys(value, ['type', 'requestId', 'revision', 'session'])
      && value.requestId === null
      && isSafeInteger(value.revision)
      && decodeSessionSummary(value.session)
      ? value as BrowserServerFrame : null;
  }

  if (value.type === 'created') {
    return hasExactKeys(value, ['type', 'requestId', 'revision', 'session', 'attachmentId'])
      && isRequestId(value.requestId)
      && isSafeInteger(value.revision)
      && decodeSessionSummary(value.session)
      && isAttachmentId(value.attachmentId)
      ? value as BrowserServerFrame : null;
  }

  if (value.type === 'attached') {
    return hasExactKeys(value, [
      'type', 'requestId', 'revision', 'session', 'attachmentId', 'replayFrom', 'nextSequence',
    ])
      && isRequestId(value.requestId)
      && isSafeInteger(value.revision)
      && decodeSessionSummary(value.session)
      && isAttachmentId(value.attachmentId)
      && isSafeInteger(value.replayFrom)
      && isSafeInteger(value.nextSequence)
      ? value as BrowserServerFrame : null;
  }

  if (value.type === 'data') {
    return hasExactKeys(value, [
      'type', 'requestId', 'sessionId', 'attachmentId', 'sequence', 'encoding', 'data', 'replay',
    ])
      && value.requestId === null
      && isSessionId(value.sessionId)
      && isAttachmentId(value.attachmentId)
      && isSafeInteger(value.sequence)
      && value.encoding === 'base64'
      && isCanonicalBase64(value.data)
      && typeof value.replay === 'boolean'
      ? value as BrowserServerFrame : null;
  }

  if (value.type === 'exit') {
    return hasExactKeys(value, ['type', 'requestId', 'sessionId', 'sequence', 'exit'])
      && value.requestId === null
      && isSessionId(value.sessionId)
      && isSafeInteger(value.sequence)
      && decodePublicExit(value.exit)
      ? value as BrowserServerFrame : null;
  }

  if (value.type === 'ack') {
    if (value.action === 'input') {
      return hasExactKeys(value, ['type', 'requestId', 'action', 'sessionId', 'revision', 'accepted'])
        && decodeRequestSessionRevision(value)
        && isSafeInteger(value.accepted, 0, 65_536)
        ? value as BrowserServerFrame : null;
    }
    if (value.action === 'resize') {
      return hasExactKeys(value, ['type', 'requestId', 'action', 'sessionId', 'revision', 'size'])
        && decodeRequestSessionRevision(value)
        && decodeSize(value.size)
        ? value as BrowserServerFrame : null;
    }
    if (value.action === 'close') {
      return hasExactKeys(value, ['type', 'requestId', 'action', 'sessionId', 'revision', 'exit'])
        && decodeRequestSessionRevision(value)
        && decodePublicExit(value.exit)
        ? value as BrowserServerFrame : null;
    }
    if (value.action === 'detach') {
      return hasExactKeys(value, ['type', 'requestId', 'action', 'sessionId', 'revision', 'attachmentId'])
        && decodeRequestSessionRevision(value)
        && isAttachmentId(value.attachmentId)
        ? value as BrowserServerFrame : null;
    }
    return null;
  }

  if (value.type === 'error') {
    return hasExactKeys(value, ['type', 'requestId', 'sessionId', 'code', 'detail'])
      && (value.requestId === null || isRequestId(value.requestId))
      && (value.sessionId === null || isSessionId(value.sessionId))
      && isEnum(value.code, REFUSALS)
      && decodeErrorDetail(value.detail)
      ? value as BrowserServerFrame : null;
  }

  return null;
}

export type SessionWorkspaceAvailability =
  | {
      kind: 'available';
      hostLabel: 'Desktop' | 'VM';
      launchers: readonly SessionLauncher[];
      roots: readonly SafeRootId[];
    }
  | {
      kind: 'unavailable';
      title: string;
      message: string;
      /**
       * The host's own bounded explanation, e.g. `kb-shell-broker socket is not listening`. This is the
       * `detail` half of P3 §8's "unavailable shows bounded reason/detail": without it the operator is
       * told a terminal is missing and given no way to tell "this host has no PTY" from "the broker is
       * down", which are two different next actions. The closed `reason` ENUM is deliberately NOT
       * carried into copy — ux-rules 13 lists "raw ids as names" as a violation, so the enum stays a
       * projection input and only the sanitized human sentence reaches the DOM.
       */
      detail: string | null;
      actionLabel: string;
    };

export interface SessionWorkspaceModel {
  availability: SessionWorkspaceAvailability;
  sessions: readonly SessionSummary[];
  attachments: Readonly<Record<string, readonly string[]>>;
  selectedSessionId: string | null;
}

function unavailableMessage(reason: PtyProbeReason): string {
  if (reason === 'broker-identity-mismatch' || reason === 'root-policy-invalid') {
    return 'Terminal access needs attention.';
  }
  if (reason === 'broker-unavailable') return 'Terminal is unavailable right now.';
  return 'Terminal is not available on this host.';
}

function projectAvailability(capability: PublicPtyCapability): SessionWorkspaceAvailability {
  if (capability.pty) {
    return {
      kind: 'available',
      hostLabel: capability.host === 'vm' ? 'VM' : 'Desktop',
      launchers: [...capability.launchers],
      roots: [...capability.roots],
    };
  }
  return {
    kind: 'unavailable',
    title: 'Terminal unavailable',
    message: unavailableMessage(capability.diagnostic.reason),
    detail: boundedDetail(capability.diagnostic.detail),
    actionLabel: 'Open Health',
  };
}

/**
 * The same bound the wire decoder enforces, applied again here because a capability may reach this
 * projector without passing `decodeRuntimeCapabilities` (the view's own fail-closed constant does).
 * Single-line, ≤160 UTF-8 bytes, non-empty after trimming, no display-control characters — anything
 * else projects to `null` and the panel shows the closed message alone.
 */
function boundedDetail(detail: string | null): string | null {
  if (detail === null) return null;
  const trimmed = detail.trim();
  if (trimmed === '' || !isSafeText(trimmed, 160)) return null;
  return trimmed;
}

export function createSessionWorkspaceModel(capability: PublicPtyCapability): SessionWorkspaceModel {
  return {
    availability: projectAvailability(capability),
    sessions: [],
    attachments: {},
    selectedSessionId: null,
  };
}

function upsertSession(sessions: readonly SessionSummary[], session: SessionSummary): readonly SessionSummary[] {
  const index = sessions.findIndex((candidate) => candidate.sessionId === session.sessionId);
  if (index < 0) return [...sessions, session];
  return sessions.map((candidate, candidateIndex) => candidateIndex === index ? session : candidate);
}

function addAttachment(
  attachments: Readonly<Record<string, readonly string[]>>,
  sessionId: string,
  attachmentId: string,
): Readonly<Record<string, readonly string[]>> {
  const current = attachments[sessionId] ?? [];
  if (current.includes(attachmentId)) return attachments;
  return { ...attachments, [sessionId]: [...current, attachmentId] };
}

function removeAttachment(
  attachments: Readonly<Record<string, readonly string[]>>,
  sessionId: string,
  attachmentId: string,
): Readonly<Record<string, readonly string[]>> {
  const remaining = (attachments[sessionId] ?? []).filter((candidate) => candidate !== attachmentId);
  return { ...attachments, [sessionId]: remaining };
}

function terminalSession(session: SessionSummary, exit: PublicExit): SessionSummary {
  return {
    ...session,
    state: exit.reason === 'abandoned' ? 'abandoned' : 'exited',
    attachmentCount: 0,
    attachmentState: 'detached',
    endedAt: exit.observedAt,
    exit,
  };
}

export function reduceSessionWorkspace(
  model: SessionWorkspaceModel,
  frame: BrowserServerFrame,
): SessionWorkspaceModel {
  if (frame.type === 'session') {
    const attachments = frame.session.attachmentCount === 0
      ? { ...model.attachments, [frame.session.sessionId]: [] }
      : model.attachments;
    return {
      ...model,
      sessions: upsertSession(model.sessions, frame.session),
      attachments,
      selectedSessionId: model.selectedSessionId ?? frame.session.sessionId,
    };
  }

  if (frame.type === 'created' || frame.type === 'attached') {
    return {
      ...model,
      sessions: upsertSession(model.sessions, frame.session),
      attachments: addAttachment(model.attachments, frame.session.sessionId, frame.attachmentId),
      selectedSessionId: frame.session.sessionId,
    };
  }

  if (frame.type === 'exit') {
    return {
      ...model,
      sessions: model.sessions.map((session) => session.sessionId === frame.sessionId
        ? terminalSession(session, frame.exit) : session),
      attachments: { ...model.attachments, [frame.sessionId]: [] },
    };
  }

  if (frame.type === 'ack' && frame.action === 'close') {
    return {
      ...model,
      sessions: model.sessions.map((session) => session.sessionId === frame.sessionId
        ? terminalSession(session, frame.exit) : session),
      attachments: { ...model.attachments, [frame.sessionId]: [] },
    };
  }

  if (frame.type === 'ack' && frame.action === 'detach') {
    return {
      ...model,
      attachments: removeAttachment(model.attachments, frame.sessionId, frame.attachmentId),
    };
  }

  return model;
}

export type RunSessionMode = 'live-control' | 'live-observe' | 'replay';
export type RunSessionViewModel = AttemptSessionPublicRow & { mode: RunSessionMode };

export interface RunSessionWorkspaceModel {
  selectedSessionId: string | null;
  sessions: readonly RunSessionViewModel[];
}

function isActiveState(state: SessionState): boolean {
  return state === 'starting' || state === 'live' || state === 'closing';
}

export function projectRunSessionWorkspace(
  rows: readonly AttemptSessionPublicRow[],
): RunSessionWorkspaceModel {
  const active = [...rows].reverse().find((row) => isActiveState(row.state));
  const selectedSessionId = active?.sessionId ?? rows.at(-1)?.sessionId ?? null;
  return {
    selectedSessionId,
    sessions: rows.map((row) => ({
      ...row,
      mode: row.sessionId === active?.sessionId
        ? row.liveControl ? 'live-control' : 'live-observe'
        : 'replay',
    })),
  };
}
