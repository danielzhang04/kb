// @vitest-environment jsdom
/**
 * Atlas V1 (Task 8) — the full Atlas view. The shared poller is mocked so these tests pin the
 * presentation contract deterministically: the orb's per-state class, the state word, the OFFLINE
 * last-seen line, the live transcript rows, the filed-cards table (semantic status dot), and the
 * activity-history sessions. Read-only — no writes are asserted because none exist.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { AtlasStateResult } from '../lib/useAtlasState';

const hoisted = vi.hoisted(() => ({ result: null as AtlasStateResult | null }));
vi.mock('../lib/useAtlasState', () => ({
  useAtlasState: () => hoisted.result,
}));

import { Atlas } from './Atlas';

function setState(partial: Partial<AtlasStateResult>): void {
  hoisted.result = {
    panel: { worker: { state: 'ASLEEP' }, history: [], cards: [] },
    worker: { state: 'ASLEEP', since: null, heartbeat: null, sessionId: null, voice: null, transcript: [] },
    history: [],
    cards: [],
    loading: false,
    ...partial,
  };
}

afterEach(() => {
  cleanup();
  hoisted.result = null;
});

describe('Atlas view', () => {
  it('renders a hollow orb + last-seen line when the worker is OFFLINE', () => {
    setState({
      worker: { state: 'OFFLINE', since: null, heartbeat: '2000-01-01T00:00:00Z', sessionId: null, voice: null, transcript: [] },
    });
    render(<Atlas />);
    expect(screen.getByLabelText('Atlas view')).toBeTruthy();
    const stateword = screen.getByTestId('atlas-stateword');
    expect(stateword.getAttribute('data-state')).toBe('OFFLINE');
    expect(within(stateword).getByText('OFFLINE')).toBeTruthy();
    expect(within(stateword).getByText(/last seen/i)).toBeTruthy();
    expect(document.querySelector('.atlas-orb--offline')).toBeTruthy();
  });

  it('renders the speaking orb, transcript, cards and history when awake', () => {
    setState({
      worker: {
        state: 'SPEAKING',
        since: '2026-07-20T10:00:00Z',
        heartbeat: '2026-07-20T10:00:05Z',
        sessionId: 'sess-1',
        voice: 'mars',
        transcript: [
          { t: '2026-07-20T10:00:01Z', role: 'user', text: 'hey atlas' },
          { t: '2026-07-20T10:00:03Z', role: 'atlas', text: 'listening' },
        ],
      },
      cards: [{ id: 'card-1', action: 'check renderer', state: 'working', workflow: 'atlas-voice' }],
      history: [{ file: '2026-07-19-old.jsonl', date: '2026-07-19', sessionId: 'old', lines: [{ t: null, role: 'atlas', text: 'done' }] }],
    });
    render(<Atlas />);

    expect(document.querySelector('.atlas-orb--speaking')).toBeTruthy();
    expect(screen.getByTestId('atlas-stateword').getAttribute('data-state')).toBe('SPEAKING');

    // Live transcript rows (both roles).
    const log = screen.getByTestId('atlas-transcript-log');
    expect(within(log).getByText('hey atlas')).toBeTruthy();
    expect(within(log).getByText('listening')).toBeTruthy();

    // Filed card with a semantic status dot (working → running).
    const cardRow = screen.getByTestId('atlas-card-card-1');
    expect(within(cardRow).getByText('check renderer')).toBeTruthy();
    expect(cardRow.querySelector('.mc-status-dot--running')).toBeTruthy();

    // Activity history session is present.
    expect(screen.getByText('old')).toBeTruthy();
  });

  it('shows a connecting caption before the first fetch resolves', () => {
    setState({ panel: null, loading: true });
    render(<Atlas />);
    expect(screen.getByText(/connecting to worker/i)).toBeTruthy();
  });
});
