// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagedRuns } from './ManagedRuns';
import type { RunMetadataDto } from './controlClient';
import { backStack, pushStack, rootStack, setSectionOnStack, type NavEntry } from '../nav/stack';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LONG_TITLE =
  'Rebuild the faceless video pipeline end to end and republish the audio stage against the reviewed proposal';

const runs: RunMetadataDto[] = [
  {
    runRef: 'run-1', predecessorRunRef: null, title: LONG_TITLE, proposalRef: 'proposal-1',
    proposalRevision: 2, proposalHash: 'a'.repeat(64), publicationState: 'published', state: 'running',
    version: 4, managerSessionRef: 'session-manager', managerGeneration: 1, managerAssignment: null,
    createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T11:56:00.000Z',
    stageCount: 6, attemptCount: 11, sessionCount: 3, openHumanRequestCount: 0, eventCount: 340,
  },
  {
    runRef: 'run-2', predecessorRunRef: null, title: 'A second run', proposalRef: 'proposal-2',
    proposalRevision: 1, proposalHash: 'b'.repeat(64), publicationState: 'published', state: 'succeeded',
    version: 2, managerSessionRef: 'session-manager-2', managerGeneration: 1, managerAssignment: null,
    createdAt: '2026-07-18T09:00:00.000Z', updatedAt: '2026-07-18T09:30:00.000Z',
    stageCount: 2, attemptCount: 2, sessionCount: 1, openHumanRequestCount: 0, eventCount: 12,
  },
];

const detailFor = (runRef: string) => ({
  ok: true,
  value: {
    run: runs.find((item) => item.runRef === runRef),
    stages: [{
      stageRef: 'stage-1', runRef, stageId: 'compile', title: 'Compile proposal', dependsOn: [],
      canonicalCardRef: 'card-1', state: 'running', version: 2, currentAttemptRef: 'attempt-1',
      assignment: null,
      createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
    }],
    attempts: [{
      attemptRef: 'attempt-1', runRef, stageRef: 'stage-1', generation: 1, predecessorAttemptRef: null,
      runtime: 'codex', model: 'gpt-5.6-sol', state: 'running', version: 2,
      managedSessionRef: 'session-worker', createdAt: '2026-07-18T10:00:00.000Z',
      updatedAt: '2026-07-18T10:01:00.000Z',
    }],
    sessions: [],
    humanRequests: [],
  },
});

/** Route the control-plane reads this surface performs. */
function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = url.includes('/events')
      ? { ok: true, value: [] }
      : url.includes('/revisions/')
        ? { ok: true, value: { proposalRef: 'proposal-1', revision: 2, hash: 'a'.repeat(64), previousHash: null, title: 't', createdAt: '2026-07-18T10:00:00.000Z', approval: null, sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [{ checkpoints: [{ id: 'after-tests', label: 'After tests' }] }] } } }
        : url.includes('/api/control/runs/')
          ? detailFor(url.split('/api/control/runs/')[1].split('?')[0])
          : { runs };
    return { ok: true, status: 200, json: async () => json } as Response;
  }));
}

/**
 * A harness mirroring exactly what App does with the nav stack, so back-navigation is exercised
 * through the real stack helpers rather than a stand-in.
 */
function Harness(): React.JSX.Element {
  const [stack, setStack] = useState<NavEntry[]>(() => rootStack('pipeline'));
  const entry = stack[stack.length - 1];
  return (
    <ManagedRuns
      sessionToken="token-1"
      runs={runs}
      focusRunRef={entry.focus?.kind === 'run' ? entry.focus.id : null}
      onOpenRun={(runRef) => setStack((s) => pushStack(s, { view: 'pipeline', focus: { kind: 'run', id: runRef } }))}
      onBackToRuns={() => setStack((s) => backStack(s))}
      activeSectionId={entry.section}
      onSectionChange={(id) => setStack((s) => setSectionOnStack(s, id))}
      now={Date.parse('2026-07-18T12:00:00.000Z')}
    />
  );
}

describe('ManagedRuns', () => {
  it('routes a focused reserved completion request to the dedicated resolver, never generic respond', async () => {
    const gate = {
      requestRef: 'gate-1', runRef: 'run-1', stageRef: 'stage-1', kind: 'approval', revision: 1, state: 'open',
      title: 'Review gate', prompt: 'Approve the checker result.', response: null,
      createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:00:00.000Z',
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.includes('/events')) return { ok: true, status: 200, json: async () => ({ ok: true, value: [] }) } as Response;
      if (url.includes('/revisions/')) return { ok: true, status: 200, json: async () => ({ ok: true, value: { proposalRef: 'proposal-1', revision: 2, hash: 'a'.repeat(64), previousHash: null, title: 't', createdAt: '2026-07-18T10:00:00.000Z', approval: null, sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [] } } }) } as Response;
      if (url === '/api/control/review-completion-gates/gate-1/resolve') return { ok: true, status: 200, json: async () => ({ ok: true, value: { request: { ...gate, state: 'resolved' } } }) } as Response;
      if (url.includes('/api/control/runs/run-1')) return { ok: true, status: 200, json: async () => ({ ok: true, value: {
        ...detailFor('run-1').value, humanRequests: [gate], reviewLoops: [],
        reviewReceipts: [{ reviewReceiptRef: 'receipt-1', runRef: 'run-1', reviewStageRef: 'stage-1', subjectStageRef: 'subject-1', state: 'awaiting-completion-gate', completionRequestRef: 'gate-1', interventionRequestRef: null, version: 2 }],
      } }) } as Response;
      return { ok: true, status: 200, json: async () => ({ runs }) } as Response;
    }));
    render(<ManagedRuns sessionToken="token-1" runs={runs} focusRunRef="run-1" onOpenRun={vi.fn()} />);
    await screen.findByTestId('entity-detail-run');
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
    await waitFor(() => expect(calls).toContain('/api/control/review-completion-gates/gate-1/resolve'));
    expect(calls).not.toContain('/api/control/human-requests/gate-1/respond');
  });

  it('lands on the grid and shows every run title in full', () => {
    stubFetch();
    render(<Harness />);

    expect(screen.getByTestId('run-grid')).toBeTruthy();
    expect(screen.getByTestId('run-card-run-1-title').textContent).toBe(LONG_TITLE);
    expect(screen.getByTestId('run-card-run-2-title').textContent).toBe('A second run');
    // The landing state is the list — no run detail is auto-opened.
    expect(screen.queryByTestId('entity-detail-run')).toBeNull();
  });

  it('opens a run detail on click and BACK RETURNS TO THE LIST', async () => {
    stubFetch();
    render(<Harness />);

    fireEvent.click(screen.getByTestId('run-card-run-1'));

    const detail = await screen.findByTestId('entity-detail-run');
    expect(detail).toBeTruthy();
    expect(screen.getByTestId('entity-detail-title').textContent).toBe(LONG_TITLE);
    // Opening a run REPLACES the grid rather than appending a panel below it.
    expect(screen.queryByTestId('run-grid')).toBeNull();

    fireEvent.click(screen.getByTestId('entity-detail-back'));

    await waitFor(() => expect(screen.getByTestId('run-grid')).toBeTruthy());
    expect(screen.queryByTestId('entity-detail-run')).toBeNull();
    // Both runs are listed again, so back restored the list rather than a filtered remnant.
    expect(screen.getByTestId('run-card-run-1')).toBeTruthy();
    expect(screen.getByTestId('run-card-run-2')).toBeTruthy();
  });

  it('records the active section into the nav stack rather than component-local state', async () => {
    // The tab lives on the stack entry, which is what lets a deeper push and pop return the operator
    // to the tab they left (proven directly over the stack helpers in src/nav/stack.test.ts). Here the
    // point is that the SELECTION IS DRIVEN BY THE STACK: the harness feeds `activeSectionId` back in,
    // so if the write path were broken the tab would snap back to Overview.
    stubFetch();
    render(<Harness />);

    fireEvent.click(screen.getByTestId('run-card-run-1'));
    await screen.findByTestId('entity-detail-run');

    fireEvent.click(screen.getByTestId('entity-tab-changes'));
    await waitFor(() =>
      expect(screen.getByTestId('entity-tab-changes').getAttribute('aria-selected')).toBe('true'),
    );
    expect(screen.getByTestId('entity-tab-overview').getAttribute('aria-selected')).toBe('false');

    // Re-entering a run after back is a FRESH push, so it correctly lands on the default tab again.
    fireEvent.click(screen.getByTestId('entity-detail-back'));
    await waitFor(() => expect(screen.getByTestId('run-grid')).toBeTruthy());

    fireEvent.click(screen.getByTestId('run-card-run-1'));
    await screen.findByTestId('entity-detail-run');
    expect(screen.getByTestId('entity-tab-overview').getAttribute('aria-selected')).toBe('true');
  });

  it('marks the open run in the grid after returning to it', async () => {
    stubFetch();
    render(<Harness />);

    fireEvent.click(screen.getByTestId('run-card-run-2'));
    await screen.findByTestId('entity-detail-run');
    expect(screen.getByTestId('entity-detail-title').textContent).toBe('A second run');

    fireEvent.click(screen.getByTestId('entity-detail-back'));
    await waitFor(() => expect(screen.getByTestId('run-grid')).toBeTruthy());
  });

  it('offers an unlock affordance instead of an empty grid when locked', () => {
    stubFetch();
    render(<ManagedRuns onRequestSession={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Unlock cockpit' })).toBeTruthy();
  });
});

/* ============================================================================
 * THE INVARIANT
 *
 *   No governed action button may EVER be rendered against a run other than the one the nav stack is
 *   focused on.
 *
 * The bug this locks down: `detail` was never cleared when the focused run changed, and `loadRun` only
 * assigned it on success. So following a link to a run that no longer exists (retention prunes runs, and
 * the "Retried from run" link on a successor reaches a pruned predecessor) set an error banner and left
 * the PREVIOUS run's detail mounted — its title, its stages, and live `Stop run` / `Retry as successor`
 * buttons closing over the OLD `runRef`. The nav stack believed it was on run-ghost, the screen showed
 * run-1, and a Retry click would have launched a successor of the wrong run.
 * ========================================================================= */

/** Every governed mutation `RunCockpit` puts in its header. None may exist without a focused run. */
const GOVERNED_ACTIONS = ['Stop run', 'Retry as successor'];

function expectNoGovernedActions(): void {
  for (const name of GOVERNED_ACTIONS) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
}

/** The non-ghost half of the fetch surface, shared by the stubs below. */
function okJsonFor(url: string): unknown {
  if (url.includes('/events')) return { ok: true, value: [] };
  if (url.includes('/revisions/')) {
    return { ok: true, value: { proposalRef: 'proposal-1', revision: 2, hash: 'a'.repeat(64), previousHash: null, title: 't', createdAt: '2026-07-18T10:00:00.000Z', approval: null, sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [] } } };
  }
  if (url.includes('/api/control/runs/')) return detailFor(url.split('/api/control/runs/')[1].split('?')[0]);
  return { runs };
}

/** Starts focused on run-1 and offers a link to a run that no longer exists — the reviewer's scenario. */
function DeadLinkHarness(): React.JSX.Element {
  const [stack, setStack] = useState<NavEntry[]>(() =>
    pushStack(rootStack('pipeline'), { view: 'pipeline', focus: { kind: 'run', id: 'run-1' } }));
  const entry = stack[stack.length - 1];
  return (
    <>
      <button
        type="button"
        data-testid="follow-dead-link"
        onClick={() => setStack((s) => pushStack(s, { view: 'pipeline', focus: { kind: 'run', id: 'run-ghost' } }))}
      >
        follow dead link
      </button>
      <ManagedRuns
        sessionToken="token-1"
        runs={runs}
        focusRunRef={entry.focus?.kind === 'run' ? entry.focus.id : null}
        onOpenRun={(runRef) => setStack((s) => pushStack(s, { view: 'pipeline', focus: { kind: 'run', id: runRef } }))}
        onBackToRuns={() => setStack((s) => backStack(s))}
        now={Date.parse('2026-07-18T12:00:00.000Z')}
      />
    </>
  );
}

describe('ManagedRuns — a focused run that does not exist', () => {
  /** Like `stubFetch`, but `run-ghost` 404s the way a pruned run really does. */
  function stubFetchWithGhost(): void {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('run-ghost')) {
        return { ok: false, status: 404, json: async () => ({ ok: false, reason: 'run was not found' }) } as Response;
      }
      return { ok: true, status: 200, json: async () => okJsonFor(url) } as Response;
    }));
  }

  it('NEVER renders another run’s detail or governed actions when the focused run 404s', async () => {
    stubFetchWithGhost();
    render(<DeadLinkHarness />);

    // Establish the precondition the bug needed: run-1 IS loaded, with a governed action live.
    await screen.findByTestId('entity-detail-run');
    expect(screen.getByTestId('entity-detail-title').textContent).toBe(LONG_TITLE);
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('follow-dead-link'));

    // THE INVARIANT: the stack is on run-ghost, so nothing belonging to run-1 may survive.
    await waitFor(() => expect(screen.getByTestId('run-not-found')).toBeTruthy());
    expect(screen.queryByTestId('entity-detail-run')).toBeNull();
    expect(screen.queryByText(LONG_TITLE)).toBeNull();
    expectNoGovernedActions();
  });

  it('names the missing run rather than showing a blank panel or the grid', async () => {
    stubFetchWithGhost();
    render(<DeadLinkHarness />);
    await screen.findByTestId('entity-detail-run');
    fireEvent.click(screen.getByTestId('follow-dead-link'));

    await waitFor(() => expect(screen.getByTestId('run-not-found')).toBeTruthy());
    // The operator is told WHICH run is gone...
    expect(screen.getByTestId('run-not-found-ref').textContent).toBe('run-ghost');
    // ...is not silently dumped back on the grid, which would hide that the link was dead...
    expect(screen.queryByTestId('run-grid')).toBeNull();
    // ...but does get a way out.
    expect(screen.getByTestId('run-not-found-back')).toBeTruthy();
  });

  it('drops the previous detail the instant focus moves, before the next load resolves', async () => {
    // The 404 path is not the only way to strand the operator: ANY in-flight load leaves a window in
    // which a stale detail could still be mounted under the new run's nav entry. It must not be.
    const neverResolves = new Promise<never>(() => { /* deliberately pending forever */ });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('run-ghost')) return neverResolves;
      return { ok: true, status: 200, json: async () => okJsonFor(url) } as Response;
    }));

    render(<DeadLinkHarness />);
    await screen.findByTestId('entity-detail-run');
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('follow-dead-link'));

    await waitFor(() => expect(screen.queryByTestId('entity-detail-run')).toBeNull());
    expectNoGovernedActions();
  });
});
