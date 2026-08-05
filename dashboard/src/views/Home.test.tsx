// @vitest-environment jsdom
/**
 * U3 — Home, the default landing rollup. Covers the definition-of-done: KPI tiles render from an index
 * snapshot; the running/resume hero lists working cards + pending approvals; NO dollar figure appears
 * anywhere (usage, not spend); `onNavigate` fires on row/tile activation; and the governed
 * LaunchControls surface is present + enabled only once EXECUTION is unlocked by its own passkey check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { Home } from './Home';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { CardProjection } from '../../server/planeA/cards';
import type { AgentRosterEntry } from '../../server/agents/roster';
import type { ExecutionUnlockClient } from '../control/ExecutionUnlock';
import type { ExecutionPostureDto } from '../control/controlClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession, SESSION_INVALIDATED_EVENT, type Session } from '../lib/authClient';

/** Render a locked Home (no stored bearer) — the default for every read-only rollup assertion. */
function render0(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<SessionProvider>{ui}</SessionProvider>);
}

/** The app's ONE unlock, driven from a test: a stored bearer (already unlocked) and an injected ceremony. */
function withSession(ui: React.ReactElement, opts: { stored?: string; signIn?: () => Promise<Session> } = {}): React.ReactElement {
  if (opts.stored) persistSession({ token: opts.stored, expiresAt: Date.now() + 60_000 });
  return <SessionProvider deps={opts.signIn ? { signIn: opts.signIn } : undefined}>{ui}</SessionProvider>;
}

/** Build a full roster entry with sane defaults, overriding only the fields a test cares about. */
function rosterEntry(over: Partial<AgentRosterEntry> & { id: string }): AgentRosterEntry {
  return {
    displayName: over.id,
    shortRef: 1,
    role: null,
    working: false,
    current: null,
    projects: [],
    cardCount: 0,
    ledger: { dispatches: 0, steps: 0, days: 0, lastActive: null },
    sources: [],
    effective: { runtime: 'claude', model: 'claude-opus-4-8', sourceRuntime: 'policy', sourceModel: 'policy' },
    declared: false,
    runnerBound: false,
    declaredRuntime: null,
    declaredModel: null,
    defaultProfile: null,
    allowedProfiles: null,
    description: null,
    ...over,
  };
}

const ROUTING = {
  policy: {
    version: 1,
    runtimes: {
      claude: { default_worker: 'worker-desktop', aliases: {}, known_models: ['claude-opus-4-8'] },
      codex: { default_worker: 'codex-worker', aliases: {}, known_models: ['gpt-5-codex'] },
    },
    matrix: {},
    role_default: null,
  },
  agents: [],
  cards: {},
  audit: { mismatches: [], overrides: [] },
  overrides: [],
};

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
    // One blocked, one queued (inbox), three ledger steps.
    expect(screen.getByTestId('kpi-blocked').textContent).toContain('1');
    expect(screen.getByTestId('kpi-queued').textContent).toContain('1');
    expect(screen.getByTestId('kpi-steps').textContent).toContain('3');
  });
});

describe('Home view — running / resume hero', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Open demo:id-work-1 in tasks/i }));
    expect(onNavigate).toHaveBeenCalledWith('tasks');
  });

  it('fires onNavigate to approvals from the Waiting KPI tile', () => {
    const onNavigate = vi.fn();
    render0(<Home snapshot={SNAPSHOT} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId('kpi-approvals'));
    expect(onNavigate).toHaveBeenCalledWith('approvals');
  });
});

describe('Home view — launch surface', () => {
  it('renders the LaunchControls surface, disabled until execution is unlocked', () => {
    render0(<Home snapshot={SNAPSHOT} />);

    expect(screen.getByTestId('home-launch')).toBeTruthy();
    // Fail-closed while execution is locked: the Launch button is present but disabled.
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('Launch card')).toBeTruthy();
  });

  it('keeps Launch disabled until execution is explicitly unlocked with a passkey', async () => {
    const client = executionClient(LOCKED_EXECUTION);
    render(withSession(<Home snapshot={SNAPSHOT} executionClient={client} />, {
      stored: 'fake-session-token',
      signIn: async () => ({ token: 'replacement-token', expiresAt: Date.now() + 60_000 }),
    }));

    const launch = screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement;
    const unlock = await screen.findByRole('button', { name: 'Unlock execution' });
    expect(launch.disabled).toBe(true);

    fireEvent.submit(screen.getByLabelText('Launch card'));
    expect(screen.getByTestId('launch-status').textContent).toMatch(/execution is locked/i);
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => url === '/api/write/launch')).toBe(false);

    fireEvent.click(unlock);
    await waitFor(() => expect(launch.disabled).toBe(false));
    expect(client.unlock).toHaveBeenCalledWith('fake-session-token');

    // An unlock belongs to the bearer that completed it. A governed 401 re-locks the tab and the next
    // ceremony mints a DIFFERENT bearer, which must fail closed rather than inherit the ready state.
    fireEvent(window, new Event(SESSION_INVALIDATED_EVENT));
    await waitFor(() => expect(launch.disabled).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Unlock execution' }));
    await waitFor(() => expect(client.getPosture).toHaveBeenCalledWith('replacement-token'));
    expect(launch.disabled).toBe(true);
  });

  it('never releases the launch token for a malformed passkey posture', async () => {
    const malformed = {
      ...PASSKEY_EXECUTION,
      unlockedAt: '1',
    } as ExecutionPostureDto;
    render(withSession(
      <Home snapshot={SNAPSHOT} executionClient={executionClient(malformed)} />,
      { stored: 'fake-session-token' },
    ));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Execution state could not be loaded. Execution remains unavailable.',
    );
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('never POSTs a launch while execution is locked', () => {
    // Execution locked: submitting must NOT reach `/api/write/launch` — it just states why.
    const fetchMock = vi.fn((_url: string) => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    render0(<Home snapshot={SNAPSHOT} />);

    fireEvent.submit(screen.getByLabelText('Launch card'));
    expect(screen.getByTestId('launch-status').textContent).toMatch(/execution is locked/i);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/write/launch')).toBe(false);
  });

  // C7.8 — the host wires the LIVE roster into the owner picker: it fetches /api/agents + /api/routing,
  // maps them to the assignable set (declared agents ∪ registered default_workers), and passes them in.
  // Selecting an owner threads it into the governed launch POST body.
  it('populates the owner picker from the live roster and threads a chosen owner into the launch POST', async () => {
    const roster: AgentRosterEntry[] = [
      // Declared + runner-bound → a plain assignable option.
      rosterEntry({ id: 'claude-m1', declared: true, runnerBound: true }),
      // Declared but no runner yet → still assignable, shown with the "(no runner)" warning affordance.
      rosterEntry({ id: 'atlas-writer', declared: true, runnerBound: false }),
      // Owns cards but NOT declared and not a default_worker → NOT assignable (excluded).
      rosterEntry({ id: 'codex-a', declared: false, runnerBound: false }),
    ];
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === '/api/agents') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(roster) } as Response);
        }
        if (url === '/api/routing') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(ROUTING) } as Response);
        }
        if (url === '/api/write/launch') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ cardId: 'c-owned' }) } as Response);
        }
        return new Promise(() => {});
      }),
    );

    render(withSession(
      <Home snapshot={SNAPSHOT} executionClient={executionClient(PASSKEY_EXECUTION)} />,
      { stored: 'fake-session-token' },
    ));

    const ownerSelect = screen.getByLabelText('Owner') as HTMLSelectElement;
    // The live roster populates the closed set: declared agents ∪ registered default_workers.
    await waitFor(() => expect(within(ownerSelect).getByRole('option', { name: 'claude-m1' })).toBeTruthy());
    expect(within(ownerSelect).getByRole('option', { name: 'atlas-writer (no runner)' })).toBeTruthy();
    // Registered default_workers surface even without a declaration…
    expect(within(ownerSelect).getByRole('option', { name: 'worker-desktop' })).toBeTruthy();
    expect(within(ownerSelect).getByRole('option', { name: 'codex-worker' })).toBeTruthy();
    // …but a non-declared, non-default_worker card owner does NOT.
    expect(within(ownerSelect).queryByRole('option', { name: 'codex-a' })).toBeNull();

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'kb' } });
    fireEvent.change(ownerSelect, { target: { value: 'claude-m1' } });
    fireEvent.submit(screen.getByLabelText('Launch card'));

    await waitFor(() => expect(screen.getByTestId('launch-status').textContent).toContain('c-owned'));
    const launchCall = calls.find((c) => c.url === '/api/write/launch');
    expect(JSON.parse(launchCall?.init?.body as string)).toMatchObject({ project: 'kb', owner: 'claude-m1' });
  });
});
