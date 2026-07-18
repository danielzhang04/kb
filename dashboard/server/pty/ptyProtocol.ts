/**
 * D3.1h — the PTY-host wire protocol: newline-delimited JSON frames over a duplex byte channel.
 *
 * Unlike the Broker's ONE-SHOT request/response socket, the PTY-host channel is PERSISTENT: after a
 * successful authenticated `open`, PTY IO is multiplexed both ways for the life of the terminal. The wire
 * format is deliberately the SAME newline-JSON convention the Broker uses (one JSON object per physical
 * line, `\n`-terminated), which composes cleanly with streaming because `JSON.stringify` escapes EVERY
 * embedded newline: a PTY output chunk that itself contains `\n`/`\r` is encoded as a single physical line
 * (its newlines become `\n` escapes inside the JSON string), so raw terminal output can never break the
 * framing. That property is what lets one line-parser demultiplex control frames and data chunks safely.
 *
 * The channel abstractions here are the seam between the PURE protocol logic (multiplexer + client adapter,
 * both hermetically tested with fakes) and the NATIVE koffi duplex (win32PtyApi.ts, integration-tested on a
 * real box). Neither the multiplexer nor the adapter ever touches koffi — they only speak `ControlFrame`.
 */

/** Every frame that crosses the daemon↔host channel. Direction is by `type`:
 *  daemon→host: open / write / resize / stop;  host→daemon: open-ack / open-nack / data / exit. */
export type ControlFrame =
  | { type: 'open'; token: string; requestId: string; cols: number; rows: number; cwd: string; sessionSubject: string }
  | { type: 'open-ack'; sessionId: string }
  | { type: 'open-nack'; error: string }
  | { type: 'data'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'write'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'stop' };

/** A parsed inbound frame — loosely typed; consumers narrow on `type` and validate fields fail-closed. */
export type InboundFrame = Record<string, unknown>;

/** Encode one frame as a single newline-terminated physical line. `JSON.stringify` escapes any embedded
 *  newline, so a `data` chunk full of raw terminal control characters is still exactly one line. */
export function encodeFrame(frame: ControlFrame): string {
  return JSON.stringify(frame) + '\n';
}

/** Default per-line ceiling (1 MiB) — a single control/data frame far exceeding this is a protocol fault;
 *  the parser fails closed rather than buffering unboundedly (slow-loris / memory-exhaustion defense). */
export const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

/**
 * Incremental line-JSON parser. Feed arbitrary byte-boundary text via `push`; get back every newly
 * COMPLETED frame (parsed). A partial trailing line is retained across pushes. THROWS (fail-closed) on a
 * line that exceeds `maxLineBytes` or on malformed JSON — the caller treats a throw as a fatal channel
 * fault and closes the connection (never silently drops or guesses).
 */
export class FrameParser {
  private buf = '';
  private readonly maxLine: number;

  constructor(maxLineBytes: number = DEFAULT_MAX_LINE_BYTES) {
    this.maxLine = maxLineBytes;
  }

  push(chunk: string): InboundFrame[] {
    this.buf += chunk;
    const out: InboundFrame[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (trimmed.length === 0) continue; // tolerate blank keep-alive lines
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error('malformed frame (invalid JSON line); fail-closed');
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('malformed frame (not a JSON object); fail-closed');
      }
      out.push(parsed as InboundFrame);
    }
    if (this.buf.length > this.maxLine) {
      throw new Error(`frame line exceeded ${this.maxLine} bytes without a newline; fail-closed`);
    }
    return out;
  }
}

/**
 * A connected duplex frame channel (async delivery). The NATIVE implementation is the koffi overlapped
 * pipe (win32PtyApi.ts); tests inject a fake. `sendFrame` is best-effort (a serialized overlapped write on
 * the native side); inbound frames arrive via `onFrame`; EOF/error arrives via `onClose`.
 */
export interface PtyFrameChannel {
  /** Write one frame. Returns false only if the channel is already known-closed (best-effort otherwise). */
  sendFrame(frame: ControlFrame): boolean;
  /** Register the inbound-frame handler. Frames buffered before this call are flushed to it in order. */
  onFrame(cb: (frame: InboundFrame) => void): void;
  /** Register the EOF/error handler (fired at most once). */
  onClose(cb: () => void): void;
  /** Close the channel (idempotent). */
  close(): void;
}

/** The SERVER (host) channel adds an ASYNC first-frame pull, used to read the initial `open` for the
 *  cross-user auth step BEFORE the persistent streaming multiplexer wires `onFrame`. */
export interface PtyServerChannel extends PtyFrameChannel {
  /** Await the next inbound frame, up to `timeoutMs`; resolves null on timeout / EOF / channel error. */
  nextFrame(timeoutMs: number): Promise<InboundFrame | null>;
}

/** The CLIENT (daemon) channel adds a SYNCHRONOUS request/response, because `HostConnection.requestOpen`
 *  is synchronous: send the `open` frame and block (bounded) for the single `open-ack`/`open-nack`. In
 *  production the host is a SEPARATE process, so this blocking read does not stall its event loop. */
export interface PtyClientChannel extends PtyFrameChannel {
  /** Send `frame`, block up to `timeoutMs` for one inbound frame, return it (null on timeout/EOF/error).
   *  Any frames that arrive before `onFrame` is later wired are buffered and replayed (no data lost). */
  requestSync(frame: ControlFrame, timeoutMs: number): InboundFrame | null;
}
