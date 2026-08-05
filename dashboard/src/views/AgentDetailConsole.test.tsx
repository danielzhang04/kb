// @vitest-environment jsdom
/**
 * The agent detail's EMBEDDED console — "Run agent" landing in the page instead of throwing the operator
 * at the Terminal destination.
 *
 * The headline test here is `remount reattaches, never respawns`. `EntityDetail` renders only its active
 * section, so every Overview↔Runs switch fully unmounts and remounts this console. A pane that spawned on
 * each remount would leak a shell per tab switch into the daemon's 8-terminal cap — shared with the
 * Terminal view's tabs — until the operator could not open a terminal anywhere in the app. The fake
 * server below mirrors the real one exactly on the point that makes reattaching possible: it stamps each
 * session with WHAT it was opened as, which is what `useAttachableSession` matches on.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

vi.mock('@xterm/xterm', () => {
  class FakeXTerm {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    write() {}
    onData() {}
    dispose() {}
  }
  return { Terminal: FakeXTerm };
});
vi.mock('@xterm/addon-fit', () => {
  class FakeFitAddon {
    fit() {}
  }
  return { FitAddon: FakeFitAddon };
});
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { AgentDetail, type AgentDetailRow } from './AgentDetail';
import type { PtySessionSummary, PtySpawnTarget, TerminalSessionsClient } from '../lib/terminalClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';

function agent(over: Partial<AgentDetailRow> & { id: string }): AgentDetailRow {
  return {
    display: null,
    role: null,
    working: false,
    current: null,
    projects: [],
    cardCount: 0,
    lastActive: null,
    declared: true,
    runnerBound: false,
    declaredRuntime: null,
    declaredModel: null,
    defaultProfile: null,
    allowedProfiles: null,
    description: null,
    ledger: { dispatches: 0, steps: 0, days: 0 },
    sources: [],
    ...over,
  };
}

class FakeWS {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed = false;
  attachSessionId: string | undefined;
  spawn: PtySpawnTarget | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev?: { reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.closed = true;
  }
}

/**
 * A fake daemon: opening a primed socket REGISTERS a live session stamped with its kind + target, exactly
 * as `server/pty/route.ts` now does at create time, and the session list reports those stamps back. Any
 * lesser fake (one that forgets what a session was for) would let a respawning console pass.
 */
function fakeDaemon() {
  const live: PtySessionSummary[] = [];
  const sockets: FakeWS[] = [];
  let n = 0;
  const socketFactory = vi.fn((_token: string, attachSessionId?: string, spawn?: PtySpawnTarget) => {
    const ws = new FakeWS();
    ws.attachSessionId = attachSessionId;
    ws.spawn = spawn;
    sockets.push(ws);
    if (attachSessionId === undefined) {
      const sessionId = `pty-${(n += 1)}`;
      live.push({
        sessionId,
        createdAt: Date.now(),
        attached: true,
        kind: spawn?.mode ?? 'shell',
        targetRef: spawn?.agentId ?? spawn?.workflowRef ?? null,
      });
    }
    return ws as unknown as WebSocket;
  });
  const sessionsClient: TerminalSessionsClient = {
    list: vi.fn(async () => [...live]),
    remove: vi.fn(async (sessionId: string) => {
      const i = live.findIndex((s) => s.sessionId === sessionId);
      if (i >= 0) live.splice(i, 1);
    }),
  };
  return {
    socketFactory,
    sessionsClient,
    sockets,
    live,
    /** Every socket that asked the server to OPEN a shell (as opposed to reattaching to one). */
    spawnCalls: () => socketFactory.mock.calls.filter((call) => call[1] === undefined),
    attachCalls: () => socketFactory.mock.calls.filter((call) => call[1] !== undefined),
  };
}

function unlocked(ui: React.ReactElement, token = 'tok-abc'): React.ReactElement {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

afterEach(() => {
  clearStoredSession();
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('AgentDetail — the embedded console', () => {
  it('"Run agent" starts a primed session IN THE PAGE and shows the tab it lives on', async () => {
    const daemon = fakeDaemon();
    render(
      unlocked(
        <AgentDetail
          agent={agent({ id: 'fyt-runner', declared: true })}
          socketFactory={daemon.socketFactory}
          sessionsClient={daemon.sessionsClient}
        />,
      ),
    );

    // Nothing is opened just by looking at an agent — a detail view that spawned a shell on arrival
    // would be a defect, not a convenience.
    await act(async () => Promise.resolve());
    expect(daemon.socketFactory).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-run'));
    });

    // The click moved the operator to Runs and opened the console there; it did NOT navigate anywhere.
    await waitFor(() => expect(screen.getByTestId('console-panel-agent')).toBeTruthy());
    expect(screen.getByTestId('entity-tab-runs').getAttribute('aria-selected')).toBe('true');
    expect(daemon.socketFactory).toHaveBeenCalledWith('tok-abc', undefined, {
      mode: 'agent',
      agentId: 'fyt-runner',
    });
    // The runs list the tab already carried is still there beside the console.
    expect(screen.getByTestId('agent-runs-unloaded')).toBeTruthy();
  });

  /**
   * ── THE regression this leg exists to prevent ──
   */
  it('remount reattaches, never respawns: exactly ONE spawn across a tab-switch round trip', async () => {
    const daemon = fakeDaemon();
    render(
      unlocked(
        <AgentDetail
          agent={agent({ id: 'fyt-runner', declared: true })}
          socketFactory={daemon.socketFactory}
          sessionsClient={daemon.sessionsClient}
        />,
      ),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-run'));
    });
    await waitFor(() => expect(daemon.spawnCalls()).toHaveLength(1));
    expect(daemon.live).toHaveLength(1);
    expect(daemon.live[0]).toMatchObject({ kind: 'agent', targetRef: 'fyt-runner' });
    const openedSessionId = daemon.live[0].sessionId;

    // Leave the tab. EntityDetail renders only the active section, so the console is fully UNMOUNTED.
    await act(async () => {
      fireEvent.click(screen.getByTestId('entity-tab-overview'));
    });
    expect(screen.queryByTestId('console-panel-agent')).toBeNull();

    // Come back.
    await act(async () => {
      fireEvent.click(screen.getByTestId('entity-tab-runs'));
    });
    await waitFor(() => expect(screen.getByTestId('console-panel-agent')).toBeTruthy());

    // 1. Still exactly ONE shell was ever opened — the round trip cost the cap nothing.
    expect(daemon.spawnCalls()).toHaveLength(1);
    expect(daemon.live).toHaveLength(1);
    // 2. The remount REATTACHED, to that same session, with no spawn parameter beside it.
    expect(daemon.attachCalls()).toHaveLength(1);
    expect(daemon.attachCalls()[0]).toEqual(['tok-abc', openedSessionId, undefined]);
    // 3. And the surface says so, rather than silently looking identical either way.
    expect(screen.getByTestId('agent-console-mode').textContent).toBe('attached');
  });

  it('shows an ALREADY-running session on arrival, without the operator asking twice', async () => {
    const daemon = fakeDaemon();
    daemon.live.push({
      sessionId: 'pty-existing',
      createdAt: 1,
      attached: false,
      kind: 'agent',
      targetRef: 'fyt-runner',
    });
    render(
      unlocked(
        <AgentDetail
          agent={agent({ id: 'fyt-runner', declared: true })}
          socketFactory={daemon.socketFactory}
          sessionsClient={daemon.sessionsClient}
        />,
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('entity-tab-runs'));
    });

    await waitFor(() => expect(screen.getByTestId('agent-console-mode').textContent).toBe('attached'));
    expect(daemon.spawnCalls()).toHaveLength(0);
    expect(daemon.attachCalls()[0]).toEqual(['tok-abc', 'pty-existing', undefined]);
  });

  it('ignores a live session belonging to a different agent', async () => {
    const daemon = fakeDaemon();
    daemon.live.push({
      sessionId: 'pty-someone-else',
      createdAt: 1,
      attached: false,
      kind: 'agent',
      targetRef: 'other-agent',
    });
    render(
      unlocked(
        <AgentDetail
          agent={agent({ id: 'fyt-runner', declared: true })}
          socketFactory={daemon.socketFactory}
          sessionsClient={daemon.sessionsClient}
        />,
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('entity-tab-runs'));
    });
    await waitFor(() => expect(screen.getByTestId('agent-console-idle')).toBeTruthy());
    expect(daemon.socketFactory).not.toHaveBeenCalled();
  });

  it('never renders a console before the live-session lookup settles', async () => {
    const daemon = fakeDaemon();
    let releaseList: (() => void) | null = null;
    daemon.sessionsClient.list = vi.fn(
      () =>
        new Promise<PtySessionSummary[]>((resolve) => {
          releaseList = () => resolve([...daemon.live]);
        }),
    );
    render(
      unlocked(
        <AgentDetail
          agent={agent({ id: 'fyt-runner', declared: true })}
          socketFactory={daemon.socketFactory}
          sessionsClient={daemon.sessionsClient}
        />,
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-run'));
    });

    // The operator has asked for a session, but we do not yet know whether one is already running. Opening
    // one here is exactly the respawn bug, so nothing is opened.
    expect(screen.getByTestId('agent-console-loading')).toBeTruthy();
    expect(daemon.socketFactory).not.toHaveBeenCalled();

    await act(async () => {
      releaseList?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(daemon.spawnCalls()).toHaveLength(1));
  });

  it('renders the daemon-wide 8-terminal refusal IN PLACE, never as a navigation', async () => {
    const daemon = fakeDaemon();
    render(
      unlocked(
        <AgentDetail
          agent={agent({ id: 'fyt-runner', declared: true })}
          socketFactory={daemon.socketFactory}
          sessionsClient={daemon.sessionsClient}
        />,
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-run'));
    });
    await waitFor(() => expect(daemon.sockets).toHaveLength(1));

    await act(async () => {
      daemon.sockets[0].onmessage?.({ data: JSON.stringify({ type: 'error', reason: 'too-many-terminals' }) });
    });

    // Operator language in the console area...
    expect(screen.getByTestId('agent-console-notice').textContent).toMatch(/maximum number of terminals/i);
    // ...and the raw reason inside the pane itself. The operator stays on the agent either way.
    expect(screen.getByTestId('console-panel-error-agent').textContent).toContain('too-many-terminals');
    expect(screen.getByTestId('entity-detail-agent')).toBeTruthy();
  });

  it('ending the session returns the console to its idle state', async () => {
    const daemon = fakeDaemon();
    render(
      unlocked(
        <AgentDetail
          agent={agent({ id: 'fyt-runner', declared: true })}
          socketFactory={daemon.socketFactory}
          sessionsClient={daemon.sessionsClient}
        />,
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-run'));
    });
    await waitFor(() => expect(daemon.sockets).toHaveLength(1));
    await act(async () => {
      daemon.sockets[0].onopen?.();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-console-close'));
    });
    expect(daemon.sockets[0].sent).toContain(JSON.stringify({ type: 'close' }));

    await act(async () => {
      daemon.sockets[0].onclose?.({ reason: 'closed by operator' });
    });
    await waitFor(() => expect(screen.getByTestId('agent-console-idle')).toBeTruthy());
  });

  it('offers no console (and no Run agent) for an agent with no definition file', async () => {
    const daemon = fakeDaemon();
    render(
      unlocked(
        <AgentDetail
          agent={agent({ id: 'observed-only', declared: false })}
          socketFactory={daemon.socketFactory}
          sessionsClient={daemon.sessionsClient}
        />,
      ),
    );
    expect(screen.queryByTestId('agent-run')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('entity-tab-runs'));
    });
    expect(screen.getByTestId('agent-console-undeclared')).toBeTruthy();
    expect(daemon.socketFactory).not.toHaveBeenCalled();
  });

  it('locked, it offers the shared unlock ceremony and connects nothing', async () => {
    const daemon = fakeDaemon();
    render(
      <SessionProvider>
        <AgentDetail
          agent={agent({ id: 'fyt-runner', declared: true })}
          socketFactory={daemon.socketFactory}
          sessionsClient={daemon.sessionsClient}
        />
      </SessionProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-run'));
    });
    expect(screen.getByTestId('agent-console-locked')).toBeTruthy();
    expect(daemon.socketFactory).not.toHaveBeenCalled();
  });

  it('renders standalone, with no session provider above it, without throwing', async () => {
    // The agent detail is a presentational surface and is legitimately rendered from a literal fixture.
    render(<AgentDetail agent={agent({ id: 'fyt-runner', declared: true })} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('entity-tab-runs'));
    });
    expect(screen.getByTestId('agent-console-locked')).toBeTruthy();
  });
});
