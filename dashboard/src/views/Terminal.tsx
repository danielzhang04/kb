/**
 * D3.2 — the PTY terminal pane (client view). A multi-tab embedded xterm.js terminal surface: each tab
 * is an INDEPENDENT shell — its own WebSocket to the governed `/api/pty` endpoint and its own xterm
 * instance. The daemon spawns the shell in-process (node-pty) and streams it; this view never holds a
 * credential and never spawns anything itself. See `server/pty/*` for the server half of the protocol.
 *
 * This view is session-gated exactly like `Vibe.tsx`/`Control.tsx`'s launch surface: without a
 * session it renders a calm locked line and connects nothing. Each tab's WebSocket carries the SAME
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
import { useSession } from '../lib/sessionContext';
import {
  defaultTerminalSessionsClient,
  loadStoredTabs,
  reconcileSessions,
  saveStoredTabs,
} from '../lib/terminalClient';
import type { TerminalSessionsClient } from '../lib/terminalClient';

/**
 * xterm theme mapped ENTIRELY onto the house near-black palette (app.css tokens, resolved to literals
 * because xterm needs concrete colours, not CSS vars). Every ANSI slot is a warm neutral — there is no
 * terminal-green, no pure black, and no decorative accent. The cursor is a plain warm off-white.
 *
 * Exported (with {@link parseControlFrame} below) so any other surface attaching to `/api/pty` renders
 * the SAME xterm look and speaks the SAME control-frame protocol as this view, instead of forking a
 * second theme/parser for what is the identical attach path against a different session id.
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

/** The hard cap the server enforces across the whole daemon; the `+` button mirrors it locally. */
const MAX_TERMINALS = 8;

/**
 * What a tab RUNS. Absent = the login shell (the historical default, unchanged).
 *   `claude`   — a plain interactive Claude Code session in the repo the daemon serves.
 *   `agent`    — the same session primed with `agentId`'s own declaration file.
 *   `workflow` — the same session primed as the agent that runs `workflowRef`'s definition.
 *
 * `agentId`/`workflowRef` are retained even in `claude` mode so the header toggle can switch back
 * without the operator re-picking anything. The SERVER resolves either reference to a file; the browser
 * only ever names it.
 */
export interface PtySpawnTarget {
  mode: 'claude' | 'agent' | 'workflow';
  agentId?: string;
  workflowRef?: string;
}

/** Opens the PTY WebSocket to the governed endpoint, bearer token carried as a subprotocol (never the
 *  URL). An optional `attachSessionId` reattaches to an existing persistent shell via `?session=<id>`
 *  (a non-secret reference; ownership is enforced server-side); an optional `spawn` asks the server to
 *  open something other than the login shell. Injectable so a component test can drive a tab through a
 *  fake socket. */
export type PtySocketFactory = (
  sessionToken: string,
  attachSessionId?: string,
  spawn?: PtySpawnTarget,
) => WebSocket;

/** The upgrade query for one tab. An attach and a spawn are mutually exclusive (the server refuses the
 *  combination): reattaching reuses a live shell, so there is nothing left to spawn. */
export function ptyQuery(attachSessionId?: string, spawn?: PtySpawnTarget): string {
  if (attachSessionId) return `?${new URLSearchParams({ session: attachSessionId }).toString()}`;
  if (!spawn) return '';
  const params =
    spawn.mode === 'agent' && spawn.agentId
      ? new URLSearchParams({ spawn: 'agent', agent: spawn.agentId })
      : spawn.mode === 'workflow' && spawn.workflowRef
        ? new URLSearchParams({ spawn: 'workflow', workflow: spawn.workflowRef })
        : new URLSearchParams({ spawn: 'claude' });
  return `?${params.toString()}`;
}

export const defaultPtySocketFactory: PtySocketFactory = (sessionToken, attachSessionId, spawn) => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // The token rides as a subprotocol value, not a query param — keeps it out of access logs / history.
  return new WebSocket(
    `${proto}//${window.location.host}/api/pty${ptyQuery(attachSessionId, spawn)}`,
    ['kb-pty.v1', sessionToken],
  );
};

/** Per-tab connection state. Streaming-only — there is no passkey handshake in this path any more. */
type ConnState = 'connecting' | 'connected' | 'closed' | 'error';

/** A parsed server control frame, or `null` for ordinary raw PTY output. The server sends `{"type":"error",…}`
 *  and, once per connection, `{"type":"session","sessionId":…}` (the bind frame). */
type PtyControlFrame = { type: 'error'; reason: string } | { type: 'session'; sessionId: string };

/**
 * Detect a server control frame. Every non-control frame is raw PTY bytes destined for xterm. We only
 * treat a frame as control when it parses AND carries an exact known shape, so ordinary shell output that
 * merely starts with `{` still streams.
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
 * A single shell tab: one lazily-created xterm instance bound to one WebSocket. The component MOUNTS once
 * per tab and stays mounted while its tab exists (inactive tabs are merely hidden with CSS, NOT unmounted)
 * so the socket and the scrollback survive tab switches. Closing the tab unmounts this, which tears down
 * the socket and disposes the terminal.
 */
/** An imperative handle the manager registers per tab, so the shared close button can ask THIS tab to
 *  tear down its own (persistent) shell — the tab is the only holder of the live socket + confirmed id. */
interface TabControl {
  requestClose(): void;
}

interface TerminalTabProps {
  /** Stable numeric id (also the React key upstream); passed to callbacks so the manager knows which tab. */
  id: number;
  /** When set, reattach to this existing persistent shell instead of opening a new one. */
  attachSessionId?: string;
  /** What to open when this is a FRESH tab (see {@link PtySpawnTarget}). Ignored on a reattach. */
  spawn?: PtySpawnTarget;
  /** Whether this tab is the visible one. Drives visibility + a re-fit when the tab becomes active. */
  active: boolean;
  socketFactory: PtySocketFactory;
  /** Kill the tab's server shell whose socket is already gone. Best-effort; injected for tests. */
  removeSession: (sessionId: string, token: string) => Promise<void>;
  /** Reports a server error frame (e.g. `too-many-terminals`) up to the tab manager. Must be stable. */
  onError: (id: number, reason: string) => void;
  /** Reports the server's `{type:'session'}` bind frame so the manager can persist this tab. Stable. */
  onSession: (id: number, sessionId: string) => void;
  /** The tab's server shell has ended (shell exit / operator close) → drop the tab locally. Stable. */
  onClosed: (id: number) => void;
  /** Publish/withdraw this tab's imperative close control to the manager. Stable. */
  registerControl: (id: number, control: TabControl | null) => void;
}

function TerminalTab({
  id,
  attachSessionId,
  spawn,
  active,
  socketFactory,
  removeSession,
  onError,
  onSession,
  onClosed,
  registerControl,
}: TerminalTabProps): React.JSX.Element {
  // The bearer comes from the app's ONE session, not a prop. A tab is only ever rendered by an unlocked
  // manager, so this is defined in practice; the effect still guards rather than opening a bare socket.
  const { session } = useSession();
  const sessionToken = session?.token;
  const hostRef = useRef<HTMLDivElement>(null);
  // Live handles kept in refs so the resize/fit effects can reach them without re-running the mount effect.
  const xtermRef = useRef<{ cols: number; rows: number; write(d: string): void; dispose(): void } | null>(null);
  const fitRef = useRef<{ fit(): void } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  // The server-confirmed sessionId for THIS tab (from the bind frame). Kept in a ref so the imperative
  // close control can reach it without re-running the mount effect.
  const sessionIdRef = useRef<string | null>(attachSessionId ?? null);
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
    // A tab is only rendered by an unlocked manager, but never open a bare socket on a re-lock race.
    if (!sessionToken) return;
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
        // Everything else is raw PTY output.
        const frame = parseControlFrame(raw);
        if (frame) {
          if (frame.type === 'error') {
            setState('error');
            setErrorReason(frame.reason);
            onError(id, frame.reason);
          } else {
            // Bind frame: record the confirmed sessionId (drives persistence + REST close).
            sessionIdRef.current = frame.sessionId;
            onSession(id, frame.sessionId);
          }
          return;
        }
        xterm.write(raw);
      };
      ws.onclose = (ev?: { reason?: string }) => {
        if (disposed) return;
        setState('closed');
        // A clean server-driven end (shell exited / operator close) drops the tab; an UNEXPECTED
        // disconnect (e.g. daemon restart, code 1006 / no reason) keeps the tab and its error display —
        // the next reload reconciles it against the live-session list.
        const reason = ev?.reason ?? '';
        if (reason === 'shell exited' || reason === 'closed by operator') onClosed(id);
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
        // Closing the socket only DETACHES the persistent shell server-side — it keeps running. A tab that
        // is truly being closed has already killed its shell via the close frame / REST DELETE.
        socketRef.current?.close();
      } catch {
        /* socket may not have opened */
      }
      xtermRef.current?.dispose();
      socketRef.current = null;
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [id, sessionToken, attachSessionId, spawn, socketFactory, onError, onSession, onClosed, fitAndResize]);

  // Publish an imperative close control so the manager's shared close button can tear down THIS tab's
  // persistent shell: a graceful `{type:'close'}` when the socket is live (the server kills + closes,
  // and `onclose` drops the tab), else a REST DELETE for a session whose socket is already gone.
  const requestClose = useCallback(() => {
    const ws = socketRef.current;
    const sessionId = sessionIdRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'close' }));
      } catch {
        onClosed(id);
      }
      return;
    }
    if (sessionId && sessionToken) void removeSession(sessionId, sessionToken);
    onClosed(id);
  }, [id, sessionToken, removeSession, onClosed]);

  useEffect(() => {
    registerControl(id, { requestClose });
    return () => registerControl(id, null);
  }, [id, registerControl, requestClose]);

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

  // One robustness refit once the web fonts have loaded. The first fit can run against fallback-font
  // metrics; when the mono face swaps in the cell size changes, which would otherwise leave the bottom row
  // clipped until the next resize. `document.fonts.ready` fires once; the guarded fit no-ops if hidden.
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
      {/* The `.terminal__surface` is the visual well (border/rounding/overflow/sunken shadow); the
          inner zero-padding `.terminal__screen` is what `xterm.open()` targets so FitAddon measures a
          true content box and the fitted row grid is never clipped by the well's padding + overflow. */}
      <div className="terminal__surface" data-testid={`terminal-surface-${id}`}>
        <div ref={hostRef} className="terminal__screen" data-testid={`terminal-screen-${id}`} />
      </div>
    </div>
  );
}

export interface TerminalProps {
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
  /** Persistence client (live-session list + REST kill). Injected in tests; defaults to the real fetch. */
  sessionsClient?: TerminalSessionsClient;
  /**
   * An agent the operator asked to run ("Run agent" on the Agents surface). Consumed ONCE: the view
   * opens a primed tab for it and calls {@link onAgentTargetConsumed}, so returning to the terminal
   * later never respawns the same agent behind the operator's back.
   */
  agentTarget?: string | null;
  onAgentTargetConsumed?: () => void;
  /**
   * A workflow the operator asked to run ("Run workflow" on a workflow's detail). Consumed ONCE, exactly
   * like {@link agentTarget}: the view opens a tab primed as the agent that runs that workflow and calls
   * {@link onWorkflowTargetConsumed}, so coming back to the terminal never respawns it unasked.
   */
  workflowTarget?: string | null;
  onWorkflowTargetConsumed?: () => void;
}

/** A tab plus a monotonically-increasing id so React keys stay stable across insert/remove. `sessionId`
 *  is the server-confirmed id (present once the bind frame lands — it is what gets persisted);
 *  `attachSessionId` is set only on a RESTORED tab, telling its socket to reattach via `?session=`. */
interface TabEntry {
  id: number;
  sessionId?: string;
  attachSessionId?: string;
  /** What this tab runs. Absent = the login shell. Restored tabs carry none: the server already knows
   *  what a live session is running, and inventing a mode client-side would be a second, lying source. */
  spawn?: PtySpawnTarget;
}

/** The tab-bar label for one tab. A primed tab is named by what it runs — its agent or its workflow —
 *  never by an ordinal shell number. The workflow's own reference is the label: deriving a prettier
 *  name here would be this view inventing an identity the server never sent it. */
export function tabLabel(tab: TabEntry, index: number): string {
  if (tab.spawn?.mode === 'agent' && tab.spawn.agentId) return tab.spawn.agentId;
  if (tab.spawn?.mode === 'workflow' && tab.spawn.workflowRef) return tab.spawn.workflowRef;
  if (tab.spawn?.mode === 'claude') return `claude ${index + 1}`;
  return `powershell ${index + 1}`;
}

/**
 * The terminal surface: a tab manager over independent `TerminalTab` shells. Session-gated through the
 * app's ONE unlock — locked it renders a calm line that runs the shared ceremony on click and opens
 * nothing; unlocked it opens one tab and lets the operator add up to `MAX_TERMINALS`.
 */
export function Terminal({
  visible = true,
  fleetIdentity = 'dashboard daemon user',
  socketFactory = defaultPtySocketFactory,
  sessionsClient = defaultTerminalSessionsClient,
  agentTarget = null,
  onAgentTargetConsumed,
  workflowTarget = null,
  onWorkflowTargetConsumed,
}: TerminalProps): React.JSX.Element {
  const { session, requireSession } = useSession();
  const sessionToken = session?.token;
  const [tabs, setTabs] = useState<TabEntry[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nextIdRef = useRef(1);
  const [signingIn, setSigningIn] = useState(false);
  // Per-tab imperative close controls, published by each TerminalTab (see `registerControl`).
  const closersRef = useRef(new Map<number, TabControl>());
  // Reconcile the persistent-session list against storage exactly ONCE per signed-in visible session.
  const reconciledRef = useRef(false);
  // The last agent target actually spawned. Reset to null whenever the caller clears the target, so the
  // SAME agent can be run again later; without the reset a second "Run agent" on one agent would no-op.
  const consumedAgentRef = useRef<string | null>(null);
  // The same consumed-once guard for "Run workflow", with the same reset-on-clear semantics.
  const consumedWorkflowRef = useRef<string | null>(null);
  // Latest tabs/consumed-callbacks, read by callbacks that must not re-identify on every render.
  const tabsRef = useRef<TabEntry[]>([]);
  const consumedCallbackRef = useRef<(() => void) | undefined>(onAgentTargetConsumed);
  const consumedWorkflowCallbackRef = useRef<(() => void) | undefined>(onWorkflowTargetConsumed);
  tabsRef.current = tabs;
  consumedCallbackRef.current = onAgentTargetConsumed;
  consumedWorkflowCallbackRef.current = onWorkflowTargetConsumed;

  const openTab = useCallback((spawn?: PtySpawnTarget) => {
    setTabs((prev) => {
      if (prev.length >= MAX_TERMINALS) return prev;
      const id = nextIdRef.current++;
      setActiveId(id);
      setNotice(null);
      return [...prev, { id, ...(spawn ? { spawn } : {}) }];
    });
  }, []);

  // Remove a tab from the LOCAL UI. It does NOT kill the server shell — callers that mean to end a shell
  // have already done so (close frame / REST DELETE / a server-driven close). The persistence effect
  // re-saves the remaining tabs, so a dropped id also leaves storage.
  const removeTab = useCallback((id: number) => {
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

  // Record the server-confirmed sessionId for a tab (from the bind frame) — this is what gets persisted.
  const handleTabSession = useCallback((id: number, sessionId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, sessionId } : t)));
  }, []);

  const registerControl = useCallback((id: number, control: TabControl | null) => {
    if (control) closersRef.current.set(id, control);
    else closersRef.current.delete(id);
  }, []);

  // The shared close button asks the tab to tear down its own (persistent) shell; if the tab published no
  // control yet, just drop it locally.
  const requestCloseTab = useCallback(
    (id: number) => {
      const control = closersRef.current.get(id);
      if (control) control.requestClose();
      else removeTab(id);
    },
    [removeTab],
  );

  /**
   * Flip a tab between agent-primed and plain claude. A PTY's program is fixed at spawn, so switching is
   * a RESPAWN, not a setting: the old shell is torn down through the same governed close path the ×
   * button uses, and a fresh tab opens in the other mode carrying the same agent id. The old tab lingers
   * until the server confirms its close, so a failed kill is visible rather than silently forgotten.
   */
  const setTabMode = useCallback(
    (id: number, mode: PtySpawnTarget['mode']) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab?.spawn || tab.spawn.mode === mode) return;
      const { agentId, workflowRef } = tab.spawn;
      if (mode === 'agent' && !agentId) return; // nothing to prime with; leave the tab alone
      // A tab that was never about a workflow has no workflow position to flip INTO.
      if (mode === 'workflow' && !workflowRef) return;
      requestCloseTab(id);
      openTab({ mode, ...(agentId ? { agentId } : {}), ...(workflowRef ? { workflowRef } : {}) });
    },
    [openTab, requestCloseTab],
  );

  // Stable per-manager error sink. `too-many-terminals` becomes an inline notice and drops the offending
  // tab (it never got a shell). A `session-not-found` means a remembered id is dead → drop it (storage is
  // rewritten by the persistence effect). Any other error stays visible inside its own panel.
  const handleTabError = useCallback(
    (id: number, reason: string) => {
      if (reason === 'too-many-terminals') {
        setNotice('The fleet already has the maximum number of terminals open. Close one and try again.');
        removeTab(id);
      } else if (reason === 'session-not-found') {
        removeTab(id);
      }
    },
    [removeTab],
  );

  // On becoming signed-in + visible, reconcile remembered tabs against the server's live sessions and
  // restore them (reattaching each via `?session=`); if nothing is restorable, open one fresh tab (today's
  // behaviour). App keeps this component mounted from startup, so a session minted by an unrelated governed
  // action while hidden must NOT spend a slot — hence the `visible` gate. Losing the session is a security
  // teardown that clears the LOCAL UI only; it must NOT kill the still-running shells NOR wipe storage
  // (a reload after re-auth restores them).
  useEffect(() => {
    if (!sessionToken) {
      setTabs([]);
      setActiveId(null);
      setNotice(null);
      reconciledRef.current = false;
      return;
    }
    if (!visible || reconciledRef.current) return;
    reconciledRef.current = true;
    let cancelled = false;
    void (async () => {
      const live = await sessionsClient.list(sessionToken);
      if (cancelled) return;
      const ordered = reconcileSessions(loadStoredTabs(), live).slice(0, MAX_TERMINALS);
      if (ordered.length > 0) {
        const restored: TabEntry[] = ordered.map((sessionId) => ({
          id: nextIdRef.current++,
          sessionId,
          attachSessionId: sessionId,
        }));
        setTabs(restored);
        setActiveId(restored[0].id);
        saveStoredTabs(ordered.map((sessionId) => ({ sessionId })));
      } else {
        // Functional, and only when the surface is still empty: a "Run agent" arrival can open its
        // primed tab while this list request is in flight, and a blank shell must not then race in
        // beside it. Whichever lands first wins; the operator never gets a phantom second tab.
        setTabs((prev) => {
          if (prev.length > 0) return prev;
          const id = nextIdRef.current++;
          setActiveId(id);
          return [{ id }];
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, visible, sessionsClient]);

  /**
   * "Run agent", one click from the Agents surface: open a tab running claude primed as that agent and
   * report the target consumed. Guarded by `consumedAgentRef` so a re-render (or the caller's own clear)
   * cannot spawn a second shell for the same request.
   */
  useEffect(() => {
    if (!agentTarget) {
      consumedAgentRef.current = null;
      return;
    }
    if (!sessionToken || !visible) return;
    if (consumedAgentRef.current === agentTarget) return;
    consumedAgentRef.current = agentTarget;
    openTab({ mode: 'agent', agentId: agentTarget });
    consumedCallbackRef.current?.();
  }, [agentTarget, sessionToken, visible, openTab]);

  /**
   * "Run workflow", one click from a workflow's detail: open a tab running claude primed as the agent
   * that runs that workflow. Same consumed-once guard as "Run agent" — the server resolves the ref to a
   * definition and to the agent that runs it; the browser only ever names the workflow.
   */
  useEffect(() => {
    if (!workflowTarget) {
      consumedWorkflowRef.current = null;
      return;
    }
    if (!sessionToken || !visible) return;
    if (consumedWorkflowRef.current === workflowTarget) return;
    consumedWorkflowRef.current = workflowTarget;
    openTab({ mode: 'workflow', workflowRef: workflowTarget });
    consumedWorkflowCallbackRef.current?.();
  }, [workflowTarget, sessionToken, visible, openTab]);

  // Persist the remembered tab order whenever it changes — only tabs with a confirmed sessionId, and only
  // while signed in (a session-loss teardown sets `tabs` to [] but must NOT wipe storage: the shells live).
  useEffect(() => {
    if (!sessionToken) return;
    saveStoredTabs(tabs.filter((t) => t.sessionId).map((t) => ({ sessionId: t.sessionId as string })));
  }, [tabs, sessionToken]);

  async function handleUnlock(): Promise<void> {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await requireSession();
    } finally {
      setSigningIn(false);
    }
  }

  const atCap = tabs.length >= MAX_TERMINALS;
  // The mode toggle belongs to the ACTIVE tab and only exists for tabs that run claude at all — a plain
  // shell has no "agent-primed" position to switch to.
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  const activeSpawn = activeTab?.spawn ?? null;

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
        <button
          type="button"
          className="terminal__signin mc-btn"
          onClick={() => void handleUnlock()}
          disabled={signingIn}
          data-testid="terminal-locked"
        >
          {signingIn ? 'Unlocking…' : 'Locked — unlock to open a terminal'}
        </button>
      ) : (
        <>
          <div className="terminal__tabbar" role="tablist" aria-label="Open terminals">
            {tabs.map((tab, index) => {
              const isActive = tab.id === activeId;
              const label = tabLabel(tab, index);
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
                    title={label}
                  >
                    {label}
                  </button>
                  <button
                    type="button"
                    className="terminal__tab-close"
                    onClick={() => requestCloseTab(tab.id)}
                    aria-label={`Close ${label}`}
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
              onClick={() => openTab()}
              disabled={atCap}
              aria-label="Open a new terminal"
              title={atCap ? `Maximum of ${MAX_TERMINALS} terminals reached` : 'Open a new terminal'}
              data-testid="terminal-tab-add"
            >
              +
            </button>
          </div>

          {activeSpawn && activeTab ? (
            <div className="terminal__mode" role="group" aria-label="Session mode" data-testid="terminal-mode">
              {/* The primed position belongs to whatever this tab was opened FOR. A workflow tab offers
                  its workflow; every other tab keeps the agent position exactly as it shipped. There is
                  no way to flip a non-workflow tab INTO a workflow. */}
              {activeSpawn.workflowRef ? (
                <button
                  type="button"
                  className={`terminal__mode-option${activeSpawn.mode === 'workflow' ? ' terminal__mode-option--on' : ''}`}
                  aria-pressed={activeSpawn.mode === 'workflow'}
                  onClick={() => setTabMode(activeTab.id, 'workflow')}
                  data-testid="terminal-mode-workflow"
                >
                  Running {activeSpawn.workflowRef}
                </button>
              ) : (
                <button
                  type="button"
                  className={`terminal__mode-option${activeSpawn.mode === 'agent' ? ' terminal__mode-option--on' : ''}`}
                  aria-pressed={activeSpawn.mode === 'agent'}
                  disabled={!activeSpawn.agentId}
                  onClick={() => setTabMode(activeTab.id, 'agent')}
                  data-testid="terminal-mode-agent"
                >
                  {activeSpawn.agentId ? `As ${activeSpawn.agentId}` : 'As an agent'}
                </button>
              )}
              <button
                type="button"
                className={`terminal__mode-option${activeSpawn.mode === 'claude' ? ' terminal__mode-option--on' : ''}`}
                aria-pressed={activeSpawn.mode === 'claude'}
                onClick={() => setTabMode(activeTab.id, 'claude')}
                data-testid="terminal-mode-claude"
              >
                Plain Claude
              </button>
              <span className="terminal__mode-note">Switching restarts this session.</span>
            </div>
          ) : null}

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
                attachSessionId={tab.attachSessionId}
                spawn={tab.spawn}
                active={visible && tab.id === activeId}
                socketFactory={socketFactory}
                removeSession={sessionsClient.remove}
                onError={handleTabError}
                onSession={handleTabSession}
                onClosed={removeTab}
                registerControl={registerControl}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
