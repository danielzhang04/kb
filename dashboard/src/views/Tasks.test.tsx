// @vitest-environment jsdom
/**
 * U3 — Tasks view. All cards on one surface, grouped by state, with a detail pane that opens on
 * selection (frontmatter key/value + safe-rendered body). Card content is inert: rendered, never
 * interpreted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { Tasks, type CardsByState } from './Tasks';
import { SessionProvider } from '../lib/sessionContext';
import type { ParsedCard } from '../../server/planeA/cards';
import type { RoutingSnapshot } from '../lib/routingClient';

afterEach(cleanup);

function card(over: Partial<ParsedCard['meta']> & { id: string }, body = ''): ParsedCard {
  return {
    meta: {
      project: 'kb',
      action: 'noop',
      target: 'x',
      'risk-tier': 'T1',
      owner: null,
      state: 'inbox',
      ...over,
    },
    body,
  };
}

const fixture: CardsByState = {
  inbox: [card({ id: 'card-100', action: 'draft-plan', 'risk-tier': 'T1', state: 'inbox' })],
  blocked: [card({ id: 'card-150', action: 'future-stage', 'risk-tier': 'T2', owner: 'codex-worker', state: 'blocked' })],
  working: [
    card({ id: 'card-200', action: 'run-build', 'risk-tier': 'T2', owner: 'claude/m1', state: 'working' }),
  ],
  approvals: [
    card(
      { id: 'card-300', action: 'push-remote', 'risk-tier': 'T3', owner: 'claude/ops', state: 'approvals' },
      '## Work order\n\nPush the ops branch.\n\n- step one\n- step two\n',
    ),
  ],
};

describe('Tasks view', () => {
  it('renders a group per state from fixture data with its cards', () => {
    render(<SessionProvider><Tasks data={fixture} /></SessionProvider>);
    // Primary buckets present as labelled groups.
    expect(screen.getByLabelText('Inbox cards')).toBeTruthy();
    expect(screen.getByLabelText('Working cards')).toBeTruthy();
    expect(screen.getByLabelText('Approvals cards')).toBeTruthy();
    // Cards land under the right group.
    expect(within(screen.getByLabelText('Inbox cards')).getByText('card-100')).toBeTruthy();
    expect(within(screen.getByLabelText('Working cards')).getByText('card-200')).toBeTruthy();
    expect(within(screen.getByLabelText('Approvals cards')).getByText('card-300')).toBeTruthy();
  });

  it('always renders the four primary buckets, empty ones calm (Done here has no cards)', () => {
    render(<SessionProvider><Tasks data={fixture} /></SessionProvider>);
    const done = screen.getByLabelText('Done cards');
    expect(within(done).getByText('Nothing in done.')).toBeTruthy();
  });

  it('opens the detail pane on selection: frontmatter key/value + rendered body', () => {
    render(<SessionProvider><Tasks data={fixture} /></SessionProvider>);
    // Nothing selected -> placeholder prompt.
    expect(screen.getByText('Select a card to see its frontmatter and body.')).toBeTruthy();

    fireEvent.click(screen.getByTestId('task-row-card-300'));

    const detail = screen.getByLabelText('Card detail');
    // Frontmatter block: key + value pairs.
    expect(within(detail).getByText('risk-tier')).toBeTruthy();
    expect(within(detail).getByText('T3')).toBeTruthy();
    expect(within(detail).getByText('push-remote')).toBeTruthy();
    // Body rendered through the safe markdown renderer (heading + list item become real elements).
    expect(within(detail).getByRole('heading', { name: 'Work order' })).toBeTruthy();
    expect(within(detail).getByText('step one')).toBeTruthy();
  });

  it('body content is escaped, never interpreted as live markup', () => {
    const data: CardsByState = {
      inbox: [card({ id: 'card-x', state: 'inbox' }, '## Evidence\n\n<img src=x onerror=alert(1)>\n')],
    };
    render(<SessionProvider><Tasks data={data} /></SessionProvider>);
    fireEvent.click(screen.getByTestId('task-row-card-x'));
    const detail = screen.getByLabelText('Card detail');
    // The raw HTML survives as escaped text, and no <img> element is ever created.
    expect(detail.querySelector('img')).toBeNull();
    expect(detail.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('locks the per-card routing toggle for a card under an active approval (approvals state)', () => {
    const routing: RoutingSnapshot = {
      policy: {
        version: 1,
        runtimes: { claude: { default_worker: 'worker-desktop', aliases: {}, known_models: ['claude-opus-4-8'] } },
        matrix: {},
        role_default: null,
      },
      agents: [],
      cards: {},
      audit: { mismatches: [], overrides: [] },
      overrides: [],
    };
    render(<SessionProvider><Tasks data={fixture} routing={routing} /></SessionProvider>);
    // card-300 is in `approvals` — selecting it must present a disabled, locked routing chip.
    fireEvent.click(screen.getByTestId('task-row-card-300'));
    const chip = screen.getByTestId('card-card-300-routing-chip') as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(screen.getByTestId('card-card-300-routing-locked')).toBeTruthy();
  });

  it('locks a working card because routing is fixed for the active attempt', () => {
    const routing: RoutingSnapshot = {
      policy: {
        version: 1,
        runtimes: { claude: { default_worker: 'worker-desktop', aliases: {}, known_models: ['claude-opus-4-8'] } },
        matrix: {},
        role_default: null,
      },
      agents: [],
      cards: {},
      audit: { mismatches: [], overrides: [] },
      overrides: [],
    };
    render(<SessionProvider><Tasks data={fixture} routing={routing} /></SessionProvider>);
    fireEvent.click(screen.getByTestId('task-row-card-200')); // working
    const chip = screen.getByTestId('card-card-200-routing-chip') as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(screen.getByTestId('card-card-200-routing-locked').textContent).toMatch(/fixed for this attempt/i);
  });

  it('keeps an owned dependency-blocked stage mutable before release', () => {
    const routing: RoutingSnapshot = {
      policy: {
        version: 1,
        runtimes: { claude: { default_worker: 'worker-desktop', aliases: {}, known_models: ['claude-opus-4-8'] } },
        matrix: {},
        role_default: null,
      },
      agents: [],
      cards: {},
      audit: { mismatches: [], overrides: [] },
      overrides: [],
    };
    render(<SessionProvider><Tasks data={fixture} routing={routing} /></SessionProvider>);
    fireEvent.click(screen.getByTestId('task-row-card-150'));
    const chip = screen.getByTestId('card-card-150-routing-chip') as HTMLButtonElement;
    expect(chip.disabled).toBe(false);
    expect(screen.queryByTestId('card-card-150-routing-locked')).toBeNull();
  });

  it('locks an assigned inbox card because canonical inbox may race runner pickup', () => {
    const data: CardsByState = { inbox: [card({ id: 'card-owned', owner: 'codex-worker', state: 'inbox' })] };
    const routing: RoutingSnapshot = {
      policy: {
        version: 1,
        runtimes: { claude: { default_worker: 'worker-desktop', aliases: {}, known_models: ['claude-opus-4-8'] } },
        matrix: {},
        role_default: null,
      },
      agents: [],
      cards: {},
      audit: { mismatches: [], overrides: [] },
      overrides: [],
    };
    render(<SessionProvider><Tasks data={data} routing={routing} /></SessionProvider>);
    fireEvent.click(screen.getByTestId('task-row-card-owned'));
    expect((screen.getByTestId('card-card-owned-routing-chip') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('card-card-owned-routing-locked').textContent).toMatch(/runner may already be active/i);
  });

  it('renders calm empty groups when there are no cards at all', () => {
    render(<SessionProvider><Tasks data={{}} /></SessionProvider>);
    expect(screen.getByLabelText('Tasks view')).toBeTruthy();
    expect(screen.getByText('Nothing in inbox.')).toBeTruthy();
    expect(screen.getByText('Nothing in working.')).toBeTruthy();
    expect(screen.getByText('Nothing in approvals.')).toBeTruthy();
    expect(screen.getByText('Nothing in done.')).toBeTruthy();
    // Non-primary states stay hidden when empty.
    expect(screen.queryByLabelText('Blocked cards')).toBeNull();
  });
});
