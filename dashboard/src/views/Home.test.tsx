// @vitest-environment jsdom
/**
 * Home, the default landing rollup. Covers the definition-of-done: four KPI tiles render from an index
 * snapshot; the running/resume hero lists working cards + pending approvals; NO dollar figure appears
 * anywhere (usage, not spend); a row opens its ENTITY through `onNavigateTarget` and falls back to the
 * destination through `onNavigate`; and the ExecutionUnlock panel (arming PAID execution) stays.
 *
 * The launch-form suite is GONE with the form (spec §5): work is launched from its workflow now, and
 * `LaunchControls` itself is still covered by launchControls.test.tsx + Control.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Home } from './Home';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { CardProjection } from '../../server/planeA/cards';
import type { ExecutionUnlockClient } from '../control/ExecutionUnlock';
import type { ExecutionPostureDto } from '../control/controlClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession, type Session } from '../lib/authClient';

/** Render a locked Home (no stored bearer) — the default for every read-only rollup assertion. */
function render0(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<SessionProvider>{ui}</SessionProvider>);
}

/** The app's ONE unlock, driven from a test: a stored bearer (already unlocked) and an injected ceremony. */
function withSession(ui: React.ReactElement, opts: { stored?: string; signIn?: () => Promise<Session> } = {}): React.ReactElement {
  if (opts.stored) persistSession({ token: opts.stored, expiresAt: Date.now() + 60_000 });
  return <SessionProvider deps={opts.signIn ? { signIn: opts.signIn } : undefined}>{ui}</SessionProvider>;
}

const LOCKED_EXECUTION: ExecutionPostureDto = {
  state: 'locked',
  source: null,
  unlockedAt: null,
  unlockedBy: null,
};

const PASSKEY_EXECUTION: ExecutionPostureDto = {
  state: 'unlocked',
  source: 'passkey',
  unlockedAt: '2026-07-31T12:00:00.000Z',
  unlockedBy: 'operator',
};

function executionClient(posture: ExecutionPostureDto): ExecutionUnlockClient {
  return {
    getPosture: vi.fn(async () => posture),
    unlock: vi.fn(async () => PASSKEY_EXECUTION),
  };
}

/** A card as the server projects it: `displayName` is the card's action (planeA/cards.ts#cardTitle),
 *  which is what the resume rows render — the raw id never appears as text. */
function card(id: string, owner: string | null, state: string, tier = 'T1'): CardProjection {
  const action = `demo:${id}`;
  return {
    meta: { id, project: 'kb', action, target: 'docs/x.md', 'risk-tier': tier, owner, state },
    body: '',
    displayName: action,
    shortRef: 1,
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
  clearStoredSession();
  vi.unstubAllGlobals();
});

describe('Home view — KPI tiles', () => {
  it('renders KPI tiles from an index snapshot', () => {
    render0(<Home snapshot={SNAPSHOT} />);

    // Two distinct card owners across all buckets → 2 agents.
    expect(screen.getByTestId('kpi-agents').textContent).toContain('2');
    // Two cards in `working` → running 2.
    expect(screen.getByTestId('kpi-running').textContent).toContain('2');
    // One card in `approvals` → waiting 1.
    expect(screen.getByTestId('kpi-approvals').textContent).toContain('1');
    expect(screen.getByTestId('kpi-blocked').textContent).toContain('1');
    // FOUR tiles only: `queued` and `steps` are gone — a queued count is not something acted on here,
    // and the step count is the Usage panel's first number.
    expect(screen.queryByTestId('kpi-queued')).toBeNull();
    expect(screen.queryByTestId('kpi-steps')).toBeNull();
  });
});

describe('Home view — running / resume hero', () => {
  it('rejects a non-OK index response and retains the empty-safe scaffold', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    expect(() => render0(<Home />)).not.toThrow();
    await act(async () => {
      resolveFetch(new Response(JSON.stringify(SNAPSHOT), { status: 401 }));
    });

    // Reverting the non-OK guard accepts this otherwise-valid snapshot, changing running from 0 to 2.
    expect(fetchMock).toHaveBeenCalledWith('/api/index');
    expect(screen.getByTestId('kpi-running').textContent).toContain('0');
    expect(screen.getByTestId('home-resume').textContent).toMatch(/Nothing running/i);
  });

  it('rejects a 200 index response whose ledgers cannot satisfy Home dereferences', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    expect(() => render0(<Home />)).not.toThrow();
    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ cards: {}, ledgers: {}, orgStates: [] }), { status: 200 }));
    });

    // Reverting the ledger guard sets this malformed value, then `activity.rows` throws on rerender.
    expect(fetchMock).toHaveBeenCalledWith('/api/index');
    expect(screen.getByTestId('kpi-running').textContent).toContain('0');
    expect(screen.getByTestId('home-resume').textContent).toMatch(/Nothing running/i);
  });

  it('lists working cards and the pending-approval in the resume panel', () => {
    render0(<Home snapshot={SNAPSHOT} />);
    const resume = screen.getByTestId('home-resume');

    // Rows name the card; the raw id is never rendered as text.
    expect(resume.textContent).toContain('demo:id-work-1');
    expect(resume.textContent).toContain('demo:id-work-2');
    // The canonical id is reachable only through EntityName's tooltip, never as row text.
    expect([...resume.querySelectorAll('[data-testid="entity-name"]')].map((n) => n.getAttribute('title')))
      .toContain('id-work-1');
    // The approval waiting on a signature is surfaced here too.
    expect(resume.textContent).toContain('demo:id-appr-1');
    // Project STATE one-liner is reconstructed for resume.
    expect(resume.textContent).toContain('demo');
    expect(resume.textContent).toContain('Building the Plane-A indexer.');
  });

  it('shows calm empty states when nothing is running or pending', () => {
    render0(<Home snapshot={{ ...SNAPSHOT, cards: {} }} />);
    const resume = screen.getByTestId('home-resume');
    expect(resume.textContent).toMatch(/Nothing running/i);
    // Legitimately empty: `cards: {}` means there is genuinely nothing for the operator anywhere.
    expect(resume.textContent).toMatch(/Nothing is waiting on you/i);
  });
});

/**
 * REGRESSION: the `waiting` KPI counted `index.cards.approvals` — card STATE — and so rendered 0 while
 * seven `human-operator` gates (six T3, including the four OAuth gates blocking all external reach)
 * waited in `state: inbox`. `queue/approvals/` held only a `.gitkeep`, so the tile was structurally
 * incapable of being non-zero. The resume hero then printed "No approvals pending — nothing needs you."
 *
 * These snapshots contain NOTHING in `approvals`, so the old state-keyed code renders 0 and the false
 * empty state; every assertion below fails against it.
 */
function gate(id: string, action: string, owner: string | null = 'human-operator', tier = 'T3'): CardProjection {
  return {
    meta: { id, project: 'kb', action, target: '.', 'risk-tier': tier, owner, state: 'inbox' },
    body: '## Work order\n\nClear the gate.\n',
    displayName: action,
    shortRef: 1,
  };
}

function snapshotOf(cards: CardProjection[]): PlaneAIndex {
  const grouped: Record<string, CardProjection[]> = {};
  for (const value of cards) (grouped[String(value.meta.state)] ??= []).push(value);
  return { ...SNAPSHOT, cards: grouped, orgStates: [] };
}

describe('Home view — counts who must act, not card state', () => {
  it('counts human-operator inbox gates in the waiting KPI even with an empty approvals bucket', () => {
    render0(<Home snapshot={snapshotOf([
      gate('6a5d6b23-12ddfee2', 'approve:oauth-gate-g1'),
      gate('6a5d6b23-05204b15', 'approve:oauth-gate-g2'),
      gate('6a5e482a-3b8707b5', 'decide:budget-gate-measures-nothing'),
    ])} />);

    expect(screen.getByTestId('kpi-approvals').textContent).toContain('3');
  });

  it('counts a gate on the owner limb alone', () => {
    // `decide:*` matches no other predicate — only `owner: human-operator` can surface it.
    render0(<Home snapshot={snapshotOf([gate('6a5e482a-3b8707b5', 'decide:budget-gate-measures-nothing')])} />);
    expect(screen.getByTestId('kpi-approvals').textContent).toContain('1');
  });

  it('counts a gate on the approve:* limb alone, with an agent owner', () => {
    render0(<Home snapshot={snapshotOf([gate('6a5d6b23-12ddfee2', 'approve:oauth-gate-g1', 'codex-worker')])} />);
    expect(screen.getByTestId('kpi-approvals').textContent).toContain('1');
  });

  it('lists the gates in the resume hero and never claims nothing is waiting', () => {
    render0(<Home snapshot={snapshotOf([
      gate('6a5d6b23-12ddfee2', 'approve:oauth-gate-g1'),
      gate('6a5e482a-3b8707b5', 'decide:budget-gate-measures-nothing'),
    ])} />);
    const resume = screen.getByTestId('home-resume');

    expect(resume.textContent).not.toContain('6a5d6b23-12ddfee2');
    expect(resume.textContent).toContain('approve:oauth-gate-g1');
    expect(resume.textContent).toContain('decide:budget-gate-measures-nothing');
    // The false empty state must be impossible while anything at all awaits the human.
    expect(resume.textContent).not.toMatch(/Nothing is waiting on you/i);
    expect(resume.textContent).not.toMatch(/nothing needs you/i);
  });
});

describe('Home view — usage, never spend', () => {
  it('surfaces model mix but never renders a dollar figure anywhere', () => {
    const { container } = render0(<Home snapshot={SNAPSHOT} />);

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
    render0(<Home snapshot={SNAPSHOT} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /Open demo:id-work-1/i }));
    expect(onNavigate).toHaveBeenCalledWith('tasks');
  });

  it('opens the exact CARD when a deep-link handler is wired, not just its destination', () => {
    const onNavigate = vi.fn();
    const onNavigateTarget = vi.fn();
    render0(<Home snapshot={SNAPSHOT} onNavigate={onNavigate} onNavigateTarget={onNavigateTarget} />);

    // spec §5 — a waiting-on-you row lands on the card that needs the operator, with its work order.
    fireEvent.click(screen.getByRole('button', { name: /Open demo:id-appr-1/i }));
    expect(onNavigateTarget).toHaveBeenCalledWith({ view: 'tasks', focus: { kind: 'card', id: 'id-appr-1' } });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('renders a row name exactly once — the name column and the detail column are not the same text', () => {
    render0(<Home snapshot={SNAPSHOT} />);
    const row = screen.getByRole('button', { name: /Open demo:id-work-1/i });
    expect(row.textContent?.match(/demo:id-work-1/g)).toHaveLength(1);
    // The second column carries what the card ACTS ON, which is a different fact.
    expect(row.textContent).toContain('docs/x.md');
  });

  it('fires onNavigate to approvals from the Waiting KPI tile', () => {
    const onNavigate = vi.fn();
    render0(<Home snapshot={SNAPSHOT} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId('kpi-approvals'));
    expect(onNavigate).toHaveBeenCalledWith('approvals');
  });
});

describe('Home view — execution status stays', () => {
  it('keeps the execution panel and has no launch form beside it', async () => {
    render(withSession(
      <Home snapshot={SNAPSHOT} executionClient={executionClient(LOCKED_EXECUTION)} />,
      { stored: 'fake-session-token' },
    ));

    // The panel survives the sweep, but as a STATUS readout. Execution arms with the sign-in, so
    // there is no unlock button left here for the operator to press a second time.
    expect(await screen.findByText('Execution armed · passkey')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unlock execution' })).toBeNull();
    // The launch/rerun form does not: work is launched from the workflow that owns it.
    expect(screen.queryByTestId('home-launch')).toBeNull();
    expect(screen.queryByLabelText('Launch card')).toBeNull();
  });
});
