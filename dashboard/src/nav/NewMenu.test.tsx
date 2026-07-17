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

  it('fires onCreate("task") for Task; the entity types are disabled', () => {
    const onCreate = vi.fn();
    render(<NewMenu onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));

    for (const label of ['Workflow', 'Skill', 'Project', 'Agent']) {
      const item = screen.getByRole('menuitem', { name: new RegExp(label) }) as HTMLButtonElement;
      expect(item.disabled).toBe(true);
      fireEvent.click(item);
    }
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('menuitem', { name: /^Task/ }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith('task');
    // Menu closes after a successful create.
    expect(screen.queryByRole('menu')).toBeNull();
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
