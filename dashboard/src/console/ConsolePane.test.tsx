// @vitest-environment jsdom
/**
 * P3 W6.4 — `<ConsolePane>` against the v2 frame protocol. The socket is injected and xterm is mocked,
 * so nothing here opens a real WebSocket or measures a real grid. What is pinned: the first frame is a
 * `create` or an `attach` (never a query), keystrokes leave as base64 `input` frames, output arrives
 * base64-decoded, a read-only replay wires no keystroke path at all, a lost socket keeps the scrollback
 * and offers Reattach from the cursor, and every refusal is SHOWN.
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

const xtermReg = vi.hoisted(() => ({
  instances: [] as Array<{ writes: string[]; dataCb: ((d: string) => void) | null; options: Record<string, unknown> }>,
}));

vi.mock('@xterm/xterm', () => {
  class FakeXTerm {
    cols = 80;
    rows = 24;
    writes: string[] = [];
    dataCb: ((d: string) => void) | null = null;
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      xtermReg.instances.push(this);
    }
    loadAddon() {}
    open() {}
    write(d: string) { this.writes.push(d); }
    clear() { this.writes.length = 0; }
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

import { ConsolePane, LOST_OUTPUT_NOTICE, closureMessage, consoleTargetKey } from './ConsolePane';
import { encodeInput } from '../lib/terminalClient';
import type { TerminalSessionsClient } from '../lib/terminalClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';
import type { SessionSummary } from '../../shared/ptyProtocol.ts';

const SESSION_ID = `pty-${'a'.repeat(32)}`;
const ATTACHMENT_ID = `att-${'b'.repeat(32)}`;

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: SESSION_ID, name: 'shell 1', host: 'desktop', launcher: 'shell', rootId: 'repo',
    cwd: 'ops', state: 'live', attachmentCount: 1, attachmentState: 'attached',
    startedAt: '2026-08-22T10:00:00.000Z', endedAt: null, exit: null, ...overrides,
  };
}

class FakeWS {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((event?: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close(code?: number) { this.readyState = 3; this.closed = true; this.onclose?.({ code }); }
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

function stubSessionsClient(): TerminalSessionsClient {
  return {
    list: vi.fn(async () => ({ revision: 1, sessions: [] })),
    remove: vi.fn(async () => ({ ok: true as const })),
  };
}

function unlocked(ui: React.ReactElement, token = 'tok-abc'): React.ReactElement {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

/** Wait until the pane's lazy xterm import has resolved and its socket exists. */
async function openedSocket(sockets: FakeWS[]): Promise<FakeWS> {
  await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
  await act(async () => { sockets[0].onopen?.(); });
  return sockets[0];
}

afterEach(() => {
  clearStoredSession();
  cleanup();
  xtermReg.instances.length = 0;
  vi.clearAllMocks();
});

describe('consoleTargetKey', () => {
  it('separates the three modes and every create shape', () => {
    expect(consoleTargetKey({ mode: 'attach', sessionId: SESSION_ID }))
      .not.toBe(consoleTargetKey({ mode: 'replay', sessionId: SESSION_ID }));
    expect(consoleTargetKey({ mode: 'create', launcher: 'shell', rootId: 'repo', relativeCwd: '.' }))
      .not.toBe(consoleTargetKey({ mode: 'create', launcher: 'claude', rootId: 'repo', relativeCwd: '.' }));
    // Rebuilding the same literal is the SAME key — a parent re-render may never mint a second session.
    expect(consoleTargetKey({ mode: 'create', launcher: 'shell', rootId: 'repo', relativeCwd: 'a' }))
      .toBe(consoleTargetKey({ mode: 'create', launcher: 'shell', rootId: 'repo', relativeCwd: 'a' }));
  });
});

describe('opening', () => {
  it('sends a create frame naming a launcher, a root id and a relative cwd — never a command', async () => {
    const { sockets, factory } = makeFactory();
    render(unlocked(
      <ConsolePane
        target={{ mode: 'create', launcher: 'claude', rootId: 'worktrees', relativeCwd: 'feature' }}
        visible
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
      />,
    ));
    const socket = await openedSocket(sockets);
    expect(socket.frames()).toHaveLength(1);
    const frame = socket.frames()[0];
    expect(frame.type).toBe('create');
    expect(frame.launcher).toBe('claude');
    expect(frame.rootId).toBe('worktrees');
    expect(frame.relativeCwd).toBe('feature');
    expect(Object.keys(frame)).not.toContain('command');
  });

  it('attaches an existing session from sequence zero', async () => {
    const { sockets, factory } = makeFactory();
    render(unlocked(
      <ConsolePane target={{ mode: 'attach', sessionId: SESSION_ID }} visible socketFactory={factory} sessionsClient={stubSessionsClient()} />,
    ));
    const socket = await openedSocket(sockets);
    expect(socket.frames()[0]).toMatchObject({ type: 'attach', sessionId: SESSION_ID, fromSequence: 0 });
  });

  it('opens NO socket until the browser session resolves, then opens one', async () => {
    // The production bug: `/api/pty` resolves a browser principal and 428s without the
    // `kb_browser_session` cookie, and nothing in the client ever asked for it — so on the tailnet
    // deployment every terminal died as "Disconnected — the connection failed." The order is the fix.
    const { sockets, factory } = makeFactory();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ensureBrowserSession = vi.fn(async () => {
      await gate;
      return { ok: true as const };
    });
    render(unlocked(
      <ConsolePane
        target={{ mode: 'attach', sessionId: SESSION_ID }}
        visible
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
        ensureBrowserSession={ensureBrowserSession}
      />,
    ));

    await act(async () => {});
    expect(ensureBrowserSession).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(0);

    await act(async () => { release?.(); await gate; });
    await waitFor(() => expect(sockets).toHaveLength(1));
  });

  it('shows a refused browser session instead of opening a socket that can only 428', async () => {
    const { sockets, factory } = makeFactory();
    render(unlocked(
      <ConsolePane
        target={{ mode: 'attach', sessionId: SESSION_ID }}
        visible
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
        ensureBrowserSession={async () => ({ ok: false as const, reason: 'refused' as const })}
      />,
    ));

    const diagnostic = await screen.findByTestId('console-panel-diagnostic');
    expect(diagnostic.textContent).toContain('could not start a terminal session');
    expect(sockets).toHaveLength(0);
  });

  it('opens nothing without a session bearer', async () => {
    const { sockets, factory } = makeFactory();
    render(<SessionProvider><ConsolePane target={{ mode: 'attach', sessionId: SESSION_ID }} visible socketFactory={factory} sessionsClient={stubSessionsClient()} /></SessionProvider>);
    await act(async () => {});
    expect(sockets).toHaveLength(0);
  });
});

describe('the live stream', () => {
  it('writes base64-decoded output and sends keystrokes as base64 input frames', async () => {
    const { sockets, factory } = makeFactory();
    render(unlocked(
      <ConsolePane target={{ mode: 'attach', sessionId: SESSION_ID }} visible socketFactory={factory} sessionsClient={stubSessionsClient()} />,
    ));
    const socket = await openedSocket(sockets);
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({
        type: 'attached', requestId: 'req-00000000000000000000000000000001', revision: 3,
        session: summary(), attachmentId: ATTACHMENT_ID, replayFrom: 0, nextSequence: 0,
      }) });
      socket.onmessage?.({ data: JSON.stringify({
        type: 'data', requestId: null, sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID,
        sequence: 0, encoding: 'base64', data: encodeInput('hello\r\n'), replay: false,
      }) });
    });
    expect(xtermReg.instances[0].writes).toEqual(['hello\r\n']);
    await act(async () => { xtermReg.instances[0].dataCb?.('ls'); });
    const input = socket.frames().find((frame) => frame.type === 'input');
    expect(input).toMatchObject({
      sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID, encoding: 'base64', data: encodeInput('ls'),
    });
  });

  it('shows a refusal instead of swallowing it', async () => {
    const { sockets, factory } = makeFactory();
    render(unlocked(
      <ConsolePane target={{ mode: 'attach', sessionId: SESSION_ID }} visible socketFactory={factory} sessionsClient={stubSessionsClient()} />,
    ));
    const socket = await openedSocket(sockets);
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({
        type: 'error', requestId: null, sessionId: SESSION_ID, code: 'capacity', detail: null,
      }) });
    });
    expect(screen.getByTestId('console-panel-diagnostic').textContent).toMatch(/maximum number of sessions/i);
    expect(screen.getByTestId('console-panel').getAttribute('data-state')).toBe('error');
  });

  it('refuses to render a frame the decoder cannot verify', async () => {
    const { sockets, factory } = makeFactory();
    render(unlocked(
      <ConsolePane target={{ mode: 'attach', sessionId: SESSION_ID }} visible socketFactory={factory} sessionsClient={stubSessionsClient()} />,
    ));
    const socket = await openedSocket(sockets);
    await act(async () => { socket.onmessage?.({ data: 'raw pty output that used to be written straight to the grid' }); });
    expect(xtermReg.instances[0].writes).toEqual([]);
    expect(screen.getByTestId('console-panel-diagnostic').textContent).toMatch(/could not verify/i);
  });
});

describe('detach, close and reattach', () => {
  it('detaches without ending the session, then reattaches from the cursor', async () => {
    const { sockets, factory } = makeFactory();
    let control: { requestDetach(): void } | null = null;
    render(unlocked(
      <ConsolePane
        target={{ mode: 'attach', sessionId: SESSION_ID }}
        visible
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
        registerControl={(value) => { control = value; }}
      />,
    ));
    const socket = await openedSocket(sockets);
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({
        type: 'attached', requestId: 'req-00000000000000000000000000000001', revision: 1,
        session: summary(), attachmentId: ATTACHMENT_ID, replayFrom: 0, nextSequence: 0,
      }) });
      socket.onmessage?.({ data: JSON.stringify({
        type: 'data', requestId: null, sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID,
        sequence: 4, encoding: 'base64', data: encodeInput('x'), replay: false,
      }) });
    });
    await act(async () => { control?.requestDetach(); });
    expect(socket.frames().at(-1)).toMatchObject({ type: 'detach', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID });
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({
        type: 'ack', requestId: 'req-00000000000000000000000000000002', action: 'detach',
        sessionId: SESSION_ID, revision: 2, attachmentId: ATTACHMENT_ID,
      }) });
    });
    expect(screen.getByTestId('console-panel').getAttribute('data-state')).toBe('detached');

    fireEvent.click(screen.getByTestId('console-panel-reattach'));
    await waitFor(() => expect(sockets.length).toBe(2));
    await act(async () => { sockets[1].onopen?.(); });
    // The cursor is a BYTE offset: the frame started at 4 and carried one byte, so 5 is the next byte
    // this pane has not seen. The scrollback survives, the bytes resume.
    expect(sockets[1].frames()[0]).toMatchObject({ type: 'attach', sessionId: SESSION_ID, fromSequence: 5 });
    expect(xtermReg.instances).toHaveLength(1);
  });

  it('advances its cursor by BYTES and then adopts the cursor the server names', async () => {
    const { sockets, factory } = makeFactory();
    let control: { requestDetach(): void } | null = null;
    render(unlocked(
      <ConsolePane
        target={{ mode: 'attach', sessionId: SESSION_ID }}
        visible
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
        registerControl={(value) => { control = value; }}
      />,
    ));
    const socket = await openedSocket(sockets);
    expect(socket.frames()[0]).toMatchObject({ type: 'attach', fromSequence: 0 });
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({
        type: 'attached', requestId: 'req-00000000000000000000000000000001', revision: 1,
        session: summary(), attachmentId: ATTACHMENT_ID, replayFrom: 0, nextSequence: 0,
      }) });
      // Five BYTES from offset zero. Four of them are one multibyte character, so a cursor counting
      // characters or frames would send a different number here and lose or duplicate output.
      socket.onmessage?.({ data: JSON.stringify({
        type: 'data', requestId: null, sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID,
        sequence: 0, encoding: 'base64', data: encodeInput('a€a'), replay: false,
      }) });
    });
    await act(async () => { control?.requestDetach(); });
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({
        type: 'ack', requestId: 'req-00000000000000000000000000000002', action: 'detach',
        sessionId: SESSION_ID, revision: 2, attachmentId: ATTACHMENT_ID,
      }) });
    });
    fireEvent.click(screen.getByTestId('console-panel-reattach'));
    await waitFor(() => expect(sockets.length).toBe(2));
    await act(async () => { sockets[1].onopen?.(); });
    expect(sockets[1].frames()[0]).toMatchObject({ type: 'attach', fromSequence: 5 });

    // The server's cursor wins on every attach: it knows what it actually replayed.
    await act(async () => {
      sockets[1].onmessage?.({ data: JSON.stringify({
        type: 'attached', requestId: 'req-00000000000000000000000000000003', revision: 3,
        session: summary(), attachmentId: ATTACHMENT_ID, replayFrom: 5, nextSequence: 4_096,
      }) });
    });
    await act(async () => { control?.requestDetach(); });
    await act(async () => {
      sockets[1].onmessage?.({ data: JSON.stringify({
        type: 'ack', requestId: 'req-00000000000000000000000000000004', action: 'detach',
        sessionId: SESSION_ID, revision: 4, attachmentId: ATTACHMENT_ID,
      }) });
    });
    fireEvent.click(screen.getByTestId('console-panel-reattach'));
    await waitFor(() => expect(sockets.length).toBe(3));
    await act(async () => { sockets[2].onopen?.(); });
    expect(sockets[2].frames()[0]).toMatchObject({ type: 'attach', fromSequence: 4_096 });
  });

  it('says so once, in plain words, when the replay could not start where it asked', async () => {
    const { sockets, factory } = makeFactory();
    render(unlocked(
      <ConsolePane
        target={{ mode: 'attach', sessionId: SESSION_ID }}
        visible
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
      />,
    ));
    const socket = await openedSocket(sockets);
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({
        type: 'attached', requestId: 'req-00000000000000000000000000000001', revision: 1,
        session: summary(), attachmentId: ATTACHMENT_ID, replayFrom: 65_536, nextSequence: 131_072,
      }) });
    });
    const written = xtermReg.instances[0].writes.join('');
    expect(written).toContain(LOST_OUTPUT_NOTICE);
    // No numbers, no cursor, no byte counts: none of that is the operator's to reconcile.
    expect(written).not.toMatch(/65_?536|131_?072/);
  });

  it('writes no notice when the server replayed everything the pane asked for', async () => {
    const { sockets, factory } = makeFactory();
    render(unlocked(
      <ConsolePane
        target={{ mode: 'attach', sessionId: SESSION_ID }}
        visible
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
      />,
    ));
    const socket = await openedSocket(sockets);
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({
        type: 'attached', requestId: 'req-00000000000000000000000000000001', revision: 1,
        session: summary(), attachmentId: ATTACHMENT_ID, replayFrom: 0, nextSequence: 12,
      }) });
    });
    expect(xtermReg.instances[0].writes.join('')).not.toContain(LOST_OUTPUT_NOTICE);
  });

  it('gives the operator different words for a shed connection than for an ordinary one', async () => {
    const { sockets, factory } = makeFactory();
    render(unlocked(
      <ConsolePane
        target={{ mode: 'attach', sessionId: SESSION_ID }}
        visible
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
      />,
    ));
    const socket = await openedSocket(sockets);
    await act(async () => { socket.onclose?.({ code: 1013 }); });
    expect(screen.getByTestId('console-panel').textContent).toContain(closureMessage('backpressure'));
    expect(closureMessage('backpressure')).not.toBe(closureMessage('normal'));
    expect(closureMessage('normal')).toBe(closureMessage('other'));
    for (const reason of ['policy', 'tooLarge', 'error'] as const) {
      expect(closureMessage(reason)).not.toBe(closureMessage('normal'));
    }
  });

  it('closes through the socket while live and through the REST route once it is gone', async () => {
    const { sockets, factory } = makeFactory();
    const sessionsClient = stubSessionsClient();
    let control: { requestClose(): void } | null = null;
    render(unlocked(
      <ConsolePane
        target={{ mode: 'attach', sessionId: SESSION_ID }}
        visible
        socketFactory={factory}
        sessionsClient={sessionsClient}
        registerControl={(value) => { control = value; }}
      />,
    ));
    const socket = await openedSocket(sockets);
    await act(async () => { control?.requestClose(); });
    expect(socket.frames().at(-1)).toMatchObject({ type: 'close', sessionId: SESSION_ID });

    socket.readyState = 3;
    await act(async () => { control?.requestClose(); });
    expect(sessionsClient.remove).toHaveBeenCalledWith(SESSION_ID, 'tok-abc');
  });
});

describe('read-only replay', () => {
  it('wires no keystroke path and says so', async () => {
    const { sockets, factory } = makeFactory();
    render(unlocked(
      <ConsolePane target={{ mode: 'replay', sessionId: SESSION_ID }} visible socketFactory={factory} sessionsClient={stubSessionsClient()} />,
    ));
    const socket = await openedSocket(sockets);
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({
        type: 'attached', requestId: 'req-00000000000000000000000000000001', revision: 1,
        session: summary(), attachmentId: ATTACHMENT_ID, replayFrom: 0, nextSequence: 2,
      }) });
      socket.onmessage?.({ data: JSON.stringify({
        type: 'data', requestId: null, sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID,
        sequence: 0, encoding: 'base64', data: encodeInput('past output'), replay: true,
      }) });
    });
    expect(xtermReg.instances[0].writes).toEqual(['past output']);
    expect(xtermReg.instances[0].options.disableStdin).toBe(true);
    expect(xtermReg.instances[0].dataCb).toBeNull();
    expect(screen.getByTestId('console-panel-readonly')).toBeTruthy();
    // Nothing beyond the opening attach was ever sent: no input, no resize.
    expect(socket.frames().every((frame) => frame.type === 'attach')).toBe(true);
  });
});


describe('[C-R6] REST-fed read-only replay', () => {
  it('writes the read transcript into the ONE grid and opens no socket at all', async () => {
    const { sockets, factory } = makeFactory();
    const replaySource = vi.fn(async () => ({
      ok: true as const,
      frames: [
        { sequence: 0, encoding: 'base64' as const, data: encodeInput('first ') },
        { sequence: 6, encoding: 'base64' as const, data: encodeInput('second') },
      ],
    }));
    render(unlocked(
      <ConsolePane
        target={{ mode: 'replay', sessionId: SESSION_ID }}
        visible
        replaySource={replaySource}
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
      />,
    ));
    await waitFor(() => expect(xtermReg.instances[0]?.writes).toEqual(['first ', 'second']));
    expect(replaySource).toHaveBeenCalledWith(SESSION_ID);
    expect(sockets).toHaveLength(0);
    // One grid, no keystroke path, and the pane says out loud that it cannot be typed into.
    expect(xtermReg.instances).toHaveLength(1);
    expect(xtermReg.instances[0].options.disableStdin).toBe(true);
    expect(xtermReg.instances[0].dataCb).toBeNull();
    expect(screen.getByTestId('console-panel-readonly')).toBeTruthy();
  });

  it('re-renders with an EQUAL target without re-reading or duplicating the transcript', async () => {
    // M1 regression: the replay effect keyed on the `target` OBJECT, which `RunDetail` rebuilds as a
    // fresh literal on every detail refresh — so each parent render re-downloaded the whole transcript
    // and appended it to the grid again. The effect now keys on the string `targetKey`.
    const { factory } = makeFactory();
    const replaySource = vi.fn(async () => ({
      ok: true as const,
      frames: [{ sequence: 0, encoding: 'base64' as const, data: encodeInput('once') }],
    }));
    const pane = (): React.JSX.Element => unlocked(
      <ConsolePane
        target={{ mode: 'replay', sessionId: SESSION_ID }}
        visible
        replaySource={replaySource}
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
      />,
    );
    const view = render(pane());
    await waitFor(() => expect(xtermReg.instances[0]?.writes).toEqual(['once']));

    view.rerender(pane());
    view.rerender(pane());
    await waitFor(() => expect(replaySource).toHaveBeenCalledTimes(1));

    expect(xtermReg.instances).toHaveLength(1);
    expect(xtermReg.instances[0].writes).toEqual(['once']);
  });

  it('writes the lost-output notice ahead of a truncated transcript', async () => {
    const { factory } = makeFactory();
    render(unlocked(
      <ConsolePane
        target={{ mode: 'replay', sessionId: SESSION_ID }}
        visible
        replaySource={async () => ({ ok: true, lostOutput: true, frames: [{ sequence: 64, encoding: 'base64', data: encodeInput('tail') }] })}
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
      />,
    ));
    await waitFor(() => expect(xtermReg.instances[0]?.writes)
      .toEqual([LOST_OUTPUT_NOTICE + '\r\n', 'tail']));
  });

  it('shows the refusal sentence instead of an empty grid that looks like silence', async () => {
    const { sockets, factory } = makeFactory();
    render(unlocked(
      <ConsolePane
        target={{ mode: 'replay', sessionId: SESSION_ID }}
        visible
        replaySource={async () => ({ ok: false, notice: 'This attempt has no terminal output on this run.' })}
        socketFactory={factory}
        sessionsClient={stubSessionsClient()}
      />,
    ));
    await waitFor(() => expect(screen.getByTestId('console-panel-diagnostic').textContent)
      .toContain('This attempt has no terminal output on this run.'));
    expect(sockets).toHaveLength(0);
    expect(xtermReg.instances[0]?.writes ?? []).toEqual([]);
  });
});
