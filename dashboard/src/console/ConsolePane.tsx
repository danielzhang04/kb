/**
 * `<ConsolePane>` — ONE live shell, rendered anywhere.
 *
 * This is the pane that used to be `TerminalTab` inside `views/Terminal.tsx`, extracted verbatim in
 * behaviour so that the Terminal view is now a pure TAB MANAGER over it and other surfaces (an agent's
 * detail, a workflow's detail) can embed the same console without forking a second xterm/socket stack.
 *
 * What it owns: the lazy xterm + fit-addon construction, the `/api/pty` WebSocket, the control-frame
 * protocol (`{type:'error'}` / `{type:'session'}`), the keystroke pump, the fit/resize chain, the
 * imperative close control, and the connection-state rendering. What it does NOT own: tabs, caps,
 * persistence, page chrome, or any policy about WHEN a console should exist — all of that stays with
 * whoever renders it.
 *
 * ── The one invariant this file exists to hold: A REMOUNT MUST NOT RESPAWN ──
 *
 * `TerminalTab` keyed its connection effect on the `spawn` OBJECT and on every callback prop, which was
 * safe only because the tab manager happened to hand it state-held objects and `useCallback` sinks. An
 * EMBEDDED console is rendered with inline literals (`{ mode:'spawn', spawn:{ mode:'agent', agentId } }`)
 * and inline arrow callbacks — under the old deps that is a fresh identity every render, so every parent
 * re-render would tear down the socket and SPAWN ANOTHER SHELL, leaking shells into the daemon's 8-session
 * cap. So here the connection effect keys on a derived STRING ({@link consoleTargetKey}) and reads the
 * live target and callbacks out of refs. Identity churn in props is now structurally incapable of
 * reconnecting; only a genuine change of target can.
 *
 * ── Hiding is by `display`, deliberately ──
 *
 * `fitAndResize` no-ops when `host.offsetParent === null`, which is how it detects "I am hidden and my
 * dimensions are a lie". That test only works for `display:none` hiding — a `visibility:hidden` or
 * `opacity:0` pane still has an offsetParent and would be fitted against a stale box. `.console-pane`
 * therefore hides with `display:none`; do not change it to any other hiding mechanism.
 *
 * Protocol (unchanged, do not touch): SERVER→BROWSER is raw PTY output as text frames (write straight to
 * xterm) plus occasional `{"type":"error","reason":"…"}` / `{"type":"session","sessionId":"…"}` JSON;
 * BROWSER→SERVER is raw keystrokes as text plus `{"type":"resize",…}` / `{"type":"close"}` JSON.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import '../styles/console.css';
import { useOptionalSession } from '../lib/sessionContext';
import { defaultPtySocketFactory, defaultTerminalSessionsClient, ptyQuery } from '../lib/terminalClient';
import type { PtySocketFactory, PtySpawnTarget, TerminalSessionsClient } from '../lib/terminalClient';

/**
 * xterm theme mapped ENTIRELY onto the house near-black palette (app.css tokens, resolved to literals
 * because xterm needs concrete colours, not CSS vars). Every ANSI slot is a warm neutral — there is no
 * terminal-green, no pure black, and no decorative accent. The cursor is a plain warm off-white.
 */
export const HOUSE_XTERM_THEME = {
  background: '#1c1b19', // --bg-sunken (deepest)
  foreground: '#f5f4ef', // --fg-primary
  cursor: '#b8b5ad', // --fg-dim — a neutral cursor, never a bright accent
  cursorAccent: '#1c1b19',
  selectionBackground: 'rgba(245, 244, 239, 0.14)', // neutral wash, not a colour
  black: '#262624',
  red: '#e0554a', // --error (semantic, kept)
  green: '#5cae7e', // --success (semantic — NOT the classic terminal green default)
  yellow: '#e0a040', // --warning
  blue: '#b8b5ad', // neutralised — no blue chrome
  magenta: '#b8b5ad',
  cyan: '#b8b5ad',
  white: '#f5f4ef',
  brightBlack: '#82807a', // --fg-faint
  brightRed: '#e0554a',
  brightGreen: '#5cae7e',
  brightYellow: '#e0a040',
  brightBlue: '#d8d5cd',
  brightMagenta: '#d8d5cd',
  brightCyan: '#d8d5cd',
  brightWhite: '#ffffff',
} as const;

/**
 * WHAT this console connects to — a discriminated union, so the two entry shapes cannot be combined.
 *
 * The old prop pair (`attachSessionId?` + `spawn?`) let a caller pass both, and `ptyQuery` silently
 * dropped the spawn because an attach wins server-side. "Silently ignored" is exactly the class of bug
 * this leg is removing: a caller either reattaches to a shell that exists, or opens one.
 *
 * `spawn` is optional WITHIN the spawn variant because the login shell is the absence of a spawn
 * request on the wire (`?` with no parameters) — the server's grammar has no `shell` mode to name, and
 * inventing one client-side would be a second, lying source of truth.
 */
export type ConsoleTarget =
  | { mode: 'spawn'; spawn?: PtySpawnTarget }
  | { mode: 'attach'; sessionId: string };

/** Per-console connection state. Streaming-only — there is no passkey handshake in this path. */
export type ConsoleConnState = 'connecting' | 'connected' | 'closed' | 'error';

/** A parsed server control frame, or `null` for ordinary raw PTY output. */
type PtyControlFrame = { type: 'error'; reason: string } | { type: 'session'; sessionId: string };

/**
 * Detect a server control frame. Every non-control frame is raw PTY bytes destined for xterm. We only
 * treat a frame as control when it parses AND carries an exact known shape, so ordinary shell output
 * that merely starts with `{` still streams.
 */
export function parseControlFrame(raw: string): PtyControlFrame | null {
  if (raw.length === 0 || raw[0] !== '{') return null;
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; reason?: unknown; sessionId?: unknown } | null;
    if (parsed !== null && typeof parsed === 'object') {
      if (parsed.type === 'error' && typeof parsed.reason === 'string') {
        return { type: 'error', reason: parsed.reason };
      }
      if (parsed.type === 'session' && typeof parsed.sessionId === 'string') {
        return { type: 'session', sessionId: parsed.sessionId };
      }
    }
  } catch {
    /* not JSON → raw PTY bytes */
  }
  return null;
}

/**
 * The ONE value the connection effect keys on. Two targets with this same key are the same connection,
 * however many times their object literals are rebuilt. An attach and a spawn can never collide because
 * the prefixes differ, and two different spawn requests differ in their query.
 */
export function consoleTargetKey(target: ConsoleTarget): string {
  return target.mode === 'attach'
    ? `attach:${target.sessionId}`
    : `spawn:${ptyQuery(undefined, target.spawn)}`;
}

/** An imperative handle a host registers, so ITS close affordance can ask this console to tear down its
 *  own (persistent) shell — the pane is the only holder of the live socket + the confirmed session id. */
export interface ConsoleControl {
  requestClose(): void;
}

export interface ConsolePaneProps {
  /** What to connect to. See {@link ConsoleTarget}. */
  target: ConsoleTarget;
  /**
   * Whether this console is the visible one. Drives `display` (NOT unmounting — a hidden console keeps
   * its socket and its scrollback) and a re-fit when it becomes visible again.
   */
  visible: boolean;
  socketFactory?: PtySocketFactory;
  /** Persistence client; only its `remove` is used here, to kill a shell whose socket is already gone. */
  sessionsClient?: TerminalSessionsClient;
  /** The server's `{type:'session'}` bind frame — the confirmed id for this console. */
  onSession?: (sessionId: string) => void;
  /** The server shell ENDED (shell exit / operator close); the reason is the socket's close reason. */
  onExit?: (reason: string) => void;
  /** A server `{type:'error'}` frame (e.g. `too-many-terminals`). Also rendered in-pane. */
  onError?: (reason: string) => void;
  /** Publish/withdraw this console's imperative close control. */
  registerControl?: (control: ConsoleControl | null) => void;
  /** Appended to every `data-testid` here, so a manager can address one console among many. */
  testIdSuffix?: string;
  /** ARIA role for the pane element — `tabpanel` under a tablist, omitted when embedded in a section. */
  role?: string;
  ariaLabel?: string;
}

export function ConsolePane({
  target,
  visible,
  socketFactory = defaultPtySocketFactory,
  sessionsClient = defaultTerminalSessionsClient,
  onSession,
  onExit,
  onError,
  registerControl,
  testIdSuffix = '',
  role,
  ariaLabel,
}: ConsolePaneProps): React.JSX.Element {
  // The bearer comes from the app's ONE session, not a prop. Optional so an embedded console inside a
  // presentational surface rendered standalone degrades to "connects nothing" instead of throwing.
  const sessionToken = useOptionalSession()?.session?.token;
  const hostRef = useRef<HTMLDivElement>(null);
  // Live handles kept in refs so the resize/fit effects can reach them without re-running the mount effect.
  const xtermRef = useRef<{ cols: number; rows: number; write(d: string): void; dispose(): void } | null>(null);
  const fitRef = useRef<{ fit(): void } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  // The server-confirmed sessionId for THIS console (from the bind frame, or the id we attached to).
  const sessionIdRef = useRef<string | null>(target.mode === 'attach' ? target.sessionId : null);
  const [state, setState] = useState<ConsoleConnState>('connecting');
  const [errorReason, setErrorReason] = useState<string | null>(null);

  // Everything the connection effect must READ but must never RE-RUN for. See the header note: a caller
  // passing inline objects/arrows would otherwise reconnect — i.e. respawn — on every parent render.
  const targetRef = useRef(target);
  targetRef.current = target;
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const sessionsClientRef = useRef(sessionsClient);
  sessionsClientRef.current = sessionsClient;
  const registerControlRef = useRef(registerControl);
  registerControlRef.current = registerControl;

  const targetKey = consoleTargetKey(target);

  /**
   * Fit the terminal to its pane and relay the resulting geometry to the PTY. No-ops while hidden (a
   * `display:none` pane measures 0×0 and would corrupt the grid) — the `visible` effect below re-fits
   * the moment it comes back.
   */
  const fitAndResize = useCallback(() => {
    const host = hostRef.current;
    const fitAddon = fitRef.current;
    const xterm = xtermRef.current;
    const ws = socketRef.current;
    if (!host || !fitAddon || !xterm) return;
    if (host.offsetParent === null) return; // hidden pane — dimensions are unreliable
    try {
      fitAddon.fit();
    } catch {
      return; // fit can throw if the element was detached mid-teardown
    }
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: xterm.cols, rows: xterm.rows }));
    }
  }, []);

  // Connect: lazily create xterm + fit addon, open the socket, wire the streaming path. Runs once per
  // (token, target) — NOT per render. Cleanup closes the socket (which merely DETACHES the persistent
  // shell server-side; the shell keeps running) and disposes the terminal.
  useEffect(() => {
    // Never open a bare socket without a bearer (locked, or no session context at all).
    if (!sessionToken) return;
    const connectTarget = targetRef.current;
    const attachSessionId = connectTarget.mode === 'attach' ? connectTarget.sessionId : undefined;
    const spawn = connectTarget.mode === 'spawn' ? connectTarget.spawn : undefined;
    let disposed = false;
    setState('connecting');
    setErrorReason(null);
    sessionIdRef.current = attachSessionId ?? null;

    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !hostRef.current) return;

      const xterm = new XTerm({
        theme: HOUSE_XTERM_THEME,
        fontFamily: "ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, 'Liberation Mono', monospace",
        fontSize: 13,
        cursorBlink: true,
        cursorStyle: 'block',
        convertEol: true,
      });
      const fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);
      xterm.open(hostRef.current);
      xtermRef.current = xterm as unknown as typeof xtermRef.current;
      fitRef.current = fitAddon as unknown as typeof fitRef.current;
      fitAndResize(); // initial size (guarded no-op if this console mounts hidden)

      const ws = socketFactory(sessionToken, attachSessionId, spawn);
      socketRef.current = ws;
      ws.onopen = () => {
        if (disposed) return;
        setState('connected');
        fitAndResize(); // send the PTY its first real window size
      };
      ws.onmessage = (ev) => {
        if (disposed) return;
        const raw = typeof ev.data === 'string' ? ev.data : '';
        if (raw.length === 0) return;
        // Control path FIRST: server error/session frames are handled, never written to the grid.
        const frame = parseControlFrame(raw);
        if (frame) {
          if (frame.type === 'error') {
            setState('error');
            setErrorReason(frame.reason);
            onErrorRef.current?.(frame.reason);
          } else {
            sessionIdRef.current = frame.sessionId;
            onSessionRef.current?.(frame.sessionId);
          }
          return;
        }
        xterm.write(raw);
      };
      ws.onclose = (ev?: { reason?: string }) => {
        if (disposed) return;
        setState('closed');
        // A clean server-driven end (shell exited / operator close) is reported up; an UNEXPECTED
        // disconnect (daemon restart, code 1006 / no reason) is NOT — the console stays with its error
        // display, and the next reconcile decides whether its shell is really gone.
        const reason = ev?.reason ?? '';
        if (reason === 'shell exited' || reason === 'closed by operator') onExitRef.current?.(reason);
      };
      ws.onerror = () => !disposed && setState('error');
      // Keystrokes → the PTY stdin (raw text frames).
      xterm.onData((d: string) => {
        if (ws.readyState === ws.OPEN) ws.send(d);
      });
    })();

    return () => {
      disposed = true;
      try {
        // Closing the socket only DETACHES the persistent shell server-side — it keeps running. A console
        // truly being closed has already killed its shell via the close frame / REST DELETE.
        socketRef.current?.close();
      } catch {
        /* socket may not have opened */
      }
      xtermRef.current?.dispose();
      socketRef.current = null;
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [sessionToken, targetKey, socketFactory, fitAndResize]);

  // Publish an imperative close control: a graceful `{type:'close'}` when the socket is live (the server
  // kills + closes, and `onclose` reports the exit), else a REST DELETE for a session whose socket is
  // already gone.
  const requestClose = useCallback(() => {
    const ws = socketRef.current;
    const sessionId = sessionIdRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'close' }));
      } catch {
        onExitRef.current?.('closed by operator');
      }
      return;
    }
    if (sessionId && sessionToken) void sessionsClientRef.current.remove(sessionId, sessionToken);
    onExitRef.current?.('closed by operator');
  }, [sessionToken]);

  useEffect(() => {
    registerControlRef.current?.({ requestClose });
    return () => registerControlRef.current?.(null);
  }, [requestClose]);

  // Re-fit whenever this console becomes visible — a hidden pane could not be measured, so its grid may
  // be stale after a resize that happened while it was in the background.
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => fitAndResize());
    return () => cancelAnimationFrame(raf);
  }, [visible, fitAndResize]);

  // Reflow on container/window resize. The ResizeObserver catches panel/layout changes; the window
  // listener is belt-and-suspenders. Both funnel through the guarded `fitAndResize`.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fitAndResize());
    observer.observe(host);
    const onWindowResize = () => fitAndResize();
    window.addEventListener('resize', onWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [fitAndResize]);

  // One robustness refit once the web fonts have loaded. The first fit can run against fallback-font
  // metrics; when the mono face swaps in the cell size changes, which would otherwise leave the bottom
  // row clipped until the next resize. `document.fonts.ready` fires once; the guarded fit no-ops if hidden.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts?.ready) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) fitAndResize();
    });
    return () => {
      cancelled = true;
    };
  }, [fitAndResize]);

  return (
    <div
      className={`console-pane${visible ? ' console-pane--visible' : ''}`}
      role={role}
      aria-label={ariaLabel}
      aria-hidden={!visible}
      data-state={state}
      data-testid={`console-panel${testIdSuffix}`}
    >
      {errorReason ? (
        <p className="console-pane__error" role="status" data-testid={`console-panel-error${testIdSuffix}`}>
          Terminal error: {errorReason}
        </p>
      ) : null}
      {/* The `.console-pane__surface` is the visual well (border/rounding/overflow/sunken shadow); the
          inner zero-padding `.console-pane__screen` is what `xterm.open()` targets so FitAddon measures
          a true content box and the fitted row grid is never clipped by the well's padding + overflow. */}
      <div className="console-pane__surface" data-testid={`console-surface${testIdSuffix}`}>
        <div ref={hostRef} className="console-pane__screen" data-testid={`console-screen${testIdSuffix}`} />
      </div>
    </div>
  );
}
