// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunTimeline } from './RunTimeline';

describe('RunTimeline', () => {
  it('renders lifecycle rows without Activity classes', () => {
    const { container } = render(<RunTimeline rows={[{
      cursor: 1, source: 'worker', stageRef: 'stage-1', attemptRef: null, sessionRef: null,
      status: 'running', label: 'Started work', summary: 'Started work', command: null,
      toolName: null, path: null, diff: null, checkpoint: null, createdAt: '2026-08-21T12:00:00.000Z',
    }]} />);

    expect(screen.getByTestId('run-timeline-row-1').textContent).toContain('Started work');
    expect(container.querySelector('[class*="activity"]')).toBeNull();
  });
});
