/**
 * D3.2 — the PTY terminal pane (client view). A multi-tab embedded xterm.js terminal surface: each tab
 * is an INDEPENDENT shell — its own WebSocket to the governed `/api/pty` endpoint and its own xterm
 * instance. The daemon spawns the shell in-process (node-pty) and streams it; this view never holds a
 * credential and never spawns anything itself. See `server/pty/*` for the server half of the protocol.
 *
 * This view is session-gated exactly like `Vibe.tsx`/`Control.tsx`'s launch surface: without a
 * `sessionToken` it renders a passkey prompt and connects nothing. Each tab's WebSocket carries the SAME
 * bearer session token via a subprotocol (never in the URL, which would land the token in logs); the
 * SERVER runs the same `Origin`/`Host` allowlist check as every other socket on the upgrade, then
 * re-verifies the session before streaming. The server enforces a hard cap of 8 concurrent terminals
 * across the whole daemon — the `+` button is disabled once 8 tabs are open locally, and a server-side
 * `{"type":"error","reason":"too-many-terminals"}` frame is surfaced as an inline notice (never a crash).
 *
 * Protocol (unchanged, do not touch): SERVER→BROWSER is raw PTY output as text frames (write straight to
 * xterm) plus occasional `{"type":"error","reason":"…"}` JSON; BROWSER→SERVER is raw keystrokes as text
 * plus `{"type":"resize","cols":N,"rows":M}` JSON. The old per-open passkey ("Factor C") handshake has
 * been REMOVED from the server and from this view — no `challenge`/`assertion`/`awaiting-touch` remains.
 *
 * xterm.js AND the fit addon are loaded LAZILY (dynamic import inside the mount effect) so the module
 * never instantiates a DOM canvas at import time — the app bundle code-splits them, and unit tests that
 * never mount a tab never touch them. The house palette FULLY overrides xterm's default black/green look:
 * deepest sunken surface, warm off-white text, a NEUTRAL cursor, mono only, and NO accent colour. The
 * fit addon reflows the active tab to fill its panel; after each fit we relay the new cols/rows so the
 * PTY's window size tracks the pane (SIGWINCH), and inactive tabs keep their socket + scrollback alive.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import '../styles/views/terminal.css';
import type { Session } from '../lib/authClient';

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

/** The hard cap the server enforces across the whole daemon; the `+` button mirrors it locally. */
const MAX_TERMINALS = 8;

/** Opens the PTY WebSocket to the governed endpoint, bearer token carried as a subprotocol (never the
 *  URL). Injectable so a component test can drive a tab through a fake socket. */
export type PtySocketFactory = (sessionToken: string) => WebSocket;

export const defaultPtySocketFactory: PtySocketFactory = (sessionToken) => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // The token rides as a subprotocol value, not a query param — keeps it out of access logs / history.
  return new WebSocket(`${proto}//${window.location.host}/api/pty`, ['kb-pty.v1', sessionToken]);
};

/** Per-tab connection state. Streaming-only — there is no passkey handshake in this path any more. */
type ConnState = 'connecting' | 'connected' | 'closed' | 'error';

/** A parsed server error frame, or `null` for ordinary raw PTY output. */
interface PtyErrorFrame {
  type: 'error';
  reason: string;
}

/**
 * Detect a server control frame. The only inbound JSON the server sends is `{"type":"error",…}` — every
 * other frame is raw PTY bytes destined for xterm. We only treat a frame as control when it parses AND
 * carries the exact error shape, so ordinary shell output that merely starts with `{` still streams.
 */
function parseErrorFrame(raw: string): PtyErrorFrame | null {
  if (raw.length === 0 || raw[0] !== '{') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as { type?: unknown }).type === 'error' &&
      typeof (parsed as { reason?: unknown }).reason === 'string'
    ) {
      return { type: 'error', reason: (parsed as { reason: string }).reason };
    }
  } catch {
    /* not JSON → raw PTY bytes */
  }
  return null;
}

/**
 * A single shell tab: one lazily-created xterm instance bound to one WebSocket. The component MOUNTS once
 * per tab and stays mounted while its tab exists (inactive tabs are merely hidden with CSS, NOT unmounted)
 * so the socket and the scrollback survive tab switches. Closing the tab unmounts this, which tears down
 * the socket and disposes the terminal.
 */
interface TerminalTabProps {
  /** Stable numeric id (also the React key upstream); passed to `onError` so the manager knows which tab. */
  id: number;
  sessionToken: string;
  /** Whether this tab is the visible one. Drives visibility + a re-fit when the tab becomes active. */
  active: boolean;
  socketFactory: PtySocketFactory;
  /** Reports a server error frame (e.g. `too-many-terminals`) up to the tab manager. Must be stable. */
  onError: (id: number, reason: string) => void;
}

function TerminalTab({ id, sessionToken, active, socketFactory, onError }: TerminalTabProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  // Live handles kept in refs so the resize/fit effects can reach them without re-running the mount effect.
  const xtermRef = useRef<{ cols: number; rows: number; write(d: string): void; dispose(): void } | null>(null);
  const fitRef = useRef<{ fit(): void } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnState>('connecting');
  const [errorReason, setErrorReason] = useState<string | null>(null);

  /**
   * Fit the terminal to its panel and relay the resulting geometry to the PTY. No-ops while the tab is
   * hidden (a `display:none` panel measures 0×0 and would corrupt the grid) — the `active` effect below
   * re-fits the moment the tab becomes visible again.
   */
  const fitAndResize = useCallback(() => {
    const host = hostRef.current;
    const fitAddon = fitRef.current;
    const xterm = xtermRef.current;
    const ws = socketRef.current;
    if (!host || !fitAddon || !xterm) return;
    if (host.offsetParent === null) return; // hidden tab — dimensions are unreliable
    try {
      fitAddon.fit();
    } catch {
      return; // fit can throw if the element was detached mid-teardown
    }
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: xterm.cols, rows: xterm.rows }));
    }
  }, []);

  // Mount: lazily create xterm + fit addon, open the socket, wire the streaming path. Runs ONCE per tab
  // (deps are all stable) so a tab switch never re-connects. Cleanup closes the socket + disposes xterm.
  useEffect(() => {
    let disposed = false;
    setState('connecting');

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
      fitAndResize(); // initial size (guarded no-op if this tab mounts hidden)

      const ws = socketFactory(sessionToken);
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
        // Control path FIRST: a server error frame (e.g. too-many-terminals / spawn-failed) is surfaced,
        // never written to the grid. Everything else is raw PTY output.
        const err = parseErrorFrame(raw);
        if (err) {
          setState('error');
          setErrorReason(err.reason);
          onError(id, err.reason);
          return;
        }
        xterm.write(raw);
      };
      ws.onclose = () => !disposed && setState('closed');
      ws.onerror = () => !disposed && setState('error');
      // Keystrokes → the PTY stdin (raw text frames).
      xterm.onData((d: string) => {
        if (ws.readyState === ws.OPEN) ws.send(d);
      });
    })();

    return () => {
      disposed = true;
      try {
        socketRef.current?.close();
      } catch {
        /* socket may not have opened */
      }
      xtermRef.current?.dispose();
      socketRef.current = null;
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [id, sessionToken, socketFactory, onError, fitAndResize]);

  // Re-fit whenever this tab becomes the active/visible one — a hidden tab could not be measured, so its
  // grid may be stale after a resize that happened while it was in the background.
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => fitAndResize());
    return () => cancelAnimationFrame(raf);
  }, [active, fitAndResize]);

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

  return (
    <div
      className={`terminal__panel${active ? ' terminal__panel--active' : ''}`}
      role="tabpanel"
      aria-hidden={!active}
      data-state={state}
      data-testid={`terminal-panel-${id}`}
    >
      {errorReason ? (
        <p className="terminal__panel-error" role="status" data-testid={`terminal-panel-error-${id}`}>
          Terminal error: {errorReason}
        </p>
      ) : null}
      <div ref={hostRef} className="terminal__surface" data-testid={`terminal-surface-${id}`} />
    </div>
  );
}

export interface TerminalProps {
  sessionToken?: string;
  /**
   * Whether the App-level terminal surface is currently visible. The App deliberately keeps this
   * component mounted while another destination (or Composer) is in front of it so live shells and
   * scrollback survive navigation. A hidden terminal does not auto-open its first shell; returning to
   * it re-activates the selected tab and therefore re-runs the fit/resize path.
   */
  visible?: boolean;
  /**
   * Truthful label for the temporary runtime identity. The current in-process bridge runs under the same
   * OS account as the dashboard daemon (with a credential-filtered child env), not a constrained account.
   */
  fleetIdentity?: string;
  socketFactory?: PtySocketFactory;
  /**
   * Point-of-action passkey sign-in (App-wired), mirroring the other governed views. Without a
   * `sessionToken` the empty state becomes an actionable "Sign in with your passkey" button that runs the
   * WebAuthn ceremony and mints the ~5-min dashboard session; the view then opens its first tab. Absent
   * (direct component tests) → passive text only.
   */
  onRequestSession?: () => Promise<Session | null>;
}

/** A tab plus a monotonically-increasing id so React keys stay stable across insert/remove. */
interface TabEntry {
  id: number;
}

/**
 * The terminal surface: a tab manager over independent `TerminalTab` shells. Session-gated — without a
 * `sessionToken` it renders the passkey sign-in and opens nothing; once signed in it opens one tab and
 * lets the operator add up to `MAX_TERMINALS`.
 */
export function Terminal({
  sessionToken,
  visible = true,
  fleetIdentity = 'dashboard daemon user',
  socketFactory = defaultPtySocketFactory,
  onRequestSession,
}: TerminalProps): React.JSX.Element {
  const [tabs, setTabs] = useState<TabEntry[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nextIdRef = useRef(1);
  const [signingIn, setSigningIn] = useState(false);

  const openTab = useCallback(() => {
    setTabs((prev) => {
      if (prev.length >= MAX_TERMINALS) return prev;
      const id = nextIdRef.current++;
      setActiveId(id);
      setNotice(null);
      return [...prev, { id }];
    });
  }, []);

  const closeTab = useCallback((id: number) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveId((current) => {
        if (current !== id) return current;
        // Closing the active tab → focus a neighbour (prefer the one before it, else the new first).
        const idx = prev.findIndex((t) => t.id === id);
        const fallback = next[idx - 1] ?? next[0] ?? null;
        return fallback ? fallback.id : null;
      });
      return next;
    });
  }, []);

  // Stable per-manager error sink. `too-many-terminals` becomes an inline notice and drops the offending
  // tab (it never got a shell); any other error stays visible inside its own panel.
  const handleTabError = useCallback(
    (id: number, reason: string) => {
      if (reason === 'too-many-terminals') {
        setNotice('The fleet already has the maximum number of terminals open. Close one and try again.');
        closeTab(id);
      }
    },
    [closeTab],
  );

  // Open the first tab only while the operator is actually looking at Terminal. App keeps this component
  // mounted from startup, so `sessionToken` can be minted by an unrelated governed action while the view is
  // hidden; that must NOT spend a PTY slot or spawn a surprise shell. Once tabs exist, hiding preserves them.
  // Losing the session remains a security teardown and clears every tab regardless of visibility.
  useEffect(() => {
    if (sessionToken && visible) {
      setTabs((prev) => {
        if (prev.length > 0) return prev;
        const id = nextIdRef.current++;
        setActiveId(id);
        return [{ id }];
      });
    } else if (!sessionToken) {
      setTabs([]);
      setActiveId(null);
      setNotice(null);
    }
  }, [sessionToken, visible]);

  async function handleSignIn(): Promise<void> {
    if (!onRequestSession || signingIn) return;
    setSigningIn(true);
    try {
      await onRequestSession();
    } finally {
      setSigningIn(false);
    }
  }

  const atCap = tabs.length >= MAX_TERMINALS;

  return (
    <section className="terminal" aria-label="Terminal view" aria-hidden={!visible}>
      <header className="terminal__header">
        <h2 className="terminal__title">Terminal</h2>
        {/* Do not imply that the temporary in-process route is cross-user isolated. */}
        <span
          className="terminal__identity"
          data-testid="terminal-identity"
          title="Temporary mode: the PTY runs as the dashboard daemon's OS user with a credential-filtered child environment"
        >
          <span className="terminal__identity-dot" aria-hidden="true" />
          runs as <code>{fleetIdentity}</code>
        </span>
      </header>
      <p className="terminal__note" role="note">
        Temporary in-process shells under the dashboard daemon user — WebAuthn-session gated,
        preamble/STOP/budget gated before open, independently audited, and launched with a
        credential-filtered child environment. Cross-user isolation and per-open Factor C are not active.
      </p>

      {!sessionToken ? (
        onRequestSession ? (
          <button
            type="button"
            className="terminal__signin mc-btn mc-btn--primary"
            onClick={() => void handleSignIn()}
            disabled={signingIn}
            data-testid="terminal-signin"
          >
            {signingIn ? 'Signing in…' : 'Sign in with your passkey to open a terminal'}
          </button>
        ) : (
          <p className="terminal__session-warning">Sign in with your passkey to open a terminal.</p>
        )
      ) : (
        <>
          <div className="terminal__tabbar" role="tablist" aria-label="Open terminals">
            {tabs.map((tab, index) => {
              const isActive = tab.id === activeId;
              return (
                <div
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  className={`terminal__tab${isActive ? ' terminal__tab--active' : ''}`}
                  data-testid={`terminal-tab-${tab.id}`}
                >
                  <button
                    type="button"
                    className="terminal__tab-label"
                    onClick={() => setActiveId(tab.id)}
                    title={`powershell ${index + 1}`}
                  >
                    powershell {index + 1}
                  </button>
                  <button
                    type="button"
                    className="terminal__tab-close"
                    onClick={() => closeTab(tab.id)}
                    aria-label={`Close powershell ${index + 1}`}
                    data-testid={`terminal-tab-close-${tab.id}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="terminal__tab-add"
              onClick={openTab}
              disabled={atCap}
              aria-label="Open a new terminal"
              title={atCap ? `Maximum of ${MAX_TERMINALS} terminals reached` : 'Open a new terminal'}
              data-testid="terminal-tab-add"
            >
              +
            </button>
          </div>

          {notice ? (
            <p className="terminal__notice" role="status" data-testid="terminal-notice">
              {notice}
            </p>
          ) : null}

          <div className="terminal__panels">
            {tabs.map((tab) => (
              <TerminalTab
                key={tab.id}
                id={tab.id}
                sessionToken={sessionToken}
                active={visible && tab.id === activeId}
                socketFactory={socketFactory}
                onError={handleTabError}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
