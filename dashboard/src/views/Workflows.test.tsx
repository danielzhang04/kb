// @vitest-environment jsdom
/**
 * U3 — Workflows lists registered definition artifacts; it does not present definitions as live runs.
 * The designed empty state stays calm and explanatory, and points launched queue-card graphs to Runs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { Workflows } from './Workflows';

afterEach(cleanup);

describe('Workflows view', () => {
  it('renders the designed empty state when no workflows are registered', () => {
    render(<Workflows data={{ present: false, items: [] }} />);
    expect(screen.getByLabelText('Workflows view')).toBeTruthy();
    const empty = screen.getByTestId('workflows-empty');
    expect(within(empty).getByText('No workflows registered yet')).toBeTruthy();
    expect(within(empty).getByText(/this view does not execute them/i)).toBeTruthy();
    expect(within(empty).getByText(/their graph appears in Runs/i)).toBeTruthy();
  });

  it('renders the empty state when the registry is present but has no workflows', () => {
    render(<Workflows data={{ present: true, items: [] }} />);
    expect(screen.getByTestId('workflows-empty')).toBeTruthy();
  });

  it('does not use any error styling in the empty state', () => {
    const { container } = render(<Workflows data={{ present: false, items: [] }} />);
    // No error/blocked semantic classes anywhere in the empty view.
    expect(container.querySelector('[class*="error"]')).toBeNull();
    expect(container.querySelector('[class*="blocked"]')).toBeNull();
  });

  it('lists registered workflows with name, id, path, and a live status marker', () => {
    render(
      <Workflows
        data={{
          present: true,
          items: [
            { id: 'wf_ship-review', path: 'workflows/wf_ship-review.md', name: 'Ship review', status: 'active' },
            { id: 'wf_nightly-sweep', path: 'workflows/wf_nightly-sweep.md', name: 'wf_nightly-sweep', status: 'registered' },
          ],
        }}
      />,
    );
    // The human name renders; when it differs from the id, the mono id is shown alongside it.
    expect(screen.getByText('Ship review')).toBeTruthy();
    expect(screen.getByText('wf_ship-review')).toBeTruthy();
    expect(screen.getByText('workflows/wf_ship-review.md')).toBeTruthy();
    // A name equal to the id renders once (no duplicate id chip).
    expect(screen.getByText('wf_nightly-sweep')).toBeTruthy();
    // Each row carries its own status from the read model.
    expect(screen.getByText('active')).toBeTruthy();
    expect(screen.getByText('registered')).toBeTruthy();
    expect(screen.queryByTestId('workflows-empty')).toBeNull();
  });

  it('distinguishes registered definitions from launched queue-card graphs without a stale placeholder', () => {
    render(<Workflows data={{ present: false, items: [] }} />);
    expect(screen.getByText(/registered reusable definitions/i)).toBeTruthy();
    expect(screen.getByTestId('workflows-runs-note').textContent).toMatch(/Runs visualizes launched queue cards/i);
    expect(screen.queryByText(/D3\.4|will render here/i)).toBeNull();
  });
});
