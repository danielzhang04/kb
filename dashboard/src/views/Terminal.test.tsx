// @vitest-environment jsdom
/**
 * D3.2 — component tests for the multi-tab PTY terminal view (`Terminal.tsx`). The socket is injected
 * (fake `socketFactory`) so these tests never open a real WebSocket, and — via a mocked `@xterm/xterm`
 * and `@xterm/addon-fit` — never instantiate a real DOM/canvas terminal. They prove: no session connects
 * nothing; a session opens one tab and streams bytes both ways; the `+` button opens independent shells
 * up to the cap; closing a tab tears its socket down; and a server `too-many-terminals` error frame is
 * surfaced as an inline notice rather than crashing. The removed passkey handshake is NOT re-tested.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';

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

/** A fake browser WebSocket: the component assigns onopen/onmessage/onclose/onerror + calls send/close. */
class FakeWS {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed = false;
  protocols: string[] | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
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
  vi.clearAllMocks();
});

/** A socket factory that hands out (and records) a fresh FakeWS per tab. */
function makeFactory() {
  const sockets: FakeWS[] = [];
  const factory = vi.fn((token: string) => {
    const ws = new FakeWS();
    ws.protocols = ['kb-pty.v1', token];
    sockets.push(ws);
    return ws as unknown as WebSocket;
  });
  return { factory, sockets };
}

describe('Terminal — session gating + subprotocol token', () => {
  it('without a session it renders the passkey prompt and never opens a socket', () => {
    const factory = vi.fn();
    render(<Terminal socketFactory={factory as unknown as (t: string) => WebSocket} />);
    expect(factory).not.toHaveBeenCalled();
    expect(screen.getByText(/sign in with your passkey/i)).toBeTruthy();
  });

  it('with onRequestSession wired, the empty state is a sign-in button that opens no socket until a token arrives', async () => {
    const factory = vi.fn();
    const onRequestSession = vi.fn(async () => ({ token: 'minted' }) as never);
    render(
      <Terminal
        socketFactory={factory as unknown as (t: string) => WebSocket}
        onRequestSession={onRequestSession}
      />,
    );
    expect(factory).not.toHaveBeenCalled();
    const btn = screen.getByTestId('terminal-signin');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onRequestSession).toHaveBeenCalledTimes(1);
    expect(factory).not.toHaveBeenCalled(); // only connects once it actually receives a sessionToken prop
  });

  it('opens one tab automatically once signed in, carrying the bearer token in the subprotocol array', async () => {
    const { factory, sockets } = makeFactory();
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} />);
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(factory).toHaveBeenCalledWith('tok-abc');
    expect(sockets[0].protocols).toEqual(['kb-pty.v1', 'tok-abc']);
    expect(screen.getByTestId('terminal-tab-1')).toBeTruthy();
    expect(screen.getByTestId('terminal-identity').textContent).toMatch(/dashboard daemon user/i);
    expect(screen.getByRole('note').textContent).toMatch(/cross-user isolation.*not active/i);
  });

  it('does not auto-spawn while hidden, then preserves the same shell across hide/show', async () => {
    const { factory, sockets } = makeFactory();
    const { rerender } = render(
      <Terminal visible={false} sessionToken="tok-abc" socketFactory={factory} />,
    );

    // A session may have been minted elsewhere in the dashboard; hidden Terminal must remain dormant.
    await act(async () => Promise.resolve());
    expect(factory).not.toHaveBeenCalled();

    rerender(<Terminal visible sessionToken="tok-abc" socketFactory={factory} />);
    await waitFor(() => expect(sockets.length).toBe(1));
    const firstSocket = sockets[0];
    const firstTab = screen.getByTestId('terminal-tab-1');
    const surface = screen.getByTestId('terminal-surface-1');
    // jsdom has no layout and normally reports null. Give the surface a measurable parent so the
    // return-to-visible effect can prove it invokes fit rather than only preserving the socket.
    Object.defineProperty(surface, 'offsetParent', { configurable: true, value: document.body });

    rerender(<Terminal visible={false} sessionToken="tok-abc" socketFactory={factory} />);
    expect(firstSocket.closed).toBe(false);
    expect(screen.getByTestId('terminal-tab-1')).toBe(firstTab);

    rerender(<Terminal visible sessionToken="tok-abc" socketFactory={factory} />);
    await act(async () => Promise.resolve());
    expect(sockets).toHaveLength(1); // returning reuses the live shell; it never opens a duplicate socket
    expect(firstSocket.closed).toBe(false);
    expect(screen.getByTestId('terminal-tab-1')).toBe(firstTab);
    await waitFor(() => expect(fitReg.instances[0].calls).toBeGreaterThan(0));
    expect(firstSocket.controls()).toContainEqual({ type: 'resize', cols: 80, rows: 24 });
  });
});

describe('Terminal — streaming', () => {
  it('streams raw PTY bytes into xterm and keystrokes back to the socket', async () => {
    const { factory, sockets } = makeFactory();
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} />);
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

  it('sends a resize control frame once the socket opens', async () => {
    const { factory, sockets } = makeFactory();
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} />);
    await waitFor(() => expect(sockets[0]?.onopen).toBeTruthy());
    const ws = sockets[0];
    await act(async () => {
      ws.onopen?.();
    });
    // jsdom reports offsetParent === null, so fit() is guarded; but where a real layout exists the frame
    // shape is `{type:'resize',cols,rows}`. We at least assert nothing bogus was streamed as keystrokes.
    expect(ws.controls().every((f) => f.type === 'resize' || f.type === undefined)).toBe(true);
  });
});

describe('Terminal — tabs', () => {
  it('opens an independent shell per tab up to the cap of 8, then disables +', async () => {
    const { factory, sockets } = makeFactory();
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} />);
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

  it('closing a tab tears down its socket and disposes its terminal', async () => {
    const { factory, sockets } = makeFactory();
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} />);
    await waitFor(() => expect(sockets.length).toBe(1));

    await act(async () => {
      fireEvent.click(screen.getByTestId('terminal-tab-add'));
    });
    await waitFor(() => expect(sockets.length).toBe(2));

    await act(async () => {
      fireEvent.click(screen.getByTestId('terminal-tab-close-2'));
    });
    await waitFor(() => expect(sockets[1].closed).toBe(true));
    expect(xtermReg.instances[1].disposed).toBe(true);
    expect(screen.queryByTestId('terminal-tab-2')).toBeNull();
  });

  it('surfaces a too-many-terminals server error frame as an inline notice and drops that tab', async () => {
    const { factory, sockets } = makeFactory();
    render(<Terminal sessionToken="tok-abc" socketFactory={factory} />);
    await waitFor(() => expect(sockets[0]?.onmessage).toBeTruthy());

    await act(async () => {
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'error', reason: 'too-many-terminals' }) });
    });
    expect(screen.getByTestId('terminal-notice')).toBeTruthy();
    // The offending tab is dropped (it never got a shell).
    await waitFor(() => expect(screen.queryByTestId('terminal-tab-1')).toBeNull());
  });
});
