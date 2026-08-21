// @vitest-environment jsdom
/**
 * Agents view (U3). The roster is DERIVED from the Plane-A snapshot's card ownership — there is no
 * agent-registry endpoint. These tests pin the honest projection: distinct owners become rows, a
 * working-state card marks its owner working and drives the "doing" cell, the model cell is a
 * disabled Phase-R placeholder, and thin data degrades to a calm empty state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { Agents, deriveRoster } from './Agents';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';
/** The app's ONE unlock, driven from a test: a stored fresh bearer read by the provider on mount. */
function unlocked(ui: React.ReactElement, token = 'tok'): React.ReactElement {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { CardProjection } from '../../server/planeA/cards';
import type { AgentRosterEntry } from '../../server/agents/roster';

/** Build a full roster entry with sane defaults, overriding only the fields a test cares about. */
function entry(over: Partial<AgentRosterEntry> & { id: string }): AgentRosterEntry {
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

function card(owner: string | null, state: string, extra: Partial<CardProjection['meta']> = {}): CardProjection {
  return {
    meta: {
      id: `id-${state}-${owner ?? 'none'}`,
      project: 'kb',
      action: 'demo',
      target: '.',
      'risk-tier': 'T1',
      owner,
      state,
      ...extra,
    },
    body: '',
    displayName: String(extra.action ?? 'demo'),
    shortRef: 1,
  };
}

const EMPTY_LEDGERS: PlaneAIndex['ledgers'] = {
  dispatch: { count: 0, cards: 0, byProject: {} },
  cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
  grades: { count: 0, rows: [] },
  activity: { count: 0, rows: [] },
};

const SNAPSHOT: PlaneAIndex = {
  cards: {
    inbox: [card(null, 'inbox')],
    working: [
      card('claude-m1', 'working', { id: 'card-77', action: 'ship-dashboard', project: 'kb' }),
    ],
    done: [card('claude-m1', 'done'), card('codex-a', 'done', { project: ['kb', 'atlas'] })],
  },
  ledgers: EMPTY_LEDGERS,
  orgStates: [],
};

// The primary roster is declaration-only; historical card/ledger owners are deliberately absent.
const PRIMARY_ROSTER: AgentRosterEntry[] = [
  entry({ id: 'claude-m1', declared: true, working: true, current: { action: 'ship-dashboard', id: 'card-77', displayName: 'ship-dashboard', shortRef: 7 }, cardCount: 2, projects: ['kb'] }),
  entry({ id: 'codex-a', declared: true, cardCount: 1, projects: ['atlas', 'kb'], runnerBound: true, declaredRuntime: 'codex' }),
];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  clearStoredSession();
  cleanup();
  vi.unstubAllGlobals();
});

describe('deriveRoster', () => {
  it('derives one row per distinct non-null owner, working agents first', () => {
    const roster = deriveRoster(SNAPSHOT);
    expect(roster.map((r) => r.id)).toEqual(['claude-m1', 'codex-a']);
    // claude-m1 owns the working card → working + a current card; codex-a only owns a done card → idle.
    expect(roster[0]).toMatchObject({ id: 'claude-m1', working: true, cardCount: 2 });
    expect(roster[0].current).toEqual({ action: 'ship-dashboard', id: 'card-77', displayName: 'ship-dashboard', shortRef: 1 });
    expect(roster[1]).toMatchObject({ id: 'codex-a', working: false, current: null });
    // Projects are collected + de-duped across the agent's owned cards (string | string[]).
    expect(roster[1].projects).toEqual(['atlas', 'kb']);
  });

  it('ignores cards with a null owner (unclaimed inbox work is not an agent)', () => {
    expect(deriveRoster({ cards: { inbox: [card(null, 'inbox')] }, ledgers: EMPTY_LEDGERS, orgStates: [] })).toEqual([]);
  });
});

describe('Agents view', () => {
  it('renders the roster from a snapshot: working agent shows its current card + working dot', () => {
    render(<SessionProvider><Agents snapshot={SNAPSHOT} roster={PRIMARY_ROSTER} /></SessionProvider>);

    expect(screen.getByLabelText('Agents view')).toBeTruthy();
    const row = screen.getByTestId('agent-row-claude-m1');
    expect(within(row).getByText('Claude M1')).toBeTruthy();
    expect(within(row).getAllByTestId('entity-name').map((node) => node.getAttribute('title')))
      .toContain('claude-m1');
    // The current card is NAMED (its action) and its raw id sits behind EntityName's tooltip.
    expect(within(row).getAllByText('ship-dashboard').length).toBeGreaterThan(0);
    expect(within(row).queryByText('card-77')).toBeNull();
    expect([...row.querySelectorAll('[data-testid="entity-name"]')].map((n) => n.getAttribute('title')))
      .toContain('card-77');
    // The status dot carries the running (working) modifier for a working agent.
    expect(row.querySelector('.mc-status-dot--running')).toBeTruthy();

    // Idle agent: no current-card action, an idle status dot.
    const idle = screen.getByTestId('agent-row-codex-a');
    expect(idle.querySelector('.mc-status-dot--idle')).toBeTruthy();
  });

  const ROUTING = {
    policy: {
      version: 1,
      runtimes: {
        claude: { default_worker: 'worker-desktop', aliases: {}, known_models: ['claude-opus-4-8', 'claude-sonnet-5'] },
        codex: { default_worker: 'codex-worker', aliases: {}, known_models: ['gpt-5-codex'] },
      },
      matrix: {},
      role_default: null,
    },
    agents: [
      { id: 'claude-m1', effective: { runtime: 'claude', model: 'claude-opus-4-8', sourceRuntime: 'policy', sourceModel: 'policy' } },
      { id: 'codex-a', effective: { runtime: 'codex', model: 'gpt-5-codex', sourceRuntime: 'override', sourceModel: 'override' } },
    ],
    cards: {},
    audit: { mismatches: [], overrides: [] },
    overrides: [],
  } as const;

  it('renders a live effective-model chip per agent with its provenance tag (R2.2)', () => {
    render(unlocked(<Agents snapshot={SNAPSHOT} roster={PRIMARY_ROSTER} routing={ROUTING as never} />));
    const row = screen.getByTestId('agent-row-claude-m1');
    expect(within(row).getByText('claude-opus-4-8')).toBeTruthy();
    expect(within(row).getByText('policy')).toBeTruthy();
    // With a session, the chip is an enabled control (not the old inert placeholder).
    const chip = screen.getByTestId('agent-claude-m1-routing-chip');
    expect((chip as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a Clear-override affordance only when the agent has an override, after opening the popover', () => {
    render(unlocked(<Agents snapshot={SNAPSHOT} roster={PRIMARY_ROSTER} routing={ROUTING as never} />));
    fireEvent.click(screen.getByTestId('agent-codex-a-routing-chip'));
    expect(screen.getByTestId('agent-codex-a-routing-clear')).toBeTruthy();
    // The policy-sourced agent has no clear affordance.
    fireEvent.click(screen.getByTestId('agent-claude-m1-routing-chip'));
    expect(screen.queryByTestId('agent-claude-m1-routing-clear')).toBeNull();
  });

  describe('C7.4 — declared / runner-bound status', () => {
    // A declared agent id that owns no cards and wrote no ledgers, honestly flagged runner-bound:false.
    const DECLARED_ROSTER: AgentRosterEntry[] = [
      entry({
        id: 'composer-scribe',
        role: 'writer',
        declared: true,
        runnerBound: false,
        declaredRuntime: 'claude',
        declaredModel: 'claude-sonnet-5',
        description: 'Drafts long-form copy',
      }),
      // A declared agent a human has bound to a runner → runnable.
      entry({ id: 'codex-a', role: 'worker', declared: true, runnerBound: true, declaredRuntime: 'codex' }),
      // Not declared, but its id is a registry default_worker → also runnable.
      entry({ id: 'worker-desktop', role: 'worker', declared: false, runnerBound: false, sources: ['ledger'] }),
    ];

    it('surfaces an agent with a definition even when it owns nothing and wrote no ledger', () => {
      render(unlocked(<Agents roster={DECLARED_ROSTER} routing={ROUTING as never} />));
      const row = screen.getByTestId('agent-row-composer-scribe');
      expect(within(row).getByText('Composer Scribe')).toBeTruthy();
      expect(within(row).getByTestId('entity-name').getAttribute('title')).toBe('composer-scribe');
      expect(within(row).getByText('writer')).toBeTruthy(); // its role
      expect(within(row).getAllByText('idle').length).toBeGreaterThan(0);
    });

    /**
     * The roster is for FINDING an agent, not auditing its metadata: `declared`, `runner-bound` and the
     * runtime-default chip are terms of art and belong on the agent's own detail, behind its one fold.
     */
    it('keeps declaration and runner jargon off the roster entirely', () => {
      render(unlocked(<Agents roster={DECLARED_ROSTER} routing={ROUTING as never} />));
      const roster = screen.getByRole('region', { name: /Your agents/ });
      expect(roster.textContent).not.toMatch(/runner-bound|no runner|declared|observed/i);
      expect(screen.queryByTestId('agent-binding-codex-a')).toBeNull();
      // System workers keep their own registry facts, in their own disclosure.
      const dw = screen.getByTestId('system-worker-worker-desktop');
      expect(dw.textContent).toContain('runtime default');
      expect(dw.textContent).toContain('queue-addressable');
    });

    it('shows last activity as an age and offers a one-click Run agent per row', () => {
      const onRunAgent = vi.fn();
      render(
        unlocked(
          <Agents
            roster={[entry({ id: 'composer-scribe', declared: true, ledger: { dispatches: 0, steps: 0, days: 1, lastActive: '2026-07-18' } })]}
            routing={ROUTING as never}
            onRunAgent={onRunAgent}
            now={Date.parse('2026-07-20T00:00:00Z')}
          />,
        ),
      );
      const row = screen.getByTestId('agent-row-composer-scribe');
      // A raw date is a record; an age is a status.
      expect(within(row).getByText('2d ago')).toBeTruthy();
      expect(within(row).queryByText('2026-07-18')).toBeNull();

      fireEvent.click(within(row).getByTestId('agent-run-composer-scribe'));
      expect(onRunAgent).toHaveBeenCalledWith({ id: 'composer-scribe' });
    });

    it('deep-links the task an agent is working from its row', () => {
      const onNavigate = vi.fn();
      render(
        unlocked(
          <Agents
            roster={[entry({ id: 'codex-a', declared: true, working: true, current: { action: 'build', id: 'card-9', displayName: 'build', shortRef: 3 } })]}
            routing={ROUTING as never}
            onNavigate={onNavigate}
          />,
        ),
      );
      fireEvent.click(screen.getByTestId('agent-doing-codex-a'));
      expect(onNavigate).toHaveBeenCalledWith({ view: 'tasks', focus: { kind: 'card', id: 'card-9' } });
    });

    it('keeps the existing per-agent routing control rendering for declared agents', () => {
      render(unlocked(<Agents roster={DECLARED_ROSTER} routing={ROUTING as never} />));
      // The governed routing chip is still present + enabled for a declared agent.
      const chip = screen.getByTestId('agent-composer-scribe-routing-chip');
      expect((chip as HTMLButtonElement).disabled).toBe(false);
    });

    it('keeps observed identities out of the primary roster and puts system workers behind the disclosure', () => {
      render(unlocked(<Agents roster={DECLARED_ROSTER} routing={ROUTING as never} />));

      const declared = screen.getByRole('region', { name: /Your agents/ });
      expect(within(declared).getByTestId('agent-row-composer-scribe')).toBeTruthy();
      expect(screen.queryByTestId('agent-row-worker-desktop')).toBeNull();
      expect(screen.getByTestId('system-workers')).toBeTruthy();
    });
  });

  it('degrades to a calm empty state when no agents are on the board', () => {
    render(<SessionProvider><Agents snapshot={{ cards: {}, ledgers: EMPTY_LEDGERS, orgStates: [] }} /></SessionProvider>);
    expect(screen.getByText('No user-created agents are registered.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps roster DOM, scroll, filter, and layout while detail opens, then restores focus', () => {
    localStorage.setItem('kb.dashboard.entity-layout.v1', JSON.stringify({ agents: 'grid', workflows: 'list' }));
    render(unlocked(<Agents roster={PRIMARY_ROSTER} routing={ROUTING as never} />));
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    const filter = screen.getByLabelText('Filter agents') as HTMLInputElement;
    fireEvent.change(filter, { target: { value: 'claude' } });
    const region = screen.getByRole('region', { name: /Your agents/ });
    const roster = within(region).getByRole('table');
    roster.scrollTop = 37;
    const trigger = screen.getByTestId('agent-open-claude-m1');
    trigger.focus();
    fireEvent.click(trigger);

    expect(within(region).getByRole('table')).toBe(roster);
    expect(roster.scrollTop).toBe(37);
    expect(filter.value).toBe('claude');
    expect(screen.getByLabelText('Agents view').getAttribute('data-layout')).toBe('list');
    expect(JSON.parse(localStorage.getItem('kb.dashboard.entity-layout.v1') ?? '{}'))
      .toEqual({ agents: 'list', workflows: 'list' });
    const overlay = screen.getByRole('dialog');
    expect(within(overlay).getByTestId('agent-run')).toBeTruthy();
    expect(within(overlay).getByLabelText('Live session for this agent')).toBeTruthy();
    expect(within(overlay).getByLabelText('Runs this agent is working')).toBeTruthy();

    fireEvent.click(screen.getByTestId('entity-detail-close'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('defaults every newly opened or reopened agent overlay to Live', () => {
    render(unlocked(<Agents roster={PRIMARY_ROSTER} routing={ROUTING as never} />));

    fireEvent.click(screen.getByTestId('agent-open-claude-m1'));
    fireEvent.click(screen.getByTestId('entity-tab-brief'));
    expect(screen.getByTestId('entity-tab-brief').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('entity-detail-close'));

    fireEvent.click(screen.getByTestId('agent-open-codex-a'));
    expect(screen.getByTestId('entity-tab-live').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('entity-detail-close'));

    fireEvent.click(screen.getByTestId('agent-open-claude-m1'));
    expect(screen.getByTestId('entity-tab-live').getAttribute('aria-selected')).toBe('true');
  });
});
