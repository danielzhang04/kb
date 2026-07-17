// @vitest-environment jsdom
/**
 * D3.5 — Sentinel (health) panel view. Renders agent liveness + per-org heartbeats from the health
 * projection, encoding status with the semantic status-dot vocabulary (no decorative accent).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { Sentinel } from './Sentinel';
import type { HealthPanel } from '../../../server/panels/health';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
  it('renders agent liveness with a semantic status dot per agent', () => {
    render(<Sentinel panel={PANEL} />);
    expect(screen.getByLabelText('Sentinel panel')).toBeTruthy();

    const active = screen.getByTestId('sentinel-agent-worker-desktop');
    expect(within(active).getByText('active')).toBeTruthy();
    expect(active.querySelector('.mc-status-dot--done')).toBeTruthy();

    const stale = screen.getByTestId('sentinel-agent-dispatcher-cloud');
    expect(stale.querySelector('.mc-status-dot--blocked')).toBeTruthy();
  });

  it('surfaces per-org heartbeats and the blocked flag from STATE', () => {
    render(<Sentinel panel={PANEL} />);
    const org = screen.getByTestId('sentinel-org-demo');
    expect(within(org).getByText('org-nightly')).toBeTruthy();
    expect(within(org).getByText('blocked')).toBeTruthy();
  });

  it('is empty-safe with no data', () => {
    render(<Sentinel panel={{ ...PANEL, agents: [], orgs: [], liveCount: 0 }} />);
    expect(screen.getByText(/no agents observed/i)).toBeTruthy();
  });
});
