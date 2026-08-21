// @vitest-environment jsdom
/**
 * D3.5 — Sentinel (health) panel view. Renders agent liveness + per-org heartbeats from the health
 * projection, encoding status with the semantic status-dot vocabulary (no decorative accent).
 *
 * spec §6 — this view is ALSO the new home of the emergency-stop controls (`StopControls`, relocated
 * out of the sidebar floor). The panel is otherwise read-only, so the tests below pin both that the
 * controls are present here and that they still POST to /api/stop's routes with a bearer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { Sentinel } from './Sentinel';
import { clearStoredSession, persistSession } from '../../lib/authClient';
import type { HealthPanel } from '../../../server/panels/health';
import { renderWithTestSession } from '../../test/session';

afterEach(() => {
  cleanup();
  clearStoredSession();
  vi.unstubAllGlobals();
});

/** The panel now hosts a session-gated control, so every render needs the app's session boundary. */
async function renderSentinel(panel: HealthPanel, stored?: string) {
  if (stored) persistSession({ token: stored, expiresAt: Date.now() + 60_000 });
  return renderWithTestSession(<Sentinel panel={panel} />);
}

const PANEL: HealthPanel = {
  asOf: '2026-07-17',
  stalenessDays: 2,
  agents: [
    { id: 'worker-desktop', role: 'worker', status: 'active', live: true, working: false, lastActive: '2026-07-17' },
    { id: 'dispatcher-cloud', role: 'dispatcher', status: 'stale', live: false, working: false, lastActive: '2026-07-01' },
  ],
  orgs: [
    { project: 'demo', now: '- building', blocked: true, cadences: [{ project: 'demo', name: 'org-nightly', schedule: 'daily', tier: 'desktop', riskTier: null }] },
  ],
  systemCadences: [{ project: 'system', name: 'nightly-review', schedule: 'daily', tier: 'cloud', riskTier: 'T1' }],
  cadenceCount: 2,
  liveCount: 1,
};

describe('Sentinel panel', () => {
  it('renders agent liveness with a semantic status dot per agent', async () => {
    await renderSentinel(PANEL);
    expect(screen.getByLabelText('Sentinel panel')).toBeTruthy();

    const active = screen.getByTestId('sentinel-agent-worker-desktop');
    expect(within(active).getByText('active')).toBeTruthy();
    expect(active.querySelector('.mc-status-dot--done')).toBeTruthy();

    const stale = screen.getByTestId('sentinel-agent-dispatcher-cloud');
    expect(stale.querySelector('.mc-status-dot--blocked')).toBeTruthy();
  });

  it('surfaces per-org heartbeats and the blocked flag from STATE', async () => {
    await renderSentinel(PANEL);
    const org = screen.getByTestId('sentinel-org-demo');
    expect(within(org).getByText('org-nightly')).toBeTruthy();
    expect(within(org).getByText('blocked')).toBeTruthy();
  });

  it('is empty-safe with no data', async () => {
    await renderSentinel({ ...PANEL, agents: [], orgs: [], liveCount: 0 });
    expect(screen.getByText(/no agents observed/i)).toBeTruthy();
  });
});

/**
 * spec §6 — the emergency stop lives HERE now, not in a sidebar floor. These prove the relocation:
 * the section is on this view, it is set apart from the read-only readout, each control explains
 * itself in plain language, and the governed POSTs still work unchanged from their new home.
 */
describe('Sentinel panel — the relocated emergency stop', () => {
  it('carries a clearly-marked, visually separated Emergency stop section with plain-language context', async () => {
    await renderSentinel(PANEL);

    const stop = screen.getByLabelText('Emergency stop');
    expect(within(stop).getByRole('heading', { name: 'Emergency stop' })).toBeTruthy();
    // Set apart: the section sits inside the panel's own separated stop band, not inline with the tables.
    expect(stop.closest('.v-panel__stop')).toBeTruthy();

    // One sentence of plain-language context per control — no control-plane jargon.
    expect(within(stop).getByText(/Ask one running task to wind down/i)).toBeTruthy();
    expect(within(stop).getByText(/Skip the next beat of one scheduled cadence/i)).toBeTruthy();
    expect(within(stop).getByText(/Freeze the whole fleet\. Every agent stops picking up work/i)).toBeTruthy();

    // All three controls, narrowest first.
    expect(within(stop).getByLabelText('Request card stop')).toBeTruthy();
    expect(within(stop).getByLabelText('Pause cadence')).toBeTruthy();
    expect(within(stop).getByLabelText('Nuclear STOP')).toBeTruthy();
  });

  it('still POSTs the scoped stop to /api/write/stop-card with a bearer, from its new home', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/write/stop-card') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'halting' }) } as Response);
      }
      return new Promise(() => {});
    }));

    await renderSentinel(PANEL, 'sentinel-session-token');
    fireEvent.change(screen.getByLabelText('Card id to stop'), { target: { value: 'card-3' } });
    fireEvent.submit(screen.getByLabelText('Request card stop'));

    await waitFor(() => expect(screen.getByTestId('stop-card-status').textContent).toContain('halting'));
    const call = calls.find((c) => c.url === '/api/write/stop-card');
    expect((call?.init?.headers as Record<string, string>)?.authorization).toBe('Bearer sentinel-session-token');
  });

  it('keeps the nuclear STOP armed-only: disabled until the confirm box is checked', async () => {
    await renderSentinel(PANEL, 'sentinel-session-token');
    const nuke = screen.getByRole('button', { name: 'STOP everything' }) as HTMLButtonElement;
    expect(nuke.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Confirm nuclear STOP'));
    expect(nuke.disabled).toBe(false);
  });
});
