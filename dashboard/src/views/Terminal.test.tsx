// @vitest-environment jsdom
/**
 * P3 W6.4 — the named Terminal workspace. Socket and REST client are injected and xterm is mocked, so
 * nothing here opens a real WebSocket. What is pinned: `ptyEnabled` is fail-closed (a false switch shows
 * the Health path and opens nothing, whatever the capability payload claims), the empty state offers the
 * host's launchers, a launch sends a `create` frame naming the selected root, host-named sessions drive
 * the tab strip, closing a session is confirmed, and NOTHING is written to localStorage.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

beforeAll(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

vi.mock('@xterm/xterm', () => {
  class FakeXTerm {
    cols = 80;
    rows = 24;
    dataCb: ((d: string) => void) | null = null;
    loadAddon() {}
    open() {}
    write() {}
    onData(cb: (d: string) => void) { this.dataCb = cb; }
    dispose() {}
  }
  return { Terminal: FakeXTerm };
});
vi.mock('@xterm/addon-fit', () => {
  class FakeFitAddon { fit() {} }
  return { FitAddon: FakeFitAddon };
});
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { Terminal } from './Terminal';
import { listPtySessions } from '../lib/terminalClient';
import type { TerminalSessionsClient } from '../lib/terminalClient';
import { P3_BROWSER_PRINCIPALS, p3SessionListing } from '../../server/testFixtures/p2BrowserFixtureData.ts';
import { RuntimeCapabilitiesProvider, UNAVAILABLE_RUNTIME_CAPABILITIES } from '../lib/runtimeCapabilities';
import type { ClientRuntimeCapabilities } from '../lib/runtimeCapabilities';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';
import type { SessionSummary } from '../../shared/ptyProtocol.ts';

const SESSION_ID = `pty-${'a'.repeat(32)}`;
const OTHER_SESSION_ID = `pty-${'c'.repeat(32)}`;
const ATTACHMENT_ID = `att-${'b'.repeat(32)}`;

const AVAILABLE: ClientRuntimeCapabilities = {
  pty: true, host: 'desktop', launchers: ['shell', 'claude', 'codex'], roots: ['repo', 'worktrees'],
  checkedAt: '2026-08-22T10:00:00.000Z', localTranscripts: true,
};

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: SESSION_ID, name: 'shell 1', host: 'desktop', launcher: 'shell', rootId: 'repo',
    cwd: 'ops', state: 'live', attachmentCount: 0, attachmentState: 'detached',
    startedAt: '2026-08-22T10:00:00.000Z', endedAt: null, exit: null, ...overrides,
  };
}

class FakeWS {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  frames(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

function makeFactory() {
  const sockets: FakeWS[] = [];
  const factory = vi.fn(() => {
    const socket = new FakeWS();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  return { sockets, factory: factory as unknown as (token: string) => WebSocket };
}

function clientWith(sessions: SessionSummary[]): TerminalSessionsClient {
  return {
    list: vi.fn(async () => ({ revision: 4, sessions })),
    remove: vi.fn(async () => ({ ok: true as const })),
  };
}

function mount(
  ui: React.ReactElement,
  capabilities: ClientRuntimeCapabilities = AVAILABLE,
  token: string | null = 'tok-abc',
): React.ReactElement {
  if (token) persistSession({ token, expiresAt: Date.now() + 60_000 });
  return (
    <SessionProvider>
      <RuntimeCapabilitiesProvider value={capabilities}>{ui}</RuntimeCapabilitiesProvider>
    </SessionProvider>
  );
}

afterEach(() => {
  clearStoredSession();
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('the capability switch is fail-closed', () => {
  it('renders the Health path and opens nothing when ptyEnabled is false, even with an available payload', async () => {
    const { sockets, factory } = makeFactory();
    const sessionsClient = clientWith([summary()]);
    const onOpenHealth = vi.fn();
    render(mount(
      <Terminal ptyEnabled={false} socketFactory={factory} sessionsClient={sessionsClient} onOpenHealth={onOpenHealth} />,
      AVAILABLE,
    ));
    await act(async () => {});
    expect(screen.getByText('Terminal unavailable')).toBeTruthy();
    expect(sessionsClient.list).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
    fireEvent.click(screen.getByText('Open Health'));
    expect(onOpenHealth).toHaveBeenCalled();
  });

  it('renders the Health path when the payload itself is unavailable', async () => {
    const { factory } = makeFactory();
    render(mount(
      <Terminal ptyEnabled socketFactory={factory} sessionsClient={clientWith([])} />,
      UNAVAILABLE_RUNTIME_CAPABILITIES,
    ));
    await act(async () => {});
    expect(screen.getByText('Terminal unavailable')).toBeTruthy();
  });

  // The REAL App path for a closed host: `App` derives `ptyEnabled` from `pty === true`, so a refusing
  // payload always arrives with the switch OFF. The local sentinel used to overwrite it here, which is
  // why the live panel said "not available on this host" for a broker that was merely not listening.
  it('keeps the host\'s own reason and detail when the switch is off because the payload refused', async () => {
    const { sockets, factory } = makeFactory();
    const sessionsClient = clientWith([]);
    render(mount(
      <Terminal ptyEnabled={false} socketFactory={factory} sessionsClient={sessionsClient} />,
      {
        pty: false,
        diagnostic: {
          reason: 'broker-unavailable',
          detail: 'kb-shell-broker socket is not listening',
          checkedAt: '2026-08-22T00:00:00.000Z',
        },
        localTranscripts: false,
      },
    ));
    await act(async () => {});
    expect(screen.getByText('Terminal unavailable')).toBeTruthy();
    expect(screen.getByText('Terminal is unavailable right now.')).toBeTruthy();
    expect(screen.getByTestId('terminal-unavailable-detail').textContent)
      .toBe('kb-shell-broker socket is not listening');
    expect(screen.getByTestId('terminal-unavailable').getAttribute('data-pty-state')).toBe('pty:false');
    // Still fail-closed: nothing was listed and no socket was opened.
    expect(sessionsClient.list).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });
});

describe('the empty state', () => {
  it('offers exactly the host\'s launchers and launches one', async () => {
    const { sockets, factory } = makeFactory();
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={clientWith([])} />));
    await act(async () => {});
    expect(screen.getByText('Start a session')).toBeTruthy();
    for (const label of ['Shell', 'Claude', 'Codex']) expect(screen.getByText(label)).toBeTruthy();

    fireEvent.click(screen.getByText('Codex'));
    await waitFor(() => expect(sockets.length).toBe(1));
    await act(async () => { sockets[0].onopen?.(); });
    expect(sockets[0].frames()[0]).toMatchObject({
      type: 'create', launcher: 'codex', rootId: 'repo', relativeCwd: '.',
    });
  });

  it('reports a listing it could not read instead of pretending there are no sessions', async () => {
    const { factory } = makeFactory();
    const sessionsClient: TerminalSessionsClient = {
      list: vi.fn(async () => null),
      remove: vi.fn(async () => ({ ok: true as const })),
    };
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={sessionsClient} />));
    await waitFor(() => expect(screen.getByTestId('terminal-notice').textContent).toMatch(/could not read your sessions/i));
  });

  it('never lists or connects while hidden', async () => {
    const { sockets, factory } = makeFactory();
    const sessionsClient = clientWith([summary()]);
    render(mount(<Terminal ptyEnabled visible={false} socketFactory={factory} sessionsClient={sessionsClient} />));
    await act(async () => {});
    expect(sessionsClient.list).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });
});

describe('named sessions', () => {
  // (a) Behaviour intentionally changed. This test previously asserted that a listing rendered as
  // "Start a session" until a console was mounted — which is exactly the live defect: four authorized
  // host sessions were fetched and never shown. What survives from the old test, because it was always
  // right, is that a listing opens NO socket on arrival.
  it('renders the host listing in server order, by name, with no socket opened', async () => {
    const { sockets, factory } = makeFactory();
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={clientWith([
      summary({ name: 'ops shell' }),
      summary({ sessionId: OTHER_SESSION_ID, name: 'codex worktree', launcher: 'codex', rootId: 'worktrees', cwd: '' }),
    ])} />));

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'ops shell · Shell · Desktop/repo/ops · Live',
      'codex worktree · Codex · Desktop/worktrees · Live',
    ]);
    // Opaque ids are never the label (ux-rules 13: "raw ids as names").
    expect(document.body.textContent).not.toContain(SESSION_ID);
    expect(screen.queryByText('Start a session')).toBeNull();
    // The launchers stay reachable beside the roster, so an operator with sessions can still open one.
    for (const launcher of ['shell', 'claude', 'codex']) {
      expect(screen.getByTestId(`terminal-launch-${launcher}`)).toBeTruthy();
    }
    expect(sockets).toHaveLength(0);
  });

  it('attaches only the row the operator picks', async () => {
    const { sockets, factory } = makeFactory();
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={clientWith([
      summary({ name: 'ops shell' }),
      summary({ sessionId: OTHER_SESSION_ID, name: 'codex worktree', launcher: 'codex' }),
    ])} />));

    const tabs = await screen.findAllByRole('tab');
    fireEvent.click(tabs[1]);
    await waitFor(() => expect(sockets.length).toBe(1));
    await act(async () => { sockets[0].onopen?.(); });
    expect(sockets[0].frames()[0]).toMatchObject({ type: 'attach', sessionId: OTHER_SESSION_ID });
  });

  it('re-reads the listing when a frame proves the collection revision advanced', async () => {
    const { sockets, factory } = makeFactory();
    const listings = [
      { revision: 4, sessions: [summary({ name: 'ops shell' })] },
      { revision: 9, sessions: [
        summary({ name: 'ops shell' }),
        summary({ sessionId: OTHER_SESSION_ID, name: 'codex worktree', launcher: 'codex' }),
      ] },
    ];
    let call = 0;
    const sessionsClient: TerminalSessionsClient = {
      list: vi.fn(async () => listings[Math.min(call++, listings.length - 1)]),
      remove: vi.fn(async () => ({ ok: true as const })),
    };
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={sessionsClient} />));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    expect(sessionsClient.list).toHaveBeenCalledTimes(1);

    // Attach to the known row, then let the host announce a NEWER revision than the listing was taken at.
    fireEvent.click(screen.getAllByRole('tab')[0]);
    await waitFor(() => expect(sockets.length).toBe(1));
    await act(async () => {
      sockets[0].onopen?.();
      sockets[0].onmessage?.({ data: JSON.stringify({
        type: 'attached', requestId: 'req-00000000000000000000000000000001', revision: 9,
        session: summary({ name: 'ops shell', attachmentCount: 1, attachmentState: 'attached' }),
        attachmentId: ATTACHMENT_ID, replayFrom: 0, nextSequence: 0,
      }) });
    });

    await waitFor(() => expect(sessionsClient.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
  });

  it('keeps a stale listing from deleting rows a newer frame already proved', async () => {
    const { sockets, factory } = makeFactory();
    // Every answer is revision 4 — older than the revision-5 `created` frame below.
    const sessionsClient = clientWith([]);
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={sessionsClient} />));
    await act(async () => {});
    fireEvent.click(screen.getByText('Shell'));
    await waitFor(() => expect(sockets.length).toBe(1));
    await act(async () => {
      sockets[0].onopen?.();
      sockets[0].onmessage?.({ data: JSON.stringify({
        type: 'created', requestId: 'req-00000000000000000000000000000001', revision: 5,
        session: summary({ name: 'ops shell', attachmentCount: 1, attachmentState: 'attached' }),
        attachmentId: ATTACHMENT_ID,
      }) });
    });
    await waitFor(() => expect(sessionsClient.list).toHaveBeenCalledTimes(2));
    await act(async () => {});
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].textContent).toContain('ops shell');
  });

  it('shows the launchers when the host answers with an empty list', async () => {
    const { sockets, factory } = makeFactory();
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={clientWith([])} />));
    await act(async () => {});
    expect(screen.getByText('Start a session')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(sockets).toHaveLength(0);
  });

  it('shows the bounded host detail on the unavailable panel', async () => {
    const { factory } = makeFactory();
    render(mount(
      <Terminal ptyEnabled socketFactory={factory} sessionsClient={clientWith([])} />,
      {
        pty: false,
        diagnostic: {
          reason: 'broker-unavailable',
          detail: 'kb-shell-broker socket is not listening',
          checkedAt: '2026-08-22T10:00:00.000Z',
        },
        localTranscripts: false,
      },
    ));
    await act(async () => {});
    expect(screen.getByText('Terminal unavailable')).toBeTruthy();
    expect(screen.getByTestId('terminal-unavailable-detail').textContent)
      .toBe('kb-shell-broker socket is not listening');
    expect(screen.getByTestId('terminal-unavailable').getAttribute('data-pty-state')).toBe('pty:false');
  });

  it('folds created/attached frames into the tab strip and switches between sessions', async () => {
    const { sockets, factory } = makeFactory();
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={clientWith([])} />));
    await act(async () => {});
    fireEvent.click(screen.getByText('Shell'));
    await waitFor(() => expect(sockets.length).toBe(1));
    await act(async () => {
      sockets[0].onopen?.();
      sockets[0].onmessage?.({ data: JSON.stringify({
        type: 'created', requestId: 'req-00000000000000000000000000000001', revision: 5,
        session: summary({ name: 'ops shell', attachmentCount: 1, attachmentState: 'attached' }),
        attachmentId: ATTACHMENT_ID,
      }) });
    });
    const tab = await screen.findByRole('tab');
    expect(tab.textContent).toContain('ops shell');
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('terminal-host').textContent).toBe('Desktop');
  });
});

/**
 * The browser matrix's own scenario, one layer below the browser. The live run at port 4322 proved the
 * fixture serves `revision: 7` and four rows to context A while the workspace still rendered "Start a
 * session" — the payload was never the problem, the view was. This binds the fixture's OWN bytes to the
 * shipping REST decoder and the shipping view, so the same defect cannot come back without a red test.
 */
describe('the p3-terminal-named-sessions fixture payload', () => {
  async function decodeFixtureListing(ref: string) {
    const payload = p3SessionListing('p3-terminal-named-sessions', ref);
    return listPtySessions('tok-abc', (async () => new Response(JSON.stringify(payload), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch);
  }

  it('renders context A\'s four authorized rows in server order, by server name', async () => {
    const listing = await decodeFixtureListing(P3_BROWSER_PRINCIPALS.a.browserSessionRef);
    if (listing === null) throw new Error('the fixture listing must satisfy the shipping decoder');
    expect(listing.revision).toBe(7);

    const { sockets, factory } = makeFactory();
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={{
      list: vi.fn(async () => listing), remove: vi.fn(async () => ({ ok: true as const })),
    }} />));

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'shell · kb · Shell · Desktop/repo · Live',
      'claude · dashboard · Claude · Desktop/repo/dashboard · Live',
      'codex · p3-w64 · Codex · Desktop/worktrees/p3-w64/dashboard · Live',
      'shell · kb (ended) · Shell · Desktop/repo · Ended',
    ]);
    expect(sockets).toHaveLength(0);
  });

  it('shows a stranger the launchers and none of context A\'s sessions', async () => {
    const listing = await decodeFixtureListing(P3_BROWSER_PRINCIPALS.b.browserSessionRef);
    if (listing === null) throw new Error('the stranger listing must satisfy the shipping decoder');
    expect(listing.sessions).toEqual([]);

    const { factory } = makeFactory();
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={{
      list: vi.fn(async () => listing), remove: vi.fn(async () => ({ ok: true as const })),
    }} />));
    await act(async () => {});
    expect(screen.getByText('Start a session')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('shell · kb');
  });
});

describe('detach and close', () => {
  it('confirms before ending a session, and can be declined', async () => {
    const { sockets, factory } = makeFactory();
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={clientWith([])} />));
    await act(async () => {});
    fireEvent.click(screen.getByText('Shell'));
    await waitFor(() => expect(sockets.length).toBe(1));
    await act(async () => {
      sockets[0].onopen?.();
      sockets[0].onmessage?.({ data: JSON.stringify({
        type: 'created', requestId: 'req-00000000000000000000000000000001', revision: 5,
        session: summary({ attachmentCount: 1, attachmentState: 'attached' }), attachmentId: ATTACHMENT_ID,
      }) });
    });

    fireEvent.click(screen.getByTestId('terminal-close'));
    fireEvent.click(screen.getByTestId('terminal-confirm-no'));
    expect(sockets[0].frames().some((frame) => frame.type === 'close')).toBe(false);

    fireEvent.click(screen.getByTestId('terminal-close'));
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-confirm-yes')); });
    expect(sockets[0].frames().at(-1)).toMatchObject({ type: 'close', sessionId: SESSION_ID });
  });

  it('detaches the selected session without ending it', async () => {
    const { sockets, factory } = makeFactory();
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={clientWith([])} />));
    await act(async () => {});
    fireEvent.click(screen.getByText('Shell'));
    await waitFor(() => expect(sockets.length).toBe(1));
    await act(async () => {
      sockets[0].onopen?.();
      sockets[0].onmessage?.({ data: JSON.stringify({
        type: 'created', requestId: 'req-00000000000000000000000000000001', revision: 5,
        session: summary({ attachmentCount: 1, attachmentState: 'attached' }), attachmentId: ATTACHMENT_ID,
      }) });
    });
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-detach')); });
    expect(sockets[0].frames().at(-1)).toMatchObject({ type: 'detach', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID });
  });
});

describe('no browser-local session memory', () => {
  it('writes nothing to localStorage across a full launch cycle', async () => {
    const { sockets, factory } = makeFactory();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={clientWith([summary()])} />));
    await act(async () => {});
    // (b) Same launch, same assertion — reached through the chrome launcher, because a workspace with a
    // listed session now renders its roster instead of the empty state's `Shell` button.
    fireEvent.click(await screen.findByTestId('terminal-launch-shell'));
    await waitFor(() => expect(sockets.length).toBe(1));
    await act(async () => {
      sockets[0].onopen?.();
      sockets[0].onmessage?.({ data: JSON.stringify({
        type: 'created', requestId: 'req-00000000000000000000000000000001', revision: 5,
        session: summary({ attachmentCount: 1, attachmentState: 'attached' }), attachmentId: ATTACHMENT_ID,
      }) });
    });
    const terminalWrites = setItem.mock.calls.filter(([key]) => String(key).includes('terminal'));
    expect(terminalWrites).toEqual([]);
  });
});

describe('locked', () => {
  it('renders the unlock line and connects nothing', async () => {
    const { sockets, factory } = makeFactory();
    const sessionsClient = clientWith([summary()]);
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={sessionsClient} />, AVAILABLE, null));
    await act(async () => {});
    expect(screen.getByTestId('terminal-locked')).toBeTruthy();
    expect(sessionsClient.list).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });
});
