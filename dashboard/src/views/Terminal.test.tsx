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
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';

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
import type { PtySessionSummary, TerminalSessionsClient } from '../lib/terminalClient';

/** A fake browser WebSocket: the component assigns onopen/onmessage/onclose/onerror + calls send/close. */
class FakeWS {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed = false;
  protocols: string[] | undefined;
  attachSessionId: string | undefined;
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
  cleanup();
  xtermReg.instances.length = 0;
  fitReg.instances.length = 0;
  localStorage.clear();
  vi.clearAllMocks();
});

/** A socket factory that hands out (and records) a fresh FakeWS per tab, capturing its attach id. */
function makeFactory() {
  const sockets: FakeWS[] = [];
  const factory = vi.fn((token: string, attachSessionId?: string) => {
    const ws = new FakeWS();
    ws.protocols = ['kb-pty.v1', token];
    ws.attachSessionId = attachSessionId;
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
  it('without a session it renders the passkey prompt and never opens a socket', () => {
    const factory = vi.fn();
    render(<Terminal socketFactory={factory as unknown as (t: string) => WebSocket} sessionsClient={makeSessionsClient()} />);
    expect(factory).not.toHaveBeenCalled();
    expect(screen.getByText(/sign in with your passkey/i)).toBeTruthy();
  });

  it('opens one tab automatically once signed in with no live shells, carrying the bearer in the subprotocol', async () => {
    const { factory, sockets } = makeFactory();
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} sessionsClient={makeSessionsClient()} />);
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(factory).toHaveBeenCalledWith('tok-abc', undefined); // a fresh tab has no attach id
    expect(sockets[0].protocols).toEqual(['kb-pty.v1', 'tok-abc']);
    expect(screen.getByTestId('terminal-tab-1')).toBeTruthy();
    expect(screen.getByTestId('terminal-identity').textContent).toMatch(/dashboard daemon user/i);
    expect(screen.getByRole('note').textContent).toMatch(/cross-user isolation.*not active/i);
  });

  it('does not auto-spawn while hidden, then preserves the same shell across hide/show', async () => {
    const { factory, sockets } = makeFactory();
    const client = makeSessionsClient();
    const { rerender } = render(
      <Terminal visible={false} sessionToken="tok-abc" socketFactory={factory} sessionsClient={client} />,
    );

    await act(async () => Promise.resolve());
    expect(factory).not.toHaveBeenCalled();

    rerender(<Terminal visible sessionToken="tok-abc" socketFactory={factory} sessionsClient={client} />);
    await waitFor(() => expect(sockets.length).toBe(1));
    const firstSocket = sockets[0];
    const firstTab = screen.getByTestId('terminal-tab-1');
    const screenHost = screen.getByTestId('terminal-screen-1');
    Object.defineProperty(screenHost, 'offsetParent', { configurable: true, value: document.body });

    rerender(<Terminal visible={false} sessionToken="tok-abc" socketFactory={factory} sessionsClient={client} />);
    expect(firstSocket.closed).toBe(false);
    expect(screen.getByTestId('terminal-tab-1')).toBe(firstTab);

    rerender(<Terminal visible sessionToken="tok-abc" socketFactory={factory} sessionsClient={client} />);
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
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} sessionsClient={client} />);

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
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} sessionsClient={makeSessionsClient()} />);
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
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} sessionsClient={makeSessionsClient()} />);
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
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} sessionsClient={makeSessionsClient()} />);
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
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} sessionsClient={makeSessionsClient()} />);
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
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} sessionsClient={makeSessionsClient()} />);
    await waitFor(() => expect(sockets[0]?.onmessage).toBeTruthy());

    await act(async () => {
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'error', reason: 'too-many-terminals' }) });
    });
    expect(screen.getByTestId('terminal-notice')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('terminal-tab-1')).toBeNull());
  });
});
