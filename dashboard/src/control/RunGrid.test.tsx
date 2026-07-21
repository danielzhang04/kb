// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunGrid } from './RunGrid';
import type { RunMetadataDto } from './controlClient';

afterEach(cleanup);

const LONG_TITLE =
  'Rebuild the faceless video pipeline end to end and republish the audio stage against the reviewed proposal';

function run(overrides: Partial<RunMetadataDto> = {}): RunMetadataDto {
  return {
    runRef: 'run-8f2c19ab', predecessorRunRef: null, title: 'Synthetic control run',
    proposalRef: 'proposal-1', proposalRevision: 2, proposalHash: 'a'.repeat(64),
    publicationState: 'published', state: 'running', version: 4, managerSessionRef: 'session-manager',
    managerGeneration: 1, managerAssignment: null, createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T11:56:00.000Z',
    stageCount: 6, attemptCount: 11, sessionCount: 3, openHumanRequestCount: 0, eventCount: 340,
    ...overrides,
  };
}

const NOW = Date.parse('2026-07-18T12:00:00.000Z');

describe('RunGrid', () => {
  it('renders a long run title IN FULL rather than truncating it', () => {
    // This is the actual defect the grid replaced: the old strip clipped every title with
    // `text-overflow: ellipsis` inside a horizontal scroller, so a run could not be identified.
    render(<RunGrid runs={[run({ title: LONG_TITLE })]} onSelect={vi.fn()} now={NOW} />);

    const title = screen.getByTestId('run-card-run-8f2c19ab-title');
    expect(title.textContent).toBe(LONG_TITLE);

    // Nothing may re-introduce clipping: no ellipsis, no single-line clamp, no fixed height.
    const style = title.style;
    expect(style.textOverflow).toBe('');
    expect(style.whiteSpace).toBe('');
    expect(style.webkitLineClamp ?? '').toBe('');
    expect(title.className).not.toMatch(/truncate|ellipsis|clamp/i);
  });

  it('renders all four rollup counts, none of which were shown before', () => {
    render(<RunGrid runs={[run()]} onSelect={vi.fn()} now={NOW} />);

    const rollups = screen.getByTestId('run-card-run-8f2c19ab-rollups');
    expect(rollups.textContent).toContain('6 stages');
    expect(rollups.textContent).toContain('11 attempts');
    expect(rollups.textContent).toContain('3 sessions');
    expect(rollups.textContent).toContain('340 events');
    // Counts are mono + tabular-nums so columns of them line up.
    expect(rollups.className).toContain('mc-mono');
  });

  it('marks the open run with the left-border marker and nothing else', () => {
    render(
      <RunGrid
        runs={[run(), run({ runRef: 'run-other', title: 'Another run' })]}
        selectedRunRef="run-8f2c19ab"
        onSelect={vi.fn()}
        now={NOW}
      />,
    );

    const selected = screen.getByTestId('run-card-run-8f2c19ab');
    const other = screen.getByTestId('run-card-run-other');

    expect(selected.className).toContain('run-card--selected');
    expect(other.className).not.toContain('run-card--selected');
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(other.getAttribute('aria-pressed')).toBe('false');
  });

  it('surfaces a blocking human request as a needs-you count', () => {
    render(<RunGrid runs={[run({ openHumanRequestCount: 2 })]} onSelect={vi.fn()} now={NOW} />);

    expect(screen.getByTestId('run-card-run-8f2c19ab-needs-you').textContent).toBe('2 needs you');
  });

  it('omits the needs-you marker when nothing is waiting on the operator', () => {
    render(<RunGrid runs={[run({ openHumanRequestCount: 0 })]} onSelect={vi.fn()} now={NOW} />);

    expect(screen.queryByTestId('run-card-run-8f2c19ab-needs-you')).toBeNull();
  });

  it('reports the run age against an injected clock', () => {
    render(<RunGrid runs={[run()]} onSelect={vi.fn()} now={NOW} />);
    expect(screen.getByText('updated 4m ago')).toBeTruthy();
  });

  it('hands the run ref back when a card is clicked', () => {
    const onSelect = vi.fn();
    render(<RunGrid runs={[run()]} onSelect={onSelect} now={NOW} />);

    fireEvent.click(screen.getByTestId('run-card-run-8f2c19ab'));
    expect(onSelect).toHaveBeenCalledWith('run-8f2c19ab');
  });
});
