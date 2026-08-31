import { describe, expect, it, vi } from 'vitest';
import { dependencyLabel, stepSelection } from './graphHandles';

describe('workflow step graph interactions', () => {
  it('keeps selection and dependency wording in one shared rule', () => {
    const select = vi.fn();
    const props = stepSelection('review', 'review', select);
    expect(props['aria-pressed']).toBe(true);
    props.onClick();
    expect(select).toHaveBeenCalledWith('review');
    expect(dependencyLabel('draft', 'review')).toBe('draft to review');
  });
});
