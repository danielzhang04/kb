// @vitest-environment jsdom
/**
 * Atlas V1 (Task 8) — the global mini-orb. Hidden while the worker is ASLEEP / OFFLINE / loading;
 * shown and pulsing (per-state class) while awake; a click navigates to the Atlas view.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { AtlasStateResult, OrbState } from '../lib/useAtlasState';

const hoisted = vi.hoisted(() => ({ result: null as AtlasStateResult | null }));
vi.mock('../lib/useAtlasState', () => ({
  useAtlasState: () => hoisted.result,
}));

import { AtlasMiniOrb } from './AtlasMiniOrb';

function setWorker(state: OrbState, loading = false): void {
  hoisted.result = {
    panel: loading ? null : { worker: { state }, history: [], cards: [] },
    worker: { state, since: null, heartbeat: null, sessionId: null, voice: null, transcript: [] },
    history: [],
    cards: [],
    loading,
  };
}

afterEach(() => {
  cleanup();
  hoisted.result = null;
});

describe('AtlasMiniOrb', () => {
  it('is hidden while loading, ASLEEP, or OFFLINE', () => {
    for (const [state, loading] of [['ASLEEP', true], ['ASLEEP', false], ['OFFLINE', false]] as const) {
      setWorker(state, loading);
      const { unmount } = render(<AtlasMiniOrb onOpen={() => {}} />);
      expect(screen.queryByTestId('atlas-miniorb')).toBeNull();
      unmount();
    }
  });

  it('shows a pulsing orb with the per-state class while awake', () => {
    for (const state of ['LISTENING', 'THINKING', 'SPEAKING'] as const) {
      setWorker(state);
      const { unmount } = render(<AtlasMiniOrb onOpen={() => {}} />);
      const orb = screen.getByTestId('atlas-miniorb');
      expect(orb.getAttribute('data-state')).toBe(state);
      expect(orb.className).toContain(`atlas-miniorb--${state.toLowerCase()}`);
      unmount();
    }
  });

  it('navigates to the Atlas view on click', () => {
    setWorker('LISTENING');
    const onOpen = vi.fn();
    render(<AtlasMiniOrb onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('atlas-miniorb'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
