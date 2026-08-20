// @vitest-environment jsdom
/**
 * Watch-agents-run panel (Wave-1 U15) — the REGISTRATION half.
 *
 * These pin only what the registry contract owes: the panel appears in the auto-discovered set under
 * its stable id, its shape conforms, and its body mounts without throwing. The behaviour of the body
 * itself is pinned in `watchAgentsRun/WatchAgentsRunBody.test.tsx`.
 *
 * Deliberately NO assertion on the total number of registered panels — other Wave-1 units are landing
 * their own panels in parallel and a count assertion would make this test fail on their work.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AGENT_PLATFORM_PANELS } from '../registry';
import { SessionProvider } from '../../../lib/sessionContext';
import { clearStoredSession } from '../../../lib/authClient';
import { panel } from './WatchAgentsRun.panel';

describe('WatchAgentsRun panel registration', () => {
  afterEach(() => {
    cleanup();
    clearStoredSession();
  });

  it('registers itself in the auto-discovered set under a stable id', () => {
    const found = AGENT_PLATFORM_PANELS.find((entry) => entry.id === 'watch-agents-run');
    expect(found).toBeTruthy();
    expect(found).toBe(panel);
  });

  it('conforms to the panel shape', () => {
    expect(typeof panel.id).toBe('string');
    expect(panel.id.length).toBeGreaterThan(0);
    expect(typeof panel.title).toBe('string');
    expect(panel.title.length).toBeGreaterThan(0);
    expect(typeof panel.description).toBe('string');
    expect(panel.description.length).toBeGreaterThan(0);
    expect(typeof panel.render).toBe('function');
  });

  it('renders its body without throwing (locked, so nothing is fetched)', () => {
    expect(() => render(<SessionProvider>{panel.render()}</SessionProvider>)).not.toThrow();
    expect(screen.getByTestId('watch-agents-run-locked')).toBeTruthy();
  });
});
