// @vitest-environment jsdom
/**
 * U3 — Tasks view. All cards on one surface, grouped by state, with a detail pane that opens on
 * selection (frontmatter key/value + safe-rendered body). Card content is inert: rendered, never
 * interpreted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { Tasks, type CardsByState } from './Tasks';
import type { ParsedCard } from '../../server/planeA/cards';

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
    render(<Tasks data={fixture} />);
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
    render(<Tasks data={fixture} />);
    const done = screen.getByLabelText('Done cards');
    expect(within(done).getByText('Nothing in done.')).toBeTruthy();
  });

  it('opens the detail pane on selection: frontmatter key/value + rendered body', () => {
    render(<Tasks data={fixture} />);
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
    render(<Tasks data={data} />);
    fireEvent.click(screen.getByTestId('task-row-card-x'));
    const detail = screen.getByLabelText('Card detail');
    // The raw HTML survives as escaped text, and no <img> element is ever created.
    expect(detail.querySelector('img')).toBeNull();
    expect(detail.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('renders calm empty groups when there are no cards at all', () => {
    render(<Tasks data={{}} />);
    expect(screen.getByLabelText('Tasks view')).toBeTruthy();
    expect(screen.getByText('Nothing in inbox.')).toBeTruthy();
    expect(screen.getByText('Nothing in working.')).toBeTruthy();
    expect(screen.getByText('Nothing in approvals.')).toBeTruthy();
    expect(screen.getByText('Nothing in done.')).toBeTruthy();
    // Non-primary states stay hidden when empty.
    expect(screen.queryByLabelText('Blocked cards')).toBeNull();
  });
});
