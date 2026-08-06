// @vitest-environment jsdom
/**
 * Component tests for `<ConsolePane>` — the reusable live-shell pane extracted out of the Terminal view.
 * The socket is injected (fake `socketFactory`) and xterm/fit are mocked, so nothing here opens a real
 * WebSocket or touches a canvas.
 *
 * The load-bearing test in this file is the LAST one: a pane must not reconnect when its props are
 * rebuilt. Everything else here is behaviour the old `TerminalTab` already had; that one is the property
 * the extraction had to ADD, because an embedded console is rendered with inline object/arrow props and
 * a reconnect on a spawn target is a second shell against the daemon's 8-terminal cap.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

beforeAll(() => {
  // jsdom ships no ResizeObserver, and the pane's reflow effect (which also installs the window-resize
  // listener) bails out entirely without one. Stub it so the fit path is reachable from a test at all.
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

const xtermReg = vi.hoisted(() => ({
  instances: [] as Array<{ writes: string[]; dataCb: ((d: string) => void) | null; disposed: boolean }>,
}));

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
    fit() {}
  }
  return { FitAddon: FakeFitAddon };
});
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { ConsolePane, consoleTargetKey, parseControlFrame } from './ConsolePane';
import type { ConsoleControl, ConsoleTarget } from './ConsolePane';
import type { PtySpawnTarget, TerminalSessionsClient } from '../lib/terminalClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';

function unlocked(ui: React.ReactElement, token = 'tok-abc'): React.ReactElement {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

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
  controls(): Array<Record<string, unknown>> {
    return this.sent.flatMap((s) => {
      try {
        return [JSON.parse(s) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
  }
}

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

function makeSessionsClient(): TerminalSessionsClient & { remove: ReturnType<typeof vi.fn> } {
  return { list: vi.fn(async () => []), remove: vi.fn(async () => {}) };
}

afterEach(() => {
  clearStoredSession();
  cleanup();
  xtermReg.instances.length = 0;
  localStorage.clear();
  vi.clearAllMocks();
});

describe('ConsolePane — target grammar', () => {
  it('keys attach and spawn targets distinctly, and by VALUE not identity', () => {
    // Two literals describing the same spawn are the same connection. This is the whole reason the
    // connection effect keys on a string: object identity churns on every parent render.
    expect(consoleTargetKey({ mode: 'spawn', spawn: { mode: 'agent', agentId: 'fyt-runner' } })).toBe(
      consoleTargetKey({ mode: 'spawn', spawn: { mode: 'agent', agentId: 'fyt-runner' } }),
    );
    expect(consoleTargetKey({ mode: 'spawn' })).toBe('spawn:');
    expect(consoleTargetKey({ mode: 'attach', sessionId: 'pty-9' })).toBe('attach:pty-9');
    expect(consoleTargetKey({ mode: 'spawn', spawn: { mode: 'claude' } })).not.toBe(
      consoleTargetKey({ mode: 'spawn', spawn: { mode: 'agent', agentId: 'claude' } }),
    );
  });

  it('parses only exact control frames; shell output that merely looks like JSON still streams', () => {
    expect(parseControlFrame('{"type":"error","reason":"too-many-terminals"}')).toEqual({
      type: 'error',
      reason: 'too-many-terminals',
    });
    expect(parseControlFrame('{"type":"session","sessionId":"pty-1"}')).toEqual({
      type: 'session',
      sessionId: 'pty-1',
    });
    expect(parseControlFrame('{"type":"resize"}')).toBeNull();
    expect(parseControlFrame('{ not json')).toBeNull();
    expect(parseControlFrame('$ ls')).toBeNull();
  });
});

describe('ConsolePane — connection', () => {
  it('opens nothing while locked', async () => {
    const { factory } = makeFactory();
    render(
      <SessionProvider>
        <ConsolePane target={{ mode: 'spawn' }} visible socketFactory={factory} />
      </SessionProvider>,
    );
    await act(async () => Promise.resolve());
    expect(factory).not.toHaveBeenCalled();
  });

  it('renders its locked-safe empty state with NO session provider at all', async () => {
    // An embedded console lives inside presentational surfaces that are legitimately rendered from a
    // literal fixture. Missing context must degrade, not throw and take the whole surface down.
    const { factory } = makeFactory();
    render(<ConsolePane target={{ mode: 'spawn' }} visible socketFactory={factory} />);
    await act(async () => Promise.resolve());
    expect(factory).not.toHaveBeenCalled();
    expect(screen.getByTestId('console-panel')).toBeTruthy();
  });

  it('spawns with the requested target and carries the bearer in the subprotocol', async () => {
    const { factory, sockets } = makeFactory();
    render(
      unlocked(
        <ConsolePane
          target={{ mode: 'spawn', spawn: { mode: 'agent', agentId: 'fyt-runner' } }}
          visible
          socketFactory={factory}
        />,
      ),
    );
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(factory).toHaveBeenCalledWith('tok-abc', undefined, { mode: 'agent', agentId: 'fyt-runner' });
    expect(sockets[0].protocols).toEqual(['kb-pty.v1', 'tok-abc']);
  });

  it('attaches to an existing session and NEVER passes a spawn alongside it', async () => {
    const { factory, sockets } = makeFactory();
    render(unlocked(<ConsolePane target={{ mode: 'attach', sessionId: 'pty-7' }} visible socketFactory={factory} />));
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(factory).toHaveBeenCalledWith('tok-abc', 'pty-7', undefined);
  });

  it('streams raw bytes into xterm, keystrokes back, and reports bind/error/exit', async () => {
    const { factory, sockets } = makeFactory();
    const onSession = vi.fn();
    const onError = vi.fn();
    const onExit = vi.fn();
    render(
      unlocked(
        <ConsolePane
          target={{ mode: 'spawn' }}
          visible
          socketFactory={factory}
          onSession={onSession}
          onError={onError}
          onExit={onExit}
        />,
      ),
    );
    await waitFor(() => expect(sockets[0]?.onmessage).toBeTruthy());
    const ws = sockets[0];

    await act(async () => {
      ws.onopen?.();
      ws.onmessage?.({ data: JSON.stringify({ type: 'session', sessionId: 'pty-bound' }) });
      ws.onmessage?.({ data: 'hello from the shell' });
    });
    expect(onSession).toHaveBeenCalledWith('pty-bound');
    expect(xtermReg.instances[0].writes).toContain('hello from the shell');
    // The bind frame is control, not output: it must never reach the grid.
    expect(xtermReg.instances[0].writes.join('')).not.toContain('pty-bound');

    act(() => {
      xtermReg.instances[0].dataCb?.('ls -la\r');
    });
    expect(ws.sent).toContain('ls -la\r');

    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'error', reason: 'too-many-terminals' }) });
    });
    expect(onError).toHaveBeenCalledWith('too-many-terminals');
    // The refusal renders IN the pane — an operator must be able to read it where they are.
    expect(screen.getByTestId('console-panel-error').textContent).toContain('too-many-terminals');

    await act(async () => {
      ws.onclose?.({ reason: 'shell exited' });
    });
    expect(onExit).toHaveBeenCalledWith('shell exited');
  });

  it('does NOT report an exit on an unexpected disconnect (a daemon restart is not a dead shell)', async () => {
    const { factory, sockets } = makeFactory();
    const onExit = vi.fn();
    render(unlocked(<ConsolePane target={{ mode: 'spawn' }} visible socketFactory={factory} onExit={onExit} />));
    await waitFor(() => expect(sockets[0]?.onclose).toBeTruthy());
    await act(async () => {
      sockets[0].onclose?.({});
    });
    expect(onExit).not.toHaveBeenCalled();
  });

  it('publishes a close control that kills the shell gracefully over a live socket', async () => {
    const { factory, sockets } = makeFactory();
    let control: ConsoleControl | null = null;
    render(
      unlocked(
        <ConsolePane
          target={{ mode: 'spawn' }}
          visible
          socketFactory={factory}
          registerControl={(c) => {
            control = c;
          }}
        />,
      ),
    );
    await waitFor(() => expect(sockets[0]?.onmessage).toBeTruthy());
    await act(async () => {
      sockets[0].onopen?.();
    });
    await waitFor(() => expect(control).not.toBeNull());
    act(() => (control as unknown as ConsoleControl).requestClose());
    expect(sockets[0].controls()).toContainEqual({ type: 'close' });
  });

  it('falls back to the REST kill when the socket is already gone', async () => {
    const { factory, sockets } = makeFactory();
    const client = makeSessionsClient();
    let control: ConsoleControl | null = null;
    const onExit = vi.fn();
    render(
      unlocked(
        <ConsolePane
          target={{ mode: 'attach', sessionId: 'pty-dead' }}
          visible
          socketFactory={factory}
          sessionsClient={client}
          onExit={onExit}
          registerControl={(c) => {
            control = c;
          }}
        />,
      ),
    );
    await waitFor(() => expect(control).not.toBeNull());
    sockets[0].readyState = 3; // socket died without a close frame
    act(() => (control as unknown as ConsoleControl).requestClose());
    expect(client.remove).toHaveBeenCalledWith('pty-dead', 'tok-abc');
    expect(onExit).toHaveBeenCalled();
  });
});

/**
 * The property the extraction exists to guarantee. `TerminalTab` keyed its connection on the `spawn`
 * OBJECT and on every callback prop; that was only safe because the tab manager fed it state-held objects
 * and `useCallback` sinks. Any embedded caller passes literals, so under those deps a parent re-render
 * would tear the socket down and open ANOTHER shell.
 */
describe('ConsolePane — a re-render is never a reconnect', () => {
  it('keeps ONE socket across re-renders that rebuild every object and callback prop', async () => {
    const { factory, sockets } = makeFactory();
    const Wrapper = ({ n }: { n: number }): React.JSX.Element => (
      <ConsolePane
        // Every one of these is a FRESH identity on each render — exactly how an embedded caller writes it.
        target={{ mode: 'spawn', spawn: { mode: 'agent', agentId: 'fyt-runner' } }}
        visible
        socketFactory={factory}
        sessionsClient={makeSessionsClient()}
        onSession={() => {}}
        onError={() => {}}
        onExit={() => {}}
        registerControl={() => {}}
        ariaLabel={`render ${n}`}
      />
    );
    const { rerender } = render(unlocked(<Wrapper n={1} />));
    await waitFor(() => expect(sockets.length).toBe(1));

    for (let n = 2; n <= 5; n++) {
      rerender(unlocked(<Wrapper n={n} />));
      await act(async () => Promise.resolve());
    }

    expect(factory).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(false);
    expect(xtermReg.instances).toHaveLength(1); // and no orphaned xterm instances either
  });

  it('DOES reconnect when the target genuinely changes', async () => {
    const { factory, sockets } = makeFactory();
    const Wrapper = ({ target }: { target: ConsoleTarget }): React.JSX.Element => (
      <ConsolePane target={target} visible socketFactory={factory} />
    );
    const { rerender } = render(unlocked(<Wrapper target={{ mode: 'spawn', spawn: { mode: 'claude' } }} />));
    await waitFor(() => expect(sockets.length).toBe(1));

    rerender(unlocked(<Wrapper target={{ mode: 'attach', sessionId: 'pty-3' }} />));
    await waitFor(() => expect(sockets.length).toBe(2));
    expect(sockets[0].closed).toBe(true); // the old socket detached
    expect(sockets[1].attachSessionId).toBe('pty-3');
  });

  it('hides by display, never by unmounting — the socket and scrollback survive going invisible', async () => {
    const { factory, sockets } = makeFactory();
    const { rerender } = render(unlocked(<ConsolePane target={{ mode: 'spawn' }} visible socketFactory={factory} />));
    await waitFor(() => expect(sockets.length).toBe(1));

    rerender(unlocked(<ConsolePane target={{ mode: 'spawn' }} visible={false} socketFactory={factory} />));
    await act(async () => Promise.resolve());
    const pane = screen.getByTestId('console-panel');
    expect(pane.className).not.toContain('console-pane--visible');
    expect(pane.getAttribute('aria-hidden')).toBe('true');
    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(false);
  });

  it('disposes xterm and detaches the socket on unmount', async () => {
    const { factory, sockets } = makeFactory();
    const { unmount } = render(unlocked(<ConsolePane target={{ mode: 'spawn' }} visible socketFactory={factory} />));
    await waitFor(() => expect(sockets.length).toBe(1));
    unmount();
    expect(sockets[0].closed).toBe(true);
    expect(xtermReg.instances[0].disposed).toBe(true);
  });
});

describe('ConsolePane — testid addressing', () => {
  it('suffixes every testid so a manager can address one pane among many', async () => {
    const { factory } = makeFactory();
    render(unlocked(<ConsolePane target={{ mode: 'spawn' }} visible socketFactory={factory} testIdSuffix="-7" />));
    await waitFor(() => expect(screen.getByTestId('console-panel-7')).toBeTruthy());
    expect(screen.getByTestId('console-surface-7')).toBeTruthy();
    expect(screen.getByTestId('console-screen-7')).toBeTruthy();
  });

  it('marks the pane with its connection state for styling and diagnosis', async () => {
    const { factory, sockets } = makeFactory();
    render(unlocked(<ConsolePane target={{ mode: 'spawn' }} visible socketFactory={factory} />));
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(screen.getByTestId('console-panel').getAttribute('data-state')).toBe('connecting');
    await act(async () => {
      sockets[0].onopen?.();
    });
    expect(screen.getByTestId('console-panel').getAttribute('data-state')).toBe('connected');
  });
});

describe('ConsolePane — fit guard', () => {
  it('relays geometry only when the socket is open, and never while hidden', async () => {
    const { factory, sockets } = makeFactory();
    render(unlocked(<ConsolePane target={{ mode: 'spawn' }} visible socketFactory={factory} />));
    await waitFor(() => expect(sockets.length).toBe(1));
    const host = screen.getByTestId('console-screen');

    // jsdom leaves offsetParent null (the "I am hidden" signal), so no resize frame is sent.
    await act(async () => {
      sockets[0].onopen?.();
    });
    expect(sockets[0].controls().some((c) => c.type === 'resize')).toBe(false);

    // With a real offsetParent the same path DOES relay the PTY its window size.
    Object.defineProperty(host, 'offsetParent', { configurable: true, value: document.body });
    await act(async () => {
      fireEvent(window, new Event('resize'));
    });
    expect(sockets[0].controls()).toContainEqual({ type: 'resize', cols: 80, rows: 24 });
  });
});
