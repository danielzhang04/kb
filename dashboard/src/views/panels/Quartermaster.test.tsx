// @vitest-environment jsdom
/**
 * D3.5 — Quartermaster (usage) panel view. Renders per-model steps + mix + dispatch/card counts from the
 * usage projection, and NEVER surfaces a dollar figure in the UI (matching Control/Ledgers suppression).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { Quartermaster } from './Quartermaster';
import type { UsagePanel } from '../../../server/panels/usage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PANEL: UsagePanel = {
  label: 'usage',
  stepCount: 3,
  perModelSteps: { 'claude-sonnet-5': 2, 'claude-opus-4': 1 },
  modelMix: { 'claude-sonnet-5': 2 / 3, 'claude-opus-4': 1 / 3 },
  models: [
    { model: 'claude-sonnet-5', steps: 2, mix: 2 / 3 },
    { model: 'claude-opus-4', steps: 1, mix: 1 / 3 },
  ],
  dispatchCount: 2,
  cards: 2,
  byProject: { kb: 1, 'faceless-youtube': 1 },
  byWriter: [{ key: 'dispatcher', dispatches: 2, cards: 2, steps: 3, perModelSteps: {}, byProject: {} }],
  byDay: [],
  usdPresent: true,
};

describe('Quartermaster panel', () => {
  it('renders per-model steps + mix and the usage tiles', () => {
    render(<Quartermaster panel={PANEL} />);
    expect(screen.getByLabelText('Quartermaster panel')).toBeTruthy();
    const models = screen.getByLabelText('Per-model steps');
    expect(within(models).getByText('claude-sonnet-5')).toBeTruthy();
    // 2/3 of steps → 67% mix.
    expect(within(models).getByText('67%')).toBeTruthy();
    expect(screen.getByLabelText('Usage by writer')).toBeTruthy();
  });

  it('never renders a dollar figure even though the ledger carries usd (suppressed)', () => {
    render(<Quartermaster panel={PANEL} />);
    const view = screen.getByLabelText('Quartermaster panel');
    expect(view.textContent ?? '').not.toMatch(/\$/);
    expect(view.textContent ?? '').not.toMatch(/usd/i);
    // The note states spend is recorded but not shown here.
    expect(view.textContent ?? '').toMatch(/not shown here/i);
  });

  it('shows a calm empty state with no usage', () => {
    render(<Quartermaster panel={{ ...PANEL, stepCount: 0, dispatchCount: 0, models: [], byWriter: [] }} />);
    expect(screen.getByText(/no usage recorded/i)).toBeTruthy();
  });
});
