// @vitest-environment jsdom
/**
 * Agent Platform section (Wave-1 U0) — the grid shell over the auto-discovered panel registry. These
 * tests pin the three behaviours later units depend on: a discovered panel shows as a tile, clicking
 * a tile mounts that panel's own body, and an EMPTY registry renders a placeholder rather than throwing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AgentPlatform } from './AgentPlatform';
import { AGENT_PLATFORM_PANELS } from './agentPlatform/registry';

afterEach(cleanup);

describe('AgentPlatform view', () => {
  it('renders a tile per discovered panel, carrying its title and description', () => {
    render(<AgentPlatform />);
    const section = screen.getByLabelText('Agent Platform view');
    expect(section).toBeTruthy();

    for (const panel of AGENT_PLATFORM_PANELS) {
      expect(screen.getByText(panel.title)).toBeTruthy();
      expect(screen.getByText(panel.description)).toBeTruthy();
    }
    // The demo panel proves discovery reached the view, not just the registry module.
    expect(screen.getByText('Demo Panel')).toBeTruthy();
    expect(screen.getByText('Placeholder proving a panel registers by file drop alone.')).toBeTruthy();
  });

  it('swaps the body to the panel when its tile is clicked, and back again', () => {
    render(<AgentPlatform />);
    fireEvent.click(screen.getByText('Demo Panel'));

    // The panel's own body is mounted (its text is nowhere in the tile), and the grid is gone.
    expect(screen.getByText(/registered itself by existing at/)).toBeTruthy();
    expect(screen.queryByText('Placeholder proving a panel registers by file drop alone.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '← All panels' }));
    expect(screen.getByText('Placeholder proving a panel registers by file drop alone.')).toBeTruthy();
    expect(screen.queryByText(/registered itself by existing at/)).toBeNull();
  });

  it('renders a clean placeholder — never a crash — when no panel is registered', () => {
    expect(() => render(<AgentPlatform panels={[]} />)).not.toThrow();
    expect(screen.getByLabelText('Agent Platform view')).toBeTruthy();
    expect(screen.getByText(/No panels registered yet/)).toBeTruthy();
  });
});
