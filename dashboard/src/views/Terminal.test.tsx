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
import type { TerminalSessionsClient } from '../lib/terminalClient';
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
  it('names its tabs from the host listing and attaches the one the operator picks', async () => {
    const { sockets, factory } = makeFactory();
    render(mount(<Terminal ptyEnabled socketFactory={factory} sessionsClient={clientWith([
      summary({ name: 'ops shell' }),
      summary({ sessionId: OTHER_SESSION_ID, name: 'codex worktree', launcher: 'codex' }),
    ])} />));
    // A listing alone mounts no console; the workspace still shows the empty state's launchers until a
    // session is chosen, which is what keeps a background list from opening two sockets on arrival.
    await waitFor(() => expect(screen.getByText('Start a session')).toBeTruthy());
    expect(sockets).toHaveLength(0);
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
    fireEvent.click(screen.getByText('Shell'));
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
