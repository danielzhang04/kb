// @vitest-environment jsdom
/**
 * U2.5 — App shell: desktop-first left-sidebar navigation driven by the entity-first IA in
 * `src/nav/config.ts`. The groups are UNLABELLED (hairline dividers only — no uppercase group headers,
 * no per-section collapse); a [+ New ▾] menu sits above the first divider (only Task enabled). Clicking
 * a live item swaps the main content; greyed ("soon") items never become active; a sidebar-wide toggle
 * collapses to an icon rail; the Session/Stop floor is present regardless of the active view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { App } from './App';

beforeEach(() => {
  // Views self-fetch on mount; a never-resolving stub keeps every view on its empty-safe scaffold
  // (and keeps the sidebar approvals-count at 0, so no badge) without real network or state churn.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App shell — entity-first sidebar navigation', () => {
  it('renders the sidebar as unlabelled groups (dividers, no group headers) with every nav item', () => {
    render(<App />);

    expect(screen.getByLabelText('Primary navigation')).toBeTruthy();

    // No verb-group headers survive the entity-first regroup.
    for (const oldGroup of ['Operate', 'Build', 'Knowledge', 'System']) {
      expect(screen.queryByRole('button', { name: oldGroup })).toBeNull();
    }
    // Divider-only separators are present instead (one per group).
    expect(screen.getAllByRole('separator').length).toBe(3);

    for (const label of [
      'Home',
      'Approvals',
      'Activity',
      'Atlas',
      'Terminal',
      'Workflows',
      'Agents',
      'Tasks',
      'Projects',
      'Files',
      'Connectors',
      'Ledgers',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
  });

  it('does not render any dropped verb-IA destination', () => {
    render(<App />);
    for (const dropped of ['Board', 'Editor', 'Vibe', 'Registry', 'Pipeline', 'Sentinel']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${dropped}$`) })).toBeNull();
    }
  });

  it('lands on the Home rollup view by default', () => {
    render(<App />);
    expect(screen.getByLabelText('Home view')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
  });

  it('pins the Session/Stop floor in the shell, present regardless of the active view', () => {
    render(<App />);
    expect(screen.getByTestId('stop-floor')).toBeTruthy();
    // U5.1 — the floor carries a passive session indicator, NOT sign-in/out chrome.
    expect(screen.getByTestId('session-state').textContent).toMatch(/session/i);
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    expect(screen.getByLabelText('Stop floor')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'STOP everything' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect(screen.getByLabelText('Stop floor')).toBeTruthy();
  });

  it('lays the sidebar out as a full-height column: [+ New] header, scrollable nav, pinned floor last', () => {
    // U5.1 item 7 — the sidebar is a three-zone flex column pinned to the viewport height. jsdom can't
    // compute the 100dvh/zoom layout, so this pins the STRUCTURE the CSS relies on: the middle nav zone
    // exists (it carries overflow-y:auto), and the Session·STOP floor is the LAST child of the sidebar
    // so margin-top:auto pins it to the bottom rather than letting it be pushed off-screen mid-column.
    render(<App />);
    const sidebar = screen.getByLabelText('Primary navigation');
    expect(sidebar.querySelector('.mc-nav')).toBeTruthy();
    expect(sidebar.lastElementChild?.getAttribute('data-testid')).toBe('stop-floor');
    // The [+ New] header zone sits inside the sidebar, above the nav list.
    expect(within(sidebar).getByRole('button', { name: 'New' })).toBeTruthy();
  });

  it('exposes a quiet theme toggle that flips the pinned data-theme and persists the choice', () => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    render(<App />);

    const toggle = screen.getByRole('button', { name: /switch to light theme/i });
    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('mc-theme')).toBe('light');

    // Toggling back returns to dark (the app default) and re-persists.
    fireEvent.click(screen.getByRole('button', { name: /switch to dark theme/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('mc-theme')).toBe('dark');
  });

  it('routes each live destination to its mapped view', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect(screen.getByRole('button', { name: 'Workflows' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByLabelText('Workflows view')).toBeTruthy();
    expect(screen.queryByLabelText('Control view')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Approvals' }));
    expect(screen.getByLabelText('Approvals inbox')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByLabelText('Activity view')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
    expect(screen.getByLabelText('Connectors view')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByLabelText('Files view')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByLabelText('Home view')).toBeTruthy();
  });

  it('routes the U3 entity destinations (Agents/Tasks/Projects/Ledgers) to their real views', () => {
    render(<App />);
    for (const label of ['Agents', 'Tasks', 'Projects', 'Ledgers']) {
      const btn = screen.getByRole('button', { name: label }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      fireEvent.click(btn);
      expect(btn.getAttribute('aria-current')).toBe('page');
      // The real view is mounted (self-fetch stubbed to never resolve → empty-safe scaffold), not the
      // "built in U3" placeholder.
      const view = screen.getByLabelText(`${label} view`);
      expect(view.textContent ?? '').not.toMatch(/built in U3/i);
    }
  });

  it('greyed "soon" items (Atlas, Terminal) are unclickable and never become active', () => {
    render(<App />);
    for (const label of ['Atlas', 'Terminal']) {
      const btn = screen.getByRole('button', { name: new RegExp(`^${label}`) }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      fireEvent.click(btn);
    }
    // Still on the default Home view — every disabled click was a no-op.
    expect(screen.getByLabelText('Home view')).toBeTruthy();
  });

  it('the sidebar-wide collapse toggle switches the shell into rail mode and back', () => {
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    const expanded = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expanded.getAttribute('aria-pressed')).toBe('true');
    // Nav items stay reachable in rail mode (CSS hides labels, not the DOM/a11y tree).
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();

    fireEvent.click(expanded);
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
  });
});

describe('App shell — [+ New ▾] menu', () => {
  it('opens an idea-first menu: idea/task/workflow/skill/project enabled; only Agent disabled', () => {
    render(<App />);

    const trigger = screen.getByRole('button', { name: 'New' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const menu = screen.getByRole('menu', { name: 'Create new' });
    // The freeform "Idea…" leads; Task + the three secondary entity pickers are all actionable now.
    expect(within(menu).getAllByRole('menuitem')[0].textContent).toMatch(/Idea/);
    for (const label of [/Idea/, /^Task/, /Workflow/, /Skill/, /Project/]) {
      expect((within(menu).getByRole('menuitem', { name: label }) as HTMLButtonElement).disabled).toBe(false);
    }
    // Agent stays deferred (plan Flagged #4).
    const agent = within(menu).getByRole('menuitem', { name: /Agent/ }) as HTMLButtonElement;
    expect(agent.disabled).toBe(true);
  });

  it('idea_opens_composer_in_idea_mode over the current view; Back returns', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Idea/ }));

    // The Composer surface replaces the view body, pre-seeded to `idea`; Home is not mounted while open.
    expect(screen.getByLabelText('Composer')).toBeTruthy();
    expect(screen.getByTestId('composer-type').textContent).toMatch(/idea/);
    expect(screen.queryByLabelText('Home view')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByLabelText('Composer')).toBeNull();
    expect(screen.getByLabelText('Home view')).toBeTruthy();
  });

  it('skill_entry_opens_composer_preseeded (and workflow/project likewise)', () => {
    for (const [label, kind] of [
      [/Skill/, 'skill'],
      [/Workflow/, 'workflow'],
      [/Project/, 'project'],
    ] as const) {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'New' }));
      fireEvent.click(screen.getByRole('menuitem', { name: label }));

      // The same Composer surface opens, pre-seeded to the picked type.
      expect(screen.getByLabelText('Composer')).toBeTruthy();
      expect(screen.getByTestId('composer-type').textContent).toMatch(new RegExp(kind));
      cleanup();
    }
  });

  it('agent_entry_remains_disabled and never opens the Composer', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));

    const agent = screen.getByRole('menuitem', { name: /Agent/ }) as HTMLButtonElement;
    expect(agent.disabled).toBe(true);
    fireEvent.click(agent);
    // A disabled click is a no-op: no Composer, still on Home.
    expect(screen.queryByLabelText('Composer')).toBeNull();
    expect(screen.getByLabelText('Home view')).toBeTruthy();
  });

  it('task_entry_still_routes_to_launch_surface (Home) and closes the menu', () => {
    render(<App />);

    // Move off Home first so the navigation is observable.
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect(screen.getByLabelText('Workflows view')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Task/ }));

    // Home hosts the Launch/rerun surface; the menu is closed after the action.
    expect(screen.getByLabelText('Home view')).toBeTruthy();
    expect(screen.getByLabelText('Launch card')).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'Create new' })).toBeNull();
  });

  it('Escape closes the menu', () => {
    render(<App />);
    const trigger = screen.getByRole('button', { name: 'New' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Create new' })).toBeTruthy();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Create new' })).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
