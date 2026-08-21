// @vitest-environment jsdom
/**
 * The workflow detail's RUNS tab (leg 2) — one history, two provenances, never blurred.
 *
 * A workflow produces two genuinely different records: governed runs (compiled, hash-pinned, executor-
 * driven) and chat sessions (a primed `claude` in a terminal, driven by keystrokes). They belong in one
 * time-ordered list, because splitting them hides half of what happened — but a chat session that
 * rendered with a governed run's chrome would be a lie about how the work was done. So the assertions
 * below are mostly about LABELS and DESTINATIONS: every row says which kind it is, a governed row opens
 * the run detail (which by design has no terminal in it), and a session row opens in this page.
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
  class FakeFitAddon { fit() {} }
  return { FitAddon: FakeFitAddon };
});
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { WorkflowDetailBody as WorkflowDetail, mergeRunRows, type WorkflowDefEntry } from './WorkflowDetail';
import type { RunMetadataDto } from '../control/controlClient';
import type { PtySessionSummary, PtySpawnTarget, SessionRunDto, SessionRunsClient, TerminalSessionsClient } from '../lib/terminalClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';

afterEach(() => {
  clearStoredSession();
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

function unlocked(ui: React.ReactElement, token = 'tok-abc'): React.ReactElement {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

const def = (over: Partial<WorkflowDefEntry> & { ref: string }): WorkflowDefEntry => ({
  displayName: 'Video pipeline',
  shortRef: 1,
  project: 'kb',
  path: 'orgs/kb/workflows/video.md',
  sourceHash: 'a'.repeat(64),
  valid: true,
  title: 'Video pipeline',
  profile: 'standard',
  stageCount: 1,
  riskTier: 'T1',
  stages: [{ id: 'write', action: 'write', target: 'script.md', riskTier: 'T1' }],
  detail: null,
  ...over,
});

const governed = (over: Partial<RunMetadataDto> & { runRef: string }): RunMetadataDto => ({
  ownerSubject: 'operator',
  displayName: 'Governed video run',
  shortRef: 7,
  workflowRef: 'kb~video.md',
  state: 'running',
  publicationState: 'published',
  createdAt: new Date(1_700_000_000_000).toISOString(),
  updatedAt: new Date(1_700_000_000_000).toISOString(),
  openHumanRequestCount: 0,
  ...over,
} as RunMetadataDto);

const session = (over: Partial<SessionRunDto> & { sessionRunRef: string }): SessionRunDto => ({
  kind: 'workflow',
  targetRef: 'kb~video.md',
  ptySessionId: 'pty-1',
  startedAt: new Date(1_700_000_100_000).toISOString(),
  endedAt: new Date(1_700_000_200_000).toISOString(),
  outcome: 'ended',
  exitCode: 0,
  transcript: { bytes: 20, truncated: false },
  version: 2,
  ...over,
});

function fakeSessionRunsClient(runs: SessionRunDto[]): SessionRunsClient {
  return {
    list: vi.fn(async () => runs),
    get: vi.fn(async (ref: string) => ({
      sessionRun: runs.find((run) => run.sessionRunRef === ref) as SessionRunDto,
      transcript: { text: 'operator: go\nagent: done', bytes: 24, truncated: false },
    })),
    archive: vi.fn(async (ref: string) => ({
      ok: true as const,
      sessionRun: { ...(runs.find((run) => run.sessionRunRef === ref) as SessionRunDto), outcome: 'archived' as const },
      replayed: false,
    })),
  };
}

class FakeWS {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev?: { reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
}

function fakeDaemon() {
  const live: PtySessionSummary[] = [];
  const socketFactory = vi.fn((_token: string, attachSessionId?: string, spawn?: PtySpawnTarget) => {
    const ws = new FakeWS();
    if (attachSessionId === undefined) {
      live.push({
        sessionId: `pty-${live.length + 1}`,
        createdAt: Date.now(),
        attached: true,
        kind: spawn?.mode ?? 'shell',
        targetRef: spawn?.workflowRef ?? spawn?.agentId ?? null,
      });
    }
    return ws as unknown as WebSocket;
  });
  const sessionsClient: TerminalSessionsClient = {
    list: vi.fn(async () => [...live]),
    remove: vi.fn(async () => {}),
  };
  return { socketFactory, sessionsClient, live };
}

describe('mergeRunRows', () => {
  it('interleaves both record kinds by start time, newest first', () => {
    const rows = mergeRunRows(
      [governed({ runRef: 'run-old', updatedAt: new Date(1_000).toISOString() })],
      [session({ sessionRunRef: 'srun-new', startedAt: new Date(9_000).toISOString() })],
    );
    expect(rows.map((row) => row.row)).toEqual(['session', 'governed']);
  });

  it('treats a missing list as nothing to merge, never as an error', () => {
    expect(mergeRunRows(undefined, undefined)).toEqual([]);
    expect(mergeRunRows([governed({ runRef: 'run-1' })], undefined)).toHaveLength(1);
  });
});

describe('the Runs tab merges governed runs and chat sessions', () => {
  it('labels each row with its KIND and keeps the two vocabularies apart', async () => {
    const client = fakeSessionRunsClient([session({ sessionRunRef: 'srun-a' })]);
    render(unlocked(
      <WorkflowDetail
        entry={def({ ref: 'kb~video.md' })}
        compiled={null}
        runs={[governed({ runRef: 'run-7' })]}
        sessionRunsClient={client}
      />,
    ));
    await waitFor(() => expect(screen.getByTestId('session-run-srun-a')).toBeTruthy());

    expect(screen.getByTestId('workflow-run-kind-run-7').textContent).toBe('governed run');
    expect(screen.getByTestId('session-run-kind-srun-a').textContent).toBe('chat session');
  });

  it('opens a governed run in the run detail and a chat session IN THIS PAGE', async () => {
    const onOpenRun = vi.fn();
    const client = fakeSessionRunsClient([session({ sessionRunRef: 'srun-a' })]);
    render(unlocked(
      <WorkflowDetail
        entry={def({ ref: 'kb~video.md' })}
        compiled={null}
        runs={[governed({ runRef: 'run-7' })]}
        onOpenRun={onOpenRun}
        sessionRunsClient={client}
      />,
    ));
    await waitFor(() => expect(screen.getByTestId('session-run-srun-a')).toBeTruthy());

    // Governed: navigates to the run detail, which deliberately contains no terminal.
    fireEvent.click(screen.getByTestId('workflow-run-run-7'));
    expect(onOpenRun).toHaveBeenCalledWith('run-7');

    // Session: expands here. No navigation of any kind.
    onOpenRun.mockClear();
    fireEvent.click(screen.getByTestId('session-run-toggle-srun-a'));
    await waitFor(() => expect(screen.getByTestId('session-run-transcript-srun-a').textContent).toContain('agent: done'));
    expect(onOpenRun).not.toHaveBeenCalled();
  });

  it('shows only THIS workflow\'s sessions', async () => {
    const client = fakeSessionRunsClient([
      session({ sessionRunRef: 'srun-mine' }),
      session({ sessionRunRef: 'srun-other', targetRef: 'kb~audio.md' }),
      session({ sessionRunRef: 'srun-agent', kind: 'agent', targetRef: 'kb~video.md' }),
    ]);
    render(unlocked(
      <WorkflowDetail entry={def({ ref: 'kb~video.md' })} compiled={null} runs={[]} sessionRunsClient={client} />,
    ));
    await waitFor(() => expect(screen.getByTestId('session-run-srun-mine')).toBeTruthy());
    expect(screen.queryByTestId('session-run-srun-other')).toBeNull();
    expect(screen.queryByTestId('session-run-srun-agent')).toBeNull();
  });

  it('dismisses a finished session and drops it from the list', async () => {
    const client = fakeSessionRunsClient([session({ sessionRunRef: 'srun-a' })]);
    render(unlocked(
      <WorkflowDetail entry={def({ ref: 'kb~video.md' })} compiled={null} runs={[]} sessionRunsClient={client} />,
    ));
    await waitFor(() => expect(screen.getByTestId('session-run-srun-a')).toBeTruthy());
    fireEvent.click(screen.getByTestId('session-run-toggle-srun-a'));
    await act(async () => { fireEvent.click(screen.getByTestId('session-run-archive-srun-a')); });

    expect(client.archive).toHaveBeenCalledWith('srun-a', 'tok-abc', expect.objectContaining({
      idempotencyKey: expect.any(String),
    }));
    await waitFor(() => expect(screen.queryByTestId('session-run-srun-a')).toBeNull());
  });

  it('distinguishes "not loaded" from "nothing has happened here"', async () => {
    const client = fakeSessionRunsClient([]);
    const { rerender } = render(
      <SessionProvider>
        <WorkflowDetail entry={def({ ref: 'kb~video.md' })} compiled={null} sessionRunsClient={client} />
      </SessionProvider>,
    );
    expect(screen.getByTestId('workflow-runs-unloaded')).toBeTruthy();

    rerender(unlocked(
      <WorkflowDetail entry={def({ ref: 'kb~video.md' })} compiled={null} runs={[]} sessionRunsClient={client} />,
    ));
    await waitFor(() => expect(screen.getByTestId('workflow-runs-empty').textContent).toMatch(/has not run yet/i));
  });
});

describe('"Run workflow" opens a session in the page, not in the Terminal destination', () => {
  it('spawns a workflow-primed session on the Runs tab', async () => {
    const daemon = fakeDaemon();
    const client = fakeSessionRunsClient([]);
    render(unlocked(
      <WorkflowDetail
        entry={def({ ref: 'kb~video.md' })}
        compiled={null}
        runs={[]}
        sessionRunsClient={client}
        socketFactory={daemon.socketFactory}
        sessionsClient={daemon.sessionsClient}
      />,
    ));

    // Nothing opens just by looking at a workflow.
    await act(async () => Promise.resolve());
    expect(daemon.socketFactory).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByTestId('workflow-run')); });
    await waitFor(() => expect(screen.getByTestId('console-panel-workflow')).toBeTruthy());
    expect(screen.getByLabelText('Live session for this workflow')).toBeTruthy();
    expect(daemon.socketFactory).toHaveBeenCalledWith('tok-abc', undefined, {
      mode: 'workflow',
      workflowRef: 'kb~video.md',
    });
  });

  it('reattaches to an already-live session instead of spawning a second one', async () => {
    const daemon = fakeDaemon();
    daemon.live.push({ sessionId: 'pty-live', createdAt: Date.now(), attached: false, kind: 'workflow', targetRef: 'kb~video.md' });
    const client = fakeSessionRunsClient([session({ sessionRunRef: 'srun-a', outcome: 'live', endedAt: null })]);
    render(unlocked(
      <WorkflowDetail
        entry={def({ ref: 'kb~video.md' })}
        compiled={null}
        runs={[]}
        sessionRunsClient={client}
        socketFactory={daemon.socketFactory}
        sessionsClient={daemon.sessionsClient}
      />,
    ));
    await waitFor(() => expect(screen.getByTestId('workflow-console-mode').textContent).toBe('attached'));
    expect(daemon.socketFactory).toHaveBeenCalledWith('tok-abc', 'pty-live', undefined);
    // The live row does NOT open a second pane: two sinks on one shell evict each other.
    fireEvent.click(screen.getByTestId('session-run-toggle-srun-a'));
    await waitFor(() => expect(screen.getByTestId('session-run-live-note-srun-a')).toBeTruthy());
    expect(screen.getAllByTestId('console-panel-workflow')).toHaveLength(1);
  });

  it('refuses to offer a session for a workflow that cannot run', () => {
    const client = fakeSessionRunsClient([]);
    render(unlocked(
      <WorkflowDetail
        entry={def({ ref: 'kb~video.md', valid: false, detail: 'unparsable' })}
        compiled={null}
        runs={[]}
        sessionRunsClient={client}
      />,
    ));
    expect(screen.getByTestId('workflow-console-unrunnable')).toBeTruthy();
  });
});
