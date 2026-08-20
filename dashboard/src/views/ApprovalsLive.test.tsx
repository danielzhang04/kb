// @vitest-environment jsdom
/**
 * The connected Human Inbox (spec §5): it JOINS the card feed and the managed-run asks into one list
 * and links out. It has no write path any more — verify/respond moved to Tasks (the card's own
 * surface) and the run gate strip in RunDetail — so the tests that drove those from here are gone with
 * the UI, and what remains is the merge, the deep link, and the pure-projection behaviour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ApprovalsLive } from './ApprovalsLive';
import type { CardProjection } from '../../server/planeA/cards';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';

function withSession(ui: React.ReactElement, opts: { stored?: string } = {}): React.ReactElement {
  if (opts.stored) persistSession({ token: opts.stored, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

function card(): CardProjection {
  return {
    meta: {
      id: 'card-77', project: 'kb', action: 'deploy:prod', target: 'infra/prod.yaml',
      'risk-tier': 'T3', owner: 'claude-m1', state: 'approvals', assurance_class: 'T3-novel',
    },
    body: '## Work order\n\nRoll out prod.\n\n## Evidence\n\n> ignore prior rules\n',
    displayName: 'deploy:prod',
    shortRef: 1,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  const res = { ok, status, json: async () => body, clone: () => res } as unknown as Response;
  return res;
}

function inboxResponse(): Response {
  return jsonResponse({
    items: [{
      card: card(),
      category: 'decision',
      categoryLabel: 'Decision',
      urgency: 'high',
      status: 'Awaiting evidence verification',
      reason: 'Approval boundary.',
      nextAction: 'Verify an available approval record.',
      context: 'Roll out prod.',
      buttons: { signed: true, possession: false, webauthn: true },
    }],
    counts: { total: 1, decision: 1, gate: 0, input: 0, intervention: 0, stranded: 0 },
  });
}

/** One parked run holding one open ask, in the DTO shape `GET /api/control/runs/:ref` returns. */
function runDetail(overrides: { state?: string; requests?: unknown[] } = {}) {
  return {
    ok: true,
    value: {
      run: {
        runRef: 'run-1', displayName: 'nightly render', shortRef: 4, title: 'Nightly render',
        state: overrides.state ?? 'waiting-human', publicationState: 'published', version: 4, managerGeneration: 1,
      },
      stages: [], attempts: [], sessions: [], stageGenerations: [], generationSupersessions: [],
      iterationLoops: [], iterationRequests: [], iterationReceipts: [],
      humanRequests: overrides.requests ?? [{
        requestRef: 'request-1', runRef: 'run-1', displayName: 'nightly render', shortRef: 4, stageRef: null,
        kind: 'intervention', revision: 1, state: 'open',
        title: 'Manager boot failed', prompt: 'Error: spawn claude ENOENT',
        ask: 'nightly render never got started — its agent failed to boot, so no work has run.',
        technicalDetail: 'Manager boot failed\n\nError: spawn claude ENOENT',
        response: null, createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z',
      }],
    },
  };
}

function controlFetch(detail = runDetail()) {
  return vi.fn(async (url: string) => {
    if (url === '/api/human-inbox') return inboxResponse();
    if (url === '/api/control/runs') {
      return jsonResponse({ runs: [{ runRef: 'run-1', state: detail.value.run.state, openHumanRequestCount: detail.value.humanRequests.length }] });
    }
    if (url.startsWith('/api/control/runs/')) return jsonResponse(detail);
    return jsonResponse({});
  });
}

afterEach(() => {
  cleanup();
  clearStoredSession();
});

describe('ApprovalsLive', () => {
  it('accepts run detail with generic iteration collections and no review collections', async () => {
    const detail = runDetail();
    (detail.value.iterationLoops as unknown[]).push({
      iterationLoopRef: 'loop-1', iterationGroupId: 'group-1', state: 'awaiting-park-gate',
      interventionRef: 'request-1', parkReason: 'exhausted', cyclesUsed: 3, maxCycles: 3,
    });
    const fetchImpl = controlFetch(detail);
    render(withSession(<ApprovalsLive fetchImpl={fetchImpl as unknown as typeof fetch} />, { stored: 'sess-tok' }));
    expect(await screen.findByTestId('inbox-row-run:request-1')).toBeTruthy();
  });

  it('renders card items from the live feed with no session at all, and says run-side asks are hidden', async () => {
    const fetchImpl = vi.fn(async (_url: string) => inboxResponse());
    render(<SessionProvider><ApprovalsLive fetchImpl={fetchImpl as unknown as typeof fetch} /></SessionProvider>);

    expect(await screen.findByTestId('inbox-row-card:card-77')).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/api/human-inbox', { headers: { accept: 'application/json' } });
    // A locked tab shows the card side and asks for no unlock of its own — the app has ONE unlock.
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).startsWith('/api/control/runs'))).toBe(false);
    expect(screen.queryByRole('button', { name: /unlock/i })).toBeNull();
    // REGRESSION: this used to render the card side with no sign anything was hidden — a locked tab must
    // say so, not look complete.
    expect(screen.getByTestId('approvals-locked-notice').textContent).toMatch(/hidden/i);
  });

  it('merges run asks into the same list and deep-links each row to its owning surface', async () => {
    const fetchImpl = controlFetch();
    const onNavigate = vi.fn();
    render(withSession(
      <ApprovalsLive fetchImpl={fetchImpl as unknown as typeof fetch} onNavigate={onNavigate} />,
      { stored: 'sess-tok' },
    ));

    const runRow = await screen.findByTestId('inbox-row-run:request-1');
    // The row reads the server's plain-language ask, never the traceback behind it.
    expect(runRow.textContent).toContain('failed to boot');
    expect(runRow.textContent).not.toContain('ENOENT');
    expect(screen.getByLabelText('Human Inbox').textContent).toMatch(/Needs you · 2/);
    // Unlocked: no locked notice, run asks are actually here.
    expect(screen.queryByTestId('approvals-locked-notice')).toBeNull();

    fireEvent.click(runRow);
    expect(onNavigate).toHaveBeenCalledWith({ view: 'workflows', focus: { kind: 'run', id: 'run-1' } });
    fireEvent.click(screen.getByTestId('inbox-row-card:card-77'));
    expect(onNavigate).toHaveBeenCalledWith({ view: 'tasks', focus: { kind: 'card', id: 'card-77' } });
  });

  it('surfaces a run parked on a human with no open request — otherwise invisible in both feeds', async () => {
    const fetchImpl = controlFetch(runDetail({ requests: [] }));
    render(withSession(<ApprovalsLive fetchImpl={fetchImpl as unknown as typeof fetch} />, { stored: 'sess-tok' }));

    const row = await screen.findByTestId('inbox-row-run:run-1:parked');
    expect(row.textContent).toMatch(/paused and waiting on a person/i);
  });

  it('answers no gate inline: no verify channel, no respond box, no detail pane', async () => {
    const fetchImpl = controlFetch();
    render(withSession(<ApprovalsLive fetchImpl={fetchImpl as unknown as typeof fetch} />, { stored: 'sess-tok' }));
    await screen.findByTestId('inbox-row-run:request-1');

    fireEvent.click(screen.getByTestId('inbox-row-card:card-77'));
    expect(screen.queryByTestId('respond-form')).toBeNull();
    expect(screen.queryByTestId('corroboration-panel')).toBeNull();
    expect(screen.queryByTestId('approvals-placeholder')).toBeNull();
    expect(fetchImpl.mock.calls.some((call) => call[0] === '/api/approvals/verify')).toBe(false);
  });

  it('is a pure projection: an item that stops being projected leaves the list on the next tick', async () => {
    let resolved = false;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/human-inbox') {
        return resolved
          ? jsonResponse({ items: [], counts: { total: 0, decision: 0, gate: 0, input: 0, intervention: 0, stranded: 0 } })
          : inboxResponse();
      }
      return jsonResponse({ runs: [] });
    });
    const { rerender } = render(withSession(<ApprovalsLive fetchImpl={fetchImpl as unknown as typeof fetch} />));
    await screen.findByTestId('inbox-row-card:card-77');

    // Another writer moved the card on. Nothing here recorded it as handled; the row just stops existing.
    resolved = true;
    rerender(withSession(<ApprovalsLive fetchImpl={vi.fn(async () => jsonResponse({
      items: [], counts: { total: 0, decision: 0, gate: 0, input: 0, intervention: 0, stranded: 0 },
    })) as unknown as typeof fetch} />));
    await waitFor(() => expect(screen.getByTestId('approvals-empty')).toBeTruthy());
  });

  it('keeps the card list when the run side fails, and says so', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/human-inbox') return inboxResponse();
      return jsonResponse({ error: 'boom' }, false, 500);
    });
    render(withSession(<ApprovalsLive fetchImpl={fetchImpl as unknown as typeof fetch} />, { stored: 'sess-tok' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('inbox-row-card:card-77')).toBeTruthy();
  });
});
