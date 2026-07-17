// @vitest-environment jsdom
/**
 * U2.5 — [+ New ▾] menu. Only Task fires `onCreate`; the other entries are disabled (Composer). The
 * menu toggles from the trigger, closes on Escape and on an outside click, and is keyboard/AT-legible
 * (menu/menuitem roles).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NewMenu } from './NewMenu';

afterEach(cleanup);

describe('NewMenu', () => {
  it('is closed by default and toggles open from the trigger', () => {
    render(<NewMenu onCreate={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'New' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Create new' })).toBeTruthy();
  });

  it('is idea-first: Idea is the first, enabled, Composer-flagged entry', () => {
    const onCreate = vi.fn();
    render(<NewMenu onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));

    const items = screen.getAllByRole('menuitem');
    // The freeform "Idea…" leads the menu (shape says "bring an idea, iterate").
    expect(items[0].textContent).toMatch(/Idea/);
    const idea = screen.getByRole('menuitem', { name: /Idea/ }) as HTMLButtonElement;
    expect(idea.disabled).toBe(false);
    expect(idea.textContent).toMatch(/composer/i);

    fireEvent.click(idea);
    expect(onCreate).toHaveBeenCalledWith('idea');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('fires onCreate for Task and the secondary entity pickers; only Agent is disabled', () => {
    const onCreate = vi.fn();
    render(<NewMenu onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));

    // Agent stays deferred (disabled) — clicking it is a no-op.
    const agent = screen.getByRole('menuitem', { name: /Agent/ }) as HTMLButtonElement;
    expect(agent.disabled).toBe(true);
    fireEvent.click(agent);
    expect(onCreate).not.toHaveBeenCalled();
    // Close the still-open menu so the loop below re-opens from a known (closed) state.
    fireEvent.keyDown(screen.getByRole('button', { name: 'New' }), { key: 'Escape' });

    // Each enabled entry fires onCreate with its own id and closes the menu.
    for (const [label, id] of [
      [/^Task/, 'task'],
      [/Workflow/, 'workflow'],
      [/Skill/, 'skill'],
      [/Project/, 'project'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'New' }));
      const item = screen.getByRole('menuitem', { name: label }) as HTMLButtonElement;
      expect(item.disabled).toBe(false);
      fireEvent.click(item);
      expect(onCreate).toHaveBeenLastCalledWith(id);
      expect(screen.queryByRole('menu')).toBeNull();
    }
    expect(onCreate).toHaveBeenCalledTimes(4);
  });

  it('closes on Escape', () => {
    render(<NewMenu onCreate={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'New' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on an outside click', () => {
    render(
      <div>
        <NewMenu onCreate={() => {}} />
        <button type="button">outside</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
