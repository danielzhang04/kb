import { describe, expect, it } from 'vitest';
import {
  backStack,
  goToStack,
  MAX_NAV_DEPTH,
  parentEntry,
  pushStack,
  rootStack,
  sameTarget,
  setSectionOnStack,
} from './stack';

describe('nav stack', () => {
  it('treats a sidebar click as a fresh root rather than accumulated history', () => {
    // This is the property that preserves today's mental model: browsing the sidebar must never
    // leave a back arrow behind.
    const drilled = pushStack(rootStack('pipeline'), { view: 'pipeline', focus: { kind: 'run', id: 'run-1' } });
    expect(drilled).toHaveLength(2);

    const reset = goToStack('agents');
    expect(reset).toEqual([{ view: 'agents' }]);
    expect(parentEntry(reset)).toBeUndefined();
  });

  it('pushes a focused entry and pops back to the entry below it', () => {
    const list = rootStack('pipeline');
    const detail = pushStack(list, { view: 'pipeline', focus: { kind: 'run', id: 'run-1' } });

    expect(detail[detail.length - 1].focus).toEqual({ kind: 'run', id: 'run-1' });
    expect(parentEntry(detail)).toEqual({ view: 'pipeline' });

    const back = backStack(detail);
    expect(back).toEqual(list);
    expect(back[back.length - 1].focus).toBeUndefined();
  });

  it('is a no-op at the root, so back can never empty the stack', () => {
    const root = rootStack('home');
    expect(backStack(root)).toEqual(root);
    expect(backStack(backStack(root))).toEqual(root);
  });

  it('swallows a push identical to the top entry so a double click cannot duplicate it', () => {
    const target = { view: 'pipeline' as const, focus: { kind: 'run' as const, id: 'run-1' } };
    const once = pushStack(rootStack('pipeline'), target);
    const twice = pushStack(once, target);

    expect(twice).toBe(once);
    expect(twice).toHaveLength(2);
  });

  it('distinguishes two different entities in the same view', () => {
    const first = { view: 'pipeline' as const, focus: { kind: 'run' as const, id: 'run-1' } };
    const second = { view: 'pipeline' as const, focus: { kind: 'run' as const, id: 'run-2' } };

    expect(sameTarget(first, second)).toBe(false);
    expect(pushStack(pushStack(rootStack('pipeline'), first), second)).toHaveLength(3);
  });

  it('caps depth by dropping from the bottom, never from the operator current context', () => {
    let stack = rootStack('pipeline');
    for (let i = 0; i < MAX_NAV_DEPTH + 4; i += 1) {
      stack = pushStack(stack, { view: 'pipeline', focus: { kind: 'run', id: `run-${i}` } });
    }

    expect(stack).toHaveLength(MAX_NAV_DEPTH);
    // The most recent push survives; the oldest entries are the ones discarded.
    expect(stack[stack.length - 1].focus?.id).toBe(`run-${MAX_NAV_DEPTH + 3}`);
  });

  it('records the active section on the top entry so back-then-forward restores the tab', () => {
    const detail = pushStack(rootStack('pipeline'), { view: 'pipeline', focus: { kind: 'run', id: 'run-1' } });
    const tabbed = setSectionOnStack(detail, 'changes');

    expect(tabbed[tabbed.length - 1].section).toBe('changes');
    // The entry below is untouched, so returning to the list does not inherit a detail tab.
    expect(tabbed[0]).toEqual({ view: 'pipeline' });
  });

  it('does not churn state when the section is unchanged', () => {
    const tabbed = setSectionOnStack(rootStack('pipeline'), 'overview');
    expect(setSectionOnStack(tabbed, 'overview')).toBe(tabbed);
  });

  it('returns the operator to the tab they left after drilling deeper and coming back', () => {
    // This is what storing the section ON THE ENTRY buys: open a run, switch to Changes, follow a link
    // deeper, then back — the run detail is still on Changes rather than reset to Overview.
    let stack = pushStack(rootStack('pipeline'), { view: 'pipeline', focus: { kind: 'run', id: 'run-1' } });
    stack = setSectionOnStack(stack, 'changes');
    stack = pushStack(stack, { view: 'tasks', focus: { kind: 'card', id: 'card-1' } });

    expect(stack[stack.length - 1].view).toBe('tasks');

    stack = backStack(stack);

    const top = stack[stack.length - 1];
    expect(top.focus).toEqual({ kind: 'run', id: 'run-1' });
    expect(top.section).toBe('changes');
  });
});
