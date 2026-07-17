// @vitest-environment jsdom
/**
 * Ledgers view (U3). Covers: rollup rows render from a fixture; SPEND is suppressed (no dollar figure
 * in the DOM); an empty ledger degrades to a calm empty state, not an error.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Ledgers } from './Ledgers';
import type { LedgerRollup } from '../../server/planeA/ledgers';

afterEach(cleanup);

const ROLLUP: LedgerRollup = {
  dispatch: { count: 5, cards: 5, byProject: { kb: 3, atlas: 2 } },
  cost: {
    stepCount: 12,
    perModelSteps: { 'claude-opus-4': 8, 'claude-sonnet-5': 4 },
    modelMix: { 'claude-opus-4': 8 / 12, 'claude-sonnet-5': 4 / 12 },
    usdPresent: true, // spend exists in the data — the view must NOT render it
  },
  grades: { count: 0, rows: [] },
  activity: { count: 0, rows: [] },
};

const EMPTY: LedgerRollup = {
  dispatch: { count: 0, cards: 0, byProject: {} },
  cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
  grades: { count: 0, rows: [] },
  activity: { count: 0, rows: [] },
};

describe('Ledgers view', () => {
  it('renders per-model step rows and dispatch counts from a rollup fixture', () => {
    render(<Ledgers rollup={ROLLUP} />);

    // Per-model steps: model name + step count + rounded mix share.
    expect(screen.getByText('claude-opus-4')).toBeTruthy();
    expect(screen.getByText('claude-sonnet-5')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy(); // opus steps
    expect(screen.getByText('67%')).toBeTruthy(); // 8/12 rounded

    // Dispatch-by-project rows.
    expect(screen.getByText('kb')).toBeTruthy();
    expect(screen.getByText('atlas')).toBeTruthy();

    // Summary tile for total steps.
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('suppresses spend: no dollar figure anywhere in the DOM even though usdPresent is true', () => {
    const { container } = render(<Ledgers rollup={ROLLUP} />);
    expect(container.textContent).not.toContain('$');
    // A usd numeric value must not leak in via any column either.
    expect(container.querySelector('[data-usd]')).toBeNull();
  });

  it('degrades an empty ledger to a calm empty state, not an error', () => {
    render(<Ledgers rollup={EMPTY} />);
    expect(screen.getByText(/no ledger activity recorded yet/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
