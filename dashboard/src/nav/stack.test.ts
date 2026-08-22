import { describe, expect, it } from 'vitest';
import {
  backStack,
  focusTarget,
  goToStack,
  MAX_NAV_DEPTH,
  navigationSearchFor,
  parseNavigationSearch,
  parentEntry,
  pushStack,
  rootStack,
  sameTarget,
  setSectionOnStack,
} from './stack';

describe('nav stack', () => {
  it('accepts valid top-level and matching entity deep links', () => {
    expect(parseNavigationSearch('?view=health')).toEqual([{ view: 'health' }]);
    expect(parseNavigationSearch('?view=agents&entity=agent%3Afyt_checker')).toEqual([
      { view: 'agents' },
      { view: 'agents', focus: { kind: 'agent', id: 'fyt_checker' } },
    ]);
    expect(parseNavigationSearch('?view=workflows&entity=workflow%3Avideo-run').at(-1)?.focus)
      .toEqual({ kind: 'workflow', id: 'video-run' });
    expect(parseNavigationSearch('?view=tasks&entity=card%3Aabcdef01-card').at(-1)?.focus)
      .toEqual({ kind: 'card', id: 'abcdef01-card' });
  });

  it('rejects deleted, unknown, malformed, and mismatched deep links to clean Home', () => {
    for (const search of [
      '?view=atlas', '?view=unknown', '?view=agents&entity=workflow%3Avideo-run',
      '?view=health&entity=agent%3Afyt-checker', '?view=agents&entity=agent%3A',
      '?view=agents&view=tasks', '?view=agents&extra=1', '?entity=agent%3Afyt-checker',
      '?view=agents&entity=agent%3Afyt%', '?view=agents&entity=agent%3Afyt%ZZ',
      '?view=agents&entity=agent%3Afyt%E2%82',
    ]) {
      expect(parseNavigationSearch(search), search).toEqual([{ view: 'home' }]);
    }
  });

  it('serializes canonical percent-encoded view/entity queries through URLSearchParams', () => {
    expect(navigationSearchFor({ view: 'home' })).toBe('?view=home');
    expect(navigationSearchFor({ view: 'agents', focus: { kind: 'agent', id: 'fyt checker/one' } }))
      .toBe('?view=agents&entity=agent%3Afyt+checker%2Fone');
  });

  it('round-trips only the closed attention filter on Agent and Workflow roots', () => {
    expect(parseNavigationSearch('?view=agents&filter=attention')).toEqual([{ view: 'agents', filter: 'attention' }]);
    expect(parseNavigationSearch('?view=workflows&filter=attention')).toEqual([{ view: 'workflows', filter: 'attention' }]);
    expect(navigationSearchFor({ view: 'agents', filter: 'attention' })).toBe('?view=agents&filter=attention');
    expect(parseNavigationSearch('?view=inbox&filter=attention')).toEqual([{ view: 'home' }]);
    expect(parseNavigationSearch('?view=agents&filter=all')).toEqual([{ view: 'home' }]);
  });

  it('treats a sidebar click as a fresh root rather than accumulated history', () => {
    // This is the property that preserves today's mental model: browsing the sidebar must never
    // leave a back arrow behind.
    const drilled = pushStack(rootStack('workflows'), { view: 'workflows', focus: { kind: 'run', id: 'run-1' } });
    expect(drilled).toHaveLength(2);

    const reset = goToStack('agents');
    expect(reset).toEqual([{ view: 'agents' }]);
    expect(parentEntry(reset)).toBeUndefined();
  });

  it('pushes a focused entry and pops back to the entry below it', () => {
    const list = rootStack('workflows');
    const detail = pushStack(list, { view: 'workflows', focus: { kind: 'run', id: 'run-1' } });

    expect(detail[detail.length - 1].focus).toEqual({ kind: 'run', id: 'run-1' });
    expect(parentEntry(detail)).toEqual({ view: 'workflows' });

    const back = backStack(detail);
    expect(back).toEqual(list);
    expect(back[back.length - 1].focus).toBeUndefined();
  });

  it('targets every focus kind at the ONE destination that owns it', () => {
    // Runs lost both destinations of their own; a run link resolves into Workflows, beside the
    // definition that produced it. Every caller goes through this builder, so the mapping is one table.
    expect(focusTarget({ kind: 'run', id: 'run-1' })).toEqual({ view: 'workflows', focus: { kind: 'run', id: 'run-1' } });
    expect(focusTarget({ kind: 'workflow', id: 'wf-1' })).toEqual({ view: 'workflows', focus: { kind: 'workflow', id: 'wf-1' } });
    expect(focusTarget({ kind: 'agent', id: 'a-1' })).toEqual({ view: 'agents', focus: { kind: 'agent', id: 'a-1' } });
    expect(focusTarget({ kind: 'card', id: 'c-1' })).toEqual({ view: 'tasks', focus: { kind: 'card', id: 'c-1' } });
    expect(focusTarget({ kind: 'run', id: 'run-1' }, 'changes').section).toBe('changes');
  });

  it('is a no-op at the root, so back can never empty the stack', () => {
    const root = rootStack('home');
    expect(backStack(root)).toEqual(root);
    expect(backStack(backStack(root))).toEqual(root);
  });

  it('swallows a push identical to the top entry so a double click cannot duplicate it', () => {
    const target = { view: 'workflows' as const, focus: { kind: 'run' as const, id: 'run-1' } };
    const once = pushStack(rootStack('workflows'), target);
    const twice = pushStack(once, target);

    expect(twice).toBe(once);
    expect(twice).toHaveLength(2);
  });

  it('distinguishes two different entities in the same view', () => {
    const first = { view: 'workflows' as const, focus: { kind: 'run' as const, id: 'run-1' } };
    const second = { view: 'workflows' as const, focus: { kind: 'run' as const, id: 'run-2' } };

    expect(sameTarget(first, second)).toBe(false);
    expect(pushStack(pushStack(rootStack('workflows'), first), second)).toHaveLength(3);
  });

  it('caps depth by dropping from the bottom, never from the operator current context', () => {
    let stack = rootStack('workflows');
    for (let i = 0; i < MAX_NAV_DEPTH + 4; i += 1) {
      stack = pushStack(stack, { view: 'workflows', focus: { kind: 'run', id: `run-${i}` } });
    }

    expect(stack).toHaveLength(MAX_NAV_DEPTH);
    // The most recent push survives; the oldest entries are the ones discarded.
    expect(stack[stack.length - 1].focus?.id).toBe(`run-${MAX_NAV_DEPTH + 3}`);
  });

  it('records the active section on the top entry so back-then-forward restores the tab', () => {
    const detail = pushStack(rootStack('workflows'), { view: 'workflows', focus: { kind: 'run', id: 'run-1' } });
    const tabbed = setSectionOnStack(detail, 'changes');

    expect(tabbed[tabbed.length - 1].section).toBe('changes');
    // The entry below is untouched, so returning to the list does not inherit a detail tab.
    expect(tabbed[0]).toEqual({ view: 'workflows' });
  });

  it('does not churn state when the section is unchanged', () => {
    const tabbed = setSectionOnStack(rootStack('workflows'), 'overview');
    expect(setSectionOnStack(tabbed, 'overview')).toBe(tabbed);
  });

  it('returns the operator to the tab they left after drilling deeper and coming back', () => {
    // This is what storing the section ON THE ENTRY buys: open a run, switch to Changes, follow a link
    // deeper, then back — the run detail is still on Changes rather than reset to Overview.
    let stack = pushStack(rootStack('workflows'), { view: 'workflows', focus: { kind: 'run', id: 'run-1' } });
    stack = setSectionOnStack(stack, 'changes');
    stack = pushStack(stack, { view: 'tasks', focus: { kind: 'card', id: 'card-1' } });

    expect(stack[stack.length - 1].view).toBe('tasks');

    stack = backStack(stack);

    const top = stack[stack.length - 1];
    expect(top.focus).toEqual({ kind: 'run', id: 'run-1' });
    expect(top.section).toBe('changes');
  });
});
