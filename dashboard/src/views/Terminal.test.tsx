// @vitest-environment jsdom
/**
 * D3.2 — component tests for the multi-tab PTY terminal view (`Terminal.tsx`), now covering PERSISTENT
 * sessions. The socket is injected (fake `socketFactory`) and the persistence client is injected (fake
 * `sessionsClient`), so these tests never open a real WebSocket nor hit the network; a mocked
 * `@xterm/xterm` + `@xterm/addon-fit` keep them off a real DOM/canvas terminal. They prove: no session
 * connects nothing; a session with no live shells opens one tab; reconciliation restores live sessions
 * (and drops dead ones) on mount; the `{type:'session'}` bind frame is persisted; and the close button
 * sends a `{type:'close'}` frame and clears storage.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent, within } from '@testing-library/react';

// jsdom has no matchMedia; a real xterm instance (should the mock ever miss under concurrent dynamic
// imports) calls it during construction. Stub it so a stray real-xterm mount can never crash the suite.
beforeAll(() => {
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

/** Fake xterm instances captured via `vi.hoisted` so the mock factory (hoisted above imports) can reach them. */
const xtermReg = vi.hoisted(() => {
  const instances: Array<{ writes: string[]; dataCb: ((d: string) => void) | null; disposed: boolean }> = [];
  return { instances };
});
const fitReg = vi.hoisted(() => {
  const instances: Array<{ calls: number }> = [];
  return { instances };
});

vi.mock('@xterm/xterm', () => {
  class FakeXTerm {
    cols = 80;
    rows = 24;
    writes: string[] = [];
    dataCb: ((d: string) => void) | null = null;
    disposed = false;
    constructor() {
      xtermReg.instances.push(this);
    }
    loadAddon() {}
    open() {}
    write(d: string) {
      this.writes.push(d);
    }
    onData(cb: (d: string) => void) {
      this.dataCb = cb;
    }
    dispose() {
      this.disposed = true;
    }
  }
  return { Terminal: FakeXTerm };
});
vi.mock('@xterm/addon-fit', () => {
  class FakeFitAddon {
    calls = 0;
    constructor() {
      fitReg.instances.push(this);
    }
    fit() {
      this.calls += 1;
    }
  }
  return { FitAddon: FakeFitAddon };
});
// The component imports the xterm CSS as a side effect; stub it so jsdom/vitest doesn't parse a real sheet.
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { Terminal } from './Terminal';
// `ptyQuery` and the spawn/socket types moved to `lib/terminalClient` with the ConsolePane extraction:
// the pane and this manager now share ONE URL builder instead of the view owning the pty HTTP surface.
import { ptyQuery } from '../lib/terminalClient';
import type { PtySessionSummary, PtySpawnTarget, TerminalSessionsClient } from '../lib/terminalClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';
/** The app's ONE unlock, driven from a test: a stored fresh bearer read by the provider on mount. */
function unlocked(ui: React.ReactElement, token = 'tok-abc'): React.ReactElement {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

/** A fake browser WebSocket: the component assigns onopen/onmessage/onclose/onerror + calls send/close. */
class FakeWS {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed = false;
  protocols: string[] | undefined;
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
  /** Parsed view of the control frames the component sent back toward the server. */
  controls(): Array<Record<string, unknown>> {
    return this.sent
      .map((s) => {
        try {
          return JSON.parse(s) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((v): v is Record<string, unknown> => v !== null);
  }
}

afterEach(() => {
  clearStoredSession();
  cleanup();
  xtermReg.instances.length = 0;
  fitReg.instances.length = 0;
  localStorage.clear();
  vi.clearAllMocks();
});

/** A socket factory that hands out (and records) a fresh FakeWS per tab, capturing its attach id. */
function makeFactory() {
  const sockets: FakeWS[] = [];
  const factory = vi.fn((token: string, attachSessionId?: string, spawn?: PtySpawnTarget) => {
    const ws = new FakeWS();
    ws.protocols = ['kb-pty.v1', token];
    ws.attachSessionId = attachSessionId;
    ws.spawn = spawn;
    sockets.push(ws);
    return ws as unknown as WebSocket;
  });
  return { factory, sockets };
}

/** A fake persistence client: `list` returns the given live sessions, `remove` is a spy. */
function makeSessionsClient(live: PtySessionSummary[] = []): TerminalSessionsClient & {
  list: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    list: vi.fn(async () => live),
    remove: vi.fn(async () => {}),
  };
}

const STORAGE_KEY = 'kb-terminal-tabs-v1';

describe('Terminal — session gating + subprotocol token', () => {
  it('locked, it renders one calm unlock line and never opens a socket', () => {
    const factory = vi.fn();
    render(
      <SessionProvider>
        <Terminal socketFactory={factory as unknown as (t: string) => WebSocket} sessionsClient={makeSessionsClient()} />
      </SessionProvider>,
    );
    expect(factory).not.toHaveBeenCalled();
    expect(screen.getByTestId('terminal-locked').textContent).toMatch(/^Locked — unlock/);
  });

  it('opens one tab automatically once signed in with no live shells, carrying the bearer in the subprotocol', async () => {
    const { factory, sockets } = makeFactory();
    render(unlocked(<Terminal socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    await waitFor(() => expect(sockets.length).toBe(1));
    // A fresh tab has no attach id and no spawn target — it is the plain login shell.
    expect(factory).toHaveBeenCalledWith('tok-abc', undefined, undefined);
    expect(sockets[0].protocols).toEqual(['kb-pty.v1', 'tok-abc']);
    expect(screen.getByTestId('terminal-tab-1')).toBeTruthy();
    expect(screen.getByTestId('terminal-identity').textContent).toMatch(/dashboard daemon user/i);
    expect(screen.getByRole('note').textContent).toMatch(/cross-user isolation.*not active/i);
  });

  it('does not auto-spawn while hidden, then preserves the same shell across hide/show', async () => {
    const { factory, sockets } = makeFactory();
    const client = makeSessionsClient();
    const { rerender } = render(
      unlocked(<Terminal visible={false} socketFactory={factory} sessionsClient={client} />),
    );

    await act(async () => Promise.resolve());
    expect(factory).not.toHaveBeenCalled();

    rerender(unlocked(<Terminal visible socketFactory={factory} sessionsClient={client} />));
    await waitFor(() => expect(sockets.length).toBe(1));
    const firstSocket = sockets[0];
    const firstTab = screen.getByTestId('terminal-tab-1');
    const screenHost = screen.getByTestId('console-screen-1');
    Object.defineProperty(screenHost, 'offsetParent', { configurable: true, value: document.body });

    rerender(unlocked(<Terminal visible={false} socketFactory={factory} sessionsClient={client} />));
    expect(firstSocket.closed).toBe(false);
    expect(screen.getByTestId('terminal-tab-1')).toBe(firstTab);

    rerender(unlocked(<Terminal visible socketFactory={factory} sessionsClient={client} />));
    await act(async () => Promise.resolve());
    expect(sockets).toHaveLength(1); // returning reuses the live shell; it never opens a duplicate socket
    expect(firstSocket.closed).toBe(false);
    expect(screen.getByTestId('terminal-tab-1')).toBe(firstTab);
    await waitFor(() => expect(fitReg.instances[0].calls).toBeGreaterThan(0));
  });
});

describe('Terminal — persistence + reconciliation', () => {
  it('restores live remembered sessions in order, drops dead ones, and adopts unremembered live sessions', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ sessionId: 'pty-live' }, { sessionId: 'pty-dead' }]));
    const { factory, sockets } = makeFactory();
    const client = makeSessionsClient([
      { sessionId: 'pty-live', createdAt: 1, attached: false },
      { sessionId: 'pty-new', createdAt: 2, attached: false },
    ]);
    render(unlocked(<Terminal socketFactory={factory} sessionsClient={client} />));

    await waitFor(() => expect(sockets.length).toBe(2));
    const attachIds = sockets.map((s) => s.attachSessionId);
    expect(attachIds).toEqual(['pty-live', 'pty-new']); // dead 'pty-dead' dropped; 'pty-new' adopted
    // Storage is rewritten to the restored order.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([
      { sessionId: 'pty-live' },
      { sessionId: 'pty-new' },
    ]);
  });

  it('persists a tab once it receives its {type:session} bind frame', async () => {
    const { factory, sockets } = makeFactory();
    render(unlocked(<Terminal socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    await waitFor(() => expect(sockets[0]?.onmessage).toBeTruthy());

    // A fresh tab is not persisted until its sessionId is confirmed.
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify([]));

    await act(async () => {
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'session', sessionId: 'pty-bound' }) });
    });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([{ sessionId: 'pty-bound' }]),
    );
  });

  it('the close button sends a {type:close} frame on a live socket, then clears the tab + storage on close', async () => {
    const { factory, sockets } = makeFactory();
    render(unlocked(<Terminal socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    await waitFor(() => expect(sockets[0]?.onmessage).toBeTruthy());
    const ws = sockets[0];
    await act(async () => {
      ws.onopen?.();
      ws.onmessage?.({ data: JSON.stringify({ type: 'session', sessionId: 'pty-bound' }) });
    });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([{ sessionId: 'pty-bound' }]),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('terminal-tab-close-1'));
    });
    // Graceful close: a close frame is sent; the shell is killed server-side, not merely detached.
    expect(ws.controls()).toContainEqual({ type: 'close' });

    // The server then closes the socket; the tab is dropped and storage rewritten to empty.
    await act(async () => {
      ws.onclose?.({ reason: 'closed by operator' });
    });
    await waitFor(() => expect(screen.queryByTestId('terminal-tab-1')).toBeNull());
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([]);
  });
});

describe('Terminal — streaming', () => {
  it('streams raw PTY bytes into xterm and keystrokes back to the socket', async () => {
    const { factory, sockets } = makeFactory();
    render(unlocked(<Terminal socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    await waitFor(() => expect(sockets[0]?.onmessage).toBeTruthy());
    const ws = sockets[0];

    await act(async () => {
      ws.onopen?.();
    });

    const term = xtermReg.instances[0];
    await act(async () => {
      ws.onmessage?.({ data: 'hello from the shell' });
    });
    expect(term.writes).toContain('hello from the shell');

    act(() => {
      term.dataCb?.('ls -la\r');
    });
    expect(ws.sent).toContain('ls -la\r');
  });
});

describe('Terminal — tabs', () => {
  it('opens an independent shell per tab up to the cap of 8, then disables +', async () => {
    const { factory, sockets } = makeFactory();
    render(unlocked(<Terminal socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    await waitFor(() => expect(sockets.length).toBe(1));

    const add = screen.getByTestId('terminal-tab-add');
    for (let i = 0; i < 7; i++) {
      await act(async () => {
        fireEvent.click(add);
      });
    }
    await waitFor(() => expect(sockets.length).toBe(8));
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });

  it('surfaces a too-many-terminals server error frame as an inline notice and drops that tab', async () => {
    const { factory, sockets } = makeFactory();
    render(unlocked(<Terminal socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    await waitFor(() => expect(sockets[0]?.onmessage).toBeTruthy());

    await act(async () => {
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'error', reason: 'too-many-terminals' }) });
    });
    expect(screen.getByTestId('terminal-notice')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('terminal-tab-1')).toBeNull());
  });
});

/**
 * "Run agent": one click on the Agents surface has to land the operator in a live session already
 * primed as that agent. The browser only ever NAMES the agent — the server resolves it to a file and
 * refuses anything not on its roster — so what these pin is the wire shape and the respawn semantics.
 */
describe('Terminal — agent-primed sessions', () => {
  it('encodes the upgrade query for attach, agent-primed, plain claude, and the default shell', () => {
    expect(ptyQuery(undefined, undefined)).toBe('');
    expect(ptyQuery('pty-9')).toBe('?session=pty-9');
    expect(ptyQuery(undefined, { mode: 'claude' })).toBe('?spawn=claude');
    expect(ptyQuery(undefined, { mode: 'agent', agentId: 'fyt-runner' })).toBe('?spawn=agent&agent=fyt-runner');
    // An attach reuses a live shell: it wins, and no spawn parameter is emitted alongside it (the
    // server refuses that combination outright).
    expect(ptyQuery('pty-9', { mode: 'agent', agentId: 'fyt-runner' })).toBe('?session=pty-9');
    // An `agent` mode with no id degrades to plain claude rather than emitting `agent=undefined`.
    expect(ptyQuery(undefined, { mode: 'agent' })).toBe('?spawn=claude');
    // A workflow is named by its ref; the server resolves it to a definition and to the agent that runs it.
    expect(ptyQuery(undefined, { mode: 'workflow', workflowRef: 'kb~video.md' })).toBe('?spawn=workflow&workflow=kb%7Evideo.md');
    expect(ptyQuery(undefined, { mode: 'workflow' })).toBe('?spawn=claude');
    expect(ptyQuery('pty-9', { mode: 'workflow', workflowRef: 'kb~video.md' })).toBe('?session=pty-9');
  });

  it('opens a primed tab for the requested agent, names the tab after it, and reports it consumed', async () => {
    const { factory, sockets } = makeFactory();
    const consumed = vi.fn();
    render(
      unlocked(
        <Terminal
          agentTarget="fyt-runner"
          onAgentTargetConsumed={consumed}
          socketFactory={factory}
          sessionsClient={makeSessionsClient()}
        />,
      ),
    );

    await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    expect(sockets[0].spawn).toEqual({ mode: 'agent', agentId: 'fyt-runner' });
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('terminal-tab-1').textContent).toContain('fyt-runner');
    // One click, one shell: the blank fallback tab must not race in beside the primed one.
    await act(async () => Promise.resolve());
    expect(sockets).toHaveLength(1);
  });

  it('never respawns the same target twice, but runs the same agent again after the caller clears it', async () => {
    const { factory, sockets } = makeFactory();
    const { rerender } = render(
      unlocked(<Terminal agentTarget="fyt-runner" socketFactory={factory} sessionsClient={makeSessionsClient()} />),
    );
    await waitFor(() => expect(sockets.length).toBe(1));

    // A re-render with the SAME target is not a second request.
    rerender(unlocked(<Terminal agentTarget="fyt-runner" socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    await act(async () => Promise.resolve());
    expect(sockets).toHaveLength(1);

    // Cleared, then requested again: that IS a second request and must open a second primed shell.
    rerender(unlocked(<Terminal agentTarget={null} socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    rerender(unlocked(<Terminal agentTarget="fyt-runner" socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    await waitFor(() => expect(sockets.length).toBe(2));
    expect(sockets[1].spawn).toEqual({ mode: 'agent', agentId: 'fyt-runner' });
  });

  it('does not spawn an agent while the terminal is hidden or locked', async () => {
    const { factory } = makeFactory();
    const { rerender } = render(
      <SessionProvider>
        <Terminal agentTarget="fyt-runner" socketFactory={factory} sessionsClient={makeSessionsClient()} />
      </SessionProvider>,
    );
    await act(async () => Promise.resolve());
    expect(factory).not.toHaveBeenCalled(); // locked

    rerender(
      unlocked(
        <Terminal visible={false} agentTarget="fyt-runner" socketFactory={factory} sessionsClient={makeSessionsClient()} />,
      ),
    );
    await act(async () => Promise.resolve());
    expect(factory).not.toHaveBeenCalled(); // hidden: a background surface must not spend a shell slot
  });

  it('toggling to plain claude kills the primed shell and respawns the tab in the other mode', async () => {
    const { factory, sockets } = makeFactory();
    render(
      unlocked(<Terminal agentTarget="fyt-runner" socketFactory={factory} sessionsClient={makeSessionsClient()} />),
    );
    await waitFor(() => expect(sockets.length).toBe(1));
    await act(async () => {
      sockets[0].onopen?.();
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'session', sessionId: 'pty-primed' }) });
    });

    const toggle = screen.getByTestId('terminal-mode');
    expect(within(toggle).getByTestId('terminal-mode-agent').getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      fireEvent.click(screen.getByTestId('terminal-mode-claude'));
    });

    // The old shell is torn down through the governed close path, not merely detached...
    expect(sockets[0].controls()).toContainEqual({ type: 'close' });
    // ...and a fresh socket opens in plain-claude mode, still remembering the agent for the way back.
    await waitFor(() => expect(sockets.length).toBe(2));
    expect(sockets[1].spawn).toEqual({ mode: 'claude', agentId: 'fyt-runner' });

    await act(async () => {
      sockets[0].onclose?.({ reason: 'closed by operator' });
    });
    await waitFor(() => expect(screen.getByTestId('terminal-mode-claude').getAttribute('aria-pressed')).toBe('true'));

    // And back again: the toggle can re-prime without the operator re-picking the agent.
    await act(async () => {
      fireEvent.click(screen.getByTestId('terminal-mode-agent'));
    });
    await waitFor(() => expect(sockets.length).toBe(3));
    expect(sockets[2].spawn).toEqual({ mode: 'agent', agentId: 'fyt-runner' });
  });

  it('shows no mode toggle for an ordinary shell tab — it has no claude position to switch to', async () => {
    const { factory, sockets } = makeFactory();
    render(unlocked(<Terminal socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(screen.queryByTestId('terminal-mode')).toBeNull();
    expect(screen.getByTestId('terminal-tab-1').textContent).toContain('powershell');
  });
});

/**
 * "Run workflow" from a workflow's detail is the SAME path as "Run agent", for a workflow: one click has
 * to land the operator in a live session already primed as the agent that runs it. The browser only ever
 * names the workflow — the server resolves the ref to a definition and to its agent.
 */
describe('Terminal — workflow-primed sessions', () => {
  it('opens a primed tab for the requested workflow, names the tab after it, and reports it consumed', async () => {
    const { factory, sockets } = makeFactory();
    const consumed = vi.fn();
    render(
      unlocked(
        <Terminal
          workflowTarget="kb~video.md"
          onWorkflowTargetConsumed={consumed}
          socketFactory={factory}
          sessionsClient={makeSessionsClient()}
        />,
      ),
    );

    await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    expect(sockets[0].spawn).toEqual({ mode: 'workflow', workflowRef: 'kb~video.md' });
    expect(consumed).toHaveBeenCalledTimes(1);
    // The tab reads as the workflow it runs, never as an ordinal shell.
    expect(screen.getByTestId('terminal-tab-1').textContent).toContain('kb~video.md');
    expect(screen.getByTestId('terminal-tab-1').textContent).not.toContain('powershell');
    await act(async () => Promise.resolve());
    expect(sockets).toHaveLength(1);
  });

  it('never respawns the same workflow twice, but runs it again after the caller clears it', async () => {
    const { factory, sockets } = makeFactory();
    const { rerender } = render(
      unlocked(<Terminal workflowTarget="kb~video.md" socketFactory={factory} sessionsClient={makeSessionsClient()} />),
    );
    await waitFor(() => expect(sockets.length).toBe(1));

    rerender(unlocked(<Terminal workflowTarget="kb~video.md" socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    await act(async () => Promise.resolve());
    expect(sockets).toHaveLength(1);

    rerender(unlocked(<Terminal workflowTarget={null} socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    rerender(unlocked(<Terminal workflowTarget="kb~video.md" socketFactory={factory} sessionsClient={makeSessionsClient()} />));
    await waitFor(() => expect(sockets.length).toBe(2));
    expect(sockets[1].spawn).toEqual({ mode: 'workflow', workflowRef: 'kb~video.md' });
  });

  it('does not spawn a workflow while the terminal is hidden or locked', async () => {
    const { factory } = makeFactory();
    const { rerender } = render(
      <SessionProvider>
        <Terminal workflowTarget="kb~video.md" socketFactory={factory} sessionsClient={makeSessionsClient()} />
      </SessionProvider>,
    );
    await act(async () => Promise.resolve());
    expect(factory).not.toHaveBeenCalled(); // locked

    rerender(
      unlocked(
        <Terminal visible={false} workflowTarget="kb~video.md" socketFactory={factory} sessionsClient={makeSessionsClient()} />,
      ),
    );
    await act(async () => Promise.resolve());
    expect(factory).not.toHaveBeenCalled(); // hidden
  });

  it('offers the workflow and plain claude on a workflow tab, and nothing else', async () => {
    const { factory, sockets } = makeFactory();
    render(
      unlocked(<Terminal workflowTarget="kb~video.md" socketFactory={factory} sessionsClient={makeSessionsClient()} />),
    );
    await waitFor(() => expect(sockets.length).toBe(1));
    await act(async () => {
      sockets[0].onopen?.();
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'session', sessionId: 'pty-workflow' }) });
    });

    const toggle = screen.getByTestId('terminal-mode');
    expect(within(toggle).getByTestId('terminal-mode-workflow').getAttribute('aria-pressed')).toBe('true');
    // A workflow tab has no agent position: nobody picked an agent, the definition did.
    expect(within(toggle).queryByTestId('terminal-mode-agent')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('terminal-mode-claude'));
    });
    expect(sockets[0].controls()).toContainEqual({ type: 'close' });
    await waitFor(() => expect(sockets.length).toBe(2));
    expect(sockets[1].spawn).toEqual({ mode: 'claude', workflowRef: 'kb~video.md' });

    await act(async () => {
      sockets[0].onclose?.({ reason: 'closed by operator' });
    });
    await waitFor(() => expect(screen.getByTestId('terminal-mode-claude').getAttribute('aria-pressed')).toBe('true'));

    // And back: the toggle re-primes on the same workflow without the operator naming it again.
    await act(async () => {
      fireEvent.click(screen.getByTestId('terminal-mode-workflow'));
    });
    await waitFor(() => expect(sockets.length).toBe(3));
    expect(sockets[2].spawn).toEqual({ mode: 'workflow', workflowRef: 'kb~video.md' });
  });

  it('never offers a flip INTO workflow mode from a tab that was not opened for one', async () => {
    const { factory, sockets } = makeFactory();
    render(
      unlocked(<Terminal agentTarget="fyt-runner" socketFactory={factory} sessionsClient={makeSessionsClient()} />),
    );
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(screen.queryByTestId('terminal-mode-workflow')).toBeNull();
    expect(screen.getByTestId('terminal-mode-agent')).toBeTruthy();
  });
});
