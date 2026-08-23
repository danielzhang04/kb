/**
 * P3 W6.4 — the ONE browser transport for the v2 PTY surface.
 *
 * This module speaks exactly the frames in `shared/ptyProtocol.ts` and nothing else. There is no raw
 * string protocol any more (a keystroke is a typed `input` frame carrying base64, never a bare text
 * frame), no upgrade query at all (the route 400s on any query key — a session is named in a frame
 * AFTER the socket exists), and no localStorage: the SERVER's session list is the only source of truth
 * for what a browser may reattach to, so a tab order remembered in the browser could only ever lie.
 *
 * Reconnect uses the route's cursor semantics, and that cursor is a BYTE OFFSET ([C-R6], W0 amendment
 * #3): a `data` frame's `sequence` is the offset of its first byte in the session's output stream, so
 * the caller's cursor is `sequence + byteLength(data)` and a reattach sends that as `fromSequence`. The
 * `attached` frame answers with the `replayFrom` the server could honour and the `nextSequence` to hold.
 * That is the `Last-Event-ID` of this transport; replayed bytes arrive flagged `replay: true` so a
 * read-only surface can render scrollback without pretending it is live.
 *
 * Every server frame is validated by W4's closed decoder (`decodeBrowserServerFrame`) before it reaches
 * a caller. An undecodable frame is a protocol violation, reported as such — never written to a grid.
 */
import { decodeBrowserServerFrame, decodeSessionSummary } from '../console/sessionWorkspaceModel';
import { decodePtyCloseReason } from '../../shared/ptyProtocol.ts';
import type {
  BrowserClientFrame,
  BrowserServerFrame,
  HostRefusalCode,
  PtyCloseReason,
  SafeRootId,
  SessionLauncher,
  SessionSummary,
} from '../../shared/ptyProtocol.ts';

export type FetchLike = typeof fetch;

/** The negotiated subprotocol; the bearer rides beside it, never in the URL (which would be logged). */
export const PTY_SUBPROTOCOL = 'kb-pty.v1';

/**
 * Opens the PTY WebSocket. The URL carries NO query — not a session, not a spawn, not a launcher. The
 * factory is injectable so a component test can drive a console through a fake socket.
 */
export type PtySocketFactory = (sessionToken: string) => WebSocket;

export const defaultPtySocketFactory: PtySocketFactory = (sessionToken) => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(`${proto}//${window.location.host}/api/pty`, [PTY_SUBPROTOCOL, sessionToken]);
};

/** Request ids must satisfy the decoder's `req-<32 hex>` shape on the way back. */
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `req-${hex}`;
}

/** UTF-8 → canonical base64, the only encoding an `input` frame may carry. */
export function encodeInput(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * How many BYTES a `data` frame carries — the amount its `sequence` advances the [C-R6] cursor by.
 * Counted from the base64, never from the decoded text: one character can be several bytes, and the
 * cursor is a byte offset. Invalid base64 counts as zero, exactly as {@link decodeOutput} renders it.
 */
export function outputByteLength(data: string): number {
  try {
    return atob(data).length;
  } catch {
    return 0;
  }
}

/** Canonical base64 → the text a terminal grid renders. Invalid base64 yields an empty string. */
export function decodeOutput(data: string): string {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/** The v2 REST list envelope, exactly as `GET /api/pty/sessions` sends it. */
export interface PtySessionListing {
  revision: number;
  sessions: SessionSummary[];
}

/**
 * GET the caller's live sessions. A non-2xx (401 relock, 428 no browser session) yields `null` — the
 * caller shows the closed state rather than an empty list, because "you have no sessions" and "we could
 * not ask" are different truths and only one of them permits opening a fresh one.
 */
export async function listPtySessions(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<PtySessionListing | null> {
  try {
    const res = await fetchImpl('/api/pty/sessions', {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { revision?: unknown; sessions?: unknown };
    if (typeof body?.revision !== 'number' || !Array.isArray(body.sessions)) return null;
    // A row that fails the strict decoder is a PROTOCOL VIOLATION, not a row to hide: filtering it out
    // would render a shorter list that looks authoritative. The whole listing is refused instead.
    if (!body.sessions.every(decodeSessionSummary)) return null;
    return { revision: body.revision, sessions: body.sessions };
  } catch {
    return null;
  }
}

/** DELETE (close) one session. `exit-unconfirmed` is the route's 409: the kill was asked, not observed. */
export type DeletePtySessionResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'exit-unconfirmed' | 'unreachable' };

export async function deletePtySession(
  sessionId: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<DeletePtySessionResult> {
  try {
    const res = await fetchImpl(`/api/pty/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (res.ok) return { ok: true };
    if (res.status === 409) return { ok: false, reason: 'exit-unconfirmed' };
    if (res.status === 404) return { ok: false, reason: 'not-found' };
    return { ok: false, reason: 'unreachable' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/** The REST contract the Terminal workspace depends on; injected in tests as a fake. */
export interface TerminalSessionsClient {
  list(token: string): Promise<PtySessionListing | null>;
  remove(sessionId: string, token: string): Promise<DeletePtySessionResult>;
}

export const defaultTerminalSessionsClient: TerminalSessionsClient = {
  list: (token) => listPtySessions(token),
  remove: (sessionId, token) => deletePtySession(sessionId, token),
};

/**
 * Why a connection ended: a transport `error`, or the decoded close reason. A surface renders one
 * sentence per member — the whole point of carrying the code this far.
 */
export type PtyConnectionClosure = 'error' | PtyCloseReason;

export interface PtyConnectionHandlers {
  /** A decoded, schema-valid server frame. */
  onFrame(frame: BrowserServerFrame): void;
  onOpen?(): void;
  /** The socket ended. `error` distinguishes a transport failure from an ordinary close. */
  onClose?(closure: PtyConnectionClosure): void;
  /** A frame the closed decoder refused. Diagnostics only — the bytes are dropped, never rendered. */
  onProtocolViolation?(): void;
}

export interface PtyConnection {
  send(frame: BrowserClientFrame): boolean;
  close(): void;
  readonly isOpen: boolean;
}

/**
 * Open one `/api/pty` socket and pump typed frames across it. This is the only place in the browser that
 * touches a WebSocket for a terminal; every surface goes through the returned {@link PtyConnection}.
 */
export function openPtyConnection(
  sessionToken: string,
  handlers: PtyConnectionHandlers,
  socketFactory: PtySocketFactory = defaultPtySocketFactory,
): PtyConnection {
  const socket = socketFactory(sessionToken);
  let ended = false;
  const end = (closure: PtyConnectionClosure): void => {
    if (ended) return;
    ended = true;
    handlers.onClose?.(closure);
  };
  socket.onopen = () => handlers.onOpen?.();
  socket.onmessage = (event: MessageEvent) => {
    const raw = typeof event.data === 'string' ? event.data : '';
    if (raw.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      handlers.onProtocolViolation?.();
      return;
    }
    const frame = decodeBrowserServerFrame(parsed);
    if (frame === null) {
      handlers.onProtocolViolation?.();
      return;
    }
    handlers.onFrame(frame);
  };
  socket.onerror = () => end('error');
  // The close CODE is the only thing that distinguishes "the daemon shed this reader" from "the socket
  // ended", and the operator is owed different words for each. A close event with no code is `other`.
  socket.onclose = (event?: { code?: unknown }) => end(decodePtyCloseReason(event?.code));
  return {
    send(frame: BrowserClientFrame): boolean {
      if (socket.readyState !== socket.OPEN) return false;
      socket.send(JSON.stringify(frame));
      return true;
    },
    close(): void {
      try {
        socket.close();
      } catch {
        /* a socket that never opened has nothing to close */
      }
    },
    get isOpen(): boolean {
      return socket.readyState === socket.OPEN;
    },
  };
}

/** A `create` request, in the only vocabulary the route accepts: enums, a root id, a relative path. */
export interface CreateSessionRequest {
  launcher: SessionLauncher;
  rootId: SafeRootId;
  relativeCwd: string;
  cols: number;
  rows: number;
}

export function createFrame(request: CreateSessionRequest, requestId = newRequestId()): BrowserClientFrame {
  return { type: 'create', requestId, ...request };
}

export function attachFrame(sessionId: string, fromSequence: number, requestId = newRequestId()): BrowserClientFrame {
  return { type: 'attach', requestId, sessionId, fromSequence };
}

export function inputFrame(
  sessionId: string,
  attachmentId: string,
  text: string,
  requestId = newRequestId(),
): BrowserClientFrame {
  return { type: 'input', requestId, sessionId, attachmentId, encoding: 'base64', data: encodeInput(text) };
}

export function resizeFrame(
  sessionId: string,
  attachmentId: string,
  cols: number,
  rows: number,
  requestId = newRequestId(),
): BrowserClientFrame {
  return { type: 'resize', requestId, sessionId, attachmentId, cols, rows };
}

export function closeFrame(sessionId: string, requestId = newRequestId()): BrowserClientFrame {
  return { type: 'close', requestId, sessionId };
}

export function detachFrame(
  sessionId: string,
  attachmentId: string,
  requestId = newRequestId(),
): BrowserClientFrame {
  return { type: 'detach', requestId, sessionId, attachmentId };
}

/**
 * The operator-facing sentence for one refusal code. A refusal is always SHOWN: a console that silently
 * did nothing is the failure mode this table exists to prevent.
 */
export function refusalMessage(code: HostRefusalCode): string {
  switch (code) {
    case 'capacity': return 'The host already has the maximum number of sessions open. Close one and try again.';
    case 'unavailable': return 'Terminal is unavailable on this host right now.';
    case 'launcher-unavailable': return 'That launcher is not available on this host.';
    case 'unsafe-root':
    case 'unsafe-cwd': return 'That working directory is outside the allowed roots.';
    case 'input-too-large': return 'That input was too large to send.';
    case 'size-out-of-range': return 'That terminal size is out of range.';
    case 'not-found': return 'That session is no longer available.';
    case 'binding-conflict': return 'Another controller already holds this session.';
    case 'epoch-lost': return 'The session host restarted; this session cannot be resumed.';
    case 'cancelled': return 'The request was cancelled.';
    case 'invalid-request': return 'The dashboard sent a request this host refused.';
    default: return 'The session host refused the request.';
  }
}
