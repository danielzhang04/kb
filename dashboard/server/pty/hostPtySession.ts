/**
 * D3.1h — the HOST-side streaming multiplexer for ONE authenticated PTY connection.
 *
 * By the time this runs, the pipe server (hostPipeServer.ts) has already: accepted the connection, read
 * the first `open` frame, impersonated the client and confirmed its SID == the authorized peer (Daniel),
 * and confirmed the per-boot token — i.e. BOTH cross-user factors passed. This module then owns the
 * PERSISTENT half: spawn the shell via the reused `createPtyHost().open`, stream its output to the daemon
 * as `data` frames, forward inbound `write`/`resize`/`stop`, and reap the session on exit or channel close.
 *
 * It is deliberately transport-agnostic — it speaks only `ControlFrame` over an injected `PtyFrameChannel`,
 * so the whole multiplex (incl. onExit reaping and STOP-driven teardown) is tested hermetically with a fake
 * channel + a fake `PtyHost`; no koffi, no real node-pty.
 *
 * FAIL-CLOSED / STOP supremacy: a per-open `isRunnable()` re-check (assertFleetRunnable) runs BEFORE the
 * spawn, so no NEW terminal opens under STOP / a set API key / a breached budget even between STOP-watcher
 * ticks (design §6 point 5b). A channel close or a `stop` frame kills the session's process group — no
 * orphaned shell survives a daemon disconnect or a fleet stop.
 */
import type { ControlFrame, InboundFrame, PtyFrameChannel } from './ptyProtocol.ts';
import type { HostOpenRequest, PtyHost } from './host.ts';

export interface HostSessionDeps {
  host: PtyHost;
  /** Per-open preamble re-check. `false` → refuse to spawn (fleet-frozen), open-nack + close. Injected so
   *  hostMain wires `assertFleetRunnable` and tests wire a toggle. */
  isRunnable: () => boolean;
}

/** Coerce a positive integer geometry field with a fallback (fail-safe, never NaN into node-pty). */
function posInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/**
 * Build a validated `HostOpenRequest` from the raw inbound `open` frame. Only geometry + cwd + correlation
 * id are honored (the host decides identity; the frame carries no spawn-as-user directive by construction).
 */
export function openRequestFromFrame(frame: InboundFrame, defaults: { cwd: string; cols: number; rows: number }): HostOpenRequest {
  return {
    requestId: typeof frame.requestId === 'string' ? frame.requestId : '',
    cols: posInt(frame.cols, defaults.cols),
    rows: posInt(frame.rows, defaults.rows),
    cwd: typeof frame.cwd === 'string' && frame.cwd.length > 0 ? frame.cwd : defaults.cwd,
  };
}

/**
 * Drive one authenticated PTY connection to completion. `open` was already read + authenticated by the pipe
 * server; this spawns the session and multiplexes the persistent stream. Returns immediately (event-driven);
 * teardown happens on PTY exit, a `stop` frame, or channel close.
 */
export function runHostSession(channel: PtyFrameChannel, open: HostOpenRequest, deps: HostSessionDeps): void {
  // Per-open STOP/preamble re-check — refuse to open a NEW terminal under a frozen/over-budget fleet.
  let runnable = false;
  try {
    runnable = deps.isRunnable();
  } catch {
    runnable = false; // a preamble runner that throws is treated as NOT runnable (fail-closed)
  }
  if (!runnable) {
    channel.sendFrame({ type: 'open-nack', error: 'fleet-frozen' });
    channel.close();
    return;
  }

  let session: ReturnType<PtyHost['open']>;
  try {
    session = deps.host.open(open);
  } catch (err) {
    channel.sendFrame({ type: 'open-nack', error: (err as Error).message });
    channel.close();
    return;
  }

  let torn = false;
  const teardown = (killSession: boolean): void => {
    if (torn) return;
    torn = true;
    if (killSession) {
      try {
        deps.host.stop(session.sessionId);
      } catch {
        /* best-effort reap */
      }
    }
    try {
      channel.close();
    } catch {
      /* idempotent */
    }
  };

  // PTY output → data frames. A self-exit sends `exit` then reaps its own tracking (host.ts already deletes
  // the session on exit; we still route stop() through teardown on the write/close paths).
  session.handle.onData((chunk: string) => {
    channel.sendFrame({ type: 'data', data: chunk });
  });
  session.handle.onExit((evt: { exitCode: number; signal?: number }) => {
    channel.sendFrame({ type: 'exit', code: evt.exitCode ?? null });
    // The shell already exited — no need to kill it again; just close the channel.
    teardown(false);
  });

  const ack: ControlFrame = { type: 'open-ack', sessionId: session.sessionId };
  channel.sendFrame(ack);

  channel.onFrame((frame: InboundFrame) => {
    if (torn) return;
    const t = frame.type;
    if (t === 'write' && typeof frame.data === 'string') {
      session.handle.write(frame.data);
    } else if (t === 'resize') {
      session.handle.resize(posInt(frame.cols, open.cols), posInt(frame.rows, open.rows));
    } else if (t === 'stop') {
      teardown(true); // daemon asked to stop → kill the process group
    }
    // Unknown control frames are ignored (forward-compatible); they can never be data (data is host→daemon).
  });

  // Channel EOF (daemon disconnected / pipe broke) → kill the session's process group (no orphan survives).
  channel.onClose(() => {
    teardown(true);
  });
}
