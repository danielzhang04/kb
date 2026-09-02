/**
 * `<ConsolePane>` — ONE v2 PTY session, rendered anywhere.
 *
 * The pane owns the lazy xterm + fit-addon construction, one {@link PtyConnection}, the typed frame
 * protocol, the keystroke pump, the fit/resize chain, the detach/close controls, the reconnect cursor,
 * and the closed diagnostics rendering. It owns no tabs, no persistence, no page chrome, and no policy
 * about WHEN a console should exist — the Terminal workspace and the Run view decide that.
 *
 * ── The protocol, in full ──────────────────────────────────────────────────────────────────────────
 *
 * There is no raw-string path in either direction. The socket URL carries no query; the FIRST frame is
 * `create` (launcher + registered root id + relative cwd + geometry) or `attach` (session id + the
 * cursor to resume from). Keystrokes are `input` frames carrying base64. Output arrives as `data`
 * frames whose `sequence` is a BYTE OFFSET ([C-R6]), so this pane's reconnect cursor is
 * `sequence + byteLength(data)`: a dropped socket keeps the scrollback and offers Reattach, which
 * re-opens and asks for exactly the bytes it has not seen. The server answers with the `replayFrom` it
 * could honour and the `nextSequence` to hold — and when it had to start later than the pane asked, the
 * pane writes {@link LOST_OUTPUT_NOTICE} rather than pretending the stream is continuous. Frames
 * flagged `replay: true` are scrollback, not live output.
 *
 * ── Read-only replay ───────────────────────────────────────────────────────────────────────────────
 *
 * A `replay` target attaches like any other reader but NEVER sends `input` or `resize`: stdin is
 * disabled on the grid, no keystroke handler is wired, and the pane says so out loud. Read-only here is
 * structural (no frame is constructible), not a disabled button.
 *
 * ── Hiding is by `display`, deliberately ───────────────────────────────────────────────────────────
 *
 * `fitAndResize` no-ops when `host.offsetParent === null`, which is how it detects "I am hidden and my
 * dimensions are a lie". That test only works for `display:none` hiding — a `visibility:hidden` or
 * `opacity:0` pane still has an offsetParent and would be fitted against a stale box. `.console-pane`
 * therefore hides with `display:none`; do not change it to any other hiding mechanism.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import '../styles/console.css';
import { useOptionalSession } from '../lib/sessionContext';
import {
  browserSessionMessage,
  ensureBrowserSession as defaultEnsureBrowserSession,
} from '../lib/browserSessionClient';
import type { BrowserSessionOutcome } from '../lib/browserSessionClient';
import {
  attachFrame,
  closeFrame,
  createFrame,
  decodeOutput,
  defaultPtySocketFactory,
  defaultTerminalSessionsClient,
  detachFrame,
  inputFrame,
  openPtyConnection,
  outputByteLength,
  refusalMessage,
  resizeFrame,
} from '../lib/terminalClient';
import type {
  PtyConnection,
  PtyConnectionClosure,
  PtySocketFactory,
  TerminalSessionsClient,
} from '../lib/terminalClient';
import type {
  BrowserServerFrame,
  SafeRootId,
  SessionLauncher,
  SessionSummary,
} from '../../shared/ptyProtocol.ts';

/**
 * The one line the grid ever writes on its own behalf. A reattach whose scrollback starts later than
 * the pane's cursor has a hole in it; the operator is told in plain words instead of reading a seam
 * that looks like output. No numbers, no cursor, no byte counts — none of that is theirs to reconcile.
 */
export const LOST_OUTPUT_NOTICE = 'Earlier output was not kept.';

/** One sentence per member of the closed close-reason set. A shed reader must not read "still running". */
export function closureMessage(closure: PtyConnectionClosure): string {
  switch (closure) {
    case 'backpressure': return 'Disconnected \u2014 output outpaced this connection. Reattach to continue.';
    case 'tooLarge': return 'Disconnected \u2014 a message was too large to send. Reattach to continue.';
    case 'policy': return 'Disconnected \u2014 this connection was refused. Reattach to continue.';
    case 'error': return 'Disconnected \u2014 the connection failed. Reattach to continue.';
    default: return 'Disconnected. The session is still running.';
  }
}

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
 * WHAT this console connects to. `create` mints a session (the registry names it and mints its id);
 * `attach` resumes an existing one with control; `replay` resumes one read-only. The three are a closed
 * union so "attach AND spawn" — the old silently-dropped combination — is not expressible.
 */
export type ConsoleTarget =
  | { mode: 'create'; launcher: SessionLauncher; rootId: SafeRootId; relativeCwd: string }
  | { mode: 'attach'; sessionId: string }
  | { mode: 'replay'; sessionId: string };

/** Per-console connection state, as the operator sees it. */
export type ConsoleConnState = 'connecting' | 'live' | 'detached' | 'closed' | 'error';

/**
 * The ONE value the connection effect keys on. Two targets with this key are the same connection,
 * however many times their object literals are rebuilt — so a parent re-render passing inline literals
 * can never tear down a socket and mint a second session behind the operator's back.
 */
export function consoleTargetKey(target: ConsoleTarget): string {
  if (target.mode === 'create') return `create:${target.launcher}:${target.rootId}:${target.relativeCwd}`;
  return `${target.mode}:${target.sessionId}`;
}

/** An imperative handle a host registers, so ITS chrome can drive this pane's session. */
export interface ConsoleControl {
  /** End the session on the host (a `close` frame while live, else the REST DELETE). */
  requestClose(): void;
  /** Leave the session running and drop this attachment. */
  requestDetach(): void;
  /** Re-open the socket and resume from the cursor. */
  reconnect(): void;
}

/** One [C-R6] replay frame as the pane consumes it: base64 payload at a byte offset. */
export type ConsoleReplayFrame = { sequence: number; encoding: 'base64'; data: string };

/**
 * A whole terminal attempt's transcript, already read. `lostOutput` says the retention window dropped
 * the head, so the pane writes {@link LOST_OUTPUT_NOTICE} before the bytes instead of presenting a
 * spliced stream as continuous; `notice` is the ONE sentence a refused read shows instead of frames.
 */
export type ConsoleReplayLoad =
  | { ok: true; frames: readonly ConsoleReplayFrame[]; lostOutput?: boolean }
  | { ok: false; notice: string };

export interface ConsolePaneProps {
  target: ConsoleTarget;
  /**
   * Where a `replay` target's bytes come from. Supplied, the pane opens NO socket: it writes the read
   * transcript into the same single xterm this pane already owns ([C-R6] — replay creates no second
   * grid and has no input, resize, or close path). Absent, a `replay` target still resumes over the
   * live socket read-only, which is how the Terminal workspace observes a session it does not control.
   */
  replaySource?: (sessionId: string) => Promise<ConsoleReplayLoad>;
  /**
   * Whether this console is the visible one. Drives `display` (NOT unmounting — a hidden console keeps
   * its socket and its scrollback) and a re-fit when it becomes visible again.
   */
  visible: boolean;
  socketFactory?: PtySocketFactory;
  /** REST client, used only to close a session whose socket is already gone. */
  sessionsClient?: TerminalSessionsClient;
  /**
   * How this pane obtains the browser-session cookie `/api/pty` requires before the socket may open.
   * Injected for the same reason `socketFactory` is: a test can hold the promise open and prove no
   * socket is created until it resolves.
   */
  ensureBrowserSession?: () => Promise<BrowserSessionOutcome>;
  /** Every decoded server frame, so a manager can fold it into the W4 workspace model. */
  onServerFrame?: (frame: BrowserServerFrame) => void;
  /** This console's session, the moment the host confirms it. */
  onSession?: (session: SessionSummary) => void;
  /** Publish/withdraw this console's imperative controls. */
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
  replaySource,
  socketFactory = defaultPtySocketFactory,
  sessionsClient = defaultTerminalSessionsClient,
  ensureBrowserSession = defaultEnsureBrowserSession,
  onServerFrame,
  onSession,
  registerControl,
  testIdSuffix = '',
  role,
  ariaLabel,
}: ConsolePaneProps): React.JSX.Element {
  // The bearer comes from the app's ONE session, not a prop. Optional so an embedded console inside a
  // presentational surface rendered standalone degrades to "connects nothing" instead of throwing.
  const sessionToken = useOptionalSession()?.session?.token;
  const readOnly = target.mode === 'replay';
  const hostRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<{ cols: number; rows: number; write(d: string): void; clear(): void; dispose(): void } | null>(null);
  const fitRef = useRef<{ fit(): void } | null>(null);
  const connectionRef = useRef<PtyConnection | null>(null);
  // The host-confirmed session id and attachment for THIS console, plus the reconnect cursor.
  const sessionIdRef = useRef<string | null>(target.mode === 'create' ? null : target.sessionId);
  const attachmentIdRef = useRef<string | null>(null);
  const cursorRef = useRef(0);
  const [state, setState] = useState<ConsoleConnState>('connecting');
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [reconnectTick, setReconnectTick] = useState(0);

  // Everything the connection effect must READ but must never RE-RUN for.
  const targetRef = useRef(target);
  targetRef.current = target;
  const onServerFrameRef = useRef(onServerFrame);
  onServerFrameRef.current = onServerFrame;
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;
  const sessionsClientRef = useRef(sessionsClient);
  sessionsClientRef.current = sessionsClient;
  const ensureBrowserSessionRef = useRef(ensureBrowserSession);
  ensureBrowserSessionRef.current = ensureBrowserSession;
  const registerControlRef = useRef(registerControl);
  registerControlRef.current = registerControl;

  const targetKey = consoleTargetKey(target);

  /**
   * Fit the terminal to its pane and relay the resulting geometry to the host. No-ops while hidden (a
   * `display:none` pane measures 0×0 and would corrupt the grid) and in read-only replay, where this
   * console has no attachment it may resize.
   */
  const fitAndResize = useCallback(() => {
    const host = hostRef.current;
    const fitAddon = fitRef.current;
    const xterm = xtermRef.current;
    if (!host || !fitAddon || !xterm) return;
    if (host.offsetParent === null) return; // hidden pane — dimensions are unreliable
    try {
      fitAddon.fit();
    } catch {
      return; // fit can throw if the element was detached mid-teardown
    }
    if (readOnly) return;
    const sessionId = sessionIdRef.current;
    const attachmentId = attachmentIdRef.current;
    const connection = connectionRef.current;
    if (connection?.isOpen && sessionId && attachmentId) {
      connection.send(resizeFrame(sessionId, attachmentId, xterm.cols, xterm.rows));
    }
  }, [readOnly]);

  /**
   * The ONE grid this pane will ever own. Every path that needs to write output — the socket pump and
   * the read-only replay reader — goes through here, so a pane can never end up with two xterms
   * ([C-R6]); a reconnect and a replay reload both keep the scrollback that is already on screen.
   */
  const ensureGrid = useCallback(async (): Promise<typeof xtermRef.current> => {
    if (xtermRef.current) return xtermRef.current;
    const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ]);
    if (!hostRef.current) return null;
    if (xtermRef.current) return xtermRef.current; // a concurrent caller won the race
    const created = new XTerm({
      theme: HOUSE_XTERM_THEME,
      fontFamily: "ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      cursorBlink: !readOnly,
      cursorStyle: 'block',
      convertEol: true,
      disableStdin: readOnly,
    });
    const fitAddon = new FitAddon();
    created.loadAddon(fitAddon);
    created.open(hostRef.current);
    xtermRef.current = created as unknown as typeof xtermRef.current;
    fitRef.current = fitAddon as unknown as typeof fitRef.current;
    fitAndResize(); // initial size (guarded no-op if this console mounts hidden)
    if (!readOnly) {
      created.onData((data: string) => {
        const sessionId = sessionIdRef.current;
        const attachmentId = attachmentIdRef.current;
        const connection = connectionRef.current;
        if (!connection?.isOpen || !sessionId || !attachmentId) return;
        connection.send(inputFrame(sessionId, attachmentId, data));
      });
    }
    return xtermRef.current;
  }, [fitAndResize, readOnly]);

  /**
   * Read-only replay from a REST source ([C-R6]). No socket, no attachment, no cursor to hold: the
   * whole retained transcript is read once and written into the pane's own grid. A refused read is one
   * sentence, never an empty grid that looks like an attempt that printed nothing.
   */
  useEffect(() => {
    // Keyed on the STRING `targetKey`, exactly like the socket effect below. `target` is a fresh object
    // literal on every parent render, so depending on it re-ran this effect on each detail refresh: the
    // whole transcript was re-downloaded and appended to the grid it was already in. The grid is also
    // cleared before the write, so a genuine re-run (a real target change, or a reconnect) replaces the
    // transcript instead of duplicating it.
    const replayTarget = targetRef.current;
    if (!replaySource || replayTarget.mode !== 'replay') return;
    let disposed = false;
    setState('connecting');
    setDiagnostic(null);
    void (async () => {
      const [grid, load] = await Promise.all([ensureGrid(), replaySource(replayTarget.sessionId)]);
      if (disposed) return;
      if (!load.ok) {
        setState('error');
        setDiagnostic(load.notice);
        return;
      }
      grid?.clear();
      if (load.lostOutput) grid?.write(`${LOST_OUTPUT_NOTICE}\r\n`);
      for (const frame of load.frames) grid?.write(decodeOutput(frame.data));
      setState('closed');
      fitAndResize();
    })();
    return () => { disposed = true; };
  }, [ensureGrid, fitAndResize, replaySource, targetKey, reconnectTick]);

  // Connect: lazily create xterm + fit addon, open ONE socket, send the opening frame, pump the rest.
  // Runs once per (token, target, reconnect) — never per render. Cleanup closes the socket, which merely
  // DETACHES the session host-side; the session keeps running and can be reattached from the cursor.
  useEffect(() => {
    if (!sessionToken) return;
    // A replay fed from the REST source never opens a socket — that read IS the transcript.
    if (replaySource && targetRef.current.mode === 'replay') return;
    const connectTarget = targetRef.current;
    let disposed = false;
    setState('connecting');

    void (async () => {
      // The `/api/pty` upgrade resolves a BROWSER principal, so this browser must already hold a live
      // `kb_browser_session` cookie when the socket is opened — without one the route answers 428 and
      // the operator reads a bare "the connection failed". Nothing in the client used to ask for that
      // cookie, which is why no browser on the tailnet deployment could ever open a terminal. A
      // definitive refusal is SHOWN and no socket is opened; a transport failure is not treated as a
      // refusal, because the server never spoke and refusing to even try would turn a blip into a dead
      // terminal — the socket's own diagnostics then say what happened.
      const browserSession = await ensureBrowserSessionRef.current();
      if (disposed) return;
      if (!browserSession.ok && browserSession.reason !== 'unreachable') {
        setState('error');
        setDiagnostic(browserSessionMessage(browserSession.reason));
        return;
      }
      // A pane that already has a grid (a reconnect) keeps it: the scrollback is the whole point.
      const grid = await ensureGrid();
      if (disposed || grid === null) return;

      const connection = openPtyConnection(sessionToken, {
        onOpen: () => {
          if (disposed) return;
          const cols = grid?.cols ?? 80;
          const rows = grid?.rows ?? 24;
          if (connectTarget.mode === 'create' && sessionIdRef.current === null) {
            connection.send(createFrame({
              launcher: connectTarget.launcher,
              rootId: connectTarget.rootId,
              relativeCwd: connectTarget.relativeCwd,
              cols,
              rows,
            }));
            return;
          }
          // Everything else — an explicit attach, a replay, and a reconnect after a create — resumes the
          // named session from the cursor. A reconnect must never mint a second session.
          const sessionId = sessionIdRef.current ?? (connectTarget.mode === 'create' ? null : connectTarget.sessionId);
          if (sessionId === null) return;
          connection.send(attachFrame(sessionId, cursorRef.current));
        },
        onFrame: (frame) => {
          if (disposed) return;
          onServerFrameRef.current?.(frame);
          if (frame.type === 'created' || frame.type === 'attached') {
            sessionIdRef.current = frame.session.sessionId;
            attachmentIdRef.current = frame.attachmentId;
            if (frame.type === 'attached') {
              // The server's cursor wins: it knows what it actually replayed. If it had to start later
              // than this pane asked for, the bytes in between are gone for good — say so once, in
              // plain words, on its own line, rather than splicing an invisible hole into the grid.
              const asked = cursorRef.current;
              cursorRef.current = frame.nextSequence;
              if (frame.replayFrom > asked) grid?.write(`\r\n${LOST_OUTPUT_NOTICE}\r\n`);
            }
            setState('live');
            setDiagnostic(null);
            onSessionRef.current?.(frame.session);
            fitAndResize();
            return;
          }
          if (frame.type === 'session') {
            onSessionRef.current?.(frame.session);
            return;
          }
          if (frame.type === 'data') {
            // The cursor is a BYTE offset: it advances past the bytes this frame carried, live or
            // replayed. Never backwards — a replayed frame the pane already holds must not rewind it.
            const after = frame.sequence + outputByteLength(frame.data);
            if (after > cursorRef.current) cursorRef.current = after;
            grid?.write(decodeOutput(frame.data));
            return;
          }
          if (frame.type === 'exit') {
            setState('closed');
            setDiagnostic(frame.exit.exitCode === null
              ? `Session ended (${frame.exit.reason}).`
              : `Session ended with exit code ${frame.exit.exitCode}.`);
            return;
          }
          if (frame.type === 'ack' && frame.action === 'close') {
            setState('closed');
            setDiagnostic('Session closed.');
            return;
          }
          if (frame.type === 'ack' && frame.action === 'detach') {
            attachmentIdRef.current = null;
            setState('detached');
            setDiagnostic('Detached. This session is still running.');
            return;
          }
          if (frame.type === 'error') {
            setState('error');
            setDiagnostic(refusalMessage(frame.code));
          }
        },
        onProtocolViolation: () => {
          if (disposed) return;
          setState('error');
          setDiagnostic('The dashboard received a frame it could not verify.');
          // A peer that violated the protocol keeps no socket: whatever it sends next is unverifiable too.
          connectionRef.current?.close();
        },
        onClose: (closure) => {
          if (disposed) return;
          attachmentIdRef.current = null;
          // A closed/exited session stays closed; anything else is a lost socket the operator may resume.
          setState((current) => (current === 'closed' ? current : closure === 'error' ? 'error' : 'detached'));
          setDiagnostic((current) => current ?? closureMessage(closure));
        },
      }, socketFactory);
      connectionRef.current = connection;
      if (disposed) connection.close();
    })();

    return () => {
      disposed = true;
      connectionRef.current?.close();
      connectionRef.current = null;
      attachmentIdRef.current = null;
    };
  }, [sessionToken, targetKey, socketFactory, fitAndResize, ensureGrid, replaySource, reconnectTick]);

  // Dispose the grid only when the pane itself unmounts — a reconnect keeps the scrollback.
  useEffect(() => () => {
    xtermRef.current?.dispose();
    xtermRef.current = null;
    fitRef.current = null;
  }, []);

  const requestClose = useCallback(() => {
    const connection = connectionRef.current;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    if (connection?.isOpen) {
      connection.send(closeFrame(sessionId));
      return;
    }
    if (!sessionToken) return;
    void sessionsClientRef.current.remove(sessionId, sessionToken).then((result) => {
      if (result.ok) {
        setState('closed');
        setDiagnostic('Session closed.');
        return;
      }
      setDiagnostic(result.reason === 'exit-unconfirmed'
        ? 'The host has not confirmed this session ended.'
        : 'That session is no longer available.');
    });
  }, [sessionToken]);

  const requestDetach = useCallback(() => {
    const connection = connectionRef.current;
    const sessionId = sessionIdRef.current;
    const attachmentId = attachmentIdRef.current;
    if (!connection?.isOpen || !sessionId || !attachmentId) return;
    connection.send(detachFrame(sessionId, attachmentId));
  }, []);

  const reconnect = useCallback(() => {
    setDiagnostic(null);
    setReconnectTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    registerControlRef.current?.({ requestClose, requestDetach, reconnect });
    return () => registerControlRef.current?.(null);
  }, [requestClose, requestDetach, reconnect]);

  // Re-fit whenever this console becomes visible — a hidden pane could not be measured.
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => fitAndResize());
    return () => cancelAnimationFrame(raf);
  }, [visible, fitAndResize]);

  // Reflow on container/window resize. Both funnel through the guarded `fitAndResize`.
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

  // One robustness refit once the web fonts have loaded: the first fit can run against fallback-font
  // metrics, and when the mono face swaps in the cell size changes.
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
      data-readonly={readOnly ? 'true' : undefined}
      data-testid={`console-panel${testIdSuffix}`}
    >
      {readOnly ? (
        <p className="console-pane__note" data-testid={`console-panel-readonly${testIdSuffix}`}>
          Read-only replay — this transcript cannot be typed into.
        </p>
      ) : null}
      {diagnostic ? (
        <p className="console-pane__error" role="status" data-testid={`console-panel-diagnostic${testIdSuffix}`}>
          {diagnostic}
          {state === 'detached' ? (
            <button
              type="button"
              className="console-pane__reattach"
              onClick={reconnect}
              data-testid={`console-panel-reattach${testIdSuffix}`}
            >
              Reattach
            </button>
          ) : null}
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
