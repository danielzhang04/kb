// @vitest-environment jsdom
/**
 * Agent Platform section (Wave-1 U0) — the grid shell over the auto-discovered panel registry. These
 * tests pin the three behaviours later units depend on: a discovered panel shows as a tile, clicking
 * a tile mounts that panel's own body, and an EMPTY registry renders a placeholder rather than throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AgentPlatform } from './AgentPlatform';
import { AGENT_PLATFORM_PANELS } from './agentPlatform/registry';

/**
 * The subject for the click-through. U0 used a placeholder `Demo Panel`; U12 retired it, so these
 * assertions ride on a REAL panel — the plainest one there is (no session, no picker, one fetch), so
 * the test still measures the SHELL's tile→body swap and not the panel's own behaviour.
 *
 * TITLE and DESCRIPTION are read off the registry rather than restated, so renaming the panel cannot
 * quietly turn this into a test of nothing; only `BODY_TEXT` (the panel's own first paint, which by
 * construction appears nowhere in its tile) is a literal.
 */
const SUBJECT = AGENT_PLATFORM_PANELS.find((p) => p.id === 'hygiene-report')!;
const BODY_TEXT = /Reading hygiene report/;

beforeEach(() => {
  // The subject self-fetches on mount; a never-resolving stub holds it on its first paint without
  // real network. (U0's placeholder fetched nothing, so this stub is new, not a relaxation.)
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AgentPlatform view', () => {
  it('renders a tile per discovered panel, carrying its title and description', () => {
    render(<AgentPlatform />);
    const section = screen.getByLabelText('Agent Platform view');
    expect(section).toBeTruthy();

    for (const panel of AGENT_PLATFORM_PANELS) {
      expect(screen.getByText(panel.title)).toBeTruthy();
      expect(screen.getByText(panel.description)).toBeTruthy();
    }
    // A real, file-dropped panel proves discovery reached the VIEW, not just the registry module.
    expect(SUBJECT).toBeTruthy();
    expect(screen.getByText(SUBJECT.title)).toBeTruthy();
    expect(screen.getByText(SUBJECT.description)).toBeTruthy();
  });

  it('swaps the body to the panel when its tile is clicked, and back again', () => {
    render(<AgentPlatform />);
    fireEvent.click(screen.getByText(SUBJECT.title));

    // The panel's own body is mounted (its text is nowhere in the tile), and the grid is gone.
    expect(screen.getByText(BODY_TEXT)).toBeTruthy();
    expect(screen.queryByText(SUBJECT.description)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '← All panels' }));
    expect(screen.getByText(SUBJECT.description)).toBeTruthy();
    expect(screen.queryByText(BODY_TEXT)).toBeNull();
  });

  /**
   * The grid renders in the registry's order. Pinned here as well as in `registry.test.ts` because
   * this is the surface an operator actually reads — a view that re-sorted its own copy would pass
   * the registry test and still show the wrong thing.
   */
  it('renders the tiles in the registry order the section curated', () => {
    render(<AgentPlatform />);
    const titles = screen
      .getAllByRole('button')
      .map((b) => b.querySelector('.ap__tile-title')?.textContent)
      .filter((t): t is string => typeof t === 'string');
    expect(titles).toEqual(AGENT_PLATFORM_PANELS.map((p) => p.title));
  });

  it('renders a clean placeholder — never a crash — when no panel is registered', () => {
    expect(() => render(<AgentPlatform panels={[]} />)).not.toThrow();
    expect(screen.getByLabelText('Agent Platform view')).toBeTruthy();
    expect(screen.getByText(/No panels registered yet/)).toBeTruthy();
  });
});
