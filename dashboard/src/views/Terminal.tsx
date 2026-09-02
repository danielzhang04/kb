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
import {
  browserSessionMessage,
  ensureBrowserSession as defaultEnsureBrowserSession,
} from '../lib/browserSessionClient';
import type { BrowserSessionOutcome } from '../lib/browserSessionClient';
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
  /**
   * How this workspace obtains the browser-session cookie. `GET /api/pty/sessions` resolves the SAME
   * browser principal the socket does, so the listing needs it too; it is passed down to every console.
   */
  ensureBrowserSession?: () => Promise<BrowserSessionOutcome>;
  /** Where the unavailable state's action goes (Health). */
  onOpenHealth?: () => void;
}

export function Terminal({
  ptyEnabled,
  visible = true,
  socketFactory = defaultPtySocketFactory,
  sessionsClient = defaultTerminalSessionsClient,
  ensureBrowserSession = defaultEnsureBrowserSession,
  onOpenHealth,
}: TerminalProps): React.JSX.Element {
  const { session, requireSession } = useSession();
  const sessionToken = session?.token;
  const runtimeCapability = useRuntimeCapabilities();
  /**
   * Fail-closed: the closed switch wins over whatever the capability payload CLAIMS. What it must not
   * do is overwrite a payload that already refuses — `App` derives `ptyEnabled` from `pty === true`, so
   * every genuinely closed host arrived here with the switch off, and substituting the local sentinel
   * threw away the host's real reason and detail. The operator was then told "Terminal is not available
   * on this host." (the sentinel's `node-pty-unavailable` copy) when the truth was a broker that was not
   * listening. A closed payload is already closed: keeping it grants nothing and explains everything.
   * Only a payload claiming `pty:true` against a false switch is replaced.
   */
  const capability: PublicPtyCapability = ptyEnabled || runtimeCapability.pty === false
    ? runtimeCapability
    : CLOSED_CAPABILITY;

  const [model, setModel] = useState<SessionWorkspaceModel>(() => createSessionWorkspaceModel(capability));
  const [panes, setPanes] = useState<PaneEntry[]>([]);
  const [rootId, setRootId] = useState<SafeRootId>('repo');
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [listNonce, setListNonce] = useState(0);
  const nextPaneIdRef = useRef(1);
  const listedRef = useRef(false);
  /**
   * The highest session-collection revision this workspace has seen, from a listing or from any frame
   * that carries one. It is the ordering fact that lets a re-list be judged: a listing older than what
   * frames already proved is a STALE answer, and applying it would delete rows the host still has.
   */
  const observedRevisionRef = useRef(-1);
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
    observedRevisionRef.current = -1;
    setPanes([]);
    setModel(createSessionWorkspaceModel(capability));
    setNotice(null);
    setPendingClose(null);
  }, [sessionToken, capability]);

  /**
   * Ask the HOST what sessions exist — on entering a signed-in visible workspace, and again whenever a
   * frame proves the collection moved past the revision this listing was taken at. A `null` answer is
   * "we could not ask" — it is reported, never rendered as "you have no sessions", because the second
   * would invite the operator to open a duplicate of a session they already own.
   *
   * The rows land in the model whether or not anything is attached. That is the whole point of a
   * WORKSPACE over host sessions: a session this browser has never attached to is still the operator's
   * session, and hiding it until they happen to open a console is how you get two shells in one root.
   */
  useEffect(() => {
    if (!sessionToken || !visible || !ptyEnabled || listedRef.current) return;
    listedRef.current = true;
    let cancelled = false;
    void (async () => {
      // The listing is browser-principal'd exactly like the socket (428 without the ref cookie), so the
      // workspace obtains a browser session before it asks. A definitive refusal is named here rather
      // than left to surface as the generic "could not read your sessions"; a transport failure falls
      // through to the listing, whose own `null` path already reports it.
      const browserSession = await ensureBrowserSession();
      if (cancelled) return;
      if (!browserSession.ok && browserSession.reason !== 'unreachable') {
        setNotice(browserSessionMessage(browserSession.reason));
        return;
      }
      const listing = await sessionsClient.list(sessionToken);
      if (cancelled) return;
      if (listing === null) {
        setNotice('The dashboard could not read your sessions. Reload to try again.');
        return;
      }
      // A listing older than a revision frames already proved is stale: keep the newer truth.
      if (listing.revision < observedRevisionRef.current) return;
      observedRevisionRef.current = listing.revision;
      setModel((current) => ({
        ...current,
        // SERVER ORDER, verbatim. The host decides the order of its own sessions; re-sorting here would
        // make two browsers disagree about a list neither of them owns.
        sessions: listing.sessions,
        selectedSessionId: listing.sessions.some((row) => row.sessionId === current.selectedSessionId)
          ? current.selectedSessionId
          : listing.sessions[0]?.sessionId ?? null,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, visible, ptyEnabled, sessionsClient, ensureBrowserSession, listNonce]);

  /** A frame carrying a newer revision retires the current listing and asks the host again. */
  const noteRevision = useCallback((revision: number) => {
    if (revision <= observedRevisionRef.current) return;
    observedRevisionRef.current = revision;
    listedRef.current = false;
    setListNonce((current) => current + 1);
  }, []);

  const foldFrame = useCallback((paneId: number, frame: BrowserServerFrame) => {
    setModel((current) => reduceSessionWorkspace(current, frame));
    if (frame.type === 'created' || frame.type === 'attached') {
      const sessionId = frame.session.sessionId;
      setPanes((current) => current.map((pane) => pane.paneId === paneId ? { ...pane, sessionId } : pane));
    }
    if ('revision' in frame && typeof frame.revision === 'number') noteRevision(frame.revision);
  }, [noteRevision]);

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
      ) : availability.kind === 'unavailable' || (model.sessions.length === 0 && panes.length === 0) ? (
        // Launcher-only is for a workspace with NOTHING in it. The old condition also fired whenever no
        // console happened to be mounted, so four listed host sessions rendered as "Start a session" —
        // the operator was told they had none while the host was running four.
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
                ensureBrowserSession={ensureBrowserSession}
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
