/**
 * D3.2 — the PTY terminal pane (client view). An embedded xterm.js terminal streamed over a WebSocket
 * to the governed server endpoint that, in turn, SIGNALS the pre-authenticated fleet-identity PTY host
 * (`server/pty/hostClient.ts#openPty`) — the daemon never spawns a shell itself, and this view never
 * holds a credential. See `server/pty/host.ts` for the no-spawn-as-user / constrained-env architecture.
 *
 * This view is session-gated exactly like `Vibe.tsx`/`Control.tsx`'s launch surface: without a
 * `sessionToken` it renders a passkey prompt and connects nothing. The WebSocket carries the bearer
 * session token via a subprotocol (never in the URL, which would land the token in logs); the SERVER
 * runs the same `Origin`/`Host` allowlist check as every other socket (`server/security/origin.ts`)
 * on the upgrade, then re-verifies the session and runs the preamble gate before signalling the host.
 * No route is wired by this file — mounting the endpoint behind `openPty` is the go-live gate's job
 * (D3.1), same caveat as `Vibe.tsx`; until then a failed connect surfaces as an ordinary disconnect.
 *
 * xterm.js is loaded LAZILY (dynamic import inside the mount effect) so the module never instantiates a
 * DOM canvas at import time — the app bundle code-splits it, and unit tests that never mount this view
 * never touch it. The house palette FULLY overrides xterm's default black background / green cursor:
 * deepest sunken surface, warm off-white text, a NEUTRAL cursor, mono only, and NO accent colour.
 */
import { useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import '../styles/views/terminal.css';

/**
 * xterm theme mapped ENTIRELY onto the house near-black palette (app.css tokens, resolved to literals
 * because xterm needs concrete colours, not CSS vars). Every ANSI slot is a warm neutral — there is no
 * terminal-green, no pure black, and no decorative accent. The cursor is a plain warm off-white.
 */
const HOUSE_XTERM_THEME = {
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

/** Opens the PTY WebSocket to the governed endpoint, bearer token carried as a subprotocol (never the
 *  URL). Injectable so a future component test can drive the pane through a fake socket. */
export type PtySocketFactory = (sessionToken: string) => WebSocket;

export const defaultPtySocketFactory: PtySocketFactory = (sessionToken) => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // The token rides as a subprotocol value, not a query param — keeps it out of access logs / history.
  return new WebSocket(`${proto}//${window.location.host}/api/pty`, ['kb-pty.v1', sessionToken]);
};

export interface TerminalProps {
  sessionToken?: string;
  /**
   * The constrained fleet account the PTY host runs the shell under (created at the D3.1 human gate).
   * Shown in the persistent header chip so the operator always sees WHICH identity the terminal is —
   * never Daniel's. Configured at go-live; a neutral placeholder until then.
   */
  fleetIdentity?: string;
  socketFactory?: PtySocketFactory;
}

type ConnState = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

/** The embedded terminal pane. */
export function Terminal({
  sessionToken,
  fleetIdentity = 'fleet-runner',
  socketFactory = defaultPtySocketFactory,
}: TerminalProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ConnState>('idle');

  useEffect(() => {
    if (!sessionToken || !hostRef.current) return;

    let disposed = false;
    let term: { write(d: string): void; onData(cb: (d: string) => void): void; dispose(): void; open(el: HTMLElement): void } | null = null;
    let socket: WebSocket | null = null;
    setState('connecting');

    // Lazy-load xterm only on mount — never at module import, so the class touches the DOM only here.
    void (async () => {
      const { Terminal: XTerm } = await import('@xterm/xterm');
      if (disposed || !hostRef.current) return;
      const xterm = new XTerm({
        theme: HOUSE_XTERM_THEME,
        fontFamily: "ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, 'Liberation Mono', monospace",
        fontSize: 13,
        cursorBlink: true,
        cursorStyle: 'block',
        convertEol: true,
      });
      term = xterm as unknown as typeof term;
      xterm.open(hostRef.current);

      const ws = socketFactory(sessionToken);
      socket = ws;
      ws.onopen = () => !disposed && setState('connected');
      ws.onmessage = (ev) => {
        if (disposed) return;
        const data = typeof ev.data === 'string' ? ev.data : '';
        if (data) xterm.write(data);
      };
      ws.onclose = () => !disposed && setState('closed');
      ws.onerror = () => !disposed && setState('error');
      // Keystrokes → the host's PTY stdin (proxied by the server; the browser never spawns anything).
      xterm.onData((d: string) => {
        if (ws.readyState === ws.OPEN) ws.send(d);
      });
    })();

    return () => {
      disposed = true;
      try {
        socket?.close();
      } catch {
        /* socket may not have opened */
      }
      term?.dispose();
    };
  }, [sessionToken, socketFactory]);

  return (
    <section className="terminal" aria-label="Terminal view">
      <header className="terminal__header">
        <h2 className="terminal__title">Terminal</h2>
        {/* Persistent identity chip: the operator always sees WHICH constrained account owns this shell. */}
        <span className="terminal__identity" data-testid="terminal-identity" title="The PTY runs under this constrained fleet identity — never your own account">
          <span className="terminal__identity-dot" aria-hidden="true" />
          runs as <code>{fleetIdentity}</code>
        </span>
        <span className={`terminal__state terminal__state--${state}`} role="status" aria-label={`Connection ${state}`}>
          {state}
        </span>
      </header>
      <p className="terminal__note" role="note">
        Real shell inside the pre-authenticated fleet-identity host — signalled, never spawned-as-user by
        the daemon; WebAuthn-gated, preamble/STOP-gated, and independently audited. The daemon holds no
        account credential.
      </p>
      {!sessionToken ? (
        <p className="terminal__session-warning">Sign in with your passkey to open a terminal.</p>
      ) : null}
      <div ref={hostRef} className="terminal__surface" data-testid="terminal-surface" />
    </section>
  );
}
