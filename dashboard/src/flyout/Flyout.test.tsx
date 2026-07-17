// @vitest-environment jsdom
/**
 * U4 — entity hover-flyout. The Flyout renders a live summary; an empty/absent summary renders nothing
 * (calm degrade, no error). The NavItem host opens it after a short delay on hover/focus and dismisses
 * it on leave/blur/Esc — keyboard-accessible, works without a mouse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Flyout } from './Flyout';
import type { FlyoutSummary } from './flyoutModel';
import { NavItem } from '../App';
import type { NavDestination } from '../nav/config';

const SUMMARY: FlyoutSummary = {
  title: 'Tasks',
  lines: [
    { label: 'working', value: 2 },
    { label: 'inbox', value: 1 },
  ],
  ids: ['c_w1', 'c_w2'],
  idLabel: 'working now',
  empty: false,
};

const TASKS_ITEM: NavDestination = { id: 'tasks', label: 'Tasks', icon: '☰', status: 'live' };

afterEach(cleanup);

describe('Flyout — presentational', () => {
  it('renders the summary contents when open', () => {
    render(<Flyout open id="tasks" summary={SUMMARY} />);
    const panel = screen.getByTestId('flyout-tasks');
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('working');
    expect(panel.textContent).toContain('2');
    expect(panel.textContent).toContain('c_w1');
    expect(panel.textContent).toContain('working now');
  });

  it('renders nothing when closed, empty, or summary-less (calm degrade)', () => {
    const { rerender } = render(<Flyout open={false} id="tasks" summary={SUMMARY} />);
    expect(screen.queryByTestId('flyout-tasks')).toBeNull();

    rerender(<Flyout open id="tasks" summary={{ ...SUMMARY, lines: [], ids: [], empty: true }} />);
    expect(screen.queryByTestId('flyout-tasks')).toBeNull();

    rerender(<Flyout open id="tasks" summary={null} />);
    expect(screen.queryByTestId('flyout-tasks')).toBeNull();
  });
});

describe('Flyout — NavItem hover/focus host', () => {
  it('opens after the delay on hover and dismisses on leave', async () => {
    render(
      <ul>
        <NavItem item={TASKS_ITEM} active="home" onSelect={vi.fn()} summary={SUMMARY} flyoutDelay={20} />
      </ul>,
    );
    const btn = screen.getByRole('button', { name: /Tasks/ });

    // Not open before hover, and not open synchronously on hover (the delay hasn't elapsed).
    expect(screen.queryByTestId('flyout-tasks')).toBeNull();
    fireEvent.mouseEnter(btn);
    expect(screen.queryByTestId('flyout-tasks')).toBeNull();

    // Appears once the delay elapses.
    expect(await screen.findByTestId('flyout-tasks')).toBeTruthy();

    fireEvent.mouseLeave(btn);
    expect(screen.queryByTestId('flyout-tasks')).toBeNull();
  });

  it('opens on keyboard focus and dismisses on Escape', async () => {
    render(
      <ul>
        <NavItem item={TASKS_ITEM} active="home" onSelect={vi.fn()} summary={SUMMARY} flyoutDelay={20} />
      </ul>,
    );
    const btn = screen.getByRole('button', { name: /Tasks/ });

    fireEvent.focus(btn);
    expect(await screen.findByTestId('flyout-tasks')).toBeTruthy();

    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(screen.queryByTestId('flyout-tasks')).toBeNull();
  });

  it('never opens a flyout for an item whose summary is empty', async () => {
    render(
      <ul>
        <NavItem
          item={TASKS_ITEM}
          active="home"
          onSelect={vi.fn()}
          summary={{ ...SUMMARY, lines: [], ids: [], empty: true }}
          flyoutDelay={10}
        />
      </ul>,
    );
    const btn = screen.getByRole('button', { name: /Tasks/ });
    fireEvent.mouseEnter(btn);
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.queryByTestId('flyout-tasks')).toBeNull();
  });
});
