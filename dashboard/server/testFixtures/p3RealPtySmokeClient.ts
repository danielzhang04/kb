/**
 * P3 section 7 — the REAL PTY smoke client.
 *
 * This is the node-side half of the bounded concurrent command: `p3FixtureLifecycle.ts` brings an HTTPS
 * fixture up, this process drives its v2 WebSocket route end to end, and its exit code becomes the exit
 * code of the whole proof. It is not a test double of the browser client — it speaks the SAME wire
 * grammar (`shared/ptyProtocol.ts`) over a real socket, because the thing being proven is that a real
 * transport, a real cookie/token pair, and a real transcript fold agree.
 *
 * The cycle, in order: create (a launcher's session), list (REST), write `echo p3-smoke\r` and wait for
 * the host's echo, detach, reattach from sequence 0, compare the replayed bytes to the bytes observed
 * live, and close. Every wait is bounded by `--timeout-ms`; nothing here can block forever, because an
 * unbounded wait in a proof command is indistinguishable from a hang in CI.
 *
 * Exit codes are the contract:
 *   0  every requested launcher completed its cycle
 *   64 usage — argv the client refuses to act on
 *   65 protocol — a frame or body this client's decoder refuses
 *   66 mismatch — the wire answered, but with the wrong bytes/shape (replay differs, capability differs)
 *   67 timeout — a bounded wait expired
 *
 * TLS is PINNED, never disabled: the fixture publishes its loopback certificate through
 * `p3LoopbackTls.ts` and this client passes it as `ca`. `rejectUnauthorized` is left at its secure
 * default everywhere, so a substituted certificate fails the run rather than silently passing it.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import type {
  BrowserClientFrame, BrowserServerFrame, HostRefusalCode, PublicExit, SessionLauncher,
  SessionSummary,
} from '../../shared/ptyProtocol.ts';
import {
  P3_CONTEXT_PATH_ENV, P3_SESSION_TOKEN_ENV, readLoopbackCertificate,
} from './p3LoopbackTls.ts';

/* ------------------------------------------------------------------------------------------------ *
 * Exit codes
 * ------------------------------------------------------------------------------------------------ */

export const SMOKE_EXIT = {
  ok: 0,
  usage: 64,
  protocol: 65,
  mismatch: 66,
  timeout: 67,
} as const;

export type SmokeExitCode = (typeof SMOKE_EXIT)[keyof typeof SMOKE_EXIT];

/** Every failure this client can report. `code` is what the process exits with. */
export class SmokeFailure extends Error {
  readonly code: SmokeExitCode;

  constructor(code: SmokeExitCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'SmokeFailure';
  }
}

/* ------------------------------------------------------------------------------------------------ *
 * A minimal RFC 6455 client
 *
 * `ws` is not a dashboard dependency and Playwright is not installed; adding either to run a proof would
 * put a package in `package.json` that production never loads. Node's global `WebSocket` cannot be given
 * a pinned CA, and pinning is the whole point of the HTTPS fixture. So the handshake rides `node:https`
 * (which does take `ca`) and the framing is done here: text frames only, client frames masked, server
 * frames required to be unmasked, ping answered with pong, everything bounded.
 * ------------------------------------------------------------------------------------------------ */

/** RFC 6455 section 1.3, verbatim. A wrong GUID makes every real handshake fail the accept check. */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** Any single frame larger than this is a protocol failure, not something to buffer. */
export const RAW_WS_MAX_FRAME_BYTES = 1_048_576;

export interface RawWebSocketOptions {
  /** `ws://` or `wss://`. A `wss://` origin pins the fixture's published loopback certificate. */
  url: string;
  headers?: Readonly<Record<string, string>>;
  subprotocols?: readonly string[];
  handshakeTimeoutMs: number;
}

export interface RawWebSocket {
  /** Send one text frame. Throws once the socket is gone. */
  send(text: string): void;
  /** Next text message, or a {@link SmokeFailure} with `timeout`/`protocol` when it cannot come. */
  next(timeoutMs: number): Promise<string>;
  /** Whether the peer has closed. */
  readonly isClosed: () => boolean;
  close(): void;
}

function maskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const mask = randomBytes(4);
  const lengthByte = payload.length < 126 ? payload.length : payload.length <= 0xff_ff ? 126 : 127;
  const extended = lengthByte === 126 ? 2 : lengthByte === 127 ? 8 : 0;
  const header = Buffer.alloc(2 + extended + 4);
  header[0] = 0x81; // FIN + text
  header[1] = 0x80 | lengthByte; // MASK + length
  if (lengthByte === 126) header.writeUInt16BE(payload.length, 2);
  else if (lengthByte === 127) header.writeBigUInt64BE(BigInt(payload.length), 2);
  mask.copy(header, 2 + extended);
  const masked = Buffer.allocUnsafe(payload.length);
  for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index % 4];
  return Buffer.concat([header, masked]);
}

function controlFrame(opcode: number, payload: Buffer): Buffer {
  const mask = randomBytes(4);
  const header = Buffer.alloc(6);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | payload.length;
  mask.copy(header, 2);
  const masked = Buffer.allocUnsafe(payload.length);
  for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index % 4];
  return Buffer.concat([header, masked]);
}

export async function openRawWebSocket(options: RawWebSocketOptions): Promise<RawWebSocket> {
  const target = new URL(options.url);
  const secure = target.protocol === 'wss:';
  if (!secure && target.protocol !== 'ws:') {
    throw new SmokeFailure(SMOKE_EXIT.usage, `openRawWebSocket: ${target.protocol} is not a WebSocket scheme`);
  }
  let ca: string | null = null;
  if (secure) {
    ca = readLoopbackCertificate(Number(target.port));
    if (ca === null) {
      throw new SmokeFailure(SMOKE_EXIT.protocol, `no pinned certificate published for port ${target.port}`);
    }
  }
  const key = randomBytes(16).toString('base64');
  const send = secure ? httpsRequest : httpRequest;
  const headers: Record<string, string> = {
    connection: 'Upgrade',
    upgrade: 'websocket',
    'sec-websocket-key': key,
    'sec-websocket-version': '13',
    ...(options.headers ?? {}),
  };
  if (options.subprotocols && options.subprotocols.length > 0) {
    headers['sec-websocket-protocol'] = options.subprotocols.join(', ');
  }

  const call = send({
    protocol: target.protocol === 'wss:' ? 'https:' : 'http:',
    host: target.hostname,
    port: target.port,
    path: `${target.pathname}${target.search}`,
    method: 'GET',
    headers,
    // No `rejectUnauthorized: false` anywhere in this module. An unpinnable fixture fails above.
    ...(ca === null ? {} : { ca }),
  });

  const socket = await new Promise<Socket>((resolve, reject) => {
    const timer = setTimeout(() => {
      call.destroy();
      reject(new SmokeFailure(SMOKE_EXIT.timeout, `WebSocket handshake exceeded ${options.handshakeTimeoutMs} ms`));
    }, options.handshakeTimeoutMs);
    timer.unref?.();
    call.once('upgrade', (response, upgraded: Socket, head: Buffer) => {
      clearTimeout(timer);
      const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
      if (String(response.headers['sec-websocket-accept'] ?? '') !== accept) {
        upgraded.destroy();
        reject(new SmokeFailure(SMOKE_EXIT.protocol, 'server returned a wrong Sec-WebSocket-Accept'));
        return;
      }
      if (head.length > 0) upgraded.unshift(head);
      resolve(upgraded);
    });
    call.once('response', (response) => {
      clearTimeout(timer);
      response.resume();
      reject(new SmokeFailure(SMOKE_EXIT.protocol, `WebSocket upgrade refused with HTTP ${response.statusCode ?? 0}`));
    });
    call.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(new SmokeFailure(SMOKE_EXIT.protocol, `WebSocket connect failed: ${error.message}`));
    });
    call.end();
  });

  const messages: string[] = [];
  const waiters: { resolve: (value: string) => void; reject: (error: Error) => void }[] = [];
  let closed = false;
  let failure: Error | null = null;
  let buffer = Buffer.alloc(0);
  let continuation: Buffer[] | null = null;

  const settleFailure = (error: Error): void => {
    failure = error;
    closed = true;
    while (waiters.length > 0) waiters.shift()?.reject(error);
    socket.destroy();
  };
  const deliver = (text: string): void => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(text);
    else messages.push(text);
  };
  const markClosed = (): void => {
    closed = true;
    while (waiters.length > 0) {
      waiters.shift()?.reject(new SmokeFailure(SMOKE_EXIT.protocol, 'socket closed while awaiting a frame'));
    }
  };

  const drain = (): void => {
    for (;;) {
      if (buffer.length < 2) return;
      const first = buffer[0];
      const second = buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const wide = buffer.readBigUInt64BE(2);
        if (wide > BigInt(RAW_WS_MAX_FRAME_BYTES)) {
          settleFailure(new SmokeFailure(SMOKE_EXIT.protocol, 'server frame exceeds the raw ceiling'));
          return;
        }
        length = Number(wide);
        offset = 10;
      }
      if (masked) {
        settleFailure(new SmokeFailure(SMOKE_EXIT.protocol, 'server sent a masked frame'));
        return;
      }
      if (length > RAW_WS_MAX_FRAME_BYTES) {
        settleFailure(new SmokeFailure(SMOKE_EXIT.protocol, 'server frame exceeds the raw ceiling'));
        return;
      }
      if (buffer.length < offset + length) return;
      const payload = buffer.subarray(offset, offset + length);
      buffer = buffer.subarray(offset + length);

      if (opcode === 0x9) { socket.write(controlFrame(0xa, payload)); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x8) { markClosed(); socket.end(); return; }
      if (opcode === 0x2) {
        settleFailure(new SmokeFailure(SMOKE_EXIT.protocol, 'server sent a binary frame'));
        return;
      }
      if (opcode === 0x0) {
        if (continuation === null) {
          settleFailure(new SmokeFailure(SMOKE_EXIT.protocol, 'continuation frame with nothing to continue'));
          return;
        }
        continuation.push(payload);
      } else if (opcode === 0x1) {
        if (continuation !== null) {
          settleFailure(new SmokeFailure(SMOKE_EXIT.protocol, 'text frame inside a fragmented message'));
          return;
        }
        continuation = [payload];
      } else {
        settleFailure(new SmokeFailure(SMOKE_EXIT.protocol, `unknown opcode ${opcode}`));
        return;
      }
      if (fin && continuation !== null) {
        deliver(Buffer.concat(continuation).toString('utf8'));
        continuation = null;
      }
    }
  };

  socket.on('data', (chunk: Buffer) => { buffer = Buffer.concat([buffer, chunk]); drain(); });
  socket.on('error', (error: Error) => settleFailure(new SmokeFailure(SMOKE_EXIT.protocol, error.message)));
  socket.on('close', markClosed);

  return {
    send(text: string): void {
      if (closed) throw new SmokeFailure(SMOKE_EXIT.protocol, 'send on a closed socket');
      socket.write(maskedTextFrame(text));
    },
    next(timeoutMs: number): Promise<string> {
      const queued = messages.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      if (failure !== null) return Promise.reject(failure);
      if (closed) return Promise.reject(new SmokeFailure(SMOKE_EXIT.protocol, 'socket closed while awaiting a frame'));
      return new Promise<string>((resolve, reject) => {
        // The waiter is removed by IDENTITY of the entry that was queued. Matching on the caller's own
        // `resolve` never matched the wrapper stored below, so a timed-out waiter stayed in the queue and
        // swallowed the next message that arrived — after which every later read was one frame behind and
        // the client eventually hung on a frame that had already been delivered to nobody.
        const entry = {
          resolve: (value: string) => { clearTimeout(timer); resolve(value); },
          reject: (error: Error) => { clearTimeout(timer); reject(error); },
        };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(entry);
          if (index >= 0) waiters.splice(index, 1);
          reject(new SmokeFailure(SMOKE_EXIT.timeout, `no frame within ${timeoutMs} ms`));
        }, timeoutMs);
        timer.unref?.();
        waiters.push(entry);
      });
    },
    isClosed: () => closed,
    close(): void {
      if (closed) return;
      closed = true;
      socket.write(controlFrame(0x8, Buffer.alloc(0)));
      socket.end();
    },
  };
}

/* ------------------------------------------------------------------------------------------------ *
 * Strict decode of one server frame
 *
 * `server/pty/route.ts` owns the SERVER-side decoder (client frames). Nothing decodes the server frames
 * strictly today — `terminalClient.ts` narrows them inline as it dispatches. This client needs a hard
 * refusal, not a narrowing, because "the server said something we do not understand" must exit 65 rather
 * than being ignored as an unhandled branch.
 * ------------------------------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPublicExit(value: unknown): value is PublicExit {
  if (!isRecord(value)) return false;
  const exitCode = value.exitCode;
  return (exitCode === null || typeof exitCode === 'number')
    && (value.reason === 'exited' || value.reason === 'closed' || value.reason === 'abandoned')
    && typeof value.observedAt === 'string';
}

export function isSessionSummaryShape(value: unknown): value is SessionSummary {
  if (!isRecord(value)) return false;
  return typeof value.sessionId === 'string'
    && typeof value.name === 'string'
    && (value.host === 'desktop' || value.host === 'vm')
    && (value.launcher === 'shell' || value.launcher === 'claude' || value.launcher === 'codex')
    && (value.rootId === 'repo' || value.rootId === 'worktrees')
    && typeof value.cwd === 'string'
    && typeof value.state === 'string'
    && typeof value.attachmentCount === 'number'
    && (value.attachmentState === 'attached' || value.attachmentState === 'detached')
    && typeof value.startedAt === 'string'
    && (value.endedAt === null || typeof value.endedAt === 'string')
    && (value.exit === null || isPublicExit(value.exit));
}

/** Returns `null` for anything this client will not act on. `null` becomes exit 65 at every call site. */
export function decodeBrowserServerFrame(raw: string): BrowserServerFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const requestId = parsed.requestId;
  switch (parsed.type) {
    case 'session':
      if (requestId !== null || typeof parsed.revision !== 'number' || !isSessionSummaryShape(parsed.session)) return null;
      return { type: 'session', requestId: null, revision: parsed.revision, session: parsed.session };
    case 'created':
      if (typeof requestId !== 'string' || typeof parsed.revision !== 'number'
        || !isSessionSummaryShape(parsed.session) || typeof parsed.attachmentId !== 'string') return null;
      return {
        type: 'created', requestId, revision: parsed.revision,
        session: parsed.session, attachmentId: parsed.attachmentId,
      };
    case 'attached':
      if (typeof requestId !== 'string' || typeof parsed.revision !== 'number'
        || !isSessionSummaryShape(parsed.session) || typeof parsed.attachmentId !== 'string'
        || typeof parsed.replayFrom !== 'number' || typeof parsed.nextSequence !== 'number') return null;
      return {
        type: 'attached', requestId, revision: parsed.revision, session: parsed.session,
        attachmentId: parsed.attachmentId, replayFrom: parsed.replayFrom, nextSequence: parsed.nextSequence,
      };
    case 'data':
      if (requestId !== null || typeof parsed.sessionId !== 'string' || typeof parsed.attachmentId !== 'string'
        || typeof parsed.sequence !== 'number' || parsed.encoding !== 'base64'
        || typeof parsed.data !== 'string' || typeof parsed.replay !== 'boolean') return null;
      return {
        type: 'data', requestId: null, sessionId: parsed.sessionId, attachmentId: parsed.attachmentId,
        sequence: parsed.sequence, encoding: 'base64', data: parsed.data, replay: parsed.replay,
      };
    case 'exit':
      if (requestId !== null || typeof parsed.sessionId !== 'string'
        || typeof parsed.sequence !== 'number' || !isPublicExit(parsed.exit)) return null;
      return {
        type: 'exit', requestId: null, sessionId: parsed.sessionId,
        sequence: parsed.sequence, exit: parsed.exit,
      };
    case 'ack': {
      if (typeof requestId !== 'string' || typeof parsed.sessionId !== 'string'
        || typeof parsed.revision !== 'number') return null;
      const base = { type: 'ack' as const, requestId, sessionId: parsed.sessionId, revision: parsed.revision };
      if (parsed.action === 'input' && typeof parsed.accepted === 'number') {
        return { ...base, action: 'input', accepted: parsed.accepted };
      }
      if (parsed.action === 'resize' && isRecord(parsed.size)
        && typeof parsed.size.cols === 'number' && typeof parsed.size.rows === 'number') {
        return { ...base, action: 'resize', size: { cols: parsed.size.cols, rows: parsed.size.rows } };
      }
      if (parsed.action === 'close' && isPublicExit(parsed.exit)) {
        return { ...base, action: 'close', exit: parsed.exit };
      }
      if (parsed.action === 'detach' && typeof parsed.attachmentId === 'string') {
        return { ...base, action: 'detach', attachmentId: parsed.attachmentId };
      }
      return null;
    }
    case 'error': {
      if (!(requestId === null || typeof requestId === 'string')) return null;
      if (!(parsed.sessionId === null || typeof parsed.sessionId === 'string')) return null;
      if (typeof parsed.code !== 'string') return null;
      if (!(parsed.detail === null || typeof parsed.detail === 'string')) return null;
      return {
        type: 'error', requestId, sessionId: parsed.sessionId,
        code: parsed.code as HostRefusalCode, detail: parsed.detail,
      };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------------------------------ *
 * Argv
 * ------------------------------------------------------------------------------------------------ */

export const SMOKE_CYCLE_STEPS = [
  'create', 'list', 'write', 'detach', 'reattach', 'compare-transcript', 'bulk-reattach', 'close',
] as const;
export type SmokeCycleStep = (typeof SMOKE_CYCLE_STEPS)[number];

const LAUNCHERS: readonly SessionLauncher[] = ['shell', 'claude', 'codex'];
export const DEFAULT_SMOKE_TIMEOUT_MS = 10_000;
/** The exact bytes written to the session, and the substring the echo must contain. */
export const SMOKE_INPUT = 'echo p3-smoke\r';
export const SMOKE_ECHO_MARK = 'p3-smoke';
/**
 * `bulk-reattach` drives the session past the 64 KiB replay window and reattaches. It is the only step
 * that can catch a cursor space that is not bytes: below the window every numbering happens to line up.
 */
export const SMOKE_BULK_TARGET_BYTES = 98_304;
const SMOKE_BULK_LINE = `echo p3-bulk${'x'.repeat(900)}\r`;

export interface P3RealPtySmokeArgs {
  origin: string;
  /** Bearer session token minted by the fixture. Printed in its banner; never derived from a URL. */
  sessionToken: string;
  /** Path on the fixture that installs the browser-session cookie for the context under test. */
  contextPath: string;
  interactive: SessionLauncher[];
  headless: SessionLauncher[];
  cycle: SmokeCycleStep[];
  roundtripCurrentRecipes: boolean;
  failIfUnavailable: boolean;
  timeoutMs: number;
}

function parseLauncherList(flag: string, raw: string): SessionLauncher[] {
  const parts = raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) throw new SmokeFailure(SMOKE_EXIT.usage, `${flag} needs at least one launcher`);
  const seen: SessionLauncher[] = [];
  for (const part of parts) {
    if (!LAUNCHERS.includes(part as SessionLauncher)) {
      throw new SmokeFailure(SMOKE_EXIT.usage, `${flag}: unknown launcher ${part}`);
    }
    if (!seen.includes(part as SessionLauncher)) seen.push(part as SessionLauncher);
  }
  return seen;
}

/**
 * `env` supplies the fixture-minted principal the lifecycle hands over (see `p3LoopbackTls.ts`): the
 * token cannot be written on the command line because it does not exist until the fixture starts.
 * ARGV WINS over the environment wherever both are present, and a run with neither is refused — the
 * client never invents, derives, or defaults a principal.
 */
export function parseP3RealPtySmokeArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): P3RealPtySmokeArgs {
  let origin: string | null = null;
  let sessionToken: string | null = null;
  let contextPath: string | null = null;
  let interactive: SessionLauncher[] = ['shell'];
  let headless: SessionLauncher[] = [];
  let cycle: SmokeCycleStep[] = [...SMOKE_CYCLE_STEPS];
  let roundtripCurrentRecipes = false;
  let failIfUnavailable = false;
  let timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const takeValue = (): string => {
      if (value === undefined || value.startsWith('--')) {
        throw new SmokeFailure(SMOKE_EXIT.usage, `${flag} needs a value`);
      }
      index += 1;
      return value;
    };
    switch (flag) {
      case '--origin': origin = takeValue(); break;
      case '--session-token': sessionToken = takeValue(); break;
      case '--context-path': contextPath = takeValue(); break;
      case '--interactive': interactive = parseLauncherList('--interactive', takeValue()); break;
      case '--headless': headless = parseLauncherList('--headless', takeValue()); break;
      case '--timeout-ms': timeoutMs = Number.parseInt(takeValue(), 10); break;
      case '--roundtrip-current-recipes': roundtripCurrentRecipes = true; break;
      case '--fail-if-unavailable': failIfUnavailable = true; break;
      case '--cycle': {
        const raw = takeValue().split(',').map((part) => part.trim()).filter((part) => part.length > 0);
        if (raw.length === 0) throw new SmokeFailure(SMOKE_EXIT.usage, '--cycle needs at least one step');
        for (const step of raw) {
          if (!SMOKE_CYCLE_STEPS.includes(step as SmokeCycleStep)) {
            throw new SmokeFailure(SMOKE_EXIT.usage, `--cycle: unknown step ${step}`);
          }
        }
        cycle = raw as SmokeCycleStep[];
        break;
      }
      default:
        throw new SmokeFailure(SMOKE_EXIT.usage, `unknown flag ${flag}`);
    }
  }

  if (origin === null) throw new SmokeFailure(SMOKE_EXIT.usage, '--origin is required');
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new SmokeFailure(SMOKE_EXIT.usage, `--origin is not a URL: ${origin}`);
  }
  if (parsedOrigin.protocol !== 'https:' && parsedOrigin.protocol !== 'http:') {
    throw new SmokeFailure(SMOKE_EXIT.usage, `--origin must be http(s): ${origin}`);
  }
  const resolvedToken = sessionToken ?? env[P3_SESSION_TOKEN_ENV] ?? null;
  if (resolvedToken === null || resolvedToken.length === 0) {
    throw new SmokeFailure(
      SMOKE_EXIT.usage,
      `--session-token is required (or ${P3_SESSION_TOKEN_ENV} from the fixture lifecycle)`,
    );
  }
  const resolvedContextPath = contextPath ?? env[P3_CONTEXT_PATH_ENV] ?? '/fixture/context-a';
  if (!resolvedContextPath.startsWith('/')) {
    throw new SmokeFailure(SMOKE_EXIT.usage, '--context-path must be absolute');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new SmokeFailure(SMOKE_EXIT.usage, '--timeout-ms must be a positive integer');
  }

  return {
    origin: `${parsedOrigin.protocol}//${parsedOrigin.host}`,
    sessionToken: resolvedToken, contextPath: resolvedContextPath, interactive, headless, cycle,
    roundtripCurrentRecipes, failIfUnavailable, timeoutMs,
  };
}

/* ------------------------------------------------------------------------------------------------ *
 * Injected seams
 * ------------------------------------------------------------------------------------------------ */

export interface SmokeHttpResponse {
  status: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: string;
}

export type SmokeHttpRequest = (input: {
  method: string;
  url: string;
  headers: Readonly<Record<string, string>>;
}) => Promise<SmokeHttpResponse>;

export type SmokeSocketConnect = (input: {
  url: string;
  cookie: string;
  sessionToken: string;
  timeoutMs: number;
}) => Promise<RawWebSocket>;

export interface P3RealPtySmokeDeps {
  http?: SmokeHttpRequest;
  connect?: SmokeSocketConnect;
  log?: (line: string) => void;
  newRequestId?: () => string;
}

/** HTTP(S) with the fixture's certificate pinned. Verification is never disabled. */
export const defaultSmokeHttpRequest: SmokeHttpRequest = (input) => {
  const target = new URL(input.url);
  const secure = target.protocol === 'https:';
  let ca: string | null = null;
  if (secure) {
    ca = readLoopbackCertificate(Number(target.port));
    if (ca === null) {
      return Promise.reject(new SmokeFailure(SMOKE_EXIT.protocol, `no pinned certificate for port ${target.port}`));
    }
  }
  const send = secure ? httpsRequest : httpRequest;
  return new Promise<SmokeHttpResponse>((resolve, reject) => {
    const call = send({
      protocol: target.protocol,
      host: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: input.method,
      headers: { ...input.headers },
      ...(ca === null ? {} : { ca }),
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    call.on('error', (error: Error) => reject(new SmokeFailure(SMOKE_EXIT.protocol, error.message)));
    call.end();
  });
};

export const defaultSmokeSocketConnect: SmokeSocketConnect = (input) => openRawWebSocket({
  url: input.url,
  headers: { cookie: input.cookie },
  // The bearer token rides the subprotocol list, exactly as the browser client sends it — never the URL.
  subprotocols: ['kb-pty.v1', input.sessionToken],
  handshakeTimeoutMs: input.timeoutMs,
});

/* ------------------------------------------------------------------------------------------------ *
 * The cycle
 * ------------------------------------------------------------------------------------------------ */

export interface SmokeLauncherReport {
  launcher: SessionLauncher;
  sessionId: string;
  liveBytes: number;
  replayBytes: number;
  /** `bulk-reattach`: bytes the session produced in total, and bytes the tail replay returned. */
  bulkLiveBytes: number | null;
  bulkReplayBytes: number | null;
  exit: PublicExit | null;
}

export interface SmokeReport {
  code: SmokeExitCode;
  message: string;
  launchers: SmokeLauncherReport[];
}

/* ------------------------------------------------------------------------------------------------ *
 * Offset-aligned transcript comparison
 * ------------------------------------------------------------------------------------------------ */

/** One `data` frame's payload, tagged with the byte offset the frame's `sequence` named (W0 #3). */
export interface TranscriptSpan {
  readonly offset: number;
  readonly bytes: Buffer;
}

export type TranscriptComparison =
  | { readonly ok: true; readonly firstLiveOffset: number; readonly comparedBytes: number; readonly replayedBeforeLive: number }
  | { readonly ok: false; readonly reason: string };

/** The bytes of `spans`, in order. Only a LENGTH or a substring search may use this — never an offset. */
export function foldSpans(spans: readonly TranscriptSpan[]): Buffer {
  return Buffer.concat(spans.map((span) => span.bytes));
}

/** `[first offset, end offset)` of a contiguous run, or `null` for no spans. */
export function spanRange(spans: readonly TranscriptSpan[]): { start: number; end: number } | null {
  if (spans.length === 0) return null;
  const last = spans[spans.length - 1];
  return { start: spans[0].offset, end: last.offset + last.bytes.byteLength };
}

/** The first offset at which the run is not contiguous, or `null` when it is. */
function firstGap(spans: readonly TranscriptSpan[]): number | null {
  let expected: number | null = null;
  for (const span of spans) {
    if (expected !== null && span.offset !== expected) return expected;
    expected = span.offset + span.bytes.byteLength;
  }
  return null;
}

/**
 * Compare a replay against what the client actually saw live, ALIGNED BY BYTE OFFSET.
 *
 * A real host writes before the client attaches — cmd.exe prints its banner between `create` and the
 * first data frame — so a `fromSequence: 0` replay legitimately carries MORE bytes than the live view:
 * it starts at offset 0 while the live view starts mid-stream. Those earlier bytes are the replay being
 * correct, not a mismatch, so the comparison is over the OVERLAP only: the replayed bytes in
 * `[firstLiveOffset, lastLiveOffset + len)` against the live bytes at the same offsets. Everything the
 * step is for still fails: a replay that does not reach the live range, a hole in either run, and any
 * differing byte inside the overlap.
 */
export function compareReplayToLive(
  live: readonly TranscriptSpan[],
  replay: readonly TranscriptSpan[],
): TranscriptComparison {
  const liveRange = spanRange(live);
  if (liveRange === null) return { ok: false, reason: 'no live bytes were observed to compare a replay against' };
  const replayRange = spanRange(replay);
  if (replayRange === null) return { ok: false, reason: `replay delivered no bytes for live [${liveRange.start}, ${liveRange.end})` };

  const liveGap = firstGap(live);
  if (liveGap !== null) return { ok: false, reason: `live transcript has a gap at offset ${liveGap}` };
  const replayGap = firstGap(replay);
  if (replayGap !== null) return { ok: false, reason: `replay has a gap at offset ${replayGap}` };

  if (replayRange.start > liveRange.start || replayRange.end < liveRange.end) {
    return {
      ok: false,
      reason: `replay [${replayRange.start}, ${replayRange.end}) does not cover the live range `
        + `[${liveRange.start}, ${liveRange.end})`,
    };
  }

  const liveFold = foldSpans(live);
  const replayFold = foldSpans(replay);
  const overlap = replayFold.subarray(liveRange.start - replayRange.start, liveRange.end - replayRange.start);
  if (!overlap.equals(liveFold)) {
    let at = 0;
    while (at < liveFold.byteLength && overlap[at] === liveFold[at]) at += 1;
    return {
      ok: false,
      reason: `replay differs from the live bytes at offset ${liveRange.start + at} `
        + `(live ${liveFold.byteLength} bytes from ${liveRange.start}, replay ${replayFold.byteLength} bytes from ${replayRange.start})`,
    };
  }
  return {
    ok: true,
    firstLiveOffset: liveRange.start,
    comparedBytes: liveFold.byteLength,
    replayedBeforeLive: liveRange.start - replayRange.start,
  };
}

function jsonOf(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new SmokeFailure(SMOKE_EXIT.protocol, 'response body is not JSON');
  }
}

/** Await the next frame this client understands, refusing anything the decoder rejects. */
async function nextFrame(socket: RawWebSocket, timeoutMs: number): Promise<BrowserServerFrame> {
  const raw = await socket.next(timeoutMs);
  const frame = decodeBrowserServerFrame(raw);
  if (frame === null) throw new SmokeFailure(SMOKE_EXIT.protocol, `undecodable server frame: ${raw.slice(0, 120)}`);
  if (frame.type === 'error') {
    throw new SmokeFailure(SMOKE_EXIT.mismatch, `server refused with ${frame.code}: ${frame.detail ?? ''}`);
  }
  return frame;
}

/**
 * Await the first frame of a given type ANSWERING `requestId`, folding any `data` frames seen on the way
 * into `sink`. Matching on the request id matters: acks for earlier steps are still in flight when a
 * later step starts, and a runner that took "the next ack" would happily read an `input` ack as proof
 * that `detach` succeeded.
 */
async function awaitFrame<T extends BrowserServerFrame['type']>(
  socket: RawWebSocket,
  type: T,
  timeoutMs: number,
  sink: TranscriptSpan[] | null,
  requestId: string | null = null,
): Promise<Extract<BrowserServerFrame, { type: T }>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SmokeFailure(SMOKE_EXIT.timeout, `no ${type} frame within ${timeoutMs} ms`);
    const frame = await nextFrame(socket, remaining);
    if (frame.type === 'data' && sink !== null) {
      sink.push({ offset: frame.sequence, bytes: Buffer.from(frame.data, 'base64') });
    }
    if (frame.type !== type) continue;
    if (requestId !== null && frame.requestId !== requestId) continue;
    return frame as Extract<BrowserServerFrame, { type: T }>;
  }
}

export async function runP3RealPtySmoke(
  args: P3RealPtySmokeArgs,
  deps: P3RealPtySmokeDeps = {},
): Promise<SmokeReport> {
  const http = deps.http ?? defaultSmokeHttpRequest;
  const connect = deps.connect ?? defaultSmokeSocketConnect;
  const log = deps.log ?? (() => {});
  const nextRequestId = deps.newRequestId ?? (() => randomUUID());
  const bearer = { authorization: `Bearer ${args.sessionToken}`, accept: 'application/json' };
  const launchers: SmokeLauncherReport[] = [];

  // 1. Capability. `--fail-if-unavailable` turns a closed PTY into a mismatch instead of a quiet pass,
  //    because the whole point of the section 7 command is that the real host answered.
  const capabilityResponse = await http({
    method: 'GET', url: `${args.origin}/api/runtime/capabilities`, headers: bearer,
  });
  if (capabilityResponse.status !== 200) {
    throw new SmokeFailure(SMOKE_EXIT.mismatch, `capabilities answered ${capabilityResponse.status}`);
  }
  const capability = jsonOf(capabilityResponse.body);
  if (!isRecord(capability) || typeof capability.pty !== 'boolean') {
    throw new SmokeFailure(SMOKE_EXIT.protocol, 'capability payload is not the closed public shape');
  }
  if (capability.pty !== true) {
    if (args.failIfUnavailable) throw new SmokeFailure(SMOKE_EXIT.mismatch, 'fixture reports pty:false');
    log('pty is unavailable; nothing to smoke');
    return { code: SMOKE_EXIT.ok, message: 'pty:false, no cycle requested', launchers };
  }
  const advertised = Array.isArray(capability.launchers)
    ? capability.launchers.filter((entry): entry is SessionLauncher => LAUNCHERS.includes(entry as SessionLauncher))
    : null;
  if (advertised === null) throw new SmokeFailure(SMOKE_EXIT.protocol, 'capability launchers are not a list');
  if (args.roundtripCurrentRecipes) {
    // The v2 browser frame carries no mode, so `--headless` cannot be *driven* from this route; what it
    // can be is CHECKED — every launcher the run names must be one the live capability advertises, and
    // the capability must name nothing the run does not.
    const requested = [...new Set([...args.interactive, ...args.headless])].sort();
    const found = [...new Set(advertised)].sort();
    if (requested.join(',') !== found.join(',')) {
      throw new SmokeFailure(
        SMOKE_EXIT.mismatch,
        `recipe roundtrip: requested ${requested.join(',')} but capability advertises ${found.join(',')}`,
      );
    }
  }
  for (const launcher of [...args.interactive, ...args.headless]) {
    if (!advertised.includes(launcher)) {
      throw new SmokeFailure(SMOKE_EXIT.mismatch, `capability does not advertise ${launcher}`);
    }
  }

  // 2. The browser-session cookie, taken from the fixture's own context entry point. This client never
  //    composes a ref of its own: it asks for the context and keeps whatever cookie was set.
  const contextResponse = await http({ method: 'GET', url: `${args.origin}${args.contextPath}`, headers: {} });
  const rawCookie = contextResponse.headers['set-cookie'];
  const cookieHeader = (Array.isArray(rawCookie) ? rawCookie : rawCookie === undefined ? [] : [rawCookie])
    .map((entry) => entry.split(';')[0])
    .join('; ');
  if (cookieHeader.length === 0) {
    throw new SmokeFailure(SMOKE_EXIT.mismatch, `${args.contextPath} set no browser-session cookie`);
  }

  // Both halves of the principal, for every REST call after this point: the PTY surface refuses a
  // bearer-only caller with 428, exactly as it refuses one on the socket.
  const authorized = { ...bearer, cookie: cookieHeader };

  const wsUrl = `${args.origin.replace(/^http/, 'ws')}/api/pty`;
  const steps = new Set(args.cycle);

  for (const launcher of args.interactive) {
    const socket = await connect({
      url: wsUrl, cookie: cookieHeader, sessionToken: args.sessionToken, timeoutMs: args.timeoutMs,
    });
    const live: TranscriptSpan[] = [];
    let sessionId = '';
    let attachmentId = '';
    let exit: PublicExit | null = null;
    try {
      if (steps.has('create')) {
        const createId = nextRequestId();
        const create: BrowserClientFrame = {
          type: 'create', requestId: createId, launcher,
          rootId: 'repo', relativeCwd: '', cols: 80, rows: 24,
        };
        socket.send(JSON.stringify(create));
        const created = await awaitFrame(socket, 'created', args.timeoutMs, live, createId);
        sessionId = created.session.sessionId;
        attachmentId = created.attachmentId;
      }

      if (steps.has('list')) {
        const listed = await http({ method: 'GET', url: `${args.origin}/api/pty/sessions`, headers: authorized });
        if (listed.status !== 200) throw new SmokeFailure(SMOKE_EXIT.mismatch, `list answered ${listed.status}`);
        const body = jsonOf(listed.body);
        if (!isRecord(body) || typeof body.revision !== 'number' || !Array.isArray(body.sessions)) {
          throw new SmokeFailure(SMOKE_EXIT.protocol, 'session listing is not the closed shape');
        }
        for (const row of body.sessions) {
          if (!isSessionSummaryShape(row)) throw new SmokeFailure(SMOKE_EXIT.protocol, 'listing row is undecodable');
        }
        if (!body.sessions.some((row) => isSessionSummaryShape(row) && row.sessionId === sessionId)) {
          throw new SmokeFailure(SMOKE_EXIT.mismatch, `listing omits ${sessionId}`);
        }
      }

      if (steps.has('write')) {
        const input: BrowserClientFrame = {
          type: 'input', requestId: nextRequestId(), sessionId, attachmentId,
          encoding: 'base64', data: Buffer.from(SMOKE_INPUT, 'utf8').toString('base64'),
        };
        socket.send(JSON.stringify(input));
        // Bounded wait for the host's echo. Data frames arrive interleaved with the ack, so the fold is
        // filled by the same loop that watches for the mark.
        const deadline = Date.now() + args.timeoutMs;
        while (!foldSpans(live).toString('utf8').includes(SMOKE_ECHO_MARK)) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            throw new SmokeFailure(SMOKE_EXIT.timeout, `echo of ${SMOKE_ECHO_MARK} did not arrive in ${args.timeoutMs} ms`);
          }
          const frame = await nextFrame(socket, remaining);
          if (frame.type === 'data') live.push({ offset: frame.sequence, bytes: Buffer.from(frame.data, 'base64') });
        }
      }

      if (steps.has('detach')) {
        const detachId = nextRequestId();
        const detach: BrowserClientFrame = { type: 'detach', requestId: detachId, sessionId, attachmentId };
        socket.send(JSON.stringify(detach));
        const detached = await awaitFrame(socket, 'ack', args.timeoutMs, live, detachId);
        if (detached.action !== 'detach') {
          throw new SmokeFailure(SMOKE_EXIT.mismatch, `expected a detach ack, got ${detached.action}`);
        }
      }

      const replay: TranscriptSpan[] = [];
      if (steps.has('reattach')) {
        const attachId = nextRequestId();
        const attach: BrowserClientFrame = {
          type: 'attach', requestId: attachId, sessionId, fromSequence: 0,
        };
        socket.send(JSON.stringify(attach));
        const attached = await awaitFrame(socket, 'attached', args.timeoutMs, null, attachId);
        attachmentId = attached.attachmentId;
        // Replay is bounded by the sequence the server itself named; a server that never reaches it
        // fails as a timeout rather than looping.
        // The cursor is a BYTE OFFSET ([C-R6]): a frame advances it by the bytes it carried, and the
        // replay is done when it reaches the `nextSequence` the server itself named.
        const deadline = Date.now() + args.timeoutMs;
        let seen = attached.replayFrom;
        while (seen < attached.nextSequence) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new SmokeFailure(SMOKE_EXIT.timeout, 'replay did not complete');
          const frame = await nextFrame(socket, remaining);
          if (frame.type !== 'data') continue;
          if (!frame.replay) throw new SmokeFailure(SMOKE_EXIT.mismatch, 'reattach delivered a non-replay frame');
          const bytes = Buffer.from(frame.data, 'base64');
          if (frame.sequence !== seen) {
            throw new SmokeFailure(SMOKE_EXIT.mismatch, `replay frame at ${frame.sequence} does not continue ${seen}`);
          }
          replay.push({ offset: frame.sequence, bytes });
          seen = frame.sequence + bytes.byteLength;
        }
      }

      if (steps.has('compare-transcript')) {
        // Offset-aligned, NOT length-equal: a real cmd.exe writes its banner between `create` and this
        // client's first data frame, so the live view starts mid-stream while a `fromSequence: 0` replay
        // starts at 0. Those earlier replayed bytes are the server being right. See `compareReplayToLive`.
        const comparison = compareReplayToLive(live, replay);
        if (!comparison.ok) throw new SmokeFailure(SMOKE_EXIT.mismatch, comparison.reason);
      }

      // The step [C-R6] exists for: drive the session PAST the 64 KiB window, reattach, and prove the
      // replayed bytes are the live TAIL — same bytes, same offsets. A frame-counter cursor cannot pass
      // this; neither can a reader that serves the oldest window instead of the newest.
      let bulkLiveBytes: number | null = null;
      let bulkReplayBytes: number | null = null;
      if (steps.has('bulk-reattach')) {
        const before = foldSpans(live).byteLength;
        for (let round = 0; foldSpans(live).byteLength - before < SMOKE_BULK_TARGET_BYTES; round += 1) {
          if (round > 400) throw new SmokeFailure(SMOKE_EXIT.mismatch, 'bulk output never reached the replay window');
          const grown = foldSpans(live).byteLength;
          socket.send(JSON.stringify({
            type: 'input', requestId: nextRequestId(), sessionId, attachmentId,
            encoding: 'base64', data: Buffer.from(SMOKE_BULK_LINE, 'utf8').toString('base64'),
          } satisfies BrowserClientFrame));
          // Each line is echoed as typed and printed by the shell, so ~900 new bytes per round is the
          // floor. Waiting on GROWTH keeps this shell-agnostic — no prompt, wrap, or CRLF assumptions.
          const deadline = Date.now() + args.timeoutMs;
          while (foldSpans(live).byteLength - grown < 900) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new SmokeFailure(SMOKE_EXIT.timeout, 'bulk echo did not arrive');
            const frame = await nextFrame(socket, remaining);
            if (frame.type === 'data') live.push({ offset: frame.sequence, bytes: Buffer.from(frame.data, 'base64') });
          }
        }
        // Quiesce: the tail comparison is only honest once the host has stopped producing.
        for (;;) {
          try {
            const frame = await nextFrame(socket, 750);
            if (frame.type === 'data') live.push({ offset: frame.sequence, bytes: Buffer.from(frame.data, 'base64') });
          } catch (error) {
            if (error instanceof SmokeFailure && error.code === SMOKE_EXIT.timeout) break;
            throw error;
          }
        }

        const detachId = nextRequestId();
        socket.send(JSON.stringify({
          type: 'detach', requestId: detachId, sessionId, attachmentId,
        } satisfies BrowserClientFrame));
        await awaitFrame(socket, 'ack', args.timeoutMs, live, detachId);

        const attachId = nextRequestId();
        socket.send(JSON.stringify({
          type: 'attach', requestId: attachId, sessionId, fromSequence: 0,
        } satisfies BrowserClientFrame));
        const attached = await awaitFrame(socket, 'attached', args.timeoutMs, null, attachId);
        const liveFold = foldSpans(live);
        // The cursor is compared against the live END OFFSET, not the live byte COUNT: bytes the host
        // wrote before this client attached are in the server's transcript and not in `live`.
        const liveSpan = spanRange(live);
        if (liveSpan === null) throw new SmokeFailure(SMOKE_EXIT.mismatch, 'no live bytes were observed');
        if (attached.nextSequence !== liveSpan.end) {
          throw new SmokeFailure(
            SMOKE_EXIT.mismatch,
            `server cursor ${attached.nextSequence} does not match the live end offset ${liveSpan.end}`
              + ` (${liveFold.byteLength} bytes observed live from ${liveSpan.start})`,
          );
        }
        if (attached.replayFrom <= 0) {
          throw new SmokeFailure(SMOKE_EXIT.mismatch, 'a transcript past the window still claims a complete replay');
        }
        const tail: Buffer[] = [];
        const deadline = Date.now() + args.timeoutMs;
        let seen = attached.replayFrom;
        while (seen < attached.nextSequence) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new SmokeFailure(SMOKE_EXIT.timeout, 'tail replay did not complete');
          const frame = await nextFrame(socket, remaining);
          if (frame.type !== 'data') continue;
          if (!frame.replay) throw new SmokeFailure(SMOKE_EXIT.mismatch, 'tail reattach delivered a non-replay frame');
          if (frame.sequence !== seen) {
            throw new SmokeFailure(SMOKE_EXIT.mismatch, `tail frame at ${frame.sequence} does not continue ${seen}`);
          }
          const bytes = Buffer.from(frame.data, 'base64');
          tail.push(bytes);
          seen = frame.sequence + bytes.byteLength;
        }
        const tailFold = Buffer.concat(tail);
        if (tailFold.byteLength === 0 || tailFold.byteLength > 65_536) {
          throw new SmokeFailure(SMOKE_EXIT.mismatch, `tail replay returned ${tailFold.byteLength} bytes`);
        }
        // `replayFrom` is an ABSOLUTE offset; `liveFold` starts at `liveSpan.start`, so the live tail is
        // taken relative to that, not from index `replayFrom`.
        if (!liveFold.subarray(attached.replayFrom - liveSpan.start).equals(tailFold)) {
          throw new SmokeFailure(
            SMOKE_EXIT.mismatch,
            `tail replay is not the live tail: ${liveFold.byteLength} live vs ${tailFold.byteLength} replayed from ${attached.replayFrom}`,
          );
        }
        bulkLiveBytes = liveFold.byteLength;
        bulkReplayBytes = tailFold.byteLength;
        attachmentId = attached.attachmentId;
      }

      if (steps.has('close')) {
        const closeId = nextRequestId();
        const close: BrowserClientFrame = { type: 'close', requestId: closeId, sessionId };
        socket.send(JSON.stringify(close));
        const ack = await awaitFrame(socket, 'ack', args.timeoutMs, null, closeId);
        if (ack.action !== 'close') throw new SmokeFailure(SMOKE_EXIT.mismatch, `expected a close ack, got ${ack.action}`);
        exit = ack.exit;
      }

      launchers.push({
        launcher, sessionId,
        liveBytes: foldSpans(live).length,
        replayBytes: foldSpans(replay).length,
        bulkLiveBytes,
        bulkReplayBytes,
        exit,
      });
      log(`[p3-smoke] ${launcher} ${sessionId} ok live=${foldSpans(live).length}`
        + ` replay=${foldSpans(replay).length}`
        + `${bulkLiveBytes === null ? '' : ` bulkLive=${bulkLiveBytes} bulkTailReplay=${bulkReplayBytes}`}`);
    } finally {
      socket.close();
    }
  }

  return { code: SMOKE_EXIT.ok, message: `smoked ${launchers.length} launcher(s)`, launchers };
}

/** Never throws: every failure is turned into its exit code, which is the command's contract. */
export async function mainP3RealPtySmoke(
  argv: readonly string[],
  deps: P3RealPtySmokeDeps = {},
): Promise<SmokeExitCode> {
  const log = deps.log ?? (() => {});
  try {
    const args = parseP3RealPtySmokeArgs(argv);
    const report = await runP3RealPtySmoke(args, deps);
    log(`[p3-smoke] ${report.message}`);
    return report.code;
  } catch (error) {
    if (error instanceof SmokeFailure) {
      log(`[p3-smoke] ${error.message}`);
      return error.code;
    }
    log(`[p3-smoke] ${error instanceof Error ? error.message : String(error)}`);
    return SMOKE_EXIT.protocol;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void mainP3RealPtySmoke(process.argv.slice(2), { log: (line) => process.stderr.write(`${line}\n`) })
    .then((code) => { process.exitCode = code; });
}
