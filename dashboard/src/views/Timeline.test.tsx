// @vitest-environment jsdom
/**
 * Activity / Timeline view (U3). Covers the U3 interaction pass on top of the existing shared fold:
 *   - tool-use rows carry the accent LEFT-BORDER class (the one terracotta accent)
 *   - auto-scroll while tailing (no pill), FREEZE on manual scroll-up + an "N new" pill that jumps live
 * jsdom has no real layout, so scroll metrics are simulated via defineProperty (the standard approach).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Timeline } from './Timeline';
import type { TimelineModel, Turn } from '../lib/timelineModel';

afterEach(cleanup);

function textTurn(index: number): Turn {
  return { index, model: 'claude-opus-4', usage: null, steps: [{ kind: 'text', text: `turn ${index} body` }] };
}

function model(n: number): TimelineModel {
  return { turns: Array.from({ length: n }, (_, i) => textTurn(i)) };
}

/** Force a scroll element's layout metrics (jsdom reports all 0 by default). */
function setMetrics(el: HTMLElement, m: { scrollHeight: number; clientHeight: number; scrollTop: number }): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: m.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: m.clientHeight });
  el.scrollTop = m.scrollTop;
}

describe('Activity / Timeline view', () => {
  it('renders the empty scaffold (not an error) with no records', () => {
    render(<Timeline model={{ turns: [] }} />);
    expect(screen.getByText('No timeline records yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives a tool-use row the accent LEFT-BORDER class, and a text row does not', () => {
    const m: TimelineModel = {
      turns: [
        {
          index: 0,
          model: 'claude-opus-4',
          usage: null,
          steps: [
            { kind: 'text', text: 'plain narration' },
            { kind: 'tool_use', toolUseId: 't1', name: 'Read', input: { file: 'x.md' }, result: null, subagent: null },
          ],
        },
      ],
    };
    const { container } = render(<Timeline model={m} />);

    const toolRow = container.querySelector('.v-activity__step--tool');
    expect(toolRow).not.toBeNull();
    expect(toolRow?.textContent).toContain('Read');

    // The plain text row must NOT carry the tool accent border class.
    const textRow = container.querySelector('.v-activity__step--text');
    expect(textRow).not.toBeNull();
    expect(textRow?.className).not.toContain('v-activity__step--tool');
  });

  it('auto-scrolls while tailing (at bottom): new turns arrive with NO pill', () => {
    const { rerender } = render(<Timeline model={model(1)} />);
    // Never scrolled up ⇒ still tailing. Two more turns arrive.
    rerender(<Timeline model={model(3)} />);
    expect(screen.queryByRole('button', { name: /new/ })).toBeNull();
  });

  it('freezes on manual scroll-up and shows an "N new" pill that jumps back to live on click', () => {
    const { rerender } = render(<Timeline model={model(1)} />);
    const log = screen.getByTestId('activity-log');

    // Simulate the operator scrolling UP, away from the bottom → freeze.
    setMetrics(log, { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 });
    fireEvent.scroll(log);

    // Two new turns arrive while frozen → pill tallies exactly 2.
    rerender(<Timeline model={model(3)} />);
    const pill = screen.getByRole('button', { name: /new/ });
    expect(pill.textContent).toMatch(/2\s*new/);

    // Clicking the pill jumps back to live: scroll pinned to the bottom and the pill clears.
    fireEvent.click(pill);
    expect(log.scrollTop).toBe(1000);
    expect(screen.queryByRole('button', { name: /new/ })).toBeNull();
  });
});
