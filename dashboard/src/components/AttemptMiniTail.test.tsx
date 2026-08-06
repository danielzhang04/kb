// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AttemptIoLine } from '../lib/useAttemptIo';

const attemptIo = vi.hoisted((): { lines: AttemptIoLine[]; live: boolean } => ({ lines: [], live: false }));
vi.mock('../lib/useAttemptIo', () => ({ useAttemptIo: () => attemptIo }));

import { AttemptMiniTail } from './AttemptMiniTail';

afterEach(() => {
  cleanup();
  attemptIo.lines = [];
  attemptIo.live = false;
});

describe('AttemptMiniTail', () => {
  it('renders the last three lines in order and marks operator input', () => {
    attemptIo.lines = [
      { seq: 1, t: '', dir: 'out', line: 'one' },
      { seq: 2, t: '', dir: 'meta', line: 'two' },
      { seq: 3, t: '', dir: 'meta', line: 'three' },
      { seq: 4, t: '', dir: 'in', line: 'four' },
      { seq: 5, t: '', dir: 'out', line: 'five' },
    ];
    render(<AttemptMiniTail runRef="run-1" attemptRef="attempt-1" sse={{ last: null, count: 0 }} />);
    const tail = screen.getByTestId('mini-tail-attempt-1');
    expect(tail.textContent).toBe('three› fourfive');
    expect(tail.querySelectorAll('.v-mini-tail__line')).toHaveLength(3);
    expect(tail.querySelector('.v-mini-tail__meta')?.textContent).toBe('three');
  });

  it('shows the live dot only while attempt I/O is live', () => {
    attemptIo.lines = [{ seq: 1, t: '', dir: 'out', line: 'one' }];
    attemptIo.live = true;
    const view = render(<AttemptMiniTail runRef="run-1" attemptRef="attempt-1" sse={{ last: null, count: 0 }} />);
    expect(screen.getByTestId('mini-tail-attempt-1').querySelector('.v-mini-tail__live')).toBeTruthy();
    attemptIo.live = false;
    view.rerender(<AttemptMiniTail runRef="run-1" attemptRef="attempt-1" sse={{ last: null, count: 0 }} />);
    expect(screen.getByTestId('mini-tail-attempt-1').querySelector('.v-mini-tail__live')).toBeNull();
  });

  it('renders nothing before any attempt I/O arrives', () => {
    render(<AttemptMiniTail runRef="run-1" attemptRef="attempt-1" sse={{ last: null, count: 0 }} />);
    expect(screen.queryByTestId('mini-tail-attempt-1')).toBeNull();
  });
});
