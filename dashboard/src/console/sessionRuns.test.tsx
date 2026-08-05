// @vitest-environment jsdom
/**
 * The session-run list and row — the "chat session" half of an entity's Runs tab.
 *
 * What is pinned here is honesty, not layout: every row SAYS it is a chat session (the one thing that
 * keeps it from reading as a governed run), a truncated or abandoned transcript says exactly what it is
 * missing, a live session offers no Dismiss (its shell is still running), and a refused dismissal is
 * reported rather than swallowed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';
import type { SessionRunDto, SessionRunsClient } from '../lib/terminalClient';
import { SessionRunRow, newIdempotencyKey, sessionRunOutcomeLabel, transcriptNote, useSessionRuns } from './sessionRuns';

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

function dto(over: Partial<SessionRunDto> & { sessionRunRef: string }): SessionRunDto {
  return {
    kind: 'agent',
    targetRef: 'fyt-runner',
    ptySessionId: 'pty-1',
    startedAt: new Date(1_700_000_000_000).toISOString(),
    endedAt: null,
    outcome: 'ended',
    exitCode: 0,
    transcript: { bytes: 12, truncated: false },
    version: 2,
    ...over,
  };
}

function fakeClient(over: Partial<SessionRunsClient> = {}): SessionRunsClient {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    archive: vi.fn(async (ref: string) => ({ ok: true as const, sessionRun: dto({ sessionRunRef: ref, outcome: 'archived' }), replayed: false })),
    ...over,
  };
}

/** A tiny probe component so the hook can be tested without a whole detail view around it. */
function Probe({ client, kind = 'agent', ref_ = 'fyt-runner' }: {
  client: SessionRunsClient;
  kind?: 'agent' | 'workflow';
  ref_?: string;
}): React.JSX.Element {
  const state = useSessionRuns({ kind, ref: ref_ }, { client });
  return (
    <div>
      <span data-testid="loaded">{state.runs === undefined ? 'unloaded' : String(state.runs.length)}</span>
      <span data-testid="refs">{(state.runs ?? []).map((run) => run.sessionRunRef).join(',')}</span>
      <span data-testid="error">{state.error ?? ''}</span>
      <button type="button" data-testid="archive" onClick={() => void state.archive('srun-a')}>archive</button>
    </div>
  );
}

describe('useSessionRuns', () => {
  it('says UNLOADED rather than empty while the caller is locked, and never calls the server', async () => {
    const client = fakeClient();
    render(<SessionProvider><Probe client={client} /></SessionProvider>);
    await act(async () => Promise.resolve());
    // "We did not look" is a different claim from "we looked and there are none".
    expect(screen.getByTestId('loaded').textContent).toBe('unloaded');
    expect(client.list).not.toHaveBeenCalled();
  });

  it('shows only the sessions bound to THIS entity', async () => {
    const client = fakeClient({
      list: vi.fn(async () => [
        dto({ sessionRunRef: 'srun-a', kind: 'agent', targetRef: 'fyt-runner' }),
        dto({ sessionRunRef: 'srun-b', kind: 'agent', targetRef: 'other-agent' }),
        // Same ref, different KIND — a workflow named like an agent must not be adopted as one.
        dto({ sessionRunRef: 'srun-c', kind: 'workflow', targetRef: 'fyt-runner' }),
      ]),
    });
    render(unlocked(<Probe client={client} />));
    await waitFor(() => expect(screen.getByTestId('refs').textContent).toBe('srun-a'));
  });

  it('drops a dismissed session from the list, and REPORTS a refusal instead of swallowing it', async () => {
    const client = fakeClient({
      list: vi.fn(async () => [dto({ sessionRunRef: 'srun-a' })]),
      archive: vi.fn(async () => ({ ok: false as const, reason: 'This session is still running. End it first, then dismiss it.' })),
    });
    render(unlocked(<Probe client={client} />));
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('1'));

    await act(async () => { fireEvent.click(screen.getByTestId('archive')); });
    expect(screen.getByTestId('error').textContent).toMatch(/still running/i);
    // Refused, so the row stays: a list that quietly dropped it would claim a dismissal that never happened.
    expect(screen.getByTestId('loaded').textContent).toBe('1');

    const ok = fakeClient({ list: vi.fn(async () => [dto({ sessionRunRef: 'srun-a' })]) });
    cleanup();
    render(unlocked(<Probe client={ok} />));
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('1'));
    await act(async () => { fireEvent.click(screen.getByTestId('archive')); });
    expect(screen.getByTestId('loaded').textContent).toBe('0');
    expect(ok.archive).toHaveBeenCalledWith('srun-a', 'tok-abc', expect.objectContaining({
      idempotencyKey: expect.any(String),
    }));
  });
});

describe('outcome and transcript wording', () => {
  it('states an abandoned session plainly instead of softening it', () => {
    expect(sessionRunOutcomeLabel('live')).toBe('running');
    expect(sessionRunOutcomeLabel('ended')).toBe('ended');
    expect(sessionRunOutcomeLabel('abandoned')).toBe('ended at a daemon restart');
    expect(sessionRunOutcomeLabel('archived')).toBe('dismissed');
  });

  it('labels a truncated transcript "last 512KB" and an abandoned one by where it stops', () => {
    expect(transcriptNote(dto({ sessionRunRef: 'srun-a' }), true)).toMatch(/last 512KB/);
    expect(transcriptNote(dto({ sessionRunRef: 'srun-a', outcome: 'abandoned' }), false)).toMatch(/daemon restarted/i);
    expect(transcriptNote(dto({ sessionRunRef: 'srun-a' }), false)).toBeNull();
  });

  it('always produces an idempotency key, even without crypto.randomUUID', () => {
    expect(newIdempotencyKey().length).toBeGreaterThan(8);
  });
});

describe('SessionRunRow', () => {
  function row(run: SessionRunDto, client: SessionRunsClient, over: Partial<Parameters<typeof SessionRunRow>[0]> = {}) {
    return unlocked(
      <SessionRunRow
        run={run}
        expanded={over.expanded ?? true}
        onToggle={over.onToggle ?? (() => {})}
        {...(over.onArchive ? { onArchive: over.onArchive } : {})}
        client={client}
      />,
    );
  }

  it('labels every row a CHAT SESSION and never borrows governed-run chrome', async () => {
    const client = fakeClient();
    render(row(dto({ sessionRunRef: 'srun-a' }), client, { expanded: false }));
    expect(screen.getByTestId('session-run-kind-srun-a').textContent).toBe('chat session');
    expect(screen.getByTestId('session-run-outcome-srun-a').textContent).toContain('ended');
    // No run ref, no governed state vocabulary.
    expect(screen.queryByTestId('workflow-run-srun-a')).toBeNull();
  });

  it('fetches the transcript only when expanded, and only once', async () => {
    const client = fakeClient({
      get: vi.fn(async () => ({
        sessionRun: dto({ sessionRunRef: 'srun-a' }),
        transcript: { text: 'agent: hello', bytes: 12, truncated: false },
      })),
    });
    const { rerender } = render(row(dto({ sessionRunRef: 'srun-a' }), client, { expanded: false }));
    await act(async () => Promise.resolve());
    expect(client.get).not.toHaveBeenCalled();

    rerender(row(dto({ sessionRunRef: 'srun-a' }), client, { expanded: true }));
    await waitFor(() => expect(screen.getByTestId('session-run-transcript-srun-a').textContent).toBe('agent: hello'));
    rerender(row(dto({ sessionRunRef: 'srun-a' }), client, { expanded: true }));
    await act(async () => Promise.resolve());
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('says so when only the tail of a session was kept', async () => {
    const client = fakeClient({
      get: vi.fn(async () => ({
        sessionRun: dto({ sessionRunRef: 'srun-a', transcript: { bytes: 512_000, truncated: true } }),
        transcript: { text: '…tail', bytes: 512_000, truncated: true },
      })),
    });
    render(row(dto({ sessionRunRef: 'srun-a', transcript: { bytes: 512_000, truncated: true } }), client));
    await waitFor(() => expect(screen.getByTestId('session-run-transcript-note-srun-a').textContent).toMatch(/last 512KB/));
  });

  it('offers Dismiss on a finished session and NEVER on a live one', async () => {
    const client = fakeClient();
    const onArchive = vi.fn();
    const { rerender } = render(row(dto({ sessionRunRef: 'srun-a' }), client, { onArchive }));
    await waitFor(() => expect(screen.getByTestId('session-run-archive-srun-a')).toBeTruthy());
    fireEvent.click(screen.getByTestId('session-run-archive-srun-a'));
    expect(onArchive).toHaveBeenCalled();

    rerender(row(dto({ sessionRunRef: 'srun-a', outcome: 'live' }), client, { onArchive }));
    await act(async () => Promise.resolve());
    expect(screen.queryByTestId('session-run-archive-srun-a')).toBeNull();
    // A live row points at the ONE console hosting its shell instead of opening a rival pane.
    expect(screen.getByTestId('session-run-live-note-srun-a').textContent).toMatch(/console above/i);
  });

  it('says a session kept no transcript rather than showing an empty box', async () => {
    const client = fakeClient({ get: vi.fn(async () => ({ sessionRun: dto({ sessionRunRef: 'srun-a' }), transcript: null })) });
    render(row(dto({ sessionRunRef: 'srun-a' }), client));
    await waitFor(() => expect(screen.getByTestId('session-run-transcript-empty-srun-a')).toBeTruthy());
  });
});
