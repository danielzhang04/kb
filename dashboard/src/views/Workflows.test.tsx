// @vitest-environment jsdom
/**
 * U2.5 — Workflows view (Registry's workflows slice promoted to a top-level destination). Renders the
 * registered workflows when present, and the calm "no workflows registered yet" empty state otherwise.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Workflows } from './Workflows';

afterEach(cleanup);

describe('Workflows view', () => {
  it('shows the empty state when no workflows are registered', () => {
    render(<Workflows data={{ present: false, items: [] }} />);
    expect(screen.getByLabelText('Workflows view')).toBeTruthy();
    expect(screen.getByText('No workflows registered yet.')).toBeTruthy();
  });

  it('shows the empty state when the registry is present but has no workflows', () => {
    render(<Workflows data={{ present: true, items: [] }} />);
    expect(screen.getByText('No workflows registered yet.')).toBeTruthy();
  });

  it('lists registered workflows by id', () => {
    render(
      <Workflows
        data={{
          present: true,
          items: [
            { id: 'ship-review', path: 'workflows/ship-review.md' },
            { id: 'nightly-sweep', path: 'workflows/nightly-sweep.md' },
          ],
        }}
      />,
    );
    expect(screen.getByText('ship-review')).toBeTruthy();
    expect(screen.getByText('nightly-sweep')).toBeTruthy();
    expect(screen.queryByText('No workflows registered yet.')).toBeNull();
  });
});
