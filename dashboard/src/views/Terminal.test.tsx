// @vitest-environment jsdom
/**
 * D3.1 — component tests for the browser half of the PTY passkey bridge (`Terminal.tsx`). The socket and
 * the passkey ceremony are BOTH injected (fake `socketFactory` + fake `collectAssertion`) so these tests
 * never open a real WebSocket, never touch a real authenticator, and — via a mocked `@xterm/xterm` — never
 * instantiate a real DOM/canvas terminal. They prove the wiring the go-live gate then exercises with a
 * real touch: a host `challenge` triggers the ceremony and relays the `assertion`; a decline surfaces an
 * error and relays NOTHING bogus; no session connects nothing; and bytes pump both ways once streaming.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';

/** A fake xterm captured via `vi.hoisted` so the mock factory (hoisted above imports) can reach it. */
const xtermReg = vi.hoisted(() => {
  const instances: Array<{ writes: string[]; dataCb: ((d: string) => void) | null }> = [];
  return { instances };
});

vi.mock('@xterm/xterm', () => {
  class FakeXTerm {
    writes: string[] = [];
    dataCb: ((d: string) => void) | null = null;
    constructor() {
      xtermReg.instances.push(this);
    }
    open() {}
    write(d: string) {
      this.writes.push(d);
    }
    onData(cb: (d: string) => void) {
      this.dataCb = cb;
    }
    dispose() {}
  }
  return { Terminal: FakeXTerm };
});
// The component imports the xterm CSS as a side effect; stub it so jsdom/vitest doesn't parse a real sheet.
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { Terminal } from './Terminal';
import type { PtyAssertion } from '../lib/ptyAssertionClient';

const ASSERTION: PtyAssertion = {
  credentialId: 'cred-1',
  authenticatorData: 'auth-1',
  clientDataJSON: 'cdj-1',
  signature: 'sig-1',
};
const CHALLENGE_FRAME = JSON.stringify({ type: 'challenge', challenge: 'host-challenge-1' });

/** A fake browser WebSocket: the component assigns onopen/onmessage/onclose/onerror + calls send/close. */
class FakeWS {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  protocols: string[] | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void | Promise<void>) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  /** Parsed view of the control frames the component sent back toward the host. */
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
  vi.clearAllMocks();
});

/** Mount the pane and wait until the mount effect has wired the fake socket's handlers. */
async function mountWithSocket(props: {
  ws: FakeWS;
  collect?: (challenge: string, rpId: string) => Promise<PtyAssertion>;
}) {
  const factory = vi.fn((token: string) => {
    props.ws.protocols = ['kb-pty.v1', token];
    return props.ws as unknown as WebSocket;
  });
  render(<Terminal sessionToken="tok-abc" socketFactory={factory} collectAssertion={props.collect} />);
  await waitFor(() => expect(props.ws.onmessage).toBeTruthy());
  return { factory };
}

describe('Terminal — passkey challenge → ceremony → assertion → stream', () => {
  it('runs the ceremony on a challenge, relays the assertion, then streams raw PTY bytes', async () => {
    const ws = new FakeWS();
    const collect = vi.fn(async (_c: string, _r: string) => ASSERTION);
    await mountWithSocket({ ws, collect });

    await act(async () => {
      ws.onopen?.();
    });

    // Host relays a challenge → the ceremony runs (rpId = window.location.hostname === 'localhost').
    await act(async () => {
      await ws.onmessage?.({ data: CHALLENGE_FRAME });
    });
    expect(collect).toHaveBeenCalledWith('host-challenge-1', 'localhost');
    expect(ws.controls()).toContainEqual({ type: 'assertion', assertion: ASSERTION });

    // Streaming phase: an inbound raw frame is written to the terminal, not treated as control.
    const term = xtermReg.instances[0];
    await act(async () => {
      await ws.onmessage?.({ data: 'hello from the shell' });
    });
    expect(term.writes).toContain('hello from the shell');

    // Keystrokes flow the other way: xterm.onData → ws.send (raw string).
    act(() => {
      term.dataCb?.('ls -la\r');
    });
    expect(ws.sent).toContain('ls -la\r');
  });

  it('shows the "touch your passkey" cue while the ceremony is outstanding', async () => {
    const ws = new FakeWS();
    let resolveCollect: ((a: PtyAssertion) => void) | undefined;
    const collect = vi.fn(
      () => new Promise<PtyAssertion>((resolve) => { resolveCollect = resolve; }),
    );
    await mountWithSocket({ ws, collect });
    await act(async () => {
      ws.onopen?.();
    });

    // Deliver the challenge but keep the ceremony pending — the cue must be visible.
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = ws.onmessage?.({ data: CHALLENGE_FRAME }) as Promise<void>;
    });
    expect(screen.getByTestId('terminal-touch-prompt')).toBeTruthy();

    // Complete the touch → the cue clears and no error is shown.
    await act(async () => {
      resolveCollect?.(ASSERTION);
      await pending;
    });
    expect(screen.queryByTestId('terminal-touch-prompt')).toBeNull();
    expect(ws.controls()).toContainEqual({ type: 'assertion', assertion: ASSERTION });
  });
});

describe('Terminal — declined ceremony fails closed', () => {
  it('surfaces an error and relays NO assertion when the passkey ceremony throws', async () => {
    const ws = new FakeWS();
    const collect = vi.fn(async () => {
      throw new Error('user declined');
    });
    await mountWithSocket({ ws, collect });
    await act(async () => {
      ws.onopen?.();
    });
    await act(async () => {
      await ws.onmessage?.({ data: CHALLENGE_FRAME });
    });

    expect(collect).toHaveBeenCalledTimes(1);
    // Nothing bogus is relayed back toward the host.
    expect(ws.controls().some((f) => f.type === 'assertion')).toBe(false);
    // The failure is surfaced, not swallowed.
    await waitFor(() => expect(screen.getByLabelText('Connection error')).toBeTruthy());
  });
});

describe('Terminal — session gating (unchanged) + subprotocol token', () => {
  it('without a session it renders the passkey prompt and never opens a socket', () => {
    const factory = vi.fn();
    render(<Terminal socketFactory={factory as unknown as (t: string) => WebSocket} />);
    expect(factory).not.toHaveBeenCalled();
    expect(screen.getByText(/sign in with your passkey/i)).toBeTruthy();
  });

  it('carries the bearer token in the subprotocol array, never the URL', async () => {
    const ws = new FakeWS();
    const { factory } = await mountWithSocket({ ws, collect: async () => ASSERTION });
    expect(factory).toHaveBeenCalledWith('tok-abc');
    expect(ws.protocols).toEqual(['kb-pty.v1', 'tok-abc']);
  });

  it('with onRequestSession wired, the empty state is a sign-in button that mints a session and opens no socket until it does', async () => {
    const factory = vi.fn();
    const onRequestSession = vi.fn(async () => ({ token: 'minted' }) as never);
    render(
      <Terminal
        socketFactory={factory as unknown as (t: string) => WebSocket}
        onRequestSession={onRequestSession}
      />,
    );
    // No standing session → no socket, and the actionable button (not the passive <p>) is shown.
    expect(factory).not.toHaveBeenCalled();
    const btn = screen.getByTestId('terminal-signin');

    // Clicking runs the point-of-action ceremony; the parent (App) would then re-render us WITH a token.
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onRequestSession).toHaveBeenCalledTimes(1);
    // Still no socket: this component only connects once it actually receives a `sessionToken` prop.
    expect(factory).not.toHaveBeenCalled();
  });
});
