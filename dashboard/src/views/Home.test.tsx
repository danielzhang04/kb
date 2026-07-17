// @vitest-environment jsdom
/**
 * U3 — Home, the default landing rollup. Covers the definition-of-done: KPI tiles render from an index
 * snapshot; the running/resume hero lists working cards + pending approvals; NO dollar figure appears
 * anywhere (usage, not spend); `onNavigate` fires on row/tile activation; and the governed
 * LaunchControls surface is present + enabled only when a `sessionToken` is supplied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Home } from './Home';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { ParsedCard } from '../../server/planeA/cards';

function card(id: string, owner: string | null, state: string, tier = 'T1'): ParsedCard {
  return {
    meta: { id, project: 'kb', action: 'demo', target: 'docs/x.md', 'risk-tier': tier, owner, state },
    body: '',
  };
}

const SNAPSHOT: PlaneAIndex = {
  cards: {
    inbox: [card('id-inbox', null, 'inbox')],
    blocked: [card('id-blocked', 'codex-a', 'blocked', 'T2')],
    working: [card('id-work-1', 'claude-m1', 'working', 'T2'), card('id-work-2', 'codex-a', 'working', 'T1')],
    approvals: [card('id-appr-1', 'claude-m1', 'approvals', 'T3')],
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
  // Home self-fetches /api/index when no snapshot is passed; a never-resolving stub keeps any such
  // path on the empty-safe scaffold without real network. Snapshot-driven tests never hit it.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Home view — KPI tiles', () => {
  it('renders KPI tiles from an index snapshot', () => {
    render(<Home snapshot={SNAPSHOT} />);

    // Two distinct card owners across all buckets → 2 agents.
    expect(screen.getByTestId('kpi-agents').textContent).toContain('2');
    // Two cards in `working` → running 2.
    expect(screen.getByTestId('kpi-running').textContent).toContain('2');
    // One card in `approvals` → waiting 1.
    expect(screen.getByTestId('kpi-approvals').textContent).toContain('1');
    // One blocked, one queued (inbox), three ledger steps.
    expect(screen.getByTestId('kpi-blocked').textContent).toContain('1');
    expect(screen.getByTestId('kpi-queued').textContent).toContain('1');
    expect(screen.getByTestId('kpi-steps').textContent).toContain('3');
  });
});

describe('Home view — running / resume hero', () => {
  it('lists working cards and the pending-approval in the resume panel', () => {
    render(<Home snapshot={SNAPSHOT} />);
    const resume = screen.getByTestId('home-resume');

    expect(resume.textContent).toContain('id-work-1');
    expect(resume.textContent).toContain('id-work-2');
    // The approval waiting on a signature is surfaced here too.
    expect(resume.textContent).toContain('id-appr-1');
    // Project STATE one-liner is reconstructed for resume.
    expect(resume.textContent).toContain('demo');
    expect(resume.textContent).toContain('Building the Plane-A indexer.');
  });

  it('shows calm empty states when nothing is running or pending', () => {
    render(<Home snapshot={{ ...SNAPSHOT, cards: {} }} />);
    const resume = screen.getByTestId('home-resume');
    expect(resume.textContent).toMatch(/Nothing running/i);
    expect(resume.textContent).toMatch(/No approvals pending/i);
  });
});

describe('Home view — usage, never spend', () => {
  it('surfaces model mix but never renders a dollar figure anywhere', () => {
    const { container } = render(<Home snapshot={SNAPSHOT} />);

    const usage = screen.getByTestId('home-usage');
    expect(usage.textContent).toContain('claude-sonnet-5');
    expect(usage.textContent).toContain('claude-opus-4');

    // Spend is suppressed across the WHOLE view — no `$` and no "spend" wording, despite usdPresent.
    expect(container.textContent).not.toContain('$');
    expect(container.textContent?.toLowerCase()).not.toContain('spend');
  });
});

describe('Home view — navigation', () => {
  it('fires onNavigate with the entity id when a running row is activated', () => {
    const onNavigate = vi.fn();
    render(<Home snapshot={SNAPSHOT} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /Open id-work-1 in tasks/i }));
    expect(onNavigate).toHaveBeenCalledWith('tasks');
  });

  it('fires onNavigate to approvals from the Waiting KPI tile', () => {
    const onNavigate = vi.fn();
    render(<Home snapshot={SNAPSHOT} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId('kpi-approvals'));
    expect(onNavigate).toHaveBeenCalledWith('approvals');
  });
});

describe('Home view — launch surface', () => {
  it('renders the LaunchControls surface, disabled until a sessionToken is provided', () => {
    render(<Home snapshot={SNAPSHOT} />);

    expect(screen.getByTestId('home-launch')).toBeTruthy();
    // Fail-closed pre-session: the Launch button is present but disabled.
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('Launch card')).toBeTruthy();
  });

  it('enables Launch when a sessionToken is supplied', () => {
    render(<Home snapshot={SNAPSHOT} sessionToken="fake-session-token" />);
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('POSTs a launch request with a bearer token, and never calls fetch on a signed-out submit', () => {
    // Signed out: submitting must NOT fetch — it just surfaces the sign-in nudge.
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    render(<Home snapshot={SNAPSHOT} />);

    fireEvent.submit(screen.getByLabelText('Launch card'));
    expect(screen.getByTestId('launch-status').textContent).toMatch(/sign in with your passkey/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
