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
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { ParsedCard } from '../../server/planeA/cards';

function card(owner: string | null, state: string, extra: Partial<ParsedCard['meta']> = {}): ParsedCard {
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

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('deriveRoster', () => {
  it('derives one row per distinct non-null owner, working agents first', () => {
    const roster = deriveRoster(SNAPSHOT);
    expect(roster.map((r) => r.id)).toEqual(['claude-m1', 'codex-a']);
    // claude-m1 owns the working card → working + a current card; codex-a only owns a done card → idle.
    expect(roster[0]).toMatchObject({ id: 'claude-m1', working: true, cardCount: 2 });
    expect(roster[0].current).toEqual({ action: 'ship-dashboard', id: 'card-77' });
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
    render(<Agents snapshot={SNAPSHOT} />);

    expect(screen.getByLabelText('Agents view')).toBeTruthy();
    const row = screen.getByTestId('agent-row-claude-m1');
    expect(within(row).getByText('claude-m1')).toBeTruthy();
    expect(within(row).getByText('ship-dashboard')).toBeTruthy();
    expect(within(row).getByText('card-77')).toBeTruthy();
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
    render(<Agents snapshot={SNAPSHOT} routing={ROUTING as never} sessionToken="tok" />);
    const row = screen.getByTestId('agent-row-claude-m1');
    expect(within(row).getByText('claude-opus-4-8')).toBeTruthy();
    expect(within(row).getByText('policy')).toBeTruthy();
    // With a session, the chip is an enabled control (not the old inert placeholder).
    const chip = screen.getByTestId('agent-claude-m1-routing-chip');
    expect((chip as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a Clear-override affordance only when the agent has an override, after opening the popover', () => {
    render(<Agents snapshot={SNAPSHOT} routing={ROUTING as never} sessionToken="tok" />);
    fireEvent.click(screen.getByTestId('agent-codex-a-routing-chip'));
    expect(screen.getByTestId('agent-codex-a-routing-clear')).toBeTruthy();
    // The policy-sourced agent has no clear affordance.
    fireEvent.click(screen.getByTestId('agent-claude-m1-routing-chip'));
    expect(screen.queryByTestId('agent-claude-m1-routing-clear')).toBeNull();
  });

  it('is fail-closed without a session: the chip is disabled and a sign-in nudge shows', () => {
    render(<Agents snapshot={SNAPSHOT} routing={ROUTING as never} />);
    const chip = screen.getByTestId('agent-claude-m1-routing-chip');
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByTestId('agent-claude-m1-routing-nudge').length).toBeGreaterThan(0);
  });

  it('degrades to a calm empty state when no agents are on the board', () => {
    render(<Agents snapshot={{ cards: {}, ledgers: EMPTY_LEDGERS, orgStates: [] }} />);
    expect(screen.getByText('No agents on the board.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
