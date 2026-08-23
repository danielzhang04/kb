/**
 * P3 W6.4 — the named Terminal workspace, mounted full-viewport.
 *
 * Terminal is one WORKSPACE over named host sessions, not a bag of browser-local tabs. What a session is
 * — its name, its launcher, its root, its state, whether anyone is attached — is the SERVER's answer,
 * arriving as `session`/`created`/`attached`/`exit` frames and folded by W4's `reduceSessionWorkspace`.
 * Nothing about a session is remembered in this browser: there is no localStorage, because a remembered
 * tab list can only ever disagree with the host, and when it does the host is right.
 *
 * Capability is FAIL-CLOSED. `ptyEnabled` is a required prop with no default: a surface that cannot
 * prove the host has a PTY renders the closed state and opens no socket. The old `ptyEnabled = true`
 * default made "we could not ask" indistinguishable from "yes", which is the wrong way for a switch that
 * gates process execution to fail.
 *
 * The rail: App collapses the sidebar on this destination and keeps this component mounted across every
 * other destination, so a live session and its scrollback survive navigation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/views/terminal.css';
import { useSession } from '../lib/sessionContext';
import { useRuntimeCapabilities } from '../lib/runtimeCapabilities';
import { ConsolePane } from '../console/ConsolePane';
import type { ConsoleControl, ConsoleTarget } from '../console/ConsolePane';
import {
  createSessionWorkspaceModel,
  reduceSessionWorkspace,
} from '../console/sessionWorkspaceModel';
import type { SessionWorkspaceModel } from '../console/sessionWorkspaceModel';
import { TerminalSessionEmpty } from './TerminalSessionEmpty';
import { TerminalSessionHeader } from './TerminalSessionHeader';
import { defaultPtySocketFactory, defaultTerminalSessionsClient } from '../lib/terminalClient';
import type { PtySocketFactory, TerminalSessionsClient } from '../lib/terminalClient';
import type {
  BrowserServerFrame,
  PublicPtyCapability,
  SafeRootId,
  SessionLauncher,
  SessionSummary,
} from '../../shared/ptyProtocol.ts';

/** The closed capability a fail-closed switch resolves to; never advertises a launcher or a root. */
const CLOSED_CAPABILITY: PublicPtyCapability = {
  pty: false,
  diagnostic: { reason: 'node-pty-unavailable', detail: null, checkedAt: '' },
};

/** One mounted console. `paneId` keys React across insert/remove; a create pane has no id until the
 *  host mints one, which is exactly why the pane — not the session — is the key. */
interface PaneEntry {
  paneId: number;
  target: ConsoleTarget;
  /** The host-confirmed session id, once `created`/`attached` lands. */
  sessionId: string | null;
}

export interface TerminalProps {
  /**
   * Whether this host actually has a PTY. REQUIRED and fail-closed — there is no default, so a caller
   * that has not resolved the capability cannot accidentally advertise a terminal.
   */
  ptyEnabled: boolean;
  /**
   * Whether the App-level terminal surface is currently in front. App keeps this component mounted while
   * another destination is showing so live sessions and scrollback survive navigation; a hidden
   * workspace never lists, never attaches, and never creates.
   */
  visible?: boolean;
  socketFactory?: PtySocketFactory;
  sessionsClient?: TerminalSessionsClient;
  /** Where the unavailable state's action goes (Health). */
  onOpenHealth?: () => void;
}

export function Terminal({
  ptyEnabled,
  visible = true,
  socketFactory = defaultPtySocketFactory,
  sessionsClient = defaultTerminalSessionsClient,
  onOpenHealth,
}: TerminalProps): React.JSX.Element {
  const { session, requireSession } = useSession();
  const sessionToken = session?.token;
  const runtimeCapability = useRuntimeCapabilities();
  // Fail-closed: the closed switch wins over whatever the capability payload claims.
  const capability: PublicPtyCapability = ptyEnabled ? runtimeCapability : CLOSED_CAPABILITY;

  const [model, setModel] = useState<SessionWorkspaceModel>(() => createSessionWorkspaceModel(capability));
  const [panes, setPanes] = useState<PaneEntry[]>([]);
  const [rootId, setRootId] = useState<SafeRootId>('repo');
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const nextPaneIdRef = useRef(1);
  const listedRef = useRef(false);
  const controlsRef = useRef(new Map<number, ConsoleControl>());

  // Availability is derived from the capability; a capability change re-seats the whole workspace.
  useEffect(() => {
    setModel((current) => ({ ...createSessionWorkspaceModel(capability), sessions: current.sessions,
      attachments: current.attachments, selectedSessionId: current.selectedSessionId }));
  }, [capability]);

  // Session loss is a security teardown of the LOCAL surface only: the host sessions keep running.
  useEffect(() => {
    if (sessionToken) return;
    listedRef.current = false;
    setPanes([]);
    setModel(createSessionWorkspaceModel(capability));
    setNotice(null);
    setPendingClose(null);
  }, [sessionToken, capability]);

  /**
   * Ask the HOST what sessions exist, exactly once per signed-in visible workspace. A `null` answer is
   * "we could not ask" — it is reported, never rendered as "you have no sessions", because the second
   * would invite the operator to open a duplicate of a session they already own.
   */
  useEffect(() => {
    if (!sessionToken || !visible || !ptyEnabled || listedRef.current) return;
    listedRef.current = true;
    let cancelled = false;
    void (async () => {
      const listing = await sessionsClient.list(sessionToken);
      if (cancelled) return;
      if (listing === null) {
        setNotice('The dashboard could not read your sessions. Reload to try again.');
        return;
      }
      setModel((current) => ({
        ...current,
        sessions: listing.sessions,
        selectedSessionId: current.selectedSessionId ?? listing.sessions[0]?.sessionId ?? null,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, visible, ptyEnabled, sessionsClient]);

  const foldFrame = useCallback((paneId: number, frame: BrowserServerFrame) => {
    setModel((current) => reduceSessionWorkspace(current, frame));
    if (frame.type === 'created' || frame.type === 'attached') {
      const sessionId = frame.session.sessionId;
      setPanes((current) => current.map((pane) => pane.paneId === paneId ? { ...pane, sessionId } : pane));
    }
  }, []);

  const noteSession = useCallback((session: SessionSummary) => {
    setModel((current) => reduceSessionWorkspace(current, {
      type: 'session', requestId: null, revision: 0, session,
    }));
  }, []);

  const launch = useCallback((launcher: SessionLauncher) => {
    const paneId = nextPaneIdRef.current++;
    setNotice(null);
    setPanes((current) => [...current, {
      paneId,
      target: { mode: 'create', launcher, rootId, relativeCwd: '.' },
      sessionId: null,
    }]);
  }, [rootId]);

  /** Selecting a session mounts its console if this workspace has not attached to it yet. */
  const selectSession = useCallback((sessionId: string) => {
    setModel((current) => ({ ...current, selectedSessionId: sessionId }));
    setPanes((current) => current.some((pane) => pane.sessionId === sessionId)
      ? current
      : [...current, { paneId: nextPaneIdRef.current++, target: { mode: 'attach', sessionId }, sessionId }]);
  }, []);

  const registerControl = useCallback((paneId: number, control: ConsoleControl | null) => {
    if (control) controlsRef.current.set(paneId, control);
    else controlsRef.current.delete(paneId);
  }, []);

  const selectedPane = useMemo(
    () => panes.find((pane) => pane.sessionId !== null && pane.sessionId === model.selectedSessionId)
      ?? panes.find((pane) => pane.sessionId === null)
      ?? null,
    [panes, model.selectedSessionId],
  );

  const detachSelected = useCallback(() => {
    if (!selectedPane) return;
    controlsRef.current.get(selectedPane.paneId)?.requestDetach();
  }, [selectedPane]);

  // Closing an ACTIVE session is confirmed: it ends a real process, and the operator says so twice.
  const confirmClose = useCallback(() => {
    if (!selectedPane) return;
    controlsRef.current.get(selectedPane.paneId)?.requestClose();
    setPendingClose(null);
  }, [selectedPane]);

  async function handleUnlock(): Promise<void> {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await requireSession();
    } finally {
      setSigningIn(false);
    }
  }

  const availability = model.availability;
  const selectedSession = model.sessions.find((entry) => entry.sessionId === model.selectedSessionId) ?? null;

  return (
    <section className="terminal" aria-label="Terminal view" data-testid="terminal-workspace">
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
      ) : availability.kind === 'unavailable' || panes.length === 0 ? (
        <div className="terminal__empty" data-testid="terminal-empty">
          <TerminalSessionEmpty
            availability={availability}
            onLaunch={launch}
            onOpenHealth={() => onOpenHealth?.()}
          />
          {notice ? <p className="terminal__notice" role="status" data-testid="terminal-notice">{notice}</p> : null}
        </div>
      ) : (
        <>
          <div className="terminal__chrome">
            <TerminalSessionHeader model={model} onSelectSession={selectSession} />
            <div className="terminal__controls">
              <span className="terminal__host" data-testid="terminal-host">
                {availability.hostLabel}
              </span>
              <label className="terminal__root">
                <span>Root</span>
                <select
                  value={rootId}
                  onChange={(event) => setRootId(event.target.value as SafeRootId)}
                  data-testid="terminal-root"
                >
                  {availability.roots.map((root) => <option key={root} value={root}>{root}</option>)}
                </select>
              </label>
              {availability.launchers.map((launcher) => (
                <button
                  key={launcher}
                  type="button"
                  className="terminal__launcher"
                  onClick={() => launch(launcher)}
                  data-testid={`terminal-launch-${launcher}`}
                >
                  New {launcher}
                </button>
              ))}
              <button
                type="button"
                className="terminal__detach"
                onClick={detachSelected}
                disabled={!selectedPane}
                data-testid="terminal-detach"
              >
                Detach
              </button>
              <button
                type="button"
                className="terminal__close"
                onClick={() => setPendingClose(model.selectedSessionId)}
                disabled={!selectedPane}
                data-testid="terminal-close"
              >
                Close
              </button>
            </div>
            {pendingClose ? (
              <p className="terminal__confirm" role="alertdialog" aria-label="Confirm close" data-testid="terminal-confirm">
                End {selectedSession?.name ?? 'this session'}? Its process stops.
                <button type="button" onClick={confirmClose} data-testid="terminal-confirm-yes">End session</button>
                <button type="button" onClick={() => setPendingClose(null)} data-testid="terminal-confirm-no">Keep it</button>
              </p>
            ) : null}
            {notice ? <p className="terminal__notice" role="status" data-testid="terminal-notice">{notice}</p> : null}
          </div>

          <div className="terminal__panels">
            {panes.map((pane) => (
              <ConsolePane
                key={pane.paneId}
                target={pane.target}
                visible={visible && pane.paneId === selectedPane?.paneId}
                socketFactory={socketFactory}
                sessionsClient={sessionsClient}
                onServerFrame={(frame) => foldFrame(pane.paneId, frame)}
                onSession={noteSession}
                registerControl={(control) => registerControl(pane.paneId, control)}
                testIdSuffix={`-${pane.paneId}`}
                role="tabpanel"
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
