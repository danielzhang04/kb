/**
 * D3.2 — the PTY terminal view: a TAB MANAGER over `<ConsolePane>`.
 *
 * Each tab is an INDEPENDENT shell — its own WebSocket to the governed `/api/pty` endpoint and its own
 * xterm instance — but none of that lives here any more. The whole pane (xterm lifecycle, socket,
 * control-frame protocol, fit/resize, close control, connection-state rendering) is
 * `src/console/ConsolePane.tsx`, so an agent's or workflow's detail can embed the SAME console instead
 * of forking a second implementation. What remains here is exactly the manager's job: the tab list, the
 * local mirror of the server's 8-terminal cap, localStorage tab persistence + reconciliation, the
 * one-shot "Run agent"/"Run workflow" target consumption, the mode toggle, and the page chrome.
 *
 * This view is session-gated exactly like `Vibe.tsx`/`Control.tsx`'s launch surface: without a session it
 * renders a calm locked line and connects nothing. Each pane's WebSocket carries the SAME bearer session
 * token via a subprotocol (never in the URL, which would land the token in logs); the SERVER runs the same
 * `Origin`/`Host` allowlist check as every other socket on the upgrade, then re-verifies the session before
 * streaming. The server enforces a hard cap of 8 concurrent terminals across the whole daemon — the `+`
 * button is disabled once 8 tabs are open locally, and a server-side
 * `{"type":"error","reason":"too-many-terminals"}` frame is surfaced as an inline notice (never a crash).
 * That cap is now SHARED with embedded consoles elsewhere in the app, which is why the pane also renders
 * the refusal in place.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import '../styles/views/terminal.css';
import { useSession } from '../lib/sessionContext';
import { ConsolePane } from '../console/ConsolePane';
import type { ConsoleControl, ConsoleTarget } from '../console/ConsolePane';
import {
  defaultPtySocketFactory,
  defaultTerminalSessionsClient,
  loadStoredTabs,
  reconcileSessions,
  saveStoredTabs,
} from '../lib/terminalClient';
import type { PtySocketFactory, PtySpawnTarget, TerminalSessionsClient } from '../lib/terminalClient';

/** The hard cap the server enforces across the whole daemon; the `+` button mirrors it locally. */
const MAX_TERMINALS = 8;

export interface TerminalProps {
  /** PTY is unavailable on the Linux VM; default preserves the established Windows behaviour. */
  ptyEnabled?: boolean;
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
   * An agent the operator asked to run from a surface that has no console of its own. Consumed ONCE: the
   * view opens a primed tab for it and calls {@link onAgentTargetConsumed}, so returning to the terminal
   * later never respawns the same agent behind the operator's back. The agent DETAIL no longer uses this
   * path — it runs its agent in its own embedded console — but the roster's row action still does.
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

/** One tab's console target. A RESTORED tab reattaches; every other tab spawns (an absent `spawn` being
 *  the login shell). The two are mutually exclusive by construction now — the old prop pair let both be
 *  set at once and silently dropped the spawn. */
export function tabTarget(tab: TabEntry): ConsoleTarget {
  if (tab.attachSessionId) return { mode: 'attach', sessionId: tab.attachSessionId };
  return { mode: 'spawn', ...(tab.spawn ? { spawn: tab.spawn } : {}) };
}

/**
 * The terminal surface: a tab manager over independent `<ConsolePane>` shells. Session-gated through the
 * app's ONE unlock — locked it renders a calm line that runs the shared ceremony on click and opens
 * nothing; unlocked it opens one tab and lets the operator add up to `MAX_TERMINALS`.
 */
export function Terminal({
  ptyEnabled = true,
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
  // Per-tab imperative close controls, published by each ConsolePane (see `registerControl`).
  const closersRef = useRef(new Map<number, ConsoleControl>());
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

  const registerControl = useCallback((id: number, control: ConsoleControl | null) => {
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
  // rewritten by the persistence effect). Any other error stays visible inside its own pane.
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
   * "Run agent" from a surface with no console of its own: open a tab running claude primed as that
   * agent and report the target consumed. Guarded by `consumedAgentRef` so a re-render (or the caller's
   * own clear) cannot spawn a second shell for the same request.
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

  if (!ptyEnabled) {
    return (
      <section className="terminal" aria-label="Terminal view" aria-hidden={!visible}>
        <header className="terminal__header"><h2 className="terminal__title">Terminal</h2></header>
        <p className="terminal__note" role="note">Terminal is disabled on this host.</p>
      </section>
    );
  }

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
              <ConsolePane
                key={tab.id}
                target={tabTarget(tab)}
                visible={visible && tab.id === activeId}
                socketFactory={socketFactory}
                sessionsClient={sessionsClient}
                onError={(reason) => handleTabError(tab.id, reason)}
                onSession={(sessionId) => handleTabSession(tab.id, sessionId)}
                onExit={() => removeTab(tab.id)}
                registerControl={(control) => registerControl(tab.id, control)}
                testIdSuffix={`-${tab.id}`}
                role="tabpanel"
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
