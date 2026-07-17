// @vitest-environment jsdom
/**
 * D0.9 — Control-view landing (mission control). Composes the existing read-only views under a
 * fleet strip (agents, running count, USAGE — never spend), org STATEs, and the live timeline entry,
 * and is the default landing view reachable/leavable by one toggle (App-level).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Control, StopControls } from './Control';
import { App } from '../App';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { ParsedCard } from '../../server/planeA/cards';

function card(owner: string | null, state: string): ParsedCard {
  return {
    meta: {
      id: `id-${state}-${owner ?? 'none'}`,
      project: 'kb',
      action: 'demo',
      target: '.',
      'risk-tier': 'T1',
      owner,
      state,
    },
    body: '',
  };
}

const SNAPSHOT: PlaneAIndex = {
  cards: {
    inbox: [card(null, 'inbox')],
    working: [card('claude-m1', 'working'), card('codex-a', 'working')],
    approvals: [card('claude-m1', 'approvals')],
  },
  ledgers: {
    dispatch: { count: 2, cards: 2, byProject: { kb: 2 } },
    cost: {
      stepCount: 3,
      perModelSteps: { 'claude-sonnet-5': 2, 'claude-opus-4': 1 },
      modelMix: { 'claude-sonnet-5': 2 / 3, 'claude-opus-4': 1 / 3 },
      usdPresent: true,
    },
    grades: { count: 0, rows: [] },
    activity: { count: 0, rows: [] },
  },
  orgStates: [
    { project: 'demo', now: 'Building the Plane-A indexer.', next: 'Wire the SSE hub.', blocked: '(nothing blocked)' },
  ],
};

beforeEach(() => {
  // Composed child views (Browser/Registry/Timeline) self-fetch on mount; a never-resolving stub
  // keeps them on their empty-safe scaffolds without real network or post-mount state churn.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Control view', () => {
  it('renders the fleet strip from an index snapshot', () => {
    render(<Control snapshot={SNAPSHOT} />);

    // Two distinct card owners → 2 agents.
    expect(screen.getByTestId('fleet-agents').textContent).toContain('2');
    // Two cards in `working` → running count 2.
    expect(screen.getByTestId('fleet-running').textContent).toContain('2');

    // Usage is labelled USAGE, surfaces the model mix, and NEVER shows a dollar figure (spend suppressed).
    const usage = screen.getByTestId('fleet-usage');
    expect(usage.textContent).toMatch(/USAGE/i);
    expect(usage.textContent).toContain('claude-sonnet-5');
    expect(usage.textContent).not.toContain('$');
    expect(usage.textContent?.toLowerCase()).not.toContain('spend');

    // Org STATE is composed in.
    expect(screen.getByText('demo')).toBeTruthy();
    expect(screen.getByText('Building the Plane-A indexer.')).toBeTruthy();
  });

  it('lands on the Home rollup by default, another view reachable via the sidebar nav', () => {
    // U3: the App shell's default nav item is "Home", which now routes to the Home rollup view (the
    // Control component is dormant/unrouted — still exported and unit-tested directly, above).
    render(<App />);

    // Default landing is the Home view; the Files view is not mounted yet.
    expect(screen.getByLabelText('Home view')).toBeTruthy();
    expect(screen.queryByLabelText('Files view')).toBeNull();

    // The sidebar's Files nav item switches to the Files view.
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByLabelText('Files view')).toBeTruthy();
    expect(screen.queryByLabelText('Home view')).toBeNull();

    // And the Home nav item switches back to the Home rollup.
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByLabelText('Home view')).toBeTruthy();
    expect(screen.queryByLabelText('Files view')).toBeNull();
  });
});

describe('Control view — D2.6 launch/rerun controls', () => {
  it('disables Launch and Rerun submit without a sessionToken, and never calls fetch on submit', () => {
    render(<Control snapshot={SNAPSHOT} />);

    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Rerun' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.submit(screen.getByLabelText('Launch card'));
    expect(screen.getByTestId('launch-status').textContent).toMatch(/sign in with your passkey/i);

    fireEvent.submit(screen.getByLabelText('Rerun card'));
    expect(screen.getByTestId('rerun-status').textContent).toMatch(/sign in with your passkey/i);
  });

  it('POSTs a launch request to /api/write/launch with a bearer session token when provided', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === '/api/write/launch') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ cardId: 'new-card-1' }),
          } as Response);
        }
        return new Promise(() => {});
      }),
    );

    render(<Control snapshot={SNAPSHOT} sessionToken="fake-session-token" />);

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'kb' } });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'docs/x.md' } });
    fireEvent.submit(screen.getByLabelText('Launch card'));

    await waitFor(() => expect(screen.getByTestId('launch-status').textContent).toContain('new-card-1'));

    const launchCall = calls.find((c) => c.url === '/api/write/launch');
    expect(launchCall).toBeTruthy();
    expect((launchCall?.init?.headers as Record<string, string>)?.authorization).toBe(
      'Bearer fake-session-token',
    );
    const body = JSON.parse(launchCall?.init?.body as string);
    expect(body).toMatchObject({ project: 'kb', action: 'demo', target: 'docs/x.md' });
  });

  it('POSTs a rerun request to /api/write/rerun and surfaces a refusal reason from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/write/rerun') {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ reason: 'fleet-frozen' }),
          } as Response);
        }
        return new Promise(() => {});
      }),
    );

    render(<Control snapshot={SNAPSHOT} sessionToken="fake-session-token" />);

    fireEvent.change(screen.getByLabelText('Card id to rerun'), { target: { value: 'orig-1' } });
    fireEvent.change(screen.getByLabelText('Rerun feedback'), { target: { value: 'try smaller batch' } });
    fireEvent.submit(screen.getByLabelText('Rerun card'));

    await waitFor(() => expect(screen.getByTestId('rerun-status').textContent).toMatch(/refused: fleet-frozen/));
  });
});

// U1: StopControls was relocated out of the Board's right column into the shell's pinned
// Session/Stop floor (App.tsx). It is exported from ./Control and exercised directly here.
describe('Stop-floor controls (D2.8, relocated to the shell in U1)', () => {
  it('disables every stop control without a sessionToken, and never calls fetch on submit', () => {
    render(<StopControls />);

    expect((screen.getByRole('button', { name: 'Request stop' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Pause cadence' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'STOP everything' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.submit(screen.getByLabelText('Request card stop'));
    expect(screen.getByTestId('stop-card-status').textContent).toMatch(/sign in with your passkey/i);

    fireEvent.submit(screen.getByLabelText('Pause cadence'));
    expect(screen.getByTestId('pause-cadence-status').textContent).toMatch(/sign in with your passkey/i);
  });

  it('the nuclear STOP button stays disabled until the confirm checkbox is checked, even with a session', () => {
    render(<StopControls sessionToken="fake-session-token" />);

    const nukeButton = screen.getByRole('button', { name: 'STOP everything' }) as HTMLButtonElement;
    expect(nukeButton.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Confirm nuclear STOP'));
    expect(nukeButton.disabled).toBe(false);
  });

  it('POSTs a scoped stop request to /api/write/stop-card with a bearer session token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === '/api/write/stop-card') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'halting' }) } as Response);
        }
        return new Promise(() => {});
      }),
    );

    render(<StopControls sessionToken="fake-session-token" />);
    fireEvent.change(screen.getByLabelText('Card id to stop'), { target: { value: 'card-1' } });
    fireEvent.submit(screen.getByLabelText('Request card stop'));

    await waitFor(() => expect(screen.getByTestId('stop-card-status').textContent).toContain('halting'));

    const call = calls.find((c) => c.url === '/api/write/stop-card');
    expect((call?.init?.headers as Record<string, string>)?.authorization).toBe('Bearer fake-session-token');
    expect(JSON.parse(call?.init?.body as string)).toMatchObject({ cardId: 'card-1' });
  });

  it('POSTs the nuclear STOP request to /api/write/stop only once armed, and surfaces a refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/write/stop') {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({ reason: 'unauthenticated' }) } as Response);
        }
        return new Promise(() => {});
      }),
    );

    render(<StopControls sessionToken="fake-session-token" />);
    fireEvent.click(screen.getByLabelText('Confirm nuclear STOP'));
    fireEvent.submit(screen.getByLabelText('Nuclear STOP'));

    await waitFor(() => expect(screen.getByTestId('nuke-status').textContent).toMatch(/refused: unauthenticated/));
  });
});
